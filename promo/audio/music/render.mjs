#!/usr/bin/env node
// =============================================================================
// audio/music/render.mjs - the music stem:  export async function renderMusic() -> audio/build/stems/music.wav
//
//   1. a 60 s Buf (48 kHz stereo float32)
//   2. renderScoreA(buf, ctx)   (audio/music/score_a.mjs, t < 26 - if the file exists)
//   3. renderScoreB(buf, ctx)   (audio/music/score_b.mjs, t >= 26)
//   4. gentle master bus: glue compressor (1.6:1) + safety true-peak limiter, peak <= -2 dBFS (masterBus in score_b.mjs)
//   5. contract guards: the film's held breath 22.0-22.5 is digital silence, last sample of the stem is ~0
//   6. writes the 32-bit float WAV, exactly 60.000 s = 2 880 000 samples
//
//   node audio/music/render.mjs            (CLI)       |    import { renderMusic } from './render.mjs'   (build.mjs)
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as dsp from '../lib/dsp.mjs';
import * as meter from '../lib/meter.mjs';
import * as cues from '../../shared/cues.js';
import { stemPath, ensure, STEMS } from '../lib/paths.mjs';
import { renderScoreB, masterBus } from './score_b.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SILENCE = { t0: cues.SECTIONS.find((s) => s.id === 'turn').t0, t1: cues.MUSIC.sections.find((s) => s.id === 'turn').t0 + cues.BEAT }; // 22.0 .. 22.5

/** zero the half-open window [t0,t1) (with a 2 ms fade into it) and report what was there */
function silenceWindow(buf, t0, t1) {
  const a = Math.round(t0 * dsp.SR), b = Math.round(t1 * dsp.SR), f = Math.round(0.002 * dsp.SR);
  let pk = 0;
  for (let i = a; i < Math.min(b, buf.length); i++) pk = Math.max(pk, Math.abs(buf.L[i]), Math.abs(buf.R[i]));
  for (const ch of [buf.L, buf.R]) {
    for (let i = Math.max(0, a - f); i < a; i++) ch[i] *= 0.5 + 0.5 * Math.cos((Math.PI * (i - (a - f) + 0.5)) / f);
    ch.fill(0, a, Math.min(b, ch.length));
  }
  return dsp.linToDb(pk);
}

export async function renderMusic(opts = {}) {
  const log = opts.log === false ? () => {} : opts.log || console.log;
  const t0 = Date.now();
  const buf = new dsp.Buf(cues.DURATION);
  const ctx = { log, cache: opts.cache !== false };

  // ---- score A (t < 26), optional while the other composer is still writing it
  const fa = path.join(HERE, 'score_a.mjs');
  let haveA = false;
  if (fs.existsSync(fa)) {
    const A = await import(pathToFileURL(fa).href);
    if (typeof A.renderScoreA === 'function') {
      await A.renderScoreA(buf, ctx);
      haveA = true;
    } else log('[music] WARNING: score_a.mjs does not export renderScoreA(buf, ctx)');
  } else log('[music] note: audio/music/score_a.mjs not found - rendering score B only');

  // ---- score B (t >= 26)
  renderScoreB(buf, ctx);

  // ---- master
  const out = masterBus(buf);
  const pkInSilence = silenceWindow(out, SILENCE.t0, SILENCE.t1);
  if (pkInSilence > -90) log(`[music] note: ${pkInSilence.toFixed(1)} dBFS found in the 22.0-22.5 silence window (score A tail?) - zeroed`);
  // the last sample is silence (the stem ends on a faded tail, never on a cut)
  out.L[out.length - 1] = 0; out.R[out.length - 1] = 0;

  ensure(STEMS);
  const file = stemPath('music');
  dsp.writeWav(file, out);
  const m = meter.measure(out);
  log(`[music] ${path.relative(process.cwd(), file)}  ${out.seconds.toFixed(3)} s  A:${haveA ? 'yes' : 'no'}  peak ${m.samplePeakDb.toFixed(2)} dBFS  true peak ${m.truePeakDb.toFixed(2)} dBTP  integrated ${m.integrated.toFixed(1)} LUFS  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  return file;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  renderMusic({ cache: !process.argv.includes('--no-cache') }).catch((e) => { console.error(e); process.exit(1); });
}
