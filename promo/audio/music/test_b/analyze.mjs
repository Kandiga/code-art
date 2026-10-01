#!/usr/bin/env node
// node audio/music/test_b/analyze.mjs [stem.wav|name]   (default: audio/build/stems/music_b.wav)
// NUMBERS for score B: length / peaks / DC / clipping, loudness per 2 s window + per section (must RISE through the jobs),
// the baton hit at 37.0 and the FINAL hit at 58.0 (onset time), the tail to 60.0, transients on the beat grid.
import { dsp, meter, cues, f, pad, lpad, load, mono, onsetNear, riseTime, SR } from './util.mjs';
const arg = process.argv[2] || 'music_b';
const buf = load(arg);
const x = mono(buf);
const BEAT = cues.BEAT;
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };

// ---- basics
const m = meter.measure(buf);
console.log(`length ${f(buf.seconds, 3)} s (${buf.length} samples)   sample peak ${f(m.samplePeakDb, 2)} dBFS   true peak ${f(m.truePeakDb, 2)} dBTP   integrated ${f(m.integrated)} LUFS   LRA ${f(m.lra)}   DC L/R ${m.dcL?.toExponential?.(1)} / ${m.dcR?.toExponential?.(1)}   clipped ${m.clipped}`);
check(buf.length === 2880000, 'exactly 60.000 s = 2 880 000 samples');
check(m.samplePeakDb <= -2.0 + 1e-6, `peak <= -2 dBFS (${f(m.samplePeakDb, 2)})`);
check(Math.abs(m.dcL || 0) < 1e-3 && Math.abs(m.dcR || 0) < 1e-3, 'no DC offset');
check(buf.L.every(Number.isFinite) && buf.R.every(Number.isFinite), 'all samples finite');
check(buf.L.slice(0, 26 * SR).every((v) => v === 0) || arg !== 'music_b', 'silence before 26.0 (solo render only)');

// ---- loudness per 2 s window (short windows use .ungated)
console.log('\nloudness per bar (2 s window, LUFS ungated) and peak:');
const rows = [];
for (let t = 26; t < 60; t += 2) {
  const s = meter.lufsGateStats(buf, t, t + 2);
  rows.push({ t, l: s.ungated, mom: s.momentaryMax, pk: s.peakDb });
}
const spark = (v) => '#'.repeat(Math.max(0, Math.round((v + 50) / 1.2)));
for (const r of rows) console.log(`${lpad(r.t, 5)}-${pad(r.t + 2, 3)} ${lpad(f(r.l), 6)} LUFS  mom.max ${lpad(f(r.mom), 6)}  peak ${lpad(f(r.pk), 6)}  ${spark(r.l)}`);
const jobs = rows.filter((r) => r.t >= 26 && r.t < 42).map((r) => r.l);
const rising = jobs.every((v, i) => i === 0 || v > jobs[i - 1] - 1.0);
check(rising, `jobs loudness rises bar by bar (${jobs.map((v) => f(v, 0)).join(' < ')})  [tolerance -1 dB]`);
check(jobs[jobs.length - 1] - jobs[0] > 10, `jobs span > 10 dB (${f(jobs[jobs.length - 1] - jobs[0])} dB from the first to the last bar)`);

// ---- sections
const sec = (a, b) => meter.lufsGateStats(buf, a, b);
console.log('\nsections (integrated / short-term max / peak):');
for (const [n, a, b] of [['jobs 26-42', 26, 42], ['future 42-50', 42, 50], ['recap 50-54', 50, 54], ['end 54-58', 54, 58], ['final 58-60', 58, 60]]) {
  const s = sec(a, b);
  console.log(`  ${pad(n, 14)} int ${lpad(f(s.integrated), 6)}  short-term max ${lpad(f(s.shortTermMax), 6)}  peak ${lpad(f(s.peakDb), 6)} dBFS`);
}

// ---- the two big hits
console.log('\nhits:');
{
  // baton hit: the loudest rise in 36.9..37.1 (the group is dipped just before: silence then BANG)
  const r = riseTime(x, 36.94, 37.15, 0.03);
  check(Math.abs(r.t - 37.0) <= 0.003, `baton hit onset ${f(r.t, 4)} s (nominal 37.0, |d| = ${f(Math.abs(r.t - 37) * 1000, 2)} ms)`);
  const rf = riseTime(x, 57.93, 58.3, 0.03);
  check(Math.abs(rf.t - 58.0) <= 0.003, `FINAL hit onset ${f(rf.t, 4)} s (nominal 58.0, |d| = ${f(Math.abs(rf.t - 58) * 1000, 2)} ms)`);
  const pre = meter.rmsDb ? meter.rmsDb(buf, 57.91, 57.99) : NaN;
  console.log(`  RMS 57.91-57.99 (pre-hit breath): ${f(pre)} dBFS      peak in 58.0-58.05: ${f(meter.peakDb(buf, 58.0, 58.05))} dBFS     loudest peak of the stem at ${f(meter.peakDb(buf, 58, 60))} dBFS`);
  for (const [n, a, b] of [['baton 37.0-37.1', 37.0, 37.1], ['final 58.0-58.1', 58.0, 58.1]]) console.log(`  ${n}: peak ${f(meter.peakDb(buf, a, b))} dBFS  RMS ${f(meter.rmsDb(buf, a, b))} dBFS`);
}

// ---- the tail
console.log('\ntail after the final hit (RMS per 0.25 s window):');
let prev = null;
const tail = [];
for (let t = 58.0; t < 60; t += 0.25) {
  const r = meter.rmsDb(buf, t, t + 0.25);
  tail.push([t, r]);
  console.log(`  ${f(t, 2)}-${f(t + 0.25, 2)}  ${lpad(f(r), 7)} dBFS  ${'#'.repeat(Math.max(0, Math.round((r + 90) / 2)))}`);
}
const lastPk = meter.peakDb(buf, 59.95, 60);
check(meter.rmsDb(buf, 59.0, 59.25) > -55, `the tail still rings at 59.0-59.25 s (${f(meter.rmsDb(buf, 59.0, 59.25))} dBFS RMS)`);
check(lastPk < -70, `near-silence by 60.0: peak of the last 50 ms = ${f(lastPk)} dBFS`);
check(Math.abs(buf.L[buf.length - 1]) < 1e-6 && Math.abs(buf.R[buf.length - 1]) < 1e-6, 'last sample ~0');
check(tail.every(([, r], i) => i === 0 || r <= tail[i - 1][1] + 1.5), 'tail decays monotonically (no re-swell)');

// ---- transients on the beat grid: HF (>2 kHz) envelope, first crossing of 30 % of the local rise within +-12 ms of every beat
// (kick click / snare / hats / pluck brightness sit on the beat; this is the mix-level proof, the per-note proof is onsets.mjs)
console.log('\nbeat-grid onsets in the final stem (HF envelope, ms from the nominal beat time):');
const hf = dsp.biquad(dsp.biquad(x, 'hp', 2000, 0.7), 'hp', 2000, 0.7);
const w = 12; // 0.25 ms
const env = new Float32Array(hf.length);
{ let acc = 0; for (let i = 0; i < hf.length; i++) { acc += Math.abs(hf[i]); if (i >= w) acc -= Math.abs(hf[i - w]); env[i] = acc / w; } }
const hfOnset = (t) => { // location of the strongest HF rise (0.25 ms env difference over 1 ms) within +-12 ms of the beat
  const a = Math.round((t - 0.012) * SR), z = Math.round((t + 0.012) * SR);
  let best = 0, bk = -1, base = 0;
  for (let k = a; k < z; k++) { const d = env[k + 48] - env[k]; if (d > best) { best = d; bk = k; } }
  for (let k = a - 2400; k < a; k++) base = Math.max(base, env[k]);
  if (bk < 0 || best < 3e-4) return null; // no clear transient in this window
  return ((bk + 24) / SR - t) * 1000; // centre of the steepest 1 ms rise
};
const offs = [];
for (let t = 30; t < 42; t += BEAT) { const o = hfOnset(t); if (o != null) offs.push({ t, o }); }
for (let t = 48; t < 50; t += BEAT) { const o = hfOnset(t); if (o != null) offs.push({ t, o }); }
console.log('  ' + offs.map((r) => `${f(r.t, 1)}:${f(r.o, 1)}`).join('  ').replace(/(.{150}\S*)\s/g, '$1\n  '));
const bad = offs.filter((r) => Math.abs(r.o) > 5);
const nbeats = (42 - 30) / BEAT + (50 - 48) / BEAT;
const med = [...offs].map((r) => Math.abs(r.o)).sort((a, c) => a - c)[Math.floor(offs.length / 2)];
check(offs.length >= 0.8 * nbeats, `a clear on-beat transient found at ${offs.length} of ${nbeats} beats (30-42, 48-50)`);
check(med <= 1.0, `median |offset| of the on-beat transients ${f(med, 2)} ms (<= 1 ms)`);
check(bad.length <= 0.25 * offs.length, `${offs.length - bad.length}/${offs.length} on-beat transients within +-5 ms; the rest are swell / slow-attack / filtered beats: ${bad.map((r) => f(r.t, 1) + '/' + f(r.o, 1)).join(' ')}`);
// beat-comb alignment: correlate the HF onset strength with a comb of beats, lag -20..+20 ms (ideal lag = 0)
{
  const os = new Float32Array(hf.length);
  for (let i = 12; i < hf.length; i++) os[i] = Math.max(0, env[i] - env[i - 12]);
  let best = -1, bl = 0;
  const res = [];
  for (let lag = -20; lag <= 20; lag++) {
    let s = 0;
    for (let t = 30; t < 42; t += BEAT) for (let i = Math.round(t * SR + (lag - 0.5) * SR / 1000); i <= Math.round(t * SR + (lag + 0.5) * SR / 1000); i++) s += os[i];
    res.push(s);
    if (s > best) { best = s; bl = lag; }
  }
  check(Math.abs(bl) <= 3, `beat-comb correlation peaks at lag ${bl} ms (|lag| <= 3 ms)`);
}

console.log(`\n${fails ? fails + ' FAILED' : 'ALL CHECKS PASSED'}`);
process.exit(fails ? 1 : 0);
