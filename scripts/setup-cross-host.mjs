#!/usr/bin/env bun
// Installs the independent collector (and optionally the Inbox backend) as a user service,
// wires the capture hook into the active tuios config, and registers SSH sources centrally.
import { chmod, mkdir, readFile, rename, rm, writeFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoDir = dirname(scriptsDir);
const ENTRYPOINTS = ['collector.mjs', 'capture-hook.mjs'];
const HOOK_EVENTS = ['after-agent-state', 'after-command-finished'];
const HOOK_MARK = 'capture-hook.mjs';
const COLLECTOR_LABEL = 'com.tuios-inbox.collector';
const SERVER_LABEL = 'com.tuios-inbox.server';
const SYSTEMD_COLLECTOR = 'tuios-inbox-collector.service';
const SYSTEMD_SERVER = 'tuios-inbox-server.service';

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

const shq = (value) => (/^[\w@%+=:,./-]+$/.test(String(value)) ? String(value) : shellQuote(value));

// The tuios daemon runs hooks through a shell, so paths with spaces are quoted and the chosen native
// binary and collector queue travel with the command instead of relying on the daemon's environment.
export function hookCommand({ bun, hookScript, tuios, collectorData }) {
  const env = [tuios && `TUIOS_BIN=${shq(tuios)}`, collectorData && `TUIOS_INBOX_COLLECTOR_DATA=${shq(collectorData)}`].filter(Boolean);
  return [...(env.length ? ['env', ...env] : []), shq(bun), shq(hookScript)].join(' ');
}

const xml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

export function launchdPlist({ label, argv, env, workdir, logPath }) {
  const entries = Object.entries(env).map(([k, v]) => `    <key>${xml(k)}</key>\n    <string>${xml(v)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>
${argv.map((a) => `    <string>${xml(a)}</string>`).join('\n')}
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(workdir)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${entries}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(logPath)}</string>
</dict>
</plist>
`;
}

function unitText(v, what) {
  if (/[\n\r\0]/.test(String(v))) throw new Error(`${what} contains a line break and cannot be written to a systemd unit`);
  return String(v);
}
const unitEscape = (v) => unitText(v, 'value').replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%');
// ExecStart= expands $VAR, so a literal $ is doubled there; Environment= does not expand, so it stays single.
const execQuote = (v) => `"${unitEscape(v).replaceAll('$', '$$$$')}"`;
const envQuote = (v) => `"${unitEscape(v)}"`;
const unitPath = (v) => unitText(v, 'path').replaceAll('%', '%%');

export function systemdUnit({ description, argv, env, workdir, logPath }) {
  const lines = Object.entries(env).map(([k, v]) => `Environment=${envQuote(`${k}=${v}`)}`);
  return `[Unit]
Description=${unitText(description, 'description')}

[Service]
Type=simple
ExecStart=${argv.map(execQuote).join(' ')}
WorkingDirectory=${unitPath(workdir)}
${lines.join('\n')}
Restart=always
RestartSec=10
StandardOutput=append:${unitPath(logPath)}
StandardError=append:${unitPath(logPath)}

[Install]
WantedBy=default.target
`;
}

// ---- tuios config [hooks] editing: keeps every unrelated line byte-for-byte ----

const tomlString = (s) => (s.includes("'") || /[\n\r]/.test(s) ? JSON.stringify(s) : `'${s}'`);

function parseValue(rest, event) {
  const body = rest.trim();
  const re = /'([^']*)'|"((?:[^"\\]|\\.)*)"/y;
  const strings = (text) => {
    const items = []; let i = 0;
    while (i < text.length) {
      re.lastIndex = i;
      const m = re.exec(text);
      if (m) { items.push(m[1] ?? JSON.parse(`"${m[2]}"`)); i = re.lastIndex; continue; }
      if (/[\s,]/.test(text[i])) { i++; continue; }
      throw new Error(`Cannot safely edit [hooks] ${event}: unsupported value ${body}. Edit it by hand.`);
    }
    return items;
  };
  if (body.startsWith('[')) {
    const close = body.lastIndexOf(']');
    if (close < 0) throw new Error(`Cannot safely edit [hooks] ${event}: multi-line array. Edit it by hand.`);
    return { items: strings(body.slice(1, close)), array: true };
  }
  re.lastIndex = 0;
  const m = re.exec(body);
  if (!m || (body.slice(re.lastIndex).trim() && !body.slice(re.lastIndex).trim().startsWith('#'))) {
    throw new Error(`Cannot safely edit [hooks] ${event}: unsupported value ${body}. Edit it by hand.`);
  }
  return { items: [m[1] ?? JSON.parse(`"${m[2]}"`)], array: false };
}

// mapItems(event, items) -> new items. Returns { text, changed }.
export function editHooks(text, events, mapItems) {
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  let start = lines.findIndex((l) => /^\s*\[hooks\]\s*(#.*)?$/.test(l));
  const render = (event, items, array) => (!array && items.length === 1 ? `${event} = ${tomlString(items[0])}` : `${event} = [${items.map(tomlString).join(', ')}]`);
  if (start < 0) {
    const adds = events.map((e) => ({ e, items: mapItems(e, []) })).filter((x) => x.items.length);
    if (!adds.length) return { text, changed: false };
    const trimmed = text.replace(/\s+$/, '');
    const block = ['[hooks]', ...adds.map((x) => render(x.e, x.items, false))].join(nl);
    return { text: `${trimmed}${trimmed ? nl + nl : ''}${block}${nl}`, changed: true };
  }
  let end = lines.findIndex((l, i) => i > start && /^\s*\[/.test(l));
  if (end < 0) end = lines.length;
  let changed = false;
  for (const event of events) {
    const index = lines.findIndex((l, i) => i > start && i < end && new RegExp(`^\\s*${event}\\s*=`).test(l));
    if (index < 0) {
      const items = mapItems(event, []);
      if (items.length) { lines.splice(start + 1, 0, render(event, items, false)); end++; changed = true; }
      continue;
    }
    const { items, array } = parseValue(lines[index].replace(/^[^=]*=/, ''), event);
    const next = mapItems(event, items);
    if (JSON.stringify(next) === JSON.stringify(items)) continue;
    changed = true;
    if (next.length) lines[index] = render(event, next, array);
    else { lines.splice(index, 1); end--; }
  }
  return { text: changed ? lines.join(nl) : text, changed };
}

export const installHookItems = (command) => (_event, items) => {
  const mapped = items.map((i) => (i.includes(HOOK_MARK) ? command : i));
  if (!mapped.includes(command)) mapped.push(command);
  return [...new Set(mapped)];
};

export const removeHookItems = (replacement) => (_event, items) => {
  const out = [];
  for (const i of items) {
    if (!i.includes(HOOK_MARK)) out.push(i);
    else if (replacement && !out.includes(replacement)) out.push(replacement);
  }
  return out;
};

export function mergeSources(existing, entry) {
  const others = existing.filter((s) => s.host !== entry.host);
  return [...others, entry];
}

export const dropSource = (existing, host) => existing.filter((s) => s.host !== host);

// ---- runtime file closure ----

// `extra` lists standalone files that nothing imports, such as the shell module chosen for the target.
export async function runtimeFiles(dir = scriptsDir, extra = []) {
  const seen = new Map();
  const queue = [...ENTRYPOINTS, ...extra];
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    let body;
    try { body = await readFile(join(dir, name), 'utf8'); } catch {
      throw new Error(`Collector runtime file ${join(dir, name)} is missing; the collector scripts must exist before installing.`);
    }
    seen.set(name, body);
    for (const m of body.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"]\.\/([\w.-]+\.(?:mjs|js))['"]/g)) queue.push(m[1]);
  }
  return seen;
}

// ---- targets: the same planner drives this machine or an SSH host ----

async function spawnCapture(argv, { input, timeout = 30000, env } = {}) {
  let proc;
  try {
    proc = Bun.spawn(argv, { stdin: input == null ? 'ignore' : new Blob([input]), stdout: 'pipe', stderr: 'pipe', env: env ?? process.env });
  } catch (error) { return { code: 127, out: '', err: error.message }; }
  const timer = setTimeout(() => proc.kill(), timeout);
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  clearTimeout(timer);
  return { code, out, err };
}

export async function localTarget({ home = homedir(), run = spawnCapture, bun, tuios, env = process.env } = {}) {
  const os = process.platform === 'darwin' ? 'Darwin' : process.platform === 'linux' ? 'Linux' : process.platform;
  const pathDirs = (env.PATH || '').split(':').filter(Boolean);
  const find = (name) => {
    for (const d of pathDirs) { const p = join(d, name); if (Bun.file(p).size > 0) return p; }
    return null;
  };
  const target = {
    kind: 'local', label: 'local', ssh: null, os, home, env,
    uid: process.getuid?.() ?? 0,
    bun: bun || find('bun') || (/bun/.test(process.execPath || '') ? process.execPath : null),
    tuios: tuios || find('tuios'),
    run: (argv, opts) => run(argv, { ...opts, env }),
    async read(p) { try { return await readFile(p, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } },
    async write(p, data, mode = 0o600) {
      await mkdir(dirname(p), { recursive: true, mode: 0o700 });
      const tmp = `${p}.${process.pid}.tmp`;
      await writeFile(tmp, data, { mode });
      await chmod(tmp, mode);
      await rename(tmp, p);
    },
    async writeInPlace(p, data) { await writeFile(p, data); },
    async copy(from, to) { await writeFile(to, await readFile(from)); },
    async remove(p, opts = {}) { await rm(p, { force: true, recursive: !!opts.recursive }); },
    async mkdirp(p) { await mkdir(p, { recursive: true, mode: 0o700 }); },
    async realpath(p) { try { return await realpath(p); } catch { return p; } },
  };
  return target;
}

export async function remoteTarget(ssh, { run = spawnCapture, env = process.env } = {}) {
  const sshArgv = (cmd) => ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', ssh, '--', cmd];
  const exec = (cmd, opts = {}) => run(sshArgv(cmd), { timeout: 60000, ...opts, env });
  const probeScript = [
    'echo "OS=$(uname -s)"', 'echo "HOME=$HOME"', 'echo "UID=$(id -u)"',
    'P="$PATH:$HOME/.bun/bin:$HOME/.local/bin:$HOME/bin:/opt/homebrew/bin:/usr/local/bin"',
    'find() { PATH="$P" command -v "$1" || "${SHELL:-sh}" -lc "command -v $1" 2>/dev/null | tail -n1; }',
    'echo "BUN=$(find bun)"', 'echo "TUIOS=$(find tuios)"', 'echo "PATH=$P"',
  ].join('; ');
  const probe = await exec(`sh -c ${shellQuote(probeScript)}`);
  if (probe.code !== 0) throw new Error(`Cannot reach ${ssh} over non-interactive ssh (BatchMode, no host-key bypass): ${(probe.err || probe.out).trim() || `exit ${probe.code}`}. Fix ssh access (keys, known_hosts) first.`);
  const facts = Object.fromEntries(probe.out.split('\n').map((l) => l.match(/^([A-Z]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
  if (!facts.HOME?.startsWith('/')) throw new Error(`Remote ${ssh} did not report an absolute home directory.`);
  const sh = (script, opts) => exec(`sh -c ${shellQuote(script)}`, opts);
  return {
    kind: 'remote', label: ssh, ssh, os: facts.OS, home: facts.HOME, env: { PATH: facts.PATH || '' }, uid: Number(facts.UID),
    bun: facts.BUN?.startsWith('/') ? facts.BUN : null,
    tuios: facts.TUIOS?.startsWith('/') ? facts.TUIOS : null,
    run: (argv, opts = {}) => exec(argv.map(shellQuote).join(' '), opts),
    async read(p) {
      const r = await sh(`if [ -e ${shellQuote(p)} ]; then cat ${shellQuote(p)}; else exit 3; fi`);
      if (r.code === 3) return null;
      if (r.code !== 0) throw new Error(`Cannot read ${ssh}:${p}: ${r.err.trim()}`);
      return r.out;
    },
    async write(p, data, mode = 0o600) {
      const tmp = `${p}.tmp.$$`;
      const r = await sh(`umask 077; mkdir -p ${shellQuote(posix.dirname(p))} && cat > ${shellQuote(tmp)} && chmod ${mode.toString(8)} ${shellQuote(tmp)} && mv ${shellQuote(tmp)} ${shellQuote(p)}`, { input: data });
      if (r.code !== 0) throw new Error(`Cannot write ${ssh}:${p}: ${r.err.trim()}`);
    },
    async writeInPlace(p, data) {
      const r = await sh(`cat > ${shellQuote(p)}`, { input: data });
      if (r.code !== 0) throw new Error(`Cannot write ${ssh}:${p}: ${r.err.trim()}`);
    },
    async remove(p, opts = {}) { await sh(`rm -f${opts.recursive ? 'r' : ''} ${shellQuote(p)}`); },
    async mkdirp(p) { await sh(`umask 077; mkdir -p ${shellQuote(p)}`); },
    async realpath(p) { return p; },
  };
}

// ---- paths and specs for one target ----

export function layout(target, opts = {}) {
  const home = target.home;
  const local = target.kind === 'local';
  const dataRoot = join(home, '.local/share/tuios-inbox');
  const runtimeRoot = join(dataRoot, 'collector-runtime');
  const stateDir = join(home, '.local/state/tuios-inbox');
  const collectorData = opts.data || (local && target.env.TUIOS_INBOX_COLLECTOR_DATA) || join(dataRoot, 'collector');
  const centralData = (local && target.env.TUIOS_INBOX_DATA) || dataRoot;
  const unitDir = target.os === 'Darwin' ? join(home, 'Library/LaunchAgents') : join(home, '.config/systemd/user');
  const darwin = target.os === 'Darwin';
  return {
    dataRoot, runtimeRoot, runtimeScripts: join(runtimeRoot, 'scripts'), stateDir, collectorData, centralData,
    collectorScript: join(runtimeRoot, 'scripts/collector.mjs'),
    hookScript: join(runtimeRoot, 'scripts/capture-hook.mjs'),
    collectorsJson: join(centralData, 'collectors.json'),
    services: {
      collector: { name: darwin ? COLLECTOR_LABEL : SYSTEMD_COLLECTOR, file: join(unitDir, darwin ? `${COLLECTOR_LABEL}.plist` : SYSTEMD_COLLECTOR), log: join(stateDir, 'collector.log') },
      server: { name: darwin ? SERVER_LABEL : SYSTEMD_SERVER, file: join(unitDir, darwin ? `${SERVER_LABEL}.plist` : SYSTEMD_SERVER), log: join(stateDir, 'server.log') },
    },
  };
}

const PASS_ENV = ['XDG_RUNTIME_DIR', 'XDG_STATE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME'];

export function serviceEnv(target, paths, extra = {}) {
  // The caller's real PATH is kept so agent executables (claude, codex, omp...) resolve under the service too.
  const real = (target.env.PATH || '').split(':').filter((d) => d.startsWith('/'));
  const dirs = [target.bun && dirname(target.bun), target.tuios && dirname(target.tuios), ...real, '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].filter(Boolean);
  const env = { HOME: target.home, PATH: [...new Set(dirs)].join(':') };
  for (const key of PASS_ENV) if (target.env[key]) env[key] = target.env[key];
  if (target.tuios) env.TUIOS_BIN = target.tuios;
  return { ...env, ...extra };
}

export function serviceSpec(target, paths, which, { host, port } = {}) {
  const s = paths.services[which];
  const darwin = target.os === 'Darwin';
  const collector = which === 'collector';
  const argv = collector
    ? [target.bun, paths.collectorScript, 'run', '--data', paths.collectorData, ...(host ? ['--host', host] : []), ...(target.tuios ? ['--tuios-bin', target.tuios] : [])]
    : [target.bun, join(repoDir, 'server.mjs')];
  const extra = collector ? { TUIOS_INBOX_COLLECTOR_DATA: paths.collectorData, ...(host ? { TUIOS_INBOX_HOST: host } : {}) } : { PORT: String(port || 4399), TUIOS_INBOX_DATA: paths.centralData };
  const env = serviceEnv(target, paths, extra);
  const workdir = collector ? paths.runtimeRoot : repoDir;
  const content = darwin
    ? launchdPlist({ label: s.name, argv, env, workdir, logPath: s.log })
    : systemdUnit({ description: collector ? 'TUIOS Inbox collector' : 'TUIOS Inbox backend', argv, env, workdir, logPath: s.log });
  return { ...s, which, content, argv, env };
}

// ---- reporting ----

class Report {
  constructor(dry) { this.dry = dry; this.lines = []; this.warnings = []; this.failures = []; this.incomplete = []; this.restart = []; }
  note(text) { this.lines.push(text); }
  warn(text) { this.warnings.push(text); }
  fail(text) { this.failures.push(text); }
  gap(text) { this.incomplete.push(text); }
  async step(text, fn) {
    if (this.dry) { this.lines.push(`would: ${text}`); return null; }
    try { const r = await fn(); this.lines.push(`done: ${text}`); return r; } catch (e) { this.failures.push(`${text}: ${e.message}`); return null; }
  }
  print(out = console.log) {
    for (const l of this.lines) out(l);
    for (const w of this.warnings) out(`warning: ${w}`);
    for (const r of this.restart) out(`restart needed: ${r}`);
    for (const f of this.failures) out(`FAILED: ${f}`);
    for (const g of this.incomplete) out(`INCOMPLETE: ${g}`);
  }
}

// ---- service control ----

const svc = {
  async loaded(t, spec) {
    if (t.os === 'Darwin') {
      const r = await t.run(['launchctl', 'print', `gui/${t.uid}/${spec.name}`]);
      return { loaded: r.code === 0, running: /state = running/.test(r.out), detail: (r.out.match(/pid = (\d+)/) || [])[1] };
    }
    const a = await t.run(['systemctl', '--user', 'is-active', spec.name]);
    const e = await t.run(['systemctl', '--user', 'is-enabled', spec.name]);
    return { loaded: e.out.trim() === 'enabled' || a.out.trim() === 'active', running: a.out.trim() === 'active', detail: `${a.out.trim()}/${e.out.trim()}` };
  },
  async must(t, argv) {
    const r = await t.run(argv);
    if (r.code !== 0) throw new Error(`${argv.join(' ')} exited ${r.code}: ${(r.err || r.out).trim()}`);
    return r;
  },
  async bootstrap(t, spec) {
    if (t.os === 'Darwin') await svc.must(t, ['launchctl', 'bootstrap', `gui/${t.uid}`, spec.file]);
    else { await svc.must(t, ['systemctl', '--user', 'daemon-reload']); await svc.must(t, ['systemctl', '--user', 'enable', '--now', spec.name]); }
  },
  async unload(t, spec) {
    if (t.os === 'Darwin') await t.run(['launchctl', 'bootout', `gui/${t.uid}/${spec.name}`]);
    else await t.run(['systemctl', '--user', 'stop', spec.name]);
  },
  async disable(t, spec) {
    if (t.os === 'Darwin') await t.run(['launchctl', 'bootout', `gui/${t.uid}/${spec.name}`]);
    else await t.run(['systemctl', '--user', 'disable', '--now', spec.name]);
  },
  async restart(t, spec, reloadConfig = true) {
    if (t.os === 'Darwin' && !reloadConfig) return svc.must(t, ['launchctl', 'kickstart', '-k', `gui/${t.uid}/${spec.name}`]);
    if (t.os === 'Darwin') {
      await svc.must(t, ['launchctl', 'bootout', `gui/${t.uid}/${spec.name}`]);
      const deadline = Date.now() + 5000;
      while ((await svc.loaded(t, spec)).loaded) {
        if (Date.now() >= deadline) throw new Error(`${spec.name} did not unload within 5 seconds`);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      await svc.bootstrap(t, spec);
    }
    else { await svc.must(t, ['systemctl', '--user', 'daemon-reload']); await svc.must(t, ['systemctl', '--user', 'restart', spec.name]); }
  },
  async start(t, spec) {
    const state = await svc.loaded(t, spec);
    if (!state.loaded) return svc.bootstrap(t, spec);
    if (state.running) return;
    if (t.os === 'Darwin') await svc.must(t, ['launchctl', 'kickstart', `gui/${t.uid}/${spec.name}`]);
    else await svc.must(t, ['systemctl', '--user', 'start', spec.name]);
  },
};

async function portBusy(port) {
  try {
    const sock = await Bun.connect({ hostname: '127.0.0.1', port, socket: { data() {}, open(s) { s.end(); }, close() {}, error() {} } });
    sock.end?.();
    return true;
  } catch { return false; }
}

// ---- tuios facts ----

async function activeConfigPath(t, report) {
  if (!t.tuios) return null;
  const r = await t.run([t.tuios, 'config', 'path']);
  const p = r.out.trim().split('\n').pop();
  if (r.code !== 0 || !p.startsWith('/')) { report.warn(`'tuios config path' failed on ${t.label}: ${(r.err || r.out).trim()}`); return null; }
  return p;
}

async function nativeHosts(t) {
  if (!t.tuios) return { error: 'tuios binary not found', hosts: [] };
  const r = await t.run([t.tuios, 'hosts', '--json']);
  if (r.code !== 0) return { error: (r.err || r.out).trim() || `exit ${r.code}`, hosts: [] };
  try { const j = JSON.parse(r.out); return { hosts: Array.isArray(j.hosts) ? j.hosts : [], total: j.total }; } catch (e) { return { error: `unparseable hosts output: ${e.message}`, hosts: [] }; }
}

export function matchNativeHost(hosts, ssh) {
  const bare = ssh.includes('@') ? ssh.split('@').pop() : ssh;
  return hosts.find((h) => Object.values(h).some((v) => typeof v === 'string' && (v === ssh || v === bare || v.split('@').pop() === bare))) || null;
}

export async function resolveAlias(central, ssh, explicit, report) {
  const native = await nativeHosts(central);
  if (explicit) return explicit;
  if (native.error) {
    report.warn(`cannot read native hosts (${native.error}); registering ${ssh} under its ssh target name. Pass --host ALIAS to match your native host name.`);
    return ssh;
  }
  const match = matchNativeHost(native.hosts, ssh);
  if (match) return match.name || ssh;
  report.warn(native.hosts.length
    ? `no registered native host matches ${ssh} (known: ${native.hosts.map((h) => h.name).join(', ')}); using ${ssh} as the source alias. Pass --host ALIAS to override.`
    : `this tuios daemon has no registered hosts ('tuios hosts' lists none; config ${'see tuios config path'} may differ from the daemon's); using ${ssh} as the source alias. Register with 'tuios hosts add NAME ${ssh}' or pass --host ALIAS.`);
  return ssh;
}

// ---- actions ----

async function writeIfChanged(t, report, path, content, { mode = 0o600, what } = {}) {
  const current = await t.read(path);
  if (current === content) { report.note(`unchanged: ${what || path}`); return false; }
  await report.step(`write ${what || path} (${path})`, () => t.write(path, content, mode));
  return true;
}

async function syncRuntime(t, paths, report, files) {
  let changed = false;
  for (const [name, body] of files) {
    if (await writeIfChanged(t, report, join(paths.runtimeScripts, name), body, { mode: 0o644, what: `runtime ${name}` })) changed = true;
  }
  return changed;
}

async function editConfigHooks(t, report, mapper, commandAfter) {
  const path = await activeConfigPath(t, report);
  if (!path) { report.gap(`hooks not configured on ${t.label}: active tuios config path unavailable; no hook was written.`); return false; }
  const existed = await t.read(path);
  const current = existed ?? '';
  if (existed == null && !commandAfter) { report.note(`no tuios config at ${path}; no hooks to remove`); return false; }
  let result;
  try { result = editHooks(current, HOOK_EVENTS, mapper); } catch (e) { report.fail(`${path}: ${e.message}`); return false; }
  report.note(`active tuios config (${t.label}): ${path}`);
  if (!result.changed) { report.note('unchanged: [hooks] already as wanted'); return false; }
  const backup = `${path}.pre-cross-host.bak`;
  if (existed != null && (await t.read(backup)) == null) await report.step(`back up ${path} to ${backup}`, () => t.write(backup, current, 0o600));
  if (report.failures.length) return false;
  if (existed == null) await report.step(`create tuios config directory ${dirname(path)}`, () => t.mkdirp(dirname(path)));
  if (report.failures.length) return false;
  await report.step(`update [hooks] in ${path} (commands ${commandAfter || 'removed'})`, () => existed == null ? t.write(path, result.text, 0o600) : t.writeInPlace(path, result.text));
  return true;
}

async function hooksActive(t, command) {
  if (!t.tuios) return null;
  const r = await t.run([t.tuios, 'list-hooks', '--json']);
  if (r.code !== 0) return null;
  try { return JSON.parse(r.out).hooks.some((h) => h.command === command); } catch { return null; }
}

async function harnessIntegrations(t, report) {
  if (!t.tuios) { report.warn(`tuios not found on ${t.label}; native harness integrations skipped`); return; }
  const r = await t.run([t.tuios, 'integration', 'status', '--json']);
  let rows;
  try { rows = JSON.parse(r.out); } catch { report.warn(`'tuios integration status' unusable on ${t.label}: ${(r.err || r.out).trim().slice(0, 200)}`); return; }
  for (const row of rows) {
    if (!row.binary_path) { report.note(`integration ${row.harness}: harness not installed, skipped`); continue; }
    const behind = !row.installed || (row.version != null && row.want_version != null && row.version < row.want_version);
    if (!behind) { report.note(`integration ${row.harness}: already ${row.current ? 'current' : `installed (v${row.version} is not older than v${row.want_version}; left alone)`}`); continue; }
    await report.step(`install tuios integration ${row.harness}`, async () => {
      const i = await t.run([t.tuios, 'integration', 'install', row.harness, '--command', t.tuios]);
      if (i.code !== 0) throw new Error((i.err || i.out).trim());
    });
  }
}

// ---- shell marks (OSC 133): the shell module is sourced from the user's startup file ----

const SHELL_PROBE = 'sp="${SHELL:-}"; [ -n "$sp" ] || sp=$(getent passwd "$(id -u)" 2>/dev/null | cut -d: -f7); echo "SHELL_PATH=$sp"; if [ -x "$sp" ]; then echo "SHELL_BASH_VERSION=$("$sp" -c \'echo "${BASH_VERSION-}"\' 2>/dev/null)"; fi';
const BLOCK_OPEN = '# >>> tuios-inbox shell marks (setup-cross-host) >>>';
const BLOCK_CLOSE = '# <<< tuios-inbox shell marks <<<';
const BLOCK_RE = /\n?^# >>> tuios-inbox shell marks[^\n]*\n[\s\S]*?^# <<< tuios-inbox shell marks <<<[^\n]*(\n|$)/m;

// kind is the bundled module that can mark this shell's commands, or null with the reason it cannot.
export function parseShell(out) {
  const facts = Object.fromEntries(out.split('\n').map((l) => l.match(/^(SHELL_[A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
  const path = facts.SHELL_PATH || '';
  const name = path.split('/').pop();
  const version = facts.SHELL_BASH_VERSION || '';
  const [major, minor] = version.split('.').map(Number);
  if (name === 'zsh') return { path, name, version, kind: 'zsh' };
  if (name === 'bash') {
    if (major > 4 || (major === 4 && minor >= 4)) return { path, name, version, kind: 'bash' };
    return { path, name, version, kind: null, reason: `bash ${version || 'of unknown version'} is older than 4.4, which ignores PS0, so commands cannot be marked` };
  }
  return { path, name, version, kind: null, reason: path ? `${path} has no bundled OSC 133 integration (bash 4.4+ and zsh are supported)` : 'the login shell could not be determined' };
}

export async function detectShell(t) {
  const r = await t.run(['sh', '-c', SHELL_PROBE]);
  return parseShell(r.code === 0 ? r.out : '');
}

export const sourceBlock = (file) => `${BLOCK_OPEN}\n[ "\${TUIOS_ENV:-}" = 1 ] && [ -r ${shq(file)} ] && . ${shq(file)}\n${BLOCK_CLOSE}\n`;

export function ensureSourceBlock(text, file) {
  const block = sourceBlock(file);
  if (BLOCK_RE.test(text)) return text.replace(BLOCK_RE, (m) => (m.startsWith('\n') ? '\n' : '') + block);
  return `${text}${text && !text.endsWith('\n') ? '\n' : ''}${text ? '\n' : ''}${block}`;
}

export const removeSourceBlock = (text) => text.replace(BLOCK_RE, '');

async function paneMarks(t) {
  if (!t.tuios) return null;
  const r = await t.run([t.tuios, 'doctor', 'shell', '--json']);
  try { const j = JSON.parse(r.out); return Array.isArray(j.panes) ? j.panes : []; } catch { return null; }
}

function rcFile(t, shell) { return join(t.home, shell.kind === 'bash' ? '.bashrc' : '.zshrc'); }

async function shellIntegration(t, report, paths, shell) {
  if (!t.tuios) return;
  const panes = await paneMarks(t);
  if (panes == null) report.warn(`'tuios doctor shell --json' unusable on ${t.label}; shell marks could not be verified.`);
  const unmarked = (panes || []).filter((p) => !p.marks_commands);
  if (panes?.length && !unmarked.length && !shell.kind) { report.note(`shell marks (${t.label}): every pane already marks its commands`); return; }
  if (!shell.kind) { report.gap(`shell marks on ${t.label}: ${shell.reason}. Switch the login shell to bash 4.4+ or zsh, or add the native recipe from 'tuios doctor shell' to its startup file.`); return; }
  const rc = rcFile(t, shell);
  const current = await t.read(rc);
  const ours = current != null && BLOCK_RE.test(current);
  if (!ours && panes?.length && !unmarked.length) { report.note(`shell marks (${t.label}): every pane already marks its commands; ${rc} left alone`); return; }
  if (!ours && current != null && /133;[ABCD]/.test(current)) { report.note(`shell marks (${t.label}): ${rc} already carries OSC 133 marks; left alone`); return; }
  const next = ensureSourceBlock(current ?? '', join(paths.runtimeScripts, `shell.${shell.kind}`));
  if (next === current) { report.note(`unchanged: shell marks in ${rc}`); return; }
  await report.step(`source ${shell.kind} OSC 133 marks from ${rc}`, () => (current == null ? t.write(rc, next, 0o644) : t.writeInPlace(rc, next)));
  report.note(`shell marks take effect in shells started after this; open a new pane on ${t.label} (existing panes keep their old prompt).`);
}

async function removeShellIntegration(t, report) {
  for (const name of ['.bashrc', '.zshrc']) {
    const rc = join(t.home, name);
    const current = await t.read(rc);
    if (current == null || !BLOCK_RE.test(current)) continue;
    await report.step(`remove tuios-inbox shell marks block from ${rc}`, () => t.writeInPlace(rc, removeSourceBlock(current)));
  }
}

async function shellStatus(t, report, shell) {
  if (!t.tuios) return;
  const panes = await paneMarks(t);
  const rc = shell.kind ? rcFile(t, shell) : null;
  const text = rc ? await t.read(rc) : null;
  report.note(`shell marks (${t.label}): shell ${shell.name || 'unknown'}${shell.kind ? '' : ` unsupported (${shell.reason})`}; panes marking commands ${panes == null ? 'unknown' : `${panes.filter((p) => p.marks_commands).length}/${panes.length}`}; startup integration ${rc ? (text != null && BLOCK_RE.test(text) ? `present in ${rc}` : `absent from ${rc}`) : 'n/a'}`);
}

async function readSources(central, path) {
  const text = await central.read(path);
  if (text == null) return [];
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { throw new Error(`${path} is not valid JSON (${e.message}); fix or move it, nothing was changed.`); }
  if (!Array.isArray(parsed)) throw new Error(`${path} must be a JSON array of sources; nothing was changed.`);
  return parsed;
}

async function registerSource(central, report, centralPaths, entry, remove) {
  const existing = await readSources(central, centralPaths.collectorsJson);
  const next = remove ? dropSource(existing, entry.host) : mergeSources(existing, entry);
  const text = `${JSON.stringify(next, null, 2)}\n`;
  if (JSON.stringify(existing) === JSON.stringify(next)) { report.note(`unchanged: collectors.json source ${entry.host}`); return; }
  await report.step(`${remove ? 'remove' : 'register'} source ${entry.host} in ${centralPaths.collectorsJson}`, () => central.write(centralPaths.collectorsJson, text, 0o600));
}

function requireTools(t, report) {
  if (!t.bun) { report.fail(`bun not found on ${t.label}. Install Bun (https://bun.sh) so it is on a login-shell PATH or at ~/.bun/bin/bun, then rerun; or pass --bun /absolute/bun for this machine.`); return false; }
  if (t.os !== 'Darwin' && t.os !== 'Linux') { report.fail(`unsupported OS ${t.os} on ${t.label}: only launchd (Darwin) and systemd --user (Linux) are supported.`); return false; }
  return true;
}

async function requireLinuxUserSystemd(t, report) {
  if (t.os !== 'Linux') return true;
  const r = await t.run(['systemctl', '--user', 'show-environment']);
  if (r.code !== 0) { report.fail(`systemd --user is not usable on ${t.label} (${(r.err || r.out).trim()}). Log in with a user session or run 'loginctl enable-linger $USER' as root, then rerun.`); return false; }
  return true;
}

export async function install(ctx) {
  const { target, central, report, opts } = ctx;
  if (!requireTools(target, report) || !(await requireLinuxUserSystemd(target, report))) return;
  const paths = layout(target, opts);
  const remote = target.kind === 'remote';
  const shell = await detectShell(target);
  const files = await runtimeFiles(ctx.scriptsDir, target.tuios && shell.kind ? [`shell.${shell.kind}`] : []);
  const collectorOnly = opts.collectorOnly || remote;
  const specs = [serviceSpec(target, paths, 'collector', { host: remote ? ctx.alias : opts.host })];
  if (!collectorOnly) specs.push(serviceSpec(target, paths, 'server', { port: opts.port }));

  // A failed write or service operation stops everything that depends on it; later steps never run against a half-made setup.
  const broken = () => report.failures.length > 0;
  const halt = (what) => { report.fail(`setup stopped after the failure above; ${what} was not attempted, so nothing was registered.`); };
  if (!target.tuios) report.gap(`native tuios was not found on ${target.label}: native event collection, hooks and harness integrations were not set up. Install tuios or pass --tuios-bin /absolute/tuios, then rerun.`);

  for (const dir of [paths.runtimeScripts, paths.collectorData, paths.stateDir]) await report.step(`ensure directory ${dir} (0700)`, () => target.mkdirp(dir));
  if (broken()) return halt('the runtime copy, services, hooks and source registration');
  const runtimeChanged = await syncRuntime(target, paths, report, files);
  if (broken()) return halt('services, hooks and source registration');

  const unitChanged = new Map();
  for (const spec of specs) unitChanged.set(spec.which, await writeIfChanged(target, report, spec.file, spec.content, { what: `service ${spec.name}` }));
  if (broken()) return halt('service start, hooks and source registration');

  for (const spec of specs) {
    if (spec.which === 'server') {
      const port = Number(spec.env.PORT);
      if (!ctx.dry && !(await svc.loaded(target, spec)).loaded && await portBusy(port)) {
        report.warn(`port ${port} is already served by another process (probably 'h-tuios start'); backend service written but not started. Run 'h-tuios stop' then 'bun scripts/setup-cross-host.mjs start'.`);
        continue;
      }
    }
    const state = ctx.dry ? { loaded: false, running: false } : await svc.loaded(target, spec);
    const needsRestart = state.loaded && (unitChanged.get(spec.which) || (spec.which === 'collector' && runtimeChanged));
    if (needsRestart) await report.step(`restart ${spec.name}`, () => svc.restart(target, spec, unitChanged.get(spec.which)));
    else if (!state.loaded || !state.running) await report.step(`load and start ${spec.name}`, () => svc.start(target, spec));
    else report.note(`unchanged: ${spec.name} already running`);
    if (broken()) return halt('the remaining services, hooks and source registration');
  }

  const command = hookCommand({ bun: target.bun, hookScript: paths.hookScript, tuios: target.tuios, collectorData: paths.collectorData });
  const hooksChanged = await editConfigHooks(target, report, installHookItems(command), command);
  if (broken()) return halt('harness integrations and source registration');
  if (hooksChanged || (await hooksActive(target, command)) === false) {
    report.restart.push(`${target.label}: hooks in config differ from the running daemon. Run 'tuios config apply' from a terminal OUTSIDE tuios, then rerun 'status'. Existing sessions need not restart. This tool never applies grants or stops native daemons.`);
  }
  await harnessIntegrations(target, report);
  await shellIntegration(target, report, paths, shell);
  if (broken()) return halt('source registration');

  const entry = { host: remote ? ctx.alias : 'local', ssh: remote ? target.ssh : null, collector_path: paths.collectorScript, data_dir: paths.collectorData, bun: target.bun };
  await registerSource(central, report, layout(central, opts), entry, false);
  if (!remote) report.note(`central collectors.json: ${layout(central, opts).collectorsJson}`);
  if (target.os === 'Linux') report.note('Linux: for the collector to run while logged out, an administrator may need `loginctl enable-linger $USER`.');
}

export async function lifecycle(ctx, action) {
  const { target, report, opts } = ctx;
  if (!requireTools(target, report)) return;
  const paths = layout(target, opts);
  const remote = target.kind === 'remote';
  const which = ['collector', ...(opts.collectorOnly || remote ? [] : ['server'])];
  for (const w of which) {
    const spec = paths.services[w];
    if ((await target.read(spec.file)) == null) { report.fail(`${spec.name} is not installed on ${target.label}; run install first.`); continue; }
    if (action === 'start') await report.step(`start ${spec.name}`, () => svc.start(target, spec));
    else await report.step(`stop ${spec.name}${target.os === 'Darwin' ? ' (launchctl bootout; it loads again at next login or start)' : ''}`, () => svc.unload(target, spec));
  }
}

export async function uninstall(ctx) {
  const { target, central, report, opts } = ctx;
  if (!requireTools(target, report)) return;
  const paths = layout(target, opts);
  const remote = target.kind === 'remote';
  const which = ['collector', ...(opts.collectorOnly || remote ? [] : ['server'])];
  for (const w of which) {
    const spec = paths.services[w];
    await report.step(`unload ${spec.name}`, () => svc.disable(target, spec));
    await report.step(`remove ${spec.file}`, () => target.remove(spec.file));
  }
  if (report.failures.length) { report.fail('uninstall stopped after the failure above; hooks, runtime copy and source registration were left in place.'); return; }
  if (target.os === 'Linux') await report.step('systemctl --user daemon-reload', () => target.run(['systemctl', '--user', 'daemon-reload']));
  const fallback = remote ? null : hookCommand({ bun: target.bun, hookScript: join(repoDir, 'scripts', HOOK_MARK), tuios: target.tuios, collectorData: paths.collectorData });
  const hooksChanged = await editConfigHooks(target, report, removeHookItems(fallback), fallback);
  if (hooksChanged) report.restart.push(`${target.label}: hooks load at daemon start; restart tuios at a safe point to stop calling the removed runtime.`);
  await removeShellIntegration(target, report);
  await report.step(`remove runtime copy ${paths.runtimeRoot}`, () => target.remove(paths.runtimeRoot, { recursive: true }));
  await registerSource(central, report, layout(central, opts), { host: remote ? ctx.alias : 'local' }, true);
  report.note(`kept data: ${paths.collectorData} (queue, checkpoints, imported record ids) and logs in ${paths.stateDir}`);
}

export async function status(ctx) {
  const { target, central, report, opts } = ctx;
  const paths = layout(target, opts);
  const remote = target.kind === 'remote';
  report.note(`target ${target.label}: os=${target.os} bun=${target.bun || 'MISSING'} tuios=${target.tuios || 'MISSING'}`);
  for (const w of ['collector', ...(opts.collectorOnly || remote ? [] : ['server'])]) {
    const spec = paths.services[w];
    const installed = (await target.read(spec.file)) != null;
    const state = installed ? await svc.loaded(target, spec) : { loaded: false, running: false };
    report.note(`service ${spec.name}: ${installed ? 'installed' : 'not installed'}, ${state.running ? `running${state.detail ? ` (${state.detail})` : ''}` : state.loaded ? 'loaded, not running' : 'not loaded'}`);
  }
  let expected;
  const shell = await detectShell(target);
  try { expected = await runtimeFiles(ctx.scriptsDir, target.tuios && shell.kind ? [`shell.${shell.kind}`] : []); } catch (e) { report.warn(e.message); }
  if (expected) {
    const stale = [];
    for (const [name, body] of expected) if ((await target.read(join(paths.runtimeScripts, name))) !== body) stale.push(name);
    report.note(stale.length ? `runtime: ${stale.length} file(s) missing or stale (${stale.join(', ')}); run install` : `runtime: current at ${paths.runtimeScripts}`);
  }
  const command = target.bun ? hookCommand({ bun: target.bun, hookScript: paths.hookScript, tuios: target.tuios, collectorData: paths.collectorData }) : null;
  const cfg = await activeConfigPath(target, report);
  if (cfg) {
    const text = (await target.read(cfg)) ?? '';
    report.note(`active tuios config: ${cfg}; hooks ${command && text.includes(command) ? 'point at installed runtime' : 'do not point at installed runtime'}`);
  }
  const active = command ? await hooksActive(target, command) : null;
  report.note(`running daemon hooks: ${active == null ? 'unknown (tuios unreachable)' : active ? 'active' : 'not active (daemon restart needed)'}`);
  if (target.tuios) {
    const r = await target.run([target.tuios, 'integration', 'status', '--json']);
    try { for (const row of JSON.parse(r.out)) if (row.binary_path) report.note(`integration ${row.harness}: ${row.installed ? (row.current ? 'current' : `v${row.version} (want ${row.want_version})`) : 'not installed'}`); } catch { report.warn(`integration status unreadable on ${target.label}`); }
  }
  const sources = await readSources(central, layout(central, opts).collectorsJson).catch((e) => { report.warn(e.message); return []; });
  const mine = sources.find((s) => (remote ? s.ssh === target.ssh : s.host === 'local'));
  report.note(`central source: ${mine ? `${mine.host} -> ${mine.ssh || 'local'} ${mine.collector_path}` : 'not registered in collectors.json'}`);
  const native = await nativeHosts(central);
  report.note(native.error ? `native hosts: unreadable (${native.error})` : `native hosts: ${native.hosts.length ? native.hosts.map((h) => h.name).join(', ') : 'none registered with this daemon'}`);
  if (expected && (await target.read(paths.collectorScript)) != null) {
    const r = await target.run([target.bun, paths.collectorScript, 'status', '--data', paths.collectorData]);
    report.note(r.code === 0 ? `collector status: ${r.out.trim().replace(/\s+/g, ' ').slice(0, 400)}` : `collector status failed (exit ${r.code}): ${(r.err || r.out).trim().slice(0, 200)}`);
  }
  await shellStatus(target, report, shell);
}

// ---- CLI ----

const FLAGS = { '--remote': 'remote', '--host': 'host', '--bun': 'bun', '--tuios-bin': 'tuiosBin', '--data': 'data', '--port': 'port', '--home': 'home' };
const SWITCHES = { '--collector-only': 'collectorOnly', '--dry-run': 'dryRun' };

export function parseArgs(argv) {
  const opts = {}; const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a in SWITCHES) opts[SWITCHES[a]] = true;
    else if (a in FLAGS) { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); opts[FLAGS[a]] = argv[++i]; }
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else rest.push(a);
  }
  if (rest.length !== 1 || !['install', 'status', 'start', 'stop', 'uninstall'].includes(rest[0])) throw new Error('usage: setup-cross-host.mjs install|status|start|stop|uninstall [--remote SSH_TARGET] [--host ALIAS] [--collector-only] [--dry-run] [--bun PATH] [--tuios-bin PATH] [--data DIR] [--port N]');
  if (opts.host && !/^[\w.@-]+$/.test(opts.host)) throw new Error('--host must be letters, digits, dot, dash, underscore');
  if (opts.remote && !/^[\w.@:-]+$/.test(opts.remote)) throw new Error('--remote must be an ssh target such as user@host or an ssh_config alias');
  if (opts.data && !opts.data.startsWith('/')) throw new Error('--data must be an absolute path');
  for (const k of ['bun', 'tuiosBin']) if (opts[k] && !opts[k].startsWith('/')) throw new Error(`--${k === 'bun' ? 'bun' : 'tuios-bin'} must be an absolute path`);
  if (opts.port && !(/^\d+$/.test(opts.port) && opts.port >= 1 && opts.port <= 65535)) throw new Error('--port must be 1-65535');
  if (opts.remote && opts.port) throw new Error('--port applies to the local backend only');
  return { command: rest[0], opts };
}

export async function main(argv, { run, out = console.log, scriptsDir: sourceDir } = {}) {
  const { command, opts } = parseArgs(argv);
  const report = new Report(!!opts.dryRun);
  const home = opts.home ? resolve(opts.home) : homedir();
  const central = await localTarget({ home, run: run || spawnCapture, bun: opts.remote ? undefined : opts.bun, tuios: opts.remote ? undefined : opts.tuiosBin });
  const ctx = { central, report, opts, dry: !!opts.dryRun, scriptsDir: sourceDir };
  try {
    if (opts.remote) {
      const target = await remoteTarget(opts.remote, { run: run || spawnCapture });
      if (opts.bun) target.bun = opts.bun;
      if (opts.tuiosBin) target.tuios = opts.tuiosBin;
      ctx.target = target;
      ctx.alias = command === 'install' || command === 'uninstall' || command === 'status'
        ? await resolveAlias(central, opts.remote, opts.host, report) : opts.host || opts.remote;
    } else {
      ctx.target = central;
    }
    if (command === 'install') await install(ctx);
    else if (command === 'status') await status(ctx);
    else if (command === 'uninstall') await uninstall(ctx);
    else await lifecycle(ctx, command);
  } catch (error) { report.fail(error.message); }
  if (opts.dryRun) out('dry run: no service, config or file was changed');
  report.print(out);
  return report.failures.length || report.incomplete.length ? 1 : 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
