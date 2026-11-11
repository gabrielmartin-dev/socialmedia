// Profile pages (collected posts first, then the live Bluesky timeline).

import { authorPage, getProfile } from '../bsky.js';
import { safeUrl } from '../url.js';
import { $, h, svg, ICONS } from './dom.js';
import { avatar } from './media.js';
import { renderEntry, linkify, stopAllInline } from './cards.js';
import { followButton } from './discover.js';
import { deactivateReel } from './reels.js';
import { switchView } from './tabs.js';
import { viewerPop } from './viewer.js';
import { actions } from './actions.js';
import { state, isFeed, accountFromSource } from './store.js';
import { KIND_LABEL, domainOf } from './util.js';

const profile = { account: null, prev: 'actus', prevScroll: 0, seq: 0 };

const PAGE_SIZE = 30;
const MAX_POSTS = 300; // the page is a plain list: stop before it gets too heavy
const OPEN_LABEL = { media: 'Ouvrir le site', bluesky: 'Ouvrir sur Bluesky', youtube: 'Ouvrir sur YouTube', tiktok: 'Ouvrir sur TikTok' };

/** Visible button to the account's own page (site, Bluesky profile, channel…). */
function openButton(a) {
  const href = safeUrl(a.url, location.href);
  if (!href) return null;
  return h('a', { class: 'open-site-btn', href, target: '_blank', rel: 'noopener' }, svg(ICONS.open, 16), OPEN_LABEL[a.kind] || 'Ouvrir le site');
}

function allCollectedItems() {
  const out = [];
  for (const key of ['actus', 'tech', 'videos']) {
    for (const e of state.data[key]?.entries || []) {
      if (e.kind === 'group') out.push(...e.items);
      else out.push(e);
    }
  }
  out.push(...state.live.actus, ...state.live.tech);
  return out;
}

function profilePostsFromData(id) {
  const seen = new Set();
  return allCollectedItems()
    .filter((i) => i.source?.id === id && !seen.has(i.url) && seen.add(i.url))
    .map((i) => ({ ...i, kind: i.kind === 'video' && i.platform === 'bluesky' ? 'post' : i.kind }))
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

export function openProfile(src) {
  if (!src?.id) return;
  const account = { ...accountFromSource(src), ...(state.accounts.get(src.id) || {}) };
  if (state.view !== 'profile') {
    profile.prev = state.view;
    profile.prevScroll = window.scrollY;
    if (isFeed(state.view)) state.feeds[state.view].scroll = window.scrollY;
    history.pushState({ profile: src.id }, '');
  } else {
    history.replaceState({ profile: src.id }, '');
  }
  profile.account = account;
  deactivateReel();
  stopAllInline();
  state.view = 'profile';
  document.body.classList.remove('videos-mode');
  document.body.classList.add('profile-mode');
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-profile'));
  renderProfile();
  window.scrollTo({ top: 0 });
}

/** Show the profile again, as it was (back from a thread opened on top of it). */
export function resumeProfile() {
  state.view = 'profile';
  document.body.classList.add('profile-mode');
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-profile'));
}

function closeProfile() {
  if (state.view !== 'profile') return;
  document.body.classList.remove('profile-mode');
  const prev = profile.prev;
  state.view = null;
  if (prev === 'thread') { actions.resumeThread(); window.scrollTo({ top: profile.prevScroll || 0 }); return; }
  switchView(prev);
  window.scrollTo({ top: profile.prevScroll || 0 });
}

export function renderProfileFollow() {
  const slot = $('#profile-follow');
  if (slot && profile.account) slot.replaceChildren(followButton(profile.account));
}

async function renderProfile() {
  const a = profile.account;
  const seq = ++profile.seq;
  const isBsky = a.id.startsWith('bsky:');
  const handle = isBsky ? a.id.slice(5) : '';
  const site = a.url ? domainOf(a.url) : '';
  const kindLabel = KIND_LABEL[a.kind] || '';

  const banner = h('div', { class: 'profile-banner' });
  const avatarBox = h('div', { class: 'profile-avatar' }, avatar(a.avatar, a.name, { square: a.kind === 'media' }));
  const bio = h('div', { class: 'profile-bio' }, a.description ? linkify(a.description) : null);
  const meta = h('div', { class: 'profile-meta' },
    kindLabel ? h('span', { text: kindLabel }) : null,
    a.url ? h('a', { class: 'link', href: a.url, target: '_blank', rel: 'noopener', text: site || a.url }) : null,
  );
  const list = h('div', { class: 'profile-posts' });
  $('#profile-root').replaceChildren(
    h('div', { class: 'profile-top' },
      h('button', { class: 'profile-back', 'aria-label': 'Retour', onclick: () => history.back() }, svg(ICONS.back, 22)),
    ),
    banner,
    h('div', { class: 'profile-head' },
      avatarBox,
      h('div', { id: 'profile-follow' }),
      h('div', { class: 'profile-name', text: a.name }),
      h('div', { class: 'profile-handle', text: isBsky ? '@' + handle : (a.handle && !a.handle.startsWith('@') ? a.handle : a.handle || '') }),
      bio,
      meta,
      openButton(a),
    ),
    h('div', { class: 'profile-tabs' }, h('span', { class: 'active', text: 'Posts' })),
    list,
  );
  renderProfileFollow();

  // Posts: collected data first (instant), then Bluesky live for a full, fresh timeline.
  const tail = h('div', { class: 'profile-tail' });
  const known = new Set(); // ids shown, to never repeat a post when the pages overlap
  const showPosts = (items) => {
    known.clear();
    items.forEach((i) => known.add(i.id));
    list.replaceChildren(...(items.length
      ? items.slice(0, 80).map((i) => renderEntry(i))
      : [h('div', { class: 'empty' }, h('strong', { text: 'Aucun post récent' }), 'Rien de publié ces derniers jours.', openButton(a))]));
  };
  list.after(tail);
  showPosts(profilePostsFromData(a.id));

  if (isBsky) {
    try {
      const [p, first] = await Promise.all([getProfile(handle), authorPage(handle, { limit: PAGE_SIZE })]);
      if (seq !== profile.seq) return;
      const posts = first.items;
      const bannerUrl = safeUrl(p.banner, location.href);
      if (bannerUrl) banner.style.backgroundImage = `url("${bannerUrl.replace(/"/g, '%22')}")`;
      if (p.avatar && !a.avatar) avatarBox.replaceChildren(avatar(p.avatar, a.name));
      if (p.description && !a.description) bio.replaceChildren(...linkify(p.description));
      const suggested = state.accounts.get(a.id)?.suggested;
      const withSource = (i) => ({ ...i, source: { ...i.source, suggested } });
      showPosts(posts.map(withSource));
      paginate({ handle, seq, list, tail, cursor: first.cursor, known, withSource });
    } catch { /* keep collected posts */ }
  }
}

/**
 * Older posts, page after page, with the API's `cursor`: the next page loads when the end of
 * the list nears the screen. Stops at the end of the timeline (or MAX_POSTS).
 */
function paginate({ handle, seq, list, tail, cursor, known, withSource }) {
  let loading = false;
  let observer = null;
  const finish = (text) => { observer?.disconnect(); tail.replaceChildren(h('div', { class: 'profile-end', text })); };
  if (!cursor) { finish('Fin des posts'); return; }

  const more = async () => {
    if (loading || seq !== profile.seq) return;
    loading = true;
    tail.replaceChildren(h('span', { class: 'spinner small' }));
    try {
      // Replies and reposts are left out, so a page can be empty: keep going until something shows up.
      for (let tries = 0; tries < 5 && cursor; tries++) {
        const page = await authorPage(handle, { limit: PAGE_SIZE, cursor });
        if (seq !== profile.seq) return;
        cursor = page.cursor;
        const fresh = page.items.filter((i) => !known.has(i.id));
        fresh.forEach((i) => known.add(i.id));
        list.append(...fresh.map((i) => renderEntry(withSource(i))));
        if (fresh.length) break;
      }
      if (!cursor || known.size >= MAX_POSTS) { finish('Fin des posts'); return; }
      tail.replaceChildren();
      // Still near the screen (short page)? Observing again reports the current state, which loads the next page.
      observer.unobserve(tail);
      observer.observe(tail);
    } catch {
      observer?.disconnect();
      tail.replaceChildren(h('button', { class: 'empty-btn ghost', type: 'button', text: 'Réessayer', onclick: () => { observer?.observe(tail); more(); } }));
    } finally {
      loading = false;
    }
  };
  observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) more(); }, { rootMargin: '600px' });
  observer.observe(tail);
}

/** Back gesture: closes the image viewer first, then the profile. */
export function initProfile() {
  window.addEventListener('popstate', (e) => {
    if (viewerPop(e)) return;
    if (state.view === 'profile') closeProfile();
  });
}
