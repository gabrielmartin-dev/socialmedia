// Ranking logic shared by the app (and unit tests). No DOM here.
//
// score = (1 + topicScore) × sourceWeight × freshness
// topicScore = min(cap, Σ keywordWeight × localKeywordFactor)
// freshness  = 0.5 ^ (ageHours / halfLife)

export const LESS = { sourceFactor: 0.5, sourceFloor: 0.1, keywordFactor: 0.7, keywordFloor: 0.2 };

export function emptyPrefs() {
  return { sources: {}, keywords: {} };
}

export function topicScore(item, prefs, cap = 6) {
  let sum = 0;
  for (const k of item.keywords || []) sum += k.w * (prefs.keywords[k.k] ?? 1);
  return Math.min(cap, sum);
}

export function itemScore(item, { now = Date.now(), halfLife = 6, cap = 6, prefs = emptyPrefs() } = {}) {
  const ageH = Math.max(0, (now - Date.parse(item.publishedAt)) / 3600e3);
  const freshness = Math.pow(0.5, ageH / halfLife);
  const src = prefs.sources[item.source?.id] ?? 1;
  return (1 + topicScore(item, prefs, cap)) * src * freshness;
}

export function entryScore(entry, opts) {
  if (entry.kind === 'group') return Math.max(...entry.items.map((i) => itemScore(i, opts)));
  return itemScore(entry, opts);
}

/** Sort entries by score, skipping hidden ids. Returns new array. */
export function rank(entries, opts, hidden = new Set()) {
  return entries
    .filter((e) => !hidden.has(e.id))
    .map((e) => ({ e, s: entryScore(e, opts) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.e);
}

/** Apply "moins de ça" to prefs (mutates and returns prefs). */
export function applyLess(prefs, entry) {
  const items = entry.kind === 'group' ? entry.items : [entry];
  if (entry.kind !== 'group') {
    const id = entry.source.id;
    prefs.sources[id] = Math.max(LESS.sourceFloor, (prefs.sources[id] ?? 1) * LESS.sourceFactor);
  }
  const kws = new Set(items.flatMap((i) => (i.keywords || []).map((k) => k.k)));
  for (const k of kws) {
    prefs.keywords[k] = Math.max(LESS.keywordFloor, (prefs.keywords[k] ?? 1) * LESS.keywordFactor);
  }
  return prefs;
}

export function topicsOf(entry) {
  const items = entry.kind === 'group' ? entry.items : [entry];
  return [...new Set(items.flatMap((i) => (i.keywords || []).map((k) => k.t)))];
}

export function relativeTime(iso, now = Date.now()) {
  const t = Date.parse(iso);
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "à l'instant";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} j`;
  return new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}
