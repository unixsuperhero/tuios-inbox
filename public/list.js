// Generic list engine: search, filters, sort, multi-select with bulk actions, accordion rows.
// Rows are patched in place, so a background refresh never collapses, scrolls, or retypes anything.
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const OPS = { is: 'is', is_not: 'is not', has: 'has', has_not: 'has no' };
const absent = value => value == null || value === '' || value === false || value === 0;
const read = (field, row) => field.get ? field.get(row) : row[field.key];
const listed = field => field?.type === 'enum' || field?.type === 'bool';
const choices = (field, rows) => field.type === 'bool' ? [{ value: 'true', label: 'yes' }, { value: 'false', label: 'no' }]
  : field.options ? field.options(rows)
  : [...new Set(rows.map(row => read(field, row)).filter(value => !absent(value)).map(String))].sort().map(value => ({ value, label: value }));
const labels = (field, rows) => new Map(field.type === 'enum' ? choices(field, rows).map(o => [o.value, o.label]) : []);

/** Pure. No DOM. Returns a new array. */
export function applyQuery(rows, fields, query) {
  const byKey = new Map(fields.map(f => [f.key, f])), tests = [];
  for (const { key, op, value } of query.filters || []) {
    const f = byKey.get(key), not = op === 'is_not' || op === 'has_not', want = String(value ?? '');
    if (!f?.filter) continue;
    if (op === 'has' || op === 'has_not') tests.push(row => absent(read(f, row)) === not);
    else if ((op === 'is' || op === 'is_not') && f.type !== 'date') tests.push(row => {
      const v = read(f, row);
      return (f.type === 'text' ? String(v ?? '').toLowerCase().includes(want.toLowerCase()) : String(f.type === 'bool' ? Boolean(v) : v ?? '') === want) !== not;
    });
  }
  const needle = String(query.search || '').trim().toLowerCase();
  if (needle) {
    const searched = fields.filter(f => f.search).map(f => [f, labels(f, rows)]);
    tests.push(row => searched.some(([f, names]) => { const v = String(read(f, row) ?? ''); return `${v}\n${names.get(v) ?? ''}`.toLowerCase().includes(needle); }));
  }
  const out = rows.filter(row => tests.every(test => test(row))), f = query.sort && byKey.get(query.sort.key);
  if (!f) return out;
  const names = labels(f, rows), dir = query.sort.dir === 'desc' ? -1 : 1, text = f.type === 'text' || f.type === 'enum', collator = new Intl.Collator(undefined, { sensitivity: 'accent' });
  // null = nothing to sort by; those rows go last in both directions.
  const rank = row => {
    const v = read(f, row); if (v == null || v === '') return null;
    if (text) return names.get(String(v)) ?? String(v);
    const n = f.type === 'date' ? new Date(v).getTime() : Number(v); return Number.isNaN(n) ? null : n;
  };
  return out.map(row => [rank(row), row]).sort(([a], [b]) => a === null || b === null ? (a === null) - (b === null) : dir * (text ? collator.compare(a, b) : a - b)).map(pair => pair[1]);
}

/** Mounts the list into `root` (replaces its content). */
export function createList(root, config) {
  const { fields, rowId, actions = [] } = config, store = `list:${config.storageKey}`;
  const field = key => fields.find(f => f.key === key);
  const option = o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`;
  let saved; try { saved = JSON.parse(localStorage.getItem(store)); } catch {}
  let query = { search: '', filters: [], sort: null, ...(saved || config.defaultQuery) };
  if (!Array.isArray(query.filters)) query.filters = [];
  let rows = [], shown = [], loaded = false, last = null;
  const picked = new Set(), els = new Map();

  root.innerHTML = `<div class="list"><div class="list-toolbar">
    <input type="checkbox" class="list-select-all" aria-label="Select all shown" title="Select all shown">
    <input class="list-search" type="search" placeholder="Search" aria-label="Search">
    <span class="list-filter">
      <select class="list-field" aria-label="Filter by field"><option value="">Add filter…</option>${fields.filter(f => f.filter).map(f => option({ value: f.key, label: f.label })).join('')}</select>
      <select class="list-op" aria-label="Filter operator" hidden></select>
      <select class="list-value" aria-label="Filter value" hidden></select>
      <input class="list-value" aria-label="Filter value" placeholder="value" hidden>
      <button type="button" class="list-add" hidden>Add</button>
    </span>
    <span class="list-chips" hidden></span>
    <span class="list-tail">
      <label class="list-sorter">Sort <select class="list-sort"></select></label>
      <button type="button" class="list-dir"></button>
      <span class="list-count"></span>
    </span>
  </div><div class="list-bulk" hidden><span class="list-selected"></span>${actions.map(a => a.options
    ? `<select data-action="${esc(a.id)}" aria-label="${esc(a.label)}"></select>`
    : `<button type="button" data-action="${esc(a.id)}"${a.danger ? ' class="danger"' : ''}>${esc(a.label)}</button>`).join('')}</div><div class="list-rows"></div><div class="list-empty" hidden>${config.empty ?? 'Nothing matches.'}</div></div>`;
  const $ = selector => root.querySelector(selector), wrap = root.firstElementChild;
  const all = $('.list-select-all'), search = $('.list-search'), fieldSel = $('.list-field'), opSel = $('.list-op'), valSel = $('select.list-value'), valText = $('input.list-value'), add = $('.list-add'),
    chips = $('.list-chips'), sortSel = $('.list-sort'), dirBtn = $('.list-dir'), count = $('.list-count'), bulk = $('.list-bulk'), box = $('.list-rows'), empty = $('.list-empty');

  // Replace a part's HTML only when it changed, and never under the user's focus.
  const fill = (part, html) => { if (part.listHtml !== html && !part.contains(document.activeElement)) part.innerHTML = part.listHtml = html; };

  function tools() {
    if (search.value !== query.search) search.value = query.search;
    chips.hidden = !query.filters.length;
    const html = query.filters.map((x, i) => {
      const f = field(x.key), label = f?.label ?? x.key, value = (listed(f) && choices(f, rows).find(o => o.value === x.value)?.label) || x.value;
      const text = x.op === 'has' || x.op === 'has_not' ? `${OPS[x.op]} ${label}` : `${label} ${OPS[x.op] ?? x.op} ${value}`;
      return `<button type="button" class="chip" data-chip="${i}" aria-label="Remove filter: ${esc(text)}">${esc(text)} <span aria-hidden="true">×</span></button>`;
    }).join('');
    if (chips.listHtml !== html) {
      // Chips are replaced even under focus (removing one is a click on it); focus stays at the same position.
      const i = [...chips.children].indexOf(document.activeElement);
      chips.innerHTML = chips.listHtml = html;
      if (i >= 0) (chips.children[Math.min(i, chips.children.length - 1)] ?? fieldSel).focus();
    }
    const sorted = field(query.sort?.key), desc = query.sort?.dir === 'desc';
    fill(sortSel, option({ value: '', label: 'Default order' }) + fields.filter(f => f.sort || f === sorted).map(f => option({ value: f.key, label: f.label })).join(''));
    sortSel.value = sorted ? sorted.key : '';
    dirBtn.hidden = !sorted; dirBtn.textContent = desc ? '↓ Desc' : '↑ Asc';
    dirBtn.setAttribute('aria-label', `Sorted ${desc ? 'descending' : 'ascending'}. Reverse the order`);
  }

  function sync() {
    const ids = api.selected();
    for (const [id, el] of els) el.firstChild.firstChild.checked = picked.has(id);
    all.checked = ids.length > 0 && ids.length === shown.length; all.indeterminate = ids.length > 0 && !all.checked;
    bulk.hidden = !ids.length;
    $('.list-selected').textContent = `${ids.length} selected${picked.size > ids.length ? ` (+${picked.size - ids.length} filtered out)` : ''}`;
    if (ids.length) for (const a of actions) if (a.options) fill(bulk.querySelector(`select[data-action="${CSS.escape(a.id)}"]`), option({ value: '', label: a.label.replace(/(…|\.\.\.)$/, '') + '…' }) + a.options().map(option).join(''));
  }

  function paint(el, row) {
    const name = `item ${config.rowClass?.(row) ?? ''}`.trim();
    if (el.className !== name) el.className = name;
    el.listRow = row;
    fill(el.firstChild.lastChild, config.summary(row));
    if (el.open && config.detail) fill(el.lastChild, config.detail(row));
  }

  // `pin`: on a data refresh an open row stays even if it stopped matching (e.g. it was just marked read).
  function render(pin) {
    tools();
    const match = new Set(applyQuery(rows, fields, { ...query, sort: null }).map(rowId));
    shown = applyQuery(rows, fields, { sort: query.sort }).filter(row => match.has(rowId(row)) || (pin && els.get(rowId(row))?.open));
    const keep = new Set(shown.map(rowId));
    // Once the user has scrolled into the list, the first visible row must not move.
    const hold = box.getBoundingClientRect().top < 0 && [...box.children].find(el => keep.has(el.dataset.id) && el.getBoundingClientRect().bottom > 0), y = hold && hold.getBoundingClientRect().top;
    for (const [id, el] of els) if (!keep.has(id)) { el.remove(); els.delete(id); }
    let at = box.firstChild;
    for (const row of shown) {
      const id = rowId(row); let el = els.get(id);
      if (!el) {
        el = document.createElement('details'); el.dataset.id = id;
        el.innerHTML = '<summary><input type="checkbox" class="item-select" aria-label="Select row"><div class="item-summary"></div></summary><div class="item-body"></div>';
        els.set(id, el);
      }
      paint(el, row);
      if (el === at) at = at.nextSibling;
      // Moving the focused row would blur it, so the rows in front of it step aside instead.
      else if (el.contains(document.activeElement)) { while (at !== el) { const next = at.nextSibling; box.append(at); at = next; } at = el.nextSibling; }
      else box.insertBefore(el, at);
    }
    count.textContent = `${shown.length} of ${rows.length}`;
    empty.hidden = !loaded || shown.length > 0;
    sync();
    if (hold) for (let s = box, d; s && Math.abs(d = hold.getBoundingClientRect().top - y) >= 1; s = s.parentElement) s.scrollTop += d;
  }

  function setOpen(el, open) {
    if (open && config.detail) fill(el.lastChild, config.detail(el.listRow));
    el.open = open;
    if (open) config.onOpen?.(el.listRow);
  }

  function pick(id, on, range) {
    const ids = shown.map(rowId), a = range ? ids.indexOf(last) : -1, b = ids.indexOf(id);
    for (const x of a < 0 ? [id] : ids.slice(Math.min(a, b), Math.max(a, b) + 1)) on ? picked.add(x) : picked.delete(x);
    last = id; sync();
  }

  function builder(fresh) {
    const f = field(fieldSel.value);
    if (fresh && f) {
      opSel.innerHTML = (f.type === 'date' ? ['has', 'has_not'] : Object.keys(OPS)).map(op => option({ value: op, label: OPS[op] })).join('');
      valSel.innerHTML = listed(f) ? choices(f, rows).map(option).join('') : '';
      valText.value = ''; valText.type = f.type === 'number' ? 'number' : 'text';
    }
    const valued = f && (opSel.value === 'is' || opSel.value === 'is_not');
    opSel.hidden = add.hidden = !f; valSel.hidden = !valued || !listed(f); valText.hidden = !valued || listed(f);
  }

  function addFilter() {
    const f = field(fieldSel.value), op = opSel.value, valued = op === 'is' || op === 'is_not';
    if (!f) return;
    const value = valued ? (valSel.hidden ? valText.value.trim() : valSel.value) : undefined;
    if (value === '') return valText.focus();
    fieldSel.value = ''; builder(); fieldSel.focus();
    if (!query.filters.some(x => x.key === f.key && x.op === op && x.value === value)) api.setQuery({ filters: [...query.filters, valued ? { key: f.key, op, value } : { key: f.key, op }] });
  }

  async function run(control) {
    const action = actions.find(a => a.id === control.dataset.action), ids = api.selected(), chosen = control.tagName === 'SELECT';
    if (!ids.length || (chosen && !control.selectedIndex)) return;
    const value = control.value;
    control.disabled = true;
    try { await (chosen ? action.run(ids, value) : action.run(ids)); picked.clear(); last = null; }
    catch (error) { root.dispatchEvent(new CustomEvent('list-error', { detail: error, bubbles: true })); }
    control.disabled = false; if (chosen) control.selectedIndex = 0;
    sync();
  }

  wrap.addEventListener('click', e => {
    const t = e.target, summary = t.closest('summary');
    if (summary?.parentElement.parentElement === box) {
      const el = summary.parentElement, check = summary.firstChild;
      if (t === check) return pick(el.dataset.id, check.checked, e.shiftKey);
      if (t.closest('a,button,input,select,textarea,label')) return;
      e.preventDefault();
      // The gutter around the checkbox selects too, so a near miss does not open the row.
      if (e.clientX && e.clientX < summary.lastChild.getBoundingClientRect().left) return pick(el.dataset.id, !check.checked, e.shiftKey);
      return setOpen(el, !el.open);
    }
    const button = t.closest('button'); if (!button || t.closest('.list-rows')) return;
    if (button.dataset.chip) api.setQuery({ filters: query.filters.filter((_, i) => i !== +button.dataset.chip) });
    else if (button === add) addFilter();
    else if (button === dirBtn) api.setQuery({ sort: { key: query.sort.key, dir: query.sort.dir === 'desc' ? 'asc' : 'desc' } });
    else if (button.dataset.action && bulk.contains(button)) run(button);
  });
  // Shift-click is range select here, not text selection.
  wrap.addEventListener('mousedown', e => { if (e.shiftKey && e.target.closest('summary')?.parentElement.parentElement === box) e.preventDefault(); });
  wrap.addEventListener('change', e => {
    const t = e.target;
    if (t === all) { for (const row of shown) all.checked ? picked.add(rowId(row)) : picked.delete(rowId(row)); last = null; sync(); }
    else if (t === fieldSel) builder(true);
    else if (t === opSel) builder();
    else if (t === sortSel) api.setQuery({ sort: t.value ? { key: t.value, dir: field(t.value).type === 'date' ? 'desc' : 'asc' } : null });
    else if (t.dataset.action && t.parentElement === bulk) run(t);
  });
  wrap.addEventListener('input', e => { if (e.target === search) api.setQuery({ search: search.value }); });
  wrap.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === valText) addFilter(); });

  const api = {
    setRows(next) {
      rows = next; loaded = true;
      const ids = new Set(rows.map(rowId)); for (const id of picked) if (!ids.has(id)) picked.delete(id);
      render(true);
    },
    setQuery(partial) {
      query = { ...query, ...partial };
      try { localStorage.setItem(store, JSON.stringify(query)); } catch {}
      render(false);
    },
    getQuery: () => structuredClone(query),
    selected: () => shown.map(rowId).filter(id => picked.has(id)),
    clearSelection() { picked.clear(); last = null; sync(); },
    open(id) { const el = els.get(id); if (el && !el.open) setOpen(el, true); },
    destroy() { root.replaceChildren(); els.clear(); picked.clear(); rows = shown = []; },
  };
  tools();
  return api;
}
