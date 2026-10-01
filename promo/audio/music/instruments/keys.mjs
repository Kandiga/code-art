// =============================================================================
// instruments/keys.mjs - struck / plucked tuned instruments (modal / additive synthesis):
//   piano (silent-film upright, + 'honky' / 'felt'), piano_grand (clean concert grand), musicbox, celesta, harp (+ harpGliss)
// Everything is a bank of exponentially-decaying partials (rotation oscillators: ~3 ns per partial-sample).
// =============================================================================
import { dsp, SR, defineInstrument, clamp, reg, addDamped, centsExact, ns, expEnv, releaseTail, fadeInArr, mixInto, mixIntoPan, normPeak, velAmp, TAU } from './common.mjs';
import { SCALES } from '../../lib/theory.mjs';
const { midiToHz, mulberry32, seedOf, noise, biquad, biquadChain } = dsp;

// per-KEY tuning errors: fixed for the whole film (an out-of-tune upright is out of tune the same way every time)
function keyTuning(midi, cents) {
  const r = mulberry32(seedOf('key-tuning', midi));
  return r.gauss() * cents;
}

// ---------------------------------------------------------------------------------------------------------------
// piano
// ---------------------------------------------------------------------------------------------------------------
const PIANO = {
  upright: { B0: 1.6e-4, strike: 0.135, bright: 1900, slope: 0.95, decaySlope: 0.55, T60: 11, tuneCents: 6.5, unison: 1.6, maxPartials: 26, spread: 0.18, pitchPan: 0.18, hammer: 0.9, thump: 1.0, rel: 0.16, lp: 7200, honk: 1.5 },
  honky: { B0: 2.2e-4, strike: 0.14, bright: 2300, slope: 0.9, decaySlope: 0.6, T60: 8, tuneCents: 9, unison: 8.5, maxPartials: 24, spread: 0.2, pitchPan: 0.18, hammer: 1.1, thump: 1.0, rel: 0.12, lp: 8000, honk: 4 },
  felt: { B0: 1.2e-4, strike: 0.13, bright: 1100, slope: 1.1, decaySlope: 0.7, T60: 12, tuneCents: 3, unison: 0.9, maxPartials: 20, spread: 0.2, pitchPan: 0.15, hammer: 0.35, thump: 0.7, rel: 0.2, lp: 5200, honk: 0 },
  grand: { B0: 0.7e-4, strike: 0.125, bright: 3400, slope: 0.85, decaySlope: 0.42, T60: 15, tuneCents: 0.8, unison: 0.45, maxPartials: 34, spread: 0.3, pitchPan: 0.32, hammer: 0.6, thump: 0.25, rel: 0.28, lp: 15000, honk: 0 },
};

function pianoVoice(ev, ctx, P) {
  const { rng, o } = ctx;
  const m = ev.midi, v = clamp(ev.vel, 0.02, 1.1);
  const tune = keyTuning(m, P.tuneCents * (o.tuneScale != null ? o.tuneScale : 1)) + (m > 72 ? (m - 72) * 0.12 : 0) - (m < 40 ? (40 - m) * 0.12 : 0);
  const f0 = midiToHz(m) * centsExact(tune);
  const B = P.B0 * Math.exp(0.083 * (m - 40)) * (o.inharm != null ? o.inharm : 1);
  const pedal = typeof o.pedal === 'function' ? !!o.pedal(ev.t) : !!o.pedal;
  const rel = pedal ? (o.pedalRelease != null ? o.pedalRelease : 2.2) : P.rel * reg(m, [[28, 2.2], [48, 1.3], [72, 0.8], [100, 0.5]]) * (o.releaseScale || 1);
  const durN = ns(Math.max(0.03, ev.dur) + rel + 0.02);
  const nTot = durN;
  const L = new Float32Array(nTot), R = new Float32Array(nTot);
  const T60 = P.T60 * Math.pow(2, -(m - 36) / 19) * (o.sustainScale || 1);
  const tau1 = T60 / 6.9;
  const fc = P.bright * (0.55 + 0.95 * v * v) * (o.brightScale || 1);
  const u = reg(m, [[21, 0.25], [36, 0.5], [48, 0.85], [60, 1], [108, 1]]); // weak fundamentals in the bass
  const centerPan = clamp((m - 60) / 40, -1, 1) * P.pitchPan;
  const det = P.unison * (0.7 + 0.6 * rng());
  const nMax = P.maxPartials;
  for (let n = 1; n <= nMax; n++) {
    const fn = n * f0 * Math.sqrt(1 + B * n * n);
    if (fn > 14000) break;
    const comb = 0.3 + 0.7 * Math.abs(Math.sin(Math.PI * n * P.strike));
    const ham = 1 / Math.pow(1 + (fn / fc) * (fn / fc), 1.1);
    let a = (comb * ham) / Math.pow(n, P.slope);
    if (n === 1) a *= u;
    if (n === 2) a *= 0.5 + 0.5 * u;
    const tau = tau1 / (1 + P.decaySlope * Math.pow(n - 1, 1.15) * (0.45 + 0.55 * (1.2 - v)));
    const pn = clamp(centerPan + P.spread * Math.sin(2.4 * n + m * 0.7), -1, 1);
    const ph = (rng() - 0.5) * 1.4;
    const dA = centsExact(det * 0.5 * (0.6 + 0.8 * rng())), dB = centsExact(-det * 0.5 * (0.6 + 0.8 * rng()));
    addDamped(L, R, fn * dA, a * 0.56, tau, ph, pn);
    addDamped(L, R, fn * dB, a * 0.56, tau * 0.93, ph + 0.7, clamp(pn * 0.8 - 0.05, -1, 1));
    if (n <= 7) addDamped(L, R, fn * (dA + dB) * 0.5, a * 0.3, tau * 3.4, ph + 1.3, pn * 0.9); // aftersound
  }
  // normalise the partial bank, then add hammer noise
  let pk = 0;
  const lim = Math.min(nTot, ns(0.25));
  for (let i = 0; i < lim; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  const amp = (0.55 * velAmp(v, 1.25)) / Math.max(pk, 1e-6);
  for (let i = 0; i < nTot; i++) { L[i] *= amp; R[i] *= amp; }
  // hammer: a short band-passed noise burst whose colour follows velocity, + cabinet thump
  {
    const hn = ns(0.014);
    const x = noise('white', hn, seedOf(ctx.i, 'ham', m), { rms: 1 });
    const e = expEnv(hn, 0.0028);
    for (let i = 0; i < hn; i++) x[i] *= e[i];
    const y = biquad(biquad(x, 'bp', clamp(1400 + 2600 * v + f0 * 1.5, 800, 6000), 0.8), 'hp', 500, 0.7);
    const ha = 0.17 * P.hammer * Math.pow(v, 1.7) * amp * 0.55;
    mixIntoPan(L, R, y, 0, ha, centerPan);
    if (P.thump > 0) {
      const tn = ns(0.06);
      const z = noise('white', tn, seedOf(ctx.i, 'thump', m), { rms: 1 });
      const ez = expEnv(tn, 0.012);
      for (let i = 0; i < tn; i++) z[i] *= ez[i];
      const zz = biquad(z, 'lp', 220, 0.8);
      mixIntoPan(L, R, zz, 0, 0.55 * P.thump * v * amp * 0.5, centerPan * 0.5);
    }
  }
  fadeInArr(L, 18); fadeInArr(R, 18);
  // key release: the damper falls at dur (not with the pedal: the strings ring on, we only fade the buffer end)
  const from = ns(ev.dur);
  releaseTail(L, from, rel * (pedal ? 0.9 : 1)); releaseTail(R, from, rel * (pedal ? 0.9 : 1));
  return { L, R };
}

function uprightBus(P, extra = {}) {
  return (seg) => {
    // cabinet: warm lows, midrange honk, lid-closed highs
    const st = [
      { type: 'lowshelf', f: 200, g: 2.2 },
      { type: 'peak', f: 1500, q: 1.1, g: P.honk },
      { type: 'peak', f: 420, q: 1.0, g: -1.5 },
      { type: 'lp', f: P.lp, q: 0.6 },
      ...(extra.stages || []),
    ];
    return biquadChain(seg, st);
  };
}

defineInstrument({
  id: 'piano', name: 'Upright piano (silent-film)', family: 'keys',
  desc: 'Bar-room / silent-cinema upright: inharmonic partial bank, per-key out-of-tune, detuned unison, felt+hammer noise, cabinet EQ. Dry & close.',
  voice: (ev, ctx) => pianoVoice(ev, ctx, PIANO[ctx.o.variant] || PIANO.upright),
  bus: (seg, ctx) => uprightBus(PIANO[ctx.o.variant] || PIANO.upright)(seg),
  defaults: { variant: 'upright' },
  options: {
    variant: "'upright' (default) | 'honky' (ragtime, 8 cent unison detune) | 'felt' (muffled, intimate)",
    pedal: 'bool | fn(t)->bool: sustain pedal (strings ring ~2.2 s past the key release)',
    tuneScale: 'x per-key out-of-tune amount (default 1; 0 = in tune; 2 = very sour)',
    brightScale: 'x hammer brightness', sustainScale: 'x string decay time', inharm: 'x inharmonicity', releaseScale: 'x damper release',
  },
  reverb: { preset: 'room', wet: 0.16 },
  gainDb: 0, range: [28, 100], defaultMidi: 60,
});

defineInstrument({
  id: 'piano_grand', name: 'Concert grand (clean)', family: 'keys',
  desc: 'Clean, wide concert grand for the solo-piano turn: low inharmonicity, bright singing treble, pitch-spread stereo, pedal option.',
  voice: (ev, ctx) => pianoVoice(ev, ctx, PIANO.grand),
  bus: null,
  defaults: {},
  options: { pedal: 'bool | fn(t)->bool (default false); true = long ringing sustain', brightScale: 'x hammer brightness', sustainScale: 'x string decay', releaseScale: 'x damper release' },
  reverb: { preset: 'hall', wet: 0.3 },
  gainDb: 0, range: [24, 104], defaultMidi: 60,
});

// ---------------------------------------------------------------------------------------------------------------
// music box / celesta
// ---------------------------------------------------------------------------------------------------------------
defineInstrument({
  id: 'musicbox', name: 'Music box', family: 'keys',
  desc: 'Steel-comb music box: strong fundamental, glassy inharmonic tine overtones (6.27x, 17.5x), mechanism tick, wooden box resonance.',
  voice(ev, ctx) {
    const { rng } = ctx, m = ev.midi, v = clamp(ev.vel, 0.05, 1.1);
    const f0 = midiToHz(m) * centsExact((rng() - 0.5) * 3);
    const tau = reg(m, [[60, 1.3], [84, 0.75], [108, 0.32]]) * (ctx.o.sustain || 1);
    const n = ns(Math.max(ev.dur, 0.1) + tau * 3.2);
    const L = new Float32Array(n), R = new Float32Array(n);
    const pan = clamp((m - 72) / 48, -1, 1) * 0.35;
    addDamped(L, R, f0, 1.0, tau, 0, pan);
    addDamped(L, R, f0 * 2.001, 0.14, tau * 0.45, 1, pan);
    addDamped(L, R, f0 * 3.0, 0.05, tau * 0.3, 2, pan);
    addDamped(L, R, f0 * 6.27, 0.2 * (0.5 + v), tau * 0.1, 0.5, pan);
    addDamped(L, R, f0 * 17.55, 0.07 * (0.5 + v), tau * 0.03, 1.5, pan);
    addDamped(L, R, f0 * 0.5 * 1.0, 0.04, tau * 0.6, 0, pan); // sub-resonance of the comb
    // pluck tick
    const tn = ns(0.006);
    const x = noise('white', tn, seedOf(ctx.i, 'mb'), { rms: 1 });
    const e = expEnv(tn, 0.0012);
    for (let i = 0; i < tn; i++) x[i] *= e[i];
    mixIntoPan(L, R, biquad(x, 'hp', 3500, 0.7), 0, 0.12 * v, pan);
    const amp = (0.34 * velAmp(v, 1.1));
    for (let i = 0; i < n; i++) { L[i] *= amp; R[i] *= amp; }
    fadeInArr(L, 12); fadeInArr(R, 12);
    releaseTail(L, ns(ev.dur + tau * 0.8), 0.6); releaseTail(R, ns(ev.dur + tau * 0.8), 0.6);
    return { L, R };
  },
  bus: (seg) => biquadChain(seg, [{ type: 'peak', f: 1100, q: 1.3, g: 3 }, { type: 'highshelf', f: 6000, g: -1.5 }, { type: 'lp', f: 14000, q: 0.6 }]),
  defaults: { sustain: 1 },
  options: { sustain: 'x ring time' },
  reverb: { preset: 'plate', wet: 0.34 },
  gainDb: 0, range: [60, 108], defaultMidi: 84, defaultDur: 0.4,
});

defineInstrument({
  id: 'celesta', name: 'Celesta', family: 'keys',
  desc: 'Steel-plate celesta: soft hammer, round fundamental with a 4x shimmer and slow beating twin; longer and warmer than the music box.',
  voice(ev, ctx) {
    const { rng } = ctx, m = ev.midi, v = clamp(ev.vel, 0.05, 1.1);
    const f0 = midiToHz(m) * centsExact((rng() - 0.5) * 2);
    const tau = reg(m, [[60, 2.4], [84, 1.5], [108, 0.6]]) * (ctx.o.sustain || 1);
    const n = ns(Math.max(ev.dur, 0.1) + tau * 3.5);
    const L = new Float32Array(n), R = new Float32Array(n);
    const pan = clamp((m - 72) / 48, -1, 1) * 0.3;
    addDamped(L, R, f0 * 0.9993, 0.6, tau, 0.2, pan - 0.1);
    addDamped(L, R, f0 * 1.0007, 0.6, tau * 0.95, 0.9, pan + 0.1);
    addDamped(L, R, f0 * 2.0, 0.11, tau * 0.4, 0.3, pan);
    addDamped(L, R, f0 * 3.99, 0.28 * (0.4 + v), tau * 0.22, 1.1, pan);
    addDamped(L, R, f0 * 5.4, 0.07 * v, tau * 0.1, 2.1, pan);
    addDamped(L, R, f0 * 9.5, 0.025 * v, tau * 0.05, 0.4, pan);
    const tn = ns(0.014);
    const x = noise('white', tn, seedOf(ctx.i, 'cel'), { rms: 1 });
    const e = expEnv(tn, 0.003);
    for (let i = 0; i < tn; i++) x[i] *= e[i];
    mixIntoPan(L, R, biquad(x, 'bp', 1800, 0.8), 0, 0.1 * v, pan);
    const amp = 0.36 * velAmp(v, 1.1);
    for (let i = 0; i < n; i++) { L[i] *= amp; R[i] *= amp; }
    fadeInArr(L, 30); fadeInArr(R, 30);
    releaseTail(L, ns(ev.dur + tau * 0.5), 0.9); releaseTail(R, ns(ev.dur + tau * 0.5), 0.9);
    return { L, R };
  },
  defaults: { sustain: 1 },
  options: { sustain: 'x ring time' },
  reverb: { preset: 'hall', wet: 0.32 },
  gainDb: 0, range: [60, 108], defaultMidi: 84, defaultDur: 0.5,
});

// ---------------------------------------------------------------------------------------------------------------
// harp
// ---------------------------------------------------------------------------------------------------------------
defineInstrument({
  id: 'harp', name: 'Concert harp', family: 'keys',
  desc: 'Plucked gut/nylon strings: pluck-position comb, laissez-vibrer ring, soundboard thump, low-string buzz. Use harpGliss() for glissandi.',
  voice(ev, ctx) {
    const { rng, o } = ctx, m = ev.midi, v = clamp(ev.vel, 0.05, 1.1);
    const f0 = midiToHz(m) * centsExact((rng() - 0.5) * 2.5);
    const tau1 = reg(m, [[28, 5.5], [48, 3.2], [72, 1.8], [96, 0.8]]) * (o.sustain || 1);
    const ring = o.damp ? ev.dur : (o.ring != null ? o.ring : 3.2);
    const rel = o.damp ? 0.22 : 0.9;
    const n = ns(Math.max(ring, 0.05) + rel + 0.02);
    const L = new Float32Array(n), R = new Float32Array(n);
    const x0 = 0.17 + 0.1 * rng();
    const B = 3e-5 * Math.exp(0.05 * (60 - m) * (m < 60 ? 1 : 0.2));
    const pan = clamp(-0.28 + (m - 48) / 90, -0.8, 0.8);
    const fc = 2200 + 4500 * v;
    for (let k = 1; k <= 22; k++) {
      const fk = k * f0 * Math.sqrt(1 + B * k * k);
      if (fk > 13000) break;
      const comb = 0.25 + 0.75 * Math.abs(Math.sin(Math.PI * k * x0));
      const a = (comb / Math.pow(k, 1.35)) / (1 + Math.pow(fk / fc, 2));
      const tau = tau1 / (1 + 0.2 * Math.pow(k - 1, 1.35));
      addDamped(L, R, fk, a, tau, (rng() - 0.5) * 0.8, clamp(pan + 0.1 * Math.sin(k * 1.9), -1, 1));
    }
    let pk = 0;
    const lim = Math.min(n, ns(0.2));
    for (let i = 0; i < lim; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
    const amp = (0.5 * velAmp(v, 1.2)) / Math.max(pk, 1e-6);
    for (let i = 0; i < n; i++) { L[i] *= amp; R[i] *= amp; }
    // fingertip pluck + soundboard thump
    const pn = ns(0.01);
    const x = noise('white', pn, seedOf(ctx.i, 'harp', m), { rms: 1 });
    const e = expEnv(pn, 0.0018);
    for (let i = 0; i < pn; i++) x[i] *= e[i];
    mixIntoPan(L, R, biquad(x, 'bp', 2600, 0.9), 0, 0.05 * v * amp, pan);
    const tn = ns(0.08);
    const z = noise('white', tn, seedOf(ctx.i, 'hth', m), { rms: 1 });
    const ez = expEnv(tn, 0.02);
    for (let i = 0; i < tn; i++) z[i] *= ez[i];
    mixIntoPan(L, R, biquad(z, 'lp', 260, 0.8), 0, 0.2 * v * amp, pan);
    fadeInArr(L, 14); fadeInArr(R, 14);
    releaseTail(L, o.damp ? ns(ev.dur) : ns(ring), rel); releaseTail(R, o.damp ? ns(ev.dur) : ns(ring), rel);
    return { L, R };
  },
  defaults: { ring: 3.2, damp: false },
  options: { ring: 'seconds each string rings (default 3.2); ignored if damp', damp: 'true = stop the string at note end (staccato / muted)', sustain: 'x natural decay' },
  reverb: { preset: 'hall', wet: 0.3 },
  gainDb: 0, range: [24, 103], defaultMidi: 72, defaultDur: 0.3,
});

/**
 * harpGliss(t, fromMidi, toMidi, {rootPc=0, scale='major' | pcs[], step=0.045 (s per string), accel=0 (>0 = speeds up), vel=[0.5,0.8], dur=0.12, end})
 * -> notes. Diatonic glissando (default C major = A minor, the film's key); fromMidi/toMidi are snapped to the scale.
 * 'accel' 0.3 shortens each successive step so the run rushes toward its end.
 */
export function harpGliss(t, fromMidi, toMidi, opts = {}) {
  const { rootPc = 0, scale = 'major', step = 0.045, accel = 0, vel = [0.45, 0.8], dur = 0.12 } = opts;
  const pcs = Array.isArray(scale) ? scale : SCALES[scale];
  const inScale = (mm) => pcs.includes((((mm - rootPc) % 12) + 12) % 12);
  const up = toMidi >= fromMidi;
  const lo = Math.min(fromMidi, toMidi), hi = Math.max(fromMidi, toMidi);
  const list = [];
  for (let mm = lo; mm <= hi; mm++) if (inScale(mm)) list.push(mm);
  if (!up) list.reverse();
  const out = [];
  let tt = t;
  list.forEach((midi, i) => {
    const x = list.length > 1 ? i / (list.length - 1) : 1;
    const vv = Array.isArray(vel) ? vel[0] + (vel[1] - vel[0]) * x : vel;
    out.push({ t: tt, dur, midi, vel: vv });
    tt += step * Math.pow(1 - accel, i);
  });
  return out;
}
