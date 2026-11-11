// The browser and the collector must produce the same data for the same input: both now
// import the same isomorphic modules (public/topics.js, public/bskypost.js), and these
// tests keep it that way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as collectorScore from '../scripts/lib/score.mjs';
import * as collectorBsky from '../scripts/lib/bluesky.mjs';
import * as shared from '../public/topics.js';
import * as sharedPost from '../public/bskypost.js';
import { postToLiveItem } from '../public/bsky.js';

const topics = JSON.parse(await fs.readFile(new URL('../config/topics.json', import.meta.url), 'utf8'));

test('topics: collector and browser use the very same matcher', () => {
  assert.equal(collectorScore.compileTopics, shared.compileTopics);
  assert.equal(collectorScore.matchKeywords, shared.matchKeywords);
  const corpus = ['GRÉVISTES devant l’Assemblée nationale contre le 49.3', 'Le gaz lacrymogène', 'un chat', 'Intelligence artificielle et open-source'];
  for (const feed of ['actus', 'tech']) {
    const m = shared.compileTopics(topics, feed);
    assert.ok(m.length > 0);
    for (const text of corpus) {
      const kws = shared.matchKeywords(text, m);
      assert.deepEqual(collectorScore.annotate({ title: text, text: '' }, m).keywords, kws);
      for (const k of kws) assert.deepEqual(Object.keys(k).sort(), ['k', 't', 'w']);
    }
  }
  // Every keyword of the config can match itself (so the regex builder is not broken for any entry).
  for (const m of shared.compileTopics(topics, 'actus')) {
    const probe = m.k.replace(/\*$/, '');
    assert.ok(shared.matchKeywords(` ${probe} `, [m]).length === 1, m.k);
  }
});

test('Bluesky conversion code is shared, not duplicated', () => {
  assert.equal(collectorBsky.postToItem, sharedPost.postToItem);
  assert.equal(collectorBsky.textSegments, sharedPost.textSegments);
});

const did = 'did:plc:abc123';
const author = { did, handle: 'x.bsky.social', displayName: 'X', avatar: 'https://cdn/a.jpg' };
const base = (record = {}, embed) => ({
  uri: `at://${did}/app.bsky.feed.post/3kxyz`, author, indexedAt: '2026-11-09T10:00:01.000Z',
  record: { text: 'Manif ! #manif', createdAt: '2026-11-09T10:00:00.000Z', ...record }, embed,
  likeCount: 3, repostCount: 2, quoteCount: 1, replyCount: 4,
});
const longText = 'mot '.repeat(300);
const quoted = (embeds) => ({ uri: `at://did:plc:other/app.bsky.feed.post/3kq`, author: { handle: 'q.bsky.social', displayName: 'Q' }, value: { text: longText, createdAt: '2026-11-09T09:00:00.000Z' }, embeds });
const text = 'Grève ! voir lemonde.fr/x… #manif';
const b = (sub) => new TextEncoder().encode(text.slice(0, text.indexOf(sub))).length;
const fixtures = {
  plain: base(),
  images: base({}, { $type: 'app.bsky.embed.images#view', images: [{ thumb: 'https://t/1', fullsize: 'https://f/1', alt: 'a', aspectRatio: { width: 4, height: 3 } }, { thumb: 'https://t/2', fullsize: 'https://f/2' }] }),
  video: base({}, { $type: 'app.bsky.embed.video#view', playlist: 'https://v/p.m3u8', thumbnail: 'https://v/t.jpg', aspectRatio: { width: 9, height: 16 } }),
  external: base({}, { $type: 'app.bsky.embed.external#view', external: { uri: 'https://e/x', title: 'T', description: 'd '.repeat(200), thumb: 'https://e/t.jpg' } }),
  quote: base({}, { $type: 'app.bsky.embed.record#view', record: quoted([{ $type: 'app.bsky.embed.images#view', images: [{ thumb: 'https://t/q', fullsize: 'https://f/q' }] }]) }),
  quoteWithMedia: base({}, { $type: 'app.bsky.embed.recordWithMedia#view', media: { $type: 'app.bsky.embed.images#view', images: [{ thumb: 'https://t/m', fullsize: 'https://f/m' }] }, record: { record: quoted([]) } }),
  blockedQuote: base({}, { $type: 'app.bsky.embed.record#view', record: { $type: 'app.bsky.embed.record#viewBlocked', uri: 'at://x/y/z' } }),
  facets: base({
    text,
    facets: [
      { index: { byteStart: b('lemonde'), byteEnd: b(' #manif') }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://lemonde.fr/x/long' }] },
      { index: { byteStart: b('#manif'), byteEnd: new TextEncoder().encode(text).length }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'manif' }] },
      { index: { byteStart: 0, byteEnd: 3 }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'javascript:alert(1)' }] },
      { index: { byteStart: 'x', byteEnd: 9 }, features: [{ $type: 'app.bsky.richtext.facet#mention', did }] },
      { index: { byteStart: 2.5, byteEnd: 9 }, features: [{ $type: 'app.bsky.richtext.facet#mention', did }] },
    ],
  }),
};

test('parity: the app turns any PostView into exactly what the collector would', () => {
  for (const [name, post] of Object.entries(fixtures)) {
    const fromCollector = collectorBsky.postToItem(post);
    const fromApp = postToLiveItem(post);
    // Only the intended differences: live follows are always text posts, flagged `live`.
    assert.equal(fromApp.kind, 'post', name);
    assert.equal(fromApp.source.live, true);
    const { kind: _k1, source: _s1, ...a } = fromCollector;
    const { kind: _k2, source: _s2, ...bb } = fromApp;
    assert.deepEqual(bb, a, name);
    assert.deepEqual({ ...fromApp.source, live: undefined }, { ...fromCollector.source, live: undefined }, `${name} source`);
  }
});

test('parity: quotes carry an image and are truncated; facets are filtered strictly', () => {
  const q = postToLiveItem(fixtures.quote).quote;
  assert.equal(q.image, 'https://t/q');
  assert.ok(q.text.length <= 401 && q.text.endsWith('…'));
  assert.equal(postToLiveItem(fixtures.quoteWithMedia).quote.text.length <= 401, true);
  assert.equal(postToLiveItem(fixtures.blockedQuote).quote, undefined);
  assert.ok(postToLiveItem(fixtures.external).external.description.length <= 201);

  const segs = postToLiveItem(fixtures.facets).segments;
  assert.equal(segs.map((s) => s.t).join(''), text);
  assert.deepEqual(segs.filter((s) => s.href).map((s) => s.href), ['https://lemonde.fr/x/long', 'https://bsky.app/hashtag/manif']);
});
