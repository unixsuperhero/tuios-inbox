// Pure outline model: inheritance by lookup, run preflight, queue order. No DOM, no fetch, so server and browser share it.
export const DEFAULTS = { harness: 'omp', queue_mode: 'manual', launch_mode: 'new' };
export const FIELDS = ['repo', 'branch', 'harness', 'model', 'queue_mode', 'session', 'workspace', 'launch_mode', 'host'];
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
    if (field === 'repo') continue;
    out[field] = field in DEFAULTS ? { value: DEFAULTS[field], from: 'default' } : { value: null, from: 'none' };
    const seen = new Set();
    for (let cur = record, first = true; cur && !seen.has(cur); first = false) {
      seen.add(cur);
      const value = own(cur, field);
      if (set(value)) { out[field] = { value, from: first ? 'self' : cur.id }; break; }
      cur = get(tasksById, first && isPrompt(cur) ? cur.task_id : cur.parent_id);
    }
  }
  out.paths_host = { value: null, from: 'none' };
  const host = out.host.value;
  for (const field of ['repo', 'cwd']) {
    const seen = new Set();
    out[field] = { value: null, from: 'none' };
    for (let cur = isPrompt(record) ? get(tasksById, record.task_id) : record; cur && !seen.has(cur); cur = get(tasksById, cur.parent_id)) {
      seen.add(cur);
      const value = field === 'cwd' && set(own(cur, 'worktree')) ? own(cur, 'worktree') : own(cur, 'repo');
      if (!set(value)) continue;
      const from = cur === record ? 'self' : cur.id, bound = own(cur, 'paths_host');
      if (set(host) && bound === host) {
        out[field] = { value, from };
        out.paths_host = { value: bound, from };
      } else if (field === 'cwd') out.paths_mismatch = { value: true, from, host: bound || null, path: value };
      break;
    }
  }
  return out;
}

/** The profile that launches a harness: matched by id or executable; Claude Code reports itself as claude-code. */
export function profileFor(harness, profiles = []) {
  const name = harness === 'claude-code' ? 'claude' : harness;
  return profiles.find(p => p.id === name) || profiles.find(p => p.executable === name) || null;
}

/** Explicit continuations keep their target; reuse only selects a known compatible app-launched agent. */
export function pickPane(prompt, panes = [], resolved = {}, profiles = []) {
  if (prompt.target) return panes.find(p => p.id === prompt.target) || null;
  if ((resolved.launch_mode?.value ?? prompt.launch_mode ?? DEFAULTS.launch_mode) !== 'reuse') return null;
  const cwd = resolved.cwd?.value, harness = resolved.harness?.value ?? DEFAULTS.harness;
  const host = resolved.host?.value, session = resolved.session?.value || (prompt.task_id || prompt.id ? `inbox-${(prompt.task_id || prompt.id).slice(0, 8)}` : null);
  if (!set(host)) return null;
  const profile = profileFor(harness, profiles)?.id ?? harness, model = resolved.model?.value ?? '';
  return panes.find(p => (p.task_id ?? null) === (prompt.task_id ?? null) && p.kind === 'agent' && p.ready && ['idle', 'done'].includes(p.state)
    && set(p.launch_cwd) && set(p.launch_profile) && p.launch_model != null
    && set(session) && p.host === host && p.session === session
    && p.launch_cwd === cwd && p.launch_profile === profile && p.launch_model === model) || null;
}

/**
 * @param {{prompt: object, resolved: object, panes?: object[], git?: object, profiles?: object[]}} input
 * @returns {{blocks: {code: string, message: string, fix: string}[], warns: {code: string, message: string, fix?: string}[]}}
 */
// Sent prompts keep their recorded execution context. Strict preflight rechecks advisories before dispatch.
export function preflight({ prompt, resolved, panes = [], git = null, profiles = [], strict = false }) {
  const blocks = [], warns = [], sent = !strict && ['running', 'done'].includes(prompt.state);
  if (!String(prompt.body || '').trim()) blocks.push({ code: 'no_text', message: 'No text to send', fix: 'body' });
  if (sent) ;
  else if (prompt.target) {
    const pane = panes.find(p => p.id === prompt.target);
    if (pane?.live === false) blocks.push({ code: 'session_unavailable', message: 'Target pane is not in an available native session', fix: 'target' });
    if (!pane || pane.state === 'closed') warns.push({ code: 'pane_gone', message: 'Target pane is gone; attempting it may fail, or choose another target', fix: 'target' });
    else {
      if (pane.state === 'needs_input') warns.push({ code: 'pane_blocked', message: 'Target pane is waiting on its own question; Queue anyway waits without answering it', fix: 'target' });
      else if (!pane.ready) warns.push({ code: 'pane_blocked', message: 'Target pane is busy; Queue anyway waits for it to come to rest', fix: 'target' });
      if (pane.kind !== 'agent' || !set(pane.launch_profile) || !set(pane.launch_cwd) || pane.launch_model == null) warns.push({ code: 'pane_unknown', message: 'Target pane launch context is unknown; verify its agent and project before proceeding', fix: 'target' });
      const harness = resolved.harness?.value, profile = profileFor(harness, profiles)?.id ?? harness;
      if (set(pane.launch_profile) && profile && pane.launch_profile !== profile) warns.push({ code: 'harness_mismatch', message: `Target pane uses ${pane.launch_profile}, prompt expects ${profile}`, fix: 'harness' });
      if (pane.launch_model != null && pane.launch_model !== (resolved.model?.value ?? '')) warns.push({ code: 'model_mismatch', message: 'Target pane model differs from the prompt model', fix: 'model' });
      if (set(pane.launch_cwd) && resolved.cwd?.value && pane.launch_cwd !== resolved.cwd.value) warns.push({ code: 'cwd_mismatch', message: `Target pane runs in ${pane.launch_cwd}, prompt expects ${resolved.cwd.value}`, fix: 'target' });
    }
  } else if (!pickPane(prompt, panes, resolved, profiles)) {
    if (!set(resolved.host?.value)) blocks.push({ code: 'no_host', message: 'Choose an execution machine before creating a pane', fix: 'host' });
    if (resolved.paths_mismatch?.value) blocks.push({ code: 'paths_host_mismatch', message: `Choose the project directory again for ${resolved.host?.value || 'the execution machine'}; saved paths belong to ${resolved.paths_mismatch.host || 'an unknown machine'}`, fix: 'repo' });
    if (!resolved.cwd?.value && !resolved.paths_mismatch?.value) warns.push({ code: 'nowhere', message: 'No directory is set; proceeding launches in your home directory', fix: 'repo' });
    const profile = profileFor(resolved.harness?.value, profiles);
    if (profile?.executable?.includes('/') && (!set(profile.executable_host) || profile.executable_host !== resolved.host?.value)) blocks.push({ code: 'executable_host_mismatch', message: `Profile executable belongs to ${profile.executable_host || 'an unknown machine'}; choose a profile for ${resolved.host?.value || 'the execution machine'}`, fix: 'harness' });
    if (!profileFor(resolved.harness?.value, profiles)) warns.push({ code: 'no_harness', message: `No saved agent profile for ${resolved.harness?.value || DEFAULTS.harness}; proceeding launches that executable without extra profile arguments`, fix: 'harness' });
  }
  if (new TextEncoder().encode(String(prompt.body || '')).length > 16 * 1024) warns.push({ code: 'native_message_limit', message: 'Prompt exceeds the native 16 KiB queue-message limit; attempting it may be refused, and the full text will be preserved', fix: 'body' });
  if (!sent && git?.state === 'unknown') warns.push({ code: 'remote_git_unknown', message: git.reason, fix: 'repo' });
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
 * Why an automatic queue that has queued prompts is not moving, as one line. Null for a manual queue, the No task queue, or nothing queued.
 * held: an earlier blocked or errored prompt (`by`) holds it until that prompt is fixed, requeued or deleted.
 * waiting: it goes on by itself, once the earlier running prompt (`by`) ends or the busy pane (`pane`) comes to rest.
 * start: no pane is busy, and a queue only advances when a pane comes to rest, so it needs Run next.
 * @param {object[]} prompts every prompt  @param {object[]} panes the outline's panes: {id, name, kind, task_id, state, ready}
 * @returns {{state: 'held'|'waiting'|'start', next: string, by: string|null, pane: string|null, text: string}|null}
 */
export function queueStatus(prompts, taskId, mode, panes = []) {
  const next = taskId && mode === 'auto' ? nextInQueue(prompts, taskId) : null;
  if (!next) return null;
  const by = prompts.filter(p => p.id !== next.id && inQueue(p, taskId) && ['blocked', 'errored', 'running'].includes(p.state) && p.position < next.position).sort(byPosition)[0];
  if (by?.state === 'running') return { state: 'waiting', next: next.id, by: by.id, pane: by.pane_id || null, text: 'Waiting for the running prompt to end' };
  if (by) return { state: 'held', next: next.id, by: by.id, pane: null, text: `Held by ${by.state === 'errored' ? 'an errored' : 'a blocked'} prompt` };
  const live = panes.filter(p => p.kind === 'agent' && p.state !== 'closed'), named = next.target ? live.find(p => p.id === next.target) : null;
  const busy = named ? (named.ready ? null : named) : live.find(p => p.task_id === taskId && !p.ready);
  if (busy) return { state: 'waiting', next: next.id, by: null, pane: busy.id, text: `Waiting for ${busy.name || 'the pane'} to come to rest` };
  return { state: 'start', next: next.id, by: null, pane: null, text: 'Not started: press Run next' };
}
/**
 * The task a run is filed under, everywhere it is shown: its prompt's task when it ran from a prompt, else its own;
 * with neither, the task it inherits (`inherits`: its pane's task, else the task whose session the pane lives in).
 */
export function runTask(run, promptsById) {
  const prompt = get(promptsById, run?.prompt_id);
  return prompt ? prompt.task_id ?? null : run?.task_id ?? run?.inherits ?? null;
}
/** The task a pane is filed under: its own, else the one it inherits from its session. */
export const paneTask = pane => pane?.task_id ?? pane?.inherits ?? null;

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
  const { items, paneById } = waitingItems({ tasks, runs, prompts, panes }, keep);
  const tops = new Map();
  const group = (map, id, title, extra) => { if (!map.has(id)) map.set(id, { id, title, count: 0, oldest: null, items: [], ...extra }); return map.get(id); };
  for (const item of items) {
    const path = item.path;
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

const MDOC = 'http://127.0.0.1:4387/items/';
/**
 * The documents an agent reported in a response: mdoc item URLs (the local document viewer), bare or as a Markdown link,
 * and Markdown links to a .md file path (absolute, relative or file://; a #fragment is dropped). Nothing else counts.
 * In order of appearance, one per target, at most `cap`.
 * @returns {{kind: 'mdoc'|'file', href: string, title: string}[]}
 */
export function docsIn(text, cap = 5) {
  const out = [], seen = new Set(), clean = s => String(s || '').replace(/[`*_]/g, '').trim();
  const add = (kind, href, title) => { if (seen.has(href)) return; seen.add(href); out.push({ kind, href, title }); };
  for (const m of String(text ?? '').matchAll(/\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?[^)\n]*\)|http:\/\/127\.0\.0\.1:4387\/items\/(\d+)/g)) {
    if (m[3]) { add('mdoc', MDOC + m[3], `mdoc item ${m[3]}`); continue; }
    const target = m[2].replace(/#.*$/, ''), item = target.startsWith(MDOC) && /^\d+$/.test(target.slice(MDOC.length)) ? target.slice(MDOC.length) : '';
    if (item) add('mdoc', target, clean(m[1]) && !clean(m[1]).startsWith('http') ? clean(m[1]) : `mdoc item ${item}`);
    else if (/\.md$/i.test(target) && (!/^[a-z][a-z0-9+.-]*:/i.test(target) || /^file:\/\//i.test(target))) add('file', target, clean(m[1]) || target.split('/').pop());
  }
  return out.slice(0, cap);
}

const stateWord = r => r.state === 'needs_input' ? 'needs input' : !r.state || r.state === 'none' || r.state === 'unknown' ? 'ended' : r.state;
const firstLine = text => String(text ?? '').split('\n').map(l => l.trim()).find(Boolean) || '';
const chainOf = byId => id => { const out = [], seen = new Set(); for (let t = byId.get(id); t && !seen.has(t.id); t = byId.get(t.parent_id)) { seen.add(t.id); out.unshift(t); } return out; };

/** Every indicator kind, in the order a strip shows them. */
export const INDICATORS = ['working', 'needs_input', 'errored', 'prompt_error', 'blocked', 'done', 'idle', 'ended', 'queued', 'doc'];
/** The indicator of one item: a run by its state, a prompt by its state. `item` is {kind: 'run'|'prompt', rec}. */
export function itemKind(item) {
  const s = item.rec?.state;
  if (item.kind === 'prompt') return s === 'blocked' ? 'blocked' : s === 'errored' ? 'prompt_error' : s === 'queued' ? 'queued' : s === 'running' ? 'working' : 'ended';
  return s === 'working' ? 'working' : s === 'needs_input' ? 'needs_input' : ['errored', 'error', 'failed'].includes(s) ? 'errored' : s === 'done' ? 'done' : s === 'idle' ? 'idle' : 'ended';
}
/**
 * The indicators of a set of items, in INDICATORS order, each kind once with its count.
 * A run counts under its kind while it waits (unread, or on a question) and brings its documents along as `doc`; a run that
 * is working counts as `working` whether read or not; a read run counts for nothing. A prompt counts while blocked, errored or queued.
 * @param {{kind: 'run'|'prompt', rec: object, unread?: boolean, docs?: object[]}[]} items
 * @param {number|null} working how many agents are working, when the caller knows better than the items do (a pane row is one agent)
 * @returns {{kind: string, count: number}[]}
 */
export function indicators(items = [], working = null) {
  const n = {}, add = (k, by = 1) => { n[k] = (n[k] || 0) + by; };
  for (const item of items) {
    const kind = itemKind(item), waits = item.unread ?? (item.kind === 'run' ? Boolean(item.rec.unread) || item.rec.state === 'needs_input' : ['blocked', 'errored'].includes(item.rec.state));
    if (kind === 'working') add('working');
    else if (item.kind === 'prompt') { if (kind !== 'ended') add(kind); }
    else if (waits) add(kind);
    if (item.kind === 'run' && waits && (item.docs || item.rec.docs)?.length) add('doc', (item.docs || item.rec.docs).length);
  }
  if (working != null) n.working = working;
  return INDICATORS.filter(k => n[k]).map(kind => ({ kind, count: n[kind] }));
}
/** The union of several indicator lists: counts of the same kind are summed. */
export function sumIndicators(lists) {
  const n = {}; for (const list of lists) for (const { kind, count } of list) n[kind] = (n[kind] || 0) + count;
  return INDICATORS.filter(k => n[k]).map(kind => ({ kind, count: n[kind] }));
}

// What waits for the owner: unarchived runs that are unread or on a question, and prompts that are blocked or errored. Oldest first.
function waitingItems({ tasks = [], runs = [], prompts = [], panes = [] } = {}, keep = new Set()) {
  const byId = new Map(tasks.map(t => [t.id, t])), promptById = new Map(prompts.map(p => [p.id, p])), paneById = new Map(panes.map(p => [p.id, p])), chain = chainOf(byId), items = [];
  const put = item => { item.path = chain(item.task_id); if (!item.path.some(t => t.archived) || keep.has(item.id)) items.push(item); };
  for (const r of runs) {
    const id = `run:${r.id}`;
    if (keep.has(id) || !r.archived && (r.unread || r.state === 'needs_input')) put({ id, kind: 'run', rec: r, at: ms(r.finished) || ms(r.started), task_id: runTask(r, promptById), pane_id: r.pane_id || '', pane_name: r.pane_name || '', session: r.session || paneById.get(r.pane_id)?.session || '' });
  }
  for (const p of prompts) {
    const id = `prompt:${p.id}`, pane = p.target || p.pane_id || '';
    if (keep.has(id) || ['blocked', 'errored'].includes(p.state)) put({ id, kind: 'prompt', rec: p, at: ms(p.updated) || ms(p.created), task_id: p.task_id, pane_id: pane, pane_name: '', session: paneById.get(pane)?.session || '' });
  }
  return { items: items.sort(oldestFirst), paneById };
}
/**
 * The Queue page: everything that waits, as one flat list, oldest first. Same item rule as reviewQueue.
 * @param {object} data the GET /api/outline payload
 * @param {{type: 'all'|'task'|'session'|'pane', id?: string}} scope task: that task and its descendants ('none' = No task);
 *   session: the TUIOS session the item's pane runs in; pane: one pane
 * @param {Set<string>} keep item ids that stay listed even once read (the open item), as long as they are in scope
 * @returns {{id: string, kind: 'run'|'prompt', rec: object, at: number, ind: string, summary: string, task_id: string|null, task: string, pane_id: string, pane: string, session: string, docs: number}[]}
 */
export function queueItems(data = {}, scope = { type: 'all' }, keep = new Set()) {
  const { items, paneById } = waitingItems(data, keep), type = scope?.type || 'all', id = scope?.id;
  return items.filter(i => scopesOf(i).includes(scopeKey({ type, id }))).map(({ path, ...i }) => ({ ...i, ind: itemKind(i), summary: firstLine(i.kind === 'run' ? i.rec.prompt : i.rec.body), task_id: path.at(-1)?.id ?? null, task: path.map(t => t.title).join(' / '),
    pane: paneById.get(i.pane_id)?.name || i.pane_name || '', docs: i.kind === 'run' ? i.rec.docs?.length || 0 : 0 }));
}

/** A task owns its exact turns, including read history, and prompts still waiting to run. */
export function taskItems(data = {}, taskId) {
  const prompts = new Map((data.prompts || []).map(p => [p.id, p]));
  const runs = (data.runs || []).filter(r => !r.archived && runTask(r, prompts) === taskId);
  const running = new Set(runs.filter(r => ['working', 'needs_input'].includes(r.state)).map(r => r.prompt_id));
  const keep = new Set(runs.map(r => 'run:' + r.id));
  for (const p of prompts.values()) {
    if (p.task_id === taskId && ['queued', 'blocked', 'errored', 'running'].includes(p.state) && !(p.state === 'running' && running.has(p.id))) keep.add('prompt:' + p.id);
  }
  const rank = i => ['working', 'needs_input', 'running'].includes(i.rec.state) ? 0 : i.kind === 'prompt' ? 1 : 2;
  return queueItems(data, { type: 'task', id: taskId }, keep).filter(i => i.task_id === taskId && keep.has(i.id))
    .sort((a, b) => rank(a) - rank(b) || (rank(a) === 1 ? (a.rec.position ?? 0) - (b.rec.position ?? 0) || a.at - b.at : b.at - a.at) || a.id.localeCompare(b.id));
}

// Every scope an item is listed in, as keys; the Queue page and every count beside a queue link read the same ones.
const scopeKey = scope => !scope?.type || scope.type === 'all' ? 'all' : `${scope.type}:${scope.id ?? ''}`;
const scopesOf = i => ['all', `pane:${i.pane_id}`, `session:${i.session}`, ...(i.path.length ? i.path.map(t => `task:${t.id}`) : ['task:none'])];
/**
 * How many items each queue scope lists, worked out in one pass: count(scope) === queueItems(data, scope).length.
 * @returns {(scope: {type: string, id?: string}) => number}
 */
export function queueCounts(data = {}) {
  const n = new Map();
  for (const i of waitingItems(data).items) for (const k of scopesOf(i)) n.set(k, (n.get(k) || 0) + 1);
  return scope => n.get(scopeKey(scope)) || 0;
}
/**
 * What Mark all read clears in a list of queue items: the unread turns. A turn on a question stays, and so do blocked and errored prompts.
 * @returns {string[]} run ids ('turn:<id>'), as POST /api/items/update takes them
 */
export const markable = items => items.filter(i => i.kind === 'run' && i.rec.unread && !i.rec.archived && i.rec.state !== 'needs_input').map(i => i.rec.id);

// One row per pane under each task that owns something of it; prompts that name no pane share one 'prompts' row.
function rollup({ tasks = [], runs = [], prompts = [], panes = [] } = {}, keep = new Set()) {
  const byId = new Map(tasks.map(t => [t.id, t])), promptById = new Map(prompts.map(p => [p.id, p])), paneById = new Map(panes.map(p => [p.id, p])), chain = chainOf(byId);
  const owners = new Map(), newest = new Map(), shown = new Set();
  const place = (taskId, id) => { const path = chain(taskId); return path.some(t => t.archived) && !keep.has(id) ? null : path.length ? path.at(-1).id : 'none'; };
  const rowOf = (owner, pane) => { const o = owners.get(owner) || owners.set(owner, new Map()).get(owner), key = pane ? `pane:${pane}` : 'prompts'; shown.add(pane); return o.get(key) || o.set(key, { id: key, pane_id: pane, runs: [], prompts: [] }).get(key); };
  for (const r of runs) {
    const id = `run:${r.id}`, waits = Boolean(r.unread) || r.state === 'needs_input';
    if (r.pane_id && !(String(newest.get(r.pane_id)?.started) >= String(r.started))) newest.set(r.pane_id, r);
    if (r.archived && !keep.has(id)) continue;
    const owner = place(runTask(r, promptById), id); if (!owner) continue;
    rowOf(owner, r.pane_id || '').runs.push({ id, kind: 'run', rec: r, at: ms(r.finished) || ms(r.started), unread: waits, word: stateWord(r), summary: firstLine(r.prompt),
      docs: (r.docs || []).map((d, n) => ({ id: `doc:${r.id}:${n}`, kind: d.kind, href: d.href, title: d.title, run: id, unread: waits })) });
  }
  for (const p of prompts) {
    const id = `prompt:${p.id}`;
    if (!['queued', 'blocked', 'errored'].includes(p.state) && !keep.has(id)) continue;
    const owner = place(p.task_id, id); if (!owner) continue;
    rowOf(owner, p.target || p.pane_id || '').prompts.push({ id, kind: 'prompt', rec: p, at: ms(p.updated) || ms(p.created), unread: ['blocked', 'errored'].includes(p.state), word: p.state, summary: firstLine(p.body), docs: [] });
  }
  // A live pane with nothing of its own still has a row, under its task (own or inherited), else under No task.
  for (const p of panes) if (p.state !== 'closed' && !shown.has(p.id)) { const path = chain(paneTask(p)); rowOf(path.length && !path.some(t => t.archived) ? path.at(-1).id : 'none', p.id); }
  const out = new Map();
  for (const [owner, rows] of owners) {
    const list = [];
    for (const row of rows.values()) {
      const pane = paneById.get(row.pane_id), open = Boolean(pane) && pane.state !== 'closed';
      const waiting = [...row.runs, ...row.prompts].filter(i => i.unread || keep.has(i.id)).sort(oldestFirst);
      const queued = row.prompts.filter(i => i.rec.state === 'queued' && !keep.has(i.id)).sort((a, b) => byPosition(a.rec, b.rec));
      if (!waiting.length && !queued.length && !open) continue;
      const latest = row.runs.reduce((a, b) => !a || String(b.rec.started) > String(a.rec.started) ? b : a, null);
      const working = latest?.rec.state === 'working' || pane?.state === 'working' && newest.get(row.pane_id) === latest?.rec;
      const items = [...waiting, ...queued, ...(latest && !waiting.includes(latest) ? [{ ...latest, last: true }] : [])];
      const really = waiting.filter(i => i.unread), lead = really[0] || waiting[0] || queued[0] || latest;
      list.push({ id: row.id, kind: row.pane_id ? 'pane' : row.runs.length ? 'nopane' : 'prompts', pane_id: row.pane_id, name: row.pane_id ? pane?.name || row.runs[0]?.rec.pane_name || '' : row.runs.length ? 'No pane' : 'Prompts',
        pane_kind: pane?.kind || '', via: Boolean(pane) && !pane.task_id && pane.inherits === owner, empty: !lead,
        working, unread: really.length, oldest: really.length ? really[0].at : null, at: lead?.at ?? 0, lead: lead?.id ?? null, lead_kind: lead?.kind ?? null, summary: lead?.summary ?? '', dim: !really.length && !working,
        indicators: indicators(items.filter(i => !i.last), +working), items });
    }
    // Waiting rows first, oldest first; then the rest, newest first.
    list.sort((a, b) => (b.unread > 0) - (a.unread > 0) || (a.unread ? a.oldest - b.oldest : b.at - a.at) || (a.id < b.id ? -1 : 1));
    out.set(owner, list);
  }
  return { rows: out, byId, chain };
}
/**
 * The left rail: open root tasks, their subtasks flattened to one level, and under each exactly ONE row per pane;
 * never deeper than three levels. Everything of a pane is rolled up in its row:
 *   items = its waiting turns (unread, or on a question) and its blocked or errored prompts, oldest first, each turn with its
 *   documents; then its queued prompts in queue order; then its latest turn when that one is not waiting (`last: true`).
 *   summary = first line of the OLDEST waiting item; with nothing waiting, of the next queued prompt, else of the latest turn (`dim`).
 * Prompts that name no pane share one 'prompts' row per task. A pane with nothing waiting or queued has a row only while it is open.
 * Every pane that is not closed has a row, even with no turn at all (`empty`, no lead): under its own task, else the one it inherits
 * from its session (`via`), else No task. A run with no task of its own is filed with its pane the same way (runTask).
 * Every row, subtask group and root carries `indicators`; a group's and a root's are the union of everything beneath.
 * Archived runs and runs under an archived task are left out. Roots with something waiting come first, oldest first, then the
 * rest by creation; No task comes last, only when it has rows.
 * @param {{tasks?: object[], runs?: object[], prompts?: object[], panes?: object[]}} data the GET /api/outline payload
 * @param {Set<string>} keep item ids ('run:<id>', 'prompt:<id>') that stay listed even once read: the item that is open
 * @returns {{id: string, title: string, unread: number, oldest: number|null, indicators: object[], rows: object[], groups: {id: string, title: string, unread: number, oldest: number|null, indicators: object[], rows: object[]}[]}[]}
 *   a row is {id: 'pane:<pane id>'|'prompts', kind: 'pane'|'prompts'|'nopane', pane_id, pane_kind, name, via, empty, working, unread, oldest, lead, summary, dim, indicators, items}
 *   an item is {id, kind: 'run'|'prompt', rec, at, unread, word, summary, docs, last?}; a doc is {id: 'doc:<run id>:<n>', kind: 'mdoc'|'file', href, title, run, unread}
 */
export function railTree(data = {}, keep = new Set()) {
  const { rows: owned, byId, chain } = rollup(data, keep), tasks = data.tasks || [];
  const node = (id, title) => {
    const rows = owned.get(id) || [], waiting = rows.filter(r => r.unread);
    return { id, title, unread: rows.reduce((n, r) => n + r.unread, 0), oldest: waiting.length ? Math.min(...waiting.map(r => r.oldest)) : null, indicators: sumIndicators(rows.map(r => r.indicators)), rows };
  };
  const firstWaiting = (a, b) => (a.oldest == null) - (b.oldest == null) || (a.oldest ?? 0) - (b.oldest ?? 0);
  const out = [], created = (a, b) => String(a.created) < String(b.created) ? -1 : String(a.created) > String(b.created) ? 1 : 0;
  for (const root of tasks.filter(t => !byId.has(t.parent_id) && !t.archived).sort(created)) {
    const top = { ...node(root.id, root.title), groups: [] };
    for (const t of [...tasks].sort(created)) {
      const path = chain(t.id); if (path.length < 2 || path[0].id !== root.id || !owned.get(t.id)?.length) continue;
      top.groups.push(node(t.id, path.slice(1).map(x => x.title).join(' / ')));
    }
    top.groups.sort(firstWaiting);
    const all = [top, ...top.groups].filter(g => g.oldest != null);
    top.indicators = sumIndicators([top.indicators, ...top.groups.map(g => g.indicators)]);
    top.unread += top.groups.reduce((n, g) => n + g.unread, 0); top.oldest = all.length ? Math.min(...all.map(g => g.oldest)) : null;
    if (root.status !== 'done' || top.rows.length || top.groups.length) out.push(top);
  }
  out.sort(firstWaiting);
  const none = { ...node('none', 'No task'), groups: [] };
  if (none.rows.length) out.push(none);
  return out;
}
/**
 * Per task, the union of the indicators of everything in it and in its descendants, and how many items wait there.
 * @returns {Map<string, {indicators: {kind: string, count: number}[], waiting: number}>} keyed by task id; 'none' is No task
 */
export function taskIndicators(data = {}) {
  const { rows, chain } = rollup(data), lists = new Map(), out = new Map();
  for (const [owner, list] of rows) for (const id of owner === 'none' ? ['none'] : chain(owner).map(t => t.id)) { if (!lists.has(id)) lists.set(id, []); lists.get(id).push(...list); }
  for (const [id, list] of lists) out.set(id, { indicators: sumIndicators(list.map(r => r.indicators)), waiting: list.reduce((n, r) => n + r.unread, 0) });
  return out;
}
