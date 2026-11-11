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

export async function authorPosts(handle, limit = 25, opts) {
  const { feed = [] } = await call('app.bsky.feed.getAuthorFeed', { actor: handle, limit, filter: 'posts_no_replies' }, opts);
  return feed.filter((f) => !f.reason).map(({ post }) => postToLiveItem(post));
}

export async function getProfile(handle) {
  const p = await call('app.bsky.actor.getProfile', { actor: handle });
  return { avatar: p.avatar || null, banner: p.banner || null, name: p.displayName || p.handle, description: p.description || '' };
}

/** AT-URI of a post from its bsky.app permalink (the AppView resolves handles too). */
export function postUri(url) {
  const m = /^https:\/\/bsky\.app\/profile\/([^/?#]+)\/post\/([^/?#]+)/.exec(url || '');
  return m ? `at://${m[1]}/app.bsky.feed.post/${m[2]}` : null;
}

const isThreadPost = (n) => n?.post && String(n.$type || '').endsWith('#threadViewPost');

/**
 * app.bsky.feed.getPostThread response → { parents, item, replies }.
 * `parents` run from the root of the conversation down to the post. `replies` is a tree
 * of { item, own, replies }: `own` marks the original author continuing their own thread,
 * who comes first at every level, then the most liked replies. Deleted / blocked posts are skipped.
 */
export function threadFromView(view) {
  const node = view?.thread;
  if (!isThreadPost(node)) return null;
  const parents = [];
  for (let p = node.parent; isThreadPost(p); p = p.parent) parents.unshift(postToLiveItem(p.post));
  const build = (n, authorDid) => (n.replies || []).filter(isThreadPost).map((r) => ({
    item: postToLiveItem(r.post),
    own: r.post.author?.did === authorDid,
    likes: r.post.likeCount || 0,
    replies: build(r, authorDid),
  })).sort((a, b) => (b.own - a.own) || (b.likes - a.likes));
  const authorDid = node.post.author?.did;
  const strip = (list) => list.map(({ item, own, replies }) => ({ item, own, replies: strip(replies) }));
  return { parents, item: postToLiveItem(node.post), replies: strip(build(node, authorDid)) };
}

/** The conversation around a Bluesky post (the post, what it answers to, the replies). */
export async function getThread(url, opts) {
  const uri = postUri(url);
  if (!uri) return null;
  return threadFromView(await call('app.bsky.feed.getPostThread', { uri, depth: 6, parentHeight: 10 }, opts));
}
