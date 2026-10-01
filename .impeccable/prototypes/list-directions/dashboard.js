import { escapeHtml, icon, navLinks, toolbar, detail, viewTitle } from './shared.js';

const stateNames = { working: 'Working', needs_input: 'Needs input', done: 'Done', error: 'Error' };

export function render(model) {
  const title = viewTitle(model.view);
  const rows = model.rows.map((row) => {
    const selected = model.selected.has(row.id);
    const open = model.open.has(row.id);
    const state = Object.hasOwn(stateNames, row.state) ? row.state : 'other';
    return `<li class="dashboard-record${selected ? ' is-selected' : ''}${row.unread ? ' is-unread' : ''}">
      <div class="dashboard-record-main">
        <input class="dashboard-select" type="checkbox" data-act="select" data-id="${escapeHtml(row.id)}" aria-label="${escapeHtml(`Select ${row.title}`)}"${selected ? ' checked' : ''}>
        <div class="dashboard-record-copy">
          <button class="dashboard-expand" type="button" data-act="expand" data-id="${escapeHtml(row.id)}" aria-expanded="${open}" aria-controls="result-${escapeHtml(row.id)}"><span class="dashboard-record-title">${escapeHtml(row.title)}</span><span class="dashboard-chevron${open ? ' is-open' : ''}">${icon('chevron')}</span></button>
          <div class="dashboard-metadata"><span>${escapeHtml(row.task)}</span><span>${escapeHtml(row.agent)}</span><span>${escapeHtml(row.kind)}</span></div>
          <div class="dashboard-read-state"><span>${row.unread ? 'Unread' : 'Read'}</span>${selected ? '<span>Selected</span>' : ''}</div>
        </div>
        <div class="dashboard-record-status"><span class="dashboard-status dashboard-status-${state}">${escapeHtml(stateNames[row.state] || row.state)}</span><time>${escapeHtml(row.time)}</time></div>
      </div>
      <div class="dashboard-detail" id="result-${escapeHtml(row.id)}"${open ? '' : ' hidden'}>${open ? detail(row) : ''}</div>
    </li>`;
  }).join('');
  return `<div class="dashboard-workspace">
    <aside class="dashboard-sidebar"><div class="dashboard-brand">tuios inbox</div><nav aria-label="Workspace views">${navLinks(model)}</nav><p class="dashboard-sidebar-note">Your agent work,<br>in one place.</p></aside>
    <main class="dashboard-main">
      <header class="dashboard-header"><div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(model.counts[model.view] ?? 0)} records in this view</p></div><button class="dashboard-add" type="button" data-act="add-sample">Add sample work</button></header>
      <div class="dashboard-toolbar">${toolbar(model)}</div>
      ${rows ? `<ul class="dashboard-records" aria-label="${escapeHtml(title)} records">${rows}</ul>` : `<section class="dashboard-empty"><h2>No matching records</h2><p>Try another search, turn off the unread filter, or add sample work.</p></section>`}
    </main>
  </div>`;
}
