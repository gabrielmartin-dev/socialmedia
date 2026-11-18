// Settings page: display options and the backup of everything stored on the phone.
// Pure functions (tested in Node); the page itself is app/settings.js. Nothing here is ever
// sent anywhere: the settings, like the follows and bookmarks, live in localStorage.

export const SETTINGS_KEY = 'settings';

export const THEMES = ['dark', 'light', 'auto'];
// Text size of the posts: multiplier of the reading sizes (see --fs in styles.css).
export const TEXT_SIZES = { small: 0.9, normal: 1, large: 1.12, xlarge: 1.25 };

export function defaultSettings() {
  return { theme: 'dark', textSize: 'normal', autoplay: true };
}

/** Keeps only known values: a corrupted or hand-edited storage falls back to the defaults. */
export function sanitizeSettings(raw) {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object') return d;
  return {
    theme: THEMES.includes(raw.theme) ? raw.theme : d.theme,
    textSize: Object.hasOwn(TEXT_SIZES, raw.textSize) ? raw.textSize : d.textSize,
    autoplay: typeof raw.autoplay === 'boolean' ? raw.autoplay : d.autoplay,
  };
}

// ---------- Backup (export / import) ----------
// Only the keys of this app: GitHub Pages serves every project of an account from the same
// origin, so localStorage may hold other sites' keys. Each key has the shape it must have.
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
export const BACKUP_KEYS = {
  follows: isObj,
  prefs: isObj,
  hidden: Array.isArray,
  hidePaid: (v) => typeof v === 'boolean',
  saved: Array.isArray,
  opened: isObj,
  settings: isObj,
};
// Erased by « Tout effacer » on top of the backup keys (history of what was seen, last visit).
// The install pop-up key is kept: it must not come back.
export const RESET_KEYS = [...Object.keys(BACKUP_KEYS), 'seen2', 'lastVisit', 'lastGenerated', 'feedbackDraft', 'reelsMuted'];

export const BACKUP_APP = 'timeline-perso';

/** Backup object built from a `get(key)` reader returning parsed values (or undefined). */
export function buildBackup(get, now = new Date()) {
  const data = {};
  for (const key of Object.keys(BACKUP_KEYS)) {
    const v = get(key);
    if (v !== undefined && v !== null && BACKUP_KEYS[key](v)) data[key] = v;
  }
  return { app: BACKUP_APP, version: 1, exportedAt: now.toISOString(), data };
}

/**
 * Reads a backup file's text. Returns { data } with only the valid keys, or { error } (a
 * sentence for the user) when the file is not a backup of this app.
 */
export function parseBackup(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { return { error: 'Ce fichier n’est pas une sauvegarde de l’app.' }; }
  if (!isObj(obj) || obj.app !== BACKUP_APP || !isObj(obj.data)) return { error: 'Ce fichier n’est pas une sauvegarde de l’app.' };
  if (typeof obj.version !== 'number' || obj.version > 1) return { error: 'Cette sauvegarde vient d’une version plus récente de l’app.' };
  const data = {};
  for (const [key, ok] of Object.entries(BACKUP_KEYS)) {
    if (key in obj.data && ok(obj.data[key])) data[key] = obj.data[key];
  }
  if (!Object.keys(data).length) return { error: 'Cette sauvegarde est vide.' };
  return { data };
}

/** Short summary of a backup, e.g. « 12 abonnements, 4 enregistrés ». */
export function backupSummary(data) {
  const n = (count, one, many) => (count ? `${count} ${count > 1 ? many : one}` : null);
  const follows = (data.follows?.followed?.length || 0) + Object.keys(data.follows?.live || {}).length;
  return [
    n(follows, 'abonnement', 'abonnements'),
    n(data.saved?.length || 0, 'enregistré', 'enregistrés'),
    n(data.hidden?.length || 0, 'post masqué', 'posts masqués'),
  ].filter(Boolean).join(', ') || 'tes réglages';
}

export const backupFileName = (now = new Date()) => `timeline-sauvegarde-${now.toISOString().slice(0, 10)}.json`;

// ---------- Feedback (« Envoyer un retour ») ----------
// Sent to a Formspree form, which forwards it by email; nothing else leaves the phone.
// The form id is public (it only accepts submissions). Empty = the page says it is not ready yet.
export const FEEDBACK_FORM_ID = 'myewwnkl';
export const FEEDBACK_ENDPOINT = (id = FEEDBACK_FORM_ID) => (id ? `https://formspree.io/f/${id}` : '');

const THEME_FR = { dark: 'sombre', light: 'clair', auto: 'auto' };
const SIZE_FR = { small: 'petit', normal: 'normal', large: 'grand', xlarge: 'très grand' };

export const FEEDBACK_KINDS = { idee: 'Une idée', probleme: 'Un problème', autre: 'Autre chose' };
export const FEEDBACK_MAX = 4000;

/** Short description of the phone and browser, e.g. « iPhone · Safari · app installée ». */
export function deviceLabel(userAgent = '', standalone = false) {
  const os = /iPhone/.test(userAgent) ? 'iPhone' : /iPad/.test(userAgent) ? 'iPad' : /Android/.test(userAgent) ? 'Android'
    : /Macintosh/.test(userAgent) ? 'Mac' : /Windows/.test(userAgent) ? 'Windows' : /Linux/.test(userAgent) ? 'Linux' : 'Autre';
  const browser = /CriOS|Chrome\//.test(userAgent) && !/Edg/.test(userAgent) ? (/SamsungBrowser/.test(userAgent) ? 'Samsung Internet' : 'Chrome')
    : /Edg/.test(userAgent) ? 'Edge' : /FxiOS|Firefox/.test(userAgent) ? 'Firefox' : /Safari/.test(userAgent) ? 'Safari' : 'autre navigateur';
  return `${os} · ${browser}${standalone ? ' · app installée' : ''}`;
}

/**
 * Fields sent to the form, or { error } when the message can't be sent. `contact` is optional
 * (a name, an email, a Bluesky handle…): only what the person chose to write.
 */
export function feedbackPayload({ kind, message, contact = '', device = '', settings = {} } = {}) {
  const text = String(message || '').trim();
  if (text.length < 3) return { error: 'Écris quelques mots avant d’envoyer.' };
  if (text.length > FEEDBACK_MAX) return { error: `Ton message est trop long (${FEEDBACK_MAX} caractères au plus).` };
  const type = FEEDBACK_KINDS[kind] || FEEDBACK_KINDS.autre;
  const from = String(contact || '').trim().slice(0, 200);
  return {
    payload: {
      _subject: `Retour Timeline : ${type.toLowerCase()}`,
      type,
      message: text,
      contact: from || '(anonyme)',
      appareil: device,
      reglages: `thème ${THEME_FR[settings.theme] || '?'}, texte ${SIZE_FR[settings.textSize] || '?'}, lecture auto ${settings.autoplay === false ? 'non' : 'oui'}`,
      // Formspree uses `email` as the reply-to address when it looks like one.
      ...(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from) ? { email: from } : {}),
    },
  };
}
