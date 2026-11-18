import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyPrefs, itemScore, LESS } from '../public/rank.js';
import { applyVote, revertVote, setVote, sanitizeVotes, MAX_VOTES } from '../public/votes.js';

const post = (id, src, kws) => ({ id, kind: 'post', source: { id: src }, publishedAt: new Date().toISOString(), keywords: kws.map((k) => ({ k, t: 'luttes', w: 1 })) });

test('a like raises the source and keywords, a dislike lowers them; taking it back restores them', () => {
  const prefs = emptyPrefs();
  const p = post('a', 'src1', ['grève', 'salaires']);
  const before = itemScore(p, { prefs });
  const votes = {};
  const hidden = new Set();
  setVote({ votes, prefs, hidden }, p, 1);
  assert.ok(itemScore(p, { prefs }) > before * 1.5);
  setVote({ votes, prefs, hidden }, p, -1); // like → dislike: the like is taken back first
  assert.ok(prefs.sources.src1 < 1 && prefs.keywords.grève < 1);
  assert.ok(itemScore(p, { prefs }) < before);
  assert.ok(hidden.has('a'), 'a disliked post does not come back after a refresh');
  setVote({ votes, prefs, hidden }, p, 0);
  assert.deepEqual(prefs, emptyPrefs());
  assert.equal(hidden.size, 0);
  assert.deepEqual(votes, {});
});

test('taking a vote back leaves the other preferences alone, even at a floor', () => {
  const prefs = emptyPrefs();
  prefs.sources.src1 = LESS.sourceFloor; // already at the floor (« Moins de ») : the dislike changes nothing
  const applied = applyVote(prefs, post('a', 'src1', ['x']), -1);
  assert.equal(applied.s.src1, undefined);
  prefs.keywords.y = 2; // changed in between by the ⋯ menu
  revertVote(prefs, applied);
  assert.equal(prefs.sources.src1, LESS.sourceFloor);
  assert.equal(prefs.keywords.y, 2);
  assert.equal(prefs.keywords.x, undefined);
});

test('a group vote changes only the keywords; a dislike hides its articles but not what was hidden before', () => {
  const prefs = emptyPrefs();
  const g = { id: 'g', kind: 'group', items: [post('a', 's1', ['k1']), post('b', 's2', ['k2'])] };
  const hidden = new Set(['a']);
  const votes = {};
  setVote({ votes, prefs, hidden }, g, -1);
  assert.deepEqual(prefs.sources, {});
  assert.ok(prefs.keywords.k1 < 1 && prefs.keywords.k2 < 1);
  assert.deepEqual([...hidden].sort(), ['a', 'b', 'g']);
  setVote({ votes, prefs, hidden }, g, 0);
  assert.deepEqual([...hidden], ['a']);
});

test('stored votes are cleaned and capped', () => {
  assert.deepEqual(sanitizeVotes(null), {});
  assert.deepEqual(sanitizeVotes({ a: { v: 2 }, b: { v: 1, t: 5, s: { x: 'no', y: 1.5 }, k: [] } }), { b: { v: 1, t: 5, s: { y: 1.5 }, k: {} } });
  const many = Object.fromEntries(Array.from({ length: MAX_VOTES + 10 }, (_, i) => [`id${i}`, { v: 1, t: i }]));
  const kept = sanitizeVotes(many);
  assert.equal(Object.keys(kept).length, MAX_VOTES);
  assert.ok(!('id0' in kept) && 'id609' in kept);
});
