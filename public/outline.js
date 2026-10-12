// The task-first outline: one tree of tasks, prompts and runs, a capture line, and the selected line's detail.
// Reads GET /api/outline; every write refetches it. A refresh only ever morphs the DOM (patchHTML), so focus,
// drafts, selection, scroll and collapsed state survive live updates.
import { api, esc, agentName } from '/pages.js';
import { patchHTML } from '/workbench.js';
import { markdown } from '/markdown.js';

const VIEWS = { everything: 'Everything', 'needs-me': 'Needs me', running: 'Running', queued: 'Queued', 'no-task': 'No task', archive: 'Archive' };
const TASK_FIELDS = [['repo', 'Repo', 'dir'], ['branch', 'Branch', 'text'], ['session', 'Home session', 'text'], ['workspace', 'Home workspace', 'text'], ['harness', 'Harness', 'harness'], ['model', 'Model', 'text'], ['queue_mode', 'Queue mode', 'mode']];
const RUN_CAP = 3, DONE_CAP = 3;
const when = value => value ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const oneLine = text => String(text ?? '').trim().split('\n')[0];
const turnId = key => encodeURIComponent(String(key).replace(/^turn:/, ''));
const state = (word, cls = word) => word ? `<span class="ol-state s-${esc(cls)}">${esc(String(word).replace(/_/g, ' '))}</span>` : '';

export function createOutline({ report }) {
  const shell = document.querySelector('.workbench-shell');
  const root = document.createElement('section');
  root.id = 'outline-root'; root.setAttribute('aria-label', 'Outline');
  root.innerHTML = `<div class="ol-center">
<header class="ol-head"><h1 id="ol-title">Everything</h1><p class="ol-keys"><kbd>n</kbd> new line <kbd>j</kbd><kbd>k</kbd> move <kbd>Tab</kbd> indent task <kbd>Enter</kbd> open</p></header>
<form class="ol-capture" id="ol-capture" autocomplete="off"><span class="ol-chip" id="ol-chip"></span><input id="ol-capture-input" aria-label="New task, or a prompt when it starts with &gt;" aria-describedby="ol-capture-hint" placeholder="A task, or > a prompt" maxlength="16000" enterkeyhint="done"><span class="ol-capture-hint" id="ol-capture-hint">Enter saves · Cmd+Enter runs a prompt</span></form>
<div id="ol-notice" class="ol-notice" hidden></div>
<div class="ol-cols" aria-hidden="true"><span></span><span>Queue</span><span>State</span><span>Unread</span><span>Branch</span><span>Pull request</span></div>
<div id="ol-tree" class="ol-tree" role="tree" tabindex="0" aria-label="Tasks, prompts and runs"></div>
</div>
<aside id="ol-detail" class="ol-detail" aria-label="Selected line"></aside>`;
  shell.append(root);
  const $ = s => root.querySelector(s);
  const tree = $('#ol-tree'), detail = $('#ol-detail'), capture = $('#ol-capture-input'), noticeEl = $('#ol-notice'), chip = $('#ol-chip');

  let active = false, view = 'everything', data = null, loadError = '', stale = true, version = 0;
  let selected = null, destCleared = false, detailOpen = false, confirming = null, notice = null, noticeTimer;
  const collapsed = new Set(), expanded = new Set(), showAll = new Set(), drafts = new Map(), busy = new Set(), bodies = new Map(), fieldErrors = new Map();
  let model = { roots: [], index: new Map(), lines: [], tasks: new Map(), order: [] };
  let writes = Promise.resolve();

  const supports = r => r?.kind === 'outline';

  // ---- model -------------------------------------------------------------------------------------------------
  function build() {
    const tasks = new Map((data?.tasks || []).map(t => [t.id, t])), index = new Map(), order = [];
    const by = (rows, key) => { const m = new Map(); for (const r of rows) { const k = key(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };
    const prompts = new Map((data?.prompts || []).map(p => [p.id, p]));
    const promptsBy = by([...(data?.prompts || [])].sort((a, b) => a.position - b.position), p => tasks.has(p.task_id) ? p.task_id : '');
    const runs = [...(data?.runs || [])].sort((a, b) => String(b.started).localeCompare(String(a.started)));
    const runsByPrompt = by(runs.filter(r => prompts.has(r.prompt_id)), r => r.prompt_id);
    const runsByTask = by(runs.filter(r => !prompts.has(r.prompt_id)), r => tasks.has(r.task_id) ? r.task_id : '');
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
  const taskOf = key => { const n = node(key); return !n ? null : n.kind === 'task' ? n.rec.id : n.kind === 'none' ? null : model.tasks.has(n.rec.task_id) ? n.rec.task_id : null; };
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
      facts = fact('Queue', esc(queue)) + fact('State', stateWord) + unreadFact + fact('Branch', own && branch?.value ? `<span class="ol-mono${branch.from === 'self' ? '' : ' is-inherited'}">${esc(branch.value)}</span>` : '') + fact('Pull request', pr);
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
  function treeHTML() {
    if (!data) return loadError ? `<div class="ol-empty"><p>The outline could not be loaded: ${esc(loadError)}</p><button type="button" data-act="retry">Try again</button></div>` : '<p class="ol-empty" role="status">Loading the outline…</p>';
    const empty = !data.tasks.length && !data.prompts.length && !data.runs.length;
    if (empty) return `<div class="ol-empty"><p>Nothing here yet. Type a line above and press Enter. It is saved as it is; nothing else is asked.</p>
<div class="ol-line is-task is-example" data-depth="0"><div class="ol-main"><span class="ol-twist-gap"></span><span class="ol-text">Fix the parser</span><span class="ol-tag">example · plain text makes a task</span></div></div>
<div class="ol-line is-prompt is-example" data-depth="1"><div class="ol-main"><span class="ol-twist-gap"></span><span class="ol-mark">&gt;</span><span class="ol-text">add tests for nested quotes</span><span class="ol-tag">example · starting with &gt; makes a prompt</span></div></div></div>`;
    const html = model.lines.map(lineHTML).join('');
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
  const head = (kind, extra = '') => `<div class="ol-detail-head"><button type="button" class="ol-back" data-act="back">Back to outline</button><p class="ol-kind">${kind}${extra}</p></div>`;

  function taskDetail(n) {
    const t = n.rec, id = t.id, own = t.own || {}, res = t.resolved || {}, parent = model.tasks.get(t.parent_id);
    const rows = TASK_FIELDS.map(([f, label, type]) => {
      const r = res[f] || { value: '', from: 'none' }, mine = own[f] !== '' && own[f] != null, key = `task:${id}:${f}`, fid = `olf-${f}`;
      const inherited = !mine && r.value !== '' && r.value != null ? String(r.value) : '';
      let control;
      if (type === 'harness') control = harnessSelect(key, mine ? own[f] : '', r, fid);
      else if (type === 'mode') control = `<select id="${fid}" data-save="${key}">${options([['', `Inherit${inherited ? `: ${inherited} ${sourceNote(r)}` : ''}`], ['manual', 'manual'], ['auto', 'auto']], mine ? own[f] : '')}</select>`;
      else control = `<input id="${fid}" class="${f === 'repo' ? '' : 'ol-mono'}" data-draft="${key}" data-save="${key}" value="${esc(val(key, mine ? own[f] : ''))}" placeholder="${esc(inherited || 'not set')}" autocomplete="off" spellcheck="false">${type === 'dir' ? button('browse', key, 'Browse…') : ''}`;
      const note = mine ? button('clear-field', key, 'Clear', 'subtle', ` aria-label="Clear ${label}, inherit instead"`) : `<span class="ol-src">${esc(sourceNote(r)) || 'not set'}</span>`;
      const problem = fieldErrors.get(key);
      return `<div class="ol-field${mine ? '' : ' is-inherited'}" data-wb-key="f:${f}"><label for="${fid}">${label}</label><div class="ol-field-edit">${control}</div>${note}${problem ? `<p class="ol-error-text ol-field-error" role="alert">${esc(problem)}</p>` : ''}</div>`;
    }).join('');
    const queue = (data.prompts || []).filter(p => p.task_id === id && ['queued', 'blocked', 'running'].includes(p.state)).sort((a, b) => a.position - b.position);
    const mode = res.queue_mode?.value || 'manual', modeNote = sourceNote(res.queue_mode);
    const modeSwitch = `<div class="ol-switch" role="group" aria-label="Queue mode">${['manual', 'auto'].map(m => `<button type="button" data-act="mode" data-id="${esc(id)}" data-arg="${m}" aria-pressed="${mode === m}"${dis(`mode:${id}`)}>${m === 'manual' ? 'Manual' : 'Auto'}</button>`).join('')}</div>`;
    const panes = (data.panes || []).filter(p => p.task_id === id && p.state !== 'closed'), g = t.git || { state: 'none' };
    const gitFacts = g.state === 'none' ? '<p class="ol-dim">No repo is set for this task.</p>' : g.state === 'not_a_repo' ? `<p class="ol-dim">${esc(res.repo?.value || 'The directory')} is not a git repository.</p>` : `<dl class="ol-dl"><dt>HEAD</dt><dd class="ol-mono">${esc(g.head || 'unknown')}${g.sha ? ` <span class="ol-dim">${esc(String(g.sha).slice(0, 7))}</span>` : ''}</dd><dt>Working tree</dt><dd>${g.dirty ? 'uncommitted changes' : 'clean'}</dd><dt>Pull request</dt><dd>${g.pr ? `<a href="${esc(g.pr.url)}" target="_blank" rel="noreferrer">PR ${esc(g.pr.number)}</a> ${state(g.pr.state, 'plain')} ${state(g.pr.checks === 'none' ? 'no checks' : `checks ${g.pr.checks}`, g.pr.checks)}` : g.pr_loading ? 'Checking…' : g.pr_state === 'unavailable' ? 'Not available: gh could not be reached' : 'None for this branch'}</dd></dl>${g.commits?.length ? `<ul class="ol-list ol-commits">${g.commits.map(c => `<li><span class="ol-mono">${esc(String(c.sha).slice(0, 7))}</span> <span class="ol-clip">${esc(c.subject)}</span> <span class="ol-mono ol-dim">${esc(when(c.at))}</span></li>`).join('')}</ul>` : ''}`;
    const notes = (t.notes || []).map(note => `<li>${esc(typeof note === 'string' ? note : note.body ?? note.text ?? JSON.stringify(note))}${note?.created ? ` <span class="ol-mono ol-dim">${esc(when(note.created))}</span>` : ''}</li>`).join('');
    return head('Task', (t.source === 'omp-todo' ? ' · from omp todo' : '') + (t.archived ? ' · archived' : '')) +
      `<div class="ol-title-row" data-wb-key="title"><label class="ol-visually-hidden" for="olf-title">Title</label><input id="olf-title" class="ol-title-input" data-draft="task:${esc(id)}:title" data-save="task:${esc(id)}:title" value="${esc(val(`task:${id}:title`, t.title))}" maxlength="200"></div>
<div class="ol-inline" data-wb-key="meta"><label>Status<select data-save="task:${esc(id)}:status">${options(['open', 'active', 'done'].map(s => [s, s]), t.status)}</select></label><label>Move under<select data-save="task:${esc(id)}:parent_id">${options([['', 'Top level'], ...taskOptions(subtreeIds(n))], t.parent_id || '')}</select></label></div>` +
      section('facts', 'Facts', `<p class="ol-dim ol-sec-note">${parent ? `Empty fields are inherited from ${esc(parent.title)}.` : 'Empty fields fall back to the app defaults.'}</p>${rows}`) +
      section('queue', `Queue <span class="ol-count">${queue.length}</span>`, `${queueRows(queue, id)}<p class="ol-dim ol-sec-note">${mode === 'auto' ? 'Auto: each next prompt runs when the pane comes to rest; start the first with Run next. A blocked prompt holds the queue.' : 'Manual: nothing runs until you press Run.'}${modeNote ? ` ${esc(modeNote)}` : ''}</p>`, `${modeSwitch}${button('run-next', id, 'Run next', 'primary', queue.some(p => p.state === 'queued') ? '' : ' disabled')}`) +
      section('panes', `Panes <span class="ol-count">${panes.length}</span>`, panes.length ? `<ul class="ol-list">${panes.map(p => `<li><a href="#agent/${encodeURIComponent(p.id)}">${esc(agentName(p.name, p.id))}</a> <span class="ol-mono">${esc(p.harness || p.kind)}</span> ${state(p.state)} <span class="ol-mono ol-dim">${esc([p.host, p.session].filter(Boolean).join(' / '))}</span></li>`).join('')}</ul>` : '<p class="ol-dim">No panes are assigned. Running a prompt launches one in the repo.</p>') +
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
    return head('Prompt', ` · ${state(p.state)}`) +
      `<div data-wb-key="body"><label for="olf-body">Prompt text</label><textarea id="olf-body" rows="6" data-draft="prompt:${esc(id)}:body" data-save="prompt:${esc(id)}:body" maxlength="16000" placeholder="What should the agent do?">${esc(val(`prompt:${id}:body`, p.body))}</textarea>${p.error ? `<p class="ol-error-text">Last attempt: ${esc(p.error)}</p>` : ''}</div>
<div class="ol-inline" data-wb-key="where"><label>Task<select data-save="prompt:${esc(id)}:task_id">${options([['', 'No task'], ...taskOptions()], taskId)}</select></label><label>Target pane<select data-save="prompt:${esc(id)}:target">${options(paneOptions(p.target), p.target)}</select></label></div>
<div class="ol-inline" data-wb-key="how"><label>Harness${harnessSelect(`prompt:${id}:harness`, p.harness, res.harness, 'olf-harness')}</label><label>Model<input class="ol-mono" data-draft="prompt:${esc(id)}:model" data-save="prompt:${esc(id)}:model" value="${esc(val(`prompt:${id}:model`, p.model))}" placeholder="${esc(res.model?.value ? `${res.model.value} ${sourceNote(res.model)}` : 'harness default')}" autocomplete="off" spellcheck="false"></label></div>
<p class="ol-dim ol-sec-note" data-wb-key="resolved">Runs in <span class="ol-mono">${esc(res.repo?.value || 'no repo')}</span> ${esc(sourceNote(res.repo) === 'not set' ? '' : sourceNote(res.repo))} on <span class="ol-mono">${esc(res.branch?.value || 'no branch')}</span></p>` +
      section('blocks', `Blocks <span class="ol-count">${pf.blocks.length}</span>`, blocks) + section('warns', `Warnings <span class="ol-count">${pf.warns.length}</span>`, warns) +
      `<div class="ol-actions" data-wb-key="run">${button('run', id, busy.has(`run:${id}`) ? 'Starting…' : 'Run now', 'primary', pf.blocks.length || p.state === 'running' ? ' disabled' : '')}${button('save-queue', id, ['running', 'blocked'].includes(p.state) ? 'Back to queue' : pf.blocks.length ? 'Save to queue instead' : 'Save to queue')}${del ? `${button('delete', id, 'Confirm delete', 'danger')}${button('keep', id, 'Keep')}` : button('ask-delete', id, 'Delete', 'danger')}</div>${pf.blocks.length ? '<p class="ol-dim ol-sec-note">Run now is off until each block above is fixed. The prompt is kept either way.</p>' : ''}` +
      section('runs', `Runs <span class="ol-count">${runs.length}</span>`, runs.length ? `<ul class="ol-list">${runs.map(runRow).join('')}</ul>` : '<p class="ol-dim">Not run yet.</p>');
  }
  function runDetail(n) {
    const r = n.rec, id = r.id, body = bodies.get(id), pane = (data.panes || []).find(p => p.id === r.pane_id), taskId = model.tasks.has(r.task_id) ? r.task_id : '';
    const waiting = r.state === 'needs_input' || pane?.state === 'needs_input', prompt = model.prompts.get(r.prompt_id), turn = body?.data;
    const provenance = [r.source ? `Source: ${r.source}` : 'Source not recorded', r.response_captured === false ? 'response not captured' : '', prompt ? '' : 'typed straight into the pane'].filter(Boolean).join(' · ');
    return head('Run', ` · ${state(r.state)}${r.unread ? ' · <b class="ol-unread">Unread</b>' : ''}`) +
      `<dl class="ol-dl" data-wb-key="facts"><dt>Harness</dt><dd class="ol-mono">${esc(r.harness)}</dd><dt>Pane</dt><dd>${pane ? `<a href="#agent/${encodeURIComponent(pane.id)}">${esc(agentName(r.pane_name, r.pane_id || ''))}</a>` : `${esc(agentName(r.pane_name, r.pane_id || ''))} <span class="ol-dim">(closed)</span>`} <span class="ol-mono ol-dim">${esc(r.host || '')}</span></dd><dt>Started</dt><dd class="ol-mono">${esc(when(r.started))}</dd><dt>Finished</dt><dd class="ol-mono">${esc(when(r.finished)) || 'not yet'}</dd><dt>Capture</dt><dd>${esc(provenance)}</dd></dl>
${waiting ? `<p class="ol-callout" data-wb-key="wait">This pane is waiting on a question and will not be typed at. <a href="#item/${encodeURIComponent(id)}">Read and answer the question</a></p>` : ''}
<div class="ol-inline" data-wb-key="tools"><label>Task<select data-save="run:${esc(id)}:task_id">${options([['', 'No task'], ...taskOptions()], taskId)}</select></label><div class="ol-actions">${button('unread', id, r.unread ? 'Mark read' : 'Mark unread', '', ` data-arg="${r.unread ? '' : '1'}"`)}${button('archive-run', id, r.archived ? 'Unarchive' : 'Archive', '', ` data-arg="${r.archived ? '' : '1'}"`)}</div></div>` +
      section('prompt', 'Prompt', `<pre class="ol-pre">${esc(turn?.prompt ?? r.prompt ?? '')}</pre>`, prompt ? button('select', `prompt:${prompt.id}`, 'Open the prompt', 'subtle') : '') +
      section('response', 'Response', body?.error ? `<p class="ol-error-text">The response could not be read: ${esc(body.error)}</p>${button('reload-run', id, 'Try again')}` : !turn ? '<p class="ol-dim" role="status">Loading the response…</p>' : turn.response ? `<div class="md">${markdown(turn.response)}</div>` : `<p class="ol-dim">${r.state === 'working' ? 'Still working. The response appears here when the turn ends.' : 'No response was captured for this run.'}</p>`) +
      section('commits', `Commits <span class="ol-count">${r.commits?.length || 0}</span>`, r.commits?.length ? `<ul class="ol-list ol-commits">${r.commits.map(c => `<li><span class="ol-mono">${esc(String(c.sha).slice(0, 7))}</span> <span class="ol-clip">${esc(c.subject)}</span></li>`).join('')}</ul>` : '<p class="ol-dim">No commits were made during this run.</p>') +
      `<form class="ol-reply" data-wb-key="reply" data-reply-run="${esc(id)}"><label for="olf-reply">Reply <small>a new prompt for the same pane${taskId ? `, under ${esc(model.tasks.get(taskId).title)}` : ''}</small></label><textarea id="olf-reply" rows="3" data-draft="reply:${esc(id)}" maxlength="16000" placeholder="Follow up…">${esc(val(`reply:${id}`, ''))}</textarea><div class="ol-actions"><button class="primary" type="submit"${dis(`reply:${id}`)}${waiting ? ' disabled' : ''}>Send reply</button><span class="ol-dim">Cmd+Enter sends</span></div></form>`;
  }
  function detailHTML() {
    const n = selected && node(selected);
    if (!data || !n) return `<div class="ol-detail-empty"><p>Select a line to see its facts, queue and output.</p><p class="ol-dim">A task is never required. Lines without one stay under No task.</p></div>`;
    return n.kind === 'task' ? taskDetail(n) : n.kind === 'none' ? noneDetail(n) : n.kind === 'prompt' ? promptDetail(n) : runDetail(n);
  }

  // ---- render ------------------------------------------------------------------------------------------------
  function render() {
    if (!active) return;
    const full = build();
    model = { ...full, lines: [] };
    if (selected && !full.index.has(selected)) { selected = null; detailOpen = false; }
    model.lines = flatten(full.roots.map(n => prune(n)).filter(Boolean));
    $('#ol-title').textContent = VIEWS[view];
    document.title = `tuios inbox · ${VIEWS[view]}`;
    patchHTML(tree, treeHTML());
    if (selected) tree.setAttribute('aria-activedescendant', `ol-${selected}`); else tree.removeAttribute('aria-activedescendant');
    patchHTML(detail, detailHTML());
    root.classList.toggle('is-detail', Boolean(detailOpen && selected));
    const dest = destination(), prompt = capture.value.trimStart().startsWith('>');
    patchHTML(chip, dest ? `<span>${prompt ? 'Prompt for' : 'Subtask of'} <b>${esc(model.tasks.get(dest).title)}</b></span><button type="button" data-act="clear-dest" aria-label="Clear destination" tabindex="-1">clear</button>` : `<span class="ol-dim">${prompt ? 'Prompt · No task' : 'Task · top level'}</span>`);
    noticeEl.hidden = !notice;
    if (notice) patchHTML(noticeEl, `<p class="${notice.error ? 'is-error' : ''}" role="${notice.error ? 'alert' : 'status'}">${esc(notice.text)}</p><button type="button" class="subtle" data-act="dismiss">Dismiss</button>`);
    const counts = { 'needs-me': 0, running: 0, queued: 0, 'no-task': full.none.children.length };
    for (const n of full.index.values()) for (const v of ['needs-me', 'running', 'queued']) if (!((n.kind === 'run' || n.kind === 'task') && n.rec.archived) && matchers[v](n)) counts[v]++;
    for (const link of document.querySelectorAll('[data-outline-view]')) {
      const on = link.dataset.outlineView === view; link.classList.toggle('active', on);
      if (on) link.setAttribute('aria-current', 'true'); else link.removeAttribute('aria-current');
      const count = link.querySelector('span'); if (count) count.textContent = data && link.dataset.outlineView in counts ? counts[link.dataset.outlineView] : '';
    }
    const n = selected && node(selected); if (n?.kind === 'run') ensureRun(n.rec);
  }
  function say(text, error = false) {
    notice = { text, error }; clearTimeout(noticeTimer);
    if (!error) noticeTimer = setTimeout(() => { notice = null; render(); }, 6000);
    render();
  }
  async function fetchOutline() {
    const v = ++version;
    try { const next = await api('/outline'); if (v !== version) return; data = next; loadError = ''; stale = false; }
    catch (e) { if (v !== version) return; if (!data) loadError = e.message; else say(`The outline could not be refreshed: ${e.message}`, true); }
    render();
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
  function reveal(key) { for (let n = node(key)?.parent; n; n = n.parent) { collapsed.delete(n.key); if (!isOpen(n)) expanded.add(n.key); } }
  function select(key, { open = false, scroll = false } = {}) {
    if (key !== selected) { selected = key; destCleared = false; confirming = null; }
    if (open) detailOpen = true;
    const n = node(key);
    if (n?.kind === 'run' && n.rec.unread && open) write(`read:${n.rec.id}`, () => api(`/turns/${turnId(n.rec.id)}`, { unread: false }, 'PATCH'));
    render();
    if (scroll) document.getElementById(`ol-${key}`)?.scrollIntoView({ block: 'nearest' });
  }
  function toggle(key, open) {
    const n = node(key); if (!n?.children.length) return;
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
        const key = `prompt:${result.prompt.id}`; reveal(key); select(key, { scroll: true });
        say(`Saved, not run: ${result.preflight?.blocks?.[0]?.message || 'preflight found a block'}. The fix is beside Run now.`, true);
      } else say(isPrompt ? run ? 'Prompt sent to run.' : `Prompt saved to ${dest ? 'the task queue' : 'the No task queue'}.` : 'Task saved.');
    });
    capture.readOnly = false; if (active && !detailOpen) capture.focus();
    render();
  }
  const acts = {
    select: id => { reveal(id); select(id, { open: true, scroll: true }); },
    twist: id => toggle(id),
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
    const line = e.target.closest('.ol-line[data-key]');
    if (line) { select(line.dataset.key, { open: true }); if (matchMedia('(min-width: 761px)').matches) tree.focus({ preventScroll: true }); }
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
    write(`reply:${id}`, () => api('/prompts', { body, task_id: run.task_id || null, target: run.pane_id, run: true }), result => {
      drafts.delete(`reply:${id}`);
      if (result && !result.ran) { const key = `prompt:${result.prompt.id}`; reveal(key); select(key, { open: true, scroll: true }); say(`Reply saved, not run: ${result.preflight?.blocks?.[0]?.message || 'preflight found a block'}.`, true); }
      else say('Reply sent.');
    });
  });
  capture.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); submitCapture(e.metaKey || e.ctrlKey); }
    else if (e.key === 'Backspace' && !capture.value && destination()) { destCleared = true; render(); }
    else if (e.key === 'Escape') { capture.blur(); tree.focus(); }
  });
  detail.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.target.id === 'olf-reply') { e.preventDefault(); e.target.form.requestSubmit(); }
    else if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); e.target.blur(); }
    else if (e.key === 'Escape') { e.target.blur?.(); detailOpen = false; render(); tree.focus(); }
  });
  document.addEventListener('keydown', e => {
    if (!active || e.defaultPrevented || document.querySelector('dialog[open]')) return;
    const t = e.target, typing = t.matches?.('input, textarea, select, [contenteditable]');
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'n' || e.key === '/') { e.preventDefault(); detailOpen = false; render(); capture.focus(); return; }
    const inTree = t === tree || t === document.body, lines = model.lines.filter(n => n.kind !== 'more'), i = lines.findIndex(n => n.key === selected);
    const move = d => { const next = lines[Math.max(0, Math.min(lines.length - 1, i < 0 ? 0 : i + d))]; if (next) { e.preventDefault(); select(next.key, { scroll: true }); } };
    if (e.key === 'j') return move(1);
    if (e.key === 'k') return move(-1);
    if (!inTree) return;
    if (e.key === 'ArrowDown') return move(1);
    if (e.key === 'ArrowUp') return move(-1);
    const n = node(selected); if (!n) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); if (isOpen(n)) toggle(n.key, false); else if (n.parent) select(n.parent.key, { scroll: true }); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); toggle(n.key, true); }
    else if (e.key === 'Enter') { e.preventDefault(); select(n.key, { open: true }); (detail.querySelector('input, textarea, select') || detail).focus(); }
    else if (e.key === 'Tab' && t === tree && n.kind === 'task') { if (reparent(e.shiftKey ? -1 : 1)) e.preventDefault(); }
  });

  // ---- app hooks ---------------------------------------------------------------------------------------------
  function enter(next) {
    const was = active; active = supports(next);
    root.hidden = !active;
    if (!active) return;
    if (next.view !== view) { view = next.view in VIEWS ? next.view : 'everything'; detailOpen = false; }
    render();
    if (!was || stale) fetchOutline().catch(report);
  }
  function update() { if (active) return fetchOutline(); stale = true; }
  root.hidden = true;
  return { supports, enter, update, render };
}
