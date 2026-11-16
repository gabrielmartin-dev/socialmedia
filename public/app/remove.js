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

/**
 * What has to leave the displayed feed / reels so that no item matching `pred` stays on screen.
 * A plain card is taken off; a grouped card (« N médias en parlent ») keeps its other articles:
 * it is replaced by the smaller group, or by the single article left. Returns { entries, replacements }
 * for takeOff (replacements: id of the group → what replaces it).
 */
export function trimItems(ranked, pred) {
  const entries = [];
  const replacements = new Map();
  for (const e of ranked) {
    if (e.kind !== 'group') { if (pred(e)) entries.push(e); continue; }
    const kept = e.items.filter((i) => !pred(i));
    if (kept.length === e.items.length) continue;
    entries.push(e);
    if (kept.length) replacements.set(e.id, kept.length > 1 ? { ...e, items: kept } : kept[0]);
  }
  return { entries, replacements };
}

function displayed() {
  if (isFeed(state.view)) return state.feeds[state.view].ranked;
  if (state.view === 'videos') return state.reels.ranked;
  return [];
}

/** Items of the displayed feed / reels that match `pred`, ready for takeOff. */
export const itemsMatching = (pred) => trimItems(displayed(), pred);

/**
 * Posts of an account on screen (grouped articles included). Hashtag videos stay: they are
 * shown whoever posted them, so taking them off would only last until the next refresh.
 */
export const entriesOfSource = (sourceId) => itemsMatching((i) => !i.tag && i.source?.id === sourceId);

/**
 * `entries`: an array of entries, or { entries, replacements } (see trimItems): an entry that has
 * a replacement is swapped for it in place instead of being taken off (feeds only).
 */
export function takeOff(what) {
  const { entries, replacements = new Map() } = Array.isArray(what) ? { entries: what } : what;
  const view = state.view;
  const records = [];
  const swaps = [];
  if (isFeed(view)) {
    const feed = state.feeds[view];
    const list = $(`#${view}-list`);
    for (const entry of entries) {
      const idx = feed.ranked.findIndex((e) => e.id === entry.id);
      if (idx < 0) continue;
      const replacement = replacements.get(entry.id);
      if (replacement) {
        feed.ranked[idx] = replacement;
        const card = cardsIn(list, entry.id)[0];
        const next = card ? makeCard(replacement) : null;
        card?.replaceWith(next);
        swaps.push({ entry, replacement, card: next });
        continue;
      }
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
      for (const s of swaps) {
        const idx = feed.ranked.indexOf(s.replacement);
        if (idx >= 0) feed.ranked[idx] = s.entry;
        if (s.card?.isConnected) s.card.replaceWith(makeCard(s.entry));
      }
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
