import { escapeHtml, icon, navLinks, toolbar, detail, viewTitle } from './shared.js';

const stateLabels = { working: 'Working', needs_input: 'Needs your input', done: 'Done', error: 'Error — review needed' };
const introductions = {
  inbox: 'Review the work that needs you. Open a record to read the result and its source.',
  turns: 'Follow each exchange. Keep the question and the returned work in view.',
  tasks: 'A working index of assignments, their owners, and the latest result.',
  agents: 'Inspect the work your agents are doing, one record at a time.',
  archive: 'Return to completed work. Open a record to revisit its response.',
  profiles: 'Review the sample profiles and the work associated with each one.'
};

function record(row, model) {
  const id = escapeHtml(row.id);
  const title = escapeHtml(row.title);
  const expanded = model.open.has(row.id);
  const attention = row.state === 'needs_input' || row.state === 'error';
  return `<article class="bitmap-record${attention ? ' bitmap-attention' : ''}${row.unread ? ' bitmap-unread' : ''}">
    <div class="bitmap-record-meta">
      <label class="bitmap-selection"><input type="checkbox" data-act="select" data-id="${id}" aria-label="Select ${title}" ${model.selected.has(row.id) ? 'checked' : ''}><span>Select</span></label>
      <span>${escapeHtml(row.kind)}</span>
      <strong class="bitmap-state">${escapeHtml(stateLabels[row.state] || row.state)}</strong>
      <span class="bitmap-read">${row.unread ? 'Unread' : 'Read'}</span>
      <time>${escapeHtml(row.time)}</time>
    </div>
    <button class="bitmap-open" data-act="expand" data-id="${id}" aria-expanded="${expanded}" aria-controls="result-${id}">
      <span class="bitmap-record-title">${title}</span>
      <span class="bitmap-open-label">${expanded ? 'Close result' : 'Open result'} ${icon(expanded ? 'arrowLeft' : 'arrowRight')}</span>
    </button>
    <div class="bitmap-provenance"><span>Agent <strong>${escapeHtml(row.agent)}</strong></span><span>Task <code>${escapeHtml(row.task)}</code></span></div>
    ${expanded ? `<section class="bitmap-response" id="result-${id}" aria-label="Result for ${title}">${detail(row)}</section>` : ''}
  </article>`;
}

export function render(model) {
  const title = viewTitle(model.view);
  return `<div class="bitmap-workspace">
    <header class="bitmap-masthead">
      <div class="bitmap-brand">tuios inbox<span class="bitmap-brand-mark" aria-hidden="true"></span></div>
      <nav class="bitmap-navigation" aria-label="Workspace">${navLinks(model)}</nav>
    </header>
    <main class="bitmap-desk">
      <aside class="bitmap-introduction">
        <h1>${escapeHtml(title)}</h1>
        <p class="bitmap-total"><strong>${escapeHtml(model.counts[model.view] ?? 0)}</strong> sample records</p>
        <p>${escapeHtml(introductions[model.view] || introductions.inbox)}</p>
        <button class="bitmap-add" data-act="add-sample">${icon('plus')} Add sample work</button>
        <p class="bitmap-reading-note">Select records to keep your place. Open a result to inspect the sample response.</p>
      </aside>
      <section class="bitmap-index" aria-label="${escapeHtml(title)} work index">
        <div class="bitmap-tools">${toolbar(model)}</div>
        <div class="bitmap-records">${model.rows.length ? model.rows.map(row => record(row, model)).join('') : `<div class="bitmap-empty"><h2>No matching records</h2><p>Try another search, turn off the unread filter, or add sample work to this view.</p></div>`}</div>
      </section>
    </main>
  </div>`;
}
