// Service worker.
//
// App shell: ONE versioned cache. VERSION is a hash of every shell file, stamped at deploy
// time by scripts/stamp-sw.mjs (no bundler). A new deployment therefore means a new
// sw.js, which downloads the whole shell into a new cache and only then takes over: a
// page can never mix an app.js of one deployment with a rank.js of another.
// Data: network-first, last good response served offline.

const VERSION = '__BUILD_ID__';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'app.js',
  'app/actions.js', 'app/cards.js', 'app/discover.js', 'app/dom.js', 'app/feed.js', 'app/focus.js', 'app/follow.js', 'app/fresh.js', 'app/hls.js',
  'app/infosheet.js', 'app/install.js', 'app/live.js', 'app/media.js', 'app/profile.js', 'app/reelcontrols.js', 'app/reels.js', 'app/refresh.js', 'app/remove.js', 'app/sheet.js', 'app/store.js',
  'app/tabs.js', 'app/util.js', 'app/viewer.js',
  'bsky.js', 'bskypost.js', 'find.js', 'freshness.js', 'install.js', 'norm.js', 'pack.js', 'pool.js', 'rank.js', 'saved.js', 'seen.js', 'topics.js', 'url.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

const SHELL_CACHE = `shell-${VERSION}`;
const DATA_CACHE = 'data'; // stable name: offline data survives an app update
// An unstamped copy (file opened without the dev server) must never cache the shell.
const UNSTAMPED = VERSION.startsWith('__');

const offlineResponse = () => new Response('Hors ligne', { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

self.addEventListener('install', (e) => {
  if (UNSTAMPED) { e.waitUntil(self.skipWaiting()); return; }
  e.waitUntil((async () => {
    try {
      const cache = await caches.open(SHELL_CACHE);
      // `reload` bypasses the HTTP cache: the whole shell comes from the same deployment.
      await cache.addAll(SHELL.map((p) => new Request(p, { cache: 'reload' })));
    } catch (err) {
      // All or nothing: a partial shell is never activated, the previous version stays.
      await caches.delete(SHELL_CACHE);
      throw err;
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE).map((k) => caches.delete(k))))
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
            caches.open(DATA_CACHE).then((c) => c.put(url.pathname, copy));
            return res;
          }
          return (await fromCache()) || res;
        })
        .catch(async () => (await fromCache()) || offlineResponse()),
    );
    return;
  }

  if (UNSTAMPED) return;

  // Shell: cache-first, from the cache of THIS version only. Never resolves to undefined:
  // with neither cache nor network, a navigation falls back to the cached index, anything
  // else to a 503.
  e.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const navigate = e.request.mode === 'navigate';
    const cached = await cache.match(e.request, { ignoreSearch: navigate });
    if (cached) return cached;
    try {
      return await fetch(e.request);
    } catch {
      return (navigate && (await cache.match('index.html'))) || offlineResponse();
    }
  })());
});
