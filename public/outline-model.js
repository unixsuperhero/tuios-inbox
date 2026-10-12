// Pure outline model: inheritance by lookup, run preflight, queue order. No DOM, no fetch, so server and browser share it.
export const DEFAULTS = { harness: 'omp', queue_mode: 'manual' };
export const FIELDS = ['repo', 'branch', 'harness', 'model', 'queue_mode', 'session', 'workspace'];
const get = (index, key) => key == null ? undefined : index instanceof Map ? index.get(key) : index?.[key];
const set = value => value !== undefined && value !== null && value !== '';
const own = (record, field) => { const src = record.own || record; return field === 'repo' ? (set(src.repo) ? src.repo : src.path) : src[field]; };
const isPrompt = record => 'body' in record || 'task_id' in record;

/**
 * Looks each field up through record -> its task -> parent task -> ... -> DEFAULTS. Nothing is copied.
 * @returns {Record<string, {value: any, from: string}>} from = 'self' | <task id> | 'default' | 'none'
 */
export function resolve(record, tasksById) {
  const out = {};
  for (const field of FIELDS) {
    out[field] = field in DEFAULTS ? { value: DEFAULTS[field], from: 'default' } : { value: null, from: 'none' };
    const seen = new Set();
    for (let cur = record, first = true; cur && !seen.has(cur); first = false) {
      seen.add(cur);
      const value = own(cur, field);
      if (set(value)) { out[field] = { value, from: first ? 'self' : cur.id }; break; }
      cur = get(tasksById, first && isPrompt(cur) ? cur.task_id : cur.parent_id);
    }
  }
  return out;
}

/** The profile that launches a harness: matched by id or executable; Claude Code reports itself as claude-code. */
export function profileFor(harness, profiles = []) {
  const name = harness === 'claude-code' ? 'claude' : harness;
  return profiles.find(p => p.id === name) || profiles.find(p => p.executable === name) || null;
}

/** The pane a prompt runs in when it names none: an agent of its task that is at rest. */
export function pickPane(prompt, panes = []) {
  if (!prompt.task_id) return null;
  return panes.find(p => p.task_id === prompt.task_id && p.kind === 'agent' && p.ready) || null;
}

/**
 * @param {{prompt: object, resolved: object, panes?: object[], git?: object, profiles?: object[]}} input
 * @returns {{blocks: {code: string, message: string, fix: string}[], warns: {code: string, message: string}[]}}
 */
// A prompt already sent has its place: the pane is busy with that very prompt, which is no block. `strict` is the moment of running, when every block counts.
export function preflight({ prompt, resolved, panes = [], git = null, profiles = [], strict = false }) {
  const blocks = [], warns = [], sent = !strict && ['running', 'done'].includes(prompt.state);
  if (!String(prompt.body || '').trim()) blocks.push({ code: 'no_text', message: 'No text to send', fix: 'body' });
  if (sent) ;
  else if (prompt.target) {
    const pane = panes.find(p => p.id === prompt.target);
    if (!pane || pane.state === 'closed') blocks.push({ code: 'pane_gone', message: 'Target pane is gone', fix: 'target' });
    else if (pane.state === 'needs_input') blocks.push({ code: 'pane_blocked', message: 'Target pane is waiting on its own question', fix: 'target' });
    else if (!pane.ready) blocks.push({ code: 'pane_blocked', message: 'Target pane is busy; wait for it to come to rest', fix: 'target' });
  } else if (!pickPane(prompt, panes)) {
    if (!resolved.repo?.value) blocks.push({ code: 'nowhere', message: 'Nowhere to run: no pane at rest and no repo directory to launch in', fix: 'repo' });
    else if (!profileFor(resolved.harness?.value, profiles)) blocks.push({ code: 'no_harness', message: `No agent profile launches ${resolved.harness?.value || 'a harness'} on this host`, fix: 'harness' });
  }
  if (git?.state === 'ok') {
    const branch = resolved.branch?.value;
    if (branch && git.head && git.head !== branch) warns.push({ code: 'branch_mismatch', message: `Repo is on ${git.head}, task expects ${branch}` });
    if (git.dirty) warns.push({ code: 'dirty', message: 'Working tree has uncommitted changes' });
    if (git.pr?.checks === 'failing') warns.push({ code: 'checks_failing', message: 'Pull request checks are failing' });
  }
  return { blocks, warns };
}

const inQueue = (prompt, taskId) => (prompt.task_id ?? null) === (taskId ?? null);
const byPosition = (a, b) => a.position - b.position || (a.created < b.created ? -1 : a.created > b.created ? 1 : 0);
/** The lowest-position queued prompt of a task; a null task is the No task queue. */
export function nextInQueue(prompts, taskId = null) {
  return prompts.filter(p => p.state === 'queued' && inQueue(p, taskId)).sort(byPosition)[0] || null;
}
/** An automatic queue holds while an earlier prompt of the same task is blocked, errored or still running. */
export function queueHeld(prompts, next) {
  return prompts.some(p => p.id !== next.id && inQueue(p, next.task_id) && ['blocked', 'errored', 'running'].includes(p.state) && p.position < next.position);
}

/**
 * The todo list an oh-my-pi conversation ends with, replayed from its `todo` tool calls.
 * @param {object[]} entries parsed transcript lines
 * @returns {{title: string, done: boolean}[]}
 */
export function ompTodos(entries) {
  let list = [];
  const add = (items, phase) => { for (const title of items || []) if (typeof title === 'string' && title.trim() && !list.some(t => t.title === title.trim())) list.push({ title: title.trim(), phase: phase || '', done: false }); };
  const addAll = a => { for (const group of Array.isArray(a.list) ? a.list : []) add(group?.items, group?.phase); add(a.items, a.phase); };
  for (const entry of entries) for (const block of Array.isArray(entry?.message?.content) ? entry.message.content : []) {
    if (block?.type !== 'toolCall' || block.name !== 'todo') continue;
    const a = block.arguments || {}, hit = t => a.task ? t.title === String(a.task).trim() : a.phase ? t.phase === a.phase : false;
    if (a.op === 'init') { list = []; addAll(a); }
    else if (a.op === 'append') addAll(a);
    else if (a.op === 'done' || a.op === 'drop') { for (const t of list) if (hit(t)) t.done = true; }
    else if (a.op === 'rm') list = list.filter(t => !hit(t));
  }
  return list.map(({ title, done }) => ({ title, done }));
}

const ms = value => Date.parse(value) || 0;
const oldestFirst = (a, b) => (a.oldest ?? a.at) - (b.oldest ?? b.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/**
 * The Needs me review queue, never deeper than three levels: root task (or No task) -> subtask path (or pane) -> item.
 * Items are unarchived runs that are unread or on a question, and prompts that are blocked or errored. Every level is
 * ordered by its oldest waiting item. Descendants of any depth flatten to one level, titled with their path below the root.
 * @param {{tasks?: object[], runs?: object[], prompts?: object[], panes?: object[]}} data the GET /api/outline payload
 * @param {string|null} rootTaskId only this task and its descendants; it becomes the single level-1 group
 * @param {Set<string>} keep item ids ('run:<id>', 'prompt:<id>') that stay listed even once read
 * @returns {{id: string, title: string, count: number, oldest: number|null, items: object[], groups: {id: string, title: string, count: number, oldest: number|null, items: object[]}[]}[]}
 */
export function reviewQueue({ tasks = [], runs = [], prompts = [], panes = [] } = {}, rootTaskId = null, keep = new Set()) {
  const byId = new Map(tasks.map(t => [t.id, t])), promptById = new Map(prompts.map(p => [p.id, p])), paneById = new Map(panes.map(p => [p.id, p]));
  const chain = id => { const out = [], seen = new Set(); for (let t = byId.get(id); t && !seen.has(t.id); t = byId.get(t.parent_id)) { seen.add(t.id); out.unshift(t); } return out; };
  const items = [];
  for (const r of runs) {
    const id = `run:${r.id}`, prompt = promptById.get(r.prompt_id);
    if (keep.has(id) || !r.archived && (r.unread || r.state === 'needs_input')) items.push({ id, kind: 'run', rec: r, at: ms(r.finished) || ms(r.started), task_id: prompt ? prompt.task_id : r.task_id, pane_id: r.pane_id || '', pane_name: r.pane_name || '' });
  }
  for (const p of prompts) {
    const id = `prompt:${p.id}`;
    if (keep.has(id) || ['blocked', 'errored'].includes(p.state)) items.push({ id, kind: 'prompt', rec: p, at: ms(p.updated) || ms(p.created), task_id: p.task_id, pane_id: p.target || p.pane_id || '', pane_name: '' });
  }
  const tops = new Map();
  const group = (map, id, title, extra) => { if (!map.has(id)) map.set(id, { id, title, count: 0, oldest: null, items: [], ...extra }); return map.get(id); };
  for (const item of items) {
    const path = chain(item.task_id);
    if (path.some(t => t.archived) && !keep.has(item.id)) continue;
    const start = rootTaskId == null ? 0 : path.findIndex(t => t.id === rootTaskId);
    if (start < 0 || rootTaskId != null && !path.length) continue;
    const top = path.length ? group(tops, path[start].id, path[start].title, { groups: new Map() }) : group(tops, 'none', 'No task', { groups: new Map() });
    const below = path.slice(start + 1);
    if (!path.length) group(top.groups, `pane:${item.pane_id}`, paneById.get(item.pane_id)?.name || item.pane_name || (item.pane_id ? `pane ${item.pane_id.slice(0, 8)}` : 'No pane'), { pane_id: item.pane_id }).items.push(item);
    else if (below.length) group(top.groups, below.at(-1).id, below.map(t => t.title).join(' / ')).items.push(item);
    else top.items.push(item);
  }
  const finish = g => {
    g.items.sort(oldestFirst);
    if (g.groups) g.groups = [...g.groups.values()].map(finish).sort(oldestFirst);
    const all = [...g.items.map(i => i.at), ...(g.groups || []).map(s => s.oldest)];
    g.count = g.items.length + (g.groups || []).reduce((n, s) => n + s.count, 0);
    g.oldest = all.length ? Math.min(...all) : null;
    return g;
  };
  return [...tops.values()].map(finish).sort(oldestFirst);
}
/** Every item of a review queue in reading order: each group's own items, then its subgroups' items. */
export const reviewItems = groups => groups.flatMap(g => [...g.items, ...g.groups.flatMap(s => s.items)]);

const stateWord = r => r.state === 'needs_input' ? 'needs input' : !r.state || r.state === 'none' || r.state === 'unknown' ? 'ended' : r.state;
/**
 * The left rail: open root tasks, their subtasks flattened to one level, and one entry per pane; never deeper than three levels.
 * A pane with waiting runs (unread, or on a question) is one entry for the OLDEST of them; the newer waiting runs ride along
 * in `newer`, oldest first. A pane with nothing waiting shows its latest run as a read entry while the pane is still open.
 * Blocked and errored prompts are entries of their own. Archived runs and runs under an archived task are left out.
 * Roots with something unread come first, oldest waiting first, then the rest by creation; No task comes last, only when it has entries.
 * @param {{tasks?: object[], runs?: object[], prompts?: object[], panes?: object[]}} data the GET /api/outline payload
 * @param {Set<string>} keep item ids ('run:<id>', 'prompt:<id>') that stay listed even once read: the item that is open
 * @returns {{id: string, title: string, unread: number, oldest: number|null, items: object[], groups: {id: string, title: string, unread: number, oldest: number|null, items: object[]}[]}[]}
 *   an item is {id, kind: 'run'|'prompt', rec, at, unread, word, summary, pane_id, pane_name, newer: item[]}
 */
export function railTree({ tasks = [], runs = [], prompts = [], panes = [] } = {}, keep = new Set()) {
  const byId = new Map(tasks.map(t => [t.id, t])), promptById = new Map(prompts.map(p => [p.id, p])), paneById = new Map(panes.map(p => [p.id, p]));
  const chain = id => { const out = [], seen = new Set(); for (let t = byId.get(id); t && !seen.has(t.id); t = byId.get(t.parent_id)) { seen.add(t.id); out.unshift(t); } return out; };
  const summary = text => String(text ?? '').split('\n').map(l => l.trim()).find(Boolean) || '';
  const owners = new Map(), owner = id => { if (!owners.has(id)) owners.set(id, { panes: new Map(), items: [] }); return owners.get(id); };
  const place = (taskId, id) => { const path = chain(taskId); return path.some(t => t.archived) && !keep.has(id) ? null : owner(path.length ? path.at(-1).id : 'none'); };
  const runItem = r => ({ id: `run:${r.id}`, kind: 'run', rec: r, at: ms(r.finished) || ms(r.started), unread: Boolean(r.unread) || r.state === 'needs_input', word: stateWord(r), summary: summary(r.prompt),
    pane_id: r.pane_id || '', pane_name: paneById.get(r.pane_id)?.name || r.pane_name || '', newer: [] });
  for (const r of runs) {
    const id = `run:${r.id}`, prompt = promptById.get(r.prompt_id);
    if (r.archived && !keep.has(id)) continue;
    const o = place(prompt ? prompt.task_id : r.task_id, id); if (!o) continue;
    const key = r.pane_id || id; if (!o.panes.has(key)) o.panes.set(key, []);
    o.panes.get(key).push(runItem(r));
  }
  for (const o of owners.values()) for (const [key, list] of o.panes) {
    const stack = list.filter(i => i.unread || keep.has(i.id)).sort(oldestFirst), pane = paneById.get(key);
    if (stack.length) o.items.push({ ...stack[0], newer: stack.slice(1) });
    else if (pane && pane.state !== 'closed') o.items.push(list.reduce((a, b) => String(b.rec.started) > String(a.rec.started) ? b : a));
  }
  for (const p of prompts) {
    const id = `prompt:${p.id}`, waiting = ['blocked', 'errored'].includes(p.state);
    if (!waiting && !keep.has(id)) continue;
    place(p.task_id, id)?.items.push({ id, kind: 'prompt', rec: p, at: ms(p.updated) || ms(p.created), unread: waiting, word: p.state, summary: summary(p.body), pane_id: p.target || p.pane_id || '', pane_name: paneById.get(p.target || p.pane_id)?.name || '', newer: [] });
  }
  // Waiting entries first, oldest first; then what has been read, newest first.
  const waits = i => i.unread || i.newer.some(n => n.unread);
  const order = (a, b) => waits(b) - waits(a) || (waits(a) ? oldestFirst(a, b) : b.at - a.at || (a.id < b.id ? -1 : 1));
  const node = (id, title) => {
    const items = (owners.get(id)?.items || []).sort(order), waiting = items.flatMap(i => [i, ...i.newer]).filter(i => i.unread);
    return { id, title, unread: waiting.length, oldest: waiting.length ? Math.min(...waiting.map(i => i.at)) : null, items };
  };
  const firstWaiting = (a, b) => (a.oldest == null) - (b.oldest == null) || (a.oldest ?? 0) - (b.oldest ?? 0);
  const out = [], created = (a, b) => String(a.created) < String(b.created) ? -1 : String(a.created) > String(b.created) ? 1 : 0;
  for (const root of tasks.filter(t => !byId.has(t.parent_id) && !t.archived).sort(created)) {
    const top = { ...node(root.id, root.title), groups: [] };
    for (const t of [...tasks].sort(created)) {
      const path = chain(t.id); if (path.length < 2 || path[0].id !== root.id || !owners.get(t.id)?.items.length) continue;
      top.groups.push(node(t.id, path.slice(1).map(x => x.title).join(' / ')));
    }
    top.groups.sort(firstWaiting);
    const all = [top, ...top.groups].filter(g => g.oldest != null);
    top.unread += top.groups.reduce((n, g) => n + g.unread, 0); top.oldest = all.length ? Math.min(...all.map(g => g.oldest)) : null;
    if (root.status !== 'done' || top.items.length || top.groups.length) out.push(top);
  }
  out.sort(firstWaiting);
  const none = { ...node('none', 'No task'), groups: [] };
  if (none.items.length) out.push(none);
  return out;
}
