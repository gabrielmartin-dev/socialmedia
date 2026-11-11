// Bottom sheet ("moins de ça", follow / unfollow, open the original).

import { applyLess } from '../rank.js';
import { safeUrl } from '../url.js';
import { $, toast } from './dom.js';
import { state, isFollowed, isFeed, FEED_KEYS, savePrefs, accountFromSource } from './store.js';
import { trapFocus } from './focus.js';
import { setFollow } from './follow.js';
import { renderFooter } from './feed.js';
import { removeReel } from './reels.js';

let sheetEntry = null;
let releaseFocus = null;

export function openSheet(entry) {
  sheetEntry = entry;
  const isGroup = entry.kind === 'group';
  $('#sheet-less-sub').textContent = isGroup
    ? 'Moins de sujets similaires'
    : `Moins de ${entry.source.name} et de sujets similaires`;
  const followBtn = $('#sheet-follow');
  followBtn.hidden = isGroup;
  if (!isGroup) {
    const following = isFollowed(entry.source);
    followBtn.querySelector('strong').textContent = following ? `Ne plus suivre ${entry.source.name}` : `Suivre ${entry.source.name}`;
  }
  const link = $('#sheet-open');
  const openHref = isGroup ? null : safeUrl(entry.url, location.href);
  link.hidden = !openHref;
  if (openHref) link.href = openHref; else link.removeAttribute('href');
  $('#sheet').hidden = false;
  $('#sheet-backdrop').hidden = false;
  releaseFocus?.();
  // Focus goes into the sheet, Tab stays inside, Escape closes, focus returns to the ⋯ button.
  releaseFocus = trapFocus($('#sheet'), { onClose: closeSheet, keep: [$('#sheet-backdrop'), $('#toast')] });
}

export function closeSheet() {
  const release = releaseFocus;
  releaseFocus = null;
  $('#sheet').hidden = true;
  $('#sheet-backdrop').hidden = true;
  sheetEntry = null;
  release?.(); // after hiding: restoring focus on the opener must not be blocked by inert
}

export function initSheet() {
  $('#sheet-backdrop').addEventListener('click', closeSheet);
  $('#sheet-cancel').addEventListener('click', closeSheet);
  $('#sheet-open').addEventListener('click', closeSheet);
  $('#sheet-follow').addEventListener('click', () => {
    const entry = sheetEntry;
    closeSheet();
    if (!entry?.source) return;
    const following = isFollowed(entry.source);
    setFollow(accountFromSource(entry.source), !following);
    if (following && isFeed(state.view)) {
      // Remove that account's cards right away.
      const key = state.view;
      const feed = state.feeds[key];
      const gone = new Set(feed.ranked.filter((e) => e.kind !== 'group' && e.source.id === entry.source.id).map((e) => e.id));
      feed.ranked = feed.ranked.filter((e) => !gone.has(e.id));
      document.querySelectorAll(`#${key}-list .tweet`).forEach((card) => {
        if (gone.has(card.dataset.id)) { card.classList.add('removing'); setTimeout(() => card.remove(), 250); feed.rendered--; }
      });
    } else if (following && state.view === 'videos') {
      [...state.reels.ranked].filter((i) => i.source.id === entry.source.id).forEach((i) => removeReel(i.id));
    }
  });
  $('#sheet-less').addEventListener('click', () => {
    const entry = sheetEntry;
    closeSheet();
    if (!entry) return;
    applyLess(state.prefs, entry);
    state.hidden.add(entry.id);
    savePrefs();
    toast('Compris, tu en verras moins.');
    if (isFeed(state.view)) {
      const key = state.view;
      const feed = state.feeds[key];
      const card = document.querySelector(`#${key}-list .tweet[data-id="${CSS.escape(entry.id)}"]`);
      feed.ranked = feed.ranked.filter((e) => e.id !== entry.id);
      feed.rendered = Math.max(0, feed.rendered - 1);
      if (card) { card.classList.add('removing'); setTimeout(() => card.remove(), 250); }
      renderFooter(key);
      FEED_KEYS.filter((k) => k !== key).forEach((k) => { state.feeds[k].dirty = true; });
      state.reels.built = false;
    } else {
      removeReel(entry.id);
      FEED_KEYS.forEach((k) => { state.feeds[k].dirty = true; });
    }
  });
}
