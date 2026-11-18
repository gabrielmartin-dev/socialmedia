import { readFileSync } from 'node:fs';
const d = JSON.parse(readFileSync('public/data/videos.json', 'utf8'));
const items = d.items || d.entries || d;
console.log('keys', Object.keys(d), 'n', items.length);
const by = new Map();
for (const v of items) { const k = `${v.source?.name} | ${v.source?.id} | ${v.tag || ''}`; by.set(k, (by.get(k) || 0) + 1); }
console.log([...by].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n}\t${k}`).join('\n'));
const titles = new Map();
for (const v of items) { const t = (v.title || v.text || '').slice(0, 80).toLowerCase(); titles.set(t, [...(titles.get(t) || []), v.id + ' ' + (v.source?.name || '') + ' ' + (v.video?.src || '').slice(0, 60)]); }
console.log('--- duplicates by text');
for (const [t, ids] of titles) if (ids.length > 1) console.log(t, '\n   ', ids.join('\n    '));
console.log('--- tag videos');
for (const v of items.filter((i) => i.tag)) console.log(v.source?.name, '|', v.source?.handle, '|', v.tag, '|', (v.text || '').replace(/\s+/g, ' ').slice(0, 160));
console.log('--- all video texts mentioning right');
const re = /bardella|le pen|zemmour|retailleau|ciotti|marion|rn\b|rassemblement national|reconqu|droite|cnews|europe 1|jdd|frontières|sarkozy|wauquiez|darmanin/i;
for (const v of items) if (re.test(`${v.title} ${v.text} ${v.source?.name}`)) console.log(v.source?.name, '|', (v.title || v.text || '').replace(/\s+/g, ' ').slice(0, 160));
