// usage: bun shots.mjs <scratch dir> <out dir>   Drives Chrome (puppeteer-core) against the scratch server seed.mjs started: inherited-task rows,
// rows for live panes with no turns, shells, the two-step Mark all read, and pane-row count = pane queue. Never the live instance.
import puppeteer from '/Users/unixsuperhero/.bun/install/global/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import { join } from 'node:path';
const [scratch, out] = process.argv.slice(2);
const S = await Bun.file(join(scratch, 'state.json')).json(), base = S.base;
if (base.endsWith(':4399')) throw new Error('live instance');
const api = (path, body, method = 'POST') => fetch(base + '/api' + path, body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json', 'X-Inbox-Request': '1' }, body: JSON.stringify(body) }).then(r => r.json());
const seeded = (await api('/outline')).runs.filter(r => !r.archived && r.prompt !== 'Document the new --strict flag' && !['working', 'needs_input'].includes(r.state));
const reset = async () => { for (const r of seeded) await api('/turns/' + r.id.slice(5), { unread: true }, 'PATCH'); };
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, userDataDir: join(scratch, 'chrome15'), args: ['--no-first-run'] });
const errors = []; let page;
const go = async (hash, w = 1440, h = 900) => {
  if (page) await page.close();
  page = await browser.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]); await page.setViewport({ width: w, height: h, deviceScaleFactor: w < 500 ? 2 : 1 });
  await page.goto(base + '/' + hash, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('#rail-tree .rt-row, #rail-tree .rt-empty', { timeout: 15000 }); await Bun.sleep(900);
};
const shot = (name, clip) => page.screenshot({ path: join(out, name + '.png'), clip });
const ev = (fn, ...a) => page.evaluate(fn, ...a);
const click = async (css, text) => { await ev((css, text) => [...document.querySelectorAll(css)].find(e => !text || (e.getAttribute('aria-label') || e.textContent).includes(text)).click(), css, text); await Bun.sleep(350); };
const check = (name, ok, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
await reset();

// 01 the rail: a hand-opened pane filed under its session's task, a live pane with no turns, shells
await go('#outline/tasks', 1440, 1180); await ev(() => localStorage.clear()); await go('#outline/tasks', 1440, 1180);
await shot('01-page');
await shot('02-rail-inherited-empty-shell', { x: 0, y: 0, width: 318, height: 1180 });
const rows = await ev(() => [...document.querySelectorAll('.rt-row')].map(li => ({ task: li.closest('.rt-sub')?.querySelector('.rt-title').textContent || li.closest('.rt-group').querySelector('.rt-title').textContent, name: li.querySelector('.rt-name').textContent, via: Boolean(li.querySelector('.rt-via')), empty: li.classList.contains('is-empty'), shell: Boolean(li.querySelector('.ic-shell')), sum: li.querySelector('.rt-item > .rt-sum').textContent, n: li.querySelector('.rt-q b')?.textContent || '', href: li.querySelector('.rt-q')?.getAttribute('href') || '', key: li.dataset.wbKey })));
const row = name => rows.filter(r => r.name === name);
check('one row per pane in the whole rail', (k => new Set(k).size === k.length && k.length > 10)(rows.map(r => r.key.split('|')[1]).filter(k => k.startsWith('pane:'))), `${rows.length} rows`);
check('hand-opened pane is filed under its session\'s task, marked via session', row('hand-opened').length === 1 && row('hand-opened')[0].task === 'Fix parser' && row('hand-opened')[0].via && row('hand-opened')[0].n === '2', JSON.stringify(row('hand-opened')));
check('an assigned pane keeps its taskless older turn in its one row', row('readme-agent').length === 1 && row('readme-agent')[0].task === 'Fix parser' && !row('readme-agent')[0].via, JSON.stringify(row('readme-agent')));
check('a live agent with no turns has a dim row under the inherited task', row('fresh-agent').length === 1 && row('fresh-agent')[0].empty && row('fresh-agent')[0].via && row('fresh-agent')[0].task === 'Fix parser', JSON.stringify(row('fresh-agent')));
check('a live assigned agent with no turns has a row under its task', row('idle-helper')[0]?.task === 'Release notes' && row('idle-helper')[0].empty && !row('idle-helper')[0].via);
check('shell rows: icon, under the inherited task and under No task, unnamed one falls back to kind + short id', row('build-shell')[0]?.shell && row('build-shell')[0].task === 'Fix parser' && row('shell 9f3c2a7e')[0]?.task === 'No task' && row('shell 9f3c2a7e')[0].shell, JSON.stringify([row('build-shell'), row('shell 9f3c2a7e')]));
// pane-row count = what the pane's queue page lists
const linked = rows.filter(r => r.href.startsWith('#queue/pane/')); let agree = linked.length > 3; const seen = [];
for (const r of linked) { await go(r.href); const n = await ev(() => ({ rows: document.querySelectorAll('.q-row:not(.is-read)').length + document.querySelectorAll('.q-row.is-read').length, count: document.querySelector('.q-count b').textContent })); seen.push(`${r.name} ${r.n}/${n.rows}/${n.count}`); if (String(n.rows) !== r.n) agree = false; await reset(); }
check('every pane row count equals the rows its pane queue page lists (row count/rows listed/count once the top item is read)', agree, seen.join(', '));

// 03 the item page of an inherited run
await reset(); const hand = (await api('/outline')).runs.find(r => r.prompt.startsWith('Write up the column'));
await go('#outline/run/' + encodeURIComponent(hand.id.slice(5)));
check('item page names the task as inherited', await ev(() => /Fix parser\s+via session/.test(document.querySelector('.ol-where').textContent)), await ev(() => document.querySelector('.ol-where').textContent));
await shot('03-item-via-session');

// 04 the Queue page: Mark all read is two steps, in the page
await reset(); await go('#queue');
const q = () => ev(() => ({ count: +document.querySelector('.q-count b').textContent, rows: document.querySelectorAll('.q-row').length, btn: document.querySelector('.q-markall')?.textContent || '', armed: Boolean(document.querySelector('.q-markall.is-armed')), top: document.getElementById('ol-tree').scrollTop }));
const q0 = await q();
check('not armed at first', q0.btn === 'Mark all read' && !q0.armed, JSON.stringify(q0));
await click('.q-markall'); const q1 = await q();
check('first click arms it with the number', q1.armed && /^Mark \d+ read — confirm$/.test(q1.btn) && q1.count === q0.count, q1.btn);
await shot('04-queue-mark-all-armed');
// a live update while armed: still armed, typed reply and scroll kept
await page.setViewport({ width: 1440, height: 520 }); await Bun.sleep(200);
await ev(() => { const t = document.getElementById('olf-reply'); t.value = 'half typed'; t.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('ol-tree').scrollTop = 40; });
const topBefore = (await q()).top, omp = seeded.find(r => r.pane_id === 'omp-pane');
await api('/turns/' + omp.id.slice(5), { unread: false }, 'PATCH'); await Bun.sleep(1300); const q2 = await q();
check('a live update keeps it armed, with the new number, the draft and the scroll', q2.armed && q2.count === q1.count - 1 && q2.btn !== q1.btn && q2.top === topBefore && await ev(() => document.getElementById('olf-reply').value === 'half typed'), `${q1.btn} -> ${q2.btn}; scroll ${topBefore} -> ${q2.top}; count ${q1.count} -> ${q2.count}`);
await page.keyboard.press('Escape'); await Bun.sleep(300);
check('Escape cancels', !(await q()).armed && (await q()).count === q2.count);
await click('.q-markall'); await click('#ol-title');
check('a click elsewhere cancels', !(await q()).armed && (await q()).count === q2.count);
await click('.q-markall'); await click('.q-markall'); await Bun.sleep(1300); const q3 = await q();
const left = await ev(() => [...document.querySelectorAll('.q-row:not(.is-read) .ic')].map(i => i.getAttribute('class').match(/ic-(\w+)/)[1]));
check('second click marks them read; questions and blocked or errored prompts stay', q3.count === left.length && left.length > 0 && left.every(k => ['needs_input', 'blocked', 'prompt_error'].includes(k)) && !q3.btn, `${q2.count} -> ${q3.count}: ${left.join(', ')}`);
check('no browser dialog was used', true);
// scoped: only the task's turns go
await reset(); await go('#queue/task/' + S.fix); await click('.q-markall'); const scoped = await q(); await click('.q-markall'); await Bun.sleep(1300);
const after = (await api('/outline')).runs.filter(r => r.unread && !r.archived).map(r => r.pane_id).sort();
check('task scope marks only that task and its subtasks', /^Mark \d+ read/.test(scoped.btn) && after.join() === 'omp-pane,scratch', `${scoped.btn}; still unread: ${after.join(', ')}`);

// 05, 06 phone
await reset(); await go('#queue', 390, 844); await click('.q-markall');
await shot('05-phone-queue-mark-all-armed');
check('phone queue: no horizontal scroll, control armed', await ev(() => document.documentElement.scrollWidth <= innerWidth && Boolean(document.querySelector('.q-markall.is-armed'))));
await go('#outline/tasks', 390, 844); await click('#rail-toggle');
await shot('06-phone-rail');
check('phone rail: no horizontal scroll', await ev(() => document.documentElement.scrollWidth <= innerWidth));
await reset();
console.log(errors.length ? 'PAGE ERRORS\n' + errors.join('\n') : 'no page errors');
await browser.close(); process.exit(0);
