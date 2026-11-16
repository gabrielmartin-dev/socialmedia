// Follows, suggestions and the timeline must agree with each other.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { state, isFollowed, itemVisible, accountFromSource } from '../public/app/store.js';
import { setFollow } from '../public/app/follow.js';
import { actions } from '../public/app/actions.js';
import { trimItems } from '../public/app/remove.js';
import { shownIn } from '../public/app/fresh.js';
import { newEntryCount } from '../public/freshness.js';

actions.afterFollow = () => {};

const dirEntry = (id, suggested = false) => [id, { id, name: id, kind: id.startsWith('bsky:') ? 'bluesky' : 'media', suggested }];

beforeEach(() => {
  state.follows = { followed: new Set(), unfollowed: new Set(), live: {} };
  state.accounts = new Map([dirEntry('media-a'), dirEntry('bsky:sugg.example', true)]);
  state.hidden = new Set();
  state.hidePaid = false;
  state.feeds.actus.topic = null;
});

test('an unfollowed suggestion stays unfollowed when the config later follows it by default', async () => {
  const account = state.accounts.get('bsky:sugg.example');
  await setFollow(account, true, { silent: true });
  assert.equal(isFollowed(account), true);
  await setFollow(account, false, { silent: true });
  assert.equal(isFollowed(account), false);
  // The config moves it from « suggested » to followed (like the accounts of PR #18).
  state.accounts.set(account.id, { ...account, suggested: false });
  assert.equal(isFollowed(state.accounts.get(account.id)), false, 'the explicit « Ne plus suivre » must hold');
  assert.equal(itemVisible({ id: 'p', source: { id: account.id } }), false, 'and its posts stay out of the feed');
});

test('« Suivre » state: the card menu agrees with the profile button for accounts outside the directory', () => {
  const stranger = { id: 'bsky:someone.example', name: 'Someone' }; // replied in a thread, hashtag video…
  assert.equal(isFollowed(stranger, { strict: true }), false, 'nobody offers « Ne plus suivre » for an account never followed');
  state.follows.followed.add(stranger.id);
  assert.equal(isFollowed(stranger, { strict: true }), true);
  // Directory accounts: same answer either way.
  assert.equal(isFollowed({ id: 'media-a' }, { strict: true }), true);
  assert.equal(isFollowed({ id: 'bsky:sugg.example', suggested: true }, { strict: true }), false);
  // Directory not loaded (offline first launch): fall back instead of « Suivre » on every feed card.
  state.accounts = new Map();
  assert.equal(isFollowed({ id: 'media-a' }, { strict: true }), true);
});

test('undoing « Ne plus suivre » of an account followed from search keeps its profile and its Tech feed', async () => {
  const id = 'bsky:dev.example';
  state.follows.followed.add(id);
  state.follows.live[id] = { name: 'Dev', handle: '@dev.example', avatar: null, description: 'bio', url: 'https://bsky.app/profile/dev.example', feed: 'tech' };
  const account = accountFromSource({ id, name: 'Dev' }); // what the card menu passes to setFollow
  assert.equal(account.feed, 'tech');
  await setFollow(account, false, { silent: true });
  assert.equal(state.follows.live[id], undefined);
  state.follows.live = {}; // no network in tests: loadLive would fetch the posts
  await setFollow(account, true, { silent: true }).catch(() => {});
  assert.equal(state.follows.live[id].feed, 'tech');
  assert.equal(state.follows.live[id].description, 'bio');
});

const art = (id, source, extra = {}) => ({ id, kind: 'article', source: { id: source }, title: id, ...extra });

test('trimItems: a grouped card keeps the articles of the other sources', () => {
  const ranked = [
    art('a1', 'unfollowed'),
    { id: 'g1', kind: 'group', items: [art('b1', 'unfollowed'), art('b2', 'x'), art('b3', 'y')] },
    { id: 'g2', kind: 'group', items: [art('c1', 'unfollowed'), art('c2', 'x')] },
    { id: 'g3', kind: 'group', items: [art('d1', 'x'), art('d2', 'y')] },
    art('e1', 'x'),
  ];
  const { entries, replacements } = trimItems(ranked, (i) => i.source.id === 'unfollowed');
  assert.deepEqual(entries.map((e) => e.id), ['a1', 'g1', 'g2']);
  assert.deepEqual(replacements.get('g1').items.map((i) => i.id), ['b2', 'b3']);
  assert.equal(replacements.get('g1').id, 'g1');
  assert.equal(replacements.get('g2').id, 'c2', 'one article left: a plain card');
  assert.equal(replacements.has('a1'), false, 'a plain card is simply taken off');
});

test('trimItems on paid articles matches the feed rebuilt with « Masquer les articles payants »', () => {
  const ranked = [
    { id: 'g', kind: 'group', items: [art('p1', 's', { paywall: true }), art('f1', 't'), art('f2', 'u')] },
    { id: 'gp', kind: 'group', items: [art('p2', 's', { paywall: true }), art('p3', 'v', { paywall: true })] },
  ];
  const { entries, replacements } = trimItems(ranked, (i) => i.paywall === true);
  assert.deepEqual(entries.map((e) => e.id), ['g', 'gp']);
  assert.deepEqual(replacements.get('g').items.map((i) => i.id), ['f1', 'f2']);
  assert.equal(replacements.has('gp'), false, 'all paid: the whole card goes');
});

test('« Nouveaux posts » only counts posts the feed would actually show', () => {
  const prev = { entries: [art('old', 'media-a')] };
  const fromSuggestion = { entries: [art('old', 'media-a'), { ...art('new', 'bsky:sugg.example'), source: { id: 'bsky:sugg.example', suggested: true } }] };
  const keep = (i) => shownIn('actus', i);
  assert.equal(newEntryCount(prev, fromSuggestion), 1);
  assert.equal(newEntryCount(prev, fromSuggestion, keep), 0, 'a post from a suggestion not followed is not news');

  const hidden = { entries: [art('old', 'media-a'), art('h', 'media-a')] };
  state.hidden.add('h');
  assert.equal(newEntryCount(prev, hidden, keep), 0, 'a hidden post is not news');

  const paid = { entries: [art('old', 'media-a'), art('p', 'media-a', { paywall: true })] };
  assert.equal(newEntryCount(prev, paid, keep), 1);
  state.hidePaid = true;
  assert.equal(newEntryCount(prev, paid, keep), 0, 'a paid article is not news once paid articles are hidden');

  const group = { entries: [art('old', 'media-a'), { id: 'g', kind: 'group', items: [art('old', 'media-a'), art('n2', 'media-a')] }] };
  assert.equal(newEntryCount(prev, group, keep), 1, 'a group with a new visible article counts');
});
