// Starts a scratch inbox (fresh empty data dir, fake tuios/gh/open) on PORT and seeds a small demo tree. Never touches the real instance.
// usage: bun seed.mjs <scratch dir> <port>   (leaves the server running; writes <scratch>/state.json)
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
const [scratch, port] = [process.argv[2], process.argv[3]];
const base = `http://127.0.0.1:${port}`, repoRoot = '/Users/unixsuperhero/proj/tuios-inbox';
if (port === '4399') throw new Error('port 4399 is the live instance');
const data = join(scratch, 'data'), home = join(scratch, 'home'), repo = join(home, 'proj/parser'), omp = join(scratch, 'omp');
await mkdir(data, { recursive: true }); await mkdir(home, { recursive: true }); await mkdir(join(repo, 'docs'), { recursive: true }); await mkdir(join(omp, 'sessions/proj'), { recursive: true });
const sh = (cwd, ...a) => Bun.spawnSync(a, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 'd', GIT_AUTHOR_EMAIL: 'd@d', GIT_COMMITTER_NAME: 'd', GIT_COMMITTER_EMAIL: 'd@d' } });
await writeFile(join(repo, 'a.txt'), 'a'); await writeFile(join(repo, 'docs/parser-notes.md'), '# Parser notes\n'); await writeFile(join(repo, 'docs/quote-plan.md'), '# Quote plan\n');
sh(repo, 'git', 'init', '-q', '-b', 'main'); sh(repo, 'git', 'add', '.'); sh(repo, 'git', 'commit', '-q', '-m', 'first');
const fake = join(scratch, 'tuios'), openBin = join(scratch, 'open'), gh = join(scratch, 'gh');
await writeFile(fake, `#!/bin/sh\ncase "$1" in list-agents) echo '{"agents":[{"window_id":"omp-pane","agent_session_id":"sess-omp"}]}';; list-windows) echo '{"windows":[{"window_id":"fuzz-agent","agent_state":{"state":"working"}},{"window_id":"release-agent","agent_state":{"state":"needs_input"}}]}';; start-agent) echo '{"window_id":"x","ready":true}';; *) echo '{}';; esac\n`);
await writeFile(openBin, `#!/bin/sh\nprintf '%s\\n' "$@" >> '${join(scratch, 'open.log')}'\n`);
await writeFile(gh, '#!/bin/sh\necho \'{}\'\n');
for (const f of [fake, openBin, gh]) await chmod(f, 0o755);
const lines = [{ op: 'init', list: [{ phase: 'Parse', items: ['Handle empty input', 'Handle lone quotes', 'Escape sequences'] }] }, { op: 'done', task: 'Handle empty input' }].map(arguments_ => JSON.stringify({ message: { content: [{ type: 'toolCall', name: 'todo', arguments: arguments_ }] } }));
await writeFile(join(omp, 'sessions/proj/2026_sess-omp.jsonl'), lines.join('\n') + '\n');
const child = Bun.spawn([process.execPath, 'server.mjs'], { cwd: repoRoot, stdout: 'pipe', stderr: 'inherit', env: { ...process.env, HOME: home, PORT: port, TUIOS_INBOX_DATA: data, TUIOS_INBOX_SPOOL: join(data, 'events'), TUIOS_BIN: fake, TUIOS_INBOX_GH: gh, TUIOS_INBOX_OPEN: openBin, TUIOS_INBOX_COLLECTORS: join(data, 'none.json'), PI_CODING_AGENT_DIR: omp } });
const reader = child.stdout.getReader(); const first = new TextDecoder().decode((await reader.read()).value); if (!first.includes('listening on')) throw new Error(first);
await writeFile(join(scratch, 'server.pid'), String(child.pid));
const call = async (path, body, method = 'POST') => { const r = await fetch(base + '/api' + path, { method, headers: { 'Content-Type': 'application/json', 'X-Inbox-Request': '1' }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) }); const j = await r.json(); if (!r.ok) throw new Error(path + ' ' + JSON.stringify(j)); return j; };
let clock = Date.now() - 6 * 3600e3; const at = () => new Date(clock += 5 * 60e3).toISOString();
async function hook(key, values, rest) { const p = join(data, 'events', key + '.json'); await Bun.write(p, JSON.stringify({ id: key, time: at(), values, ...rest })); await call('/reconcile'); for (let i = 0; i < 40 && await Bun.file(p).exists(); i++) await Bun.sleep(100); await call('/reconcile'); }
const turn = (key, pane, prompt, response, state = 'done', session = 's') => hook(key, { TUIOS_EVENT: 'after-agent-state', TUIOS_AGENT_STATE: state, TUIOS_WINDOW_ID: pane, TUIOS_SESSION_ID: session }, { turn: { session, pane, name: pane, harness: 'omp', state, at: at(), prompt, response, source: 'pane' } });
const runsOf = async pane => (await call('/outline', null, 'GET')).runs.filter(r => r.pane_id === pane);
async function pane(name, taskId) { await turn('seed-' + name, name, 'Read the failing parser test', 'The test feeds a nested quote to the scanner.'); await call('/agents/update', { ids: [name], set: { task_id: taskId } }); for (const r of await runsOf(name)) await call('/turns/' + r.id.slice(5), { archived: true }, 'PATCH'); }
// tasks
const task = body => call('/tasks', body);
const fix = await task({ title: 'Fix parser', repo, queue_mode: 'auto', notes: [{ body: 'Quotes inside quotes are the crash.' }, { body: 'Ask about escaped backslashes.' }] });
const tok = await task({ title: 'Tokenizer edge cases', parent_id: fix.id });
const rel = await task({ title: 'Release notes', queue_mode: 'auto' });
const port2 = await task({ title: 'Port the tokenizer', repo });
const dbT = new Database(join(data, 'inbox.sqlite')); dbT.run("UPDATE tasks SET path='~/proj/parser' WHERE id IN (?,?)", [fix.id, port2.id]);
await pane('parser-agent', fix.id); await pane('readme-agent', fix.id); await pane('tokenizer-agent', tok.id); await pane('fuzz-agent', tok.id); await pane('release-agent', rel.id); await pane('omp-pane', port2.id); await pane('scratch', null);
const doc1 = 'Reproduce the crash on nested quotes', doc2 = 'Fix the quote scanner so the test passes', doc3 = 'Run the full suite and list failures';
await turn('p1', 'parser-agent', doc1, `Reproduced it. Write-up: [Crash analysis](http://127.0.0.1:4387/items/412)`);
await turn('p2', 'parser-agent', doc2, 'Fixed. The quote scanner now tracks the open quote character, so a nested quote no longer ends the token.\n\n- The plan I followed: [quote-plan.md](~/proj/parser/docs/quote-plan.md)\n- Design write-up: [Tokenizer design](http://127.0.0.1:4387/items/418)\n\nTwo tests still fail, both in the escape tests. I left them for the next prompt.');
await turn('p3', 'parser-agent', doc3, 'Two failures remain, both in the escape tests.');
await turn('r1', 'readme-agent', 'Document the new --strict flag', 'Added a section to the README.');
await turn('t1', 'tokenizer-agent', 'Add tests for empty input and lone quotes', 'Added 6 tests.');
await turn('s1', 'scratch', 'explain the retry loop in collector.mjs', 'It retries three times with a backoff.');
await turn('o1', 'omp-pane', 'Plan the tokenizer port', 'Plan is ready.');
// every kind of waiting turn: failed, ended idle, on a question, and one agent still working
await turn('e1', 'readme-agent', 'Regenerate the API reference', 'The generator exited with status 2: docs/api.toml is missing.', 'errored');
await turn('i1', 'tokenizer-agent', 'Profile the scanner on a 10 MB file', 'Profile written: [scanner-profile.md](~/proj/parser/docs/parser-notes.md)');
await turn('n1', 'release-agent', 'Tag v2.1 and push the release branch', '', 'needs_input', 'release');
await turn('w1', 'fuzz-agent', 'Run the tokenizer fuzz tests for an hour', '', 'working');
for (const r of await runsOf('readme-agent')) if (r.prompt === 'Document the new --strict flag') await call('/turns/' + r.id.slice(5), { unread: false }, 'PATCH');
// prompts and queues
const prompt = (body, task_id) => call('/prompts', { body, task_id }).then(j => j.prompt.id);
const db = new Database(join(data, 'inbox.sqlite'));
const setState = (id, state, error = '') => db.run('UPDATE prompts SET state=?,error=? WHERE id=?', [state, error, id]);
const q1 = await prompt('Add a regression test for single quotes', fix.id), q2 = await prompt('Update the changelog', fix.id);
const blocked = await prompt('Draft release notes from the last 10 commits', rel.id), q3 = await prompt('Proofread the release notes', rel.id);
setState(blocked, 'blocked', 'Nowhere to run: no pane at rest and no repo directory to launch in');
const running = await prompt('Run the tokenizer fuzz tests', tok.id), q4 = await prompt('Fix whatever the fuzzer finds', tok.id);
setState(running, 'running');
// a prompt that failed to run, and one queued for a named pane
const failed = await prompt('Publish the docs site', rel.id); setState(failed, 'errored', 'The pane closed before the prompt was sent');
const aimed = await prompt('Re-run the escape tests', fix.id); db.run("UPDATE prompts SET target='parser-agent' WHERE id=?", [aimed]);
// a turn that ended idle and one whose pane ended: the hook only reports done and errored, so these two are set here
db.run("UPDATE turns SET state='idle' WHERE prompt LIKE 'Profile the scanner%'"); db.run("UPDATE turns SET state='closed' WHERE prompt LIKE 'explain the retry loop%'");
db.run("UPDATE agents SET state='working' WHERE id='fuzz-agent'"); db.run("UPDATE agents SET state='needs_input', session='release' WHERE id='release-agent'");
// a run that came from a prompt: its task is the prompt's task
const done = await prompt('Run the full suite and list failures', fix.id); setState(done, 'done');
const p3 = (await runsOf('parser-agent')).find(r => r.prompt === doc3); db.run('UPDATE turns SET prompt_id=? WHERE id=?', [done, p3.id.slice(5)]);
// inheritance: a pane opened by hand in the task's own session has no task; its turns are filed under that task "via session"
const homeS = `inbox-${fix.id.slice(0, 8)}`;
await turn('h1', 'hand-opened', 'Check the lexer for off-by-one errors', 'Found one in the column counter.', 'done', homeS);
await turn('h2', 'hand-opened', 'Write up the column counter fix', 'Written up.', 'done', homeS);
// an assigned pane with an older turn that never got the task: it stays in the pane's one row
await turn('r0', 'readme-agent', 'List the flags the README does not mention', 'Three flags are missing.'); db.run("UPDATE turns SET task_id=NULL WHERE prompt LIKE 'List the flags%'");
// live panes with no turns at all: a fresh agent in the task's session, an assigned one, and two shells
const live = (id, name, kind, session, task) => db.run("INSERT INTO agents (id,session,name,harness,kind,task_id,state,seen) VALUES (?,?,?,?,?,?,'idle',?)", [id, session, name, kind === 'agent' ? 'omp' : '', kind, task, at()]);
live('fresh-agent', 'fresh-agent', 'agent', homeS, null); live('idle-helper', 'idle-helper', 'agent', 's', rel.id); live('build-shell', 'build-shell', 'shell', homeS, null); live('9f3c2a7e-1b5d-4c11-8a2e-000000000001', '', 'shell', 'scratchpad', null);
await call('/reconcile');
// wait for the omp todo import
for (let i = 0; i < 40; i++) { const o = await call('/outline', null, 'GET'); if (o.tasks.filter(t => t.source === 'omp-todo').length >= 3) break; await Bun.sleep(250); }
const o = await call('/outline', null, 'GET');
await writeFile(join(scratch, 'state.json'), JSON.stringify({ base, repo, home: homeS, fix: fix.id, tok: tok.id, rel: rel.id, port2: port2.id, blocked, p1: (await runsOf('parser-agent')).map(r => ({ id: r.id, prompt: r.prompt })), omp: o.tasks.filter(t => t.source === 'omp-todo').map(t => t.title) }, null, 1));
console.log(await Bun.file(join(scratch, 'state.json')).text());
process.exit(0);
