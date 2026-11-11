// Topic matching and duplicate grouping. Final ranking happens client-side
// (freshness + local "moins de ça" weights), using the keyword matches computed here.

import { normalize, escapeRegex, tokens, jaccard } from './text.mjs';

/** Compile topics config into matchers. */
export function compileTopics(topicsConfig, feed = 'actus') {
  const matchers = [];
  for (const [topicId, topic] of Object.entries(topicsConfig.topics)) {
    if ((topic.feed || 'actus') !== feed) continue;
    for (const [rawKw, weight] of Object.entries(topic.keywords)) {
      const prefix = rawKw.endsWith('*');
      const kw = normalize(prefix ? rawKw.slice(0, -1) : rawKw);
      const body = escapeRegex(kw).replace(/\\?\s+/g, '[\\s-]+');
      const re = new RegExp(`(?<![a-z0-9])${body}${prefix ? '[a-z0-9]*' : ''}(?![a-z0-9])`, 'i');
      matchers.push({ topic: topicId, keyword: rawKw.replace(/\*$/, ''), weight, re });
    }
  }
  return matchers;
}

/**
 * Returns the matched keywords: [{ k, w, t }] (keyword, weight, topic).
 * A keyword counts once per item, whatever the number of occurrences.
 */
export function matchKeywords(text, matchers) {
  const norm = normalize(text);
  const out = [];
  for (const m of matchers) {
    if (m.re.test(norm)) out.push({ k: m.keyword, w: m.weight, t: m.topic });
  }
  return out;
}

export function annotate(item, matchers) {
  const text = [item.title, item.text].filter(Boolean).join('\n');
  item.keywords = matchKeywords(text, matchers);
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
