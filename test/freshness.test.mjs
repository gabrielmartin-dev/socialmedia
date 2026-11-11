import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageLabel, newEntryCount, failedSources, failedLabel, latestGeneratedAt, exactTime } from '../public/freshness.js';
import { pruneOpened } from '../public/seen.js';

const NOW = Date.parse('2026-11-11T12:00:00Z');
const ago = (min) => new Date(NOW - min * 60e3).toISOString();

test('ageLabel: minutes, hours, days, and flags data older than 2 h as stale', () => {
  assert.deepEqual(ageLabel(ago(0), NOW), { text: 'à jour à l’instant', stale: false });
  assert.deepEqual(ageLabel(ago(12), NOW), { text: 'à jour il y a 12 min', stale: false });
  assert.deepEqual(ageLabel(ago(100), NOW), { text: 'mis à jour il y a 2 h', stale: false });
  assert.equal(ageLabel(ago(180), NOW).stale, true);
  assert.equal(ageLabel(ago(60 * 24 * 3), NOW).text, 'mis à jour il y a 3 j');
  assert.deepEqual(ageLabel(undefined, NOW), { text: '', stale: false });
});

test('newEntryCount: only entries with an unknown item count, a grown group counts', () => {
  const art = (id) => ({ id, kind: 'article' });
  const prev = { entries: [art('a'), { kind: 'group', id: 'g', items: [art('b'), art('c')] }] };
  assert.equal(newEntryCount(prev, { entries: [art('a'), { kind: 'group', id: 'g', items: [art('b'), art('c')] }] }), 0);
  assert.equal(newEntryCount(prev, { entries: [art('z'), art('a')] }), 1);
  assert.equal(newEntryCount(prev, { entries: [{ kind: 'group', id: 'g2', items: [art('b'), art('d')] }] }), 1);
  assert.equal(newEntryCount(prev, null), 0, 'a failed fetch is not news');
  assert.equal(newEntryCount(null, { entries: [art('a')] }), 1);
});

test('failed sources come from status.json', () => {
  const status = { sources: [{ name: 'A', ok: true }, { name: 'B', ok: false, error: 'HTTP 500' }] };
  assert.deepEqual(failedSources(status).map((s) => s.name), ['B']);
  assert.deepEqual(failedSources(null), []);
  assert.equal(failedLabel(1), '1 source indisponible');
  assert.equal(failedLabel(3), '3 sources indisponibles');
});

test('latestGeneratedAt takes the most recent date and ignores missing ones', () => {
  assert.equal(latestGeneratedAt({ generatedAt: ago(30) }, null, { generatedAt: ago(10) }), ago(10));
  assert.equal(latestGeneratedAt(null, undefined), null);
});

test('exactTime is a French date with the time', () => {
  assert.match(exactTime('2026-11-11T12:34:00Z'), /novembre 2026/);
  assert.match(exactTime('2026-11-11T12:34:00Z'), /\d{2}:\d{2}/);
  assert.equal(exactTime('nope'), '');
});

test('pruneOpened drops old entries and keeps the newest 500', () => {
  const DAY = 86400e3;
  const map = { old: NOW - 40 * DAY, fresh: NOW - DAY, bad: 'x' };
  assert.deepEqual(Object.keys(pruneOpened(map, NOW)), ['fresh']);
  const many = Object.fromEntries(Array.from({ length: 600 }, (_, i) => [`id${i}`, NOW - i * 1000]));
  const kept = pruneOpened(many, NOW);
  assert.equal(Object.keys(kept).length, 500);
  assert.ok('id0' in kept && !('id599' in kept));
});
