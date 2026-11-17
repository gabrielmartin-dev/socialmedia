// First-visit pop-up explaining how to install the app on the home screen (web app mode).
// Shown once, closable, never in standalone mode.
// Android / Chrome: native `beforeinstallprompt` when the browser offers it, else menu steps.
// iOS: steps through the share menu (no install API exists there).

import { h, toast } from './dom.js';
import { store } from './store.js';
import { installHint } from '../install.js';
import { openInfoSheet, closeInfoSheet } from './infosheet.js';

const KEY = 'installGuide'; // set as soon as the pop-up is shown: it never comes back
const SHOW_AFTER_MS = 1500; // let the feed appear first, and Chrome send its install prompt

let deferred = null; // the browser's install prompt

const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

const steps = (...items) => h('ol', { class: 'info-steps' }, ...items.map((text) => h('li', { text })));

const STEPS = {
  ios: () => steps(
    'Touche le bouton Partager (le carré avec une flèche vers le haut) en bas de Safari. S’il n’apparaît pas, touche d’abord « ⋯ ».',
    'Fais défiler et choisis « Sur l’écran d’accueil ».',
    'Valide avec « Ajouter », puis ouvre l’app depuis sa nouvelle icône.'),
  'ios-other': () => steps(
    'Touche le bouton Partager (le carré avec une flèche vers le haut), dans la barre d’adresse ou dans le menu.',
    'Choisis « Sur l’écran d’accueil », puis « Ajouter ».',
    'Tu ne le trouves pas ? Ouvre ce site dans Safari et fais pareil.'),
  android: () => steps(
    'Ouvre le menu du navigateur (les trois points ⋮ en haut à droite, ou ☰ en bas sur Samsung Internet).',
    'Choisis « Installer l’application » ou « Ajouter à l’écran d’accueil ».',
    'Valide, puis ouvre l’app depuis sa nouvelle icône.'),
};

async function promptInstall() {
  closeInfoSheet();
  if (!deferred) return;
  const p = deferred;
  deferred = null;
  p.prompt();
  const { outcome } = await p.userChoice.catch(() => ({}));
  if (outcome === 'accepted') toast('App installée');
}

function showGuide(hint, { once = true } = {}) {
  store.set(KEY, 'shown');
  openInfoSheet('Installe l’app sur ton écran d’accueil',
    h('p', { class: 'info-lead', text: 'Elle s’ouvrira en plein écran, comme une vraie app, et gardera mieux tes abonnements et tes articles enregistrés qu’un onglet du navigateur.' }),
    hint === 'prompt'
      ? h('button', { class: 'info-action', type: 'button', text: 'Installer l’app', onclick: promptInstall })
      : STEPS[hint](),
    once ? h('p', { class: 'info-note', text: 'Ce message ne s’affiche qu’une fois (tu le retrouves dans les Paramètres).' }) : null);
}

/** « Installer l’app » of the settings page: the same guide, on demand. */
export function openInstallGuide() {
  if (isStandalone()) { toast('L’app est déjà installée sur ton écran d’accueil'); return; }
  const hint = installHint({
    userAgent: navigator.userAgent, standalone: false, hasPrompt: !!deferred,
    maxTouchPoints: navigator.maxTouchPoints || 0,
  });
  if (!hint) { toast('Ouvre ce site sur ton téléphone pour l’installer'); return; }
  showGuide(hint, { once: false });
}

export function initInstall() {
  if (location.protocol === 'file:' || isStandalone()) return;
  // Kept even after the pop-up was shown: the settings page offers the same install button.
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; });
  window.addEventListener('appinstalled', () => { store.set(KEY, 'shown'); closeInfoSheet(); });
  if (store.get(KEY, null)) return;
  setTimeout(() => {
    if (store.get(KEY, null) || !document.getElementById('info-sheet').hidden) return;
    const hint = installHint({
      userAgent: navigator.userAgent, standalone: isStandalone(), hasPrompt: !!deferred,
      maxTouchPoints: navigator.maxTouchPoints || 0,
    });
    if (hint) showGuide(hint);
  }, SHOW_AFTER_MS);
}
