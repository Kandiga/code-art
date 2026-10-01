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
  const r = riseTime(x, 36.90, 37.15, 0.35);
  check(Math.abs(r.t - 37.0) <= 0.005, `baton hit onset ${f(r.t, 4)} s (nominal 37.0, |d| = ${f(Math.abs(r.t - 37) * 1000, 2)} ms)`);
  const rf = riseTime(x, 57.85, 58.3, 0.25);
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

// ---- transients on the beat grid (every beat of 26..42 and 48..50, where drums/plucks sit on the grid)
console.log('\nbeat-grid onsets (|offset| of the strongest rise within +-30 ms of each beat, ms):');
const offs = [];
const beatsList = [];
for (let t = 26; t < 42; t += BEAT) beatsList.push(t);
for (let t = 48; t < 50; t += BEAT) beatsList.push(t);
for (const t of beatsList) offs.push({ t, ...onsetNear(x, t) });
const line = offs.map((o) => `${f(o.t, 1)}:${f(o.offsetMs, 1)}`).join('  ');
console.log('  ' + line.replace(/(.{150}\S*)\s/g, '$1\n  '));
const worst = offs.reduce((a, b) => (Math.abs(b.offsetMs) > Math.abs(a.offsetMs) ? b : a));
const over = offs.filter((o) => Math.abs(o.offsetMs) > 5);
check(over.length === 0, `all ${offs.length} beat onsets within +-5 ms (worst ${f(worst.offsetMs, 2)} ms at ${f(worst.t, 2)} s; ${over.length} over: ${over.map((o) => f(o.t, 2) + '/' + f(o.offsetMs, 1)).join(' ')})`);

console.log(`\n${fails ? fails + ' FAILED' : 'ALL CHECKS PASSED'}`);
process.exit(fails ? 1 : 0);
