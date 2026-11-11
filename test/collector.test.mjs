import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ResolutionCache, cachedResolve } from '../scripts/lib/cache.mjs';
import { fetchText, backoffDelay } from '../scripts/lib/http.mjs';
import { fetchSourceFeed } from '../scripts/lib/rss.mjs';
import { groupDuplicates } from '../scripts/lib/score.mjs';
import { tokens, jaccard } from '../scripts/lib/text.mjs';

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'tl-cache-'));

// ---------- resolution cache ----------
test('cache: entries expire, survive a save/load, and a corrupt file means an empty cache', async () => {
  const dir = await tmp();
  const file = path.join(dir, 'nested', 'r.json');
  let now = 1_000_000;
  const c = new ResolutionCache(file, { now: () => now });
  c.set('a', { id: 1 }, 1000);
  c.set('b', { id: 2 }, 10_000);
  await c.save();

  const c2 = await new ResolutionCache(file, { now: () => now + 5000 }).load();
  assert.equal(c2.get('a'), undefined, 'expired');
  assert.deepEqual(c2.get('b'), { id: 2 });

  await fs.writeFile(file, '{ not json');
  const c3 = await new ResolutionCache(file).load();
  assert.equal(c3.get('b'), undefined);
  await new ResolutionCache(path.join(dir, 'missing.json')).load(); // must not throw
});

test('cachedResolve: uses the cache, falls back to a fresh resolution when the cached entry fails', async () => {
  const cache = new ResolutionCache('/nonexistent/x.json');
  let resolves = 0;
  const resolve = async () => ({ id: 'fresh' + ++resolves });
  const use = async (r) => { if (r.id === 'stale') throw new Error('gone'); return `items(${r.id})`; };

  let r = await cachedResolve(cache, 'k', resolve, { ttlMs: 1000, use });
  assert.deepEqual([r.cached, r.result], [false, 'items(fresh1)']);
  r = await cachedResolve(cache, 'k', resolve, { ttlMs: 1000, use });
  assert.deepEqual([r.cached, r.result, resolves], [true, 'items(fresh1)', 1], 'no new resolution');

  cache.set('k', { id: 'stale' }, 1000);
  r = await cachedResolve(cache, 'k', resolve, { ttlMs: 1000, use });
  assert.deepEqual([r.cached, r.result], [false, 'items(fresh2)']);
  assert.equal(cache.get('k').id, 'fresh2', 'the stale entry was replaced');
  assert.equal(cache.stats.fallbacks, 1);

  // A resolution whose use() fails is never cached.
  await assert.rejects(cachedResolve(cache, 'bad', async () => ({ id: 'stale' }), { ttlMs: 1000, use }));
  assert.equal(cache.get('bad'), undefined);
});

const RSS = '<rss><channel><title>T</title><item><title>Hello</title><link>https://s.fr/a</link></item></channel></rss>';
function mockFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const r = routes[url];
    const res = r ? new Response(r, { status: 200 }) : new Response('nope', { status: 404 });
    Object.defineProperty(res, 'url', { value: String(url) }); // a real fetch() exposes the final URL
    return res;
  };
  return calls;
}

test('feeds: the discovered URL is remembered; a dead remembered URL falls back to discovery', async () => {
  const real = globalThis.fetch;
  try {
    const source = { id: 's', name: 'S', site: 'https://s.fr/' };
    const html = '<link rel="alternate" type="application/rss+xml" href="/custom.xml">';
    const cache = new ResolutionCache('/nonexistent/x.json');

    let calls = mockFetch({ 'https://s.fr/': html, 'https://s.fr/custom.xml': RSS });
    await fetchSourceFeed(source, { cache });
    assert.deepEqual(calls, ['https://s.fr/', 'https://s.fr/custom.xml']);
    assert.equal(cache.get('feed:s'), 'https://s.fr/custom.xml');

    calls = mockFetch({ 'https://s.fr/custom.xml': RSS });
    await fetchSourceFeed(source, { cache });
    assert.deepEqual(calls, ['https://s.fr/custom.xml'], 'one request, no homepage / autodiscovery');

    calls = mockFetch({ 'https://s.fr/': html, 'https://s.fr/feed.xml': RSS });
    const feed = await fetchSourceFeed(source, { cache });
    assert.equal(feed.feedUrl, 'https://s.fr/feed.xml');
    assert.equal(cache.get('feed:s'), 'https://s.fr/feed.xml');
  } finally { globalThis.fetch = real; }
});

// ---------- fetchText retries ----------
function scripted(...steps) {
  let i = 0;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    const step = steps[Math.min(i++, steps.length - 1)];
    if (step instanceof Error) throw step;
    return new Response(step.body ?? '', { status: step.status, headers: step.headers });
  };
  return calls;
}
const noSleep = { sleep: async () => {} };

test('fetchText retries 5xx, 429 and network errors with backoff, then succeeds', async () => {
  const real = globalThis.fetch;
  try {
    let calls = scripted({ status: 503 }, { status: 429, headers: { 'retry-after': '0' } }, { status: 200, body: 'ok' });
    assert.equal((await fetchText('https://x/', noSleep)).text, 'ok');
    assert.equal(calls.length, 3);

    calls = scripted(new TypeError('fetch failed'), { status: 200, body: 'ok' });
    assert.equal((await fetchText('https://x/', noSleep)).text, 'ok');
    assert.equal(calls.length, 2);

    const delays = [];
    scripted({ status: 500 }, { status: 500 }, { status: 200, body: 'ok' });
    await fetchText('https://x/', { sleep: async (ms) => delays.push(ms), backoffMs: 100 });
    assert.ok(delays[1] > delays[0], 'exponential');
    assert.ok(backoffDelay(0, 500, '2') === 2000 && backoffDelay(0, 500, '999') === 5000, 'Retry-After honoured and capped');
  } finally { globalThis.fetch = real; }
});

test('fetchText gives up after the retry budget and never retries 404 or timeouts', async () => {
  const real = globalThis.fetch;
  try {
    let calls = scripted({ status: 503 });
    await assert.rejects(fetchText('https://x/', { ...noSleep, retries: 2 }), /HTTP 503/);
    assert.equal(calls.length, 3);

    calls = scripted({ status: 404 });
    await assert.rejects(fetchText('https://x/', noSleep), /HTTP 404/);
    assert.equal(calls.length, 1);

    calls = scripted({ status: 503 });
    await assert.rejects(fetchText('https://x/', { ...noSleep, retries: 0 }), /HTTP 503/);
    assert.equal(calls.length, 1);

    globalThis.fetch = (url, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' }))));
    await assert.rejects(fetchText('https://x/', { ...noSleep, timeoutMs: 10 }), /Timeout/);
  } finally { globalThis.fetch = real; }
});

// ---------- groupDuplicates ----------
// Reference implementation: the original full O(n²) scan.
function groupDuplicatesReference(items, { similarity = 0.34, windowHours = 12 } = {}) {
  const n = items.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a, b) => { parent[find(a)] = find(b); };
  const toks = items.map((it) => new Set(tokens(it.title)));
  const times = items.map((it) => Date.parse(it.publishedAt) || 0);
  const windowMs = windowHours * 3600e3;
  for (let i = 0; i < n; i++) {
    if (items[i].kind !== 'article' || toks[i].size < 3) continue;
    for (let j = i + 1; j < n; j++) {
      if (items[j].kind !== 'article' || toks[j].size < 3) continue;
      if (items[i].source.id === items[j].source.id) continue;
      if (Math.abs(times[i] - times[j]) > windowMs) continue;
      if (jaccard(toks[i], toks[j]) >= similarity) union(i, j);
    }
  }
  const buckets = new Map();
  for (let i = 0; i < n; i++) { const r = find(i); if (!buckets.has(r)) buckets.set(r, []); buckets.get(r).push(items[i]); }
  const entries = [];
  for (const members of buckets.values()) {
    if (members.length === 1) { entries.push(members[0]); continue; }
    const bySource = new Map();
    for (const m of members) { const prev = bySource.get(m.source.id); if (!prev || Date.parse(m.publishedAt) > Date.parse(prev.publishedAt)) bySource.set(m.source.id, m); }
    const uniq = [...bySource.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
    if (uniq.length === 1) { entries.push(uniq[0]); continue; }
    entries.push({ kind: 'group', id: 'g-' + uniq.map((m) => m.id).sort()[0], items: uniq });
  }
  return entries;
}

function rng(seed) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

test('groupDuplicates (early exit) gives exactly the same entries as the full scan', () => {
  const vocab = 'grève retraites budget assemblée procès ukraine gaza climat logement hôpital école élection police justice énergie nucléaire'.split(' ');
  const base = Date.parse('2026-11-09T12:00:00Z');
  for (let seed = 1; seed <= 40; seed++) {
    const r = rng(seed);
    const n = 20 + Math.floor(r() * 120);
    const items = Array.from({ length: n }, (_, i) => ({
      id: `i${i}`,
      kind: r() < 0.9 ? 'article' : 'post',
      source: { id: `s${Math.floor(r() * 12)}` },
      title: Array.from({ length: 3 + Math.floor(r() * 6) }, () => vocab[Math.floor(r() * vocab.length)]).join(' '),
      publishedAt: r() < 0.03 ? 'not a date' : new Date(base - r() * 72 * 3600e3).toISOString(),
    }));
    for (const opts of [{ similarity: 0.34, windowHours: 12 }, { similarity: 0.5, windowHours: 2 }, {}]) {
      // Newest-first (what the collector passes) and shuffled (what the old tests pass).
      const sorted = [...items].sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0));
      for (const input of [sorted, items]) {
        assert.deepEqual(groupDuplicates(input, opts), groupDuplicatesReference(input, opts), `seed ${seed}`);
      }
    }
  }
});
