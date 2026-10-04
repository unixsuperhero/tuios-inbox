// Live workbench navigation and keyed DOM updates; records and actions belong to pages/app.
import { store, pages, esc, agentName, unfinished } from '/pages.js';

const href = (kind, id) => `#${kind}/${encodeURIComponent(id)}`;
const time = value => value ? new Date(value).toLocaleString() : '';
export const chronological = (a, b) => (Date.parse(a.updated) || 0) - (Date.parse(b.updated) || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
export function terminalResponse(row) {
  return !unfinished(row) && ['turn', 'command', 'mail', 'dispatch', 'snapshot'].includes(row.type)
    && ['done', 'errored', 'error', 'stopped', 'failed', 'complete', 'captured', 'partial', 'uncertain', 'snapshot'].includes(row.status);
}
export const reviewRows = () => store.state.items.filter(row => row.unread && !row.archived && terminalResponse(row)).sort(chronological);
const stateClass = state => ['closed', 'offline'].includes(state) ? 'offline' : ['working', 'running'].includes(state) ? 'working' : ['needs_input', 'blocked'].includes(state) ? 'needs_input' : ['errored', 'error', 'failed', 'stopped'].includes(state) ? 'error' : 'idle';
const nodeKey = node => node.nodeType === 1 ? node.id || node.dataset.wbKey || (node.matches('form[data-draft]') ? `form:${node.dataset.draft}:${node.dataset.reply || node.dataset.prompt || node.dataset.answer || ''}` : null) : null;

// Morph in place: stable nodes keep selection, scroll, open details, and in-flight forms.
export function patchHTML(parent, html) {
  const template = document.createElement('template'); template.innerHTML = html;
  const patch = (current, desired) => {
    if (current.nodeType !== 1) { if (current.nodeValue !== desired.nodeValue) current.nodeValue = desired.nodeValue; return; }
    const focused = current === document.activeElement;
    if (focused && current.matches('input,textarea,select')) return;
    const busy = current.closest('form[data-submitting]');
    for (const attr of [...current.attributes]) {
      if (attr.name === 'open' && current.tagName === 'DETAILS' || attr.name === 'data-submitting' || attr.name === 'disabled' && busy) continue;
      if (!desired.hasAttribute(attr.name)) current.removeAttribute(attr.name);
    }
    for (const attr of desired.attributes) {
      if (attr.name === 'open' && current.tagName === 'DETAILS' || attr.name === 'disabled' && busy) continue;
      if (current.getAttribute(attr.name) !== attr.value) current.setAttribute(attr.name, attr.value);
    }
    if (current.matches('textarea,input')) {
      if (!busy && current.value !== desired.value) current.value = desired.value;
      return;
    }
    if (!current.hasAttribute('data-workbench-controls')) children(current, desired);
    if (current.tagName === 'SELECT' && !busy && current.value !== desired.value) current.value = desired.value;
  };
  const children = (current, desired) => {
    const old = [...current.childNodes], keyed = new Map(old.filter(nodeKey).map(node => [nodeKey(node), node]));
    const used = new Set(); let cursor = current.firstChild;
    for (const wanted of [...desired.childNodes]) {
      const key = nodeKey(wanted);
      let node = key ? keyed.get(key) : old.find(n => !used.has(n) && !nodeKey(n) && n.nodeType === wanted.nodeType && n.nodeName === wanted.nodeName);
      if (node && (node.nodeType !== wanted.nodeType || node.nodeName !== wanted.nodeName)) node = null;
      if (!node) node = wanted.cloneNode(true);
      used.add(node);
      if (node !== cursor) current.insertBefore(node, cursor);
      patch(node, wanted); cursor = node.nextSibling;
    }
    for (const node of old) if (!used.has(node)) node.remove();
  };
  children(parent, template.content);
}

export function createWorkbench({ root, navigate, load, review, refresh, report }) {
  let route, order = 'oldest', reviewing = false;
  const selections = { history: new Set(), queue: new Set(), tasks: new Set(), agents: new Set(), members: new Set() };
  const pending = new Set(), notices = new Map();
  try { order = sessionStorage.getItem('workbench.queue-order') === 'newest' ? 'newest' : 'oldest'; } catch {}
  const supports = r => r.kind === 'item' || r.kind === 'task' || r.kind === 'agent' || r.kind === 'index' && r.page === 'inbox';
  const selected = () => route?.kind === 'item' ? store.state.items.find(i => i.id === route.id) : null;
  const queue = () => order === 'newest' ? reviewRows().reverse() : reviewRows();
  const history = () => !route || !supports(route) || route.kind === 'item' ? [] : store.state.items.filter(i => !i.archived && (route.kind === 'task' ? i.task_id === route.id : route.kind === 'agent' ? i.agent_id === route.id : true)).sort(chronological).reverse();
  const rowsFor = key => key === 'queue' ? queue() : key === 'history' ? history() : key === 'members' ? (route?.kind === 'task' ? [...document.querySelectorAll('[data-wb-pick="members"]')].map(input => ({ id: input.dataset.id })) : []) : store.state[key].filter(r => !r.archived);
  const actionsFor = key => key === 'members' ? pages.agents.list.actions.filter(a => !a.options) : key === 'tasks' || key === 'agents' ? pages[key].list.actions.filter(a => !a.options && a.id === 'archive') : pages.inbox.list.actions.filter(a => !a.options);
  function checkbox(key, id, title) {
    return `<input type="checkbox" data-wb-pick="${key}" data-id="${esc(id)}" aria-label="Select ${esc(title)}"${selections[key].has(id) ? ' checked' : ''}${pending.has(key) ? ' disabled' : ''}>`;
  }
  function toolbar(key, rows, noun = 'items') {
    const count = selections[key].size, busy = pending.has(key);
    return `<div class="wb-selection-toolbar" data-wb-key="tools:${key}" role="group" aria-label="${key} selection">
      <label class="wb-select-all"><input type="checkbox" data-wb-all="${key}"${!rows.length || busy ? ' disabled' : ''}>Select all ${noun}</label>
      <span class="wb-selection-count" role="status">${count ? count + ' selected' : rows.length + ' ' + noun}</span>
      <div class="wb-bulk-actions"${count ? '' : ' hidden'}>${actionsFor(key).map(a => `<button type="button" data-wb-action="${a.id}" data-wb-scope="${key}"${busy ? ' disabled' : ''}>${esc(a.label)}</button>`).join('')}<button type="button" data-wb-clear="${key}"${busy ? ' disabled' : ''}>Clear</button></div>
      <p class="wb-action-notice${notices.get(key)?.error ? ' danger' : ''}" role="${notices.get(key)?.error ? 'alert' : 'status'}"${notices.has(key) || busy ? '' : ' hidden'}>${busy ? 'Applying changes…' : esc(notices.get(key)?.text || '')}</p>
    </div>`;
  }
  function syncSelection() {
    const members = document.querySelector('#member-selection');
    if (route?.kind === 'task' && members) patchHTML(members, toolbar('members', rowsFor('members'), 'members') + '<p class="hint">Archive hides these agents from navigation without stopping their panes or archiving their work.</p>');
    for (const input of document.querySelectorAll('[data-wb-pick]')) {
      input.checked = selections[input.dataset.wbPick].has(input.dataset.id);
      input.disabled = pending.has(input.dataset.wbPick);
    }
    for (const input of document.querySelectorAll('[data-wb-all]')) {
      const key = input.dataset.wbAll, count = selections[key].size, total = rowsFor(key).length;
      input.checked = count > 0 && count === total;
      input.indeterminate = count > 0 && count < total;
      input.disabled = pending.has(key) || !total;
    }
  }
  function renderRail() {
    const rail = document.querySelector('#task-rail'); if (!rail) return;
    const item = selected(), activeAgent = route?.kind === 'agent' ? route.id : item?.agent_id;
    const activeTask = route?.kind === 'task' ? route.id : item?.task_id || store.state.agents.find(a => a.id === activeAgent)?.task_id;
    const agents = rowsFor('agents'), tasks = rowsFor('tasks');
    const agentHTML = a => `<div class="wb-agent-row${selections.agents.has(a.id) ? ' is-picked' : ''}" data-wb-key="agent:${esc(a.id)}">${checkbox('agents', a.id, agentName(a.name, a.id))}<a class="wb-agent state-${stateClass(a.state)}" href="${href('agent', a.id)}"${a.id === activeAgent ? ' aria-current="page"' : ''}><span class="wb-agent-name">${esc(agentName(a.name, a.id))}</span><small>${esc(a.kind || 'agent')} · ${esc(a.state || 'unknown')}</small></a></div>`;
    const group = (task, members) => `<section class="wb-task" data-wb-key="task:${esc(task?.id || 'unassigned')}">${task ? `<div class="wb-task-row${selections.tasks.has(task.id) ? ' is-picked' : ''}">${checkbox('tasks', task.id, task.title)}<a class="wb-task-title" href="${href('task', task.id)}"${task.id === activeTask ? ' aria-current="page"' : ''}>${esc(task.title)}</a></div>` : '<h3 class="wb-task-title">Not assigned to a task</h3><p class="hint">These agents and panes have no visible task group.</p>'}<p class="wb-members-label">Agents & panes · ${members.length}</p><div class="wb-agents">${members.map(agentHTML).join('') || '<p class="hint">No agents assigned</p>'}</div></section>`;
    patchHTML(rail, `<div class="wb-rail-heading"><h2>Task groups</h2><p class="hint">Tasks group related work. The agents and shell panes assigned to each task appear below it.</p><div class="wb-rail-links"><a href="#tasks">Manage tasks</a><a href="#agents">Manage agents</a></div></div>${toolbar('tasks', tasks, 'tasks')}${toolbar('agents', agents, 'agents')}<p class="hint">Archiving hides a task or agent here. It does not stop its panes or archive its work.</p>${tasks.map(t => group(t, agents.filter(a => a.task_id === t.id))).join('')}${group(null, agents.filter(a => !tasks.some(t => t.id === a.task_id)))}`);
  }
  function itemLink(row, key) {
    return `<div class="wb-record ${row.unread ? 'is-unread' : 'is-read'}${selections[key].has(row.id) ? ' is-picked' : ''}" data-wb-key="${esc(row.id)}" data-item-id="${esc(row.id)}">${checkbox(key, row.id, row.title || 'Untitled work')}<a class="wb-record-link" href="${href('item', row.id)}"${selected()?.id === row.id ? ' aria-current="page"' : ''}><strong>${esc(row.title || 'Prompt not captured')}</strong><span>${esc(row.type)} · ${esc(row.agent_name || row.agent_id || 'No agent')}</span><small>${esc(row.status)} · ${esc(time(row.updated))}</small><span class="wb-read-state">${row.unread ? 'Unread' : 'Read'}</span></a></div>`;
  }
  function renderQueue() {
    const el = document.querySelector('#review-queue'); if (!el) return;
    const rows = queue(), current = selected();
    patchHTML(el, `<div class="wb-queue-heading"><h2>Review queue <span>${rows.length}</span></h2><p class="hint">Finished responses you haven’t marked as read.</p><label>Order<select id="queue-order"><option value="oldest"${order === 'oldest' ? ' selected' : ''}>Oldest first</option><option value="newest"${order === 'newest' ? ' selected' : ''}>Newest first</option></select></label><button id="review-next"${reviewing || !rows.length && !(current?.unread && terminalResponse(current)) ? ' disabled' : ''}>Review next</button></div>${toolbar('queue', rows)}<div class="wb-queue-items">${rows.map(r => itemLink(r, 'queue')).join('') || '<p class="list-empty">Nothing waiting for review.</p>'}</div>`);
  }
  function renderContent() {
    if (!supports(route)) return;
    const item = selected();
    if (route.kind === 'item') {
      if (!item) { patchHTML(root, '<p class="list-empty">This record is no longer available.</p>'); return; }
      const pending = terminalResponse(item) && item.unread;
      patchHTML(root, `<article class="wb-content wb-item ${item.unread ? 'is-unread' : 'is-read'}" data-wb-key="opened:${esc(item.id)}"><div class="wb-summary">${pages.inbox.list.summary(item)}</div><div class="wb-review-actions"><button data-workbench-review="${esc(item.id)}"${!pending || reviewing ? ' disabled' : ''}>${item.unread ? 'Mark as read' : 'Read'}</button>${item.task_id ? `<a href="${href('task', item.task_id)}">Task history</a>` : ''}${item.agent_id ? `<a href="${href('agent', item.agent_id)}">Agent history</a>` : ''}</div><div class="wb-item-detail">${pages.inbox.list.detail(item)}</div></article>`);
      load(item.id, false).catch(report); return;
    }
    const rows = history();
    const agent = route.kind === 'agent' && store.state.agents.find(a => a.id === route.id);
    const taskId = route.kind === 'task' ? route.id : agent?.task_id;
    patchHTML(root, `<section class="wb-content"><div class="wb-history-heading"><h2>${route.kind === 'index' ? 'Recent work' : 'History'} <span>${rows.length}</span></h2>${taskId ? `<button data-do="compose" data-id="${esc(taskId)}"${agent ? ` data-agent-id="${esc(agent.id)}"` : ''}>New thread</button>` : ''}</div><p class="wb-list-hint">Check records to act on several at once. Opening a record leaves it unread.</p>${toolbar('history', rows)}<div class="wb-history">${rows.map(r => itemLink(r, 'history')).join('') || '<p class="list-empty">No work in this scope yet.</p>'}</div></section>`);
  }
  function render(next) {
    if (route && (next.kind !== route.kind || next.id !== route.id || next.page !== route.page)) for (const key of ['history', 'members']) { selections[key] = new Set(); notices.delete(key); }
    route = next;
    for (const key of Object.keys(selections)) {
      const ids = new Set(rowsFor(key).map(r => r.id));
      for (const id of selections[key]) if (!ids.has(id)) selections[key].delete(id);
    }
    renderRail(); renderQueue(); renderContent(); syncSelection();
  }
  async function bulkAction(key, actionId) {
    if (pending.has(key)) return;
    const picked = selections[key], ids = [...picked], action = actionsFor(key).find(a => a.id === actionId);
    if (!ids.length || !action) return;
    pending.add(key); notices.delete(key); render(route);
    try {
      await action.run(ids);
      for (const id of ids) picked.delete(id);
      notices.set(key, { text: `${action.label}: ${ids.length} updated.` });
      await refresh();
    } catch (error) { notices.set(key, { text: error.message, error: true }); }
    finally { pending.delete(key); render(route); }
  }
  document.addEventListener('change', e => {
    const input = e.target, key = input.dataset.wbPick || input.dataset.wbAll;
    if (key) {
      if (pending.has(key)) return;
      const ids = input.dataset.wbAll ? rowsFor(key).map(r => r.id) : [input.dataset.id];
      for (const id of ids) input.checked ? selections[key].add(id) : selections[key].delete(id);
      notices.delete(key); render(route); return;
    }
    if (input.id !== 'queue-order') return;
    order = input.value === 'newest' ? 'newest' : 'oldest';
    try { sessionStorage.setItem('workbench.queue-order', order); } catch {}
    render(route);
  });
  document.addEventListener('click', e => {
    const view = e.target.closest('[data-workbench-view]');
    if (view) document.body.dataset.workbenchView = view.dataset.workbenchView;
    if (e.target.closest('a[href^="#"]')) document.body.dataset.workbenchView = 'content';
    const clear = e.target.closest('[data-wb-clear]');
    if (clear && !clear.disabled) { selections[clear.dataset.wbClear].clear(); render(route); return; }
    const action = e.target.closest('[data-wb-action]');
    if (action && !action.disabled) { bulkAction(action.dataset.wbScope, action.dataset.wbAction); return; }
    const button = e.target.closest('[data-workbench-review],#review-next'); if (!button || button.disabled || reviewing) return;
    const current = selected(), next = button.id === 'review-next';
    const candidates = queue().filter(r => r.id !== current?.id);
    const target = current && terminalResponse(current) ? current : null;
    reviewing = true; render(route);
    (async () => {
      if (target?.unread) await review(target.id);
      if (next) {
        const id = candidates.find(r => reviewRows().some(i => i.id === r.id))?.id;
        if (id) navigate({ kind: 'item', id });
        else if (target) navigate({ kind: 'index', page: 'inbox' });
      }
    })().catch(report).finally(() => { reviewing = false; render(route); });
  });
  return { supports, render };
}
