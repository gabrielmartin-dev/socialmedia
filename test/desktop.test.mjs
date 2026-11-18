// Desktop layout: side bar on the left, centred 600 px column, right column on wide screens,
// ↑ ↓ to change video. The phone layout must stay as it was.
//
// 1. Static checks, always run (CI included).
// 2. A browser run (Playwright) when Playwright and the demo data (`npm run sample`) are
//    available — skipped otherwise.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { WIDE_QUERY } from '../public/app/util.js';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const css = await fs.readFile(path.join(PUBLIC, 'styles.css'), 'utf8');

test('CSS and JS agree on what a desktop screen is', () => {
  assert.ok(css.includes(`@media ${WIDE_QUERY} {`), `styles.css needs a « @media ${WIDE_QUERY} » block`);
});

test('desktop-only elements are hidden outside the desktop query', () => {
  const before = css.slice(0, css.indexOf(`@media ${WIDE_QUERY}`));
  assert.match(before, /\.side-brand, \.side-link, \.sidecol, \.reel-nav \{ display: none; \}/);
});

// ---------- Browser run ----------

let playwright = null;
try { playwright = createRequire(import.meta.url)('playwright'); } catch { /* not installed */ }
const hasData = await fs.access(path.join(PUBLIC, 'data', 'videos.json')).then(() => true, () => false);
const skip = !playwright ? 'Playwright not installed' : !hasData ? 'no data (npm run sample)' : false;

async function withApp(contextOptions, run) {
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
  const server = http.createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(PUBLIC, path.normalize(p));
    if (p === '/sw.js' || !file.startsWith(PUBLIC)) { res.writeHead(404).end(); return; }
    try { res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(await fs.readFile(file)); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise((r) => server.listen(0, r));
  const browser = await playwright.chromium.launch();
  try {
    const ctx = await browser.newContext(contextOptions);
    await ctx.addInitScript(() => { try { localStorage.setItem('installGuide', '1'); } catch { /* */ } });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForSelector('#actus-list .tweet');
    await run(page);
  } finally {
    await browser.close();
    server.close();
  }
}

const rect = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el || getComputedStyle(el).display === 'none') return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
}, sel);

test('browser: desktop layout (1440 × 900)', { skip, timeout: 90_000 }, async () => {
  await withApp({ viewport: { width: 1440, height: 900 } }, async (page) => {
    const nav = await rect(page, '.tabbar');
    const main = await rect(page, 'main');
    const side = await rect(page, '#sidecol');
    assert.ok(nav.top === 0 && nav.height === 900, 'side bar from top to bottom');
    assert.ok(nav.right <= main.left + 0.5, 'side bar left of the column');
    assert.equal(Math.round(main.width), 600, 'column 600 px wide');
    assert.ok(side && side.left >= main.right, 'right column right of the column');
    assert.ok(Math.abs(nav.left - (1440 - side.right)) < 2, 'the whole is centred');
    assert.ok(await rect(page, '.side-link[data-action=settings]'), 'Paramètres in the side bar');
    assert.equal(await rect(page, '#settings-btn'), null, 'not twice');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 1440, 'no horizontal scroll');

    // Bars never slide away on a desktop.
    for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 500); await page.waitForTimeout(120); }
    assert.ok(!(await page.evaluate(() => document.body.classList.contains('bars-hidden'))));

    // Vidéos: centred player, keyboard navigation, side bar still there.
    await page.click('.tab[data-view=videos]');
    await page.waitForTimeout(400);
    const videos = await rect(page, '#view-videos');
    assert.ok(videos.left >= nav.right - 0.5 && videos.bottom === 900, 'player next to the side bar, full height');
    const activeIndex = () => page.evaluate(() => [...document.querySelectorAll('#videos-list > .reel')].indexOf(document.querySelector('.reel.active')));
    assert.equal(await activeIndex(), 0);
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => document.querySelector('#videos-list > .reel:nth-child(2)').classList.contains('active'));
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => document.querySelector('#videos-list > .reel:nth-child(3)').classList.contains('active'));
    await page.keyboard.press('ArrowUp');
    await page.waitForFunction(() => document.querySelector('#videos-list > .reel:nth-child(2)').classList.contains('active'));
    await page.click('#reel-next');
    await page.waitForFunction(() => document.querySelector('#videos-list > .reel:nth-child(3)').classList.contains('active'));
    await page.click('.tab[data-view=actus]');
    assert.ok(await page.evaluate(() => !document.body.classList.contains('videos-mode')), 'side bar leaves Vidéos');
  });
});

test('browser: phone layout unchanged (iPhone 13)', { skip, timeout: 90_000 }, async () => {
  await withApp({ ...playwright?.devices['iPhone 13'] }, async (page) => {
    const vw = await page.evaluate(() => innerWidth);
    const vh = await page.evaluate(() => innerHeight);
    const nav = await rect(page, '.tabbar');
    assert.ok(nav.left === 0 && Math.round(nav.width) === vw && Math.round(nav.bottom) === vh, 'tab bar along the bottom');
    for (const sel of ['.side-brand', '.side-link', '#sidecol', '.reel-nav']) assert.equal(await rect(page, sel), null, `${sel} hidden`);
    assert.ok(await rect(page, '#settings-btn'), 'Paramètres in the top bar');
  });
});
