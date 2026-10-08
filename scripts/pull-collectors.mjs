// Pulls complete record batches from collectors (local subprocess or SSH), makes them durable in the central history,
// and only then acknowledges the exact imported ids so the collector can drop them from its outbox.
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const DEFAULT_COLLECTOR = join(dirname(import.meta.dir), 'scripts/collector.mjs');
const MAX_OUTPUT = 128 * 1024 * 1024;
const MAX_BATCHES = 100;

export const shellQuote = value => `'${String(value).replace(/'/g, `'\\''`)}'`;

export function defaultDataDir() {
  return process.env.TUIOS_INBOX_DATA || join(homedir(), '.local/share/tuios-inbox');
}

// Argv for one collector invocation. SSH gets a single quoted remote command, BatchMode and a connect timeout; host keys are never bypassed.
export function buildCommand(source, args, { connectTimeout = 10 } = {}) {
  const bun = source.bun || 'bun';
  const collector = source.collector_path || DEFAULT_COLLECTOR;
  const tail = [...args, ...(source.data_dir ? ['--data', source.data_dir] : [])];
  if (!source.ssh) return [bun, collector, ...tail];
  if (String(source.ssh).startsWith('-')) throw new Error(`Invalid SSH target ${JSON.stringify(source.ssh)}`);
  return ['ssh', '-o', 'BatchMode=yes', '-o', `ConnectTimeout=${connectTimeout}`, '--', source.ssh, [bun, collector, ...tail].map(shellQuote).join(' ')];
}

export async function loadSources(dataDir = defaultDataDir()) {
  let raw;
  try { raw = await readFile(join(dataDir, 'collectors.json'), 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT') return [{ host: 'local', ssh: null, collector_path: DEFAULT_COLLECTOR, bun: process.execPath }];
    throw new Error(`Cannot read collectors.json: ${e.message}`);
  }
  let list;
  try { list = JSON.parse(raw); } catch (e) { throw new Error(`collectors.json is not valid JSON: ${e.message}`); }
  if (!Array.isArray(list)) throw new Error('collectors.json must be an array of sources');
  return list.map((s, i) => {
    if (!s || typeof s !== 'object' || typeof s.host !== 'string' || !s.host) throw new Error(`collectors.json[${i}] needs a host`);
    return { host: s.host, ssh: s.ssh || null, collector_path: s.collector_path, data_dir: s.data_dir, bun: s.bun };
  });
}

async function execute(argv, { stdin, timeoutMs, signal }) {
  const child = Bun.spawn(argv, { stdin: stdin == null ? 'ignore' : Buffer.from(stdin), stdout: 'pipe', stderr: 'pipe', env: process.env });
  let timedOut = false;
  const kill = () => { try { child.kill(); } catch {} };
  const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
  signal?.addEventListener('abort', kill, { once: true });
  const read = async stream => {
    const chunks = []; let size = 0;
    for await (const chunk of stream) { size += chunk.length; if (size > MAX_OUTPUT) { kill(); throw new Error('collector output exceeded the size limit'); } chunks.push(chunk); }
    return Buffer.concat(chunks).toString('utf8');
  };
  try {
    const [out, err, code] = await Promise.all([read(child.stdout), read(child.stderr), child.exited]);
    if (timedOut) throw new Error(`timed out after ${Math.round(timeoutMs / 1000)}s`);
    if (signal?.aborted) throw new Error('pull aborted');
    if (code !== 0) throw new Error(`exited ${code}: ${(err || out).trim().slice(0, 500) || 'no output'}`);
    return out;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', kill); }
}

const parseJson = (out, what) => {
  try { return JSON.parse(out); } catch { throw new Error(`${what} did not return JSON: ${out.trim().slice(0, 200) || 'empty output'}`); }
};

async function pullSource(source, { history, onChange, signal, timeoutMs }) {
  const result = { host: source.host, ok: false, imported: 0, duplicates: 0, batches: 0, error: '' };
  try {
    const argsOf = args => buildCommand(source, args);
    let previousFirst = null;
    for (let n = 0; n < MAX_BATCHES; n++) {
      const batch = parseJson(await execute(argsOf(['export']), { timeoutMs, signal }), 'collector export');
      if (!batch || !Array.isArray(batch.records)) throw new Error('collector export has no records array');
      const first = batch.records[0]?.id ?? null;
      if (first !== null && first === previousFirst) throw new Error('collector did not drop acknowledged records');
      previousFirst = first;
      const done = history.importBatch(batch, source.host);
      result.batches++; result.imported += done.inserted; result.duplicates += done.duplicates;
      if (done.inserted) onChange?.(source.host, done);
      if (!batch.records.length) { result.ok = true; return result; }
      const ack = parseJson(await execute(argsOf(['ack']), { stdin: JSON.stringify({ ids: done.accepted }), timeoutMs, signal }), 'collector ack');
      if (ack?.ok !== true) throw new Error('collector refused the acknowledgement');
    }
    result.ok = true; // more remains queued; the next pull continues
    return result;
  } catch (e) {
    result.error = e.message;
    history.noteFailure(source.host, e.message);
    return result;
  }
}

// Sources are pulled independently; one unreachable host never blocks the others. Overlapping pulls share one run.
export function createPuller({ history, sources, dataDir, onChange, signal, timeoutMs = 120000 }) {
  let running = null, timer = null;
  const pull = () => running ??= (async () => {
    let list = sources;
    try { list ??= await loadSources(dataDir); } catch (e) { history.noteFailure('collectors.json', e.message); return [{ host: 'collectors.json', ok: false, imported: 0, duplicates: 0, batches: 0, error: e.message }]; }
    if (!list.length) {
      const error = 'No collectors are configured; run scripts/setup-cross-host.mjs install to register one';
      history.noteFailure('(no collectors)', error);
      return [{ host: '(no collectors)', ok: false, imported: 0, duplicates: 0, batches: 0, error }];
    }
    return Promise.all(list.map(s => pullSource(s, { history, onChange, signal, timeoutMs })));
  })().finally(() => { running = null; });
  const start = (intervalMs = 60000) => { stop(); timer = setInterval(() => { pull().catch(() => {}); }, intervalMs); timer.unref?.(); pull().catch(() => {}); };
  const stop = () => { clearInterval(timer); timer = null; };
  return { pull, start, stop };
}

export const pullCollectors = options => createPuller(options).pull();
