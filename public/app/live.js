// Data loading: the collected JSON, then Bluesky accounts followed from the app ("live"),
// which are merged in the background as they arrive.

import { mergeIntoTail } from '../rank.js';
import { authorPosts } from '../bsky.js';
import { compileTopics, matchKeywords } from '../topics.js';
import { unpackFeed } from '../pack.js';
import { pool } from '../pool.js';
import { $ } from './dom.js';
import { state, itemVisible, rankOpts } from './store.js';
import { renderFeed, appendFeed } from './feed.js';

const LIVE_TIMEOUT_MS = 8000;
const LIVE_CONCURRENCY = 4;
// Used only when topics.json predates the exported `settings` (cached old data).
const DEFAULT_MAX_AGE_HOURS = { actus: 72, tech: 168, videos: 168 };

// 'no-cache' = conditional revalidation (ETag → 304 from GitHub Pages) instead of a full download.
export async function loadData() {
  const get = (name) => fetch(`data/${name}.json`, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const [actus, tech, videos, status, accounts, topics] = await Promise.all(
    ['actus', 'tech', 'videos', 'status', 'accounts', 'topics'].map(get));
  state.data = { actus: unpackFeed(actus), tech: unpackFeed(tech), videos: unpackFeed(videos), status, accounts, topics };
  state.accounts = new Map((accounts?.accounts || []).map((a) => [a.id, a]));
}

/** Freshness window (ms) of a feed: the collector's setting, exported in topics.json. */
export const maxAgeMs = (feed, topics = state.data.topics) =>
  (topics?.settings?.[`${feed}MaxAgeHours`] ?? DEFAULT_MAX_AGE_HOURS[feed]) * 3600e3;

/** The feed a followed live account belongs to (search results are Actus). */
export const liveFeedOf = (id) => (state.follows.live[id]?.feed === 'tech' ? 'tech' : 'actus');

/**
 * Score and sort one account's posts into the feeds. Each feed uses its own topics (an
 * account followed in Tech is scored with the Tech keywords); videos use the Actus
 * topics, like the collector does.
 */
export function classifyLive(id, posts, topics, now = Date.now()) {
  const feed = liveFeedOf(id);
  const matchers = { actus: compileTopics(topics, 'actus'), tech: compileTopics(topics, 'tech') };
  const out = { actus: [], tech: [], videos: [] };
  for (const p of posts) {
    const age = now - Date.parse(p.publishedAt);
    if (age < maxAgeMs(feed, topics)) out[feed].push({ ...p, keywords: matchKeywords(p.text, matchers[feed]) });
    if (p.video?.type === 'hls' && age < maxAgeMs('videos', topics)) {
      out.videos.push({ ...p, kind: 'video', keywords: matchKeywords(p.text, matchers.actus) });
    }
  }
  return out;
}

const liveByAccount = new Map(); // id -> { actus, tech, videos } (kept when a later request fails)
let liveSeq = 0;

function publishLive() {
  const live = { actus: [], tech: [], videos: [] };
  for (const c of liveByAccount.values()) for (const k of Object.keys(live)) live[k].push(...c[k]);
  state.live = live;
}

/**
 * Fetch posts of Bluesky accounts followed from search (not collected by GitHub), in the
 * background: the collected data is already on screen. Each account is merged as it
 * arrives, without reshuffling what the user is looking at (see integrateLive).
 */
export async function loadLive() {
  const seq = ++liveSeq;
  const ids = Object.keys(state.follows.live).filter((id) => state.follows.followed.has(id) && !state.accounts.has(id));
  for (const id of [...liveByAccount.keys()]) if (!ids.includes(id)) liveByAccount.delete(id);
  await pool(ids.map((id) => async () => {
    const posts = await authorPosts(id.slice(5), 25, { timeoutMs: LIVE_TIMEOUT_MS });
    if (seq !== liveSeq) return; // a newer loadLive superseded this one
    const classified = classifyLive(id, posts, state.data.topics);
    const prev = liveByAccount.get(id);
    liveByAccount.set(id, classified);
    publishLive();
    const fresh = {};
    for (const k of Object.keys(classified)) {
      const known = new Set((prev?.[k] || []).map((p) => p.id));
      fresh[k] = classified[k].filter((p) => !known.has(p.id));
    }
    integrateLive(fresh);
  }), LIVE_CONCURRENCY);
}

/**
 * Merge freshly arrived live posts ({ actus, tech, videos }) into the feeds already on
 * screen without moving anything the user can see: they are ranked together with the
 * not-yet-rendered tail only.
 */
function integrateLive(fresh) {
  const mergeTail = (target, dataset, entries) => {
    const merged = mergeIntoTail(target.ranked, target.rendered, entries.filter(itemVisible), rankOpts(dataset), state.hidden);
    if (!merged) return false;
    target.ranked = merged;
    return true;
  };
  for (const key of ['actus', 'tech']) {
    const feed = state.feeds[key];
    if (!fresh[key]?.length || feed.dirty || !state.data[key]) continue;
    if (!feed.ranked.length) renderFeed(key); // empty screen: nothing to disturb
    else if (mergeTail(feed, state.data[key], fresh[key])) {
      const sentinel = $(`#${key}-sentinel`);
      if (feed.rendered < feed.ranked.length && sentinel.getBoundingClientRect().top < window.innerHeight + 800) appendFeed(key);
    }
  }
  if (fresh.videos?.length && state.reels.built && state.data.videos) mergeTail(state.reels, state.data.videos, fresh.videos);
}
