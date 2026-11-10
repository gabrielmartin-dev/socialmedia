// Browser port of the collector's keyword matcher (scripts/lib/score.mjs),
// used for Bluesky accounts followed from the app and fetched live.

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’‘`]/g, "'");
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function compileTopics(cfg, feed = 'actus') {
  const out = [];
  for (const [topicId, topic] of Object.entries(cfg?.topics || {})) {
    if ((topic.feed || 'actus') !== feed) continue;
    for (const [raw, w] of Object.entries(topic.keywords)) {
      const prefix = raw.endsWith('*');
      const body = esc(norm(prefix ? raw.slice(0, -1) : raw)).replace(/\s+/g, '[\\s-]+');
      out.push({ t: topicId, k: raw.replace(/\*$/, ''), w, re: new RegExp(`(?<![a-z0-9])${body}${prefix ? '[a-z0-9]*' : ''}(?![a-z0-9])`, 'i') });
    }
  }
  return out;
}

export function matchKeywords(text, matchers) {
  const n = norm(text);
  return matchers.filter((m) => m.re.test(n)).map(({ k, w, t }) => ({ k, w, t }));
}
