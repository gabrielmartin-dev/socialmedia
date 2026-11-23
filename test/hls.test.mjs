import test from 'node:test';
import assert from 'node:assert/strict';
import { preferNativeHls } from '../public/app/hls.js';

const video = (answer) => ({ canPlayType: () => answer });
const chrome = { vendor: 'Google Inc.' };
const safari = { vendor: 'Apple Computer, Inc.' };
const mse = { MediaSource: function MediaSource() {} };

test('desktop/Android Chrome answering "maybe" still gets hls.js (videos did not start on PC)', () => {
  assert.equal(preferNativeHls(video('maybe'), chrome, mse), false);
});

test('Safari and iOS browsers keep native HLS', () => {
  assert.equal(preferNativeHls(video('maybe'), safari, mse), true);
  assert.equal(preferNativeHls(video('probably'), safari, {}), true);
});

test('native HLS only as a fallback without MediaSource', () => {
  assert.equal(preferNativeHls(video('maybe'), chrome, {}), true);
  assert.equal(preferNativeHls(video(''), chrome, {}), false);
  assert.equal(preferNativeHls(video(''), safari, mse), false);
});

test('CSP lets hls.js follow Bluesky segment redirects to video.cdn.bsky.app', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const connect = html.match(/connect-src([^;]*)/)[1].split(/\s+/);
  for (const host of ['https://video.bsky.app', 'https://video.cdn.bsky.app']) assert.ok(connect.includes(host), host);
});
