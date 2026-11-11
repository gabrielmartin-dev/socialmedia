// Tab bar and view switching.

import { $, scrollBehavior } from './dom.js';
import { state, isFeed } from './store.js';
import { renderFeed } from './feed.js';
import { renderDiscover } from './discover.js';
import { buildReels, activateReel, deactivateReel } from './reels.js';
import { stopAllInline } from './cards.js';

const TITLES = { actus: 'Actus', tech: 'Tech', videos: 'Vidéos', discover: 'Découvrir' };

export function switchView(view) {
  if (view === state.view) {
    // Tap on the active tab: scroll back to top.
    if (view === 'videos') $('#videos-list').scrollTo({ top: 0, behavior: scrollBehavior() });
    else window.scrollTo({ top: 0, behavior: scrollBehavior() });
    return;
  }
  if (isFeed(state.view)) state.feeds[state.view].scroll = window.scrollY;
  if (view !== 'discover') $('#discover-search').blur();
  document.body.classList.remove('profile-mode');
  state.view = view;
  document.querySelectorAll('.tab').forEach((t) => {
    const on = t.dataset.view === view;
    t.classList.toggle('active', on);
    if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  document.body.classList.toggle('videos-mode', view === 'videos');
  $('#title').textContent = TITLES[view];
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

export function initTabs() {
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchView(t.dataset.view)));
}
