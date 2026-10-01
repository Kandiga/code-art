// node audio/music/test_a/test_determinism.mjs  - renders score A twice in fresh processes (once cold with --nocache, once reusing the layer cache)
// and compares the SHA-1 of the 60 s stems. Both must be bit-identical.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const score = path.join(here, '..', 'score_a.mjs');
const wav = path.join(here, '..', '..', 'build', 'stems', 'music_a.wav');
const sha = () => crypto.createHash('sha1').update(fs.readFileSync(wav)).digest('hex');
const run = (args) => {
  const r = spawnSync('nice', ['-n', '10', process.execPath, score, '--solo', ...args], { encoding: 'utf8' });
  if (r.status !== 0) { console.error(r.stdout, r.stderr); process.exit(2); }
  return sha();
};
const a = run(['--nocache']);
const b = run([]);
const c = run([]);
console.log('nocache :', a);
console.log('cache   :', b);
console.log('cache 2 :', c);
const ok = a === b && b === c;
console.log(ok ? 'PASS  bit-identical across processes and cache modes' : 'FAIL  outputs differ');
process.exit(ok ? 0 : 1);
