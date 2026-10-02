import { createScenario, deriveModel } from './model.js';
import { escapeHtml, icon } from '../shared.js';
import { sendUnavailable } from './shared.js';

const variants = ['ledger', 'rooms', 'desk'];
const tradeoffs = {
  ledger: 'Ledger · Dense task hierarchy beside a chronological review queue. Task context stays visible while reading.',
  rooms: 'Rooms · Parallel task activity on a board, with a shared review tray. Opening a task trades the overview for focus.',
  desk: 'Desk · A persistent task index above a spacious reading desk. The compact queue keeps the next response nearby.',
};
const validVariant = value => variants.includes(value) ? value : 'ledger';
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const compare = (a, b, field) => compareText(a[field], b[field]) || compareText(a.id, b.id);

export function createUI(variant = 'ledger') {
  return {
    variant: validVariant(variant), taskId: null, agentId: null, threadId: null, openTurnId: null,
    expandedTaskIds: ['auth'], expandedAgentIds: [], queueOrder: 'oldest', drafts: {},
    composerTaskId: '', composerAgentId: '', composerThreadId: '', composerSubject: '',
    composerShown: false, failNextSend: false, mobileView: 'tasks', formErrors: {}, subjects: {},
  };
}

export function createController(options = {}) {
  const scenario = options.data ? null : createScenario();
  let data = options.data || scenario.data;
  let ui = { ...createUI(), ...(options.ui || scenario?.ui) };
  ui.formErrors ||= {};
  ui.subjects ||= {};
  const notify = kind => options.onChange?.(kind, controller);
  const model = () => deriveModel(data, ui);
  const tick = () => (data.clock = new Date(Date.parse(data.clock) + 60000).toISOString());
  const expand = (key, id) => { if (!ui[key].includes(id)) ui[key].push(id); };
  const toggle = (key, id) => { ui[key] = ui[key].includes(id) ? ui[key].filter(value => value !== id) : [...ui[key], id]; };
  function selectTurn(id) {
    const turn = model().turns.find(item => item.id === id);
    if (!turn) return false;
    ui.openTurnId = turn.id;
    ui.threadId = turn.thread.id;
    ui.agentId = turn.agent.id;
    ui.taskId = turn.task.id;
    ui.mobileView = 'review';
    expand('expandedTaskIds', ui.taskId);
    expand('expandedAgentIds', ui.agentId);
    return true;
  }
  function nextReview() {
    ui.openTurnId = null;
    const next = model().queue[0];
    if (next) selectTurn(next.id);
  }
  function selectTask(id) {
    if (!data.tasks.some(task => task.id === id)) return false;
    Object.assign(ui, { taskId: id, agentId: null, threadId: null, openTurnId: null, mobileView: 'tasks' });
    expand('expandedTaskIds', id);
    return true;
  }
  function change(field, value) {
    if (field === 'queueOrder') {
      ui.queueOrder = value === 'newest' ? 'newest' : 'oldest';
      notify('live');
      return;
    }
    if (field === 'failNextSend') { ui.failNextSend = Boolean(value); notify('controls'); return; }
    if (field === 'composerSubject') {
      ui.composerSubject = value;
      ui.subjects[`${ui.composerTaskId}:${ui.composerAgentId}`] = value;
      notify('controls');
      return;
    }
    if (field === 'composerTaskId') {
      ui.composerTaskId = data.tasks.some(t => t.id === value) ? value : '';
      if (!data.agents.some(a => a.id === ui.composerAgentId && a.taskId === ui.composerTaskId)) {
        ui.composerAgentId = '';
        ui.composerThreadId = '';
      }
    } else if (field === 'composerAgentId') {
      ui.composerAgentId = data.agents.some(a => a.id === value && a.taskId === ui.composerTaskId) ? value : '';
      if (!data.threads.some(t => t.id === ui.composerThreadId && t.agentId === ui.composerAgentId)) ui.composerThreadId = '';
    } else if (field === 'composerThreadId') {
      ui.composerThreadId = ui.composerAgentId && (value === 'new' || data.threads.some(t => t.id === value && t.agentId === ui.composerAgentId)) ? value : '';
    } else return;
    ui.composerSubject = ui.subjects[`${ui.composerTaskId}:${ui.composerAgentId}`] || '';
    delete ui.formErrors.prompt;
    notify('render');
  }
  function send(kind) {
    if (kind !== 'prompt' && kind !== 'reply') return false;
    const m = model();
    const source = kind === 'reply' ? m.openTurn : null;
    const agent = source ? m.agents.find(item => item.id === source.agent.id) : (kind === 'prompt' ? m.composerAgent : null);
    const task = source ? m.tasks.find(item => item.id === source.task.id) : (kind === 'prompt' ? m.composerTask : null);
    let thread = source?.thread || (kind === 'prompt' ? m.composerThread : null);
    const key = kind === 'reply' ? m.replyDraftKey : m.promptDraftKey;
    const draft = ui.drafts[key] || '';
    let error = '';
    if (kind === 'reply' && (!source?.completedAt || source.status === 'working')) error = 'Open a finished response to reply.';
    else if (!task) error = 'Choose a task.';
    else if (!task.agents.length) error = 'No sample agents assigned';
    else if (!agent) error = 'Choose an agent.';
    else if (sendUnavailable(agent, task)) error = sendUnavailable(agent, task);
    else if (!thread && !(kind === 'prompt' && ui.composerThreadId === 'new')) error = 'Choose a thread or New thread.';
    else if (kind === 'prompt' && ui.composerThreadId === 'new' && !ui.composerSubject.trim()) error = 'Enter a subject for the new thread.';
    else if (!draft.trim()) error = kind === 'reply' ? 'Enter a reply.' : 'Enter a prompt.';
    if (!error && ui.failNextSend) {
      ui.failNextSend = false;
      error = 'Sample send failed. Your draft is kept.';
    }
    if (error) { ui.formErrors[kind] = error; notify('controls'); return false; }
    const now = tick();
    if (!thread) {
      thread = { id: `thread-${data.nextId++}`, agentId: agent.id, title: ui.composerSubject.trim() };
      data.threads.push(thread);
    }
    const sequence = Math.max(0, ...data.turns.filter(turn => turn.threadId === thread.id).map(turn => turn.sequence)) + 1;
    data.turns.push({ id: `turn-${data.nextId++}`, threadId: thread.id, sequence, prompt: draft.trim(), response: null, status: 'working', startedAt: now, completedAt: null, reviewedAt: null });
    if (source) {
      const original = data.turns.find(turn => turn.id === source.id);
      if (original.reviewedAt == null) original.reviewedAt = now;
    }
    ui.drafts[key] = '';
    delete ui.formErrors[kind];
    if (kind === 'reply') nextReview();
    else {
      ui.composerThreadId = thread.id;
      ui.composerSubject = '';
      delete ui.subjects[`${ui.composerTaskId}:${ui.composerAgentId}`];
    }
    notify('render');
    return true;
  }
  function finish() {
    const turn = data.turns.filter(item => item.status === 'working').sort((a, b) => compare(a, b, 'startedAt'))[0];
    if (!turn) return false;
    turn.status = 'complete';
    turn.completedAt = tick();
    turn.response = 'Synthetic sample completion. This turn has finished in the prototype.\n\nThe sample result is ready for review. No agent ran and no real workspace was inspected or changed. The original prompt and thread history remain available.';
    turn.reviewedAt = null;
    notify('live');
    return true;
  }
  function reset() {
    const variant = ui.variant;
    data = createScenario().data;
    ui = createUI(variant);
    notify('reset');
  }
  function action(act, id, value) {
    if (act === 'finish') return finish();
    if (act === 'reset') return reset();
    if (act === 'task') { if (!selectTask(id)) return; }
    else if (act === 'agent') {
      const agent = data.agents.find(item => item.id === id);
      if (!agent) return;
      selectTask(agent.taskId);
      ui.agentId = id;
      expand('expandedAgentIds', id);
    } else if (act === 'thread') {
      const thread = data.threads.find(item => item.id === id);
      const agent = thread && data.agents.find(item => item.id === thread.agentId);
      if (!agent) return;
      selectTask(agent.taskId);
      ui.agentId = agent.id;
      ui.threadId = thread.id;
      expand('expandedAgentIds', agent.id);
    } else if (act === 'toggle-task') {
      if (!data.tasks.some(item => item.id === id)) return;
      toggle('expandedTaskIds', id);
    } else if (act === 'toggle-agent') {
      if (!data.agents.some(item => item.id === id)) return;
      toggle('expandedAgentIds', id);
    } else if (act === 'open-turn') { if (!selectTurn(id)) return; }
    else if (act === 'review-next') { nextReview(); ui.mobileView = 'review'; }
    else if (act === 'reviewed') {
      const turn = data.turns.find(item => item.id === ui.openTurnId);
      if (!turn || (id && id !== turn.id) || !turn.completedAt || turn.status === 'working' || turn.reviewedAt != null) return;
      turn.reviewedAt = data.clock;
      nextReview();
    } else if (act === 'all-tasks') {
      Object.assign(ui, { taskId: null, agentId: null, threadId: null, openTurnId: null, mobileView: 'tasks', composerShown: false });
    } else if (act === 'back-queue') {
      ui.openTurnId = null;
      ui.mobileView = 'review';
    } else if (act === 'new-prompt') {
      ui.composerShown = true;
      ui.mobileView = 'tasks';
      ui.openTurnId = null;
      if (id && data.tasks.some(item => item.id === id)) {
        ui.composerTaskId = id;
        ui.composerAgentId = '';
        ui.composerThreadId = '';
        ui.composerSubject = '';
      }
    } else if (act === 'mobile-view') {
      ui.mobileView = value === 'review' ? 'review' : 'tasks';
    } else return;
    notify('render');
  }
  const controller = { get data() { return data; }, get ui() { return ui; }, get model() { return model(); }, action, change, send, finish, reset };
  return controller;
}

export function mount() {
  const workspace = document.querySelector('#workspace');
  if (!workspace) return null;
  const selector = document.querySelector('#variant-select');
  let renderer = null;
  let generation = 0;
  let activeStyle = document.querySelector('#variant-style');
  let pendingStyle = null;
  let cancelPendingStyle = null;
  const scrollPositions = new Map();
  const detailStates = new Map();
  const controller = createController({
    ui: createUI(new URL(location.href).searchParams.get('variant')),
    onChange(kind) {
      if (kind === 'reset') { scrollPositions.clear(); detailStates.clear(); }
      if (kind === 'live') patchLive();
      else if (kind !== 'controls') render();
      updateControls();
    },
  });
  const identity = node => node && ({ id: node.id, draft: node.dataset.draft, field: node.dataset.field, act: node.dataset.act, target: node.dataset.id, view: node.dataset.view, form: node.closest('[data-form]')?.dataset.form, send: node.dataset.send });
  const identityMatches = (node, key) => {
    if (key.id) return node.id === key.id;
    if (key.draft != null) return node.dataset.draft === key.draft;
    if (key.field) return node.dataset.field === key.field;
    if (key.send) return node.dataset.send === key.send;
    return key.act && node.dataset.act === key.act && node.dataset.id === key.target && node.dataset.view === key.view;
  };
  function capture() {
    workspace.querySelectorAll('[data-scroll-key]').forEach(node => {
      scrollPositions.set(node.dataset.scrollKey, [node.scrollLeft, node.scrollTop]);
      if (node.tagName === 'DETAILS') detailStates.set(node.dataset.scrollKey, node.open);
    });
    const node = workspace.contains(document.activeElement) ? document.activeElement : null;
    return { focus: identity(node), start: node?.selectionStart, end: node?.selectionEnd, direction: node?.selectionDirection, x: window.scrollX, y: window.scrollY };
  }
  function restore(saved) {
    workspace.querySelectorAll('[data-scroll-key]').forEach(node => {
      const position = scrollPositions.get(node.dataset.scrollKey);
      if (position) { node.scrollLeft = position[0]; node.scrollTop = position[1]; }
      if (node.tagName === 'DETAILS' && detailStates.has(node.dataset.scrollKey)) node.open = detailStates.get(node.dataset.scrollKey);
    });
    if (saved.focus) {
      const node = [...workspace.querySelectorAll('button,input,textarea,select,a,[tabindex]')].find(item => identityMatches(item, saved.focus));
      node?.focus({ preventScroll: true });
      if (node && typeof saved.start === 'number' && typeof node.setSelectionRange === 'function') {
        try { node.setSelectionRange(saved.start, saved.end, saved.direction); } catch { /* Native non-text fields have no selection. */ }
      }
    }
    window.scrollTo(saved.x, saved.y);
  }
  function render() {
    if (!renderer) return;
    const saved = capture();
    workspace.innerHTML = renderer(controller.model);
    restore(saved);
  }
  function patchLive() {
    if (!renderer) return;
    const saved = capture();
    const template = document.createElement('template');
    template.innerHTML = renderer(controller.model);
    const fresh = new Map([...template.content.querySelectorAll('[data-live]')].map(node => [node.dataset.live, node]));
    const regions = [...workspace.querySelectorAll('[data-live]')].filter(node => !node.closest('[data-preserve]') && !node.parentElement?.closest('[data-live]'));
    for (const old of regions) {
      const next = fresh.get(old.dataset.live);
      if (!next) continue;
      // Retain actual nodes, including selection, details, and native scroll state.
      const preserved = [...old.querySelectorAll('[data-preserve]')].filter(node => !node.parentElement?.closest('[data-preserve]'));
      const slots = [...next.querySelectorAll('[data-preserve]')];
      if (preserved.some(node => !slots.some(slot => slot.dataset.preserve === node.dataset.preserve))) continue;
      for (const node of preserved) slots.find(slot => slot.dataset.preserve === node.dataset.preserve).replaceWith(node);
      old.replaceWith(next);
    }
    restore(saved);
  }
  function updateControls() {
    const m = controller.model;
    const finishButton = document.querySelector('#sample-finish');
    if (finishButton) {
      finishButton.disabled = !m.data.turns.some(turn => turn.status === 'working');
      finishButton.textContent = finishButton.disabled ? 'No working sample turns' : 'Finish next working turn';
    }
    const fail = document.querySelector('#sample-fail');
    if (fail) fail.checked = m.ui.failNextSend;
    for (const kind of ['prompt', 'reply']) {
      const error = workspace.querySelector(`[data-form-error="${kind}"]`);
      if (error) { error.textContent = m.ui.formErrors[kind] || ''; error.hidden = !error.textContent; }
      const unavailable = kind === 'prompt' ? sendUnavailable(m.composerAgent, m.composerTask) : sendUnavailable(m.agents.find(agent => agent.id === m.openTurn?.agent?.id));
      const send = workspace.querySelector(`[data-send="${kind}"]`);
      if (send) { send.disabled = Boolean(unavailable); send.textContent = unavailable || (kind === 'prompt' ? 'Send sample prompt' : 'Send sample reply'); }
      const status = workspace.querySelector(`[data-send-status="${kind}"]`);
      if (status) status.textContent = unavailable;
    }
    const inspector = document.querySelector('#state-inspector');
    if (inspector) {
      const json = JSON.stringify({ selectedIds: { taskId: m.ui.taskId, agentId: m.ui.agentId, threadId: m.ui.threadId, openTurnId: m.ui.openTurnId }, queue: m.queue.map(turn => turn.id), draftKeys: Object.keys(m.ui.drafts), counts: m.counts, ui: controller.ui, data: { clock: controller.data.clock, tasks: controller.data.tasks, threads: controller.data.threads, agents: m.agents.map(({ id, taskId, name, status }) => ({ id, taskId, name, status })), turns: controller.data.turns.map(({ response, ...turn }) => turn) } }, null, 2);
      if (inspector.tagName === 'TEXTAREA') inspector.value = json;
      else inspector.textContent = json;
    }
  }
  async function setVariant(value, updateUrl = true, retry = false) {
    const key = validVariant(value);
    const version = ++generation;
    controller.ui.variant = key;
    if (selector) selector.value = key;
    if (updateUrl) {
      const url = new URL(location.href);
      url.searchParams.set('variant', key);
      history.replaceState(null, '', url);
    }
    cancelPendingStyle?.();
    pendingStyle?.remove();
    pendingStyle = null;
    cancelPendingStyle = null;
    workspace.setAttribute('aria-busy', 'true');
    try {
      const module = await import(`./${key}.js${retry ? `?retry=${version}` : ''}`);
      if (version !== generation) return;
      if (typeof module.render !== 'function') throw new Error('Comparison module does not export render(model).');
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.media = 'not all';
      link.href = new URL(`./${key}.css`, import.meta.url).href;
      pendingStyle = link;
      await new Promise((resolve, reject) => {
        cancelPendingStyle = resolve;
        link.onload = resolve;
        link.onerror = () => reject(new Error(`Could not load ${key}.css`));
        document.head.append(link);
      });
      if (version !== generation) { link.remove(); return; }
      activeStyle?.remove();
      link.id = 'variant-style';
      link.media = 'all';
      activeStyle = link;
      pendingStyle = null;
      cancelPendingStyle = null;
      document.body.dataset.variant = key;
      renderer = module.render;
      const tradeoff = document.querySelector('#variant-tradeoff');
      if (tradeoff) tradeoff.textContent = tradeoffs[key];
      render();
      updateControls();
    } catch (error) {
      if (version !== generation) return;
      pendingStyle?.remove();
      pendingStyle = null;
      cancelPendingStyle = null;
      capture();
      renderer = null;
      workspace.innerHTML = `<section class="comparison-error" role="alert"><h1>Comparison could not load</h1><p>${escapeHtml(error.message)}</p><p>Retry this comparison or choose another using the comparison selector.</p><button type="button" data-act="retry-comparison">Retry comparison</button></section>`;
    } finally {
      if (version === generation) workspace.removeAttribute('aria-busy');
    }
  }
  function cycle(delta) { setVariant(variants[(variants.indexOf(controller.ui.variant) + delta + variants.length) % variants.length]); }
  for (const [id, delta, name] of [['variant-prev', -1, 'Previous comparison'], ['variant-next', 1, 'Next comparison']]) {
    const control = document.getElementById(id);
    if (!control) continue;
    control.innerHTML = icon(delta < 0 ? 'arrowLeft' : 'arrowRight');
    control.setAttribute('aria-label', name);
    control.addEventListener('click', () => cycle(delta));
  }
  selector?.addEventListener('change', () => setVariant(selector.value));
  document.querySelector('#sample-finish')?.addEventListener('click', () => controller.finish());
  document.querySelector('#sample-reset')?.addEventListener('click', () => controller.reset());
  document.querySelector('#sample-fail')?.addEventListener('change', event => controller.change('failNextSend', event.target.checked));
  window.addEventListener('popstate', () => setVariant(new URL(location.href).searchParams.get('variant'), false));
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.target.closest('input,textarea,select,button,a,summary,[contenteditable]:not([contenteditable="false"]),[role="tab"],[role="tablist"],[role="listbox"],[role="slider"],[role="spinbutton"],[role="tree"],[role="grid"],[role="menu"],[role="combobox"],[data-tray]')) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); cycle(event.key === 'ArrowLeft' ? -1 : 1); }
  });
  workspace.addEventListener('input', event => {
    const node = event.target;
    if (node.dataset.draft != null) {
      controller.ui.drafts[node.dataset.draft] = node.value;
      updateControls();
    } else if (node.dataset.field === 'composerSubject') controller.change('composerSubject', node.value);
  });
  workspace.addEventListener('change', event => {
    const node = event.target;
    if (node.dataset.field && node.dataset.field !== 'composerSubject') controller.change(node.dataset.field, node.value);
  });
  workspace.addEventListener('submit', event => {
    const form = event.target.closest('[data-form]');
    if (!form) return;
    event.preventDefault();
    controller.send(form.dataset.form);
  });
  workspace.addEventListener('click', event => {
    const control = event.target.closest('[data-act]');
    if (!control || control.disabled) return;
    const { act, id, view, direction } = control.dataset;
    if (act === 'retry-comparison') { setVariant(controller.ui.variant, true, true); return; }
    if (act === 'tray-scroll') {
      const tray = control.closest('.review-queue')?.querySelector('[data-tray]');
      tray?.scrollBy({ left: (direction === 'left' ? -1 : 1) * tray.clientWidth * 0.8, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      return;
    }
    controller.action(act, id, view);
  });
  updateControls();
  setVariant(controller.ui.variant);
  return controller;
}

if (typeof document !== 'undefined' && document.querySelector('#workspace')) mount();
