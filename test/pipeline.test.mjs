import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { parseFeed, discoverFeeds, entryToArticle } from '../scripts/lib/rss.mjs';
import { compileTopics, matchKeywords, groupDuplicates } from '../scripts/lib/score.mjs';
import { extractChannelInfo } from '../scripts/lib/youtube.mjs';
import { postToItem, textSegments } from '../scripts/lib/bluesky.mjs';
import { stripHtml, normalize } from '../scripts/lib/text.mjs';
import { rank, applyLess, itemScore, emptyPrefs, relativeTime, diversify, seenCount } from '../public/rank.js';

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

// Small seeded PRNG for reproducible "random" tests.
function rng(seed) { // mulberry32
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('"pour toi" mode: order changes between refreshes but favours high scores', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');
  const mk = (i, w) => ({ id: 'i' + i, source: { id: 's' + i }, keywords: w ? [{ k: 'k', w, t: 'social' }] : [], publishedAt: new Date(now - 3600e3).toISOString() });
  const entries = [mk(0, 5), ...Array.from({ length: 19 }, (_, i) => mk(i + 1, 0))];
  const orders = new Set();
  let topFirst = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const r = rank(entries, { now, halfLife: 10, random: rng(seed) });
    orders.add(r.map((e) => e.id).join());
    if (r.slice(0, 3).some((e) => e.id === 'i0')) topFirst++;
  }
  assert.ok(orders.size > 150, 'orders should vary');
  // Uniform chance of being in the top 3 of 20 is 15% (30/200): it must clearly beat that,
  // without dominating every refresh.
  assert.ok(topFirst > 45 && topFirst < 160, `high-score item should often, not always, be near the top (${topFirst}/200)`);
});

test('seen items are pushed down', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');
  const mk = (id) => ({ id, source: { id }, keywords: [], publishedAt: new Date(now).toISOString() });
  const r = rank([mk('a'), mk('b')], { now, seen: new Set(['a']) });
  assert.deepEqual(r.map((e) => e.id), ['b', 'a']);
});

test('diversify avoids the same source back to back', () => {
  const e = (id, src) => ({ id, source: { id: src } });
  const out = diversify([e(1, 'a'), e(2, 'a'), e(3, 'a'), e(4, 'b'), e(5, 'c')]);
  for (let i = 1; i < 3; i++) assert.notEqual(out[i].source.id, out[i - 1].source.id);
  assert.equal(out.length, 5);
});

test('Bluesky facets become link segments (UTF-8 byte offsets)', () => {
  const text = 'Grève ! voir lemonde.fr/x… #manif';
  const b = (sub) => Buffer.byteLength(text.slice(0, text.indexOf(sub)), 'utf8');
  const segs = textSegments({
    text,
    facets: [
      { index: { byteStart: b('lemonde'), byteEnd: b(' #manif') }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://lemonde.fr/x/long' }] },
      { index: { byteStart: b('#manif'), byteEnd: Buffer.byteLength(text) }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'manif' }] },
    ],
  });
  assert.equal(segs.map((s) => s.t).join(''), text);
  assert.equal(segs[1].t, 'lemonde.fr/x…');
  assert.equal(segs[1].href, 'https://lemonde.fr/x/long');
  assert.equal(segs[3].href, 'https://bsky.app/hashtag/manif');
});

test('repeated impressions push items further down; groups count member impressions', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');
  const mk = (id, w) => ({ id, source: { id }, keywords: w ? [{ k: 'grev', w, t: 'social' }] : [], publishedAt: new Date(now).toISOString() });
  const hot = mk('hot', 6);
  const plain = mk('plain', 0);
  // Unseen, the hot post wins; once seen, an unseen plain post goes above it.
  assert.deepEqual(rank([plain, hot], { now }).map((e) => e.id), ['hot', 'plain']);
  assert.deepEqual(rank([plain, hot], { now, seen: new Map([['hot', 1]]) }).map((e) => e.id), ['plain', 'hot']);
  // Each extra impression pushes it further.
  const s1 = rank([hot], { now, seen: new Map([['hot', 1]]) });
  assert.ok(s1.length === 1);
  const group = { kind: 'group', id: 'g-new', items: [mk('a1', 0), mk('a2', 0)] };
  assert.equal(seenCount(group, new Map([['a2', 2]])), 2);
});

test('posts published since the last visit get a boost', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');
  const mk = (id, minAgo, w) => ({ id, source: { id }, keywords: w ? [{ k: 'grev', w, t: 'social' }] : [], publishedAt: new Date(now - minAgo * 60e3).toISOString() });
  const lastVisit = now - 30 * 60e3;
  // 'old' has a topic and would win; 'new' was published after the last visit.
  const old = mk('old', 35, 1);
  const fresh = mk('new', 25, 0);
  assert.equal(rank([fresh, old], { now, halfLife: 10 })[0].id, 'old');
  assert.equal(rank([fresh, old], { now, halfLife: 10, lastVisit })[0].id, 'new');
});

// ---------- RSS author, categories, source flags ----------
import { cleanAuthor, categoriesOf } from '../scripts/lib/rss.mjs';

test('cleanAuthor: names are kept, bare e-mails dropped, « email (Name) » unwrapped', () => {
  assert.equal(cleanAuthor('Jean Dupont'), 'Jean Dupont');
  assert.equal(cleanAuthor('redac@journal.fr (Jean Dupont)'), 'Jean Dupont');
  assert.equal(cleanAuthor('Jean Dupont <redac@journal.fr>'), 'Jean Dupont');
  assert.equal(cleanAuthor('redac@journal.fr'), '');
  assert.equal(cleanAuthor(''), '');
  assert.equal(cleanAuthor(undefined), '');
});

test('parseFeed + entryToArticle keep the author and the categories (RSS and Atom)', () => {
  const rss = `<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>J</title>
    <item><title>Titre</title><link>https://j.fr/a</link><dc:creator>Marie Curie</dc:creator>
      <category>Politique</category><category><![CDATA[Société]]></category><category>Politique</category>
      <pubDate>Mon, 09 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
  const [e] = parseFeed(rss).entries;
  assert.deepEqual(e.categories, ['Politique', 'Société']);
  const a = entryToArticle(e, { id: 'j', name: 'J' });
  assert.equal(a.author, 'Marie Curie');
  assert.deepEqual(a.categories, ['Politique', 'Société']);

  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>A</title><entry><title>T</title><id>1</id>
    <link rel="alternate" href="https://a.fr/1"/><author><name>Ada L.</name></author>
    <category term="ia"/><category term="dev" label="Dev"/><updated>2026-11-09T10:00:00Z</updated></entry></feed>`;
  const [e2] = parseFeed(atom).entries;
  const a2 = entryToArticle(e2, { id: 'a', name: 'A' });
  assert.equal(a2.author, 'Ada L.');
  assert.deepEqual(a2.categories, ['ia', 'dev']);
  assert.deepEqual(categoriesOf({}), []);
});

test('an article without author nor category has neither field; source flags are optional', () => {
  const entry = { guid: 'x', link: 'https://a.fr/x', title: 'T', text: '', author: 'a@b.fr', categories: [], publishedAt: '2026-01-01T00:00:00.000Z' };
  const plain = entryToArticle(entry, { id: 's', name: 'S' });
  assert.ok(!('author' in plain) && !('categories' in plain));
  assert.ok(!('paywall' in plain.source) && !('lang' in plain.source));
  const flagged = entryToArticle(entry, { id: 's', name: 'S', paywall: true, lang: 'en' });
  assert.equal(flagged.source.paywall, true);
  assert.equal(flagged.source.lang, 'en');
  assert.ok(!('lang' in entryToArticle(entry, { id: 's', name: 'S', lang: 'fr' }).source), 'French is the default: no flag');
});

test('YouTube feed: the description of media:group reaches the item text', async () => {
  const feed = parseFeed(await fixture('youtube.xml'));
  assert.equal(feed.entries[0].text, 'Description');
});
