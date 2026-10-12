import * as M from './model.js';

const state = M.createState();
const ui = { view: 'everything', sel: { kind: 'task', id: 'parser' }, destCleared: false, collapsed: new Set(M.DEFAULT_COLLAPSED), editing: null, flash: null, detailDirty: false, bulkTarget: '' };
let rows = [];

const $ = (sel, root = document) => root.querySelector(sel);
const el = { views: $('#views'), outline: $('#outline'), detail: $('#detail'), input: $('#capture-input'), dest: $('#dest'), status: $('#status'), title: $('#view-title'), scroller: $('#scroller'), dirFallback: $('#dir-fallback') };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const VIEWS = [['everything', 'Everything'], ['needs', 'Needs me'], ['running', 'Running'], ['queued', 'Queued'], ['none', 'No task'], ['archive', 'Archive']];
const CHEVRON = '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
const CROSS = '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.5 2.5l7 7m0-7l-7 7" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
const word = w => `<span class="st st-${String(w).replace(/[\s_]/g, '-')}">${esc(String(w).replace(/_/g, ' '))}</span>`;
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const sourceLabel = r => `${r.source === 'pane' ? 'pane capture' : r.source}${r.partial ? ', partial' : ''}`;
const taskTitle = id => M.taskById(state, id)?.title ?? 'No task';
const selIs = (kind, id) => ui.sel?.kind === kind && ui.sel.id === id;
const say = msg => { el.status.textContent = msg; };

// ---------- destination of the capture line ----------
function destTaskId() {
  if (ui.destCleared || !ui.sel) return null;
  if (ui.sel.kind === 'task') return ui.sel.id;
  if (ui.sel.kind === 'prompt') return M.promptById(state, ui.sel.id)?.task_id ?? null;
  if (ui.sel.kind === 'run') return M.promptById(state, M.runById(state, ui.sel.id)?.prompt_id)?.task_id ?? null;
  return null;
}
function renderChip() {
  const id = destTaskId();
  el.dest.innerHTML = id
    ? `<span class="chip-text">Under <b>${esc(taskTitle(id))}</b></span><button type="button" data-act="clear-dest" aria-label="Clear destination, save at top level">${CROSS}</button>`
    : '<span class="chip-text">Top level · No task</span>';
  el.dest.classList.toggle('is-set', Boolean(id));
}

// ---------- rail ----------
function renderRail() {
  const counts = M.viewCounts(state);
  el.views.innerHTML = VIEWS.map(([id, label]) => `<button type="button" class="view${ui.view === id ? ' active' : ''}" data-view="${id}"${ui.view === id ? ' aria-current="page"' : ''}><span>${label}</span><span class="count">${counts[id]}</span></button>`).join('');
  el.title.textContent = VIEWS.find(v => v[0] === ui.view)[1];
}

// ---------- outline ----------
function lineHtml(row, index) {
  const facts = { queued: '', state: '', unread: '', branch: '', pr: '' };
  let lead = '', unread = false, kindWord = '';
  if (row.kind === 'task') {
    const t = M.taskById(state, row.id), f = M.taskFacts(state, t);
    const branch = M.resolveTask(state, t.id, 'branch'), repo = M.resolveTask(state, t.id, 'repo'), home = M.resolveTask(state, t.id, 'home');
    kindWord = 'Task';
    unread = f.unread > 0;
    lead = `<span class="mark mark-task" aria-hidden="true"></span><span class="title">${esc(t.title)}</span>${t.origin ? `<span class="tag">from ${esc(t.origin)}</span>` : ''}`;
    facts.queued = f.queued ? `${f.queued} queued` : '';
    facts.state = f.word ? word(f.word) : '';
    facts.unread = f.unread ? `<b class="unread">${f.unread} unread</b>` : '';
    facts.branch = branch.value ? `<span class="mono${branch.source === 'own' ? '' : ' dim'}">${esc(branch.value)}</span>` : '';
    facts.pr = t.pr ? `<span class="mono">PR ${t.pr.number}</span> ${word(t.pr.checks === 'none' ? 'no checks' : t.pr.checks)}`
      : !t.parent_id || t.branch ? `<span class="dim">${repo.value ? 'no PR' : home.value ? 'not a repo' : 'no repo'}</span>` : '';
  } else if (row.kind === 'prompt') {
    const p = M.promptById(state, row.id), runs = M.runsOf(state, p.id);
    kindWord = 'Prompt';
    unread = runs.some(r => r.unread);
    lead = `<span class="mark mark-prompt" aria-hidden="true">&gt;</span><span class="title">${esc(p.body) || '<span class="dim">empty prompt</span>'}</span>`;
    facts.state = word(p.state);
    facts.unread = unread ? '<b class="unread">Unread</b>' : '';
  } else if (row.kind === 'run') {
    const r = M.runById(state, row.id);
    kindWord = 'Run';
    unread = r.unread;
    lead = `<span class="mark mark-run" aria-hidden="true"></span><span class="title"><span class="mono">${esc(r.harness)} · ${esc(r.model)}</span> <span class="run-meta">pane <span class="mono">${esc(r.pane_id)}</span> · ${esc(r.started)}${r.commits.length ? ` · ${plural(r.commits.length, 'commit')}` : ''}</span></span><span class="tag${r.partial ? ' tag-warn' : ''}">${esc(sourceLabel(r))}</span>`;
    facts.state = word(r.state);
    facts.unread = unread ? '<b class="unread">Unread</b>' : '';
  } else {
    kindWord = 'Group';
    lead = `<span class="mark mark-group" aria-hidden="true"></span><span class="title">No task</span><span class="tag">${plural(row.count, 'orphan')}</span>`;
    facts.queued = M.queueOf(state, null).filter(p => p.state === 'saved').length ? `${M.queueOf(state, null).filter(p => p.state === 'saved').length} saved` : '';
    facts.state = '<span class="dim">manual</span>';
  }
  const selected = selIs(row.kind, row.id);
  const tabbable = selected || (index === 0 && !rows.some(r => selIs(r.kind, r.id)));
  const LABELS = { queued: 'Queued', state: 'State', unread: 'Read state', branch: 'Branch', pr: 'PR' };
  const cells = Object.entries(facts).map(([k, v]) => `<span class="fact f-${k}${v ? '' : ' is-empty'}"><span class="fact-label">${LABELS[k]}</span>${v}</span>`).join('');
  const twist = row.expandable
    ? `<button type="button" class="twist${row.open ? ' open' : ''}" data-act="twist" tabindex="-1" aria-label="${row.open ? 'Collapse' : 'Expand'}">${CHEVRON}</button>`
    : '<span class="twist-gap"></span>';
  return `<li role="treeitem" class="line line-${row.kind}${unread ? ' is-unread' : ''}${selected ? ' is-selected' : ''}${ui.flash === row.id ? ' is-new' : ''}" data-kind="${row.kind}" data-id="${esc(row.id)}" data-depth="${Math.min(row.depth, 6)}" aria-level="${row.depth + 1}" aria-selected="${selected}"${row.expandable ? ` aria-expanded="${row.open}"` : ''} tabindex="${tabbable ? 0 : -1}">
    <span class="lead">${twist}<span class="sr-only">${kindWord}: </span>${lead}</span><span class="facts">${cells}</span></li>`;
}
function renderOutline() {
  rows = M.buildRows(state, ui.view, ui.collapsed);
  el.outline.innerHTML = rows.length ? rows.map(lineHtml).join('') : '<li class="empty" role="none">Nothing in the archive yet. Archived tasks keep their prompts and runs.</li>';
}
const lineEl = (kind, id) => el.outline.querySelector(`.line[data-kind="${kind}"][data-id="${CSS.escape(id)}"]`);
const selLine = () => ui.sel && lineEl(ui.sel.kind, ui.sel.id);

// ---------- detail ----------
function valueHtml(r, mono = true) {
  if (r.source === 'none') return '<span class="v-inh">not set</span>';
  const v = `<span class="${mono ? 'mono' : ''}">${esc(r.value)}</span>`;
  if (r.source === 'own') return `<span class="v-own">${v}</span>`;
  return `<span class="v-inh">${v} <span class="src">(${r.source === 'default' ? 'app default' : `from ${esc(r.from)}`})</span></span>`;
}
const options = (list, current, first) => `${first ? `<option value="">${first}</option>` : ''}${list.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}"${v === current ? ' selected' : ''}>${esc(l)}</option>`; }).join('')}`;
const paneLabel = p => `${p.id} · ${p.session}@${p.host} · ${p.harness} · ${p.state.replace('_', ' ')}`;
const commitList = commits => commits.length ? `<ul class="plain">${commits.map(c => `<li><span class="mono">${esc(c.sha)}</span> ${esc(c.title)}</li>`).join('')}</ul>` : '<p class="quiet">No commits recorded.</p>';
const backBtn = '<button type="button" class="back" data-act="back">Back to outline</button>';

function factRow(t, f) {
  const r = M.resolveTask(state, t.id, f.key);
  if (ui.editing !== f.key) return `<tr><th scope="row">${f.label}</th><td>${valueHtml(r)}</td><td class="act"><button type="button" data-act="fact-edit" data-field="${f.key}" aria-label="Edit ${f.label}">Edit</button></td></tr>`;
  const inherit = M.resolveTask(state, t.parent_id, f.key);
  const hint = inherit.source === 'none' ? 'Leave empty for not set.' : `Leave empty to inherit ${esc(inherit.value)}.`;
  const editor = f.kind === 'select'
    ? `<select id="fact-input" data-change="fact-select" data-field="${f.key}" aria-label="${f.label}">${options(f.options, t[f.key], inherit.source === 'none' ? 'Not set' : `Inherit (${inherit.value})`)}</select>`
    : `<input id="fact-input" type="text" value="${esc(t[f.key] ?? '')}" aria-label="${f.label}" spellcheck="false">${f.kind === 'dir' ? '<button type="button" data-act="browse" data-for="fact-input">Browse…</button>' : ''}<button type="button" class="primary" data-act="fact-save" data-field="${f.key}">Save</button>`;
  return `<tr class="editing"><th scope="row">${f.label}</th><td colspan="2"><div class="editor">${editor}<button type="button" data-act="fact-cancel">Cancel</button></div><p class="quiet">${hint}</p></td></tr>`;
}

function taskDetail(t) {
  const parent = M.taskById(state, t.parent_id);
  const mode = M.resolveTask(state, t.id, 'queue_mode');
  const queue = M.queueOf(state, t.id);
  const ids = M.subtreeIds(state, t.id);
  const panes = state.panes.filter(p => p.task_id === t.id);
  const pids = new Set(state.prompts.filter(p => ids.includes(p.task_id)).map(p => p.id));
  const commits = state.runs.filter(r => pids.has(r.prompt_id)).flatMap(r => r.commits);
  const repo = M.resolveTask(state, t.id, 'repo'), home = M.resolveTask(state, t.id, 'home'), branch = M.resolveTask(state, t.id, 'branch');
  const prOwner = M.nearestPr(state, t.id);
  const targets = state.tasks.filter(x => !ids.includes(x.id) && !M.isArchived(state, x.id)).map(x => [x.id, `${'· '.repeat(M.chain(state, x.id).length - 1)}${x.title}`]);
  const git = !repo.value ? (home.value ? `${esc(home.value)} is a directory, not a repository.` : 'No repository. A prompt here needs a pane at rest or a directory before it can run.')
    : prOwner ? `<span class="mono">PR ${prOwner.pr.number}</span> · ${esc(prOwner.pr.state)} · checks ${word(prOwner.pr.checks)}${prOwner.id === t.id ? '' : ` <span class="src">(from ${esc(prOwner.title)})</span>`}`
    : `No pull request for <span class="mono">${esc(branch.value ?? 'this branch')}</span>.`;
  const gitHead = repo.value && M.REPO_STATE[repo.value] ? `<p class="quiet">Checked out now: <span class="mono">${esc(M.REPO_STATE[repo.value].head)}</span>${M.REPO_STATE[repo.value].dirty ? ', with uncommitted changes' : ', clean'}.</p>` : '';
  return `${backBtn}
  <h2 id="d-title" tabindex="-1">${esc(t.title)}</h2>
  <p class="d-sub">Task${parent ? ` under ${esc(parent.title)}` : ', top level'}${t.origin ? ` · from ${esc(t.origin)}` : ''}${t.archived ? ' · archived' : ''}</p>
  <div class="row move"><span class="row-label">Move</span>
    <button type="button" data-act="indent" title="Tab">Indent</button><button type="button" data-act="outdent" title="Shift+Tab">Outdent</button>
    <label class="sr-only" for="move-under">Move under another task</label>
    <select id="move-under" data-change="move-under">${options(targets, t.parent_id ?? '', 'Top level')}</select></div>
  <section><h3>Facts</h3>
    <table class="facts-table"><tbody>${M.FIELDS.map(f => factRow(t, f)).join('')}</tbody></table></section>
  <section><h3>Queue</h3>
    <div class="row"><div class="switch" role="group" aria-label="Queue mode">
      <button type="button" data-act="mode" data-mode="manual" aria-pressed="${mode.value === 'manual'}">Manual</button><button type="button" data-act="mode" data-mode="auto" aria-pressed="${mode.value === 'auto'}">Auto</button></div>
      <button type="button" data-act="run-next"${queue.some(p => ['queued', 'saved', 'blocked'].includes(p.state)) ? '' : ' disabled'}>Run next</button></div>
    <p class="quiet">${mode.value === 'auto' ? 'Runs the next prompt when the executor comes to rest. Holds at a blocked prompt.' : 'Runs only when you press Run.'}${mode.source === 'own' ? '' : ` Mode ${mode.source === 'default' ? 'is the app default' : `comes from ${esc(mode.from)}`}.`}</p>
    ${queue.length ? `<ol class="queue">${queue.map(p => `<li><button type="button" class="link" data-act="open" data-kind="prompt" data-id="${p.id}"><span class="mark-prompt" aria-hidden="true">&gt;</span> ${esc(p.body) || 'empty prompt'}</button>${word(p.state)}</li>`).join('')}</ol>` : '<p class="quiet">No prompts yet. Type &gt; and some text in the capture line to add one here.</p>'}
  </section>
  <section><h3>Panes</h3>${panes.length ? `<ul class="plain">${panes.map(p => `<li><span class="mono">${esc(p.id)}</span> ${esc(p.session)}@${esc(p.host)} · ${esc(p.harness)} · ${word(p.state)}</li>`).join('')}</ul>` : '<p class="quiet">No panes are attached to this task.</p>'}</section>
  <section><h3>Commits</h3>${commitList(commits)}</section>
  <section><h3>Pull request and checks</h3><p>${git}</p>${gitHead}</section>`;
}

function fixHtml(p, b) {
  const rest = state.panes.filter(M.paneAtRest).map(x => [x.id, paneLabel(x)]);
  const paneSelect = `<label>Pane <select data-change="fix-pane">${options(rest, p.target ?? '', b.code === 'nowhere' ? 'Choose a pane at rest' : 'No fixed pane, pick at run time')}</select></label>`;
  if (b.fix === 'text') return '<p class="quiet">Write the prompt text above.</p>';
  if (b.fix === 'pane') return paneSelect;
  if (b.fix === 'harness') return `<label>Harness <select data-change="fix-harness">${options(M.HOST_HARNESSES, '', 'Choose a harness')}</select></label>`;
  return `${paneSelect}<label for="fix-dir">or a directory to launch in</label><div class="editor"><input id="fix-dir" type="text" placeholder="~/proj/…" spellcheck="false"><button type="button" data-act="browse" data-for="fix-dir">Browse…</button><button type="button" data-act="fix-dir">Use directory</button></div>`;
}
function preflightHtml(p) {
  const pf = M.preflight(state, p);
  const running = p.state === 'running';
  return `<h3>Preflight</h3>
    <h4>Blocks <span class="n">${pf.blocks.length}</span></h4>
    ${pf.blocks.length ? `<ul class="checks">${pf.blocks.map(b => `<li class="block"><p><b>Block</b> ${esc(b.text)}</p><div class="fix">${fixHtml(p, b)}</div></li>`).join('')}</ul>` : '<p class="quiet">Nothing stops this prompt from running.</p>'}
    <h4>Warnings <span class="n">${pf.warns.length}</span></h4>
    ${pf.warns.length ? `<ul class="checks">${pf.warns.map(w => `<li class="warn"><p><b>Warning</b> ${esc(w.text)}</p></li>`).join('')}</ul>` : '<p class="quiet">No warnings.</p>'}
    <div class="row run-row">
      <button type="button" class="primary" data-act="run-now"${pf.blocks.length || running ? ' disabled' : ''} aria-describedby="run-why">${p.state === 'done' ? 'Run again' : 'Run now'}</button>
      <button type="button" data-act="save-queue">Save to queue instead</button></div>
    <p class="quiet" id="run-why">${running ? 'Running now.' : pf.blocks.length ? `Run is off until ${plural(pf.blocks.length, 'block')} above ${pf.blocks.length === 1 ? 'is' : 'are'} fixed. Saving always works.` : pf.warns.length ? 'Warnings do not stop a run.' : ''}</p>`;
}
function promptDetail(p) {
  const pf = M.preflight(state, p);
  const ex = pf.executor;
  const target = ex.kind === 'pane' ? `<span class="${ex.explicit ? 'v-own' : 'v-inh'}"><span class="mono">${esc(ex.pane.id)}</span> ${esc(ex.pane.state.replace('_', ' '))}${ex.explicit ? '' : ' <span class="src">(resting pane of the task)</span>'}</span>`
    : ex.kind === 'launch' ? `<span class="v-inh">new pane in <span class="mono">${esc(ex.dir)}</span></span>` : ex.kind === 'gone' ? `<span class="v-own"><span class="mono">${esc(ex.id)}</span> gone</span>` : '<span class="v-inh">nowhere yet</span>';
  const runs = M.runsOf(state, p.id);
  const tasks = state.tasks.filter(t => !M.isArchived(state, t.id)).map(t => [t.id, `${'· '.repeat(M.chain(state, t.id).length - 1)}${t.title}`]);
  return `${backBtn}
  <h2 id="d-title" tabindex="-1">Prompt</h2>
  <p class="d-sub">${p.task_id ? `In ${esc(M.chain(state, p.task_id).reverse().map(t => t.title).join(' / '))}` : 'In No task'} · ${word(p.state)}</p>
  <label class="field-label" for="p-body">Text</label>
  <textarea id="p-body" rows="4" spellcheck="false">${esc(p.body)}</textarea>
  <table class="facts-table"><tbody>
    <tr><th scope="row">Target</th><td>${target}</td></tr>
    <tr><th scope="row">Harness</th><td>${valueHtml(pf.harness)}</td></tr>
    <tr><th scope="row">Model</th><td>${valueHtml(pf.model)}</td></tr>
    <tr><th scope="row"><label for="p-task">Task</label></th><td><select id="p-task" data-change="move-prompt">${options(tasks, p.task_id ?? '', 'No task')}</select></td></tr>
  </tbody></table>
  <section id="preflight">${preflightHtml(p)}</section>
  <section><h3>Runs</h3>${runs.length ? `<ul class="plain">${runs.map(r => `<li><button type="button" class="link" data-act="open" data-kind="run" data-id="${r.id}"><span class="mono">${esc(r.harness)} · ${esc(r.pane_id)}</span> ${esc(r.started)}</button>${word(r.state)}${r.unread ? ' <b class="unread">Unread</b>' : ''}</li>`).join('')}</ul>` : '<p class="quiet">Not run yet.</p>'}</section>`;
}

function md(src) {
  const inline = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  const out = []; let list = null, code = null, para = [];
  const flush = () => { if (para.length) out.push(`<p>${para.map(inline).join(' ')}</p>`); para = []; if (list) out.push(`<ul>${list.map(i => `<li>${inline(i)}</li>`).join('')}</ul>`); list = null; };
  for (const line of src.split('\n')) {
    if (line.startsWith('```')) { if (code) { out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); code = null; } else { flush(); code = []; } continue; }
    if (code) { code.push(line); continue; }
    if (/^#{1,3} /.test(line)) { flush(); out.push(`<h4>${inline(line.replace(/^#+ /, ''))}</h4>`); }
    else if (line.startsWith('- ')) { if (para.length) flush(); (list ??= []).push(line.slice(2)); }
    else if (!line.trim()) flush();
    else { if (list) flush(); para.push(line); }
  }
  flush();
  return out.join('');
}
function runDetail(r) {
  const p = M.promptById(state, r.prompt_id);
  const SOURCE_NOTE = { transcript: 'Read from the harness transcript.', pane: 'Captured from the pane screen.', summary: 'Only the closing summary was captured.' };
  return `${backBtn}
  <h2 id="d-title" tabindex="-1">Run in pane <span class="mono">${esc(r.pane_id)}</span></h2>
  <p class="d-sub"><span class="mono">${esc(r.harness)} · ${esc(r.model)}</span> on ${esc(r.host)} · ${word(r.state)}${r.unread ? ' · <b class="unread">Unread</b>' : ''}</p>
  ${p ? `<p class="from"><button type="button" class="link" data-act="open" data-kind="prompt" data-id="${p.id}"><span class="mark-prompt" aria-hidden="true">&gt;</span> ${esc(p.body)}</button></p>` : '<p class="quiet">No saved prompt started this run.</p>'}
  <table class="facts-table"><tbody>
    <tr><th scope="row">Source</th><td><span class="tag${r.partial ? ' tag-warn' : ''}">${esc(sourceLabel(r))}</span> ${SOURCE_NOTE[r.source]}${r.partial ? ' Parts are missing.' : ''}</td></tr>
    <tr><th scope="row">Time</th><td><span class="mono">${esc(r.started)}${r.finished ? ` to ${esc(r.finished)}` : ', still going'}</span></td></tr>
    ${r.head_before ? `<tr><th scope="row">HEAD</th><td><span class="mono">${esc(r.head_before)} to ${esc(r.head_after)}</span></td></tr>` : ''}
  </tbody></table>
  <div class="row"><button type="button" data-act="toggle-read">${r.unread ? 'Mark read' : 'Mark unread'}</button></div>
  <section><h3>Response</h3><div class="response">${r.response ? md(r.response) : '<p class="quiet">Working. Nothing captured yet.</p>'}</div></section>
  <section><h3>Commits</h3>${commitList(r.commits)}</section>
  <section><h3>Reply</h3>
    <label class="field-label" for="reply">New prompt for pane <span class="mono">${esc(r.pane_id)}</span>, under ${esc(taskTitle(p?.task_id))}</label>
    <textarea id="reply" rows="3" spellcheck="false"></textarea>
    <div class="row"><button type="button" class="primary" data-act="reply-save">Save reply to queue</button><button type="button" data-act="reply-run">Run reply now</button></div></section>`;
}
function groupDetail() {
  const prompts = M.queueOf(state, null), runs = state.runs.filter(r => !r.prompt_id);
  const tasks = state.tasks.filter(t => !M.isArchived(state, t.id)).map(t => [t.id, `${'· '.repeat(M.chain(state, t.id).length - 1)}${t.title}`]);
  return `${backBtn}
  <h2 id="d-title" tabindex="-1">No task</h2>
  <p class="d-sub">${plural(prompts.length, 'orphan prompt')}, ${plural(runs.length, 'unassigned run')}. This queue is always manual.</p>
  <section><h3>Move all prompts into a task</h3>
    <div class="row"><label class="sr-only" for="bulk">Task</label><select id="bulk" data-change="bulk-target">${options(tasks, ui.bulkTarget, 'Choose a task')}</select><button type="button" data-act="bulk-move">Move ${prompts.length}</button></div></section>
  <section><h3>Prompts</h3>${prompts.length ? `<ol class="queue">${prompts.map(p => `<li><button type="button" class="link" data-act="open" data-kind="prompt" data-id="${p.id}"><span class="mark-prompt" aria-hidden="true">&gt;</span> ${esc(p.body) || 'empty prompt'}</button>${word(p.state)}</li>`).join('')}</ol>` : '<p class="quiet">No orphan prompts.</p>'}</section>
  <section><h3>Unassigned runs</h3>${runs.length ? `<ul class="plain">${runs.map(r => `<li><button type="button" class="link" data-act="open" data-kind="run" data-id="${r.id}"><span class="mono">${esc(r.harness)} · ${esc(r.pane_id)}</span> ${esc(r.started)}</button>${word(r.state)}</li>`).join('')}</ul>` : '<p class="quiet">None.</p>'}</section>`;
}
function renderDetail() {
  ui.detailDirty = false;
  const s = ui.sel;
  const rec = !s ? null : s.kind === 'task' ? M.taskById(state, s.id) : s.kind === 'prompt' ? M.promptById(state, s.id) : s.kind === 'run' ? M.runById(state, s.id) : {};
  el.detail.innerHTML = !rec ? `${backBtn}<h2 id="d-title" tabindex="-1">Nothing selected</h2><p class="quiet">Pick a line in the outline, or press n and type one.</p>`
    : s.kind === 'task' ? taskDetail(rec) : s.kind === 'prompt' ? promptDetail(rec) : s.kind === 'run' ? runDetail(rec) : groupDetail();
}

// ---------- refresh ----------
const fieldFocused = () => el.detail.contains(document.activeElement) && document.activeElement.matches('input, textarea, select');
function refresh({ background = false } = {}) {
  const lineHadFocus = document.activeElement?.classList?.contains('line');
  renderRail();
  renderOutline();
  ui.flash = null;
  if (lineHadFocus) selLine()?.focus({ preventScroll: true });
  if (background && fieldFocused()) ui.detailDirty = true;   // never re-render under a field being edited
  else renderDetail();
  renderChip();
}
function afterChange(opts) {
  M.autoTick(state).forEach(schedule);
  refresh(opts);
}
function schedule(run) {
  setTimeout(() => {
    M.finishRun(state, run.id);
    say(`Run finished in pane ${run.pane_id}. Marked unread.`);
    afterChange({ background: true });
  }, 2000);
}
function select(kind, id, { open = false, focus = null } = {}) {
  ui.sel = { kind, id };
  ui.destCleared = false;
  ui.editing = null;
  if (open) {
    document.body.dataset.detail = 'open';
    if (kind === 'run') M.runById(state, id).unread = false;
  }
  refresh();
  const line = selLine();
  line?.scrollIntoView({ block: 'nearest' });
  if (focus === 'line') line?.focus({ preventScroll: true });
  if (focus === 'detail') $('#d-title')?.focus();
}
function reveal(kind, id, taskId) {            // make sure a new line is on screen
  M.chain(state, taskId).forEach(t => ui.collapsed.delete(`task:${t.id}`));
  if (!taskId && kind === 'prompt') ui.collapsed.delete('group:none');
  ui.flash = id;
  if (!M.buildRows(state, ui.view, ui.collapsed).some(r => r.kind === kind && r.id === id)) ui.view = 'everything';
}
function attemptRun(p) {
  const pf = M.preflight(state, p);
  if (pf.blocks.length) {
    say(`Not run: ${pf.blocks.map(b => b.text.split(':')[0]).join('; ')}. The prompt is saved; fix it beside Run now.`);
    return false;
  }
  schedule(M.startRun(state, p));
  say(`Running in ${pf.executor.kind === 'pane' ? `pane ${pf.executor.pane.id}` : `a new pane in ${pf.executor.dir}`}.`);
  return true;
}

// ---------- capture ----------
function submitCapture(runNow) {
  const raw = el.input.value.trim();
  if (!raw) return;
  const dest = destTaskId();
  el.input.value = '';
  if (raw.startsWith('>')) {
    const p = M.addPrompt(state, { body: raw.slice(1).trim(), task_id: dest });
    reveal('prompt', p.id, dest);
    say(`Prompt saved to the queue of ${taskTitle(dest)}.`);
    if (runNow && !attemptRun(p)) { ui.sel = { kind: 'prompt', id: p.id }; ui.editing = null; }
  } else {
    const t = M.addTask(state, { title: raw, parent_id: dest });
    reveal('task', t.id, dest);
    say(dest ? `Task saved under ${taskTitle(dest)}.` : 'Task saved at top level.');
  }
  const newId = ui.flash;
  afterChange();
  el.outline.querySelector(`.line[data-id="${CSS.escape(newId)}"]`)?.scrollIntoView({ block: 'nearest' });
}
$('#capture').addEventListener('submit', e => { e.preventDefault(); submitCapture(false); });
el.input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitCapture(true); }
  else if (e.key === 'Backspace' && !el.input.value && destTaskId()) { ui.destCleared = true; renderChip(); say('Destination cleared. The next line lands at top level or under No task.'); }
  else if (e.key === 'Escape') { el.input.blur(); (selLine() ?? el.outline.querySelector('.line'))?.focus(); }
});
el.dest.addEventListener('click', e => { if (e.target.closest('[data-act="clear-dest"]')) { ui.destCleared = true; renderChip(); el.input.focus(); } });

// ---------- rail and outline interaction ----------
el.views.addEventListener('click', e => {
  const b = e.target.closest('[data-view]');
  if (!b) return;
  ui.view = b.dataset.view;
  delete document.body.dataset.detail;
  refresh();
  el.views.querySelector('.active')?.focus();
});
function toggle(row, open) {
  const key = `${row.kind}:${row.id}`;
  if (open ?? !row.open) ui.collapsed.delete(key); else ui.collapsed.add(key);
  refresh();
}
el.outline.addEventListener('click', e => {
  const line = e.target.closest('.line');
  if (!line) return;
  const row = rows.find(r => r.kind === line.dataset.kind && r.id === line.dataset.id);
  if (e.target.closest('[data-act="twist"]')) { toggle(row); lineEl(row.kind, row.id)?.focus(); return; }
  select(row.kind, row.id, { open: true, focus: 'line' });
});
function reparent(fn, label) {
  if (ui.sel?.kind !== 'task') return say('Only tasks can be re-parented. Use the Task selector to move a prompt.');
  const t = M.taskById(state, ui.sel.id);
  if (!fn(state, t.id)) return say(label === 'indent' ? 'Nothing above to indent under.' : 'Already at top level.');
  M.chain(state, t.id).slice(1).forEach(p => ui.collapsed.delete(`task:${p.id}`));
  ui.flash = t.id;
  say(t.parent_id ? `Moved under ${taskTitle(t.parent_id)}. Inherited facts now come from there.` : 'Moved to top level. Nothing is inherited.');
  afterChange();
}
document.addEventListener('keydown', e => {
  const a = document.activeElement;
  if (e.altKey || (a && a.matches('input, textarea, select'))) return;
  if ((e.key === 'n' || e.key === '/') && !e.metaKey && !e.ctrlKey) { e.preventDefault(); delete document.body.dataset.detail; el.input.focus(); return; }
  if (e.metaKey || e.ctrlKey || (el.detail.contains(a) && !['j', 'k'].includes(e.key))) return;
  const onLine = a?.classList?.contains('line');
  const i = rows.findIndex(r => selIs(r.kind, r.id));
  const row = rows[i];
  const go = j => { const r = rows[Math.max(0, Math.min(rows.length - 1, j))]; if (r) { e.preventDefault(); select(r.kind, r.id, { focus: 'line' }); } };
  if (e.key === 'j' || e.key === 'ArrowDown') go(i + 1);
  else if (e.key === 'k' || e.key === 'ArrowUp') go(i < 0 ? 0 : i - 1);
  else if (!row) return;
  else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    if (row.expandable && row.open) toggle(row, false);
    else { let j = i - 1; while (j >= 0 && rows[j].depth >= row.depth) j--; if (j >= 0) go(j); }
  } else if (e.key === 'ArrowRight') { e.preventDefault(); if (row.expandable && !row.open) toggle(row, true); else if (rows[i + 1]?.depth > row.depth) go(i + 1); }
  else if (e.key === 'Tab' && onLine && row.kind === 'task') { e.preventDefault(); reparent(e.shiftKey ? M.outdent : M.indent, e.shiftKey ? 'outdent' : 'indent'); selLine()?.focus(); }
  else if (e.key === 'Enter' && (onLine || a === document.body)) { e.preventDefault(); select(row.kind, row.id, { open: true, focus: 'detail' }); }
});

// ---------- detail interaction ----------
async function browse(inputId) {
  const input = document.getElementById(inputId);
  if (window.showDirectoryPicker) {
    try { input.value = (await window.showDirectoryPicker()).name; input.focus(); } catch { /* picker dismissed */ }
    return;
  }
  el.dirFallback.onchange = () => { const f = el.dirFallback.files[0]; if (f) input.value = f.webkitRelativePath.split('/')[0]; el.dirFallback.value = ''; input.focus(); };
  el.dirFallback.click();
}
function saveFact(t, field, value) {
  if (value) t[field] = value; else delete t[field];
  ui.editing = null;
  say(value ? `${field.replace('_', ' ')} set on ${t.title}.` : `${field.replace('_', ' ')} cleared on ${t.title}; it inherits again.`);
}
function reply(r, runNow) {
  const body = $('#reply').value.trim();
  if (!body) return say('Write the reply first.');
  const parent = M.promptById(state, r.prompt_id);
  const p = M.addPrompt(state, { body, task_id: parent?.task_id ?? null, target: r.pane_id });
  reveal('prompt', p.id, p.task_id);
  say(`Reply saved under ${taskTitle(p.task_id)}, targeting pane ${r.pane_id}.`);
  if (runNow && !attemptRun(p)) { ui.sel = { kind: 'prompt', id: p.id }; }
}
el.detail.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act, s = ui.sel;
  const task = s?.kind === 'task' ? M.taskById(state, s.id) : null;
  const prompt = s?.kind === 'prompt' ? M.promptById(state, s.id) : null;
  const run = s?.kind === 'run' ? M.runById(state, s.id) : null;
  if (act === 'back') { delete document.body.dataset.detail; selLine()?.focus(); return; }
  if (act === 'browse') { browse(b.dataset.for); return; }
  if (act === 'open') { select(b.dataset.kind, b.dataset.id, { open: true, focus: 'detail' }); return; }
  if (act === 'indent') reparent(M.indent, 'indent');
  else if (act === 'outdent') reparent(M.outdent, 'outdent');
  else if (act === 'fact-edit') { ui.editing = b.dataset.field; renderDetail(); $('#fact-input')?.focus(); return; }
  else if (act === 'fact-cancel') { ui.editing = null; renderDetail(); }
  else if (act === 'fact-save') { saveFact(task, b.dataset.field, $('#fact-input').value.trim()); afterChange(); }
  else if (act === 'mode') { task.queue_mode = b.dataset.mode; say(`${task.title} queue is now ${b.dataset.mode}.`); afterChange(); }
  else if (act === 'run-next') {
    const next = M.queueOf(state, task.id).find(p => ['queued', 'saved', 'blocked'].includes(p.state));
    if (next && !attemptRun(next)) { next.state = 'blocked'; afterChange(); select('prompt', next.id, { open: true, focus: 'detail' }); return; }
    afterChange();
  }
  else if (act === 'run-now') { attemptRun(prompt); afterChange(); }
  else if (act === 'save-queue') { prompt.state = prompt.task_id ? 'queued' : 'saved'; say(`Saved to the queue of ${taskTitle(prompt.task_id)}. Nothing was run.`); afterChange(); }
  else if (act === 'fix-dir') { const v = $('#fix-dir').value.trim(); if (!v) return say('Type or browse to a directory first.'); prompt.dir = v; say(`This prompt will launch a new pane in ${v}.`); afterChange(); }
  else if (act === 'toggle-read') { run.unread = !run.unread; afterChange(); }
  else if (act === 'reply-save') { reply(run, false); afterChange(); }
  else if (act === 'reply-run') { reply(run, true); afterChange(); }
  else if (act === 'bulk-move') {
    if (!ui.bulkTarget) return say('Choose a task to move the prompts into.');
    const moved = M.queueOf(state, null);
    moved.forEach(p => { p.task_id = ui.bulkTarget; if (p.state === 'saved') p.state = 'queued'; });
    say(`Moved ${plural(moved.length, 'prompt')} into ${taskTitle(ui.bulkTarget)}.`);
    ui.bulkTarget = '';
    afterChange();
  }
  const again = el.detail.querySelector(`[data-act="${act}"]${b.dataset.field ? `[data-field="${b.dataset.field}"]` : ''}${b.dataset.mode ? `[data-mode="${b.dataset.mode}"]` : ''}`);
  (again && !again.disabled ? again : $('#d-title'))?.focus();
});
el.detail.addEventListener('change', e => {
  const c = e.target.closest('[data-change]');
  if (!c) return;
  const kind = c.dataset.change, v = c.value, s = ui.sel;
  if (kind === 'bulk-target') { ui.bulkTarget = v; return; }
  if (kind === 'move-under') { if (M.moveUnder(state, s.id, v || null)) { ui.collapsed.delete(`task:${v}`); ui.flash = s.id; say(v ? `Moved under ${taskTitle(v)}. Inherited facts now come from there.` : 'Moved to top level. Nothing is inherited.'); } }
  else if (kind === 'fact-select') saveFact(M.taskById(state, s.id), c.dataset.field, v);
  else {
    const p = M.promptById(state, s.id);
    if (kind === 'move-prompt') { p.task_id = v || null; if (['saved', 'queued'].includes(p.state)) p.state = v ? 'queued' : 'saved'; reveal('prompt', p.id, p.task_id); say(`Prompt moved to ${taskTitle(p.task_id)}.`); }
    if (kind === 'fix-pane') { if (v) p.target = v; else delete p.target; say(v ? `Target set to pane ${v}.` : 'Target cleared.'); }
    if (kind === 'fix-harness' && v) { p.harness = v; say(`Harness set to ${v} for this prompt.`); }
  }
  afterChange();
  (document.getElementById(c.id) ?? $('#d-title'))?.focus();
});
el.detail.addEventListener('input', e => {
  if (e.target.id !== 'p-body' || ui.sel?.kind !== 'prompt') return;
  const p = M.promptById(state, ui.sel.id);
  p.body = e.target.value;
  renderOutline();
  $('#preflight').innerHTML = preflightHtml(p);     // the field being typed in is left alone
});
el.detail.addEventListener('keydown', e => {
  if (e.target.id === 'fact-input' && e.target.matches('input')) {
    if (e.key === 'Enter') { e.preventDefault(); el.detail.querySelector('[data-act="fact-save"]').click(); }
    if (e.key === 'Escape') { ui.editing = null; renderDetail(); $('#d-title').focus(); }
  }
  if (e.target.id === 'reply' && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); el.detail.querySelector('[data-act="reply-run"]').click(); }
});
el.detail.addEventListener('focusout', e => {
  if (ui.detailDirty && !el.detail.contains(e.relatedTarget)) renderDetail();
});

afterChange();
