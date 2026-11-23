// hls.js, loaded on demand from cdnjs (Safari plays HLS natively and never needs it).

export const HLS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.13/hls.min.js';
// Subresource integrity of the file above.
export const HLS_SRI = 'sha384-w6Gb3fXHb5e1LUYa/hYA5Q41bEDglN5ZPCG7Jvnoo8/X90oGnlPqBlBJCe38mEMm';

let hlsPromise = null;
export function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls);
  hlsPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = HLS_URL;
    s.integrity = HLS_SRI;
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve(window.Hls);
    s.onerror = () => { hlsPromise = null; reject(new Error('hls.js')); };
    document.head.append(s);
  });
  return hlsPromise;
}

export const HLS_MIME = 'application/vnd.apple.mpegurl';

/**
 * Should this browser get the .m3u8 directly instead of hls.js?
 * Only Apple (Safari, every iOS browser) or a browser without MediaSource. Recent desktop and
 * Android Chrome answer "maybe" to canPlayType(HLS) but fail on Bluesky streams (MEDIA_ERR 4),
 * so canPlayType alone is not enough (hls.js recommends the same order).
 */
export function preferNativeHls(video, nav = navigator, win = window) {
  if (!video.canPlayType(HLS_MIME)) return false;
  if (/Apple/.test(nav.vendor || '')) return true;
  return !(win.MediaSource || win.ManagedMediaSource);
}
