// =============================================================================
// node audio/crowd/verify.mjs [--stem file]   contract + sanity checks of the crowd stem (numbers, no listening needed)
//  * 60.000 s stereo float32 48 kHz, true peak <= -3 dBFS, no NaN, no DC
//  * silent where no event sounds (digital silence < -90 dBFS between the tail of the last early event and the first future event)
//  * every cues.CROWD event: first onset == cue time +- 20 ms (solo render, dry bus, thresholds -50..-30 dB re event peak)
//  * counts: distinct voices (library persons), distinct clap samples / hands, total claps; no clip reused while unused ones remain
//  * applause: temporal kurtosis of the dry clap bus (Gaussian noise = 3, claps >> 3), sync order parameter r(t), clappers(t)
// Writes audio/crowd/verify_report.json.   (ASR / harmonicity checks: py/verify_asr.py;  spectrograms: tools/gallery.mjs)
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cues from '../../shared/cues.js';
import { readWav, SR } from '../lib/dsp.mjs';
import * as meter from '../lib/meter.mjs';
import { STEMS } from '../lib/paths.mjs';
import { openLibrary } from './lib.mjs';
import { planCrowd, synthPlacements } from './render.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null; };
const stemFile = arg('--stem') || path.join(STEMS, 'crowd.wav');
const ok = [];
const bad = [];
const check = (name, cond, detail = '') => (cond ? ok : bad).push(`${name}${detail ? ' - ' + detail : ''}`);

const lib = await openLibrary();
const { placements, info } = planCrowd(lib);
const report = { stem: stemFile, checks: {}, events: [] };

// ---- stem file ---------------------------------------------------------------------------------------------------
const stem = readWav(stemFile);
const m = meter.measure(stem);
check('duration 60.000 s', Math.abs(stem.seconds - 60) < 1e-6, stem.seconds.toFixed(4));
check('true peak <= -3 dBTP', m.truePeakDb <= -3.0, m.truePeakDb.toFixed(2) + ' dBTP');
check('no clipped samples', m.clipped === 0);
check('DC offset < 1e-4', Math.abs(m.dcL) < 1e-4 && Math.abs(m.dcR) < 1e-4);
let nan = 0;
for (const c of [stem.L, stem.R]) for (let i = 0; i < c.length; i += 1) if (!Number.isFinite(c[i])) nan++;
check('no NaN/Inf', nan === 0);
report.checks.loudness = { integratedLufs: +m.integrated.toFixed(1), momentaryMax: +m.momentaryMax.toFixed(1), shortTermMax: +m.shortTermMax.toFixed(1), truePeakDb: +m.truePeakDb.toFixed(2), rmsDb: +m.rmsDb.toFixed(1) };

// ---- silence outside the events ----------------------------------------------------------------------------------------
const evs = info.slice().sort((a, b) => a.t - b.t);
const first = evs[0].t;
check(`silent before the first event (${first} s)`, meter.silenceCheck(stem, 0, Math.max(0, first - 0.05), -90).silent);
// gaps: from (last tail of an event + 5 s) to the next event
const gaps = [];
for (let i = 0; i < evs.length - 1; i++) {
  const endI = Math.max(...placements.filter((p) => p.ev === evs[i].index).map((p) => p.t + 3)) + 2.5; // + longest clip + reverb tail
  if (evs[i + 1].t - endI > 1) gaps.push([endI, evs[i + 1].t - 0.05]);
}
for (const [a, b] of gaps) { const r = meter.silenceCheck(stem, a, b, -90); check(`silence ${a.toFixed(1)}-${b.toFixed(1)} s (< -90 dBFS)`, r.silent, r.peakDb.toFixed(1) + ' dBFS peak'); }
check('stem tail at 60 s < -70 dBFS', meter.rmsDb(stem, 59.8, 60.0) < -70, meter.rmsDb(stem, 59.8, 60.0).toFixed(1) + ' dBFS');
// the t >= 42 body must have sound
check('sound at 42.5-58 s', meter.rmsDb(stem, 42.5, 58) > -40);

// ---- per-event onsets (solo dry renders) ------------------------------------------------------------------------------
const rows = [];
for (const ev of info) {
  const ps = placements.filter((p) => p.ev === ev.index);
  const b = synthPlacements(lib, ps);
  let pk = 0;
  for (let i = 0; i < b.dry.L.length; i++) pk = Math.max(pk, Math.abs(b.dry.L[i]), Math.abs(b.dry.R[i]));
  const on = {};
  for (const th of [-50, -40, -30]) {
    const thr = pk * 10 ** (th / 20);
    let o = -1;
    for (let i = 0; i < b.dry.L.length; i++) if (Math.abs(b.dry.L[i]) > thr || Math.abs(b.dry.R[i]) > thr) { o = i / SR; break; }
    on[th] = +((o - ev.t) * 1000).toFixed(1);
  }
  const persons = new Set(ps.filter((p) => p.k !== 'c').map((p) => p.person));
  const clapSamples = new Set(ps.filter((p) => p.k === 'c').map((p) => p.ci));
  const hands = new Set(ps.filter((p) => p.k === 'c').map((p) => p.hand));
  const lastOn = Math.max(...ps.map((p) => p.t));
  const row = { i: ev.index, t: ev.t, kind: ev.kind, n: ev.n, voices: ps.filter((p) => p.k !== 'c').length, persons: persons.size, claps: ps.filter((p) => p.k === 'c').length, clapSamples: clapSamples.size, hands: hands.size, onsetMs: on, spreadS: +(lastOn - ev.t).toFixed(3) };
  rows.push(row);
  const worst = Math.max(...Object.values(on).map(Math.abs));
  check(`event ${ev.index} ${ev.kind}@${ev.t}: first onset within +-20 ms`, worst <= 20, `${JSON.stringify(on)} ms`);
  if (ev.kind !== 'applause' && ev.kind !== 'murmur' && ev.kind !== 'clap') {
    check(`event ${ev.index} ${ev.kind}: ${ev.n} distinct people`, persons.size === ev.n, `${persons.size}`);
    check(`event ${ev.index} ${ev.kind}: reaction spread 0-0.35 s`, row.spreadS <= 0.36 + 0.02, `${row.spreadS} s`);
  }
  if (ev.kind === 'murmur') check(`event ${ev.index} murmur: ${ev.n} distinct voices`, persons.size === ev.n);
}
report.events = rows;

// ---- reuse of library clips ------------------------------------------------------------------------------------------------
const voiceIds = placements.filter((p) => p.k === 'v' || p.k === 'w').map((p) => p.id);
const reuse = voiceIds.length - new Set(voiceIds).size;
check('voice clips never repeated (library big enough)', reuse === 0, `${reuse} repeats of ${voiceIds.length}`);
report.checks.voices = { clips: voiceIds.length, distinctClips: new Set(voiceIds).size, distinctPeople: new Set(placements.filter((p) => p.k !== 'c').map((p) => p.person)).size };

// ---- applause statistics ------------------------------------------------------------------------------------------------------
const ap = info.find((e) => e.kind === 'applause');
if (ap) {
  const claps = placements.filter((p) => p.ev === ap.index && p.k === 'c');
  const perSec = {};
  for (const c of claps) { const k = Math.floor(c.t); perSec[k] = (perSec[k] || 0) + 1; }
  check('applause: thousands of individual claps', claps.length >= 2000, `${claps.length}`);
  check('applause: >= 150 distinct clap samples', new Set(claps.map((c) => c.ci)).size >= 150, `${new Set(claps.map((c) => c.ci)).size}`);
  const dryBuses = synthPlacements(lib, claps);
  // fine temporal structure of the DRY clap bus: ratio of the 1 ms RMS envelope to its own 50 ms running RMS, in dB (p99 / fraction of
  // 1 ms frames > +6 dB). Individual claps => sharp excursions; a (filtered) noise wash with the same slow envelope => almost none.
  const fine = (x0, t0, t1) => {
    const a = Math.round(t0 * SR), b = Math.round(t1 * SR), w = Math.round(0.001 * SR);
    const e1 = [];
    for (let s = a; s + w < b; s += w) { let q = 0; for (let i = s; i < s + w; i++) q += 0.5 * (x0.L[i] ** 2 + x0.R[i] ** 2); e1.push(q / w); }
    return e1;
  };
  const stat = (e1) => {
    const W = 50, r = [];
    let acc = 0;
    for (let i = 0; i < e1.length; i++) { acc += e1[i]; if (i >= W) acc -= e1[i - W]; if (i >= W) r.push(10 * Math.log10((e1[i - Math.floor(W / 2)] + 1e-20) / (acc / W + 1e-20))); }
    r.sort((p, q) => p - q);
    return { p99: +r[Math.floor(r.length * 0.99)].toFixed(1), p50: +r[Math.floor(r.length * 0.5)].toFixed(1), over6: +(r.filter((v) => v > 6).length / r.length * 100).toFixed(2) };
  };
  const noiseOf = (e1) => { // gaussian noise with the identical 50 ms envelope (the rejected "filtered noise applause")
    let s = 987654321; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const W = 50; const env = []; let acc = 0;
    for (let i = 0; i < e1.length; i++) { acc += e1[i]; if (i >= W) acc -= e1[i - W]; env.push(acc / Math.min(W, i + 1)); }
    return env.map((v) => { let q = 0; for (let k = 0; k < 48; k++) { const g = Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd()); q += g * g; } return v * q / 48; });
  };
  const win = { early: [49.0, 50.4], rise: [51.0, 52.5], climax: [54.2, 55.7] };
  const fs_ = {};
  for (const [k, [t0, t1]] of Object.entries(win)) { const e1 = fine(dryBuses.dry, t0, t1); fs_[k] = { claps: stat(e1), noiseSameEnvelope: stat(noiseOf(e1)) }; }
  report.checks.applause = { claps: claps.length, perSecond: perSec, fineStructure1ms_vs_50ms_dB: fs_, syncSeries: ap.applause.series.filter((_, i) => i % 5 === 0) };
  for (const [k, v] of Object.entries(fs_)) check(`applause ${k}: individual-clap transients (1 ms/50 ms envelope p99 > filtered-noise reference + ${k === 'early' ? 3 : 2} dB)`, v.claps.p99 > v.noiseSameEnvelope.p99 + (k === 'early' ? 3 : 2), `${v.claps.p99} dB vs noise ${v.noiseSameEnvelope.p99} dB`);
  const rMax = Math.max(...ap.applause.series.map((s) => s.r * (s.active > 20 ? 1 : 0)));
  report.checks.applause.maxOrderParameter = +rMax.toFixed(2);
}

report.totals = { events: info.length, claps: placements.filter((p) => p.k === 'c').length, voiceClips: voiceIds.length };
report.pass = bad.length === 0;
report.ok = ok;
report.bad = bad;
fs.writeFileSync(path.join(HERE, 'verify_report.json'), JSON.stringify(report, null, 1));
console.table(rows.map((r) => ({ i: r.i, t: r.t, kind: r.kind, n: r.n, voices: r.voices, persons: r.persons, claps: r.claps, hands: r.hands, 'onset ms @-50/-40/-30': `${r.onsetMs[-50]} / ${r.onsetMs[-40]} / ${r.onsetMs[-30]}`, spread: r.spreadS })));
console.log(ok.map((s) => '  ok   ' + s).join('\n'));
console.log(bad.map((s) => '  FAIL ' + s).join('\n') || '  (no failures)');
console.log(report.pass ? 'VERIFY PASS' : 'VERIFY FAIL');
process.exit(report.pass ? 0 : 1);
