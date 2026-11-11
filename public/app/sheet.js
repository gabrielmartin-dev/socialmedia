// Bottom sheet of a card (⋯): save, more / less of this, hide, follow, open the original.
// Every action that changes something offers « Annuler » in the toast.

import { lessSource, lessKeywords, applyMore, topicsOf, keywordsOf } from '../rank.js';
import { leadItem } from '../saved.js';
import { exactTime } from '../freshness.js';
import { safeUrl } from '../url.js';
import { $, toast } from './dom.js';
import { state, isFollowed, FEED_KEYS, savePrefs, accountFromSource, isSavedItem, setSaved, markOpened } from './store.js';
import { trapFocus } from './focus.js';
import { setFollow } from './follow.js';
import { takeOff, entriesOfSource } from './remove.js';
import { actions } from './actions.js';

let sheetEntry = null;
let releaseFocus = null;

const topicLabel = (id) => state.data.topics?.topics?.[id]?.label || id;

/** Preferences changed: the other screens are re-ranked when shown; the one on screen is left alone. */
function prefsChanged() {
  savePrefs();
  FEED_KEYS.forEach((k) => { if (k !== state.view) state.feeds[k].dirty = true; });
  if (state.view !== 'videos') state.reels.built = false;
}

/** Applies a preference change and offers to revert it. `change()` returns the undo function. */
function withUndo(message, change) {
  const undo = change();
  prefsChanged();
  toast(message, { action: { label: 'Annuler', run: () => { undo(); prefsChanged(); toast('Annulé'); } } });
}

export function openSheet(entry) {
  sheetEntry = entry;
  const isGroup = entry.kind === 'group';
  const name = isGroup ? '' : entry.source.name;
  const topics = topicsOf(entry).map(topicLabel);
  const kws = keywordsOf(entry);

  const saved = isSavedItem(leadItem(entry).id);
  $('#sheet-save').querySelector('strong').textContent = saved ? 'Retirer des enregistrés' : 'Enregistrer';
  $('#sheet-save-sub').textContent = saved ? '' : isGroup ? 'L’article principal, pour le lire plus tard' : 'Pour le lire plus tard';

  $('#sheet-more-sub').textContent = [isGroup ? null : name, ...topics].filter(Boolean).join(' · ') || 'Ce type de contenu';

  const lessSrc = $('#sheet-less-source');
  lessSrc.hidden = isGroup; // a group has no single source
  $('#sheet-less-source-title').textContent = `Moins de ${name}`;
  const lessTopic = $('#sheet-less-topic');
  lessTopic.hidden = !kws.length;
  $('#sheet-less-topic-title').textContent = `Moins de ${topics.length ? topics.join(' et ') : 'ce sujet'}`;
  $('#sheet-less-topic-sub').textContent = kws.length ? `Mots-clés : ${kws.slice(0, 5).map((k) => k.k).join(', ')}` : '';

  const followBtn = $('#sheet-follow');
  followBtn.hidden = isGroup;
  if (!isGroup) {
    const following = isFollowed(entry.source);
    followBtn.querySelector('strong').textContent = following ? `Ne plus suivre ${name}` : `Suivre ${name}`;
  }
  const link = $('#sheet-open');
  const openHref = isGroup ? null : safeUrl(entry.url, location.href);
  link.hidden = !openHref;
  if (openHref) link.href = openHref; else link.removeAttribute('href');

  // Exact date and time (the cards only show a relative time).
  const date = isGroup ? entry.items.map((i) => i.publishedAt).sort().pop() : entry.publishedAt;
  $('#sheet-time').textContent = date ? `${isGroup ? 'Dernier article' : 'Publié'} le ${exactTime(date)}` : '';

  $('#sheet').hidden = false;
  $('#sheet-backdrop').hidden = false;
  releaseFocus?.();
  // Focus goes into the sheet, Tab stays inside, Escape closes, focus returns to the ⋯ button.
  releaseFocus = trapFocus($('#sheet'), { onClose: closeSheet, keep: [$('#sheet-backdrop'), $('#toast')] });
}

export function closeSheet() {
  const release = releaseFocus;
  releaseFocus = null;
  $('#sheet').hidden = true;
  $('#sheet-backdrop').hidden = true;
  sheetEntry = null;
  release?.(); // after hiding: restoring focus on the opener must not be blocked by inert
}

/** Runs `fn(entry)` after closing the sheet. */
const onEntry = (fn) => () => {
  const entry = sheetEntry;
  closeSheet();
  if (entry) fn(entry);
};

export function initSheet() {
  $('#sheet-backdrop').addEventListener('click', closeSheet);
  $('#sheet-cancel').addEventListener('click', closeSheet);
  $('#sheet-open').addEventListener('click', () => {
    if (sheetEntry?.kind === 'article') markOpened(sheetEntry.id);
    closeSheet();
  });

  $('#sheet-save').addEventListener('click', onEntry((entry) => {
    const item = leadItem(entry);
    const was = isSavedItem(item.id);
    if (!setSaved(item, !was)) { toast('Stockage du téléphone plein : impossible d’enregistrer'); return; }
    // In the saved list, un-saving takes the card off the screen.
    const restore = was && state.view === 'discover' ? takeOff([entry]) : null;
    toast(was ? 'Retiré des enregistrés' : 'Enregistré', {
      action: { label: 'Annuler', run: () => { setSaved(item, was); restore?.(); actions.afterSavedChange(); toast('Annulé'); } },
    });
    actions.afterSavedChange();
  }));

  $('#sheet-more').addEventListener('click', onEntry((entry) => {
    withUndo('Tu verras plus de ça au prochain rafraîchissement', () => applyMore(state.prefs, entry));
  }));

  $('#sheet-less-source').addEventListener('click', onEntry((entry) => {
    withUndo(`Tu verras moins de ${entry.source.name} au prochain rafraîchissement`, () => lessSource(state.prefs, entry.source.id));
  }));

  $('#sheet-less-topic').addEventListener('click', onEntry((entry) => {
    const topics = topicsOf(entry).map(topicLabel);
    withUndo(`Tu verras moins de ${topics.join(' et ') || 'ce sujet'} au prochain rafraîchissement`, () => lessKeywords(state.prefs, entry));
  }));

  $('#sheet-hide').addEventListener('click', onEntry((entry) => {
    state.hidden.add(entry.id);
    savePrefs();
    const restore = takeOff([entry]);
    toast('Post masqué', {
      action: { label: 'Annuler', run: () => { state.hidden.delete(entry.id); savePrefs(); restore(); toast('Post rétabli'); } },
    });
  }));

  $('#sheet-follow').addEventListener('click', onEntry((entry) => {
    if (!entry.source) return;
    const following = isFollowed(entry.source);
    const account = accountFromSource(entry.source);
    // Unfollowing takes that account's cards off the screen, and « Annuler » puts them back.
    const restore = following ? takeOff(entriesOfSource(entry.source.id)) : null;
    setFollow(account, !following, { onUndo: restore });
  }));
}
