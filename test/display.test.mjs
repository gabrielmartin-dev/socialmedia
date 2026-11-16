// What the collector hands the app for display: pictures, summaries, Bluesky accounts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSummary } from '../scripts/lib/text.mjs';
import { parseFeed, firstImgInHtml, entryToArticle } from '../scripts/lib/rss.mjs';
import { parseHeadMeta, enrichArticles } from '../scripts/lib/enrich.mjs';
import { ResolutionCache } from '../scripts/lib/cache.mjs';
import { authorPosts } from '../scripts/lib/bluesky.mjs';
import { quality } from '../scripts/lib/quality.mjs';

test('cleanSummary: feed boilerplate goes, the summary stays', () => {
  assert.equal(cleanSummary('Grève reconduite à la SNCF. The post Grève à la SNCF appeared first on Rapports de Force.'), 'Grève reconduite à la SNCF.');
  assert.equal(cleanSummary('Le texte du chapô. L’article Titre est apparu en premier sur Contre Attaque.'), 'Le texte du chapô.');
  assert.equal(cleanSummary('Un début de texte […]'), 'Un début de texte…');
  assert.equal(cleanSummary('Un début de texte… Lire la suite'), 'Un début de texte…');
  assert.equal(cleanSummary('Something happened. Continue reading →'), 'Something happened.');
  assert.equal(cleanSummary('Article URL: https://x.dev/a Comments URL: https://news.ycombinator.com/item?id=1 Points: 120 # Comments: 40'), '');
  assert.equal(cleanSummary('Mon titre', 'Mon titre'), '', 'a summary that is only the title');
  assert.equal(cleanSummary('Mon titre d’article : et voici le vrai chapô, assez long pour rester.', 'Mon titre d’article'), 'et voici le vrai chapô, assez long pour rester.');
  assert.equal(cleanSummary('Il a dit « non »'), 'Il a dit « non »', 'a closing quote is not boilerplate');
  assert.equal(cleanSummary('Lire la suite des événements demain : la réforme passe au Sénat, où la droite est majoritaire et où le texte sera durci.'),
    'Lire la suite des événements demain : la réforme passe au Sénat, où la droite est majoritaire et où le texte sera durci.', 'only a trailing « read more » is removed');
});

test('firstImgInHtml: skips pixels and tiny images, reads lazy-loaded sources', () => {
  const html = `<img src="https://feeds.feedburner.com/~r/x/~4/abc" width="1" height="1">
    <img src="https://s.w.org/images/core/emoji/14.0.0/72x72/1f600.png">
    <img src="data:image/gif;base64,R0lGOD" data-src="https://site.fr/photo.jpg" width="800">`;
  assert.equal(firstImgInHtml(html), 'https://site.fr/photo.jpg');
  assert.equal(firstImgInHtml('<img srcset="https://a.fr/s.jpg 320w, https://a.fr/l.jpg 1024w">'), 'https://a.fr/l.jpg');
  assert.equal(firstImgInHtml('<img src="https://secure.gravatar.com/avatar/abc">'), null);
});

test('feed images: the widest media:content wins', () => {
  const xml = `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>T</title>
    <item><title>Un titre</title><link>https://ex.fr/a</link><pubDate>Mon, 16 Nov 2026 10:00:00 GMT</pubDate>
      <media:content url="https://ex.fr/small.jpg" medium="image" width="150"/>
      <media:content url="https://ex.fr/big.jpg" medium="image" width="1200"/>
      <description>Résumé. The post Un titre appeared first on Ex.</description></item></channel></rss>`;
  const [e] = parseFeed(xml).entries;
  assert.equal(e.image, 'https://ex.fr/big.jpg');
  const a = entryToArticle(e, { id: 's', name: 'S', site: 'https://ex.fr' });
  assert.equal(a.text, 'Résumé.');
});

test('parseHeadMeta: og:image (relative too), description, junk ignored', () => {
  const html = `<html><head><meta content="/img/une.jpg" property="og:image"><meta name="description" content="Le chapô &amp; la suite"></head><body><meta property="og:image" content="https://late/x.jpg"></body>`;
  assert.deepEqual(parseHeadMeta(html, 'https://www.site.fr/article/1'), { image: 'https://www.site.fr/img/une.jpg', description: 'Le chapô & la suite' });
  assert.equal(parseHeadMeta('<head><meta property="og:image" content="https://secure.gravatar.com/avatar/1"></head>', 'https://a.fr').image, null);
});

test('enrichArticles: fetches only articles without picture, within budget, remembers every answer', async () => {
  const cache = new ResolutionCache('/nonexistent/x.json');
  const pages = [];
  const fetchPage = async (url) => {
    pages.push(url);
    if (url.endsWith('/err')) throw new Error('HTTP 403');
    return { html: `<head><meta property="og:image" content="${url}.jpg"><meta property="og:description" content="Desc"></head>`, url };
  };
  const mk = (id, h, extra = {}) => ({ id, kind: 'article', url: `https://ex.fr/${id}`, title: 'T', text: '', image: null, publishedAt: new Date(Date.UTC(2026, 10, 16, h)).toISOString(), ...extra });
  const items = [mk('old', 1), mk('new', 9), mk('err', 5), mk('has', 8, { image: 'https://x/y.jpg' }), { id: 'p', kind: 'post', url: 'https://bsky.app/p' }];
  const s1 = await enrichArticles(items, { cache, maxFetches: 2, fetchPage });
  assert.deepEqual(pages, ['https://ex.fr/new', 'https://ex.fr/err'], 'newest first, within the budget');
  assert.equal(items[1].image, 'https://ex.fr/new.jpg');
  assert.equal(items[1].text, 'Desc');
  assert.equal(items[0].image, null, 'over budget: next run');
  assert.deepEqual(s1, { fromCache: 0, fetched: 2, found: 1 });

  pages.length = 0;
  const again = [mk('old', 1), mk('new', 9), mk('err', 5)];
  await enrichArticles(again, { cache, maxFetches: 5, fetchPage });
  assert.deepEqual(pages, ['https://ex.fr/old'], 'cached answers (found or failed) are not fetched again');
  assert.equal(again[1].image, 'https://ex.fr/new.jpg');
  assert.equal(again[2].image, null);
});

test('authorPosts: reads more pages when reposts leave too few own posts', async () => {
  const now = Date.now();
  const post = (n, repost = false) => ({
    ...(repost ? { reason: { $type: 'app.bsky.feed.defs#reasonRepost' } } : {}),
    post: { uri: `at://did:plc:abc/app.bsky.feed.post/${n}`, author: { handle: 'a.bsky.social', did: 'did:plc:abc' }, record: { text: 't' + n, createdAt: new Date(now - n * 60e3).toISOString() }, indexedAt: new Date(now - n * 60e3).toISOString() },
  });
  const pages = [
    { feed: [post(1), post(2, true), post(3, true)], cursor: 'c1' },
    { feed: [post(4, true), post(5)], cursor: 'c2' },
    { feed: [post(6)], cursor: 'c3' },
    { feed: [post(7)], cursor: 'c4' },
  ];
  const calls = [];
  const client = { call: async (m, p) => { calls.push(p.cursor); return pages[calls.length - 1]; } };
  const items = await authorPosts(client, { did: 'did:plc:abc' }, 3);
  assert.deepEqual(items.map((i) => i.text), ['t1', 't5', 't6']);
  assert.deepEqual(calls, [undefined, 'c1', 'c2']);
  calls.length = 0;
  await authorPosts(client, { did: 'did:plc:abc' }, 3, { sinceMs: now + 1 });
  assert.equal(calls.length, 1, 'no further page when the first one already reaches before the window');
});

test('quality: share of pictures, average summary, undated entries', () => {
  assert.deepEqual(quality([{ image: 'x', text: 'abcd', publishedAt: 'x' }, { image: null, text: '', publishedAt: null }]), { withImage: 50, avgText: 2, undated: 1 });
  assert.deepEqual(quality([]), { withImage: 0, avgText: 0, undated: 0 });
});

test('resolveShortLinks: an outlet\'s short link is followed once, then matches its article', async () => {
  const { resolveShortLinks, looksShort } = await import('../scripts/lib/enrich.mjs');
  const { markRelays } = await import('../scripts/lib/score.mjs');
  assert.equal(looksShort('https://l.mediapart.fr/kuR'), true);
  assert.equal(looksShort('https://www.mediapart.fr/journal/france/161126/un-titre'), false);
  const cache = new ResolutionCache('/nonexistent/x.json');
  const followed = [];
  const follow = async (u) => { followed.push(u); return 'https://www.mediapart.fr/journal/france/161126/un-titre?utm_source=bluesky'; };
  const mk = () => [
    { id: 'a1', kind: 'article', url: 'https://www.mediapart.fr/journal/france/161126/un-titre', source: { id: 'mediapart', url: 'https://www.mediapart.fr' } },
    { id: 'p1', kind: 'post', platform: 'bluesky', source: { id: 'bsky:mediapart.fr', handle: 'mediapart.fr' }, external: { url: 'https://l.mediapart.fr/kuR' } },
    { id: 'p2', kind: 'post', platform: 'bluesky', source: { id: 'bsky:x.bsky.social', handle: 'x.bsky.social' }, external: { url: 'https://bit.ly/abc' } },
  ];
  const items = mk();
  const s = await resolveShortLinks(items, { cache, follow });
  assert.deepEqual(followed, ['https://l.mediapart.fr/kuR'], 'only the outlet\'s own short links');
  assert.equal(s.resolved, 1);
  assert.equal(markRelays(items).relays, 1);
  assert.equal(items[1].relayOf, 'a1');
  const again = mk();
  await resolveShortLinks(again, { cache, follow });
  assert.equal(followed.length, 1, 'remembered');
  assert.equal(again[1].external.url, 'https://www.mediapart.fr/journal/france/161126/un-titre?utm_source=bluesky');
});

test('followRedirects: Location header by hand, else an HTML redirect; failures are explained', async () => {
  const { followRedirects, htmlRedirectTarget, resolveShortLinks } = await import('../scripts/lib/enrich.mjs');
  const res = (status, { location, body = '' } = {}) => ({ status, headers: { get: (h) => (h === 'location' ? location ?? null : null) }, text: async () => body });
  const routes = {
    'https://l.example.fr/a': res(301, { location: '/b' }),
    'https://l.example.fr/b': res(302, { location: 'https://www.example.fr/article/1' }),
    'https://www.example.fr/article/1': res(200, { body: '<html>' }),
    'https://l.example.fr/meta': res(200, { body: '<head><meta http-equiv="refresh" content="0; url=https://www.example.fr/article/2"></head>' }),
    'https://l.example.fr/js': res(200, { body: '<script>window.location.href = "https://www.example.fr/article/3";</script>' }),
    'https://l.example.fr/none': res(200, { body: '<p>rien</p>' }),
    'https://l.example.fr/gone': res(403),
  };
  const fetchImpl = async (u) => routes[u];
  assert.equal(await followRedirects('https://l.example.fr/a', { fetchImpl }), 'https://www.example.fr/article/1');
  assert.equal(await followRedirects('https://l.example.fr/meta', { fetchImpl }), 'https://www.example.fr/article/2');
  assert.equal(await followRedirects('https://l.example.fr/js', { fetchImpl }), 'https://www.example.fr/article/3');
  await assert.rejects(followRedirects('https://l.example.fr/none', { fetchImpl }), /sans redirection/);
  await assert.rejects(followRedirects('https://l.example.fr/gone', { fetchImpl }), /HTTP 403/);
  assert.equal(htmlRedirectTarget('<link rel="canonical" href="/x/y">', 'https://www.example.fr/'), 'https://www.example.fr/x/y');

  const items = [{ id: 'p', kind: 'post', platform: 'bluesky', source: { handle: 'example.fr' }, external: { url: 'https://l.example.fr/gone' } }];
  const s = await resolveShortLinks(items, { cache: new ResolutionCache('/nonexistent/y.json'), follow: (u) => followRedirects(u, { fetchImpl }) });
  assert.equal(s.resolved, 0);
  assert.match(s.failure, /l\.example\.fr\/gone : HTTP 403/);
});

test('markRelays: an outlet\'s unresolved short link falls back to its card title', async () => {
  const { markRelays } = await import('../scripts/lib/score.mjs');
  const art = { id: 'a1', kind: 'article', title: 'Retraites : ce que contient vraiment la réforme', url: 'https://www.mediapart.fr/journal/1', source: { id: 'mediapart', url: 'https://www.mediapart.fr' } };
  const other = { id: 'a2', kind: 'article', title: 'Retraites : ce que contient vraiment la réforme', url: 'https://www.blast-info.fr/x', source: { id: 'blast', url: 'https://www.blast-info.fr' } };
  const own = { id: 'p1', kind: 'post', platform: 'bluesky', source: { handle: 'mediapart.fr' }, external: { url: 'https://l.mediapart.fr/kuR', title: 'Retraites : ce que contient vraiment la réforme' } };
  const off = { id: 'p2', kind: 'post', platform: 'bluesky', source: { handle: 'mediapart.fr' }, external: { url: 'https://l.mediapart.fr/zz', title: 'Un tout autre sujet du jour' } };
  const r = markRelays([other, art, own, off]);
  assert.equal(own.relayOf, 'a1', 'the outlet\'s own article, not another outlet\'s with the same title');
  assert.equal(off.relayOf, undefined);
  assert.deepEqual([r.relays, r.byTitle, r.unmatched.length], [1, 1, 1]);
});
