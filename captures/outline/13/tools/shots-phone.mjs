export default async ({ page, shot, S, base }) => {
  const id = n => S.p1.find(r => r.prompt.startsWith(n)).id.slice(5);
  for (const r of S.p1) if (!r.prompt.startsWith('Read the failing')) await fetch(S.base + '/api/turns/' + r.id.slice(5), { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Inbox-Request': '1' }, body: JSON.stringify({ unread: true }) });
  await page.setViewport({ width: 390, height: 760, deviceScaleFactor: 2 });
  await page.goto(base + '/#outline/run/' + id('Fix the quote'), { waitUntil: 'domcontentloaded' }); await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#ol-detail .ol-docs', { timeout: 15000 }); await Bun.sleep(900);
  await shot('08-phone-bar', null, [
    { n: 1, css: '#rail-toggle', badge: 'l', dx: -14 },
    { n: 2, css: '#ol-capture', badge: 'br', dx: -20 },
    { n: 3, css: '.ol-item-title', badge: 'tr', dx: -6 },
    { n: 4, css: '[data-wb-key="sec:docs"]', badge: 'tr', dx: -6 },
  ]);
  await page.evaluate(() => document.getElementById('rail-toggle').click()); await Bun.sleep(500);
  await page.evaluate(() => { const d = document.querySelector('.rt-stack'); if (d) d.open = false; });
  await page.setViewport({ width: 390, height: 980, deviceScaleFactor: 2 }); await Bun.sleep(300);
  await shot('09-phone-sheet', null, [
    { n: 1, css: '#rail-toggle', badge: 'l', dx: -14 },
    { n: 2, css: '#rail-heading', badge: 'br', dx: -6 },
    { n: 3, css: '.rt-item:not(.rt-doc)', text: 'Reproduce the crash', badge: 'tr', dx: -6 },
    { n: 4, css: '.rt-doc', text: 'Crash analysis', badge: 'tr', dx: -6 },
    { n: 5, css: '.rt-stack summary', badge: 'tr', dx: -6 },
    { n: 6, css: '.rail-views', badge: 'tr', dx: -6 },
    { n: 7, css: '#rail-more summary', badge: 'br', dx: -6 },
  ]);
};
