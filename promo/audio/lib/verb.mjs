// =============================================================================
// verb.mjs - FFT, partitioned convolution, generated impulse responses,
//            8-line FDN algorithmic reverb, reverb presets.
//
//   reverb(x, opts)              algorithmic stereo FDN (the workhorse)
//   convolve(x, ir, opts)        fast uniform-partitioned FFT convolution (mono)
//   convReverb(x, ir|kind, opts) stereo convolution reverb with a generated IR
//   makeIR(kind, overrides)      generated IR (room hall cathedral plate spring projector_room phone ...)
//   applyReverb(x, preset, o)    named presets (REVERB_PRESETS) -> Buf
//   phoneSpeaker(x, o)           band-limited, mono, tiny-speaker "device" filter
//
// Level convention: every reverb is ENERGY-NORMALISED so `wet:1` returns a wet signal with about the same
// power as the dry input for noise-like material (independent of decay/size). Typical inserts use wet 0.15-0.4.
// =============================================================================
import { SR, TWO_PI, Buf, isBuf, clamp, nextPow2, nearestPrime, mulberry32, seedOf, dbToLin, reverse } from './core.mjs';
import { noise } from './gen.mjs';
import { biquad } from './filt.mjs';
import { schroederAllpass } from './fx.mjs';

// ---------------------------------------------------------------------------
// FFT
// ---------------------------------------------------------------------------
const _fftCache = new Map();
export class FFT {
  constructor(n) {
    if (n & (n - 1)) throw new Error('FFT size must be a power of two');
    this.n = n;
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((TWO_PI * i) / n);
      this.sin[i] = Math.sin((TWO_PI * i) / n);
    }
    this.rev = new Uint32Array(n);
    let bits = 0;
    while (1 << bits < n) bits++;
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      this.rev[i] = r;
    }
  }
  static get(n) {
    let f = _fftCache.get(n);
    if (!f) _fftCache.set(n, (f = new FFT(n)));
    return f;
  }
  /** in-place complex FFT (re, im Float64Array of length n). inverse scales by 1/n. */
  transform(re, im, inverse = false) {
    const n = this.n, rev = this.rev, cs = this.cos, sn = this.sin;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    const sgn = inverse ? -1 : 1;
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const c = cs[k], s = sgn * sn[k];
          const tr = re[l] * c + im[l] * s;
          const ti = im[l] * c - re[l] * s;
          re[l] = re[j] - tr; im[l] = im[j] - ti;
          re[j] += tr; im[j] += ti;
        }
      }
    }
    if (inverse) {
      const k = 1 / n;
      for (let i = 0; i < n; i++) { re[i] *= k; im[i] *= k; }
    }
  }
}

/** Real FFT of size N via a complex FFT of size N/2. Half-spectrum has N/2+1 bins. */
export class RFFT {
  constructor(N) {
    this.N = N;
    this.h = N / 2;
    this.fft = FFT.get(this.h);
    this.zr = new Float64Array(this.h);
    this.zi = new Float64Array(this.h);
    this.wr = new Float64Array(this.h + 1);
    this.wi = new Float64Array(this.h + 1);
    for (let k = 0; k <= this.h; k++) {
      this.wr[k] = Math.cos((TWO_PI * k) / N);
      this.wi[k] = -Math.sin((TWO_PI * k) / N);
    }
  }
  /** x: array-like length N -> outRe/outIm (length N/2+1) */
  forward(x, outRe, outIm) {
    const { h, zr, zi, wr, wi } = this;
    for (let m = 0; m < h; m++) { zr[m] = x[2 * m]; zi[m] = x[2 * m + 1]; }
    this.fft.transform(zr, zi, false);
    for (let k = 0; k <= h; k++) {
      const k1 = k === h ? 0 : k, k2 = k === 0 ? 0 : h - k;
      const ar = zr[k1], ai = zi[k1], br = zr[k2], bi = -zi[k2];
      const fer = 0.5 * (ar + br), fei = 0.5 * (ai + bi);
      const dr = ar - br, di = ai - bi;
      const for_ = 0.5 * di, foi = -0.5 * dr;
      outRe[k] = fer + wr[k] * for_ - wi[k] * foi;
      outIm[k] = fei + wr[k] * foi + wi[k] * for_;
    }
  }
  /** half-spectrum -> out (length N) */
  inverse(re, im, out) {
    const { h, zr, zi, wr, wi } = this;
    for (let k = 0; k < h; k++) {
      const k2 = h - k;
      const ar = re[k], ai = im[k], br = re[k2], bi = -im[k2];
      const fer = 0.5 * (ar + br), fei = 0.5 * (ai + bi);
      const dr = 0.5 * (ar - br), di = 0.5 * (ai - bi);
      // Fo = conj(W) * d  (W = wr + i*wi, conj(W) = wr - i*wi)
      const for_ = dr * wr[k] + di * wi[k];
      const foi = di * wr[k] - dr * wi[k];
      // Z = Fe + i*Fo
      zr[k] = fer - foi;
      zi[k] = fei + for_;
    }
    this.fft.transform(zr, zi, true);
    for (let m = 0; m < h; m++) { out[2 * m] = zr[m]; out[2 * m + 1] = zi[m]; }
  }
}

/** magnitude spectrum helper for analysis/tests: returns Float64Array(N/2+1) of |X| (Hann-windowed if win=true) */
export function magSpectrum(x, N = 4096, start = 0, win = true) {
  const r = new RFFT(N), re = new Float64Array(N / 2 + 1), im = new Float64Array(N / 2 + 1), buf = new Float64Array(N);
  for (let i = 0; i < N; i++) buf[i] = (start + i < x.length ? x[start + i] : 0) * (win ? 0.5 - 0.5 * Math.cos((TWO_PI * i) / N) : 1);
  r.forward(buf, re, im);
  const m = new Float64Array(N / 2 + 1);
  for (let k = 0; k <= N / 2; k++) m[k] = Math.hypot(re[k], im[k]);
  return m;
}

// ---------------------------------------------------------------------------
// uniform-partitioned FFT convolution (overlap-save), sparse-input aware
// ---------------------------------------------------------------------------
/**
 * convolve(x, h, {tail=0 (seconds appended), full=false (x.length+h.length-1), block=auto})
 * Output length = x.length (+tail). Silent input blocks are skipped (cheap for sparse buses).
 */
export function convolve(x, h, opts = {}) {
  const nIn = x.length;
  const nOut = opts.full ? nIn + h.length - 1 : nIn + Math.round((opts.tail || 0) * SR);
  const out = new Float32Array(nOut);
  if (!h.length || !nIn) return out;
  if (h.length <= 24) {
    for (let i = 0; i < nIn; i++) {
      const v = x[i];
      if (v === 0) continue;
      for (let k = 0; k < h.length && i + k < nOut; k++) out[i + k] += v * h[k];
    }
    return out;
  }
  const B = opts.block || clamp(nextPow2(Math.ceil(h.length / 32)), 512, 8192);
  const N = 2 * B, bins = B + 1;
  const rf = new RFFT(N);
  const P = Math.ceil(h.length / B);
  const Hre = [], Him = [];
  const tmp = new Float64Array(N);
  for (let p = 0; p < P; p++) {
    tmp.fill(0);
    for (let i = 0; i < B; i++) { const j = p * B + i; tmp[i] = j < h.length ? h[j] : 0; }
    const re = new Float64Array(bins), im = new Float64Array(bins);
    rf.forward(tmp, re, im);
    Hre.push(re); Him.push(im);
  }
  // frequency-domain delay line (ring of P spectra); `live[j]` false => spectrum is exactly zero
  const Xre = Array.from({ length: P }, () => new Float64Array(bins));
  const Xim = Array.from({ length: P }, () => new Float64Array(bins));
  const live = new Uint8Array(P);
  const accRe = new Float64Array(bins), accIm = new Float64Array(bins), ob = new Float64Array(N);
  const nBlocks = Math.ceil(nOut / B);
  let head = 0;
  for (let b = 0; b < nBlocks; b++) {
    // input segment: previous B samples + current B samples
    let any = false;
    for (let i = 0; i < B; i++) {
      const j = b * B + i;
      const v = j < nIn ? x[j] : 0;
      tmp[B + i] = v;
      if (v !== 0) any = true;
    }
    for (let i = 0; i < B; i++) {
      const j = (b - 1) * B + i;
      tmp[i] = j >= 0 && j < nIn ? x[j] : 0;
      if (tmp[i] !== 0) any = true;
    }
    head = (head + 1) % P;
    if (any) {
      rf.forward(tmp, Xre[head], Xim[head]);
      live[head] = 1;
    } else live[head] = 0;
    accRe.fill(0); accIm.fill(0);
    let used = false;
    for (let p = 0; p < P; p++) {
      const slot = (head - p + P) % P;
      if (!live[slot]) continue;
      used = true;
      const xr = Xre[slot], xi = Xim[slot], hr = Hre[p], hi = Him[p];
      for (let k = 0; k < bins; k++) {
        accRe[k] += xr[k] * hr[k] - xi[k] * hi[k];
        accIm[k] += xr[k] * hi[k] + xi[k] * hr[k];
      }
    }
    if (!used) continue;
    rf.inverse(accRe, accIm, ob);
    const o0 = b * B;
    for (let i = 0; i < B && o0 + i < nOut; i++) out[o0 + i] = ob[B + i];
  }
  return out;
}

// ---------------------------------------------------------------------------
// impulse response generator
// ---------------------------------------------------------------------------
// crossover bands: <300, 300-1500, 1.5k-5k, >5k  (Linkwitz-Riley 4 split => flat sum)
const lr4 = (x, type, f) => biquad(biquad(x, type, f, Math.SQRT1_2), type, f, Math.SQRT1_2);
function split4(x) {
  const b0 = lr4(x, 'lp', 300);
  let r = lr4(x, 'hp', 300);
  const b1 = lr4(r, 'lp', 1500);
  r = lr4(r, 'hp', 1500);
  const b2 = lr4(r, 'lp', 5000);
  const b3 = lr4(r, 'hp', 5000);
  return [b0, b1, b2, b3];
}

export const IR_PRESETS = {
  room: { seconds: 1.1, rt: [0.6, 0.5, 0.38, 0.22], pre: 0.002, onset: 0.006, early: { n: 10, span: 0.04, gain: 0.9 }, hp: 90, lp: 11000, width: 0.85 },
  chamber: { seconds: 1.8, rt: [1.3, 1.1, 0.8, 0.45], pre: 0.008, onset: 0.012, early: { n: 12, span: 0.06, gain: 0.7 }, hp: 90, lp: 11000, width: 0.9 },
  hall: { seconds: 4.6, rt: [3.2, 2.6, 1.9, 1.0], pre: 0.028, onset: 0.03, early: { n: 14, span: 0.09, gain: 0.55 }, hp: 70, lp: 9500, width: 1 },
  cathedral: { seconds: 9.0, rt: [9.0, 7.0, 4.6, 2.0], pre: 0.045, onset: 0.09, early: { n: 16, span: 0.16, gain: 0.4 }, hp: 60, lp: 8000, width: 1 },
  plate: { seconds: 3.2, rt: [1.5, 2.0, 2.3, 2.0], pre: 0.0, onset: 0.004, early: null, hp: 140, lp: 15000, width: 1 },
  projector_room: { seconds: 1.3, rt: [0.9, 0.55, 0.38, 0.18], pre: 0.003, onset: 0.004, early: { n: 6, span: 0.03, gain: 0.8 }, flutter: { period: 0.0285, decay: 0.55, n: 9, gain: 0.5 }, hp: 160, lp: 6500, width: 0.5 },
  spring: { kind: 'spring' },
  phone: { kind: 'phone' },
};
const _irCache = new Map();

function springIR(spec, seed) {
  const { seconds = 2.6, period = 0.036, decay = 0.76 } = spec;
  const n = Math.round(seconds * SR);
  const out = [new Float32Array(n), new Float32Array(n)];
  for (let c = 0; c < 2; c++) {
    const rng = mulberry32(seed + c * 31);
    const o = out[c];
    let t = c * 0.0007;
    for (let k = 0; k < 80; k++) {
      const amp = Math.pow(decay, k) * (k % 2 ? -1 : 1);
      if (Math.abs(amp) < 0.002) break;
      const dur = 0.010 + 0.006 * k;
      const len = Math.round(dur * SR), s0 = Math.round(t * SR);
      // dispersive chirp: high freq arrives first, sweeping down
      let ph = 0;
      for (let i = 0; i < len && s0 + i < n; i++) {
        const u = i / len;
        const f = 4500 * Math.pow(420 / 4500, u);
        ph += (TWO_PI * f) / SR;
        const w = Math.sin(Math.PI * u);
        o[s0 + i] += amp * w * w * Math.sin(ph);
      }
      t += period * (1 + 0.012 * (rng() - 0.5)) * (1 + 0.004 * k);
    }
    const nz = noise('gauss', n, seed + 100 + c, { rms: 1 });
    for (let i = 0; i < n; i++) o[i] += nz[i] * 0.07 * Math.exp((-6.9 * i) / (SR * 1.6)) * (1 - Math.exp(-i / (SR * 0.01)));
  }
  let L = biquad(biquad(out[0], 'hp', 150, 0.7), 'lp', 5200, 0.8), R = biquad(biquad(out[1], 'hp', 150, 0.7), 'lp', 5200, 0.8);
  return [L, R];
}

function phoneIR(spec) {
  const n = Math.round(0.03 * SR);
  const imp = new Float32Array(n);
  imp[0] = 1;
  imp[Math.round(0.00031 * SR)] += 0.28; // cabinet reflection
  imp[Math.round(0.00092 * SR)] -= 0.12;
  let y = imp;
  const { lo = 400, hi = 4000 } = spec;
  y = biquad(biquad(y, 'hp', lo, 0.8), 'hp', lo * 0.9, 0.9);
  y = biquad(biquad(y, 'lp', hi, 0.8), 'lp', hi * 1.1, 0.9);
  y = biquad(y, 'peak', 1350, 2.2, 6);
  y = biquad(y, 'peak', 2600, 3.0, 3);
  return [y, Float32Array.from(y)];
}

/**
 * makeIR(kind | spec, overrides) -> Buf (stereo IR, energy-normalised per channel)
 * kinds: room chamber hall cathedral plate spring projector_room phone
 * spec: {seconds, rt:[<300,300-1.5k,1.5-5k,>5k RT60 s], pre, onset, early:{n,span,gain}|null,
 *        flutter:{period,decay,n,gain}, hp, lp, width 0..1, seed}
 */
export function makeIR(kind = 'hall', overrides = {}) {
  const base = typeof kind === 'string' ? IR_PRESETS[kind] : kind;
  if (!base) throw new Error(`makeIR: unknown kind "${kind}"`);
  const spec = { ...base, ...overrides };
  const key = JSON.stringify([kind, spec]);
  const cached = _irCache.get(key);
  if (cached) return cached;
  const seed = spec.seed != null ? spec.seed : seedOf('ir', typeof kind === 'string' ? kind : 'custom');
  let chans;
  if (spec.kind === 'spring') chans = springIR(spec, seed);
  else if (spec.kind === 'phone') chans = phoneIR(spec);
  else {
    const n = Math.round(spec.seconds * SR);
    const width = spec.width != null ? spec.width : 1;
    const shared = noise('gauss', n, seed, { rms: 1 });
    chans = [0, 1].map((c) => {
      const own = noise('gauss', n, seed + 17 * (c + 1), { rms: 1 });
      const ka = Math.sqrt(width), kb = Math.sqrt(1 - width);
      const x = new Float32Array(n);
      for (let i = 0; i < n; i++) x[i] = own[i] * ka + shared[i] * kb;
      const bands = split4(x);
      const y = new Float32Array(n);
      for (let b = 0; b < 4; b++) {
        const k = 6.9078 / (spec.rt[b] * SR);
        const bb = bands[b];
        for (let i = 0; i < n; i++) y[i] += bb[i] * Math.exp(-k * i);
      }
      const onset = Math.max(1e-4, spec.onset || 0.005);
      for (let i = 0; i < n; i++) y[i] *= 1 - Math.exp(-i / (onset * SR));
      // early reflections
      const rng = mulberry32(seed + 1000 + c);
      const addTap = (t, a) => {
        const s = Math.round(t * SR);
        if (s + 3 < n) {
          y[s] += a * 0.6; y[s + 1] += a * 0.3; y[s + 2] += a * 0.1;
        }
      };
      if (spec.early) {
        const e = spec.early;
        for (let k = 0; k < e.n; k++) {
          const t = 0.002 + (e.span - 0.002) * Math.pow(rng(), 0.7);
          addTap(t, e.gain * 3.5 * Math.exp((-t / e.span) * 1.6) * (rng() < 0.5 ? -1 : 1) * (0.6 + 0.4 * rng()));
        }
      }
      if (spec.flutter) {
        const f = spec.flutter;
        for (let k = 1; k <= f.n; k++) addTap(k * f.period * (1 + 0.01 * (rng() - 0.5)) * (c ? 1.013 : 1), f.gain * 3.5 * Math.pow(f.decay, k - 1) * (k % 2 ? 1 : -1));
      }
      // predelay
      const pre = Math.round((spec.pre || 0) * SR);
      let z = new Float32Array(n);
      for (let i = pre; i < n; i++) z[i] = y[i - pre];
      if (spec.hp) z = biquad(biquad(z, 'hp', spec.hp, 0.7), 'hp', spec.hp, 0.7);
      if (spec.lp) z = biquad(biquad(z, 'lp', spec.lp, 0.7), 'lp', spec.lp, 0.7);
      return z;
    });
  }
  // energy normalise (each channel -> sum h^2 = 1)
  chans = chans.map((z) => {
    let e = 0;
    for (let i = 0; i < z.length; i++) e += z[i] * z[i];
    const k = e > 0 ? 1 / Math.sqrt(e) : 1;
    const o = new Float32Array(z.length);
    for (let i = 0; i < z.length; i++) o[i] = z[i] * k;
    return o;
  });
  const ir = Buf.from(chans[0], chans[1]);
  _irCache.set(key, ir);
  return ir;
}

/**
 * convReverb(x, ir | kind, {wet=0.3, dry=1, wetOnly=false, tail=0 (s appended), overrides})
 * x: mono or Buf. L*irL, R*irR (mono input -> both). Returns Buf.
 */
export function convReverb(x, irOrKind, opts = {}) {
  const { wet = 0.3, dry = 1, wetOnly = false, tail = 0, overrides = {} } = opts;
  const ir = typeof irOrKind === 'string' ? makeIR(irOrKind, overrides) : irOrKind;
  const src = isBuf(x) ? x : Buf.from(x, x);
  const wl = convolve(src.L, ir.L, { tail }), wr = convolve(src.R, ir.R, { tail });
  const n = wl.length;
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    L[i] = (wetOnly || i >= src.length ? 0 : src.L[i] * dry) + wl[i] * wet;
    R[i] = (wetOnly || i >= src.length ? 0 : src.R[i] * dry) + wr[i] * wet;
  }
  return Buf.from(L, R);
}

// ---------------------------------------------------------------------------
// 8-line FDN reverb
// ---------------------------------------------------------------------------
const FDN_BASE = [1031, 1327, 1583, 1861, 2131, 2423, 2689, 2971]; // samples @ 48k at size=1
const FDN_RATES = [0.31, 0.43, 0.57, 0.71, 0.37, 0.53, 0.61, 0.47];
const SGN_A = [1, -1, 1, -1, 1, -1, 1, -1];
const SGN_B = [1, 1, -1, -1, 1, 1, -1, -1];

function fdnCore(inL, inR, nOut, P) {
  const sr = SR, N = 8;
  const preN = Math.round(P.preDelay * sr);
  const rng = mulberry32(P.seed);
  // ---- stage 1: pre-delay, early reflections, input diffusion
  const prepare = (x, side) => {
    const n = nOut;
    const pd = new Float32Array(n);
    for (let i = preN; i < n; i++) {
      const j = i - preN;
      pd[i] = j < x.length ? x[j] : 0;
    }
    // early reflections (sparse-aware: only non-zero input samples are scattered)
    const er = new Float32Array(n);
    if (P.early > 0) {
      const r = mulberry32(P.seed + 77 + side * 13);
      const span = 0.012 + 0.042 * Math.sqrt(P.size);
      const taps = [];
      for (let k = 0; k < 12; k++) {
        const t = 0.003 + (span - 0.003) * Math.pow(r(), 0.8);
        taps.push([Math.round(t * sr), Math.exp(-t / (span * 0.6)) * (r() < 0.5 ? -1 : 1) * (0.5 + 0.5 * r())]);
      }
      let nz = 0;
      for (let i = 0; i < n; i++) if (pd[i] !== 0) nz++;
      if (nz < n / 8) {
        for (let i = 0; i < n; i++) {
          const v = pd[i];
          if (v === 0) continue;
          for (const [s, a] of taps) if (i + s < n) er[i + s] += v * a;
        }
      } else {
        for (const [s, a] of taps) for (let i = s; i < n; i++) er[i] += pd[i - s] * a;
      }
    }
    // diffusion
    let d = pd;
    const gD = 0.35 + 0.4 * P.diffusion;
    const dl = side === 0 ? [142, 107, 379, 277] : [149, 113, 389, 281];
    if (P.diffusion > 0) for (const m of dl) d = schroederAllpass(d, Math.max(4, Math.round(m * (0.6 + 0.4 * P.size))), gD);
    return { d, er };
  };
  const A = prepare(inL, 0), Bp = prepare(inR, 1);
  // ---- stage 2: tank
  const dl = FDN_BASE.map((b) => nearestPrime(Math.max(64, Math.round(b * P.size))));
  const depth = (4 + 14 * P.mod) * Math.sqrt(P.size);
  const maxLen = dl.map((d) => nextPow2(Math.ceil(d + depth + 8)));
  const lines = maxLen.map((m) => new Float32Array(m));
  const masks = maxLen.map((m) => m - 1);
  const g = dl.map((d) => Math.pow(10, (-3 * d) / (sr * Math.max(0.05, P.decay))));
  const cd = clamp(P.damp, 0, 0.98) * 0.9;
  const lp = new Float64Array(N);
  const rc = new Float64Array(N), rs = new Float64Array(N), rcd = new Float64Array(N), rsd = new Float64Array(N);
  for (let j = 0; j < N; j++) {
    const w = (TWO_PI * FDN_RATES[j] * (0.85 + 0.3 * rng())) / sr;
    rcd[j] = Math.cos(w); rsd[j] = Math.sin(w);
    const ph = rng() * TWO_PI;
    rc[j] = Math.cos(ph); rs[j] = Math.sin(ph);
  }
  const tL = new Float32Array(nOut), tR = new Float32Array(nOut);
  const v = new Float64Array(N);
  const BLK = 256;
  let quiet = 0, cleared = false, lastPeak = 1;
  const sd = A.d, sdR = Bp.d;
  for (let b0 = 0; b0 < nOut; b0 += BLK) {
    const b1 = Math.min(nOut, b0 + BLK);
    let any = false;
    for (let i = b0; i < b1; i++) if (sd[i] > 1e-9 || sd[i] < -1e-9 || sdR[i] > 1e-9 || sdR[i] < -1e-9) { any = true; break; }
    if (!any && lastPeak < 1e-7 && quiet >= 2) {
      if (!cleared) {
        for (let j = 0; j < N; j++) { lines[j].fill(0); lp[j] = 0; }
        cleared = true;
      }
      continue;
    }
    cleared = false;
    let peak = 0;
    for (let i = b0; i < b1; i++) {
      const xl = sd[i], xr = sdR[i];
      let sum = 0, oL = 0, oR = 0;
      for (let j = 0; j < N; j++) {
        const dd = dl[j] + depth * (1 + rs[j]) * 0.5;
        const id = dd | 0, fr = dd - id;
        const m = masks[j], ln = lines[j];
        const a = ln[(i - id) & m], c = ln[(i - id - 1) & m];
        let val = a + (c - a) * fr;
        lp[j] += (1 - cd) * (val - lp[j]);
        val = lp[j] * g[j];
        v[j] = val;
        sum += val;
        // rotate LFO
        const c2 = rc[j] * rcd[j] - rs[j] * rsd[j];
        rs[j] = rs[j] * rcd[j] + rc[j] * rsd[j];
        rc[j] = c2;
        oL += SGN_A[j] * val;
        oR += SGN_B[j] * val;
      }
      const half = sum * (2 / N);
      for (let j = 0; j < N; j++) {
        lines[j][i & masks[j]] = v[j] - half + xl * SGN_A[j] * 0.35 + xr * SGN_B[j] * 0.35;
      }
      tL[i] = oL; tR[i] = oR;
      const pk = Math.abs(oL) + Math.abs(oR);
      if (pk > peak) peak = pk;
    }
    lastPeak = peak;
    if (!any) quiet++; else quiet = 0;
  }
  return { tL, tR, erL: A.er, erR: Bp.er };
}

function fdnWet(inL, inR, nOut, P) {
  const { tL, tR, erL, erR } = fdnCore(inL, inR, nOut, P);
  const wl = new Float32Array(nOut), wr = new Float32Array(nOut);
  for (let i = 0; i < nOut; i++) {
    wl[i] = tL[i] + erL[i] * P.early * 3;
    wr[i] = tR[i] + erR[i] * P.early * 3;
  }
  let L = wl, R = wr;
  if (P.lowCut > 0) { L = biquad(biquad(L, 'hp', P.lowCut, 0.6), 'hp', P.lowCut, 1.0); R = biquad(biquad(R, 'hp', P.lowCut, 0.6), 'hp', P.lowCut, 1.0); }
  if (P.highCut > 0 && P.highCut < SR * 0.45) { L = biquad(L, 'lp', P.highCut, 0.7); R = biquad(R, 'lp', P.highCut, 0.7); }
  if (P.width !== 1) {
    for (let i = 0; i < nOut; i++) {
      const m = 0.5 * (L[i] + R[i]), s = 0.5 * (L[i] - R[i]) * P.width;
      L[i] = m + s; R[i] = m - s;
    }
  }
  return [L, R];
}

const _normCache = new Map();
function fdnNorm(P) {
  const key = JSON.stringify([P.size, P.decay, P.damp, P.preDelay, P.mod, P.early, P.diffusion, P.lowCut, P.highCut, P.width, P.seed]);
  let k = _normCache.get(key);
  if (k) return k;
  const nOut = Math.round(clamp(P.decay * 1.4 + P.preDelay + 0.4, 0.8, 12) * SR);
  const imp = new Float32Array(nOut);
  imp[0] = 1;
  const [L, R] = fdnWet(imp, imp, nOut, P);
  let e = 0;
  for (let i = 0; i < nOut; i++) e += L[i] * L[i] + R[i] * R[i];
  k = 1 / Math.sqrt(Math.max(1e-12, e / 2));
  _normCache.set(key, k);
  return k;
}

/**
 * reverb(x, opts) -> Buf   algorithmic 8-line FDN (Householder feedback, damped, modulated)
 *  opts: {size=1 (0.3..4: room scale), decay=2.2 (RT60 s), damp=0.4 (0 bright..1 dark), preDelay=0.02 (s),
 *         wet=0.3, dry=1, wetOnly=false, width=1, mod=0.5, early=0.35, diffusion=0.7,
 *         lowCut=100 (Hz), highCut=12000 (Hz), tail=0 (seconds appended to the output), seed=7}
 *  mono input is treated as dual mono. Length = x.length + tail (default tail 0 -> same length).
 */
export function reverb(x, opts = {}) {
  const P = {
    size: 1, decay: 2.2, damp: 0.4, preDelay: 0.02, wet: 0.3, dry: 1, wetOnly: false, width: 1, mod: 0.5, early: 0.35,
    diffusion: 0.7, lowCut: 100, highCut: 12000, tail: 0, seed: 7, ...opts,
  };
  const src = isBuf(x) ? x : Buf.from(x, x);
  const nOut = src.length + Math.round(P.tail * SR);
  const k = fdnNorm(P);
  const [wl, wr] = fdnWet(src.L, src.R, nOut, P);
  const L = new Float32Array(nOut), R = new Float32Array(nOut);
  const kw = P.wet * k;
  for (let i = 0; i < nOut; i++) {
    L[i] = (P.wetOnly || i >= src.length ? 0 : src.L[i] * P.dry) + wl[i] * kw;
    R[i] = (P.wetOnly || i >= src.length ? 0 : src.R[i] * P.dry) + wr[i] * kw;
  }
  return Buf.from(L, R);
}

// ---------------------------------------------------------------------------
// presets
// ---------------------------------------------------------------------------
/**
 * REVERB_PRESETS: name -> {engine:'fdn', ...reverb opts} | {engine:'ir', kind, ...convReverb opts}
 * names: room chamber hall bigHall cathedral plate spring projector (alias projector_room) cave
 *        + phone (alias phone_speaker): not a reverb but the band-limited mono tiny-speaker device filter (phoneSpeaker opts)
 */
export const REVERB_PRESETS = {
  // NB: FDN sizes below ~0.7 get a peaky (metallic) response because modal density ~ sum of line lengths;
  // 'room' therefore keeps size ~0.85 and gets its small-room character from the short RT60 + early reflections.
  room: { engine: 'fdn', size: 0.85, decay: 0.5, damp: 0.55, preDelay: 0.004, early: 0.55, diffusion: 0.8, mod: 0.8, lowCut: 120, highCut: 10000 },
  chamber: { engine: 'fdn', size: 1.0, decay: 1.3, damp: 0.45, preDelay: 0.01, early: 0.5, diffusion: 0.8, mod: 0.7, lowCut: 110 },
  hall: { engine: 'fdn', size: 1.7, decay: 2.5, damp: 0.38, preDelay: 0.028, early: 0.35, diffusion: 0.75, lowCut: 100, highCut: 11000 },
  bigHall: { engine: 'fdn', size: 2.4, decay: 3.8, damp: 0.42, preDelay: 0.04, early: 0.3, diffusion: 0.8, lowCut: 90, highCut: 10000 },
  cathedral: { engine: 'fdn', size: 3.2, decay: 6.5, damp: 0.5, preDelay: 0.055, early: 0.22, diffusion: 0.85, lowCut: 80, highCut: 8500, mod: 0.6 },
  cave: { engine: 'fdn', size: 3.6, decay: 9, damp: 0.6, preDelay: 0.08, early: 0.1, diffusion: 0.9, lowCut: 70, highCut: 6000, mod: 0.7 },
  plate: { engine: 'fdn', size: 1.0, decay: 1.8, damp: 0.12, preDelay: 0, early: 0, diffusion: 1, lowCut: 160, highCut: 15000, mod: 0.9 },
  spring: { engine: 'ir', kind: 'spring' },
  projector: { engine: 'ir', kind: 'projector_room' },
  projector_room: { engine: 'ir', kind: 'projector_room' },
  phone: { engine: 'phone' }, // not a reverb: band-limited mono tiny speaker (400 Hz-4 kHz)
  phone_speaker: { engine: 'phone' },
};
/**
 * applyReverb(x, preset, overrides) -> Buf. overrides: wet, dry, wetOnly, tail, + any reverb/convReverb option.
 * Output length = x.length + tail (tail defaults to 0: pass e.g. tail:2.5 to keep a ring-out at the end of a one-shot).
 */
export function applyReverb(x, preset = 'hall', overrides = {}) {
  const p = REVERB_PRESETS[preset];
  if (!p) throw new Error(`applyReverb: unknown preset "${preset}" (have ${Object.keys(REVERB_PRESETS).join(', ')})`);
  const { engine, kind, ...rest } = p;
  const o = { ...rest, ...overrides };
  if (engine === 'phone') return phoneSpeaker(x, o);
  if (engine === 'ir') return convReverb(x, kind, o);
  return reverb(x, o);
}

/** phone/laptop/tin-speaker band-limiting: opts {lo=400, hi=4000, mono=true, drive=0 (0..1 grit), bits=0 (bitcrush), mix=1} -> Buf */
export function phoneSpeaker(x, opts = {}) {
  const { lo = 400, hi = 4000, mono = true, drive = 0, mix = 1 } = opts;
  const src = isBuf(x) ? x : Buf.from(x, x);
  const proc = (ch) => {
    let y = biquad(biquad(ch, 'hp', lo, 0.75), 'hp', lo * 0.85, 0.9);
    y = biquad(biquad(y, 'lp', hi, 0.75), 'lp', hi * 1.15, 0.9);
    y = biquad(y, 'peak', 1350, 2.2, 6);
    y = biquad(y, 'peak', 2700, 3.0, 3);
    if (drive > 0) {
      const d = 1 + drive * 6;
      for (let i = 0; i < y.length; i++) y[i] = Math.tanh(y[i] * d) / Math.tanh(d * 0.6);
    }
    return y;
  };
  let L = proc(mono ? Float32Array.from(src.L, (v, i) => 0.5 * (v + src.R[i])) : src.L);
  let R = mono ? Float32Array.from(L) : proc(src.R);
  if (mix < 1) {
    L = L.map((v, i) => v * mix + src.L[i] * (1 - mix));
    R = R.map((v, i) => v * mix + src.R[i] * (1 - mix));
  }
  return Buf.from(L, R);
}

/**
 * reverseReverb(x, {preset='plate', wet=1, tail=1.2, ...}) -> {buf, offset}
 * A swell that builds INTO the sound: returns a Buf of length x.length+tail whose dry sound starts at `offset`
 * (= tail seconds). Place it at (t - offset) to land the dry sound at t. mono/Buf ok.
 */
export function reverseReverb(x, opts = {}) {
  const { preset = 'plate', wet = 1, tail = 1.2, ...rest } = opts;
  const src = isBuf(x) ? x : Buf.from(x, x);
  const rev = Buf.from(reverse(src.L), reverse(src.R));
  const w = applyReverb(rev, preset, { wet, wetOnly: true, tail, ...rest });
  const fwd = Buf.from(reverse(w.L), reverse(w.R)); // length n + tail; swell ends where the dry begins... dry begins at `tail`
  const n = fwd.length, off = Math.round(tail * SR);
  for (let i = 0; i < src.length && off + i < n; i++) {
    fwd.L[off + i] += src.L[i];
    fwd.R[off + i] += src.R[i];
  }
  return { buf: fwd, offset: tail };
}
void dbToLin;
