// Picture (and summary) of articles whose feed gives none, read from the article page's
// <head> (og:image / twitter:image, og:description). Only the beginning of the page is
// downloaded, every answer is remembered per URL (also « no image » and errors, for a
// shorter time), and a run fetches at most `maxFetches` new pages: the cost stays small
// and bounded, whatever the number of sources.

import { decodeEntities, stripHtml, truncate } from './text.mjs';
import { safeUrl, canonicalUrl } from '../../public/url.js';
import { isJunkImage } from './rss.mjs';
import { pool } from './http.mjs';

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
  return { image, description };
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
    .filter((it) => it.kind === 'article' && !it.image && it.url)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const apply = (it, v) => {
    if (v?.i) { it.image = v.i; stats.found++; }
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
