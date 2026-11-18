import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { compileTopics } from '../scripts/lib/score.mjs';
import { compileRight, rightReason, filterRight, headline } from '../scripts/lib/scope.mjs';
import { uniqueVideos, capTagVideos } from '../scripts/lib/dedupe.mjs';

const topics = JSON.parse(await fs.readFile(new URL('../config/topics.json', import.meta.url), 'utf8'));
const matchers = compileTopics(topics, 'actus');
const right = compileRight(topics.scope.right);
const tagVideo = (text, source = { id: 'bsky:quelquun.bsky.social', name: 'Quelqu’un', handle: '@quelquun.bsky.social' }, extra = {}) =>
  ({ kind: 'video', text, source, tag: '#retraites', _origin: 'tag:#retraites', ...extra });

test('right: the Droite TV account is dropped everywhere, even on a neutral post', () => {
  const src = { id: 'bsky:droite-tv.bsky.social', name: 'Droite TV', handle: '@droite-tv.bsky.social' };
  assert.equal(rightReason(tagVideo('Pour Mathieu Slama, la capitalisation fait passer la retraite de droit social à produit financier.', src), right), 'source Droite TV');
  assert.equal(rightReason({ kind: 'post', text: 'Bonjour', source: { ...src, name: 'Autre nom' } }, right, { open: false }), 'source Autre nom');
});

test('right: hashtag videos centered on right-wing figures are dropped', () => {
  for (const t of [
    'Bardella propose de plafonner à 4 les trimestres validés au chômage sans cotisation. #retraites',
    '✅ Plus juste et moins déficitaire : Marine Le Pen et Jordan Bardella allient justice sociale et sérieux budgétaire pour réparer notre système de retraites.',
    '🇫🇷 Le #RN et sa candidate à l\'élection présidentielle, Marine #LePen, a proposé mardi matin une réforme des #retraites',
    'Zemmour en meeting à Lyon',
    'Pascal Praud recadre un invité sur CNews',
  ]) assert.match(rightReason(tagVideo(t), right) || '', /^droite : /, t);
});

test('right: a social struggle against the right is kept, and so is ordinary news', () => {
  assert.equal(rightReason(tagVideo('Manifestation contre le RN à Toulouse, des milliers de personnes dans la rue'), right), null);
  assert.equal(rightReason(tagVideo('Grève à la SNCF : les cheminots contre la réforme de Bardella'), right), null);
  assert.equal(rightReason(tagVideo('Départ de la manifestation lyonnaise du 17 novembre ! #Lyon #manifestation'), right), null);
  // « rn » inside a word or lower case is not the party.
  assert.equal(rightReason(tagVideo('Un tournage en plein Paris'), right), null);
});

test('right: the figure must be in the headline (title or start of the post)', () => {
  const long = 'Grand reportage sur les retraites des caissières de supermarché à Lille. '.repeat(4) + 'Bardella a réagi.';
  assert.equal(rightReason(tagVideo(long), right), null);
  assert.equal(headline({ title: 'Titre', text: 'Bardella' }), 'Titre');
  assert.match(rightReason({ kind: 'video', title: 'Bardella face aux syndicats', text: '', source: { id: 'x' }, tag: '#greve' }, right) || '', /bardella/);
});

test('right: followed accounts keep their posts, generalist sources are filtered', () => {
  const left = { id: 1, kind: 'post', text: 'Marine Le Pen est contre la hausse du SMIC. Son programme, c’est les coupes budgétaires.', source: { id: 'bsky:clemenceguette.bsky.social', name: 'Clémence Guetté' }, _origin: 'bsky:clemenceguette.bsky.social' };
  const afp = { id: 2, kind: 'post', text: 'Jordan Bardella reçu à l’Élysée', source: { id: 'bsky:afp.com', name: 'AFP' }, _origin: 'bsky:afp.com' };
  const { kept, dropped } = filterRight([left, afp], { right, generalist: new Set(['bsky:afp.com']) });
  assert.deepEqual(kept.map((i) => i.id), [1]);
  assert.equal(dropped[0].reason, 'droite : bardella');
});

test('videos: the same video posted twice by an account is shown once', () => {
  const v = (id, text, src, source = 'a') => ({ id, text, source: { id: source }, video: { src } });
  const out = uniqueVideos([
    v(1, 'Manifestation à Lyon ce samedi 14 novembre 2026. 15 000 personnes. #Lyon', 's1'),
    v(2, 'Manifestation à Lyon ce samedi 14 novembre 2026. 15 000 personnes. #Lyon', 's2'), // re-upload, same text
    v(3, 'Autre vidéo', 's1', 'b'), // same file
    v(4, 'Manifestation à Lyon ce samedi 14 novembre 2026. 15 000 personnes. #Lyon', 's4', 'c'), // other account
    v(5, 'Court', 's5'), v(6, 'Court', 's6'), // too short to compare texts
  ]);
  assert.deepEqual(out.map((i) => i.id), [1, 4, 5, 6]);
});

test('videos: at most N hashtag videos per account, followed channels untouched', () => {
  const items = [
    ...[1, 2, 3, 4, 5].map((id) => ({ id, source: { id: 'spam' }, tag: '#retraites' })),
    ...[6, 7, 8, 9].map((id) => ({ id, source: { id: 'yt:chaine' } })),
  ];
  assert.deepEqual(capTagVideos(items, 3, (i) => !!i.tag).map((i) => i.id), [1, 2, 3, 6, 7, 8, 9]);
});

import { compileTagVideos, tagVideoReason, looksEnglish } from '../scripts/lib/scope.mjs';
const tagCfg = compileTagVideos(topics.scope.tagVideos);

test('hashtag videos: English « manifestation » (law of attraction) is dropped', () => {
  assert.match(tagVideoReason(tagVideo('#manifestation #affirmations #lawofattraction #dailyaffirmations #manifesting'), tagCfg) || '', /^mot-clé/);
  assert.equal(tagVideoReason(tagVideo('🧠 The mind shapes your reality. 💬 What thought will you choose to shape your day? #Manifestation'), tagCfg), 'en anglais');
  assert.ok(tagVideoReason(tagVideo("🙌🏼 Today's #manifestation #factoftheday is that the energy you emit into the universe shapes your reality."), tagCfg));
});

test('hashtag videos: French protest videos stay, even with hashtags only', () => {
  for (const t of [
    '#manif #toulouse #17novembre',
    'Clowns partout, police nulle part, avec "J\'ai deux passions" en fond sonore. #fanfare #clown #france #grenoble #manif #manifestation #protest #greve',
    'À 12 h 10, le cortège de la manifestation passe par les voies sur berges à Angers.',
    'Manifestation en cours au Mans ! #snes #fsu #lutte #greve',
  ]) assert.equal(tagVideoReason(tagVideo(t), tagCfg), null, t);
  assert.equal(looksEnglish('Les manifestants passent sous un drapeau. #protest'), false);
});
