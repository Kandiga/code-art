// =============================================================================
// instruments/common.mjs - the tiny engine every instrument is built on.
//
//   defineInstrument(spec) -> inst        registers {id, render(notes, opts), voice, bus, reverb, ...}
//   spec.voice(ev, ctx)  renders ONE note into a local array (starting at the note's onset)
//   spec.bus(buf, ctx)   optional dry bus processing of each contiguous "segment" of notes (chorus, EQ ...)
//
// render(notes, opts) -> Buf   notes in GLOBAL film time [{t, dur, midi, vel, pan?, ...}]
//   * voices are rendered per note (seeded RNG per note => deterministic, every note slightly different)
//   * notes that overlap / follow closely are grouped into segments; the bus processor runs once per segment, so
//     a sparse 60 s part costs only the seconds that actually sound (the rest of the Buf stays digital silence)
//   * a voice may return {L,R,lead} / {m,lead} / Float32Array. `lead` (seconds) = how much EARLIER than ev.t the array
//     starts: slow-attack voices (strings, pads, choir) put their perceived onset (~30 % into the swell) on the grid.
// =============================================================================
import * as dsp from '../../lib/dsp.mjs';
import * as cues from '../../../shared/cues.js';
import LEVELS from './levels.mjs';

export const { SR, Buf } = dsp;
export const TAU = Math.PI * 2;
export { dsp, cues };
const { mulberry32, seedOf, midiToHz, dbToLin, panGains, balanceGains, isBuf, fastTanh } = dsp;

export const REGISTRY = new Map();

// ---------------------------------------------------------------------------------------------------------------
// small numeric helpers
// ---------------------------------------------------------------------------------------------------------------
export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const mix = lerp;
/** log-frequency interpolation helper for register-dependent parameters: reg(m, [[36,a],[60,b],[84,c]]) */
export function reg(m, pts) {
  if (m <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (m <= pts[i][0]) {
      const [m0, v0] = pts[i - 1], [m1, v1] = pts[i];
      return v0 + ((v1 - v0) * (m - m0)) / (m1 - m0);
    }
  }
  return pts[pts.length - 1][1];
}
/** cents -> frequency ratio (cheap, accurate to < 0.3 cent for |c| < 40) */
export const cents = (c) => 1 + c * 5.775e-4 + c * c * 1.668e-7;
export const centsExact = (c) => Math.pow(2, c / 1200);
export const ns = (sec) => Math.max(1, Math.round(sec * SR));

/** unity-centre constant-power pan gains for a mono source */
export const pg = (pan) => panGains(clamp(pan || 0, -1, 1), true);

/** mono Float32Array + pan -> {L,R} */
export function pan2(m, pan = 0) {
  if (!pan) return { L: m, R: Float32Array.from(m) };
  const [gl, gr] = pg(pan);
  const L = new Float32Array(m.length), R = new Float32Array(m.length);
  for (let i = 0; i < m.length; i++) { L[i] = m[i] * gl; R[i] = m[i] * gr; }
  return { L, R };
}

/** add src (mono) into dst at integer offset with gain (in place). */
export function mixInto(dst, src, off = 0, g = 1) {
  const n = dst.length;
  for (let i = 0, j = off; i < src.length; i++, j++) {
    if (j >= n) break;
    if (j >= 0) dst[j] += src[i] * g;
  }
  return dst;
}
export function mixIntoPan(L, R, src, off, g, pan) {
  const [gl, gr] = pg(pan);
  const n = L.length;
  for (let i = 0, j = off; i < src.length; i++, j++) {
    if (j >= n) break;
    if (j >= 0) { L[j] += src[i] * g * gl; R[j] += src[i] * g * gr; }
  }
}

/** micro fade-in (half cosine) over `samples` to remove start clicks. in place */
export function fadeInArr(x, samples = 24) {
  const k = Math.min(samples, x.length);
  for (let i = 0; i < k; i++) x[i] *= 0.5 - 0.5 * Math.cos((Math.PI * (i + 0.5)) / k);
  return x;
}
/** multiply the last `samples` by a half-cosine to zero (in place) so a truncated tail never clicks */
export function fadeOutArr(x, samples = 64) {
  const n = x.length, k = Math.min(samples, n);
  for (let i = 0; i < k; i++) x[n - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * (i + 0.5)) / k);
  return x;
}
/** exponential release applied in place from sample `from` with time constant relSec (RT60 ~ 6.9 tau). */
export function releaseTail(x, from, relSec, floor = 1e-4) {
  const n = x.length;
  const tau = Math.max(1e-4, relSec / 6.9);
  const k = Math.exp(-1 / (tau * SR));
  let g = 1;
  for (let i = Math.max(0, from); i < n; i++) {
    x[i] *= g;
    g *= k;
    if (g < floor) { for (let j = i + 1; j < n; j++) x[j] = 0; break; }
  }
  return x;
}

/** damped sinusoid z_k = amp * r^k * e^{i(wk+phase)} accumulated into (L, R) with pan; R may be null (mono into L). */
export function addDamped(L, R, f, amp, tau, phase = 0, pan = 0, start = 0, maxLen = Infinity, thresh = 3e-4) {
  if (f <= 0 || f >= SR * 0.47 || amp === 0) return;
  const w = (TAU * f) / SR;
  const r = Math.exp(-1 / (Math.max(1e-4, tau) * SR));
  const c = r * Math.cos(w), s = r * Math.sin(w);
  let re = amp * Math.cos(phase), im = amp * Math.sin(phase);
  const n = L.length - start;
  const nMax = Math.min(n, maxLen, Math.ceil((-Math.log(thresh) * tau) * SR));
  if (R) {
    const [gl, gr] = pg(pan);
    for (let i = 0, j = start; i < nMax; i++, j++) {
      L[j] += im * gl; R[j] += im * gr;
      const nr = c * re - s * im;
      im = s * re + c * im;
      re = nr;
    }
  } else {
    for (let i = 0, j = start; i < nMax; i++, j++) {
      L[j] += im;
      const nr = c * re - s * im;
      im = s * re + c * im;
      re = nr;
    }
  }
}

/** vibrato / drift multiplier array: 1 + depth(t) * sin(...) (cents). onset delay + fade-in, wandering rate. */
export function vibrato(n, { rate = 5.5, cents: depth = 8, delay = 0.25, fade = 0.5, rng, rateJitter = 0.08, phase = null } = {}) {
  const out = new Float32Array(n);
  let ph = phase != null ? phase : rng ? rng() : 0;
  const dl = delay * SR, fd = Math.max(1, fade * SR);
  // slow random walk for the rate
  const wander = dsp.drift(n, 0.5, rateJitter, rng ? Math.floor(rng() * 1e9) : 3);
  for (let i = 0; i < n; i++) {
    const a = i < dl ? 0 : Math.min(1, (i - dl) / fd);
    const c = depth * a * Math.sin(TAU * ph);
    out[i] = 1 + c * 5.775e-4 + c * c * 1.668e-7;
    ph += (rate * (1 + wander[i])) / SR;
    if (ph >= 1) ph -= 1;
  }
  return out;
}

/**
 * pitchMod(n, f0, opts) -> Float32Array of instantaneous Hz (single pass): vibrato (onset delay + fade-in, wandering rate)
 * + slow random-ish drift + static detune + lip scoop (flat start that settles).
 * opts {rate=5.5, cents=8, delay=0.25, fade=0.5, rng, rateJitter=0.08, drift=1.4 (cents), detune=0 (cents), scoop=0 (cents), scoopTau=0.05}
 */
export function pitchMod(n, f0, o = {}) {
  const { rate = 5.5, cents: depth = 8, delay = 0.25, fade = 0.5, rng, rateJitter = 0.08, drift: dcents = 1.4, detune = 0, scoop = 0, scoopTau = 0.05 } = o;
  const out = new Float32Array(n);
  const r = rng || (() => 0.5);
  let ph = r(), dph = r(), jph = r();
  const dRate = (0.25 + 0.45 * r()) / SR, jRate = (0.3 + 0.3 * r()) / SR;
  const dl = delay * SR, fd = Math.max(1, fade * SR);
  const base = f0 * (1 + detune * 5.775e-4 + detune * detune * 1.668e-7);
  const ks = scoop ? Math.exp(-1 / (scoopTau * SR)) : 0;
  let se = scoop;
  let rt = rate / SR;
  for (let i = 0; i < n; i++) {
    const a = i < dl ? 0 : i - dl > fd ? 1 : (i - dl) / fd;
    const c = depth * a * Math.sin(TAU * ph) + dcents * Math.sin(TAU * dph) - se;
    out[i] = base * (1 + c * 5.775e-4 + c * c * 1.668e-7);
    ph += rt; if (ph >= 1) ph -= 1;
    dph += dRate; if (dph >= 1) dph -= 1;
    jph += jRate; if (jph >= 1) jph -= 1;
    if ((i & 511) === 0) rt = (rate * (1 + rateJitter * Math.sin(TAU * jph))) / SR;
    se *= ks;
  }
  return out;
}

/** slow LFO (sine) evaluated every `step` samples and linearly interpolated: mid + depth*sin(2 pi (rate t + phase)) */
export function slowLfo(n, rateHz, mid, depth, phase = 0, step = 48) {
  const out = new Float32Array(n);
  let prev = mid + depth * Math.sin(TAU * phase), next = prev, base = 0;
  for (let i = 0; i < n; i++) {
    if (i % step === 0) { base = i; prev = next; next = mid + depth * Math.sin(TAU * (rateHz * (i + step) / SR + phase)); }
    out[i] = prev + (next - prev) * ((i - base) / step);
  }
  return out;
}

/** velocity -> linear amplitude (perceptual-ish curve) */
export const velAmp = (v, k = 1.35) => Math.pow(clamp(v, 0, 1.2), k);

/** in-place tanh drive */
export function drive(x, d, normalise = true) {
  const k = normalise ? 1 / Math.tanh(d) : 1;
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * d) * k;
  return x;
}
export function softSat(x, d) {
  for (let i = 0; i < x.length; i++) x[i] = fastTanh(x[i] * d);
  return x;
}

/** peak-normalise a mono array to `peak` (in place); returns the gain applied */
export function normPeak(x, peak = 1) {
  let p = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > p) p = a; }
  if (p < 1e-12) return 1;
  const g = peak / p;
  for (let i = 0; i < x.length; i++) x[i] *= g;
  return g;
}

/** exponential envelope generator: value(t) = exp(-t/tau) over n samples */
export function expEnv(n, tau, from = 0) {
  const out = new Float32Array(n);
  const k = Math.exp(-1 / (Math.max(1e-5, tau) * SR));
  let v = from > 0 ? Math.pow(k, from * SR) : 1;
  for (let i = 0; i < n; i++) { out[i] = v; v *= k; }
  return out;
}

/**
 * Piecewise envelope. pts [[sec, level], ...] (monotonic time). modes: 'lin' | 'exp' (geometric between >0 levels) | 'cos'.
 * Held at the last level.  n = number of samples.
 */
export function pw(n, pts, mode = 'lin') {
  return dsp.curve(n, pts, mode);
}

/** stereo from two mono arrays (copy-free). */
export const st = (L, R) => ({ L, R });

// ---------------------------------------------------------------------------------------------------------------
// instrument definition + the render engine
// ---------------------------------------------------------------------------------------------------------------
/**
 * spec: {
 *   id, name, family ('keys'|'strings'|'brass'|'winds'|'choir'|'perc'|'synth'|'fx'), desc,
 *   voice(ev, ctx) -> array|{L,R,lead}|{m,lead},   ev = {t,dur,midi,vel,pan,...}, ctx = {hz, rng, o (opts), i, id}
 *   bus?(seg: Buf, ctx{o, t0}) -> Buf         dry character, once per segment
 *   busTail?: seconds of room after the last note of a segment (default 0.05)
 *   defaults: {...}  options: {name: 'description'} (docs)
 *   reverb: {preset, wet, ...}  recommended send   gainDb: calibration trim   defaultMidi / defaultDur
 *   range?: [lo, hi] playable midi range (docs + tests)
 * }
 */
export function defineInstrument(spec) {
  const inst = {
    ...spec,
    kind: spec.kind || 'pitched',
    defaults: spec.defaults || {},
    options: spec.options || {},
    reverb: spec.reverb || { preset: 'hall', wet: 0.25 },
    gainDb: LEVELS[spec.id] != null ? LEVELS[spec.id] : spec.gainDb || 0,
    render(notes, opts = {}) {
      return renderNotes(inst, notes, opts);
    },
  };
  REGISTRY.set(spec.id, inst);
  return inst;
}

function normalise(n, inst, o, i) {
  const t = +n.t;
  if (!Number.isFinite(t)) throw new Error(`${inst.id}: note ${i} has no finite t`);
  const ev = { ...n, t };
  ev.dur = n.dur != null ? +n.dur : inst.defaultDur != null ? inst.defaultDur : 0.5;
  ev.vel = n.vel != null ? n.vel : 0.8;
  ev.pan = (n.pan || 0) + (o.pan || 0);
  if (n.midi != null || inst.defaultMidi != null) ev.midi = (n.midi != null ? n.midi : inst.defaultMidi) + (o.transpose || 0) + 12 * (o.octave || 0);
  return ev;
}

export function renderNotes(inst, notes, opts = {}) {
  const o = { ...inst.defaults, ...opts };
  const seconds = o.seconds != null ? o.seconds : cues.DURATION;
  const out = o.buf || new Buf(seconds);
  if (!notes || !notes.length) return out;
  const seed = o.seed != null ? o.seed : 1;
  const g = dbToLin(inst.gainDb + (o.gainDb || 0));
  const outSec = out.length / SR;
  const evs = notes.map((n, i) => normalise(n, inst, o, i)).filter((e) => e.t < outSec && e.dur > -1).sort((a, b) => a.t - b.t);

  // 1. render every voice
  const voiced = [];
  evs.forEach((ev, i) => {
    const rng = mulberry32(seedOf(seed, inst.id, i, Math.round(ev.t * 1000), ev.midi != null ? ev.midi : 0));
    const raw = inst.voice(ev, { hz: ev.midi != null ? midiToHz(ev.midi) : 0, rng, o, i, id: inst.id });
    if (!raw) return;
    let L, R, lead = 0;
    if (raw instanceof Float32Array) ({ L, R } = pan2(raw, ev.pan));
    else if (raw.m) {
      lead = raw.lead || 0;
      ({ L, R } = pan2(raw.m, ev.pan));
    } else {
      lead = raw.lead || 0;
      L = raw.L; R = raw.R;
      if (ev.pan) {
        const [gl, gr] = balanceGains(clamp(ev.pan, -1, 1));
        if (gl !== 1) for (let k = 0; k < L.length; k++) L[k] *= gl;
        if (gr !== 1) for (let k = 0; k < R.length; k++) R[k] *= gr;
      }
    }
    const evg = ev.gainDb ? dbToLin(ev.gainDb) : 1;
    if (evg !== 1) { for (let k = 0; k < L.length; k++) { L[k] *= evg; R[k] *= evg; } }
    voiced.push({ s: Math.round((ev.t - lead) * SR), L, R });
  });
  if (!voiced.length) return out;

  // 2. group into segments (gap > segGap seconds of nothing) and mix, running the bus processor per segment
  const subHz = o.subHz != null ? o.subHz : inst.subHz != null ? inst.subHz : 22;
  const gap = Math.round((o.segGap != null ? o.segGap : 0.4) * SR);
  const tailN = Math.round((inst.busTail != null ? inst.busTail : 0.05) * SR);
  let i = 0;
  while (i < voiced.length) {
    let j = i, a = voiced[i].s, b = voiced[i].s + voiced[i].L.length;
    while (j + 1 < voiced.length && voiced[j + 1].s <= b + gap) {
      j++;
      b = Math.max(b, voiced[j].s + voiced[j].L.length);
    }
    const len = b - a + (inst.bus ? tailN : 0);
    let seg = Buf.from(new Float32Array(len), new Float32Array(len));
    for (let k = i; k <= j; k++) {
      const v = voiced[k], off = v.s - a;
      for (let q = 0; q < v.L.length; q++) { seg.L[off + q] += v.L[q]; seg.R[off + q] += v.R[q]; }
    }
    if (inst.bus) seg = inst.bus(seg, { o, t0: a / SR, inst, seed });
    if (subHz > 0) seg = dsp.biquad(seg, 'hp', subHz, 0.707); // subsonic guard (no energy wasted below the audible bass)
    dsp.addAt(out, seg, a / SR, 20 * Math.log10(g), 0);
    i = j + 1;
  }
  return out;
}

export const getInstrument = (id) => {
  const i = REGISTRY.get(id);
  if (!i) throw new Error(`unknown instrument "${id}" (have: ${[...REGISTRY.keys()].join(', ')})`);
  return i;
};
