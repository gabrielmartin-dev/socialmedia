// Vidéos tab: vertical reels with one active player at a time.

import { rank, relativeTime } from '../rank.js';
import { safeUrl } from '../url.js';
import { $, h, svg, ICONS, toast, scrollBehavior } from './dom.js';
import { avatar } from './media.js';
import { makeButton } from './focus.js';
import { attachControls } from './reelcontrols.js';
import { loadHls } from './hls.js';
import { state, entriesFor, rankOpts, markSeen, saveMuted } from './store.js';
import { actions } from './actions.js';
import { PLATFORM_LABELS } from './util.js';
import { linkify } from './cards.js';
import { getPosition, savePosition } from './resume.js';

const REELS_CHUNK = 5;
const YT_ORIGIN = 'https://www.youtube-nocookie.com';
const TIKTOK_ORIGIN = 'https://www.tiktok.com';
/** Automatic new attempts on a broken stream before showing the error. */
const MAX_RETRIES = 2;
const HLS_MIME = 'application/vnd.apple.mpegurl';
/** hls.js: never a quality above what the screen shows (saves mobile data). */
const HLS_CONFIG = { maxBufferLength: 20, capLevelToPlayerSize: true };
/** Buffer of the next video, prepared in advance. */
const PRELOAD_BUFFER_S = 6;
const PRELOAD_DELAY_MS = 1500;
const FULLSCREEN_ICON = 'M4 4h6v2H6v4H4V4Zm10 0h6v6h-2V6h-4V4ZM4 14h2v4h4v2H4v-6Zm14 0h2v6h-6v-2h4v-4Z';
const EXIT_FULLSCREEN_ICON = 'M8 4h2v6H4V8h4V4Zm6 0h2v4h4v2h-6V4ZM4 14h6v6H8v-4H4v-2Zm10 0h6v2h-4v4h-2v-6Z';
const canFullscreen = () => !!(document.fullscreenEnabled || 'webkitEnterFullscreen' in HTMLVideoElement.prototype);

let reelObs = null;
const reelObserver = () => (reelObs ||= new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.isIntersecting && e.intersectionRatio >= 0.6) activateReel(e.target);
  }
}, { threshold: [0.6] }));

function reelSlide(item) {
  const v = item.video || {};
  const poster = v.poster || item.image;
  const landscape = (v.aspect ?? 9 / 16) > 1;
  const textContent = item.title || item.text;
  // YouTube: the title is always shown; the channel's description opens with a tap.
  const desc = item.platform === 'youtube' && item.title && item.text && item.text !== item.title ? item.text : '';
  let text = null;
  if (textContent) {
    text = h('div', { class: 'reel-text', 'aria-expanded': 'false' },
      h('span', { text: textContent }),
      desc ? h('span', { class: 'reel-more', text: ' … plus' }) : null,
      desc ? h('div', { class: 'reel-desc' }, linkify(desc)) : null);
    makeButton(text, (e) => {
      if (e.target.closest('a')) return; // a link of the description just opens
      text.setAttribute('aria-expanded', String(text.classList.toggle('expanded')));
    });
  }
  const kind = item.platform === 'youtube' ? ((v.aspect ?? 16 / 9) < 1 ? ' · Short' : ' · Vidéo longue') : '';

  const muteBtn = v.type === 'hls' || v.type === 'youtube' || v.type === 'tiktok'
    ? h('button', { class: 'reel-btn mute', 'aria-label': 'Son', 'aria-pressed': String(!state.muted), onclick: (e) => { e.stopPropagation(); toggleMute(); } }, svg(state.muted ? ICONS.muted : ICONS.sound, 24))
    : null;

  const fullBtn = v.type === 'hls' && landscape && canFullscreen()
    ? h('button', { class: 'reel-btn fullscreen', 'aria-label': 'Plein écran', onclick: (e) => { e.stopPropagation(); toggleFullscreen(slide); } }, svg(FULLSCREEN_ICON, 24))
    : null;

  const slide = h('div', { class: `reel${landscape ? ' landscape' : ''}`, dataset: { id: item.id } },
    poster ? h('img', { class: 'reel-poster blur', src: poster, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null,
    poster ? h('img', { class: 'reel-poster', src: poster, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null,
    h('button', { class: 'reel-play auto', type: 'button', 'aria-label': 'Lire la vidéo', onclick: () => activateReel(slide, true) }, h('span', { text: '▶', 'aria-hidden': 'true' })),
    h('div', { class: 'reel-overlay' },
      h('button', { class: 'reel-author', onclick: (e) => { e.stopPropagation(); actions.openProfile(item.source); } },
        avatar(item.source.avatar, item.source.name),
        h('span', { class: 'reel-names' },
          h('span', { class: 'reel-name', text: item.source.name }),
          h('span', { class: 'platform', text: `🎥 ${PLATFORM_LABELS[item.platform] || ''}${kind} · ${relativeTime(item.publishedAt)}` }),
        ),
      ),
      text,
    ),
    h('div', { class: 'reel-side' },
      fullBtn,
      muteBtn,
      h('a', { class: 'reel-btn', href: item.url, target: '_blank', rel: 'noopener', 'aria-label': "Ouvrir l'original" }, svg(ICONS.open, 22)),
      h('button', { class: 'reel-btn', 'aria-label': 'Options', onclick: (e) => { e.stopPropagation(); actions.openSheet(item); } }, svg(ICONS.more, 24)),
    ),
  );
  slide._item = item;
  return slide;
}

export function buildReels() {
  const list = $('#videos-list');
  deactivateReel();
  dropPreload();
  list.replaceChildren();
  state.reels.ranked = state.data.videos ? rank(entriesFor('videos').filter((i) => i.video), rankOpts(state.data.videos), state.hidden) : [];
  state.reels.rendered = 0;
  state.reels.built = true;
  if (!state.reels.ranked.length) {
    list.append(h('div', { class: 'reel' }, h('div', { class: 'empty' },
      h('strong', { text: 'Pas de vidéos pour le moment' }), 'Reviens après la prochaine mise à jour.',
      h('button', { class: 'empty-btn', type: 'button', text: 'Rafraîchir', onclick: () => actions.refresh() }))));
    return;
  }
  appendReels();
  list.scrollTop = 0;
}

/** Last slide of the list: nothing more to watch. */
function endSlide() {
  return h('div', { class: 'reel end' }, h('div', { class: 'empty' },
    h('strong', { text: 'Tu as tout vu' }),
    'Plus de vidéos pour le moment.',
    h('button', { class: 'empty-btn', type: 'button', text: 'Rafraîchir', onclick: () => actions.refresh() }),
    h('button', { class: 'empty-btn ghost', type: 'button', text: 'Revenir en haut', onclick: () => $('#videos-list').scrollTo({ top: 0, behavior: scrollBehavior() }) })));
}

function appendReels() {
  const list = $('#videos-list');
  list.querySelector('.reel.end')?.remove();
  const end = Math.min(state.reels.ranked.length, state.reels.rendered + REELS_CHUNK);
  for (let i = state.reels.rendered; i < end; i++) {
    const slide = reelSlide(state.reels.ranked[i]);
    list.append(slide);
    reelObserver().observe(slide);
  }
  state.reels.rendered = end;
  if (end >= state.reels.ranked.length) list.append(endSlide());
}

export async function activateReel(slide, userGesture = false) {
  if (state.view !== 'videos') return;
  // In full screen the slide leaves the list, which shifts the others under the observer.
  if (document.fullscreenElement && document.fullscreenElement !== slide) return;
  if (state.reels.active === slide && !userGesture) return;
  if (state.reels.active !== slide) deactivateReel();
  state.reels.active = slide;
  slide.classList.add('active');
  markSeen(slide.dataset.id);

  // Prefetch the next chunk.
  const idx = [...slide.parentNode.children].indexOf(slide);
  if (idx >= state.reels.rendered - 2 && state.reels.rendered < state.reels.ranked.length) appendReels();

  const item = slide._item;
  const v = item.video;
  if (slide.querySelector('video:not(.reel-pre), iframe')) {
    slide.querySelector('video:not(.reel-pre)')?.play().catch(() => {});
    return;
  }

  // Prepare the next video while this one starts.
  setTimeout(() => { if (state.reels.active === slide) preloadReel(slide.nextElementSibling); }, PRELOAD_DELAY_MS);

  if (v.type === 'hls') {
    const hlsSrc = safeUrl(v.src, location.href);
    if (!hlsSrc) return;
    playHls(slide, hlsSrc, v);
  } else if (v.type === 'youtube' || v.type === 'tiktok') {
    const start = v.type === 'youtube' ? getPosition(item.id) : 0;
    const src = v.type === 'youtube'
      ? `${YT_ORIGIN}/embed/${encodeURIComponent(v.src)}?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1&loop=1&playlist=${encodeURIComponent(v.src)}&enablejsapi=1&origin=${encodeURIComponent(location.origin)}${start ? `&start=${start}` : ''}`
      : `https://www.tiktok.com/player/v1/${encodeURIComponent(v.src)}?autoplay=1&muted=1&loop=1&description=0&music_info=0`;
    const iframe = h('iframe', {
      src,
      allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
      allowfullscreen: true,
      referrerpolicy: 'strict-origin-when-cross-origin',
      title: item.title || item.source.name,
    });
    // Ask the YouTube player to report its position (infoDelivery messages), for the resume.
    // It also takes the sound and pause commands (ytCommand).
    if (v.type === 'youtube') iframe.addEventListener('load', () => iframe.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), YT_ORIGIN));
    slide.classList.add('has-iframe');
    slide.insertBefore(iframe, slide.querySelector('.reel-play'));
  }
}

/** Creates the HLS player of `slide`: resume, loading spinner, automatic retries, error message. */
async function playHls(slide, hlsSrc, v) {
  const id = slide.dataset.id;
  const start = getPosition(id);
  // The next video may already be loading (preloadReel): take it over.
  let pre = slide._pre;
  if (pre) {
    slide._pre = null;
    if (preloaded === slide) preloaded = null;
    if (pre.failed) { destroyPreload(pre); pre = null; }
  }
  const video = pre ? pre.video : newVideo();
  video.classList.remove('reel-pre');
  video.preload = 'auto';
  const poster = safeUrl(v.poster, location.href);
  if (poster) video.poster = poster;
  video.muted = state.muted;
  if (!pre) slide.insertBefore(video, slide.querySelector('.reel-play'));
  slide.append(h('div', { class: 'reel-loading', 'aria-hidden': 'true' }, h('div', { class: 'spinner' })));
  attachControls(slide, video);

  // Spinner while the stream loads or stalls; none while paused.
  const loading = (on) => slide.classList.toggle('buffering', on);
  loading(true);
  video.addEventListener('waiting', () => loading(true), { signal: video._signal });
  video.addEventListener('playing', () => loading(false), { signal: video._signal });
  video.addEventListener('pause', () => loading(false), { signal: video._signal });

  let retries = 0;
  const fail = () => {
    if (state.reels.active !== slide || !video.isConnected) return;
    loading(false);
    slide._hls?.destroy();
    slide._hls = null;
    showError(slide);
  };

  const native = video.canPlayType(HLS_MIME);
  if (native) {
    if (pre) { /* src already set, position already applied */ } else if (start) video.addEventListener('loadedmetadata', () => { video.currentTime = start; }, { once: true, signal: video._signal });
    video.addEventListener('error', () => {
      if (state.reels.active !== slide || !video.isConnected) return;
      if (retries++ >= MAX_RETRIES) { fail(); return; }
      const at = video.currentTime || start;
      setTimeout(() => {
        if (state.reels.active !== slide || !video.isConnected) return;
        if (at) video.addEventListener('loadedmetadata', () => { video.currentTime = at; }, { once: true, signal: video._signal });
        video.src = hlsSrc;
        video.play().catch(() => {});
      }, 1000 * retries);
    }, { signal: video._signal });
    if (!pre) video.src = hlsSrc;
  } else {
    try {
      const Hls = await loadHls();
      if (state.reels.active !== slide) return;
      if (Hls?.isSupported()) {
        const hls = pre?.hls || new Hls({ ...HLS_CONFIG, startPosition: start || -1 });
        hls.config.maxBufferLength = HLS_CONFIG.maxBufferLength;
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (!data.fatal || state.reels.active !== slide) return;
          if (retries++ >= MAX_RETRIES) { fail(); return; }
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
          // No playlist yet: load it again; otherwise resume loading the segments.
          else setTimeout(() => { if (slide._hls !== hls) return; if (hls.levels?.length) hls.startLoad(); else hls.loadSource(hlsSrc); }, 1000 * retries);
        });
        if (!pre?.hls) { hls.loadSource(hlsSrc); hls.attachMedia(video); }
        slide._hls = hls;
      } else {
        if (start) video.addEventListener('loadedmetadata', () => { video.currentTime = start; }, { once: true, signal: video._signal });
        video.addEventListener('error', fail, { signal: video._signal });
        video.src = hlsSrc;
      }
    } catch {
      fail();
      return;
    }
  }
  try { await video.play(); } catch {
    if (state.reels.active !== slide || !video.isConnected) return;
    // Unmuted autoplay refused (iPhone without a recent tap): play muted for now, say so on the
    // sound button, but keep the choice: the next tap gives the sound back (see initReels).
    if (!state.muted) { video.muted = true; showMuteIcon(slide, true); }
    video.play().catch(() => {
      loading(false);
      slide.querySelector('.reel-play')?.classList.remove('auto');
    });
  }
}

// ---------- Reused <video> elements ----------
// On iPhone a <video> may only play with sound once it has been started from a tap, element by
// element: a new element for each video would start muted again after every swipe. So a few
// elements are reused from one video to the next, and all of them are unlocked by the first tap.
const POOL_SIZE = 3;
const allVideos = [];
const idleVideos = [];

function createVideo() {
  const video = h('video', { playsinline: true, 'webkit-playsinline': true, loop: true, preload: 'auto' });
  allVideos.push(video);
  return video;
}

/** A video element for a new use; the listeners added with `video._signal` die with this use. */
function newVideo() {
  const video = idleVideos.pop() || createVideo();
  video._ac?.abort();
  video._ac = new AbortController();
  video._signal = video._ac.signal;
  video.className = '';
  video.preload = 'auto';
  return video;
}

/** Gives a video element back once its reel is left. */
function releaseVideo(video) {
  video._ac?.abort();
  video._ac = null;
  video.pause();
  video.removeAttribute('src');
  video.removeAttribute('poster');
  video.load();
  video.remove();
  video.muted = true;
  video._resumeOnShow = false;
  if (!idleVideos.includes(video) && idleVideos.length < POOL_SIZE) idleVideos.push(video);
}

/** Called during a tap: from now on these elements may play with sound (iPhone rule). */
function unlockVideos() {
  // A touch that ends a scroll is not a tap: wait for a real one (where the browser tells).
  if (navigator.userActivation && !navigator.userActivation.isActive) return;
  while (allVideos.length < POOL_SIZE) idleVideos.push(createVideo());
  for (const video of allVideos) {
    if (video._unlocked) continue;
    video._unlocked = true;
    if (!video.paused) continue; // already playing: the tap itself counts
    const p = video.play();
    video.pause();
    p?.catch?.(() => {});
  }
}

let preloaded = null; // the slide whose video is being prepared in advance

/** Starts loading the HLS video of `slide` (the next one), hidden, muted, with a small buffer. */
async function preloadReel(slide) {
  const v = slide?._item?.video;
  if (!v || v.type !== 'hls' || slide._pre || slide === state.reels.active) return;
  const src = safeUrl(v.src, location.href);
  if (!src) return;
  dropPreload();
  const video = newVideo();
  video.classList.add('reel-pre');
  video.muted = true;
  const pre = { video, hls: null, failed: false };
  slide._pre = pre;
  preloaded = slide;
  slide.insertBefore(video, slide.querySelector('.reel-play'));
  const start = getPosition(slide.dataset.id);
  if (video.canPlayType(HLS_MIME)) {
    // Native HLS buffers as much as it likes with preload=auto: only the start here.
    video.preload = 'metadata';
    if (start) video.addEventListener('loadedmetadata', () => { video.currentTime = start; }, { once: true, signal: video._signal });
    video.addEventListener('error', () => { pre.failed = true; }, { signal: video._signal });
    video.src = src;
    return;
  }
  try {
    const Hls = await loadHls();
    if (slide._pre !== pre) return;
    if (!Hls?.isSupported()) { dropPreload(); return; }
    pre.hls = new Hls({ ...HLS_CONFIG, maxBufferLength: PRELOAD_BUFFER_S, startPosition: start || -1 });
    pre.hls.on(Hls.Events.ERROR, (_e, data) => { if (data.fatal && slide._pre === pre) pre.failed = true; });
    pre.hls.loadSource(src);
    pre.hls.attachMedia(video);
  } catch {
    if (slide._pre === pre) dropPreload();
  }
}

function destroyPreload(pre) {
  pre.hls?.destroy();
  releaseVideo(pre.video);
}

/** Forgets the video prepared in advance, if any. */
function dropPreload() {
  const slide = preloaded;
  preloaded = null;
  if (!slide?._pre) return;
  destroyPreload(slide._pre);
  slide._pre = null;
}

/** Full screen for a landscape video, turned sideways where the phone allows it. */
async function toggleFullscreen(slide) {
  if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
  if (state.reels.active !== slide) activateReel(slide, true);
  const video = slide.querySelector('video:not(.reel-pre)');
  if (document.fullscreenEnabled && slide.requestFullscreen) {
    try {
      await slide.requestFullscreen({ navigationUI: 'hide' });
      await screen.orientation?.lock?.('landscape');
    } catch { /* orientation lock refused: full screen stays */ }
  } else if (video?.webkitEnterFullscreen) {
    video.webkitEnterFullscreen(); // iPhone: the system player
  }
}

let fullscreenSlide = null;
function onFullscreenChange() {
  const el = document.fullscreenElement;
  // Back from full screen: the list is where it was, on the same video.
  if (!el && fullscreenSlide?.isConnected) fullscreenSlide.scrollIntoView({ block: 'start' });
  fullscreenSlide = el?.classList.contains('reel') ? el : null;
  document.querySelectorAll('.reel .fullscreen').forEach((b) => {
    const on = b.closest('.reel') === el;
    b.replaceChildren(svg(on ? EXIT_FULLSCREEN_ICON : FULLSCREEN_ICON, 24));
    b.setAttribute('aria-label', on ? 'Quitter le plein écran' : 'Plein écran');
  });
  if (!el) try { screen.orientation?.unlock?.(); } catch { /* not supported */ }
}

/** Sends a command to the YouTube player of `slide` (mute, unMute, playVideo, pauseVideo). */
function ytCommand(slide, func) {
  slide?.querySelector('iframe')?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args: [] }), YT_ORIGIN);
}

/** Sound on / off in the embedded player of `slide` (YouTube or TikTok). */
function iframeSound(slide, on) {
  const iframe = slide?.querySelector('iframe');
  if (!iframe) return;
  if (slide._item?.video?.type === 'tiktok') iframe.contentWindow?.postMessage({ type: on ? 'unMute' : 'mute', 'x-tiktok-player': true }, TIKTOK_ORIGIN);
  else ytCommand(slide, on ? 'unMute' : 'mute');
}

/** Broken stream: message with a new attempt and the link to the original. */
function showError(slide) {
  slide.querySelectorAll('.reel-error, .reel-loading').forEach((el) => el.remove());
  slide.classList.remove('buffering');
  slide.append(h('div', { class: 'reel-error', role: 'alert' },
    h('strong', { text: 'Vidéo indisponible' }),
    h('button', { class: 'empty-btn', type: 'button', text: 'Réessayer', onclick: (e) => { e.stopPropagation(); deactivateReel(); activateReel(slide, true); } }),
    h('a', { class: 'empty-btn ghost', href: slide._item.url, target: '_blank', rel: 'noopener', text: "Ouvrir l'original" })));
}

/** Remembers where the active reel is, for the resume. */
function savePlayback(slide) {
  const video = slide.querySelector('video:not(.reel-pre)');
  if (video) savePosition(slide.dataset.id, video.currentTime, video.duration);
  else if (slide._ytTime != null) savePosition(slide.dataset.id, slide._ytTime, slide._ytDuration);
}

export function deactivateReel() {
  const slide = state.reels.active;
  if (!slide) return;
  savePlayback(slide);
  slide._ytTime = slide._ytDuration = slide._ytState = slide._playerMuted = null;
  slide._ytReady = slide._ytResume = slide._soundRetried = false;
  slide.classList.remove('active', 'has-iframe', 'buffering', 'scrubbing');
  slide._hls?.destroy();
  slide._hls = null;
  slide.querySelectorAll('video:not(.reel-pre), iframe, .reel-progress, .reel-time, .reel-flash, .reel-loading, .reel-error').forEach((el) => {
    if (el.tagName === 'VIDEO') releaseVideo(el);
    else el.remove();
  });
  state.reels.active = null;
}

/** Takes a slide off the list. Returns { item, index } to give back to restoreReel, or null. */
export function removeReel(id) {
  const slide = document.querySelector(`.reel[data-id="${CSS.escape(id)}"]`);
  const index = state.reels.ranked.findIndex((i) => i.id === id);
  if (!slide) {
    // Not rendered yet (further down the list): it must not show up later either.
    if (index < state.reels.rendered) return null;
    const [item] = state.reels.ranked.splice(index, 1);
    return { item, index, unrendered: true };
  }
  const next = slide.nextElementSibling;
  const item = slide._item;
  if (state.reels.active === slide) deactivateReel();
  if (preloaded === slide) dropPreload();
  reelObserver().unobserve(slide);
  slide.remove();
  state.reels.ranked = state.reels.ranked.filter((i) => i.id !== id);
  state.reels.rendered = Math.max(0, state.reels.rendered - 1);
  if (next?._item) activateReel(next);
  return item ? { item, index } : null;
}

/** Puts a removed slide back where it was and shows it again. */
export function restoreReel({ item, index, unrendered }) {
  if (unrendered) {
    state.reels.ranked.splice(Math.min(Math.max(index, state.reels.rendered), state.reels.ranked.length), 0, item);
    if (state.reels.rendered < state.reels.ranked.length) $('#videos-list').querySelector('.reel.end')?.remove();
    return;
  }
  const list = $('#videos-list');
  const at = Math.min(index, state.reels.ranked.length);
  state.reels.ranked.splice(at, 0, item);
  state.reels.rendered++;
  const slide = reelSlide(item);
  list.insertBefore(slide, list.children[at] || null);
  reelObserver().observe(slide);
  slide.scrollIntoView({ block: 'start' });
}

/**
 * Re-orders the videos that come after the one on screen (rendered in advance or not) with
 * `reorder(upcoming)`, so that a « Moins de ça » / « Plus de ça » shows from the next swipe.
 */
export function reorderUpcoming(reorder) {
  const list = $('#videos-list');
  const slides = [...list.querySelectorAll('.reel')].filter((el) => el._item);
  let current = slides.indexOf(state.reels.active);
  if (current < 0) current = slides.findIndex((el) => el.getBoundingClientRect().bottom > window.innerHeight / 2);
  const keep = Math.max(0, current + 1);
  for (const slide of slides.slice(keep)) {
    if (preloaded === slide) dropPreload();
    reelObserver().unobserve(slide);
    slide.remove();
  }
  list.querySelector('.reel.end')?.remove();
  state.reels.ranked = [...state.reels.ranked.slice(0, keep), ...reorder(state.reels.ranked.slice(keep))];
  state.reels.rendered = keep;
  appendReels();
}

/** Sound icon of one slide (or of every slide): it tells what the video really does. */
function showMuteIcon(scope, muted) {
  scope.querySelectorAll('.mute').forEach((b) => {
    b.replaceChildren(svg(muted ? ICONS.muted : ICONS.sound, 24));
    b.setAttribute('aria-pressed', String(!muted));
  });
}

/** Sound on / off for the reels, remembered for the next videos and the next visits. */
function setMuted(muted) {
  state.muted = muted;
  saveMuted();
  const video = state.reels.active?.querySelector('video:not(.reel-pre)');
  if (video) video.muted = muted;
  showMuteIcon(document.querySelector('#videos-list') || document, muted);
}

/**
 * Sound chosen but refused by the browser (autoplay rules): the first tap or key press in the
 * Vidéos tab gives it back, without changing the choice.
 */
function restoreSound() {
  if (state.muted || state.view !== 'videos') return;
  const slide = state.reels.active;
  if (slide?._playerMuted) { iframeSound(slide, true); return; }
  const video = slide?.querySelector('video:not(.reel-pre)');
  if (video?.muted) {
    video.muted = false;
    showMuteIcon(slide, false);
    if (!video.paused) video.play().catch(() => { video.muted = true; showMuteIcon(slide, true); });
    soundRestoredAt = Date.now();
  }
}
let soundRestoredAt = 0;

function toggleMute() {
  // The icon may show « muted » while the choice is « sound » (refused autoplay): follow the icon.
  const slide = state.reels.active;
  const video = slide?.querySelector('video:not(.reel-pre)');
  const shownMuted = video ? video.muted : (slide?._playerMuted ?? state.muted);
  setMuted(!shownMuted);
  if (slide?.querySelector('iframe')) { iframeSound(slide, !state.muted); return; }
  if (video && !state.muted) video.play().catch(() => {});
}

/** What the embedded player says about its sound: the icon follows, the choice follows the user's own taps. */
function onPlayerMuted(slide, muted) {
  const was = slide._playerMuted;
  slide._playerMuted = muted;
  showMuteIcon(slide, muted);
  // Sound turned on in the player's own controls: that is a choice too.
  if (!muted && was === true && state.muted) setMuted(false);
}

/**
 * Pause the active video while the app is in the background, and play it again on return
 * only if it was playing (a video paused by hand stays paused). Also listens to the
 * position reports of the YouTube player, for the resume.
 */
export function initReels() {
  document.addEventListener('visibilitychange', () => {
    const slide = state.reels.active;
    const video = slide?.querySelector('video:not(.reel-pre)');
    if (document.hidden) {
      if (slide) savePlayback(slide);
      if (video) { video._resumeOnShow = !video.paused; video.pause(); }
      if (slide?.querySelector('iframe')) { slide._ytResume = slide._ytState === 1; ytCommand(slide, 'pauseVideo'); }
    } else if (state.view === 'videos') {
      if (video?._resumeOnShow) { video._resumeOnShow = false; video.play().catch(() => {}); }
      if (slide?._ytResume) { slide._ytResume = false; ytCommand(slide, 'playVideo'); }
    }
  });
  document.addEventListener('fullscreenchange', onFullscreenChange);
  // Taps that count as a user gesture for the browser (a mute button tap is handled by toggleMute).
  for (const type of ['touchend', 'click', 'keydown']) {
    document.addEventListener(type, (e) => {
      unlockVideos();
      if (!e.target?.closest?.('.mute')) restoreSound();
      // That tap was for the sound: it does not also pause the video.
      if (type === 'click' && Date.now() - soundRestoredAt < 800 && e.target?.tagName === 'VIDEO') {
        soundRestoredAt = 0;
        e.stopPropagation();
      }
    }, { capture: true, passive: true });
  }
  window.addEventListener('message', (e) => {
    if (e.origin !== YT_ORIGIN && e.origin !== TIKTOK_ORIGIN) return;
    const slide = state.reels.active;
    const iframe = slide?.querySelector('iframe');
    if (!iframe || e.source !== iframe.contentWindow) return;
    let data;
    try { data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
    if (e.origin === TIKTOK_ORIGIN) { onTikTokMessage(slide, data); return; }
    // Player ready: apply the sound setting (the embed always starts muted).
    if ((data?.event === 'onReady' || data?.event === 'initialDelivery') && !slide._ytReady) {
      slide._ytReady = true;
      if (!state.muted) ytCommand(slide, 'unMute');
    }
    const info = data?.event === 'infoDelivery' || data?.event === 'initialDelivery' ? data.info : null;
    if (!info) return;
    if (Number.isFinite(info.currentTime)) slide._ytTime = info.currentTime;
    if (Number.isFinite(info.duration)) slide._ytDuration = info.duration;
    if (Number.isFinite(info.playerState)) slide._ytState = info.playerState;
    if (typeof info.muted === 'boolean') {
      // The unMute sent at « ready » can arrive before the video starts and be lost: once more
      // when it plays.
      if (info.muted && !state.muted && slide._ytState === 1 && !slide._soundRetried) {
        slide._soundRetried = true;
        ytCommand(slide, 'unMute');
      }
      onPlayerMuted(slide, info.muted);
    }
  });
}

/** Messages of the TikTok player: ready (apply the sound setting) and sound changes. */
function onTikTokMessage(slide, data) {
  if (!data?.['x-tiktok-player']) return;
  if (data.type === 'onPlayerReady') {
    slide._playerMuted = true; // started with muted=1
    if (!state.muted) iframeSound(slide, true);
    else showMuteIcon(slide, true);
  } else if (data.type === 'onMute' && typeof data.value === 'boolean') {
    onPlayerMuted(slide, data.value);
  }
}
