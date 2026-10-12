// Fixtures and pure logic for the task-first outline mock. No DOM in here.

export const APP_DEFAULT = { harness: 'omp', model: 'gpt-5.5', queue_mode: 'manual' };
export const HOST = 'mbp';
export const HOST_HARNESSES = ['omp', 'claude-code'];          // installed on this host
export const HARNESSES = ['omp', 'claude-code', 'codex'];      // codex is known but not installed
export const MODELS = ['gpt-5.5', 'gemini-3-pro', 'claude-sonnet-4-6'];
export const FIELDS = [
  { key: 'repo', label: 'Repo', kind: 'dir' },
  { key: 'branch', label: 'Branch', kind: 'text' },
  { key: 'home', label: 'Home', kind: 'dir' },
  { key: 'harness', label: 'Harness', kind: 'select', options: HARNESSES },
  { key: 'model', label: 'Model', kind: 'select', options: MODELS },
  { key: 'queue_mode', label: 'Queue mode', kind: 'select', options: ['manual', 'auto'] },
];
// What git would report for each directory. Anything missing is "not a repository".
export const REPO_STATE = {
  '~/proj/tuios-inbox': { head: 'main', dirty: true },
  '~/proj/portfolio-inbox': { head: 'tuios-inbox-merge', dirty: false },
  '~/proj/omp-collector': { head: 'main', dirty: false },
};
export const DEFAULT_COLLAPSED = ['task:contrast', 'task:tailnet', 'prompt:p-mig', 'prompt:p-c1', 'prompt:p-c2', 'prompt:p-tail'];

const T = (id, title, parent_id, extra = {}) => ({ id, title, parent_id, ...extra });
const P = (id, body, task_id, state, extra = {}) => ({ id, body, task_id, state, ...extra });
const R = (id, prompt_id, pane_id, state, extra = {}) => ({
  id, prompt_id, pane_id, state, host: HOST, harness: 'omp', model: 'gpt-5.5', started: '09:12', source: 'transcript', partial: false, unread: false, response: '', commits: [], ...extra,
});

const FIXTURES = () => ({
  seq: 100,
  tasks: [
    T('parser', 'Fix parser', null, { repo: '~/proj/tuios-inbox', home: '~/proj/tuios-inbox', branch: 'fix-parser', queue_mode: 'auto', pr: { number: 42, state: 'open', checks: 'failing' } }),
    T('tok', 'Tokenizer edge cases', 'parser'),
    T('uni', 'Unicode escapes', 'tok', { model: 'gemini-3-pro' }),
    T('surr', 'Surrogate pair fixtures', 'uni', { origin: 'omp todo' }),
    T('readme', 'Update README', 'parser', { harness: 'claude-code', model: 'claude-sonnet-4-6', queue_mode: 'manual' }),
    T('filters', 'Queue view filters', null, { repo: '~/proj/tuios-inbox', home: '~/proj/tuios-inbox', branch: 'queue-filters', model: 'gemini-3-pro', pr: { number: 45, state: 'open', checks: 'pending' } }),
    T('counts', 'Saved view counts', 'filters'),
    T('merge', 'Portfolio merge', null, { repo: '~/proj/portfolio-inbox', home: '~/proj/portfolio-inbox', branch: 'tuios-inbox-merge', queue_mode: 'auto', pr: { number: 12, state: 'open', checks: 'passing' } }),
    T('table', 'One task table migration', 'merge'),
    T('backfill', 'Backfill parent ids', 'table', { origin: 'omp todo' }),
    T('notes', 'Draft release notes', null),
    T('collector', 'Collector for omp sessions', null, { repo: '~/proj/omp-collector', home: '~/proj/omp-collector', branch: 'main' }),
    T('contrast', 'Flight deck contrast pass', null, { repo: '~/proj/tuios-inbox', home: '~/proj/tuios-inbox', branch: 'contrast-pass', harness: 'claude-code', model: 'claude-sonnet-4-6', pr: { number: 44, state: 'merged', checks: 'passing' } }),
    T('phone', 'Phone layout', null, { repo: '~/proj/tuios-inbox', home: '~/proj/tuios-inbox', branch: 'phone-layout' }),
    T('capture', 'Capture line above the keyboard', 'phone'),
    T('fold', 'Fold fact columns into a second row', 'phone'),
    T('tailnet', 'Tailnet access notes', null, { home: '~/notes' }),
    T('oldinbox', 'Old inbox page cleanup', null, { archived: true, repo: '~/proj/tuios-inbox', branch: 'drop-old-inbox', pr: { number: 31, state: 'merged', checks: 'passing' } }),
  ],
  prompts: [
    P('p-tests', 'Add tests for nested quotes', 'tok', 'done'),
    P('p-pass', 'Now make them pass', 'tok', 'running'),
    P('p-esc', 'Handle escaped backslashes inside quotes', 'tok', 'queued'),
    P('p-surr', 'Generate fixtures for lone high and low surrogates', 'surr', 'queued', { target: 'c7be946f' }),
    P('p-readme', 'Document the new quoting rules in the README', 'readme', 'queued'),
    P('p-f1', 'Add a Needs me filter that keeps ancestors visible', 'filters', 'queued'),
    P('p-f2', 'Count matches per saved view in the rail', 'filters', 'queued'),
    P('p-f3', 'Write a test for the empty Archive view', 'filters', 'queued'),
    P('p-cq', 'Should a blocked prompt count as queued or as needs me?', 'counts', 'running'),
    P('p-m1', 'Port the turn table to the portfolio task table', 'merge', 'queued', { harness: 'codex' }),
    P('p-m2', 'Then delete the old turn table and its indexes', 'merge', 'queued'),
    P('p-mig', 'Write the one-table migration with a down step', 'table', 'done'),
    P('p-notes', 'Summarise what changed since 0.9 for the release notes', 'notes', 'queued'),
    P('p-col', 'Parse omp session jsonl into runs', 'collector', 'done'),
    P('p-col2', 'Retry with the streaming reader', 'collector', 'queued'),
    P('p-c1', 'Raise muted text to 4.5:1 on raised rows', 'contrast', 'done'),
    P('p-c2', 'Check focus rings against the accent on every control', 'contrast', 'done'),
    P('p-ph', 'Keep the capture line visible when the keyboard opens', 'capture', 'queued', { target: 'd0aa41fe' }),
    P('p-tail', 'List which ports the tailnet exposes right now', 'tailnet', 'done'),
    P('p-old', 'Remove the old inbox route and its template', 'oldinbox', 'done'),
    P('o-settle', 'what does settle_seconds default to?', null, 'saved'),
    P('o-idle', 'why is pane 7c2e88d0 idle but marked working?', null, 'saved', { target: '7c2e88d0' }),
    P('o-poll', 'list every place we poll on a timer', null, 'done'),
  ],
  runs: [
    R('r-tests', 'p-tests', '4b9c6b1a', 'done', { started: '09:12', finished: '09:19', unread: true, head_before: 'a1b2c3d', head_after: 'd4e5f6a',
      commits: [{ sha: 'd4e5f6a', title: 'Add nested quote tests' }],
      response: '## Nested quote tests\n\nAdded **six** cases to `test/tokenizer.test.js`. Four fail today, which is the point.\n\n- double inside single\n- single inside double\n- escaped quote at end of input\n- empty quoted string next to a bare word\n\n```\n$ bun test test/tokenizer.test.js\n2 pass, 4 fail\n```\n\nNext step is making them pass without touching the public token shape.' }),
    R('r-pass', 'p-pass', '4b9c6b1a', 'working', { started: '09:21' }),
    R('r-cq', 'p-cq', 'c7be946f', 'needs_input', { started: '08:50', model: 'gemini-3-pro', source: 'pane', partial: true, unread: true,
      response: '## Waiting on a question\n\nI can count a blocked prompt either way. Which do you want?\n\n- **Queued**: the rail count matches the queue length\n- **Needs me**: the rail count matches what you have to act on\n\nThe pane is holding at this question.' }),
    R('r-mig', 'p-mig', 'e02d5b13', 'done', { started: 'Fri 16:02', finished: 'Fri 16:20', head_before: '77aa001', head_after: '9c0de11',
      commits: [{ sha: '9c0de11', title: 'Add one-table migration with down step' }],
      response: '## Migration written\n\n`db/migrate/014_one_task_table.sql` moves turns into the task table and keeps a down step.\n\n- 0 rows lost on the copy of production data\n- old table left in place until the port lands' }),
    R('r-col', 'p-col', '2f6610bd', 'errored', { started: '07:40', finished: '07:41', unread: true, source: 'pane', partial: true,
      response: '## Stopped with an error\n\nThe reader ran out of memory on a 2.1 GB session file.\n\n```\nRangeError: Invalid string length\n    at readSession (collector/read.js:41)\n```\n\nOutput above this point was cut off by the pane scrollback.' }),
    R('r-c1', 'p-c1', '51aa9e04', 'done', { started: 'Thu 11:05', finished: 'Thu 11:12', harness: 'claude-code', model: 'claude-sonnet-4-6', commits: [{ sha: '3e1f9b2', title: 'Raise muted ink on raised rows' }], response: '## Contrast raised\n\nMuted text on raised rows now measures 7.1:1.' }),
    R('r-c2', 'p-c2', '51aa9e04', 'done', { started: 'Thu 11:20', finished: 'Thu 11:31', harness: 'claude-code', model: 'claude-sonnet-4-6', commits: [{ sha: '8ab44c0', title: 'Use one focus ring on all controls' }], response: '## Focus rings checked\n\nEvery control now uses the same 2px accent ring.' }),
    R('r-tail', 'p-tail', '7c2e88d0', 'done', { started: 'Wed 21:14', finished: 'Wed 21:15', host: 'mini', source: 'summary', partial: true, response: '## Summary only\n\nPorts 4317 and 4403 are served on the tailnet. The full output was not captured; this is the agent\'s closing summary.' }),
    R('r-old', 'p-old', '51aa9e04', 'done', { started: 'Mon 10:00', finished: 'Mon 10:09', commits: [{ sha: '0f3d2aa', title: 'Remove old inbox route' }], response: '## Removed\n\nRoute, template and two tests deleted.' }),
    R('r-poll', 'o-poll', '9d1f3a52', 'done', { started: '08:02', finished: '08:06', host: 'mini', source: 'summary', partial: true, unread: true,
      response: '## Timers found\n\n- `public/app.js`: heartbeat every 5 s\n- `server.mjs`: collector sweep every 30 s\n\nSummary only. The file-by-file listing was not captured.' }),
    R('r-stray', null, '9d1f3a52', 'done', { started: '06:30', finished: '06:44', host: 'mini', source: 'pane', partial: true, response: '## Unassigned run\n\nThis pane finished work that no saved prompt started. Captured from the pane screen, so the top is missing.\n\n- renamed two helper files\n- no commits recorded' }),
  ],
  panes: [
    { id: '4b9c6b1a', session: 'inbox', host: 'mbp', harness: 'omp', state: 'working', task_id: 'tok' },
    { id: 'a41f0c77', session: 'inbox', host: 'mbp', harness: 'omp', state: 'idle', task_id: 'filters' },
    { id: 'c7be946f', session: 'inbox', host: 'mbp', harness: 'omp', state: 'needs_input', task_id: 'counts' },
    { id: 'e02d5b13', session: 'portfolio', host: 'mbp', harness: 'omp', state: 'done', task_id: 'merge' },
    { id: '2f6610bd', session: 'collect', host: 'mbp', harness: 'omp', state: 'errored', task_id: 'collector' },
    { id: '51aa9e04', session: 'inbox', host: 'mbp', harness: 'claude-code', state: 'done', task_id: 'contrast' },
    { id: '7c2e88d0', session: 'scratch', host: 'mini', harness: 'omp', state: 'idle', task_id: null },
    { id: '9d1f3a52', session: 'scratch', host: 'mini', harness: 'omp', state: 'done', task_id: null },
  ],
});

export const createState = () => FIXTURES();

// ---------- lookups ----------
export const taskById = (s, id) => s.tasks.find(t => t.id === id) ?? null;
export const promptById = (s, id) => s.prompts.find(p => p.id === id) ?? null;
export const runById = (s, id) => s.runs.find(r => r.id === id) ?? null;
export const paneById = (s, id) => s.panes.find(p => p.id === id) ?? null;
export const childrenOf = (s, id) => s.tasks.filter(t => (t.parent_id ?? null) === (id ?? null));
export const queueOf = (s, taskId) => s.prompts.filter(p => (p.task_id ?? null) === (taskId ?? null));
export const runsOf = (s, promptId) => s.runs.filter(r => r.prompt_id === promptId);
export const paneAtRest = p => ['idle', 'done', 'errored'].includes(p.state);

export function chain(s, taskId) {            // task, parent, grandparent...
  const out = [];
  for (let t = taskById(s, taskId); t && !out.includes(t); t = taskById(s, t.parent_id)) out.push(t);
  return out;
}
export function subtreeIds(s, taskId) {
  const ids = [taskId];
  for (let i = 0; i < ids.length; i++) childrenOf(s, ids[i]).forEach(c => ids.push(c.id));
  return ids;
}
export const isArchived = (s, taskId) => chain(s, taskId).some(t => t.archived);

// ---------- inheritance ----------
// -> { value, source: 'own' | 'inherited' | 'default' | 'none', from }
export function resolveTask(s, taskId, field) {
  const [self, ...parents] = chain(s, taskId);
  if (self && self[field]) return { value: self[field], source: 'own', from: self.title };
  const p = parents.find(t => t[field]);
  if (p) return { value: p[field], source: 'inherited', from: p.title };
  if (APP_DEFAULT[field]) return { value: APP_DEFAULT[field], source: 'default', from: 'app default' };
  return { value: null, source: 'none', from: null };
}
export function resolvePrompt(s, prompt, field) {
  if (prompt[field]) return { value: prompt[field], source: 'own', from: 'this prompt' };
  if (field === 'queue_mode' && !prompt.task_id) return { value: 'manual', source: 'default', from: 'No task is always manual' };
  const r = resolveTask(s, prompt.task_id, field);
  return r.source === 'own' ? { ...r, source: 'inherited' } : r;
}
export const nearestPr = (s, taskId) => chain(s, taskId).find(t => t.pr) ?? null;

// Where a prompt would run: an explicit pane, a resting pane of its task chain, or a new pane in a directory.
export function pickExecutor(s, prompt) {
  if (prompt.target) {
    const pane = paneById(s, prompt.target);
    return pane ? { kind: 'pane', pane, explicit: true } : { kind: 'gone', id: prompt.target };
  }
  for (const t of chain(s, prompt.task_id)) {
    const pane = s.panes.find(p => p.task_id === t.id && paneAtRest(p));
    if (pane) return { kind: 'pane', pane, explicit: false };
  }
  const dir = prompt.dir || resolvePrompt(s, prompt, 'home').value || resolvePrompt(s, prompt, 'repo').value;
  return dir ? { kind: 'launch', dir } : { kind: 'none' };
}

// ---------- preflight ----------
export function preflight(s, prompt) {
  const blocks = [], warns = [];
  const executor = pickExecutor(s, prompt);
  const harness = resolvePrompt(s, prompt, 'harness');
  const model = resolvePrompt(s, prompt, 'model');
  if (!prompt.body.trim()) blocks.push({ code: 'text', text: 'no text', fix: 'text' });
  if (executor.kind === 'none') blocks.push({ code: 'nowhere', text: 'nowhere to run: no pane at rest and no repo directory to launch in', fix: 'pane+dir' });
  if (executor.kind === 'gone') blocks.push({ code: 'gone', text: `target pane is gone (${executor.id})`, fix: 'pane' });
  if (executor.kind === 'pane' && executor.pane.state === 'needs_input') blocks.push({ code: 'waiting', text: 'target pane is waiting on its own question', fix: 'pane' });
  if (!HOST_HARNESSES.includes(harness.value)) blocks.push({ code: 'harness', text: `no harness available on this host (${harness.value} is not installed on ${HOST})`, fix: 'harness' });

  const repo = resolvePrompt(s, prompt, 'repo').value;
  const branch = resolvePrompt(s, prompt, 'branch').value;
  const git = repo ? REPO_STATE[repo] : null;
  if (git && branch && git.head !== branch) warns.push({ code: 'branch', text: `repo is on ${git.head}, task expects ${branch}` });
  if (git?.dirty) warns.push({ code: 'dirty', text: 'working tree has uncommitted changes' });
  if (nearestPr(s, prompt.task_id)?.pr.checks === 'failing') warns.push({ code: 'checks', text: 'pull request checks are failing' });
  return { blocks, warns, executor, harness, model };
}

// ---------- mutations ----------
const nextId = (s, prefix) => `${prefix}${++s.seq}`;
const fakeSha = s => ((s.seq * 2654435761) >>> 0).toString(16).padStart(8, '0').slice(0, 7);
const clock = () => new Date().toTimeString().slice(0, 5);

export function addTask(s, { title, parent_id = null }) {
  const task = { id: nextId(s, 't'), title, parent_id };
  s.tasks.push(task);
  return task;
}
export function addPrompt(s, { body, task_id = null, target }) {
  const prompt = { id: nextId(s, 'p'), body, task_id, state: task_id ? 'queued' : 'saved' };
  if (target) prompt.target = target;
  s.prompts.push(prompt);
  return prompt;
}
export function indent(s, id) {                // Tab: become the last child of the sibling above
  const task = taskById(s, id);
  const sibs = childrenOf(s, task.parent_id).filter(t => !t.archived);
  const i = sibs.indexOf(task);
  if (i < 1) return false;
  return moveUnder(s, id, sibs[i - 1].id);
}
export function outdent(s, id) {               // Shift+Tab: become the sibling after the parent
  const task = taskById(s, id);
  const parent = taskById(s, task.parent_id);
  if (!parent) return false;
  task.parent_id = parent.parent_id ?? null;
  s.tasks.splice(s.tasks.indexOf(task), 1);
  s.tasks.splice(s.tasks.indexOf(parent) + 1, 0, task);
  return true;
}
export function moveUnder(s, id, parentId) {
  const task = taskById(s, id);
  if (parentId && subtreeIds(s, id).includes(parentId)) return false;
  task.parent_id = parentId ?? null;
  s.tasks.splice(s.tasks.indexOf(task), 1);
  s.tasks.push(task);
  return true;
}

export function startRun(s, prompt) {
  const pf = preflight(s, prompt);
  if (pf.blocks.length) return null;
  let pane = pf.executor.pane;
  if (!pane) {
    pane = { id: fakeSha({ seq: ++s.seq }) + '0', session: 'inbox', host: HOST, harness: pf.harness.value, state: 'working', task_id: prompt.task_id ?? null, dir: pf.executor.dir };
    s.panes.push(pane);
  }
  pane.state = 'working';
  const run = R(nextId(s, 'r'), prompt.id, pane.id, 'working', { host: pane.host, harness: pf.harness.value, model: pf.model.value, started: clock() });
  s.runs.push(run);
  prompt.state = 'running';
  return run;
}
export function finishRun(s, runId) {
  const run = runById(s, runId);
  const prompt = promptById(s, run.prompt_id);
  const pane = paneById(s, run.pane_id);
  const body = prompt.body.trim() || '(empty prompt)';
  run.state = 'done';
  run.finished = clock();
  run.unread = true;
  run.response = `## Done\n\nWorked on: **${body}**\n\n- read the affected files\n- made the change\n- ran the checks\n\n\`\`\`\n$ bun test\n14 pass, 0 fail\n\`\`\`\n\nSynthetic response written by the prototype.`;
  if (resolvePrompt(s, prompt, 'repo').value) {
    ++s.seq;
    run.head_before = fakeSha({ seq: s.seq + 7 });
    run.head_after = fakeSha(s);
    run.commits = [{ sha: run.head_after, title: `Apply: ${body.slice(0, 48)}` }];
  }
  prompt.state = 'done';
  if (pane) pane.state = 'done';
  return run;
}

// Automatic queues: run the next prompt when nothing in the queue is running. Hold on a block.
export function autoTick(s) {
  const started = [];
  for (const p of s.prompts) if (p.state === 'blocked' && !preflight(s, p).blocks.length) p.state = p.task_id ? 'queued' : 'saved';
  for (const task of s.tasks) {
    if (isArchived(s, task.id) || resolveTask(s, task.id, 'queue_mode').value !== 'auto') continue;
    const q = queueOf(s, task.id);
    if (q.some(p => p.state === 'running')) continue;
    const head = q.find(p => ['queued', 'saved', 'blocked'].includes(p.state));
    if (!head) continue;
    if (preflight(s, head).blocks.length) { head.state = 'blocked'; continue; }
    const run = startRun(s, head);
    if (run) started.push(run);
  }
  return started;
}

// ---------- rollups and outline rows ----------
export function taskFacts(s, task) {
  const ids = new Set(subtreeIds(s, task.id));
  const prompts = s.prompts.filter(p => ids.has(p.task_id));
  const pids = new Set(prompts.map(p => p.id));
  const runs = s.runs.filter(r => pids.has(r.prompt_id));
  const n = st => prompts.filter(p => p.state === st).length;
  const f = {
    queued: n('queued') + n('saved'), running: n('running'), blocked: n('blocked'), prompts: prompts.length,
    needs: runs.filter(r => r.state === 'needs_input').length,
    errored: runs.filter(r => r.state === 'errored' && r.unread).length,
    unread: runs.filter(r => r.unread).length,
  };
  f.word = f.needs ? 'needs input' : f.blocked ? 'blocked' : f.running ? 'running' : f.errored ? 'errored' : f.queued ? 'queued' : f.prompts ? 'done' : '';
  return f;
}

const MATCH = {
  needs: { prompt: p => p.state === 'blocked', run: r => r.unread || r.state === 'needs_input' },
  running: { prompt: p => p.state === 'running', run: r => r.state === 'working' },
  queued: { prompt: p => p.state === 'queued' || p.state === 'saved', run: () => false },
};

export function buildRows(s, view, collapsed) {
  const match = MATCH[view];
  const isOpen = key => Boolean(match) || !collapsed.has(key);
  const promptRows = (p, depth) => {
    const all = runsOf(s, p.id);
    const runs = match ? all.filter(match.run) : all;
    if (match && !match.prompt(p) && !runs.length) return [];
    const open = isOpen(`prompt:${p.id}`);
    return [{ kind: 'prompt', id: p.id, depth, expandable: runs.length > 0, open }, ...(open ? runs.map(r => ({ kind: 'run', id: r.id, depth: depth + 1 })) : [])];
  };
  const taskRows = (t, depth) => {
    const inner = [...queueOf(s, t.id).flatMap(p => promptRows(p, depth + 1)), ...childrenOf(s, t.id).flatMap(c => taskRows(c, depth + 1))];
    if (match && !inner.length) return [];
    const open = isOpen(`task:${t.id}`);
    const expandable = queueOf(s, t.id).length + childrenOf(s, t.id).length > 0;
    return [{ kind: 'task', id: t.id, depth, expandable, open }, ...(open ? inner : [])];
  };
  const tops = childrenOf(s, null);
  if (view === 'archive') return tops.filter(t => t.archived).flatMap(t => taskRows(t, 0));
  const rows = view === 'none' ? [] : tops.filter(t => !t.archived).flatMap(t => taskRows(t, 0));
  const inner = [...queueOf(s, null).flatMap(p => promptRows(p, 1)), ...s.runs.filter(r => !r.prompt_id && (!match || match.run(r))).map(r => ({ kind: 'run', id: r.id, depth: 1 }))];
  const open = isOpen('group:none');
  rows.push({ kind: 'group', id: 'none', depth: 0, expandable: inner.length > 0, open, count: inner.filter(r => r.depth === 1).length }, ...(open ? inner : []));
  return rows;
}

export function orphanCount(s) { return queueOf(s, null).length + s.runs.filter(r => !r.prompt_id).length; }

export function viewCounts(s) {
  const livePrompts = s.prompts.filter(p => !p.task_id || !isArchived(s, p.task_id));
  const live = new Set(livePrompts.map(p => p.id));
  const liveRuns = s.runs.filter(r => !r.prompt_id || live.has(r.prompt_id));
  const count = m => livePrompts.filter(m.prompt).length + liveRuns.filter(m.run).length;
  return {
    everything: s.tasks.filter(t => !isArchived(s, t.id)).length,
    needs: count(MATCH.needs), running: count(MATCH.running), queued: count(MATCH.queued),
    none: orphanCount(s), archive: s.tasks.filter(t => t.archived).length,
  };
}
