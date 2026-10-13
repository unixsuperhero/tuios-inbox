import { setTimeout as delay } from 'node:timers/promises';

const geometryTimeout = 5000;
const stableFor = 350;
const idOf = pane => pane.window_id || pane.id;
const rectangle = pane => ({ x: pane.x, y: pane.y, width: pane.width, height: pane.height });
const sameRectangle = (a, b) => ['x', 'y', 'width', 'height'].every(key => a[key] === b[key]);
const validRectangle = pane => pane && ['x', 'y', 'width', 'height'].every(key => Number.isInteger(pane[key])) && pane.width > 0 && pane.height > 0;
const floating = pane => pane.is_floating === true || pane.floating === true || pane.popup === true;
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function requireSession(info) {
  if (info.tui_attached !== true) throw new Error('Split needs an attached TUIOS terminal client');
  if (info.tiling_mode !== 'tiling' || info.layout_mode !== 'bsp') throw new Error('Split needs native BSP tiling enabled');
}

function requireTarget(snapshot, window, workspace) {
  const target = snapshot.windows.find(pane => idOf(pane) === window);
  if (!target) throw new Error('Split target is no longer live');
  if (snapshot.current_workspace !== workspace || target.workspace !== workspace) throw new Error('Split target must be on the current native workspace');
  if (target.minimized || floating(target) || target.zoomed) throw new Error('Split target must be a visible, non-floating, unzoomed pane');
  if (!validRectangle(target)) throw new Error('Split target has no usable native geometry');
  // Older native listings omit the floating flag; overlapping geometry is not a safe BSP leaf.
  if (snapshot.windows.some(pane => idOf(pane) !== window && pane.workspace === workspace && !pane.minimized && validRectangle(pane) && overlaps(target, pane))) {
    throw new Error('Split target overlaps another pane; native BSP placement cannot be verified');
  }
  return target;
}

function fingerprint(snapshot) {
  return JSON.stringify([snapshot.current_workspace, ...snapshot.windows.map(pane => [idOf(pane), pane.workspace, pane.minimized, floating(pane), pane.zoomed, pane.x, pane.y, pane.width, pane.height]).sort((a, b) => a[0].localeCompare(b[0]))]);
}

async function settledSnapshot(cli, session, accept, message) {
  const deadline = Date.now() + geometryTimeout;
  let last, unchangedSince = 0;
  while (Date.now() < deadline) {
    const snapshot = await cli(['list-windows', '-s', session], Math.max(1, deadline - Date.now()));
    const result = accept(snapshot);
    const key = result && fingerprint(snapshot);
    if (key && key === last) {
      if (Date.now() - unchangedSince >= stableFor) return { snapshot, result };
    } else {
      last = key;
      unchangedSince = Date.now();
    }
    await delay(100);
  }
  throw new Error(message);
}

// A sibling pair must exactly partition the original leaf, allowing the native separator gap.
function siblingDirection(target, created, original) {
  if (!validRectangle(target) || !validRectangle(created)) return null;
  const bounds = {
    x: Math.min(target.x, created.x), y: Math.min(target.y, created.y),
    width: Math.max(target.x + target.width, created.x + created.width) - Math.min(target.x, created.x),
    height: Math.max(target.y + target.height, created.y + created.height) - Math.min(target.y, created.y),
  };
  if (!sameRectangle(bounds, original) || overlaps(target, created)) return null;
  if (target.y === created.y && target.height === created.height) return 'vertical';
  if (target.x === created.x && target.width === created.width) return 'horizontal';
  return null;
}

function pairInSnapshot(snapshot, baseline, window, createdId, host) {
  if (snapshot.current_workspace !== baseline.current_workspace || snapshot.windows.length !== baseline.windows.length + 1) return null;
  const target = snapshot.windows.find(pane => idOf(pane) === window);
  const created = snapshot.windows.find(pane => idOf(pane) === createdId);
  const original = baseline.windows.find(pane => idOf(pane) === window);
  if (!target || !created || [target, created].some(pane => pane.workspace !== original.workspace || pane.minimized || floating(pane) || pane.zoomed)) return null;
  if ((created.host || 'local') !== host) return null;
  for (const before of baseline.windows) {
    if (idOf(before) === window) continue;
    const after = snapshot.windows.find(pane => idOf(pane) === idOf(before));
    if (!after || after.workspace !== before.workspace || after.minimized !== before.minimized || floating(after) !== floating(before) || after.zoomed !== before.zoomed || !sameRectangle(before, after)) return null;
  }
  return siblingDirection(target, created, original);
}

async function focus(cli, session, window) {
  const acknowledged = await cli(['run-command', '-s', session, 'FocusWindow', window]);
  if (acknowledged.success !== true) throw new Error(acknowledged.error || acknowledged.message || 'Native focus was not acknowledged');
  const snapshot = await cli(['list-windows', '-s', session]);
  if (snapshot.focused_window_id !== window) throw new Error('Native focus changed before split placement');
  return snapshot;
}

/** Inputs are validated by the launch boundary; cli returns native JSON or throws native errors. */
export async function splitOnHost({ session, window, direction, name, host }, { cli }) {
  const info = await cli(['session-info', '-s', session]);
  requireSession(info);
  const { snapshot: baseline } = await settledSnapshot(cli, session, snapshot => requireTarget(snapshot, window, info.current_workspace), 'Native geometry did not settle before split');
  const focused = await focus(cli, session, window);
  requireTarget(focused, window, info.current_workspace);
  if (fingerprint(focused) !== fingerprint(baseline)) throw new Error('Native layout changed before split placement');
  requireSession(await cli(['session-info', '-s', session]));

  let created, createdId;
  try {
    created = await cli(['new-window', '-s', session, '--host', host, '--no-focus', '--workspace', String(info.current_workspace), '--', name]);
    createdId = created.window_id || created.id;
    if (created.error || created.success === false) throw new Error(created.error || created.message || 'Native creation failed');
    if (!createdId || baseline.windows.some(pane => idOf(pane) === createdId)) throw new Error('Native creation did not return a correlated new window UUID; creation was not retried');
    const settled = await settledSnapshot(cli, session, snapshot => pairInSnapshot(snapshot, baseline, window, createdId, host), 'Created pane did not form a verified sibling split of the target; native layout or focus may have changed');
    await focus(cli, session, createdId);
    requireSession(await cli(['session-info', '-s', session]));
    const beforeRotation = await cli(['list-windows', '-s', session]);
    if (pairInSnapshot(beforeRotation, baseline, window, createdId, host) !== settled.result) throw new Error('Native sibling placement changed before split orientation');
    if (settled.result !== direction) {
      const rotated = await cli(['run-command', '-s', session, 'RotateSplit']);
      if (rotated.success !== true) throw new Error(rotated.error || rotated.message || 'Native split rotation was not acknowledged');
      await settledSnapshot(cli, session, snapshot => pairInSnapshot(snapshot, baseline, window, createdId, host) === direction, 'Native split did not settle into the requested orientation');
    }
    return { ...created, window_id: createdId, target_window_id: window, direction };
  } catch (cause) {
    createdId ||= cause.createdWindowId || cause.window_id || cause.result?.window_id;
    if (!createdId) throw cause;
    const error = new Error(`Pane ${createdId} was created, but split could not be completed: ${cause.message}. The pane was retained; do not retry creation.`, { cause });
    error.createdWindowId = createdId;
    error.window_id = createdId;
    throw error;
  }
}
