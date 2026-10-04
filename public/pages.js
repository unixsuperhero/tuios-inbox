// Page schemas and record markup; app.js owns navigation, dialogs and delegated actions.
import { markdown } from '/markdown.js';
export const store = { state: { tasks: [], panes: [], profiles: [], agents: [], items: [] }, drafts: new Map(), bodies: new Map(), questions: new Map() };
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
const createChoice = (kind, taskId) => ({ owner } = {}) => store.createEntity({ kind, taskId, owner });
const newChoice = kind => ({ value: `__new_${kind}`, label: `New ${kind[0].toUpperCase() + kind.slice(1)}…`, createKind: kind });
/**
 * Orders tasks as a tree for every list that shows them: the workbench rail, the Queues rail, and
 * the task selects. Returns the same task objects, each with a `depth` (0 for a root), in the order
 * they should be displayed.
 * @param {object[]} tasks - rows from store.state.tasks (each has id, parent_id, title, created, archived)
 * @returns {Array<object & {depth: number}>}
 */
export function taskTree(tasks = store.state.tasks) {
  // TODO(human): order the tasks depth-first so each subtask follows its parent, and set `depth`.
  // Things to decide: how siblings are ordered (created, title, status?), what to do with a task whose
  // parent is missing or archived (promote it to a root, or hide it?), and guarding against a cycle
  // in the data so this never loops. The placeholder below keeps everything flat and working.
  return tasks.map(t => ({ ...t, depth: 0 }));
}
const indent = depth => '\u2014 '.repeat(depth);
const taskOptions = (exclude = null) => taskTree().filter(t => !exclude || !exclude.has(t.id)).map(t => ({ value: t.id, label: indent(t.depth) + t.title }));
/** A task and everything beneath it, which is what it may not be moved under. */
export const subtree = id => { const found = new Set([id]); let grew = true; while (grew) { grew = false; for (const t of store.state.tasks) if (t.parent_id && found.has(t.parent_id) && !found.has(t.id)) { found.add(t.id); grew = true; } } return found; };
const taskChoices = () => [{ value: '', label: 'No task' }, ...taskOptions(), newChoice('task')];
const taskHref = id => `#task/${encodeURIComponent(id)}`;
const agentHref = id => `#agent/${encodeURIComponent(id)}`;
const taskTag = key => { const t = store.state.tasks.find(t => t.id === key); return t ? `<a class="tag" href="${taskHref(t.id)}">${esc(t.title)}</a>` : ''; };
const select = (set, key, current, choices, label) => `<label>${label}<select data-set="${set}" data-id="${esc(key)}"${choices.some(o => o.createKind) ? ' data-create-kind="task"' : ''}>${choices.map(o => `<option value="${esc(o.value)}"${o.value === (current ?? '') ? ' selected' : ''}${o.createKind ? ` data-create-kind="${o.createKind}"` : ''}>${esc(o.label)}</option>`).join('')}</select></label>`;
const update = (path, set) => ids => api(path, { ids, set });
const assign = path => ({ id: 'task', label: 'Assign to task', options: () => [{ value: '', label: 'No task' }, ...taskOptions()], createOption: createChoice('task'), createLabel: 'New Task…', run: (ids, value) => api(path, { ids, set: { task_id: value || null } }) });
const archivedField = { key: 'archived', label: 'Archived', type: 'bool', filter: true, sort: true };
const notArchived = [{ key: 'archived', op: 'is', value: 'false' }];
const archiveActions = path => [{ id: 'archive', label: 'Archive', run: update(path, { archived: true }) }, { id: 'unarchive', label: 'Unarchive', run: update(path, { archived: false }) }];
const archiveButton = (name, row) => `<button data-do="${name}" data-id="${esc(row.id)}" data-value="${row.archived ? '' : '1'}">${row.archived ? 'Unarchive' : 'Archive'}</button>`;
const archivedTag = row => row.archived ? ' <span class="tag">archived</span>' : '';
const liveAgent = key => store.state.agents.find(a => a.id === key && a.state !== 'closed');
const taskField = { key: 'task_id', label: 'Task', type: 'enum', options: taskOptions, createOption: createChoice('task'), createLabel: 'New Task…', filter: true, sort: true, search: true };

export function recipients(context = {}) {
  const { agents, panes } = store.state;
  const source = context.mail
    ? panes.filter(p => context.taskId == null || p.task_id === context.taskId)
    : agents.filter(a => a.state !== 'closed' && !a.archived && (context.taskId == null || a.task_id === context.taskId))
      .map(a => ({ ...panes.find(p => p.id === a.id), ...a }));
  return [...new Map(source.map(row => {
    const kind = row.kind === 'agent' ? 'agent' : 'pane';
    return [row.id, {
      ...row, value: row.id, kind, taskId: row.task_id,
      label: [agentName(row.name, row.id), kind === 'agent' ? 'Agent' : 'Pane', row.state].filter(Boolean).join(' · '),
    }];
  })).values()];
}

const recipientField = taskId => ({
  key: 'agent_id', label: 'Agent / pane', type: 'enum',
  options: rows => [...new Map([
    ...rows.filter(r => r.agent_id).map(r => [r.agent_id, { value: r.agent_id, label: agentName(r.agent_name, r.agent_id) }]),
    ...recipients({ taskId }).map(r => [r.value, r]),
  ]).values()],
  createOptions: [
    { label: 'New Agent…', create: createChoice('agent', taskId) },
    { label: 'New Pane…', create: createChoice('pane', taskId) },
  ],
  filter: true, sort: true, search: true,
});

// ---- Items: agent turns, finished commands, mail, notices (Inbox, Turns, Archive) ----
const typeLabels = { turn: 'Agent turn', command: 'Command', mail: 'Mail', system: 'Notice', dispatch: 'Sent work', snapshot: 'Pane snapshot' };
const waiting = { working: 'Still working. The reply appears here when the turn ends.', needs_input: 'Waiting for your answer in the pane.', idle: 'The agent went idle without finishing this turn, so there is no reply.' };
const turnNotes = { summary: 'Only the one-line TUIOS_AGENT_MESSAGE summary was available for this turn.', pane: 'Read from the pane transcript, so tool activity is included.' };
/** A turn that has no reply to load yet. */
export const unfinished = row => row.type === 'turn' && row.status in waiting;
const itemFields = [
  { key: 'type', label: 'Type', type: 'enum', options: () => Object.entries(typeLabels).map(([value, label]) => ({ value, label })), filter: true, sort: true, search: true },
  { key: 'status', label: 'Status', type: 'enum', filter: true, sort: true },
  taskField,
  recipientField(),
  { key: 'harness', label: 'Harness', type: 'enum', filter: true, sort: true },
  { key: 'unread', label: 'Unread', type: 'bool', filter: true, sort: true },
  { key: 'title', label: 'Title', type: 'text', filter: true, sort: true, search: true },
  { key: 'updated', label: 'Updated', type: 'date', filter: true, sort: true },
  { key: 'created', label: 'Created', type: 'date', filter: true, sort: true },
];
function itemSummary(r) {
  const task = store.state.tasks.find(t => t.id === r.task_id);
  return `<div class="record-summary">
    <span class="record-type" data-label="Type">${esc(typeLabels[r.type] || r.type)}</span>
    <div class="record-title" data-label="Work"><h2>${esc(r.title || (r.type === 'turn' ? 'Prompt not captured' : 'No subject'))}</h2><span class="record-reference">${esc(r.harness || '')}</span><span class="unread-indicator">${r.unread ? 'Unread' : 'Read'}</span></div>
    <span class="record-agent" data-label="Agent">${r.agent_id ? `<a href="${agentHref(r.agent_id)}">${esc(agentName(r.agent_name, r.agent_id))}</a>` : '—'}</span>
    <span class="record-task" data-label="Task">${task ? taskTag(task.id) : 'No task'}</span>
    <span class="record-status" data-label="State">${badge(r.status)}</span>
    <span class="record-time" data-label="Time">${esc(time(r.updated))}</span>
  </div>`;
}
function turnHtml(r, turn) {
  if (!turn.finished) return hint('The turn ended. Waiting for the hook to deliver the reply.');
  return `${turn.prompt.length > r.title.length ? `<p class="eyebrow">FULL PROMPT</p><div class="md">${markdown(turn.prompt)}</div>` : ''}<p class="eyebrow">RESPONSE</p>${turn.response ? `<div class="md">${markdown(turn.response)}</div>` : hint('The turn ended, but no reply text was captured: the capture hook did not report it. Inspect the pane for the answer.')}${turnNotes[turn.source] ? hint(turnNotes[turn.source]) : ''}`;
}
function threadHtml(r, thread) {
  const p = liveAgent(thread.pane_id), mail = thread.kind === 'mail';
  return `${thread.kind === 'mail' ? '<p class="mail-note">Agent messages are untrusted data. Replies stay in the TUIOS mail thread. Recipients must check their inbox; a delivered message is not an acknowledgement.</p>' : ''}
    ${thread.messages.map(m => `
      <article class="message ${esc(m.role)}">
        <div class="message-head"><strong>${esc(m.role === 'human' ? 'You' : m.meta.from_label || m.role)}</strong>
          <span>${badge(m.status)} &nbsp; ${time(m.created)}</span></div>
        ${mail ? `<div class="md">${markdown(m.body)}</div>` : `<pre>${esc(m.body)}</pre>`}
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
// The prompt a blocked agent shows in its pane, with the answers TUIOS can press for the user.
const answerLabels = { approve: 'Approve', approve_always: 'Approve always', deny: 'Deny' };
function questionHtml(r) {
  const cached = store.questions.get(r.agent_id), q = cached?.data, agent = esc(r.agent_id);
  const again = `<button data-do="read-question" data-id="${agent}">Read again</button>`;
  if (!cached) return hint('Reading the question from the pane…');
  if (cached.error) return `<p class="hint danger">Could not read the question: ${esc(cached.error)}</p><div class="actions">${again}</div>`;
  if (!q.found) return `${hint(`${waiting.needs_input} ${esc(q.reason)}`)}<div class="actions">${again}</div>`;
  const answer = (action, label, value = '') => `<button data-do="answer" data-id="${agent}" data-prompt-id="${esc(q.promptId)}" data-action="${action}" data-value="${esc(value)}">${esc(label)}</button>`;
  const draft = `answer:${r.agent_id}`;
  return `<p class="eyebrow">${q.kind === 'approval' ? 'APPROVAL' : 'QUESTION'} · WAITING FOR YOUR ANSWER</p><div class="message"><pre>${esc(q.lines.join('\n'))}</pre></div>
    <div class="actions">${q.actions.includes('choose') ? q.options.map(o => answer('choose', `${o.n}. ${o.label}`, o.n)).join('') : ''}${q.actions.filter(a => answerLabels[a]).map(a => answer(a, answerLabels[a])).join('')}${again}</div>
    ${q.actions.includes('text') ? `<form class="reply" data-answer="${agent}" data-prompt-id="${esc(q.promptId)}" data-draft="${esc(draft)}"><label>Type an answer
      <textarea name="body" required rows="2">${esc(store.drafts.get(draft) || '')}</textarea></label><button class="primary">Send answer</button></form>` : ''}
    ${hint(q.actions.length ? 'This is the pane’s screen, shown as untrusted text. Your answer is pressed in the pane by TUIOS, only if this is still the prompt it shows.' : 'TUIOS cannot press an answer to this prompt. Answer it in the pane.')}`;
}
function itemDetail(r) {
  const agent = store.state.agents.find(a => a.id === r.agent_id), pane = store.state.panes.find(p => p.id === r.agent_id), cached = store.bodies.get(r.id);
  const body = unfinished(r) ? (r.status === 'needs_input' ? questionHtml(r) : hint(waiting[r.status]))
    : !cached ? hint('Loading…')
    : cached.error ? `<p class="hint danger">Could not load this item: ${esc(cached.error)}</p>`
    : r.type === 'turn' ? turnHtml(r, cached.data) : threadHtml(r, cached.data);
  return `<div class="props">${select('item-task', r.id, r.task_id, taskChoices(), 'Task')}${agent ? select('agent-task', agent.id, agent.task_id, taskChoices(), 'Agent’s task') : ''}
    <button data-do="unread" data-id="${esc(r.id)}" data-value="${r.unread ? '' : '1'}">${r.unread ? 'Mark as read' : 'Mark as unread'}</button>
    <button data-do="archive" data-id="${esc(r.id)}" data-value="${r.archived ? '' : '1'}">${r.archived ? 'Restore to inbox' : 'Archive'}</button>
    ${pane ? `<button data-do="inspect" data-id="${esc(pane.id)}">Inspect ${esc(pane.name)}</button>` : ''}</div>
    ${agent ? hint(`“Agent’s task” assigns the whole agent (${esc(agentName(agent.name, agent.id))}): its other turns and commands move too, and new ones follow.`) : ''}${body}${unfinished(r) ? '' : promptForm(r)}`;
}
const itemActions = archived => [
  { id: 'read', label: 'Mark as read', run: update('/items/update', { unread: false }) },
  { id: 'unread', label: 'Mark as unread', run: update('/items/update', { unread: true }) },
  archived ? { id: 'unarchive', label: 'Restore to inbox', run: update('/items/update', { archived: false }) } : { id: 'archive', label: 'Archive', run: update('/items/update', { archived: true }) },
  assign('/items/update'),
];
const itemList = (storageKey, fields, archived, empty) => ({
  storageKey, fields, typeFilters: true, columns: ['Type', 'Work', 'Agent / pane', 'Task', 'State', 'Updated'], defaultQuery: { sort: { key: 'updated', dir: 'desc' } },
  rowId: r => r.id, rowClass: r => r.unread ? 'is-unread' : 'is-read', summary: itemSummary, detail: itemDetail, actions: itemActions(archived),
  empty: `${empty}<br>If you expected rows here, check the search and filters above.`,
});

// ---- Tasks ----
const statuses = ['open', 'active', 'done'].map(s => ({ value: s, label: s }));
const basename = path => path.split('/').filter(Boolean).pop() || path;
function taskDetail(t) {
  const { panes, agents } = store.state, mine = panes.filter(p => p.task_id === t.id);
  const members = [...new Map([
    ...mine.map(p => [p.id, { ...p, pane: true }]),
    ...agents.filter(a => a.task_id === t.id).map(a => [a.id, { ...mine.find(p => p.id === a.id), ...a, pane: mine.some(p => p.id === a.id) }]),
  ]).values()];
  return `<section class="entity-metadata" aria-label="Task details">
    <div class="metadata-heading"><a href="#tasks">← Tasks</a>${archivedTag(t)}</div>
    <div class="props"><label class="grow">Title<input data-set="task-title" data-id="${esc(t.id)}" value="${esc(t.title)}" maxlength="200"></label>${select('task-status', t.id, t.status, statuses, 'Status')}</div>
    <div class="props"><label class="grow">Project path <small>Optional</small><span class="browse"><input id="task-path-${esc(t.id)}" data-set="task-path" data-id="${esc(t.id)}" value="${esc(t.path)}" list="path-options" placeholder="Not set · panes open in your home directory"><button type="button" data-do="browse" data-id="task-path-${esc(t.id)}">Browse…</button></span></label><label class="grow">Existing worktree <small>Optional</small><span class="browse"><input id="task-worktree-${esc(t.id)}" data-set="task-worktree" data-id="${esc(t.id)}" value="${esc(t.worktree)}" list="path-options" placeholder="Leave empty to use the project path"><button type="button" data-do="browse" data-id="task-worktree-${esc(t.id)}">Browse…</button></span></label></div>
    <div class="props">${select('task-parent', t.id, t.parent_id, [{ value: '', label: 'No parent · top-level task' }, ...taskOptions(subtree(t.id))], 'Parent task')}</div>
    ${(() => { const children = store.state.tasks.filter(c => c.parent_id === t.id && !c.archived), parent = store.state.tasks.find(p => p.id === t.parent_id); return `<div class="metadata-subtasks">${parent ? `<p class="hint">Subtask of <a href="${taskHref(parent.id)}">${esc(parent.title)}</a>.</p>` : ''}<h2 class="section-title">Subtasks <span>${children.length}</span></h2>${children.length ? `<ul class="subtask-list">${children.map(c => `<li><a href="${taskHref(c.id)}">${esc(c.title)}</a> ${badge(c.status)}</li>`).join('')}</ul>` : ''}<div class="actions"><button data-do="new-subtask" data-id="${esc(t.id)}">New subtask…</button></div></div>`; })()}
    <dl class="metadata-facts"><div><dt>TUIOS session</dt><dd>${esc(t.session)}</dd></div><div><dt>Created</dt><dd>${esc(time(t.created))}</dd></div><div><dt>Task ID</dt><dd>${esc(t.id)}</dd></div></dl>
    <div class="actions"><button class="primary" data-do="compose" data-id="${esc(t.id)}">Compose work</button><button data-do="open-pane" data-kind="agent" data-id="${esc(t.id)}">New Agent…</button><button data-do="open-pane" data-kind="pane" data-id="${esc(t.id)}">New Pane…</button><button data-do="open-mail" data-id="${esc(t.id)}">Send mail</button>${archiveButton('task-archive', t)}</div>
    <label>Task notes<textarea data-notes="${esc(t.id)}" rows="3">${esc(store.drafts.get(`notes:${t.id}`) ?? t.notes)}</textarea></label><button data-do="save-notes" data-id="${esc(t.id)}" class="subtle">Save notes</button>
    <div class="metadata-members"><h2 class="section-title">Agents and panes <span>${members.length}</span></h2><div id="member-selection" data-workbench-controls></div>
    ${members.map(m => `<div class="pane" data-wb-key="member:${esc(m.id)}"><div class="member-summary"><input type="checkbox" data-wb-pick="members" data-id="${esc(m.id)}" aria-label="Select ${esc(agentName(m.name, m.id))}"><div><strong>${agents.some(a => a.id === m.id) ? `<a href="${agentHref(m.id)}">${esc(agentName(m.name, m.id))}</a>` : esc(agentName(m.name, m.id))}</strong> ${badge(m.state)}${archivedTag(m)}<small>${esc(m.kind)}${m.harness ? ` · ${esc(m.harness)}` : ''} · ${esc(m.id)}${m.pane ? ' · managed here' : ' · assigned here'}</small></div></div><div class="pane-actions">${m.pane ? `<button data-do="inspect" data-id="${esc(m.id)}">Inspect</button>${mine.find(p => p.id === m.id)?.kind === 'agent' ? `<button data-do="check-mail" data-id="${esc(m.id)}">Check mail</button>` : ''}` : ''}</div></div>`).join('') || hint('No members yet. Open an agent or pane here, or assign an existing recipient from Agents.')}</div>
    ${hint('Work uses observed recipients assigned to this task. Mail uses only panes opened in this task; assignment does not move native sessions or directories.')}
  </section>`;
}

function agentDetail(a) {
  const pane = store.state.panes.find(p => p.id === a.id);
  const profile = pane && store.state.profiles.find(p => p.id === pane.profile_id);
  return `<section class="entity-metadata" aria-label="Agent details">
    <div class="metadata-heading"><a href="#agents">← Agents</a>${archivedTag(a)}</div>
    <div class="props">${select('agent-task', a.id, a.task_id, taskChoices(), 'Task')}${archiveButton('agent-archive', a)}${pane ? `<button data-do="inspect" data-id="${esc(a.id)}">Inspect pane</button>${pane.kind === 'agent' ? `<button data-do="check-mail" data-id="${esc(a.id)}">Check mail</button>` : ''}` : ''}</div>
    <dl class="metadata-facts"><div><dt>Name</dt><dd>${esc(agentName(a.name, a.id))}</dd></div><div><dt>Native pane ID</dt><dd>${esc(a.id)}</dd></div><div><dt>Kind</dt><dd>${esc(a.kind)}</dd></div><div><dt>Harness</dt><dd>${esc(a.harness || 'Not reported')}</dd></div><div><dt>TUIOS session</dt><dd>${esc(a.session || 'Not reported')}</dd></div><div><dt>Last known state</dt><dd>${badge(a.state)}</dd></div><div><dt>Last seen</dt><dd>${esc(time(a.seen))}</dd></div>${pane?.profile_id ? `<div><dt>Launch profile</dt><dd>${esc(profile?.name || pane.profile_id)}</dd></div>` : ''}${pane?.conversation_id ? `<div><dt>Conversation ID</dt><dd>${esc(pane.conversation_id)}</dd></div>` : ''}</dl>
    ${hint('Assigning this recipient groups its turns and commands with the task. Items explicitly moved to another task stay there. Native session, directory and managed-mail membership do not change.')}
  </section>`;
}

// ---- Agent profiles ----
const protocols = [{ value: 'native', label: 'Native terminal' }, { value: 'codex', label: 'Codex app-server' }, { value: 'acp', label: 'ACP' }];
const protocol = p => p.protocol || 'native';

export const pages = {
  queues: {
    title: 'Queues', items: true,
    description: 'Unread work grouped by task, oldest first. Opening a record marks it read; shell commands sit in their own bucket until you ask for them.',
    rows: () => [], list: null,
  },
  inbox: {
    title: 'Inbox', items: true,
    description: 'Agent turns, commands and mail. Unread work has a tinted background, bold title and Unread label. Check records to mark them read or archive them together.',
    rows: () => store.state.items.filter(i => !i.archived),
    list: itemList('inbox', itemFields, false, 'Nothing here. A row appears when an agent gets a prompt, a shell command finishes, or mail arrives.'),
  },
  turns: {
    title: 'Turns', items: true,
    description: 'Prompts received by agents in TUIOS. Open a record to inspect the reply; unfinished turns show their last known state.',
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
      storageKey: 'tasks.v2', columns: ['Type', 'Task', 'Agents / panes', 'Unread', 'Status', 'Created'], defaultQuery: { sort: { key: 'created', dir: 'desc' }, filters: notArchived },
      fields: [
        { key: 'status', label: 'Status', type: 'enum', options: () => statuses, filter: true, sort: true },
        { key: 'title', label: 'Title', type: 'text', filter: true, sort: true, search: true },
        { key: 'path', label: 'Path', type: 'text', filter: true, sort: true, search: true },
        { key: 'created', label: 'Created', type: 'date', filter: true, sort: true },
        archivedField,
        { key: 'unread_count', label: 'Unread items', type: 'number', filter: true, sort: true },
        { key: 'agent_count', label: 'Agents', type: 'number', filter: true, sort: true },
      ],
      rowId: t => t.id, rowHref: t => taskHref(t.id), rowClass: t => t.unread_count ? 'is-unread' : 'is-read',
      summary: t => `<div class="record-summary">
        <span class="record-type" data-label="Type">Task</span>
        <div class="record-title" data-label="Work"><h3>${esc(t.title)}</h3><span class="record-reference">${t.parent_id ? `↳ ${esc(store.state.tasks.find(p => p.id === t.parent_id)?.title || 'parent')} · ` : ''}${t.path ? esc(basename(t.path)) : 'no directory'}${archivedTag(t)}</span></div>
        <span class="record-agent" data-label="Agents">${t.agent_count} observed</span>
        <span class="record-task" data-label="Unread"><span class="unread-indicator">${t.unread_count} unread</span></span>
        <span class="record-status" data-label="State">${badge(t.status)}</span>
        <span class="record-time" data-label="Time">${esc(time(t.created))}</span>
      </div>`,
      actions: [{ id: 'status', label: 'Set status', options: () => statuses, run: (ids, status) => api('/tasks/update', { ids, set: { status } }) }, ...archiveActions('/tasks/update')],
      empty: 'No tasks to show.<br>Create one with “+ New task”, then assign agents to it.',
    },
  },
  agents: {
    title: 'Agents',
    description: 'Every TUIOS pane seen so far. Assign an agent to a task and its turns and commands go to that task.',
    rows: () => store.state.agents.map(a => ({ ...a, unread_count: store.state.items.filter(i => i.agent_id === a.id && i.unread && !i.archived).length })),
    list: {
      storageKey: 'agents.v2', columns: ['Kind', 'Agent / pane', 'Harness', 'Task', 'State', 'Last seen'], defaultQuery: { sort: { key: 'seen', dir: 'desc' }, filters: notArchived },
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
      rowId: a => a.id, rowHref: a => agentHref(a.id), rowClass: a => a.unread_count ? 'is-unread' : 'is-read',
      summary: a => `<div class="record-summary">
        <span class="record-type" data-label="Type">${esc(a.kind)}</span>
        <div class="record-title" data-label="Work"><h3>${esc(agentName(a.name, a.id))}</h3><span class="record-reference">${esc(a.session || a.id)}${archivedTag(a)}</span><span class="unread-indicator">${a.unread_count} unread</span></div>
        <span class="record-agent" data-label="Harness">${esc(a.harness || '—')}</span>
        <span class="record-task" data-label="Task">${esc(store.state.tasks.find(t => t.id === a.task_id)?.title || 'No task')}</span>
        <span class="record-status" data-label="State">${badge(a.state)}</span>
        <span class="record-time" data-label="Time">${esc(time(a.seen))}</span>
      </div>`,
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
      storageKey: 'profiles', columns: ['Type', 'Profile', 'Program', '', 'Protocol', ''], defaultQuery: { sort: { key: 'name', dir: 'asc' } },
      fields: [
        { key: 'protocol', label: 'Protocol', type: 'enum', get: protocol, options: () => protocols, filter: true, sort: true },
        { key: 'name', label: 'Name', type: 'text', filter: true, sort: true, search: true },
        { key: 'executable', label: 'Executable', type: 'text', filter: true, sort: true, search: true },
      ],
      rowId: p => p.id, rowClass: () => 'is-read',
      summary: p => `<div class="record-summary">
        <span class="record-type" data-label="Type">Profile</span>
        <div class="record-title" data-label="Work"><h3>${esc(p.name)}</h3><span class="record-reference">${esc(p.id)}</span></div>
        <span class="record-agent" data-label="Program">${esc(p.executable)}</span>
        <span class="record-task"></span>
        <span class="record-status" data-label="Protocol">${esc(protocols.find(o => o.value === protocol(p)).label)}</span>
        <span class="record-time"></span>
      </div>`,
      detail: p => `<div class="message"><pre>${esc(p.executable)} ${esc(p.args.join(' '))}</pre></div>
        ${hint('Launches in the task directory. Profiles configure the executable, model and other arguments, protocol, and environment. Credentials are inherited from your local harness. TUIOS permissions: read, write, fan; no delegated approvals.')}
        <div class="actions"><button class="primary" data-do="edit-profile" data-id="${esc(p.id)}">Edit profile</button></div>`,
      actions: [{ id: 'delete', label: 'Delete', danger: true, run: async ids => { if (confirm(`Delete ${ids.length === 1 ? 'this profile' : `these ${ids.length} profiles`}?`)) await api('/profiles/delete', { ids }); } }],
      empty: 'No profiles to show.<br>Use “Add profile” to create one.',
    },
  },
};

export function pageForRoute(route) {
  if (route.kind === 'index') return pages[route.page] || null;
  const task = route.kind === 'task';
  const row = (task ? store.state.tasks : store.state.agents).find(r => r.id === route.id);
  if (!row) return null;
  const scopeField = task ? 'task_id' : 'agent_id';
  const fields = itemFields.filter(f => f.key !== scopeField).map(f => f.key === 'agent_id' ? recipientField(row.id) : f);
  return {
    title: task ? row.title : agentName(row.name, row.id), items: true,
    description: `${task ? 'Task' : 'Agent / pane'} inbox · Active records scoped by ${task ? 'Task ID' : 'native pane ID'}. Search and filters cannot change this scope.`,
    rows: () => store.state.items.filter(i => !i.archived && i[scopeField] === route.id),
    list: { ...itemList(`${route.kind}:${encodeURIComponent(route.id)}`, fields, false, 'No active records in this inbox.'), scopeField },
  };
}

export function metadataForRoute(route) {
  if (route.kind === 'index') return '';
  const task = route.kind === 'task';
  const row = (task ? store.state.tasks : store.state.agents).find(r => r.id === route.id);
  return row ? (task ? taskDetail(row) : agentDetail(row)) : '';
}
