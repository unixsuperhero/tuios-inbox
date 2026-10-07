import { store, api, esc } from '/pages.js';
import { patchHTML } from '/workbench.js';

const href = (session, workspace, window) => `#tuios${session ? '/' + encodeURIComponent(session) : ''}${workspace != null ? '/' + workspace : ''}${window ? '/' + encodeURIComponent(window) : ''}`;
const windowId = w => w.window_id || w.id;
const workspaceId = w => Number(w.workspace);
const paneName = w => w.display_name || w.custom_name || w.title || windowId(w);
const stateName = w => w.agent_state || w.state || (w.minimized ? 'minimized' : 'shell');
const json = value => esc(JSON.stringify(value ?? {}, null, 2));
const names = {
  'create-session': 'New session', 'label-session': 'Label session', 'rename-session': 'Rename session', 'accent-session': 'Session accent', 'kill-session': 'Kill session',
  'name-workspace': 'Name workspace', 'select-workspace': 'Select in terminal', 'close-workspace': 'Close workspace',
  'create-window': 'New pane', 'rename-window': 'Rename pane', 'move-window': 'Move pane', 'minimize-window': 'Minimize', 'restore-window': 'Restore', 'focus-window': 'Focus in terminal',
  'close-window': 'Close pane', 'split-window': 'Split pane', 'set-layout': 'Session layout', 'interrupt-window': 'Interrupt · Ctrl+C', 'assign-task': 'Assign pane to task', 'bind-task': 'Bind future task home',
  'create-agent': 'Launch agent', 'send-prompt': 'Queue agent prompt',
};
const destructive = new Set(['kill-session', 'close-workspace', 'close-window', 'interrupt-window']);
const direct = new Set(['select-workspace', 'focus-window', 'minimize-window', 'restore-window']);

export function createTuios({ root, refresh }) {
  let route, inventory, dialogContext, notice = '', readAt = '', mutation = false;
  const sessions = new Map(), windows = new Map(), errors = new Map(), reading = new Map(), filters = new Map(), drafts = new Map(), launches = new Map(), expanded = new Map();
  let treeScroll = 0;
  const supports = r => r?.kind === 'tuios' || r?.kind === 'index' && r.page === 'tuios';
  const scope = r => `${r?.session || ''}/${r?.workspace ?? ''}`;
  const detailKey = r => `${r.session}/${r.window}`;
  const sessionData = () => sessions.get(route?.session);
  const currentWorkspace = () => Number(sessionData()?.info?.current_workspace || 1);
  const selectedWorkspace = () => route.workspace ?? currentWorkspace();
  const attached = session => Boolean(sessions.get(session)?.info?.tui_attached ?? inventory?.sessions.find(s => s.target === session)?.attached);
  const remote = session => Boolean(inventory?.sessions.find(s => s.target === session)?.host && inventory.sessions.find(s => s.target === session).host !== 'local');
  const filter = () => {
    const key = scope(route);
    if (!filters.has(key)) filters.set(key, { search: '', host: '', status: '' });
    return filters.get(key);
  };
  const sessionLabel = s => s.display_name || s.label || s.name || s.target;
  const sessionState = s => s.saved ? 'saved' : s.attached ? 'attached' : 'detached';
  const actionButton = (action, context = {}, disabled = '') => `<button type="button" data-native-action="${action}" data-session="${esc(context.session ?? route?.session ?? '')}"${context.workspace != null ? ` data-workspace="${context.workspace}"` : ''}${context.window ? ` data-window="${esc(context.window)}"` : ''}${disabled ? ` disabled title="${esc(disabled)}"` : ''}${destructive.has(action) ? ' class="danger"' : ''}>${names[action]}</button>`;
  const selectOptions = (choices, value) => choices.map(c => `<option value="${esc(c.value)}"${String(c.value) === String(value ?? '') ? ' selected' : ''}>${esc(c.label)}</option>`).join('');
  const taskOptions = () => [{ value: '', label: 'No task · unassigned' }, ...store.state.tasks.filter(t => !t.archived).map(t => ({ value: t.id, label: t.title }))];
  const knownWorkspaces = session => sessions.get(session)?.workspaces || [];
  const workspaceLabel = w => `${workspaceId(w)} · ${w.name || 'Workspace'}`;

  const dialog = document.createElement('dialog');
  dialog.id = 'native-dialog'; dialog.setAttribute('aria-labelledby', 'native-dialog-title');
  document.body.append(dialog);
  const saveDraft = () => {
    const form = dialog.querySelector('form');
    if (!form || !dialogContext) return;
    const data = Object.fromEntries([...form.elements].filter(field => field.name && field.name !== 'confirmed').map(field => [field.name, field.value]));
    drafts.set(dialogContext.key, data);
  };
  function closeDialog() { saveDraft(); dialog.close(); }
  function syncDirectory() {
    const field = dialog.querySelector('[name=cwd]');
    if (!field) return;
    const host = dialog.querySelector('[name=host]')?.value;
    const unavailable = remote(dialogContext.session) || Boolean(host && host !== 'local');
    field.disabled = unavailable;
    dialog.querySelector('[data-native-browse]').disabled = unavailable;
    field.placeholder = unavailable ? 'Remote native default directory' : 'Local directory (optional)';
  }
  dialog.addEventListener('cancel', e => { e.preventDefault(); closeDialog(); });
  dialog.addEventListener('input', saveDraft);
  dialog.addEventListener('change', saveDraft);
  dialog.addEventListener('change', e => { if (e.target.name === 'host') syncDirectory(); });

  function tree() {
    return `<aside id="native-tree" class="native-tree" aria-label="Native session and workspace hierarchy"><a class="native-tree-root" href="#tuios"${!route.session ? ' aria-current="page"' : ''}>All sessions</a>${(inventory?.sessions || []).map(s => {
      const data = sessions.get(s.target), open = expanded.get(s.target) ?? s.target === route.session;
      return `<details data-wb-key="tree:${esc(s.target)}" data-native-tree="${esc(s.target)}"${open ? ' open' : ''}><summary>${esc(sessionLabel(s))}<small>${esc(s.host || 'local')}</small></summary><a href="${href(s.target)}"${route.session === s.target && !route.workspace ? ' aria-current="page"' : ''}>Inspect session</a>${(data?.workspaces || []).map(w => `<div data-wb-key="tree-workspace:${workspaceId(w)}"><a class="native-tree-workspace" href="${href(s.target, workspaceId(w))}"${route.session === s.target && route.workspace === workspaceId(w) && !route.window ? ' aria-current="page"' : ''}>${esc(workspaceLabel(w))}</a>${(data?.windows || []).filter(p => Number(p.workspace) === workspaceId(w)).map(p => `<a class="native-tree-pane" href="${href(s.target, p.workspace, windowId(p))}"${route.session === s.target && route.window === windowId(p) ? ' aria-current="page"' : ''}>${esc(paneName(p))}</a>`).join('')}</div>`).join('')}${!data ? '<small class="hint">Inspect session to read workspaces.</small>' : ''}</details>`;
    }).join('')}</aside>`;
  }
  function breadcrumbs() {
    const s = inventory?.sessions.find(s => s.target === route.session), data = sessionData(), w = data?.workspaces.find(w => workspaceId(w) === route.workspace);
    return `<nav class="native-breadcrumbs" aria-label="Native hierarchy breadcrumb"><a href="#tuios">Sessions</a>${route.session ? `<span aria-hidden="true">/</span><a href="${href(route.session)}">${esc(s ? sessionLabel(s) : route.session)}</a>` : ''}${route.workspace != null ? `<span aria-hidden="true">/</span><a href="${href(route.session, route.workspace)}">${esc(w ? workspaceLabel(w) : 'Workspace ' + route.workspace)}</a>` : ''}${route.window ? `<span aria-hidden="true">/</span><span aria-current="page">${esc(paneName(windows.get(detailKey(route))?.window || { id: route.window }))}</span>` : ''}</nav>`;
  }
  function filterBar(rows, getHost, getState) {
    const f = filter(), hosts = [...new Set(rows.map(getHost))].sort(), states = [...new Set(rows.map(getState))].sort();
    if (f.host && !hosts.includes(f.host)) hosts.push(f.host);
    if (f.status && !states.includes(f.status)) states.push(f.status);
    return `<div class="native-filters" role="search" aria-label="Filter native rows"><label class="native-search">Search<input id="native-search" type="search" data-native-filter="search" value="${esc(f.search)}" placeholder="Name, UUID, host, state…"></label><label>Host<select id="native-host" data-native-filter="host">${selectOptions([{ value: '', label: 'All hosts' }, ...hosts.map(value => ({ value, label: value }))], f.host)}</select></label><label>State<select id="native-state" data-native-filter="status">${selectOptions([{ value: '', label: 'All states' }, ...states.map(value => ({ value, label: value }))], f.status)}</select></label><button type="button" data-native-clear>Clear filters</button></div>`;
  }
  function filtered(rows, getHost, getState) {
    const f = filter(), search = f.search.toLocaleLowerCase();
    return rows.filter(row => (!f.host || f.host === getHost(row)) && (!f.status || f.status === getState(row)) && (!search || JSON.stringify(row).toLocaleLowerCase().includes(search)));
  }
  const empty = text => `<p class="native-empty">${esc(text)}</p>`;
  const table = (caption, body) => `<div class="native-table-scroll"><table class="native-table"><caption class="sr-only">${esc(caption)}</caption><thead><tr><th scope="col">Name</th><th scope="col">Host</th><th scope="col">State</th><th scope="col">Actions</th></tr></thead><tbody>${body}</tbody></table></div>`;
  function sessionList() {
    const rows = inventory?.sessions || [], found = filtered(rows, s => s.host || 'local', sessionState);
    return `<div class="native-section-heading"><h2>Sessions <span>${rows.length}</span></h2>${actionButton('create-session')}</div>${filterBar(rows, s => s.host || 'local', sessionState)}${found.length ? table('Native sessions', found.map(s => `<tr data-wb-key="session:${esc(s.target)}"><td><a class="native-name" href="${href(s.target)}">${esc(sessionLabel(s))}</a><small>${esc(s.target)} · ${esc(s.window_count ?? s.windows?.length ?? 0)} panes</small></td><td>${esc(s.host || 'local')}</td><td><span class="badge">${esc(sessionState(s))}</span></td><td><div class="native-row-actions"><a href="${href(s.target)}">Inspect</a>${actionButton('label-session', { session: s.target })}</div></td></tr>`).join('')) : empty(inventory ? rows.length ? 'No sessions match these filters.' : 'No native sessions found. Create one, or start TUIOS in your terminal.' : 'Reading native sessions…')}<p class="hint">A session per task is the default. For shared sessions, bind each task to a numbered workspace. Hosts are configured in TUIOS, not here.</p>`;
  }
  function paneRows(data) {
    return (data.windows || []).map(w => ({ ...data.agents?.find(a => windowId(a) === windowId(w)), ...w }));
  }
  function paneList(data) {
    const rows = paneRows(data).filter(w => route.workspace == null || Number(w.workspace) === route.workspace);
    const host = w => w.host || data.session.host || 'local', found = filtered(rows, host, stateName);
    return `${filterBar(rows, host, stateName)}${found.length ? table('Native windows, each one terminal pane', found.map(w => {
      const id = windowId(w), context = { window: id, workspace: w.workspace };
      return `<tr data-wb-key="pane:${esc(id)}"><td><a class="native-name" href="${href(route.session, w.workspace, id)}">${esc(paneName(w))}</a><small>Workspace ${esc(w.workspace)} · ${esc(id)}</small></td><td>${esc(host(w))}</td><td><span class="badge ${esc(stateName(w))}">${esc(stateName(w))}</span>${w.focused ? '<small>terminal focus</small>' : ''}${w.minimized ? '<small>minimized</small>' : ''}</td><td><div class="native-row-actions"><a href="${href(route.session, w.workspace, id)}">Inspect</a>${actionButton('focus-window', context)}${actionButton(w.minimized ? 'restore-window' : 'minimize-window', context)}${actionButton('move-window', context)}</div></td></tr>`;
    }).join('')) : empty(rows.length ? 'No panes match these filters.' : 'No panes in this scope. Open a pane or launch an agent.')}`;
  }
  function homeBindings() {
    const homes = store.state.tasks.filter(t => t.session === route.session && (route.workspace == null || Number(t.workspace) === route.workspace && t.workspace != null));
    return `<section class="native-home"><h3>Future task homes</h3>${homes.length ? `<ul>${homes.map(t => `<li><a href="#task/${encodeURIComponent(t.id)}">${esc(t.title)}</a> · ${t.workspace == null ? 'session default workspace' : 'workspace ' + esc(t.workspace)}</li>`).join('')}</ul>` : '<p class="hint">No task is bound to this home.</p>'}${actionButton('bind-task', { workspace: route.workspace })}<p class="hint">Home changes affect future launches only. Existing panes and their work history stay where they are. Pane assignment is separate.</p></section>`;
  }
  function sessionView() {
    const data = sessionData();
    if (!data) return empty('Reading this session…');
    const ws = selectedWorkspace(), clientHint = 'Attach this session in TUIOS first. This operation requires a terminal client.';
    const localOnly = remote(route.session) ? 'Native remote session rename/kill is not available.' : '';
    return `<section data-wb-key="session-detail:${esc(route.session)}"><div class="native-section-heading"><div><p class="eyebrow">${route.workspace != null ? 'WORKSPACE ' + route.workspace : 'NATIVE SESSION'}</p><h2>${esc(route.workspace != null ? data.workspaces.find(w => workspaceId(w) === route.workspace)?.name || 'Workspace ' + route.workspace : sessionLabel(data.session))}</h2></div><span class="badge">${attached(route.session) ? 'attached' : 'detached'}</span></div><p class="hint">Full terminal: <code>${esc('tuios attach ' + route.session)}</code>. Inspecting does not change terminal focus or the selected workspace.</p><div class="native-actions">${route.workspace != null ? actionButton('select-workspace', { workspace: ws }) + actionButton('name-workspace', { workspace: ws }) + actionButton('close-workspace', { workspace: ws }) : actionButton('label-session') + actionButton('rename-session', {}, localOnly) + actionButton('accent-session') + actionButton('kill-session', {}, localOnly)}</div>${route.workspace == null ? `<section class="native-workspaces" aria-label="Workspaces">${data.workspaces.map(w => `<div data-wb-key="workspace:${workspaceId(w)}"><a href="${href(route.session, workspaceId(w))}"><b>${esc(workspaceLabel(w))}</b></a><span>${data.windows.filter(p => Number(p.workspace) === workspaceId(w)).length} panes${workspaceId(w) === currentWorkspace() ? ' · terminal selected' : ''}</span>${actionButton('select-workspace', { workspace: workspaceId(w) })}</div>`).join('')}</section>` : ''}<div class="native-section-heading"><h3>Panes</h3><div class="native-actions">${actionButton('create-window', { workspace: ws })}${actionButton('create-agent', { workspace: ws })}${actionButton('set-layout', {}, !attached(route.session) ? clientHint : '')}</div></div><p class="hint">One native window is one terminal pane. An agent is metadata on that same UUID, not another movable child. Session layout applies to current terminal workspace ${currentWorkspace()}, not the browsed workspace.${!attached(route.session) ? ' Split and layout require an attached terminal client.' : ''}</p>${paneList(data)}${homeBindings()}<details class="native-metadata" data-wb-key="session-metadata"><summary>Full native session metadata</summary><pre>${json({ session: data.session, info: data.info })}</pre></details><details class="native-metadata" data-wb-key="workspace-metadata"><summary>Full workspace metadata</summary><pre>${json(data.workspaces)}</pre></details><details class="native-metadata" data-wb-key="agent-inventory"><summary>Native agent inventory · ${data.agents.length}</summary><pre>${json(data.agents)}</pre></details></section>`;
  }
  function windowView() {
    const data = windows.get(detailKey(route));
    if (!data) return empty('Reading this pane…');
    const w = data.window, id = windowId(w), context = { window: id, workspace: w.workspace ?? route.workspace };
    const known = store.state.agents.find(a => a.id === id), managed = store.state.panes.find(p => p.id === id), task = store.state.tasks.find(t => t.id === known?.task_id);
    const waiting = data.agent?.needs_you || data.agent?.state === 'needs_input';
    const question = store.state.items.find(i => i.agent_id === id && i.type === 'turn' && i.status === 'needs_input' && !i.archived);
    return `<article class="native-pane" data-wb-key="window-detail:${esc(id)}"><div class="native-section-heading"><div><p class="eyebrow">WINDOW / ONE TERMINAL PANE</p><h2>${esc(paneName(w))}</h2></div><span class="badge ${esc(data.agent?.state)}">${esc(data.agent?.state || stateName(w))}</span></div><dl class="native-facts"><div><dt>Native UUID</dt><dd>${esc(id)}</dd></div><div><dt>Session</dt><dd>${esc(route.session)}</dd></div><div><dt>Workspace</dt><dd>${esc(w.workspace ?? route.workspace)}</dd></div><div><dt>Host</dt><dd>${esc(w.host || sessionData()?.session.host || 'local')}</dd></div><div><dt>Assigned task</dt><dd>${task ? `<a href="#task/${encodeURIComponent(task.id)}">${esc(task.title)}</a>` : 'No task'}</dd></div><div><dt>Harness</dt><dd>${esc(data.agent?.harness_id || known?.harness || 'Not reported')}</dd></div></dl><p class="hint">Full terminal: <code>${esc('tuios attach ' + route.session)}</code>. This is a read-only snapshot, not an interactive terminal.</p><div class="native-actions">${actionButton('focus-window', context)}${actionButton('rename-window', context)}${actionButton('move-window', context)}${actionButton(w.minimized ? 'restore-window' : 'minimize-window', context)}${actionButton('split-window', context, !attached(route.session) ? 'Attach this session first; splitting requires a terminal client.' : '')}${actionButton('assign-task', context)}${actionButton('interrupt-window', context)}${actionButton('close-window', context)}</div>${waiting ? `<div class="native-attention" role="status"><strong>Needs your input</strong><p>Answer the native question or approval in ${question ? `<a href="#item/${encodeURIComponent(question.id)}">the existing question UI</a>` : known ? `<a href="#agent/${encodeURIComponent(id)}">the agent inbox</a>` : 'your TUIOS terminal'}. Queued prompts never grant permissions or answer an approval.</p></div>` : ''}${known?.kind === 'agent' || managed?.kind === 'agent' || data.agent?.harness_id ? `<div class="native-actions">${known ? `<a href="#agent/${encodeURIComponent(id)}">Agent inbox / questions</a>` : ''}${actionButton('send-prompt', context)}</div>` : '<p class="hint">No agent harness is reported for this pane. Use the native terminal for shell input.</p>'}<section><h3>Terminal capture <small>Last 200 lines</small></h3><pre class="native-capture" data-wb-key="capture:${esc(id)}" tabindex="0" aria-label="Read-only terminal capture">${esc(data.text ?? '')}</pre></section><details class="native-metadata" data-wb-key="window-metadata" open><summary>Full native window metadata</summary><pre>${json(w)}</pre></details><details class="native-metadata" data-wb-key="agent-metadata" open><summary>Agent identity, evidence and state</summary><pre>${json(data.agent)}</pre></details><details class="native-metadata" data-wb-key="activity-metadata" open><summary>Agent activity log</summary><pre>${json(data.activity)}</pre></details></article>`;
  }
  function launchStatus() {
    return [...launches].map(([id, label]) => {
      const item = store.state.items.find(i => i.id === `thread:${id}`);
      return `<p class="native-startup" data-wb-key="launch:${esc(id)}" role="status">${esc(label)} · ${esc(item?.status || 'accepted; startup outcome pending')} · <a href="#item/${encodeURIComponent('thread:' + id)}">Read startup / work thread</a></p>`;
    }).join('');
  }
  function render(next = route) {
    route = next;
    if (!supports(route)) return;
    const readingNow = ['inventory', 'session:' + route.session, 'window:' + detailKey(route)].some(key => reading.has(key));
    const failure = errors.get(route.window ? 'window:' + detailKey(route) : route.session ? 'session:' + route.session : 'inventory') || errors.get('inventory');
    patchHTML(root, `<section id="native-browser" class="native-browser">${breadcrumbs()}<div class="native-toolbar"><p class="hint" role="status">${readingNow ? 'Reading native state…' : readAt ? 'Read ' + readAt : 'Native state has not been read yet.'}</p><button type="button" data-native-read${readingNow ? ' disabled' : ''}>Read again</button></div>${notice ? `<p class="native-notice" role="status">${esc(notice)}</p>` : ''}${failure ? `<p class="form-error danger" role="alert">${esc(failure)} · Use Read again to retry.</p>` : ''}${(inventory?.hosts || []).filter(h => h.error).map(h => `<p class="native-host-error" role="alert">${esc(h.host)} · ${esc(h.status)}: ${esc(h.error)}</p>`).join('')}${launchStatus()}<div class="native-layout">${tree()}<div id="native-content">${route.window ? windowView() : route.session ? sessionView() : sessionList()}</div></div></section>`);
    const rail = root.querySelector('#native-tree');
    if (rail) rail.scrollTop = treeScroll;
  }
  async function readResource(key, path, receive) {
    if (reading.has(key)) return reading.get(key);
    const pending = api(path).then(result => { receive(result); errors.delete(key); readAt = new Date().toLocaleTimeString(); }).catch(e => { errors.set(key, e.message); }).finally(() => { reading.delete(key); render(); });
    reading.set(key, pending); render();
    return pending;
  }
  async function read(next = route) {
    if (!supports(next)) return;
    const operations = [readResource('inventory', '/tuios', data => { inventory = data; })];
    if (next.session) operations.push(readResource('session:' + next.session, '/tuios?session=' + encodeURIComponent(next.session), data => sessions.set(next.session, data)));
    if (next.window) operations.push(readResource('window:' + detailKey(next), '/tuios/window?session=' + encodeURIComponent(next.session) + '&window=' + encodeURIComponent(next.window), data => windows.set(detailKey(next), data)));
    await Promise.all(operations);
  }
  async function enter(next, changed) {
    if (dialog.open && changed) closeDialog();
    route = next;
    if (supports(next) && changed) await read(next);
  }
  async function update() {
    if (!supports(route) || mutation || dialog.open || root.contains(document.activeElement) && document.activeElement.matches('input, textarea, select')) return;
    await read();
  }
  function field(name, label, value = '', attrs = '') {
    return `<label>${label}<input name="${name}" value="${esc(value)}" ${attrs}></label>`;
  }
  function choice(name, label, options, value) {
    return `<label>${label}<select name="${name}">${selectOptions(options, value)}</select></label>`;
  }
  function openAction(action, context) {
    const data = sessions.get(context.session), w = data?.windows.find(w => windowId(w) === context.window) || windows.get(`${context.session}/${context.window}`)?.window;
    const session = data?.session || inventory?.sessions.find(s => s.target === context.session);
    const key = [action, context.session, context.workspace ?? '', context.window || ''].join('|');
    const draft = drafts.get(key) || {}, workspace = draft.workspace ?? context.workspace ?? data?.info?.current_workspace ?? 1;
    const task = store.state.agents.find(a => a.id === context.window)?.task_id;
    dialogContext = { action, ...context, key };
    let fields = '', hint = '', submitLabel = names[action];
    if (['create-session', 'label-session', 'rename-session', 'name-workspace', 'create-window', 'rename-window', 'split-window', 'create-agent'].includes(action)) {
      const value = draft.name ?? (action === 'label-session' ? session?.display_name || session?.label || '' : action === 'rename-session' ? session?.name || context.session : action === 'name-workspace' ? data?.workspaces.find(w => workspaceId(w) === context.workspace)?.name || '' : action === 'rename-window' ? paneName(w || {}) : '');
      fields += field('name', action === 'label-session' ? 'Display label (empty clears; address stays unchanged)' : 'Name', value, (['label-session', 'name-workspace', 'rename-window'].includes(action) ? '' : 'required ') + 'maxlength="120"');
    }
    if (['create-session', 'create-window'].includes(action)) fields += choice('host', 'Host', [{ value: '', label: 'Session / local default' }, ...(inventory?.hosts || []).filter(h => h.host !== 'local').map(h => ({ value: h.host, label: h.host }))], draft.host || '');
    if (['create-window', 'create-agent', 'move-window', 'name-workspace', 'select-workspace', 'close-workspace'].includes(action)) {
      fields += field('workspace', action === 'move-window' ? 'Destination numbered workspace · same session' : 'Numbered workspace', workspace, 'type="number" min="1" step="1" required list="native-workspace-options"');
      fields += `<datalist id="native-workspace-options">${knownWorkspaces(context.session).map(w => `<option value="${workspaceId(w)}">${esc(workspaceLabel(w))}</option>`).join('')}</datalist>`;
    }
    if (['create-window', 'create-agent'].includes(action)) {
      fields += `<label>Working directory <small>Optional · launch directory only</small><span class="browse"><input name="cwd" value="${esc(draft.cwd || '')}" list="path-options" autocomplete="off"><button type="button" data-native-browse>Browse…</button></span></label>`;
      hint = 'Directory changes apply only to this new pane. Native grants remain enforced. Remote panes use their native default directory; local OS picker paths cannot be sent to remote hosts.';
    }
    if (action === 'create-agent') {
      fields += choice('profileId', 'Agent profile', [{ value: '', label: 'Choose a profile' }, ...store.state.profiles.map(p => ({ value: p.id, label: p.name }))], draft.profileId || '');
      fields += choice('taskId', 'Assigned task (optional)', taskOptions(), draft.taskId || '');
      hint += ' Launch is asynchronous. Follow the real startup thread; accepted does not mean ready. Permissions and approvals remain in TUIOS.';
      submitLabel = 'Start agent';
    }
    if (action === 'accent-session') fields += field('accent', 'Native accent color (name or hex; empty clears)', draft.accent ?? data?.session.accent ?? '', 'maxlength="100"');
    if (action === 'split-window') { fields += choice('direction', 'Split direction', [{ value: 'horizontal', label: 'Horizontal' }, { value: 'vertical', label: 'Vertical' }], draft.direction || 'horizontal'); hint = 'Requires an attached terminal client. This explicitly creates another terminal pane beside the selected pane.'; }
    if (action === 'move-window') hint = 'Move only within this native session. Native cross-session pane transfer is not supported. Moving a pane does not change task assignment or task launch homes.';
    if (action === 'rename-session') hint = 'Changes the local native session address. Native pane UUIDs remain unchanged. Future task homes and recorded execution addresses are updated by the server.';
    if (action === 'assign-task') { fields += choice('taskId', 'Task assignment', taskOptions(), draft.taskId ?? task ?? ''); hint = 'Groups this pane and its work with a task. Independently reassigned records remain where you put them. Does not move the pane or change task launch homes.'; }
    if (action === 'bind-task') {
      fields += choice('taskId', 'Task to bind', [{ value: '', label: 'Choose a task' }, ...taskOptions().slice(1)], draft.taskId || '');
      fields += field('workspace', 'Future workspace (empty = session default)', draft.workspace ?? context.workspace ?? '', 'type="number" min="1" step="1"');
      hint = 'Future launches only. This sets the selected task’s session/workspace home; it never moves existing panes, changes their assignment, or rewrites history. Empty workspace binds the session default. A session per task remains the default.';
    }
    if (action === 'set-layout') {
      fields += choice('tiling', 'Tiling mode', [{ value: '', label: 'Leave unchanged' }, { value: 'true', label: 'Tiling' }, { value: 'false', label: 'Floating' }], draft.tiling || '');
      fields += choice('equalize', 'Equalize sizes', [{ value: '', label: 'No' }, { value: 'true', label: 'Yes' }], draft.equalize || '');
      fields += choice('rotate', 'Rotate layout', [{ value: '', label: 'No' }, { value: 'true', label: 'Yes' }], draft.rotate || '');
      fields += field('masters', 'Master panes (optional)', draft.masters || '', 'type="number" min="1" max="9"');
      fields += choice('masterPosition', 'Master position', [{ value: '', label: 'Leave unchanged' }, ...['left', 'right', 'top', 'bottom', 'center'].map(value => ({ value, label: value }))], draft.masterPosition || '');
      hint = `Session layout / current terminal workspace ${data?.info?.current_workspace || 1}. The workspace you are browsing is not selected automatically. Requires an attached terminal client.`;
    }
    if (action === 'send-prompt') {
      fields += `<label>Queued agent prompt<textarea name="body" required maxlength="16000" rows="7">${esc(draft.body || '')}</textarea></label>`;
      hint = 'Queues a new agent turn; this is not raw terminal input. It never approves tools, grants permissions or answers a pending native question. Answer questions in the existing agent inbox or your terminal.';
    }
    if (destructive.has(action)) {
      hint = action === 'interrupt-window' ? 'Sends Ctrl+C to this exact native pane. Its running work may be interrupted.' : action === 'close-window' ? 'Closes this native pane and stops its process.' : action === 'close-workspace' ? 'Closes all panes in this workspace. Their running work is stopped.' : 'Kills this local native session and every pane inside it. Running work is stopped.';
      fields += `<label class="native-confirm"><input name="confirmed" type="checkbox" required>I understand. ${esc(names[action])} in ${esc(context.session)}${context.window ? ' · ' + esc(context.window) : context.workspace != null ? ' · workspace ' + context.workspace : ''}.</label>`;
      submitLabel = `Confirm: ${names[action]}`;
    }
    dialog.innerHTML = `<form id="native-action-form"><div class="dialog-title"><div><p class="eyebrow">NATIVE TUIOS · ${esc(context.session || 'NEW SESSION')}</p><h2 id="native-dialog-title">${esc(names[action])}</h2></div><button type="button" data-native-cancel aria-label="Close dialog">×</button></div>${hint ? `<p class="hint">${esc(hint)}</p>` : ''}${fields}<p id="native-form-error" class="form-error danger" role="alert" hidden></p><div class="native-actions"><button type="button" data-native-cancel>Cancel</button><button type="submit" class="${destructive.has(action) ? 'danger' : 'primary'}">${esc(submitLabel)}</button></div></form>`;
    if (['create-agent', 'bind-task'].includes(action)) dialog.querySelector(`[name="${action === 'create-agent' ? 'profileId' : 'taskId'}"]`).required = true;
    syncDirectory();
    dialog.showModal();
    dialog.querySelector('input:not([type=checkbox]),textarea,select')?.focus();
  }
  async function mutate(action, context, values = {}) {
    const payload = { action, session: context.session, ...values };
    if (context.window) payload.window = context.window;
    if (context.workspace != null && payload.workspace == null && action !== 'set-layout') payload.workspace = context.workspace;
    for (const name of ['workspace', 'masters']) if (payload[name] !== undefined) {
      if (payload[name] === '') { if (action === 'bind-task') payload[name] = null; else delete payload[name]; }
      else payload[name] = Number(payload[name]);
    }
    if (['assign-task', 'create-agent'].includes(action)) payload.taskId = payload.taskId || null;
    for (const name of ['tiling', 'equalize', 'rotate']) if (payload[name] === '') delete payload[name]; else if (payload[name] !== undefined) payload[name] = payload[name] === 'true';
    for (const name of ['cwd', 'host', 'masterPosition']) if (!payload[name]) delete payload[name];
    if (destructive.has(action)) payload.confirmed = values.confirmed === 'on';
    const result = await api('/tuios/action', payload);
    notice = `${names[action]} accepted by TUIOS.`;
    if (result.threadId) {
      launches.set(result.threadId, action === 'create-agent' ? `Agent startup: ${values.name}` : 'Queued agent work');
      notice = action === 'create-agent' ? 'Startup accepted, not yet ready. Read the startup thread for the actual outcome.' : 'Agent prompt queued. Follow the work thread; permissions remain enforced.';
    }
    await refresh();
    if (action === 'rename-session' && route.session === context.session) location.hash = href(values.name, route.workspace, route.window);
    else if (action === 'create-session' && result.session) location.hash = href(result.session);
    else if (action === 'kill-session' && route.session === context.session) location.hash = '#tuios';
    else if (action === 'close-window' && route.window === context.window) location.hash = href(context.session, route.workspace);
    else if (action === 'close-workspace' && route.workspace === Number(payload.workspace)) location.hash = href(context.session);
    else if (action === 'move-window' && route.window === context.window) location.hash = href(context.session, payload.workspace, context.window);
    await read();
    return result;
  }
  root.addEventListener('input', e => {
    if (e.target.dataset.nativeFilter) { filter()[e.target.dataset.nativeFilter] = e.target.value; render(); }
  });
  root.addEventListener('change', e => {
    if (e.target.dataset.nativeFilter) { filter()[e.target.dataset.nativeFilter] = e.target.value; render(); }
  });
  root.addEventListener('scroll', e => { if (e.target.id === 'native-tree') treeScroll = e.target.scrollTop; }, true);
  root.addEventListener('toggle', e => { if (e.target.dataset.nativeTree) expanded.set(e.target.dataset.nativeTree, e.target.open); }, true);
  root.addEventListener('click', async e => {
    const button = e.target.closest('button'); if (!button || !supports(route)) return;
    if (button.hasAttribute('data-native-read')) return read();
    if (button.hasAttribute('data-native-clear')) { filters.set(scope(route), { search: '', host: '', status: '' }); render(); return; }
    const action = button.dataset.nativeAction; if (!action || mutation) return;
    const context = { session: button.dataset.session, window: button.dataset.window, workspace: button.dataset.workspace ? Number(button.dataset.workspace) : undefined };
    if (!direct.has(action)) return openAction(action, context);
    mutation = true; button.disabled = true;
    try { await mutate(action, context); } catch (err) { notice = err.message; render(); } finally { mutation = false; if (button.isConnected) button.disabled = false; }
  });
  dialog.addEventListener('click', async e => {
    const button = e.target.closest('button'); if (!button) return;
    if (button.hasAttribute('data-native-cancel')) return closeDialog();
    if (!button.hasAttribute('data-native-browse')) return;
    const context = dialogContext, field = dialog.querySelector('[name=cwd]');
    button.disabled = true;
    try {
      const { path } = await api('/pick-directory', {});
      if (path && dialogContext === context) { field.value = path; field.dispatchEvent(new Event('input', { bubbles: true })); }
      else if (path) drafts.set(context.key, { ...drafts.get(context.key), cwd: path });
    } catch (err) {
      if (dialogContext === context) { const error = dialog.querySelector('#native-form-error'); error.textContent = err.message; error.hidden = false; }
    } finally { if (dialogContext === context) syncDirectory(); }
  });
  dialog.addEventListener('submit', async e => {
    e.preventDefault();
    if (mutation) return;
    const context = dialogContext, form = e.target, values = Object.fromEntries(new FormData(form)), error = form.querySelector('#native-form-error');
    saveDraft(); mutation = true; form.dataset.submitting = '';
    const controls = [...form.querySelectorAll('button, input, select, textarea')].map(control => ({ control, disabled: control.disabled }));
    controls.forEach(({ control }) => control.disabled = true); error.hidden = true;
    try { await mutate(context.action, context, values); drafts.delete(context.key); if (dialogContext === context) dialog.close(); }
    catch (err) { error.textContent = err.message; error.hidden = false; }
    finally { mutation = false; delete form.dataset.submitting; controls.forEach(({ control, disabled }) => control.disabled = disabled); }
  });
  function interrupt(pane) {
    if (!pane?.session) throw new Error('This pane’s native session is not available. Reconcile sessions before interrupting it.');
    openAction('interrupt-window', { session: pane.session, window: pane.id });
  }
  return { supports, render, enter, update, interrupt };
}
