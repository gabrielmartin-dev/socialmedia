// Entry point: wires the modules of public/app/ together and boots the app.

import { actions } from './app/actions.js';
import { state, initStore } from './app/store.js';
import { initFeeds, renderAllFeeds } from './app/feed.js';
import { loadData, loadLive, applyData } from './app/live.js';
import { initSheet, openSheet } from './app/sheet.js';
import { initDiscover, renderDiscover, renderTabs, showDiscoverTab } from './app/discover.js';
import { $ } from './app/dom.js';
import { initProfile, openProfile, resumeProfile, renderProfileFollow } from './app/profile.js';
import { initThread, openThread, resumeThread } from './app/thread.js';
import { initReels } from './app/reels.js';
import { initTabs } from './app/tabs.js';
import { initRefresh, refresh, showLoaded } from './app/refresh.js';
import { initFresh, checkForNew, renderStatusBar } from './app/fresh.js';
import { initInfoSheet } from './app/infosheet.js';
import { initInstall } from './app/install.js';
import { initSettings } from './app/settings.js';
import { switchView } from './app/tabs.js';
import { initBars } from './app/bars.js';

actions.openProfile = openProfile;
actions.openSheet = openSheet;
actions.openThread = openThread;
actions.resumeProfile = resumeProfile;
actions.resumeThread = resumeThread;
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
initThread();
initReels();
initTabs();
initRefresh();
initInfoSheet();
initInstall();
initSettings();
initBars();
initFresh({ apply: (data) => { applyData(data); showLoaded(); } });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // updateViaCache 'none': sw.js is always revalidated, so a new deployment is noticed
  // (and re-checked each time the app comes back to the foreground).
  let shownAt = Date.now();
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { shownAt = Date.now(); reg.update().catch(() => {}); }
    });
  }).catch(() => {});

  // A new deployment's service worker takes over, but this page still runs the old
  // CSS/JS. On the home-screen app (iOS), the page is resumed rather than reloaded, so
  // without this the update would only show after the app is force-quit. Reload right
  // away when the app has just come to the foreground (nothing to lose yet), otherwise
  // the next time it goes to the background.
  if (navigator.serviceWorker.controller) {
    let pending = false;
    const reload = () => { pending = false; location.reload(); };
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (pending) return;
      pending = true;
      if (document.hidden || Date.now() - shownAt < 15000) reload();
      else document.addEventListener('visibilitychange', () => { if (document.hidden && pending) reload(); }, { once: true });
    });
  }
}

await loadData();
renderAllFeeds();
renderStatusBar();
loadLive(); // background: the collected data is already displayed
