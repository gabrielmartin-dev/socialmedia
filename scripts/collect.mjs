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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'data');

const readJson = async (p) => JSON.parse(await fs.readFile(path.join(ROOT, p), 'utf8'));

const status = [];
const report = (type, name, ok, info) => {
  status.push({ type, name, ok, ...(ok ? { count: info } : { error: String(info?.message || info) }) });
  const line = ok ? `✔ ${type.padEnd(8)} ${name} (${info})` : `✘ ${type.padEnd(8)} ${name} — ${info?.message || info}`;
  console.log(line);
};

async function collectMedia(media) {
  const results = await pool(media.map((src) => async () => {
    const feed = await fetchSourceFeed(src);
    const source = { ...src, avatar: src.avatar || faviconFor(src.site || feed.feedUrl) };
    return feed.entries.filter((e) => e.link && e.title).map((e) => entryToArticle(e, source));
  }));
  const items = [];
  results.forEach((r, i) => {
    if (r.ok) { items.push(...r.value); report('rss', media[i].name, true, r.value.length); }
    else report('rss', media[i].name, false, r.error);
  });
  return items;
}

async function collectBluesky(cfg, settings) {
  const posts = [];
  const videos = [];
  let client;
  try {
    client = await bsky.createClient();
  } catch (err) {
    report('bluesky', 'connexion', false, err);
    client = await bsky.createClient({});
  }

  const accounts = await pool(cfg.accounts.map((acc) => async () => {
    const resolved = await bsky.resolveAccount(client, acc);
    const items = await bsky.authorPosts(client, resolved, settings.bskyPostsPerAccount);
    return { resolved, items };
  }), 4);
  accounts.forEach((r, i) => {
    const name = cfg.accounts[i].name;
    if (!r.ok) return report('bluesky', name, false, r.error);
    const { resolved, items } = r.value;
    for (const it of items) (it.kind === 'video' ? videos : posts).push(it);
    // Videos from followed accounts also appear in Actus as regular posts.
    for (const it of items) if (it.kind === 'video') posts.push({ ...it, kind: 'post' });
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
  return { posts, videos };
}

async function collectYouTube(channels) {
  const seen = new Set();
  const results = await pool(channels.map((ch) => async () => {
    const resolved = await yt.resolveChannel(ch);
    if (seen.has(resolved.id)) return { dup: true, items: [] };
    seen.add(resolved.id);
    return { items: await yt.channelVideos(ch, resolved) };
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
    const { text } = await fetchText(`${base}/tiktok/user/@${acc.user}`, { timeoutMs: 25000 });
    const feed = parseFeed(text);
    return feed.entries.map((e) => {
      const vid = /\/video\/(\d+)/.exec(e.link)?.[1];
      return {
        id: 't-' + (vid || hashId(e.link)),
        kind: 'video',
        platform: 'tiktok',
        source: { id: acc.id, name: acc.name, handle: acc.user, avatar: null, url: `https://www.tiktok.com/@${acc.user}` },
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
    items.push(...r.value);
    report('tiktok', accounts[i].name, true, r.value.length);
  });
  return items;
}

function freshAndUnique(items, maxAgeHours) {
  const cutoff = Date.now() - maxAgeHours * 3600e3;
  const future = Date.now() + 3600e3;
  const map = new Map();
  for (const it of items) {
    const t = Date.parse(it.publishedAt);
    if (!Number.isFinite(t) || t < cutoff || t > future) continue;
    if (!map.has(it.id)) map.set(it.id, it);
  }
  return [...map.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

async function main() {
  const sources = await readJson('config/sources.json');
  const topicsCfg = await readJson('config/topics.json');
  const settings = sources.settings;
  const matchers = compileTopics(topicsCfg);

  const [articles, bluesky, ytVideos, ttVideos] = await Promise.all([
    collectMedia(sources.media),
    collectBluesky(sources.bluesky, settings),
    collectYouTube(sources.youtube),
    collectTikTok(sources.tiktok || []),
  ]);

  const actusItems = freshAndUnique([...articles, ...bluesky.posts], settings.actusMaxAgeHours).map((i) => annotate(i, matchers));
  const videoItems = freshAndUnique([...bluesky.videos, ...ytVideos, ...ttVideos], settings.videosMaxAgeHours).map((i) => annotate(i, matchers));

  const meta = {
    generatedAt: new Date().toISOString(),
    scoreCap: topicsCfg.scoreCap,
  };

  await fs.mkdir(OUT, { recursive: true });
  await fs.writeFile(path.join(OUT, 'actus.json'), JSON.stringify({
    ...meta,
    halfLifeHours: topicsCfg.halfLifeHours.actus,
    entries: groupDuplicates(actusItems, topicsCfg.dedup),
  }));
  await fs.writeFile(path.join(OUT, 'videos.json'), JSON.stringify({
    ...meta,
    halfLifeHours: topicsCfg.halfLifeHours.videos,
    entries: videoItems,
  }));
  await fs.writeFile(path.join(OUT, 'status.json'), JSON.stringify({ generatedAt: meta.generatedAt, sources: status }, null, 2));

  const failed = status.filter((s) => !s.ok).length;
  console.log(`\nActus : ${actusItems.length} éléments · Vidéos : ${videoItems.length} · Sources en échec : ${failed}/${status.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
