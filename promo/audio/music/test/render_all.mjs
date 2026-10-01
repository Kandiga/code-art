// node audio/music/test/render_all.mjs [ids...] [--png] [--sheet name]
// Renders the standard phrase (motif over Am then C) for each instrument -> test/<id>.wav (+ spectrogram png), prints stats.
import path from 'node:path';
import * as inst from '../instruments.mjs';
import { OUT, phrase, drumPhrase, stats, f, dsp, ff, sheet } from './lib.mjs';

const args = process.argv.slice(2);
const png = args.includes('--png');
const si = args.indexOf('--sheet');
const sheetName = si >= 0 ? args[si + 1] : null;
const ids = args.filter((a, i) => !a.startsWith('--') && !(si >= 0 && i === si + 1));
const todo = ids.length ? ids : inst.list();
const pngs = [];
for (const id of todo) {
  const I = inst.INSTRUMENTS[id];
  const t0 = process.hrtime.bigint();
  const notes = I.testNotes ? I.testNotes() : I.kind === 'drum' && !['timpani','taiko'].includes(id) ? drumPhrase(id) : phrase(I);
  const buf = I.render(notes, { seconds: 6 });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const s = stats(buf);
  const wav = path.join(OUT, `${id}.wav`);
  dsp.writeWav(wav, buf);
  console.log(`${id.padEnd(14)} ${String(notes.length).padStart(3)} notes ${f(ms, 0).padStart(5)} ms  peak ${f(s.peakDb)} dBFS  rms ${f(s.rmsDb)}  lufs ${f(s.lufs)}  mom ${f(s.momMax)}  dc ${Math.max(Math.abs(s.dcL), Math.abs(s.dcR)).toExponential(1)}  clip ${s.clipped}${s.nan ? ' NaN!' : ''}`);
  if (png || sheetName) {
    const p = path.join(OUT, `${id}.png`);
    ff.spectrogramPng(wav, p, { w: 1000, h: 380, legend: true, drange: 90 });
    pngs.push(p);
  }
}
if (sheetName && pngs.length) console.log(sheet(pngs, path.join(OUT, `sheet_${sheetName}.png`)));
