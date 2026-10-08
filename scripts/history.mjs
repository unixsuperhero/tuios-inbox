// Central, append-only, full-text searchable history. Collector envelopes are imported here (never edited);
// the Inbox's own turns and messages are mirrored in by triggers so old and new records search together.
export const KINDS = ['prompt', 'response', 'tool', 'activity', 'command', 'mail', 'gap'];
const SOURCES = ['transcript', 'pane', 'summary', 'native'];
const MAX_BODY = 32 * 1024 * 1024;
const EXCERPT = 400;
const LEGACY = 'legacy';

export class HistoryError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'HistoryError'; this.status = status; }
}

const lit = s => `'${String(s).replace(/'/g, "''")}'`;
const text = v => (v == null ? '' : String(v));
const isoOf = (value, label) => {
  const t = Date.parse(value);
  if (!Number.isFinite(t)) throw new HistoryError(`${label} is not a valid timestamp`);
  return new Date(t).toISOString();
};

function validateEnvelope(r, index, expectSource) {
  const at = `records[${index}]`;
  if (!r || typeof r !== 'object' || Array.isArray(r)) throw new HistoryError(`${at} must be an object`);
  if (r.version !== 1) throw new HistoryError(`${at}.version must be 1`);
  for (const key of ['id', 'source_id']) if (typeof r[key] !== 'string' || !r[key] || r[key].length > 512) throw new HistoryError(`${at}.${key} must be a nonempty string`);
  if (expectSource && r.source_id !== expectSource) throw new HistoryError(`${at}.source_id does not match the batch source`);
  if (!KINDS.includes(r.kind)) throw new HistoryError(`${at}.kind must be one of ${KINDS.join(', ')}`);
  if (!SOURCES.includes(r.source)) throw new HistoryError(`${at}.source must be one of ${SOURCES.join(', ')}`);
  if (typeof r.body !== 'string') throw new HistoryError(`${at}.body must be a string`);
  for (const key of ['host', 'boot_id', 'session', 'pane_id', 'conversation_id', 'harness', 'prompt', 'response']) if (r[key] != null && typeof r[key] !== 'string') throw new HistoryError(`${at}.${key} must be a string`);
  if (r.seq != null && !Number.isSafeInteger(r.seq)) throw new HistoryError(`${at}.seq must be an integer or null`);
  if (r.meta != null && (typeof r.meta !== 'object' || Array.isArray(r.meta))) throw new HistoryError(`${at}.meta must be an object`);
  const body = r.body || [text(r.prompt), text(r.response)].filter(Boolean).join('\n\n');
  if (body.length > MAX_BODY) throw new HistoryError(`${at}.body exceeds ${MAX_BODY} characters`);
  return { ...r, created: isoOf(r.created, `${at}.created`), body };
}

// A literal query: every whitespace-separated word must appear; no FTS operators are ever interpreted.
function ftsQuery(q) {
  const terms = String(q).split(/\s+/).filter(t => /[\p{L}\p{N}]/u.test(t));
  return terms.length ? terms.map(t => `"${t.replace(/"/g, '""')}"`).join(' AND ') : null;
}

function normalizeParams(input) {
  const get = input instanceof URLSearchParams ? k => input.get(k) : k => input?.[k];
  const p = {};
  for (const k of ['q', 'host', 'session', 'agent', 'task', 'from', 'to', 'kind']) { const v = get(k); p[k] = v == null ? '' : String(v).trim(); }
  const number = (k, def, min, max) => {
    const v = get(k);
    if (v == null || v === '') return def;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new HistoryError(`${k} must be an integer from ${min} to ${max}`);
    return n;
  };
  p.limit = number('limit', 50, 1, 200);
  p.offset = number('offset', 0, 0, 1e9);
  if (p.kind && !KINDS.includes(p.kind)) throw new HistoryError(`kind must be one of ${KINDS.join(', ')}`);
  const bound = (v, label, end) => {
    if (!v) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return isoOf(end ? `${v}T23:59:59.999Z` : `${v}T00:00:00.000Z`, label);
    return isoOf(v, label);
  };
  p.from = bound(p.from, 'from', false);
  p.to = bound(p.to, 'to', true);
  if (p.from && p.to && p.from > p.to) throw new HistoryError('from must not be after to');
  return p;
}

export function createHistory(db, { localHost = 'local' } = {}) {
  const all = (sql, ...a) => db.query(sql).all(...a);
  const one = (sql, ...a) => db.query(sql).get(...a);
  const run = (sql, ...a) => db.query(sql).run(...a);
  const has = name => Boolean(one("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", name));
  const columns = table => new Set(all(`SELECT name FROM pragma_table_info('${table}')`).map(c => c.name));

  db.exec(`
CREATE TABLE IF NOT EXISTS history_records (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL, record_id TEXT NOT NULL, host TEXT NOT NULL DEFAULT '', boot_id TEXT NOT NULL DEFAULT '', seq INTEGER,
  session TEXT NOT NULL DEFAULT '', pane_id TEXT NOT NULL DEFAULT '', conversation_id TEXT NOT NULL DEFAULT '', harness TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL, created TEXT NOT NULL, source TEXT NOT NULL, body TEXT NOT NULL, prompt TEXT NOT NULL DEFAULT '', response TEXT NOT NULL DEFAULT '',
  meta TEXT NOT NULL DEFAULT '{}', task_id TEXT, origin TEXT NOT NULL, imported TEXT NOT NULL, UNIQUE (source_id, record_id));
CREATE INDEX IF NOT EXISTS history_created ON history_records(created DESC);
CREATE INDEX IF NOT EXISTS history_host ON history_records(host, created);
CREATE INDEX IF NOT EXISTS history_session ON history_records(session, created);
CREATE INDEX IF NOT EXISTS history_pane ON history_records(pane_id, created);
CREATE INDEX IF NOT EXISTS history_task ON history_records(task_id, created);
CREATE INDEX IF NOT EXISTS history_conversation ON history_records(conversation_id);
CREATE VIRTUAL TABLE IF NOT EXISTS history_fts USING fts5(body, content='history_records', content_rowid='rowid');
CREATE TRIGGER IF NOT EXISTS history_fts_ai AFTER INSERT ON history_records BEGIN INSERT INTO history_fts(rowid, body) VALUES (new.rowid, new.body); END;
CREATE TRIGGER IF NOT EXISTS history_fts_ad AFTER DELETE ON history_records BEGIN INSERT INTO history_fts(history_fts, rowid, body) VALUES ('delete', old.rowid, old.body); END;
CREATE TRIGGER IF NOT EXISTS history_fts_au AFTER UPDATE OF body ON history_records BEGIN
  INSERT INTO history_fts(history_fts, rowid, body) VALUES ('delete', old.rowid, old.body); INSERT INTO history_fts(rowid, body) VALUES (new.rowid, new.body); END;
CREATE TABLE IF NOT EXISTS history_sources (
  host TEXT NOT NULL, source_id TEXT NOT NULL, boot_id TEXT NOT NULL DEFAULT '', last_collected TEXT, last_transfer TEXT, last_pull TEXT,
  pending INTEGER NOT NULL DEFAULT 0, gaps INTEGER NOT NULL DEFAULT 0, gaps_detail TEXT NOT NULL DEFAULT '[]', last_error TEXT NOT NULL DEFAULT '', last_error_at TEXT,
  PRIMARY KEY (host, source_id));
CREATE TABLE IF NOT EXISTS history_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

  // Mirrors of the Inbox's own turns and messages. Rebuilt on open so the local host label is current.
  const hasTurns = has('turns'), hasMessages = has('messages') && has('threads'), hasAgents = has('agents'), hasTasks = has('tasks');
  const agentHost = pane => (hasAgents ? `COALESCE(NULLIF((SELECT host FROM agents WHERE id=${pane}),''),${lit(localHost)})` : lit(localHost));
  const turnCols = hasTurns ? columns('turns') : new Set();
  const turnCol = c => (turnCols.has(c) ? `t.${c}` : 'NULL');
  const upsert = select => `INSERT INTO history_records (id,source_id,record_id,host,boot_id,seq,session,pane_id,conversation_id,harness,kind,created,source,body,prompt,response,meta,task_id,origin,imported)
${select} ON CONFLICT(source_id, record_id) DO UPDATE SET host=excluded.host, session=excluded.session, pane_id=excluded.pane_id, conversation_id=excluded.conversation_id, harness=excluded.harness,
  kind=excluded.kind, created=excluded.created, source=excluded.source, body=excluded.body, prompt=excluded.prompt, response=excluded.response, meta=excluded.meta, task_id=excluded.task_id`;
  const turnSelect = where => `SELECT 'legacy:turn:'||t.id, 'legacy', 'turn:'||t.id, ${agentHost('t.pane_id')}, '', NULL, t.session, t.pane_id, '', t.harness,
    CASE WHEN t.response<>'' THEN 'response' ELSE 'prompt' END, t.started, CASE WHEN t.source IN ('transcript','pane','native') THEN t.source ELSE 'summary' END, t.prompt||CASE WHEN t.response<>'' THEN char(10)||char(10)||t.response ELSE '' END, t.prompt, t.response,
    json_object('turn_id', t.id, 'pane_name', t.pane_name, 'state', t.state, 'capture_source', t.source, 'finished', t.finished, 'archived', ${turnCol('archived')}), ${turnCol('task_id')}, 'legacy', t.started FROM turns t ${where}`;
  const messageSelect = where => `SELECT 'legacy:message:'||m.id, 'legacy', 'message:'||m.id, ${agentHost('th.pane_id')}, '', NULL, ${hasAgents ? `COALESCE((SELECT session FROM agents WHERE id=th.pane_id),'')` : "''"}, COALESCE(th.pane_id,''), th.id, '',
    CASE WHEN th.kind='mail' THEN 'mail' WHEN m.role='human' THEN 'prompt' WHEN m.role='agent' THEN 'response' WHEN m.role='shell' THEN 'command' ELSE 'activity' END,
    m.created, CASE WHEN th.kind='mail' THEN 'native' ELSE 'pane' END, m.body, CASE WHEN m.role='human' THEN m.body ELSE '' END, CASE WHEN m.role='agent' THEN m.body ELSE '' END,
    json_object('message_id', m.id, 'thread_id', th.id, 'subject', th.subject, 'thread_kind', th.kind, 'role', m.role, 'status', m.status), th.task_id, 'legacy', m.created
    FROM messages m JOIN threads th ON th.id=m.thread_id ${where}`;
  for (const t of ['turn_ai', 'turn_au', 'message_ai', 'message_au', 'thread_au']) db.exec(`DROP TRIGGER IF EXISTS history_legacy_${t}`);
  if (hasTurns) for (const [name, ev] of [['turn_ai', 'INSERT'], ['turn_au', 'UPDATE']]) db.exec(`CREATE TRIGGER history_legacy_${name} AFTER ${ev} ON turns BEGIN ${upsert(turnSelect('WHERE t.id=new.id'))}; END`);
  if (hasMessages) {
    for (const [name, ev] of [['message_ai', 'INSERT'], ['message_au', 'UPDATE']]) db.exec(`CREATE TRIGGER history_legacy_${name} AFTER ${ev} ON messages BEGIN ${upsert(messageSelect('WHERE m.id=new.id'))}; END`);
    db.exec(`CREATE TRIGGER history_legacy_thread_au AFTER UPDATE OF task_id, pane_id ON threads BEGIN
      UPDATE history_records SET task_id=new.task_id, pane_id=COALESCE(new.pane_id,'') WHERE source_id='legacy' AND conversation_id=new.id; END`);
  }

  const state = key => one('SELECT value FROM history_state WHERE key=?', key)?.value;
  const setState = (key, value) => run('INSERT INTO history_state (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, String(value));

  // First call indexes everything; later calls only add rows past a rowid watermark. Edits are carried by the triggers.
  function syncLegacy() {
    let indexed = 0;
    db.transaction(() => {
      const first = state('legacy_synced') !== '1';
      for (const [table, ok, select] of [['turns', hasTurns, turnSelect], ['messages', hasMessages, messageSelect]]) {
        if (!ok) continue;
        const alias = table === 'turns' ? 't' : 'm';
        const mark = Number(state(`legacy_${table}_rowid`) ?? 0);
        const top = one(`SELECT COALESCE(MAX(rowid),0) AS n FROM ${table}`).n;
        if (!first && top === mark) continue;
        const before = one('SELECT COUNT(*) AS n FROM history_records').n;
        run(upsert(select(`WHERE ${alias}.rowid > ${first ? 0 : mark}`)));
        indexed += one('SELECT COUNT(*) AS n FROM history_records').n - before;
        setState(`legacy_${table}_rowid`, top);
      }
      setState('legacy_synced', 1);
    })();
    return { indexed };
  }

  const taskExpr = hasAgents ? `COALESCE(r.task_id, (SELECT a.task_id FROM agents a WHERE a.id=r.pane_id AND r.pane_id<>'' AND (a.host='' OR a.host=r.host)))` : 'r.task_id';
  const agentName = hasAgents ? `(SELECT a.name FROM agents a WHERE a.id=r.pane_id AND r.pane_id<>'' AND (a.host='' OR a.host=r.host))` : "''";
  const taskTitle = hasTasks ? `(SELECT title FROM tasks WHERE id=${taskExpr})` : 'NULL';
  const outCols = `r.id, r.record_id, r.source_id, r.host, r.boot_id, r.seq, r.session, r.pane_id, r.conversation_id, r.harness, r.kind, r.created, r.source, r.origin, r.imported, r.meta,
    ${taskExpr} AS task_id, ${agentName} AS agent_name, ${taskTitle} AS task_title`;
  const shape = row => ({ ...row, meta: JSON.parse(row.meta || '{}'), agent_name: row.agent_name ?? '' });

  function search(input = {}) {
    const p = normalizeParams(input);
    const where = [], args = [];
    if (p.q) {
      const match = ftsQuery(p.q);
      if (!match) return { records: [], total: 0, limit: p.limit, offset: p.offset };
      where.push('r.rowid IN (SELECT rowid FROM history_fts WHERE history_fts MATCH ?)'); args.push(match);
    }
    if (p.host) { where.push('r.host=?'); args.push(p.host); }
    if (p.session) { where.push('r.session=?'); args.push(p.session); }
    if (p.kind) { where.push('r.kind=?'); args.push(p.kind); }
    if (p.from) { where.push('r.created>=?'); args.push(p.from); }
    if (p.to) { where.push('r.created<=?'); args.push(p.to); }
    if (p.agent) {
      where.push(`(r.pane_id=? OR r.harness=?${hasAgents ? ' OR r.pane_id IN (SELECT id FROM agents WHERE name=?)' : ''})`);
      args.push(p.agent, p.agent); if (hasAgents) args.push(p.agent);
    }
    if (p.task === 'none') where.push(`${taskExpr} IS NULL`);
    else if (p.task) { where.push(`${taskExpr}=?`); args.push(p.task); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = one(`SELECT COUNT(*) AS n FROM history_records r ${clause}`, ...args).n;
    const snippet = p.q ? `, (SELECT snippet(history_fts, 0, '[', ']', '…', 24) FROM history_fts WHERE history_fts MATCH ? AND rowid=r.rowid) AS snippet` : '';
    const rows = all(`SELECT ${outCols}, substr(r.body,1,${EXCERPT}) AS excerpt${snippet} FROM history_records r ${clause} ORDER BY r.created DESC, r.rowid DESC LIMIT ? OFFSET ?`,
      ...(p.q ? [ftsQuery(p.q)] : []), ...args, p.limit, p.offset);
    return { records: rows.map(shape), total, limit: p.limit, offset: p.offset };
  }

  function get(id) {
    const row = one(`SELECT ${outCols}, r.body, r.prompt, r.response FROM history_records r WHERE r.id=?`, text(id));
    if (!row) return null;
    const rec = shape(row);
    return { ...rec, provenance: { origin: rec.origin, source_id: rec.source_id, record_id: rec.record_id, host: rec.host, boot_id: rec.boot_id, seq: rec.seq, source: rec.source, imported: rec.imported } };
  }

  function health() {
    return all(`SELECT s.host, s.source_id, s.boot_id, s.last_collected, s.last_transfer, s.last_pull, s.pending, s.gaps, s.gaps_detail, s.last_error, s.last_error_at,
      (SELECT COUNT(*) FROM history_records WHERE source_id=s.source_id) AS records FROM history_sources s ORDER BY s.host, s.source_id`)
      .map(({ gaps_detail, ...row }) => ({ ...row, gaps_detail: JSON.parse(gaps_detail || '[]') }));
  }

  function noteFailure(host, error) {
    const message = text(error?.message ?? error).slice(0, 2000) || 'unknown failure';
    const at = new Date().toISOString();
    host = text(host) || 'unknown';
    const changed = run('UPDATE history_sources SET last_error=?, last_error_at=? WHERE host=?', message, at, host).changes;
    if (!changed) run("INSERT INTO history_sources (host,source_id,last_error,last_error_at) VALUES (?,'',?,?)", host, message, at);
  }

  // The returned list is the exact set of source-local ids that are durable here, duplicates included; the caller may acknowledge precisely those.
  function importBatch(batch, hostOverride) {
    if (!batch || typeof batch !== 'object' || !Array.isArray(batch.records)) throw new HistoryError('batch.records must be an array');
    const src = batch.source && typeof batch.source === 'object' ? batch.source : {};
    if (batch.records.length > 5000) throw new HistoryError('batch has too many records');
    const sourceId = text(src.source_id) || (batch.records[0]?.source_id ?? '');
    if (!sourceId && batch.records.length === 0) throw new HistoryError('batch.source.source_id is required');
    const valid = batch.records.map((r, i) => validateEnvelope(r, i, sourceId || undefined));
    const host = text(hostOverride) || text(src.host) || text(valid[0]?.host);
    if (!host) throw new HistoryError('batch has no host label');
    const accepted = [], now = new Date().toISOString();
    let inserted = 0;
    db.transaction(() => {
      for (const r of valid) {
        const meta = { ...(r.meta ?? {}) };
        if (text(r.host) && r.host !== host) meta.collector_host = r.host;
        const fresh = !one('SELECT 1 FROM history_records WHERE source_id=? AND record_id=?', r.source_id, r.id);
        if (fresh) run(`INSERT INTO history_records (id,source_id,record_id,host,boot_id,seq,session,pane_id,conversation_id,harness,kind,created,source,body,prompt,response,meta,task_id,origin,imported)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_id, record_id) DO NOTHING`,
          `${r.source_id}:${r.id}`, r.source_id, r.id, host, text(r.boot_id || src.boot_id), r.seq ?? null, text(r.session), text(r.pane_id), text(r.conversation_id), text(r.harness),
          r.kind, r.created, r.source, r.body, text(r.prompt), text(r.response), JSON.stringify(meta), null, 'collector', now);
        inserted += fresh ? 1 : 0;
        accepted.push(r.id);
      }
      if (sourceId) {
        const pending = Math.max(0, Number.isFinite(Number(src.pending)) ? Number(src.pending) : 0);
        const gapList = Array.isArray(src.gaps) ? src.gaps : Array.isArray(src.gap_details) ? src.gap_details : [];
        const gaps = Array.isArray(src.gaps) ? src.gaps.length : Number.isFinite(Number(src.gaps)) ? Number(src.gaps) : 0;
        run("DELETE FROM history_sources WHERE (host=? AND source_id='') OR (source_id=? AND host<>?)", host, sourceId, host);
        run(`INSERT INTO history_sources (host,source_id,boot_id,last_collected,last_transfer,last_pull,pending,gaps,gaps_detail,last_error,last_error_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,NULL) ON CONFLICT(host, source_id) DO UPDATE SET boot_id=excluded.boot_id, last_collected=COALESCE(excluded.last_collected, last_collected),
          last_transfer=COALESCE(excluded.last_transfer, last_transfer), last_pull=excluded.last_pull, pending=excluded.pending, gaps=excluded.gaps, gaps_detail=excluded.gaps_detail,
          last_error=excluded.last_error, last_error_at=NULL`,
          host, sourceId, text(src.boot_id), Number.isFinite(Date.parse(src.last_collected)) ? new Date(Date.parse(src.last_collected)).toISOString() : null, valid.length ? now : null, now, pending, gaps,
          JSON.stringify(gapList.slice(0, 100)), text(src.last_error));
      }
    })();
    return { accepted, inserted, duplicates: accepted.length - inserted, host, source_id: sourceId };
  }

  syncLegacy();
  return { importBatch, search, get, health, noteFailure, syncLegacy };
}
