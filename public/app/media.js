// Avatars and feed images.

import { h } from './dom.js';
import { openViewer } from './viewer.js';
import { makeButton } from './focus.js';
import { safeUrl } from '../url.js';

export function avatar(src, name, { square = false, size } = {}) {
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  const fallback = () => h('div', { class: `avatar${square ? ' square' : ''}`, text: initial });
  if (!safeUrl(src, location.href)) return fallback();
  const img = h('img', { class: `avatar${square ? ' square' : ''}`, src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
  if (size) { img.width = size; img.height = size; }
  img.addEventListener('error', () => img.replaceWith(fallback()), { once: true });
  return img;
}

/** Feed image. With `zoom`, tapping it opens the in-app viewer instead of the article. */
export function image(src, alt = '', zoom = null) {
  if (!safeUrl(src, location.href)) return document.createDocumentFragment();
  const img = h('img', { src, alt, loading: 'lazy', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => (img.closest('.media, .ext-img') || img).remove(), { once: true });
  if (zoom) {
    img.classList.add('zoomable');
    img.setAttribute('aria-label', alt ? `Agrandir : ${alt}` : "Agrandir l'image");
    makeButton(img, (e) => {
      e.preventDefault(); e.stopPropagation();
      openViewer(zoom.gallery || [{ src, alt }], zoom.index || 0, zoom.url);
    });
  }
  return img;
}
