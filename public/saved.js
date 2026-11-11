// "Enregistrés": local bookmarks (read later). Not a like: nothing is sent anywhere. The full
// item is stored, so that it stays readable after it leaves the collector's 72 h window.
// Pure functions: the list lives in localStorage (see app/store.js).

export const SAVED_MAX = 300;

/** The item that gets saved for an entry: a group saves its lead article (the one with an image, else the first). */
export function leadItem(entry) {
  if (entry.kind !== 'group') return entry;
  return entry.items.find((i) => i.image) || entry.items[0];
}

export const isSaved = (list, id) => list.some((i) => i.id === id);

/** New list with `item` first (most recent first), without duplicate, capped at SAVED_MAX. */
export function addSaved(list, item, now = Date.now()) {
  return [{ ...item, savedAt: now }, ...list.filter((i) => i.id !== item.id)].slice(0, SAVED_MAX);
}

export const removeSaved = (list, id) => list.filter((i) => i.id !== id);

/** Keeps only plausible items (a corrupted or hand-edited storage must never break the app). */
export function sanitizeSaved(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((i) => i && typeof i.id === 'string' && typeof i.url === 'string' && i.source && typeof i.source.id === 'string').slice(0, SAVED_MAX);
}
