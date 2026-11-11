// Takes cards off the screen that is displayed (feed, Vidéos, profile page, saved list) and
// gives back a function that puts them where they were: the basis of every « Annuler ».

import { $ } from './dom.js';
import { renderEntry } from './cards.js';
import { state, isFeed, FEED_KEYS } from './store.js';
import { makeCard, renderFooter } from './feed.js';
import { removeReel, restoreReel } from './reels.js';

const cardsIn = (root, id) => [...root.querySelectorAll(`.tweet[data-id="${CSS.escape(id)}"]`)];

/** Other screens are rebuilt (with the current preferences) the next time they are shown. */
function markOthersStale(view) {
  FEED_KEYS.filter((k) => k !== view).forEach((k) => { state.feeds[k].dirty = true; });
  if (view !== 'videos') state.reels.built = false;
}

/** Entries of the displayed feed / reels that come from an account. */
export function entriesOfSource(sourceId) {
  if (isFeed(state.view)) return state.feeds[state.view].ranked.filter((e) => e.kind !== 'group' && e.source.id === sourceId);
  if (state.view === 'videos') return state.reels.ranked.filter((e) => e.source.id === sourceId);
  return [];
}

export function takeOff(entries) {
  const view = state.view;
  const records = [];
  if (isFeed(view)) {
    const feed = state.feeds[view];
    const list = $(`#${view}-list`);
    for (const entry of entries) {
      const idx = feed.ranked.findIndex((e) => e.id === entry.id);
      if (idx < 0) continue;
      feed.ranked.splice(idx, 1);
      const card = cardsIn(list, entry.id)[0];
      if (card) {
        feed.rendered = Math.max(0, feed.rendered - 1);
        card.classList.add('removing');
        setTimeout(() => card.remove(), 250);
      }
      records.push({ entry, idx, shown: !!card });
    }
    renderFooter(view);
  } else if (view === 'videos') {
    for (const entry of entries) {
      const r = removeReel(entry.id);
      if (r) records.push(r);
    }
  } else {
    // Profile page or saved list: the cards live in plain lists.
    for (const entry of entries) {
      for (const card of cardsIn(document.querySelector(`#view-${view}`) || document, entry.id)) {
        records.push({ entry, parent: card.parentNode, next: card.nextElementSibling });
        card.classList.add('removing');
        setTimeout(() => card.remove(), 250);
      }
    }
  }
  markOthersStale(view);

  return function restore() {
    markOthersStale(view);
    if (isFeed(view)) {
      const feed = state.feeds[view];
      const list = $(`#${view}-list`);
      for (const r of [...records].sort((a, b) => a.idx - b.idx)) {
        feed.ranked.splice(Math.min(r.idx, feed.ranked.length), 0, r.entry);
        if (r.shown) {
          feed.rendered++;
          list.insertBefore(makeCard(r.entry), list.children[r.idx] || null);
        }
      }
      renderFooter(view);
    } else if (view === 'videos') {
      [...records].sort((a, b) => a.index - b.index).forEach(restoreReel);
    } else {
      for (const r of records) {
        if (!r.parent?.isConnected) continue;
        const next = r.next?.isConnected && !r.next.classList.contains('removing') ? r.next : null;
        r.parent.insertBefore(renderEntry(r.entry), next);
      }
    }
  };
}
