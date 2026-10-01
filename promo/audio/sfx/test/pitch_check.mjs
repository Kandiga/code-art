#!/usr/bin/env node
// Pitch / key checks on the tonal recipes (solo renders): the dominant spectral peaks must land on the intended
// notes (A minor / C major, chord of the bar). Prints measured peaks with cents error and PASS/FAIL.
//   node audio/sfx/test/pitch_check.mjs
import * as dsp from '../../lib/dsp.mjs';
import * as cues from '../../../shared/cues.js';
import { renderEvent } from '../index.mjs';
import { kit } from '../recipes_a.mjs';

const { SR } = dsp;
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const cents = (f, ref) => 1200 * Math.log2(f / ref);
const noteName = (f) => { const m = dsp.hzToMidi(f); const r = Math.round(m); return `${NAMES[((r % 12) + 12) % 12]}${Math.floor(r / 12) - 1}(${((m - r) * 100).toFixed(0)}c)`; };
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}`); };

function solo(id, nth = 0) {
  const evs = cues.SFX.filter((e) => e.id === id);
  const ev = evs[nth];
  const r = renderEvent(ev, nth, cues);
  const mono = new Float32Array(r.buf.length);
  for (let i = 0; i < mono.length; i++) mono[i] = 0.5 * (r.buf.L[i] + r.buf.R[i]);
  return { mono, off: r.offsetSec || 0, ev };
}
/** strongest peaks (parabolic interp) in [t0,t1) seconds (relative to the event time) between fLo..fHi */
function peaks(sig, t0, t1, fLo, fHi, count = 4, N = 32768) {
  const start = Math.max(0, Math.round((t0 + sig.off) * SR));
  const mag = dsp.magSpectrum(sig.mono, N, start, true);
  const k0 = Math.floor((fLo * N) / SR), k1 = Math.ceil((fHi * N) / SR);
  const pk = [];
  for (let k = Math.max(2, k0); k < Math.min(mag.length - 2, k1); k++) {
    if (mag[k] > mag[k - 1] && mag[k] >= mag[k + 1]) {
      const a = Math.log(mag[k - 1] + 1e-20), b = Math.log(mag[k] + 1e-20), c = Math.log(mag[k + 1] + 1e-20);
      const d = (0.5 * (a - c)) / (a - 2 * b + c);
      pk.push({ f: ((k + d) * SR) / N, m: mag[k] });
    }
  }
  pk.sort((x, y) => y.m - x.m);
  const out = [];
  for (const p of pk) if (out.every((q) => Math.abs(cents(p.f, q.f)) > 60)) out.push(p);
  return out.slice(0, count);
}
const has = (list, f, tol = 40) => list.some((p) => Math.abs(cents(p.f, f)) < tol);
const show = (l) => l.map((p) => `${p.f.toFixed(1)}Hz ${noteName(p.f)}`).join('  ');

// train whistle: Am triad A4 C5 E5
{ const s = solo('train_whistle'); const p = peaks(s, 0.25, 0.6, 300, 800, 4);
  console.log('train_whistle  ', show(p));
  ok(has(p, 440, 45) && has(p, 523.25, 45) && has(p, 659.26, 45), 'train_whistle = A4 + C5 + E5 (A minor triad)'); }
// notification ping: E6 then A6
{ const s = solo('notification_ping'); const p1 = peaks(s, 0.02, 0.1, 1000, 2400, 2), p2 = peaks(s, 0.2, 0.4, 1000, 2400, 3);
  console.log('notification   ', show(p1), '|', show(p2));
  ok(has(p1, 1318.51, 25), 'notification_ping note 1 = E6'); ok(has(p2, 1760, 25), 'notification_ping note 2 = A6'); }
// horn: A2 -> E3
{ const s = solo('horn_distant'); const a = peaks(s, 0.45, 0.8, 70, 400, 3), b = peaks(s, 1.4, 1.9, 70, 400, 3);
  console.log('horn_distant   ', show(a), '|', show(b));
  ok(has(a, 110, 35), 'horn first note = A2 (110 Hz)'); ok(has(b, 164.81, 35), 'horn second note = E3 (164.8 Hz)'); }
// spot hum: F2 stack, NO F4 (349 Hz)
{ const s = solo('spot_clunk'); const p = peaks(s, 0.9, 1.5, 60, 600, 6);
  console.log('spot_clunk hum ', show(p));
  ok(has(p, 87.31, 40) && has(p, 174.62, 40), 'spot hum on F2/F3');
  ok(!has(p.slice(0, 5), 349.23, 35), 'spot hum has no F4 (would grind against piano E4 329.6 Hz)'); }
// beam hum: harmonics of A1 (55 Hz): no 5th harmonic (275 Hz, C#4)
{ const s = solo('beam_hum'); const p = peaks(s, 1.0, 2.0, 40, 700, 6);
  console.log('beam_hum       ', show(p));
  ok(has(p, 110, 30) || has(p, 55, 30), 'beam_hum built on A1 harmonics'); ok(!has(p.slice(0, 5), 275, 40), 'beam_hum has no C#4 (5th harmonic) partial'); }
// sub drop: tail sits near A0 (27.5) / A1 harmonics; early near 110 Hz
{ const s = solo('sub_drop'); const e = peaks(s, 0.02, 0.1, 30, 200, 2, 16384), l = peaks(s, 1.6, 2.4, 20, 100, 3, 65536);
  console.log('sub_drop       early', show(e), '| late', show(l));
  ok(l.length && l[0].f < 40, 'sub_drop settles below 40 Hz (A0 = 27.5 Hz target)'); }
// whoosh_down tonal glide ends on F4 (349 Hz)
{ const s = solo('whoosh_down'); const p = peaks(s, 0.44, 0.5, 250, 900, 2, 4096);
  console.log('whoosh_down end', show(p));
  ok(p.length && p[0].f > 300 && p[0].f < 420, 'whoosh_down tonal tail ends near F4 (349 Hz)'); }
// dive whoosh: tonal glide ends on the 5th of the NEXT bar's chord (analytic target from the recipe's own rule, measured near the end)
{ const evs = cues.SFX.filter((e) => e.id === 'dive_whoosh');
  const fifthPc = { Am: 4, F: 0, C: 7, G: 2 };
  evs.forEach((ev, i) => {
    const s = solo('dive_whoosh', i); const p = peaks(s, 0.455, 0.5, 400, 2200, 1, 2048);
    let nc = cues.chordAtBar(Math.floor((ev.t + 0.5 + 1e-6) / cues.BAR)); if (Array.isArray(nc)) nc = nc[0];
    const target = kit.hzNearPc(fifthPc[nc], 1300);
    const lo = target * Math.pow(2, -4 / 12), hi = target * Math.pow(2, 0.5 / 12);
    console.log(`dive_whoosh @${ev.t}  tone near end ${show(p)}  target 5th of ${nc} = ${target.toFixed(1)} Hz ${noteName(target)}`);
    ok(p.length > 0 && p[0].f > lo && p[0].f < hi, `dive ${i}: glide arrives at the 5th of ${nc} (measured on the rising edge, <= 4 semitones below the target)`);
  }); }
// eyes_open tinkle begins on E6 (= E4 piano x4)
{ const s = solo('eyes_open'); const p = peaks(s, 0.12, 0.3, 1000, 4000, 4);
  console.log('eyes_open      ', show(p));
  ok(has(p, 1318.5, 30), 'eyes_open tinkle contains E6 (octaves of the piano E4)'); }
// heart pops E5 then G5
{ const hp = cues.SFX.filter((e) => e.id === 'heart_pop'); const i1 = hp.findIndex((e) => e.t === 21.25); const a = solo('heart_pop', i1), b = solo('heart_pop', i1 + 1); const pa = peaks(a, 0.03, 0.08, 400, 1100, 1, 4096), pb = peaks(b, 0.03, 0.08, 400, 1100, 1, 4096);
  console.log('heart_pop      ', show(pa), '|', show(pb));
  ok(has(pa, 659.26, 60), 'heart_pop #1 ~ E5'); ok(has(pb, 783.99, 60), 'heart_pop #2 ~ G5'); }
// chime run (G major) and colour bloom (G major partials): every strong spectral line must be a G-major pitch class
{ const pcOf = (f) => ((Math.round(dsp.hzToMidi(f)) % 12) + 12) % 12;
  const gmaj = [7, 9, 11, 0, 2, 4, 6]; // G A B C D E F#
  const s = solo('chime_run'); const p = peaks(s, 0.5, 1.2, 600, 5000, 6);
  console.log('chime_run ring ', show(p));
  ok(p.every((q) => gmaj.includes(pcOf(q.f))), 'chime_run: all strong partials are G-major pitch classes');
  const b = solo('color_bloom'); const q = peaks(b, 0.5, 1.2, 300, 4500, 6);
  console.log('color_bloom    ', show(q));
  ok(q.every((x) => gmaj.includes(pcOf(x.f))), 'color_bloom: all strong partials are G-major pitch classes');
  const w = solo('digital_scan'); const st = cues.SFX.find((e) => e.id === 'digital_scan').dur / 16;
  const steps = [];
  for (let i = 0; i < 16; i++) { const pk = peaks(w, i * st + 0.004, i * st + 0.02, 900, 9000, 1, 1024); if (pk.length) steps.push(pk[0].f); }
  console.log('digital_scan steps', steps.map((f) => noteName(f)).join(' '));
  ok(steps.length >= 14 && steps.every((f) => [0, 2, 4, 7, 9].includes(pcOf(f))), 'digital_scan: every blip is a C-major-pentatonic pitch class (C D E G A)'); }
console.log(fails ? `\n${fails} FAILED` : '\nall pitch checks passed');
process.exit(fails ? 1 : 0);
