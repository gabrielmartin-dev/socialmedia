// Image viewer (fullscreen, swipe between images, back gesture closes).

import { h, svg, ICONS } from './dom.js';

export const viewer = { el: null, open: false };

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
  viewer.el = h('div', { class: 'viewer', role: 'dialog', 'aria-modal': 'true' },
    track,
    h('div', { class: 'viewer-bar' },
      h('button', { class: 'viewer-btn', 'aria-label': 'Fermer', text: '✕', onclick: () => closeViewer() }),
      counter,
      url ? h('a', { class: 'viewer-btn', href: url, target: '_blank', rel: 'noopener', 'aria-label': 'Ouvrir la source' }, svg(ICONS.open, 20)) : h('span'),
    ),
    caption,
  );
  document.body.append(viewer.el);
  document.body.classList.add('no-scroll');
  viewer.open = true;
  history.pushState({ viewer: true }, '');
  requestAnimationFrame(() => { track.scrollLeft = index * track.clientWidth; update(); });
}

/** Close the viewer. `viaHistory` pops the entry pushed on open (× button, tap outside). */
export function closeViewer(viaHistory = true) {
  if (!viewer.open) return;
  viewer.open = false;
  viewer.el.remove();
  viewer.el = null;
  document.body.classList.remove('no-scroll');
  if (viaHistory && history.state?.viewer) history.back();
}

export function initViewer() {
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeViewer(); });
}
