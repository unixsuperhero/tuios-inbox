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
async function hook(key, values, rest = {}) {
  const path = join(home, 'events', `${key}.json`);
  await Bun.write(path, JSON.stringify({ id: key, time: new Date().toISOString(), values, ...rest }));
  await call('/reconcile', {});
  for (let i = 0; i < 40 && await Bun.file(path).exists(); i++) await Bun.sleep(100);
  expect(await Bun.file(path).exists()).toBe(false);
  return state();
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
  expect(claudeTranscript(lines.slice(0, 5))).toBeNull();
  const omp = [
    { type: 'session' },
    { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'testing' }] } },
    { type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', name: 'bash' }] } },
    { type: 'message', message: { role: 'toolResult', content: [{ type: 'text', text: 'No messages.' }] } },
    { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: "Received. I'm here." }] } },
  ].map(JSON.stringify);
  expect(ompTranscript(omp)).toEqual({ prompt: 'testing', response: "Received. I'm here.", source: 'transcript' });
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
