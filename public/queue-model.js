// Pure bucket model: one queue per task, oldest at the top. No DOM, no fetch, so it is unit-tested.
export const UNASSIGNED = 'unassigned';
export const ALL = 'all';
const stamp = row => Date.parse(row.updated) || Date.parse(row.created) || 0;
/** Oldest first; ties break on id so a live refresh never reorders equal rows. */
export const byOldest = (a, b) => stamp(a) - stamp(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * @param {{tasks: object[], items: object[], reviewable: (row: object) => boolean, label?: (row: object) => string}} input
 *   `reviewable` decides which unread rows belong in a queue; `label` names a row's agent.
 * @returns {{all: object, buckets: object[]}} buckets with rows ordered oldest first; busy buckets first,
 *   then the one whose oldest row has waited longest; empty buckets last, alphabetically.
 */
export function buildBuckets({ tasks, items, reviewable, label = row => row.agent_name || row.agent_id || '' }) {
  const rows = items.filter(i => i.unread && !i.archived && reviewable(i)).sort(byOldest);
  const bucket = (id, title) => ({ id, title, rows: [] });
  const buckets = tasks.filter(t => !t.archived).map(t => bucket(t.id, t.title));
  const unassigned = bucket(UNASSIGNED, 'Not assigned to a task');
  const index = new Map(buckets.map(b => [b.id, b]));
  for (const row of rows) (index.get(row.task_id) || unassigned).rows.push(row);
  buckets.push(unassigned);
  const finish = b => {
    b.count = b.rows.length; b.oldest = b.rows[0] ? stamp(b.rows[0]) : null;
    const agents = new Map();
    for (const row of b.rows) {
      const key = row.agent_id || '', entry = agents.get(key) || { id: key, name: label(row) || 'No agent', count: 0 };
      entry.count++; agents.set(key, entry);
    }
    b.agents = [...agents.values()].sort((x, y) => y.count - x.count || x.name.localeCompare(y.name));
    return b;
  };
  buckets.forEach(finish);
  buckets.sort((a, b) => (b.count > 0) - (a.count > 0) || (a.oldest ?? Infinity) - (b.oldest ?? Infinity) || a.title.localeCompare(b.title));
  const all = finish({ id: ALL, title: 'Everything', rows });
  return { all, buckets };
}

/** The row to read after `id` leaves the queue: the next older-to-newer one, else the previous, else none. */
export function nextAfter(rows, id) {
  const i = rows.findIndex(r => r.id === id);
  if (i < 0) return rows[0]?.id ?? null;
  return (rows[i + 1] || rows[i - 1])?.id ?? null;
}

export function waitingFor(row, now = Date.now()) {
  const s = Math.max(0, Math.round((now - stamp(row)) / 1000));
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`; return `${Math.round(s / 86400)}d`;
}
