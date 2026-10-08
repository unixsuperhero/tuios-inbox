import { mkdir, rename, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { captureTurn } from './turn.mjs';
import { openCollector, defaultTuiosBin } from './collector.mjs';
const dir = process.env.TUIOS_INBOX_SPOOL || join(homedir(), '.local/share/tuios-inbox/events');
await mkdir(dir, { recursive: true, mode: 0o700 });
const event = { id: crypto.randomUUID(), time: new Date().toISOString(), values: {} };
const bin = defaultTuiosBin();
for (const [key, value] of Object.entries(process.env)) {
  if (key.startsWith('TUIOS_') && !/TOKEN|SOCKET|INBOX/.test(key)) event.values[key] = value;
}
async function capture(args) {
  const proc = Bun.spawn([bin, ...args, '--json'], { stdout: 'pipe', stderr: 'pipe' });
  const timer = setTimeout(() => proc.kill(), 3000);
  const [text, error, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  clearTimeout(timer);
  if (code) throw new Error(error || `Capture exited ${code}`);
  return JSON.parse(text);
}
const session = process.env.TUIOS_SESSION_ID, pane = process.env.TUIOS_WINDOW_ID;
if (session && pane) {
  try {
    const command = process.env.TUIOS_EVENT === 'after-command-finished';
    const [output, attention, agent] = await Promise.all([
      capture(['capture-pane', '-s', session, '-w', pane, '--lines', command ? '0' : '2000', command ? '--last-command' : '--scrollback']),
      capture(['list-attention']),
      command ? null : capture(['get-agent-state', '-s', session, '-w', pane]),
    ]);
    event.capture = output.content;
    event.captureMeta = output;
    event.bootId = attention.boot_id;
    event.agent = agent;
  } catch (error) { event.captureError = error.message; }
  // The collector queue is independent of the legacy spool the Inbox server consumes, and is written first.
  try {
    const collector = openCollector({ tuiosBin: process.env.TUIOS_BIN });
    try { event.collectorId = collector.appendHook(event); } finally { collector.close(); }
  } catch (error) { event.collectorError = error.message; }
  if (process.env.TUIOS_EVENT === 'after-agent-state') {
    event.turn = await captureTurn({ bin, session, pane, time: event.time, seed: {
      name: process.env.TUIOS_WINDOW_NAME, harness: process.env.TUIOS_AGENT_HARNESS, state: process.env.TUIOS_AGENT_STATE, summary: process.env.TUIOS_AGENT_MESSAGE,
    } });
  }
}
const temp = join(dir, `.${event.id}.tmp`), final = join(dir, `${event.id}.json`);
await Bun.write(temp, JSON.stringify(event));
await chmod(temp, 0o600);
await rename(temp, final);
