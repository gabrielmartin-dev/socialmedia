#!/usr/bin/env node
// Diagnostic of the feed algorithms on the collected data (public/data/*.json):
// ranking simulation, duplicates, topics, images. Read-only, prints to stdout.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unpackFeed } from '../public/pack.js';
import { entryScore, itemScore, diversify, topicScore, emptyPrefs } from '../public/rank.js';
import { tokens, jaccard } from './lib/text.mjs';
import { canonicalUrl, hostOf } from '../public/url.js';

const DIR = process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
const load = async (n) => unpackFeed(JSON.parse(await fs.readFile(path.join(DIR, `${n}.json`), 'utf8')));
const actus = await load('actus');
const tech = await load('tech');
const videos = await load('videos');
const accounts = JSON.parse(await fs.readFile(path.join(DIR, 'accounts.json'), 'utf8')).accounts;
const now = Date.parse(actus.generatedAt);
const H = 3600e3;
const ageH = (it) => (now - Date.parse(it.publishedAt)) / H;
const flat = (doc) => doc.entries.flatMap((e) => (e.kind === 'group' ? e.items : [e]));
const cut = (s, n = 95) => String(s || '').replace(/\s+/g, ' ').slice(0, n);
const label = (it) => `${it.source?.name} · ${cut(it.title || it.text)}`;
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0) + ' %';
const count = (arr, fn) => { const m = new Map(); for (const x of arr) { const k = fn(x); m.set(k, (m.get(k) || 0) + 1); } return [...m].sort((a, b) => b[1] - a[1]); };
const head = (t) => console.log(`\n===== ${t} =====`);
const sum = (it) => (it.keywords || []).reduce((s, k) => s + k.w, 0);
const suggestedIds = new Set(accounts.filter((a) => a.suggested).map((a) => a.id));
const followed = (it) => !(it.source?.suggested ?? suggestedIds.has(it.source?.id));

/** What the app shows by default: suggestions out, groups rebuilt, relays hidden. */
function clientEntries(doc) {
  const out = [];
  for (const e of doc.entries) {
    if (e.kind !== 'group') { if (followed(e)) out.push(e); continue; }
    const items = e.items.filter(followed);
    if (items.length > 1) out.push({ ...e, items }); else if (items.length === 1) out.push(items[0]);
  }
  const shown = new Set(out.flatMap((e) => (e.kind === 'group' ? e.items.map((i) => i.id) : [e.id])));
  return out.filter((e) => !(e.relayOf && shown.has(e.relayOf)));
}

function overview(name, doc) {
  head(`${name} : vue d'ensemble`);
  const items = flat(doc);
  const shown = clientEntries(doc);
  console.log(`${items.length} éléments (${doc.entries.length} entrées, ${doc.entries.filter((e) => e.kind === 'group').length} groupes) · affichés par défaut : ${shown.length} entrées · demi-vie ${doc.halfLifeHours} h`);
  console.log('par type :', JSON.stringify(Object.fromEntries(count(items, (i) => `${i.kind}/${i.platform}`))));
  const buckets = [6, 12, 24, 48, 72, 120, 168];
  console.log('par âge (h) :', buckets.map((b, i) => `<${b}: ${items.filter((x) => ageH(x) < b && ageH(x) >= (buckets[i - 1] || 0)).length}`).join(' · '));
  const shownItems = shown.flatMap((e) => (e.kind === 'group' ? e.items : [e]));
  console.log(`sources affichées (${new Set(shownItems.map((i) => i.source.id)).size}), nb d'éléments dans la fenêtre :`);
  console.log('  ' + count(shownItems, (i) => i.source.name).slice(0, 45).map(([k, n]) => `${k} ${n}`).join(' · '));
  // Topics
  const none = shownItems.filter((i) => !(i.keywords || []).length);
  const byTopic = count(shownItems.flatMap((i) => [...new Set((i.keywords || []).map((k) => k.t))]), (t) => t);
  console.log(`sujets : ${byTopic.map(([t, n]) => `${t} ${n}`).join(' · ')} · aucun mot-clé ${none.length} (${pct(none.length, shownItems.length)})`);
  for (const kind of ['article', 'post', 'video']) {
    const k = shownItems.filter((i) => i.kind === kind);
    if (k.length) console.log(`  ${kind} : ${k.length}, sans mot-clé ${pct(k.filter((i) => !(i.keywords || []).length).length, k.length)}, score brut moyen ${(k.reduce((s, i) => s + sum(i), 0) / k.length).toFixed(2)}, plafonnés (>=${doc.scoreCap}) ${pct(k.filter((i) => sum(i) >= doc.scoreCap).length, k.length)}`);
  }
  const hist = [0, 0.01, 1.01, 2.01, 3.01, 4.51, 6, 9, 1e9];
  console.log('  histogramme du score brut :', hist.slice(0, -1).map((b, i) => `[${b}-${hist[i + 1] > 100 ? '∞' : hist[i + 1]}[ ${shownItems.filter((x) => sum(x) >= b && sum(x) < hist[i + 1]).length}`).join(' · '));
  console.log('mots-clés les plus fréquents :');
  console.log('  ' + count(shownItems.flatMap((i) => (i.keywords || []).map((k) => `${k.k}(${k.w})`)), (k) => k).slice(0, 70).map(([k, n]) => `${k} ${n}`).join(' · '));
  console.log('sans mot-clé, par source : ' + count(none, (i) => i.source.name).slice(0, 30).map(([k, n]) => `${k} ${n}/${shownItems.filter((i) => i.source.name === k).length}`).join(' · '));
  console.log('échantillon sans mot-clé :');
  const step = Math.max(1, Math.floor(none.length / 45));
  for (let i = 0; i < none.length; i += step) console.log(`  ∅ [${none[i].kind}] ${label(none[i])}`);
  const weak = shownItems.filter((i) => (i.keywords || []).length === 1 && sum(i) <= 1);
  console.log(`un seul mot-clé faible (≤ 1) : ${weak.length}, échantillon :`);
  const st2 = Math.max(1, Math.floor(weak.length / 30));
  for (let i = 0; i < weak.length; i += st2) console.log(`  ~ (${weak[i].keywords[0].k}) ${label(weak[i])}`);
  return { items, shown, shownItems };
}

function rankSim(name, doc, shown) {
  head(`${name} : simulation du classement (300 tirages, 20 premières cartes)`);
  const opts = { now, halfLife: doc.halfLifeHours, cap: doc.scoreCap, prefs: emptyPrefs() };
  const scored = shown.map((e) => ({ e, s: Math.max(entryScore(e, opts), 1e-9) }));
  const newest = (e) => (e.kind === 'group' ? Math.min(...e.items.map(ageH)) : ageH(e));
  const kindOf = (e) => (e.kind === 'group' ? 'group' : e.kind);
  const tsc = (e) => (e.kind === 'group' ? Math.max(...e.items.map((i) => topicScore(i, opts.prefs, opts.cap))) : topicScore(e, opts.prefs, opts.cap));
  const total = scored.reduce((s, x) => s + x.s, 0);
  console.log(`pool : ${scored.length} entrées · âge médian ${median(scored.map((x) => newest(x.e))).toFixed(1)} h · sans sujet ${pct(scored.filter((x) => !tsc(x.e)).length, scored.length)} · types ${JSON.stringify(Object.fromEntries(count(scored, (x) => kindOf(x.e))))}`);
  const bySrc = new Map();
  for (const x of scored) { const k = x.e.kind === 'group' ? '(groupes)' : x.e.source.name; bySrc.set(k, (bySrc.get(k) || 0) + x.s); }
  console.log('part du score total par source (= part attendue de l’attention) : ' + [...bySrc].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([k, v]) => `${k} ${pct(v, total)}`).join(' · '));
  console.log('top 25 déterministe :');
  for (const x of [...scored].sort((a, b) => b.s - a.s).slice(0, 25)) {
    const it = x.e.kind === 'group' ? x.e.items[0] : x.e;
    const st = it.stats ? ` ♥${it.stats.likes}/↻${it.stats.reposts}` : '';
    console.log(`  ${x.s.toFixed(2)} [${kindOf(x.e)}${x.e.kind === 'group' ? ' ×' + x.e.items.length : ''}] ${newest(x.e).toFixed(1)} h, sujet ${tsc(x.e)}${st} · ${label(it)}`);
  }
  for (const alpha of [1, 1.5, 2, 3]) {
    const N = 300; const K = 20;
    const acc = { age: 0, none: 0, post: 0, article: 0, group: 0, video: 0, distinct: 0, maxSrc: 0, top5of20: 0, old: 0 };
    const best20 = new Set([...scored].sort((a, b) => b.s - a.s).slice(0, 20).map((x) => x.e.id));
    for (let r = 0; r < N; r++) {
      const order = diversify(scored.map((x) => ({ e: x.e, k: Math.log(Math.max(Math.random(), 1e-12)) / x.s ** alpha })).sort((a, b) => b.k - a.k).map((x) => x.e)).slice(0, K);
      acc.age += median(order.map(newest));
      acc.none += order.filter((e) => !tsc(e)).length / K;
      for (const e of order) acc[kindOf(e)] += 1 / K;
      const srcs = count(order.filter((e) => e.kind !== 'group'), (e) => e.source.id);
      acc.distinct += srcs.length; acc.maxSrc += srcs[0]?.[1] || 0;
      acc.top5of20 += order.filter((e) => best20.has(e.id)).length;
      acc.old += order.filter((e) => newest(e) > 24).length;
    }
    const f = (v, d = 2) => (v / N).toFixed(d);
    console.log(`  α=${alpha} : âge médian ${f(acc.age, 1)} h · >24 h : ${f(acc.old, 1)}/20 · sans sujet ${f(acc.none * 100, 0)} % · posts ${f(acc.post * 100, 0)} % articles ${f(acc.article * 100, 0)} % groupes ${f(acc.group * 100, 0)} % · sources distinctes ${f(acc.distinct, 1)} · max même source ${f(acc.maxSrc, 1)} · dont top-20 déterministe ${f(acc.top5of20, 1)}/20`);
  }
}
function median(a) { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; }

function dedup(name, doc) {
  head(`${name} : regroupement et doublons`);
  const groups = doc.entries.filter((e) => e.kind === 'group');
  console.log(`${groups.length} groupes, tailles : ${JSON.stringify(Object.fromEntries(count(groups, (g) => g.items.length)))}`);
  for (const g of groups) {
    console.log(`  G×${g.items.length}`);
    for (const it of g.items) console.log(`     ${ageH(it).toFixed(0)} h · ${label(it)}`);
  }
  const items = flat(doc);
  const arts = items.filter((i) => i.kind === 'article');
  const groupOf = new Map();
  groups.forEach((g, n) => g.items.forEach((i) => groupOf.set(i.id, n)));
  // IDF over article titles.
  const toks = arts.map((a) => new Set(tokens(a.title)));
  const df = new Map();
  for (const t of toks) for (const w of t) df.set(w, (df.get(w) || 0) + 1);
  const idf = (w) => Math.log(1 + arts.length / (df.get(w) || 1));
  const cos = (A, B) => {
    let dot = 0; let na = 0; let nb = 0;
    for (const w of A) { const v = idf(w) ** 2; na += v; if (B.has(w)) dot += v; }
    for (const w of B) nb += idf(w) ** 2;
    return na && nb ? dot / Math.sqrt(na * nb) : 0;
  };
  const pairs = [];
  for (let i = 0; i < arts.length; i++) {
    for (let j = i + 1; j < arts.length; j++) {
      if (toks[i].size < 3 || toks[j].size < 3) continue;
      const dt = Math.abs(Date.parse(arts[i].publishedAt) - Date.parse(arts[j].publishedAt)) / H;
      if (dt > 48) continue;
      const jac = jaccard(toks[i], toks[j]);
      const c = cos(toks[i], toks[j]);
      if (jac < 0.18 && c < 0.3) continue;
      pairs.push({ i, j, jac, c, dt, same: arts[i].source.id === arts[j].source.id, grouped: groupOf.has(arts[i].id) && groupOf.get(arts[i].id) === groupOf.get(arts[j].id) });
    }
  }
  const cross = pairs.filter((p) => !p.same);
  for (const th of [0.25, 0.3, 0.34, 0.4, 0.5]) console.log(`  paires inter-sources jaccard ≥ ${th} : ≤12 h ${cross.filter((p) => p.jac >= th && p.dt <= 12).length} · ≤24 h ${cross.filter((p) => p.jac >= th && p.dt <= 24).length} · ≤48 h ${cross.filter((p) => p.jac >= th && p.dt <= 48).length}`);
  for (const th of [0.35, 0.45, 0.55]) console.log(`  paires inter-sources cosinus-IDF ≥ ${th} : ≤12 h ${cross.filter((p) => p.c >= th && p.dt <= 12).length} · ≤48 h ${cross.filter((p) => p.c >= th && p.dt <= 48).length}`);
  const show = (p) => console.log(`    j=${p.jac.toFixed(2)} cos=${p.c.toFixed(2)} Δ${p.dt.toFixed(0)} h${p.grouped ? ' [groupé]' : ''}\n       ${label(arts[p.i])}\n       ${label(arts[p.j])}`);
  console.log('paires inter-sources NON groupées, les plus proches (candidats manqués ou faux amis) :');
  cross.filter((p) => !p.grouped).sort((a, b) => Math.max(b.jac, b.c * 0.75) - Math.max(a.jac, a.c * 0.75)).slice(0, 45).forEach(show);
  console.log('paires groupées les plus faibles (risque de faux positif) :');
  cross.filter((p) => p.grouped).sort((a, b) => a.jac - b.jac).slice(0, 15).forEach(show);
  const sameSrc = pairs.filter((p) => p.same && p.jac >= 0.6);
  console.log(`même source, titres quasi identiques (jaccard ≥ 0,6) : ${sameSrc.length}`);
  sameSrc.slice(0, 12).forEach(show);

  // Bluesky posts.
  const posts = items.filter((i) => i.platform === 'bluesky');
  const byUrl = new Map(arts.map((a) => [canonicalUrl(a.url), a]));
  const linking = posts.filter((p) => p.external?.url);
  const toArticle = linking.filter((p) => byUrl.has(canonicalUrl(p.external.url)));
  console.log(`posts Bluesky : ${posts.length}, avec carte de lien ${linking.length}, relais (relayOf) ${posts.filter((p) => p.relayOf).length}, lien vers un article collecté sans être un relais ${toArticle.filter((p) => !p.relayOf).length}`);
  toArticle.filter((p) => !p.relayOf).slice(0, 10).forEach((p) => console.log(`    @${p.source.handle} → ${label(byUrl.get(canonicalUrl(p.external.url)))}`));
  const shared = count(linking, (p) => canonicalUrl(p.external.url)).filter(([, n]) => n > 1);
  console.log(`même lien partagé par plusieurs posts : ${shared.length} liens (${shared.reduce((s, [, n]) => s + n, 0)} posts)`);
  shared.slice(0, 12).forEach(([u, n]) => console.log(`    ×${n} ${cut(u, 110)} ← ${linking.filter((p) => canonicalUrl(p.external.url) === u).map((p) => p.source.handle).join(', ')}`));
  console.log('domaines des cartes de lien : ' + count(linking, (p) => hostOf(p.external.url)).slice(0, 25).map(([k, n]) => `${k} ${n}`).join(' · '));
  const pt = posts.map((p) => new Set(tokens(p.text)));
  let near = 0; const ex = [];
  for (let i = 0; i < posts.length; i++) for (let j = i + 1; j < posts.length; j++) {
    if (pt[i].size < 6 || pt[j].size < 6) continue;
    const s = jaccard(pt[i], pt[j]);
    if (s >= 0.6) { near++; if (ex.length < 10) ex.push(`    j=${s.toFixed(2)} ${posts[i].source.id === posts[j].source.id ? '(même compte) ' : ''}@${posts[i].source.handle} / @${posts[j].source.handle} · ${cut(posts[i].text, 80)}`); }
  }
  console.log(`posts au texte quasi identique (jaccard ≥ 0,6) : ${near} paires`);
  ex.forEach((e) => console.log(e));
  // Posts about a grouped story / an article (text vs title).
  let about = 0; const ex2 = [];
  for (let i = 0; i < posts.length; i++) {
    if (pt[i].size < 5 || posts[i].relayOf) continue;
    let best = 0; let bj = -1;
    for (let j = 0; j < arts.length; j++) {
      if (toks[j].size < 4) continue;
      let inter = 0; for (const w of toks[j]) if (pt[i].has(w)) inter++;
      const cov = inter / toks[j].size; // share of the title's words found in the post
      if (cov > best) { best = cov; bj = j; }
    }
    if (best >= 0.7) { about++; if (ex2.length < 10) ex2.push(`    cov=${best.toFixed(2)} @${posts[i].source.handle} · ${cut(posts[i].text, 70)}  ⇢  ${label(arts[bj])}`); }
  }
  console.log(`posts qui reprennent ≥ 70 % des mots d'un titre d'article : ${about}`);
  ex2.forEach((e) => console.log(e));
  // Engagement
  const st = posts.filter((p) => p.stats).map((p) => p.stats.likes + 2 * p.stats.reposts).sort((a, b) => a - b);
  const q = (x) => st[Math.floor(x * (st.length - 1))] ?? 0;
  console.log(`engagement (likes + 2×reposts) : p10 ${q(0.1)} · p50 ${q(0.5)} · p90 ${q(0.9)} · p99 ${q(0.99)} · max ${q(1)} → facteur p50 ${(1 + 0.25 * Math.log10(1 + q(0.5))).toFixed(2)}, p90 ${(1 + 0.25 * Math.log10(1 + q(0.9))).toFixed(2)}, max ${(1 + 0.25 * Math.log10(1 + q(1))).toFixed(2)}`);
  console.log('posts par compte, part avec média : ' + count(posts, (p) => p.source.handle).slice(0, 12).map(([k, n]) => `${k} ${n}`).join(' · '));
  console.log(`posts : avec image ${pct(posts.filter((p) => p.images?.length).length, posts.length)} · vidéo ${pct(posts.filter((p) => p.video).length, posts.length)} · carte de lien ${pct(linking.length, posts.length)} · citation ${pct(posts.filter((p) => p.quote).length, posts.length)} · texte seul ${pct(posts.filter((p) => !p.images?.length && !p.video && !p.external && !p.quote).length, posts.length)} · texte < 40 car. ${pct(posts.filter((p) => (p.text || '').length < 40).length, posts.length)}`);
}

function images(name, doc) {
  head(`${name} : images`);
  const arts = flat(doc).filter((i) => i.kind === 'article');
  const no = arts.filter((a) => !a.image);
  console.log(`articles sans image : ${no.length}/${arts.length} · par source : ${count(no, (a) => a.source.name).slice(0, 20).map(([k, n]) => `${k} ${n}/${arts.filter((a) => a.source.name === k).length}`).join(' · ')}`);
  const rep = count(arts.filter((a) => a.image), (a) => a.image).filter(([, n]) => n >= 3);
  console.log(`même image sur ≥ 3 articles (logo ou image générique probable) : ${rep.length} images, ${rep.reduce((s, [, n]) => s + n, 0)} articles`);
  rep.slice(0, 20).forEach(([u, n]) => console.log(`    ×${n} ${arts.find((a) => a.image === u).source.name} · ${cut(u, 120)}`));
  const sus = arts.filter((a) => a.image && /(logo|default|placeholder|favicon|avatar|icon|og[-_]?image|social[-_]?(card|share)|share[-_]?image|opengraph|banner)/i.test(a.image));
  console.log(`URL d'image suspecte (logo, default, placeholder, og-image…) : ${sus.length}`);
  count(sus, (a) => a.source.name).slice(0, 15).forEach(([k, n]) => console.log(`    ${k} ×${n} · ${cut(sus.find((a) => a.source.name === k).image, 110)}`));
  console.log('extensions : ' + count(arts.filter((a) => a.image), (a) => (/\.(jpe?g|png|webp|avif|gif|svg)(\?|$)/i.exec(a.image)?.[1] || 'autre').toLowerCase()).map(([k, n]) => `${k} ${n}`).join(' · '));
  console.log('texte vide : ' + count(arts.filter((a) => !a.text), (a) => a.source.name).slice(0, 15).map(([k, n]) => `${k} ${n}`).join(' · '));
}

const a = overview('ACTUS', actus);
rankSim('ACTUS', actus, a.shown);
dedup('ACTUS', actus);
images('ACTUS', actus);
const t = overview('TECH', tech);
rankSim('TECH', tech, t.shown);
dedup('TECH', tech);
images('TECH', tech);

head('VIDÉOS');
const v = flat(videos);
console.log(`${v.length} vidéos · ${JSON.stringify(Object.fromEntries(count(v, (i) => i.platform + (i.tag ? '/tag' : ''))))} · sans mot-clé ${pct(v.filter((i) => !(i.keywords || []).length).length, v.length)}`);
console.log('par source : ' + count(v, (i) => (i.tag ? 'tag ' + i.tag : i.source.name)).slice(0, 40).map(([k, n]) => `${k} ${n}`).join(' · '));
const tagV = v.filter((i) => i.tag);
console.log(`vidéos de hashtags : ${tagV.length}, auteurs distincts ${new Set(tagV.map((i) => i.source.id)).size}, engagement médian ${median(tagV.map((i) => (i.stats?.likes || 0) + 2 * (i.stats?.reposts || 0)))}, sans aucun like ${pct(tagV.filter((i) => !(i.stats?.likes)).length, tagV.length)}`);
console.log('auteurs de hashtags les plus présents : ' + count(tagV, (i) => i.source.handle).slice(0, 12).map(([k, n]) => `${k} ${n}`).join(' · '));
for (let i = 0; i < tagV.length; i += Math.max(1, Math.floor(tagV.length / 25))) console.log(`  # ${tagV[i].tag} ♥${tagV[i].stats?.likes} · @${tagV[i].source.handle} · ${cut(tagV[i].text, 90)}`);
const vActusIds = new Set(flat(actus).map((i) => i.id));
console.log(`vidéos aussi présentes dans Actus : ${v.filter((i) => vActusIds.has(i.id)).length}`);
rankSim('VIDÉOS', videos, clientEntries(videos));

head('DÉCOUVRIR');
const allItems = [...flat(actus), ...flat(tech), ...v];
const sug = accounts.filter((x) => x.suggested);
console.log(`${accounts.length} comptes, ${sug.length} suggestions : ${JSON.stringify(Object.fromEntries(count(sug, (x) => x.category)))}`);
for (const s of sug) {
  const its = allItems.filter((i) => i.source.id === s.id);
  const sc = its.length ? (its.reduce((x, i) => x + Math.min(6, sum(i)), 0) / its.length).toFixed(1) : '-';
  console.log(`  ${s.category} · ${s.name} : ${its.length} éléments dans la fenêtre, score sujet moyen ${sc}, dernier post ${s.lastAt ? Math.round((now - Date.parse(s.lastAt)) / H) + ' h' : 'aucun'}`);
}
const silent = accounts.filter((x) => !x.suggested && !x.lastAt);
console.log(`comptes suivis sans aucun élément dans la fenêtre : ${silent.length} · ${silent.map((x) => x.name).join(', ')}`);
const urlsA = new Set(flat(actus).map((i) => canonicalUrl(i.url)));
console.log(`URL présentes à la fois dans Actus et Tech : ${flat(tech).filter((i) => urlsA.has(canonicalUrl(i.url))).length}`);
