// Daily check of the sources that failed in the last collection (scripts/check-sources.mjs).
// Pure helpers: matching a status.json entry to its config entry, and the tracking issue
// body, whose hidden state remembers since when each source has been failing.

const STATE_RE = /<!-- check-sources-state (\{[\s\S]*?\}) -->/;
export const ISSUE_TITLE = 'Sources indisponibles';
export const ISSUE_LABEL = 'sources-indisponibles';
const DAY = 24 * 3600e3;

export const sourceKey = (s) => `${s.type}:${s.name}`;

/** The config entry behind a failing status.json entry, or null (hashtags, connexion…). */
export function findConfigEntry(config, { type, name }) {
  const byName = (list) => (list || []).find((e) => e.name === name) || null;
  switch (type) {
    case 'rss': return byName(config.media);
    case 'tech': return byName(config.tech);
    case 'youtube': return byName(config.youtube);
    case 'tiktok': return byName(config.tiktok);
    case 'bluesky': return byName(config.bluesky?.accounts);
    default: return null;
  }
}

/** Previous state ({key: {firstSeen}}) stored in the issue body; {} when absent or corrupt. */
export function parseState(body) {
  const m = STATE_RE.exec(body || '');
  if (!m) return {};
  try { return JSON.parse(m[1]); } catch { return {}; }
}

/** firstSeen carried over for sources still failing, now for new ones; recovered ones drop out. */
export function nextState(prev, failing, now) {
  const state = {};
  for (const f of failing) {
    const key = sourceKey(f);
    state[key] = { firstSeen: prev[key]?.firstSeen || new Date(now).toISOString() };
  }
  return state;
}

export const daysDown = (firstSeen, now) => Math.floor((now - Date.parse(firstSeen)) / DAY);

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').slice(0, 300);

/**
 * Issue body: one section per failing source with the collector's error and today's
 * diagnosis (`checks`: {key: {configured, site, candidates:[{url, entries, latest}], note}}).
 */
export function buildIssueBody({ failing, checks, state, statusGeneratedAt, total, now }) {
  const lines = [
    `Vérification automatique du ${new Date(now).toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    `(collecte du ${statusGeneratedAt ? statusGeneratedAt.slice(0, 16).replace('T', ' ') : '?'} UTC) : **${failing.length}/${total} sources en échec**.`,
    '',
    'Chaque source est revérifiée tous les jours. Les flux « candidats » ont été lus avec succès depuis un runner GitHub ; Claude s\'en sert pour corriger `config/sources.json` par une PR.',
    '',
  ];
  for (const f of failing) {
    const key = sourceKey(f);
    const c = checks[key] || {};
    const days = daysDown(state[key].firstSeen, now);
    lines.push(`### ${f.name} (${f.type})`, '');
    lines.push(`- En échec depuis : ${state[key].firstSeen.slice(0, 10)} (${days} j)`);
    lines.push(`- Erreur de la collecte : ${cell(f.error)}`);
    if (c.configured) lines.push(`- Configuration : \`${cell(c.configured)}\``);
    if (c.recheck) lines.push(`- Revérification aujourd'hui : ${cell(c.recheck)}`);
    if (c.site) lines.push(`- Site : ${cell(c.site)}`);
    if (c.candidates?.length) {
      lines.push('- Flux candidats valides :');
      for (const cand of c.candidates) lines.push(`  - ${cand.url} (${cand.entries} éléments, dernier : ${cand.latest || 'sans date'})`);
    } else if (c.candidates) lines.push('- Aucun flux de remplacement trouvé sur le site.');
    if (c.note) lines.push(`- Note : ${cell(c.note)}`);
    lines.push('');
  }
  lines.push(`<!-- check-sources-state ${JSON.stringify(state)} -->`);
  return lines.join('\n');
}
