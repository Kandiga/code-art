// Renders demo signals + spectrogram/waveform PNGs into audio/build/tmp/libtest/gallery for visual QA.
// Run: node audio/lib/test/render_gallery.mjs   then open the PNGs (Read tool / image viewer).
import path from 'node:path';
import * as dsp from '../dsp.mjs';
import { spectrogramPng, wavePng } from '../ff.mjs';
import { OUTDIR } from './harness.mjs';

const { SR, Buf } = dsp;
const G = dsp.ensureDir(path.join(OUTDIR, 'gallery'));
const png = (name, buf, o = {}) => { spectrogramPng(buf, path.join(G, name + '.png'), { w: 1300, h: 520, ...o }); console.log('  ->', name + '.png'); };
const wav = (name, buf, o = {}) => { wavePng(buf, path.join(G, name + '_wave.png'), { w: 1300, h: 240, ...o }); };
const mono2 = (x) => Buf.from(x, Float32Array.from(x));
const which = process.argv.slice(2);
const want = (k) => !which.length || which.includes(k);

if (want('osc')) {
  const n = 4 * SR, f = dsp.glide(110, 9000, n, 'exp');
  const parts = ['saw', 'square', 'tri', 'sine'].map((t) => dsp.osc(t, f, n).map((v) => v * 0.4));
  const cat = new Float32Array(16 * SR);
  parts.forEach((p, i) => cat.set(p, i * n));
  png('osc_sweeps_saw_square_tri_sine', mono2(cat), { h: 560 });
}
if (want('noise')) {
  const cat = new Float32Array(9 * SR);
  ['white', 'pink', 'brown'].forEach((t, i) => cat.set(dsp.noise(t, 3 * SR, 1), i * 3 * SR));
  png('noise_white_pink_brown', mono2(cat));
}
if (want('filter')) {
  const n = 4 * SR, src = dsp.osc('saw', 110, n).map((v) => v * 0.4), sweep = dsp.curve(n, [[0, 120], [3.5, 12000]], 'exp');
  const cat = new Float32Array(12 * SR);
  cat.set(dsp.biquad(src, 'lp', sweep, 6), 0); cat.set(dsp.svf(src, 'lp', sweep, 6), n); cat.set(dsp.ladder(src, sweep, 0.85), 2 * n);
  png('filter_sweeps_biquad_svf_ladder', mono2(cat));
}
if (want('verb')) {
  // a short pitched blip + a click, then every reverb
  const dry = new Float32Array(8 * SR);
  const blip = dsp.osc('tri', 440, 0.25 * SR).map((v, i) => v * Math.exp(-i / (0.06 * SR)) * 0.6);
  dry.set(blip, 0.2 * SR);
  dry[Math.round(0.9 * SR)] = 0.8;
  const noiseBurst = dsp.noise('pink', 0.15 * SR, 3, { rms: 0.4 }).map((v, i) => v * Math.exp(-i / (0.02 * SR)));
  dry.set(noiseBurst, 1.4 * SR);
  for (const p of Object.keys(dsp.REVERB_PRESETS)) {
    const o = dsp.applyReverb(mono2(dry), p, { wet: 1, wetOnly: p === 'phone' ? false : true, tail: 0 });
    png('verb_' + p, o, { h: 420 });
    wav('verb_' + p, o);
  }
}
if (want('formant')) {
  const n = 6 * SR;
  const vib = dsp.osc('sine', 5.2, n).map((v) => v * 4);
  const f0 = new Float32Array(n); for (let i = 0; i < n; i++) f0[i] = 220 * Math.pow(2, vib[i] / 1200);
  const src = dsp.osc('saw', f0, n).map((v) => v * 0.4);
  const mix = dsp.curve(n, [[0, 0], [2, 0], [4, 1], [6, 1]], 'smooth');
  const o = dsp.formant(src, 'o', { voice: 'soprano', to: 'a', morph: mix });
  png('formant_ooh_to_aah', mono2(o));
}
if (want('chorus')) {
  const n = 5 * SR, chord = Buf.from(new Float32Array(n), new Float32Array(n));
  for (const m of [57, 60, 64]) { const o = dsp.osc('saw', dsp.midiToHz(m), n).map((v) => v * 0.15); dsp.addAt(chord, o, 0, 0, 0); }
  const en = dsp.ensemble(chord, { voices: 6 });
  png('ensemble_mode_separate', en, { mode: 'separate', h: 560 });
  const un = dsp.unison('saw', dsp.midiToHz(57), n, { voices: 7, detuneCents: 18 });
  png('unison_saw_A3', Buf.from(un.L, un.R), { mode: 'separate', h: 560, start: 0, dur: 3 });
}
if (want('limiter')) {
  const n = 6 * SR, x = dsp.noise('pink', n, 5, { rms: 0.35 }), b = Buf.from(x, dsp.noise('pink', n, 6, { rms: 0.35 }));
  for (let i = 0; i < n; i += 23_000) b.L[i] *= 3;
  const l = dsp.limiter(b, { ceilingDb: -1.5 });
  wav('limiter_before', b, { h: 220 }); wav('limiter_after', l, { h: 220 });
}
console.log('gallery in', G);
