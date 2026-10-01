// shared helpers for the score-B tests (all numbers; no playback exists in this environment)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as dsp from '../../lib/dsp.mjs';
import * as meter from '../../lib/meter.mjs';
import * as ff from '../../lib/ff.mjs';
import * as cues from '../../../shared/cues.js';
import { TMP, stemPath, ensure } from '../../lib/paths.mjs';

export { dsp, meter, ff, cues };
export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const OUT = ensure(path.join(TMP, 'score_b'));
export const { SR } = dsp;
export const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : String(v));
export const pad = (s, n) => String(s).padEnd(n);
export const lpad = (s, n) => String(s).padStart(n);
export const wavPath = (name = 'music_b') => stemPath(name);
export const load = (name) => dsp.readWav(name.endsWith('.wav') ? name : wavPath(name));
export const mono = (b) => Float32Array.from(b.L, (v, i) => 0.5 * (v + b.R[i]));

/** rectified, hp-filtered, 0.5 ms-smoothed envelope + its 0.5 ms derivative -> times of the strongest rise near t */
export function onsetNear(x, t, { pre = 0.03, post = 0.03, hpHz = 150 } = {}) {
  const a = Math.max(0, Math.round((t - pre - 0.05) * SR)), b = Math.min(x.length, Math.round((t + post + 0.05) * SR));
  const seg = dsp.biquad(x.slice(a, b), 'hp', hpHz, 0.7);
  const w = 24; // 0.5 ms
  const env = new Float32Array(seg.length);
  let acc = 0;
  for (let i = 0; i < seg.length; i++) {
    acc += Math.abs(seg[i]);
    if (i >= w) acc -= Math.abs(seg[i - w]);
    env[i] = acc / w;
  }
  let best = -1, bi = 0;
  const lo = Math.round((t - pre) * SR) - a, hi = Math.round((t + post) * SR) - a;
  for (let i = Math.max(w, lo); i < Math.min(env.length - 1, hi); i++) {
    const d = env[i + w] - env[i]; // rise over the next 0.5 ms
    if (d > best) { best = d; bi = i; }
  }
  // refine: first sample after bi - w where env exceeds 40 % of the local rise top
  const top = env[Math.min(env.length - 1, bi + 2 * w)];
  let j = Math.max(0, bi - 3 * w);
  while (j < bi + w && env[j] < 0.4 * top) j++;
  return { t: (a + j) / SR, offsetMs: ((a + j) / SR - t) * 1000, slope: best, top };
}

/** loudest-rise onset time inside [t0,t1] on the full-band envelope (for the final hit) */
export function riseTime(x, t0, t1, frac = 0.2) {
  const a = Math.round(t0 * SR), b = Math.round(t1 * SR);
  const w = 48;
  const env = new Float32Array(b - a);
  let acc = 0;
  for (let i = 0; i < b - a; i++) {
    acc += Math.abs(x[a + i]);
    if (i >= w) acc -= Math.abs(x[a + i - w]);
    env[i] = acc / w;
  }
  let mx = 0;
  for (let i = 0; i < env.length; i++) mx = Math.max(mx, env[i]);
  for (let i = 0; i < env.length; i++) if (env[i] >= frac * mx) return { t: (a + i) / SR, max: mx };
  return { t: NaN, max: mx };
}

/** chroma (12 pitch-class energies, normalised) of a time window: FFT frames of the mono mix, 80..4000 Hz */
export function chroma(x, t0, t1, N = 16384) {
  const c = new Float64Array(12);
  const hop = N / 2;
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / N);
  const fft = dsp.FFT.get ? dsp.FFT.get(N) : new dsp.FFT(N);
  for (let s = Math.round(t0 * SR); s + N <= Math.round(t1 * SR); s += hop) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = (x[s + i] || 0) * win[i];
    fft.transform(re, im);
    for (let k = 1; k < N / 2; k++) {
      const fr = (k * SR) / N;
      if (fr < 160 || fr > 3500) continue;
      const m = 69 + 12 * Math.log2(fr / 440);
      const pc = ((Math.round(m) % 12) + 12) % 12;
      const dev = Math.abs(m - Math.round(m));
      if (dev > 0.35) continue; // only bins near a semitone centre (reject in-between noise)
      c[pc] += re[k] * re[k] + im[k] * im[k];
    }
  }
  const sum = c.reduce((a, b) => a + b, 0) || 1;
  return Array.from(c, (v) => v / sum);
}
export const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const MAJOR = new Set([0, 2, 4, 5, 7, 9, 11]);
