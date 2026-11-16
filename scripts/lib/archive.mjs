// Items published by the previous runs, so that an article stays in the feed for the whole
// window (72 h for Actus) even after it has left its RSS feed (many feeds only list their
// last 10 entries), and when its source fails for one run. One JSON file next to the
// resolution cache, restored and saved between workflow runs with actions/cache.
//
// Every item carries `_origin`: the config entry that produced it (`media:lemonde`,
// `bsky:Mediapart`, `tag:#manif`…). An archived item whose config entry has been removed
// is dropped, so removing a source from config/sources.json takes effect at once.

import fs from 'node:fs/promises';
import path from 'node:path';

export class ItemArchive {
  constructor(file, { now = Date.now } = {}) {
    this.file = file;
    this.now = now;
    this.feeds = {}; // feed -> { items: [], seen: { id: firstSeenMs } }
    this.loaded = false; // true when a previous run's archive was found
  }

  async load() {
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if (raw?.v === 1 && raw.feeds && typeof raw.feeds === 'object') {
        for (const [name, f] of Object.entries(raw.feeds)) {
          this.feeds[name] = { items: Array.isArray(f.items) ? f.items : [], seen: f.seen && typeof f.seen === 'object' ? f.seen : {} };
        }
        this.loaded = true;
      }
    } catch { /* first run, corrupt or unreadable file: start empty */ }
    return this;
  }

  /**
   * Fresh items first, then the archived ones still in the window whose origin is still
   * configured (fresh items win on equal id: their text, media and stats are newer).
   * An undated item gets the time it was first seen, but only when it appeared after the
   * archive existed: on the very first run every undated entry would otherwise look brand new.
   * Every fresh id is remembered (even the ones the run then discards) for that reason.
   */
  merge(feed, fresh, { maxAgeHours, origins }) {
    const prev = this.feeds[feed] || { items: [], seen: {} };
    const now = this.now();
    const cutoff = now - maxAgeHours * 3600e3;
    const seen = {};
    for (const it of fresh) {
      if (!it?.id) continue;
      // 0 = already in its feed before the archive existed: its real date is unknown.
      seen[it.id] = prev.seen[it.id] ?? (this.loaded ? now : 0);
      if (!it.publishedAt && seen[it.id]) it.publishedAt = new Date(seen[it.id]).toISOString();
    }
    const freshIds = new Set(fresh.map((i) => i?.id));
    const kept = prev.items.filter((it) => it?.id && !freshIds.has(it.id)
      && (!origins || origins.has(it._origin))
      && Date.parse(it.publishedAt) >= cutoff);
    for (const it of kept) seen[it.id] = prev.seen[it.id] ?? now;
    this.feeds[feed] = { items: [], seen };
    return [...fresh, ...kept];
  }

  /** Remembers what this run publishes for `feed` (called with the final, deduplicated list). */
  set(feed, items) {
    const f = this.feeds[feed] || (this.feeds[feed] = { items: [], seen: {} });
    f.items = items.map((it) => {
      const { keywords, ...rest } = it; // recomputed on every run
      return rest;
    });
  }

  async save() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ v: 1, savedAt: new Date(this.now()).toISOString(), feeds: this.feeds }));
    await fs.rename(tmp, this.file);
  }
}

/** Removes the collector-only fields (`_origin`, `_sameAs`) before writing public data. */
export function publicItem(item) {
  const { _origin, _sameAs, _topics, _smallImage, ...rest } = item;
  return rest;
}
