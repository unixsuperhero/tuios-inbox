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
    children(current, desired);
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

export function createWorkbench({ root, navigate, load, review, report }) {
  let route, order = 'oldest', reviewing = false;
  try { order = sessionStorage.getItem('workbench.queue-order') === 'newest' ? 'newest' : 'oldest'; } catch {}
  const supports = r => r.kind === 'item' || r.kind === 'task' || r.kind === 'agent' || r.kind === 'index' && r.page === 'inbox';
  const selected = () => route?.kind === 'item' ? store.state.items.find(i => i.id === route.id) : null;
  const queue = () => order === 'newest' ? reviewRows().reverse() : reviewRows();
  function renderRail() {
    const rail = document.querySelector('#task-rail'); if (!rail) return;
    const item = selected(), activeAgent = route?.kind === 'agent' ? route.id : item?.agent_id;
    const activeTask = route?.kind === 'task' ? route.id : item?.task_id || store.state.agents.find(a => a.id === activeAgent)?.task_id;
    const agents = store.state.agents.filter(a => !a.archived);
    const tasks = store.state.tasks.filter(t => !t.archived);
    const agentHTML = a => `<a class="wb-agent state-${stateClass(a.state)}${a.id === activeAgent ? ' active' : ''}" data-wb-key="agent:${esc(a.id)}" href="${href('agent', a.id)}"${a.id === activeAgent ? ' aria-current="page"' : ''}><span class="wb-agent-name">${esc(agentName(a.name, a.id))}</span><small>${esc(a.kind || 'agent')} · ${esc(a.state || 'unknown')}</small></a>`;
    const group = (task, members) => `<section class="wb-task${task?.id === activeTask ? ' active' : ''}" data-wb-key="task:${esc(task?.id || 'unassigned')}">${task ? `<a class="wb-task-title" href="${href('task', task.id)}"${task.id === activeTask ? ' aria-current="page"' : ''}>${esc(task.title)}</a>` : '<h3 class="wb-task-title">Unassigned</h3>'}<div class="wb-agents">${members.map(agentHTML).join('') || '<p class="hint">No agents</p>'}</div></section>`;
    patchHTML(rail, `<div class="wb-rail-heading"><h2>Tasks & agents</h2><a href="#tasks">All tasks</a></div>${tasks.map(t => group(t, agents.filter(a => a.task_id === t.id))).join('')}${group(null, agents.filter(a => !tasks.some(t => t.id === a.task_id)))}`);
  }
  function itemLink(row, className) {
    return `<a class="${className} state-${stateClass(row.status)}${selected()?.id === row.id ? ' active' : ''}" data-wb-key="${esc(row.id)}" data-item-id="${esc(row.id)}" href="${href('item', row.id)}"${selected()?.id === row.id ? ' aria-current="page"' : ''}><strong>${esc(row.title || 'Prompt not captured')}</strong><span>${esc(row.type)} · ${esc(row.agent_name || row.agent_id || 'No agent')}</span><small>${esc(row.status)} · ${esc(time(row.updated))}${row.unread ? ' · Unread' : ' · Reviewed'}</small></a>`;
  }
  function renderQueue() {
    const el = document.querySelector('#review-queue'); if (!el) return;
    const rows = queue(), current = selected();
    patchHTML(el, `<div class="wb-queue-heading"><h2>Review queue <span>${rows.length}</span></h2><label>Order<select id="queue-order"><option value="oldest"${order === 'oldest' ? ' selected' : ''}>Oldest first</option><option value="newest"${order === 'newest' ? ' selected' : ''}>Newest first</option></select></label><button id="review-next"${reviewing || !rows.length && !(current?.unread && terminalResponse(current)) ? ' disabled' : ''}>Review next</button></div><div class="wb-queue-items">${rows.map(r => itemLink(r, 'wb-queue-item')).join('') || '<p class="list-empty">Nothing waiting for review.</p>'}</div>`);
  }
  function renderContent() {
    if (!supports(route)) return;
    const item = selected();
    if (route.kind === 'item') {
      if (!item) { patchHTML(root, '<p class="list-empty">This record is no longer available.</p>'); return; }
      const pending = terminalResponse(item) && item.unread;
      patchHTML(root, `<article class="wb-content wb-item" data-wb-key="opened:${esc(item.id)}"><div class="wb-summary">${pages.inbox.list.summary(item)}</div><div class="wb-review-actions"><button data-workbench-review="${esc(item.id)}"${!pending || reviewing ? ' disabled' : ''}>${item.unread ? 'Reviewed' : 'Already reviewed'}</button>${item.task_id ? `<a href="${href('task', item.task_id)}">Task history</a>` : ''}${item.agent_id ? `<a href="${href('agent', item.agent_id)}">Agent history</a>` : ''}</div><div class="wb-item-detail">${pages.inbox.list.detail(item)}</div></article>`);
      load(item.id, false).catch(report); return;
    }
    const rows = store.state.items.filter(i => !i.archived && (route.kind === 'task' ? i.task_id === route.id : route.kind === 'agent' ? i.agent_id === route.id : true)).sort(chronological).reverse();
    const agent = route.kind === 'agent' && store.state.agents.find(a => a.id === route.id);
    const taskId = route.kind === 'task' ? route.id : agent?.task_id;
    patchHTML(root, `<section class="wb-content"><div class="wb-history-heading"><h2>${route.kind === 'index' ? 'Recent work' : 'History'} <span>${rows.length}</span></h2>${taskId ? `<button data-do="compose" data-id="${esc(taskId)}"${agent ? ` data-agent-id="${esc(agent.id)}"` : ''}>New thread</button>` : ''}</div><div class="wb-history">${rows.map(r => itemLink(r, 'wb-history-item')).join('') || '<p class="list-empty">No work in this scope yet.</p>'}</div></section>`);
  }
  function render(next) { route = next; renderRail(); renderQueue(); renderContent(); }
  document.addEventListener('change', e => {
    if (e.target.id !== 'queue-order') return;
    order = e.target.value === 'newest' ? 'newest' : 'oldest';
    try { sessionStorage.setItem('workbench.queue-order', order); } catch {}
    renderQueue();
  });
  document.addEventListener('click', e => {
    const view = e.target.closest('[data-workbench-view]');
    if (view) document.body.dataset.workbenchView = view.dataset.workbenchView;
    if (e.target.closest('a[href^="#"]')) document.body.dataset.workbenchView = 'content';
    const button = e.target.closest('[data-workbench-review],#review-next'); if (!button || button.disabled || reviewing) return;
    const current = selected(), next = button.id === 'review-next';
    const candidates = queue().filter(r => r.id !== current?.id);
    const target = current && terminalResponse(current) ? current : null;
    reviewing = true; renderQueue(); renderContent();
    (async () => {
      if (target?.unread) await review(target.id);
      if (next) {
        const id = candidates.find(r => reviewRows().some(i => i.id === r.id))?.id;
        if (id) navigate({ kind: 'item', id });
        else if (target) navigate({ kind: 'index', page: 'inbox' });
      }
    })().catch(report).finally(() => { reviewing = false; renderQueue(); renderContent(); });
  });
  return { supports, render };
}
