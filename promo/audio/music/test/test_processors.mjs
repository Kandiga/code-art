// node audio/music/test/test_processors.mjs  - era processors: behaviour measured with numbers
import * as inst from '../instruments.mjs';
import { dsp, meter, f } from './lib.mjs';
import { check, section, summary } from '../../lib/test/harness.mjs';
const { SR, Buf } = dsp;
const P = inst.processors;

const bandDb = (buf, lo, hi) => {
  // RMS-ish level (dB) of the band [lo,hi] from an averaged power spectrum
  const N = 16384; let acc = 0, cnt = 0;
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let s = 0; s + N <= buf.length; s += N) {
    for (let i = 0; i < N; i++) { re[i] = buf.L[s + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)); im[i] = 0; }
    dsp.FFT.get(N).transform(re, im);
    for (let k = 1; k < N / 2; k++) { const fr = (k * SR) / N; if (fr >= lo && fr < hi) { acc += re[k] ** 2 + im[k] ** 2; cnt++; } }
  }
  return 10 * Math.log10(acc / Math.max(1, cnt) + 1e-30);
};
const pink = (sec, seed = 5, rms = 0.1) => Buf.from(dsp.noise('pink', Math.round(sec * SR), seed, { rms }), dsp.noise('pink', Math.round(sec * SR), seed + 1, { rms }));
const sine = (hz, sec, a = 0.5) => { const x = dsp.osc('sine', hz, Math.round(sec * SR)).map((v) => v * a); return Buf.from(x, Float32Array.from(x)); };
const zeroCrossHz = (x, t0, t1) => { let c = 0; const a = Math.round(t0 * SR), b = Math.round(t1 * SR); for (let i = a + 1; i < b; i++) if (x[i - 1] < 0 && x[i] >= 0) c++; return c / (t1 - t0); };

section('tapeWobble');
{
  const s = sine(1000, 12);
  const w = P.tapeWobble(s, { wow: 0.004, flutter: 0.001 });
  check('length preserved', w.length === s.length);
  const f0 = zeroCrossHz(w.L, 0.5, 1.5), f1 = zeroCrossHz(w.L, 10.5, 11.5);
  // frequency track in 0.1 s windows
  const tr = []; for (let t = 1; t < 11; t += 0.1) tr.push(zeroCrossHz(w.L, t, t + 0.1));
  const dev = Math.max(...tr) - Math.min(...tr);
  check(`pitch really wobbles (peak-to-peak ${f(dev, 1)} Hz at 1 kHz)`, dev > 3 && dev < 25);
  const mean = tr.reduce((a, b) => a + b, 0) / tr.length;
  check(`mean pitch unchanged (${f(mean, 2)} Hz)`, Math.abs(mean - 1000) < 1.5);
  // no drift in time: the final sample position is mapped back to itself
  let lagBest = 0, best = -1;
  const a = Math.round(11 * SR);
  for (let lag = -200; lag <= 200; lag++) { let c = 0; for (let i = 0; i < 2000; i++) c += w.L[a + i] * s.L[a + i + lag]; if (c > best) { best = c; lagBest = lag; } }
  check(`no cumulative time drift (best lag at 11 s = ${lagBest} samples; tracks the wow only)`, Math.abs(lagBest) < 0.004 * SR);
  const w2 = P.tapeWobble(s, { wow: 0.004, flutter: 0.001 });
  check('deterministic', w2.L.every((v, i) => v === w.L[i]));
}
section('reelHiss / vinylCrackle');
{
  const z = new Buf(6);
  const h = P.reelHiss(z, { levelDb: -48 });
  const r = meter.rmsDb(h);
  check(`reelHiss RMS ${f(r)} dBFS (target -48)`, Math.abs(r + 48) < 2.5);
  check('hiss is bright-ish (4-8 kHz louder than 100-300 Hz)', bandDb(h, 4000, 8000) > bandDb(h, 100, 300) + 3);
  const v = P.vinylCrackle(z, { levelDb: -26, rate: 22 });
  let pops = 0, pk = 0;
  const lv = Math.pow(10, -26 / 20);
  for (let i = 0; i < v.length; i++) { const a = Math.abs(v.L[i]); if (a > 0.3 * lv && (i === 0 || Math.abs(v.L[i - 1]) <= 0.3 * lv)) pops++; if (a > pk) pk = a; }
  check(`crackle pops/s ${f(pops / 6, 1)} (rate 22 + big 0.5) and peak ${f(20 * Math.log10(pk))} dBFS (level -26)`, pops / 6 > 3 && pops / 6 < 60 && pk > lv * 0.4 && pk < lv * 10);
  const v2 = P.vinylCrackle(z, { levelDb: -26, rate: 22 });
  check('crackle deterministic', v2.L.every((x, i) => x === v.L[i]));
}
section('opticalSoundtrack');
{
  const src = pink(6);
  const o = P.opticalSoundtrack(src, { hissDb: -120 });
  const rel = (lo, hi) => bandDb(o, lo, hi) - bandDb(src, lo, hi); // transfer function in dB
  const mid = rel(800, 1200);
  check(`lows removed (60-100 Hz ${f(rel(60, 100) - mid)} dB re 1 kHz)`, rel(60, 100) - mid < -14);
  check(`highs removed (8-12 kHz ${f(rel(8000, 12000) - mid)} dB re 1 kHz)`, rel(8000, 12000) - mid < -28);
  check(`nasal bump present (2.2-2.8 kHz ${f(rel(2200, 2800) - mid)} dB re 1 kHz)`, rel(2200, 2800) - mid > 1);
  let cc = 0, ee = 0, e2 = 0;
  for (let i = 0; i < o.length; i++) { cc += o.L[i] * o.R[i]; ee += o.L[i] ** 2; e2 += o.R[i] ** 2; }
  check(`near-mono (L/R correlation ${f(cc / Math.sqrt(ee * e2), 3)})`, cc / Math.sqrt(ee * e2) > 0.9);
}
section('lofiPhone');
{
  const src = pink(6);
  const o = P.lofiPhone(src, {});
  const rel = (lo, hi) => bandDb(o, lo, hi) - bandDb(src, lo, hi);
  const mid = rel(700, 3000);
  check(`mono (L == R)`, o.L.every((v, i) => v === o.R[i]));
  check(`below 250 Hz ${f(rel(40, 250) - mid)} dB re mid`, rel(40, 250) - mid < -18);
  check(`above 6 kHz ${f(rel(6000, 12000) - mid)} dB re mid`, rel(6000, 12000) - mid < -22);
  check('finite', o.L.every(Number.isFinite));
}
section('brickwallBright / warmTape / goldenAge / monoize');
{
  const loud = pink(5, 9, 0.35);
  const b = P.brickwallBright(loud, { ceilingDb: -1 });
  const tp = meter.truePeak(b);
  check(`true peak ${f(tp.db, 2)} dBTP <= -0.95`, tp.db <= -0.95);
  const air = bandDb(P.brickwallBright(pink(4, 3, 0.05), { airDb: 3, driveDb: 0 }), 9000, 14000) - bandDb(pink(4, 3, 0.05), 9000, 14000);
  check(`air shelf lifts the top (+${f(air)} dB at 9-14 kHz)`, air > 1.5);
  const w = P.warmTape(pink(3), {}), g = P.goldenAge(pink(3), {});
  check('warmTape / goldenAge finite, length kept', w.L.every(Number.isFinite) && g.L.every(Number.isFinite) && w.length === 3 * SR && g.length === 3 * SR);
  const m = P.monoize(pink(2), 1);
  check('monoize(1) -> L == R', m.L.every((v, i) => Math.abs(v - m.R[i]) < 1e-7));
}
summary('processor tests');
