// Entry point: wires the modules of public/app/ together and boots the app.

import { actions } from './app/actions.js';
import { state, initStore } from './app/store.js';
import { initFeeds, renderAllFeeds } from './app/feed.js';
import { loadData, loadLive } from './app/live.js';
import { initSheet, openSheet } from './app/sheet.js';
import { initDiscover, renderDiscover } from './app/discover.js';
import { initProfile, openProfile, resumeProfile, renderProfileFollow } from './app/profile.js';
import { initThread, openThread, resumeThread } from './app/thread.js';
import { initReels } from './app/reels.js';
import { initTabs } from './app/tabs.js';
import { initRefresh } from './app/refresh.js';

actions.openProfile = openProfile;
actions.openSheet = openSheet;
actions.openThread = openThread;
actions.resumeProfile = resumeProfile;
actions.resumeThread = resumeThread;
actions.afterFollow = () => {
  if (state.view === 'discover') renderDiscover();
  if (state.view === 'profile') renderProfileFollow();
};

initStore();
initFeeds();
initSheet();
initDiscover();
initProfile();
initThread();
initReels();
initTabs();
initRefresh();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // updateViaCache 'none': sw.js is always revalidated, so a new deployment is noticed
  // (and re-checked each time the app comes back to the foreground).
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {});
}

await loadData();
renderAllFeeds();
loadLive(); // background: the collected data is already displayed
