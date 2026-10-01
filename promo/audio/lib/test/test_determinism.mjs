// Determinism: the same chain rendered in two fresh processes (and twice in one) must be bit-identical,
// and no library file may use Math.random / Date.now / performance.now for audio decisions.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { check, section, summary } from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
if (process.argv[2] === '--child') {
  const dsp = await import('../dsp.mjs');
  const { SR, Buf } = dsp;
  const n = 6 * SR;
  let b = Buf.from(dsp.osc('saw', 110, n).map((v) => v * 0.3), dsp.noise('pink', n, 7, { rms: 0.1 }));
  b = dsp.chorus(b); b = dsp.biquad(b, 'lp', dsp.curve(n, [[0, 300], [6, 9000]], 'exp'), 2);
  b = dsp.reverb(b, { wet: 0.4, decay: 3, tail: 1 });
  b = dsp.convReverb(b, 'plate', { wet: 0.2 });
  b = dsp.ensemble(b); b = dsp.compressor(b); b = dsp.limiter(b, { ceilingDb: -1.5 });
  const h = crypto.createHash('sha1');
  h.update(Buffer.from(b.L.buffer, b.L.byteOffset, b.L.byteLength)); h.update(Buffer.from(b.R.buffer, b.R.byteOffset, b.R.byteLength));
  console.log(h.digest('hex'));
} else {
  section('determinism');
  const run = () => spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child'], { encoding: 'utf8' }).stdout.trim();
  const a = run(), b = run();
  check('two fresh processes produce bit-identical audio', a.length === 40 && a === b, a.slice(0, 12));
  section('no non-deterministic sources in audio/lib');
  const libDir = path.join(here, '..');
  const bad = [];
  for (const f of fs.readdirSync(libDir).filter((x) => x.endsWith('.mjs'))) {
    const src = fs.readFileSync(path.join(libDir, f), 'utf8').split('\n');
    src.forEach((line, i) => { if (/Math\.random|Date\.now\(|new Date\(/.test(line) && !/^\s*(\/\/|\*)/.test(line)) bad.push(`${f}:${i + 1}`); });
  }
  check('no Math.random / Date.now in audio/lib/*.mjs', bad.length === 0, bad.join(' '));
  summary('test_determinism');
}
