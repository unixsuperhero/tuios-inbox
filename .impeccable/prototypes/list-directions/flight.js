import { escapeHtml, icon, navLinks, toolbar, detail, viewTitle } from './shared.js';

const states = {
  working: ['Working', 'Work in progress'],
  needs_input: ['Needs input', 'Your response is needed'],
  done: ['Done', 'Work completed'],
  error: ['Error', 'Review the sample result'],
};

function strip(row, model) {
  const expanded = model.open.has(row.id);
  const [state, description] = states[row.state] || [row.state, 'Sample status'];
  const e = escapeHtml;
  return `<article class="flight-strip${row.unread ? ' is-unread' : ''}${model.selected.has(row.id) ? ' is-selected' : ''}">
    <div class="flight-selection"><input type="checkbox" data-act="select" data-id="${e(row.id)}" aria-label="${e(`Select ${row.title}`)}" ${model.selected.has(row.id) ? 'checked' : ''}></div>
    <div class="flight-subject"><div class="flight-reading">${row.unread ? '<span class="flight-unread-dot" aria-hidden="true"></span>Unread' : 'Read'} <span>${e(row.kind)}</span></div><h2>${e(row.title)}</h2><div class="flight-identifiers"><span>Task <code>${e(row.task || 'Unassigned')}</code></span><span>Agent <code>${e(row.agent || 'Unassigned')}</code></span></div></div>
    <div class="flight-state" data-state="${e(row.state)}"><strong>${e(state)}</strong><span>${e(description)}</span></div>
    <div class="flight-time"><span>Updated</span><time>${e(row.time)}</time></div>
    <button class="flight-expand" type="button" data-act="expand" data-id="${e(row.id)}" aria-expanded="${expanded}" aria-controls="result-${e(row.id)}" aria-label="${e(`${expanded ? 'Collapse' : 'Expand'} ${row.title}`)}">${icon('chevron')}<span>${expanded ? 'Close' : 'Open'}</span></button>
    ${expanded ? `<div class="flight-expanded" id="result-${e(row.id)}">${detail(row)}</div>` : ''}
  </article>`;
}

export function render(model) {
  const title = viewTitle(model.view);
  return `<div class="flight-workspace">
    <aside class="flight-rail"><a class="flight-brand" href="?variant=flight" aria-label="tuios inbox Flight deck prototype">tuios inbox</a><nav aria-label="Workspace views">${navLinks(model)}</nav><div class="flight-rail-note">A clear queue.<br>One next action.</div></aside>
    <main class="flight-main"><header class="flight-masthead"><div class="flight-heading"><h1>${escapeHtml(title)}</h1><span class="flight-count">${model.rows.length} ${model.rows.length === 1 ? 'item' : 'items'}</span></div><button class="flight-add" type="button" data-act="add-sample">${icon('plus')}Add sample work</button></header>
      <section class="flight-controls" aria-label="Queue controls">${toolbar(model)}</section>
      <section class="flight-queue" aria-label="${escapeHtml(title)} queue">${model.rows.length ? `<div class="flight-strip-head" aria-hidden="true"><span></span><span>Work / assignment</span><span>Status</span><span>Updated</span><span>Result</span></div>${model.rows.map(row => strip(row, model)).join('')}` : `<div class="flight-empty"><h2>No work in this view</h2><p>Clear your search or unread filter to see more sample work, or add a sample to explore this queue.</p><button class="flight-add" type="button" data-act="add-sample">${icon('plus')}Add sample work</button></div>`}</section>
    </main>
  </div>`;
}
