// App shell: state fetch, live refresh, navigation, dialogs and the controls inside row details.
import { createList } from '/list.js';
import { pages, store, api, esc, unfinished, agentName } from '/pages.js';
const $ = s => document.querySelector(s);
const root = $('#list'), loading = new Set();
let current, list, dialogTask = null, terminalPane = null, refreshTimer;
function error(e) {
  const dialog = $('dialog[open]');
  if (dialog) {
    let notice = dialog.querySelector('.form-error');
    if (!notice) { notice = document.createElement('p'); notice.className = 'form-error danger'; notice.setAttribute('role','alert'); dialog.append(notice); }
    notice.textContent = e.message;
  } else { $('#error').hidden = false; $('#error').textContent = e.message; }
}
function toast(text) { $('#toast').textContent = text; $('#toast').hidden = false; setTimeout(() => $('#toast').hidden = true, 3500); }
async function act(fn) { $('#error').hidden = true; try { return await fn(); } catch (e) { error(e); } }
const taskPanes = () => store.state.panes.filter(p => p.task_id === dialogTask);
function options(panes) { return panes.map(p => `<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.kind)} · ${esc(p.state)}</option>`).join(''); }
// Rows are patched in place by list.js, so this is safe to call on every background refresh.
function render() {
  $('#unread-count').textContent = store.state.items.filter(i => i.unread && !i.archived).length;
  $('#task-count').textContent = store.state.tasks.filter(t => t.status !== 'done').length;
  list.setRows(pages[current].rows());
  if (pages[current].items) for (const el of root.querySelectorAll('.list-rows > .item[open]')) load(el.dataset.id).catch(error);
}
async function refresh() { store.state = await api('/state'); render(); }
// Fetches an open item's content (again when the item changed). `opened` = the user just expanded it, which marks it read.
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
// list.js does not re-render row details that hold focus, so let go of the control that was just used before refreshing.
async function saved() { if (root.contains(document.activeElement)) document.activeElement.blur(); await refresh(); }
function setPage(name, query) {
  current = name; const page = pages[name];
  document.querySelectorAll('[data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === name));
  $('#section-name').textContent = page.title.toUpperCase(); $('#page-title').textContent = page.title; $('#page-description').textContent = page.description;
  $('#add-profile').hidden = name !== 'profiles';
  list?.destroy();
  list = createList(root, { ...page.list,
    onOpen: page.items ? row => act(() => load(row.id, true)) : undefined,
    actions: page.list.actions.map(a => ({ ...a, run: async (ids, value) => { $('#error').hidden = true; await a.run(ids, value); await refresh(); } })) });
  if (query) list.setQuery(query);
  render();
}
// reset() does not clear a hidden input, so the id of a profile edited earlier would make "Add profile" overwrite it.
function openProfile(profile) { const form = $('#profile-form'); form.reset(); form.elements.id.value = ''; for (const [k,v] of Object.entries(profile || {args:[],env:{}})) if (form.elements[k]) form.elements[k].value = ['args','env'].includes(k) ? JSON.stringify(v,null,2) : v; $('#profile-dialog').showModal(); }
async function inspect(key) {
  terminalPane = store.state.panes.find(p => p.id === key); const t = store.state.tasks.find(t => t.id === terminalPane.task_id);
  $('#terminal-title').textContent = terminalPane.name; $('#attach-command').textContent = `Full terminal: tuios attach ${t.session}`; $('#terminal-output').textContent = 'Reading pane…'; $('#terminal-dialog').showModal();
  $('#send-key').disabled = terminalPane.kind !== 'shell'; $('#terminal-key').disabled = terminalPane.kind !== 'shell';
  $('#terminal-output').textContent = (await api(`/panes/${key}/capture`)).text;
}
root.addEventListener('list-error', e => error(e.detail));
document.addEventListener('click', e => {
  const button = e.target.closest('button'); if (!button) return;
  const d = button.dataset, name = d.do || button.id; if (!name && !d.close && !d.page) return;
  act(async () => {
    if (d.close) return $('#' + d.close).close();
    if (d.page) return setPage(d.page);
    switch (name) {
      case 'unread': await api('/items/update', { ids: [d.id], set: { unread: Boolean(d.value) } }); await saved(); break;
      case 'archive': await api('/items/update', { ids: [d.id], set: { archived: Boolean(d.value) } }); await saved(); toast(d.value ? 'Archived' : 'Moved to inbox'); break;
      case 'task-archive': await api('/tasks/update', { ids: [d.id], set: { archived: Boolean(d.value) } }); await saved(); toast(d.value ? 'Archived' : 'Unarchived'); break;
      case 'agent-archive': await api('/agents/update', { ids: [d.id], set: { archived: Boolean(d.value) } }); await saved(); toast(d.value ? 'Archived' : 'Unarchived'); break;
      case 'show-items': setPage('inbox', { search: '', filters: [{ key: d.key, op: 'is', value: d.id }] }); break;
      case 'inspect': await inspect(d.id); break;
      case 'check-mail': await api(`/panes/${d.id}/check-mail`, {}); toast('Inbox check queued; it will not interrupt a busy agent.'); break;
      case 'compose': dialogTask = d.id; $('#compose-panes').innerHTML = options(store.state.agents.filter(a => a.task_id === d.id && a.state !== 'closed' && !a.archived).map(a => ({ ...a, name: agentName(a.name, a.id) }))); $('#compose-dialog').showModal(); break;
      case 'open-pane': dialogTask = d.id; $('#profile-options').innerHTML = store.state.profiles.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join(''); $('#pane-dialog').showModal(); break;
      case 'open-mail': dialogTask = d.id; $('#mail-from').innerHTML = options(taskPanes()); $('#mail-to').innerHTML = '<option value="human">Your TUIOS inbox</option>' + options(taskPanes()); $('#mail-dialog').showModal(); break;
      case 'save-notes': await api(`/tasks/${d.id}`, { notes: root.querySelector(`[data-notes="${CSS.escape(d.id)}"]`).value }, 'PATCH'); store.drafts.delete(`notes:${d.id}`); await saved(); toast('Notes saved'); break;
      case 'edit-profile': openProfile(store.state.profiles.find(p => p.id === d.id)); break;
      case 'browse': { button.disabled = true; try { const { path } = await api('/pick-directory', {}); if (path) button.form.elements[d.id].value = path; } finally { button.disabled = false; } break; }
      case 'new-task': $('#task-dialog').showModal(); break;
      case 'add-profile': openProfile(); break;
      case 'capture': $('#terminal-output').textContent = (await api(`/panes/${terminalPane.id}/capture`)).text; break;
      case 'interrupt': if (confirm(`Interrupt ${terminalPane.name} with Ctrl+C?`)) { await api(`/panes/${terminalPane.id}/interrupt`, {}); toast('Interrupt sent'); } break;
      case 'send-key': await api(`/panes/${terminalPane.id}/keys`, { keys: $('#terminal-key').value }); $('#terminal-output').textContent = (await api(`/panes/${terminalPane.id}/capture`)).text; break;
      case 'reconcile': await api('/reconcile', {}); await refresh(); toast('Sessions reconciled'); break;
    }
  });
});
// Text being typed lives in `drafts`, so a row that gets re-rendered shows it again.
document.addEventListener('input', e => {
  if (e.target.dataset.notes) store.drafts.set(`notes:${e.target.dataset.notes}`, e.target.value);
  const reply = e.target.closest('form[data-draft]'); if (reply) store.drafts.set(reply.dataset.draft, e.target.value);
});
// Property controls in row details save as soon as they change.
document.addEventListener('change', e => {
  const { set, id } = e.target.dataset, value = e.target.value; if (!set) return;
  act(async () => {
    try {
      if (set === 'item-task') await api('/items/update', { ids: [id], set: { task_id: value || null } });
      if (set === 'agent-task') await api('/agents/update', { ids: [id], set: { task_id: value || null } });
      if (set === 'task-status') await api(`/tasks/${id}`, { status: value }, 'PATCH');
      if (set === 'task-title') await api(`/tasks/${id}`, { title: value }, 'PATCH');
    } finally { await saved(); }
  });
});
document.addEventListener('submit', e => {
  // getAttribute: the profile form has a field named "id", which shadows form.id.
  e.preventDefault(); const form = e.target, key = form.dataset.reply, agent = form.dataset.prompt, name = form.getAttribute('id'); if (!key && !agent && !name) return;
  const data = Object.fromEntries(new FormData(form)), button = form.querySelector('button[type="submit"],button.primary'); if (button) button.disabled = true;
  act(async () => {
    if (key) { await api(`/threads/${key.slice(key.indexOf(':') + 1)}/reply`, data); store.drafts.delete(key); form.elements.body.value = ''; await saved(); return; }
    if (agent) { await api(`/agents/${agent}/prompt`, data); store.drafts.delete(form.dataset.draft); form.elements.body.value = ''; await saved(); toast('Sent. The result will arrive as a new row.'); return; }
    switch (name) {
      case 'task-form': { const task = await api('/tasks', data); form.reset(); $('#task-dialog').close(); await refresh(); setPage('tasks'); list.open(task.id); break; }
      case 'pane-form': await api(`/tasks/${dialogTask}/panes`, data); form.reset(); $('#pane-dialog').close(); await refresh(); toast('Session request sent. Agent startup appears in the inbox.'); break;
      case 'compose-form': { const result = await api(`/tasks/${dialogTask}/compose`, data); form.reset(); $('#compose-dialog').close(); await refresh(); setPage('inbox'); list.open(`thread:${result.threadId}`); break; }
      case 'profile-form': { data.args = JSON.parse(data.args); data.env = JSON.parse(data.env); const result = await api('/profiles', data); $('#profile-dialog').close(); await refresh(); setPage('profiles'); list.open(result.id); break; }
      case 'mail-form': await api(`/panes/${data.from}/mail`, data); form.reset(); $('#mail-dialog').close(); await refresh(); toast('Mail delivered. Use Check mail to notify a recipient agent.'); break;
    }
  }).finally(() => { if (button) button.disabled = false; });
});
const stream = new EventSource('/api/events');
stream.onopen = () => $('#connection').textContent = 'Connected locally';
stream.onerror = () => $('#connection').textContent = 'Reconnecting…';
// A background refresh only patches rows; it leaves the error banner, open rows, selection and focus alone.
stream.onmessage = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => refresh().catch(error), 150); };
// The first list is mounted once there is data, so it never flashes its "nothing here" text.
await act(async () => { store.state = await api('/state'); });
setPage('inbox');
