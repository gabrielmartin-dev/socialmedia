#!/usr/bin/env node
// Stamps public/sw.js with a version derived from the content of the shell files.
// Run by the workflow right before the Pages artifact is uploaded.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stampedSw } from './lib/stamp.mjs';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const out = await stampedSw(PUBLIC);
await fs.writeFile(path.join(PUBLIC, 'sw.js'), out);
console.log(`sw.js : ${/const VERSION = '([^']*)'/.exec(out)[1]}`);
