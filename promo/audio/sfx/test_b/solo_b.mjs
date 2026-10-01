#!/usr/bin/env node
// Solo-render recipes_b ids THROUGH THE REAL DISPATCHER PATH (renderEvent + ev.g + ev.pan) and measure them.
//   node audio/sfx/test_b/solo_b.mjs                 every id that recipes_b defines
//   node audio/sfx/test_b/solo_b.mjs id1 id2 ...     only these ids   (flags: --nopng  --seq  = combined timeline of ALL events of an id)
// Writes audio/sfx/test_b/<id>.wav (32-bit float; the FIRST event of the id, or with --seq (default for multi-event ids)
// all events laid out on their real relative timing, 0.1 s lead-in) and a spectrogram in audio/build/tmp/sfx_b/<id>.png.
// Prints: len / peak / true peak / active RMS / Lk300 (loudest 300 ms K-weighted) / S/M width / L-R corr / lead / head / tail / DC / centroid.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as dsp from '../../lib/dsp.mjs';
import { spectrogramPng } from '../../lib/ff.mjs';
import { TMP, ensure } from '../../lib/paths.mjs';
import * as cues from '../../../shared/cues.js';
import { renderEvent, recipesB } from '../index.mjs';
import { analyse } from '../test/solo.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { SR } = dsp;
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
let ids = args.filter((a) => !a.startsWith('--'));
if (!ids.length) ids = Object.keys(recipesB);
ensure(path.join(TMP, 'sfx_b'));

// octave-band energy distribution (% of total power) so spectral balance can be judged without the log-spectrogram's low-bin smearing
const EDGES = [20, 100, 250, 500, 1000, 2000, 4000, 8000, 24000];
export function bandPct(buf) {
  const N = 8192, mono = Float32Array.from(buf.L, (v, i) => 0.5 * (v + buf.R[i]));
  const p = new Float64Array(EDGES.length - 1);
  for (let st = 0; st < mono.length; st += N / 2) {
    const m = dsp.magSpectrum(mono, N, st, true);
    for (let k = 1; k < m.length; k++) {
      const hz = (k * SR) / N;
      for (let b = 0; b < EDGES.length - 1; b++) if (hz >= EDGES[b] && hz < EDGES[b + 1]) p[b] += m[k] * m[k];
    }
  }
  const tot = p.reduce((a, b) => a + b, 0) + 1e-30;
  return Array.from(p, (v) => (100 * v) / tot);
}

const rows = [];
for (const id of ids) {
  const evs = cues.SFX.map((e, idx) => ({ e, idx })).filter((x) => x.e.id === id);
  const list = evs.length ? evs : [{ e: { t: 30, id, dur: 1 }, idx: -1 }];
  // occurrence index per event (as the dispatcher counts it)
  const items = list.map((x, k) => ({ ev: x.e, n: k }));
  const seq = flags.has('--seq') || items.length > 1;
  const use = seq ? items : [items[0]];
  const t0 = use[0].ev.t;
  const t1 = use[use.length - 1].ev.t;
  const rend = use.map((it) => {
    const ts = Date.now();
    const r = renderEvent(it.ev, it.n, cues);
    return { it, r, ms: Date.now() - ts };
  });
  let maxEnd = 0;
  for (const { it, r } of rend) maxEnd = Math.max(maxEnd, it.ev.t - t0 + r.buf.length / SR - (r.offsetSec || 0));
  const lead = 0.1 + Math.max(...rend.map((x) => x.r.offsetSec || 0));
  const out = new dsp.Buf(lead + maxEnd + 0.05);
  for (const { it, r } of rend) {
    const lin = dsp.dbToLin(it.ev.g || 0);
    const [gl, gr] = dsp.panGains(it.ev.pan || 0, true);
    const off = Math.round((lead + it.ev.t - t0 - (r.offsetSec || 0)) * SR);
    for (let i = 0; i < r.buf.length; i++) {
      const j = off + i;
      if (j < 0 || j >= out.length) continue;
      out.L[j] += r.buf.L[i] * lin * gl;
      out.R[j] += r.buf.R[i] * lin * gr;
    }
  }
  const file = path.join(HERE, id + '.wav');
  dsp.writeWav(file, out);
  const a = analyse(out);
  a.id = id + (use.length > 1 ? ` x${use.length}` : '');
  a.ms = rend.reduce((s, x) => s + x.ms, 0);
  a.send = rend[0].r.send;
  a.pre = rend[0].r.offsetSec || 0;
  // per-event peaks for multi-event ids
  a.evPeaks = rend.map((x) => {
    let p = 0;
    for (let i = 0; i < x.r.buf.length; i++) p = Math.max(p, Math.abs(x.r.buf.L[i]), Math.abs(x.r.buf.R[i]));
    return 20 * Math.log10(p + 1e-12) + (x.it.ev.g || 0);
  });
  a.bands = bandPct(out);
  rows.push(a);
  if (!flags.has('--nopng')) spectrogramPng(file, path.join(TMP, 'sfx_b', id + '.png'), { w: 1000, h: 380, legend: true, fscale: 'log', drange: 90 });
  void t1;
}
const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '-inf');

console.log('id'.padEnd(22) + 'len   peak   tp    rms  Lk300  S/M  corr  lead  head  tail   dcL  cent   ms  send');
for (const a of rows) {
  const warn = [];
  if (a.peakDb > -2.9) warn.push('PEAK>-3');
  if (a.tailDb > -50) warn.push('TAIL');
  if (a.headDb > -50 && a.pre === 0) warn.push('HEAD');
  if (Math.abs(a.dcL) > 5e-4) warn.push('DC');
  console.log(a.id.padEnd(22) + [f(a.len, 2).padStart(4), f(a.peakDb).padStart(6), f(a.tpDb).padStart(5), f(a.rmsDb).padStart(5), f(a.lk300).padStart(6), f(a.sm, 0).padStart(4), f(a.corr, 2).padStart(5), f(a.leadMs, 0).padStart(5), f(a.headDb, 0).padStart(5), f(a.tailDb, 0).padStart(5), (a.dcL * 1e4).toFixed(1).padStart(5), f(a.centroid, 0).padStart(5), String(a.ms).padStart(5), String(a.send).padStart(5)].join(' ') + (warn.length ? '  <-- ' + warn.join(',') : '') + (a.evPeaks.length > 1 ? '   evPk[' + a.evPeaks.map((v) => f(v, 1)).join(' ') + ']' : ''));
}
if (flags.has('--bands')) {
  console.log('\nband energy %  ' + EDGES.slice(0, -1).map((e, i) => `${e}-${EDGES[i + 1]}`.padStart(9)).join(''));
  for (const a of rows) console.log(a.id.padEnd(15) + a.bands.map((v) => v.toFixed(1).padStart(9)).join(''));
}
if (flags.has('--env')) { // loudness contour (dB RMS per 100 ms of the written wav, rounded) to catch dropouts / NaN-scrubbed silences
  console.log('\nRMS dB per 100 ms:');
  for (const id of ids) {
    const b = dsp.readWav(path.join(HERE, id + '.wav'));
    const w = Math.round(0.1 * SR);
    const o = [];
    for (let i = 0; i < b.length; i += w) { let e = 0; const m = Math.min(b.length, i + w); for (let j = i; j < m; j++) e += b.L[j] * b.L[j]; o.push(Math.max(-99, Math.round(10 * Math.log10(e / (m - i) + 1e-12)))); }
    console.log(id.padEnd(18) + o.join(' '));
  }
}
