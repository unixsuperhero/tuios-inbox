import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { claudeTranscript, ompTranscript, paneTranscript } from './scripts/turn.mjs';

let child, home, base, port;
async function launch(dir, port) {
  const proc = Bun.spawn([process.execPath, 'server.mjs'], {
    cwd: import.meta.dir,
    env: { ...process.env, PORT: String(port), TUIOS_INBOX_DATA: dir, TUIOS_INBOX_SPOOL: join(dir, 'events'), TUIOS_BIN: join(dir, 'not-installed') },
    stdout: 'pipe', stderr: 'inherit',
  });
  const reader = proc.stdout.getReader();
  const first = await reader.read();
  expect(new TextDecoder().decode(first.value)).toContain('listening on');
  reader.releaseLock();
  return proc;
}
async function start() { child = await launch(home, port); }
async function stop() { child.kill(); await child.exited; }
async function freePort() {
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const { port } = socket.address();
  await new Promise(resolve => socket.close(resolve));
  return port;
}
async function call(path, body, method = 'POST', headers = {}) {
  return fetch(base + '/api' + path, body === undefined ? { headers } : { method, headers: { 'Content-Type': 'application/json', 'X-Inbox-Request': '1', ...headers }, body: JSON.stringify(body) });
}
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'dispatch-test-'));
  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  await start();
});
afterAll(async () => { if (child) await stop(); if (home) await rm(home, { recursive: true, force: true }); });
const state = async () => (await call('/state')).json();
// Delivers one hook event the way capture-hook.mjs does and waits for the server to consume it.
async function hook(key, values, rest = {}, { dir = home, request = call } = {}) {
  const path = join(dir, 'events', key + '.json');
  await Bun.write(path, JSON.stringify({ id: key, time: new Date().toISOString(), values, ...rest }));
  await request('/reconcile', {});
  for (let i = 0; i < 40 && await Bun.file(path).exists(); i++) await Bun.sleep(100);
  expect(await Bun.file(path).exists()).toBe(false);
  return (await request('/state')).json();
}
const turnHook = (key, pane, prompt, name = pane) => hook(key, { TUIOS_EVENT: 'after-agent-state', TUIOS_AGENT_STATE: 'done', TUIOS_WINDOW_ID: pane },
  { turn: { session: 's', pane, name, harness: 'codex', state: 'done', at: new Date().toISOString(), prompt, response: `reply to ${prompt}`, source: 'pane' } });
const commandHook = (key, pane, command, code = '0') => hook(key, { TUIOS_EVENT: 'after-command-finished', TUIOS_COMMAND: command, TUIOS_EXIT_CODE: code, TUIOS_WINDOW_ID: pane, TUIOS_SESSION_ID: 's', TUIOS_WINDOW_NAME: '' }, { capture: `output of ${command}` });
const newTask = async title => (await call('/tasks', { title, path: home })).json();
const tasksOf = (s, ...titles) => titles.map(title => s.items.find(i => i.title === title).task_id);

test('task edits and agent profile arguments survive a backend restart', async () => {
  const created = await call('/tasks', { title: 'Durable task', path: home, notes: 'before' });
  expect(created.status).toBe(201);
  const task = await created.json();
  expect((await call(`/tasks/${task.id}`, { status: 'active', notes: 'after' }, 'PATCH')).status).toBe(200);
  const configured = await call('/profiles', { name: 'Reviewer', executable: 'codex', args: ['--model', 'configured-model'], protocol: 'codex', env: { PROJECT_MODE: 'review' } });
  const profile = await configured.json();
  await stop(); await start();
  const state = await (await call('/state')).json();
  expect(state.tasks.find(t => t.id === task.id)).toMatchObject({ title: 'Durable task', path: home, notes: 'after', status: 'active', worktree: '' });
  expect(state.profiles.find(p => p.id === profile.id)).toMatchObject({ executable: 'codex', args: ['--model', 'configured-model'], protocol: 'codex', env: { PROJECT_MODE: 'review' } });
});

test('a remote web page cannot create tasks through the local command server', async () => {
  const before = (await (await call('/state')).json()).tasks.map(t => t.id);
  expect((await call('/tasks', { title: 'Injected', path: home }, 'POST', { Origin: 'https://untrusted.example' })).status).toBe(403);
  expect((await call('/tasks', { title: 'Injected', path: home }, 'POST', { 'X-Inbox-Request': '' })).status).toBe(403);
  expect((await call('/state', undefined, 'GET', { Host: 'untrusted.example' })).status).toBe(403);
  expect((await (await call('/state')).json()).tasks.map(t => t.id)).toEqual(before);
});

test('a task may be created without a project directory and given one later', async () => {
  const created = await (await call('/tasks', { title: 'No directory yet' })).json();
  expect(created).toMatchObject({ title: 'No directory yet', path: '', worktree: '' });
  expect((await call(`/tasks/${created.id}`, { path: join(home, 'missing') }, 'PATCH')).status).toBe(400);
  const updated = await (await call(`/tasks/${created.id}`, { path: home }, 'PATCH')).json();
  expect(updated).toMatchObject({ path: home, title: 'No directory yet' });
  expect((await (await call(`/tasks/${created.id}`, { path: '' }, 'PATCH')).json()).path).toBe('');
});

test('a task can be a subtask of another; cycles and self-parenting are refused', async () => {
  const parent = await (await call('/tasks', { title: 'Parent', path: home })).json();
  const child = await (await call('/tasks', { title: 'Child', parent_id: parent.id })).json();
  expect(child).toMatchObject({ parent_id: parent.id, path: '' });
  const grandchild = await (await call('/tasks', { title: 'Grandchild', parent_id: child.id })).json();
  expect(grandchild.parent_id).toBe(child.id);
  expect((await call(`/tasks/${parent.id}`, { parent_id: grandchild.id }, 'PATCH')).status).toBe(400);
  expect((await call(`/tasks/${child.id}`, { parent_id: child.id }, 'PATCH')).status).toBe(400);
  expect((await call('/tasks', { title: 'Orphan', parent_id: 'no-such-task' })).status).toBe(400);
  expect((await (await call(`/tasks/${child.id}`, { parent_id: '' }, 'PATCH')).json()).parent_id).toBe(null);
  expect((await (await call(`/tasks/${child.id}`, { parent_id: parent.id }, 'PATCH')).json()).parent_id).toBe(parent.id);
  expect((await state()).tasks.find(t => t.id === grandchild.id)).toMatchObject({ parent_id: child.id });
});

test('invalid working directories and non-argv agent arguments are rejected', async () => {
  expect((await call('/tasks', { title: 'Invalid', path: join(home, 'missing') })).status).toBe(400);
  expect((await call('/profiles', { name: 'Bad argv', executable: 'codex', args: '--model x', env: {}, protocol: '' })).status).toBe(400);
  expect((await call('/profiles', { name: 'Bad environment', executable: 'codex', args: [], env: { SECRET: 42 }, protocol: '' })).status).toBe(400);
});

test('a finished agent turn from the hook is unread until its reply is opened', async () => {
  const turn = { session: 's', pane: 'pane-1', name: '\u25d0 reviewer', harness: 'codex', state: 'done', at: new Date().toISOString(), prompt: 'Summarise the diff', response: 'First line.\nSecond line.', source: 'pane' };
  const delivered = await hook('turn-1', { TUIOS_EVENT: 'after-agent-state', TUIOS_AGENT_STATE: 'done', TUIOS_WINDOW_ID: 'pane-1' }, { turn, capture: 'raw terminal snapshot' });
  const listed = delivered.items.find(i => i.title === turn.prompt);
  expect(listed).toMatchObject({ type: 'turn', agent_id: 'pane-1', agent_name: 'reviewer', harness: 'codex', task_id: null, status: 'done', unread: 1, archived: 0 });
  expect(listed.response).toBeUndefined();
  expect(delivered.threads).toBeUndefined();
  expect(delivered.turns).toBeUndefined();
  // The turn is the record of an agent state change; the raw snapshot no longer becomes a thread.
  expect(delivered.items.filter(i => i.agent_id === 'pane-1')).toHaveLength(1);
  expect(delivered.agents.find(a => a.id === 'pane-1')).toMatchObject({ session: 's', name: 'reviewer', harness: 'codex', kind: 'agent', task_id: null, state: 'done' });
  const opened = await (await call(`/turns/${listed.id.slice(5)}`, { unread: false }, 'PATCH')).json();
  expect(opened).toMatchObject({ response: turn.response, unread: 0, archived: 0, task_id: null });
  expect((await state()).items.filter(i => i.title === turn.prompt)).toMatchObject([{ unread: 0 }]);
});

test('empty turns are archived without losing late capture or manual archive decisions', async () => {
  const deliver = (key, pane, prompt, response, status = 'done') => hook(key, { TUIOS_EVENT: 'after-agent-state', TUIOS_AGENT_STATE: status, TUIOS_WINDOW_ID: pane },
    { turn: { session: 's', pane, name: pane, harness: 'codex', state: status, at: new Date().toISOString(), prompt, response, source: 'pane' } });
  for (const [pane, prompt, reply, status, archived] of [
    ['empty-completed', '', '', 'done', 1], ['empty-whitespace', ' \n\t\u00a0', '\r\n\t ', 'errored', 1], ['prompt-only', 'Keep the question', '', 'done', 0], ['response-only', '', 'Keep the answer', 'done', 0],
    ['active-prompt', 'Running question', '', 'working', 0], ['empty-active', '', '', 'working', 1], ['empty-waiting', ' \t', '', 'needs_input', 1], ['empty-response-capture', '', 'commentary is not a final reply', 'working', 1],
  ]) {
    const row = (await deliver(pane, pane, prompt, reply, status)).items.find(i => i.agent_id === pane);
    expect(row).toMatchObject({ archived, unread: archived || ['working', 'needs_input'].includes(status) ? 0 : 1, status });
    expect(await (await call(`/turns/${row.id.slice(5)}`)).json()).toMatchObject({ prompt, response: ['working', 'needs_input'].includes(status) ? '' : reply });
  }
  for (const [pane, status] of [['empty-whitespace', 'errored'], ['empty-active', 'working'], ['empty-waiting', 'needs_input']]) {
    const first = (await state()).items.find(i => i.agent_id === pane);
    const enriched = await deliver(pane + '-late', pane, 'Recovered question', status === 'errored' ? 'Recovered answer' : '', status);
    expect(enriched.items.filter(i => i.agent_id === pane)).toMatchObject([{ id: first.id, title: 'Recovered question', archived: 0, unread: status === 'errored' ? 1 : 0 }]);
  }
  const responseRow = (await state()).items.find(i => i.agent_id === 'empty-response-capture');
  expect((await deliver('empty-response-capture-late', 'empty-response-capture', '', 'The final answer')).items.filter(i => i.agent_id === 'empty-response-capture')).toMatchObject([{ id: responseRow.id, archived: 0, unread: 1 }]);
  const emptyFinished = (await state()).items.find(i => i.agent_id === 'empty-completed');
  const capturedBeforeFinish = { session: 's', pane: 'empty-completed', name: 'worker', harness: 'codex', state: 'working', at: emptyFinished.created, prompt: 'A delayed original question', response: '', source: 'pane' };
  const delayed = await hook('empty-before-finish', { TUIOS_EVENT: 'after-agent-state', TUIOS_AGENT_STATE: 'working', TUIOS_WINDOW_ID: capturedBeforeFinish.pane }, { turn: capturedBeforeFinish });
  expect(delayed.items.filter(i => i.agent_id === capturedBeforeFinish.pane)).toMatchObject([{ id: emptyFinished.id, title: capturedBeforeFinish.prompt, status: 'done', archived: 0, unread: 1 }]);
  expect(delayed.items.find(i => i.id === emptyFinished.id)).toMatchObject({ response_captured: 0, updated: emptyFinished.updated });
  const responseCaptured = await hook('empty-same-time-response', { TUIOS_EVENT: 'after-agent-state', TUIOS_AGENT_STATE: 'done', TUIOS_WINDOW_ID: capturedBeforeFinish.pane },
    { turn: { ...capturedBeforeFinish, state: 'done', at: emptyFinished.updated, response: '# Recovered answer\n\n**Complete.**' } });
  expect(responseCaptured.items.filter(i => i.agent_id === capturedBeforeFinish.pane)).toMatchObject([{ id: emptyFinished.id, title: capturedBeforeFinish.prompt, status: 'done', archived: 0, updated: emptyFinished.updated, response_captured: 1 }]);
  expect(await (await call(`/turns/${emptyFinished.id.slice(5)}`)).json()).toMatchObject({ response: '# Recovered answer\n\n**Complete.**', finished: emptyFinished.updated });
  for (const [pane, bulk] of [['empty-manual-single', false], ['empty-manual-bulk', true]]) {
    const row = (await deliver(pane, pane, '', '')).items.find(i => i.agent_id === pane);
    const edited = bulk ? await call('/items/update', { ids: [row.id], set: { archived: true } }) : await call(`/turns/${row.id.slice(5)}`, { archived: true }, 'PATCH');
    expect(edited.status).toBe(200);
    const after = await deliver(pane + '-late', pane, 'Recovered manually archived question', 'Recovered manually archived answer');
    expect(after.items.filter(i => i.agent_id === pane)).toMatchObject([{ id: row.id, archived: 1 }]);
  }
  const manual = (await state()).items.find(i => i.agent_id === 'prompt-only');
  await call(`/turns/${manual.id.slice(5)}`, { archived: true }, 'PATCH');
  expect((await deliver('prompt-only-late', 'prompt-only', 'Keep the question', 'Late answer')).items.filter(i => i.agent_id === 'prompt-only')).toMatchObject([{ id: manual.id, archived: 1 }]);
});

test('an in-progress hook exposes the prompt and keeps one turn through tool activity and completion', async () => {
  const pane = 'progress-pane', at = new Date().toISOString();
  const turn = { session: 's', pane, name: 'working agent', harness: 'omp', state: 'working', at, prompt: 'Repair the parser', response: 'intermediate commentary', source: 'transcript' };
  const deliver = (key, captured) => hook(key, { TUIOS_EVENT: 'after-agent-state', TUIOS_AGENT_STATE: captured.state, TUIOS_WINDOW_ID: pane }, { turn: captured });
  const first = await deliver('progress-start', turn);
  expect(first.items.filter(i => i.agent_id === pane)).toMatchObject([{ title: turn.prompt, status: 'working', unread: 0 }]);
  const rowId = first.items.find(i => i.agent_id === pane).id;
  const detail = () => call('/turns/' + rowId.slice(5)).then(r => r.json());
  expect(await detail()).toMatchObject({ prompt: turn.prompt, response: '', finished: null, unread: 0 });
  const waiting = await deliver('progress-tool', { ...turn, state: 'needs_input', at: new Date().toISOString(), prompt: 'Yes, apply the repair', response: 'tool output' });
  expect(waiting.items.filter(i => i.agent_id === pane)).toMatchObject([{ id: rowId, title: turn.prompt, status: 'needs_input', unread: 0 }]);
  expect(await detail()).toMatchObject({ response: '', finished: null });
  const complete = { ...turn, state: 'done', at: new Date().toISOString(), prompt: '', response: 'The parser is repaired.' };
  const ended = await deliver('progress-end', complete);
  expect(ended.items.filter(i => i.agent_id === pane)).toMatchObject([{ id: rowId, title: turn.prompt, status: 'done', unread: 1 }]);
  expect(await detail()).toMatchObject({ prompt: turn.prompt, response: complete.response, finished: complete.at });
  await call('/turns/' + rowId.slice(5), { unread: false }, 'PATCH');
  await deliver('progress-end', complete);
  await deliver('progress-old', turn);
  const inactive = await deliver('progress-inactive', { ...turn, at: new Date().toISOString(), prompt: '' });
  expect(inactive.items.filter(i => i.agent_id === pane)).toMatchObject([{ id: rowId, title: turn.prompt, status: 'done', unread: 0 }]);
  expect(await detail()).toMatchObject({ response: complete.response, finished: complete.at });
  const next = await deliver('progress-next', { ...turn, at: new Date(Date.parse(complete.at) + 1000).toISOString(), prompt: 'Now repair the formatter', response: '' });
  expect(next.items.filter(i => i.agent_id === pane).map(i => [i.title, i.status, i.archived]).sort()).toEqual([['Now repair the formatter', 'working', 0], ['Repair the parser', 'done', 0]]);
  expect(await detail()).toMatchObject({ prompt: turn.prompt, response: complete.response, finished: complete.at, unread: 0 });
});
test('completion cannot replace an already captured prompt with a later answer', async () => {
  const pane = 'preserved-pane', turn = { session: 's', pane, name: 'worker', harness: 'omp', state: 'working', at: new Date().toISOString(), prompt: 'Fix the original issue', response: '', source: 'transcript' };
  const first = await hook('preserved-start', { TUIOS_EVENT: 'after-agent-state', TUIOS_AGENT_STATE: 'working', TUIOS_WINDOW_ID: pane }, { turn });
  const row = first.items.find(i => i.agent_id === pane);
  const last = await hook('preserved-finish', { TUIOS_EVENT: 'after-agent-state', TUIOS_AGENT_STATE: 'done', TUIOS_WINDOW_ID: pane }, { turn: { ...turn, state: 'done', at: new Date().toISOString(), prompt: 'Yes, proceed', response: 'Original issue fixed.' } });
  expect(last.items.filter(i => i.agent_id === pane)).toMatchObject([{ id: row.id, title: turn.prompt, status: 'done', unread: 1 }]);
  expect(await (await call('/turns/' + row.id.slice(5))).json()).toMatchObject({ prompt: turn.prompt, response: 'Original issue fixed.' });
});
test('restart reconciliation recovers only unfinished prompts in the same native state and a later native event reuses a hook row', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dispatch-progress-')), at = '2026-01-02T00:00:00.000Z';
  const db = new Database(join(dir, 'inbox.sqlite'), { create: true });
  db.exec(`CREATE TABLE turns (id TEXT PRIMARY KEY, session TEXT NOT NULL, pane_id TEXT NOT NULL, pane_name TEXT NOT NULL, harness TEXT NOT NULL, prompt TEXT NOT NULL, response TEXT NOT NULL, source TEXT NOT NULL, state TEXT NOT NULL, unread INTEGER NOT NULL DEFAULT 0, started TEXT NOT NULL, finished TEXT)`);
  const insert = db.query('INSERT INTO turns VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  for (const [pane, status, prompt, reply, finished] of [
    ['recover-working', 'working', '', '', null], ['recover-waiting', 'needs_input', ' \n\t', '', null], ['recover-stale', 'working', '', '', null], ['recover-finished', 'done', 'Saved prompt', 'Saved reply', at],
  ]) insert.run(pane, 's', pane, 'worker', 'codex', prompt, reply, 'pane', status, status === 'done' ? 1 : 0, at, finished);
  db.close();
  const eventPath = join(dir, 'native-event.json'), bin = join(dir, 'not-installed');
  const agents = [
    ['recover-working', 'working', 'Recover the running prompt'], ['recover-waiting', 'needs_input', 'Recover the waiting prompt'], ['recover-stale', 'done', 'Do not import the old prompt'], ['recover-finished', 'working', 'Do not overwrite saved history'], ['hook-first', 'working', 'Hook arrived before native event'], ['native-empty', 'working', ''],
  ].map(([pane, status, prompt]) => ({ window_id: pane, name: 'worker', harness_id: 'codex', protocol: true, state: status, agent_state_at: Date.parse(at) * 1e6, meta: { prompt } }));
  await Bun.write(bin, '#!' + process.execPath + '\n' + `
const agents = ` + JSON.stringify(agents) + `;
const command = process.argv[2];
if (command === 'list-agents') console.log(JSON.stringify({ agents }));
else if (command === 'list-windows') console.log(JSON.stringify({ windows: agents.map(a => ({ id: a.window_id, agent_state: a.state })) }));
else if (command === 'ls') console.log(JSON.stringify({ sessions: [{ name: 's', windows: agents.map(a => ({ id: a.window_id })) }] }));
else if (command === 'capture-pane') console.log('you  ' + agents.find(a => a.window_id === process.argv[process.argv.indexOf('-w') + 1]).meta.prompt + String.fromCharCode(10, 10) + 'intermediate output');
else if (command === 'subscribe') {
  let sent = 0;
  while (true) {
    if (await Bun.file(` + JSON.stringify(eventPath) + `).exists()) {
      const lines = (await Bun.file(` + JSON.stringify(eventPath) + `).text()).trim().split(String.fromCharCode(10));
      for (const line of lines.slice(sent)) console.log(line);
      sent = lines.length;
    }
    await Bun.sleep(10);
  }
} else console.log('{}');
`);
  await chmod(bin, 0o755);
  const port = await freePort(), url = 'http://127.0.0.1:' + port + '/api';
  const request = (path, body) => fetch(url + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Inbox-Request': '1' }, body: JSON.stringify(body) });
  const proc = await launch(dir, port);
  try {
    await request('/reconcile', {});
    const first = await (await request('/state')).json();
    expect(first.items.filter(i => i.agent_id === 'recover-working')).toMatchObject([{ id: 'turn:recover-working', title: 'Recover the running prompt', status: 'working', unread: 0, archived: 0 }]);
    expect(first.items.filter(i => i.agent_id === 'recover-waiting')).toMatchObject([{ id: 'turn:recover-waiting', title: 'Recover the waiting prompt', status: 'needs_input', unread: 0, archived: 0 }]);
    expect(await (await request('/turns/recover-working')).json()).toMatchObject({ response: '', finished: null });
    expect(await (await request('/turns/recover-stale')).json()).toMatchObject({ prompt: '', response: '', state: 'working', archived: 1 });
    expect(await (await request('/turns/recover-finished')).json()).toMatchObject({ prompt: 'Saved prompt', response: 'Saved reply', state: 'done', finished: at });
    const captured = { session: 's', pane: 'hook-first', name: 'worker', harness: 'codex', state: 'working', at: new Date().toISOString(), prompt: 'Hook arrived before native event', response: '', source: 'pane' };
    const before = await hook('native-race', { TUIOS_EVENT: 'after-agent-state', TUIOS_AGENT_STATE: 'working', TUIOS_WINDOW_ID: captured.pane }, { turn: captured }, { dir, request });
    const row = before.items.find(i => i.agent_id === captured.pane);
    const events = [{ type: 'agent-state', session: 's', window: captured.pane, state: 'working', time: (Date.now() + 1) * 1e6, boot_id: 'race', seq: 1 }];
    await Bun.write(eventPath, events.map(JSON.stringify).join('\n'));
    let after;
    for (let i = 0; i < 100; i++) {
      after = await (await request('/state')).json();
      if (after.agents.find(a => a.id === captured.pane)?.seen > captured.at) break;
      await Bun.sleep(10);
    }
    expect(after.agents.find(a => a.id === captured.pane).seen > captured.at).toBe(true);
    expect(after.items.filter(i => i.agent_id === captured.pane)).toMatchObject([{ id: row.id, title: captured.prompt, status: 'working', unread: 0 }]);
    events.push({ type: 'agent-state', session: 's', window: 'native-empty', state: 'working', time: Date.now() * 1e6, boot_id: 'race', seq: 2 });
    await Bun.write(eventPath, events.map(JSON.stringify).join('\n'));
    let blank;
    for (let i = 0; i < 100; i++) {
      blank = (await (await request('/state')).json()).items.find(i => i.agent_id === 'native-empty');
      if (blank) break;
      await Bun.sleep(10);
    }
    expect(blank).toMatchObject({ status: 'working', title: '', archived: 1, unread: 0 });
    events.push({ type: 'agent-state', session: 's', window: 'native-empty', state: 'idle', time: (Date.now() + 1) * 1e6, boot_id: 'race', seq: 3 });
    await Bun.write(eventPath, events.map(JSON.stringify).join('\n'));
    let ended;
    for (let i = 0; i < 100; i++) {
      ended = await (await request('/turns/' + blank.id.slice(5))).json();
      if (ended.state === 'idle') break;
      await Bun.sleep(10);
    }
    expect(ended).toMatchObject({ id: blank.id.slice(5), state: 'idle', archived: 1, unread: 0 });
    const delayed = { session: 's', pane: 'native-empty', name: 'worker', harness: 'codex', state: 'working', at: blank.created, prompt: 'Captured before the idle transition', response: '', source: 'pane' };
    const restored = await hook('native-delayed-prompt', { TUIOS_EVENT: 'after-agent-state', TUIOS_AGENT_STATE: 'working', TUIOS_WINDOW_ID: delayed.pane }, { turn: delayed }, { dir, request });
    expect(restored.items.filter(i => i.agent_id === delayed.pane)).toMatchObject([{ id: blank.id, title: delayed.prompt, status: 'idle', archived: 0, unread: 0 }]);
    expect(await (await request('/turns/' + blank.id.slice(5))).json()).toMatchObject({ finished: ended.finished, state: 'idle' });
    await hook('native-stale-prompt', { TUIOS_EVENT: 'after-agent-state', TUIOS_AGENT_STATE: 'working', TUIOS_WINDOW_ID: delayed.pane }, { turn: { ...delayed, prompt: 'Must not replace completed history' } }, { dir, request });
    expect(await (await request('/turns/' + blank.id.slice(5))).json()).toMatchObject({ prompt: delayed.prompt, finished: ended.finished, state: 'idle' });
    events.push({ type: 'agent-state', session: 's', window: captured.pane, state: 'idle', time: Date.now() * 1e6, boot_id: 'race', seq: 4 });
    await Bun.write(eventPath, events.map(JSON.stringify).join('\n'));
    let meaningfulIdle;
    for (let i = 0; i < 100; i++) {
      meaningfulIdle = await (await request('/turns/' + row.id.slice(5))).json();
      if (meaningfulIdle.state === 'idle') break;
      await Bun.sleep(10);
    }
    expect(meaningfulIdle).toMatchObject({ id: row.id.slice(5), prompt: captured.prompt, state: 'idle', finished: null, archived: 0, unread: 0 });
  } finally { proc.kill(); await proc.exited; await rm(dir, { recursive: true, force: true }); }
});
test('an agent state change without a finished turn updates the agent and creates no thread', async () => {
  const before = (await state()).items.length;
  const after = await hook('state-1', { TUIOS_EVENT: 'after-agent-state', TUIOS_AGENT_STATE: 'needs_input', TUIOS_WINDOW_ID: 'pane-waiting', TUIOS_SESSION_ID: 's', TUIOS_WINDOW_NAME: '\u2733 Build the thing', TUIOS_AGENT_HARNESS: 'claude-code' }, { capture: 'approve?' });
  expect(after.items).toHaveLength(before);
  expect(after.agents.find(a => a.id === 'pane-waiting')).toMatchObject({ name: 'Build the thing', harness: 'claude-code', kind: 'agent', state: 'needs_input' });
});

test('a finished shell command arrives as an unread command item and records its pane', async () => {
  await commandHook('cmd-1', 'shell-1', 'ls -la');
  const s = await commandHook('cmd-2', 'shell-1', 'false', '1');
  expect(s.items.find(i => i.title === 'ls -la')).toMatchObject({ type: 'command', agent_id: 'shell-1', task_id: null, status: 'complete', unread: 1, archived: 0 });
  expect(s.items.find(i => i.title === 'false')).toMatchObject({ type: 'command', status: 'failed', unread: 1 });
  expect(s.agents.find(a => a.id === 'shell-1')).toMatchObject({ session: 's', kind: 'shell', task_id: null });
  const thread = await (await call(`/threads/${s.items.find(i => i.title === 'ls -la').id.slice(7)}`)).json();
  expect(thread).toMatchObject({ kind: 'command', pane_id: 'shell-1', messages: [{ body: 'output of ls -la', status: 'complete' }] });
  // A command typed in an agent's pane does not turn the agent into a shell.
  expect((await commandHook('cmd-3', 'pane-1', 'git status')).agents.find(a => a.id === 'pane-1')).toMatchObject({ kind: 'agent', name: 'reviewer' });
});

test('assigning an agent to a task moves its items and is inherited by new ones, except items moved elsewhere', async () => {
  const [first, other, second] = [await newTask('First'), await newTask('Other'), await newTask('Second')];
  await turnHook('follow-1', 'pane-follow', 'follows the agent');
  await turnHook('follow-2', 'pane-follow', 'moved elsewhere');
  await commandHook('follow-3', 'pane-follow', 'unassigned later');
  await turnHook('follow-4', 'pane-other', 'another agent');
  expect((await call('/agents/update', { ids: ['pane-follow'], set: { task_id: first.id } })).status).toBe(200);
  expect(tasksOf(await state(), 'follows the agent', 'moved elsewhere', 'unassigned later', 'another agent')).toEqual([first.id, first.id, first.id, null]);
  await turnHook('follow-5', 'pane-follow', 'new turn');
  const inherited = await commandHook('follow-6', 'pane-follow', 'new command');
  expect(tasksOf(inherited, 'new turn', 'new command')).toEqual([first.id, first.id]);
  const item = title => inherited.items.find(i => i.title === title).id;
  await call('/items/update', { ids: [item('moved elsewhere')], set: { task_id: other.id } });
  await call('/items/update', { ids: [item('unassigned later')], set: { task_id: null } });
  expect((await call('/agents/update', { ids: ['pane-follow', 'no-such-agent'], set: { task_id: second.id } })).status).toBe(400);
  expect((await call('/agents/update', { ids: ['pane-follow'], set: { task_id: 'no-such-task' } })).status).toBe(400);
  expect((await state()).agents.find(a => a.id === 'pane-follow').task_id).toBe(first.id);
  expect(await (await call('/agents/update', { ids: ['pane-follow'], set: { task_id: second.id } })).json()).toEqual({ ok: true, updated: 1 });
  const moved = await state();
  expect(moved.agents.find(a => a.id === 'pane-follow').task_id).toBe(second.id);
  expect(tasksOf(moved, 'follows the agent', 'moved elsewhere', 'unassigned later', 'new turn', 'new command')).toEqual([second.id, other.id, second.id, second.id, second.id]);
  await call('/agents/update', { ids: ['pane-follow'], set: { task_id: null } });
  expect(tasksOf(await state(), 'follows the agent', 'moved elsewhere')).toEqual([null, other.id]);
});

test('items are updated in bulk, and one invalid id or task changes nothing', async () => {
  await turnHook('bulk-1', 'pane-bulk', 'bulk turn');
  const task = await newTask('Bulk'), s = await commandHook('bulk-2', 'pane-bulk', 'bulk command');
  const ids = ['bulk turn', 'bulk command'].map(title => s.items.find(i => i.title === title).id);
  const picked = async () => { const { items } = await state(); return ids.map(key => items.find(i => i.id === key)).map(i => [i.unread, i.archived, i.task_id]); };
  expect(await (await call('/items/update', { ids, set: { unread: true, archived: true, task_id: task.id } })).json()).toEqual({ ok: true, updated: 2 });
  expect(await picked()).toEqual([[1, 1, task.id], [1, 1, task.id]]);
  for (const bad of [{ ids: [...ids, 'turn:missing'], set: { archived: false } }, { ids: [...ids, 'bogus'], set: { archived: false } }, { ids, set: { unread: false, task_id: 'no-such-task' } }, { ids: [], set: { archived: false } }]) {
    const refused = await call('/items/update', bad);
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toBeString();
  }
  expect(await picked()).toEqual([[1, 1, task.id], [1, 1, task.id]]);
  expect((await call(`/threads/${ids[1].slice(7)}`, { archived: false, task_id: null }, 'PATCH')).status).toBe(200);
  expect(await picked()).toEqual([[1, 1, task.id], [1, 0, null]]);
});

test('task status is set in bulk, all or nothing', async () => {
  const ids = [(await newTask('Bulk status A')).id, (await newTask('Bulk status B')).id];
  const statuses = async () => (await state()).tasks.filter(t => ids.includes(t.id)).map(t => t.status);
  expect(await (await call('/tasks/update', { ids, set: { status: 'done' } })).json()).toEqual({ ok: true, updated: 2 });
  expect(await statuses()).toEqual(['done', 'done']);
  expect((await call('/tasks/update', { ids: [...ids, 'no-such-task'], set: { status: 'open' } })).status).toBe(400);
  expect((await call('/tasks/update', { ids, set: { status: 'finished' } })).status).toBe(400);
  expect(await statuses()).toEqual(['done', 'done']);
});

test('deleted agent profiles stay deleted after a restart', async () => {
  const added = await (await call('/profiles', { name: 'Temporary', executable: 'codex', args: [], protocol: '', env: {} })).json();
  expect((await call('/profiles/delete', { ids: [added.id, 'no-such-profile'] })).status).toBe(400);
  expect((await state()).profiles.map(p => p.id)).toContain(added.id);
  expect(await (await call('/profiles/delete', { ids: [added.id, 'omp'] })).json()).toEqual({ ok: true, deleted: 2 });
  await stop(); await start();
  const ids = (await state()).profiles.map(p => p.id);
  expect(ids).toContain('codex');
  expect(ids).not.toContain(added.id);
  expect(ids).not.toContain('omp');
});

test('an existing database is migrated once: every kind of row becomes an item of the right type', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dispatch-migrate-')), at = '2026-01-01T00:00:00.000Z';
  const db = new Database(join(dir, 'inbox.sqlite'), { create: true });
  db.exec(`CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, path TEXT NOT NULL, worktree TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open', notes TEXT NOT NULL DEFAULT '', session TEXT NOT NULL, created TEXT NOT NULL);
    CREATE TABLE panes (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), name TEXT NOT NULL, kind TEXT NOT NULL, profile_id TEXT, state TEXT NOT NULL DEFAULT 'idle', conversation_id TEXT NOT NULL DEFAULT '');
    CREATE TABLE threads (id TEXT PRIMARY KEY, task_id TEXT REFERENCES tasks(id), pane_id TEXT, subject TEXT NOT NULL, kind TEXT NOT NULL, unread INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL, updated TEXT NOT NULL, external_key TEXT UNIQUE);
    CREATE TABLE messages (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id), role TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, meta TEXT NOT NULL DEFAULT '{}', created TEXT NOT NULL);
    CREATE TABLE turns (id TEXT PRIMARY KEY, session TEXT NOT NULL, pane_id TEXT NOT NULL, pane_name TEXT NOT NULL, harness TEXT NOT NULL, prompt TEXT NOT NULL, response TEXT NOT NULL, source TEXT NOT NULL, state TEXT NOT NULL, unread INTEGER NOT NULL DEFAULT 0, started TEXT NOT NULL, finished TEXT);
    INSERT INTO tasks VALUES ('task','Old task','/tmp','','open','','inbox-task','${at}');
    INSERT INTO panes VALUES ('app-pane','task','worker','agent','codex','done','');
    INSERT INTO turns VALUES ('t1','inbox-task','app-pane','\u25d0 worker','codex','app pane turn','reply','pane','done',1,'${at}','${at}');
    INSERT INTO turns VALUES ('t2','loose','loose-pane','\u2733 Loose agent','claude-code','loose turn','reply','transcript','done',0,'${at}','${at}');`);
  const thread = db.query('INSERT INTO threads VALUES (?,?,?,?,?,1,0,?,?,NULL)'), message = db.query("INSERT INTO messages VALUES (?,?,'system','body',?,?,?)");
  for (const [key, task, pane, kind, status, values] of [
    ['dispatch-agent', 'task', 'app-pane', 'agent', 'captured'], ['dispatch-shell', 'task', null, 'shell', 'complete'], ['mail', 'task', null, 'mail', 'complete'], ['system', null, null, 'system', 'partial'],
    ['command', null, null, 'hook', 'snapshot', { TUIOS_EVENT: 'after-command-finished', TUIOS_WINDOW_ID: 'old-shell', TUIOS_SESSION_ID: 'loose', TUIOS_EXIT_CODE: '2' }],
    ['snapshot', null, null, 'hook', 'snapshot', { TUIOS_EVENT: 'after-agent-state', TUIOS_WINDOW_ID: 'loose-pane' }],
  ]) { thread.run(key, task, pane, key, kind, at, at); message.run(`m-${key}`, key, status, JSON.stringify(values ? { values } : {}), at); }
  db.close();
  const at2 = await freePort(), url = `http://127.0.0.1:${at2}/api`;
  const read = async () => { const s = await (await fetch(`${url}/state`)).json(); return { ...s, byTitle: Object.fromEntries(s.items.map(i => [i.title, i])) }; };
  let proc = await launch(dir, at2);
  try {
    const first = await read();
    expect(Object.fromEntries(first.items.map(i => [i.title, i.type]))).toEqual({ 'app pane turn': 'turn', 'loose turn': 'turn', 'dispatch-agent': 'dispatch', 'dispatch-shell': 'dispatch', mail: 'mail', system: 'system', command: 'command', snapshot: 'snapshot' });
    expect(first.byTitle['app pane turn']).toMatchObject({ id: 'turn:t1', agent_id: 'app-pane', agent_name: 'worker', harness: 'codex', task_id: 'task', status: 'done', unread: 1, archived: 0, created: at, updated: at });
    expect(first.byTitle['loose turn']).toMatchObject({ agent_name: 'Loose agent', task_id: null });
    expect(first.byTitle['dispatch-agent']).toMatchObject({ id: 'thread:dispatch-agent', agent_id: 'app-pane', agent_name: 'worker', task_id: 'task', status: 'captured', unread: 1 });
    expect(first.byTitle.command).toMatchObject({ agent_id: 'old-shell', status: 'failed', archived: 0 });
    expect(first.byTitle.snapshot).toMatchObject({ archived: 1 });
    expect(first.agents.map(a => [a.id, a.kind, a.session, a.task_id]).sort()).toEqual([['app-pane', 'agent', 'inbox-task', 'task'], ['loose-pane', 'agent', 'loose', null], ['old-shell', 'shell', 'loose', null]]);
    // Moving the snapshot back to the inbox survives the next start.
    expect((await fetch(`${url}/threads/snapshot`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Inbox-Request': '1' }, body: JSON.stringify({ archived: false }) })).status).toBe(200);
    proc.kill(); await proc.exited; proc = await launch(dir, at2);
    const second = await read();
    expect(second.byTitle.snapshot).toMatchObject({ type: 'snapshot', archived: 0 });
    expect(second.items).toHaveLength(8);
    expect(second.agents).toHaveLength(3);
  } finally { proc.kill(); await proc.exited; await rm(dir, { recursive: true, force: true }); }
});

test('a turn is read in full from a harness transcript or a protocol pane', () => {
  const lines = [
    { type: 'user', message: { content: 'earlier prompt' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'earlier reply' }] } },
    { type: 'user', message: { content: 'fix the bug' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Looking.' }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'subagent chatter' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Fixed.\n\nTests pass.' }] } },
  ].map(JSON.stringify);
  expect(claudeTranscript(lines)).toEqual({ prompt: 'fix the bug', response: 'Fixed.\n\nTests pass.', source: 'transcript' });
  expect(claudeTranscript(lines.slice(0, 3))).toEqual({ prompt: 'fix the bug', response: '', source: 'transcript' });
  expect(claudeTranscript(lines.slice(0, 5))).toEqual({ prompt: 'fix the bug', response: '', source: 'transcript' });
  const omp = [
    { type: 'session' },
    { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'testing' }] } },
    { type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', name: 'bash' }] } },
    { type: 'message', message: { role: 'toolResult', content: [{ type: 'text', text: 'No messages.' }] } },
    { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: "Received. I'm here." }] } },
  ].map(JSON.stringify);
  expect(ompTranscript(omp)).toEqual({ prompt: 'testing', response: "Received. I'm here.", source: 'transcript' });
  expect(ompTranscript(omp.slice(0, 2))).toEqual({ prompt: 'testing', response: '', source: 'transcript' });
  expect(ompTranscript(omp.slice(0, 4))).toEqual({ prompt: 'testing', response: '', source: 'transcript' });
  const pane = ['you  old prompt', '', 'old reply', 'turn finished', '', 'you  Reply with exactly ONE TWO. Do not u', 'se tools.', '', 'ONE', 'TWO', 'turn finished', '> type a prompt'].join('\n');
  expect(paneTranscript(pane)).toEqual({ prompt: 'Reply with exactly ONE TWO. Do not use tools.', response: 'ONE\nTWO', source: 'pane' });
  expect(paneTranscript('> type a prompt')).toBeNull();
});

test('work can be composed to an agent assigned to the task, and to no other agent', async () => {
  const task = await newTask('Compose target');
  await turnHook('compose-1', 'pane-assigned', 'assigned prompt');
  await turnHook('compose-2', 'pane-other', 'other prompt');
  expect((await call('/agents/update', { ids: ['pane-assigned'], set: { task_id: task.id } })).status).toBe(200);
  expect((await call(`/tasks/${task.id}/compose`, { paneId: 'pane-other', subject: 'Nope', body: 'x' })).status).toBe(400);
  const sent = await call(`/tasks/${task.id}/compose`, { paneId: 'pane-assigned', subject: 'Do the thing', body: 'please' });
  expect(sent.status).toBe(202);
  const { threadId } = await sent.json();
  expect((await state()).items.find(i => i.id === `thread:${threadId}`)).toMatchObject({ type: 'dispatch', agent_id: 'pane-assigned', task_id: task.id, title: 'Do the thing' });
});

test('tasks and agents are archived without changing their task or status', async () => {
  const task = await newTask('Archive me');
  await turnHook('archive-1', 'pane-archived', 'archive prompt');
  await call('/agents/update', { ids: ['pane-archived'], set: { task_id: task.id } });
  expect((await call('/agents/update', { ids: ['pane-archived'], set: { archived: true } })).status).toBe(200);
  expect((await call('/tasks/update', { ids: [task.id], set: { archived: true } })).status).toBe(200);
  expect((await call('/tasks/update', { ids: [task.id], set: {} })).status).toBe(400);
  let s = await state();
  expect(s.agents.find(a => a.id === 'pane-archived')).toMatchObject({ archived: 1, task_id: task.id });
  expect(s.tasks.find(t => t.id === task.id)).toMatchObject({ archived: 1, status: 'open' });
  expect(tasksOf(s, 'archive prompt')).toEqual([task.id]);
  await call('/tasks/update', { ids: [task.id], set: { archived: false } });
  expect((await state()).tasks.find(t => t.id === task.id).archived).toBe(0);
});

test('a command hook creates no item only when both its command line and its output are missing', async () => {
  await hook('blank-1', { TUIOS_EVENT: 'after-command-finished', TUIOS_COMMAND: '', TUIOS_EXIT_CODE: '0', TUIOS_WINDOW_ID: 'blank-pane', TUIOS_SESSION_ID: 's' });
  await hook('blank-2', { TUIOS_EVENT: 'after-command-finished', TUIOS_COMMAND: 'cd /tmp', TUIOS_EXIT_CODE: '0', TUIOS_WINDOW_ID: 'blank-pane', TUIOS_SESSION_ID: 's' }, { capture: '  \n' });
  const s = await hook('blank-3', { TUIOS_EVENT: 'after-command-finished', TUIOS_COMMAND: '', TUIOS_EXIT_CODE: '0', TUIOS_WINDOW_ID: 'blank-pane', TUIOS_SESSION_ID: 's' }, { capture: 'output with no command' });
  expect(s.items.filter(i => i.agent_id === 'blank-pane').map(i => i.title).sort()).toEqual(['Command finished', 'cd /tmp']);
  expect(s.agents.find(a => a.id === 'blank-pane')).toMatchObject({ kind: 'shell' });
});

test('a blocked agent\'s question is read from its pane and answered only with the prompt id that was shown', async () => {
  await turnHook('question-1', 'pane-asking', 'needs a decision');
  // Stands in for tuios: logs every call, shows one prompt, and refuses the answers a real daemon would.
  const bin = join(home, 'not-installed'), log = join(home, 'tuios-calls.log');
  await Bun.write(bin, `#!/bin/sh
printf '%s\\n' "$*" >> '${log}'
case "$1" in
  peek-prompt) echo '{"found":true,"kind":"question","lines":["Which color?","1. Red","2. Blue"],"options":[{"n":1,"label":"Red"},{"n":2,"label":"Blue"}],"actions":["choose","text"],"prompt_id":"abc123","reason":"","waiting_ms":900}';;
  respond) case "$*" in
    *stale*) echo '{"error":"nothing was pressed: the prompt on the pane is not the one prompt_id names (prompt_changed)","success":false}'; exit 1;;
    *refused*) echo '{"error":"respond is for the person at an attached client (not_human)","success":false}'; exit 1;;
    *) echo '{"action":"choose","sent":"2","prompt_id":"abc123","settled_by":"state","state":"working"}';;
  esac;;
esac
`);
  await chmod(bin, 0o755);
  try {
    const question = await (await call('/agents/pane-asking/question')).json();
    expect(question).toEqual({ found: true, kind: 'question', lines: ['Which color?', '1. Red', '2. Blue'], options: [{ n: 1, label: 'Red' }, { n: 2, label: 'Blue' }], actions: ['choose', 'text'], promptId: 'abc123', reason: '' });
    const answer = body => call('/agents/pane-asking/answer', body);
    const responds = async () => (await Bun.file(log).text()).split('\n').filter(line => line.startsWith('respond '));
    for (const bad of [{ promptId: 'abc123', action: 'press-enter' }, { action: 'choose', value: '2' }, { promptId: 'abc123', action: 'choose', value: 'two' }, { promptId: 'abc123', action: 'text', value: '' }])
      expect((await answer(bad)).status).toBe(400);
    expect(await responds()).toEqual([]);
    expect((await answer({ promptId: 'abc123', action: 'choose', value: '2' })).status).toBe(200);
    expect((await answer({ promptId: 'abc123', action: 'text', value: '--timeout 1' })).status).toBe(200);
    expect(await responds()).toEqual(['respond -s s -w pane-asking --prompt-id abc123 --json -- choose 2', 'respond -s s -w pane-asking --prompt-id abc123 --json -- text --timeout 1']);
    const stale = await answer({ promptId: 'stale', action: 'choose', value: '1' });
    expect(stale.status).toBe(400);
    expect((await stale.json()).error).toContain('prompt_changed');
    const refused = await answer({ promptId: 'refused', action: 'choose', value: '1' });
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toMatch(/not_human[\s\S]*To answer from the browser/);
    expect((await call('/agents/no-such-pane/question')).status).toBe(400);
  } finally { await rm(bin); }
});

test('a turn that ended without a hook report is unread and finished; the hook’s reply then lands on it, not on a second row', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dispatch-ended-')), at = '2026-01-02T00:00:00.000Z';
  const db = new Database(join(dir, 'inbox.sqlite'), { create: true });
  db.exec(`CREATE TABLE turns (id TEXT PRIMARY KEY, session TEXT NOT NULL, pane_id TEXT NOT NULL, pane_name TEXT NOT NULL, harness TEXT NOT NULL, prompt TEXT NOT NULL, response TEXT NOT NULL, source TEXT NOT NULL, state TEXT NOT NULL, unread INTEGER NOT NULL DEFAULT 0, started TEXT NOT NULL, finished TEXT);
    INSERT INTO turns VALUES ('stuck','s','quiet-pane','worker','claude-code','ended without a hook','','','done',0,'${at}',NULL);
    INSERT INTO turns VALUES ('live','s','busy-pane','worker','claude-code','still running','','','working',0,'${at}',NULL);
    INSERT INTO turns VALUES ('historical-empty','s','empty-pane','worker','codex','','','','done',1,'${at}','${at}');
    INSERT INTO turns VALUES ('historical-whitespace','s','space-pane','worker','codex',' \t\u00a0','\n\r ','','idle',1,'${at}','${at}');
    INSERT INTO turns VALUES ('historical-active','s','pending-pane','worker','codex',' \t','','','needs_input',0,'${at}',NULL);
    INSERT INTO turns VALUES ('historical-response','s','answer-pane','worker','codex','','A saved answer','','done',1,'${at}','${at}');`);
  db.close();
  const p = await freePort(), url = `http://127.0.0.1:${p}/api`;
  const json = async (path, body, method = 'POST') => (await fetch(url + path, body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json', 'X-Inbox-Request': '1' }, body: JSON.stringify(body) })).json();
  const proc = await launch(dir, p);
  try {
    const first = await json('/state');
    expect(first.items.find(i => i.title === 'ended without a hook')).toMatchObject({ status: 'done', unread: 1, updated: at });
    expect(first.items.find(i => i.title === 'still running')).toMatchObject({ status: 'working', unread: 0 });
    expect(await json('/turns/stuck')).toMatchObject({ finished: at, response: '' });
    expect(first.items.filter(i => ['empty-pane', 'space-pane', 'pending-pane'].includes(i.agent_id)).map(i => [i.id, i.archived, i.unread]).sort()).toEqual([['turn:historical-active', 1, 0], ['turn:historical-empty', 1, 0], ['turn:historical-whitespace', 1, 0]]);
    expect(await json('/turns/historical-whitespace')).toMatchObject({ prompt: ' \t\u00a0', response: '\n\r ', state: 'idle', finished: at });
    expect(first.items.find(i => i.agent_id === 'answer-pane')).toMatchObject({ archived: 0, unread: 1 });
    await json('/reconcile', {});
    expect(await json('/turns/historical-active')).toMatchObject({ id: 'historical-active', archived: 1, state: 'needs_input', finished: null });
    const reply = { session: 's', pane: 'quiet-pane', name: 'worker', harness: 'claude-code', state: 'done', at: new Date().toISOString(), prompt: 'ended without a hook', response: 'the late reply', source: 'pane' };
    const path = join(dir, 'events', 'late.json');
    await Bun.write(path, JSON.stringify({ id: 'late', time: new Date().toISOString(), values: { TUIOS_EVENT: 'after-agent-state', TUIOS_AGENT_STATE: 'done', TUIOS_WINDOW_ID: 'quiet-pane' }, turn: reply }));
    await json('/reconcile', {});
    for (let i = 0; i < 40 && await Bun.file(path).exists(); i++) await Bun.sleep(100);
    const second = await json('/state');
    expect(second.items.filter(i => i.agent_id === 'quiet-pane')).toHaveLength(1);
    expect(await json('/turns/stuck')).toMatchObject({ response: 'the late reply', unread: 1 });
  } finally { proc.kill(); await proc.exited; await rm(dir, { recursive: true, force: true }); }
});

test('execution host survives host-less sightings and restart; unknown is not local', async () => {
  await hook('host-first', { TUIOS_EVENT: 'after-command-finished', TUIOS_WINDOW_ID: 'hosted-pane', TUIOS_SESSION_ID: 's', TUIOS_HOST: 'build', TUIOS_COMMAND: 'hostname', TUIOS_EXIT_CODE: '0' }, { capture: 'build' });
  let snapshot = await commandHook('host-again', 'hosted-pane', 'pwd');
  expect(snapshot.agents.find(a => a.id === 'hosted-pane').host).toBe('build');
  snapshot = await commandHook('host-unknown', 'unknown-host-pane', 'pwd');
  expect(snapshot.agents.find(a => a.id === 'unknown-host-pane').host).toBe('');
  await stop(); await start();
  snapshot = await state();
  expect(snapshot.agents.find(a => a.id === 'hosted-pane').host).toBe('build');
  expect(snapshot.agents.find(a => a.id === 'unknown-host-pane').host).toBe('');
});
