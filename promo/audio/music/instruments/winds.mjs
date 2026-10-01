// =============================================================================
// instruments/winds.mjs - brass (trumpets / horns / low brass), flute, clarinet + windRun helper.
// Brass: detuned saw stack -> low-pass whose cutoff TRACKS the amplitude envelope and velocity (brightness follows
// loudness) -> envelope -> soft saturation ("blat", also follows loudness) -> bell/formant EQ; lip-scoop, late vibrato.
// =============================================================================
import { dsp, SR, cues, defineInstrument, clamp, reg, ns, cents, pitchMod, velAmp, expEnv, fadeInArr, releaseTail, TAU } from './common.mjs';
import { harpGliss } from './keys.mjs';
const { midiToHz, noise, osc, svf, biquad, biquadChain, seedOf, drift, fastTanh } = dsp;

// ---------------------------------------------------------------------------------------------------------------
// brass
// ---------------------------------------------------------------------------------------------------------------
const BRASS = {
  trumpets: { voices: 3, det: 6, kLo: 3.2, kHi: 30, q: 1.0, scoop: 32, scoopTau: 0.05, vib: 5.5, vibDelay: 0.45, a: 0.035, rel: 0.13, acc: 0.4, drive: 1.3, sub: 0, eq: [{ type: 'peak', f: 1250, q: 1.1, g: 3.5 }, { type: 'peak', f: 3000, q: 1.2, g: 2.5 }, { type: 'lp', f: 9500, q: 0.6 }, { type: 'hp', f: 140, q: 0.7 }], noise: 0.05, tilt: [0.5, 9], gain: 0.34 },
  horns: { voices: 4, det: 8, kLo: 2.6, kHi: 16, q: 0.9, scoop: 22, scoopTau: 0.06, vib: 3, vibDelay: 0.5, a: 0.075, rel: 0.24, acc: 0.3, drive: 1.0, sub: 0.1, eq: [{ type: 'peak', f: 450, q: 1.0, g: 3 }, { type: 'peak', f: 1000, q: 1.0, g: 2 }, { type: 'lp', f: 6200, q: 0.6 }, { type: 'hp', f: 90, q: 0.7 }], noise: 0.04, tilt: [-1, 5], gain: 0.34 },
  brass_low: { voices: 4, det: 9, kLo: 2.3, kHi: 11, q: 1.0, scoop: 28, scoopTau: 0.07, vib: 0, vibDelay: 1, a: 0.06, rel: 0.32, acc: 0.55, drive: 1.9, sub: 0.35, eq: [{ type: 'peak', f: 280, q: 0.9, g: 3 }, { type: 'peak', f: 650, q: 1.0, g: 3 }, { type: 'lp', f: 4500, q: 0.6 }, { type: 'hp', f: 38, q: 0.7 }], noise: 0.035, tilt: [-1, 5.5], gain: 0.36 },
};

function brassVoice(ev, ctx, P) {
  const { rng, o } = ctx;
  const m = ev.midi, v = clamp(ev.vel, 0.03, 1.1), f0 = midiToHz(m);
  const art = o.art || 'sustain';
  const a = (art === 'stab' ? 0.016 : art === 'swell' ? Math.max(0.3, ev.dur * 0.7) : P.a * (1.35 - 0.6 * v)) * (o.attackScale || 1);
  const rel = (art === 'stab' ? 0.09 : P.rel) * (o.releaseScale || 1);
  const dur = art === 'stab' ? Math.min(ev.dur, 0.45) : ev.dur;
  const bodyN = ns(Math.max(dur, 0.04));
  const n = bodyN + ns(rel) + 8;
  const lead = art === 'swell' ? 0.2 * a : P.a >= 0.06 ? 0.3 * a : 0;
  const aN = Math.max(2, ns(a));
  // envelope: smooth attack, sforzando overshoot decaying to sustain, release
  const env = new Float32Array(n);
  const acc = P.acc * clamp((v - 0.45) * 2, 0, 1) * (art === 'stab' ? 0.2 : 1);
  const kS = Math.exp(-1 / (0.16 * SR));
  let ov = acc;
  const wob = drift(n, 0.6, 0.05, Math.floor(rng() * 1e9));
  for (let i = 0; i < n; i++) {
    let e;
    if (art === 'swell') { const x = Math.min(1, i / (bodyN * 0.9)); e = 0.05 + 0.95 * x * x; }
    else e = i < aN ? 0.5 - 0.5 * Math.cos((Math.PI * i) / aN) : 1;
    if (art === 'stab') e *= 0.55 + 0.45 * Math.exp(-i / (0.13 * SR));
    env[i] = e * (1 + ov) * (1 + wob[i]);
    ov *= kS;
  }
  for (let i = bodyN; i < n; i++) env[i] *= 0.5 + 0.5 * Math.cos((Math.PI * (i - bodyN)) / Math.max(1, n - bodyN));
  // oscillators with scoop (lip bends up into the note) + late vibrato
  const mono = new Float32Array(n);
  const L = new Float32Array(n), R = new Float32Array(n);
  const sc = P.scoop * (0.6 + 0.8 * rng()) * (o.scoopScale != null ? o.scoopScale : 1);
  for (let k = 0; k < P.voices; k++) {
    const pos = P.voices === 1 ? 0 : (k / (P.voices - 1)) * 2 - 1;
    const det = pos * P.det + (rng() - 0.5) * 2;
    const fa = pitchMod(n, f0, { rate: 5.0 + 0.9 * rng(), cents: P.vib * (o.vibScale != null ? o.vibScale : 1), delay: P.vibDelay * (0.8 + 0.4 * rng()), fade: 0.5, rng, detune: det, drift: 1.2, scoop: sc, scoopTau: P.scoopTau });
    const s = osc('saw', fa, n, { phase: rng() });
    const [gl, gr] = [Math.cos(((pos * 0.6 + 1) * Math.PI) / 4) * Math.SQRT2, Math.sin(((pos * 0.6 + 1) * Math.PI) / 4) * Math.SQRT2];
    const g = 1 / Math.sqrt(P.voices);
    for (let i = 0; i < n; i++) { const q = s[i] * g; L[i] += q * gl; R[i] += q * gr; }
  }
  if (P.sub > 0) {
    // octave-down sine for weight
    const fa = new Float32Array(n).fill(f0 * 0.5);
    const s = osc('sine', fa, n, { phase: rng() });
    const sg = P.sub * reg(m, [[28, 0], [38, 0.3], [50, 1]]);
    for (let i = 0; i < n; i++) { L[i] += s[i] * sg; R[i] += s[i] * sg; }
  }
  // brightness tracks (envelope x velocity)
  const fcArr = new Float32Array(n);
  const vv = Math.pow(v, 0.9);
  const bs = o.brightScale != null ? o.brightScale : 1;
  for (let i = 0; i < n; i++) {
    const e = Math.min(1.2, env[i]);
    fcArr[i] = clamp(f0 * (P.kLo + (P.kHi - P.kLo) * Math.pow(e * vv, 1.5)) * bs, 250, 13000);
  }
  const fL = svf(L, 'lp', fcArr, P.q, { update: 8 }), fR = svf(R, 'lp', fcArr, P.q, { update: 8 });
  const dr = P.drive * (o.driveScale != null ? o.driveScale : 1);
  const norm = 1 / Math.tanh(dr * 1.0);
  const nz = noise('white', n, seedOf(ctx.i, 'brn', m), { rms: 1 });
  const nzf = biquad(biquad(nz, 'bp', 1900, 0.7), 'hp', 800, 0.7);
  const bump = expEnv(n, 0.045);
  for (let i = 0; i < n; i++) {
    const e = env[i];
    const d = (0.5 + 0.9 * e * (0.4 + v)) * dr;
    const nzv = nzf[i] * P.noise * (0.2 + 1.6 * bump[i]) * Math.min(1, e * 3);
    fL[i] = fastTanh((fL[i] * e + nzv) * d * 0.5) / fastTanh(d * 0.5 * 0.7) * 0.7;
    fR[i] = fastTanh((fR[i] * e + nzv * 0.9) * d * 0.5) / fastTanh(d * 0.5 * 0.7) * 0.7;
  }
  void norm;
  const tilt = (P.tilt[0] + (P.tilt[1] - P.tilt[0]) * v) * (o.brightScale != null ? o.brightScale : 1);
  const eqL = biquadChain(biquad(fL, 'highshelf', 1400, 0.7, tilt), P.eq), eqR = biquadChain(biquad(fR, 'highshelf', 1400, 0.7, tilt), P.eq);
  const amp = P.gain * velAmp(v, 1.0);
  for (let i = 0; i < n; i++) { eqL[i] *= amp; eqR[i] *= amp; }
  fadeInArr(eqL, 10); fadeInArr(eqR, 10);
  return { L: eqL, R: eqR, lead };
}

const BR_OPTS = {
  art: "'sustain' (default) | 'stab' (short hard hits) | 'swell' (crescendo over the note)",
  brightScale: 'x filter brightness', driveScale: 'x blat/saturation', vibScale: 'x vibrato', scoopScale: 'x lip-scoop at the attack', attackScale: 'x attack', releaseScale: 'x release',
};
defineInstrument({
  id: 'trumpets', name: 'Trumpets (heroic)', family: 'brass', desc: 'Bright heroic trumpet section: brightness+blat follow velocity, lip scoop, sforzando accents, late vibrato.',
  voice: (ev, ctx) => brassVoice(ev, ctx, BRASS.trumpets), defaults: { art: 'sustain' }, options: BR_OPTS, reverb: { preset: 'hall', wet: 0.26 },
  gainDb: 0, range: [55, 88], defaultMidi: 72, defaultDur: 1, test: { motifOct: 0, chordOct: 0 },
});
defineInstrument({
  id: 'horns', name: 'French horns', family: 'brass', desc: 'Warm round horn section: soft attack, opens up with velocity into a heroic bloom.',
  voice: (ev, ctx) => brassVoice(ev, ctx, BRASS.horns), defaults: { art: 'sustain' }, options: BR_OPTS, reverb: { preset: 'bigHall', wet: 0.28 },
  gainDb: 0, range: [40, 80], defaultMidi: 60, defaultDur: 1, test: { motifOct: -1, chordOct: -1 },
});
defineInstrument({
  id: 'brass_low', name: 'Low brass (trombones / tuba)', family: 'brass', desc: 'Trailer low brass: dark, gritty, sub-weighted trombone/tuba section for pedals, ostinati and power chords.',
  voice: (ev, ctx) => brassVoice(ev, ctx, BRASS.brass_low), defaults: { art: 'sustain' }, options: BR_OPTS, reverb: { preset: 'bigHall', wet: 0.24 },
  gainDb: 0, range: [28, 62], defaultMidi: 45, defaultDur: 1, test: { motifOct: -2, chordOct: -2, voicing: 'power' },
});

// ---------------------------------------------------------------------------------------------------------------
// flute / clarinet (additive sources + breath)
// ---------------------------------------------------------------------------------------------------------------
function windVoice(ev, ctx, P) {
  const { rng, o } = ctx;
  const m = ev.midi, v = clamp(ev.vel, 0.03, 1.1), f0 = midiToHz(m);
  const fast = ev.dur < 0.22;
  const a = (fast ? 0.022 : P.a) * (1.3 - 0.5 * v) * (o.attackScale || 1);
  const rel = (fast ? 0.07 : P.rel) * (o.releaseScale || 1);
  const bodyN = ns(Math.max(ev.dur, 0.05));
  const n = bodyN + ns(rel) + 8;
  const lead = !fast && a > 0.05 ? 0.25 * a : 0;
  const aN = Math.max(2, ns(a));
  const vibOn = !fast && ev.dur > 0.5;
  const fa = pitchMod(n, f0, { rate: 5.1 + 0.6 * rng(), cents: vibOn ? P.vib * (o.vibScale != null ? o.vibScale : 1) : 0, delay: 0.28 + 0.15 * rng(), fade: 0.5, rng, drift: 2, scoop: -P.chiffCents, scoopTau: 0.04 });
  const h = P.harm(m, v);
  const out = new Float32Array(n);
  let ph = rng();
  const wob = drift(n, 0.7, 0.06, Math.floor(rng() * 1e9));
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const e = i < aN ? 0.5 - 0.5 * Math.cos((Math.PI * i) / aN) : 1;
    env[i] = e * (1 + wob[i]) * (1 + 0.28 * v * Math.exp(-i / (0.09 * SR)));
  }
  for (let i = bodyN; i < n; i++) env[i] *= 0.5 + 0.5 * Math.cos((Math.PI * (i - bodyN)) / Math.max(1, n - bodyN));
  for (let i = 0; i < n; i++) {
    ph += fa[i] / SR;
    if (ph >= 1) ph -= 1;
    const w = TAU * ph;
    let s = Math.sin(w);
    for (let k = 0; k < h.length; k++) s += h[k] * Math.sin(w * h.idx[k]);
    out[i] = s;
  }
  // breath
  const nz = noise('pink', n, seedOf(ctx.i, 'br', m), { rms: 1 });
  const nzf = biquad(biquad(nz, 'bp', P.noiseHz, 0.6), 'hp', 1400, 0.7);
  const bump = expEnv(n, 0.035);
  const amp = P.gain * velAmp(v, 1.1);
  const L = new Float32Array(n), R = new Float32Array(n);
  const pan = clamp((o.pan || 0) + ((m - 72) / 50) * 0.25, -1, 1);
  const [gl, gr] = [Math.cos(((pan + 1) * Math.PI) / 4) * Math.SQRT2, Math.sin(((pan + 1) * Math.PI) / 4) * Math.SQRT2];
  for (let i = 0; i < n; i++) {
    const e = env[i];
    const y = (out[i] * 0.5 * e + nzf[i] * P.noise * (0.35 + 0.65 * v) * (0.5 * e + 1.4 * bump[i])) * amp;
    L[i] = y * gl; R[i] = y * gr;
  }
  fadeInArr(L, 10); fadeInArr(R, 10);
  return { L, R, lead };
}
const harmList = (pairs) => { const a = pairs.map((p) => p[1]); a.idx = pairs.map((p) => p[0]); return a; };
const FLUTE = {
  a: 0.07, rel: 0.14, vib: 14, chiffCents: -22, noiseHz: 3800, noise: 0.28, gain: 0.34,
  harm: (m, v) => harmList([[2, reg(m, [[60, 0.5], [72, 0.28], [84, 0.1]]) * (0.6 + 0.6 * v)], [3, reg(m, [[60, 0.22], [72, 0.1], [84, 0.03]]) * (0.5 + 0.7 * v)], [4, reg(m, [[60, 0.08], [72, 0.03], [84, 0]])]]),
};
const CLAR = {
  a: 0.045, rel: 0.12, vib: 4, chiffCents: -10, noiseHz: 2400, noise: 0.07, gain: 0.36,
  harm: (m, v) => harmList([[2, 0.06], [3, 0.62 + 0.15 * v], [4, 0.04], [5, 0.34 + 0.2 * v], [6, 0.03], [7, 0.2 + 0.1 * v], [9, 0.09 + 0.08 * v], [11, 0.04], [13, 0.02]]),
};
const WIND_OPTS = { attackScale: 'x attack', releaseScale: 'x release', vibScale: 'x vibrato depth' };
defineInstrument({
  id: 'flute', name: 'Flute (solo / runs)', family: 'winds', desc: 'Breathy flute: pure core + register-dependent harmonics, chiff, late vibrato. Fast notes (<0.22 s) get a tight attack for runs.',
  voice: (ev, ctx) => windVoice(ev, ctx, FLUTE), defaults: {}, options: WIND_OPTS, reverb: { preset: 'hall', wet: 0.26 },
  gainDb: 0, range: [60, 96], defaultMidi: 76, defaultDur: 0.5, test: { motifOct: 1, chordOct: 1 },
});
defineInstrument({
  id: 'clarinet', name: 'Clarinet', family: 'winds', desc: 'Woody clarinet: odd-harmonic reed spectrum, soft attack, chalumeau warmth.',
  voice: (ev, ctx) => windVoice(ev, ctx, CLAR), defaults: {}, options: WIND_OPTS, reverb: { preset: 'chamber', wet: 0.22 },
  gainDb: 0, range: [50, 91], defaultMidi: 64, defaultDur: 0.6, test: { motifOct: 0, chordOct: 0 },
});

/**
 * windRun(t, fromMidi, toMidi, {rootPc=0, scale='major', step=BEAT/4 (s per note), dur=step*1.15, vel=[0.55,0.85], accel=0})
 * -> notes of a diatonic woodwind run (C major / A minor by default) for flute / clarinet / harp / celesta.
 */
export function windRun(t, fromMidi, toMidi, opts = {}) {
  const step = opts.step != null ? opts.step : cues.BEAT / 4;
  return harpGliss(t, fromMidi, toMidi, { step, dur: step * 1.15, vel: [0.55, 0.85], ...opts });
}
