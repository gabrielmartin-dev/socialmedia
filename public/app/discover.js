// Découvrir tab: suggestions, subscriptions, Bluesky account search.

import { searchAccounts, recentlyRelayed } from '../bsky.js';
import { relativeTime, topicScore } from '../rank.js';
import { $, h, toast } from './dom.js';
import { avatar } from './media.js';
import { state, isFollowed, entriesFor, savePrefs, FEED_KEYS } from './store.js';
import { normalize } from '../norm.js';
import { searchItems, rankSuggestions, activityNote, repostedBy, pickRelayers } from '../find.js';
import { discoveredAccounts } from '../discovery.js';
import { pool } from '../pool.js';
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

/** Local weight of an account (« Moins de ça » / « Plus de ça »), with a button to reset it. */
function weightNote(a) {
  const w = state.prefs.sources[a.id];
  if (!w || w === 1) return null;
  return h('div', { class: 'account-weight' },
    h('span', { text: w < 1 ? 'Réduit par « Moins de ça »' : 'Augmenté par « Plus de ça »' }),
    h('button', {
      type: 'button', text: 'Rétablir',
      onclick: () => {
        const previous = w;
        // The feeds are ranked again with the new weight when shown (after « Annuler » too).
        const changed = () => {
          savePrefs();
          FEED_KEYS.forEach((k) => { state.feeds[k].dirty = true; });
          state.reels.built = false;
          renderDiscover();
        };
        delete state.prefs.sources[a.id];
        changed();
        toast(`${a.name} : poids rétabli`, { action: { label: 'Annuler', run: () => { state.prefs.sources[a.id] = previous; changed(); } } });
      },
    }));
}

function accountRow(a, note) {
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
      weightNote(a),
      note ? h('div', { class: 'account-note', text: note }) : null,
      a.by?.length ? h('div', { class: 'account-note', text: repostedBy(a.by) }) : null,
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

// « Voir plus » under « Repostés par tes abonnements », and the accounts found by « Rafraîchir ».
let showMore = false;
const fresh = { accounts: null, loading: false, used: new Set() };

const bare = (handle) => String(handle || '').replace(/^@/, '').toLowerCase();

/** Followed Bluesky accounts whose reposts are worth scanning (generalist media excluded, like the collector). */
function relayers() {
  return followedAccounts().filter((a) => a.kind === 'bluesky' && a.handle && !a.generalist);
}

/**
 * « Rafraîchir les suggestions »: reads the latest reposts and quotes of a few followed accounts
 * (others at each press) and keeps the authors not followed nor already suggested.
 */
async function refreshSuggestions(known) {
  if (fresh.loading) return;
  const picked = pickRelayers(relayers(), fresh.used, 8);
  if (!picked.length) { toast('Suis des comptes Bluesky pour avoir des suggestions'); return; }
  fresh.loading = true;
  renderDiscover();
  const events = [];
  await pool(picked.map((a) => async () => {
    try {
      for (const author of await recentlyRelayed(bare(a.handle))) events.push({ by: a.name, author });
    } catch { /* offline or account gone: skip it */ }
  }), 4);
  const exclude = new Set([...known, ...followedAccounts().map((a) => bare(a.handle))].filter(Boolean));
  const found = discoveredAccounts(events, { exclude, minBy: 1, max: 30 })
    .filter((a) => !state.accounts.has(a.id) && !isFollowed(a, { strict: true }));
  fresh.loading = false;
  fresh.accounts = found;
  if (state.view === 'discover' && tab === 'suggestions') renderDiscover();
  if (!found.length) toast(events.length ? 'Rien de nouveau cette fois : réessaie pour lire d’autres comptes' : 'Impossible de joindre Bluesky pour le moment');
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

/** Posts and articles already loaded (feeds, live accounts, saved) that match the query. */
function contentSection(q) {
  const loaded = ['actus', 'tech', 'videos'].flatMap((k) => entriesFor(k))
    .flatMap((e) => (e.kind === 'group' ? e.items : [e]))
    .concat(state.saved)
    .filter((i) => !state.hidden.has(i.id));
  const { results, total } = searchItems(loaded, q, { limit: 30 });
  if (!results.length) return '';
  const more = total > results.length ? h('div', { class: 'disc-empty', text: `${total} résultats : affine la recherche pour voir les autres.` }) : null;
  return h('section', { class: 'disc-section' },
    h('h2', { text: `Posts et articles (${total})` }),
    results.map((i) => renderEntry(i)),
    more,
  );
}

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
    // The suggested sources' items are in the data too (not shown): used to sort and describe the accounts.
    const cap = state.data.actus?.scoreCap ?? 6;
    const minScore = state.data.topics?.topicMinScore ?? 1;
    const labelOf = (t) => state.data.topics?.topics?.[t]?.label;
    const loaded = ['actus', 'tech', 'videos'].flatMap((k) => (state.data[k]?.entries || []).flatMap((e) => (e.kind === 'group' ? e.items : [e])));
    const ranked = rankSuggestions(suggestions, loaded, {
      scoreOf: (it) => topicScore(it, state.prefs, cap),
      topicOf: (it) => {
        const sums = new Map();
        for (const k of it.keywords || []) sums.set(k.t, (sums.get(k.t) || 0) + k.w);
        const best = [...sums].sort((a, b) => b[1] - a[1])[0];
        return best && best[1] >= minScore ? best[0] : null;
      },
    });
    const notFollowed = (a) => !isFollowed(a, { strict: true }) && !state.accounts.has(a.id);
    const discovered = (state.data.accounts?.discovered || []).filter(notFollowed);
    const more = (state.data.accounts?.moreDiscovered || []).filter(notFollowed);
    const known = [...state.data.accounts?.discovered || [], ...state.data.accounts?.moreDiscovered || [], ...state.accounts.values()].map((a) => bare(a.handle));
    const freshShown = (fresh.accounts || []).filter(notFollowed);
    const refreshBtn = h('button', {
      class: 'empty-btn ghost disc-refresh', type: 'button', disabled: fresh.loading,
      text: fresh.loading ? 'Recherche de nouveaux comptes…' : '↻ Nouvelles suggestions',
      onclick: () => refreshSuggestions(known),
    });
    const reposted = [...discovered, ...(showMore ? more : [])];
    const moreBtn = more.length ? h('button', {
      class: 'empty-btn ghost disc-more', type: 'button',
      text: showMore ? 'Voir moins' : `Voir plus (${more.length})`,
      onclick: () => { showMore = !showMore; renderDiscover(); },
    }) : null;
    results.replaceChildren(
      h('div', { class: 'disc-actions' }, refreshBtn),
      ...(state.data.accounts ? [] : [emptyBlock('Les suggestions apparaîtront après la prochaine mise à jour automatique.')]),
      ...(fresh.accounts ? [section('Nouvelles suggestions', freshShown.map((a) => accountRow(a)), fresh.loading ? '' : 'Rien de nouveau pour l’instant.')] : []),
      ...(reposted.length || moreBtn ? [h('section', { class: 'disc-section' },
        h('h2', { text: 'Repostés par tes abonnements' }),
        reposted.map((a) => accountRow(a)),
        moreBtn ? h('div', { class: 'disc-actions' }, moreBtn) : null,
      )] : []),
      ...cats.map((c) => section(`Suggestions · ${c}`, ranked.filter((r) => (r.account.category || 'Autres') === c).map((r) => accountRow(r.account, activityNote(r, labelOf))), '')),
      ...(state.data.accounts && !cats.length ? [emptyBlock('Plus aucune suggestion : tu suis déjà tout ce que la collecte connaît.')] : []),
    );
    return;
  }

  const followed = followedAccounts();
  results.replaceChildren(followed.length
    ? section(`Tes abonnements (${followed.length})`, followed.map(accountRow), '')
    : emptyBlock('Tu ne suis personne pour le moment.', goTo('Voir les suggestions', 'suggestions')));
}

/** A few accounts to suggest in the side column (desktop): reposted by the follows first, then the known sources. */
export function sideSuggestions(n = 4) {
  const notFollowed = (a) => !isFollowed(a, { strict: true }) && !state.accounts.has(a.id);
  const accounts = [
    ...(state.data.accounts?.discovered || []).filter(notFollowed),
    ...[...state.accounts.values()].filter((a) => !isFollowed(a)),
  ];
  return accounts.slice(0, n).map((a) => accountRow(a));
}

export function initDiscover() {
  $('#discover-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[role=tab]');
    if (btn) showDiscoverTab(btn.dataset.tab);
  });
  $('#discover-search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = $('#discover-search').value.trim();
    $('#discover-tabs').hidden = q.length >= 2;
    if (q.length < 2) { renderDiscover(); return; }
    searchTimer = setTimeout(async () => {
      const seq = ++searchSeq;
      const results = $('#discover-results');
      const ql = normalize(q);
      const local = [...state.accounts.values()].filter((a) => normalize(`${a.name} ${a.handle}`).includes(ql));
      const content = contentSection(q);
      results.replaceChildren(section('Recherche…', local.map(accountRow), ''), content);
      let remote = [];
      try { remote = await searchAccounts(q); } catch { /* offline */ }
      if (seq !== searchSeq) return;
      remote = remote.filter((r) => !local.some((l) => l.id === r.id));
      results.replaceChildren(
        local.length ? section('Dans tes sources', local.map(accountRow), '') : '',
        content,
        section('Comptes Bluesky', remote.map(accountRow), 'Aucun compte trouvé.'),
      );
    }, 350);
  });
}
