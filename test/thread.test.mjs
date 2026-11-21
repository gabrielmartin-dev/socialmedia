// Replies under a post: counts and labels of the tree (public/app/threadtree.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { descendants, firstBatch, toggleLabel } from '../public/app/threadtree.js';

const n = (...replies) => ({ replies });

test('descendants counts every level of a branch', () => {
  assert.equal(descendants(n()), 0);
  assert.equal(descendants(n(n(), n(n(n())))), 4);
});

test('firstBatch: never a button for only one or two hidden replies', () => {
  assert.equal(firstBatch(3, 3), 3);
  assert.equal(firstBatch(5, 3), 5);
  assert.equal(firstBatch(6, 3), 3);
  assert.equal(firstBatch(40, 12), 12);
});

test('toggleLabel speaks French, singular and plural', () => {
  assert.equal(toggleLabel(1, true), 'Masquer la réponse');
  assert.equal(toggleLabel(4, true), 'Masquer les réponses');
  assert.equal(toggleLabel(1, false), 'Afficher 1 réponse');
  assert.equal(toggleLabel(7, false), 'Afficher 7 réponses');
});

test('the service worker caches the tree helpers (offline thread)', async () => {
  const sw = await fs.readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /'app\/threadtree\.js'/);
});
