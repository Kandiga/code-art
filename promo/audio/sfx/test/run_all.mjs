#!/usr/bin/env node
// Runs every sfx test in sequence (each is its own process, niced): node audio/sfx/test/run_all.mjs [--png]
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const png = process.argv.includes('--png') ? [] : ['--nopng'];
const steps = [
  ['solo (all recipes_a -> test/<id>.wav)', 'solo.mjs', png],
  ['stem checks (determinism, silence, HITS, timing)', 'stem_report.mjs', process.argv.includes('--png') ? ['--png'] : []],
  ['pitch / key checks', 'pitch_check.mjs', []],
  ['rhythm checks', 'rhythm_check.mjs', []],
  ['docs (RECIPES.md)', 'make_docs.mjs', []],
];
let bad = 0;
for (const [name, file, args] of steps) {
  console.log(`\n===== ${name} =====`);
  const r = spawnSync('nice', ['-n', '10', process.execPath, path.join(HERE, file), ...args], { stdio: 'inherit' });
  if (r.status !== 0) { bad++; console.log(`*** ${file} exited ${r.status}`); }
}
console.log(bad ? `\n${bad} step(s) failed` : '\nALL SFX TESTS PASSED');
process.exit(bad ? 1 : 0);
