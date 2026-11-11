// Actus / Tech feeds: ranking, incremental rendering, footer.

import { rank, emptyPrefs } from '../rank.js';
import { $, h, toast } from './dom.js';
import { renderEntry } from './cards.js';
import { actions } from './actions.js';
import { maxAgeMs } from './live.js';
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
  if (!feed.ranked.length) list.append(emptyState(key, data));
  appendFeed(key);
  renderFooter(key);
}

/** Empty feed: say why and offer the action that makes sense (refresh, or find accounts to follow). */
function emptyState(key, data) {
  const noneFollowed = data?.entries?.length > 0; // there is content, but none from the accounts followed
  if (noneFollowed) {
    return h('div', { class: 'empty' },
      h('strong', { text: 'Plus rien à afficher' }),
      'Tu ne suis plus aucun compte de ce fil.',
      h('button', { class: 'empty-btn', type: 'button', text: 'Découvrir des comptes', onclick: () => actions.switchView('discover') }));
  }
  return h('div', { class: 'empty' },
    h('strong', { text: data ? 'Rien pour le moment' : 'Pas encore de données' }),
    data ? 'Reviens un peu plus tard.' : 'La collecte n’a pas encore tourné. Attends la prochaine mise à jour automatique.',
    h('button', { class: 'empty-btn', type: 'button', text: 'Rafraîchir', onclick: () => actions.refresh() }));
}

export function renderAllFeeds() {
  FEED_KEYS.forEach(renderFeed);
}

/** A feed card, watched to count it as seen. */
export function makeCard(entry) {
  const card = renderEntry(entry);
  if (entry.kind === 'group') card._memberIds = entry.items.map((it) => it.id);
  seenObserver().observe(card);
  return card;
}

export function appendFeed(key) {
  const feed = state.feeds[key];
  const list = $(`#${key}-list`);
  const end = Math.min(feed.ranked.length, feed.rendered + ACTUS_CHUNK);
  const frag = document.createDocumentFragment();
  for (let i = feed.rendered; i < end; i++) frag.append(makeCard(feed.ranked[i]));
  list.append(frag);
  feed.rendered = end;
  renderFooter(key); // the end-of-feed marker appears with the last card
}

export function renderFooter(key) {
  const f = $(`#${key}-footer`);
  const feed = state.feeds[key];
  const atEnd = feed.ranked.length > 0 && feed.rendered >= feed.ranked.length;
  const hours = Math.round(maxAgeMs(key) / 3600e3);
  const hasPrefs = Object.keys(state.prefs.sources).length || Object.keys(state.prefs.keywords).length || state.hidden.size;
  // (replaceChildren would write the text "null" for a null argument)
  f.replaceChildren(...[
    atEnd ? h('div', { class: 'end-marker' },
      h('strong', { text: 'Tu es à jour' }),
      h('span', { text: `Tu as parcouru tout ce qui est paru ces ${hours >= 48 ? Math.round(hours / 24) + ' derniers jours' : hours + ' dernières heures'}.` }),
    ) : null,
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
  ].filter(Boolean));
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
