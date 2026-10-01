// =============================================================================
// instruments/strings.mjs - orchestral string SECTION.
//   id 'strings' + shortcuts strings_low / strings_high / strings_spiccato / strings_ostinato / strings_pizz / strings_tremolo
//   Each note = a unison stack of detuned band-limited saws, every voice with its own vibrato, drift and bow onset;
//   velocity-controlled low-pass (bowing pressure = brightness), bow noise, slow swell envelope; bus = body resonances
//   + string-machine ensemble for the lush wide sheen.
// =============================================================================
import { dsp, SR, defineInstrument, clamp, reg, ns, cents, vibrato, mixInto, velAmp, addDamped, expEnv, releaseTail, fadeInArr, TAU } from './common.mjs';
const { midiToHz, noise, osc, svf, biquad, biquadChain, mulberry32, seedOf, drift } = dsp;

const ART = {
  legato: { a: 0.2, rel: 0.42, voices: 5, det: 12, vibDepth: 7, vibDelay: 0.3, brightK: 1 },
  swell: { a: 0.62, rel: 0.5, voices: 5, det: 12, vibDepth: 8, vibDelay: 0.25, brightK: 1, swell: true },
  staccato: { a: 0.014, rel: 0.07, voices: 4, det: 9, vibDepth: 3, vibDelay: 0.6, brightK: 1.15, decayTau: 0.28, sustainFloor: 0.3, maxLen: 0.55 },
  spiccato: { a: 0.007, rel: 0.045, voices: 3, det: 8, vibDepth: 0, vibDelay: 1, brightK: 1.25, decayTau: 0.085, sustainFloor: 0.06, maxLen: 0.28 },
  ostinato: { a: 0.008, rel: 0.035, voices: 3, det: 9, vibDepth: 0, vibDelay: 1, brightK: 1.35, decayTau: 0.16, sustainFloor: 0.35, maxLen: 0.4 },
  tremolo: { a: 0.09, rel: 0.25, voices: 4, det: 11, vibDepth: 3, vibDelay: 0.4, brightK: 1.2, trem: 13 },
  pizz: { pizz: true },
};

function pizzVoice(ev, ctx) {
  const { rng, o } = ctx, m = ev.midi, v = clamp(ev.vel, 0.05, 1.1), f0 = midiToHz(m);
  const tau1 = reg(m, [[36, 0.7], [60, 0.38], [84, 0.16]]) * (o.sustain || 1);
  const n = ns(Math.min(ev.dur, 0.5) * 0.3 + tau1 * 4.5);
  const L = new Float32Array(n), R = new Float32Array(n);
  const pan = clamp((m - 60) / 50, -1, 1) * 0.3;
  const x0 = 0.12 + 0.06 * rng();
  for (let k = 1; k <= 18; k++) {
    const fk = f0 * k * Math.sqrt(1 + 4e-5 * k * k);
    if (fk > 9000) break;
    const a = (0.3 + 0.7 * Math.abs(Math.sin(Math.PI * k * x0))) / Math.pow(k, 1.2) / (1 + Math.pow(fk / (1800 + 3200 * v), 2));
    addDamped(L, R, fk * (1 + (rng() - 0.5) * 0.0008), a, tau1 / (1 + 0.32 * (k - 1)), rng() * 0.8, pan);
  }
  let pk = 0;
  for (let i = 0; i < Math.min(n, ns(0.06)); i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  const amp = (0.45 * velAmp(v, 1.2)) / Math.max(pk, 1e-6);
  for (let i = 0; i < n; i++) { L[i] *= amp; R[i] *= amp; }
  const tn = ns(0.01);
  const x = noise('white', tn, seedOf(ctx.i, 'pz'), { rms: 1 });
  const e = expEnv(tn, 0.002);
  for (let i = 0; i < tn; i++) x[i] *= e[i];
  const y = biquad(x, 'bp', 1800 + 600 * v, 0.8);
  for (let i = 0; i < tn; i++) { L[i] += y[i] * 0.07 * v * amp; R[i] += y[i] * 0.07 * v * amp; }
  fadeInArr(L, 8); fadeInArr(R, 8);
  releaseTail(L, ns(tau1 * 3), 0.3); releaseTail(R, ns(tau1 * 3), 0.3);
  return { L, R };
}

function stringsVoice(ev, ctx) {
  const { rng, o } = ctx;
  const art = ART[o.art] || ART.legato;
  if (art.pizz) return pizzVoice(ev, ctx);
  const m = ev.midi, v = clamp(ev.vel, 0.03, 1.1), f0 = midiToHz(m);
  const reg3 = o.section || (m < 50 ? 'low' : m < 69 ? 'mid' : 'high');
  const nV = o.voices || art.voices + (reg3 === 'low' ? 0 : 0);
  const longA = art.a * (1.35 - 0.55 * v) * (o.attackScale || 1);
  const dur = Math.min(ev.dur, art.maxLen ? art.maxLen * 1.6 : 1e9);
  const rel = art.rel * (o.releaseScale || 1);
  const bodyN = ns(Math.max(dur, longA * 0.8));
  const n = bodyN + ns(rel) + 8;
  const lead = art.swell || art.a >= 0.1 ? 0.3 * longA : 0;
  const L = new Float32Array(n), R = new Float32Array(n);
  const fc0 = clamp(f0 * (6 + 15 * Math.pow(v, 1.2)), 1500, 7600) * art.brightK * (o.brightScale || 1) * (reg3 === 'low' ? 0.85 : 1);
  const mono = new Float32Array(n);
  for (let k = 0; k < nV; k++) {
    const pos = nV === 1 ? 0 : (k / (nV - 1)) * 2 - 1;
    const det = pos * art.det * (o.detuneScale || 1) + (rng() - 0.5) * 3;
    const delay = Math.round(rng() * 0.022 * SR); // bow onset scatter
    const vib = art.vibDepth > 0 ? vibrato(n, { rate: 4.9 + 1.3 * rng(), cents: art.vibDepth * (o.vibScale != null ? o.vibScale : 1) * (0.7 + 0.6 * rng()), delay: art.vibDelay * (0.6 + 0.8 * rng()), fade: 0.5, rng }) : null;
    const dr = drift(n, 0.35 + 0.4 * rng(), 0.0009, Math.floor(rng() * 1e9)); // +-1.5 cent wander
    const base = (f0 * cents(det)) ;
    const fa = new Float32Array(n);
    for (let i = 0; i < n; i++) fa[i] = base * (vib ? vib[i] : 1) * (1 + dr[i]);
    const s = osc('saw', fa, n, { phase: rng() });
    let tr = null;
    if (art.trem) {
      tr = new Float32Array(n);
      const r = art.trem * (0.85 + 0.3 * rng());
      let ph = rng();
      for (let i = 0; i < n; i++) { tr[i] = 0.25 + 0.75 * Math.abs(Math.sin(Math.PI * ph)); ph += r / (2 * SR); }
    }
    const [gl, gr] = [Math.cos(((pos * 0.85 + 1) * Math.PI) / 4) * Math.SQRT2, Math.sin(((pos * 0.85 + 1) * Math.PI) / 4) * Math.SQRT2];
    const g = 1 / Math.sqrt(nV);
    for (let i = 0, j = delay; j < n; i++, j++) {
      const q = s[i] * g * (tr ? tr[j] : 1);
      L[j] += q * gl; R[j] += q * gr; mono[j] += q;
    }
  }
  // envelope
  const env = new Float32Array(n);
  const aN = Math.max(2, ns(longA));
  const relN = ns(rel);
  if (art.decayTau) {
    const k = Math.exp(-1 / (art.decayTau * SR));
    let g = 1;
    for (let i = 0; i < n; i++) {
      const a = i < aN ? 0.5 - 0.5 * Math.cos((Math.PI * i) / aN) : 1;
      env[i] = a * (art.sustainFloor + (1 - art.sustainFloor) * g);
      g *= k;
    }
  } else if (art.swell) {
    for (let i = 0; i < n; i++) { const x = Math.min(1, i / (bodyN * 0.92)); env[i] = 0.08 + 0.92 * x * x * (3 - 2 * x * 0.6); }
  } else {
    const wob = drift(n, 0.5, 0.08, Math.floor(rng() * 1e9));
    for (let i = 0; i < n; i++) {
      const a = i < aN ? 0.5 - 0.5 * Math.cos((Math.PI * i) / aN) : 1;
      env[i] = a * (1 + wob[i]);
    }
  }
  const from = bodyN;
  for (let i = from; i < n; i++) env[i] *= 0.5 + 0.5 * Math.cos((Math.PI * (i - from)) / Math.max(1, n - from));
  // bright-follows-loudness low-pass (cutoff tracks the envelope), applied per channel
  const fcArr = new Float32Array(n);
  for (let i = 0; i < n; i++) fcArr[i] = fc0 * (0.38 + 0.62 * env[i]);
  const fL = svf(L, 'lp', fcArr, 0.72, { update: 8 }), fR = svf(R, 'lp', fcArr, 0.72, { update: 8 });
  // bow noise: bright rosin hiss, strongest at the bow change
  const nz = noise('pink', n, seedOf(ctx.i, 'bow', m), { rms: 1 });
  const nzf = biquad(biquad(nz, 'hp', 1800, 0.7), 'lp', 7500, 0.7);
  const bowLvl = 0.018 * (0.5 + v);
  const bump = expEnv(n, 0.06);
  const amp = (0.34 * velAmp(v, 1.1)) * (reg3 === 'low' ? 1.1 : 1);
  for (let i = 0; i < n; i++) {
    const nzv = nzf[i] * bowLvl * (0.25 + 1.2 * bump[i]) * Math.min(1, env[i] * 4);
    fL[i] = (fL[i] * env[i] + nzv) * amp;
    fR[i] = (fR[i] * env[i] + nzv * 0.9) * amp;
  }
  fadeInArr(fL, 12); fadeInArr(fR, 12);
  return { L: fL, R: fR, lead };
}

function stringsBus(seg, ctx) {
  const o = ctx.o;
  let y = biquadChain(seg, [
    { type: 'hp', f: 55, q: 0.7 },
    { type: 'peak', f: 290, q: 0.9, g: 1.5 },
    { type: 'peak', f: 2800, q: 0.9, g: 2.2 },
    { type: 'highshelf', f: 9000, g: -3 },
  ]);
  const art = ART[o.art] || ART.legato;
  if (!art.pizz && (o.ensemble == null ? 0.42 : o.ensemble) > 0) {
    const long = !art.maxLen;
    y = dsp.ensemble(y, { voices: long ? 5 : 3, mix: (o.ensemble != null ? o.ensemble : long ? 0.42 : 0.28), depthMs: 2.6, delayMs: 15, seed: 3 });
  }
  return y;
}

const STR_OPTS = {
  art: "'legato' (default, slow bow) | 'swell' (crescendo to the note end) | 'staccato' | 'spiccato' | 'ostinato' (tight 16ths) | 'tremolo' | 'pizz'",
  section: "'low' (cellos/basses) | 'mid' | 'high' (violins); default from the note's pitch",
  voices: 'players per note (default 3-5 by articulation)', ensemble: 'string-machine chorus amount 0..1 (default 0.42 legato)',
  brightScale: 'x filter brightness', vibScale: 'x vibrato depth', attackScale: 'x attack time', releaseScale: 'x release time', detuneScale: 'x unison detune',
};
function mk(id, name, desc, defaults, test = {}) {
  defineInstrument({
    id, name, family: 'strings', desc, voice: stringsVoice, bus: stringsBus, busTail: 0.1,
    defaults, options: STR_OPTS, reverb: { preset: 'hall', wet: 0.28 }, gainDb: 0, range: [28, 100], defaultMidi: 60, defaultDur: 1, test,
  });
}
mk('strings', 'String section', 'Lush legato string ensemble (violins/violas/cellos by register). Slow attack, vibrato, ensemble chorus; articulations via art.', { art: 'legato' });
mk('strings_low', 'Cellos & basses', 'Warm dark low string section (legato).', { art: 'legato', section: 'low', brightScale: 0.85 }, { motifOct: -1, chordOct: -1 });
mk('strings_high', 'Violins (high)', 'Bright high violins, a touch more vibrato.', { art: 'legato', section: 'high', vibScale: 1.15 }, { motifOct: 1, chordOct: 1 });
mk('strings_spiccato', 'Strings spiccato', 'Short bouncing bows (use for light 8ths / 16ths).', { art: 'spiccato' });
mk('strings_staccato', 'Strings staccato', 'Detached marcato bows with a short body.', { art: 'staccato' });
mk('strings_ostinato', 'Strings 16th ostinato', 'Tight driving 16th-note ostinato (send 16th notes of dur ~0.11 s).', { art: 'ostinato' });
mk('strings_tremolo', 'Strings tremolo', 'Measured bow tremolo for tension beds.', { art: 'tremolo' });
mk('strings_pizz', 'Strings pizzicato', 'Plucked string section (modal partials + fingernail snap).', { art: 'pizz' });
