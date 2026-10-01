import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

let child, home, base, port;
async function start() {
  child = Bun.spawn([process.execPath, 'server.mjs'], {
    cwd: import.meta.dir,
    env: { ...process.env, PORT: String(port), TUIOS_INBOX_DATA: home, TUIOS_INBOX_SPOOL: join(home, 'events'), TUIOS_BIN: join(home, 'not-installed') },
    stdout: 'pipe', stderr: 'inherit',
  });
  const reader = child.stdout.getReader();
  const first = await reader.read();
  expect(new TextDecoder().decode(first.value)).toContain('listening on');
  reader.releaseLock();
}
async function stop() { child.kill(); await child.exited; }
async function call(path, body, method = 'POST', headers = {}) {
  return fetch(base + '/api' + path, body === undefined ? { headers } : { method, headers: { 'Content-Type': 'application/json', 'X-Inbox-Request': '1', ...headers }, body: JSON.stringify(body) });
}
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'dispatch-test-'));
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  base = `http://127.0.0.1:${port}`;
  await start();
});
afterAll(async () => { if (child) await stop(); if (home) await rm(home, { recursive: true, force: true }); });

test('task edits and agent profile arguments survive a backend restart', async () => {
  const created = await call('/tasks', { title: 'Durable task', path: home, notes: 'before' });
  expect(created.status).toBe(201);
  const task = await created.json();
  expect((await call(`/tasks/${task.id}`, { status: 'active', notes: 'after' }, 'PATCH')).status).toBe(200);
  const configured = await call('/profiles', { name: 'Reviewer', executable: 'codex', args: ['--model', 'configured-model'], protocol: 'codex', env: { PROJECT_MODE: 'review' } });
  const profile = await configured.json();
  await stop(); await start();
  const state = await (await call('/state')).json();
  expect(state.tasks.find(t => t.id === task.id)).toMatchObject({ title: 'Durable task', path: home, notes: 'after', status: 'active', worktree: '' });
  expect(state.profiles.find(p => p.id === profile.id)).toMatchObject({ executable: 'codex', args: ['--model', 'configured-model'], protocol: 'codex', env: { PROJECT_MODE: 'review' } });
});

test('a remote web page cannot create tasks through the local command server', async () => {
  const before = (await (await call('/state')).json()).tasks.map(t => t.id);
  expect((await call('/tasks', { title: 'Injected', path: home }, 'POST', { Origin: 'https://untrusted.example' })).status).toBe(403);
  expect((await call('/tasks', { title: 'Injected', path: home }, 'POST', { 'X-Inbox-Request': '' })).status).toBe(403);
  expect((await call('/state', undefined, 'GET', { Host: 'untrusted.example' })).status).toBe(403);
  expect((await (await call('/state')).json()).tasks.map(t => t.id)).toEqual(before);
});

test('invalid working directories and non-argv agent arguments are rejected', async () => {
  expect((await call('/tasks', { title: 'Invalid', path: join(home, 'missing') })).status).toBe(400);
  expect((await call('/profiles', { name: 'Bad argv', executable: 'codex', args: '--model x', env: {}, protocol: '' })).status).toBe(400);
  expect((await call('/profiles', { name: 'Bad environment', executable: 'codex', args: [], env: { SECRET: 42 }, protocol: '' })).status).toBe(400);
});
