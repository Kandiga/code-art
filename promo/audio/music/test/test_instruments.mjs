// node audio/music/test/test_instruments.mjs [ids...]
// Hygiene (NaN / peak / clipping / DC / start+end clicks), determinism, pitch accuracy, onset alignment, sub-bass content,
// velocity -> level/brightness, register extremes - for every instrument.
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as inst from '../instruments.mjs';
import { dsp, meter, f, estimateF0, refNotes } from './lib.mjs';
import { check, section, summary } from '../../lib/test/harness.mjs';
const { SR } = dsp;

const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const todo = ids.length ? ids : inst.list();
const hash = (buf) => crypto.createHash('md5').update(Buffer.from(buf.L.buffer, buf.L.byteOffset, buf.L.byteLength)).update(Buffer.from(buf.R.buffer, buf.R.byteOffset, buf.R.byteLength)).digest('hex').slice(0, 12);

const mid = (I) => (I.range ? Math.round((I.range[0] + I.range[1]) / 2) : 60);
const note = (I, o = {}) => {
  if (I.kind === 'fx' && I.testNotes) return I.testNotes().map((n) => ({ ...n, t: n.t - I.testNotes()[0].t + 0.5, vel: o.vel != null ? o.vel : n.vel }));
  return [{ t: 0.5, dur: o.dur != null ? o.dur : I.kind === 'drum' ? 0.5 : 1.5, midi: o.midi != null ? o.midi : I.defaultMidi != null && I.kind === 'drum' ? I.defaultMidi : mid(I), vel: o.vel != null ? o.vel : 0.8 }];
};
const centroid = (buf) => {
  const N = 8192; const re = new Float64Array(N), im = new Float64Array(N);
  let start = Math.round(0.5 * SR);
  let best = 0, bs = start;
  for (let s = start; s + N < buf.length; s += N / 2) { let e = 0; for (let i = 0; i < N; i++) e += buf.L[s + i] ** 2; if (e > best) { best = e; bs = s; } }
  for (let i = 0; i < N; i++) re[i] = buf.L[bs + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  dsp.FFT.get(N).transform(re, im);
  let num = 0, den = 0;
  for (let k = 1; k < N / 2; k++) { const m = Math.hypot(re[k], im[k]); num += m * m * k; den += m * m; }
  return (num / den) * (SR / N);
};
const hfRatioDb = (buf, hz = 3000) => {
  const N = 8192; const re = new Float64Array(N), im = new Float64Array(N);
  let best = 0, bs = Math.round(0.4 * SR);
  for (let s = Math.round(0.4 * SR); s + N < buf.length; s += N / 2) { let e = 0; for (let i = 0; i < N; i++) e += buf.L[s + i] ** 2; if (e > best) { best = e; bs = s; } }
  for (let i = 0; i < N; i++) re[i] = buf.L[bs + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  dsp.FFT.get(N).transform(re, im);
  let tot = 0, hi = 0;
  for (let k = 1; k < N / 2; k++) { const p = re[k] ** 2 + im[k] ** 2; tot += p; if ((k * SR) / N > hz) hi += p; }
  return 10 * Math.log10((hi + 1e-30) / (tot + 1e-30));
};
const bandRatioDb = (buf, hz) => { // energy below hz relative to total (dB)
  const N = 32768; const re = new Float64Array(N), im = new Float64Array(N);
  let tot = 0, low = 0;
  for (let s = 0; s + N <= buf.length; s += N) {
    for (let i = 0; i < N; i++) re[i] = buf.L[s + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)), im[i] = 0;
    dsp.FFT.get(N).transform(re, im);
    for (let k = 1; k < N / 2; k++) { const p = re[k] ** 2 + im[k] ** 2; tot += p; if ((k * SR) / N < hz) low += p; }
  }
  return 10 * Math.log10((low + 1e-30) / (tot + 1e-30));
};

// instruments where the fundamental is NOT the dominant spectral peak by design, or whose pitch is inherently ambiguous
const PITCH_TOL = { piano: 28, piano_grand: 12, musicbox: 14, celesta: 14, harp: 12, strings: 18, strings_low: 18, strings_high: 18, strings_pizz: 12, trumpets: 16, horns: 16, brass_low: 16, flute: 20, clarinet: 16, choir: 25, timpani: 20, taiko: 30, toms: 25, sub808: 12, kick: 20, synth_pulse: 14, synth_bass: 12, synth_pad: 22, fm_bell: 14, supersaw: 20, drone: 14, shimmer: 22 };
const ENSEMBLE = ['choir', 'synth_pad', 'shimmer', 'drone', 'strings', 'strings_low', 'strings_high'];
const PITCH_START = { piano: 0.2, piano_grand: 0.2, musicbox: 0.15, celesta: 0.15, harp: 0.2, strings_pizz: 0.12, timpani: 0.3, taiko: 0.25, toms: 0.12, kick: 0.15, sub808: 0.2, synth_pulse: 0.1, fm_bell: 0.25, supersaw: 0.12, synth_bass: 0.15, drone: 1.6, shimmer: 1.8, choir: 1.4, strings: 1.0, strings_low: 1.0, strings_high: 1.0, trumpets: 0.5, horns: 0.6, brass_low: 0.6, flute: 0.5, clarinet: 0.4, synth_pad: 1.2 };

section('hygiene, timing, pitch');
const rows = [];
for (const id of todo) {
  const I = inst.INSTRUMENTS[id];
  const nn = note(I, { vel: 1 });
  const b1 = I.render(nn, { seconds: 14 });
  const m = meter.measure(b1);
  const nan = b1.L.some((v) => !Number.isFinite(v)) || b1.R.some((v) => !Number.isFinite(v));
  check(`${id}: finite`, !nan);
  check(`${id}: peak <= -1 dBFS at vel 1`, m.samplePeakDb <= -1, f(m.samplePeakDb) + ' dBFS');
  check(`${id}: no DC`, Math.max(Math.abs(m.dcL), Math.abs(m.dcR)) < 2e-3, Math.max(Math.abs(m.dcL), Math.abs(m.dcR)).toExponential(1));
  // start / end clicks
  const pk = Math.max(meter.peakDb(b1) > -200 ? dsp.peakOf(b1) : 1e-9, 1e-9);
  const t0 = Math.round(0.5 * SR);
  let pre = 0;
  for (let i = 0; i < t0 - 400; i++) pre = Math.max(pre, Math.abs(b1.L[i]), Math.abs(b1.R[i]));
  const first = Math.max(Math.abs(b1.L[t0] || 0), Math.abs(b1.R[t0] || 0));
  // find the end of sound
  let end = b1.length - 1;
  while (end > 0 && Math.abs(b1.L[end]) < 1e-6 && Math.abs(b1.R[end]) < 1e-6) end--;
  const endAmp = Math.max(...Array.from({ length: 16 }, (_, k) => Math.abs(b1.L[Math.max(0, end - k)])));
  check(`${id}: clean start (first sample ~0)`, I.kind === 'fx' || first / pk < 0.02 || pre > 0, `${(first / pk).toExponential(1)} of peak`);
  check(`${id}: clean end (fades to < -60 dB before the end of the sound)`, ['reverse_swell', 'riser'].includes(id) ? end < b1.length - 2 : end >= b1.length - 2 ? false : endAmp / pk < 1e-3, `${(20 * Math.log10(endAmp / pk + 1e-12)).toFixed(0)} dB re peak`);
  // determinism (in-process)
  const b2 = I.render(nn, { seconds: 14 });
  check(`${id}: deterministic`, hash(b1) === hash(b2));
  // sub content
  const sub = bandRatioDb(b1, 30);
  const subOk = ['sub808', 'sub_drop', 'kick', 'taiko', 'timpani', 'impact', 'braam', 'drone', 'synth_bass', 'brass_low', 'strings_low'].includes(id) ? true : sub < -26;
  check(`${id}: no excessive sub-30 Hz energy`, subOk, `${f(sub)} dB re total`);
  rows.push({ id, peak: m.samplePeakDb, sub });
}

section('pitch accuracy (dominant partial near the expected fundamental)');
for (const id of todo) {
  const I = inst.INSTRUMENTS[id];
  if (!(id in PITCH_TOL)) continue;
  const lo = I.range ? I.range[0] : 48, hi = I.range ? I.range[1] : 84;
  const midis = [...new Set([lo + 3, Math.round(lo + (hi - lo) * 0.4), Math.round(lo + (hi - lo) * 0.7), hi - 4])].filter((x) => !(id === 'musicbox' && x > 100));
  const worst = { c: 0, m: 0 };
  for (const mm of midis) {
    const dur = ['drone', 'shimmer'].includes(id) ? 3.5 : 2.5;
    const b = I.render([{ t: 0.0, dur, midi: mm, vel: 0.8 }], { seconds: dur + 3 });
    const fE = dsp.midiToHz(mm);
    const start = Math.round((PITCH_START[id] || 0.5) * SR);
    const N = fE < 100 ? 65536 : 16384;
    // peak-pick near expected: search +-80 cents in the magnitude spectrum, parabolic interpolation
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = (b.L[start + i] + b.R[start + i]) * 0.5 * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
    dsp.FFT.get(N).transform(re, im);
    const mag = (k) => Math.hypot(re[k], im[k]);
    const kc = (fE * N) / SR, k0 = Math.floor(kc * 0.955), k1 = Math.ceil(kc * 1.045);
    let kb = k0;
    for (let k = k0; k <= k1; k++) if (mag(k) > mag(kb)) kb = k;
    const a = Math.log(mag(kb - 1) + 1e-30), bb = Math.log(mag(kb) + 1e-30), c = Math.log(mag(kb + 1) + 1e-30);
    let fm = ((kb + (0.5 * (a - c)) / (a - 2 * bb + c)) * SR) / N;
    if (ENSEMBLE.includes(id)) {
      // detuned / vibrato ensembles have no single line: power-weighted mean frequency around harmonics 1..6 (+-70 cents windows)
      let sumC = 0, sumW = 0;
      for (let h = 1; h <= 6; h++) {
        const kh0 = Math.floor(((fE * h) * N / SR) * 0.96), kh1 = Math.ceil(((fE * h) * N / SR) * 1.04);
        let pw = 0, pf = 0;
        for (let k = kh0; k <= kh1; k++) { const p = mag(k) ** 2; pw += p; pf += p * ((k * SR) / N); }
        if (pw > 0) { sumC += pw * 1200 * Math.log2(pf / pw / (fE * h)); sumW += pw; }
      }
      fm = fE * Math.pow(2, sumC / sumW / 1200);
    }
    let gmax = 0;
    for (let k = 2; k < N / 2; k++) gmax = Math.max(gmax, mag(k));
    const rel = 20 * Math.log10(mag(kb) / gmax);
    const cents = 1200 * Math.log2(fm / fE);
    if (Math.abs(cents) > Math.abs(worst.c)) { worst.c = cents; worst.m = mm; }
    if (rel < -24) { check(`${id}: fundamental present @ midi ${mm}`, false, `${f(rel)} dB re strongest partial`); }
  }
  check(`${id}: pitch within ${PITCH_TOL[id]} cents (worst ${f(worst.c)} @ midi ${worst.m})`, Math.abs(worst.c) <= PITCH_TOL[id]);
}

section('onset alignment (time when the note reaches -6 dB of its peak envelope, vs. t)');
for (const id of todo) {
  const I = inst.INSTRUMENTS[id];
  if (I.kind === 'fx') continue;
  const t = 1.0;
  const nn = note(I, { vel: 0.8 }).map((n) => ({ ...n, t, dur: Math.max(n.dur, 1.2) }));
  const b = I.render(nn, { seconds: 7 });
  const w = Math.round(0.01 * SR);
  const env = [];
  for (let s = 0; s + w < b.length; s += w) { let e = 0; for (let i = 0; i < w; i++) e += b.L[s + i] ** 2 + b.R[s + i] ** 2; env.push(Math.sqrt(e / (2 * w))); }
  const pkE = Math.max(...env.slice(0, Math.round(3.5 / 0.01)));
  let k = 0;
  while (k < env.length && env[k] < pkE * 0.5) k++;
  const on = k * 0.01 - t;
  const slow = ['strings', 'strings_low', 'strings_high', 'strings_tremolo', 'choir', 'synth_pad', 'drone', 'shimmer', 'horns'].includes(id);
  check(`${id}: -6 dB point at ${on >= 0 ? '+' : ''}${(on * 1000).toFixed(0)} ms from t`, slow ? Math.abs(on) < 0.3 : on > -0.02 && on < 0.15);
}

section('velocity: louder and brighter');
for (const id of todo) {
  const I = inst.INSTRUMENTS[id];
  if (I.kind === 'fx') continue;
  const lo = I.render(note(I, { vel: 0.3 }), { seconds: 6 }), hi = I.render(note(I, { vel: 0.95 }), { seconds: 6 });
  const dl = meter.rmsDb(hi) - meter.rmsDb(lo);
  check(`${id}: vel 0.95 louder than vel 0.3 by ${f(dl)} dB`, dl > 2.5 && dl < 24);
  if (['piano', 'piano_grand', 'trumpets', 'horns', 'brass_low', 'strings', 'synth_pulse', 'snare', 'harp'].includes(id)) {
    const cl = hfRatioDb(lo), ch = hfRatioDb(hi);
    check(`${id}: brightness follows velocity (energy above 3 kHz ${f(cl)} -> ${f(ch)} dB re total)`, ch > cl + 1.0);
  }
}

section('register extremes render cleanly');
for (const id of todo) {
  const I = inst.INSTRUMENTS[id];
  if (!I.range) continue;
  for (const mm of [I.range[0], I.range[1]]) {
    const b = I.render([{ t: 0.2, dur: 1.2, midi: mm, vel: 1 }], { seconds: 5 });
    const nan = b.L.some((v) => !Number.isFinite(v));
    const pkdb = meter.peakDb(b);
    check(`${id} @ midi ${mm}: finite, peak ${f(pkdb)} dBFS < 0`, !nan && pkdb < 0 && pkdb > -60);
  }
}

if (!ids.length || ids.includes('--xproc')) {
  section('cross-process determinism (fresh node processes)');
  const script = fileURLToPath(new URL('./hash_one.mjs', import.meta.url));
  for (const id of ['piano', 'strings', 'choir', 'braam', 'riser', 'tape_rewind', 'brass_low', 'shimmer']) {
    const a = spawnSync('node', [script, id], { encoding: 'utf8' }).stdout.trim();
    const b = spawnSync('node', [script, id], { encoding: 'utf8' }).stdout.trim();
    check(`${id}: identical hash across processes (${a})`, a && a === b);
  }
}
summary('instrument tests');
