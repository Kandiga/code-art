// node audio/music/test/demo_eras.mjs   - plays the motif over the era's chord with every ERA_STYLES kit (kit.render / finish),
// writes test/eras_demo.wav (9 eras x 2 s, tails overlapping) + spectrogram, prints per-era loudness. Also the API usage example.
import path from 'node:path';
import * as inst from '../instruments.mjs';
import { OUT, dsp, meter, ff, th, cues, f } from './lib.mjs';
const { BAR, BEAT, ERAS } = cues;
const MOTIF_OCT = { silent_piano: 0, piano_musicbox: 0, lush_strings: 1, strings_harp: 1, brass_choir: -1, heroic_fanfare: 0, synth_orch: 1, braams_taiko: -2, lofi_phone: 0 };
const T0 = 0.25, LEN = 5.5;

function demo(kit, chord) {
  const layers = {};
  const root = (oct) => th.chordRoot(chord, oct);
  const tones = (voicing, oct, dur = BAR * 0.97, vel = 0.7) => th.chordNotes(chord, oct, voicing).map((midi) => ({ t: T0, dur, midi, vel }));
  layers.motif = kit.render('motif', th.motifEvents(T0, { octave: MOTIF_OCT[kit.id] || 0 }), { seconds: LEN });
  if (kit.padInstrument) {
    const oct = kit.padInstrument.id === 'celesta' ? 4 : 3;
    layers.pad = kit.render('pad', tones(kit.padInstrument.id === 'synth_pad' ? 'wide' : 'open', oct), { seconds: LEN });
  }
  const R = kit.rhythmInstrument.id;
  let rn = [];
  if (R === 'piano') rn = [0, 2].flatMap((b) => [{ t: T0 + b * BEAT, dur: BEAT * 0.9, midi: root(2), vel: 0.7 }, { t: T0 + b * BEAT, dur: BEAT * 0.9, midi: root(2) + 7, vel: 0.6 }]).concat([1, 3].flatMap((b) => th.chordNotes(chord, 3, 'close').map((midi) => ({ t: T0 + b * BEAT, dur: BEAT * 0.45, midi, vel: 0.55 }))));
  else if (R === 'strings_pizz') rn = [1, 3].flatMap((b) => th.chordNotes(chord, 3, 'close').map((midi) => ({ t: T0 + b * BEAT, dur: 0.2, midi, vel: 0.7 })));
  else if (R === 'harp') rn = th.arp(th.chordNotes(chord, 3, 'open').concat(th.chordNotes(chord, 4, 'open')), T0, { step: BEAT / 2, count: 8, vel: 0.6 });
  else if (R === 'timpani') rn = [0, 2].map((b) => ({ t: T0 + b * BEAT, dur: BEAT, midi: root(2), vel: 0.85 })).concat(inst.drumRoll(T0 + 3 * BEAT, T0 + 4 * BEAT - 0.02, { midi: root(2), rate: 16, vel: [0.3, 0.9] }));
  else if (R === 'taiko') rn = [0, 1.5, 2, 3].map((b) => ({ t: T0 + b * BEAT, midi: root(2), vel: 0.95 }));
  else rn = [1, 3].map((b) => ({ t: T0 + b * BEAT, vel: 0.9 }));
  layers.rhythm = kit.render('rhythm', rn, { seconds: LEN });
  for (const e of kit.extras) {
    if (e.role === 'kick') layers.kick = kit.render('kick', [0, 2].map((b) => ({ t: T0 + b * BEAT, vel: 0.95 })), { seconds: LEN });
    if (e.role === 'timp' && kit.id === 'heroic_fanfare') layers.timp = kit.render('timp', [0, 2].map((b) => ({ t: T0 + b * BEAT, dur: BEAT, midi: root(2), vel: 0.85 })), { seconds: LEN });
    if (e.role === 'hat' && kit.id === 'lofi_phone') layers.hat = kit.render('hat', Array.from({ length: 8 }, (_, i) => ({ t: T0 + i * BEAT / 2, vel: i % 2 ? 0.3 : 0.55 })), { seconds: LEN });
    if (e.role === 'low' && kit.id === 'brass_choir') layers.low = kit.render('low', [{ t: T0, dur: BAR * 0.95, midi: root(1) + 12, vel: 0.7 }], { seconds: LEN });
  }
  return kit.finish(layers, {});
}

const master = new dsp.Buf(2 * ERAS.length + 4);
for (const e of ERAS) {
  const kit = inst.eraKit(e);
  const t = process.hrtime.bigint();
  const chord = th.chordForTime(e.t0).name;
  const b = demo(kit, chord);
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  const ok = b.L.every(Number.isFinite) && b.R.every(Number.isFinite);
  const m = meter.measure(b);
  console.log(`${String(e.year).padEnd(5)} ${e.music.padEnd(15)} chord ${chord.padEnd(3)} ${f(ms, 0).padStart(5)} ms  peak ${f(m.samplePeakDb)} dBFS  LUFS(int) ${f(m.integrated)}  mom max ${f(m.momentaryMax)}  ${ok ? '' : 'NaN!'}`);
  dsp.writeWav(path.join(OUT, `era_${e.index}_${e.music}.wav`), b);
  dsp.addAt(master, b, e.index * 2 - T0, 0, 0);
}
dsp.writeWav(path.join(OUT, 'eras_demo.wav'), master);
console.log('master', f(meter.measure(master).integrated), 'LUFS; peak', f(meter.measure(master).samplePeakDb), 'dBFS');
ff.spectrogramPng(path.join(OUT, 'eras_demo.wav'), path.join(OUT, 'eras_demo.png'), { w: 1600, h: 640, legend: true, drange: 90 });
