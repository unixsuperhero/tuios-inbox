// Queues page: one bucket per task, oldest at the top, read on the right. Records, actions, drafts
// and forms are the workbench's own (pages.js detail + app.js handlers); this module only lays
// them out as a queue and moves you to the next one.
import { store, pages, esc, agentName, hostLabel, unfinished, api, taskTree } from '/pages.js';
import { patchHTML } from '/workbench.js';
import { buildBuckets, nextAfter, waitingFor, byOldest, ALL } from '/queue-model.js';

const href = (bucket, item) => `#queue/${encodeURIComponent(bucket)}${item ? '/' + encodeURIComponent(item) : ''}`;
const time = value => value ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
// Unread and not archived is the queue; a turn still running has nothing to review yet unless it is asking you something.
const reviewable = row => !(unfinished(row) && row.status !== 'needs_input');
const typing = () => document.activeElement?.matches('input, textarea, select, [contenteditable]');

export function createQueues({ root, navigate, load, review, refresh, report }) {
  let route = null, reviewing = false, pending = false, showCommands = false;
  try { showCommands = sessionStorage.getItem('queues.commands') === '1'; } catch {}
  const picked = new Set();
  const agentFilters = new Map(); // bucket id -> agent id ('' = no agent), absent = all
  const supports = r => r?.kind === 'queue' || r?.kind === 'index' && r.page === 'queues';
  const model = () => buildBuckets({ tasks: store.state.tasks, items: store.state.items, reviewable, label: row => row.agent_id ? agentName(row.agent_name, row.agent_id) : '' });
  const count = () => model().all.count;

  function current() {
    const { all, buckets } = model();
    const wanted = route?.kind === 'queue' ? route.bucket : null;
    const bucket = wanted === ALL ? all : buckets.find(b => b.id === wanted) || (wanted ? null : buckets.find(b => b.count) || all);
    if (!bucket) return { all, buckets, bucket: null, rows: [], item: null };
    const filter = agentFilters.get(bucket.id), source = showCommands ? bucket.commands : bucket.rows;
    let rows = filter === undefined ? source : source.filter(r => (r.agent_id || '') === filter);
    const item = route?.kind === 'queue' && route.item ? store.state.items.find(i => i.id === route.item) || null : null;
    // Opening marks a record read, which would drop it from the queue mid-read; the open one keeps its place until you move on.
    if (item && !item.archived && (item.type === 'command') === showCommands && !rows.some(r => r.id === item.id)) rows = [...rows, item].sort(byOldest);
    return { all, buckets, bucket, rows, item };
  }

  function renderRail({ all, buckets, bucket }) {
    const rail = document.querySelector('#task-rail'); if (!rail) return;
    const link = (b, depth = 0) => `<a class="qb-bucket${b.count ? '' : ' is-empty'}" href="${href(b.id)}" data-wb-key="bucket:${esc(b.id)}" style="--depth:${depth}"${b.id === bucket?.id ? ' aria-current="page"' : ''}><span><strong>${esc(b.title)}</strong>${b.count ? `<small>oldest waiting ${waitingFor(b.rows[0])}${b.commandCount ? ` · ${b.commandCount} command${b.commandCount === 1 ? '' : 's'}` : ''}</small>` : `<small>${b.commandCount ? `${b.commandCount} command${b.commandCount === 1 ? '' : 's'} only` : 'nothing to review'}</small>`}</span><span class="qb-count">${b.count}</span></a>`;
    patchHTML(rail, `<div class="wb-rail-heading"><h2>Queues</h2><p class="hint">One queue per task. Unread work waits here, oldest at the top, until you mark it reviewed or reply.</p></div>${link(all)}<p class="wb-members-label">By task</p>${taskTree(store.state.tasks.filter(t => !t.archived)).map(t => { const b = buckets.find(x => x.id === t.id); return b ? link(b, t.depth) : ''; }).join('')}${link(buckets.find(b => b.id === 'unassigned'))}`);
  }

  function row(r, bucket, item, position, total) {
    return `<div class="wb-record ${r.unread ? 'is-unread' : 'is-read'}${picked.has(r.id) ? ' is-picked' : ''}" data-wb-key="${esc(r.id)}"><input type="checkbox" data-qb-pick="${esc(r.id)}" aria-label="Select ${esc(r.title || 'record')}"${picked.has(r.id) ? ' checked' : ''}${pending ? ' disabled' : ''}><a class="wb-record-link" href="${href(bucket.id, r.id)}"${item?.id === r.id ? ' aria-current="page"' : ''}>
      <strong>${esc(r.title || 'Prompt not captured')}</strong>
      <span>${esc(r.agent_id ? agentName(r.agent_name, r.agent_id) : 'No agent')} · ${esc(r.type)}${r.status === 'needs_input' ? ' · <b class="qb-blocked">needs your answer</b>' : ''}</span>
      ${r.agent_id ? `<span class="host-label">Host: ${esc(hostLabel(r.agent_id))}</span>` : ''}
      <small>${esc(r.status)} · ${esc(time(r.updated))} · waiting ${waitingFor(r)}</small>
      <span class="qb-position">${position} of ${total}</span></a></div>`;
  }

  function renderMain({ bucket, rows, item }) {
    if (!bucket) { patchHTML(root, '<p class="list-empty">No queue at this address.</p>'); return; }
    const filter = agentFilters.get(bucket.id);
    const chip = (id, name, n, on) => `<button type="button" data-qb-agent="${esc(id)}" aria-pressed="${on}">${esc(name)} <span>${n}</span></button>`;
    const chips = bucket.agents.length > 1 ? `<div class="qb-chips" role="group" aria-label="Agents in this queue">${chip('*', 'All', bucket.count, filter === undefined)}${bucket.agents.map(a => chip(a.id, a.name, a.count, filter === a.id)).join('')}</div>` : '';
    for (const id of picked) if (!rows.some(r => r.id === id)) picked.delete(id);
    const tasks = store.state.tasks.filter(t => !t.archived);
    const bulk = `<div class="qb-bulk" data-wb-key="bulk"><label class="wb-select-all"><input type="checkbox" data-qb-all${!rows.length || pending ? ' disabled' : ''}${rows.length && picked.size === rows.length ? ' checked' : ''}>Select all</label><span class="wb-selection-count">${picked.size ? `${picked.size} selected` : ''}</span>${picked.size ? `<button type="button" data-qb-bulk="read"${pending ? ' disabled' : ''}>Mark reviewed</button><button type="button" data-qb-bulk="archive"${pending ? ' disabled' : ''}>Archive</button><select data-qb-assign aria-label="Assign checked to task"${pending ? ' disabled' : ''}><option value="">Assign to task…</option><option value="__none">No task</option>${tasks.map(t => `<option value="${esc(t.id)}">${esc(t.title)}</option>`).join('')}</select>` : ''}</div>`;
    const kinds = `<div class="qb-kinds" role="group" aria-label="What to show"><button type="button" data-qb-kind="work" aria-pressed="${!showCommands}">Everything else <span>${bucket.count}</span></button><button type="button" data-qb-kind="commands" aria-pressed="${showCommands}">Commands <span>${bucket.commandCount}</span></button></div>`;
    const head = `<div class="qb-queue-head" data-wb-key="head"><h2>${esc(bucket.title)} <span class="qb-count">${rows.length}</span></h2><p class="hint">Oldest at the top. Opening a record marks it read. <span class="qb-kbd"><kbd>↑</kbd><kbd>↓</kbd> move · <kbd>n</kbd> next · <kbd>u</kbd> mark unread</span></p>${kinds}${chips}${bulk}</div>`;
    const list = rows.length ? rows.map((r, i) => row(r, bucket, item, i + 1, rows.length)).join('') : `<p class="qb-empty">${showCommands ? 'No unread commands here.' : 'Nothing waiting in this queue.'}</p>`;
    let reading;
    if (!item) {
      reading = rows.length ? `<div class="qb-empty"><p>Start at the top: the oldest thing waiting is <strong>${esc(rows[0].title || 'Prompt not captured')}</strong>.</p><p><a class="primary qb-start" href="${href(bucket.id, rows[0].id)}">Open the oldest</a></p></div>` : '<div class="qb-empty"><p>This queue is clear.</p></div>';
    } else {
      const next = nextAfter(rows, item.id);
      reading = `<a class="qb-back" href="${href(bucket.id)}">← Queue</a><article class="wb-content wb-item ${item.unread ? 'is-unread' : 'is-read'}" data-wb-key="opened:${esc(item.id)}">
        <div class="wb-summary">${pages.inbox.list.summary(item)}</div>
        <div class="wb-review-actions"><button class="primary" data-qb-next${!next || reviewing ? ' disabled' : ''}>Next</button><button data-qb-toggle="${esc(item.id)}"${reviewing ? ' disabled' : ''}>${item.unread ? 'Mark read' : 'Mark unread'}</button><a href="#item/${encodeURIComponent(item.id)}">Open in workbench</a>${item.task_id ? `<a href="#task/${encodeURIComponent(item.task_id)}">Task history</a>` : ''}</div>
        <div class="wb-item-detail">${pages.inbox.list.detail(item)}</div></article>`;
    }
    patchHTML(root, `<div class="qb-layout"${item ? ' data-selected' : ''}><section class="qb-queue" aria-label="Queue">${head}<div class="qb-rows">${list}</div></section><section class="qb-reading" aria-label="Reading pane">${reading}</section></div>`);
    if (item) load(item.id, false).catch(report);
  }

  function render(next) {
    route = next;
    const state = current();
    renderRail(state); renderMain(state);
  }

  function move(delta) {
    const { bucket, rows, item } = current(); if (!bucket || !rows.length) return;
    const i = item ? rows.findIndex(r => r.id === item.id) : -1;
    const target = i < 0 ? rows[0] : rows[Math.min(rows.length - 1, Math.max(0, i + delta))];
    if (target && target.id !== item?.id) navigate({ kind: 'queue', bucket: bucket.id, item: target.id });
  }

  function advance() {
    const { bucket, rows, item } = current(); if (!bucket || !item || reviewing) return;
    const next = nextAfter(rows, item.id);
    navigate({ kind: 'queue', bucket: bucket.id, item: next || undefined });
  }
  async function toggleRead() {
    const { item } = current(); if (!item || reviewing) return;
    reviewing = true; render(route);
    try { await review(item.id, !item.unread); } catch (e) { report(e); } finally { reviewing = false; render(route); }
  }

  async function bulkUpdate(set) {
    const ids = [...picked]; if (!ids.length || pending) return;
    pending = true; render(route);
    try { await api('/items/update', { ids, set }); picked.clear(); await refresh(); }
    catch (e) { report(e); }
    finally { pending = false; render(route); }
  }
  document.addEventListener('change', e => {
    if (!supports(route)) return;
    const input = e.target;
    if (input.dataset.qbPick !== undefined) { input.checked ? picked.add(input.dataset.qbPick) : picked.delete(input.dataset.qbPick); render(route); return; }
    if (input.dataset.qbAll !== undefined) { const { rows } = current(); picked.clear(); if (input.checked) for (const r of rows) picked.add(r.id); render(route); return; }
    if (input.dataset.qbAssign !== undefined) { const value = input.value; if (!value) return; input.value = ''; bulkUpdate({ task_id: value === '__none' ? null : value }); }
  });
  document.addEventListener('click', e => {
    if (!supports(route)) return;
    const bulk = e.target.closest('[data-qb-bulk]');
    if (bulk && !bulk.disabled) { bulkUpdate(bulk.dataset.qbBulk === 'read' ? { unread: false } : { archived: true }); return; }
    const kind = e.target.closest('[data-qb-kind]');
    if (kind) { showCommands = kind.dataset.qbKind === 'commands'; try { sessionStorage.setItem('queues.commands', showCommands ? '1' : '0'); } catch {} picked.clear(); render(route); return; }
    const chip = e.target.closest('[data-qb-agent]');
    if (chip) { const { bucket } = current(); if (chip.dataset.qbAgent === '*') agentFilters.delete(bucket.id); else agentFilters.set(bucket.id, chip.dataset.qbAgent); render(route); return; }
    if (e.target.closest('[data-qb-next]') && !e.target.closest('button').disabled) advance();
    else if (e.target.closest('[data-qb-toggle]') && !e.target.closest('button').disabled) toggleRead();
  });
  document.addEventListener('keydown', e => {
    if (!supports(route) || typing() || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); move(-1); }
    else if (e.key === 'n') { e.preventDefault(); advance(); }
    else if (e.key === 'u') { e.preventDefault(); toggleRead(); }
  });
  return { supports, render, count };
}
