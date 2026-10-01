#!/usr/bin/env node
// Rhythm checks: projector frame rate spin-up (0 -> 24 Hz), steam-chuff acceleration, hand-crank tempo,
// laser zap pitch drop, label of the film's held breath. node audio/sfx/test/rhythm_check.mjs
import * as dsp from '../../lib/dsp.mjs';
import * as cues from '../../../shared/cues.js';
import { renderEvent } from '../index.mjs';

const { SR } = dsp;
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}`); };
function solo(id, nth = 0) {
  const ev = cues.SFX.filter((e) => e.id === id)[nth];
  const r = renderEvent(ev, nth, cues);
  return Float32Array.from(r.buf.L, (v, i) => 0.5 * (v + r.buf.R[i]));
}
/** transient onsets: envelope of the high band, local maxima above a fraction of the running max, min spacing */
function onsets(x, hpHz = 1500, minGapMs = 14, thr = 0.12) {
  const h = dsp.biquad(dsp.biquad(x, 'hp', hpHz, 0.7), 'hp', hpHz, 0.7);
  const e = new Float32Array(h.length);
  let y = 0;
  const k = Math.exp(-1 / (0.0015 * SR));
  for (let i = 0; i < h.length; i++) { const a = Math.abs(h[i]); y = a > y ? a : y * k; e[i] = y; }
  let mx = 0;
  for (let i = 0; i < e.length; i++) mx = Math.max(mx, e[i]);
  const out = [];
  let last = -1e9;
  const gap = (minGapMs / 1000) * SR;
  for (let i = 1; i < e.length - 1; i++) {
    if (e[i] > e[i - 1] && e[i] >= e[i + 1] && e[i] > thr * mx && i - last > gap) { out.push(i / SR); last = i; }
  }
  return out;
}
/** chuffs = peaks of the 0.5-2.5 kHz steam-burst envelope, min gap 80 ms (the sub-bass rail rumble is excluded) */
function chuffOnsets(x) {
  const h = dsp.biquad(dsp.biquad(x, 'hp', 500, 0.7), 'lp', 2500, 0.7);
  const e = new Float32Array(h.length);
  let y = 0;
  const ka = Math.exp(-1 / (0.004 * SR)), kr = Math.exp(-1 / (0.02 * SR));
  for (let i = 0; i < h.length; i++) { const a = Math.abs(h[i]); y = a > y ? a + (y - a) * ka : y * kr; e[i] = y; }
  let mx = 0;
  for (let i = 0; i < e.length; i++) mx = Math.max(mx, e[i]);
  const out = [];
  let last = -1e9;
  for (let i = 2; i < e.length - 2; i++) if (e[i] > e[i - 1] && e[i] >= e[i + 1] && e[i] > 0.3 * mx && i - last > 0.1 * SR) { out.push(i / SR); last = i; }
  return out;
}
const rate = (ons, a, b) => ons.filter((t) => t >= a && t < b).length / (b - a);

// --- projector: frame ticks accelerate from ~0 to 24 fps by t = spinUp (2 s), then hold
{
  const x = solo('projector_motor');
  const o = onsets(x, 1800, 30, 0.15);
  const r1 = rate(o, 0.1, 0.6), r2 = rate(o, 1.0, 1.4), r3 = rate(o, 2.4, 3.2);
  console.log(`projector_motor tick rate: 0.1-0.6 s ${r1.toFixed(1)}/s | 1.0-1.4 s ${r2.toFixed(1)}/s | 2.4-3.2 s ${r3.toFixed(1)}/s  (${o.length} onsets)`);
  ok(r1 < 12 && r2 > r1 && r3 > r2 - 1, 'frame-tick rate rises through the spin-up and settles');
  ok(r3 > 18 && r3 < 30, `steady-state rate ~24 fps (measured ${r3.toFixed(1)})`);
  // the rattle's modulation spectrum has a line at 24 Hz in the steady section
  const h = dsp.biquad(x, 'hp', 800, 0.7);
  const env = new Float32Array(h.length);
  let y = 0;
  const kk = Math.exp(-1 / (0.004 * SR));
  for (let i = 0; i < h.length; i++) { const a = Math.abs(h[i]); y = a > y ? a : y * kk; env[i] = y; }
  const N = 65536, st = Math.round(2.3 * SR);
  const mag = dsp.magSpectrum(env, N, st, true);
  let best = 0, bf = 0;
  for (let k = Math.round(10 * N / SR); k < Math.round(60 * N / SR); k++) if (mag[k] > best) { best = mag[k]; bf = (k * SR) / N; }
  console.log(`  modulation line of the rattle in 2.3-3.35 s: ${bf.toFixed(1)} Hz`);
  ok(Math.abs(bf - 24) < 1.5 || Math.abs(bf - 48) < 2 || Math.abs(bf - 12) < 1, 'rattle modulation is locked to the 24 Hz frame rate (or 48/12 Hz harmonics)');
  let pk = 0; for (let i = 0; i < Math.round(0.02 * SR); i++) pk = Math.max(pk, Math.abs(x[i]));
  ok(pk < 0.2, 'motor starts from near silence (first 20 ms peak < 0.2 of full-scale)');
}
// --- steam chuffs: intervals shorten as the train arrives
{
  const x = solo('train_chuff');
  const o = chuffOnsets(x).filter((t) => t < 1.4);
  const gaps = o.slice(1).map((t, i) => t - o[i]);
  console.log(`train_chuff onsets ${o.map((t) => t.toFixed(2)).join(' ')}`);
  ok(o.length >= 6 && gaps[gaps.length - 1] < gaps[0] * 0.8, 'chuffs accelerate (last gap < 0.8 x first gap)');
}
// --- hand crank ~16 clicks per second, human drift
{
  const x = solo('crank_loop');
  const o = onsets(x, 1800, 35, 0.22).filter((t) => t > 0.2 && t < 1.45);
  const r = o.length / 1.25;
  console.log(`crank_loop: ${o.length} ticks in 1.25 s = ${r.toFixed(1)}/s`);
  ok(r > 11 && r < 22, 'crank ratchet rate 11-22 ticks/s');
}
// --- laser: pitch falls > 3 octaves in the first 150 ms, each zap higher than the last
{
  const f = (nth) => { const x = solo('laser_zap', nth); const N = 1024; const m0 = dsp.magSpectrum(x, N, 0), m1 = dsp.magSpectrum(x, N, Math.round(0.12 * SR)); const pk = (m) => { let b = 0, bi = 0; for (let k = 6; k < 400; k++) if (m[k] > b) { b = m[k]; bi = k; } return (bi * SR) / N; }; return [pk(m0), pk(m1)]; };
  const z = [0, 1, 2].map(f);
  console.log('laser_zap start/end peak freq:', z.map((p) => p.map((v) => v.toFixed(0)).join('->')).join(' | '));
  ok(z.every(([a, b]) => a > 1.5 * b), 'every zap falls in pitch');
}
console.log(fails ? `\n${fails} FAILED` : '\nall rhythm checks passed');
process.exit(fails ? 1 : 0);
