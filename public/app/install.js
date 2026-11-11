// Invitation to install the app: a discreet banner, shown once, that can be closed.
// Android / Chrome: `beforeinstallprompt`. iOS Safari: instructions (no API exists there).

import { $, h, toast } from './dom.js';
import { store } from './store.js';
import { installHint } from '../install.js';
import { openInfoSheet } from './infosheet.js';

const KEY = 'installHint'; // set as soon as the banner is shown: it never comes back
const SHOW_AFTER_MS = 4000;

let deferred = null; // the browser's install prompt

const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function iosSteps() {
  openInfoSheet('Ajouter à l’écran d’accueil',
    h('ol', { class: 'info-steps' },
      h('li', { text: 'Touche le bouton Partager (le carré avec une flèche) en bas de Safari.' }),
      h('li', { text: 'Fais défiler et choisis « Sur l’écran d’accueil ».' }),
      h('li', { text: 'Valide avec « Ajouter » : l’app s’ouvre ensuite en plein écran.' })),
    h('p', { class: 'info-note', text: 'Installée, l’app garde aussi tes abonnements et tes enregistrés plus sûrement que dans un onglet Safari.' }));
}

function showBanner(hint) {
  const banner = $('#install-banner');
  const close = () => { banner.hidden = true; };
  banner.replaceChildren(
    h('div', { class: 'install-text' },
      h('strong', { text: 'Ajouter à l’écran d’accueil' }),
      h('span', { text: hint === 'ios' ? 'Pour l’ouvrir en plein écran, comme une app.' : 'Pour l’ouvrir en plein écran, comme une app, même hors ligne.' })),
    h('button', {
      class: 'install-go', type: 'button', text: hint === 'ios' ? 'Comment ?' : 'Installer',
      onclick: async () => {
        if (hint === 'ios') { iosSteps(); close(); return; }
        close();
        if (!deferred) return;
        deferred.prompt();
        const { outcome } = await deferred.userChoice.catch(() => ({}));
        deferred = null;
        if (outcome === 'accepted') toast('App installée');
      },
    }),
    h('button', { class: 'install-close', type: 'button', 'aria-label': 'Fermer', text: '✕', onclick: close }),
  );
  banner.hidden = false;
  store.set(KEY, 'shown');
}

export function initInstall() {
  if (location.protocol === 'file:' || store.get(KEY, null)) return;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; });
  window.addEventListener('appinstalled', () => { $('#install-banner').hidden = true; store.set(KEY, 'shown'); });
  setTimeout(() => {
    if (store.get(KEY, null)) return;
    const hint = installHint({ userAgent: navigator.userAgent, standalone: isStandalone(), hasPrompt: !!deferred });
    if (hint) showBanner(hint);
  }, SHOW_AFTER_MS);
}
