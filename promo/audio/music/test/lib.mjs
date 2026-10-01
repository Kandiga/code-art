// shared helpers for the instrument tests
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as dsp from '../../lib/dsp.mjs';
import * as meter from '../../lib/meter.mjs';
import * as ff from '../../lib/ff.mjs';
import * as th from '../../lib/theory.mjs';
import * as cues from '../../../shared/cues.js';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const OUT = HERE; // wavs + pngs land next to the tests (audio/music/test/*.wav)
export { dsp, meter, ff, th, cues };
const { BEAT, BAR } = cues;

/** the standard 4 s test phrase: motif over Am (bar 0) and over C (bar 1), with the chord held underneath */
export function phrase(inst, opt = {}) {
  const t = inst.test || {};
  const mo = (opt.motifOct != null ? opt.motifOct : t.motifOct) || 0;
  const co = (opt.chordOct != null ? opt.chordOct : t.chordOct) || 0;
  const vel = opt.vel != null ? opt.vel : 0.8;
  const notes = [];
  const chords = [['Am', 0], ['C', 1]];
  for (const [name, bar] of chords) {
    const t0 = bar * BAR;
    if (t.chord !== false) {
      for (const midi of th.chordNotes(name, 3, t.voicing || 'close')) notes.push({ t: t0, dur: BAR * 0.95, midi: midi + 12 * co, vel: vel * 0.7 });
    }
    for (const e of th.motifEvents(t0, { octave: mo, vel: (i) => vel * [1, 0.8, 0.85, 1][i] })) notes.push({ t: e.t, dur: e.dur * 0.95, midi: e.midi, vel: e.vel });
  }
  return notes;
}

export function stats(buf) {
  const m = meter.measure(buf);
  const nan = buf.L.some((v) => !Number.isFinite(v)) || buf.R.some((v) => !Number.isFinite(v));
  return { peakDb: m.samplePeakDb, rmsDb: m.rmsDb, lufs: m.integrated, momMax: m.momentaryMax, dcL: m.dcL, dcR: m.dcR, clipped: m.clipped, nan, crest: m.crestDb };
}
export const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : String(v));

/** estimate f0 (Hz) of a mono window by FFT peak picking with parabolic interpolation (lowest strong peak) */
export function estimateF0(x, startSample, N = 16384, fmin = 40, fmax = 4000) {
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / N);
    re[i] = (x[startSample + i] || 0) * w;
  }
  dsp.FFT.get(N).transform(re, im);
  const mag = new Float64Array(N / 2);
  for (let k = 0; k < N / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
  const kmin = Math.floor((fmin * N) / dsp.SR), kmax = Math.floor((fmax * N) / dsp.SR);
  let best = 0;
  for (let k = kmin; k < kmax; k++) best = Math.max(best, mag[k]);
  // lowest local maximum above 25 % of the global max (guards against a weak fundamental pick)
  for (let k = kmin + 1; k < kmax; k++) {
    if (mag[k] > 0.25 * best && mag[k] >= mag[k - 1] && mag[k] >= mag[k + 1]) {
      const a = Math.log(mag[k - 1] + 1e-30), b = Math.log(mag[k] + 1e-30), c = Math.log(mag[k + 1] + 1e-30);
      const p = (0.5 * (a - c)) / (a - 2 * b + c);
      return ((k + p) * dsp.SR) / N;
    }
  }
  return 0;
}

/** vertical contact sheet of several PNGs (ffmpeg vstack) */
export function sheet(pngs, out) {
  const args = [];
  for (const p of pngs) args.push('-i', p);
  args.push('-filter_complex', `vstack=inputs=${pngs.length}`, '-frames:v', '1', out);
  ff.run(args);
  return out;
}
