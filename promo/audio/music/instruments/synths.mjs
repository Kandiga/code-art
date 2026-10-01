// =============================================================================
// instruments/synths.mjs - analog-ish synths: synth_pulse (8th-note pluck/pulse), synth_bass, synth_pad (warm wide),
//                          fm_bell, supersaw (stab), drone (dark beating bed)
// =============================================================================
import { dsp, SR, cues, defineInstrument, clamp, reg, ns, cents, expEnv, fadeInArr, releaseTail, velAmp, slowLfo, TAU } from './common.mjs';
const { midiToHz, noise, osc, svf, ladder, biquad, biquadChain, seedOf, drift, unison, fastTanh } = dsp;

// ---------------------------------------------------------------------------------------------------------------
// pluck / pulse
// ---------------------------------------------------------------------------------------------------------------
defineInstrument({
  id: 'synth_pulse', name: 'Synth pulse / pluck', family: 'synth',
  desc: 'Filtered saw+PWM pluck for the driving 8th-note pulse: ladder low-pass with a fast filter envelope, tight gate, dotted-8th ping-pong echo on the bus.',
  voice(ev, ctx) {
    const { rng, o } = ctx;
    const m = ev.midi, v = clamp(ev.vel, 0.03, 1.1), f0 = midiToHz(m);
    const gate = Math.max(0.03, Math.min(ev.dur, o.maxGate != null ? o.maxGate : 0.5));
    const rel = 0.05;
    const n = ns(gate + rel) + 8;
    const fa1 = new Float32Array(n).fill(f0 * cents(-5));
    const fa2 = new Float32Array(n).fill(f0 * cents(6));
    const pw = new Float32Array(n);
    const lfoR = 0.7 + 0.5 * rng();
    for (let i = 0; i < n; i++) pw[i] = 0.5 + 0.18 * Math.sin((TAU * lfoR * i) / SR + rng() * 0);
    const s1 = osc('saw', fa1, n, { phase: rng() });
    const s2 = osc('pulse', fa2, n, { width: pw, phase: rng() });
    const src = new Float32Array(n);
    for (let i = 0; i < n; i++) src[i] = 0.5 * s1[i] + 0.5 * s2[i];
    const dec = (o.decay != null ? o.decay : 0.13);
    const fcArr = new Float32Array(n);
    const bright = (o.brightScale || 1);
    const top = clamp(f0 * (10 + 26 * v) * bright, 1200, 11000), floor = clamp(f0 * 2.2 * bright, 220, 2500);
    const kf = Math.exp(-1 / (dec * SR));
    let e = 1;
    for (let i = 0; i < n; i++) { fcArr[i] = floor + (top - floor) * e; e *= kf; }
    const y = ladder(src, fcArr, o.res != null ? o.res : 0.3, { drive: 0.9 });
    const amp = 0.38 * velAmp(v, 1.0);
    const kg = Math.exp(-1 / ((dec * 3.2) * SR));
    let g = 1;
    for (let i = 0; i < n; i++) { y[i] *= amp * (0.55 + 0.45 * g) * Math.min(1, i / 48); g *= kg; }
    releaseTail(y, ns(gate), rel);
    return y;
  },
  bus: (seg, ctx) => {
    const mixv = ctx.o.echo != null ? ctx.o.echo : 0.2;
    if (mixv <= 0) return seg;
    return dsp.fade(dsp.pingPong(seg, cues.BEAT * 0.75, 0.38, mixv, { damp: 0.35, width: 1 }), 0, 0.5);
  },
  busTail: 1.8,
  defaults: {}, options: { decay: 'filter-envelope decay s (default 0.13)', brightScale: 'x filter', res: 'resonance 0..0.9', echo: 'dotted-8th ping-pong mix 0..1 (default 0.2; 0 = off)', maxGate: 'max gate length s' },
  reverb: { preset: 'plate', wet: 0.16 }, gainDb: 0, range: [36, 84], defaultMidi: 57, defaultDur: 0.24, test: { motifOct: -1, chordOct: -1 },
});

// ---------------------------------------------------------------------------------------------------------------
// bass
// ---------------------------------------------------------------------------------------------------------------
defineInstrument({
  id: 'synth_bass', name: 'Analog bass', family: 'synth',
  desc: 'Mono analog bass: saw + square-sub + sine, ladder low-pass with punchy filter env and drive. Solid on small speakers (2nd harmonic bump).',
  voice(ev, ctx) {
    const { o } = ctx;
    const m = ev.midi, v = clamp(ev.vel, 0.03, 1.1), f0 = midiToHz(m);
    const rel = o.release != null ? o.release : 0.06;
    const body = Math.max(0.04, ev.dur);
    const n = ns(body + rel) + 8;
    const fs = new Float32Array(n).fill(f0);
    const fsub = new Float32Array(n).fill(f0 * 0.5);
    const saw = osc('saw', fs, n), sq = osc('square', fsub, n), sine = osc('sine', fs, n);
    const src = new Float32Array(n);
    for (let i = 0; i < n; i++) src[i] = 0.55 * saw[i] + 0.35 * sq[i];
    const fcArr = new Float32Array(n);
    const dec = o.decay != null ? o.decay : 0.16;
    const top = clamp(f0 * (7 + 16 * v) * (o.brightScale || 1), 300, 6000), floor = clamp(f0 * 2.4, 90, 700);
    const kf = Math.exp(-1 / (dec * SR));
    let e = 1;
    for (let i = 0; i < n; i++) { fcArr[i] = floor + (top - floor) * e; e *= kf; }
    const y = ladder(src, fcArr, o.res != null ? o.res : 0.25, { drive: 1.0 });
    const d = (o.drive != null ? o.drive : 1.7);
    const amp = 0.46 * velAmp(v, 0.9);
    const bN = ns(body);
    for (let i = 0; i < n; i++) {
      const s = fastTanh((y[i] + 0.75 * sine[i]) * d) / fastTanh(d) * 0.9;
      y[i] = s * amp * Math.min(1, i / 96);
    }
    releaseTail(y, bN, rel);
    return dsp.dcBlock(y, 12);
  },
  defaults: {}, options: { decay: 'filter env decay s (default 0.16)', drive: 'saturation (default 1.7)', brightScale: 'x filter', res: 'resonance', release: 'release s' },
  reverb: { preset: 'room', wet: 0.04 }, gainDb: 0, range: [24, 55], defaultMidi: 33, defaultDur: 0.4, test: { motifOct: -2, chordOct: -2, voicing: 'root' },
});

// ---------------------------------------------------------------------------------------------------------------
// warm pad
// ---------------------------------------------------------------------------------------------------------------
defineInstrument({
  id: 'synth_pad', name: 'Warm wide pad', family: 'synth',
  desc: 'Slow-attack analog pad: 6 detuned saws + 2 PWM pulses with sub, low-pass that breathes with a slow LFO, string-machine ensemble on the bus. Very wide.',
  voice(ev, ctx) {
    const { rng, o } = ctx;
    const m = ev.midi, v = clamp(ev.vel, 0.03, 1.1), f0 = midiToHz(m);
    const a = (o.attack != null ? o.attack : 0.75) * (1.3 - 0.5 * v), rel = o.release != null ? o.release : 1.3;
    const body = Math.max(ev.dur, a * 0.9);
    const n = ns(body + rel) + 8;
    const lead = 0.3 * a;
    const u = unison('saw', f0, n, { voices: 6, detuneCents: 15 * (o.detuneScale || 1), spread: 0.95, seed: Math.floor(rng() * 1e9) });
    const pwL = slowLfo(n, 0.19 + 0.1 * rng(), 0.5, 0.25, rng()), pwR = slowLfo(n, 0.23 + 0.1 * rng(), 0.5, 0.25, rng());
    const pL = osc('pulse', new Float32Array(n).fill(f0 * cents(-4)), n, { width: pwL }), pR = osc('pulse', new Float32Array(n).fill(f0 * cents(5)), n, { width: pwR });
    const sub = osc('sine', new Float32Array(n).fill(f0 * 0.5), n);
    const L = new Float32Array(n), R = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      L[i] = u.L[i] * 0.8 + pL[i] * 0.3 + sub[i] * 0.22;
      R[i] = u.R[i] * 0.8 + pR[i] * 0.3 + sub[i] * 0.22;
    }
    // breathing low-pass + envelope
    const aN = Math.max(2, ns(a)), bN = ns(body);
    const env = new Float32Array(n), fcArr = new Float32Array(n);
    const lfoC = slowLfo(n, 0.11 + 0.08 * rng(), 1, 0.28, rng());
    const base = clamp(f0 * (5 + 10 * v) * (o.brightScale || 1), 900, 6500);
    for (let i = 0; i < n; i++) {
      const e = i < aN ? 0.5 - 0.5 * Math.cos((Math.PI * i) / aN) : 1;
      env[i] = e;
      fcArr[i] = base * (0.55 + 0.3 * e) * lfoC[i];
    }
    for (let i = bN; i < n; i++) env[i] *= 0.5 + 0.5 * Math.cos((Math.PI * (i - bN)) / Math.max(1, n - bN));
    const fL = svf(L, 'lp', fcArr, 0.8, { update: 8 }), fR = svf(R, 'lp', fcArr, 0.8, { update: 8 });
    const amp = 0.22 * velAmp(v, 1.0);
    for (let i = 0; i < n; i++) { fL[i] *= env[i] * amp; fR[i] *= env[i] * amp; }
    fadeInArr(fL, 12); fadeInArr(fR, 12);
    return { L: fL, R: fR, lead };
  },
  bus: (seg, ctx) => {
    const y = dsp.ensemble(seg, { voices: 3, mix: ctx.o.ensemble != null ? ctx.o.ensemble : 0.5, depthMs: 3.5, delayMs: 19, seed: 5 });
    return dsp.widen(y, ctx.o.width != null ? ctx.o.width : 1.3, { bassMonoHz: 150 });
  },
  busTail: 0.1,
  defaults: {}, options: { attack: 'swell time s (default 0.75)', release: 'release s (default 1.3)', brightScale: 'x filter', detuneScale: 'x unison detune', ensemble: 'chorus 0..1', width: 'stereo width (default 1.3)' },
  reverb: { preset: 'bigHall', wet: 0.3 }, gainDb: 0, range: [36, 88], defaultMidi: 60, defaultDur: 2, test: { motifOct: 0, chordOct: 0 },
});

// ---------------------------------------------------------------------------------------------------------------
// FM bell
// ---------------------------------------------------------------------------------------------------------------
defineInstrument({
  id: 'fm_bell', name: 'FM bell', family: 'synth',
  desc: 'DX-style tubular bell: inharmonic 3.5:1 modulator whose index decays (bright strike -> pure ring) + a 1.4x chime partial. Glassy, long.',
  voice(ev, ctx) {
    const { rng, o } = ctx;
    const m = ev.midi, v = clamp(ev.vel, 0.03, 1.1), f0 = midiToHz(m);
    const tau = reg(m, [[48, 3.0], [72, 1.9], [96, 0.9]]) * (o.sustain || 1);
    const n = ns(Math.max(ev.dur, 0.2) + tau * 3.8);
    const out = new Float32Array(n);
    const I0 = Math.min((0.6 + 2.4 * v) * (o.index != null ? o.index : 1), Math.max(0.45, 9000 / (7 * f0) - 1)); // key-scaled: keep sidebands below ~9 kHz (no aliasing)
    const kI = Math.exp(-1 / (0.4 * (o.sustain || 1) * SR)), kA = Math.exp(-1 / (tau * SR)), kB = Math.exp(-1 / (tau * 0.4 * SR));
    let pc = rng(), pm = rng(), pc2 = rng(), pm2 = rng();
    let ie = 1, ae = 1, be = 1;
    const wc = f0 / SR, wm = (f0 * 3.5) / SR, wc2 = (f0 * 2.0) / SR, wm2 = (f0 * 2.0 * 1.41) / SR;
    for (let i = 0; i < n; i++) {
      const idx = 0.25 + I0 * ie;
      const a = Math.sin(TAU * (pc + idx * Math.sin(TAU * pm)));
      const b = Math.sin(TAU * (pc2 + 0.6 * idx * Math.sin(TAU * pm2)));
      out[i] = a * ae + 0.22 * b * be;
      pc += wc; pm += wm; pc2 += wc2; pm2 += wm2;
      if (pc >= 1) pc -= 1; if (pm >= 1) pm -= 1; if (pc2 >= 1) pc2 -= 1; if (pm2 >= 1) pm2 -= 1;
      ie *= kI; ae *= kA; be *= kB;
    }
    const amp = 0.3 * velAmp(v, 1.1);
    for (let i = 0; i < n; i++) out[i] *= amp * Math.min(1, i / 36);
    releaseTail(out, ns(ev.dur + tau * 1.5), 1.0);
    const [gl, gr] = dsp.panGains(clamp((m - 72) / 40, -1, 1) * 0.4, true);
    const L = new Float32Array(n), R = new Float32Array(n);
    for (let i = 0; i < n; i++) { L[i] = out[i] * gl; R[i] = out[i] * gr; }
    return { L, R };
  },
  defaults: {}, options: { sustain: 'x ring time', index: 'x modulation index (brightness)' },
  reverb: { preset: 'plate', wet: 0.3 }, gainDb: 0, range: [48, 100], defaultMidi: 76, defaultDur: 0.6, test: { motifOct: 1, chordOct: 1 },
});

// ---------------------------------------------------------------------------------------------------------------
// supersaw stab
// ---------------------------------------------------------------------------------------------------------------
defineInstrument({
  id: 'supersaw', name: 'Supersaw stab', family: 'synth',
  desc: '7-voice detuned saw stack (+ octave layer) with a snappy filter envelope: orchestral-hit style stabs and synth chords. Send chord notes together.',
  voice(ev, ctx) {
    const { rng, o } = ctx;
    const m = ev.midi, v = clamp(ev.vel, 0.03, 1.1), f0 = midiToHz(m);
    const body = Math.min(Math.max(ev.dur, 0.06), o.maxGate != null ? o.maxGate : 0.6);
    const rel = o.release != null ? o.release : 0.14;
    const n = ns(body + rel) + 8;
    const u = unison('saw', f0, n, { voices: 7, detuneCents: 24 * (o.detuneScale || 1), spread: 0.9, seed: Math.floor(rng() * 1e9) });
    const u2 = unison('saw', f0 * 2, n, { voices: 3, detuneCents: 12, spread: 0.7, seed: Math.floor(rng() * 1e9) });
    const L = new Float32Array(n), R = new Float32Array(n);
    for (let i = 0; i < n; i++) { L[i] = u.L[i] + u2.L[i] * 0.4; R[i] = u.R[i] + u2.R[i] * 0.4; }
    const fcArr = new Float32Array(n);
    const dec = o.decay != null ? o.decay : 0.22;
    const top = clamp(f0 * (14 + 22 * v) * (o.brightScale || 1), 2500, 12000), floor = clamp(f0 * 3.5, 500, 3500);
    const kf = Math.exp(-1 / (dec * SR));
    const ka = Math.exp(-1 / (dec * 1.6 * SR));
    let e = 1, g = 1;
    const env = new Float32Array(n);
    for (let i = 0; i < n; i++) { fcArr[i] = floor + (top - floor) * e; env[i] = (0.4 + 0.6 * g) * Math.min(1, i / 120); e *= kf; g *= ka; }
    const fL = svf(L, 'lp', fcArr, 0.9, { update: 8 }), fR = svf(R, 'lp', fcArr, 0.9, { update: 8 });
    const hL = biquad(fL, 'hp', 120, 0.7), hR = biquad(fR, 'hp', 120, 0.7);
    const amp = 0.17 * velAmp(v, 1.0);
    for (let i = 0; i < n; i++) { hL[i] *= env[i] * amp; hR[i] *= env[i] * amp; }
    releaseTail(hL, ns(body), rel); releaseTail(hR, ns(body), rel);
    return { L: hL, R: hR };
  },
  defaults: {}, options: { decay: 'filter/amp decay s', brightScale: 'x filter', detuneScale: 'x detune', maxGate: 'max gate s (default 0.6)', release: 'release s' },
  reverb: { preset: 'hall', wet: 0.22 }, gainDb: 0, range: [40, 88], defaultMidi: 60, defaultDur: 0.3, test: { motifOct: 0, chordOct: 0 },
});

// ---------------------------------------------------------------------------------------------------------------
// drone: dark beating bed (cold open: "low drone from 1.0")
// ---------------------------------------------------------------------------------------------------------------
defineInstrument({
  id: 'drone', name: 'Dark drone', family: 'synth',
  desc: 'Low projector-room drone: detuned harmonic stack (f, 2f, 3f, 4f) beating slowly, soft sub, breathing filter, a trace of rumble. Use on A1/A2 for the cold open.',
  voice(ev, ctx) {
    const { rng, o } = ctx;
    const m = ev.midi, v = clamp(ev.vel, 0.03, 1.1), f0 = midiToHz(m);
    const a = o.attack != null ? o.attack : 1.2, rel = o.release != null ? o.release : 1.5;
    const body = Math.max(ev.dur, a);
    const n = ns(body + rel) + 8;
    const lead = 0.3 * a;
    const L = new Float32Array(n), R = new Float32Array(n);
    const parts = [[1, 1.0], [2, 0.6], [3, 0.38], [4, 0.28], [5, 0.14], [6, 0.1]];
    for (const [h, amp] of parts) {
      for (let s = 0; s < 3; s++) {
        const det = (s - 1) * (3.5 + 3 * rng()) * (o.detuneScale || 1);
        const f = f0 * h * cents(det);
        if (f > 3000) continue;
        const ph0 = rng(), lfo = 0.05 + 0.1 * rng(), lp = rng();
        const pan = (s - 1) * 0.7;
        const [gl, gr] = dsp.panGains(pan, true);
        let ph = ph0;
        for (let i = 0; i < n; i++) {
          ph += f / SR; if (ph >= 1) ph -= 1;
          const y = Math.sin(TAU * ph) * amp * (0.8 + 0.2 * Math.sin(TAU * (lfo * i / SR + lp))) * 0.4;
          L[i] += y * gl; R[i] += y * gr;
        }
      }
    }
    const aN = Math.max(2, ns(a)), bN = ns(body);
    const env = new Float32Array(n);
    for (let i = 0; i < n; i++) env[i] = i < aN ? 0.5 - 0.5 * Math.cos((Math.PI * i) / aN) : 1;
    for (let i = bN; i < n; i++) env[i] *= 0.5 + 0.5 * Math.cos((Math.PI * (i - bN)) / Math.max(1, n - bN));
    const fc = clamp(f0 * 7 * (o.brightScale || 1), 200, 2500);
    const fcArr = new Float32Array(n);
    const lr = 0.07 + 0.05 * rng();
    for (let i = 0; i < n; i++) fcArr[i] = fc * (0.8 + 0.25 * Math.sin(TAU * lr * i / SR));
    const fL = svf(L, 'lp', fcArr, 0.9, { update: 8 }), fR = svf(R, 'lp', fcArr, 0.9, { update: 8 });
    const rum = biquad(noise('brown', n, seedOf(ctx.i, 'drn', m), { rms: 1 }), 'lp', 90, 0.7);
    const amp = 0.28 * velAmp(v, 1.0);
    for (let i = 0; i < n; i++) { fL[i] = (fL[i] + rum[i] * 0.05) * env[i] * amp; fR[i] = (fR[i] + rum[i] * 0.05) * env[i] * amp; }
    fadeInArr(fL, 12); fadeInArr(fR, 12);
    return { L: fL, R: fR, lead };
  },
  defaults: {}, options: { attack: 'swell s (default 1.2)', release: 'release s (default 1.5)', brightScale: 'x filter', detuneScale: 'x beating' },
  reverb: { preset: 'hall', wet: 0.3 }, gainDb: 0, range: [24, 60], defaultMidi: 33, defaultDur: 4, test: { motifOct: -1, chordOct: -2, voicing: 'bass' },
});
