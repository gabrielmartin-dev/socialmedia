// iOS home-screen app: the page's viewport sometimes stops short of the bottom of the screen
// (seen on iOS 26 in Vidéos, where the page itself doesn't scroll): everything anchored to
// the bottom — the tab bar, the reels — then floats above an empty black band. Measure that
// band and push the bottom-anchored elements down into it (--vp-gap, 0 everywhere else).

const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export function measureGap() {
  let gap = 0;
  if (standalone() && /iPhone|iPad/.test(navigator.userAgent)) {
    const portrait = window.innerHeight >= window.innerWidth;
    const screenH = portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
    const g = Math.round(screenH - window.innerHeight);
    if (g > 0 && g <= 120) gap = g; // anything bigger is not this bug (keyboard, split view…)
  }
  document.documentElement.style.setProperty('--vp-gap', `${gap}px`);
}

/** Re-measures now and once the layout has settled (after a view change). */
export function remeasureGap() {
  measureGap();
  requestAnimationFrame(() => requestAnimationFrame(measureGap));
  setTimeout(measureGap, 350);
}

export function initViewport() {
  measureGap();
  window.addEventListener('resize', remeasureGap);
  window.visualViewport?.addEventListener('resize', remeasureGap);
  window.addEventListener('orientationchange', remeasureGap);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) remeasureGap(); });
}
