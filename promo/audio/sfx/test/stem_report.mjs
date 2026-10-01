#!/usr/bin/env node
// Whole-stem checks: determinism, exact length, silence window, NaN/DC, peaks per half-bar, event timing, loudness.
//   node audio/sfx/test/stem_report.mjs [--png]      (--png writes spectrograms of the stem to audio/build/tmp/sfx/)
import crypto from 'node:crypto';
import path from 'node:path';
import * as dsp from '../../lib/dsp.mjs';
import * as meter from '../../lib/meter.mjs';
import { spectrogramPng } from '../../lib/ff.mjs';
import { TMP, ensure } from '../../lib/paths.mjs';
import * as cues from '../../../shared/cues.js';
import { renderSfx, renderEvent, SPLIT } from '../index.mjs';

const { SR } = dsp;
const hash = (b) => crypto.createHash('sha1').update(Buffer.from(b.L.buffer, b.L.byteOffset, b.L.byteLength)).update(Buffer.from(b.R.buffer, b.R.byteOffset, b.R.byteLength)).digest('hex').slice(0, 12);
const db = (v) => (v > 1e-12 ? 20 * Math.log10(v) : -240);
let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

const a = renderSfx(cues, { noLimit: true });
const b = renderSfx(cues, { noLimit: true });
check(hash(a) === hash(b), `deterministic: two renders have identical hash (${hash(a)})`);
check(a.length === 60 * SR, `length ${a.length} samples = 60.000 s`);
let nan = 0;
for (const ch of [a.L, a.R]) for (let i = 0; i < ch.length; i++) if (!Number.isFinite(ch[i])) nan++;
check(nan === 0, 'no NaN/Inf');
const sil = meter.silenceCheck(a, 22.0, 22.5);
check(sil.silent && meter.peakDb(a, 22.0, 22.5) === -Infinity || sil.peakDb < -120, `digital silence 22.0-22.5 (peak ${sil.peakDb} dBFS)`);
const pre = meter.peakDb(a, 21.9, 21.98), fadeTail = meter.peakDb(a, 21.99, 22.0);
console.log(`      audio just before the cut: ${pre.toFixed(1)} dBFS (21.90-21.98), ${fadeTail.toFixed(1)} dBFS (21.99-22.0, faded)`);
const post = meter.peakDb(a, 22.5, 22.52);
console.log(`      first 20 ms after the silence: ${post.toFixed(1)} dBFS (sub_drop/tear attack)`);
const dc = meter.dcOffset(a);
check(Math.abs(dc.L) < 1e-4 && Math.abs(dc.R) < 1e-4, `DC L ${dc.L.toExponential(1)} R ${dc.R.toExponential(1)}`);
const tp = meter.truePeak(a);
console.log(`      stem (pre-limiter) sample peak ${tp.samplePeakDb.toFixed(2)} dBFS, true peak ${tp.db.toFixed(2)} dBTP`);

// peak per half second, showing the event density
console.log('\nPeak per 0.5 s (dBFS) - bars show level:');
let line = '';
for (let t = 0; t < 26; t += 0.5) {
  const p = meter.peakDb(a, t, t + 0.5);
  line += `${t.toFixed(1).padStart(5)} ${p.toFixed(1).padStart(7)} ${'#'.repeat(Math.max(0, Math.round((p + 60) / 1.5)))}\n`;
}
console.log(line);
const over = [];
for (let t = 0; t < 60; t += 0.25) if (meter.peakDb(a, t, t + 0.25) > -3) over.push(t.toFixed(2));
console.log(`windows (0.25 s) above -3 dBFS before limiting: ${over.length ? over.join(' ') : 'none'}`);

// per-event timing: onset (first sample > 2 % of event peak) vs ev.t, only recipes_a events
console.log('\nEvent timing (solo render, trim+pan applied): t  id  onset-t(ms)  peak-t(ms)  pre-roll');
const seen = new Map();
let timingBad = 0;
for (const ev of cues.SFX) {
  const n = seen.get(ev.id) || 0;
  seen.set(ev.id, n + 1);
  if (ev.t >= SPLIT) continue;
  const r = renderEvent(ev, n, cues);
  const lin = dsp.dbToLin(ev.g || 0);
  const buf = r.buf;
  let pk = 0, pkI = 0;
  for (let i = 0; i < buf.length; i++) { const v = Math.max(Math.abs(buf.L[i]), Math.abs(buf.R[i])); if (v > pk) { pk = v; pkI = i; } }
  let on = 0;
  for (let i = 0; i < buf.length; i++) if (Math.max(Math.abs(buf.L[i]), Math.abs(buf.R[i])) > pk * 0.02) { on = i; break; }
  const onMs = (on / SR - (r.offsetSec || 0)) * 1000, pkMs = (pkI / SR - (r.offsetSec || 0)) * 1000;
  // a recipe may start up to 5 ms 'early' only via its declared pre-roll; the onset must be within [-4 ms, +120 ms] of the cue for transients
  const bad = (r.offsetSec || 0) > 0.25 || on / SR < 0 || onMs > 700;
  if (bad) timingBad++;
  console.log(`${ev.t.toFixed(3).padStart(7)}  ${ev.id.padEnd(18)} ${onMs.toFixed(1).padStart(7)} ${pkMs.toFixed(1).padStart(8)}  ${(r.offsetSec || 0).toFixed(3)}  g=${ev.g || 0}${bad ? '  <-- TIMING?' : ''}`);
  void lin;
}
check(timingBad === 0, 'all recipes_a events start within their declared pre-roll (<= 0.25 s) / <= 700 ms after the cue');

// HITS (camera shakes / flashes) must be backed by an SFX event within one frame and a real transient in the stem
console.log('\nHIT alignment (cues.HITS with t < ' + SPLIT + '):');
for (const h of cues.HITS.filter((x) => x.t < SPLIT)) {
  if (h.t === cues.FREEZE_T) {
    check(meter.peakDb(a, h.t, h.t + 0.5) < -120, `HIT ${h.t} (${h.why}): the freeze is the silence (digital zero 22.0-22.5)`);
    continue;
  }
  const near = cues.SFX.filter((e) => Math.abs(e.t - h.t) <= 1 / 30 + 1e-6);
  const post = meter.peakDb(a, h.t - 0.005, h.t + 0.1), pre2 = meter.peakDb(a, h.t - 0.25, h.t - 0.02);
  check(near.length > 0 && (post - pre2 > 3 || post > -8), `HIT ${h.t} ${h.s} (${h.why}): sfx [${near.map((e) => e.id).join(', ')}], transient ${pre2.toFixed(1)} -> ${post.toFixed(1)} dBFS`);
}

if (process.argv.includes('--png')) {
  ensure(path.join(TMP, 'sfx'));
  const f = path.join(TMP, 'sfx', 'stem_A.wav');
  dsp.writeWav(f, a.slice(0, 26));
  for (const [s, d, nm] of [[0, 9, 'stem_0_9'], [9, 9, 'stem_9_18'], [18, 8, 'stem_18_26']]) spectrogramPng(f, path.join(TMP, 'sfx', nm + '.png'), { start: s, dur: d, w: 1800, h: 520, fscale: 'log', drange: 90 });
  console.log('spectrograms: audio/build/tmp/sfx/stem_*.png');
}
console.log(fails ? `\n${fails} CHECK(S) FAILED` : '\nall checks passed');
process.exit(fails ? 1 : 0);
