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

// ---------- lot 4: grouping ----------
import { groupDuplicates } from '../scripts/lib/score.mjs';
import { tokens, jaccard } from '../scripts/lib/text.mjs';
import { groupLead } from '../public/paywall.js';
import { leadItem } from '../public/saved.js';

const mkArt = (id, src, title, hAgo = 1, extra = {}) => ({ id, kind: 'article', source: { id: src }, title, publishedAt: new Date(NOW - hAgo * 3600e3).toISOString(), ...extra });
const sim = (a, b) => jaccard(tokens(a, { stem: true }), tokens(b, { stem: true }));

test('stemmed tokens: plurals, numbers and word families match', () => {
  assert.ok(sim('Retraites : des milliers de manifestants à Paris', 'Manifestation à Paris contre la réforme des retraites') >= 0.34);
  assert.ok(tokens('Le 49.3 et 20 ans de grèves', { stem: true }).includes('49'));
  assert.ok(tokens('Le 49.3 et 20 ans de grèves', { stem: true }).includes('20'));
  assert.deepEqual(tokens('grève grèves', { stem: true }).slice(0, 2).length, 2);
  assert.equal(new Set(tokens('grève grèves', { stem: true })).size, 1);
  assert.ok(sim('Budget 2027 : ce que contient le projet de loi', 'Budget 2027 : la gauche dépose une motion de censure') < 0.34);
  assert.deepEqual(tokens('Le gouvernement des grèves'), ['gouvernement', 'grèves'].map((w) => w.normalize('NFD').replace(/[̀-ͯ]/g, '')), 'default tokens unchanged');
  const g = groupDuplicates([
    mkArt('1', 'a', 'Retraites : des milliers de manifestants à Paris'),
    mkArt('2', 'b', 'Manifestation à Paris contre la réforme des retraites'),
  ]);
  assert.equal(g.length, 1);
  assert.equal(g[0].kind, 'group');
});

test('a chain A~B~C~D does not drag the ends together', () => {
  const w = 'pomme poire prune cerise mangue citron orange raisin melon fraise'.split(' ');
  const t = (a, b, c, d) => [w[a], w[b], w[c], w[d]].join(' ');
  const arts = [mkArt('a', 's1', t(0, 1, 2, 3)), mkArt('b', 's2', t(2, 3, 4, 5)), mkArt('c', 's3', t(4, 5, 6, 7)), mkArt('d', 's4', t(6, 7, 8, 9))];
  const opts = { similarity: 0.3, windowHours: 24 };
  const chained = groupDuplicates(arts, opts);
  assert.equal(chained.length, 1, 'without the check: one group of 4');
  assert.equal(chained[0].items.length, 4);
  const split = groupDuplicates(arts, { ...opts, minLeadSimilarity: 0.2 });
  const group = split.find((e) => e.kind === 'group');
  assert.deepEqual(group.items.map((i) => i.id).sort(), ['a', 'b', 'c']);
  assert.equal(split.length, 2);
  const close = groupDuplicates([
    mkArt('x', 'sa', 'Gérard Depardieu présente ses excuses et renonce à son procès'),
    mkArt('y', 'sb', 'Gérard Depardieu présente ses excuses, se désiste de son procès'),
    mkArt('z', 'sc', 'Depardieu renonce à son procès en appel et présente ses excuses'),
  ], { ...opts, minLeadSimilarity: 0.2 });
  assert.equal(close.length, 1);
  assert.equal(close[0].items.length, 3);
});

test('lead of a group card: free before sometimes-paid before paid, then image, then summary', () => {
  const paid = mkArt('p', 'mp', 'Payant', 1, { image: 'https://x/i.jpg', source: { id: 'mp', paywall: true } });
  const free = mkArt('f', 'sf', 'Gratuit', 1, { source: { id: 'sf' } });
  const free2 = mkArt('f2', 'sg', 'Gratuit 2', 1, { source: { id: 'sg' }, image: 'https://x/j.jpg' });
  const partial = mkArt('h', 'sh', 'Parfois', 1, { source: { id: 'sh', paywall: 'partial' }, image: 'https://x/k.jpg' });
  assert.equal(groupLead([paid, free]).id, 'f');
  assert.equal(groupLead([free, free2]).id, 'f2');
  assert.equal(groupLead([paid, partial]).id, 'h');
  assert.equal(groupLead([mkArt('s1', 'a', 'x', 1, { text: 'court' }), mkArt('s2', 'b', 'y', 1, { text: 'un résumé nettement plus long' })]).id, 's2');
  assert.equal(leadItem({ kind: 'group', items: [paid, free] }).id, 'f', 'saved uses the same lead');
});

// ---------- lot 5: discover ----------
import { rankSuggestions, activityNote, repostedBy, } from '../public/find.js';
import { discoveredAccounts } from '../scripts/lib/discover.mjs';
import { authorPosts } from '../scripts/lib/bluesky.mjs';
import { topicScore, emptyPrefs, lessKeywords } from '../public/rank.js';

test('suggestions: active and relevant first, then active off-topic, inactive last', () => {
  const acc = (id) => ({ id, name: id });
  const it = (id, src, kws) => ({ id, source: { id: src }, keywords: kws.map((k) => ({ k, w: 2, t: 'social' })) });
  const items = [
    ...[1, 2, 3, 4].map((i) => it('r' + i, 'relevant', ['grev'])),
    ...[1, 2, 3, 4].map((i) => it('o' + i, 'offtopic', [])),
  ];
  const prefs = emptyPrefs();
  const opts = { scoreOf: (x) => topicScore(x, prefs, 6), topicOf: (x) => (x.keywords.length ? 'social' : null) };
  const ranked = rankSuggestions([acc('idle'), acc('offtopic'), acc('relevant')], items, opts);
  assert.deepEqual(ranked.map((r) => r.account.id), ['relevant', 'offtopic', 'idle']);
  assert.equal(ranked[0].n, 4);
  assert.equal(ranked[0].topic, 'social');
  assert.equal(ranked[2].n, 0);
  assert.equal(activityNote(ranked[0], () => 'Social'), '4 posts récents · surtout Social');
  assert.equal(activityNote(ranked[2], () => 'Social'), 'Aucun post récent');
  // « Moins de [sujet] » lowers an account centred on that subject below the off-topic one
  lessKeywords(prefs, { items: items.slice(0, 1), kind: 'group' });
  for (let i = 0; i < 6; i++) lessKeywords(prefs, { kind: 'group', items: [items[0]] });
  assert.ok(prefs.keywords.grev <= 0.2 + 1e-9);
  const after = rankSuggestions([acc('offtopic'), acc('relevant')], items, opts);
  assert.equal(after.length, 2);
  assert.ok(after.find((r) => r.account.id === 'relevant').affinity < ranked[0].affinity);
});

test('discovery: reposted accounts counted once per distinct relayer', () => {
  const ev = (by, handle, extra = {}) => ({ by, author: { handle, displayName: handle, ...extra } });
  const events = [
    ev('A', 'new.bsky.social'), ev('A', 'new.bsky.social'), ev('B', 'new.bsky.social', { avatar: 'https://a/b.jpg' }), ev('C', 'new.bsky.social'),
    ev('A', 'once.bsky.social'),
    ev('A', 'known.bsky.social'), ev('B', 'known.bsky.social'),
    ev('A', 'bad.bsky.social', { avatar: 'javascript:alert(1)' }), ev('B', 'bad.bsky.social', { avatar: 'javascript:alert(1)' }),
  ];
  const out = discoveredAccounts(events, { exclude: new Set(['known.bsky.social']) });
  assert.deepEqual(out.map((a) => a.id), ['bsky:new.bsky.social', 'bsky:bad.bsky.social']);
  assert.deepEqual(out[0].by.sort(), ['A', 'B', 'C']);
  assert.equal(out[0].avatar, 'https://a/b.jpg');
  assert.equal(out[1].avatar, null, 'unsafe avatar dropped');
  const many = Array.from({ length: 20 }, (_, i) => [ev('A', `u${i}.bsky.social`), ev('B', `u${i}.bsky.social`)]).flat();
  assert.equal(discoveredAccounts(many).length, 12, 'capped at 12');
  assert.equal(repostedBy(['Mathilde Panot', 'Manuel Bompard', 'X', 'Y']), 'Reposté par Mathilde Panot, Manuel Bompard +2');
});

test('authorPosts reports reposts and quoted accounts to onRepost', async () => {
  const author = { did: 'did:plc:r', handle: 'other.bsky.social', displayName: 'Other' };
  const mine = { did: 'did:plc:m', handle: 'me.bsky.social' };
  const base = (id, a) => ({ uri: `at://${a.did}/app.bsky.feed.post/${id}`, cid: id, author: a, record: { text: 't', createdAt: new Date().toISOString() } });
  const quoting = { ...base('q', mine), embed: { $type: 'app.bsky.embed.record#view', record: { uri: 'at://did:plc:z/app.bsky.feed.post/zz', author: { handle: 'quoted.bsky.social', displayName: 'Quoted' }, value: { text: 'x', createdAt: new Date().toISOString() } } } };
  const client = { call: async () => ({ feed: [{ post: base('r', author), reason: { $type: 'app.bsky.feed.defs#reasonRepost' } }, { post: quoting }, { post: base('p', mine) }] }) };
  const seen = [];
  const posts = await authorPosts(client, { handle: 'me.bsky.social' }, 10, { onRepost: (a) => seen.push(a.handle) });
  assert.equal(posts.length, 2, 'reposts are still dropped');
  assert.deepEqual(seen.sort(), ['other.bsky.social', 'quoted.bsky.social']);
});

// ---------- lot 6: images ----------
import { parseFeed, entryToArticle } from '../scripts/lib/rss.mjs';
import { enrichArticles, dropRepeatedImages } from '../scripts/lib/enrich.mjs';
import { ResolutionCache } from '../scripts/lib/cache.mjs';
import { publicItem } from '../scripts/lib/archive.mjs';

test('a logo carried by 3 articles or more of one source is removed, other sources untouched', () => {
  const a = (id, src, image) => ({ id, kind: 'article', source: { id: src }, image });
  const items = [a('1', 's', 'L'), a('2', 's', 'L'), a('3', 's', 'L'), a('4', 's', 'L'), a('5', 's', 'ok'), a('6', 't', 'L'), a('7', 't', 'L')];
  assert.equal(dropRepeatedImages(items), 4);
  assert.deepEqual(items.map((i) => i.image), [null, null, null, null, 'ok', 'L', 'L']);
});

test('a small feed thumbnail is replaced by og:image when one is found, kept otherwise', async () => {
  const feed = (w) => `<?xml version="1.0"?><rss xmlns:media="http://search.yahoo.com/mrss/" version="2.0"><channel><title>T</title><item><title>Un titre assez long pour un article</title><link>https://ex.fr/a${w}</link><guid>a${w}</guid><media:thumbnail url="https://ex.fr/t${w}.jpg" width="${w}"/></item></channel></rss>`;
  const article = (w) => entryToArticle(parseFeed(feed(w)).entries[0], { id: 's', name: 'S', site: 'https://ex.fr' });
  const small = article(150); const big = article(800);
  assert.equal(small._smallImage, true);
  assert.equal(big._smallImage, undefined);
  const pages = [];
  const fetchPage = async (url) => { pages.push(url); return { html: `<head><meta property="og:image" content="${url}-og.jpg"></head>`, url }; };
  const cache = new ResolutionCache('/nonexistent/x.json');
  await enrichArticles([small, big], { cache, fetchPage });
  assert.deepEqual(pages, ['https://ex.fr/a150'], 'only the small thumbnail triggers a page read');
  assert.equal(small.image, 'https://ex.fr/a150-og.jpg');
  assert.equal(small._smallImage, undefined);
  assert.equal(big.image, 'https://ex.fr/t800.jpg');
  const stuck = article(150);
  await enrichArticles([stuck], { cache: new ResolutionCache('/nonexistent/y.json'), fetchPage: async (url) => ({ html: '<head></head>', url }) });
  assert.equal(stuck.image, 'https://ex.fr/t150.jpg', 'nothing found: the small image stays');
  assert.ok(!('_smallImage' in publicItem(stuck)), 'internal flag never published');
});

// ---------- topics without a chip (Écologie, Libertés) ----------
test('Écologie and Libertés score articles but add no chip', async () => {
  assert.equal(cfg.topics.ecologie.chip, false);
  assert.equal(cfg.topics.libertes.chip, false);
  for (const id of ['politique', 'social', 'ia', 'dev']) assert.notEqual(cfg.topics[id].chip, false, id);
  const src = await fs.readFile(new URL('../public/app/feed.js', import.meta.url), 'utf8');
  assert.match(src, /chip !== false/, 'renderChips skips topics with chip: false');
  const act = compileTopics(cfg, 'actus');
  assert.ok(kw('Climat : la COP31 s’ouvre à Antalya', act).includes('climat'));
  assert.ok(kw('Pesticides : la science et la justice donnent raison aux écologistes', act).some((k) => k === 'pesticide' || k === 'ecologistes'));
  const t = compileTopics(cfg, 'tech');
  assert.ok(kw('Reconnaissance faciale : surveillance de masse et vie privée', t).includes('reconnaissance faciale'));
  assert.ok(kw('Une faille critique dans Apache', t).includes('faille'));
  assert.equal(matchKeywords('Climat', act)[0].t, 'ecologie');
  // security keywords moved out of Dev
  assert.ok(!('security' in cfg.topics.dev.keywords) && 'security' in cfg.topics.libertes.keywords);
});
