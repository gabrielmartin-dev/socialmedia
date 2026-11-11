import { test } from 'node:test';
import assert from 'node:assert/strict';

// Minimal service worker harness: fake caches / fetch, handler captured from addEventListener.
function setup({ network }) {
  const handlers = {};
  const store = new Map(); // cacheName -> Map(key -> Response)
  const key = (r) => (typeof r === 'string' ? r : new URL(r.url).pathname.replace(/^\//, '') || './');
  const cacheApi = (name) => {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name);
    return { put: async (k, v) => { m.set(String(typeof k === 'string' ? k : key(k)), v); }, addAll: async () => {} };
  };
  globalThis.self = { addEventListener: (t, fn) => { handlers[t] = fn; }, skipWaiting() {}, clients: { claim() {} } };
  globalThis.location = new URL('https://app.test/');
  globalThis.caches = {
    open: async (n) => cacheApi(n),
    keys: async () => [...store.keys()],
    delete: async (n) => store.delete(n),
    match: async (r) => {
      const k = typeof r === 'string' ? r : new URL(r.url).pathname;
      for (const m of store.values()) { const hit = m.get(k) || m.get(k.replace(/^\//, '')); if (hit) return hit.clone(); }
      return undefined;
    },
  };
  globalThis.fetch = network;
  return { handlers, store };
}

async function load(opts) {
  const ctx = setup(opts);
  await import(`../public/sw.js?${Math.random()}`);
  const run = async (path, init = {}) => {
    let p;
    const request = Object.assign(new Request(`https://app.test${path}`), {});
    const ev = { request: init.mode ? { url: request.url, method: 'GET', mode: init.mode } : request, respondWith: (x) => { p = x; } };
    ctx.handlers.fetch(ev);
    return p;
  };
  return { ...ctx, run };
}
const flush = () => new Promise((r) => setTimeout(r, 5));

test('data: a 500 never overwrites the cached good data and the cache is served', async () => {
  let mode = 'ok';
  const { run, store } = await load({
    network: async () => (mode === 'ok' ? new Response('{"good":1}', { status: 200 }) : new Response('boom', { status: 500 })),
  });
  assert.equal(await (await run('/data/actus.json')).text(), '{"good":1}');
  await flush();
  mode = '500';
  const res = await run('/data/actus.json');
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '{"good":1}');
  await flush();
  const cached = [...store.entries()].find(([n]) => n.startsWith('data-'))[1].get('/data/actus.json');
  assert.equal(await cached.text(), '{"good":1}');
});

test('data: 404 with an empty cache is passed through, and not cached', async () => {
  const { run, store } = await load({ network: async () => new Response('nope', { status: 404 }) });
  assert.equal((await run('/data/tech.json')).status, 404);
  await flush();
  assert.equal([...store.entries()].find(([n]) => n.startsWith('data-')), undefined);
});

test('data: offline with an empty cache gives a clean 503, never undefined', async () => {
  const { run } = await load({ network: async () => { throw new TypeError('offline'); } });
  const res = await run('/data/actus.json');
  assert.ok(res instanceof Response);
  assert.equal(res.status, 503);
});

test('shell: neither cache nor network resolves to an error response, not undefined', async () => {
  const { run } = await load({ network: async () => { throw new TypeError('offline'); } });
  const res = await run('/app.js');
  assert.ok(res instanceof Response);
  assert.equal(res.status, 503);
});
