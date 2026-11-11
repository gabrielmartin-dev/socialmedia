// Freshness helpers (pure, no DOM): age of the data, detection of new entries, failed sources.

const STALE_AFTER_MS = 2 * 3600e3; // the collector runs every 20 min: older than 2 h is worth flagging

/** "à jour il y a 12 min" label of the data generated at `iso`. */
export function ageLabel(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return { text: '', stale: false };
  const age = Math.max(0, now - t);
  const min = Math.round(age / 60e3);
  const stale = age > STALE_AFTER_MS;
  if (min < 1) return { text: 'à jour à l’instant', stale };
  if (min < 60) return { text: `à jour il y a ${min} min`, stale };
  const hours = Math.round(min / 60);
  if (hours < 48) return { text: `mis à jour il y a ${hours} h`, stale };
  return { text: `mis à jour il y a ${Math.round(hours / 24)} j`, stale };
}

/** Ids of an entry (a group holds several articles). */
export const entryIds = (entry) => (entry.kind === 'group' ? entry.items.map((i) => i.id) : [entry.id]);

/** Number of entries of `next` that bring an item unknown to `prev`. */
export function newEntryCount(prev, next) {
  if (!Array.isArray(next?.entries)) return 0;
  const known = new Set((prev?.entries || []).flatMap(entryIds));
  return next.entries.filter((e) => entryIds(e).some((id) => !known.has(id))).length;
}

/** Sources of status.json that failed during the last collection. */
export const failedSources = (status) => (status?.sources || []).filter((s) => !s.ok);

/** "3 sources indisponibles" */
export const failedLabel = (n) => `${n} source${n > 1 ? 's' : ''} indisponible${n > 1 ? 's' : ''}`;

/** Most recent generation date among the loaded documents (ISO string or null). */
export function latestGeneratedAt(...docs) {
  const times = docs.map((d) => Date.parse(d?.generatedAt)).filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

/** Exact date and time, in French: « mardi 11 novembre 2026 à 14:32 ». */
export function exactTime(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
