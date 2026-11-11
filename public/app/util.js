// Pure helpers and labels (no DOM access, safe to import anywhere).

/** One label per account kind, used by Découvrir and the profile page. */
export const KIND_LABEL = { media: 'Site', bluesky: 'Bluesky', youtube: 'YouTube', tiktok: 'TikTok' };
/** Label of an item's platform (RSS articles have none). */
export const PLATFORM_LABELS = { bluesky: 'Bluesky', youtube: 'YouTube', tiktok: 'TikTok', rss: '' };

/** Media aspect ratio kept between 0.8 (tall) and 2.2 (wide); `fallback` when unknown. */
export const clampAspect = (aspect, fallback) => Math.min(Math.max(aspect || fallback, 0.8), 2.2);

export function truncateText(s, n) { return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; }

export function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}
