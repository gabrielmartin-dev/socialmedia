#!/usr/bin/env node
// Prints the size of public/data/*.json, raw and gzipped (what GitHub Pages sends).
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const dir = process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
let totalRaw = 0;
let totalGz = 0;
for (const f of (await fs.readdir(dir)).filter((n) => n.endsWith('.json')).sort()) {
  const buf = await fs.readFile(path.join(dir, f));
  const gz = zlib.gzipSync(buf, { level: 6 }).length;
  const json = JSON.parse(buf);
  const n = json.entries?.length ?? json.accounts?.length ?? json.sources?.length ?? '';
  console.log(`${f.padEnd(14)} ${String(buf.length).padStart(9)} B  gzip ${String(gz).padStart(8)} B  ${n === '' ? '' : `(${n} entrées)`}`);
  totalRaw += buf.length; totalGz += gz;
}
console.log(`${'TOTAL'.padEnd(14)} ${String(totalRaw).padStart(9)} B  gzip ${String(totalGz).padStart(8)} B`);
