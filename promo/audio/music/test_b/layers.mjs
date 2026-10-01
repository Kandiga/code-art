#!/usr/bin/env node
// node audio/music/test_b/layers.mjs   - per-layer contribution table: gain, active window, K-weighted loudness of the DRY layer
// (with its mix gain applied, over its own active window) and its share of low-end (<160 Hz) energy. Use it to balance the mix.
import { dsp, meter, f, pad, lpad, SR } from './util.mjs';
import { buildLayers, renderLayer } from '../score_b.mjs';
const rows = [];
for (const l of buildLayers()) {
  const b = renderLayer(l);
  const t0 = Math.min(...l.notes.map((n) => n.t)), t1 = Math.max(...l.notes.map((n) => n.t + (n.dur || 0.2))) + 0.3;
  const g = dsp.dbToLin(l.g);
  const w = b.slice(t0, Math.min(60, t1)); w.scale(g);
  const s = meter.lufsGateStats(b.scale(g), t0, Math.min(60, t1));
  const lo = dsp.biquad(w, 'lp', 160, 0.7);
  const eLo = meter.rmsDb(lo), eAll = meter.rmsDb(w);
  rows.push({ n: l.name, grp: l.grp, bus: l.bus, g: l.g, t0, t1, lufs: s.ungated, pk: s.peakDb, lo: eLo - eAll });
}
console.log(pad('layer', 14) + pad('grp', 8) + pad('bus', 8) + lpad('gain', 6) + lpad('t0', 7) + lpad('t1', 7) + lpad('LUFS', 8) + lpad('peak', 8) + lpad('LF dB', 8));
for (const r of rows) console.log(pad(r.n, 14) + pad(r.grp, 8) + pad(r.bus, 8) + lpad(f(r.g, 1), 6) + lpad(f(r.t0, 1), 7) + lpad(f(r.t1, 1), 7) + lpad(f(r.lufs), 8) + lpad(f(r.pk), 8) + lpad(f(r.lo), 8));
