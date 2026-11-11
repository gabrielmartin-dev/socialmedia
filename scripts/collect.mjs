#!/usr/bin/env node
// Collects every source, scores keywords, groups duplicates and writes
// public/data/{actus,videos,status}.json. A failing source never stops the run.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, faviconFor, fetchText } from './lib/http.mjs';
import { fetchSourceFeed, entryToArticle, parseFeed, hashId } from './lib/rss.mjs';
import * as bsky from './lib/bluesky.mjs';
import * as yt from './lib/youtube.mjs';
import { compileTopics, annotate, groupDuplicates } from './lib/score.mjs';
import { truncate } from './lib/text.mjs';
import { sanitizeItem } from './lib/sanitize.mjs';
import { safeUrl } from '../public/url.js';
import { checkRun } from './lib/health.mjs';
import { packFeed } from '../public/pack.js';
import { topicsForClient } from './lib/client-config.mjs';
import { ResolutionCache, cachedResolve, DAY, HOUR } from './lib/cache.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'data');
// Persistent resolutions (restored / saved by actions/cache between runs).
const CACHE_DIR = process.env.COLLECT_CACHE_DIR || path.join(ROOT, '.cache', 'collect');
const cache = new ResolutionCache(path.join(CACHE_DIR, 'resolutions.json'));

const readJson = async (p) => JSON.parse(await fs.readFile(path.join(ROOT, p), 'utf8'));

const status = [];
const report = (type, name, ok, info) => {
  status.push({ type, name, ok, ...(ok ? { count: info } : { error: String(info?.message || info) }) });
  const line = ok ? `✔ ${type.padEnd(8)} ${name} (${info})` : `✘ ${type.padEnd(8)} ${name} — ${info?.message || info}`;
  console.log(line);
};

// Directory of every working account, for the "Découvrir" tab.
const directory = new Map();
function register(entry) {
  if (!directory.has(entry.id)) directory.set(entry.id, { ...entry, avatar: safeUrl(entry.avatar), url: safeUrl(entry.url), description: truncate(entry.description || '', 200) });
}

async function collectMedia(media, type = 'rss') {
  const feedName = type === 'tech' ? 'tech' : 'actus';
  const results = await pool(media.map((src) => async () => {
    const feed = await fetchSourceFeed(src, { cache });
    const source = { ...src, avatar: src.avatar || faviconFor(src.site || feed.feedUrl) };
    register({
      id: src.id, name: src.name, avatar: source.avatar, kind: 'media', feed: feedName,
      url: src.site || feed.feedUrl, handle: (src.site || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''),
      description: feed.description, suggested: !!src.suggested, category: src.category || (type === 'tech' ? 'Tech' : 'Médias'),
    });
    return feed.entries.filter((e) => e.link && e.title).map((e) => entryToArticle(e, source)).filter(Boolean);
  }));
  const items = [];
  results.forEach((r, i) => {
    if (r.ok) { items.push(...r.value); report(type, media[i].name, true, r.value.length); }
    else report(type, media[i].name, false, r.error);
  });
  return items;
}

async function collectBluesky(cfg, settings) {
  const posts = [];
  const videos = [];
  const tech = [];
  let client;
  try {
    client = await bsky.createClient();
  } catch (err) {
    report('bluesky', 'connexion', false, err);
    client = await bsky.createClient({});
  }

  const accounts = await pool(cfg.accounts.map((acc) => async () => {
    // The profile (and the name → handle search) is remembered; a stale entry falls back
    // to a fresh resolution.
    const { resolved, result: items } = await cachedResolve(cache, `bsky:${acc.handle || acc.name}`,
      () => bsky.resolveAccount(client, acc),
      { ttlMs: 12 * HOUR, use: (r) => bsky.authorPosts(client, r, settings.bskyPostsPerAccount) });
    return { resolved, items };
  }), 4);
  accounts.forEach((r, i) => {
    const name = cfg.accounts[i].name;
    if (!r.ok) return report('bluesky', name, false, r.error);
    const { resolved, items } = r.value;
    const acc = cfg.accounts[i];
    const feedName = acc.feed === 'tech' ? 'tech' : 'actus';
    const target = feedName === 'tech' ? tech : posts;
    if (acc.suggested) for (const it of items) it.source.suggested = true;
    register({
      id: 'bsky:' + resolved.handle, name: resolved.displayName || acc.name, avatar: resolved.avatar, kind: 'bluesky',
      feed: feedName, url: `https://bsky.app/profile/${resolved.handle}`, handle: '@' + resolved.handle,
      description: resolved.description, suggested: !!acc.suggested, category: acc.category || (feedName === 'tech' ? 'Tech' : 'Personnalités'),
    });
    for (const it of items) if (it.kind === 'video') videos.push(it);
    // Every post (videos included) also appears in its text feed.
    for (const it of items) target.push({ ...it, kind: 'post' });
    report('bluesky', `${name} → @${resolved.handle}${resolved.verified ? ' ✓' : ''}`, true, items.length);
  });

  const searches = await pool(cfg.videoHashtags.map((tag) => () =>
    bsky.searchVideos(client, tag, { limit: settings.bskySearchLimit, sinceHours: settings.videosMaxAgeHours })), 3);
  searches.forEach((r, i) => {
    const tag = cfg.videoHashtags[i];
    if (!r.ok) return report('bsky-tag', tag, false, r.error);
    for (const it of r.value) it.tag = tag;
    videos.push(...r.value);
    report('bsky-tag', tag, true, r.value.length);
  });
  return { posts, videos, tech };
}

async function collectYouTube(channels) {
  const seen = new Set();
  const results = await pool(channels.map((ch) => async () => {
    // Channel id, avatar and description are remembered (no more channel page download).
    let items;
    const { resolved } = await cachedResolve(cache, `yt:${ch.channelId || ch.url}`, () => yt.resolveChannel(ch), {
      ttlMs: 7 * DAY,
      use: async (r) => {
        if (seen.has(r.id)) { items = []; return r; }
        items = await yt.channelVideos(ch, r);
        return r;
      },
    });
    if (seen.has(resolved.id)) return { dup: true, items: [] };
    seen.add(resolved.id);
    register({
      id: 'yt:' + resolved.id, name: ch.name, avatar: resolved.avatar, kind: 'youtube', feed: 'videos',
      url: `https://www.youtube.com/channel/${resolved.id}`, handle: 'YouTube',
      description: resolved.description, suggested: !!ch.suggested, category: ch.category || 'YouTube',
    });
    return { items };
  }), 4);
  const items = [];
  results.forEach((r, i) => {
    if (!r.ok) return report('youtube', channels[i].name, false, r.error);
    if (r.value.dup) return report('youtube', `${channels[i].name} (doublon de chaîne, ignoré)`, true, 0);
    items.push(...r.value.items);
    report('youtube', channels[i].name, true, r.value.items.length);
  });
  return items;
}

async function collectTikTok(accounts) {
  const results = await pool(accounts.map((acc) => async () => {
    const base = (process.env.RSSHUB_BASE || acc.rsshub || 'https://rsshub.app').replace(/\/$/, '');
    const { text } = await fetchText(`${base}/tiktok/user/@${acc.user}`, { timeoutMs: 25000, retries: 1 });
    const feed = parseFeed(text);
    return feed.entries.map((e) => {
      const vid = /\/video\/(\d+)/.exec(e.link)?.[1];
      return {
        id: 't-' + (vid || hashId(e.link)),
        kind: 'video',
        platform: 'tiktok',
        source: { id: acc.id, name: acc.name, handle: acc.user, avatar: null, url: `https://www.tiktok.com/@${acc.user}`, ...(acc.suggested ? { suggested: true } : {}) },
        title: '',
        text: truncate(e.title || e.text, 300),
        url: e.link,
        image: e.image,
        video: vid ? { type: 'tiktok', src: vid, poster: e.image, aspect: 9 / 16 } : undefined,
        publishedAt: e.publishedAt,
      };
    }).filter((i) => i.video);
  }), 2);
  const items = [];
  results.forEach((r, i) => {
    if (!r.ok) return report('tiktok', accounts[i].name, false, r.error);
    const acc = accounts[i];
    register({ id: acc.id, name: acc.name, avatar: null, kind: 'tiktok', feed: 'videos', url: `https://www.tiktok.com/@${acc.user}`, handle: '@' + acc.user, suggested: !!acc.suggested, category: acc.category || 'TikTok' });
    items.push(...r.value);
    report('tiktok', accounts[i].name, true, r.value.length);
  });
  return items;
}

function freshAndUnique(items, maxAgeHours) {
  const cutoff = Date.now() - maxAgeHours * 3600e3;
  const future = Date.now() + 3600e3;
  const map = new Map();
  const urls = new Set();
  for (const raw of items) {
    const it = sanitizeItem(raw);
    if (!it) continue;
    const t = Date.parse(it.publishedAt);
    if (!Number.isFinite(t) || t < cutoff || t > future) continue;
    if (map.has(it.id) || (it.url && urls.has(it.url))) continue;
    map.set(it.id, it);
    if (it.url) urls.add(it.url);
  }
  return [...map.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

async function main() {
  await cache.load();
  const sources = await readJson('config/sources.json');
  const topicsCfg = await readJson('config/topics.json');
  const settings = sources.settings;
  const matchers = compileTopics(topicsCfg, 'actus');
  const techMatchers = compileTopics(topicsCfg, 'tech');

  const [articles, techArticles, bluesky, ytVideos, ttVideos] = await Promise.all([
    collectMedia(sources.media),
    collectMedia(sources.tech || [], 'tech'),
    collectBluesky(sources.bluesky, settings),
    collectYouTube(sources.youtube),
    collectTikTok(sources.tiktok || []),
  ]);

  const actusItems = freshAndUnique([...articles, ...bluesky.posts], settings.actusMaxAgeHours).map((i) => annotate(i, matchers));
  const techItems = freshAndUnique([...techArticles, ...bluesky.tech], settings.techMaxAgeHours ?? 168).map((i) => annotate(i, techMatchers));
  const videoItems = freshAndUnique([...bluesky.videos, ...ytVideos, ...ttVideos], settings.videosMaxAgeHours).map((i) => annotate(i, matchers));

  // Resolutions learned during this run are kept even if the run is then rejected.
  await cache.save().catch((err) => console.warn(`Cache de résolutions non sauvegardé : ${err.message}`));
  console.log(`Cache de résolutions : ${cache.stats.hits} utilisés, ${cache.stats.misses} résolus, ${cache.stats.fallbacks} périmés`);

  // Refuse to publish a mostly-failed run: exiting non-zero keeps the previous deployment.
  const health = checkRun(status, { actus: actusItems.length, tech: techItems.length, videos: videoItems.length }, settings);
  if (!health.ok) {
    const failedN = status.filter((s) => !s.ok).length;
    console.error(`\nCollecte jugée défaillante (${failedN}/${status.length} sources en échec) : ${health.reasons.join(' ; ')}.`);
    console.error('Aucune donnée écrite : le déploiement précédent est conservé.');
    process.exit(2);
  }

  const meta = {
    generatedAt: new Date().toISOString(),
    scoreCap: topicsCfg.scoreCap,
  };

  await fs.mkdir(OUT, { recursive: true });
  await fs.writeFile(path.join(OUT, 'actus.json'), JSON.stringify(packFeed({
    ...meta,
    halfLifeHours: topicsCfg.halfLifeHours.actus,
    entries: groupDuplicates(actusItems, topicsCfg.dedup),
  })));
  await fs.writeFile(path.join(OUT, 'tech.json'), JSON.stringify(packFeed({
    ...meta,
    halfLifeHours: topicsCfg.halfLifeHours.tech ?? 24,
    entries: groupDuplicates(techItems, topicsCfg.dedup),
  })));
  await fs.writeFile(path.join(OUT, 'videos.json'), JSON.stringify(packFeed({
    ...meta,
    halfLifeHours: topicsCfg.halfLifeHours.videos,
    entries: videoItems,
  })));
  // Last activity per account, for the Découvrir tab.
  const lastPost = new Map();
  for (const it of [...actusItems, ...techItems, ...videoItems]) {
    const prev = lastPost.get(it.source.id);
    if (!prev || Date.parse(it.publishedAt) > Date.parse(prev.publishedAt)) lastPost.set(it.source.id, it);
  }
  const accounts = [...directory.values()].map((a) => {
    const last = lastPost.get(a.id);
    return { ...a, lastTitle: last ? truncate(last.title || last.text || '', 140) : '', lastAt: last?.publishedAt || null };
  });
  await fs.writeFile(path.join(OUT, 'accounts.json'), JSON.stringify({ generatedAt: meta.generatedAt, accounts }));
  await fs.writeFile(path.join(OUT, 'topics.json'), JSON.stringify(topicsForClient(topicsCfg, settings)));
  await fs.writeFile(path.join(OUT, 'status.json'), JSON.stringify({ generatedAt: meta.generatedAt, sources: status }, null, 2));

  const failed = status.filter((s) => !s.ok).length;
  console.log(`\nActus : ${actusItems.length} éléments · Tech : ${techItems.length} · Vidéos : ${videoItems.length} · Sources en échec : ${failed}/${status.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
