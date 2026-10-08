import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync, statSync, chmodSync, readdirSync } from 'node:fs';
import { hostname, homedir } from 'node:os';
import { join } from 'node:path';
import { conversationIdFromPath, parseEntry, rawEntry, transcriptRoots } from './transcripts.mjs';

const SUPPORTED = new Set(['claude-code', 'omp', 'codex']);
const SECRET = /TOKEN|SECRET|PASSWORD|KEY|SOCKET|INBOX|CREDENTIAL/i;
const NATIVE_TYPES = 'agent-state,agent-message,agent-activity,window-created,window-exit,window-closed,command-started,command-finished,session-created,session-closed,notification';
const short = value => createHash('sha1').update(value).digest('hex').slice(0, 12);
const now = () => new Date().toISOString();

export const defaultDataDir = (env = process.env) => env.TUIOS_INBOX_COLLECTOR_DATA || join(homedir(), '.local/share/tuios-inbox/collector');
export const defaultTuiosBin = (env = process.env) => env.TUIOS_BIN || Bun.which('tuios') || '/opt/homebrew/bin/tuios';

async function tuiosJson(bin, args, timeout = 5000) {
  const proc = Bun.spawn([bin, ...args, '--json'], { stdout: 'pipe', stderr: 'ignore' });
  const timer = setTimeout(() => proc.kill(), timeout);
  const [text, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  clearTimeout(timer);
  if (code) throw new Error(`${bin} ${args[0]} exited ${code}`);
  return JSON.parse(text);
}

// Native events carry no prose of their own, so find the best text and keep the whole event as metadata.
function nativeKind(e) {
  if (e.type === 'agent-message') return 'mail';
  if (e.type.startsWith('command-')) return 'command';
  const entry = String(e.entry?.type ?? e.entry?.kind ?? '');
  if (e.type === 'agent-activity') return /prompt/.test(entry) ? 'prompt' : /tool/.test(entry) ? 'tool' : /response|turn|reply/.test(entry) ? 'response' : 'activity';
  return 'activity';
}
const nativeText = e => [e.text, e.message, e.summary, e.command, e.entry?.text, e.entry?.summary, e.entry?.content].find(v => typeof v === 'string' && v) || JSON.stringify(e);

export function openCollector(options = {}) {
  const env = options.env || process.env;
  const dataDir = options.dataDir || defaultDataDir(env);
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const host = options.host || env.TUIOS_INBOX_HOST || hostname();
  const tuiosBin = options.tuiosBin || defaultTuiosBin(env);
  const roots = options.roots || transcriptRoots(env);
  const db = new Database(join(dataDir, 'collector.db'), { create: true });
  try { chmodSync(join(dataDir, 'collector.db'), 0o600); } catch {}
  db.run('PRAGMA busy_timeout=5000');
  if (db.query('PRAGMA journal_mode').get().journal_mode !== 'wal') db.run('PRAGMA journal_mode=WAL');
  db.run(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, harness TEXT NOT NULL, ino TEXT NOT NULL, offset INTEGER NOT NULL, generation INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS outbox (n INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, record TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS imported (id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS gaps (id TEXT PRIMARY KEY, time TEXT NOT NULL, detail TEXT NOT NULL);`);
  const getMeta = key => db.query('SELECT value FROM meta WHERE key=?').get(key)?.value;
  const setMeta = (key, value) => db.query('INSERT OR REPLACE INTO meta VALUES (?,?)').run(key, value);
  if (!getMeta('source_id')) setMeta('source_id', crypto.randomUUID());
  const sourceId = getMeta('source_id');
  const insertImported = db.query('INSERT OR IGNORE INTO imported VALUES (?)');
  const insertOutbox = db.query('INSERT INTO outbox (id, record) VALUES (?,?)');
  const insertGap = db.query('INSERT OR IGNORE INTO gaps VALUES (?,?,?)');
  let closed = false, scanning = Promise.resolve(), agents = new Map(), sessions = new Set();

  const envelope = partial => ({
    version: 1, id: '', source_id: sourceId, host, boot_id: '', seq: null, session: '', pane_id: '', conversation_id: '', harness: '',
    kind: 'activity', created: now(), source: 'transcript', body: '', prompt: '', response: '', meta: {}, ...partial,
  });

  // Records and whatever must advance with them (checkpoint, cursor) commit together or not at all.
  const journal = db.transaction((records, advance) => {
    let added = 0;
    for (const r of records) {
      if (insertImported.run(r.id).changes) {
        insertOutbox.run(r.id, JSON.stringify(r)); added++;
        if (r.kind === 'gap') insertGap.run(r.id, r.created, r.body);
      }
    }
    advance?.();
    if (added) setMeta('last_collected', now());
    return added;
  });

  const gapRecord = (id, body, partial = {}) => envelope({ id, kind: 'gap', source: 'native', body, ...partial, meta: { gap: true, ...partial.meta } });

  // A failed lookup keeps the last known panes for that session and is reported, never swallowed.
  async function refreshAgents() {
    const errors = [], names = new Set(sessions), map = new Map();
    try { for (const s of await tuiosJson(tuiosBin, ['list-sessions'])) names.add(s.name); }
    catch (error) { errors.push(`list-sessions: ${error.message}`); }
    for (const session of names) {
      try { for (const a of (await tuiosJson(tuiosBin, ['list-agents', '-s', session])).agents || []) map.set(a.window_id, { ...a, session }); }
      catch (error) {
        errors.push(`list-agents ${session}: ${error.message}`);
        for (const [id, a] of agents) if (a.session === session) map.set(id, a);
      }
    }
    agents = map; setMeta('agents_error', errors.join('; '));
  }
  const paneFor = conversation => conversation && [...agents.values()].find(a => a.agent_session_id === conversation);

  // Every agent pane must be backed by a transcript we actually read; otherwise say so instead of implying full history.
  const missing = new Map();
  function coverage(seen) {
    const open = [], records = [];
    for (const a of agents.values()) {
      if (!a.harness_id && !a.protocol) continue;
      if (a.agent_session_id && seen.has(`${a.harness_id}:${a.agent_session_id}`)) { missing.delete(a.window_id); continue; }
      const harness = a.harness_id || '', who = `${harness || 'agent'} pane ${a.window_id}`;
      let reason, kind, certain = true;
      if (a.protocol) { kind = 'protocol'; reason = `${who} runs headless over the ${a.protocol} protocol; no transcript reader exists, so its full history is not collected.`; }
      else if (!SUPPORTED.has(harness)) { kind = 'unsupported'; reason = `No transcript reader for harness ${harness}; ${who} full history is not collected.`; }
      else if (!a.agent_session_id) { kind = 'unlinked'; certain = false; reason = `${who} reports no conversation id, so no transcript can be linked to it.`; }
      else { kind = 'missing'; certain = false; reason = `${who} is active but no transcript file for conversation ${a.agent_session_id} was found under the configured roots.`; }
      const polls = (missing.get(a.window_id) || 0) + 1;
      missing.set(a.window_id, polls);
      open.push({ pane_id: a.window_id, session: a.session, harness, kind, reason });
      // Transcripts can lag a new pane, so uncertain gaps are journaled only once they persist across scans.
      if (certain || polls >= 2) records.push(gapRecord(`gap:coverage:${kind}:${a.window_id}:${a.agent_session_id || ''}`, reason, { harness, session: a.session, pane_id: a.window_id, conversation_id: a.agent_session_id || '', source: 'summary', meta: { coverage: kind } }));
    }
    for (const id of [...missing.keys()]) if (![...agents.values()].some(a => a.window_id === id)) missing.delete(id);
    setMeta('coverage', JSON.stringify(open));
    if (records.length) journal(records);
  }

  async function scanFile(path, harness) {
    let st;
    try { st = statSync(path); } catch { return 0; }
    const ino = `${st.dev}:${st.ino}`, key = short(path);
    let row = db.query('SELECT * FROM files WHERE path=?').get(path) || { path, harness, ino, offset: 0, generation: 0 };
    const gaps = [];
    if (row.ino !== ino) gaps.push([`file replaced or rotated (inode ${row.ino} -> ${ino})`, row.generation + 1]);
    else if (st.size < row.offset) gaps.push([`file truncated from ${row.offset} to ${st.size} bytes`, row.generation + 1]);
    if (gaps.length) {
      const [detail, generation] = gaps[0];
      journal([gapRecord(`gap:${key}:${generation}`, `${detail}: ${path}`, { harness, meta: { path, generation } })], () => {
        db.query('INSERT OR REPLACE INTO files VALUES (?,?,?,0,?)').run(path, harness, ino, generation);
      });
      row = { ...row, ino, offset: 0, generation };
    }
    const conversation = conversationIdFromPath(harness, path), fallbackTime = st.mtime.toISOString();
    const decoder = new TextDecoder();
    let total = 0, window = 8 << 20;
    while (!closed) {
      const size = statSync(path).size;
      if (row.offset >= size) break;
      const bytes = new Uint8Array(await Bun.file(path).slice(row.offset, row.offset + window).arrayBuffer());
      const end = bytes.lastIndexOf(10);
      if (end < 0) { if (row.offset + bytes.length >= size) break; window *= 2; continue; }
      const records = [];
      let start = 0;
      for (let at = bytes.indexOf(10); at >= 0 && at <= end; start = at + 1, at = bytes.indexOf(10, start)) {
        const line = decoder.decode(bytes.subarray(start, at)).replace(/\r$/, '');
        if (!line.trim()) continue;
        let parsed;
        try { const entry = JSON.parse(line); parsed = parseEntry(harness, entry, { path, conversation_id: conversation, fallbackTime }); }
        catch (error) { parsed = { ...rawEntry(line, error), created: fallbackTime, conversation_id: conversation }; }
        const link = paneFor(parsed.conversation_id);
        records.push(envelope({ ...parsed, id: `t:${key}:${row.generation}:${row.offset + start}`, harness, session: link?.session || '', pane_id: link?.window_id || '', meta: { ...parsed.meta, generation: row.generation, byte_offset: row.offset + start } }));
      }
      const next = row.offset + end + 1;
      total += journal(records, () => db.query('INSERT OR REPLACE INTO files VALUES (?,?,?,?,?)').run(path, harness, ino, next, row.generation));
      row = { ...row, offset: next };
    }
    return total;
  }

  async function scanOnce() {
    await refreshAgents();
    let collected = 0;
    const report = [], seen = new Set();
    for (const { harness, root, patterns } of roots) {
      const entry = { harness, root, present: exists(root), files: 0, error: '' };
      const files = [];
      if (entry.present) {
        try { readdirSync(root); } catch (error) { entry.error = `unreadable: ${error.message}`; }
        if (!entry.error) for (const pattern of patterns) {
          try { for await (const f of new Bun.Glob(pattern).scan({ cwd: root, absolute: true })) files.push(f); }
          catch (error) { entry.error = `scan ${pattern}: ${error.message}`; }
        }
      }
      entry.files = files.length;
      for (const path of files.sort()) {
        seen.add(`${harness}:${conversationIdFromPath(harness, path)}`);
        try { collected += await scanFile(path, harness); } catch (error) { entry.error ||= `${path}: ${error.message}`; }
      }
      report.push(entry);
    }
    const errors = report.filter(r => r.error).map(r => `${r.harness} ${r.root}: ${r.error}`);
    setMeta('scan_error', errors.join('; ')); setMeta('roots', JSON.stringify(report));
    coverage(seen);
    return { ok: !errors.length && !getMeta('agents_error'), collected, roots: report, errors };
  }
  const exists = path => { try { statSync(path); return true; } catch { return false; } };

  function nativeRecord(e, extra = {}) {
    const link = agents.get(e.window);
    return envelope({
      id: `native:${e.boot_id || getMeta('boot_id') || ''}:${e.seq}`, boot_id: e.boot_id || getMeta('boot_id') || '', seq: e.seq, session: e.session || '', pane_id: e.window || '',
      conversation_id: link?.agent_session_id || '', harness: link?.harness_id || '', kind: nativeKind(e), source: 'native',
      created: typeof e.time === 'number' ? new Date(e.time / 1e6).toISOString() : now(), body: nativeText(e), meta: { event: e }, ...extra,
    });
  }

  // The hook may not be loaded in this daemon, so capture the finished command's output here, labelled as pane text.
  async function commandOutput(e) {
    const boot = e.boot_id || getMeta('boot_id') || '', seq = e.command_seq ?? e.seq;
    const link = agents.get(e.window), where = { boot_id: boot, session: e.session, pane_id: e.window, conversation_id: link?.agent_session_id || '', harness: link?.harness_id || '' };
    const id = `command:${boot}:${e.window}:${seq}`;
    if (db.query('SELECT 1 FROM imported WHERE id=?').get(id)) return null;
    try {
      const out = await tuiosJson(tuiosBin, ['capture-pane', '-s', e.session, '-w', e.window, '--lines', '0', '--last-command'], 3000);
      if (out.command_seq != null && e.command_seq != null && out.command_seq !== e.command_seq) throw new Error(`pane already moved on to command #${out.command_seq}`);
      const { content, ...captureMeta } = out;
      return envelope({ ...where, id, kind: 'command', source: 'pane', created: typeof e.time === 'number' ? new Date(e.time / 1e6).toISOString() : now(),
        body: [e.command || e.cmdline, content].filter(Boolean).join('\n') || JSON.stringify(e), meta: { captured_by: 'native', event: e, capture_meta: captureMeta } });
    } catch (error) {
      return gapRecord(`gap:capture:${boot}:${e.window}:${seq}`, `Output of command #${seq} in pane ${e.window} could not be captured: ${error.message}`, { ...where, meta: { event: e } });
    }
  }

  async function importMail(session) {
    const result = await tuiosJson(tuiosBin, ['read-agent-messages', '-s', session, '--limit', '256']);
    const boot = getMeta('boot_id') || '';
    const records = (Array.isArray(result) ? result : result.messages || []).map(m => envelope({
      id: `mail:${boot}:${session}:${m.id}`, boot_id: boot, session, pane_id: m.to || m.from || '', kind: 'mail', source: 'native',
      body: m.text || m.body || JSON.stringify(m), created: typeof m.time === 'number' ? new Date(m.time > 1e15 ? m.time / 1e6 : m.time * 1000).toISOString() : now(), meta: { mail: m, untrusted: true },
    }));
    journal(records);
  }

  const collector = {
    sourceId, dataDir, host,
    scan: () => (scanning = scanning.catch(() => {}).then(scanOnce)),
    appendHook(event) {
      const v = Object.fromEntries(Object.entries(event.values || {}).filter(([k]) => !SECRET.test(k)));
      const command = v.TUIOS_EVENT === 'after-command-finished';
      const { content, ...captureMeta } = event.captureMeta || {};
      const seq = event.captureMeta?.command_seq;
      // Same id as the native command-finished capture so hook and native paths dedupe each other.
      const id = command && event.bootId && v.TUIOS_WINDOW_ID && seq != null ? `command:${event.bootId}:${v.TUIOS_WINDOW_ID}:${seq}` : `hook:${event.id}`;
      const record = envelope({
        id, boot_id: event.bootId || '', session: v.TUIOS_SESSION_ID || '', pane_id: v.TUIOS_WINDOW_ID || '',
        conversation_id: event.agent?.agent_session_id || '', harness: event.agent?.harness_id || v.TUIOS_AGENT_HARNESS || '',
        kind: command ? 'command' : 'activity', source: 'pane', created: event.time || now(),
        body: [command && v.TUIOS_COMMAND, event.capture, v.TUIOS_AGENT_MESSAGE].filter(Boolean).join('\n') || JSON.stringify({ values: v }),
        meta: { hook_event: v, capture_meta: captureMeta, agent: event.agent, capture_error: event.captureError },
      });
      journal([record]);
      return record.id;
    },
    exportBatch(limit = 100) {
      const rows = db.query('SELECT record FROM outbox ORDER BY n LIMIT ?').all(Math.max(1, Math.min(1000, Number(limit) || 100)));
      return { source: collector.source(), records: rows.map(r => JSON.parse(r.record)) };
    },
    ack(ids) {
      if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw new Error('ids must be an array of record id strings');
      const remove = db.query('DELETE FROM outbox WHERE id=?');
      return db.transaction(() => ids.reduce((n, id) => n + remove.run(id).changes, 0))();
    },
    source() {
      const open = JSON.parse(getMeta('coverage') || '[]');
      const error = [getMeta('native_error'), getMeta('scan_error'), getMeta('agents_error') && `agents: ${getMeta('agents_error')}`, open.length && `${open.length} agent pane(s) without full transcript coverage`].filter(Boolean).join('; ');
      return {
        source_id: sourceId, host, boot_id: getMeta('boot_id') || '', last_collected: getMeta('last_collected') || null,
        pending: db.query('SELECT count(*) c FROM outbox').get().c, gaps: db.query('SELECT count(*) c FROM gaps').get().c, last_error: error,
        gap_details: db.query('SELECT id, time, detail FROM gaps ORDER BY time DESC LIMIT 20').all(),
      };
    },
    status() {
      return {
        ...collector.source(), data_dir: dataDir, native: getMeta('native_state') || 'stopped', cursor: JSON.parse(getMeta('native_cursor') || 'null'),
        imported: db.query('SELECT count(*) c FROM imported').get().c, transcript_sources: JSON.parse(getMeta('roots') || '[]'),
        coverage_gaps: JSON.parse(getMeta('coverage') || '[]'),
        gap_details: db.query('SELECT id, time, detail FROM gaps ORDER BY time DESC LIMIT 20').all(),
      };
    },
    // Journals one native stream line together with its resume cursor.
    async handleNative(e) {
      if (e.type === 'subscribed') { setMeta('boot_id', e.boot_id || ''); setMeta('native_state', 'subscribed'); setMeta('native_error', ''); return; }
      if (e.type === 'gap') {
        const boot = e.boot_id || getMeta('boot_id') || '';
        journal([gapRecord(`gap:native:${boot}:${e.seq ?? ''}:${e.time ?? Date.now()}`, `TUIOS event stream gap (${e.reason || 'unknown'}); events were lost and cannot be reconstructed.`, { boot_id: boot, meta: { event: e } })],
          () => { if (e.boot_id) { setMeta('boot_id', e.boot_id); setMeta('native_cursor', JSON.stringify({ boot_id: e.boot_id, seq: 0 })); } else db.query('DELETE FROM meta WHERE key=?').run('native_cursor'); });
        return;
      }
      if (!e.seq || !e.type) return;
      if (e.session) sessions.add(e.session);
      if (e.window && !agents.has(e.window) && ['agent-state', 'agent-activity', 'agent-message'].includes(e.type)) await refreshAgents();
      const records = [nativeRecord(e)];
      if (e.type === 'command-finished' && e.window && e.session) { const output = await commandOutput(e); if (output) records.push(output); }
      journal(records, () => setMeta('native_cursor', JSON.stringify({ boot_id: e.boot_id || getMeta('boot_id') || '', seq: e.seq })));
      if (e.type === 'agent-message' && e.session) { try { await importMail(e.session); } catch (error) { setMeta('native_error', `mail import failed: ${error.message}`); } }
    },
    nativeArgs() {
      const args = ['subscribe', '--types', NATIVE_TYPES];
      const cursor = JSON.parse(getMeta('native_cursor') || 'null');
      if (cursor?.boot_id) args.push('--after-seq', String(cursor.seq), '--boot-id', cursor.boot_id);
      return args;
    },
    setNativeState(state, error = '') { setMeta('native_state', state); setMeta('native_error', error); },
    close() {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
  return collector;
}

// Follows the local daemon and rescans transcripts until aborted; journals before every cursor or checkpoint move.
export async function runCollector(collector, { interval = 5000, tuiosBin = defaultTuiosBin(), signal } = {}) {
  let child = null;
  const stopped = () => signal?.aborted;
  signal?.addEventListener('abort', () => child?.kill());
  const scanLoop = (async () => {
    while (!stopped()) {
      try { await collector.scan(); } catch {}
      await new Promise(resolve => {
        if (stopped()) return resolve(); // an abort that landed mid-scan has no listener left to fire
        const done = () => { clearTimeout(t); signal?.removeEventListener('abort', done); resolve(); };
        const t = setTimeout(done, interval);
        signal?.addEventListener('abort', done, { once: true });
      });
    }
  })();
  const nativeLoop = (async () => {
    while (!stopped()) {
      let error = '', stderr = null;
      try {
        child = Bun.spawn([tuiosBin, ...collector.nativeArgs()], { stdout: 'pipe', stderr: 'pipe' });
        if (stopped()) child.kill();
        stderr = new Response(child.stderr).text();
        const reader = child.stdout.getReader(), decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let n;
          while ((n = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, n).trim(); buffer = buffer.slice(n + 1);
            if (line) await collector.handleNative(JSON.parse(line));
          }
        }
        error = (await stderr).trim();
      } catch (e) { error = e.message; }
      finally {
        // A failed read or journal write must not leave the subscriber running beside its replacement.
        if (child) { child.kill(); await child.exited.catch(() => {}); }
        if (error && stderr) stderr.catch(() => {});
      }
      if (stopped()) break;
      collector.setNativeState('reconnecting', error || 'native event stream ended');
      await Bun.sleep(2000);
    }
  })();
  await Promise.all([scanLoop, nativeLoop]);
  collector.setNativeState('stopped', '');
}

function flags(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[++i];
    else out._.push(argv[i]);
  }
  return out;
}

async function main() {
  const f = flags(process.argv.slice(2)), [command] = f._;
  if (!['run', 'scan', 'export', 'ack', 'status'].includes(command)) {
    console.error('usage: collector.mjs run|scan|export|ack|status [--data DIR] [--host NAME] [--tuios-bin PATH] [--interval MS] [--limit N]');
    process.exit(2);
  }
  const bin = f['tuios-bin'] || defaultTuiosBin();
  const collector = openCollector({ dataDir: f.data, host: f.host, tuiosBin: bin });
  const print = value => process.stdout.write(JSON.stringify(value) + '\n');
  try {
    if (command === 'scan') { const result = await collector.scan(); print({ ok: true, ...result }); if (!result.ok) process.exitCode = 1; }
    else if (command === 'export') print(collector.exportBatch(Number(f.limit) || 100));
    else if (command === 'status') print(collector.status());
    else if (command === 'ack') {
      const { ids } = JSON.parse(await Bun.stdin.text());
      print({ ok: true, acknowledged: collector.ack(ids) });
    } else {
      const controller = new AbortController();
      for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, () => controller.abort());
      await runCollector(collector, { interval: Number(f.interval) || 5000, tuiosBin: bin, signal: controller.signal });
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally { collector.close(); }
}
if (import.meta.main) await main();
