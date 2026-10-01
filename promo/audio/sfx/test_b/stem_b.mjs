#!/usr/bin/env node
// Whole-stem checks for the t >= 26 half of the SFX stem (recipes_b): determinism, NaN/DC, coverage, per-second loudness printout,
// peaks, per-event onset/peak timing against cues, HIT alignment, ending (59.5 click-off must be finished by 60.0).
//   node audio/sfx/test_b/stem_b.mjs [--png]
import crypto from 'node:crypto';
import path from 'node:path';
import * as dsp from '../../lib/dsp.mjs';
import * as meter from '../../lib/meter.mjs';
import { spectrogramPng } from '../../lib/ff.mjs';
import { TMP, ensure } from '../../lib/paths.mjs';
import * as cues from '../../../shared/cues.js';
import { renderSfx, renderEvent, coverage, SPLIT } from '../index.mjs';

const { SR } = dsp;
const flags = new Set(process.argv.slice(2));
const hash = (b) => crypto.createHash('sha1').update(Buffer.from(b.L.buffer, b.L.byteOffset, b.L.byteLength)).update(Buffer.from(b.R.buffer, b.R.byteOffset, b.R.byteLength)).digest('hex').slice(0, 12);
const db = (v) => (v > 1e-12 ? 20 * Math.log10(v) : -240);
let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

const a = renderSfx(cues, { noLimit: true, quiet: true });
const b = renderSfx(cues, { noLimit: true, quiet: true });
check(hash(a) === hash(b), `deterministic: two renders have identical hash (${hash(a)})`);
check(a.length === 60 * SR, `length ${a.length} samples = 60.000 s`);
let nan = 0;
for (const ch of [a.L, a.R]) for (let i = 0; i < ch.length; i++) if (!Number.isFinite(ch[i])) nan++;
check(nan === 0, 'no NaN/Inf in the stem');
const miss = coverage(cues).filter((r) => r.first >= SPLIT && !r.ok);
check(miss.length === 0, `coverage: every id with t >= ${SPLIT} has a recipe${miss.length ? ' (missing: ' + miss.map((r) => r.id).join(', ') + ')' : ''}`);
const lateEv = cues.SFX.filter((e) => e.t >= SPLIT);
console.log(`      ${lateEv.length} events with t >= ${SPLIT}, ${new Set(lateEv.map((e) => e.id)).size} distinct ids`);

// ---- every individual recipe_b render must be finite, DC-free, clean at both ends
let bad = 0, worstDc = 0, worstHead = -240, worstTail = -240, worstPeak = -240;
const seen = new Map();
const evRows = [];
for (const ev of cues.SFX) {
  const n = seen.get(ev.id) || 0;
  seen.set(ev.id, n + 1);
  if (ev.t < SPLIT) continue;
  const r = renderEvent(ev, n, cues);
  const buf = r.buf;
  let pk = 0, first = -1, pkAt = 0, nanc = 0;
  for (let i = 0; i < buf.length; i++) {
    const m = Math.max(Math.abs(buf.L[i]), Math.abs(buf.R[i]));
    if (!Number.isFinite(m)) nanc++;
    if (m > pk) { pk = m; pkAt = i; }
  }
  const thr = pk * 0.0316; // -30 dB re the event's own peak
  for (let i = 0; i < buf.length; i++) if (Math.max(Math.abs(buf.L[i]), Math.abs(buf.R[i])) > thr) { first = i; break; }
  bad += nanc;
  const head = db(Math.max(Math.abs(buf.L[0]), Math.abs(buf.R[0]))), tail = db(Math.max(Math.abs(buf.L[buf.length - 1]), Math.abs(buf.R[buf.length - 1])));
  const dcv = meter.dcOffset(buf);
  worstDc = Math.max(worstDc, Math.abs(dcv.L), Math.abs(dcv.R));
  worstHead = Math.max(worstHead, head);
  worstTail = Math.max(worstTail, tail);
  worstPeak = Math.max(worstPeak, db(pk));
  const off = r.offsetSec || 0;
  evRows.push({ ev, onset: (first / SR - off) * 1000, peakAt: (pkAt / SR - off) * 1000, pre: off, pkDb: db(pk) + (ev.g || 0), end: ev.t - off + buf.length / SR });
}
check(bad === 0, 'no NaN/Inf in any recipe_b event render (fin() scrubs NaN to 0, so this must be checked in the recipe output too)');
check(worstPeak <= -2.99, `recipe peaks (before ev.g) all <= -3 dBFS (worst ${worstPeak.toFixed(2)})`);
check(worstDc < 5e-4, `worst per-event DC ${worstDc.toExponential(1)}`);
check(worstHead < -60 && worstTail < -60, `clean edges: first sample <= ${worstHead.toFixed(0)} dBFS, last sample <= ${worstTail.toFixed(0)} dBFS`);
const tp = meter.truePeak(a);
console.log(`      stem (pre-limiter) sample peak ${tp.samplePeakDb.toFixed(2)} dBFS, true peak ${tp.db.toFixed(2)} dBTP`);

// ---- ending: nothing after 60.0 by construction, the click-off must decay to silence by the last samples
const endTail = db(dsp.peakOf(a, 59.98, 60));
check(endTail < -50, `stem ends clean: last 20 ms peak ${endTail.toFixed(1)} dBFS`);

// ---- loudness per second (momentary-style, ungated K-weighted) + peak per second
console.log('\nLoudness per second of the t >= 26 stem (K-weighted LUFS ungated | sample peak dBFS | active events):');
for (let t = 26; t < 60; t++) {
  const st = meter.lufsGateStats(a, t, t + 1);
  const pkDb = meter.peakDb(a, t, t + 1);
  const act = lateEv.filter((e) => e.t >= t - 0.001 && e.t < t + 1).map((e) => e.id);
  const bars = '#'.repeat(Math.max(0, Math.round((st.ungated + 50) / 1.5)));
  console.log(`${String(t).padStart(2)}-${String(t + 1).padEnd(2)} ${st.ungated.toFixed(1).padStart(6)} LUFS  pk ${pkDb.toFixed(1).padStart(6)}  ${bars.padEnd(30)} ${[...new Set(act)].join(' ')}`);
}

// ---- timing of every event: onset (first sample within 30 dB of its peak) and peak time vs the cue time
console.log('\nEvent timing (ms relative to the cue, pre-roll already accounted for): t id onset peak pre-roll pk(dBFS incl. g)');
let late = 0;
for (const r of evRows) {
  const hitLike = ['impact_big', 'baton_whoosh', 'label_tick', 'grade_set', 'year_jump', 'light_clunk', 'page_snap', 'panel_snap', 'timeline_click', 'foot_tap', 'typewriter_key', 'typewriter_bell', 'projector_clickoff', 'viewfinder_on'].includes(r.ev.id);
  const flag = hitLike && Math.abs(r.peakAt) > 40 ? '  <-- peak off the cue' : '';
  if (flag) late++;
  console.log(`${r.ev.t.toFixed(3).padStart(7)}  ${r.ev.id.padEnd(18)} ${r.onset.toFixed(1).padStart(8)} ${r.peakAt.toFixed(1).padStart(8)} ${r.pre.toFixed(3).padStart(6)} ${r.pkDb.toFixed(1).padStart(6)}${flag}`);
}
check(late === 0, 'every hit-like event has its loudest sample within +-40 ms of its cue (pre-roll swells excluded by construction)');

// ---- HIT alignment (cues.HITS >= 26): a transient must start within 30 ms of the hit
console.log('\nHIT alignment (cues.HITS with t >= 26): peak in [t-5 ms, t+60 ms] vs the preceding 150 ms');
for (const h of cues.HITS.filter((x) => x.t >= SPLIT)) {
  const pre = meter.peakDb(a, h.t - 0.15, h.t - 0.01), post = meter.peakDb(a, h.t - 0.005, h.t + 0.06);
  const who = lateEv.filter((e) => Math.abs(e.t - h.t) < 0.06).map((e) => e.id);
  const soft = h.s === 'S';
  check(post > -60 && (post - pre > 3 || soft || who.length > 0), `HIT ${h.t} ${h.s} (${h.why || ''}): sfx [${who.join(', ')}], pre ${pre.toFixed(1)} -> ${post.toFixed(1)} dBFS`);
}

if (flags.has('--png')) {
  ensure(path.join(TMP, 'sfx_b'));
  const f = path.join(TMP, 'sfx_b', 'stem_b.wav');
  dsp.writeWav(f, a.slice(26, 60));
  spectrogramPng(f, path.join(TMP, 'sfx_b', 'stem_b.png'), { w: 2400, h: 700, legend: true, fscale: 'log', drange: 100 });
  console.log('spectrogram -> audio/build/tmp/sfx_b/stem_b.png');
}
console.log(fails ? `\n${fails} CHECK(S) FAILED` : '\nall checks passed');
process.exit(fails ? 1 : 0);
