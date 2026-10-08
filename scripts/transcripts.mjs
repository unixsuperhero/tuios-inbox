import { homedir } from 'node:os';
import { basename, join } from 'node:path';

// Where each harness keeps complete conversation JSONL files. A root that does not exist is reported, not hidden.
export function transcriptRoots(env = process.env) {
  const home = env.HOME || homedir();
  return [
    { harness: 'claude-code', root: join(env.CLAUDE_CONFIG_DIR || join(home, '.claude'), 'projects'), patterns: ['*/*.jsonl', '*/*/subagents/*.jsonl'] },
    { harness: 'omp', root: join(env.PI_CODING_AGENT_DIR || join(home, '.omp/agent'), 'sessions'), patterns: ['*/*.jsonl'] },
    { harness: 'codex', root: join(env.CODEX_HOME || join(home, '.codex'), 'sessions'), patterns: ['**/*.jsonl'] },
  ];
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
export function conversationIdFromPath(harness, path) {
  const name = basename(path, '.jsonl');
  if (harness === 'omp') return name.includes('_') ? name.slice(name.lastIndexOf('_') + 1) : name;
  if (harness === 'codex') return name.match(UUID)?.[0] || name;
  return name;
}

const json = value => { try { return JSON.stringify(value); } catch { return String(value); } };
const blocksOf = content => typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];

function resultText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content == null ? '' : json(content);
  return content.map(b => b?.type === 'text' ? b.text : b?.type === 'image' ? '[image]' : json(b)).join('\n');
}

// One readable text rendering per block, so a record body holds everything the entry said.
function blockText(block) {
  switch (block?.type) {
    case 'text': case 'input_text': case 'output_text': return block.text ?? '';
    case 'thinking': return `[thinking] ${block.thinking ?? block.text ?? ''}`;
    case 'tool_use': return `[tool_use ${block.name}] ${json(block.input)}`;
    case 'toolCall': return `[tool_call ${block.name}] ${json(block.arguments)}`;
    case 'tool_result': return `[tool_result${block.tool_use_id ? ' ' + block.tool_use_id : ''}] ${resultText(block.content)}`;
    case 'image': return '[image]';
    default: return json(block);
  }
}
const joined = blocks => blocks.map(blockText).filter(Boolean).join('\n\n');

const activity = (entry, extra = {}) => ({ kind: 'activity', body: json(entry), meta: { type: entry?.type, original: entry, ...extra } });

// A message with tool calls only is a tool record; any prose makes it a response.
function assistant(blocks, callType, meta) {
  const hasCall = blocks.some(b => b?.type === callType);
  const prose = blocks.some(b => ['text', 'thinking'].includes(b?.type) && (b.text || b.thinking));
  return { kind: hasCall && !prose ? 'tool' : 'response', body: joined(blocks), meta };
}

function claude(entry) {
  const meta = { type: entry.type, uuid: entry.uuid, parent_uuid: entry.parentUuid, sidechain: !!entry.isSidechain, agent_id: entry.agentId, cwd: entry.cwd, model: entry.message?.model, request_id: entry.requestId };
  const blocks = blocksOf(entry.message?.content);
  if (entry.type === 'user' && entry.message) {
    if (blocks.some(b => b.type === 'tool_result')) return { kind: 'tool', body: joined(blocks), meta };
    return entry.isMeta ? activity(entry, meta) : { kind: 'prompt', body: joined(blocks), meta };
  }
  if (entry.type === 'assistant' && entry.message) return assistant(blocks, 'tool_use', meta);
  return activity(entry, meta);
}

function omp(entry) {
  const meta = { type: entry.type, id: entry.id, parent_id: entry.parentId, role: entry.message?.role, model: entry.message?.model };
  const message = entry.message;
  if (entry.type !== 'message' || !message) return activity(entry, meta);
  const blocks = blocksOf(message.content);
  if (message.role === 'user') return { kind: 'prompt', body: joined(blocks), meta };
  if (message.role === 'assistant') return assistant(blocks, 'toolCall', meta);
  if (message.role === 'toolResult') return { kind: 'tool', body: joined(blocks), meta };
  return activity(entry, meta);
}

function codex(entry) {
  const p = entry.payload, meta = { type: entry.type, payload_type: p?.type, ordinal: entry.ordinal };
  if (entry.type !== 'response_item' || !p) return activity(entry, meta);
  if (p.type === 'message') {
    const blocks = blocksOf(p.content);
    if (p.role === 'user') return { kind: 'prompt', body: joined(blocks), meta: { ...meta, role: p.role } };
    if (p.role === 'assistant') return { kind: 'response', body: joined(blocks), meta: { ...meta, role: p.role } };
  }
  if (/^(function_call|custom_tool_call|local_shell_call)(_output)?$/.test(p.type)) {
    const body = p.type.endsWith('_output') ? `[tool_result ${p.call_id ?? ''}] ${resultText(p.output)}` : `[tool_call ${p.name ?? p.type}] ${typeof p.arguments === 'string' ? p.arguments : json(p.arguments ?? p.input ?? p.action)}`;
    return { kind: 'tool', body, meta };
  }
  return activity(entry, meta);
}

const readers = { 'claude-code': claude, omp, codex };

// Turns one parsed JSONL entry into { kind, body, prompt, response, created, conversation_id, meta }.
export function parseEntry(harness, entry, { path, conversation_id, fallbackTime }) {
  const out = readers[harness](entry);
  const created = entry.timestamp || entry.message?.timestamp;
  return {
    ...out,
    prompt: out.kind === 'prompt' ? out.body : '',
    response: out.kind === 'response' ? out.body : '',
    created: Number.isFinite(Date.parse(created)) ? new Date(created).toISOString() : typeof created === 'number' ? new Date(created).toISOString() : fallbackTime,
    conversation_id: (harness === 'claude-code' && entry.sessionId) || conversation_id,
    meta: { ...out.meta, original: entry, path },
  };
}

export const rawEntry = (line, error) => ({ kind: 'activity', body: line, prompt: '', response: '', meta: { parse_error: String(error) } });
