import { escapeHtml, icon, navLinks, toolbar, detail, viewTitle } from './shared.js';

function record(row, model) {
  const id = escapeHtml(row.id);
  const expanded = model.open.has(row.id);
  const selected = model.selected.has(row.id);
  const state = {
    working: 'Working',
    needs_input: 'Needs input',
    done: 'Done',
    error: 'Error',
  }[row.state] || row.state;
  return `<article class="grid-record${selected ? ' is-selected' : ''}">
    <div class="grid-title-cell"><div class="grid-record-kind">${escapeHtml(row.kind)} <span class="grid-read-state${row.unread ? ' is-unread' : ''}">${row.unread ? 'Unread' : 'Read'}</span></div><h2>${escapeHtml(row.title)}</h2></div>
    <div class="grid-status-cell"><div class="grid-field"><span class="grid-field-label">State</span><strong class="grid-state grid-state-${escapeHtml(row.state)}">${escapeHtml(state)}</strong></div><div class="grid-field"><span class="grid-field-label">Agent</span><span>${escapeHtml(row.agent)}</span></div></div>
    <div class="grid-record-fields"><div class="grid-field grid-task"><span class="grid-field-label">Task</span><code>${escapeHtml(row.task)}</code></div><div class="grid-field grid-time"><span class="grid-field-label">Updated</span><span>${escapeHtml(row.time)}</span></div><div class="grid-field grid-source"><span class="grid-field-label">Source</span><span>${escapeHtml(row.source)}</span></div><div class="grid-record-actions"><label class="grid-select"><input type="checkbox" data-act="select" data-id="${id}" aria-label="Select ${escapeHtml(row.title)}"${selected ? ' checked' : ''}>Select</label><button type="button" data-act="expand" data-id="${id}" aria-label="${expanded ? 'Close' : 'Inspect'} ${escapeHtml(row.title)}" aria-expanded="${expanded}" aria-controls="result-${id}">${expanded ? 'Close' : 'Inspect'}${icon('chevron')}</button></div></div>
    ${expanded ? `<div class="grid-expanded" id="result-${id}">${detail(row)}</div>` : ''}
  </article>`;
}

export function render(model) {
  const title = viewTitle(model.view);
  const count = model.counts[model.view] ?? 0;
  return `<div class="grid-workspace">
    <header class="grid-header"><div class="grid-brand">tuios inbox</div><div class="grid-page-heading"><h1>${escapeHtml(title)}</h1><span class="grid-view-count">${escapeHtml(count)} records</span></div><div class="grid-create-cell"><button type="button" data-act="add-sample">${icon('plus')}Add sample work</button></div></header>
    <nav class="grid-navigation" aria-label="Workspace views">${navLinks(model)}</nav>
    <main class="grid-main"><div class="grid-toolbar">${toolbar(model)}</div><section class="grid-records" aria-label="${escapeHtml(title)} records">${model.rows.length ? model.rows.map(row => record(row, model)).join('') : `<div class="grid-empty"><h2>No matching records</h2><p>Try another search or turn off the unread filter. You can also add sample work to explore this view.</p><button type="button" data-act="add-sample">${icon('plus')}Add sample work</button></div>`}</section></main>
  </div>`;
}
