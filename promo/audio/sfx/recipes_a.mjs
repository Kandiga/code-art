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
  const whine = mulA(sine(fromFn(n, (t) => 3150 * (1 + 0.004 * wh[Math.round(t * SR)])), n), env(n, [[0, 0], [0.5, 0.025], [dur - 0.5, 0.03], [dur, 0]], 'smooth'));
  // dust motes in the beam: very quiet sparse ticks, a touch of air
  const dust = hp(bp(poisson(n, 11, r, { tail: 3 }), 6800, 1.5), 4000);
  const air = mulA(bp(nz(n, c.seed('air'), 0.4), 5200, 0.7), env(n, [[0, 0], [0.8, 0.012], [dur - 0.6, 0.014], [dur, 0.03]], 'smooth'));
  // brightening as the beam widens (last 0.6 s)
  const bright = mulA(lp(hp(sine(fromFn(n, () => 220), n, 0.1), 100), 800), env(n, [[0, 0], [dur - 0.8, 0], [dur - 0.1, 0.35], [dur, 0.35]], 'smooth'));
  const satL = dsp.waveshape(L, 'tanh', 2.2, { comp: true }), satR = dsp.waveshape(R, 'tanh', 2.2, { comp: true });
  for (let i = 0; i < n; i++) { L[i] = L[i] * 0.75 + satL[i] * 0.25; R[i] = R[i] * 0.75 + satR[i] * 0.25; }
  for (let i = 0; i < n; i++) {
    L[i] = (L[i] * 0.4 + 0.05 * whine[i] + 0.5 * dust[i] + air[i] + bright[i] * 0.18) * breathe[i];
    R[i] = (R[i] * 0.4 + 0.05 * whine[i] + 0.5 * dust[i] * 0.8 + air[i] + bright[i] * 0.18) * breathe[i];
  }
  const g = env(n, [[0, 0], [0.45, 1], [dur - 0.5, 1], [dur, 0]], 'smooth');
  for (let i = 0; i < n; i++) { L[i] *= g[i]; R[i] *= g[i]; }
  const out = verb(Buf.from(L, R), 'room', 0.18, 0);
  return { buf: fin(out, { peak: -21, fadeIn: 0.01, fadeOut: 0.05 }), send: -30 };
}

/** eyes open: two soft glass pops (L then R) + a tinkle cascade of tiny glass pings in A minor (E6 first = piano E4 x4) */
function eyes_open(ev, c) {
  const n = S(2.0), r = c.rng('eo'), m = new Buf(2.0);
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
  const out = verb(m, 'plate', 0.4, 0.6);
  return { buf: fin(out, { peak: -12, fadeOut: 0.3 }), send: -26 };
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
  const out = verb(wide(mono, 0.3, c.seed('w2')), 'room', 0.18, 0.3);
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
    const amp = (0.12 + 0.88 * Math.pow(h.u, 1.5)) * h.a;
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
  const out = verb(m, 'chamber', 0.2, 0.4);
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
  const n = S(2.0), r = c.rng('sp');
  const lad = [698.46, 880, 1046.5, 1318.5, 1396.9, 1760, 2093, 2637, 2793.8, 3520];
  const m = new Buf(2.0);
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

// @@PART2@@

export const recipes = {
  projector_motor, lamp_ignite, beam_hum, eyes_open, riser_short, matte_slide, iris_click, dive_whoosh,
  crank_loop, train_chuff, train_whistle, curtain_swish, magic_poof, sparkle_up, card_thunk,
};

/** soft fallback tick for unknown ids (the dispatcher warns loudly) */
export function fallbackTick(ev, c) {
  const n = S(0.12);
  const x = sum([modal(n, [[1900, 1, 0.007], [3300, 0.4, 0.004]]), scaleA(mulA(hp(nz(n, c.seed('f'), 0.5), 3000), perc(n, 0.001, 0.0001)), 0.4)]);
  return { buf: fin(wide(x, 0.3, 3), { peak: -26, fadeOut: 0.05 }), send: -40 };
}

export const kit = { S, Z, fromFn, glideExp, sweep, sine, nz, lp, hp, bp, lp4, hp4, edge, addTo, mulA, scaleA, env, perc, thump, modal, poisson, stereo, wide, panSweep, widthEnv, put, verb, padTo, fin, hzNearPc, chordAt, rootPcAt, sum, tame, bellStrike, PCS };
