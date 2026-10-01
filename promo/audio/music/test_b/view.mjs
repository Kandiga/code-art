#!/usr/bin/env node
// node audio/music/test_b/view.mjs [stem.wav] [prefix]   -> PNG spectrograms + waveforms in audio/build/tmp/score_b/ (open them with the Read tool)
import path from 'node:path';
import { ff, dsp, OUT, wavPath } from './util.mjs';
const wav = process.argv[2] && process.argv[2].endsWith('.wav') ? process.argv[2] : wavPath(process.argv[2] || 'music_b');
const pre = process.argv[3] || 'b';
const jobs = [
  ['all', 26, 34, 1800, 560], ['jobs1', 26, 34, 1600, 620], ['jobs2', 34, 42, 1600, 620], ['future', 42, 50, 1600, 620], ['recap', 50, 58, 1600, 620],
  ['baton', 35.5, 39, 1600, 620], ['stutter', 38, 42.5, 1600, 620], ['end', 56.5, 60, 1600, 620], ['hit58', 57.7, 60, 1600, 620],
];
for (const [n, a, b, w, h] of jobs) {
  const out = path.join(OUT, `${pre}_${n}_spec.png`);
  ff.spectrogramPng(wav, out, { start: a, dur: b - a, w, h, legend: true, drange: 90 });
  console.log(out);
}
const outw = path.join(OUT, `${pre}_wave.png`);
ff.wavePng(wav, outw, { start: 26, dur: 34, w: 1800, h: 360 });
console.log(outw);
