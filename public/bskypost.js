// Bluesky PostView → our item format. Shared by the collector (scripts/lib/bluesky.mjs)
// and the app (public/bsky.js), so that both produce the same media, quotes and
// link segments. No Node API here (TextEncoder instead of Buffer).

import { truncate } from './norm.js';
import { safeUrl } from './url.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const rkey = (uri) => uri.split('/').pop();
const aspectOf = (ar) => (ar?.width && ar?.height ? ar.width / ar.height : null);

export const postSource = (author) => ({
  id: 'bsky:' + author.handle,
  name: author.displayName || author.handle,
  handle: author.handle,
  avatar: author.avatar || null,
  url: `https://bsky.app/profile/${author.handle}`,
});

function extractQuote(rec) {
  // app.bsky.embed.record#viewRecord (quoted post). Blocked/deleted quotes are skipped.
  if (!rec || !rec.author || !rec.value || !rec.uri) return null;
  const media = (rec.embeds || []).map((e) => extractMedia(e)).find((m) => m.images || m.video || m.external) || {};
  return {
    name: rec.author.displayName || rec.author.handle,
    handle: rec.author.handle,
    avatar: rec.author.avatar || null,
    text: truncate(rec.value.text || '', 400),
    url: `https://bsky.app/profile/${rec.author.handle}/post/${rkey(rec.uri)}`,
    publishedAt: rec.value.createdAt || rec.indexedAt,
    image: media.images?.[0]?.thumb || media.video?.poster || media.external?.thumb || null,
  };
}

export function extractMedia(embed) {
  if (!embed) return {};
  const t = embed.$type || '';
  if (t.startsWith('app.bsky.embed.recordWithMedia')) {
    return { ...extractMedia(embed.media), quote: extractQuote(embed.record?.record) || undefined };
  }
  if (t.startsWith('app.bsky.embed.record')) {
    const q = extractQuote(embed.record);
    return q ? { quote: q } : {};
  }
  if (t.startsWith('app.bsky.embed.images')) {
    return { images: (embed.images || []).map((i) => ({ thumb: i.thumb, full: i.fullsize, alt: i.alt || '', aspect: aspectOf(i.aspectRatio) })) };
  }
  if (t.startsWith('app.bsky.embed.video')) {
    return { video: { type: 'hls', src: embed.playlist, poster: embed.thumbnail || null, aspect: aspectOf(embed.aspectRatio) } };
  }
  if (t.startsWith('app.bsky.embed.external')) {
    const e = embed.external || {};
    return { external: { url: e.uri, title: e.title || '', description: truncate(e.description || '', 200), thumb: e.thumb || null } };
  }
  return {};
}

/** Split a post's text into segments with links/mentions/hashtags from its facets. */
export function textSegments(record) {
  const text = record?.text || '';
  const facets = (record?.facets || [])
    .map((f) => {
      const feat = (f.features || [])[0] || {};
      const type = feat.$type || '';
      let href = null;
      if (type.endsWith('#link')) href = safeUrl(feat.uri);
      else if (type.endsWith('#mention')) href = `https://bsky.app/profile/${feat.did}`;
      else if (type.endsWith('#tag')) href = `https://bsky.app/hashtag/${encodeURIComponent(feat.tag)}`;
      return href ? { start: f.index?.byteStart, end: f.index?.byteEnd, href } : null;
    })
    .filter((f) => f && Number.isInteger(f.start) && Number.isInteger(f.end) && f.end > f.start)
    .sort((a, b) => a.start - b.start);
  if (!facets.length) return undefined;
  const bytes = encoder.encode(text);
  const segs = [];
  let pos = 0;
  for (const f of facets) {
    if (f.start < pos || f.end > bytes.length) continue;
    if (f.start > pos) segs.push({ t: decoder.decode(bytes.subarray(pos, f.start)) });
    segs.push({ t: decoder.decode(bytes.subarray(f.start, f.end)), href: f.href });
    pos = f.end;
  }
  if (pos < bytes.length) segs.push({ t: decoder.decode(bytes.subarray(pos)) });
  return segs;
}

/** Convert a Bluesky PostView into our item format. */
export function postToItem(post, sourceOverride) {
  const author = post.author || {};
  const media = extractMedia(post.embed);
  const text = post.record?.text || '';
  const handle = author.handle;
  return {
    id: 'b-' + rkey(post.uri) + '-' + (author.did || '').slice(-6),
    kind: media.video ? 'video' : 'post',
    platform: 'bluesky',
    source: sourceOverride || postSource(author),
    title: '',
    text,
    segments: textSegments(post.record),
    url: `https://bsky.app/profile/${handle}/post/${rkey(post.uri)}`,
    image: media.images?.[0]?.thumb || media.external?.thumb || null,
    images: media.images || undefined,
    external: media.external || undefined,
    video: media.video || undefined,
    quote: media.quote || undefined,
    publishedAt: new Date(post.record?.createdAt || post.indexedAt).toISOString(),
    stats: {
      replies: post.replyCount || 0,
      reposts: (post.repostCount || 0) + (post.quoteCount || 0),
      likes: post.likeCount || 0,
    },
  };
}
