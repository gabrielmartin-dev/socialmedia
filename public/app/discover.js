// Découvrir tab: suggestions, subscriptions, Bluesky account search.

import { searchAccounts } from '../bsky.js';
import { relativeTime } from '../rank.js';
import { $, h } from './dom.js';
import { avatar } from './media.js';
import { state, isFollowed } from './store.js';
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
    h('button', { class: 'clickable', onclick: () => actions.openProfile(a) }, avatar(a.avatar, a.name, { square: a.kind === 'media' })),
    h('div', { class: 'account-main' },
      h('div', { class: 'account-head' },
        h('div', { class: 'account-names' },
          h('span', { class: 'name clickable', text: a.name, onclick: () => actions.openProfile(a) }),
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

let searchTimer = null;
let searchSeq = 0;
export function renderDiscover() {
  const results = $('#discover-results');
  const q = $('#discover-search').value.trim();
  if (q.length >= 2) return; // search results are rendered by the search handler

  const all = [...state.accounts.values()];
  const liveFollows = Object.entries(state.follows.live).map(([id, p]) => ({ id, kind: 'bluesky', ...p }));
  const followed = [...all.filter((a) => isFollowed(a)), ...liveFollows.filter((a) => !state.accounts.has(a.id))]
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const suggestions = all.filter((a) => !isFollowed(a));
  const order = ['Médias', 'Personnalités', 'Tech', 'YouTube', 'TikTok'];
  const cats = [...new Set(suggestions.map((a) => a.category || 'Autres'))].sort((a, b) => (order.indexOf(a) + 99) % 99 - (order.indexOf(b) + 99) % 99);

  results.replaceChildren(
    ...(state.data.accounts ? [] : [h('div', { class: 'disc-empty', text: 'Les suggestions apparaîtront après la prochaine mise à jour automatique.' })]),
    ...cats.map((c) => section(`Suggestions · ${c}`, suggestions.filter((a) => (a.category || 'Autres') === c).map(accountRow), '')),
    section(`Tes abonnements (${followed.length})`, followed.map(accountRow), 'Tu ne suis personne pour le moment.'),
  );
}

export function initDiscover() {
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
