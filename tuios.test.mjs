import { expect, test } from 'bun:test';
import { access, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';

const binary = process.env.TUIOS_BIN || '/opt/homebrew/bin/tuios';
const available = await access(binary, constants.X_OK).then(() => true, () => false);
const nativeTest = available ? test : test.skip;

async function freePort() {
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const { port } = socket.address();
  await new Promise(resolve => socket.close(resolve));
  return port;
}

async function until(read, ready, label, timeout = 15000) {
  const end = Date.now() + timeout;
  let value, error;
  do {
    try { value = await read(); if (ready(value)) return value; } catch (e) { error = e; }
    await Bun.sleep(40);
  } while (Date.now() < end);
  throw new Error(`${label}: ${error?.message || JSON.stringify(value)}`);
}

async function stop(process) {
  if (!process || process.exitCode !== null) return;
  process.kill('SIGTERM');
  await Promise.race([process.exited, Bun.sleep(5000)]);
  if (process.exitCode === null) { process.kill('SIGKILL'); await process.exited; }
}

// The short, unique /tmp root also keeps macOS UNIX socket paths below their limit.
// Mirrors tuios/e2e/control_plane_test.go, but drops every inherited pane auth variable.
async function fixture(run) {
  const root = await mkdtemp('/tmp/ti-');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('TUIOS_') && !key.startsWith('XDG_')));
  for (const [key, name] of Object.entries({ XDG_RUNTIME_DIR: 'run', XDG_STATE_HOME: 'state', XDG_CONFIG_HOME: 'config', XDG_CACHE_HOME: 'cache', XDG_DATA_HOME: 'data' })) {
    env[key] = join(root, name);
    await mkdir(env[key], { mode: 0o700 });
  }
  Object.assign(env, { HOME: root, SHELL: '/bin/sh', TERM: 'xterm-256color', TUIOS_BIN: binary, TUIOS_INBOX_DATA: join(root, 'inbox'), TUIOS_INBOX_SPOOL: join(root, 'spool') });
  await mkdir(join(env.XDG_CONFIG_HOME, 'tuios'));
  await Bun.write(join(env.XDG_CONFIG_HOME, 'tuios', 'config.toml'), '');
  await mkdir(env.TUIOS_INBOX_DATA, { mode: 0o700 });
  const socket = join(env.XDG_RUNTIME_DIR, 'tuios', 'tuios.sock');
  let daemon, server;
  const logs = [];
  async function cli(...args) {
    const child = Bun.spawn([binary, ...args], { env, cwd: root, stdout: 'pipe', stderr: 'pipe' });
    const timer = setTimeout(() => child.kill(), 15000);
    try {
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      if (code !== 0) throw new Error(`tuios ${args.join(' ')} (${code}): ${stderr || stdout}`);
      return stdout;
    } finally { clearTimeout(timer); }
  }
  const native = async (...args) => JSON.parse(await cli(...args, '--json'));
  try {
    daemon = Bun.spawn([binary, 'daemon', '--no-restore'], { env, cwd: root, stdout: 'pipe', stderr: 'pipe' });
    logs.push(new Response(daemon.stdout).text(), new Response(daemon.stderr).text());
    await until(() => native('ls'), Array.isArray, 'private daemon readiness');
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    server = Bun.spawn([process.execPath, 'server.mjs'], { cwd: import.meta.dir, env: { ...env, PORT: String(port) }, stdout: 'pipe', stderr: 'pipe' });
    logs.push(new Response(server.stdout).text(), new Response(server.stderr).text());
    const request = (path, body, headers = {}, method = 'POST') => fetch(base + '/api' + path, body === undefined ? { headers } : { method, headers: { 'Content-Type': 'application/json', 'X-Inbox-Request': '1', ...headers }, body: JSON.stringify(body) });
    async function json(path, body, status = 200, method = 'POST') {
      const response = await request(path, body, {}, method);
      const value = await response.json();
      expect({ status: response.status, ...(response.status === status ? {} : { error: value }) }).toEqual({ status });
      return value;
    }
    const state = () => json('/state');
    await until(state, value => Array.isArray(value.tasks), 'private app readiness');
    const action = (action, values = {}, status = action === 'create-session' ? 201 : 200) => json('/tuios/action', { action, ...(['create-session','create-window','create-agent'].includes(action) ? { host: 'local' } : {}), ...values }, status);
    const hierarchy = session => json('/tuios' + (session ? `?session=${encodeURIComponent(session)}` : ''));
    const detail = (session, window) => json(`/tuios/window?session=${encodeURIComponent(session)}&window=${encodeURIComponent(window)}`);
    const windows = session => native('list-windows', '-s', session);
    const window = (session, id) => native('get-window', '-s', session, id);
    const create = async (session, workspace, name) => {
      const pane = (await action('create-window', { session, workspace, name, host: 'local', paths_host: 'local', cwd: root })).window_id;
      await cli('send-text','-s',session,'-w',pane,"printf '\\033]133;A\\007'\n");
      return pane;
    };
    const task = title => json('/tasks', { title, path: root, host: 'local', paths_host: 'local' }, 201);
    async function shell(task, name) {
      const pane = await json(`/tasks/${task.id}/panes`, { kind: 'shell', name, host: 'local' }, 201);
      await until(() => window(task.session, pane.id), pane => pane.at_prompt, 'task shell readiness');
      return pane;
    }
    async function compose(task, pane, text, subject) {
      const { threadId } = await json(`/tasks/${task.id}/compose`, { paneId: pane.id, body: text, subject }, 202);
      const thread = await until(() => json(`/threads/${threadId}`), thread => thread.messages.some(message => message.role === 'shell' && message.status !== 'running'), 'shell execution completion');
      expect(thread.messages.find(message => message.role === 'shell')).toMatchObject({ status: 'complete', meta: { exit_code: 0 } });
      return thread;
    }
    await run({ root, env, base, cli, native, request, json, state, action, hierarchy, detail, windows, window, create, task, shell, compose });
  } finally {
    await stop(server);
    if (daemon?.exitCode === null) { try { await cli('kill-server'); } catch {} }
    await stop(daemon);
    await until(() => access(socket).then(() => false, () => true), gone => gone, 'private daemon socket removal');
    const output = (await Promise.all(logs)).join('\n');
    await rm(root, { recursive: true, force: true });
    if (server && server.exitCode !== 0 && server.exitCode !== 143 && server.signalCode !== 'SIGTERM' && server.signalCode !== 'SIGKILL') console.error(output);
  }
}

nativeTest('launch-only directory overrides use selected machine without rewriting task paths', async () => fixture(async f => {
  const foreign = await f.json('/tasks', { title: 'Remote-owned project', path: '/remote-only/project 日本 ', host: 'build', paths_host: 'build' }, 201);
  const blocked = await f.request('/tasks/' + foreign.id + '/panes', { kind: 'shell', name: 'foreign-context', host: 'local' });
  expect(blocked.status).toBe(400);
  expect((await blocked.json()).error).toContain('Saved task directories belong to build');
  const stale = await f.request('/tasks/' + foreign.id + '/panes', { kind: 'shell', name: 'stale-picker', host: 'local', cwd: f.root, paths_host: 'build' });
  expect(stale.status).toBe(400);
  const chosen = await f.json('/filesystem/select', { host: 'local', path: f.root, kind: 'directory' });
  expect(chosen).toEqual({ host: 'local', path: f.root });
  const pane = await f.json('/tasks/' + foreign.id + '/panes', { kind: 'shell', name: 'override-project', host: chosen.host, cwd: chosen.path, paths_host: chosen.host }, 201);
  await until(() => f.window(foreign.session, pane.id), pane => pane.at_prompt, 'override shell readiness');
  const result = await f.compose(foreign, pane, 'printf "LAUNCH_OVERRIDE=%s\\n" "$PWD"', 'check chosen directory');
  expect(result.messages.find(m => m.role === 'shell').body).toContain('LAUNCH_OVERRIDE=' + await realpath(f.root));
  expect((await f.state()).tasks.find(t => t.id === foreign.id)).toMatchObject({ host: 'build', path: '/remote-only/project 日本 ', paths_host: 'build' });
  expect((await f.state()).agents.find(a => a.id === pane.id)).toMatchObject({ host: 'local', launch_cwd: f.root });
}), 60000);


nativeTest('native hierarchy identifies session, workspace, pane and agent without moving terminal focus', async () => fixture(async f => {
  await f.action('create-session', { name: 'hierarchy' });
  await f.action('create-session', { name: 'hierarchy-extra' });
  expect((await f.windows('hierarchy')).windows).toEqual([]);
  const anchor = await f.create('hierarchy', 1, 'anchor');
  await f.cli('focus-window', anchor, '-s', 'hierarchy');
  const initial = await f.windows('hierarchy');
  const pane = await f.create('hierarchy', 2, 'review');
  await f.cli('set-agent-state', 'needs_input', '-s', 'hierarchy', '-w', pane, '--harness', 'codex', '-m', 'Review permission needed');
  const listed = await f.hierarchy();
  expect(listed.sessions.filter(s => s.name.startsWith('hierarchy')).map(s => [s.name, s.target, s.host, s.attached]).sort()).toEqual([
    ['hierarchy', 'hierarchy', 'local', false], ['hierarchy-extra', 'hierarchy-extra', 'local', false],
  ]);
  expect(listed.hosts.find(host => host.host === 'local').status).toBe('up');
  const tree = await f.hierarchy('hierarchy');
  expect(tree.session).toMatchObject({ name: 'hierarchy', target: 'hierarchy', host: 'local' });
  expect(tree.workspaces.find(w => w.workspace === 2)).toMatchObject({ workspace: 2, window_count: 1, current: false });
  expect(tree.windows.find(w => w.window_id === pane)).toMatchObject({ window_id: pane, display_name: 'review', workspace: 2, focused: false });
  expect(tree.agents.find(a => a.window_id === pane)).toMatchObject({ window_id: pane, name: 'review', workspace: 2, harness_id: 'codex', state: 'needs_input', message: 'Review permission needed' });
  const inspect = await f.detail('hierarchy', pane);
  expect(inspect.window).toMatchObject({ window_id: pane, workspace: 2, display_name: 'review' });
  expect(inspect.agent).toMatchObject({ window_id: pane, state: 'needs_input', message: 'Review permission needed' });
  await f.hierarchy('hierarchy-extra');
  expect(await f.windows('hierarchy')).toMatchObject({ current_workspace: 1, focused_window_id: initial.focused_window_id });
  const task = await f.task('Native review group');
  await f.action('assign-task', { session: 'hierarchy', window: pane, taskId: task.id });
  expect((await f.state()).agents.find(a => a.id === pane)).toMatchObject({ id: pane, session: 'hierarchy', task_id: task.id, harness: 'codex', kind: 'agent' });
  expect((await f.native('get-agent-state', '-s', 'hierarchy', '-w', pane))).toMatchObject({ window_id: pane, harness_id: 'codex', state: 'needs_input' });
}), 60000);

nativeTest('pane management preserves UUID and no-focus intent; exact confirmed close spares similarly named panes', async () => fixture(async f => {
  await f.action('create-session', { name: 'manage' });
  const anchor = await f.create('manage', 1, 'anchor');
  await f.cli('focus-window', anchor, '-s', 'manage');
  const initial = await f.windows('manage');
  const pane = await f.create('manage', 2, 'build');
  const other = await f.create('manage', 2, 'build-extra');
  expect(await f.windows('manage')).toMatchObject({ current_workspace: 1, focused_window_id: initial.focused_window_id });
  await f.action('name-workspace', { session: 'manage', workspace: 2, name: 'Review <&>' });
  await f.action('rename-window', { session: 'manage', window: pane, name: 'build-renamed' });
  expect((await f.native('list-workspaces', '-s', 'manage')).workspaces.find(w => w.workspace === 2)).toMatchObject({ name: 'Review <&>', current: false });
  await f.action('move-window', { session: 'manage', window: pane, workspace: 3 });
  expect(await f.window('manage', pane)).toMatchObject({ window_id: pane, display_name: 'build-renamed', workspace: 3, focused: false });
  expect(await f.windows('manage')).toMatchObject({ current_workspace: 1, focused_window_id: initial.focused_window_id });
  await f.action('minimize-window', { session: 'manage', window: pane });
  expect(await f.window('manage', pane)).toMatchObject({ window_id: pane, minimized: true });
  await f.action('restore-window', { session: 'manage', window: pane });
  expect(await f.window('manage', pane)).toMatchObject({ window_id: pane, minimized: false, workspace: 3 });
  await f.action('rename-window', { session: 'manage', window: pane, name: '--workspace=9' });
  await f.action('name-workspace', { session: 'manage', workspace: 2, name: '--workspace=9' });
  expect(await f.window('manage', pane)).toMatchObject({ window_id: pane, display_name: '--workspace=9', workspace: 3 });
  expect((await f.native('list-workspaces', '-s', 'manage')).workspaces.find(w => w.workspace === 2)).toMatchObject({ workspace: 2, name: '--workspace=9' });
  await f.action('close-window', { session: 'manage', window: pane, confirmed: true });
  expect((await f.windows('manage')).windows.map(w => w.window_id).sort()).toEqual([initial.focused_window_id, other].sort());
  expect(await f.window('manage', other)).toMatchObject({ window_id: other, display_name: 'build-extra', workspace: 2 });
}), 60000);

nativeTest('confirmation, invalid targets and cross-origin refusals leave real panes unchanged', async () => fixture(async f => {
  await f.action('create-session', { name: 'refuse' });
  const pane = await f.create('refuse', 2, 'guarded');
  const before = await f.windows('refuse');
  const shellBefore = await until(() => f.window('refuse', pane), window => window.at_prompt, 'native shell readiness');
  const invalid = [
    { action: 'close-window', window: pane }, { action: 'interrupt-window', window: pane },
    { action: 'close-workspace', workspace: 2 }, { action: 'kill-session' },
    { action: 'close-window', window: 'guarded', confirmed: true },
    { action: 'move-window', window: pane, workspace: 0 }, { action: 'move-window', window: pane, workspace: 10 },
    { action: 'move-window', window: pane, workspace: '2; kill-server' },
    { action: 'create-window', workspace: 10, name: 'invalid' },
    { action: 'shell-command', command: 'kill-server' },
    { action: 'split-window', window: pane, direction: 'vertical', name: 'detached' },
    { action: 'set-layout', tiling: true },
  ];
  for (const body of invalid) {
    const response = await f.request('/tuios/action', { session: 'refuse', ...body });
    expect(response.status).toBe(400);
  }
  for (const headers of [{ Origin: 'https://untrusted.example' }, { 'X-Inbox-Request': '' }]) {
    expect((await f.request('/tuios/action', { action: 'close-window', session: 'refuse', window: pane, confirmed: true }, headers)).status).toBe(403);
  }
  const prompt = 'Please inspect the repository and explain what you find.';
  expect((await f.request('/tuios/action', { action: 'send-prompt', session: 'refuse', window: pane, body: prompt })).status).toBe(400);
  expect(await f.window('refuse', pane)).toMatchObject({ window_id: pane, at_prompt: true, command_seq: shellBefore.command_seq });
  expect(await f.cli('capture-pane', '-s', 'refuse', '-w', pane, '--scrollback', '--lines', '200')).not.toContain(prompt);
  const after = await f.windows('refuse');
  expect(after.windows.map(w => [w.window_id, w.display_name, w.workspace, w.minimized])).toEqual(before.windows.map(w => [w.window_id, w.display_name, w.workspace, w.minimized]));
  expect(after).toMatchObject({ current_workspace: before.current_workspace, focused_window_id: before.focused_window_id });
  expect(await f.window('refuse', pane)).toMatchObject({ window_id: pane, display_name: 'guarded', workspace: 2, minimized: false });
}), 60000);

nativeTest('task homes affect future shells only; an old pane still executes, captures and reconciles in its original session', async () => fixture(async f => {
  const task = await f.task('Workspace task');
  const independent = await f.task('Independently filed');
  const destination = await f.task('Destination group');
  const original = await f.shell(task, '--workspace=9');
  expect(await f.window(task.session, original.id)).toMatchObject({ window_id: original.id, display_name: '--workspace=9', workspace: 1 });
  await f.action('create-session', { name: 'old-home' });
  await f.action('create-session', { name: 'new-home' });
  await f.action('bind-task', { taskId: task.id, session: 'old-home', workspace: 2 });
  const oldTask = (await f.state()).tasks.find(t => t.id === task.id);
  expect(oldTask).toMatchObject({ session: 'old-home', workspace: 2 });
  const pane = await f.shell(oldTask, 'task-shell');
  expect(await f.window('old-home', pane.id)).toMatchObject({ window_id: pane.id, workspace: 2 });
  const first = await f.compose(oldTask, pane, "printf 'FIRST_NATIVE_OUTPUT\\n'", 'Original command');
  const filed = await f.compose(oldTask, pane, "printf 'FILED_NATIVE_OUTPUT\\n'", 'Filed elsewhere');
  await f.json(`/threads/${filed.id}`, { task_id: independent.id }, 200, 'PATCH');
  await f.action('bind-task', { taskId: task.id, session: 'new-home', workspace: 3 });
  const movedTask = (await f.state()).tasks.find(t => t.id === task.id);
  expect(movedTask).toMatchObject({ session: 'new-home', workspace: 3 });
  expect((await f.state()).agents.find(a => a.id === pane.id)).toMatchObject({ session: 'old-home', task_id: task.id });
  expect(await f.json(`/threads/${first.id}`)).toMatchObject({ task_id: task.id, pane_id: pane.id });
  const executed = await f.compose(movedTask, pane, "printf 'OLD_SESSION_STILL_WORKS\\n'", 'After home change');
  expect(executed.messages.find(m => m.role === 'shell').body).toContain('OLD_SESSION_STILL_WORKS');
  expect((await f.json(`/panes/${pane.id}/capture`)).text).toContain('OLD_SESSION_STILL_WORKS');
  expect((await f.detail('old-home', pane.id)).text).toContain('OLD_SESSION_STILL_WORKS');
  await f.json(`/panes/${pane.id}/keys`, { keys: 'Enter' });
  await f.json('/reconcile', {});
  expect((await f.state()).panes.find(p => p.id === pane.id)).toMatchObject({ id: pane.id, session: 'old-home', state: 'none' });
  const future = await f.shell(movedTask, 'future-shell');
  expect(await f.window('new-home', future.id)).toMatchObject({ window_id: future.id, workspace: 3 });
  await f.action('assign-task', { session: 'old-home', window: pane.id, taskId: destination.id });
  expect((await f.state()).agents.find(a => a.id === pane.id)).toMatchObject({ session: 'old-home', task_id: destination.id });
  expect(await f.json(`/threads/${first.id}`)).toMatchObject({ task_id: destination.id, pane_id: pane.id });
  expect(await f.json(`/threads/${filed.id}`)).toMatchObject({ task_id: independent.id, pane_id: pane.id });
  await f.action('bind-task', { taskId: task.id, session: task.session, workspace: null });
  const unbound = (await f.state()).tasks.find(t => t.id === task.id);
  expect(unbound).toMatchObject({ session: task.session, workspace: null });
  const dedicated = await f.shell(unbound, 'dedicated-shell');
  expect(await f.window(task.session, dedicated.id)).toMatchObject({ window_id: dedicated.id, workspace: 1 });
  expect(await f.window('old-home', pane.id)).toMatchObject({ window_id: pane.id, workspace: 2 });
}), 90000);

nativeTest('confirmed workspace and exact session closure retain task, pane and command history records', async () => fixture(async f => {
  const task = await f.task('Closure history');
  await f.action('create-session', { name: 'close' });
  await f.action('create-session', { name: 'close-extra' });
  await f.action('bind-task', { taskId: task.id, session: 'close', workspace: 2 });
  const bound = (await f.state()).tasks.find(t => t.id === task.id);
  const pane = await f.shell(bound, 'history-shell');
  const survivor = await f.create('close', 3, 'survivor');
  const thread = await f.compose(bound, pane, "printf 'DURABLE_NATIVE_HISTORY\\n'", 'Keep this result');
  await f.action('close-workspace', { session: 'close', workspace: 2, confirmed: true });
  expect((await f.windows('close')).windows.map(w => w.window_id)).toContain(survivor);
  expect((await f.windows('close')).windows.some(w => w.window_id === pane.id)).toBe(false);
  await f.json('/reconcile', {});
  let state = await f.state();
  expect(state.tasks.find(t => t.id === task.id)).toMatchObject({ session: 'close', workspace: 2, title: 'Closure history' });
  expect(state.panes.find(p => p.id === pane.id)).toMatchObject({ id: pane.id, state: 'closed', task_id: task.id });
  expect((await f.json(`/threads/${thread.id}`)).messages.find(m => m.role === 'shell')).toMatchObject({ status: 'complete' });
  await f.action('kill-session', { session: 'close', confirmed: true });
  expect((await f.native('ls')).map(s => s.name)).toEqual(['close-extra']);
  await f.json('/reconcile', {});
  state = await f.state();
  expect(state.tasks.find(t => t.id === task.id)).toMatchObject({ id: task.id, title: 'Closure history' });
  expect(state.agents.find(a => a.id === pane.id)).toMatchObject({ id: pane.id, session: 'close', state: 'closed' });
  const retained = await f.json(`/threads/${thread.id}`);
  expect(retained).toMatchObject({ task_id: task.id, pane_id: pane.id, subject: 'Keep this result' });
  expect(retained.messages.find(m => m.role === 'shell').body).toContain('DURABLE_NATIVE_HISTORY');
}), 90000);

nativeTest('launch host choice lists registered hosts and refuses invalid or unregistered hosts without creating panes', async () => fixture(async f => {
  const listed = await f.json('/hosts');
  expect(listed.hosts.find(h => h.host === 'local')).toMatchObject({ host: 'local', status: 'up' });
  const task = await f.json('/tasks', { title: 'Host choice' }, 201);
  await f.shell(task, 'first');
  const before = (await f.windows(task.session)).windows.length;
  for (const kind of ['shell', 'agent']) for (const host of [undefined, '', 'task', 'ghost', 'a:b', 'x y', 42]) {
    const response = await f.request(`/tasks/${task.id}/panes`, { kind, name: 'nope', host, profileId: 'claude' });
    expect(response.status).toBe(400);
  }
  expect((await f.json('/state')).panes.filter(p => p.task_id === task.id).map(p => p.name)).toEqual(['first']);
  expect((await f.windows(task.session)).windows.length).toBe(before);
  // The task's own host, named explicitly, is the ordinary local launch.
  const pane = await f.json(`/tasks/${task.id}/panes`, { kind: 'shell', name: 'explicit-local', host: 'local' }, 201);
  expect((await f.state()).agents.find(a => a.id === pane.id)).toMatchObject({ session: task.session, host: 'local', task_id: task.id });
}), 60000);

test('launch host module requires a machine and preserves unavailable explicit choices', async () => {
  const { setupLaunchHost } = await import('./public/launch-host.js');
  const select = { value: 'gone', options: [], replaceChildren(...o) { this.options = o; } };
  const note = { textContent: '' };
  const events = [], dialog = { open: true };
  const form = { querySelector: () => ({ querySelector: s => s === 'select' ? select : note }), closest: () => dialog, dispatchEvent: event => events.push(event.type) };
  const originalOption = globalThis.Option;
  globalThis.Option = class { constructor(text, value) { this.text = text; this.value = value; } };
  try {
  await setupLaunchHost(form, async () => ({ hosts: [{ host: 'local', status: 'up' }, { host: 'build', status: 'up' }, { host: 'dead', status: 'down', error: 'timeout' }] }), {});
  expect(events).toEqual(['hosts-ready']);
  expect(select.options.map(o => [o.value, o.disabled || false])).toEqual([['', false], ['local', false], ['build', false], ['dead', true], ['gone', true]]);
  expect(select.options[3].text).toContain('down: timeout');
  expect(select.value).toBe('gone');
  await setupLaunchHost(form, async () => { throw new Error('boom'); }, {});
  expect(note.textContent).toContain('boom');
  } finally { if (originalOption === undefined) delete globalThis.Option; else globalThis.Option = originalOption; }
});

test('launch host module ignores stale discovery and disables unknown hosts', async () => {
  const { setupLaunchHost } = await import('./public/launch-host.js');
  const select = { value: '', options: [], replaceChildren(...o) { this.options = o; } };
  const note = { textContent: '' };
  const events = [], dialog = { open: true };
  const form = { querySelector: () => ({ querySelector: s => s === 'select' ? select : note }), closest: () => dialog, dispatchEvent: event => events.push(event.type) };
  const originalOption = globalThis.Option;
  globalThis.Option = class { constructor(text, value) { this.text = text; this.value = value; } };
  try {
  const slow = []; const api = () => new Promise(r => slow.push(r));
  const first = setupLaunchHost(form, api, {});
  const second = setupLaunchHost(form, api, {});
  expect(select.options.map(o => o.value)).toEqual(['']);
  slow[1]({ hosts: [{ host: 'new', status: 'up' }, { host: 'mystery', status: 'unknown' }] });
  await second;
  slow[0]({ hosts: [{ host: 'old', status: 'up' }] });
  await first;
  expect(select.options.map(o => [o.value, o.disabled || false])).toEqual([['', false], ['new', false], ['mystery', true]]);
  await setupLaunchHost(form, async () => { throw new Error('boom'); }, {});
  expect(select.options.map(o => o.value)).toEqual(['']);
  expect(events).toEqual(['hosts-ready', 'hosts-ready']);
  const pending = setupLaunchHost(form, api, {});
  dialog.open = false;
  slow[2]({ hosts: [{ host: 'closed-result', status: 'up' }] });
  await pending;
  expect(select.options.map(o => o.value)).toEqual(['']);
  expect(events).toEqual(['hosts-ready', 'hosts-ready']);
  expect(note.textContent).toBe('Loading execution machines…');
  } finally { if (originalOption === undefined) delete globalThis.Option; else globalThis.Option = originalOption; }
});

nativeTest('ordinary sessions remain historical but cannot receive new Inbox work', async () => fixture(async f => {
  await f.action('create-session', { name: 'global-only' });
  await f.cli('new', 'ordinary-history', '--detach');
  const ordinary = (await f.windows('ordinary-history')).windows[0].window_id;
  const at = new Date().toISOString();
  await Bun.write(join(f.env.TUIOS_INBOX_SPOOL, 'ordinary-history.json'), JSON.stringify({ id:'ordinary-history', time:at, values:{TUIOS_EVENT:'after-agent-state',TUIOS_AGENT_STATE:'done',TUIOS_WINDOW_ID:ordinary,TUIOS_SESSION_ID:'ordinary-history'}, turn:{session:'ordinary-history',pane:ordinary,name:'historical ordinary pane',harness:'omp',state:'done',at,prompt:'old prompt',response:'retained old result',source:'pane'} }));
  await f.json('/reconcile', {});
  const outline = await f.json('/outline');
  expect(outline.sessions.map(s => [s.name,s.global])).toEqual([['global-only',true]]);
  expect(outline.panes.find(p => p.id === ordinary)).toMatchObject({ live:false,ready:false,session:'ordinary-history' });
  const run = outline.runs.find(r => r.pane_id === ordinary);
  expect(await f.json('/turns/' + run.id.slice(5))).toMatchObject({ prompt:'old prompt',response:'retained old result' });
  expect((await f.request('/agents/' + ordinary + '/prompt', { body:'must not be sent' })).status).toBe(400);
  const blocked = await f.json('/prompts', { body:'keep unsent ordinary continuation',target:ordinary,run:true,allow_warnings:true },201);
  expect(blocked).toMatchObject({ ran:false,prompt:{state:'blocked',body:'keep unsent ordinary continuation'} });
  expect(blocked.preflight.blocks.map(b => b.code)).toEqual(['not_global']);
  expect((await f.request('/tuios/action', {action:'create-window',session:'global-only',workspace:1,name:'missing-machine'})).status).toBe(400);
  expect((await f.windows('global-only')).windows).toEqual([]);
  expect(await f.cli('capture-pane','-s','ordinary-history','-w',ordinary,'--scrollback','--lines','100')).not.toContain('must not be sent');
}),60000);


nativeTest('renaming a global container migrates explicit prompt homes without copying inherited ones', async () => fixture(async f => {
  await f.action('create-session', { name: 'rename-before' });
  const task = await f.json('/tasks', {title:'Rename home',session:'rename-before',host:'local'},201);
  const explicit = await f.json('/prompts', {body:'Explicit home',task_id:task.id,session:'rename-before'},201);
  const inherited = await f.json('/prompts', {body:'Inherited home',task_id:task.id},201);
  await f.action('rename-session', {session:'rename-before',name:'rename-after'});
  const prompts = (await f.json('/outline')).prompts;
  expect(prompts.find(p=>p.id===explicit.prompt.id)).toMatchObject({session:'rename-after',resolved:{session:{value:'rename-after',from:'self'}}});
  expect(prompts.find(p=>p.id===inherited.prompt.id)).toMatchObject({session:'',resolved:{session:{value:'rename-after',from:task.id}}});
  expect((await f.state()).tasks.find(t=>t.id===task.id)).toMatchObject({session:'rename-after',host:'local'});
}),60000);
