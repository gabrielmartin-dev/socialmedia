// Paid articles: which ones to flag « Payant », and how to set them aside.
// Isomorphic (no DOM, no Node API): the collector flags articles with it, the app reads the flags.
//
// Two sources of truth, no guessing beyond them:
//  - config/sources.json: `paywall: true` (most articles are paid: every card says « Payant »)
//    or `paywall: "partial"` (some are: « Payant » when the feed says so, else « Parfois payant »);
//  - hints written in the feed itself (LWN's « [$] », « Réservé aux abonnés », a category
//    « Abonnés »…), which flag that one article.

// Phrases that only appear when the article itself is behind the paywall.
const TEXT_HINT = /r[ée]serv[ée]e?s? (?:aux|à nos|a nos) abonn|article (?:r[ée]serv[ée]|abonn[ée]s?\b)|abonn[ée]s? (?:uniquement|seulement)|\bsubscribers?[- ]only\b|\bfor (?:paying )?subscribers\b|\[(?:abonn[ée]s?|premium|payant|\$)\]|\((?:abonn[ée]s?|premium|payant)\)/i;
// A feed category that says so (« Abonnés », « Premium », « Contenu payant »…).
const CATEGORY_HINT = /^(?:abonn[ée]s?|premium|payant|contenu (?:abonn[ée]s?|payant|premium)|r[ée]serv[ée] aux abonn[ée]s|subscribers?(?: only)?|paid)$/i;
// LWN (and a few others) prefix the title of subscriber-only articles with « [$] ».
const TITLE_PREFIX = /^\s*\[\$\]\s*/;

/** True when the feed itself says this article is paid. */
export function detectPaywall({ title = '', text = '', categories = [] } = {}) {
  if (TITLE_PREFIX.test(title)) return true;
  if (categories.some((c) => CATEGORY_HINT.test(String(c).trim()))) return true;
  return TEXT_HINT.test(title) || TEXT_HINT.test(String(text).slice(0, 400));
}

/** The title without a « [$] » marker (the card shows « Payant » instead). */
export const cleanPaidTitle = (title) => (typeof title === 'string' ? title.replace(TITLE_PREFIX, '') : title);

/** Paid for sure: flagged by the feed, or from a source whose articles are mostly paid. */
export const isPaid = (item) => !!item && (item.paywall === true || item.source?.paywall === true);

/** Label under a card: « Payant », « Parfois payant » (source partly paid) or null. */
export function paywallLabel(item) {
  if (isPaid(item)) return 'Payant';
  if (item?.source?.paywall === 'partial') return 'Parfois payant';
  return null;
}

/** An entry has paid content: the item itself, or one of the articles of a group. */
export const hasPaid = (entry) => (entry?.kind === 'group' ? entry.items.some(isPaid) : isPaid(entry));

/**
 * Entries without the paid articles (« Masquer les articles payants »). A group keeps its free
 * articles: two or more stay a group, one becomes a plain card. Returns { entries, removed }.
 */
export function withoutPaid(entries) {
  const out = [];
  let removed = 0;
  for (const e of entries) {
    if (e.kind !== 'group') {
      if (isPaid(e)) removed++; else out.push(e);
      continue;
    }
    const items = e.items.filter((i) => !isPaid(i));
    removed += e.items.length - items.length;
    if (items.length === e.items.length) out.push(e);
    else if (items.length > 1) out.push({ ...e, items });
    else if (items.length === 1) out.push(items[0]);
  }
  return { entries: out, removed };
}

/** Hostnames (without www.) of the sources that are mostly paid, from the loaded entries. */
export function paidDomains(entries) {
  const set = new Set();
  const add = (it) => {
    if (it?.source?.paywall !== true || !it.source.url) return;
    try { set.add(new URL(it.source.url).hostname.replace(/^www\./, '')); } catch { /* not a URL */ }
  };
  for (const e of entries || []) {
    if (e.kind === 'group') e.items.forEach(add); else add(e);
  }
  return set;
}

/** True when a link (e.g. the link card of a Bluesky post) points to one of those sites. */
export function isPaidLink(url, domains) {
  if (!url || !domains?.size) return false;
  let host;
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { return false; }
  for (const d of domains) if (host === d || host.endsWith('.' + d)) return true;
  return false;
}

/**
 * The article that leads a group card (and gets saved): a free one before a « parfois payant »
 * one before a paid one; among equals, the one with an image, then the longest summary.
 */
export function groupLead(items) {
  const rankOf = (i) => (paywallLabel(i) === 'Payant' ? 2 : paywallLabel(i) ? 1 : 0);
  return [...items].sort((a, b) => rankOf(a) - rankOf(b)
    || (b.image ? 1 : 0) - (a.image ? 1 : 0)
    || (b.text?.length || 0) - (a.text?.length || 0))[0];
}
