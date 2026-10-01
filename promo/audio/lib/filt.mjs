// =============================================================================
// filt.mjs - biquad (RBJ), TPT state-variable, one-pole, ladder, formant bank,
// Butterworth helpers, DC blocker. Every cutoff / Q / gain parameter may be a
// scalar OR a Float32Array (per-sample modulation).
// All functions return NEW arrays (input untouched). Buf in -> Buf out where noted.
// =============================================================================
import { SR, TWO_PI, Buf, isBuf, isArr, P, clamp, perChannel, dbToLin } from './core.mjs';

// ---------------------------------------------------------------------------
// biquad
// ---------------------------------------------------------------------------
/**
 * RBJ cookbook coefficients, normalised: returns [b0,b1,b2,a1,a2] (a0 == 1).
 * type: lp|hp|bp|notch|peak|lowshelf|highshelf|allpass  (bp = constant 0 dB peak gain)
 */
export function biquadCoefs(type, f, q = Math.SQRT1_2, gainDb = 0, sr = SR) {
  f = clamp(f, 5, sr * 0.4999);
  q = Math.max(0.02, q);
  const w0 = (TWO_PI * f) / sr;
  const cw = Math.cos(w0), sw = Math.sin(w0);
  const alpha = sw / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  switch (type) {
    case 'lp': case 'lowpass':
      b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
    case 'hp': case 'highpass':
      b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
    case 'bp': case 'bandpass':
      b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
    case 'notch':
      b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
    case 'allpass': case 'ap':
      b0 = 1 - alpha; b1 = -2 * cw; b2 = 1 + alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
    case 'peak': case 'peaking': case 'bell': {
      const A = Math.pow(10, gainDb / 40);
      b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A; break;
    }
    case 'lowshelf': case 'ls': {
      const A = Math.pow(10, gainDb / 40), t = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) - (A - 1) * cw + t); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - t);
      a0 = (A + 1) + (A - 1) * cw + t; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - t; break;
    }
    case 'highshelf': case 'hs': {
      const A = Math.pow(10, gainDb / 40), t = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) + (A - 1) * cw + t); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - t);
      a0 = (A + 1) - (A - 1) * cw + t; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - t; break;
    }
    default:
      throw new Error(`biquad: unknown type "${type}"`);
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

/** magnitude response (linear) of normalised coefs at frequency f */
export function biquadMag(c, f, sr = SR) {
  const w = (TWO_PI * f) / sr;
  const cw = Math.cos(w), sw = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = c[0] + c[1] * cw + c[2] * c2, ni = -(c[1] * sw + c[2] * s2);
  const dr = 1 + c[3] * cw + c[4] * c2, di = -(c[3] * sw + c[4] * s2);
  return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
}

/**
 * biquad(x, type, freq, q=0.7071, gainDb=0, {sr, update=8})
 * freq/q/gainDb: scalar or Float32Array. When modulated, coefficients are refreshed every `update` samples.
 * x: Float32Array or Buf (processed per channel with the same modulation).
 */
export function biquad(x, type, freq, q = Math.SQRT1_2, gainDb = 0, opts = {}) {
  if (isBuf(x)) return perChannel(x, (c) => biquad(c, type, freq, q, gainDb, opts));
  const { sr = SR, update = 8 } = opts;
  const n = x.length;
  const out = new Float32Array(n);
  const mod = isArr(freq) || isArr(q) || isArr(gainDb);
  let [b0, b1, b2, a1, a2] = biquadCoefs(type, P(freq, 0), P(q, 0), P(gainDb, 0), sr);
  let z1 = 0, z2 = 0;
  for (let i = 0; i < n; i++) {
    if (mod && i % update === 0) [b0, b1, b2, a1, a2] = biquadCoefs(type, P(freq, i), P(q, i), P(gainDb, i), sr);
    const v = x[i];
    const y = b0 * v + z1;
    z1 = b1 * v - a1 * y + z2;
    z2 = b2 * v - a2 * y;
    out[i] = y;
  }
  return out;
}

/** cascade of biquads. stages: [{type, f, q?, g?}, ...]  (f/q/g may be arrays) */
export function biquadChain(x, stages, opts = {}) {
  if (isBuf(x)) return perChannel(x, (c) => biquadChain(c, stages, opts));
  let y = x;
  for (const s of stages) y = biquad(y, s.type, s.f != null ? s.f : s.freq, s.q != null ? s.q : Math.SQRT1_2, s.g != null ? s.g : s.gain || 0, opts);
  return y;
}
/** parametric EQ alias */
export const eq = biquadChain;

// Butterworth section Qs for even orders
function butterQs(order) {
  const qs = [];
  const n = order;
  for (let k = 0; k < Math.floor(n / 2); k++) qs.push(1 / (2 * Math.sin(((2 * k + 1) * Math.PI) / (2 * n))));
  return qs;
}
/** Butterworth low/high-pass of any order 1..8 (cascaded RBJ sections), freq may be modulated. */
export function butter(x, type, freq, order = 4, opts = {}) {
  if (isBuf(x)) return perChannel(x, (c) => butter(c, type, freq, order, opts));
  let y = x;
  if (order % 2 === 1) y = onepole(y, type === 'hp' ? 'hp' : 'lp', freq, opts);
  for (const q of butterQs(order)) y = biquad(y, type, freq, q, 0, opts);
  return y;
}
export const lowpass = (x, f, order = 2, opts) => butter(x, 'lp', f, order, opts);
export const highpass = (x, f, order = 2, opts) => butter(x, 'hp', f, order, opts);
/** band-pass built from HP+LP Butterworth */
export const bandpass = (x, lo, hi, order = 2, opts) => butter(butter(x, 'hp', lo, order, opts), 'lp', hi, order, opts);

// ---------------------------------------------------------------------------
// one-pole
// ---------------------------------------------------------------------------
/** onepole(x, 'lp'|'hp', freq, {sr})  6 dB/oct. freq scalar|array */
export function onepole(x, type, freq, opts = {}) {
  if (isBuf(x)) return perChannel(x, (c) => onepole(c, type, freq, opts));
  const { sr = SR } = opts;
  const n = x.length, out = new Float32Array(n);
  const fa = isArr(freq);
  let a = 1 - Math.exp((-TWO_PI * (fa ? freq[0] : freq)) / sr);
  let y = 0;
  const hp = type === 'hp';
  for (let i = 0; i < n; i++) {
    if (fa) a = 1 - Math.exp((-TWO_PI * clamp(freq[i], 1, sr * 0.45)) / sr);
    y += a * (x[i] - y);
    out[i] = hp ? x[i] - y : y;
  }
  return out;
}

/** DC blocker (one-pole high-pass at fc Hz, default 8 Hz) */
export function dcBlock(x, fc = 8) {
  return onepole(x, 'hp', fc);
}

// ---------------------------------------------------------------------------
// TPT state-variable filter (stable under fast modulation)
// ---------------------------------------------------------------------------
/**
 * svf(x, type, freq, q=0.7071, {sr, update=1})
 * type: 'lp'|'hp'|'bp' (unity peak)|'bpq' (raw, peak gain = Q)|'notch'|'peak' (lp minus hp, gain 2Q at fc)|'allpass'
 * q = resonance (0.5 = critically damped; 10 = very resonant). freq/q scalar|array.
 */
export function svf(x, type, freq, q = Math.SQRT1_2, opts = {}) {
  if (isBuf(x)) return perChannel(x, (c) => svf(c, type, freq, q, opts));
  const { sr = SR, update = 1 } = opts;
  const n = x.length, out = new Float32Array(n);
  const mod = isArr(freq) || isArr(q);
  let ic1 = 0, ic2 = 0, g = 0, k = 0, a1 = 0, a2 = 0, a3 = 0;
  const setC = (i) => {
    g = Math.tan((Math.PI * clamp(P(freq, i), 5, sr * 0.49)) / sr);
    k = 1 / Math.max(0.05, P(q, i));
    a1 = 1 / (1 + g * (g + k));
    a2 = g * a1;
    a3 = g * a2;
  };
  setC(0);
  for (let i = 0; i < n; i++) {
    if (mod && i % update === 0) setC(i);
    const v0 = x[i];
    const v3 = v0 - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    let y;
    switch (type) {
      case 'lp': y = v2; break;
      case 'bp': y = k * v1; break;
      case 'bpq': y = v1; break;
      case 'hp': y = v0 - k * v1 - v2; break;
      case 'notch': y = v0 - k * v1; break;
      case 'peak': y = v2 - (v0 - k * v1 - v2); break;
      case 'allpass': y = v0 - 2 * k * v1; break;
      default: throw new Error(`svf: unknown type "${type}"`);
    }
    out[i] = y;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Moog-style ladder low-pass (4-pole, tanh saturation, 2x internal)
// ---------------------------------------------------------------------------
/**
 * ladder(x, cutoff, res=0.3, {drive=1, comp=0.5, sr})  res 0..1 (~1 self-oscillates). cutoff scalar|array.
 * comp: passband-gain compensation for resonance (0 = authentic bass loss). Input is tanh-saturated: keep |x*drive| <~ 1.
 */
export function ladder(x, cutoff, res = 0.3, opts = {}) {
  if (isBuf(x)) return perChannel(x, (c) => ladder(c, cutoff, res, opts));
  const { sr = SR, drive = 1, comp = 0.5 } = opts;
  const n = x.length, out = new Float32Array(n);
  let s1 = 0, s2 = 0, s3 = 0, s4 = 0;
  const th = Math.tanh;
  for (let i = 0; i < n; i++) {
    const fc = clamp(P(cutoff, i), 20, sr * 0.3);
    const k = 4 * clamp(P(res, i), 0, 1.0);
    const g = 1 - Math.exp((-TWO_PI * fc) / (2 * sr)); // per half-step (2x internal rate)
    const xin = x[i] * drive;
    for (let h = 0; h < 2; h++) {
      const u = th(xin - k * s4);
      s1 += g * (u - th(s1));
      s2 += g * (th(s1) - th(s2));
      s3 += g * (th(s2) - th(s3));
      s4 += g * (th(s3) - th(s4));
    }
    out[i] = s4 * (1 + comp * k);
  }
  return out;
}

// ---------------------------------------------------------------------------
// formant bank (vowels a e i o u, 5 formants, bass/tenor/alto/soprano)
// ---------------------------------------------------------------------------
// [freq Hz, gain dB, bandwidth Hz] x 5, classic Csound formant tables
const F = (a) => a.map(([f, g, b]) => ({ f, g, b }));
export const VOWELS = {
  soprano: {
    a: F([[800, 0, 80], [1150, -6, 90], [2900, -32, 120], [3900, -20, 130], [4950, -50, 140]]),
    e: F([[350, 0, 60], [2000, -20, 100], [2800, -15, 120], [3600, -40, 150], [4950, -56, 200]]),
    i: F([[270, 0, 60], [2140, -12, 90], [2950, -26, 100], [3900, -26, 120], [4950, -44, 120]]),
    o: F([[450, 0, 40], [800, -11, 80], [2830, -22, 100], [3800, -22, 120], [4950, -50, 120]]),
    u: F([[325, 0, 50], [700, -16, 60], [2700, -35, 170], [3800, -40, 180], [4950, -60, 200]]),
  },
  alto: {
    a: F([[800, 0, 80], [1150, -4, 90], [2800, -20, 120], [3500, -36, 130], [4950, -60, 140]]),
    e: F([[400, 0, 60], [1600, -24, 80], [2700, -30, 120], [3300, -35, 150], [4950, -60, 200]]),
    i: F([[350, 0, 50], [1700, -20, 100], [2700, -30, 120], [3700, -36, 150], [4950, -60, 200]]),
    o: F([[450, 0, 70], [800, -9, 80], [2830, -16, 100], [3500, -28, 130], [4950, -55, 135]]),
    u: F([[325, 0, 50], [700, -12, 60], [2530, -30, 170], [3500, -40, 180], [4950, -64, 200]]),
  },
  tenor: {
    a: F([[650, 0, 80], [1080, -6, 90], [2650, -7, 120], [2900, -8, 130], [3250, -22, 140]]),
    e: F([[400, 0, 70], [1700, -14, 80], [2600, -12, 100], [3200, -14, 120], [3580, -20, 120]]),
    i: F([[290, 0, 40], [1870, -15, 90], [2800, -18, 100], [3250, -20, 120], [3540, -30, 120]]),
    o: F([[400, 0, 40], [800, -10, 80], [2600, -12, 100], [2800, -12, 120], [3000, -26, 120]]),
    u: F([[350, 0, 40], [600, -20, 60], [2700, -17, 100], [2900, -14, 120], [3300, -26, 120]]),
  },
  bass: {
    a: F([[600, 0, 60], [1040, -7, 70], [2250, -9, 110], [2450, -9, 120], [2750, -20, 130]]),
    e: F([[400, 0, 40], [1620, -12, 80], [2400, -9, 100], [2800, -12, 120], [3100, -18, 120]]),
    i: F([[250, 0, 60], [1750, -30, 90], [2600, -16, 100], [3050, -22, 120], [3340, -28, 120]]),
    o: F([[400, 0, 40], [750, -11, 80], [2400, -21, 100], [2600, -20, 120], [2900, -40, 120]]),
    u: F([[350, 0, 40], [600, -20, 80], [2400, -32, 100], [2675, -28, 120], [2950, -36, 120]]),
  },
};

/**
 * formant(x, vowel, {voice='alto', to=null, morph=0 (scalar|array 0..1), q=1, wet=1, gainDb=0, shift=1})
 *   vowel: 'a'|'e'|'i'|'o'|'u'; `to`: second vowel to morph towards with `morph` 0..1 (per sample ok)
 *   shift: formant frequency scale (e.g. 1.15 for a smaller "child/soprano" vocal tract)
 * Parallel band-pass bank; feed it a saw/pulse/noise source (e.g. a vibrato saw for "ooh/aah" choir).
 */
export function formant(x, vowel = 'a', opts = {}) {
  if (isBuf(x)) return perChannel(x, (c) => formant(c, vowel, opts));
  const { voice = 'alto', to = null, morph = 0, q = 1, wet = 1, gainDb = 0, shift = 1, sr = SR } = opts;
  const tab = VOWELS[voice];
  const A = tab[vowel], B = to ? tab[to] : A;
  const n = x.length, out = new Float32Array(n);
  const mArr = isArr(morph);
  for (let k = 0; k < 5; k++) {
    const gA = dbToLin(A[k].g), gB = dbToLin(B[k].g);
    const fr = new Float32Array(n), qq = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const m = mArr ? morph[i] : morph;
      const f = (A[k].f + (B[k].f - A[k].f) * m) * shift;
      const bw = A[k].b + (B[k].b - A[k].b) * m;
      fr[i] = f;
      qq[i] = Math.max(0.5, (f / bw) * q);
    }
    const bp = svf(x, 'bp', fr, qq, { sr, update: 4 });
    // gains: interpolate in linear when morphing
    if (mArr || A === B) {
      for (let i = 0; i < n; i++) {
        const m = mArr ? morph[i] : 0;
        out[i] += bp[i] * (gA + (gB - gA) * m);
      }
    } else {
      const g = gA + (gB - gA) * morph;
      for (let i = 0; i < n; i++) out[i] += bp[i] * g;
    }
  }
  const og = dbToLin(gainDb);
  for (let i = 0; i < n; i++) out[i] = (out[i] * wet + x[i] * (1 - wet)) * og;
  return out;
}

// ---------------------------------------------------------------------------
// first-order allpass (phaser stages, diffusion)
// ---------------------------------------------------------------------------
/** 1st-order allpass with break frequency f (scalar|array) */
export function allpass1(x, f, opts = {}) {
  const { sr = SR } = opts;
  const n = x.length, out = new Float32Array(n);
  let z = 0;
  for (let i = 0; i < n; i++) {
    const t = Math.tan((Math.PI * clamp(P(f, i), 5, sr * 0.45)) / sr);
    const a = (t - 1) / (t + 1);
    const v = x[i];
    const y = a * v + z;
    z = v - a * y;
    out[i] = y;
  }
  return out;
}

/** Buf helper: apply fn(Float32Array) to L and R and return a new Buf */
export const eachChannel = perChannel;
export { Buf };
