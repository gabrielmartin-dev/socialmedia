// "Seen" impressions, persisted with a debounce and flushed when the page is hidden.
// Storage and timers are injected so this can be unit-tested without a DOM.

const FOUR_DAYS = 4 * 86400e3;

/** Keeps only [timestamp, count] pairs newer than 4 days. */
export function pruneSeen(map, now = Date.now()) {
  const cutoff = now - FOUR_DAYS;
  const out = {};
  for (const [id, v] of Object.entries(map || {})) if (Array.isArray(v) && v[0] > cutoff) out[id] = v;
  return out;
}

export function createSeenTracker({ load, save, now = Date.now, delay = 1000, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const seen = pruneSeen(load(), now());
  const session = new Set(); // one impression per id and per session
  let timer = null;
  let dirty = false;

  function flush() {
    if (timer != null) { clearTimer(timer); timer = null; }
    if (!dirty) return;
    dirty = false;
    save(seen);
  }

  return {
    mark(id) {
      if (!id || session.has(id)) return;
      session.add(id);
      const prev = seen[id];
      seen[id] = [now(), (prev?.[1] || 0) + 1];
      dirty = true;
      if (timer != null) clearTimer(timer);
      timer = setTimer(flush, delay);
    },
    flush,
    newSession() { session.clear(); },
    reset() {
      for (const id of Object.keys(seen)) delete seen[id];
      session.clear();
      dirty = false;
      if (timer != null) { clearTimer(timer); timer = null; }
      save(seen);
    },
    /** id -> number of sessions in which it was displayed. */
    counts: () => new Map(Object.entries(seen).map(([id, v]) => [id, v[1]])),
    get data() { return seen; },
  };
}
