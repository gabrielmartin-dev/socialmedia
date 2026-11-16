import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIssueBody, daysDown, findConfigEntry, nextState, parseState, sourceKey } from '../scripts/lib/source-check.mjs';

const config = {
  media: [{ id: 'a', name: 'Média A', feed: 'https://a.example/feed' }],
  tech: [{ id: 't', name: 'Tech T', site: 'https://t.example' }],
  youtube: [{ id: 'y', name: 'Chaîne Y', url: 'https://www.youtube.com/@y' }],
  bluesky: { accounts: [{ name: 'Personne P' }] },
};

test('findConfigEntry: matches a failing status entry to its config entry by type and name', () => {
  assert.equal(findConfigEntry(config, { type: 'rss', name: 'Média A' }).id, 'a');
  assert.equal(findConfigEntry(config, { type: 'tech', name: 'Tech T' }).id, 't');
  assert.equal(findConfigEntry(config, { type: 'youtube', name: 'Chaîne Y' }).id, 'y');
  assert.equal(findConfigEntry(config, { type: 'bluesky', name: 'Personne P' }).name, 'Personne P');
  assert.equal(findConfigEntry(config, { type: 'rss', name: 'Tech T' }), null, 'wrong type');
  assert.equal(findConfigEntry(config, { type: 'bsky-tag', name: '#greve' }), null);
});

test('state: firstSeen survives across days, recovered sources drop out, a corrupt body is ignored', () => {
  const day1 = Date.parse('2026-11-10T04:00:00Z');
  const day3 = Date.parse('2026-11-12T04:00:00Z');
  const a = { type: 'rss', name: 'Média A', error: 'HTTP 404' };
  const b = { type: 'youtube', name: 'Chaîne Y', error: 'timeout' };
  const s1 = nextState({}, [a, b], day1);
  const body1 = buildIssueBody({ failing: [a, b], checks: {}, state: s1, statusGeneratedAt: null, total: 10, now: day1 });
  const s3 = nextState(parseState(body1), [a], day3);
  assert.deepEqual(Object.keys(s3), [sourceKey(a)]);
  assert.equal(s3[sourceKey(a)].firstSeen, '2026-11-10T04:00:00.000Z');
  assert.equal(daysDown(s3[sourceKey(a)].firstSeen, day3), 2);
  assert.deepEqual(parseState('<!-- check-sources-state {oops} -->'), {});
  assert.deepEqual(parseState(undefined), {});
});

test('buildIssueBody: lists the error, the re-check and the candidate feeds, escaping table-breaking text', () => {
  const now = Date.parse('2026-11-12T04:00:00Z');
  const a = { type: 'rss', name: 'Média A', error: 'HTTP 404 | Not Found' };
  const state = nextState({}, [a], now);
  const body = buildIssueBody({
    failing: [a], state, total: 3, now, statusGeneratedAt: '2026-11-12T01:00:00Z',
    checks: { [sourceKey(a)]: { configured: 'https://a.example/feed', recheck: 'flux toujours en échec', candidates: [{ url: 'https://a.example/rss', entries: 12, latest: '2026-11-11' }] } },
  });
  assert.match(body, /1\/3 sources en échec/);
  assert.match(body, /### Média A \(rss\)/);
  assert.match(body, /HTTP 404 \\\| Not Found/);
  assert.match(body, /https:\/\/a\.example\/rss \(12 éléments, dernier : 2026-11-11\)/);
  assert.deepEqual(parseState(body), state);
});
