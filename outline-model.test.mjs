import { expect, test } from 'bun:test';
import { DEFAULTS, FIELDS, resolve, preflight, nextInQueue, queueHeld, pickPane, profileFor, ompTodos, reviewQueue, railTree, reviewItems } from './public/outline-model.js';

const tasks = {
  root: { id: 'root', parent_id: null, repo: '/r', branch: 'fix-parser', harness: '', model: 'gpt', queue_mode: 'auto', session: 'work', workspace: 2 },
  kid: { id: 'kid', parent_id: 'root', repo: '', branch: '', harness: 'claude-code', model: '', queue_mode: '', session: '', workspace: null },
  lone: { id: 'lone', parent_id: null, path: '', branch: '' },
};
const profiles = [{ id: 'omp', executable: 'omp' }, { id: 'claude', executable: 'claude' }];

test('a missing field is looked up through the prompt, its task, the parents, then the default', () => {
  const r = resolve({ id: 'p', body: 'x', task_id: 'kid', harness: '', model: 'opus' }, tasks);
  expect(Object.keys(r)).toEqual(FIELDS);
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
  expect(r.harness).toEqual({ value: DEFAULTS.harness, from: 'default' });
  expect(r.queue_mode).toEqual({ value: 'manual', from: 'default' });
  expect(r.repo).toEqual({ value: null, from: 'none' });
  expect(resolve({ id: 't', parent_id: null, path: '/p' }, {}).repo).toEqual({ value: '/p', from: 'self' });
  expect(resolve({ id: 't', parent_id: null, own: { repo: '/o' } }, {}).repo).toEqual({ value: '/o', from: 'self' });
  const loop = { a: { id: 'a', parent_id: 'b' }, b: { id: 'b', parent_id: 'a' } };
  expect(resolve(loop.a, loop).repo.from).toBe('none');
});

const pf = (prompt, panes = [], git = null) => preflight({ prompt, resolved: resolve(prompt, tasks), panes, git, profiles });
const codes = r => r.blocks.map(b => b.code);
test('preflight names every block with its fix', () => {
  expect(pf({ body: ' ', task_id: 'root' }).blocks).toEqual([{ code: 'no_text', message: 'No text to send', fix: 'body' }]);
  expect(codes(pf({ body: 'x', task_id: null }))).toEqual(['nowhere']);
  expect(pf({ body: 'x', task_id: 'lone' }).blocks[0].fix).toBe('repo');
  expect(codes(pf({ body: 'x', task_id: 'root', harness: 'gemini' }))).toEqual(['no_harness']);
  expect(codes(pf({ body: 'x', task_id: 'kid' }))).toEqual([]);
  expect(codes(pf({ body: 'x', target: 'gone' }))).toEqual(['pane_gone']);
  expect(codes(pf({ body: 'x', target: 'a' }, [{ id: 'a', state: 'closed' }]))).toEqual(['pane_gone']);
  expect(codes(pf({ body: 'x', target: 'a' }, [{ id: 'a', state: 'needs_input' }]))).toEqual(['pane_blocked']);
  expect(codes(pf({ body: 'x', target: 'a' }, [{ id: 'a', state: 'working', ready: false }]))).toEqual(['pane_blocked']);
  expect(codes(pf({ body: 'x', target: 'a' }, [{ id: 'a', state: 'idle', ready: true }]))).toEqual([]);
  // A task's own resting agent stands in for a repo.
  expect(codes(pf({ body: 'x', task_id: 'lone' }, [{ id: 'a', task_id: 'lone', kind: 'agent', state: 'done', ready: true }]))).toEqual([]);
});
test('preflight warns without blocking', () => {
  const git = { state: 'ok', head: 'main', dirty: true, pr: { checks: 'failing' } };
  const r = pf({ body: 'x', task_id: 'root' }, [], git);
  expect(r.blocks).toEqual([]);
  expect(r.warns.map(w => w.code)).toEqual(['branch_mismatch', 'dirty', 'checks_failing']);
  expect(pf({ body: 'x', task_id: 'root' }, [], { state: 'ok', head: 'fix-parser', dirty: false, pr: null }).warns).toEqual([]);
  expect(pf({ body: 'x', task_id: 'root' }, [], { state: 'not_a_repo' }).warns).toEqual([]);
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
test('profiles and resting panes are matched for a run', () => {
  expect(profileFor('claude-code', profiles).id).toBe('claude');
  expect(profileFor('nope', profiles)).toBe(null);
  expect(pickPane({ task_id: null }, [{ id: 'a', task_id: null, kind: 'agent', ready: true }])).toBe(null);
  expect(pickPane({ task_id: 't' }, [{ id: 's', task_id: 't', kind: 'shell', ready: true }, { id: 'a', task_id: 't', kind: 'agent', ready: true }]).id).toBe('a');
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
const shape = g => ({ id: g.id, unread: g.unread, items: g.items.map(i => [i.id, i.unread, i.word, i.newer.map(n => n.id)]) });

test('the rail shows one entry per pane: the oldest waiting run, with the newer ones stacked behind it', () => {
  const tree = railTree(railData()), alpha = tree.find(g => g.id === 'a');
  expect(shape(alpha).items).toEqual([['run:r1', true, 'done', ['run:r2', 'run:r3']], ['run:r5', false, 'done', []]]);
  expect(alpha.items[0]).toMatchObject({ summary: 'first thing', pane_name: 'worker', kind: 'run' });
  expect(alpha.items[0].newer.map(n => n.word)).toEqual(['idle', 'needs input']);
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
  expect(shape(tree[0]).items).toEqual([['prompt:q1', true, 'blocked', []]]);
  expect(shape(tree.at(-1))).toEqual({ id: 'none', unread: 1, items: [['run:r9', true, 'ended', []]] });
  expect(railTree({ tasks: railData().tasks })).toHaveLength(3);
});

test('the open item stays in the rail once read, at the head of its pane stack', () => {
  const data = railData(); data.runs.find(r => r.id === 'r1').unread = false;
  expect(shape(railTree(data).find(g => g.id === 'a')).items[0]).toEqual(['run:r2', true, 'idle', ['run:r3']]);
  expect(shape(railTree(data, new Set(['run:r1'])).find(g => g.id === 'a')).items[0]).toEqual(['run:r1', false, 'done', ['run:r2', 'run:r3']]);
  const closed = railTree(data, new Set(['run:r6'])).find(g => g.id === 'a').items.map(i => i.id);
  expect(closed).toEqual(['run:r2', 'run:r5', 'run:r6']);
});

test('a sent prompt does not report its own pane being busy; the moment of running stays strict', () => {
  const busy = [{ id: 'p1', task_id: 'child', kind: 'agent', state: 'working', ready: false }];
  for (const state of ['running', 'done']) {
    expect(pf({ body: 'x', task_id: 'child', target: 'p1', pane_id: 'p1', state }, busy).blocks).toEqual([]);
    expect(pf({ body: 'x', task_id: 'loose', pane_id: 'p1', state }, busy).blocks).toEqual([]);
  }
  for (const state of ['queued', 'blocked', 'errored']) expect(pf({ body: 'x', task_id: 'child', target: 'p1', state }, busy).blocks.map(b => b.code)).toEqual(['pane_blocked']);
  expect(preflight({ prompt: { body: 'x', task_id: 'child', target: 'p1', state: 'done' }, resolved: resolve({ task_id: 'child' }, tasks), panes: busy, profiles, strict: true }).blocks.map(b => b.code)).toEqual(['pane_blocked']);
  expect(pf({ body: ' ', task_id: 'child', target: 'p1', state: 'running' }, busy).blocks.map(b => b.code)).toEqual(['no_text']);
});
