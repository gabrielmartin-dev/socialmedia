// Accounts the followed accounts repost or quote: « reposté par 4 comptes que tu suis ».
// Shared by the collector (scripts/collect.mjs) and the browser (« Rafraîchir » in Découvrir).

import { safeUrl } from './url.js';

/**
 * `events`: [{ by, author: { handle, displayName?, avatar? } }] (`by` = name of the configured
 * account that reposted or quoted). Keeps the authors relayed by at least `minBy` distinct
 * accounts, except `exclude` (handles already in the config, lowercase) and the relayers
 * themselves, most relayed first, at most `max`.
 */
export function discoveredAccounts(events, { exclude = new Set(), minBy = 2, max = 12 } = {}) {
  const byHandle = new Map();
  for (const { by, author } of events) {
    const handle = String(author?.handle || '').toLowerCase();
    if (!handle || handle === 'handle.invalid' || exclude.has(handle)) continue;
    let e = byHandle.get(handle);
    if (!e) { e = { handle, name: author.displayName || author.name || handle, avatar: author.avatar || null, by: new Set() }; byHandle.set(handle, e); }
    if (author.avatar && !e.avatar) e.avatar = author.avatar;
    e.by.add(by);
  }
  return [...byHandle.values()]
    .filter((e) => e.by.size >= minBy)
    .sort((a, b) => b.by.size - a.by.size || a.name.localeCompare(b.name, 'fr'))
    .slice(0, max)
    .map((e) => ({
      id: 'bsky:' + e.handle,
      name: e.name,
      handle: '@' + e.handle,
      avatar: safeUrl(e.avatar),
      description: '',
      url: safeUrl(`https://bsky.app/profile/${e.handle}`),
      kind: 'bluesky',
      feed: 'actus',
      category: 'Recherche',
      by: [...e.by],
    }))
    .filter((a) => a.url);
}
