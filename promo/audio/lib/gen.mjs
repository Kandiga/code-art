// =============================================================================
// gen.mjs - oscillators, noise, LFOs, envelopes, curve helpers, tiny array ops.
// All generators return fresh Float32Array(n) (mono). Wrap with Buf.fromMono().
// =============================================================================
import { SR, TWO_PI, mulberry32, clamp, P } from './core.mjs';

// ---------------------------------------------------------------------------
// band-limited oscillators (polyBLEP / polyBLAMP)
// ---------------------------------------------------------------------------
function blep(t, dt) {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}
function blamp(t, dt) {
  if (t < dt) {
    t = t / dt - 1;
    return (-1 / 3) * t * t * t;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt + 1;
    return (1 / 3) * t * t * t;
  }
  return 0;
}

/**
 * osc(type, freq, n, {phase=0, width=0.5, sr=SR, pm=null, centered=true})
 *  type: 'sine'|'saw'|'square'|'tri'|'pulse' ('ramp' = falling saw)
 *  freq: Hz scalar or Float32Array (per sample => glides/vibrato/FM)
 *  width: pulse width 0..1 (scalar or Float32Array = PWM)
 *  pm: optional Float32Array phase-modulation in cycles (sine only; FM/PM synthesis)
 *  phase: start phase in cycles 0..1
 */
export function osc(type, freq, n, opts = {}) {
  const { phase = 0, width = 0.5, sr = SR, pm = null, centered = true } = opts;
  const out = new Float32Array(n);
  const fa = typeof freq === 'number' ? null : freq;
  const fc = fa ? 0 : freq / sr;
  let ph = phase - Math.floor(phase);
  const wa = typeof width === 'number' ? null : width;
  switch (type) {
    case 'sine':
      if (pm) for (let i = 0; i < n; i++) {
        out[i] = Math.sin(TWO_PI * (ph + pm[i]));
        ph += fa ? fa[i] / sr : fc;
        ph -= Math.floor(ph);
      } else for (let i = 0; i < n; i++) {
        out[i] = Math.sin(TWO_PI * ph);
        ph += fa ? fa[i] / sr : fc;
        ph -= Math.floor(ph);
      }
      break;
    case 'saw':
    case 'ramp': {
      const sgn = type === 'ramp' ? -1 : 1;
      for (let i = 0; i < n; i++) {
        const dt = fa ? fa[i] / sr : fc;
        out[i] = sgn * (2 * ph - 1 - blep(ph, dt));
        ph += dt;
        ph -= Math.floor(ph);
      }
      break;
    }
    case 'square':
    case 'pulse': {
      const isSq = type === 'square';
      for (let i = 0; i < n; i++) {
        const dt = fa ? fa[i] / sr : fc;
        const w = isSq ? 0.5 : clamp(wa ? wa[i] : width, 0.02, 0.98);
        let v = ph < w ? 1 : -1;
        v += blep(ph, dt);
        let q = ph + 1 - w;
        if (q >= 1) q -= 1;
        v -= blep(q, dt);
        if (centered && !isSq) v -= 2 * w - 1;
        out[i] = v;
        ph += dt;
        ph -= Math.floor(ph);
      }
      break;
    }
    case 'tri': {
      // naive triangle (-1 at ph=0, +1 at 0.5) + polyBLAMP at both slope breaks
      for (let i = 0; i < n; i++) {
        const dt = fa ? fa[i] / sr : fc;
        let v = ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph;
        v += 8 * dt * blamp(ph, dt); // slope +8 (per cycle) at the wrap
        let q = ph + 0.5;
        if (q >= 1) q -= 1;
        v -= 8 * dt * blamp(q, dt); // slope -8 at the apex
        out[i] = v;
        ph += dt;
        ph -= Math.floor(ph);
      }
      break;
    }
    default:
      throw new Error(`osc: unknown type "${type}"`);
  }
  return out;
}

/**
 * Detuned unison stack (supersaw / ensemble pad / brass layer). Returns a stereo Buf-like {L,R}
 * opts: {voices=7, detuneCents=14, spread=0.8, type='saw', seed=1, width=0.5, gainDb=0, phaseRandom=true}
 */
export function unison(type, freq, n, opts = {}) {
  const { voices = 7, detuneCents = 14, spread = 0.8, seed = 1, width = 0.5, sr = SR, phaseRandom = true } = opts;
  const rng = mulberry32(seed);
  const L = new Float32Array(n), R = new Float32Array(n);
  const norm = 1 / Math.sqrt(voices);
  const fa = typeof freq === 'number' ? null : freq;
  const tmp = fa ? new Float32Array(n) : null;
  for (let v = 0; v < voices; v++) {
    const pos = voices === 1 ? 0 : (v / (voices - 1)) * 2 - 1; // -1..1
    const cents = pos * detuneCents + (rng() - 0.5) * 0.1 * detuneCents;
    const ratio = Math.pow(2, cents / 1200);
    let f;
    if (fa) {
      for (let i = 0; i < n; i++) tmp[i] = fa[i] * ratio;
      f = tmp;
    } else f = freq * ratio;
    const o = osc(type, f, n, { phase: phaseRandom ? rng() : 0, width, sr });
    const [gl, gr] = [Math.cos(((pos * spread + 1) * Math.PI) / 4), Math.sin(((pos * spread + 1) * Math.PI) / 4)];
    for (let i = 0; i < n; i++) {
      L[i] += o[i] * gl * norm;
      R[i] += o[i] * gr * norm;
    }
  }
  return { L, R };
}

// ---------------------------------------------------------------------------
// noise
// ---------------------------------------------------------------------------
// RMS calibration constants (so every colour has comparable level; default rms 0.3 = -10.5 dBFS)
let _pinkCal = 0, _brownCal = 0;
function pinkRaw(n, rng) {
  const out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = rng() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }
  return out;
}
function brownRaw(n, rng) {
  const out = new Float32Array(n);
  let y = 0;
  for (let i = 0; i < n; i++) {
    y = (y + 0.02 * (rng() * 2 - 1)) / 1.02;
    out[i] = y;
  }
  return out;
}
function rmsOf(x, skip = 0) {
  let s = 0;
  for (let i = skip; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, x.length - skip));
}
function calib() {
  if (_pinkCal) return;
  const r = rmsOf(pinkRaw(200000, mulberry32(777)), 2000);
  _pinkCal = r;
  _brownCal = rmsOf(brownRaw(400000, mulberry32(778)), 5000);
}

/**
 * noise(type, n, seed=1, {rms=0.3})  type: 'white'(uniform)|'gauss'|'pink'|'brown'|'blue'|'violet'
 * All colours are scaled to the same RMS (default 0.3 = -10.5 dBFS) so they are interchangeable.
 */
export function noise(type, n, seed = 1, opts = {}) {
  const rms = opts.rms != null ? opts.rms : 0.3;
  const rng = mulberry32(seed);
  const out = new Float32Array(n);
  switch (type) {
    case 'white': {
      const a = rms * Math.sqrt(3);
      for (let i = 0; i < n; i++) out[i] = (rng() * 2 - 1) * a;
      break;
    }
    case 'gauss':
      for (let i = 0; i < n; i++) out[i] = rng.gauss() * rms;
      break;
    case 'pink': {
      calib();
      const p = pinkRaw(n, rng);
      const k = rms / _pinkCal;
      for (let i = 0; i < n; i++) out[i] = p[i] * k;
      break;
    }
    case 'brown': {
      calib();
      const p = brownRaw(n, rng);
      const k = rms / _brownCal;
      for (let i = 0; i < n; i++) out[i] = p[i] * k;
      break;
    }
    case 'blue':
    case 'violet': {
      // differentiate white (+6 dB/oct) once (blue ~ +3 approximated by pink-difference) or twice (violet)
      const src = type === 'blue' ? pinkRaw(n + 1, rng) : noise('white', n + 2, seed, { rms: 1 });
      if (type === 'blue') for (let i = 0; i < n; i++) out[i] = src[i + 1] - src[i];
      else for (let i = 0; i < n; i++) out[i] = src[i + 2] - 2 * src[i + 1] + src[i];
      const k = rms / Math.max(1e-9, rmsOf(out));
      for (let i = 0; i < n; i++) out[i] *= k;
      break;
    }
    default:
      throw new Error(`noise: unknown type "${type}"`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// LFOs and slow random drift (modulators; output in [min,max])
// ---------------------------------------------------------------------------
/**
 * lfo(shape, rate, n, {phase=0, min=-1, max=1, seed=1, sr})
 * shape: 'sine'|'tri'|'saw'|'square'|'sh' (sample&hold)|'smooth' (smooth random). rate Hz scalar|array.
 */
export function lfo(shape, rate, n, opts = {}) {
  const { phase = 0, min = -1, max = 1, seed = 1, sr = SR } = opts;
  const out = new Float32Array(n);
  const ra = typeof rate === 'number' ? null : rate;
  let ph = phase - Math.floor(phase);
  const mid = (max + min) / 2, amp = (max - min) / 2;
  const rng = mulberry32(seed);
  let sh = rng() * 2 - 1, a0 = sh, a1 = rng() * 2 - 1;
  for (let i = 0; i < n; i++) {
    const f = ra ? ra[i] : rate;
    let v;
    switch (shape) {
      case 'sine': v = Math.sin(TWO_PI * ph); break;
      case 'tri': v = ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph; break;
      case 'saw': v = 2 * ph - 1; break;
      case 'square': v = ph < 0.5 ? 1 : -1; break;
      case 'sh': v = sh; break;
      case 'smooth': {
        const t = ph * ph * (3 - 2 * ph);
        v = a0 + (a1 - a0) * t;
        break;
      }
      default: throw new Error(`lfo: unknown shape "${shape}"`);
    }
    out[i] = mid + amp * v;
    const prev = ph;
    ph += f / sr;
    if (ph >= 1) {
      ph -= Math.floor(ph);
      sh = rng() * 2 - 1;
      a0 = a1;
      a1 = rng() * 2 - 1;
    }
    void prev;
  }
  return out;
}

/** smooth random drift (tape wobble / vibrato jitter): value in [-depth,+depth] changing at ~rateHz */
export function drift(n, rateHz = 0.7, depth = 1, seed = 1, sr = SR) {
  return lfo('smooth', rateHz, n, { min: -depth, max: depth, seed, sr });
}

// ---------------------------------------------------------------------------
// envelopes
// ---------------------------------------------------------------------------
// shape of a falling segment 1->0 over x in [0,1]; k>0 exponential, 0 linear, k<0 slow-start
function fall(x, k) {
  if (x <= 0) return 1;
  if (x >= 1) return 0;
  if (k === 0) return 1 - x;
  if (k > 0) return (Math.exp(-k * x) - Math.exp(-k)) / (1 - Math.exp(-k));
  const kk = -k;
  return 1 - (Math.exp(kk * x) - 1) / (Math.exp(kk) - 1);
}

/**
 * adsr(n, {a,d,s,r, aCurve=0, dCurve=4, rCurve=4, sr})
 * a,d,r in seconds; s = sustain level 0..1. Release finishes exactly at sample n (gate ends at n-r).
 * curves: 0 linear, >0 exponential (bigger = steeper), <0 slow-start.
 */
export function adsr(n, opts = {}) {
  const { a = 0.01, d = 0.1, s = 0.7, r = 0.2, aCurve = 0, dCurve = 4, rCurve = 4, sr = SR } = opts;
  const out = new Float32Array(n);
  let rN = Math.min(n, Math.max(1, Math.round(r * sr)));
  const tRel = n - rN;
  const aN = Math.max(1, Math.round(a * sr)), dN = Math.max(1, Math.round(d * sr));
  const level = (i) => {
    if (i < aN) return 1 - fall(i / aN, aCurve);
    if (i < aN + dN) return s + (1 - s) * fall((i - aN) / dN, dCurve);
    return s;
  };
  const relLevel = level(Math.max(0, tRel - 1));
  for (let i = 0; i < n; i++) {
    out[i] = i < tRel ? level(i) : relLevel * fall((i - tRel) / rN, rCurve);
  }
  return out;
}

/** exponential decay: start * exp(-t/tau). tau seconds (time constant, -8.7 dB per tau). */
export function expDecay(n, tau, opts = {}) {
  const { start = 1, sr = SR } = opts;
  const out = new Float32Array(n);
  const k = Math.exp(-1 / (Math.max(1e-6, tau) * sr));
  let v = start;
  for (let i = 0; i < n; i++) {
    out[i] = v;
    v *= k;
  }
  return out;
}

/** percussive envelope: linear attack (a sec) then exponential decay (tau sec) */
export function perc(n, opts = {}) {
  const { a = 0.002, tau = 0.2, sr = SR } = opts;
  const out = new Float32Array(n);
  const aN = Math.max(1, Math.round(a * sr));
  const k = Math.exp(-1 / (Math.max(1e-6, tau) * sr));
  let v = 1;
  for (let i = 0; i < n; i++) {
    out[i] = i < aN ? i / aN : v;
    if (i >= aN) v *= k;
  }
  return out;
}

/**
 * Breakpoint curve. pts = [[tSec, value], ...] (sorted by time; held before first / after last).
 * mode: 'lin' | 'exp' (geometric, values must be > 0) | 'smooth' (smoothstep) | 'cos' | 'hold' (step)
 * t is relative to the start of the array (add your own offset).
 */
export function curve(n, pts, opts = {}) {
  const mode = typeof opts === 'string' ? opts : opts.mode || 'lin';
  const sr = (opts && opts.sr) || SR;
  const out = new Float32Array(n);
  if (!pts.length) return out;
  let k = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    while (k < pts.length - 1 && t >= pts[k + 1][0]) k++;
    if (t <= pts[0][0] || k >= pts.length - 1) {
      out[i] = t <= pts[0][0] ? pts[0][1] : pts[pts.length - 1][1];
      continue;
    }
    const [t0, v0] = pts[k], [t1, v1] = pts[k + 1];
    let x = (t - t0) / (t1 - t0);
    if (mode === 'hold') out[i] = v0;
    else {
      if (mode === 'smooth') x = x * x * (3 - 2 * x);
      else if (mode === 'cos') x = 0.5 - 0.5 * Math.cos(Math.PI * x);
      out[i] = mode === 'exp' ? v0 * Math.pow(v1 / v0, x) : v0 + (v1 - v0) * x;
    }
  }
  return out;
}
export const breakpoints = curve;
/** linear ramp a->b over n samples */
export function ramp(n, a, b, mode = 'lin') {
  const out = new Float32Array(n);
  const d = Math.max(1, n - 1);
  for (let i = 0; i < n; i++) {
    const x = i / d;
    out[i] = mode === 'exp' ? a * Math.pow(b / a, x) : a + (b - a) * x;
  }
  return out;
}
export const constant = (n, v) => new Float32Array(n).fill(v);

/**
 * Gate/region envelope from time regions: [[t0,t1,level=1],...] -> smooth 0..1 (attack/release in sec).
 * Use for VO ducking, stem automation, etc.  n = length in samples; times in seconds from array start.
 */
export function regionEnv(n, regions, opts = {}) {
  const { attack = 0.05, release = 0.3, hold = 0, sr = SR } = opts;
  const g = new Float32Array(n);
  for (const r of regions) {
    const a = clamp(Math.round(r[0] * sr), 0, n), b = clamp(Math.round((r[1] + hold) * sr), 0, n);
    const lv = r.length > 2 ? r[2] : 1;
    for (let i = a; i < b; i++) if (lv > g[i]) g[i] = lv;
  }
  return slew(g, attack, release, sr);
}
/** asymmetric one-pole smoothing of a control signal (attack when rising, release when falling; seconds). */
export function slew(x, attack = 0.01, release = 0.1, sr = SR) {
  const out = new Float32Array(x.length);
  const ka = attack <= 0 ? 0 : Math.exp(-1 / (attack * sr));
  const kr = release <= 0 ? 0 : Math.exp(-1 / (release * sr));
  let y = x.length ? x[0] : 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const k = v > y ? ka : kr;
    y = k * y + (1 - k) * v;
    out[i] = y;
  }
  return out;
}

// ---------------------------------------------------------------------------
// FM / physical-ish building blocks
// ---------------------------------------------------------------------------
/**
 * 2-operator FM. freq Hz (scalar|array); opts {ratio=1, index=1 (scalar|array, in radians), feedback=0}
 * out = sin(2pi*fc*t + index*sin(2pi*fc*ratio*t))
 */
export function fmOsc(freq, n, opts = {}) {
  const { ratio = 1, index = 1, feedback = 0, phase = 0, sr = SR } = opts;
  const out = new Float32Array(n);
  let pc = phase, pm = 0, last = 0;
  for (let i = 0; i < n; i++) {
    const f = P(freq, i) / sr;
    const mod = Math.sin(TWO_PI * pm + feedback * last);
    last = mod;
    out[i] = Math.sin(TWO_PI * pc + P(index, i) * mod);
    pc += f;
    pm += f * ratio;
    pc -= Math.floor(pc);
    pm -= Math.floor(pm);
  }
  return out;
}

/** Karplus-Strong plucked string. opts {decay=0.996 (per period feedback), damp=0.5, seed=1, bright=1} */
export function karplus(freq, n, opts = {}) {
  const { decay = 0.996, damp = 0.5, seed = 1, sr = SR } = opts;
  const out = new Float32Array(n);
  const rng = mulberry32(seed);
  const period = sr / freq;
  const len = Math.max(2, Math.floor(period));
  const frac = period - len;
  const line = new Float32Array(len + 1);
  for (let i = 0; i < len + 1; i++) line[i] = rng() * 2 - 1;
  // lowpass the excitation a little so low notes are not hissy
  let lp = 0;
  for (let i = 0; i < len + 1; i++) {
    lp += (line[i] - lp) * (opts.bright != null ? opts.bright : 1);
    line[i] = lp;
  }
  let p = 0, prev = 0;
  const a = (1 - frac) / (1 + frac); // allpass fractional-delay coefficient
  let apx = 0, apy = 0;
  for (let i = 0; i < n; i++) {
    const cur = line[p];
    out[i] = cur;
    const nxt = line[(p + 1) % (len + 1)];
    let v = (1 - damp * 0.5) * cur + damp * 0.5 * nxt; // damped averaging
    const y = a * (v - apy) + apx; // allpass for tuning
    apx = v;
    apy = y;
    line[p] = y * decay;
    p = (p + 1) % (len + 1);
    prev = cur;
  }
  void prev;
  return out;
}

/** additive: sum of partials. partials = [[ratio, amp], ...] relative to freq (scalar|array) */
export function additive(freq, n, partials, opts = {}) {
  const { sr = SR, phase = 0 } = opts;
  const out = new Float32Array(n);
  const fa = typeof freq === 'number' ? null : freq;
  for (const [ratio, amp] of partials) {
    let ph = phase;
    for (let i = 0; i < n; i++) {
      const f = (fa ? fa[i] : freq) * ratio;
      if (f < sr * 0.49) out[i] += amp * Math.sin(TWO_PI * ph);
      ph += f / sr;
      ph -= Math.floor(ph);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// tiny array ops (return new arrays; *InPlace variants mutate the first arg)
// ---------------------------------------------------------------------------
export function mul(a, b) {
  const n = Math.min(a.length, b.length), o = new Float32Array(a.length);
  for (let i = 0; i < n; i++) o[i] = a[i] * b[i];
  return o;
}
export function mulInPlace(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) a[i] *= b[i];
  for (let i = n; i < a.length; i++) a[i] = 0;
  return a;
}
export function add(a, b, g = 1) {
  const o = Float32Array.from(a);
  for (let i = 0; i < Math.min(a.length, b.length); i++) o[i] += b[i] * g;
  return o;
}
export function addInPlace(dst, src, offset = 0, g = 1) {
  for (let i = 0; i < src.length; i++) {
    const j = i + offset;
    if (j >= 0 && j < dst.length) dst[j] += src[i] * g;
  }
  return dst;
}
export function scaleArr(a, g) {
  const o = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) o[i] = a[i] * g;
  return o;
}
export function mixArrays(list) {
  let n = 0;
  for (const a of list) n = Math.max(n, a.length);
  const o = new Float32Array(n);
  for (const a of list) for (let i = 0; i < a.length; i++) o[i] += a[i];
  return o;
}
/** Hz array from a [midi...] or glide helper: glide(f0, f1, n, 'exp') */
export function glide(f0, f1, n, mode = 'exp', curveK = 0) {
  const o = new Float32Array(n);
  const d = Math.max(1, n - 1);
  for (let i = 0; i < n; i++) {
    let x = i / d;
    if (curveK) x = (Math.exp(curveK * x) - 1) / (Math.exp(curveK) - 1);
    o[i] = mode === 'exp' ? f0 * Math.pow(f1 / f0, x) : f0 + (f1 - f0) * x;
  }
  return o;
}
