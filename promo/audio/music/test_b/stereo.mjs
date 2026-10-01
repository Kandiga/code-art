#!/usr/bin/env node
// node audio/music/test_b/stereo.mjs [stem.wav]   - width / mono-compatibility per 2 s window:
//   side-to-mid level (dB), L/R correlation, correlation of the <150 Hz band (must stay ~ +1: centred, mono-safe low end),
//   mono-fold loss (how many dB the stem loses when summed to mono vs. its stereo RMS: >3 dB = phasey).
import { dsp, meter, load, f, pad, lpad, SR } from './util.mjs';
const b = load(process.argv[2] || 'music_b');
const lo = (x) => dsp.biquad(dsp.biquad(x, 'lp', 150, 0.7), 'lp', 150, 0.7);
const corr = (a, c, i0, i1) => { let sa = 0, sc = 0, sac = 0; for (let i = i0; i < i1; i++) { sa += a[i] * a[i]; sc += c[i] * c[i]; sac += a[i] * c[i]; } return sac / Math.sqrt(sa * sc + 1e-30); };
const L = b.L, R = b.R;
const lL = lo(L), lR = lo(R);
console.log(pad('window', 9) + lpad('S/M dB', 8) + lpad('corr', 7) + lpad('LF corr', 9) + lpad('mono loss', 11));
let worstLF = 1, worstLoss = 0;
for (let t = 26; t < 60; t += 2) {
  const i0 = Math.round(t * SR), i1 = Math.round((t + 2) * SR);
  let m = 0, s = 0, st = 0, mn = 0;
  for (let i = i0; i < i1; i++) { const M = 0.5 * (L[i] + R[i]), S = 0.5 * (L[i] - R[i]); m += M * M; s += S * S; st += 0.5 * (L[i] * L[i] + R[i] * R[i]); mn += M * M; }
  const sm = 10 * Math.log10((s + 1e-30) / (m + 1e-30));
  const loss = 10 * Math.log10((st + 1e-30) / (mn + 1e-30));
  const c = corr(L, R, i0, i1), cl = corr(lL, lR, i0, i1);
  if (t >= 28 && t < 58) { worstLF = Math.min(worstLF, cl); worstLoss = Math.max(worstLoss, loss); }
  console.log(pad(`${t}-${t + 2}`, 9) + lpad(f(sm), 8) + lpad(f(c, 2), 7) + lpad(f(cl, 2), 9) + lpad(f(loss, 1), 11));
}
console.log(`\nworst LF correlation ${f(worstLF, 2)} (want > 0.9),  worst mono-fold loss ${f(worstLoss, 1)} dB (want < 3)`);
process.exit(worstLF > 0.9 && worstLoss < 3 ? 0 : 1);
