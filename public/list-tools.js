const queries = new Map();
const lists = [
  ['#task-rail', ':scope > .wb-task, :scope > .qb-bucket', 'Task groups'],
  ['.wb-agents', ':scope > .wb-agent-row', 'Agents'],
  ['.wb-history, .wb-queue-items, .qb-rows', ':scope > .wb-record', 'Records'],
  ['.subtask-list, .ol-card-subtasks', ':scope > li', 'Subtasks'],
  ['.ol-card-prompts', ':scope > li', 'Saved prompts'],
  ['.ol-card-agents', ':scope > li', 'Task agents'],
  ['.metadata-members', ':scope > .pane', 'Agents and panes'],
  ['.ol-list', ':scope > li', 'Items'],
  ['.ol-hists', ':scope > details', 'History'],
  ['#native-tree', ':scope > details', 'Sessions and workspaces'],
  ['.native-home > ul', ':scope > li', 'Task homes'],
  ['[data-wb-key="section:notes"]', ':scope > .task-note:not([data-wb-key="note:new"])', 'Notes'],
  ['.conversation-messages', ':scope > .message', 'Messages'],
  ['#history-page .history-table:has([data-wb-key^="src:"])', 'tbody > tr', 'Collectors'],
];
function searchable(row) {
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
  const parts = [];
  while (walker.nextNode()) if (!walker.currentNode.parentElement.closest('.inline-list-filter')) parts.push(walker.currentNode.textContent);
  for (const el of row.querySelectorAll('input:not([type=checkbox]),textarea')) if (!el.closest('.inline-list-filter')) parts.push(el.value);
  return parts.join(' ').toLocaleLowerCase();
}
function apply(list, selector, value) {
  const needle = value.trim().toLocaleLowerCase(), rows = list.nodeType === 11
    ? selector.split(',').flatMap(s => s.trim().startsWith(':scope > ') ? [...list.children].filter(el => el.matches(s.trim().slice(9))) : [...list.querySelectorAll(s)])
    : [...list.querySelectorAll(selector)];
  let count = 0;
  for (const row of rows) {
    row.hidden = Boolean(needle && !searchable(row).includes(needle)); row.toggleAttribute('data-list-filtered', row.hidden); if (!row.hidden) count++;
    if (row.matches('[data-native-tree]')) {
      const sessionMatch = searchable(row.querySelector('summary')).includes(needle);
      for (const workspace of row.querySelectorAll('[data-wb-key^="tree-workspace:"]')) {
        const workspaceMatch = sessionMatch || searchable(workspace.querySelector('.native-tree-workspace')).includes(needle);
        workspace.hidden = Boolean(needle && !sessionMatch && !searchable(workspace).includes(needle));
        for (const pane of workspace.querySelectorAll('.native-tree-pane')) pane.hidden = Boolean(needle && !workspaceMatch && !searchable(pane).includes(needle));
      }
      if (needle && !row.hidden) row.open = true;
    }
  }
  return `${count} / ${rows.length}`;
}
// Prepare controls before the normal keyed morph, so refreshes preserve the input and caret.
export function prepareListFilters(fragment, parent) {
  for (const [selector, rowSelector, name] of lists) {
    const targets = [...fragment.querySelectorAll(selector)];
    if (parent.matches(selector)) targets.unshift(fragment);
    targets.forEach((list, index) => {
      if (list.nodeType === 1 && list.closest('.md')) return;
      const element = list === fragment ? parent : list;
      const owner = element.closest('[data-wb-key]')?.dataset.wbKey || '';
      const key = `${location.hash}|${parent.id}|${owner || index}|${selector}`;
      const value = queries.get(key) || '';
      const count = apply(list, rowSelector, value);
      element.dataset.filterList = key; element.dataset.filterRows = rowSelector;
      const control = document.createElement('label'); control.className = 'inline-list-filter'; control.dataset.wbKey = 'filter:' + key;
      const caption = document.createElement('span'); caption.textContent = `Filter ${name.toLowerCase()}`;
      const input = document.createElement('input'); input.type = 'search'; input.value = value; input.dataset.listQuery = key; input.setAttribute('aria-label', caption.textContent); input.placeholder = 'Type to filter…';
      const status = document.createElement('span'); status.dataset.filterCount = key; status.setAttribute('role', 'status'); status.textContent = count;
      control.append(caption, input, status);
      if (list === fragment) fragment.prepend(control); else list.before(control);
    });
  }
}
document.addEventListener('input', e => {
  const key = e.target.dataset?.listQuery; if (!key) return;
  queries.set(key, e.target.value);
  const list = [...document.querySelectorAll('[data-filter-list]')].find(el => el.dataset.filterList === key);
  if (!list) return;
  list.dispatchEvent(new CustomEvent('list-query', { bubbles: true }));
  const count = apply(list, list.dataset.filterRows, e.target.value);
  const status = e.target.parentElement.querySelector('[data-filter-count]'); if (status) status.textContent = count;
});
const sections = '.rail-tasks, #ol-capture, .ol-search, #ol-tree, .ol-task-card, .ol-prompt-reader > [data-wb-key=body], .ol-sec, .ol-next-step, .ol-prompt-compose, .ol-reply, .ol-settings, .ol-facts, #task-rail, #review-queue, .task-section, .wb-history, .qb-queue, .qb-reading, #native-tree, .native-overview-session, #native-content, #history-form, .history-table, #list > .list';
const visible = el => el.getClientRects().length && !el.closest('[hidden]') && getComputedStyle(el).visibility !== 'hidden';
document.addEventListener('keydown', e => {
  if (!['{', '}'].includes(e.key) || e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable]:not([contenteditable=false])')) return;
  const targets = [...document.querySelectorAll(sections)].filter(visible);
  // A card is one section; its controls do not become extra stops.
  const stops = targets.filter(el => !el.parentElement.closest('.ol-task-card'));
  const current = [...stops].reverse().find(el => el === e.target || el.contains(e.target));
  let index = stops.indexOf(current);
  if (index < 0) index = e.key === '}' ? -1 : stops.length;
  const next = stops[index + (e.key === '}' ? 1 : -1)];
  if (!next) return;
  e.preventDefault(); next.tabIndex = -1; next.focus({ preventScroll: true }); next.scrollIntoView({ block: 'nearest' });
});
