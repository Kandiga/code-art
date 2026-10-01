// Validate meter.mjs against ffmpeg ebur128 on several signals.
import { Buf, SR, mulberry32 } from '../core.mjs';
import { osc, noise, curve, mul, lfo } from '../gen.mjs';
import { biquad } from '../filt.mjs';
import { reverb } from '../verb.mjs';
import { measure, truePeak, integratedLoudness, lufsGateStats, kWeightCoefs } from '../meter.mjs';
import { ebur128 } from '../ff.mjs';
import { check, section, summary, f1 } from './harness.mjs';

const dbl = (db) => Math.pow(10, db / 20);
const sigs = [];
const add = (name, buf) => sigs.push({ name, buf });

// 1. 1 kHz sine -20 dBFS (both channels)
{ const s = osc('sine', 1000, 10 * SR).map((v) => v * dbl(-20)); add('sine 1k -20dBFS stereo', Buf.from(s, Float32Array.from(s))); }
// 2. pink noise, different L/R
{ add('pink noise stereo -18dB', Buf.from(noise('pink', 20 * SR, 1, { rms: dbl(-18) }), noise('pink', 20 * SR, 2, { rms: dbl(-18) }))); }
// 3. gating test: 5 s loud noise, 5 s silence, 5 s quiet noise (-50 dB), 4 s loud again
{
  const n = 19 * SR, L = new Float32Array(n), R = new Float32Array(n);
  const a = noise('pink', n, 5, { rms: dbl(-16) }), b = noise('pink', n, 6, { rms: dbl(-16) });
  const q = noise('pink', n, 7, { rms: dbl(-50) });
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const k = t < 5 ? 1 : t < 10 ? 0 : t < 15 ? 0 : 1;
    const quiet = t >= 10 && t < 15;
    L[i] = quiet ? q[i] : a[i] * k;
    R[i] = quiet ? q[(i + 77) % n] : b[i] * k;
  }
  add('gated: loud/silence/-50dB/loud', Buf.from(L, R));
}
// 4. music-like: chords + AM + bursts, hard-panned content
{
  const n = 30 * SR, L = new Float32Array(n), R = new Float32Array(n);
  const am = lfo('sine', 0.4, n, { min: 0.2, max: 1 });
  for (const [f, pan] of [[220, -0.8], [277.2, -0.2], [329.6, 0.3], [440, 0.9], [110, 0]]) {
    const o = osc('saw', f, n);
    const lp = biquad(o, 'lp', 1800, 0.8);
    for (let i = 0; i < n; i++) { const v = lp[i] * am[i] * 0.12; L[i] += v * (1 - pan) * 0.5; R[i] += v * (1 + pan) * 0.5; }
  }
  const bursts = noise('white', n, 9, { rms: 0.25 });
  for (let i = 0; i < n; i++) { const ph = (i / SR) % 2; if (ph < 0.08) { const e = Math.exp(-ph * 50); L[i] += bursts[i] * e; R[i] += bursts[(i + 99) % n] * e; } }
  add('music-like 30s', Buf.from(L, R));
}
// 5. inter-sample peak: sine fs/4 phase 45deg  (sample peak 0.707*g, true peak g)
{
  const n = 5 * SR, s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = 0.8 * Math.sin(Math.PI / 2 * i + Math.PI / 4);
  add('ISP sine fs/4 @45deg (0.8 true)', Buf.from(s, Float32Array.from(s)));
}
// 6. dense reverb-washed material, loud
{
  const n = 25 * SR, x = noise('pink', n, 11, { rms: 0.2 });
  const e = curve(n, [[0, 0], [0.01, 1], [1, 0.1], [2, 0], [12, 0], [12.01, 1], [14, 0], [25, 0]]);
  const g = mul(x, e);
  const w = reverb(Buf.from(g, Float32Array.from(g)), { wet: 0.8, decay: 3 });
  add('reverb wash 25s', w);
}
// 7. very quiet (partly below -70 LUFS gate)
{ add('quiet -62dB noise', Buf.from(noise('pink', 12 * SR, 3, { rms: dbl(-62) }), noise('pink', 12 * SR, 4, { rms: dbl(-62) }))); }
// 8. clipped hot signal
{ const s = osc('sine', 440, 8 * SR).map((v) => Math.max(-1, Math.min(1, v * 1.6))); add('clipped sine 440', Buf.from(s, Float32Array.from(s))); }

section('K-weighting coefficients @48k (BS.1770 reference)');
const [s1, s2] = kWeightCoefs(48000);
check('stage1 b0', Math.abs(s1.b[0] - 1.53512485958697) < 1e-9, f1(s1.b[0], 12));
check('stage1 a1', Math.abs(s1.a[0] - -1.69065929318241) < 1e-9);
check('stage2 a1', Math.abs(s2.a[0] - -1.99004745483398) < 1e-7);

section('integrated loudness + true peak vs ffmpeg ebur128');
console.log('signal'.padEnd(34), 'mine I'.padStart(9), 'ffmpeg I'.padStart(9), 'dI'.padStart(7), '| mine TP'.padStart(10), 'ff TP'.padStart(8), 'dTP'.padStart(7), '| LRA mine/ff');
let worstI = 0, worstTP = 0;
for (const { name, buf } of sigs) {
  const m = measure(buf);
  const ff = ebur128(buf);
  const dI = Number.isFinite(m.integrated) && Number.isFinite(ff.I) ? m.integrated - ff.I : (m.integrated === ff.I || (!Number.isFinite(m.integrated) && !Number.isFinite(ff.I)) ? 0 : 99);
  const dTP = m.truePeakDb - ff.truePeak;
  console.log(name.padEnd(34), f1(m.integrated).padStart(9), f1(ff.I).padStart(9), f1(dI).padStart(7), '|', f1(m.truePeakDb).padStart(8), f1(ff.truePeak).padStart(8), f1(dTP).padStart(7), '|', f1(m.lra, 1), '/', f1(ff.LRA, 1));
  // ffmpeg's own true-peak reading of the fs/4@45deg ISP signal is 0.64 dB above the analytic value; that case is
  // therefore checked against the analytic truth below and excluded from the vs-ffmpeg TP comparison.
  const isIsp = name.startsWith('ISP');
  const okI = Math.abs(dI) <= 0.3, okTP = isIsp || !Number.isFinite(dTP) || Math.abs(dTP) <= 0.3;
  check(`I within 0.3 LU: ${name}`, okI, `d=${f1(dI)}`);
  check(`TP within 0.3 dB: ${name}`, okTP, `d=${f1(dTP)}`);
  worstI = Math.max(worstI, Math.abs(dI)); if (!isIsp) worstTP = Math.max(worstTP, Math.abs(dTP) || 0);
}
console.log(`worst |dI| = ${f1(worstI, 3)} LU, worst |dTP| = ${f1(worstTP, 3)} dB`);

section('analytic checks');
{
  const s = osc('sine', 1000, 6 * SR).map((v) => v * dbl(-20));
  const l = integratedLoudness(Buf.from(s, Float32Array.from(s)));
  check('1k sine -20 dBFS stereo ~ -20 LUFS (analytic)', Math.abs(l - -20.0) < 0.3, f1(l));
  // inter-sample peak: 0.8*sin(pi/2*i + pi/4): samples are +-0.566 (-4.95 dBFS) but the true peak is 0.8 (-1.94 dBTP)
  const isp = truePeak(Buf.from(Float32Array.from({ length: 4800 }, (_, i) => 0.8 * Math.sin(Math.PI / 2 * i + Math.PI / 4)), new Float32Array(4800)));
  check('ISP sine: sample peak -4.95, true peak -1.94 dBTP (analytic, +-0.2)', Math.abs(isp.samplePeakDb - -4.95) < 0.05 && Math.abs(isp.db - -1.94) < 0.2, `sp ${f1(isp.samplePeakDb)} tp ${f1(isp.db)}`);
  // windowed stats vs ffmpeg on the same slices
  const g = sigs[2].buf;
  const wins = [[0, 5, 'loud'], [10, 15, 'quiet -50'], [5, 10, 'silent'], [15, 19, 'loud again']];
  for (const [t0, t1, nm] of wins) {
    const mine = lufsGateStats(g, t0, t1);
    const ff = ebur128(g.slice(t0, t1));
    if (nm === 'silent') check(`lufsGateStats window "${nm}": integrated -inf, peak -inf`, !Number.isFinite(mine.integrated) && mine.peakDb === -Infinity, f1(mine.integrated));
    else check(`lufsGateStats window "${nm}" within 0.3 LU of ffmpeg`, Math.abs(mine.integrated - ff.I) <= 0.3, `mine ${f1(mine.integrated)} ff ${f1(ff.I)} ungated ${f1(mine.ungated)}`);
  }
}
summary('test_meter');
