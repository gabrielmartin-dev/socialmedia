// Saves what is on screen whenever the app goes to the background, and puts it back after a
// reload (new version of the app, or iOS having discarded the page): same tab, same posts in
// the same order, same scroll position. Nothing is ever reshuffled under the user's eyes.

import { orderOf, restoreOrder, usableSnapshot } from '../snapshot.js';
import { $ } from './dom.js';
import { state, store, FEED_KEYS, isFeed } from './store.js';

const KEY = 'screen';
const EXTRA = 10; // a few not-yet-rendered entries, so the next ones don't change either
let restoring = null; // snapshot being restored at launch

const cardsOf = (key) => [...$(`#${key}-list`).children].filter((el) => el.classList.contains('tweet'));

/** First card visible under the top bar, and where it is on screen. */
function anchorOf(key) {
  const top = document.querySelector('.topbar')?.getBoundingClientRect().bottom || 0;
  for (const el of cardsOf(key)) {
    const r = el.getBoundingClientRect();
    if (r.bottom > top + 1) return { id: el.dataset.id, offset: Math.round(r.top) };
  }
  return null;
}

export function saveSnapshot() {
  const feeds = {};
  for (const key of FEED_KEYS) {
    const f = state.feeds[key];
    if (!f.ranked.length) continue;
    const current = state.view === key;
    feeds[key] = {
      topic: f.topic,
      order: orderOf(f.ranked, f.rendered + EXTRA),
      scroll: current ? window.scrollY : f.scroll,
      anchor: current ? anchorOf(key) : null,
    };
  }
  store.set(KEY, { at: Date.now(), view: state.view, feeds });
}

/** Called before the first render: the topic chips that were selected. */
export function beginRestore() {
  restoring = usableSnapshot(store.get(KEY, null));
  if (!restoring) return;
  for (const key of FEED_KEYS) {
    const topic = restoring.feeds?.[key]?.topic;
    if (topic && state.data.topics?.topics?.[topic]) state.feeds[key].topic = topic;
  }
}

/** Called by renderFeed at launch: the saved order first, the rest after. */
export function restoredRanking(key, ranked) {
  const saved = restoring?.feeds?.[key]?.order;
  return saved ? restoreOrder(ranked, saved) : ranked;
}

/** How many entries renderFeed must render at once so the saved position exists. */
export const restoredCount = (key) => restoring?.feeds?.[key]?.order?.length || 0;

/** After the first render: back to the same tab and the same place. */
export function finishRestore(switchView) {
  const snap = restoring;
  restoring = null;
  if (!snap) return;
  for (const key of FEED_KEYS) state.feeds[key].scroll = snap.feeds?.[key]?.scroll || 0;
  if (snap.view && snap.view !== state.view && ['actus', 'tech', 'videos', 'discover'].includes(snap.view)) switchView(snap.view);
  if (!isFeed(state.view)) return;
  const key = state.view;
  const anchor = snap.feeds?.[key]?.anchor;
  const align = () => {
    const el = anchor && cardsOf(key).find((c) => c.dataset.id === anchor.id);
    if (el) window.scrollBy(0, el.getBoundingClientRect().top - anchor.offset);
    else window.scrollTo({ top: state.feeds[key].scroll || 0 });
  };
  align();
  // Images above the anchor load and push it down: keep it in place until the user moves.
  const list = $(`#${key}-list`);
  const ro = new ResizeObserver(align);
  ro.observe(list);
  const stop = () => {
    ro.disconnect();
    ['touchstart', 'wheel', 'keydown'].forEach((t) => window.removeEventListener(t, stop));
  };
  ['touchstart', 'wheel', 'keydown'].forEach((t) => window.addEventListener(t, stop, { passive: true, once: true }));
  setTimeout(stop, 4000);
}

export function initRestore() {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveSnapshot(); });
  window.addEventListener('pagehide', saveSnapshot);
}
