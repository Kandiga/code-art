#!/usr/bin/env node
// Runs the recipes_b test suite: solo renders (+ metrics), pitch checks, whole-stem checks. Exit code != 0 on any failure.
//   node audio/sfx/test_b/run_all.mjs [--png]
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const png = process.argv.includes('--png');
let bad = 0;
for (const [name, args] of [['solo_b.mjs', png ? ['--bands'] : ['--nopng', '--bands']], ['pitch_b.mjs', []], ['stem_b.mjs', png ? ['--png'] : []]]) {
  console.log(`\n=== ${name} ===`);
  const r = spawnSync('nice', ['node', path.join(HERE, name), ...args], { stdio: 'inherit' });
  if (r.status !== 0) bad++;
}
console.log(bad ? `\n${bad} test script(s) failed` : '\nrecipes_b: all test scripts passed');
process.exit(bad ? 1 : 0);
