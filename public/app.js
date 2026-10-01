// State, hash routes, modal continuations and native-session work dispatch.
import { createList } from '/list.js';
import { pages, pageForRoute, metadataForRoute, recipients, store, api, esc, unfinished } from '/pages.js';
const $ = s => document.querySelector(s);
const root = $('#list'), metadata = $('#page-metadata'), loading = new Set();
const previousValues = new WeakMap(), creations = new Map(), draftRevisions = new Map(), submissions = new WeakMap();
const modalStack = [];
const activeDialog = () => [...modalStack].reverse().find(dialog => dialog.open);
function openDialog(dialog) {
  const index = modalStack.indexOf(dialog); if (index !== -1) modalStack.splice(index, 1);
  modalStack.push(dialog); dialog.showModal();
}
const inboxDraft = { recipientId: '', body: '', revision: 0 };
let route, page, list, terminalPane = null, refreshTimer, refreshVersion = 0;
const routeKey = r => r?.kind === 'index' ? r.page : `${r?.kind}/${r?.id}`;
function parseRoute(hash) {
  const path = hash.replace(/^#\/?/, '');
  if (!path) return { kind: 'index', page: 'inbox' };
  if (Object.hasOwn(pages, path)) return { kind: 'index', page: path };
  const match = /^(task|agent)\/([^/]+)$/.exec(path);
  if (match) { try { return { kind: match[1], id: decodeURIComponent(match[2]) }; } catch {} }
  return { kind: 'invalid' };
}
const routeHash = r => r.kind === 'index' ? `#${r.page}` : `#${r.kind}/${encodeURIComponent(r.id)}`;
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
  if (document.activeElement !== $('#inbox-recipient')) setChoices($('#inbox-recipient'), [...recipients(), ...newChoices(['agent', 'pane'])], inboxDraft.recipientId, 'Choose an Agent or Pane');
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
  $('#unread-count').textContent = store.state.items.filter(i => i.unread && !i.archived).length;
  $('#task-count').textContent = store.state.tasks.filter(t => t.status !== 'done').length;
  updateMenus();
  if (!route) return;
  const nextPage = pageForRoute(route);
  if (!nextPage) {
    list?.destroy(); list = null; page = null; metadata.hidden = true;
    $('#page-title').textContent = 'Page unavailable';
    document.title = 'tuios inbox · Page unavailable';
    $('#page-description').textContent = 'This link is invalid or the record is no longer available. Return to the index to choose another record.';
    root.innerHTML = '<p class="list-empty">No record at this address.</p>';
    return;
  }
  if (!list) { mount(route); return; }
  page = nextPage;
  $('#page-title').textContent = page.title;
  $('#page-description').textContent = page.description;
  document.title = `tuios inbox · ${page.title}`;
  if (route.kind !== 'index' && !metadata.contains(document.activeElement)) {
    const html = metadataForRoute(route);
    if (metadata.innerHTML !== html) metadata.innerHTML = html;
  }
  list.setRows(page.rows());
  if (page.items) for (const el of root.querySelectorAll('.list-rows > .item[open]')) load(el.dataset.id).catch(error);
}
async function refresh() {
  const version = ++refreshVersion, state = await api('/state');
  if (version !== refreshVersion) return;
  store.state = state; render();
  for (const context of creations.values()) if (context.threadId || context.paneId) checkStartup(context);
}
async function load(key, opened) {
  const row = store.state.items.find(i => i.id === key); if (!row || unfinished(row)) return;
  if (store.bodies.get(key)?.updated !== row.updated && !loading.has(key)) {
    loading.add(key);
    try { store.bodies.set(key, { updated: row.updated, data: await api(`/${key.replace(':', 's/')}`) }); }
    catch (e) { store.bodies.set(key, { updated: row.updated, error: e.message }); }
    finally { loading.delete(key); }
    render();
  }
  const data = store.bodies.get(key)?.data;
  if (opened && row.unread && data && (row.type !== 'turn' || data.finished)) { await api('/items/update', { ids: [key], set: { unread: false } }); await refresh(); }
}
async function saved() {
  if (root.contains(document.activeElement) || metadata.contains(document.activeElement)) document.activeElement.blur();
  await refresh();
}
function mount(next) {
  route = next; page = pageForRoute(route);
  const index = next.kind === 'index' ? next.page : next.kind === 'task' ? 'tasks' : next.kind === 'agent' ? 'agents' : '';
  document.querySelectorAll('[data-page]').forEach(link => {
    const active = link.dataset.page === index; link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  $('#section-name').textContent = (index || 'Unavailable').toUpperCase();
  $('#add-profile').hidden = index !== 'profiles';
  $('#inbox-composer').hidden = next.kind !== 'index' || next.page !== 'inbox';
  $('#page-back').hidden = next.kind === 'index';
  $('#page-back').href = `#${index || 'inbox'}`;
  $('#page-back').textContent = `← Back to ${index || 'Inbox'}`;
  metadata.hidden = next.kind === 'index' || !page;
  metadata.innerHTML = page && next.kind !== 'index' ? metadataForRoute(next) : '';
  list?.destroy(); list = null;
  if (page) list = createList(root, { ...page.list,
    onOpen: page.items ? row => act(() => load(row.id, true)) : undefined,
    actions: (page.list.actions || []).map(a => ({ ...a, run: async (ids, value) => { $('#error').hidden = true; await a.run(ids, value); await refresh(); } })) });
  render();
}
function ownerActive(context) {
  if (typeof context.owner === 'function') return context.owner();
  if (context.owner) return context.owner.isConnected !== false;
  return routeKey(route) === context.routeKey;
}
function finishCreation(context, choice) {
  if (creations.get(context.dialog) !== context) return;
  clearTimeout(context.timer); creations.delete(context.dialog);
  const result = choice && ownerActive(context) ? choice : null;
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
store.createEntity = ({ kind, taskId, owner } = {}) => {
  const dialog = kind === 'task' ? $('#task-dialog') : $('#pane-dialog');
  if (!['task', 'agent', 'pane'].includes(kind) || creations.has(dialog)) return Promise.resolve(null);
  const parent = activeDialog();
  const returnFocus = document.activeElement;
  const notice = dialog.querySelector('.form-error'); if (notice) notice.remove();
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
    const context = { kind, taskId, owner, parent, returnFocus, dialog, resolve, routeKey: routeKey(route), accepted: false };
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
      case 'check-mail': await api(`/panes/${d.id}/check-mail`, {}); toast('Inbox check queued; it will not interrupt a busy agent.'); break;
      case 'compose': $('#compose-form').dataset.taskId = d.id; updateMenus(); openDialog($('#compose-dialog')); break;
      case 'open-pane': await store.createEntity({ kind: d.kind === 'pane' ? 'pane' : 'agent', taskId: d.id }); break;
      case 'open-mail': $('#mail-form').dataset.taskId = d.id; updateMenus(); openDialog($('#mail-dialog')); break;
      case 'save-notes': {
        const key = `notes:${d.id}`, revision = draftRevisions.get(key), input = document.querySelector(`[data-notes="${CSS.escape(d.id)}"]`);
        await api(`/tasks/${d.id}`, { notes: input.value }, 'PATCH');
        if (draftRevisions.get(key) === revision) store.drafts.delete(key);
        await saved(); toast('Notes saved'); break;
      }
      case 'edit-profile': openProfile(store.state.profiles.find(p => p.id === d.id)); break;
      case 'browse': { button.disabled = true; try { const { path } = await api(d.picker === 'file' ? '/pick-file' : '/pick-directory', {}); if (path) button.form.elements[d.id].value = path; } finally { button.disabled = false; } break; }
      case 'new-task': { const choice = await store.createEntity({ kind: 'task' }); if (choice) navigate({ kind: 'task', id: choice.value }); break; }
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
  if (e.target.closest('#inbox-composer') && e.target.name === 'body') { inboxDraft.body = e.target.value; inboxDraft.revision++; }
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
  if (target.id === 'inbox-recipient') { inboxDraft.recipientId = target.value; inboxDraft.revision++; return; }
  if (target.form?.getAttribute('id') === 'pane-form' && target.name === 'kind') { paneKind(); return; }
  const { set, id } = target.dataset, value = target.value; if (!set) return;
  act(async () => {
    if (set === 'item-task') await api('/items/update', { ids: [id], set: { task_id: value || null } });
    if (set === 'agent-task') await api('/agents/update', { ids: [id], set: { task_id: value || null } });
    if (set === 'task-status') await api(`/tasks/${id}`, { status: value }, 'PATCH');
    if (set === 'task-title') await api(`/tasks/${id}`, { title: value }, 'PATCH');
    await saved();
  });
});
document.addEventListener('submit', e => {
  const form = e.target, key = form.dataset.reply, agent = form.dataset.prompt, name = form.getAttribute('id');
  if (!key && !agent && !['task-form', 'pane-form', 'compose-form', 'profile-form', 'mail-form', 'inbox-composer'].includes(name)) return;
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form)), button = form.querySelector('button[type="submit"],button.primary');
  if (button?.disabled) return;
  const context = creations.get(form.closest('dialog'));
  if (context?.accepted) return;
  const revision = draftRevisions.get(form.dataset.draft), body = data.body;
  const submission = Symbol(); submissions.set(form, submission);
  if (button) button.disabled = true;
  act(async () => {
    if (key || agent) {
      await api(key ? `/threads/${key.slice(key.indexOf(':') + 1)}/reply` : `/agents/${agent}/prompt`, data);
      if (draftRevisions.get(form.dataset.draft) === revision) {
        store.drafts.delete(form.dataset.draft); if (form.elements.body.value === body) form.elements.body.value = '';
      }
      await saved(); if (agent) toast('Work accepted. Results depend on native capture.'); return;
    }
    switch (name) {
      case 'inbox-composer': {
        const submitted = { ...inboxDraft };
        if (!recipients().some(c => c.value === submitted.recipientId)) throw new Error('Choose an available Agent or Pane before sending.');
        await api(`/agents/${encodeURIComponent(submitted.recipientId)}/prompt`, { body: submitted.body });
        if (inboxDraft.revision === submitted.revision) { inboxDraft.body = ''; inboxDraft.revision++; form.elements.body.value = ''; }
        $('#inbox-composer-status').textContent = 'Work accepted by the native session; this is not a completion confirmation.';
        await refresh(); toast('Work accepted'); break;
      }
      case 'task-form': {
        if (!context) return;
        const task = await api('/tasks', data); context.accepted = true;
        if (!store.state.tasks.some(t => t.id === task.id)) store.state.tasks.unshift(task);
        try { await refresh(); } catch (e) { error(e); render(); }
        if (creations.get(context.dialog) === context) { form.reset(); finishCreation(context, { value: task.id, label: task.title }); }
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
        await refresh(); navigate({ kind: 'task', id: taskId }); toast('Task work accepted');
        if (route.kind === 'task' && route.id === taskId) list?.open(`thread:${result.threadId}`); break;
      }
      case 'profile-form': data.args = JSON.parse(data.args); data.env = JSON.parse(data.env); await api('/profiles', data); $('#profile-dialog').close(); await refresh(); navigate({ kind: 'index', page: 'profiles' }); break;
      case 'mail-form': await api(`/panes/${data.from}/mail`, data); if (form.elements.body.value === body && form.elements.subject.value === data.subject) { form.reset(); $('#mail-dialog').close(); } await refresh(); toast('Mail delivered. Use Check mail to notify a recipient agent.'); break;
    }
  }, e => {
    if (context && creations.get(context.dialog) !== context) error(e, null);
    else error(e, form.closest('dialog')?.open ? form.closest('dialog') : null);
  }).finally(() => { if (button && submissions.get(form) === submission && !(context?.accepted && creations.get(context.dialog) === context)) button.disabled = false; });
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
