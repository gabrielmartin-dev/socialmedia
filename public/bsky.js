// Minimal Bluesky client for the browser (public AppView, CORS-enabled):
// account search and posts of accounts followed from the app.

import { safeUrl } from './url.js';

const API = 'https://public.api.bsky.app/xrpc';

const TIMEOUT_MS = 8000;

/** GET an XRPC method. Every request has a timeout (and can be aborted by `signal`). */
async function call(method, params, { timeoutMs = TIMEOUT_MS, signal } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  signal?.addEventListener('abort', () => ctrl.abort(), { once: true });
  try {
    const res = await fetch(`${API}/${method}?${new URLSearchParams(params)}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Bluesky ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function searchAccounts(q) {
  const { actors = [] } = await call('app.bsky.actor.searchActors', { q, limit: 20 });
  return actors.map((a) => ({
    id: 'bsky:' + a.handle,
    name: a.displayName || a.handle,
    handle: '@' + a.handle,
    avatar: a.avatar || null,
    description: a.description || '',
    url: `https://bsky.app/profile/${a.handle}`,
    kind: 'bluesky',
    feed: 'actus',
    category: 'Recherche',
  }));
}

const rkey = (uri) => uri.split('/').pop();
const aspectOf = (ar) => (ar?.width && ar?.height ? ar.width / ar.height : null);

function segments(record) {
  const text = record?.text || '';
  const facets = (record?.facets || []).map((f) => {
    const feat = (f.features || [])[0] || {};
    const type = feat.$type || '';
    let href = null;
    if (type.endsWith('#link')) href = safeUrl(feat.uri);
    else if (type.endsWith('#mention')) href = `https://bsky.app/profile/${feat.did}`;
    else if (type.endsWith('#tag')) href = `https://bsky.app/hashtag/${encodeURIComponent(feat.tag)}`;
    return href ? { start: f.index?.byteStart, end: f.index?.byteEnd, href } : null;
  }).filter((f) => f && f.end > f.start).sort((a, b) => a.start - b.start);
  if (!facets.length) return undefined;
  const bytes = new TextEncoder().encode(text);
  const dec = new TextDecoder();
  const segs = [];
  let pos = 0;
  for (const f of facets) {
    if (f.start < pos || f.end > bytes.length) continue;
    if (f.start > pos) segs.push({ t: dec.decode(bytes.subarray(pos, f.start)) });
    segs.push({ t: dec.decode(bytes.subarray(f.start, f.end)), href: f.href });
    pos = f.end;
  }
  if (pos < bytes.length) segs.push({ t: dec.decode(bytes.subarray(pos)) });
  return segs;
}

function media(embed) {
  if (!embed) return {};
  const t = embed.$type || '';
  if (t.startsWith('app.bsky.embed.recordWithMedia')) return { ...media(embed.media), quote: quote(embed.record?.record) };
  if (t.startsWith('app.bsky.embed.record')) return { quote: quote(embed.record) };
  if (t.startsWith('app.bsky.embed.images')) return { images: (embed.images || []).map((i) => ({ thumb: i.thumb, full: i.fullsize, alt: i.alt || '', aspect: aspectOf(i.aspectRatio) })) };
  if (t.startsWith('app.bsky.embed.video')) return { video: { type: 'hls', src: embed.playlist, poster: embed.thumbnail || null, aspect: aspectOf(embed.aspectRatio) } };
  if (t.startsWith('app.bsky.embed.external')) {
    const e = embed.external || {};
    return { external: { url: e.uri, title: e.title || '', description: e.description || '', thumb: e.thumb || null } };
  }
  return {};
}

function quote(rec) {
  if (!rec?.author || !rec.value || !rec.uri) return undefined;
  return {
    name: rec.author.displayName || rec.author.handle,
    handle: rec.author.handle,
    avatar: rec.author.avatar || null,
    text: rec.value.text || '',
    url: `https://bsky.app/profile/${rec.author.handle}/post/${rkey(rec.uri)}`,
    publishedAt: rec.value.createdAt,
  };
}

export async function authorPosts(handle, limit = 25, opts) {
  const { feed = [] } = await call('app.bsky.feed.getAuthorFeed', { actor: handle, limit, filter: 'posts_no_replies' }, opts);
  return feed.filter((f) => !f.reason).map(({ post }) => {
    const a = post.author || {};
    const m = media(post.embed);
    return {
      id: 'b-' + rkey(post.uri) + '-' + (a.did || '').slice(-6),
      kind: 'post',
      platform: 'bluesky',
      source: { id: 'bsky:' + a.handle, name: a.displayName || a.handle, handle: a.handle, avatar: a.avatar || null, url: `https://bsky.app/profile/${a.handle}`, live: true },
      title: '',
      text: post.record?.text || '',
      segments: segments(post.record),
      url: `https://bsky.app/profile/${a.handle}/post/${rkey(post.uri)}`,
      image: m.images?.[0]?.thumb || m.external?.thumb || null,
      images: m.images,
      external: m.external,
      video: m.video,
      quote: m.quote,
      publishedAt: new Date(post.record?.createdAt || post.indexedAt).toISOString(),
      stats: { replies: post.replyCount || 0, reposts: (post.repostCount || 0) + (post.quoteCount || 0), likes: post.likeCount || 0 },
    };
  });
}

export async function getProfile(handle) {
  const p = await call('app.bsky.actor.getProfile', { actor: handle });
  return { avatar: p.avatar || null, banner: p.banner || null, name: p.displayName || p.handle, description: p.description || '' };
}
