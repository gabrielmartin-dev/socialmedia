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

// ---------- keyboard accessibility ----------
import { nextFocusIndex, isActivationKey } from '../public/app/focus.js';

test('Tab cycling: wraps at both ends and enters the dialog when focus is outside', () => {
  assert.equal(nextFocusIndex(3, 0, false), 1);
  assert.equal(nextFocusIndex(3, 2, false), 0, 'Tab on the last element goes to the first');
  assert.equal(nextFocusIndex(3, 0, true), 2, 'Shift+Tab on the first goes to the last');
  assert.equal(nextFocusIndex(3, -1, false), 0, 'focus outside: enter at the start');
  assert.equal(nextFocusIndex(3, -1, true), 2);
  assert.equal(nextFocusIndex(0, -1, false), -1, 'nothing focusable');
  assert.equal(nextFocusIndex(1, 0, false), 0);
});

test('custom buttons answer to Enter and Space only', () => {
  assert.ok(isActivationKey('Enter') && isActivationKey(' '));
  assert.ok(!isActivationKey('a') && !isActivationKey('Tab') && !isActivationKey('Escape'));
});

// ---------- threads ----------
import { postUri, threadFromView } from '../public/bsky.js';

test('postUri turns a bsky.app permalink into an AT-URI, and refuses anything else', () => {
  assert.equal(postUri('https://bsky.app/profile/paulvannier.bsky.social/post/3kabc'), 'at://paulvannier.bsky.social/app.bsky.feed.post/3kabc');
  assert.equal(postUri('https://example.com/profile/x/post/1'), null);
  assert.equal(postUri(undefined), null);
});

test('threadFromView: parents oldest first, author follow-ups first, then most liked, blocked posts skipped', () => {
  const T = 'app.bsky.feed.defs#threadViewPost';
  const post = (id, did, likes = 0) => ({
    uri: `at://${did}/app.bsky.feed.post/${id}`, author: { did, handle: `${did}.test` }, likeCount: likes,
    record: { text: id, createdAt: '2026-01-01T00:00:00Z' }, indexedAt: '2026-01-01T00:00:00Z',
  });
  const node = (id, did, likes, replies = [], parent) => ({ $type: T, post: post(id, did, likes), replies, parent });
  const view = {
    thread: node('main', 'did:a', 0, [
      node('popular', 'did:b', 50),
      node('self', 'did:a', 1, [node('self2', 'did:a', 0)]),
      { $type: 'app.bsky.feed.defs#blockedPost', uri: 'x' },
      node('meh', 'did:c', 2),
    ], node('mid', 'did:b', 0, [], node('root', 'did:c', 0))),
  };
  const t = threadFromView(view);
  assert.deepEqual(t.parents.map((p) => p.text), ['root', 'mid']);
  assert.equal(t.item.text, 'main');
  assert.deepEqual(t.replies.map((r) => r.item.text), ['self', 'popular', 'meh']);
  assert.equal(t.replies[0].own, true);
  assert.equal(t.replies[1].own, false);
  assert.deepEqual(t.replies[0].replies.map((r) => r.item.text), ['self2']);
  assert.equal(threadFromView({ thread: { $type: 'app.bsky.feed.defs#notFoundPost' } }), null);
});

// ---------- "Moins de ça" / "Plus de ça" ----------
import { LESS, MORE, emptyPrefs, lessSource, moreSource, lessKeywords, moreKeywords, applyLess, applyMore, keywordsOf } from '../public/rank.js';
import { leadItem, addSaved, removeSaved, isSaved, sanitizeSaved, SAVED_MAX } from '../public/saved.js';

const art = (id, kw = [], source = 's1') => ({ id, kind: 'article', source: { id: source }, keywords: kw, url: 'https://x/' + id, publishedAt: 'd', image: null });
const K = [{ k: 'grev', w: 2, t: 'social' }, { k: 'budget', w: 1, t: 'politique' }];

test('MORE mirrors LESS: inverted factors, ceiling = 1 / floor', () => {
  assert.ok(Math.abs(MORE.sourceFactor * LESS.sourceFactor - 1) < 1e-12);
  assert.ok(Math.abs(MORE.keywordFactor * LESS.keywordFactor - 1) < 1e-12);
  assert.ok(Math.abs(MORE.sourceCeil * LESS.sourceFloor - 1) < 1e-12);
  assert.ok(Math.abs(MORE.keywordCeil * LESS.keywordFloor - 1) < 1e-12);
});

test('moreSource raises the weight up to the ceiling, lessSource lowers it down to the floor', () => {
  const p = emptyPrefs();
  for (let i = 0; i < 20; i++) moreSource(p, 's1');
  assert.ok(Math.abs(p.sources.s1 - MORE.sourceCeil) < 1e-9);
  const q = emptyPrefs();
  for (let i = 0; i < 20; i++) lessSource(q, 's1');
  assert.ok(Math.abs(q.sources.s1 - LESS.sourceFloor) < 1e-9);
});

test('more then less (and the reverse) cancel out: the weight is dropped, not left at 1', () => {
  const p = emptyPrefs();
  moreSource(p, 's1'); lessSource(p, 's1');
  assert.deepEqual(p.sources, {});
  const e = art('a', K);
  lessKeywords(p, e); moreKeywords(p, e);
  assert.deepEqual(p.keywords, {});
});

test('undo restores exactly the previous weights (including "no weight")', () => {
  const p = emptyPrefs();
  p.sources.s1 = 0.5;
  const undo = lessSource(p, 's1');
  assert.equal(p.sources.s1, 0.25);
  undo();
  assert.equal(p.sources.s1, 0.5);
  const e = art('a', K);
  const undoKw = lessKeywords(p, e);
  assert.ok(p.keywords.grev < 1 && p.keywords.budget < 1);
  undoKw();
  assert.deepEqual(p.keywords, {});
  const undoAll = applyMore(p, e);
  assert.equal(p.sources.s1, undefined, '0.5 × 2 is back to the default weight');
  assert.ok(p.keywords.grev > 1);
  undoAll();
  assert.equal(p.sources.s1, 0.5);
  assert.deepEqual(p.keywords, {});
});

test('a group has no single source: applyLess / applyMore only touch keywords', () => {
  const group = { kind: 'group', id: 'g', items: [art('a', K, 's1'), art('b', [K[0]], 's2')] };
  assert.deepEqual(keywordsOf(group).map((k) => k.k), ['grev', 'budget']);
  const p = emptyPrefs();
  applyLess(p, group);
  assert.deepEqual(p.sources, {});
  assert.ok(p.keywords.grev < 1);
  applyMore(p, group); applyMore(p, group);
  assert.ok(p.keywords.grev > 1);
});

test('"more" ranks a source or topic higher, "less" lower', () => {
  const a = { ...art('a', K, 'fav'), publishedAt: new Date().toISOString() };
  const b = { ...art('b', K, 'other'), publishedAt: a.publishedAt };
  const p = emptyPrefs();
  moreSource(p, 'fav');
  const order = rank([b, a], { prefs: p, halfLife: 10 }).map((e) => e.id);
  assert.deepEqual(order, ['a', 'b']);
  const q = emptyPrefs();
  lessSource(q, 'fav');
  assert.deepEqual(rank([a, b], { prefs: q, halfLife: 10 }).map((e) => e.id), ['b', 'a']);
});

test('saved list: most recent first, no duplicate, capped, group saves its lead', () => {
  let list = [];
  list = addSaved(list, art('a'), 1);
  list = addSaved(list, art('b'), 2);
  list = addSaved(list, art('a'), 3);
  assert.deepEqual(list.map((i) => i.id), ['a', 'b']);
  assert.equal(list[0].savedAt, 3);
  assert.ok(isSaved(list, 'b'));
  assert.deepEqual(removeSaved(list, 'a').map((i) => i.id), ['b']);
  let big = [];
  for (let i = 0; i < SAVED_MAX + 20; i++) big = addSaved(big, art('x' + i), i);
  assert.equal(big.length, SAVED_MAX);
  assert.equal(big[0].id, 'x' + (SAVED_MAX + 19));
  const withImage = { ...art('g2'), image: 'https://i/1.jpg' };
  assert.equal(leadItem({ kind: 'group', id: 'g', items: [art('g1'), withImage] }).id, 'g2');
  assert.equal(leadItem(art('p')).id, 'p');
  assert.deepEqual(sanitizeSaved([art('ok'), null, { id: 1 }, { id: 'x', url: 'u' }]).map((i) => i.id), ['ok']);
  assert.deepEqual(sanitizeSaved('garbage'), []);
});

// ---------- Search in the loaded content ----------
import { searchItems, queryTerms } from '../public/find.js';

test('searchItems: accent- and case-insensitive, every word must match, title matches first', () => {
  const items = [
    { id: '1', title: 'Grève à l’Hôpital', text: '', publishedAt: '2026-11-09T10:00:00Z', source: { name: 'A' } },
    { id: '2', title: 'Autre sujet', text: 'Les soignants en GREVE à l’hopital', publishedAt: '2026-11-10T10:00:00Z', source: { name: 'B' } },
    { id: '3', title: 'Budget', text: 'rien', publishedAt: '2026-11-10T10:00:00Z', source: { name: 'C' }, author: 'Hélène Grève' },
    { id: '1', title: 'Grève à l’Hôpital (doublon)', text: '', publishedAt: '2026-11-09T10:00:00Z', source: { name: 'A' } },
  ];
  assert.deepEqual(queryTerms('  Grève  HÔPITAL '), ['greve', 'hopital']);
  const { results, total } = searchItems(items, 'greve hopital');
  assert.deepEqual(results.map((r) => r.id), ['1', '2'], 'title match first, duplicate id once');
  assert.equal(total, 2);
  assert.deepEqual(searchItems(items, 'helene').results.map((r) => r.id), ['3'], 'the author is searched too');
  assert.deepEqual(searchItems(items, 'greve', { limit: 1 }).results.length, 1);
  assert.equal(searchItems(items, 'greve', { limit: 1 }).total, 3);
  assert.deepEqual(searchItems(items, '   ').results, []);
});

// ---------- Install invitation ----------
import { installHint, isIosSafari } from '../public/install.js';

test('installHint: prompt on Android Chrome, instructions on iOS Safari, nothing once installed', () => {
  const iosSafari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  const iosChrome = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1';
  const android = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
  assert.equal(isIosSafari(iosSafari), true);
  assert.equal(isIosSafari(iosChrome), false);
  assert.equal(installHint({ userAgent: android, hasPrompt: true }), 'prompt');
  assert.equal(installHint({ userAgent: android, hasPrompt: false }), null, 'no prompt event: nothing to offer');
  assert.equal(installHint({ userAgent: iosSafari }), 'ios');
  assert.equal(installHint({ userAgent: iosSafari, standalone: true }), null);
  assert.equal(installHint({ userAgent: android, hasPrompt: true, standalone: true }), null);
  assert.equal(installHint(), null);
});
