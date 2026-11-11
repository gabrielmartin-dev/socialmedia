// Small bottom sheet showing information (list of unavailable sources, install hint…).

import { $ } from './dom.js';
import { trapFocus } from './focus.js';

let release = null;

export function closeInfoSheet() {
  if ($('#info-sheet').hidden) return;
  const r = release;
  release = null;
  $('#info-sheet').hidden = true;
  $('#sheet-backdrop').hidden = true;
  r?.();
}

/** Opens the sheet with a title and DOM nodes as body. */
export function openInfoSheet(title, ...nodes) {
  $('#info-title').textContent = title;
  $('#info-body').replaceChildren(...nodes.flat().filter(Boolean));
  $('#info-sheet').hidden = false;
  $('#sheet-backdrop').hidden = false;
  release?.();
  release = trapFocus($('#info-sheet'), { onClose: closeInfoSheet, keep: [$('#sheet-backdrop'), $('#toast')] });
}

export function initInfoSheet() {
  $('#info-close').addEventListener('click', closeInfoSheet);
  $('#sheet-backdrop').addEventListener('click', closeInfoSheet);
}
