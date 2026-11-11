import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { stampSw } from '../scripts/lib/stamp.mjs';

const SW_SOURCE = await fs.readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tl-sw-'));
let counter = 0;

// Inside a service worker, relative URLs resolve against the script URL; Node needs it spelled out.
const NodeRequest = Request;
globalThis.Request = class extends NodeRequest {
  constructor(input, init) { super(typeof input === 'string' ? new URL(input, 'https://app.test/').href : input, init); }
};

const pathOf = (r) => (typeof r === 'string' ? new URL(r, 'https://app.test/').pathname : new URL(r.url).pathname);

// A tiny CacheStorage: name -> Map(pathname -> Response).
function fakeCaches(store = new Map(), { failAddAll = false } = {}) {
  const cacheFor = (name) => {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name);
    return {
      put: async (k, v) => { m.set(pathOf(k), v); },
      match: async (k) => m.get(pathOf(k))?.clone(),
      addAll: async (reqs) => {
        if (failAddAll) throw new TypeError('network error while caching');
        for (const r of reqs) m.set(pathOf(r), new Response(`${name}:${pathOf(r)}`, { status: 200 }));
      },
    };
  };
  return {
    store,
    open: async (n) => cacheFor(n),
    keys: async () => [...store.keys()],
    delete: async (n) => store.delete(n),
    match: async (k) => { for (const m of store.values()) { const hit = m.get(pathOf(k)); if (hit) return hit.clone(); } return undefined; },
  };
}

/** Loads the service worker stamped with `version`, against fake caches / network. */
async function load({ network, version = 'test1', caches = fakeCaches() }) {
  const file = path.join(tmpDir, `sw-${++counter}.mjs`);
  await fs.writeFile(file, stampSw(SW_SOURCE, version));
  const handlers = {};
  globalThis.self = { addEventListener: (t, fn) => { handlers[t] = fn; }, skipWaiting() { self.skipped = true; }, clients: { claim() {} } };
  globalThis.location = new URL('https://app.test/');
  globalThis.caches = caches;
  globalThis.fetch = network;
  await import(file);
  const settled = (p) => p;
  const fire = async (type) => { let p; handlers[type]({ waitUntil: (x) => { p = x; } }); return settled(p); };
  const run = async (urlPath, { mode } = {}) => {
    let p;
    const request = mode ? { url: `https://app.test${urlPath}`, method: 'GET', mode } : new Request(`https://app.test${urlPath}`);
    handlers.fetch({ request, respondWith: (x) => { p = x; } });
    return p;
  };
  return { handlers, caches, run, install: () => fire('install'), activate: () => fire('activate'), self: globalThis.self };
}
const flush = () => new Promise((r) => setTimeout(r, 5));
const offline = async () => { throw new TypeError('offline'); };

test('data: a 500 never overwrites the cached good data and the cache is served', async () => {
  let mode = 'ok';
  const { run, caches } = await load({
    network: async () => (mode === 'ok' ? new Response('{"good":1}', { status: 200 }) : new Response('boom', { status: 500 })),
  });
  assert.equal(await (await run('/data/actus.json')).text(), '{"good":1}');
  await flush();
  mode = '500';
  const res = await run('/data/actus.json');
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '{"good":1}');
  await flush();
  assert.equal(await caches.store.get('data').get('/data/actus.json').text(), '{"good":1}');
});

test('data: 404 with an empty cache is passed through, and not cached', async () => {
  const { run, caches } = await load({ network: async () => new Response('nope', { status: 404 }) });
  assert.equal((await run('/data/tech.json')).status, 404);
  await flush();
  assert.equal(caches.store.get('data')?.size ?? 0, 0);
});

test('data: offline with an empty cache gives a clean 503, never undefined', async () => {
  const { run } = await load({ network: offline });
  const res = await run('/data/actus.json');
  assert.ok(res instanceof Response);
  assert.equal(res.status, 503);
});

test('shell: neither cache nor network resolves to an error response, not undefined', async () => {
  const { run } = await load({ network: offline });
  const res = await run('/app.js');
  assert.ok(res instanceof Response);
  assert.equal(res.status, 503);
});

test('shell: offline navigation falls back to the cached index', async () => {
  const caches = fakeCaches();
  const { install, run } = await load({ network: offline, caches });
  caches.store.set('shell-test1', new Map([['/index.html', new Response('<html>index</html>')]]));
  assert.equal(await (await run('/some/page?x=1', { mode: 'navigate' })).text(), '<html>index</html>');
  void install;
});

test('update is atomic: the new shell only comes from its own cache, never mixed with the old one', async () => {
  const caches = fakeCaches();
  // Version A fully installed and active.
  const a = await load({ network: offline, version: 'AAAA', caches });
  await a.install();
  assert.ok(caches.store.has('shell-AAAA'));
  assert.equal(await (await a.run('/app.js')).text(), 'shell-AAAA:/app.js');

  // Version B installs: it fills shell-BBBB completely while A is still serving A only.
  const b = await load({ network: offline, version: 'BBBB', caches });
  await b.install();
  assert.equal(b.self.skipped, true);
  assert.equal(await (await b.run('/app.js')).text(), 'shell-BBBB:/app.js');
  assert.equal(await (await b.run('/rank.js')).text(), 'shell-BBBB:/rank.js', 'every file from the same version');

  // Activation drops the old shell, keeps the data cache.
  caches.store.set('data', new Map());
  await b.activate();
  assert.deepEqual([...caches.store.keys()].sort(), ['data', 'shell-BBBB']);
});

test('a failed install (network error mid-way) leaves no partial shell and does not activate', async () => {
  const caches = fakeCaches(new Map(), { failAddAll: true });
  const { install, self } = await load({ network: offline, version: 'CCCC', caches });
  await assert.rejects(install(), /network error/);
  assert.ok(!caches.store.has('shell-CCCC'));
  assert.equal(self.skipped, undefined);
});
