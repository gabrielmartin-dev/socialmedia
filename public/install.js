// "Add to home screen" invitation: which hint fits the browser (pure, testable).

/** iPhone / iPad / iPod running Safari (the only iOS browser that offered « Sur l'écran d'accueil » for years). */
export const isIosSafari = (userAgent = '') => /iPhone|iPad|iPod/.test(userAgent) && /Safari/.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent);

/**
 * 'prompt' = the browser gave us an install prompt (Android Chrome…): one tap installs.
 * 'ios'    = Safari on iOS: the user has to use the share sheet, we only explain how.
 * null     = nothing to offer (already installed, or no way to install).
 */
export function installHint({ userAgent = '', standalone = false, hasPrompt = false } = {}) {
  if (standalone) return null;
  if (hasPrompt) return 'prompt';
  if (isIosSafari(userAgent)) return 'ios';
  return null;
}
