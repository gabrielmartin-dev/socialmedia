// Service worker: app shell cache-first, data network-first (offline fallback).
const VERSION = 'v11';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'rank.js', 'bsky.js', 'topics.js', 'url.js', 'pack.js', 'seen.js', 'pool.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

const offlineResponse = () => new Response('Hors ligne', { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(`shell-${VERSION}`).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  if (url.pathname.includes('/data/')) {
    // Only good responses are cached, so a 404/500 never overwrites the last good data.
    const fromCache = () => caches.match(url.pathname);
    e.respondWith(
      fetch(e.request)
        .then(async (res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(`data-${VERSION}`).then((c) => c.put(url.pathname, copy));
            return res;
          }
          return (await fromCache()) || res;
        })
        .catch(async () => (await fromCache()) || offlineResponse()),
    );
    return;
  }

  // Shell: stale-while-revalidate. Never resolves to undefined: with neither cache nor
  // network, a navigation falls back to the cached index, anything else to a 503.
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const network = fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(`shell-${VERSION}`).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(async () => cached
          || (e.request.mode === 'navigate' && (await caches.match('index.html')))
          || offlineResponse());
      return cached || network;
    }),
  );
});
