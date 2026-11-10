import { rank, applyLess, emptyPrefs, relativeTime } from './rank.js';
import { searchAccounts, authorPosts } from './bsky.js';
import { compileTopics, matchKeywords } from './topics.js';

const HLS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.13/hls.min.js';
const PLATFORM_LABELS = { bluesky: 'Bluesky', youtube: 'YouTube', tiktok: 'TikTok', rss: '' };
const ACTUS_CHUNK = 15;
const REELS_CHUNK = 5;

// ---------- Storage (never throws) ----------
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode etc. */ }
  },
};

const state = {
  view: 'actus',
  data: { actus: null, tech: null, videos: null, status: null, accounts: null, topics: null },
  // Follows, stored on the phone. `live` = Bluesky accounts followed from search,
  // fetched directly by the app since the collector doesn't know them.
  follows: loadFollows(),
  accounts: new Map(),
  live: { actus: [], videos: [] },
  prefs: Object.assign(emptyPrefs(), store.get('prefs', {})),
  hidden: new Set(store.get('hidden', [])),
  // id -> timestamp of first display; used to push already-seen items down.
  seen: pruneSeen(store.get('seen', {})),
  // Text feeds (same rendering): Actus and Tech.
  feeds: {
    actus: { ranked: [], rendered: 0, dirty: false, scroll: 0 },
    tech: { ranked: [], rendered: 0, dirty: false, scroll: 0 },
  },
  reels: { ranked: [], rendered: 0, active: null, built: false },
  muted: true,
};

function loadFollows() {
  const f = store.get('follows', {});
  return { followed: new Set(f.followed || []), unfollowed: new Set(f.unfollowed || []), live: f.live || {} };
}
function saveFollows() {
  const f = state.follows;
  store.set('follows', { followed: [...f.followed], unfollowed: [...f.unfollowed], live: f.live });
}
function isFollowed(source) {
  if (!source) return true;
  const f = state.follows;
  if (f.followed.has(source.id)) return true;
  if (f.unfollowed.has(source.id)) return false;
  const suggested = source.suggested ?? state.accounts.get(source.id)?.suggested;
  return !suggested;
}
const itemVisible = (item) => item.tag || isFollowed(item.source);

/** Entries of a feed, restricted to followed accounts (groups are rebuilt). */
function entriesFor(key) {
  const base = state.data[key]?.entries || [];
  const extra = key === 'actus' ? state.live.actus : key === 'videos' ? state.live.videos : [];
  const out = [];
  for (const e of [...base, ...extra]) {
    if (e.kind !== 'group') { if (itemVisible(e)) out.push(e); continue; }
    const items = e.items.filter(itemVisible);
    if (items.length > 1) out.push({ ...e, items });
    else if (items.length === 1) out.push(items[0]);
  }
  return out;
}

function pruneSeen(map) {
  const cutoff = Date.now() - 4 * 86400e3;
  const out = {};
  for (const [id, t] of Object.entries(map || {})) if (t > cutoff) out[id] = t;
  return out;
}

let seenTimer = null;
function markSeen(id) {
  if (!id || state.seen[id]) return;
  state.seen[id] = Date.now();
  clearTimeout(seenTimer);
  seenTimer = setTimeout(() => store.set('seen', state.seen), 1000);
}

// A card counts as seen once at least half of it has been on screen.
const seenObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.isIntersecting) { markSeen(e.target.dataset.id); seenObserver.unobserve(e.target); }
  }
}, { threshold: 0.5 });

function savePrefs() {
  store.set('prefs', state.prefs);
  store.set('hidden', [...state.hidden].slice(-800));
}

// ---------- DOM helpers ----------
const $ = (sel) => document.querySelector(sel);

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function svg(path, size = 18) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('fill', 'currentColor');
  p.setAttribute('d', path);
  s.append(p);
  return s;
}
const ICONS = {
  more: 'M6 10.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z',
  muted: 'M3 9h4l5-4v14l-5-4H3V9Zm13.6.2L18 10.6l1.4-1.4 1.4 1.4-1.4 1.4 1.4 1.4-1.4 1.4-1.4-1.4-1.4 1.4-1.4-1.4 1.4-1.4-1.4-1.4 1.4-1.4Z',
  sound: 'M3 9h4l5-4v14l-5-4H3V9Zm13.5-2.5a7 7 0 0 1 0 11l-1.4-1.4a5 5 0 0 0 0-8.2l1.4-1.4Zm-2.8 2.8a3 3 0 0 1 0 5.4l-1.4-1.4a1 1 0 0 0 0-2.6l1.4-1.4Z',
  open: 'M14 3h7v7h-2V6.41l-8.29 8.3-1.42-1.42 8.3-8.29H14V3ZM5 5h6v2H5v12h12v-6h2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z',
};

function avatar(src, name, { square = false, size } = {}) {
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  const fallback = () => h('div', { class: `avatar${square ? ' square' : ''}`, text: initial });
  if (!src) return fallback();
  const img = h('img', { class: `avatar${square ? ' square' : ''}`, src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
  if (size) { img.width = size; img.height = size; }
  img.addEventListener('error', () => img.replaceWith(fallback()), { once: true });
  return img;
}

function image(src, alt = '') {
  const img = h('img', { src, alt, loading: 'lazy', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => (img.closest('.media, .ext-img') || img).remove(), { once: true });
  return img;
}

const openUrl = (url) => { if (url) window.open(url, '_blank', 'noopener'); };

function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- Data ----------
async function loadData() {
  const get = (name) => fetch(`data/${name}.json`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const [actus, tech, videos, status, accounts, topics] = await Promise.all(
    ['actus', 'tech', 'videos', 'status', 'accounts', 'topics'].map(get));
  state.data = { actus, tech, videos, status, accounts, topics };
  state.accounts = new Map((accounts?.accounts || []).map((a) => [a.id, a]));
  await loadLive();
}

/** Fetch posts of Bluesky accounts followed from search (not collected by GitHub). */
async function loadLive() {
  const ids = Object.keys(state.follows.live).filter((id) => state.follows.followed.has(id) && !state.accounts.has(id));
  const matchers = compileTopics(state.data.topics, 'actus');
  const results = await Promise.all(ids.map((id) => authorPosts(id.slice(5)).catch(() => [])));
  const posts = results.flat().filter((p) => Date.now() - Date.parse(p.publishedAt) < 72 * 3600e3);
  for (const p of posts) p.keywords = matchKeywords(p.text, matchers);
  state.live = {
    actus: posts,
    videos: posts.filter((p) => p.video?.type === 'hls').map((p) => ({ ...p, kind: 'video' })),
  };
}

function rankOpts(dataset) {
  return {
    now: Date.now(),
    halfLife: dataset?.halfLifeHours ?? 10,
    cap: dataset?.scoreCap ?? 6,
    prefs: state.prefs,
    random: Math.random, // new order on every refresh, like a "pour toi" timeline
    seen: new Set(Object.keys(state.seen)),
  };
}

// ---------- Actus feed ----------
const TEXT_LIMIT = 280;
const LINKIFY = /(https?:\/\/[^\s]+)|(#[\p{L}\p{N}_]+)|(@[a-z0-9-]+(?:\.[a-z0-9-]+)+)/giu;

function linkNode(text, href) {
  return h('a', { class: 'link', href, target: '_blank', rel: 'noopener', text });
}

/** Plain text → nodes, with URLs, #hashtags and @handles in blue. */
function linkify(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(LINKIFY)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const [tok] = m;
    if (m[1]) out.push(linkNode(tok.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40) + (tok.length > 48 ? '…' : ''), tok));
    else if (m[2]) out.push(linkNode(tok, `https://bsky.app/hashtag/${encodeURIComponent(tok.slice(1))}`));
    else out.push(linkNode(tok, `https://bsky.app/profile/${tok.slice(1)}`));
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Tweet text with links, plus "Voir plus" when long. */
function tweetText(item) {
  const full = item.text || '';
  if (!full) return null;
  const nodes = item.segments?.length
    ? item.segments.map((s) => (s.href ? linkNode(s.t, s.href) : s.t))
    : linkify(full);
  const el = h('div', { class: 'tweet-text' }, nodes);
  if (full.length > TEXT_LIMIT && !item.segments?.length) {
    const short = h('div', { class: 'tweet-text' }, linkify(full.slice(0, TEXT_LIMIT).replace(/\s+\S*$/, '') + '… '),
      h('button', { class: 'see-more', text: 'Voir plus', onclick: (e) => { e.stopPropagation(); short.replaceWith(el); } }));
    return short;
  }
  return el;
}

function tweetHead(entry, { name, handle, publishedAt }) {
  return h('div', { class: 'tweet-head' },
    h('span', { class: 'name', text: name }),
    handle ? h('span', { class: 'handle', text: handle }) : null,
    h('span', { class: 'dot', text: '·' }),
    h('time', { class: 'time', datetime: publishedAt, text: relativeTime(publishedAt) }),
    h('button', { class: 'more', 'aria-label': 'Options', onclick: (e) => { e.stopPropagation(); openSheet(entry); } }, svg(ICONS.more, 20)),
  );
}

function photoGrid(images) {
  const imgs = images.slice(0, 4);
  if (imgs.length === 1) {
    const ar = Math.min(Math.max(imgs[0].aspect || 1.5, 0.8), 2.2);
    const box = h('div', { class: 'media', style: `aspect-ratio:${ar}` }, image(imgs[0].thumb, imgs[0].alt));
    return box;
  }
  return h('div', { class: `media grid n${imgs.length}` }, imgs.map((i) => image(i.thumb, i.alt)));
}

// ---- Inline video (Bluesky posts in Actus): muted autoplay while visible ----
const inlineObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const box = e.target;
    if (e.isIntersecting && e.intersectionRatio >= 0.6 && state.view !== 'videos') startInline(box);
    else stopInline(box);
  }
}, { threshold: [0, 0.6] });

async function startInline(box) {
  if (box._video) return;
  const video = h('video', { playsinline: true, 'webkit-playsinline': true, loop: true, preload: 'auto' });
  video.muted = box._muted !== false;
  box._video = video;
  box.prepend(video);
  if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = box._src;
  else {
    try {
      const Hls = await loadHls();
      if (box._video !== video) return;
      if (Hls?.isSupported()) { box._hls = new Hls({ maxBufferLength: 10 }); box._hls.loadSource(box._src); box._hls.attachMedia(video); }
      else video.src = box._src;
    } catch { return; }
  }
  video.play().then(() => box.classList.add('playing')).catch(() => {});
}

function stopInline(box) {
  if (!box._video) return;
  box._hls?.destroy();
  box._hls = null;
  box._video.pause();
  box._video.remove();
  box._video = null;
  box.classList.remove('playing');
}

function stopAllInline() {
  document.querySelectorAll('.media.inline-video').forEach(stopInline);
}

function inlineVideo(v) {
  const ar = Math.min(Math.max(v.aspect || 16 / 9, 0.8), 2.2);
  const muteBtn = h('button', { class: 'vid-mute', 'aria-label': 'Son' }, svg(ICONS.muted, 18));
  const box = h('div', { class: 'media inline-video', style: `aspect-ratio:${ar}` },
    v.poster ? image(v.poster) : null,
    muteBtn,
  );
  box._src = v.src;
  muteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    box._muted = box._muted === false;
    if (box._video) { box._video.muted = box._muted; box._video.play().catch(() => {}); }
    muteBtn.replaceChildren(svg(box._muted ? ICONS.muted : ICONS.sound, 18));
  });
  inlineObserver.observe(box);
  return box;
}

/** Link card like X: image with the domain in a pill, or a compact card without image. */
function linkCard(url, { title, description, thumb }) {
  const dom = domainOf(url);
  if (thumb) {
    return h('a', { class: 'link-card', href: url, target: '_blank', rel: 'noopener' },
      h('div', { class: 'media', style: 'aspect-ratio:1.91' }, image(thumb)),
      h('span', { class: 'link-pill', text: title ? truncateText(title, 70) : dom }),
      title ? h('div', { class: 'link-from', text: `De ${dom}` }) : null,
    );
  }
  return h('a', { class: 'link-card compact', href: url, target: '_blank', rel: 'noopener' },
    h('div', { class: 'link-from', text: dom }),
    title ? h('div', { class: 'link-title', text: title }) : null,
    description ? h('div', { class: 'link-desc', text: description }) : null,
  );
}

function truncateText(s, n) { return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; }

function quoteCard(q) {
  return h('a', { class: 'quote', href: q.url, target: '_blank', rel: 'noopener' },
    h('div', { class: 'quote-head' },
      avatar(q.avatar, q.name),
      h('span', { class: 'name', text: q.name }),
      h('span', { class: 'handle', text: '@' + q.handle }),
      q.publishedAt ? h('span', { class: 'dot', text: '·' }) : null,
      q.publishedAt ? h('time', { class: 'time', datetime: q.publishedAt, text: relativeTime(q.publishedAt) }) : null,
    ),
    q.text ? h('div', { class: 'quote-text', text: q.text }) : null,
    q.image ? h('div', { class: 'media', style: 'aspect-ratio:1.78' }, image(q.image)) : null,
  );
}

function cardShell(entry, avatarNode, mainChildren, url) {
  return h('article', {
    class: 'tweet' + (entry.kind === 'group' ? ' group' : ''),
    dataset: { id: entry.id },
    onclick: (e) => {
      if (e.target.closest('a, button')) return;
      if (entry.kind === 'group') e.currentTarget.classList.toggle('open');
      else openUrl(url);
    },
  },
  h('div', { class: 'tweet-avatar' }, avatarNode),
  h('div', { class: 'tweet-main' }, ...mainChildren));
}

function articleCard(item) {
  const dom = domainOf(item.url);
  return cardShell(item, avatar(item.source.avatar, item.source.name, { square: true }), [
    tweetHead(item, { name: item.source.name, handle: dom, publishedAt: item.publishedAt }),
    h('div', { class: 'tweet-text' }, item.title),
    item.text ? h('div', { class: 'tweet-text dim' }, item.text) : null,
    item.image ? linkCard(item.url, { thumb: item.image, title: '' }) : null,
  ], item.url);
}

function postCard(item) {
  let media = null;
  if (item.video?.type === 'hls') media = inlineVideo(item.video);
  else if (item.images?.length) media = photoGrid(item.images);
  else if (item.external?.url) media = linkCard(item.external.url, item.external);
  return cardShell(item, avatar(item.source.avatar, item.source.name), [
    tweetHead(item, { name: item.source.name, handle: item.source.handle ? '@' + item.source.handle : '', publishedAt: item.publishedAt }),
    tweetText(item),
    media,
    item.quote ? quoteCard(item.quote) : null,
  ], item.url);
}

function groupCard(entry) {
  const items = entry.items;
  const lead = items.find((i) => i.image) || items[0];
  const newest = items.reduce((a, b) => (Date.parse(a.publishedAt) > Date.parse(b.publishedAt) ? a : b));
  return cardShell(entry, h('div', { class: 'stack' }, items.slice(0, 3).map((i) => avatar(i.source.avatar, i.source.name, { square: true }))), [
    tweetHead(entry, { name: `${items.length} médias en parlent`, publishedAt: newest.publishedAt }),
    h('div', { class: 'tweet-text' }, lead.title),
    lead.text ? h('div', { class: 'tweet-text dim' }, lead.text) : null,
    lead.image ? h('div', { class: 'media', style: 'aspect-ratio:1.91' }, image(lead.image)) : null,
    h('div', { class: 'group-list' }, items.map((i) =>
      h('a', { class: 'group-item', href: i.url, target: '_blank', rel: 'noopener' },
        avatar(i.source.avatar, i.source.name, { square: true }),
        h('div', {},
          h('div', { class: 'gi-src', text: `${i.source.name} · ${relativeTime(i.publishedAt)}` }),
          h('div', { text: i.title }),
        ),
      ))),
    h('div', { class: 'group-toggle', text: `Voir les ${items.length} articles` }),
  ]);
}

function renderEntry(entry) {
  if (entry.kind === 'group') return groupCard(entry);
  if (entry.kind === 'article') return articleCard(entry);
  return postCard(entry);
}

const FEED_KEYS = ['actus', 'tech'];
const isFeed = (view) => FEED_KEYS.includes(view);

function renderFeed(key) {
  const feed = state.feeds[key];
  const data = state.data[key];
  const list = $(`#${key}-list`);
  list.replaceChildren();
  feed.ranked = data ? rank(entriesFor(key), rankOpts(data), state.hidden) : [];
  feed.rendered = 0;
  feed.dirty = false;
  if (!feed.ranked.length) {
    list.append(h('div', { class: 'empty' },
      h('strong', { text: data ? 'Rien pour le moment' : 'Pas encore de données' }),
      data ? 'Reviens un peu plus tard.' : 'La collecte n’a pas encore tourné. Attends la prochaine mise à jour automatique.',
    ));
  }
  appendFeed(key);
  renderFooter(key);
}

function renderAllFeeds() {
  FEED_KEYS.forEach(renderFeed);
}

function appendFeed(key) {
  const feed = state.feeds[key];
  const list = $(`#${key}-list`);
  const end = Math.min(feed.ranked.length, feed.rendered + ACTUS_CHUNK);
  const frag = document.createDocumentFragment();
  for (let i = feed.rendered; i < end; i++) {
    const card = renderEntry(feed.ranked[i]);
    seenObserver.observe(card);
    frag.append(card);
  }
  list.append(frag);
  feed.rendered = end;
}

function renderFooter(key) {
  const f = $(`#${key}-footer`);
  const gen = state.data[key]?.generatedAt;
  const failed = state.data.status?.sources?.filter((s) => !s.ok).length || 0;
  const hasPrefs = Object.keys(state.prefs.sources).length || Object.keys(state.prefs.keywords).length || state.hidden.size;
  f.replaceChildren(
    gen ? h('div', { text: `Mis à jour il y a ${relativeTime(gen).replace("à l'instant", 'quelques secondes')}` + (failed ? ` · ${failed} source${failed > 1 ? 's' : ''} indisponible${failed > 1 ? 's' : ''}` : '') }) : null,
    hasPrefs ? h('button', {
      text: 'Réinitialiser mes préférences « moins de ça »',
      onclick: () => {
        state.prefs = emptyPrefs();
        state.hidden.clear();
        state.seen = {};
        store.set('seen', {});
        savePrefs();
        renderAllFeeds();
        state.reels.built = false;
        toast('Préférences réinitialisées');
      },
    }) : null,
  );
}

for (const key of FEED_KEYS) {
  new IntersectionObserver((entries) => {
    const feed = state.feeds[key];
    if (entries.some((e) => e.isIntersecting) && feed.rendered < feed.ranked.length) appendFeed(key);
  }, { rootMargin: '800px' }).observe($(`#${key}-sentinel`));
}

// ---------- Bottom sheet / "moins de ça" ----------
let sheetEntry = null;

function openSheet(entry) {
  sheetEntry = entry;
  const isGroup = entry.kind === 'group';
  $('#sheet-less-sub').textContent = isGroup
    ? 'Moins de sujets similaires'
    : `Moins de ${entry.source.name} et de sujets similaires`;
  const followBtn = $('#sheet-follow');
  followBtn.hidden = isGroup;
  if (!isGroup) {
    const following = isFollowed(entry.source);
    followBtn.querySelector('strong').textContent = following ? `Ne plus suivre ${entry.source.name}` : `Suivre ${entry.source.name}`;
  }
  const link = $('#sheet-open');
  link.hidden = isGroup;
  if (!isGroup) link.href = entry.url;
  $('#sheet').hidden = false;
  $('#sheet-backdrop').hidden = false;
}

function closeSheet() {
  $('#sheet').hidden = true;
  $('#sheet-backdrop').hidden = true;
  sheetEntry = null;
}

$('#sheet-backdrop').addEventListener('click', closeSheet);
$('#sheet-cancel').addEventListener('click', closeSheet);
$('#sheet-open').addEventListener('click', closeSheet);
$('#sheet-follow').addEventListener('click', () => {
  const entry = sheetEntry;
  closeSheet();
  if (!entry?.source) return;
  const following = isFollowed(entry.source);
  setFollow(accountFromSource(entry.source), !following);
  if (following && isFeed(state.view)) {
    // Remove that account's cards right away.
    const key = state.view;
    const feed = state.feeds[key];
    const gone = new Set(feed.ranked.filter((e) => e.kind !== 'group' && e.source.id === entry.source.id).map((e) => e.id));
    feed.ranked = feed.ranked.filter((e) => !gone.has(e.id));
    document.querySelectorAll(`#${key}-list .tweet`).forEach((card) => {
      if (gone.has(card.dataset.id)) { card.classList.add('removing'); setTimeout(() => card.remove(), 250); feed.rendered--; }
    });
  } else if (following && state.view === 'videos') {
    [...state.reels.ranked].filter((i) => i.source.id === entry.source.id).forEach((i) => removeReel(i.id));
  }
});
$('#sheet-less').addEventListener('click', () => {
  const entry = sheetEntry;
  closeSheet();
  if (!entry) return;
  applyLess(state.prefs, entry);
  state.hidden.add(entry.id);
  savePrefs();
  toast('Compris, tu en verras moins.');
  if (isFeed(state.view)) {
    const key = state.view;
    const feed = state.feeds[key];
    const card = document.querySelector(`#${key}-list .tweet[data-id="${CSS.escape(entry.id)}"]`);
    feed.ranked = feed.ranked.filter((e) => e.id !== entry.id);
    feed.rendered = Math.max(0, feed.rendered - 1);
    if (card) { card.classList.add('removing'); setTimeout(() => card.remove(), 250); }
    renderFooter(key);
    FEED_KEYS.filter((k) => k !== key).forEach((k) => { state.feeds[k].dirty = true; });
    state.reels.built = false;
  } else {
    removeReel(entry.id);
    FEED_KEYS.forEach((k) => { state.feeds[k].dirty = true; });
  }
});

// ---------- Follow / unfollow ----------
function accountFromSource(src) {
  return state.accounts.get(src.id) || {
    id: src.id, name: src.name, avatar: src.avatar, handle: src.handle ? '@' + src.handle : '', url: src.url,
    kind: src.id.startsWith('bsky:') ? 'bluesky' : 'media', suggested: src.suggested,
  };
}

async function setFollow(account, follow) {
  const f = state.follows;
  if (follow) {
    f.unfollowed.delete(account.id);
    f.followed.add(account.id);
    if (account.kind === 'bluesky' && !state.accounts.has(account.id)) {
      f.live[account.id] = { name: account.name, handle: account.handle, avatar: account.avatar, description: account.description || '', url: account.url };
    }
  } else {
    f.followed.delete(account.id);
    delete f.live[account.id];
    if (!account.suggested) f.unfollowed.add(account.id);
  }
  saveFollows();
  toast(follow ? `Tu suis ${account.name}` : `Tu ne suis plus ${account.name}`);
  if (follow && f.live[account.id]) await loadLive();
  FEED_KEYS.forEach((k) => { state.feeds[k].dirty = true; });
  state.reels.built = false;
  if (state.view === 'discover') renderDiscover();
}

// ---------- Découvrir ----------
function followButton(account) {
  const following = isFollowed(account);
  return h('button', {
    class: 'follow-btn' + (following ? ' following' : ''),
    text: following ? 'Abonné' : 'Suivre',
    onclick: (e) => { e.stopPropagation(); setFollow(account, !following); },
  });
}

const KIND_LABEL = { media: 'Site', bluesky: 'Bluesky', youtube: 'YouTube', tiktok: 'TikTok' };

function accountRow(a) {
  return h('div', { class: 'account' },
    h('a', { href: a.url, target: '_blank', rel: 'noopener' }, avatar(a.avatar, a.name, { square: a.kind === 'media' })),
    h('div', { class: 'account-main' },
      h('div', { class: 'account-head' },
        h('div', { class: 'account-names' },
          h('span', { class: 'name', text: a.name }),
          h('span', { class: 'handle', text: [a.handle, KIND_LABEL[a.kind]].filter(Boolean).join(' · ') }),
        ),
        followButton(a),
      ),
      a.description ? h('div', { class: 'account-desc', text: a.description }) : null,
      a.lastTitle ? h('div', { class: 'account-last', text: `${relativeTime(a.lastAt)} · ${a.lastTitle}` }) : null,
    ),
  );
}

function section(title, rows, empty) {
  return h('section', { class: 'disc-section' },
    h('h2', { text: title }),
    rows.length ? rows : h('div', { class: 'disc-empty', text: empty }),
  );
}

let searchTimer = null;
let searchSeq = 0;
function renderDiscover() {
  const results = $('#discover-results');
  const q = $('#discover-search').value.trim();
  if (q.length >= 2) return; // search results are rendered by the search handler

  const all = [...state.accounts.values()];
  const liveFollows = Object.entries(state.follows.live).map(([id, p]) => ({ id, kind: 'bluesky', ...p }));
  const followed = [...all.filter((a) => isFollowed(a)), ...liveFollows.filter((a) => !state.accounts.has(a.id))]
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const suggestions = all.filter((a) => !isFollowed(a));
  const order = ['Médias', 'Personnalités', 'Tech', 'YouTube', 'TikTok'];
  const cats = [...new Set(suggestions.map((a) => a.category || 'Autres'))].sort((a, b) => (order.indexOf(a) + 99) % 99 - (order.indexOf(b) + 99) % 99);

  results.replaceChildren(
    ...(state.data.accounts ? [] : [h('div', { class: 'disc-empty', text: 'Les suggestions apparaîtront après la prochaine mise à jour automatique.' })]),
    ...cats.map((c) => section(`Suggestions · ${c}`, suggestions.filter((a) => (a.category || 'Autres') === c).map(accountRow), '')),
    section(`Tes abonnements (${followed.length})`, followed.map(accountRow), 'Tu ne suis personne pour le moment.'),
  );
}

$('#discover-search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = $('#discover-search').value.trim();
  if (q.length < 2) { renderDiscover(); return; }
  searchTimer = setTimeout(async () => {
    const seq = ++searchSeq;
    const results = $('#discover-results');
    const ql = q.toLowerCase();
    const local = [...state.accounts.values()].filter((a) => `${a.name} ${a.handle}`.toLowerCase().includes(ql));
    results.replaceChildren(section('Recherche…', local.map(accountRow), ''));
    let remote = [];
    try { remote = await searchAccounts(q); } catch { /* offline */ }
    if (seq !== searchSeq) return;
    remote = remote.filter((r) => !local.some((l) => l.id === r.id));
    results.replaceChildren(
      local.length ? section('Dans tes sources', local.map(accountRow), '') : '',
      section('Comptes Bluesky', remote.map(accountRow), 'Aucun compte trouvé.'),
    );
  }, 350);
});

// ---------- Reels (Vidéos) ----------
let hlsPromise = null;
function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls);
  hlsPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = HLS_URL;
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve(window.Hls);
    s.onerror = reject;
    document.head.append(s);
  });
  return hlsPromise;
}

const reelObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.isIntersecting && e.intersectionRatio >= 0.6) activateReel(e.target);
  }
}, { threshold: [0.6] });

function reelSlide(item) {
  const v = item.video || {};
  const poster = v.poster || item.image;
  const landscape = (v.aspect ?? 9 / 16) > 1;
  const textContent = item.title || item.text;
  const text = textContent ? h('div', { class: 'reel-text', text: textContent, onclick: (e) => e.currentTarget.classList.toggle('expanded') }) : null;

  const muteBtn = v.type === 'hls'
    ? h('button', { class: 'reel-btn mute', 'aria-label': 'Son', onclick: (e) => { e.stopPropagation(); toggleMute(); } }, svg(state.muted ? ICONS.muted : ICONS.sound, 24))
    : null;

  const slide = h('div', { class: `reel${landscape ? ' landscape' : ''}`, dataset: { id: item.id } },
    poster ? h('img', { class: 'reel-poster blur', src: poster, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null,
    poster ? h('img', { class: 'reel-poster', src: poster, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null,
    h('div', { class: 'reel-play auto', onclick: () => activateReel(slide, true) }, h('span', { text: '▶' })),
    h('div', { class: 'reel-overlay' },
      h('a', { class: 'reel-author', href: item.source.url || item.url, target: '_blank', rel: 'noopener' },
        avatar(item.source.avatar, item.source.name),
        h('span', { class: 'reel-names' },
          h('span', { class: 'reel-name', text: item.source.name }),
          h('span', { class: 'platform', text: `🎥 ${PLATFORM_LABELS[item.platform] || ''} · ${relativeTime(item.publishedAt)}` }),
        ),
      ),
      text,
    ),
    h('div', { class: 'reel-side' },
      muteBtn,
      h('a', { class: 'reel-btn', href: item.url, target: '_blank', rel: 'noopener', 'aria-label': "Ouvrir l'original" }, svg(ICONS.open, 22)),
      h('button', { class: 'reel-btn', 'aria-label': 'Options', onclick: (e) => { e.stopPropagation(); openSheet(item); } }, svg(ICONS.more, 24)),
    ),
  );
  slide._item = item;
  return slide;
}

function buildReels() {
  const list = $('#videos-list');
  deactivateReel();
  list.replaceChildren();
  state.reels.ranked = state.data.videos ? rank(entriesFor('videos').filter((i) => i.video), rankOpts(state.data.videos), state.hidden) : [];
  state.reels.rendered = 0;
  state.reels.built = true;
  if (!state.reels.ranked.length) {
    list.append(h('div', { class: 'reel' }, h('div', { class: 'empty' },
      h('strong', { text: 'Pas de vidéos pour le moment' }), 'Reviens après la prochaine mise à jour.')));
    return;
  }
  appendReels();
  list.scrollTop = 0;
}

function appendReels() {
  const list = $('#videos-list');
  const end = Math.min(state.reels.ranked.length, state.reels.rendered + REELS_CHUNK);
  for (let i = state.reels.rendered; i < end; i++) {
    const slide = reelSlide(state.reels.ranked[i]);
    list.append(slide);
    reelObserver.observe(slide);
  }
  state.reels.rendered = end;
}

async function activateReel(slide, userGesture = false) {
  if (state.view !== 'videos') return;
  if (state.reels.active === slide && !userGesture) return;
  if (state.reels.active !== slide) deactivateReel();
  state.reels.active = slide;
  slide.classList.add('active');
  markSeen(slide.dataset.id);

  // Prefetch the next chunk.
  const idx = [...slide.parentNode.children].indexOf(slide);
  if (idx >= state.reels.rendered - 2) appendReels();

  const item = slide._item;
  const v = item.video;
  if (slide.querySelector('video, iframe')) {
    slide.querySelector('video')?.play().catch(() => {});
    return;
  }

  if (v.type === 'hls') {
    const video = h('video', { playsinline: true, 'webkit-playsinline': true, loop: true, preload: 'auto', poster: v.poster || undefined });
    video.muted = state.muted;
    video.addEventListener('click', () => (video.paused ? video.play() : video.pause()));
    slide.insertBefore(video, slide.querySelector('.reel-play'));
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = v.src;
    } else {
      try {
        const Hls = await loadHls();
        if (state.reels.active !== slide) return;
        if (Hls?.isSupported()) {
          const hls = new Hls({ maxBufferLength: 20 });
          hls.loadSource(v.src);
          hls.attachMedia(video);
          slide._hls = hls;
        } else {
          video.src = v.src;
        }
      } catch {
        toast('Lecture vidéo indisponible');
        return;
      }
    }
    try { await video.play(); } catch {
      // Unmuted autoplay refused: retry muted.
      video.muted = true;
      video.play().catch(() => slide.querySelector('.reel-play')?.classList.remove('auto'));
    }
  } else if (v.type === 'youtube' || v.type === 'tiktok') {
    const src = v.type === 'youtube'
      ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.src)}?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1&loop=1&playlist=${encodeURIComponent(v.src)}`
      : `https://www.tiktok.com/player/v1/${encodeURIComponent(v.src)}?autoplay=1&muted=1&loop=1&description=0&music_info=0`;
    const iframe = h('iframe', {
      src,
      allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
      allowfullscreen: true,
      referrerpolicy: 'strict-origin-when-cross-origin',
      title: item.title || item.source.name,
    });
    slide.classList.add('has-iframe');
    slide.insertBefore(iframe, slide.querySelector('.reel-play'));
  }
}

function deactivateReel() {
  const slide = state.reels.active;
  if (!slide) return;
  slide.classList.remove('active', 'has-iframe');
  slide._hls?.destroy();
  slide._hls = null;
  slide.querySelectorAll('video, iframe').forEach((el) => {
    if (el.tagName === 'VIDEO') { el.pause(); el.removeAttribute('src'); el.load(); }
    el.remove();
  });
  state.reels.active = null;
}

function removeReel(id) {
  const slide = document.querySelector(`.reel[data-id="${CSS.escape(id)}"]`);
  if (!slide) return;
  const next = slide.nextElementSibling;
  if (state.reels.active === slide) deactivateReel();
  reelObserver.unobserve(slide);
  slide.remove();
  state.reels.ranked = state.reels.ranked.filter((i) => i.id !== id);
  state.reels.rendered = Math.max(0, state.reels.rendered - 1);
  if (next) activateReel(next);
}

function toggleMute() {
  state.muted = !state.muted;
  const video = state.reels.active?.querySelector('video');
  if (video) { video.muted = state.muted; if (!state.muted) video.play().catch(() => {}); }
  document.querySelectorAll('.reel .mute').forEach((b) => b.replaceChildren(svg(state.muted ? ICONS.muted : ICONS.sound, 24)));
}

// ---------- Tabs ----------
function switchView(view) {
  if (view === state.view) {
    // Tap on the active tab: scroll back to top.
    if (view === 'videos') $('#videos-list').scrollTo({ top: 0, behavior: 'smooth' });
    else window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  if (isFeed(state.view)) state.feeds[state.view].scroll = window.scrollY;
  if (view !== 'discover') $('#discover-search').blur();
  state.view = view;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  document.body.classList.toggle('videos-mode', view === 'videos');
  $('#title').textContent = { actus: 'Actus', tech: 'Tech', videos: 'Vidéos', discover: 'Découvrir' }[view];
  if (view === 'videos') {
    stopAllInline();
    if (!state.reels.built) buildReels();
    const first = [...$('#videos-list').children].find((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= -10 && r.top < window.innerHeight / 2;
    });
    if (first?._item) activateReel(first);
  } else if (view === 'discover') {
    deactivateReel();
    stopAllInline();
    renderDiscover();
    window.scrollTo({ top: 0 });
  } else {
    deactivateReel();
    stopAllInline();
    if (state.feeds[view].dirty) renderFeed(view);
    window.scrollTo({ top: state.feeds[view].scroll || 0 });
  }
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchView(t.dataset.view)));

// ---------- Refresh (button + pull-to-refresh) ----------
let refreshing = false;
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  const btn = $('#refresh');
  const ptr = document.querySelector(`#view-${state.view} .ptr`) || document.createElement('div');
  btn.classList.add('spinning');
  ptr.classList.add('loading');
  ptr.style.height = '56px';
  const before = state.data.actus?.generatedAt;
  await loadData();
  window.scrollTo({ top: 0 });
  FEED_KEYS.forEach((k) => { state.feeds[k].scroll = 0; });
  renderAllFeeds();
  state.reels.built = false;
  if (state.view === 'videos') buildReels();
  btn.classList.remove('spinning');
  ptr.classList.remove('loading');
  ptr.style.height = '0';
  refreshing = false;
  toast(state.data.actus?.generatedAt && state.data.actus.generatedAt !== before ? 'Nouveaux contenus' : 'Timeline mélangée');
}
$('#refresh').addEventListener('click', refresh);

for (const key of FEED_KEYS) pullToRefresh(key);
function pullToRefresh(key) {
  const view = $(`#view-${key}`);
  const ptr = view.querySelector('.ptr');
  let startY = null;
  let dist = 0;
  view.addEventListener('touchstart', (e) => {
    if (window.scrollY <= 0 && !refreshing) { startY = e.touches[0].clientY; dist = 0; }
  }, { passive: true });
  view.addEventListener('touchmove', (e) => {
    if (startY == null) return;
    dist = e.touches[0].clientY - startY;
    if (dist > 0 && window.scrollY <= 0) {
      ptr.classList.add('pulling');
      ptr.style.height = Math.min(80, dist * 0.45) + 'px';
    }
  }, { passive: true });
  view.addEventListener('touchend', () => {
    if (startY == null) return;
    ptr.classList.remove('pulling');
    startY = null;
    if (dist * 0.45 >= 60) refresh();
    else ptr.style.height = '0';
  });
}

// Keep relative times fresh.
setInterval(() => {
  document.querySelectorAll('time[datetime]').forEach((t) => { t.textContent = relativeTime(t.getAttribute('datetime')); });
}, 60_000);

// Pause videos when the app goes to background.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) state.reels.active?.querySelector('video')?.pause();
  else if (state.view === 'videos') state.reels.active?.querySelector('video')?.play().catch(() => {});
});

// ---------- Boot ----------
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

await loadData();
renderAllFeeds();
