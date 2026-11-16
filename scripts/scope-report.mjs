#!/usr/bin/env node
// Prints what the out-of-scope filter keeps and drops for the generalist sources, from their
// live feeds: `node scripts/scope-report.mjs` (add `--all` to list the kept items too).
// Used to tune the `scope` block of config/topics.json without throwing away real news.
import fs from 'node:fs/promises';
import { fetchSourceFeed, entryToArticle } from './lib/rss.mjs';
import * as bsky from './lib/bluesky.mjs';
import { compileTopics, matchKeywords } from './lib/score.mjs';
import { matchText } from '../public/topics.js';
import { compileScope, outOfScope } from './lib/scope.mjs';

const readJson = async (p) => JSON.parse(await fs.readFile(new URL(`../${p}`, import.meta.url), 'utf8'));
const sources = await readJson('config/sources.json');
const topicsCfg = await readJson('config/topics.json');
const matchers = compileTopics(topicsCfg, 'actus');
const scope = compileScope(topicsCfg.scope);
const all = process.argv.includes('--all');

const groups = [];
for (const src of sources.media.filter((s) => s.generalist)) {
  try {
    const feed = await fetchSourceFeed(src);
    groups.push({ name: src.name, minScore: src.scopeMinScore || 0, items: feed.entries.filter((e) => e.link && e.title).map((e) => entryToArticle(e, src)).filter(Boolean) });
  } catch (err) { console.log(`${src.name} : échec (${err.message})`); }
}
const client = await bsky.createClient({});
for (const acc of sources.bluesky.accounts.filter((a) => a.generalist)) {
  try {
    const r = await bsky.resolveAccount(client, acc);
    groups.push({ name: `${acc.name} (Bluesky)`, items: await bsky.authorPosts(client, r, 40) });
  } catch (err) { console.log(`${acc.name} : échec (${err.message})`); }
}

let total = 0; let dropped = 0;
const reasons = {};
for (const g of groups) {
  const rows = g.items.map((it) => {
    const ext = it.external || {};
    const text = [it.title, it.text, ext.title, ext.description].filter(Boolean).join('\n');
    const kws = matchKeywords(matchText(it), matchers.filter((m) => !scope.topics || scope.topics.has(m.t)));
    return { it, reason: outOfScope(it, scope, matchers, { minScore: g.minScore }), score: kws.reduce((s, m) => s + m.w, 0), kws: kws.map((m) => m.k).join(', ') };
  });
  const d = rows.filter((r) => r.reason);
  total += rows.length; dropped += d.length;
  console.log(`\n## ${g.name} : ${d.length}/${rows.length} écartés`);
  for (const r of rows) {
    if (!r.reason && !all) continue;
    const kind = r.reason ? r.reason.split(' ')[0] : 'gardé';
    if (r.reason) reasons[kind] = (reasons[kind] || 0) + 1;
    const url = r.it.kind === 'article' ? r.it.url : r.it.external?.url || '';
    const title = (r.it.title || r.it.text || '').replace(/\s+/g, ' ').slice(0, 110);
    console.log(`${r.reason ? 'DROP' : 'KEEP'} [${r.reason || 'gardé'}] (score ${r.score}${r.kws ? ` : ${r.kws}` : ''}) ${title} ${url ? `<${url.slice(0, 90)}>` : ''}`);
  }
}
console.log(`\nTotal : ${dropped}/${total} écartés · ${JSON.stringify(reasons)}`);
