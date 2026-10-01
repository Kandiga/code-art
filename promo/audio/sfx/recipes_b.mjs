// =============================================================================
// audio/sfx/recipes_b.mjs - sound-effect recipes for every cue event with t >= 26.0
// (the eight JOBS, the futures 2050 / 2100 / 2150, the recap, the end card and the final hit).
// All synthesised in code, deterministic (seeded RNG, no Math.random / Date.now), 48 kHz stereo float32.
// Every recipe LAYERS transient + body + tail + texture and ends clean (no clicks).
//
//   export const recipes  = { id: (ev, ctx) => Buf | {buf, offsetSec, send} }   (contract: see index.mjs)
//   export const META     id -> one-line design notes (used by RECIPES.md)
//
// Level philosophy (same as recipes_a): each recipe is normalised to a deliberate peak (<= -3 dBFS, UI ticks and beds
// far lower) so the relative balance between events is designed here; the dispatcher only applies ev.g / ev.pan.
// Harmony: every pitched element is tuned to the film's key (A minor / C major) and to the chord of the current bar
// (cues.CHORDS): bar 13 C | 14 G | 15 Am | 16 F | 17 C | 18 G | 19 Am | 20 F | 21 C | 22 G | 23 Am | 24 F | 25 Am | 26 F | 27 C
// | 28 F->G (57.0) | 29 C. Multi-event ids (typewriter keys, panel snaps, timeline clicks, foot taps ...) vary pitch /
// velocity / timbre per key via runInfo(), which derives the position inside a rapid run from cues.SFX itself.
// =============================================================================
import * as dsp from '../lib/dsp.mjs';
import * as cues from '../../shared/cues.js';
import { kit } from './recipes_a.mjs';

const { SR, Buf, clamp } = dsp;
const TAU = Math.PI * 2;
const {
  S, Z, fromFn, glideExp, sweep, sine, nz, lp, hp, bp, edge, addTo, mulA, scaleA, env, perc, poisson, wide,
  put, verb, fin, hzNearPc, chordAt, sum, PCS, panSweep, widthEnv,
} = kit;
/** raised-cosine fade over the last `ms` ms of a mono array (in place): a source that is cut short never leaves a step */
const tailFade = (x, ms = 3) => {
  const m = Math.min(x.length, Math.round((ms * SR) / 1000));
  for (let i = 0; i < m; i++) x[x.length - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / m);
  return x;
};
const thump = (...a) => tailFade(kit.thump(...a));
const modal = (...a) => tailFade(kit.modal(...a));
const bellStrike = (...a) => tailFade(kit.bellStrike(...a));

// ---------------------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------------------
const CHORD_PCS = { C: [0, 4, 7], G: [7, 11, 2], Am: [9, 0, 4], F: [5, 9, 0] };
const chordPcs = (t) => CHORD_PCS[chordAt(t)] || CHORD_PCS.C;
const rootPc = (t) => PCS[chordAt(t)[0]];
/** ascending ladder (Hz) of the notes of a pitch-class set starting at or above `lowMidi` */
function ladderPcs(pcs, lowMidi, count) {
  const out = [];
  for (let m = lowMidi; out.length < count; m++) if (pcs.includes(((m % 12) + 12) % 12)) out.push(dsp.midiToHz(m));
  return out;
}
/** ascending chord-tone ladder at global time t */
const chordLadder = (t, lowMidi, count) => ladderPcs(chordPcs(t), lowMidi, count);
/** position of this event inside a rapid run of the same id (events <= gap seconds apart): {i, len} */
function runInfo(c, gap = 0.3) {
  const list = c.cues.SFX.filter((e) => e.id === c.id).map((e) => e.t).sort((a, b) => a - b);
  let i = list.findIndex((t) => Math.abs(t - c.t) < 1e-9);
  if (i < 0) i = 0;
  let a = i;
  while (a > 0 && list[a] - list[a - 1] <= gap + 1e-9) a--;
  let b = i;
  while (b < list.length - 1 && list[b + 1] - list[b] <= gap + 1e-9) b++;
  return { i: i - a, len: b - a + 1 };
}
const ss = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
/** sum a list of mono arrays of different lengths into one of length n */
const mixTo = (n, list) => { const o = Z(n); for (const [x, g = 1, t = 0] of list) addTo(o, x, t, g); return o; };
/** short filtered-noise burst: band centre f, Q, decay tau (s), length (s) */
const burst = (seed, len, f, q, tau, a = 0.0004, kind = 'hp') => {
  const n = S(len), x = nz(n, seed, 0.9);
  const y = kind === 'hp' ? hp(x, f) : kind === 'lp' ? lp(x, f) : bp(x, f, q);
  return mulA(y, perc(n, tau, a));
};
/** stereo field from a mono: pan sweep + decorrelation helper (L/R arrays) */
const lr = (L, R) => Buf.from(L, R);
/** keep everything below `hz` identical in L and R (sub / bass stays mono-safe; the dispatcher's pan acts on a centred low end) */
const bassMono = (buf, hz = 140) => dsp.widen(buf, 1, { bassMonoHz: hz });
/** gentle sine-fold-free saturation for mono arrays */
const sat = (x, drive = 2, mix = 1) => dsp.waveshape(x, 'tanh', drive, { mix, oversample: 1 });

// =============================================================================================================
// ACT II / JOBS  26 - 42
// =============================================================================================================

/** label downbeat tick: a tiny glossy glass "tick" tuned to the chord root of the bar, with a warm wooden tock body */
function label_tick(ev, c) {
  const k = Math.max(0, cues.JOBS.findIndex((j) => Math.abs(j.t0 - ev.t) < 1e-6));
  const f = hzNearPc(rootPc(ev.t), 1250);
  const n = S(0.42), m = Z(n);
  addTo(m, burst(c.seed('c'), 0.02, 3800, 1, 0.0007, 0.00008), 0, 0.5);
  addTo(m, modal(n, [[f, 1, 0.05], [f * 2.76, 0.32, 0.022], [f * 5.4, 0.12, 0.01]]), 0, 0.55);
  addTo(m, modal(S(0.1), [[f / 4, 0.7, 0.014], [(f / 4) * 2.3, 0.3, 0.008]]), 0, 0.5);
  addTo(m, mulA(bp(nz(S(0.04), c.seed('a'), 0.6), 7200, 1.2), env(S(0.04), [[0, 0], [0.002, 1], [0.03, 0]], 'smooth')), 0, 0.12);
  const out = verb(wide(m, 0.3, c.seed('w')), 'room', 0.16, 0.12);
  fin(out, { peak: -14, fadeOut: 0.08 }).scale(0.84 + 0.16 * (k / 7)); // the energy builds job by job
  return { buf: out, send: -26 };
}

/** one typed key in the air: key lever + type-bar slap + platen body + metal ping + escapement tick, plus a quiet pentatonic "glow" pip */
function typewriter_key(ev, c) {
  const { i } = runInfo(c, 0.2);
  const r = c.rng('k');
  const PM = [1.0, 0.86, 1.13, 0.78, 1.07, 0.92, 1.2, 0.84];
  const VEL = [0.92, 0.78, 0.96, 0.72, 0.88, 0.8, 1.0, 0.76];
  const pm = PM[i % 8] * (1 + (r() - 0.5) * 0.05), vel = VEL[i % 8] * (0.96 + 0.08 * r());
  const n = S(0.5), m = Z(n), t0 = 0.007;
  addTo(m, mulA(bp(nz(S(0.03), c.seed('lev'), 0.8), 2600, 1.2), perc(S(0.03), 0.0025, 0.0003)), 0, 0.3);
  addTo(m, burst(c.seed('cl'), 0.02, 2200, 1, 0.0011, 0.0001), t0, 0.9);
  addTo(m, burst(c.seed('sl'), 0.05, 1500 * pm, 1.1, 0.007, 0.0004, 'bp'), t0, 0.95);
  addTo(m, modal(S(0.15), [[205 * pm, 0.8, 0.022], [415 * pm, 0.55, 0.014], [830 * pm, 0.4, 0.009], [1710 * pm, 0.25, 0.006]]), t0, 0.45);
  addTo(m, modal(S(0.1), [[2650 * pm, 0.35, 0.01], [3980 * pm, 0.25, 0.006], [5700 * pm, 0.12, 0.004]]), t0, 0.5);
  addTo(m, thump(S(0.1), 130 * pm, 85 * pm, 0.012, 0.03), t0, 0.1);
  addTo(m, burst(c.seed('es'), 0.03, 3000, 1, 0.0014, 0.0001), t0 + 0.028, 0.26); // type bar rebounds / escapement
  addTo(m, modal(S(0.06), [[880 * pm, 0.3, 0.008]]), t0 + 0.03, 0.2);
  // the letter glows where it is typed: C-major pentatonic ladder E5 G5 A5 C6 D6 E6 G6 A6, quiet glass pip
  const pent = ladderPcs([0, 2, 4, 7, 9].map((x) => (rootPc(ev.t) + x) % 12), 76, 8); // pentatonic of the bar root (bar of C: E5 G5 A5 C6 D6 E6 G6 A6)
  addTo(m, edge(bellStrike(S(0.45), pent[i % 8], { tau: 0.2, kind: 'glass', amp: 1 }), 0.0004, 0.05), t0 + 0.002, 0.13);
  m.set(hp(m, 110));
  const out = verb(Buf.fromMono(m, (r() - 0.5) * 0.4), 'room', 0.13, 0.1);
  fin(out, { peak: -11, fadeOut: 0.12 }).scale(vel);
  return { buf: out, send: -24 };
}

/** carriage-return bell: hammer click + steel cup bell (two clappers, 1.7 Hz beating), faint carriage ratchet after it */
function typewriter_bell(ev, c) {
  const n = S(1.6), m = Z(n), f = 2093; // C7 (bar of C)
  addTo(m, burst(c.seed('h'), 0.012, 3500, 1, 0.0008, 0.0001), 0, 0.5);
  // small steel cup bell: near-harmonic fundamental + inharmonic upper partials, two clappers 1.7 Hz apart (beating)
  const bell = modal(n, [[f, 1, 0.42], [f * 1.0008 + 1.7, 0.6, 0.46], [f * 2.76, 0.5, 0.26], [f * 5.4, 0.34, 0.16], [f * 8.93, 0.18, 0.09], [f * 3.9, 0.22, 0.2], [f * 1.51, 0.2, 0.3]]);
  addTo(m, edge(bell, 0.0003, 0.12), 0, 0.7);
  addTo(m, modal(S(0.3), [[f / 2.0, 0.5, 0.09], [(f / 3.0) * 1.01, 0.3, 0.05]]), 0, 0.25); // cup body
  const r = c.rng('rat'); // carriage slides home: ratchet of tiny ticks
  for (let k = 0; k < 7; k++) addTo(m, burst(c.seed('rt' + k), 0.012, 2500 + 400 * k, 1, 0.0009, 0.0001), 0.05 + 0.011 * k + r() * 0.002, 0.1 + 0.02 * k);
  const out = verb(wide(m, 0.35, c.seed('w')), 'room', 0.22, 0.6);
  return { buf: fin(out, { peak: -10, fadeOut: 0.5 }), send: -22 };
}

/** paper folds: air-displacing slide, fibre crackle at each crease, final soft press */
function page_fold(ev, c) {
  const n = S(0.45), m = Z(n), r = c.rng('pf');
  const L = S(0.26);
  const slide = mulA(bp(nz(L, c.seed('s'), 0.9), sweep(L, 1400, 4200, 1), 0.9), env(L, [[0, 0], [0.07, 0.6], [0.16, 0.5], [0.26, 0]], 'smooth'));
  addTo(m, slide, 0, 1.0);
  addTo(m, mulA(bp(nz(L, c.seed('a'), 0.9), 1000, 0.6), env(L, [[0, 0], [0.1, 0.7], [0.26, 0]], 'smooth')), 0, 0.3);
  for (const [tc, a] of [[0.045, 0.7], [0.11, 0.9], [0.17, 0.7]]) { // three creases
    const nn = S(0.05);
    addTo(m, mulA(bp(poisson(nn, 2600, r, { tail: 2.2 }), 3600, 0.8), env(nn, [[0, 1], [0.05, 0]], 'lin')), tc, a * 0.9);
    addTo(m, mulA(hp(nz(nn, c.seed('cr' + tc), 0.8), 3500), perc(nn, 0.004, 0.0004)), tc, a * 0.25);
  }
  addTo(m, sum([modal(S(0.1), [[260, 0.6, 0.012], [520, 0.3, 0.008]]), burst(c.seed('pr'), 0.06, 1300, 0.9, 0.012, 0.0008, 'bp')]), 0.225, 0.55);
  m.set(hp(m, 140));
  const out = verb(wide(m, 0.55, c.seed('w')), 'room', 0.16, 0.15);
  return { buf: fin(out, { peak: -9, fadeIn: 0.004, fadeOut: 0.12 }), send: -26 };
}

/** the bound script snaps shut: stiff card slap + cavity thump + spine rattle + a tiny "locked" glint */
function page_snap(ev, c) {
  const n = S(0.9), m = Z(n), r = c.rng('ps');
  addTo(m, burst(c.seed('c'), 0.03, 1300, 1, 0.004, 0.0003), 0, 1.0);
  addTo(m, burst(c.seed('b'), 0.08, 1800, 0.8, 0.02, 0.0004, 'bp'), 0, 0.9);
  addTo(m, thump(S(0.25), 230, 150, 0.02, 0.04), 0, 0.3);
  addTo(m, modal(S(0.3), [[245, 0.5, 0.04], [490, 0.3, 0.03], [1130, 0.25, 0.014], [2100, 0.15, 0.01]]), 0, 0.3);
  const nn = S(0.14);
  addTo(m, mulA(bp(poisson(nn, 1800, r, { tail: 2.2 }), 3000, 0.7), env(nn, [[0, 1], [0.14, 0]], 'lin')), 0.02, 0.5);
  addTo(m, mulA(lp(nz(S(0.12), c.seed('p'), 0.8), 1500), env(S(0.12), [[0, 0], [0.01, 1], [0.1, 0]], 'smooth')), 0.0, 0.3);
  const gl = S(0.12);
  addTo(m, mulA(sine(sweep(gl, 2200, 6200, 1), gl), env(gl, [[0, 0], [0.01, 1], [0.12, 0]], 'smooth')), 0.045, 0.045);
  m.set(hp(m, 110));
  const out = verb(wide(m, 0.35, c.seed('w')), 'room', 0.2, 0.3);
  return { buf: fin(out, { peak: -7, fadeOut: 0.25 }), send: -24 };
}

/** storyboard panel snaps into the grid: card click + latch + wooden knock tuned to a G-major ladder (G B D G B D rising) */
function panel_snap(ev, c) {
  const { i } = runInfo(c, 0.2);
  const r = c.rng('pn');
  const f = chordLadder(ev.t, 67, 6)[Math.min(i, 5)]; // chord tones of the bar (bar of G: G4 B4 D5 G5 B5 D6)
  const vel = 0.8 + 0.2 * (Math.min(i, 5) / 5);
  const n = S(0.4), m = Z(n);
  addTo(m, burst(c.seed('c'), 0.02, 3000, 1, 0.0007, 0.00008), 0, 0.6);
  addTo(m, burst(c.seed('s'), 0.04, 2300, 1.5, 0.005, 0.0004, 'bp'), 0, 0.45);
  addTo(m, modal(S(0.25), [[f, 1, 0.032], [f * 2.4, 0.35, 0.016], [f * 4.1, 0.15, 0.008]]), 0, 0.6);
  addTo(m, thump(S(0.12), 160, 120, 0.01, 0.022), 0, 0.35);
  addTo(m, burst(c.seed('l'), 0.015, 4200, 1, 0.0009, 0.0001), 0.013, 0.22);
  addTo(m, edge(bellStrike(S(0.35), f * 2, { tau: 0.1, kind: 'glass', amp: 1 }), 0.0004, 0.04), 0.002, 0.16);
  const out = verb(Buf.fromMono(m, (r() - 0.5) * 0.3), 'room', 0.14, 0.12);
  fin(out, { peak: -12, fadeOut: 0.1 }).scale(vel);
  return { buf: out, send: -26 };
}

/** the six panels pop into 3D: rising air into the pop, pneumatic bloop + sub, six staggered extrusion "tuks" fanning L to R, widening depth whoosh */
function panel_pop_3d(ev, c) {
  const pre = 0.22, dur = pre + 1.1, n = S(dur), r = c.rng('pp');
  const L = Z(n), R = Z(n);
  const add2 = (x, t, g, pan = 0) => put({ L, R, length: n }, x, t, g, pan);
  const np = S(pre);
  const rise = mulA(bp(nz(np, c.seed('r'), 0.9), sweep(np, 450, 5200, 1.2), 0.9), fromFn(np, (t) => Math.pow(t / pre, 2.4)));
  add2(rise, 0, 0.5);
  add2(hp(rise, 2500), 0, 0.25, 0.3);
  const N = S(dur - pre);
  add2(thump(N, 190, 70, 0.03, 0.12), pre, 0.55);
  add2(thump(N, 880, 300, 0.02, 0.05), pre, 0.45);
  add2(thump(N, 98, 98, 1, 0.25, { a: 0.012 }), pre, 0.3); // G2 body (bar of G)
  add2(burst(c.seed('ck'), 0.02, 2000, 1, 0.002, 0.0002), pre, 0.5);
  add2(modal(S(0.4), [[392, 0.5, 0.12], [588, 0.3, 0.09], [784, 0.25, 0.07]]), pre, 0.22);
  for (let k = 0; k < 6; k++) { // six extruding panels
    const f = 500 * Math.pow(2, k / 6 * 1.0 + (r() - 0.5) * 0.06);
    const bub = mulA(sine(glideExp(S(0.1), f * 1.5, f, 0.015), S(0.1)), perc(S(0.1), 0.03, 0.001));
    add2(sum([bub, burst(c.seed('tk' + k), 0.012, 3000, 1, 0.0009, 0.0001)]), pre + 0.025 + 0.022 * k, 0.32, -0.8 + 0.32 * k);
  }
  const W = S(0.8);
  const wL = mulA(bp(nz(W, c.seed('wl'), 0.9), sweep(W, 700, 2800, 0.8), 0.8), env(W, [[0, 0], [0.1, 1], [0.3, 0.5], [0.8, 0]], 'smooth'));
  const wR = mulA(bp(nz(W, c.seed('wr'), 0.9), sweep(W, 760, 3000, 0.8), 0.8), env(W, [[0, 0], [0.1, 1], [0.3, 0.5], [0.8, 0]], 'smooth'));
  for (let i = 0; i < W; i++) { const k = pre * SR + i; if (k < n) { L[k] += wL[i] * 0.3; R[k] += wR[i] * 0.3; } }
  const b = lr(L, R);
  const out = verb(b, 'plate', 0.22, 0.5);
  return { buf: fin(out, { peak: -6, fadeOut: 0.5 }), offsetSec: pre, send: -24 };
}

/** crane servo: a clear whine gliding A4 -> E5 and back with the arm speed (stepper AM), A2 motor hum, gear whirr, hydraulic hiss, unlock click and brake clunk; the arm travels L to R */
function crane_servo(ev, c) {
  const dur = ev.dur ?? 1.0, tail = 0.4, n = S(dur + tail);
  const at = (arr, t) => arr[Math.min(n - 1, Math.round(t * SR))];
  const prof = fromFn(n, (t) => (t < dur ? Math.pow(Math.sin(Math.PI * (t / dur)), 0.8) : 0));
  const vib = dsp.drift(n, 7, 1, c.seed('d'));
  const fw = fromFn(n, (t) => 440 * (1 + 0.5 * at(prof, t)) * (1 + 0.003 * vib[Math.min(n - 1, Math.round(t * SR))]));
  const step = fromFn(n, (t) => 1 - 0.3 * (0.5 + 0.5 * Math.sin(TAU * (95 + 80 * at(prof, t)) * t)));
  const whine = mulA(sum([sine(fw, n), scaleA(sine(scaleA(fw, 2), n), 0.35), scaleA(sine(scaleA(fw, 3), n), 0.14)]), step);
  const hum = lp(dsp.osc('saw', fromFn(n, (t) => 110 * (1 + 0.5 * at(prof, t))), n), 700);
  const whirr = mulA(bp(nz(n, c.seed('wh'), 0.9), 700, 2), fromFn(n, (t) => 0.5 + 0.5 * Math.sin(TAU * (28 + 30 * at(prof, t)) * t)));
  const hiss = mulA(hp(nz(n, c.seed('hs'), 0.8), 2500), fromFn(n, (t) => 0.4 * at(prof, t) + 0.6 * ss(dur - 0.25, dur + 0.05, t) * (1 - ss(dur + 0.05, dur + 0.3, t))));
  const gate = fromFn(n, (t) => (t < dur + 0.05 ? ss(0, 0.07, t) : Math.max(0, 1 - (t - dur - 0.05) / 0.04)));
  const motor = mulA(mixTo(n, [[whine, 0.5], [hum, 0.35], [whirr, 0.4]]), gate);
  const m = mixTo(n, [[motor, 1], [hiss, 0.16]]);
  addTo(m, sum([burst(c.seed('u1'), 0.02, 1800, 1, 0.0015, 0.0002), thump(S(0.1), 140, 95, 0.012, 0.03), modal(S(0.12), [[540, 0.4, 0.015], [1320, 0.3, 0.008]])]), 0, 0.8); // unlock
  addTo(m, sum([thump(S(0.25), 100, 58, 0.02, 0.07), modal(S(0.2), [[190, 0.5, 0.04], [420, 0.35, 0.03], [980, 0.2, 0.015]]), burst(c.seed('br'), 0.03, 1500, 1, 0.003, 0.0003)]), dur + 0.02, 0.85); // brake clunk
  const pan = fromFn(n, (t) => -0.55 + 1.1 * ss(0, dur + 0.1, t));
  const w = widthEnv(panSweep(m, pan), 0.9);
  return { buf: fin(verb(w, 'room', 0.18, 0.0), { peak: -10, fadeIn: 0.001, fadeOut: 0.15 }), send: -26 };
}

/** quadcopter fly-by: four detuned rotors (beating) with Doppler pitch fall, blade flutter, electric whine, wind; pans L to R and settles to a hover */
function drone_buzz(ev, c) {
  const dur = ev.dur ?? 1.0, n = S(dur + 0.35), r = c.rng('db');
  const x01 = fromFn(n, (t) => ss(0, dur * 0.95, t));
  const dop = fromFn(n, (t) => 1.05 - 0.1 * x01[Math.min(n - 1, Math.round(t * SR))]); // approaching sharp, receding flat
  const amp = fromFn(n, (t) => 0.22 + 0.78 * Math.exp(-Math.pow((t - 0.45 * dur) / (0.3 * dur), 2)) + 0.0 * t);
  const hover = fromFn(n, (t) => 0.2 * ss(dur * 0.5, dur + 0.1, t));
  const rotors = [217, 221.6, 329.6, 331.4]; // two rotor pairs near A3 and E4 -> a faint open fifth with beating
  const m = Z(n);
  rotors.forEach((f, k) => {
    const fd = fromFn(n, (t) => f * dop[Math.min(n - 1, Math.round(t * SR))] * (1 + 0.003 * Math.sin(TAU * (9 + 2 * k) * t + k)));
    const saw = dsp.osc('saw', fd, n, { phase: r() });
    const x = lp(saw, 1700 + 300 * k);
    const chop = dsp.lfo('sine', 70 + 13 * k, n, { min: 0.55, max: 1, phase: r() });
    addTo(m, mulA(x, chop), 0, 0.35);
  });
  const whine = sine(fromFn(n, (t) => 2420 * dop[Math.min(n - 1, Math.round(t * SR))]), n);
  addTo(m, mulA(whine, fromFn(n, (t) => 0.05 * amp[Math.min(n - 1, Math.round(t * SR))])), 0, 1);
  addTo(m, mulA(bp(nz(n, c.seed('w'), 0.9), sweep(n, 1500, 900, 1), 0.7), fromFn(n, (t) => 0.2 * amp[Math.min(n - 1, Math.round(t * SR))])), 0, 1);
  const flut = dsp.lfo('sine', 11, n, { min: 0.8, max: 1 });
  const g = fromFn(n, (t) => (amp[Math.min(n - 1, Math.round(t * SR))] + hover[Math.min(n - 1, Math.round(t * SR))]) * ss(0, 0.05, t) * (1 - ss(dur + 0.1, dur + 0.35, t)));
  const mm = mulA(mulA(m, g), flut);
  const pan = fromFn(n, (t) => -0.85 + 1.5 * ss(0, dur * 0.9, t));
  const b = panSweep(mm, pan);
  return { buf: fin(verb(b, 'room', 0.15, 0), { peak: -10, fadeIn: 0.02, fadeOut: 0.2 }), send: -26 };
}

/** viewfinder powers on: relay tick, four corner brackets ticking in (L R L R), power-up chirp, rec-dot blip (A6) and faint EVF whine */
function viewfinder_on(ev, c) {
  const n = S(0.9), L = Z(n), R = Z(n);
  const B = { L, R, length: n };
  put(B, sum([burst(c.seed('rl'), 0.02, 2000, 1, 0.0012, 0.0002), thump(S(0.08), 150, 95, 0.012, 0.025)]), 0, 0.6, 0);
  const corners = [2200, 2700, 3300, 4000];
  corners.forEach((f, k) => {
    const x = sum([modal(S(0.1), [[f, 1, 0.012], [f * 2.4, 0.3, 0.006]]), burst(c.seed('co' + k), 0.01, 4500, 1, 0.0007, 0.0001)]);
    put(B, x, 0.012 + 0.035 * k, 0.5, k % 2 ? 0.8 : -0.8);
  });
  const cl = S(0.14);
  put(B, mulA(sine(sweep(cl, 500, 3000, 1.1), cl), env(cl, [[0, 0], [0.01, 1], [0.1, 0.4], [0.14, 0]], 'smooth')), 0.02, 0.16, 0);
  const blip = mulA(sum([sine(1760, S(0.14)), scaleA(sine(3520, S(0.14)), 0.18)]), env(S(0.14), [[0, 0], [0.003, 1], [0.09, 0.8], [0.14, 0]], 'smooth'));
  put(B, blip, 0.2, 0.32, 0.0);
  put(B, mulA(sine(7800, n), env(n, [[0, 0], [0.05, 1], [0.35, 0.3], [0.9, 0]], 'smooth')), 0, 0.012, 0);
  return { buf: fin(verb(Buf.from(L, R), 'room', 0.16, 0.2), { peak: -10, fadeOut: 0.3 }), send: -26 };
}

/** autofocus lock: lens-motor zip, then a clean two-note confirm beep (E6 -> A6, chord tones of Am) with a glass ring */
function focus_beep(ev, c) {
  const n = S(0.7), m = Z(n);
  const zl = S(0.07);
  addTo(m, mulA(bp(nz(zl, c.seed('z'), 0.9), sweep(zl, 3200, 1200, 1), 1.6), env(zl, [[0, 0], [0.01, 1], [0.05, 0.8], [0.07, 0]], 'smooth')), 0, 0.22);
  const tone = (f, len) => {
    const nn = S(len);
    const x = sum([sine(f, nn), scaleA(sine(f * 3, nn), 0.2), scaleA(sine(f * 5, nn), 0.06)]);
    return mulA(x, env(nn, [[0, 0], [0.002, 1], [len - 0.01, 0.9], [len, 0]], 'smooth'));
  };
  addTo(m, tone(1318.5, 0.055), 0.07, 0.6);
  addTo(m, tone(1760, 0.075), 0.15, 0.6);
  addTo(m, edge(bellStrike(S(0.5), 1760, { tau: 0.12, kind: 'glass', amp: 1 }), 0.001, 0.05), 0.15, 0.1);
  addTo(m, burst(c.seed('lk'), 0.01, 3500, 1, 0.0008, 0.0001), 0.15, 0.2);
  const out = verb(wide(m, 0.25, c.seed('w')), 'room', 0.2, 0.3);
  return { buf: fin(out, { peak: -12, fadeOut: 0.2 }), send: -26 };
}

/** she paints with light: bristle-swish noise arcing across the frame, glowing F-major shimmer partials, trailing celesta sparkles */
function brush_light(ev, c) {
  const dur = ev.dur ?? 0.5, tail = 0.7, n = S(dur + tail), r = c.rng('bl');
  const bell = fromFn(n, (t) => Math.pow(Math.sin(Math.PI * clamp(t / dur, 0, 1)), 1.4) * (t < dur ? 1 : 0));
  const sw = mulA(bp(nz(n, c.seed('s'), 0.9), sweep(n, 900, 5200, 0.9), 0.9), bell);
  const bristle = mulA(hp(nz(n, c.seed('b'), 0.9), 3500), mulA(bell, fromFn(n, (t) => 0.55 + 0.45 * Math.sin(TAU * 140 * t + 8 * Math.sin(TAU * 11 * t)))));
  const glowEnv = fromFn(n, (t) => (t < dur * 0.7 ? Math.pow(t / (dur * 0.7), 1.6) : Math.exp(-(t - dur * 0.7) / 0.28)));
  const glow = Z(n);
  [698.46, 880, 1046.5, 1396.9, 1760, 2093].forEach((f, k) => {
    const x = sum([sine(f * 0.9985, n, r()), sine(f * 1.0015, n, r())]);
    addTo(glow, mulA(x, mulA(glowEnv, dsp.lfo('sine', 5 + k, n, { min: 0.6, max: 1, phase: r() }))), 0, 0.5 / Math.pow(1 + k, 0.4));
  });
  const m = mixTo(n, [[sw, 0.55], [bristle, 0.14], [glow, 0.22]]);
  const ladder = chordLadder(ev.t, 84, 7); // bar of F: F6 A6 C7 ...
  ladder.forEach((f, k) => addTo(m, edge(bellStrike(S(0.5), f, { tau: 0.18, kind: 'celesta', amp: 1 }), 0.0004, 0.05), dur * 0.35 + k * 0.07 + r() * 0.01, 0.06 + 0.01 * k));
  const pan = fromFn(n, (t) => -0.7 + 1.4 * ss(0, dur, t));
  const b = panSweep(m, pan);
  return { buf: fin(verb(b, 'plate', 0.3, 0.5), { peak: -10, fadeIn: 0.006, fadeOut: 0.4 }), send: -22 };
}

/**
 * KEY / FILL / RIM stage-light switch: heavy contactor clunk + relay chatter + filament "foom" + arc/filament buzz + glass-tube ring-out.
 * key = heaviest and lowest (F), fill = softer (A), rim = bright and crisp (C): together the three ring out an F major triad.
 */
const LIGHTS = {
  key: { peak: -6, thump: [70, 52, 0.05, 0.14], thumpG: 0.75, body: [[150, 0.7, 0.07], [330, 0.5, 0.05], [780, 0.35, 0.03], [1650, 0.25, 0.015]], steel: 1.0, ring: 349.23, ringTau: 1.4, buzz: 87.31, buzzTau: 0.5, buzzG: 0.12, foomLp: 500, chatter: 3, gap: 0.03 },
  fill: { peak: -8, thump: [100, 78, 0.04, 0.09], thumpG: 0.6, body: [[240, 0.6, 0.05], [560, 0.5, 0.035], [1250, 0.35, 0.02], [2600, 0.2, 0.01]], steel: 0.85, ring: 440, ringTau: 1.2, buzz: 110, buzzTau: 0.42, buzzG: 0.1, foomLp: 700, chatter: 2, gap: 0.024 },
  rim: { peak: -8.5, thump: [150, 115, 0.03, 0.06], thumpG: 0.4, body: [[420, 0.6, 0.04], [980, 0.5, 0.03], [2100, 0.4, 0.016], [4300, 0.25, 0.008]], steel: 0.75, ring: 1046.5, ringTau: 1.0, buzz: 130.81, buzzTau: 0.34, buzzG: 0.09, foomLp: 1100, chatter: 2, gap: 0.018, zing: true },
};
function light_clunk(ev, c) {
  const P = LIGHTS[ev.id2] || LIGHTS.key, id = LIGHTS[ev.id2] ? ev.id2 : 'key';
  const r = c.rng('lc'), dur = 2.0, n = S(dur), m = Z(n);
  // 1. the heavy switch: thump + steel body + latch crack
  addTo(m, thump(S(0.5), P.thump[0], P.thump[1], P.thump[2], P.thump[3]), 0, P.thumpG);
  addTo(m, modal(S(0.5), P.body), 0, 0.55 * P.steel);
  addTo(m, burst(c.seed('ck'), 0.04, 1500, 1, 0.0025, 0.0002), 0, 0.55 * P.steel);
  // 2. second throw: the contactor seats, then the relay chatters
  addTo(m, sum([thump(S(0.2), P.thump[0] * 1.5, P.thump[1] * 1.3, 0.012, 0.04), modal(S(0.15), P.body.map(([f, a, t]) => [f * 1.35, a, t * 0.7])), burst(c.seed('c2'), 0.02, 2400, 1, 0.0014, 0.0001)]), P.gap, 0.6);
  for (let k = 0; k < P.chatter; k++) addTo(m, sum([burst(c.seed('rl' + k), 0.012, 3200 + 600 * k, 1, 0.0009, 0.0001), modal(S(0.04), [[1900 + 300 * k, 0.4, 0.005]])]), P.gap + 0.016 + 0.009 * k + r() * 0.003, 0.28 - 0.06 * k);
  if (P.zing) addTo(m, mulA(bp(nz(S(0.08), c.seed('zg'), 0.9), sweep(S(0.08), 7500, 3000, 1), 3), env(S(0.08), [[0, 0], [0.004, 1], [0.08, 0]], 'smooth')), 0.006, 0.28);
  // 3. filament "foom" + arc buzz on the chord tone (tuned so key/fill/rim stack into F A C)
  const foom = mulA(lp(nz(n, c.seed('fo'), 0.9), P.foomLp), env(n, [[0, 0], [0.03, 0], [0.09, 1], [0.25, 0.5], [0.9, 0]], 'smooth'));
  addTo(m, foom, 0, 0.42);
  const jit = dsp.drift(n, 14, 1, c.seed('j'));
  const fb = fromFn(n, (t) => P.buzz * (1 + 0.004 * jit[Math.min(n - 1, Math.round(t * SR))]));
  const saw = lp(dsp.osc('saw', fb, n), 1500);
  const flick = fromFn(n, (t) => 1 - 0.35 * Math.max(0, Math.sin(TAU * 37 * t + 3 * Math.sin(TAU * 5.3 * t))) * Math.exp(-t / 0.4));
  addTo(m, mulA(mulA(saw, flick), env(n, [[0, 0], [0.05, 0], [0.14, 1], [P.buzzTau, 0.3], [P.buzzTau * 2.4, 0]], 'smooth')), 0, P.buzzG * 3.2);
  addTo(m, mulA(hp(poisson(n, fromFn(n, (t) => 700 * Math.exp(-t / 0.2)), r, { tail: 2.5 }), 2500), env(n, [[0.03, 0], [0.06, 1], [0.6, 0]], 'smooth')), 0, 0.2);
  // 4. glass-tube ring-out on the light's chord tone (beating pairs)
  const f = P.ring;
  addTo(m, edge(modal(n, [[f, 1, P.ringTau], [f * 1.0035, 0.7, P.ringTau * 0.9], [f * 2.756, 0.28, P.ringTau * 0.5], [f * 2.76 * 1.002, 0.2, P.ringTau * 0.45], [f * 5.404, 0.1, P.ringTau * 0.3]]), 0.0004, 0.4), 0.004, id === 'key' ? 0.22 : 0.2);
  const out = verb(wide(m, 0.4, c.seed('w')), 'hall', 0.2, 0.0);
  return { buf: fin(out, { peak: P.peak, fadeOut: 0.5 }), send: -26 };
}

/** five icon characters step onto their marks: rubber pat + hollow stage knock (pitch by character size) + a quiet marimba "mark" tone (C6 pentatonic) + cartoon blip */
function foot_tap(ev, c) {
  const { i } = runInfo(c, 0.3);
  const K = Math.min(i, 4), r = c.rng('ft');
  const F0 = [112, 190, 146, 128, 172][K] * (1 + (r() - 0.5) * 0.03);
  const VEL = [1.0, 0.72, 0.86, 0.94, 0.78][K];
  const f = ladderPcs([0, 4, 7, 9], 60, 5)[K]; // C4 E4 G4 A4 C5 (bar of C)
  const n = S(0.55), m = Z(n);
  addTo(m, thump(S(0.2), F0 * 1.45, F0, 0.012, 0.035), 0, 0.4);
  addTo(m, modal(S(0.1), [[F0 * 6.2, 0.6, 0.009], [F0 * 11.5, 0.35, 0.006]]), 0.0, 0.5); // hard sole / stage tick
  addTo(m, burst(c.seed('pat'), 0.05, 1700, 0.9, 0.007, 0.0005, 'bp'), 0, 0.8);
  addTo(m, modal(S(0.25), [[F0 * 2.05, 0.6, 0.03], [F0 * 3.4, 0.45, 0.02], [F0 * 5.6, 0.25, 0.012], [F0 * 9.1, 0.12, 0.008]]), 0, 0.7);
  addTo(m, modal(S(0.45), [[f, 1, 0.1], [f * 3.95, 0.12, 0.03]]), 0.002, 0.24);
  const bl = S(0.07);
  addTo(m, mulA(sine(sweep(bl, f * 2, f * 3.2, 1), bl), env(bl, [[0, 0], [0.004, 1], [0.07, 0]], 'smooth')), 0.012, 0.07);
  addTo(m, burst(c.seed('tape'), 0.012, 4200, 1, 0.0008, 0.0001), 0.014, 0.18);
  m.set(hp(m, 70));
  const out = verb(Buf.fromMono(m, (r() - 0.5) * 0.3), 'room', 0.16, 0.2);
  fin(out, { peak: -11, fadeOut: 0.15 }).scale(VEL);
  return { buf: out, send: -24 };
}

/** the cast is ready: reversed glass glint into a quick harp-like strum of a C major bell chord, warm locked-in pad, glitter and a soft hall bloom */
function cast_ready(ev, c) {
  const pre = 0.16, dur = pre + 2.4, r = c.rng('cr');
  const B = new Buf(dur);
  const gl = dsp.reverse(edge(bellStrike(S(pre), 1568, { tau: 0.05, kind: 'glass', amp: 1 }), 0.0004, 0.002));
  put(B, gl, 0, 0.3, 0);
  put(B, mulA(hp(nz(S(pre), c.seed('ai'), 0.8), 4500), fromFn(S(pre), (t) => 0.1 * Math.pow(t / pre, 2.2))), 0, 1, 0);
  const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568];
  notes.forEach((f, k) => {
    const x = sum([bellStrike(S(2.2), f, { tau: 0.8 - 0.07 * k, kind: 'bell', amp: 0.9 }), scaleA(bellStrike(S(1.5), f * 2, { tau: 0.4, kind: 'glass', amp: 0.4 }), 0.4)]);
    put(B, edge(x, 0.0004, 0.2), pre + 0.028 * k + r() * 0.003, 0.5 - 0.03 * k, -0.5 + k * 0.2);
  });
  const nn = S(2.0);
  [130.81, 196, 261.63, 329.63].forEach((f, k) => put(B, mulA(sum([sine(f * 0.9992, nn), sine(f * 1.0008, nn)]), env(nn, [[0, 0], [0.05, 1], [0.5, 0.5], [2.0, 0]], 'smooth')), pre, 0.08 / (1 + 0.2 * k), (k % 2 ? 1 : -1) * 0.25));
  put(B, thump(S(1.0), 70, 55, 0.2, 0.2, { a: 0.01 }), pre, 0.2, 0);
  const gn = S(1.2);
  put(B, wide(hp(bp(poisson(gn, fromFn(gn, (t) => 160 * Math.exp(-t / 0.4)), r, { tail: 2 }), 8000, 1), 5000), 1, c.seed('gw')), pre, 0.4, 0);
  return { buf: fin(verb(B, 'hall', 0.32, 0.0), { peak: -10, fadeOut: 0.6 }), offsetSec: pre, send: -22 };
}

/**
 * Orchestra tuning swell on A440 (36.0 -> 37.0): oboe, clarinets, flutes, 9 violins, violas, cellos, basses, horns, trumpets and tuba, every player
 * entering one after the other, a few cents flat and settling in (beating) while the whole section crescendos; released 35 ms before the baton
 * falls on 37.0 so the orchestra hit lands clean. Tonal and physical throughout: no noise bed (only a faint bow-hair texture).
 */
function orch_tune(ev, c) {
  const dur = ev.dur ?? 1.0, tail = 1.3, n = S(dur + tail), r = c.rng('ot');
  const relT = dur - 0.035;
  const at = (arr, t) => arr[Math.min(n - 1, Math.round(t * SR))];
  const cres = fromFn(n, (t) => 0.05 + 0.95 * Math.pow(clamp(t / relT, 0, 1), 1.6));
  const rel = fromFn(n, (t) => (t < relT ? 1 : Math.max(0, 0.5 + 0.5 * Math.cos(Math.PI * clamp((t - relT) / 0.035, 0, 1)))));
  const L = Z(n), R = Z(n), B = { L, R, length: n };
  const voice = (kind, hz, ent, { g = 1, pan = 0, cents = 0, vib = 5.5, vd = 8, att = 0.07, brightRange = null } = {}) => {
    const flat = (4 + 16 * r()) * (1 - 0.65 * (ent / dur)) * (r() < 0.6 ? -1 : 1); // players tune in from slightly off pitch (later entrants listen and arrive nearer)
    const vph = r() * TAU, vr = vib * (0.92 + 0.16 * r());
    const fc = fromFn(n, (t) => {
      const d = Math.max(0, t - ent);
      const v = vd * Math.min(1, d / 0.3) * Math.sin(TAU * vr * t + vph);
      return hz * Math.pow(2, (cents + flat * Math.exp(-d / 0.11) + v) / 1200);
    });
    let x;
    if (kind === 'oboe') x = dsp.additive(fc, n, [[1, 0.45], [2, 1], [3, 0.8], [4, 0.5], [5, 0.5], [6, 0.3], [7, 0.2], [8, 0.12]]);
    else if (kind === 'clar') x = dsp.additive(fc, n, [[1, 1], [3, 0.45], [5, 0.25], [7, 0.12], [9, 0.06]]);
    else if (kind === 'flute') x = dsp.additive(fc, n, [[1, 1], [2, 0.14], [3, 0.05]]);
    else if (kind === 'str') x = lp(dsp.osc('saw', fc, n, { phase: r() }), brightRange ? 2600 : 3000);
    else if (kind === 'low') x = lp(dsp.osc('saw', fc, n, { phase: r() }), brightRange || 900);
    else if (kind === 'horn') x = dsp.svf(dsp.osc('saw', fc, n, { phase: r() }), 'lp', fromFn(n, (t) => 700 + 1700 * at(cres, t)), 0.9);
    else if (kind === 'tpt') x = dsp.svf(dsp.osc('pulse', fc, n, { phase: r(), width: 0.32 }), 'lp', fromFn(n, (t) => 1500 + 3800 * at(cres, t)), 0.9);
    else x = dsp.svf(dsp.osc('saw', fc, n, { phase: r() }), 'lp', fromFn(n, (t) => 450 + 700 * at(cres, t)), 0.8);
    const e = fromFn(n, (t) => (t < ent ? 0 : Math.pow(Math.min(1, (t - ent) / att), 1.5)));
    const y = mulA(mulA(x, e), mulA(cres, rel));
    put(B, y, 0, g * 0.16, pan);
  };
  // winds: the oboe gives the A, the clarinets and flutes follow
  voice('oboe', 440, 0.0, { g: 1.1, pan: 0.1, vd: 5, vib: 5.2, att: 0.05 });
  voice('clar', 440, 0.1, { g: 0.7, pan: -0.15, vd: 4 });
  voice('clar', 220, 0.14, { g: 0.55, pan: 0.2, vd: 4 });
  voice('flute', 880, 0.22, { g: 0.55, pan: 0.28, vd: 6, vib: 5.8 });
  voice('flute', 880, 0.26, { g: 0.45, pan: -0.1, vd: 6, vib: 5.4, cents: 6 });
  // violins I (4) and II (3), violas, cellos, basses
  [[-6, 0.05, -0.8], [-2, 0.12, -0.62], [3, 0.2, -0.48], [5, 0.3, -0.35]].forEach(([ct, e, p], k) => voice('str', 440, e, { g: 0.55, pan: p, cents: ct, vib: 5.3 + 0.35 * k, vd: 9 }));
  [[-4, 0.18, -0.25], [3, 0.28, -0.12]].forEach(([ct, e, p], k) => voice('str', 440, e, { g: 0.5, pan: p, cents: ct, vib: 5.6 + 0.4 * k, vd: 9 }));
  voice('str', 880, 0.34, { g: 0.32, pan: -0.55, cents: 3, vd: 10, brightRange: 1 });
  [[-4, 0.3, 0.08], [4, 0.4, 0.2]].forEach(([ct, e, p], k) => voice('str', 220, e, { g: 0.6, pan: p, cents: ct, vib: 5 + 0.3 * k, vd: 7 }));
  [[-3, 0.35, 0.42], [4, 0.48, 0.55]].forEach(([ct, e, p], k) => voice('low', 110, e, { g: 0.75, pan: p, cents: ct, vib: 4.8 + 0.3 * k, vd: 6, brightRange: 1000 }));
  voice('low', 220, 0.4, { g: 0.5, pan: 0.35, cents: 2, vd: 6, brightRange: 1200 });
  voice('low', 55, 0.5, { g: 0.75, pan: 0.72, vd: 4, brightRange: 420 });
  voice('low', 110, 0.52, { g: 0.55, pan: 0.65, cents: -4, vd: 4, brightRange: 500 });
  // brass: horns, trumpets, tuba come in last and open up with the swell
  voice('horn', 220, 0.55, { g: 0.7, pan: 0.45, vd: 4, att: 0.1 });
  voice('horn', 220, 0.58, { g: 0.6, pan: 0.55, cents: 5, vd: 4, att: 0.1 });
  voice('tpt', 440, 0.66, { g: 0.45, pan: 0.6, vd: 3, att: 0.08 });
  voice('tpt', 440, 0.7, { g: 0.4, pan: 0.7, cents: 3, vd: 3, att: 0.08 });
  voice('tuba', 110, 0.62, { g: 0.55, pan: 0.78, vd: 3, att: 0.12 });
  // bow-hair / reed texture only where the players speak (tiny)
  const bn = mulA(bp(nz(n, c.seed('bow'), 0.9), 3000, 1.0), mulA(cres, rel));
  put(B, bn, 0, 0.012, -0.3);
  put(B, wide(bn, 1, c.seed('bw')), 0, 0.01, 0.2);
  const w = Buf.from(L, R);
  return { buf: fin(bassMono(verb(w, 'hall', 0.34, 0.0), 110), { peak: -9, fadeOut: 0.9 }), send: -22 };
}

/**
 * baton: a fast down-stroke swish (band noise sweeping 8 -> 3 kHz) ending at a dry wood "tick" on the ictus, then a descending cascade of glass ribbons of light.
 * 37.0 (baton down, orchestra hit) is the big one with a low thwap; the 44.0-45.5 events (neural ribbons) climb in pitch.
 */
function baton_whoosh(ev, c) {
  const main = c.cues.HITS.some((h) => h.s === 'L' && Math.abs(h.t - ev.t) < 0.02), { i } = main ? { i: 0 } : runInfo(c, 0.7); // the baton-down on the L hit (37.0) vs the ribbon ictus events
  const pre = main ? 0.16 : 0.1, dur = pre + (main ? 1.3 : 1.0), r = c.rng('bw');
  const B = new Buf(dur);
  const ns = S(0.1), pw = pre - 0.1;
  const sc = 1 + 0.07 * i;
  const stroke = mulA(bp(nz(ns, c.seed('sw'), 0.9), sweep(ns, 8200 * sc, 2800 * sc, 1.1), 1.5), env(ns, [[0, 0], [0.088, 1], [0.097, 0.2], [0.1, 0]], 'smooth'));
  put(B, scaleA(stroke, 1), Math.max(0, pw), 0.6, -0.3);
  put(B, hp(mulA(nz(ns, c.seed('sz'), 0.9), fromFn(ns, (t) => Math.pow(t / 0.1, 3))), 6000), Math.max(0, pw), 0.25, 0.3);
  put(B, mulA(hp(nz(S(pre), c.seed('up'), 0.8), 3000), fromFn(S(pre), (t) => (main ? 0.08 : 0.04) * Math.pow(t / pre, 2))), 0, 1, 0); // arm raising
  const tick = sum([modal(S(0.1), [[1900, 1, 0.008], [3400, 0.4, 0.004], [880, 0.5, 0.012]]), burst(c.seed('tk'), 0.02, 3000, 1, 0.0012, 0.0001)]);
  put(B, tick, pre, 1.1, 0);
  put(B, thump(S(0.3), 140, 80, 0.02, main ? 0.07 : 0.03), pre, main ? 0.5 : 0.2, 0);
  const ribbons = chordLadder(ev.t, main ? 79 : 79 + 2 * i, 6).reverse();
  ribbons.forEach((f, k) => {
    const x = edge(bellStrike(S(1.1), f, { tau: 0.3, kind: 'glass', amp: 1 }), 0.0004, 0.12);
    put(B, x, pre + 0.012 + 0.042 * k + r() * 0.004, (main ? 0.17 : 0.24) * Math.pow(0.82, k), 0.7 - 0.28 * k);
  });
  return { buf: fin(verb(B, main ? 'hall' : 'plate', main ? 0.2 : 0.3, 0.0), { peak: -6, fadeOut: 0.5 }), offsetSec: pre, send: -22 };
}

/** the timeline panel slides in: friction swish + a soft digital glide A4 -> A5 + the panel seating "tok" with rail ticks */
function timeline_slide(ev, c) {
  const dur = ev.dur ?? 0.25, n = S(dur + 0.4), m = Z(n);
  const sn = S(dur);
  addTo(m, mulA(bp(nz(sn, c.seed('s'), 0.9), sweep(sn, 2600, 900, 1), 0.9), env(sn, [[0, 0], [0.04, 1], [dur * 0.7, 0.6], [dur, 0]], 'smooth')), 0, 0.95);
  addTo(m, mulA(sum([sine(sweep(sn, 440, 880, 1), sn), scaleA(sine(sweep(sn, 880, 1760, 1), sn), 0.2)]), env(sn, [[0, 0], [0.05, 1], [dur * 0.8, 0.5], [dur, 0]], 'smooth')), 0, 0.1);
  const t1 = dur - 0.012;
  addTo(m, sum([thump(S(0.25), 150, 105, 0.02, 0.04), modal(S(0.2), [[310, 0.5, 0.03], [700, 0.4, 0.02], [1480, 0.3, 0.01]]), burst(c.seed('t'), 0.02, 3000, 1, 0.0012, 0.0002)]), t1, 0.5);
  for (let k = 0; k < 2; k++) addTo(m, burst(c.seed('rt' + k), 0.01, 3600, 1, 0.0008, 0.0001), t1 + 0.02 + 0.016 * k, 0.15);
  m.set(hp(m, 90));
  const out = verb(wide(m, 0.5, c.seed('w')), 'room', 0.2, 0.25);
  return { buf: fin(out, { peak: -9, fadeOut: 0.2 }), send: -24 };
}

/** a shot snaps onto the timeline: tiny slide zip into a crisp click + woody knock tuned to an Am ladder (A C E A C E rising) + glass pip */
function timeline_click(ev, c) {
  const { i, len } = runInfo(c, 0.3), r = c.rng('tc');
  const idx = len > 1 ? Math.min(i, 5) : 3;
  const f = chordLadder(ev.t, 69, 7)[idx];
  const vel = len > 1 ? 0.8 + 0.2 * (i / Math.max(1, len - 1)) : 0.9;
  const pre = 0.03, n = S(0.45 + pre), m = Z(n);
  const zl = S(pre);
  addTo(m, mulA(bp(nz(zl, c.seed('z'), 0.9), sweep(zl, 1500, 4200, 1), 1.2), env(zl, [[0, 0], [0.012, 1], [pre, 0.3]], 'smooth')), 0, 0.22);
  addTo(m, burst(c.seed('c'), 0.02, 3000, 1, 0.0007, 0.00008), pre, 0.7);
  addTo(m, modal(S(0.3), [[f, 1, 0.03], [f * 2.3, 0.35, 0.014], [f * 3.9, 0.15, 0.007]]), pre, 0.5);
  addTo(m, thump(S(0.12), 160, 110, 0.012, 0.025), pre, 0.4);
  addTo(m, burst(c.seed('l'), 0.015, 4500, 1, 0.0008, 0.0001), pre + 0.018, 0.2);
  addTo(m, edge(bellStrike(S(0.4), f * 2, { tau: 0.12, kind: 'glass', amp: 1 }), 0.0004, 0.05), pre + 0.002, 0.15);
  m.set(hp(m, 90));
  const out = verb(Buf.fromMono(m, (r() - 0.5) * 0.3), 'room', 0.14, 0.12);
  fin(out, { peak: -12, fadeOut: 0.1 }).scale(vel);
  return { buf: out, offsetSec: pre, send: -26 };
}

/** playhead zips across the timeline (39.75 -> lands on 40.0): accelerating zipper-tooth ticks + rising swish + glide, panning L to R, and a landing "tok" on the downbeat */
function playhead_zip(ev, c) {
  const lead = 0.25, n = S(lead + 0.35), m = Z(n), r = c.rng('pz');
  const zn = S(lead);
  addTo(m, mulA(bp(nz(zn, c.seed('s'), 0.9), sweep(zn, 800, 6500, 1.2), 1.0), env(zn, [[0, 0], [0.18, 1], [0.24, 0.6], [0.25, 0]], 'smooth')), 0, 0.5);
  addTo(m, mulA(sine(sweep(zn, 500, 2600, 1.3), zn), env(zn, [[0, 0], [0.05, 0.4], [0.2, 1], [0.25, 0]], 'smooth')), 0, 0.09);
  let t = 0.004, k = 0;
  while (t < lead - 0.012) {
    const u = t / lead, rate = 70 + 330 * Math.sin(Math.PI * u * 0.85) ** 1.5; // accelerate, then a touch of slowing at the end
    addTo(m, sum([burst(c.seed('z' + k), 0.01, 3200 + 1500 * u, 1, 0.0008, 0.0001), modal(S(0.02), [[4200 + 1800 * u, 0.4, 0.003]])]), t, (0.3 + 0.5 * Math.sin(Math.PI * u)) * (0.8 + 0.4 * r()));
    t += 1 / rate;
    k++;
  }
  addTo(m, sum([thump(S(0.2), 150, 90, 0.014, 0.04), modal(S(0.18), [[360, 0.5, 0.02], [820, 0.3, 0.012]]), burst(c.seed('lt'), 0.02, 2800, 1, 0.0012, 0.0001)]), lead - 0.002, 0.6);
  m.set(hp(m, 90));
  const pan = fromFn(n, (t) => -0.8 + 1.6 * ss(0, lead, t));
  const b = panSweep(m, pan);
  return { buf: fin(verb(b, 'room', 0.15, 0), { peak: -9, fadeIn: 0.002, fadeOut: 0.2 }), send: -26 };
}

/**
 * grade wipe (40.0 -> 41.0): a rising "shimmer sweep": nine glass voices glide chord-tone to chord-tone upwards (Shepard-style window, F major),
 * each tremolo'd and panned around the travelling wipe, a rising band-noise sweep and accelerating glitter; the sweep crosses L to R and resolves into grade_set.
 */
function grade_wipe(ev, c) {
  const dur = ev.dur ?? 1.0, tail = 0.9, n = S(dur + tail), r = c.rng('gw');
  const at = (arr, t) => arr[Math.min(n - 1, Math.round(t * SR))];
  const x = fromFn(n, (t) => ss(0.04, dur * 0.97, t));
  const lad = chordLadder(ev.t, 53, 16); // bar of F: F3 A3 C4 F4 A4 C5 F5 A5 C6 F6 A6 C7 F7 ...
  const L = Z(n), R = Z(n);
  const gA = fromFn(n, (t) => (t < dur * 0.18 ? ss(0, dur * 0.18, t) * 0.5 : t < dur ? 0.5 + 0.5 * ss(dur * 0.18, dur * 0.85, t) : Math.exp(-(t - dur) / 0.4)));
  for (let k = 0; k < 13; k++) {
    const f0 = lad[k], f1 = lad[k + 3]; // every voice climbs one octave, chord-tone to chord-tone
    const fc = fromFn(n, (t) => (t < dur ? f0 * Math.pow(f1 / f0, at(x, t)) : f1));
    const win = fromFn(n, (t) => Math.exp(-Math.pow(Math.log2(at(fc, t) / 1500) / 1.3, 2)));
    const trem = dsp.lfo('sine', 5 + 6 * r(), n, { min: 0.45, max: 1, phase: r() });
    const sig = mulA(mulA(sum([sine(fc, n, r()), scaleA(sine(scaleA(fc, 2.003), n, r()), 0.22)]), mulA(win, trem)), gA);
    const off = (k % 2 ? 1 : -1) * 0.3 * r();
    for (let i = 0; i < n; i++) {
      const [gl, gr] = dsp.panGains(clamp(-0.85 + 1.7 * x[i] + off, -1, 1), true);
      L[i] += sig[i] * gl * 0.2;
      R[i] += sig[i] * gr * 0.2;
    }
  }
  const sweepN = mulA(bp(nz(n, c.seed('sn'), 0.9), fromFn(n, (t) => 300 * Math.pow(10000 / 300, at(x, t))), 1.2), fromFn(n, (t) => (t < dur ? Math.pow(ss(0, dur, t), 1.2) * 0.9 : Math.exp(-(t - dur) / 0.12) * 0.9)));
  const sweepN2 = mulA(bp(nz(n, c.seed('sn2'), 0.9), fromFn(n, (t) => 320 * Math.pow(10000 / 300, at(x, t))), 1.2), fromFn(n, (t) => (t < dur ? Math.pow(ss(0, dur, t), 1.2) * 0.9 : Math.exp(-(t - dur) / 0.12) * 0.9)));
  for (let i = 0; i < n; i++) {
    const [gl, gr] = dsp.panGains(clamp(-0.7 + 1.4 * x[i], -1, 1), true);
    L[i] += (sweepN[i] * gl * 0.7 + sweepN2[i] * 0.2) * 0.4;
    R[i] += (sweepN2[i] * gr * 0.7 + sweepN[i] * 0.2) * 0.4;
  }
  const gn = n;
  const rate = fromFn(gn, (t) => (t < dur ? 30 + 330 * Math.pow(t / dur, 2) : 360 * Math.exp(-(t - dur) / 0.2)));
  const glit = hp(bp(poisson(gn, rate, r, { tail: 2 }), 7500, 0.9), 5000);
  const gw = wide(glit, 1, c.seed('gw2'));
  for (let i = 0; i < n; i++) { L[i] += gw.L[i] * 0.3; R[i] += gw.R[i] * 0.3; }
  return { buf: fin(verb(Buf.from(L, R), 'plate', 0.3, 0.0), { peak: -10, fadeIn: 0.01, fadeOut: 0.5 }), send: -22 };
}

/** grade locked (41.0, flash): camera-flash pop + soft sub thump, an F-major-add9 glass bell bloom with warm pad, reverse air lead-in, hall tail */
function grade_set(ev, c) {
  const pre = 0.07, dur = pre + 2.2, B = new Buf(dur), r = c.rng('gs');
  put(B, mulA(hp(nz(S(pre), c.seed('ai'), 0.8), 3500), fromFn(S(pre), (t) => 0.4 * Math.pow(t / pre, 2.4))), 0, 1, 0);
  put(B, sum([scaleA(burst(c.seed('fl'), 0.15, 4000, 1, 0.045, 0.002), 0.8), burst(c.seed('pp'), 0.03, 1200, 1, 0.004, 0.0003)]), pre, 0.95, 0);
  put(B, sum([thump(S(0.6), 87, 52, 0.05, 0.16), thump(S(0.2), 190, 100, 0.02, 0.05)]), pre, 0.9, 0);
  [698.46, 880, 1046.5, 1396.9, 1760, 2093, 3135.96].forEach((f, k) => {
    const x = sum([bellStrike(S(2.0), f, { tau: 0.95 - 0.07 * k, kind: 'bell', amp: 0.9 }), scaleA(bellStrike(S(1.2), f * 2, { tau: 0.35, kind: 'glass', amp: 0.35 }), 0.3)]);
    put(B, edge(x, 0.0004, 0.2), pre + 0.01 * k + r() * 0.002, 0.24 - 0.018 * k, -0.45 + 0.15 * k);
  });
  const nn = S(1.6);
  [174.61, 220, 261.63, 349.23].forEach((f, k) => put(B, mulA(sum([sine(f * 0.9993, nn), sine(f * 1.0007, nn), scaleA(sine(f * 2, nn), 0.15)]), env(nn, [[0, 0], [0.04, 1], [0.4, 0.5], [1.6, 0]], 'smooth')), pre, 0.08, (k % 2 ? 1 : -1) * 0.3));
  return { buf: fin(verb(B, 'hall', 0.3, 0.0), { peak: -8, fadeOut: 0.6 }), offsetSec: pre, send: -22 };
}


// =============================================================================================================
// THE FUTURE  42 - 50
// =============================================================================================================

/**
 * year_jump (42.0 / 44.0 / 46.0): the year counter jumps era. Reverse whoosh into the cut, bit-crushed digit-roll glitch (chord-tone blips + sample-hold
 * chatter), a sub boom on the bar's root, then a forward zoom-out whoosh. 2050 is crisp/techy, 2100 lighter and glassy, 2150 the biggest (deeper sub, shimmer).
 */
function year_jump(ev, c) {
  const k = Math.max(0, c.cues.FUTURES.findIndex((fu) => Math.abs(fu.t0 - ev.t) < 0.01)), r = c.rng('yj'); // 0 = 2050, 1 = 2100, 2 = 2150
  const pre = 0.3, dur = pre + 1.7, B = new Buf(dur);
  const G = [1.0, 0.7, 1.15][k]; // intensity
  // 1. reverse whoosh into the jump
  const np = S(pre);
  const rv = mulA(bp(nz(np, c.seed('rv'), 0.9), sweep(np, 300, 9500, 1.1), 0.9), fromFn(np, (t) => Math.pow(t / pre, 2.2)));
  put(B, rv, 0, 0.5 * G, 0);
  put(B, hp(mulA(nz(np, c.seed('rh'), 0.9), fromFn(np, (t) => Math.pow(t / pre, 3.2))), 5000), 0, 0.3, 0);
  put(B, mulA(sine(sweep(np, 220, 880, 1.2), np), fromFn(np, (t) => 0.2 * Math.pow(t / pre, 2.6))), 0, 1, 0);
  // 2. digit-roll glitch: chord-tone blips, bit-crushed, plus sample-hold chatter bursts
  const ladder = chordLadder(ev.t, 72 + 3 * k, 8);
  const nb = 14 + 4 * k;
  for (let j = 0; j < nb; j++) {
    const u = j / nb, ln = 0.005 + 0.007 * r(), f = ladder[Math.floor(r() * ladder.length)];
    const sq = mulA(sum([sine(f, S(ln)), scaleA(dsp.osc('square', f, S(ln)), 0.25)]), perc(S(ln), ln * 0.4, 0.0003));
    const bc = dsp.bitcrush(sq, { bits: 5, rate: 9000 + 5000 * r() });
    put(B, bc, pre + 0.18 * Math.pow(u, 1.3) + r() * 0.004, 0.32 * (1 - 0.6 * u), (r() * 2 - 1) * 0.85);
  }
  const chn = S(0.2);
  const chat = dsp.bitcrush(bp(nz(chn, c.seed('ch'), 0.9), 3400, 0.7), { bits: 4, rate: 6000 });
  put(B, mulA(chat, fromFn(chn, (t) => (Math.sin(TAU * 38 * t) > 0 ? 1 : 0) * Math.exp(-t / 0.07))), pre, 0.3 * G, 0);
  put(B, burst(c.seed('ck'), 0.03, 2500, 1, 0.003, 0.0002), pre, 0.55, 0);
  // 3. sub boom on the root of the bar + body
  const root = hzNearPc(rootPc(ev.t), 52);
  const sn = S(1.6);
  put(B, thump(sn, root * 2.0, root, 0.06, [0.3, 0.26, 0.4][k]), pre, 1.0, 0);
  put(B, sat(thump(S(0.8), root * 3, root * 2, 0.05, 0.15), 3, 1), pre, 0.3, 0); // audible overtones on small speakers
  put(B, thump(S(0.3), 180, 95, 0.02, 0.06), pre, 0.4, 0);
  // 4. forward zoom-out whoosh (wide)
  const wn = S(1.2);
  const wf = (seed, d) => mulA(bp(nz(wn, c.seed(seed), 0.9), sweep(wn, 7000 + d, 450, 0.9), 0.8), env(wn, [[0, 0], [0.04, 1], [0.35, 0.45], [1.2, 0]], 'smooth'));
  put(B, wf('wl', 0), pre + 0.01, 0.34 * G, -0.6);
  put(B, wf('wr', 500), pre + 0.01, 0.34 * G, 0.6);
  // 5. the year digits roll for 0.25 s and lock: ratchet ticks decelerating, then a tuned pip
  let t = 0, j = 0;
  while (t < 0.24) {
    const u = t / 0.24;
    put(B, sum([burst(c.seed('dr' + j), 0.008, 3600, 1, 0.0007, 0.0001), modal(S(0.02), [[2300 + 600 * Math.sin(j * 1.3), 0.5, 0.003]])]), pre + t, 0.2 * (1 - 0.4 * u), (j % 2 ? 0.5 : -0.5));
    t += 0.012 + 0.03 * Math.pow(u, 1.5);
    j++;
  }
  const lockF = ladder[2 + k];
  put(B, edge(bellStrike(S(0.9), lockF, { tau: 0.3, kind: 'glass', amp: 1 }), 0.0004, 0.1), pre + 0.25, 0.22, 0);
  if (k === 2) { // 2150: a rising dream shimmer bloom over the sub
    ladderPcs(chordPcs(ev.t), 81, 6).forEach((f, q) => put(B, edge(bellStrike(S(1.5), f, { tau: 0.5, kind: 'celesta', amp: 1 }), 0.0004, 0.2), pre + 0.06 + 0.05 * q, 0.16, -0.6 + 0.24 * q));
  }
  const out = bassMono(verb(B, k === 2 ? 'hall' : 'plate', k === 2 ? 0.26 : 0.2, 0.0), 140);
  return { buf: fin(out, { peak: [-5, -7.5, -4.5][k], fadeOut: 0.5 }), offsetSec: pre, send: -22 };
}

/** hologram projector hum (2050): C-major drone of beating sines, fast hologram tremolo, a thin high turbine whine, irregular light flicker, data crackle, slow autopan */
function holo_hum(ev, c) {
  const dur = ev.dur ?? 2.0, tail = 0.7, n = S(dur + tail), r = c.rng('hh');
  const g = fromFn(n, (t) => ss(0, 0.4, t) * (1 - ss(dur - 0.2, dur + tail, t)));
  const L = Z(n), R = Z(n);
  [[130.81, 1.0], [196, 0.7], [261.63, 0.8], [329.63, 0.6], [392, 0.45], [523.25, 0.3], [659.25, 0.12]].forEach(([f, a], k) => {
    const tr = dsp.lfo('sine', 6.5 + 2.5 * r(), n, { min: 0.55, max: 1, phase: r() });
    const x = mulA(sum([sine(f - 0.4 - 0.1 * k, n, r()), sine(f + 0.4 + 0.1 * k, n, r()), scaleA(sine(f * 2.0, n, r()), 0.1)]), tr);
    const [gl, gr] = dsp.panGains((k % 2 ? 1 : -1) * (0.2 + 0.1 * k), true);
    for (let i = 0; i < n; i++) { const v = x[i] * a * 0.17 * g[i]; L[i] += v * gl; R[i] += v * gr; }
  });
  // turbine whine + sidebands (the projector head), flickering
  const flick = fromFn(n, (t) => 0.55 + 0.45 * Math.sin(TAU * 13 * t + 2 * Math.sin(TAU * 2.1 * t)) * Math.sin(TAU * 3.7 * t + 1));
  const wh = mulA(sum([sine(5200, n), scaleA(sine(5200 + 87, n), 0.5), scaleA(sine(5200 - 87, n), 0.5)]), mulA(flick, g));
  const w2 = wide(wh, 0.7, c.seed('ww'));
  const dn = hp(poisson(n, 120, r, { tail: 2.5 }), 4000);
  const dw = wide(dn, 1, c.seed('dw'));
  for (let i = 0; i < n; i++) {
    L[i] += w2.L[i] * 0.02 + dw.L[i] * 0.07 * g[i];
    R[i] += w2.R[i] * 0.02 + dw.R[i] * 0.07 * g[i];
  }
  [1046.5, 1318.5, 1568, 2093].forEach((f, k) => { // the hologram's shimmer: a glassy C-major halo that twinkles in and out
    const tw = dsp.lfo('sine', 3 + 2.2 * r(), n, { min: 0, max: 1, phase: r() });
    const sh = mulA(sum([sine(f - 0.9, n, r()), sine(f + 0.9, n, r())]), mulA(mulA(tw, tw), g));
    const [gl, gr] = dsp.panGains((k % 2 ? 1 : -1) * (0.35 + 0.1 * k), true);
    for (let i = 0; i < n; i++) { L[i] += sh[i] * gl * 0.035; R[i] += sh[i] * gr * 0.035; }
  });
  const ap = fromFn(n, (t) => 0.25 * Math.sin(TAU * 0.35 * t));
  const b = Buf.from(L, R);
  for (let i = 0; i < n; i++) { const [gl, gr] = dsp.panGains(ap[i], true); b.L[i] *= gl * 1.414; b.R[i] *= gr * 1.414; }
  return { buf: fin(verb(b, 'hall', 0.28, 0.0), { peak: -14, fadeIn: 0.05, fadeOut: 0.5 }), send: -26 };
}

/** neural swell (2100, 44.5 -> 46.0): synaptic FM-bell pings in G major firing faster and faster, a rising ethereal G pad, an upward thought-glide and electric crackle; crests just before the 2150 jump */
function neural_swell(ev, c) {
  const dur = ev.dur ?? 1.5, tail = 0.5, n = S(dur + tail), r = c.rng('ns');
  const B = new Buf(dur + tail);
  const crest = dur - 0.06;
  const amp = fromFn(n, (t) => (t < crest ? Math.pow(t / crest, 1.8) : Math.exp(-(t - crest) / 0.12)));
  const lad = chordLadder(ev.t, 79, 12); // bar of G
  let t = 0.02, k = 0;
  while (t < crest) {
    const u = t / crest, rate = 4 + 56 * Math.pow(u, 1.7);
    const f = lad[Math.floor(r() * lad.length)], ln = 0.12 + 0.2 * r();
    const nn = S(ln);
    const ping = mulA(dsp.fmOsc(f, nn, { ratio: 3.5, index: fromFn(nn, (tt) => 1.3 * Math.exp(-tt / 0.03)) }), perc(nn, ln * 0.35, 0.001));
    put(B, ping, t, 0.28 * (0.3 + 0.7 * u) * (0.6 + 0.4 * r()), (r() * 2 - 1) * 0.9);
    t += (1 / rate) * (0.5 + r());
    k++;
  }
  const pad = Z(n);
  [196, 246.94, 293.66, 392, 587.33].forEach((f, q) => addTo(pad, sum([sine(f * 0.9994, n, r()), sine(f * 1.0006, n, r())]), 0, 0.5 / (1 + 0.3 * q)));
  const padB = wide(mulA(pad, amp), 0.8, c.seed('pw'));
  put(B, padB, 0, 0.2, 0);
  put(B, mulA(sine(sweep(n, 392, 3136, 1.5), n), fromFn(n, (tt) => 0.06 * amp[Math.min(n - 1, Math.round(tt * SR))])), 0, 1, 0.2);
  const cr = mulA(hp(poisson(n, fromFn(n, (tt) => 30 + 500 * Math.pow(Math.min(1, tt / crest), 2)), r, { tail: 2.5 }), 5000), amp);
  put(B, wide(cr, 1, c.seed('cw')), 0, 0.12, 0);
  return { buf: fin(verb(B, 'plate', 0.32, 0.0), { peak: -12, fadeIn: 0.01, fadeOut: 0.3 }), send: -24 };
}

/** dream shimmer (2150, 46.0 -> 50.0): granular octave-shimmer clouds of the Am chord (46-48) then F (48-50) with density rising, reversed breath grains, sparse glass sparkles; a slow swell, wide */
function dream_shimmer(ev, c) {
  const dur = ev.dur ?? 4.0, tail = 1.0, T = dur + tail, r = c.rng('ds');
  const cloudFor = (hzList, seconds, seedLabel, dens0, dens1) => {
    const sl = 3.0, ns = S(sl);
    const src = Z(ns);
    hzList.forEach((f, q) => {
      addTo(src, mulA(sum([sine(f * 0.9993, ns, r()), sine(f * 1.0007, ns, r()), scaleA(sine(f * 2.0, ns, r()), 0.25), scaleA(sine(f * 3.0, ns, r()), 0.1)]), env(ns, [[0, 0], [0.4, 1], [2.6, 1], [3.0, 0]], 'smooth')), 0, 0.5 / (1 + 0.25 * q));
    });
    const dens = Float32Array.from({ length: 64 }, (_, i) => dens0 + (dens1 - dens0) * Math.pow(i / 63, 1.2));
    return dsp.granularCloud(src, seconds, {
      grainMs: 150, density: dens, spread: 0.95, seed: c.seed(seedLabel), posJitter: 0.25, pos: [0.15, 0.7], reverse: 0.25,
      pitch: (rng) => [0, 12, 12, 24, 24, 36][Math.floor(rng() * 6)], gainDb: 0,
    });
  };
  const A = cloudFor(chordLadder(ev.t, 57, 4), 2.4, 'cA', 26, 55); // the first bar's chord (Am): 46.0-48.0 (+ overlap)
  const F = cloudFor(chordLadder(ev.t + cues.BAR, 53, 4), T - 1.9, 'cF', 40, 90); // the next bar's chord (F): 47.9 -> end
  const B = new Buf(T);
  const envA = fromFn(A.length, (t) => ss(0, 0.5, t) * (1 - ss(1.9, 2.4, t)));
  const envF = fromFn(F.length, (t) => ss(0, 0.45, t) * (1 - ss(T - 1.9 - 1.2, T - 1.9, t)));
  for (let i = 0; i < A.length; i++) { A.L[i] *= envA[i]; A.R[i] *= envA[i]; }
  for (let i = 0; i < F.length; i++) { F.L[i] *= envF[i]; F.R[i] *= envF[i]; }
  put(B, A, 0, 0.8, 0);
  put(B, F, 1.9, 1.0, 0);
  // sparkle: sparse glass pings on the chord, getting denser toward the climax
  let t = 0.1;
  while (t < dur - 0.2) {
    const u = t / dur, chordT = ev.t + t, f = chordLadder(chordT, 84, 6)[Math.floor(r() * 6)];
    put(B, edge(bellStrike(S(1.0), f, { tau: 0.3, kind: 'celesta', amp: 1 }), 0.0004, 0.12), t, 0.05 + 0.08 * u, (r() * 2 - 1) * 0.9);
    t += (0.35 - 0.26 * u) * (0.5 + r());
  }
  const swell = fromFn(B.length, (tt) => 0.55 + 0.45 * ss(0, dur - 0.5, tt) * (1 - ss(dur, T, tt) * 0.9));
  for (let i = 0; i < B.length; i++) { B.L[i] *= swell[i]; B.R[i] *= swell[i]; }
  return { buf: fin(verb(B, 'hall', 0.3, 0.0), { peak: -12, fadeIn: 0.05, fadeOut: 0.8 }), send: -22 };
}

/**
 * swell climax (2150 audience stands, 48.0 -> 50.0): a gong / cymbal wash on the cheer, an F-major supersaw + choir swell opening from dark to bright,
 * rising glass glide, F1 sub swell and rising air; crests at 50.0 and rings out underneath the recap riser.
 */
function swell_climax(ev, c) {
  const dur = ev.dur ?? 2.0, tail = 1.6, n = S(dur + tail), r = c.rng('sc');
  const at = (arr, t) => arr[Math.min(n - 1, Math.round(t * SR))];
  const x = fromFn(n, (t) => clamp(t / dur, 0, 1));
  const rise = fromFn(n, (t) => (t < dur ? 0.18 + 0.82 * Math.pow(t / dur, 1.6) : Math.exp(-(t - dur) / 0.7)));
  const B = new Buf(dur + tail);
  // gong / cymbal wash on the cheer: inharmonic modal cluster + swelling air
  const gn = S(3.4), gp = [];
  for (let k = 0; k < 16; k++) gp.push([320 * Math.pow(14, r()), 0.3 + 0.7 * r(), 0.5 + 0.9 * r()]);
  gp.push([174.6, 0.7, 1.6], [349.2, 0.5, 1.2], [523.3, 0.4, 1.0]);
  const gong = mulA(modal(gn, gp), env(gn, [[0, 0], [0.06, 1], [3.4, 0.4]], 'smooth'));
  put(B, edge(gong, 0.001, 0.4), 0, 0.2, 0);
  put(B, mulA(hp(nz(gn, c.seed('cy'), 0.9), 4500), env(gn, [[0, 0], [0.12, 1], [0.6, 0.55], [2.6, 0]], 'smooth')), 0, 0.2, 0);
  // supersaw chord swell
  const cut = fromFn(n, (t) => 450 * Math.pow(10000 / 450, Math.pow(clamp(t / dur, 0, 1), 1.3)));
  const sa = Z(n), sb = Z(n);
  [174.61, 261.63, 349.23, 440, 523.25, 698.46].forEach((f, q) => {
    const u = dsp.unison('saw', f, n, { voices: 5, detuneCents: 13, spread: 0.9, seed: c.seed('u' + q) });
    const fl = dsp.svf(u.L, 'lp', cut, 0.8), fr = dsp.svf(u.R, 'lp', cut, 0.8);
    for (let i = 0; i < n; i++) { sa[i] += fl[i] / (1 + 0.15 * q); sb[i] += fr[i] / (1 + 0.15 * q); }
  });
  for (let i = 0; i < n; i++) { const g = rise[i] * (t01(i)); sa[i] *= g; sb[i] *= g; }
  function t01(i) { return Math.min(1, (i / SR) / 0.25); }
  put(B, Buf.from(sa, sb), 0, 0.2, 0);
  // choir ooh -> aah on F4 / A4 / C5
  [349.23, 440, 523.25].forEach((f, q) => {
    const vib = dsp.lfo('sine', 5.4 + 0.3 * q, n, { min: 0.992, max: 1.008, phase: r() });
    const saw = dsp.osc('saw', mulA(fromFn(n, () => f), vib), n);
    const ch = dsp.formant(saw, 'o', { voice: 'soprano', to: 'a', morph: fromFn(n, (t) => clamp(t / dur, 0, 1)) });
    put(B, wide(mulA(ch, rise), 0.6, c.seed('cw' + q)), 0, 0.08, -0.4 + 0.4 * q);
  });
  // glass glide, sub swell, air
  put(B, mulA(sum([sine(sweep(n, 698.46, 2793.8, 1.3), n), scaleA(sine(sweep(n, 1396.9, 5587, 1.3), n), 0.3)]), fromFn(n, (t) => 0.1 * at(rise, t) * (t < dur ? 1 : Math.exp(-(t - dur) / 0.3)))), 0, 1, 0.1);
  put(B, mulA(sum([sine(43.65, n), scaleA(sine(87.31, n), 0.3)]), fromFn(n, (t) => 0.3 * at(rise, t) * ss(0, 0.5, t))), 0, 1, 0);
  put(B, wide(mulA(bp(nz(n, c.seed('ai'), 0.9), fromFn(n, (t) => 1000 * Math.pow(12, at(x, t))), 0.7), fromFn(n, (t) => 0.45 * Math.pow(at(rise, t), 1.5))), 1, c.seed('aw')), 0, 1, 0);
  return { buf: fin(bassMono(verb(B, 'hall', 0.32, 0.0), 140), { peak: -6, fadeIn: 0.004, fadeOut: 0.8 }), send: -20 };
}

// =============================================================================================================
// RECAP + END CARD  50 - 60
// =============================================================================================================

/**
 * tape rewind (50.0 -> 54.0): a reel-to-reel / VHS rewind of "the film itself": synthesised program material (formant babble of syllables + the
 * E G A C motif plucks + a drone) played BACKWARDS with an accelerating varispeed (pitch sweeps up as the recursion deepens), reel-motor whine,
 * tape-head chirps, hiss with drop-outs; a button clunk at the start and a tape-stop that dies away before the logo at 54.0.
 */
function rewind_texture(ev, c) {
  const dur = ev.dur ?? 4.0, n = S(dur), r = c.rng('rw');
  const at = (arr, t) => arr[Math.min(n - 1, Math.round(t * SR))];
  const stopT = dur - 0.34;
  const vmax = 4.4;
  const dr = dsp.drift(n, 3.1, 1, c.seed('wow'));
  const v = fromFn(n, (t) => {
    let s = t < stopT ? 1.6 * ss(0, 0.5, t) + (vmax - 1.6) * ss(0.4, stopT - 0.2, t) : vmax * Math.pow(1 - ss(stopT, dur - 0.04, t), 1.5);
    return Math.max(0, s) * (1 + 0.012 * dr[Math.min(n - 1, Math.round(t * SR))]);
  });
  let tot = 0;
  for (let i = 0; i < n; i++) tot += v[i];
  tot /= SR;
  const srcLen = tot + 0.6, ns = S(srcLen);
  // ---- program material ----
  const src = Z(ns);
  const vowels = ['a', 'e', 'i', 'o', 'u'];
  let ts = 0.1;
  while (ts < srcLen - 0.3) {
    const sylN = 2 + Math.floor(r() * 3);
    for (let s = 0; s < sylN && ts < srcLen - 0.3; s++) {
      const ln = 0.11 + 0.1 * r(), nn = S(ln), f0 = 95 + 85 * r();
      const f = fromFn(nn, (t) => f0 * (1 + 0.18 * Math.sin(Math.PI * t / ln) * (r() < 0.5 ? 1 : 1)));
      const saw = dsp.osc('saw', f, nn);
      const ch = dsp.formant(saw, vowels[Math.floor(r() * 5)], { voice: r() < 0.6 ? 'tenor' : 'alto', to: vowels[Math.floor(r() * 5)], morph: fromFn(nn, (t) => t / ln) });
      addTo(src, mulA(ch, env(nn, [[0, 0], [ln * 0.2, 1], [ln * 0.75, 0.7], [ln, 0]], 'smooth')), ts, 0.45);
      ts += ln + 0.02;
    }
    ts += 0.12 + 0.3 * r();
  }
  // the motif (E4 G4 A4 C5) plucks once per bar, plus a soft pad on the bar chords
  for (let b = 0; b * 2 < srcLen - 0.5; b++) {
    cues.MOTIF.notes.forEach((nt) => {
      const nn = S(0.5), f = dsp.midiToHz(nt.midi);
      addTo(src, mulA(sum([dsp.osc('tri', f, nn), scaleA(sine(f * 2, nn), 0.2)]), perc(nn, 0.2, 0.004)), 2 * b + nt.beat * 0.5, 0.32);
    });
  }
  const drone = mulA(sum([sine(55, ns), sine(110.2, ns), scaleA(sine(220.4, ns), 0.4)]), fromFn(ns, () => 1));
  addTo(src, drone, 0, 0.14);
  const prog = lp(src, 3600);
  // ---- play it BACKWARDS at the accelerating speed ----
  const sneg = Float32Array.from(v, (x) => -x);
  const played = dsp.varispeed(prog, sneg, { n, start: tot + 0.3 });
  const body = hp(played, 120);
  // ---- mechanics ----
  const gate = fromFn(n, (t) => ss(0, 0.12, t) * (1 - ss(dur - 0.14, dur - 0.01, t)));
  const whine = mulA(sum([lp(dsp.osc('saw', fromFn(n, (t) => 60 + 90 * at(v, t)), n), 1800), scaleA(sine(fromFn(n, (t) => 900 + 700 * at(v, t)), n), 0.18)]), fromFn(n, (t) => 0.1 * Math.min(1, at(v, t) / 1.0)));
  const hiss = mulA(hp(nz(n, c.seed('hs'), 0.9), 3500), fromFn(n, (t) => (0.05 + 0.04 * at(v, t) / vmax) * (Math.sin(TAU * 7.3 * t + 2 * Math.sin(TAU * 0.9 * t)) > -0.9 ? 1 : 0.2)));
  const m = mixTo(n, [[body, 1.0], [whine, 1], [hiss, 1]]);
  // tape-head chirps: Poisson events, faster as the speed climbs
  let tc = 0.3;
  while (tc < dur - 0.4) {
    const sp = at(v, tc), rate = 2.5 + 4.5 * sp;
    const f0 = 2200 + 2600 * r(), up = r() < 0.5, ln = 0.022 + 0.04 * r(), nn = S(ln);
    const chirp = mulA(dsp.fmOsc(sweep(nn, up ? f0 * 0.6 : f0, up ? f0 : f0 * 0.6, 1), nn, { ratio: 2, index: 0.8 }), env(nn, [[0, 0], [0.004, 1], [ln, 0]], 'smooth'));
    addTo(m, chirp, tc, 0.12 + 0.06 * r());
    tc += (1 / rate) * (0.4 + 1.2 * r());
  }
  const mm = mulA(m, gate);
  const out = wide(mm, 0.5, c.seed('w'));
  // button clunk at the start, brake clunk at the tape stop
  put(out, sum([thump(S(0.2), 110, 65, 0.02, 0.05), modal(S(0.15), [[240, 0.5, 0.03], [620, 0.35, 0.02]]), burst(c.seed('bt'), 0.02, 2000, 1, 0.002, 0.0002)]), 0.0, 0.9, 0);
  put(out, sum([thump(S(0.2), 95, 60, 0.02, 0.05), modal(S(0.12), [[210, 0.5, 0.025], [540, 0.3, 0.015]]), burst(c.seed('bk'), 0.02, 1800, 1, 0.002, 0.0002)]), stopT + 0.12, 0.45, 0);
  return { buf: fin(out, { peak: -12, fadeIn: 0.0005, fadeOut: 0.02 }), send: -26 };
}

/** 4 s riser (50.0 -> 54.0): detuned saw stack gliding A3 -> C6 (lands on a tone of the coming C major) through an opening lowpass, accelerating pulse, band-noise rise, sub swell; released into a plate tail that carries over the logo */
function riser(ev, c) {
  const dur = ev.dur ?? 4.0, tail = 0.8, n = S(dur + tail);
  const at = (arr, t) => arr[Math.min(n - 1, Math.round(t * SR))];
  const x = fromFn(n, (t) => clamp(t / dur, 0, 1));
  const f = fromFn(n, (t) => 220 * Math.pow(1046.5 / 220, Math.pow(at(x, t), 1.4)));
  const amp = fromFn(n, (t) => (t < dur - 0.1 ? 0.1 + 0.9 * Math.pow(t / (dur - 0.1), 1.8) : t < dur ? 1 - ss(dur - 0.1, dur, t) : 0));
  const cut = fromFn(n, (t) => 300 * Math.pow(12000 / 300, Math.pow(at(x, t), 1.2)));
  const ua = dsp.unison('saw', f, n, { voices: 5, detuneCents: 12, spread: 0.9, seed: c.seed('ua') });
  const f2 = Float32Array.from(f, (v) => v * 2);
  const ub = dsp.unison('saw', f2, n, { voices: 3, detuneCents: 9, spread: 0.7, seed: c.seed('ub') });
  const sL = dsp.svf(ua.L, 'lp', cut, 0.9), sR = dsp.svf(ua.R, 'lp', cut, 0.9);
  const bL = dsp.svf(ub.L, 'lp', cut, 0.9), bR = dsp.svf(ub.R, 'lp', cut, 0.9);
  // accelerating pulse: 4 Hz -> 28 Hz, shallower as it speeds up
  const gate = Z(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const u = at(x, i / SR);
    ph += (4 + 24 * Math.pow(u, 1.8)) / SR;
    const d = 0.55 - 0.3 * u;
    gate[i] = 1 - d * (0.5 + 0.5 * Math.sin(TAU * ph));
  }
  const nzL = mulA(bp(nz(n, c.seed('nl'), 0.9), fromFn(n, (t) => 200 * Math.pow(11000 / 200, Math.pow(at(x, t), 1.1))), 0.8), fromFn(n, (t) => Math.pow(at(x, t), 2.4)));
  const nzR = mulA(bp(nz(n, c.seed('nr'), 0.9), fromFn(n, (t) => 215 * Math.pow(11000 / 200, Math.pow(at(x, t), 1.1))), 0.8), fromFn(n, (t) => Math.pow(at(x, t), 2.4)));
  const sub = mulA(sine(fromFn(n, (t) => 55 * Math.pow(65.41 / 55, at(x, t))), n), fromFn(n, (t) => 0.22 * Math.pow(at(x, t), 2)));
  const air = hp(nz(n, c.seed('air'), 0.9), 7000);
  const L = Z(n), R = Z(n);
  for (let i = 0; i < n; i++) {
    const g = amp[i], gt = gate[i], u = at(x, i / SR);
    L[i] = (sL[i] * 0.4 * gt + bL[i] * 0.22 * gt) * g + nzL[i] * 0.55 * g + sub[i] * g + air[i] * 0.1 * Math.pow(u, 3) * g;
    R[i] = (sR[i] * 0.4 * gt + bR[i] * 0.22 * gt) * g + nzR[i] * 0.55 * g + sub[i] * g + air[i] * 0.1 * Math.pow(u, 3) * g;
  }
  return { buf: fin(bassMono(verb(Buf.from(L, R), 'plate', 0.3, 0.0), 120), { peak: -8, fadeIn: 0.01, fadeOut: 0.5 }), send: -22 };
}

/** push through the screen (53.0 -> 54.0): air rush rising to the moment of passing through, a F-chord tonal glide, low swell, a soft membrane "pwoomp" at 0.93 s and the air closing behind */
function push_whoosh(ev, c) {
  const dur = ev.dur ?? 1.0, tail = 0.7, n = S(dur + tail), r = c.rng('pw');
  const at = (arr, t) => arr[Math.min(n - 1, Math.round(t * SR))];
  const tp = dur * 0.93;
  const up = fromFn(n, (t) => (t < tp ? Math.pow(t / tp, 2.0) : Math.exp(-(t - tp) / 0.2)));
  const L = Z(n), R = Z(n);
  const mk = (seed, d) => mulA(bp(nz(n, c.seed(seed), 0.9), fromFn(n, (t) => (t < tp ? 250 * Math.pow(7500 / 250, Math.pow(t / tp, 1.5)) : 7500 * Math.pow(0.12, (t - tp) / 0.5)) + d), 0.8), up);
  const a = mk('a', 0), b = mk('b', 200);
  const tone = mulA(sum([sine(sweep(n, 174.61, 698.46, 1.5), n), scaleA(sine(sweep(n, 349.23, 1396.9, 1.5), n), 0.4)]), fromFn(n, (t) => 0.1 * at(up, t)));
  const low = mulA(sum([sine(sweep(n, 55, 87.31, 1), n)]), fromFn(n, (t) => 0.18 * Math.pow(at(up, t), 1.5)));
  for (let i = 0; i < n; i++) {
    L[i] = a[i] * 0.55 + b[i] * 0.15 + tone[i] + low[i];
    R[i] = b[i] * 0.55 + a[i] * 0.15 + tone[i] + low[i];
  }
  const B = Buf.from(L, R);
  put(B, sum([thump(S(0.6), 110, 52, 0.05, 0.14), scaleA(burst(c.seed('pf'), 0.25, 2500, 1, 0.06, 0.004, 'lp'), 0.6), modal(S(0.3), [[180, 0.4, 0.08], [340, 0.25, 0.06], [620, 0.15, 0.04]])]), tp, 0.45, 0);
  put(B, wide(hp(mulA(nz(S(0.5), c.seed('cl'), 0.9), fromFn(S(0.5), (t) => Math.exp(-t / 0.12))), 3000), 1, c.seed('cw')), tp + 0.02, 0.2, 0);
  return { buf: fin(bassMono(verb(B, 'hall', 0.3, 0.0), 140), { peak: -7, fadeIn: 0.01, fadeOut: 0.4 }), send: -22 };
}

/** logo resolve (54.0): the iris blades snap shut (swish + six blade ticks), then open in a soft whoosh into a glass-bell C major shimmer (C6 E6 G6 C7 E7) with warm C3 root and glitter, long hall tail */
function logo_resolve(ev, c) {
  const dur = 3.0, n = S(dur), B = new Buf(dur), r = c.rng('lr');
  const cn = S(0.24);
  put(B, mulA(bp(nz(cn, c.seed('c'), 0.9), sweep(cn, 5200, 1500, 1), 1.1), env(cn, [[0, 0], [0.04, 1], [0.2, 0.6], [0.24, 0]], 'smooth')), 0, 0.3, -0.2);
  [0, 0.045, 0.088, 0.13, 0.168, 0.2].forEach((t, k) => {
    const f = 1500 + 260 * k;
    put(B, sum([modal(S(0.08), [[f, 1, 0.01], [f * 2.5, 0.35, 0.005]]), burst(c.seed('bl' + k), 0.01, 4000, 1, 0.0008, 0.0001)]), t, 0.22, -0.5 + 0.2 * k);
  });
  const on = S(0.55);
  put(B, wide(mulA(bp(nz(on, c.seed('o'), 0.9), sweep(on, 800, 7500, 1.1), 0.8), env(on, [[0, 0], [0.12, 0.5], [0.36, 1], [0.55, 0]], 'smooth')), 1, c.seed('ow')), 0.22, 0.3, 0);
  put(B, mulA(sine(sweep(on, 523.25, 2093, 1.2), on), env(on, [[0, 0], [0.3, 0.8], [0.55, 0]], 'smooth')), 0.22, 0.05, 0.1);
  const tb = 0.52;
  [1046.5, 1318.5, 1568, 2093, 2637].forEach((f, k) => {
    const x = sum([bellStrike(S(2.4), f, { tau: 1.0 - 0.1 * k, kind: 'bell', amp: 0.9 }), scaleA(bellStrike(S(1.6), f * 2, { tau: 0.4, kind: 'glass', amp: 0.35 }), 0.3)]);
    put(B, edge(x, 0.0004, 0.3), tb + 0.018 * k + r() * 0.003, 0.3 - 0.03 * k, -0.45 + 0.22 * k);
  });
  const nn = S(2.2);
  [130.81, 196, 261.63, 329.63].forEach((f, k) => put(B, mulA(sum([sine(f * 0.9992, nn), sine(f * 1.0008, nn)]), env(nn, [[0, 0], [0.12, 1], [0.7, 0.55], [2.2, 0]], 'smooth')), tb, 0.09, (k % 2 ? 1 : -1) * 0.25));
  const gn = S(1.6);
  put(B, wide(hp(bp(poisson(gn, fromFn(gn, (t) => 150 * Math.exp(-t / 0.5)), r, { tail: 2 }), 8500, 1), 5500), 1, c.seed('gw')), tb, 0.4, 0);
  return { buf: fin(verb(B, 'hall', 0.34, 0.0), { peak: -8, fadeOut: 1.0 }), send: -20 };
}

/** tagline tick (56.0): letterpress stamp - soft stamp thump + a fine tick + glass ring on the chord (F: C6 with A5 under it) */
function tagline_tick(ev, c) {
  const n = S(0.9), m = Z(n);
  addTo(m, burst(c.seed('c'), 0.02, 3600, 1, 0.0008, 0.0001), 0, 0.45);
  addTo(m, modal(n, [[1046.5, 1, 0.3], [2884, 0.25, 0.1], [5650, 0.1, 0.05]]), 0, 0.5);
  addTo(m, modal(n, [[880, 0.8, 0.2], [2430, 0.2, 0.08]]), 0.012, 0.28);
  addTo(m, thump(S(0.15), 190, 120, 0.014, 0.03), 0, 0.3);
  addTo(m, mulA(bp(nz(S(0.05), c.seed('a'), 0.6), 7000, 1.2), env(S(0.05), [[0, 0], [0.002, 1], [0.04, 0]], 'smooth')), 0, 0.1);
  const out = verb(wide(m, 0.35, c.seed('w')), 'plate', 0.2, 0.3);
  return { buf: fin(out, { peak: -14, fadeOut: 0.3 }), send: -26 };
}

/** call-to-action chip tick (57.0): tiny bubble-click, a two-note pip D6 -> G6 (the chord G) and a short glass ring */
function cta_tick(ev, c) {
  const n = S(0.7), m = Z(n);
  addTo(m, burst(c.seed('c'), 0.02, 4200, 1, 0.0008, 0.0001), 0, 0.4);
  addTo(m, thump(S(0.06), 800, 360, 0.01, 0.015), 0, 0.35);
  const pip = (f, len) => mulA(sum([sine(f, S(len)), scaleA(sine(f * 2, S(len)), 0.14)]), env(S(len), [[0, 0], [0.002, 1], [len - 0.008, 0.8], [len, 0]], 'smooth'));
  addTo(m, pip(1174.66, 0.04), 0.004, 0.5);
  addTo(m, pip(1567.98, 0.06), 0.045, 0.5);
  addTo(m, edge(bellStrike(S(0.6), 1567.98, { tau: 0.18, kind: 'glass', amp: 1 }), 0.001, 0.05), 0.045, 0.14);
  const out = verb(wide(m, 0.3, c.seed('w')), 'plate', 0.18, 0.25);
  return { buf: fin(out, { peak: -14, fadeOut: 0.25 }), send: -26 };
}

/**
 * FINAL IMPACT (58.0), designed to sit UNDER the orchestral hit: a short suck-in, a C-rooted sub boom (C1 + G1 + C2 falling from above) with saturated overtones for small
 * speakers, a low knock + crack for definition, a dark rumble and a cathedral tail that is low-passed so it never muddies the orchestra, fading to digital silence at 60.0.
 */
function impact_big(ev, c) {
  const pre = 0.12, dur = 2.0, n = S(pre + dur), N = S(dur);
  const low = Z(n), up = Z(n); // low = sub boom (stays dry: the FDN would build up modes at 30-60 Hz), up = knock / crack / whomp / rumble (gets the tail)
  const inh = S(pre);
  addTo(up, mulA(lp(nz(inh, c.seed('in'), 0.9), 500), fromFn(inh, (t) => 0.4 * Math.pow(t / pre, 2.5))), 0, 1);
  addTo(low, mulA(sine(sweep(inh, 40, 70, 1), inh), fromFn(inh, (t) => 0.3 * Math.pow(t / pre, 2))), 0, 1);
  const sub = sum([thump(N, 82, 32.7, 0.12, 0.9, { a: 0.003 }), scaleA(thump(N, 125, 49, 0.1, 0.8, { a: 0.003 }), 0.55), scaleA(thump(N, 160, 65.41, 0.09, 0.6, { a: 0.003 }), 0.4)]);
  addTo(low, sub, pre, 1.0);
  addTo(low, sat(sub, 2.8, 1), pre, 0.18); // overtones (98 / 130 / 163 Hz ...) so it reads on laptops and phones
  addTo(up, thump(S(0.5), 135, 70, 0.025, 0.07), pre, 0.55);
  addTo(up, burst(c.seed('cr'), 0.05, 2500, 1, 0.006, 0.0002), pre, 0.5);
  addTo(up, mulA(lp(nz(S(0.6), c.seed('wm'), 0.9), 450), env(S(0.6), [[0, 0], [0.004, 1], [0.12, 0.45], [0.6, 0]], 'smooth')), pre, 0.5);
  addTo(up, mulA(lp(nz(N, c.seed('rm'), 0.9, 'brown'), 180), env(N, [[0, 0], [0.02, 1], [0.5, 0.55], [1.9, 0]], 'smooth')), pre, 0.4);
  addTo(up, mulA(hp(nz(S(1.2), c.seed('sz'), 0.9), 7500), env(S(1.2), [[0, 0], [0.01, 1], [0.4, 0.3], [1.2, 0]], 'smooth')), pre, 0.06);
  const upW = wide(hp(up, 70), 0.3, c.seed('w'));
  const wet = dsp.applyReverb(upW, 'cathedral', { wetOnly: true, wet: 0.45, highCut: 900, lowCut: 80, tail: 0 });
  const out = new Buf(pre + dur);
  for (let i = 0; i < n; i++) {
    out.L[i] = low[i] + upW.L[i] + wet.L[i];
    out.R[i] = low[i] + upW.R[i] + wet.R[i];
  }
  for (const ch of [out.L, out.R]) ch.set(dsp.biquad(dsp.biquad(ch, 'hp', 24, 0.7), 'hp', 24, 0.7)); // nothing below the sub fundamental
  return { buf: fin(bassMono(out, 160), { peak: -3, fadeIn: 0.01, fadeOut: 0.7 }), offsetSec: pre, send: -40 };
}

/** projector click-off (59.5): the lamp-house switch clunk, arc-lamp fizzle and a falling hum, then the gate / claw spinning down (ticks at 24 /s slowing), motor whine dying; quiet, dry and real */
function projector_clickoff(ev, c) {
  const dur = 0.5, n = S(dur), m = Z(n), r = c.rng('pc');
  addTo(m, sum([thump(S(0.2), 92, 58, 0.03, 0.04), modal(S(0.2), [[210, 0.6, 0.04], [470, 0.5, 0.03], [1100, 0.35, 0.015], [2400, 0.2, 0.008]]), burst(c.seed('lt'), 0.03, 2000, 1, 0.003, 0.0002)]), 0, 0.9);
  addTo(m, sum([thump(S(0.1), 150, 100, 0.012, 0.03), burst(c.seed('l2'), 0.02, 3000, 1, 0.0015, 0.0001)]), 0.034, 0.4);
  const fz = mulA(bp(poisson(n, fromFn(n, (t) => 900 * Math.exp(-t / 0.1)), r, { tail: 2.2 }), 4200, 0.7), env(n, [[0.01, 0], [0.03, 1], [0.3, 0]], 'smooth'));
  addTo(m, fz, 0, 0.9);
  const fb = fromFn(n, (t) => 110 * Math.pow(40 / 110, Math.min(1, t / 0.3)));
  const fl = fromFn(n, (t) => 1 - 0.5 * Math.max(0, Math.sin(TAU * 31 * t)));
  addTo(m, mulA(mulA(lp(dsp.osc('saw', fb, n), 900), fl), env(n, [[0, 0], [0.02, 1], [0.3, 0.2], [0.34, 0]], 'smooth')), 0, 0.13);
  addTo(m, modal(S(0.2), [[2420, 0.4, 0.05], [3640, 0.2, 0.03]]), 0.27, 0.025);
  let t = 0.03, dt = 1 / 24, k = 0;
  while (t < dur - 0.02) {
    const u = t / dur;
    addTo(m, sum([burst(c.seed('g' + k), 0.015, 1900, 0.9, 0.003, 0.0003, 'bp'), thump(S(0.05), 190, 130, 0.01, 0.012), burst(c.seed('h' + k), 0.01, 3500, 1, 0.0007, 0.0001)]), t, 0.5 * (1 - 0.55 * u) * (0.85 + 0.3 * r()));
    dt *= 1.14 + 0.02 * k;
    t += dt;
    k++;
  }
  const spin = mulA(lp(dsp.osc('saw', fromFn(n, (tt) => 408 * Math.pow(0.25, Math.min(1, tt / 0.45))), n), 1500), env(n, [[0, 0], [0.04, 0.8], [0.3, 0.3], [0.46, 0]], 'smooth'));
  addTo(m, spin, 0, 0.05);
  const out = verb(Buf.fromMono(m, 0), 'projector', 0.12, 0);
  return { buf: fin(out, { peak: -11, fadeIn: 0.0005, fadeOut: 0.03 }), send: -40 };
}


// =============================================================================================================
// SAFETY NET for a t < 26 id that recipes_a.mjs did not define when this file was written (cues_extra/coldopen.js adds it).
// The dispatcher prefers recipes_a for t < 26, so this is only used while recipes_a has no 'pencil_scratch'.
// =============================================================================================================
/** pencil_scratch (2.0, dur 1.0, g -7): close-miked graphite strokes on paper: a long compass swing, six quick blade strokes, three triangle strokes; stick-slip grain, tip taps, drifting L to R */
function pencil_scratch(ev, c) {
  const dur = ev.dur ?? 1.0, n = S(dur + 0.15), r = c.rng('pe'), B = new Buf(dur + 0.15);
  const strokes = [[0.0, 0.26, 0.8, 2900]];
  for (let k = 0; k < 6; k++) strokes.push([0.27 + 0.085 * k, 0.062, 0.7 + 0.08 * (k % 3), 3500 + 300 * (k % 2)]);
  [0.74, 0.84, 0.935].forEach((t, k) => strokes.push([t, 0.072, 0.75, 3100 + 250 * k]));
  strokes.forEach(([t0, len, a, fc], k) => {
    const nn = S(len), seed = c.seed('st' + k);
    const base = hp(bp(nz(nn, seed, 0.9), fc * (0.9 + 0.2 * r()), 0.7), 1300);
    const grain = lp(nz(nn, seed + 1, 0.9), 350); // stick-slip: slow-ish random amplitude modulation of the paper fibres
    const gm = fromFn(nn, (t) => 0.55 + 0.45 * Math.tanh(3 * grain[Math.min(nn - 1, Math.round(t * SR))] + 0.3));
    const vel = env(nn, [[0, 0], [len * 0.25, 1], [len * 0.7, 0.8], [len, 0]], 'smooth');
    const x = mulA(mulA(base, gm), vel);
    put(B, x, t0, a * 0.8, -0.35 + 0.7 * (t0 / dur) + (r() - 0.5) * 0.1);
    put(B, mulA(lp(nz(nn, seed + 2, 0.9), 450), vel), t0, a * 0.18, -0.3 + 0.6 * (t0 / dur)); // hand / paper body
    put(B, burst(seed + 3, 0.012, 1800, 0.9, 0.003, 0.0004, 'bp'), t0, 0.28 * a, -0.3 + 0.6 * (t0 / dur)); // pencil tip lands
    put(B, burst(seed + 4, 0.008, 2500, 1, 0.002, 0.0004, 'bp'), t0 + len - 0.004, 0.08 * a, -0.3 + 0.6 * ((t0 + len) / dur)); // lift-off
  });
  void n;
  return { buf: fin(B, { peak: -12, fadeIn: 0.002, fadeOut: 0.1 }), send: -32 };
}


export const META = {
  label_tick: '26 / 28 / ... / 40 (every job downbeat, x8). Tiny glossy glass tick tuned to the bar root (C G A F C G A F, ~A5-G6), warm wooden tock body, 7 kHz air; each tick a touch louder than the last (the energy builds job by job).',
  typewriter_key: '26.0 + 0.125 k (x8). A real typewriter key per word: key lever, type-bar slap on the platen, frame body, metal ping, escapement tick; every key has its own pitch (0.78x-1.2x), velocity and micro-pan, plus a very quiet glass "glow" pip climbing the C-major pentatonic E5 G5 A5 C6 D6 E6 G6 A6 (the letter lights up in the air).',
  typewriter_bell: '27.0. Carriage-return bell: hammer click + small steel cup bell on C7 (two clappers 1.7 Hz apart, inharmonic upper partials 2.76x / 5.4x / 8.9x), cup body, faint carriage ratchet; 0.5 s decay + room.',
  page_fold: '27.25. Paper folding: air-displacing slide (1.4-4.2 kHz sweep), three crease crackles (Poisson fibres), final soft press. Paper band only (>140 Hz).',
  page_snap: '27.5. The bound script snaps shut: stiff card slap, cavity body, spine rattle, tiny upward "locked" glint; low end rolled off so it stays a paper object.',
  panel_snap: '28.25 + 0.125 k (x6). Storyboard panel dealt into the grid: card click, latch tick, wooden knock tuned to a rising G-major ladder G4 B4 D5 G5 B5 D6 (the six panels read as a small ascending run), glass pip an octave up; velocity grows with k.',
  panel_pop_3d: '29.5 (220 ms pre-roll). Panels extrude into 3D: rising air into the pop, 190->55 Hz thump + pneumatic bloop + G1 sub, six staggered extrusion "tuks" fanning L to R, widening depth whoosh, plate.',
  crane_servo: '30.0 (dur 1.0). Crane arm moving: a clear servo whine gliding A4 -> E5 -> A4 with the arm speed (stepper AM), A2 motor hum, gear whirr, hydraulic hiss, unlock click and brake clunk; the image travels L to R.',
  drone_buzz: '30.25 (dur 1.0). Quadcopter fly-by: two rotor pairs near A3 / E4 with beating, blade flutter, Doppler fall, 2.4 kHz electric whine, wind; pans L to R and settles to a hover.',
  viewfinder_on: '31.0. EVF powers on: relay tick, four corner brackets ticking in (L R L R, rising 2.2-4 kHz), power-up chirp, rec-dot blip A6, faint 7.8 kHz whine.',
  focus_beep: '31.5. Autofocus lock: lens-motor zip then a two-note confirm E6 -> A6 (chord tones of Am) with a glass ring.',
  brush_light: '32.0 (dur 0.5). Painting with light: bristle-swish noise arcing across the frame (L to R), glowing F-major shimmer partials, trailing celesta sparkles F-A-C.',
  light_clunk: '32.5 key (g 0, pan -0.4) / 33.0 fill (pan +0.4) / 33.5 rim (g +1, pan 0). Heavy stage-light switch: contactor thump + steel body, second throw + relay chatter, filament "foom", arc buzz, glass-tube ring-out. key = heaviest (62 Hz thump, buzz F2, ring F4), fill = lighter (A2 / A4), rim = crisp and bright with an arc zing (C3 / C6): the three rings stack into an F major triad.',
  foot_tap: '34.25 + 0.25 k (x5). Five icon characters step on their marks: rubber pat + hollow stage knock (112 / 190 / 146 / 128 / 172 Hz by character size), wooden-floor resonances, a quiet marimba "mark" tone C4 E4 G4 A4 C5 and a cartoon blip.',
  cast_ready: '35.5 (160 ms pre-roll). Cast ready: reversed glass glint into a quick harp-like strum of a C major bell chord (C5 E5 G5 C6 E6 G6), warm locked-in pad (C3 G3 C4 E4), glitter, hall bloom.',
  orch_tune: '36.0 (dur 1.0). Orchestra tuning swell on A440: oboe, 2 clarinets, 2 flutes, 7 violins, 2 violas, cellos, basses, 2 horns, 2 trumpets, tuba entering one after another, tuning in from a few cents off (ensemble mean measured 440.9 Hz late), vibrato, crescendo with opening brass; released 35 ms before the baton falls on 37.0, hall tail. Tonal only, no noise bed.',
  baton_whoosh: '37.0 (160 ms pre-roll, big) and 44.0 / 44.5 / 45.0 / 45.5 (ribbon bursts, climbing pitch). Down-stroke swish (8 -> 3 kHz) ending on a dry wood tick exactly at the cue (loudest sample), low thwap, then a descending cascade of glass ribbons on the chord (G B D).',
  timeline_slide: '38.0 (dur 0.25). Timeline panel slides in: friction swish, soft A4 -> A5 digital glide, seating "tok" + rail ticks at +0.24 s.',
  timeline_click: '38.25 + 0.25 k (x6) and 43.5. Shot snaps onto the timeline (30 ms pre-roll zip): crisp click + woody knock on an Am ladder A4 C5 E5 A5 C6 E6 (the 43.5 event uses a C-chord tone), glass pip, velocity growing with k.',
  playhead_zip: '39.75 (lands on 40.0). Playhead zips across: accelerating zipper-tooth ticks, rising swish + glide, L to R, landing "tok" on the downbeat.',
  grade_wipe: '40.0 (dur 1.0). Shimmer sweep: 13 glass voices each climbing an octave chord-tone to chord-tone (F major, Shepard window), tremolo + pan travelling with the wipe L to R, rising band-noise sweep, accelerating glitter; resolves into grade_set.',
  grade_set: '41.0 (70 ms pre-roll). Grade locked / flash: camera-flash pop + F2 sub thump, F-major-add9 glass-bell bloom, warm pad, hall.',
  year_jump: '42.0 / 44.0 / 46.0 (300 ms pre-roll; peaks -5 / -7.5 / -4.5). Reverse whoosh into the cut, bit-crushed digit-roll glitch of chord-tone blips + sample-hold chatter, ratcheting year digits that lock on a tuned pip, sub boom on the bar root (C2 / G1 / A1), forward zoom-out whoosh; 2150 adds a celesta shimmer bloom and a bigger hall. Bass kept mono.',
  holo_hum: '42.0 (dur 2.0). Hologram projector: C-major drone (C3 G3 C4 E4 G4 C5) of beating sines with fast hologram tremolo, a twinkling glassy halo C6 E6 G6 C7, thin 5.2 kHz turbine whine with flicker, data crackle, slow autopan.',
  neural_swell: '44.5 (dur 1.5, crests at 45.94). Synaptic FM-bell pings in G major firing faster and faster (4 -> 60 per s), rising ethereal G pad, upward thought-glide, electric crackle; hands over to the 2150 jump.',
  dream_shimmer: '46.0 (dur 4.0). Granular octave-shimmer clouds of the Am chord (46-48) then F (48-50), grains +0/+12/+24/+36 semitones with 25 % reversed breath grains, density rising, sparse celesta sparkles, slow swell, wide; tail fades into the recap.',
  swell_climax: '48.0 (dur 2.0). Gong / cymbal wash on the cheer, F-major supersaw + choir (ooh -> aah) swell opening from dark to bright, rising glass glide, F1 sub and air; crests at 50.0 and rings out under the riser. Bass kept mono.',
  rewind_texture: '50.0 (dur 4.0). Tape rewind of "the film itself": synthesised programme (formant babble of syllables + the E G A C motif plucks + A drone) played BACKWARDS with an accelerating varispeed (up to 4.4x, pitch sweeping up), reel-motor whine, tape-head chirps, hiss with drop-outs, button clunk at the start, tape-stop that is silent by 53.98 so the logo is clean.',
  riser: '50.0 (dur 4.0). Tonal + noise riser: detuned saw stack gliding A3 -> C6 (arrives on a tone of the coming C major) through an opening lowpass, accelerating 4 -> 28 Hz pulse, band-noise rise, sub swell; released into a plate tail that carries over the logo.',
  push_whoosh: '53.0 (dur 1.0). Push through the screen: air rush rising to the pass-through, F-chord tonal glide F3 -> F5, low swell, soft membrane "pwoomp" at 53.93, air closing behind.',
  logo_resolve: '54.0. Iris blades snap shut (swish + six blade ticks), open in a soft whoosh into a glass-bell C major shimmer (C6 E6 G6 C7 E7) over a warm C3 root, glitter, long hall tail.',
  tagline_tick: '56.0. Letterpress stamp: soft stamp + fine tick + glass ring C6 over A5 (F chord).',
  cta_tick: '57.0. CTA chip: bubble click, two-note pip D6 -> G6 (G chord), short glass ring.',
  impact_big: '58.0 (120 ms pre-roll; peak -3). Final impact designed to sit UNDER the orchestral hit: suck-in, C-rooted sub boom (C1 + G1 + C2 falling from above, overtones for small speakers), knock + crack, dark rumble and a low-passed cathedral tail on everything above 80 Hz; sub dry, bass mono (S/M -17 dB); gone by 60.0.',
  projector_clickoff: '59.5 (0.5 s). Lamp-house switch clunk + relay, arc-lamp fizzle and falling hum, gate / claw spinning down (ticks at 24 /s slowing), 408 Hz motor whine dying; dry, quiet, ends before 60.0.',
  pencil_scratch: '2.0 (t < 26: safety net only, used while recipes_a has no recipe). Close-miked graphite strokes: long compass swing, six quick blade strokes, three triangle strokes, stick-slip grain, tip taps, drifting L to R.',
};

export const recipes = {
  label_tick, typewriter_key, typewriter_bell, page_fold, page_snap, panel_snap, panel_pop_3d, crane_servo, drone_buzz,
  viewfinder_on, focus_beep, brush_light, light_clunk,
  foot_tap, cast_ready, orch_tune, baton_whoosh, timeline_slide, timeline_click, playhead_zip, grade_wipe, grade_set,
  year_jump, holo_hum, neural_swell, dream_shimmer, swell_climax,
  rewind_texture, riser, push_whoosh, logo_resolve, tagline_tick, cta_tick, impact_big, projector_clickoff,
  pencil_scratch,
};
