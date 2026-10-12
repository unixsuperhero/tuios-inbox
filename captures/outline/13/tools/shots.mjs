const T = { rail: '#rail-tree' };
export default async ({ page, go: go0, shot, S }) => {
  const id = n => S.p1.find(r => r.prompt.startsWith(n)).id.slice(5);
  const click = async (css, text) => { await page.evaluate((css, text) => [...document.querySelectorAll(css)].find(e => !text || e.textContent.includes(text)).click(), css, text); await Bun.sleep(300); };

  const reset = async () => { for (const r of S.p1) if (!r.prompt.startsWith('Read the failing')) await fetch(S.base + '/api/turns/' + r.id.slice(5), { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Inbox-Request': '1' }, body: JSON.stringify({ unread: true }) }); };
  await reset();
  const go = async (...a) => { await reset(); return go0(...a); };
  // 01 whole page
  await go('tasks');
  await shot('01-page', null, [
    { n: 1, css: '#rail-heading', badge: 'r', dx: 6 },
    { n: 2, css: '.rt-task', text: 'Fix parser', badge: 'r', dx: 6 },
    { n: 3, css: '.rt-item:not(.rt-doc)', text: 'Reproduce the crash', badge: 'r', dx: 6 },
    { n: 4, css: '.rt-doc', text: 'Crash analysis', badge: 'r', dx: 6 },
    { n: 5, css: '.rt-stack summary', badge: 'r', dx: 12 },
    { n: 6, css: '.rt-item', text: 'Document the new', badge: 'r', dx: 6 },
    { n: 7, css: '.rt-subtask', text: 'Tokenizer edge', badge: 'r', dx: 6 },
    { n: 8, css: '.rt-task', text: 'No task', badge: 'r', dx: 6 },
    { n: 9, css: '.rail-views', badge: 'r', dx: 6 },
    { n: 10, css: '#rail-more summary', badge: 'r', dx: 6 },
    { n: 11, css: '#ol-capture', badge: 'tr' },
    { n: 12, css: '.ol-tasks', badge: 'tr' },
  ]);

  // 02a / 02b the rail, stack closed then open
  const railClip = { x: 0, y: 70, width: 340, height: 330 };
  await go('tasks');
  await shot('02a-stack-closed', railClip, [
    { n: 1, css: '.rt-item:not(.rt-doc)', text: 'Reproduce the crash', badge: 'r', dx: 8 },
    { n: 2, css: '.rt-doc', text: 'Crash analysis', badge: 'r', dx: 8 },
    { n: 3, css: '.rt-stack summary', badge: 'r', dx: 14 },
    { n: 4, css: '.rt-item', text: 'Document the new', badge: 'r', dx: 8 },
  ]);
  await click('.rt-stack summary');
  await shot('02b-stack-open', { x: 0, y: 70, width: 340, height: 470 }, [
    { n: 1, css: '.rt-item:not(.rt-doc)', text: 'Reproduce the crash', badge: 'r', dx: 8 },
    { n: 2, css: '.rt-doc', text: 'Crash analysis', badge: 'r', dx: 8 },
    { n: 3, css: '.rt-stack summary', badge: 'r', dx: 14 },
    { n: 4, css: '.rt-stack .rt-item:not(.rt-doc)', text: 'Fix the quote', badge: 'r', dx: 8 },
    { n: 5, css: '.rt-stack .rt-doc', text: 'quote-plan.md', badge: 'r', dx: 8 },
    { n: 6, css: '.rt-stack .rt-doc', text: 'Tokenizer design', badge: 'r', dx: 8 },
    { n: 7, css: '.rt-stack .rt-item:not(.rt-doc)', text: 'Run the full suite', badge: 'r', dx: 8 },
  ]);
  // 03 the item page with a Documents block
  await go('run/' + id('Fix the quote'), 1300);
  await shot('03-item', null, [
    { n: 1, css: '.rt-item[aria-current]', badge: 'r', dx: 8 },
    { n: 2, css: '.ol-item-title', badge: 'tr', pad: 4 },
    { n: 3, css: '[data-wb-key="sec:prompt"]', badge: 'tr' },
    { n: 4, css: '[data-wb-key="sec:docs"] .ol-sec-head', badge: 'tr' },
    { n: 5, css: '.ol-docs li', badge: 'tl', dx: -12 },
    { n: 6, css: '.ol-doc-acts', badge: 'tl', dx: -6, dy: -2 },
    { n: 7, css: '.ol-docs li', nth: 1, badge: 'r' },
    { n: 8, css: '[data-wb-key="sec:response"]', badge: 'tr' },
    { n: 9, css: '.ol-reply', badge: 'tr' },
    { n: 10, css: '[data-wb-key="sec:history"]', badge: 'tr' },
    { n: 11, css: '.ol-facts', badge: 'tr' },
  ]);

  // 04 the tasks list: queue words and a focused row
  await go('tasks');
  await page.evaluate(() => document.activeElement?.blur?.());
  for (let i = 0; i < 4; i++) await page.keyboard.press('j');
  await Bun.sleep(300);
  await shot('04-tasks-list', { x: 316, y: 0, width: 1124, height: 560 }, [
    { n: 1, css: '.ol-tasks-note', badge: 'r', dx: 4 },
    { n: 2, css: '.ol-trow-facts .ol-state', text: 'not started', badge: 'tl', dx: -2, dy: -3 },
    { n: 3, css: '.ol-trow-facts .ol-state', text: 'waiting', badge: 'tl', dx: -2, dy: -3 },
    { n: 4, css: '.ol-trow-facts .ol-state', text: 'held', badge: 'tl', dx: -2, dy: -3 },
    { n: 5, css: '.ol-trow.is-kfocus', badge: 'r', dx: 8 },
  ]);
  // 04b the delete confirmation, naming notes and subtasks
  await go('tasks');
  await click('.ol-trow button[data-act="ask-delete-task"]');
  await shot('04b-tasks-delete', { x: 316, y: 0, width: 1124, height: 460 }, [
    { n: 1, css: '.ol-trow', text: 'Fix parser', badge: 'tr' },
    { n: 2, css: '.ol-trow-confirm p', badge: 'tl', dx: -2 },
    { n: 3, css: '.ol-trow-confirm .ol-trow-acts', badge: 'tr', pad: 4 },
  ]);
  console.log(await page.evaluate(() => document.querySelector('.ol-trow-confirm').innerText));
  await click('button[data-act="keep"]');

  // 05 task detail with the queue status line (Fix parser: repo field, not started)
  await go('task/' + S.fix, 1400);
  await shot('05-task', { x: 0, y: 0, width: 1440, height: 940 }, [
    { n: 1, css: '[data-wb-key="f:repo"]', badge: 'tr' },
    { n: 2, css: '[data-wb-key="f:queue_mode"]', badge: 'tr' },
    { n: 3, css: '[data-wb-key="qstatus"]', badge: 'tr' },
    { n: 4, css: '[data-act="run-next"]', badge: 'tr' },
    { n: 5, css: '[data-wb-key="sec:queue"] ol.ol-list', badge: 'tr' },
  ]);
  const qclip = async () => page.evaluate(() => { const r = document.querySelector('[data-wb-key="sec:queue"]').getBoundingClientRect(); return { x: 296, y: Math.floor(r.top) - 12, width: 944, height: Math.min(Math.ceil(r.height) + 24, 240) }; });
  await go('task/' + S.rel, 1400);
  await shot('05b-queue-held', await qclip(), [
    { n: 1, css: '[data-wb-key="qstatus"]', badge: 'l', dx: -14 },
    { n: 2, css: '[data-wb-key="qstatus"] a', badge: 'br', dy: 3 },
  ]);
  await go('task/' + S.tok, 1400);
  await shot('05c-queue-waiting', await qclip(), [
    { n: 1, css: '[data-wb-key="qstatus"]', badge: 'l', dx: -14 },
    { n: 2, css: '[data-wb-key="qstatus"] a', badge: 'br', dy: 3 },
  ]);
  // 06 omp todo subtasks, tagged
  await go('everything', 1700);
  const box = await page.evaluate(() => { const l = [...document.querySelectorAll('.ol-line')]; const a = l.find(e => e.innerText.startsWith('Port the tokenizer')).getBoundingClientRect(), z = l.find(e => e.innerText.startsWith('Escape sequences')).getBoundingClientRect(); return { x: 316, y: Math.floor(a.top) - 16, width: 764, height: Math.ceil(z.bottom - a.top) + 30 }; });
  await shot('10-omp-todo', box, [
    { n: 1, css: '.ol-line', text: 'Port the tokenizer', badge: 'tr', dx: -2 },
    { n: 2, css: '.ol-line.is-done', text: 'Handle empty input', badge: 'tr', dx: -2 },
    { n: 3, css: '.ol-line', text: 'Handle lone quotes', badge: 'tr', dx: -2 },
    { n: 4, css: '.ol-line .ol-tag', text: 'from omp todo', nth: 1, badge: 'br', dy: 2 },
  ]);
  // 07 a run that came from a prompt: its Task select is disabled
  await go('run/' + id('Run the full'), 1300);
  await click('.ol-facts summary');
  const box2 = await page.evaluate(() => { const r = document.querySelector('.ol-facts').getBoundingClientRect(); return { x: 316, y: Math.floor(r.top) - 8, width: 1124, height: Math.ceil(r.height) + 70 }; });
  await shot('11-run-from-prompt', box2, [
    { n: 1, css: '.ol-facts select[data-save$=":task_id"]', badge: 'tr' },
    { n: 2, css: '.ol-inline .ol-dim', badge: 'br', dx: 8, dy: 2 },
  ]);
};
