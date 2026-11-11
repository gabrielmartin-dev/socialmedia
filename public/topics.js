// Topic matching shared by the collector (scripts/lib/score.mjs) and the app
// (Bluesky accounts followed from the app and fetched live). No Node API here.

import { normalize, escapeRegex } from './norm.js';

/** Compile the topics config of one feed into matchers: [{ t, k, w, re }]. */
export function compileTopics(topicsConfig, feed = 'actus') {
  const matchers = [];
  for (const [topicId, topic] of Object.entries(topicsConfig?.topics || {})) {
    if ((topic.feed || 'actus') !== feed) continue;
    for (const [rawKw, weight] of Object.entries(topic.keywords)) {
      const prefix = rawKw.endsWith('*');
      const kw = normalize(prefix ? rawKw.slice(0, -1) : rawKw);
      const body = escapeRegex(kw).replace(/\s+/g, '[\\s-]+');
      const re = new RegExp(`(?<![a-z0-9])${body}${prefix ? '[a-z0-9]*' : ''}(?![a-z0-9])`, 'i');
      matchers.push({ t: topicId, k: rawKw.replace(/\*$/, ''), w: weight, re });
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
  return matchers.filter((m) => m.re.test(norm)).map(({ k, w, t }) => ({ k, w, t }));
}
