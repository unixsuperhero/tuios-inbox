// Generic list engine: search, filters, sort, multi-select with bulk actions, accordion or linked rows.
// Rows are patched in place, so a background refresh never collapses, scrolls, or retypes anything.
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const OPS = { is: 'is', is_not: 'is not', has: 'has', has_not: 'has no', between: 'between' };
const when = value => new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const absent = value => value == null || value === '' || value === false || value === 0;
const read = (field, row) => field.get ? field.get(row) : row[field.key];
const listed = field => field?.type === 'enum' || field?.type === 'bool';
const choices = (field, rows) => field.type === 'bool' ? [{ value: 'true', label: 'yes' }, { value: 'false', label: 'no' }]
  : field.options ? field.options(rows)
  : [...new Set(rows.map(row => read(field, row)).filter(value => !absent(value)).map(String))].sort().map(value => ({ value, label: value }));
const labels = (field, rows) => new Map(field.type === 'enum' ? choices(field, rows).map(o => [o.value, o.label]) : []);
const itemTypes = value => Array.isArray(value) ? ['turn', 'command'].filter(type => value.includes(type)) : [];
const creationOptions = source => source?.createOptions ?? (source?.createOption ? [{ label: source.createLabel ?? 'New…', create: source.createOption }] : []);

/** Pure. No DOM. Returns a new array. */
export function applyQuery(rows, fields, query) {
  const byKey = new Map(fields.map(f => [f.key, f])), tests = [];
  const types = itemTypes(query.types), typeField = byKey.get('type');
  if (types.length) tests.push(row => types.includes(typeField ? read(typeField, row) : row.type));
  for (const { key, op, value, from, to } of query.filters || []) {
    const f = byKey.get(key), not = op === 'is_not' || op === 'has_not', want = String(value ?? '');
    if (!f?.filter) continue;
    if (op === 'has' || op === 'has_not') tests.push(row => absent(read(f, row)) === not);
    else if ((op === 'is' || op === 'is_not') && f.type !== 'date') tests.push(row => {
      const v = read(f, row);
      return (f.type === 'text' ? String(v ?? '').toLowerCase().includes(want.toLowerCase()) : String(f.type === 'bool' ? Boolean(v) : v ?? '') === want) !== not;
    });
    else if (op === 'between' && f.type === 'date') {
      // Bounds are datetime-local values (local time, to the minute), inclusive; a missing one leaves that side open.
      // "To 07:11" covers that whole minute, since a row stamped 07:11:32 is displayed as 07:11.
      const lo = from ? new Date(from).getTime() : NaN, hi = to ? new Date(to).getTime() + 59999 : NaN;
      if (Number.isNaN(lo) && Number.isNaN(hi)) continue;
      tests.push(row => { const v = read(f, row), t = absent(v) ? NaN : new Date(v).getTime(); return !Number.isNaN(t) && !(t < lo) && !(t > hi); });
    }
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
  const normalize = value => ({
    ...value,
    types: config.typeFilters ? itemTypes(value.types) : [],
    filters: (Array.isArray(value.filters) ? value.filters : []).filter(f => f?.key !== config.scopeField),
  });
  let query = normalize({ search: '', filters: [], sort: null, ...(saved || config.defaultQuery) });
  let rows = [], shown = [], loaded = false, last = null, destroyed = false;
  const picked = new Set(), els = new Map();
  const created = new Map(), failedActions = new Map();
  const catalog = source => {
    const options = source.options ? source.options(rows) : choices(source, rows);
    return [...options, ...[...(created.get(source)?.values() ?? [])].filter(o => !options.some(existing => existing.value === o.value))];
  };
  const remember = (source, choice) => {
    if (!created.has(source)) created.set(source, new Map());
    created.get(source).set(choice.value, choice);
  };
  const creatorButtons = (source, action) => creationOptions(source).map((o, i) => `<button type="button" class="${action ? 'list-create-action' : 'list-create-option'}"${action ? ` data-create-action="${esc(action)}"` : ''} data-create-index="${i}">${esc(o.label)}</button>`).join('');

  root.innerHTML = `<div class="list"><div class="list-toolbar">
    <label class="list-select-label"><input type="checkbox" class="list-select-all" aria-label="Select all shown" title="Select all shown">Select all shown</label>
    <input class="list-search" type="search" placeholder="Search" aria-label="Search">
    ${config.typeFilters ? '<span class="list-types" role="group" aria-label="Item types"><button type="button" data-type="all">All</button><button type="button" data-type="turn">Turns</button><button type="button" data-type="command">Commands</button></span>' : ''}
    <span class="list-filter">
      <select class="list-field" aria-label="Filter by field"><option value="">Add filter…</option>${fields.filter(f => f.filter).map(f => option({ value: f.key, label: f.label })).join('')}</select>
      <select class="list-op" aria-label="Filter operator" hidden></select>
      <select class="list-value" aria-label="Filter value" hidden></select>
      <input class="list-value" aria-label="Filter value" placeholder="value" hidden>
      <label class="list-range" hidden>From <input type="datetime-local" class="list-from"></label>
      <label class="list-range" hidden>To <input type="datetime-local" class="list-to"></label>
      <span class="list-create-options" hidden></span>
      <button type="button" class="list-add" hidden>Add</button>
    </span>
    <span class="list-chips" hidden></span>
    <span class="list-tail">
      <label class="list-sorter">Sort <select class="list-sort"></select></label>
      <button type="button" class="list-dir"></button>
      <span class="list-count"></span>
    </span>
  </div><div class="list-bulk" hidden><span class="list-selected"></span>${actions.map(a => a.options
    ? `<select data-action="${esc(a.id)}" aria-label="${esc(a.label)}"></select>${creatorButtons(a, a.id)}<button type="button" data-retry-action="${esc(a.id)}" hidden>Apply ${esc(a.label.replace(/(…|\.\.\.)$/, ''))}</button>`
    : `<button type="button" data-action="${esc(a.id)}"${a.danger ? ' class="danger"' : ''}>${esc(a.label)}</button>`).join('')}</div>${config.columns ? `<div class="list-columns" aria-hidden="true">${config.columns.map(label => `<span>${esc(label)}</span>`).join('')}</div>` : ''}<div class="list-rows"></div><div class="list-empty" hidden>${config.empty ?? 'Nothing matches.'}</div></div>`;
  const $ = selector => root.querySelector(selector), wrap = root.firstElementChild;
  const all = $('.list-select-all'), search = $('.list-search'), fieldSel = $('.list-field'), opSel = $('.list-op'), valSel = $('select.list-value'), valText = $('input.list-value'), fromIn = $('.list-from'), toIn = $('.list-to'), add = $('.list-add'),
    chips = $('.list-chips'), sortSel = $('.list-sort'), dirBtn = $('.list-dir'), count = $('.list-count'), bulk = $('.list-bulk'), box = $('.list-rows'), empty = $('.list-empty'), createBox = $('.list-create-options');

  // Replace a part's HTML only when it changed, and never under the user's focus.
  const fill = (part, html) => { if (part.listHtml !== html && !part.contains(document.activeElement)) part.innerHTML = part.listHtml = html; };

  function tools() {
    if (search.value !== query.search) search.value = query.search;
    for (const button of wrap.querySelectorAll('[data-type]')) button.setAttribute('aria-pressed', String(button.dataset.type === 'all' ? !query.types.length : query.types.includes(button.dataset.type)));
    chips.hidden = !query.filters.length;
    const html = query.filters.map((x, i) => {
      const f = field(x.key), label = f?.label ?? x.key, value = (listed(f) && catalog(f).find(o => o.value === x.value)?.label) || x.value;
      const text = x.op === 'has' || x.op === 'has_not' ? `${OPS[x.op]} ${label}`
        : x.op === 'between' ? `${label} ${x.from && x.to ? `from ${when(x.from)} to ${when(x.to)}` : x.from ? `after ${when(x.from)}` : `before ${when(x.to)}`}`
        : `${label} ${OPS[x.op] ?? x.op} ${value}`;
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
    if (ids.length) for (const a of actions) if (a.options) {
      const pending = failedActions.get(a.id);
      const select = bulk.querySelector(`select[data-action="${CSS.escape(a.id)}"]`), value = pending ? pending.value : select.value, selectedIndex = select.selectedIndex;
      fill(select, option({ value: '', label: a.label.replace(/(…|\.\.\.)$/, '') + '…' }) + catalog(a).map(option).join(''));
      select.value = value;
      if (!value && (pending || selectedIndex > 0)) select.selectedIndex = [...select.options].findIndex((o, i) => i > 0 && !o.value);
      bulk.querySelector(`[data-retry-action="${CSS.escape(a.id)}"]`).hidden = !pending;
      for (const button of bulk.querySelectorAll(`[data-create-action="${CSS.escape(a.id)}"]`)) {
        const index = +button.dataset.createIndex, retrying = pending?.choice && pending.createIndex === index;
        button.textContent = retrying ? 'Retry assignment' : creationOptions(a)[index].label;
        if (retrying) button.setAttribute('aria-label', `Retry ${a.label}: ${pending.choice.label}`);
        else button.removeAttribute('aria-label');
      }
    }
  }

  function paint(el, row) {
    const name = `item${config.rowHref ? ' item-index' : ''} ${config.rowClass?.(row) ?? ''}`.trim();
    if (el.className !== name) el.className = name;
    el.listRow = row;
    fill(el.firstChild.lastChild, config.summary(row));
    if (config.rowHref) el.firstChild.lastChild.href = config.rowHref(row);
    if (el.open && config.detail) fill(el.lastChild, config.detail(row));
  }

  // `pin`: on a data refresh an open row stays even if it stopped matching (e.g. it was just marked read).
  function render(pin) {
    tools();
    builder();
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
        el = document.createElement(config.rowHref ? 'div' : 'details'); el.dataset.id = id;
        el.innerHTML = config.rowHref
          ? '<div class="item-row"><input type="checkbox" class="item-select" aria-label="Select row"><a class="item-link item-summary"></a></div>'
          : '<summary><input type="checkbox" class="item-select" aria-label="Select row"><div class="item-summary"></div></summary><div class="item-body"></div>';
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
    if (config.rowHref) return;
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
      opSel.innerHTML = (f.type === 'date' ? ['between', 'has', 'has_not'] : ['is', 'is_not', 'has', 'has_not']).map(op => option({ value: op, label: OPS[op] })).join('');
      valSel.innerHTML = valSel.listHtml = listed(f) ? catalog(f).map(option).join('') : '';
      valText.value = fromIn.value = toIn.value = ''; valText.type = f.type === 'number' ? 'number' : 'text';
    }
    if (!fresh && listed(f)) {
      const value = valSel.value;
      fill(valSel, catalog(f).map(option).join(''));
      if (value) valSel.value = value;
    }
    const valued = f && (opSel.value === 'is' || opSel.value === 'is_not');
    opSel.hidden = add.hidden = !f; valSel.hidden = !valued || !listed(f); valText.hidden = !valued || listed(f);
    fromIn.parentElement.hidden = toIn.parentElement.hidden = !f || opSel.value !== 'between';
    createBox.hidden = !valued || !listed(f) || !creationOptions(f).length;
    fill(createBox, f ? creatorButtons(f) : '');
  }

  function addFilter() {
    const f = field(fieldSel.value), op = opSel.value, valued = op === 'is' || op === 'is_not';
    if (!f) return;
    const value = valued ? (valSel.hidden ? valText.value.trim() : valSel.value) : undefined;
    if (value === '') return (valSel.hidden ? valText : valSel).focus();
    const next = valued ? { key: f.key, op, value } : { key: f.key, op };
    if (op === 'between') {
      // A half-typed date reads as '' and would silently become an open end, so the browser points at it instead.
      const partial = [fromIn, toIn].find(el => el.validity.badInput);
      if (partial) return partial.reportValidity();
      if (!fromIn.value && !toIn.value) return fromIn.focus();
      if (fromIn.value) next.from = fromIn.value;
      if (toIn.value) next.to = toIn.value;
    }
    fieldSel.value = ''; builder(); fieldSel.focus();
    if (!query.filters.some(x => x.key === f.key && x.op === op && x.value === value && x.from === next.from && x.to === next.to)) api.setQuery({ filters: [...query.filters, next] });
  }

  const active = () => !destroyed && root.isConnected;
  const report = error => { if (active()) root.dispatchEvent(new CustomEvent('list-error', { detail: error, bubbles: true })); };

  async function createFilterOption(button) {
    const f = field(fieldSel.value), create = creationOptions(f)[+button.dataset.createIndex].create;
    button.disabled = true;
    try {
      const choice = await create({ owner: () => active() && field(fieldSel.value) === f });
      if (!choice || !active() || field(fieldSel.value) !== f) return;
      remember(f, choice);
      valSel.innerHTML = valSel.listHtml = catalog(f).map(option).join('');
      valSel.value = choice.value;
      valSel.focus();
    } catch (error) { report(error); }
    finally { button.disabled = false; if (active() && document.activeElement !== valSel) button.focus(); }
  }

  async function run(control) {
    const actionId = control.dataset.action ?? control.dataset.createAction ?? control.dataset.retryAction;
    const action = actions.find(a => a.id === actionId), chosen = Boolean(action.options);
    const pending = failedActions.get(actionId), createIndex = control.dataset.createAction != null ? +control.dataset.createIndex : undefined;
    const retry = control.dataset.retryAction ? pending : pending?.choice && pending.createIndex === createIndex ? pending : null;
    const ids = retry ? retry.ids : api.selected(), creating = createIndex !== undefined && !retry;
    const select = chosen && bulk.querySelector(`select[data-action="${CSS.escape(actionId)}"]`);
    let value = retry ? retry.value : select?.value, choice = retry?.choice, assigning = false, succeeded = false;
    if (!ids.length || (chosen && !creating && !retry && select.selectedIndex <= 0)) return;
    const controls = [...bulk.querySelectorAll('button,select')].filter(el => [el.dataset.action, el.dataset.createAction, el.dataset.retryAction].includes(actionId));
    for (const el of controls) el.disabled = true;
    try {
      if (creating) {
        choice = await creationOptions(action)[createIndex].create({ owner: active });
        if (!choice || !active()) return;
        remember(action, choice);
        select.innerHTML = select.listHtml = option({ value: '', label: action.label.replace(/(…|\.\.\.)$/, '') + '…' }) + catalog(action).map(option).join('');
        select.value = value = choice.value;
      }
      assigning = true;
      await (chosen ? action.run(ids, value) : action.run(ids));
      if (!active()) return;
      for (const id of ids) picked.delete(id);
      failedActions.delete(actionId); last = null; succeeded = true;
      if (select) select.value = '';
    } catch (error) {
      if (assigning && chosen) failedActions.set(actionId, { ids, value, choice, createIndex: retry?.createIndex ?? createIndex });
      report(error);
    } finally {
      for (const el of controls) el.disabled = false;
      if (active()) {
        sync();
        if (creating || retry) (succeeded && bulk.hidden ? all : control).focus();
      }
    }
  }

  wrap.addEventListener('click', e => {
    const t = e.target, summary = t.closest('summary');
    const indexRow = t.closest('.item-row');
    if (indexRow?.parentElement.parentElement === box && t === indexRow.firstChild) return pick(indexRow.parentElement.dataset.id, t.checked, e.shiftKey);
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
    else if (button.dataset.type) api.setQuery({ types: button.dataset.type === 'all' ? [] : query.types.includes(button.dataset.type) ? query.types.filter(type => type !== button.dataset.type) : [...query.types, button.dataset.type] });
    else if (button.classList.contains('list-create-option')) createFilterOption(button);
    else if ((button.dataset.createAction || button.dataset.retryAction) && bulk.contains(button)) run(button);
    else if (button === dirBtn) api.setQuery({ sort: { key: query.sort.key, dir: query.sort.dir === 'desc' ? 'asc' : 'desc' } });
    else if (button.dataset.action && bulk.contains(button)) run(button);
  });
  // Shift-click is range select here, not text selection.
  wrap.addEventListener('mousedown', e => { if (e.shiftKey && e.target.closest('summary,.item-row')?.parentElement.parentElement === box) e.preventDefault(); });
  wrap.addEventListener('change', e => {
    const t = e.target;
    if (t === all) { for (const row of shown) all.checked ? picked.add(rowId(row)) : picked.delete(rowId(row)); last = null; sync(); }
    else if (t === fieldSel) builder(true);
    else if (t === opSel) builder();
    else if (t === sortSel) api.setQuery({ sort: t.value ? { key: t.value, dir: field(t.value).type === 'date' ? 'desc' : 'asc' } : null });
    else if (t.dataset.action && t.parentElement === bulk) { failedActions.delete(t.dataset.action); run(t); }
  });
  wrap.addEventListener('input', e => { if (e.target === search) api.setQuery({ search: search.value }); });
  wrap.addEventListener('keydown', e => { if (e.key === 'Enter' && [valText, fromIn, toIn].includes(e.target)) addFilter(); });

  const api = {
    setRows(next) {
      rows = next; loaded = true;
      const ids = new Set(rows.map(rowId)); for (const id of picked) if (!ids.has(id)) picked.delete(id);
      render(true);
    },
    setQuery(partial) {
      query = normalize({ ...query, ...partial });
      try { localStorage.setItem(store, JSON.stringify(query)); } catch {}
      render(false);
    },
    getQuery: () => structuredClone(query),
    selected: () => shown.map(rowId).filter(id => picked.has(id)),
    clearSelection() { picked.clear(); failedActions.clear(); last = null; sync(); },
    open(id) { const el = els.get(id); if (el && !el.open) setOpen(el, true); },
    destroy() { destroyed = true; root.replaceChildren(); els.clear(); picked.clear(); created.clear(); failedActions.clear(); rows = shown = []; },
  };
  tools();
  return api;
}
