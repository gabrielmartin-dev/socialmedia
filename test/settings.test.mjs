import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultSettings, sanitizeSettings, buildBackup, parseBackup, backupSummary, RESET_KEYS, BACKUP_KEYS,
  feedbackPayload, deviceLabel, FEEDBACK_ENDPOINT, FEEDBACK_MAX,
} from '../public/settings.js';

test('sanitizeSettings: keeps known values, falls back to the defaults for anything else', () => {
  assert.deepEqual(sanitizeSettings(null), defaultSettings());
  assert.deepEqual(sanitizeSettings('x'), defaultSettings());
  assert.deepEqual(sanitizeSettings({ theme: 'light', textSize: 'xlarge', autoplay: false }), { theme: 'light', textSize: 'xlarge', autoplay: false });
  assert.deepEqual(sanitizeSettings({ theme: 'pink', textSize: 'huge', autoplay: 'no' }), defaultSettings());
  assert.equal(defaultSettings().theme, 'dark', 'the app stays dark unless asked');
});

test('backup: only this app’s keys, with the right shape, round-trip through parseBackup', () => {
  const stored = {
    follows: { followed: ['a', 'b'], unfollowed: [], live: { 'bsky:x': {} } },
    saved: [{ id: '1' }], hidden: ['h1'], hidePaid: true, prefs: { sources: {}, keywords: {} },
    settings: { theme: 'light' }, opened: 'corrupt', otherSite: { secret: 1 },
  };
  const backup = buildBackup((k) => stored[k], new Date('2026-11-17T10:00:00Z'));
  assert.equal(backup.app, 'timeline-perso');
  assert.equal(backup.exportedAt, '2026-11-17T10:00:00.000Z');
  assert.ok(!('otherSite' in backup.data), 'another GitHub Pages site’s key is never exported');
  assert.ok(!('opened' in backup.data), 'a value of the wrong shape is left out');
  const { data, error } = parseBackup(JSON.stringify(backup));
  assert.equal(error, undefined);
  assert.deepEqual(data, backup.data);
  assert.equal(backupSummary(data), '3 abonnements, 1 enregistré, 1 post masqué');
});

test('parseBackup: refuses what is not a backup of this app', () => {
  assert.ok(parseBackup('pas du json').error);
  assert.ok(parseBackup('{"app":"autre","version":1,"data":{}}').error);
  assert.match(parseBackup('{"app":"timeline-perso","version":2,"data":{"hidden":[]}}').error, /plus récente/);
  assert.match(parseBackup('{"app":"timeline-perso","version":1,"data":{"hidden":"x","evil":[1]}}').error, /vide/);
  const { data } = parseBackup('{"app":"timeline-perso","version":1,"data":{"hidden":["a"],"evil":[1]}}');
  assert.deepEqual(data, { hidden: ['a'] }, 'unknown keys are dropped');
});

test('reset erases every key of the app but keeps the install pop-up key', () => {
  for (const k of Object.keys(BACKUP_KEYS)) assert.ok(RESET_KEYS.includes(k));
  assert.ok(RESET_KEYS.includes('seen2'));
  assert.ok(!RESET_KEYS.includes('installGuide'));
});

test('feedbackPayload: validates the message and only sends what the person wrote', () => {
  assert.ok(feedbackPayload({ message: '  ' }).error);
  assert.ok(feedbackPayload({ message: 'x'.repeat(FEEDBACK_MAX + 1) }).error);
  const anon = feedbackPayload({ kind: 'probleme', message: ' La vidéo ne se lance pas ', settings: { theme: 'dark', textSize: 'normal', autoplay: false } }).payload;
  assert.equal(anon.message, 'La vidéo ne se lance pas');
  assert.equal(anon.type, 'Un problème');
  assert.equal(anon.contact, '(anonyme)');
  assert.ok(!('email' in anon));
  assert.match(anon.reglages, /lecture auto non/);
  const withMail = feedbackPayload({ kind: 'nope', message: 'Super app', contact: 'lea@exemple.fr' }).payload;
  assert.equal(withMail.type, 'Autre chose');
  assert.equal(withMail.email, 'lea@exemple.fr', 'an email becomes the reply-to address');
  assert.equal(feedbackPayload({ message: 'Coucou', contact: '@lea.bsky.social' }).payload.email, undefined);
});

test('deviceLabel and the form endpoint', () => {
  assert.equal(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1', true), 'iPhone · Safari · app installée');
  assert.equal(deviceLabel('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36'), 'Android · Chrome');
  assert.match(FEEDBACK_ENDPOINT(), /^https:\/\/formspree\.io\/f\/\w+$/);
  assert.equal(FEEDBACK_ENDPOINT(''), '');
});
