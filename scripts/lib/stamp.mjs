// Service worker versioning without a bundler: the version is a hash of the shell files.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const VERSION_RE = /const VERSION = '[^']*';/;

/** The SHELL array of sw.js, as a list of paths relative to public/. */
export function parseShell(swSource) {
  const m = /const SHELL = \[([\s\S]*?)\];/.exec(swSource);
  if (!m) throw new Error('SHELL introuvable dans sw.js');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

/** Hash of the names and contents of the shell files ('./' is index.html). */
export async function buildId(publicDir, shell) {
  const hash = crypto.createHash('sha256');
  const files = [...new Set(shell.map((f) => (f === './' ? 'index.html' : f)))].sort();
  for (const f of files) {
    hash.update(`\0${f}\0`);
    hash.update(await fs.readFile(path.join(publicDir, f)));
  }
  return hash.digest('hex').slice(0, 12);
}

export function stampSw(swSource, id) {
  if (!VERSION_RE.test(swSource)) throw new Error('const VERSION introuvable dans sw.js');
  return swSource.replace(VERSION_RE, `const VERSION = '${id}';`);
}

/** sw.js content stamped with the hash of the files currently in `publicDir`. */
export async function stampedSw(publicDir) {
  const source = await fs.readFile(path.join(publicDir, 'sw.js'), 'utf8');
  return stampSw(source, await buildId(publicDir, parseShell(source)));
}
