import { rank, applyLess, emptyPrefs, topicsOf, relativeTime } from './rank.js';

const HLS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.13/hls.min.js';
const TOPIC_LABELS = { politique: 'Politique', social: 'Social' };
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
  data: { actus: null, videos: null, status: null },
  prefs: Object.assign(emptyPrefs(), store.get('prefs', {})),
  hidden: new Set(store.get('hidden', [])),
  // id -> timestamp of first display; used to push already-seen items down.
  seen: pruneSeen(store.get('seen', {})),
  actus: { ranked: [], rendered: 0 },
  reels: { ranked: [], rendered: 0, active: null, built: false },
  muted: true,
};

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
  verified: 'M12 2l2.4 1.8 3-.2.9 2.9 2.5 1.7-1 2.8 1 2.8-2.5 1.7-.9 2.9-3-.2L12 22l-2.4-1.8-3 .2-.9-2.9-2.5-1.7 1-2.8-1-2.8 2.5-1.7.9-2.9 3 .2L12 2Zm-1.2 13.6 5.7-5.7-1.4-1.4-4.3 4.3-2-2-1.4 1.4 3.4 3.4Z',
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
  const [actus, videos, status] = await Promise.all([get('actus'), get('videos'), get('status')]);
  state.data = { actus, videos, status };
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
function cardShell(entry, children, url) {
  const more = h('button', { class: 'more', 'aria-label': 'Options', onclick: (e) => { e.stopPropagation(); openSheet(entry); } }, svg(ICONS.more));
  return h('article', {
    class: 'card' + (entry.kind === 'group' ? ' group' : ''),
    dataset: { id: entry.id },
    onclick: (e) => {
      if (e.target.closest('a, button')) return;
      if (entry.kind === 'group') e.currentTarget.classList.toggle('open');
      else openUrl(url);
    },
  }, ...children, more);
}

function head(src, item, { showHandle = false } = {}) {
  return h('div', { class: 'card-head' },
    h('span', { class: 'name', text: src.name }),
    src.verified ? h('span', { class: 'verified' }, svg(ICONS.verified, 16)) : null,
    showHandle && src.handle ? h('span', { class: 'handle', text: '@' + src.handle }) : null,
    h('span', { class: 'dot', text: '·' }),
    h('time', { class: 'time', datetime: item.publishedAt, text: relativeTime(item.publishedAt) }),
  );
}

function topicTags(entry) {
  const topics = topicsOf(entry);
  if (!topics.length) return null;
  return h('div', { class: 'tags' }, topics.map((t) => h('span', { class: 'tag', text: TOPIC_LABELS[t] || t })));
}

function articleCard(item) {
  return cardShell(item, [
    avatar(item.source.avatar, item.source.name, { square: true }),
    h('div', { class: 'card-body' },
      head(item.source, item),
      h('div', { class: 'card-title', text: item.title }),
      item.text ? h('p', { class: 'card-text dim', text: item.text }) : null,
      item.image ? h('div', { class: 'media' }, image(item.image)) : null,
      topicTags(item),
    ),
  ], item.url);
}

function postCard(item) {
  let media = null;
  if (item.video) {
    media = h('div', { class: 'media video-badge' }, item.video.poster ? image(item.video.poster) : h('div', { style: 'height:200px' }));
  } else if (item.images?.length) {
    const imgs = item.images.slice(0, 4);
    media = h('div', { class: 'media' + (imgs.length > 1 ? ' grid' : '') }, imgs.map((i) => image(i.thumb, i.alt)));
  } else if (item.external?.url) {
    media = h('a', { class: 'ext', href: item.external.url, target: '_blank', rel: 'noopener' },
      item.external.thumb ? h('div', { class: 'ext-img' }, image(item.external.thumb)) : null,
      h('div', { class: 'ext-body' },
        h('div', { class: 'ext-domain', text: domainOf(item.external.url) }),
        h('div', { class: 'ext-title', text: item.external.title }),
      ),
    );
  }
  return cardShell(item, [
    avatar(item.source.avatar, item.source.name),
    h('div', { class: 'card-body' },
      head(item.source, item, { showHandle: true }),
      item.text ? h('p', { class: 'card-text', text: item.text }) : null,
      media,
      topicTags(item),
    ),
  ], item.url);
}

function groupCard(entry) {
  const items = entry.items;
  const lead = items.find((i) => i.image) || items[0];
  const newest = items.reduce((a, b) => (Date.parse(a.publishedAt) > Date.parse(b.publishedAt) ? a : b));
  return cardShell(entry, [
    h('div', { class: 'stack' }, items.slice(0, 3).map((i) => avatar(i.source.avatar, i.source.name, { square: true }))),
    h('div', { class: 'card-body' },
      h('div', { class: 'group-label' },
        `📰 ${items.length} médias en parlent`,
        h('span', { class: 'dot', text: '·' }),
        h('time', { class: 'time', text: relativeTime(newest.publishedAt) }),
      ),
      h('div', { class: 'card-title', text: lead.title }),
      lead.text ? h('p', { class: 'card-text dim', text: lead.text }) : null,
      lead.image ? h('div', { class: 'media' }, image(lead.image)) : null,
      h('div', { class: 'group-list' }, items.map((i) =>
        h('a', { class: 'group-item', href: i.url, target: '_blank', rel: 'noopener' },
          avatar(i.source.avatar, i.source.name, { square: true }),
          h('div', {},
            h('div', { class: 'gi-src', text: `${i.source.name} · ${relativeTime(i.publishedAt)}` }),
            h('div', { text: i.title }),
          ),
        ))),
      h('div', { class: 'group-toggle', text: `Voir les ${items.length} articles` }),
      topicTags(entry),
    ),
  ]);
}

function renderEntry(entry) {
  if (entry.kind === 'group') return groupCard(entry);
  if (entry.kind === 'article') return articleCard(entry);
  return postCard(entry);
}

function renderActus() {
  const list = $('#actus-list');
  list.replaceChildren();
  state.actus.ranked = state.data.actus ? rank(state.data.actus.entries, rankOpts(state.data.actus), state.hidden) : [];
  state.actus.rendered = 0;
  if (!state.actus.ranked.length) {
    list.append(h('div', { class: 'empty' },
      h('strong', { text: state.data.actus ? 'Rien pour le moment' : 'Pas encore de données' }),
      state.data.actus ? 'Reviens un peu plus tard.' : 'La collecte n’a pas encore tourné. Lance « npm run collect » ou attends la prochaine mise à jour automatique.',
    ));
  }
  appendActus();
  renderFooter();
}

function appendActus() {
  const { ranked } = state.actus;
  const list = $('#actus-list');
  const end = Math.min(ranked.length, state.actus.rendered + ACTUS_CHUNK);
  const frag = document.createDocumentFragment();
  for (let i = state.actus.rendered; i < end; i++) {
    const card = renderEntry(ranked[i]);
    seenObserver.observe(card);
    frag.append(card);
  }
  list.append(frag);
  state.actus.rendered = end;
}

function renderFooter() {
  const f = $('#actus-footer');
  const gen = state.data.actus?.generatedAt;
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
        renderActus();
        state.reels.built = false;
        toast('Préférences réinitialisées');
      },
    }) : null,
  );
}

new IntersectionObserver((entries) => {
  if (entries.some((e) => e.isIntersecting) && state.actus.rendered < state.actus.ranked.length) appendActus();
}, { rootMargin: '800px' }).observe($('#actus-sentinel'));

// ---------- Bottom sheet / "moins de ça" ----------
let sheetEntry = null;

function openSheet(entry) {
  sheetEntry = entry;
  const isGroup = entry.kind === 'group';
  $('#sheet-less-sub').textContent = isGroup
    ? 'Moins de sujets similaires'
    : `Moins de ${entry.source.name} et de sujets similaires`;
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
$('#sheet-less').addEventListener('click', () => {
  const entry = sheetEntry;
  closeSheet();
  if (!entry) return;
  applyLess(state.prefs, entry);
  state.hidden.add(entry.id);
  savePrefs();
  toast('Compris, tu en verras moins.');
  if (state.view === 'actus') {
    const card = document.querySelector(`.card[data-id="${CSS.escape(entry.id)}"]`);
    state.actus.ranked = state.actus.ranked.filter((e) => e.id !== entry.id);
    state.actus.rendered = Math.max(0, state.actus.rendered - 1);
    if (card) { card.classList.add('removing'); setTimeout(() => card.remove(), 250); }
    renderFooter();
    state.reels.built = false;
  } else {
    removeReel(entry.id);
    state.actus.dirty = true;
  }
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
  state.reels.ranked = state.data.videos ? rank(state.data.videos.entries.filter((i) => i.video), rankOpts(state.data.videos), state.hidden) : [];
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
    if (view === 'actus') window.scrollTo({ top: 0, behavior: 'smooth' });
    else $('#videos-list').scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  state.view = view;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  document.body.classList.toggle('videos-mode', view === 'videos');
  $('#title').textContent = view === 'actus' ? 'Actus' : 'Vidéos';
  if (view === 'videos') {
    if (!state.reels.built) buildReels();
    const first = [...$('#videos-list').children].find((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= -10 && r.top < window.innerHeight / 2;
    });
    if (first?._item) activateReel(first);
  } else {
    deactivateReel();
    if (state.actus.dirty) { state.actus.dirty = false; renderActus(); }
  }
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchView(t.dataset.view)));

// ---------- Refresh (button + pull-to-refresh) ----------
let refreshing = false;
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  const btn = $('#refresh');
  const ptr = $('#ptr');
  btn.classList.add('spinning');
  ptr.classList.add('loading');
  ptr.style.height = '56px';
  const before = state.data.actus?.generatedAt;
  await loadData();
  window.scrollTo({ top: 0 });
  renderActus();
  state.reels.built = false;
  if (state.view === 'videos') buildReels();
  btn.classList.remove('spinning');
  ptr.classList.remove('loading');
  ptr.style.height = '0';
  refreshing = false;
  toast(state.data.actus?.generatedAt && state.data.actus.generatedAt !== before ? 'Nouveaux contenus' : 'Timeline mélangée');
}
$('#refresh').addEventListener('click', refresh);

(function pullToRefresh() {
  const ptr = $('#ptr');
  let startY = null;
  let dist = 0;
  const view = $('#view-actus');
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
})();

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
renderActus();
