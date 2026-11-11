import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseShell, buildId, stampSw, stampedSw } from '../scripts/lib/stamp.mjs';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const swSource = await fs.readFile(path.join(PUBLIC, 'sw.js'), 'utf8');

async function walk(dir, base = dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full, base)));
    else out.push(path.relative(base, full));
  }
  return out;
}

test('SHELL lists exactly the files of public/ (minus data/ and sw.js itself)', async () => {
  const shell = parseShell(swSource).filter((f) => f !== './');
  const onDisk = (await walk(PUBLIC)).filter((f) => !f.startsWith('data/') && f !== 'sw.js');
  assert.deepEqual([...shell].sort(), onDisk.sort(), 'a file added to public/ must be added to SHELL (and the reverse)');
  assert.ok(parseShell(swSource).includes('./'));
});

test('the committed sw.js keeps the placeholder; stamping replaces it', async () => {
  assert.match(swSource, /const VERSION = '__BUILD_ID__';/);
  assert.match(stampSw(swSource, 'abc123'), /const VERSION = 'abc123';/);
  assert.throws(() => stampSw('nothing here', 'x'));
  assert.match(await stampedSw(PUBLIC), /const VERSION = '[0-9a-f]{12}';/);
});

test('the version follows the content of the shell: any changed file gives a new version', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tl-stamp-'));
  await fs.mkdir(path.join(dir, 'app'));
  await fs.writeFile(path.join(dir, 'index.html'), '<html>');
  await fs.writeFile(path.join(dir, 'app.js'), 'a');
  await fs.writeFile(path.join(dir, 'app', 'x.js'), 'x');
  const shell = ['./', 'index.html', 'app.js', 'app/x.js'];
  const v1 = await buildId(dir, shell);
  assert.equal(await buildId(dir, shell), v1, 'deterministic');
  assert.equal(await buildId(dir, [...shell].reverse()), v1, 'independent of the listing order');
  await fs.writeFile(path.join(dir, 'app', 'x.js'), 'y');
  const v2 = await buildId(dir, shell);
  assert.notEqual(v2, v1);
  assert.notEqual(await buildId(dir, shell.slice(0, 3)), v2, 'the file list matters too');
});

// Every module of the app must at least load: this catches a missing export or a typo in
// an import (a SyntaxError that would blank the app in the browser), and guarantees that
// no module touches the DOM when it is merely imported.
test('every ES module of public/ imports cleanly (no top-level DOM access, all named imports exist)', async () => {
  const files = (await walk(PUBLIC)).filter((f) => f.endsWith('.js') && f !== 'sw.js' && f !== 'app.js');
  assert.ok(files.length >= 25);
  for (const f of files) await import(new URL(`../public/${f}`, import.meta.url));
});
