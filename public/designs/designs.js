export {};
const layout = document.body.dataset.layout;
const $ = (selector) => document.querySelector(selector);
const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const icons = {
  inbox: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 13h5l2 3h4l2-3h5"/>',
  tasks: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="m8 9 2 2 4-4M8 16h8"/>',
  archive: '<path d="M4 8h16v12H4zM3 4h18v4H3zM9 12h6"/>'
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
const tasks = [
  {id:'expiry', title:'Fix session expiry', project:'api', agent:'Codex', state:'review', note:'Keep active sessions alive without changing the sign-in flow.'},
  {id:'picker', title:'Review folder picker', project:'tuios inbox', agent:'Claude', state:'review', note:'Check the native directory selection and cancellation behavior.'},
  {id:'queue', title:'Audit queue ordering', project:'tuios inbox', agent:'Codex', state:'working', note:'Check that new responses do not disturb the current reading pane.'},
  {id:'release', title:'Prepare release notes', project:'api', agent:'Claude', state:'review', note:'Summarize the user-facing changes for the next release.'}
];
const expiryBody = `<p>The session expiry change is ready for your review. Active sessions now refresh their expiry when a request succeeds. Expired sessions still require a new sign-in.</p><h3>What changed</h3><p>The refresh happens in the session middleware, after the session has been validated. The browser does not need a timer or a background request to keep the session alive.</p><pre><code>session = {
  id: 'session_42',
  expiresAt: '2026-10-06T16:30:00Z',
  lastActivityAt: '2026-10-06T16:00:00Z'
}</code></pre><p>The middleware updates <code>expiresAt</code> only for authenticated activity. Reading an expired session does not extend it.</p><h3>Checks</h3><ul><li>An active session survives multiple requests before expiry.</li><li>An expired session returns a sign-in response.</li><li>A revoked session cannot become active again.</li></ul><h3>Before you merge</h3><p>Review the idle timeout value. I kept the existing 30-minute policy; this change does not introduce a longer session lifetime.</p><p>The turn has finished. The task stays open until you review the result and mark it complete.</p>`;
const edgeBody = `<p>I checked the refresh-token edge cases you asked about. The session change does not alter token rotation.</p><h3>Findings</h3><ul><li>Two requests with the same refresh token cannot both rotate it.</li><li>Revoking a session removes its refresh-token family.</li><li>A token from another session is rejected before the expiry update.</li></ul><pre><code>rotation = {
  previousToken: 'revoked',
  nextToken: 'active',
  sessionId: 'session_42'
}</code></pre><p>The remaining decision is whether you want the existing session policy documented in the settings page. I did not change that page.</p><h3>Review</h3><p>Please review the middleware change together with the session expiry response. No deployment was made.</p>`;
const releaseBody = `<p>I drafted the release notes around the changes a user will notice, rather than listing internal refactors.</p><h3>Draft</h3><ul><li>Completed agent turns now arrive as unread responses.</li><li>Opening a response marks it read. You can mark it unread again when you want to return to it.</li><li>Task completion remains a separate action from an agent finishing a turn.</li></ul><h3>Not included</h3><p>I left browser approvals and remote access out of the notes. They are not part of this release.</p><p>The draft is ready to review. The release itself has not been published.</p>`;
let sequence = 4;
const messages = [
  {id:'m2', task:'expiry', subject:'Refresh token edge cases checked', preview:'Token rotation stays unchanged. One documentation decision remains.', body:edgeBody, unread:true, time:'10:42', prompt:'Check refresh token rotation and concurrent requests. Report what needs my review.', capture:'complete'},
  {id:'m3', task:'release', subject:'Release notes are ready to review', preview:'User-facing changes only. Browser approvals are not claimed as shipped.', body:releaseBody, unread:true, time:'10:28', prompt:'Draft release notes for the inbox changes. Do not publish them.', capture:'complete'},
  {id:'m4', task:'picker', subject:'Turn finished; response unavailable', preview:'The completion event arrived, but no final response was captured.', body:'', unread:true, time:'10:16', prompt:'Review the native folder picker. Check cancellation and how the chosen directory reaches the task.', capture:'missing'},
  {id:'m1', task:'expiry', subject:'Session expiry fix is ready to review', preview:'Active requests refresh the session. Expired sessions still require sign-in.', body:expiryBody, unread:false, time:'09:54', prompt:'Fix session expiry without adding a browser heartbeat. Preserve the current 30-minute timeout.', capture:'complete'}
];
const jobs = [{id:'j1', task:'queue', subject:'Audit queue ordering', prompt:'Check that arrivals preserve the selected response, scroll position and reply draft.'}];
let view = layout === 'tasks' ? 'tasks' : 'inbox';
let selectedTask = 'expiry';
let selectedMessage = 'm1';
let filter = 'all';
let project = 'all';
let search = '';
let toastTarget = null;
const taskFor = (id) => tasks.find((task) => task.id === id);
for (const message of messages) message.agent = taskFor(message.task).agent;
for (const job of jobs) job.agent = taskFor(job.task).agent;
const unreadFor = (id) => messages.filter((message) => message.task === id && message.unread && !message.archived).length;
const status = (task) => ({working:'Working', review:'Awaiting review', ready:'Ready', done:'Complete'}[task.state]);
const badge = (message) => message.unread ? '<span class="unread-label"><span class="unread-dot"></span>Unread</span>' : '<span>Read</span>';

$('#app').innerHTML = `
<div class="demo-banner"><span>Interactive design · sample data · refresh resets examples</span><a href="index.html" target="_top">Compare designs</a></div>
<div class="app-shell">
  <aside class="rail"><a class="brand" href="index.html" target="_top">tuios inbox</a><nav aria-label="Main navigation">
    <button data-view="inbox"><span class="nav-label">${icon('inbox')}Inbox</span><span id="inbox-count" class="mono"></span></button>
    <button data-view="tasks"><span class="nav-label">${icon('tasks')}Tasks</span><span id="task-count" class="mono"></span></button>
    <button data-view="archive"><span class="nav-label">${icon('archive')}Archive</span></button>
  </nav><div class="projects"><p class="muted">Projects</p><button data-project="all" class="active">All projects</button><button data-project="tuios inbox">tuios inbox</button><button data-project="api">api</button></div>
  <div class="rail-foot">Execution belongs to TUIOS.<br>Only finished turns arrive here.<br><span class="mono">Design preview, not connected</span></div></aside>
  <main class="main"><header class="page-header"><div><h1 id="page-title"></h1><p id="page-description"></p></div><button class="primary" data-action="compose">${layout === 'tasks' ? 'New task' : 'New prompt'}</button></header>
  <section class="work-strip" aria-label="Running turns"><div><strong id="working-label"></strong><p class="work-note">No live output. A response arrives when the turn finishes.</p></div><button data-action="finish-demo" id="finish-demo">Finish next demo turn</button></section>
  <div class="workspace"><section class="collection" aria-label="Task and response list"><div class="collection-tools"><label class="sr-only" for="search">Search tasks and responses</label><input id="search" type="search" placeholder="Search tasks and responses"><div class="collection-tabs" id="collection-tabs"></div></div><div id="rows"></div></section>
  <section class="reader" aria-label="Full response and task detail"><div class="reader-toolbar"><div><button class="reader-back" data-action="back">Back to list</button><span id="reader-label"></span></div><div class="actions" id="reader-actions"></div></div><div class="reader-content" id="reader-content"></div></section></div></main>
</div>
<dialog class="compose-dialog" id="compose-dialog"><div class="compose-heading"><h2 id="compose-title">Send a prompt</h2><button data-action="close-compose">Close</button></div><form class="compose-form" id="compose-form"><div class="compose-pair"><label>Task<select id="compose-task" name="task"></select></label><label>Agent<select name="agent" id="compose-agent"><option>Codex</option><option>Claude</option></select></label></div><label id="project-field">Existing project<select name="project"><option>tuios inbox</option><option>api</option></select></label><label>Subject<input name="subject" id="compose-subject" required maxlength="180" placeholder="What should the agent work on?"></label><label>Prompt<textarea name="prompt" id="compose-prompt" rows="6" required placeholder="Describe the work and what you want back."></textarea></label><p id="compose-error" class="design-error" role="alert" hidden></p><div class="compose-footer"><p>This demo adds a working turn. It does not send anything to a real TUIOS pane.</p><button class="primary">Launch demo prompt</button></div></form></dialog>
<div class="toast" id="toast" hidden><p id="toast-text" role="status" aria-live="polite"></p><button id="toast-open" data-action="open-notification" hidden>Open response</button><button class="dismiss" data-action="dismiss" aria-label="Dismiss notification">Close</button></div>`;

function showToast(text, target = null) {
  toastTarget = target;
  $('#toast-text').textContent = text;
  $('#toast-open').hidden = !target;
  $('#toast').hidden = false;
}
function renderCounters() {
  const unread = messages.filter((message) => message.unread && !message.archived).length;
  $('#inbox-count').textContent = unread;
  $('#inbox-count').setAttribute('aria-label', `${unread} unread responses`);
  $('#task-count').textContent = tasks.filter((task) => task.state !== 'done').length;
  $('#working-label').innerHTML = `<span class="working-dot"></span>${jobs.length ? `${jobs.length} ${jobs.length === 1 ? 'turn' : 'turns'} working in TUIOS` : 'No turns working'}`;
  $('#finish-demo').disabled = !jobs.length;
  document.title = `${unread ? `(${unread}) ` : ''}tuios inbox · ${layout === 'tasks' ? 'Task-first' : 'Mail-first'} design`;
  document.querySelectorAll('[data-view]').forEach((button) => {button.classList.toggle('active', button.dataset.view === view);button.setAttribute('aria-pressed', String(button.dataset.view === view));});
}
function mailRow(message) {
  const task = taskFor(message.task);
  return `<button class="mail-row ${message.unread ? 'unread' : ''} ${selectedMessage === message.id ? 'selected' : ''}" data-message="${message.id}" aria-label="${escape(message.subject)}, ${message.unread ? 'unread' : 'read'}"><span class="row-top"><span class="sender">${message.agent} <span class="muted">/ ${escape(task.project)}</span></span><time>${message.time}</time></span><span class="row-title">${escape(message.subject)}</span><span class="row-preview">${escape(message.preview)}</span><span class="row-bottom"><span>${escape(task.title)}</span>${badge(message)}</span></button>`;
}
function taskRow(task) {
  const count = unreadFor(task.id);
  return `<button class="task-row ${selectedTask === task.id ? 'selected' : ''}" data-task="${task.id}" aria-label="${escape(task.title)}, ${status(task)}${count ? `, ${count} unread responses` : ''}"><span class="row-top"><span>${escape(task.project)}</span><span class="status-${task.state}">${status(task)}</span></span><span class="row-title">${escape(task.title)}</span><span class="row-preview">${escape(task.note)}</span><span class="row-bottom"><span>${task.agent} · ${jobs.some((job) => job.task === task.id) ? 'Turn in progress' : 'No turn in progress'}</span>${count ? `<span class="unread-label"><span class="unread-dot"></span>${count} unread</span>` : '<span>All read</span>'}</span></button>`;
}
function renderCollection() {
  renderCounters();
  $('#page-title').textContent = view === 'tasks' ? 'Tasks' : view === 'archive' ? 'Archive' : 'Inbox';
  $('#page-description').textContent = view === 'tasks' ? 'Send work. Review the response. Decide what comes next.' : view === 'archive' ? 'Responses you have put away. Restore them whenever you need.' : 'Finished turns, ready when you are.';
  const options = view === 'tasks' ? [['all','All tasks'],['working','Working'],['review','Awaiting review']] : [['all','All responses'],['unread','Unread']];
  $('#collection-tabs').innerHTML = options.map(([key,label]) => `<button data-filter="${key}" class="${filter === key ? 'active' : ''}" aria-pressed="${filter === key}">${label}</button>`).join('');
  const includes = (task, text) => (project === 'all' || task.project === project) && text.toLowerCase().includes(search.toLowerCase());
  let visible;
  if (view === 'tasks') visible = tasks.filter((task) => (filter === 'all' || task.state === filter) && includes(task, `${task.title} ${task.project} ${task.note}`));
  else visible = messages.filter((message) => !!message.archived === (view === 'archive') && (filter !== 'unread' || message.unread) && includes(taskFor(message.task), `${message.subject} ${message.preview} ${taskFor(message.task).title}`));
  $('#rows').innerHTML = visible.length ? visible.map(view === 'tasks' ? taskRow : mailRow).join('') : `<div class="empty"><h2>${filter === 'unread' ? 'All caught up' : 'No matches'}</h2><p>${filter === 'unread' ? 'New responses will arrive here as unread mail when a turn finishes.' : 'Try another search or filter.'}</p></div>`;
  const replyTask = $('#reply-form')?.dataset.replyTask;
  if (replyTask) $('#reply-form label').textContent = `Follow up with ${taskFor(replyTask).agent}`;
  updateTaskHeader();
}
function envelope(message) {
  const task = taskFor(message.task);
  return `<div class="message-meta"><div class="avatar" aria-hidden="true">${message.agent === 'Codex' ? 'CX' : 'CL'}</div><div><div class="sender-name">${message.agent}</div><p>To you · ${escape(task.project)}</p><p><time>${message.time}</time> · Example agent response</p></div><span class="badge">Turn finished</span></div>${message.capture === 'missing' ? '<div class="capture-note"><strong>The turn finished, but its final response is unavailable.</strong><br>The completion event is not proof of a successful result. This example has no captured answer to read. Do not resend work until you have checked its state in TUIOS.</div>' : `<article class="response" aria-label="Full agent response">${message.body}</article>`}<details class="original-prompt"><summary>Original prompt</summary><p>${escape(message.prompt)}</p></details>`;
}
function replyForm(taskId) {
  const task = taskFor(taskId);
  return `<form class="reply-form" id="reply-form" data-reply-task="${taskId}"><label for="reply-prompt">Follow up with ${task.agent}</label><textarea id="reply-prompt" name="prompt" required rows="3" placeholder="Ask a question or describe the next change…"></textarea><div class="reply-footer"><p>Starts another turn in this task's conversation. The next response arrives unread.</p><button class="primary">Send demo follow-up</button></div><p class="design-error" id="reply-error" hidden role="alert"></p></form>`;
}
function renderReader() {
  const content = $('#reader-content');
  if (view === 'tasks') {
    const task = taskFor(selectedTask);
    $('#reader-label').textContent = `${task.project} / Task`;
    $('#reader-actions').innerHTML = '<button data-action="task-compose">Send prompt</button>';
    content.innerHTML = `<section class="task-overview"><h2>${escape(task.title)}</h2><p>${escape(task.note)}</p><div class="task-properties"><div>Task status<strong id="detail-task-state">${status(task)}</strong></div><div>Agent<strong id="detail-task-agent">${task.agent}</strong></div><div>Execution<strong id="detail-task-execution"></strong></div></div><div class="task-controls"><button data-action="complete-task" id="complete-task">Complete task</button><small id="complete-hint"></small></div></section><div class="thread-heading"><span>Correspondence</span><span>Newest response first</span></div><div id="thread-messages">${messages.filter((message) => message.task === task.id && !message.archived).map(threadMail).join('')}</div><div id="sent-prompts">${jobs.filter((job) => job.task === task.id).map(sentPrompt).join('')}</div>${replyForm(task.id)}`;
    updateTaskHeader();
  } else {
    const message = messages.find((message) => message.id === selectedMessage);
    if (!message || !!message.archived !== (view === 'archive')) {
      $('#reader-label').textContent = 'Reading pane';
      $('#reader-actions').innerHTML = '';
      content.innerHTML = '<div class="empty"><h2>Read a response</h2><p>Select a finished turn from the list. You will see the full answer here, with the original prompt and a follow-up composer.</p></div>';
      return;
    }
    $('#reader-label').textContent = `${taskFor(message.task).project} / Response`;
    readerActions(message);
    content.innerHTML = `<h2>${escape(message.subject)}</h2>${envelope(message)}${replyForm(message.task)}`;
  }
  $('.reader').scrollTop = 0;
}
function readerActions(message) {
  $('#reader-actions').innerHTML = `<button data-action="mark-unread">${message.unread ? 'Mark read' : 'Mark unread'}</button><button data-action="archive">${message.archived ? 'Restore' : 'Archive'}</button>`;
}
function threadMail(message) {
  const selected = message.id === selectedMessage;
  return `<section class="thread-mail ${message.unread ? 'unread' : ''} ${selected ? 'selected' : ''}" data-thread="${message.id}"><button class="thread-open" data-thread-open="${message.id}" aria-expanded="${selected}"><span>${escape(message.subject)}<small>${message.agent} · ${message.time} · Turn finished</small></span>${badge(message)}</button><div class="response-envelope" ${selected ? '' : 'hidden'}>${envelope(message)}<button data-thread-unread="${message.id}">${message.unread ? 'Mark read' : 'Mark unread'}</button></div></section>`;
}
function sentPrompt(job) {
  return `<div class="sent-prompt" data-job="${job.id}">Prompt sent · Turn working in TUIOS<p>${escape(job.prompt)}</p></div>`;
}
function updateTaskHeader() {
  if (view !== 'tasks' || !$('#detail-task-state')) return;
  const task = taskFor(selectedTask);
  const running = jobs.some((job) => job.task === task.id);
  $('#detail-task-state').textContent = status(task);
  $('#detail-task-agent').textContent = task.agent;
  $('#detail-task-execution').textContent = running ? 'Turn working in TUIOS' : 'No turn in progress';
  $('#complete-task').disabled = running || unreadFor(task.id) > 0 || task.state === 'done';
  $('#complete-hint').textContent = running ? 'Wait for the turn to finish.' : unreadFor(task.id) ? 'Read the unread responses before completing this task.' : task.state === 'done' ? 'You marked this task complete.' : 'Turn completion does not complete the task.';
}
function openMessage(id) {
  const message = messages.find((entry) => entry.id === id);
  message.unread = false;
  selectedMessage = id;
  selectedTask = message.task;
  if (view === 'tasks' && !message.archived) {
    renderReader();
  } else {
    view = message.archived ? 'archive' : 'inbox';
    filter = 'all';
    renderReader();
  }
  renderCollection();
  $('.main').classList.add('show-reader');
}
function compose(newTask = false) {
  const select = $('#compose-task');
  select.innerHTML = `<option value="new">Create a new task</option>${tasks.map((task) => `<option value="${task.id}">${escape(task.title)}</option>`).join('')}`;
  select.value = newTask ? 'new' : selectedTask;
  $('#compose-title').textContent = newTask ? 'New task & prompt' : 'Send a prompt';
  $('#compose-agent').value = taskFor(selectedTask).agent;
  $('#project-field').hidden = select.value !== 'new';
  $('#compose-dialog').showModal();
}
function launch(taskId, subject, prompt) {
  const task = taskFor(taskId);
  if (jobs.some((job) => job.task === taskId)) return false;
  task.state = 'working';
  const job = {id:`j${++sequence}`, task:taskId, agent:task.agent, subject, prompt};
  jobs.push(job);
  if (view === 'tasks' && selectedTask === taskId) $('#sent-prompts').insertAdjacentHTML('afterbegin', sentPrompt(job));
  renderCollection();
  showToast(`Prompt accepted for ${task.agent}. The turn is working in this demo; no response has arrived yet.`);
  return true;
}
function finishDemo() {
  if (!jobs.length) return;
  const job = jobs.pop();
  const task = taskFor(job.task);
  task.state = 'review';
  const message = {id:`m${++sequence}`, task:job.task, agent:job.agent, subject:`Re: ${job.subject}`, preview:'The demo turn finished. Open this unread response to review the full answer.', unread:true, time:'Now', capture:'complete', prompt:job.prompt,
    body:`<p>This is the example response for your prompt. No real agent ran this work in the design preview.</p><h3>Your request</h3><p>${escape(job.prompt)}</p><h3>How the completed turn arrives</h3><p>The response appears once the turn finishes. It remains unread until you open it. Arrival does not replace the response you are reading or clear a follow-up draft.</p><pre><code>turn = {
  state: 'finished',
  response: { unread: true, capture: 'complete' },
  task: { state: 'awaiting_review' }
}</code></pre><h3>What you do next</h3><p>Read the response, send a follow-up if you need another change, or mark the task complete after review. This sample does not claim that a real change was made or verified.</p>`};
  messages.unshift(message);
  if (view === 'tasks' && selectedTask === job.task) {
    const reader = $('.reader');
    const scroll = reader.scrollTop;
    $('#thread-messages').insertAdjacentHTML('afterbegin', threadMail(message));
    document.querySelector(`[data-job="${job.id}"]`)?.remove();
    reader.scrollTop = scroll;
  }
  renderCollection();
  showToast(`${task.agent}'s turn finished. ${job.subject} has a new unread response.`, message.id);
}

$('#search').addEventListener('input', (event) => {search = event.target.value;renderCollection();});
$('#compose-task').addEventListener('change', () => {$('#project-field').hidden = $('#compose-task').value !== 'new';});
$('#compose-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const subject = data.get('subject').trim();
  const prompt = data.get('prompt').trim();
  const error = $('#compose-error');
  if (!subject || !prompt) {error.textContent = 'Enter a subject and a prompt.';error.hidden = false;return;}
  let taskId = data.get('task');
  if (taskId === 'new') {
    taskId = `task${++sequence}`;
    tasks.unshift({id:taskId,title:subject,project:data.get('project'),agent:data.get('agent'),state:'ready',note:prompt});
  } else if (jobs.some((job) => job.task === taskId)) {
    error.textContent = 'This task already has a working turn. Finish its demo turn before sending another prompt.';error.hidden = false;return;
  } else taskFor(taskId).agent = data.get('agent');
  launch(taskId, subject, prompt);
  error.hidden = true;
  $('#compose-dialog').close();
  event.currentTarget.reset();
});
$('#app').addEventListener('submit', (event) => {
  if (event.target.id !== 'reply-form') return;
  event.preventDefault();
  const taskId = event.target.dataset.replyTask;
  const prompt = new FormData(event.target).get('prompt').trim();
  if (!prompt) return;
  const accepted = launch(taskId, `Follow-up: ${taskFor(taskId).title}`, prompt);
  $('#reply-error').hidden = accepted;
  if (accepted) event.target.reset();
  else $('#reply-error').textContent = 'A turn is already working on this task. Finish the demo turn before sending this draft.';
});
$('#app').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.view) {
    view = button.dataset.view;filter = 'all';search = '';$('#search').value = '';$('.main').classList.remove('show-reader');renderCollection();renderReader();return;
  }
  if (button.dataset.project) {
    project = button.dataset.project;
    document.querySelectorAll('[data-project]').forEach((item) => item.classList.toggle('active', item === button));
    renderCollection();return;
  }
  if (button.dataset.filter) {filter = button.dataset.filter;renderCollection();return;}
  if (button.dataset.message) {openMessage(button.dataset.message);return;}
  if (button.dataset.task) {
    selectedTask = button.dataset.task;
    selectedMessage = null;
    renderCollection();renderReader();$('.main').classList.add('show-reader');return;
  }
  if (button.dataset.threadOpen) {
    const id = button.dataset.threadOpen;
    const message = messages.find((entry) => entry.id === id);
    const section = button.closest('.thread-mail');
    const expanded = button.getAttribute('aria-expanded') === 'true';
    section.querySelector('.response-envelope').hidden = expanded;
    button.setAttribute('aria-expanded', String(!expanded));
    section.classList.toggle('selected', !expanded);
    if (!expanded) {
      selectedMessage = id;message.unread = false;
      section.classList.remove('unread');
      button.innerHTML = `<span>${escape(message.subject)}<small>${message.agent} · ${message.time} · Turn finished</small></span>${badge(message)}`;
      section.querySelector('[data-thread-unread]').textContent = 'Mark unread';
      renderCollection();
    }
    return;
  }
  if (button.dataset.threadUnread) {
    const message = messages.find((entry) => entry.id === button.dataset.threadUnread);
    message.unread = !message.unread;
    const section = button.closest('.thread-mail');
    section.classList.toggle('unread', message.unread);
    section.querySelector('.thread-open').innerHTML = `<span>${escape(message.subject)}<small>${message.agent} · ${message.time} · Turn finished</small></span>${badge(message)}`;
    button.textContent = message.unread ? 'Mark read' : 'Mark unread';
    renderCollection();return;
  }
  switch (button.dataset.action) {
    case 'compose': compose(layout === 'tasks');break;
    case 'task-compose': compose();break;
    case 'close-compose': $('#compose-dialog').close();break;
    case 'finish-demo': finishDemo();break;
    case 'back': $('.main').classList.remove('show-reader');break;
    case 'dismiss': $('#toast').hidden = true;break;
    case 'open-notification': openMessage(toastTarget);$('#toast').hidden = true;break;
    case 'mark-unread': {
      const message = messages.find((entry) => entry.id === selectedMessage);
      message.unread = !message.unread;readerActions(message);renderCollection();break;
    }
    case 'archive': {
      const message = messages.find((entry) => entry.id === selectedMessage);
      message.archived = !message.archived;renderCollection();renderReader();showToast(message.archived ? 'Response archived. Find it in Archive.' : 'Response restored to Inbox.');break;
    }
    case 'complete-task': taskFor(selectedTask).state = 'done';renderCollection();showToast('You marked this task complete. Its responses remain in the inbox.');break;
  }
});
renderCollection();
renderReader();
