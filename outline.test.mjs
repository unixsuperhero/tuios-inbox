import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

// An isolated server: its own data directory and port, a TUIOS that only records what it is asked, and a scripted gh.
let child, home, base, repo, plain, log;
const sh = async (cwd, ...argv) => { const p = Bun.spawn(argv, { cwd, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }); const out = await new Response(p.stdout).text(); await p.exited; return out.trim(); };
const call = (path, body, method = 'POST') => fetch(base + '/api' + path, body === undefined && method === 'POST' ? {} : { method, headers: { 'Content-Type': 'application/json', 'X-Inbox-Request': '1' }, body: JSON.stringify(body ?? {}) });
const json = async (...args) => (await call(...args)).json();
const outline = () => json('/outline');
const sent = async () => (await Bun.file(log).text().catch(() => '')).split('\x01').filter(Boolean).map(l => l.split('\0').filter(Boolean));
const stamp = () => new Date().toISOString();
async function hook(key, values, rest = {}) {
  const path = join(home, 'events', key + '.json');
  await Bun.write(path, JSON.stringify({ id: key, time: stamp(), values, ...rest }));
  await call('/reconcile', {});
  for (let i = 0; i < 40 && await Bun.file(path).exists(); i++) await Bun.sleep(100);
  await call('/reconcile', {});
}
// A finished turn on a pane, as capture-hook.mjs reports it. It also makes the pane known and at rest.
const turnDone = (key, pane, prompt, state = 'done') => hook(key, { TUIOS_EVENT: 'after-agent-state', TUIOS_AGENT_STATE: state, TUIOS_WINDOW_ID: pane, TUIOS_SESSION_ID: 's' },
  { turn: { session: 's', pane, name: pane, harness: 'omp', state, at: stamp(), prompt, response: `reply to ${prompt}`, source: 'pane' } });
async function pane(name, taskId) { await turnDone('seed-' + name, name, 'earlier'); await call('/agents/update', { ids: [name], set: { task_id: taskId } }); await Bun.sleep(5); return name; }
const promptOf = async key => (await outline()).prompts.find(p => p.id === key);

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'outline-test-'));
  repo = join(home, 'repo'); plain = join(home, 'plain'); log = join(home, 'calls.log');
  await mkdir(repo); await mkdir(plain);
  await sh(repo, 'git', 'init', '-q', '-b', 'main'); await Bun.write(join(repo, 'a.txt'), 'a'); await sh(repo, 'git', 'add', '.'); await sh(repo, 'git', 'commit', '-q', '-m', 'first');
  const fake = join(home, 'tuios'), gh = join(home, 'gh');
  await Bun.write(fake, `#!/bin/sh\nprintf '%s\\0' "$@" "$(printf '\\001')" >> '${log}'\ncase "$1" in start-agent) echo '{"window_id":"launched-1","ready":true}';; *) echo '{}';; esac\n`);
  await Bun.write(gh, `#!/bin/sh\ncase "$3" in main) echo '{"number":42,"state":"OPEN","url":"https://example.test/pr/42","statusCheckRollup":[{"status":"COMPLETED","conclusion":"FAILURE"}]}';; nopr) echo 'no pull requests found for branch "nopr"' >&2; exit 1;; *) echo 'could not connect' >&2; exit 1;; esac\n`);
  await chmod(fake, 0o755); await chmod(gh, 0o755);
  const socket = createServer(); await new Promise(r => socket.listen(0, '127.0.0.1', r));
  const port = socket.address().port; await new Promise(r => socket.close(r));
  base = `http://127.0.0.1:${port}`;
  child = Bun.spawn([process.execPath, 'server.mjs'], { cwd: import.meta.dir, stdout: 'pipe', stderr: 'inherit',
    env: { ...process.env, PORT: String(port), TUIOS_INBOX_DATA: home, TUIOS_INBOX_SPOOL: join(home, 'events'), TUIOS_BIN: fake, TUIOS_INBOX_GH: gh, TUIOS_INBOX_COLLECTORS: join(home, 'none.json'), PI_CODING_AGENT_DIR: join(home, 'omp') } });
  const reader = child.stdout.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('listening on');
  reader.releaseLock();
});
afterAll(async () => { if (child) { child.kill(); await child.exited; } if (home) await rm(home, { recursive: true, force: true }); });

test('the outline modules are served', async () => {
  const res = await fetch(base + '/outline-model.js');
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('export function resolve');
});

test('a prompt is saved without a task, without text, and without anywhere to run', async () => {
  const saved = await call('/prompts', { body: 'what does settle_seconds default to?' });
  expect(saved.status).toBe(201);
  const { prompt, ran, preflight } = await saved.json();
  expect(prompt).toMatchObject({ body: 'what does settle_seconds default to?', task_id: null, target: '', state: 'queued', error: '' });
  expect(ran).toBe(false);
  expect(preflight.blocks.map(b => b.code)).toEqual(['nowhere']);
  expect(prompt.resolved.harness).toEqual({ value: 'omp', from: 'default' });
  const empty = await call('/prompts', {});
  expect(empty.status).toBe(201);
  expect((await empty.json()).preflight.blocks.map(b => b.code)).toContain('no_text');
  const o = await outline();
  expect(o.defaults).toEqual({ harness: 'omp', queue_mode: 'manual' });
  expect(o.prompts.map(p => p.id)).toContain(prompt.id);
  expect((await call(`/prompts/${prompt.id}`, undefined, 'DELETE')).status).toBe(200);
  expect((await outline()).prompts.map(p => p.id)).not.toContain(prompt.id);
});

test('a blocked run answers 409, keeps the prompt as blocked, and can be queued again', async () => {
  const { prompt } = await json('/prompts', { body: 'orphan' });
  const res = await call(`/prompts/${prompt.id}/run`, {});
  expect(res.status).toBe(409);
  const refused = await res.json();
  expect(refused.error).toContain('Nowhere to run');
  expect(refused.preflight.blocks[0]).toMatchObject({ code: 'nowhere', fix: 'repo' });
  expect(await promptOf(prompt.id)).toMatchObject({ state: 'blocked' });
  expect(await json(`/prompts/${prompt.id}`, { state: 'queued', body: 'orphan, edited' }, 'PATCH')).toMatchObject({ state: 'queued', body: 'orphan, edited', error: '' });
  const now = await json('/prompts', { body: 'run me', target: 'no-such-pane', run: true });
  expect(now).toMatchObject({ ran: false, prompt: { state: 'blocked' } });
  expect(now.preflight.blocks.map(b => b.code)).toEqual(['pane_gone']);
  expect((await call('/tasks/none/run-next', {})).status).toBe(409);
  expect(await sent()).toEqual((await sent()).filter(a => a[0] !== 'queue'));
});

test('task facts are set by alias, inherited by lookup, and cleared back to inherit', async () => {
  const parent = await json('/tasks', { title: 'Fix parser', repo, branch: 'main', harness: 'omp', model: 'gpt-x', queue_mode: 'auto' });
  const kid = await json('/tasks', { title: 'Tokenizer', parent_id: parent.id });
  expect((await call('/tasks', { title: 'Bad', queue_mode: 'sometimes' })).status).toBe(400);
  let o = await outline(), p = o.tasks.find(t => t.id === parent.id), k = o.tasks.find(t => t.id === kid.id);
  expect(p.own).toMatchObject({ branch: 'main', harness: 'omp', model: 'gpt-x', queue_mode: 'auto', session: '', workspace: null });
  expect(p.own.repo.endsWith('/repo')).toBe(true);
  expect(k.own).toMatchObject({ repo: '', branch: '', queue_mode: '' });
  expect(k.resolved.repo).toEqual({ value: p.own.repo, from: parent.id });
  expect(k.resolved.queue_mode).toEqual({ value: 'auto', from: parent.id });
  expect(k.git).toMatchObject({ state: 'ok', head: 'main', dirty: false });
  expect(k.git.commits.map(c => c.subject)).toEqual(['first']);
  await call(`/tasks/${kid.id}`, { queue_mode: 'manual', model: 'other' }, 'PATCH');
  await call(`/tasks/${parent.id}`, { model: null }, 'PATCH');
  o = await outline(); k = o.tasks.find(t => t.id === kid.id);
  expect(k.resolved.queue_mode).toEqual({ value: 'manual', from: 'self' });
  expect(o.tasks.find(t => t.id === parent.id).resolved.model).toEqual({ value: null, from: 'none' });
  await call(`/tasks/${kid.id}`, { parent_id: null }, 'PATCH');
  expect((await outline()).tasks.find(t => t.id === kid.id).resolved.repo.from).toBe('none');
});

test('git facts name a pull request, its absence, and an unreachable service without failing', async () => {
  const withPr = await json('/tasks', { title: 'Has PR', repo, branch: 'main' });
  const git = await json('/git/refresh', { task_id: withPr.id });
  expect(git).toMatchObject({ state: 'ok', head: 'main', pr_state: 'ok', pr: { number: 42, state: 'open', checks: 'failing' } });
  const { prompt } = await json('/prompts', { body: 'x', task_id: withPr.id });
  expect(prompt.preflight.warns.map(w => w.code)).toEqual(['checks_failing']);
  expect(await json('/git/refresh', { task_id: (await json('/tasks', { title: 'No PR', repo, branch: 'nopr' })).id })).toMatchObject({ state: 'ok', pr: null, pr_state: 'none' });
  expect(await json('/git/refresh', { task_id: (await json('/tasks', { title: 'Down', repo, branch: 'elsewhere' })).id })).toMatchObject({ state: 'ok', pr: null, pr_state: 'unavailable' });
  expect(await json('/git/refresh', { task_id: (await json('/tasks', { title: 'Plain', repo: plain })).id })).toMatchObject({ state: 'not_a_repo', pr_state: 'none' });
  expect(await json('/git/refresh', { task_id: (await json('/tasks', { title: 'Bare' })).id })).toMatchObject({ state: 'none' });
  await call(`/prompts/${prompt.id}`, undefined, 'DELETE');
});

test('a run goes to a ready pane, is linked to the next turn there, and records its commits', async () => {
  const task = await json('/tasks', { title: 'Runs', repo });
  const a = await pane('pane-run', task.id);
  const o = await outline();
  expect(o.panes.find(p => p.id === a)).toMatchObject({ task_id: task.id, kind: 'agent', ready: true });
  // Typed at a pane: the prompt lands in the pane's task.
  const made = await json('/prompts', { body: 'add a file', target: a, run: true });
  expect(made).toMatchObject({ ran: true, prompt: { task_id: task.id, state: 'running', pane_id: a } });
  expect((await sent()).find(c => c[0] === 'queue' && c.includes(a)).at(-1)).toBe('add a file');
  expect((await call(`/prompts/${made.prompt.id}/run`, {})).status).toBe(409);
  expect((await outline()).panes.find(p => p.id === a).ready).toBe(false);
  await Bun.write(join(repo, 'b.txt'), 'b'); await sh(repo, 'git', 'add', '.'); await sh(repo, 'git', 'commit', '-q', '-m', 'add b');
  await turnDone('run-1', a, 'add a file');
  const after = await outline(), runs = after.runs.filter(r => r.prompt_id === made.prompt.id);
  expect(after.prompts.find(p => p.id === made.prompt.id)).toMatchObject({ state: 'done' });
  expect(runs).toHaveLength(1);
  expect(runs[0]).toMatchObject({ pane_id: a, task_id: task.id, state: 'done', response_captured: true, harness: 'omp' });
  expect(runs[0].commits.map(c => c.subject)).toEqual(['add b']);
  // The turn that was there before the run stays a run of no prompt.
  expect(after.runs.find(r => r.pane_id === a && r.prompt_id === null)).toBeTruthy();
  const turn = await (await call('/turns/' + runs[0].id.slice(5))).json();
  expect(turn.head_before).not.toBe(turn.head_after);
  // A reply is a new prompt on the same pane; an errored run marks its prompt errored.
  const reply = await json('/prompts', { body: 'again', task_id: task.id, target: a, run: true });
  expect(reply.ran).toBe(true);
  await turnDone('run-2', a, 'again', 'errored');
  expect(await promptOf(reply.prompt.id)).toMatchObject({ state: 'errored' });
});

test('a pane on its own question is never typed at', async () => {
  const task = await json('/tasks', { title: 'Asking' });
  const a = await pane('pane-ask', task.id);
  await hook('ask-1', { TUIOS_EVENT: 'after-agent-state', TUIOS_AGENT_STATE: 'needs_input', TUIOS_WINDOW_ID: a, TUIOS_SESSION_ID: 's' });
  const made = await json('/prompts', { body: 'yes', target: a, run: true });
  expect(made).toMatchObject({ ran: false, prompt: { state: 'blocked' } });
  expect(made.preflight.blocks.map(b => b.code)).toEqual(['pane_blocked']);
  expect((await sent()).some(c => c[0] === 'queue' && c.includes(a))).toBe(false);
});

test('queues run lowest position first; an automatic queue advances when its pane rests and holds at a block', async () => {
  const task = await json('/tasks', { title: 'Queue', queue_mode: 'auto' });
  const a = await pane('pane-queue', task.id);
  const ids = [];
  for (const body of ['one', 'two', 'three']) ids.push((await json('/prompts', { body, task_id: task.id })).prompt.id);
  const blocked = (await json('/prompts', { body: 'four', task_id: task.id, target: 'gone-pane' })).prompt.id;
  const last = (await json('/prompts', { body: 'five', task_id: task.id })).prompt.id;
  // Saving never runs, even in an automatic queue with a pane at rest.
  expect((await sent()).some(c => c[0] === 'queue' && c.includes(a))).toBe(false);
  await call(`/prompts/${ids[2]}/move`, { before: ids[0] });
  const order = (await outline()).prompts.filter(p => p.task_id === task.id).map(p => p.body);
  expect(order).toEqual(['three', 'one', 'two', 'four', 'five']);
  const first = await call(`/tasks/${task.id}/run-next`, {});
  expect(first.status).toBe(202);
  expect((await first.json()).prompt).toMatchObject({ id: ids[2], state: 'running' });
  const bodies = async () => (await sent()).filter(c => c[0] === 'queue' && c.includes(a)).map(c => c.at(-1));
  expect(await bodies()).toEqual(['three']);
  await turnDone('q-1', a, 'three');
  expect(await bodies()).toEqual(['three', 'one']);
  await turnDone('q-2', a, 'one');
  expect(await bodies()).toEqual(['three', 'one', 'two']);
  await turnDone('q-3', a, 'two');
  // "four" names a pane that is gone: it becomes blocked and "five" waits behind it.
  await turnDone('q-4', a, 'typed by hand');
  expect(await bodies()).toEqual(['three', 'one', 'two']);
  const state = Object.fromEntries((await outline()).prompts.filter(p => p.task_id === task.id).map(p => [p.body, p.state]));
  expect(state).toEqual({ three: 'done', one: 'done', two: 'done', four: 'blocked', five: 'queued' });
  // Moving a prompt to another queue takes it out of this one.
  expect(await json(`/prompts/${last}/move`, { task_id: null })).toMatchObject({ task_id: null });
  await call(`/prompts/${blocked}`, undefined, 'DELETE'); await call(`/prompts/${last}`, undefined, 'DELETE');
});

test('with no pane at rest a run launches an agent in the repo and sends there', async () => {
  const task = await json('/tasks', { title: 'Launch', repo, model: 'gpt-x' });
  const { prompt } = await json('/prompts', { body: 'start here', task_id: task.id });
  expect(prompt.preflight.blocks).toEqual([]);
  expect((await call(`/prompts/${prompt.id}/run`, {})).status).toBe(202);
  let calls = [];
  for (let i = 0; i < 50 && !calls.some(c => c[0] === 'queue' && c.includes('launched-1')); i++) { await Bun.sleep(100); calls = await sent(); }
  const start = calls.find(c => c[0] === 'start-agent');
  expect(start[start.indexOf('--cwd') + 1].endsWith('/repo')).toBe(true);
  expect(start.includes('omp')).toBe(true);
  expect(start.slice(-3)).toEqual(['--', '--model', 'gpt-x']);
  expect(calls.find(c => c[0] === 'queue' && c.includes('launched-1')).at(-1)).toBe('start here');
  expect(await promptOf(prompt.id)).toMatchObject({ state: 'running', pane_id: 'launched-1' });
  expect((await outline()).panes.find(p => p.id === 'launched-1')).toMatchObject({ task_id: task.id, ready: false });
});

test('the outline lists every unread or waiting run, however old, beside the newest ones, each once', async () => {
  // Its own server with a window of two runs, so four turns are enough to fall outside it.
  const main = { home, base }, data = await mkdtemp(join(tmpdir(), 'outline-old-'));
  const socket = createServer(); await new Promise(r => socket.listen(0, '127.0.0.1', r));
  const port = socket.address().port; await new Promise(r => socket.close(r));
  const second = Bun.spawn([process.execPath, 'server.mjs'], { cwd: import.meta.dir, stdout: 'pipe', stderr: 'inherit',
    env: { ...process.env, PORT: String(port), TUIOS_INBOX_OUTLINE_RUNS: '2', TUIOS_INBOX_DATA: data, TUIOS_INBOX_SPOOL: join(data, 'events'), TUIOS_BIN: join(main.home, 'tuios'), TUIOS_INBOX_GH: join(main.home, 'gh'), TUIOS_INBOX_COLLECTORS: join(data, 'none.json'), PI_CODING_AGENT_DIR: join(data, 'omp') } });
  try {
    const reader = second.stdout.getReader(); expect(new TextDecoder().decode((await reader.read()).value)).toContain('listening on'); reader.releaseLock();
    home = data; base = `http://127.0.0.1:${port}`;
    for (const name of ['old-unread', 'old-read', 'new-a', 'new-b']) { await turnDone('t-' + name, 'pane-' + name, 'ask ' + name); await Bun.sleep(15); }
    const byPrompt = async () => new Map((await outline()).runs.map(r => [r.prompt, r]));
    const before = await byPrompt();
    expect([...before.keys()].sort()).toEqual(['ask new-a', 'ask new-b', 'ask old-read', 'ask old-unread']);
    expect((await call('/turns/' + encodeURIComponent(before.get('ask old-read').id.replace(/^turn:/, '')), { unread: false }, 'PATCH')).status).toBe(200);
    const o = await outline(), prompts = o.runs.map(r => r.prompt);
    expect(prompts).toEqual(['ask new-b', 'ask new-a', 'ask old-unread']);
    expect(new Set(o.runs.map(r => r.id)).size).toBe(o.runs.length);
    expect(o.runs.find(r => r.prompt === 'ask old-unread')).toMatchObject({ unread: true, archived: false });
    expect(Object.keys(o).sort()).toEqual(['defaults', 'panes', 'profiles', 'prompts', 'runs', 'tasks']);
  } finally { ({ home, base } = main); second.kill(); await second.exited; await rm(data, { recursive: true, force: true }); }
});

test('deleting a task moves its subtasks up a level and its prompts and runs to No task', async () => {
  const top = await json('/tasks', { title: 'delete-top' }), mid = await json('/tasks', { title: 'delete-mid', parent_id: top.id }), leaf = await json('/tasks', { title: 'delete-leaf', parent_id: mid.id });
  const { prompt } = await json('/prompts', { body: 'kept after delete', task_id: mid.id });
  const name = await pane('delete-pane', mid.id);
  expect((await call('/tasks/' + mid.id, {}, 'DELETE')).status).toBe(200);
  const o = await outline();
  expect(o.tasks.some(t => t.id === mid.id)).toBe(false);
  expect(o.tasks.find(t => t.id === leaf.id).parent_id).toBe(top.id);
  expect(o.prompts.find(p => p.id === prompt.id).task_id).toBe(null);
  expect(o.panes.find(p => p.id === name).task_id).toBe(null);
  expect((await call('/tasks/' + mid.id, {}, 'DELETE')).status).toBeGreaterThanOrEqual(400);
});

test('a prompt that was sent does not report its own busy pane as a block', async () => {
  const task = await json('/tasks', { title: 'Replies', repo });
  const a = await pane('pane-reply', task.id);
  const made = await json('/prompts', { body: 'reply one', target: a, run: true });
  expect(made).toMatchObject({ ran: true, prompt: { state: 'running', pane_id: a, preflight: { blocks: [] } }, preflight: { blocks: [] } });
  expect((await outline()).panes.find(p => p.id === a).ready).toBe(false);
  expect((await promptOf(made.prompt.id)).preflight.blocks).toEqual([]);
  const again = await call(`/prompts/${made.prompt.id}/run`, {});
  expect(again.status).toBe(409);
  expect((await again.json()).preflight.blocks).toEqual([]);
  // The pane is still busy for every other prompt.
  const next = await json('/prompts', { body: 'reply two', target: a });
  expect(next.preflight.blocks.map(b => b.code)).toEqual(['pane_blocked']);
  // Done, the prompt stays clean while its pane works on something else, but running it again is checked in full.
  await turnDone('reply-1', a, 'reply one');
  const other = await json('/prompts', { body: 'reply three', target: a, run: true });
  expect(other).toMatchObject({ ran: true, preflight: { blocks: [] } });
  expect(await promptOf(made.prompt.id)).toMatchObject({ state: 'done', preflight: { blocks: [] } });
  const rerun = await call(`/prompts/${made.prompt.id}/run`, {});
  expect(rerun.status).toBe(409);
  expect((await rerun.json()).preflight.blocks.map(b => b.code)).toEqual(['pane_blocked']);
});

test('the outline lists the documents a run reported, without carrying its response', async () => {
  await hook('doc-turn', { TUIOS_EVENT: 'after-agent-state', TUIOS_AGENT_STATE: 'done', TUIOS_WINDOW_ID: 'doc-pane', TUIOS_SESSION_ID: 's' },
    { turn: { session: 's', pane: 'doc-pane', name: 'doc-pane', harness: 'omp', state: 'done', at: stamp(), prompt: 'write the guide', source: 'pane',
      response: 'Saved [guide.md](/Users/x/docs/guide.md), opened with mdoc: [the guide](http://127.0.0.1:4387/items/12). See also [code](src/a.js).' } });
  const runs = (await outline()).runs, run = runs.find(r => r.pane_id === 'doc-pane');
  expect(run.docs).toEqual([{ kind: 'file', href: '/Users/x/docs/guide.md', title: 'guide.md' }, { kind: 'mdoc', href: 'http://127.0.0.1:4387/items/12', title: 'the guide' }]);
  expect(run).not.toHaveProperty('response'); expect(run).not.toHaveProperty('doc_text');
  expect(runs.filter(r => r.pane_id !== 'doc-pane').every(r => Array.isArray(r.docs) && !r.docs.length)).toBe(true);
});

test('a turn left open is settled from its pane: closed when the pane is gone or at rest, kept while it still works', async () => {
  // Its own server and a TUIOS that lists two windows: one working, one at rest. The third pane no longer exists.
  const main = { home, base }, data = await mkdtemp(join(tmpdir(), 'outline-settle-')), fake = join(data, 'tuios');
  await Bun.write(fake, `#!/bin/sh\ncase "$1" in list-windows) echo '{"windows":[{"window_id":"live","agent_state":{"state":"working"}},{"window_id":"rest","agent_state":"idle"}]}';; *) echo '{}';; esac\n`);
  await chmod(fake, 0o755);
  const socket = createServer(); await new Promise(r => socket.listen(0, '127.0.0.1', r));
  const port = socket.address().port; await new Promise(r => socket.close(r));
  const second = Bun.spawn([process.execPath, 'server.mjs'], { cwd: import.meta.dir, stdout: 'pipe', stderr: 'inherit',
    env: { ...process.env, PORT: String(port), TUIOS_INBOX_DATA: data, TUIOS_INBOX_SPOOL: join(data, 'events'), TUIOS_BIN: fake, TUIOS_INBOX_GH: join(main.home, 'gh'), TUIOS_INBOX_COLLECTORS: join(data, 'none.json'), PI_CODING_AGENT_DIR: join(data, 'omp') } });
  try {
    const reader = second.stdout.getReader(); expect(new TextDecoder().decode((await reader.read()).value)).toContain('listening on'); reader.releaseLock();
    home = data; base = `http://127.0.0.1:${port}`;
    for (const name of ['live', 'rest', 'gone']) await hook('open-' + name, { TUIOS_EVENT: 'after-agent-state', TUIOS_AGENT_STATE: 'working', TUIOS_WINDOW_ID: name, TUIOS_SESSION_ID: 's' },
      { turn: { session: 's', pane: name, name, harness: 'omp', state: 'working', at: stamp(), prompt: 'ask ' + name, response: '', source: 'pane' } });
    const runs = new Map((await outline()).runs.map(r => [r.prompt, r]));
    expect(runs.get('ask live')).toMatchObject({ state: 'working', finished: null });
    expect(runs.get('ask rest')).toMatchObject({ state: 'idle', unread: false });
    expect(runs.get('ask gone')).toMatchObject({ state: 'ended', unread: false });
    for (const name of ['rest', 'gone']) expect(Date.parse(runs.get('ask ' + name).finished)).toBeGreaterThan(0);
    // Settling again changes nothing, and the pane that is gone is known as closed.
    await call('/reconcile', {});
    const again = await outline();
    expect(again.runs.filter(r => r.state === 'working').map(r => r.prompt)).toEqual(['ask live']);
    expect(again.runs.find(r => r.prompt === 'ask gone').finished).toBe(runs.get('ask gone').finished);
  } finally { ({ home, base } = main); second.kill(); await second.exited; await rm(data, { recursive: true, force: true }); }
});
