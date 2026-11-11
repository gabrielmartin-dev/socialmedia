// Refresh (button + pull-to-refresh) and periodic housekeeping.

import { relativeTime } from '../rank.js';
import { $, toast } from './dom.js';
import { state, FEED_KEYS } from './store.js';
import { loadData, loadLive } from './live.js';
import { renderStatusBar, clearPending } from './fresh.js';
import { renderAllFeeds } from './feed.js';
import { buildReels } from './reels.js';

let refreshing = false;

/** Re-renders every feed from state.data and goes back to the top. */
export function showLoaded() {
  window.scrollTo({ top: 0 });
  FEED_KEYS.forEach((k) => { state.feeds[k].scroll = 0; });
  renderAllFeeds();
  state.reels.built = false;
  if (state.view === 'videos') buildReels();
  renderStatusBar();
  loadLive(); // background: live posts are merged as they arrive
}

export async function refresh() {
  if (refreshing) return;
  refreshing = true;
  const btn = $('#refresh');
  const ptr = document.querySelector(`#view-${state.view} .ptr`) || document.createElement('div');
  btn.classList.add('spinning');
  ptr.classList.add('loading');
  ptr.style.height = '56px';
  const before = state.data.actus?.generatedAt;
  await loadData();
  clearPending();
  showLoaded();
  btn.classList.remove('spinning');
  ptr.classList.remove('loading');
  ptr.style.height = '0';
  refreshing = false;
  toast(state.data.actus?.generatedAt && state.data.actus.generatedAt !== before ? 'Nouveaux contenus' : 'Timeline mélangée');
}

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

export function initRefresh() {
  $('#refresh').addEventListener('click', refresh);
  FEED_KEYS.forEach(pullToRefresh);
  // Keep relative times fresh.
  setInterval(() => {
    document.querySelectorAll('time[datetime]').forEach((t) => { t.textContent = relativeTime(t.getAttribute('datetime')); });
    renderStatusBar();
  }, 60_000);
}
