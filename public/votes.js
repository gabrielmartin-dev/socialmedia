// 👍 / 👎 under a post: a lighter, one-tap « Plus de ça » / « Moins de ça » that stays visible
// on the card and can be taken back at any time (tap again), even days later.
//
// A vote multiplies the weight of the post's source (not for a group) and of its keywords, like
// the ⋯ menu does, but less strongly: it is meant to be used often. What it actually multiplied
// (after the floors / ceilings) is stored with it, so that taking it back divides by exactly that
// and leaves the other preferences alone.

import { LESS, keywordsOf } from './rank.js';

export const VOTES_KEY = 'votes';
/** Votes kept on the phone (the oldest are forgotten, their effect on the weights stays). */
export const MAX_VOTES = 600;

export const VOTE = {
  like: { source: 1.5, keyword: 1.5 },
  dislike: { source: 0.6, keyword: 0.6 },
};
const BOUNDS = {
  source: [LESS.sourceFloor, 1 / LESS.sourceFloor],
  keyword: [LESS.keywordFloor, 1 / LESS.keywordFloor],
};

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

/** Multiplies map[key] by f within bounds; a weight back at 1 is dropped. Returns the factor really applied. */
function scale(map, key, f, bounds) {
  const prev = map[key] ?? 1;
  const next = clamp(prev * f, bounds);
  if (Math.abs(next - 1) < 1e-6) delete map[key]; else map[key] = next;
  return next / prev;
}

/**
 * Applies a vote (1 = like, -1 = dislike) of `entry` to `prefs` (mutated).
 * Returns what was applied: { s: { sourceId: factor }, k: { keyword: factor } }.
 */
export function applyVote(prefs, entry, v) {
  const f = v > 0 ? VOTE.like : VOTE.dislike;
  const out = { s: {}, k: {} };
  if (entry.kind !== 'group' && entry.source?.id) {
    const id = entry.source.id;
    const applied = scale(prefs.sources, id, f.source, BOUNDS.source);
    if (Math.abs(applied - 1) > 1e-9) out.s[id] = applied;
  }
  for (const { k } of keywordsOf(entry)) {
    const applied = scale(prefs.keywords, k, f.keyword, BOUNDS.keyword);
    if (Math.abs(applied - 1) > 1e-9) out.k[k] = applied;
  }
  return out;
}

/** Takes back what `applyVote` returned. */
export function revertVote(prefs, applied) {
  for (const [id, f] of Object.entries(applied?.s || {})) scale(prefs.sources, id, 1 / f, BOUNDS.source);
  for (const [k, f] of Object.entries(applied?.k || {})) scale(prefs.keywords, k, 1 / f, BOUNDS.keyword);
}

/** Ids hidden by a dislike: the post, and the articles of a group (its id changes when a media joins). */
export const dislikedIds = (entry) => [entry.id, ...(entry.kind === 'group' ? entry.items.map((i) => i.id) : [])];

const okFactors = (o) => o && typeof o === 'object' && !Array.isArray(o)
  ? Object.fromEntries(Object.entries(o).filter(([, f]) => Number.isFinite(f) && f > 0))
  : {};

/** Stored votes, cleaned: id → { v: 1 | -1, t, s, k, h? }; only the MAX_VOTES most recent. */
export function sanitizeVotes(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const list = Object.entries(raw)
    .filter(([id, x]) => id && x && (x.v === 1 || x.v === -1))
    .map(([id, x]) => [id, {
      v: x.v, t: Number.isFinite(x.t) ? x.t : 0, s: okFactors(x.s), k: okFactors(x.k),
      ...(Array.isArray(x.h) ? { h: x.h.filter((i) => typeof i === 'string') } : {}),
    }])
    .sort((a, b) => b[1].t - a[1].t)
    .slice(0, MAX_VOTES);
  return Object.fromEntries(list);
}

/**
 * Sets the vote on `entry` to `v` (1, -1, or 0 = none) in `votes` and `prefs` (both mutated):
 * the previous vote is taken back first. `hidden` (Set) receives / loses the disliked ids.
 * Returns the new vote.
 */
export function setVote({ votes, prefs, hidden }, entry, v, now = Date.now()) {
  const prev = votes[entry.id];
  if (prev) {
    revertVote(prefs, prev);
    for (const id of prev.h || []) hidden?.delete(id);
    delete votes[entry.id];
  }
  if (!v) return 0;
  const rec = { v, t: now, ...applyVote(prefs, entry, v) };
  if (v < 0) {
    // Only what was not hidden already (« Masquer ce post » is not undone by taking the 👎 back).
    rec.h = dislikedIds(entry).filter((id) => !hidden?.has(id));
    rec.h.forEach((id) => hidden?.add(id));
  }
  votes[entry.id] = rec;
  return v;
}
