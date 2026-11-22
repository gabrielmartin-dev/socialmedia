// Picture (and summary) of articles whose feed gives none, read from the article page's
// <head> (og:image / twitter:image, og:description). Only the beginning of the page is
// downloaded, every answer is remembered per URL (also « no image » and errors, for a
// shorter time), and a run fetches at most `maxFetches` new pages: the cost stays small
// and bounded, whatever the number of sources.

import { decodeEntities, stripHtml, truncate } from './text.mjs';
import { safeUrl, canonicalUrl, isShortener, stripTracking } from '../../public/url.js';
import { isJunkImage } from './rss.mjs';
import { pool } from './http.mjs';
import { isOwnLink } from './score.mjs';

const UA = 'Mozilla/5.0 (compatible; TimelinePerso/1.0; personal news reader)';
export const OG_TTL_MS = 8 * 24 * 3600e3; // longer than the longest window (Tech, 7 days)
export const OG_RETRY_MS = 24 * 3600e3; // after an error or a page without image
const MAX_BYTES = 200_000;

/** og:image / twitter:image and og:description / description of an HTML <head>. */
export function parseHeadMeta(html, pageUrl) {
  const head = String(html || '').split(/<\/head>/i)[0];
  const meta = {};
  for (const [tag] of head.matchAll(/<meta\b[^>]*>/gi)) {
    const key = /\b(?:property|name)\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1]?.toLowerCase();
    const content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    if (!key || !content) continue;
    if (!(key in meta)) meta[key] = decodeEntities(content[1] ?? content[2] ?? '').trim();
  }
  const imageRaw = meta['og:image:secure_url'] || meta['og:image'] || meta['og:image:url'] || meta['twitter:image'] || meta['twitter:image:src'];
  const image = imageRaw && !isJunkImage(imageRaw) ? safeUrl(imageRaw, pageUrl) : null;
  const description = truncate(stripHtml(meta['og:description'] || meta['description'] || meta['twitter:description'] || ''), 600);
  const docTitle = /<title\b[^>]*>([^<]*)<\/title>/i.exec(head)?.[1];
  const title = truncate(stripHtml(meta['og:title'] || meta['twitter:title'] || decodeEntities(docTitle || '')).replace(/\s+/g, ' ').trim(), 300);
  return { image, description, title };
}

/** GET the start of a page (until </head> or MAX_BYTES), with a short timeout. */
export async function fetchHead(url, { timeoutMs = 7000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9', Accept: 'text/html' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!/html/i.test(res.headers.get('content-type') || 'text/html')) throw new Error('not html');
    if (!res.body?.getReader) return { html: (await res.text()).slice(0, MAX_BYTES), url: res.url || url };
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let html = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      if (html.length >= MAX_BYTES || /<\/head>/i.test(html)) break;
    }
    reader.cancel().catch(() => {});
    return { html, url: res.url || url };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fills `image` (and an empty `text`) of the articles without picture, newest first.
 * Returns { fromCache, fetched, found }.
 */
export async function enrichArticles(items, { cache, maxFetches = 40, concurrency = 6, fetchPage = fetchHead } = {}) {
  const stats = { fromCache: 0, fetched: 0, found: 0 };
  const todo = items
    .filter((it) => it.kind === 'article' && (!it.image || it._smallImage) && it.url)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const apply = (it, v) => {
    if (v?.i) { it.image = v.i; delete it._smallImage; stats.found++; }
    if (v?.d && !it.text && v.d !== it.title) it.text = v.d;
  };
  const queue = [];
  for (const it of todo) {
    const key = `og:${canonicalUrl(it.url)}`;
    const hit = cache?.get(key);
    if (hit !== undefined) { stats.fromCache++; apply(it, hit); continue; }
    if (queue.length < maxFetches) queue.push({ it, key });
  }
  await pool(queue.map(({ it, key }) => async () => {
    stats.fetched++;
    try {
      const { html, url } = await fetchPage(it.url);
      const { image, description } = parseHeadMeta(html, url);
      const v = { i: image || null, d: description || '' };
      cache?.set(key, v, image ? OG_TTL_MS : OG_RETRY_MS);
      apply(it, v);
    } catch {
      cache?.set(key, { i: null, d: '' }, OG_RETRY_MS);
    }
  }), concurrency);
  return stats;
}

export const SHORT_TTL_MS = 30 * 24 * 3600e3;

/** l.mediapart.fr/kuR, bit.ly/xyz…: a single short path segment, no query. */
export function looksShort(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    return parts.length === 1 && parts[0].length <= 12 && !u.search && !/\.\w{2,5}$/.test(parts[0]);
  } catch { return false; }
}

/**
 * Where an HTML page sends the reader without an HTTP redirect: <meta http-equiv="refresh">,
 * a script setting location, then the page's own og:url / canonical link.
 */
export function htmlRedirectTarget(html, pageUrl) {
  const head = String(html || '').slice(0, 100_000);
  const pick = (re) => re.exec(head)?.[1];
  const refresh = [...head.matchAll(/<meta\b[^>]*>/gi)].map(([t]) => t)
    .find((t) => /http-equiv\s*=\s*["']?refresh/i.test(t));
  const raw = (refresh && /url\s*=\s*['"]?([^'">\s]+)/i.exec(refresh)?.[1])
    || pick(/(?:window\.|document\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/i)
    || pick(/location\.(?:replace|assign)\(\s*["']([^"']+)["']/i)
    || pick(/<meta\b[^>]*property\s*=\s*["']og:url["'][^>]*content\s*=\s*["']([^"']+)["']/i)
    || pick(/<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']+)["']/i);
  if (!raw) return null;
  const u = safeUrl(decodeEntities(raw), pageUrl);
  return u && u !== pageUrl ? u : null;
}

/**
 * Final URL of a short link. Redirects are followed by hand (Location header, up to 5 hops),
 * then an HTML answer is read for a meta refresh / script / og:url / canonical. Throws with
 * the HTTP status when the link answers neither (the log shows one such failure).
 */
export async function followRedirects(url, { timeoutMs = 6000, maxHops = 5, fetchImpl = fetch } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let current = url;
    for (let hop = 0; hop <= maxHops; hop++) {
      const res = await fetchImpl(current, { signal: ctrl.signal, redirect: 'manual', headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9', Accept: 'text/html' } });
      const loc = res.headers?.get?.('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        res.body?.cancel?.().catch(() => {});
        current = new URL(loc, current).href;
        continue;
      }
      if (res.status < 200 || res.status >= 300) {
        res.body?.cancel?.().catch(() => {});
        throw new Error(`HTTP ${res.status}`);
      }
      if (current !== url) { res.body?.cancel?.().catch(() => {}); return current; }
      const html = (await res.text()).slice(0, 100_000);
      const target = htmlRedirectTarget(html, current);
      if (!target) throw new Error(`HTTP ${res.status}, page sans redirection`);
      return target;
    }
    return current;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * An outlet's Bluesky posts often link through its own short-link domain (Mediapart:
 * l.mediapart.fr/kuR): such a link never matches the article URL. The short links of the
 * outlets' own posts are followed (once per link, remembered 30 days, at most `maxFetches`
 * per run) and the card's URL replaced with the article's, so that markRelays can match it.
 */
export async function resolveShortLinks(items, { cache, maxFetches = 60, concurrency = 6, follow = followRedirects } = {}) {
  const stats = { fromCache: 0, fetched: 0, resolved: 0, failure: '' };
  const queue = [];
  const replace = (it, final) => {
    const u = safeUrl(final);
    if (u && u !== it.external.url) { it.external = { ...it.external, url: stripTracking(u) || u }; stats.resolved++; }
  };
  for (const it of items) {
    if (it.platform !== 'bluesky' || !it.external?.url) continue;
    // An outlet's own short links, and any link through t.co, bit.ly… (the card would read « t.co »).
    if (!isShortener(it.external.url) && !(isOwnLink(it) && looksShort(it.external.url))) continue;
    const key = `short2:${it.external.url}`; // short: = first version, which cached failures 30 days
    const hit = cache?.get(key);
    if (hit !== undefined) { stats.fromCache++; if (hit) replace(it, hit); continue; }
    if (queue.length < maxFetches) queue.push({ it, key });
  }
  await pool(queue.map(({ it, key }) => async () => {
    stats.fetched++;
    try {
      const final = await follow(it.external.url);
      const ok = final && final !== it.external.url;
      cache?.set(key, ok ? final : '', ok ? SHORT_TTL_MS : OG_RETRY_MS);
      if (ok) replace(it, final);
    } catch (err) {
      if (!stats.failure) stats.failure = `${it.external.url} : ${err?.name === 'AbortError' ? 'délai dépassé' : err?.message || err}`;
      cache?.set(key, '', OG_RETRY_MS);
    }
  }), concurrency);
  return stats;
}

/**
 * Link cards of Bluesky posts without title (a t.co card whose title was the bare URL, a
 * site that gave Bluesky nothing): title, picture and summary read from the article page,
 * remembered per URL like enrichArticles. Returns { fromCache, fetched, found }.
 */
export async function enrichLinkCards(items, { cache, maxFetches = 20, concurrency = 6, fetchPage = fetchHead } = {}) {
  const stats = { fromCache: 0, fetched: 0, found: 0 };
  const todo = items
    .filter((it) => it.platform === 'bluesky' && it.external?.url && !it.external.title && !isShortener(it.external.url)
      && !it.images?.length && !it.video)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const apply = (it, v) => {
    if (!v?.t) return;
    it.external = {
      ...it.external,
      title: v.t,
      description: it.external.description || truncate(v.d || '', 200),
      thumb: it.external.thumb || v.i || null,
    };
    stats.found++;
  };
  const queue = [];
  for (const it of todo) {
    const key = `card:${canonicalUrl(it.external.url)}`;
    const hit = cache?.get(key);
    if (hit !== undefined) { stats.fromCache++; apply(it, hit); continue; }
    if (queue.length < maxFetches) queue.push({ it, key });
  }
  await pool(queue.map(({ it, key }) => async () => {
    stats.fetched++;
    try {
      const { html, url } = await fetchPage(it.external.url);
      const { image, description, title } = parseHeadMeta(html, url);
      const v = { t: title || '', i: image || null, d: description || '' };
      cache?.set(key, v, title ? OG_TTL_MS : OG_RETRY_MS);
      apply(it, v);
    } catch {
      cache?.set(key, { t: '', i: null, d: '' }, OG_RETRY_MS);
    }
  }), concurrency);
  return stats;
}

/**
 * A site that has no illustration for an article often serves its logo: an image carried by
 * `min` articles or more of the same source is removed from them. Returns how many articles lost it.
 */
export function dropRepeatedImages(items, min = 3) {
  const count = new Map();
  const key = (it) => `${it.source?.id}\n${it.image}`;
  const arts = items.filter((it) => it.kind === 'article' && it.image);
  for (const it of arts) count.set(key(it), (count.get(key(it)) || 0) + 1);
  let dropped = 0;
  for (const it of arts) if (count.get(key(it)) >= min) { it.image = null; delete it._smallImage; dropped++; }
  return dropped;
}
