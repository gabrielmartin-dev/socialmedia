// URL validation shared by the collector and the browser (no Node API here).
// Only http(s) links are ever allowed into href / src / window.open.

/** Returns the normalised absolute http(s) URL, or null (javascript:, data:, garbage…). */
export function safeUrl(value, base) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s) return null;
  try {
    const u = base === undefined ? new URL(s) : new URL(s, base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

// Tracking parameters that never change the page itself.
const TRACKING = /^(utm_\w+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|xtor|at_\w+|ref|ref_src|cmp|ncid|sr_share|igshid|_ga)$/i;

/**
 * A comparison key for « same page »: https, no `www.`, no fragment, no tracking parameter,
 * no trailing slash, remaining parameters sorted. Null when the URL is not http(s).
 * Only used to detect duplicates: the original URL is what the app links to.
 */
export function canonicalUrl(value) {
  const href = safeUrl(value);
  if (!href) return null;
  const u = new URL(href);
  const params = [...u.searchParams].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const qs = params.length ? '?' + new URLSearchParams(params).toString() : '';
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const path = u.pathname.replace(/\/+$/, '') || '';
  return `https://${host}${u.port ? ':' + u.port : ''}${path}${qs}`;
}

/** Host without `www.`, or '' when the URL is unusable. */
export function hostOf(value) {
  const href = safeUrl(value);
  return href ? new URL(href).hostname.toLowerCase().replace(/^www\./, '') : '';
}

// Link shorteners: their URL says nothing about the page (the card would read « t.co »).
const SHORTENERS = /^(?:t\.co|bit\.ly|buff\.ly|ow\.ly|dlvr\.it|tinyurl\.com|lnkd\.in|is\.gd|goo\.gl|tiny\.cc|shorturl\.at|rebrand\.ly|trib\.al|fb\.me|aje\.io|bbc\.in|nyti\.ms|wapo\.st|reut\.rs|apne\.ws|ift\.tt|s\.id|cutt\.ly)$/i;

/** True for a link through a known shortener (t.co, bit.ly…). */
export const isShortener = (value) => SHORTENERS.test(hostOf(value));

/** The URL without its tracking parameters (utm_*, at_*, xtor…); host and path untouched. */
export function stripTracking(value) {
  const href = safeUrl(value);
  if (!href) return null;
  const u = new URL(href);
  const keys = [...u.searchParams.keys()];
  if (!keys.some((k) => TRACKING.test(k))) return href;
  for (const k of new Set(keys)) if (TRACKING.test(k)) u.searchParams.delete(k);
  return u.href;
}

/**
 * A readable title from a URL's last path segment, when a link card has none:
 * « …/cela-devient-irrespirable-entre-medias-22-11-2026-OP7JQUX.php » → « Cela devient
 * irrespirable entre medias ». Empty when the slug has no words (ids, short links).
 */
export function titleFromUrl(value) {
  const href = safeUrl(value);
  if (!href || isShortener(href)) return '';
  let seg = new URL(href).pathname.split('/').filter(Boolean).pop() || '';
  try { seg = decodeURIComponent(seg); } catch { /* keep as is */ }
  const words = seg.replace(/\.(?:s?html?|php|aspx?|jsp)$/i, '').split(/[-_+\s]+/)
    .filter((w) => w && !/\d/.test(w) && !(w.length >= 8 && w === w.toUpperCase()));
  if (words.length < 3) return '';
  const s = words.join(' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
