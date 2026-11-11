// Minimal fetch helpers with timeout and a limited-concurrency pool.

const UA = 'Mozilla/5.0 (compatible; TimelinePerso/1.0; personal news reader)';

const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

/** Delay before retry n (0-based): exponential with jitter, honouring a short Retry-After. */
export function backoffDelay(attempt, backoffMs, retryAfter) {
  const asked = retryAfter == null || retryAfter === '' ? NaN : Number(retryAfter);
  if (Number.isFinite(asked) && asked >= 0) return Math.min(asked * 1000, 5000);
  return backoffMs * 2 ** attempt * (0.75 + Math.random() * 0.5);
}

/**
 * GET a text resource. Network errors, 429 and 5xx are retried with backoff
 * (`retries` extra attempts). Timeouts are not retried by default: a dead host would
 * otherwise cost 3x the timeout. Other 4xx fail immediately.
 */
export async function fetchText(url, { timeoutMs = 15000, headers = {}, retries = 2, backoffMs = 500, retryTimeouts = false, sleep = sleepMs } = {}) {
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let retryAfter = null;
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        redirect: 'follow',
        headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9', ...headers },
      });
      if (!res.ok) {
        retryAfter = res.headers.get('retry-after');
        const err = new Error(`HTTP ${res.status} for ${url}`);
        err.retryable = RETRY_STATUS.has(res.status);
        throw err;
      }
      return { text: await res.text(), url: res.url, contentType: res.headers.get('content-type') || '' };
    } catch (err) {
      const timedOut = err.name === 'AbortError';
      const error = timedOut ? new Error(`Timeout for ${url}`) : err;
      // fetch() rejects with a TypeError on network failures (DNS, reset, TLS…).
      const retryable = err.retryable ?? (timedOut ? retryTimeouts : err instanceof TypeError || /ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket/i.test(String(err.cause?.code || err.message)));
      if (!retryable || attempt >= retries) throw error;
      await sleep(backoffDelay(attempt, backoffMs, retryAfter));
    } finally {
      clearTimeout(timer);
    }
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
