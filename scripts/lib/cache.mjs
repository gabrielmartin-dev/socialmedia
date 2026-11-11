// Persistent cache of costly resolutions (YouTube channel ids, Bluesky handles / DIDs,
// discovered feed URLs). One small JSON file, restored and saved between workflow runs
// with actions/cache. Every entry expires, and a failing entry never blocks a run:
// callers fall back to the normal resolution (see cachedResolve).

import fs from 'node:fs/promises';
import path from 'node:path';

export const HOUR = 3600e3;
export const DAY = 24 * HOUR;

export class ResolutionCache {
  constructor(file, { now = Date.now } = {}) {
    this.file = file;
    this.now = now;
    this.entries = new Map(); // key -> { v, exp }
    this.stats = { hits: 0, misses: 0, fallbacks: 0 };
  }

  /** Reads the file; a missing or corrupt file simply means an empty cache. */
  async load() {
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8'));
      for (const [k, e] of Object.entries(raw.entries || {})) {
        if (e && typeof e.exp === 'number' && e.exp > this.now() && e.v !== undefined) this.entries.set(k, e);
      }
    } catch { /* first run, corrupt file, unreadable: start empty */ }
    return this;
  }

  get(key) {
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (e.exp <= this.now()) { this.entries.delete(key); return undefined; }
    return e.v;
  }

  set(key, value, ttlMs) {
    this.entries.set(key, { v: value, exp: this.now() + ttlMs });
  }

  delete(key) { this.entries.delete(key); }

  async save() {
    const entries = {};
    for (const [k, e] of this.entries) if (e.exp > this.now()) entries[k] = e;
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ v: 1, savedAt: new Date(this.now()).toISOString(), entries }));
    await fs.rename(tmp, this.file);
  }
}

/**
 * Resolve `key` through the cache. A cached value is used first; if `use(value)` throws
 * (stale id, renamed account…), the entry is dropped and the normal `resolve()` runs.
 * The cache is only written once `use` succeeded with the resolved value.
 * Returns { resolved, result, cached }.
 */
export async function cachedResolve(cache, key, resolve, { ttlMs, use = async (v) => v } = {}) {
  const hit = cache?.get(key);
  if (hit !== undefined) {
    try {
      const result = await use(hit);
      cache.stats.hits++;
      return { resolved: hit, result, cached: true };
    } catch {
      cache.delete(key);
      cache.stats.fallbacks++;
    }
  } else if (cache) cache.stats.misses++;
  const resolved = await resolve();
  const result = await use(resolved);
  cache?.set(key, resolved, ttlMs);
  return { resolved, result, cached: false };
}
