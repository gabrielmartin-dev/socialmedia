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
