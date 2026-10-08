import { afterEach, beforeEach, expect, test } from 'bun:test';
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCollector, runCollector } from './scripts/collector.mjs';

let dir, claudeRoot, collectors;
const line = o => JSON.stringify(o) + '\n';
const transcript = name => join(claudeRoot, 'proj', name);
const open = (extra = {}) => {
  const c = openCollector({ dataDir: join(dir, 'data'), host: 'test-host', tuiosBin: '/nonexistent/tuios', roots: [{ harness: 'claude-code', root: claudeRoot, patterns: ['*/*.jsonl', '*/*/subagents/*.jsonl'] }], ...extra });
  collectors.push(c);
  return c;
};
const user = (text, extra = {}) => ({ type: 'user', uuid: crypto.randomUUID(), timestamp: '2026-01-01T00:00:00Z', message: { role: 'user', content: text }, ...extra });
const assistant = content => ({ type: 'assistant', uuid: crypto.randomUUID(), timestamp: '2026-01-01T00:00:01Z', message: { role: 'assistant', content } });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'collector-test-'));
  claudeRoot = join(dir, 'claude');
  mkdirSync(join(claudeRoot, 'proj'), { recursive: true });
  collectors = [];
});
afterEach(() => { collectors.forEach(c => c.close()); rmSync(dir, { recursive: true, force: true }); });

test('backfills every record kind, tools and subagents, with full bodies', async () => {
  const long = 'x'.repeat(50000);
  writeFileSync(transcript('abc.jsonl'),
    line(user('hello 🌍 prompt')) +
    line(assistant([{ type: 'text', text: long }, { type: 'tool_use', name: 'Bash', input: { command: 'ls' } }])) +
    line(assistant([{ type: 'tool_use', name: 'Read', input: { file_path: '/a' } }])) +
    line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'file list' }] } }) +
    line({ type: 'ai-title', aiTitle: 'Title', sessionId: 'abc' }));
  mkdirSync(join(claudeRoot, 'proj', 'abc', 'subagents'), { recursive: true });
  writeFileSync(join(claudeRoot, 'proj', 'abc', 'subagents', 'agent-1.jsonl'), line(user('sub task', { isSidechain: true, sessionId: 'abc' })));
  const c = open();
  await c.scan();
  const { records, source } = c.exportBatch(100);
  expect(records.map(r => r.kind)).toEqual(['prompt', 'response', 'tool', 'tool', 'activity', 'prompt']);
  expect(records[1].body.length).toBeGreaterThan(50000);
  expect(records[1].body).toContain('[tool_use Bash]');
  expect(records[4].body).toContain('ai-title');
  expect(records[5].meta.sidechain).toBe(true);
  expect(records[5].conversation_id).toBe('abc');
  expect(records[0]).toMatchObject({ version: 1, host: 'test-host', harness: 'claude-code', prompt: 'hello 🌍 prompt', source: 'transcript', source_id: c.sourceId });
  expect(source).toMatchObject({ pending: 6, gaps: 0, host: 'test-host' });
  expect(new Set(records.map(r => r.id)).size).toBe(6);
});

test('partial JSON lines wait for their newline and unicode offsets stay correct', async () => {
  const c = open(), path = transcript('part.jsonl');
  const whole = line(user('héllo 🌍'));
  writeFileSync(path, whole.slice(0, 20));
  await c.scan();
  expect(c.exportBatch().records).toHaveLength(0);
  appendFileSync(path, whole.slice(20) + line(user('second 🌍')));
  appendFileSync(path, '{"type":"user","mess');
  await c.scan();
  const records = c.exportBatch().records;
  expect(records.map(r => r.prompt)).toEqual(['héllo 🌍', 'second 🌍']);
  expect(records[1].meta.byte_offset).toBe(Buffer.byteLength(whole));
  appendFileSync(path, 'age":{"role":"user","content":"third"}}\n');
  await c.scan();
  expect(c.exportBatch().records.map(r => r.prompt).at(-1)).toBe('third');
});

test('restart and rescan never duplicate or lose records, and malformed lines become activity', async () => {
  const path = transcript('r.jsonl');
  writeFileSync(path, line(user('one')) + 'not json\n');
  let c = open();
  await c.scan(); await c.scan();
  const first = c.exportBatch().records;
  expect(first.map(r => r.kind)).toEqual(['prompt', 'activity']);
  expect(first[1].body).toBe('not json');
  expect(first[1].meta.parse_error).toBeTruthy();
  c.close();
  appendFileSync(path, line(user('two')));
  c = open();
  await c.scan();
  const ids = c.exportBatch().records.map(r => r.id);
  expect(ids).toHaveLength(3);
  expect(ids.slice(0, 2)).toEqual(first.map(r => r.id));
});

test('ack removes exactly the delivered ids, keeps checkpoints and later records only', async () => {
  const path = transcript('a.jsonl');
  writeFileSync(path, line(user('a')) + line(user('b')) + line(user('c')));
  const c = open();
  await c.scan();
  const ids = c.exportBatch().records.map(r => r.id);
  expect(c.ack([ids[0], ids[2], 'unknown'])).toBe(2);
  expect(c.exportBatch().records.map(r => r.id)).toEqual([ids[1]]);
  expect(c.ack(ids.slice(0, 1))).toBe(0);
  expect(() => c.ack('nope')).toThrow();
  await c.scan();
  expect(c.exportBatch().records.map(r => r.id)).toEqual([ids[1]]);
  appendFileSync(path, line(user('d')));
  await c.scan();
  expect(c.exportBatch().records).toHaveLength(2);
  expect(c.status().pending).toBe(2);
});

test('truncation and rotation surface a gap and start a new generation', async () => {
  const path = transcript('rot.jsonl');
  writeFileSync(path, line(user('before truncation')));
  const c = open();
  await c.scan();
  truncateSync(path, 0);
  writeFileSync(path, line(user('x')));
  await c.scan();
  expect(c.status().gaps).toBe(1);
  renameSync(path, path + '.old');
  writeFileSync(path, line(user('after rotation, longer than before')));
  await c.scan();
  const records = c.exportBatch(100).records;
  expect(records.filter(r => r.kind === 'gap')).toHaveLength(2);
  expect(records.filter(r => r.kind === 'prompt').map(r => r.prompt)).toEqual(['before truncation', 'x', 'after rotation, longer than before']);
  expect(new Set(records.map(r => r.id)).size).toBe(records.length);
  expect(c.status().gap_details[0].detail).toContain('rot.jsonl');
});

test('hook events journal immediately, filter secrets and dedupe', () => {
  const c = open();
  const event = { id: 'e1', time: '2026-01-01T00:00:00Z', values: { TUIOS_EVENT: 'after-command-finished', TUIOS_SESSION_ID: 's', TUIOS_WINDOW_ID: 'w', TUIOS_COMMAND: 'ls', TUIOS_PANE_TOKEN: 'secret' }, capture: 'output', captureMeta: { content: 'output', command_seq: 3 }, bootId: 'b' };
  expect(c.appendHook(event)).toBe('command:b:w:3');
  c.appendHook(event);
  const [record] = c.exportBatch().records;
  expect(c.status().pending).toBe(1);
  expect(record).toMatchObject({ kind: 'command', session: 's', pane_id: 'w', boot_id: 'b', source: 'pane' });
  expect(record.body).toBe('ls\noutput');
  expect(JSON.stringify(record)).not.toContain('secret');
  expect(record.meta.capture_meta).toEqual({ command_seq: 3 });
});

// A scripted stand-in for the tuios binary: agents.json feeds list-agents, capture.json feeds capture-pane.
function fakeTuios(handlers = {}) {
  const bin = join(dir, 'tuios');
  writeFileSync(bin, `#!/bin/bash
D="${dir}"
case "$1" in
  list-sessions) echo '[{"name":"s"}]';;
  list-agents) cat "$D/agents.json" 2>/dev/null || echo '{"agents":[]}';;
  capture-pane) cat "$D/capture.json" || { echo "capture refused" >&2; exit 1; };;
  subscribe) ${handlers.subscribe || 'exec sleep 60'};;
  *) exit 1;;
esac
`);
  chmodSync(bin, 0o755);
  return bin;
}
const agent = extra => ({ window_id: 'w1', harness_id: 'claude-code', agent_session_id: 'conv-1', protocol: '', ...extra });
const setAgents = agents => writeFileSync(join(dir, 'agents.json'), JSON.stringify({ agents }));

test('unreadable roots and tuios lookup failures surface in last_error instead of looking healthy', async () => {
  const c = open();
  writeFileSync(transcript('a.jsonl'), line(user('x')));
  chmodSync(claudeRoot, 0o000);
  try {
    const result = await c.scan();
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('unreadable');
  } finally { chmodSync(claudeRoot, 0o755); }
  expect(c.status().last_error).toContain('claude-code');
  expect(c.status().last_error).toContain('list-sessions');
  expect(c.status().transcript_sources[0].error).toContain('unreadable');
  const healthy = open({ tuiosBin: fakeTuios() });
  const ok = await healthy.scan();
  expect(ok.ok).toBe(true);
  expect(healthy.status().last_error).toBe('');
});

test('a failed list-agents keeps known panes and reports the failure', async () => {
  const c = open({ tuiosBin: fakeTuios() });
  setAgents([agent()]);
  await c.scan();
  writeFileSync(join(dir, 'tuios'), '#!/bin/bash\ncase "$1" in list-sessions) echo \'[{"name":"s"}]\';; *) exit 1;; esac\n');
  const result = await c.scan();
  expect(result.ok).toBe(false);
  expect(c.status().last_error).toContain('list-agents s');
  expect(c.status().coverage_gaps).toHaveLength(1);
});

test('active panes without readable transcripts expose coverage gaps', async () => {
  const c = open({ tuiosBin: fakeTuios() });
  setAgents([agent(), agent({ window_id: 'w2', harness_id: 'opencode', agent_session_id: '' }), agent({ window_id: 'w3', harness_id: 'codex', protocol: 'codex', agent_session_id: 'c3' })]);
  writeFileSync(transcript('other.jsonl'), line(user('hi')));
  await c.scan();
  let kinds = () => c.exportBatch(100).records.filter(r => r.kind === 'gap').map(r => r.meta.coverage).sort();
  expect(kinds()).toEqual(['protocol', 'unsupported']);
  expect(c.status().coverage_gaps.map(g => g.kind).sort()).toEqual(['missing', 'protocol', 'unsupported']);
  expect(c.status().last_error).toContain('without full transcript coverage');
  await c.scan(); await c.scan();
  expect(kinds()).toEqual(['missing', 'protocol', 'unsupported']);
  expect(c.exportBatch(100).records.find(r => r.meta.coverage === 'missing')).toMatchObject({ pane_id: 'w1', conversation_id: 'conv-1', source: 'summary' });
  writeFileSync(transcript('conv-1.jsonl'), line(user('now it exists')));
  await c.scan();
  expect(c.status().coverage_gaps.map(g => g.kind).sort()).toEqual(['protocol', 'unsupported']);
});

test('native command-finished captures output when hooks are not loaded and dedupes with the hook', async () => {
  const c = open({ tuiosBin: fakeTuios() });
  writeFileSync(join(dir, 'capture.json'), JSON.stringify({ content: 'build ok', command_seq: 4 }));
  await c.handleNative({ type: 'subscribed', boot_id: 'b1' });
  await c.handleNative({ type: 'command-finished', session: 's', window: 'w', boot_id: 'b1', seq: 9, command_seq: 4, exit_code: 0 });
  let records = c.exportBatch().records;
  expect(records.map(r => r.id)).toEqual(['native:b1:9', 'command:b1:w:4']);
  expect(records[1]).toMatchObject({ kind: 'command', source: 'pane', body: 'build ok', meta: { captured_by: 'native' } });
  c.appendHook({ id: 'h1', bootId: 'b1', values: { TUIOS_EVENT: 'after-command-finished', TUIOS_WINDOW_ID: 'w' }, capture: 'build ok', captureMeta: { command_seq: 4 } });
  expect(c.status().pending).toBe(2);

  writeFileSync(join(dir, 'capture.json'), JSON.stringify({ content: 'later', command_seq: 6 }));
  await c.handleNative({ type: 'command-finished', session: 's', window: 'w', boot_id: 'b1', seq: 10, command_seq: 5 });
  rmSync(join(dir, 'capture.json'));
  await c.handleNative({ type: 'command-finished', session: 's', window: 'w', boot_id: 'b1', seq: 11, command_seq: 7 });
  records = c.exportBatch().records.slice(2);
  expect(records.filter(r => r.kind === 'gap').map(r => r.body)).toEqual([
    expect.stringContaining('already moved on to command #6'), expect.stringContaining('capture-pane exited 1')]);
  expect(c.nativeArgs()).toContain('11');
});

test('periodic waits remove their abort listeners', async () => {
  const c = open({ tuiosBin: fakeTuios() });
  const listeners = new Set();
  const signal = { aborted: false, addEventListener: (_, f) => listeners.add(f), removeEventListener: (_, f) => listeners.delete(f) };
  const run = runCollector(c, { interval: 5, tuiosBin: join(dir, 'tuios'), signal });
  await Bun.sleep(150);
  expect(listeners.size).toBeLessThan(5);
  signal.aborted = true;
  for (const f of [...listeners]) f();
  await run;
});

test('a native stream read failure kills the subscriber child', async () => {
  const bin = fakeTuios({ subscribe: `echo $$ > "${dir}/pid"; echo notjson; exec sleep 60` });
  const c = open({ tuiosBin: bin });
  const controller = new AbortController();
  const run = runCollector(c, { interval: 60000, tuiosBin: bin, signal: controller.signal });
  for (let i = 0; i < 100 && !c.status().native.startsWith('reconnecting'); i++) await Bun.sleep(50);
  expect(c.status().native).toBe('reconnecting');
  const pid = Number(readFileSync(join(dir, 'pid'), 'utf8'));
  let alive = true;
  try { process.kill(pid, 0); } catch { alive = false; }
  controller.abort();
  await run;
  expect(alive).toBe(false);
});

test('native events journal with their cursor and a stream gap becomes visible', async () => {
  const c = open({ tuiosBin: fakeTuios() });
  writeFileSync(join(dir, 'capture.json'), JSON.stringify({ content: 'x' }));
  await c.handleNative({ type: 'subscribed', boot_id: 'boot1', seq: 5 });
  await c.handleNative({ type: 'command-finished', session: 's', window: 'w', boot_id: 'boot1', seq: 6, exit_code: 0 });
  expect(c.nativeArgs()).toEqual(['subscribe', '--types', expect.any(String), '--after-seq', '6', '--boot-id', 'boot1']);
  await c.handleNative({ type: 'gap', reason: 'boot_changed', boot_id: 'boot2' });
  expect(c.nativeArgs().slice(-4)).toEqual(['--after-seq', '0', '--boot-id', 'boot2']);
  const status = c.status();
  expect(status).toMatchObject({ boot_id: 'boot2', gaps: 1, pending: 3 });
  const records = c.exportBatch().records;
  expect(records.map(r => [r.kind, r.seq])).toEqual([['command', 6], ['command', null], ['gap', null]]);
  expect(records[0].id).toBe('native:boot1:6');
});
