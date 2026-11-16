// Items kept between runs, URL duplicates, Bluesky relays of an outlet's own articles,
// and the pause after a failed feed discovery.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ItemArchive, publicItem } from '../scripts/lib/archive.mjs';
import { markRelays } from '../scripts/lib/score.mjs';
import { canonicalUrl, hostOf } from '../public/url.js';
import { ResolutionCache } from '../scripts/lib/cache.mjs';
import { fetchSourceFeed } from '../scripts/lib/rss.mjs';
import { state, entriesFor } from '../public/app/store.js';

const H = 3600e3;
const T0 = Date.parse('2026-11-16T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const art = (id, origin, publishedAt, extra = {}) => ({ id, kind: 'article', url: `https://ex.fr/${id}`, publishedAt, _origin: origin, source: { id: origin.split(':')[1] }, ...extra });

test('archive: an article that left its feed stays for the whole window, then expires', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'arch-'));
  const file = path.join(dir, 'items.json');
  const origins = new Set(['media:a']);
  let now = T0;
  let a = new ItemArchive(file, { now: () => now });
  await a.load();
  const run1 = a.merge('actus', [art('x', 'media:a', iso(T0 - H)), art('y', 'media:a', iso(T0 - 2 * H))], { maxAgeHours: 72, origins });
  a.set('actus', run1);
  await a.save();

  // Six hours later the feed only lists a new article: x and y are still published.
  now = T0 + 6 * H;
  a = new ItemArchive(file, { now: () => now });
  await a.load();
  assert.equal(a.loaded, true);
  const run2 = a.merge('actus', [art('z', 'media:a', iso(now - H)), art('x', 'media:a', iso(T0 - H), { text: 'mis à jour' })], { maxAgeHours: 72, origins });
  assert.deepEqual(run2.map((i) => i.id), ['z', 'x', 'y'], 'fresh items first, archived ones after');
  assert.equal(run2.find((i) => i.id === 'x').text, 'mis à jour', 'the fresh copy wins');
  a.set('actus', run2);

  // Past the window, y (published at T0 - 2 h) is purged.
  now = T0 + 71 * H;
  const run3 = a.merge('actus', [], { maxAgeHours: 72, origins });
  assert.deepEqual(run3.map((i) => i.id).sort(), ['x', 'z']);
});

test('archive: removing a source from the config removes its archived items at once', () => {
  const a = new ItemArchive('/nonexistent', { now: () => T0 });
  a.set('actus', [art('x', 'media:a', iso(T0)), art('y', 'media:gone', iso(T0)), { ...art('v', 'tag:#manif', iso(T0)) }]);
  const out = a.merge('actus', [], { maxAgeHours: 72, origins: new Set(['media:a', 'tag:#manif']) });
  assert.deepEqual(out.map((i) => i.id), ['x', 'v']);
});

test('archive: an undated entry is dated when first seen, except the ones already there before the archive', () => {
  let now = T0;
  const a = new ItemArchive('/nonexistent', { now: () => now });
  const old = art('old', 'media:a', null);
  a.merge('actus', [old], { maxAgeHours: 72 });
  assert.equal(old.publishedAt, null, 'first run ever: its real date is unknown, it is not shown as new');
  a.set('actus', []);
  a.loaded = true; // what the next run's load() gives
  now = T0 + 3 * H;
  const again = art('old', 'media:a', null);
  const fresh = art('new', 'media:a', null);
  a.merge('actus', [again, fresh], { maxAgeHours: 72 });
  assert.equal(again.publishedAt, null);
  assert.equal(fresh.publishedAt, iso(now));
});

test('archive: collector-only fields never reach the public data', () => {
  const out = publicItem({ id: 'x', _origin: 'media:a', _sameAs: 'b', title: 't' });
  assert.deepEqual(out, { id: 'x', title: 't' });
});

test('canonicalUrl: tracking parameters, www, fragment and trailing slash do not make a new page', () => {
  const k = canonicalUrl('https://www.mediapart.fr/journal/france/1?utm_source=rss&utm_medium=x#top');
  assert.equal(k, 'https://mediapart.fr/journal/france/1');
  assert.equal(canonicalUrl('http://mediapart.fr/journal/france/1/'), k);
  assert.equal(canonicalUrl('https://ex.fr/a?b=2&a=1&xtor=RSS'), canonicalUrl('https://ex.fr/a?a=1&b=2'));
  assert.notEqual(canonicalUrl('https://ex.fr/a?id=1'), canonicalUrl('https://ex.fr/a?id=2'));
  assert.equal(canonicalUrl('javascript:alert(1)'), null);
  assert.equal(hostOf('https://www.Blast-Info.fr/x'), 'blast-info.fr');
});

const post = (id, handle, link, extra = {}) => ({
  id, kind: 'post', platform: 'bluesky', url: `https://bsky.app/profile/${handle}/post/${id}`,
  source: { id: 'bsky:' + handle, handle }, external: { url: link, title: '', thumb: 'https://cdn.bsky.app/t.jpg', description: 'Chapô' }, ...extra,
});

test('markRelays: the outlet\'s own Bluesky post points to its article; other people sharing it do not', () => {
  const a1 = { id: 'a1', kind: 'article', url: 'https://www.mediapart.fr/journal/1', source: { id: 'mediapart', url: 'https://www.mediapart.fr' }, image: null, text: '' };
  const a2 = { id: 'a2', kind: 'article', url: 'https://www.lemediatv.fr/articles/2', source: { id: 'lemedia', url: 'https://www.lemediatv.fr' }, image: 'https://x/i.jpg', text: 'Texte' };
  const a3 = { id: 'a3', kind: 'article', url: 'https://factuel.afp.com/doc/3', source: { id: 'afpfactuel', url: 'https://factuel.afp.com' } };
  const own = post('p1', 'mediapart.fr', 'https://mediapart.fr/journal/1?utm_source=bluesky');
  const sameAs = post('p2', 'lemediatv.bsky.social', 'https://www.lemediatv.fr/articles/2', { _sameAs: 'lemedia' });
  const afp = post('p3', 'afp.com', 'https://factuel.afp.com/doc/3');
  const commentary = post('p4', 'quelquun.bsky.social', 'https://www.mediapart.fr/journal/1');
  markRelays([a1, a2, a3, own, sameAs, afp, commentary]);
  assert.equal(own.relayOf, 'a1');
  assert.equal(sameAs.relayOf, 'a2');
  assert.equal(afp.relayOf, 'a3');
  assert.equal(commentary.relayOf, undefined);
  assert.equal(a1.image, 'https://cdn.bsky.app/t.jpg', 'the article borrows the card image when its feed has none');
  assert.equal(a1.text, 'Chapô');
  assert.equal(a2.image, 'https://x/i.jpg', 'an existing image is kept');
});

test('app: a relay is hidden only when its article is shown', () => {
  state.follows = { followed: new Set(), unfollowed: new Set(), live: {} };
  state.accounts = new Map([
    ['mediapart', { id: 'mediapart', kind: 'media', suggested: false }],
    ['bsky:mediapart.fr', { id: 'bsky:mediapart.fr', kind: 'bluesky', suggested: true }],
  ]);
  state.live.actus = [];
  const article = { id: 'a1', kind: 'article', source: { id: 'mediapart' } };
  const relay = { id: 'p1', kind: 'post', relayOf: 'a1', source: { id: 'bsky:mediapart.fr' } };
  const other = { id: 'p2', kind: 'post', source: { id: 'bsky:mediapart.fr' } };
  state.data.actus = { entries: [article, relay, other] };
  state.follows.followed.add('bsky:mediapart.fr');
  assert.deepEqual(entriesFor('actus').map((e) => e.id), ['a1', 'p2'], 'both followed: the article only');
  state.follows.followed.delete('mediapart');
  state.follows.unfollowed.add('mediapart');
  assert.deepEqual(entriesFor('actus').map((e) => e.id), ['p1', 'p2'], 'only the Bluesky account followed: the post stays');
  state.data.actus = { entries: [{ kind: 'group', id: 'g', items: [article, { id: 'b1', kind: 'article', source: { id: 'other' } }] }, relay] };
  state.follows.unfollowed.delete('mediapart');
  assert.deepEqual(entriesFor('actus').map((e) => e.id), ['g'], 'an article inside a group counts as shown');
});

test('feeds: after a failed discovery the site is not searched again for a day', async () => {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => { calls.push(String(url)); return new Response('nope', { status: 404 }); };
  try {
    let now = T0;
    const cache = new ResolutionCache('/nonexistent/x.json', { now: () => now });
    const source = { id: 'dead', name: 'Dead', site: 'https://dead.example/' };
    await assert.rejects(fetchSourceFeed(source, { cache }), /Aucun flux valide trouvé/);
    const first = calls.length;
    assert.ok(first > 5, 'the first failure tries the site and the usual paths');
    await assert.rejects(fetchSourceFeed(source, { cache }), /nouvel essai sous 24 h/);
    assert.equal(calls.length, first, 'no request at all during the pause');
    now += 25 * H;
    await assert.rejects(fetchSourceFeed(source, { cache }), /Aucun flux valide trouvé/);
    assert.ok(calls.length > first, 'searched again after a day');
  } finally { globalThis.fetch = real; }
});

test('feeds: an outage does not make a source forget its remembered feed URL', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); };
  try {
    const cache = new ResolutionCache('/nonexistent/x.json');
    cache.set('feed:s', 'https://s.fr/custom.xml', 3600e3);
    await assert.rejects(fetchSourceFeed({ id: 's', name: 'S', site: 'https://s.fr/' }, { cache }));
    assert.equal(cache.get('feed:s'), 'https://s.fr/custom.xml');
    assert.equal(cache.get('feedfail:s'), true);
    cache.deletePrefix('feedfail:'); // what a rejected run does
    assert.equal(cache.get('feedfail:s'), undefined);
    assert.equal(cache.get('feed:s'), 'https://s.fr/custom.xml');
  } finally { globalThis.fetch = real; }
});
