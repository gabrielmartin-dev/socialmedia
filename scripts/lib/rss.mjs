// RSS / Atom parsing into normalised items, with feed autodiscovery.

import { XMLParser } from 'fast-xml-parser';
import crypto from 'node:crypto';
import { fetchText } from './http.mjs';
import { stripHtml, truncate, decodeEntities } from './text.mjs';
import { safeUrl } from '../../public/url.js';

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

export function hashId(...parts) {
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
}

function firstImgInHtml(html) {
  const m = /<img[^>]+src=["']([^"']+)["']/i.exec(String(html || ''));
  return m ? decodeEntities(m[1]) : null;
}

function pickImage(entry, html) {
  for (const key of ['media:content', 'media:thumbnail']) {
    for (const m of arr(entry[key])) {
      const url = m?.['@url'];
      const type = m?.['@type'] || m?.['@medium'] || 'image';
      if (url && /image/.test(type)) return url;
      if (url && key === 'media:thumbnail') return url;
    }
  }
  const group = entry['media:group'];
  if (group) {
    const t = arr(group['media:thumbnail'])[0]?.['@url'] || arr(group['media:content']).find((c) => /image/.test(c?.['@type'] || c?.['@medium'] || ''))?.['@url'];
    if (t) return t;
  }
  for (const enc of arr(entry.enclosure)) {
    if (enc?.['@url'] && /^image\//.test(enc['@type'] || '')) return enc['@url'];
  }
  return firstImgInHtml(html);
}

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
        image: pickImage(e, html),
        publishedAt: date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : null,
        author: txt(e['dc:creator']) || txt(e.author?.name) || txt(e.author),
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
const COMMON_PATHS = ['/feed', '/feed/', '/rss', '/rss.xml', '/feed.xml', '/atom.xml', '/spip.php?page=backend', '/index.xml'];

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

  if (source.feed) {
    try { return await attempt(source.feed); } catch { /* fall through */ }
  }
  const cacheKey = `feed:${source.id}`;
  const remembered = !source.feed && cache?.get(cacheKey);
  if (remembered) {
    try { const feed = await attempt(remembered); cache.stats.hits++; return feed; }
    catch { cache.delete(cacheKey); cache.stats.fallbacks++; }
  } else if (!source.feed && cache) cache.stats.misses++;
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
    // These paths are guesses: no retries, so that a dead site stays cheap.
    for (const p of COMMON_PATHS) {
      try { return await found(new URL(p, source.site).href, { retries: 0 }); } catch { /* next */ }
    }
  }
  throw new Error(`Aucun flux valide trouvé (essayés : ${[...new Set(tried)].join(', ') || 'aucun'})`);
}

/** Returns null when the entry has no valid http(s) link. */
export function entryToArticle(entry, source) {
  const url = safeUrl(entry.link);
  if (!url) return null;
  return {
    id: 'a-' + hashId(source.id, entry.guid || entry.link || entry.title),
    kind: 'article',
    platform: 'rss',
    source: { id: source.id, name: source.name, avatar: safeUrl(source.avatar), url: safeUrl(source.site), ...(source.suggested ? { suggested: true } : {}) },
    title: truncate(entry.title, 220),
    text: truncate(entry.text && entry.text !== entry.title ? entry.text : '', 280),
    url,
    image: safeUrl(entry.image, url),
    publishedAt: entry.publishedAt,
  };
}
