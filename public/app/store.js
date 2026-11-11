// Application state, persisted preferences, follows and "seen" tracking.

import { emptyPrefs } from '../rank.js';
import { createSeenTracker, pruneOpened } from '../seen.js';
import { addSaved, removeSaved, isSaved, sanitizeSaved } from '../saved.js';
import { actions } from './actions.js';

// ---------- Storage (never throws) ----------
export const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode etc. */ }
  },
};

export const FEED_KEYS = ['actus', 'tech'];
export const isFeed = (view) => FEED_KEYS.includes(view);

function loadFollows() {
  const f = store.get('follows', {});
  return { followed: new Set(f.followed || []), unfollowed: new Set(f.unfollowed || []), live: f.live || {} };
}

export const state = {
  view: 'actus',
  data: { actus: null, tech: null, videos: null, status: null, accounts: null, topics: null },
  // Follows, stored on the phone. `live` = Bluesky accounts followed from search,
  // fetched directly by the app since the collector doesn't know them.
  follows: loadFollows(),
  accounts: new Map(),
  live: { actus: [], tech: [], videos: [] },
  prefs: Object.assign(emptyPrefs(), store.get('prefs', {})),
  hidden: new Set(store.get('hidden', [])),
  // Timestamp of the previous visit: newer posts get a boost.
  lastVisit: store.get('lastVisit', 0),
  // Text feeds (same rendering): Actus and Tech.
  feeds: {
    actus: { ranked: [], rendered: 0, dirty: false, scroll: 0 },
    tech: { ranked: [], rendered: 0, dirty: false, scroll: 0 },
  },
  reels: { ranked: [], rendered: 0, active: null, built: false },
  muted: true,
  // Bookmarks (« Enregistrés »): full items, most recent first.
  saved: sanitizeSaved(store.get('saved', [])),
  // Articles opened in this browser (id → timestamp): their title is dimmed.
  opened: pruneOpened(store.get('opened', {})),
};

export const isSavedItem = (id) => isSaved(state.saved, id);
/** Adds / removes a bookmark. Returns false when the browser refused to store it. */
export function setSaved(item, on) {
  state.saved = on ? addSaved(state.saved, item) : removeSaved(state.saved, item.id);
  try { localStorage.setItem('saved', JSON.stringify(state.saved)); return true; } catch { return false; }
}

export const isOpened = (id) => id in state.opened;
export function markOpened(id) {
  if (!id || isOpened(id)) return;
  state.opened[id] = Date.now();
  state.opened = pruneOpened(state.opened);
  store.set('opened', state.opened);
}

export function saveFollows() {
  const f = state.follows;
  store.set('follows', { followed: [...f.followed], unfollowed: [...f.unfollowed], live: f.live });
}

export function savePrefs() {
  store.set('prefs', state.prefs);
  store.set('hidden', [...state.hidden].slice(-800));
}

// strict: an account missing from the directory (e.g. a Bluesky search result)
// is not followed unless explicitly followed. Feed items keep the lenient default.
export function isFollowed(source, { strict = false } = {}) {
  if (!source) return true;
  const f = state.follows;
  if (f.followed.has(source.id)) return true;
  if (f.unfollowed.has(source.id)) return false;
  if (strict && !state.accounts.has(source.id) && source.suggested === undefined) return false;
  const suggested = source.suggested ?? state.accounts.get(source.id)?.suggested;
  return !suggested;
}
export const itemVisible = (item) => item.tag || isFollowed(item.source);

/** Entries of a feed (collected + live), restricted to followed accounts (groups are rebuilt). */
export function entriesFor(key) {
  const base = state.data[key]?.entries || [];
  const extra = state.live[key] || [];
  const out = [];
  for (const e of [...base, ...extra]) {
    if (e.kind !== 'group') { if (itemVisible(e)) out.push(e); continue; }
    const items = e.items.filter(itemVisible);
    if (items.length > 1) out.push({ ...e, items });
    else if (items.length === 1) out.push(items[0]);
  }
  return out;
}

export function accountFromSource(src) {
  return state.accounts.get(src.id) || {
    id: src.id, name: src.name, avatar: src.avatar, handle: src.handle ? '@' + src.handle : '', url: src.url,
    kind: src.id.startsWith('bsky:') ? 'bluesky' : 'media', suggested: src.suggested,
  };
}

// ---------- Seen ----------
// id -> [last display timestamp, number of sessions it was displayed in].
export const seenTracker = createSeenTracker({ load: () => store.get('seen2', {}), save: (v) => store.set('seen2', v) });
export const markSeen = seenTracker.mark;

export function rankOpts(dataset) {
  return {
    now: Date.now(),
    halfLife: dataset?.halfLifeHours ?? 10,
    cap: dataset?.scoreCap ?? 6,
    prefs: state.prefs,
    random: Math.random, // new order on every refresh, like a "pour toi" timeline
    seen: seenTracker.counts(),
    lastVisit: state.lastVisit,
  };
}

/** Persist the visit time and pending impressions when the page is hidden / closed. */
export function initStore() {
  // A new session starts when the app comes back after 10 minutes in the background.
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); store.set('lastVisit', Date.now()); seenTracker.flush(); }
    else if (hiddenAt && Date.now() - hiddenAt > 10 * 60e3) {
      state.lastVisit = hiddenAt;
      seenTracker.newSession();
      actions.afterLongAbsence(); // re-check the data in the background
    }
  });
  window.addEventListener('pagehide', () => { store.set('lastVisit', Date.now()); seenTracker.flush(); });
}
