import { fixtures } from './fixtures.js';
import { escapeHtml, icon } from './shared.js';

// Five isolated, read-only visual directions share one in-memory sample workspace.
const variants = ['flight', 'packet', 'bitmap', 'grid', 'dashboard'];
const workspace = document.querySelector('#workspace');
const selector = document.querySelector('#variant-select');
const style = document.querySelector('#variant-style');
const data = structuredClone(fixtures);
const state = { view: 'inbox', query: '', onlyUnread: false, selected: new Set(), open: new Set() };
let renderer;
let changeVersion = 0;
let sampleNumber = 0;
document.querySelector('#variant-prev').innerHTML = icon('arrowLeft');
document.querySelector('#variant-next').innerHTML = icon('arrowRight');

function model() {
  const query = state.query.trim().toLocaleLowerCase();
  return { ...state, rows: data[state.view].filter(row => (!state.onlyUnread || row.unread) && (!query || [row.title,row.task,row.agent,row.kind,row.state].some(value => value.toLocaleLowerCase().includes(query)))), counts: Object.fromEntries(Object.entries(data).map(([key,rows]) => [key,rows.length])) };
}
function render() {
  if (!renderer) return;
  const focused = workspace.contains(document.activeElement) ? document.activeElement : null;
  const focus = focused ? { id: focused.id, action: focused.dataset.act, row: focused.dataset.id, view: focused.dataset.view, start: focused.selectionStart, end: focused.selectionEnd } : null;
  workspace.innerHTML = renderer(model());
  document.querySelector('#selection-status').textContent = `${state.selected.size} selected`;
  const selectAll = workspace.querySelector('[data-act="select-all"]');
  if (selectAll) {
    const visible = model().rows;
    selectAll.indeterminate = visible.some(row => state.selected.has(row.id)) && !visible.every(row => state.selected.has(row.id));
  }
  if (focus) {
    const target = focus.id ? document.getElementById(focus.id) : [...workspace.querySelectorAll('[data-act]')].find(el => el.dataset.act === focus.action && el.dataset.id === focus.row && el.dataset.view === focus.view);
    if (target) {
      target.focus({preventScroll:true});
      if (typeof focus.start === 'number' && typeof target.setSelectionRange === 'function') {
        try { target.setSelectionRange(focus.start, focus.end); } catch { /* Non-text controls have no caret. */ }
      }
    }
  }
}
async function setVariant(key, updateUrl = true) {
  key = variants.includes(key) ? key : 'flight';
  const version = ++changeVersion;
  selector.value = key;
  if (updateUrl) {
    const url = new URL(location.href);
    url.searchParams.set('variant',key);
    history.replaceState(null,'',url);
  }
  try {
    const module = await import(`./${key}.js`);
    if (version !== changeVersion) return;
    await new Promise((resolve,reject) => {
      style.onload = resolve;
      style.onerror = () => reject(new Error(`Could not load ${key}.css`));
      style.href = `./${key}.css`;
    });
    if (version !== changeVersion) return;
    document.body.dataset.variant = key;
    renderer = module.render;
    render();
  } catch (error) {
    if (version !== changeVersion) return;
    workspace.innerHTML = `<section role="alert"><h1>Prototype could not load</h1><p>${escapeHtml(error.message)}</p><p>Choose another visual prototype, or reload after its module is available.</p></section>`;
  }
}
function cycle(delta) {
  const index = variants.indexOf(selector.value);
  setVariant(variants[(index + delta + variants.length) % variants.length]);
}
document.querySelector('#variant-prev').addEventListener('click',() => cycle(-1));
document.querySelector('#variant-next').addEventListener('click',() => cycle(1));
selector.addEventListener('change',() => setVariant(selector.value));
window.addEventListener('popstate',() => setVariant(new URL(location.href).searchParams.get('variant'),false));
document.addEventListener('keydown',event => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    cycle(event.key === 'ArrowLeft' ? -1 : 1);
  }
});
workspace.addEventListener('input',event => {
  if (event.target.id !== 'prototype-search') return;
  state.query = event.target.value;
  render();
});
workspace.addEventListener('change',event => {
  const control = event.target;
  if (control.dataset.act === 'unread') state.onlyUnread = control.checked;
  else if (control.dataset.act === 'select') {
    if (control.checked) state.selected.add(control.dataset.id);
    else state.selected.delete(control.dataset.id);
  } else if (control.dataset.act === 'select-all') {
    for (const row of model().rows) {
      if (control.checked) state.selected.add(row.id);
      else state.selected.delete(row.id);
    }
  } else return;
  render();
});
workspace.addEventListener('click',event => {
  const control = event.target.closest('button[data-act]');
  if (!control) return;
  const {act,id,view} = control.dataset;
  if (act === 'view' && Object.hasOwn(data,view)) state.view = view;
  else if (act === 'expand') {
    if (state.open.has(id)) state.open.delete(id);
    else state.open.add(id);
  } else if (act === 'add-sample') {
    sampleNumber += 1;
    data[state.view].unshift({id:`added-${sampleNumber}`,title:`Sample work ${sampleNumber}: review the handoff`,kind:'Sample work',state:'needs_input',agent:'Sample scout',task:'Synthetic handoff review',time:'Just now',unread:true,response:'This in-memory sample asks you to review a fictional handoff. Nothing was sent to a server, agent, or real workspace.',source:'Added locally in the prototype; cleared on reload'});
    state.query = '';
  } else return;
  render();
});
setVariant(new URL(location.href).searchParams.get('variant'));
