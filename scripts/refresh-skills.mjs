import { mkdir, lstat, realpath, symlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
const home = homedir();
const source = resolve(import.meta.dir, '../skills/tuios');
const proc = Bun.spawn([process.env.TUIOS_BIN || '/opt/homebrew/bin/tuios', '--skill', 'all'], { stdout: 'pipe', stderr: 'inherit' });
const content = await new Response(proc.stdout).text();
if (await proc.exited || !content.startsWith('---\nname: tuios')) throw new Error('TUIOS did not return its complete skill');
await mkdir(source, { recursive: true });
await Bun.write(join(source, 'SKILL.md'), content);
const roots = ['.agents', '.claude', '.codex', '.gemini', '.cursor', '.config/opencode', '.pi/agent', '.omp/agent', '.grok', '.hermes'];
for (const root of roots) {
  const harness = join(home, root);
  if (!(await lstat(harness).catch(() => null))) continue;
  const skills = join(harness, 'skills');
  await mkdir(skills, { recursive: true });
  const target = join(skills, 'tuios');
  const existing = await lstat(target).catch(() => null);
  if (existing) {
    if (await realpath(target) !== source) throw new Error(`Refusing to overwrite unrelated skill ${target}`);
  } else await symlink(source, target, 'dir');
  console.log(`${root}: ${target} -> ${source}`);
}
console.log(`Refreshed ${content.length} characters from the installed TUIOS binary.`);
