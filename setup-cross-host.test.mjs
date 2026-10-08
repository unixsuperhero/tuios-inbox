import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { editHooks, hookCommand, installHookItems, launchdPlist, layout, main, matchNativeHost, mergeSources, parseArgs, removeHookItems, runtimeFiles, serviceSpec, shellQuote, systemdUnit } from './scripts/setup-cross-host.mjs';

let home, calls, config, src;
const OLD = "/opt/homebrew/bin/bun /repo/scripts/capture-hook.mjs";

// Stand-in for launchctl/systemctl/tuios: records argv, answers like the real tools.
function fakeRun(extra = {}) {
  return async (argv) => {
    calls.push(argv);
    const key = argv.join(' ');
    if (extra[key]) return extra[key];
    if (argv[1] === 'config' && argv[2] === 'path') return { code: 0, out: `${config}\n`, err: '' };
    if (argv[1] === 'integration' && argv[2] === 'status') return { code: 0, out: JSON.stringify([
      { harness: 'claude-code', binary_path: '/x/claude', installed: true, current: false, version: 3, want_version: 2 },
      { harness: 'codex', binary_path: '/x/codex', installed: false, version: 0, want_version: 1 },
      { harness: 'gemini-cli', binary_path: '', installed: false },
    ]), err: '' };
    if (argv[1] === 'integration' && argv[2] === 'install') return { code: 0, out: 'ok', err: '' };
    if (argv[1] === 'hosts') return { code: 0, out: JSON.stringify({ hosts: [{ name: 'build', address: 'gaurav@buildbox' }], total: 1 }), err: '' };
    if (argv[1] === 'list-hooks') return { code: 0, out: JSON.stringify({ hooks: [] }), err: '' };
    if (argv[1] === 'doctor') return { code: 0, out: 'every pane marks its commands', err: '' };
    if (argv[0] === 'launchctl' && argv[1] === 'print') return { code: 113, out: '', err: 'not found' };
    if (argv[0] === 'systemctl' && argv[2] === 'is-active') return { code: 3, out: 'inactive\n', err: '' };
    if (argv[0] === 'systemctl' && argv[2] === 'is-enabled') return { code: 1, out: 'disabled\n', err: '' };
    return { code: 0, out: '', err: '' };
  };
}

const flags = (extra = []) => ['--home', home, '--bun', '/fake/bin/bun', '--tuios-bin', '/fake/bin/tuios', ...extra];
async function run(command, extra, runOpts = {}) {
  const lines = [];
  const code = await main([command, ...flags(extra)], { run: runOpts.fn || fakeRun(runOpts.extra), out: (l) => lines.push(l), scriptsDir: src });
  return { code, text: lines.join('\n') };
}
const tree = async (dir, base = dir) => {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await tree(p, base)); else out.push(`${p.slice(base.length)}:${await readFile(p, 'utf8')}`);
  }
  return out.sort();
};

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'setup-xh-'));
  src = await mkdtemp(join(tmpdir(), 'setup-src-'));
  calls = [];
  await writeFile(join(src, 'collector.mjs'), "import { a } from './helper.mjs';\nexport const c = a;\n");
  await writeFile(join(src, 'helper.mjs'), 'export const a = 1;\n');
  await writeFile(join(src, 'capture-hook.mjs'), "import { open } from './collector.mjs';\n");
  config = join(home, 'tuios-config.toml');
  await writeFile(config, `# mine\n[general]\nx = 1\n\n[hooks]\nafter-agent-state = '${OLD}'\nafter-command-finished = ["echo keep", '${OLD}']\n\n[debug]\nshow = false\n`);
});
afterEach(async () => { await rm(home, { recursive: true, force: true }); await rm(src, { recursive: true, force: true }); });

describe('hook config editing', () => {
  test('replaces only the capture hook, keeps every other line', () => {
    const text = `[a]\nk = 1 # c\n\n[hooks]\nafter-agent-state = '${OLD}'\nafter-command-finished = ["echo keep", '${OLD}']\nother = 'x'\n\n[z]\n`;
    const out = editHooks(text, ['after-agent-state', 'after-command-finished'], installHookItems('/b /new/capture-hook.mjs'));
    expect(out.changed).toBe(true);
    expect(out.text).toContain("after-agent-state = '/b /new/capture-hook.mjs'");
    expect(out.text).toContain(`after-command-finished = ['echo keep', '/b /new/capture-hook.mjs']`);
    expect(out.text.replace(/after-[a-z-]+ = .*\n/g, '')).toBe(text.replace(/after-[a-z-]+ = .*\n/g, ''));
  });

  test('is idempotent and adds a missing hooks table', () => {
    const once = editHooks('[a]\nk=1\n', ['after-agent-state'], installHookItems('c capture-hook.mjs'));
    expect(once.text).toBe("[a]\nk=1\n\n[hooks]\nafter-agent-state = 'c capture-hook.mjs'\n");
    expect(editHooks(once.text, ['after-agent-state'], installHookItems('c capture-hook.mjs')).changed).toBe(false);
  });

  test('refuses multi-line arrays instead of corrupting them', () => {
    expect(() => editHooks("[hooks]\nafter-agent-state = [\n 'a',\n]\n", ['after-agent-state'], installHookItems('x capture-hook.mjs'))).toThrow(/by hand/);
  });

  test('removal restores a fallback or drops the key', () => {
    const t = `[hooks]\nafter-agent-state = 'b /rt/capture-hook.mjs'\n`;
    expect(editHooks(t, ['after-agent-state'], removeHookItems('b /repo/capture-hook.mjs')).text).toContain("'b /repo/capture-hook.mjs'");
    expect(editHooks(t, ['after-agent-state'], removeHookItems(null)).text).not.toContain('after-agent-state');
  });
});

describe('service specs', () => {
  test('launchd plist escapes values and keeps daemon selection env', async () => {
    const p = launchdPlist({ label: 'l', argv: ['/b', 'a&b'], env: { XDG_RUNTIME_DIR: '/run/<u>' }, workdir: '/w', logPath: '/l' });
    expect(p).toContain('a&amp;b');
    expect(p).toContain('/run/&lt;u&gt;');
    expect(p).toContain('<key>KeepAlive</key>');
  });
  test('systemd unit quotes percent and dollar', () => {
    const u = systemdUnit({ description: 'd', argv: ['/b', '50%$HOME'], env: { A: 'x y' }, workdir: '/w', logPath: '/l' });
    expect(u).toContain('ExecStart="/b" "50%%$$HOME"');
    expect(u).toContain('Environment="A=x y"');
  });
  test('systemd unit keeps spaces, quotes and percent safe in every directive', () => {
    const u = systemdUnit({ description: 'd', argv: ['/opt/my bun/bun', '/data dir/it\'s "x"/collector.mjs', '$HOME'], env: { PATH: '/a b:/c', V: 'p%q$r' }, workdir: '/work dir/50%', logPath: '/log dir/c.log' });
    expect(u).toContain('ExecStart="/opt/my bun/bun" "/data dir/it\'s \\"x\\"/collector.mjs" "$$HOME"');
    expect(u).toContain('Environment="PATH=/a b:/c"');
    expect(u).toContain('Environment="V=p%%q$r"');
    expect(u).toContain('WorkingDirectory=/work dir/50%%');
    expect(u).toContain('StandardOutput=append:/log dir/c.log');
    expect(() => systemdUnit({ description: 'd', argv: ['/b', 'a\nb'], env: {}, workdir: '/w', logPath: '/l' })).toThrow(/line break/);
  });
  test('hook command quotes spaced paths and carries the chosen tuios and collector data', () => {
    const c = hookCommand({ bun: '/opt/my bun/bun', hookScript: "/rt dir/it's/capture-hook.mjs", tuios: '/n/tuios', collectorData: '/data dir/collector' });
    expect(c).toBe(`env TUIOS_BIN=/n/tuios TUIOS_INBOX_COLLECTOR_DATA='/data dir/collector' '/opt/my bun/bun' '/rt dir/it'\\''s/capture-hook.mjs'`);
    expect(hookCommand({ bun: '/b', hookScript: '/h.mjs' })).toBe('/b /h.mjs');
  });
  test('service environment keeps the real PATH for launched agent executables', () => {
    const target = { os: 'Linux', home: '/h', bun: '/b/bun', tuios: '/t/tuios', env: { PATH: '/home/me/.local/bin:/opt/agents/bin:/usr/bin', XDG_RUNTIME_DIR: '/run/user/1' } };
    const spec = serviceSpec(target, layout(target), 'collector', {});
    const dirs = spec.env.PATH.split(':');
    expect(dirs.slice(0, 4)).toEqual(['/b', '/t', '/home/me/.local/bin', '/opt/agents/bin']);
    expect(new Set(dirs).size).toBe(dirs.length);
    expect(spec.env).toMatchObject({ XDG_RUNTIME_DIR: '/run/user/1', TUIOS_BIN: '/t/tuios' });
  });
  test('shellQuote survives quotes', () => { expect(shellQuote("a'b")).toBe(`'a'\\''b'`); });
  test('runtime closure follows relative imports and reports missing files', async () => {
    expect([...(await runtimeFiles(src)).keys()].sort()).toEqual(['capture-hook.mjs', 'collector.mjs', 'helper.mjs']);
    await rm(join(src, 'helper.mjs'));
    await expect(runtimeFiles(src)).rejects.toThrow(/helper.mjs is missing/);
  });
  test('source registry merges by host and keeps unrelated entries', () => {
    const merged = mergeSources([{ host: 'a', n: 1 }, { host: 'b', n: 2 }], { host: 'a', n: 3 });
    expect(merged).toEqual([{ host: 'b', n: 2 }, { host: 'a', n: 3 }]);
  });
  test('native host matching accepts alias or address', () => {
    const hosts = [{ name: 'build', address: 'gaurav@buildbox' }];
    expect(matchNativeHost(hosts, 'gaurav@buildbox').name).toBe('build');
    expect(matchNativeHost(hosts, 'other')).toBe(null);
  });
  test('argument validation', () => {
    expect(() => parseArgs(['install', '--remote', 'a;rm'])).toThrow(/ssh target/);
    expect(() => parseArgs(['bogus'])).toThrow(/usage/);
    expect(parseArgs(['install', '--dry-run', '--collector-only']).opts).toEqual({ dryRun: true, collectorOnly: true });
  });
});

describe('install behavior against an isolated home', () => {
  const platform = process.platform === 'darwin';
  const unit = (name) => layout({ home, os: platform ? 'Darwin' : 'Linux', kind: 'local', env: {} }).services[name].file;

  test('dry run writes nothing and runs no mutating command', async () => {
    const before = await tree(home);
    const { code, text } = await run('install', ['--dry-run']);
    expect(code).toBe(0);
    expect(text).toContain('dry run: no service, config or file was changed');
    expect(text).toContain('would: write');
    expect(await tree(home)).toEqual(before);
    const mutating = calls.filter((c) => (c[0] === 'launchctl' && c[1] !== 'print') || (c[0] === 'systemctl' && !['is-active', 'is-enabled', 'show-environment'].includes(c[2])) || c.includes('install'));
    expect(mutating).toEqual([]);
  });

  test('install writes runtime, service, hooks with backup, source registry; second run changes nothing', async () => {
    const first = await run('install', ['--collector-only']);
    expect(first.code).toBe(0);
    const rt = join(home, '.local/share/tuios-inbox/collector-runtime/scripts');
    expect(await readFile(join(rt, 'helper.mjs'), 'utf8')).toBe('export const a = 1;\n');
    const serviceText = await readFile(unit('collector'), 'utf8');
    expect(serviceText).toContain(join(rt, 'collector.mjs'));
    expect(serviceText).toContain('/fake/bin/tuios');
    const hooks = await readFile(config, 'utf8');
    expect(hooks).toContain(`/fake/bin/bun ${join(rt, 'capture-hook.mjs')}`);
    expect(hooks).toContain('echo keep');
    expect(hooks).toContain('# mine');
    expect(await readFile(`${config}.pre-cross-host.bak`, 'utf8')).toContain(OLD);
    const sources = JSON.parse(await readFile(join(home, '.local/share/tuios-inbox/collectors.json'), 'utf8'));
    expect(sources).toEqual([{ host: 'local', ssh: null, collector_path: join(rt, 'collector.mjs'), data_dir: join(home, '.local/share/tuios-inbox/collector'), bun: '/fake/bin/bun' }]);
    expect(first.text).toContain('restart needed');
    expect(calls.some((c) => c.includes('install') && c.includes('codex'))).toBe(true);
    expect(calls.some((c) => c.includes('install') && c.includes('claude-code'))).toBe(false);
    expect(calls.some((c) => c.includes('install') && c.includes('gemini-cli'))).toBe(false);
    expect(calls.some((c) => c.includes('kill-server'))).toBe(false);

    const snapshot = await tree(home);
    const second = await run('install', ['--collector-only']);
    expect(second.code).toBe(0);
    expect(await tree(home)).toEqual(snapshot);
    expect(second.text).toContain('unchanged: [hooks] already as wanted');
  });

  test('hooks use the selected paths even when they contain spaces', async () => {
    const data = join(home, 'my data');
    const { code } = await run('install', ['--collector-only', '--data', data]);
    expect(code).toBe(0);
    const hooks = await readFile(config, 'utf8');
    expect(hooks).toContain(`TUIOS_BIN=/fake/bin/tuios`);
    expect(hooks).toContain(`TUIOS_INBOX_COLLECTOR_DATA=`);
    expect(hooks).toContain(`my data`);
    expect(hooks).toMatch(/env TUIOS_BIN=\/fake\/bin\/tuios TUIOS_INBOX_COLLECTOR_DATA='[^']*my data' \/fake\/bin\/bun /);
    expect(await readFile(unit('collector'), 'utf8')).toContain(data);
  });

  test('a failed service start stops hooks, integrations and source registration', async () => {
    const reg = join(home, '.local/share/tuios-inbox/collectors.json');
    const before = await readFile(config, 'utf8');
    const base = fakeRun();
    const failing = async (argv) => (/^(launchctl|systemctl)$/.test(argv[0]) && argv.some((a) => ['bootstrap', 'enable', 'kickstart', 'start'].includes(a)))
      ? (calls.push(argv), { code: 5, out: '', err: 'service manager refused' }) : base(argv);
    const { code, text } = await run('install', ['--collector-only'], { fn: failing });
    expect(code).toBe(1);
    expect(text).toContain('FAILED: load and start');
    expect(text).toContain('service manager refused');
    expect(text).toContain('nothing was registered');
    expect(text).not.toContain('done: register source');
    expect(await Bun.file(reg).exists()).toBe(false);
    expect(await readFile(config, 'utf8')).toBe(before);
    expect(calls.some((c) => c.includes('integration') && c.includes('install'))).toBe(false);
  });

  test('an unwritable runtime directory stops before services, hooks and registration', async () => {
    await mkdir(join(home, '.local/share/tuios-inbox'), { recursive: true });
    await writeFile(join(home, '.local/share/tuios-inbox/collector-runtime'), 'a file where a directory must go');
    const before = await readFile(config, 'utf8');
    const { code, text } = await run('install', ['--collector-only']);
    expect(code).toBe(1);
    expect(text).toContain('FAILED: ensure directory');
    expect(text).not.toContain('done: load and start');
    expect(await readFile(config, 'utf8')).toBe(before);
    expect(calls.filter((c) => /^(launchctl|systemctl)$/.test(c[0]) && !['print', 'is-active', 'is-enabled', 'show-environment'].includes(c[1] === 'print' ? 'print' : c[2]))).toEqual([]);
  });

  test('missing native tuios is reported as incomplete setup, never as success', async () => {
    const saved = process.env.PATH;
    process.env.PATH = '/nonexistent-tuios-path';
    try {
      const lines = [];
      const code = await main(['install', '--home', home, '--bun', '/fake/bin/bun', '--collector-only'], { run: fakeRun(), out: (l) => lines.push(l), scriptsDir: src });
      const text = lines.join('\n');
      expect(code).toBe(1);
      expect(text).toContain('INCOMPLETE: native tuios was not found');
      expect(calls.some((c) => c[1] === 'integration')).toBe(false);
      expect(await readFile(config, 'utf8')).toContain(OLD);
    } finally { process.env.PATH = saved; }
  });

  test('uninstall removes service, runtime and source but preserves collector data', async () => {
    await run('install', ['--collector-only']);
    const dataDir = join(home, '.local/share/tuios-inbox/collector');
    await writeFile(join(dataDir, 'queue.db'), 'precious');
    const { code } = await run('uninstall', ['--collector-only']);
    expect(code).toBe(0);
    expect(await readFile(join(dataDir, 'queue.db'), 'utf8')).toBe('precious');
    expect(await Bun.file(unit('collector')).exists()).toBe(false);
    expect(await Bun.file(join(home, '.local/share/tuios-inbox/collector-runtime/scripts/collector.mjs')).exists()).toBe(false);
    expect(JSON.parse(await readFile(join(home, '.local/share/tuios-inbox/collectors.json'), 'utf8'))).toEqual([]);
    expect(await readFile(config, 'utf8')).toContain('/repo/scripts/capture-hook.mjs'.replace('/repo', new URL('.', import.meta.url).pathname.replace(/\/$/, '')));
  });

  test('unrelated collectors.json entries survive and corrupt registry blocks install', async () => {
    const reg = join(home, '.local/share/tuios-inbox/collectors.json');
    await mkdir(join(home, '.local/share/tuios-inbox'), { recursive: true });
    await writeFile(reg, JSON.stringify([{ host: 'other', ssh: 'o@h', collector_path: '/c', bun: 'bun' }]));
    await run('install', ['--collector-only']);
    expect(JSON.parse(await readFile(reg, 'utf8')).map((s) => s.host).sort()).toEqual(['local', 'other']);
    await writeFile(reg, '{nope');
    const { code, text } = await run('install', ['--collector-only']);
    expect(code).toBe(1);
    expect(text).toContain('not valid JSON');
    expect(await readFile(reg, 'utf8')).toBe('{nope');
  });

  test('status is read-only and reports missing install honestly', async () => {
    const before = await tree(home);
    const { text } = await run('status', ['--collector-only']);
    expect(text).toContain('not installed');
    expect(text).toContain('not registered in collectors.json');
    expect(text).toContain('native hosts: build');
    expect(await tree(home)).toEqual(before);
  });
});

describe('CLI process smoke', () => {
  test('dry-run install in an isolated home reports unconfigured hooks and touches nothing', async () => {
    const proc = Bun.spawn(['bun', join(import.meta.dir, 'scripts/setup-cross-host.mjs'), 'install', '--dry-run', '--collector-only', '--home', home], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, HOME: home } });
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    expect(out).toContain('dry run');
    expect(out).toContain('INCOMPLETE: active tuios config'); // the isolated home has no tuios config, so hooks cannot be configured
    expect(code).toBe(1);
    expect((await readdir(home)).filter((n) => n !== 'Library')).toEqual(['tuios-config.toml']); // tuios itself creates Library/ for 'config path'
  });
  test('usage errors exit nonzero', async () => {
    const proc = Bun.spawn(['bun', join(import.meta.dir, 'scripts/setup-cross-host.mjs'), 'nope'], { stdout: 'pipe', stderr: 'pipe' });
    expect(await proc.exited).not.toBe(0);
  });
});
