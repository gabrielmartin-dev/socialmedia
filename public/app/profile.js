// Profile pages (collected posts first, then the live Bluesky timeline).

import { authorPosts, getProfile } from '../bsky.js';
import { safeUrl } from '../url.js';
import { $, h, svg, ICONS } from './dom.js';
import { avatar } from './media.js';
import { renderEntry, linkify, stopAllInline } from './cards.js';
import { followButton } from './discover.js';
import { deactivateReel } from './reels.js';
import { switchView } from './tabs.js';
import { viewer, closeViewer } from './viewer.js';
import { state, isFeed, accountFromSource } from './store.js';
import { KIND_LABEL, domainOf } from './util.js';

const profile = { account: null, prev: 'actus', prevScroll: 0, seq: 0 };

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

function closeProfile() {
  if (state.view !== 'profile') return;
  document.body.classList.remove('profile-mode');
  const prev = profile.prev;
  state.view = null;
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
    ),
    h('div', { class: 'profile-tabs' }, h('span', { class: 'active', text: 'Posts' })),
    list,
  );
  renderProfileFollow();

  // Posts: collected data first (instant), then Bluesky live for a full, fresh timeline.
  const showPosts = (items) => {
    list.replaceChildren(...(items.length
      ? items.slice(0, 80).map((i) => renderEntry(i))
      : [h('div', { class: 'empty' }, h('strong', { text: 'Aucun post récent' }), 'Rien de publié ces derniers jours.')]));
  };
  showPosts(profilePostsFromData(a.id));

  if (isBsky) {
    try {
      const [p, posts] = await Promise.all([getProfile(handle), authorPosts(handle, 50)]);
      if (seq !== profile.seq) return;
      const bannerUrl = safeUrl(p.banner, location.href);
      if (bannerUrl) banner.style.backgroundImage = `url("${bannerUrl.replace(/"/g, '%22')}")`;
      if (p.avatar && !a.avatar) avatarBox.replaceChildren(avatar(p.avatar, a.name));
      if (p.description && !a.description) bio.replaceChildren(...linkify(p.description));
      const known = state.accounts.get(a.id);
      showPosts(posts.map((i) => ({ ...i, source: { ...i.source, suggested: known?.suggested } })));
    } catch { /* keep collected posts */ }
  }
}

/** Back gesture: closes the image viewer first, then the profile. */
export function initProfile() {
  window.addEventListener('popstate', () => {
    if (viewer.open) { closeViewer(false); return; }
    if (state.view === 'profile') closeProfile();
  });
}
