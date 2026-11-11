// Ranking logic shared by the app (and unit tests). No DOM here.
//
// score = √(1 + topicScore) × sourceWeight × freshness × engagement × seen × new
// topicScore = min(cap, Σ keywordWeight × localKeywordFactor)
// freshness  = 0.5 ^ (ageHours / halfLife)
// engagement = 1 + 0.25 × log10(1 + likes + 2 × reposts)   (Bluesky only)
// seen       = 0.2 ^ (number of sessions in which the item was displayed, max 3)
// new        = 1.5 if published since the previous visit, else 1
//
// "Pour toi" mode (random given): weighted random sampling without replacement
// (Efraimidis–Spirakis: key = U^(1/score)), so high scores tend to come first but
// the order changes on every refresh; then a diversity pass avoids the same
// source twice in a row.

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
  const st = item.stats;
  const engagement = st ? 1 + 0.25 * Math.log10(1 + (st.likes || 0) + 2 * (st.reposts || 0)) : 1;
  // Square root keeps topics important without letting one hot post crush the rest.
  return Math.sqrt(1 + topicScore(item, prefs, cap)) * src * freshness * engagement;
}

export const SEEN_FACTOR = 0.2;
export const NEW_BOOST = 1.5;

/** How many times an entry was displayed. `seen` is a Map(id → count) or a Set(id). */
export function seenCount(entry, seen) {
  if (!seen) return 0;
  const get = (id) => (seen instanceof Map ? seen.get(id) || 0 : seen.has(id) ? 1 : 0);
  // A group counts as seen if any of its articles was seen (its id changes as it grows).
  const ids = entry.kind === 'group' ? [entry.id, ...entry.items.map((i) => i.id)] : [entry.id];
  return Math.min(3, Math.max(...ids.map(get)));
}

function newestDate(entry) {
  return entry.kind === 'group' ? Math.max(...entry.items.map((i) => Date.parse(i.publishedAt))) : Date.parse(entry.publishedAt);
}

export function entryScore(entry, opts) {
  if (entry.kind === 'group') return Math.max(...entry.items.map((i) => itemScore(i, opts)));
  return itemScore(entry, opts);
}

const sourceOf = (e) => (e.kind === 'group' ? 'group' : e.source?.id);

/** Reorder so the same source never appears twice within `gap` positions when avoidable. */
export function diversify(list, gap = 2) {
  const out = [];
  const pending = [...list];
  while (pending.length) {
    const recent = new Set(out.slice(-gap).map(sourceOf));
    const idx = pending.findIndex((e) => !recent.has(sourceOf(e)) || sourceOf(e) === 'group');
    out.push(pending.splice(idx === -1 ? 0 : idx, 1)[0]);
  }
  return out;
}

/**
 * Rank entries, skipping hidden ids. Returns a new array.
 * - Without opts.random: deterministic, best score first.
 * - With opts.random (e.g. Math.random): "pour toi" mode, different on each call.
 * opts.seen: Set of ids already displayed, which are pushed down.
 */
export function rank(entries, opts = {}, hidden = new Set()) {
  const { random, seen, lastVisit } = opts;
  const scored = entries
    .filter((e) => !hidden.has(e.id))
    .map((e) => {
      let s = entryScore(e, opts);
      const n = seenCount(e, seen);
      if (n) s *= SEEN_FACTOR ** n;
      else if (lastVisit && newestDate(e) > lastVisit) s *= NEW_BOOST;
      return { e, s: Math.max(s, 1e-9) };
    });
  if (!random) return scored.sort((a, b) => b.s - a.s).map((x) => x.e);
  const sampled = scored
    .map((x) => ({ e: x.e, k: Math.log(Math.max(random(), 1e-12)) / x.s }))
    .sort((a, b) => b.k - a.k)
    .map((x) => x.e);
  return diversify(sampled);
}

/**
 * Merge `entries` into an already displayed ranking without moving what is on screen:
 * the first `rendered` entries are untouched; the not-yet-rendered tail is re-ranked
 * together with the newcomers. Returns the new list, or null when nothing is new.
 */
export function mergeIntoTail(ranked, rendered, entries, opts = {}, hidden = new Set()) {
  const present = new Set(ranked.flatMap((e) => (e.kind === 'group' ? e.items.map((i) => i.id) : [e.id])));
  const fresh = entries.filter((e) => !present.has(e.id) && !hidden.has(e.id));
  if (!fresh.length) return null;
  const tail = rank([...ranked.slice(rendered), ...fresh], opts, hidden);
  return [...ranked.slice(0, rendered), ...tail];
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
