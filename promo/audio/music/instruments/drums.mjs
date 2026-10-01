// =============================================================================
// instruments/drums.mjs - percussion. Notes: {t, vel, pan?, dur?, midi? (pitched drums), ...per-instrument}
//   kick, snare (+ rim / dusty), snare_gated, hat (closed/open), clap, toms, timpani, taiko, sub808, cymbal (crash / swell)
//   + helpers drumRoll(), crashSignal()
// =============================================================================
import { dsp, SR, cues, defineInstrument, clamp, reg, ns, centsExact, expEnv, fadeInArr, releaseTail, addDamped, mixIntoPan, velAmp, TAU } from './common.mjs';
const { midiToHz, noise, biquad, biquadChain, seedOf, mulberry32, fastTanh } = dsp;

const shapeNoise = (n, seed, tau, a = 0.0006) => {
  const x = noise('white', n, seed, { rms: 1 });
  const k = Math.exp(-1 / (tau * SR));
  const aN = Math.max(1, Math.round(a * SR));
  let g = 1;
  for (let i = 0; i < n; i++) { x[i] *= (i < aN ? i / aN : 1) * g; if (i >= aN) g *= k; }
  return x;
};
const peakNorm = (L, R, peak) => {
  let p = 0;
  for (let i = 0; i < L.length; i++) p = Math.max(p, Math.abs(L[i]), Math.abs(R[i]));
  if (p < 1e-9) return;
  const g = peak / p;
  for (let i = 0; i < L.length; i++) { L[i] *= g; R[i] *= g; }
};
const stereoHit = (mono, spread = 0) => ({ L: mono, R: Float32Array.from(mono) });

// ---------------------------------------------------------------------------------------------------------------
// kick
// ---------------------------------------------------------------------------------------------------------------
const KICK = {
  tight: { fm: 2.9, pt: 0.028, tau: 0.17, drive: 1.9, click: 0.45, lp: 14000 },
  soft: { fm: 1.8, pt: 0.04, tau: 0.13, drive: 1.15, click: 0.12, lp: 2600 },
  deep: { fm: 2.3, pt: 0.05, tau: 0.34, drive: 1.5, click: 0.3, lp: 7000 },
};
defineInstrument({
  id: 'kick', name: 'Kick drum', kind: 'drum', family: 'perc',
  desc: 'Sine kick with exponential pitch drop, saturation and beater click. Tuned to the key (default A1, midi 33).',
  voice(ev, ctx) {
    const P = KICK[ctx.o.variant] || KICK.tight;
    const v = clamp(ev.vel, 0.05, 1.1), f1 = midiToHz(ev.midi) * (ctx.o.tuneScale || 1);
    const n = ns(P.tau * 6 * (ctx.o.lengthScale || 1));
    const out = new Float32Array(n);
    let ph = 0;
    const kt = Math.exp(-1 / (P.pt * SR)), ke = Math.exp(-1 / (P.tau * (ctx.o.lengthScale || 1) * SR));
    let pe = 1, ee = 1;
    for (let i = 0; i < n; i++) {
      const f = f1 * (1 + (P.fm - 1) * pe * (0.7 + 0.3 * v));
      ph += f / SR;
      if (ph >= 1) ph -= 1;
      out[i] = Math.sin(TAU * ph) * ee;
      pe *= kt; ee *= ke;
    }
    const d = P.drive * (0.7 + 0.5 * v);
    for (let i = 0; i < n; i++) out[i] = Math.tanh(out[i] * d) / Math.tanh(d);
    const cn = ns(0.006);
    const c = biquad(shapeNoise(cn, seedOf(ctx.i, 'kc'), 0.0012), 'hp', 1200, 0.7);
    for (let i = 0; i < cn; i++) out[i] += c[i] * P.click * v * 0.5;
    const y = P.lp < 14000 ? biquad(out, 'lp', P.lp, 0.7) : out;
    const amp = 0.92 * velAmp(v, 0.8);
    for (let i = 0; i < n; i++) y[i] *= amp;
    fadeInArr(y, 6);
    releaseTail(y, n - ns(0.05), 0.05);
    return y;
  },
  defaults: { variant: 'tight' }, options: { variant: "'tight' (default) | 'soft' (lo-fi thump) | 'deep' (cinematic)", lengthScale: 'x body length', tuneScale: 'x pitch' },
  reverb: { preset: 'room', wet: 0.08 }, gainDb: 0, defaultMidi: 33, defaultDur: 0.3,
});

// ---------------------------------------------------------------------------------------------------------------
// snare
// ---------------------------------------------------------------------------------------------------------------
function snareCore(ev, ctx, variant, len = null) {
  const v = clamp(ev.vel, 0.04, 1.1), rng = ctx.rng;
  const n = ns(len != null ? len : variant === 'rim' ? 0.18 : 0.5);
  const L = new Float32Array(n), R = new Float32Array(n);
  const f = midiToHz(ev.midi != null ? ev.midi : 54) * (0.97 + 0.06 * rng()); // ~190 Hz
  // shell tone
  if (variant !== 'rim') {
    const dec = variant === 'dusty' ? 0.07 : 0.055;
    const t1 = new Float32Array(n);
    let ph1 = 0, ph2 = 0;
    for (let i = 0; i < Math.min(n, ns(0.3)); i++) {
      const t = i / SR, dp = 1 + 0.2 * Math.exp(-t / 0.012);
      ph1 += (f * dp) / SR; ph2 += (f * 1.78 * dp) / SR;
      t1[i] = Math.sin(TAU * ph1) * Math.exp(-t / dec) + 0.45 * Math.sin(TAU * ph2) * Math.exp(-t / (dec * 0.7));
    }
    for (let i = 0; i < n; i++) { L[i] += t1[i] * 0.42; R[i] += t1[i] * 0.42; }
  } else {
    // side-stick: woody knock = two short damped resonances
    addDamped(L, R, 480 * (0.97 + 0.06 * rng()), 0.7, 0.012, 0, 0);
    addDamped(L, R, 1180 * (0.97 + 0.06 * rng()), 0.45, 0.008, 1, 0);
    addDamped(L, R, 2300, 0.2, 0.004, 2, 0);
  }
  // wires + stick noise
  const tauN = variant === 'rim' ? 0.012 : variant === 'dusty' ? 0.11 : 0.085;
  const nl = shapeNoise(n, seedOf(ctx.i, 'sn', 1), tauN), nr = shapeNoise(n, seedOf(ctx.i, 'sn', 2), tauN);
  const tail = shapeNoise(n, seedOf(ctx.i, 'sn', 3), tauN * 2.1, 0.004), tailR = shapeNoise(n, seedOf(ctx.i, 'sn', 4), tauN * 2.1, 0.004);
  const hi = variant === 'dusty' ? 5200 : 10500, lo = variant === 'rim' ? 1600 : 1100;
  const wl = biquad(biquad(nl, 'hp', lo, 0.7), 'lp', hi * (0.7 + 0.5 * v), 0.7), wr = biquad(biquad(nr, 'hp', lo, 0.7), 'lp', hi * (0.7 + 0.5 * v), 0.7);
  const tl = biquad(biquad(tail, 'hp', 1800, 0.7), 'lp', 7500, 0.7), tr = biquad(biquad(tailR, 'hp', 1800, 0.7), 'lp', 7500, 0.7);
  const wg = (variant === 'rim' ? 0.35 : 0.62) * (0.5 + 0.6 * v);
  for (let i = 0; i < n; i++) {
    L[i] += wl[i] * wg + tl[i] * 0.2;
    R[i] += wr[i] * wg + tr[i] * 0.2;
  }
  // crack
  const cn = ns(0.003);
  const cl = biquad(shapeNoise(cn, seedOf(ctx.i, 'sc'), 0.0008, 0.0002), 'hp', 2500, 0.7);
  for (let i = 0; i < cn; i++) { L[i] += cl[i] * 0.35 * v; R[i] += cl[i] * 0.35 * v; }
  return { L, R, v, n };
}
function finishHit(L, R, v, peak, k = 1.0, tailMs = 40) {
  const a = dsp.dcBlock(L, 20), b = dsp.dcBlock(R, 20);
  L.set(a); R.set(b);
  peakNorm(L, R, peak * velAmp(v, k));
  fadeInArr(L, 6); fadeInArr(R, 6);
  releaseTail(L, L.length - ns(tailMs / 1000), tailMs / 1000); releaseTail(R, R.length - ns(tailMs / 1000), tailMs / 1000);
}
defineInstrument({
  id: 'snare', name: 'Snare drum', kind: 'drum', family: 'perc',
  desc: 'Tuned shell tone + wire noise + stick crack; velocity opens the brightness. Variants for backbeat, side-stick rim and dusty lo-fi.',
  voice(ev, ctx) {
    const { L, R, v } = snareCore(ev, ctx, ctx.o.variant);
    finishHit(L, R, v, 0.85, 0.9);
    return { L, R };
  },
  defaults: { variant: 'crack' }, options: { variant: "'crack' (default) | 'rim' (side-stick) | 'dusty' (dark, lo-fi)" },
  reverb: { preset: 'room', wet: 0.12 }, gainDb: 0, defaultMidi: 54, defaultDur: 0.2, test: { chord: false },
});
defineInstrument({
  id: 'snare_gated', name: 'Gated-reverb snare', kind: 'drum', family: 'perc',
  desc: '80s-style snare with a built-in gated reverb (wide noise burst held ~120 ms then slammed shut). Big and wide; keep it dry in the composer reverb.',
  voice(ev, ctx) {
    const base = snareCore(ev, ctx, 'crack', 0.55);
    const v = base.v;
    const n = base.n;
    const L = base.L, R = base.R;
    // gated tail
    const hold = (ctx.o.gate != null ? ctx.o.gate : 0.135), close = 0.03;
    const gl = noise('white', n, seedOf(ctx.i, 'gt', 1), { rms: 1 }), gr = noise('white', n, seedOf(ctx.i, 'gt', 2), { rms: 1 });
    const fl = biquad(biquad(gl, 'bp', 2400, 0.55), 'hp', 500, 0.7), fr = biquad(biquad(gr, 'bp', 2400, 0.55), 'hp', 500, 0.7);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const pre = Math.min(1, t / 0.004);
      const dec = Math.exp(-t / 0.22);
      const gate = t < hold ? 1 : Math.max(0, 1 - (t - hold) / close);
      const g = pre * (0.28 + 0.72 * dec) * (gate * gate) * 0.55 * Math.pow(v, 0.8);
      L[i] += fl[i] * g; R[i] += fr[i] * g;
    }
    finishHit(L, R, v, 0.88, 0.9, 15);
    return { L, R };
  },
  defaults: {}, options: { gate: 'gate hold time in s (default 0.135)' },
  reverb: { preset: 'room', wet: 0.04 }, gainDb: 0, defaultMidi: 53, defaultDur: 0.3, test: { chord: false },
});

// ---------------------------------------------------------------------------------------------------------------
// hat / clap / toms
// ---------------------------------------------------------------------------------------------------------------
const HAT_RATIOS = [205.3, 304.4, 369.6, 522.7, 540.0, 800.0];
defineInstrument({
  id: 'hat', name: 'Hi-hat (closed / open)', kind: 'drum', family: 'perc',
  desc: 'Metallic 6-oscillator cluster + high noise. open:true (per note) lets it ring for dur (default 0.3 s) then chokes.',
  voice(ev, ctx) {
    const open = ev.open != null ? ev.open : ctx.o.open;
    const v = clamp(ev.vel, 0.04, 1.1), rng = ctx.rng;
    const ring = open ? clamp(ev.dur != null ? ev.dur : 0.3, 0.08, 1.2) : 0;
    const tau = open ? 0.09 + ring * 0.25 : 0.026 * (0.8 + 0.4 * v);
    const len = open ? ring + 0.06 : 0.16;
    const n = ns(len);
    const L = new Float32Array(n), R = new Float32Array(n);
    const sc = ctx.o.pitch || 1;
    const metal = new Float32Array(n);
    HAT_RATIOS.forEach((r, k) => {
      const f = r * 2.2 * sc * (1 + (rng() - 0.5) * 0.01);
      let ph = rng();
      const dp = f / SR;
      for (let i = 0; i < n; i++) { ph += dp; if (ph >= 1) ph -= 1; metal[i] += ph < 0.5 ? 1 : -1; }
    });
    const mf = biquad(biquad(metal, 'hp', 6500, 0.7), 'bp', 9800, 0.5);
    const nl = noise('white', n, seedOf(ctx.i, 'h', 1), { rms: 1 }), nr = noise('white', n, seedOf(ctx.i, 'h', 2), { rms: 1 });
    const hl = biquad(nl, 'hp', 7500, 0.7), hr = biquad(nr, 'hp', 7500, 0.7);
    const k = Math.exp(-1 / (tau * SR));
    let g = 1;
    const brt = 0.55 + 0.45 * v;
    for (let i = 0; i < n; i++) {
      const a = Math.min(1, i / (0.0007 * SR)) * g;
      L[i] = (mf[i] * 0.045 + hl[i] * 0.5 * brt) * a;
      R[i] = (mf[i] * 0.045 + hr[i] * 0.5 * brt) * a;
      g *= k;
    }
    finishHit(L, R, v, 0.5, 0.9, open ? 25 : 12);
    return { L, R };
  },
  defaults: { open: false }, options: { open: 'bool (or per note `open:true`), ring = note dur', pitch: 'x metallic pitch' },
  reverb: { preset: 'room', wet: 0.06 }, gainDb: 0, defaultMidi: 60, defaultDur: 0.3, test: { chord: false },
});

defineInstrument({
  id: 'clap', name: 'Hand clap', kind: 'drum', family: 'perc',
  desc: 'Layered noise bursts (3 staggered hands + room tail), band-passed around 1.2 kHz. Stereo-spread.',
  voice(ev, ctx) {
    const v = clamp(ev.vel, 0.04, 1.1), rng = ctx.rng;
    const n = ns(0.32);
    const L = new Float32Array(n), R = new Float32Array(n);
    const offs = [0, 0.0085 + 0.003 * rng(), 0.017 + 0.004 * rng(), 0.027 + 0.004 * rng()];
    for (let c = 0; c < 2; c++) {
      const out = c ? R : L;
      offs.forEach((o, k) => {
        const s = ns(0.05);
        const b = shapeNoise(s, seedOf(ctx.i, 'cl', c, k), k === 3 ? 0.045 : 0.005, 0.0004);
        const j = Math.round((o + (c ? 0.0009 : 0)) * SR);
        const g = k === 3 ? 0.6 : 1 - k * 0.12;
        for (let i = 0; i < s && i + j < n; i++) out[i + j] += b[i] * g;
      });
      const tail = shapeNoise(n, seedOf(ctx.i, 'clt', c), 0.07, 0.025);
      for (let i = 0; i < n; i++) out[i] += tail[i] * 0.22;
    }
    const fl = biquadChain(L, [{ type: 'bp', f: 1250, q: 0.8 }, { type: 'hp', f: 450, q: 0.7 }, { type: 'peak', f: 2800, q: 1, g: 2 }]);
    const fr = biquadChain(R, [{ type: 'bp', f: 1250, q: 0.8 }, { type: 'hp', f: 450, q: 0.7 }, { type: 'peak', f: 2800, q: 1, g: 2 }]);
    finishHit(fl, fr, v, 0.8, 0.9, 50);
    return { L: fl, R: fr };
  },
  defaults: {}, options: {}, reverb: { preset: 'plate', wet: 0.14 }, gainDb: 0, defaultMidi: 60, defaultDur: 0.2, test: { chord: false },
});

defineInstrument({
  id: 'toms', name: 'Toms', kind: 'drum', family: 'perc', desc: 'Pitched toms (midi = tuning; default 45 = A2): sine + overtone with pitch drop, stick attack. Pan toms across the field for fills.',
  voice(ev, ctx) {
    const v = clamp(ev.vel, 0.04, 1.1);
    const f = midiToHz(ev.midi);
    const tau = reg(ev.midi, [[36, 0.34], [60, 0.2], [72, 0.13]]) * (ctx.o.lengthScale || 1);
    const n = ns(tau * 7);
    const out = new Float32Array(n);
    let p1 = 0, p2 = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR, dp = 1 + 0.55 * Math.exp(-t / 0.025);
      p1 += (f * dp) / SR; p2 += (f * 1.58 * dp) / SR;
      out[i] = (Math.sin(TAU * p1) + 0.3 * Math.sin(TAU * p2) * Math.exp(-t / (tau * 0.4))) * Math.exp(-t / tau);
    }
    const sn = ns(0.01);
    const st = biquad(shapeNoise(sn, seedOf(ctx.i, 'tm'), 0.0025), 'bp', 2400, 0.8);
    for (let i = 0; i < sn; i++) out[i] += st[i] * 0.35 * v;
    const y = dsp.dcBlock(out, 20);
    peakNorm(y, y, 0.88 * velAmp(v, 0.9));
    fadeInArr(y, 6);
    releaseTail(y, n - ns(0.05), 0.05);
    return y;
  },
  defaults: {}, options: { lengthScale: 'x ring' }, reverb: { preset: 'hall', wet: 0.2 }, gainDb: 0, defaultMidi: 45, defaultDur: 0.3, test: { chord: false },
});

// ---------------------------------------------------------------------------------------------------------------
// timpani / taiko
// ---------------------------------------------------------------------------------------------------------------
function modalDrum(ev, ctx, P) {
  const v = clamp(ev.vel, 0.04, 1.1), rng = ctx.rng;
  const f = midiToHz(ev.midi) * (1 + (rng() - 0.5) * 0.002);
  const tau = reg(ev.midi, [[28, P.tauLow], [48, P.tauMid], [72, P.tauHigh]]) * (ctx.o.sustain || 1);
  const dampT = ctx.o.damp ? Math.max(0.05, ev.dur) : null;
  const n = ns((dampT || tau * 5.5) + 0.12);
  const L = new Float32Array(n), R = new Float32Array(n);
  const modes = P.modes;
  const rise = P.rise * (0.5 + 0.7 * v);
  const pan = ctx.o.width != null ? ctx.o.width : 0.25;
  modes.forEach(([r, a, tk], k) => {
    const out = new Float32Array(n);
    let ph = rng();
    const kr = Math.exp(-1 / (P.riseTau * SR)), ke = Math.exp(-1 / (tau * tk * SR));
    let pe = 1, ee = 1;
    for (let i = 0; i < n; i++) {
      const fr = f * r * (1 + rise * pe);
      ph += fr / SR; if (ph >= 1) ph -= 1;
      out[i] = Math.sin(TAU * ph) * ee * a;
      pe *= kr; ee *= ke;
    }
    const pn = (k % 2 ? 1 : -1) * pan * 0.4 * (k > 0 ? 1 : 0.3);
    const [gl, gr] = dsp.panGains(pn, true);
    for (let i = 0; i < n; i++) { L[i] += out[i] * gl; R[i] += out[i] * gr; }
  });
  if (P.drive > 0) {
    for (let i = 0; i < n; i++) { L[i] = Math.tanh(L[i] * P.drive * (0.6 + 0.6 * v)) / Math.tanh(P.drive); R[i] = Math.tanh(R[i] * P.drive * (0.6 + 0.6 * v)) / Math.tanh(P.drive); }
  }
  // mallet / stick on the skin + low thump
  const sn = ns(0.03);
  const sk = biquad(shapeNoise(sn, seedOf(ctx.i, 'tp', 1), P.skinTau), 'bp', P.skinHz * (0.8 + 0.5 * v), 0.7);
  const th = biquad(shapeNoise(ns(0.09), seedOf(ctx.i, 'tp', 2), 0.02), 'lp', f * 1.3, 0.7);
  for (let i = 0; i < sn; i++) { L[i] += sk[i] * P.skin * v; R[i] += sk[i] * P.skin * v * 0.95; }
  for (let i = 0; i < th.length; i++) { L[i] += th[i] * P.thump * v; R[i] += th[i] * P.thump * v; }
  if (ev.rim) {
    const rn = ns(0.12);
    addDamped(L, R, 1250, 0.35 * v, 0.02, 0, 0); addDamped(L, R, 2900, 0.22 * v, 0.012, 1, 0);
    void rn;
  }
  peakNorm(L, R, P.peak * velAmp(v, 0.95));
  fadeInArr(L, 5); fadeInArr(R, 5);
  const e0 = dampT ? ns(dampT) : n - ns(0.12);
  releaseTail(L, e0, 0.12); releaseTail(R, e0, 0.12);
  return { L, R };
}
const TIMP = { modes: [[1.0, 1.0, 1.0], [1.5, 0.62, 0.78], [1.99, 0.36, 0.55], [2.44, 0.2, 0.4], [2.9, 0.1, 0.3]], tauLow: 1.6, tauMid: 1.15, tauHigh: 0.7, rise: 0.05, riseTau: 0.07, drive: 0, skin: 0.5, skinHz: 1500, skinTau: 0.006, thump: 0.35, peak: 0.8 };
const TAIKO = { modes: [[1.0, 1.0, 1.0], [1.59, 0.5, 0.65], [2.14, 0.32, 0.45], [2.65, 0.2, 0.35]], tauLow: 0.5, tauMid: 0.42, tauHigh: 0.3, rise: 0.38, riseTau: 0.05, drive: 1.7, skin: 0.9, skinHz: 1100, skinTau: 0.008, thump: 0.55, peak: 0.9 };
defineInstrument({
  id: 'timpani', subHz: 14, name: 'Timpani', kind: 'drum', family: 'perc',
  desc: 'Pitched kettle drums (midi = tuning): membrane modes 1 : 1.5 : 2 : 2.44, skin pitch rise on the strike, mallet + thump. Use drumRoll() for rolls.',
  voice: (ev, ctx) => modalDrum(ev, ctx, TIMP),
  defaults: {}, options: { damp: 'true = hand-damp at note end (dur)', sustain: 'x ring', rim: '(per note) rim-shot accent' },
  reverb: { preset: 'hall', wet: 0.24 }, gainDb: 0, defaultMidi: 45, defaultDur: 0.5, range: [38, 57], test: { motifOct: -1, chordOct: -1, voicing: 'bass' },
});
defineInstrument({
  id: 'taiko', subHz: 14, name: 'Taiko', kind: 'drum', family: 'perc',
  desc: 'Big Japanese-style drum: low body with a big skin pitch drop, driven by saturation, loud bachi strike. Default D2 (midi 38); `rim:true` adds a kara rim crack.',
  voice: (ev, ctx) => modalDrum(ev, ctx, TAIKO),
  defaults: {}, options: { sustain: 'x ring', rim: '(per note) rim crack', width: 'internal stereo spread' },
  reverb: { preset: 'bigHall', wet: 0.3 }, gainDb: 0, defaultMidi: 38, defaultDur: 0.4, range: [33, 55], test: { motifOct: -1, chordOct: -1, voicing: 'bass' },
});

// ---------------------------------------------------------------------------------------------------------------
// 808 / sub
// ---------------------------------------------------------------------------------------------------------------
defineInstrument({
  id: 'sub808', subHz: 14, name: '808 / sub bass', kind: 'pitched', family: 'perc',
  desc: 'Long sine sub with a short pitch punch and harmonic saturation so it reads on small speakers. Held for dur; glideTo (midi) slides over the last 40 % of the note.',
  voice(ev, ctx) {
    const { o } = ctx;
    const v = clamp(ev.vel, 0.04, 1.1);
    const f0 = midiToHz(ev.midi);
    const f1 = ev.glideTo != null ? midiToHz(ev.glideTo) : f0;
    const rel = 0.09;
    const body = Math.max(0.1, ev.dur);
    const n = ns(body + rel);
    const out = new Float32Array(n);
    let ph = 0;
    const tauA = (o.decay || 1.3);
    const kp = Math.exp(-1 / (0.03 * SR));
    let pe = 1;
    const bN = ns(body);
    for (let i = 0; i < n; i++) {
      const x = i / bN;
      const gl = ev.glideTo != null ? clamp((x - 0.6) / 0.4, 0, 1) : 0;
      const f = (f0 + (f1 - f0) * gl * gl * (3 - 2 * gl)) * (1 + 0.55 * pe);
      ph += f / SR; if (ph >= 1) ph -= 1;
      out[i] = Math.sin(TAU * ph) * Math.exp(-i / (tauA * SR));
      pe *= kp;
    }
    const d = (o.drive != null ? o.drive : 2.2) * (0.6 + 0.6 * v);
    for (let i = 0; i < n; i++) out[i] = Math.tanh(out[i] * d) / Math.tanh(d) * 0.9;
    for (let i = 0; i < n; i++) { const a = i < 40 ? i / 40 : 1; out[i] *= a; }
    releaseTail(out, bN, rel);
    const amp = 0.82 * velAmp(v, 0.8);
    for (let i = 0; i < n; i++) out[i] *= amp;
    return out;
  },
  defaults: {}, options: { decay: 'amplitude decay time constant s (default 1.3)', drive: 'saturation (default 2.2)', glideTo: '(per note) midi to slide to' },
  reverb: { preset: 'room', wet: 0.03 }, gainDb: 0, defaultMidi: 33, defaultDur: 0.5, range: [24, 48], test: { motifOct: -2, chordOct: -2, voicing: 'root' },
});

// ---------------------------------------------------------------------------------------------------------------
// cymbal: crash + swell
// ---------------------------------------------------------------------------------------------------------------
/** stationary-or-decaying cymbal spectrum; returns {L,R}. ring = decay time constant scale in seconds */
export function crashSignal(n, seed, { ring = 2.5, bright = 1, stationary = false } = {}) {
  const rng = mulberry32(seed);
  const L = new Float32Array(n), R = new Float32Array(n);
  const nl = noise('white', n, seed + 1, { rms: 1 }), nr = noise('white', n, seed + 2, { rms: 1 });
  const hiL = biquad(biquad(nl, 'hp', 4800, 0.7), 'hp', 3000, 0.7), hiR = biquad(biquad(nr, 'hp', 4800, 0.7), 'hp', 3000, 0.7);
  const loL = biquad(biquad(nl, 'bp', 1900, 0.5), 'lp', 5200, 0.7), loR = biquad(biquad(nr, 'bp', 1900, 0.5), 'lp', 5200, 0.7);
  const kh = stationary ? 1 : Math.exp(-1 / (ring * 0.28 * SR)), kl = stationary ? 1 : Math.exp(-1 / (ring * 0.6 * SR));
  let gh = 1, gl = 1;
  for (let i = 0; i < n; i++) {
    const a = Math.min(1, i / (0.0015 * SR));
    L[i] = (hiL[i] * 0.5 * bright * gh + loL[i] * 0.42 * gl) * a;
    R[i] = (hiR[i] * 0.5 * bright * gh + loR[i] * 0.42 * gl) * a;
    gh *= kh; gl *= kl;
  }
  for (let k = 0; k < 14; k++) {
    const f = 2200 + 6800 * rng() * rng() + 600 * k;
    const tau = (stationary ? 40 : ring * (0.15 + 0.5 * rng()));
    const pan = rng() * 2 - 1;
    addDamped(L, R, f, 0.035 * (0.5 + rng()), tau, rng() * 6, pan);
    addDamped(L, R, f * (1.0035 + 0.003 * rng()), 0.03 * (0.5 + rng()), tau, rng() * 6, -pan);
  }
  return { L, R };
}
defineInstrument({
  id: 'cymbal', name: 'Cymbal crash / swell', kind: 'drum', family: 'perc',
  desc: 'Crash: noise bands + inharmonic partials, two-stage decay. swell:true (per note or option) = stick-roll crescendo that PEAKS at t+dur (reverse-style build), then a short decay.',
  voice(ev, ctx) {
    const swell = ev.swell != null ? ev.swell : ctx.o.swell;
    const v = clamp(ev.vel, 0.04, 1.1);
    if (swell) {
      const dur = Math.max(0.4, ev.dur);
      const decay = ctx.o.swellTail != null ? ctx.o.swellTail : 0.8;
      const n = ns(dur + decay);
      const { L, R } = crashSignal(n, seedOf(ctx.i, 'cymsw'), { stationary: true, bright: 0.85 });
      const pk = ns(dur);
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        const g = i < pk ? Math.pow(t / dur, 2.3) : Math.exp(-(t - dur) / (decay * 0.35));
        L[i] *= g; R[i] *= g;
      }
      finishHit(L, R, v, 0.7, 0.9, 30);
      return { L, R };
    }
    const ring = ev.dur != null && ev.dur > 0.2 ? ev.dur : 3.2;
    const n = ns(ring * 1.4 + 0.1);
    const { L, R } = crashSignal(n, seedOf(ctx.i, 'cym'), { ring, bright: 0.9 + 0.3 * v });
    finishHit(L, R, v, 0.72, 0.9, (ring * 0.12 + 0.1) * 1000);
    return { L, R };
  },
  defaults: { swell: false }, options: { swell: 'bool (or per note): crescendo peaking at t+dur', swellTail: 'decay after the peak (s, default 0.8)' },
  reverb: { preset: 'hall', wet: 0.2 }, gainDb: 0, defaultMidi: 60, defaultDur: 3, test: { chord: false },
});

/**
 * drumRoll(t0, t1, {midi, rate=14 (hits/s), vel=[0.3,0.9] (ramp) | number, curve=1.6, humanize=0.18, seed=1, pan?}) -> notes for timpani / snare / taiko rolls.
 * Alternating-sticking feel: velocities jitter, hit times jitter by `humanize` x the hit spacing. The last hit lands exactly on t1.
 */
export function drumRoll(t0, t1, opts = {}) {
  const { midi, rate = 14, vel = [0.3, 0.9], curve = 1.6, humanize = 0.18, seed = 1, pan, dur = 0.2 } = opts;
  const rng = mulberry32(seedOf('roll', seed, Math.round(t0 * 1000)));
  const n = Math.max(2, Math.round((t1 - t0) * rate));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const x = i / n;
    const base = t0 + (t1 - t0) * x;
    const jit = i === 0 || i === n ? 0 : (rng() - 0.5) * 2 * humanize * ((t1 - t0) / n);
    const vv = Array.isArray(vel) ? vel[0] + (vel[1] - vel[0]) * Math.pow(x, curve) : vel;
    const note = { t: base + jit, dur, vel: clamp(vv * (0.85 + 0.3 * rng()) * (i % 2 ? 0.92 : 1), 0.05, 1) };
    if (midi != null) note.midi = midi;
    if (pan != null) note.pan = pan;
    out.push(note);
  }
  return out;
}
