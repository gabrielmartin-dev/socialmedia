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
    return { handle: p.handle, did: p.did, displayName: p.displayName || p.handle, avatar: p.avatar || null, verified: isVerified(p) };
  }
  const { actors = [] } = await client.call('app.bsky.actor.searchActors', { q: account.name, limit: 10 });
  const target = normalize(account.name).replace(/[^a-z0-9]/g, '');
  const candidates = actors.filter((a) => normalize(a.displayName || '').replace(/[^a-z0-9]/g, '') === target);
  if (!candidates.length) throw new Error(`Aucun compte Bluesky nommé exactement « ${account.name} »`);
  candidates.sort((a, b) => Number(isVerified(b)) - Number(isVerified(a)));
  const a = candidates[0];
  return { handle: a.handle, did: a.did, displayName: a.displayName, avatar: a.avatar || null, verified: isVerified(a) };
}

function rkey(uri) { return uri.split('/').pop(); }

function extractMedia(embed) {
  if (!embed) return {};
  const t = embed.$type || '';
  if (t.startsWith('app.bsky.embed.recordWithMedia')) return extractMedia(embed.media);
  if (t.startsWith('app.bsky.embed.images')) {
    return { images: (embed.images || []).map((i) => ({ thumb: i.thumb, full: i.fullsize, alt: i.alt || '' })) };
  }
  if (t.startsWith('app.bsky.embed.video')) {
    const ar = embed.aspectRatio;
    return { video: { type: 'hls', src: embed.playlist, poster: embed.thumbnail || null, aspect: ar ? ar.width / ar.height : null } };
  }
  if (t.startsWith('app.bsky.embed.external')) {
    const e = embed.external || {};
    return { external: { url: e.uri, title: e.title || '', description: truncate(e.description || '', 200), thumb: e.thumb || null } };
  }
  return {};
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
    text: truncate(text, 600),
    url: `https://bsky.app/profile/${handle}/post/${rkey(post.uri)}`,
    image: media.images?.[0]?.thumb || media.external?.thumb || null,
    images: media.images || undefined,
    external: media.external || undefined,
    video: media.video || undefined,
    publishedAt: new Date(post.record?.createdAt || post.indexedAt).toISOString(),
    stats: { likes: post.likeCount || 0, reposts: post.repostCount || 0 },
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

