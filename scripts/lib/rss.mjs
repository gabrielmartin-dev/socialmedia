// RSS / Atom parsing into normalised items, with feed autodiscovery.

import { XMLParser } from 'fast-xml-parser';
import crypto from 'node:crypto';
import { fetchText } from './http.mjs';
import { stripHtml, truncate, decodeEntities, cleanSummary } from './text.mjs';
import { safeUrl } from '../../public/url.js';
import { detectPaywall, cleanPaidTitle } from '../../public/paywall.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  cdataPropName: false,
  processEntities: true,
  htmlEntities: true,
  trimValues: true,
});

const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const txt = (x) => {
  if (x == null) return '';
  if (typeof x === 'string' || typeof x === 'number') return String(x);
  if (Array.isArray(x)) return txt(x[0]);
  if (typeof x === 'object') return txt(x['#text'] ?? '');
  return '';
};

/** « email@x.fr (Jean Dupont) » and « Jean Dupont <email@x.fr> » give the name; a bare e-mail gives nothing. */
export function cleanAuthor(raw) {
  let a = stripHtml(String(raw ?? '')).trim();
  const paren = /^[^\s()]+@[^\s()]+\s*\(([^)]+)\)$/.exec(a);
  if (paren) a = paren[1].trim();
  a = a.replace(/\s*<[^>]*@[^>]*>\s*$/, '').trim();
  if (/^[^\s@]+@[^\s@]+$/.test(a)) return '';
  return truncate(a, 80);
}

/** Categories / tags of an entry (RSS <category>, Atom <category term="…">), at most 4 short ones. */
export function categoriesOf(entry) {
  const names = arr(entry.category).map((c) => (typeof c === 'object' && c ? c['@term'] || c['@label'] || txt(c) : String(c)));
  return [...new Set(names.map((n) => stripHtml(n)).filter((n) => n && n.length <= 40))].slice(0, 4);
}

export function hashId(...parts) {
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
}

// Tracking pixels, avatars, emojis, share buttons…: never the picture of an article.
const JUNK_IMAGE = /(pixel|tracking|feedburner|feeds\.feedblitz|gravatar\.com|\/emoji|smilies|wp-includes\/images|1x1|spacer|blank\.gif|\/share[-_]|\/badge|stats\.wordpress|doubleclick|\/avatar)/i;
export const isJunkImage = (url) => !url || JUNK_IMAGE.test(url) || /^data:/i.test(url);

const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? '') : null;
};

/** The first real picture of an HTML body: lazy-loaded sources, srcset, no 1×1 / tiny images. */
export function firstImgInHtml(html) {
  for (const [tag] of String(html || '').matchAll(/<img\b[^>]*>/gi)) {
    const w = Number(attr(tag, 'width'));
    const h = Number(attr(tag, 'height'));
    if ((w && w < 80) || (h && h < 80)) continue;
    const srcset = attr(tag, 'data-srcset') || attr(tag, 'srcset');
    const fromSet = srcset ? srcset.split(',').map((c) => c.trim().split(/\s+/)[0]).filter(Boolean).pop() : null;
    const url = attr(tag, 'data-src') || attr(tag, 'data-lazy-src') || attr(tag, 'data-original') || attr(tag, 'src') || fromSet;
    const pick = url && !/^data:/i.test(url) ? url : fromSet;
    if (pick && !isJunkImage(pick)) return pick;
  }
  return null;
}

/** media:content / media:thumbnail / media:group / enclosure images, the widest first. */
function feedImages(entry) {
  const out = [];
  const add = (m, isThumb) => {
    const url = m?.['@url'];
    if (!url) return;
    const type = m['@type'] || m['@medium'] || (isThumb ? 'image' : '');
    if (!/image/.test(type) && !(type === '' && /\.(jpe?g|png|webp|avif|gif)(\?|$)/i.test(url))) return;
    if (isJunkImage(url)) return;
    out.push({ url, width: Number(m['@width']) || 0 });
  };
  arr(entry['media:content']).forEach((m) => add(m, false));
  arr(entry['media:thumbnail']).forEach((m) => add(m, true));
  const group = entry['media:group'];
  if (group) {
    arr(group['media:content']).forEach((m) => add(m, false));
    arr(group['media:thumbnail']).forEach((m) => add(m, true));
  }
  for (const enc of arr(entry.enclosure)) {
    if (enc?.['@url'] && /^image\//.test(enc['@type'] || '') && !isJunkImage(enc['@url'])) out.push({ url: enc['@url'], width: 0 });
  }
  // Stable sort: without widths, the feed's own order is kept.
  return out.sort((a, b) => b.width - a.width);
}

/** The feed's widest image; `small` when its width is known and under 300 px (a thumbnail). */
function pickImage(entry, html) {
  const best = feedImages(entry)[0];
  return { url: best?.url || firstImgInHtml(html), small: !!best && best.width > 0 && best.width < SMALL_IMAGE_PX };
}
const SMALL_IMAGE_PX = 300;

function linkOf(entry) {
  if (typeof entry.link === 'string') return entry.link;
  const links = arr(entry.link);
  const alt = links.find((l) => !l['@rel'] || l['@rel'] === 'alternate');
  return alt?.['@href'] || links[0]?.['@href'] || txt(entry.guid) || '';
}

/** Parse RSS 2.0, RSS 1.0 (RDF) or Atom. Returns raw entries with common fields. */
export function parseFeed(xml) {
  const doc = parser.parse(xml);
  let entries = [];
  let feedTitle = '';
  if (doc.rss) {
    const ch = doc.rss.channel || {};
    feedTitle = txt(ch.title);
    entries = arr(ch.item);
  } else if (doc.feed) {
    feedTitle = txt(doc.feed.title);
    entries = arr(doc.feed.entry);
  } else if (doc['rdf:RDF']) {
    feedTitle = txt(doc['rdf:RDF'].channel?.title);
    entries = arr(doc['rdf:RDF'].item);
  } else {
    throw new Error('Not a RSS/Atom document');
  }

  const channel = doc.rss?.channel || doc.feed || doc['rdf:RDF']?.channel || {};
  return {
    title: feedTitle,
    description: stripHtml(txt(channel.description) || txt(channel.subtitle)),
    entries: entries.map((e) => {
      const html = txt(e['content:encoded']) || txt(e.content) || txt(e.description) || txt(e.summary) || txt(e['media:group']?.['media:description']);
      const date = txt(e.pubDate) || txt(e.published) || txt(e.updated) || txt(e['dc:date']);
      return {
        raw: e,
        title: stripHtml(txt(e.title)),
        link: linkOf(e),
        guid: txt(e.guid) || txt(e.id) || linkOf(e),
        html,
        text: stripHtml(txt(e.description) || txt(e.summary) || html),
        image: pickImage(e, html).url,
        smallImage: pickImage(e, html).small,
        publishedAt: date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : null,
        author: txt(e['dc:creator']) || txt(e.author?.name) || txt(e.author),
        categories: categoriesOf(e),
      };
    }),
  };
}

/** Find RSS/Atom <link rel="alternate"> URLs in an HTML page. */
export function discoverFeeds(html, baseUrl) {
  const out = [];
  const re = /<link\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    if (!/rel=["']?alternate/i.test(tag)) continue;
    if (!/type=["']?application\/(rss|atom)\+xml/i.test(tag)) continue;
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href) continue;
    if (/comment/i.test(href)) continue;
    try { out.push(new URL(decodeEntities(href), baseUrl).href); } catch { /* ignore */ }
  }
  return [...new Set(out)];
}

const FEED_URL_TTL = 14 * 24 * 3600e3;
// After a failed discovery, the site is not searched again before this delay: a dead site
// would otherwise cost the site page plus every guessed path, on every run.
export const DISCOVERY_RETRY_MS = 24 * 3600e3;
const GUESS_TIMEOUT_MS = 6000;
export const COMMON_PATHS = ['/feed', '/feed/', '/rss', '/rss.xml', '/feed.xml', '/atom.xml', '/spip.php?page=backend', '/index.xml', '/?format=feed&type=rss'];

/**
 * Fetch a source's feed: configured URL first, then the feed URL remembered in `cache`
 * from a previous run, then autodiscovery, then common paths. A cached URL that stops
 * working is dropped and the normal discovery takes over.
 */
export async function fetchSourceFeed(source, { cache } = {}) {
  const tried = [];
  const attempt = async (url, opts) => {
    tried.push(url);
    const { text, url: finalUrl } = await fetchText(url, opts);
    const parsed = parseFeed(text);
    if (!parsed.entries.some((e) => e.link && e.title)) throw new Error('Flux vide');
    return { ...parsed, feedUrl: finalUrl };
  };

  const failKey = `feedfail:${source.id}`;
  let firstError = '';
  const why = (err) => { if (!firstError) firstError = err?.name === 'AbortError' ? 'délai dépassé' : String(err?.message || err); };
  if (source.feed) {
    try { const feed = await attempt(source.feed); cache?.delete(failKey); return feed; } catch (err) { why(err); }
  }
  const cacheKey = `feed:${source.id}`;
  const remembered = !source.feed && cache?.get(cacheKey);
  if (remembered) {
    try { const feed = await attempt(remembered); cache.stats.hits++; cache.delete(failKey); return feed; }
    catch (err) { why(err); cache.stats.fallbacks++; }
  } else if (!source.feed && cache) cache.stats.misses++;
  if (cache?.get(failKey)) {
    // The remembered URL stays: a source that answers again next run must find it.
    throw new Error(`Aucun flux valide lors de la dernière recherche ; nouvel essai sous 24 h${firstError ? ` (${firstError})` : ''}`);
  }
  if (remembered) cache.delete(cacheKey);
  const found = async (url, opts) => {
    const feed = await attempt(url, opts);
    if (!source.feed) cache?.set(cacheKey, feed.feedUrl, FEED_URL_TTL);
    return feed;
  };
  if (source.site) {
    try {
      const { text: html, url: base } = await fetchText(source.site);
      for (const f of discoverFeeds(html, base)) {
        try { return await found(f); } catch { /* next */ }
      }
    } catch { /* site unreachable, try common paths anyway */ }
    // These paths are guesses: no retries and a short timeout, so that a dead site stays cheap.
    for (const p of COMMON_PATHS) {
      try { return await found(new URL(p, source.site).href, { retries: 0, timeoutMs: GUESS_TIMEOUT_MS }); } catch { /* next */ }
    }
  }
  cache?.set(failKey, true, DISCOVERY_RETRY_MS);
  // The remembered URL failed too, but nothing better was found: keep it for the next run
  // (a network outage must not make a working source forget its feed).
  if (remembered) cache.set(cacheKey, remembered, FEED_URL_TTL);
  throw new Error(`Aucun flux valide trouvé${firstError ? ` (${tried[0]} : ${firstError})` : ''} (essayés : ${[...new Set(tried)].join(', ') || 'aucun'})`);
}

/** Returns null when the entry has no valid http(s) link. */
export function entryToArticle(entry, source) {
  const url = safeUrl(entry.link);
  if (!url) return null;
  const author = cleanAuthor(entry.author);
  const categories = (entry.categories || []).slice(0, 4);
  // « Payant » on this one article when the feed says so (LWN's « [$] », « Réservé aux abonnés »…).
  const paid = source.paywall !== true && detectPaywall({ title: entry.title, text: entry.text, categories: entry.categories || [] });
  return {
    id: 'a-' + hashId(source.id, entry.guid || entry.link || entry.title),
    kind: 'article',
    platform: 'rss',
    source: { id: source.id, name: source.name, avatar: safeUrl(source.avatar), url: safeUrl(source.site), ...(source.suggested ? { suggested: true } : {}),
      // Optional flags of config/sources.json: `paywall` (true: mostly paid, "partial": sometimes),
      // and « EN » for a source that is not in French.
      ...(source.paywall === true || source.paywall === 'partial' ? { paywall: source.paywall } : {}), ...(source.lang && source.lang !== 'fr' ? { lang: source.lang } : {}) },
    title: truncate(cleanPaidTitle(entry.title), 220),
    ...(paid ? { paywall: true } : {}),
    text: truncate(cleanSummary(entry.text, entry.title), 1200),
    url,
    image: safeUrl(entry.image, url),
    ...(entry.smallImage && entry.image ? { _smallImage: true } : {}), // a feed thumbnail: og:image is tried and replaces it
    publishedAt: entry.publishedAt,
    ...(author ? { author } : {}),
    ...(categories.length ? { categories } : {}),
  };
}
