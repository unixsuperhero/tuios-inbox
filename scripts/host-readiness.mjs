import { nativeOwner } from './native-owner.mjs';

function reason(error) {
  const hint = typeof error.hint === 'string' ? error.hint : error.hint && JSON.stringify(error.hint);
  return [error.code && `[${error.code}]`, error.message, hint && `Hint: ${hint}`].filter(Boolean).join(' ');
}

function catalogVerbs(catalog) {
  if (catalog?.type !== 'verb_list' || !Array.isArray(catalog.verbs) || catalog.verbs.some(entry => !entry || typeof entry.verb !== 'string' || !/^[a-z][a-z0-9-]*$/.test(entry.verb))) return null;
  return new Set(catalog.verbs.map(entry => entry.verb));
}

function launchOperation(verbs, routes) {
  const available = routes.filter(route => verbs.has(route.verb));
  return available.length
    ? { state: 'supported', reason: `Catalog includes ${available.map(route => route.verb + ' (' + route.name + ')').join(' and ')}. Launch context and permissions are checked only when launching.` }
    : { state: 'unsupported', reason: `Catalog is missing ${routes.map(route => route.verb + ' (' + route.name + ')').join(' and ')}.` };
}

export async function hostReadiness(host, { hosts, localCatalog, remoteCatalog = owner => nativeOwner({ owner, verb: 'list-verbs' }) }) {
  if (typeof host !== 'string' || host.length > 120 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(host) || host === 'task') {
    throw Object.assign(new Error('Choose an execution machine: local or a configured native host alias'), { code: 'invalid_params' });
  }
  const inventory = hosts.find(entry => entry.host === host);
  if (!inventory) throw Object.assign(new Error('Native host not found: ' + host), { code: 'unknown_host' });
  const local = host === 'local';
  const result = {
    host, version: null, checked_at: '',
    connection: { state: 'unknown', reason: '' },
    operations: { pane: null, agent: null, browse: local ? { state: 'supported', reason: 'Uses the native local OS picker; daemon filesystem verbs are not required.' } : null },
  };
  const inventoryDetail = reason({ code: inventory.code, message: [inventory.reason, inventory.detail, typeof inventory.error === 'object' ? inventory.error?.message : inventory.error].filter(Boolean).join('; '), hint: inventory.hint || inventory.error?.hint });
  if (['down', 'saved', 'unreachable'].includes(inventory.status) && !inventory.stale) {
    const operation = { state: 'unavailable', reason: `Native inventory reports ${host} is ${inventory.status}${inventoryDetail ? ': ' + inventoryDetail : ''}. Check its native connection in Machines and refresh.` };
    result.connection = { ...operation }; result.operations.pane = { ...operation }; result.operations.agent = { ...operation };
    if (!local) result.operations.browse = { ...operation };
    result.checked_at = new Date().toISOString();
    return result;
  }
  const unavailable = ['host_unreachable', 'host_refused', 'unavailable', 'protocol_mismatch', 'ECONNREFUSED', 'ENOENT', 'ETIMEDOUT', 'ECONNRESET'];
  let catalog;
  try {
    catalog = await (local ? localCatalog() : remoteCatalog(host));
    if (catalog?.success === false || catalog?.error) {
      const error = catalog.error;
      throw Object.assign(new Error(typeof error === 'string' ? error : error?.message || catalog.message || 'Catalog request refused'), typeof error === 'object' ? error : catalog, { native_verb: 'list-verbs' });
    }
    result.connection = { state: 'connected', reason: 'The native daemon answered the catalog request.' };
    if (typeof catalog?.daemon_version === 'string' && catalog.daemon_version.trim()) result.version = catalog.daemon_version;
    const verbs = catalogVerbs(catalog);
    if (!verbs) {
      const unknown = { state: 'unknown', reason: 'The daemon returned no valid verb catalog. You can explicitly attempt this operation; support and permissions are unverified.' };
      result.operations.pane = { ...unknown }; result.operations.agent = { ...unknown };
      if (!local) result.operations.browse = { ...unknown };
    } else {
      result.operations.pane = launchOperation(verbs, local ? [{ verb: 'new-window', name: 'local pane' }] : [{ verb: 'new-window', name: 'owned-session pane' }, { verb: 'open-pane', name: 'hosted pane' }]);
      result.operations.agent = launchOperation(verbs, local ? [{ verb: 'start-agent', name: 'local agent' }] : [{ verb: 'start-agent', name: 'owned-session agent' }, { verb: 'open-pane', name: 'hosted agent' }]);
      if (!local) {
        const missing = ['file-list', 'file-stat'].filter(verb => !verbs.has(verb));
        result.operations.browse = missing.length
          ? { state: 'unsupported', reason: `Catalog is missing ${missing.join(' and ')} required for remote Browse. Ask its administrator to update the running TUIOS daemon.` }
          : { state: 'supported', reason: 'Catalog includes file-list and file-stat. Path access and permissions are checked only when browsing.' };
      }
    }
  } catch (error) {
    const missing = error.code === 'unknown_verb' || /unknown (?:command|verb).*list-verbs/i.test(error.message);
    const failed = !missing && (unavailable.includes(error.code) || /timed out|disconnected|no daemon|no such file|connection refused|failed to connect|cannot connect|daemon.*not running|socket.*(?:not|must be|refused)/i.test(error.message));
    const detail = `${missing ? 'Native catalog introspection is not available' : failed ? 'Native connection is unavailable' : 'Native catalog could not be checked'}: ${reason(error)}`;
    result.connection = { state: failed ? 'unavailable' : error.native_verb === 'list-verbs' || error.native_verb === 'hello' || local && error.code === 'unknown_verb' ? 'connected' : 'unknown', reason: detail };
    const operation = { state: failed ? 'unavailable' : 'unknown', reason: detail + (failed ? '' : '. You can explicitly attempt this operation; support and permissions are unverified.') };
    result.operations.pane = { ...operation }; result.operations.agent = { ...operation };
    if (!local) result.operations.browse = { ...operation };
  }
  const readOnly = inventory.read_only || ['read-only', 'readonly'].includes(inventory.status);
  const uncertain = inventory.status !== 'up' || inventory.stale || inventory.error;
  for (const operation of ['pane', 'agent', ...(!local ? ['browse'] : [])]) {
    const capability = result.operations[operation];
    if (readOnly) result.operations[operation] = { state: 'unavailable', reason: `The app refuses this operation because native inventory marks ${host} read-only${inventoryDetail ? ': ' + inventoryDetail : ''}. ${capability.reason}` };
    else if (uncertain && capability.state === 'supported') result.operations[operation] = { state: 'unknown', reason: `Native inventory for ${host} is ${inventory.stale ? 'stale' : inventory.status || 'unknown'}${inventoryDetail ? ': ' + inventoryDetail : ''}. ${capability.reason} You can explicitly attempt this operation; current availability is unverified.` };
  }
  result.checked_at = new Date().toISOString();
  return result;
}
