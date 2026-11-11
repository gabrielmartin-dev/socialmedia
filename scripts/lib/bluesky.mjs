// Bluesky (AT Protocol) client: public AppView by default, authenticated
// session when BSKY_IDENTIFIER / BSKY_APP_PASSWORD are set (free app password),
// which is needed for post search on some periods/regions.

import { fetchJson } from './http.mjs';
import { normalize } from './text.mjs';
import { postToItem } from '../../public/bskypost.js';

// Post conversion (media, quotes, link segments) is shared with the browser.
export { postToItem, textSegments, rkey } from '../../public/bskypost.js';

const PUBLIC = 'https://public.api.bsky.app/xrpc';
// The public alias answers 403 to post search; the AppView itself serves it without a session.
const APPVIEW = 'https://api.bsky.app/xrpc';
const APPVIEW_ONLY = new Set(['app.bsky.feed.searchPosts']);

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
    const host = !authenticated && APPVIEW_ONLY.has(method) ? APPVIEW : base;
    return fetchJson(`${host}/${method}?${qs}`, { headers });
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
  // Without a session the AppView rejects `since` (HTTP 400): the collector drops old posts anyway.
  const since = client.authenticated ? new Date(Date.now() - sinceHours * 3600e3).toISOString() : undefined;
  const { posts = [] } = await client.call('app.bsky.feed.searchPosts', { q: query, sort: 'latest', limit, since });
  return posts.map((p) => postToItem(p)).filter((i) => i.kind === 'video');
}

