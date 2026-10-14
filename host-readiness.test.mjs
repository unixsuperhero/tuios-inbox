import { expect, test } from 'bun:test';
import { hostReadiness } from './scripts/host-readiness.mjs';

const hosts = [{ host: 'local', status: 'up' }, { host: 'build', status: 'up' }, { host: 'offline', status: 'down' }];
const catalog = (...verbs) => ({ type: 'verb_list', daemon_version: 'test-daemon', version: 1, verbs: verbs.map(verb => ({ verb })) });
const check = (host, value) => hostReadiness(host, { hosts, localCatalog: async () => value, remoteCatalog: async () => value });
const rejected = (host, code, message, extra = {}) => hostReadiness(host, { hosts, localCatalog: async () => { throw Object.assign(new Error(message), { code, ...extra }); }, remoteCatalog: async () => { throw Object.assign(new Error(message), { code, ...extra }); } });

test('local readiness distinguishes pane and agent verbs and keeps OS Browse independent', async () => {
  const result = await check('local', catalog('new-window'));
  expect(result).toMatchObject({ host: 'local', version: 'test-daemon', connection: { state: 'connected' }, operations: { pane: { state: 'supported' }, agent: { state: 'unsupported' }, browse: { state: 'supported' } } });
  expect(Number.isFinite(Date.parse(result.checked_at))).toBe(true);
  const agent = await check('local', catalog('start-agent'));
  expect(agent.operations).toMatchObject({ pane: { state: 'unsupported' }, agent: { state: 'supported' }, browse: { state: 'supported' } });
});

test('hosted remote launches remain supported without owned-session launch or Browse verbs', async () => {
  const result = await check('build', catalog('open-pane'));
  expect(result.operations).toEqual({
    pane: { state: 'supported', reason: 'Catalog includes open-pane (hosted pane). Launch context and permissions are checked only when launching.' },
    agent: { state: 'supported', reason: 'Catalog includes open-pane (hosted agent). Launch context and permissions are checked only when launching.' },
    browse: { state: 'unsupported', reason: 'Catalog is missing file-list and file-stat required for remote Browse. Ask its administrator to update the running TUIOS daemon.' },
  });
});

test('remote owned-session launches and both filesystem verbs have independent support', async () => {
  const result = await check('build', catalog('new-window', 'start-agent', 'file-list', 'file-stat'));
  expect(result.operations).toMatchObject({ pane: { state: 'supported' }, agent: { state: 'supported' }, browse: { state: 'supported' } });
  const partial = await check('build', catalog('new-window', 'file-list'));
  expect(partial.operations).toMatchObject({ pane: { state: 'supported' }, agent: { state: 'unsupported' }, browse: { state: 'unsupported', reason: 'Catalog is missing file-stat required for remote Browse. Ask its administrator to update the running TUIOS daemon.' } });
  const absent = await check('build', catalog('file-list', 'file-stat'));
  expect(absent.operations).toMatchObject({ pane: { state: 'unsupported' }, agent: { state: 'unsupported' }, browse: { state: 'supported' } });
});

test('missing or malformed catalogs stay unknown rather than claiming operations are unsupported', async () => {
  for (const value of [{}, { type: 'verb_list', verbs: ['new-window'] }, { type: 'verb_list', verbs: [{ verb: '' }] }]) {
    const result = await check('build', value);
    expect(result).toMatchObject({ version: null, connection: { state: 'connected' }, operations: { pane: { state: 'unknown' }, agent: { state: 'unknown' }, browse: { state: 'unknown' } } });
    expect(result.operations.agent.reason).toContain('explicitly attempt');
  }
  const missing = await rejected('build', 'unknown_verb', 'unknown verb list-verbs', { native_verb: 'list-verbs' });
  expect(missing).toMatchObject({ version: null, connection: { state: 'connected' }, operations: { pane: { state: 'unknown' }, agent: { state: 'unknown' }, browse: { state: 'unknown' } } });
  expect(missing.operations.agent.reason).toContain('introspection is not available');
});

test('failed connections remain visible and unavailable while local OS Browse remains usable', async () => {
  const remote = await rejected('offline', 'host_unreachable', 'link is down');
  expect(remote).toMatchObject({ host: 'offline', version: null, connection: { state: 'unavailable' }, operations: { pane: { state: 'unavailable' }, agent: { state: 'unavailable' }, browse: { state: 'unavailable' } } });
  const local = await rejected('local', 'ECONNREFUSED', 'socket refused');
  expect(local.operations).toMatchObject({ pane: { state: 'unavailable' }, agent: { state: 'unavailable' }, browse: { state: 'supported' } });
});

test('catalog denials retain code and hint without claiming general launch permissions', async () => {
  const result = await rejected('build', 'forbidden', 'needs list grant', { native_verb: 'list-verbs', hint: { command: 'tuios pane-grants', detail: 'Ask the administrator' } });
  expect(result).toMatchObject({ connection: { state: 'connected' }, operations: { pane: { state: 'unknown' }, agent: { state: 'unknown' }, browse: { state: 'unknown' } } });
  expect(result.operations.agent.reason).toContain('[forbidden] needs list grant');
  expect(result.operations.agent.reason).toContain('tuios pane-grants');
  expect(result.operations.agent.reason).toContain('Ask the administrator');
  const relay = await rejected('build', 'unknown_verb', 'unknown verb open-host-connection', { native_verb: 'open-host-connection' });
  expect(relay.connection.state).toBe('unknown');
});

test('relay capacity refusal is unavailable rather than a permission denial', async () => {
  const result = await rejected('build', 'host_refused', 'maximum relays reached', { native_verb: 'open-host-connection' });
  expect(result.operations.agent).toEqual({ state: 'unavailable', reason: 'Native connection is unavailable: [host_refused] maximum relays reached' });
});

test('readiness rejects nonaliases and absent inventory hosts, not configured unavailable hosts', async () => {
  for (const host of [null, '', 'task', 'build:work', '../build', 'not-configured']) {
    await expect(check(host, catalog('open-pane'))).rejects.toThrow(host === 'not-configured' ? 'Native host not found' : 'Choose an execution machine');
  }
  expect(await check('offline', catalog('open-pane'))).toMatchObject({ host: 'offline', version: null, connection: { state: 'unavailable' }, operations: { agent: { state: 'unavailable' } } });
});

test('inventory policy distinguishes catalog support from app availability', async () => {
  const assess = entry => hostReadiness('build', { hosts: [{ host: 'build', ...entry }], remoteCatalog: async () => catalog('open-pane', 'file-list', 'file-stat') });
  for (const entry of [{ status: 'read-only' }, { status: 'readonly' }, { status: 'up', read_only: true }]) {
    const result = await assess({ ...entry, reason: 'configured by administrator' });
    expect(result).toMatchObject({ connection: { state: 'connected' }, operations: { pane: { state: 'unavailable' }, agent: { state: 'unavailable' }, browse: { state: 'unavailable' } } });
    expect(result.operations.agent.reason).toContain('marks build read-only');
    expect(result.operations.agent.reason).toContain('configured by administrator');
    expect(result.operations.agent.reason).toContain('Catalog includes open-pane');
  }
  for (const entry of [{ status: 'up', stale: true }, { status: 'unknown' }, {}, { status: 'up', error: 'listing was unavailable' }]) {
    const result = await assess(entry);
    expect(result).toMatchObject({ connection: { state: 'connected' }, operations: { pane: { state: 'unknown' }, agent: { state: 'unknown' }, browse: { state: 'unknown' } } });
    expect(result.operations.agent.reason).toContain('explicitly attempt');
  }
  const offline = await hostReadiness('build', { hosts: [{ host: 'build', status: 'down', code: 'host_unreachable', reason: 'native link closed' }], remoteCatalog: async () => { throw new Error('Offline catalog must not be queried'); } });
  expect(offline.connection).toEqual({ state: 'unavailable', reason: 'Native inventory reports build is down: [host_unreachable] native link closed. Check its native connection in Machines and refresh.' });
});
