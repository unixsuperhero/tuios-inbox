import { escapeHtml as h, icon } from '../shared.js';
import { renderComposer, renderQueue, renderReview, renderSummary, statusMark, executionDetails } from './shared.js';

function threadRow(thread, model) {
  const selected = model.ui.threadId === thread.id;
  return `<li class="ledger-thread">
    <button type="button" data-act="thread" data-id="${h(thread.id)}" aria-expanded="${selected}"${selected ? ' aria-current="true"' : ''}><span>${h(thread.title)}</span><span class="ledger-meta">${thread.turns.length} turns · ${thread.pendingCount} waiting</span></button>
    ${selected ? `<ol class="ledger-turns">${thread.turns.map(turn => `<li><button type="button" data-act="open-turn" data-id="${h(turn.id)}"${model.ui.openTurnId === turn.id ? ' aria-current="true"' : ''}><span class="ledger-meta">Turn ${turn.sequence} · ${turn.reviewedAt != null ? 'Reviewed' : turn.status === 'working' ? 'Working' : 'Awaiting review'}</span><span>${h(turn.title || turn.prompt || turn.label)}</span></button></li>`).join('')}</ol>` : ''}
  </li>`;
}

function agentRow(agent, model) {
  const expanded = model.ui.expandedAgentIds.includes(agent.id);
  const selected = model.ui.agentId === agent.id;
  return `<li class="ledger-agent${selected ? ' is-selected' : ''}">
    <div class="ledger-agent-line">
      <button class="ledger-toggle" type="button" data-act="toggle-agent" data-id="${h(agent.id)}" aria-label="${expanded ? 'Collapse' : 'Expand'} ${h(agent.name)} threads" aria-expanded="${expanded}" aria-controls="ledger-agent-${h(agent.id)}">${icon('chevron')}</button>
      <button class="ledger-agent-select" type="button" data-act="agent" data-id="${h(agent.id)}"${selected ? ' aria-current="true"' : ''}><span class="ledger-agent-name">${h(agent.name)}</span>${statusMark(agent)}<span class="ledger-meta">${agent.threads.length} ${agent.threads.length === 1 ? 'thread' : 'threads'} · ${agent.pendingCount} waiting</span></button>
    </div>
    <div id="ledger-agent-${h(agent.id)}"${expanded ? '' : ' hidden'}>${expanded ? `<ul class="ledger-threads">${agent.threads.map(thread => threadRow(thread, model)).join('')}</ul>${executionDetails(agent)}` : ''}</div>
  </li>`;
}

function taskRow(task, model, index) {
  const expanded = model.ui.expandedTaskIds.includes(task.id);
  const selected = model.ui.taskId === task.id;
  return `<li class="ledger-task${selected ? ' is-selected' : ''}">
    <div class="ledger-task-line">
      <button class="ledger-toggle" type="button" data-act="toggle-task" data-id="${h(task.id)}" aria-label="${expanded ? 'Collapse' : 'Expand'} ${h(task.title)} agents" aria-expanded="${expanded}" aria-controls="ledger-task-${h(task.id)}">${icon('chevron')}</button>
      <button class="ledger-task-select" type="button" data-act="task" data-id="${h(task.id)}"${selected ? ' aria-current="true"' : ''}><span class="ledger-task-title">${h(task.title)}</span><span class="ledger-task-counts"><span>${task.workingCount} working</span><span>${task.pendingCount} waiting</span></span></button>
    </div>
    <div id="ledger-task-${h(task.id)}"${expanded ? '' : ' hidden'}>${expanded ? task.agents.length ? `<ul class="ledger-agents">${task.agents.map(agent => agentRow(agent, model)).join('')}</ul>` : '<p class="ledger-unstaffed">No sample agents assigned</p>' : ''}</div>
  </li>`;
}

export function render(model) {
  const reviewVisible = model.ui.mobileView === 'review';
  return `<div class="ledger" data-mobile-view="${reviewVisible ? 'review' : 'tasks'}">
    <header class="ledger-header"><h1>tuios inbox</h1>${renderSummary(model)}</header>
    <nav class="ledger-mobile-switch" aria-label="Workspace view" data-live="ledger-mobile-counts">
      <button type="button" data-act="mobile-view" data-view="tasks" aria-pressed="${!reviewVisible}" aria-controls="ledger-tasks">Tasks <span>${model.counts.tasks} · ${model.counts.workingTasks} working</span></button>
      <button type="button" data-act="mobile-view" data-view="review" aria-pressed="${reviewVisible}" aria-controls="ledger-review">Review <span>${model.counts.pending} waiting</span></button>
    </nav>
    <div class="ledger-columns">
      <section class="ledger-tasks" id="ledger-tasks" aria-label="Tasks and prompt" data-scroll-key="ledger-tasks">
        <div class="ledger-roster" data-live="ledger-roster">
          <header class="ledger-roster-header"><h2>Tasks</h2>${model.task ? `<button type="button" data-act="all-tasks">${icon('arrowLeft')} All tasks</button>` : '<span class="ledger-meta">Working / awaiting review</span>'}</header>
          <ol class="ledger-task-list">${model.tasks.map((task, index) => taskRow(task, model, index)).join('')}</ol>
        </div>
        ${renderComposer(model)}
      </section>
      <section class="ledger-review" id="ledger-review" aria-label="Review workspace" data-scroll-key="ledger-review">
        <button class="ledger-back-tasks" type="button" data-act="mobile-view" data-view="tasks">${icon('arrowLeft')} Back to tasks</button>
        ${model.openTurn ? `<div class="ledger-review-order" data-live="ledger-review-order"><label>Queue order<select data-field="queueOrder"><option value="oldest"${model.ui.queueOrder === 'oldest' ? ' selected' : ''}>Oldest first</option><option value="newest"${model.ui.queueOrder === 'newest' ? ' selected' : ''}>Newest first</option></select></label></div>${renderReview(model)}` : renderQueue(model)}
      </section>
    </div>
  </div>`;
}
