// Vidéos must always keep its tab bar on screen: it is the only way out of that screen.
// This came back several times (bars hidden on scroll #43, black band #46/#47, then a tab
// bar pushed past the bottom edge of the iPhone's viewport, neither drawn nor tappable).
//
// 1. Static checks, always run (CI included).
// 2. A browser run (Playwright, iPhone emulation, iOS viewport gap simulated) when Playwright
//    and the demo data (`npm run sample`) are available — skipped otherwise.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const css = await fs.readFile(path.join(PUBLIC, 'styles.css'), 'utf8');

/** CSS rules (selector → body) whose selector matches `re`. */
function rules(re) {
  const out = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (re.test(m[1])) out.push({ sel: m[1].trim(), body: m[2], at: m.index });
  }
  return out;
}

test('CSS: in Vidéos, nothing moves the tab bar past the bottom of the viewport', () => {
  for (const r of rules(/videos-mode[^,]*\.tabbar(?![-\w])/)) {
    assert.doesNotMatch(r.body, /bottom\s*:\s*calc\(\s*-|bottom\s*:\s*-/, `${r.sel} pushes the tab bar off screen`);
    assert.doesNotMatch(r.body, /translate|display\s*:\s*none|visibility\s*:\s*hidden/, `${r.sel} hides the tab bar`);
  }
});

test('CSS: « bars hidden on scroll » never applies in Vidéos', () => {
  const hide = rules(/bars-hidden[^,]*\.tabbar(?![-\w])/).find((r) => /translate/.test(r.body));
  const keep = rules(/videos-mode\.bars-hidden \.tabbar(?![-\w])/).find((r) => /transform\s*:\s*none/.test(r.body));
  assert.ok(keep, 'a body.videos-mode.bars-hidden .tabbar { transform: none } override is needed');
  assert.ok(!hide || keep.at > hide.at, 'the override must come after the hiding rule');
});

test('bars.js: setBarsHidden(true) does nothing in Vidéos', async () => {
  const classes = new Set();
  globalThis.document = {
    body: { classList: {
      toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
      contains: (c) => classes.has(c),
    } },
  };
  try {
    const { setBarsHidden } = await import('../public/app/bars.js');
    const { state } = await import('../public/app/store.js');
    state.view = 'actus';
    setBarsHidden(true);
    assert.ok(classes.has('bars-hidden'), 'hidden in Actus');
    state.view = 'videos';
    setBarsHidden(true);
    assert.ok(!classes.has('bars-hidden'), 'never hidden in Vidéos');
    state.view = 'actus';
    classes.add('videos-mode'); // class set but view not yet switched: still Vidéos on screen
    setBarsHidden(true);
    assert.ok(!classes.has('bars-hidden'));
  } finally {
    delete globalThis.document;
  }
});

// ---------- Browser run ----------

let playwright = null;
try { playwright = createRequire(import.meta.url)('playwright'); } catch { /* not installed */ }
const hasData = await fs.access(path.join(PUBLIC, 'data', 'videos.json')).then(() => true, () => false);

test('browser: tab bar visible and tappable in Vidéos, whatever happens', {
  skip: !playwright ? 'Playwright not installed' : !hasData ? 'no data (npm run sample)' : false,
  timeout: 90_000,
}, async () => {
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
    const GAP = 60;
    const ctx = await browser.newContext({ ...playwright.devices['iPhone 13'] });
    // Home-screen app on an iPhone hit by the iOS 26 bug: the viewport stops 60 px short of
    // the screen's bottom edge (app/viewport.js measures it as --vp-gap).
    await ctx.addInitScript((gap) => {
      try { localStorage.setItem('installGuide', '1'); } catch { /* */ }
      Object.defineProperty(navigator, 'standalone', { get: () => true });
      Object.defineProperty(screen, 'height', { get: () => innerHeight + gap });
    }, GAP);
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForSelector('#actus-list .tweet');

    const tap = (sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
    const check = async (label) => {
      await page.waitForTimeout(450); // bars transition
      const r = await page.evaluate(() => {
        const bar = document.querySelector('.tabbar').getBoundingClientRect();
        const reels = document.querySelector('#view-videos').getBoundingClientRect();
        const hit = document.elementFromPoint(innerWidth / 2, bar.top + 24)?.closest('.tab');
        return { top: bar.top, bottom: bar.bottom, ih: innerHeight, reelsBottom: reels.bottom, hit: !!hit, videos: document.body.classList.contains('videos-mode'), gap: document.documentElement.style.getPropertyValue('--vp-gap') };
      });
      assert.ok(r.videos, `${label}: still in Vidéos`);
      assert.equal(r.gap, '60px', `${label}: iOS gap simulated`);
      assert.ok(r.top >= 0 && r.bottom <= r.ih + 0.5, `${label}: tab bar inside the viewport (${r.top}–${r.bottom} / ${r.ih})`);
      assert.ok(r.hit, `${label}: tab bar tappable`);
      assert.ok(r.reelsBottom <= r.top + 0.5, `${label}: the reels stop above the tab bar`);
    };

    // Actus scrolled down: bars hidden there.
    for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, 400); await page.waitForTimeout(150); }
    assert.ok(await page.evaluate(() => document.body.classList.contains('bars-hidden')), 'bars hidden in Actus');

    await tap('.tab[data-view=videos]');
    await check('entering Vidéos');

    // Video loading (spinner).
    await page.evaluate(() => document.querySelector('.reel.active')?.classList.add('buffering'));
    await check('video loading');

    // Something tries to hide the bars (scroll of the page, leftover class).
    await page.evaluate(() => { document.body.classList.add('bars-hidden'); window.scrollTo(0, 500); window.dispatchEvent(new Event('scroll')); });
    await check('bars-hidden forced');

    // Swipe to the next videos.
    for (let i = 0; i < 2; i++) {
      await page.evaluate(() => { const l = document.querySelector('#videos-list'); l.scrollBy(0, l.clientHeight); });
      await page.waitForTimeout(300);
    }
    await check('after swipes');

    // App to the background and back; iPhone video player / full screen closed.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pageshow'));
      document.dispatchEvent(new Event('fullscreenchange'));
      document.querySelector('.reel.active video')?.dispatchEvent(new Event('webkitendfullscreen'));
    });
    await check('after resume / full screen');

    // Profile opened from a video (bars hide while scrolling it), then back.
    await tap('.reel.active .reel-author');
    await page.waitForTimeout(300);
    for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 400); await page.waitForTimeout(150); }
    await page.goBack();
    await check('back from a profile');

    // And the way out works.
    await page.mouse.click(...(await page.evaluate(() => {
      const r = document.querySelector('.tab[data-view=actus]').getBoundingClientRect();
      return [r.left + r.width / 2, r.top + 20];
    })));
    await page.waitForTimeout(300);
    assert.ok(await page.evaluate(() => !document.body.classList.contains('videos-mode') && document.querySelector('#view-actus.active')), 'tapping Actus leaves Vidéos');
  } finally {
    await browser.close();
    server.close();
  }
});
