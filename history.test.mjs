import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHistory } from './scripts/history.mjs';
import { createPuller, buildCommand } from './scripts/pull-collectors.mjs';

const schema = `
CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL);
CREATE TABLE agents (id TEXT PRIMARY KEY, session TEXT NOT NULL, name TEXT NOT NULL, harness TEXT NOT NULL, kind TEXT NOT NULL, task_id TEXT, state TEXT NOT NULL, seen TEXT NOT NULL, host TEXT NOT NULL DEFAULT '');
CREATE TABLE threads (id TEXT PRIMARY KEY, task_id TEXT, pane_id TEXT, subject TEXT NOT NULL, kind TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL);
CREATE TABLE messages (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, role TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, meta TEXT NOT NULL DEFAULT '{}', created TEXT NOT NULL);
CREATE TABLE turns (id TEXT PRIMARY KEY, session TEXT NOT NULL, pane_id TEXT NOT NULL, pane_name TEXT NOT NULL, harness TEXT NOT NULL, prompt TEXT NOT NULL, response TEXT NOT NULL, source TEXT NOT NULL, state TEXT NOT NULL, unread INTEGER NOT NULL DEFAULT 0, started TEXT NOT NULL, finished TEXT, task_id TEXT, archived INTEGER NOT NULL DEFAULT 0);
INSERT INTO tasks VALUES ('t1','Task one');
INSERT INTO agents VALUES ('p1','s1','alpha','claude','agent','t1','idle','2026-01-01T00:00:00Z','');`;
const fresh = () => { const db = new Database(':memory:'); db.exec(schema); return db; };
const rec = (i, extra = {}) => ({ version: 1, id: `r${i}`, source_id: 'src-A', host: 'laptop', boot_id: '', seq: null, session: 's1', pane_id: 'p1', conversation_id: 'c1', harness: 'claude',
  kind: 'response', created: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(), source: 'transcript', body: `body ${i} uniqueword${i}`, prompt: '', response: '', meta: {}, ...extra });
const batch = (records, pending = 0) => ({ source: { source_id: 'src-A', host: 'laptop', boot_id: '', last_collected: '2026-01-02T00:00:00Z', pending, gaps: 0, last_error: '' }, records });

test('import dedups, returns exact ids including duplicates, and enriches task from agents', () => {
  const h = createHistory(fresh());
  const first = h.importBatch(batch([rec(1), rec(2)], 2));
  expect(first.accepted).toEqual(['r1', 'r2']);
  const second = h.importBatch(batch([rec(2), rec(3)], 1), 'alias');
  expect(second.accepted).toEqual(['r2', 'r3']);
  expect(second.duplicates).toBe(1);
  expect(h.search({}).total).toBe(3);
  expect(h.search({ task: 't1' }).total).toBe(3);
  expect(h.search({ task: 'none' }).total).toBe(0);
  const health = h.health();
  expect(health).toHaveLength(1);
  expect(health[0]).toMatchObject({ host: 'alias', source_id: 'src-A', pending: 1, records: 3 }); // the collector's own unacknowledged count, not zero
});

test('an invalid record rolls back and acknowledges nothing', () => {
  const h = createHistory(fresh());
  expect(() => h.importBatch(batch([rec(1), rec(2, { kind: 'bogus' })]))).toThrow(/records\[1\]\.kind/);
  expect(() => h.importBatch(batch([rec(1), rec(2, { created: 'nope' })]))).toThrow(/created/);
  expect(h.search({}).total).toBe(0);
  expect(h.health()).toHaveLength(0);
});

test('filters by host, session, agent, kind and date; rejects invalid filters', () => {
  const h = createHistory(fresh());
  h.importBatch(batch([rec(1), rec(2, { kind: 'tool', session: 's2', pane_id: 'zz', harness: 'omp' })]));
  expect(h.search({ host: 'laptop' }).total).toBe(2);
  expect(h.search({ host: 'other' }).total).toBe(0);
  expect(h.search({ session: 's2' }).records.map(r => r.record_id)).toEqual(['r2']);
  expect(h.search({ agent: 'alpha' }).records.map(r => r.record_id)).toEqual(['r1']);
  expect(h.search({ kind: 'tool' }).total).toBe(1);
  expect(h.search(new URLSearchParams('from=2026-01-01&to=2026-01-01')).total).toBe(2);
  expect(h.search({ from: '2026-01-02' }).total).toBe(0);
  expect(() => h.search({ kind: 'x' })).toThrow(/kind/);
  expect(() => h.search({ limit: 0 })).toThrow(/limit/);
  expect(() => h.search({ from: 'garbage' })).toThrow(/from/);
});

test('full-body search finds text past the excerpt, is literal, and pages beyond 2000 rows', () => {
  const h = createHistory(fresh());
  const long = `${'filler '.repeat(500)}needleword at the very end`;
  const records = [rec(1, { body: long }), rec(2, { body: 'quote " and OR NOT * (weird)' })];
  for (let i = 3; i < 2300; i++) records.push(rec(i, { body: `bulk${i} common` }));
  h.importBatch(batch(records));
  const hit = h.search({ q: 'needleword' });
  expect(hit.total).toBe(1);
  expect(hit.records[0].excerpt.length).toBeLessThanOrEqual(400);
  expect(hit.records[0].snippet).toContain('[needleword]');
  expect(h.get(hit.records[0].id).body).toBe(long);
  expect(h.search({ q: '" OR NOT * (' }).total).toBeGreaterThanOrEqual(0);
  expect(h.search({ q: 'quote weird' }).total).toBe(1);
  const common = h.search({ q: 'common', limit: 200, offset: 2000 });
  expect(common.total).toBe(2297);
  expect(common.records).toHaveLength(200);
  expect(h.search({ q: 'bulk2299' }).total).toBe(1);
});

test('legacy turns and messages are indexed once, kept in sync by triggers, and not duplicated', () => {
  const db = fresh();
  db.exec(`INSERT INTO turns (id,session,pane_id,pane_name,harness,prompt,response,source,state,started,task_id) VALUES ('u1','s1','p1','alpha','claude','old prompt','old reply zebra','hook','idle','2025-12-01T00:00:00.000Z','t1');
    INSERT INTO threads VALUES ('th1','t1','p1','Subject','agent','2025-12-01T00:00:00.000Z','2025-12-01T00:00:00.000Z');
    INSERT INTO messages VALUES ('m1','th1','agent','message giraffe','complete','{}','2025-12-02T00:00:00.000Z');`);
  const h = createHistory(db);
  expect(h.search({ q: 'zebra' }).total).toBe(1);
  expect(h.search({ q: 'giraffe' }).records[0]).toMatchObject({ kind: 'response', task_id: 't1', origin: 'legacy' });
  expect(h.syncLegacy().indexed).toBe(0);
  db.exec(`UPDATE turns SET response='new reply okapi' WHERE id='u1'; INSERT INTO turns (id,session,pane_id,pane_name,harness,prompt,response,source,state,started) VALUES ('u2','s1','p9','x','omp','fresh','','hook','working','2026-03-01T00:00:00.000Z');`);
  expect(h.search({ q: 'okapi' }).total).toBe(1);
  expect(h.search({ q: 'zebra' }).total).toBe(0);
  expect(h.search({ kind: 'prompt' }).records.map(r => r.record_id)).toEqual(['turn:u2']);
  db.exec(`UPDATE threads SET task_id='t2' WHERE id='th1'`);
  expect(h.search({ q: 'giraffe' }).records[0].task_id).toBe('t2');
  expect(h.syncLegacy().indexed).toBe(0);
  expect(createHistory(db).search({}).total).toBe(3);
});

test('noteFailure surfaces per-host errors and a later import clears them', () => {
  const h = createHistory(fresh());
  h.noteFailure('remote', new Error('ssh down'));
  expect(h.health()).toEqual([expect.objectContaining({ host: 'remote', source_id: '', last_error: 'ssh down' })]);
  h.importBatch(batch([rec(1)]), 'remote');
  expect(h.health()).toEqual([expect.objectContaining({ host: 'remote', source_id: 'src-A', last_error: '' })]);
});

test('buildCommand quotes every value for SSH and refuses option-like targets', () => {
  const argv = buildCommand({ ssh: 'me@host', bun: '/opt/b un/bun', collector_path: "/x/it's/collector.mjs", data_dir: '/d a' }, ['export']);
  expect(argv.slice(0, 5)).toEqual(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10']);
  expect(argv.at(-1)).toBe(`'/opt/b un/bun' '/x/it'\\''s/collector.mjs' 'export' '--data' '/d a'`);
  expect(() => buildCommand({ ssh: '-oProxyCommand=x' }, ['export'])).toThrow(/Invalid SSH/);
});

// A real subprocess standing in for scripts/collector.mjs: a JSON outbox, export without removal, ack removing exactly the given ids.
const fakeCollector = `import { readFileSync, writeFileSync } from 'node:fs';
const [cmd, , data] = [process.argv[2], process.argv[3], process.argv[4]];
const file = (data || process.env.FAKE_DIR) + '/outbox.json';
const box = JSON.parse(readFileSync(file, 'utf8'));
const src = () => ({ source_id: 'src-A', host: 'remote-host', boot_id: '', last_collected: new Date().toISOString(), pending: box.length, gaps: 0, last_error: '' });
if (cmd === 'export') console.log(JSON.stringify({ source: src(), records: box.slice(0, 2) }));
else if (cmd === 'ack') {
  const ids = JSON.parse(await Bun.stdin.text()).ids;
  if (process.env.FAKE_FAIL_ACK) { console.error('ack lost'); process.exit(3); }
  writeFileSync(file, JSON.stringify(box.filter(r => !ids.includes(r.id))));
  console.log(JSON.stringify({ ok: true, acknowledged: ids.length }));
} else process.exit(2);`;

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'hist-'));
  const bin = join(dir, 'collector.mjs');
  writeFileSync(bin, fakeCollector);
  const data = join(dir, 'data'); Bun.spawnSync(['mkdir', data]);
  writeFileSync(join(data, 'outbox.json'), JSON.stringify([rec(1), rec(2), rec(3)]));
  return { dir, data, source: { host: 'local', ssh: null, collector_path: bin, data_dir: data, bun: process.execPath } };
}

test('local subprocess pull imports then acks exactly; a lost ack is resent and deduped', async () => {
  const { data, source } = setup();
  const h = createHistory(fresh());
  process.env.FAKE_FAIL_ACK = '1';
  const failed = await createPuller({ history: h, sources: [source] }).pull();
  delete process.env.FAKE_FAIL_ACK;
  expect(failed[0].ok).toBe(false);
  expect(failed[0].error).toContain('ack lost');
  expect(JSON.parse(readFileSync(join(data, 'outbox.json'), 'utf8'))).toHaveLength(3);
  expect(h.search({}).total).toBe(2);
  expect(h.health()[0].last_error).toContain('ack lost');
  const changed = [];
  const ok = await createPuller({ history: h, sources: [source], onChange: host => changed.push(host) }).pull();
  expect(ok[0]).toMatchObject({ ok: true, imported: 1, duplicates: 2, error: '' });
  expect(JSON.parse(readFileSync(join(data, 'outbox.json'), 'utf8'))).toEqual([]);
  expect(h.search({}).total).toBe(3);
  expect(changed).toEqual(['local']);
  expect(h.health()[0]).toMatchObject({ pending: 0, last_error: '', records: 3 });
});

test('pending stays the real unacknowledged count after a lost ACK and drains to zero on retry', async () => {
  const { source } = setup();
  const h = createHistory(fresh());
  process.env.FAKE_FAIL_ACK = '1';
  await createPuller({ history: h, sources: [source] }).pull();
  delete process.env.FAKE_FAIL_ACK;
  // two records are durable centrally, but none were acknowledged: all three are still queued at the collector
  expect(h.search({}).total).toBe(2);
  expect(h.health()[0]).toMatchObject({ pending: 3, records: 2 });
  expect(h.health()[0].last_error).toContain('ack lost');
  await createPuller({ history: h, sources: [source] }).pull();
  expect(h.health()[0]).toMatchObject({ pending: 0, records: 3, last_error: '' });
});

test('a legacy transcript turn keeps one record whose provenance follows later updates', () => {
  const db = fresh();
  db.exec(`INSERT INTO turns (id,session,pane_id,pane_name,harness,prompt,response,source,state,started) VALUES ('u1','s1','p1','alpha','claude','question','','hook','working','2025-12-01T00:00:00.000Z')`);
  const h = createHistory(db);
  const before = h.get('legacy:turn:u1');
  expect(before.provenance).toMatchObject({ origin: 'legacy', source_id: 'legacy', record_id: 'turn:u1', source: 'summary' });
  expect(before.meta.capture_source).toBe('hook');
  db.exec(`UPDATE turns SET response='answer from transcript', source='transcript', state='idle', finished='2025-12-01T00:01:00.000Z' WHERE id='u1'`);
  const after = h.get('legacy:turn:u1');
  expect(after.provenance).toMatchObject({ origin: 'legacy', source: 'transcript', imported: before.provenance.imported });
  expect(after).toMatchObject({ kind: 'response', response: 'answer from transcript' });
  expect(after.meta).toMatchObject({ capture_source: 'transcript', state: 'idle' });
  expect(after.body).toContain('question');
  expect(h.search({ q: 'transcript' }).records.map(r => r.id)).toEqual(['legacy:turn:u1']);
  expect(h.search({}).total).toBe(1);
});

test('a failing source does not block others; no sources is explicit', async () => {
  const { source } = setup();
  const h = createHistory(fresh());
  const results = await createPuller({ history: h, sources: [{ ...source, host: 'broken', collector_path: '/nonexistent/collector.mjs' }, source] }).pull();
  expect(results.map(r => r.ok)).toEqual([false, true]);
  expect(h.health().find(s => s.host === 'broken').last_error).not.toBe('');
  const none = await createPuller({ history: h, sources: [] }).pull();
  expect(none[0].ok).toBe(false);
  expect(h.health().some(s => s.host === '(no collectors)' && s.last_error)).toBe(true);
});
