// Search in the content already loaded (titles, texts, authors, categories): client side,
// insensitive to case and accents (same normalisation as the keyword matching).

import { normalize } from './norm.js';

/** Words of a query, normalised. An item matches when every word is found. */
export const queryTerms = (q) => normalize(q).split(/\s+/).filter(Boolean);

/**
 * Items matching `query`, best first: more words found in the title, then most recent.
 * Duplicates (same id, e.g. a Bluesky video listed in Actus and in Vidéos) are returned once.
 */
export function searchItems(items, query, { limit = 30 } = {}) {
  const terms = queryTerms(query);
  if (!terms.length) return { results: [], total: 0 };
  const seen = new Set();
  const hits = [];
  for (const it of items) {
    if (!it || seen.has(it.id)) continue;
    seen.add(it.id);
    const title = normalize(it.title);
    const body = normalize([it.text, it.source?.name, it.author, ...(it.categories || [])].filter(Boolean).join(' '));
    if (!terms.every((t) => title.includes(t) || body.includes(t))) continue;
    hits.push({ it, score: terms.filter((t) => title.includes(t)).length, t: Date.parse(it.publishedAt) || 0 });
  }
  hits.sort((a, b) => b.score - a.score || b.t - a.t);
  return { results: hits.slice(0, limit).map((h) => h.it), total: hits.length };
}
