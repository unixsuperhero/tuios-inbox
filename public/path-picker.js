import { api, esc } from '/pages.js';

export async function choosePath({ host, kind, path = '', title = '', signal }) {
  if (signal?.aborted) return null;
  if (!host || !['directory', 'file'].includes(kind)) throw Error('Choose an execution machine and a file or directory.');
  const trigger = document.activeElement;
  try {
    if (host === 'local') {
      return await new Promise((resolve, reject) => {
        let finished = false;
        const finish = (value, error) => {
          if (finished) return;
          finished = true;
          signal?.removeEventListener('abort', cancel);
          if (error) reject(error); else resolve(value);
        };
        const cancel = () => finish(null);
        signal?.addEventListener('abort', cancel, { once: true });
        api(kind === 'directory' ? '/pick-directory' : '/pick-file', { host: 'local' }).then(result => {
          if (finished) return;
          if (result.host !== host) return finish(null, Error('The picker returned a path from another machine.'));
          finish(result.path ? { host, path: result.path } : null);
        }, error => finish(null, error));
      });
    }
    return await remotePath({ host, kind, path, title, signal });
  } finally {
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  }
}

function remotePath({ host, kind, path, title, signal }) {
  if (!document.querySelector('link[data-path-picker-style]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/path-picker.css';
    link.dataset.pathPickerStyle = '';
    document.head.append(link);
  }
  const dialog = document.createElement('dialog');
  const id = `path-picker-${crypto.randomUUID()}`;
  dialog.className = 'path-picker';
  dialog.setAttribute('aria-labelledby', `${id}-title`);
  dialog.setAttribute('aria-describedby', `${id}-help`);
  dialog.innerHTML = `
    <div class="dialog-title"><div><p class="eyebrow">Execution machine <span class="path-picker-host">${esc(host)}</span></p><h2 id="${id}-title">${esc(title || `Choose ${kind}`)}</h2></div><button type="button" data-action="cancel" aria-label="Close path picker">×</button></div>
    <p class="hint" id="${id}-help">Paths belong to this machine. Select a ${kind}; double-click a directory or press Enter to open it.</p>
    <div class="path-picker-navigation"><button type="button" data-action="home">Home</button><button type="button" data-action="up" disabled>Up</button><nav class="path-picker-breadcrumbs" aria-label="Directory breadcrumbs"></nav></div>
    <form class="path-picker-path"><label>Directory path<input name="path" autocomplete="off" spellcheck="false" autofocus></label><button type="submit">Go</button></form>
    <div class="path-picker-tools"><label class="path-picker-filter">Filter loaded entries only<input name="filter" type="search" autocomplete="off" placeholder="Not a search of this machine"></label><label class="path-picker-hidden"><input name="hidden" type="checkbox">Show hidden</label></div>
    <div class="path-picker-error dialog-error" role="alert" hidden><p></p><button type="button" data-action="retry">Retry</button></div>
    <p class="path-picker-status hint" role="status" aria-live="polite"></p>
    <ul class="path-picker-entries" aria-label="Directory entries"></ul>
    <div class="path-picker-pagination"><p class="path-picker-count hint"></p><button type="button" data-action="more" hidden>Load more</button></div>
    <p class="path-picker-capped hint" hidden>This machine capped the directory listing. The complete directory cannot be shown; enter a known subdirectory path to continue.</p>
    <footer class="path-picker-footer"><p class="path-picker-selection hint"></p><button type="button" data-action="cancel">Cancel</button><button type="button" data-action="select" class="primary" disabled>Choose ${kind}</button></footer>`;
  const $ = selector => dialog.querySelector(selector);
  const pathInput = $('[name=path]'), filter = $('[name=filter]'), hidden = $('[name=hidden]');
  const list = $('.path-picker-entries'), status = $('.path-picker-status');
  const selectButton = $('[data-action=select]'), moreButton = $('[data-action=more]');
  let closed = false, generation = 0, busy = false, selecting = false;
  let page = null, entries = [], selected = null, retry = null;
  pathInput.value = path;

  return new Promise(resolve => {
    const finish = value => {
      if (closed) return;
      closed = true;
      generation++;
      signal?.removeEventListener('abort', cancel);
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    const cancel = () => finish(null);
    const error = (failure, again) => {
      $('.path-picker-error p').textContent = failure.message || String(failure);
      $('.path-picker-error').hidden = false;
      retry = again;
    };
    const clearError = () => { $('.path-picker-error').hidden = true; retry = null; };
    const updateSelection = () => {
      const candidate = selected?.path || (kind === 'directory' ? page?.dir : '');
      selectButton.disabled = busy || selecting || !candidate;
      selectButton.textContent = selecting ? 'Verifying…' : kind === 'directory' && !selected ? 'Choose current directory' : `Choose ${kind}`;
      $('.path-picker-selection').textContent = candidate ? `${selected ? 'Selected' : 'Current directory'}: ${candidate}` : `Select a ${kind}.`;
      for (const button of list.querySelectorAll('[data-entry]')) {
        button.setAttribute('aria-pressed', String(button.dataset.entry === selected?.path));
        button.disabled = busy || selecting || button.dataset.unavailable === 'true';
      }
    };
    const renderEntries = () => {
      const query = filter.value.toLocaleLowerCase();
      const visible = entries.filter(entry => entry.name.toLocaleLowerCase().includes(query));
      list.replaceChildren();
      for (const entry of visible) {
        const rawType = entry.kind === 'symlink' ? entry.link_kind : entry.kind;
        const type = rawType === 'dir' ? 'directory' : rawType;
        const directory = type === 'directory', selectable = type === kind;
        const row = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'path-picker-entry';
        button.dataset.entry = entry.path;
        button.dataset.unavailable = String(!directory && !selectable);
        button.disabled = busy || selecting || !directory && !selectable;
        button.setAttribute('aria-pressed', String(entry.path === selected?.path));
        const name = document.createElement('span');
        name.textContent = entry.name;
        const label = document.createElement('small');
        label.textContent = `${directory ? 'Directory' : type === 'file' ? 'File' : 'Unavailable'}${entry.kind === 'symlink' ? ' · link' : ''}`;
        button.append(name, label);
        button.addEventListener('click', () => {
          clearError();
          if (selectable) { selected = entry; updateSelection(); }
          else if (directory) { selected = null; updateSelection(); }
        });
        button.addEventListener('dblclick', () => directory ? navigate(entry.path) : selectPath(entry.path));
        button.addEventListener('keydown', event => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          if (directory) navigate(entry.path); else if (selectable) selectPath(entry.path);
        });
        row.append(button);
        if (directory) {
          const open = document.createElement('button');
          open.type = 'button';
          open.className = 'path-picker-open';
          open.textContent = 'Open';
          open.setAttribute('aria-label', `Open directory ${entry.name}`);
          open.addEventListener('click', () => navigate(entry.path));
          row.append(open);
        }
        list.append(row);
      }
      $('.path-picker-count').textContent = page ? `${entries.length} of ${page.total} entries loaded${query ? ` · ${visible.length} matching` : ''}` : '';
      if (!busy && !selecting) status.textContent = !page ? '' : !entries.length ? 'This directory is empty.' : !visible.length ? 'No loaded entries match this filter. Load more or clear the filter.' : '';
      updateSelection();
    };
    const breadcrumbs = () => {
      const nav = $('.path-picker-breadcrumbs');
      nav.replaceChildren();
      let current = '';
      for (const segment of ['/', ...page.dir.split('/').filter(Boolean)]) {
        current = segment === '/' ? '/' : `${current === '/' ? '' : current}/${segment}`;
        const destination = current;
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = segment;
        if (destination === page.dir) button.setAttribute('aria-current', 'location');
        button.addEventListener('click', () => navigate(destination));
        nav.append(button);
      }
    };
    const navigate = async (directory, offset = 0) => {
      const ticket = ++generation;
      const append = offset > 0;
      busy = true;
      selecting = false;
      clearError();
      if (!append) {
        page = null; entries = []; selected = null;
        list.replaceChildren();
        $('.path-picker-breadcrumbs').replaceChildren();
        $('[data-action=up]').disabled = true;
        pathInput.value = directory;
        $('.path-picker-count').textContent = '';
      }
      $('.path-picker-capped').hidden = true;
      moreButton.hidden = !append;
      moreButton.disabled = true;
      status.textContent = append ? 'Loading more entries…' : 'Loading directory…';
      list.setAttribute('aria-busy', 'true');
      updateSelection();
      try {
        const query = new URLSearchParams({ host, path: directory, offset: String(offset), hidden: String(hidden.checked) });
        const result = await api(`/filesystem?${query}`);
        if (closed || ticket !== generation) return;
        if (result.host !== host) throw Error('The listing came from another machine.');
        page = result;
        entries = append ? [...entries, ...result.entries] : result.entries;
        pathInput.value = page.dir;
        $('[data-action=up]').disabled = !page.parent || page.parent === page.dir;
        moreButton.hidden = page.next == null;
        $('.path-picker-capped').hidden = !page.capped;
        breadcrumbs();
      } catch (failure) {
        if (closed || ticket !== generation) return;
        status.textContent = '';
        error(failure, () => navigate(directory, offset));
      } finally {
        if (!closed && ticket === generation) {
          busy = false;
          moreButton.disabled = false;
          list.setAttribute('aria-busy', 'false');
          renderEntries();
        }
      }
    };
    const selectPath = async candidate => {
      if (!candidate || busy || selecting || closed) return;
      const ticket = ++generation;
      selecting = true;
      clearError();
      status.textContent = 'Verifying selection on this machine…';
      updateSelection();
      try {
        const result = await api('/filesystem/select', { host, path: candidate, kind });
        if (closed || ticket !== generation) return;
        if (result.host !== host || !result.path) throw Error('The selected path could not be verified on this machine.');
        finish({ host, path: result.path });
      } catch (failure) {
        if (closed || ticket !== generation) return;
        error(failure, () => selectPath(candidate));
      } finally {
        if (!closed && ticket === generation) { selecting = false; status.textContent = ''; updateSelection(); }
      }
    };
    dialog.addEventListener('cancel', event => { event.preventDefault(); cancel(); });
    dialog.addEventListener('close', cancel);
    dialog.addEventListener('click', event => {
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (action === 'cancel') cancel();
      else if (action === 'home') navigate(page?.home || '');
      else if (action === 'up' && page?.parent) navigate(page.parent);
      else if (action === 'more' && page?.next != null && !busy) navigate(page.dir, page.next);
      else if (action === 'retry') retry?.();
      else if (action === 'select') selectPath(selected?.path || (kind === 'directory' ? page?.dir : ''));
    });
    $('.path-picker-path').addEventListener('submit', event => { event.preventDefault(); navigate(pathInput.value); });
    filter.addEventListener('input', renderEntries);
    hidden.addEventListener('change', () => navigate(page?.dir || pathInput.value));
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) return cancel();
    document.body.append(dialog);
    dialog.showModal();
    pathInput.focus();
    navigate(path);
  });
}
