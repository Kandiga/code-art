#!/usr/bin/env node
// Pitch / key checks on the tonal recipes_b (solo renders): the dominant spectral peaks must land on the intended notes
// (A minor / C major, chord of the bar). Prints measured peaks with cents error and PASS/FAIL.
//   node audio/sfx/test_b/pitch_b.mjs
import * as dsp from '../../lib/dsp.mjs';
import * as cues from '../../../shared/cues.js';
import { renderEvent } from '../index.mjs';

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
/** strongest peaks (parabolic interpolation) in [t0,t1) seconds (relative to the cue time) between fLo..fHi */
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
const hz = (name) => dsp.midiToHz(dsp.noteToMidi(name));

// ---- SCRIPT (bar of C): bell C7, glow pips on the C-major pentatonic ladder E5 G5 A5 C6 D6 E6 G6 A6
{ const s = solo('typewriter_bell'); const p = peaks(s, 0.01, 0.12, 1500, 3000, 3, 8192);
  console.log('typewriter_bell', show(p)); ok(has(p, hz('C7'), 25), 'typewriter_bell fundamental = C7 (2093 Hz)'); }
{ const want = ['E5', 'G5', 'A5', 'C6', 'D6', 'E6', 'G6', 'A6'];
  const res = want.map((nm, i) => { const s = solo('typewriter_key', i); const p = peaks(s, 0.01, 0.2, 500, 2000, 6, 8192); return has(p, hz(nm), 30); });
  ok(res.every(Boolean), `typewriter_key glow pips climb ${want.join(' ')}  [${res.map((v) => (v ? 'y' : 'n')).join('')}]`); }
// ---- STORYBOARD (bar of G): panel knocks G4 B4 D5 G5 B5 D6
{ const want = ['G4', 'B4', 'D5', 'G5', 'B5', 'D6'];
  const res = want.map((nm, i) => { const s = solo('panel_snap', i); const p = peaks(s, 0.002, 0.08, 300, 1400, 5, 4096); return has(p, hz(nm), 40); });
  ok(res.every(Boolean), `panel_snap knocks climb ${want.join(' ')}  [${res.map((v) => (v ? 'y' : 'n')).join('')}]`); }
// ---- CAMERA (bar of Am): servo whine A4 -> E5, viewfinder blip A6, focus E6 -> A6
{ const s = solo('crane_servo'); const a = peaks(s, 0.93, 1.0, 380, 560, 2, 2048), m = peaks(s, 0.42, 0.58, 520, 800, 2, 8192);
  console.log('crane_servo    end', show(a), '| mid', show(m));
  ok(a.length && a[0].f < 500 && a[0].f > 420, 'crane_servo whine settles back toward A4 at the brake'); ok(m.length && m[0].f > 600 && m[0].f < 700, 'crane_servo whine reaches ~E5 mid-move'); }
{ const s = solo('viewfinder_on'); const p = peaks(s, 0.2, 0.3, 1500, 2100, 2, 4096);
  console.log('viewfinder_on  ', show(p)); ok(has(p, hz('A6'), 20), 'viewfinder rec-dot blip = A6'); }
{ const s = solo('focus_beep'); const p1 = peaks(s, 0.075, 0.12, 1000, 1600, 2, 2048), p2 = peaks(s, 0.16, 0.22, 1500, 2100, 2, 2048);
  console.log('focus_beep     ', show(p1), '|', show(p2)); ok(has(p1, hz('E6'), 30), 'focus_beep note 1 = E6'); ok(has(p2, hz('A6'), 30), 'focus_beep note 2 = A6'); }
{ const s = solo('drone_buzz'); const p = peaks(s, 0.2, 0.9, 150, 450, 6, 32768);
  console.log('drone_buzz     ', show(p)); ok(p.some((q) => Math.abs(cents(q.f, 220)) < 90 || Math.abs(cents(q.f, 329.63)) < 90), 'drone_buzz rotors cluster around A3 / E4'); }
// ---- LIGHT (bar of F): ring-outs F4 (key), A4 (fill), C6 (rim); hum F2 / A2 / C3 stack
{ const want = { key: ['F4', 87.31], fill: ['A4', 110], rim: ['C6', 130.81] };
  ['key', 'fill', 'rim'].forEach((k, i) => {
    const s = solo('light_clunk', i); const ring = peaks(s, 0.4, 1.2, 300, 1300, 4, 32768), hum = peaks(s, 0.3, 0.8, 60, 300, 4, 32768);
    console.log(`light_clunk ${k.padEnd(4)}`, 'ring', show(ring), '| hum', show(hum));
    ok(has(ring, hz(want[k][0]), 25), `light_clunk ${k} ring-out = ${want[k][0]}`);
    ok(has(hum, want[k][1], 60) || has(hum, want[k][1] * 2, 60), `light_clunk ${k} buzz on ${want[k][1]} Hz (F2/A2/C3 stack = F major)`); }); }
// ---- CAST (bar of C): foot marimba C4 E4 G4 A4 C5, strum C5 E5 G5 C6 E6
{ const want = ['C4', 'E4', 'G4', 'A4', 'C5'];
  const res = want.map((nm, i) => { const s = solo('foot_tap', i); const p = peaks(s, 0.01, 0.3, 240, 600, 5, 16384); return has(p, hz(nm), 40); });
  ok(res.every(Boolean), `foot_tap marimba marks ${want.join(' ')}  [${res.map((v) => (v ? 'y' : 'n')).join('')}]`); }
{ const s = solo('cast_ready'); const p = peaks(s, 0.1, 0.8, 480, 1700, 8, 32768);
  console.log('cast_ready     ', show(p)); ok(['C5', 'E5', 'G5', 'C6'].every((n) => has(p, hz(n), 30)), 'cast_ready = C major strum'); }
// ---- SCORE: A440 tuning swell, the ensemble must settle on A (partials of 55/110/220/440/880)
{ const s = solo('orch_tune'); const late = peaks(s, 0.62, 0.96, 400, 480, 3, 16384), early = peaks(s, 0.02, 0.18, 400, 480, 2, 16384), low = peaks(s, 0.62, 0.96, 90, 130, 2, 16384), hi = peaks(s, 0.62, 0.96, 800, 960, 2, 16384); // window ends at the release (0.965 s): the hall tail after it is not the ensemble
  console.log('orch_tune      early(oboe alone)', show(early), '| late A4', show(late), '| A2', show(low), '| A5', show(hi));
  ok(late.length && Math.abs(cents(late[0].f, 440)) < 12, 'orch_tune late A4 within 12 cents of 440 Hz (FFT bin = 11 cents)');
  ok(early.length && cents(early[0].f, 440) < 0 && cents(early[0].f, 440) > -45, 'orch_tune starts a little flat (tuning in)');
  ok(low.length && Math.abs(cents(low[0].f, 110)) < 15, 'orch_tune cellos/basses on A2'); ok(hi.length && Math.abs(cents(hi[0].f, 880)) < 18, 'orch_tune flutes on A5'); }
{ const s = solo('baton_whoosh'); const p = peaks(s, 0.02, 0.3, 700, 3200, 5, 16384);
  console.log('baton_whoosh   ', show(p)); ok(['D6', 'B5', 'G5', 'D5'].some((n) => has(p, hz(n), 40)), 'baton ribbons on the G chord (G B D)'); }
// ---- EDIT (bar of Am): clicks A4 C5 E5 A5 C6 E6
{ const want = ['A4', 'C5', 'E5', 'A5', 'C6', 'E6'];
  const res = want.map((nm, i) => { const s = solo('timeline_click', i); const p = peaks(s, 0.0, 0.1, 380, 1800, 5, 4096); return has(p, hz(nm), 40); });
  ok(res.every(Boolean), `timeline_click knocks climb ${want.join(' ')}  [${res.map((v) => (v ? 'y' : 'n')).join('')}]`);
  const s = solo('timeline_click', 6); const p = peaks(s, 0.0, 0.1, 380, 2200, 5, 4096); console.log('timeline_click @43.5 (chord C)', show(p)); ok(['C5', 'E5', 'G5', 'C6', 'E6', 'G6'].some((n) => has(p, hz(n), 40)), 'timeline_click at 43.5 uses a C-chord tone'); }
// ---- COLOR (bar of F): bloom F5 A5 C6
{ const s = solo('grade_set'); const p = peaks(s, 0.25, 1.0, 600, 1500, 5, 32768);
  console.log('grade_set      ', show(p)); ok(['F5', 'A5', 'C6'].every((n) => has(p, hz(n), 30)), 'grade_set bloom = F major (F5 A5 C6)'); }
// ---- FUTURES: sub on the bar root, hologram drone on C, neural / dream on the chord
{ const roots = [['C', 65.41], ['G', 49], ['A', 55]];
  roots.forEach(([nm, f], i) => { const s = solo('year_jump', i); const p = peaks(s, 0.5, 1.0, 30, 100, 3, 32768);
    console.log(`year_jump ${s.ev.t}`, show(p)); ok(has(p, f, 40) || has(p, f * 2, 40), `year_jump ${s.ev.t} sub on ${nm} (${f} Hz or octave)`); }); }
{ const s = solo('holo_hum'); const p = peaks(s, 0.8, 1.6, 100, 700, 7, 32768);
  console.log('holo_hum       ', show(p)); ok(['C3', 'G3', 'C4', 'E4'].every((n) => has(p, hz(n), 25)), 'holo_hum = C major drone (C3 G3 C4 E4)'); }
{ const s = solo('dream_shimmer'); const p = peaks(s, 1.2, 1.9, 150, 1000, 8, 32768);
  console.log('dream_shimmer  Am', show(p)); ok(['A3', 'C4', 'E4', 'A4'].some((n) => has(p, hz(n), 40)), 'dream_shimmer (46-48) built on Am'); }
{ const s = solo('swell_climax'); const p = peaks(s, 0.6, 1.4, 150, 800, 8, 32768);
  console.log('swell_climax   ', show(p)); ok(['F3', 'C4', 'F4', 'A4', 'C5'].some((n) => has(p, hz(n), 40)), 'swell_climax chord = F major'); }
// ---- END: logo chord C major, tagline C6 + A5, cta D6 -> G6, final impact C1 / G1 / C2
{ const s = solo('logo_resolve'); const p = peaks(s, 0.8, 2.0, 800, 3000, 6, 32768);
  console.log('logo_resolve   ', show(p)); ok(['C6', 'E6', 'G6', 'C7'].every((n) => has(p, hz(n), 30)), 'logo_resolve = C major bells'); }
{ const s = solo('tagline_tick'); const p = peaks(s, 0.01, 0.4, 600, 1300, 3, 16384);
  console.log('tagline_tick   ', show(p)); ok(has(p, hz('C6'), 30) && has(p, hz('A5'), 40), 'tagline_tick = C6 + A5 (F chord)'); }
{ const s = solo('cta_tick'); const p = peaks(s, 0.0, 0.12, 900, 1900, 3, 4096);
  console.log('cta_tick       ', show(p)); ok(has(p, hz('D6'), 40) || has(p, hz('G6'), 40), 'cta_tick pips D6 / G6 (G chord)'); }
{ const s = solo('impact_big'); const p = peaks(s, 0.4, 1.0, 25, 120, 4, 65536);
  console.log('impact_big     ', show(p)); ok(p.some((q) => q.f < 40 && q.f > 28), 'impact_big sub settles on C1 (32.7 Hz)'); }
{ const s = solo('riser'); const p = peaks(s, 3.84, 3.94, 700, 1500, 3, 4096);
  console.log('riser end      ', show(p)); ok(p.some((q) => Math.abs(cents(q.f, hz('C6'))) < 180 || Math.abs(cents(q.f, hz('C6') / 2)) < 180), 'riser glide arrives near C6 by the end'); }
// ---- harmony contract: recipes whose pitches are fixed in code assume this chord at their cue time (cues.CHORDS). If the music
// contract changes, this fails and tells you which recipes to retune.
{ const chordAt = (t) => { let ch = cues.chordAtBar(Math.floor((t + 1e-6) / cues.BAR)); if (Array.isArray(ch)) ch = ch[(t % cues.BAR) >= cues.BEAT * 2 - 1e-6 ? 1 : 0]; return ch; };
  const want = [
    ['typewriter_key', 'C'], ['typewriter_bell', 'C'], ['panel_pop_3d', 'G'], ['crane_servo', 'Am'], ['drone_buzz', 'Am'], ['viewfinder_on', 'Am'], ['focus_beep', 'Am'],
    ['light_clunk', 'F'], ['foot_tap', 'C'], ['cast_ready', 'C'], ['timeline_slide', 'Am'], ['grade_set', 'F'], ['holo_hum', 'C'], ['swell_climax', 'F'],
    ['push_whoosh', 'F'], ['logo_resolve', 'C'], ['tagline_tick', 'F'], ['cta_tick', 'G'], ['impact_big', 'C'],
  ];
  const bad = [];
  for (const [id, ch] of want) for (const ev of cues.SFX.filter((e) => e.id === id && e.t >= 26)) if (chordAt(ev.t) !== ch) bad.push(`${id}@${ev.t} wants ${ch}, bar has ${chordAt(ev.t)}`);
  ok(bad.length === 0, `harmony contract: ${want.length} fixed-pitch recipes sit on the expected chord of their bar${bad.length ? ' (' + bad.join('; ') + ')' : ''}`);
  const o = cues.SFX.find((e) => e.id === 'orch_tune');
  console.log(`      orch_tune: A440 tuning note over the bar chord ${chordAt(o.t)} (the brief: A440; over G it reads as G add9 / sus2 and resolves with the baton on 37.0)`); }
console.log(fails ? `\n${fails} CHECK(S) FAILED` : '\nall pitch checks passed');
process.exit(fails ? 1 : 0);
