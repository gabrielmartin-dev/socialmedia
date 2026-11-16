// Topic matching and duplicate grouping. Final ranking happens client-side
// (freshness + local "moins de ça" weights), using the keyword matches computed here.

import { tokens, jaccard } from './text.mjs';
import { compileTopics, matchKeywords, matchText } from '../../public/topics.js';
import { canonicalUrl, hostOf } from '../../public/url.js';

// Matching itself is shared with the browser (public/topics.js).
export { compileTopics, matchKeywords };

export function annotate(item, matchers) {
  item.keywords = matchKeywords(matchText(item), matchers);
  return item;
}

/**
 * Group articles from different sources covering the same story.
 * Returns an array of entries: plain items, or { kind: 'group', id, items }.
 */
export function groupDuplicates(items, { similarity = 0.34, windowHours = 12 } = {}) {
  const n = items.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a, b) => { parent[find(a)] = find(b); };

  const toks = items.map((it) => new Set(tokens(it.title)));
  const times = items.map((it) => Date.parse(it.publishedAt) || 0);
  const windowMs = windowHours * 3600e3;

  // Visit items newest first: past `windowHours` of gap, every further item is older still,
  // so the inner loop stops there. The set of compared pairs is the same as with a full
  // O(n²) scan, hence the same groups (the input needs no particular order).
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => times[b] - times[a]);
  for (let p = 0; p < n; p++) {
    const i = order[p];
    if (items[i].kind !== 'article' || toks[i].size < 3) continue;
    for (let q = p + 1; q < n; q++) {
      const j = order[q];
      if (times[i] - times[j] > windowMs) break;
      if (items[j].kind !== 'article' || toks[j].size < 3) continue;
      if (items[i].source.id === items[j].source.id) continue;
      if (jaccard(toks[i], toks[j]) >= similarity) union(i, j);
    }
  }

  const buckets = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!buckets.has(r)) buckets.set(r, []);
    buckets.get(r).push(items[i]);
  }

  const entries = [];
  for (const members of buckets.values()) {
    if (members.length === 1) { entries.push(members[0]); continue; }
    // One article per source inside a group (keep the most recent).
    const bySource = new Map();
    for (const m of members) {
      const prev = bySource.get(m.source.id);
      if (!prev || Date.parse(m.publishedAt) > Date.parse(prev.publishedAt)) bySource.set(m.source.id, m);
    }
    const uniq = [...bySource.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
    if (uniq.length === 1) { entries.push(uniq[0]); continue; }
    entries.push({ kind: 'group', id: 'g-' + uniq.map((m) => m.id).sort()[0], items: uniq });
  }
  return entries;
}

export const domainsMatch = (a, b) => !!a && !!b && (a === b || a.endsWith('.' + b) || b.endsWith('.' + a));

/** A Bluesky post whose link card points to its own outlet's site (or `sameAs` account). */
export const isOwnLink = (post) => !!post.external?.url
  && (!!post._sameAs || domainsMatch(post.source?.handle?.toLowerCase(), hostOf(post.external.url)));

/**
 * A media outlet followed both by RSS and on Bluesky posts each article twice: the article
 * itself, and a Bluesky post whose link card points to it. Such a post gets `relayOf` (the
 * article id); the app hides it whenever that article is shown, and keeps it otherwise (an
 * account followed only on Bluesky). « Same outlet » = the Bluesky handle is the site's
 * domain (mediapart.fr ↔ www.mediapart.fr, afp.com ↔ factuel.afp.com), or the account's
 * `sameAs` in config/sources.json names the RSS source (lemediatv.bsky.social → lemedia).
 * A post by anyone else sharing the article is commentary and stays as it is.
 * The article borrows the card's image / description when its feed has none.
 * When the link matches no article (a short link that could not be followed), an outlet's
 * own post is matched by its card title against that outlet's article titles.
 * Returns { relays, byTitle, unmatched } (own links that matched nothing, for the log).
 */
export function markRelays(items) {
  const byUrl = new Map();
  const articles = [];
  for (const it of items) {
    delete it.relayOf;
    if (it.kind !== 'article') continue;
    articles.push(it);
    const key = canonicalUrl(it.url);
    if (key && !byUrl.has(key)) byUrl.set(key, it);
  }
  const sameOutlet = (post, art) => (post._sameAs && post._sameAs === art.source?.id)
    || domainsMatch(post.source?.handle?.toLowerCase(), hostOf(art.source?.url || art.url));
  // Fallback when the link cannot be matched (a short link that could not be followed):
  // the card's title against the titles of the same outlet's articles.
  const byTitle = (post) => {
    const t = new Set(tokens(post.external.title || ''));
    if (t.size < 3) return null;
    let best = null; let bestScore = 0.8;
    for (const art of articles) {
      if (!sameOutlet(post, art)) continue;
      const s = jaccard(t, new Set(tokens(art.title)));
      if (s >= bestScore) { best = art; bestScore = s; }
    }
    return best;
  };
  // Diagnostics for the collection log: an outlet's own link that matched no article.
  const unmatched = [];
  let relays = 0; let byTitleCount = 0;
  for (const it of items) {
    if (it.platform !== 'bluesky' || !it.external?.url) continue;
    let art = byUrl.get(canonicalUrl(it.external.url));
    if (art && !sameOutlet(it, art)) continue;
    if (!art && isOwnLink(it)) {
      art = byTitle(it);
      if (art) byTitleCount++;
      else unmatched.push(`@${it.source?.handle} → ${it.external.url}`);
    }
    if (!art) continue;
    it.relayOf = art.id;
    relays++;
    if (!art.image && it.external.thumb) art.image = it.external.thumb;
    if (!art.text && it.external.description) art.text = it.external.description;
  }
  return { relays, byTitle: byTitleCount, unmatched };
}
