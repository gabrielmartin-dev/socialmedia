// DOM helpers: element builder, icons, toast, safe window.open.

import { safeUrl } from '../url.js';

export const $ = (sel) => document.querySelector(sel);

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    // Style via CSSOM (allowed by the CSP, unlike a style attribute).
    else if (k === 'style') el.style.cssText = v;
    // Every link / source coming from the data goes through the http(s) filter.
    else if (k === 'href' || k === 'src') { const u = safeUrl(v, location.href); if (u) el.setAttribute(k, u); }
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function svg(path, size = 18) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('fill', 'currentColor');
  p.setAttribute('d', path);
  s.append(p);
  return s;
}

export const ICONS = {
  more: 'M6 10.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z',
  muted: 'M3 9h4l5-4v14l-5-4H3V9Zm13.6.2L18 10.6l1.4-1.4 1.4 1.4-1.4 1.4 1.4 1.4-1.4 1.4-1.4-1.4-1.4 1.4-1.4-1.4 1.4-1.4-1.4-1.4 1.4-1.4Z',
  sound: 'M3 9h4l5-4v14l-5-4H3V9Zm13.5-2.5a7 7 0 0 1 0 11l-1.4-1.4a5 5 0 0 0 0-8.2l1.4-1.4Zm-2.8 2.8a3 3 0 0 1 0 5.4l-1.4-1.4a1 1 0 0 0 0-2.6l1.4-1.4Z',
  open: 'M14 3h7v7h-2V6.41l-8.29 8.3-1.42-1.42 8.3-8.29H14V3ZM5 5h6v2H5v12h12v-6h2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z',
  back: 'M7.41 13H20v-2H7.41l5.3-5.29-1.42-1.42L3.59 12l7.7 7.71 1.42-1.42L7.41 13Z',
};

/** window.open for http(s) links only. */
export const openUrl = (url) => {
  const u = safeUrl(url, location.href);
  if (u) window.open(u, '_blank', 'noopener');
};

/** Smooth scrolling unless the user asked for reduced motion. */
export const scrollBehavior = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}
