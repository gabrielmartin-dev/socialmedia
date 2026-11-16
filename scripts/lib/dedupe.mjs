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
