#!/usr/bin/env node
// node audio/music/test_b/onsets.mjs
// LAYER-LEVEL timing: render every percussive / plucked layer DRY (cached) and measure, per note, where its energy really starts
// versus the nominal note time. The instruments claim "percussion / plucks start exactly at t": this proves it for the notes we use.
import { dsp, cues, f, pad, lpad, SR } from './util.mjs';
import { buildLayers, renderLayer } from '../score_b.mjs';
const PERC = /^(kick|snare|clap|hat|openhat|toms|cymJobs|crash|hitImpact|hitTimp|hitTaiko|hitCrash|timp|fKick|fSnare|fClap|fHat|fTaiko|fCrash|fTimp|finImpact|finTimp|finTaiko|finCrash|pulse\d|bass|fPulse|fBass|fHarp|eHarp|hit\d+|rImpact|eImpact)$/;
const layers = buildLayers().filter((l) => PERC.test(l.name));
let worstAll = 0, fails = 0;
console.log(pad('layer', 12) + pad('notes', 7) + pad('worst |dt| ms', 15) + pad('mean dt ms', 12) + 'first late/early notes');
for (const l of layers) {
  const b = renderLayer(l);
  const x = Float32Array.from(b.L, (v, i) => Math.abs(v) + Math.abs(b.R[i]));
  const notes = [...l.notes].sort((a, c) => a.t - c.t);
  const ds = [];
  for (let i = 0; i < notes.length; i++) {
    const t = notes[i].t;
    const nxt = i + 1 < notes.length ? notes[i + 1].t : t + 1;
    // window: 20 ms before .. min(next note - 2 ms, 60 ms) after. The onset is the START of the steepest 1 ms rise of the
    // (1 ms smoothed) envelope: immune to the previous note's decay tail (which a plain threshold crossing is not).
    const a = Math.round((t - 0.02) * SR), z = Math.round(Math.min(t + 0.06, nxt - 0.002) * SR);
    const w = 48;
    if (z <= a + 2 * w) continue;
    const env = new Float32Array(z - a + w);
    let acc = 0;
    for (let k = 0; k < env.length; k++) { acc += x[a + k] || 0; if (k >= w) acc -= x[a + k - w] || 0; env[k] = acc / w; }
    let best = 0, bk = -1;
    for (let k = w; k < z - a; k++) { const d = env[k + w] - env[k]; if (d > best) { best = d; bk = k; } }
    if (bk < 0 || best < 1e-4) continue;
    ds.push([(a + bk - w / 2 + w / 4) / SR - t, t]);
  }
  if (!ds.length) { console.log(pad(l.name, 12), 'no measurable notes'); continue; }
  const worst = ds.reduce((m, [d]) => Math.max(m, Math.abs(d)), 0) * 1000;
  const meanD = (ds.reduce((s, [d]) => s + d, 0) / ds.length) * 1000;
  const odd = ds.filter(([d]) => Math.abs(d) * 1000 > 5).slice(0, 3).map(([d, t]) => `${f(t, 3)}:${f(d * 1000, 1)}`).join(' ');
  worstAll = Math.max(worstAll, worst);
  console.log(pad(l.name, 12) + pad(ds.length, 7) + pad(f(worst, 2), 15) + pad(f(meanD, 2), 12) + odd);
  if (worst > 5) fails++;
}
console.log(`\nworst onset deviation over ${layers.length} layers: ${f(worstAll, 2)} ms   (${fails} layers over 5 ms)`);
function pad2() {}
process.exit(fails ? 1 : 0);
