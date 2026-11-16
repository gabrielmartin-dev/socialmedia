// Controls of a Bluesky (HLS) reel: tap = pause / play with a brief icon, double-tap on the
// left / right half = back / forward 10 s, progress bar that can be dragged to move in the
// video (with the time shown while dragging), ← → keys. YouTube and TikTok reels keep their
// own embedded player.

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

/** Position along the progress bar, from 0 to 1. */
export const ratioAt = (x, left, width) => (!width ? 0 : Math.min(1, Math.max(0, (x - left) / width)));

/** 75 → "1:15", 3725 → "1:02:05". */
export function formatTime(seconds) {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

/** Adds the controls to `slide` around `video`. Returns the elements to remove when the reel is deactivated. */
export function attachControls(slide, video) {
  const fill = h('div', { class: 'reel-progress-fill' });
  const time = h('div', { class: 'reel-time', 'aria-hidden': 'true' });
  const bar = h('div', { class: 'reel-progress', 'aria-hidden': 'true' }, h('div', { class: 'reel-progress-track' }, fill));
  const flash = h('div', { class: 'reel-flash', 'aria-hidden': 'true' });
  slide.append(bar, time, flash);

  const showFlash = (text, side = 0) => {
    flash.textContent = text;
    flash.className = 'reel-flash';
    void flash.offsetWidth; // restart the CSS animation
    flash.className = `reel-flash show${side ? (side < 0 ? ' left' : ' right') : ''}`;
  };

  // Progress: smooth (one update per frame) while playing.
  let dragging = false;
  const render = (ratio) => { fill.style.transform = `scaleX(${Math.min(1, Math.max(0, ratio))})`; };
  const update = () => { if (!dragging) render(video.duration > 0 ? video.currentTime / video.duration : 0); };
  let raf = 0;
  const tick = () => {
    update();
    raf = !video.paused && video.isConnected ? requestAnimationFrame(tick) : 0;
  };
  video.addEventListener('timeupdate', update);
  video.addEventListener('playing', () => { if (!raf) raf = requestAnimationFrame(tick); });

  // Dragging the bar: the time follows the finger, the video jumps there when released.
  let target = null;
  const follow = (e) => {
    const ratio = ratioAt(e.clientX, bar.getBoundingClientRect().left, bar.clientWidth);
    target = ratio * video.duration;
    render(ratio);
    time.textContent = `${formatTime(target)} / ${formatTime(video.duration)}`;
  };
  bar.addEventListener('pointerdown', (e) => {
    if (!(video.duration > 0) || !Number.isFinite(video.duration)) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    bar.setPointerCapture?.(e.pointerId);
    bar.classList.add('dragging');
    slide.classList.add('scrubbing');
    follow(e);
  });
  bar.addEventListener('pointermove', (e) => { if (dragging) follow(e); });
  const release = (apply) => {
    if (!dragging) return;
    dragging = false;
    bar.classList.remove('dragging');
    slide.classList.remove('scrubbing');
    if (apply && target != null) video.currentTime = seekTarget(target, 0, video.duration);
    target = null;
    update();
  };
  bar.addEventListener('pointerup', () => release(true));
  bar.addEventListener('pointercancel', () => release(false));
  bar.addEventListener('click', (e) => e.stopPropagation()); // never a pause / play

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
  return [bar, time, flash];
}
