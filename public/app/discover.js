// Découvrir tab: suggestions, subscriptions, Bluesky account search.

import { searchAccounts } from '../bsky.js';
import { relativeTime } from '../rank.js';
import { $, h } from './dom.js';
import { avatar } from './media.js';
import { state, isFollowed } from './store.js';
import { renderEntry } from './cards.js';
import { actions } from './actions.js';
import { setFollow } from './follow.js';
import { KIND_LABEL } from './util.js';

export function followButton(account) {
  const following = isFollowed(account, { strict: true });
  const btn = h('button', {
    class: 'follow-btn' + (following ? ' following' : ''),
    text: following ? 'Abonné' : 'Suivre',
    onclick: async (e) => {
      e.stopPropagation();
      await setFollow(account, !following);
      // Search results are not re-rendered by setFollow: refresh this button.
      if (btn.isConnected) btn.replaceWith(followButton(account));
    },
  });
  return btn;
}

function accountRow(a) {
  return h('div', { class: 'account' },
    h('button', { class: 'clickable', type: 'button', 'aria-label': `Voir le profil de ${a.name}`, onclick: () => actions.openProfile(a) }, avatar(a.avatar, a.name, { square: a.kind === 'media' })),
    h('div', { class: 'account-main' },
      h('div', { class: 'account-head' },
        h('div', { class: 'account-names' },
          h('button', { class: 'name clickable', type: 'button', text: a.name, onclick: () => actions.openProfile(a) }),
          h('span', { class: 'handle', text: [a.handle, KIND_LABEL[a.kind]].filter(Boolean).join(' · ') }),
        ),
        followButton(a),
      ),
      a.description ? h('div', { class: 'account-desc', text: a.description }) : null,
      a.lastTitle ? h('div', { class: 'account-last', text: `${relativeTime(a.lastAt)} · ${a.lastTitle}` }) : null,
    ),
  );
}

function section(title, rows, empty) {
  return h('section', { class: 'disc-section' },
    h('h2', { text: title }),
    rows.length ? rows : h('div', { class: 'disc-empty', text: empty }),
  );
}

// Sections of the tab: Abonnements (default), Suggestions, Enregistrés.
let tab = 'follows';

export function showDiscoverTab(next) {
  tab = next;
  if (state.view === 'discover') renderDiscover();
}

export function renderTabs() {
  const counts = { follows: followedAccounts().length, saved: state.saved.length };
  for (const btn of document.querySelectorAll('#discover-tabs [role=tab]')) {
    const on = btn.dataset.tab === tab;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', String(on));
    const base = { follows: 'Abonnements', suggestions: 'Suggestions', saved: 'Enregistrés' }[btn.dataset.tab];
    btn.textContent = counts[btn.dataset.tab] ? `${base} (${counts[btn.dataset.tab]})` : base;
  }
}

function followedAccounts() {
  const all = [...state.accounts.values()];
  const liveFollows = Object.entries(state.follows.live).map(([id, p]) => ({ id, kind: 'bluesky', ...p }));
  return [...all.filter((a) => isFollowed(a)), ...liveFollows.filter((a) => !state.accounts.has(a.id))]
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

const emptyBlock = (text, button) => h('div', { class: 'disc-empty' }, text, button);
const goTo = (label, target) => h('button', { class: 'empty-btn', type: 'button', text: label, onclick: () => showDiscoverTab(target) });

let searchTimer = null;
let searchSeq = 0;
export function renderDiscover() {
  const results = $('#discover-results');
  const q = $('#discover-search').value.trim();
  $('#discover-tabs').hidden = q.length >= 2;
  if (q.length >= 2) return; // search results are rendered by the search handler
  renderTabs();

  if (tab === 'saved') {
    results.replaceChildren(...(state.saved.length
      ? state.saved.map((item) => renderEntry(item))
      : [emptyBlock('Rien d’enregistré pour le moment. Dans le menu ⋯ d’un post, « Enregistrer » le garde ici pour le lire plus tard, même quand il a disparu du fil.', goTo('Voir les abonnements', 'follows'))]));
    return;
  }

  if (tab === 'suggestions') {
    const suggestions = [...state.accounts.values()].filter((a) => !isFollowed(a));
    const order = ['Médias', 'Personnalités', 'Tech', 'YouTube', 'TikTok'];
    const cats = [...new Set(suggestions.map((a) => a.category || 'Autres'))].sort((a, b) => (order.indexOf(a) + 99) % 99 - (order.indexOf(b) + 99) % 99);
    results.replaceChildren(
      ...(state.data.accounts ? [] : [emptyBlock('Les suggestions apparaîtront après la prochaine mise à jour automatique.')]),
      ...cats.map((c) => section(`Suggestions · ${c}`, suggestions.filter((a) => (a.category || 'Autres') === c).map(accountRow), '')),
      ...(state.data.accounts && !cats.length ? [emptyBlock('Plus aucune suggestion : tu suis déjà tout ce que la collecte connaît.')] : []),
    );
    return;
  }

  const followed = followedAccounts();
  results.replaceChildren(followed.length
    ? section(`Tes abonnements (${followed.length})`, followed.map(accountRow), '')
    : emptyBlock('Tu ne suis personne pour le moment.', goTo('Voir les suggestions', 'suggestions')));
}

export function initDiscover() {
  $('#discover-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[role=tab]');
    if (btn) showDiscoverTab(btn.dataset.tab);
  });
  $('#discover-search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = $('#discover-search').value.trim();
    if (q.length < 2) { renderDiscover(); return; }
    searchTimer = setTimeout(async () => {
      const seq = ++searchSeq;
      const results = $('#discover-results');
      const ql = q.toLowerCase();
      const local = [...state.accounts.values()].filter((a) => `${a.name} ${a.handle}`.toLowerCase().includes(ql));
      results.replaceChildren(section('Recherche…', local.map(accountRow), ''));
      let remote = [];
      try { remote = await searchAccounts(q); } catch { /* offline */ }
      if (seq !== searchSeq) return;
      remote = remote.filter((r) => !local.some((l) => l.id === r.id));
      results.replaceChildren(
        local.length ? section('Dans tes sources', local.map(accountRow), '') : '',
        section('Comptes Bluesky', remote.map(accountRow), 'Aucun compte trouvé.'),
      );
    }, 350);
  });
}
