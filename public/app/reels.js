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

const REELS_CHUNK = 5;

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
  let text = null;
  if (textContent) {
    text = h('div', { class: 'reel-text', text: textContent, 'aria-expanded': 'false' });
    makeButton(text, () => text.setAttribute('aria-expanded', String(text.classList.toggle('expanded'))));
  }

  const muteBtn = v.type === 'hls'
    ? h('button', { class: 'reel-btn mute', 'aria-label': 'Son', onclick: (e) => { e.stopPropagation(); toggleMute(); } }, svg(state.muted ? ICONS.muted : ICONS.sound, 24))
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
          h('span', { class: 'platform', text: `🎥 ${PLATFORM_LABELS[item.platform] || ''} · ${relativeTime(item.publishedAt)}` }),
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
    const video = h('video', { playsinline: true, 'webkit-playsinline': true, loop: true, preload: 'auto', poster: safeUrl(v.poster, location.href) || undefined });
    video.muted = state.muted;
    slide.insertBefore(video, slide.querySelector('.reel-play'));
    attachControls(slide, video);
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsSrc;
    } else {
      try {
        const Hls = await loadHls();
        if (state.reels.active !== slide) return;
        if (Hls?.isSupported()) {
          const hls = new Hls({ maxBufferLength: 20 });
          hls.loadSource(hlsSrc);
          hls.attachMedia(video);
          slide._hls = hls;
        } else {
          video.src = hlsSrc;
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

export function deactivateReel() {
  const slide = state.reels.active;
  if (!slide) return;
  slide.classList.remove('active', 'has-iframe');
  slide._hls?.destroy();
  slide._hls = null;
  slide.querySelectorAll('video, iframe, .reel-progress, .reel-flash').forEach((el) => {
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

function toggleMute() {
  state.muted = !state.muted;
  const video = state.reels.active?.querySelector('video');
  if (video) { video.muted = state.muted; if (!state.muted) video.play().catch(() => {}); }
  document.querySelectorAll('.reel .mute').forEach((b) => b.replaceChildren(svg(state.muted ? ICONS.muted : ICONS.sound, 24)));
}

/** Pause the active video while the app is in the background. */
export function initReels() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) state.reels.active?.querySelector('video')?.pause();
    else if (state.view === 'videos') state.reels.active?.querySelector('video')?.play().catch(() => {});
  });
}
