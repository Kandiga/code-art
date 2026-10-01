// node audio/music/test/bench.mjs   - render-time of realistic full-film parts (CPU is shared: numbers are indicative)
import * as inst from '../instruments.mjs';
import { th, cues, meter } from './lib.mjs';
const { BAR, BEAT } = cues;
const chordsNotes = (voicing, octave, dur = BAR, vel = 0.7) => {
  const out = [];
  for (let bar = 0; bar < 30; bar++) {
    const sp = th.chordForTime(bar * BAR);
    for (const m of th.chordNotes(sp.name, octave, voicing)) out.push({ t: bar * BAR, dur, midi: m, vel });
  }
  return out;
};
const timeIt = (label, fn) => {
  const t0 = process.hrtime.bigint();
  const r = fn();
  console.log(`${label.padEnd(44)} ${(Number(process.hrtime.bigint() - t0) / 1e9).toFixed(2)} s`);
  return r;
};
timeIt('strings legato: 30 bars x 3-note chords (60 s)', () => inst.render('strings', chordsNotes('close', 3), {}));
timeIt('strings_ostinato: 16 s of 16ths (128 notes)', () => inst.render('strings_ostinato', Array.from({ length: 128 }, (_, i) => ({ t: 34 + i * BEAT / 4, dur: BEAT / 4 * 0.9, midi: [57, 60, 64, 60][i % 4], vel: 0.7 })), {}));
timeIt('synth_pad: 30 bars x 4 notes (60 s)', () => inst.render('synth_pad', chordsNotes('wide', 3), {}));
timeIt('choir: 16 bars x 4 notes (32 s, 6 singers)', () => inst.render('choir', chordsNotes('open', 3).filter((n) => n.t >= 26 && n.t < 58), { singers: 6 }));
timeIt('piano: 60 s of 8ths (120 notes)', () => inst.render('piano', Array.from({ length: 240 }, (_, i) => ({ t: i * BEAT / 2, dur: BEAT / 2, midi: 48 + [0, 4, 7, 12][i % 4], vel: 0.7 })), {}));
timeIt('synth_pulse: 16 s of 8ths (64 notes)', () => inst.render('synth_pulse', Array.from({ length: 64 }, (_, i) => ({ t: 26 + i * BEAT / 2, dur: BEAT / 2 * 0.9, midi: 45, vel: 0.8 })), {}));
timeIt('drums: kick+snare+hat, 16 s', () => {
  const k = [], s = [], h = [];
  for (let b = 13; b < 21; b++) for (let i = 0; i < 4; i++) { k.push({ t: b * BAR + i * BEAT, vel: 0.9 }); h.push({ t: b * BAR + i * BEAT, vel: 0.5 }, { t: b * BAR + i * BEAT + BEAT / 2, vel: 0.35 }); if (i % 2) s.push({ t: b * BAR + i * BEAT, vel: 0.9 }); }
  inst.render('kick', k, {}); inst.render('snare', s, {}); inst.render('hat', h, {});
});
timeIt('trumpets+horns+brass_low: 8 chords', () => { for (const id of ['trumpets', 'horns', 'brass_low']) inst.render(id, chordsNotes('close', id === 'brass_low' ? 2 : 3).filter((n) => n.t >= 36 && n.t < 44), {}); });
