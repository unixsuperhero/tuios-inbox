import { escapeHtml, icon, navLinks, toolbar, detail, viewTitle } from './shared.js';

const stateNames = { working: 'Working', needs_input: 'Needs input', done: 'Done', error: 'Error' };

function record(row, model) {
  const id = escapeHtml(row.id);
  const title = escapeHtml(row.title);
  const expanded = model.open.has(row.id);
  const selected = model.selected.has(row.id);
  const state = stateNames[row.state] || row.state;
  return `<tr class="packet-record${selected ? ' is-selected' : ''}${row.unread ? ' is-unread' : ''}">
    <td class="packet-select" data-label="Select"><input type="checkbox" data-act="select" data-id="${id}" aria-label="Select ${title}"${selected ? ' checked' : ''}></td>
    <td class="packet-kind" data-label="Type">${escapeHtml(row.kind)}</td>
    <th scope="row" class="packet-work" data-label="Work"><span class="packet-title">${title}</span><span class="packet-reference">${escapeHtml(row.task)} <span class="packet-read-state">${row.unread ? 'Unread' : 'Read'}</span></span></th>
    <td class="packet-agent" data-label="Agent"><code>${escapeHtml(row.agent)}</code></td>
    <td class="packet-state" data-label="State"><span class="packet-status" data-state="${escapeHtml(row.state)}">${escapeHtml(state)}</span></td>
    <td class="packet-time" data-label="Time"><span>${escapeHtml(row.time)}</span></td>
    <td class="packet-action" data-label="Inspect"><button type="button" data-act="expand" data-id="${id}" aria-expanded="${expanded}" aria-controls="result-${id}" aria-label="${expanded ? 'Close' : 'Inspect'} ${title}">${icon('arrowRight')}<span>${expanded ? 'Close' : 'Inspect'}</span></button></td>
  </tr>${expanded ? `<tr class="packet-inspection"><td colspan="7"><section id="result-${id}" aria-label="Inspection for ${title}"><h2>Inspecting: ${title}</h2>${detail(row)}</section></td></tr>` : ''}`;
}

export function render(model) {
  const title = escapeHtml(viewTitle(model.view));
  return `<div class="packet-workspace">
    <header class="packet-top"><a class="packet-brand" href="?variant=packet">tuios inbox</a><nav aria-label="Workspace views">${navLinks(model)}</nav></header>
    <main class="packet-main">
      <div class="packet-heading"><div><h1>${title}</h1><p>Inspect work, trace responses, keep the queue moving.</p></div><button class="packet-add" type="button" data-act="add-sample">${icon('plus')} Add sample work</button></div>
      <div class="packet-shelf">${toolbar(model)}</div>
      <table class="packet-table"><caption>${title} · ${model.rows.length} ${model.rows.length === 1 ? 'record' : 'records'} shown</caption><colgroup><col class="packet-col-select"><col class="packet-col-type"><col class="packet-col-work"><col class="packet-col-agent"><col class="packet-col-state"><col class="packet-col-time"><col class="packet-col-action"></colgroup>
      <thead><tr><th scope="col"><span class="packet-sr-only">Select</span></th><th scope="col">Type</th><th scope="col">Work</th><th scope="col">Agent</th><th scope="col">State</th><th scope="col">Time</th><th scope="col">Inspect</th></tr></thead>
      <tbody>${model.rows.length ? model.rows.map(row => record(row, model)).join('') : `<tr class="packet-empty"><td colspan="7"><h2>No matching records</h2><p>Clear the search or turn off unread-only to see more sample work.</p></td></tr>`}</tbody></table>
    </main>
  </div>`;
}
