#!/usr/bin/env node
// node audio/music/test_b/determinism.mjs      (about 3 minutes: one warm run with the layer cache, one COLD run without it)
// Two fresh processes render score B (cached layers vs. every instrument re-rendered); the SHA-1 of the two 32-bit float WAVs must match.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wavPath } from './util.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const score = path.join(here, '..', 'score_b.mjs');
const sha = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
const run = (label, extra) => {
  const t = Date.now();
  const r = spawnSync('nice', ['-n', '10', process.execPath, score, '--solo', ...extra], { encoding: 'utf8' });
  if (r.status !== 0) { console.error(r.stdout, r.stderr); process.exit(2); }
  const h = sha(wavPath('music_b'));
  console.log(`${label.padEnd(26)} ${h}  (${((Date.now() - t) / 1000).toFixed(0)} s)`);
  return h;
};
const a = run('warm (layer cache)', []);
const b = run('cold (--no-cache)', ['--no-cache']);
const c = run('warm again', []);
const ok = a === b && b === c;
console.log(ok ? 'PASS  bit-identical across cached / uncached / separate processes' : 'FAIL  outputs differ');
process.exit(ok ? 0 : 1);
