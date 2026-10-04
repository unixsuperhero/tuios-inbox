// Queues page: one bucket per task, oldest at the top, read on the right. Records, actions, drafts
// and forms are the workbench's own (pages.js detail + app.js handlers); this module only lays
// them out as a queue and moves you to the next one.
import { store, pages, esc, agentName, unfinished } from '/pages.js';
import { patchHTML } from '/workbench.js';
import { buildBuckets, nextAfter, waitingFor, ALL } from '/queue-model.js';

const href = (bucket, item) => `#queue/${encodeURIComponent(bucket)}${item ? '/' + encodeURIComponent(item) : ''}`;
const time = value => value ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
// Unread and not archived is the queue; a turn still running has nothing to review yet unless it is asking you something.
const reviewable = row => !(unfinished(row) && row.status !== 'needs_input');
const typing = () => document.activeElement?.matches('input, textarea, select, [contenteditable]');

export function createQueues({ root, navigate, load, review, report }) {
  let route = null, reviewing = false;
  const agentFilters = new Map(); // bucket id -> agent id ('' = no agent), absent = all
  const supports = r => r?.kind === 'queue' || r?.kind === 'index' && r.page === 'queues';
  const model = () => buildBuckets({ tasks: store.state.tasks, items: store.state.items, reviewable, label: row => row.agent_id ? agentName(row.agent_name, row.agent_id) : '' });
  const count = () => model().all.count;

  function current() {
    const { all, buckets } = model();
    const wanted = route?.kind === 'queue' ? route.bucket : null;
    const bucket = wanted === ALL ? all : buckets.find(b => b.id === wanted) || (wanted ? null : buckets.find(b => b.count) || all);
    if (!bucket) return { all, buckets, bucket: null, rows: [], item: null };
    const filter = agentFilters.get(bucket.id);
    const rows = filter === undefined ? bucket.rows : bucket.rows.filter(r => (r.agent_id || '') === filter);
    const item = route?.kind === 'queue' && route.item ? store.state.items.find(i => i.id === route.item) || null : null;
    return { all, buckets, bucket, rows, item };
  }

  function renderRail({ all, buckets, bucket }) {
    const rail = document.querySelector('#task-rail'); if (!rail) return;
    const link = b => `<a class="qb-bucket${b.count ? '' : ' is-empty'}" href="${href(b.id)}" data-wb-key="bucket:${esc(b.id)}"${b.id === bucket?.id ? ' aria-current="page"' : ''}><span><strong>${esc(b.title)}</strong>${b.count ? `<small>oldest waiting ${waitingFor(b.rows[0])}</small>` : '<small>nothing to review</small>'}</span><span class="qb-count">${b.count}</span></a>`;
    patchHTML(rail, `<div class="wb-rail-heading"><h2>Queues</h2><p class="hint">One queue per task. Unread work waits here, oldest at the top, until you mark it reviewed or reply.</p></div>${link(all)}<p class="wb-members-label">By task</p>${buckets.map(link).join('')}`);
  }

  function row(r, bucket, item, position, total) {
    return `<div class="wb-record ${r.unread ? 'is-unread' : 'is-read'}" data-wb-key="${esc(r.id)}"><a class="wb-record-link" href="${href(bucket.id, r.id)}"${item?.id === r.id ? ' aria-current="page"' : ''}>
      <strong>${esc(r.title || 'Prompt not captured')}</strong>
      <span>${esc(r.agent_id ? agentName(r.agent_name, r.agent_id) : 'No agent')} · ${esc(r.type)}${r.status === 'needs_input' ? ' · <b class="qb-blocked">needs your answer</b>' : ''}</span>
      <small>${esc(r.status)} · ${esc(time(r.updated))} · waiting ${waitingFor(r)}</small>
      <span class="qb-position">${position} of ${total}</span></a></div>`;
  }

  function renderMain({ bucket, rows, item }) {
    if (!bucket) { patchHTML(root, '<p class="list-empty">No queue at this address.</p>'); return; }
    const filter = agentFilters.get(bucket.id);
    const chip = (id, name, n, on) => `<button type="button" data-qb-agent="${esc(id)}" aria-pressed="${on}">${esc(name)} <span>${n}</span></button>`;
    const chips = bucket.agents.length > 1 ? `<div class="qb-chips" role="group" aria-label="Agents in this queue">${chip('*', 'All', bucket.count, filter === undefined)}${bucket.agents.map(a => chip(a.id, a.name, a.count, filter === a.id)).join('')}</div>` : '';
    const head = `<div class="qb-queue-head" data-wb-key="head"><h2>${esc(bucket.title)} <span class="qb-count">${rows.length}</span></h2><p class="hint">Oldest at the top. <span class="qb-kbd"><kbd>↑</kbd><kbd>↓</kbd> move · <kbd>r</kbd> mark reviewed and go to the next</span></p>${chips}</div>`;
    const list = rows.length ? rows.map((r, i) => row(r, bucket, item, i + 1, rows.length)).join('') : `<p class="qb-empty">Nothing waiting in this queue.</p>`;
    let reading;
    if (!item) {
      reading = rows.length ? `<div class="qb-empty"><p>Start at the top: the oldest thing waiting is <strong>${esc(rows[0].title || 'Prompt not captured')}</strong>.</p><p><a class="primary qb-start" href="${href(bucket.id, rows[0].id)}">Open the oldest</a></p></div>` : '<div class="qb-empty"><p>This queue is clear.</p></div>';
    } else {
      const inQueue = rows.some(r => r.id === item.id), pendingReview = item.unread && reviewable(item);
      reading = `<a class="qb-back" href="${href(bucket.id)}">← Queue</a><article class="wb-content wb-item ${item.unread ? 'is-unread' : 'is-read'}" data-wb-key="opened:${esc(item.id)}">
        <div class="wb-summary">${pages.inbox.list.summary(item)}</div>
        <div class="wb-review-actions"><button class="primary" data-qb-review="${esc(item.id)}"${!pendingReview || reviewing ? ' disabled' : ''}>${item.unread ? 'Mark reviewed · next' : 'Reviewed'}</button>${inQueue ? '' : '<span class="hint">No longer in this queue.</span>'}<a href="#item/${encodeURIComponent(item.id)}">Open in workbench</a>${item.task_id ? `<a href="#task/${encodeURIComponent(item.task_id)}">Task history</a>` : ''}</div>
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

  async function reviewAndAdvance() {
    const { bucket, rows, item } = current(); if (!bucket || !item || reviewing || !(item.unread && reviewable(item))) return;
    const next = nextAfter(rows, item.id);
    reviewing = true; render(route);
    try { await review(item.id); navigate({ kind: 'queue', bucket: bucket.id, item: next || undefined }); }
    catch (e) { report(e); }
    finally { reviewing = false; render(route); }
  }

  document.addEventListener('click', e => {
    if (!supports(route)) return;
    const chip = e.target.closest('[data-qb-agent]');
    if (chip) { const { bucket } = current(); if (chip.dataset.qbAgent === '*') agentFilters.delete(bucket.id); else agentFilters.set(bucket.id, chip.dataset.qbAgent); render(route); return; }
    if (e.target.closest('[data-qb-review]') && !e.target.closest('button').disabled) reviewAndAdvance();
  });
  document.addEventListener('keydown', e => {
    if (!supports(route) || typing() || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); move(-1); }
    else if (e.key === 'r') { e.preventDefault(); reviewAndAdvance(); }
  });
  return { supports, render, count };
}
