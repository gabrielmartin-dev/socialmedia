// « Plus de ça » / « Moins de ça » take effect at once: everything the user has not reached yet
// (cards below the screen, videos after the one playing, and the rest of the list) is ranked
// again with the new preferences. What is on screen does not move.

import { rank, pushBack } from '../rank.js';
import { state, isFeed, rankOpts, FEED_KEYS, savePrefs } from './store.js';
import { reorderFeedTail } from './feed.js';
import { reorderUpcoming } from './reels.js';

/** After « Moins de [source] », none of its posts in the next screens: not before this position. */
export const LESS_SOURCE_GAP = 12;

/** True when `entry` (a group: any of its articles) comes from `sourceId`, hashtag videos included. */
const fromSource = (sourceId) => (e) => (e.kind === 'group' ? e.items.some((i) => i.source?.id === sourceId) : e.source?.id === sourceId);

/**
 * Re-ranks the part of the displayed feed / reels the user has not reached yet.
 * `lessSource`: id of a source just reduced, pushed back beyond the next screens.
 */
export function retune({ lessSource = null } = {}) {
  const view = state.view;
  const reorder = (dataset) => (upcoming) => {
    const ranked = rank(upcoming, rankOpts(dataset), state.hidden);
    return lessSource ? pushBack(ranked, fromSource(lessSource), LESS_SOURCE_GAP) : ranked;
  };
  if (isFeed(view) && state.data[view]) reorderFeedTail(view, reorder(state.data[view]));
  else if (view === 'videos' && state.reels.built && state.data.videos) reorderUpcoming(reorder(state.data.videos));
}

/**
 * Preferences changed (⋯ menu, 👍 / 👎): saved, what the user has not reached yet on this screen
 * is ranked again right away; the other screens are rebuilt when shown.
 */
export function prefsChanged(opts) {
  savePrefs();
  FEED_KEYS.forEach((k) => { if (k !== state.view) state.feeds[k].dirty = true; });
  if (state.view !== 'videos') state.reels.built = false;
  retune(opts);
}
