// Keyboard accessibility helpers: activation keys for custom buttons and a focus trap
// for modal dialogs (options sheet, image viewer).

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** Enter and Space activate a button. */
export const isActivationKey = (key) => key === 'Enter' || key === ' ';

/** Next index when Tab cycles through `count` focusable elements (-1 = focus is outside). */
export function nextFocusIndex(count, current, backwards) {
  if (count <= 0) return -1;
  if (current < 0) return backwards ? count - 1 : 0;
  return (current + (backwards ? -1 : 1) + count) % count;
}

/** Makes a non-button element behave like a button for keyboard and assistive technology users. */
export function makeButton(el, handler) {
  el.setAttribute('role', 'button');
  el.tabIndex = 0;
  el.addEventListener('click', handler);
  el.addEventListener('keydown', (e) => {
    if (e.target !== el || !isActivationKey(e.key)) return;
    e.preventDefault();
    handler(e);
  });
}

const visible = (el) => !el.hidden && el.getClientRects().length > 0;

/**
 * Traps focus inside `container` (a modal dialog): moves focus into it, loops Tab / Shift+Tab,
 * closes on Escape, makes the rest of the page inert, and on release puts the focus back on
 * the element that opened it. `keep` are elements that must stay interactive (backdrop, toast).
 * Returns `release()`.
 */
export function trapFocus(container, { onClose, keep = [] } = {}) {
  const opener = document.activeElement;
  const kept = new Set([container, ...keep]);
  const inerted = [...document.body.children].filter((el) => !kept.has(el) && !el.inert && !/^(SCRIPT|STYLE)$/.test(el.tagName));
  inerted.forEach((el) => { el.inert = true; });

  const focusables = () => [...container.querySelectorAll(FOCUSABLE)].filter(visible);
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose?.(); return; }
    if (e.key !== 'Tab') return;
    const list = focusables();
    if (!list.length) { e.preventDefault(); container.focus(); return; }
    const i = nextFocusIndex(list.length, list.indexOf(document.activeElement), e.shiftKey);
    // Only take over at the edges (or when focus escaped): normal Tab order otherwise.
    const atEdge = list.indexOf(document.activeElement) < 0 || (e.shiftKey ? i === list.length - 1 : i === 0);
    if (atEdge) { e.preventDefault(); list[i].focus(); }
  };
  document.addEventListener('keydown', onKey, true);

  if (!container.hasAttribute('tabindex')) container.tabIndex = -1;
  (focusables()[0] || container).focus({ preventScroll: true });

  let released = false;
  return function release() {
    if (released) return;
    released = true;
    document.removeEventListener('keydown', onKey, true);
    inerted.forEach((el) => { el.inert = false; });
    if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
  };
}
