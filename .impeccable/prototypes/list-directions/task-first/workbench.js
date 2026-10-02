import { escapeHtml as h, icon } from '../shared.js';
import { statusMark, renderQueue, renderReview, renderComposer, renderSummary, executionDetails } from './shared.js';

const button = (act, label, id = '', extra = '') => `<button type="button" data-act="${act}"${id ? ` data-id="${h(id)}"` : ''} ${extra}>${label}</button>`;
const selected = yes => yes ? 'aria-current="true"' : '';

function rail(model) {
  return `<details class="workbench-rail" open data-live="workbench-rail" data-scroll-key="workbench-rail">
    <summary>Tasks <span>${model.tasks.length} tasks · ${model.agents.length} agents</span></summary>
    <nav aria-label="Tasks and agents" data-scroll-key="workbench-task-list">
      ${model.tasks.map(task => `<section class="workbench-task" data-scroll-key="workbench-task:${h(task.id)}">
        ${button('task', `<span>${h(task.title)}</span><small>${task.workingCount} working · ${task.pendingCount} waiting</small>`, task.id, `class="workbench-open-task" ${selected(task.id === model.ui.taskId)}`)}

        ${task.agents.length ? task.agents.map(agent => button('agent', `<strong>${h(agent.name)}</strong>${statusMark(agent)}`, agent.id, `class="workbench-agent" ${selected(agent.id === model.ui.agentId)}`)).join('') : '<p class="workbench-empty">No sample agents assigned</p>'}
      </section>`).join('')}
    </nav>
  </details>`;
}

function taskContent(model) {
  const { task, agent, thread } = model;
  const agents = agent ? [agent] : task.agents;
  return `<section class="workbench-task-content" data-live="workbench-content" data-scroll-key="workbench-task-content:${h(task.id)}">
    <header><h1>${h(task.title)}</h1><p>${task.workingCount} working · ${task.pendingCount} awaiting review</p>
      ${button('new-prompt', `${icon('plus')} New prompt`, task.id)}</header>
    ${agents.length ? agents.map(item => `<section class="workbench-agent-content">
      <h2>${h(item.name)} ${statusMark(item)}</h2>
      <nav class="workbench-threads" aria-label="${h(item.name)} threads">
        ${item.threads.map(t => button('thread', h(t.title), t.id, selected(t.id === model.ui.threadId))).join('') || '<p>No threads yet.</p>'}
      </nav>
      ${thread && thread.agentId === item.id ? `<section class="workbench-history"><h3>${h(thread.title)}</h3>
        <ol>${thread.turns.map(turn => `<li><p><strong>Prompt · Turn ${turn.sequence}</strong></p><p class="workbench-prompt">${h(turn.prompt)}</p>
          ${button('open-turn', `Turn ${turn.sequence} · ${h(turn.title || turn.label || 'Open response')} ${statusMark(turn.status)}${turn.reviewedAt != null ? ' · Reviewed' : ''}`, turn.id)}</li>`).join('')}</ol>
      </section>` : ''}
      ${executionDetails(item)}
    </section>`).join('') : '<p>No sample agents assigned</p>'}
  </section>`;
}

function home(model) {
  const next = model.queue[0];
  return `<section class="workbench-home" data-live="workbench-home">

    ${next ? `<h1>${h(next.task.title)}</h1><p>${h(next.agent.name)} › ${h(next.thread.title)}</p>
      <p>Turn ${next.sequence} · ${h(next.title || next.label || next.status)} · ${h(next.age)}</p>
      ${button('review-next', `Review ${model.ui.queueOrder === 'newest' ? 'newest' : 'oldest'} response ${icon('arrowRight')}`, '', 'class="primary"')}`
      : '<h1>All caught up</h1><p>No responses waiting for review.</p>'}
    <div class="workbench-home-compose">${renderComposer(model)}</div>
  </section>`;
}

export function render(model) {
  const queueView = model.ui.mobileView === 'review' && !model.openTurn;
  const content = model.openTurn
    ? renderReview(model).replace('<details class="original-prompt">', '<details class="original-prompt" open>')
    : model.ui.composerShown ? renderComposer(model) : model.task ? taskContent(model) : home(model);
  return `<div class="workbench-layout${queueView ? ' is-queue-view' : ''}">
    <header class="workbench-header"><h1>tuios inbox</h1>${renderSummary(model)}
      <nav aria-label="Workbench navigation">${button('all-tasks', 'All tasks')}${button('new-prompt', `${icon('plus')} New prompt`)}</nav>
    </header>
    ${rail(model)}
    <section class="workbench-content" aria-label="Reading and composition" data-scroll-key="workbench-reading">
      ${!model.openTurn ? `<nav class="workbench-mobile-controls" aria-label="Review navigation">${button('mobile-view', 'Review next', '', 'data-view="review"')}</nav>` : ''}
      ${content}
    </section>
    <aside class="workbench-queue" aria-label="Review next" data-scroll-key="workbench-queue">
      ${button('mobile-view', `${icon('arrowLeft')} Back to content`, '', 'class="workbench-queue-back" data-view="tasks"')}
      ${renderQueue(model).replace('data-live="queue"', 'data-live="workbench-queue"')}
    </aside>
  </div>`;
}
