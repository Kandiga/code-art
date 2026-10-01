// node audio/crowd/tools/measure.mjs  -> per-event solo renders (no limiter): peak / RMS / first onset vs cue / persons / claps
import fs from 'node:fs';
import path from 'node:path';
import * as cues from '../../../shared/cues.js';
import { openLibrary } from '../lib.mjs';
import { planCrowd, synthPlacements, sortedEvents } from '../render.mjs';
import { mixdown } from '../room.mjs';
import { SR } from '../../lib/dsp.mjs';

const lib = await openLibrary();
const { placements, info } = planCrowd(lib);
const only = process.argv[2] ? process.argv[2].split(',').map(Number) : null;
const rows = [];
for (const ev of info) {
  if (only && !only.includes(ev.index)) continue;
  const ps = placements.filter((p) => p.ev === ev.index);
  const buses = synthPlacements(lib, ps);
  const dryPeak = (() => { let m = 0; for (const c of [buses.dry.L, buses.dry.R]) for (let i = 0; i < c.length; i++) m = Math.max(m, Math.abs(c[i])); return m; })();
  // first onset of the DRY bus: first sample above -40 dBFS re its own peak
  const thr = dryPeak * 0.01;
  let on = -1;
  for (let i = 0; i < buses.dry.L.length; i++) if (Math.abs(buses.dry.L[i]) > thr || Math.abs(buses.dry.R[i]) > thr) { on = i / SR; break; }
  const mix = mixdown(buses);
  let pk = 0, e = 0, n = 0;
  const a = Math.round(ev.t * SR), b = Math.min(mix.L.length, Math.round((ev.t1 || ev.t + 2.5) * SR));
  for (let i = 0; i < mix.L.length; i++) { const v = Math.max(Math.abs(mix.L[i]), Math.abs(mix.R[i])); pk = Math.max(pk, v); }
  // active RMS: 100 ms blocks in the event window with energy within 25 dB of the loudest block
  const blk = Math.round(0.1 * SR); const bl = [];
  for (let s = a; s + blk < Math.min(mix.L.length, b + 2 * SR); s += blk) { let q = 0; for (let i = s; i < s + blk; i++) q += 0.5 * (mix.L[i] ** 2 + mix.R[i] ** 2); bl.push(q / blk); }
  const mx = Math.max(...bl);
  const act = bl.filter((x) => x > mx * 10 ** -2.5);
  const rms = 10 * Math.log10(act.reduce((x, y) => x + y, 0) / act.length + 1e-20);
  rows.push({ i: ev.index, t: ev.t, kind: ev.kind, n: ev.n, persons: ev.persons, claps: ev.claps, onsetErrMs: +((on - ev.t) * 1000).toFixed(1), peakDb: +(20 * Math.log10(pk)).toFixed(1), activeRmsDb: +rms.toFixed(1) });
}
console.table(rows);
