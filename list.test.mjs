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
// An instant as the datetime-local value (local time, minute precision) the picker would produce for it.
const local = iso => { const d = new Date(iso); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); };
const between = (from, to, key = 'updated') => ids({ filters: [{ key, op: 'between', ...(from && { from: local(from) }), ...(to && { to: local(to) }) }] });

test('an empty query returns every row in input order, as a new array', () => {
  const out = applyQuery(rows, fields, { search: '', filters: [], sort: null });
  expect(out).toEqual(rows);
  expect(out).not.toBe(rows);
  expect(applyQuery(rows, fields, {})).toEqual(rows);
});

const items = [
  { id: 'turn-zulu', type: 'turn', title: 'Zulu fix', task: 't1', unread: 1, updated: '2026-03-01T10:00:00Z' },
  { id: 'command-alpha', type: 'command', title: 'Alpha fix', task: 't1', unread: 1, updated: '2026-01-01T10:00:00Z' },
  { id: 'turn-beta', type: 'turn', title: 'Beta fix', task: 't1', unread: 0, updated: '2026-02-01T10:00:00Z' },
  { id: 'command-docs', type: 'command', title: 'Write docs', task: 't2', unread: 1, updated: '2026-04-01T10:00:00Z' },
  { id: 'note', type: 'note', title: 'Fix notes', task: 't1', unread: 1, updated: null },
];
const itemIds = query => applyQuery(items, fields, query).map(row => row.id);

test('All includes every item type when toggles are absent, cleared or malformed', () => {
  const expected = ['turn-zulu', 'command-alpha', 'turn-beta', 'command-docs', 'note'];
  expect(itemIds({})).toEqual(expected);
  expect(itemIds({ types: [] })).toEqual(expected);
  expect(itemIds({ types: 'turn' })).toEqual(expected);
  expect(itemIds({ types: ['obsolete'] })).toEqual(expected);
  expect(itemIds({ types: ['turn', 'obsolete', 'turn'] })).toEqual(['turn-zulu', 'turn-beta']);
});

test('Turns and Commands independently narrow the list and together form a union', () => {
  expect(itemIds({ types: ['turn'] })).toEqual(['turn-zulu', 'turn-beta']);
  expect(itemIds({ types: ['command'] })).toEqual(['command-alpha', 'command-docs']);
  expect(itemIds({ types: ['command', 'turn', 'command'] })).toEqual(['turn-zulu', 'command-alpha', 'turn-beta', 'command-docs']);
});

test('the item-type union is ANDed with ordinary filters, search and sort', () => {
  const query = {
    types: ['turn', 'command'],
    filters: [{ key: 'task', op: 'is', value: 't1' }, { key: 'unread', op: 'is', value: 'true' }],
    search: 'fix',
    sort: { key: 'title', dir: 'asc' },
  };
  expect(itemIds(query)).toEqual(['command-alpha', 'turn-zulu']);
  expect(itemIds({ ...query, types: ['turn'] })).toEqual(['turn-zulu']);
  expect(itemIds({ ...query, types: [], sort: { key: 'updated', dir: 'desc' } })).toEqual(['turn-zulu', 'command-alpha', 'note']);
  expect(itemIds({ ...query, filters: [...query.filters, { key: 'updated', op: 'between', from: local('2026-02-01T00:00:00Z') }] })).toEqual(['turn-zulu']);
});

test('item type filtering respects a computed type field without modifying rows or query', () => {
  const records = [{ id: 'reply', kind: 'turn' }, { id: 'run', kind: 'command' }, { id: 'metadata', kind: 'note' }];
  const query = { types: ['command', 'turn', 'command'], filters: [], sort: null };
  const before = structuredClone({ records, query });
  expect(applyQuery(records, [{ key: 'type', get: row => row.kind }], query).map(row => row.id)).toEqual(['reply', 'run']);
  expect({ records, query }).toEqual(before);
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

test('date: has / has no; is / is not are ignored', () => {
  expect(filter('updated', 'has')).toBe('abd');
  expect(filter('updated', 'has_not')).toBe('ce');
  expect(filter('updated', 'is', '2026-03-01T10:00:00Z')).toBe('abcde');
  expect(filter('updated', 'is_not', '2026-03-01T10:00:00Z')).toBe('abcde');
});

test('date: between with both bounds, either one alone, inclusive edges', () => {
  expect(between('2026-01-15T00:00:00Z', '2026-02-15T00:00:00Z')).toBe('d');
  expect(between('2026-01-15T00:00:00Z')).toBe('ad');
  expect(between(null, '2026-02-15T00:00:00Z')).toBe('bd');
  expect(between('2026-01-01T10:00:00Z', '2026-03-01T10:00:00Z')).toBe('abd');   // b and a sit exactly on the bounds
  expect(between('2026-02-01T10:00:00Z', '2026-02-01T10:00:00Z')).toBe('d');
  expect(between('2026-02-01T10:00:00Z')).toBe('ad');
  expect(between(null, '2026-02-01T10:00:00Z')).toBe('bd');
  expect(between('2026-02-01T10:01:00Z')).toBe('a');                             // one minute past d
  expect(between(null, '2026-02-01T09:59:00Z')).toBe('b');
  expect(between('2026-02-15T00:00:00Z', '2026-01-15T00:00:00Z')).toBe('');      // inverted range matches nothing
});

test('date: between leaves out absent and unparseable dates; bounds are local time', () => {
  expect(between('2000-01-01T00:00:00Z')).toBe('abd');
  expect(between(null, '2100-01-01T00:00:00Z')).toBe('abd');
  const odd = [{ id: 'x', updated: 'not a date' }, { id: 'y', updated: undefined }, { id: 'z', updated: '2026-10-01T07:11:32.988Z' }];
  const got = (from, to) => applyQuery(odd, fields, { filters: [{ key: 'updated', op: 'between', from, to }] }).map(row => row.id).join('');
  expect(got('2000-01-01T00:00')).toBe('z');
  expect(got(local('2026-10-01T07:11:00Z'), local('2026-10-01T07:12:00Z'))).toBe('z');
  expect(got(undefined, local('2026-10-01T07:11:00Z'))).toBe('z');                // "to 07:11" covers 07:11:32
  expect(got(undefined, local('2026-10-01T07:10:00Z'))).toBe('');
  const d = new Date(2026, 1, 1, 12, 30);                                         // local wall-clock time
  expect(applyQuery([{ id: 'w', updated: d.toISOString() }], fields, { filters: [{ key: 'updated', op: 'between', from: '2026-02-01T12:30', to: '2026-02-01T12:30' }] }).length).toBe(1);
});

test('date: between combines with other filters; without a usable bound, or on a non-date field, it is ignored', () => {
  expect(ids({ filters: [{ key: 'updated', op: 'between', from: local('2026-01-15T00:00:00Z') }, { key: 'status', op: 'is', value: 'done' }] })).toBe('a');
  expect(ids({ filters: [{ key: 'task', op: 'has_not' }, { key: 'updated', op: 'between', to: local('2026-02-15T00:00:00Z') }] })).toBe('b');
  expect(ids({ search: 'login', filters: [{ key: 'updated', op: 'between', to: local('2026-02-15T00:00:00Z') }] })).toBe('');
  expect(ids({ filters: [{ key: 'updated', op: 'between', from: local('2026-01-15T00:00:00Z') }], sort: { key: 'updated', dir: 'asc' } })).toBe('da');
  expect(ids({ filters: [{ key: 'updated', op: 'between' }] })).toBe('abcde');
  expect(ids({ filters: [{ key: 'updated', op: 'between', from: '', to: '' }] })).toBe('abcde');
  expect(ids({ filters: [{ key: 'updated', op: 'between', from: 'garbage' }] })).toBe('abcde');
  expect(between('2026-01-15T00:00:00Z', '2026-02-15T00:00:00Z', 'count')).toBe('abcde');
  expect(between('2026-01-15T00:00:00Z', null, 'title')).toBe('abcde');
  expect(between('2026-01-15T00:00:00Z', null, 'secret')).toBe('abcde');
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
