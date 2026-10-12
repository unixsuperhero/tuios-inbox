// The task-first outline: one tree of tasks, prompts and runs, a capture line, and the selected line's detail.
// Reads GET /api/outline; every write refetches it. A refresh only ever morphs the DOM (patchHTML), and only the parts whose
// markup changed, so focus, drafts, selection, scroll and collapsed state survive live updates.
import { api, apiCached, NOT_MODIFIED, esc, agentName } from '/pages.js';
import { patchHTML } from '/workbench.js';
import { markdown } from '/markdown.js';
import { reviewQueue, reviewItems, railTree, queueStatus, runTask, paneTask, queueItems, queueCounts, markable, taskIndicators, itemKind } from '/outline-model.js';
import { nextAfter, waitingFor } from '/queue-model.js';

const VIEWS = { queue: 'Queue', tasks: 'Tasks', open: 'Tasks', everything: 'Everything', 'needs-me': 'Needs me', running: 'Running', queued: 'Queued', 'no-task': 'No task', archive: 'Archive' };
const TASK_FIELDS = [['repo', 'Repo', 'dir'], ['branch', 'Branch', 'text'], ['session', 'Home session', 'text'], ['workspace', 'Home workspace', 'text'], ['harness', 'Harness', 'harness'], ['model', 'Model', 'text'], ['queue_mode', 'Queue mode', 'mode']];
const RUN_CAP = 3, DONE_CAP = 3, CHUNK = 50, SHUT_KEY = 'tuios-inbox.rail.collapsed';
const COLS = '<span></span><span>Queue</span><span>State</span><span>Unread</span><span>Branch</span><span>Pull request</span>', REVIEW_COLS = '<span></span><span>Pane</span><span>State</span><span>Unread</span><span>Waiting</span>';
const when = value => value ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const oneLine = text => String(text ?? '').trim().split('\n')[0];
const turnId = key => encodeURIComponent(String(key).replace(/^turn:/, ''));
/** The deep link of one line: a task ('task:<id>' or 'none'), a run ('run:turn:<id>') or a prompt ('prompt:<id>'). */
export const outlineHash = key => key === 'none' ? '#outline/task/none' : key.startsWith('task:') ? `#outline/task/${encodeURIComponent(key.slice(5))}` : key.startsWith('run:') ? `#outline/run/${turnId(key.slice(4))}` : `#outline/prompt/${encodeURIComponent(key.slice(7))}`;
/** The link of a queue scope: {type: 'all'} or {type: 'task'|'session'|'pane', id}. */
export const queueHash = scope => !scope || scope.type === 'all' || !scope.type ? '#queue' : `#queue/${scope.type}/${encodeURIComponent(scope.id)}`;
// One icon set: 14px, drawn with the text colour, coloured by class. Each kind differs in shape, not only in colour.
const ICONS = {
  working: ['Agent working', '<circle cx="7" cy="7" r="5" class="ic-track"/><path d="M7 2a5 5 0 0 1 5 5"/>'],
  needs_input: ['Waiting on your answer', '<path d="M4.4 4.9a2.6 2.6 0 1 1 4 2.2c-.9.6-1.4 1-1.4 2M7 11.6v.3"/>'],
  done: ['Finished, unread', '<path d="M2.2 7.6l3.1 3.1L11.8 3.6"/>'],
  errored: ['Failed, unread', '<path d="M3 3l8 8M11 3l-8 8"/>'],
  idle: ['Ended idle, unread', '<path d="M5 3v8M9 3v8"/>'],
  ended: ['Ended or pane closed, unread', '<path d="M2 7h6.5M6 4.4L8.6 7 6 9.6M11.6 3v8"/>'],
  blocked: ['Blocked prompt', '<circle cx="7" cy="7" r="5"/><path d="M3.5 10.5l7-7"/>'],
  prompt_error: ['Errored prompt', '<path d="M7 1.8l5.4 10H1.6zM7 5.8v3M7 10.4v.2"/>'],
  queued: ['Queued prompt', '<path d="M2.5 3.5h9M2.5 7h9M2.5 10.5h5.5"/>'],
  doc: ['Document', '<path d="M3.5 1.5H8l2.5 2.5v8.5h-7zM8 1.5V4h2.5"/>'],
  queue: ['Queue', '<path d="M1.6 8l1.8-5.2h7.2L12.4 8v4.2H1.6zM1.6 8h3.2l.8 1.7h2.8L9.2 8h3.2"/>'],
  shell: ['Shell pane', '<path d="M2.2 4l3 3-3 3M7.4 10.4h4.4"/>'],
  chev: ['', '<path d="M5 3l4 4-4 4"/>'],
};
const IND_WORDS = { working: ['agent working', 'agents working'], needs_input: ['turn waiting on your answer', 'turns waiting on your answer'], done: ['unread finished turn', 'unread finished turns'], errored: ['unread failed turn', 'unread failed turns'],
  idle: ['unread turn that ended idle', 'unread turns that ended idle'], ended: ['unread turn whose pane ended', 'unread turns whose pane ended'], blocked: ['blocked prompt', 'blocked prompts'], prompt_error: ['errored prompt', 'errored prompts'], queued: ['queued prompt', 'queued prompts'], doc: ['document from unread turns', 'documents from unread turns'] };
/** One icon as inline SVG. `label` is its accessible name and tooltip; an empty label makes it decoration. */
export const icon = (name, label = ICONS[name]?.[0] || '', cls = '') => `<svg class="ic ic-${name}${cls}" width="14" height="14" viewBox="0 0 14 14" ${label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"'}>${label ? `<title>${esc(label)}</title>` : ''}${ICONS[name]?.[1] || ''}</svg>`;
/** An indicator strip: one icon per kind of an indicators() list, with its count beside it when above one. */
export const strip = (list, cls = '') => list?.length ? `<span class="inds${cls}">${list.map(({ kind, count }) => `<span class="ind ind-${kind}">${icon(kind, `${count} ${IND_WORDS[kind]?.[count === 1 ? 0 : 1] || kind}`)}${count > 1 ? `<span class="ind-n" aria-hidden="true">${count}</span>` : ''}</span>`).join('')}</span>` : '';
const state = (word, cls = word) => word ? `<span class="ol-state s-${esc(cls)}">${esc(String(word).replace(/_/g, ' '))}</span>` : '';

export function createOutline({ report }) {
  const shell = document.querySelector('.workbench-shell');
  const root = document.createElement('section');
  root.id = 'outline-root'; root.setAttribute('aria-label', 'Outline');
  root.innerHTML = `<div class="ol-center">
<header class="ol-head"><h1 id="ol-title">Tasks</h1><p class="ol-keys" id="ol-keys"></p></header>
<form class="ol-capture" id="ol-capture" autocomplete="off"><span class="ol-chip" id="ol-chip"></span><input id="ol-capture-input" aria-label="New task, or a prompt when it starts with &gt;" aria-describedby="ol-capture-hint" placeholder="A task, or > a prompt" maxlength="16000" enterkeyhint="done"><span class="ol-capture-hint" id="ol-capture-hint">Enter saves · Cmd+Enter runs a prompt</span></form>
<div id="ol-notice" class="ol-notice" hidden></div>
<p id="ol-filter" class="ol-filter" hidden></p>
<div class="ol-cols" id="ol-cols" aria-hidden="true">${COLS}</div>
<div id="ol-tree" class="ol-tree" role="tree" tabindex="0" aria-label="Tasks, prompts and runs"></div>
</div>
<aside id="ol-detail" class="ol-detail" aria-label="Selected line"></aside>`;
  shell.append(root);
  const $ = s => root.querySelector(s);
  const tree = $('#ol-tree'), detail = $('#ol-detail'), capture = $('#ol-capture-input'), noticeEl = $('#ol-notice'), chip = $('#ol-chip'), filterEl = $('#ol-filter'), colsEl = $('#ol-cols'), keysEl = $('#ol-keys');

  let active = false, view = 'tasks', data = null, loadError = '', stale = true, inflight = null, again = null;
  // The Queue page: its scope, the open item (which stays listed once read, until the selection moves on), and the item whose opening has been acted on.
  let qScope = { type: 'all' }, qSel = null, qRead = null, qItems = [], qShown = CHUNK, treeShown = CHUNK;
  // Rail state lives here, not in the DOM, so a redraw never loses it: pane rows that are expanded, and tasks that are collapsed (remembered).
  const railOpen = new Set(), railShut = new Set(), histShown = new Map(), memo = new Map();
  try { for (const id of JSON.parse(localStorage.getItem(SHUT_KEY) || '[]')) railShut.add(String(id)); } catch {}
  // A part of the page is only touched when its markup changed since it was last drawn.
  let painted = new WeakMap();
  const paint = (el, html) => { if (painted.get(el) === html) return; painted.set(el, html); patchHTML(el, html); };
  // Derived from `data` alone, so worked out once per payload.
  const once = (key, make) => { if (!memo.has(key)) memo.set(key, make()); return memo.get(key); };
  // Every count beside a queue link, and the Queue page's own, come from the one pass that lists the page.
  const qCount = scope => once('qcounts', () => queueCounts(data || {}))(scope);
  const taskInd = () => once('tasks', () => taskIndicators(data || {}));
  let selected = null, destCleared = false, detailOpen = false, confirming = null, notice = null, noticeTimer;
  const collapsed = new Set(), expanded = new Set(), showAll = new Set(), drafts = new Map(), busy = new Set(), bodies = new Map(), fieldErrors = new Map(), docNotes = new Map();
  let model = { roots: [], index: new Map(), lines: [], tasks: new Map(), order: [] };
  let writes = Promise.resolve();
  // Needs me is a review queue, not the tree: at most three levels, oldest first. `held` is the item being read, which
  // stays listed after it is marked read until the selection moves on.
  let filterTask = null, held = null, review = { lines: [], index: new Map(), items: [], total: 0 };

  // The rail's tree lives outside this page's root and is drawn on every page. `opened` is the line whose opening has been
  // acted on (read, scrolled to), so a live refresh never repeats it.
  const railEl = document.getElementById('rail-tree'), railHeading = document.getElementById('rail-heading'), railUnread = document.getElementById('rail-unread'), railQueue = document.getElementById('rail-queue'), railQueueCount = document.getElementById('rail-queue-count');
  let opened = null, railShown = null, railMemo = null, rowFocus = null; // rowFocus: the task row j/k stand on in the tasks list
  const focus = () => view === 'tasks' || view === 'open';
  const supports = r => r?.kind === 'outline';

  // ---- model -------------------------------------------------------------------------------------------------
  function build() {
    const tasks = new Map((data?.tasks || []).map(t => [t.id, t])), index = new Map(), order = [];
    const by = (rows, key) => { const m = new Map(); for (const r of rows) { const k = key(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };
    const prompts = new Map((data?.prompts || []).map(p => [p.id, p]));
    const promptsBy = by([...(data?.prompts || [])].sort((a, b) => a.position - b.position), p => tasks.has(p.task_id) ? p.task_id : '');
    const runs = [...(data?.runs || [])].sort((a, b) => String(b.started).localeCompare(String(a.started)));
    const runsByPrompt = by(runs.filter(r => prompts.has(r.prompt_id)), r => r.prompt_id);
    const runsByTask = by(runs.filter(r => !prompts.has(r.prompt_id)), r => { const id = runTask(r, prompts); return tasks.has(id) ? id : ''; });
    const kids = by([...tasks.values()].sort((a, b) => String(a.created).localeCompare(String(b.created))), t => tasks.has(t.parent_id) ? t.parent_id : '');
    const add = n => { index.set(n.key, n); for (const c of n.children) c.parent = n; return n; };
    const runNode = (r, depth) => add({ key: `run:${r.id}`, kind: 'run', rec: r, depth, children: [], stats: { queued: 0, blocked: 0, running: +(r.state === 'working'), needs: +(r.state === 'needs_input' && !r.archived), unread: +(r.unread && !r.archived) } });
    const sum = children => children.reduce((s, c) => { for (const k in s) s[k] += c.stats[k]; return s; }, { queued: 0, blocked: 0, running: 0, needs: 0, unread: 0 });
    const promptNode = (p, depth) => {
      const children = (runsByPrompt.get(p.id) || []).map(r => runNode(r, depth + 1)), stats = sum(children);
      stats.queued += +(p.state === 'queued'); stats.blocked += +(p.state === 'blocked'); if (p.state === 'running' && !stats.running) stats.running = 1;
      return add({ key: `prompt:${p.id}`, kind: 'prompt', rec: p, depth, children, stats });
    };
    const seen = new Set();
    const taskNode = (t, depth) => {
      seen.add(t.id); order.push({ id: t.id, title: t.title, depth });
      const children = [...(promptsBy.get(t.id) || []).map(p => promptNode(p, depth + 1)), ...(runsByTask.get(t.id) || []).map(r => runNode(r, depth + 1)), ...(kids.get(t.id) || []).filter(c => !seen.has(c.id)).map(c => taskNode(c, depth + 1))];
      return add({ key: `task:${t.id}`, kind: 'task', rec: t, depth, children, stats: sum(children) });
    };
    const roots = (kids.get('') || []).map(t => taskNode(t, 0));
    for (const t of tasks.values()) if (!seen.has(t.id)) roots.push(taskNode(t, 0)); // a parent cycle: show it rather than lose it
    const orphans = [...(promptsBy.get('') || []).map(p => promptNode(p, 1)), ...(runsByTask.get('') || []).map(r => runNode(r, 1))];
    const none = add({ key: 'none', kind: 'none', rec: { id: 'none', title: 'No task' }, depth: 0, children: orphans, stats: sum(orphans) });
    return { roots: [...roots, none], none, index, tasks, order, prompts };
  }
  const matchers = {
    'needs-me': n => n.kind === 'run' ? !n.rec.archived && (n.rec.unread || n.rec.state === 'needs_input') : n.kind === 'prompt' && ['blocked', 'errored'].includes(n.rec.state),
    running: n => n.kind === 'run' ? n.rec.state === 'working' : n.kind === 'prompt' && n.rec.state === 'running',
    queued: n => n.kind === 'prompt' && ['queued', 'blocked'].includes(n.rec.state),
    archive: n => (n.kind === 'task' || n.kind === 'run') && Boolean(n.rec.archived),
  };
  const filtered = () => view !== 'everything' && view !== 'no-task';
  // What a view shows: a matching line, everything under an archived task, and the ancestors that lead to either.
  function prune(n, inherited = false) {
    if (view === 'no-task') return n.kind === 'none' || n.parent ? n : null;
    const archive = view === 'archive';
    if (!archive && (n.kind === 'task' || n.kind === 'run') && n.rec.archived) return null;
    if (view === 'everything') return { ...n, children: n.children.map(c => prune(c)).filter(Boolean) };
    const match = matchers[view](n), keepAll = inherited || archive && match && n.kind === 'task';
    const children = n.children.map(c => prune(c, keepAll)).filter(Boolean);
    if (match || keepAll || children.length || n.kind === 'none' && !archive) return { ...n, children };
    return null;
  }
  function isOpen(n) {
    if (n.kind === 'rgroup') return !collapsed.has(n.key);
    if (!n.children.length) return false;
    if (expanded.has(n.key)) return true;
    if (collapsed.has(n.key)) return false;
    if (filtered()) return true;
    if (n.kind === 'task') return n.rec.status !== 'done';
    if (n.kind === 'prompt') return !(n.rec.state === 'done' && !n.stats.unread);
    return true;
  }
  function flatten(nodes, out = []) {
    for (const n of nodes) {
      out.push(n);
      if (!isOpen(n)) continue;
      let children = n.children; const more = [];
      if (!filtered()) {
        const keep = c => c.key === selected || c.stats.unread || c.stats.running || c.stats.needs;
        const finished = children.filter(c => c.kind === 'prompt' && ['done', 'errored'].includes(c.rec.state) && !keep(c));
        const oldRuns = children.filter(c => c.kind === 'run' && !keep(c)).slice(RUN_CAP);
        const hide = new Set();
        if (finished.length > DONE_CAP && !showAll.has(`${n.key}|p`)) { for (const c of finished.slice(0, -DONE_CAP)) hide.add(c); more.push({ kind: 'more', key: `${n.key}|p`, depth: n.depth + 1, label: `Show ${plural(finished.length - DONE_CAP, 'more finished prompt')}`, after: 'prompt' }); }
        if (oldRuns.length && !showAll.has(`${n.key}|r`)) { for (const c of oldRuns) hide.add(c); more.push({ kind: 'more', key: `${n.key}|r`, depth: n.depth + 1, label: `Show ${plural(oldRuns.length, 'more run')}`, after: 'run' }); }
        children = children.filter(c => !hide.has(c));
      }
      for (const kind of ['prompt', 'run', 'task']) {
        flatten(children.filter(c => c.kind === kind), out);
        for (const m of more) if (m.after === kind) out.push(m);
      }
    }
    return out;
  }
  const node = key => model.index.get(key);
  function buildReview(full) {
    const groups = reviewQueue(data || {}, filterTask, new Set(held ? [held] : [])), index = new Map(), lines = [];
    const put = (n, parent) => { n.parent = parent; index.set(n.key, n); return n; };
    const leaf = (item, depth, parent) => put({ ...full.index.get(item.id), depth, children: [], item }, parent);
    const walk = n => { lines.push(n); if (isOpen(n)) n.children.forEach(walk); };
    for (const g of groups) {
      const top = put({ key: `rq:${g.id}`, kind: 'rgroup', depth: 0, group: g, ref: g.id === 'none' ? 'none' : `task:${g.id}` }, null);
      top.children = [...g.items.map(i => leaf(i, 1, top)), ...g.groups.map(s => {
        const sub = put({ key: `rq:${g.id}/${s.id}`, kind: 'rgroup', depth: 1, group: s, ref: 'pane_id' in s ? null : `task:${s.id}` }, top);
        sub.children = s.items.map(i => leaf(i, 2, sub)); return sub;
      })];
      walk(top);
    }
    return { lines, index, items: reviewItems(groups), total: filterTask || held ? reviewItems(reviewQueue(data || {})).length : reviewItems(groups).length };
  }
  const lineNode = key => review.index.get(key) || node(key);
  const taskOf = key => { const n = node(key); return !n ? null : n.kind === 'task' ? n.rec.id : n.kind === 'none' ? null : ownTask(n); };
  // A run is filed under its prompt's task, here as in the rail.
  const ownTask = n => { const id = n.kind === 'run' ? runTask(n.rec, model.prompts) : n.rec.task_id; return model.tasks.has(id) ? id : null; };
  // The task a run was given, by itself or by its prompt; null when the one it is filed under is only inherited.
  const assignedTask = n => { const p = model.prompts.get(n.rec.prompt_id), id = p ? p.task_id : n.rec.task_id; return model.tasks.has(id) ? id : null; };
  const destination = () => destCleared ? null : taskOf(selected);
  const sourceNote = (r, tasks = model.tasks) => !r || r.from === 'none' ? 'not set' : r.from === 'self' ? '' : r.from === 'default' ? '(default)' : `(from ${tasks.get(r.from)?.title || 'parent'})`;
  // Only profile ids resolve on the backend (profileFor also maps claude-code to claude); a stored value outside that list stays selectable so it is never dropped silently.
  const harnesses = current => [...(data?.profiles || []).map(p => [p.id, p.id === p.name ? p.id : `${p.id} (${p.name})`]), ...(current && !(data?.profiles || []).some(p => p.id === current) ? [[current, `${current} (no profile)`]] : [])];

  // ---- outline markup ----------------------------------------------------------------------------------------
  const fact = (label, html, cls = '') => `<span class="ol-fact ${cls}" data-label="${label}">${html}</span>`;
  function lineHTML(n) {
    if (n.kind === 'more') return `<div class="ol-more" data-wb-key="more:${esc(n.key)}" data-depth="${Math.min(n.depth, 8)}"><button type="button" class="subtle" data-act="show-more" data-id="${esc(n.key)}">${esc(n.label)}</button></div>`;
    const r = n.rec, s = n.stats, open = isOpen(n), has = n.children.length > 0, unread = n.kind === 'run' ? r.unread && !r.archived : s.unread > 0;
    const twist = has ? `<button type="button" class="ol-twist" tabindex="-1" data-act="twist" data-id="${esc(n.key)}" aria-label="${open ? 'Collapse' : 'Expand'}"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></button>` : '<span class="ol-twist-gap"></span>';
    let mark = '', text = '', tags = '', facts;
    const queue = [s.queued ? plural(s.queued, 'queued').replace('queueds', 'queued') : '', s.blocked ? `${s.blocked} blocked` : ''].filter(Boolean).join(', ');
    const unreadFact = fact('Unread', unread ? `<b class="ol-unread">${n.kind === 'run' ? 'Unread' : `${s.unread} Unread`}</b>` : '');
    if (n.kind === 'task' || n.kind === 'none') {
      const branch = r.resolved?.branch, git = r.git, own = branch?.from === 'self' || n.depth === 0;
      mark = `<span class="ol-mark ol-mark-${n.kind}"></span>`; text = esc(r.title);
      tags = [n.kind === 'none' ? `<span class="ol-tag">${plural(n.children.length, 'line')}</span>` : '', r.source === 'omp-todo' ? '<span class="ol-tag">from omp todo</span>' : '', r.archived ? '<span class="ol-tag">archived</span>' : '', has && !open ? `<span class="ol-tag">${plural(n.children.length, 'line')} folded</span>` : ''].join('');
      const stateWord = s.needs ? state('needs input', 'needs_input') : s.running ? state(`${s.running} running`, 'running') : n.kind === 'task' && r.status === 'done' ? state('done') : '';
      const pr = own && !git?.pr && git?.pr_loading ? '<span class="ol-dim">checking…</span>' : own && git?.pr ? `<span class="ol-mono">PR ${esc(git.pr.number)}</span> ${state(git.pr.checks === 'none' ? git.pr.state : `checks ${git.pr.checks}`, git.pr.checks)}` : '';
      facts = fact('Queue', [n.kind === 'task' ? queueWord(queueNote(r.id)) : '', esc(queue)].filter(Boolean).join(' ')) + fact('State', stateWord) + unreadFact + fact('Branch', own && branch?.value ? `<span class="ol-mono${branch.from === 'self' ? '' : ' is-inherited'}">${esc(branch.value)}</span>` : '') + fact('Pull request', pr);
    } else if (n.kind === 'prompt') {
      mark = '<span class="ol-mark" aria-label="Prompt">&gt;</span>';
      text = esc(oneLine(r.body)) || '<i>empty prompt</i>';
      tags = has && !open ? `<span class="ol-tag">${plural(n.children.length, 'run')}</span>` : '';
      facts = fact('Queue', '') + fact('State', state(r.state)) + unreadFact + fact('Branch', '') + fact('Pull request', '');
    } else {
      mark = '<span class="ol-mark ol-mark-run">run</span>';
      const typed = !model.prompts.has(r.prompt_id);
      text = [typed ? esc(oneLine(r.prompt)) || 'typed in pane' : '', `<span class="ol-mono">${esc(r.harness)}</span>`, esc(agentName(r.pane_name, r.pane_id || '')), r.commits?.length ? plural(r.commits.length, 'commit') : ''].filter(Boolean).join(' <span class="ol-sep">·</span> ');
      tags = [typed ? '<span class="ol-tag">typed in pane</span>' : '', r.source ? `<span class="ol-tag">${esc(r.source)}</span>` : '', r.response_captured === false ? '<span class="ol-tag">response not captured</span>' : '', r.archived ? '<span class="ol-tag">archived</span>' : '', `<span class="ol-tag ol-mono">${esc(when(r.finished || r.started))}</span>`].join('');
      facts = fact('Queue', '') + fact('State', state(r.state)) + unreadFact + fact('Branch', '') + fact('Pull request', '');
    }
    const sel = n.key === selected;
    return `<div class="ol-line is-${n.kind}${sel ? ' is-selected' : ''}${unread ? ' is-unread' : ''}${n.kind === 'task' && r.status === 'done' ? ' is-done' : ''}" id="ol-${esc(n.key)}" data-key="${esc(n.key)}" role="treeitem" aria-level="${n.depth + 1}" aria-selected="${sel}"${has ? ` aria-expanded="${open}"` : ''} data-depth="${Math.min(n.depth, 8)}"><div class="ol-main">${twist}${mark}<span class="ol-text">${text}</span>${tags}</div>${facts}</div>`;
  }
  function reviewLineHTML(n) {
    const sel = n.key === selected, age = at => at ? waitingFor({ updated: new Date(at).toISOString() }) : '';
    const row = (cls, main, facts, extra = '') => `<div class="ol-line ${cls}${sel ? ' is-selected' : ''}" id="ol-${esc(n.key)}" data-key="${esc(n.key)}" role="treeitem" aria-level="${n.depth + 1}" aria-selected="${sel}"${extra} data-depth="${n.depth}"><div class="ol-main">${main}</div>${facts}</div>`;
    if (n.kind === 'rgroup') {
      const g = n.group, open = isOpen(n), top = n.depth === 0, pane = 'pane_id' in g, items = top ? reviewItems([g]) : g.items;
      const unread = items.filter(i => i.kind === 'run' && i.rec.unread && !i.rec.archived).length, needs = items.some(i => i.rec.state === 'needs_input');
      const title = pane ? agentName(g.title, g.pane_id) : g.title;
      const twist = `<button type="button" class="ol-twist" tabindex="-1" data-act="twist" data-id="${esc(n.key)}" aria-label="${open ? 'Collapse' : 'Expand'}"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></button>`;
      const mark = pane ? '<span class="ol-mark ol-mark-run">pane</span>' : `<span class="ol-mark ol-mark-${g.id === 'none' ? 'none' : 'task'}"></span>`;
      const only = top && g.id !== 'none' && !filterTask ? `<a class="ol-rq-only" href="#outline/needs-me/${encodeURIComponent(g.id)}">Only this task</a>` : '';
      return row(`is-rgroup ${top ? g.id === 'none' ? 'is-none' : 'is-task' : 'is-sub'}`, `${twist}${mark}<span class="ol-text" title="${esc(title)}">${esc(title)}</span><span class="ol-tag">${plural(g.count, 'item')}</span>${only}`,
        fact('Pane', '') + fact('State', needs ? state('needs input', 'needs_input') : '') + fact('Unread', unread ? `<b class="ol-unread">${unread} Unread</b>` : '') + fact('Waiting', `oldest ${esc(age(g.oldest))}`), ` aria-expanded="${open}"`);
    }
    const r = n.rec, run = n.kind === 'run', unread = run && r.unread && !r.archived, paneId = n.item.pane_id, pane = (data.panes || []).find(p => p.id === paneId);
    const text = run ? esc(oneLine(r.prompt)) || 'typed in pane' : esc(oneLine(r.body)) || '<i>empty prompt</i>';
    const where = run ? `<span class="ol-mono">${esc(r.harness)}</span>${'pane_id' in n.parent.group ? '' : ` ${esc(agentName(r.pane_name, r.pane_id || ''))}`}` : paneId && !('pane_id' in n.parent.group) ? esc(agentName(pane?.name, paneId)) : '';
    return row(`is-${n.kind}${unread ? ' is-unread' : ''}`, `<span class="ol-twist-gap"></span>${run ? '<span class="ol-mark ol-mark-run">run</span>' : '<span class="ol-mark" aria-label="Prompt">&gt;</span>'}<span class="ol-text">${text}</span>`,
      fact('Pane', where) + fact('State', state(r.state)) + fact('Unread', unread ? '<b class="ol-unread">Unread</b>' : '') + fact('Waiting', esc(age(n.item.at))));
  }
  const moreRow = (act, left) => `<div class="ol-more ol-chunk" data-wb-key="chunk"><button type="button" class="subtle" data-act="${act}">Show more (${left} more)</button></div>`;
  // ---- queue page --------------------------------------------------------------------------------------------
  const qWaits = i => i.kind === 'run' ? !i.rec.archived && (i.rec.unread || i.rec.state === 'needs_input') : ['blocked', 'errored'].includes(i.rec.state);
  const paneLabel = id => agentName((data?.panes || []).find(p => p.id === id)?.name || (data?.runs || []).find(r => r.pane_id === id)?.pane_name, id);
  const scopeLabel = s => s.type === 'task' ? `Task: ${s.id === 'none' ? 'No task' : model.tasks.get(s.id)?.title || 'a task that no longer exists'}` : s.type === 'session' ? `Session: ${s.id}` : s.type === 'pane' ? `Pane: ${paneLabel(s.id)}` : 'All';
  const sameScope = (a, b) => a.type === b.type && (a.type === 'all' || a.id === b.id);
  function queueHTML() {
    if (!qItems.length) return `<div class="ol-empty q-empty" role="status"><p class="q-clear">${icon('done', '')}Queue clear</p><p>Nothing is waiting in ${qScope.type === 'all' ? 'any task' : esc(scopeLabel(qScope))}.</p>${qScope.type !== 'all' && qCount({ type: 'all' }) ? `<p><a href="#queue">Show everything waiting (${qCount({ type: 'all' })})</a></p>` : ''}</div>`;
    const at = qItems.findIndex(i => i.id === qSel); if (at >= qShown) qShown = at + 1;
    return qItems.slice(0, qShown).map(i => {
      const waits = qWaits(i), sel = i.id === qSel, where = i.pane_id ? agentName(i.pane, i.pane_id) : i.kind === 'prompt' ? 'no pane yet' : 'no pane';
      return `<div class="q-row${sel ? ' is-selected' : ''}${waits ? '' : ' is-read'}" id="ol-${esc(i.id)}" data-qkey="${esc(i.id)}" role="option" aria-selected="${sel}">${icon(i.ind, `${ICONS[i.ind][0]}${waits ? '' : ' (read)'}`, waits ? '' : ' is-read')}<span class="q-text">${esc(i.summary) || (i.kind === 'run' ? 'typed in pane' : '<i>empty prompt</i>')}</span><span class="q-age ol-mono" title="Waiting since ${esc(when(i.at))}">${esc(waitingFor({ updated: new Date(i.at).toISOString() }))}</span><span class="q-path">${esc(i.task || 'No task')} <span class="ol-sep">›</span> ${esc(where)}${i.docs && waits ? strip([{ kind: 'doc', count: i.docs }]) : ''}</span></div>`;
    }).join('') + (qItems.length > qShown ? moreRow('q-more', qItems.length - qShown) : '');
  }
  // All, then the scope in force, then the task, session and pane of the open item: every scope is one click away.
  function chipsHTML() {
    const cur = qItems.find(i => i.id === qSel), chips = [{ type: 'all' }];
    const add = s => { if (s.id != null && s.id !== '' && !chips.some(c => sameScope(c, s))) chips.push(s); };
    if (qScope.type !== 'all') add(qScope);
    if (cur) { add({ type: 'task', id: cur.task_id ?? 'none' }); add({ type: 'session', id: cur.session }); add({ type: 'pane', id: cur.pane_id }); }
    const n = qCount(qScope);
    // Two steps, in the page: the first click arms it with the number it will clear, the second does it.
    const marks = markable(qItems).length, armed = confirming === 'markall' && marks > 0;
    const mark = marks ? `<button type="button" class="q-markall${armed ? ' is-armed' : ''}" data-wb-key="markall" data-act="${armed ? 'mark-all' : 'ask-mark-all'}"${dis('mark-all')}${armed ? ' title="Turns on a question and blocked or errored prompts stay. Escape cancels."' : ''}>${armed ? `Mark ${marks} read — confirm` : 'Mark all read'}</button>` : '';
    return `<span class="q-count" role="status"><b>${n}</b> waiting</span>${mark}<span class="q-chips" role="navigation" aria-label="Queue scope">${chips.map(s => `<a class="q-chip" data-wb-key="chip:${esc(s.type)}:${esc(s.id ?? '')}" href="${queueHash(s)}"${sameScope(s, qScope) ? ' aria-current="page"' : ''}>${esc(scopeLabel(s))} <span>${qCount(s)}</span></a>`).join('')}</span>`;
  }
  function qOpen(id) {
    qSel = id; confirming = null; destCleared = false; render();
    if (id) document.getElementById(`ol-${id}`)?.scrollIntoView({ block: 'nearest' });
  }
  function treeHTML() {
    if (!data) return loadError ? `<div class="ol-empty"><p>The outline could not be loaded: ${esc(loadError)}</p><button type="button" data-act="retry">Try again</button></div>` : '<p class="ol-empty" role="status">Loading the outline…</p>';
    if (view === 'queue') return queueHTML();
    // Long lists are drawn a chunk at a time; the selected line is always inside what is drawn.
    const at = model.lines.findIndex(n => n.key === selected); if (at >= treeShown) treeShown = at + 1;
    const more = model.lines.length > treeShown ? moreRow('tree-more', model.lines.length - treeShown) : '';
    if (view === 'needs-me') return model.lines.slice(0, treeShown).map(reviewLineHTML).join('') + more || '<p class="ol-empty" role="status">Nothing is waiting for you.</p>';
    const empty = !data.tasks.length && !data.prompts.length && !data.runs.length;
    if (empty) return `<div class="ol-empty"><p>Nothing here yet. Type a line above and press Enter. It is saved as it is; nothing else is asked.</p>
<div class="ol-line is-task is-example" data-depth="0"><div class="ol-main"><span class="ol-twist-gap"></span><span class="ol-text">Fix the parser</span><span class="ol-tag">example · plain text makes a task</span></div></div>
<div class="ol-line is-prompt is-example" data-depth="1"><div class="ol-main"><span class="ol-twist-gap"></span><span class="ol-mark">&gt;</span><span class="ol-text">add tests for nested quotes</span><span class="ol-tag">example · starting with &gt; makes a prompt</span></div></div></div>`;
    const html = model.lines.slice(0, treeShown).map(lineHTML).join('') + more;
    return html || `<p class="ol-empty">Nothing in ${esc(VIEWS[view])} right now.</p>`;
  }

  // ---- detail markup -----------------------------------------------------------------------------------------
  const val = (key, server) => drafts.has(key) ? drafts.get(key) : server ?? '';
  const dis = key => busy.has(key) ? ' disabled' : '';
  const button = (act, id, label, cls = '', extra = '') => `<button type="button" class="${cls}" data-act="${act}" data-id="${esc(id)}"${dis(`${act}:${id}`)}${extra}>${label}</button>`;
  const options = (rows, current) => rows.map(([value, label]) => `<option value="${esc(value)}"${String(value) === String(current ?? '') ? ' selected' : ''}>${esc(label)}</option>`).join('');
  const taskOptions = (exclude = new Set()) => model.order.filter(t => !exclude.has(t.id)).map(t => [t.id, '  '.repeat(t.depth) + t.title]);
  const section = (key, title, body, tools = '') => `<section class="ol-sec" data-wb-key="sec:${key}"><div class="ol-sec-head"><h3>${title}</h3>${tools}</div>${body}</section>`;
  const subtreeIds = n => { const ids = new Set(); (function walk(x) { if (x.kind === 'task') ids.add(x.rec.id); x.children.forEach(walk); })(n); return ids; };
  const paneOptions = current => {
    const panes = data.panes || [], rows = [['', 'New pane (launched for the task)'], ...panes.filter(p => p.ready).map(p => [p.id, `${agentName(p.name, p.id)} · ${p.harness || p.kind} · ${p.host || 'local'} · ${p.state}`])];
    if (current && !rows.some(([id]) => id === current)) { const p = panes.find(p => p.id === current); rows.push([current, p ? `${agentName(p.name, p.id)} · ${p.state === 'closed' ? 'closed' : `${p.state} · not at rest`}` : `pane ${current.slice(0, 8)} · gone`]); }
    return rows;
  };
  const harnessSelect = (save, own, resolved, id) => `<select id="${id}" data-save="${esc(save)}">${options([['', `Inherit${resolved && resolved.from !== 'self' && resolved.value ? `: ${resolved.value} ${sourceNote(resolved)}` : ''}`], ...harnesses(own)], own)}</select>`;
  const runRow = r => `<li data-wb-key="rr:${esc(r.id)}"><button type="button" class="ol-rowlink${r.unread ? ' is-unread' : ''}" data-act="select" data-id="run:${esc(r.id)}"><span class="ol-mono">${esc(r.harness)}</span> ${state(r.state)} <span>${r.commits?.length ? plural(r.commits.length, 'commit') : ''}</span> ${r.unread ? '<b class="ol-unread">Unread</b>' : ''} <span class="ol-mono ol-dim">${esc(when(r.finished || r.started))}</span></button></li>`;
  const queueRows = (prompts, taskId) => prompts.length ? `<ol class="ol-list">${prompts.map((p, i) => `<li data-wb-key="q:${esc(p.id)}"><button type="button" class="ol-rowlink" data-act="select" data-id="prompt:${esc(p.id)}"><span class="ol-mark">&gt;</span> <span class="ol-clip">${esc(oneLine(p.body)) || 'empty prompt'}</span> ${state(p.state)}</button>${i ? button('earlier', p.id, 'Earlier', 'subtle', ` data-before="${esc(prompts[i - 1].id)}" data-task="${esc(taskId || '')}"`) : ''}</li>`).join('')}</ol>` : '<p class="ol-dim">No prompts waiting.</p>';
  // Why an automatic queue is not moving: a word for a row, a line with its link for the task page.
  const queueNote = id => { const t = model.tasks.get(id); return t ? queueStatus(data?.prompts || [], id, t.resolved?.queue_mode?.value, data?.panes || []) : null; };
  const queueWord = q => q ? `<span class="ol-state s-${q.state === 'held' ? 'blocked' : q.state === 'waiting' ? 'working' : 'pending'}" title="Auto queue: ${esc(q.text)}">${q.state === 'start' ? 'not started' : q.state}</span>` : '';
  const queueLine = q => {
    if (!q) return '';
    const by = model.prompts.get(q.by), pane = (data.panes || []).find(p => p.id === q.pane);
    const link = by ? ` <a href="${outlineHash(`prompt:${by.id}`)}">${esc(oneLine(by.body)) || 'empty prompt'}</a>` : pane ? ` <a href="#agent/${encodeURIComponent(pane.id)}">Open the pane</a>` : '';
    return `<p class="ol-sec-note" data-wb-key="qstatus">${state(q.state === 'start' ? 'not started' : q.state, q.state === 'held' ? 'blocked' : q.state === 'waiting' ? 'working' : 'pending')} ${esc(q.text)}${by ? ':' : '.'}${link}</p>`;
  };
  const head = (kind, extra = '') => `<div class="ol-detail-head"><button type="button" class="ol-back" data-act="back">Back to outline</button><p class="ol-kind">${kind}${extra}</p></div>`;
  // In the review queue the open item names its place and offers the next oldest one.
  const nextBar = key => {
    const items = view === 'queue' ? qItems : view === 'needs-me' ? review.items : [], i = items.findIndex(x => x.id === key); if (i < 0) return '';
    return `<div class="ol-next" data-wb-key="next"><span class="ol-dim">${i + 1} of ${items.length} waiting, oldest first</span>${button('next', key, view === 'queue' ? 'Next <kbd>n</kbd>' : 'Next', view === 'queue' ? 'primary' : '', view === 'queue' || nextAfter(items, key) ? '' : ' disabled')}</div>`;
  };
  const queueLink = (scope, label) => `<a class="ol-qlink" href="${queueHash(scope)}">${icon('queue', '')}${label}${qCount(scope) ? ` <b>${qCount(scope)}</b>` : ''}</a>`;

  function taskDetail(n) {
    const t = n.rec, id = t.id, own = t.own || {}, res = t.resolved || {}, parent = model.tasks.get(t.parent_id);
    const rows = TASK_FIELDS.map(([f, label, type]) => {
      const r = res[f] || { value: '', from: 'none' }, mine = own[f] !== '' && own[f] != null, key = `task:${id}:${f}`, fid = `olf-${f}`;
      const inherited = !mine && r.value !== '' && r.value != null ? String(r.value) : '';
      let control; const clear = button('clear-field', key, 'Clear', 'subtle', ` aria-label="Clear ${label}, inherit instead"`);
      if (type === 'harness') control = harnessSelect(key, mine ? own[f] : '', r, fid);
      else if (type === 'mode') control = `<select id="${fid}" data-save="${key}">${options([['', `Inherit${inherited ? `: ${inherited} ${sourceNote(r)}` : ''}`], ['manual', 'manual'], ['auto', 'auto']], mine ? own[f] : '')}</select>`;
      else control = `<input id="${fid}" class="${f === 'repo' ? '' : 'ol-mono'}" data-draft="${key}" data-save="${key}" value="${esc(val(key, mine ? own[f] : ''))}" placeholder="${esc(inherited || 'not set')}" autocomplete="off" spellcheck="false">${type === 'dir' ? button('browse', key, 'Browse…') + (mine ? clear : '') : ''}`;
      const note = !mine ? `<span class="ol-src">${esc(sourceNote(r)) || 'not set'}</span>` : type === 'dir' ? '' : clear;
      const problem = fieldErrors.get(key);
      return `<div class="ol-field${mine ? '' : ' is-inherited'}${type === 'dir' ? ' is-wide' : ''}" data-wb-key="f:${f}"><label for="${fid}">${label}</label><div class="ol-field-edit">${control}</div>${note}${problem ? `<p class="ol-error-text ol-field-error" role="alert">${esc(problem)}</p>` : ''}</div>`;
    }).join('');
    const queue = (data.prompts || []).filter(p => p.task_id === id && ['queued', 'blocked', 'running'].includes(p.state)).sort((a, b) => a.position - b.position);
    const mode = res.queue_mode?.value || 'manual', modeNote = sourceNote(res.queue_mode);
    const modeSwitch = `<div class="ol-switch" role="group" aria-label="Queue mode">${['manual', 'auto'].map(m => `<button type="button" data-act="mode" data-id="${esc(id)}" data-arg="${m}" aria-pressed="${mode === m}"${dis(`mode:${id}`)}>${m === 'manual' ? 'Manual' : 'Auto'}</button>`).join('')}</div>`;
    const panes = (data.panes || []).filter(p => paneTask(p) === id && p.state !== 'closed'), g = t.git || { state: 'none' };
    const gitFacts = g.state === 'none' ? '<p class="ol-dim">No repo is set for this task.</p>' : g.state === 'not_a_repo' ? `<p class="ol-dim">${esc(res.repo?.value || 'The directory')} is not a git repository.</p>` : `<dl class="ol-dl"><dt>HEAD</dt><dd class="ol-mono">${esc(g.head || 'unknown')}${g.sha ? ` <span class="ol-dim">${esc(String(g.sha).slice(0, 7))}</span>` : ''}</dd><dt>Working tree</dt><dd>${g.dirty ? 'uncommitted changes' : 'clean'}</dd><dt>Pull request</dt><dd>${g.pr ? `<a href="${esc(g.pr.url)}" target="_blank" rel="noreferrer">PR ${esc(g.pr.number)}</a> ${state(g.pr.state, 'plain')} ${state(g.pr.checks === 'none' ? 'no checks' : `checks ${g.pr.checks}`, g.pr.checks)}` : g.pr_loading ? 'Checking…' : g.pr_state === 'unavailable' ? 'Not available: gh could not be reached' : 'None for this branch'}</dd></dl>${g.commits?.length ? `<ul class="ol-list ol-commits">${g.commits.map(c => `<li><span class="ol-mono">${esc(String(c.sha).slice(0, 7))}</span> <span class="ol-clip">${esc(c.subject)}</span> <span class="ol-mono ol-dim">${esc(when(c.at))}</span></li>`).join('')}</ul>` : ''}`;
    const notes = (t.notes || []).map(note => `<li>${esc(typeof note === 'string' ? note : note.body ?? note.text ?? JSON.stringify(note))}${note?.created ? ` <span class="ol-mono ol-dim">${esc(when(note.created))}</span>` : ''}</li>`).join('');
    return head('Task', (t.source === 'omp-todo' ? ' · from omp todo' : '') + (t.archived ? ' · archived' : '')) +
      `<div class="ol-title-row" data-wb-key="title"><label class="ol-visually-hidden" for="olf-title">Title</label><input id="olf-title" class="ol-title-input" data-draft="task:${esc(id)}:title" data-save="task:${esc(id)}:title" value="${esc(val(`task:${id}:title`, t.title))}" maxlength="200"></div>${qCount({ type: 'task', id }) ? `<p class="ol-review-link" data-wb-key="review">${queueLink({ type: 'task', id }, 'Queue of this task')}</p>` : ''}
<div class="ol-inline" data-wb-key="meta"><label>Status<select data-save="task:${esc(id)}:status">${options(['open', 'active', 'done'].map(s => [s, s]), t.status)}</select></label><label>Move under<select data-save="task:${esc(id)}:parent_id">${options([['', 'Top level'], ...taskOptions(subtreeIds(n))], t.parent_id || '')}</select></label></div>` +
      section('facts', 'Facts', `<p class="ol-dim ol-sec-note">${parent ? `Empty fields are inherited from ${esc(parent.title)}.` : 'Empty fields fall back to the app defaults.'}</p>${rows}`) +
      section('queue', `Queue <span class="ol-count">${queue.length}</span>`, `${queueLine(queueNote(id))}${queueRows(queue, id)}<p class="ol-dim ol-sec-note">${mode === 'auto' ? 'Auto: each next prompt runs when the pane comes to rest; start the first with Run next. A blocked prompt holds the queue.' : 'Manual: nothing runs until you press Run.'}${modeNote ? ` ${esc(modeNote)}` : ''}</p>`, `${modeSwitch}${button('run-next', id, 'Run next', 'primary', queue.some(p => p.state === 'queued') ? '' : ' disabled')}`) +
      section('panes', `Panes <span class="ol-count">${panes.length}</span>`, panes.length ? `<ul class="ol-list">${panes.map(p => `<li><a href="#agent/${encodeURIComponent(p.id)}">${esc(agentName(p.name, p.id))}</a> <span class="ol-mono">${esc(p.harness || p.kind)}</span> ${state(p.state)} <span class="ol-mono ol-dim">${esc([p.host, p.session].filter(Boolean).join(' / '))}</span>${p.task_id ? '' : ' <span class="ol-dim">via session</span>'}</li>`).join('')}</ul>` : '<p class="ol-dim">No panes are assigned. Running a prompt launches one in the repo.</p>') +
      section('git', 'Git', `${gitFacts}${g.fetched ? `<p class="ol-dim ol-sec-note">Read <span class="ol-mono">${esc(when(g.fetched))}</span></p>` : ''}`, button('git-refresh', id, busy.has(`git-refresh:${id}`) ? 'Refreshing…' : 'Refresh')) +
      section('notes', 'Notes', notes ? `<ul class="ol-list ol-notes">${notes}</ul>` : '<p class="ol-dim">No notes.</p>') +
      `<div class="ol-actions" data-wb-key="foot">${button('archive-task', id, t.archived ? 'Unarchive' : 'Archive', '', ` data-arg="${t.archived ? '' : '1'}"`)}<a href="#task/${encodeURIComponent(id)}">Open the task page</a></div>`;
  }
  function noneDetail(n) {
    const queue = n.children.filter(c => c.kind === 'prompt' && ['queued', 'blocked', 'running'].includes(c.rec.state)).map(c => c.rec);
    return head('Group') + `<h2 class="ol-title">No task</h2><p class="ol-dim">Prompts and runs that belong to no task. Nothing is lost here; move a line into a task whenever you like.</p>` +
      section('queue', `Queue <span class="ol-count">${queue.length}</span>`, `${queueRows(queue, '')}<p class="ol-dim ol-sec-note">This queue is always manual.</p>`, button('run-next', 'none', 'Run next', 'primary', queue.some(p => p.state === 'queued') ? '' : ' disabled')) +
      section('bulk', 'Move everything', `<div class="ol-inline"><label>Into task<select id="olf-bulk" data-draft="bulk">${options([['', 'Choose a task'], ...taskOptions()], val('bulk', ''))}</select></label>${button('bulk-move', 'none', `Move ${plural(n.children.length, 'line')}`, '', n.children.length && val('bulk', '') ? '' : ' disabled')}</div>`);
  }
  function promptDetail(n) {
    const p = n.rec, id = p.id, res = p.resolved || {}, pf = p.preflight || { blocks: [], warns: [] }, taskId = model.tasks.has(p.task_id) ? p.task_id : '';
    const fix = b => {
      if (b.fix === 'body') return button('focus', 'olf-body', 'Write the prompt');
      if (b.fix === 'target') return `<label>Target pane<select data-save="prompt:${esc(id)}:target">${options(paneOptions(p.target), p.target)}</select></label>`;
      if (b.fix === 'harness') return `<label>Harness${harnessSelect(`prompt:${id}:harness`, p.harness, res.harness, `olfix-harness-${esc(b.code)}`)}</label>`;
      if (b.fix === 'repo') return taskId ? `<label>Repo directory for ${esc(model.tasks.get(taskId).title)}<span class="ol-field-edit"><input data-draft="fix:${esc(id)}:repo" data-save="task:${esc(taskId)}:repo" value="${esc(val(`fix:${id}:repo`, ''))}" placeholder="/path/to/repo" autocomplete="off" spellcheck="false">${button('browse', `task:${taskId}:repo`, 'Browse…')}</span>${fieldErrors.get(`task:${taskId}:repo`) ? `<span class="ol-error-text" role="alert">${esc(fieldErrors.get(`task:${taskId}:repo`))}</span>` : ''}</label>` : '<p class="ol-dim">This prompt has no task to hold a repo. Choose a pane at rest above, or move the prompt into a task that has one.</p>';
      return '';
    };
    const blocks = pf.blocks.length ? `<ul class="ol-checks">${pf.blocks.map(b => `<li data-wb-key="b:${esc(b.code)}"><p><b class="ol-state s-blocked">Block</b> ${esc(b.message)}</p><div class="ol-fix">${fix(b)}</div></li>`).join('')}</ul>` : '<p class="ol-dim">Nothing blocks this prompt.</p>';
    const warns = pf.warns.length ? `<ul class="ol-checks">${pf.warns.map(w => `<li><p><b class="ol-state s-pending">Warning</b> ${esc(w.message)}</p></li>`).join('')}</ul>` : '<p class="ol-dim">No warnings.</p>';
    const runs = n.children.map(c => c.rec), del = confirming === `delete:${id}`;
    return head('Prompt', ` · ${state(p.state)}`) + nextBar(`prompt:${id}`) +
      `<div data-wb-key="body"><label for="olf-body">Prompt text</label><textarea id="olf-body" rows="6" data-draft="prompt:${esc(id)}:body" data-save="prompt:${esc(id)}:body" maxlength="16000" placeholder="What should the agent do?">${esc(val(`prompt:${id}:body`, p.body))}</textarea>${p.error ? `<p class="ol-error-text">Last attempt: ${esc(p.error)}</p>` : ''}</div>
<div class="ol-inline" data-wb-key="where"><label>Task<select data-save="prompt:${esc(id)}:task_id">${options([['', 'No task'], ...taskOptions()], taskId)}</select></label><label>Target pane<select data-save="prompt:${esc(id)}:target">${options(paneOptions(p.target), p.target)}</select></label></div>
<div class="ol-inline" data-wb-key="how"><label>Harness${harnessSelect(`prompt:${id}:harness`, p.harness, res.harness, 'olf-harness')}</label><label>Model<input class="ol-mono" data-draft="prompt:${esc(id)}:model" data-save="prompt:${esc(id)}:model" value="${esc(val(`prompt:${id}:model`, p.model))}" placeholder="${esc(res.model?.value ? `${res.model.value} ${sourceNote(res.model)}` : 'harness default')}" autocomplete="off" spellcheck="false"></label></div>
<p class="ol-dim ol-sec-note" data-wb-key="resolved">Runs in <span class="ol-mono">${esc(res.repo?.value || 'no repo')}</span> ${esc(sourceNote(res.repo) === 'not set' ? '' : sourceNote(res.repo))} on <span class="ol-mono">${esc(res.branch?.value || 'no branch')}</span></p>` +
      section('blocks', `Blocks <span class="ol-count">${pf.blocks.length}</span>`, blocks) + section('warns', `Warnings <span class="ol-count">${pf.warns.length}</span>`, warns) +
      `<div class="ol-actions" data-wb-key="run">${button('run', id, busy.has(`run:${id}`) ? 'Starting…' : 'Run now', 'primary', pf.blocks.length || p.state === 'running' ? ' disabled' : '')}${button('save-queue', id, ['running', 'blocked'].includes(p.state) ? 'Back to queue' : pf.blocks.length ? 'Save to queue instead' : 'Save to queue')}${del ? `${button('delete', id, 'Confirm delete', 'danger')}${button('keep', id, 'Keep')}` : button('ask-delete', id, 'Delete', 'danger')}</div>${pf.blocks.length ? '<p class="ol-dim ol-sec-note">Run now is off until each block above is fixed. The prompt is kept either way.</p>' : ''}` +
      section('runs', `Runs <span class="ol-count">${runs.length}</span>`, runs.length ? `<ul class="ol-list">${runs.map(runRow).join('')}</ul>` : '<p class="ol-dim">Not run yet.</p>');
  }
  // One line per older run of the same pane; it opens in place, and its text is fetched the first time it is opened.
  function historyRow(x) {
    const body = bodies.get(x.id), turn = body?.data;
    const inner = body?.error ? `<p class="ol-error-text">This run could not be read: ${esc(body.error)}</p>` : !turn ? '<p class="ol-dim" role="status">Loading…</p>'
      : `<h4>Prompt</h4><pre class="ol-pre">${esc(turn.prompt ?? x.prompt ?? '')}</pre><h4>Response</h4>${turn.response ? `<div class="md">${markdown(turn.response)}</div>` : '<p class="ol-dim">No response was captured.</p>'}`;
    return `<details class="ol-hist${x.unread ? ' is-unread' : ''}" data-wb-key="h:${esc(x.id)}" data-hist="${esc(x.id)}"><summary><span class="ol-clip">${esc(oneLine(x.prompt)) || 'typed in pane'}</span>${state(x.state)}<span class="ol-mono ol-dim">${esc(when(x.finished || x.started))}</span></summary><div class="ol-hist-body">${inner}<p><a href="${outlineHash(`run:${x.id}`)}">Open this run</a></p></div></details>`;
  }
  // A local .md cannot be a link (the browser may not open file paths), so it offers its path and the OS default app.
  const docPath = (d, taskId) => { const p = /^file:\/\//i.test(d.href) ? decodeURIComponent(new URL(d.href).pathname) : d.href, repo = model.tasks.get(taskId)?.resolved?.repo?.value; return /^[\/~]/.test(p) || !repo ? p : `${repo.replace(/\/$/, '')}/${p.replace(/^\.\//, '')}`; };
  function docRow(r, d, i, taskId) {
    if (d.kind === 'mdoc') return `<li data-wb-key="doc:${i}"><a href="${esc(d.href)}" target="_blank" rel="noopener">${esc(d.title)}</a> <span class="ol-mono ol-dim">${esc(d.href)}</span></li>`;
    const key = `${r.id}|${i}`, note = docNotes.get(key), path = docPath(d, taskId);
    return `<li data-wb-key="doc:${i}"><span class="ol-doc-title">${esc(d.title)}</span> <span class="ol-mono ol-dim ol-doc-path">${esc(path)}</span><span class="ol-doc-acts">${button('copy-doc', key, note?.copied ? 'Copied' : 'Copy path', 'subtle', ` data-path="${esc(path)}"`)}${button('open-doc', key, busy.has(`open-doc:${key}`) ? 'Opening…' : note?.opened ? 'Opened' : 'Open', 'subtle', ` data-path="${esc(d.href)}" data-turn="${esc(r.id)}"`)}</span>${note?.error ? `<p class="ol-error-text ol-doc-error" role="alert">${esc(note.error)}</p>` : ''}</li>`;
  }
  // The word on the button is the receipt; it goes back by itself.
  function docNote(key, note) { docNotes.set(key, note); render(); if (!note.error) setTimeout(() => { if (docNotes.get(key) === note) { docNotes.delete(key); render(); } }, 2000); }
  function runDetail(n) {
    const r = n.rec, id = r.id, body = bodies.get(id), pane = (data.panes || []).find(p => p.id === r.pane_id), taskId = ownTask(n) || '';
    const waiting = r.state === 'needs_input' || pane?.state === 'needs_input', prompt = model.prompts.get(r.prompt_id), turn = body?.data;
    const provenance = [r.source ? `Source: ${r.source}` : 'Source not recorded', r.response_captured === false ? 'response not captured' : '', prompt ? '' : 'typed straight into the pane'].filter(Boolean).join(' · ');
    const paneName = agentName(r.pane_name, r.pane_id || ''), ownerId = taskId, own = assignedTask(n) || '';
    const via = ownerId && !own ? pane?.task_id === ownerId ? 'via pane' : 'via session' : '';
    const older = r.pane_id ? (data.runs || []).filter(x => x.pane_id === r.pane_id && x.id !== id && String(x.started) < String(r.started)).sort((a, b) => String(b.started).localeCompare(String(a.started))) : [];
    const cap = histShown.get(id) || CHUNK;
    return head('Run', ` · ${state(r.state)}${r.unread ? ' · <b class="ol-unread">Unread</b>' : ''}`) + nextBar(`run:${id}`) +
      `<h2 class="ol-title ol-item-title" data-wb-key="title">${esc(oneLine(turn?.prompt ?? r.prompt)) || 'Typed in pane'}</h2>
<p class="ol-where" data-wb-key="where">${pane ? `<a href="#agent/${encodeURIComponent(pane.id)}">${esc(paneName)}</a>` : `${esc(paneName)} <span class="ol-dim">(closed)</span>`} <span class="ol-sep">·</span> ${ownerId ? `<a href="${outlineHash(`task:${ownerId}`)}">${esc(model.tasks.get(ownerId).title)}</a>${via ? ` <span class="ol-dim">${via}</span>` : ''}` : 'No task'} <span class="ol-sep">·</span> <span class="ol-mono ol-dim">${esc(when(r.finished || r.started))}</span></p>
<p class="ol-qlinks" data-wb-key="queues">${r.pane_id ? queueLink({ type: 'pane', id: r.pane_id }, 'Pane queue') : ''}${queueLink({ type: 'task', id: ownerId || 'none' }, 'Task queue')}${r.session ? queueLink({ type: 'session', id: r.session }, 'Session queue') : ''}</p>` +
      section('prompt', 'Prompt', `<pre class="ol-pre">${esc(turn?.prompt ?? r.prompt ?? '')}</pre>`, prompt ? button('select', `prompt:${prompt.id}`, 'Open the prompt', 'subtle') : '') +
      (r.docs?.length ? section('docs', `Documents <span class="ol-count">${r.docs.length}</span>`, `<ul class="ol-list ol-docs">${r.docs.map((d, i) => docRow(r, d, i, taskId)).join('')}</ul>`) : '') +
      section('response', 'Response', body?.error ? `<p class="ol-error-text">The response could not be read: ${esc(body.error)}</p>${button('reload-run', id, 'Try again')}` : !turn ? '<p class="ol-dim" role="status">Loading the response…</p>' : turn.response ? `<div class="md">${markdown(turn.response)}</div>` : `<p class="ol-dim">${r.state === 'working' ? 'Still working. The response appears here when the turn ends.' : 'No response was captured for this run.'}</p>`) +
      `${waiting ? `<p class="ol-callout" data-wb-key="wait">This pane is waiting on a question and will not be typed at. <a href="#item/${encodeURIComponent(id)}">Read and answer the question</a></p>` : ''}
<form class="ol-reply" data-wb-key="reply" data-reply-run="${esc(id)}"><label for="olf-reply">Reply <small>a new prompt for the same pane${own ? `, under ${esc(model.tasks.get(own).title)}` : ''}</small></label><textarea id="olf-reply" rows="3" data-draft="reply:${esc(id)}" maxlength="16000" placeholder="Follow up…">${esc(val(`reply:${id}`, ''))}</textarea><div class="ol-actions"><button class="primary" type="submit"${dis(`reply:${id}`)}${waiting ? ' disabled' : ''}>Reply</button><span class="ol-dim">Cmd+Enter sends</span></div></form>` +
      section('history', `History <span class="ol-count">${older.length}</span>`, older.length ? `<div class="ol-hists">${older.slice(0, cap).map(historyRow).join('')}</div>${older.length > cap ? `<p class="ol-sec-note" data-wb-key="hmore">${button('hist-more', id, `Show more (${older.length - cap} older)`, 'subtle')}</p>` : ''}` : `<p class="ol-dim">${r.pane_id ? 'Nothing earlier was captured on this pane.' : 'This run names no pane, so it has no thread.'}</p>`) +
      `<details class="ol-facts" data-wb-key="facts"><summary>Details, task and commits</summary>
<dl class="ol-dl"><dt>Harness</dt><dd class="ol-mono">${esc(r.harness)}</dd><dt>Host</dt><dd class="ol-mono">${esc(r.host || 'local')}</dd><dt>Started</dt><dd class="ol-mono">${esc(when(r.started))}</dd><dt>Finished</dt><dd class="ol-mono">${esc(when(r.finished)) || 'not yet'}</dd><dt>Capture</dt><dd>${esc(provenance)}</dd></dl>
<div class="ol-inline"><label>Task<select data-save="run:${esc(id)}:task_id"${prompt ? ' disabled' : ''}>${options([['', via ? `Not assigned (filed under ${model.tasks.get(ownerId).title} ${via})` : 'No task'], ...taskOptions()], own)}</select></label>${prompt ? '<span class="ol-dim">Filed with its prompt; move the prompt to move this run.</span>' : ''}</div>
<h4>Commits <span class="ol-count">${r.commits?.length || 0}</span></h4>${r.commits?.length ? `<ul class="ol-list ol-commits">${r.commits.map(c => `<li><span class="ol-mono">${esc(String(c.sha).slice(0, 7))}</span> <span class="ol-clip">${esc(c.subject)}</span></li>`).join('')}</ul>` : '<p class="ol-dim">No commits were made during this run.</p>'}</details>
<div class="ol-actions" data-wb-key="tools">${button('unread', id, r.unread ? 'Mark read' : 'Mark unread', '', ` data-arg="${r.unread ? '' : '1'}"`)}${button('archive-run', id, r.archived ? 'Unarchive' : 'Archive', '', ` data-arg="${r.archived ? '' : '1'}"`)}</div>`;
  }
  // The Tasks heading: every task that is not archived, subtasks indented, each with Edit, Delete and Done.
  function tasksHTML() {
    if (!data) return loadError ? `<div class="ol-empty"><p>The tasks could not be loaded: ${esc(loadError)}</p><button type="button" data-act="retry">Try again</button></div>` : '<p class="ol-empty" role="status">Loading the tasks…</p>';
    const rows = model.order.filter(t => !model.tasks.get(t.id).archived);
    if (!rows.length) return '<div class="ol-empty"><p>No tasks yet. Type one in the line above and press Enter.</p></div>';
    const open = rows.filter(t => model.tasks.get(t.id).status !== 'done').length;
    return `<p class="ol-dim ol-tasks-note">${open} open, ${rows.length - open} done. Archived tasks are in the Archive view. <kbd>j</kbd><kbd>k</kbd> move <kbd>Enter</kbd> open</p><ul class="ol-tasks">${rows.map(({ id, depth }) => {
      const t = model.tasks.get(id), n = node(`task:${id}`), st = n?.stats || {}, done = t.status === 'done', kids = (n?.children || []).filter(c => c.kind === 'task').length, notes = t.notes?.length || 0, href = outlineHash(`task:${id}`);
      const ti = taskInd().get(id);
      const facts = [strip(ti?.indicators), st.queued ? `${st.queued} queued ${queueWord(queueNote(id))}` : '', done ? state('done') : '', ti?.waiting ? queueLink({ type: 'task', id }, 'Queue') : ''].filter(Boolean).join(' ');
      const confirm = confirming === `deltask:${id}` ? `<div class="ol-trow-confirm" role="alert"><p>Delete <b>${esc(t.title)}</b>? ${notes ? `Its ${plural(notes, 'note')} ${notes === 1 ? 'is' : 'are'} deleted. ` : ''}${kids ? `Its ${plural(kids, 'subtask')} ${kids === 1 ? 'moves' : 'move'} up a level. ` : ''}Its prompts and runs are kept under No task.</p><span class="ol-trow-acts">${button('delete-task', id, 'Confirm delete', 'danger')}${button('keep', id, 'Keep')}</span></div>` : '';
      return `<li class="ol-trow${done ? ' is-done' : ''}${id === rowFocus ? ' is-kfocus' : ''}" data-wb-key="tr:${esc(id)}" data-depth="${Math.min(depth, 8)}"><a class="ol-trow-title" href="${href}">${esc(t.title)}</a><span class="ol-trow-facts">${facts}</span><span class="ol-trow-acts"><a class="ol-trow-edit" href="${href}">Edit</a>${button('ask-delete-task', id, 'Delete', 'subtle')}${button('task-done', id, done ? 'Reopen' : 'Done', 'subtle', ` data-arg="${done ? 'open' : 'done'}"`)}</span>${confirm}</li>`;
    }).join('')}</ul>`;
  }
  function detailHTML() {
    if (view === 'tasks') return tasksHTML();
    const n = selected && (node(selected) || node(review.index.get(selected)?.ref));
    if (view === 'queue' && !n) return `<div class="ol-detail-empty"><p role="status">${data ? 'Nothing is open. The oldest waiting item opens here.' : loadError ? `The queue could not be loaded: ${esc(loadError)}` : 'Loading…'}</p></div>`;
    if (view === 'open' && !n) return `<div class="ol-detail-empty"><p role="status">${data ? 'This line no longer exists.' : loadError ? `It could not be loaded: ${esc(loadError)}` : 'Loading…'}</p>${data ? '<p><a href="#outline/tasks">Back to the tasks</a></p>' : ''}</div>`;
    if (!data || !n) return `<div class="ol-detail-empty"><p>Select a line to see its facts, queue and output.</p><p class="ol-dim">A task is never required. Lines without one stay under No task.</p></div>`;
    return n.kind === 'task' ? taskDetail(n) : n.kind === 'none' ? noneDetail(n) : n.kind === 'prompt' ? promptDetail(n) : runDetail(n);
  }

  // ---- rail --------------------------------------------------------------------------------------------------
  // Task -> (subtask group) -> one row per pane. A row's rolled-up contents are its detail, drawn only while it is expanded;
  // a collapsed task draws only its header and indicator strip.
  function railHTML(groups, cur) {
    if (!data) return `<p class="rt-empty" role="status">${loadError ? 'The tasks could not be loaded.' : 'Loading…'}</p>`;
    if (!groups.length) return '<p class="rt-empty">No open tasks.</p>';
    const here = id => id === cur ? ' aria-current="page"' : '', blank = i => i.kind === 'run' ? 'typed in pane' : 'empty prompt';
    const qlink = (scope, what, n = qCount(scope)) => !n ? '' : `<a class="rt-q" href="${queueHash(scope)}" title="Queue of ${esc(what)}: ${n} waiting" aria-label="Queue of ${esc(what)}: ${n} waiting">${icon('queue', '')}<b>${n}</b></a>`;
    // A document a run reported sits under its turn. A local .md cannot be opened by the browser, so it leads to its run.
    const doc = d => `<li data-wb-key="d:${esc(d.id)}"><a class="rt-leaf rt-leaf-doc${d.unread ? '' : ' is-read'}" href="${d.kind === 'mdoc' ? esc(d.href) : outlineHash(d.run)}"${d.kind === 'mdoc' ? ' target="_blank" rel="noopener"' : ''} title="${esc(d.href)}">${icon('doc', d.unread ? 'Document' : 'Document (read)', d.unread ? '' : ' is-read')}<span class="rt-sum">${esc(d.title)}</span></a></li>`;
    const leaf = i => { const kind = itemKind(i), lit = i.unread || kind === 'working' || kind === 'queued'; return `<li data-wb-key="i:${esc(i.id)}"><a class="rt-leaf${lit ? '' : ' is-read'}" href="${outlineHash(i.id)}"${here(i.id)} title="${esc(i.summary)}">${icon(kind, lit ? ICONS[kind][0] : `${i.word} (read)`, lit ? '' : ' is-read')}<span class="rt-sum">${esc(i.summary) || blank(i)}</span></a></li>${i.docs.map(doc).join('')}`; };
    const row = (r, owner) => {
      const shell = r.pane_kind === 'shell', key = `${owner}|${r.id}`, open = railOpen.has(key), on = cur && r.items.some(i => i.id === cur);
      const name = r.kind !== 'pane' ? r.name : String(r.name || '').trim() ? agentName(r.name, r.pane_id) : `${r.pane_kind || 'pane'} ${r.pane_id.slice(0, 8)}`;
      // A live pane with nothing captured: no item to open, so it leads to the pane itself.
      if (r.empty) return `<li class="rt-row is-dim is-empty" data-wb-key="r:${esc(key)}"><div class="rt-rowhead"><span class="rt-twist rt-twist-gap"></span><a class="rt-item" href="#agent/${encodeURIComponent(r.pane_id)}" title="${esc(name)}: open the pane"><span class="rt-line">${shell ? icon('shell') : ''}<span class="rt-name">${esc(name)}</span>${r.via ? '<span class="rt-via">via session</span>' : ''}</span><span class="rt-sum">${shell ? 'shell' : 'no turns yet'}</span></a>${qlink({ type: 'pane', id: r.pane_id }, name)}</div></li>`;
      return `<li class="rt-row${r.unread ? ' is-unread' : ''}${r.dim ? ' is-dim' : ''}${r.working ? ' is-working' : ''}" data-wb-key="r:${esc(key)}"><div class="rt-rowhead"><button type="button" class="rt-twist" data-rail-act="row" data-id="${esc(key)}" aria-expanded="${open}" aria-label="${open ? 'Hide' : 'Show'} everything of ${esc(name)}">${icon('chev', '')}</button><a class="rt-item" href="${outlineHash(r.lead)}"${on && !open ? ' aria-current="page"' : ''} title="${esc(r.summary)}"><span class="rt-line">${shell ? icon('shell') : ''}<span class="rt-name">${esc(name)}</span>${r.via ? '<span class="rt-via">via session</span>' : ''}${strip(r.indicators)}</span><span class="rt-sum">${esc(r.summary) || blank({ kind: r.lead_kind })}</span></a>${r.kind === 'pane' ? qlink({ type: 'pane', id: r.pane_id }, name) : ''}</div>${open ? `<ul class="rt-detail">${r.items.map(leaf).join('')}</ul>` : ''}</li>`;
    };
    const rows = g => g.rows.length ? `<ul class="rt-items">${g.rows.map(r => row(r, g.id)).join('')}</ul>` : '';
    const head = (g, cls, key, twist) => `<div class="rt-head">${twist}<a class="${cls}${g.unread ? ' is-unread' : ''}" href="${outlineHash(key)}"${here(key)} title="${esc(g.title)}"><span class="rt-title">${esc(g.title)}</span></a>${qlink({ type: 'task', id: g.id }, g.title)}${strip(g.indicators, ' rt-inds')}</div>`;
    return groups.map(g => {
      const shut = railShut.has(g.id), has = g.rows.length || g.groups.length;
      const twist = has ? `<button type="button" class="rt-twist" data-rail-act="task" data-id="${esc(g.id)}" aria-expanded="${!shut}" aria-label="${shut ? 'Expand' : 'Collapse'} ${esc(g.title)}">${icon('chev', '')}</button>` : '<span class="rt-twist rt-twist-gap"></span>';
      return `<section class="rt-group${g.id === 'none' ? ' is-none' : ''}${shut ? ' is-shut' : ''}" data-wb-key="t:${esc(g.id)}">${head(g, 'rt-task', g.id === 'none' ? 'none' : `task:${g.id}`, twist)}${shut ? '' : rows(g) + g.groups.map(sub => `<div class="rt-sub" data-wb-key="g:${esc(sub.id)}">${head(sub, 'rt-subtask', `task:${sub.id}`, '')}${rows(sub)}</div>`).join('')}</section>`;
    }).join('');
  }
  function renderRail() {
    if (!railEl) return;
    const cur = !active ? null : view === 'open' ? selected : view === 'queue' ? qSel : null, groups = (railMemo?.data === data && railMemo.cur === cur ? railMemo : railMemo = { data, cur, groups: railTree(data || {}, new Set(cur ? [cur] : [])) }).groups;
    paint(railEl, railHTML(groups, cur));
    const total = data ? qCount({ type: 'all' }) : 0, on = active && view === 'tasks', onQueue = active && view === 'queue';
    railUnread.textContent = ''; railQueueCount.textContent = total || '';
    railHeading.classList.toggle('active', on); railQueue.classList.toggle('active', onQueue); railQueue.classList.toggle('is-waiting', total > 0);
    if (on) railHeading.setAttribute('aria-current', 'page'); else railHeading.removeAttribute('aria-current');
    if (onQueue) railQueue.setAttribute('aria-current', 'page'); else railQueue.removeAttribute('aria-current');
    if (!active) for (const link of document.querySelectorAll('[data-outline-view].active')) { link.classList.remove('active'); link.removeAttribute('aria-current'); }
    // Opening a line scrolls its row into view, once. A refresh never repeats it, and nothing is expanded or collapsed for you.
    if (!cur || view !== 'open') railShown = null;
    else if (cur !== railShown && data) { railShown = cur; railEl.querySelector('[aria-current]')?.scrollIntoView({ block: 'nearest' }); }
  }
  railEl?.addEventListener('click', e => {
    const b = e.target.closest('[data-rail-act]'); if (!b) return;
    const set = b.dataset.railAct === 'task' ? railShut : railOpen, id = b.dataset.id;
    if (!set.delete(id)) set.add(id);
    if (set === railShut) { try { localStorage.setItem(SHUT_KEY, JSON.stringify([...railShut])); } catch {} }
    renderRail();
  });

  // ---- render ------------------------------------------------------------------------------------------------
  function render() {
    renderRail();
    if (!active) return;
    const full = build();
    model = { ...full, lines: [] };
    const rq = view === 'needs-me', qv = view === 'queue';
    if (qv) {
      // The open item is kept in the list even once read; when nothing is open, or it has gone, the oldest waiting item opens.
      qItems = queueItems(data || {}, qScope, new Set(qSel ? [qSel] : []));
      if (data && !qItems.some(i => i.id === qSel)) qSel = qItems[0]?.id ?? null;
      selected = qSel;
    }
    if (!rq || held !== selected) held = null;
    review = rq || !data ? buildReview(full) : { lines: [], index: new Map(), items: [], total: 0 };
    if (view !== 'open' && selected && !full.index.has(selected) && !review.index.has(selected)) { selected = null; detailOpen = false; }
    model.lines = focus() || qv ? [] : rq ? review.lines : flatten(full.roots.map(n => prune(n)).filter(Boolean));
    root.classList.toggle('is-focus', focus()); root.classList.toggle('is-open', view === 'open');
    root.classList.toggle('is-review', rq); root.classList.toggle('is-queue', qv);
    paint(colsEl, rq ? REVIEW_COLS : COLS);
    paint(keysEl, qv ? '<kbd>j</kbd><kbd>k</kbd> move <kbd>n</kbd> next' : '<kbd>n</kbd> new line <kbd>j</kbd><kbd>k</kbd> move <kbd>Tab</kbd> indent task <kbd>Enter</kbd> open');
    filterEl.hidden = !(rq && filterTask || qv && data);
    if (qv && data) paint(filterEl, chipsHTML());
    else if (rq && filterTask) paint(filterEl, `<span>Only <b>${esc(data ? full.tasks.get(filterTask)?.title || 'a task that no longer exists' : 'one task')}</b> and its subtasks</span><a href="#outline/needs-me">Show everything waiting</a>`);
    $('#ol-title').textContent = VIEWS[view];
    if (document.title !== `tuios inbox · ${VIEWS[view]}`) document.title = `tuios inbox · ${VIEWS[view]}`;
    if (tree.getAttribute('role') !== (qv ? 'listbox' : 'tree')) tree.setAttribute('role', qv ? 'listbox' : 'tree');
    paint(tree, treeHTML());
    if (selected) tree.setAttribute('aria-activedescendant', `ol-${selected}`); else tree.removeAttribute('aria-activedescendant');
    paint(detail, detailHTML());
    root.classList.toggle('is-detail', focus() || Boolean(detailOpen && selected));
    const dest = destination(), prompt = capture.value.trimStart().startsWith('>');
    // The chip says what the next line becomes. A selected prompt or run only lends its task: a plain line is a new task in it, not a child of the prompt.
    const via = node(selected)?.kind, lent = via === 'prompt' || via === 'run';
    paint(chip, dest ? `<span${lent ? ` title="The selected ${via} belongs to this task"` : ''}>${prompt ? 'Prompt for' : lent ? 'New task in' : 'Subtask of'} <b>${esc(model.tasks.get(dest).title)}</b></span><button type="button" data-act="clear-dest" aria-label="Clear destination" tabindex="-1">clear</button>` : `<span class="ol-dim">${prompt ? 'Prompt · No task' : 'Task · top level'}</span>`);
    noticeEl.hidden = !notice;
    if (notice) paint(noticeEl, `<p class="${notice.error ? 'is-error' : ''}" role="${notice.error ? 'alert' : 'status'}">${esc(notice.text)}</p><button type="button" class="subtle" data-act="dismiss">Dismiss</button>`);
    const counts = once('counts', () => {
      const c = { queue: qCount({ type: 'all' }), running: 0, queued: 0, 'no-task': full.none.children.length };
      for (const n of full.index.values()) for (const v of ['running', 'queued']) if (!((n.kind === 'run' || n.kind === 'task') && n.rec.archived) && matchers[v](n)) c[v]++;
      return c;
    });
    for (const link of document.querySelectorAll('[data-outline-view]')) {
      const on = link.dataset.outlineView === view; link.classList.toggle('active', on);
      if (on) link.setAttribute('aria-current', 'true'); else link.removeAttribute('aria-current');
      const count = link.querySelector('span'); if (count) count.textContent = data && link.dataset.outlineView in counts ? counts[link.dataset.outlineView] : '';
    }
    const n = selected && node(selected); if (n?.kind === 'run') ensureRun(n.rec);
    // Opening a line from the rail reads it, once per opening.
    if (view === 'open' && data && opened !== selected) {
      opened = selected; detail.scrollTop = 0;
      if (n?.kind === 'run' && n.rec.unread) write(`read:${n.rec.id}`, () => api(`/turns/${turnId(n.rec.id)}`, { unread: false }, 'PATCH'));
    }
    // The same in the queue: the open item is read once, and stays listed until you move on.
    if (qv && data && qRead !== qSel) {
      qRead = qSel; detail.scrollTop = 0;
      if (n?.kind === 'run' && n.rec.unread) write(`read:${n.rec.id}`, () => api(`/turns/${turnId(n.rec.id)}`, { unread: false }, 'PATCH'));
    }
  }
  function say(text, error = false) {
    notice = { text, error }; clearTimeout(noticeTimer);
    if (!error) noticeTimer = setTimeout(() => { notice = null; render(); }, 6000);
    render();
  }
  // One request at a time; a call made while one is in flight gets a fresh one after it, so a write is always followed by a read
  // that started after it. When the server still holds what the page has (304) nothing is parsed, rebuilt or drawn.
  function fetchOutline() {
    if (inflight) return again ||= inflight.then(() => { again = null; return fetchOutline(); });
    return inflight = (async () => {
      let changed = true;
      try { const next = await apiCached('/outline'); if (next === NOT_MODIFIED) changed = false; else { data = next; memo.clear(); loadError = ''; } stale = false; }
      catch (e) { if (!data) loadError = e.message; else { inflight = null; say(`The outline could not be refreshed: ${e.message}`, true); return; } }
      inflight = null;
      if (changed) render();
    })();
  }
  function ensureRun(run, force) {
    const revision = `${run.state}|${run.finished}|${run.response_captured}`, cached = bodies.get(run.id);
    if (cached?.loading || !force && cached?.revision === revision) return;
    bodies.set(run.id, { ...cached, loading: true, revision });
    api(`/turns/${turnId(run.id)}`).then(turn => bodies.set(run.id, { revision, data: turn }), e => bodies.set(run.id, { revision, error: e.message, data: cached?.data })).then(render);
  }
  // Writes run one after another, so a field saved on blur lands before the button that was clicked to cause the blur.
  function write(key, fn, done, fail) {
    if (busy.has(key)) return writes;
    busy.add(key); render();
    return writes = writes.then(async () => {
      try { const result = await fn(); await fetchOutline(); done?.(result); }
      catch (e) { if (fail) fail(e); else say(e.message, true); await fetchOutline(); }
      finally { busy.delete(key); render(); }
    });
  }
  function reveal(key) { for (let p = review.index.get(key)?.parent; p; p = p.parent) collapsed.delete(p.key); for (let n = node(key)?.parent; n; n = n.parent) { collapsed.delete(n.key); if (!isOpen(n)) expanded.add(n.key); } }
  function select(key, { open = false, scroll = false } = {}) {
    if (key !== selected) { selected = key; destCleared = false; confirming = null; }
    if (open) detailOpen = true;
    held = view === 'needs-me' && review.index.get(key)?.item ? key : null;
    const n = node(key);
    if (n?.kind === 'run' && n.rec.unread && open) write(`read:${n.rec.id}`, () => api(`/turns/${turnId(n.rec.id)}`, { unread: false }, 'PATCH'));
    render();
    if (scroll) document.getElementById(`ol-${key}`)?.scrollIntoView({ block: 'nearest' });
  }
  function toggle(key, open) {
    const n = lineNode(key); if (!n?.children.length) return;
    const next = open ?? !isOpen(n); collapsed.delete(key); expanded.delete(key);
    if (next !== isOpen(n)) (next ? expanded : collapsed).add(key);
    render();
  }

  // ---- actions -----------------------------------------------------------------------------------------------
  function saveField(target, value) {
    const [kind, id, field] = target.split(':'), draftKey = target;
    if (kind === 'task') {
      if (field === 'title' && !String(value).trim()) { drafts.delete(draftKey); render(); return; }
      const body = field === 'parent_id' ? { parent_id: value || null } : field === 'workspace' && /^\d+$/.test(value) ? { workspace: Number(value) } : { [field]: value };
      fieldErrors.delete(target);
      return write(`save:${target}`, () => api(`/tasks/${encodeURIComponent(id)}`, body, 'PATCH'), () => { drafts.delete(draftKey); for (const k of [...drafts.keys()]) if (k.startsWith('fix:') && field === 'repo') drafts.delete(k); if (field === 'parent_id' && value) expanded.add(`task:${value}`); }, e => { fieldErrors.set(target, e.message); if (!TASK_FIELDS.some(([f]) => f === field)) say(e.message, true); });
    }
    if (kind === 'prompt') {
      if (field === 'task_id') return write(`save:${target}`, () => api(`/prompts/${encodeURIComponent(id)}/move`, { task_id: value || null }), () => { if (value) expanded.add(`task:${value}`); reveal(`prompt:${id}`); render(); });
      return write(`save:${target}`, () => api(`/prompts/${encodeURIComponent(id)}`, { [field]: value }, 'PATCH'), () => drafts.delete(draftKey));
    }
    if (kind === 'run') { const run = target.slice(4, target.lastIndexOf(':')); return write(`save:${target}`, () => api(`/turns/${turnId(run)}`, { task_id: value || null }, 'PATCH')); }
  }
  function reparent(direction) {
    const n = node(selected); if (n?.kind !== 'task') return false;
    const siblings = (n.parent ? n.parent.children : model.roots).filter(c => c.kind === 'task'), i = siblings.indexOf(n);
    const target = direction > 0 ? siblings[i - 1]?.rec.id : n.parent ? n.parent.rec.parent_id || null : undefined;
    if (target === undefined) { say(direction > 0 ? 'Nothing above to indent under.' : 'Already at the top level.'); return true; }
    write(`save:task:${n.rec.id}:parent_id`, () => api(`/tasks/${encodeURIComponent(n.rec.id)}`, { parent_id: target }, 'PATCH'), () => { if (target) { expanded.add(`task:${target}`); collapsed.delete(`task:${target}`); } render(); });
    return true;
  }
  async function submitCapture(run) {
    const text = capture.value.trim(); if (!text || busy.has('capture')) return;
    const dest = destination(), isPrompt = text.startsWith('>'), body = isPrompt ? text.slice(1).trim() : text;
    if (!body) return;
    capture.readOnly = true;
    await write('capture', () => isPrompt ? api('/prompts', { body, task_id: dest || null, run: Boolean(run) }) : api('/tasks', { title: body, ...(dest ? { parent_id: dest } : {}) }), result => {
      capture.value = '';
      if (dest) { expanded.add(`task:${dest}`); collapsed.delete(`task:${dest}`); }
      if (isPrompt && run && result && !result.ran) {
        const key = `prompt:${result.prompt.id}`; if (focus()) open(key); else { reveal(key); select(key, { scroll: true }); }
        say(`Saved, not run: ${result.preflight?.blocks?.[0]?.message || 'preflight found a block'}. The fix is beside Run now.`, true);
      } else say(isPrompt ? run ? 'Prompt sent to run.' : `Prompt saved to ${dest ? 'the task queue' : 'the No task queue'}.` : 'Task saved.');
    });
    capture.readOnly = false; if (active && !detailOpen) capture.focus();
    render();
  }
  // From the rail's pages a line opens by its link, so Back and deep links work; in the tree views it is selected in place.
  const open = id => { if (focus() || view === 'queue') location.hash = outlineHash(id); else { reveal(id); select(id, { open: true, scroll: true }); } };
  const acts = {
    select: open,
    'ask-delete-task': id => { confirming = `deltask:${id}`; render(); },
    'delete-task': id => write(`delete-task:${id}`, () => api(`/tasks/${encodeURIComponent(id)}`, {}, 'DELETE'), () => { confirming = null; say('Task deleted.'); }),
    'task-done': (id, b) => write(`task-done:${id}`, () => api('/tasks/update', { ids: [id], set: { status: b.dataset.arg } })),
    twist: id => toggle(id),
    next: id => { if (view === 'queue') return qOpen(nextAfter(qItems, id)); const next = nextAfter(review.items, id); if (next) acts.select(next); },
    'q-more': () => { qShown += CHUNK; render(); },
    'ask-mark-all': () => { confirming = 'markall'; render(); },
    'mark-all': () => {
      const ids = markable(qItems); confirming = null; if (!ids.length) return render();
      write('mark-all', async () => { for (let i = 0; i < ids.length; i += 1000) await api('/items/update', { ids: ids.slice(i, i + 1000), set: { unread: false } }); }, () => say(`Marked ${plural(ids.length, 'turn')} read.`));
    },
    'tree-more': () => { treeShown += CHUNK; render(); },
    'hist-more': id => { histShown.set(id, (histShown.get(id) || CHUNK) + CHUNK); render(); },
    'show-more': id => { showAll.add(id); render(); },
    retry: () => fetchOutline(),
    dismiss: () => { notice = null; render(); },
    back: () => { detailOpen = false; render(); tree.focus(); },
    'clear-dest': () => { destCleared = true; render(); capture.focus(); },
    focus: id => document.getElementById(id)?.focus(),
    'ask-delete': id => { confirming = `delete:${id}`; render(); },
    keep: () => { confirming = null; render(); },
    'clear-field': id => { drafts.delete(id); saveField(id, ''); },
    browse: async id => {
      if (busy.has(`browse:${id}`)) return; busy.add(`browse:${id}`); render();
      try { const { path } = await api('/pick-directory', {}); if (path) saveField(id, path); }
      catch (e) { say(e.message, true); } finally { busy.delete(`browse:${id}`); render(); }
    },
    mode: (id, b) => write(`mode:${id}`, () => api(`/tasks/${encodeURIComponent(id)}`, { queue_mode: b.dataset.arg }, 'PATCH')),
    'run-next': id => write(`run-next:${id}`, () => api(`/tasks/${encodeURIComponent(id)}/run-next`, {}), r => say(r?.prompt ? `Running: ${oneLine(r.prompt.body)}` : 'Started the next prompt.')),
    earlier: (id, b) => write(`earlier:${id}`, () => api(`/prompts/${encodeURIComponent(id)}/move`, { task_id: b.dataset.task || null, before: b.dataset.before })),
    'git-refresh': id => write(`git-refresh:${id}`, () => api('/git/refresh', { task_id: id })),
    'archive-task': (id, b) => write(`archive-task:${id}`, () => api('/tasks/update', { ids: [id], set: { archived: Boolean(b.dataset.arg) } })),
    'archive-run': (id, b) => write(`archive-run:${id}`, () => api(`/turns/${turnId(id)}`, { archived: Boolean(b.dataset.arg) }, 'PATCH')),
    unread: (id, b) => write(`unread:${id}`, () => api(`/turns/${turnId(id)}`, { unread: Boolean(b.dataset.arg) }, 'PATCH')),
    'copy-doc': async (id, b) => { try { await navigator.clipboard.writeText(b.dataset.path); docNote(id, { copied: true }); } catch (e) { docNote(id, { error: `The path could not be copied: ${e.message}` }); } },
    'open-doc': async (id, b) => {
      const key = `open-doc:${id}`; if (busy.has(key)) return; busy.add(key); docNotes.delete(id); render();
      try { await api('/open-file', { path: b.dataset.path, turn: b.dataset.turn }); busy.delete(key); docNote(id, { opened: true }); }
      catch (e) { busy.delete(key); docNote(id, { error: e.message }); }
    },
    'reload-run': id => { const n = node(`run:${id}`); if (n) ensureRun(n.rec, true); },
    run: id => write(`run:${id}`, () => api(`/prompts/${encodeURIComponent(id)}/run`, {}), () => say('Prompt sent to run.')),
    'save-queue': id => write(`save-queue:${id}`, () => api(`/prompts/${encodeURIComponent(id)}`, { body: val(`prompt:${id}:body`, node(`prompt:${id}`)?.rec.body), state: 'queued' }, 'PATCH'), () => { drafts.delete(`prompt:${id}:body`); say('Saved to the queue.'); }),
    // 409 from run and run-next also returns the prompt, now blocked: the refetch after a failed write shows it.
    delete: id => write(`delete:${id}`, () => api(`/prompts/${encodeURIComponent(id)}`, {}, 'DELETE'), () => { confirming = null; say('Prompt deleted.'); }),
    'bulk-move': () => {
      const task = drafts.get('bulk'), lines = model.none.children.map(c => c); if (!task || !lines.length) return;
      write('bulk-move:none', async () => { for (const c of lines) await (c.kind === 'prompt' ? api(`/prompts/${encodeURIComponent(c.rec.id)}/move`, { task_id: task }) : api(`/turns/${turnId(c.rec.id)}`, { task_id: task }, 'PATCH')); }, () => { drafts.delete('bulk'); expanded.add(`task:${task}`); say(`Moved ${plural(lines.length, 'line')}.`); });
    },
  };

  // ---- events ------------------------------------------------------------------------------------------------
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (b && root.contains(b)) { if (!b.disabled) acts[b.dataset.act]?.(b.dataset.id, b); return; }
    const q = e.target.closest('.q-row[data-qkey]');
    if (q) { if (!e.target.closest('a')) qOpen(q.dataset.qkey); return; }
    const line = e.target.closest('.ol-line[data-key]');
    if (line) { if (e.target.closest('a')) return; select(line.dataset.key, { open: !line.classList.contains('is-rgroup') }); if (matchMedia('(min-width: 761px)').matches) tree.focus({ preventScroll: true }); }
  });
  root.addEventListener('input', e => {
    const key = e.target.dataset?.draft; if (key) drafts.set(key, e.target.value);
    if (e.target === capture) render();
  });
  root.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.draft === 'bulk') { drafts.set('bulk', t.value); render(); return; }
    if (t.dataset.save) saveField(t.dataset.save, t.value);
  });
  root.addEventListener('submit', e => {
    e.preventDefault();
    if (e.target.id === 'ol-capture') return void submitCapture(false);
    const id = e.target.dataset.replyRun; if (!id) return;
    const run = node(`run:${id}`)?.rec, body = (drafts.get(`reply:${id}`) || '').trim(); if (!run || !body) return;
    write(`reply:${id}`, () => api('/prompts', { body, task_id: assignedTask(node(`run:${id}`)), target: run.pane_id, run: true }), result => {
      drafts.delete(`reply:${id}`);
      if (result && !result.ran) { open(`prompt:${result.prompt.id}`); say(`Reply saved, not run: ${result.preflight?.blocks?.[0]?.message || 'preflight found a block'}.`, true); }
      else say('Reply sent.');
    });
  });
  // An armed Mark all read is let go by a click anywhere else.
  document.addEventListener('click', e => { if (confirming === 'markall' && !e.target.closest?.('.q-markall')) { confirming = null; render(); } });
  // toggle does not bubble, hence the capture. An opened history row fetches its run once.
  root.addEventListener('toggle', e => { const id = e.target.open && e.target.dataset?.hist, n = id && node(`run:${id}`); if (n) ensureRun(n.rec); }, true);
  // Near the end of a long list the next chunk is drawn.
  tree.addEventListener('scroll', () => {
    if (tree.scrollHeight - tree.scrollTop - tree.clientHeight > 240) return;
    if (view === 'queue') { if (qItems.length > qShown) { qShown += CHUNK; render(); } }
    else if (model.lines.length > treeShown) { treeShown += CHUNK; render(); }
  }, { passive: true });
  // A field the page left alone while you typed in it is drawn again once you leave it.
  root.addEventListener('focusout', () => { painted = new WeakMap(); });
  capture.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); submitCapture(e.metaKey || e.ctrlKey); }
    else if (e.key === 'Backspace' && !capture.value && destination()) { destCleared = true; render(); }
    else if (e.key === 'Escape') { capture.blur(); tree.focus(); }
  });
  detail.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.target.id === 'olf-reply') { e.preventDefault(); e.target.form.requestSubmit(); }
    else if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); e.target.blur(); }
    else if (e.key === 'Escape') { e.target.blur?.(); if (view === 'queue') return; detailOpen = false; render(); tree.focus(); }
  });
  document.addEventListener('keydown', e => {
    if (!active || e.defaultPrevented || document.querySelector('dialog[open]')) return;
    if (e.key === 'Escape' && confirming === 'markall') { confirming = null; render(); return; }
    const t = e.target, typing = t.matches?.('input, textarea, select, [contenteditable]');
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (view === 'queue') {
      // j and k (and the arrows, outside the item's own scroll) open the neighbour, which reads it; n lets the open one go.
      const i = qItems.findIndex(x => x.id === qSel), arrows = t === document.body || tree.contains(t), d = e.key === 'j' || arrows && e.key === 'ArrowDown' ? 1 : e.key === 'k' || arrows && e.key === 'ArrowUp' ? -1 : 0;
      if (d) { e.preventDefault(); if (qItems[i + d]) qOpen(qItems[i + d].id); }
      else if (e.key === 'n' && qSel) { e.preventDefault(); acts.next(qSel); }
      return;
    }
    if (e.key === 'n' || e.key === '/') { e.preventDefault(); detailOpen = false; render(); capture.focus(); return; }
    if (view === 'tasks') {
      const rows = model.order.filter(x => !model.tasks.get(x.id)?.archived).map(x => x.id), i = rows.indexOf(rowFocus), d = e.key === 'j' || e.key === 'ArrowDown' ? 1 : e.key === 'k' || e.key === 'ArrowUp' ? -1 : 0;
      if (d && rows.length) { e.preventDefault(); rowFocus = rows[i < 0 ? d > 0 ? 0 : rows.length - 1 : Math.max(0, Math.min(rows.length - 1, i + d))]; render(); detail.querySelector('.ol-trow.is-kfocus')?.scrollIntoView({ block: 'nearest' }); }
      else if (e.key === 'Enter' && i >= 0 && !t.closest?.('a, button, summary')) { e.preventDefault(); location.hash = outlineHash(`task:${rowFocus}`); }
      return;
    }
    const inTree = t === tree || t === document.body, lines = model.lines.filter(n => n.kind !== 'more'), i = lines.findIndex(n => n.key === selected);
    const rq = view === 'needs-me';
    // In the review queue j and k step over items only and open each one, which is what reads it.
    const move = d => {
      let next = lines[Math.max(0, Math.min(lines.length - 1, i < 0 ? 0 : i + d))];
      if (rq) { next = null; for (let k = i < 0 ? 0 : i + d; k >= 0 && k < lines.length; k += i < 0 ? 1 : d) if (lines[k].kind !== 'rgroup') { next = lines[k]; break; } }
      if (next) { e.preventDefault(); select(next.key, { scroll: true, open: rq }); }
    };
    if (e.key === 'j') return move(1);
    if (e.key === 'k') return move(-1);
    if (!inTree) return;
    if (e.key === 'ArrowDown') return move(1);
    if (e.key === 'ArrowUp') return move(-1);
    const n = rq ? review.index.get(selected) : node(selected); if (!n) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); if (isOpen(n)) toggle(n.key, false); else if (n.parent) select(n.parent.key, { scroll: true }); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); toggle(n.key, true); }
    else if (e.key === 'Enter') { e.preventDefault(); select(n.key, { open: true }); (detail.querySelector('input, textarea, select') || detail).focus(); }
    else if (e.key === 'Tab' && t === tree && n.kind === 'task') { if (reparent(e.shiftKey ? -1 : 1)) e.preventDefault(); }
  });

  // ---- app hooks ---------------------------------------------------------------------------------------------
  function enter(next) {
    const was = active; active = supports(next);
    root.hidden = !active;
    if (active) {
      const task = next.view === 'needs-me' && next.task || null, v = next.view === 'open' && !next.sel ? 'tasks' : next.view in VIEWS ? next.view : 'everything';
      if (v === 'open') {
        if (view !== 'open' || selected !== next.sel) { opened = null; confirming = null; destCleared = false; }
        view = v; selected = next.sel; filterTask = null; detailOpen = true;
      } else if (v === 'queue') {
        const scope = next.scope || { type: 'all' };
        if (view !== 'queue' || !sameScope(scope, qScope)) { qSel = null; qRead = null; qShown = CHUNK; confirming = null; destCleared = false; }
        view = v; qScope = scope; filterTask = null; detailOpen = false;
      } else if (v !== view || task !== filterTask) { if (v === 'tasks') selected = null; view = v; filterTask = task; detailOpen = false; confirming = null; treeShown = CHUNK; }
    }
    render();
    if ((active && !was || stale) && !inflight) fetchOutline().catch(report);
  }
  // The rail's tree is on every page, so every live event refetches; all of it lands through patchHTML.
  function update() { return fetchOutline(); }
  root.hidden = true;
  return { supports, enter, update, render };
}
