import { escapeHtml as h, icon } from '../shared.js';
import { renderComposer, renderQueue, renderReview, renderTaskWorkspace, renderSummary, statusMark } from './shared.js';

const button = (action, label, extra = '') => `<button type="button" data-act="${action}" ${extra}>${label}</button>`;

function activityIndex(model) {
  return `<details class="desk-index" data-scroll-key="desk-index" data-live="desk-index">
    <summary>Tasks · ${model.counts.workingTasks} working <span>${model.counts.tasks} tasks ${icon('chevron')}</span></summary>
    <nav class="desk-index-grid" aria-label="Task activity index">${model.tasks.map(task => `
      <button type="button" class="desk-index-task${task.id === model.ui.taskId ? ' is-selected' : ''}" data-act="task" data-id="${h(task.id)}"${task.id === model.ui.taskId ? ' aria-current="true"' : ''}>
        <strong>${h(task.title)}</strong>
        <span class="desk-index-counts">${task.workingCount} working · ${task.pendingCount} awaiting review</span>
        <span class="desk-index-agents">${task.agents.length ? task.agents.map(agent => `<span class="desk-index-agent"><span>${h(agent.name)}</span>${statusMark(agent)}</span>`).join('') : '<span>No sample agents assigned</span>'}</span>
      </button>`).join('')}</nav>
  </details>`;
}

function home(model) {
  const next = model.queue[0];
  return `<section class="desk-home" data-live="desk-home">

    ${next ? `<h1>${h(next.task.title)}</h1>
      <p class="desk-next-identity">${h(next.agent.name)} <span aria-hidden="true">›</span> ${h(next.thread.title)}</p>
      <p class="desk-next-turn">Turn ${next.sequence} · ${h(next.title || next.label)} · ${h(next.age)}</p>
      <p class="desk-intro">A response is ready when you are. Open it to read, mark it reviewed, or continue the thread.</p>
      ${button('review-next', `Review ${model.ui.queueOrder === 'newest' ? 'newest' : 'oldest'} response ${icon('arrowRight')}`, 'class="primary"')}` : '<h1>All caught up</h1><p class="desk-intro">There are no responses waiting for review. Your tasks and activity remain in the index above.</p>'}
    <div class="desk-home-compose">${model.ui.composerShown ? renderComposer(model) : `<h2>Start a conversation</h2><p>Choose a task, an agent, and a thread for your next prompt.</p>${button('new-prompt', `${icon('plus')} New prompt`)}`}</div>
  </section>`;
}

export function render(model) {
  const queueView = model.ui.mobileView === 'review' && !model.openTurn;
  return `<div class="desk-layout${queueView ? ' is-queue-view' : ''}">
    <header class="desk-masthead"><div><p class="desk-brand">tuios inbox</p>${renderSummary(model)}</div><span class="desk-edition">Review desk</span></header>
    ${activityIndex(model)}
    <div class="desk-mobile-controls" data-live="desk-mobile-controls">
      ${button(model.openTurn ? 'back-queue' : 'mobile-view', `Up next · ${model.queue.length}`, 'data-view="review"')}
      ${queueView ? button('mobile-view', `${icon('arrowLeft')} Back to desk`, 'data-view="tasks"') : ''}
    </div>
    <div class="desk-columns">
      <section class="desk-reading" aria-label="Focused desk" data-scroll-key="desk-reading">
        <nav class="desk-navigation" aria-label="Desk navigation" data-live="desk-navigation">
          ${button('all-tasks', 'All tasks', !model.task && !model.openTurn && !model.ui.composerShown ? 'aria-current="page"' : '')}
          ${button('review-next', 'Review next', model.queue.length ? '' : 'disabled')}
          ${button('new-prompt', `${icon('plus')} New prompt`)}
        </nav>
        <div class="desk-paper">${model.openTurn ? renderReview(model) : model.task ? renderTaskWorkspace(model) : home(model)}</div>
      </section>
      <aside class="desk-up-next" aria-label="Up next"><h2>Up next</h2>${renderQueue(model)}</aside>
    </div>
  </div>`;
}
