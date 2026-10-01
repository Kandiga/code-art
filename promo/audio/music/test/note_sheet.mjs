// node audio/music/test/note_sheet.mjs name id:midi[:dur[:vel]] ...   -> single-note spectrograms (linear 0-8 kHz) stacked in sheet_<name>.png
import path from 'node:path';
import * as inst from '../instruments.mjs';
import { OUT, dsp, ff, sheet } from './lib.mjs';
const [name, ...specs] = process.argv.slice(2);
const pngs = [];
for (const sp of specs) {
  const [id, midi, dur = '1.5', vel = '0.8'] = sp.split(':');
  const I = inst.INSTRUMENTS[id];
  const d = +dur;
  const notes = I.kind === 'fx' && I.testNotes ? I.testNotes() : [{ t: 0.05, dur: d, midi: +midi, vel: +vel }];
  const buf = I.render(notes, { seconds: d + 2.2 });
  const wav = path.join(OUT, `n_${id}_${midi}.wav`);
  dsp.normalizePeak(buf, -1);
  dsp.writeWav(wav, buf);
  const png = path.join(OUT, `n_${id}_${midi}.png`);
  const hz = process.env.MAXHZ || '8000';
  ff.run(['-i', wav, '-lavfi', `aresample=${2 * +hz},showspectrumpic=s=900x300:legend=1:fscale=lin:drange=80`, '-frames:v', '1', png]);
  pngs.push(png);
}
console.log(sheet(pngs, path.join(OUT, `sheet_${name}.png`)));
