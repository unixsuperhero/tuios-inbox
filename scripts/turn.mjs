import { homedir } from 'node:os';
import { join } from 'node:path';

async function tuios(bin, args) {
  const proc = Bun.spawn([bin, ...args], { stdout: 'pipe', stderr: 'ignore' });
  const timer = setTimeout(() => proc.kill(), 3000);
  const [text, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  clearTimeout(timer);
  return code ? '' : text;
}

// Claude Code's own conversation file: the last prompt and the text after its last tool call.
export function claudeTranscript(lines) {
  let prompt = '', reply = [];
  for (const line of lines) {
    let entry; try { entry = JSON.parse(line); } catch { continue; }
    if (entry.isSidechain || entry.isMeta || !['user', 'assistant'].includes(entry.type)) continue;
    const content = entry.message?.content;
    const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
    const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n\n').trim();
    if (entry.type === 'user') { if (text && !blocks.some(b => b.type === 'tool_result')) { prompt = text; reply = []; } }
    else if (blocks.some(b => b.type === 'tool_use')) reply = [];
    else if (text) reply.push(text);
  }
  return prompt && reply.length ? { prompt, response: reply.join('\n\n'), source: 'transcript' } : null;
}

// A protocol pane prints "you  <prompt>", the turn, then "turn finished".
export function paneTranscript(text) {
  const lines = text.split('\n').map(line => line.trimEnd());
  const start = lines.findLastIndex(line => line.startsWith('you  ')), end = lines.lastIndexOf('turn finished');
  if (start < 0 || end < start) return null;
  // The pane hard-wraps at its width, so a full line continues on the next one.
  const width = Math.max(...lines.map(line => [...line].length));
  const turn = []; let glue = null;
  for (const line of lines.slice(start, end)) {
    if (glue === null || !line) turn.push(line); else turn[turn.length - 1] += glue + line;
    const length = [...line].length;
    glue = length === width ? '' : length === width - 1 ? ' ' : null;
  }
  const gap = turn.indexOf('');
  if (gap < 0) return null;
  return { prompt: turn.slice(0, gap).join('\n').slice(5), response: turn.slice(gap + 1).join('\n').trim(), source: 'pane' };
}

async function claudeTurn(sessionId) {
  if (!/^[\w-]+$/.test(sessionId)) return null;
  const projects = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
  const [path] = await Array.fromAsync(new Bun.Glob(`*/${sessionId}.jsonl`).scan({ cwd: projects, absolute: true }));
  if (!path) return null;
  const file = Bun.file(path), size = 4 << 20;
  const lines = (await file.slice(Math.max(0, file.size - size)).text()).split('\n');
  if (file.size > size) lines.shift();
  return claudeTranscript(lines);
}

// TUIOS_AGENT_MESSAGE (the seed summary) is only the first line of the reply, cut short.
// The whole turn comes from the harness transcript or the pane, when one can be read.
export async function captureTurn({ bin, session, pane, time, seed = {} }) {
  let agent;
  try { agent = JSON.parse(await tuios(bin, ['list-agents', '-s', session, '--json'])).agents?.find(a => a.window_id === pane); } catch {}
  // A pane that already left the reported state is on its next turn; only the summary is this turn's.
  const current = agent?.state === seed.state;
  const turn = {
    session, pane, name: agent?.name || seed.name || '', harness: agent?.harness_id || seed.harness || '', state: seed.state,
    at: current && agent.agent_state_at ? new Date(agent.agent_state_at / 1e6).toISOString() : time,
    prompt: current ? agent.meta?.prompt || '' : '', response: seed.summary || '', source: 'summary',
  };
  if (!current) return turn;
  let full = null;
  try {
    if (agent.protocol) full = paneTranscript(await tuios(bin, ['capture-pane', '-s', session, '-w', pane, '--scrollback', '--lines', '10000']));
    else if (agent.harness_id === 'claude-code' && agent.agent_session_id) full = await claudeTurn(agent.agent_session_id);
  } catch {}
  return { ...turn, ...full };
}
