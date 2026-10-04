// api.js - the same contract public/pages.js uses: same-origin JSON with the X-Inbox-Request header.
async function call(path, method = 'GET', body) {
  const init = body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json', 'X-Inbox-Request': '1' }, body: JSON.stringify(body) };
  const response = await fetch('/api' + path, init);
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!response.ok) throw new Error(data?.error || `${response.status} ${response.statusText}`);
  return data;
}

export const api = {
  state: () => call('/state'),
  turn: id => call(`/turns/${id}`),
  thread: id => call(`/threads/${id}`),
  updateItems: (ids, set) => call('/items/update', 'POST', { ids, set }),
  replyThread: (id, body, paneId) => call(`/threads/${id}/reply`, 'POST', paneId ? { body, paneId } : { body }),
  promptAgent: (id, body) => call(`/agents/${id}/prompt`, 'POST', { body }),
  question: id => call(`/agents/${id}/question`),
  answer: (id, payload) => call(`/agents/${id}/answer`, 'POST', payload),
  capture: id => call(`/panes/${id}/capture`),
  /** Server pushes `changed` whenever a row moves; the caller refetches state. */
  events(onChange) {
    const stream = new EventSource('/api/events');
    let timer = null;
    stream.onmessage = e => { if (e.data !== 'changed') return; clearTimeout(timer); timer = setTimeout(onChange, 150); };
    return () => stream.close();
  }
};
