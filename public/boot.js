// Applies the display settings (theme, text size) before the page is painted, so that the
// light theme never flashes dark first. Classic script loaded in <head>; the CSP forbids
// inline scripts. The settings page (app/settings.js) changes the same attributes live.
(function () {
  if (typeof document === 'undefined') return; // imported by the tests (Node)
  var s = {};
  try { s = JSON.parse(localStorage.getItem('settings')) || {}; } catch (e) { /* private mode */ }
  var root = document.documentElement;
  if (s.theme === 'light' || s.theme === 'auto') root.setAttribute('data-theme', s.theme);
  if (s.textSize && s.textSize !== 'normal') root.setAttribute('data-text', s.textSize);
}());
