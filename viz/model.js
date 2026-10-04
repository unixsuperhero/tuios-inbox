// model.js - one plain object the scenes read. The server's /api/state is already denormalized;
// this adds the classifications the visual channels encode (see LEGEND in main.js) and the
// "away" window, which is the question the first view answers.
const FINISHED = new Set(['complete', 'done', 'captured', 'partial', 'failed', 'snapshot', 'uncertain']);
const LIVE_AGENT = new Set(['working', 'needs_input', 'done', 'idle', 'errored', 'unknown']);
export const UNASSIGNED = 'unassigned';
const SEEN_KEY = 'tuios-viz.lastSeen';

export function readLastSeen() { try { const v = localStorage.getItem(SEEN_KEY); return v ? Number(v) : null; } catch { return null; } }
export function writeLastSeen() { try { localStorage.setItem(SEEN_KEY, String(Date.now())); } catch { /* storage may be unavailable */ } }

/** @param {object} state - the /api/state payload */
export function buildModel(state, { since = null } = {}) {
  const now = Date.now();
  const agents = state.agents.filter(a => !a.archived && LIVE_AGENT.has(a.state)).map(a => ({
    id: a.id, name: a.name || a.id.slice(0, 8), harness: a.harness, kind: a.kind, state: a.state,
    taskId: a.task_id || UNASSIGNED, seen: Date.parse(a.seen) || now
  }));
  const items = state.items.filter(i => !i.archived).map(i => {
    const t = Date.parse(i.updated) || Date.parse(i.created) || now;
    const finished = FINISHED.has(i.status) || (i.type !== 'turn' && i.status === '');
    return {
      id: i.id, type: i.type, title: i.title || '(untitled)', status: i.status || 'none', unread: Boolean(i.unread),
      created: Date.parse(i.created) || t, t, taskId: i.task_id || UNASSIGNED, agentId: i.agent_id, agentName: i.agent_name || '',
      harness: i.harness || '', finished, working: i.status === 'working' || i.status === 'running',
      // "Finished while I was away": done, still unread, and it landed after the last time this page was seen.
      away: finished && Boolean(i.unread) && (since === null || t > since)
    };
  });
  const byTask = new Map();
  const taskOf = id => { if (!byTask.has(id)) byTask.set(id, { items: [], agents: [] }); return byTask.get(id); };
  for (const item of items) taskOf(item.taskId).items.push(item);
  for (const agent of agents) taskOf(agent.taskId).agents.push(agent);
  const tasks = state.tasks.filter(t => !t.archived).map(t => ({ id: t.id, title: t.title, status: t.status, path: t.path }));
  if (byTask.has(UNASSIGNED)) tasks.push({ id: UNASSIGNED, title: 'Not assigned to a task', status: '', path: '' });
  for (const task of tasks) {
    const group = taskOf(task.id);
    group.items.sort((a, b) => a.t - b.t);
    Object.assign(task, group, {
      unread: group.items.filter(i => i.unread && i.finished).length,
      away: group.items.filter(i => i.away).length,
      working: group.agents.filter(a => a.state === 'working').length + group.items.filter(i => i.working).length,
      needsInput: group.agents.filter(a => a.state === 'needs_input').length,
      errored: group.agents.filter(a => a.state === 'errored').length
    });
  }
  // Busy tasks first, then the ones with the most to review; a stable order keeps the pedestals from reshuffling.
  tasks.sort((a, b) => (b.needsInput - a.needsInput) || (b.away - a.away) || (b.working - a.working) || a.title.localeCompare(b.title));
  const away = items.filter(i => i.away).sort((a, b) => b.t - a.t);
  return { now, since, tasks, items, agents, away, blocked: agents.filter(a => a.state === 'needs_input'), lastError: state.lastError || '' };
}

export const fmtTime = ms => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
export function fmtAgo(ms, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`; if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`; return `${Math.round(s / 86400)}d ago`;
}
