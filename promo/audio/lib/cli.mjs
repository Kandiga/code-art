#!/usr/bin/env node
// Small inspection CLI for any wav in the pipeline.
//   node audio/lib/cli.mjs spec  in.wav [out.png] [--start 0] [--dur 10] [--w 1600] [--h 700] [--lin]   spectrogram PNG
//   node audio/lib/cli.mjs wave  in.wav [out.png] [--start 0] [--dur 10] [--w 1600] [--h 300]          waveform PNG
//   node audio/lib/cli.mjs stats in.wav [t0 t1]          loudness/peak/true-peak/DC (whole file or a window)
//   node audio/lib/cli.mjs curve in.wav [window 'm'|'s']  momentary (400 ms) or short-term loudness every 0.5 s
//   node audio/lib/cli.mjs silence in.wav t0 t1           is [t0,t1) digital silence (< -90 dBFS)?
// PNGs default to audio/build/tmp/<name>_spec.png - open them with the Read tool / any image viewer.
import path from 'node:path';
import { readWav } from './core.mjs';
import { measure, formatReport, lufsGateStats, loudnessCurve, silenceCheck, fmt } from './meter.mjs';
import { spectrogramPng, wavePng } from './ff.mjs';
import { TMP, ensure } from './paths.mjs';

const [cmd, file, ...rest] = process.argv.slice(2);
const flag = (n, d) => { const i = rest.indexOf('--' + n); return i >= 0 ? rest[i + 1] : d; };
const pos = rest.filter((a, i) => !a.startsWith('--') && !(i > 0 && rest[i - 1].startsWith('--') && rest[i - 1] !== '--lin'));
if (!cmd || !file) { console.log(fs_head()); process.exit(1); }
function fs_head() { return 'usage: node audio/lib/cli.mjs <spec|wave|stats|curve|silence> file.wav [...]  (see header of audio/lib/cli.mjs)'; }
const base = path.basename(file).replace(/\.\w+$/, '');
const out = (suffix) => (pos[0] && pos[0].endsWith('.png') ? pos[0] : path.join(ensure(TMP), `${base}_${suffix}.png`));
const win = () => ({ start: parseFloat(flag('start', 0)), dur: flag('dur', null) != null ? parseFloat(flag('dur')) : null });

if (cmd === 'spec') {
  const o = out('spec');
  spectrogramPng(file, o, { w: +flag('w', 1600), h: +flag('h', 700), fscale: rest.includes('--lin') ? 'lin' : 'log', ...win() });
  console.log(o);
} else if (cmd === 'wave') {
  const o = out('wave');
  wavePng(file, o, { w: +flag('w', 1600), h: +flag('h', 300), ...win() });
  console.log(o);
} else if (cmd === 'stats') {
  const b = readWav(file);
  if (pos.length >= 2) {
    const [t0, t1] = pos.map(parseFloat);
    const s = lufsGateStats(b, t0, t1);
    console.log(`window ${t0}-${t1} s: integrated ${fmt(s.integrated, 'LUFS')}  ungated ${fmt(s.ungated, 'LUFS')}  momentary max ${fmt(s.momentaryMax, 'LUFS')}  RMS ${fmt(s.rmsDb, 'dBFS')}  peak ${fmt(s.peakDb, 'dBFS')}  true peak ${fmt(s.truePeakDb, 'dBTP')}`);
  } else console.log(formatReport(measure(b)));
} else if (cmd === 'curve') {
  const b = readWav(file);
  const kind = pos[0] === 's' ? 'short' : 'momentary';
  const c = loudnessCurve(b, kind, 0.5);
  console.log(`${kind} loudness (LUFS) every 0.5 s:`);
  for (let i = 0; i < c.t.length; i += 2) console.log(`${c.t[i].toFixed(1).padStart(5)} s  ${fmt(c.l[i], '', 1).padStart(7)}  ${'#'.repeat(Math.max(0, Math.round((c.l[i] + 60) / 1.5)))}`);
} else if (cmd === 'silence') {
  const b = readWav(file);
  const r = silenceCheck(b, parseFloat(pos[0]), parseFloat(pos[1]));
  console.log(`${r.silent ? 'SILENT' : 'NOT silent'}  peak ${fmt(r.peakDb, 'dBFS')}`);
  process.exitCode = r.silent ? 0 : 1;
} else { console.log(fs_head()); process.exit(1); }
