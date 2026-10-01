// =============================================================================
// instruments/choir.mjs - wordless formant choir ('ooh' / 'aah' ...), SATB by register.
//   source: per-singer detuned saw with vibrato / drift / onset scatter + breath noise
//   -> constant formant banks (dsp.VOWELS tables: bass/tenor/alto/soprano), optional vowel morph (e.g. 'u>a')
//   -> slow attack, slow release, wide ensemble bus.
// =============================================================================
import { dsp, SR, defineInstrument, clamp, reg, ns, cents, vibrato, velAmp, fadeInArr, TAU } from './common.mjs';
const { midiToHz, noise, osc, biquad, seedOf, drift, VOWELS, dbToLin } = dsp;

function bank(x, voice, vowel, shift = 1, qk = 1) {
  const tab = VOWELS[voice][vowel];
  const n = x.length, out = new Float32Array(n);
  for (const F of tab) {
    const f = F.f * shift;
    if (f > 12000) continue;
    const y = biquad(x, 'bp', f, Math.max(0.8, (f / F.b) * qk));
    const g = dbToLin(F.g);
    for (let i = 0; i < n; i++) out[i] += y[i] * g;
  }
  return out;
}
const voiceOf = (m) => (m < 50 ? 'bass' : m < 60 ? 'tenor' : m < 71 ? 'alto' : 'soprano');
const VOWEL_GAIN = { u: 1.35, o: 1.0, a: 0.8, e: 0.9, i: 1.0 };

function choirVoice(ev, ctx) {
  const { rng, o } = ctx;
  const m = ev.midi, v = clamp(ev.vel, 0.03, 1.1), f0 = midiToHz(m);
  const voice = o.voice || voiceOf(m);
  const [vA, vB] = String(o.vowel || 'o').split('>');
  const morphTo = vB && VOWELS[voice][vB] ? vB : null;
  const nS = o.singers || 4;
  const a = (o.attack != null ? o.attack : 0.5) * (1.35 - 0.6 * v);
  const rel = o.release != null ? o.release : 0.55;
  const bodyN = ns(Math.max(ev.dur, a));
  const n = bodyN + ns(rel) + 8;
  const lead = 0.3 * a;
  const aN = Math.max(2, ns(a));
  const srcL = new Float32Array(n), srcR = new Float32Array(n);
  const shift = voice === 'soprano' ? 1.05 : voice === 'bass' ? 0.95 : 1;
  for (let k = 0; k < nS; k++) {
    const pos = nS === 1 ? 0 : (k / (nS - 1)) * 2 - 1;
    const det = (rng() - 0.5) * 2 * 11;
    const delay = Math.round(rng() * 0.03 * SR);
    const vib = vibrato(n, { rate: 5.0 + 0.9 * rng(), cents: 17 * (o.vibScale != null ? o.vibScale : 1) * (0.7 + 0.6 * rng()), delay: 0.35 + 0.35 * rng(), fade: 0.6, rng });
    const dr = drift(n, 0.6, 0.0016, Math.floor(rng() * 1e9));
    const fa = new Float32Array(n);
    const base = f0 * cents(det);
    for (let i = 0; i < n; i++) fa[i] = base * vib[i] * (1 + dr[i]);
    const s = osc('saw', fa, n, { phase: rng() });
    const g = 1 / Math.sqrt(nS);
    const side = pos < 0 ? srcL : srcR;
    const xs = 0.35 * (1 - Math.abs(pos));
    for (let i = 0, j = delay; j < n; i++, j++) {
      const q = s[i] * g;
      side[j] += q;
      (pos < 0 ? srcR : srcL)[j] += q * xs;
    }
  }
  // breath noise (shaped by the same formants, strongest at the onset)
  const nzL = noise('pink', n, seedOf(ctx.i, 'chL', m), { rms: 1 }), nzR = noise('pink', n, seedOf(ctx.i, 'chR', m), { rms: 1 });
  const breath = 0.16 * (o.breath != null ? o.breath : 1);
  const bEnv = new Float32Array(n);
  for (let i = 0; i < n; i++) bEnv[i] = 0.4 + 1.2 * Math.exp(-i / (0.25 * SR));
  for (let i = 0; i < n; i++) { srcL[i] += nzL[i] * breath * bEnv[i]; srcR[i] += nzR[i] * breath * bEnv[i]; }
  let L = bank(srcL, voice, vA, shift), R = bank(srcR, voice, vA, shift);
  if (morphTo) {
    const L2 = bank(srcL, voice, morphTo, shift), R2 = bank(srcR, voice, morphTo, shift);
    const m0 = (o.morphStart != null ? o.morphStart : 0.2) * (ev.dur + a), m1 = (o.morphEnd != null ? o.morphEnd : 0.75) * (ev.dur + a);
    const g1 = VOWEL_GAIN[vB] / VOWEL_GAIN[vA];
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const x = clamp((t - m0) / Math.max(1e-3, m1 - m0), 0, 1);
      const w = x * x * (3 - 2 * x);
      L[i] = L[i] * (1 - w) + L2[i] * w * g1; R[i] = R[i] * (1 - w) + R2[i] * w * g1;
    }
  }
  // envelope: slow swell, gentle breathing, long release
  const wob = drift(n, 0.45, 0.07, Math.floor(rng() * 1e9));
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const e = i < aN ? 0.5 - 0.5 * Math.cos((Math.PI * i) / aN) : 1;
    env[i] = e * (1 + wob[i]);
  }
  for (let i = bodyN; i < n; i++) env[i] *= 0.5 + 0.5 * Math.cos((Math.PI * (i - bodyN)) / Math.max(1, n - bodyN));
  // equalise loudness across vowels / registers: RMS over the body -> fixed target
  let e2 = 0, cnt = 0;
  const i0 = Math.floor(bodyN * 0.3), i1 = Math.max(i0 + 1, Math.floor(bodyN * 0.9));
  for (let i = i0; i < i1; i++) { e2 += L[i] * L[i] + R[i] * R[i]; cnt += 2; }
  const rms = Math.sqrt(e2 / Math.max(1, cnt)) || 1;
  const amp = (0.085 * velAmp(v, 1.0)) / rms * (o.gain != null ? o.gain : 1);
  for (let i = 0; i < n; i++) { L[i] *= env[i] * amp; R[i] *= env[i] * amp; }
  fadeInArr(L, 20); fadeInArr(R, 20);
  return { L, R, lead };
}

defineInstrument({
  id: 'choir', name: 'Wordless choir (ooh / aah)', family: 'choir',
  desc: 'SATB-by-register formant choir with breath, slow swell, vibrato, singer detune/scatter and a wide ensemble bus. Morph vowels with vowel:"u>a".',
  voice: choirVoice,
  bus: (seg, ctx) => {
    let y = dsp.ensemble(seg, { voices: 5, mix: ctx.o.ensemble != null ? ctx.o.ensemble : 0.38, depthMs: 3.2, delayMs: 20, seed: 11 });
    y = dsp.biquadChain(y, [{ type: 'peak', f: 3000, q: 0.8, g: 1.5 }, { type: 'highshelf', f: 7000, g: 1.5 }, { type: 'hp', f: 70, q: 0.7 }]);
    return dsp.widen(y, ctx.o.width != null ? ctx.o.width : 1.25, { bassMonoHz: 180 });
  },
  busTail: 0.15,
  defaults: { vowel: 'o', singers: 4 },
  options: {
    vowel: "'o' (ooh, default) | 'a' (aah) | 'u' | 'e' | 'i' | morph 'o>a' (ooh to aah across the note)", voice: "'bass'|'tenor'|'alto'|'soprano' (default by pitch)",
    singers: 'voices per part (default 4; 8 = big choir)', attack: 'swell time (s, default 0.5)', release: 'release (s, default 0.55)', breath: 'x breath noise',
    ensemble: 'chorus amount', width: 'stereo width (default 1.25)', vibScale: 'x vibrato', morphStart: '0..1 where the vowel morph begins', morphEnd: '0..1 where it ends',
  },
  reverb: { preset: 'cathedral', wet: 0.3 },
  gainDb: 0, range: [38, 84], defaultMidi: 64, defaultDur: 2, test: { motifOct: 0, chordOct: 0 },
});
