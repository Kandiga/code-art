// =============================================================================
// audio/sfx/recipes_a.mjs - sound-effect recipes for every cue event with t < 26.0
// (cold open, the nine eras 1895-2025, NOW slam, the turn). All synthesised in code, deterministic (seeded RNG),
// 48 kHz stereo float32. Every recipe LAYERS transient + body + tail + texture and ends clean (no clicks).
//
//   export const recipes  = { id: (ev, ctx) => Buf | {buf, offsetSec, send} }   (contract: see index.mjs)
//   export const kit      small helper toolkit (modal strikes, thumps, sweeps, poisson crackle ...) that
//                         recipes_b.mjs may re-use:   import { kit } from './recipes_a.mjs'
//   export const META     id -> one-line description (written to RECIPES.md by test/make_docs.mjs)
//
// Level philosophy: each recipe is normalised to a deliberate peak (<= -3 dBFS, quiet beds much lower) so the
// relative balance between events is designed here; the dispatcher only applies ev.g / ev.pan.
// Harmony: every pitched element is tuned to the film's key (A minor / C major; chord of the current bar).
// =============================================================================
import * as dsp from '../lib/dsp.mjs';
import * as cues from '../../shared/cues.js';

const { SR, Buf, clamp, dbToLin } = dsp;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------------------------------
// KIT
// ---------------------------------------------------------------------------------------------------------------
/** seconds -> samples (>= 1) */
export const S = (sec) => Math.max(1, Math.round(sec * SR));
export const Z = (n) => new Float32Array(n);
/** build an array by evaluating fn(tSeconds) per sample */
export const fromFn = (n, fn) => {
  const o = Z(n);
  for (let i = 0; i < n; i++) o[i] = fn(i / SR);
  return o;
};
/** exponential approach f1 + (f0-f1) e^{-t/tau}  (pitch-drop curves) */
export const glideExp = (n, f0, f1, tau) => fromFn(n, (t) => f1 + (f0 - f1) * Math.exp(-t / tau));
/** geometric sweep f0 -> f1 with optional shaping of the 0..1 position (pow) */
export const sweep = (n, f0, f1, pow = 1) => {
  const o = Z(n), d = Math.max(1, n - 1);
  for (let i = 0; i < n; i++) o[i] = f0 * Math.pow(f1 / f0, Math.pow(i / d, pow));
  return o;
};
export const sine = (f, n, phase = 0) => dsp.osc('sine', f, n, { phase });
export const nz = (n, seed, rms = 0.3, kind = 'gauss') => dsp.noise(kind, n, seed, { rms });
export const lp = (x, f, q = Math.SQRT1_2) => dsp.biquad(x, 'lp', f, q);
export const hp = (x, f, q = Math.SQRT1_2) => dsp.biquad(x, 'hp', f, q);
export const bp = (x, f, q = 1) => dsp.svf(x, 'bp', f, q);
export const lp4 = (x, f) => dsp.butter(x, 'lp', f, 4);
export const hp4 = (x, f) => dsp.butter(x, 'hp', f, 4);
/** raised-cosine edge fades on a mono array (in place, returns it) */
export const edge = (x, inS = 0.0006, outS = 0.01) => dsp.fade(x, inS, outS, 'cos');
/** mono sum helper: dst += src*g at offset seconds (clips) */
export const addTo = (dst, src, t = 0, g = 1) => dsp.addInPlace(dst, src, Math.round(t * SR), g);
/** per-sample multiply (new array) */
export const mulA = (a, b) => dsp.mul(a, b);
export const scaleA = (a, g) => dsp.scaleArr(a, g);
/** breakpoint curve (seconds, value) with smoothstep interpolation by default */
export const env = (n, pts, mode = 'smooth') => dsp.curve(n, pts, mode);
/** percussive envelope: linear attack a, exponential decay tau */
export const perc = (n, tau, a = 0.001) => dsp.perc(n, { a, tau });

/** sine whose pitch falls exponentially f0 -> f1 (tauF), amplitude e^{-t/tauA}: kicks, thuds, pops, booms */
export function thump(n, f0, f1, tauF, tauA, { a = 0.0015, phase = 0 } = {}) {
  return mulA(sine(glideExp(n, f0, f1, tauF), n, phase), perc(n, tauA, a));
}
/**
 * Modal strike: sum of exponentially decaying sines. parts = [[Hz, amp, tauSeconds, phase?], ...].
 * Bells, glass, metal, wood, tubes. Starts at zero crossing (no click).
 */
export function modal(n, parts) {
  const out = Z(n);
  for (const p of parts) {
    const f = p[0], a = p[1], tau = p[2];
    if (f >= SR * 0.45 || a === 0) continue;
    const w = (TAU * f) / SR, k = Math.exp(-1 / (tau * SR));
    let amp = a, ph = p[3] || 0;
    const lim = Math.min(n, Math.round(tau * SR * 13));
    for (let i = 0; i < lim; i++) {
      out[i] += amp * Math.sin(ph);
      ph += w;
      amp *= k;
    }
  }
  return out;
}
/** Poisson impulse train: rate = Hz (number or array of per-sample rates), amplitude heavy-tailed (fibres, sparks, grit) */
export function poisson(n, rate, rng, { tail = 2, signed = true } = {}) {
  const o = Z(n);
  const ra = typeof rate === 'number' ? null : rate;
  for (let i = 0; i < n; i++) {
    const r = (ra ? ra[i] : rate) / SR;
    if (rng() < r) {
      const a = Math.pow(rng(), tail);
      o[i] = signed ? (rng() < 0.5 ? -a : a) : a;
    }
  }
  return o;
}
/** mono -> stereo Buf with pan (unity centre) */
export const stereo = (x, pan = 0) => Buf.fromMono(x, pan);
/** pseudo-stereo from mono (allpass diffusion; mono-compatible) */
export const wide = (x, amount = 0.8, seed = 1) => dsp.decorrelate(x, { amount, seed });
/** apply a per-sample constant-power pan curve (-1..1) to a mono array -> Buf */
export function panSweep(x, panArr) {
  const n = x.length, L = Z(n), R = Z(n);
  for (let i = 0; i < n; i++) {
    const [gl, gr] = dsp.panGains(panArr[i], true);
    L[i] = x[i] * gl;
    R[i] = x[i] * gr;
  }
  return Buf.from(L, R);
}
/** mid/side width automation: w array (0 mono .. 1 as-is .. 2 wide) */
export function widthEnv(buf, w) {
  const n = buf.length, L = Z(n), R = Z(n);
  for (let i = 0; i < n; i++) {
    const m = 0.5 * (buf.L[i] + buf.R[i]), s = 0.5 * (buf.L[i] - buf.R[i]) * (typeof w === 'number' ? w : w[i]);
    L[i] = m + s;
    R[i] = m - s;
  }
  return Buf.from(L, R);
}
/** mix mono/Buf into a Buf at t seconds with gain and unity-centre pan (clips at the ends) */
export function put(dst, src, t = 0, g = 1, pan = 0) {
  const off = Math.round(t * SR), [gl, gr] = dsp.panGains(pan, true);
  const { L, R } = dst, n = L.length;
  if (dsp.isBuf(src)) {
    for (let i = 0; i < src.length; i++) {
      const j = off + i;
      if (j < 0) continue;
      if (j >= n) break;
      L[j] += src.L[i] * g * gl;
      R[j] += src.R[i] * g * gr;
    }
  } else {
    for (let i = 0; i < src.length; i++) {
      const j = off + i;
      if (j < 0) continue;
      if (j >= n) break;
      const v = src[i] * g;
      L[j] += v * gl;
      R[j] += v * gr;
    }
  }
  return dst;
}
/** reverb wrapper: mono|Buf -> Buf, dry kept, `wet` linear (0.2 ~ -14 dB), `tail` seconds appended */
export function verb(x, preset, wet, tail = 0, o = {}) {
  const src = dsp.isBuf(x) ? x : Buf.fromMono(x);
  return dsp.applyReverb(src, preset, { wet, tail, ...o });
}
/** a Buf of length >= buf; zero-pad to `sec` */
export function padTo(buf, sec) {
  const n = S(sec);
  if (buf.length >= n) return buf;
  return dsp.extend(buf, (n - buf.length) / SR);
}
/** finish: peak-normalise to `peak` dBFS, remove DC, edge fades, scrub NaN. Returns Buf. */
export function fin(buf, { peak = -6, fadeIn = 0.0005, fadeOut = 0.012, dc = true } = {}) {
  if (dc) {
    buf.L.set(dsp.dcBlock(buf.L, 12));
    buf.R.set(dsp.dcBlock(buf.R, 12));
  }
  for (const ch of [buf.L, buf.R]) for (let i = 0; i < ch.length; i++) if (!Number.isFinite(ch[i])) ch[i] = 0;
  dsp.normalizePeak(buf, peak);
  dsp.fade(buf, fadeIn, fadeOut, 'cos');
  return buf;
}
/** raise the average level of a spiky sound: normalise to 0 dBFS then soft-clip the spikes to `ceilDb` (reduces crest by up to |ceilDb| dB) */
export function dense(buf, ceilDb = -8, knee = 0.35) {
  dsp.normalizePeak(buf, 0);
  return dsp.softclip(buf, { ceilingDb: ceilDb, knee });
}
/** pitch-class helpers: Hz of a pitch class (0=C .. 11=B) nearest to a target Hz */
export const PCS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function hzNearPc(pc, nearHz) {
  const m0 = dsp.hzToMidi(nearHz);
  let best = null;
  for (let d = -7; d <= 7; d++) {
    const m = Math.round(m0) + d;
    if (((m % 12) + 12) % 12 === pc && (best === null || Math.abs(m - m0) < Math.abs(best - m0))) best = m;
  }
  return dsp.midiToHz(best);
}
/** chord name at global time t (half-bar aware) */
export function chordAt(t) {
  let ch = cues.chordAtBar(Math.floor((t + 1e-6) / cues.BAR));
  if (Array.isArray(ch)) ch = ch[(t % cues.BAR) >= cues.BEAT * 2 - 1e-6 ? 1 : 0];
  return ch;
}
export const rootPcAt = (t) => PCS[chordAt(t)[0]];
/** sum of mono arrays */
export const sum = (list) => dsp.mixArrays(list);
/** tame random spikes before peak-normalising so a single click does not set the level of the whole sound */
export const tame = (x, ceil = 1) => dsp.softclip(x, { ceilingDb: 20 * Math.log10(ceil), knee: 0.55 });

/** bell / glass / chime strike with tunable partial set. kind: 'glass' | 'bell' | 'celesta' | 'metal' */
export function bellStrike(n, f, { tau = 0.4, kind = 'bell', amp = 1, bright = 1 } = {}) {
  const sets = {
    glass: [[1, 1, 1], [2.756, 0.34, 0.55], [5.404, 0.14, 0.28], [8.933, 0.05, 0.14]],
    bell: [[1, 1, 1], [2.0, 0.42, 0.7], [2.99, 0.28, 0.5], [4.08, 0.17, 0.35], [5.43, 0.1, 0.25]],
    celesta: [[1, 1, 1], [3.0, 0.22, 0.4], [6.1, 0.07, 0.2], [9.2, 0.03, 0.12]],
    metal: [[1, 1, 1], [2.32, 0.6, 0.8], [3.78, 0.45, 0.6], [5.61, 0.3, 0.45], [7.9, 0.2, 0.3]],
  }[kind];
  return modal(n, sets.map(([r, a, t], k) => [f * r, amp * a * (k ? bright : 1), tau * t]));
}

// ---------------------------------------------------------------------------------------------------------------
// COLD OPEN
// ---------------------------------------------------------------------------------------------------------------
/** projector motor: spins up from zero. rotor hum + gear whine, 24 Hz frame rattle (claw ticks + shutter), thunks */
function projector_motor(ev, c) {
  const dur = ev.dur ?? 4, spin = ev.spinUp ?? 2;
  const n = S(dur), r = c.rng('pm');
  const sp = fromFn(n, (t) => {
    const x = clamp(t / spin, 0, 1);
    return x * x * (3 - 2 * x); // S-curve: heavy flywheel, lock-in at `spin`
  });
  // frame phase (cycles at 24 fps) and tick times
  const phi = new Float64Array(n);
  const frames = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const before = Math.floor(acc);
    acc += (24 * sp[i]) / SR;
    phi[i] = acc;
    if (Math.floor(acc) > before) frames.push(i / SR);
  }
  const wob = dsp.drift(n, 0.9, 1, c.seed('wob'));
  // 1) rotor/mains hum: harmonics of A1 scaled by speed (rises up through the pitches from 0)
  const hum = Z(n);
  [[1, 0.45], [2, 1], [3, 0.65], [4, 0.45], [6, 0.22], [8, 0.1]].forEach(([k, w]) => {
    const f = fromFn(n, (t) => 55 * k * sp[Math.round(t * SR)] * (1 + 0.004 * wob[Math.round(t * SR)]));
    addTo(hum, scaleA(sine(f, n), w));
  });
  const humS = lp(dsp.waveshape(hum, 'tanh', 1.6, { comp: true }), 1100);
  for (let i = 0; i < n; i++) humS[i] *= Math.pow(sp[i], 1.15);
  // 2) gear whine (24 fps x 17 teeth ~ 408 Hz at speed) L/R slightly detuned -> slow phasing
  const whineL = lp(dsp.osc('tri', scaleA(sp, 408 * 1.0015), n), 2200);
  const whineR = lp(dsp.osc('tri', scaleA(sp, 408 * 0.9985), n), 2200);
  const wAmp = fromFn(n, (t) => 0.1 * Math.pow(sp[Math.round(t * SR)], 2));
  // 3) rattle bed: band noise AM'd at the frame rate (film flutter), louder with speed
  const rb = bp(nz(n, c.seed('rb'), 0.5), 1150, 1.3);
  const rbAm = Z(n);
  for (let i = 0; i < n; i++) {
    const a = 0.5 + 0.5 * Math.cos(TAU * phi[i]);
    rbAm[i] = (0.2 + 0.8 * a * a) * 0.32 * Math.pow(sp[i], 1.5);
  }
  const rattleBed = mulA(rb, rbAm);
  // shutter flicker: soft 48 Hz pulsing of a low band (the two-blade shutter)
  const sh = bp(nz(n, c.seed('sh'), 0.5), 420, 1.1);
  const shAm = fromFn(n, (t) => 0.14 * Math.pow(sp[Math.round(t * SR)], 1.4) * (0.5 + 0.5 * Math.cos(TAU * 2 * phi[Math.round(t * SR)])));
  const flick = mulA(sh, shAm);
  // 4) claw ticks: pre-built variants, placed on the frame grid with human-ish jitter
  const mkTick = (seed) => {
    const rr = dsp.mulberry32(seed), m = S(0.07);
    const body = modal(m, [[880 + rr() * 220, 0.7, 0.0055], [1700 + rr() * 500, 0.5, 0.0032], [3100 + rr() * 900, 0.3, 0.002], [165 + rr() * 30, 0.7, 0.013]]);
    const click = mulA(hp(nz(m, seed + 7, 0.8), 2600), perc(m, 0.0007, 0.0001));
    return sum([body, scaleA(click, 0.7)]);
  };
  const ticks = [1, 2, 3, 4, 5].map((k) => mkTick(c.seed('tick' + k)));
  const bed = Z(n);
  for (const tk of frames) {
    const s = sp[Math.min(n - 1, Math.round(tk * SR))];
    const a = (0.16 + 0.84 * Math.pow(s, 0.8)) * (0.75 + 0.5 * r());
    addTo(bed, ticks[r.int(ticks.length)], tk + (r() - 0.5) * 0.0015, a * 0.55);
    addTo(bed, lp(ticks[r.int(ticks.length)], 1500), tk + 0.45 / 24 / Math.max(0.2, s), a * 0.2); // shutter flap
  }
  // 5) mechanical thunks: start relay, belt/clutch, gear mesh, lock-in
  const thunk = (seed, f) => {
    const m = S(0.18);
    return sum([modal(m, [[f, 1, 0.05], [f * 2.2, 0.7, 0.035], [f * 4.5, 0.4, 0.02], [f * 11, 0.22, 0.012]]), scaleA(mulA(lp(nz(m, seed, 0.6), 2200), perc(m, 0.012, 0.0005)), 0.5)]);
  };
  addTo(bed, thunk(c.seed('t0'), 92), 0.03, 1.0);
  addTo(bed, thunk(c.seed('t1'), 120), 0.42, 0.35);
  addTo(bed, thunk(c.seed('t2'), 105), spin * 0.55, 0.42);
  addTo(bed, thunk(c.seed('t3'), 88), spin, 0.6);
  // mix + master envelope (fades out toward the cut to the 1895 era)
  const mono = sum([scaleA(humS, 0.9), rattleBed, flick, bed]);
  const stL = sum([mono, mulA(whineL, wAmp)]), stR = sum([mono, mulA(whineR, wAmp)]);
  const w = wide(mono, 0.4, c.seed('w'));
  const L = Z(n), R = Z(n);
  for (let i = 0; i < n; i++) {
    L[i] = 0.55 * stL[i] + 0.45 * w.L[i];
    R[i] = 0.55 * stR[i] + 0.45 * w.R[i];
  }
  const m2 = env(n, [[0, 1], [dur - 0.6, 1], [dur - 0.04, 0]], 'cos');
  for (let i = 0; i < n; i++) { L[i] *= m2[i]; R[i] *= m2[i]; }
  const out = verb(Buf.from(L, R), 'projector', 0.3, 0);
  return { buf: fin(out, { peak: -13, fadeOut: 0.03 }), send: -24 };
}

/** lamp ignite: relay thunk + arc strike crackle + carbon-arc buzz settling + glass tube ring */
function lamp_ignite(ev, c) {
  const n = S(2.0), r = c.rng('li');
  // thunk
  const th = sum([thump(S(0.4), 130, 62, 0.03, 0.07), modal(S(0.4), [[310, 0.6, 0.035], [740, 0.45, 0.022], [1480, 0.3, 0.012], [2950, 0.2, 0.006]]),
    scaleA(mulA(hp(nz(S(0.4), c.seed('c'), 0.8), 1800), perc(S(0.4), 0.0012, 0.0001)), 0.6)]);
  // 'fwoomp' of the arc catching
  const fw = mulA(lp(nz(n, c.seed('fw'), 0.8), 650), env(n, [[0, 0], [0.04, 1], [0.28, 0.2], [0.8, 0]], 'smooth'));
  // arc crackle (sparse sparks) that thins out over 0.6 s
  const rate = fromFn(n, (t) => 14 + 700 * Math.exp(-t / 0.16));
  const sparks = bp(poisson(n, rate, r, { tail: 2.5 }), 3200, 0.8);
  const crackle = sum([sparks, bp(poisson(n, scaleA(rate, 0.6), r, { tail: 3 }), 5800, 1.2)]);
  // buzz: 110 Hz (A2) saw, jittered, rectified AM; decays into the beam hum
  const jit = dsp.drift(n, 14, 1, c.seed('jit'));
  const fb = fromFn(n, (t) => 110 * (1 + 0.012 * jit[Math.round(t * SR)] * (1 + 3 * Math.exp(-t / 0.2))));
  const buzz = lp(dsp.waveshape(dsp.osc('saw', fb, n), 'tanh', 2.2), 2600);
  const buzzEnv = env(n, [[0.02, 0], [0.05, 0.9], [0.5, 0.3], [1.1, 0.17], [1.95, 0]], 'smooth');
  const hiss = mulA(hp(nz(n, c.seed('hs'), 0.4), 3500), fromFn(n, (t) => 0.5 + 0.5 * Math.cos(TAU * 110 * t)));
  const arc = sum([mulA(buzz, buzzEnv), mulA(hiss, scaleA(buzzEnv, 0.22))]);
  // glass/tube ring: detuned pairs beat slowly -> shimmer
  const ringL = modal(n, [[1865, 0.5, 0.9], [2948, 0.32, 0.6], [4420, 0.2, 0.45], [6100, 0.1, 0.3]]);
  const ringR = modal(n, [[1869, 0.5, 0.9], [2943, 0.32, 0.6], [4428, 0.2, 0.45], [6092, 0.1, 0.3]]);
  const ringEnv = env(n, [[0, 0], [0.025, 1], [1.9, 0]], 'smooth');
  const m = Z(n);
  addTo(m, th, 0, 1.0);
  addTo(m, fw, 0, 0.5);
  const monoBed = sum([m, scaleA(crackle, 0.9), scaleA(arc, 0.55)]);
  const w = wide(monoBed, 0.55, c.seed('w'));
  const L = Z(n), R = Z(n);
  for (let i = 0; i < n; i++) {
    L[i] = w.L[i] + 0.1 * ringL[i] * ringEnv[i];
    R[i] = w.R[i] + 0.1 * ringR[i] * ringEnv[i];
  }
  const out = verb(Buf.from(L, R), 'room', 0.28, 0.4);
  return { buf: fin(out, { peak: -8, fadeOut: 0.15 }), send: -22 };
}

/** beam hum: warm tuned hum (A harmonics, no major-3rd partial), breathing, with dust ticks; widens at the end */
function beam_hum(ev, c) {
  const dur = ev.dur ?? 3, n = S(dur), r = c.rng('bh');
  const fi = Math.min(0.45, dur * 0.35), fo = Math.min(0.5, dur * 0.4), br = Math.min(0.8, dur * 0.5);
  const breathe = dsp.lfo('sine', 0.37, n, { min: 0.82, max: 1.0, phase: 0.2 });
  const L = Z(n), R = Z(n);
  const H = [[1, 0.5], [2, 1], [3, 0.7], [4, 0.55], [6, 0.3], [7, 0.12], [8, 0.18]]; // no 5th harmonic (C#)
  H.forEach(([k, w], j) => {
    const dt = 0.35 * (j % 3 + 1) * (k > 3 ? 1.6 : 1) / 110 * 55; // beat rate grows with partial
    const a = sine(55 * k - dt * 0.5, n, r()), b = sine(55 * k + dt * 0.5, n, r());
    addTo(L, scaleA(a, w), 0, 0.7);
    addTo(R, scaleA(b, w), 0, 0.7);
    addTo(L, scaleA(b, w), 0, 0.3);
    addTo(R, scaleA(a, w), 0, 0.3);
  });
  // lamp whine (thin, slowly wandering) + air
  const wh = dsp.drift(n, 0.5, 1, c.seed('wh'));
  const whine = mulA(sine(fromFn(n, (t) => 3150 * (1 + 0.004 * wh[Math.round(t * SR)])), n), env(n, [[0, 0], [fi, 0.025], [dur - fo, 0.03], [dur, 0]], 'smooth'));
  // dust motes in the beam: very quiet sparse ticks, a touch of air
  const dust = hp(bp(poisson(n, 11, r, { tail: 3 }), 6800, 1.5), 4000);
  const air = mulA(bp(nz(n, c.seed('air'), 0.4), 5200, 0.7), env(n, [[0, 0], [br, 0.012], [dur - fo, 0.014], [dur, 0.03]], 'smooth'));
  // brightening as the beam widens (last 0.6 s)
  const bright = mulA(lp(hp(sine(fromFn(n, () => 220), n, 0.1), 100), 800), env(n, [[0, 0], [dur - br, 0], [dur - 0.1 * Math.min(1, dur / 2), 0.35], [dur, 0.35]], 'smooth'));
  const satL = dsp.waveshape(L, 'tanh', 2.2, { comp: true }), satR = dsp.waveshape(R, 'tanh', 2.2, { comp: true });
  for (let i = 0; i < n; i++) { L[i] = L[i] * 0.75 + satL[i] * 0.25; R[i] = R[i] * 0.75 + satR[i] * 0.25; }
  for (let i = 0; i < n; i++) {
    L[i] = (L[i] * 0.4 + 0.05 * whine[i] + 0.5 * dust[i] + air[i] + bright[i] * 0.18) * breathe[i];
    R[i] = (R[i] * 0.4 + 0.05 * whine[i] + 0.5 * dust[i] * 0.8 + air[i] + bright[i] * 0.18) * breathe[i];
  }
  const g = env(n, [[0, 0], [fi, 1], [dur - fo, 1], [dur, 0]], 'smooth');
  for (let i = 0; i < n; i++) { L[i] *= g[i]; R[i] *= g[i]; }
  const out = verb(Buf.from(L, R), 'room', 0.18, 0);
  return { buf: fin(out, { peak: -21, fadeIn: 0.01, fadeOut: 0.05 }), send: -30 };
}

/** eyes open: two soft glass pops (L then R) + a tinkle cascade of tiny glass pings in A minor (E6 first = piano E4 x4) */
function eyes_open(ev, c) {
  const n = S(2.0), r = c.rng('eo'), m = new Buf(2.5);
  const pop = (f0, f1, pan, t, g) => {
    const x = sum([thump(S(0.12), f0, f1, 0.012, 0.022, { a: 0.0018 }), scaleA(mulA(hp(nz(S(0.12), c.seed('p' + t), 0.5), 2500), perc(S(0.12), 0.0006, 0.0001)), 0.22),
      scaleA(thump(S(0.2), f0 * 2, f1 * 2, 0.01, 0.03), 0.25)]);
    put(m, edge(x, 0.001, 0.02), t, g, pan);
  };
  pop(960, 400, -0.35, 0.0, 1.0);
  pop(1080, 450, 0.35, 0.07, 0.85);
  const notes = [1318.5, 1568, 1760, 2093, 1318.5 * 2, 1760 * 1.5 * 0 + 1568, 2093, 2637, 3136];
  let t = 0.1;
  notes.forEach((f, i) => {
    t += 0.045 + 0.05 * r();
    const tau = 0.55 - i * 0.03;
    const x = bellStrike(S(1.6), f, { tau, kind: 'glass', amp: 0.28 * Math.pow(0.9, i), bright: 1 });
    put(m, edge(x, 0.0004, 0.05), t, 1, (r() * 2 - 1) * 0.7);
  });
  // breath of air as the lids lift
  const air = mulA(bp(nz(n, c.seed('air'), 0.5), 5200, 0.8), env(n, [[0, 0], [0.12, 0.05], [0.5, 0]], 'smooth'));
  put(m, wide(air, 1, c.seed('aw')), 0.03, 1, 0);
  const out = verb(m, 'plate', 0.4, 0.5);
  return { buf: fin(out, { peak: -12, fadeOut: 0.5 }), send: -26 };
}

/** short riser into a downbeat: noise sweep + C4->C5 detuned saws (C fits Am and F) + reverse-cymbal air; ends clean */
function riser_short(ev, c) {
  const dur = ev.dur ?? 0.5, n = S(dur), tailN = S(dur + 0.02);
  const f = sweep(tailN, 261.63, 523.25, 1.0);
  const sawA = dsp.osc('saw', scaleA(f, 0.9965), tailN), sawB = dsp.osc('saw', scaleA(f, 1.0035), tailN);
  const cut = sweep(tailN, 500, 7200, 1.2);
  const toneL = dsp.svf(sawA, 'lp', cut, 1.2), toneR = dsp.svf(sawB, 'lp', cut, 1.2);
  const nA = bp(nz(tailN, c.seed('a'), 0.6), sweep(tailN, 400, 9000, 1.1), 1.4), nB = bp(nz(tailN, c.seed('b'), 0.6), sweep(tailN, 420, 9400, 1.1), 1.4);
  const rev = hp(nz(tailN, c.seed('rev'), 0.5), 5500);
  const gE = fromFn(tailN, (t) => (t < dur ? Math.pow(t / dur, 1.8) : 0));
  const gR = fromFn(tailN, (t) => (t < dur ? Math.pow(t / dur, 3.2) : 0));
  const L = Z(tailN), R = Z(tailN);
  for (let i = 0; i < tailN; i++) {
    L[i] = (toneL[i] * 0.5 + nA[i] * 0.9) * gE[i] + rev[i] * 0.35 * gR[i];
    R[i] = (toneR[i] * 0.5 + nB[i] * 0.9) * gE[i] + rev[i] * 0.35 * gR[i] * 0.9;
  }
  // end exactly at the downbeat: 6 ms cut-off
  const b = Buf.from(L, R);
  const out = fin(b, { peak: -10, fadeIn: 0.004, fadeOut: 0.006 });
  return { buf: out, send: -20 };
}

// ---------------------------------------------------------------------------------------------------------------
// ERA TRANSITIONS
// ---------------------------------------------------------------------------------------------------------------
/** aspect-ratio matte bars slide in: soft felt thunk on the downbeat + 0.2 s slide scrape + tiny seat tock at 0.25 s */
function matte_slide(ev, c) {
  const era = cues.ERAS.find((e) => Math.abs(e.t0 - ev.t) < 1e-6);
  const dR = era ? era.ratio - era.prevRatio : 0; // + = wider (letterbox bars), - = narrower (pillar bars)
  const amt = clamp(0.4 + Math.abs(dR) / 0.5, 0.4, 1);
  const f0 = clamp(96 - 36 * Math.sign(dR) * Math.min(1, Math.abs(dR) / 0.5), 55, 140);
  const n = S(0.7), r = c.rng('ms'), m = Z(n);
  const th = sum([thump(S(0.3), f0 * 1.5, f0, 0.02, 0.06 + 0.04 * amt), scaleA(mulA(lp(nz(S(0.3), c.seed('n'), 0.6), 700), perc(S(0.3), 0.018, 0.001)), 0.5),
    modal(S(0.3), [[f0 * 3.1, 0.3, 0.03], [f0 * 5.7, 0.15, 0.02]])]);
  addTo(m, th, 0, 1.0);
  // slide scrape: felt on wood, band-limited noise sweeping down (bars moving), bell-shaped
  const sl = S(0.26), slF = sweep(sl, dR >= 0 ? 700 : 1500, dR >= 0 ? 1500 : 520, 1);
  const scrape = mulA(bp(nz(sl, c.seed('s'), 0.6), slF, 1.1), env(sl, [[0, 0], [0.08, 0.5], [0.15, 0.4], [0.26, 0]], 'smooth'));
  addTo(m, scrape, 0.0, 0.5 * amt);
  // seat tock when the bars land
  addTo(m, sum([thump(S(0.2), f0 * 1.9, f0 * 1.25, 0.012, 0.035), scaleA(mulA(hp(nz(S(0.2), c.seed('k'), 0.5), 1500), perc(S(0.2), 0.001, 0.0002)), 0.3)]), 0.25, 0.32 * amt);
  const L = wide(m, 0.5, c.seed('w'));
  void r;
  return { buf: fin(L, { peak: -9, fadeOut: 0.06 }), send: -22 };
}

/** camera iris-in click: metal click + blade shhk + tiny low tick */
function iris_click(ev, c) {
  const n = S(0.5);
  const click = modal(n, [[820, 1, 0.012], [1650, 0.6, 0.008], [3400, 0.4, 0.005], [5300, 0.2, 0.003]]);
  const tick = mulA(hp(nz(n, c.seed('t'), 0.8), 3200), perc(n, 0.0009, 0.0001));
  const low = thump(n, 240, 150, 0.01, 0.022);
  const shk = mulA(bp(nz(n, c.seed('s'), 0.6), sweep(n, 5200, 1900, 1), 0.9), env(n, [[0.012, 0], [0.025, 0.4], [0.075, 0]], 'smooth'));
  const mono = sum([click, scaleA(tick, 0.8), scaleA(low, 0.5), shk]);
  const out = verb(wide(mono, 0.4, c.seed('w')), 'room', 0.2, 0.25);
  return { buf: fin(out, { peak: -10, fadeOut: 0.1 }), send: -26 };
}

/** dive into the portal: pitch-rising air + tonal swoosh that glides up to a chord tone of the NEXT bar; builds each era */
function dive_whoosh(ev, c) {
  const dur = ev.dur ?? 0.5, tail = 0.07, N = S(dur + tail), n = S(dur);
  const idx = Math.max(0, cues.ERAS.findIndex((e) => Math.abs(e.diveT0 - ev.t) < 1e-6));
  const k = idx / 7; // 0..1 across the eras: later dives are bigger
  const x = (i) => Math.min(1, i / n);
  const aE = fromFn(N, (t) => (t < dur ? Math.pow(t / dur, 1.5) : Math.pow(1 - (t - dur) / tail, 2)));
  const fN = fromFn(N, (t) => 380 * Math.pow(5500 / 380, Math.pow(Math.min(1, t / dur), 1.15)) * (1 + 0.35 * k));
  const qN = fromFn(N, (t) => 1.8 + 1.4 * Math.min(1, t / dur));
  const nL = mulA(dsp.svf(nz(N, c.seed('L'), 0.6), 'bp', fN, qN), aE), nR = mulA(dsp.svf(nz(N, c.seed('R'), 0.6), 'bp', fN, qN), aE);
  // tonal swoosh: glides up two octaves to the 5th of the next bar's chord
  const fEnd = hzNearPc((rootPcAt(ev.t + dur + 0.01) + 7) % 12, 1300);
  const fT = fromFn(N, (t) => (fEnd / 4) * Math.pow(4, Math.pow(Math.min(1, t / dur), 1.6)));
  const vib = dsp.lfo('sine', 6.5, N, { min: -1, max: 1 });
  const fTv = Z(N);
  for (let i = 0; i < N; i++) fTv[i] = fT[i] * (1 + 0.004 * vib[i]);
  const tone = sum([sine(fTv, N), scaleA(dsp.osc('tri', scaleA(fTv, 2.003), N), 0.25)]);
  const toneA = mulA(lp(tone, 4800), fromFn(N, (t) => (t < dur ? Math.pow(t / dur, 2.4) : Math.pow(1 - (t - dur) / tail, 2))));
  // pressure swell (low) toward the end
  const pr = mulA(lp(nz(N, c.seed('pr'), 0.7), 160), fromFn(N, (t) => (t < dur ? Math.pow(t / dur, 3) : 0)));
  const L = Z(N), R = Z(N);
  const gt = 0.16 + 0.1 * k;
  for (let i = 0; i < N; i++) {
    L[i] = nL[i] * 1.0 + toneA[i] * gt + pr[i] * 0.5;
    R[i] = nR[i] * 1.0 + toneA[i] * gt + pr[i] * 0.5;
  }
  void x;
  const out = fin(Buf.from(L, R), { peak: -10 + 2 * k, fadeIn: 0.004, fadeOut: 0.025 });
  return { buf: out, send: -20 };
}

// ---------------------------------------------------------------------------------------------------------------
// 1895
// ---------------------------------------------------------------------------------------------------------------
/** hand-crank camera loop: wooden ratchet ticks at ~16/s with a heavier clack every revolution, human tempo drift */
function crank_loop(ev, c) {
  const dur = ev.dur ?? 1.5, n = S(dur + 0.1), r = c.rng('cr');
  const drift = dsp.drift(n, 1.3, 1, c.seed('d'));
  // revolution phase: ~2 rev/s with a starting acceleration
  let rev = 0;
  const hits = [];
  let lastTick = -1;
  const perRev = 8;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const spd = 2.05 * (1 + 0.1 * drift[i]) * Math.min(1, 0.45 + t / 0.25);
    rev += spd / SR;
    const k = Math.floor(rev * perRev);
    if (k > lastTick) {
      lastTick = k;
      hits.push({ t: t + (r() - 0.5) * 0.006, accent: k % perRev === 0 });
    }
  }
  const mkTick = (seed, f) => {
    const rr = dsp.mulberry32(seed), m = S(0.09);
    const body = modal(m, [[f * (0.95 + 0.1 * rr()), 0.8, 0.007], [f * 2.6, 0.5, 0.004], [f * 5.5, 0.3, 0.0025], [3100 + rr() * 900, 0.25, 0.002]]);
    const click = mulA(hp(nz(m, seed + 3, 0.8), 2200), perc(m, 0.0006, 0.0001));
    return sum([body, scaleA(click, 0.6)]);
  };
  const tk = [1, 2, 3, 4].map((k) => mkTick(c.seed('t' + k), 520));
  const clack = [1, 2].map((k) => sum([mkTick(c.seed('c' + k), 300), thump(S(0.09), 190, 110, 0.01, 0.02), modal(S(0.09), [[640, 0.7, 0.02], [1180, 0.45, 0.012]])]));
  const m = Z(n);
  hits.forEach((h) => {
    const a = h.accent ? 0.85 + 0.2 * r() : 0.3 + 0.55 * r();
    const v = h.accent ? clack[r.int(2)] : tk[r.int(4)];
    addTo(m, r() < 0.3 ? lp(v, 1800 + 3000 * r()) : v, Math.max(0, h.t), a);
  });
  // gear whirr: soft band noise modulated at tick rate; wooden box resonance
  const whirr = mulA(bp(nz(n, c.seed('w'), 0.5), 2300, 1.5), fromFn(n, (t) => 0.05 * (0.5 + 0.5 * Math.sin(TAU * 16 * t))));
  let mono = sum([m, whirr]);
  mono = dsp.biquad(mono, 'peak', 460, 2.5, 4);
  const gE = env(n, [[0, 0.7], [0.1, 1], [dur - 0.12, 1], [dur + 0.1, 0]], 'smooth');
  mono = mulA(mono, gE);
  const out = dense(verb(wide(mono, 0.3, c.seed('w2')), 'room', 0.18, 0.3), -10);
  return { buf: fin(out, { peak: -12, fadeOut: 0.08 }), send: -26 };
}

/** steam loco chuffs, head-on: accelerating 4-stroke chuffs, crescendo, opening filter, rail rumble */
function train_chuff(ev, c) {
  const dur = ev.dur ?? 1.25, n = S(dur + 0.5), r = c.rng('tc');
  const pat = [1.0, 0.45, 0.7, 0.4]; // strong, weak, medium, weak
  const chuffs = [];
  let t = 0.02, k = 0;
  while (t < dur) {
    const u = t / dur;
    const rate = 3.4 + 5.2 * u * u; // chuffs per second, accelerating as it arrives
    chuffs.push({ t, u, a: pat[k % 4] });
    t += (1 / rate) * (1 + (r() - 0.5) * 0.06);
    k++;
  }
  const m = new Buf(dur + 0.5);
  chuffs.forEach((h, i) => {
    const amp = (0.26 + 0.74 * Math.pow(h.u, 1.3)) * (0.55 + 0.45 * h.a);
    const len = S(0.34), body = lp(nz(len, c.seed('ch' + i), 0.8), 600 + 3600 * h.u);
    const steam = bp(nz(len, c.seed('st' + i), 0.8), 900 + 1400 * h.u, 0.7);
    const env1 = perc(len, 0.05 + 0.03 * h.a, 0.004);
    const x = sum([mulA(body, env1), scaleA(mulA(steam, perc(len, 0.075, 0.003)), 0.55), scaleA(mulA(hp(nz(len, c.seed('hs' + i), 0.6), 3200), perc(len, 0.13, 0.01)), 0.18 * h.u),
      scaleA(thump(len, 90, 58, 0.03, 0.06), 0.7 * h.a)]);
    put(m, wide(x, 0.6, c.seed('w' + i)), h.t, amp * 1.2, (r() - 0.5) * 0.35);
  });
  // wheel / rail rumble swelling with the approach + joint clacks
  const rum = mulA(lp(nz(n, c.seed('rum'), 0.8, 'brown'), 130), fromFn(n, (t) => (0.1 + 0.9 * Math.pow(Math.min(1, t / dur), 2.2)) * (t < dur ? 1 : Math.exp(-(t - dur) / 0.12))));
  const clk = Z(n);
  for (let tt = 0.1; tt < dur; tt += 0.16 * (1 - 0.55 * (tt / dur))) {
    addTo(clk, sum([modal(S(0.06), [[420, 0.7, 0.008], [980, 0.5, 0.005], [2100, 0.3, 0.003]])]), tt, 0.3 * Math.pow(tt / dur, 1.3) * (0.7 + 0.6 * r()));
  }
  put(m, rum, 0, 0.45, 0);
  put(m, clk, 0, 0.25, 0);
  const out = dense(verb(m, 'chamber', 0.2, 0.4), -7);
  return { buf: fin(out, { peak: -8, fadeOut: 0.2 }), send: -24 };
}

/** steam whistle blast: Am triad (A4 C5 E5), steam-open pitch overshoot, breath noise, release droop, hall tail */
function train_whistle(ev, c) {
  const dur = ev.dur ?? 1.05, n = S(dur + 0.9), r = c.rng('tw');
  const blast = dur - 0.3;
  const aEnv = fromFn(n, (t) => {
    if (t < 0.06) return 0.5 * (1 - Math.cos((Math.PI * t) / 0.06));
    if (t < blast) return 1 - 0.05 * (t / blast);
    return Math.exp(-(t - blast) / 0.13) * 0.95;
  });
  const pitchMul = fromFn(n, (t) => {
    const open = t < 0.1 ? 1 - 0.035 * Math.exp(-t / 0.03) : 1 - 0.0 * t;
    const rel = t > blast ? 1 - 0.05 * (1 - Math.exp(-(t - blast) / 0.2)) : 1;
    return open * rel;
  });
  const trem = dsp.lfo('sine', 5.2, n, { min: 0.95, max: 1.0 });
  const notes = [[440, 1.0, -0.3], [523.25, 0.85, 0.0], [659.26, 0.7, 0.3]];
  const m = new Buf(dur + 0.9);
  notes.forEach(([f, g, pan], j) => {
    const fa = scaleA(pitchMul, f);
    const t1 = sine(fa, n, r()), t2 = scaleA(sine(scaleA(fa, 2.003), n, r()), 0.32), t3 = scaleA(sine(scaleA(fa, 3.01), n, r()), 0.12);
    const breath = scaleA(dsp.svf(nz(n, c.seed('b' + j), 0.6), 'bp', fa, 14), 0.5);
    put(m, wide(mulA(mulA(sum([t1, t2, t3, breath]), aEnv), trem), 0.3, c.seed('w' + j)), 0, g * 0.5, pan);
  });
  const hiss = mulA(hp(nz(n, c.seed('hs'), 0.6), 3500), fromFn(n, (t) => 0.1 * Math.exp(-t / 0.22) + (t > blast ? 0.1 * Math.exp(-(t - blast) / 0.2) : 0.02)));
  put(m, wide(hiss, 1, c.seed('hw')), 0, 0.6, 0);
  m.L.set(lp(m.L, 6500));
  m.R.set(lp(m.R, 6500));
  const out = verb(m, 'hall', 0.28, 0.4);
  return { buf: fin(out, { peak: -10, fadeOut: 0.3 }), send: -26 };
}

// ---------------------------------------------------------------------------------------------------------------
// 1902
// ---------------------------------------------------------------------------------------------------------------
/** theatre curtain opening: heavy velvet swell with ruffle, rail rings sliding apart, widening image */
function curtain_swish(ev, c) {
  const n = S(1.6), r = c.rng('cs');
  const dur = 1.0;
  const bed = (seed) => {
    let x = bp(nz(n, seed, 0.8), 650, 0.55);
    x = lp(hp(x, 170), 2100);
    const ruf = lp(nz(n, seed + 5, 1), 30);
    const am = Z(n);
    for (let i = 0; i < n; i++) am[i] = clamp(0.62 + 1.9 * ruf[i], 0.05, 1.4);
    return mulA(x, am);
  };
  const swell = env(n, [[0, 0], [0.4, 0.8], [0.62, 1], [1.1, 0.25], [1.5, 0]], 'smooth');
  const A = mulA(bed(c.seed('a')), swell), B = mulA(bed(c.seed('b')), swell);
  const width = env(n, [[0, 0.1], [0.6, 0.85], [1.5, 0.9]], 'smooth');
  const M = sum([A, B]), Sd = sub(A, B);
  const L = Z(n), R = Z(n);
  for (let i = 0; i < n; i++) {
    L[i] = 0.5 * M[i] + 0.5 * Sd[i] * width[i];
    R[i] = 0.5 * M[i] - 0.5 * Sd[i] * width[i];
  }
  const m = new Buf(1.6);
  m.L.set(L);
  m.R.set(R);
  // rings on the rod: a scatter of tiny metallic ticks, bursty, spreading outward
  const nr = 26;
  for (let i = 0; i < nr; i++) {
    const u = i / (nr - 1);
    const tt = 0.06 + 0.8 * Math.pow(u, 0.9) + (r() - 0.5) * 0.02;
    const f = 1700 + 1900 * r();
    const x = modal(S(0.08), [[f, 0.7, 0.006], [f * 1.9, 0.45, 0.0035], [f * 3.1, 0.2, 0.002], [620 + 200 * r(), 0.4, 0.012]]);
    const pan = (i % 2 ? 1 : -1) * Math.pow(u, 0.7) * (0.35 + 0.6 * r());
    put(m, mulA(x, perc(S(0.08), 0.012, 0.0004)), tt, 0.13 * (0.6 + 0.8 * r()) * (0.5 + 0.5 * Math.sin(Math.PI * u)), pan);
  }
  // low whump of the heavy cloth moving
  put(m, mulA(lp(nz(n, c.seed('lw'), 0.8), 140), env(n, [[0, 0], [0.3, 0.5], [0.7, 0.2], [1.2, 0]], 'smooth')), 0, 0.35, 0);
  const out = verb(m, 'room', 0.22, 0.4);
  void dur;
  return { buf: fin(out, { peak: -12, fadeOut: 0.2 }), send: -22 };
}
const sub = (a, b) => {
  const o = Z(a.length);
  for (let i = 0; i < a.length; i++) o[i] = a[i] - b[i];
  return o;
};

/** magic poof: smoke puff (lp noise burst sweeping down) + soft whump + cartoon 'bloop' + fading powder sizzle */
function magic_poof(ev, c) {
  const n = S(1.6), r = c.rng('mp');
  const puffN = nz(n, c.seed('p'), 0.8);
  const puff = mulA(dsp.svf(puffN, 'lp', glideExp(n, 3800, 520, 0.12), 0.8), perc(n, 0.15, 0.004));
  const air = mulA(hp(nz(n, c.seed('a'), 0.7), 2200), perc(n, 0.07, 0.003));
  const whump = thump(n, 120, 44, 0.04, 0.09);
  const bloop = mulA(sine(glideExp(n, 560, 250, 0.03), n), perc(n, 0.06, 0.003));
  const rate = fromFn(n, (t) => 20 + 260 * Math.exp(-t / 0.35));
  const fizz = bp(poisson(n, rate, r, { tail: 2.5 }), 5200, 0.7);
  const mono = sum([puff, scaleA(air, 0.45), scaleA(whump, 0.9), scaleA(bloop, 0.22), scaleA(fizz, 0.5)]);
  const w = wide(mono, 0.7, c.seed('w'));
  const out = verb(w, 'plate', 0.18, 0.35);
  return { buf: fin(out, { peak: -9, fadeOut: 0.3 }), send: -22 };
}

/** rising sparkle: accelerating ascending glass pings through an F major 7 ladder, glitter dust, shimmering tail */
function sparkle_up(ev, c) {
  const n = S(2.4), r = c.rng('sp');
  const lad = [698.46, 880, 1046.5, 1318.5, 1396.9, 1760, 2093, 2637, 2793.8, 3520];
  const m = new Buf(2.4);
  lad.forEach((f, i) => {
    const u = i / (lad.length - 1);
    const tt = 0.62 * Math.pow(u, 0.85) + (r() - 0.5) * 0.012;
    const x = bellStrike(S(1.5), f, { tau: 0.4 - 0.15 * u, kind: 'celesta', amp: 0.4 + 0.5 * u, bright: 1 });
    put(m, edge(x, 0.0004, 0.05), tt, 1, (r() * 2 - 1) * 0.7);
    if (i > 5) put(m, edge(bellStrike(S(1.2), f * 1.5, { tau: 0.22, kind: 'glass', amp: 0.25 }), 0.0004, 0.04), tt + 0.02, 0.5, (r() * 2 - 1) * 0.9);
  });
  const rate = fromFn(n, (t) => 140 * Math.pow(Math.min(1, t / 0.7), 1.2) * Math.exp(-Math.max(0, t - 0.7) / 0.6));
  const glit = hp(bp(poisson(n, rate, r, { tail: 2 }), 7500, 1.0), 5000);
  put(m, wide(glit, 1, c.seed('gw')), 0, 0.5, 0);
  const out = verb(m, 'plate', 0.42, 0.8);
  return { buf: fin(out, { peak: -13, fadeOut: 0.4 }), send: -26 };
}

// ---------------------------------------------------------------------------------------------------------------
// 1927
// ---------------------------------------------------------------------------------------------------------------
/** intertitle card slaps in: card-on-table thud + paper slap + wood resonance + two settling bounces + dust puff */
function card_thunk(ev, c) {
  const n = S(1.2);
  const main = sum([thump(n, 220, 96, 0.018, 0.075), scaleA(mulA(bp(nz(n, c.seed('s'), 0.8), 1800, 0.55), perc(n, 0.016, 0.0006)), 0.65),
    scaleA(mulA(hp(nz(n, c.seed('h'), 0.8), 4500), perc(n, 0.004, 0.0003)), 0.4), modal(n, [[180, 0.5, 0.05], [410, 0.35, 0.03], [780, 0.2, 0.02], [1320, 0.1, 0.012]])]);
  const m = Z(n);
  addTo(m, main, 0, 1.0);
  addTo(m, scaleA(sum([thump(S(0.2), 200, 100, 0.014, 0.04), modal(S(0.2), [[420, 0.4, 0.02], [810, 0.2, 0.012]])]), 1), 0.088, 0.33);
  addTo(m, scaleA(sum([thump(S(0.2), 210, 110, 0.012, 0.03), modal(S(0.2), [[450, 0.4, 0.015]])]), 1), 0.152, 0.14);
  addTo(m, mulA(lp(nz(S(0.5), c.seed('d'), 0.5), 900), env(S(0.5), [[0, 0], [0.06, 0.25], [0.35, 0]], 'smooth')), 0.03, 0.2);
  const out = verb(wide(m, 0.35, c.seed('w')), 'room', 0.24, 0.5);
  return { buf: fin(out, { peak: -6, fadeOut: 0.15 }), send: -26 };
}

// ---------------------------------------------------------------------------------------------------------------
// 1939
// ---------------------------------------------------------------------------------------------------------------
/** colour floods in: a blooming shimmer pad of G-major partials (each tremolo'd, beating pairs, spread L-R) + air + warm sub */
function color_bloom(ev, c) {
  const dur = 2.5, n = S(dur), r = c.rng('cb');
  const notes = [392, 493.88, 587.33, 783.99, 987.77, 1174.66, 1567.98, 1975.53, 2349.32, 3135.96, 3951.07];
  const m = new Buf(dur);
  notes.forEach((f, i) => {
    const u = i / (notes.length - 1);
    const swT = 0.26 + 0.22 * u + (i % 3) * 0.035;
    const e = fromFn(n, (t) => (t < swT ? Math.pow(Math.sin((Math.PI / 2) * (t / swT)), 2) : Math.exp(-(t - swT) / (1.0 - 0.45 * u))));
    const tr = dsp.lfo('sine', 3 + 4 * r(), n, { min: 1 - (0.12 + 0.2 * r()), max: 1, phase: r() });
    const x = sum([sine(f - 0.55 * (1 + u), n, r()), sine(f + 0.55 * (1 + u), n, r())]);
    const a = 0.9 / Math.pow(f / 392, 0.28);
    put(m, mulA(mulA(x, e), tr), 0, a * 0.5, (i % 2 ? 1 : -1) * (0.15 + 0.55 * u));
  });
  // soft airy bloom + warm G2
  put(m, wide(mulA(bp(nz(n, c.seed('air'), 0.6), 6200, 0.6), env(n, [[0, 0], [0.22, 0.12], [1.2, 0.04], [2.2, 0]], 'smooth')), 1, c.seed('aw')), 0, 1, 0);
  put(m, mulA(sine(98, n), env(n, [[0, 0], [0.4, 0.14], [1.4, 0.06], [2.4, 0]], 'smooth')), 0, 1, 0);
  // an upward glint at the start of the bloom
  put(m, mulA(sine(sweep(n, 784, 3136, 0.8), n), env(n, [[0, 0], [0.12, 0.08], [0.35, 0]], 'smooth')), 0, 1, 0.2);
  m.L.set(hp(m.L, 110));
  m.R.set(hp(m.R, 110));
  const out = verb(m, 'hall', 0.38, 0.0);
  return { buf: fin(out, { peak: -12, fadeOut: 0.5 }), send: -28 };
}

/** chime run: 8 ascending G-major bells on the 1/32 grid (crescendo, sweeping L->R) landing on a long ring */
function chime_run(ev, c) {
  const dur = 3.0, r = c.rng('cr');
  const notes = [783.99, 880, 987.77, 1174.66, 1318.51, 1567.98, 1975.53, 2349.32];
  const m = new Buf(dur);
  const step = cues.BEAT / 8; // 1/32 note = 0.0625 s
  notes.forEach((f, i) => {
    const u = i / (notes.length - 1), last = i === notes.length - 1;
    const x = bellStrike(S(2.4), f, { tau: last ? 1.1 : 0.34 + 0.1 * u, kind: 'bell', amp: 0.45 + 0.55 * u });
    const tick = mulA(hp(nz(S(0.05), c.seed('tk' + i), 0.5), 4000), perc(S(0.05), 0.0012, 0.0001));
    put(m, edge(sum([x, scaleA(tick, 0.18)]), 0.0004, 0.08), i * step + (r() - 0.5) * 0.003, 1, -0.6 + 1.2 * u);
  });
  // octave shimmer on the final note
  put(m, edge(bellStrike(S(2.4), 2349.32 * 2, { tau: 0.8, kind: 'glass', amp: 0.28 }), 0.0004, 0.1), 7 * step + 0.004, 1, 0.3);
  put(m, edge(bellStrike(S(2.4), 1567.98, { tau: 1.2, kind: 'celesta', amp: 0.35 }), 0.0004, 0.1), 7 * step + 0.002, 1, -0.3);
  const out = verb(m, 'hall', 0.36, 0.0);
  return { buf: fin(out, { peak: -13, fadeOut: 0.6 }), send: -26 };
}

// ---------------------------------------------------------------------------------------------------------------
// 1960
// ---------------------------------------------------------------------------------------------------------------
/** distant caravan horn: A2 swelling, glide up a fifth to E3, detuned unison saws through moving formants, far-away lowpass, echo + hall */
function horn_distant(ev, c) {
  const dur = 2.4, n = S(dur + 0.7);
  const fC = env(n, [[0, 110], [0.85, 110], [1.0, 164.81], [3.1, 164.81]], 'smooth');
  const vib = dsp.lfo('sine', 5.1, n, { min: -1, max: 1 });
  const fV = Z(n);
  for (let i = 0; i < n; i++) fV[i] = fC[i] * (1 + 0.0035 * vib[i] * Math.min(1, i / SR / 0.7));
  const u = dsp.unison('saw', fV, n, { voices: 3, detuneCents: 9, spread: 0.5, seed: c.seed('u') });
  const aE = env(n, [[0, 0], [0.32, 0.8], [0.7, 1], [1.0, 0.92], [1.7, 0.95], [2.05, 0.55], [2.5, 0]], 'smooth');
  const cut = env(n, [[0, 320], [0.5, 1000], [1.1, 1500], [2.0, 900], [3.1, 500]], 'smooth');
  const breath = scaleA(bp(nz(n, c.seed('b'), 0.5), 1300, 1.0), 0.05);
  const proc = (x) => {
    let y = dsp.svf(sum([x, breath]), 'lp', cut, 1.4);
    y = dsp.biquad(y, 'peak', 600, 2, 6);
    y = dsp.biquad(y, 'peak', 1150, 2.5, 3);
    y = lp(y, 2800); // distance
    return mulA(y, aE);
  };
  let b = Buf.from(proc(u.L), proc(u.R));
  b = dsp.delay(b, cues.BEAT * 0.75, 0.32, 0.3, { damp: 0.6, tail: 0.0 });
  const out = verb(b, 'bigHall', 0.55, 0.0, { preDelay: 0.07 });
  return { buf: fin(out, { peak: -14, fadeOut: 0.5 }), send: -30 };
}

/** desert wind: gusting band noise, narrow whistling through the dunes, fine sand hiss, drifting stereo */
function wind_desert(ev, c) {
  const dur = ev.dur ?? 1.0, n = S(dur + 0.3);
  const side = (seed, off) => {
    const gust = lp(nz(n, seed + 1, 1), 1.6);
    const g = Z(n);
    for (let i = 0; i < n; i++) g[i] = clamp(0.62 + 1.6 * gust[i], 0.15, 1.3);
    const fc = fromFn(n, (t) => 430 + 360 * (0.5 + 0.5 * Math.sin(TAU * 0.55 * t + off)));
    const body = mulA(dsp.svf(nz(n, seed, 0.9, 'pink'), 'bp', fc, 1.1), g);
    const wf = fromFn(n, (t) => 980 + 240 * Math.sin(TAU * 0.33 * t + off * 2) + 30 * off);
    const whistle = mulA(dsp.svf(nz(n, seed + 2, 0.8), 'bp', wf, 22), scaleA(g, 0.26));
    const whistle2 = mulA(dsp.svf(nz(n, seed + 3, 0.8), 'bp', scaleA(wf, 1.92), 18), scaleA(g, 0.1));
    const sand = mulA(lp(hp(nz(n, seed + 4, 0.6), 4000), 9000), g.map((v) => v * v * 0.14));
    return sum([body, whistle, whistle2, sand]);
  };
  const L = side(c.seed('L'), 0), R = side(c.seed('R'), 1.7);
  const gE = env(n, [[0, 0], [0.22, 1], [dur - 0.1, 0.9], [dur + 0.3, 0]], 'smooth');
  const b = Buf.from(mulA(L, gE), mulA(R, gE));
  return { buf: fin(b, { peak: -17, fadeOut: 0.12 }), send: -26 };
}

// ---------------------------------------------------------------------------------------------------------------
// 1977
// ---------------------------------------------------------------------------------------------------------------
/** laser zap: pitch-dropping saw + octave sine + ring-mod edge + noise crack + resonant echoing tail; each shot a little higher */
function laser_zap(ev, c) {
  const k = Math.min(2, c.burst(0.6)), n = S(0.8);
  const f0 = [3400, 3900, 4500][k], f1 = 250 + 20 * k;
  const fg = glideExp(n, f0, f1, 0.045);
  const e = fromFn(n, (t) => (t < 0.012 ? t / 0.012 : Math.exp(-Math.max(0, t - 0.012) / (0.075 + 0.015 * k))));
  const l1 = mulA(lp(dsp.osc('saw', fg, n), 6500), e);
  const l2 = mulA(sine(scaleA(fg, 2.0), n), fromFn(n, (t) => Math.exp(-t / 0.05)));
  const rm = mulA(l1, sine(fromFn(n, () => 137), n));
  const crack = mulA(hp(nz(n, c.seed('c'), 0.8), 3000), perc(n, 0.004, 0.0002));
  const zing = mulA(dsp.svf(nz(n, c.seed('z'), 0.8), 'bp', sweep(n, 2600, 700, 1), 12), fromFn(n, (t) => 0.5 * Math.exp(-t / 0.17) * (1 - Math.exp(-t / 0.01))));
  const mono = sum([l1, scaleA(l2, 0.28), scaleA(rm, 0.3), scaleA(crack, 0.5), scaleA(zing, 0.45)]);
  const dir = k % 2 ? -1 : 1;
  const pan = fromFn(n, (t) => dir * (-0.22 + 0.44 * Math.min(1, t / 0.25)));
  let b = panSweep(mono, pan);
  b = dsp.delay(b, 0.107, 0.28, 0.22, { damp: 0.55, hpHz: 400, tail: 0.0 });
  const out = verb(b, 'plate', 0.16, 0.0);
  return { buf: fin(out, { peak: -9, fadeOut: 0.25 }), send: -24 };
}

/** practical-model explosion: crack + saturated noise burst sweeping down + boom + flame roar + sparks + debris clatter + hall tail */
function model_explosion(ev, c) {
  const n = S(3.2), r = c.rng('ex');
  const crack = mulA(hp(nz(n, c.seed('cr'), 0.9), 800), perc(n, 0.003, 0.0002));
  const body = dsp.waveshape(mulA(dsp.svf(nz(n, c.seed('b'), 0.9), 'lp', glideExp(n, 5200, 300, 0.3), 0.8), perc(n, 0.32, 0.004)), 'tanh', 2.2);
  const boom = sum([thump(n, 150, 40, 0.1, 0.55), scaleA(lp(dsp.waveshape(thump(n, 150, 40, 0.1, 0.5), 'tanh', 3), 380), 0.5)]);
  const rumble = mulA(lp(nz(n, c.seed('rm'), 0.9, 'brown'), 180), perc(n, 0.95, 0.01));
  const roar = mulA(bp(nz(n, c.seed('rr'), 0.9), 900, 0.6), env(n, [[0, 0], [0.05, 1], [0.5, 0.6], [1.5, 0]], 'smooth'));
  const rate = fromFn(n, (t) => 20 + 520 * Math.exp(-t / 0.5));
  const sparks = bp(poisson(n, rate, r, { tail: 2.2 }), 3600, 0.5);
  const debris = Z(n);
  for (let i = 0; i < 7; i++) {
    const tt = 0.22 + 1.2 * Math.pow(r(), 0.9), f = 260 + 700 * r();
    addTo(debris, modal(S(0.25), [[f, 0.5, 0.02], [f * 2.3, 0.3, 0.012], [f * 4.1, 0.2, 0.006]]), tt, 0.2 + 0.35 * r());
  }
  const mono = sum([scaleA(crack, 0.9), scaleA(body, 1.0), scaleA(boom, 1.1), scaleA(rumble, 0.55), scaleA(roar, 0.32), scaleA(sparks, 0.55), debris]);
  const w = wide(mono, 0.7, c.seed('w'));
  const out = verb(w, 'hall', 0.2, 0.0);
  return { buf: fin(out, { peak: -3, fadeOut: 0.5 }), send: -30 };
}

// ---------------------------------------------------------------------------------------------------------------
// 1993
// ---------------------------------------------------------------------------------------------------------------
/** digital scan: 16 stepped pentatonic blips on a 1/32 grid sweeping L->R, bitcrushed band-sweep, rising whine, 'scan done' chirp */
function digital_scan(ev, c) {
  const dur = ev.dur ?? 0.5, r = c.rng('ds');
  const steps = 16, st = dur / steps;
  const m = new Buf(dur + 0.3);
  const deg = [0, 2, 4, 7, 9];
  for (let i = 0; i < steps; i++) {
    const idx = Math.floor(i * 0.6 + r() * 2.3), semis = 12 * Math.floor(idx / 5) + deg[idx % 5];
    const f = 1046.5 * Math.pow(2, semis / 12), len = S(st * 0.62);
    const x = edge(sum([sine(f, len), scaleA(sine(f * 2, len), 0.18)]), 0.002, 0.004);
    put(m, x, i * st, 0.5, -0.8 + 1.6 * (i / (steps - 1)));
  }
  const nn = S(dur + 0.3);
  const sw = mulA(bp(nz(nn, c.seed('s'), 0.9), sweep(nn, 300, 7000, 1), 6), env(nn, [[0, 0], [0.04, 1], [dur - 0.02, 1], [dur + 0.05, 0]], 'smooth'));
  const swc = dsp.bitcrush(sw, { bits: 9, rate: 14000 });
  put(m, panSweep(swc, fromFn(nn, (t) => -0.8 + 1.6 * Math.min(1, t / dur))), 0, 0.4, 0);
  put(m, mulA(sine(sweep(nn, 1200, 7000, 1), nn), fromFn(nn, (t) => (t < dur ? 0.1 * Math.pow(t / dur, 1.5) : 0))), 0, 1, 0);
  // 'scan done' chirp
  put(m, edge(sum([sine(2093, S(0.12)), scaleA(sine(3136, S(0.12)), 0.6)]), 0.001, 0.05), dur, 0.32, 0.3);
  put(m, edge(sine(3136, S(0.1)), 0.001, 0.04), dur + 0.04, 0.3, 0.3);
  const out = verb(m, 'plate', 0.12, 0.15);
  return { buf: fin(out, { peak: -12, fadeOut: 0.2 }), send: -26 };
}

/** creature roar (pure synthesis): rough glottal pulse train at ~60 Hz falling to 36 with chaotic growl-AM, vowel-sweeping formants, raspy breath, rising 'screech' band, chest sub */
function creature_roar(ev, c) {
  const dur = 2.4, n = S(dur + 0.5);
  const jit = lp(nz(n, c.seed('j'), 1), 40);
  const f0 = Z(n);
  const base = env(n, [[0, 62], [0.12, 80], [0.5, 66], [0.9, 76], [1.5, 58], [2.3, 36], [3, 34]], 'smooth');
  for (let i = 0; i < n; i++) f0[i] = base[i] * (1 + 0.06 * jit[i]);
  const w = fromFn(n, (t) => 0.16 + 0.1 * Math.sin(TAU * 0.7 * t));
  const src = sum([dsp.osc('pulse', f0, n, { width: w }), scaleA(dsp.osc('saw', scaleA(f0, 0.5), n), 0.5)]);
  // growl AM: irregular 18-34 Hz saw pulses, sharpened
  const gr = dsp.lfo('smooth', 22, n, { min: 18, max: 34, seed: c.seed('gr') });
  const rough = dsp.lfo('saw', gr, n, { min: 0, max: 1 });
  const am = Z(n);
  for (let i = 0; i < n; i++) am[i] = 0.35 + 0.65 * Math.pow(rough[i], 1.6);
  const voiced = dsp.formant(mulA(src, am), 'a', { voice: 'bass', to: 'o', morph: env(n, [[0, 0], [0.45, 0.1], [1.2, 0.9], [2.5, 1]], 'smooth'), shift: 1.08, q: 1.3 });
  // raspy breath + screech: noise through sweeping resonances, same growl AM
  const rasp = mulA(dsp.svf(nz(n, c.seed('rs'), 0.9), 'bp', env(n, [[0, 1100], [0.3, 2100], [0.9, 3000], [1.6, 1900], [2.4, 900], [3, 800]], 'smooth'), 7), am);
  const breath = mulA(bp(nz(n, c.seed('bt'), 0.9), 1500, 0.5), am);
  const chest = mulA(sine(scaleA(f0, 0.75), n), env(n, [[0, 0], [0.2, 1], [1.8, 0.8], [2.5, 0]], 'smooth'));
  let mono = sum([scaleA(hp(voiced, 70), 1.0), scaleA(rasp, 1.1), scaleA(breath, 0.3), scaleA(chest, 0.2)]);
  mono = dsp.waveshape(mono, 'tanh', 2.6, { comp: true });
  mono = dsp.biquad(dsp.biquad(mono, 'peak', 750, 1.4, 6), 'peak', 1900, 1.2, 4);
  mono = lp(mono, 7000);
  const aE = env(n, [[0, 0], [0.06, 0.9], [0.25, 1], [1.1, 0.95], [1.8, 0.55], [2.5, 0.12], [2.9, 0]], 'smooth');
  const b = wide(mulA(mono, aE), 0.45, c.seed('w'));
  const out = verb(b, 'hall', 0.2, 0.0);
  return { buf: fin(out, { peak: -4, fadeOut: 0.5 }), send: -28 };
}

// ---------------------------------------------------------------------------------------------------------------
// 2009
// ---------------------------------------------------------------------------------------------------------------
/** 3D pop-out: short rising whoosh landing on the pop (pre-roll), thump + plop + G1 sub, then a wide fly-by whoosh toward the viewer */
function pop_out(ev, c) {
  const pre = 0.16, dur = pre + 1.2;
  const m = new Buf(dur);
  const np = S(pre);
  put(m, wide(mulA(bp(nz(np, c.seed('pw'), 0.9), sweep(np, 500, 4500, 1), 1.4), fromFn(np, (t) => Math.pow(t / pre, 2))), 0.8, c.seed('pwd')), 0, 0.8, 0);
  const pop = sum([thump(S(0.6), 230, 62, 0.03, 0.13), scaleA(mulA(sine(glideExp(S(0.2), 760, 330, 0.03), S(0.2)), perc(S(0.2), 0.035, 0.001)), 0.5), scaleA(mulA(hp(nz(S(0.1), c.seed('pc'), 0.8), 2000), perc(S(0.1), 0.002, 0.0002)), 0.4)]);
  put(m, pop, pre, 1.0, 0);
  put(m, thump(S(1.2), 98, 49, 0.2, 0.38), pre, 0.6, 0); // G1 sub (bar 9 = G)
  const nf = S(1.0);
  const fb = glideExp(nf, 2200, 520, 0.2);
  const mk = (seed) => mulA(dsp.svf(nz(nf, seed, 0.9), 'bp', fb, 1.2), perc(nf, 0.22, 0.03));
  const fly = widthEnv(Buf.from(mk(c.seed('fl')), mk(c.seed('fr'))), 1.8);
  put(m, fly, pre, 0.7, 0);
  const out = verb(m, 'plate', 0.18, 0.0);
  return { buf: fin(out, { peak: -8, fadeOut: 0.3 }), offsetSec: pre, send: -22 };
}

/** IMAX boom: 90->30 Hz sine drop with long decay, saturated body, audible harmonics, crack, rumble, huge dark room */
function imax_boom(ev, c) {
  const dur = 2.8, n = S(dur);
  const core = mulA(sine(glideExp(n, 90, 30, 0.28), n), perc(n, 0.7, 0.006));
  const body = lp(dsp.waveshape(thump(n, 150, 58, 0.05, 0.35), 'tanh', 2.5), 450);
  const harm = hp(lp(dsp.waveshape(core, 'tanh', 3.0), 300), 70);
  const crack = mulA(lp(nz(n, c.seed('c'), 0.9), 3500), perc(n, 0.02, 0.001));
  const rumble = mulA(lp(nz(n, c.seed('r'), 0.9, 'brown'), 90), env(n, [[0, 0], [0.1, 1], [1.0, 0.4], [2.6, 0]], 'smooth'));
  const dry = sum([core, scaleA(body, 0.8), scaleA(harm, 0.35), scaleA(crack, 0.4), scaleA(rumble, 0.5)]);
  const b = wide(dry, 0.25, c.seed('w'));
  const wet = dsp.applyReverb(b, 'bigHall', { wet: 0.4, tail: 0, highCut: 700, lowCut: 30, decay: 2.2 });
  return { buf: fin(wet, { peak: -3, fadeOut: 1.2 }), send: -40 };
}

// ---------------------------------------------------------------------------------------------------------------
// 2025
// ---------------------------------------------------------------------------------------------------------------
/** frame squeezes to 9:16: pinching whoosh + falling elastic tone + stereo image collapsing to mono, then a small seat thunk */
function matte_squeeze(ev, c) {
  const n = S(0.7);
  const win = env(n, [[0, 0], [0.05, 1], [0.15, 0.8], [0.26, 0.1], [0.32, 0]], 'smooth');
  const wh = mulA(dsp.svf(nz(n, c.seed('w'), 0.9), 'bp', sweep(n, 2500, 600, 1), 1.3), win);
  const vib = dsp.lfo('sine', 9, n, { min: -1, max: 1 });
  const fq = sweep(n, 1100, 380, 1);
  for (let i = 0; i < n; i++) fq[i] *= 1 + 0.01 * vib[i];
  const tone = mulA(sine(fq, n), scaleA(win, 0.33));
  const zip = mulA(sine(sweep(n, 6000, 3000, 1), n), env(n, [[0, 0], [0.01, 0.07], [0.06, 0]], 'smooth'));
  const m = sum([wh, tone, zip]);
  addTo(m, sum([thump(S(0.25), 190, 80, 0.02, 0.05), scaleA(mulA(hp(nz(S(0.25), c.seed('k'), 0.8), 1800), perc(S(0.25), 0.0012, 0.0002)), 0.3)]), 0.25, 0.3);
  const b = widthEnv(wide(m, 0.9, c.seed('wd')), env(n, [[0, 1.5], [0.25, 0.15], [0.7, 0.15]], 'smooth'));
  const out = verb(b, 'room', 0.15, 0.0);
  return { buf: fin(out, { peak: -11, fadeOut: 0.15 }), send: -26 };
}

/** UI tap: dry glassy tick + tiny finger thump */
function phone_tap(ev, c) {
  const n = S(0.25);
  const x = sum([modal(n, [[1250, 1, 0.006], [2750, 0.5, 0.004], [420, 0.6, 0.015]]), scaleA(mulA(hp(nz(n, c.seed('c'), 0.8), 3000), perc(n, 0.0007, 0.0001)), 0.45),
    scaleA(thump(n, 170, 110, 0.012, 0.018), 0.35)]);
  return { buf: fin(Buf.fromMono(x), { peak: -14, fadeOut: 0.05 }), send: -34 };
}

/** notification ping: two bright bell notes (E6 then A6) with glass sheen, short plate */
function notification_ping(ev, c) {
  const n = S(1.5);
  const m = new Buf(1.9);
  [[1318.51, 0, -0.15], [1760, 0.11, 0.15]].forEach(([f, t, pan], i) => {
    const x = sum([bellStrike(n, f, { tau: 0.42, kind: 'bell', amp: 1 }), scaleA(bellStrike(n, f * 3.0, { tau: 0.12, kind: 'glass', amp: 0.2 }), 1),
      scaleA(mulA(hp(nz(S(0.03), c.seed('t' + i), 0.6), 5000), perc(S(0.03), 0.0008, 0.0001)), 0.2)]);
    put(m, edge(x, 0.0005, 0.1), t, i ? 0.9 : 1, pan);
  });
  m.L.set(hp(m.L, 300));
  m.R.set(hp(m.R, 300));
  const out = verb(m, 'plate', 0.15, 0.4);
  return { buf: fin(out, { peak: -13, fadeOut: 0.3 }), send: -28 };
}

/** swipe: up-swipe band whoosh (finger on glass) + skin squeak + tiny thip */
function swipe(ev, c) {
  const n = S(0.35);
  const wh = mulA(dsp.svf(nz(n, c.seed('w'), 0.9), 'bp', sweep(n, 700, 4500, 1), 1.3), env(n, [[0, 0], [0.03, 0.8], [0.075, 1], [0.17, 0.2], [0.24, 0]], 'smooth'));
  const sq = mulA(bp(nz(n, c.seed('s'), 0.8), 7200, 6), env(n, [[0, 0], [0.02, 0.3], [0.1, 0.1], [0.14, 0]], 'smooth'));
  const th = thump(n, 230, 130, 0.01, 0.012);
  const mono = sum([wh, scaleA(sq, 0.35), scaleA(th, 0.35)]);
  return { buf: fin(wide(mono, 0.5, c.seed('wd')), { peak: -14, fadeOut: 0.1 }), send: -28 };
}

/** heart pop: soft bubble 'bloop' (pitch glides up), tiny sparkle pings; successive pops step up a minor third (E5 -> G5) */
function heart_pop(ev, c) {
  const k = Math.min(1, c.burst(0.4)), f = [659.26, 783.99][k], n = S(0.7);
  const fg = fromFn(n, (t) => f * (0.62 + 0.38 * (1 - Math.exp(-t / 0.014))));
  const bub = mulA(sum([sine(fg, n), scaleA(sine(scaleA(fg, 2), n), 0.14)]), perc(n, 0.042, 0.002));
  const spark = sum([bellStrike(n, f * 4, { tau: 0.09, kind: 'glass', amp: 0.16 }), bellStrike(n, f * 6.1, { tau: 0.06, kind: 'glass', amp: 0.08 })]);
  const sk = mulA(spark, fromFn(n, (t) => (t < 0.012 ? 0 : 1)));
  const mono = sum([bub, sk]);
  const b = verb(wide(mono, 0.4, c.seed('w')), 'plate', 0.1, 0.0);
  return { buf: fin(b, { peak: -13, fadeOut: 0.15 }), send: -28 };
}

/** NOW slam: inhale (pre-roll) + stamp crack + saturated boom + A-tuned metal ring with inharmonic edge; the film cuts it dead at 22.0 */
function now_slam(ev, c) {
  const pre = 0.1, dur = pre + 0.9, n = S(dur);
  const m = Z(n);
  const np = S(pre);
  addTo(m, mulA(hp(nz(np, c.seed('in'), 0.9), 3000), fromFn(np, (t) => 0.5 * Math.pow(t / pre, 2))), 0, 1);
  addTo(m, mulA(sine(sweep(np, 60, 120, 1), np), fromFn(np, (t) => 0.4 * Math.pow(t / pre, 1.5))), 0, 1);
  const N2 = S(dur - pre);
  const crack = mulA(hp(nz(N2, c.seed('c'), 0.9), 500), perc(N2, 0.006, 0.0004));
  const stamp = dsp.waveshape(thump(N2, 170, 46, 0.06, 0.26), 'tanh', 1.8);
  const metal = modal(N2, [[110, 0.5, 0.5], [220.4, 0.8, 0.55], [330.7, 0.55, 0.45], [439.5, 0.7, 0.45], [660.9, 0.4, 0.35], [881.2, 0.35, 0.3], [573, 0.3, 0.3], [1012, 0.25, 0.25], [1765, 0.2, 0.18], [2810, 0.12, 0.12]]);
  const tail = mulA(bp(nz(N2, c.seed('t'), 0.9), 1800, 0.6), perc(N2, 0.2, 0.003));
  addTo(m, sum([scaleA(crack, 1.0), scaleA(stamp, 1.2), scaleA(metal, 0.5), scaleA(tail, 0.3)]), pre, 1);
  const w = wide(m, 0.4, c.seed('w'));
  const out = dsp.applyReverb(w, 'bigHall', { wet: 0.3, tail: 0 });
  return { buf: fin(out, { peak: -3, fadeOut: 0.05 }), offsetSec: pre, send: -30 };
}

// ---------------------------------------------------------------------------------------------------------------
// THE TURN
// ---------------------------------------------------------------------------------------------------------------
/** sub drop: hard impact + A2->A0 sine fall (110 -> 27.5 Hz) with saturated overtones for small speakers, dark rumble, huge dark room, 3.5 s tail */
function sub_drop(ev, c) {
  const dur = 3.5, n = S(dur);
  const core = mulA(sine(glideExp(n, 110, 27.5, 0.5), n), perc(n, 0.9, 0.004));
  const harm = mulA(hp(lp(dsp.waveshape(core, 'tanh', 2.6), 200), 55), perc(n, 0.32, 0.002));
  const punch = thump(n, 95, 42, 0.05, 0.25);
  const crack = sum([mulA(lp(nz(n, c.seed('c'), 0.9), 2200), perc(n, 0.04, 0.0006)), scaleA(mulA(hp(nz(n, c.seed('c2'), 0.9), 2000), perc(n, 0.002, 0.0002)), 0.5)]);
  const rumble = mulA(lp(nz(n, c.seed('r'), 0.9, 'brown'), 60), env(n, [[0, 0], [0.08, 1], [1.2, 0.45], [3.2, 0]], 'smooth'));
  const whomp = mulA(bp(nz(n, c.seed('wm'), 0.9), 150, 0.6), perc(n, 0.3, 0.003));
  const dry = sum([core, scaleA(harm, 0.5), scaleA(punch, 0.7), scaleA(crack, 0.55), scaleA(rumble, 0.45), scaleA(whomp, 0.3)]);
  const wet = dsp.applyReverb(wide(dry, 0.3, c.seed('w')), 'cave', { wet: 0.3, tail: 0, lowCut: 35, highCut: 260, decay: 4 });
  return { buf: fin(wet, { peak: -3, fadeOut: 1.4, fadeIn: 0.0008 }), send: -40 };
}

/** paper tear: granular fibre-snap crackle in 6 jagged rips (stick-slip roughness), big-sheet body, travelling L->R, fibre dust tail */
function paper_tear(ev, c) {
  const dur = ev.dur ?? 1.5, n = S(dur + 0.5), r = c.rng('pt');
  const segLen = [0.34, 0.2, 0.26, 0.17, 0.12, 0.09], gap = [0.05, 0.07, 0.04, 0.09, 0.06], I = [1, 0.75, 0.9, 0.6, 0.45, 0.3];
  const ripEnv = Z(n);
  let t0 = 0;
  segLen.forEach((L, i) => {
    const a = Math.round(t0 * SR), b = Math.min(n, Math.round((t0 + L) * SR));
    for (let j = a; j < b; j++) {
      const x = (j - a) / (b - a), t = (j - a) / SR;
      const rise = 1 - Math.exp(-t / 0.006), fallEnd = Math.min(1, (b - j) / (0.02 * SR));
      ripEnv[j] = Math.max(ripEnv[j], I[i] * (1 - 0.55 * x) * rise * fallEnd);
    }
    t0 += L + (gap[i] || 0);
  });
  const jag = lp(nz(n, c.seed('jg'), 1), 90), jag2 = lp(nz(n, c.seed('jg2'), 1), 45);
  const rate = scaleA(ripEnv, 2600);
  for (let i = 0; i < n; i++) rate[i] += 15;
  const imp = (tl) => poisson(n, rate, r, { tail: tl });
  const clicks = sum([bp(imp(1.6), 2100, 0.9), scaleA(bp(imp(1.6), 4300, 1.1), 0.8), scaleA(hp(imp(1.8), 6500), 0.5)]);
  const fibre = Z(n), fb = bp(nz(n, c.seed('fb'), 0.9), 1800, 0.45);
  for (let i = 0; i < n; i++) fibre[i] = fb[i] * Math.pow(ripEnv[i], 1.3) * clamp(0.55 + 2.2 * jag[i], 0.1, 1.5);
  const body = Z(n), bb = bp(nz(n, c.seed('bd'), 0.9), 420, 0.7);
  for (let i = 0; i < n; i++) body[i] = bb[i] * Math.pow(ripEnv[i], 1.5) * clamp(0.5 + 2.4 * jag2[i], 0.1, 1.5);
  const dust = bp(poisson(n, fromFn(n, (t) => 55 * Math.exp(-Math.max(0, t - 0.8) / 0.4)), r, { tail: 2 }), 5000, 0.8);
  const moving = sum([scaleA(clicks, 0.55), scaleA(fibre, 1.0), scaleA(dust, 0.4)]);
  const pj = lp(nz(n, c.seed('pj'), 1), 5);
  const pan = fromFn(n, (t) => clamp(-0.65 + 1.3 * Math.min(1, t / dur) + 0.5 * pj[Math.round(t * SR)], -1, 1));
  const m = panSweep(moving, pan);
  const bw = wide(body, 0.6, c.seed('bw'));
  for (let i = 0; i < n; i++) { m.L[i] += bw.L[i] * 0.55; m.R[i] += bw.R[i] * 0.55; }
  const out = verb(m, 'room', 0.2, 0.0);
  return { buf: fin(out, { peak: -10, fadeOut: 0.3 }), send: -26 };
}

/** paper flutter: soft irregular flaps (decaying rate and level, pan scattered, darkening with distance), curling swell, rustle */
function paper_flutter(ev, c) {
  const dur = ev.dur ?? 1.5, n = S(dur + 0.5), r = c.rng('pf');
  const m = new Buf(dur + 0.5);
  let t = 0.02;
  while (t < dur + 0.2) {
    const A = Math.exp(-t / 0.95), rate = 13 * Math.exp(-t / 1.4) + 4;
    const len = S(0.2), fc = 500 + 1200 * r();
    const lpC = 5200 * Math.exp(-t / 1.2) + 1500;
    const x = lp(mulA(bp(nz(len, c.seed('f' + Math.round(t * 1000)), 0.9), fc, 1.3), perc(len, 0.045, 0.008)), lpC);
    const th = scaleA(mulA(lp(nz(len, c.seed('l' + Math.round(t * 1000)), 0.9), 240), perc(len, 0.05, 0.01)), 0.3);
    put(m, sum([x, th]), t, A * (0.35 + 0.65 * r()), (r() * 2 - 1) * 0.85);
    t += (1 / rate) * (0.6 + 0.8 * r());
  }
  put(m, wide(mulA(bp(nz(n, c.seed('cw'), 0.9), 600, 0.6), env(n, [[0, 0], [0.3, 0.5], [0.9, 0.3], [1.6, 0]], 'smooth')), 1, c.seed('cww')), 0, 0.3, 0);
  put(m, wide(mulA(hp(bp(poisson(n, fromFn(n, (tt) => 55 * Math.exp(-tt / 0.7)), r, { tail: 2 }), 4200, 0.7), 2500), perc(n, 0.9, 0.01)), 1, c.seed('rw')), 0, 0.15, 0);
  const out = verb(m, 'room', 0.2, 0.0);
  return { buf: fin(out, { peak: -14, fadeOut: 0.35 }), send: -26 };
}

/** stage spot ignites: relay 'ka-chunk' with steel body + filament foom + F-major hum (avoids the piano's E4) fading into the scene */
function spot_clunk(ev, c) {
  const dur = 2.0, n = S(dur), r = c.rng('sc');
  const m = new Buf(dur);
  const clunk = sum([thump(S(0.4), 95, 55, 0.04, 0.06), modal(S(0.4), [[310, 0.6, 0.04], [740, 0.45, 0.03], [1380, 0.3, 0.018], [2900, 0.2, 0.01]]), scaleA(mulA(hp(nz(S(0.4), c.seed('c'), 0.9), 2000), perc(S(0.4), 0.001, 0.0001)), 0.6)]);
  put(m, clunk, 0, 1.0, 0);
  put(m, sum([modal(S(0.2), [[420, 0.6, 0.02], [1650, 0.4, 0.01]]), mulA(hp(nz(S(0.2), c.seed('l'), 0.8), 2500), perc(S(0.2), 0.0008, 0.0001))]), 0.038, 0.5, 0.1);
  put(m, mulA(lp(nz(n, c.seed('fw'), 0.9), 700), env(n, [[0, 0], [0.03, 0], [0.09, 1], [0.22, 0.6], [0.7, 0]], 'smooth')), 0, 0.45, 0);
  put(m, mulA(sine(sweep(S(0.5), 60, 150, 1), S(0.5)), env(S(0.5), [[0, 0], [0.12, 0.8], [0.3, 0.2], [0.5, 0]], 'smooth')), 0, 0.4, 0);
  // hum on F (87.31 Hz): F2 F3 C4 A4 C5 (no F4, which would grind against the piano's E4)
  const hum = [[87.31, 0.9], [174.62, 0.8], [261.63, 0.5], [436.55, 0.2], [523.25, 0.1]];
  hum.forEach(([f, a], j) => {
    const x = sum([sine(f - 0.18 * (j + 1), n, r()), sine(f + 0.18 * (j + 1), n, r())]);
    put(m, mulA(x, env(n, [[0, 0], [0.06, 1], [0.45, 0.32], [1.0, 0.24], [2.0, 0]], 'smooth')), 0, a * 0.2, j % 2 ? 0.3 : -0.3);
  });
  put(m, wide(mulA(hp(nz(n, c.seed('bz'), 0.8), 3000), mulA(fromFn(n, (t) => 0.5 + 0.5 * Math.cos(TAU * 120 * t)), env(n, [[0, 0], [0.1, 0.4], [0.5, 0.14], [1.5, 0.05], [2.0, 0]], 'smooth'))), 0.8, c.seed('bw')), 0, 0.15, 0);
  const out = verb(m, 'hall', 0.28, 0.0);
  return { buf: fin(out, { peak: -7, fadeOut: 0.6 }), send: -34 };
}

/** Amrita drops in: falling-pitch air + F6->F4 tonal swoosh + pressure swell, building to the landing and cut clean on 25.0 */
function whoosh_down(ev, c) {
  const dur = ev.dur ?? 0.5, n = S(dur);
  const xp = (t) => Math.min(1, t / dur);
  const fN = fromFn(n, (t) => 3200 * Math.pow(450 / 3200, Math.pow(xp(t), 1.1)));
  const g = fromFn(n, (t) => Math.pow(xp(t), 1.3));
  const mk = (seed) => mulA(dsp.svf(nz(n, seed, 0.9), 'bp', fN, 1.8), g);
  const vib = dsp.lfo('sine', 5, n, { min: -1, max: 1 });
  const fT = fromFn(n, (t) => 1396.91 * Math.pow(0.25, Math.pow(xp(t), 1.1)));
  for (let i = 0; i < n; i++) fT[i] *= 1 + 0.004 * vib[i];
  const tone = mulA(lp(sum([sine(fT, n), scaleA(dsp.osc('tri', scaleA(fT, 2.002), n), 0.22)]), 4200), fromFn(n, (t) => 0.4 * Math.pow(xp(t), 1.8)));
  const pr = mulA(lp(nz(n, c.seed('pr'), 0.9), 200), fromFn(n, (t) => 0.4 * Math.pow(xp(t), 3)));
  const L = sum([mk(c.seed('L')), tone, pr]), R = sum([mk(c.seed('R')), tone, pr]);
  return { buf: fin(Buf.from(L, R), { peak: -9, fadeIn: 0.006, fadeOut: 0.006 }), send: -22 };
}

/** landing: thud + squash 'bwomp' + stage-floor knock + rebound + low rumble; then the chair: stick-slip leather creak, bearing whirr, squish */
function land_thud(ev, c) {
  const dur = 2.0, n = S(dur);
  const m = Z(n);
  addTo(m, thump(S(0.5), 135, 52, 0.028, 0.14, { a: 0.0015 }), 0, 1.0);
  addTo(m, thump(S(0.4), 200, 90, 0.06, 0.1), 0.012, 0.45);
  addTo(m, modal(S(0.4), [[105, 0.6, 0.09], [190, 0.4, 0.06], [340, 0.3, 0.04], [610, 0.2, 0.025]]), 0, 0.5);
  addTo(m, mulA(lp(nz(S(0.2), c.seed('t'), 0.9), 2500), perc(S(0.2), 0.008, 0.0006)), 0, 0.5);
  addTo(m, mulA(lp(nz(S(1.2), c.seed('rm'), 0.9, 'brown'), 90), env(S(1.2), [[0, 0], [0.03, 1], [0.4, 0.4], [1.2, 0]], 'smooth')), 0, 0.35);
  addTo(m, sum([thump(S(0.3), 125, 60, 0.03, 0.08), modal(S(0.3), [[130, 0.4, 0.05]])]), 0.22, 0.24); // rebound
  // chair swivel + creak
  const sl = dsp.drift(n, 9, 1, c.seed('sl'));
  const fslip = fromFn(n, (t) => 85 * (1 + 0.35 * sl[Math.round(t * SR)]) * (1 + 0.5 * Math.min(1, t / 0.6)));
  const exc = dsp.osc('saw', fslip, n);
  const creak = sum([dsp.svf(exc, 'bp', env(n, [[0.14, 740], [0.5, 980], [0.8, 900]], 'smooth'), 22), scaleA(dsp.svf(exc, 'bp', 1620, 18), 0.6)]);
  const creakE = env(n, [[0.13, 0], [0.25, 1], [0.5, 0.6], [0.78, 0]], 'smooth');
  addTo(m, mulA(creak, creakE), 0, 0.16);
  const rot = fromFn(n, (t) => 9 * Math.exp(-t / 0.7) + 2);
  let ph = 0;
  const whirr = Z(n), wn = bp(nz(n, c.seed('wh'), 0.9), 400, 4);
  for (let i = 0; i < n; i++) { ph += rot[i] / SR; whirr[i] = wn[i] * (0.5 + 0.5 * Math.sin(TAU * ph)); }
  addTo(m, mulA(whirr, env(n, [[0.16, 0], [0.3, 1], [1.0, 0.5], [1.5, 0]], 'smooth')), 0, 0.1);
  addTo(m, mulA(bp(nz(S(0.2), c.seed('sq'), 0.9), 1200, 2), perc(S(0.2), 0.05, 0.01)), 0.12, 0.1);
  const out = verb(wide(m, 0.3, c.seed('w')), 'hall', 0.2, 0.0);
  return { buf: fin(out, { peak: -6, fadeOut: 0.4 }), send: -30 };
}

/** title slam 'Meet Amrita.': reverse-air lead-in, low impact, A-tuned metal strike with shimmering cymbal, stinger tail */
function title_hit(ev, c) {
  const pre = 0.18, dur = pre + 2.4, n = S(dur);
  const m = Z(n);
  const np = S(pre);
  addTo(m, mulA(hp(nz(np, c.seed('rv'), 0.9), 3000), fromFn(np, (t) => 0.3 * Math.pow(t / pre, 2))), 0, 1);
  const N2 = S(dur - pre);
  const impact = thump(N2, 120, 48, 0.04, 0.3);
  const crack = mulA(hp(nz(N2, c.seed('c'), 0.9), 1000), perc(N2, 0.004, 0.0003));
  const metal = modal(N2, [[220, 0.5, 0.7], [440.8, 0.6, 0.8], [659.8, 0.35, 0.6], [880.9, 0.5, 0.7], [1318.5, 0.3, 0.5], [1765, 0.3, 0.45], [2640, 0.2, 0.3], [3520, 0.15, 0.25]]);
  const cym = mulA(hp(nz(N2, c.seed('cy'), 0.9), 5500), env(N2, [[0, 0], [0.012, 1], [0.5, 0.35], [1.6, 0]], 'smooth'));
  addTo(m, sum([scaleA(impact, 0.9), scaleA(crack, 0.6), scaleA(metal, 0.5), scaleA(cym, 0.3)]), pre, 1);
  const w = wide(m, 0.5, c.seed('w'));
  const out = verb(w, 'hall', 0.4, 0.0);
  return { buf: fin(out, { peak: -6.5, fadeOut: 0.8 }), offsetSec: pre, send: -30 };
}



/** id -> design notes (picture context + layers); test/make_docs.mjs turns this into RECIPES.md */
export const META = {
  projector_motor: 'Cold open 0.0 (dur 4, spinUp 2). Motor spinning up from ZERO in an S-curve: rotor/mains hum (A1 harmonics scaled by speed, so it rises through the pitches), 408 Hz*speed gear whine (L/R detuned = slow phasing), 24 fps frame rattle (claw ticks on the frame grid + shutter flaps + band-noise AM locked to the frame phase), four mechanical thunks (relay, belt, gear mesh, lock-in), projector-booth IR (flutter echo). Fades out into the 1895 cut.',
  lamp_ignite: 'Cold open 1.0 (also 9.125, 1927 camera pull-back). Relay thunk + steel clack, arc "fwoomp", sparse arc crackle that thins out, 110 Hz jittered carbon-arc buzz settling, detuned glass-tube ring partials (beating = shimmer).',
  beam_hum: 'Cold open 1.0 (dur 3; any dur works). Warm hum on A1 harmonics (55/110/165/220/330/385/440 Hz: no C# partial), L/R beating pairs, breathing, thin lamp whine, dust-mote ticks, air; brightens as the beam widens at the end.',
  eyes_open: 'Cold open 3.0 (also the 1902 moon eye at 7.0). Two soft glass pops (L then R, pitch-dropping bubble + click) and a tinkle cascade of glass pings in A minor starting on E6 (= four octaves above the piano E4), air breath, plate.',
  riser_short: '3.5 and 41.5 (dur 0.5). Detuned saws C4->C5 (C is a chord tone of both Am and F) through an opening lowpass + noise sweep + reverse-cymbal air, widening; ends dead on the downbeat (6 ms cut).',
  matte_slide: 'Each era start (g -6). Soft felt thunk on the downbeat + 0.25 s slide scrape + tiny seat tock at +0.25 s. Depth/pitch follow the aspect-ratio change of the era (pillarbox = lower, letterbox = higher; no change = very subtle).',
  iris_click: '4.0 (and 8.5). Camera iris click: metal modal strike (820/1650/3400 Hz), 3 kHz+ tick, blade "shhk", low tick, tiny room.',
  dive_whoosh: 'Every era dive (5.5 .. 19.5, dur 0.5). Pitch-rising band noise (L/R decorrelated) + tonal swoosh gliding two octaves up to the 5th of the NEXT bar chord (so each dive lands on a chord tone), pressure swell; later dives are bigger. Ends with a 70 ms tail over the next downbeat.',
  crank_loop: '4.0 (dur 1.5). Hand-crank camera: ratchet ticks at ~16/s with a heavier wooden clack every revolution, 10 % human tempo drift, per-tick pitch/amplitude variation, wooden-box resonance, gear whirr.',
  train_chuff: '4.25 (dur 1.25). Head-on steam loco: 4-stroke chuff pattern (strong-weak-medium-weak) accelerating 3.4 -> 8.6 per second, crescendo with opening filter, exhaust thump + steam burst + hiss, rail rumble swell and joint clacks, station chamber.',
  train_whistle: '4.75. Steam whistle: A4 + C5 + E5 (A minor triad) with 2nd/3rd harmonics, breath noise, steam-open pitch overshoot, release droop, hiss, hall tail.',
  curtain_swish: '6.0. Theatre curtains opening: heavy velvet swell with ruffle AM, image widening from mono to wide, 26 curtain-ring ticks sliding on the rod (spreading outward), low cloth whump.',
  magic_poof: '6.5. Smoke poof: lowpass noise burst sweeping down, air puff, 120->44 Hz whump, cartoon "bloop", powder sizzle (Poisson), plate.',
  sparkle_up: '6.75. Ten ascending celesta pings through an F maj7 ladder (F5 .. A7), accelerating, glass doubles, glitter dust, shimmering plate tail.',
  card_thunk: '8.0. Intertitle card slap: 220->96 Hz thud, paper-slap band burst, wood-table resonances, two settling bounces, dust puff, small theatre room.',
  color_bloom: '10.0 (bar of G). Shimmering swell of 11 G-major partials (G4 .. B7), each tremolo\'d with beating pairs and spread L-R, airy 6 kHz bloom, faint G2, upward glint, hall.',
  chime_run: '10.5. Eight G-major bells on the 1/32 grid (G5 A5 B5 D6 E6 G6 B6 D7), crescendo, sweeping L to R, landing on a long ring with octave shimmer; hall.',
  horn_distant: '12.5. Distant caravan horn: A2 swell, glide up a fifth to E3, 3 detuned saws through moving formant peaks + far-away lowpass, breath, dotted-8th echo, big hall with pre-delay.',
  wind_desert: '13.0 (dur 1.0). Gusting pink-noise wind (two decorrelated sides), narrow whistle formants near 1 kHz drifting, fine sand hiss.',
  laser_zap: '14.5 / 14.75 / 15.0 (pan -0.4 / 0 / 0.4). Pitch-dropping saw + octave sine + ring-mod edge + noise crack + resonant zing tail; internal L-R travel and a 107 ms echo; each shot of a volley starts a little higher.',
  model_explosion: '15.0 (g -4). Practical-model explosion: crack, saturated noise burst sweeping 5 kHz -> 300 Hz, 150->40 Hz boom with harmonics, flame roar, Poisson sparks, 7 debris clatters (random wood/card modes), hall.',
  digital_scan: '16.5 (dur 0.5). 16 stepped pentatonic blips (C6 up) on the 1/32 grid panning L to R, bitcrushed band sweep, rising whine, "scan done" two-note chirp.',
  creature_roar: '17.0. Synthesised growl (no recordings): rough pulse train at ~60 Hz gliding to 36 Hz with chaotic 18-34 Hz growl AM, bass-voice formant bank morphing a to o, raspy resonant noise sweeping 1.1 -> 3 kHz and back, breath, chest sub; saturated; hall.',
  pop_out: '18.5. 3D pop-out with 160 ms pre-roll: rising whoosh landing on the pop, 230->62 Hz thump + plop + click, G1 sub (bar of G), then a wide fly-by whoosh toward the viewer (stereo width 1.8).',
  imax_boom: '19.0. IMAX boom: 90->30 Hz sine drop (0.7 s decay), saturated 150->58 Hz body, audible overtones for small speakers, crack, rumble, dark big-hall tail; fades out before 22.',
  matte_squeeze: '20.0. Frame squeezing to 9:16: pinching band-noise whoosh + falling elastic tone 1.1 kHz -> 380 Hz + zip, stereo image collapsing to mono, small seat thunk at +0.25 s.',
  phone_tap: '20.5. UI tap: dry glass-like tick (1250/2750 Hz modes), click, tiny finger thump; mono.',
  notification_ping: '20.75. Two bright bell notes E6 then A6 (110 ms apart), glass sheen, tiny click, plate.',
  swipe: '21.0. Up-swipe: band whoosh 700 -> 4500 Hz, skin squeak, thip.',
  heart_pop: '21.25 / 21.375 (also 9.0). Soft bubble "bloop" (pitch glides up), glass sparkle; successive pops of a rapid pair step E5 -> G5 (ctx.burst).',
  now_slam: '21.5 (100 ms pre-roll inhale). HUD NOW slam: crack, saturated 170->46 Hz stamp, A-tuned metal ring with inharmonic edge, big hall. The film cuts it dead at 22.0: the stem is faded over 20 ms and is digital zero until 22.5.',
  sub_drop: '22.5 (3.5 s). Sine fall 110 -> 27.5 Hz (A2 -> A0), saturated overtones (reads on laptop speakers), punch, crack, brown rumble, dark cave tail; mid body decays fast so the VO line and the piano E4 at 24.0 stay clear.',
  paper_tear: '22.5 (dur 1.5). Six jagged rips of granular fibre-snap crackle (Poisson clicks in 3 bands + stick-slip roughness), big-sheet body resonance, travelling L to R, fibre-dust tail.',
  paper_flutter: '23.0 (dur 1.5). Irregular soft flaps whose rate and level decay, pan scattered, darkening with distance; curling swell + rustle.',
  spot_clunk: '24.0. Stage spot ignites: relay ka-chunk with steel body, latch tick, filament foom, 60->150 Hz glide, hum on F2 (F2 F3 C4 A4 C5; no F4 that would grind against the piano E4), buzz; fades into the scene.',
  whoosh_down: '24.5 (dur 0.5). Amrita drops in: falling-pitch band noise + F6 -> F4 tonal swoosh + pressure swell, cut clean at the landing (25.0).',
  land_thud: '25.0. Landing: 135->52 Hz thud, squash bwomp, stage-floor knock, rebound, rumble; then the chair swivels: stick-slip leather creak (resonant 740-980 Hz and 1620 Hz), bearing whirr, squish.',
  title_hit: '25.0 (180 ms pre-roll). "Meet Amrita." slam: reverse-air lead-in, low impact, A-tuned metal strike (A3 .. A7 partials), shimmering cymbal, hall tail.',
};

export const recipes = {
  projector_motor, lamp_ignite, beam_hum, eyes_open, riser_short, matte_slide, iris_click, dive_whoosh,
  crank_loop, train_chuff, train_whistle, curtain_swish, magic_poof, sparkle_up, card_thunk,
  color_bloom, chime_run, horn_distant, wind_desert, laser_zap, model_explosion, digital_scan, creature_roar,
  pop_out, imax_boom, matte_squeeze, phone_tap, notification_ping, swipe, heart_pop, now_slam,
  sub_drop, paper_tear, paper_flutter, spot_clunk, whoosh_down, land_thud, title_hit,
};

/** soft fallback tick for unknown ids (the dispatcher warns loudly) */
export function fallbackTick(ev, c) {
  const n = S(0.12);
  const x = sum([modal(n, [[1900, 1, 0.007], [3300, 0.4, 0.004]]), scaleA(mulA(hp(nz(n, c.seed('f'), 0.5), 3000), perc(n, 0.001, 0.0001)), 0.4)]);
  return { buf: fin(wide(x, 0.3, 3), { peak: -26, fadeOut: 0.05 }), send: -40 };
}

export const kit = { dense, S, Z, fromFn, glideExp, sweep, sine, nz, lp, hp, bp, lp4, hp4, edge, addTo, mulA, scaleA, env, perc, thump, modal, poisson, stereo, wide, panSweep, widthEnv, put, verb, padTo, fin, hzNearPc, chordAt, rootPcAt, sum, tame, bellStrike, PCS };
