import { expect, test } from 'bun:test';
import { applyQuery } from './public/list.js';

const rows = [
  { id: 'a', status: 'done',    title: 'Fix the Login bug', task: 't1', agent: 'w1', count: 3,    unread: 1, updated: '2026-03-01T10:00:00Z' },
  { id: 'b', status: 'working', title: 'write docs',        task: null, agent: 'w2', count: 0,    unread: 0, updated: '2026-01-01T10:00:00Z' },
  { id: 'c', status: 'done',    title: 'Ångström units',    task: '',   agent: 'w1', count: 12,   unread: 0, updated: null },
  { id: 'd', status: null,      title: '',                  task: 't2', agent: null, count: null, unread: 1, updated: '2026-02-01T10:00:00Z' },
  { id: 'e', status: 'errored', title: 'apple pie',         task: 't1', agent: 'w2', count: 7,    unread: 0, updated: '' },
];
const agents = [{ value: 'w1', label: 'Zed reviewer' }, { value: 'w2', label: 'alpha builder' }];
const fields = [
  { key: 'status', label: 'Status', type: 'enum', filter: true, sort: true },
  { key: 'title', label: 'Title', type: 'text', filter: true, sort: true, search: true },
  { key: 'task', label: 'Task', type: 'enum', filter: true },
  { key: 'agent', label: 'Agent', type: 'enum', options: () => agents, filter: true, sort: true, search: true },
  { key: 'count', label: 'Count', type: 'number', filter: true, sort: true },
  { key: 'unread', label: 'Unread', type: 'bool', filter: true, sort: true },
  { key: 'updated', label: 'Updated', type: 'date', filter: true, sort: true },
  { key: 'len', label: 'Title length', type: 'number', get: row => row.title.length, filter: true, sort: true },
  { key: 'secret', label: 'Not filterable', type: 'text', get: row => row.id },
];
const ids = query => applyQuery(rows, fields, { search: '', filters: [], sort: null, ...query }).map(row => row.id).join('');
const filter = (key, op, value) => ids({ filters: [{ key, op, value }] });

test('an empty query returns every row in input order, as a new array', () => {
  const out = applyQuery(rows, fields, { search: '', filters: [], sort: null });
  expect(out).toEqual(rows);
  expect(out).not.toBe(rows);
  expect(applyQuery(rows, fields, {})).toEqual(rows);
});

test('enum: is / is not / has / has no', () => {
  expect(filter('status', 'is', 'done')).toBe('ac');
  expect(filter('status', 'is_not', 'done')).toBe('bde');
  expect(filter('status', 'has')).toBe('abce');
  expect(filter('status', 'has_not')).toBe('d');
  expect(filter('task', 'has')).toBe('ade');
  expect(filter('task', 'has_not')).toBe('bc');
});

test('text: is / is not mean contains / does not contain, ignoring case', () => {
  expect(filter('title', 'is', 'LOGIN')).toBe('a');
  expect(filter('title', 'is_not', 'login')).toBe('bcde');
  expect(filter('title', 'has')).toBe('abce');
  expect(filter('title', 'has_not')).toBe('d');
});

test('number: is / is not compare the string form; 0 counts as absent', () => {
  expect(filter('count', 'is', '3')).toBe('a');
  expect(filter('count', 'is', '0')).toBe('b');
  expect(filter('count', 'is_not', '3')).toBe('bcde');
  expect(filter('count', 'has')).toBe('ace');
  expect(filter('count', 'has_not')).toBe('bd');
  expect(filter('len', 'is', '0')).toBe('d');
});

test('bool: compares Boolean(value) against true / false', () => {
  expect(filter('unread', 'is', 'true')).toBe('ad');
  expect(filter('unread', 'is', 'false')).toBe('bce');
  expect(filter('unread', 'is_not', 'true')).toBe('bce');
  expect(filter('unread', 'has')).toBe('ad');
  expect(filter('unread', 'has_not')).toBe('bce');
});

test('date: only has / has no; is / is not are ignored', () => {
  expect(filter('updated', 'has')).toBe('abd');
  expect(filter('updated', 'has_not')).toBe('ce');
  expect(filter('updated', 'is', '2026-03-01T10:00:00Z')).toBe('abcde');
  expect(filter('updated', 'is_not', '2026-03-01T10:00:00Z')).toBe('abcde');
});

test('filters are ANDed; unknown, unfilterable and malformed ones are ignored', () => {
  expect(ids({ filters: [{ key: 'status', op: 'is', value: 'done' }, { key: 'task', op: 'has' }] })).toBe('a');
  expect(ids({ filters: [{ key: 'status', op: 'is_not', value: 'done' }, { key: 'unread', op: 'is', value: 'true' }, { key: 'agent', op: 'has_not' }] })).toBe('d');
  expect(filter('nope', 'is', 'x')).toBe('abcde');
  expect(filter('secret', 'is', 'a')).toBe('abcde');
  expect(filter('status', 'between', 'done')).toBe('abcde');
  expect(ids({ filters: [{ key: 'nope', op: 'has_not' }, { key: 'status', op: 'is', value: 'errored' }] })).toBe('e');
});

test('search: case-insensitive substring over searchable fields, enum labels included', () => {
  expect(ids({ search: 'LOGIN' })).toBe('a');
  expect(ids({ search: '  docs ' })).toBe('b');
  expect(ids({ search: 'zed' })).toBe('ac');       // option label of agent w1
  expect(ids({ search: 'w2' })).toBe('be');        // raw enum value
  expect(ids({ search: 'done' })).toBe('');        // status is not searchable
  expect(ids({ search: '' })).toBe('abcde');
  expect(ids({ search: 'alpha', filters: [{ key: 'status', op: 'is_not', value: 'working' }] })).toBe('e');
});

test('sort: text and enum by case-insensitive locale order, absent last both ways', () => {
  expect(ids({ sort: { key: 'title', dir: 'asc' } })).toBe('ceabd');
  expect(ids({ sort: { key: 'title', dir: 'desc' } })).toBe('baecd');
  expect(ids({ sort: { key: 'status', dir: 'asc' } })).toBe('acebd');
  expect(ids({ sort: { key: 'status', dir: 'desc' } })).toBe('beacd');
  expect(ids({ sort: { key: 'agent', dir: 'asc' } })).toBe('beacd');   // by label: alpha builder < Zed reviewer
});

test('sort: numbers, bools and dates; absent last both ways; stable', () => {
  expect(ids({ sort: { key: 'count', dir: 'asc' } })).toBe('baecd');
  expect(ids({ sort: { key: 'count', dir: 'desc' } })).toBe('ceabd');
  expect(ids({ sort: { key: 'unread', dir: 'asc' } })).toBe('bcead');
  expect(ids({ sort: { key: 'unread', dir: 'desc' } })).toBe('adbce');
  expect(ids({ sort: { key: 'updated', dir: 'asc' } })).toBe('bdace');
  expect(ids({ sort: { key: 'updated', dir: 'desc' } })).toBe('adbce');
  expect(ids({ sort: { key: 'len', dir: 'desc' } })).toBe('acbed');
});

test('sort: null or an unknown key keeps input order; sort combines with filters', () => {
  expect(ids({ sort: null })).toBe('abcde');
  expect(ids({ sort: { key: 'nope', dir: 'desc' } })).toBe('abcde');
  expect(ids({ filters: [{ key: 'task', op: 'has' }], sort: { key: 'count', dir: 'desc' } })).toBe('ead');
});

test('the input array and its rows are not modified', () => {
  const copy = structuredClone(rows);
  applyQuery(rows, fields, { search: 'a', filters: [{ key: 'status', op: 'has' }], sort: { key: 'title', dir: 'desc' } });
  expect(rows).toEqual(copy);
});
