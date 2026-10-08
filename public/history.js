// History and Collectors pages: full-text search over the append-only archive, one record in full
// with its provenance, and the health of every collector. Nothing here is polled; reads happen when
// a page opens, on a search, and at most every few seconds when the server announces a change.
import { store, api, esc } from '/pages.js';
import { patchHTML } from '/workbench.js';

const LIMIT = 50, STALE_MS = 5000;
const kinds = ['prompt', 'response', 'tool', 'activity', 'command', 'mail', 'gap'];
const blank = () => ({ q: '', host: '', session: '', agent: '', task: '', from: '', to: '', kind: '' });
const time = value => value ? new Date(value).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
const excerpt = r => { const text = String(r.excerpt ?? r.body ?? '').replace(/\s+/g, ' ').trim(); return text.length > 360 ? text.slice(0, 360) + '…' : text; };
const href = id => `#history/${encodeURIComponent(id)}`;
const dayStart = value => new Date(`${value}T00:00:00`).toISOString();
const dayEnd = value => new Date(`${value}T23:59:59.999`).toISOString();
const count = value => Array.isArray(value) ? value.length : Number(value) || 0;
const json = value => esc(JSON.stringify(value ?? {}, null, 2));

export function createHistory({ root, report }) {
  let route = null;
  const draft = blank();
  let applied = blank(), offset = 0, result = null, searchError = '', searching = false, searchedAt = 0;
  let searchRevision = 0;
  const details = new Map(), detailLoading = new Set();
  let collectors = null, collectorsError = '', collectorsLoading = false, collectorsAt = 0, pulling = false, pullNote = '';

  const supports = r => r?.kind === 'history' || r?.kind === 'index' && (r.page === 'history' || r.page === 'collectors');
  const knownHosts = () => [...new Set([...(collectors?.sources || []).map(s => s.host), ...(result?.records || []).map(r => r.host)].filter(Boolean))].sort();

  function query() {
    const p = new URLSearchParams();
    for (const [key, value] of Object.entries(applied)) {
      const v = value.trim(); if (!v) continue;
      p.set(key, key === 'from' ? dayStart(v) : key === 'to' ? dayEnd(v) : v);
    }
    p.set('limit', LIMIT); p.set('offset', offset);
    return p.toString();
  }
  async function search() {
    const revision = ++searchRevision, parameters = query();
    searching = true; render();
    try {
      const next = await api('/history?' + parameters);
      if (revision === searchRevision) { result = next; searchError = ''; }
    } catch (e) { if (revision === searchRevision) searchError = e.message; }
    finally { if (revision === searchRevision) { searching = false; searchedAt = Date.now(); render(); } }
  }
  async function loadDetail(id) {
    if (detailLoading.has(id)) return;
    detailLoading.add(id); render();
    try { details.set(id, { data: await api('/history/' + encodeURIComponent(id)) }); }
    catch (e) { details.set(id, { error: e.message }); }
    finally { detailLoading.delete(id); render(); }
  }
  async function loadCollectors() {
    if (collectorsLoading) return;
    collectorsLoading = true; render();
    try { collectors = await api('/collectors'); collectorsError = ''; }
    catch (e) { collectorsError = e.message; }
    finally { collectorsLoading = false; collectorsAt = Date.now(); render(); }
  }
  async function pull() {
    if (pulling) return;
    pulling = true; pullNote = ''; render();
    try { await api('/collectors/pull', {}); pullNote = 'Pull finished at ' + new Date().toLocaleTimeString() + '. Per-source results are in the table.'; }
    catch (e) { pullNote = 'Pull failed: ' + e.message; }
    finally { pulling = false; render(); }
    await loadCollectors();
    if (applied.q || result) search();
  }

  function filterForm() {
    const field = (name, label, type = 'text', extra = '') => `<label>${label}<input name="${name}" type="${type}" value="${esc(draft[name])}" autocomplete="off"${extra}></label>`;
    return `<form id="history-form" class="history-filters" role="search" aria-label="Search history">
      <label class="history-q">Search all text<input id="history-q" name="q" type="search" value="${esc(draft.q)}" placeholder="Words from a prompt, response, tool call or command" autocomplete="off"></label>
      ${field('host', 'Host', 'text', ' list="history-hosts"')}${field('session', 'Session')}${field('agent', 'Agent or pane ID')}${field('task', 'Task ID')}
      <label>Kind<select name="kind"><option value="">Any kind</option>${kinds.map(k => `<option value="${k}"${draft.kind === k ? ' selected' : ''}>${k}</option>`).join('')}</select></label>
      ${field('from', 'From', 'date')}${field('to', 'To', 'date')}
      <datalist id="history-hosts">${knownHosts().map(h => `<option value="${esc(h)}"></option>`).join('')}</datalist>
      <div class="history-actions"><button type="submit" class="primary">Search</button><button type="button" data-history="clear">Clear</button></div>
    </form>`;
  }
  function rows(records) {
    return `<div class="native-table-scroll"><table class="native-table history-table"><caption class="sr-only">History records</caption>
      <thead><tr><th scope="col">When</th><th scope="col">Kind</th><th scope="col">Where</th><th scope="col">Text</th><th scope="col">Task</th></tr></thead>
      <tbody>${records.map(r => `<tr data-wb-key="rec:${esc(r.id)}"><td><time datetime="${esc(r.created)}">${esc(time(r.created))}</time></td><td><span class="badge">${esc(r.kind)}</span></td>
        <td><b>${esc(r.host)}</b><small>${esc([r.harness, r.session].filter(Boolean).join(' · '))}</small></td>
        <td class="history-text"><a href="${href(r.id)}">${esc(excerpt(r)) || '(empty)'}</a></td>
        <td>${r.task_id ? `<a href="#task/${encodeURIComponent(r.task_id)}">Task</a>` : '<small>Not linked</small>'}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function pager() {
    const total = result.total, first = total ? result.offset + 1 : 0, last = result.offset + result.records.length;
    return `<nav class="history-pager" aria-label="History pages"><button type="button" data-history="prev"${result.offset <= 0 ? ' disabled' : ''}>Newer</button>
      <span role="status">${first}–${last} of ${total}</span><button type="button" data-history="next"${last >= total ? ' disabled' : ''}>Older</button></nav>`;
  }
  function historyPage() {
    const status = searching ? 'Searching…' : result ? '' : 'Search to read the archive.';
    return `<section id="history-page" class="history" aria-busy="${searching}">${filterForm()}
      ${searchError ? `<p class="history-error" role="alert">${esc(searchError)}</p>` : ''}
      <p class="hint" role="status">${esc(status)}</p>
      ${result ? (result.records.length ? rows(result.records) + pager() : `<p class="native-empty">No history matches these filters. History is filled by collectors; see <a href="#collectors">Collectors</a> if you expected more.</p>`) : ''}</section>`;
  }

  function fact(label, value, link) {
    if (value === '' || value == null) return '';
    return `<div><dt>${esc(label)}</dt><dd>${link ? `<a href="${link}">${esc(value)}</a>` : esc(value)}</dd></div>`;
  }
  function detailPage() {
    const entry = details.get(route.id), r = entry?.data;
    if (entry?.error) return `<section id="history-page" class="history"><p class="history-error" role="alert">${esc(entry.error)}</p><p class="hint"><a href="#history">Back to history</a></p></section>`;
    if (!r) return `<section id="history-page" class="history" aria-busy="true"><p class="hint" role="status">Reading record…</p></section>`;
    const links = [r.task_id && `<a href="#task/${encodeURIComponent(r.task_id)}">Open linked task</a>`, r.pane_id && store.state.agents.some(a => a.id === r.pane_id) && `<a href="#agent/${encodeURIComponent(r.pane_id)}">Open linked agent</a>`].filter(Boolean);
    return `<section id="history-page" class="history">
      <h2 class="history-title"><span class="badge">${esc(r.kind)}</span> ${esc(time(r.created))}</h2>
      <pre class="history-body" tabindex="0" aria-label="Complete record text">${esc(r.body)}</pre>
      ${r.prompt && r.prompt !== r.body ? `<details data-wb-key="prompt"><summary>Prompt</summary><pre class="history-body">${esc(r.prompt)}</pre></details>` : ''}
      ${r.response && r.response !== r.body ? `<details data-wb-key="response"><summary>Response</summary><pre class="history-body">${esc(r.response)}</pre></details>` : ''}
      <h3>Provenance</h3>
      <dl class="native-facts">${fact('Host', r.host)}${fact('Source', r.source)}${fact('Harness', r.harness)}${fact('Session', r.session)}${fact('Pane', r.pane_id)}${fact('Conversation', r.conversation_id)}${fact('Task', r.task_id, r.task_id && `#task/${encodeURIComponent(r.task_id)}`)}${fact('Collector', r.source_id)}${fact('Source record', r.record_id)}${fact('Archive ID', r.id)}${fact('Daemon boot', r.boot_id)}${fact('Sequence', r.seq)}</dl>
      ${links.length ? `<p class="history-links">${links.join(' · ')}</p>` : ''}
      ${r.provenance ? `<details data-wb-key="provenance"><summary>Archive provenance</summary><pre class="history-body">${json(r.provenance)}</pre></details>` : ''}
      <details data-wb-key="meta"><summary>Original record and capture metadata</summary><pre class="history-body">${json(r.meta)}</pre></details></section>`;
  }

  function collectorRow(s) {
    const gaps = count(s.gaps), pending = count(s.pending), failed = Boolean(s.last_error);
    return `<tr data-wb-key="src:${esc(s.host)}:${esc(s.source_id)}"><th scope="row"><b>${esc(s.host)}</b><small>${esc(s.source_id || 'no collector registered')}</small>${s.boot_id ? `<small>boot ${esc(s.boot_id)}</small>` : ''}</th>
      <td>${s.last_collected ? esc(time(s.last_collected)) : '<small>Never collected</small>'}</td>
      <td>${s.last_transfer ? esc(time(s.last_transfer)) : '<small>Never transferred</small>'}</td>
      <td>${pending}</td><td>${gaps ? `<details data-wb-key="gaps:${esc(s.source_id)}"><summary><span class="badge uncertain">${gaps} gaps</span></summary>${(s.gaps_detail || []).map(g => `<p>${esc(g.detail || g.reason || JSON.stringify(g))}</p>`).join('')}<a href="#history">Search history with Kind: gap</a></details>` : '0'}</td>
      <td>${failed ? `<span class="badge error">Error</span> ${esc(s.last_error)}` : '<span class="badge done">None</span>'}</td></tr>`;
  }
  function collectorsPage() {
    const sources = collectors?.sources || [];
    return `<section id="history-page" class="history" aria-busy="${collectorsLoading}">
      <div class="native-toolbar"><p class="hint" role="status">${esc(collectorsLoading ? 'Reading collectors…' : collectorsAt ? 'Read ' + new Date(collectorsAt).toLocaleTimeString() : '')} ${esc(pullNote)}</p>
        <button type="button" class="primary" data-history="pull"${pulling ? ' disabled' : ''}>${pulling ? 'Pulling…' : 'Pull now'}</button></div>
      ${collectorsError ? `<p class="history-error" role="alert">${esc(collectorsError)}</p>` : ''}
      <p class="hint">Collection is the collector reading transcripts and TUIOS events on its own machine. Transfer is this inbox pulling those records over. A host can be collecting and still fail to transfer, or the reverse.</p>
      ${sources.length ? `<div class="native-table-scroll"><table class="native-table history-table"><caption class="sr-only">Collectors</caption>
        <thead><tr><th scope="col">Host</th><th scope="col">Last collected</th><th scope="col">Last transfer</th><th scope="col">Pending</th><th scope="col">Gaps</th><th scope="col">Last error</th></tr></thead>
        <tbody>${sources.map(collectorRow).join('')}</tbody></table></div>` : collectorsAt && !collectorsError ? `<div class="native-empty"><p>No collectors are registered, so nothing is being collected.</p>
        <p>Install the local collector from the project folder:</p><pre class="history-body">bun scripts/setup-cross-host.mjs install</pre>
        <p>Add another machine with its SSH target:</p><pre class="history-body">bun scripts/setup-cross-host.mjs install --remote USER@HOST</pre>
        <p>Add <code>--dry-run</code> to either command to see what it would change first.</p></div>` : ''}</section>`;
  }

  function render(next = route) {
    route = next;
    if (!supports(route)) return;
    const html = route.kind === 'history' ? detailPage() : route.page === 'collectors' ? collectorsPage() : historyPage();
    patchHTML(root, html);
  }
  async function enter(next, changed) {
    route = next;
    if (!supports(next) || !changed && (result || collectors || details.has(next.id))) { render(); return; }
    if (next.kind === 'history') { if (!details.has(next.id)) await loadDetail(next.id); }
    else if (next.page === 'collectors') await loadCollectors();
    else { loadCollectors(); if (!result) await search(); else search(); }
  }
  async function update() {
    if (!supports(route) || route.kind === 'history' || root.contains(document.activeElement) && document.activeElement.matches('input, textarea, select')) return;
    if (route.page === 'collectors') { if (Date.now() - collectorsAt > STALE_MS) await loadCollectors(); }
    else if (Date.now() - searchedAt > STALE_MS) await search();
  }

  root.addEventListener('input', e => { if (supports(route) && e.target.form?.id === 'history-form' && e.target.name in draft) draft[e.target.name] = e.target.value; });
  root.addEventListener('change', e => { if (supports(route) && e.target.form?.id === 'history-form' && e.target.name in draft) draft[e.target.name] = e.target.value; });
  root.addEventListener('submit', e => {
    if (e.target.id !== 'history-form' || !supports(route)) return;
    e.preventDefault();
    if (draft.from && draft.to && draft.from > draft.to) { searchError = 'The From date is after the To date.'; render(); return; }
    applied = { ...draft }; offset = 0; search().catch(report);
  });
  root.addEventListener('click', e => {
    const button = e.target.closest('button[data-history]'); if (!button || !supports(route)) return;
    switch (button.dataset.history) {
      case 'clear': Object.assign(draft, blank()); applied = blank(); offset = 0; search().catch(report); break;
      case 'prev': offset = Math.max(0, offset - LIMIT); search().catch(report); break;
      case 'next': offset += LIMIT; search().catch(report); break;
      case 'pull': pull().catch(report); break;
    }
  });

  return { supports, render, enter, update };
}
