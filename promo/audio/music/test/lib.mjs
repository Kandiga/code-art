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

/** percussion test phrase: a 2-bar groove using only {t, vel, midi?} */
export function drumPhrase(id) {
  const n = [];
  const B = BEAT;
  const hits = (ts, vel = 0.9, extra = {}) => ts.forEach((t, i) => n.push({ t, vel: Array.isArray(vel) ? vel[i % vel.length] : vel, ...extra }));
  if (id === 'kick' || id === 'sub808') hits([0, 1.5 * B, 2 * B, 3.5 * B, 4 * B, 5.5 * B, 6 * B, 7.5 * B].map((x, i) => x), [1, 0.8, 0.95, 0.7], id === 'sub808' ? { dur: 0.45 } : {});
  else if (id === 'snare' || id === 'snare_gated' || id === 'clap') hits([1 * B, 3 * B, 5 * B, 7 * B, 7.5 * B], [0.95, 0.9, 0.95, 0.5, 0.75]);
  else if (id === 'hat') { for (let i = 0; i < 16; i++) n.push({ t: i * B / 2, vel: i % 2 ? 0.45 : 0.8, open: i === 7 || i === 15, dur: 0.3 }); }
  else if (id === 'toms') { /* below */ }
  else if (id === 'cymbal') { n.push({ t: 0, vel: 0.9, dur: 3 }); n.push({ t: 3.0, vel: 0.9, dur: 2.0, swell: true }); }
  else hits([0, 2 * B, 4 * B, 6 * B], [1, 0.8, 0.9, 0.7]);
  if (id === 'toms') { n.length = 0; [57, 55, 52, 48, 45].forEach((m, i) => n.push({ t: i * 0.25, vel: 0.9, midi: m, pan: -0.5 + i * 0.25 })); }
  return n;
}

/** reference passage for calibration: 4 spaced notes (pitched), the drum phrase (drums), or testNotes (fx) */
export function refNotes(inst) {
  if (inst.kind === 'fx' && inst.testNotes) return inst.testNotes();
  if (inst.kind === 'drum' && !['timpani', 'taiko'].includes(inst.id)) return drumPhrase(inst.id);
  if (inst.id === 'shimmer' || inst.id === 'drone') {
    const lo = inst.range[0], hi = inst.range[1], mid = Math.round((lo + hi) / 2);
    return [mid - 5, mid, mid + 4].map((m, i) => ({ t: i * 4.5, dur: 3.5, midi: m, vel: 0.8 }));
  }
  const lo = inst.range ? inst.range[0] : 48, hi = inst.range ? inst.range[1] : 84;
  const mid = Math.round((lo + hi) / 2);
  const midis = [mid - 7, mid, mid + 4, mid + 9].map((m) => Math.min(hi, Math.max(lo, m)));
  const dur = inst.defaultDur != null ? Math.max(0.3, Math.min(inst.defaultDur, 1.2)) : 1.0;
  return midis.map((m, i) => ({ t: i * 2.2, dur: inst.kind === 'drum' ? 0.5 : dur > 0.5 ? 1.2 : dur, midi: m, vel: 0.8 }));
}

/** targets (integrated LUFS of the reference passage at gainDb 0 after calibration) */
export const LUFS_TARGET = {
  kick: -22, snare: -24, snare_gated: -23, hat: -32, clap: -25, toms: -25, timpani: -24, taiko: -22, sub808: -24, cymbal: -29,
  riser: -27, reverse_swell: -28, sub_drop: -24, braam: -20, impact: -20, tape_rewind: -33, shimmer: -28,
};
export const DEFAULT_TARGET = -26;
