// =============================================================================
// theory.mjs - music theory + timing helpers bound to shared/cues.js (the clock).
//   chords    chordNotes(name, octave, voicing) / chordForTime(t) / chordSpans()
//   motif     motifEvents(t0, opts) -> [{t,dur,midi,vel}]
//   grid      barStart(n) beatTimes(t0,t1,subdiv) beatGrid(...)
//   scales    SCALES scaleNotes quantizeToScale inKey
//   sequencer renderEvents(events, instrument, opts) -> Buf ; steps() arp() humanize()
// Nothing here hard-codes a time: BEAT/BAR/CHORDS/MOTIF all come from cues.
// =============================================================================
import * as cues from '../../shared/cues.js';
import { SR, Buf, isBuf, addAt, midiToHz, noteToMidi, mulberry32, seedOf, clamp } from './core.mjs';

export { cues };
export const { BEAT, BAR, BPM, DURATION } = cues;

// ---------------------------------------------------------------------------
// grid
// ---------------------------------------------------------------------------
/** start time (s) of bar n (0-based) */
export const barStart = (n) => n * BAR;
export const barOf = (t) => Math.floor(t / BAR + 1e-9);
/** beat position inside the bar, 0..4 (float) */
export const beatInBar = (t) => (t - barOf(t) * BAR) / BEAT;
/**
 * Times of every 1/subdiv beat in [t0, t1): subdiv 1 = beats (0.5 s), 2 = 8ths, 4 = 16ths, 3 = triplet-8ths ...
 * Computed from integer indices (no float drift).
 */
export function beatTimes(t0 = 0, t1 = DURATION, subdiv = 1) {
  const step = BEAT / subdiv;
  const out = [];
  for (let k = Math.ceil(t0 / step - 1e-9); k * step < t1 - 1e-9; k++) out.push(k * step);
  return out;
}
/** like beatTimes but objects: {t, k, beat, bar, bt (beat in bar 0..4), sub, downbeat} */
export function beatGrid(t0 = 0, t1 = DURATION, subdiv = 1) {
  const step = BEAT / subdiv;
  const out = [];
  for (let k = Math.ceil(t0 / step - 1e-9); k * step < t1 - 1e-9; k++) {
    const t = k * step, beat = k / subdiv;
    out.push({ t, k, beat, bar: Math.floor(beat / 4 + 1e-9), bt: beat % 4, sub: k % subdiv, downbeat: Math.abs(beat % 4) < 1e-9 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// chords
// ---------------------------------------------------------------------------
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const pcOf = (s) => {
  let pc = PC[s[0].toUpperCase()];
  for (const ch of s.slice(1)) pc += ch === '#' ? 1 : -1;
  return ((pc % 12) + 12) % 12;
};

/**
 * parseChord('Am7') -> {name, root:'A', rootPc:9, minor, dim, aug, sus:null|2|4, tones:[0,3,7,10]}
 * Supported: root [A-G][#b], quality m|min|dim|aug, extensions maj7 7 6 9 add9 add11 sus2 sus4 (any combination).
 */
export function parseChord(name) {
  const m = /^([A-G][#b]?)(.*)$/.exec(String(name).trim());
  if (!m) throw new Error(`parseChord: cannot parse "${name}"`);
  let rest = m[2];
  const root = m[1];
  let minor = false, dim = false, aug = false, sus = null;
  if (/^(min|m)(?!aj)/.test(rest)) { minor = true; rest = rest.replace(/^(min|m)/, ''); }
  else if (/^dim/.test(rest)) { dim = true; rest = rest.slice(3); }
  else if (/^aug/.test(rest)) { aug = true; rest = rest.slice(3); }
  const ext = [];
  const re = /^(maj7|maj9|add11|add9|sus2|sus4|13|11|9|7|6|5)/;
  while (rest.length) {
    const t = re.exec(rest);
    if (!t) throw new Error(`parseChord: unknown extension "${rest}" in "${name}"`);
    ext.push(t[1]);
    rest = rest.slice(t[1].length);
  }
  let third = minor || dim ? 3 : 4;
  let fifth = dim ? 6 : aug ? 8 : 7;
  const extra = [];
  for (const e of ext) {
    if (e === 'sus2') { sus = 2; third = 2; }
    else if (e === 'sus4') { sus = 4; third = 5; }
    else if (e === 'maj7') extra.push(11);
    else if (e === 'maj9') extra.push(11, 14);
    else if (e === '7') extra.push(dim ? 9 : 10);
    else if (e === '6') extra.push(9);
    else if (e === '9') extra.push(10, 14);
    else if (e === 'add9') extra.push(14);
    else if (e === 'add11') extra.push(17);
    else if (e === '11') extra.push(10, 14, 17);
    else if (e === '13') extra.push(10, 14, 21);
    else if (e === '5') { third = null; }
  }
  const tones = [0, ...(third === null ? [] : [third]), fifth, ...extra.sort((a, b) => a - b)];
  return { name, root, rootPc: pcOf(root), minor, dim, aug, sus, tones, hasThird: third !== null };
}

/** pitch classes (0..11) of a chord */
export const chordPitchClasses = (name) => {
  const c = parseChord(name);
  return [...new Set(c.tones.map((t) => (c.rootPc + t) % 12))];
};
/** midi of the chord root with the root in `octave` (C3 = 48 => 'C', 3) */
export const chordRoot = (name, octave = 3) => (octave + 1) * 12 + parseChord(name).rootPc;

/**
 * chordNotes(name, octave=3, voicing='close', opts) -> ascending MIDI numbers. `octave` is the octave of the root.
 * voicing: 'close'  root position stacked up from the root           Am@3: A3 C4 E4
 *          'open'   root, fifth, tenth (spread triad)                 Am@3: A3 E4 C5
 *          'wide'   bass dyad one octave down + spread upper stack   Am@3: A2 E3 C4 E4 A4 C5
 *          'bass'   root + fifth                                      Am@3: A3 E4
 *          'root'   root only      'power' root, fifth, octave
 *          'shell'  root, third, (7th|extension|fifth)
 *          'drop2'  close voicing with the 2nd-from-top note dropped an octave
 * opts: {inversion=0, add: 'add9'|'6'|'maj7'|'sus2'|... (extra colour appended to the name)}
 * Colours may also be in the name: chordNotes('Cadd9'), chordNotes('Am7'), chordNotes('Fmaj7'), chordNotes('Gsus2'), chordNotes('C6').
 */
export function chordNotes(name, octave = 3, voicing = 'close', opts = {}) {
  const nm = opts.add ? String(name) + opts.add : String(name);
  const c = parseChord(nm);
  const R = (octave + 1) * 12 + c.rootPc;
  const t = c.tones;
  const third = c.hasThird ? t[1] : null;
  const fifth = t[c.hasThird ? 2 : 1];
  const extras = t.slice(c.hasThird ? 3 : 2);
  let notes;
  switch (voicing) {
    case 'close': notes = t.map((x) => R + x); break;
    case 'open': notes = [R, R + fifth, ...(third != null ? [R + third + 12] : []), ...extras.map((x) => R + (x < 12 ? x + 12 : x))]; break;
    case 'wide':
      notes = [R - 12, R + fifth - 12, ...(third != null ? [R + third] : []), R + fifth, R + 12, ...(third != null ? [R + third + 12] : []), ...extras.map((x) => R + (x < 12 ? x + 12 : x))];
      break;
    case 'bass': notes = [R, R + fifth]; break;
    case 'root': notes = [R]; break;
    case 'power': notes = [R, R + fifth, R + 12]; break;
    case 'shell': notes = [R, ...(third != null ? [R + third] : []), R + (extras.length ? extras[0] : fifth)]; break;
    case 'drop2': {
      const cl = t.map((x) => R + x).sort((a, b) => a - b);
      if (cl.length >= 3) cl[cl.length - 2] -= 12;
      notes = cl;
      break;
    }
    default: throw new Error(`chordNotes: unknown voicing "${voicing}"`);
  }
  notes = [...new Set(notes)].sort((a, b) => a - b);
  for (let k = 0; k < (opts.inversion || 0); k++) {
    const lo = notes.shift();
    notes.push(lo + 12);
    notes.sort((a, b) => a - b);
  }
  return notes;
}

/**
 * chordForTime(t) -> {name, bar, half (0|1), t0, t1, next (name of the following chord span), rootPc, parsed}
 * Half-bar aware: CHORDS entries that are arrays hold two chords per bar (e.g. bar 28 = ['F','G']).
 */
export function chordForTime(t) {
  const bar = clamp(barOf(Math.max(0, t)), 0, cues.CHORDS.length - 1);
  const entry = cues.CHORDS[bar];
  const inBar = t - bar * BAR;
  let half = 0, name, t0, t1;
  if (Array.isArray(entry)) {
    half = inBar >= BAR / 2 - 1e-9 ? 1 : 0;
    name = entry[half];
    t0 = bar * BAR + half * (BAR / 2);
    t1 = t0 + BAR / 2;
  } else {
    name = entry;
    t0 = bar * BAR;
    t1 = t0 + BAR;
  }
  const nxt = chordAfter(bar, half);
  return { name, bar, half, t0, t1, next: nxt, rootPc: parseChord(name).rootPc };
}
function chordAfter(bar, half) {
  const entry = cues.CHORDS[bar];
  if (Array.isArray(entry) && half === 0) return entry[1];
  const nb = Math.min(cues.CHORDS.length - 1, bar + 1);
  const e = cues.CHORDS[nb];
  return Array.isArray(e) ? e[0] : e;
}
/**
 * chordSpans(t0=0, t1=DURATION, {merge=false}) -> [{name, t0, t1, bar, half}] covering [t0,t1).
 * merge:true joins consecutive identical chords (bars 0-1 'Am' -> one 4 s span).
 */
export function chordSpans(t0 = 0, t1 = DURATION, opts = {}) {
  const spans = [];
  for (let bar = 0; bar < cues.CHORDS.length; bar++) {
    const e = cues.CHORDS[bar];
    const parts = Array.isArray(e) ? e : [e];
    const len = BAR / parts.length;
    parts.forEach((name, half) => spans.push({ name, t0: bar * BAR + half * len, t1: bar * BAR + (half + 1) * len, bar, half: Array.isArray(e) ? half : 0 }));
  }
  let out = spans.filter((s) => s.t1 > t0 + 1e-9 && s.t0 < t1 - 1e-9);
  if (opts.merge) {
    const m = [];
    for (const s of out) {
      const last = m[m.length - 1];
      if (last && last.name === s.name && Math.abs(last.t1 - s.t0) < 1e-9) last.t1 = s.t1;
      else m.push({ ...s });
    }
    out = m;
  }
  return out;
}

// ---------------------------------------------------------------------------
// motif
// ---------------------------------------------------------------------------
const DEFAULT_VEL = [0.88, 0.68, 0.74, 0.95];
/**
 * The same four pitches (cues.MOTIF) as even quarter notes on beats 0,1,2,3 (the last one held 2 beats).
 * This is the "turn" piano reading: E4 24.0, G4 24.5, A4 25.0, C5 25.5 when placed at bar 12.
 */
export const MOTIF_EVEN = cues.MOTIF.notes.map((n, i) => ({ beat: i, len: i === 3 ? 2 : 1, midi: n.midi }));
/**
 * motifEvents(t0, {transposeSemis=0, octave=0, stretch=1, rhythm='orig'|'even', notes, vel (number|array|fn), gate=1})
 * -> [{t, dur, midi, vel, beat}] ; t0 in seconds (use barStart(n) for bar n). stretch>1 = slower (augmentation).
 * rhythm 'orig' (default) = cues.MOTIF rhythm [b0 len1][b1 len.5][b1.5 len.5][b2 len2] (E4 G4 A4 C5);
 * rhythm 'even' = MOTIF_EVEN (one note per beat). `notes` overrides both.
 */
export function motifEvents(t0, opts = {}) {
  const { transposeSemis = 0, octave = 0, stretch = 1, rhythm = 'orig', vel = null, gate = 1 } = opts;
  const notes = opts.notes || (rhythm === 'even' ? MOTIF_EVEN : cues.MOTIF.notes);
  return notes.map((n, i) => ({
    t: t0 + n.beat * BEAT * stretch,
    dur: n.len * BEAT * stretch * gate,
    midi: n.midi + transposeSemis + 12 * octave,
    vel: typeof vel === 'function' ? vel(i, n) : Array.isArray(vel) ? vel[i % vel.length] : vel != null ? vel : DEFAULT_VEL[i % DEFAULT_VEL.length],
    beat: n.beat,
    idx: i,
  }));
}
/** motif at the start of each listed bar: motifBars([2,3,4], opts) */
export function motifBars(barList, opts = {}) {
  return barList.flatMap((b) => motifEvents(barStart(b), typeof opts === 'function' ? opts(b) : opts));
}

// ---------------------------------------------------------------------------
// scales
// ---------------------------------------------------------------------------
export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11], phrygian: [0, 1, 3, 5, 7, 8, 10], harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  pentMajor: [0, 2, 4, 7, 9], pentMinor: [0, 3, 5, 7, 10], chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};
/** scaleNotes(rootMidi|'A3', 'minor', {octaves=1, inclusive=true}) -> MIDI list (root up to root+octaves*12) */
export function scaleNotes(root, scale = 'major', opts = {}) {
  const { octaves = 1, inclusive = true } = opts;
  const r = typeof root === 'string' ? noteToMidi(root) : root;
  const iv = Array.isArray(scale) ? scale : SCALES[scale];
  const out = [];
  for (let o = 0; o < octaves; o++) for (const s of iv) out.push(r + o * 12 + s);
  if (inclusive) out.push(r + octaves * 12);
  return out;
}
/** nearest scale tone to `midi` for a scale rooted at pitch class rootPc */
export function quantizeToScale(midi, rootPc = 0, scale = 'major') {
  const iv = Array.isArray(scale) ? scale : SCALES[scale];
  let best = midi, bd = 99;
  for (let m = Math.floor(midi) - 7; m <= Math.ceil(midi) + 7; m++) {
    if (iv.includes((((m - rootPc) % 12) + 12) % 12) && Math.abs(m - midi) < bd) { bd = Math.abs(m - midi); best = m; }
  }
  return best;
}
/** the film's key is C major / A minor: is this MIDI note diatonic? */
export const inKey = (midi, scale = 'major', rootPc = 0) => SCALES[scale].includes((((Math.round(midi) - rootPc) % 12) + 12) % 12);
/** scale degree (1-based) of midi relative to root, or null if chromatic */
export function degreeOf(midi, rootPc = 0, scale = 'major') {
  const i = SCALES[scale].indexOf((((Math.round(midi) - rootPc) % 12) + 12) % 12);
  return i < 0 ? null : i + 1;
}

// ---------------------------------------------------------------------------
// patterns + sequencer
// ---------------------------------------------------------------------------
/**
 * steps('x..x..x. X...x...', t0, {subdiv=2, step}) -> [{t, step, accent}]
 * One char per step: x = hit, X = accent hit, anything else = rest; spaces and '|' are ignored.
 * subdiv 2 = 8th-note steps (0.25 s), 4 = 16ths (0.125 s). `step` overrides in seconds.
 */
export function steps(pattern, t0 = 0, opts = {}) {
  const { subdiv = 2, step = BEAT / subdiv } = opts;
  const chars = [...pattern].filter((c) => c !== ' ' && c !== '|');
  const out = [];
  chars.forEach((c, i) => {
    if (c === 'x' || c === 'X') out.push({ t: t0 + i * step, step: i, accent: c === 'X' });
  });
  return out;
}
/** euclidean rhythm k hits over n steps -> 'x..x..x.' string */
export function euclid(k, n, rotate = 0) {
  const p = [];
  for (let i = 0; i < n; i++) p.push(Math.floor(((i + rotate) * k) / n) !== Math.floor(((i + rotate - 1) * k) / n) ? 'x' : '.');
  return p.join('');
}
/**
 * arp(midis, t0, {pattern='up'|'down'|'updown'|'random'|[indices], step=BEAT/2, count, dur=step*0.9, vel=0.8, seed})
 * -> [{t, dur, midi, vel}]
 */
export function arp(midis, t0, opts = {}) {
  const { pattern = 'up', step = BEAT / 2, count = midis.length, dur = step * 0.9, vel = 0.8, seed = 1 } = opts;
  const rng = mulberry32(seed);
  let order;
  const n = midis.length;
  if (Array.isArray(pattern)) order = pattern;
  else if (pattern === 'down') order = midis.map((_, i) => n - 1 - i);
  else if (pattern === 'updown') order = [...midis.keys(), ...[...midis.keys()].slice(1, -1).reverse()];
  else if (pattern === 'random') order = Array.from({ length: count }, () => rng.int(n));
  else order = [...midis.keys()];
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({ t: t0 + i * step, dur, midi: midis[order[i % order.length] % n], vel: typeof vel === 'function' ? vel(i) : vel });
  }
  return out;
}
/** deterministic human feel: jitter times (s) and velocities. Returns new events. Don't use on grid-critical hits. */
export function humanize(events, opts = {}) {
  const { timing = 0.006, vel = 0.08, seed = 1 } = opts;
  const rng = mulberry32(seed);
  return events.map((e) => ({ ...e, t: e.t + (rng() - 0.5) * 2 * timing, vel: e.vel != null ? clamp(e.vel + (rng() - 0.5) * 2 * vel, 0.05, 1) : e.vel }));
}
export const transposeEvents = (events, semis) => events.map((e) => ({ ...e, midi: e.midi + semis }));

/**
 * renderEvents(events, instrument, opts) -> Buf (or opts.buf mixed into)
 *   events:     [{t (s), dur, midi, vel, gainDb?, pan?, ...anything your instrument needs}]
 *   instrument: (ev, ctx) => Float32Array | Buf | {L,R}   rendered note starting at its own t=0
 *               ctx = {i, hz: midiToHz(ev.midi), rng (seeded per event), seed}
 *   opts: {seconds=60, buf, gainDb=0, pan=0, seed=1, cache: (ev)=>key|null (memoise identical notes), maxT}
 * Notes starting before 0 or after the buffer end are clipped by addAt.
 */
export function renderEvents(events, instrument, opts = {}) {
  const { seconds = DURATION, gainDb = 0, pan = 0, seed = 1, cache = null } = opts;
  const buf = opts.buf || new Buf(seconds);
  const memo = new Map();
  events.forEach((ev, i) => {
    let out;
    const key = cache ? cache(ev) : null;
    if (key != null && memo.has(key)) out = memo.get(key);
    else {
      const rng = mulberry32(key != null ? seedOf(seed, key) : seedOf(seed, i, Math.round(ev.t * 1000), ev.midi != null ? ev.midi : 0));
      out = instrument(ev, { i, hz: ev.midi != null ? midiToHz(ev.midi) : 0, rng, seed });
      if (key != null) memo.set(key, out);
    }
    if (!out) return;
    const src = isBuf(out) || out instanceof Float32Array ? out : Buf.from(out.L, out.R);
    addAt(buf, src, ev.t, gainDb + (ev.gainDb || 0), ev.pan != null ? ev.pan : pan);
  });
  return buf;
}
export { SR, midiToHz, noteToMidi };
