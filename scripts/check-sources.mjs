// Daily check of the sources that failed in the last deployed collection.
//
// Reads the production status.json, re-checks every failing source from the runner and looks
// for a working replacement (feed autodiscovery on the site, common paths, YouTube channel,
// Bluesky account search). The report goes to the job summary and to one GitHub issue
// labelled « sources-indisponibles », kept up to date and closed once everything works again.
// A scheduled Claude task reads that issue and fixes config/sources.json through a PR.
//
// PROBE="url1 url2 @handle.bsky.social" only tests these candidates (used by Claude to check
// an alternative it found) and leaves the issue alone.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchText, fetchJson, pool } from './lib/http.mjs';
import { parseFeed, discoverFeeds, COMMON_PATHS } from './lib/rss.mjs';
import * as yt from './lib/youtube.mjs';
import * as bsky from './lib/bluesky.mjs';
import { ISSUE_LABEL, ISSUE_TITLE, buildIssueBody, findConfigEntry, nextState, parseState, sourceKey } from './lib/source-check.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = process.env.GITHUB_REPOSITORY || 'gabrielmartin-dev/socialmedia';
const [owner, name] = repo.split('/');
const STATUS_URL = process.env.STATUS_URL || `https://${owner.toLowerCase()}.github.io/${name}/data/status.json`;
const token = process.env.GITHUB_TOKEN;
const now = Date.now();
const errMsg = (e) => e?.message || String(e);

async function probeFeed(url, opts = {}) {
  const { text, url: finalUrl } = await fetchText(url, { retries: 1, ...opts });
  const entries = parseFeed(text).entries.filter((e) => e.link && e.title);
  if (!entries.length) throw new Error('Flux vide');
  const latest = entries.map((e) => e.publishedAt).filter(Boolean).sort().pop() || null;
  return { url: finalUrl, entries: entries.length, latest: latest && latest.slice(0, 10) };
}

async function checkMedia(src) {
  const out = { configured: src.feed || src.site, candidates: [] };
  if (src.feed) {
    try { const f = await probeFeed(src.feed); out.recheck = `flux OK (${f.entries} éléments, dernier : ${f.latest || 'sans date'})`; out.recovered = true; return out; }
    catch (e) { out.recheck = `flux toujours en échec : ${errMsg(e)}`; }
  }
  if (!src.site) return out;
  const urls = [];
  try {
    const { text, url } = await fetchText(src.site, { retries: 1 });
    out.site = `répond (${url})`;
    urls.push(...discoverFeeds(text, url));
  } catch (e) { out.site = `injoignable : ${errMsg(e)}`; }
  for (const p of COMMON_PATHS) urls.push(new URL(p, src.site).href);
  const seen = new Set();
  for (const u of urls) {
    if (u === src.feed || seen.has(u) || out.candidates.length >= 4) continue;
    try {
      const f = await probeFeed(u, { retries: 0, timeoutMs: 8000 });
      if (seen.has(f.url)) continue;
      seen.add(u); seen.add(f.url);
      out.candidates.push(f);
    } catch { seen.add(u); }
  }
  if (!src.feed && out.candidates.length) { out.recheck = 'flux découvert aujourd\'hui sur le site'; out.recovered = true; }
  return out;
}

async function checkYouTube(ch) {
  const out = { configured: ch.channelId || ch.url };
  try {
    const r = await yt.resolveChannel(ch);
    const items = await yt.channelVideos(ch, r);
    out.recheck = `chaîne OK (${r.id}, ${items.length} vidéos)`;
    out.recovered = true;
  } catch (e) { out.recheck = `toujours en échec : ${errMsg(e)}`; }
  return out;
}

async function checkBluesky(acc, client) {
  const out = { configured: acc.handle || acc.name };
  try {
    const r = await bsky.resolveAccount(client, acc);
    out.recheck = `compte OK (@${r.handle})`;
    out.recovered = true;
    return out;
  } catch (e) { out.recheck = `toujours en échec : ${errMsg(e)}`; }
  try {
    const { actors = [] } = await client.call('app.bsky.actor.searchActors', { q: acc.name, limit: 5 });
    if (actors.length) out.note = `comptes proches : ${actors.map((a) => `${a.displayName || '?'} (@${a.handle})`).join(', ')}`;
  } catch { /* search is best effort */ }
  return out;
}

async function probeCandidates(list) {
  const client = await bsky.createClient({});
  for (const c of list) {
    try {
      if (c.startsWith('@')) {
        const r = await bsky.resolveAccount(client, { handle: c.slice(1) });
        console.log(`✔ ${c} : compte Bluesky « ${r.displayName} »${r.verified ? ' (vérifié)' : ''}`);
      } else if (/youtube\.com\//.test(c)) {
        const ch = /\/channel\/(UC[\w-]{22})/.exec(c) ? { channelId: /\/channel\/(UC[\w-]{22})/.exec(c)[1] } : { url: c };
        const r = await yt.resolveChannel(ch);
        const items = await yt.channelVideos({ name: c }, r);
        console.log(`✔ ${c} : chaîne ${r.id}, ${items.length} vidéos, dernière : ${items[0]?.publishedAt?.slice(0, 10) || '?'}`);
      } else {
        const f = await probeFeed(c);
        console.log(`✔ ${c} : flux valide → ${f.url} (${f.entries} éléments, dernier : ${f.latest || 'sans date'})`);
      }
    } catch (e) { console.log(`✘ ${c} : ${errMsg(e)}`); }
  }
}

async function gh(method, route, body) {
  const res = await fetch(`https://api.github.com/repos/${repo}${route}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub ${method} ${route} : HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  const probe = (process.env.PROBE || '').split(/\s+/).filter(Boolean);
  if (probe.length) return probeCandidates(probe);

  const status = await fetchJson(STATUS_URL);
  const config = JSON.parse(await fs.readFile(path.join(ROOT, 'config/sources.json'), 'utf8'));
  const failed = status.sources.filter((s) => !s.ok);
  console.log(`Collecte du ${status.generatedAt} : ${failed.length}/${status.sources.length} sources en échec.`);

  const client = await bsky.createClient({});
  const checks = {};
  await pool(failed.map((f) => async () => {
    const entry = findConfigEntry(config, f);
    let c = { note: entry ? null : f.type === 'bsky-tag' ? 'recherche Bluesky par hashtag (pas une entrée de config à corriger)' : 'source absente de config/sources.json (déjà retirée ou renommée ?)' };
    if (entry && (f.type === 'rss' || f.type === 'tech')) c = await checkMedia(entry);
    else if (entry && f.type === 'youtube') c = await checkYouTube(entry);
    else if (entry && f.type === 'bluesky') c = await checkBluesky(entry, client);
    if (!entry && f.type === 'bluesky' && f.name === 'connexion') c = { recovered: true };
    checks[sourceKey(f)] = c;
  }), 3);

  const failing = failed.filter((f) => !checks[sourceKey(f)].recovered);
  for (const f of failed) console.log(`${checks[sourceKey(f)].recovered ? '↺' : '✘'} ${f.type} ${f.name} — ${checks[sourceKey(f)].recheck || f.error}`);

  let issue = null;
  // Found by label, or by title if the label could not be created.
  if (token) issue = (await gh('GET', '/issues?state=open&per_page=100')).find((i) => !i.pull_request &&
    (i.labels.some((l) => l.name === ISSUE_LABEL) || i.title.startsWith(ISSUE_TITLE))) || null;
  const state = nextState(parseState(issue?.body), failing, now);
  const body = buildIssueBody({ failing, checks, state, statusGeneratedAt: status.generatedAt, total: status.sources.length, now });

  if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `${body}\n`);
  if (!token) { console.log(`\n${body}`); return; }
  if (!failing.length) {
    if (issue) {
      await gh('POST', `/issues/${issue.number}/comments`, { body: 'Toutes les sources fonctionnent de nouveau.' });
      await gh('PATCH', `/issues/${issue.number}`, { state: 'closed', state_reason: 'completed', body });
      console.log(`Issue #${issue.number} fermée.`);
    }
    return;
  }
  const title = `${ISSUE_TITLE} (${failing.length})`;
  if (issue) await gh('PATCH', `/issues/${issue.number}`, { title, body });
  else issue = await gh('POST', '/issues', { title, body, labels: [ISSUE_LABEL] }).catch(() => gh('POST', '/issues', { title, body }));
  console.log(`Issue #${issue.number} à jour : ${issue.html_url || ''}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
