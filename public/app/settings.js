// Paramètres page (⚙ of the top bar) and its « Envoyer un retour » sub-page.
// Everything is stored on the phone (localStorage); only a feedback message is ever sent,
// and only when the person taps « Envoyer ».

import {
  RESET_KEYS, buildBackup, parseBackup, backupSummary, backupFileName,
  FEEDBACK_ENDPOINT, FEEDBACK_KINDS, FEEDBACK_MAX, feedbackPayload, deviceLabel,
} from '../settings.js';
import { $, h, svg, ICONS, toast, playEnter } from './dom.js';
import { state, store, isFeed, FEED_KEYS, saveSettings, savePrefs, setHidePaid } from './store.js';
import { stopAllInline } from './cards.js';
import { deactivateReel } from './reels.js';
import { switchView } from './tabs.js';
import { showDiscoverTab } from './discover.js';
import { viewerPop } from './viewer.js';
import { openInfoSheet, closeInfoSheet } from './infosheet.js';
import { openInstallGuide } from './install.js';

const nav = { pages: [], prev: 'actus', scroll: 0, after: null };
const DRAFT_KEY = 'feedbackDraft';

const THEME_LABELS = { dark: 'Sombre', light: 'Clair', auto: 'Auto' };
const SIZE_LABELS = { small: 'Petit', normal: 'Normal', large: 'Grand', xlarge: 'Très grand' };

// ---------- Display (theme, text size) ----------

const isLight = () => state.settings.theme === 'light'
  || (state.settings.theme === 'auto' && matchMedia('(prefers-color-scheme: light)').matches);

/** Same attributes as boot.js (which applies them before the first paint). */
export function applyDisplay() {
  const root = document.documentElement;
  const { theme, textSize } = state.settings;
  if (theme === 'dark') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', theme);
  if (textSize === 'normal') root.removeAttribute('data-text'); else root.setAttribute('data-text', textSize);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isLight() ? '#ffffff' : '#000000');
}

function setSetting(key, value) {
  state.settings[key] = value;
  saveSettings();
  applyDisplay();
}

/** The feeds are rebuilt when shown again (hidden posts, paid articles, ranking prefs). */
function feedsChanged() {
  FEED_KEYS.forEach((k) => { state.feeds[k].dirty = true; });
  state.reels.built = false;
}

// ---------- Navigation ----------

function show(page) {
  deactivateReel();
  stopAllInline();
  state.view = 'settings';
  document.body.classList.remove('videos-mode');
  document.body.classList.add('profile-mode'); // hides the top bar; the page has its own
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-settings'));
  $('#settings-root').replaceChildren(...(page === 'feedback' ? renderFeedback() : renderMain()));
}

export function openSettings() {
  if (state.view === 'settings') return;
  nav.prev = state.view;
  nav.scroll = window.scrollY;
  if (isFeed(state.view)) state.feeds[state.view].scroll = window.scrollY;
  nav.pages = ['main'];
  history.pushState({ settings: 'main' }, '');
  show('main');
  window.scrollTo({ top: 0 });
  playEnter($('#view-settings'));
}

function openFeedback() {
  nav.pages.push('feedback');
  history.pushState({ settings: 'feedback' }, '');
  show('feedback');
  window.scrollTo({ top: 0 });
  playEnter($('#view-settings'));
}

function close() {
  nav.pages = [];
  document.body.classList.remove('profile-mode');
  state.view = null;
  const after = nav.after;
  nav.after = null;
  if (after) { after(); return; }
  switchView(['profile', 'thread', 'settings'].includes(nav.prev) || !nav.prev ? 'actus' : nav.prev);
  window.scrollTo({ top: nav.scroll || 0 });
}

/** Leaves the settings (dropping their history entries), then runs `fn`. */
function leaveThen(fn) {
  nav.after = fn;
  history.go(-nav.pages.length);
}

function onBack() {
  if (nav.after) { close(); return; } // leaveThen: one popstate for all the pages
  nav.pages.pop();
  if (nav.pages.length) { show(nav.pages[nav.pages.length - 1]); window.scrollTo({ top: 0 }); } else close();
}

// ---------- Building blocks ----------

const bar = (title) => h('div', { class: 'thread-bar' },
  h('button', { class: 'icon-btn', 'aria-label': 'Retour', onclick: () => history.back() }, svg(ICONS.back, 22)),
  h('h1', { class: 'thread-title', text: title }),
);

const section = (title, ...rows) => h('section', { class: 'set-section' },
  h('h2', { class: 'set-heading', text: title }),
  h('div', { class: 'set-group' }, ...rows));

const label = (title, sub) => h('span', { class: 'set-label' }, h('strong', { text: title }), sub ? h('small', { text: sub }) : null);

/** Choice among a few values (theme, text size). */
function segmented(title, labels, value, onChange) {
  const id = `seg-${title.replace(/\W+/g, '-')}`;
  const buttons = Object.entries(labels).map(([v, text]) => h('button', {
    type: 'button', class: 'seg-btn', 'aria-pressed': String(v === value), text,
    onclick: (e) => {
      buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
      onChange(v);
    },
  }));
  return h('div', { class: 'set-row column' },
    h('span', { class: 'set-label', id }, h('strong', { text: title })),
    h('div', { class: 'seg', role: 'group', 'aria-labelledby': id }, buttons));
}

/** On / off switch. */
function toggle(title, sub, on, onChange) {
  const btn = h('button', {
    type: 'button', class: 'set-row', role: 'switch', 'aria-checked': String(on),
    onclick: () => {
      const next = btn.getAttribute('aria-checked') !== 'true';
      btn.setAttribute('aria-checked', String(next));
      onChange(next);
    },
  }, label(title, sub), h('span', { class: 'switch', 'aria-hidden': 'true' }));
  return btn;
}

function action(title, sub, onclick, { danger = false, disabled = false, chevron = false } = {}) {
  return h('button', { type: 'button', class: `set-row${danger ? ' danger' : ''}`, disabled, onclick },
    label(title, sub), chevron ? h('span', { class: 'chevron', 'aria-hidden': 'true', text: '›' }) : null);
}

const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

// ---------- Main page ----------

function prefsSummary() {
  const sources = Object.entries(state.prefs.sources);
  const keywords = Object.entries(state.prefs.keywords);
  if (!sources.length && !keywords.length) return null;
  const less = sources.filter(([, w]) => w < 1).map(([id]) => state.accounts.get(id)?.name || id.replace(/^bsky:/, '@'));
  const parts = [];
  if (less.length) parts.push(`Moins de ${less.slice(0, 3).join(', ')}${less.length > 3 ? ` et ${less.length - 3} autres` : ''}`);
  const others = sources.length - less.length;
  if (others) parts.push(`plus de ${plural(others, 'source', 'sources')}`);
  if (keywords.length) parts.push(plural(keywords.length, 'mot-clé ajusté', 'mots-clés ajustés'));
  return parts.join(' · ');
}

function resetPrefs() {
  const before = structuredClone(state.prefs);
  state.prefs.sources = {};
  state.prefs.keywords = {};
  savePrefs();
  feedsChanged();
  show('main');
  toast('Ton tri est revenu à zéro', { action: { label: 'Annuler', run: () => { state.prefs = before; savePrefs(); feedsChanged(); if (state.view === 'settings') show('main'); toast('Annulé'); } } });
}

function showHidden() {
  const before = [...state.hidden];
  state.hidden.clear();
  savePrefs();
  feedsChanged();
  show('main');
  toast('Les posts masqués sont de retour', { action: { label: 'Annuler', run: () => { before.forEach((id) => state.hidden.add(id)); savePrefs(); feedsChanged(); if (state.view === 'settings') show('main'); toast('Annulé'); } } });
}

function exportData() {
  const backup = buildBackup((key) => store.get(key, undefined));
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { download: backupFileName() });
  a.href = url; // blob: URL (h() only lets http(s) links through)
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast('Sauvegarde téléchargée');
}

function writeAndReload(data, removeOthers) {
  try {
    if (removeOthers) RESET_KEYS.forEach((k) => localStorage.removeItem(k));
    for (const [k, v] of Object.entries(data)) localStorage.setItem(k, JSON.stringify(v));
  } catch {
    toast('Le téléphone a refusé d’enregistrer les données');
    return;
  }
  location.reload();
}

function importData(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const { data, error } = parseBackup(String(reader.result || ''));
    if (error) { toast(error); return; }
    openInfoSheet('Restaurer cette sauvegarde ?',
      h('p', { class: 'info-lead', text: `Elle contient ${backupSummary(data)}. Elle remplacera ce qui est enregistré sur ce téléphone.` }),
      h('button', { class: 'info-action', type: 'button', text: 'Restaurer', onclick: () => { closeInfoSheet(); writeAndReload(data, true); } }));
  };
  reader.onerror = () => toast('Impossible de lire ce fichier');
  reader.readAsText(file);
}

function confirmReset() {
  openInfoSheet('Tout effacer ?',
    h('p', { class: 'info-lead', text: 'Tes abonnements, tes enregistrés, ton tri, les posts masqués et ces réglages seront effacés de ce téléphone. Pense à exporter une sauvegarde avant si tu veux les garder.' }),
    h('button', { class: 'info-action danger', type: 'button', text: 'Tout effacer', onclick: () => { closeInfoSheet(); writeAndReload({}, true); } }));
}

function renderMain() {
  const s = state.settings;
  const prefs = prefsSummary();
  const hidden = state.hidden.size;
  const follows = state.follows.followed.size + Object.keys(state.follows.live).length;
  const file = h('input', { type: 'file', accept: 'application/json,.json', class: 'sr-only', tabindex: '-1', 'aria-hidden': 'true' });
  file.addEventListener('change', () => { importData(file.files?.[0]); file.value = ''; });

  return [
    bar('Paramètres'),
    h('div', { class: 'set-body' },
      section('Affichage',
        segmented('Thème', THEME_LABELS, s.theme, (v) => setSetting('theme', v)),
        segmented('Taille du texte', SIZE_LABELS, s.textSize, (v) => setSetting('textSize', v)),
        h('p', { class: 'set-preview tweet-text', text: 'Aperçu : la grève reconductible s’étend à trois nouveaux sites.' }),
      ),
      section('Fil',
        toggle('Lire les vidéos automatiquement', 'Dans Actus et Tech, sans le son. Sinon, touche une vidéo pour la lancer.', s.autoplay, (on) => setSetting('autoplay', on)),
        toggle('Masquer les articles payants', 'Mediapart, Arrêt sur images… et ceux que le flux signale payants', state.hidePaid, (on) => { setHidePaid(on); feedsChanged(); }),
        action('Remettre le tri à zéro', prefs || 'Rien d’ajusté pour l’instant avec « Plus de ça » ou « Moins de ça »', resetPrefs, { disabled: !prefs }),
        action('Réafficher les posts masqués', hidden ? plural(hidden, 'post masqué', 'posts masqués') : 'Aucun post masqué', showHidden, { disabled: !hidden }),
      ),
      section('Comptes',
        action('Mes abonnements', follows ? plural(follows, 'compte suivi en plus des sources de base', 'comptes suivis en plus des sources de base') : 'Les sources de base, et les comptes que tu suis', () => leaveThen(() => { showDiscoverTab('follows'); switchView('discover'); }), { chevron: true }),
        action('Mes enregistrés', state.saved.length ? plural(state.saved.length, 'article', 'articles') : 'Aucun pour l’instant', () => leaveThen(() => { showDiscoverTab('saved'); switchView('discover'); }), { chevron: true }),
      ),
      section('Tes données',
        h('p', { class: 'set-note', text: 'Tout reste sur ce téléphone : rien n’est envoyé ailleurs, et personne d’autre n’y a accès. Une sauvegarde te permet de tout retrouver sur un autre téléphone.' }),
        action('Exporter une sauvegarde', 'Abonnements, enregistrés, tri et réglages, dans un fichier', exportData),
        action('Restaurer une sauvegarde', 'Depuis un fichier exporté avant', () => file.click()),
        file,
        action('Tout effacer', 'Remet l’app comme au premier jour', confirmReset, { danger: true }),
      ),
      section('Aide',
        action('Envoyer un retour', 'Une idée, un bug, une source à ajouter…', openFeedback, { chevron: true }),
        action('Installer l’app', 'Sur l’écran d’accueil, en plein écran', openInstallGuide),
      ),
    ),
  ];
}

// ---------- Feedback page ----------

function renderFeedback() {
  const draft = store.get(DRAFT_KEY, {}) || {};
  let kind = FEEDBACK_KINDS[draft.kind] ? draft.kind : 'idee';
  const endpoint = FEEDBACK_ENDPOINT();

  const message = h('textarea', { id: 'fb-message', class: 'fb-field', rows: '7', maxlength: String(FEEDBACK_MAX), placeholder: 'Ce qui te plaît, ce qui manque, ce qui ne marche pas…' });
  message.value = typeof draft.message === 'string' ? draft.message : '';
  const contact = h('input', { id: 'fb-contact', class: 'fb-field', type: 'text', autocomplete: 'name', placeholder: 'Ton prénom, ton email ou ton compte Bluesky' });
  contact.value = typeof draft.contact === 'string' ? draft.contact : '';
  const saveDraft = () => store.set(DRAFT_KEY, { kind, message: message.value, contact: contact.value });
  message.addEventListener('input', saveDraft);
  contact.addEventListener('input', saveDraft);

  const chips = Object.entries(FEEDBACK_KINDS).map(([k, text]) => h('button', {
    type: 'button', class: 'chip', 'aria-pressed': String(k === kind), text,
    onclick: (e) => { kind = k; chips.forEach((c) => c.setAttribute('aria-pressed', String(c === e.currentTarget))); saveDraft(); },
  }));
  const status = h('p', { class: 'fb-status', role: 'status' });
  const send = h('button', { type: 'submit', class: 'info-action', text: 'Envoyer', disabled: !endpoint });

  const form = h('form', { class: 'fb-form', novalidate: true },
    h('div', { class: 'fb-kinds', role: 'group', 'aria-label': 'Type de retour' }, chips),
    h('label', { class: 'fb-label', for: 'fb-message', text: 'Ton message' }),
    message,
    h('label', { class: 'fb-label', for: 'fb-contact', text: 'Pour te répondre (facultatif)' }),
    contact,
    h('p', { class: 'set-note', text: 'Seront envoyés : ton message, ce que tu as écrit pour te répondre, le type de téléphone et tes réglages d’affichage. Rien d’autre : ni tes abonnements, ni ce que tu as lu.' }),
    endpoint ? null : h('p', { class: 'fb-status', text: 'L’envoi n’est pas encore activé. Ton message est gardé ici en attendant.' }),
    send,
    status,
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!endpoint || send.disabled) return;
    const { payload, error } = feedbackPayload({
      kind, message: message.value, contact: contact.value, settings: state.settings,
      device: deviceLabel(navigator.userAgent, matchMedia('(display-mode: standalone)').matches || navigator.standalone === true),
    });
    if (error) { status.textContent = error; message.focus(); return; }
    if (navigator.onLine === false) { status.textContent = 'Pas de connexion. Ton message est gardé : réessaie quand tu as du réseau.'; return; }
    send.disabled = true;
    send.textContent = 'Envoi…';
    status.textContent = '';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(String(res.status));
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
      form.replaceWith(h('div', { class: 'fb-done', role: 'status' },
        h('strong', { text: 'Merci !' }),
        h('p', { text: 'Ton message est bien parti. Il sera lu, promis.' }),
        h('button', { class: 'info-action', type: 'button', text: 'Retour aux paramètres', onclick: () => history.back() })));
    } catch {
      send.disabled = false;
      send.textContent = 'Envoyer';
      status.textContent = 'L’envoi n’a pas marché. Ton message est gardé : réessaie dans un moment.';
    }
  });

  return [
    bar('Envoyer un retour'),
    h('div', { class: 'set-body' },
      h('p', { class: 'set-intro', text: 'Une idée, un bug, une source à ajouter, une question ? Écris-le ici : ça arrive directement à la personne qui fait l’app.' }),
      form,
    ),
  ];
}

// ---------- Init ----------

export function initSettings() {
  applyDisplay();
  matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', applyDisplay);
  $('#settings-btn').addEventListener('click', openSettings);
  window.addEventListener('popstate', (e) => {
    if (viewerPop(e)) return;
    if (state.view === 'settings') onBack();
  });
  // Leaving through the tab bar abandons the settings pages.
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => { nav.pages = []; }));
}

