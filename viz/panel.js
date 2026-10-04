// panel.js - the DOM reading pane. Text lives here, not in the canvas: a 3D label can point at a
// record, but reading, replying and approving need real text, focus and native controls.
// Drafts survive live rebuilds because the scene never touches this element.
import { api } from './api.js';
import { fmtTime, fmtAgo } from './model.js';
import { markdown } from '../public/markdown.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const badge = (text, cls = '') => `<span class="badge ${esc(cls)}">${esc(text)}</span>`;

export function createPanel(root, { onSelect, onChanged }) {
  let model = null, selected = null, detail = null, question = null, draft = '';
  const status = (text, cls = '') => { const el = root.querySelector('#status'); if (el) { el.textContent = text; el.className = `status ${cls}`; } };

  function itemRow(item) {
    const agent = item.agentName ? `${item.agentName}${item.harness ? ' · ' + item.harness : ''}` : (item.harness || '');
    return `<li class="${item.unread ? 'unread' : ''}" data-id="${esc(item.id)}">${esc(item.title.slice(0, 140))}<p class="meta"><span>${esc(item.type)}</span><span>${esc(item.status)}</span><span>${esc(agent)}</span><span>${fmtAgo(item.t, model.now)}</span></p></li>`;
  }

  function renderHome() {
    const blocked = model.blocked.length ? `<section class="blocked"><h3>${model.blocked.length} agent${model.blocked.length === 1 ? '' : 's'} waiting on you</h3><ul class="list">${model.blocked.map(a => `<li data-agent="${esc(a.id)}">${esc(a.name)} <span class="badge">${esc(a.harness)}</span><p class="meta">needs input · ${fmtAgo(a.seen, model.now)}</p></li>`).join('')}</ul></section>` : '';
    const away = model.away.length ? `<h3>Finished while you were away</h3><ul class="list">${model.away.slice(0, 60).map(itemRow).join('')}</ul>` : '<h3>Nothing finished while you were away</h3><p class="hint">Unread finished work appears here and glows in the scene.</p>';
    root.innerHTML = `<h2>Review</h2><p class="meta"><span>${model.items.length} records</span><span>${model.agents.length} live panes</span>${model.lastError ? `<span class="badge failed">server: ${esc(model.lastError.slice(0, 80))}</span>` : ''}</p>${blocked}${away}`;
  }

  function renderDetail() {
    const item = selected, d = detail;
    const head = `<p class="hint"><a href="#" id="back">← Review</a></p><h2 class="title ${item.unread ? 'unread' : ''}">${esc(item.title.slice(0, 300))}</h2>
      <p class="meta">${badge(item.unread ? 'Unread' : 'Read', item.unread ? 'unread' : '')} ${badge(item.status, item.status)} ${badge(item.type)}<br>
      <span>${esc(item.agentName || '—')}</span><span>${esc(item.harness)}</span><span>${fmtTime(item.t)}</span></p>`;
    let body = d ? '' : '<p class="hint">Loading…</p>';
    if (d && item.type === 'turn') {
      body = `<div class="record"><p class="role">Prompt</p><pre>${esc(d.prompt)}</pre></div>
        <div class="record"><p class="role">Response <span class="badge ${esc(d.state)}">${esc(d.state)}</span> <span class="badge">${esc(d.source)}</span></p><div class="md">${d.response ? markdown(d.response) : '<p class="hint">No response captured yet.</p>'}</div></div>`;
    } else if (d) {
      body = (d.messages || []).map(m => `<div class="record"><p class="role">${esc(m.role)} <span class="badge ${esc(m.status)}">${esc(m.status)}</span> <span class="hint">${fmtTime(Date.parse(m.created))}</span>${m.meta?.capture_kind ? ` <span class="hint">${esc(m.meta.capture_kind)}</span>` : ''}</p><pre>${esc(m.body)}</pre></div>`).join('') || '<p class="hint">No messages.</p>';
    }
    const agent = model.agents.find(a => a.id === item.agentId);
    const blocked = agent?.state === 'needs_input';
    const canReply = Boolean(agent) && (item.type !== 'turn' || agent.kind === 'agent');
    const actions = `<p class="actions">
      <button type="button" id="toggle-read">${item.unread ? 'Mark reviewed' : 'Mark unread'}</button>
      <button type="button" id="archive" class="danger">Archive</button>
      ${agent ? `<button type="button" id="peek">Peek at pane</button>` : ''}</p>`;
    const ask = blocked ? `<section class="blocked"><h3>${esc(agent.name)} is waiting for an answer</h3>${question ? renderQuestion(question) : '<p class="hint">Loading prompt…</p>'}</section>` : '';
    const reply = canReply ? `<h3>${item.type === 'turn' ? `Continue with ${esc(agent.name)}` : 'Reply in this thread'}</h3><textarea id="draft" placeholder="${item.type === 'turn' ? 'Queued to the agent pane; the result returns as a new turn.' : 'Sent as a message in this thread.'}">${esc(draft)}</textarea><p class="actions"><button type="button" id="send" class="primary">Send</button></p>`
      : `<p class="hint">${agent ? 'This pane takes no replies from here.' : 'The pane that produced this is gone; nothing to reply to.'}</p>`;
    root.innerHTML = `${head}${actions}${ask}${body}${reply}<p id="status" class="status"></p>`;
  }

  function renderQuestion(q) {
    if (!q.found) return `<p class="hint">${esc(q.reason || 'No prompt is showing on that pane right now.')}</p>`;
    const options = (q.options || []).map((o, i) => `<button type="button" data-answer="choose" data-value="${i + 1}">${i + 1}. ${esc(o)}</button>`).join('');
    const actions = (q.actions || []).filter(a => ['approve', 'approve_always', 'deny'].includes(a)).map(a => `<button type="button" data-answer="${a}" class="${a === 'deny' ? 'danger' : 'primary'}">${a.replace('_', ' ')}</button>`).join('');
    return `<pre>${esc((q.lines || []).join('\n'))}</pre><p class="actions">${actions}${options}</p>${q.kind === 'text' || !options ? '<p class="actions"><input id="answer-text" placeholder="Type an answer" style="flex:1"><button type="button" data-answer="text">Answer</button></p>' : ''}`;
  }

  async function select(item) {
    if (selected?.id !== item?.id) { draft = ''; question = null; }
    selected = item; detail = null;
    if (!item) { renderHome(); return; }
    renderDetail();
    const [, kind, rid] = /^(turn|thread):(.+)$/.exec(item.id);
    try { detail = kind === 'turn' ? await api.turn(rid) : await api.thread(rid); } catch (e) { detail = { messages: [], prompt: '', response: '', state: 'error', source: e.message }; }
    if (selected?.id !== item.id) return;
    renderDetail();
    const agent = model.agents.find(a => a.id === item.agentId);
    if (agent?.state === 'needs_input') { try { question = await api.question(agent.id); } catch (e) { question = { found: false, reason: e.message }; } if (selected?.id === item.id) renderDetail(); }
  }

  root.addEventListener('input', e => { if (e.target.id === 'draft') draft = e.target.value; });
  root.addEventListener('click', async e => {
    const li = e.target.closest('li[data-id]'); if (li) { onSelect(model.items.find(i => i.id === li.dataset.id)); return; }
    const ag = e.target.closest('li[data-agent]'); if (ag) { const a = model.agents.find(x => x.id === ag.dataset.agent); const item = model.items.filter(i => i.agentId === a.id).sort((x, y) => y.t - x.t)[0]; if (item) onSelect(item); return; }
    const button = e.target.closest('button, a'); if (!button || !selected) return;
    e.preventDefault();
    const [, , rid] = /^(turn|thread):(.+)$/.exec(selected.id);
    const agent = model.agents.find(a => a.id === selected.agentId);
    const busy = fn => async () => { button.disabled = true; try { await fn(); } catch (err) { status(err.message, 'err'); } finally { button.disabled = false; } };
    if (button.id === 'back') return onSelect(null);
    if (button.id === 'toggle-read') return busy(async () => { await api.updateItems([selected.id], { unread: !selected.unread }); status(selected.unread ? 'Marked reviewed.' : 'Marked unread.', 'ok'); onChanged(); })();
    if (button.id === 'archive') return busy(async () => { await api.updateItems([selected.id], { archived: true }); onChanged(); onSelect(null); })();
    if (button.id === 'peek') return busy(async () => { const r = await api.capture(agent.id); status(r.text || '(blank screen)'); })();
    if (button.id === 'send') return busy(async () => {
      const text = root.querySelector('#draft').value.trim(); if (!text) throw new Error('Nothing to send.');
      if (selected.type === 'turn') await api.promptAgent(agent.id, text); else await api.replyThread(rid, text);
      draft = ''; root.querySelector('#draft').value = '';
      status(selected.type === 'turn' ? 'Queued. The result arrives as a new turn.' : 'Sent.', 'ok'); onChanged();
    })();
    if (button.dataset.answer) return busy(async () => {
      const payload = { action: button.dataset.answer, promptId: question?.promptId };
      if (payload.action === 'choose') payload.value = button.dataset.value;
      if (payload.action === 'text') { payload.value = root.querySelector('#answer-text')?.value.trim(); if (!payload.value) throw new Error('Type an answer first.'); }
      await api.answer(agent.id, payload); status('Answered.', 'ok'); question = null; onChanged();
    })();
  });

  return {
    /** Live update: keep the selection and the draft; refresh the lists. */
    setModel(next) {
      model = next;
      if (!selected) return renderHome();
      const fresh = model.items.find(i => i.id === selected.id);
      if (!fresh) { selected = null; return renderHome(); }
      selected = fresh; renderDetail();
    },
    select, get selected() { return selected; }
  };
}
