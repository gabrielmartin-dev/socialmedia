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
