import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { parseFeed, discoverFeeds, entryToArticle } from '../scripts/lib/rss.mjs';
import { compileTopics, matchKeywords, groupDuplicates } from '../scripts/lib/score.mjs';
import { extractChannelInfo } from '../scripts/lib/youtube.mjs';
import { postToItem } from '../scripts/lib/bluesky.mjs';
import { stripHtml, normalize } from '../scripts/lib/text.mjs';
import { rank, applyLess, itemScore, emptyPrefs, relativeTime } from '../public/rank.js';

const topics = JSON.parse(await fs.readFile(new URL('../config/topics.json', import.meta.url), 'utf8'));
const matchers = compileTopics(topics);
const fixture = (n) => fs.readFile(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');

test('parses RSS 2.0 with media and CDATA', async () => {
  const feed = parseFeed(await fixture('rss2.xml'));
  assert.equal(feed.entries.length, 2);
  const [a] = feed.entries;
  assert.equal(a.title, 'Grève : l’intersyndicale appelle à manifester');
  assert.equal(a.link, 'https://example.org/greve');
  assert.equal(a.image, 'https://example.org/img.jpg');
  assert.match(a.text, /Les syndicats/);
  assert.ok(a.publishedAt.startsWith('2026-11-09'));
  assert.equal(feed.entries[1].image, 'https://example.org/inline.png');
});

test('parses YouTube Atom feed', async () => {
  const feed = parseFeed(await fixture('youtube.xml'));
  assert.equal(feed.entries.length, 1);
  assert.equal(feed.entries[0].raw['yt:videoId'], 'abcdefghijk');
  assert.equal(feed.entries[0].image, 'https://i1.ytimg.com/vi/abcdefghijk/hqdefault.jpg');
});

test('discovers feeds in HTML', () => {
  const html = '<head><link rel="alternate" type="application/rss+xml" href="/feed/"><link rel="alternate" type="application/rss+xml" href="/comments/feed/"></head>';
  assert.deepEqual(discoverFeeds(html, 'https://site.fr/'), ['https://site.fr/feed/']);
});

test('article conversion produces stable ids', () => {
  const entry = { guid: 'x', link: 'https://a', title: 'T', text: 'body', image: null, publishedAt: '2026-01-01T00:00:00.000Z' };
  const a1 = entryToArticle(entry, { id: 's', name: 'S' });
  const a2 = entryToArticle(entry, { id: 's', name: 'S' });
  assert.equal(a1.id, a2.id);
  assert.equal(a1.kind, 'article');
});

test('keyword matching is accent/case insensitive, with prefixes and word boundaries', () => {
  const kws = matchKeywords('GRÉVISTES devant l’Assemblée nationale contre le 49.3', matchers).map((k) => k.k);
  assert.ok(kws.includes('grev'));
  assert.ok(kws.includes('assemblee nationale'));
  assert.ok(kws.includes('49.3'));
  assert.ok(!matchKeywords('la fortune des fourmis', matchers).some((k) => k.k === 'fo'));
  assert.ok(matchKeywords('Le gaz lacrymogène', matchers).some((k) => k.k === 'gaz lacrymogene'));
});

test('groups duplicate stories across sources only', () => {
  const now = Date.now();
  const mk = (id, src, title, minAgo) => ({ id, kind: 'article', source: { id: src }, title, publishedAt: new Date(now - minAgo * 60e3).toISOString() });
  const entries = groupDuplicates([
    mk('1', 'a', 'Retraites : l’intersyndicale appelle à une nouvelle journée de grève jeudi', 10),
    mk('2', 'b', 'Nouvelle journée de grève jeudi, l’intersyndicale appelle à la mobilisation retraites', 30),
    mk('3', 'a', 'Retraites : l’intersyndicale appelle à une journée de grève jeudi prochain', 40),
    mk('4', 'c', 'Un festival de cinéma s’ouvre ce week-end', 20),
  ], topics.dedup);
  const group = entries.find((e) => e.kind === 'group');
  assert.ok(group);
  assert.equal(new Set(group.items.map((i) => i.source.id)).size, group.items.length);
  assert.ok(entries.some((e) => e.id === '4'));
});

test('extracts YouTube channel id from page', () => {
  const html = '<link rel="canonical" href="https://www.youtube.com/channel/UCeQRERCvEY3-ZeQONwnx0zw"><meta property="og:image" content="https://yt3.ggpht.com/a.jpg">';
  assert.deepEqual(extractChannelInfo(html).id, 'UCeQRERCvEY3-ZeQONwnx0zw');
});

test('converts Bluesky posts, detecting video embeds', () => {
  const base = {
    uri: 'at://did:plc:abc123/app.bsky.feed.post/3kxyz',
    author: { did: 'did:plc:abc123', handle: 'x.bsky.social', displayName: 'X' },
    record: { text: 'Manif ! #manif', createdAt: '2026-11-09T10:00:00.000Z' },
    indexedAt: '2026-11-09T10:00:01.000Z',
  };
  const post = postToItem(base);
  assert.equal(post.kind, 'post');
  assert.equal(post.url, 'https://bsky.app/profile/x.bsky.social/post/3kxyz');
  const video = postToItem({ ...base, embed: { $type: 'app.bsky.embed.video#view', playlist: 'https://v/p.m3u8', thumbnail: 'https://v/t.jpg', aspectRatio: { width: 9, height: 16 } } });
  assert.equal(video.kind, 'video');
  assert.equal(video.video.type, 'hls');
  assert.equal(video.video.src, 'https://v/p.m3u8');
});

test('ranking favours topics and freshness; "moins de ça" demotes', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');
  const item = (id, src, kw, hoursAgo) => ({ id, source: { id: src }, keywords: kw, publishedAt: new Date(now - hoursAgo * 3600e3).toISOString() });
  const greve = [{ k: 'grev', w: 2.5, t: 'social' }];
  const a = item('a', 's1', greve, 1);
  const b = item('b', 's2', [], 1);
  const c = item('c', 's3', greve, 20);
  const prefs = emptyPrefs();
  const opts = { now, halfLife: 6, cap: 6, prefs };
  assert.deepEqual(rank([b, c, a], opts).map((e) => e.id), ['a', 'b', 'c']);

  const before = itemScore(a, opts);
  applyLess(prefs, a);
  assert.ok(itemScore(a, opts) < before * 0.5);
  // Floors: repeated "less" never zeroes a source.
  for (let i = 0; i < 20; i++) applyLess(prefs, a);
  assert.ok(prefs.sources.s1 >= 0.1 && prefs.keywords.grev >= 0.2);
  assert.deepEqual(rank([a, b], opts, new Set(['a'])).map((e) => e.id), ['b']);
});

test('helpers', () => {
  assert.equal(stripHtml('<p>Hello&nbsp;<b>world</b> &amp; co</p>'), 'Hello world & co');
  assert.equal(normalize('Élysée’s'), "elysee's");
  const now = Date.parse('2026-11-09T12:00:00Z');
  assert.equal(relativeTime('2026-11-09T11:58:00Z', now), '2 min');
  assert.equal(relativeTime('2026-11-09T09:00:00Z', now), '3 h');
});
