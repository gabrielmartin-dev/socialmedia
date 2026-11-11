import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packFeed, unpackFeed } from '../public/pack.js';
import { createSeenTracker, pruneSeen } from '../public/seen.js';
import { mergeIntoTail, rank } from '../public/rank.js';
import { pool } from '../public/pool.js';
import { authorPosts } from '../public/bsky.js';

const T = 'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:x/bafy@jpeg';
const F = T.replace('/feed_thumbnail/', '/feed_fullsize/');
const src = (id) => ({ id, name: id.toUpperCase(), avatar: `https://a/${id}.png`, url: `https://${id}.fr/` });
const kws = [{ k: 'grev', w: 2.5, t: 'social' }, { k: 'budget', w: 2, t: 'eco' }];
const sample = () => ({
  generatedAt: 'x', scoreCap: 6,
  entries: [
    { id: 'p1', kind: 'post', source: src('a'), text: 'Salut lien', segments: [{ t: 'Salut ' }, { t: 'lien', href: 'https://l/' }], image: T, images: [{ thumb: T, full: F, alt: '', aspect: 1.5 }], keywords: kws, publishedAt: 'd' },
    { id: 'p2', kind: 'post', source: src('a'), text: 'Texte sans segments', image: null, keywords: [], publishedAt: 'd' },
    { id: 'p3', kind: 'post', source: { ...src('a'), suggested: true }, text: 'autre', image: null, external: { url: 'https://e/', title: 't', thumb: 'https://e/t.jpg' }, keywords: [{ k: 'grev', w: 9, t: 'other' }], publishedAt: 'd' },
    { kind: 'group', id: 'g', items: [
      { id: 'a1', kind: 'article', source: src('b'), title: 'T', text: 'x', image: 'https://i/1.jpg', keywords: kws, publishedAt: 'd' },
      { id: 'a2', kind: 'article', source: src('c'), title: 'T', text: 'x', image: null, keywords: [], publishedAt: 'd' }] },
    { id: 'y1', kind: 'video', platform: 'youtube', source: src('d'), title: 'v', text: '', image: 'https://i1.ytimg.com/vi/abcdefghijk/hqdefault.jpg', video: { type: 'youtube', src: 'abcdefghijk', poster: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg', aspect: 1.77 }, keywords: [], publishedAt: 'd' },
  ],
});

test('pack/unpack is lossless and actually smaller', () => {
  const original = sample();
  const packed = packFeed(original);
  assert.deepEqual(original, sample(), 'packFeed must not mutate its input');
  assert.equal(packed.v, 2);
  assert.ok(JSON.stringify(packed).length < JSON.stringify(original).length);
  assert.equal(packed.entries[0].source, undefined);
  assert.equal(packed.entries[0].text, undefined);
  const back = unpackFeed(JSON.parse(JSON.stringify(packed)));
  assert.deepEqual(back, original);
});

test('unpack leaves documents without a version (old cache, sample data) untouched', () => {
  const doc = sample();
  assert.deepEqual(unpackFeed(sample()), doc);
  assert.equal(unpackFeed(null), null);
});

test('seen tracker: debounced write, flushed on demand, one impression per session', () => {
  const writes = [];
  let timers = [];
  let t = 1_000_000;
  const tr = createSeenTracker({
    load: () => ({}), save: (v) => writes.push(JSON.parse(JSON.stringify(v))), now: () => t,
    setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: (id) => { timers[id - 1] = null; },
  });
  tr.mark('a'); tr.mark('a'); tr.mark('b');
  assert.equal(writes.length, 0, 'debounced');
  tr.flush(); // pagehide / visibilitychange hidden
  assert.equal(writes.length, 1);
  assert.deepEqual(Object.keys(writes[0]).sort(), ['a', 'b']);
  assert.equal(writes[0].a[1], 1);
  timers.forEach((fn) => fn && fn()); // the old timer was cancelled: no second write
  tr.flush();
  assert.equal(writes.length, 1, 'nothing dirty, nothing written');
  tr.newSession(); tr.mark('a');
  tr.flush();
  assert.equal(writes[1].a[1], 2);
  assert.equal(tr.counts().get('a'), 2);
  tr.reset();
  assert.deepEqual(writes.at(-1), {});
});

test('pruneSeen drops entries older than 4 days and malformed values', () => {
  const now = Date.now();
  assert.deepEqual(pruneSeen({ old: [now - 5 * 86400e3, 1], ok: [now - 1000, 2], bad: 'x' }, now), { ok: [now - 1000, 2] });
});

test('mergeIntoTail never touches what is already rendered', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');
  const mk = (id, kw = 0) => ({ id, source: { id }, keywords: kw ? [{ k: 'k', w: kw, t: 't' }] : [], publishedAt: new Date(now).toISOString() });
  const ranked = ['a', 'b', 'c', 'd', 'e'].map((id) => mk(id));
  const hot = mk('hot', 6);
  const merged = mergeIntoTail(ranked, 3, [hot, mk('a'), mk('hidden')], { now }, new Set(['hidden']));
  assert.deepEqual(merged.slice(0, 3).map((e) => e.id), ['a', 'b', 'c'], 'rendered head is frozen');
  assert.equal(merged.length, 6);
  assert.equal(merged[3].id, 'hot', 'a hot newcomer leads the unrendered tail');
  assert.equal(mergeIntoTail(ranked, 3, [mk('a'), mk('hidden')], { now }, new Set(['hidden'])), null);
  // Items already inside a group count as present.
  const withGroup = [{ kind: 'group', id: 'g', items: [mk('x1'), mk('x2')] }];
  assert.equal(mergeIntoTail(withGroup, 1, [mk('x2')], { now }), null);
  assert.ok(rank([hot], { now }).length === 1);
});

test('pool respects its concurrency limit and never rejects', async () => {
  let running = 0; let peak = 0;
  const task = (i) => async () => {
    running++; peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
    if (i === 3) throw new Error('boom');
    return i;
  };
  const res = await pool(Array.from({ length: 10 }, (_, i) => task(i)), 4);
  assert.equal(peak, 4);
  assert.equal(res.filter((r) => r.ok).length, 9);
  assert.equal(res[3].ok, false);
});

test('Bluesky requests time out instead of hanging', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  try {
    const t0 = Date.now();
    await assert.rejects(authorPosts('someone.bsky.social', 5, { timeoutMs: 30 }), /abort/i);
    assert.ok(Date.now() - t0 < 1000);
  } finally { globalThis.fetch = real; }
});

// ---------- live accounts: windows and topics come from the config ----------
import { classifyLive, maxAgeMs } from '../public/app/live.js';
import { state } from '../public/app/store.js';
import { topicsForClient } from '../scripts/lib/client-config.mjs';
import { clampAspect, KIND_LABEL } from '../public/app/util.js';

const liveTopics = topicsForClient({
  topics: {
    social: { feed: 'actus', keywords: { greve: 2 } },
    ia: { feed: 'tech', keywords: { 'intelligence artificielle': 3, greve: 9 } },
  },
}, { actusMaxAgeHours: 24, videosMaxAgeHours: 100 });
const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const livePost = (id, h, text, video) => ({ id, kind: 'post', source: { id: 'bsky:x' }, text, publishedAt: hoursAgo(h), video });

test('topicsForClient exports the freshness windows of the config', () => {
  assert.deepEqual(liveTopics.settings, { actusMaxAgeHours: 24, techMaxAgeHours: 168, videosMaxAgeHours: 100 });
  assert.equal(liveTopics.topics.social.feed, 'actus');
  assert.equal(topicsForClient({ topics: {} }).settings.actusMaxAgeHours, 72, 'defaults mirror the collector');
});

test('live posts use the configured windows, not a hard-coded 72 h', () => {
  assert.equal(maxAgeMs('actus', liveTopics), 24 * 3600e3);
  assert.equal(maxAgeMs('actus', null), 72 * 3600e3, 'fallback for data published before `settings` existed');
  const posts = [livePost('new', 5, 'greve'), livePost('mid', 30, 'greve'), livePost('old', 200, 'greve')];
  state.follows.live['bsky:x'] = { feed: 'actus' };
  const out = classifyLive('bsky:x', posts, liveTopics);
  assert.deepEqual(out.actus.map((p) => p.id), ['new'], '24 h window of this config');
  assert.equal(classifyLive('bsky:x', posts, { ...liveTopics, settings: { ...liveTopics.settings, actusMaxAgeHours: 48 } }).actus.length, 2);
});

test('live posts are scored with the topics of their own feed; videos follow the videos window', () => {
  const posts = [livePost('p', 1, 'greve et intelligence artificielle'),
    livePost('v', 90, 'greve', { type: 'hls', src: 'https://v/p.m3u8' }), livePost('vold', 120, 'greve', { type: 'hls', src: 'https://v/q.m3u8' })];
  state.follows.live['bsky:x'] = { feed: 'tech' };
  const tech = classifyLive('bsky:x', posts, liveTopics);
  assert.deepEqual(tech.tech[0].keywords.map((k) => k.k).sort(), ['greve', 'intelligence artificielle']);
  assert.equal(tech.tech[0].keywords.find((k) => k.k === 'greve').w, 9, 'tech topics, not actus ones');
  assert.deepEqual(tech.actus, []);
  assert.deepEqual(tech.videos.map((p) => p.id), ['v'], 'videos window (100 h) applies, not the actus one');
  assert.equal(tech.videos[0].kind, 'video');
  assert.equal(tech.videos[0].keywords[0].w, 2, 'videos are scored with the actus topics, like the collector');

  state.follows.live['bsky:x'] = { feed: 'actus' };
  const actus = classifyLive('bsky:x', posts, liveTopics);
  assert.deepEqual(actus.actus[0].keywords.map((k) => k.k), ['greve']);
  assert.deepEqual(actus.tech, []);
  delete state.follows.live['bsky:x'];
});

test('shared labels and aspect clamp', () => {
  assert.equal(clampAspect(undefined, 1.5), 1.5);
  assert.equal(clampAspect(0.3, 1.5), 0.8);
  assert.equal(clampAspect(5, 1.5), 2.2);
  assert.equal(clampAspect(1.78, 1.5), 1.78);
  assert.equal(KIND_LABEL.media, 'Site');
});
