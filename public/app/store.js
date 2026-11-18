// Application state, persisted preferences, follows and "seen" tracking.

import { emptyPrefs, topicsOf, newSince } from '../rank.js';
import { latestGeneratedAt } from '../freshness.js';
import { createSeenTracker, pruneOpened } from '../seen.js';
import { addSaved, removeSaved, isSaved, sanitizeSaved } from '../saved.js';
import { sanitizeSettings, SETTINGS_KEY } from '../settings.js';
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
  // « Masquer les articles payants »: paid articles are left out of Actus and Tech.
  hidePaid: store.get('hidePaid', false) === true,
  // Timestamp of the previous visit: newer posts get a boost.
  lastVisit: store.get('lastVisit', 0),
  lastGenerated: store.get('lastGenerated', 0), // generation date (ms) of the data on screen at the previous visit
  // Text feeds (same rendering): Actus and Tech.
  feeds: {
    // `topic`: id of the topic chip selected (null = Tout)
    actus: { ranked: [], rendered: 0, dirty: false, scroll: 0, topic: null },
    tech: { ranked: [], rendered: 0, dirty: false, scroll: 0, topic: null },
  },
  reels: { ranked: [], rendered: 0, active: null, built: false },
  // Sound of the Vidéos tab: the last choice is kept for the next videos and the next visits.
  muted: store.get('reelsMuted', true) !== false,
  // Paramètres: theme, text size, autoplay of the videos in the feeds (see ../settings.js).
  settings: sanitizeSettings(store.get(SETTINGS_KEY, null)),
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

export function setHidePaid(on) {
  state.hidePaid = !!on;
  store.set('hidePaid', state.hidePaid);
}

export function saveMuted() {
  store.set('reelsMuted', state.muted);
}

export function saveSettings() {
  store.set(SETTINGS_KEY, state.settings);
}

export function savePrefs() {
  store.set('prefs', state.prefs);
  store.set('hidden', [...state.hidden].slice(-800));
}

// strict: an account missing from the directory (e.g. a Bluesky search result, someone who
// replied in a thread, the author of a hashtag video) is not followed unless explicitly
// followed. Every button and menu that says « Suivre / Abonné » uses it; only the feed filter
// keeps the lenient default (and if the directory could not be loaded at all, strict falls
// back to it rather than offering to follow every account of the feed).
export function isFollowed(source, { strict = false } = {}) {
  if (!source) return true;
  const f = state.follows;
  if (f.followed.has(source.id)) return true;
  if (f.unfollowed.has(source.id)) return false;
  if (strict && state.accounts.size && !state.accounts.has(source.id) && source.suggested === undefined) return false;
  const suggested = source.suggested ?? state.accounts.get(source.id)?.suggested;
  return !suggested;
}
export const itemVisible = (item) => item.tag || isFollowed(item.source);

export const topicMinScore = () => state.data?.topics?.topicMinScore ?? 1;

/** True when an entry belongs to the topic chip selected in `key` (always true without a filter). */
export function inTopicFilter(key, entry) {
  const topic = state.feeds[key]?.topic;
  return !topic || topicsOf(entry, topicMinScore()).includes(topic);
}

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
  // A media outlet's Bluesky post that only relays one of its own articles (`relayOf`, set by
  // the collector) is hidden when that article is shown; kept when only the Bluesky account is followed.
  const shown = new Set(out.flatMap((e) => (e.kind === 'group' ? e.items.map((i) => i.id) : [e.id])));
  return out.filter((e) => !(e.relayOf && shown.has(e.relayOf)));
}

export function accountFromSource(src) {
  // A Bluesky account followed from search keeps its profile (bio, Tech or Actus) in `live`.
  const live = state.follows.live[src.id];
  return state.accounts.get(src.id) || (live && { id: src.id, kind: 'bluesky', ...live }) || {
    id: src.id, name: src.name, avatar: src.avatar, handle: src.handle ? '@' + src.handle : '', url: src.url,
    kind: src.id.startsWith('bsky:') ? 'bluesky' : 'media', suggested: src.suggested,
  };
}

// ---------- Seen ----------
// id -> [last display timestamp, number of sessions it was displayed in].
export const seenTracker = createSeenTracker({ load: () => store.get('seen2', {}), save: (v) => store.set('seen2', v) });
export const markSeen = seenTracker.mark;

export function rankOpts(dataset) {
  const r = state.data?.topics?.ranking || {};
  return {
    sharpness: r.sharpness,
    groupBoost: r.groupBoost,
    volumeDamping: r.volumeDamping,
    relativeEngagement: r.relativeEngagement,
    now: Date.now(),
    halfLife: dataset?.halfLifeHours ?? 10,
    cap: dataset?.scoreCap ?? 6,
    prefs: state.prefs,
    random: Math.random, // new order on every refresh, like a "pour toi" timeline
    seen: seenTracker.counts(),
    lastVisit: newSince(state.lastVisit, state.lastGenerated),
  };
}

/** Persist the visit time and pending impressions when the page is hidden / closed. */
export function initStore() {
  // « Nouveau » is counted from the data the user had on screen, not from the clock: the
  // collector may run every 4 to 7 h, so an article published after the last generation was
  // never visible even if it predates the visit.
  const saveVisit = () => {
    store.set('lastVisit', Date.now());
    const g = Date.parse(latestGeneratedAt(state.data?.actus, state.data?.tech, state.data?.videos));
    if (Number.isFinite(g)) store.set('lastGenerated', g);
    return Number.isFinite(g) ? g : 0;
  };
  // A new session starts when the app comes back after 10 minutes in the background.
  let hiddenAt = 0;
  let generatedAtHide = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); generatedAtHide = saveVisit(); seenTracker.flush(); }
    else if (hiddenAt && Date.now() - hiddenAt > 10 * 60e3) {
      state.lastVisit = hiddenAt;
      state.lastGenerated = generatedAtHide;
      seenTracker.newSession();
      actions.afterLongAbsence(); // re-check the data in the background
    }
  });
  window.addEventListener('pagehide', () => { saveVisit(); seenTracker.flush(); });
}
