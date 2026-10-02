import { escapeHtml as h, icon } from '../shared.js';
import { renderComposer, renderQueue, renderReview, renderTaskWorkspace, renderSummary, statusMark } from './shared.js';

function room(task, index) {
  return `<section class="task-room" aria-labelledby="room-${h(task.id)}">
    <header class="room-heading">

      <h2 id="room-${h(task.id)}"><button type="button" data-act="task" data-id="${h(task.id)}">${h(task.title)}${icon('arrowRight')}</button></h2>
      <p class="room-counts"><span>${task.workingCount} working</span><span>${task.pendingCount} awaiting review</span></p>
    </header>
    ${task.agents.length ? `<ul class="room-agents">${task.agents.map(agent => `<li><button type="button" class="room-agent" data-act="agent" data-id="${h(agent.id)}"><span class="room-agent-name">${h(agent.name)}</span>${statusMark(agent)}<span class="room-agent-threads">${agent.threads.length} ${agent.threads.length === 1 ? 'thread' : 'threads'} · ${agent.pendingCount} awaiting review</span></button></li>`).join('')}</ul>` : '<div class="room-unstaffed"><strong>Unstaffed</strong><p>No sample agents assigned</p></div>'}
  </section>`;
}

function workspace(model) {
  if (model.openTurn) {
    return `<section class="rooms-response-workspace"><nav class="rooms-context" aria-label="Task context"><button type="button" data-act="all-tasks">${icon('arrowLeft')} All tasks</button><button type="button" data-act="task" data-id="${h(model.openTurn.task.id)}">${h(model.openTurn.task.title)}</button></nav>${renderReview(model)}</section>`;
  }
  if (model.task) return renderTaskWorkspace(model);
  return `<section class="rooms-board" aria-label="Task rooms">${model.tasks.map(room).join('')}</section>${model.ui.composerShown ? `<div class="rooms-home-composer">${renderComposer(model)}</div>` : ''}`;
}

export function render(model) {
  const queueShown = model.ui.mobileView === 'review' && !model.openTurn;
  return `<div class="rooms-layout${queueShown ? ' rooms-show-queue' : ''}${model.openTurn ? ' rooms-show-response' : ''}">
    <header class="rooms-header"><h1>tuios inbox</h1><button type="button" class="rooms-new-prompt" data-act="new-prompt"${model.task ? ` data-id="${h(model.task.id)}"` : ''}>New prompt ${icon('plus')}</button></header>
    ${renderSummary(model)}
    <nav class="rooms-mobile-tray" data-live="rooms-mobile-tray" aria-label="Review navigation"><button type="button" data-act="${model.openTurn ? 'back-queue' : 'mobile-view'}"${model.openTurn ? '' : ' data-view="review"'} aria-expanded="${queueShown}"><span>Review next</span><strong>${model.counts.pending} waiting</strong>${icon('arrowRight')}</button></nav>
    <div class="rooms-central" data-live="rooms-central" data-scroll-key="rooms-workspace">${workspace(model)}</div>
    <aside class="rooms-tray" aria-label="Responses awaiting review"><button type="button" class="rooms-queue-back" data-act="mobile-view" data-view="tasks">${icon('arrowLeft')} Back to ${model.task ? 'task' : 'tasks'}</button>${renderQueue(model, 'horizontal')}</aside>
  </div>`;
}
