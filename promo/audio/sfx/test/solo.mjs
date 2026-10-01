#!/usr/bin/env node
// Render recipes SOLO (through the real dispatcher path: renderEvent + ev.g/ev.pan) and measure them.
//   node audio/sfx/test/solo.mjs                 all recipes of recipes_a (first event of each id in cues.SFX)
//   node audio/sfx/test/solo.mjs id1 id2 ...     only these ids (any owner)
//   flags: --nopng  skip spectrogram PNGs     --all  also recipes_b ids
// Writes audio/sfx/test/<id>.wav (32-bit float) and audio/build/tmp/sfx/<id>.png (log-frequency spectrogram).
// Prints a table: peak / true peak / active RMS / length / lead-in / tail / DC / L-R correlation / centroid.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as dsp from '../../lib/dsp.mjs';
import * as meter from '../../lib/meter.mjs';
import { spectrogramPng } from '../../lib/ff.mjs';
import { TMP, ensure } from '../../lib/paths.mjs';
import * as cues from '../../../shared/cues.js';
import { renderEvent, recipesA, recipesB } from '../index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
let ids = args.filter((a) => !a.startsWith('--'));
if (!ids.length) ids = Object.keys(flags.has('--all') ? { ...recipesA, ...recipesB } : recipesA);
const { SR } = dsp;

export function analyse(buf) {
  const n = buf.length;
  const tp = meter.truePeak(buf);
  let pk = 0;
  for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(buf.L[i]), Math.abs(buf.R[i]));
  // active RMS: samples within 40 dB of the peak
  const thr = pk * 0.01;
  let s = 0, k = 0, first = -1, last = -1, sl = 0, sr = 0, slr = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.max(Math.abs(buf.L[i]), Math.abs(buf.R[i]));
    if (a > thr) { if (first < 0) first = i; last = i; s += buf.L[i] * buf.L[i] + buf.R[i] * buf.R[i]; k += 2; }
    sl += buf.L[i] * buf.L[i]; sr += buf.R[i] * buf.R[i]; slr += buf.L[i] * buf.R[i];
  }
  const corr = slr / Math.sqrt(Math.max(1e-30, sl * sr));
  const tailN = Math.round(0.001 * SR);
  let tailPk = 0;
  for (let i = Math.max(0, n - tailN); i < n; i++) tailPk = Math.max(tailPk, Math.abs(buf.L[i]), Math.abs(buf.R[i]));
  let headPk = 0;
  for (let i = 0; i < Math.min(n, 2); i++) headPk = Math.max(headPk, Math.abs(buf.L[i]), Math.abs(buf.R[i]));
  // spectral centroid over the loud part (FFT of up to 32768 samples around the peak)
  const dc = meter.dcOffset(buf);
  const db = (v) => (v > 1e-12 ? 20 * Math.log10(v) : -240);
  // centroid
  let pkAt = 0, pv = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(buf.L[i]) + Math.abs(buf.R[i]); if (a > pv) { pv = a; pkAt = i; } }
  const N = 8192, st = Math.max(0, Math.min(n - N, pkAt - 512));
  const seg = new Float32Array(N);
  for (let i = 0; i < N && st + i < n; i++) seg[i] = 0.5 * (buf.L[st + i] + buf.R[st + i]);
  const mag = dsp.magSpectrum(seg, N, 0, true);
  let num = 0, den = 0;
  for (let b = 1; b < mag.length; b++) { const p = mag[b] * mag[b]; num += p * (b * SR / N); den += p; }
  return {
    len: n / SR, peakDb: db(pk), tpDb: tp.db, rmsDb: db(Math.sqrt(s / Math.max(1, k))), leadMs: first < 0 ? NaN : (first / SR) * 1000,
    tailDb: db(tailPk), headDb: db(headPk), dcL: dc.L, dcR: dc.R, corr, centroid: den > 0 ? num / den : 0, activeSec: first < 0 ? 0 : (last - first) / SR,
  };
}

const rows = [];
ensure(path.join(TMP, 'sfx'));
const counts = new Map();
for (const ev0 of cues.SFX) counts.set(ev0.id, 0);
const seen = new Map();
for (const id of ids) {
  const idx = cues.SFX.findIndex((e) => e.id === id);
  const ev = idx >= 0 ? cues.SFX[idx] : { t: 0, id };
  const nth = cues.SFX.slice(0, Math.max(0, idx)).filter((e) => e.id === id).length;
  seen.set(id, nth);
  const t0 = Date.now();
  const r = renderEvent(ev, nth, cues);
  const ms = Date.now() - t0;
  const lin = dsp.dbToLin(ev.g || 0);
  const [gl, gr] = dsp.panGains(ev.pan || 0, true);
  const buf = new dsp.Buf(r.buf.length / SR);
  for (let i = 0; i < buf.length; i++) { buf.L[i] = r.buf.L[i] * lin * gl; buf.R[i] = r.buf.R[i] * lin * gr; }
  const file = path.join(HERE, id + '.wav');
  dsp.writeWav(file, buf);
  const a = analyse(buf);
  a.id = id; a.ms = ms; a.pre = r.offsetSec || 0; a.g = ev.g || 0; a.send = r.send;
  rows.push(a);
  if (!flags.has('--nopng')) spectrogramPng(file, path.join(TMP, 'sfx', id + '.png'), { w: 900, h: 340, legend: true, fscale: 'log', drange: 90 });
}
const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '-inf');
console.log('id'.padEnd(20) + 'len  peak  tp   rms   lead  head  tail   dcL     corr  cent   ms   g');
for (const a of rows) {
  const warn = [];
  if (a.peakDb > -2.9) warn.push('PEAK>-3');
  if (a.tailDb > -66) warn.push('TAIL');
  if (a.headDb > -50 && a.pre === 0) warn.push('HEAD');
  if (Math.abs(a.dcL) > 5e-4) warn.push('DC');
  console.log(a.id.padEnd(20) + [f(a.len, 2).padStart(4), f(a.peakDb).padStart(5), f(a.tpDb).padStart(5), f(a.rmsDb).padStart(5), f(a.leadMs, 0).padStart(5), f(a.headDb, 0).padStart(5), f(a.tailDb, 0).padStart(5), (a.dcL * 1e4).toFixed(1).padStart(5) + 'e-4', f(a.corr, 2).padStart(5), f(a.centroid, 0).padStart(5), String(a.ms).padStart(5), f(a.g, 0).padStart(3)].join(' ') + (warn.length ? '  <-- ' + warn.join(',') : ''));
}
