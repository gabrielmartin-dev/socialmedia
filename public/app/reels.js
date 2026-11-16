// Vidéos tab: vertical reels with one active player at a time.

import { rank, relativeTime } from '../rank.js';
import { safeUrl } from '../url.js';
import { $, h, svg, ICONS, toast, scrollBehavior } from './dom.js';
import { avatar } from './media.js';
import { makeButton } from './focus.js';
import { attachControls } from './reelcontrols.js';
import { loadHls } from './hls.js';
import { state, entriesFor, rankOpts, markSeen } from './store.js';
import { actions } from './actions.js';
import { PLATFORM_LABELS } from './util.js';
import { linkify } from './cards.js';
import { getPosition, savePosition } from './resume.js';

const REELS_CHUNK = 5;
const YT_ORIGIN = 'https://www.youtube-nocookie.com';
/** Automatic new attempts on a broken stream before showing the error. */
const MAX_RETRIES = 2;

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

  const muteBtn = v.type === 'hls'
    ? h('button', { class: 'reel-btn mute', 'aria-label': 'Son', 'aria-pressed': String(!state.muted), onclick: (e) => { e.stopPropagation(); toggleMute(); } }, svg(state.muted ? ICONS.muted : ICONS.sound, 24))
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
  if (slide.querySelector('video, iframe')) {
    slide.querySelector('video')?.play().catch(() => {});
    return;
  }

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
    if (v.type === 'youtube') iframe.addEventListener('load', () => iframe.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), YT_ORIGIN));
    slide.classList.add('has-iframe');
    slide.insertBefore(iframe, slide.querySelector('.reel-play'));
  }
}

/** Creates the HLS player of `slide`: resume, loading spinner, automatic retries, error message. */
async function playHls(slide, hlsSrc, v) {
  const id = slide.dataset.id;
  const start = getPosition(id);
  const video = h('video', { playsinline: true, 'webkit-playsinline': true, loop: true, preload: 'auto', poster: safeUrl(v.poster, location.href) || undefined });
  video.muted = state.muted;
  slide.insertBefore(video, slide.querySelector('.reel-play'));
  slide.append(h('div', { class: 'reel-loading', 'aria-hidden': 'true' }, h('div', { class: 'spinner' })));
  attachControls(slide, video);

  // Spinner while the stream loads or stalls; none while paused.
  const loading = (on) => slide.classList.toggle('buffering', on);
  loading(true);
  video.addEventListener('waiting', () => loading(true));
  video.addEventListener('playing', () => loading(false));
  video.addEventListener('pause', () => loading(false));

  let retries = 0;
  const fail = () => {
    if (state.reels.active !== slide || !video.isConnected) return;
    loading(false);
    slide._hls?.destroy();
    slide._hls = null;
    showError(slide);
  };

  const native = video.canPlayType('application/vnd.apple.mpegurl');
  if (native) {
    if (start) video.addEventListener('loadedmetadata', () => { video.currentTime = start; }, { once: true });
    video.addEventListener('error', () => {
      if (state.reels.active !== slide || !video.isConnected) return;
      if (retries++ >= MAX_RETRIES) { fail(); return; }
      const at = video.currentTime || start;
      setTimeout(() => {
        if (state.reels.active !== slide || !video.isConnected) return;
        if (at) video.addEventListener('loadedmetadata', () => { video.currentTime = at; }, { once: true });
        video.src = hlsSrc;
        video.play().catch(() => {});
      }, 1000 * retries);
    });
    video.src = hlsSrc;
  } else {
    try {
      const Hls = await loadHls();
      if (state.reels.active !== slide) return;
      if (Hls?.isSupported()) {
        const hls = new Hls({ maxBufferLength: 20, startPosition: start || -1 });
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (!data.fatal || state.reels.active !== slide) return;
          if (retries++ >= MAX_RETRIES) { fail(); return; }
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
          // No playlist yet: load it again; otherwise resume loading the segments.
          else setTimeout(() => { if (slide._hls !== hls) return; if (hls.levels?.length) hls.startLoad(); else hls.loadSource(hlsSrc); }, 1000 * retries);
        });
        hls.loadSource(hlsSrc);
        hls.attachMedia(video);
        slide._hls = hls;
      } else {
        if (start) video.addEventListener('loadedmetadata', () => { video.currentTime = start; }, { once: true });
        video.addEventListener('error', fail);
        video.src = hlsSrc;
      }
    } catch {
      fail();
      return;
    }
  }
  try { await video.play(); } catch {
    if (state.reels.active !== slide || !video.isConnected) return;
    // Unmuted autoplay refused: retry muted, and say so on the sound button.
    if (!state.muted) setMuted(true);
    video.play().catch(() => {
      loading(false);
      slide.querySelector('.reel-play')?.classList.remove('auto');
    });
  }
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
  const video = slide.querySelector('video');
  if (video) savePosition(slide.dataset.id, video.currentTime, video.duration);
  else if (slide._ytTime != null) savePosition(slide.dataset.id, slide._ytTime, slide._ytDuration);
}

export function deactivateReel() {
  const slide = state.reels.active;
  if (!slide) return;
  savePlayback(slide);
  slide._ytTime = slide._ytDuration = null;
  slide.classList.remove('active', 'has-iframe', 'buffering');
  slide._hls?.destroy();
  slide._hls = null;
  slide.querySelectorAll('video, iframe, .reel-progress, .reel-flash, .reel-loading, .reel-error').forEach((el) => {
    if (el.tagName === 'VIDEO') { el.pause(); el.removeAttribute('src'); el.load(); }
    el.remove();
  });
  state.reels.active = null;
}

/** Takes a slide off the list. Returns { item, index } to give back to restoreReel, or null. */
export function removeReel(id) {
  const slide = document.querySelector(`.reel[data-id="${CSS.escape(id)}"]`);
  if (!slide) return null;
  const next = slide.nextElementSibling;
  const index = state.reels.ranked.findIndex((i) => i.id === id);
  const item = slide._item;
  if (state.reels.active === slide) deactivateReel();
  reelObserver().unobserve(slide);
  slide.remove();
  state.reels.ranked = state.reels.ranked.filter((i) => i.id !== id);
  state.reels.rendered = Math.max(0, state.reels.rendered - 1);
  if (next?._item) activateReel(next);
  return item ? { item, index } : null;
}

/** Puts a removed slide back where it was and shows it again. */
export function restoreReel({ item, index }) {
  const list = $('#videos-list');
  const at = Math.min(index, state.reels.ranked.length);
  state.reels.ranked.splice(at, 0, item);
  state.reels.rendered++;
  const slide = reelSlide(item);
  list.insertBefore(slide, list.children[at] || null);
  reelObserver().observe(slide);
  slide.scrollIntoView({ block: 'start' });
}

/** Sound on / off for the HLS reels; the icon always tells the truth. */
function setMuted(muted) {
  state.muted = muted;
  const video = state.reels.active?.querySelector('video');
  if (video) video.muted = muted;
  document.querySelectorAll('.reel .mute').forEach((b) => {
    b.replaceChildren(svg(muted ? ICONS.muted : ICONS.sound, 24));
    b.setAttribute('aria-pressed', String(!muted));
  });
}

function toggleMute() {
  setMuted(!state.muted);
  const video = state.reels.active?.querySelector('video');
  if (video && !state.muted) video.play().catch(() => {});
}

/**
 * Pause the active video while the app is in the background, and play it again on return
 * only if it was playing (a video paused by hand stays paused). Also listens to the
 * position reports of the YouTube player, for the resume.
 */
export function initReels() {
  document.addEventListener('visibilitychange', () => {
    const slide = state.reels.active;
    const video = slide?.querySelector('video');
    if (document.hidden) {
      if (slide) savePlayback(slide);
      if (video) { video._resumeOnShow = !video.paused; video.pause(); }
    } else if (state.view === 'videos' && video?._resumeOnShow) {
      video._resumeOnShow = false;
      video.play().catch(() => {});
    }
  });
  window.addEventListener('message', (e) => {
    if (e.origin !== YT_ORIGIN) return;
    const slide = state.reels.active;
    const iframe = slide?.querySelector('iframe');
    if (!iframe || e.source !== iframe.contentWindow) return;
    let data;
    try { data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
    const info = data?.event === 'infoDelivery' ? data.info : null;
    if (!info) return;
    if (Number.isFinite(info.currentTime)) slide._ytTime = info.currentTime;
    if (Number.isFinite(info.duration)) slide._ytDuration = info.duration;
  });
}
