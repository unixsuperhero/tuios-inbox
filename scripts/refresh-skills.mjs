const proc = Bun.spawn(['h-tuios', 'skills-refresh'], {
  stdout: 'inherit',
  stderr: 'inherit',
});
process.exit(await proc.exited);
