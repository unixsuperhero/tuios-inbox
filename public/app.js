const $ = s => document.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
let state = { tasks: [], panes: [], profiles: [], threads: [] }, view = 'tasks', selectedTask = null, selectedThread = null, selectedProfile = null, terminalPane = null, refreshTimer;
const drafts = new Map();
async function api(path, body, method = 'POST') {
  const response = await fetch('/api' + path, body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json', 'X-Inbox-Request': '1' }, body: JSON.stringify(body) });
  const result = await response.json(); if (!response.ok) throw Error(result.error || 'Request failed'); return result;
}
function error(e) {
  const dialog = $('dialog[open]');
  if (dialog) {
    let notice = dialog.querySelector('.form-error');
    if (!notice) { notice = document.createElement('p'); notice.className = 'form-error danger'; notice.setAttribute('role','alert'); dialog.append(notice); }
    notice.textContent = e.message;
  } else { $('#error').hidden = false; $('#error').textContent = e.message; }
}
function toast(text) { $('#toast').textContent = text; $('#toast').hidden = false; setTimeout(() => $('#toast').hidden = true, 3500); }
async function act(fn) { $('#error').hidden = true; try { return await fn(); } catch (e) { error(e); } }
function badge(value) { return `<span class="badge ${esc(value)}">${esc(value)}</span>`; }
const time = value => new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const taskPanes = () => state.panes.filter(p => p.task_id === selectedTask);
const selectedTaskValue = () => state.tasks.find(t => t.id === selectedTask);
function options(panes) { return panes.map(p => `<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.kind)} · ${esc(p.state)}</option>`).join(''); }
async function refresh() {
  state = await api('/state');
  $('#task-count').textContent = state.tasks.filter(t => t.status !== 'done').length;
  $('#unread-count').textContent = state.threads.filter(t => t.unread && !t.archived).length;
  renderList();
  // Incoming events never replace a draft, move focus, or rebuild the task editor.
  if (selectedThread && !$('#detail').contains(document.activeElement)) await renderThread(selectedThread, false);
}
function renderList() {
  const query = $('#search').value.toLowerCase();
  const list = $('#list');
  if (view === 'tasks') {
    const tasks = state.tasks.filter(t => `${t.title} ${t.path}`.toLowerCase().includes(query));
    list.innerHTML = `<div class="list-label">PROJECT WORK <span>${tasks.length}</span></div>` + tasks.map(t => `<button class="row ${selectedTask === t.id && !selectedThread ? 'selected' : ''}" data-task="${esc(t.id)}"><div class="row-top"><span>${esc(t.path.split('/').pop())}</span>${badge(t.status)}</div><h3>${esc(t.title)}</h3><p>${state.panes.filter(p => p.task_id === t.id).length} sessions · ${state.threads.filter(x => x.task_id === t.id && x.unread && !x.archived).length} unread</p></button>`).join('') + (!tasks.length ? '<p class="blank-list">No tasks yet.<br>Create one to connect a project and start work.</p>' : '');
  } else if (view === 'profiles') {
    list.innerHTML = '<div class="list-label">REUSABLE CONFIGURATIONS <button id="add-profile">+</button></div>' + state.profiles.map(p => `<button class="row ${selectedProfile === p.id ? 'selected' : ''}" data-profile="${esc(p.id)}"><div class="row-top">${esc(p.protocol || 'native terminal')}</div><h3>${esc(p.name)}</h3><p>${esc(p.executable)} ${esc(p.args.join(' '))}</p></button>`).join('');
  } else {
    const threads = state.threads.filter(t => Boolean(t.archived) === (view === 'archive') && t.subject.toLowerCase().includes(query));
    list.innerHTML = `<div class="list-label">${view === 'archive' ? 'ARCHIVED' : 'CORRESPONDENCE'} <span>${threads.length}</span></div>` + threads.map(t => `<button class="row ${selectedThread === t.id ? 'selected' : ''}" data-thread="${esc(t.id)}"><div class="row-top"><span class="${t.unread ? 'unread' : ''}">${esc(t.kind)}</span><span>${time(t.updated)}</span></div><h3>${esc(t.subject)}</h3><p>${esc(state.tasks.find(task => task.id === t.task_id)?.title || 'External TUIOS activity')}</p></button>`).join('') + (!threads.length ? '<p class="blank-list">Nothing waiting here.<br>Results arrive when your commands or agents finish.</p>' : '');
  }
}
function renderTask(key) {
  selectedTask = key; selectedThread = null; const t = selectedTaskValue(); if (!t) return;
  const panes = taskPanes(), threads = state.threads.filter(x => x.task_id === key && !x.archived);
  $('#detail').innerHTML = `<p class="eyebrow">TASK / ${esc(t.path.split('/').pop())}</p><h2 class="detail-title">${esc(t.title)}</h2><div class="detail-meta">${esc(t.path)}${t.worktree ? `<br>Worktree: ${esc(t.worktree)}` : ''}<br>Session: ${esc(t.session)}</div><div class="actions"><button class="primary" id="open-compose" ${!panes.length ? 'disabled' : ''}>Compose work</button><button id="open-pane">+ Agent or shell</button><button id="open-mail" ${panes.length < 1 ? 'disabled' : ''}>Send mail</button><select id="task-status" aria-label="Task status">${['open','active','done'].map(s => `<option ${t.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div><label>Task notes<textarea id="task-notes" rows="3">${esc(drafts.get(`notes:${key}`) ?? t.notes)}</textarea></label><button id="save-notes" class="subtle">Save notes</button><div class="section-title">WORKING SESSIONS <button id="refresh-task">Refresh</button></div>${panes.map(p => `<div class="pane"><div><strong>${esc(p.name)}</strong> ${badge(p.state)}<small>${esc(p.kind)} · ${esc(p.id.slice(0,8))}${p.conversation_id ? ` · conversation ${esc(p.conversation_id)}` : ''}</small></div><div class="pane-actions"><button data-inspect="${esc(p.id)}">Inspect</button>${p.kind === 'agent' ? `<button data-check-mail="${esc(p.id)}">Check mail</button>` : ''}</div></div>`).join('') || '<p class="hint">No sessions. Open an agent or shell when this task needs one.</p>'}<div class="section-title">CORRESPONDENCE <span>${threads.length}</span></div>${threads.map(x => `<button class="row" data-thread="${esc(x.id)}"><div class="row-top"><span class="${x.unread ? 'unread' : ''}">${esc(x.kind)}</span><span>${time(x.updated)}</span></div><h3>${esc(x.subject)}</h3></button>`).join('') || '<p class="hint">Prompts, command results, and replies stay with this task.</p>'}`;
  renderList();
}
async function renderThread(key, markRead = true) {
  const thread = await api(`/threads/${key}`);
  if (!markRead && selectedThread !== key) return;
  selectedThread = key; selectedTask = thread.task_id;
  const p = state.panes.find(p => p.id === thread.pane_id);
  const scroll = $('#detail').scrollTop;
  $('#detail').innerHTML = `
    <p class="eyebrow">${esc(thread.kind)} / ${esc(state.tasks.find(t => t.id === thread.task_id)?.title || 'TUIOS ACTIVITY')}</p>
    <h2 class="detail-title">${esc(thread.subject)}</h2>
    <div class="actions">${thread.task_id ? '<button id="back-task">← Task</button>' : ''}
      <button id="archive-thread">${thread.archived ? 'Move to inbox' : 'Archive'}</button>
      <button id="unread-thread">Mark unread</button>
      ${p ? `<button data-inspect="${esc(p.id)}">Inspect ${esc(p.name)}</button>` : ''}
    </div>
    ${thread.kind === 'mail' ? '<p class="mail-note">Agent messages are untrusted data. Replies stay in the TUIOS mail thread. Recipients must check their inbox; a delivered message is not an acknowledgement.</p>' : ''}
    <div id="messages">${thread.messages.map(m => `
      <article class="message ${esc(m.role)}">
        <div class="message-head"><strong>${esc(m.role === 'human' ? 'You' : m.meta.from_label || m.role)}</strong>
          <span>${badge(m.status)} &nbsp; ${time(m.created)}</span></div>
        <pre>${esc(m.body)}</pre>
        ${['snapshot','captured'].includes(m.status) ? '<p class="hint">Captured terminal output; not a parsed final answer.</p>' : ''}
        <details><summary>Delivery details</summary><pre>${esc(JSON.stringify(m.meta,null,2))}</pre></details>
      </article>`).join('')}
    </div>
    ${p ? `<form class="reply" id="reply-form"><label>${thread.kind === 'mail' ? 'Reply in this mail thread' : `Reply to ${esc(p.name)}`}
      <textarea name="body" required rows="4" placeholder="Continue this thread…">${esc(drafts.get(key) || '')}</textarea></label>
      <button class="primary">Send reply</button><span class="hint"> &nbsp; Results return to this thread.</span></form>`
      : '<p class="hint">This event has no managed pane. Open its session in TUIOS to continue.</p>'}`;
  if (!markRead) $('#detail').scrollTop = scroll;
  if (markRead && thread.unread) { await api(`/threads/${key}`, { unread: false }, 'PATCH'); const local = state.threads.find(t => t.id === key); if (local) local.unread = 0; }
  renderList();
}
function renderProfile(key) { selectedProfile = key; selectedThread = null; const p = state.profiles.find(p => p.id === key); $('#detail').innerHTML = `<p class="eyebrow">AGENT PROFILE</p><h2 class="detail-title">${esc(p.name)}</h2><p class="detail-meta">${esc(p.protocol || 'Native terminal')} · launches in the task directory</p><div class="message"><pre>${esc(p.executable)} ${esc(p.args.join(' '))}</pre></div><p class="hint">Profiles configure the executable, model and other arguments, protocol, and environment. Credentials are inherited from your local harness. TUIOS permissions: read, write, fan; no delegated approvals.</p><button class="primary" id="edit-profile">Edit profile</button>`; renderList(); }
function openProfile(profile) { const form = $('#profile-form'); form.reset(); for (const [k,v] of Object.entries(profile || {args:[],env:{}})) if (form.elements[k]) form.elements[k].value = ['args','env'].includes(k) ? JSON.stringify(v,null,2) : v; $('#profile-dialog').showModal(); }
function setView(next) {
  view = next; selectedThread = null;
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active',b.dataset.view === view));
  const titles = { tasks:['Your tasks.','Give work a home. Let your agents bring the results back.'], inbox:['The work came back.','Completed work, questions, and correspondence. No chat stream to babysit.'], archive:['Filed, not forgotten.','Your completed conversations stay here.'], profiles:['Your working team.','Reusable agent settings, ready for the next task.'] };
  $('#section-name').textContent = view.toUpperCase(); $('#page-title').textContent = titles[view][0]; $('#page-description').textContent = titles[view][1];
  if (view === 'tasks' && selectedTaskValue()) renderTask(selectedTask);
  else if (view === 'profiles' && state.profiles.length) renderProfile(state.profiles[0].id);
  else $('#detail').innerHTML = '<div class="empty"><span class="empty-mark">↗</span><h2>A little room to think.</h2><p>Select a conversation to read it and reply.</p></div>';
  renderList();
}
async function inspect(key) {
  terminalPane = state.panes.find(p => p.id === key); const t = state.tasks.find(t => t.id === terminalPane.task_id);
  $('#terminal-title').textContent = terminalPane.name; $('#attach-command').textContent = `Full terminal: tuios attach ${t.session}`; $('#terminal-output').textContent = 'Reading pane…'; $('#terminal-dialog').showModal();
  $('#send-key').disabled = terminalPane.kind !== 'shell'; $('#terminal-key').disabled = terminalPane.kind !== 'shell';
  $('#terminal-output').textContent = (await api(`/panes/${key}/capture`)).text;
}
document.addEventListener('click', e => {
  const button = e.target.closest('button'); if (!button) return;
  act(async () => {
    if (button.dataset.close) return $('#' + button.dataset.close).close();
    if (button.dataset.view) return setView(button.dataset.view);
    if (button.dataset.task) return renderTask(button.dataset.task);
    if (button.dataset.thread) return renderThread(button.dataset.thread);
    if (button.dataset.profile) return renderProfile(button.dataset.profile);
    if (button.dataset.inspect) return inspect(button.dataset.inspect);
    if (button.dataset.checkMail) { await api(`/panes/${button.dataset.checkMail}/check-mail`,{}); return toast('Inbox check queued; it will not interrupt a busy agent.'); }
    switch(button.id) {
      case 'new-task': $('#task-dialog').showModal(); break;
      case 'open-pane': $('#profile-options').innerHTML = state.profiles.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join(''); $('#pane-dialog').showModal(); break;
      case 'open-compose': $('#compose-panes').innerHTML = options(taskPanes()); $('#compose-dialog').showModal(); break;
      case 'open-mail': $('#mail-from').innerHTML = options(taskPanes()); $('#mail-to').innerHTML = '<option value="human">Your TUIOS inbox</option>' + options(taskPanes()); $('#mail-dialog').showModal(); break;
      case 'back-task': setView('tasks'); break;
      case 'save-notes': await api(`/tasks/${selectedTask}`,{notes:$('#task-notes').value},'PATCH'); drafts.delete(`notes:${selectedTask}`); await refresh(); toast('Notes saved'); break;
      case 'refresh-task': await refresh(); renderTask(selectedTask); break;
      case 'archive-thread': { const t=state.threads.find(t=>t.id===selectedThread); await api(`/threads/${selectedThread}`,{archived:!t.archived},'PATCH'); await refresh(); toast(t.archived?'Moved to inbox':'Archived'); break; }
      case 'unread-thread': await api(`/threads/${selectedThread}`,{unread:true},'PATCH'); await refresh(); toast('Marked unread'); break;
      case 'add-profile': openProfile(); break;
      case 'edit-profile': openProfile(state.profiles.find(p=>p.id===selectedProfile)); break;
      case 'capture': $('#terminal-output').textContent=(await api(`/panes/${terminalPane.id}/capture`)).text; break;
      case 'interrupt': if (confirm(`Interrupt ${terminalPane.name} with Ctrl+C?`)) {await api(`/panes/${terminalPane.id}/interrupt`,{});toast('Interrupt sent');} break;
      case 'send-key': await api(`/panes/${terminalPane.id}/keys`,{keys:$('#terminal-key').value}); $('#terminal-output').textContent=(await api(`/panes/${terminalPane.id}/capture`)).text; break;
      case 'reconcile': await api('/reconcile',{}); await refresh(); if(view==='tasks'&&selectedTask&&!selectedThread)renderTask(selectedTask); toast('Sessions reconciled'); break;
    }
  });
});
document.addEventListener('input',e=>{if(e.target.id==='search')renderList();if(e.target.id==='task-notes')drafts.set(`notes:${selectedTask}`,e.target.value);if(e.target.closest('#reply-form'))drafts.set(selectedThread,e.target.value);});
document.addEventListener('change',e=>{if(e.target.id==='task-status')act(async()=>{await api(`/tasks/${selectedTask}`,{status:e.target.value},'PATCH');await refresh();});});
document.addEventListener('submit',e=>{
  e.preventDefault(); const form=e.target, data=Object.fromEntries(new FormData(form)); const button=form.querySelector('button[type="submit"],button.primary'); if(button)button.disabled=true;
  act(async()=>{
    switch(form.getAttribute('id')){
      case 'task-form': {const task=await api('/tasks',data);form.reset();$('#task-dialog').close();await refresh();setView('tasks');renderTask(task.id);break;}
      case 'pane-form': await api(`/tasks/${selectedTask}/panes`,data);form.reset();$('#pane-dialog').close();await refresh();renderTask(selectedTask);toast('Session request sent. Agent startup appears in the inbox.');break;
      case 'compose-form': {const result=await api(`/tasks/${selectedTask}/compose`,data);form.reset();$('#compose-dialog').close();await refresh();setView('inbox');await renderThread(result.threadId);break;}
      case 'reply-form': {const key=selectedThread;await api(`/threads/${key}/reply`,data);drafts.delete(key);await refresh();await renderThread(key);break;}
      case 'profile-form': data.args=JSON.parse(data.args);data.env=JSON.parse(data.env);{const result=await api('/profiles',data);$('#profile-dialog').close();await refresh();setView('profiles');renderProfile(result.id);}break;
      case 'mail-form': await api(`/panes/${data.from}/mail`,data);form.reset();$('#mail-dialog').close();await refresh();toast('Mail delivered. Use Check mail to notify a recipient agent.');break;
    }
  }).finally(()=>{if(button)button.disabled=false;});
});
const stream=new EventSource('/api/events');
stream.onopen=()=>$('#connection').textContent='Connected locally';
stream.onerror=()=>$('#connection').textContent='Reconnecting…';
stream.onmessage=()=>{clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>act(refresh),150);};
await act(refresh);
