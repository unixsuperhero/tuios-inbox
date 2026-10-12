// usage: bun shoot.mjs <scratch dir> <out dir>   Drives Chrome (puppeteer-core) against the scratch server; raw shots, then annotated shots.
import puppeteer from '/Users/unixsuperhero/.bun/install/global/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import { join } from 'node:path';
const [scratch, out] = process.argv.slice(2);
const S = await Bun.file(join(scratch, 'state.json')).json(), base = S.base;
if (base.endsWith(':4399')) throw new Error('live instance');
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, userDataDir: join(scratch, 'chrome'), args: ['--no-first-run'] });
const page = await browser.newPage();
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
await page.setViewport({ width: 1440, height: 900 });
const go = async (hash, h = 900) => { await page.setViewport({ width: 1440, height: h }); await page.goto(base + '/#outline/' + hash.replace(/^#?(outline\/)?/, ''), { waitUntil: 'domcontentloaded' }); await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('#rail-tree .rt-item, #rail-tree .rt-empty', { timeout: 15000 }); await Bun.sleep(900); };
const shot = async (name, clip, marks = [], pad = 0) => {
  await page.evaluate(() => document.querySelectorAll('.cap-mark').forEach(e => e.remove()));
  await page.screenshot({ path: join(out, 'raw', name + '.png'), clip: clip && { ...clip }, fullPage: false });
  if (!marks.length) return;
  const miss = await page.evaluate(marks => {
    const miss = [];
    const find = m => { const list = [...document.querySelectorAll(m.css)].filter(e => e.offsetParent !== null || getComputedStyle(e).position === 'fixed'); const hit = m.text ? list.filter(e => e.textContent.includes(m.text)) : list; return m.last ? hit.at(-1) : m.nth ? hit[m.nth] : hit[0]; };
    for (const m of marks) {
      const el = find(m); if (!el) { miss.push(m.n); continue; }
      let r = el.getBoundingClientRect(); const p = m.pad ?? (m.css.startsWith('.rt-') ? 1 : 3);
      const box = document.createElement('div'); box.className = 'cap-mark';
      Object.assign(box.style, { position: 'fixed', left: r.left - p + 'px', top: r.top - p + 'px', width: r.width + 2 * p + 'px', height: r.height + 2 * p + 'px', border: '2px solid #f5a623', borderRadius: '4px', pointerEvents: 'none', zIndex: 99999, boxSizing: 'border-box' });
      document.body.append(box);
      const d = 22, side = m.badge || 'tr', bx = side.includes('l') ? r.left - p : side.includes('r') ? r.right + p : (r.left + r.right) / 2, by = side.includes('t') ? r.top - p : side.includes('b') ? r.bottom + p : (r.top + r.bottom) / 2;
      const b = document.createElement('div'); b.className = 'cap-mark'; b.textContent = m.n;
      Object.assign(b.style, { position: 'fixed', left: bx - d / 2 + (m.dx || 0) + 'px', top: by - d / 2 + (m.dy || 0) + 'px', width: d + 'px', height: d + 'px', borderRadius: '50%', background: '#f5a623', color: '#1a1306', font: '700 13px/22px system-ui, sans-serif', textAlign: 'center', border: '2px solid #1a1306', boxSizing: 'content-box', marginLeft: '-2px', marginTop: '-2px', pointerEvents: 'none', zIndex: 100000 });
      document.body.append(b);
    }
    return miss;
  }, marks);
  if (miss.length) console.log(name, 'MISSING marks', miss.join(','));
  await page.screenshot({ path: join(out, name + '.png'), clip: clip && { ...clip }, fullPage: false });
  await page.evaluate(() => document.querySelectorAll('.cap-mark').forEach(e => e.remove()));
};
const SHOTS = (await import(join(import.meta.dir, process.env.SHOTS || 'shots.mjs'))).default;
await SHOTS({ page, go, shot, S, base, scratch, browser });
await browser.close();
process.exit(0);
