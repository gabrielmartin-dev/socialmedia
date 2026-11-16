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

/**
 * Suggested accounts, the most worthwhile first. The items of the suggested sources are already
 * in the collected data (just not shown): for each account, `n` = items found, `affinity` =
 * their mean topic score with the local preferences (« Moins de [sujet] » lowers it), `topic` =
 * the topic its items weigh most on. Active accounts come first, by affinity × log2(1 + n);
 * the inactive ones follow in their original order.
 * `scoreOf(item)` gives an item's topic score; `topicOf(item)` its main topic id or null.
 */
export function rankSuggestions(accounts, items, { scoreOf, topicOf }) {
  const bySource = new Map();
  for (const it of items) {
    const id = it?.source?.id;
    if (!id) continue;
    if (!bySource.has(id)) bySource.set(id, new Map());
    bySource.get(id).set(it.id, it);
  }
  return accounts
    .map((account, order) => {
      const mine = [...(bySource.get(account.id)?.values() || [])];
      const n = mine.length;
      const affinity = n ? mine.reduce((s, it) => s + scoreOf(it), 0) / n : 0;
      const weight = new Map();
      for (const it of mine) { const t = topicOf(it); if (t) weight.set(t, (weight.get(t) || 0) + scoreOf(it)); }
      const topic = [...weight].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      return { account, n, affinity, topic, order, rank: affinity * Math.log2(1 + n) };
    })
    .sort((a, b) => (b.n > 0) - (a.n > 0) || b.rank - a.rank || a.order - b.order);
}

/** « Reposté par Mathilde Panot, Manuel Bompard +2 » */
export const repostedBy = (by) => `Reposté par ${by.slice(0, 2).join(', ')}${by.length > 2 ? ` +${by.length - 2}` : ''}`;

/** « 12 posts récents · surtout Social » / « Aucun post récent » */
export function activityNote({ n, topic }, topicLabel) {
  if (!n) return 'Aucun post récent';
  const label = topic ? topicLabel(topic) : null;
  return `${n} post${n > 1 ? 's' : ''} récent${n > 1 ? 's' : ''}${label ? ` · surtout ${label}` : ''}`;
}
