import { escapeHtml as h, icon } from '../shared.js';

const statusLabels = { working: 'Working', idle: 'Idle', needs_input: 'Needs input', error: 'Stopped', offline: 'Offline', complete: 'Complete' };
const button = (act, text, id = '', extra = '') => `<button type="button" data-act="${act}"${id ? ` data-id="${h(id)}"` : ''} ${extra}>${text}</button>`;
const paragraphs = text => String(text ?? '').split(/\n\s*\n/).map(part => `<p>${h(part).replace(/\n/g, '<br>')}</p>`).join('');
const breadcrumb = turn => [turn.task?.title, turn.agent?.name, turn.thread?.title].filter(Boolean).map(h).join(' <span aria-hidden="true">›</span> ');
const option = (id, title, selected) => `<option value="${h(id)}"${id === selected ? ' selected' : ''}>${h(title)}</option>`;

export function statusMark(agentOrStatus) {
  const status = typeof agentOrStatus === 'string' ? agentOrStatus : agentOrStatus?.status;
  return `<span class="status status-mark status-${h(status || 'idle')}" data-status="${h(status || 'idle')}"><span class="status-dot" aria-hidden="true"></span>${h(statusLabels[status] || 'Idle')}</span>`;
}

export function executionDetails(agent) {
  return `<details class="execution-details" data-scroll-key="execution:${h(agent.id)}"><summary>Execution details</summary><dl><div><dt>Session</dt><dd>${h(agent.pane?.session)}</dd></div><div><dt>Pane</dt><dd>${h(agent.pane?.id)}</dd></div></dl><p>Sample execution identity only. No real agent is running.</p></details>`;
}

export function renderSummary(model) {
  const { counts: c } = model;
  return `<p class="workspace-summary" data-live="summary">${c.workingTasks} of ${c.tasks} tasks working · ${c.workingAgents} of ${c.agents} agents working · ${c.pending} responses to review</p>`;
}

export function sendUnavailable(agent, task) {
  if (task && !task.agents.length) return 'No sample agents assigned';
  if (agent?.availability === 'offline' || agent?.status === 'offline') return 'Offline';
  if (agent?.status === 'working') return 'Already working';
  return '';
}

export function renderComposer(model) {
  const { ui, composerTask: task, composerAgent: agent, promptDraftKey: key } = model;
  const agents = task?.agents || [];
  const threads = agent?.threads || [];
  const unavailable = sendUnavailable(agent, task);
  const error = ui.formErrors?.prompt || '';
  return `<section class="composer" data-preserve="composer" data-scroll-key="composer">
    <h2>New prompt</h2><form data-form="prompt" novalidate>
      <div class="composer-fields composer-targets">
        <label>Task<select data-field="composerTaskId" name="task"><option value="">Choose a task</option>${model.tasks.map(t => option(t.id, t.title, ui.composerTaskId)).join('')}</select></label>
        <label>Agent<select data-field="composerAgentId" name="agent"${!task || !agents.length ? ' disabled' : ''}><option value="">Choose an agent</option>${agents.map(a => option(a.id, a.name, ui.composerAgentId)).join('')}</select></label>
        <label>Thread<select data-field="composerThreadId" name="thread"${!agent ? ' disabled' : ''}><option value="">Choose a thread</option>${threads.map(t => option(t.id, t.title, ui.composerThreadId)).join('')}${option('new', 'New thread', ui.composerThreadId)}</select></label>
      </div>
      ${ui.composerThreadId === 'new' ? `<label>Thread subject<input type="text" name="subject" data-field="composerSubject" value="${h(ui.composerSubject)}" autocomplete="off"></label>` : ''}
      <p class="review-breadcrumb recipient-breadcrumb">${task ? h(task.title) : 'Choose task'} › ${agent ? h(agent.name) : 'Choose agent'} › ${ui.composerThreadId === 'new' ? 'New thread' : h(model.composerThread?.title || 'Choose thread')}</p>
      <label>Prompt<textarea name="prompt" data-draft="${h(key)}" rows="4" placeholder="Write a sample prompt">${h(ui.drafts[key] || '')}</textarea></label>
      <p class="form-error" data-form-error="prompt" role="alert"${error ? '' : ' hidden'}>${h(error)}</p>
      <div class="composer-actions"><button type="submit" data-send="prompt"${unavailable ? ' disabled' : ''}>${h(unavailable || 'Send sample prompt')}</button><span data-send-status="prompt" class="send-status">${h(unavailable)}</span></div>
      <p class="sample-note">Synthetic sample only. Nothing is sent to a real agent.</p>
    </form></section>`;
}

export function renderQueue(model, orientation = 'vertical') {
  const horizontal = orientation === 'horizontal';
  return `<section class="queue review-queue queue-${horizontal ? 'horizontal' : 'vertical'}" data-live="queue" aria-label="Review queue">
    <header class="queue-header"><h2>Review next <span>${model.queue.length} waiting</span></h2><label>Queue order<select data-field="queueOrder">${option('oldest', 'Oldest first', model.ui.queueOrder)}${option('newest', 'Newest first', model.ui.queueOrder)}</select></label>${horizontal ? `<div class="tray-controls">${button('tray-scroll', `${icon('arrowLeft')}<span class="sr-only">Scroll review tray left</span>`, '', 'data-direction="left"')}${button('tray-scroll', `${icon('arrowRight')}<span class="sr-only">Scroll review tray right</span>`, '', 'data-direction="right"')}</div>` : ''}</header>
    ${model.queue.length ? `<ol class="queue-list" data-scroll-key="queue"${horizontal ? ' data-tray tabindex="0" aria-label="Scrollable review queue"' : ''}>${model.queue.map((turn, i) => `<li class="queue-item${turn.id === model.ui.openTurnId ? ' is-selected' : ''}">${button('open-turn', `<span class="queue-position">${i + 1}</span><span class="queue-identity"><strong>${h(turn.task?.title)}</strong><span>${h(turn.agent?.name)} · ${h(turn.thread?.title)}</span><span class="queue-turn">Turn ${turn.sequence} · ${h(turn.title || turn.label || turn.status)}</span></span><span class="queue-meta">${statusMark(turn.status)}<span>${h(turn.age)}</span></span>`, turn.id, turn.id === model.ui.openTurnId ? 'aria-current="true"' : '')}</li>`).join('')}</ol>` : '<p class="queue-empty">All caught up. Your tasks and activity are still here.</p>'}
    ${horizontal && model.queue.length ? `<p class="queue-end">${model.ui.queueOrder === 'oldest' ? 'Just arrived →' : 'Older responses →'}</p>` : ''}
  </section>`;
}

export function renderReview(model) {
  const turn = model.openTurn;
  if (!turn) return renderQueue(model);
  const terminal = Boolean(turn.completedAt) && turn.status !== 'working';
  const reviewed = turn.reviewedAt != null;
  const unavailable = sendUnavailable(model.agents.find(agent => agent.id === turn.agent.id));
  const key = model.replyDraftKey;
  const error = model.ui.formErrors?.reply || '';
  return `<article class="review" data-preserve="review:${h(turn.id)}" data-scroll-key="review:${h(turn.id)}" aria-label="Turn response">
    <header class="review-header">${button('back-queue', `${icon('arrowLeft')} Back to queue`)}<p class="review-breadcrumb recipient-breadcrumb">${breadcrumb(turn)}</p><h2>${h(turn.title || turn.label || `Turn ${turn.sequence}`)}</h2><p>${statusMark(turn.status)} · Turn ${turn.sequence} · ${h(turn.age)}${reviewed ? ' · Reviewed' : ''}</p></header>
    <details class="original-prompt"><summary>Original prompt</summary>${paragraphs(turn.prompt)}</details>
    <div class="response-body" data-scroll-key="response:${h(turn.id)}">${turn.response ? paragraphs(turn.response) : '<p>This synthetic turn is working. Use Sample controls to finish it.</p>'}</div>
    <p class="sample-note">Synthetic response. No findings or measurements describe a real workspace.</p>
    ${terminal ? `<div class="review-actions">${button('reviewed', `${icon('check')} Reviewed · next`, turn.id, reviewed ? 'disabled' : '')}</div>
      <form class="reply-form" data-form="reply" novalidate><h3>Reply in this thread</h3><p class="review-breadcrumb recipient-breadcrumb">${breadcrumb(turn)}</p><label>Reply<textarea name="reply" data-draft="${h(key)}" rows="4">${h(model.ui.drafts[key] || '')}</textarea></label><p class="form-error" role="alert" data-form-error="reply"${error ? '' : ' hidden'}>${h(error)}</p><button type="submit" data-send="reply"${unavailable ? ' disabled' : ''}>${h(unavailable || 'Send sample reply')}</button><span class="send-status" data-send-status="reply">${h(unavailable)}</span><p>Sending a reply marks only this response reviewed.</p></form>` : ''}
  </article>`;
}

export function renderTaskWorkspace(model) {
  const task = model.task;
  if (!task) return renderComposer(model);
  return `<section class="task-workspace" data-scroll-key="task:${h(task.id)}">
    <header>${button('all-tasks', `${icon('arrowLeft')} All tasks`)}<h1>${h(task.title)}</h1><p data-live="task-counts">${task.workingCount} working · ${task.pendingCount} awaiting review · ${task.agents.length} agents</p></header>
    <div class="task-agents" data-live="task-agents">${task.agents.length ? task.agents.map(agent => {
      const expanded = model.ui.expandedAgentIds.includes(agent.id) || model.ui.agentId === agent.id;
      return `<section class="task-agent${model.ui.agentId === agent.id ? ' is-selected' : ''}">
        <h2>${button('agent', `${h(agent.name)} ${statusMark(agent)}`, agent.id, `aria-expanded="${expanded}"`)}</h2>
        <p>${agent.threads.length} threads · ${agent.pendingCount} awaiting review</p>
        ${expanded ? `<div class="agent-threads">${agent.threads.map(thread => `<section class="thread">
          <h3>${button('thread', h(thread.title), thread.id, model.ui.threadId === thread.id ? 'aria-current="true"' : '')}</h3>
          ${model.ui.threadId === thread.id ? `<ol class="turn-history">${thread.turns.map(turn => `<li>${button('open-turn', `Turn ${turn.sequence} · ${h(turn.title || turn.prompt || turn.label)} · ${turn.reviewedAt != null ? 'Reviewed' : turn.status === 'working' ? 'Working' : 'Awaiting review'}`, turn.id)}</li>`).join('')}</ol>` : ''}
        </section>`).join('')}</div>${executionDetails(agent)}` : ''}
      </section>`;
    }).join('') : '<p>No sample agents assigned</p>'}</div>
    ${renderComposer(model)}
  </section>`;
}
