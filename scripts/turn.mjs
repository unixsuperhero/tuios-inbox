import { homedir } from 'node:os';
import { join } from 'node:path';

async function tuios(bin, args) {
  const proc = Bun.spawn([bin, ...args], { stdout: 'pipe', stderr: 'ignore' });
  const timer = setTimeout(() => proc.kill(), 3000);
  const [text, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  clearTimeout(timer);
  return code ? '' : text;
}

function entries(lines) {
  return lines.flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
}
// The last prompt in a conversation and the assistant text after its last tool call.
function lastTurn(messages, toolCall) {
  let prompt = '', reply = [];
  for (const { role, content } of messages) {
    const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
    const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n\n').trim();
    if (role === 'user') { if (text && !blocks.some(b => b.type === 'tool_result')) { prompt = text; reply = []; } }
    else if (role !== 'assistant') continue;
    else if (blocks.some(b => b.type === toolCall)) reply = [];
    else if (text) reply.push(text);
  }
  return prompt && reply.length ? { prompt, response: reply.join('\n\n'), source: 'transcript' } : null;
}
export const claudeTranscript = lines => lastTurn(entries(lines).filter(e => !e.isSidechain && !e.isMeta && e.message).map(e => ({ role: e.type, content: e.message.content })), 'tool_use');
export const ompTranscript = lines => lastTurn(entries(lines).filter(e => e.type === 'message' && e.message).map(e => e.message), 'toolCall');

// Where each harness keeps the conversation file for a session id, and how to read it.
const transcripts = {
  'claude-code': id => [join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects'), `*/${id}.jsonl`, claudeTranscript],
  omp: id => [join(process.env.PI_CODING_AGENT_DIR || join(homedir(), '.omp/agent'), 'sessions'), `*/*_${id}.jsonl`, ompTranscript],
};
async function transcriptTurn(harness, sessionId) {
  if (!transcripts[harness] || !/^[\w-]+$/.test(sessionId)) return null;
  const [root, pattern, read] = transcripts[harness](sessionId);
  const [path] = await Array.fromAsync(new Bun.Glob(pattern).scan({ cwd: root, absolute: true }));
  if (!path) return null;
  const file = Bun.file(path), size = 4 << 20;
  const lines = (await file.slice(Math.max(0, file.size - size)).text()).split('\n');
  if (file.size > size) lines.shift();
  return read(lines);
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
    else full = await transcriptTurn(agent.harness_id, agent.agent_session_id);
  } catch {}
  return { ...turn, ...full };
}
