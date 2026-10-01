// =============================================================================
// instruments/fx.mjs - trailer / transition FX. Notes: {t, dur, vel, midi?, ...}
//   riser (t..t+dur builds), reverse_swell (peaks at t+dur), sub_drop (long), braam, impact (size S|M|L, lands at t),
//   tape_rewind, shimmer (granular pad)
// =============================================================================
import { dsp, SR, cues, defineInstrument, clamp, reg, ns, cents, expEnv, fadeInArr, fadeOutArr, releaseTail, velAmp, addDamped, TAU } from './common.mjs';
import { crashSignal } from './drums.mjs';
const { midiToHz, noise, osc, svf, biquad, biquadChain, seedOf, mulberry32, drift, unison, fastTanh, glide, varispeed, granularCloud } = dsp;

const expSweep = (n, f0, f1) => dsp.glide(f0, f1, n, 'exp');
const pw = (x, k) => Math.pow(clamp(x, 0, 1), k);

// ---------------------------------------------------------------------------------------------------------------
// riser
// ---------------------------------------------------------------------------------------------------------------
defineInstrument({
  id: 'riser', name: 'Riser (noise + tonal)', kind: 'fx', family: 'fx',
  desc: 'Tension riser: band-pass noise sweeping up with growing resonance + a rising detuned-saw whine and shimmer; swells to full at t+dur then stops (land a hit there). midi = pitch the whine rises TO (default C6).',
  voice(ev, ctx) {
    const { rng, o } = ctx;
    const dur = Math.max(0.3, ev.dur), v = clamp(ev.vel, 0.05, 1.1);
    const n = ns(dur) + ns(0.04);
    const N = ns(dur);
    const L = new Float32Array(n), R = new Float32Array(n);
    // noise: swept band-pass
    const topHz = (o.topHz || 11000), loHz = o.loHz || 280;
    const fcArr = expSweep(n, loHz, topHz);
    const qArr = new Float32Array(n);
    for (let i = 0; i < n; i++) qArr[i] = 0.8 + 1.8 * pw(i / N, 1.5);
    const nl = svf(noise('white', n, seedOf(ctx.i, 'rsL'), { rms: 1 }), 'bp', fcArr, qArr, { update: 4 });
    const nr = svf(noise('white', n, seedOf(ctx.i, 'rsR'), { rms: 1 }), 'bp', fcArr, qArr, { update: 4 });
    // tonal whine
    const endMidi = ev.midi != null ? ev.midi : 84;
    const fEnd = midiToHz(endMidi), fStart = fEnd / (o.range || 6);
    const fa = expSweep(n, fStart, fEnd);
    const u = unison('saw', fa, n, { voices: 4, detuneCents: 18, spread: 0.9, seed: Math.floor(rng() * 1e9) });
    const tcut = new Float32Array(n);
    for (let i = 0; i < n; i++) tcut[i] = clamp(fa[i] * 5, 400, 9000);
    const tL = svf(u.L, 'lp', tcut, 0.8, { update: 8 }), tR = svf(u.R, 'lp', tcut, 0.8, { update: 8 });
    const nz = (o.noise != null ? o.noise : 1), tn = (o.tonal != null ? o.tonal : 0.7);
    for (let i = 0; i < n; i++) {
      const x = i / N;
      const e = i >= N ? Math.max(0, 1 - (i - N) / ns(0.04)) : pw(x, 2.3);
      const et = i >= N ? e : pw(x, 3.2);
      // shimmer tremolo grows faster toward the end
      const trem = 1 - 0.18 * pw(x, 2) * (0.5 + 0.5 * Math.sin(TAU * (6 + 26 * x * x) * i / SR));
      L[i] = (nl[i] * 0.62 * nz * e + tL[i] * 0.13 * tn * et) * trem;
      R[i] = (nr[i] * 0.62 * nz * e + tR[i] * 0.13 * tn * et) * trem;
    }
    const amp = 0.9 * velAmp(v, 0.9);
    for (let i = 0; i < n; i++) { L[i] *= amp; R[i] *= amp; }
    fadeInArr(L, 64); fadeInArr(R, 64);
    fadeOutArr(L, 48); fadeOutArr(R, 48);
    return { L, R };
  },
  defaults: {}, options: { topHz: 'noise sweep end (Hz, default 11000)', loHz: 'noise sweep start (default 280)', noise: 'x noise level', tonal: 'x tonal level', range: 'x pitch range of the whine (default 6 = 2.6 octaves)' },
  reverb: { preset: 'plate', wet: 0.14 }, gainDb: 0, defaultMidi: 84, defaultDur: 4, test: { chord: false },
  testNotes: () => [{ t: 0.2, dur: 3.2, vel: 0.9, midi: 84 }],
});

// ---------------------------------------------------------------------------------------------------------------
// reverse swell
// ---------------------------------------------------------------------------------------------------------------
defineInstrument({
  id: 'reverse_swell', name: 'Reverse swell', kind: 'fx', family: 'fx',
  desc: 'Reversed cymbal/shimmer wash that builds for dur and ENDS at t+dur on its loudest point (a "suck" into the downbeat). midi adds a soft rising tone.',
  voice(ev, ctx) {
    const { o } = ctx;
    const dur = Math.max(0.3, ev.dur), v = clamp(ev.vel, 0.05, 1.1);
    const n = ns(dur);
    const { L, R } = crashSignal(n, seedOf(ctx.i, 'rvs'), { ring: dur * 0.9, bright: 0.8 });
    // reverse
    L.reverse(); R.reverse();
    // a smooth bloom + a quick hard end
    const tone = ev.midi != null ? ev.midi : null;
    const t = tone != null ? osc('sine', glide(midiToHz(tone) * 0.5, midiToHz(tone), n, 'exp'), n) : null;
    for (let i = 0; i < n; i++) {
      const x = i / n;
      const e = Math.pow(x, 0.7) * (i > n - ns(0.02) ? (n - i) / ns(0.02) : 1);
      L[i] *= e; R[i] *= e;
      if (t) { const g = 0.12 * Math.pow(x, 2.2); L[i] += t[i] * g; R[i] += t[i] * g; }
    }
    const amp = 1.0 * velAmp(v, 0.9) * (o.level || 1);
    const pk = (() => { let p = 0; for (let i = 0; i < n; i++) p = Math.max(p, Math.abs(L[i]), Math.abs(R[i])); return p || 1; })();
    for (let i = 0; i < n; i++) { L[i] *= (0.7 * amp) / pk; R[i] *= (0.7 * amp) / pk; }
    fadeInArr(L, 32); fadeInArr(R, 32);
    return { L, R };
  },
  defaults: {}, options: { level: 'x level' }, reverb: { preset: 'plate', wet: 0.1 }, gainDb: 0, defaultDur: 2.5, test: { chord: false },
  testNotes: () => [{ t: 0.2, dur: 2.5, vel: 0.9 }],
});

// ---------------------------------------------------------------------------------------------------------------
// sub drop
// ---------------------------------------------------------------------------------------------------------------
defineInstrument({
  id: 'sub_drop', subHz: 14, name: 'Sub drop (long)', kind: 'fx', family: 'fx',
  desc: 'Cinematic sub drop: a sine falling from ~62 Hz to ~26 Hz with a long smooth decay, soft harmonics so it reads on small speakers, rumble. midi sets the START pitch. dur = total length incl. the tail (default 5 s).',
  voice(ev, ctx) {
    const { o } = ctx;
    const v = clamp(ev.vel, 0.05, 1.1);
    const dur = Math.max(0.6, ev.dur);
    const n = ns(dur);
    const f1 = ev.midi != null ? midiToHz(ev.midi) : 62, f2 = Math.max(24, f1 * 0.42);
    const dropT = Math.min(2.2, dur * 0.5);
    const kd = Math.exp(-1 / (dropT * 0.45 * SR));
    const out = new Float32Array(n);
    let ph = 0, pe = 1;
    const tau = (o.tau != null ? o.tau : dur * 0.3);
    for (let i = 0; i < n; i++) {
      const f = f2 + (f1 - f2) * pe;
      ph += f / SR; if (ph >= 1) ph -= 1;
      const w = TAU * ph;
      const a = Math.min(1, i / (0.008 * SR)) * Math.exp(-i / (tau * SR));
      out[i] = (Math.sin(w) + 0.16 * Math.sin(2 * w + 0.5) + 0.07 * Math.sin(3 * w + 1.1)) * a;
      pe *= kd;
    }
    // rumble + thump
    const rum = biquad(noise('brown', n, seedOf(ctx.i, 'sdr'), { rms: 1 }), 'lp', 110, 0.7);
    const th = biquad(noise('white', ns(0.12), seedOf(ctx.i, 'sdt'), { rms: 1 }), 'lp', 240, 0.7);
    for (let i = 0; i < n; i++) out[i] += rum[i] * 0.06 * Math.exp(-i / (0.9 * SR)) * Math.min(1, i / 2400);
    for (let i = 0; i < th.length; i++) out[i] += th[i] * 0.5 * Math.exp(-i / (0.03 * SR));
    const amp = 0.8 * velAmp(v, 0.8);
    for (let i = 0; i < n; i++) out[i] *= amp;
    releaseTail(out, n - ns(0.4), 0.4);
    return dsp.dcBlock(out, 10);
  },
  defaults: {}, options: { tau: 'amplitude decay time constant s (default dur*0.3)' },
  reverb: { preset: 'hall', wet: 0.12 }, gainDb: 0, defaultMidi: 36, defaultDur: 5, range: [30, 48], test: { chord: false },
  testNotes: () => [{ t: 0.2, dur: 5, vel: 0.9, midi: 36 }],
});

// ---------------------------------------------------------------------------------------------------------------
// braam
// ---------------------------------------------------------------------------------------------------------------
defineInstrument({
  id: 'braam', subHz: 14, name: 'Braam (trailer low brass)', kind: 'fx', family: 'fx',
  desc: 'Huge distorted low-brass blare: detuned saw stack (+ octave + sub) through a filter that blasts open then closes, heavy saturation, growl formants, slow bark pitch-settle. midi = root (default A1).',
  voice(ev, ctx) {
    const { rng, o } = ctx;
    const v = clamp(ev.vel, 0.05, 1.1);
    const m = ev.midi != null ? ev.midi : 33, f0 = midiToHz(m);
    const rel = o.release != null ? o.release : 0.9;
    const body = Math.max(0.3, ev.dur);
    const n = ns(body + rel) + 8;
    const bN = ns(body);
    const bend = new Float32Array(n);
    for (let i = 0; i < n; i++) bend[i] = cents(-38 * Math.exp(-i / (0.07 * SR)) + (o.fall ? -o.fall * 100 * pw((i - bN) / ns(0.6), 1.5) : 0));
    const mk = (f, vox, det, seed) => {
      const fa = new Float32Array(n);
      for (let i = 0; i < n; i++) fa[i] = f * bend[i];
      return unison('saw', fa, n, { voices: vox, detuneCents: det, spread: 0.9, seed });
    };
    const a = mk(f0, 6, 22, Math.floor(rng() * 1e9)), b = mk(f0 * 2, 4, 16, Math.floor(rng() * 1e9)), c = mk(f0 * 0.5, 2, 8, Math.floor(rng() * 1e9));
    const L = new Float32Array(n), R = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      L[i] = a.L[i] + b.L[i] * 0.7 + c.L[i] * 0.55;
      R[i] = a.R[i] + b.R[i] * 0.7 + c.R[i] * 0.55;
    }
    // filter: blasts open in ~0.1 s then closes slowly
    const fcArr = new Float32Array(n);
    const kd = Math.exp(-1 / (1.1 * SR));
    let dcy = 1;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const open = t < 0.11 ? 0.5 - 0.5 * Math.cos((Math.PI * t) / 0.11) : dcy;
      fcArr[i] = f0 * (3.5 + 24 * open * (0.7 + 0.3 * v) * (o.brightScale || 1)) * (1 + 0.04 * Math.sin(TAU * 5.2 * t));
      if (t >= 0.11) dcy = 0.18 + (dcy - 0.18) * kd;
    }
    let fL = svf(L, 'lp', fcArr, 1.5, { update: 8 }), fR = svf(R, 'lp', fcArr, 1.5, { update: 8 });
    const drv = (o.drive != null ? o.drive : 3.2) * (0.7 + 0.5 * v);
    fL = dsp.waveshape(fL, 'asym', drv, { oversample: 2 }); fR = dsp.waveshape(fR, 'asym', drv, { oversample: 2 });
    fL = biquadChain(fL, [{ type: 'peak', f: 650, q: 1.4, g: 5 }, { type: 'peak', f: 1700, q: 1.5, g: 3 }, { type: 'lp', f: 7500, q: 0.6 }, { type: 'hp', f: 32, q: 0.7 }]);
    fR = biquadChain(fR, [{ type: 'peak', f: 650, q: 1.4, g: 5 }, { type: 'peak', f: 1700, q: 1.5, g: 3 }, { type: 'lp', f: 7500, q: 0.6 }, { type: 'hp', f: 32, q: 0.7 }]);
    // bark noise
    const bk = biquad(noise('white', ns(0.12), seedOf(ctx.i, 'bm'), { rms: 1 }), 'bp', 900, 0.8);
    const amp = 0.55 * velAmp(v, 0.8);
    const aN = ns(0.022);
    for (let i = 0; i < n; i++) {
      let e = i < aN ? 0.5 - 0.5 * Math.cos((Math.PI * i) / aN) : 1;
      e *= 0.82 + 0.18 * Math.exp(-i / (0.5 * SR)) + 0.04 * Math.sin(TAU * 4.7 * i / SR);
      if (i >= bN) e *= 0.5 + 0.5 * Math.cos((Math.PI * Math.min(1, (i - bN) / (n - bN))));
      const k = i < bk.length ? bk[i] * 0.22 * Math.exp(-i / (0.03 * SR)) : 0;
      fL[i] = (fL[i] + k) * e * amp; fR[i] = (fR[i] + k) * e * amp;
    }
    fadeInArr(fL, 12); fadeInArr(fR, 12);
    return { L: fL, R: fR };
  },
  defaults: {}, options: { drive: 'distortion (default 3.2)', brightScale: 'x filter blast', fall: '(semitones) pitch fall over the release', release: 's (default 0.9)' },
  reverb: { preset: 'bigHall', wet: 0.22 }, gainDb: 0, defaultMidi: 33, defaultDur: 2.2, range: [28, 45], test: { chord: false },
  testNotes: () => [{ t: 0.2, dur: 2.2, vel: 0.9, midi: 33 }, { t: 3.4, dur: 1.2, vel: 0.9, midi: 36 }],
});

// ---------------------------------------------------------------------------------------------------------------
// impact
// ---------------------------------------------------------------------------------------------------------------
const IMPACT = {
  S: { len: 1.4, f1: 95, f2: 46, tau: 0.32, metal: 0.5, wash: 0.5, level: 0.7 },
  M: { len: 2.6, f1: 84, f2: 40, tau: 0.6, metal: 0.8, wash: 0.9, level: 0.85 },
  L: { len: 4.8, f1: 72, f2: 32, tau: 1.2, metal: 1.0, wash: 1.4, level: 1.0 },
};
defineInstrument({
  id: 'impact', name: 'Cinematic impact', kind: 'fx', family: 'fx',
  desc: 'Trailer hit: sub boom with pitch drop, body thud, noise crack, gong-ish metallic partials and a wide decaying wash. size S|M|L (per note or option; default from vel). Lands exactly at t.',
  voice(ev, ctx) {
    const { rng, o } = ctx;
    const size = ev.size || o.size || (ev.vel > 0.85 ? 'L' : ev.vel > 0.5 ? 'M' : 'S');
    const P = IMPACT[size] || IMPACT.M;
    const v = clamp(ev.vel, 0.05, 1.1);
    const len = ev.dur != null && ev.dur > 0.3 && ev.dur !== 0.5 ? ev.dur : P.len;
    const n = ns(len);
    const L = new Float32Array(n), R = new Float32Array(n);
    // boom
    {
      const kd = Math.exp(-1 / (0.09 * SR));
      let ph = 0, pe = 1;
      for (let i = 0; i < n; i++) {
        const f = P.f2 + (P.f1 - P.f2) * pe;
        ph += f / SR; if (ph >= 1) ph -= 1;
        const w = TAU * ph;
        const e = Math.min(1, i / (0.003 * SR)) * Math.exp(-i / (P.tau * SR));
        const y = Math.tanh((Math.sin(w) + 0.2 * Math.sin(2 * w + 0.4)) * 1.5 * e) * 0.9;
        L[i] += y; R[i] += y;
        pe *= kd;
      }
    }
    // body thud + crack
    const body = biquad(noise('white', ns(0.4), seedOf(ctx.i, 'ib'), { rms: 1 }), 'lp', 260, 0.7);
    for (let i = 0; i < body.length; i++) { const e = Math.exp(-i / (0.09 * SR)); L[i] += body[i] * 0.7 * e; R[i] += body[i] * 0.7 * e; }
    const crN = ns(0.25);
    const crL = biquad(biquad(noise('white', crN, seedOf(ctx.i, 'icL'), { rms: 1 }), 'hp', 1300, 0.7), 'lp', 11000, 0.7);
    const crR = biquad(biquad(noise('white', crN, seedOf(ctx.i, 'icR'), { rms: 1 }), 'hp', 1300, 0.7), 'lp', 11000, 0.7);
    for (let i = 0; i < crN; i++) { const e = Math.exp(-i / (0.045 * SR)) * Math.min(1, i / 24); L[i] += crL[i] * 0.55 * e; R[i] += crR[i] * 0.55 * e; }
    // metallic gong partials
    for (let k = 0; k < 9; k++) {
      const f = (170 + 90 * k + 340 * rng() * rng() * k) * (1 + 0.03 * k);
      const tau = P.tau * (0.3 + 0.5 * rng()) * 1.2;
      addDamped(L, R, f, 0.06 * P.metal * (0.4 + rng()) / (1 + k * 0.25), tau, rng() * 6, rng() * 1.6 - 0.8);
    }
    // wash
    const wl = biquad(noise('pink', n, seedOf(ctx.i, 'iwL'), { rms: 1 }), 'lp', 3600, 0.6), wr = biquad(noise('pink', n, seedOf(ctx.i, 'iwR'), { rms: 1 }), 'lp', 3600, 0.6);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const e = Math.min(1, t / 0.05) * Math.exp(-t / (P.tau * 1.6));
      L[i] += wl[i] * 0.16 * P.wash * e; R[i] += wr[i] * 0.16 * P.wash * e;
    }
    let pk = 0;
    for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
    const amp = (P.level * 0.9 * velAmp(v, 0.7)) / Math.max(pk, 1e-6);
    for (let i = 0; i < n; i++) { L[i] *= amp; R[i] *= amp; }
    fadeInArr(L, 6); fadeInArr(R, 6);
    releaseTail(L, n - ns(0.5), 0.5); releaseTail(R, n - ns(0.5), 0.5);
    return { L: dsp.dcBlock(L, 8), R: dsp.dcBlock(R, 8) };
  },
  defaults: {}, options: { size: "'S' | 'M' | 'L' (per note `size` or option; default from vel: >0.85 L, >0.5 M)" },
  reverb: { preset: 'bigHall', wet: 0.2 }, gainDb: 0, defaultDur: 0.5, test: { chord: false },
  testNotes: () => [{ t: 0.2, vel: 0.4, size: 'S' }, { t: 1.8, vel: 0.7, size: 'M' }, { t: 4.2, vel: 1, size: 'L' }],
});

// ---------------------------------------------------------------------------------------------------------------
// tape rewind
// ---------------------------------------------------------------------------------------------------------------
defineInstrument({
  id: 'tape_rewind', name: 'Tape rewind texture', kind: 'fx', family: 'fx',
  desc: 'A reel spinning up: swept whining band-passed noise, motor whine with FM wobble, a ticking splice train that accelerates, brown motor rumble; ends with a tape-stop pitch dive over the last 0.35 s (stop:false = no dive).',
  voice(ev, ctx) {
    const { rng, o } = ctx;
    const v = clamp(ev.vel, 0.05, 1.1);
    const dur = Math.max(0.6, ev.dur);
    const N = ns(dur);
    const stopT = (o.stop === false ? 0 : (o.stopTime != null ? o.stopTime : 0.35));
    const nSrc = N + ns(0.1);
    // 1. swept noise whirr
    const fc = expSweep(nSrc, 1500, 5600);
    const flick = dsp.lfo('smooth', 38, nSrc, { min: 0.55, max: 1, seed: Math.floor(rng() * 1e9) });
    const nz = svf(noise('white', nSrc, seedOf(ctx.i, 'trn'), { rms: 1 }), 'bp', fc, 3.2, { update: 4 });
    // 2. motor whine with FM wobble
    const whine = new Float32Array(nSrc);
    {
      const fa = expSweep(nSrc, 700, 3300);
      let ph = 0, pm = 0;
      for (let i = 0; i < nSrc; i++) {
        pm += (41 + 14 * (i / nSrc)) / SR;
        const f = fa[i] * (1 + 0.035 * Math.sin(TAU * pm));
        ph += f / SR; if (ph >= 1) ph -= 1;
        whine[i] = Math.sin(TAU * ph) + 0.35 * Math.sin(TAU * 2 * ph);
      }
    }
    // 3. splice ticks (accelerating)
    const ticks = new Float32Array(nSrc);
    {
      let t = 0.05;
      while (t < dur + 0.1) {
        const x = t / dur;
        const rate = 18 + 80 * x * x;
        t += (1 / rate) * (0.6 + 0.8 * rng());
        const i0 = Math.round(t * SR);
        const tn = ns(0.0016);
        const a = (0.3 + 0.7 * rng()) * (0.5 + 0.5 * x);
        for (let k = 0; k < tn && i0 + k < nSrc; k++) ticks[i0 + k] += (rng() * 2 - 1) * a * Math.exp(-k / (0.0004 * SR));
      }
    }
    const tk = biquad(ticks, 'hp', 2500, 0.7);
    const rum = biquad(noise('brown', nSrc, seedOf(ctx.i, 'trr'), { rms: 1 }), 'lp', 150, 0.7);
    const src = new Float32Array(nSrc);
    for (let i = 0; i < nSrc; i++) {
      const x = i / N;
      const e = Math.min(1, i / (0.25 * SR)) * (0.35 + 0.65 * pw(x, 0.6));
      src[i] = (nz[i] * 0.55 * flick[i] + whine[i] * 0.05 * pw(x, 0.8) + tk[i] * 0.9 + rum[i] * 0.12) * e;
    }
    // 4. stereo: two decorrelated passes (haas + allpass)
    let out;
    if (stopT > 0) {
      const spd = new Float32Array(N);
      const s0 = N - ns(stopT);
      for (let i = 0; i < N; i++) {
        const x = clamp((i - s0) / ns(stopT), 0, 1);
        spd[i] = 1 - 0.96 * x * x * (3 - 2 * x);
      }
      out = varispeed(src, spd, { n: N });
      for (let i = s0; i < N; i++) out[i] *= Math.pow(1 - (i - s0) / (N - s0), 1.5);
    } else {
      out = src.slice(0, N);
      fadeOutArr(out, ns(0.04));
    }
    out = dsp.highpass(out, 50, 4);
    const dec = dsp.decorrelate(out, { amount: 0.9, seed: Math.floor(rng() * 1e9) });
    dsp.fade(dec, 0, 0.03);
    const amp = 0.8 * velAmp(v, 0.9);
    for (let i = 0; i < N; i++) { dec.L[i] *= amp; dec.R[i] *= amp; }
    fadeInArr(dec.L, 32); fadeInArr(dec.R, 32);
    return { L: dec.L, R: dec.R };
  },
  defaults: {}, options: { stop: 'false = no tape-stop dive at the end', stopTime: 'dive length s (default 0.35)' },
  reverb: { preset: 'room', wet: 0.08 }, gainDb: 0, defaultDur: 4, test: { chord: false },
  testNotes: () => [{ t: 0.2, dur: 4, vel: 0.9 }],
});

// ---------------------------------------------------------------------------------------------------------------
// shimmer
// ---------------------------------------------------------------------------------------------------------------
defineInstrument({
  id: 'shimmer', name: 'Shimmer / granular pad', family: 'fx', kind: 'pitched',
  desc: 'Ethereal granular cloud: a soft additive pad on midi (default C5) smeared by a grain cloud pitched at +0/+12/+19/+24 (and -12) st, wide, slow bloom. Layer under the choir in the future sections.',
  voice(ev, ctx) {
    const { rng, o } = ctx;
    const v = clamp(ev.vel, 0.05, 1.1);
    const m = ev.midi, f0 = midiToHz(m);
    const dur = Math.max(1.0, ev.dur);
    const a = Math.min(o.attack != null ? o.attack : 1.4, dur * 0.6), rel = o.release != null ? o.release : 1.8;
    const n = ns(dur + rel);
    const lead = 0.3 * a;
    // base pad (mono, slowly beating partials)
    const baseLen = ns(Math.max(3, Math.min(dur, 6)));
    const base = new Float32Array(baseLen);
    [[1, 1, 0], [2, 0.5, 1], [3, 0.28, 2], [4, 0.22, 3], [6, 0.1, 4], [8, 0.05, 5]].forEach(([h, amp, k]) => {
      for (const d of [-2.5, 2.5]) addDamped(base, null, f0 * h * cents(d + rng() - 0.5), amp * 0.5, 1e4, rng() * 6);
    });
    const choices = [0, 12, 12, 19, 24, 7, -12];
    const gc = granularCloud(base, dur + rel, {
      grainMs: 150, density: 70, pos: [0.15, 0.85], posJitter: 0.25, spread: 0.95, seed: Math.floor(rng() * 1e9), gainDb: 4,
      pitch: (r) => choices[Math.floor(r() * choices.length)],
    });
    const L = new Float32Array(n), R = new Float32Array(n);
    const bs = ns(dur + rel);
    for (let i = 0; i < n; i++) {
      const bi = i % baseLen;
      const x = i < ns(a) ? 0.5 - 0.5 * Math.cos((Math.PI * i) / ns(a)) : 1;
      const e = i < ns(dur) ? x : x * (0.5 + 0.5 * Math.cos((Math.PI * (i - ns(dur))) / Math.max(1, bs - ns(dur))));
      L[i] = (base[bi] * 0.18 + gc.L[i] * 1.0) * e;
      R[i] = (base[bi] * 0.18 + gc.R[i] * 1.0) * e;
    }
    const hf = (c) => biquadChain(c, [{ type: 'hp', f: 180, q: 0.7 }, { type: 'highshelf', f: 5000, g: 2 }, { type: 'lp', f: 14000, q: 0.6 }]);
    const oL = hf(L), oR = hf(R);
    let pk = 0;
    for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(oL[i]), Math.abs(oR[i]));
    const amp = (0.34 * velAmp(v, 1.0) * (o.level || 1)) / Math.max(pk, 1e-6);
    for (let i = 0; i < n; i++) { oL[i] *= amp; oR[i] *= amp; }
    fadeInArr(oL, 64); fadeInArr(oR, 64);
    return { L: oL, R: oR, lead };
  },
  defaults: {}, options: { attack: 'bloom s (default 1.4)', release: 's (default 1.8)', level: 'x level' },
  reverb: { preset: 'cathedral', wet: 0.22 }, gainDb: 0, defaultMidi: 72, defaultDur: 4, range: [48, 96], test: { motifOct: 0, chordOct: 0 },
  testNotes: () => [{ t: 0, dur: 3.5, midi: 72, vel: 0.8 }, { t: 0, dur: 3.5, midi: 76, vel: 0.7 }, { t: 2, dur: 3.5, midi: 72, vel: 0.8 }, { t: 2, dur: 3.5, midi: 79, vel: 0.7 }],
});
