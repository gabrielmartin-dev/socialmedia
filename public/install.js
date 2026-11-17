// "Add to home screen" invitation: which guide fits the browser (pure, testable).

const IOS_OTHER = /CriOS|FxiOS|EdgiOS|OPiOS/;

/** iPhone / iPad / iPod, including iPadOS which presents itself as a Mac (but with a touch screen). */
export const isIos = (userAgent = '', maxTouchPoints = 0) =>
  /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);

/** Safari on iOS (the browser where « Sur l'écran d'accueil » has always been). */
export const isIosSafari = (userAgent = '', maxTouchPoints = 0) =>
  isIos(userAgent, maxTouchPoints) && /Safari/.test(userAgent) && !IOS_OTHER.test(userAgent);

/**
 * 'prompt'    = the browser gave us an install prompt (Android Chrome, desktop Chrome/Edge): one tap installs.
 * 'ios'       = Safari on iOS: Partager > Sur l'écran d'accueil.
 * 'ios-other' = Chrome / Firefox / Edge on iOS: same share menu (iOS 16.4+), or open the site in Safari.
 * 'android'   = Android browser without (or not yet) an install prompt: browser menu > Installer / Ajouter.
 * null        = nothing to offer (already installed, or a computer without install support).
 */
export function installHint({ userAgent = '', standalone = false, hasPrompt = false, maxTouchPoints = 0 } = {}) {
  if (standalone) return null;
  if (hasPrompt) return 'prompt';
  if (isIos(userAgent, maxTouchPoints)) return IOS_OTHER.test(userAgent) ? 'ios-other' : 'ios';
  if (/Android/.test(userAgent)) return 'android';
  return null;
}
