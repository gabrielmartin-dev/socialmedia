// Image viewer (fullscreen, swipe between images, swipe up/down or back gesture closes).

import { h, svg, ICONS, scrollBehavior } from './dom.js';
import { trapFocus } from './focus.js';

export const viewer = { el: null, open: false, release: null, popPending: false };

let lastPop = { event: null, result: false };
/**
 * Called first by every popstate handler. True when this "back" belongs to the viewer (the
 * gesture that closes it, or the history entry popped by the × button): the page behind must
 * not react. The answer is computed once per event, so the handlers can run in any order.
 */
export function viewerPop(event) {
  if (lastPop.event === event) return lastPop.result;
  let result = false;
  if (viewer.open) { closeViewer(false); result = true; }
  else if (viewer.popPending) { viewer.popPending = false; result = true; }
  lastPop = { event, result };
  return result;
}

export function openViewer(gallery, index = 0, url = null) {
  closeViewer(false);
  const track = h('div', { class: 'viewer-track' }, gallery.map((g) =>
    h('div', { class: 'viewer-slide', onclick: (e) => { if (e.target === e.currentTarget) closeViewer(); } },
      h('img', { src: g.src, alt: g.alt || '', referrerpolicy: 'no-referrer' }))));
  const counter = gallery.length > 1 ? h('div', { class: 'viewer-count' }) : null;
  const caption = h('div', { class: 'viewer-alt' });
  const update = () => {
    const i = Math.round(track.scrollLeft / Math.max(track.clientWidth, 1));
    if (counter) counter.textContent = `${i + 1} / ${gallery.length}`;
    caption.textContent = gallery[i]?.alt || '';
    caption.hidden = !gallery[i]?.alt;
  };
  track.addEventListener('scroll', update, { passive: true });
  // The track scrolls horizontally: make it keyboard-operable (←/→ change image).
  track.tabIndex = 0;
  track.setAttribute('role', 'group');
  track.setAttribute('aria-label', 'Images');
  track.addEventListener('keydown', (e) => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (dir) { e.preventDefault(); track.scrollBy({ left: dir * track.clientWidth, behavior: scrollBehavior() }); }
  });
  const bar = h('div', { class: 'viewer-bar' },
    h('button', { class: 'viewer-btn', 'aria-label': 'Fermer', text: '✕', onclick: () => closeViewer() }),
    counter,
    url ? h('a', { class: 'viewer-btn', href: url, target: '_blank', rel: 'noopener', 'aria-label': 'Ouvrir la source' }, svg(ICONS.open, 20)) : h('span'),
  );
  viewer.el = h('div', { class: 'viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': "Visionneuse d'images" },
    track,
    bar,
    caption,
  );
  swipeToClose(viewer.el, track, [bar, caption]);
  document.body.append(viewer.el);
  document.body.classList.add('no-scroll');
  viewer.open = true;
  viewer.release = trapFocus(viewer.el, { onClose: () => closeViewer() });
  history.pushState({ viewer: true }, '');
  requestAnimationFrame(() => { track.scrollLeft = index * track.clientWidth; update(); });
}

/** Close the viewer. `viaHistory` pops the entry pushed on open (× button, tap outside). */
export function closeViewer(viaHistory = true) {
  if (!viewer.open) return;
  viewer.open = false;
  viewer.release?.(); // inert off, focus back on the image that opened the viewer
  viewer.release = null;
  viewer.el.remove();
  viewer.el = null;
  document.body.classList.remove('no-scroll');
  if (viaHistory && history.state?.viewer) { viewer.popPending = true; history.back(); }
}

// ---- Swipe up or down to close, like on X ----
// The image follows the finger and the black background fades out; past a distance (or with a
// quick flick) the viewer closes, otherwise the image springs back. Horizontal swipes stay with
// the native scroll of the track (gallery), and pinch-zoom is left alone.

const DIST = 110; // px: release past this distance closes
const FLICK = 0.5; // px/ms: a quick flick closes even if short
const LOCK = 10; // px of movement before deciding between vertical drag and horizontal scroll

/** True when a vertical drag released at `dy` px with `speed` px/ms should close the viewer. */
export function shouldDismiss(dy, speed) {
  return Math.abs(dy) > DIST || (Math.abs(dy) > 30 && Math.abs(speed) > FLICK && Math.sign(speed) === Math.sign(dy));
}

function swipeToClose(root, track, chrome) {
  let drag = null; // { id, x, y, dy, vertical, t, v }
  let suppressClick = false;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const zoomed = () => (window.visualViewport?.scale || 1) > 1.01;

  const paint = (dy, animate) => {
    const ms = animate && !reduced() ? 200 : 0;
    const ratio = Math.min(Math.abs(dy) / (root.clientHeight * 0.5 || 1), 1);
    track.style.transition = ms ? `transform ${ms}ms ease-out` : '';
    root.style.transition = ms ? `background-color ${ms}ms ease-out` : '';
    track.style.transform = dy ? `translateY(${dy}px) scale(${1 - ratio * 0.12})` : '';
    root.style.backgroundColor = dy ? `rgba(0,0,0,${1 - ratio * 0.85})` : '';
    for (const el of chrome) {
      el.style.transition = ms ? `opacity ${ms}ms ease-out` : '';
      el.style.opacity = dy ? String(Math.max(0, 1 - ratio * 3)) : '';
    }
  };

  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!d.vertical) return;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 400);
    if (e.type !== 'pointercancel' && shouldDismiss(d.dy, d.v)) {
      const el = root;
      paint(Math.sign(d.dy || 1) * root.clientHeight, true);
      root.style.backgroundColor = 'rgba(0,0,0,0)';
      setTimeout(() => { if (viewer.el === el) closeViewer(); }, reduced() ? 0 : 200);
    } else paint(0, true);
  };

  track.addEventListener('pointerdown', (e) => {
    // Touch and pen only: a mouse drag would turn every click into a gesture.
    if (e.pointerType === 'mouse' || !e.isPrimary || zoomed()) { drag = null; return; }
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, dy: 0, vertical: false, t: e.timeStamp, v: 0 };
  });
  track.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.vertical) {
      if (Math.abs(dx) < LOCK && Math.abs(dy) < LOCK) return;
      // Mostly horizontal: let the gallery scroll and forget this pointer.
      if (Math.abs(dy) < Math.abs(dx) * 1.2 || zoomed()) { drag = null; return; }
      drag.vertical = true;
      try { track.setPointerCapture(e.pointerId); } catch {}
    }
    const dt = Math.max(e.timeStamp - drag.t, 1);
    drag.v = 0.8 * ((dy - drag.dy) / dt) + 0.2 * drag.v; // smoothed speed
    drag.t = e.timeStamp;
    drag.dy = dy;
    paint(dy, false);
  });
  track.addEventListener('pointerup', end);
  track.addEventListener('pointercancel', end);
  // A second finger (pinch) cancels the drag.
  track.addEventListener('touchstart', (e) => { if (e.touches.length > 1 && drag) { if (drag.vertical) paint(0, true); drag = null; } }, { passive: true });
  // The tap that ends a drag must not count as "tap outside the image".
  track.addEventListener('click', (e) => { if (suppressClick) { e.stopPropagation(); suppressClick = false; } }, true);
}
