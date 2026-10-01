// One config per page: which rows it lists, their fields, the row summary, the details and the bulk actions.
// app.js mounts `list` with createList and handles the data-do / data-set controls the details contain.
export const store = { state: { tasks: [], panes: [], profiles: [], agents: [], items: [] }, drafts: new Map(), bodies: new Map() };
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export async function api(path, body, method = 'POST') {
  const response = await fetch('/api' + path, body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json', 'X-Inbox-Request': '1' }, body: JSON.stringify(body) });
  const result = await response.json(); if (!response.ok) throw Error(result.error || 'Request failed'); return result;
}
const badge = value => value ? `<span class="badge ${esc(value)}">${esc(value)}</span>` : '';
const time = value => value ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
// A pane's name is its title, which harnesses prefix with a spinner glyph (oh-my-pi also with "π"). Shells have no name.
export const agentName = (name, key) => String(name || '').replace(/^(π\s+)?[^\p{L}\p{N}]*/u, '') || `pane ${key.slice(0, 8)}`;
const hint = text => `<p class="hint">${text}</p>`;
const taskOptions = () => store.state.tasks.map(t => ({ value: t.id, label: t.title }));
const taskChoices = () => [{ value: '', label: 'No task' }, ...taskOptions()];
const taskTag = key => { const t = store.state.tasks.find(t => t.id === key); return t ? ` <span class="tag">${esc(t.title)}</span>` : ''; };
const select = (set, key, current, choices, label) => `<label>${label}<select data-set="${set}" data-id="${esc(key)}">${choices.map(o => `<option value="${esc(o.value)}"${o.value === (current ?? '') ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>`;
const update = (path, set) => ids => api(path, { ids, set });
const assign = path => ({ id: 'task', label: 'Assign to task', options: taskChoices, run: (ids, value) => api(path, { ids, set: { task_id: value || null } }) });
const archivedField = { key: 'archived', label: 'Archived', type: 'bool', filter: true, sort: true };
const notArchived = [{ key: 'archived', op: 'is', value: 'false' }];
const archiveActions = path => [{ id: 'archive', label: 'Archive', run: update(path, { archived: true }) }, { id: 'unarchive', label: 'Unarchive', run: update(path, { archived: false }) }];
const archiveButton = (name, row) => `<button data-do="${name}" data-id="${esc(row.id)}" data-value="${row.archived ? '' : '1'}">${row.archived ? 'Unarchive' : 'Archive'}</button>`;
const archivedTag = row => row.archived ? ' <span class="tag">archived</span>' : '';
const liveAgent = key => store.state.agents.find(a => a.id === key && a.state !== 'closed');
const taskField = { key: 'task_id', label: 'Task', type: 'enum', options: taskOptions, filter: true, sort: true, search: true };

// ---- Items: agent turns, finished commands, mail, notices (Inbox, Turns, Archive) ----
const typeLabels = { turn: 'Agent turn', command: 'Command', mail: 'Mail', system: 'Notice', dispatch: 'Sent from Dispatch', snapshot: 'Pane snapshot' };
const waiting = { working: 'Still working. The reply appears here when the turn ends.', needs_input: 'Waiting for your answer in the pane.', idle: 'The agent went idle without finishing this turn, so there is no reply.' };
const turnNotes = { summary: 'Only the one-line TUIOS_AGENT_MESSAGE summary was available for this turn.', pane: 'Read from the pane transcript, so tool activity is included.' };
/** A turn that has no reply to load yet. */
export const unfinished = row => row.type === 'turn' && row.status in waiting;
const itemFields = [
  { key: 'type', label: 'Type', type: 'enum', options: () => Object.entries(typeLabels).map(([value, label]) => ({ value, label })), filter: true, sort: true, search: true },
  { key: 'status', label: 'Status', type: 'enum', filter: true, sort: true },
  taskField,
  { key: 'agent_id', label: 'Agent', type: 'enum', options: rows => [...new Map(rows.filter(r => r.agent_id).map(r => [r.agent_id, agentName(r.agent_name, r.agent_id)]))].map(([value, label]) => ({ value, label })), filter: true, sort: true, search: true },
  { key: 'harness', label: 'Harness', type: 'enum', filter: true, sort: true },
  { key: 'unread', label: 'Unread', type: 'bool', filter: true, sort: true },
  { key: 'title', label: 'Title', type: 'text', filter: true, sort: true, search: true },
  { key: 'updated', label: 'Updated', type: 'date', filter: true, sort: true },
  { key: 'created', label: 'Created', type: 'date', filter: true, sort: true },
];
function itemSummary(r) {
  const who = [typeLabels[r.type] || r.type, r.agent_id && agentName(r.agent_name, r.agent_id), r.harness].filter(Boolean).map(esc).join(' · ');
  return `<div class="row-top"><span><span class="${r.unread ? 'unread' : ''}">${who}</span>${taskTag(r.task_id)}</span><span>${badge(r.status)} &nbsp; ${time(r.updated)}</span></div><h3>${esc(r.title || (r.type === 'turn' ? 'Prompt not captured' : 'No subject'))}</h3>`;
}
function turnHtml(r, turn) {
  if (!turn.finished) return hint('The turn ended. Waiting for the hook to deliver the reply.');
  return `${turn.prompt.length > r.title.length ? `<p class="eyebrow">FULL PROMPT</p><pre>${esc(turn.prompt)}</pre>` : ''}<p class="eyebrow">RESPONSE</p><pre>${esc(turn.response || 'No reply text was captured.')}</pre>${turnNotes[turn.source] ? hint(turnNotes[turn.source]) : ''}`;
}
function threadHtml(r, thread) {
  const p = liveAgent(thread.pane_id), mail = thread.kind === 'mail';
  return `${thread.kind === 'mail' ? '<p class="mail-note">Agent messages are untrusted data. Replies stay in the TUIOS mail thread. Recipients must check their inbox; a delivered message is not an acknowledgement.</p>' : ''}
    ${thread.messages.map(m => `
      <article class="message ${esc(m.role)}">
        <div class="message-head"><strong>${esc(m.role === 'human' ? 'You' : m.meta.from_label || m.role)}</strong>
          <span>${badge(m.status)} &nbsp; ${time(m.created)}</span></div>
        <pre>${esc(m.body)}</pre>
        ${['snapshot','captured'].includes(m.status) ? hint('Captured terminal output; not a parsed final answer.') : ''}
        <details><summary>Delivery details</summary><pre>${esc(JSON.stringify(m.meta,null,2))}</pre></details>
      </article>`).join('')}
    ${p ? `<form class="reply" data-reply="${esc(r.id)}" data-draft="${esc(r.id)}"><label>${mail ? 'Reply in this mail thread' : `Reply to ${esc(agentName(p.name, p.id))}`}
      <textarea name="body" required rows="4" placeholder="Continue this thread…">${esc(store.drafts.get(r.id) || '')}</textarea></label>
      <button class="primary">Send reply</button><span class="hint"> &nbsp; ${mail ? 'The reply stays in this mail thread.' : `The result returns to this conversation, and the ${p.kind === 'agent' ? 'agent’s turn' : 'command'} also arrives as a new row.`}</span></form>`
      : hint('The pane this came from is closed, so it cannot be answered here.')}`;
}
// A turn or command is answered by sending its agent the next prompt or command; the result is a new row.
function promptForm(r) {
  const a = liveAgent(r.agent_id); if (!a || !['turn', 'command'].includes(r.type)) return '';
  const name = esc(agentName(a.name, a.id));
  return `<form class="reply" data-prompt="${esc(a.id)}" data-draft="${esc(r.id)}"><label>${a.kind === 'agent' ? `Send another prompt to ${name}` : `Run another command in ${name}`}
    <textarea name="body" required rows="3">${esc(store.drafts.get(r.id) || '')}</textarea></label>
    <button class="primary">Send</button><span class="hint"> &nbsp; ${a.kind === 'agent' ? 'It is typed when the agent is at rest. The reply' : 'The result'} arrives as a new row in the Inbox.</span></form>`;
}
function itemDetail(r) {
  const agent = store.state.agents.find(a => a.id === r.agent_id), pane = store.state.panes.find(p => p.id === r.agent_id), cached = store.bodies.get(r.id);
  const body = unfinished(r) ? hint(waiting[r.status])
    : !cached ? hint('Loading…')
    : cached.error ? `<p class="hint danger">Could not load this item: ${esc(cached.error)}</p>`
    : r.type === 'turn' ? turnHtml(r, cached.data) : threadHtml(r, cached.data);
  return `<div class="props">${select('item-task', r.id, r.task_id, taskChoices(), 'Task')}${agent ? select('agent-task', agent.id, agent.task_id, taskChoices(), 'Agent’s task') : ''}
    <button data-do="unread" data-id="${esc(r.id)}" data-value="${r.unread ? '' : '1'}">${r.unread ? 'Mark read' : 'Mark unread'}</button>
    <button data-do="archive" data-id="${esc(r.id)}" data-value="${r.archived ? '' : '1'}">${r.archived ? 'Move to inbox' : 'Archive'}</button>
    ${pane ? `<button data-do="inspect" data-id="${esc(pane.id)}">Inspect ${esc(pane.name)}</button>` : ''}</div>
    ${agent ? hint(`“Agent’s task” assigns the whole agent (${esc(agentName(agent.name, agent.id))}): its other turns and commands move too, and new ones follow.`) : ''}${body}${unfinished(r) ? '' : promptForm(r)}`;
}
const itemActions = archived => [
  { id: 'read', label: 'Mark read', run: update('/items/update', { unread: false }) },
  { id: 'unread', label: 'Mark unread', run: update('/items/update', { unread: true }) },
  archived ? { id: 'unarchive', label: 'Move to inbox', run: update('/items/update', { archived: false }) } : { id: 'archive', label: 'Archive', run: update('/items/update', { archived: true }) },
  assign('/items/update'),
];
const itemList = (storageKey, fields, archived, empty) => ({
  storageKey, fields, defaultQuery: { sort: { key: 'updated', dir: 'desc' } },
  rowId: r => r.id, rowClass: r => r.unread ? 'is-unread' : '', summary: itemSummary, detail: itemDetail, actions: itemActions(archived),
  empty: `${empty}<br>If you expected rows here, check the search and filters above.`,
});

// ---- Tasks ----
const statuses = ['open', 'active', 'done'].map(s => ({ value: s, label: s }));
const basename = path => path.split('/').filter(Boolean).pop() || path;
function taskDetail(t) {
  const { panes, agents } = store.state, mine = panes.filter(p => p.task_id === t.id);
  // Compose reaches any agent assigned here; mail only moves between panes this task opened. Say so instead of leaving a dead button.
  const needsAgent = agents.some(a => a.task_id === t.id && a.state !== 'closed' && !a.archived) ? '' : 'disabled title="Open an agent or shell here, or assign one on the Agents page, first"';
  const needsPane = mine.length ? '' : 'disabled title="Open an agent or shell in this task first"';
  const members = [...mine.map(p => ({ ...p, pane: true })), ...agents.filter(a => a.task_id === t.id && !mine.some(p => p.id === a.id))];
  return `<div class="props"><label class="grow">Title<input data-set="task-title" data-id="${esc(t.id)}" value="${esc(t.title)}" maxlength="200"></label>${select('task-status', t.id, t.status, statuses, 'Status')}</div>
    <div class="detail-meta">Path: ${esc(t.path)}${t.worktree ? `<br>Worktree: ${esc(t.worktree)}` : ''}<br>TUIOS session: ${esc(t.session)}</div>
    <div class="actions"><button class="primary" data-do="compose" data-id="${esc(t.id)}" ${needsAgent}>Compose work</button><button data-do="open-pane" data-id="${esc(t.id)}">+ Agent or shell</button><button data-do="open-mail" data-id="${esc(t.id)}" ${needsPane}>Send mail</button><button data-do="show-items" data-key="task_id" data-id="${esc(t.id)}">Show its items</button>${archiveButton('task-archive', t)}</div>
    <label>Task notes<textarea data-notes="${esc(t.id)}" rows="3">${esc(store.drafts.get(`notes:${t.id}`) ?? t.notes)}</textarea></label><button data-do="save-notes" data-id="${esc(t.id)}" class="subtle">Save notes</button>
    <div class="section-title">AGENTS AND SHELLS <span>${members.length}</span></div>
    ${members.map(m => `<div class="pane"><div><strong>${esc(agentName(m.name, m.id))}</strong> ${badge(m.state)}<small>${esc(m.kind)}${m.harness ? ` · ${esc(m.harness)}` : ''} · ${esc(m.id.slice(0,8))}${m.conversation_id ? ` · conversation ${esc(m.conversation_id)}` : ''}</small></div><div class="pane-actions">${m.pane ? `<button data-do="inspect" data-id="${esc(m.id)}">Inspect</button>${m.kind === 'agent' ? `<button data-do="check-mail" data-id="${esc(m.id)}">Check mail</button>` : ''}` : ''}</div></div>`).join('') || hint('None yet. Use "+ Agent or shell" to open one here, or assign an agent already running in TUIOS on the Agents page.')}`;
}

// ---- Agent profiles ----
const protocols = [{ value: 'native', label: 'Native terminal' }, { value: 'codex', label: 'Codex app-server' }, { value: 'acp', label: 'ACP' }];
const protocol = p => p.protocol || 'native';

export const pages = {
  inbox: {
    title: 'Inbox', items: true,
    description: 'What your agents and shells sent back: agent turns, finished commands and mail. Highlighted rows are unread. Open a row to read it.',
    rows: () => store.state.items.filter(i => !i.archived),
    list: itemList('inbox', itemFields, false, 'Nothing here. A row appears when an agent gets a prompt, a shell command finishes, or mail arrives.'),
  },
  turns: {
    title: 'Turns', items: true,
    description: 'Every prompt an agent in TUIOS received. Open a row to read the reply. Highlighted rows are unread.',
    rows: () => store.state.items.filter(i => i.type === 'turn' && !i.archived),
    list: itemList('turns', itemFields.filter(f => f.key !== 'type'), false, 'No turns. A row appears when an agent in TUIOS receives a prompt.'),
  },
  tasks: {
    title: 'Tasks',
    description: 'A task groups the agents, turns, commands and mail for one piece of work.',
    rows: () => store.state.tasks.map(t => ({ ...t,
      unread_count: store.state.items.filter(i => i.task_id === t.id && i.unread && !i.archived).length,
      agent_count: store.state.agents.filter(a => a.task_id === t.id).length })),
    list: {
      storageKey: 'tasks.v2', defaultQuery: { sort: { key: 'created', dir: 'desc' }, filters: notArchived },
      fields: [
        { key: 'status', label: 'Status', type: 'enum', options: () => statuses, filter: true, sort: true },
        { key: 'title', label: 'Title', type: 'text', filter: true, sort: true, search: true },
        { key: 'path', label: 'Path', type: 'text', filter: true, sort: true, search: true },
        { key: 'created', label: 'Created', type: 'date', filter: true, sort: true },
        archivedField,
        { key: 'unread_count', label: 'Unread items', type: 'number', filter: true, sort: true },
        { key: 'agent_count', label: 'Agents', type: 'number', filter: true, sort: true },
      ],
      rowId: t => t.id,
      summary: t => `<div class="row-top"><span>${esc(basename(t.path))} · ${t.agent_count} ${t.agent_count === 1 ? 'agent' : 'agents'} · ${t.unread_count} unread${archivedTag(t)}</span><span>${badge(t.status)} &nbsp; ${time(t.created)}</span></div><h3>${esc(t.title)}</h3>`,
      detail: taskDetail,
      actions: [{ id: 'status', label: 'Set status', options: () => statuses, run: (ids, status) => api('/tasks/update', { ids, set: { status } }) }, ...archiveActions('/tasks/update')],
      empty: 'No tasks to show.<br>Create one with “+ New task”, then assign agents to it.',
    },
  },
  agents: {
    title: 'Agents',
    description: 'Every TUIOS pane seen so far. Assign an agent to a task and its turns and commands go to that task.',
    rows: () => store.state.agents,
    list: {
      storageKey: 'agents.v2', defaultQuery: { sort: { key: 'seen', dir: 'desc' }, filters: notArchived },
      fields: [
        { key: 'kind', label: 'Kind', type: 'enum', filter: true, sort: true },
        { key: 'harness', label: 'Harness', type: 'enum', filter: true, sort: true },
        { key: 'state', label: 'State', type: 'enum', filter: true, sort: true },
        taskField,
        { key: 'session', label: 'Session', type: 'enum', filter: true, sort: true, search: true },
        { key: 'name', label: 'Name', type: 'text', filter: true, sort: true, search: true },
        { key: 'seen', label: 'Last seen', type: 'date', filter: true, sort: true },
        archivedField,
      ],
      rowId: a => a.id,
      summary: a => `<div class="row-top"><span>${[a.kind, a.harness, a.session && `session ${a.session}`].filter(Boolean).map(esc).join(' · ')}${taskTag(a.task_id)}${archivedTag(a)}</span><span>${badge(a.state)} &nbsp; ${time(a.seen)}</span></div><h3>${esc(agentName(a.name, a.id))}</h3>`,
      detail: a => `<div class="props">${select('agent-task', a.id, a.task_id, taskChoices(), 'Task')}<button data-do="show-items" data-key="agent_id" data-id="${esc(a.id)}">Show its items</button>${archiveButton('agent-archive', a)}</div>
        ${hint('Turns and commands from this agent go to this task: the ones it already has and every new one. Items you moved to another task by hand stay there.')}
        <div class="detail-meta">Pane id: ${esc(a.id)}</div>`,
      actions: [assign('/agents/update'), ...archiveActions('/agents/update')],
      empty: 'No agents to show.<br>A row appears when a pane in TUIOS reports an agent or runs a command.',
    },
  },
  archive: {
    title: 'Archive', items: true,
    description: 'Items you archived. Nothing is deleted; move a row back to the inbox at any time.',
    rows: () => store.state.items.filter(i => i.archived),
    list: itemList('archive', itemFields, true, 'Nothing archived.'),
  },
  profiles: {
    title: 'Agent profiles',
    description: 'Saved launch settings: the program and arguments used when you open a new agent from a task.',
    rows: () => store.state.profiles,
    list: {
      storageKey: 'profiles', defaultQuery: { sort: { key: 'name', dir: 'asc' } },
      fields: [
        { key: 'protocol', label: 'Protocol', type: 'enum', get: protocol, options: () => protocols, filter: true, sort: true },
        { key: 'name', label: 'Name', type: 'text', filter: true, sort: true, search: true },
        { key: 'executable', label: 'Executable', type: 'text', filter: true, sort: true, search: true },
      ],
      rowId: p => p.id,
      summary: p => `<div class="row-top"><span>${esc(protocols.find(o => o.value === protocol(p)).label)}</span></div><h3>${esc(p.name)}</h3>`,
      detail: p => `<div class="message"><pre>${esc(p.executable)} ${esc(p.args.join(' '))}</pre></div>
        ${hint('Launches in the task directory. Profiles configure the executable, model and other arguments, protocol, and environment. Credentials are inherited from your local harness. TUIOS permissions: read, write, fan; no delegated approvals.')}
        <div class="actions"><button class="primary" data-do="edit-profile" data-id="${esc(p.id)}">Edit profile</button></div>`,
      actions: [{ id: 'delete', label: 'Delete', danger: true, run: async ids => { if (confirm(`Delete ${ids.length === 1 ? 'this profile' : `these ${ids.length} profiles`}?`)) await api('/profiles/delete', { ids }); } }],
      empty: 'No profiles to show.<br>Use “Add profile” to create one.',
    },
  },
};
