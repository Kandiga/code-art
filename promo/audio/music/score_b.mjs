#!/usr/bin/env node
// =============================================================================
// audio/music/score_b.mjs - ORIGINAL score for t = 26.0 .. 60.0 ("score-B"):
//   THE EIGHT JOBS (26-42) -> THE FUTURES (42-50) -> RECAP (50-54) -> END CARD (54-60)
//
//   import { renderScoreB, masterBus } from './score_b.mjs'
//   renderScoreB(buf, ctx?)   adds the score for 26..60 s into `buf` (a 60 s dsp.Buf) and returns a report object
//   masterBus(buf)            the gentle master (glue comp + safety limiter, peak <= -2 dBFS), shared with render.mjs
//   node audio/music/score_b.mjs --solo     -> audio/build/stems/music_b.wav (60 s long, digital silence before 26.0)
//
// ctx (all optional, shared convention with score_a):
//   { log: fn|false (default console.log), cache: bool (default true: content-addressed layer cache in build/tmp),
//     only: [layer names], skip: [layer names] }          (only/skip are debugging aids)
//
// EVERYTHING is timed from shared/cues.js (BEAT/BAR/CHORDS/MOTIF/MUSIC.sections/HITS/VO/SFX). One tempo, one motif
// (E4 G4 A4 C5, once also in retrograde), one 4-chord loop (C G Am F), deterministic (seeded RNG only), 48 kHz float32.
// Arrangement table + design notes: audio/music/SCORE_B.md
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as dsp from '../lib/dsp.mjs';
import * as th from '../lib/theory.mjs';
import * as cues from '../../shared/cues.js';
import * as inst from './instruments.mjs';
import { TMP, ensure, stemPath } from '../lib/paths.mjs';

const { Buf, SR, addAt, mulberry32, seedOf, clamp, dbToLin } = dsp;
const { BEAT, BAR } = cues;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(TMP, 'score_b_cache');

// -----------------------------------------------------------------------------
// the timing contract, read from cues (nothing below hard-codes a time that cues owns)
// -----------------------------------------------------------------------------
const SEC = Object.fromEntries(cues.MUSIC.sections.map((s) => [s.id, s]));
const STEM = Object.fromEntries(SEC.jobs.stems.map((s) => [s.id, s.t]));
export const TIME = {
  start: SEC.jobs.t0, // 26.0 pulse enters
  jobsEnd: SEC.jobs.t1, // 42.0
  futureStart: SEC.future.t0,
  futureEnd: SEC.future.t1, // 50.0
  recapStart: SEC.recap.t0,
  recapEnd: SEC.recap.t1, // 54.0
  endStart: SEC.end.t0,
  end: cues.DURATION,
  baton: cues.HITS.find((h) => /orchestra hit/i.test(h.why || '')).t, // 37.0 (L)
  climax: cues.SFX.find((e) => e.id === 'swell_climax').t, // 48.0 (kick returns)
  finalHit: cues.MUSIC.endHit.t, // 58.0
  clickOff: cues.MUSIC.projectorClickOff, // 59.5 (SFX stem)
  tag: 28 * BAR + BAR / 2, // 57.0 F -> G half-bar (cues.CHORDS[28] = ['F','G'])
  stems: STEM,
};
const bar = (t) => Math.round(t / BAR);
const barsBetween = (a, b) => Array.from({ length: bar(b) - bar(a) }, (_, i) => bar(a) + i);
const chordOfBar = (b) => th.chordForTime(b * BAR + 1e-6).name;
const st = (b, step) => b * BAR + (step * BEAT) / 4; // 16th-note step inside bar b
const bt = (b, beat) => b * BAR + beat * BEAT;

// -----------------------------------------------------------------------------
// small utilities
// -----------------------------------------------------------------------------
const hv = (rng, v, amt = 0.06) => clamp(v + (rng() - 0.5) * 2 * amt, 0.05, 1);
const seg = (a, b, x) => clamp((x - a) / (b - a), 0, 1);
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

/** all n-note voicings of chord `name` inside [lo,hi] (every chord tone present, no minor 2nds, no clusters low down) */
function voicingCandidates(name, lo, hi, n, maxSpan) {
  const pcs = th.chordPitchClasses(name);
  const pool = [];
  for (let m = lo; m <= hi; m++) if (pcs.includes(((m % 12) + 12) % 12)) pool.push(m);
  const out = [];
  const rec = (start, cur) => {
    if (cur.length === n) {
      if (!pcs.every((pc) => cur.some((m) => m % 12 === pc))) return;
      if (cur[n - 1] - cur[0] > maxSpan) return;
      for (let i = 1; i < n; i++) {
        const d = cur[i] - cur[i - 1];
        if (d < 2 || (d === 2 && cur[i - 1] < 66) || (d < 3 && cur[i - 1] < 55)) return;
      }
      out.push(cur.slice());
      return;
    }
    for (let i = start; i < pool.length; i++) {
      cur.push(pool[i]);
      rec(i + 1, cur);
      cur.pop();
    }
  };
  rec(0, []);
  return out;
}
/** minimum-motion voice leading through a chord list (dynamic programming). Returns one sorted MIDI array per chord. */
export function voiceLead(names, { lo = 48, hi = 76, n = 4, center = null, maxSpan = 17, topWeight = 0.6 } = {}) {
  const ctr = center != null ? center : (lo + hi) / 2;
  const cand = names.map((nm) => {
    const c = voicingCandidates(nm, lo, hi, n, maxSpan);
    if (!c.length) throw new Error(`voiceLead: no voicing for ${nm} in ${lo}..${hi} with ${n} voices`);
    return c;
  });
  const move = (a, b) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i]);
    return s + topWeight * Math.abs(a[n - 1] - b[n - 1]) + 0.25 * Math.abs(a[0] - b[0]);
  };
  const reg = (c) => 0.35 * Math.abs(mean(c) - ctr);
  let prev = cand[0].map((c) => ({ c, cost: reg(c), back: -1 }));
  const table = [prev];
  for (let i = 1; i < names.length; i++) {
    const cur = cand[i].map((c) => {
      let best = Infinity, bi = 0;
      prev.forEach((p, j) => {
        const v = p.cost + move(p.c, c);
        if (v < best) { best = v; bi = j; }
      });
      return { c, cost: best + reg(c), back: bi };
    });
    table.push(cur);
    prev = cur;
  }
  let bi = 0;
  prev.forEach((p, j) => { if (p.cost < prev[bi].cost) bi = j; });
  const out = new Array(names.length);
  for (let i = names.length - 1; i >= 0; i--) {
    out[i] = table[i][bi].c;
    bi = table[i][bi].back;
  }
  return out;
}
/** chord spans -> sustained notes; a pitch that stays in the next chord is TIED (no re-attack): smooth, breathing pads */
function tieChords(spans, voicings, { vel = 0.6, rng = null, velAt = null } = {}) {
  const notes = [];
  const active = new Map();
  spans.forEach((sp, i) => {
    const mset = new Set(voicings[i]);
    for (const [m, n] of [...active]) if (!mset.has(m)) { notes.push(n); active.delete(m); }
    for (const m of voicings[i]) {
      if (active.has(m)) active.get(m).dur = sp.t1 - active.get(m).t;
      else {
        const v = velAt ? velAt(sp, m, i) : vel;
        active.set(m, { t: sp.t0, dur: sp.t1 - sp.t0, midi: m, vel: rng ? hv(rng, v, 0.04) : v });
      }
    }
  });
  for (const n of active.values()) notes.push(n);
  return notes.sort((a, b) => a.t - b.t || a.midi - b.midi);
}
const spansOf = (b0, b1, col = (n) => n) => barsBetween(b0 * BAR, b1 * BAR).map((b) => ({ name: col(chordOfBar(b)), t0: b * BAR, t1: b * BAR + BAR, bar: b }));

// -----------------------------------------------------------------------------
// layer rendering with a content-addressed disk cache (key = instrument id + notes + options + hash of the instrument sources)
// -----------------------------------------------------------------------------
let SRC_HASH = null;
function srcHash() {
  if (SRC_HASH) return SRC_HASH;
  const h = crypto.createHash('sha1');
  for (const dir of [path.join(HERE, 'instruments'), path.join(HERE, '..', 'lib')]) {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.mjs')).sort()) h.update(f).update(fs.readFileSync(path.join(dir, f)));
  }
  h.update(fs.readFileSync(path.join(HERE, 'instruments.mjs'))).update(fs.readFileSync(path.join(HERE, 'presets.mjs')));
  SRC_HASH = h.digest('hex').slice(0, 12);
  return SRC_HASH;
}
function renderCached(ctx, id, notes, opts = {}) {
  const key = crypto.createHash('sha1').update(JSON.stringify([id, notes, opts])).update(srcHash()).digest('hex').slice(0, 20);
  const file = path.join(CACHE_DIR, `${id}_${key}.f32`);
  if (ctx.cache && fs.existsSync(file)) {
    try {
      const raw = fs.readFileSync(file);
      const start = raw.readUInt32LE(0), len = raw.readUInt32LE(4);
      const f = new Float32Array(raw.buffer.slice(raw.byteOffset + 8, raw.byteOffset + 8 + len * 8));
      const b = new Buf(cues.DURATION);
      b.L.set(f.subarray(0, len), start);
      b.R.set(f.subarray(len, 2 * len), start);
      return b;
    } catch (e) { /* fall through and re-render */ }
  }
  const b = inst.render(id, notes, { seconds: cues.DURATION, ...opts });
  if (ctx.cache) {
    let a = 0, z = b.length;
    while (a < z && b.L[a] === 0 && b.R[a] === 0) a++;
    while (z > a && b.L[z - 1] === 0 && b.R[z - 1] === 0) z--;
    const len = z - a;
    const out = Buffer.alloc(8 + len * 8);
    out.writeUInt32LE(a, 0);
    out.writeUInt32LE(len, 4);
    Buffer.from(b.L.buffer, b.L.byteOffset + a * 4, len * 4).copy(out, 8);
    Buffer.from(b.R.buffer, b.R.byteOffset + a * 4, len * 4).copy(out, 8 + len * 4);
    try { ensure(CACHE_DIR); fs.writeFileSync(file, out); } catch (e) { /* the cache is optional */ }
  }
  return b;
}

/** render one layer spec of buildLayers() dry (cached) -> Buf; used by the tests */
export const renderLayer = (layer, ctx = { cache: true }) => renderCached(ctx, layer.id, layer.notes, layer.opts);

// =============================================================================
// LEVELS: dB trims on top of the per-instrument calibration (unit balance ~ -26 LUFS per layer) - the mix lives here
// =============================================================================
export const LV = {
  // jobs
  pulse: -5.5, bass: -9, sub: -14, kick: -9, snare: -6.5, clap: -9, hat: -5, openhat: -8, toms: -10, crash: -10,
  impactS: -22, impactM: -15,
  pad: -9.5, strOst: -8, strMotif: -8, strSwell: -13,
  horns: -9, trumpets: -6, lowbrass: -13, choir: -8, timp: -11, taiko: -11,
  // future
  fChoirPad: -8, fChoirMel: -8, fHarp: -7, fCel: -9, fShim: -9, fStr: -11, fSub: -14, fHorns: -9, fTrump: -7, fLow: -13,
  // recap / end
  rStr: -10, rTimp: -11, rRiser: -6, rRewind: -14, rTape: -8, rLow: -13, eChoir: -9, eShim: -10, eHarp: -9, eStr: -11, eSub: -13,
  hit: -4,
};

// per-bus reverb sends: [preset, wet, overrides]. One reverb per bus per group (never per note).
const BUS = {
  synth: ['plate', 0.16], bass: null, sub: null, kick: null, snare: ['plate', 0.2, { decay: 1.1 }], hats: ['room', 0.1], toms: ['hall', 0.2], cym: ['hall', 0.18],
  pad: ['bigHall', 0.3], strings: ['hall', 0.26], brass: ['bigHall', 0.26], choir: ['cathedral', 0.28], perc: ['hall', 0.22], fx: ['bigHall', 0.16],
  harp: ['hall', 0.3], bells: ['hall', 0.32], shimmer: ['cathedral', 0.2], air: ['plate', 0.12],
  finale: ['cathedral', 0.34, { decay: 3.3, size: 2.7, damp: 0.5, preDelay: 0.03 }], finaleDry: null,
};

// =============================================================================
// THE LAYERS: {name, grp, bus, id (instrument), notes, opts, g (dB), pan}
//   grp: jobs | jobsHit (the 37.0 baton hit) | future | recap | end | final   (groups get their own cuts / dips / filters)
// =============================================================================
export function buildLayers() {
  const L = [];
  const add = (name, grp, bus, id, notes, opts = {}, g = 0, pan = 0) => {
    if (notes && notes.length) L.push({ name, grp, bus, id, notes, opts, g, pan });
  };
  const rngFor = (n) => mulberry32(seedOf('scoreB', n));
  const jobsBars = barsBetween(TIME.start, TIME.jobsEnd); // 13..20
  const futBars = barsBetween(TIME.futureStart, TIME.futureEnd); // 21..24
  const recBars = barsBetween(TIME.recapStart, TIME.recapEnd); // 25, 26
  const [b13] = jobsBars;
  const bPulseEnd = bar(TIME.jobsEnd);
  const bDrums = bar(STEM.drums), bStr = bar(STEM.strings), bOrch = bar(STEM.orchestra), bStut = bar(STEM.stutter), bFilt = bar(STEM.filter_open);
  const bBaton = Math.floor(TIME.baton / BAR + 1e-9); // bar 18 (the hit lands on beat 3 of it)
  const motifAt = (t0, o = {}) => th.motifEvents(t0, o);

  const PULSE_ROOT = { C: 48, G: 43, Am: 45, F: 41 };
  const BASS_ROOT = { C: 36, G: 31, Am: 33, F: 29 };
  const TIMP_ROOT = { C: 48, G: 43, Am: 45, F: 41 };

  // ===========================================================================
  // 26.0  PULSE - 8th-note filtered-saw pluck on the chord roots (alone for the first bar, under "She writes.")
  //       the motif is quoted by the pulse itself as a 16th-note run on the last beat of bars 13 and 16 (E G A C)
  // ===========================================================================
  {
    const rng = rngFor('pulse');
    const ACC = [0.95, 0.5, 0.78, 0.55, 0.9, 0.5, 0.78, 0.62];
    const chunks = [
      { a: STEM.pulse, b: STEM.drums, o: { brightScale: 0.8, decay: 0.13 }, v: 0.85 },
      { a: STEM.drums, b: STEM.orchestra, o: { brightScale: 0.95, decay: 0.15 }, v: 0.92 },
      { a: STEM.orchestra, b: TIME.jobsEnd, o: { brightScale: 1.12, decay: 0.17 }, v: 1.0 },
    ];
    const pickupBars = new Set([jobsBars[0], jobsBars[3]]);
    chunks.forEach((c, ci) => {
      const notes = [];
      for (const b of barsBetween(c.a, c.b)) {
        const root = PULSE_ROOT[chordOfBar(b)];
        for (let i = 0; i < 8; i++) {
          if (pickupBars.has(b) && i >= 6) continue;
          notes.push({ t: b * BAR + (i * BEAT) / 2, dur: (BEAT / 2) * 0.86, midi: root + (i === 3 || i === 7 ? 12 : 0), vel: hv(rng, ACC[i] * c.v, 0.04), pan: i % 2 ? 0.12 : -0.12 });
        }
        if (pickupBars.has(b)) {
          motifAt(st(b, 12), { stretch: 0.25, rhythm: 'even', vel: [0.62, 0.7, 0.78, 0.92] }).forEach((e, k) => notes.push({ t: e.t, dur: (BEAT / 4) * (k === 3 ? 1.5 : 0.85), midi: e.midi, vel: e.vel, pan: 0 }));
        }
      }
      add('pulse' + ci, 'jobs', 'synth', 'synth_pulse', notes, c.o, LV.pulse);
    });
  }

  // ===========================================================================
  // 28.0  BASS - syncopated 3+3+2 root line (analog bass) + a long sub-808 under each downbeat; the last hit of a bar
  //       anticipates the next root (except G -> Am, where it would rub against the pulse)
  // ===========================================================================
  {
    const rng = rngFor('bass');
    const STEPS = [0, 3, 6, 8, 11, 14], LEN = [3, 3, 2, 3, 3, 2], VEL = [1, 0.72, 0.82, 0.92, 0.72, 0.84];
    const bn = [], sn = [];
    for (const b of barsBetween(STEM.bass, TIME.jobsEnd)) {
      const name = chordOfBar(b), nxt = chordOfBar(b + 1);
      const r = BASS_ROOT[name];
      STEPS.forEach((s, k) => {
        let m = r;
        if (k === 2 && b % 2 === 0) m = r + 12; // octave pop on the 3rd hit every other bar
        if (k === 5 && b + 1 < bPulseEnd && !(name === 'G' && nxt === 'Am')) m = BASS_ROOT[nxt];
        bn.push({ t: st(b, s), dur: LEN[k] * (BEAT / 4) * 0.92, midi: m, vel: hv(rng, VEL[k], 0.05) });
      });
      sn.push({ t: b * BAR, dur: BAR * 0.8, midi: r, vel: 0.85 });
    }
    add('bass', 'jobs', 'bass', 'synth_bass', bn, {}, LV.bass);
    add('sub', 'jobs', 'sub', 'sub808', sn, { decay: 1.1, drive: 2.0 }, LV.sub);
  }

  // ===========================================================================
  // 30.0  DRUMS - 120 BPM groove, a fill into every bar line; four-on-the-floor from the orchestra on
  // ===========================================================================
  {
    const rng = rngFor('drums');
    const K = [], S = [], C = [], H = [], HO = [], T = [], CR = [], SW = [];
    const kickA = [0, 6, 8, 14], kick4 = [0, 4, 8, 12];
    const drumBars = barsBetween(STEM.drums, TIME.jobsEnd);
    const b15 = bDrums, b16 = b15 + 1, b17 = b15 + 2, b18 = bOrch, b19 = bStut, b20 = bFilt;
    const fillBars = new Set([b15, b16, b17, b18]);
    for (const b of drumBars) {
      const rel = b - b15;
      const four = b >= bOrch;
      const sixteenth = b >= bStr;
      (four ? kick4 : kickA).forEach((s) => K.push({ t: st(b, s), vel: hv(rng, s === 0 ? 1 : 0.82, 0.04), midi: 33 }));
      [4, 12].forEach((s) => {
        if (s === 12 && fillBars.has(b)) return;
        S.push({ t: st(b, s), vel: hv(rng, 0.92, 0.04) });
        C.push({ t: st(b, s), vel: hv(rng, 0.8, 0.05) });
      });
      for (let s = 0; s < 16; s += sixteenth ? 1 : 2) {
        if (b === bBaton && s >= 4) continue; // the roll / the hit own 36.5..38.0
        const accent = s % 4 === 0 ? 0.8 : s % 2 === 0 ? 0.55 : 0.28;
        H.push({ t: st(b, s), vel: hv(rng, accent * (0.8 + 0.2 * seg(0, 5, rel)), 0.05), pan: 0.22 });
      }
      if (rel >= 1 && rel % 2 === 1 && b !== b20) HO.push({ t: st(b, 14), vel: 0.7, open: true, dur: 0.22, pan: 0.2 });
    }
    // fills into the bar lines
    [[12, 0.8], [13, 0.4], [14, 0.62], [15, 0.9]].forEach(([s, v]) => S.push({ t: st(b15, s), vel: v })); // bar 15 -> pads (snare 16ths)
    S.push({ t: st(b16, 12), vel: 0.85 });
    [57, 55, 52, 48].forEach((m, i) => T.push({ t: st(b16, 12 + i), midi: m, vel: [0.7, 0.78, 0.86, 0.95][i], pan: -0.5 + i * 0.33 })); // bar 16 -> strings (toms)
    inst.drumRoll(st(b17, 10), st(b18, 0) - 0.03, { rate: 16, vel: [0.25, 0.95], seed: 3 }).forEach((n) => S.push(n)); // bar 17 -> orchestra (snare roll)
    SW.push({ t: st(b17, 8), dur: BAR / 2, vel: 0.7, swell: true }); // cymbal swell peaking ON 36.0
    SW.push({ t: bt(b18, 0), dur: TIME.baton - bt(b18, 0), vel: 0.8, swell: true }); // second swell peaking ON the baton hit
    [57, 55, 52, 48].forEach((m, i) => T.push({ t: st(b18, 12 + i), midi: m, vel: [0.75, 0.82, 0.9, 1][i], pan: 0.5 - i * 0.33 })); // bar 18 -> stutter (toms)
    inst.drumRoll(st(b20, 6), st(b20, 15), { rate: 16, vel: [0.3, 1], seed: 5 }).forEach((n) => S.push(n)); // bar 20 -> the future (roll under the filter)
    CR.push({ t: bt(b19, 0), vel: 0.55, dur: 2.0 }, { t: bt(b20, 0), vel: 0.5, dur: 2.0 });
    // the baton bar (36.0-38.0): kick on 36.0 and from 37.5; the timpani roll / hit own 36.5..37.5
    const bb = bt(b18, 0);
    const keepK = K.filter((n) => !(n.t > bb + 0.01 && n.t < bt(b18, 3) - 0.01));
    const inHitSpace = (n) => n.t > bb + 0.01 && n.t < bt(b18, 3) - 0.01;
    const keepS = S.filter((n) => !inHitSpace(n));
    const keepC = C.filter((n) => !inHitSpace(n));
    keepS.push({ t: st(b18, 12), vel: 0.85 });
    add('kick', 'jobs', 'kick', 'kick', keepK, { variant: 'tight' }, LV.kick);
    add('snare', 'jobs', 'snare', 'snare', keepS, { variant: 'crack' }, LV.snare);
    add('clap', 'jobs', 'snare', 'clap', keepC, {}, LV.clap);
    add('hat', 'jobs', 'hats', 'hat', H, {}, LV.hat);
    add('openhat', 'jobs', 'hats', 'hat', HO, { open: true }, LV.openhat);
    add('toms', 'jobs', 'toms', 'toms', T, {}, LV.toms);
    add('cymJobs', 'jobs', 'cym', 'cymbal', CR, {}, LV.crash);
    add('cymSwell', 'jobs', 'cym', 'cymbal', SW, {}, LV.crash);
  }

  // ===========================================================================
  // 32.0  PADS - warm wide pad, voice-led (min. motion, common tones tied): Fmaj7 Cadd9 Gsus2 Am7 Fmaj7
  // ===========================================================================
  {
    const rng = rngFor('pad');
    const COL = { C: 'Cadd9', G: 'Gsus2', Am: 'Am7', F: 'Fmaj7' };
    const spans = spansOf(bar(STEM.pads), bPulseEnd, (n) => COL[n]);
    const v = voiceLead(spans.map((s) => s.name), { lo: 48, hi: 72, n: 4, center: 60 });
    const notes = tieChords(spans, v, { rng, velAt: (sp) => 0.5 + 0.06 * (sp.bar - bar(STEM.pads)) });
    add('pad', 'jobs', 'pad', 'synth_pad', notes, { width: 1.35 }, LV.pad);
  }

  // ===========================================================================
  // 34.0  STRINGS - driving 16th ostinato (inversions that keep the line compact) + the motif as a violin counter-line
  // ===========================================================================
  {
    const rng = rngFor('strings');
    const IDX = [0, 1, 2, 1, 0, 1, 2, 1, 0, 1, 2, 1, 0, 1, 2, 3];
    const VOIC = { C: [60, 64, 67, 72], G: [62, 67, 71, 74], Am: [60, 64, 69, 72], F: [60, 65, 69, 72] };
    const notes = [];
    for (const b of barsBetween(STEM.strings, TIME.jobsEnd)) {
      const vo_ = VOIC[chordOfBar(b)];
      const ramp = 0.8 + 0.2 * seg(0, 5, b - bStr);
      for (let i = 0; i < 16; i++) notes.push({ t: st(b, i), dur: 0.11, midi: vo_[IDX[i]], vel: hv(rng, (i % 4 === 0 ? 0.8 : 0.52) * ramp, 0.05), pan: -0.15 + 0.1 * (IDX[i] % 3) });
    }
    add('strOst', 'jobs', 'strings', 'strings_ostinato', notes, {}, LV.strOst);
    // counter-line: motif (E5 G5 A5 C6) over the first bar of the strings, held C6 rings into the baton bar
    const mel = motifAt(bt(bStr, 0), { octave: 1, vel: [0.74, 0.56, 0.62, 0.86] }).map((e) => ({ ...e, dur: e.dur * 0.98 }));
    add('strMotif', 'jobs', 'strings', 'strings_high', mel, { vibScale: 1.05 }, LV.strMotif);
    // a sustained high bed under bars 19-20 (the motif is up in the brass): Am7 / Fmaj7 swells, voice-led
    const sp = spansOf(bStut, bPulseEnd, (n) => ({ Am: 'Am7', F: 'Fmaj7' }[n]));
    const vv = voiceLead(sp.map((s) => s.name), { lo: 64, hi: 88, n: 4, center: 76 });
    add('strHigh', 'jobs', 'strings', 'strings', tieChords(sp, vv, { vel: 0.62 }), { art: 'swell' }, LV.strSwell);
  }

  // ===========================================================================
  // 36.0  FULL ORCHESTRA: 36.0-37.0 swell (horns, trumpets, low brass, strings, choir, timpani roll, cymbal swell) ->
  //       37.0 THE BATON-DOWN HIT (G major, L) -> 38-42 brass states the motif over Am / F, choir + timpani underneath
  // ===========================================================================
  {
    const b18 = bBaton;
    const tB = bt(b18, 0), tH = TIME.baton;
    const rng = rngFor('orch');
    const GMAJ = { horns: [55, 62, 67, 71], trump: [74, 79, 83], low: [43, 50], str: [55, 62, 67, 71, 74], choir: [55, 59, 62, 67, 71, 74] };
    const buildDur = tH - tB - 0.02; // the build stops 20 ms before the hit (then the group is dipped)
    // --- build (36.0 .. 37.0)
    add('hornsBuild', 'jobs', 'brass', 'horns', GMAJ.horns.map((m) => ({ t: tB, dur: buildDur, midi: m, vel: 0.85 })), { art: 'swell' }, LV.horns);
    add('trumpBuild', 'jobs', 'brass', 'trumpets', GMAJ.trump.map((m) => ({ t: tB, dur: buildDur, midi: m, vel: 0.8 })), { art: 'swell' }, LV.trumpets - 3);
    add('lowBuild', 'jobs', 'brass', 'brass_low', GMAJ.low.map((m) => ({ t: tB, dur: buildDur, midi: m, vel: 0.85 })), { art: 'swell' }, LV.lowbrass);
    add('strBuild', 'jobs', 'strings', 'strings', GMAJ.str.map((m) => ({ t: tB, dur: buildDur, midi: m, vel: 0.8 })), { art: 'swell' }, LV.strSwell + 1);
    add('choirBuild', 'jobs', 'choir', 'choir', GMAJ.choir.map((m) => ({ t: tB, dur: buildDur, midi: m, vel: 0.75 })), { vowel: 'o>a', singers: 6, attack: 0.7 }, LV.choir);
    add('timpRoll', 'jobs', 'perc', 'timpani', inst.drumRoll(tB, tH - 0.06, { midi: 43, rate: 16, vel: [0.25, 1], seed: 11 }), {}, LV.timp);
    // --- THE HIT (37.0): everything lands together; sharp transients (impact crack, timpani, taiko, crash) pin it to the grid
    const H = 'jobsHit';
    add('hitImpact', H, 'fx', 'impact', [{ t: tH, vel: 1, size: 'L' }], {}, LV.hit - 1);
    add('hitSub', H, 'sub', 'sub808', [{ t: tH, dur: 1.6, midi: 31, vel: 1 }], { decay: 1.5, drive: 2.2 }, LV.sub + 1);
    add('hitTimp', H, 'perc', 'timpani', [{ t: tH, dur: 1.6, midi: 43, vel: 1 }, { t: tH, dur: 1.6, midi: 50, vel: 0.85 }], {}, LV.timp + 1);
    add('hitTaiko', H, 'perc', 'taiko', [{ t: tH, midi: 43, vel: 1, rim: true }], {}, LV.taiko);
    add('hitLow', H, 'brass', 'brass_low', GMAJ.low.map((m) => ({ t: tH, dur: 1.2, midi: m, vel: 1 })), { attackScale: 0.4 }, LV.lowbrass + 1);
    add('hitHorns', H, 'brass', 'horns', GMAJ.horns.map((m) => ({ t: tH, dur: 1.2, midi: m, vel: 1 })), { attackScale: 0.35 }, LV.horns + 1);
    add('hitTrump', H, 'brass', 'trumpets', GMAJ.trump.map((m) => ({ t: tH, dur: 1.0, midi: m, vel: 0.95 })), { attackScale: 0.5 }, LV.trumpets);
    add('hitStr', H, 'strings', 'strings', GMAJ.str.map((m) => ({ t: tH, dur: 1.2, midi: m, vel: 0.9 })), { attackScale: 0.25 }, LV.strSwell + 3);
    add('hitStrLow', H, 'strings', 'strings_low', [43, 50].map((m) => ({ t: tH, dur: 1.2, midi: m, vel: 0.9 })), { attackScale: 0.25 }, LV.strSwell + 2);
    add('hitChoir', H, 'choir', 'choir', GMAJ.choir.map((m) => ({ t: tH, dur: 1.2, midi: m, vel: 0.9 })), { vowel: 'a', singers: 8, attack: 0.08, release: 1.2 }, LV.choir + 1);
    add('hitCrash', H, 'cym', 'cymbal', [{ t: tH, vel: 1, dur: 3.5 }], {}, LV.crash + 1);
    // --- 38 .. 42: motif in brass (E4 G4 A4 C5 horns, E5 G5 A5 C6 trumpets) over Am then F; low brass pedal, choir, timpani
    const bars2 = [bStut, bFilt];
    const mh = [], mt = [], low = [], tim = [];
    bars2.forEach((b, i) => {
      mh.push(...motifAt(bt(b, 0), { octave: 0, vel: [0.92, 0.72, 0.78, 0.98] }).map((e) => ({ ...e, dur: e.dur * 0.97 })));
      mt.push(...motifAt(bt(b, 0), { octave: 1, vel: [0.88, 0.7, 0.76, 0.95] }).map((e) => ({ ...e, dur: e.dur * 0.97 })));
      const nm = chordOfBar(b);
      low.push({ t: bt(b, 0), dur: BAR * 0.96, midi: BASS_ROOT[nm] + (nm === 'Am' ? 12 : 12), vel: 0.82 });
      [0, 8].forEach((s) => tim.push({ t: st(b, s), dur: 1.0, midi: TIMP_ROOT[nm], vel: hv(rng, s ? 0.78 : 0.95, 0.03) }));
      if (i === 0) tim.push(...inst.drumRoll(st(b, 12), st(b, 15), { midi: TIMP_ROOT[nm], rate: 16, vel: [0.3, 0.8], seed: 13 }));
    });
    tim.push(...inst.drumRoll(st(bFilt, 11), st(bFilt, 15) + 0.0, { midi: TIMP_ROOT.F, rate: 16, vel: [0.3, 1], seed: 17 }));
    add('hornsMotif', 'jobs', 'brass', 'horns', mh, {}, LV.horns);
    add('trumpMotif', 'jobs', 'brass', 'trumpets', mt, {}, LV.trumpets);
    add('lowPed', 'jobs', 'brass', 'brass_low', low, {}, LV.lowbrass);
    add('timp', 'jobs', 'perc', 'timpani', tim, {}, LV.timp);
    // the choir: after the hit's G (held to 38.0 by hitChoir) Am then F, voice-led, whole bars
    const csp = spansOf(bStut, bPulseEnd);
    const cv = voiceLead(csp.map((s) => s.name), { lo: 52, hi: 79, n: 5, center: 65, maxSpan: 19 });
    add('choir', 'jobs', 'choir', 'choir', tieChords(csp, cv, { vel: 0.66 }), { vowel: 'o>a', singers: 6, attack: 0.6 }, LV.choir);
  }

  // ===========================================================================
  // 42.0  THE FUTURE - same four chords, FULL MAJOR colours (Cadd9 / Gsus2 / Am7 / Fmaj7); ethereal choir, harp ripples
  //       (C6 arpeggio feel), celesta, granular shimmer; the motif sung in major; 46.0-50.0 builds, the kick returns at 48.0
  // ===========================================================================
  {
    const rng = rngFor('future');
    const [f0, f1, f2, f3] = futBars;
    const FCOL = { C: 'Cadd9', G: 'Gsus2', Am: 'Am7', F: 'Fmaj7' };
    const spans = spansOf(f0, f3 + 1, (n) => FCOL[n]);
    const roots = futBars.map(chordOfBar);
    const BASS = { C: 36, G: 31, Am: 33, F: 29 };
    // choir pad (chords, voice-led) with a swell that grows toward the climax
    const cv = voiceLead(spans.map((s) => s.name), { lo: 52, hi: 79, n: 5, center: 66, maxSpan: 19 });
    add('fChoirPad', 'future', 'choir', 'choir', tieChords(spans, cv, { velAt: (sp) => [0.52, 0.5, 0.62, 0.85][sp.bar - f0] }), { vowel: 'o>a', singers: 6, attack: 0.9, release: 1.4 }, LV.fChoirPad);
    // choir melody: the motif in C major (bar 21), its retrograde as the answer (bar 22), the motif again (bar 23)
    const mel = [
      ...motifAt(bt(f0, 0), { octave: 1, vel: [0.7, 0.55, 0.6, 0.85] }).map((e) => ({ ...e, dur: e.dur * 0.98 })),
      { t: bt(f1, 0), dur: BEAT, midi: 84, vel: 0.72 }, { t: bt(f1, 1), dur: BEAT / 2, midi: 81, vel: 0.56 }, { t: bt(f1, 1.5), dur: BEAT / 2, midi: 79, vel: 0.52 }, { t: bt(f1, 2), dur: 2 * BEAT, midi: 76, vel: 0.7 },
      ...motifAt(bt(f2, 0), { octave: 1, vel: [0.62, 0.5, 0.55, 0.78] }).map((e) => ({ ...e, dur: e.dur * 0.98 })),
    ];
    add('fChoirMel', 'future', 'choir', 'choir', mel, { vowel: 'a', singers: 4, attack: 0.16, release: 0.5, vibScale: 1.1 }, LV.fChoirMel);
    // harp ripples (16th-note up/down arpeggios on the colour chords); velocity grows with the build
    const RIP = {
      C: [60, 64, 67, 69, 72, 76, 79, 81, 84], // C6
      G: [55, 57, 62, 64, 67, 69, 74, 76, 79], // G6sus2
      Am: [57, 60, 64, 67, 69, 72, 76, 79, 81], // Am7
      F: [53, 57, 60, 64, 65, 69, 72, 76, 77], // Fmaj7
    };
    const harp = [];
    futBars.forEach((b, i) => {
      const m = RIP[chordOfBar(b)];
      th.arp(m, b * BAR, { pattern: 'updown', step: BEAT / 4, count: 16, dur: 0.2, vel: (k) => hv(rng, (0.4 + 0.1 * i) * (k % 4 === 0 ? 1.15 : 0.85) * (0.8 + 0.2 * Math.sin((k / 16) * Math.PI)), 0.04) }).forEach((n) => harp.push({ ...n, pan: -0.45 + (n.midi - 53) * 0.03 }));
    });
    add('fHarp', 'future', 'harp', 'harp', harp, { ring: 2.4 }, LV.fHarp);
    // celesta echo of the motif two octaves up (bar 22, half-speed) + a high twinkle on each downbeat
    const cel = motifAt(bt(f1, 2), { octave: 2, stretch: 0.5, vel: [0.6, 0.5, 0.52, 0.7] });
    cel.push(...[[f0, 96], [f1, 91], [f2, 93], [f3, 89]].map(([b, m]) => ({ t: bt(b, 0), dur: 1.0, midi: m, vel: 0.5 })));
    add('fCel', 'future', 'bells', 'celesta', cel, {}, LV.fCel);
    // granular shimmer (one per bar)
    add('fShim', 'future', 'shimmer', 'shimmer', futBars.map((b, i) => ({ t: b * BAR, dur: BAR * 0.95, midi: [72, 67, 69, 77][i], vel: [0.55, 0.55, 0.65, 0.85][i] })), { attack: 1.0, release: 1.8 }, LV.fShim);
    // sub pedal (soft 808 on the roots) - the floor of the room; no kick until the climax
    add('fSub', 'future', 'sub', 'sub808', futBars.map((b, i) => ({ t: b * BAR, dur: BAR * 0.9, midi: BASS[roots[i]], vel: [0.55, 0.5, 0.6, 0.9][i] })), { decay: 1.6, drive: 1.6 }, LV.fSub);
    // strings: ethereal high swells (bar 22 on), tremolo growing in 2150, full from 48.0
    const sp2 = spansOf(f1, f3 + 1, (n) => FCOL[n]);
    const sv = voiceLead(sp2.map((s) => s.name), { lo: 62, hi: 88, n: 4, center: 76 });
    add('fStr', 'future', 'strings', 'strings', tieChords(sp2, sv, { velAt: (sp) => [0.45, 0.6, 0.9][sp.bar - f1] }), { art: 'swell' }, LV.fStr);
    add('fStrTrem', 'future', 'strings', 'strings_tremolo', tieChords(spansOf(f2, f3, (n) => FCOL[n]), voiceLead([FCOL[roots[2]]], { lo: 60, hi: 86, n: 4, center: 74 }), { vel: 0.7 }), { section: 'high' }, LV.fStr - 1);
    // 2150 build: low brass swell on the A pedal, horns swell, timpani roll, snare roll, cymbal swell peaking on 48.0
    const t48 = TIME.climax;
    add('fLowSwell', 'future', 'brass', 'brass_low', [{ t: bt(f2, 0), dur: BAR, midi: BASS.Am + 12, vel: 0.7 }], { art: 'swell' }, LV.fLow);
    add('fHornsSwell', 'future', 'brass', 'horns', [57, 64, 69, 72].map((m) => ({ t: bt(f2, 0), dur: BAR, midi: m, vel: 0.62 })), { art: 'swell' }, LV.fHorns);
    add('fTimpRoll', 'future', 'perc', 'timpani', inst.drumRoll(bt(f2, 1), t48 - 0.03, { midi: TIMP_ROOT.Am, rate: 14, vel: [0.15, 0.95], seed: 21 }), {}, LV.timp);
    add('fSnareRoll', 'future', 'snare', 'snare', inst.drumRoll(t48 - BEAT * 1.5, t48 - 0.03, { rate: 16, vel: [0.2, 0.95], seed: 23 }), {}, LV.snare - 1);
    add('fCymSwell', 'future', 'cym', 'cymbal', [{ t: t48 - BEAT * 2, dur: BEAT * 2, vel: 0.8, swell: true }], {}, LV.crash);
    // 48.0 CLIMAX (Fmaj7, F bass): kick returns + taiko + timpani + crash; brass/strings/choir state the motif in C major
    const kk = [], sn_ = [], cl = [], ht = [], pu = [], bs = [], ti = [];
    const bC = f3;
    [0, 4, 8, 12].forEach((s) => kk.push({ t: st(bC, s), vel: s === 0 ? 1 : 0.85, midi: 33 }));
    [4, 12].forEach((s) => { sn_.push({ t: st(bC, s), vel: 0.9 }); cl.push({ t: st(bC, s), vel: 0.8 }); });
    for (let s = 0; s < 16; s++) ht.push({ t: st(bC, s), vel: hv(rng, s % 4 === 0 ? 0.8 : s % 2 === 0 ? 0.55 : 0.28, 0.04), pan: 0.22 });
    for (let i = 0; i < 8; i++) pu.push({ t: bC * BAR + (i * BEAT) / 2, dur: (BEAT / 2) * 0.86, midi: PULSE_ROOT.F + (i === 3 || i === 7 ? 12 : 0), vel: [0.95, 0.5, 0.78, 0.55, 0.9, 0.5, 0.78, 0.62][i], pan: i % 2 ? 0.12 : -0.12 });
    [0, 3, 6, 8, 11, 14].forEach((s, k) => bs.push({ t: st(bC, s), dur: [3, 3, 2, 3, 3, 2][k] * (BEAT / 4) * 0.92, midi: k === 2 ? BASS.F + 12 : BASS.F, vel: [1, 0.72, 0.82, 0.92, 0.72, 0.84][k] }));
    [0, 8].forEach((s) => ti.push({ t: st(bC, s), dur: 1.4, midi: TIMP_ROOT.F, vel: s ? 0.8 : 1 }));
    add('fKick', 'future', 'kick', 'kick', kk, { variant: 'tight' }, LV.kick);
    add('fSnare', 'future', 'snare', 'snare', sn_, { variant: 'crack' }, LV.snare);
    add('fClap', 'future', 'snare', 'clap', cl, {}, LV.clap);
    add('fHat', 'future', 'hats', 'hat', ht, {}, LV.hat);
    add('fPulse', 'future', 'synth', 'synth_pulse', pu, { brightScale: 1.05, decay: 0.16 }, LV.pulse - 1);
    add('fBass', 'future', 'bass', 'synth_bass', bs, {}, LV.bass);
    add('fTimp', 'future', 'perc', 'timpani', ti, {}, LV.timp);
    add('fTaiko', 'future', 'perc', 'taiko', [{ t: t48, midi: 41, vel: 1, rim: true }, { t: st(bC, 8), midi: 41, vel: 0.85 }], {}, LV.taiko);
    add('fCrash', 'future', 'cym', 'cymbal', [{ t: t48, vel: 1, dur: 3.5 }], {}, LV.crash);
    add('fHornsMotif', 'future', 'brass', 'horns', [...motifAt(bt(bC, 0), { octave: 0, vel: [0.9, 0.7, 0.76, 0.96] }).map((e) => ({ ...e, dur: e.dur * 0.98 })), ...[53, 60, 65].map((m) => ({ t: bt(bC, 0), dur: BAR * 0.97, midi: m, vel: 0.6 }))], {}, LV.fHorns);
    add('fTrumpMotif', 'future', 'brass', 'trumpets', motifAt(bt(bC, 0), { octave: 1, vel: [0.92, 0.74, 0.8, 0.98] }).map((e) => ({ ...e, dur: e.dur * 0.98 })), {}, LV.fTrump);
    add('fStrMotif', 'future', 'strings', 'strings_high', motifAt(bt(bC, 0), { octave: 1, vel: [0.8, 0.62, 0.68, 0.9] }).map((e) => ({ ...e, dur: e.dur * 0.98 })), {}, LV.strMotif);
    add('fLowPed', 'future', 'brass', 'brass_low', [{ t: bt(bC, 0), dur: BAR * 0.97, midi: BASS.F + 12, vel: 0.9 }], {}, LV.fLow);
    add('fChoirBig', 'future', 'choir', 'choir', [53, 60, 65, 69, 72, 77].map((m) => ({ t: bt(bC, 0), dur: BAR, midi: m, vel: 0.85 })), { vowel: 'a', singers: 8, attack: 0.15, release: 1.4 }, LV.fChoirPad + 1);
  }

  // ===========================================================================
  // 50.0  RECAP - Am (50-52) / F (52-54): tremolo strings + low brass swell, timpani roll, a tonal riser to C6, a tape-rewind
  //       of the jobs mix (added in the mixdown: it needs the rendered mix); no kick/bass/pulse: space for the applause
  // ===========================================================================
  {
    const [r0, r1] = recBars;
    const t50 = TIME.recapStart, t54 = TIME.recapEnd;
    const gap = 0.08; // the last 80 ms before the end card are silent (cut in the mixdown) - the held breath
    const RSP = [{ name: 'Am7', t0: bt(r0, 0), t1: bt(r0, 4) }, { name: 'Fmaj7', t0: bt(r1, 0), t1: bt(r1, 4) }];
    const rv = voiceLead(RSP.map((s) => s.name), { lo: 45, hi: 72, n: 5, center: 58, maxSpan: 19 });
    add('rStr', 'recap', 'strings', 'strings', tieChords(RSP, rv, { velAt: (sp) => (sp.name === 'Am7' ? 0.5 : 0.82) }).map((n) => ({ ...n, dur: n.dur - gap })), { art: 'swell' }, LV.rStr);
    const trem = [];
    [[r0, 0, 0.3], [r0, 2, 0.45], [r1, 0, 0.62], [r1, 2, 0.85]].forEach(([b, beat, v]) => rv[b - r0].slice(1).forEach((m) => trem.push({ t: bt(b, beat), dur: 2 * BEAT, midi: m + 12, vel: v })));
    add('rTrem', 'recap', 'strings', 'strings_tremolo', trem.map((n) => ({ ...n, dur: Math.min(n.dur, t54 - gap - n.t) })), { section: 'high' }, LV.rStr - 2);
    add('rLow', 'recap', 'brass', 'brass_low', [{ t: bt(r0, 0), dur: BAR, midi: 33 + 12, vel: 0.62 }, { t: bt(r1, 0), dur: BAR - gap, midi: 29 + 12, vel: 0.9 }], { art: 'swell' }, LV.rLow);
    add('rTimp1', 'recap', 'perc', 'timpani', inst.drumRoll(t50 + 0.25, bt(r1, 0) - 0.06, { midi: 45, rate: 14, vel: [0.12, 0.55], seed: 31 }), {}, LV.rTimp);
    add('rTimp2', 'recap', 'perc', 'timpani', inst.drumRoll(bt(r1, 0), t54 - gap - 0.02, { midi: 41, rate: 16, vel: [0.5, 1], seed: 33 }), {}, LV.rTimp);
    add('rImpact', 'recap', 'fx', 'impact', [{ t: t50, vel: 0.7, size: 'M' }], {}, LV.impactM);
    add('rRiser', 'recap', 'air', 'riser', [{ t: t50, dur: t54 - t50 - gap, midi: 84, vel: 0.8 }], { noise: 0.35, tonal: 1.1, loHz: 400 }, LV.rRiser);
    add('rTape', 'recap', 'air', 'tape_rewind', [{ t: t50, dur: t54 - t50 - gap, vel: 0.8 }], { stop: false }, LV.rTape);
  }

  // ===========================================================================
  // 54.0  END CARD - logo resolve (C major, soft, shimmering: choir, shimmer, celesta motif, harp) -> 56.0 F -> 57.0 G swell
  //       -> 58.0 THE FINAL HIT: full orchestra + choir + timpani + taiko + sub on C major, long reverb tail to 60.0
  // ===========================================================================
  {
    const rng = rngFor('end');
    const e0 = bar(TIME.endStart), e1 = e0 + 1; // bars 27 (C) and 28 (F | G)
    const t54 = TIME.endStart, t56 = bt(e1, 0), t57 = TIME.tag, t58 = TIME.finalHit;
    const gap = 0.1;
    const ESP = [{ name: 'C', t0: t54, t1: t56 }, { name: 'F', t0: t56, t1: t57 }, { name: 'G', t0: t57, t1: t58 - gap }];
    const ev = voiceLead(ESP.map((s) => s.name), { lo: 55, hi: 81, n: 4, center: 68, maxSpan: 17 });
    add('eChoir', 'end', 'choir', 'choir', tieChords(ESP, ev, { velAt: (sp) => ({ C: 0.42, F: 0.55, G: 0.68 }[sp.name]) }), { vowel: 'a', singers: 6, attack: 1.0, release: 0.8 }, LV.eChoir);
    const sv = voiceLead(ESP.map((s) => s.name), { lo: 60, hi: 88, n: 4, center: 74, maxSpan: 17 });
    add('eStr', 'end', 'strings', 'strings', tieChords(ESP, sv, { velAt: (sp) => ({ C: 0.35, F: 0.55, G: 0.8 }[sp.name]) }), { art: 'swell' }, LV.eStr);
    add('eShim', 'end', 'shimmer', 'shimmer', [{ t: t54, dur: BAR * 0.95, midi: 72, vel: 0.7 }, { t: t56, dur: BEAT * 2 * 0.95, midi: 77, vel: 0.5 }], { attack: 1.1, release: 1.6 }, LV.eShim);
    // harp: C-major arpeggio blooming upward from the downbeat (16ths, decaying), then slower F and G arpeggios
    const hp = th.arp([60, 64, 67, 72, 76, 79, 84, 88], t54, { step: BEAT / 4, count: 8, dur: 0.3, vel: (k) => 0.55 - 0.03 * k }).map((n, k) => ({ ...n, pan: -0.4 + 0.12 * k }));
    hp.push(...th.arp([65, 69, 72, 77, 81, 84], t56, { step: BEAT / 4, count: 6, dur: 0.3, vel: (k) => 0.42 - 0.02 * k }).map((n, k) => ({ ...n, pan: 0.4 - 0.12 * k })));
    hp.push(...th.arp([62, 67, 71, 74, 79, 83], t57, { step: BEAT / 4, count: 6, dur: 0.3, vel: (k) => 0.48 - 0.02 * k }).map((n, k) => ({ ...n, pan: -0.3 + 0.1 * k })));
    add('eHarp', 'end', 'harp', 'harp', hp, { ring: 2.2 }, LV.eHarp);
    // the motif for the last time, on the celesta in C major (E5 G5 A5 C6): the logo's melody
    add('eCel', 'end', 'bells', 'celesta', motifAt(t54, { octave: 1, vel: [0.62, 0.48, 0.52, 0.7] }), {}, LV.fCel + 1);
    add('eSub', 'end', 'sub', 'sub808', [{ t: t54, dur: 1.8, midi: 36, vel: 0.6 }, { t: t56, dur: 0.9, midi: 29, vel: 0.55 }, { t: t57, dur: 0.85, midi: 31, vel: 0.65 }], { decay: 1.2, drive: 1.5 }, LV.eSub);
    add('eImpact', 'end', 'fx', 'impact', [{ t: t54, vel: 0.5, size: 'S' }], {}, LV.impactM - 2);
    // 56-58 build: low strings pedal swell, timpani roll on G (the dominant), choir/strings swell above
    add('eLowStr', 'end', 'strings', 'strings_low', [{ t: t56, dur: t57 - t56, midi: 41, vel: 0.5 }, { t: t57, dur: t58 - gap - t57, midi: 43, vel: 0.7 }], { art: 'swell' }, LV.eStr);
    add('eTimp', 'end', 'perc', 'timpani', inst.drumRoll(t57, t58 - gap - 0.03, { midi: 43, rate: 14, vel: [0.1, 0.8], seed: 41 }), {}, LV.rTimp);
    add('eHorns', 'end', 'brass', 'horns', [[53, 60, 65, 69].map((m) => ({ t: t56, dur: t57 - t56, midi: m, vel: 0.45 })), [55, 62, 67, 71].map((m) => ({ t: t57, dur: t58 - gap - t57, midi: m, vel: 0.62 }))].flat(), { art: 'swell' }, LV.fHorns - 1);
    // ---- THE FINAL HIT at 58.0 (C major) - everything lands on the grid; one big wide reverb
    const F = 'final';
    const ch = [48, 55, 60, 64, 67];
    add('finImpact', F, 'fx', 'impact', [{ t: t58, vel: 1, size: 'L' }], {}, LV.hit);
    add('finSub', F, 'sub', 'sub808', [{ t: t58, dur: 2.2, midi: 24, vel: 1 }, { t: t58, dur: 2.2, midi: 36, vel: 0.8 }], { decay: 1.8, drive: 2.2 }, LV.sub + 2);
    add('finTimp', F, 'perc', 'timpani', [{ t: t58, dur: 2.2, midi: 48, vel: 1 }, { t: t58, dur: 2.2, midi: 43, vel: 0.9 }], {}, LV.timp + 1);
    add('finTaiko', F, 'perc', 'taiko', [{ t: t58, midi: 36, vel: 1, rim: true }, { t: t58, midi: 48, vel: 0.9 }], {}, LV.taiko);
    add('finLow', F, 'brass', 'brass_low', [36, 43, 48, 55].map((m) => ({ t: t58, dur: 1.6, midi: m, vel: 1 })), { attackScale: 0.4, releaseScale: 1.4 }, LV.lowbrass + 1);
    add('finHorns', F, 'brass', 'horns', ch.map((m) => ({ t: t58, dur: 1.6, midi: m, vel: 1 })), { attackScale: 0.35, releaseScale: 1.5 }, LV.horns + 1);
    add('finTrump', F, 'brass', 'trumpets', [72, 76, 79, 84].map((m) => ({ t: t58, dur: 1.3, midi: m, vel: 1 })), { attackScale: 0.5, releaseScale: 1.3 }, LV.trumpets);
    add('finStrLow', F, 'strings', 'strings_low', [36, 43, 48].map((m) => ({ t: t58, dur: 1.6, midi: m, vel: 0.95 })), { attackScale: 0.25 }, LV.strSwell + 3);
    add('finStr', F, 'strings', 'strings', [55, 60, 64, 67, 72, 76, 79].map((m) => ({ t: t58, dur: 1.6, midi: m, vel: 0.95 })), { attackScale: 0.25 }, LV.strSwell + 3);
    add('finStrHigh', F, 'strings', 'strings_high', [84, 88, 91].map((m) => ({ t: t58, dur: 1.6, midi: m, vel: 0.85 })), { attackScale: 0.25 }, LV.strSwell + 2);
    add('finChoir', F, 'choir', 'choir', [48, 55, 60, 64, 67, 72, 76, 79].map((m) => ({ t: t58, dur: 1.8, midi: m, vel: 0.95 })), { vowel: 'a', singers: 8, attack: 0.08, release: 1.6 }, LV.choir + 1);
    add('finCrash', F, 'cym', 'cymbal', [{ t: t58, vel: 1, dur: 4 }], {}, LV.crash + 1);
    add('finShim', F, 'shimmer', 'shimmer', [{ t: t58, dur: 1.4, midi: 72, vel: 0.8 }], { attack: 0.5, release: 1.4 }, LV.eShim);
    add('finHarp', F, 'harp', 'harp', th.arp([72, 76, 79, 84, 88, 91, 96], t58 + 0.05, { step: 0.09, count: 7, dur: 0.3, vel: (k) => 0.55 - 0.04 * k }), { ring: 3 }, LV.eHarp);
  }

  // ---- the S / M hits of cues.HITS inside 26..60 (stem downbeats, year jumps): a soft sub-weighted accent each
  {
    const skip = new Set([TIME.baton, TIME.finalHit]);
    const OFF = { [TIME.start]: -4, [TIME.endStart]: 0, [TIME.recapStart]: 0 };
    const grpAt = (t) => (t < TIME.jobsEnd ? 'jobs' : t < TIME.futureEnd ? 'future' : t < TIME.recapEnd ? 'recap' : 'end');
    for (const h of cues.HITS) {
      if (h.t < TIME.start || h.t >= TIME.end || skip.has(h.t) || h.s === 'L') continue;
      if (h.t === TIME.recapStart || h.t === TIME.endStart) continue; // placed with their sections
      add('hit' + h.t, grpAt(h.t), 'fx', 'impact', [{ t: h.t, vel: h.s === 'M' ? 0.7 : 0.4, size: h.s }], {}, (h.s === 'M' ? LV.impactM : LV.impactS) + (OFF[h.t] || 0));
    }
  }
  return L;
}

// =============================================================================
// MIXDOWN
// =============================================================================
const sumInto = (dst, src, g = 0) => addAt(dst, src, 0, g, 0);

/** gain curve: 1 everywhere except [t0,t1] -> 0 (raised-cosine edges of `fade` s) ; in place on a Buf */
function dip(buf, t0, t1, fade = 0.006, floorDb = -120) {
  const floor = dbToLin(floorDb);
  const a = Math.round(t0 * SR), b = Math.round(t1 * SR), f = Math.round(fade * SR);
  for (const ch of [buf.L, buf.R]) {
    for (let i = Math.max(0, a - f); i < Math.min(ch.length, b + f); i++) {
      let g = 0;
      if (i < a) g = 0.5 + 0.5 * Math.cos((Math.PI * (i - (a - f))) / f);
      else if (i >= b) g = 0.5 - 0.5 * Math.cos((Math.PI * (i - b)) / f);
      ch[i] *= Math.max(floor, g);
    }
  }
}
/** gain 1 until t0, then a smooth fall to 0 over `len` seconds (len 0 = quick 8 ms fade), 0 after: a group's cut / release */
function releaseAt(buf, t0, len = 0) {
  const a = Math.round(t0 * SR), r = Math.max(Math.round(len * SR), Math.round(0.008 * SR));
  for (const ch of [buf.L, buf.R]) {
    for (let i = Math.max(0, a); i < ch.length; i++) {
      const x = (i - a) / r;
      ch[i] *= x >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * x);
    }
  }
}

/** on-beat gated / retriggered 1/16 chops of the whole mix over [t0,t1): per-beat patterns of 4 steps (one per 16th):
 *  T = pass, G = gate (silence), R = retrigger the beat's first 16th, r = retrigger it at 32nd-note rate. The beat's own 16th is always T. */
export function stutter(buf, t0, t1, patterns) {
  const n0 = Math.round(t0 * SR);
  const six = Math.round((BEAT / 4) * SR);
  const fOut = Math.round(0.0015 * SR), fInT = Math.round(0.0015 * SR), fInR = Math.round(0.0006 * SR);
  const beats = Math.round((t1 - t0) / BEAT);
  const srcL = Float32Array.from(buf.L.subarray(n0, n0 + beats * 4 * six)), srcR = Float32Array.from(buf.R.subarray(n0, n0 + beats * 4 * six));
  const types = [];
  for (let k = 0; k < beats; k++) for (let s = 0; s < 4; s++) types.push(patterns[k % patterns.length][s]);
  const last = types.length - 1;
  for (let j = 0; j <= last; j++) {
    const ty = types[j], beat0 = Math.floor(j / 4) * 4 * six, o = j * six;
    const sliceLen = ty === 'r' ? six >> 1 : six;
    const prevDiff = j > 0 && types[j - 1] !== ty, nextDiff = j < last && types[j + 1] !== ty;
    const fIn = ty === 'T' ? fInT : fInR;
    for (let i = 0; i < six; i++) {
      let vL = 0, vR = 0;
      if (ty === 'T') { vL = srcL[o + i]; vR = srcR[o + i]; }
      else if (ty === 'R' || ty === 'r') {
        const k = i % sliceLen;
        let w = 1;
        if (k < fInR) w = 0.5 - 0.5 * Math.cos((Math.PI * k) / fInR);
        if (k >= sliceLen - fOut) w *= 0.5 + 0.5 * Math.cos((Math.PI * (k - (sliceLen - fOut))) / fOut);
        vL = srcL[beat0 + k] * w; vR = srcR[beat0 + k] * w;
      }
      let w2 = 1;
      if (ty !== 'G') {
        if (prevDiff && i < fIn) w2 *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fIn);
        if (nextDiff && i >= six - fOut) w2 *= 0.5 + 0.5 * Math.cos((Math.PI * (i - (six - fOut))) / fOut);
      }
      buf.L[n0 + o + i] = vL * w2;
      buf.R[n0 + o + i] = vR * w2;
    }
  }
}
export const STUTTER_PATTERNS = ['TGTG', 'TTTG', 'TGTG', 'TRRR', 'TGTG', 'TTRR', 'TRTR', 'Trrr'];

/** low-pass filter sweep over the whole mix, closed at t0 (fc0) opening to fully open at t1; resonant 24 dB/oct, equal-power bypass at the end */
export function filterOpen(buf, t0, t1, { fc0 = 240, fc1 = 21000, q0 = 3.2, lead = 0.04, tailXf = 0.12 } = {}) {
  const a = Math.round((t0 - lead) * SR), b = Math.round(t1 * SR), n = b - a;
  const fc = new Float32Array(n), q = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = (a + i) / SR;
    if (t < t0) { const x = (t - (t0 - lead)) / lead; fc[i] = fc1 * Math.pow(fc0 / fc1, x * x * (3 - 2 * x)); q[i] = 0.7 + (q0 - 0.7) * x; }
    else { const u = (t - t0) / (t1 - t0); fc[i] = fc0 * Math.pow(fc1 / fc0, Math.pow(u, 1.55)); q[i] = 0.75 + (q0 - 0.75) * (1 - u) * (1 - u); }
  }
  const seg_ = buf.slice(t0 - lead, t1);
  const y1 = dsp.svf(seg_, 'lp', fc, q, { update: 4 });
  const y2 = dsp.svf(y1, 'lp', fc, 0.62, { update: 4 });
  const xf = Math.round(tailXf * SR);
  for (let i = 0; i < n; i++) {
    const w = i >= n - xf ? 0.5 - 0.5 * Math.cos((Math.PI * (i - (n - xf))) / xf) : 0; // 0 = filtered, 1 = dry
    buf.L[a + i] = y2.L[i] * (1 - w) + buf.L[a + i] * w;
    buf.R[a + i] = y2.R[i] * (1 - w) + buf.R[a + i] * w;
  }
}

/** gentle "vocal pocket": a few dB of mid-range room under each VO line (the mix stage ducks the whole stem on top of this) */
function voPocket(buf, regions) {
  const n = buf.length;
  const env = dsp.regionEnv(n, regions, { attack: 0.06, release: 0.3 });
  const g2k = new Float32Array(n), g500 = new Float32Array(n);
  for (let i = 0; i < n; i++) { g2k[i] = -2.6 * env[i]; g500[i] = -1.4 * env[i]; }
  return dsp.biquad(dsp.biquad(buf, 'peak', 2300, 0.8, g2k, { update: 16 }), 'peak', 520, 0.7, g500, { update: 16 });
}

export function mixdown(layers, ctx) {
  const log = ctx.log || (() => {});
  const timing = [];
  const todo = layers.filter((l) => !(ctx.only && !ctx.only.includes(l.name)) && !(ctx.skip && ctx.skip.includes(l.name)));
  const keys = [...new Set(todo.map((l) => l.grp + '|' + l.bus))];
  const out = {};
  // one bus at a time (dry sum -> one reverb send -> into the group mix) so memory stays at ~3 stereo buffers
  for (const key of keys) {
    const [grp, name] = key.split('|');
    const bus = new Buf(cues.DURATION);
    for (const l of todo.filter((x) => x.grp === grp && x.bus === name)) {
      const t = process.hrtime.bigint();
      addAt(bus, renderCached(ctx, l.id, l.notes, l.opts), 0, l.g, l.pan);
      timing.push([l.name, Number(process.hrtime.bigint() - t) / 1e6]);
    }
    const gm = out[grp] || (out[grp] = new Buf(cues.DURATION));
    sumInto(gm, bus);
    const rv = BUS[name];
    if (rv) sumInto(gm, dsp.applyReverb(bus, rv[0], { wet: rv[1], wetOnly: true, ...(rv[2] || {}) }));
  }
  log(`  layers: ${timing.length} (${(timing.reduce((s, x) => s + x[1], 0) / 1000).toFixed(1)} s incl. cache reads), buses: ${keys.length}`);
  return { groups: out, timing };
}

export function assemble(groups, ctx = {}) {
  const log = ctx.log || (() => {});
  const mix = new Buf(cues.DURATION);
  const E = (k) => groups[k] || new Buf(cues.DURATION);
  const jobs = E('jobs'), jobsHit = E('jobsHit');
  // the dry pre-processing jobs mix: it is also what the recap REWINDS
  const jobsRaw = new Buf(cues.DURATION);
  sumInto(jobsRaw, jobs); sumInto(jobsRaw, jobsHit);
  // the held breath before the baton hit: every non-hit element drops out for 70 ms (the hit's own layers are not dipped)
  dip(jobs, TIME.baton - 0.07, TIME.baton);
  // 38.0 on-beat stutter edits and 40.0-42.0 low-pass sweep open over the WHOLE jobs mix (jobs + hit tails)
  const jm = new Buf(cues.DURATION);
  sumInto(jm, jobs); sumInto(jm, jobsHit);
  stutter(jm, STEM.stutter, TIME.jobsEnd, STUTTER_PATTERNS);
  filterOpen(jm, STEM.filter_open, TIME.jobsEnd);
  releaseAt(jm, TIME.jobsEnd, 0.9); // the jobs fall away into the future (their reverb tails ring out for < 1 s)
  sumInto(mix, jm);
  // the future
  const fut = E('future');
  releaseAt(fut, TIME.futureEnd, 1.3);
  sumInto(mix, fut);
  // the recap: + the rewind of the jobs mix (tape running backwards, speeding up) - tonal, from the music itself
  const rec = E('recap');
  const dur = TIME.recapEnd - TIME.recapStart - 0.08;
  const nR = Math.round(dur * SR);
  const speed = new Float32Array(nR);
  for (let i = 0; i < nR; i++) { const u = i / nR; speed[i] = -(1 + 5.5 * u * u); }
  const srcSeg = jobsRaw.slice(TIME.start, TIME.jobsEnd);
  const startAt = (TIME.jobsEnd - 0.5 - TIME.start); // read backwards from 41.5
  let rw = dsp.varispeed(srcSeg, speed, { n: nR, start: startAt });
  rw = dsp.biquad(dsp.biquad(rw, 'hp', 180, 0.7), 'lp', 9500, 0.7);
  const rwEnv = new Float32Array(nR);
  for (let i = 0; i < nR; i++) { const u = i / nR; rwEnv[i] = Math.pow(Math.sin((Math.PI / 2) * Math.min(1, u * 3)), 2) * (0.35 + 0.65 * u); }
  for (let i = 0; i < nR; i++) { rw.L[i] *= rwEnv[i]; rw.R[i] *= rwEnv[i]; }
  addAt(rec, rw, TIME.recapStart, LV.rRewind, 0);
  releaseAt(rec, TIME.recapEnd - 0.08, 0); // 54.0 - 80 ms: silence (the end card blooms out of a held breath)
  sumInto(mix, rec);
  // the end card: soft section is cut 100 ms before the final hit (the "inhale"), the final hit rings on its own
  const end = E('end');
  releaseAt(end, TIME.finalHit - 0.1, 0);
  sumInto(mix, end);
  const fin = E('final');
  // tail: the reverb rings to 60.0 and fades to digital near-silence on the last sample
  const tailFrom = TIME.clickOff - 0.3;
  {
    const a = Math.round(tailFrom * SR), n = fin.length;
    for (let i = a; i < n; i++) {
      const x = (i - a) / (n - a);
      const g = 0.5 + 0.5 * Math.cos(Math.PI * x);
      fin.L[i] *= g * g; fin.R[i] *= g * g;
    }
  }
  sumInto(mix, fin);
  log('  assembled (stutter, filter-open, rewind, cuts, tail)');
  return mix;
}

/** the gentle master: glue compressor + safety true-peak limiter (peak <= -2 dBFS). Returns a new Buf. */
export function masterBus(buf, { ceilingDb = -2.1, glue = true } = {}) {
  let x = buf;
  if (glue) x = dsp.compressor(x, { thresholdDb: -20, ratio: 1.6, attackMs: 40, releaseMs: 280, kneeDb: 10, detect: 'rms', rmsMs: 40 });
  const r = dsp.limiter(x, { ceilingDb, lookaheadMs: 5, releaseMs: 200, truePeak: true });
  return Buf.from(r.L, r.R);
}

/**
 * renderScoreB(buf, ctx): adds the score for 26..60 into `buf` (60 s Buf, un-mastered; the master is render.mjs's job).
 * Returns {layers: [names], seconds, report} - and the raw B-only mix as `.mix` for tests.
 */
export function renderScoreB(buf, ctx = {}) {
  ctx = { cache: true, log: console.log, ...ctx };
  if (ctx.log === false) ctx.log = () => {};
  const t0 = process.hrtime.bigint();
  const layers = buildLayers();
  const { groups, timing } = mixdown(layers, ctx);
  let mix = assemble(groups, ctx);
  // vocal pockets under the narration (cues.VO inside 26..58)
  const regions = cues.VO.filter((v) => v.t0 >= TIME.start && v.t0 < TIME.finalHit).map((v) => [v.t0 - 0.08, v.maxEnd + 0.2]);
  mix = voPocket(mix, regions);
  addAt(buf, mix, 0, 0, 0);
  const secs = Number(process.hrtime.bigint() - t0) / 1e9;
  ctx.log(`[score_b] ${layers.length} layers, ${(secs).toFixed(1)} s`);
  return { layers: layers.map((l) => l.name), seconds: secs, mix, timing };
}

// -----------------------------------------------------------------------------
// CLI:  node audio/music/score_b.mjs --solo
// -----------------------------------------------------------------------------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const solo = args.includes('--solo');
  const ctx = { cache: !args.includes('--no-cache') };
  const buf = new Buf(cues.DURATION);
  renderScoreB(buf, ctx);
  const out = masterBus(buf);
  const file = solo ? stemPath('music_b') : stemPath('music_b');
  ensure(path.dirname(file));
  dsp.writeWav(file, out);
  console.log(`[score_b] wrote ${path.relative(process.cwd(), file)}`);
}
