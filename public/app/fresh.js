// Freshness of the data: subtitle of the top bar (age, offline, unavailable sources) and the
// "Nouveaux posts ↑" pill shown when the app comes back and the collector has published more.

import { $, h } from './dom.js';
import { state } from './store.js';
import { fetchData } from './live.js';
import { openInfoSheet } from './infosheet.js';
import { ageLabel, failedSources, failedLabel, latestGeneratedAt, newEntryCount } from '../freshness.js';

const FEEDS = ['actus', 'tech', 'videos'];
let pending = null; // data fetched in the background, not displayed yet
let applyPending = () => {};

/** Subtitle under the title: "à jour il y a 12 min", "hors ligne", tappable failed sources. */
export function renderStatusBar() {
  const sub = $('#topbar-sub');
  if (!sub) return;
  const d = state.data;
  const age = ageLabel(latestGeneratedAt(d.actus, d.tech, d.videos, d.status));
  const offline = navigator.onLine === false;
  const failed = failedSources(d.status);
  const parts = [];
  if (offline) parts.push(h('span', { class: 'offline', text: 'hors ligne' }));
  if (age.text) parts.push(h('span', { class: age.stale ? 'stale' : '', text: offline ? age.text.replace('à jour', 'données') : age.text }));
  if (failed.length) {
    parts.push(h('button', { class: 'sources-btn', type: 'button', text: failedLabel(failed.length), onclick: () => showFailedSources() }));
  }
  sub.replaceChildren(...parts.flatMap((p, i) => (i ? [' · ', p] : [p])));
}

function showFailedSources() {
  const failed = failedSources(state.data.status);
  openInfoSheet(failedLabel(failed.length),
    h('p', { class: 'info-note', text: 'Ces sources n’ont pas répondu à la dernière collecte. Les autres s’affichent normalement.' }),
    h('ul', { class: 'info-list' }, failed.map((s) => h('li', {},
      h('strong', { text: s.name }),
      h('small', { text: [s.type, s.error].filter(Boolean).join(' · ') }),
    ))));
}

// ---------- "Nouveaux posts" ----------
const pill = () => $('#new-pill');

/** Shows the pill when the feed of the current tab has pending news. */
export function updatePill() {
  const el = pill();
  if (!el) return;
  const feed = FEEDS.includes(state.view) ? state.view : null;
  el.hidden = !(feed && pending && newEntryCount(state.data[feed], pending[feed]) > 0);
}

export function clearPending() {
  pending = null;
  updatePill();
}

/**
 * Re-checks the collected data in the background. The displayed feed is never replaced:
 * if there is something new, only the pill appears, and the data is swapped on tap.
 */
export async function checkForNew() {
  const next = await fetchData();
  if (!FEEDS.some((k) => next[k])) return; // offline or failed
  // Status (age, unavailable sources) is not part of the feed: it can be updated silently.
  if (next.status) state.data.status = next.status;
  pending = next;
  renderStatusBar();
  updatePill();
}

export function initFresh({ apply }) {
  applyPending = apply;
  $('#new-pill').addEventListener('click', () => {
    const data = pending;
    pending = null;
    updatePill();
    if (data) applyPending(data);
  });
  window.addEventListener('online', renderStatusBar);
  window.addEventListener('offline', renderStatusBar);
  renderStatusBar();
}
