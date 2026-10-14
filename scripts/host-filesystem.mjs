import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { nativeOwner } from './native-owner.mjs';

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

function hostAlias(host) {
  if (typeof host !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(host)) {
    throw failure('invalid_params', 'Choose an execution machine before selecting a path.');
  }
  return host;
}

function hostPath(path, optional = false) {
  if (typeof path !== 'string' || /[\x00-\x1f\x7f]/.test(path)) {
    throw failure('invalid_params', 'Paths must be text without control characters.');
  }
  if (optional && path === '') return path;
  if (path !== '~' && !path.startsWith('~/') && !path.startsWith('/')) {
    throw failure('invalid_params', 'Choose an absolute path or a path beginning with ~/ on the selected machine.');
  }
  return path;
}

async function remote(host, verb, params) {
  try {
    return await nativeOwner({ owner: host, verb, params });
  } catch (error) {
    if (error.code === 'unknown_verb') {
      error.message = `The native daemon on ${host} does not support ${verb}. Ask its administrator to update TUIOS. ${error.message}`;
    } else if (['forbidden', 'no_permission'].includes(error.code)) {
      error.message = `The native permissions on ${host} refused this path request; choose an allowed path or ask its administrator. ${error.message}`;
    } else if (error.code === 'host_refused') {
      error.message = `The native connection to ${host} was refused because its relay capacity is unavailable. Retry when capacity is available. ${error.message}`;
    } else if (['host_unreachable', 'unavailable', 'protocol_mismatch'].includes(error.code)) {
      error.message = `The native filesystem on ${host} is unavailable. Check its connection in Machines and retry. ${error.message}`;
    }
    throw error;
  }
}

export async function listHostDirectory({ host, path = '', offset = 0, hidden = false }) {
  host = hostAlias(host);
  path = hostPath(path, true);
  if (typeof offset === 'string' && /^\d+$/.test(offset)) offset = Number(offset);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw failure('invalid_params', 'Directory offset must be a finite nonnegative integer.');
  }
  if (hidden === 'true') hidden = true;
  else if (hidden === 'false') hidden = false;
  if (typeof hidden !== 'boolean') throw failure('invalid_params', 'Hidden must be true or false.');
  if (host === 'local') {
    throw failure('invalid_params', 'Use the native local file or directory picker for this machine.');
  }
  const result = await remote(host, 'file-list', { dir: path, offset, limit: 200, hidden });
  return { ...result, host };
}

export async function selectHostPath({ host, path, kind }) {
  host = hostAlias(host);
  path = hostPath(path);
  if (kind !== 'directory' && kind !== 'file') {
    throw failure('invalid_params', 'Path kind must be directory or file.');
  }
  let actual;
  if (host === 'local') {
    path = path === '~' ? homedir() : path.startsWith('~/') ? homedir() + path.slice(1) : path;
    const info = await stat(path);
    actual = info.isDirectory() ? 'dir' : info.isFile() ? 'file' : 'other';
  } else {
    const result = await remote(host, 'file-stat', { path });
    if (!result.exists) throw failure('no_file', `The selected path does not exist on ${host}.`);
    path = result.path;
    actual = result.info.kind === 'symlink' ? result.info.link_kind : result.info.kind;
  }
  const expected = kind === 'directory' ? 'dir' : 'file';
  if (actual !== expected) throw failure('invalid_params', `Choose a ${kind} on ${host}; this path is not a ${kind}.`);
  return { host, path };
}
