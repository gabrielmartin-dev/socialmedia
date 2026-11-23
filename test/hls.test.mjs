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
