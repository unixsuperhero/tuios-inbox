import { expect, test } from 'bun:test';
import { resolve, preflight, nextInQueue, queueHeld, pickPane, profileFor, ompTodos, reviewQueue, railTree, reviewItems, docsIn, queueStatus, runTask, indicators, sumIndicators, itemKind, queueItems, queueCounts, markable, paneTask, taskIndicators } from './public/outline-model.js';

const tasks = {
  root: { id: 'root', parent_id: null, repo: '/r', branch: 'fix-parser', harness: '', model: 'gpt', queue_mode: 'auto', session: 'work', workspace: 2 },
  kid: { id: 'kid', parent_id: 'root', repo: '', branch: '', harness: 'claude-code', model: '', queue_mode: '', session: '', workspace: null },
  lone: { id: 'lone', parent_id: null, path: '', branch: '' },
};
const profiles = [{ id: 'omp', executable: 'omp' }, { id: 'claude', executable: 'claude' }];

test('a missing field is looked up through the prompt, its task, the parents, then the default', () => {
  const r = resolve({ id: 'p', body: 'x', task_id: 'kid', harness: '', model: 'opus' }, tasks);
  expect(r.model).toEqual({ value: 'opus', from: 'self' });
  expect(r.harness).toEqual({ value: 'claude-code', from: 'kid' });
  expect(r.repo).toEqual({ value: '/r', from: 'root' });
  expect(r.branch).toEqual({ value: 'fix-parser', from: 'root' });
  expect(r.queue_mode).toEqual({ value: 'auto', from: 'root' });
  expect(r.workspace).toEqual({ value: 2, from: 'root' });
  expect(resolve(tasks.kid, new Map(Object.entries(tasks))).harness).toEqual({ value: 'claude-code', from: 'self' });
});
test('orphans fall back to defaults or none, and a task row may carry repo as path or under own', () => {
  const r = resolve({ id: 'p', body: 'x', task_id: null }, tasks);
  expect(r.harness).toEqual({ value: 'omp', from: 'default' });
  expect(r.queue_mode).toEqual({ value: 'manual', from: 'default' });
  expect(r.launch_mode).toEqual({ value: 'new', from: 'default' });
  expect(r.repo).toEqual({ value: null, from: 'none' });
  expect(resolve({ id: 't', parent_id: null, path: '/p' }, {}).repo).toEqual({ value: '/p', from: 'self' });
  expect(resolve({ id: 't', parent_id: null, own: { repo: '/o' } }, {}).repo).toEqual({ value: '/o', from: 'self' });
  const loop = { a: { id: 'a', parent_id: 'b' }, b: { id: 'b', parent_id: 'a' } };
  expect(resolve(loop.a, loop).repo.from).toBe('none');
});
test('launch mode inherits without copying and child session/workspace resolve independently', () => {
  const hierarchy = {
    root: { id: 'root', own: { launch_mode: 'reuse', session: 'native', workspace: 1 } },
    kid: { id: 'kid', parent_id: 'root', own: { workspace: 4 } },
  };
  const prompt = { body: 'x', task_id: 'kid' };
  expect(resolve(prompt, hierarchy).launch_mode).toEqual({ value: 'reuse', from: 'root' });
  expect(resolve(prompt, hierarchy).session).toEqual({ value: 'native', from: 'root' });
  expect(resolve(prompt, hierarchy).workspace).toEqual({ value: 4, from: 'kid' });
  expect(resolve({ ...prompt, launch_mode: 'new' }, hierarchy).launch_mode).toEqual({ value: 'new', from: 'self' });
  hierarchy.kid.own.launch_mode = 'new';
  expect(resolve(prompt, hierarchy).launch_mode).toEqual({ value: 'new', from: 'kid' });
  hierarchy.kid.own.launch_mode = '';
  expect(resolve(prompt, hierarchy).launch_mode).toEqual({ value: 'reuse', from: 'root' });
});
test('cwd uses the nearest task directory and never combines a child repo with ancestor worktree', () => {
  const hierarchy = {
    root: { id: 'root', own: { repo: '/project', worktree: '/project-worktree' } },
    kid: { id: 'kid', parent_id: 'root', own: { repo: '/child-project' } },
    leaf: { id: 'leaf', parent_id: 'kid', own: {} },
  };
  const prompt = { body: 'x', task_id: 'leaf' };
  expect(resolve(prompt, hierarchy).cwd).toEqual({ value: '/child-project', from: 'kid' });
  hierarchy.kid.own.worktree = '/child-worktree';
  expect(resolve(prompt, hierarchy).cwd).toEqual({ value: '/child-worktree', from: 'kid' });
  expect(resolve(hierarchy.kid, hierarchy).cwd).toEqual({ value: '/child-worktree', from: 'self' });
  hierarchy.kid.own = {};
  expect(resolve(prompt, hierarchy).cwd).toEqual({ value: '/project-worktree', from: 'root' });
  expect(resolve({ id: 'legacy', path: '/legacy', worktree: '/legacy-worktree' }, {}).cwd).toEqual({ value: '/legacy-worktree', from: 'self' });
  expect(resolve({ body: 'x', task_id: null }, hierarchy).cwd).toEqual({ value: null, from: 'none' });
});

const pf = (prompt, panes = [], git = null) => preflight({ prompt, resolved: resolve(prompt, tasks), panes, git, profiles });
const codes = r => r.blocks.map(b => b.code);
const warnings = r => r.warns.map(w => [w.code, w.fix]);
const launchedPane = extra => ({ id: 'a', task_id: 'root', kind: 'agent', state: 'idle', ready: true, launch_cwd: '/r', launch_profile: 'omp', launch_model: 'gpt', ...extra });
test('empty text blocks dispatch, while configuration findings stay actionable warnings', () => {
  expect(pf({ body: ' ', task_id: 'root' }).blocks.map(b => [b.code, b.fix])).toEqual([['no_text', 'body']]);
  expect(warnings(pf({ body: 'x', task_id: null }))).toEqual([['nowhere', 'repo']]);
  expect(warnings(pf({ body: 'x', task_id: 'root', harness: 'gemini' }))).toEqual([['no_harness', 'harness']]);
  expect(warnings(pf({ body: 'x', task_id: 'lone', harness: 'gemini' }))).toEqual([['nowhere', 'repo'], ['no_harness', 'harness']]);
  for (const prompt of [{ body: 'x', task_id: null }, { body: 'x', harness: 'gemini' }, { body: 'x', target: 'gone' }]) expect(codes(pf(prompt))).toEqual([]);
  expect(warnings(pf({ body: 'x', task_id: 'kid' }))).toEqual([]);
});
test('target health and launch-context mismatches warn without preventing an attempt', () => {
  const prompt = { body: 'x', task_id: 'root', target: 'a' };
  expect(warnings(pf(prompt))).toEqual([['pane_gone', 'target']]);
  expect(warnings(pf(prompt, [launchedPane({ state: 'closed' })]))).toEqual([['pane_gone', 'target']]);
  for (const state of ['needs_input', 'working']) {
    const result = pf(prompt, [launchedPane({ state, ready: false })]);
    expect(warnings(result)).toEqual([['pane_blocked', 'target']]);
    expect(result.blocks).toEqual([]);
  }
  expect(warnings(pf(prompt, [{ id: 'a', state: 'idle', ready: true }]))).toEqual([['pane_unknown', 'target']]);
  expect(warnings(pf(prompt, [launchedPane({ launch_cwd: '/other', launch_profile: 'claude', launch_model: 'opus' })]))).toEqual([['harness_mismatch', 'harness'], ['model_mismatch', 'model'], ['cwd_mismatch', 'target']]);
  expect(pf(prompt, [launchedPane()])).toEqual({ blocks: [], warns: [] });
});
test('preflight preserves git findings without blocking', () => {
  const git = { state: 'ok', head: 'main', dirty: true, pr: { checks: 'failing' } };
  const r = pf({ body: 'x', task_id: 'root' }, [], git);
  expect(r.blocks).toEqual([]);
  expect(r.warns.map(w => w.code)).toEqual(['branch_mismatch', 'dirty', 'checks_failing']);
  expect(pf({ body: 'x', task_id: 'root' }, [], { state: 'ok', head: 'fix-parser', dirty: false, pr: null })).toEqual({ blocks: [], warns: [] });
});
test('native transport warning measures UTF-8 bytes and never changes prompt text', () => {
  const prompt = { body: 'é'.repeat(8192), task_id: 'root' };
  expect(pf(prompt)).toEqual({ blocks: [], warns: [] });
  prompt.body += 'é';
  expect(warnings(pf(prompt))).toEqual([['native_message_limit', 'body']]);
  expect(pf(prompt).blocks).toEqual([]);
  expect(prompt.body).toBe('é'.repeat(8193));
});
test('the queue runs lowest position first, one queue per task and one for no task', () => {
  const prompts = [
    { id: '1', task_id: 'root', state: 'done', position: 1 }, { id: '2', task_id: 'root', state: 'queued', position: 5 },
    { id: '3', task_id: 'root', state: 'queued', position: 3 }, { id: '4', task_id: null, state: 'queued', position: 2 },
    { id: '5', task_id: 'kid', state: 'blocked', position: 1 }, { id: '6', task_id: 'kid', state: 'queued', position: 4 },
  ];
  expect(nextInQueue(prompts, 'root').id).toBe('3');
  expect(nextInQueue(prompts, null).id).toBe('4');
  expect(nextInQueue(prompts).id).toBe('4');
  expect(nextInQueue(prompts, 'lone')).toBe(null);
  expect(queueHeld(prompts, nextInQueue(prompts, 'kid'))).toBe(true);
  expect(queueHeld(prompts, nextInQueue(prompts, 'root'))).toBe(false);
});
test('new prompts never automatically reuse an idle pane and explicit targets keep their address', () => {
  const prompt = { body: 'x', task_id: 'root' }, pane = launchedPane();
  expect(pickPane(prompt, [pane], resolve(prompt, tasks), profiles)).toBe(null);
  expect(pickPane({ ...prompt, target: 'a' }, [pane], resolve(prompt, tasks), profiles)).toEqual(pane);
  const busy = launchedPane({ state: 'working', ready: false });
  expect(pickPane({ ...prompt, target: 'a' }, [busy], resolve(prompt, tasks), profiles)).toEqual(busy);
});
test('reuse selects only a known compatible idle app launch, otherwise dispatch launches fresh', () => {
  const prompt = { body: 'x', task_id: 'root', launch_mode: 'reuse' }, resolved = resolve(prompt, tasks);
  const pane = launchedPane();
  const incompatible = [
    { launch_cwd: '/other' }, { launch_profile: 'claude' }, { launch_model: 'opus' },
    { launch_cwd: undefined }, { launch_profile: undefined }, { launch_model: undefined },
    { state: 'working', ready: false }, { state: 'needs_input', ready: false }, { state: 'closed' },
    { kind: 'shell' }, { task_id: 'kid' }, { state: 'unknown' },
  ].map(launchedPane);
  expect(pickPane(prompt, incompatible, resolved, profiles)).toBe(null);
  expect(pickPane(prompt, [...incompatible, pane], resolved, profiles)).toEqual(pane);
  expect(pickPane(prompt, [launchedPane({ state: 'done' })], resolved, profiles)?.id).toBe('a');
  const custom = { ...prompt, harness: 'custom-agent', model: 'custom-model' };
  expect(pickPane(custom, [launchedPane({ launch_profile: 'custom-agent', launch_model: 'custom-model' })], resolve(custom, tasks), profiles)?.id).toBe('a');
  expect(profileFor('claude-code', profiles)).toEqual({ id: 'claude', executable: 'claude' });
  expect(profileFor('nope', profiles)).toBe(null);
});
test('omp todo calls replay into a final list', () => {
  const call = args => ({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'x' }, { type: 'toolCall', name: 'todo', arguments: args }] } });
  expect(ompTodos([
    call({ op: 'init', items: ['old'] }),
    call({ op: 'init', list: [{ phase: 'A', items: ['one', 'two'] }, { phase: 'B', items: ['three'] }] }),
    call({ op: 'append', phase: 'B', items: ['four', 'gone'] }), call({ op: 'done', task: 'one' }), call({ op: 'done', phase: 'B' }),
    call({ op: 'rm', task: 'gone' }), call({ op: 'view' }), { type: 'title' },
  ])).toEqual([{ title: 'one', done: true }, { title: 'two', done: false }, { title: 'three', done: true }, { title: 'four', done: true }]);
});

const reviewData = () => ({
  tasks: [
    { id: 'p', title: 'Parser', parent_id: null }, { id: 'tok', title: 'Tokenizer', parent_id: 'p' }, { id: 'edge', title: 'Edge cases', parent_id: 'tok' },
    { id: 'ui', title: 'UI', parent_id: null }, { id: 'old', title: 'Old', parent_id: null, archived: true },
  ],
  prompts: [
    { id: 'pb', task_id: 'ui', state: 'blocked', body: 'blocked one', created: '2026-01-01T00:00:00Z', updated: '2026-01-09T00:00:00Z' },
    { id: 'pq', task_id: 'ui', state: 'queued', body: 'queued', created: '2026-01-01T00:00:00Z' },
    { id: 'pe', task_id: null, state: 'errored', body: 'errored', target: 'pane-a', created: '2026-01-02T00:00:00Z' },
    { id: 'pdone', task_id: 'tok', state: 'done', body: 'done', created: '2026-01-01T00:00:00Z' },
  ],
  runs: [
    { id: 'r-root', task_id: 'p', unread: true, state: 'done', started: '2026-01-05T00:00:00Z', finished: '2026-01-05T01:00:00Z' },
    { id: 'r-edge', task_id: 'edge', unread: true, state: 'done', started: '2026-01-03T00:00:00Z', finished: '2026-01-03T01:00:00Z' },
    { id: 'r-edge2', task_id: 'edge', unread: false, state: 'needs_input', started: '2026-01-04T00:00:00Z', finished: null },
    { id: 'r-tok', task_id: 'ui', prompt_id: 'pdone', unread: true, state: 'done', started: '2026-01-08T00:00:00Z', finished: '2026-01-08T01:00:00Z' },
    { id: 'r-read', task_id: 'p', unread: false, state: 'done', started: '2026-01-01T00:00:00Z', finished: '2026-01-01T01:00:00Z' },
    { id: 'r-arch', task_id: 'p', unread: true, archived: true, state: 'done', started: '2026-01-01T00:00:00Z', finished: '2026-01-01T01:00:00Z' },
    { id: 'r-oldtask', task_id: 'old', unread: true, state: 'done', started: '2026-01-01T00:00:00Z', finished: '2026-01-01T01:00:00Z' },
    { id: 'r-b2', task_id: null, pane_id: 'pane-b-123456789', pane_name: '', unread: true, state: 'done', started: '2026-01-07T00:00:00Z', finished: '2026-01-07T01:00:00Z' },
    { id: 'r-a', task_id: null, pane_id: 'pane-a', pane_name: 'stale name', unread: true, state: 'errored', started: '2026-01-06T00:00:00Z', finished: '2026-01-06T01:00:00Z' },
    { id: 'r-b1', task_id: 'gone', pane_id: 'pane-b-123456789', pane_name: '', unread: true, state: 'done', started: '2026-01-01T12:00:00Z', finished: '2026-01-01T13:00:00Z' },
  ],
  panes: [{ id: 'pane-a', name: 'alpha' }],
});
const ids = rows => rows.map(r => r.id);
const sorted = rows => rows.every((r, i) => !i || (rows[i - 1].oldest ?? rows[i - 1].at) <= (r.oldest ?? r.at));

test('the review queue is at most three levels, each ordered oldest first', () => {
  const q = reviewQueue(reviewData());
  // No task holds the oldest item, so it leads; it is not pinned last.
  expect(ids(q)).toEqual(['none', 'p', 'ui']);
  expect(sorted(q)).toBe(true);
  for (const g of q) {
    expect(sorted(g.items) && sorted(g.groups)).toBe(true);
    expect(g.count).toBe(reviewItems([g]).length);
    expect(g.oldest).toBe(Math.min(...reviewItems([g]).map(i => i.at)));
    for (const s of g.groups) { expect(s.groups).toBeUndefined(); expect(sorted(s.items)).toBe(true); expect(s.items.every(i => !i.items && !i.groups)).toBe(true); }
  }
  // Membership: unread or needs_input unarchived runs, blocked or errored prompts; nothing read, archived, queued or under an archived task.
  expect(ids(reviewItems(q)).sort()).toEqual(['prompt:pb', 'prompt:pe', 'run:r-a', 'run:r-b1', 'run:r-b2', 'run:r-edge', 'run:r-edge2', 'run:r-root', 'run:r-tok'].sort());
});

test('deep descendants flatten to one level labelled with their path; root items sit beside the subgroups', () => {
  const parser = reviewQueue(reviewData()).find(g => g.id === 'p');
  expect(ids(parser.items)).toEqual(['run:r-root']);
  // A run under a prompt follows its prompt's task, as the outline tree does: r-tok lands under Tokenizer, not UI.
  expect(parser.groups.map(s => [s.id, s.title, ids(s.items)])).toEqual([['edge', 'Tokenizer / Edge cases', ['run:r-edge', 'run:r-edge2']], ['tok', 'Tokenizer', ['run:r-tok']]]);
  expect([parser.count, parser.oldest]).toEqual([4, Date.parse('2026-01-03T01:00:00Z')]);
});

test('No task groups by pane, named by the live pane, else the run, else a short id', () => {
  const none = reviewQueue(reviewData())[0];
  expect(none.items).toEqual([]);
  expect(none.groups.map(s => [s.title, ids(s.items)])).toEqual([['pane pane-b-1', ['run:r-b1', 'run:r-b2']], ['alpha', ['prompt:pe', 'run:r-a']]]);
});

test('a task filter keeps that task and all its descendants as the single top group', () => {
  const q = reviewQueue(reviewData(), 'tok');
  expect(q.map(g => [g.id, g.title, g.count, ids(g.items)])).toEqual([['tok', 'Tokenizer', 3, ['run:r-tok']]]);
  expect(q[0].groups.map(s => [s.title, ids(s.items)])).toEqual([['Edge cases', ['run:r-edge', 'run:r-edge2']]]);
  expect(ids(reviewItems(reviewQueue(reviewData(), 'p')))).toEqual(['run:r-root', 'run:r-edge', 'run:r-edge2', 'run:r-tok']);
  expect(reviewQueue(reviewData(), 'missing')).toEqual([]);
});

test('a kept item stays in the queue after it is read', () => {
  expect(ids(reviewItems(reviewQueue(reviewData(), 'p', new Set(['run:r-read']))))).toEqual(['run:r-read', 'run:r-root', 'run:r-edge', 'run:r-edge2', 'run:r-tok']);
});

const railData = () => ({
  tasks: [
    { id: 'a', title: 'Alpha', parent_id: null, status: 'open', archived: false, created: '2026-01-01' },
    { id: 'a1', title: 'Lexer', parent_id: 'a', status: 'open', archived: false, created: '2026-01-02' },
    { id: 'a2', title: 'Edge', parent_id: 'a1', status: 'open', archived: false, created: '2026-01-03' },
    { id: 'b', title: 'Beta', parent_id: null, status: 'open', archived: false, created: '2026-01-04' },
    { id: 'c', title: 'Quiet', parent_id: null, status: 'open', archived: false, created: '2026-01-05' },
    { id: 'd', title: 'Finished', parent_id: null, status: 'done', archived: false, created: '2026-01-06' },
    { id: 'z', title: 'Gone', parent_id: null, status: 'open', archived: true, created: '2026-01-07' },
  ],
  panes: [{ id: 'p1', name: 'worker', state: 'idle' }, { id: 'p2', name: 'reader', state: 'done' }, { id: 'p3', name: 'old', state: 'closed' }, { id: 'p4', name: 'edge', state: 'idle' }],
  prompts: [{ id: 'q1', body: 'cannot run', task_id: 'b', target: 'p1', state: 'blocked', created: '2026-02-01T00:00:00Z', updated: '2026-02-01T00:00:00Z' }, { id: 'q2', body: 'waiting', task_id: 'b', state: 'queued', created: '2026-02-01T00:00:00Z' }],
  runs: [
    { id: 'r1', task_id: 'a', pane_id: 'p1', pane_name: 'worker', state: 'done', unread: true, started: '2026-03-01T10:00:00Z', finished: '2026-03-01T10:05:00Z', prompt: '\n  first thing  \nmore' },
    { id: 'r2', task_id: 'a', pane_id: 'p1', pane_name: 'worker', state: 'idle', unread: true, started: '2026-03-01T11:00:00Z', finished: '2026-03-01T11:05:00Z', prompt: 'second' },
    { id: 'r3', task_id: 'a', pane_id: 'p1', pane_name: 'worker', state: 'needs_input', unread: false, started: '2026-03-01T12:00:00Z', finished: null, prompt: 'third' },
    { id: 'r0', task_id: 'a', pane_id: 'p1', pane_name: 'worker', state: 'done', unread: false, started: '2026-03-01T09:00:00Z', finished: '2026-03-01T09:05:00Z', prompt: 'zeroth' },
    { id: 'r4', task_id: 'a', pane_id: 'p2', pane_name: 'reader', state: 'done', unread: false, started: '2026-03-01T08:00:00Z', finished: '2026-03-01T08:05:00Z', prompt: 'read early' },
    { id: 'r5', task_id: 'a', pane_id: 'p2', pane_name: 'reader', state: 'done', unread: false, started: '2026-03-02T08:00:00Z', finished: '2026-03-02T08:05:00Z', prompt: 'read late' },
    { id: 'r6', task_id: 'a', pane_id: 'p3', pane_name: 'old', state: 'done', unread: false, started: '2026-03-01T07:00:00Z', finished: '2026-03-01T07:05:00Z', prompt: 'closed pane' },
    { id: 'r7', task_id: 'a2', pane_id: 'p4', pane_name: 'edge', state: 'done', unread: true, started: '2026-02-20T07:00:00Z', finished: '2026-02-20T07:05:00Z', prompt: 'deep' },
    { id: 'r8', task_id: 'z', pane_id: 'p4', pane_name: 'edge', state: 'done', unread: true, started: '2026-02-01T07:00:00Z', finished: '2026-02-01T07:05:00Z', prompt: 'archived task' },
    { id: 'r9', task_id: null, pane_id: 'p9', pane_name: 'stray', state: 'unknown', unread: true, started: '2026-01-10T07:00:00Z', finished: '2026-01-10T07:05:00Z', prompt: 'orphan' },
    { id: 'r10', task_id: 'a', pane_id: 'p1', pane_name: 'worker', state: 'done', unread: true, archived: true, started: '2026-03-01T06:00:00Z', finished: '2026-03-01T06:05:00Z', prompt: 'archived run' },
  ],
});
const shape = g => ({ id: g.id, unread: g.unread, rows: g.rows.map(r => [r.id, r.unread, r.lead, r.items.map(i => i.id)]) });
const inds = list => list.map(i => `${i.kind}:${i.count}`).join(' ');

test('the rail shows exactly one row per pane, with everything of the pane rolled up inside it', () => {
  const tree = railTree(railData()), alpha = tree.find(g => g.id === 'a');
  expect(shape(alpha).rows).toEqual([['pane:p1', 3, 'run:r1', ['run:r1', 'run:r2', 'run:r3']], ['pane:p2', 0, 'run:r5', ['run:r5']]]);
  // The summary is the OLDEST waiting item's first line; a pane with nothing waiting shows its latest turn, dimmed.
  expect(alpha.rows[0]).toMatchObject({ kind: 'pane', pane_id: 'p1', name: 'worker', summary: 'first thing', dim: false, working: false });
  expect(alpha.rows[1]).toMatchObject({ name: 'reader', summary: 'read late', dim: true });
  expect(alpha.rows[1].items[0]).toMatchObject({ id: 'run:r5', last: true, unread: false });
  expect(alpha.rows[0].items.map(i => i.word)).toEqual(['done', 'idle', 'needs input']);
  // No pane appears twice under one task, and a closed pane with nothing waiting has no row.
  for (const g of tree.flatMap(t => [t, ...t.groups])) expect(new Set(g.rows.map(r => r.id)).size).toBe(g.rows.length);
  expect(alpha.rows.some(r => r.pane_id === 'p3')).toBe(false);
});

test('the rail is three levels: descendants flatten under their root with a path title, and counts roll up', () => {
  const alpha = railTree(railData()).find(g => g.id === 'a');
  expect(alpha.groups.map(g => [g.id, g.title, g.unread])).toEqual([['a2', 'Lexer / Edge', 1]]);
  expect(alpha.unread).toBe(4);
  expect(alpha.oldest).toBe(Date.parse('2026-02-20T07:05:00Z'));
});

test('rail roots: unread first by oldest waiting, then open tasks by creation, done and archived left out, No task last', () => {
  const tree = railTree(railData());
  expect(tree.map(g => g.id)).toEqual(['b', 'a', 'c', 'none']);
  expect(shape(tree.at(-1))).toEqual({ id: 'none', unread: 1, rows: [['pane:p9', 1, 'run:r9', ['run:r9']]] });
  expect(tree.at(-1).rows[0].name).toBe('stray');
  expect(railTree({ tasks: railData().tasks })).toHaveLength(3);
});

test('a prompt aimed at a pane rolls into that pane\'s row; prompts that name no pane share one Prompts row per task', () => {
  const data = railData();
  data.prompts.push({ id: 'q3', body: 'failed', task_id: 'b', state: 'errored', position: 3, created: '2026-02-03T00:00:00Z', updated: '2026-02-03T00:00:00Z' }, { id: 'q4', body: 'later', task_id: 'b', state: 'queued', position: 1, created: '2026-02-04T00:00:00Z' },
    { id: 'q5', body: 'for the worker', task_id: 'b', target: 'p1', state: 'queued', position: 5, created: '2026-02-05T00:00:00Z' }, { id: 'q6', body: 'sent', task_id: 'b', state: 'done', position: 6 });
  data.prompts.find(p => p.id === 'q2').position = 2;
  const beta = railTree(data).find(g => g.id === 'b');
  expect(shape(beta).rows).toEqual([['pane:p1', 1, 'prompt:q1', ['prompt:q1', 'prompt:q5']], ['prompts', 1, 'prompt:q3', ['prompt:q3', 'prompt:q4', 'prompt:q2']]]);
  expect(beta.rows[1]).toMatchObject({ kind: 'prompts', name: 'Prompts', summary: 'failed', pane_id: '' });
  expect(inds(beta.rows[0].indicators)).toBe('blocked:1 queued:1');
  expect(inds(beta.rows[1].indicators)).toBe('prompt_error:1 queued:2');
  expect(inds(beta.indicators)).toBe('prompt_error:1 blocked:1 queued:3');
  // With nothing blocked or errored the Prompts row is about the next queued prompt, and it is dim.
  const quiet = railTree(railData()).find(g => g.id === 'b').rows.find(r => r.kind === 'prompts');
  expect(quiet).toMatchObject({ summary: 'waiting', lead: 'prompt:q2', dim: true, unread: 0 });
});

test('the open item stays in its pane row once read; the row still leads with the oldest item that really waits', () => {
  const data = railData(); data.runs.find(r => r.id === 'r1').unread = false;
  expect(shape(railTree(data).find(g => g.id === 'a')).rows[0]).toEqual(['pane:p1', 2, 'run:r2', ['run:r2', 'run:r3']]);
  expect(shape(railTree(data, new Set(['run:r1'])).find(g => g.id === 'a')).rows[0]).toEqual(['pane:p1', 2, 'run:r2', ['run:r1', 'run:r2', 'run:r3']]);
  expect(railTree(data, new Set(['run:r6'])).find(g => g.id === 'a').rows.map(r => r.id)).toEqual(['pane:p1', 'pane:p2', 'pane:p3']);
});

test('indicators: one entry per kind in a fixed order, counts summed, read runs silent, a working agent always shown', () => {
  const run = (state, unread, docs = 0) => ({ kind: 'run', rec: { state, unread, docs: Array(docs).fill({}) } }), prompt = state => ({ kind: 'prompt', rec: { state } });
  expect(['working', 'needs_input', 'done', 'errored', 'idle', 'closed', 'unknown', undefined].map(s => itemKind(run(s)))).toEqual(['working', 'needs_input', 'done', 'errored', 'idle', 'ended', 'ended', 'ended']);
  expect(['blocked', 'errored', 'queued', 'running', 'done'].map(s => itemKind(prompt(s)))).toEqual(['blocked', 'prompt_error', 'queued', 'working', 'ended']);
  const all = [run('done', true, 2), run('done', true), run('errored', true, 1), run('idle', true), run('closed', true), run('needs_input', false), run('working', false), run('done', false, 4), prompt('blocked'), prompt('errored'), prompt('queued'), prompt('queued'), prompt('done')];
  expect(inds(indicators(all))).toBe('working:1 needs_input:1 errored:1 prompt_error:1 blocked:1 done:2 idle:1 ended:1 queued:2 doc:3');
  expect(indicators([run('done', false, 3)])).toEqual([]);
  expect(indicators([])).toEqual([]);
  // A pane row is one agent however many of its turns say working.
  expect(inds(indicators([run('working', false), run('working', false)], 1))).toBe('working:1');
  expect(inds(indicators([run('working', false)], 0))).toBe('');
  expect(inds(sumIndicators([indicators(all), indicators([run('done', true, 1), prompt('queued')]), []]))).toBe('working:1 needs_input:1 errored:1 prompt_error:1 blocked:1 done:3 idle:1 ended:1 queued:3 doc:4');
});

test('rail indicators: each row shows everything rolled up in it; groups and roots show the union beneath them', () => {
  const data = railData(), doc = n => ({ kind: 'mdoc', href: 'http://127.0.0.1:4387/items/' + n, title: 'd' + n });
  data.runs.find(r => r.id === 'r1').docs = [doc(1), doc(2)]; data.runs.find(r => r.id === 'r7').docs = [doc(7)];
  data.panes.find(p => p.id === 'p2').state = 'working';
  data.runs.push({ id: 'r11', task_id: 'a', pane_id: 'p2', pane_name: 'reader', state: 'working', unread: false, started: '2026-03-03T08:00:00Z', finished: null, prompt: 'busy now' });
  const alpha = railTree(data).find(g => g.id === 'a'), [worker, reader] = alpha.rows;
  expect(inds(worker.indicators)).toBe('needs_input:1 done:1 idle:1 doc:2');
  expect(reader).toMatchObject({ working: true, dim: false, summary: 'busy now', unread: 0 });
  expect(inds(reader.indicators)).toBe('working:1');
  expect(inds(alpha.groups[0].indicators)).toBe('done:1 doc:1');
  expect(inds(alpha.indicators)).toBe('working:1 needs_input:1 done:2 idle:1 doc:3');
  // The Tasks list uses the same union: a task carries its descendants.
  const by = taskIndicators(data);
  expect(inds(by.get('a').indicators)).toBe(inds(alpha.indicators));
  expect([by.get('a').waiting, by.get('a1').waiting, by.get('a2').waiting, by.get('b').waiting, by.get('none').waiting, by.has('c'), by.has('z')]).toEqual([4, 1, 1, 1, 1, false, false]);
  expect(inds(by.get('a1').indicators)).toBe('done:1 doc:1');
  // A pane is working only where its newest turn lives, not in every task it once ran for.
  data.runs.push({ id: 'r12', task_id: 'c', pane_id: 'p2', pane_name: 'reader', state: 'done', unread: false, started: '2026-01-01T08:00:00Z', finished: '2026-01-01T08:05:00Z', prompt: 'long ago' });
  expect(railTree(data).find(g => g.id === 'c').rows[0]).toMatchObject({ pane_id: 'p2', working: false, dim: true });
});

test('the Queue page is one flat list, oldest first, scoped to everything, a task, a session or a pane', () => {
  const data = railData();
  data.panes[0].session = 's1'; data.panes[3].session = 's2'; for (const r of data.runs) if (r.pane_id === 'p1') r.session = 's1';
  const list = (scope, keep) => queueItems(data, scope, keep).map(i => i.id);
  expect(list()).toEqual(['run:r9', 'prompt:q1', 'run:r7', 'run:r1', 'run:r2', 'run:r3']);
  expect(list({ type: 'all' })).toEqual(list());
  expect(list({ type: 'task', id: 'a' })).toEqual(['run:r7', 'run:r1', 'run:r2', 'run:r3']);
  expect(list({ type: 'task', id: 'a1' })).toEqual(['run:r7']);
  expect(list({ type: 'task', id: 'none' })).toEqual(['run:r9']);
  expect(list({ type: 'task', id: 'z' })).toEqual([]);
  expect(list({ type: 'session', id: 's1' })).toEqual(['prompt:q1', 'run:r1', 'run:r2', 'run:r3']);
  expect(list({ type: 'session', id: 's2' })).toEqual(['run:r7']);
  expect(list({ type: 'pane', id: 'p1' })).toEqual(['prompt:q1', 'run:r1', 'run:r2', 'run:r3']);
  expect(list({ type: 'pane', id: 'nope' })).toEqual([]);
  expect(queueItems(data, { type: 'task', id: 'a' })[0]).toMatchObject({ id: 'run:r7', kind: 'run', ind: 'done', summary: 'deep', task_id: 'a2', task: 'Alpha / Lexer / Edge', pane: 'edge', pane_id: 'p4', session: 's2' });
  expect(queueItems(data)[1]).toMatchObject({ id: 'prompt:q1', ind: 'blocked', summary: 'cannot run', task: 'Beta', pane: 'worker', session: 's1' });
  // It is the same set the review queue holds.
  expect(list().sort()).toEqual(ids(reviewItems(reviewQueue(data))).sort());
  // The open item stays while it is open, in its scope only; once it is let go it leaves.
  data.runs.find(r => r.id === 'r1').unread = false;
  expect(list({ type: 'pane', id: 'p1' })).toEqual(['prompt:q1', 'run:r2', 'run:r3']);
  expect(list({ type: 'pane', id: 'p1' }, new Set(['run:r1']))).toEqual(['prompt:q1', 'run:r1', 'run:r2', 'run:r3']);
  expect(list({ type: 'pane', id: 'p4' }, new Set(['run:r1']))).toEqual(['run:r7']);
});

test('sent prompts retain their context while strict dispatch reports current advisories', () => {
  const busy = [launchedPane({ state: 'working', ready: false })];
  for (const state of ['running', 'done']) {
    expect(pf({ body: 'x', task_id: 'root', target: 'a', pane_id: 'a', state }, busy)).toEqual({ blocks: [], warns: [] });
    expect(pf({ body: 'x', task_id: 'loose', pane_id: 'a', state }, busy)).toEqual({ blocks: [], warns: [] });
  }
  for (const state of ['queued', 'blocked', 'errored']) expect(warnings(pf({ body: 'x', task_id: 'root', target: 'a', state }, busy))).toEqual([['pane_blocked', 'target']]);
  const prompt = { body: 'x', task_id: 'root', target: 'a', state: 'done' };
  expect(warnings(preflight({ prompt, resolved: resolve(prompt, tasks), panes: busy, profiles, strict: true }))).toEqual([['pane_blocked', 'target']]);
  expect(codes(pf({ body: ' ', task_id: 'root', target: 'a', state: 'running' }, busy))).toEqual(['no_text']);
});

test('docsIn finds mdoc item URLs and Markdown links to .md paths, once each, in order, and nothing else', () => {
  const text = 'Saved [guide.md](/Users/x/docs/guide.md) and [the **plan**](docs/plan.md#top), opened [view document](http://127.0.0.1:4387/items/792).\n'
    + 'Also http://127.0.0.1:4387/items/793 and again http://127.0.0.1:4387/items/792 [guide.md](/Users/x/docs/guide.md)\n'
    + '[site](https://example.md) [raw](https://example.com/a.md) [code](src/a.js) [f](file:///a/b.md) http://127.0.0.1:4387/tags/3 notes.md';
  expect(docsIn(text)).toEqual([
    { kind: 'file', href: '/Users/x/docs/guide.md', title: 'guide.md' },
    { kind: 'file', href: 'docs/plan.md', title: 'the plan' },
    { kind: 'mdoc', href: 'http://127.0.0.1:4387/items/792', title: 'view document' },
    { kind: 'mdoc', href: 'http://127.0.0.1:4387/items/793', title: 'mdoc item 793' },
    { kind: 'file', href: 'file:///a/b.md', title: 'f' },
  ]);
  expect(docsIn(text, 2)).toHaveLength(2);
  expect(docsIn('[](a/b.md) [http://127.0.0.1:4387/items/5](http://127.0.0.1:4387/items/5)')).toEqual([{ kind: 'file', href: 'a/b.md', title: 'b.md' }, { kind: 'mdoc', href: 'http://127.0.0.1:4387/items/5', title: 'mdoc item 5' }]);
  for (const none of ['', null, undefined, 'no links here', '[x](y.mdx)']) expect(docsIn(none)).toEqual([]);
});

test('rail docs ride with their run inside the pane row: they follow its read state and add no unread', () => {
  const data = railData(), doc = (n, title) => ({ kind: 'mdoc', href: 'http://127.0.0.1:4387/items/' + n, title });
  const set = (id, docs) => { data.runs.find(r => r.id === id).docs = docs; };
  set('r1', [doc(1, 'one'), { kind: 'file', href: 'docs/a.md', title: 'a.md' }]); set('r2', [doc(2, 'two')]); set('r0', [doc(9, 'read and hidden')]); set('r5', [doc(5, 'five')]);
  const alpha = railTree(data).find(g => g.id === 'a'), [worker, reader] = alpha.rows;
  expect(worker.items[0].docs).toEqual([
    { id: 'doc:r1:0', kind: 'mdoc', href: 'http://127.0.0.1:4387/items/1', title: 'one', run: 'run:r1', unread: true },
    { id: 'doc:r1:1', kind: 'file', href: 'docs/a.md', title: 'a.md', run: 'run:r1', unread: true }]);
  expect(worker.items.map(i => i.docs.map(d => d.title))).toEqual([['one', 'a.md'], ['two'], []]);
  expect(reader.items[0].docs.map(d => [d.title, d.unread])).toEqual([['five', false]]);
  expect(alpha.rows.flatMap(r => r.items).flatMap(i => i.docs).map(d => d.title)).not.toContain('read and hidden');
  expect(alpha.unread).toBe(railTree(railData()).find(g => g.id === 'a').unread);
  expect(inds(worker.indicators)).toBe('needs_input:1 done:1 idle:1 doc:3');
  expect(reader.indicators).toEqual([]);
});

test('an automatic queue that is not moving says why: held, waiting, or never started', () => {
  const q = (id, state, position, extra = {}) => ({ id, task_id: 't', state, position, created: '', target: '', pane_id: '', ...extra });
  const pane = (id, ready, extra = {}) => ({ id, name: id, kind: 'agent', task_id: 't', state: ready ? 'done' : 'working', ready, ...extra });
  // Nothing to say: manual, the No task queue, nothing queued.
  expect(queueStatus([q('a', 'queued', 1)], 't', 'manual', [])).toBe(null);
  expect(queueStatus([{ ...q('a', 'queued', 1), task_id: null }], null, 'auto', [])).toBe(null);
  expect(queueStatus([q('a', 'done', 1), q('b', 'errored', 2)], 't', 'auto', [])).toBe(null);
  // Held by the earliest earlier prompt that is blocked or errored; one of another task or a later one does not hold.
  expect(queueStatus([q('e', 'errored', 1), q('b', 'blocked', 2), q('n', 'queued', 3)], 't', 'auto', [pane('p', false)])).toMatchObject({ state: 'held', next: 'n', by: 'e', pane: null });
  expect(queueStatus([q('b', 'blocked', 2), q('n', 'queued', 3)], 't', 'auto')).toMatchObject({ state: 'held', by: 'b' });
  expect(queueStatus([{ ...q('x', 'blocked', 1), task_id: 'other' }, q('n', 'queued', 3), q('late', 'errored', 4)], 't', 'auto')).toMatchObject({ state: 'start', by: null });
  // A running prompt ahead, or a busy pane, ends by itself.
  expect(queueStatus([q('r', 'running', 1, { pane_id: 'p' }), q('n', 'queued', 3)], 't', 'auto', [pane('p', false)])).toMatchObject({ state: 'waiting', next: 'n', by: 'r', pane: 'p' });
  expect(queueStatus([q('n', 'queued', 3)], 't', 'auto', [pane('idle', true), pane('busy', false), pane('else', false, { task_id: 'other' })])).toMatchObject({ state: 'waiting', next: 'n', by: null, pane: 'busy' });
  // A prompt that names a pane waits for that pane only; a closed one is no pane at all.
  expect(queueStatus([q('n', 'queued', 3, { target: 'named' })], 't', 'auto', [pane('busy', false), pane('named', true, { task_id: 'other' })])).toMatchObject({ state: 'start' });
  expect(queueStatus([q('n', 'queued', 3, { target: 'named' })], 't', 'auto', [pane('named', false, { task_id: 'other' })])).toMatchObject({ state: 'waiting', pane: 'named' });
  expect(queueStatus([q('n', 'queued', 3)], 't', 'auto', [pane('gone', false, { state: 'closed' }), pane('sh', false, { kind: 'shell' })])).toMatchObject({ state: 'start', next: 'n', by: null, pane: null });
});

test('a run is filed under its prompt\'s task, and under its own only when it has no prompt', () => {
  const prompts = new Map([['p1', { id: 'p1', task_id: 'from-prompt' }], ['p0', { id: 'p0', task_id: null }]]);
  expect(runTask({ prompt_id: 'p1', task_id: 'own' }, prompts)).toBe('from-prompt');
  expect(runTask({ prompt_id: 'p0', task_id: 'own', inherits: 'ancestor' }, prompts)).toBe(null);
  expect(runTask({ prompt_id: 'deleted', task_id: 'own' }, prompts)).toBe('own');
  expect(runTask({ prompt_id: null, task_id: 'own' }, prompts)).toBe('own');
  expect(runTask({ task_id: undefined }, { p1: { task_id: 'x' } })).toBe(null);
  // The rail and the review queue use the same rule.
  const data = { tasks: [{ id: 'a', title: 'A', created: '1' }, { id: 'b', title: 'B', created: '2' }], prompts: [{ id: 'p', task_id: 'b', state: 'done', body: 'x', position: 1 }], runs: [{ id: 'r', prompt_id: 'p', task_id: 'a', unread: 1, state: 'done', started: '2026-01-01T00:00:00Z', prompt: 'x' }], panes: [] };
  expect(railTree(data).find(g => g.rows.length).id).toBe('b');
  expect(reviewQueue(data).map(g => g.id)).toEqual(['b']);
});

// A pane opened by hand in a task's session has no task of its own; the server names the one it inherits, and never overwrites task_id.
const inheritData = () => ({
  tasks: [{ id: 'a', title: 'Alpha', parent_id: null, status: 'open', archived: false, created: '2026-01-01' }, { id: 'b', title: 'Beta', parent_id: null, status: 'open', archived: false, created: '2026-01-02' }],
  panes: [
    { id: 'h1', name: 'hand', kind: 'agent', state: 'idle', session: 'inbox-a', task_id: null, inherits: 'a' },
    { id: 'm1', name: 'mixed', kind: 'agent', state: 'idle', session: 's', task_id: 'b', inherits: null },
    { id: 'e1', name: 'fresh', kind: 'agent', state: 'idle', session: 'inbox-a', task_id: null, inherits: 'a' },
    { id: 'e2', name: '', kind: 'agent', state: 'idle', session: 's', task_id: 'b', inherits: null },
    { id: 'sh123456789', name: '', kind: 'shell', state: 'idle', session: 'other', task_id: null, inherits: null },
    { id: 'gone', name: 'gone', kind: 'shell', state: 'closed', session: 'other', task_id: null, inherits: null },
  ],
  prompts: [{ id: 'q0', body: 'no task prompt', task_id: null, state: 'done', position: 1 }, { id: 'qb', body: 'stuck', task_id: 'b', target: 'm1', state: 'blocked', created: '2026-03-03T00:00:00Z', updated: '2026-03-03T00:00:00Z' }],
  runs: [
    { id: 'turn:i1', task_id: null, inherits: 'a', pane_id: 'h1', session: 'inbox-a', state: 'done', unread: true, started: '2026-03-01T10:00:00Z', finished: '2026-03-01T10:05:00Z', prompt: 'by hand' },
    { id: 'turn:i2', task_id: null, inherits: 'a', pane_id: 'h1', session: 'inbox-a', state: 'needs_input', unread: true, started: '2026-03-01T11:00:00Z', finished: null, prompt: 'asking' },
    // an older turn of an assigned pane that never got the task: it inherits the pane's
    { id: 'turn:m1', task_id: null, inherits: 'b', pane_id: 'm1', session: 's', state: 'done', unread: true, started: '2026-03-02T10:00:00Z', finished: '2026-03-02T10:05:00Z', prompt: 'older' },
    { id: 'turn:m2', task_id: 'b', inherits: null, pane_id: 'm1', session: 's', state: 'done', unread: true, started: '2026-03-02T11:00:00Z', finished: '2026-03-02T11:05:00Z', prompt: 'newer' },
    { id: 'turn:m3', prompt_id: 'q0', task_id: null, inherits: 'b', pane_id: 'm1', session: 's', state: 'done', unread: false, started: '2026-03-02T12:00:00Z', finished: '2026-03-02T12:05:00Z', prompt: 'no task prompt' },
    { id: 'turn:x1', task_id: null, inherits: null, pane_id: 'old', pane_name: 'old', session: 'other', state: 'done', unread: true, started: '2026-03-04T10:00:00Z', finished: '2026-03-04T10:05:00Z', prompt: 'stray' },
  ],
});
test('a run with no task of its own is filed under the one it inherits, in the rail, the review queue and the Queue page', () => {
  const data = inheritData(), prompts = new Map(data.prompts.map(p => [p.id, p]));
  expect(data.runs.map(r => runTask(r, prompts))).toEqual(['a', 'a', 'b', 'b', null, null]);
  expect(runTask({ task_id: 'own', inherits: 'x' }, prompts)).toBe('own');
  expect(runTask({ prompt_id: 'qb', task_id: null, inherits: 'x' }, prompts)).toBe('b');
  expect(paneTask(data.panes[0])).toBe('a'); expect(paneTask(data.panes[1])).toBe('b'); expect(paneTask(data.panes[4])).toBe(null);
  const tree = railTree(data), rowsOf = id => tree.find(g => g.id === id).rows;
  // One row per pane and owner; an explicit No task prompt stays separate from its pane's inherited task.
  expect(rowsOf('none').find(r => r.pane_id === 'm1').items.map(i => i.id)).toEqual(['run:turn:m3']);
  expect(rowsOf('a').find(r => r.pane_id === 'h1')).toMatchObject({ unread: 2, via: true, empty: false, lead: 'run:turn:i1' });
  expect(rowsOf('b').find(r => r.pane_id === 'm1')).toMatchObject({ unread: 3, via: false });
  expect(rowsOf('b').find(r => r.pane_id === 'm1').items.map(i => i.id)).toEqual(['run:turn:m1', 'run:turn:m2', 'prompt:qb']);
  expect(rowsOf('none').map(r => r.pane_id).sort()).toEqual(['m1', 'old', 'sh123456789']);
  const list = scope => queueItems(data, scope).map(i => i.id);
  expect(list({ type: 'task', id: 'a' })).toEqual(['run:turn:i1', 'run:turn:i2']);
  expect(list({ type: 'task', id: 'b' })).toEqual(['run:turn:m1', 'run:turn:m2', 'prompt:qb']);
  expect(list({ type: 'task', id: 'none' })).toEqual(['run:turn:x1']);
  expect(queueItems(data, { type: 'pane', id: 'h1' })[0]).toMatchObject({ task_id: 'a', task: 'Alpha' });
  expect(reviewQueue(data).map(g => [g.id, g.count])).toEqual([['a', 2], ['b', 3], ['none', 1]]);
  expect(taskIndicators(data).get('a').waiting).toBe(2);
  // Without the field nothing is inherited: the payload decides, not the model.
  for (const r of data.runs) r.inherits = null; for (const p of data.panes) p.inherits = null;
  expect(list({ type: 'task', id: 'a' })).toEqual([]);
  expect(railTree(data).find(g => g.id === 'none').rows.map(r => r.pane_id).sort()).toEqual(['e1', 'h1', 'm1', 'old', 'sh123456789']);
});
test('every pane that is not closed has a row, even with no turns: under its task, the one it inherits, or No task', () => {
  const tree = railTree(inheritData()), row = id => tree.flatMap(g => g.rows.map(r => ({ ...r, owner: g.id }))).filter(r => r.pane_id === id);
  expect(row('e1')).toEqual([expect.objectContaining({ owner: 'a', empty: true, via: true, dim: true, unread: 0, lead: null, summary: '', items: [], indicators: [], name: 'fresh', pane_kind: 'agent' })]);
  expect(row('e2')).toEqual([expect.objectContaining({ owner: 'b', empty: true, via: false, name: '' })]);
  expect(row('sh123456789')).toEqual([expect.objectContaining({ owner: 'none', empty: true, pane_kind: 'shell', dim: true })]);
  expect(row('gone')).toEqual([]);
  // Empty rows come after the rows that have something, and add nothing to the counts.
  expect(tree.find(g => g.id === 'a')).toMatchObject({ unread: 2 });
  expect(tree.find(g => g.id === 'a').rows.map(r => r.pane_id)).toEqual(['h1', 'e1']);
  // A pane whose task is archived is still shown, under No task.
  const data = inheritData(); data.tasks[0].archived = true;
  expect(railTree(data).find(g => g.id === 'none').rows.map(r => r.pane_id)).toContain('e1');
});
test('queue counts are the length of the list each scope shows, and Mark all read takes the unread turns of the scope only', () => {
  for (const data of [railData(), inheritData()]) {
    const count = queueCounts(data), scopes = [{ type: 'all' }, { type: 'task', id: 'none' }, ...data.tasks.map(t => ({ type: 'task', id: t.id })), ...data.panes.map(p => ({ type: 'pane', id: p.id })), { type: 'pane', id: 'old' }, { type: 'pane', id: 'nope' }, ...['s', 'other', 'inbox-a'].map(id => ({ type: 'session', id }))];
    for (const s of scopes) expect([s, count(s)]).toEqual([s, queueItems(data, s).length]);
    expect(count()).toBe(queueItems(data).length);
  }
  const data = inheritData(), marks = scope => markable(queueItems(data, scope));
  // The turn on a question and the blocked prompt stay.
  expect(marks({ type: 'all' })).toEqual(['turn:i1', 'turn:m1', 'turn:m2', 'turn:x1']);
  expect(marks({ type: 'task', id: 'a' })).toEqual(['turn:i1']);
  expect(marks({ type: 'pane', id: 'm1' })).toEqual(['turn:m1', 'turn:m2']);
  expect(marks({ type: 'session', id: 'other' })).toEqual(['turn:x1']);
  // The open item, kept in the list once read, is not counted again.
  data.runs[0].unread = false;
  expect(markable(queueItems(data, { type: 'task', id: 'a' }, new Set(['run:turn:i1'])))).toEqual([]);
});
