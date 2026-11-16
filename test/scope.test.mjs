import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { compileTopics } from '../scripts/lib/score.mjs';
import { compileScope, outOfScope, filterScope, generalistOrigins } from '../scripts/lib/scope.mjs';
import { topicsForClient } from '../scripts/lib/client-config.mjs';

const topics = JSON.parse(await fs.readFile(new URL('../config/topics.json', import.meta.url), 'utf8'));
const sources = JSON.parse(await fs.readFile(new URL('../config/sources.json', import.meta.url), 'utf8'));
const matchers = compileTopics(topics, 'actus');
const scope = compileScope(topics.scope);
const art = (title, url = 'https://www.francetvinfo.fr/politique/x.html', extra = {}) =>
  ({ kind: 'article', title, text: '', url, ...extra });

test('scope: the franceinfo beauty-tips article is out of scope despite « gouvernement » and « hôpital »', () => {
  const it = art('Kératites, brûlures, cécité... Les faux bons conseils beauté sur les réseaux qui vous envoient à l\'hôpital',
    'https://www.francetvinfo.fr/sante/medecine-esthetique/keratites.html',
    { text: 'L\'exercice de la médecine esthétique va être davantage contrôlé. Le gouvernement prend de nouvelles mesures.' });
  assert.equal(outOfScope(it, scope, matchers), 'rubrique sante');
  // Same text without the URL section: the keyword still catches it.
  assert.match(outOfScope({ ...it, url: 'https://example.org/a' }, scope, matchers), /^mot-clé (beaute|esthetique)$/);
});

test('scope: political and social news of a generalist source is kept', () => {
  for (const t of [
    'Budget 2027 : le gouvernement envisage le 49.3 à l\'Assemblée nationale',
    'Retraites : l\'intersyndicale appelle à une nouvelle journée de grève',
    'Motion de censure : les députés LFI déposent un texte',
  ]) assert.equal(outOfScope(art(t), scope, matchers), null, t);
});

test('scope: a strong political score wins over an off-topic section', () => {
  const it = art('Hôpital public : grève des soignants contre le budget de la Sécu, le gouvernement sous pression',
    'https://www.francetvinfo.fr/sante/hopital/greve.html');
  assert.equal(outOfScope(it, scope, matchers), null);
});

test('scope: sport, crime news and items without any topic are dropped', () => {
  assert.equal(outOfScope(art('Ligue des champions : le PSG s\'impose', 'https://www.francetvinfo.fr/sports/foot/psg.html'), scope, matchers), 'rubrique sports');
  assert.match(outOfScope(art('Ligue 1 : Lens bat Lille au terme d\'un match fou', 'https://www.lemonde.fr/x/article/1.html'), scope, matchers), /^mot-clé/);
  assert.match(outOfScope(art('Un carambolage fait trois blessés sur l\'A7', 'https://www.lemonde.fr/x/article/1.html'), scope, matchers), /^mot-clé|^score/);
  assert.equal(outOfScope(art('Les ventes de voitures électriques progressent', 'https://www.lemonde.fr/economie/article/1.html'), scope, matchers), 'score 0 < 1.5');
  assert.equal(outOfScope(art('Recettes de saison', 'https://x.org/a', { categories: ['Gastronomie'] }), scope, matchers), 'catégorie gastronomie');
});

test('scope: Bluesky posts are judged on their text and link card', () => {
  const post = { kind: 'post', text: 'À lire', external: { url: 'https://www.afp.com/fr/sport/rugby', title: 'XV de France : la composition', description: '' } };
  assert.equal(outOfScope(post, scope, matchers), 'rubrique sport');
});

test('scope: only the generalist sources are filtered', () => {
  const generalist = generalistOrigins(sources, (a) => `bsky:${a.handle || a.name}`);
  assert.ok(generalist.has('media:franceinfo') && generalist.has('media:lemonde') && generalist.has('bsky:afp.com'));
  assert.ok(!generalist.has('media:mediapart') && !generalist.has('media:lfi'));
  const sport = art('Ligue 1 : le PSG s\'impose', 'https://example.org/sport/psg');
  const { kept, dropped } = filterScope([
    { ...sport, id: 1, _origin: 'media:franceinfo' },
    { ...sport, id: 2, _origin: 'media:mediapart' },
  ], { scope, matchers, generalist });
  assert.deepEqual(kept.map((i) => i.id), [2]);
  assert.equal(dropped[0].reason, 'rubrique sport');
});

test('scope config stays in the collector', () => {
  assert.equal(topicsForClient(topics).scope, undefined);
  assert.ok(topicsForClient(topics).topics.politique);
});

// ---------- lot 3: topics and scope ----------
import { matchKeywords } from '../public/topics.js';
const techMatchers = compileTopics(topics, 'tech');
const found = (t, m = matchers) => matchKeywords(t, m).map((k) => k.k);

test('scope: only Politique and Social weigh in, so a new topic does not widen the filter', () => {
  const extra = { ...topics, topics: { ...topics.topics, ecologie: { label: 'Écologie', feed: 'actus', keywords: { canicule: 5 } } } };
  const withTopic = compileTopics(extra, 'actus');
  const it = art('Canicule : le thermomètre explose', 'https://www.francetvinfo.fr/meteo/x.html');
  assert.equal(outOfScope(it, scope, withTopic), outOfScope(it, scope, matchers));
  assert.ok(outOfScope(art('Canicule sur la France', 'https://www.francetvinfo.fr/x/y.html'), scope, withTopic));
});

test('scope: international items need 3 points, a lone weak word is not enough', () => {
  const chile = art('Élections au Chili : la droite en tête', 'https://www.lemonde.fr/international/article/2026/11/16/chili.html');
  assert.match(outOfScope(chile, scope, matchers), /^international, score \d+(\.\d+)? < 3$/);
  const gov = art('Le gouvernement japonais présente son plan', 'https://www.lemonde.fr/asie-pacifique/article/1.html');
  assert.match(outOfScope(gov, scope, matchers), /^international/);
  const strike = art('Grève générale en Argentine contre l’austérité', 'https://www.lemonde.fr/international/article/2.html');
  assert.equal(outOfScope(strike, scope, matchers), null);
  const gaza = art('Gaza : le génocide dénoncé par des ONG', 'https://www.lemonde.fr/proche-orient/article/3.html');
  assert.equal(outOfScope(gaza, scope, matchers), null);
  // Courrier international is entirely international: its own bar applies to every URL
  const ci = art('Le Parlement britannique ajourne la séance', 'https://www.courrierinternational.com/article/x');
  assert.match(outOfScope(ci, scope, matchers, { minScore: 3 }), /^international/);
  assert.equal(sources.media.find((s) => s.id === 'courrierintl').scopeMinScore, 3);
});

test('topics: the themes missing from the keywords are now found', () => {
  assert.ok(found('Sans-papiers : la préfecture multiplie les OQTF').includes('oqtf'));
  assert.ok(found('Bolloré, CNews et la concentration des médias').includes('concentration des medias'));
  assert.ok(found('Israël bombarde le Liban').includes('israel'));
  assert.ok(found('Taxe Zucman : les ultra-riches et les dividendes du CAC 40').includes('taxe zucman'));
  assert.ok(found('Cinq pays dévoilent leur projet de hub de retour au Rwanda, pour des personnes migrantes').includes('migrant'));
  assert.ok(found('Le RN et le PS à l’Assemblée').includes('RN') && found('Le RN et le PS à l’Assemblée').includes('PS'));
  assert.ok(!found('Le groupe de rock pops').includes('PS'));
  assert.ok(found('Nvidia lance de nouveaux GPU pour les datacenters', techMatchers).includes('nvidia'));
  assert.ok(found('Docker et Postgres : migrer vers SQLite', techMatchers).includes('docker'));
});
