// Actus / Tech feeds: ranking, incremental rendering, footer.

import { rank, emptyPrefs, relativeTime } from '../rank.js';
import { $, h, toast } from './dom.js';
import { renderEntry } from './cards.js';
import { state, FEED_KEYS, entriesFor, rankOpts, savePrefs, seenTracker, markSeen } from './store.js';

const ACTUS_CHUNK = 15;

// A card counts as seen once at least half of it has been on screen.
let seenObs = null;
const seenObserver = () => (seenObs ||= new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.isIntersecting) {
      markSeen(e.target.dataset.id);
      // Also count every article of a "N médias en parlent" card.
      (e.target._memberIds || []).forEach(markSeen);
      seenObs.unobserve(e.target);
    }
  }
}, { threshold: 0.5 }));

export function renderFeed(key) {
  const feed = state.feeds[key];
  const data = state.data[key];
  const list = $(`#${key}-list`);
  list.replaceChildren();
  feed.ranked = data ? rank(entriesFor(key), rankOpts(data), state.hidden) : [];
  feed.rendered = 0;
  feed.dirty = false;
  if (!feed.ranked.length) {
    list.append(h('div', { class: 'empty' },
      h('strong', { text: data ? 'Rien pour le moment' : 'Pas encore de données' }),
      data ? 'Reviens un peu plus tard.' : 'La collecte n’a pas encore tourné. Attends la prochaine mise à jour automatique.',
    ));
  }
  appendFeed(key);
  renderFooter(key);
}

export function renderAllFeeds() {
  FEED_KEYS.forEach(renderFeed);
}

export function appendFeed(key) {
  const feed = state.feeds[key];
  const list = $(`#${key}-list`);
  const end = Math.min(feed.ranked.length, feed.rendered + ACTUS_CHUNK);
  const frag = document.createDocumentFragment();
  for (let i = feed.rendered; i < end; i++) {
    const entry = feed.ranked[i];
    const card = renderEntry(entry);
    if (entry.kind === 'group') card._memberIds = entry.items.map((it) => it.id);
    seenObserver().observe(card);
    frag.append(card);
  }
  list.append(frag);
  feed.rendered = end;
}

export function renderFooter(key) {
  const f = $(`#${key}-footer`);
  const gen = state.data[key]?.generatedAt;
  const failed = state.data.status?.sources?.filter((s) => !s.ok).length || 0;
  const hasPrefs = Object.keys(state.prefs.sources).length || Object.keys(state.prefs.keywords).length || state.hidden.size;
  f.replaceChildren(
    gen ? h('div', { text: `Mis à jour il y a ${relativeTime(gen).replace("à l'instant", 'quelques secondes')}` + (failed ? ` · ${failed} source${failed > 1 ? 's' : ''} indisponible${failed > 1 ? 's' : ''}` : '') }) : null,
    hasPrefs ? h('button', {
      text: 'Réinitialiser mes préférences « moins de ça »',
      onclick: () => {
        state.prefs = emptyPrefs();
        state.hidden.clear();
        seenTracker.reset();
        savePrefs();
        renderAllFeeds();
        state.reels.built = false;
        toast('Préférences réinitialisées');
      },
    }) : null,
  );
}

/** Infinite scroll: render the next chunk when the sentinel nears the viewport. */
export function initFeeds() {
  for (const key of FEED_KEYS) {
    new IntersectionObserver((entries) => {
      const feed = state.feeds[key];
      if (entries.some((e) => e.isIntersecting) && feed.rendered < feed.ranked.length) appendFeed(key);
    }, { rootMargin: '800px' }).observe($(`#${key}-sentinel`));
  }
}
