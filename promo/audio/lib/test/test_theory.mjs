// Tests for theory.mjs against shared/cues.js. Run: node audio/lib/test/test_theory.mjs
import * as th from '../theory.mjs';
import { Buf, SR, noteToMidi, midiToNote, osc } from '../dsp.mjs';
import * as dsp from '../dsp.mjs';
import { check, section, summary } from './harness.mjs';

const names = (a) => a.map((m) => midiToNote(m)).join(' ');
const cues = th.cues;

section('chords');
check('Am close @3 = A3 C4 E4', names(th.chordNotes('Am', 3)) === 'A3 C4 E4', names(th.chordNotes('Am', 3)));
check('F  close @3 = F3 A3 C4', names(th.chordNotes('F', 3)) === 'F3 A3 C4');
check('C  close @4 = C4 E4 G4', names(th.chordNotes('C', 4)) === 'C4 E4 G4');
check('G  close @3 = G3 B3 D4', names(th.chordNotes('G', 3)) === 'G3 B3 D4');
check('Am open @3 = A3 E4 C5', names(th.chordNotes('Am', 3, 'open')) === 'A3 E4 C5', names(th.chordNotes('Am', 3, 'open')));
check('Am wide @3 = A2 E3 C4 E4 A4 C5', names(th.chordNotes('Am', 3, 'wide')) === 'A2 E3 C4 E4 A4 C5', names(th.chordNotes('Am', 3, 'wide')));
check('C bass @2 = C2 G2', names(th.chordNotes('C', 2, 'bass')) === 'C2 G2');
check('colours: Cadd9, C6, Cmaj7, Csus2, Am7, Fmaj7', names(th.chordNotes('Cadd9', 4)) === 'C4 E4 G4 D5' && names(th.chordNotes('C6', 4)) === 'C4 E4 G4 A4' && names(th.chordNotes('Cmaj7', 4)) === 'C4 E4 G4 B4' && names(th.chordNotes('Csus2', 4)) === 'C4 D4 G4' && names(th.chordNotes('Am7', 3)) === 'A3 C4 E4 G4' && names(th.chordNotes('Fmaj7', 3)) === 'F3 A3 C4 E4');
check('opts.add colour == name suffix', names(th.chordNotes('Am', 3, 'close', { add: 'add9' })) === names(th.chordNotes('Amadd9', 3)));
check('inversion 1: C4 E4 G4 -> E4 G4 C5', names(th.chordNotes('C', 4, 'close', { inversion: 1 })) === 'E4 G4 C5');
check('shell/power/drop2/root voicings produce notes', th.chordNotes('Am7', 3, 'shell').length === 3 && th.chordNotes('C', 3, 'power').length === 3 && th.chordNotes('Cmaj7', 4, 'drop2').length === 4 && th.chordNotes('G', 2, 'root').length === 1);
// every chord of the film is diatonic (C major / A minor) in every voicing
const all = [...new Set(cues.CHORDS.flat())];
check(`film chords are Am/F/C/G only: ${all.join(' ')}`, all.every((c) => ['Am', 'F', 'C', 'G'].includes(c)));
check('all voicings of all film chords are in key (C major / A minor)', all.every((c) => ['close', 'open', 'wide', 'bass', 'power', 'shell', 'drop2'].every((v) => th.chordNotes(c, 3, v).every((m) => th.inKey(m)))));
check('chord colours in key: Cadd9 Am7 Fmaj7 Gsus2 C6', ['Cadd9', 'Am7', 'Fmaj7', 'Gsus2', 'C6', 'Fadd9', 'Gadd9'].every((c) => th.chordNotes(c, 3).every((m) => th.inKey(m))));

section('chordForTime / chordSpans (half-bar aware)');
{
  const c0 = th.chordForTime(0), c1 = th.chordForTime(2.5), c2 = th.chordForTime(4.0);
  check('t=0 Am; t=2.5 Am (bar 1); t=4.0 (bar 2) Am; next at 6.0 = F', c0.name === 'Am' && c1.name === 'Am' && c2.name === 'Am' && th.chordForTime(6.0).name === 'F');
  check('bar boundaries exact: t=5.999 Am, t=6.0 F', th.chordForTime(5.999).name === 'Am' && th.chordForTime(6.0).name === 'F');
  const b28a = th.chordForTime(56.0), b28b = th.chordForTime(57.0), b28c = th.chordForTime(56.999);
  check('bar 28 is half-bar: 56.0-57.0 F, 57.0-58.0 G (dominant at 57.0)', b28a.name === 'F' && b28c.name === 'F' && b28b.name === 'G' && b28b.half === 1 && Math.abs(b28b.t0 - 57) < 1e-9 && Math.abs(b28b.t1 - 58) < 1e-9, `${b28a.name}/${b28b.name}`);
  check('final bar C at 58.0 (hit) and 59.99', th.chordForTime(58.0).name === 'C' && th.chordForTime(59.99).name === 'C');
  check('chordForTime clamps t<0 and t>=60', th.chordForTime(-1).name === 'Am' && th.chordForTime(75).name === 'C');
  check('next chord reported', th.chordForTime(56.2).next === 'G' && th.chordForTime(57.2).next === 'C' && th.chordForTime(4.2).next === 'F');
  const spans = th.chordSpans();
  check('chordSpans covers [0,60) contiguously with 31 spans', spans[0].t0 === 0 && spans[spans.length - 1].t1 === 60 && spans.every((s, i) => i === 0 || Math.abs(s.t0 - spans[i - 1].t1) < 1e-9) && spans.length === 31, `${spans.length}`);
  const merged = th.chordSpans(0, 60, { merge: true });
  check('merge joins Am Am Am (bars 0-2) into one 6 s span', merged[0].name === 'Am' && merged[0].t1 === 6 && merged[1].name === 'F');
  check('every chordForTime(t) equals the span containing t (sampled every 1/16 beat)', (() => { for (let t = 0; t < 60; t += 0.03125) { const s = spans.find((x) => t >= x.t0 - 1e-9 && t < x.t1 - 1e-9); if (th.chordForTime(t).name !== s.name) return false; } return true; })());
}

section('grid');
{
  check('barStart(n) = n * 2', th.barStart(0) === 0 && th.barStart(15) === 30 && th.barStart(29) === 58);
  const b = th.beatTimes(0, 2);
  check('beatTimes(0,2) = 0, .5, 1, 1.5', b.join() === '0,0.5,1,1.5');
  check('beatTimes subdiv 4 (16ths) count over 1 bar = 16, last 1.875', th.beatTimes(4, 6, 4).length === 16 && th.beatTimes(4, 6, 4).pop() === 5.875);
  check('beatTimes(26,42,1) has 32 beats on exact multiples of 0.5', (() => { const t = th.beatTimes(26, 42, 1); return t.length === 32 && t.every((v) => Math.abs(v * 2 - Math.round(v * 2)) < 1e-12); })());
  const g = th.beatGrid(0, 4, 2);
  check('beatGrid objects: downbeats at 0 and 2', g.filter((x) => x.downbeat).map((x) => x.t).join() === '0,2' && g[1].sub === 1 && g[3].bt === 1.5);
  check('barOf / beatInBar', th.barOf(5.999) === 2 && th.barOf(6) === 3 && Math.abs(th.beatInBar(6.75) - 1.5) < 1e-9);
}

section('motif');
{
  const ev = th.motifEvents(th.barStart(2));
  check('motif at bar 2 (4.0 s): E4 G4 A4 C5 at 4.0 4.5 4.75 5.0 (cues.MOTIF rhythm)', ev.map((e) => midiToNote(e.midi)).join(' ') === 'E4 G4 A4 C5' && ev.map((e) => e.t).join() === '4,4.5,4.75,5', `${ev.map((e) => e.t)}`);
  check('motif durations 0.5 .25 .25 1.0 s (len*beat)', ev.map((e) => e.dur).join() === '0.5,0.25,0.25,1');
  const turn = th.motifEvents(th.barStart(12), { rhythm: 'even' });
  check("'turn' piano reading: E4 24.0, G4 24.5, A4 25.0, C5 25.5", turn.map((e) => e.t).join() === '24,24.5,25,25.5' && turn.map((e) => midiToNote(e.midi)).join(' ') === 'E4 G4 A4 C5');
  const tr = th.motifEvents(0, { transposeSemis: 12, octave: 1 });
  check('transposeSemis + octave', tr[0].midi === 64 + 24 && tr[3].midi === 72 + 24);
  const st = th.motifEvents(10, { stretch: 2 });
  check('stretch 2 doubles time spans', st.map((e) => e.t).join() === '10,11,11.5,12' && st.map((e) => e.dur).join() === '1,0.5,0.5,2');
  const bars = th.motifBars([2, 3, 4]);
  check('motifBars: 12 events starting 4.0 6.0 8.0', bars.length === 12 && bars[0].t === 4 && bars[4].t === 6 && bars[8].t === 8);
  check('motif notes all in key', ev.every((e) => th.inKey(e.midi)));
  check('custom notes + vel', th.motifEvents(0, { notes: [{ beat: 0, len: 1, midi: 60 }], vel: 0.5 })[0].vel === 0.5);
}

section('scales + patterns + sequencer');
{
  check('scaleNotes A3 minor 1 octave', names(th.scaleNotes('A3', 'minor')) === 'A3 B3 C4 D4 E4 F4 G4 A4');
  check('pentatonic minor', names(th.scaleNotes('A3', 'pentMinor')) === 'A3 C4 D4 E4 G4 A4');
  check('quantizeToScale C# -> C or D (nearest)', [60, 62].includes(th.quantizeToScale(61, 0, 'major')));
  check('inKey: F# out, F in', !th.inKey(66) && th.inKey(65));
  check('steps pattern', th.steps('x.X.', 10, { subdiv: 2 }).map((s) => s.t).join() === '10,10.5' && th.steps('x.X.', 10)[1].accent === true);
  check('euclid(3,8) = x..x..x.', th.euclid(3, 8) === 'x..x..x.' || th.euclid(3, 8).split('x').length === 4, th.euclid(3, 8));
  const a = th.arp(th.chordNotes('Am', 3), 20, { pattern: 'updown', step: 0.25, count: 6 });
  check('arp updown pattern + timing', a.map((e) => midiToNote(e.midi)).join(' ') === 'A3 C4 E4 C4 A3 C4' && a[5].t === 21.25);
  const h1 = th.humanize(a, { seed: 3 }), h2 = th.humanize(a, { seed: 3 });
  check('humanize deterministic and bounded (<= 6 ms)', h1.every((e, i) => e.t === h2[i].t && Math.abs(e.t - a[i].t) <= 0.006));
  // sequencer: renders each note at ev.t; instrument = decaying sine at the event pitch
  const events = th.motifEvents(th.barStart(1));
  const inst = (ev, ctx) => { const n = Math.round((ev.dur + 0.2) * SR); return osc('sine', ctx.hz, n).map((v, i) => v * ev.vel * Math.exp(-i / (0.3 * SR))); };
  const buf = th.renderEvents(events, inst, { seconds: 6 });
  const peakAt = (t) => { let p = 0; for (let i = Math.round(t * SR); i < Math.round((t + 0.02) * SR); i++) p = Math.max(p, Math.abs(buf.L[i])); return p; };
  check('renderEvents places notes on the grid (energy at 2.0/2.5/3.0/3.5, silence before 2.0)', peakAt(2.0) > 0.1 && peakAt(2.5) > 0.1 && peakAt(3.0) > 0.1 && peakAt(3.5) > 0.1 && peakAt(1.9) === 0 && buf.seconds === 6);
  let calls = 0;
  th.renderEvents(th.motifBars([1, 2, 3, 4]), (ev, ctx) => { calls++; return inst(ev, ctx); }, { seconds: 12, cache: (ev) => `${ev.midi}|${ev.dur}|${ev.vel}` });
  check('renderEvents cache memoises identical notes (16 events -> 4 renders)', calls === 4, `${calls}`);
  const x1 = th.renderEvents(events, (ev, ctx) => dsp.noise('white', 4800, 1).map((v) => v * ctx.rng()), { seconds: 6 });
  const x2 = th.renderEvents(events, (ev, ctx) => dsp.noise('white', 4800, 1).map((v) => v * ctx.rng()), { seconds: 6 });
  check('renderEvents deterministic per-event rng', x1.L.every((v, i) => v === x2.L[i]));
}
summary('test_theory');
