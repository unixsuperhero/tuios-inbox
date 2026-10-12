import { expect, test } from 'bun:test';
import { DEFAULTS, FIELDS, resolve, preflight, nextInQueue, queueHeld, pickPane, profileFor, ompTodos } from './public/outline-model.js';

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
