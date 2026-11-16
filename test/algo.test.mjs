// Algorithm fixes: keyword matching, topics of a post, topic labels, hidden groups,
// URL de-duplication, hashtag videos in French only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { compileTopics, matchKeywords, matchText } from '../public/topics.js';
import { annotate } from '../scripts/lib/score.mjs';
import { classifyLive } from '../public/app/live.js';
import { topicsOf, rank, mergeIntoTail } from '../public/rank.js';
import { freshAndUnique } from '../scripts/lib/dedupe.mjs';
import { searchVideos } from '../scripts/lib/bluesky.mjs';

const cfg = JSON.parse(await fs.readFile(new URL('../config/topics.json', import.meta.url), 'utf8'));
const actus = compileTopics(cfg, 'actus');
const tech = compileTopics(cfg, 'tech');
const kw = (text, m = actus) => matchKeywords(text, m).map((k) => k.k);

test('matchText reads the link card, the quote and the categories', () => {
  const post = { text: 'À lire 👇', external: { title: 'Retraites : l’intersyndicale appelle à la grève' } };
  assert.ok(kw(matchText(post)).includes('grev'));
  assert.ok(annotate({ ...post }, actus).keywords.some((k) => k.k === 'grev'));
  assert.ok(kw(matchText({ text: 'Ça', quote: { text: 'Grève générale' } })).includes('grev'));
  assert.ok(kw(matchText({ title: 'Ça', categories: ['Grève'] })).includes('grev'));
});

test('classifyLive gives the same keywords as the collector', () => {
  const p = { id: 'x', publishedAt: new Date().toISOString(), text: 'À lire', external: { title: 'La grève continue' }, source: { id: 'bsky:a' } };
  const live = classifyLive('bsky:a', [p], cfg).actus[0].keywords;
  assert.deepEqual(live, annotate({ ...p }, actus).keywords);
  assert.ok(live.length);
});

test('overlapping keywords are not counted twice', () => {
  assert.deepEqual(kw('Motion de censure déposée à l’Assemblée nationale contre le projet de loi').sort(), ['assemblee nationale', 'motion de censure', 'projet de loi']);
  assert.ok(!kw('Le Rassemblement national en tête').includes('rassemblement'));
  const k = kw('un rassemblement devant l’Assemblée nationale');
  assert.ok(k.includes('rassemblement') && k.includes('assemblee nationale'));
  assert.deepEqual(kw('Claude Code gets agentic workflows', tech).filter((x) => x.startsWith('claude')), ['claude code']);
  const k2 = kw('Claude écrit du code', tech);
  assert.ok(k2.includes('claude') && k2.includes('code'));
});

test('case-sensitive keywords: « j’ai » is not AI, « Corée du Sud » is not SUD', () => {
  assert.ok(!kw('J’ai testé le nouveau MacBook', tech).includes('AI'));
  assert.ok(kw('AI models are everywhere', tech).includes('AI'));
  assert.ok(kw('L’IA générative', tech).includes('ia'));
  assert.deepEqual(kw('Corée du Sud'), []);
  assert.deepEqual(kw('Séisme dans le sud de l’Italie'), []);
  const k = kw('SUD Rail appelle à la grève');
  assert.ok(k.includes('SUD') && k.includes('grev'));
});

test('prefixes: manifestement is not a demonstration, gouvernementale is the government', () => {
  assert.ok(!kw('Manifestement, le manifeste du parti ne convainc pas').some((k) => k.startsWith('manif')));
  assert.ok(kw('Des milliers de manifestants à Paris').includes('manifestant'));
  assert.ok(!kw('Elle a élucidé le mystère').includes('elu'));
  assert.ok(kw('l’impuissance gouvernementale').includes('gouvernement'));
});

test('a topic label needs keywords weighing topicMinScore', () => {
  const e = (keywords) => ({ id: 'a', keywords });
  assert.deepEqual(topicsOf(e([{ k: 'politique', w: 0.5, t: 'politique' }]), 1), []);
  assert.deepEqual(topicsOf(e([{ k: 'ministre', w: 1, t: 'politique' }]), 1), ['politique']);
  assert.deepEqual(topicsOf(e([{ k: 'a', w: 0.5, t: 'social' }, { k: 'b', w: 0.5, t: 'social' }]), 1), ['social']);
  const group = { kind: 'group', id: 'g', items: [e([{ k: 'a', w: 0.5, t: 'social' }]), e([{ k: 'b', w: 1.5, t: 'social' }])] };
  assert.deepEqual(topicsOf(group, 1), ['social']);
  assert.deepEqual(topicsOf(e([{ k: 'a', w: 0.5, t: 'social' }])), ['social'], 'no minimum: old behaviour');
  assert.equal(cfg.topicMinScore, 1);
});

test('a hidden group stays hidden when it grows, and so does an article that gets grouped', () => {
  const at = new Date().toISOString();
  const a = { id: 'a1', kind: 'article', source: { id: 's1' }, publishedAt: at, keywords: [] };
  const b = { id: 'b1', kind: 'article', source: { id: 's2' }, publishedAt: at, keywords: [] };
  const c = { id: 'c1', kind: 'article', source: { id: 's3' }, publishedAt: at, keywords: [] };
  const hidden = new Set(['g-a1', 'a1', 'b1']); // what « Masquer » records for the group of a and b
  const grown = { kind: 'group', id: 'g-a1', items: [a, b, c] };
  assert.deepEqual(rank([grown], {}, hidden), []);
  const regrouped = { kind: 'group', id: 'g-b1', items: [b, c] };
  assert.deepEqual(rank([regrouped, c], {}, new Set(['b1'])).map((e) => e.id), ['c1']);
  assert.equal(mergeIntoTail([], 0, [regrouped], {}, new Set(['b1'])), null);
});

test('same page from two sources: the outlet beats the aggregator, aggregators keep the first', () => {
  const now = new Date().toISOString();
  const mk = (id, sourceUrl, extra = {}) => ({ id, kind: 'article', url: 'https://blog.cloudflare.com/post', title: id, publishedAt: now, source: { id, url: sourceUrl }, ...extra });
  const hn = mk('hn', 'https://news.ycombinator.com/');
  const pub = mk('cf', 'https://blog.cloudflare.com/');
  assert.deepEqual(freshAndUnique([hn, pub], 72).map((i) => i.id), ['cf']);
  assert.deepEqual(freshAndUnique([pub, hn], 72).map((i) => i.id), ['cf']);
  assert.deepEqual(freshAndUnique([hn, mk('lob', 'https://lobste.rs/')], 72).map((i) => i.id), ['hn']);
});

test('hashtag videos: French or undeclared language only', async () => {
  const post = (id, langs) => ({
    uri: `at://did:plc:x/app.bsky.feed.post/${id}`, cid: id, author: { did: 'did:plc:x', handle: 'a.bsky.social' },
    record: { text: 'Blocage', createdAt: new Date().toISOString(), ...(langs ? { langs } : {}) },
    embed: { $type: 'app.bsky.embed.video#view', playlist: 'https://v.example/p.m3u8', thumbnail: 'https://v.example/t.jpg', aspectRatio: { width: 9, height: 16 } },
  });
  const client = { authenticated: false, call: async () => ({ posts: [post('1', ['fr']), post('2', ['en']), post('3', undefined), post('4', ['fr-CA', 'en'])] }) };
  const items = await searchVideos(client, '#blocage');
  assert.deepEqual(items.map((i) => i.id.split(/[:/]/).pop()).length, 3);
  assert.ok(!items.some((i) => i.id.includes('2')));
});

// ---------- lot 2: ranking ----------
import { entryScore, itemScore, engagementFactor, newSince, volumeFactors } from '../public/rank.js';

const lcg = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const NOW = Date.parse('2026-11-16T12:00:00Z');
const post = (id, src, extra = {}) => ({ id, kind: 'post', source: { id: src }, publishedAt: new Date(NOW - 3600e3).toISOString(), keywords: [], ...extra });

test('sharpness: a score twice as high wins ~67 % with 1, ~80 % with 2', () => {
  const a = post('a', 's1', { keywords: [{ k: 'x', w: 3, t: 'politique' }] });
  const b = post('b', 's2');
  const sa = itemScore(a, { now: NOW }); const sb = itemScore(b, { now: NOW });
  assert.ok(Math.abs(sa / sb - 2) < 0.3, `ratio ${sa / sb}`);
  const frac = (sharpness) => {
    const random = lcg(42); let wins = 0;
    for (let i = 0; i < 4000; i++) if (rank([a, b], { now: NOW, random, sharpness })[0].id === 'a') wins++;
    return wins / 4000;
  };
  const f1 = frac(1); const f2 = frac(2);
  assert.ok(f2 > f1 + 0.08, `${f1} -> ${f2}`);
  assert.deepEqual(rank([b, a], { now: NOW, sharpness: 2 }).map((e) => e.id), ['a', 'b'], 'deterministic order unchanged');
});

test('groupBoost: a story covered by 4 outlets beats the same article alone', () => {
  const art = (id, src) => ({ id, kind: 'article', source: { id: src }, publishedAt: new Date(NOW - 3600e3).toISOString(), keywords: [] });
  const items = ['a', 'b', 'c', 'd'].map((x) => art(x, 's' + x));
  const group = { kind: 'group', id: 'g-a', items };
  const alone = entryScore(items[0], { now: NOW, halfLife: 10 });
  assert.equal(entryScore(group, { now: NOW, halfLife: 10 }), alone, 'no boost by default');
  const boosted = entryScore(group, { now: NOW, halfLife: 10, groupBoost: 0.2 });
  assert.ok(Math.abs(boosted / alone - 1.4) < 1e-9);
});

test('relative engagement: the author’s usual level counts as 1', () => {
  const f = (likes, base) => engagementFactor({ likes, reposts: 0, base }, true);
  assert.equal(f(100, 100), 1);
  assert.ok(Math.abs(f(210, 100) - 1.5) < 0.01);
  assert.equal(f(5, 100), 1, 'never a penalty');
  assert.equal(f(100000, 100), 2, 'capped');
  assert.equal(engagementFactor({ likes: 100, reposts: 0 }, true), engagementFactor({ likes: 100, reposts: 0 }), 'no base: old formula');
});

test('volumeDamping: a very prolific source loses share in the top of the feed', () => {
  const entries = [];
  for (let i = 0; i < 30; i++) entries.push(post('big' + i, 'big'));
  for (let s = 0; s < 10; s++) for (let i = 0; i < 3; i++) entries.push(post(`s${s}-${i}`, 's' + s));
  const share = (volumeDamping) => {
    const random = lcg(7); let n = 0;
    for (let t = 0; t < 200; t++) n += rank(entries, { now: NOW, random, volumeDamping }).slice(0, 20).filter((e) => e.source.id === 'big').length;
    return n / (200 * 20);
  };
  const s0 = share(0); const s5 = share(0.5);
  assert.ok(s5 < s0 - 0.05, `${s0} -> ${s5}`);
  const f = volumeFactors(entries, 0.5);
  assert.equal(f.get('s1'), 1);
  assert.ok(f.get('big') >= 0.4 && f.get('big') < 1);
});

test('« nouveau » counts from the previous generation of the data when known', () => {
  assert.equal(newSince(5000, 3000), 3000);
  assert.equal(newSince(5000, 0), 5000);
  assert.equal(newSince(0, null), 0);
  // published between the previous generation (8h) and the previous visit (12h): new
  const gen = NOW - 4 * 3600e3; const visit = NOW;
  const item = post('p', 's', { publishedAt: new Date(NOW - 2 * 3600e3).toISOString() });
  const other = post('q', 't', { publishedAt: new Date(NOW - 6 * 3600e3).toISOString() });
  const order = rank([other, item], { now: NOW, lastVisit: newSince(visit, gen) });
  assert.equal(order[0].id, 'p');
  assert.equal(rank([item], { now: NOW, lastVisit: visit }).length, 1);
});

test('ranking config is shipped to the client with sane values', () => {
  assert.equal(cfg.ranking.sharpness, 2);
  assert.ok(cfg.ranking.groupBoost > 0);
});
