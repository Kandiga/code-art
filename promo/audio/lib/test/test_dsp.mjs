// Numeric tests for the DSP foundation (dsp.mjs). Run: node audio/lib/test/test_dsp.mjs
import fs from 'node:fs';
import path from 'node:path';
import * as dsp from '../dsp.mjs';
import { measure, truePeak, peakDb, rmsDb } from '../meter.mjs';
import { run } from '../ff.mjs';
import { check, section, summary, timeIt, f1, OUTDIR } from './harness.mjs';

const { SR, Buf, Float32Array: _ } = { ...dsp, Float32Array };
const dbl = dsp.dbToLin;
const db = (v) => 20 * Math.log10(Math.max(v, 1e-12));
const rms = (x, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); };
const peakHz = (x, N = 32768, start = 0) => { const m = dsp.magSpectrum(x, N, start); let k = 1; for (let i = 1; i < m.length; i++) if (m[i] > m[k]) k = i; return (k * SR) / N; };
const bandDb = (x, lo, hi, N = 16384, start = 0) => { const m = dsp.magSpectrum(x, N, start); let e = 0; for (let k = Math.floor((lo * N) / SR); k <= Math.ceil((hi * N) / SR); k++) e += m[k] * m[k]; return 10 * Math.log10(e + 1e-30); };

// ---------------------------------------------------------------------------
section('core: Buf, addAt, pan, fade, normalize, helpers');
{
  const b = new Buf(1);
  check('Buf default length/seconds', new Buf().seconds === 60 && b.length === SR && b.L.length === b.R.length);
  const imp = new Float32Array(10).fill(1);
  dsp.addAt(b, imp, 0.5, 0, 0);
  check('addAt mono centre = -3.01 dB per side', Math.abs(b.L[SR / 2] - Math.SQRT1_2) < 1e-6 && Math.abs(b.R[SR / 2] - Math.SQRT1_2) < 1e-6);
  const b2 = new Buf(1);
  dsp.addAt(b2, imp, 0, 0, -1); dsp.addAt(b2, imp, 0.1, 0, 1);
  check('hard pan L/R', b2.L[0] > 0.999 && b2.R[0] < 1e-6 && b2.R[Math.round(0.1 * SR)] > 0.999 && b2.L[Math.round(0.1 * SR)] < 1e-6);
  const st = Buf.from(new Float32Array(10).fill(0.5), new Float32Array(10).fill(0.25));
  const b3 = new Buf(1); dsp.addAt(b3, st, 0.2, -6.0206, 0);
  check('addAt stereo Buf: unity centre + gain', Math.abs(b3.L[0.2 * SR] - 0.25) < 1e-4 && Math.abs(b3.R[0.2 * SR] - 0.125) < 1e-4);
  dsp.addAt(b3, imp, -0.0001, 0, 0); // negative start: clips
  dsp.addAt(b3, imp, 0.99999, 0, 0); // runs off the end
  check('addAt clips negative start and tail overrun without throwing', true);
  const sum = dsp.sumBufs([b, b2]);
  check('sumBufs', sum.length === SR);
  const f = new Float32Array(1000).fill(1);
  dsp.fade(f, 0.005, 0.005);
  check('fade in/out reaches 0 at ends, 1 in the middle', f[0] === 0 && f[999] < 0.02 && f[500] === 1);
  const n = Buf.from(Float32Array.of(0.1, -0.5, 0.25), Float32Array.of(0.2, 0.3, -0.1));
  const g = dsp.normalizePeak(n, -6);
  check('normalizePeak to -6 dBFS', Math.abs(dsp.peakOf(n) - dbl(-6)) < 1e-6 && Math.abs(g - (-6 - db(0.5))) < 1e-6);
  const c = new Float32Array(480).fill(1);
  dsp.cutAt(c, 0.005, 0.001);
  check('cutAt: hard zero from t on', c[239] > 0 && c[240] === 0 && c[479] === 0);
  check('noteToMidi/midiToHz', dsp.noteToMidi('A4') === 69 && dsp.noteToMidi('C5') === 72 && dsp.noteToMidi('E4') === 64 && Math.abs(dsp.midiToHz(69) - 440) < 1e-9 && dsp.noteToMidi('Bb2') === 46 && dsp.midiToNote(60) === 'C4');
  check('sec/samples/dB', dsp.sec(48000) === 1 && dsp.samples(0.5) === 24000 && Math.abs(dsp.dbToLin(-6.0206) - 0.5) < 1e-4 && Math.abs(dsp.linToDb(0.5) + 6.0206) < 1e-3);
  const r1 = dsp.mulberry32(42), r2 = dsp.mulberry32(42);
  const a1 = [r1(), r1(), r1()], a2 = [r2(), r2(), r2()];
  check('mulberry32 deterministic + hashString stable', a1.join() === a2.join() && dsp.hashString('amrita') === dsp.hashString('amrita') && dsp.hashString('a') !== dsp.hashString('b'));
  check('lerp/smoothstep', dsp.lerp(2, 4, 0.5) === 3 && dsp.smoothstep(0, 1, 0.5) === 0.5 && dsp.smoothstep(0, 1, -1) === 0 && dsp.smoothstep(0, 1, 2) === 1);
  const rg = dsp.mulberry32(1); let m = 0, s2 = 0; const K = 20000; for (let i = 0; i < K; i++) { const v = rg.gauss(); m += v; s2 += v * v; }
  check('rng.gauss mean~0 var~1', Math.abs(m / K) < 0.03 && Math.abs(s2 / K - 1) < 0.05);
}

// ---------------------------------------------------------------------------
section('WAV I/O');
{
  const n = SR;
  const L = dsp.osc('sine', 440, n).map((v) => v * 0.5), R = dsp.osc('sine', 660, n).map((v) => v * 0.25);
  const b = Buf.from(L, R);
  for (const bits of [32, 24, 16]) {
    const p = path.join(OUTDIR, `rt${bits}.wav`);
    dsp.writeWav(p, b, { bits });
    const r = dsp.readWav(p);
    let e = 0; for (let i = 0; i < n; i++) e = Math.max(e, Math.abs(r.L[i] - L[i]), Math.abs(r.R[i] - R[i]));
    check(`roundtrip ${bits}-bit`, r.length === n && e < (bits === 32 ? 1e-9 : bits === 24 ? 3e-6 : 6e-4), `maxerr ${e.toExponential(1)}`);
  }
  const p32 = path.join(OUTDIR, 'rt32.wav');
  const probeOut = run(['-i', p32, '-f', 'null', '-'], { loglevel: 'error' });
  check('ffmpeg reads our 32-bit float wav', probeOut.stderr.trim() === '');
  // mono file at 44.1k -> readWav resamples to 48k stereo
  const p441 = path.join(OUTDIR, 'mono441.wav');
  run(['-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=44100:duration=2', '-ac', '1', '-c:a', 'pcm_s16le', p441]);
  const r = dsp.readWav(p441);
  check('readWav mono 44.1k 16-bit -> 48k stereo, length ok', Math.abs(r.length - 96000) <= 2 && r.srcRate === 44100 && r.srcChannels === 1, `len ${r.length}`);
  check('readWav resample keeps pitch (1 kHz) and level', Math.abs(peakHz(r.L, 16384, 20000) - 1000) < 8 && Math.abs(db(rms(r.L, 5000, 90000)) - db(Math.SQRT1_2 * 0.125)) < 0.3, `${f1(peakHz(r.L, 16384, 20000))} Hz`);
  const p24 = path.join(OUTDIR, 'st96.wav');
  run(['-f', 'lavfi', '-i', 'sine=frequency=2000:sample_rate=96000:duration=1', '-ac', '2', '-c:a', 'pcm_s24le', p24]);
  const r2 = dsp.readWav(p24);
  check('readWav 96k/24-bit stereo -> 48k', Math.abs(r2.length - 48000) <= 2 && Math.abs(peakHz(r2.R, 16384, 10000) - 2000) < 8);
  for (const f of fs.readdirSync(OUTDIR)) if (/\.wav$/.test(f)) fs.rmSync(path.join(OUTDIR, f));
}

// ---------------------------------------------------------------------------
section('oscillators + noise');
{
  for (const [type, f] of [['sine', 440], ['saw', 440], ['square', 440], ['tri', 440], ['pulse', 440]]) {
    const x = dsp.osc(type, f, SR, { width: 0.25 });
    let zc = 0; for (let i = 1; i < SR; i++) if (x[i - 1] < 0 && x[i] >= 0) zc++;
    check(`osc ${type} pitch 440 Hz (rising zero crossings)`, Math.abs(zc - 440) <= 1, `${zc}`);
  }
  // aliasing: saw at 5 kHz (harmonics 5k,10k,15k,20k alias back): measure energy in inter-harmonic gaps
  const x = dsp.osc('saw', 5001, SR);
  const fund = bandDb(x, 4900, 5100), gap = bandDb(x, 6200, 6800);
  check('polyBLEP saw @5 kHz: alias gap >= 55 dB below fundamental', fund - gap > 55, `${f1(fund - gap, 1)} dB`);
  const x2 = dsp.osc('square', 3001, SR), g2 = bandDb(x2, 4000, 5000) - bandDb(x2, 2900, 3100);
  check('polyBLEP square @3 kHz: alias gap <= -55 dB', g2 < -55, `${f1(g2, 1)} dB`);
  const pm = dsp.osc('pulse', 220, SR, { width: dsp.curve(SR, [[0, 0.1], [1, 0.5]]) });
  let mean = 0; for (const v of pm) mean += v; check('pulse (PWM) is DC-centred', Math.abs(mean / SR) < 0.02, f1(mean / SR, 4));
  const gl = dsp.osc('sine', dsp.glide(200, 800, SR, 'exp'), SR);
  check('osc accepts per-sample freq (glide)', gl.every(Number.isFinite) && peakHz(gl, 4096, 0) < 400 && peakHz(gl, 4096, SR - 4096) > 600);
  const n1 = dsp.noise('white', 4 * SR, 1), n1b = dsp.noise('white', 4 * SR, 1), n2 = dsp.noise('white', 4 * SR, 2);
  check('noise deterministic per seed, differs across seeds', n1[1000] === n1b[1000] && n1[1000] !== n2[1000]);
  for (const t of ['white', 'pink', 'brown', 'gauss']) check(`noise ${t} RMS = 0.3`, Math.abs(rms(dsp.noise(t, 2 * SR, 5)) - 0.3) < 0.02);
  // spectral slopes: energy per octave band relative to white
  const slope = (type) => { const x = dsp.noise(type, 4 * SR, 3); return bandDb(x, 3000, 6000, 32768) - bandDb(x, 375, 750, 32768); };
  const sw = slope('white'), sp = slope('pink'), sb = slope('brown');
  check('white: flat per-octave... (3 octave diff within 3 dB of +9)', Math.abs(sw - 9.03) < 3, `${f1(sw)}`);
  check('pink: -3 dB/oct => octave energies equal', Math.abs(sp - 0) < 2, `${f1(sp)} dB (3 oct apart) vs white ${f1(sw)}`);
  check('brown: ~ -6 dB/oct (3 octaves => ~ -9 dB vs pink 0)', sb - sp < -6.5 && sb - sp > -12, `${f1(sb - sp)}`);
}

// ---------------------------------------------------------------------------
section('envelopes + curves');
{
  const e = dsp.adsr(SR, { a: 0.1, d: 0.2, s: 0.5, r: 0.3 });
  check('adsr: starts 0, peaks 1 at attack end, sustains 0.5, ends 0', e[0] === 0 && Math.abs(e[4800] - 1) < 0.01 && Math.abs(e[24000] - 0.5) < 0.01 && e[SR - 1] < 0.01);
  check('adsr: monotone release', (() => { for (let i = SR - 14400; i < SR - 1; i++) if (e[i + 1] > e[i] + 1e-6) return false; return true; })());
  const x = dsp.expDecay(SR, 0.1);
  check('expDecay: -8.686 dB per tau', Math.abs(x[4800] - Math.exp(-1)) < 1e-4);
  const c = dsp.curve(SR, [[0, 0], [0.5, 1], [1, 0]]);
  check('curve lin', Math.abs(c[SR / 4] - 0.5) < 1e-3 && Math.abs(c[SR / 2] - 1) < 1e-3);
  const ce = dsp.curve(SR, [[0, 100], [1, 1000]], 'exp');
  check('curve exp (geometric)', Math.abs(ce[SR / 2] - Math.sqrt(100 * 1000)) < 0.5);
  const re = dsp.regionEnv(10 * SR, [[2, 3]], { attack: 0.05, release: 0.2 });
  check('regionEnv: 0 outside, ~1 inside, smooth', re[SR] === 0 && re[Math.round(2.5 * SR)] > 0.99 && re[Math.round(3.5 * SR)] < 0.1);
}

// ---------------------------------------------------------------------------
section('filters');
{
  const gain = (fn, fq) => { const x = dsp.osc('sine', fq, SR); const y = fn(x); return db(rms(y, SR / 2, SR) / rms(x, SR / 2, SR)); };
  check('biquad lp: -3 dB @fc (Q .707), -12 dB/oct', Math.abs(gain((x) => dsp.biquad(x, 'lp', 1000, Math.SQRT1_2), 1000) + 3.01) < 0.1 && Math.abs(gain((x) => dsp.biquad(x, 'lp', 1000), 4000) + 24) < 1);
  check('biquad hp: -3 dB @fc', Math.abs(gain((x) => dsp.biquad(x, 'hp', 1000), 1000) + 3.01) < 0.1);
  check('biquad bp: 0 dB at centre, attenuates away', Math.abs(gain((x) => dsp.biquad(x, 'bp', 1000, 4), 1000)) < 0.1 && gain((x) => dsp.biquad(x, 'bp', 1000, 4), 250) < -10);
  check('biquad notch: deep null', gain((x) => dsp.biquad(x, 'notch', 1000, 5), 1000) < -40);
  check('biquad peak +6 dB, lowshelf +6, highshelf +6', Math.abs(gain((x) => dsp.biquad(x, 'peak', 1000, 1, 6), 1000) - 6) < 0.1 && Math.abs(gain((x) => dsp.biquad(x, 'lowshelf', 500, 0.7, 6), 50) - 6) < 0.2 && Math.abs(gain((x) => dsp.biquad(x, 'highshelf', 4000, 0.7, 6), 16000) - 6) < 0.2);
  check('biquad allpass: flat magnitude', Math.abs(gain((x) => dsp.biquad(x, 'allpass', 1000, 1), 700)) < 0.05);
  check('svf lp/hp/bp/notch behave', Math.abs(gain((x) => dsp.svf(x, 'lp', 1000, Math.SQRT1_2), 1000) + 3.01) < 0.15 && Math.abs(gain((x) => dsp.svf(x, 'bp', 1000, 3), 1000)) < 0.1 && gain((x) => dsp.svf(x, 'notch', 1000, 3), 1000) < -40);
  check('butter order 4 / 3 slopes', Math.abs(gain((x) => dsp.butter(x, 'lp', 1000, 4), 2000) + 24.1) < 0.5 && Math.abs(gain((x) => dsp.butter(x, 'lp', 1000, 3), 1000) + 3.0) < 0.2);
  check('onepole lp/hp at fc ~ -3 dB', Math.abs(gain((x) => dsp.onepole(x, 'lp', 1000), 1000) + 3) < 0.6 && Math.abs(gain((x) => dsp.onepole(x, 'hp', 1000), 1000) + 3) < 0.6);
  const dc = new Float32Array(SR).fill(0.3);
  check('dcBlock removes DC', Math.abs(dsp.dcBlock(dc)[SR - 1]) < 1e-3);
  // modulated filters stay finite + bounded under fast sweeps
  const nz = dsp.noise('white', 2 * SR, 1), sweep = dsp.curve(2 * SR, [[0, 60], [1, 20000], [2, 60]], 'exp');
  for (const [nm, y] of [['biquad', dsp.biquad(nz, 'lp', sweep, dsp.curve(2 * SR, [[0, 0.7], [2, 12]]))], ['svf', dsp.svf(nz, 'lp', sweep, 8)], ['ladder', dsp.ladder(nz, sweep, 0.95)]]) {
    let m = 0, ok = true; for (const v of y) { if (!Number.isFinite(v)) ok = false; m = Math.max(m, Math.abs(v)); }
    check(`${nm}: sweep 60 Hz<->20 kHz with high Q stays finite & bounded`, ok && m < 20, `peak ${f1(m)}`);
  }
  // ladder: resonance peak near cutoff, 24 dB/oct
  const lad = (fq, res) => gain((x) => dsp.ladder(x.map((v) => v * 0.2), 1000, res), fq);
  check('ladder: 24 dB/oct above cutoff; resonant peak appears', lad(4000, 0.1) < lad(1000, 0.1) - 18 && lad(950, 0.9) > lad(950, 0.1) + 6);
  // formants
  const src = dsp.osc('saw', 130, 2 * SR);
  const fa = dsp.formant(src, 'a', { voice: 'tenor' }), fi = dsp.formant(src, 'i', { voice: 'tenor' }), fu = dsp.formant(src, 'u', { voice: 'tenor' });
  const rA = bandDb(fa, 1700, 2000) - bandDb(fa, 500, 1200), rI = bandDb(fi, 1700, 2000) - bandDb(fi, 500, 1200), rU = bandDb(fu, 1700, 2000) - bandDb(fu, 250, 450);
  check("formant vowels differ: 'a' strong 650-1100 Hz, 'i' has far more 1.87 kHz than 'a', 'u' mostly < 450 Hz", bandDb(fa, 500, 1200) > bandDb(fa, 2000, 2600) + 6 && rI > rA + 10 && rU < -12, `a:${f1(rA)} i:${f1(rI)} u:${f1(rU)} dB (F2/F1 band ratio)`);
  const mo = dsp.formant(src, 'a', { to: 'u', morph: dsp.curve(2 * SR, [[0, 0], [2, 1]]) });
  check('formant morph a->u finite, level sane', mo.every(Number.isFinite) && rms(mo) > 0.002);
}

// ---------------------------------------------------------------------------
section('effects');
{
  const imp = new Float32Array(2 * SR); imp[0] = 1;
  const d = dsp.delay(imp, 0.25, 0.5, 1);
  check('delay: echoes at 0.25 s (x1), 0.5 s (x0.5), 0.75 s (x0.25)', Math.abs(d[12000] - 1) < 1e-3 && Math.abs(d[24000] - 0.5) < 1e-3 && Math.abs(d[36000] - 0.25) < 1e-3 && Math.abs(d[0] - 1) < 1e-6);
  const dl = dsp.delay(imp, 0.1, 0.7, 1, { damp: 0.6 });
  check('delay damp: later repeats darker (smeared peak)', dl[4800 * 3 + 2] > 0 && Math.abs(dl[4800 * 3]) < Math.abs(dl[4800]));
  const pp = dsp.pingPong(imp, 0.2, 0.6, 1, { damp: 0 });
  check('pingPong alternates sides', Math.abs(pp.L[9600]) > 0.4 && Math.abs(pp.R[9600]) < 1e-6 && Math.abs(pp.R[19200]) > 0.2 && Math.abs(pp.L[19200]) < 1e-6 && Math.abs(pp.L[28800]) > 0.1);
  const dt = dsp.delay(imp, 0.1, 0, 1, { tail: 0.5, wetOnly: true });
  check('delay tail extends length', dt.length === 2 * SR + 24000);
  const chord = dsp.sumBufs([0, 1, 2].map((k) => Buf.fromMono(dsp.osc('saw', 220 * 2 ** (k * 4 / 12), 3 * SR).map((v) => v * 0.2))));
  const ch = dsp.chorus(chord, { mix: 0.5 }), en = dsp.ensemble(chord), fl = dsp.flanger(chord), ph = dsp.phaser(chord);
  for (const [nm, o] of [['chorus', ch], ['ensemble', en], ['flanger', fl], ['phaser', ph]]) check(`${nm}: stereo Buf, finite, level within +-4 dB of input`, o.L.length === chord.length && o.L.every(Number.isFinite) && Math.abs(db(rms(o.L)) - db(rms(chord.L))) < 4, `${f1(db(rms(o.L)) - db(rms(chord.L)))} dB`);
  const corr = (a, b) => { let ab = 0, aa = 0, bb = 0; for (let i = 0; i < a.length; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; } return ab / Math.sqrt(aa * bb); };
  const mon = Buf.from(chord.L, Float32Array.from(chord.L));
  check('chorus/ensemble widen a mono source (L/R correlation < 0.97 / < 0.8)', corr(dsp.chorus(mon).L, dsp.chorus(mon).R) < 0.97 && corr(dsp.ensemble(mon).L, dsp.ensemble(mon).R) < 0.8, `chorus ${f1(corr(dsp.chorus(mon).L, dsp.chorus(mon).R), 3)} ens ${f1(corr(dsp.ensemble(mon).L, dsp.ensemble(mon).R), 3)}`);
  const bc = dsp.bitcrush(dsp.osc('sine', 300, SR).map((v) => v * 0.9), { bits: 4 });
  const levels = new Set(bc); check('bitcrush 4-bit: <= 16 distinct levels', levels.size <= 17, `${levels.size}`);
  const sr_ = dsp.bitcrush(dsp.osc('sine', 300, SR), { bits: 16, rate: 4800 });
  let runs = 0; for (let i = 1; i < 4000; i++) if (sr_[i] !== sr_[i - 1]) runs++;
  check('sample-rate reduction holds samples (rate 4.8k)', runs < 4000 / 8, `${runs} changes in 4000`);
  // waveshaper: odd harmonics for tanh, even for asym; oversampling lowers aliasing
  const sine = dsp.osc('sine', 5003, SR).map((v) => v * 0.9);
  const ws1 = dsp.waveshape(sine, 'tanh', 10), ws4 = dsp.waveshape(sine, 'tanh', 10, { oversample: 4 });
  // harmonics 9 (45027 Hz) and 11 alias to ~2973 Hz and ~7033 Hz, 7th (35021) to ~12979 Hz: all in empty gaps
  const alias = (x) => Math.max(bandDb(x, 2900, 3050), bandDb(x, 6950, 7100), bandDb(x, 12900, 13050)) - bandDb(x, 4900, 5100);
  check('waveshape tanh adds harmonics, 4x oversampling cuts aliasing by >= 12 dB', alias(ws4) < alias(ws1) - 12, `alias: x1 ${f1(alias(ws1))} dB, x4 ${f1(alias(ws4))} dB`);
  check('waveshape comp: full-scale input peaks ~1', Math.abs(dsp.peakOf(dsp.waveshape(dsp.osc('sine', 100, 4800), 'tanh', 5)) - 1) < 0.05);
  const tr = dsp.tremolo(new Float32Array(SR).fill(1), 4, 0.5);
  check('tremolo swings between 0.5 and 1', Math.abs(Math.min(...tr) - 0.5) < 0.01 && Math.abs(Math.max(...tr) - 1) < 0.01);
  const w0 = dsp.widen(Buf.from(dsp.noise('white', 9600, 1), dsp.noise('white', 9600, 2)), 0);
  check('widen(0) = mono', w0.L.every((v, i) => Math.abs(v - w0.R[i]) < 1e-7));
  const orig = Buf.from(dsp.noise('white', 9600, 1), dsp.noise('white', 9600, 2)), w1 = dsp.widen(orig, 1);
  check('widen(1) = identity', orig.L.every((v, i) => Math.abs(v - w1.L[i]) < 1e-6 && Math.abs(orig.R[i] - w1.R[i]) < 1e-6));
  const wb = dsp.widen(Buf.from(dsp.noise('white', SR, 1), dsp.noise('white', SR, 2)), 1.5, { bassMonoHz: 200 });
  const side = (b) => b.L.map((v, i) => 0.5 * (v - b.R[i]));
  check('widen bassMonoHz removes side energy below 200 Hz', bandDb(side(wb), 20, 100) < bandDb(side(wb), 1000, 2000) - 12);
  const dec = dsp.decorrelate(dsp.noise('pink', 2 * SR, 7), { amount: 1 });
  check('decorrelate: L/R correlation < 0.5, mono-fold level within 3 dB', Math.abs(corr(dec.L, dec.R)) < 0.5 && Math.abs(db(rms(dsp.toMono(dec))) - db(rms(dsp.noise('pink', 2 * SR, 7)))) < 3, `${f1(corr(dec.L, dec.R), 3)}`);
  const up = dsp.pitchResample(dsp.osc('sine', 440, SR), 12);
  check('pitchResample +12 st: 880 Hz, half length', Math.abs(peakHz(up, 8192) - 880) < 8 && Math.abs(up.length - SR / 2) <= 1);
  const vs = dsp.varispeed(dsp.osc('sine', 440, SR), new Float32Array(SR).fill(2), {});
  check('varispeed 2x: pitch doubles, runs out -> silence', Math.abs(peakHz(vs, 8192, 0) - 880) < 8 && vs[SR - 10] === 0);
  const vr = dsp.varispeed(Float32Array.from({ length: 1000 }, (_, i) => i / 1000), new Float32Array(500).fill(-1), { start: 999 / SR });
  check('varispeed negative speed reads backwards', vr[0] > 0.99 && vr[100] < vr[0]);
}

// ---------------------------------------------------------------------------
section('reverb');
{
  const rt60 = (L) => { // Schroeder backward integration, fit -5..-25 dB, extrapolate
    const n = L.length; const e = new Float64Array(n); let s = 0; for (let i = n - 1; i >= 0; i--) { s += L[i] * L[i]; e[i] = s; }
    const dbc = (i) => 10 * Math.log10(e[i] / e[0]); let a = -1, b = -1;
    for (let i = 0; i < n; i++) { const v = dbc(i); if (a < 0 && v < -5) a = i; if (b < 0 && v < -25) { b = i; break; } }
    return b > 0 ? 3 * ((b - a) / SR) : NaN;
  };
  const imp = new Float32Array(8 * SR); imp[0] = 1;
  const energy = (w) => { let e = 0; for (let i = 0; i < w.length; i++) e += w.L[i] * w.L[i] + w.R[i] * w.R[i]; return e / 2; };
  for (const [decay, size] of [[0.6, 0.5], [2.0, 1.2], [4.0, 2.2]]) {
    const w = dsp.reverb(Buf.from(imp, imp), { decay, size, wetOnly: true, wet: 1, damp: 0.25, lowCut: 0, highCut: 0 });
    const m = rt60(w.L);
    check(`FDN RT60 ~ decay param (decay ${decay}, size ${size})`, m > decay * 0.65 && m < decay * 1.5, `measured ${f1(m)} s`);
    check(`FDN energy-normalised (wet 1 -> IR energy ~ 1)`, Math.abs(10 * Math.log10(energy(w))) < 1.0, `${f1(10 * Math.log10(energy(w)))} dB`);
  }
  const w = dsp.reverb(Buf.from(imp, imp), { decay: 2.5, wetOnly: true, wet: 1 });
  const cc = (() => { let ab = 0, aa = 0, bb = 0; for (let i = 0; i < w.length; i++) { ab += w.L[i] * w.R[i]; aa += w.L[i] ** 2; bb += w.R[i] ** 2; } return ab / Math.sqrt(aa * bb); })();
  check('FDN tail is stereo-decorrelated (|corr| < 0.35)', Math.abs(cc) < 0.35, f1(cc, 3));
  check('FDN: finite, no DC', w.L.every(Number.isFinite) && Math.abs(measure(w).dcL) < 1e-4);
  // damping: high band decays faster than low band
  const wd = dsp.reverb(Buf.from(imp, imp), { decay: 3, damp: 0.8, wetOnly: true, wet: 1 });
  const seg = (x, t0, t1) => x.subarray(Math.round(t0 * SR), Math.round(t1 * SR));
  const lo1 = bandDb(seg(wd.L, 0.3, 0.6), 200, 600, 8192), lo2 = bandDb(seg(wd.L, 1.5, 1.8), 200, 600, 8192), hi1 = bandDb(seg(wd.L, 0.3, 0.6), 4000, 8000, 8192), hi2 = bandDb(seg(wd.L, 1.5, 1.8), 4000, 8000, 8192);
  check('FDN damping: HF decays faster than LF', hi1 - hi2 > lo1 - lo2 + 3, `LF drop ${f1(lo1 - lo2)} dB, HF drop ${f1(hi1 - hi2)} dB`);
  // dry/wet + tail + sparse path consistency
  const click = new Float32Array(20 * SR); click[SR] = 0.5; click[12 * SR] = 0.5;
  const rv = dsp.reverb(Buf.from(click), { wet: 0.5, decay: 1.5, tail: 2 });
  check('reverb keeps dry (unity), adds tail length', rv.length === 20 * SR + 2 * SR && Math.abs(rv.L[SR] - (0.5 + rv.L[SR] - 0.5)) < 1 && rv.L[SR] > 0.45);
  check('reverb silence skipping: zero between events after the tail died', (() => { for (let i = 8 * SR; i < 11.9 * SR; i++) if (rv.L[i] !== 0 && Math.abs(rv.L[i]) > 1e-6) return false; return true; })());
  check('reverb second event is present at 12 s', Math.abs(rv.L[12 * SR + 5000]) > 1e-4);
  // convolution
  const rnd = dsp.mulberry32(3), xs = new Float32Array(7000), hs = new Float32Array(5000);
  for (let i = 0; i < xs.length; i++) xs[i] = rnd() * 2 - 1; for (let i = 0; i < hs.length; i++) hs[i] = (rnd() * 2 - 1) * Math.exp(-i / 900);
  const y = dsp.convolve(xs, hs, { full: true }); let me = 0;
  for (let i = 0; i < y.length; i += 53) { let s = 0; for (let k = 0; k < hs.length; k++) { const j = i - k; if (j >= 0 && j < xs.length) s += xs[j] * hs[k]; } me = Math.max(me, Math.abs(s - y[i])); }
  check('FFT convolution == direct convolution (max err < 1e-5)', me < 1e-5, me.toExponential(2));
  const fr = new dsp.RFFT(256), x0 = Float64Array.from({ length: 256 }, (_, i) => Math.sin(i * 0.37) + 0.2 * Math.cos(i * 1.9)), re = new Float64Array(129), im = new Float64Array(129), bk = new Float64Array(256);
  fr.forward(x0, re, im); fr.inverse(re, im, bk);
  check('RFFT forward/inverse roundtrip', x0.every((v, i) => Math.abs(v - bk[i]) < 1e-12));
  // generated IRs
  for (const k of ['room', 'chamber', 'hall', 'cathedral', 'plate', 'spring', 'projector_room', 'phone']) {
    const ir = dsp.makeIR(k);
    let e = 0; for (const v of ir.L) e += v * v;
    check(`makeIR('${k}'): finite, unit energy, ${f1(ir.seconds, 2)} s`, ir.L.every(Number.isFinite) && Math.abs(e - 1) < 1e-3);
  }
  const hall = dsp.makeIR('hall'), room = dsp.makeIR('room'), cath = dsp.makeIR('cathedral');
  check('IR RT60 ordering room < hall < cathedral', rt60(room.L) < rt60(hall.L) && rt60(hall.L) < rt60(cath.L), `${f1(rt60(room.L))} < ${f1(rt60(hall.L))} < ${f1(rt60(cath.L))}`);
  check('IR hall RT60 ~ 2.2-3.2 s, cathedral ~ 5-9 s', rt60(hall.L) > 1.8 && rt60(hall.L) < 3.6 && rt60(cath.L) > 4.5 && rt60(cath.L) < 9.5);
  const ph = dsp.phoneSpeaker(dsp.noise('pink', 2 * SR, 1));
  check('phoneSpeaker: band-limited 400 Hz-4 kHz, mono', bandDb(ph.L, 40, 200) < bandDb(ph.L, 800, 2400) - 14 && bandDb(ph.L, 9000, 20000) < bandDb(ph.L, 800, 2400) - 20 && ph.L.every((v, i) => v === ph.R[i]));
  for (const p of Object.keys(dsp.REVERB_PRESETS)) {
    const o = dsp.applyReverb(Buf.from(click.slice(0, 3 * SR)), p, { wet: 0.4, tail: 1 });
    check(`applyReverb preset '${p}' finite`, o.L.every(Number.isFinite) && o.length >= 3 * SR);
  }
  const rr = dsp.reverseReverb(Buf.from(dsp.noise('pink', 4800, 1)), { tail: 1 });
  check('reverseReverb: swell precedes the dry sound (offset = tail)', Math.abs(rr.offset - 1) < 1e-9 && rr.buf.length === 4800 + SR);
}

// ---------------------------------------------------------------------------
section('dynamics');
{
  const x = dsp.osc('sine', 200, 4 * SR).map((v) => v * dbl(-6));
  const c = dsp.compressor(x, { thresholdDb: -18, ratio: 4, attackMs: 5, releaseMs: 50, kneeDb: 0 });
  const grDb = db(rms(c, 3 * SR, 4 * SR)) - db(rms(x, 3 * SR, 4 * SR));
  check('compressor static curve: -6 dB in, thr -18, 4:1 => -9 dB GR', Math.abs(grDb + 9) < 0.6, f1(grDb));
  const ln = dsp.osc('sine', 200, SR).map((v) => v * dbl(-30));
  check('compressor transparent below threshold', Math.abs(db(rms(dsp.compressor(ln, { thresholdDb: -18 })) / rms(ln))) < 0.05);
  const ck = dsp.compressor(Buf.from(x, Float32Array.from(x)), { thresholdDb: -18, ratio: 4 });
  check('compressor on Buf: stereo-linked', Math.abs(ck.L[100000] / x[100000] - ck.R[100000] / x[100000]) < 1e-6);
  // sidechain: key = pulses; pad ducked while pulse is on
  const pad = dsp.osc('sine', 150, 4 * SR).map((v) => v * 0.3), key = new Float32Array(4 * SR);
  for (let k = 0; k < 4; k++) for (let i = 0; i < 4800; i++) key[k * SR + i] = 0.9 * Math.sin(i * 0.1);
  const sc = dsp.sidechainCompress(pad, key, { thresholdDb: -20, ratio: 8, attackMs: 1, releaseMs: 200 });
  check('sidechainCompress: pad ducked during key, recovers after', rms(sc, 2400, 4000) < 0.5 * rms(pad, 2400, 4000) && rms(sc, SR - 4800, SR - 1000) > 0.9 * rms(pad, SR - 4800, SR - 1000));
  const reg = dsp.duckRegions(pad, [[0.5, 1.5]], { depthDb: 9 });
  check('duckRegions: -9 dB inside the region, 0 dB far outside', Math.abs(db(rms(reg, 0.8 * SR, 1.4 * SR) / rms(pad, 0.8 * SR, 1.4 * SR)) + 9) < 0.5 && Math.abs(db(rms(reg, 3.5 * SR, 4 * SR) / rms(pad, 3.5 * SR, 4 * SR))) < 0.3);
  const gt = dsp.gate(dsp.noise('white', SR, 1, { rms: 0.001 }), { thresholdDb: -40 });
  check('gate closes on quiet noise (>40 dB attenuation)', db(rms(gt, SR / 2, SR) / 0.001) < -35);
  const au = dsp.automate(new Float32Array(2 * SR).fill(1), [[0, 0], [1, -12], [2, -12]]);
  check('automate: dB breakpoints', Math.abs(au[0] - 1) < 1e-3 && Math.abs(db(au[1.9 * SR]) + 12) < 0.1);
  const sc2 = dsp.softclip(dsp.osc('sine', 100, 4800).map((v) => v * 3), { ceilingDb: -3 });
  check('softclip never exceeds ceiling, linear below knee', dsp.peakOf(sc2) <= dbl(-3) + 1e-6 && Math.abs(dsp.softclip(Float32Array.of(0.1), { ceilingDb: 0 })[0] - 0.1) < 1e-7);
  // limiter on a hot signal
  const hot = Buf.from(dsp.noise('pink', 5 * SR, 11, { rms: 0.35 }), dsp.noise('pink', 5 * SR, 12, { rms: 0.35 }));
  for (let i = 0; i < hot.length; i += 977) { hot.L[i] *= 2.2; hot.R[i + 1] *= -2.5; }
  const before = truePeak(hot);
  const lim = dsp.limiter(hot, { ceilingDb: -1.5, lookaheadMs: 5, releaseMs: 100 });
  const after = truePeak(lim);
  check('limiter: true peak <= -1.5 dBTP (+0.05)', after.db <= -1.45, `before ${f1(before.db)} dBTP -> after ${f1(after.db)} dBTP (sample ${f1(after.samplePeakDb)}), max GR ${f1(lim.stats.maxReductionDb)} dB`);
  const quiet = Buf.from(dsp.noise('pink', SR, 1, { rms: 0.05 }), dsp.noise('pink', SR, 2, { rms: 0.05 }));
  const lq = dsp.limiter(quiet, { ceilingDb: -1 });
  check('limiter transparent when under the ceiling (bit-exact gain 1)', lq.L.every((v, i) => v === quiet.L[i]));
  const hotMono = dsp.limiter(hot.L, { ceilingDb: -3, truePeak: false });
  check('limiter works on mono arrays, sample peak <= ceiling', dsp.peakOf(hotMono) <= dbl(-3) + 1e-6);
  const dist = (() => { let acc = 0, n = 0; for (let i = 0; i < hot.length; i++) { if (Math.abs(hot.L[i]) < 0.3) { acc += Math.abs(lim.L[i] - hot.L[i]); n++; } } return acc / n; })();
  check('limiter leaves most material nearly untouched (mean |delta| for small samples < 0.05)', dist < 0.05, f1(dist, 4));
}

// ---------------------------------------------------------------------------
section('performance');
{
  const n = 60 * SR;
  const src = Buf.from(dsp.noise('pink', n, 1), dsp.noise('pink', n, 2));
  const { ms } = timeIt('60 s stereo: 6 biquads + FDN reverb (wet .3) + limiter', () => {
    let b = src;
    for (const st of [['hp', 60, 0.7, 0], ['peak', 250, 1, -2], ['peak', 3000, 1.2, 2], ['lowshelf', 120, 0.7, 2], ['highshelf', 9000, 0.7, -3], ['lp', 14000, 0.7, 0]]) b = dsp.biquad(b, st[0], st[1], st[2], st[3]);
    b = dsp.reverb(b, { wet: 0.3, decay: 2.5 });
    return dsp.limiter(b, { ceilingDb: -1.5 });
  });
  check('6 biquads + reverb + limiter on 60 s stereo in < 8 s', ms < 8000, `${ms.toFixed(0)} ms`);
  const t1 = timeIt('60 s stereo biquad x6', () => { let b = src; for (let k = 0; k < 6; k++) b = dsp.biquad(b, 'peak', 500 * (k + 1), 1, 1); return b; });
  const t2 = timeIt('60 s stereo conv reverb hall (dense)', () => dsp.convReverb(src, 'hall', { wet: 0.3 }));
  const t3 = timeIt('60 s stereo FDN reverb (dense)', () => dsp.reverb(src, { wet: 0.3 }));
  check('biquad x6 < 1.5 s, conv reverb < 5 s, FDN < 4 s', t1.ms < 1500 && t2.ms < 5000 && t3.ms < 4000);
}
summary('test_dsp');
