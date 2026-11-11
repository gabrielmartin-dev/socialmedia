#!/usr/bin/env node
// Generates fictional demo data (public/data/*.json) to preview the UI offline,
// using the real scoring and grouping pipeline. Never deployed: the GitHub
// workflow always runs the real collector.

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileTopics, annotate, groupDuplicates } from './lib/score.mjs';
import { packFeed } from '../public/pack.js';
import { topicsForClient } from './lib/client-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const topicsCfg = JSON.parse(await fs.readFile(path.join(ROOT, 'config/topics.json'), 'utf8'));
const matchers = compileTopics(topicsCfg);

const ago = (min) => new Date(Date.now() - min * 60e3).toISOString();
// Demo images are written as SVG files (the app only accepts http(s)/same-origin URLs, not data: URIs).
const SAMPLE_DIR = path.join(ROOT, 'public', 'data', 'sample');
await fs.mkdir(SAMPLE_DIR, { recursive: true });
const svgFile = (name, svg) => { fsSync.writeFileSync(path.join(SAMPLE_DIR, name), svg); return `data/sample/${name}`; };
const slug = (label) => label.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
const pic = (hue, label = '') => svgFile(`pic-${hue}-${slug(label)}.svg`,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},55%,35%)"/><stop offset="1" stop-color="hsl(${hue + 40},60%,15%)"/></linearGradient></defs><rect width="640" height="360" fill="url(#g)"/><text x="320" y="190" font-family="sans-serif" font-size="28" fill="rgba(255,255,255,.6)" text-anchor="middle">${label}</text></svg>`);
const tall = (hue, label = '') => svgFile(`tall-${hue}-${slug(label)}.svg`,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 640"><rect width="360" height="640" fill="hsl(${hue},45%,22%)"/><text x="180" y="320" font-family="sans-serif" font-size="24" fill="rgba(255,255,255,.6)" text-anchor="middle">${label}</text></svg>`);

const src = (id, name) => ({ id, name, avatar: null });
const A = src('demo-a', 'Média A'), B = src('demo-b', 'Média B'), C = src('demo-c', 'Média C'), D = src('demo-d', 'Média D');
const E = { ...src('demo-e', 'Média suggéré E'), suggested: true };

const articles = [
  [A, 'Retraites : l’intersyndicale appelle à une nouvelle journée de grève jeudi', 'Les syndicats réclament le retrait de la réforme et annoncent des blocages.', 25, 210],
  [B, 'Nouvelle journée de grève jeudi : l’intersyndicale appelle à se mobiliser contre la réforme des retraites', 'Mobilisation attendue dans toute la France.', 70, 20],
  [C, 'Retraites : grève et manifestations jeudi à l’appel de l’intersyndicale', '', 110, 330],
  [D, 'Budget : le gouvernement envisage un nouveau 49.3 à l’Assemblée nationale', 'Une motion de censure serait déposée dans la foulée.', 50, 120],
  [A, 'Logement : les expulsions locatives en forte hausse cette année', 'Les associations alertent sur la précarité des locataires.', 180, 40],
  [B, 'Un festival de cinéma s’ouvre ce week-end', 'Programmation et invités.', 15, 280],
  [C, 'Hôpital : les soignants dénoncent le manque de moyens', 'Témoignages dans plusieurs services d’urgences.', 300, 0],
  [D, 'Salaires : le SMIC revalorisé, insuffisant selon les syndicats', '', 420, 160],
  [E, 'Grève : les cheminots reconduisent le mouvement', 'Article d’un média suggéré, visible seulement une fois suivi.', 5, 60],
].map(([s, title, text, min, hue], i) => ({
  id: 'demo-a' + i, kind: 'article', platform: 'rss', source: s, title, text,
  url: 'https://example.org/article/' + i, image: i % 3 === 2 ? null : pic(hue, 'image article'), publishedAt: ago(min),
}));

const posts = [
  ['demo-p1', 'Député·e exemple', 'depute.example', 'Le gouvernement passe encore en force avec le 49.3. Nous déposerons une motion de censure dès ce soir à l’Assemblée.', 35, true],
  ['demo-p2', 'Journaliste exemple', 'journaliste.example', 'Gros cortège en ce moment, des milliers de personnes contre la réforme des retraites. Ambiance déterminée.', 90, false],
  ['demo-p3', 'Militant·e exemple', 'militant.example', 'Belle journée, merci à toutes et tous pour vos messages !', 140, false],
].map(([id, name, handle, text, min, verified]) => ({
  id, kind: 'post', platform: 'bluesky',
  source: { id: 'bsky:' + handle, name, handle, avatar: null, verified, url: 'https://bsky.app/profile/' + handle },
  title: '', text, url: 'https://bsky.app/profile/' + handle, image: null,
  images: id === 'demo-p2' ? [{ thumb: pic(200, 'photo 1'), alt: '' }, { thumb: pic(260, 'photo 2'), alt: '' }] : undefined,
  publishedAt: ago(min),
  stats: { replies: 30 + min, reposts: 74 * (min % 7 + 1), likes: 1234 + min * 40 },
}));
posts[0].segments = [{ t: 'Le gouvernement passe encore en force avec le ' }, { t: '#49_3', href: 'https://bsky.app/hashtag/49_3' }, { t: '. Nous déposerons une motion de censure dès ce soir. Plus d’infos : ' }, { t: 'example.org/censure', href: 'https://example.org/censure' }];
posts[2].quote = { name: 'Journaliste exemple', handle: 'journaliste.example', avatar: null, text: 'OFFICIEL : début de la mobilisation demain matin devant l’Assemblée.', url: 'https://bsky.app', publishedAt: ago(300), image: null };
posts.push({
  id: 'demo-p4', kind: 'post', platform: 'bluesky',
  source: { id: 'bsky:video.example', name: 'Reporter terrain exemple', handle: 'video.example', avatar: null, verified: true, url: 'https://bsky.app' },
  title: '', text: 'Images du cortège ce soir, gaz lacrymogène place de la République #manif', url: 'https://bsky.app',
  video: { type: 'hls', src: 'https://example.org/none.m3u8', poster: pic(10, 'vidéo inline'), aspect: 16 / 9 },
  publishedAt: ago(45), stats: { replies: 12, reposts: 340, likes: 2100 },
});

const videos = [
  ['demo-v1', 'bluesky', 'Internaute exemple', 'Charge de CRS et gaz lacrymogène sur le cortège #manif', 20, 'hls', 9 / 16],
  ['demo-v2', 'youtube', 'Chaîne terrain exemple', 'Reportage : une journée sur un piquet de grève', 200, 'youtube', 16 / 9],
  ['demo-v3', 'bluesky', 'Autre internaute', 'Blocage du lycée ce matin #blocage #mobilisation', 60, 'hls', 9 / 16],
  ['demo-v4', 'youtube', 'Collectif streamers exemple', 'Best-of du dernier live', 600, 'youtube', 16 / 9],
].map(([id, platform, name, text, min, type, aspect], i) => ({
  id, kind: 'video', platform,
  source: { id: 'demo-vs' + i, name, avatar: null, url: 'https://example.org' },
  title: platform === 'youtube' ? text : '', text: platform === 'youtube' ? '' : text,
  url: 'https://example.org/video/' + i, image: null,
  video: { type, src: type === 'youtube' ? 'aqz-KE-bpKQ' : 'https://example.org/none.m3u8', poster: aspect < 1 ? tall(i * 70, 'vidéo ' + (i + 1)) : pic(i * 70, 'vidéo ' + (i + 1)), aspect },
  publishedAt: ago(min),
}));

const generatedAt = new Date().toISOString();
const out = path.join(ROOT, 'public', 'data');
await fs.mkdir(out, { recursive: true });
const actus = [...articles, ...posts].map((i) => annotate(i, matchers));
await fs.writeFile(path.join(out, 'actus.json'), JSON.stringify(packFeed({ generatedAt, scoreCap: topicsCfg.scoreCap, halfLifeHours: topicsCfg.halfLifeHours.actus, entries: groupDuplicates(actus, topicsCfg.dedup) })));
await fs.writeFile(path.join(out, 'videos.json'), JSON.stringify(packFeed({ generatedAt, scoreCap: topicsCfg.scoreCap, halfLifeHours: topicsCfg.halfLifeHours.videos, entries: videos.map((i) => annotate(i, matchers)) })));
const accounts = [A, B, C, D, E].map((x) => ({ id: x.id, name: x.name, avatar: null, kind: 'media', feed: 'actus', url: 'https://example.org', handle: 'example.org', description: 'Média fictif pour la démo.', suggested: !!x.suggested, category: 'Médias', lastTitle: 'Dernier article fictif', lastAt: ago(30) }));
accounts.push({ id: 'bsky:suggere.example', name: 'Personnalité suggérée', avatar: null, kind: 'bluesky', feed: 'actus', url: 'https://bsky.app', handle: '@suggere.example', description: 'Compte Bluesky fictif suggéré.', suggested: true, category: 'Personnalités', lastTitle: '', lastAt: null });
await fs.writeFile(path.join(out, 'accounts.json'), JSON.stringify({ generatedAt, accounts }));
await fs.writeFile(path.join(out, 'topics.json'), JSON.stringify(topicsForClient(topicsCfg, {})));
await fs.writeFile(path.join(out, 'status.json'), JSON.stringify({ generatedAt, sources: [{ type: 'demo', name: 'Données fictives', ok: true, count: actus.length + videos.length }] }, null, 1));
console.log('Données de démo écrites dans public/data/');
