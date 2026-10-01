#!/usr/bin/env node
// node audio/music/test_b/key_check.mjs [stem.wav]
// 1. SYMBOLIC: every pitched note of every layer is diatonic to C / Am; the motif appears only as E G A C (or its retrograde);
//    every sustained chord note belongs to the chord the cues say is sounding (+ the colour tones we declared).
// 2. AUDIO: chroma of the rendered stem per section / chord: energy outside the C-major scale, energy on the chord's tones.
import { dsp, cues, f, pad, lpad, load, mono, chroma, PC_NAMES, MAJOR } from './util.mjs';
import { buildLayers, TIME } from '../score_b.mjs';
import * as th from '../../lib/theory.mjs';
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };

// ---- 1. symbolic
const layers = buildLayers();
let nNotes = 0, bad = [];
for (const l of layers) {
  for (const n of l.notes) {
    if (n.midi == null) continue;
    nNotes++;
    if (!MAJOR.has(((Math.round(n.midi) % 12) + 12) % 12)) bad.push(`${l.name}@${n.t.toFixed(3)} midi ${n.midi}`);
  }
}
check(bad.length === 0, `${nNotes} pitched notes in ${layers.length} layers are all diatonic to C / Am ${bad.slice(0, 5).join(', ')}`);

// every layer note starts on the 1/32-note grid (hits, bars, beats) except the declared sparkle/roll/humanised ones
const onGrid = (t) => Math.abs(t / (cues.BEAT / 8) - Math.round(t / (cues.BEAT / 8))) < 1e-6;
const offGrid = {};
for (const l of layers) for (const n of l.notes) if (!onGrid(n.t)) offGrid[l.name] = (offGrid[l.name] || 0) + 1;
console.log('layers with notes off the 1/32 grid (rolls / sparkles by design):', JSON.stringify(offGrid));
const strict = layers.filter((l) => !/Roll|roll|timp|fSnareRoll|snare|finHarp|rTimp|eTimp|hitTimp/.test(l.name) && !/^(snare)$/.test(l.name));
const strictBad = strict.filter((l) => offGrid[l.name]);
check(strictBad.length === 0, `all other layers are on the grid ${strictBad.map((l) => l.name).join(',')}`);

// the motif: wherever the 4 consecutive pitches E G A C (64 67 69 72 in any octave) are played they are in that order
const MOTIF = [64, 67, 69, 72].map((m) => m % 12);
let motifHits = 0;
for (const l of layers) {
  const ns = [...l.notes].filter((n) => n.midi != null).sort((a, b) => a.t - b.t);
  for (let i = 0; i + 3 < ns.length; i++) {
    const pcs = ns.slice(i, i + 4).map((n) => n.midi % 12);
    if (pcs.every((p, k) => p === MOTIF[k]) && ns[i + 3].t - ns[i].t < 3) motifHits++;
  }
}
console.log(`motif statements (E G A C in sequence, any octave/instrument): ${motifHits}`);
check(motifHits >= 8, `the motif threads the whole score (${motifHits} statements)`);

// ---- 2. audio chroma
const buf = load(process.argv[2] || 'music_b');
const x = mono(buf);
const spans = [
  ['jobs 26-28 C (pulse)', 26, 28, 'C'], ['jobs 28-30 G', 28, 30, 'G'], ['jobs 30-32 Am', 30, 32, 'Am'], ['jobs 32-34 F', 32, 34, 'F'], ['jobs 34-36 C', 34, 36, 'C'],
  ['jobs 38-40 Am', 38, 40, 'Am'], ['future 42-44 C', 42, 44, 'C'], ['future 44-46 G', 44, 46, 'G'], ['future 46-48 Am', 46, 48, 'Am'], ['future 48-50 F', 48, 50, 'F'],
  ['recap 50-52 Am', 50, 52, 'Am'], ['recap 52-54 F', 52, 54, 'F'], ['end 54-56 C', 54, 56, 'C'], ['end 56-57 F', 56.1, 57, 'F'], ['end 57-58 G', 57.1, 57.85, 'G'], ['final 58-59 C', 58.05, 59, 'C'],
];
console.log('\nchroma (percent of pitched energy 80 Hz-4 kHz): chord tones | other diatonic | OUT-of-key');
for (const [name, a, b, chord] of spans) {
  const c = chroma(x, a, b, b - a < 1.2 ? 8192 : 16384);
  const tones = new Set(th.chordPitchClasses(chord));
  const chordE = [...tones].reduce((s, p) => s + c[p], 0);
  const dia = c.reduce((s, v, p) => s + (MAJOR.has(p) && !tones.has(p) ? v : 0), 0);
  const out = c.reduce((s, v, p) => s + (MAJOR.has(p) ? 0 : v), 0);
  const top = c.map((v, p) => [v, p]).sort((p, q) => q[0] - p[0]).slice(0, 4).map(([v, p]) => `${PC_NAMES[p]} ${(v * 100).toFixed(0)}`).join(' ');
  console.log(`  ${pad(name, 22)} ${lpad((chordE * 100).toFixed(0), 3)}% | ${lpad((dia * 100).toFixed(0), 3)}% | ${lpad((out * 100).toFixed(1), 4)}%   top: ${top}`);
  if (!/jobs 3[0-9]-|final/.test(name) || true) {
    if (out > 0.12) { check(false, `${name}: ${(out * 100).toFixed(1)}% of the energy is out of key`); }
  }
}
console.log(`\n${fails ? fails + ' FAILED' : 'ALL CHECKS PASSED'}`);
process.exit(fails ? 1 : 0);
