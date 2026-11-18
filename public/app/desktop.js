// Desktop layout (see the « Desktop » section of styles.css): links of the side bar,
// right column (search, suggestions) and keyboard navigation in Vidéos.

import { $ } from './dom.js';
import { state } from './store.js';
import { actions } from './actions.js';
import { renderDiscover, showDiscoverTab, sideSuggestions } from './discover.js';
import { isWide, WIDE_QUERY } from './util.js';

/** Moves to the previous (-1) or next (+1) video; the reels activate themselves on scroll. */
export function stepReel(dir) {
  const list = $('#videos-list');
  const slides = [...list.children];
  const current = state.reels.active && slides.includes(state.reels.active)
    ? slides.indexOf(state.reels.active)
    : Math.round(list.scrollTop / (list.clientHeight || 1));
  const target = slides[Math.min(Math.max(current + dir, 0), slides.length - 1)];
  if (target) list.scrollTo({ top: target.offsetTop, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

const typing = (el) => el?.closest?.('input, textarea, select, [contenteditable="true"]');

function onKey(e) {
  if (state.view !== 'videos' || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
  if (typing(e.target) || document.body.classList.contains('no-scroll') || document.querySelector('.sheet:not([hidden])')) return;
  const slide = state.reels.active;
  const video = slide?.querySelector('video:not(.reel-pre)');
  switch (e.key) {
    case 'ArrowDown': case 'PageDown': case 'j':
      e.preventDefault(); stepReel(1); break;
    case 'ArrowUp': case 'PageUp': case 'k':
      e.preventDefault(); stepReel(-1); break;
    case 'ArrowLeft': case 'ArrowRight':
      // Same seek as on the focused video (reelcontrols.js), from anywhere on the page.
      if (video && e.target !== video) { e.preventDefault(); video.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, cancelable: true })); }
      break;
    case ' ':
      if (e.target.closest?.('button, a')) return; // Space activates the focused button
      if (video) { e.preventDefault(); if (video.paused) video.play().catch(() => {}); else video.pause(); }
      break;
    case 'm': case 'M':
      slide?.querySelector('.mute')?.click(); break;
  }
}

export function renderSide() {
  if (!isWide()) return;
  const rows = sideSuggestions(4);
  $('#side-suggest').hidden = !rows.length;
  $('#side-suggest-list').replaceChildren(...rows);
}

export function initDesktop() {
  document.addEventListener('keydown', onKey);
  $('#reel-prev').addEventListener('click', () => stepReel(-1));
  $('#reel-next').addEventListener('click', () => stepReel(1));

  for (const link of document.querySelectorAll('.side-link')) {
    link.addEventListener('click', () => $(link.dataset.action === 'saved' ? '#saved-btn' : '#settings-btn').click());
  }

  // Right column search: opens Découvrir with the query.
  $('#side-search').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('#side-search-input').value.trim();
    if (!q) return;
    const field = $('#discover-search');
    field.value = q;
    $('#side-search-input').value = '';
    actions.switchView('discover');
    field.dispatchEvent(new Event('input'));
  });
  $('#side-suggest-more').addEventListener('click', () => {
    showDiscoverTab('suggestions');
    actions.switchView('discover');
    if (state.view === 'discover') renderDiscover();
  });

  matchMedia(WIDE_QUERY).addEventListener?.('change', renderSide);
}
