// usage: bun shots.mjs <scratch dir> <out dir> [suffix]   Drives Chrome (puppeteer-core) against the scratch server seed.mjs started:
// takes the screenshots and prints behaviour checks (state kept across live updates, 304 does nothing, queue keys). Never the live instance.
import puppeteer from '/Users/unixsuperhero/.bun/install/global/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import { join } from 'node:path';
const [scratch, out, suffix = ''] = process.argv.slice(2);
const S = await Bun.file(join(scratch, 'state.json')).json(), base = S.base;
if (base.endsWith(':4399')) throw new Error('live instance');
const api = (path, body, method = 'POST') => fetch(base + '/api' + path, body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json', 'X-Inbox-Request': '1' }, body: JSON.stringify(body) }).then(r => r.json());
const seeded = (await api('/outline')).runs.filter(r => !r.archived && r.prompt !== 'Document the new --strict flag' && !['working', 'needs_input'].includes(r.state));
const reset = async () => { for (const r of seeded) await api('/turns/' + r.id.slice(5), { unread: true }, 'PATCH'); };
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, userDataDir: join(scratch, 'chrome' + suffix), args: ['--no-first-run'] });
const errors = [], hits = []; let page, reduce = false;
const media = r => page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: (reduce = r) ? 'reduce' : 'no-preference' }]);
// A fresh tab per page: a hash change in the old one would open (and so read) an item before the screenshot.
const go = async (hash, w = 1440, h = 900) => {
  if (page) await page.close();
  page = await browser.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => { const u = new URL(r.url()); if (['/api/outline', '/api/state'].includes(u.pathname)) hits.push(`${u.pathname.slice(5)} ${r.status()}`); });
  await media(false); await page.setViewport({ width: w, height: h, deviceScaleFactor: w < 500 ? 2 : 1 });
  await page.goto(base + '/' + hash, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('#rail-tree .rt-row, #rail-tree .rt-empty', { timeout: 15000 }); await Bun.sleep(900);
};
const shot = (name, clip) => page.screenshot({ path: join(out, name + suffix + '.png'), clip });
const ev = (fn, ...a) => page.evaluate(fn, ...a);
const click = async (css, text) => { await ev((css, text) => [...document.querySelectorAll(css)].find(e => !text || (e.getAttribute('aria-label') || e.textContent).includes(text)).click(), css, text); await Bun.sleep(350); };
const check = (name, ok, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
const rail = h => ({ x: 0, y: 0, width: 318, height: h });
await reset();

// 01 the whole page: Queue first, one row per pane, every row and header with its indicators, one agent working
await go('#outline/tasks', 1440, 1180);
await ev(() => localStorage.clear()); await go('#outline/tasks', 1440, 1180);
await shot('01-page');
await shot('02-rail-rows-collapsed', rail(1000));
check('one row per pane under each task', await ev(() => [...document.querySelectorAll('.rt-items')].every(ul => { const k = [...ul.children].map(li => li.dataset.wbKey); return new Set(k).size === k.length; })));
check('collapsed rows render no child DOM', await ev(() => document.querySelectorAll('.rt-detail').length === 0));
check('working icon spins', await ev(() => getComputedStyle(document.querySelector('.rt-row .ic-working')).animationName) === 'ic-spin');
await media(true);
check('reduced motion: working icon pulses, never still', await ev(() => getComputedStyle(document.querySelector('.rt-row .ic-working')).animationName) === 'ic-pulse');
await media(false);

// 03 a pane row expanded in place
await click('.rt-row .rt-twist', 'parser-agent');
await shot('03-pane-row-expanded', rail(560));
// live update with the row open, a task collapsed, text half typed and the rail scrolled: nothing resets
await click('[data-rail-act=task]', 'Release notes');
await page.setViewport({ width: 1440, height: 620 }); await Bun.sleep(200);
await ev(() => { const i = document.getElementById('ol-capture-input'); i.focus(); i.value = 'half typed'; i.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('rail-tree').scrollTop = 60; });
const before = await ev(() => ({ open: document.querySelectorAll('.rt-detail').length, shut: document.querySelectorAll('.rt-group.is-shut').length, text: document.getElementById('ol-capture-input').value, top: document.getElementById('rail-tree').scrollTop, focus: document.activeElement.id }));
const omp = seeded.find(r => r.pane_id === 'omp-pane');
await api('/turns/' + omp.id.slice(5), { unread: false }, 'PATCH'); await Bun.sleep(1200);
const after = await ev(() => ({ open: document.querySelectorAll('.rt-detail').length, shut: document.querySelectorAll('.rt-group.is-shut').length, text: document.getElementById('ol-capture-input').value, top: document.getElementById('rail-tree').scrollTop, focus: document.activeElement.id }));
check('live update keeps expanded row, collapsed task, typed text, scroll and focus', JSON.stringify(before) === JSON.stringify(after) && before.open === 1 && before.shut === 1, JSON.stringify(after));
check('the live update did land', await ev(id => !document.querySelector(`[data-wb-key="t:${id}"] .rt-q`), S.port2));
// a change event with nothing changed: 304 on both, and not one DOM mutation
await ev(() => { window.__m = 0; new MutationObserver(l => window.__m += l.length).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true }); });
hits.length = 0; await api('/turns/' + omp.id.slice(5), { unread: false }, 'PATCH'); await api('/reconcile', {}); await Bun.sleep(1500);
check('unchanged refresh answers 304 and touches no DOM', hits.length > 0 && hits.every(h => h.endsWith('304')) && await ev(() => window.__m) === 0, `${hits.join(', ')}; mutations ${await ev(() => window.__m)}`);

// 04 a collapsed task still shows the union of everything inside; it is remembered across a reload
await reset(); await go('#outline/tasks', 1440, 1180);
check('collapsed task is remembered across a reload', await ev(() => document.querySelectorAll('.rt-group.is-shut').length) === 1);
await click('[data-rail-act=task]', 'Collapse Fix parser');
check('a collapsed task renders only its header', await ev(() => [...document.querySelectorAll('.rt-group.is-shut')].every(g => g.children.length === 1 && g.querySelector('.rt-inds'))));
await shot('04-task-collapsed', rail(420));
await ev(() => localStorage.clear());

// 05 the Queue page: everything that waits, oldest first, the top item open
await reset(); await go('#queue');
await shot('05-queue-all');
const q = () => ev(() => ({ rows: [...document.querySelectorAll('.q-row')].map(r => r.querySelector('.q-text').textContent), sel: document.querySelector('.q-row.is-selected .q-text')?.textContent, read: [...document.querySelectorAll('.q-row.is-read .q-text')].map(e => e.textContent), count: document.querySelector('.q-count b').textContent, title: document.querySelector('.ol-item-title')?.textContent }));
const q0 = await q();
check('queue opens its top item, which is read and stays listed', q0.sel === q0.rows[0] && q0.read.length === 1 && q0.read[0] === q0.sel && q0.title === q0.sel, `${q0.rows.length} rows, ${q0.count} waiting`);
await ev(() => { const t = document.getElementById('olf-reply'); t.focus(); t.value = 'draft reply'; t.dispatchEvent(new Event('input', { bubbles: true })); });
await api('/turns/' + omp.id.slice(5), { unread: false }, 'PATCH'); await Bun.sleep(1200);
const q1 = await q();
check('live update on the queue keeps the open item, the reply draft and its focus', q1.sel === q0.sel && await ev(() => document.getElementById('olf-reply').value === 'draft reply' && document.activeElement.id === 'olf-reply'), `rows ${q0.rows.length} -> ${q1.rows.length}`);
await ev(() => document.activeElement.blur());
await page.keyboard.press('j'); await Bun.sleep(500);
const q2 = await q();
check('j opens the next item and the read one leaves the list', q2.sel === q1.rows[1] && !q2.rows.includes(q1.sel) && q2.rows.length === q1.rows.length - 1, q2.sel);
await page.keyboard.press('n'); await Bun.sleep(500);
const q3 = await q();
check('n moves on the same way', q3.sel === q2.rows[1] && !q3.rows.includes(q2.sel), q3.sel);
await click('.ol-next button'); const q4 = await q();
check('Next button moves on', q4.sel !== q3.sel && !q4.rows.includes(q3.sel), q4.sel);
check('queue links: rail headers, pane rows, item view, chips', await ev(() => ['.rt-head .rt-q[href^="#queue/task/"]', '.rt-rowhead .rt-q[href^="#queue/pane/"]', '.ol-qlinks a[href^="#queue/pane/"]', '.ol-qlinks a[href^="#queue/task/"]', '.q-chip[href="#queue"]', '.q-chip[href^="#queue/session/"]', '#rail-queue[href="#queue"]', '.rail-view[href="#queue"]'].map(s => s + ':' + document.querySelectorAll(s).length).filter(s => s.endsWith(':0'))).then(miss => miss.length === 0 || (console.log(miss), false)));

// 06 one task's queue; 07 the empty state
await reset(); await go('#queue/task/' + S.fix);
check('task scope lists that task and its subtasks only', await ev(() => [...document.querySelectorAll('.q-path')].every(p => p.textContent.startsWith('Fix parser'))) && (await q()).rows.length > 3);
await shot('06-queue-task');
await go('#queue/session/release'); check('session scope', (await q()).rows.join('|') === 'Tag v2.1 and push the release branch');
await go('#queue/pane/tokenizer-agent'); check('pane scope', (await q()).rows.length === 2, (await q()).rows.join(' | '));
const quiet = (await api('/outline')).tasks.find(t => t.title === 'Handle lone quotes');
await go('#queue/task/' + quiet.id);
check('empty scope shows the empty state', await ev(() => Boolean(document.querySelector('.q-empty')) && document.querySelector('.q-count b').textContent === '0'));
await shot('07-queue-empty');
await go('#outline/needs-me'); check('#outline/needs-me still works', await ev(() => document.querySelectorAll('.ol-line.is-rgroup').length > 0 && document.getElementById('ol-title').textContent === 'Needs me'));
await go('#queues'); check('the older #queues page still works', await ev(() => document.querySelectorAll('.qb-bucket').length > 0), await ev(() => document.querySelector('.qb-bucket[href]')?.getAttribute('href')));

// 08, 09 phone: the rail sheet, and the queue with the list on top and the open item below
await reset(); await go('#outline/tasks', 390, 844);
await click('#rail-toggle'); await click('.rt-row .rt-twist', 'parser-agent');
await shot('08-phone-rail');
check('phone rail: no horizontal scroll', await ev(() => document.documentElement.scrollWidth <= innerWidth));
await go('#queue', 390, 844);
await shot('09-phone-queue');
check('phone queue: no horizontal scroll, list and item both shown', await ev(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('.q-row').offsetParent !== null && document.querySelector('.ol-item-title').offsetParent !== null));
await reset();
console.log(errors.length ? 'PAGE ERRORS\n' + errors.join('\n') : 'no page errors');
await browser.close(); process.exit(0);
