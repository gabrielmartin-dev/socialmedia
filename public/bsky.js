// Minimal Bluesky client for the browser (public AppView, CORS-enabled):
// account search and posts of accounts followed from the app. Posts are converted by
// public/bskypost.js, the same code as the collector.

import { postToItem, postSource } from './bskypost.js';

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

/** A post of an account followed from the app, as a feed item (always a text post, flagged `live`). */
export function postToLiveItem(post) {
  const item = postToItem(post, { ...postSource(post.author || {}), live: true });
  item.kind = 'post';
  return item;
}

/**
 * One page of an author's posts (no replies, no reposts). `cursor` is the API's pagination
 * token: pass the one returned by the previous page to get the older posts.
 */
export async function authorPage(handle, { limit = 25, cursor, ...opts } = {}) {
  const params = { actor: handle, limit, filter: 'posts_no_replies' };
  if (cursor) params.cursor = cursor;
  const { feed = [], cursor: next } = await call('app.bsky.feed.getAuthorFeed', params, opts);
  return { items: feed.filter((f) => !f.reason).map(({ post }) => postToLiveItem(post)), cursor: next || null };
}

export async function authorPosts(handle, limit = 25, opts) {
  return (await authorPage(handle, { limit, ...opts })).items;
}

export async function getProfile(handle) {
  const p = await call('app.bsky.actor.getProfile', { actor: handle });
  return { avatar: p.avatar || null, banner: p.banner || null, name: p.displayName || p.handle, description: p.description || '' };
}
