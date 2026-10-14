const opens = new WeakMap();
const readinessRequests = new Map();

export const operationBlocked = (readiness, operation) => ['unsupported', 'unavailable'].includes(readiness?.operations?.[operation]?.state);
export const readinessMarkup = () => '<details data-host-readiness><summary>Machine capabilities</summary><p data-readiness-status role="status"></p><button type="button" data-readiness-refresh>Refresh capabilities</button></details>';

export function readinessText(readiness) {
  const lines = [`${readiness.host} · connection ${readiness.connection?.state || 'unknown'} · TUIOS ${readiness.version || 'version unknown'}`, readiness.connection?.reason];
  for (const operation of ['pane', 'agent', 'browse']) {
    const capability = readiness.operations?.[operation];
    lines.push(`${operation === 'browse' ? 'Browse' : operation === 'agent' ? 'Agent' : 'Pane'}: ${capability?.state || 'unknown'} — ${capability?.reason || 'Not checked; an explicit attempt may fail.'}`);
  }
  lines.push('Supported means commands exist; permissions and launch context are not checked. Unknown allows an explicit attempt.');
  if (readiness.checked_at) lines.push(`Checked ${readiness.checked_at}`);
  return lines.filter(Boolean).join('\n');
}

function unknownReadiness(host, reason) {
  return { host, version: null, connection: { state: 'unknown', reason }, operations: Object.fromEntries(['pane', 'agent', 'browse'].map(operation => [operation, { state: 'unknown', reason }])) };
}

function lookupReadiness(api, host) {
  if (readinessRequests.has(host)) return readinessRequests.get(host);
  if (readinessRequests.size >= 16) return Promise.resolve(unknownReadiness(host, 'Other machine checks are in progress. Refresh to check this machine.'));
  const request = Promise.resolve().then(() => api(`/hosts/readiness?host=${encodeURIComponent(host)}`)).catch(error => unknownReadiness(host, `Capability check failed: ${error.message}`)).finally(() => { if (readinessRequests.get(host) === request) readinessRequests.delete(host); });
  readinessRequests.set(host, request);
  return request;
}

export function bindReadiness(element, { api, isCurrent = () => element.isConnected, onChange = () => {} }) {
  const status = element.querySelector('[data-readiness-status]'), refresh = element.querySelector('[data-readiness-refresh]'), summary = element.querySelector('summary');
  let host = null, generation = 0, value = null;
  const paint = () => {
    if (!value) {
      summary.textContent = host ? `Machine capabilities · ${host} · checking…` : 'Machine capabilities · no machine selected';
      status.textContent = host ? 'Checking native commands… Unknown capabilities still allow an explicit attempt.' : 'Choose an execution machine to check its capabilities.';
      refresh.disabled = true; return;
    }
    status.textContent = readinessText(value);
    const states = ['pane', 'agent', 'browse'].map(operation => value.operations?.[operation]?.state || 'unknown');
    const warning = states.includes('unknown') ? ' · unverified; attempts may fail' : states.some(state => ['unsupported', 'unavailable'].includes(state)) ? ' · some operations unavailable' : ' · command support only';
    summary.textContent = `Machine capabilities · ${host} · ${value.connection?.state || 'unknown'}${value.version ? ` · ${value.version}` : ''}${warning}`;
    refresh.disabled = false;
  };
  const update = async (nextHost, { force = false } = {}) => {
    nextHost ||= '';
    if (!force && nextHost === host) { paint(); return value; }
    host = nextHost; value = null; const current = ++generation;
    onChange(null); refresh.disabled = !host;
    summary.textContent = host ? `Machine capabilities · ${host} · checking…` : 'Machine capabilities · no machine selected';
    status.textContent = host ? 'Checking native commands… Unknown capabilities still allow an explicit attempt.' : 'Choose an execution machine to check its capabilities.';
    if (!host) return null;
    refresh.disabled = true;
    const result = await lookupReadiness(api, host);
    if (current !== generation || !isCurrent()) return null;
    value = result; paint();
    onChange(value); return value;
  };
  const refreshSelected = () => update(host, { force: true });
  refresh.addEventListener('click', refreshSelected);
  return { update, paint, get value() { return value; }, dispose() { ++generation; host = null; value = null; refresh.removeEventListener('click', refreshSelected); } };
}

export function launchSummary({ host, project, worktree, cwd, profile, model, session, owner, workspace, inheritance, overrides, pane, mode = 'Launch' } = {}) {
  if (pane) {
    host = pane.host; cwd = pane.launch_cwd ?? pane.cwd; profile = pane.launch_profile; model = pane.launch_model; session = pane.session; workspace = pane.workspace; owner = null;
    project = pane.launch_repo; worktree = pane.launch_worktree; inheritance = null; overrides = null;
  }
  const rows = [`${mode}${pane ? ` · pane ${pane.name || pane.id}` : ''}`, `Machine: ${host || 'unknown'}`, `Project: ${project || (pane ? 'unknown' : 'not set')}`, ...(worktree ? [`Worktree: ${worktree}`] : []), `Directory: ${cwd || (pane ? 'unknown' : 'native machine default (no directory override)')}`, `Profile: ${profile || (pane ? 'unknown' : 'shell / not selected')}`, `Model: ${model === '' ? 'profile default' : model ?? 'unknown'}`, `Session: ${session || (pane ? 'unknown' : 'created at launch')} · owner ${owner || (session?.includes(':') ? session.split(':')[0] : session ? 'local' : 'unknown')} · workspace ${workspace ?? (pane ? 'unknown' : 'session default')}`];
  if (inheritance) rows.push(`Inherited: ${inheritance}`);
  if (overrides) rows.push(`Launch-only: ${overrides}`);
  return rows.join(' · ');
}


export const hostUnavailable = host => Boolean(host.read_only) || Boolean(host.status && !['up', 'connected', 'ok'].includes(host.status));
export const machineLabel = host => host.host === 'local' ? `${host.hostname || 'Local machine'} · local` : host.hostname && host.hostname !== host.host ? `${host.host} · ${host.hostname}` : host.host;
export function hostChoices(hosts = [], current = '', blank = 'Choose an execution machine') {
  const choices = [{ value: '', label: blank }, ...hosts.map(h => ({ value: h.host, label: `${machineLabel(h)}${h.read_only ? ' · read-only' : hostUnavailable(h) ? ` · ${h.status || 'unavailable'}${h.error ? ': ' + h.error : ''}` : ''}`, disabled: hostUnavailable(h) }))];
  if (current && !choices.some(c => c.value === current)) choices.push({ value: current, label: `${current} · unavailable`, disabled: true });
  return choices;
}

export async function setupLaunchHost(form, api, store) {
  const label = form.querySelector('[data-host-label]');
  if (!label) return;
  const select = label.querySelector('select'), note = label.querySelector('small');
  const open = (opens.get(form) || 0) + 1;
  opens.set(form, open);
  const current = select.value;
  const replace = hosts => {
    select.replaceChildren(...hostChoices(hosts, current).map(c => { const option = new Option(c.label, c.value); option.disabled = Boolean(c.disabled); return option; }));
    select.value = current;
  };
  replace(store.liveHosts || []);
  note.textContent = 'Loading execution machines…';
  try {
    const hosts = (await api('/hosts')).hosts || [];
    if (opens.get(form) !== open || !form.closest('dialog')?.open) return;
    store.liveHosts = hosts;
    const selected = select.value;
    select.replaceChildren(...hostChoices(hosts, selected).map(c => { const option = new Option(c.label, c.value); option.disabled = Boolean(c.disabled); return option; }));
    select.value = selected;
    note.textContent = 'Choose where execution happens. Paths belong to this machine, not the session owner.';
    form.dispatchEvent(new Event('hosts-ready'));
  } catch (error) {
    if (opens.get(form) !== open || !form.closest('dialog')?.open) return;
    select.replaceChildren(...hostChoices([], select.value).map(c => { const option = new Option(c.label, c.value); option.disabled = Boolean(c.disabled); return option; }));
    store.liveHosts = [];
    form.dispatchEvent(new Event('hosts-ready'));
    note.textContent = `Execution machines unavailable: ${error.message}. No default machine is used.`;
  }
}
