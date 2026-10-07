// State, hash routes, modal continuations and native-session work dispatch.
import { createList } from '/list.js';
import { createWorkbench, patchHTML, terminalResponse } from '/workbench.js';
import { createQueues } from '/queues.js';
import { pages, pageForRoute, metadataForRoute, recipients, store, api, esc, taskTree } from '/pages.js';
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
const routeKey = r => r?.kind === 'index' ? r.page : r?.kind === 'queue' ? `queue/${r.bucket}/${r.item || ''}` : `${r?.kind}/${r?.id}`;
function parseRoute(hash) {
  const path = hash.replace(/^#\/?/, '');
  if (!path) return { kind: 'index', page: 'inbox' };
  if (Object.hasOwn(pages, path)) return { kind: 'index', page: path };
  const match = /^(task|agent|item)\/([^/]+)$/.exec(path);
  if (match) { try { return { kind: match[1], id: decodeURIComponent(match[2]) }; } catch {} }
  const queue = /^queue\/([^/]+)(?:\/(.+))?$/.exec(path);
  if (queue) { try { return { kind: 'queue', bucket: decodeURIComponent(queue[1]), item: queue[2] ? decodeURIComponent(queue[2]) : undefined }; } catch {} }
  return { kind: 'invalid' };
}
const routeHash = r => r.kind === 'index' ? `#${r.page}` : r.kind === 'queue' ? `#queue/${encodeURIComponent(r.bucket)}${r.item ? '/' + encodeURIComponent(r.item) : ''}` : `#${r.kind}/${encodeURIComponent(r.id)}`;
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
  html += choices.map(c => `<option value="${esc(c.value)}"${c.createKind ? ` data-create-kind="${c.createKind}"` : ''}>${esc(c.label)}</option>`).join('');
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
  if (document.activeElement !== $('#profile-options')) setChoices($('#profile-options'), store.state.profiles.map(p => ({ value: p.id, label: p.name })), pane.elements.profileId.value, 'Choose an agent profile');
  const composeTask = $('#compose-form').dataset.taskId;
  if (composeTask && document.activeElement !== $('#compose-panes')) setChoices($('#compose-panes'), [...recipients({ taskId: composeTask }), ...newChoices(['agent', 'pane'])]);
  const mailTask = $('#mail-form').dataset.taskId;
  if (mailTask) {
    const choices = [...recipients({ taskId: mailTask, mail: true }), ...newChoices(['agent', 'pane'])];
    if (document.activeElement !== $('#mail-from')) setChoices($('#mail-from'), choices);
    if (document.activeElement !== $('#mail-to')) setChoices($('#mail-to'), [{ value: 'human', label: 'Your TUIOS inbox' }, ...choices]);
  }
}
function render() {
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
  workbench.render(route);
  if (!nextPage) {
    list?.destroy(); list = null; page = null; metadata.hidden = true;
    $('#page-title').textContent = 'Page unavailable';
    document.title = 'tuios inbox · Page unavailable';
    $('#page-description').textContent = 'This link is invalid or the record is no longer available. Return to the index to choose another record.';
    root.innerHTML = '<p class="list-empty">No record at this address.</p>';
    return;
  }
  if (queues.supports(route)) { page = nextPage; $('#page-title').textContent = page.title; $('#page-description').textContent = page.description; document.title = `tuios inbox · ${page.title}`; queues.render(route); return; }
  if (!list && !workbench.supports(route)) { mount(route); return; }
  page = nextPage;
  $('#page-title').textContent = page.title;
  $('#page-description').textContent = page.description;
  document.title = `tuios inbox · ${page.title}`;
  if (workbench.supports(route)) return;
  list.setRows(page.rows());
  if (page.items) for (const el of root.querySelectorAll('.list-rows > .item[open]')) load(el.dataset.id).catch(error);
}
async function refresh() {
  const version = ++refreshVersion, state = await api('/state');
  if (version !== refreshVersion) return;
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
  const cached = store.bodies.get(key), revision = { updated: row.updated, title: row.title, status: row.status };
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
  const index = next.kind === 'index' ? next.page : next.kind === 'task' ? 'tasks' : next.kind === 'agent' ? 'agents' : next.kind === 'item' ? 'inbox' : next.kind === 'queue' ? 'queues' : '';
  document.body.classList.toggle('queues-mode', queues.supports(next));
  document.querySelectorAll('[data-page]').forEach(link => {
    const active = link.dataset.page === index; link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  $('#section-name').textContent = (index || 'Unavailable').toUpperCase();
  $('#add-profile').hidden = index !== 'profiles';
  $('#inbox-composer').hidden = !(['task', 'agent'].includes(next.kind) || next.kind === 'index' && next.page === 'inbox');
  $('#work-composer').hidden = $('#inbox-composer').hidden;
  const composer = $('#inbox-composer');
  composer.elements.body.value = composerDraft().body;
  if (next.kind === 'task') { composer.dataset.taskId = next.id; $('#inbox-recipient').dataset.taskScope = ''; }
  else { delete composer.dataset.taskId; delete $('#inbox-recipient').dataset.taskScope; }
  $('#page-back').hidden = next.kind === 'index';
  $('#page-back').href = `#${index || 'inbox'}`;
  $('#page-back').textContent = `← Back to ${index || 'Inbox'}`;
  metadata.hidden = !['task', 'agent'].includes(next.kind) || !page;
  if (oldKey !== nextKey) metadata.replaceChildren();
  if (!metadata.hidden) patchHTML(metadata, metadataForRoute(next));
  list?.destroy(); list = null;
  if (page && !workbench.supports(route) && !queues.supports(route)) list = createList(root, { ...page.list,
    onOpen: page.items ? row => navigate({ kind: 'item', id: row.id }) : undefined,
    actions: (page.list.actions || []).map(a => ({ ...a, run: async (ids, value) => { $('#error').hidden = true; await a.run(ids, value); await refresh(); } })) });
  render();
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
  form.elements.profileId.disabled = shell;
  form.querySelector('button.primary').textContent = shell ? 'Create pane' : 'Create agent';
}
// The paths this machine's tasks already use, most used first, plus their parent folders: a native
// datalist for typing and quick picks for the top few. Browse… remains the picker for anything else.
function knownPaths() {
  const counts = new Map();
  for (const t of store.state.tasks) for (const p of [t.path, t.worktree]) if (p) counts.set(p, (counts.get(p) || 0) + 1);
  const parents = new Map();
  for (const p of counts.keys()) { const parent = p.replace(/\/[^/]+\/?$/, ''); if (parent && parent !== p) parents.set(parent, (parents.get(parent) || 0) + 1); }
  const rank = m => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([p]) => p);
  return { used: rank(counts), parents: rank(parents).filter(p => !counts.has(p)) };
}
const homePrefix = () => (store.state.dataDir || '').replace(/\/\.local\/share\/tuios-inbox$/, '');
const shortPath = p => homePrefix() && p.startsWith(homePrefix() + '/') ? '~' + p.slice(homePrefix().length) : p;
function fillPathOptions() {
  const { used, parents } = knownPaths();
  $('#path-options').replaceChildren(...[...used, ...parents].map(p => Object.assign(document.createElement('option'), { value: p })));
}
function suggestPaths(form) {
  fillPathOptions();
  const { used } = knownPaths(), worktrees = store.state.tasks.map(t => t.worktree).filter(Boolean);
  for (const box of form.querySelectorAll('[data-picks]')) {
    const picks = [...(box.dataset.picks === 'worktree' ? worktrees : []), ...used].filter((p, i, a) => a.indexOf(p) === i).slice(0, 4);
    box.replaceChildren(...picks.map(p => { const b = document.createElement('button'); b.type = 'button'; b.textContent = shortPath(p); b.title = p; b.dataset.do = 'fill'; b.dataset.id = box.dataset.picks; b.dataset.value = p; return b; }));
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
  if (kind === 'task') { suggestPaths($('#task-form')); suggestParent($('#task-parent'), parentId ?? (route?.kind === 'task' ? route.id : '')); }
  if (kind !== 'task') {
    const form = $('#pane-form');
    form.elements.kind.value = kind === 'pane' ? 'shell' : 'agent';
    form.elements.kind.disabled = true;
    form.elements.taskId.disabled = Boolean(taskId);
    form.elements.taskId.closest('label').hidden = Boolean(taskId);
    updateMenus();
    if (taskId) { form.elements.taskId.value = taskId; previousValues.set(form.elements.taskId, taskId); }
    $('#pane-startup-status').textContent = ''; paneKind();
  }
  return new Promise(resolve => {
    // "+ New task" is a batch entry: the dialog stays open after each task. A "New Task…" choice inside a select creates one and returns to it.
  const context = { kind, taskId, owner, parent, returnFocus, dialog, resolve, routeKey: routeKey(route), accepted: false, multi: kind === 'task' && !owner && !parent, created: null };
    creations.set(dialog, context); openDialog(dialog);
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
  const form = $('#profile-form'); form.reset(); form.elements.id.value = '';
  for (const [k, v] of Object.entries(profile || { args: [], env: {} })) if (form.elements[k]) form.elements[k].value = ['args', 'env'].includes(k) ? JSON.stringify(v, null, 2) : v;
  openDialog($('#profile-dialog'));
}
async function inspect(key) {
  terminalPane = store.state.panes.find(p => p.id === key);
  if (!terminalPane) throw new Error('This pane is no longer available for inspection.');
  const task = store.state.tasks.find(t => t.id === terminalPane.task_id);
  $('#terminal-title').textContent = terminalPane.name;
  $('#attach-command').textContent = task ? `Full terminal: tuios attach ${task.session}` : 'Open this session in TUIOS.';
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
      case 'save-notes': {
        const key = `notes:${d.id}`, revision = draftRevisions.get(key), input = document.querySelector(`[data-notes="${CSS.escape(d.id)}"]`);
        await api(`/tasks/${d.id}`, { notes: input.value }, 'PATCH');
        if (draftRevisions.get(key) === revision) store.drafts.delete(key);
        await saved(); toast('Notes saved'); break;
      }
      case 'edit-profile': openProfile(store.state.profiles.find(p => p.id === d.id)); break;
      case 'browse': { button.disabled = true; try { const { path } = await api(d.picker === 'file' ? '/pick-file' : '/pick-directory', {}); const field = button.form ? button.form.elements[d.id] : $(`#${d.id}`); if (path && field) { field.value = path; if (!button.form) field.dispatchEvent(new Event('change', { bubbles: true })); } } finally { button.disabled = false; } break; }
      case 'fill': { const field = button.form.elements[d.id]; field.value = d.value; field.focus(); break; }
      case 'new-task': { const choice = await store.createEntity({ kind: 'task' }); if (choice) navigate({ kind: 'task', id: choice.value }); break; }
      case 'new-subtask': { const choice = await store.createEntity({ kind: 'task', parentId: d.id }); if (choice) navigate({ kind: 'task', id: choice.value }); break; }
      case 'add-profile': openProfile(); break;
      case 'capture': $('#terminal-output').textContent = (await api(`/panes/${terminalPane.id}/capture`)).text; break;
      case 'interrupt': if (confirm(`Interrupt ${terminalPane.name} with Ctrl+C?`)) { await api(`/panes/${terminalPane.id}/interrupt`, {}); toast('Interrupt sent'); } break;
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
  if (e.target.dataset.notes) key = `notes:${e.target.dataset.notes}`;
  else if (e.target.name === 'body') key = e.target.closest('form[data-draft]')?.dataset.draft;
  if (key) { store.drafts.set(key, e.target.value); draftRevisions.set(key, (draftRevisions.get(key) || 0) + 1); }
});
document.addEventListener('change', e => {
  const target = e.target;
  if (target.matches('select')) {
    const kind = target.selectedOptions[0]?.dataset.createKind || (target.value.startsWith('__new_') ? target.dataset.createKind : null);
    if (kind) { act(() => chooseCreated(target, kind)); return; }
    previousValues.set(target, target.value);
  }
  if (target.id === 'inbox-recipient') { const draft = composerDraft(); draft.recipientId = target.value; draft.revision++; updateMenus(); return; }
  if (target.form?.getAttribute('id') === 'pane-form' && target.name === 'kind') { paneKind(); return; }
  const { set, id } = target.dataset, value = target.value; if (!set) return;
  act(async () => {
    if (set === 'item-task') await api('/items/update', { ids: [id], set: { task_id: value || null } });
    if (set === 'agent-task') await api('/agents/update', { ids: [id], set: { task_id: value || null } });
    if (set === 'task-status') await api(`/tasks/${id}`, { status: value }, 'PATCH');
    if (set === 'task-title') await api(`/tasks/${id}`, { title: value }, 'PATCH');
    if (set === 'task-path') await api(`/tasks/${id}`, { path: value.trim() }, 'PATCH');
    if (set === 'task-worktree') await api(`/tasks/${id}`, { worktree: value.trim() }, 'PATCH');
    if (set === 'task-parent') await api(`/tasks/${id}`, { parent_id: value }, 'PATCH');
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
      await api(key ? `/threads/${encodeURIComponent(key.slice(key.indexOf(':') + 1))}/reply` : `/agents/${encodeURIComponent(agent)}/prompt`, data);
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
        const result = await api(`/tasks/${encodeURIComponent(context.taskId || data.taskId)}/panes`, { name: data.name, kind: context.kind === 'pane' ? 'shell' : 'agent', profileId: data.profileId });
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
      case 'profile-form': data.args = JSON.parse(data.args); data.env = JSON.parse(data.env); await api('/profiles', data); $('#profile-dialog').close(); await refresh(); navigate({ kind: 'index', page: 'profiles' }); break;
      case 'mail-form': await api(`/panes/${data.from}/mail`, data); if (form.elements.body.value === body && form.elements.subject.value === data.subject) { form.reset(); $('#mail-dialog').close(); } await refresh(); toast('Mail delivered. Use Check mail to notify a recipient agent.'); break;
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
window.addEventListener('hashchange', () => {
  mount(parseRoute(location.hash));
  for (const context of [...creations.values()]) if (!ownerActive(context)) finishCreation(context, null);
});
const stream = new EventSource('/api/events');
stream.onopen = () => $('#connection').textContent = 'Connected locally';
stream.onerror = () => $('#connection').textContent = 'Reconnecting…';
stream.onmessage = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => refresh().catch(error), 150); };
await act(async () => { store.state = await api('/state'); });
mount(parseRoute(location.hash));
