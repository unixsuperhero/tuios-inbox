import { test, expect } from 'bun:test';
import { bindReadiness, operationBlocked, readinessText, launchSummary } from './public/launch-host.js';

function surface() {
  const status = { textContent: '' }, summary = { textContent: '' }, listeners = new Map();
  const refresh = { disabled: false, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name), click: () => listeners.get('click')?.() };
  return { status, summary, refresh, element: { isConnected: true, querySelector: selector => selector === 'summary' ? summary : selector === '[data-readiness-status]' ? status : refresh } };
}
const result = (host, states = {}) => ({ host, version: '1.2.3', checked_at: '2026-10-13T12:00:00Z', connection: { state: 'connected', reason: 'Native catalog reached' }, operations: Object.fromEntries(['pane','agent','browse'].map(name => [name, { state: states[name] || 'supported', reason: `${name} commands present` }])) });
const tick = () => Promise.resolve();

test('capabilities display actual version and independent operations, not permission readiness', async () => {
  const ui = surface();
  const data = result('build', { pane: 'unsupported', agent: 'unknown', browse: 'supported' });
  const binding = bindReadiness(ui.element, { api: async () => data });
  await binding.update('build');
  expect(ui.status.textContent).toBe('build · connection connected · TUIOS 1.2.3\nNative catalog reached\nPane: unsupported — pane commands present\nAgent: unknown — agent commands present\nBrowse: supported — browse commands present\nSupported means commands exist; permissions and launch context are not checked. Unknown allows an explicit attempt.\nChecked 2026-10-13T12:00:00Z');
  expect(ui.summary.textContent).toBe('Machine capabilities · build · connected · 1.2.3 · unverified; attempts may fail');
  expect([operationBlocked(binding.value, 'pane'), operationBlocked(binding.value, 'agent'), operationBlocked(binding.value, 'browse')]).toEqual([true, false, false]);
  expect(ui.refresh.disabled).toBe(false);
  binding.dispose();
});

test('switching hosts discards late responses and clears previous capability gating immediately', async () => {
  const ui = surface(), pending = new Map(), changes = [];
  const binding = bindReadiness(ui.element, { api: path => new Promise(resolve => pending.set(path, resolve)), onChange: value => changes.push(value?.host || null) });
  const first = binding.update('slow'); await tick();
  const second = binding.update('fast'); await tick();
  expect(binding.value).toBe(null);
  ui.status.textContent = ''; await binding.update('fast');
  expect(ui.status.textContent).toBe('Checking native commands… Unknown capabilities still allow an explicit attempt.');
  pending.get('/hosts/readiness?host=fast')(result('fast')); await second;
  pending.get('/hosts/readiness?host=slow')(result('slow', { agent: 'unsupported' })); await first;
  expect(binding.value.host).toBe('fast');
  expect(ui.summary.textContent).toBe('Machine capabilities · fast · connected · 1.2.3 · command support only');
  expect(changes).toEqual([null, null, 'fast']);
  binding.dispose();
});

test('closed surfaces cannot receive late capability or focus-changing updates', async () => {
  const ui = surface(); let resolve, current = true;
  const binding = bindReadiness(ui.element, { api: () => new Promise(r => resolve = r), isCurrent: () => current });
  const checking = binding.update('closing'); await tick(); current = false; binding.dispose();
  resolve(result('closing')); await checking;
  expect(binding.value).toBe(null);
  expect(ui.status.textContent).toBe('Checking native commands… Unknown capabilities still allow an explicit attempt.');
  expect(ui.summary.textContent).toBe('Machine capabilities · closing · checking…');
});

test('same-host presentation patches do not refetch, explicit refresh and reopen do', async () => {
  const ui = surface(); let checks = 0;
  const api = async () => ({ ...result('local'), version: `v${++checks}` });
  let binding = bindReadiness(ui.element, { api });
  await binding.update('local'); ui.status.textContent = ''; await binding.update('local');
  expect(ui.summary.textContent).toBe('Machine capabilities · local · connected · v1 · command support only');
  expect(ui.status.textContent).toContain('TUIOS v1');
  await ui.refresh.click();
  expect(ui.summary.textContent).toBe('Machine capabilities · local · connected · v2 · command support only');
  binding.dispose(); binding = bindReadiness(ui.element, { api }); await binding.update('local');
  expect(ui.summary.textContent).toBe('Machine capabilities · local · connected · v3 · command support only');
  expect(checks).toBe(3); binding.dispose();
});

test('concurrent same-machine checks share a request and failed lookup remains attemptable', async () => {
  const a = surface(), b = surface(); let resolve, count = 0;
  const api = () => { count++; return new Promise(r => resolve = r); };
  const first = bindReadiness(a.element, { api }), second = bindReadiness(b.element, { api });
  const both = [first.update('shared'), second.update('shared')]; await tick(); resolve(result('shared')); await Promise.all(both);
  expect([first.value.host, second.value.host, count]).toEqual(['shared', 'shared', 1]); first.dispose(); second.dispose();
  const ui = surface(), failed = bindReadiness(ui.element, { api: async () => { throw Error('catalog denied'); } });
  await failed.update('restricted');
  expect(ui.summary.textContent).toBe('Machine capabilities · restricted · unknown · unverified; attempts may fail');
  expect(readinessText(failed.value)).toContain('Browse: unknown — Capability check failed: catalog denied');
  expect(['pane','agent','browse'].map(op => operationBlocked(failed.value, op))).toEqual([false,false,false]);
  failed.dispose();
});

test('fresh summary shows resolved values and launch-only overrides', () => {
  const summary = launchSummary({ host: 'build', project: '/repo', worktree: '/trees/review', cwd: '/trees/review', profile: 'Codex', model: 'gpt-6', session: 'local:work', owner: 'local', workspace: 3, inheritance: 'project, session', overrides: 'machine, profile' });
  for (const field of ['Machine: build', 'Project: /repo', 'Worktree: /trees/review', 'Directory: /trees/review', 'Profile: Codex', 'Model: gpt-6', 'Session: local:work', 'owner local', 'workspace 3', 'Inherited: project, session', 'Launch-only: machine, profile']) expect(summary).toContain(field);
});

test('continuation summary uses pane evidence and never substitutes task launch defaults', () => {
  const defaults = { host: 'task-host', owner: 'task-owner', project: '/task', cwd: '/task', profile: 'task-profile', model: 'task-model', session: 'task-session', workspace: 9, inheritance: 'task values', overrides: 'task overrides' };
  const summary = launchSummary({ ...defaults, mode: 'Continue', pane: { id: 'p1', name: 'reviewer', host: 'build', session: 'owner:work', workspace: 2, launch_cwd: '/actual', launch_profile: 'codex', launch_model: 'actual-model' } });
  for (const field of ['pane reviewer', 'Machine: build', 'Project: unknown', 'Directory: /actual', 'Profile: codex', 'Model: actual-model', 'Session: owner:work', 'owner owner', 'workspace 2']) expect(summary).toContain(field);
  for (const value of ['task-host', 'task-owner', '/task', 'task-profile', 'task-model', 'task-session', 'task values', 'task overrides']) expect(summary).not.toContain(value);
  const unknown = launchSummary({ ...defaults, mode: 'Reuse', pane: { id: 'p2' } });
  for (const field of ['pane p2', 'Machine: unknown', 'Project: unknown', 'Directory: unknown', 'Profile: unknown', 'Model: unknown', 'Session: unknown', 'owner unknown', 'workspace unknown']) expect(unknown).toContain(field);
});

test('many pending host selections stay bounded and overflow remains explicit-attempt unknown', async () => {
  const resolvers = [], bindings = [], pending = [];
  const api = path => new Promise(resolve => resolvers.push(() => resolve(result(decodeURIComponent(path.split('=')[1])))));
  for (let i = 0; i < 17; i++) { const ui = surface(), binding = bindReadiness(ui.element, { api }); bindings.push({ ui, binding }); pending.push(binding.update('bound-' + i)); }
  await tick(); await pending[16];
  expect(bindings[16].ui.summary.textContent).toBe('Machine capabilities · bound-16 · unknown · unverified; attempts may fail');
  expect(bindings[16].ui.status.textContent).toContain('Other machine checks are in progress. Refresh to check this machine.');
  expect(resolvers.length).toBe(16);
  for (const resolve of resolvers) resolve(); await Promise.all(pending);
  expect(bindings[0].ui.summary.textContent).toBe('Machine capabilities · bound-0 · connected · 1.2.3 · command support only');
  for (const { binding } of bindings) binding.dispose();
});
