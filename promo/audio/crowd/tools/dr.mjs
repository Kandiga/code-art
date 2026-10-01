// node audio/crowd/tools/dr.mjs i  -> direct-to-reverb energy of a solo event
import { openLibrary } from '../lib.mjs';
import { planCrowd, synthPlacements } from '../render.mjs';
import { ROOMS } from '../room.mjs';
import { reverb } from '../../lib/dsp.mjs';
const lib = await openLibrary();
const { placements } = planCrowd(lib);
for (const i of process.argv[2].split(',').map(Number)) {
  const b = synthPlacements(lib, placements.filter((p) => p.ev === i));
  const e = (x) => { let s = 0; for (let k = 0; k < x.L.length; k++) s += x.L[k] ** 2 + x.R[k] ** 2; return s; };
  const w = reverb(b.hall, { ...ROOMS.hall, wet: 1, wetOnly: true });
  console.log(i, 'dry dB', (10 * Math.log10(e(b.dry))).toFixed(1), 'wet dB', (10 * Math.log10(e(w))).toFixed(1), 'send bus', (10 * Math.log10(e(b.hall))).toFixed(1));
}
