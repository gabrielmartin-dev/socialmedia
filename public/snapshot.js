// What was on screen when the app went to the background, so that a page reload (app
// update, or iOS discarding the page) brings back the same posts in the same order at the
// same place, instead of a freshly shuffled feed scrolled to the top.

/** Snapshots older than this are ignored: the next launch starts a fresh feed. */
export const SNAPSHOT_MAX_AGE_MS = 3 * 3600e3;

/** Ids of an entry: the item itself, or every article of a group (whose id may change). */
export const idsOf = (e) => (e?.kind === 'group' ? e.items.map((i) => i.id) : [e?.id]).filter(Boolean);

/** The first `count` entries of a ranking, as lists of ids. */
export function orderOf(ranked, count) {
  return ranked.slice(0, count).map(idsOf);
}

/**
 * Puts back, in their saved order, the entries of `ranked` that were on screen (`saved` from
 * orderOf); everything else keeps its new rank after them. An entry that no longer exists
 * (filtered out, too old) is skipped; a group matches as long as one of its articles does.
 */
export function restoreOrder(ranked, saved) {
  if (!Array.isArray(saved) || !saved.length) return ranked;
  const byId = new Map();
  ranked.forEach((e, i) => idsOf(e).forEach((id) => { if (!byId.has(id)) byId.set(id, i); }));
  const used = new Set();
  const head = [];
  for (const ids of saved) {
    if (!Array.isArray(ids)) continue;
    const i = ids.map((id) => byId.get(id)).find((j) => j !== undefined && !used.has(j));
    if (i === undefined) continue;
    used.add(i);
    head.push(ranked[i]);
  }
  return [...head, ...ranked.filter((_, i) => !used.has(i))];
}

/** The snapshot if it is recent enough to be restored, else null. */
export function usableSnapshot(snap, now = Date.now(), maxAge = SNAPSHOT_MAX_AGE_MS) {
  if (!snap || typeof snap !== 'object' || !Number.isFinite(snap.at)) return null;
  const age = now - snap.at;
  return age >= 0 && age <= maxAge ? snap : null;
}
