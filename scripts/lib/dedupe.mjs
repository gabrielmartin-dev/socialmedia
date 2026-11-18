// Freshness window and URL de-duplication of a feed's items.

import { sanitizeItem } from './sanitize.mjs';
import { domainsMatch } from './score.mjs';
import { canonicalUrl, hostOf } from '../../public/url.js';

/** The article's own outlet published it (its source site is the article's site). */
const isPublisher = (item) => domainsMatch(hostOf(item.source?.url), hostOf(item.url));

/**
 * Sanitizes, drops what is too old / in the future, and keeps one item per page: the first
 * seen, except that the outlet's own item replaces an aggregator's (Hacker News, Lobsters),
 * which has no summary or image of its own. Newest first.
 */
export function freshAndUnique(items, maxAgeHours) {
  const cutoff = Date.now() - maxAgeHours * 3600e3;
  const future = Date.now() + 3600e3;
  const map = new Map();
  const byUrl = new Map(); // canonical url -> id of the kept item
  for (const raw of items) {
    const it = sanitizeItem(raw);
    if (!it) continue;
    const t = Date.parse(it.publishedAt);
    if (!Number.isFinite(t) || t < cutoff || t > future) continue;
    if (map.has(it.id)) continue;
    // Same page with or without tracking parameters / `www.` / trailing slash = duplicate.
    const key = canonicalUrl(it.url);
    const prevId = key ? byUrl.get(key) : undefined;
    if (prevId !== undefined) {
      if (!(isPublisher(it) && !isPublisher(map.get(prevId)))) continue;
      map.delete(prevId);
    }
    map.set(it.id, it);
    if (key) byUrl.set(key, it.id);
  }
  return [...map.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

const sameText = (it) => String(it.title || it.text || '').toLowerCase().replace(/https?:\/\/\S+/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 140);

/**
 * Videos feed: one copy of a video. An account that posts the same video twice (same video
 * file, or the same text: a re-upload) keeps only its newest post. `items` newest first.
 */
export function uniqueVideos(items) {
  const keys = new Set();
  return items.filter((it) => {
    const src = it.video?.src ? `v:${it.video.src}` : null;
    const t = sameText(it);
    const txt = t.length >= 20 ? `t:${it.source?.id}:${t}` : null;
    if ((src && keys.has(src)) || (txt && keys.has(txt))) return false;
    if (src) keys.add(src);
    if (txt) keys.add(txt);
    return true;
  });
}

/**
 * Videos found by hashtag: at most `max` per account (its newest), so that one account posting
 * thirty #retraites clips does not fill the Vidéos tab. `isTag(item)` tells the hashtag items;
 * the others are untouched. `items` newest first.
 */
export function capTagVideos(items, max, isTag) {
  if (!(max > 0)) return items;
  const count = new Map();
  return items.filter((it) => {
    if (!isTag(it)) return true;
    const n = (count.get(it.source?.id) || 0) + 1;
    count.set(it.source?.id, n);
    return n <= max;
  });
}
