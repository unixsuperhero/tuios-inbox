// State, hash routes, modal continuations and native-session work dispatch.
import { createList } from '/list.js';
import { createWorkbench, patchHTML, terminalResponse } from '/workbench.js';
import { createQueues } from '/queues.js';
import { createTuios } from '/tuios.js';
import { createHistory } from '/history.js';
import { setupLaunchHost, hostUnavailable, machineLabel } from '/launch-host.js';
import { choosePath } from '/path-picker.js';
import { createOutline, outlineHash, queueHash } from '/outline.js';
import { pages, pageForRoute, metadataForRoute, recipients, store, api, apiCached, NOT_MODIFIED, esc, taskTree, editKey } from '/pages.js';
import { applyTaskStyles } from '/task-style-dom.js';
import { resolve } from '/outline-model.js';
const $ = s => document.querySelector(s);
const root = $('#list'), metadata = $('#page-metadata'), loading = new Set(), asking = new Set();
const previousValues = new WeakMap(), creations = new Map(), draftRevisions = new Map(), submissions = new WeakMap();
const modalStack = [];
const activeDialog = () => [...modalStack].reverse().find(dialog => dialog.open);
function openDialog(dialog) {
  const index = modalStack.indexOf(dialog); if (index !== -1) modalStack.splice(index, 1);
  modalStack.push(dialog); dialog.showModal();
}
const inboxDraft = { recipientId: '', body: '', revision: 0 };
const scopedDrafts = new Map(), viewCache = new Map(), composeDrafts = new Map();
const paneHosts = new Map(), pathEpochs = new WeakMap(), pathRequests = new WeakMap();
const tasksMap = () => new Map(store.state.tasks.map(t => [t.id, t]));
const availableHost = host => Boolean(host && store.liveHosts?.some(h => h.host === host && !hostUnavailable(h)));
const machineName = host => host ? machineLabel(store.liveHosts?.find(h => h.host === host) || { host }) : 'not selected';
const portableExecutable = value => Boolean(value && !value.includes('/') && !value.includes('\\') && !/\s/.test(value) && !value.startsWith('~') && value !== '.' && value !== '..');
const profileFits = (profile, host) => portableExecutable(profile.executable) || profile.executable_host === host;
function paneProfileFits(profile, form) {
  const host = formHost(form), session = paneExecution(form).session?.value || '';
  return profileFits(profile, host) && !(host && host !== 'local' && ((profile.protocol && (!session.includes(':') || session.startsWith('local:'))) || Object.keys(profile.env || {}).length));
}
function invalidatePaths(owner) {
  pathEpochs.set(owner, (pathEpochs.get(owner) || 0) + 1);
  pathRequests.get(owner)?.abort(); pathRequests.delete(owner);
}
function formHost(form) {
  if (form.getAttribute('id') !== 'task-form') return form.elements.host.value;
  const parent = store.state.tasks.find(t => t.id === form.elements.parent_id.value);
  return form.elements.host.value || (parent && resolve(parent, tasksMap()).host?.value) || '';
}
function paneExecution(form) {
  const task = store.state.tasks.find(t => t.id === form.elements.taskId.value) || {};
  return resolve({ ...task, host: form.elements.host.value, own: { ...(task.own || task), host: form.elements.host.value } }, tasksMap());
}
function paneHostScope(form) {
  const key = form.elements.taskId.value || '';
  form.dataset.hostScope = key;
  const task = store.state.tasks.find(t => t.id === key);
  const value = form.dataset.hostChosen === 'true' ? form.elements.host.value : paneHosts.get(key) || resolve(task || {}, tasksMap()).host?.value || '';
  const select = form.elements.host;
  if (value && ![...select.options].some(o => o.value === value)) { const option = new Option(machineName(value), value); option.disabled = true; select.add(option); }
  select.value = value;
  paneDirectory(form, true);
}
function paneDirectory(form, reset = false) {
  const host = formHost(form), res = paneExecution(form);
  if (reset) { form.dataset.cwdInherited = 'true'; invalidatePaths(form); form.elements.cwd.value = res.paths_host?.value === host ? res.cwd?.value || '' : ''; form.elements.paths_host.value = form.elements.cwd.value ? host : ''; }
  form.elements.cwd.disabled = !availableHost(host);
  form.querySelector('[data-id=cwd]').disabled = !availableHost(host);
  $('#pane-path-note').textContent = res.paths_mismatch?.value ? 'Task directory “' + res.paths_mismatch.path + '” belongs to ' + machineName(res.paths_mismatch.host) + ', not ' + machineName(host) + '. Choose a directory on this machine or switch back before launching.' : host ? 'Directory on ' + machineName(host) + '. Matching task directories are inherited; changes here affect this launch only.' : 'Choose an execution machine before choosing a directory or profile.';
  paneKind();
}
function taskDirectoryPicker() {
  const form = $('#task-form'), host = formHost(form), old = form.dataset.pathHost || '';
  if (old !== host) { invalidatePaths(form); form.elements.path.value = ''; form.elements.worktree.value = ''; form.elements.paths_host.value = ''; }
  form.dataset.pathHost = host;
  for (const field of [form.elements.path, form.elements.worktree]) field.disabled = !availableHost(host);
  for (const button of form.querySelectorAll('[data-do=browse]')) button.disabled = !availableHost(host);
  const parent = store.state.tasks.find(t => t.id === form.elements.parent_id.value);
  const res = resolve({ parent_id: parent?.id, host }, tasksMap());
  form.elements.host.options[0].textContent = parent ? 'Inherit parent machine: ' + machineName(resolve(parent, tasksMap()).host?.value) : 'Choose an execution machine';
  $('#task-host-note').textContent = res.paths_mismatch?.value ? 'Parent directory belongs to ' + machineName(res.paths_mismatch.host) + '. Choose a project or existing worktree on ' + machineName(host) + '; it cannot be inherited across machines.' : host ? 'Execution on ' + machineName(host) + (form.elements.host.value ? '' : ' · inherited from parent') + '. Directories below belong to this machine.' : 'Choose a machine, or a parent with an execution machine, before entering paths.';
  suggestPaths(form);
}
function profileMachine(form, reset = false) {
  const host = form.elements.host.value, portable = form.elements.portable.checked;
  if (reset) {
    invalidatePaths(form);
    if (form.elements.executable.value && !portableExecutable(form.elements.executable.value) && form.elements.executable_host.value !== host) { form.elements.executable.value = ''; form.elements.executable_host.value = ''; }
    if (portable && !portableExecutable(form.elements.executable.value)) form.elements.executable.value = '';
  }
  form.elements.host.disabled = portable;
  form.elements.executable.disabled = !(portable || availableHost(host));
  form.querySelector('[data-do=browse]').disabled = portable || !availableHost(host);
  $('#profile-host-note').textContent = portable ? 'Portable command names use PATH on each selected execution machine. Slashes and filesystem paths are not portable.' : host ? 'Executable files belong to ' + machineName(host) + '. Changing machines never moves or retags a saved executable.' : 'Choose a machine before entering or browsing an executable file, or choose a portable command.';
}
function retainedHost(key) {
  const id = key.split('|')[0], tasks = tasksMap(), task = tasks.get(id), host = resolve(task || {}, tasks).host?.value || '';
  const pending = new Map([...tasks].map(([tid, t]) => [tid, { ...t, ...Object.fromEntries(['home', 'parent'].flatMap(section => { const d = store.edits.get(editKey(tid, section)); return d ? Object.entries(d).filter(([k]) => ['host','parent_id'].includes(k)) : []; })) }]));
  return resolve(pending.get(id) || {}, pending).host?.value === host ? host : '';
}
function pathContext(field) {
  if (field.form) return { owner: field.form, host: formHost(field.form), active: field.form.closest('dialog')?.open };
  const key = field.dataset.edit, draft = store.edits.get(key);
  return { owner: draft, host: draft && retainedHost(key), active: Boolean(draft && field.isConnected && draft.capture_host === retainedHost(key)) };
}
async function browsePath(button) {
  const field = button.form ? button.form.elements[button.dataset.id] : document.getElementById(button.dataset.id);
  if (!field || field.disabled) return;
  const { owner, host, active } = pathContext(field);
  if (!owner || !active || !availableHost(host)) throw new Error('Choose and save an available execution machine before choosing a path.');
  invalidatePaths(owner);
  const epoch = pathEpochs.get(owner), controller = new AbortController(), prior = field.value, key = field.dataset.edit, signature = button.form ? formPathSignature(button.form) : taskPathSignature(key.split('|')[0]);
  pathRequests.set(owner, controller); button.disabled = true;
  try {
    const kind = button.dataset.picker === 'file' ? 'file' : 'directory';
    const result = await choosePath({ host, kind, path: kind === 'file' ? prior.includes('/') ? prior.slice(0, prior.lastIndexOf('/')) || '/' : '' : prior, title: kind === 'file' ? 'Choose executable on ' + machineName(host) : 'Choose directory on ' + machineName(host), signal: controller.signal });
    const current = button.form ? button.form.elements[button.dataset.id] : document.getElementById(button.dataset.id);
    if (!availableHost(host) || !result || result.host !== host || controller.signal.aborted || pathEpochs.get(owner) !== epoch || !current || current.value !== prior || (key && store.edits.get(key) !== owner) || pathContext(current).host !== host || !pathContext(current).active || signature !== (button.form ? formPathSignature(button.form) : taskPathSignature(key.split('|')[0]))) return;
    current.value = result.path; current.dispatchEvent(new Event('input', { bubbles: true })); current.dispatchEvent(new Event('change', { bubbles: true }));
  } finally { if (pathRequests.get(owner) === controller) pathRequests.delete(owner); if (button.isConnected) button.disabled = !availableHost(pathContext(field).host) || field.disabled; }
}
function bindFormPath(target) {
  const form = target.form;
  if (!form) return;
  if (form.getAttribute('id') === 'task-form' && ['path','worktree'].includes(target.name)) form.elements.paths_host.value = target.value || form.elements.path.value || form.elements.worktree.value ? formHost(form) : '';
  if (form.getAttribute('id') === 'pane-form' && target.name === 'cwd') { form.dataset.cwdInherited = 'false'; form.elements.paths_host.value = target.value ? formHost(form) : ''; }
  if (form.getAttribute('id') === 'profile-form' && target.name === 'executable') form.elements.executable_host.value = portableExecutable(target.value) ? '' : formHost(form);
}
function composerDraft() {
  if (!route || route.kind === 'index') return inboxDraft;
  const key = routeKey(route);
  if (!scopedDrafts.has(key)) scopedDrafts.set(key, { recipientId: route.kind === 'agent' ? route.id : '', body: '', revision: 0 });
  return scopedDrafts.get(key);
}
function composerRecipients() {
  if (route?.kind === 'task') return recipients({ taskId: route.id });
  if (route?.kind === 'agent') return recipients().filter(r => r.value === route.id);
  return recipients();
}
const workbench = createWorkbench({ root, navigate, load, review: reviewItem, refresh, report: error });
const queues = createQueues({ root, navigate, load, review: reviewItem, refresh, report: error });
const tuios = createTuios({ root, refresh });
const history = createHistory({ root, report: error });
const outline = createOutline({ report: error });
async function reviewItem(id, unread = false) {
  await api('/items/update', { ids: [id], set: { unread } });
  await refresh();
}
// Opening a record is reading it. Commands are counted apart from everything else.
function openRead(id) {
  const row = store.state.items.find(i => i.id === id);
  if (row?.unread) act(() => reviewItem(id));
}
function routePage(r) {
  if (r.kind === 'queue') return pages.queues;
  if (r.kind === 'history') return { ...pages.history, title: 'History record', description: 'One archived record in full, with where it came from.' };
  if (r.kind !== 'item') return pageForRoute(r);
  const row = store.state.items.find(i => i.id === r.id);
  return row ? { ...pages.inbox, title: row.title || 'Work record', description: `${row.type} · ${row.status}` } : null;
}
function rememberCompose() {
  const form = $('#compose-form');
  if (form.dataset.taskId) composeDrafts.set(form.dataset.taskId, Object.fromEntries(new FormData(form)));
}
function compose(taskId, agentId) {
  rememberCompose();
  const form = $('#compose-form'); form.dataset.taskId = taskId;
  form.reset(); updateMenus();
  for (const [key, value] of Object.entries(composeDrafts.get(taskId) || {})) if (form.elements[key]) form.elements[key].value = value;
  if (agentId && recipients({ taskId }).some(r => r.value === agentId)) form.elements.paneId.value = agentId;
  openDialog($('#compose-dialog'));
}
let route, page, list, terminalPane = null, refreshTimer, refreshVersion = 0;
const routeKey = r => r?.kind === 'tuios' ? r.view === 'overview' ? 'tuios-overview' : `tuios/${r.session || ''}/${r.workspace || ''}/${r.window || ''}` : r?.kind === 'outline' ? 'outline' : r?.kind === 'index' ? r.page : r?.kind === 'queue' ? `queue/${r.bucket}/${r.item || ''}` : `${r?.kind}/${r?.id}`;
function parseRoute(hash) {
  const path = hash.replace(/^#\/?/, '');
  // #outline/needs-me/<task id> is the review queue of one task; the page is the same one, so it never remounts.
  if (!path) return { kind: 'outline', view: 'tasks' };
  // #outline/tasks is the task list; #outline/task/<id>, #outline/run/<turn id> and #outline/prompt/<id> open one line of the rail's tree.
  const opened = /^outline\/(task|run|prompt)\/([^/]+)$/.exec(path);
  if (opened) { try { const key = decodeURIComponent(opened[2]); return { kind: 'outline', view: 'open', sel: opened[1] === 'task' ? key === 'none' ? 'none' : `task:${key}` : opened[1] === 'run' ? `run:turn:${key}` : `prompt:${key}` }; } catch {} }
  // #queue is everything that waits; #queue/task/<id>, #queue/session/<name> and #queue/pane/<id> are its scopes. One page, so it never remounts.
  const waiting = /^queue(?:\/(task|session|pane)\/([^/]+))?$/.exec(path);
  if (waiting) { try { return { kind: 'outline', view: 'queue', scope: waiting[1] ? { type: waiting[1], id: decodeURIComponent(waiting[2]) } : { type: 'all' } }; } catch {} }
  const outlineView = /^(?:outline(?:\/([\w-]+)(?:\/([^/]+))?)?)?$/.exec(path);
  if (outlineView && (!outlineView[2] || outlineView[1] === 'needs-me')) { try { return { kind: 'outline', view: outlineView[1] || 'tasks', ...(outlineView[2] ? { task: decodeURIComponent(outlineView[2]) } : {}) }; } catch {} }
  if (path === 'tuios-overview') return { kind: 'tuios', view: 'overview' };
  const native = /^tuios(?:\/([^/]+)(?:\/(\d+)(?:\/([^/]+))?)?)?$/.exec(path);
  if (native) { try { return { kind: 'tuios', session: native[1] ? decodeURIComponent(native[1]) : undefined, workspace: native[2] ? Number(native[2]) : undefined, window: native[3] ? decodeURIComponent(native[3]) : undefined }; } catch {} }
  if (Object.hasOwn(pages, path)) return { kind: 'index', page: path };
  const match = /^(task|agent|item|history)\/([^/]+)$/.exec(path);
  if (match) { try { return { kind: match[1], id: decodeURIComponent(match[2]) }; } catch {} }
  const queue = /^queues\/([^/]+)(?:\/(.+))?$/.exec(path);
  if (queue) { try { return { kind: 'queue', bucket: decodeURIComponent(queue[1]), item: queue[2] ? decodeURIComponent(queue[2]) : undefined }; } catch {} }
  return { kind: 'invalid' };
}
const routeHash = r => r.kind === 'outline' && r.view === 'open' ? outlineHash(r.sel) : r.kind === 'outline' && r.view === 'queue' ? queueHash(r.scope) : r.kind === 'outline' ? `#outline${r.view && r.view !== 'everything' ? '/' + r.view : ''}${r.view === 'needs-me' && r.task ? '/' + encodeURIComponent(r.task) : ''}` : r.kind === 'tuios' ? r.view === 'overview' ? '#tuios-overview' : `#tuios${r.session ? '/' + encodeURIComponent(r.session) : ''}${r.workspace ? '/' + r.workspace : ''}${r.window ? '/' + encodeURIComponent(r.window) : ''}` : r.kind === 'index' ? `#${r.page}` : r.kind === 'queue' ? `#queues/${encodeURIComponent(r.bucket)}${r.item ? '/' + encodeURIComponent(r.item) : ''}` : `#${r.kind}/${encodeURIComponent(r.id)}`;
function navigate(next) {
  const hash = routeHash(next);
  if (location.hash === hash) mount(next); else location.hash = hash;
}
function error(e, dialog = activeDialog()) {
  if (dialog) {
    let notice = dialog.querySelector('.form-error');
    if (!notice) { notice = document.createElement('p'); notice.className = 'form-error danger'; notice.setAttribute('role', 'alert'); dialog.append(notice); }
    notice.textContent = e.message;
  } else { $('#error').hidden = false; $('#error').textContent = e.message; }
}
function toast(text) { $('#toast').textContent = text; $('#toast').hidden = false; setTimeout(() => $('#toast').hidden = true, 3500); }
async function act(fn, report = error) { $('#error').hidden = true; try { return await fn(); } catch (e) { report(e); } }
const newChoices = kinds => kinds.map(kind => ({ value: `__new_${kind}`, label: `New ${kind[0].toUpperCase() + kind.slice(1)}…`, createKind: kind }));
function setChoices(select, choices, value = select.value, placeholder = 'Choose…') {
  let html = `<option value="">${esc(placeholder)}</option>`;
  html += choices.map(c => `<option value="${esc(c.value)}"${c.disabled ? ' disabled' : ''}${c.createKind ? ` data-create-kind="${c.createKind}"` : ''}>${esc(c.label)}</option>`).join('');
  if (value && !choices.some(c => c.value === value) && !value.startsWith('__new_')) html += `<option value="${esc(value)}" disabled>Unavailable · ${esc(value)}</option>`;
  if (select.innerHTML !== html) select.innerHTML = html;
  select.value = value;
  previousValues.set(select, value);
}
function updateMenus() {
  if (document.activeElement !== $('#inbox-recipient')) setChoices($('#inbox-recipient'), [...composerRecipients(), ...(route?.kind === 'agent' ? [] : newChoices(['agent', 'pane']))], composerDraft().recipientId, 'Choose an Agent or Pane');
  const composer = $('#inbox-composer');
  if (!composer.dataset.submitting) composer.querySelector('button.primary').disabled = !composerRecipients().some(r => r.value === composerDraft().recipientId);
  const pane = $('#pane-form');
  if (document.activeElement !== $('#pane-task')) setChoices($('#pane-task'), [...store.state.tasks.map(t => ({ value: t.id, label: t.title })), ...newChoices(['task'])]);
  if (document.activeElement !== $('#profile-options')) setChoices($('#profile-options'), store.state.profiles.map(p => ({ value: p.id, label: p.name + (paneProfileFits(p, pane) ? '' : ' · incompatible with this machine/session'), disabled: !paneProfileFits(p, pane) || !availableHost(pane.elements.host.value) })), pane.elements.profileId.value, 'Choose an agent profile');
  const composeTask = $('#compose-form').dataset.taskId;
  if (composeTask && document.activeElement !== $('#compose-panes')) setChoices($('#compose-panes'), [...recipients({ taskId: composeTask }), ...newChoices(['agent', 'pane'])]);
  const mailTask = $('#mail-form').dataset.taskId;
  if (mailTask) {
    const from = recipients({ taskId: mailTask, mail: true });
    const session = from.find(p => p.value === $('#mail-from').value)?.session;
    if (document.activeElement !== $('#mail-from')) setChoices($('#mail-from'), [...from, ...newChoices(['agent', 'pane'])]);
    if (document.activeElement !== $('#mail-to')) setChoices($('#mail-to'), [{ value: 'human', label: 'Your TUIOS inbox' }, ...recipients({ taskId: mailTask, mail: true, session: session || '__unselected__' })]);
  }
}
function taskPathSignature(id) {
  const tasks = tasksMap(), rows = [], seen = new Set();
  while (id && !seen.has(id)) { seen.add(id); const task = tasks.get(id); if (!task) { rows.push(id); break; } rows.push([id,task.host,task.parent_id,task.paths_host,task.path,task.worktree]); id = task.parent_id; }
  return JSON.stringify(rows);
}
function formPathSignature(form) { return taskPathSignature(form.getAttribute('id') === 'task-form' ? form.elements.parent_id.value : form.getAttribute('id') === 'pane-form' ? form.elements.taskId.value : ''); }
const pathSignatures = new WeakMap();
function syncPathForms() {
  const sync = (owner, signature) => { if (pathSignatures.has(owner) && pathSignatures.get(owner) !== signature) invalidatePaths(owner); pathSignatures.set(owner, signature); };
  for (const id of ['task-form','pane-form','profile-form']) { const form = $('#' + id); sync(form, formPathSignature(form)); }
  for (const [key, draft] of store.edits) if (key.endsWith('|paths')) sync(draft, taskPathSignature(key.split('|')[0]));
  if ($('#task-dialog').open) taskDirectoryPicker();
  const form = $('#pane-form');
  if ($('#pane-dialog').open) {
    const task = store.state.tasks.find(t => t.id === form.elements.taskId.value);
    const seeded = paneHosts.get(form.elements.taskId.value) || resolve(task || {}, tasksMap()).host?.value || '';
    if (form.dataset.hostChosen !== 'true' && form.elements.host.value !== seeded) paneHostScope(form);
    const res = paneExecution(form), inherited = res.paths_host?.value === formHost(form) ? res.cwd?.value || '' : '';
    paneDirectory(form, form.dataset.cwdInherited === 'true' && form.elements.cwd.value !== inherited);
  }
}
function render() {
  syncPathForms();
  const unread = store.state.items.filter(i => i.unread && !i.archived), commands = unread.filter(i => i.type === 'command').length;
  $('#unread-count').textContent = unread.length - commands;
  fillPathOptions();
  $('#unread-count').title = commands ? `Unread, plus ${commands} unread command${commands === 1 ? '' : 's'}` : 'Unread';
  $('#task-count').textContent = store.state.tasks.filter(t => t.status !== 'done').length;
  $('#queue-count').textContent = queues.count();
  updateMenus();
  if (!route) return;
  const nextPage = routePage(route);
  if (nextPage && ['task', 'agent'].includes(route.kind)) patchHTML(metadata, metadataForRoute(route));
  applyTaskStyles(metadata, store.state.tasks);
  workbench.render(route);
  if (!nextPage) {
    list?.destroy(); list = null; page = null; metadata.hidden = true;
    $('#page-title').textContent = 'Page unavailable';
    document.title = 'tuios inbox · Page unavailable';
    $('#page-description').textContent = 'This link is invalid or the record is no longer available. Return to the index to choose another record.';
    root.innerHTML = '<p class="list-empty">No record at this address.</p>';
    return;
  }
  if (outline.supports(route)) { page = nextPage; outline.render(); return; }
  if (queues.supports(route)) { page = nextPage; $('#page-title').textContent = page.title; $('#page-description').textContent = page.description; document.title = `tuios inbox · ${page.title}`; queues.render(route); return; }
  if (tuios.supports(route)) { page = nextPage; $('#page-title').textContent = page.title; $('#page-description').textContent = page.description; document.title = `tuios inbox · ${page.title}`; tuios.render(route); return; }
  if (history.supports(route)) { page = nextPage; $('#page-title').textContent = page.title; $('#page-description').textContent = page.description; document.title = `tuios inbox · ${page.title}`; history.render(route); return; }
  if (!list && !workbench.supports(route)) { mount(route); return; }
  page = nextPage;
  $('#page-title').textContent = page.title;
  $('#page-description').textContent = page.description;
  document.title = `tuios inbox · ${page.title}`;
  if (workbench.supports(route)) return;
  list.setRows(page.rows());
  applyTaskStyles(root, store.state.tasks);
  if (page.items) for (const el of root.querySelectorAll('.list-rows > .item[open]')) load(el.dataset.id).catch(error);
}
// `live` is a refresh nobody asked for (a change event): when the server still holds what the page has, nothing is parsed, rebuilt or drawn.
async function refresh(live = false) {
  const version = ++refreshVersion, state = await apiCached('/state');
  if (version !== refreshVersion) return;
  if (state === NOT_MODIFIED) { if (!live) render(); return; }
  // A question is kept only while its turn still waits on it; the next one is read afresh.
  for (const agent of store.questions.keys()) if (!state.items.some(i => i.agent_id === agent && i.type === 'turn' && i.status === 'needs_input')) store.questions.delete(agent);
  store.state = state; render();
  for (const context of creations.values()) if (context.threadId || context.paneId) checkStartup(context);
}
// Read on demand, never on a timer: when a row opens, after an answer, or from "Read again".
async function question(agent, fresh) {
  if (asking.has(agent) || (!fresh && store.questions.has(agent))) return;
  asking.add(agent);
  try { store.questions.set(agent, { data: await api(`/agents/${encodeURIComponent(agent)}/question`) }); }
  catch (e) { store.questions.set(agent, { error: e.message }); }
  finally { asking.delete(agent); }
  render();
}
// The prompt is read again after every answer, pressed or refused: a refusal usually means it changed.
async function answer(agent, body, sent) {
  try { await api(`/agents/${encodeURIComponent(agent)}/answer`, body); sent?.(); toast('Answer sent'); }
  finally { store.questions.delete(agent); await saved(); }
}
async function load(key, opened) {
  const row = store.state.items.find(i => i.id === key); if (!row) return;
  if (row.type === 'turn' && row.status === 'needs_input' && row.agent_id) question(row.agent_id, opened).catch(error);
  if (['dispatch', 'command'].includes(row.type) && row.status === 'running') return;
  const cached = store.bodies.get(key), revision = { updated: row.updated, title: row.title, status: row.status, archived: row.archived, response_captured: row.response_captured };
  if ((!cached || Object.keys(revision).some(field => cached[field] !== revision[field])) && !loading.has(key)) {
    loading.add(key);
    try { store.bodies.set(key, { ...revision, data: await api(`/${key.replace(':', 's/')}`) }); }
    catch (e) { store.bodies.set(key, { ...revision, error: e.message }); }
    finally { loading.delete(key); }
    render();
  }

}
async function saved() {
  if (root.contains(document.activeElement) || metadata.contains(document.activeElement)) document.activeElement.blur();
  await refresh();
}
function mount(next) {
  const oldKey = route && routeKey(route), nextKey = routeKey(next), main = root.closest('main');
  if (oldKey !== nextKey) {
    document.body.dataset.workbenchView = 'content';
    list?.destroy(); list = null;
    if (oldKey) {
      const content = document.createDocumentFragment(); content.append(...root.childNodes);
      viewCache.set(oldKey, { content, scroll: main.scrollTop });
    }
    root.replaceChildren();
    const cached = viewCache.get(nextKey); if (cached) root.append(cached.content);
  }
  route = next; page = routePage(route);
  if (oldKey !== nextKey) { if (next.kind === 'item') openRead(next.id); else if (next.kind === 'queue' && next.item) openRead(next.item); }
  const index = next.kind === 'outline' ? 'outline' : next.kind === 'tuios' ? 'tuios' : next.kind === 'index' ? next.page : next.kind === 'task' ? 'tasks' : next.kind === 'agent' ? 'agents' : next.kind === 'item' ? 'inbox' : next.kind === 'queue' ? 'queues' : next.kind === 'history' ? 'history' : '';
  document.body.dataset.routeKind = next.kind;
  document.body.classList.toggle('outline-mode', outline.supports(next));
  document.body.classList.toggle('queues-mode', queues.supports(next));
  document.body.classList.toggle('tuios-mode', tuios.supports(next));
  document.querySelectorAll('[data-page]').forEach(link => {
    const active = link.dataset.page === index; link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  // Navigation, never a live refresh, opens More for a page that lives in it and closes the phone's tree sheet.
  if (oldKey !== nextKey && $('#rail-more').querySelector(`[data-page="${index}"]`)) $('#rail-more').open = true;
  document.body.classList.remove('rail-open'); $('#rail-toggle').setAttribute('aria-expanded', 'false');
  $('#section-name').textContent = (index || 'Unavailable').toUpperCase();
  $('#add-profile').hidden = index !== 'profiles';
  $('#inbox-composer').hidden = !(['task', 'agent'].includes(next.kind) || next.kind === 'index' && next.page === 'inbox');
  $('#work-composer').hidden = $('#inbox-composer').hidden;
  const composer = $('#inbox-composer');
  composer.elements.body.value = composerDraft().body;
  if (next.kind === 'task') { composer.dataset.taskId = next.id; $('#inbox-recipient').dataset.taskScope = ''; }
  else { delete composer.dataset.taskId; delete $('#inbox-recipient').dataset.taskScope; }
  $('#page-back').hidden = next.kind === 'index' || tuios.supports(next);
  $('#page-back').href = `#${index || 'inbox'}`;
  $('#page-back').textContent = `← Back to ${index || 'Inbox'}`;
  metadata.hidden = !['task', 'agent'].includes(next.kind) || !page;
  if (oldKey !== nextKey) metadata.replaceChildren();
  if (!metadata.hidden) patchHTML(metadata, metadataForRoute(next));
  list?.destroy(); list = null;
  if (page && !outline.supports(route) && !workbench.supports(route) && !queues.supports(route) && !tuios.supports(route) && !history.supports(route)) list = createList(root, { ...page.list,
    onOpen: page.items ? row => navigate({ kind: 'item', id: row.id }) : undefined,
    actions: (page.list.actions || []).map(a => ({ ...a, run: async (ids, value) => { $('#error').hidden = true; await a.run(ids, value); await refresh(); } })) });
  render();
  outline.enter(next);
  tuios.enter(next, oldKey !== nextKey).catch(e => error(e, null));
  history.enter(next, oldKey !== nextKey).catch(e => error(e, null));
  if (oldKey !== nextKey) main.scrollTop = viewCache.get(nextKey)?.scroll || 0;
}
function ownerActive(context) {
  if (typeof context.owner === 'function') return context.owner();
  if (context.owner) return context.owner.isConnected !== false;
  return routeKey(route) === context.routeKey;
}
function finishCreation(context, choice) {
  if (creations.get(context.dialog) !== context) return;
  clearTimeout(context.timer); creations.delete(context.dialog);
  const last = context.created ? { value: context.created.id, label: context.created.title } : null;
  const result = choice && ownerActive(context) ? choice : last;
  if (context.multi) { $('#task-created').hidden = true; $('#task-form').reset(); }
  context.dialog.close();
  submissions.delete(context.dialog.querySelector('form'));
  const submit = context.dialog.querySelector('button.primary'); submit.disabled = false;
  context.resolve(result);
  if (context.parent?.open) context.returnFocus?.focus();
}
function paneKind() {
  const form = $('#pane-form'), shell = form.elements.kind.value === 'shell';
  $('#pane-dialog-title').textContent = shell ? 'New pane' : 'New agent';
  $('#pane-profile-label').hidden = shell;
  form.elements.profileId.disabled = shell || !availableHost(form.elements.host.value);
  updateMenus();
  form.elements.profileId.setCustomValidity(!shell && form.elements.profileId.value && form.elements.profileId.selectedOptions[0]?.disabled ? 'Select a profile compatible with this execution machine.' : '');
  form.querySelector('button.primary').textContent = shell ? 'Create pane' : 'Create agent';
}
// The paths this machine's tasks already use, most used first, plus their parent folders: a native
// datalist for typing and quick picks for the top few. Browse… remains the picker for anything else.
function knownPaths(host) {
  const counts = new Map();
  for (const t of store.state.tasks.filter(t => host && t.paths_host === host)) for (const p of [t.path, t.worktree]) if (p) counts.set(p, (counts.get(p) || 0) + 1);
  const parents = new Map();
  for (const p of counts.keys()) { const parent = p.replace(/\/[^/]+\/?$/, ''); if (parent && parent !== p) parents.set(parent, (parents.get(parent) || 0) + 1); }
  const rank = m => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([p]) => p);
  return { used: rank(counts), parents: rank(parents).filter(p => !counts.has(p)) };
}
function fillPathOptions() {
  const { used, parents } = knownPaths(formHost($('#task-form')));
  $('#path-options').replaceChildren();
  $('#task-path-options').replaceChildren(...[...used, ...parents].map(p => Object.assign(document.createElement('option'), { value: p })));
}
function suggestPaths(form) {
  fillPathOptions();
  const host = formHost(form), { used } = knownPaths(host), worktrees = store.state.tasks.filter(t => host && t.paths_host === host).map(t => t.worktree).filter(Boolean);
  for (const box of form.querySelectorAll('[data-picks]')) {
    const picks = [...(box.dataset.picks === 'worktree' ? worktrees : []), ...used].filter((p, i, a) => a.indexOf(p) === i).slice(0, 4);
    box.replaceChildren(...picks.map(p => { const b = document.createElement('button'); b.type = 'button'; b.textContent = p; b.dataset.host = host; b.title = p; b.dataset.do = 'fill'; b.dataset.id = box.dataset.picks; b.dataset.value = p; return b; }));
    box.hidden = !picks.length;
  }
}
function suggestParent(select, parentId) {
  const options = taskTree().filter(t => !t.archived).map(t => ({ value: t.id, label: '\u2014 '.repeat(t.depth) + t.title }));
  setChoices(select, options, options.some(o => o.value === parentId) ? parentId : '', 'No parent · top-level task');
}
store.createEntity = ({ kind, taskId, owner, parentId } = {}) => {
  const dialog = kind === 'task' ? $('#task-dialog') : $('#pane-dialog');
  if (!['task', 'agent', 'pane'].includes(kind) || creations.has(dialog)) return Promise.resolve(null);
  const parent = activeDialog();
  const returnFocus = document.activeElement;
  const notice = dialog.querySelector('.form-error'); if (notice) notice.remove();
  // A task page's "+ New task" or "New subtask…" proposes that task as the parent; it can be cleared.
  if (kind === 'task') { const form = $('#task-form'); invalidatePaths(form); suggestParent($('#task-parent'), parentId ?? (route?.kind === 'task' ? route.id : '')); if (parent?.id === 'pane-dialog' && !form.elements.host.value) { const host = $('#pane-form').elements.host.value; if (host && ![...form.elements.host.options].some(o => o.value === host)) form.elements.host.add(new Option(machineName(host), host)); form.elements.host.value = host; } taskDirectoryPicker(); setupLaunchHost(form, api, store).catch(e => error(e, dialog)); }
  if (kind !== 'task') {
    const form = $('#pane-form');
    form.dataset.hostChosen = 'false';
    form.elements.kind.value = kind === 'pane' ? 'shell' : 'agent';
    form.elements.kind.disabled = true;
    form.elements.taskId.disabled = Boolean(taskId);
    form.elements.taskId.closest('label').hidden = Boolean(taskId);
    updateMenus();
    if (taskId) { form.elements.taskId.value = taskId; previousValues.set(form.elements.taskId, taskId); }
    paneHostScope(form);
    $('#pane-startup-status').textContent = ''; paneKind();
    setupLaunchHost(form, api, store).catch(e => error(e, dialog));
  }
  return new Promise(resolve => {
    // "+ New task" is a batch entry: the dialog stays open after each task. A "New Task…" choice inside a select creates one and returns to it.
  const context = { kind, taskId, owner, parent, returnFocus, dialog, resolve, routeKey: routeKey(route), accepted: false, multi: kind === 'task' && !owner && !parent, created: null };
    creations.set(dialog, context); openDialog(dialog); dialog.querySelector('[data-host-label] select').focus();
  });
};
async function checkStartup(context) {
  if (context.checking || creations.get(context.dialog) !== context) return;
  if (!ownerActive(context)) { finishCreation(context, null); return; }
  clearTimeout(context.timer); context.checking = true;
  try {
    let thread;
    if (context.threadId) {
      thread = await api(`/threads/${encodeURIComponent(context.threadId)}`);
      if (creations.get(context.dialog) !== context) return;
      const message = thread.messages?.at(-1);
      const failed = message?.status === 'failed', blocked = message?.status === 'blocked';
      if (failed || blocked) {
        $('#pane-startup-status').textContent = failed ? 'Agent startup failed. Cancel to return; accepted startup is not automatically retried.' : 'Agent startup is blocked. Native approvals remain in TUIOS. Cancel to return to your draft.';
        error(new Error(message.body || 'Agent startup did not become ready.'), context.dialog);
        context.threadId = null; context.paneId = null; return;
      }
      context.paneId = thread.pane_id;
      if (!context.paneId) return;
    }
    await refresh();
    if (creations.get(context.dialog) !== context) return;
    const pane = store.state.panes.find(p => p.id === context.paneId);
    const agent = store.state.agents.find(a => a.id === context.paneId);
    const state = pane?.state || agent?.state;
    if (state === 'closed' || state === 'failed' || state === 'needs_input' || state === 'blocked' || thread?.messages?.at(-1)?.meta?.ready === false || thread?.messages?.at(-1)?.meta?.outcome === 'window_closed') {
      $('#pane-startup-status').textContent = 'Session did not become ready. Cancel to return to your draft; approvals remain in TUIOS.';
      error(new Error(`Session state: ${state || 'not ready'}`), context.dialog);
      context.threadId = null; context.paneId = null; return;
    }
    const choice = recipients().find(c => c.value === context.paneId);
    if (pane && agent && choice?.kind === context.kind && (!thread || thread.messages?.at(-1)?.status === 'complete')) {
      finishCreation(context, choice); toast(context.kind === 'agent' ? 'Agent ready' : 'Pane created');
    }
  } catch (e) { if (creations.get(context.dialog) === context) error(e, context.dialog); }
  finally {
    context.checking = false;
    if (creations.get(context.dialog) === context && (context.threadId || context.paneId)) context.timer = setTimeout(() => checkStartup(context), 1500);
  }
}
function closeDialog(dialog) {
  const context = creations.get(dialog);
  if (context) finishCreation(context, null); else dialog.close();
}
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('cancel', e => { e.preventDefault(); closeDialog(dialog); });
  dialog.addEventListener('close', () => { if (!dialog.open && creations.has(dialog)) finishCreation(creations.get(dialog), null); });
}
function logicalSelect(select) {
  if (select.id) return () => document.getElementById(select.id);
  if (select.dataset.set) {
    const { set, id } = select.dataset;
    return () => document.querySelector(`select[data-set="${CSS.escape(set)}"][data-id="${CSS.escape(id)}"]`);
  }
  return () => select.isConnected ? select : null;
}
async function chooseCreated(select, kind) {
  const previous = previousValues.get(select) ?? '', resolveSelect = logicalSelect(select), key = routeKey(route);
  const parent = select.closest('dialog'), taskId = select.dataset.taskScope !== undefined ? select.form.dataset.taskId : undefined;
  select.value = previous;
  const choice = await store.createEntity({ kind, taskId, owner: () => Boolean(resolveSelect()) && (parent ? parent.open : routeKey(route) === key) });
  const target = resolveSelect(); if (!target || !choice) return;
  if (![...target.options].some(o => o.value === choice.value)) target.add(new Option(choice.label, choice.value), target.options[0]);
  target.value = choice.value; previousValues.set(target, choice.value);
  target.dispatchEvent(new Event('change', { bubbles: true }));
}
function openProfile(profile) {
  const form = $('#profile-form'); invalidatePaths(form); form.reset(); form.elements.id.value = '';
  for (const [k, v] of Object.entries(profile || { args: [], env: {} })) if (form.elements[k]) form.elements[k].value = ['args', 'env'].includes(k) ? JSON.stringify(v, null, 2) : v;
  form.elements.portable.checked = Boolean(profile && portableExecutable(profile.executable));
  const host = profile?.executable_host || '';
  if (host && ![...form.elements.host.options].some(o => o.value === host)) form.elements.host.add(new Option(machineName(host), host));
  form.elements.host.value = host;
  profileMachine(form); setupLaunchHost(form, api, store).catch(error);
  openDialog($('#profile-dialog')); form.elements.host.focus();
}
async function inspect(key) {
  terminalPane = store.state.panes.find(p => p.id === key);
  if (!terminalPane) throw new Error('This pane is no longer available for inspection.');
  $('#terminal-title').textContent = terminalPane.name;
  $('#attach-command').textContent = terminalPane.session ? `Full terminal: tuios attach ${terminalPane.session}` : 'Open this session in TUIOS.';
  $('#terminal-output').textContent = 'Reading pane…'; openDialog($('#terminal-dialog'));
  $('#send-key').disabled = terminalPane.kind !== 'shell'; $('#terminal-key').disabled = terminalPane.kind !== 'shell';
  $('#terminal-output').textContent = (await api(`/panes/${key}/capture`)).text;
}
root.addEventListener('list-error', e => error(e.detail));
document.addEventListener('click', e => {
  const button = e.target.closest('button'); if (!button) return;
  const d = button.dataset, name = d.do || button.id; if (!name && !d.close) return;
  act(async () => {
    if (d.close) return closeDialog($('#' + d.close));
    switch (name) {
      case 'unread': await api('/items/update', { ids: [d.id], set: { unread: Boolean(d.value) } }); await saved(); break;
      case 'archive': await api('/items/update', { ids: [d.id], set: { archived: Boolean(d.value) } }); await saved(); toast(d.value ? 'Archived' : 'Moved to inbox'); break;
      case 'task-archive': await api('/tasks/update', { ids: [d.id], set: { archived: Boolean(d.value) } }); await saved(); toast(d.value ? 'Archived' : 'Unarchived'); break;
      case 'agent-archive': await api('/agents/update', { ids: [d.id], set: { archived: Boolean(d.value) } }); await saved(); toast(d.value ? 'Archived' : 'Unarchived'); break;
      case 'show-items': navigate({ kind: d.key === 'task_id' ? 'task' : 'agent', id: d.id }); break;
      case 'inspect': await inspect(d.id); break;
      case 'answer': {
        // One press per prompt: a second click would be refused as already answered.
        const buttons = button.parentElement.querySelectorAll('button'); for (const b of buttons) b.disabled = true;
        try { await answer(d.id, { promptId: d.promptId, action: d.action, value: d.value }); } finally { for (const b of buttons) b.disabled = false; }
        break;
      }
      case 'read-question': await question(d.id, true); break;
      case 'check-mail': await api(`/panes/${d.id}/check-mail`, {}); toast('Inbox check queued; it will not interrupt a busy agent.'); break;
      case 'compose': compose(d.id, d.agentId); break;
      case 'open-pane': await store.createEntity({ kind: d.kind === 'pane' ? 'pane' : 'agent', taskId: d.id }); break;
      case 'open-mail': $('#mail-form').dataset.taskId = d.id; updateMenus(); openDialog($('#mail-dialog')); break;
      case 'edit-section': {
        const t = store.state.tasks.find(t => t.id === d.id); if (!t) break;
        const key = editKey(d.id, d.section); if (store.edits.has(key)) break;
        store.edits.set(key, { title: { title: t.title, status: t.status }, paths: { path: t.path || '', worktree: t.worktree || '', paths_host: t.paths_host || '', edit_host: resolve(t, tasksMap()).host?.value || '', capture_host: resolve(t, tasksMap()).host?.value || '' }, parent: { parent_id: t.parent_id || '' }, home: { session: t.session || '', workspace: t.workspace ?? '', host: t.host || '' } }[d.section]);
        render();
        if (d.section === 'home' || d.section === 'paths') { try { const inventory = await api('/tuios'); store.liveHosts = inventory.hosts || []; store.liveSessions = (inventory.sessions || []).map(s => ({ value: s.target, label: `${s.display_name || s.label || s.name || s.target} · owner ${s.host || 'local'}`, disabled: Boolean(s.saved) || Boolean(inventory.hosts?.find(h => h.host === s.host) && hostUnavailable(inventory.hosts.find(h => h.host === s.host))) })); } catch (e) { store.liveSessions = []; store.liveHosts = []; error(e); } render(); }
        break;
      }
      case 'cancel-section': { const draft = store.edits.get(editKey(d.id, d.section)); if (draft) invalidatePaths(draft); store.edits.delete(editKey(d.id, d.section)); render(); break; }
      case 'save-section': {
        const key = editKey(d.id, d.section), draft = store.edits.get(key); if (!draft || draft.saving) break;
        const revision = draft.revision || 0; draft.saving = true; render();
        try {
        if (d.section === 'title') await api(`/tasks/${d.id}`, { title: draft.title, status: draft.status }, 'PATCH');
        else if (d.section === 'paths') {
          const host = retainedHost(key);
          if (!host || draft.capture_host !== host || (draft.path.trim() || draft.worktree.trim()) && draft.paths_host !== host) throw new Error('Directories belong to a different or changed machine. Save the machine first, reopen Directories and choose paths again.');
          await api(`/tasks/${d.id}`, { path: draft.path.trim(), worktree: draft.worktree.trim(), paths_host: draft.path.trim() || draft.worktree.trim() ? draft.paths_host : '' }, 'PATCH');
        }
        else if (d.section === 'parent') await api(`/tasks/${d.id}`, { parent_id: draft.parent_id }, 'PATCH');
        else if (d.section === 'home') await api(`/tasks/${d.id}`, { host: draft.host, session: draft.session, workspace: draft.workspace === '' ? '' : Number(draft.workspace) }, 'PATCH');
        } catch (e) { draft.saving = false; render(); throw e; }
        // A cancelled or re-opened editor is a different draft; edits typed during the save stay open.
        if (store.edits.get(key) === draft) { if ((draft.revision || 0) === revision) store.edits.delete(key); else draft.saving = false; }
        await saved(); toast('Saved'); break;
      }
      case 'note-new': if (!store.edits.has(editKey(d.id, 'note:new'))) { store.edits.set(editKey(d.id, 'note:new'), { body: '', context: false }); render(); } break;
      case 'note-edit': {
        const n = store.state.tasks.find(t => t.id === d.id)?.notes?.find?.(n => n.id === d.note); if (!n || store.edits.has(editKey(d.id, `note:${d.note}`))) break;
        store.edits.set(editKey(d.id, `note:${d.note}`), { body: n.body, context: Boolean(n.context) }); render(); break;
      }
      case 'note-cancel': store.edits.delete(editKey(d.id, `note:${d.note}`)); render(); break;
      case 'note-save': {
        const key = editKey(d.id, `note:${d.note}`), draft = store.edits.get(key); if (!draft || draft.saving) break;
        const revision = draft.revision || 0; let created; draft.saving = true; render();
        try {
          if (d.note === 'new') created = await api(`/tasks/${d.id}/notes`, { body: draft.body, context: draft.context });
          else await api(`/tasks/${d.id}/notes/${encodeURIComponent(d.note)}`, { body: draft.body, context: draft.context }, 'PATCH');
        } catch (e) { draft.saving = false; render(); throw e; }
        if (store.edits.get(key) === draft) {
          if ((draft.revision || 0) === revision) store.edits.delete(key);
          else { draft.saving = false; if (created) { store.edits.delete(key); store.edits.set(editKey(d.id, `note:${created.id}`), draft); } }
        }
        await saved(); toast('Note saved'); break;
      }
      case 'note-delete': if (confirm('Delete this note?')) { await api(`/tasks/${d.id}/notes/${encodeURIComponent(d.note)}`, {}, 'DELETE'); store.edits.delete(editKey(d.id, `note:${d.note}`)); await saved(); } break;
      case 'edit-profile': openProfile(store.state.profiles.find(p => p.id === d.id)); break;
      case 'browse': await browsePath(button); break;
      case 'fill': { const field = button.form.elements[d.id]; if (d.host !== formHost(button.form) || field.disabled) break; field.value = d.value; field.dispatchEvent(new Event('input', { bubbles: true })); field.focus(); break; }
      case 'new-task': { const choice = await store.createEntity({ kind: 'task' }); if (choice) navigate({ kind: 'task', id: choice.value }); break; }
      case 'new-subtask': { const choice = await store.createEntity({ kind: 'task', parentId: d.id }); if (choice) navigate({ kind: 'task', id: choice.value }); break; }
      case 'add-profile': openProfile(); break;
      case 'capture': $('#terminal-output').textContent = (await api(`/panes/${terminalPane.id}/capture`)).text; break;
      case 'interrupt': tuios.interrupt(terminalPane); break;
      case 'send-key': await api(`/panes/${terminalPane.id}/keys`, { keys: $('#terminal-key').value }); $('#terminal-output').textContent = (await api(`/panes/${terminalPane.id}/capture`)).text; break;
      case 'reconcile': await api('/reconcile', {}); await refresh(); toast('Sessions reconciled'); break;
    }
  });
});
document.addEventListener('focusin', e => { if (e.target.matches('select') && !e.target.value.startsWith('__new_')) previousValues.set(e.target, e.target.value); });
document.addEventListener('input', e => {
  if (e.target.closest('#inbox-composer') && e.target.name === 'body') { const draft = composerDraft(); draft.body = e.target.value; draft.revision++;
    if (route.kind !== 'index') store.drafts.set(`compose:${routeKey(route)}`, draft.body); }
  let key;
  if (e.target.name === 'body') key = e.target.closest('form[data-draft]')?.dataset.draft;
  if (key) { store.drafts.set(key, e.target.value); draftRevisions.set(key, (draftRevisions.get(key) || 0) + 1); }
});
// Section and note drafts are kept in store.edits as they are typed, so a refresh re-renders the same values.
function rememberEdit(target) {
  const draft = target.dataset?.edit && store.edits.get(target.dataset.edit); if (!draft) return false;
  invalidatePaths(draft);
  const field = target.dataset.field;
  if (['host','parent_id'].includes(field)) { for (const [key, paths] of store.edits) if (key.endsWith('|paths')) invalidatePaths(paths); }
  if (['path','worktree'].includes(field)) {
    const host = retainedHost(target.dataset.edit);
    if (!host || !availableHost(host) || draft.capture_host !== host) { error(new Error('Execution machine changed. Save the machine, then reopen Directories and choose paths again.')); return true; }
    if (draft.paths_host !== host) { const sibling = field === 'path' ? 'worktree' : 'path'; draft[sibling] = ''; const input = target.closest('.task-section')?.querySelector('[data-field=' + sibling + ']'); if (input) input.value = ''; draft.paths_host = host; }
  }
  draft[target.dataset.field] = target.type === 'checkbox' ? target.checked : target.value; draft.revision = (draft.revision || 0) + 1; if (['host','parent_id'].includes(field)) render(); return true;
}
document.addEventListener('input', e => { if (e.target.form && ['task-form','pane-form','profile-form'].includes(e.target.form.getAttribute('id'))) { invalidatePaths(e.target.form); bindFormPath(e.target); } rememberEdit(e.target); });
for (const id of ['task-form','pane-form','profile-form']) {
  const form = $('#' + id);
  form.addEventListener('hosts-ready', () => id === 'task-form' ? taskDirectoryPicker() : id === 'pane-form' ? paneDirectory(form) : profileMachine(form));
  form.closest('dialog').addEventListener('close', () => invalidatePaths(form));
}
document.addEventListener('change', e => {
  const target = e.target;
  if (target.form && ['task-form','pane-form','profile-form'].includes(target.form.getAttribute('id'))) { invalidatePaths(target.form); bindFormPath(target); }
  if (target.form?.getAttribute('id') === 'pane-form' && target.name === 'host') { target.form.dataset.hostChosen = 'true'; paneHosts.set(target.form.dataset.hostScope || '', target.value); paneDirectory(target.form, true); }
  if (target.form?.getAttribute('id') === 'pane-form' && target.name === 'profileId') paneKind();
  if (target.form?.getAttribute('id') === 'profile-form' && ['host','portable'].includes(target.name)) profileMachine(target.form, true);
  if (target.id === 'pane-task' && !target.value.startsWith('__new_')) { paneHostScope(target.form); setupLaunchHost(target.form, api, store).catch(error); }
  if (target.id === 'task-parent' || target.form?.getAttribute('id') === 'task-form' && target.name === 'host') taskDirectoryPicker();
  if (target.dataset.do === 'note-context') { const { id, note } = target.dataset; act(async () => { await api(`/tasks/${id}/notes/${encodeURIComponent(note)}`, { context: target.checked }, 'PATCH'); await saved(); }); return; }
  if (rememberEdit(target)) return;
  if (target.matches('select')) {
    const kind = target.selectedOptions[0]?.dataset.createKind || (target.value.startsWith('__new_') ? target.dataset.createKind : null);
    if (kind) { act(() => chooseCreated(target, kind)); return; }
    previousValues.set(target, target.value);
  }
  if (target.id === 'inbox-recipient') { const draft = composerDraft(); draft.recipientId = target.value; draft.revision++; updateMenus(); return; }
  if (target.form?.getAttribute('id') === 'pane-form' && target.name === 'kind') { paneKind(); return; }
  if (target.id === 'mail-from') { updateMenus(); return; }
  const { set, id } = target.dataset, value = target.value; if (!set) return;
  act(async () => {
    if (set === 'item-task') await api('/items/update', { ids: [id], set: { task_id: value || null } });
    if (set === 'agent-task') await api('/agents/update', { ids: [id], set: { task_id: value || null } });
    await saved();
  });
});
document.addEventListener('submit', e => {
  const form = e.target, key = form.dataset.reply, agent = form.dataset.prompt, answering = form.dataset.answer, name = form.getAttribute('id');
  if (!key && !agent && !answering && !['task-form', 'pane-form', 'compose-form', 'profile-form', 'mail-form', 'inbox-composer'].includes(name)) return;
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form)), button = form.querySelector('button[type="submit"],button.primary');
  if (button?.disabled || submissions.has(form)) return;
  const context = creations.get(form.closest('dialog'));
  if (context?.accepted) return;
  const revision = draftRevisions.get(form.dataset.draft), body = data.body;
  const submission = Symbol(); submissions.set(form, submission); form.dataset.submitting = '';
  const submittedDraft = name === 'inbox-composer' ? composerDraft() : null;
  const submittedScope = routeKey(route);
  if (button) button.disabled = true;
  act(async () => {
    if (answering) {
      await answer(answering, { promptId: form.dataset.promptId, action: 'text', value: body }, () => { if (draftRevisions.get(form.dataset.draft) === revision) store.drafts.delete(form.dataset.draft); });
      return;
    }
    if (key || agent) {
      const source = store.state.items.find(i => i.id === form.dataset.draft);
      const shouldReview = source && terminalResponse(source) && source.unread;
      const ownership = Object.hasOwn(form.dataset, 'taskId') ? { task_id: form.dataset.taskId || null } : {};
      await api(key ? `/threads/${encodeURIComponent(key.slice(key.indexOf(':') + 1))}/reply` : `/agents/${encodeURIComponent(agent)}/prompt`, { ...data, ...ownership });
      if (draftRevisions.get(form.dataset.draft) === revision) {
        store.drafts.delete(form.dataset.draft); if (form.elements.body.value === body) form.elements.body.value = '';
      }
      if (shouldReview) await api('/items/update', { ids: [source.id], set: { unread: false } });
      await saved(); if (agent) toast('Work accepted. Results depend on native capture.'); return;
    }
    switch (name) {
      case 'inbox-composer': {
        const submitted = { ...submittedDraft };
        if (!composerRecipients().some(c => c.value === submitted.recipientId)) throw new Error('Choose an available Agent or Pane before sending.');
        await api(`/agents/${encodeURIComponent(submitted.recipientId)}/prompt`, { body: submitted.body });
        if (submittedDraft.revision === submitted.revision) { submittedDraft.body = ''; submittedDraft.revision++; store.drafts.delete(`compose:${submittedScope}`); if (composerDraft() === submittedDraft) form.elements.body.value = ''; }
        $('#inbox-composer-status').textContent = 'Work accepted by the native session; this is not a completion confirmation.';
        await refresh(); toast('Work accepted'); break;
      }
      case 'task-form': {
        if (!context) return;
        if (!availableHost(formHost(form))) throw new Error('Choose an available machine or inherit one from the parent task.');
        if ((data.path || data.worktree) && data.paths_host !== formHost(form)) throw new Error('Choose the directories again on this execution machine.');
        data.notes = data.notes?.trim() ? [{ body: data.notes, context: false }] : [];
        const task = await api('/tasks', data);
        if (!store.state.tasks.some(t => t.id === task.id)) store.state.tasks.unshift(task);
        try { await refresh(); } catch (e) { error(e); render(); }
        if (creations.get(context.dialog) !== context) break;
        if (context.multi) {
          // Stay open for the next task: clear what is task-specific, keep the directories, go back to the title.
          context.created = task;
          form.elements.title.value = ''; form.elements.notes.value = '';
          const note = $('#task-created'); note.textContent = `Created “${task.title}”. Next one?`; note.hidden = false;
          suggestPaths(form); suggestParent($('#task-parent'), form.elements.parent_id.value); form.elements.title.focus();
          break;
        }
        context.accepted = true; form.reset(); finishCreation(context, { value: task.id, label: task.title });
        break;
      }
      case 'pane-form': {
        if (!context) return;
        if (!data.host || !store.liveHosts?.some(h => h.host === data.host && !hostUnavailable(h))) throw new Error('Choose an available execution machine. No default machine is used.');
        if (context.kind !== 'pane' && !store.state.profiles.some(p => p.id === data.profileId && paneProfileFits(p, form))) throw new Error('Select a compatible profile for this machine.');
        if (data.cwd?.trim() && data.paths_host !== data.host) throw new Error('Choose the launch directory again on this machine.');
        if (!data.cwd?.trim() && paneExecution(form).paths_mismatch?.value) throw new Error('The task directory belongs to another machine. Choose a launch directory here or switch back.');
        const result = await api(`/tasks/${encodeURIComponent(context.taskId || data.taskId)}/panes`, { name: data.name, kind: context.kind === 'pane' ? 'shell' : 'agent', profileId: data.profileId, host: data.host, ...(data.cwd?.trim() ? { cwd: data.cwd.trim(), paths_host: data.paths_host } : {}) });
        context.accepted = true;
        if (creations.get(context.dialog) !== context) { await refresh(); return; }
        context.threadId = result.threadId; context.paneId = result.id;
        $('#pane-startup-status').textContent = result.threadId ? 'Startup accepted. Waiting for this exact session to become ready… Cancel abandons selection, not the native startup.' : 'Pane created. Refreshing its native recipient record…';
        await checkStartup(context); break;
      }
      case 'compose-form': {
        const taskId = form.dataset.taskId;
        if (!recipients({ taskId }).some(c => c.value === data.paneId)) throw new Error('Choose an available recipient in this task.');
        const result = await api(`/tasks/${taskId}/compose`, data);
        if (form.elements.body.value === body && form.elements.subject.value === data.subject && form.elements.paneId.value === data.paneId) { form.reset(); $('#compose-dialog').close(); }
        composeDrafts.delete(taskId);
        await refresh(); navigate({ kind: 'item', id: `thread:${result.threadId}` }); toast('Task work accepted'); break;
      }
      case 'profile-form': {
        const epoch = pathEpochs.get(form), profileId = form.elements.id.value;
        if (!data.executable?.trim()) throw new Error('Choose an executable file or portable command name.');
        data.executable = data.executable.trim();
        if (form.elements.portable.checked && !portableExecutable(data.executable)) throw new Error('Portable executables must be bare command names without paths.');
        if (!portableExecutable(data.executable)) {
          if (!availableHost(data.host) || data.executable_host !== data.host) throw new Error('Choose the executable again on its machine.');
          if (!data.executable.startsWith('/') && !data.executable.startsWith('~/')) throw new Error('Use an absolute executable path, or Browse to choose a file.');
          const selected = await api('/filesystem/select', { host: data.host, path: data.executable, kind: 'file' });
          if (!form.closest('dialog').open || pathEpochs.get(form) !== epoch || form.elements.id.value !== profileId) return;
          if (selected.host !== data.host) throw new Error('Executable selection returned a different machine.');
          data.executable = selected.path;
        } else data.executable_host = '';
        delete data.host; delete data.portable;
        data.args = JSON.parse(data.args); data.env = JSON.parse(data.env); await api('/profiles', data); if (pathEpochs.get(form) === epoch && form.elements.id.value === profileId) $('#profile-dialog').close(); await refresh(); navigate({ kind: 'index', page: 'profiles' }); break;
      }
      case 'mail-form': {
        const from = recipients({ taskId: form.dataset.taskId, mail: true }).find(p => p.value === data.from);
        if (!from?.session || data.to !== 'human' && !recipients({ taskId: form.dataset.taskId, mail: true, session: from.session }).some(p => p.value === data.to)) throw new Error('Mail recipients must belong to the same native session. Choose a pane in the sender’s session.');
        await api('/panes/' + encodeURIComponent(data.from) + '/mail', data);
        if (form.elements.body.value === body && form.elements.subject.value === data.subject) { form.reset(); $('#mail-dialog').close(); }
        await refresh(); toast('Mail delivered. Use Check mail to notify a recipient agent.'); break;
      }
    }
  }, e => {
    if (context && creations.get(context.dialog) !== context) error(e, null);
    else error(e, form.closest('dialog')?.open ? form.closest('dialog') : null);
  }).finally(() => {
    if (submissions.get(form) !== submission) return;
    submissions.delete(form); delete form.dataset.submitting;
    if (button && !(context?.accepted && creations.get(context.dialog) === context)) button.disabled = false;
    updateMenus();
  });
});
$('#rail-toggle').addEventListener('click', () => $('#rail-toggle').setAttribute('aria-expanded', String(document.body.classList.toggle('rail-open'))));
// A link to the page that is already open changes no hash; the phone's tree sheet still has to close.
$('#rail-body').addEventListener('click', e => { if (e.target.closest('a')) { document.body.classList.remove('rail-open'); $('#rail-toggle').setAttribute('aria-expanded', 'false'); } });
window.addEventListener('hashchange', () => {
  mount(parseRoute(location.hash));
  for (const context of [...creations.values()]) if (!ownerActive(context)) finishCreation(context, null);
});
const stream = new EventSource('/api/events');
stream.onopen = () => $('#connection').textContent = 'Connected locally';
stream.onerror = () => $('#connection').textContent = 'Reconnecting…';
stream.onmessage = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => Promise.all([refresh(true).then(() => Promise.all([tuios.update(), history.update()])), outline.update()]).catch(error), 150); };
// First paint: the rail draws from the outline as soon as it answers, and an outline page mounts without waiting for the state of the other pages.
outline.update().catch(error);
const first = parseRoute(location.hash);
if (first.kind === 'outline') { mount(first); act(() => refresh()); }
else { await act(() => refresh()); mount(parseRoute(location.hash)); }
