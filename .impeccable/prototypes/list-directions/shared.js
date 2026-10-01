export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
const paths = {
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  chevron: '<path d="m8 5 7 7-7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrowLeft: '<path d="m12 5-7 7 7 7M5 12h15"/>',
  arrowRight: '<path d="m12 5 7 7-7 7M4 12h15"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
};
export function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? ''}</svg>`;
}
const titles = {inbox:'Inbox',turns:'Turns',tasks:'Tasks',agents:'Agents',archive:'Archive',profiles:'Agent profiles'};
export function viewTitle(view) { return titles[view] ?? 'Inbox'; }
export function navLinks(model) {
  return Object.entries(titles).map(([view,title]) => `<button type="button" class="nav-link" data-act="view" data-view="${view}" ${model.view === view ? 'aria-current="page"' : ''}>${title}<span>${model.counts[view]}</span></button>`).join('');
}
export function toolbar(model) {
  const allSelected = model.rows.length > 0 && model.rows.every(row => model.selected.has(row.id));
  return `<div class="toolbar"><label class="search-control" for="prototype-search">${icon('search')}<input id="prototype-search" type="search" placeholder="Search work, agent, or state" aria-label="Search sample work" value="${escapeHtml(model.query)}"></label><label><input type="checkbox" data-act="unread" ${model.onlyUnread ? 'checked' : ''}> Unread only</label><label><input type="checkbox" data-act="select-all" ${allSelected ? 'checked' : ''}> Select all</label><span class="result-count">${model.rows.length} ${model.rows.length === 1 ? 'result' : 'results'}</span></div>`;
}
export function detail(row) {
  return `<section class="result" aria-label="Sample result"><h3>Sample response</h3><p>${escapeHtml(row.response)}</p><dl><div><dt>Source</dt><dd>${escapeHtml(row.source)}</dd></div><div><dt>Agent</dt><dd>${escapeHtml(row.agent)}</dd></div><div><dt>Task</dt><dd>${escapeHtml(row.task)}</dd></div></dl><p class="sample-provenance">Synthetic fixture. This response did not run against a real workspace.</p></section>`;
}
