#!/usr/bin/env node
// node audio/music/test_b/onsets.mjs
// LAYER-LEVEL timing: every percussive / plucked layer of the score is rendered note by note IN ISOLATION (one note alone in a
// short buffer, nominal time 0.5 s) and we measure where its energy really starts: the first sample above -40 dB of that note's
// own peak, versus the nominal time. (A plain threshold on the layer would be fooled by the previous note's tail.)
// Also prints the time to peak ("attack") for information: plucks have a few ms of rise, drums < 5 ms.
import * as inst from '../instruments.mjs';
import { f, pad, lpad, SR } from './util.mjs';
import { buildLayers } from '../score_b.mjs';
const PERC = /^(kick|snare|clap|hat|openhat|toms|cymJobs|hitImpact|hitTimp|hitTaiko|hitCrash|timp|fKick|fSnare|fClap|fHat|fTaiko|fCrash|fTimp|finImpact|finTimp|finTaiko|finCrash|pulse\d|bass|fPulse|fBass|fHarp|eHarp|hit\d+|rImpact|eImpact|sub|hitSub|finSub)$/;
const layers = buildLayers().filter((l) => PERC.test(l.name));
let worstAll = 0, fails = 0;
console.log(pad('layer', 11) + pad('instrument', 14) + pad('notes', 7) + pad('worst start ms', 16) + pad('mean start', 12) + pad('mean attack ms', 16) + 'late notes (>5 ms)');
for (const l of layers) {
  const seen = new Set();
  const picks = [];
  for (const n of l.notes) {
    const k = JSON.stringify([n.midi, Math.round((n.vel || 0) * 20), n.dur != null ? Math.round(n.dur * 20) : null, n.open, n.size, n.rim]);
    if (!seen.has(k)) { seen.add(k); picks.push(n); }
    if (picks.length >= 5) break;
  }
  const ds = [], att = [];
  for (const n of picks) {
    const b = inst.render(l.id, [{ ...n, t: 0.5, pan: n.pan }], { ...l.opts, seconds: 4 });
    let pk = 0, pi = 0;
    for (let i = 0; i < b.length; i++) { const v = Math.max(Math.abs(b.L[i]), Math.abs(b.R[i])); if (v > pk) { pk = v; pi = i; } }
    let s = 0;
    while (s < b.length && Math.max(Math.abs(b.L[s]), Math.abs(b.R[s])) < 0.01 * pk) s++;
    ds.push((s / SR - 0.5) * 1000);
    att.push((pi / SR - 0.5) * 1000);
  }
  const worst = Math.max(...ds.map(Math.abs));
  worstAll = Math.max(worstAll, worst);
  const late = ds.filter((d) => Math.abs(d) > 5).length;
  console.log(pad(l.name, 11) + pad(l.id, 14) + pad(picks.length, 7) + pad(f(worst, 2), 16) + pad(f(ds.reduce((a, c) => a + c, 0) / ds.length, 2), 12) + pad(f(att.reduce((a, c) => a + c, 0) / att.length, 1), 16) + (late ? late + ' LATE' : ''));
  if (worst > 5) fails++;
}
console.log(`\nworst note-start deviation over ${layers.length} layers: ${f(worstAll, 2)} ms   (${fails} layers over 5 ms)`);
process.exit(fails ? 1 : 0);
