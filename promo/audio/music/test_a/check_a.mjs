// node audio/music/test_a/check_a.mjs [wav]   - measures score A (reads audio/build/stems/music_a.wav by default; run score_a.mjs --solo first)
// Prints: silence window, peak/DC, loudness per era, downbeat onset timing, cold-open drone/piano timing, turn piano pitches, sub-drop tail,
// in-key check of every planned pitched event. Exit code 1 if a hard requirement fails.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as dsp from '../../lib/dsp.mjs';
import * as th from '../../lib/theory.mjs';
import * as meter from '../../lib/meter.mjs';
import { STEMS } from '../../lib/paths.mjs';
import * as cues from '../../../shared/cues.js';
import { planA } from '../score_a.mjs';

const wavPath = process.argv[2] || path.join(STEMS, 'music_a.wav');
const buf = dsp.readWav(wavPath);
const { SR } = dsp;
const { ERAS, BEAT, BAR, FREEZE_T, NOW_T } = cues;
const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : String(v));
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails++; };

const mono = Float64Array.from(buf.L, (v, i) => 0.5 * (v + buf.R[i]));
const hp = (x, fc) => { const y = dsp.biquad(Float32Array.from(x), 'hp', fc, 0.707); return Float64Array.from(y); };

// ---- 1. silence window 22.0 .. 22.5
{
  const r = meter.silenceCheck(buf, FREEZE_T, FREEZE_T + BEAT, -90);
  let mx = 0;
  for (let i = Math.round(FREEZE_T * SR); i < Math.round((FREEZE_T + BEAT) * SR); i++) mx = Math.max(mx, Math.abs(buf.L[i]), Math.abs(buf.R[i]));
  ok(r.silent && mx === 0, `true digital silence ${FREEZE_T}-${FREEZE_T + BEAT} (peak ${f(r.peakDb)} dBFS, max |x| = ${mx})`);
  // the music before the cut is audible right up to 22.0 and nothing leaks after
  const pre = meter.rmsDb(buf, FREEZE_T - 0.1, FREEZE_T - 0.002);
  ok(pre > -40, `music alive right before the cut (RMS ${f(pre)} dBFS over 21.9-22.0)`);
}
// ---- 2. peak / DC / clipping (0..26 s window and the whole stem)
{
  const m = meter.measure(buf.slice(0, 30));
  ok(m.truePeakDb <= -2.9, `peak <= -3 dBFS: sample ${f(m.samplePeakDb)} dBFS, true ${f(m.truePeakDb)} dBTP`);
  ok(Math.abs(m.dcL) < 1e-3 && Math.abs(m.dcR) < 1e-3, `DC offset L ${m.dcL.toExponential(1)} R ${m.dcR.toExponential(1)}`);
  ok(m.clipped === 0, `clipped samples ${m.clipped}`);
  console.log(`      0-30 s: integrated ${f(m.integrated)} LUFS, LRA ${f(m.lra)}, momentary max ${f(m.momentaryMax)} LUFS, crest ${f(m.crestDb)} dB`);
}
// ---- 3. loudness per era + brightness / low-end / stereo
console.log('\nera   t0     LUFS(bar)  RMS dBFS  peak dBFS  <120Hz %  400-4k %  >4k %   L/R corr');
const bandE = (x, t0, t1, lo, hi) => {
  const a = Math.round(t0 * SR), b = Math.round(t1 * SR);
  let seg = Float32Array.from(x.subarray(a, b));
  if (lo > 0) seg = dsp.biquad(seg, 'hp', lo, 0.707);
  if (hi < 20000) seg = dsp.biquad(seg, 'lp', hi, 0.707);
  let e = 0; for (const v of seg) e += v * v; return e;
};
const eraLufs = [];
for (const E of ERAS) {
  const t0 = E.t0, t1 = E.t1;
  const g = meter.lufsGateStats(buf, t0, t1);
  eraLufs.push(g.ungated);
  const tot = bandE(mono, t0, t1, 0, 20000) + 1e-20;
  const lo = bandE(mono, t0, t1, 0, 120) / tot, mid = bandE(mono, t0, t1, 400, 4000) / tot, hi = bandE(mono, t0, t1, 4000, 20000) / tot;
  const a = Math.round(t0 * SR), b = Math.round(t1 * SR);
  let sl = 0, sr = 0, sx = 0;
  for (let i = a; i < b; i++) { sl += buf.L[i] ** 2; sr += buf.R[i] ** 2; sx += buf.L[i] * buf.R[i]; }
  console.log(`${E.year}  ${f(t0, 1).padStart(5)}  ${f(g.ungated).padStart(8)}  ${f(g.rmsDb).padStart(8)}  ${f(g.peakDb).padStart(9)}  ${f(100 * lo, 1).padStart(7)}  ${f(100 * mid, 1).padStart(8)}  ${f(100 * hi, 1).padStart(6)}   ${f(sx / Math.sqrt(sl * sr + 1e-20), 2)}`);
}
{
  const rising = eraLufs.slice(0, 8).every((v, i, a) => i === 0 || v >= a[i - 1] - 1.5);
  ok(rising, 'loudness arc rises 1895 -> 2009 (each era >= previous - 1.5 dB)');
}
// ---- 4. downbeat transients: positive flux peak within +-5 ms of t0
console.log('\ndownbeat onsets (start of the biggest 2 ms-RMS rise in the 1.2-9 kHz band, search +-60 ms):');
// onset detection works on the 1.2-9 kHz band (broadband attack: hammer, bow, mallet, stick) - the low-frequency waveform ripple of bass notes would
// otherwise masquerade as onsets; 'lo' (120 Hz+) is used for the sub boom
const mkBand = (lo, hi) => Float64Array.from(dsp.biquad(dsp.biquad(Float32Array.from(mono), 'hp', lo, 0.707), 'lp', hi, 0.707));
const hpm = mkBand(1200, 9000);
const hpmLow = mkBand(120, 9000);
function onsetNear(t0, win = 0.06, X = hpm) {
  // 2 ms RMS envelope (dB) at 1 ms hop; flux = rise over 4 ms; onset = START of the biggest rise (walk back to 35 % of its peak flux)
  const hop = Math.round(0.001 * SR), w = Math.round(0.002 * SR), lag = 4;
  const a = Math.round((t0 - win) * SR), b = Math.round((t0 + win) * SR);
  const env = [];
  for (let i = a - 12 * hop; i < b + 2 * hop; i += hop) {
    let acc = 0;
    for (let k = i; k < i + w; k++) acc += X[k] * X[k];
    env.push(10 * Math.log10(acc / w + 1e-14));
  }
  const fl = env.map((v, j) => (j >= lag ? v - env[j - lag] : 0));
  let jp = 0;
  for (let j = 12; j < fl.length - 2; j++) if (fl[j] > fl[jp]) jp = j;
  let js = jp;
  while (js > 1 && fl[js - 1] > 0.35 * fl[jp]) js--;
  const tOf = (j) => (a - 12 * hop + j * hop) / SR;
  // the second-biggest rise at least 15 ms away (competitor events)
  let jc = -1;
  for (let j = 12; j < fl.length - 2; j++) if (Math.abs(j - jp) > 15 && (jc < 0 || fl[j] > fl[jc])) jc = j;
  return { t: tOf(js) + 0.0005, tp: tOf(jp), flux: fl[jp], rival: jc >= 0 ? fl[jc] : -99, rivalT: jc >= 0 ? tOf(jc) : 0 };
}
const starts = [...ERAS.map((E) => ({ name: String(E.year), t: E.t0 })), { name: 'NOW', t: NOW_T }, { name: 'subdrop', t: FREEZE_T + BEAT }, { name: 'piano E4', t: 24 }];
for (const s of starts) {
  const o = onsetNear(s.t, 0.06, s.name === 'subdrop' ? hpmLow : hpm);
  const d = (o.t - s.t) * 1000;
  ok(Math.abs(d) <= 5 && o.flux > 6, `${s.name.padEnd(9)} t0=${f(s.t, 3)}  onset ${f(o.t, 4)}  (${d >= 0 ? '+' : ''}${f(d, 1)} ms)  flux ${f(o.flux)} dB${o.rival > 0.7 * o.flux ? `  [rival rise ${f(o.rival)} dB @${f(o.rivalT, 3)}]` : ''}`);
}
// ---- 5. cold open: drone from 1.0, one piano note at 3.0
console.log('\ncold open:');
{
  const rmsAt = (a, b) => meter.rmsDb(buf, a, b);
  const pre = rmsAt(0, 0.9);
  ok(pre < -80, `0-0.9 s silent (RMS ${f(pre)} dBFS)`);
  let first = null;
  for (let t = 0.8; t < 2.4; t += 0.01) if (meter.rmsDb(buf, t, t + 0.05) > -75) { first = t; break; }
  ok(first != null && first >= 0.95 && first <= 1.45, `drone becomes audible (> -75 dBFS) at ${f(first, 2)} s (cue 1.0)`);
  const d2 = rmsAt(2.0, 2.8);
  console.log(`      drone level 2.0-2.8 s: RMS ${f(d2)} dBFS, 3.2-3.9 s: ${f(rmsAt(3.2, 3.9))} dBFS; tail at 4.0-4.3: ${f(rmsAt(4.0, 4.3))} dBFS`);
  const o = onsetNear(3.0);
  ok(Math.abs(o.t - 3.0) <= 0.005 && o.flux > 6, `piano E4 onset at ${f(o.t, 4)} (cue 3.0), flux ${f(o.flux)} dB`);
  const hz = peakHz(mono, 3.05, 3.55, dsp.midiToHz(64) * 0.9, dsp.midiToHz(64) * 1.1);
  ok(Math.abs(1200 * Math.log2(hz / dsp.midiToHz(cues.MOTIF.notes[0].midi))) < 25, `piano note pitch ${f(hz, 1)} Hz  (E4 = ${f(dsp.midiToHz(cues.MOTIF.notes[0].midi), 1)} Hz)`);
}
// ---- 6. turn: solo piano pitches
function peakHz(x, t0, t1, lo, hi) {
  const N = 1 << 15;
  const a = Math.round(t0 * SR);
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = (x[a + i] || 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / N));
  dsp.FFT.get(N).transform(re, im);
  let best = 0, bk = 0;
  for (let k = Math.floor((lo * N) / SR); k < Math.ceil((hi * N) / SR); k++) { const m = Math.hypot(re[k], im[k]); if (m > best) { best = m; bk = k; } }
  const a1 = Math.log(Math.hypot(re[bk - 1], im[bk - 1]) + 1e-30), b1 = Math.log(best + 1e-30), c1 = Math.log(Math.hypot(re[bk + 1], im[bk + 1]) + 1e-30);
  return ((bk + (0.5 * (a1 - c1)) / (a1 - 2 * b1 + c1)) * SR) / N;
}
console.log('\nturn piano (24.0-26.0):');
{
  const ev = th.motifEvents(24, { rhythm: 'even' });
  for (const e of ev) {
    const target = dsp.midiToHz(e.midi);
    const hz = peakHz(mono, e.t + 0.04, e.t + 0.4, target * 0.8, target * 1.25);
    const cents = 1200 * Math.log2(hz / target);
    const o = onsetNear(e.t, 0.04);
    ok(Math.abs(cents) < 30 && Math.abs(o.t - e.t) <= 0.005, `midi ${e.midi} @${f(e.t, 2)}: ${f(hz, 1)} Hz (${cents >= 0 ? '+' : ''}${f(cents, 1)} cents), onset ${f((o.t - e.t) * 1000, 1)} ms`);
  }
  console.log(`      level 24.0-26.0: ${f(meter.lufsGateStats(buf, 24, 26).ungated)} LUFS; tail RMS 26.5-27.5 ${f(meter.rmsDb(buf, 26.5, 27.5))} dBFS, 28.5-29.5 ${f(meter.rmsDb(buf, 28.5, 29.5))} dBFS`);
}
// ---- 7. sub drop: the musical boom alone (exported by score_a) + its presence in the stem
console.log('\nsub drop (22.5):');
{
  const { subBoom } = await import('../score_a.mjs');
  const bm = subBoom(22.5).buf;
  const rm = (t) => meter.rmsDb(bm, t, t + 0.1);
  const p = rm(0.02);
  const lv = [0.5, 1.0, 1.5, 2.5, 3.0].map((t) => rm(t) - p);
  console.log(`      boom alone, level re start at +0.5/1.0/1.5/2.5/3.0 s: ${lv.map((v) => f(v)).join(' / ')} dB`);
  ok(lv[1] > -22 && lv[3] < -30, 'boom tail: still > -22 dB at +1.0 s, below -30 dB at +2.5 s');
  const lo = (a, b) => { const seg = dsp.biquad(Float32Array.from(mono.subarray(Math.round(a * SR), Math.round(b * SR))), 'lp', 120, 0.707); let e = 0; for (const v of seg) e += v * v; return 10 * Math.log10(e / seg.length + 1e-20); };
  ok(lo(22.52, 22.62) > -30 && lo(22.2, 22.5) < -150, `boom present in the stem at 22.5 (low-band ${f(lo(22.52, 22.62))} dB), nothing before`);
}
// ---- 8. harmony: every planned pitched event is in C major / A minor, motif present once per era bar
console.log('\nnotes:');
{
  const plan = planA();
  const bad = plan.filter((n) => !th.inKey(n.midi));
  ok(bad.length === 0, `${plan.length} planned pitched events, all diatonic to C / Am${bad.length ? ' - OFF: ' + bad.slice(0, 5).map((n) => `${n.era}:${n.layer}@${f(n.t, 2)}=${n.midi}`).join(' ') : ''}`);
  const inst = await import('../instruments.mjs');
  const outRange = plan.filter((n) => { const r = inst.info(n.id).range; return r && (n.midi < r[0] || n.midi > r[1]); });
  ok(outRange.length === 0, `every pitched event is inside its instrument's playable range${outRange.length ? ' - OUT: ' + outRange.slice(0, 5).map((n) => `${n.id}@${f(n.t, 2)}=${n.midi}`).join(' ') : ''}`);
  let motifOk = true;
  for (const E of ERAS) {
    const evs = plan.filter((n) => n.era === E.index);
    for (const m of cues.MOTIF.notes) {
      const t = E.t0 + m.beat * BEAT;
      if (!evs.some((n) => Math.abs(n.t - t) <= 0.0061 && (((n.midi - m.midi) % 12) + 12) % 12 === 0)) { motifOk = false; console.log(`      era ${E.year}: motif note ${m.midi} @${f(t, 3)} missing`); }
    }
  }
  ok(motifOk, 'every era states the motif E-G-A-C (pitch class and cues.MOTIF beat, +-6 ms) once per bar');
}
console.log(fails ? `\n${fails} check(s) FAILED` : '\nall checks passed');
process.exit(fails ? 1 : 0);
