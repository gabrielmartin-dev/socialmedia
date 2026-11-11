import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeUrl } from '../public/url.js';
import { entryToArticle } from '../scripts/lib/rss.mjs';
import { sanitizeItem } from '../scripts/lib/sanitize.mjs';
import { textSegments, postToItem } from '../scripts/lib/bluesky.mjs';
import { checkRun } from '../scripts/lib/health.mjs';

test('safeUrl only lets http(s) through', () => {
  assert.equal(safeUrl('https://example.org/a?b=1'), 'https://example.org/a?b=1');
  assert.equal(safeUrl('  http://example.org/x '), 'http://example.org/x');
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,<script>1</script>',
    'data:image/svg+xml,<svg/>', 'vbscript:x', 'file:///etc/passwd', 'blob:https://x/y', '//evil.test/x', '/relative', '', null, undefined, 42]) {
    assert.equal(safeUrl(bad), null, String(bad));
  }
  // With a base, relative URLs resolve (same-origin) but schemes are still filtered.
  assert.equal(safeUrl('/a.png', 'https://example.org/p/'), 'https://example.org/a.png');
  assert.equal(safeUrl('javascript:alert(1)', 'https://example.org/'), null);
});

test('entryToArticle drops items with a non-http link and cleans images', () => {
  const src = { id: 's', name: 'S', avatar: 'javascript:1' };
  assert.equal(entryToArticle({ guid: 'x', link: 'javascript:alert(1)', title: 'T', text: '' }, src), null);
  const a = entryToArticle({ guid: 'x', link: 'https://a.fr/post', title: 'T', text: 'b', image: 'data:image/svg+xml,<svg/>' }, src);
  assert.equal(a.image, null);
  assert.equal(a.source.avatar, null);
  assert.equal(entryToArticle({ guid: 'y', link: 'https://a.fr/post', title: 'T', image: '/img/a.jpg' }, src).image, 'https://a.fr/img/a.jpg');
});

test('Bluesky: javascript: facets and unsafe media never reach the items', () => {
  const text = 'clic ici';
  const segs = textSegments({ text, facets: [{ index: { byteStart: 5, byteEnd: 8 }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'javascript:alert(1)' }] }] });
  assert.equal(segs, undefined);

  const item = sanitizeItem(postToItem({
    uri: 'at://did:plc:abc123/app.bsky.feed.post/3k',
    author: { did: 'did:plc:abc123', handle: 'x.bsky.social', avatar: 'javascript:1' },
    record: { text, createdAt: '2026-11-09T10:00:00.000Z' },
    embed: { $type: 'app.bsky.embed.external#view', external: { uri: 'javascript:alert(1)', title: 't', thumb: 'https://ok/t.jpg' } },
  }));
  assert.equal(item.external, undefined);
  assert.equal(item.source.avatar, null);

  const vid = sanitizeItem(postToItem({
    uri: 'at://did:plc:abc123/app.bsky.feed.post/3l', author: { did: 'did:plc:abc123', handle: 'x.bsky.social' },
    record: { text: '', createdAt: '2026-11-09T10:00:00.000Z' },
    embed: { $type: 'app.bsky.embed.video#view', playlist: 'javascript:1', thumbnail: 'https://v/t.jpg' },
  }));
  assert.equal(vid.video, undefined);
});

test('sanitizeItem removes unsafe urls everywhere and drops linkless items', () => {
  assert.equal(sanitizeItem({ url: 'javascript:1', source: {} }), null);
  const it = sanitizeItem({
    url: 'https://a.fr/x', image: 'data:image/png;base64,AAAA', source: { avatar: 'ftp://x/a.png', url: 'https://a.fr' },
    images: [{ thumb: 'javascript:1', full: 'javascript:1' }, { thumb: 'https://i/1.jpg', full: null }],
    quote: { url: 'https://a.fr/q', avatar: 'javascript:1', image: 'https://i/q.jpg' },
    segments: [{ t: 'a', href: 'javascript:1' }, { t: 'b', href: 'https://ok/' }],
  });
  assert.equal(it.image, null);
  assert.equal(it.source.avatar, null);
  assert.deepEqual(it.images, [{ thumb: 'https://i/1.jpg', full: 'https://i/1.jpg' }]);
  assert.equal(it.quote.avatar, null);
  assert.deepEqual(it.segments, [{ t: 'a' }, { t: 'b', href: 'https://ok/' }]);
});

test('checkRun fails on mass failures or too few items', () => {
  const ok = (n) => Array.from({ length: n }, () => ({ ok: true }));
  const ko = (n) => Array.from({ length: n }, () => ({ ok: false }));
  const counts = { actus: 100, tech: 50, videos: 20 };
  assert.equal(checkRun([...ok(8), ...ko(2)], counts).ok, true);
  assert.equal(checkRun([...ok(4), ...ko(6)], counts).ok, false);
  assert.equal(checkRun(ok(10), { actus: 3, tech: 0, videos: 1 }).ok, false);
  // The thresholds come from the config.
  assert.equal(checkRun([...ok(4), ...ko(6)], counts, { health: { maxFailureRatio: 0.7 } }).ok, true);
  assert.match(checkRun(ko(3), { actus: 0, tech: 0, videos: 0 }).reasons.join(), /sources en échec/);
});
