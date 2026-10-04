import { expect, test } from 'bun:test';
import { buildBuckets, nextAfter, byOldest, UNASSIGNED } from './public/queue-model.js';

const t = (id, updated, extra = {}) => ({ id, type: 'turn', status: 'complete', unread: 1, archived: 0, task_id: 'A', agent_id: 'w1', agent_name: 'writer', updated, ...extra });
const items = [
  t('turn:3', '2026-03-03T00:00:00Z'),
  t('turn:1', '2026-03-01T00:00:00Z'),
  t('turn:2', '2026-03-02T00:00:00Z', { agent_id: 'w2', agent_name: 'reviewer' }),
  t('turn:read', '2026-02-01T00:00:00Z', { unread: 0 }),
  t('turn:archived', '2026-02-01T00:00:00Z', { archived: 1 }),
  t('turn:working', '2026-01-01T00:00:00Z', { status: 'working' }),
  t('thread:b', '2026-02-15T00:00:00Z', { type: 'system', task_id: 'B', agent_id: null, agent_name: '' }),
  t('thread:none', '2026-02-20T00:00:00Z', { type: 'mail', task_id: null }),
  t('thread:cmd', '2026-01-15T00:00:00Z', { type: 'command', task_id: 'A' }),
  t('thread:cmd2', '2026-01-16T00:00:00Z', { type: 'command', task_id: null }),
];
const tasks = [{ id: 'A', title: 'Alpha' }, { id: 'B', title: 'Beta' }, { id: 'C', title: 'Quiet' }, { id: 'D', title: 'Gone', archived: 1 }];
const reviewable = row => row.status !== 'working';

test('rows are oldest first and exclude read, archived and unfinished work', () => {
  const { all } = buildBuckets({ tasks, items, reviewable });
  expect(all.rows.map(r => r.id)).toEqual(['thread:b', 'thread:none', 'turn:1', 'turn:2', 'turn:3']);
});

test('one bucket per task plus unassigned; busy buckets first by longest wait, empty last', () => {
  const { buckets } = buildBuckets({ tasks, items, reviewable });
  expect(buckets.map(b => [b.id, b.count])).toEqual([['B', 1], [UNASSIGNED, 1], ['A', 3], ['C', 0]]);
  expect(buckets.find(b => b.id === 'A').rows.map(r => r.id)).toEqual(['turn:1', 'turn:2', 'turn:3']);
});

test('shell commands are split into their own sub-bucket and never count toward the queue', () => {
  const { all, buckets } = buildBuckets({ tasks, items, reviewable });
  expect(all.commands.map(r => r.id)).toEqual(['thread:cmd', 'thread:cmd2']);
  expect(all.rows.some(r => r.type === 'command')).toBe(false);
  expect(buckets.find(b => b.id === 'A')).toMatchObject({ count: 3, commandCount: 1 });
  expect(buckets.find(b => b.id === UNASSIGNED)).toMatchObject({ count: 1, commandCount: 1 });
});

test('agents inside a bucket are counted and the top one comes first', () => {
  const { buckets } = buildBuckets({ tasks, items, reviewable });
  expect(buckets.find(b => b.id === 'A').agents).toEqual([{ id: 'w1', name: 'writer', count: 2 }, { id: 'w2', name: 'reviewer', count: 1 }]);
  expect(buckets.find(b => b.id === 'B').agents).toEqual([{ id: '', name: 'No agent', count: 1 }]);
});

test('nextAfter walks down the queue, falls back to the previous row, then to nothing', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  expect(nextAfter(rows, 'a')).toBe('b');
  expect(nextAfter(rows, 'c')).toBe('b');
  expect(nextAfter(rows, 'zzz')).toBe('a');
  expect(nextAfter([{ id: 'a' }], 'a')).toBe(null);
});

test('byOldest is a stable total order even without timestamps', () => {
  const rows = [{ id: 'b' }, { id: 'a', updated: 'not a date' }, { id: 'c', updated: '2026-01-01T00:00:00Z' }];
  expect([...rows].sort(byOldest).map(r => r.id)).toEqual(['a', 'b', 'c']);
});
