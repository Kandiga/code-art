// =============================================================================
// core.mjs - sample rate, stereo buffer, utilities, seeded RNG, WAV I/O,
// band-limited resampler. Everything else in audio/lib builds on this.
//
// Conventions (see audio/README.md):
//   * 48 kHz, stereo, float32 storage, float64 filter state internally.
//   * times in SECONDS, gains in dB, frequencies in Hz (parameter names ending in
//     "Ms" are milliseconds, "Db" decibels, "Hz" hertz).
//   * deterministic: only seeded RNG (mulberry32). Never Math.random / Date.now.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';

export const SR = 48000;
export const TWO_PI = Math.PI * 2;

// ----------------------------------------------------------------------------
// time / pitch / level helpers
// ----------------------------------------------------------------------------
export const sec = (n, sr = SR) => n / sr;
export const samples = (s, sr = SR) => Math.round(s * sr);
export const midiToHz = (m, a4 = 440) => a4 * Math.pow(2, (m - 69) / 12);
export const hzToMidi = (f, a4 = 440) => 69 + 12 * Math.log2(f / a4);
export const centsToRatio = (c) => Math.pow(2, c / 1200);
export const semisToRatio = (s) => Math.pow(2, s / 12);

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** 'A4' -> 69, 'C#3' -> 49, 'Bb2' -> 46, 'C-1' -> 0. */
export function noteToMidi(name) {
  const m = /^\s*([A-Ga-g])([#b♯♭]*)(-?\d+)\s*$/.exec(String(name));
  if (!m) throw new Error(`noteToMidi: cannot parse "${name}"`);
  let pc = PC[m[1].toUpperCase()];
  for (const ch of m[2]) pc += ch === '#' || ch === '♯' ? 1 : -1;
  return (parseInt(m[3], 10) + 1) * 12 + pc;
}
const NAMES_S = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NAMES_F = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
export function midiToNote(m, flats = false) {
  const r = Math.round(m);
  return (flats ? NAMES_F : NAMES_S)[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1);
}

export const dbToLin = (db) => Math.pow(10, db / 20);
/** floors at -240 dB so downstream arithmetic never sees -Infinity/NaN. */
export const linToDb = (x) => (x > 1e-12 ? 20 * Math.log10(x) : -240);

export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, x) => (b === a ? 0 : (x - a) / (b - a));
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const smootherstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
export const nextPow2 = (n) => {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
};
export function isPrime(n) {
  if (n < 2) return false;
  if (n % 2 === 0) return n === 2;
  for (let i = 3; i * i <= n; i += 2) if (n % i === 0) return false;
  return true;
}
export function nearestPrime(n) {
  n = Math.max(2, Math.round(n));
  for (let d = 0; ; d++) {
    if (isPrime(n + d)) return n + d;
    if (n - d > 1 && isPrime(n - d)) return n - d;
  }
}

// ----------------------------------------------------------------------------
// seeded RNG
// ----------------------------------------------------------------------------
/** FNV-1a 32-bit. */
export function hashString(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
/** Stable seed from any parts: seedOf('kick', 3, 'bar') */
export const seedOf = (...parts) => hashString(parts.join('|'));

/**
 * mulberry32 PRNG. Returns a function r() -> [0,1) with helpers:
 * r.range(a,b) r.int(n) r.gauss() r.pick(arr) r.sign() r.bool(p) r.fork(label)
 */
export function mulberry32(seed = 1) {
  let a = (typeof seed === 'string' ? hashString(seed) : Math.floor(seed)) >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare = null;
  r.range = (lo = 0, hi = 1) => lo + (hi - lo) * r();
  r.int = (n) => Math.floor(r() * n);
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.sign = () => (r() < 0.5 ? -1 : 1);
  r.bool = (p = 0.5) => r() < p;
  r.gauss = () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0;
    while (u < 1e-12) u = r();
    const v = r();
    const m = Math.sqrt(-2 * Math.log(u));
    spare = m * Math.sin(TWO_PI * v);
    return m * Math.cos(TWO_PI * v);
  };
  r.fork = (label) => mulberry32((hashString(String(label)) ^ Math.imul(a, 0x9e3779b1)) >>> 0);
  return r;
}

// ----------------------------------------------------------------------------
// Buf: stereo float32 buffer
// ----------------------------------------------------------------------------
export class Buf {
  /** @param {number} seconds length in seconds (default 60) */
  constructor(seconds = 60) {
    const n = Math.max(0, Math.round(seconds * SR));
    this.L = new Float32Array(n);
    this.R = new Float32Array(n);
  }
  /** number of samples per channel */
  get length() {
    return this.L.length;
  }
  get seconds() {
    return this.L.length / SR;
  }
  /** wrap existing arrays (no copy). R defaults to a copy of L. */
  static from(L, R) {
    const b = Object.create(Buf.prototype);
    b.L = L;
    b.R = R || Float32Array.from(L);
    if (b.R.length !== b.L.length) throw new Error('Buf.from: channel length mismatch');
    return b;
  }
  /** mono Float32Array -> stereo Buf (copy), constant-power pan (-1..1), default centre = dual-mono (no -3 dB). */
  static fromMono(x, pan = 0) {
    const b = Buf.from(Float32Array.from(x), Float32Array.from(x));
    if (pan !== 0) {
      const [gl, gr] = panGains(pan, true);
      for (let i = 0; i < x.length; i++) {
        b.L[i] *= gl;
        b.R[i] *= gr;
      }
    }
    return b;
  }
  clone() {
    return Buf.from(Float32Array.from(this.L), Float32Array.from(this.R));
  }
  /** in-place gain in dB (chainable). */
  gain(db) {
    const g = dbToLin(db);
    const { L, R } = this;
    for (let i = 0; i < L.length; i++) {
      L[i] *= g;
      R[i] *= g;
    }
    return this;
  }
  /** in-place linear scale (chainable). */
  scale(g) {
    const { L, R } = this;
    for (let i = 0; i < L.length; i++) {
      L[i] *= g;
      R[i] *= g;
    }
    return this;
  }
  clear() {
    this.L.fill(0);
    this.R.fill(0);
    return this;
  }
  /** copy of [t0,t1) seconds. */
  slice(t0 = 0, t1 = this.seconds) {
    const a = clamp(Math.round(t0 * SR), 0, this.length);
    const b = clamp(Math.round(t1 * SR), a, this.length);
    return Buf.from(this.L.slice(a, b), this.R.slice(a, b));
  }
}

export const newBuf = (seconds = 60) => new Buf(seconds);
/** mono Float32Array of `seconds` */
export const mono = (seconds) => new Float32Array(Math.max(0, Math.round(seconds * SR)));
export const isBuf = (x) => x && x.L instanceof Float32Array && x.R instanceof Float32Array;

/** constant-power (sin/cos) pan law. pan -1..1. centre = -3 dB per side unless `unityCentre`. */
export function panGains(pan, unityCentre = false) {
  const p = clamp(pan, -1, 1);
  const a = (p + 1) * (Math.PI / 4);
  const k = unityCentre ? Math.SQRT2 : 1;
  return [Math.cos(a) * k, Math.sin(a) * k];
}
/** balance law for stereo sources: centre = unity, hard side attenuates the opposite channel. */
export function balanceGains(pan) {
  const p = clamp(pan, -1, 1);
  return [p <= 0 ? 1 : Math.cos(p * Math.PI / 2), p >= 0 ? 1 : Math.cos(-p * Math.PI / 2)];
}

/**
 * Mix `src` into `dst` starting at tSec (negative start clips). Out-of-range is clipped.
 *  - src = Float32Array (mono): constant-power pan (centre = -3 dB per side)
 *  - src = Buf (stereo): pan acts as BALANCE (centre = unity gain, no change)
 * opts: { srcStart: seconds into src, srcLen: seconds of src to use }
 * Returns dst (chainable).
 */
export function addAt(dst, src, tSec, gainDb = 0, pan = 0, opts = null) {
  const g = dbToLin(gainDb);
  const off = Math.round(tSec * SR);
  const n = dst.L.length;
  const stereo = isBuf(src);
  const sl = stereo ? src.L : src;
  const sr_ = stereo ? src.R : null;
  let a = opts && opts.srcStart ? Math.round(opts.srcStart * SR) : 0;
  let b = sl.length;
  if (opts && opts.srcLen != null) b = Math.min(b, a + Math.round(opts.srcLen * SR));
  let d0 = off; // dst index of src[a]
  if (d0 < 0) {
    a -= d0;
    d0 = 0;
  }
  if (d0 + (b - a) > n) b = a + (n - d0);
  if (a >= b) return dst;
  if (stereo) {
    const [gl, gr] = balanceGains(pan);
    const kl = g * gl, kr = g * gr;
    const DL = dst.L, DR = dst.R;
    for (let i = a, j = d0; i < b; i++, j++) {
      DL[j] += sl[i] * kl;
      DR[j] += sr_[i] * kr;
    }
  } else {
    const [gl, gr] = panGains(pan);
    const kl = g * gl, kr = g * gr;
    const DL = dst.L, DR = dst.R;
    for (let i = a, j = d0; i < b; i++, j++) {
      const v = sl[i];
      DL[j] += v * kl;
      DR[j] += v * kr;
    }
  }
  return dst;
}

/**
 * Mix a stereo pair into dst. Accepts (dst, L, R, t, gDb, pan) or (dst, Buf, t, gDb, pan) (== addAt).
 * pan acts as balance.
 */
export function addAtStereo(dst, a, b, c, d, e) {
  if (isBuf(a)) return addAt(dst, a, b, c, d);
  const tmp = Buf.from(a, b);
  return addAt(dst, tmp, c, d || 0, e || 0);
}

/** Mix several Bufs/arrays (same length not required) into a new Buf of `seconds` (default longest). */
export function sumBufs(list, seconds = null) {
  let len = 0;
  for (const b of list) len = Math.max(len, isBuf(b) ? b.length : b.length);
  const out = new Buf(seconds != null ? seconds : len / SR);
  for (const b of list) addAt(out, b, 0, 0, 0);
  return out;
}

/** raised-cosine (default) / linear / exp fade, in place. Works on Buf or Float32Array. */
export function fade(buf, inSec = 0, outSec = 0, shape = 'cos') {
  const chans = isBuf(buf) ? [buf.L, buf.R] : [buf];
  const shp = (x) => (shape === 'lin' ? x : shape === 'exp' ? x * x : 0.5 - 0.5 * Math.cos(Math.PI * x));
  for (const ch of chans) {
    const n = ch.length;
    const ni = Math.min(n, Math.round(inSec * SR));
    const no = Math.min(n, Math.round(outSec * SR));
    for (let i = 0; i < ni; i++) ch[i] *= shp(i / ni);
    for (let i = 0; i < no; i++) ch[n - 1 - i] *= shp(i / no);
  }
  return buf;
}

/** hard-zero everything from tSec on (e.g. the 22.0 s cut), with a micro fade (default 2 ms). */
export function cutAt(buf, tSec, fadeSec = 0.002) {
  const chans = isBuf(buf) ? [buf.L, buf.R] : [buf];
  for (const ch of chans) {
    const s = Math.round(tSec * SR);
    const nf = Math.round(fadeSec * SR);
    for (let i = Math.max(0, s - nf); i < Math.min(ch.length, s); i++) ch[i] *= 0.5 + 0.5 * Math.cos(Math.PI * (i - (s - nf) + 0.5) / nf);
    if (s < ch.length) ch.fill(0, Math.max(0, s));
  }
  return buf;
}

/** sample peak (linear) of a Buf or Float32Array */
export function peakOf(buf, t0 = 0, t1 = Infinity) {
  const chans = isBuf(buf) ? [buf.L, buf.R] : [buf];
  let p = 0;
  for (const ch of chans) {
    const a = Math.max(0, Math.round(t0 * SR));
    const b = Math.min(ch.length, t1 === Infinity ? ch.length : Math.round(t1 * SR));
    for (let i = a; i < b; i++) {
      const v = Math.abs(ch[i]);
      if (v > p) p = v;
    }
  }
  return p;
}
/** scale in place so sample peak == db (default -1 dBFS). Returns the applied gain in dB. */
export function normalizePeak(buf, db = -1) {
  const p = peakOf(buf);
  if (p < 1e-12) return 0;
  const g = dbToLin(db) / p;
  if (isBuf(buf)) buf.scale(g);
  else for (let i = 0; i < buf.length; i++) buf[i] *= g;
  return linToDb(g);
}

export const toMono = (buf) => {
  const o = new Float32Array(buf.length);
  for (let i = 0; i < o.length; i++) o[i] = 0.5 * (buf.L[i] + buf.R[i]);
  return o;
};
/** returns a Float32Array/Buf copy reversed in time */
export function reverse(x) {
  if (isBuf(x)) return Buf.from(reverse(x.L), reverse(x.R));
  const o = new Float32Array(x.length);
  for (let i = 0, n = x.length; i < n; i++) o[i] = x[n - 1 - i];
  return o;
}
/** Buf with `extraSec` seconds of silence appended (copy). */
export function extend(buf, extraSec) {
  const n = buf.length + Math.round(extraSec * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  L.set(buf.L);
  R.set(buf.R);
  return Buf.from(L, R);
}
export function concat(list) {
  let n = 0;
  for (const b of list) n += b.length;
  const L = new Float32Array(n), R = new Float32Array(n);
  let o = 0;
  for (const b of list) {
    L.set(b.L, o);
    R.set(b.R, o);
    o += b.length;
  }
  return Buf.from(L, R);
}

// ----------------------------------------------------------------------------
// WAV I/O
// ----------------------------------------------------------------------------
/**
 * Encode to WAV. opts.bits: 32 (IEEE float, default) | 24 | 16 (PCM, seeded TPDF dither).
 * buf may be a Buf or a mono Float32Array.
 */
export function encodeWav(buf, opts = {}) {
  const bits = opts.bits || 32;
  const L = isBuf(buf) ? buf.L : buf;
  const R = isBuf(buf) ? buf.R : null;
  const ch = R ? 2 : 1;
  const n = L.length;
  const bytesPer = bits / 8;
  const dataBytes = n * ch * bytesPer;
  const isFloat = bits === 32;
  const headerBytes = 44 + (isFloat ? 12 : 0);
  const out = Buffer.alloc(headerBytes + dataBytes);
  let p = 0;
  out.write('RIFF', p); p += 4;
  out.writeUInt32LE(headerBytes - 8 + dataBytes, p); p += 4;
  out.write('WAVE', p); p += 4;
  out.write('fmt ', p); p += 4;
  out.writeUInt32LE(16, p); p += 4;
  out.writeUInt16LE(isFloat ? 3 : 1, p); p += 2;
  out.writeUInt16LE(ch, p); p += 2;
  out.writeUInt32LE(SR, p); p += 4;
  out.writeUInt32LE(SR * ch * bytesPer, p); p += 4;
  out.writeUInt16LE(ch * bytesPer, p); p += 2;
  out.writeUInt16LE(bits, p); p += 2;
  if (isFloat) {
    out.write('fact', p); p += 4;
    out.writeUInt32LE(4, p); p += 4;
    out.writeUInt32LE(n, p); p += 4;
  }
  out.write('data', p); p += 4;
  out.writeUInt32LE(dataBytes, p); p += 4;
  if (isFloat) {
    const f = new Float32Array(n * ch);
    if (R) for (let i = 0, j = 0; i < n; i++) { f[j++] = L[i]; f[j++] = R[i]; }
    else f.set(L);
    Buffer.from(f.buffer, f.byteOffset, f.byteLength).copy(out, p);
  } else {
    const rng = mulberry32(opts.seed != null ? opts.seed : 12345);
    const scale = bits === 16 ? 32768 : 8388608;
    const lo = -scale, hi = scale - 1;
    const q = (v) => {
      let s = v * scale + (rng() - rng()); // TPDF dither, +-1 LSB
      s = Math.round(s);
      return s < lo ? lo : s > hi ? hi : s;
    };
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < ch; c++) {
        const s = q(c === 0 ? L[i] : R[i]);
        if (bits === 16) { out.writeInt16LE(s, p); p += 2; }
        else { out.writeIntLE(s, p, 3); p += 3; }
      }
    }
  }
  return out;
}

export function writeWav(file, buf, opts = {}) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, encodeWav(buf, opts));
  return file;
}

/** decode WAV bytes -> {channels: Float32Array[], rate, bits, format} (no resampling). */
export function decodeWav(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (b.length < 12 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error('decodeWav: not a RIFF/WAVE file');
  let p = 12, fmt = null, dataOff = -1, dataLen = 0;
  while (p + 8 <= b.length) {
    const id = b.toString('ascii', p, p + 4);
    let sz = b.readUInt32LE(p + 4);
    const body = p + 8;
    if (id === 'fmt ') {
      fmt = {
        tag: b.readUInt16LE(body),
        ch: b.readUInt16LE(body + 2),
        rate: b.readUInt32LE(body + 4),
        bits: b.readUInt16LE(body + 14),
      };
      if (fmt.tag === 0xfffe && sz >= 26) fmt.tag = b.readUInt16LE(body + 24); // extensible subformat
    } else if (id === 'data') {
      dataOff = body;
      if (sz === 0 || sz === 0xffffffff || body + sz > b.length) sz = b.length - body;
      dataLen = sz;
      break;
    }
    p = body + sz + (sz & 1);
  }
  if (!fmt || dataOff < 0) throw new Error('decodeWav: missing fmt/data chunk');
  const { tag, ch, rate, bits } = fmt;
  const bytesPer = bits / 8;
  const n = Math.floor(dataLen / (bytesPer * ch));
  const chans = Array.from({ length: ch }, () => new Float32Array(n));
  let q = dataOff;
  const isFloat = tag === 3;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      let v;
      if (isFloat) {
        if (bits === 32) v = b.readFloatLE(q);
        else if (bits === 64) v = b.readDoubleLE(q);
        else throw new Error('decodeWav: unsupported float depth ' + bits);
      } else if (bits === 16) v = b.readInt16LE(q) / 32768;
      else if (bits === 24) v = b.readIntLE(q, 3) / 8388608;
      else if (bits === 32) v = b.readInt32LE(q) / 2147483648;
      else if (bits === 8) v = (b.readUInt8(q) - 128) / 128;
      else throw new Error('decodeWav: unsupported PCM depth ' + bits);
      q += bytesPer;
      chans[c][i] = v;
    }
  }
  return { channels: chans, rate, bits, format: isFloat ? 'float' : 'pcm' };
}

/** Read a WAV file -> Buf at 48 kHz stereo (mono duplicated; >2 ch: first two; any rate resampled). */
export function readWav(file) {
  const d = decodeWav(fs.readFileSync(file));
  let [L, R] = d.channels;
  if (!R) R = Float32Array.from(L);
  if (d.rate !== SR) {
    L = resample(L, d.rate, SR);
    R = resample(R, d.rate, SR);
  }
  const b = Buf.from(L, R);
  b.srcRate = d.rate;
  b.srcChannels = d.channels.length;
  return b;
}

// ----------------------------------------------------------------------------
// resampling (windowed-sinc, Kaiser)
// ----------------------------------------------------------------------------
function bessel0(x) {
  let sum = 1, term = 1;
  const q = (x * x) / 4;
  for (let k = 1; k < 200; k++) {
    term *= q / (k * k);
    sum += term;
    if (term < 1e-14 * sum) break;
  }
  return sum;
}
/** Kaiser window value at position u in [-1,1] */
export function kaiser(u, beta) {
  const a = 1 - u * u;
  return a <= 0 ? 0 : bessel0(beta * Math.sqrt(a)) / bessel0(beta);
}

const _kernelCache = new Map();
function sincTable(halfWidth, beta, res) {
  const key = `${halfWidth}|${beta}|${res}`;
  let t = _kernelCache.get(key);
  if (t) return t;
  t = new Float64Array(halfWidth * res + 2);
  for (let i = 0; i < t.length; i++) {
    const s = i / res;
    const sinc = s < 1e-12 ? 1 : Math.sin(Math.PI * s) / (Math.PI * s);
    t[i] = s >= halfWidth ? 0 : sinc * kaiser(s / halfWidth, beta);
  }
  _kernelCache.set(key, t);
  return t;
}

/**
 * Band-limited read of x at positions j*speed (j = 0..): speed>1 = faster/higher pitch/shorter.
 * Anti-aliased when speed>1. Output length = floor(len/speed). Unity DC gain.
 */
export function resampleBy(x, speed, opts = {}) {
  const halfWidth = opts.halfWidth || 16, beta = opts.beta || 8.6, res = 512;
  const n = x.length;
  if (Math.abs(speed - 1) < 1e-12) return Float32Array.from(x);
  const nOut = Math.max(0, Math.floor(n / speed));
  const out = new Float32Array(nOut);
  const fc = speed > 1 ? 0.97 / speed : 1;
  const tbl = sincTable(halfWidth, beta, res);
  const reach = halfWidth / fc;
  for (let j = 0; j < nOut; j++) {
    const p = j * speed;
    const k0 = Math.ceil(p - reach), k1 = Math.floor(p + reach);
    let acc = 0, wsum = 0;
    for (let k = Math.max(0, k0); k <= k1 && k < n; k++) {
      const s = Math.abs(k - p) * fc * res;
      const i = s | 0;
      const w = tbl[i] + (s - i) * (tbl[i + 1] - tbl[i]);
      acc += x[k] * w;
      wsum += w;
    }
    // normalise only when the kernel is fully inside the signal (edges: renormalise too, avoids dips)
    out[j] = wsum > 1e-9 ? acc / wsum : 0;
  }
  return out;
}
export function resample(x, srcRate, dstRate = SR, opts) {
  return srcRate === dstRate ? Float32Array.from(x) : resampleBy(x, srcRate / dstRate, opts);
}

// ----------------------------------------------------------------------------
// misc small array helpers shared by the library
// ----------------------------------------------------------------------------
/** apply fn(Float32Array)->Float32Array to a mono array or to both channels of a Buf */
export function perChannel(x, fn) {
  return isBuf(x) ? Buf.from(fn(x.L, 0), fn(x.R, 1)) : fn(x, 0);
}
/** read value of a scalar-or-array parameter at sample i */
export const P = (p, i) => (typeof p === 'number' ? p : p[i]);
export const isArr = (p) => typeof p !== 'number' && p != null;
export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
