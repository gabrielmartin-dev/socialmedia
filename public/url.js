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
