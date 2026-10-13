import { lstat } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { join, normalize } from 'node:path';

async function privateDir(path, uid) {
  try {
    const stat = await lstat(path);
    return stat.isDirectory() && stat.uid === uid && (stat.mode & 0o777) === 0o700;
  } catch {
    return false;
  }
}

function dial(path, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Timed out connecting to native TUIOS socket ${path}`));
    }, timeout);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on('error', error => {
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    });
  });
}

async function ownerSocket() {
  const uid = process.getuid();
  const e2e = process.env.TUIOS_E2E === '1';
  const runRoot = e2e && process.env.TUIOS_E2E_RUN_USER || '/run/user';
  const tmpRoot = e2e && process.env.TUIOS_E2E_TMP || '/tmp';
  const systemRuntime = process.platform === 'darwin' ? '' : join(runRoot, String(uid));
  const runtime = process.env.XDG_RUNTIME_DIR || (systemRuntime && await privateDir(systemRuntime, uid) ? systemRuntime : '');
  const legacy = join(tmpRoot, `tuios-${uid}`);
  const directory = runtime ? join(runtime, 'tuios') : legacy;
  if (!await privateDir(directory, uid)) throw new Error(`Native TUIOS socket directory ${directory} must be an existing uid-owned directory with mode 0700`);
  const primary = join(directory, 'tuios.sock');
  const other = systemRuntime && normalize(directory) === join(systemRuntime, 'tuios') && await privateDir(legacy, uid) ? join(legacy, 'tuios.sock') : '';
  const reported = process.env.TUIOS_SOCKET;
  let socket, selected = primary;
  if (other && reported && normalize(reported) === normalize(other)) {
    socket = await dial(other, 1000).catch(() => null);
    if (socket) selected = other;
  }
  if (!socket) {
    try {
      socket = await dial(primary);
    } catch (error) {
      if (!other) throw error;
      socket = await dial(other, 1000).catch(() => { throw error; });
      selected = other;
    }
  }
  try {
    if (reported && normalize(reported) !== normalize(selected)) {
      const probe = await dial(reported, 1000).catch(() => {
        throw new Error(`TUIOS_SOCKET is set to ${reported}, where no daemon is listening. It reports a pane's daemon; it does not select one. Set XDG_RUNTIME_DIR and XDG_STATE_HOME to use a separate daemon, or unset TUIOS_SOCKET. Native socket selection was ${selected}`);
      });
      probe.destroy();
    }
    return socket;
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

export async function nativeOwner({ owner, verb, params = {} }) {
  const socket = await ownerSocket();
  try {
    return await new Promise((resolve, reject) => {
      const requests = [
        { id: 1, verb: 'open-host-connection', params: { host: owner } },
        { id: 2, verb: 'hello', params: { client: 'tuios-inbox', version: '', protocol: 1 } },
        { id: 3, verb, params },
      ];
      let step = 0, buffered = '';
      let timer;
      const fail = error => {
        clearTimeout(timer);
        reject(error);
        socket.destroy();
      };
      const send = () => {
        clearTimeout(timer);
        timer = setTimeout(() => fail(new Error(`Native owner ${owner} timed out waiting for ${requests[step].verb}`)), 30000);
        socket.write(`${JSON.stringify(requests[step])}\n`);
      };
      socket.setEncoding('utf8');
      socket.once('error', fail);
      socket.once('close', () => fail(new Error(`Native owner ${owner} disconnected before ${verb} completed`)));
      socket.on('data', chunk => {
        buffered += chunk;
        let end;
        while ((end = buffered.indexOf('\n')) !== -1) {
          const line = buffered.slice(0, end);
          buffered = buffered.slice(end + 1);
          try {
            const reply = JSON.parse(line);
            if (reply.id !== requests[step].id) continue;
            if (reply.error) {
              const error = new Error(reply.error.message || `Native owner ${owner} rejected ${requests[step].verb}`);
              Object.assign(error, reply.error);
              if (reply.result) Object.assign(error, { result: reply.result, window_id: reply.result.window_id || reply.result.id });
              fail(error);
              return;
            }
            if (!Object.hasOwn(reply, 'result')) throw new Error(`Native owner ${owner} returned no result for ${requests[step].verb}`);
            if (step === requests.length - 1) {
              clearTimeout(timer);
              resolve(reply.result);
              return;
            }
            step++;
            send();
          } catch (error) {
            fail(error);
            return;
          }
        }
      });
      if (socket.destroyed) fail(new Error(`Native owner ${owner} disconnected before the relay started`));
      else send();
    });
  } finally {
    socket.destroy();
  }
}
