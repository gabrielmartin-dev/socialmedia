// Minimal fetch helpers with timeout and a limited-concurrency pool.

const UA = 'Mozilla/5.0 (compatible; TimelinePerso/1.0; personal news reader)';

export async function fetchText(url, { timeoutMs = 15000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9', ...headers },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return { text: await res.text(), url: res.url, contentType: res.headers.get('content-type') || '' };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Timeout for ${url}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson(url, opts = {}) {
  const { text } = await fetchText(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}) } });
  return JSON.parse(text);
}

export { pool } from '../../public/pool.js';

export function faviconFor(siteUrl) {
  try {
    const host = new URL(siteUrl).hostname;
    return `https://www.google.com/s2/favicons?domain=${host}&sz=128`;
  } catch { return null; }
}
