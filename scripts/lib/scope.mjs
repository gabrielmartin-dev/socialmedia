// Out-of-scope filter for generalist sources (franceinfo, Le Monde, AFP…).
// The app covers left-wing politics, social struggles and tech: a generalist feed also
// carries sport, health tips, crime news, culture, weather… Its items are kept only when
// they are clearly on topic. Partisan and activist sources are never filtered.
//
// Signals, all deterministic (no LLM):
//   - the section of the article URL (francetvinfo.fr/sante/…, lemonde.fr/sport/…, or
//     liberation.fr/politique/… on the other side),
//   - the categories of the feed entry,
//   - off-topic keywords in the title, summary or link card,
//   - the topic score (sum of the weights of the matched Politique/Social keywords).
// An item filed under a political section of its site (`onTopic`) is kept. Otherwise it is
// dropped when it has an off-topic signal and a topic score below `keepScore`,
// or when its topic score is below `minScore` (nothing says it is political or social).

import { normalize, escapeRegex } from '../../public/norm.js';
import { matchKeywords, matchText, compileTopics } from '../../public/topics.js';

const wordRe = (raw) => {
  const prefix = raw.endsWith('*');
  const kw = normalize(prefix ? raw.slice(0, -1) : raw);
  const body = escapeRegex(kw).replace(/\s+/g, '[\\s-]+');
  return new RegExp(`(?<![a-z0-9])${body}${prefix ? '[a-z0-9]*' : ''}(?![a-z0-9])`, 'i');
};

/** Compiles the `scope` block of config/topics.json. */
export function compileScope(cfg = {}) {
  const off = cfg.offTopic || {};
  return {
    minScore: cfg.minScore ?? 1.5,
    keepScore: cfg.keepScore ?? 4,
    // Only these topics count in the score: a new topic (Écologie…) must not widen what generalist sources let through.
    topics: cfg.topics ? new Set(cfg.topics) : null,
    intlSections: new Set((cfg.international?.sections || []).map((s) => normalize(s))),
    intlMinScore: cfg.international?.minScore ?? 0,
    sections: new Set((off.sections || []).map((s) => normalize(s))),
    onSections: new Set((cfg.onTopic?.sections || []).map((s) => normalize(s))),
    categories: (off.categories || off.sections || []).map((c) => ({ k: c, re: wordRe(c.replace(/-/g, ' ')) })),
    keywords: (off.keywords || []).map((k) => ({ k: k.replace(/\*$/, ''), re: wordRe(k) })),
  };
}

/** Origins (`media:franceinfo`, `bsky:afp.com`…) of the sources marked `generalist`. */
/** Origin → minimum score, for the sources marked `scopeMinScore` (Courrier international). */
export function sourceMinScores(sources) {
  return new Map((sources.media || []).filter((s) => s.scopeMinScore).map((s) => [`media:${s.id}`, s.scopeMinScore]));
}

export function generalistOrigins(sources, blueskyOrigin) {
  return new Set([
    ...(sources.media || []).filter((s) => s.generalist).map((s) => `media:${s.id}`),
    ...(sources.bluesky?.accounts || []).filter((a) => a.generalist).map(blueskyOrigin),
  ]);
}

const scoringCache = new WeakMap();
/** The matchers whose weights make up the scope score (Politique + Social). */
function scopeMatchers(scope, matchers) {
  if (!scope.topics) return matchers;
  let m = scoringCache.get(matchers);
  if (!m) { m = matchers.filter((x) => scope.topics.has(x.t)); scoringCache.set(matchers, m); }
  return m;
}

/** Path segments of a URL, normalized (accents, case); [] for an invalid URL. */
function sections(url) {
  try { return new URL(url).pathname.split('/').filter(Boolean).slice(0, 3).map((s) => normalize(decodeURIComponent(s))); }
  catch { return []; }
}

/**
 * Why `item` is out of scope, or null when it is kept. `matchers`: the Actus topic matchers.
 * The reason names the signal: « rubrique sante », « catégorie Sport », « mot-clé beaute »,
 * « score 1.5 < 2 ».
 */
export function outOfScope(item, scope, matchers, { minScore: sourceMinScore = 0 } = {}) {
  const ext = item.external || {};
  const text = [item.title, item.text, ext.title, ext.description].filter(Boolean).join('\n');
  const scoring = scopeMatchers(scope, matchers);
  const score = matchKeywords(matchText(item), scoring).reduce((s, m) => s + m.w, 0);
  if (score >= scope.keepScore) return null;

  const url = item.kind === 'article' ? item.url : ext.url;
  const parts = url ? sections(url) : [];
  if (parts.some((s) => scope.onSections.has(s))) return null; // lemonde.fr/politique/…
  // International news (a section of the site, or a source marked scopeMinScore): kept only
  // when it reaches the left / social-struggles bar, not on one weak word.
  const need = Math.max(parts.some((s) => scope.intlSections.has(s)) ? scope.intlMinScore : 0, sourceMinScore);
  if (need && score < need) return `international, score ${score} < ${need}`;
  const section = parts.find((s) => scope.sections.has(s));
  if (section) return `rubrique ${section}`;
  const cats = (item.categories || []).map(normalize);
  for (const c of scope.categories) if (cats.some((x) => c.re.test(x))) return `catégorie ${c.k}`;
  const norm = normalize(text);
  for (const k of scope.keywords) if (k.re.test(norm)) return `mot-clé ${k.k}`;
  if (score < scope.minScore) return `score ${score} < ${scope.minScore}`;
  return null;
}

/**
 * Drops the out-of-scope items of the generalist sources. Returns { kept, dropped }, where
 * dropped is [{ item, reason }] (logged by the collector).
 */
export function filterScope(items, { scope, matchers, generalist, minScores = new Map() }) {
  const kept = [];
  const dropped = [];
  for (const it of items) {
    const reason = generalist.has(it._origin) ? outOfScope(it, scope, matchers, { minScore: minScores.get(it._origin) || 0 }) : null;
    if (reason) dropped.push({ item: it, reason });
    else kept.push(it);
  }
  return { kept, dropped };
}

// ---------- Right / far-right content ----------
// Gabriel follows the news from the left: content centered on right-wing and far-right figures,
// parties or outlets (Bardella, le RN, CNews…) is not wanted from the sources that were not picked
// for their line: hashtag searches (anyone can post #retraites) and generalist media. The
// accounts and channels he follows keep their posts (a left MP attacking Le Pen stays). An item is
// « centered » on them when one of the `terms` is in its headline (title, or the first lines of
// a post); it is kept anyway when its headline is about a struggle (one of `keepTerms`: a strike,
// a demonstration, antifascism…), e.g. « Manifestation contre le RN ». Social vocabulary alone
// (retraites, chômage) is not enough: the RN's own pension plan is full of it.
// `blockedSources` (display name or handle) are dropped altogether, in every feed.

const HEADLINE_CHARS = 200;

/** Title of the item, or the beginning of a post and the title of its link card. */
export function headline(item) {
  if (item.title?.trim()) return item.title;
  return [String(item.text || '').slice(0, HEADLINE_CHARS), item.external?.title].filter(Boolean).join('\n');
}

const sourceKey = (s) => normalize(String(s || '').replace(/^@/, '').replace(/^(bsky|yt):/, ''));

/** Compiles the `scope.right` block of config/topics.json. */
export function compileRight(cfg = {}) {
  const compile = (list) => compileTopics({ topics: { t: { feed: 'actus', keywords: Object.fromEntries((list || []).map((k) => [k, 1])) } } }, 'actus');
  return {
    sources: new Set((cfg.blockedSources || []).map(sourceKey)),
    matchers: compile(cfg.terms),
    keep: compile(cfg.keepTerms),
  };
}

/**
 * Why `item` is right-wing content to drop (« source Droite TV », « droite : bardella »), or null.
 * `open`: the item comes from a hashtag search or a generalist source (the terms only apply there).
 */
export function rightReason(item, right, { open = true } = {}) {
  const src = item.source || {};
  if ([src.name, src.handle, src.id].some((x) => x && right.sources.has(sourceKey(x)))) return `source ${src.name || src.handle}`;
  if (!open) return null;
  const head = headline(item);
  const hits = matchKeywords(head, right.matchers);
  if (!hits.length || matchKeywords(head, right.keep).length) return null;
  return `droite : ${hits.map((h) => h.k).join(', ')}`;
}

/** Items found by a hashtag search, whoever posted them. */
export const isTagItem = (it) => !!it.tag || String(it._origin || '').startsWith('tag:');

/**
 * Drops right-wing content: blocked accounts everywhere, centered items from hashtag searches
 * and generalist sources. Returns { kept, dropped: [{ item, reason }] }.
 */
export function filterRight(items, { right, generalist = new Set() }) {
  const kept = [];
  const dropped = [];
  for (const it of items) {
    const reason = rightReason(it, right, { open: isTagItem(it) || generalist.has(it._origin) });
    if (reason) dropped.push({ item: it, reason });
    else kept.push(it);
  }
  return { kept, dropped };
}
