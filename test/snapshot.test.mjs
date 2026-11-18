import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idsOf, orderOf, restoreOrder, usableSnapshot, SNAPSHOT_MAX_AGE_MS } from '../public/snapshot.js';

const item = (id) => ({ id, kind: 'post' });
const group = (id, ...ids) => ({ kind: 'group', id, items: ids.map(item) });

test('orderOf keeps the first entries, groups as their article ids', () => {
  assert.deepEqual(orderOf([item('a'), group('g-b', 'b', 'c'), item('d')], 2), [['a'], ['b', 'c']]);
  assert.deepEqual(idsOf(item('x')), ['x']);
});

test('restoreOrder puts the saved entries back first, in their saved order', () => {
  const reshuffled = [item('d'), item('b'), item('new'), item('a'), item('c')];
  const out = restoreOrder(reshuffled, [['a'], ['b'], ['c']]);
  assert.deepEqual(out.map((e) => e.id), ['a', 'b', 'c', 'd', 'new']);
});

test('restoreOrder skips what disappeared and matches a group whose id changed', () => {
  const ranked = [item('z'), group('g-b2', 'b2', 'c'), item('a')];
  const out = restoreOrder(ranked, [['gone'], ['a'], ['b', 'c']]);
  assert.deepEqual(out.map((e) => e.id), ['a', 'g-b2', 'z']);
  // an entry is used once, even if two saved entries point at it
  assert.equal(restoreOrder(ranked, [['b2'], ['c']]).length, 3);
});

test('restoreOrder without a snapshot changes nothing', () => {
  const ranked = [item('a'), item('b')];
  assert.equal(restoreOrder(ranked, undefined), ranked);
  assert.equal(restoreOrder(ranked, []), ranked);
});

test('usableSnapshot ignores old, future or malformed snapshots', () => {
  const now = 1e12;
  assert.ok(usableSnapshot({ at: now - 60e3 }, now));
  assert.equal(usableSnapshot({ at: now - SNAPSHOT_MAX_AGE_MS - 1 }, now), null);
  assert.equal(usableSnapshot({ at: now + 60e3 }, now), null);
  assert.equal(usableSnapshot({}, now), null);
  assert.equal(usableSnapshot(null, now), null);
});
