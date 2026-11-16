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
