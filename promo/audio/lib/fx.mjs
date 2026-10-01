// =============================================================================
// fx.mjs - time-based and nonlinear effects, stereo tools, varispeed/pitch.
//   * mono-in/mono-out unless stated; Buf in -> Buf out.
//   * stereo-PRODUCING effects (pingPong, chorus, ensemble, flanger, phaser, decorrelate, widen)
//     always return a Buf; a mono Float32Array input is treated as dual-mono.
//   * time params in seconds unless the name ends in Ms.
// =============================================================================
import { SR, TWO_PI, Buf, isBuf, isArr, P, clamp, dbToLin, perChannel, mulberry32, nextPow2, kaiser, resampleBy, balanceGains } from './core.mjs';
import { drift } from './gen.mjs';
import { biquad } from './filt.mjs';

const toBuf = (x) => (isBuf(x) ? x : Buf.from(x, Float32Array.from(x)));

// ---------------------------------------------------------------------------
// fractional delay line helpers
// ---------------------------------------------------------------------------
function hermite(buf, mask, wp, d) {
  const p = wp - d;
  const i = Math.floor(p);
  const f = p - i;
  const y0 = buf[(i - 1) & mask], y1 = buf[i & mask], y2 = buf[(i + 1) & mask], y3 = buf[(i + 2) & mask];
  const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
  return ((c3 * f + c2) * f + c1) * f + y1;
}

// ---------------------------------------------------------------------------
// delay / echo
// ---------------------------------------------------------------------------
/**
 * delay(x, timeSec, feedback=0.4, mix=0.35, opts)  (mono or Buf)
 *  timeSec: scalar | Float32Array (per-sample, seconds)
 *  opts: {damp=0 (0..1 lowpass in loop), hpHz=0 (highpass in loop), sat=0 (tanh drive in loop, tape-ish),
 *         wowMs=0 (slow pitch wobble depth), wowRate=0.6, tail=0 (extra seconds appended), stereoSpread=0 (R time *= 1+spread),
 *         wetOnly=false, seed=1}
 * Tempo-sync: delay(x, cues.BEAT*0.75, ...) = dotted-8th.
 */
export function delay(x, timeSec, feedback = 0.4, mix = 0.35, opts = {}) {
  if (isBuf(x)) {
    const sp = opts.stereoSpread || 0;
    const L = delay(x.L, timeSec, feedback, mix, opts);
    const R = delay(x.R, isArr(timeSec) ? timeSec.map((v) => v * (1 + sp)) : timeSec * (1 + sp), feedback, mix, { ...opts, seed: (opts.seed || 1) + 1 });
    return Buf.from(L, R);
  }
  const { damp = 0, hpHz = 0, sat = 0, wowMs = 0, wowRate = 0.6, tail = 0, wetOnly = false, seed = 1, sr = SR } = opts;
  const nIn = x.length, n = nIn + Math.round(tail * sr);
  const out = new Float32Array(n);
  let maxD = isArr(timeSec) ? 0 : timeSec;
  if (isArr(timeSec)) for (let i = 0; i < timeSec.length; i += 64) maxD = Math.max(maxD, timeSec[i]);
  const len = nextPow2(Math.ceil((maxD + wowMs / 1000 + 0.01) * sr) + 8);
  const line = new Float32Array(len), mask = len - 1;
  const wow = wowMs > 0 ? drift(n, wowRate, (wowMs / 1000) * sr, seed, sr) : null;
  let lp = 0, hpS = 0;
  const kd = clamp(damp, 0, 0.999);
  const hpA = hpHz > 0 ? 1 - Math.exp((-TWO_PI * hpHz) / sr) : 0;
  let wp = 0;
  for (let i = 0; i < n; i++) {
    let d = P(timeSec, Math.min(i, isArr(timeSec) ? timeSec.length - 1 : 0)) * sr;
    if (wow) d += wow[i];
    d = Math.max(3, d);
    const w = hermite(line, mask, wp, d);
    let fb = w;
    if (kd > 0) {
      lp += (1 - kd) * (fb - lp);
      fb = lp;
    }
    if (hpA > 0) {
      hpS += hpA * (fb - hpS);
      fb -= hpS;
    }
    if (sat > 0) fb = Math.tanh(fb * (1 + sat)) / (1 + sat * 0.5);
    const xin = i < nIn ? x[i] : 0;
    let wv = xin + fb * feedback;
    if (wv < 1e-20 && wv > -1e-20) wv = 0;
    line[wp & mask] = wv;
    wp++;
    out[i] = wetOnly ? w * mix : (i < nIn ? x[i] : 0) + w * mix;
  }
  return out;
}

/**
 * pingPong(x, timeSec, feedback=0.45, mix=0.35, opts) -> Buf
 * opts: {damp, hpHz, tail, startSide: 'L'|'R', width=1, wetOnly=false}
 */
export function pingPong(x, timeSec, feedback = 0.45, mix = 0.35, opts = {}) {
  const { damp = 0.2, hpHz = 0, tail = 0, startSide = 'L', width = 1, wetOnly = false, sr = SR } = opts;
  const src = isBuf(x) ? x : Buf.from(x, x);
  const nIn = src.length, n = nIn + Math.round(tail * sr);
  const oL = new Float32Array(n), oR = new Float32Array(n);
  const len = nextPow2(Math.ceil(timeSec * sr) + 8);
  const lA = new Float32Array(len), lB = new Float32Array(len), mask = len - 1;
  const D = Math.max(3, Math.round(timeSec * sr));
  let lpA = 0, lpB = 0, hA = 0, hB = 0;
  const kd = clamp(damp, 0, 0.999);
  const hpA = hpHz > 0 ? 1 - Math.exp((-TWO_PI * hpHz) / sr) : 0;
  const first = startSide === 'L';
  for (let i = 0; i < n; i++) {
    const m = i < nIn ? 0.5 * (src.L[i] + src.R[i]) : 0;
    const a = lA[(i - D) & mask], b = lB[(i - D) & mask];
    lpA += (1 - kd) * (a - lpA);
    lpB += (1 - kd) * (b - lpB);
    let fa = lpA, fb = lpB;
    if (hpA > 0) {
      hA += hpA * (fa - hA); fa -= hA;
      hB += hpA * (fb - hB); fb -= hB;
    }
    // A feeds B, B feeds A; input enters line A (first) only
    let va = (first ? m : 0) + fb * feedback, vb = (first ? 0 : m) + fa * feedback;
    if (va < 1e-20 && va > -1e-20) va = 0;
    if (vb < 1e-20 && vb > -1e-20) vb = 0;
    lA[i & mask] = va;
    lB[i & mask] = vb;
    const wl = first ? a : b, wr = first ? b : a;
    const mid = 0.5 * (wl + wr);
    const wL = mid + (wl - mid) * width, wR = mid + (wr - mid) * width;
    oL[i] = (wetOnly ? 0 : i < nIn ? src.L[i] : 0) + wL * mix;
    oR[i] = (wetOnly ? 0 : i < nIn ? src.R[i] : 0) + wR * mix;
  }
  return Buf.from(oL, oR);
}

// ---------------------------------------------------------------------------
// chorus / ensemble / flanger / phaser
// ---------------------------------------------------------------------------
function modVoices(ch, voices, mix, baseMs, sr) {
  // voices: [{rate, depthMs, phase, fastRate, fastDepthMs, gain}]  -> Float32Array wet
  const n = ch.length;
  const maxMs = baseMs + Math.max(...voices.map((v) => v.depthMs + (v.fastDepthMs || 0))) + 2;
  const len = nextPow2(Math.ceil((maxMs / 1000) * sr) + 8);
  const line = new Float32Array(len), mask = len - 1;
  const wet = new Float32Array(n);
  const ph = voices.map((v) => v.phase), phF = voices.map((v) => (v.fastPhase || 0));
  for (let i = 0; i < n; i++) {
    line[i & mask] = ch[i];
    let acc = 0;
    for (let k = 0; k < voices.length; k++) {
      const v = voices[k];
      let dMs = baseMs + v.depthMs * Math.sin(TWO_PI * ph[k]);
      if (v.fastDepthMs) {
        dMs += v.fastDepthMs * Math.sin(TWO_PI * phF[k]);
        phF[k] += v.fastRate / sr;
        if (phF[k] > 1) phF[k] -= 1;
      }
      ph[k] += v.rate / sr;
      if (ph[k] > 1) ph[k] -= 1;
      acc += hermite(line, mask, i, Math.max(3, (dMs / 1000) * sr)) * v.gain;
    }
    wet[i] = acc;
  }
  void mix;
  return wet;
}

/**
 * chorus(x, opts) -> Buf.  opts: {rate=0.7, depthMs=2.4, delayMs=15, voices=3, mix=0.5, spread=1, seed=1}
 * Each voice has its own LFO phase/rate; voices alternate left/right. Stereo input keeps its image.
 */
export function chorus(x, opts = {}) {
  const { rate = 0.7, depthMs = 2.4, delayMs = 15, voices = 3, mix = 0.5, spread = 1, seed = 1, sr = SR } = opts;
  const rng = mulberry32(seed);
  const src = toBuf(x);
  const mk = (side) => Array.from({ length: voices }, (_, k) => ({
    rate: rate * (1 + 0.17 * k + 0.05 * rng()), depthMs: depthMs * (0.8 + 0.4 * rng()),
    phase: (k + (side ? 0.5 : 0)) / voices + 0.07 * rng(), gain: 1 / voices,
  }));
  const wL = modVoices(src.L, mk(0), mix, delayMs, sr), wR = modVoices(src.R, mk(1), mix, delayMs * 1.03, sr);
  const L = new Float32Array(src.length), R = new Float32Array(src.length);
  const w = mix, d = 1 - 0.5 * mix;
  for (let i = 0; i < L.length; i++) {
    const m = 0.5 * (wL[i] + wR[i]);
    L[i] = src.L[i] * d + (m + (wL[i] - m) * spread) * w;
    R[i] = src.R[i] * d + (m + (wR[i] - m) * spread) * w;
  }
  return Buf.from(L, R);
}

/**
 * ensemble(x, opts) -> Buf: string-machine / "choir of detuned voices" thickening.
 * Each voice = slow deep LFO + fast shallow vibrato; voices panned across the field.
 * opts: {voices=6, rate=0.45, depthMs=3.2, delayMs=18, fastRate=5.2, fastDepthMs=0.15, mix=0.7, spread=1, seed=1}
 */
export function ensemble(x, opts = {}) {
  const { voices = 6, rate = 0.45, depthMs = 3.2, delayMs = 18, fastRate = 5.2, fastDepthMs = 0.15, mix = 0.7, spread = 1, seed = 1, sr = SR } = opts;
  const rng = mulberry32(seed);
  const src = toBuf(x);
  const n = src.length;
  const L = new Float32Array(n), R = new Float32Array(n);
  const wetL = new Float32Array(n), wetR = new Float32Array(n);
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = 0.5 * (src.L[i] + src.R[i]);
  // process the sides separately (keep stereo input) by using L/R for the respective half of voices
  for (let k = 0; k < voices; k++) {
    const pos = voices === 1 ? 0 : (k / (voices - 1)) * 2 - 1;
    const v = [{
      rate: rate * (0.8 + 0.4 * rng()), depthMs: depthMs * (0.7 + 0.6 * rng()), phase: rng(),
      fastRate: fastRate * (0.8 + 0.4 * rng()), fastDepthMs, fastPhase: rng(), gain: 1,
    }];
    const inp = pos <= 0 ? src.L : src.R;
    const w = modVoices(inp, v, 1, delayMs * (0.85 + 0.3 * rng()), sr);
    const [gl, gr] = [Math.cos(((pos * spread + 1) * Math.PI) / 4), Math.sin(((pos * spread + 1) * Math.PI) / 4)];
    for (let i = 0; i < n; i++) {
      wetL[i] += w[i] * gl;
      wetR[i] += w[i] * gr;
    }
  }
  const norm = 1.2 / Math.sqrt(voices);
  const dry = 1 - 0.6 * mix;
  for (let i = 0; i < n; i++) {
    L[i] = src.L[i] * dry + wetL[i] * norm * mix;
    R[i] = src.R[i] * dry + wetR[i] * norm * mix;
  }
  return Buf.from(L, R);
}

/** flanger(x, {rate=0.25, depthMs=2.0, delayMs=2.5, feedback=0.55, mix=0.5, stereoPhase=0.25}) -> Buf (feedback may be negative) */
export function flanger(x, opts = {}) {
  const { rate = 0.25, depthMs = 2.0, delayMs = 2.5, feedback = 0.55, mix = 0.5, stereoPhase = 0.25, sr = SR } = opts;
  const src = toBuf(x);
  const run = (ch, ph0) => {
    const n = ch.length, out = new Float32Array(n);
    const len = nextPow2(Math.ceil(((delayMs + depthMs + 2) / 1000) * sr) + 8);
    const line = new Float32Array(len), mask = len - 1;
    let ph = ph0, fb = 0;
    for (let i = 0; i < n; i++) {
      const d = Math.max(3, ((delayMs + depthMs * 0.5 * (1 + Math.sin(TWO_PI * ph))) / 1000) * sr);
      ph += rate / sr;
      if (ph > 1) ph -= 1;
      line[i & mask] = ch[i] + fb * feedback;
      let w = hermite(line, mask, i, d);
      if (w < 1e-20 && w > -1e-20) w = 0;
      fb = w;
      out[i] = ch[i] * (1 - 0.5 * mix) + w * mix;
    }
    return out;
  };
  return Buf.from(run(src.L, 0), run(src.R, stereoPhase));
}

/** phaser(x, {rate=0.3, stages=6, minHz=300, maxHz=3200, feedback=0.4, mix=0.5, stereoPhase=0.25}) -> Buf */
export function phaser(x, opts = {}) {
  const { rate = 0.3, stages = 6, minHz = 300, maxHz = 3200, feedback = 0.4, mix = 0.5, stereoPhase = 0.25, sr = SR } = opts;
  const src = toBuf(x);
  const run = (ch, ph0) => {
    const n = ch.length, out = new Float32Array(n);
    const z = new Float64Array(stages);
    let ph = ph0, fb = 0;
    const lr = Math.log(maxHz / minHz);
    for (let i = 0; i < n; i++) {
      const f = minHz * Math.exp(lr * 0.5 * (1 + Math.sin(TWO_PI * ph)));
      ph += rate / sr;
      if (ph > 1) ph -= 1;
      const t = Math.tan((Math.PI * Math.min(f, sr * 0.45)) / sr);
      const a = (t - 1) / (t + 1);
      let v = ch[i] + fb * feedback;
      for (let s = 0; s < stages; s++) {
        const y = a * v + z[s];
        z[s] = v - a * y;
        v = y;
      }
      fb = v;
      out[i] = ch[i] * (1 - 0.5 * mix) + v * mix * 0.9;
    }
    return out;
  };
  return Buf.from(run(src.L, 0), run(src.R, stereoPhase));
}

// ---------------------------------------------------------------------------
// bitcrush / sample-rate reduction
// ---------------------------------------------------------------------------
/**
 * bitcrush(x, {bits=8, rate=0 (target sample rate Hz, 0=off), dither=0 (LSB), mix=1, seed=1})
 * `rate` uses sample-and-hold (deliberately aliased, lo-fi). Buf ok.
 */
export function bitcrush(x, opts = {}) {
  if (isBuf(x)) return perChannel(x, (c, i) => bitcrush(c, { ...opts, seed: (opts.seed || 1) + i }));
  const { bits = 8, rate = 0, dither = 0, mix = 1, seed = 1, sr = SR } = opts;
  const n = x.length, out = new Float32Array(n);
  const q = Math.pow(2, Math.max(1, bits) - 1);
  const rng = mulberry32(seed);
  const step = rate > 0 ? rate / sr : 1;
  let acc = 1, held = 0;
  for (let i = 0; i < n; i++) {
    acc += step;
    if (acc >= 1) {
      acc -= Math.floor(acc);
      let v = x[i] * q;
      if (dither > 0) v += (rng() - rng()) * dither;
      held = Math.round(v) / q;
    }
    out[i] = x[i] * (1 - mix) + held * mix;
  }
  return out;
}

// ---------------------------------------------------------------------------
// waveshaping (with optional 2x/4x oversampling)
// ---------------------------------------------------------------------------
const HB_HALF = 12; // 24-tap odd half-band
const HB = (() => {
  const h = new Float64Array(HB_HALF);
  for (let k = 0; k < HB_HALF; k++) {
    const m = 2 * k + 1;
    h[k] = ((Math.sin((Math.PI * m) / 2) / ((Math.PI * m) / 2)) * kaiser(m / (2 * HB_HALF), 8.5));
  }
  return h;
})();
export function upsample2(x) {
  const n = x.length, y = new Float32Array(2 * n);
  for (let i = 0; i < n; i++) {
    y[2 * i] = x[i];
    let s = 0;
    for (let k = 0; k < HB_HALF; k++) {
      const a = i - k, b = i + 1 + k;
      s += HB[k] * ((a >= 0 ? x[a] : 0) + (b < n ? x[b] : 0));
    }
    y[2 * i + 1] = s;
  }
  return y;
}
export function downsample2(y) {
  const n = y.length >> 1, x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0.5 * y[2 * i];
    for (let k = 0; k < HB_HALF; k++) {
      const a = 2 * i - 2 * k - 1, b = 2 * i + 2 * k + 1;
      s += 0.5 * HB[k] * ((a >= 0 ? y[a] : 0) + (b < y.length ? y[b] : 0));
    }
    x[i] = s;
  }
  return x;
}

const SHAPES = {
  tanh: (v) => Math.tanh(v),
  soft: (v) => v / (1 + Math.abs(v)),
  atan: (v) => (2 / Math.PI) * Math.atan((Math.PI / 2) * v),
  cubic: (v) => (v <= -1 ? -2 / 3 : v >= 1 ? 2 / 3 : v - (v * v * v) / 3) * 1.5,
  hard: (v) => (v < -1 ? -1 : v > 1 ? 1 : v),
  fold: (v) => Math.sin((Math.PI / 2) * v), // smooth sine fold
  tri: (v) => {
    // triangle wavefolder
    let t = (v + 1) / 4;
    t -= Math.floor(t);
    return Math.abs(4 * t - 2) - 1;
  },
  asym: (v) => (v >= 0 ? Math.tanh(v) : Math.tanh(v * 0.55) / 0.55 * 0.8),
};
/**
 * waveshape(x, type='tanh', drive=1, {bias=0, mix=1, oversample=1|2|4, comp=true})
 * type: tanh|soft|atan|cubic|hard|fold|tri|asym. drive is a linear pre-gain (scalar|array).
 * comp: divide by shape(drive) so a full-scale (|x|=1) input still peaks at ~1 (quiet signals get louder as drive rises).
 */
export function waveshape(x, type = 'tanh', drive = 1, opts = {}) {
  if (isBuf(x)) return perChannel(x, (c) => waveshape(c, type, drive, opts));
  const { bias = 0, mix = 1, oversample = 1, comp = true } = opts;
  const f = typeof type === 'function' ? type : SHAPES[type];
  if (!f) throw new Error(`waveshape: unknown type "${type}"`);
  let y = x;
  let up = oversample >= 4 ? 2 : oversample >= 2 ? 1 : 0;
  let dr = drive;
  for (let u = 0; u < up; u++) {
    y = upsample2(y);
    if (isArr(dr)) dr = upsample2(dr);
  }
  const n = y.length, out = new Float32Array(n);
  const dc = f(bias);
  const doComp = comp && type !== 'fold' && type !== 'tri' && typeof type !== 'function';
  for (let i = 0; i < n; i++) {
    const d = P(dr, i);
    let v = f(y[i] * d + bias) - dc;
    if (doComp) v /= Math.max(0.2, Math.abs(f(d + bias) - dc));
    out[i] = v;
  }
  let z = out;
  for (let u = 0; u < up; u++) z = downsample2(z);
  if (mix < 1) for (let i = 0; i < z.length; i++) z[i] = x[i] * (1 - mix) + z[i] * mix;
  return z;
}

// ---------------------------------------------------------------------------
// tremolo / auto-pan
// ---------------------------------------------------------------------------
/**
 * tremolo(x, rate, depth=0.5, {shape='sine'|'tri'|'square', phase=0, stereoPhase=0 (Buf only)})
 * gain swings between (1-depth) and 1. rate Hz scalar|array.
 */
export function tremolo(x, rate, depth = 0.5, opts = {}) {
  if (isBuf(x)) {
    const sp = opts.stereoPhase || 0;
    return Buf.from(tremolo(x.L, rate, depth, opts), tremolo(x.R, rate, depth, { ...opts, phase: (opts.phase || 0) + sp }));
  }
  const { shape = 'sine', phase = 0, sr = SR } = opts;
  const n = x.length, out = new Float32Array(n);
  let ph = phase - Math.floor(phase);
  for (let i = 0; i < n; i++) {
    let l;
    if (shape === 'tri') l = 1 - Math.abs(2 * ph - 1);
    else if (shape === 'square') l = ph < 0.5 ? 1 : 0;
    else l = 0.5 + 0.5 * Math.sin(TWO_PI * ph);
    const d = P(depth, i);
    out[i] = x[i] * (1 - d + d * l);
    ph += P(rate, i) / sr;
    ph -= Math.floor(ph);
  }
  return out;
}
/** auto-pan: constant-power sweep. depth 0..1 (1 = hard L<->R) */
export function autopan(x, rate = 0.5, depth = 0.7, opts = {}) {
  const src = toBuf(x);
  const { phase = 0, sr = SR } = opts;
  const n = src.length, L = new Float32Array(n), R = new Float32Array(n);
  let ph = phase;
  for (let i = 0; i < n; i++) {
    const p = depth * Math.sin(TWO_PI * ph);
    const a = (p + 1) * (Math.PI / 4);
    L[i] = (src.L[i] + src.R[i]) * 0.5 * Math.cos(a) * Math.SQRT2;
    R[i] = (src.L[i] + src.R[i]) * 0.5 * Math.sin(a) * Math.SQRT2;
    ph += rate / sr;
    ph -= Math.floor(ph);
  }
  return Buf.from(L, R);
}

// ---------------------------------------------------------------------------
// stereo tools
// ---------------------------------------------------------------------------
export function msEncode(buf) {
  const n = buf.length, M = new Float32Array(n), S = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    M[i] = 0.5 * (buf.L[i] + buf.R[i]);
    S[i] = 0.5 * (buf.L[i] - buf.R[i]);
  }
  return { M, S };
}
export function msDecode(M, S) {
  const n = M.length, L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    L[i] = M[i] + S[i];
    R[i] = M[i] - S[i];
  }
  return Buf.from(L, R);
}
/**
 * widen(buf, width=1.4, {bassMonoHz=0, sideGainDb=0}) -> Buf. width 0 = mono, 1 = unchanged, 2 = very wide.
 * bassMonoHz: remove side content below this frequency (keeps low end centred / mono-safe).
 */
export function widen(buf, width = 1.4, opts = {}) {
  const { bassMonoHz = 0 } = opts;
  const src = toBuf(buf);
  let { M, S } = msEncode(src);
  if (bassMonoHz > 0) S = biquad(biquad(S, 'hp', bassMonoHz, 0.54), 'hp', bassMonoHz, 1.3);
  const g = width * dbToLin(opts.sideGainDb || 0);
  for (let i = 0; i < S.length; i++) S[i] *= g;
  return msDecode(M, S);
}
/** Haas pseudo-stereo: delays one side by ms (mono-compat caveat). */
export function haas(x, ms = 12, side = 'R', opts = {}) {
  const src = toBuf(x), d = Math.round((ms / 1000) * SR), n = src.length;
  const L = Float32Array.from(src.L), R = Float32Array.from(src.R);
  const t = side === 'R' ? R : L, s = side === 'R' ? src.R : src.L;
  for (let i = 0; i < n; i++) t[i] = i >= d ? s[i - d] : 0;
  void opts;
  return Buf.from(L, R);
}
/**
 * decorrelate(x, {amount=1, seed=1}) -> Buf: allpass-diffused pseudo-stereo from mono (mono-compatible, no comb).
 */
export function decorrelate(x, opts = {}) {
  const { amount = 1, seed = 1, sr = SR } = opts;
  const rng = mulberry32(seed);
  const m = isBuf(x) ? Float32Array.from(x.L, (v, i) => 0.5 * (v + x.R[i])) : x;
  const chain = () => {
    let y = m;
    for (let k = 0; k < 4; k++) {
      const d = Math.round((0.0021 + 0.0011 * k + 0.0008 * rng()) * sr);
      const g = 0.55 + 0.15 * rng();
      y = schroederAllpass(y, d, g);
    }
    return y;
  };
  const a = chain(), b = chain();
  const L = new Float32Array(m.length), R = new Float32Array(m.length);
  for (let i = 0; i < m.length; i++) {
    L[i] = m[i] + (a[i] - m[i]) * amount;
    R[i] = m[i] + (b[i] - m[i]) * amount;
  }
  return Buf.from(L, R);
}
export function schroederAllpass(x, d, g) {
  const n = x.length, out = new Float32Array(n), line = new Float32Array(d + 1);
  let p = 0;
  for (let i = 0; i < n; i++) {
    const del = line[p];
    let v = x[i] + g * del;
    if (v < 1e-20 && v > -1e-20) v = 0; // flush denormals
    line[p] = v;
    out[i] = del - g * v;
    p = p + 1 > d ? 0 : p + 1;
  }
  return out;
}
/** constant-power pan of a Buf as a whole (balance) */
export function balance(buf, pan) {
  const [gl, gr] = balanceGains(pan);
  return Buf.from(buf.L.map((v) => v * gl), buf.R.map((v) => v * gr));
}

// ---------------------------------------------------------------------------
// pitch / varispeed (resampling based; for formant-preserving use ff.pitchShift)
// ---------------------------------------------------------------------------
/** pitchResample(x, semitones): changes pitch AND duration (like a tape/sampler). Buf ok. */
export function pitchResample(x, semis) {
  const ratio = Math.pow(2, semis / 12);
  return isBuf(x) ? Buf.from(resampleBy(x.L, ratio), resampleBy(x.R, ratio)) : resampleBy(x, ratio);
}
/** time-stretch by resampling only (== pitchResample inverse). ratio = new duration / old duration */
export function stretchResample(x, ratio) {
  return isBuf(x) ? Buf.from(resampleBy(x.L, 1 / ratio), resampleBy(x.R, 1 / ratio)) : resampleBy(x, 1 / ratio);
}
/**
 * varispeed(x, speed, {n=x.length, start=0}) - read x at a per-sample playback speed (Float32Array; 1 = normal,
 * negative = reverse, 0 = stopped). Hermite interpolation; no anti-aliasing (use for tape-stop, rewind,
 * pitch dives, whoosh sweeps, doppler). Out-of-range reads are silent. Buf ok.
 */
export function varispeed(x, speed, opts = {}) {
  if (isBuf(x)) return perChannel(x, (c) => varispeed(c, speed, opts));
  const n = opts.n != null ? opts.n : x.length;
  const out = new Float32Array(n);
  let p = (opts.start || 0) * SR;
  const len = x.length;
  const g = (i) => (i < 0 || i >= len ? 0 : x[i]);
  for (let i = 0; i < n; i++) {
    const ip = Math.floor(p), f = p - ip;
    if (ip >= -1 && ip < len + 1) {
      const y0 = g(ip - 1), y1 = g(ip), y2 = g(ip + 1), y3 = g(ip + 2);
      const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
      out[i] = ((c3 * f + c2) * f + c1) * f + y1;
    }
    p += P(speed, i);
  }
  return out;
}

/** one-line convenience wrappers used a lot by SFX */
export function lowpassSweep(x, f0, f1, mode = 'exp') {
  const n = x.length, f = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / Math.max(1, n - 1);
    f[i] = mode === 'exp' ? f0 * Math.pow(f1 / f0, t) : f0 + (f1 - f0) * t;
  }
  return biquad(x, 'lp', f, 0.9);
}

/**
 * granularCloud(src, seconds, opts) -> Buf   texture generator (shimmer beds, risers, dream clouds, rewinds)
 * src: mono Float32Array (or Buf, mixed to mono). Grains are Hann-windowed, randomly positioned, pitched, panned.
 * opts: {grainMs=90, density=40 (grains/s, scalar|Float32Array over time), pitch=0 (semis scalar | [lo,hi] | fn(rng,t)),
 *        pos=[0,1] (read position, fraction of src; moving from pos[0] to pos[1] over `seconds`), posJitter=0.05,
 *        spread=0.8, gainDb=0, seed=1, reverse=0 (probability a grain is reversed)}
 */
export function granularCloud(src, seconds, opts = {}) {
  const { grainMs = 90, density = 40, pitch = 0, pos = [0, 1], posJitter = 0.05, spread = 0.8, gainDb = 0, seed = 1, reverse = 0 } = opts;
  const m = isBuf(src) ? Float32Array.from(src.L, (v, i) => 0.5 * (v + src.R[i])) : src;
  const n = Math.round(seconds * SR), L = new Float32Array(n), R = new Float32Array(n);
  const rng = mulberry32(seed);
  const gl = Math.max(16, Math.round((grainMs / 1000) * SR));
  const win = new Float32Array(gl);
  for (let i = 0; i < gl; i++) win[i] = 0.5 - 0.5 * Math.cos((TWO_PI * (i + 0.5)) / gl);
  const g0 = dbToLin(gainDb) / Math.sqrt(Math.max(1, (typeof density === 'number' ? density : 40) * (grainMs / 1000)));
  let t = 0;
  while (t < seconds) {
    const d = typeof density === 'number' ? density : density[Math.min(density.length - 1, Math.round((t / seconds) * (density.length - 1)))];
    t += (1 / Math.max(0.5, d)) * (0.5 + rng());
    const i0 = Math.round(t * SR);
    if (i0 >= n) break;
    const semis = typeof pitch === 'function' ? pitch(rng, t) : Array.isArray(pitch) ? pitch[0] + (pitch[1] - pitch[0]) * rng() : pitch;
    const ratio = Math.pow(2, semis / 12);
    const rev = rng() < reverse;
    const p0 = (pos[0] + (pos[1] - pos[0]) * (t / seconds) + (rng() - 0.5) * 2 * posJitter) * m.length;
    const pan = (rng() * 2 - 1) * spread, a = (pan + 1) * (Math.PI / 4), pl = Math.cos(a) * Math.SQRT2 * 0.7071, pr = Math.sin(a) * Math.SQRT2 * 0.7071;
    for (let i = 0; i < gl && i0 + i < n; i++) {
      const sp = p0 + (rev ? gl - 1 - i : i) * ratio;
      const k = Math.floor(sp);
      if (k < 0 || k + 1 >= m.length) continue;
      const fr = sp - k;
      const v = (m[k] + (m[k + 1] - m[k]) * fr) * win[i] * g0;
      L[i0 + i] += v * pl;
      R[i0 + i] += v * pr;
    }
  }
  return Buf.from(L, R);
}
