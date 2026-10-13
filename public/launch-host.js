const opens = new WeakMap();

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
    note.textContent = 'Choose where execution happens. Paths belong to this machine, not the global session owner.';
    form.dispatchEvent(new Event('hosts-ready'));
  } catch (error) {
    if (opens.get(form) !== open || !form.closest('dialog')?.open) return;
    select.replaceChildren(...hostChoices([], select.value).map(c => { const option = new Option(c.label, c.value); option.disabled = Boolean(c.disabled); return option; }));
    store.liveHosts = [];
    form.dispatchEvent(new Event('hosts-ready'));
    note.textContent = `Execution machines unavailable: ${error.message}. No default machine is used.`;
  }
}
