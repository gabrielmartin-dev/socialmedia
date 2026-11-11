// Entry point: wires the modules of public/app/ together and boots the app.

import { actions } from './app/actions.js';
import { state, initStore } from './app/store.js';
import { initFeeds, renderAllFeeds } from './app/feed.js';
import { loadData, loadLive, applyData } from './app/live.js';
import { initSheet, openSheet } from './app/sheet.js';
import { initDiscover, renderDiscover, renderTabs, showDiscoverTab } from './app/discover.js';
import { $ } from './app/dom.js';
import { initProfile, openProfile, renderProfileFollow } from './app/profile.js';
import { initReels } from './app/reels.js';
import { initTabs } from './app/tabs.js';
import { initRefresh, refresh, showLoaded } from './app/refresh.js';
import { initFresh, checkForNew, renderStatusBar } from './app/fresh.js';
import { initInfoSheet } from './app/infosheet.js';
import { switchView } from './app/tabs.js';

actions.openProfile = openProfile;
actions.openSheet = openSheet;
actions.afterSavedChange = () => { if (state.view === 'discover') renderTabs(); };
actions.afterFollow = () => {
  if (state.view === 'discover') renderDiscover();
  if (state.view === 'profile') renderProfileFollow();
};

actions.switchView = switchView;
actions.refresh = refresh;
actions.afterLongAbsence = checkForNew;

$('#saved-btn').addEventListener('click', () => {
  showDiscoverTab('saved');
  switchView('discover');
});

initStore();
initFeeds();
initSheet();
initDiscover();
initProfile();
initReels();
initTabs();
initRefresh();
initInfoSheet();
initFresh({ apply: (data) => { applyData(data); showLoaded(); } });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // updateViaCache 'none': sw.js is always revalidated, so a new deployment is noticed
  // (and re-checked each time the app comes back to the foreground).
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {});
}

await loadData();
renderAllFeeds();
renderStatusBar();
loadLive(); // background: the collected data is already displayed
