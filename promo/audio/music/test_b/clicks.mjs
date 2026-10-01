#!/usr/bin/env node
// node audio/music/test_b/clicks.mjs [stem.wav]   - click / discontinuity scan.
// High-passes at 6 kHz, finds samples whose |hp| exceeds 18 dB over the local (+-25 ms) RMS of the same band and which are NOT a
// planned transient (a beat / 16th grid event within 3 ms is a drum or pluck by design). Lists the worst offenders by time.
import { dsp, meter, load, mono, f, pad, lpad, SR } from './util.mjs';
import * as cues from '../../../shared/cues.js';
const b = load(process.argv[2] || 'music_b');
const x = mono(b);
const hp = dsp.biquad(dsp.biquad(x, 'hp', 6000, 0.7), 'hp', 6000, 0.7);
const n = hp.length, W = Math.round(0.025 * SR);
const sq = new Float64Array(n + 1);
for (let i = 0; i < n; i++) sq[i + 1] = sq[i] + hp[i] * hp[i];
const grid = cues.BEAT / 8; // 1/32 note
const hits = [];
for (let i = W; i < n - W; i++) {
  const v = Math.abs(hp[i]);
  if (v < 3e-4) continue;
  const rms = Math.sqrt(((sq[i + W] - sq[i - W]) - hp[i] * hp[i]) / (2 * W)) + 1e-9;
  const ratio = 20 * Math.log10(v / rms);
  if (ratio > 18) {
    const t = i / SR;
    const off = Math.abs(t / grid - Math.round(t / grid)) * grid * 1000;
    hits.push({ t, ratio, v, off });
  }
}
// merge hits within 5 ms
const merged = [];
for (const h of hits) { const l = merged[merged.length - 1]; if (l && h.t - l.t < 0.005) { if (h.ratio > l.ratio) Object.assign(l, h); } else merged.push({ ...h }); }
const off = merged.filter((h) => h.off > 3); // not within 3 ms of a 1/32-note grid point
console.log(`${merged.length} HF spikes >18 dB over the local level; ${off.length} are off the 1/32 grid by > 3 ms`);
for (const h of off.sort((a, c) => c.ratio - a.ratio).slice(0, 15)) console.log(`  ${f(h.t, 4)} s   +${f(h.ratio, 1)} dB over local   level ${f(20 * Math.log10(h.v), 1)} dBFS   (grid offset ${f(h.off, 1)} ms)`);
console.log('worst on-grid spikes (drum/pluck attacks by design):');
for (const h of merged.filter((q) => q.off <= 3).sort((a, c) => c.v - a.v).slice(0, 5)) console.log(`  ${f(h.t, 4)} s   level ${f(20 * Math.log10(h.v), 1)} dBFS`);
