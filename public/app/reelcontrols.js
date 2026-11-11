// Controls of a Bluesky (HLS) reel: tap = pause / play with a brief icon, double-tap on the
// left / right half = back / forward 10 s, thin progress bar, ← → keys. YouTube and TikTok
// reels keep their own embedded player.

import { h } from './dom.js';
import { makeButton } from './focus.js';

export const SEEK_SECONDS = 10;
export const DOUBLE_TAP_MS = 300;

/** Seek target in seconds, clamped to the video. */
export const seekTarget = (current, delta, duration) => {
  const max = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
  return Math.min(Math.max(0, current + delta), max);
};

/** Which half of the video was tapped: -1 left, 1 right, 0 unknown (keyboard). */
export const sideOf = (x, left, width) => (x == null || !width ? 0 : x - left < width / 2 ? -1 : 1);

/** Adds the controls to `slide` around `video`. Returns the elements to remove when the reel is deactivated. */
export function attachControls(slide, video) {
  const fill = h('div', { class: 'reel-progress-fill' });
  const bar = h('div', { class: 'reel-progress', 'aria-hidden': 'true' }, fill);
  const flash = h('div', { class: 'reel-flash', 'aria-hidden': 'true' });
  slide.append(bar, flash);

  const showFlash = (text, side = 0) => {
    flash.textContent = text;
    flash.className = 'reel-flash';
    void flash.offsetWidth; // restart the CSS animation
    flash.className = `reel-flash show${side ? (side < 0 ? ' left' : ' right') : ''}`;
  };

  video.addEventListener('timeupdate', () => {
    const ratio = video.duration > 0 ? video.currentTime / video.duration : 0;
    fill.style.transform = `scaleX(${Math.min(1, Math.max(0, ratio))})`;
  });

  const toggle = () => {
    if (video.paused) { video.play().catch(() => {}); showFlash('▶'); } else { video.pause(); showFlash('❚❚'); }
  };
  const seek = (dir) => {
    video.currentTime = seekTarget(video.currentTime, dir * SEEK_SECONDS, video.duration);
    showFlash(dir < 0 ? `−${SEEK_SECONDS} s` : `+${SEEK_SECONDS} s`, dir);
  };

  let last = null; // { t, side, wasPaused }
  makeButton(video, (e) => {
    const side = sideOf(e.clientX, video.getBoundingClientRect().left, video.clientWidth);
    const now = Date.now();
    if (side && last && last.side === side && now - last.t < DOUBLE_TAP_MS) {
      // Second tap: undo the pause / play of the first one, then seek.
      if (video.paused !== last.wasPaused) { if (last.wasPaused) video.pause(); else video.play().catch(() => {}); }
      last = null;
      seek(side);
      return;
    }
    last = { t: now, side, wasPaused: video.paused };
    toggle();
  });
  video.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); seek(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); seek(1); }
  });
  video.setAttribute('aria-label', 'Lecture / pause (flèches : reculer / avancer de 10 secondes)');
  return [bar, flash];
}
