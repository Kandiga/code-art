// =============================================================================
// instruments/processors.mjs - era-character processors. Every function: (Buf, opts) -> NEW Buf (same length). Deterministic.
//   tapeWobble, vinylCrackle (+ crackleTexture), reelHiss, opticalSoundtrack, lofiPhone, brickwallBright, warmTape, goldenAge, monoize
// Run them on a stem/bus AFTER the reverb send is summed in (the room should wobble and hiss with the music), before the master limiter.
// =============================================================================
import * as dsp from '../../lib/dsp.mjs';
const { SR, Buf, isBuf, mulberry32, seedOf, noise, biquad, biquadChain, varispeed, dbToLin } = dsp;
const TAU = Math.PI * 2;
const asBuf = (x) => (isBuf(x) ? x : Buf.from(x, Float32Array.from(x)));
const rmsOf = (b) => { let e = 0; for (let i = 0; i < b.length; i++) e += b.L[i] * b.L[i] + b.R[i] * b.R[i]; return Math.sqrt(e / (2 * Math.max(1, b.length))) + 1e-12; };
/** scale `y` (in place) so its RMS = RMS(ref) * 10^(db/20): era filters should colour the music, not change its level */
const matchRms = (y, ref, db = 0) => y.scale((rmsOf(ref) * Math.pow(10, db / 20)) / rmsOf(y));

/**
 * tapeWobble(buf, {wow=0.003, flutter=0.0006, drift=0.0015, wowRate=0.55, flutterRate=7.3, seed=1})
 * Varispeed pitch/time wobble: slow wow (+-0.3 % = about +-5 cents), fast flutter, random drift. Mean speed is exactly 1 (no sync drift).
 */
export function tapeWobble(buf, opts = {}) {
  const { wow = 0.003, flutter = 0.0006, drift = 0.0015, wowRate = 0.55, flutterRate = 7.3, seed = 1 } = opts;
  const src = asBuf(buf), n = src.length;
  const rng = mulberry32(seedOf('wobble', seed));
  const p1 = rng(), p2 = rng(), p3 = rng();
  const dr = dsp.drift(n, 0.9, drift, seed + 5);
  const spd = new Float32Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    spd[i] = wow * (0.62 * Math.sin(TAU * (wowRate * t + p1)) + 0.38 * Math.sin(TAU * (wowRate * 1.53 * t + p2))) + flutter * Math.sin(TAU * (flutterRate * t + p3)) * (0.7 + 0.3 * Math.sin(TAU * 0.3 * t)) + dr[i];
    mean += spd[i];
  }
  mean /= Math.max(1, n);
  for (let i = 0; i < n; i++) spd[i] = 1 + spd[i] - mean;
  return varispeed(src, spd);
}

/** crackleTexture(seconds, {level=0.5 (mean amplitude of the big pops; small pops are 0.2x), rate=22 (small pops/s), big=0.5 (big pops/s), surface=1 (surface-noise scale), seed=1}) -> Buf */
export function crackleTexture(seconds, opts = {}) {
  const { level = 0.5, rate = 22, big = 0.5, surface = 1, seed = 1 } = opts;
  const n = Math.round(seconds * SR);
  const rng = mulberry32(seedOf('crackle', seed));
  const L = new Float32Array(n), R = new Float32Array(n);
  const pops = (r, amp, len) => {
    let t = rng() / r;
    while (t < seconds) {
      const i0 = Math.round(t * SR);
      const a = -Math.log(1 - rng() * 0.999) * amp * (rng() < 0.5 ? -1 : 1);
      const ln = Math.max(8, Math.round(len * SR * (0.5 + rng())));
      const fr = (1500 + 3500 * rng()) / SR;
      const c = rng() < 0.5 ? L : R;
      for (let k = 0; k < ln * 4 && i0 + k < n; k++) c[i0 + k] += a * Math.exp(-k / ln) * Math.sin(TAU * fr * k + 0.6);
      t += -Math.log(1 - rng() * 0.999) / r;
    }
  };
  pops(rate, 0.2, 0.0004);
  pops(big, 1.0, 0.0009);
  const surf = noise('pink', n, seedOf('surf', seed), { rms: 0.07 * level * surface });
  const fl = biquad(L, 'hp', 400, 0.7), fr = biquad(R, 'hp', 400, 0.7);
  const sh = biquad(surf, 'hp', 900, 0.7);
  const out = Buf.from(fl, fr);
  for (let i = 0; i < n; i++) { out.L[i] = out.L[i] * level + sh[i]; out.R[i] = out.R[i] * level + sh[(i + 977) % n]; }
  return out;
}
/** vinylCrackle(buf, {levelDb=-26 (mean level of the big pops re full scale; surface noise sits ~23 dB lower), rate, big, surface, seed}) -> buf + crackle/surface noise */
export function vinylCrackle(buf, opts = {}) {
  const { levelDb = -26, seed = 1, ...rest } = opts;
  const src = asBuf(buf);
  const t = crackleTexture(src.length / SR, { seed, ...rest, level: dbToLin(levelDb) });
  const out = src.clone();
  for (let i = 0; i < out.length; i++) { out.L[i] += t.L[i]; out.R[i] += t.R[i]; }
  return out;
}

/** reelHiss(buf, {levelDb=-48 (hiss RMS), hum=false, seed}) -> tape hiss (pink-ish, slightly bright) added to buf */
export function reelHiss(buf, opts = {}) {
  const { levelDb = -48, hum = false, seed = 1 } = opts;
  const src = asBuf(buf), n = src.length;
  const mk = (sd) => {
    const p = noise('pink', n, seedOf('hiss', seed, sd), { rms: 1 }), w = noise('white', n, seedOf('hiss', seed, sd + 10), { rms: 1 });
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = p[i] * 0.06 + w[i];
    return biquad(biquad(x, 'hp', 250, 0.7), 'highshelf', 3500, 0.7, 3);
  };
  const hl = mk(1), hr = mk(2);
  let e = 0;
  for (let i = 0; i < n; i++) e += hl[i] * hl[i] + hr[i] * hr[i];
  const k = dbToLin(levelDb) / Math.sqrt(e / (2 * Math.max(1, n)) + 1e-30);
  const out = src.clone();
  for (let i = 0; i < n; i++) {
    const h = hum ? 0.05 * Math.sin(TAU * 60 * i / SR) + 0.02 * Math.sin(TAU * 120 * i / SR) : 0;
    out.L[i] += hl[i] * k + h * dbToLin(levelDb);
    out.R[i] += hr[i] * k + h * dbToLin(levelDb);
  }
  return out;
}

/**
 * opticalSoundtrack(buf, {lo=140, hi=5200, mono=0.85 (0..1 mix toward mono), sat=1.25, flutter=0.0012, hissDb=-50, seed})
 * Vintage optical-film sound: no lows, band-limited top, nasal 2.5 kHz bump, soft saturation, slight flutter, hiss, near-mono.
 */
export function opticalSoundtrack(buf, opts = {}) {
  const { lo = 140, hi = 5200, mono = 0.85, sat = 1.25, flutter = 0.0012, hissDb = -50, seed = 1 } = opts;
  let src = asBuf(buf);
  const n = src.length;
  const m = new Float32Array(n);
  for (let i = 0; i < n; i++) m[i] = 0.5 * (src.L[i] + src.R[i]);
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = src.L[i] * (1 - mono) + m[i] * mono; R[i] = src.R[i] * (1 - mono) + m[i] * mono; }
  const chain = [
    { type: 'hp', f: lo, q: 0.7 }, { type: 'hp', f: lo * 0.8, q: 0.9 },
    { type: 'peak', f: 2500, q: 1.1, g: 3 }, { type: 'peak', f: 900, q: 0.9, g: 1.5 },
    { type: 'lp', f: hi, q: 0.75 }, { type: 'lp', f: hi * 1.12, q: 0.9 },
  ];
  let y = biquadChain(Buf.from(L, R), chain);
  const d = sat;
  for (let i = 0; i < n; i++) { y.L[i] = Math.tanh(y.L[i] * d) / Math.tanh(d * 0.7) * 0.7; y.R[i] = Math.tanh(y.R[i] * d) / Math.tanh(d * 0.7) * 0.7; }
  y = biquadChain(y, [{ type: 'lp', f: hi * 1.2, q: 0.7 }]); // tidy the saturation products
  matchRms(y, src, -1.5);
  y = tapeWobble(y, { wow: 0.0008, flutter, drift: 0.0004, flutterRate: 6.1, seed });
  return hissDb > -100 ? reelHiss(y, { levelDb: hissDb, seed: seed + 3 }) : y;
}

/**
 * lofiPhone(buf, {lo=400, hi=4000, bits=11, rate=16000, drive=0.35, mono=true})
 * Phone-speaker beat: sample-rate/bit reduction, then the 400 Hz-4 kHz mono speaker band, then gentle saturation.
 */
export function lofiPhone(buf, opts = {}) {
  const { lo = 400, hi = 4000, bits = 11, rate = 16000, drive = 0.35, mono = true, seed = 1 } = opts;
  const src = asBuf(buf);
  let y = dsp.bitcrush(src, { bits, rate, dither: 0.5, seed });
  y = dsp.phoneSpeaker(y, { lo, hi, mono, drive });
  return matchRms(y, src, -2);
}

/** brickwallBright(buf, {ceilingDb=-1, airDb=2.2, driveDb=1.5, releaseMs=140}) - modern, bright, loud: air shelf + soft clip + true-peak limiter */
export function brickwallBright(buf, opts = {}) {
  const { ceilingDb = -1, airDb = 2.2, driveDb = 1.5, releaseMs = 140 } = opts;
  let y = biquadChain(asBuf(buf), [{ type: 'highshelf', f: 8500, g: airDb }, { type: 'lowshelf', f: 90, g: 0.8 }]);
  y = dsp.softclip(y, { ceilingDb: -0.5, knee: 0.55, driveDb });
  const r = dsp.limiter(y, { ceilingDb, releaseMs });
  return Buf.from(r.L, r.R); // NB: dsp.limiter() stamps a `gain` array on its result, shadowing Buf.gain(dB): return a clean Buf
}

/** warmTape(buf, {drive=1.3, hfHz=12000, lowDb=1.2}) - gentle tape saturation: soft-knee tanh, low bump, rolled-off top */
export function warmTape(buf, opts = {}) {
  const { drive = 1.3, hfHz = 12000, lowDb = 1.2 } = opts;
  const src = asBuf(buf);
  const f = (c) => { const o = new Float32Array(c.length); const k = 1 / drive; for (let i = 0; i < c.length; i++) o[i] = Math.tanh(c[i] * drive) * k; return o; };
  const y = Buf.from(f(src.L), f(src.R));
  return biquadChain(y, [{ type: 'lowshelf', f: 140, g: lowDb }, { type: 'lp', f: hfHz, q: 0.6 }]);
}

/** goldenAge(buf, {...}) - 1930s-50s studio warmth: 55 Hz-10 kHz, mid warmth, light saturation + tiny wobble */
export function goldenAge(buf, opts = {}) {
  const { hi = 10500, seed = 1 } = opts;
  let y = biquadChain(asBuf(buf), [{ type: 'hp', f: 55, q: 0.7 }, { type: 'peak', f: 300, q: 0.9, g: 1.3 }, { type: 'highshelf', f: 6000, g: -2.5 }, { type: 'lp', f: hi, q: 0.7 }]);
  y = warmTape(y, { drive: 1.15, hfHz: hi, lowDb: 0 });
  return tapeWobble(y, { wow: 0.0012, flutter: 0.0002, drift: 0.0006, seed });
}

/** monoize(buf, amount=1) - collapse toward mono (1 = mono) */
export function monoize(buf, amount = 1) {
  const src = asBuf(buf), n = src.length, L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { const m = 0.5 * (src.L[i] + src.R[i]); L[i] = src.L[i] * (1 - amount) + m * amount; R[i] = src.R[i] * (1 - amount) + m * amount; }
  return Buf.from(L, R);
}

export const PROCESSORS = { tapeWobble, vinylCrackle, reelHiss, opticalSoundtrack, lofiPhone, brickwallBright, warmTape, goldenAge, monoize };
