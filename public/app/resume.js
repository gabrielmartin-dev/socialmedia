// Playback positions of the reels, so that a video picks up where it was left (after a
// swipe, a profile or thread opened from the reel, another tab, or the next launch).
// Stored on the phone only: { id: [seconds, duration, savedAt] }, the most recent kept.

const KEY = 'videoPos';
export const MAX_POSITIONS = 100;
/** Below this, the video starts over. */
export const MIN_RESUME_S = 3;
/** Closer than this to the end, the video starts over too. */
export const END_MARGIN_S = 5;

/** Where to resume, in whole seconds: 0 when barely started or almost over. */
export function resumeAt(seconds, duration) {
  if (!Number.isFinite(seconds) || seconds < MIN_RESUME_S) return 0;
  if (Number.isFinite(duration) && duration > 0 && seconds > duration - END_MARGIN_S) return 0;
  return Math.floor(seconds);
}

/** Keeps the `max` most recently saved positions. */
export function prunePositions(map, max = MAX_POSITIONS) {
  const entries = Object.entries(map);
  if (entries.length <= max) return map;
  return Object.fromEntries(entries.sort((a, b) => (b[1][2] || 0) - (a[1][2] || 0)).slice(0, max));
}

let cache = null;
function load() {
  if (!cache) {
    try { cache = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { cache = {}; }
  }
  return cache;
}

/** Saved position of a video, in seconds (0 = from the start). */
export function getPosition(id) {
  const p = load()[id];
  return p ? resumeAt(p[0], p[1]) : 0;
}

/** Remembers where a video stopped; forgets it when barely started or finished. */
export function savePosition(id, seconds, duration) {
  if (!id) return;
  const map = load();
  if (resumeAt(seconds, duration)) map[id] = [Math.floor(seconds), Number.isFinite(duration) ? Math.round(duration) : 0, Date.now()];
  else if (map[id]) delete map[id];
  else return;
  cache = prunePositions(map);
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* private mode etc. */ }
}
