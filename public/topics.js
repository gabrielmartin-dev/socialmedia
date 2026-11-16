// Topic matching shared by the collector (scripts/lib/score.mjs) and the app
// (Bluesky accounts followed from the app and fetched live). No Node API here.

import { normalize, stripAccents, escapeRegex } from './norm.js';

/** Text a topic is matched on: title, text, link card, quoted post and feed categories. */
export function matchText(item) {
  return [item.title, item.text, item.external?.title, item.external?.description, item.quote?.text, (item.categories || []).join(' ')]
    .filter(Boolean).join('\n');
}

/**
 * Compile the topics config of one feed into matchers: [{ t, k, w, re, cs }].
 * A keyword written `=AI` is case-sensitive (accents are still ignored); a final `*` = prefix.
 */
export function compileTopics(topicsConfig, feed = 'actus') {
  const matchers = [];
  for (const [topicId, topic] of Object.entries(topicsConfig?.topics || {})) {
    if ((topic.feed || 'actus') !== feed) continue;
    for (const [rawKw, weight] of Object.entries(topic.keywords)) {
      const cs = rawKw.startsWith('=');
      const bare = cs ? rawKw.slice(1) : rawKw;
      const prefix = bare.endsWith('*');
      const word = prefix ? bare.slice(0, -1) : bare;
      const kw = cs ? stripAccents(word) : normalize(word);
      const body = escapeRegex(kw).replace(/\s+/g, '[\\s-]+');
      const re = cs
        ? new RegExp(`(?<![A-Za-z0-9])${body}${prefix ? '[A-Za-z0-9]*' : ''}(?![A-Za-z0-9])`, 'g')
        : new RegExp(`(?<![a-z0-9])${body}${prefix ? '[a-z0-9]*' : ''}(?![a-z0-9])`, 'gi');
      matchers.push({ t: topicId, k: word, w: weight, re, cs });
    }
  }
  return matchers;
}

/**
 * Returns the matched keywords: [{ k, w, t }] (keyword, weight, topic).
 * A keyword counts once per item, whatever the number of occurrences. An occurrence inside
 * a longer keyword's occurrence does not count ("Assemblée" in "Assemblée nationale").
 */
export function matchKeywords(text, matchers) {
  const norm = normalize(text);
  const exact = stripAccents(text);
  const occ = [];
  matchers.forEach((m, idx) => {
    for (const x of (m.cs ? exact : norm).matchAll(m.re)) occ.push({ idx, s: x.index, e: x.index + x[0].length });
  });
  if (!occ.length) return [];
  const kept = new Set();
  for (const o of occ) {
    if (kept.has(o.idx)) continue;
    const len = o.e - o.s;
    const inside = occ.some((p) => p.idx !== o.idx && p.s <= o.s && o.e <= p.e && p.e - p.s > len);
    if (!inside) kept.add(o.idx);
  }
  return matchers.filter((_, i) => kept.has(i)).map(({ k, w, t }) => ({ k, w, t }));
}
