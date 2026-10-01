// node audio/crowd/tools/solo.mjs [i,j,..]  -> audio/build/tmp/crowd/ev_<i>_<kind>.wav (each event rendered alone, with room, no limiter) + _dry.wav
import path from 'node:path';
import { openLibrary } from '../lib.mjs';
import { planCrowd, synthPlacements } from '../render.mjs';
import { mixdown } from '../room.mjs';
import { writeWav } from '../../lib/dsp.mjs';
import { TMP, ensure } from '../../lib/paths.mjs';

const lib = await openLibrary();
const { placements, info } = planCrowd(lib);
const only = process.argv[2] ? process.argv[2].split(',').map(Number) : null;
const dir = ensure(path.join(TMP, 'crowd'));
for (const ev of info) {
  if (only && !only.includes(ev.index)) continue;
  const ps = placements.filter((p) => p.ev === ev.index);
  const buses = synthPlacements(lib, ps);
  const mix = mixdown(buses);
  const f = path.join(dir, `ev_${String(ev.index).padStart(2, '0')}_${ev.kind}.wav`);
  writeWav(f, mix);
  writeWav(f.replace('.wav', '_dry.wav'), buses.dry);
  console.log(f);
}
