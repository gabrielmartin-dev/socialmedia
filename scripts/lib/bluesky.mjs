// Bluesky (AT Protocol) client: public AppView by default, authenticated
// session when BSKY_IDENTIFIER / BSKY_APP_PASSWORD are set (free app password),
// which is needed for post search on some periods/regions.

import { fetchJson } from './http.mjs';
import { normalize, truncate } from './text.mjs';

const PUBLIC = 'https://public.api.bsky.app/xrpc';

export async function createClient(env = process.env) {
  let base = PUBLIC;
  let headers = {};
  let authenticated = false;
  if (env.BSKY_IDENTIFIER && env.BSKY_APP_PASSWORD) {
    const service = (env.BSKY_SERVICE || 'https://bsky.social').replace(/\/$/, '');
    const res = await fetch(`${service}/xrpc/com.atproto.server.createSession`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: env.BSKY_IDENTIFIER, password: env.BSKY_APP_PASSWORD }),
    });
    if (!res.ok) throw new Error(`Bluesky login failed: HTTP ${res.status}`);
    const session = await res.json();
    base = `${service}/xrpc`;
    headers = { Authorization: `Bearer ${session.accessJwt}` };
    authenticated = true;
  }

  const call = (method, params) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      for (const val of [].concat(v)) if (val != null) qs.append(k, String(val));
    }
    return fetchJson(`${base}/${method}?${qs}`, { headers });
  };

  return { call, authenticated };
}

const isVerified = (actor) => actor?.verification?.verifiedStatus === 'valid';

/** Find an account from its display name. Exact (accent-insensitive) match only. */
export async function resolveAccount(client, account) {
  if (account.handle) {
    const p = await client.call('app.bsky.actor.getProfile', { actor: account.handle });
    return { handle: p.handle, did: p.did, displayName: p.displayName || p.handle, avatar: p.avatar || null, verified: isVerified(p), description: p.description || '' };
  }
  const { actors = [] } = await client.call('app.bsky.actor.searchActors', { q: account.name, limit: 10 });
  const target = normalize(account.name).replace(/[^a-z0-9]/g, '');
  const candidates = actors.filter((a) => normalize(a.displayName || '').replace(/[^a-z0-9]/g, '') === target);
  if (!candidates.length) throw new Error(`Aucun compte Bluesky nommé exactement « ${account.name} »`);
  candidates.sort((a, b) => Number(isVerified(b)) - Number(isVerified(a)));
  const a = candidates[0];
  return { handle: a.handle, did: a.did, displayName: a.displayName, avatar: a.avatar || null, verified: isVerified(a), description: a.description || '' };
}

function rkey(uri) { return uri.split('/').pop(); }

const aspectOf = (ar) => (ar?.width && ar?.height ? ar.width / ar.height : null);

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

function extractMedia(embed) {
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
      if (type.endsWith('#link')) href = feat.uri;
      else if (type.endsWith('#mention')) href = `https://bsky.app/profile/${feat.did}`;
      else if (type.endsWith('#tag')) href = `https://bsky.app/hashtag/${encodeURIComponent(feat.tag)}`;
      return href ? { start: f.index?.byteStart, end: f.index?.byteEnd, href } : null;
    })
    .filter((f) => f && Number.isInteger(f.start) && Number.isInteger(f.end) && f.end > f.start)
    .sort((a, b) => a.start - b.start);
  if (!facets.length) return undefined;
  const bytes = Buffer.from(text, 'utf8');
  const segs = [];
  let pos = 0;
  for (const f of facets) {
    if (f.start < pos || f.end > bytes.length) continue;
    if (f.start > pos) segs.push({ t: bytes.subarray(pos, f.start).toString('utf8') });
    segs.push({ t: bytes.subarray(f.start, f.end).toString('utf8'), href: f.href });
    pos = f.end;
  }
  if (pos < bytes.length) segs.push({ t: bytes.subarray(pos).toString('utf8') });
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
    source: sourceOverride || {
      id: 'bsky:' + handle,
      name: author.displayName || handle,
      handle,
      avatar: author.avatar || null,
      url: `https://bsky.app/profile/${handle}`,
    },
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

export async function authorPosts(client, account, limit = 30) {
  const { feed = [] } = await client.call('app.bsky.feed.getAuthorFeed', {
    actor: account.did || account.handle,
    limit,
    filter: 'posts_no_replies',
  });
  return feed
    .filter((f) => !f.reason) // drop reposts
    .map((f) => {
      const item = postToItem(f.post);
      item.source.verified = account.verified || undefined;
      return item;
    });
}

/** Search recent posts for a hashtag/term and keep only the ones with a video. */
export async function searchVideos(client, query, { limit = 100, sinceHours = 72 } = {}) {
  const since = new Date(Date.now() - sinceHours * 3600e3).toISOString();
  const { posts = [] } = await client.call('app.bsky.feed.searchPosts', { q: query, sort: 'latest', limit, since });
  return posts.map((p) => postToItem(p)).filter((i) => i.kind === 'video');
}

