// Text helpers: HTML stripping, tokenisation, similarity. normalize / truncate / escapeRegex
// live in public/norm.js (shared with the browser).

import { normalize } from '../../public/norm.js';
export { normalize, escapeRegex, truncate } from '../../public/norm.js';

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', ndash: '–', mdash: '—',
  laquo: '«', raquo: '»', eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', acirc: 'â',
  ccedil: 'ç', ocirc: 'ô', icirc: 'î', ucirc: 'û', ugrave: 'ù', euml: 'ë', iuml: 'ï',
};

export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

export function stripHtml(html) {
  const noTags = String(html ?? '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(noTags).replace(/[ \t\r\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

const STOPWORDS = new Set(`
a au aux avec ce ces cet cette dans de des du elle elles en et eux il ils je la le les leur leurs lui ma mais me meme
mes moi mon ne nos notre nous on ou par pas pour qu que qui sa se ses son sur ta te tes toi ton tu un une vos votre vous
c d j l m n s t y ete etre avoir fait faire plus moins tres tout tous toute toutes sans sous apres avant entre contre
comme quand alors ainsi aussi donc car si non oui deja encore depuis chez vers selon face lors pendant dont ni
est sont sera ont avait etait va vont peut doit faut cela ceci celui celle ceux celles quoi quel quelle quels quelles
the of and to in for on with is are video direct live exclusif exclusive info infos
`.trim().split(/\s+/));

/**
 * Significant word tokens, for similarity comparisons. With `stem` (story matching): numbers
 * of 2 digits or more are kept (« 49.3 » → 49, 3 is dropped, « 20 ans » → 20), a final
 * s / x is removed from words of 5 letters or more and words are cut to 7 letters, so that
 * « grève » = « grèves » and « manifestants » = « manifestation ».
 */
export function tokens(s, { stem = false } = {}) {
  const words = normalize(s).split(/[^a-z0-9]+/);
  if (!stem) return words.filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return words
    .filter((w) => (/^\d+$/.test(w) ? w.length >= 2 : w.length >= 3 && !STOPWORDS.has(w)))
    .map((w) => (/^\d+$/.test(w) ? w : (w.length > 4 ? w.replace(/[sx]$/, '') : w).slice(0, 7)));
}

export function jaccard(a, b) {
  const A = a instanceof Set ? a : new Set(a);
  const B = b instanceof Set ? b : new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

// Endings that feeds append to every summary: WordPress / SPIP notices and « read more » links.
const TRAILERS = [
  /\s*The post\s.{1,300}?\sappeared first on\s.{1,200}$/is,
  /\s*(?:L['’]article|Cet article|Le billet)\s.{1,300}?\s(?:est apparu en premier sur|a été publié en premier sur|est paru en premier sur)\s.{1,200}$/is,
  // Only after the end of a sentence, and only a short tail: « Lire la suite des événements… » stays.
  /(?<=[.…!?»)\]])\s*(?:Lire la suite|Lire l['’]article(?: complet)?|Lire plus|La suite|Continuer la lecture|Continue reading|Read more|Read the full (?:story|article)|Keep reading)\b[^\n]{0,40}$/i,
];

/**
 * A feed's summary without its boilerplate: « The post … appeared first on … », « Lire la
 * suite », « […] », the title repeated at the start, or Hacker News' « Article URL: … Points: … ».
 * '' when nothing remains (or when the summary is only the title).
 */
export function cleanSummary(text, title = '') {
  let t = String(text ?? '').trim();
  if (!t) return '';
  if (/^Article URL:\s*\S+/i.test(t) && /Comments URL:/i.test(t)) return '';
  let prev;
  do {
    prev = t;
    for (const re of TRAILERS) t = t.replace(re, '');
    t = t.replace(/\s*(?:\[(?:…|\.\.\.)\]|\((?:…|\.\.\.)\)|\[\s*\]|→|>>)\s*$/u, (m) => (/[….]/.test(m) ? '…' : '')).trim();
  } while (t !== prev);
  const ti = String(title ?? '').trim();
  if (ti) {
    if (normalize(t) === normalize(ti)) return '';
    if (normalize(t).startsWith(normalize(ti)) && t.length > ti.length + 20) t = t.slice(ti.length).replace(/^[\s:.\-–—|]+/, '');
  }
  return t === '…' ? '' : t;
}
