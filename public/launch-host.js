// Host choice for new panes. The task keeps its home; the choice applies to this launch only.
const opens = new WeakMap();
const taskDefault = () => new Option("Task's host (default)", '');

export async function setupLaunchHost(form, api, store) {
  const label = form.querySelector('#pane-host-label');
  if (!label) return;
  const select = label.querySelector('select'), note = label.querySelector('small');
  const open = (opens.get(form) || 0) + 1;
  opens.set(form, open);
  // Every open starts from the task default; no host from a previous open stays selectable.
  select.replaceChildren(taskDefault());
  select.value = '';
  note.textContent = 'Loading registered hosts… The task\'s own host is used unless you pick one.';
  let hosts;
  try { hosts = (await api('/hosts')).hosts || []; }
  catch (error) {
    if (opens.get(form) !== open) return;
    note.textContent = `Hosts unavailable: ${error.message}. The task's own host is used.`;
    return;
  }
  if (opens.get(form) !== open) return;
  const options = [taskDefault()];
  for (const h of hosts) {
    const bad = h.status && !['up', 'connected', 'ok'].includes(h.status);
    const option = new Option(`${h.host}${bad ? ` · ${h.status}${h.error ? ': ' + h.error : ''}` : ''}`, h.host);
    option.disabled = Boolean(bad) || Boolean(h.read_only);
    options.push(option);
  }
  select.replaceChildren(...options);
  select.value = '';
  note.textContent = hosts.length > 1 ? 'Only this new pane runs there; the task and its other panes stay put.' : 'No other host is registered (tuios hosts add).';
}
