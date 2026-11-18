// Bars that get out of the way (like X): scrolling down slides the top bar (with the topic
// chips) up and the tab bar down; the slightest scroll up brings them back.

import { state } from './store.js';
import { isWide } from './util.js';

const DOWN = 24; // px scrolled down before hiding (avoids flicker on small jitters)
const UP = 6;    // px scrolled up before showing again
const TOP = 90;  // always shown near the top of the page

let lastY = 0;
let run = 0;     // distance travelled in the current direction (signed)
let ticking = false;

/** Vidéos never hides its bars: the tab bar is the only way out of that screen. Neither does
 *  the desktop layout: its side bar and header never get in the way of the column. */
const keepBars = () => state.view === 'videos' || document.body.classList.contains('videos-mode') || isWide();

/** Shows (or hides) the bars. */
export function setBarsHidden(hidden) {
  document.body.classList.toggle('bars-hidden', hidden && !keepBars());
}

/** Shows the bars and restarts the tracking from the current position (view change, jump). */
export function showBars() {
  lastY = window.scrollY;
  run = 0;
  setBarsHidden(false);
}

function update() {
  ticking = false;
  const y = window.scrollY;
  const dy = y - lastY;
  lastY = y;
  const body = document.body;
  if (keepBars() || body.classList.contains('no-scroll')) { run = 0; setBarsHidden(false); return; }
  // iOS rubber band past the end of the page: ignore the bounce.
  const max = document.documentElement.scrollHeight - window.innerHeight;
  if (y > max + 1) return;
  if (y < TOP) { run = 0; setBarsHidden(false); return; }
  // A jump (restored position, scroll to an element): not a gesture.
  if (Math.abs(dy) > 400) { run = 0; return; }
  if (!dy) return;
  run = (Math.sign(dy) === Math.sign(run) ? run : 0) + dy;
  if (run > DOWN) setBarsHidden(true);
  else if (run < -UP) setBarsHidden(false);
}

export function initBars() {
  lastY = window.scrollY;
  window.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }, { passive: true });
  // The search field needs its bar: keep things in place while typing.
  document.addEventListener('focusin', (e) => { if (e.target.matches?.('input, textarea')) showBars(); });
  // Back in Vidéos after anything that can leave the page in an odd state (app in the
  // background, the iPhone's own video player, full screen): bars shown, page at the top.
  const settle = () => {
    if (!keepBars()) return;
    setBarsHidden(false);
    if (window.scrollY) window.scrollTo({ top: 0 });
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) settle(); });
  window.addEventListener('pageshow', settle);
  document.addEventListener('fullscreenchange', settle);
  document.addEventListener('webkitendfullscreen', settle, true); // doesn't bubble: capture
}
