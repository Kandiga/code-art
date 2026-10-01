#!/usr/bin/env node
// =============================================================================
// audio/music/score_a.mjs  -  SCORE A: the original score for t = 0 .. 26.0 s
//   cold open (0-4) -> nine eras (4-22, one bar each) -> NOW slam (21.5) -> hard cut (22.0) -> true silence (22.0-22.5)
//   -> sub drop (22.5) -> solo piano turn (24.0-26.0; reverb tail rings on into 26-29).
//
//   import { renderScoreA } from './score_a.mjs';
//   await renderScoreA(buf, ctx)   // writes (adds) into the shared 60 s stereo Buf, returns {local, report}
//   node audio/music/score_a.mjs --solo [--eras 0,3] [--png] [--nocache]     -> audio/build/stems/music_a.wav (60 s)
//
// One piece, one tempo (120 BPM, cues.BEAT), one 4-note motif (E4 G4 A4 C5, rhythm cues.MOTIF), one 4-chord loop (cues.CHORDS).
// Every era plays the motif once per bar over that bar's chord and re-orchestrates it (cues.MUSIC.eraStyles), and every era's
// last beat (cues.ERAS[i].diveT0) is a rising scale pickup A-B-C-D (each time in the next era's register) that resolves INTO the
// next era's first motif note E on the matte slide.  Nothing in here hard-codes a time that is in shared/cues.js: bars, beats,
// era starts, the motif rhythm, chords, NOW_T, FREEZE_T, VO windows are all read from it.
//
// ctx (all optional):  { gainDb: trim for the whole of A (default 0), seed: re-roll the micro-variation (default 1),
//                        cache: false to disable the layer cache, eras: [indices] to render only some eras, log: fn }
// Deterministic: seeded RNG only, 48 kHz stereo float32; the layer cache (audio/build/tmp/score_a) is keyed on notes+options+source mtimes.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as dsp from '../lib/dsp.mjs';
import * as th from '../lib/theory.mjs';
import * as meter from '../lib/meter.mjs';
import * as inst from './instruments.mjs';
import * as cues from '../../shared/cues.js';
import { STEMS, TMP, ensure } from '../lib/paths.mjs';

const { Buf, SR } = dsp;
const { BEAT, BAR, ERAS, VO, NOW_T, FREEZE_T } = cues;
const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------------------------------------------------
// timing constants derived from the cues
// ---------------------------------------------------------------------------------------------------------------------
const SILENCE_END = FREEZE_T + BEAT; // 22.5: the held breath ends (sub drop)
const TURN = cues.sceneById('turn'); // 22 .. 26
const PIANO_T0 = TURN.t1 - BAR; // 24.0: solo piano E4 (bar 12)
const LOCAL_SEC = 32; // local timeline of A (tails of the turn piano ring on past 26)
const PRE = 0.6; // pre-roll of every era buffer (slow-attack voices, reverse swells)
const ERA_LEN = 8.0; // era buffer length (pre + bar + tail)
const T = (t0, beats) => t0 + beats * BEAT;
const SIXTEENTH = BEAT / 4;
const clamp = dsp.clamp;
const dB = dsp.dbToLin;

// ---------------------------------------------------------------------------------------------------------------------
// harmony: voicings that lead smoothly (every inner voice moves by step or stays: Am F C G Am F C G Am)
// ---------------------------------------------------------------------------------------------------------------------
const PADV = { Am: [52, 57, 60], F: [53, 57, 60], C: [52, 55, 60], G: [50, 55, 59] }; // E3 A3 C4 | F3 A3 C4 | E3 G3 C4 | D3 G3 B3
const PADV_SUS = { ...PADV, G: [50, 55, 62] }; // G with the 9th instead of the 3rd (the motif's C is its 4th)
const BASSV = { Am: 45, F: 41, C: 48, G: 43 }; // A2 F2 C3 G2 (root line)
const FIFTH = { Am: 52, F: 48, C: 55, G: 50 }; // E3 C3 G3 D3
const chordOf = (E) => th.chordForTime(E.t0).name;

// the pickup scale A-B-C-D (diatonic, steps into E) in a given octave: midi of A in octave `o` (A3 = 57)
const pickupNotes = (oct) => [57, 59, 60, 62].map((m) => m + 12 * oct);

// ---------------------------------------------------------------------------------------------------------------------
// event helpers
// ---------------------------------------------------------------------------------------------------------------------
const N = (t, midi, dur, vel, extra = {}) => ({ t, midi, dur, vel, ...extra });
const motif = (t0, o = {}) =>
  th.motifEvents(t0, { octave: o.octave || 0, vel: o.vel || null, gate: o.gate || 1 }).map((e) => ({ t: e.t, midi: e.midi, dur: e.dur, vel: e.vel, lock: e.beat === 0 }));
/** four rising 16ths A-B-C-D landing 16th before the next downbeat (diveT0 = last beat of the era) */
const pickup = (E, oct, vel = [0.5, 0.85], dur = SIXTEENTH * 0.9, extra = {}) =>
  pickupNotes(oct).map((m, i) => N(E.diveT0 + i * SIXTEENTH, m, dur, vel[0] + (vel[1] - vel[0]) * (i / 3), extra));

/** seeded human feel: timing within +-timing s (+-6 ms max incl. bias), velocity +-vel; `lock` events (downbeats) get +-lockT */
function hum(notes, seed, o = {}) {
  const { timing = 0.005, vel = 0.05, bias = 0, lockT = 0.001 } = o;
  const rng = dsp.mulberry32(dsp.seedOf('score_a.hum', SEED, seed));
  return notes.map((n) => {
    // locked (downbeat) events are never early (the pre-downbeat dip ends at t) and at most ~1.5 ms late
    const dt = n.lock ? rng() * 1.5 * lockT : (rng() * 2 - 1) * timing + bias;
    const dv = (rng() * 2 - 1) * vel;
    return { ...n, t: n.t + clamp(dt, -0.006, 0.006), vel: clamp(n.vel * (1 + dv), 0.04, 1) };
  });
}
/** mark events landing exactly on a bar start as locked */
const lockDown = (t0, notes) => notes.map((n) => (Math.abs(n.t - t0) < 1e-6 ? { ...n, lock: true } : n));

// ---------------------------------------------------------------------------------------------------------------------
// layer renderer with an on-disk cache (dev speed only; key = instrument + notes + options + source mtimes)
// ---------------------------------------------------------------------------------------------------------------------
let _stamp = null;
function srcStamp() {
  if (_stamp) return _stamp;
  const dirs = [path.join(HERE, 'instruments'), path.join(HERE, '..', 'lib')];
  let m = 0;
  for (const d of dirs) for (const f of fs.readdirSync(d)) if (f.endsWith('.mjs')) m = Math.max(m, fs.statSync(path.join(d, f)).mtimeMs);
  m = Math.max(m, fs.statSync(path.join(HERE, 'presets.mjs')).mtimeMs, fs.statSync(path.join(HERE, 'instruments.mjs')).mtimeMs);
  _stamp = String(Math.round(m));
  return _stamp;
}
const CACHE_DIR = path.join(TMP, 'score_a');
let CACHE_ON = true;
let DEBUG_LAYERS = false;
let SEED = 0; // ctx.seed re-rolls all micro-variation (hum + instrument seeds + processors)
function renderLayer(id, notes, opts, seconds) {
  if (!notes.length) return new Buf(seconds);
  const key = crypto.createHash('sha1').update(JSON.stringify([srcStamp(), id, seconds, SEED, opts, notes.map((n) => ({ ...n, t: +n.t.toFixed(6) }))])).digest('hex').slice(0, 20);
  const file = path.join(CACHE_DIR, `${id}_${key}.f32`);
  const n = Math.round(seconds * SR);
  if (CACHE_ON && fs.existsSync(file)) {
    const b = fs.readFileSync(file);
    if (b.length === n * 8) {
      const f = new Float32Array(b.buffer, b.byteOffset, n * 2);
      return Buf.from(Float32Array.from(f.subarray(0, n)), Float32Array.from(f.subarray(n)));
    }
  }
  const buf = inst.render(id, notes, { ...opts, seed: (opts.seed != null ? opts.seed : 1) + 1000 * SEED, seconds });
  if (CACHE_ON) {
    ensure(CACHE_DIR);
    const out = new Float32Array(n * 2);
    out.set(buf.L, 0);
    out.set(buf.R, n);
    fs.writeFileSync(file, Buffer.from(out.buffer));
  }
  return buf;
}

// ---------------------------------------------------------------------------------------------------------------------
// era mixing: layers -> dry sum + reverb send -> era processors -> window (fade-in, tail) -> loudness trim
// ---------------------------------------------------------------------------------------------------------------------
/**
 * spec = { layers: [{name, id, notes, opts, db, send, pan}], reverb:{preset, wet, ...}, processors:[{id, opts}] | null,
 *          voPocketDb, tailTau, target (LUFS of the bar, ungated), crescDb (dive crescendo), post(buf) }
 */
function mixEra(E, spec, log) {
  const off = E.t0 - PRE;
  const dry = new Buf(ERA_LEN);
  const feed = new Buf(ERA_LEN);
  const stems = {};
  for (const L of spec.layers) {
    const shifted = L.notes.map((n) => ({ ...n, t: n.t - off }));
    let b = renderLayer(L.id, shifted, L.opts || {}, ERA_LEN);
    if (L.fx) b = L.fx(b);
    stems[L.name] = b;
    dsp.addAt(dry, b, 0, L.db || 0, L.pan || 0);
    if (L.send > 0) dsp.addAt(feed, b, 0, (L.db || 0) + dsp.linToDb(L.send), L.pan || 0);
  }
  const rv = spec.reverb;
  let mix = dry;
  if (rv && rv.wet > 0) {
    const { preset, wet, ...rest } = rv;
    const w = dsp.applyReverb(feed, preset, { wet, wetOnly: true, ...rest });
    mix = new Buf(ERA_LEN);
    dsp.addAt(mix, dry, 0, 0, 0);
    dsp.addAt(mix, w, 0, 0, 0);
  }
  if (spec.voPocketDb) mix = dsp.biquad(mix, 'peak', 3200, 0.8, spec.voPocketDb);
  if (spec.post) mix = spec.post(mix, { off, E });
  let out = mix;
  const procs = spec.processors === undefined ? inst.ERA_STYLES[E.music].processors : spec.processors;
  for (const p of procs || []) out = inst.PROCESSORS[p.id](out, { ...p.opts, seed: (p.opts && p.opts.seed != null ? p.opts.seed : E.index + 1) + 1000 * SEED });
  if (!(out instanceof Buf)) out = Buf.from(out.L, out.R);
  // dive crescendo (the last beat rises into the next downbeat)
  if (spec.crescDb) out = dsp.automate(out, [[0, 0], [E.diveT0 - off - 0.1, 0], [E.t1 - off, spec.crescDb]], { shape: 'smooth' });
  // window: soft fade-in over the pre-roll, tail decays after the bar end (the next era takes over)
  const tau = spec.tailTau || 0.5;
  const endL = E.t1 - off;
  const nI = Math.round(0.4 * SR);
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    let g = i < nI ? 0.5 - 0.5 * Math.cos((Math.PI * i) / nI) : 1;
    if (t > endL) g *= Math.exp(-(t - endL) / tau);
    out.L[i] *= g;
    out.R[i] *= g;
  }
  // loudness calibration of the bar (the arc of the whole piece is set by spec.target)
  let trim = 0;
  if (spec.target != null) {
    const m = meter.lufsGateStats(out, PRE, PRE + BAR);
    trim = spec.target - m.ungated;
    out.gain(trim);
  }
  log && log(`  era ${E.index} ${E.year} ${E.music.padEnd(15)} target ${spec.target} LUFS  trim ${trim.toFixed(1)} dB`);
  if (DEBUG_LAYERS && log) {
    const bandPct = (b, lo, hi) => {
      const a = Math.round(PRE * SR), z = Math.round((PRE + BAR) * SR);
      let x = Float32Array.from(b.L.subarray(a, z));
      const tot = x.reduce((q, v) => q + v * v, 0) + 1e-20;
      if (lo > 0) x = dsp.biquad(x, 'hp', lo, 0.707);
      if (hi < 20000) x = dsp.biquad(x, 'lp', hi, 0.707);
      return (100 * x.reduce((q, v) => q + v * v, 0)) / tot;
    };
    for (const L of spec.layers) {
      const b = stems[L.name];
      const rms = meter.rmsDb(b, PRE, PRE + BAR) + (L.db || 0) + trim;
      log(`      ${L.name.padEnd(10)} ${L.id.padEnd(16)} rms ${rms.toFixed(1).padStart(6)} dBFS  <120Hz ${bandPct(b, 0, 120).toFixed(0).padStart(3)}%  >2k ${bandPct(b, 2000, 20000).toFixed(0).padStart(3)}%`);
    }
  }
  return { buf: out, off, trim, stems };
}

// ---------------------------------------------------------------------------------------------------------------------
// the nine eras (builders are pure: they return a spec; nothing renders until mixEra)
// ---------------------------------------------------------------------------------------------------------------------
const kitOpts = (E, layer) => ({ ...(inst.ERA_STYLES[E.music].layers[layer].opts || {}) });

const ERA_BUILDERS = [];

// ---- 1895  silent-film upright, ragtime vamp (Am) --------------------------------------------------------------------
ERA_BUILDERS[0] = (E) => {
  const t0 = E.t0, ch = chordOf(E), bass = BASSV[ch], five = FIFTH[ch];
  const rh = [...motif(t0, { vel: [0.8, 0.6, 0.66, 0.86] }), ...pickup(E, 0, [0.5, 0.85], SIXTEENTH * 1.1)];
  const chord = [57, 60, 64]; // A3 C4 E4 closed
  const lh = lockDown(t0, [
    N(t0, bass, 0.42, 0.74), N(t0, bass + 12, 0.42, 0.52), // oom
    ...chord.map((m) => N(T(t0, 1), m, 0.3, 0.5)), // pah
    N(T(t0, 2), five, 0.42, 0.68), N(T(t0, 2), five - 12, 0.42, 0.4), // alternating bass: the fifth
    ...chord.map((m) => N(T(t0, 3), m, 0.2, 0.3)), // a whisper of a pah under the run
  ]);
  const o = kitOpts(E, 'motif');
  return {
    layers: [
      { name: 'rh', id: 'piano', notes: hum(rh, 'e0rh', { bias: 0.002 }), opts: { ...o, seed: 11 }, db: 0, send: 1, pan: 0.08 },
      { name: 'lh', id: 'piano', notes: hum(lh, 'e0lh', { bias: -0.002 }), opts: { ...o, seed: 12 }, db: -4.5, send: 0.9, pan: -0.1 },
    ],
    reverb: { preset: 'room', wet: 0.16 },
    tailTau: 0.45, target: -27.5, crescDb: 1.2,
  };
};

// ---- 1902  piano + celesta + music box (stage magic) (F) ---------------------------------------------------------------
ERA_BUILDERS[1] = (E) => {
  const t0 = E.t0, ch = chordOf(E), bass = BASSV[ch], five = FIFTH[ch];
  const v = (a) => a.map((x) => x * 0.92);
  const rh = [...motif(t0, { vel: v([0.78, 0.6, 0.66, 0.84]) }), ...pickup(E, 0, [0.5, 0.85], SIXTEENTH * 1.1)];
  const chord = PADV[ch]; // F3 A3 C4
  const lh = lockDown(t0, [
    N(t0, bass, 0.4, 0.74), N(t0, five, 0.4, 0.5), // oom
    ...chord.map((m) => N(T(t0, 1), m, 0.28, 0.5)), // pah
    ...chord.map((m) => N(T(t0, 1.5), m, 0.14, 0.34)), // busier: a syncopated stab
    N(T(t0, 2), five, 0.4, 0.66), N(T(t0, 2), bass, 0.4, 0.5),
    ...chord.map((m) => N(T(t0, 3), m, 0.2, 0.3)),
  ]);
  const cel = [...motif(t0, { octave: 1, vel: [0.52, 0.4, 0.44, 0.56] }), ...pickup(E, 1, [0.4, 0.72], 0.3)];
  // the music box answers the motif, two octaves up, a beat later (an echo from the stage)
  const mb = th.motifEvents(T(t0, 1), { octave: 2, vel: [0.46, 0.38, 0.42, 0.5] }).map((e) => N(e.t, e.midi, e.dur, e.vel)).filter((n) => n.t < E.t1 + 1);
  return {
    layers: [
      { name: 'rh', id: 'piano', notes: hum(rh, 'e1rh', { bias: 0.002 }), opts: { ...kitOpts(E, 'motif'), seed: 21 }, db: 0, send: 1, pan: 0.08 },
      { name: 'lh', id: 'piano', notes: hum(lh, 'e1lh', { bias: -0.002 }), opts: { ...kitOpts(E, 'rhythm'), seed: 22 }, db: -5, send: 0.9, pan: -0.1 },
      { name: 'celesta', id: 'celesta', notes: hum(cel, 'e1c', { bias: 0.003 }), opts: { seed: 23 }, db: -6, send: 1.2, pan: 0.25 },
      { name: 'musicbox', id: 'musicbox', notes: hum(mb, 'e1m', { bias: 0.002 }), opts: { seed: 24 }, db: -3, send: 1.3, pan: -0.3 },
    ],
    reverb: { preset: 'chamber', wet: 0.2 },
    tailTau: 0.6, target: -26, crescDb: 1.2,
  };
};

// ---- 1927  lush strings (C) -- first "sound" era: sustained notes only under the "Hello!" (vo_hello 9.0) ---------------
ERA_BUILDERS[2] = (E) => {
  const t0 = E.t0, ch = chordOf(E), next = th.chordForTime(E.t1).name;
  const vln = motif(t0, { octave: 1, vel: [0.72, 0.56, 0.62, 0.74] });
  const vla = motif(t0, { octave: 0, vel: [0.5, 0.4, 0.44, 0.52] });
  const padn = PADV[ch];
  const pad = padn.map((m) => N(t0, m, BAR * 0.96, 0.52));
  const low = [N(t0, 36, BAR * 0.97, 0.56), N(t0, 43, BAR * 0.97, 0.46)]; // C2 G2: cellos + basses
  const pizzBass = lockDown(t0, [N(t0, 48, 0.3, 0.86), N(t0, 55, 0.3, 0.74), N(t0, 36, 0.3, 0.7)]);
  const pizzChord = [64, 67, 72].map((m) => N(T(t0, 1), m, 0.2, 0.46));
  // pickup: a swell on the NEXT chord's low voices (G D G) into the downbeat + spiccato A4 B4 C5 D5
  const swell = [43, 50, 55].map((m) => N(E.diveT0, m, BEAT, 0.6));
  const run = pickup(E, 1, [0.46, 0.8], SIXTEENTH * 0.8);
  return {
    layers: [
      { name: 'violins', id: 'strings_high', notes: hum(vln, 'e2v'), opts: { ...kitOpts(E, 'motif'), attackScale: 0.55, seed: 31 }, db: 0, send: 1, pan: 0.15 },
      { name: 'violas', id: 'strings', notes: hum(vla, 'e2va'), opts: { art: 'legato', attackScale: 0.6, section: 'mid', seed: 32 }, db: -3, send: 1, pan: -0.2 },
      { name: 'pad', id: 'strings', notes: pad, opts: { art: 'legato', seed: 33 }, db: -4, send: 1.1, pan: 0 },
      { name: 'low', id: 'strings_low', notes: low, opts: { seed: 34 }, db: -4.5, send: 0.8, pan: 0 },
      { name: 'pizz', id: 'strings_pizz', notes: hum([...pizzBass, ...pizzChord], 'e2p', { bias: 0 }), opts: { seed: 35 }, db: -6, send: 0.7, pan: -0.1 },
      { name: 'swell', id: 'strings', notes: swell, opts: { art: 'swell', seed: 36 }, db: -5, send: 1, pan: 0 },
      { name: 'run', id: 'strings_spiccato', notes: hum(run, 'e2r', { timing: 0.003 }), opts: { seed: 37 }, db: -4, send: 1, pan: 0.2 },
    ],
    reverb: { preset: 'chamber', wet: 0.24 },
    tailTau: 0.7, target: -24.5, crescDb: 1.5,
  };
};

// ---- 1939  strings + harp + woodwinds, full colour (G) -------------------------------------------------------------------
ERA_BUILDERS[3] = (E) => {
  const t0 = E.t0, ch = chordOf(E);
  const vln = motif(t0, { octave: 1, vel: [0.74, 0.58, 0.64, 0.78] });
  const clar = motif(t0, { octave: 0, vel: [0.5, 0.4, 0.44, 0.54] });
  const flu = motif(t0, { octave: 1, vel: [0.34, 0.3, 0.32, 0.4] });
  const pad = PADV_SUS[ch].map((m) => N(t0, m, BAR * 0.96, 0.5));
  const cello = [N(t0, BASSV[ch], BAR * 0.97, 0.58), N(t0, BASSV[ch] + 7, BAR * 0.97, 0.4)];
  // the colour floods in: a harp glissando on the downbeat (first pluck exactly on t0), then rolling arpeggio 8ths
  const bloom = inst.harpGliss(t0, 43, 79, { step: 0.017, vel: [0.55, 0.85], dur: 0.14 }).map((n, i) => ({ ...n, lock: i === 0 }));
  const arpNotes = [59, 62, 67, 71, 74, 71]; // B3 D4 G4 B4 D5 B4
  const arp = arpNotes.map((m, i) => N(T(t0, 1) + i * (BEAT / 2) * 0.5 * 2 / 2, m, 0.35, 0.42 + (i % 2) * 0.06));
  const hp = inst.harpGliss(E.diveT0, 55, 86, { step: 0.0125, vel: [0.35, 0.8], dur: 0.12 });
  const fluteRun = pickup(E, 2, [0.5, 0.85], 0.12);
  return {
    layers: [
      { name: 'violins', id: 'strings_high', notes: hum(vln, 'e3v'), opts: { ...kitOpts(E, 'motif'), attackScale: 0.55, seed: 41 }, db: 0, send: 1, pan: 0.18 },
      { name: 'pad', id: 'strings', notes: pad, opts: { art: 'legato', seed: 42 }, db: -4, send: 1.1, pan: 0 },
      { name: 'cello', id: 'strings_low', notes: cello, opts: { seed: 43 }, db: -5, send: 0.8, pan: -0.1 },
      { name: 'clarinet', id: 'clarinet', notes: hum(clar, 'e3c'), opts: { seed: 44 }, db: 0, send: 1, pan: -0.3 },
      { name: 'flute', id: 'flute', notes: hum(flu, 'e3f'), opts: { seed: 45 }, db: -1, send: 1, pan: 0.3 },
      { name: 'harp', id: 'harp', notes: hum([...bloom, ...arp, ...hp], 'e3h', { timing: 0.003 }), opts: { ring: 2.6, seed: 46 }, db: -9, send: 1, pan: -0.15 },
      { name: 'run', id: 'flute', notes: fluteRun, opts: { seed: 47 }, db: -1, send: 1, pan: 0.3 },
    ],
    reverb: { preset: 'hall', wet: 0.26 },
    tailTau: 0.8, target: -23, crescDb: 1.5,
  };
};

// ---- 1960  horns + choir + timpani, widescreen epic (Am) -----------------------------------------------------------------
ERA_BUILDERS[4] = (E) => {
  const t0 = E.t0, ch = chordOf(E), next = th.chordForTime(E.t1).name;
  const hornA = motif(t0, { octave: 0, vel: [0.82, 0.62, 0.68, 0.86] });
  const hornB = motif(t0, { octave: -1, vel: [0.7, 0.54, 0.58, 0.74] });
  const choir = [45, 52, 57, 60, 64, 69].map((m) => N(t0, m, BAR * 0.97, 0.62));
  const timp = lockDown(t0, [N(t0, BASSV[ch], 0.9, 0.95, { rim: true }), N(T(t0, 2), BASSV[ch], 0.9, 0.8)]);
  const roll = inst.drumRoll(E.diveT0, E.t1 - 0.07, { midi: BASSV[next], rate: 22, vel: [0.25, 0.92], seed: 51 });
  const tuba = [33, 45, 52].map((m) => N(t0, m, BAR * 0.95, 0.66));
  const cellos = [45, 52, 57].map((m) => N(t0, m, BAR * 0.97, 0.56));
  const swell = [BASSV[next], BASSV[next] + 7].map((m) => N(E.diveT0, m, BEAT, 0.66));
  const run = pickup(E, 1, [0.46, 0.82], SIXTEENTH * 0.8);
  return {
    layers: [
      { name: 'horns', id: 'horns', notes: hum(hornA, 'e4h'), opts: { attackScale: 0.5, seed: 61 }, db: 1.5, send: 1, pan: 0.2 },
      { name: 'horns_lo', id: 'horns', notes: hum(hornB, 'e4hb'), opts: { attackScale: 0.5, seed: 62 }, db: -2, send: 1, pan: -0.2 },
      { name: 'choir', id: 'choir', notes: choir, opts: { ...kitOpts(E, 'pad'), seed: 63 }, db: -4, send: 1, pan: 0 },
      { name: 'timp', id: 'timpani', notes: hum([...timp, ...roll.map((n) => N(n.t, n.midi, 0.2, n.vel))], 'e4t', { timing: 0.002 }), opts: { seed: 64 }, db: -9, send: 0.7, pan: 0 },
      { name: 'tuba', id: 'brass_low', notes: tuba, opts: { seed: 65 }, db: -6, send: 0.6, pan: 0 },
      { name: 'cellos', id: 'strings_low', notes: cellos, opts: { seed: 66 }, db: -6, send: 1, pan: -0.1 },
      { name: 'swell', id: 'brass_low', notes: swell, opts: { art: 'swell', seed: 67 }, db: -6, send: 0.8, pan: 0 },
      { name: 'run', id: 'strings_spiccato', notes: hum(run, 'e4r', { timing: 0.003 }), opts: { seed: 68 }, db: -5, send: 1, pan: 0.2 },
    ],
    reverb: { preset: 'bigHall', wet: 0.3 },
    tailTau: 0.9, target: -20.5, crescDb: 1.5,
  };
};

// ---- 1977  heroic brass fanfare + snare rolls (F) -------------------------------------------------------------------------
ERA_BUILDERS[5] = (E) => {
  const t0 = E.t0, ch = chordOf(E), next = th.chordForTime(E.t1).name;
  const trpA = motif(t0, { octave: 1, vel: [0.88, 0.7, 0.76, 0.9] });
  const trpB = motif(t0, { octave: 0, vel: [0.74, 0.6, 0.64, 0.78] });
  const hn = PADV[ch].map((m) => N(t0, m, BAR * 0.95, 0.66));
  const low = [41, 48].map((m) => N(t0, m, BAR * 0.95, 0.7));
  const timp = lockDown(t0, [N(t0, 41, 0.9, 0.95), N(T(t0, 2), 41, 0.9, 0.85)]);
  // snare: march pattern + a roll across the last beat that crescendos into the next downbeat
  const pat = [[0, 0.95], [0.75, 0.42], [1, 0.72], [1.5, 0.55], [1.75, 0.42], [2, 0.92], [2.5, 0.56], [2.75, 0.44]];
  const snare = lockDown(t0, pat.map(([b, v]) => ({ t: T(t0, b), vel: v })));
  const sroll = inst.drumRoll(E.diveT0, E.t1 - 0.07, { rate: 20, vel: [0.3, 0.95], seed: 71 });
  const ost = [];
  for (let i = 0; i < 12; i++) ost.push(N(t0 + i * SIXTEENTH, [53, 60, 57, 60][i % 4], 0.11, 0.62 + 0.1 * ((i % 4) === 0)));
  const run = pickup(E, 1, [0.55, 0.92], 0.1);
  const crash = [N(t0, 60, 0.5, 0.62, { lock: true })];
  return {
    layers: [
      { name: 'trumpets', id: 'trumpets', notes: hum(trpA, 'e5t'), opts: { art: 'sustain', seed: 81 }, db: 0, send: 1, pan: 0.15 },
      { name: 'trumpets_lo', id: 'trumpets', notes: hum(trpB, 'e5tb'), opts: { art: 'sustain', seed: 82 }, db: -3, send: 1, pan: -0.15 },
      { name: 'horns', id: 'horns', notes: hn, opts: { seed: 83 }, db: -3, send: 1, pan: 0 },
      { name: 'low', id: 'brass_low', notes: low, opts: { seed: 84 }, db: -7, send: 0.6, pan: 0 },
      { name: 'timp', id: 'timpani', notes: hum(timp, 'e5ti', { timing: 0.002 }), opts: { seed: 85 }, db: -10, send: 0.6, pan: 0 },
      { name: 'snare', id: 'snare', notes: hum([...snare, ...sroll.map((n) => ({ t: n.t, vel: n.vel }))], 'e5s', { timing: 0.002, vel: 0.04 }), opts: { variant: 'crack', seed: 86 }, db: -5, send: 0.35, pan: 0 },
      { name: 'ostinato', id: 'strings_ostinato', notes: ost, opts: { seed: 87 }, db: -9, send: 0.8, pan: 0.1 },
      { name: 'run', id: 'trumpets', notes: hum(run, 'e5r', { timing: 0.003 }), opts: { art: 'stab', seed: 88 }, db: -4, send: 1, pan: 0.15 },
      { name: 'crash', id: 'cymbal', notes: crash, opts: { seed: 89 }, db: -9, send: 0.5, pan: 0 },
    ],
    reverb: { preset: 'hall', wet: 0.27 },
    tailTau: 0.8, target: -18.5, crescDb: 1.5,
  };
};

// ---- 1993  synth-orchestra hybrid (C) -- VO2 starts here (16.0): keep 2-5 kHz clear, warm bed ---------------------------------
ERA_BUILDERS[6] = (E) => {
  const t0 = E.t0, ch = chordOf(E);
  const bell = motif(t0, { octave: 0, vel: [0.8, 0.6, 0.66, 0.84] });
  const bellHi = motif(t0, { octave: 1, vel: [0.7, 0.52, 0.58, 0.74] });
  const soften = (b) => dsp.biquad(b, 'lp', 6500, 0.707);
  const pad = [52, 55, 60, 64].map((m) => N(t0, m, BAR * 0.96, 0.58));
  const strings = [48, 55, 64, 67].map((m) => N(t0, m, BAR * 0.96, 0.5));
  const stab = lockDown(t0, [48, 55, 60, 64].map((m) => N(t0, m, 0.24, 0.9)));
  const kick = lockDown(t0, [N(t0, 33, 0.3, 0.95), N(T(t0, 2), 33, 0.3, 0.9), N(T(t0, 2.5), 33, 0.3, 0.55)]);
  const snare = [N(T(t0, 1), 53, 0.3, 0.9), N(T(t0, 3), 53, 0.3, 0.95)];
  const bass = lockDown(t0, [N(t0, 36, 0.42, 0.9), N(T(t0, 0.75), 36, 0.18, 0.7), N(T(t0, 1.5), 43, 0.3, 0.75), N(T(t0, 2), 36, 0.42, 0.88), N(T(t0, 2.75), 36, 0.18, 0.64)]);
  const run = pickup(E, 1, [0.5, 0.85], 0.1);
  return {
    layers: [
      { name: 'bell', id: 'fm_bell', notes: hum(bell, 'e6b'), opts: { index: 0.7, seed: 91 }, db: -2, send: 1.1, pan: 0.15, fx: soften },
      { name: 'bell_hi', id: 'fm_bell', notes: hum(bellHi, 'e6bh'), opts: { index: 0.6, seed: 90 }, db: -8, send: 1.3, pan: -0.2, fx: soften },
      { name: 'pad', id: 'synth_pad', notes: pad, opts: { seed: 92 }, db: -9, send: 0.9, pan: 0 },
      { name: 'strings', id: 'strings', notes: strings, opts: { art: 'legato', attackScale: 0.8, seed: 93 }, db: -9, send: 1, pan: 0 },
      { name: 'stab', id: 'supersaw', notes: stab, opts: { maxGate: 0.3, decay: 0.2, seed: 94 }, db: -6, send: 0.5, pan: 0 },
      { name: 'kick', id: 'kick', notes: kick, opts: { variant: 'tight', seed: 95 }, db: -11, send: 0.1, pan: 0 },
      { name: 'snare', id: 'snare_gated', notes: hum(snare, 'e6s', { timing: 0.002 }), opts: { seed: 96 }, db: -5, send: 0.1, pan: 0 },
      { name: 'bass', id: 'synth_bass', notes: hum(bass, 'e6bs', { timing: 0.002 }), opts: { seed: 97 }, db: -11, send: 0, pan: 0 },
      { name: 'run', id: 'synth_pulse', notes: hum(run, 'e6r', { timing: 0.002 }), opts: { echo: 0.25, seed: 98 }, db: -4, send: 0.8, pan: 0.2 },
      { name: 'swell', id: 'reverse_swell', notes: [{ t: T(t0, 1), dur: BEAT * 3, vel: 0.6 }], opts: { seed: 99 }, db: -13, send: 0, pan: 0 },
    ],
    reverb: { preset: 'plate', wet: 0.22 },
    voPocketDb: -3, tailTau: 0.7, target: -17, crescDb: 1.5, post: (b) => dsp.biquad(b, 'hp', 32, 0.707),
  };
};

// ---- 2009  braams + taiko + risers (G) ----------------------------------------------------------------------------------
ERA_BUILDERS[7] = (E) => {
  const t0 = E.t0, ch = chordOf(E);
  const lo = motif(t0, { octave: -2, vel: [0.88, 0.7, 0.74, 0.9] }); // E2 G2 A2 C3: weight
  const hi = motif(t0, { octave: -1, vel: [0.8, 0.64, 0.68, 0.84] }); // E3 G3 A3 C4: the line itself
  const horn = motif(t0, { octave: 0, vel: [0.7, 0.56, 0.6, 0.76] }); // E4 G4 A4 C5: hard-edged horns keep the motif readable on small speakers
  const braam = lockDown(t0, [N(t0, 31, 1.1, 0.92)]);
  const trem = [43, 50, 55, 62].map((m) => N(t0, m, BAR * 0.97, 0.6));
  const taiko = lockDown(t0, [[0, 43, 1], [1.5, 38, 0.8], [2, 43, 0.98], [3, 38, 0.86]].map(([b, m, v]) => N(T(t0, b), m, 0.5, v)));
  const flam = inst.drumRoll(T(t0, 3.25), E.t1 - 0.07, { midi: 38, rate: 20, vel: [0.45, 0.98], seed: 101 }).map((n) => N(n.t, n.midi, 0.2, n.vel));
  const sub = lockDown(t0, [N(t0, 31, 0.9, 0.85)]);
  const imp = lockDown(t0, [{ t: t0, vel: 0.7, size: 'M' }]);
  const run = pickup(E, 0, [0.6, 0.95], 0.1).map((n) => ({ ...n }));
  return {
    layers: [
      { name: 'brass_lo', id: 'brass_low', notes: hum(lo, 'e7l'), opts: { ...kitOpts(E, 'motif'), seed: 111 }, db: 0, send: 0.9, pan: 0 },
      { name: 'brass_hi', id: 'brass_low', notes: hum(hi, 'e7h'), opts: { ...kitOpts(E, 'motif'), seed: 112 }, db: -3, send: 0.9, pan: 0.1 },
      { name: 'horns', id: 'horns', notes: hum(horn, 'e7hn'), opts: { art: 'stab', seed: 120 }, db: -6, send: 0.9, pan: 0.2 },
      { name: 'braam', id: 'braam', notes: braam, opts: { seed: 113 }, db: -8, send: 0.7, pan: 0 },
      { name: 'trem', id: 'strings_tremolo', notes: trem, opts: { section: 'low', seed: 114 }, db: -6, send: 1, pan: 0 },
      { name: 'taiko', id: 'taiko', notes: hum([...taiko, ...flam], 'e7t', { timing: 0.002 }), opts: { seed: 115 }, db: -13, send: 0.8, pan: 0 },
      { name: 'sub', id: 'sub808', notes: sub, opts: { decay: 0.7, drive: 1.8, seed: 116 }, db: -14, send: 0, pan: 0 },
      { name: 'impact', id: 'impact', notes: imp, opts: { seed: 117 }, db: -13, send: 0.4, pan: 0 },
      { name: 'run', id: 'brass_low', notes: hum(run, 'e7r', { timing: 0.003 }), opts: { art: 'stab', seed: 118 }, db: -5, send: 0.9, pan: 0 },
      { name: 'riser', id: 'riser', notes: [{ t: T(t0, 2), dur: BEAT * 2, vel: 0.9, midi: 88 }], opts: { seed: 119 }, db: -4, send: 0.3, pan: 0 },
    ],
    reverb: { preset: 'bigHall', wet: 0.24 },
    voPocketDb: -3, tailTau: 0.7, target: -14.5, crescDb: 0, post: (b) => dsp.biquad(b, 'hp', 32, 0.707),
  };
};

// ---- 2025  lo-fi phone beat (Am): band-limited mono 400 Hz-4 kHz, bitcrush, dusty drums -------------------------------------
ERA_BUILDERS[8] = (E) => {
  const t0 = E.t0, ch = chordOf(E);
  const pno = motif(t0, { vel: [0.72, 0.56, 0.62, 0.74] });
  const pad = [52, 57, 60, 64].map((m) => N(t0, m, BAR * 0.96, 0.5));
  const kick = lockDown(t0, [N(t0, 45, 0.3, 0.95), N(T(t0, 1.5), 45, 0.3, 0.72), N(T(t0, 2.25), 45, 0.3, 0.5)]);
  // the phone speaker has no bottom end: drive the kick / bass hard BEFORE the band-limit so their harmonics become the knock
  const crunch = (drive) => (b) => dsp.biquad(dsp.waveshape(b, 'tanh', drive, { oversample: 2 }), 'hp', 60, 0.707);
  const snare = lockDown(t0, [{ t: T(t0, 1), vel: 0.82 }, { t: T(t0, 2.5), vel: 0.34 }, { t: T(t0, 2.75), vel: 0.46 }]);
  const hats = [];
  for (let k = 0; k < 6; k++) hats.push({ t: t0 + k * (BEAT / 2) + (k % 2 ? 0.035 : 0), vel: k % 2 ? 0.28 : 0.5 });
  const bass = lockDown(t0, [N(t0, 45, 0.7, 0.9), N(T(t0, 1.5), 45, 0.3, 0.6)]);
  return {
    layers: [
      { name: 'piano', id: 'piano', notes: hum(pno, 'e8p', { bias: 0.003, timing: 0.003 }), opts: { ...kitOpts(E, 'motif'), seed: 121 }, db: 0, send: 0.8, pan: 0 },
      { name: 'pad', id: 'synth_pad', notes: pad, opts: { ...kitOpts(E, 'pad'), seed: 122 }, db: -7, send: 0.7, pan: 0 },
      { name: 'kick', id: 'kick', notes: hum(kick, 'e8k', { timing: 0.002 }), opts: { variant: 'soft', seed: 123 }, db: -3, send: 0.1, pan: 0, fx: crunch(6) },
      { name: 'snare', id: 'snare', notes: hum(snare, 'e8s', { timing: 0.003, bias: 0.003 }), opts: { variant: 'dusty', seed: 124 }, db: -2, send: 0.2, pan: 0 },
      { name: 'hat', id: 'hat', notes: hum(hats, 'e8h', { timing: 0.002 }), opts: { seed: 125 }, db: -1, send: 0.1, pan: 0.2 },
      { name: 'bass', id: 'sub808', notes: bass, opts: { decay: 0.6, drive: 2.4, seed: 126 }, db: -6, send: 0, pan: 0, fx: crunch(7) },
    ],
    reverb: { preset: 'room', wet: 0.1 },
    voPocketDb: -3, tailTau: 0.2, target: -21, crescDb: 0,
  };
};

// ---------------------------------------------------------------------------------------------------------------------
// the cold open (0-4)
// ---------------------------------------------------------------------------------------------------------------------
function renderColdOpen(A, log) {
  const first = ERAS[0].t0; // 4.0
  const pT = 3.0; // the ONE piano note: E4 (MOTIF.notes[0].midi) at t=3.0
  const droneT = 1.0;
  // drone: A1 + E2 + A2, perceived onset 1.0, growing into the era
  const dn = [N(droneT, 33, first - droneT + 0.3, 0.62), N(droneT, 40, first - droneT + 0.3, 0.34), N(droneT, 45, first - droneT + 0.3, 0.5)];
  let dr = renderLayer('drone', dn, { attack: 1.4, release: 1.4, seed: 5 }, LOCAL_SEC);
  // nothing before ~0.95 (projector-room silence), swell 1.0 -> 4.0, release under the 1895 piano
  dr = dsp.automate(dr, [[0, -120], [0.92, -120], [1.0, -42], [1.3, -22], [1.9, -13], [pT, -6], [first - 0.1, 0], [first + 0.3, -3], [first + 1.8, -30], [first + 2.6, -80]], { shape: 'smooth' });
  for (let i = 0; i < Math.round(0.92 * SR); i++) { dr.L[i] = 0; dr.R[i] = 0; }
  dr.gain(-11);
  dsp.addAt(A, dr, 0, 0, 0);
  // the one note: clean grand, pedal, soft, bathed in a big cathedral that rings across the first era's downbeat
  const e4 = th.motifEvents(0).find((n) => n.beat === 0).midi;
  const pn = renderLayer('piano_grand', [N(pT, e4, 1.6, 0.56)], { pedal: true, pedalRelease: 2.4, seed: 7 }, LOCAL_SEC);
  const wet = dsp.applyReverb(pn, 'cathedral', { wet: 0.62, wetOnly: true, preDelay: 0.05, tail: 0 });
  const wetEnv = dsp.automate(wet, [[0, 0], [first + 0.2, 0], [first + 2.5, -18], [first + 4.5, -60]], { shape: 'smooth' });
  pn.gain(-5.5);
  dsp.addAt(A, pn, 0, 0, 0);
  dsp.addAt(A, wetEnv, 0, -4, 0);
  // a ghost of the note drawn in from the reverb just before it (eyes opening): reversed tail, very soft
  const rv = dsp.reverseReverb(Buf.from(pn.L.slice(Math.round(pT * SR), Math.round((pT + 1.0) * SR)), pn.R.slice(Math.round(pT * SR), Math.round((pT + 1.0) * SR))), { preset: 'hall', wet: 1, tail: 0.9 });
  dsp.addAt(A, rv.buf, pT - rv.offset, -24, 0);
  log && log('  cold open: drone 1.0, piano E4 3.0');
}

// ---------------------------------------------------------------------------------------------------------------------
// NOW (21.5) : a big upward gesture, full band, then the hard cut at 22.0
// ---------------------------------------------------------------------------------------------------------------------
function renderNow(A, log) {
  const t = NOW_T;
  const len = FREEZE_T - t; // 0.5 s of hit, then the cut
  const off = t - 1.6;
  const L = 3.0;
  const buf = new Buf(L);
  const put = (id, notes, opts, db = 0, send = 0) => {
    const b = renderLayer(id, notes.map((n) => ({ ...n, t: n.t - off })), opts, L);
    dsp.addAt(buf, b, 0, db, 0);
    return b;
  };
  const feed = new Buf(L);
  const add = (id, notes, opts, db, send) => {
    const b = put(id, notes, opts, db);
    if (send > 0) dsp.addAt(feed, b, 0, db + dsp.linToDb(send), 0);
  };
  // the swell: noise+tone riser reaching its peak exactly at NOW, strings crescendo on A, a harp rush upward
  add('riser', [{ t: t - BEAT * 1.1, dur: BEAT * 1.1, vel: 0.9, midi: 91 }], { topHz: 12000, seed: 201 }, -6, 0.3);
  add('strings', [57, 64, 69, 72].map((m) => N(t - BEAT, m, BEAT, 0.7)), { art: 'swell', seed: 202 }, -5, 1);
  const rush = inst.harpGliss(t - 0.4, 45, 105, { step: 0.0065, vel: [0.35, 0.9], dur: 0.1 });
  add('harp', rush, { ring: 1.0, seed: 203 }, -8, 1);
  // the hit: Am, voiced upward A2 E3 A3 C4 E4 A4 C5 E5 (brass + strings + timpani + taiko + cymbal + sub)
  const hit = (arr, vel, dur = len) => arr.map((m, i) => N(t, m, dur, vel, { lock: i === 0 }));
  add('trumpets', hit([64, 69, 72, 76], 1.0), { art: 'sustain', attackScale: 0.4, seed: 204 }, -5, 0.6);
  add('horns', hit([57, 60, 64, 69], 1.0), { seed: 205 }, -4, 0.6);
  add('brass_low', hit([33, 45, 52], 1.0), { seed: 206 }, -6, 0.5);
  add('strings', hit([45, 57, 64, 72], 0.95), { art: 'legato', attackScale: 0.35, seed: 207 }, -6, 0.7);
  add('timpani', [N(t, 45, 0.5, 1.0, { lock: true })], { seed: 208 }, -3, 0.4);
  add('taiko', [N(t, 38, 0.5, 1.0, { lock: true })], { seed: 209 }, -4, 0.5);
  add('cymbal', [N(t, 60, 0.5, 0.95, { lock: true })], { seed: 210 }, -8, 0.5);
  add('impact', [{ t, vel: 0.85, size: 'M', lock: true }], { seed: 211 }, -8, 0.4);
  add('sub808', [N(t, 33, 0.5, 0.95, { lock: true })], { decay: 0.7, drive: 1.6, seed: 212 }, -5, 0);
  const w = dsp.applyReverb(feed, 'hall', { wet: 0.22, wetOnly: true });
  dsp.addAt(buf, w, 0, 0, 0);
  const trim = -13.5 - meter.lufsGateStats(buf, 1.6, 2.1).ungated;
  buf.gain(trim);
  dsp.addAt(A, buf, off, 0, 0);
  log && log(`  NOW hit at ${t}: trim ${trim.toFixed(1)} dB`);
}

// ---------------------------------------------------------------------------------------------------------------------
// the turn: sub drop (22.5), drone breath under the VO, solo piano (24.0 .. 26.0, tail rings on)
// ---------------------------------------------------------------------------------------------------------------------
/** a low sine/triangle boom: A1 (55 Hz) with a fast pitch settle + A0 (27.5 Hz) body; tail about 2.5 s. Mono-compatible, centred. */
export function subBoom(t, peak = 0.34) {
  const len = 4.2;
  const n = Math.round(len * SR);
  const x = new Float32Array(n);
  let p1 = 0, p0 = 0, p2 = 0;
  const f1 = dsp.midiToHz(33), f0 = dsp.midiToHz(21);
  for (let i = 0; i < n; i++) {
    const s = i / SR;
    const settle = 1 + 0.55 * Math.exp(-s / 0.045); // the boom lands 5 semitones sharp and drops into A
    p1 += (Math.PI * 2 * f1 * settle) / SR;
    p2 += (Math.PI * 2 * f1 * 2 * (1 + 0.3 * Math.exp(-s / 0.04))) / SR;
    p0 += (Math.PI * 2 * f0 * (1 + 0.4 * Math.exp(-s / 0.07))) / SR;
    const atk = 1 - Math.exp(-s / 0.004);
    const e1 = atk * (0.55 * Math.exp(-s / 0.3) + 0.45 * Math.exp(-s / 0.62));
    const e0 = (1 - Math.exp(-s / 0.03)) * Math.exp(-s / 0.8);
    const e2 = atk * Math.exp(-s / 0.42);
    // triangle-ish: fundamental + a soft 3rd harmonic so it speaks on small speakers
    x[i] = e1 * (Math.sin(p1) + 0.12 * Math.sin(3 * p1)) + 0.5 * e0 * Math.sin(p0) + 0.2 * e2 * Math.sin(p2);
  }
  let pk = 0;
  for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(x[i]));
  const g = peak / pk;
  for (let i = 0; i < n; i++) x[i] *= g;
  dsp.fade(x, 0, 0.5, 'cos');
  return { buf: Buf.fromMono(x), t };
}

function renderTurn(A, log) {
  // --- 22.5: the sub drop (musical part) ---
  const sb = subBoom(SILENCE_END);
  dsp.addAt(A, sb.buf, SILENCE_END, 0, 0);
  // --- the drone breathes back under the VO (a quiet echo of the cold open), gone before the piano ---
  const dn = [N(SILENCE_END, 33, 1.0, 0.5), N(SILENCE_END, 40, 1.0, 0.3), N(SILENCE_END, 45, 1.0, 0.42)];
  let dr = renderLayer('drone', dn, { attack: 1.2, release: 0.9, seed: 9 }, LOCAL_SEC);
  dr = dsp.automate(dr, [[0, -120], [SILENCE_END, -120], [SILENCE_END + 0.5, -14], [PIANO_T0 - 0.4, -6], [PIANO_T0 + 0.5, -40], [PIANO_T0 + 0.9, -90]], { shape: 'smooth' });
  for (let i = 0; i < Math.round(SILENCE_END * SR); i++) { dr.L[i] = 0; dr.R[i] = 0; }
  dr.gain(-30);
  dsp.addAt(A, dr, 0, 0, 0);
  // --- solo piano: motif E4 G4 A4 C5 in even quarters (the "even" reading of cues.MOTIF), left hand sparse, big hall ---
  const ev = th.motifEvents(PIANO_T0, { rhythm: 'even', vel: [0.5, 0.56, 0.74, 0.7] });
    const rh = ev.map((e, i) => N(e.t + [0, 0.002, 0.001, 0.003][i], e.midi, i === 3 ? 1.0 : 0.62, e.vel, { lock: true }));
  const lh = [
    N(PIANO_T0, 41, 1.5, 0.42), N(PIANO_T0, 48, 1.5, 0.34), // F2 + C3 under the first two notes
    N(PIANO_T0 + 2 * BEAT, 29, 0.8, 0.62), N(PIANO_T0 + 2 * BEAT, 41, 0.8, 0.55), // the hit on A4 (25.0): F1 + F2 (short: the F clears before the C chord of 26.0)
    N(PIANO_T0 + 2 * BEAT, 53, 0.7, 0.34), // F3
  ];
  const pn = renderLayer('piano_grand', rh, { pedal: true, pedalRelease: 1.8, brightScale: 0.9, seed: 301 }, LOCAL_SEC);
  const pl = renderLayer('piano_grand', lh, { pedal: true, pedalRelease: 0.6, brightScale: 0.7, seed: 302 }, LOCAL_SEC);
  const mix = new Buf(LOCAL_SEC);
  dsp.addAt(mix, pn, 0, 0, 0);
  dsp.addAt(mix, pl, 0, -3, 0);
  let wet = dsp.applyReverb(mix, 'bigHall', { wet: 0.5, wetOnly: true, preDelay: 0.035, decay: 4.2 });
  wet = dsp.automate(wet, [[0, 0], [TURN.t1 + 1.0, 0], [TURN.t1 + 3.4, -26], [TURN.t1 + 4.8, -70]], { shape: 'smooth' });
  const dryAuto = dsp.automate(mix, [[0, 0], [TURN.t1 + 1.6, 0], [TURN.t1 + 3.2, -40], [TURN.t1 + 4.0, -90]], { shape: 'smooth' });
  const solo = new Buf(LOCAL_SEC);
  dsp.addAt(solo, dryAuto, 0, 0, 0);
  dsp.addAt(solo, wet, 0, 0, 0);
  const trim = -25.5 - meter.lufsGateStats(solo, PIANO_T0, TURN.t1).ungated;
  solo.gain(trim);
  dsp.addAt(A, solo, 0, 0, 0);
  log && log(`  turn: sub boom ${SILENCE_END}, piano ${PIANO_T0}..${TURN.t1} trim ${trim.toFixed(1)} dB`);
}

// ---------------------------------------------------------------------------------------------------------------------
// public
// ---------------------------------------------------------------------------------------------------------------------
/** the planned pitched events of every era layer + cold open + turn (for tests): [{era, layer, t, midi, dur, vel}] */
export function planA() {
  const PERC = ['kick', 'snare', 'snare_gated', 'hat', 'impact', 'timpani', 'taiko', 'sub808', 'cymbal', 'riser', 'reverse_swell', 'braam'];
  const out = [];
  ERAS.forEach((E, i) => {
    const spec = ERA_BUILDERS[i](E);
    for (const L of spec.layers) {
      if (PERC.includes(L.id)) continue;
      for (const n of L.notes) if (n.midi != null) out.push({ era: i, layer: L.name, id: L.id, t: n.t, midi: n.midi, dur: n.dur, vel: n.vel });
    }
  });
  // cold open / turn (fixed by the cues)
  const e4 = th.motifEvents(0).find((n) => n.beat === 0).midi;
  out.push({ era: -1, layer: 'coldopen_piano', id: 'piano_grand', t: 3.0, midi: e4, dur: 1.6, vel: 0.56 });
  for (const m of [33, 40, 45]) out.push({ era: -1, layer: 'drone', id: 'drone', t: 1.0, midi: m, dur: 3.3, vel: 0.5 });
  for (const e of th.motifEvents(PIANO_T0, { rhythm: 'even' })) out.push({ era: -2, layer: 'turn_piano', id: 'piano_grand', t: e.t, midi: e.midi, dur: e.dur, vel: e.vel });
  for (const m of [41, 48, 29, 53]) out.push({ era: -2, layer: 'turn_lh', id: 'piano_grand', t: PIANO_T0, midi: m, dur: 1.5, vel: 0.5 });
  return out;
}

export async function renderScoreA(buf, ctx = {}) {
  const log = ctx.log || (ctx.quiet ? null : (s) => console.log(s));
  CACHE_ON = ctx.cache !== false && process.env.SCORE_A_NOCACHE !== '1';
  DEBUG_LAYERS = !!ctx.debug;
  SEED = ctx.seed | 0;
  const t0 = process.hrtime.bigint();
  const past = new Buf(LOCAL_SEC);
  renderColdOpen(past, log);
  const only = ctx.eras || null;
  const report = { eras: [] };
  // every era is rendered into its own buffer, placed at its t0 - PRE; the 2009 tail is squeezed into the phone band at 20.0
  ERAS.forEach((E, i) => {
    if (only && !only.includes(i)) return;
    const spec = ERA_BUILDERS[i](E);
    const r = mixEra(E, spec, log);
    let b = r.buf;
    if (i === ERAS.length - 2) b = squeezeTail(b, r.off, ERAS[ERAS.length - 1].t0);
    dsp.addAt(past, b, r.off, 0, 0);
    report.eras.push({ index: i, year: E.year, t0: E.t0, trimDb: r.trim, target: spec.target });
  });
  if (!only || only.includes(ERAS.length - 1)) renderNow(past, log);
  // the breath before every downbeat: the whole mix dips ~40 ms ahead of each matte slide / hit, so the new orchestration lands with a clean attack
  for (const E of ERAS) if (!only || only.includes(E.index)) dipBefore(past, E.t0, 10);
  if (!only || only.includes(ERAS.length - 1)) dipBefore(past, NOW_T, 14);
  // hard cut: everything stops dead at the freeze, true digital silence until the sub drop
  dsp.cutAt(past, FREEZE_T, 0.003);
  // the turn is added AFTER the cut (its own silence rule: nothing before SILENCE_END)
  const turn = new Buf(LOCAL_SEC);
  renderTurn(turn, log);
  for (let i = 0; i < Math.round(SILENCE_END * SR); i++) { turn.L[i] = 0; turn.R[i] = 0; }
  const A = new Buf(LOCAL_SEC);
  dsp.addAt(A, past, 0, 0, 0);
  dsp.addAt(A, turn, 0, 0, 0);
  // master for A: gentle true-peak limiter at -3 dBFS (keeps the NOW hit and the sub drop honest)
  report.prePeakDb = dsp.linToDb(dsp.peakOf(A));
  const lim = dsp.limiter(A, { ceilingDb: -3.0, lookaheadMs: 4, releaseMs: 90 });
  const Lm = Buf.from(lim.L, lim.R);
  report.limiterStats = lim.stats || null;
  // keep the guarantee after limiting: nothing in the freeze window
  for (let i = Math.round(FREEZE_T * SR); i < Math.round(SILENCE_END * SR); i++) { Lm.L[i] = 0; Lm.R[i] = 0; }
  if (ctx.gainDb) Lm.gain(ctx.gainDb);
  if (buf) dsp.addAt(buf, Lm, 0, 0, 0);
  report.seconds = Number(process.hrtime.bigint() - t0) / 1e9;
  log && log(`score A rendered in ${report.seconds.toFixed(1)} s`);
  return { local: Lm, report };
}

/** gain dip of `depthDb` over [t-0.04, t] (cosine ramps: 8 ms down, 1 ms up) - the "breath" before a downbeat; downbeat events start >= t */
function dipBefore(buf, t, depthDb) {
  const a = Math.round((t - 0.04) * SR), z = Math.round(t * SR);
  const dn = Math.round(0.008 * SR), up = Math.round(0.001 * SR);
  const g = dB(-depthDb);
  for (let i = Math.max(0, a); i < Math.min(buf.length, z); i++) {
    const k = i - a;
    let m = 1;
    if (k < dn) m = 0.5 + 0.5 * Math.cos((Math.PI * k) / dn);
    else if (z - i < up) m = 0.5 + 0.5 * Math.cos((Math.PI * (z - i)) / up);
    else m = 0;
    const gain = 1 - (1 - g) * (1 - m);
    buf.L[i] *= gain;
    buf.R[i] *= gain;
  }
}

/** the 2009 reverb tail is squeezed into the phone speaker band over the 0.25 s matte squeeze at the 2025 downbeat, then dies */
function squeezeTail(b, off, tSq) {
  const sq = dsp.phoneSpeaker(b, { lo: 400, hi: 4000, mono: true, drive: 0 });
  const out = b.clone();
  const i0 = Math.round((tSq - off) * SR);
  const nR = Math.round(cues.ERA_MATTE_TIME * SR);
  const nD = Math.round(0.9 * SR);
  for (let i = i0; i < out.length; i++) {
    const x = clamp((i - i0) / nR, 0, 1);
    const r = x * x * (3 - 2 * x);
    const d = i - i0 < nD ? 0.5 + 0.5 * Math.cos((Math.PI * (i - i0)) / nD) : 0; // fade to nothing over 0.9 s
    out.L[i] = (b.L[i] * (1 - r) + sq.L[i] * r) * d;
    out.R[i] = (b.R[i] * (1 - r) + sq.R[i] * r) * d;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------------------------------
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const argv = process.argv.slice(2);
  const flag = (n) => argv.includes('--' + n);
  const val = (n) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : null; };
  if (flag('solo')) {
    const ctx = { cache: !flag('nocache'), debug: flag('dbg') };
    if (val('eras')) ctx.eras = val('eras').split(',').map(Number);
    const full = new Buf(cues.DURATION);
    const r = await renderScoreA(full, ctx);
    ensure(STEMS);
    const out = path.join(STEMS, 'music_a.wav');
    dsp.writeWav(out, full);
    console.log('wrote', out);
    if (flag('png')) {
      const ff = await import('../lib/ff.mjs');
      const dir = ensure(path.join(HERE, 'test_a'));
      for (const [name, start, dur] of [['score_a_spec', 0, 30], ['score_a_spec_coldopen_eras1-4', 0, 12], ['score_a_spec_eras5-9', 12, 10.2], ['score_a_spec_now_turn', 19.5, 11]]) {
        ff.spectrogramPng(out, path.join(dir, name + '.png'), { w: 1800, h: 640, start, dur, drange: 90 });
        console.log('wrote', path.join(dir, name + '.png'));
      }
    }
  } else {
    console.log('usage: node audio/music/score_a.mjs --solo [--eras 0,1] [--png] [--nocache]');
  }
}
