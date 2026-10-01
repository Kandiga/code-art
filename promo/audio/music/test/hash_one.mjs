// prints an md5 of a fixed render of one instrument (used by the cross-process determinism test)
import crypto from 'node:crypto';
import * as inst from '../instruments.mjs';
import { refNotes } from './lib.mjs';
const id = process.argv[2];
const I = inst.INSTRUMENTS[id];
const b = I.render(refNotes(I), { seconds: 12 });
console.log(crypto.createHash('md5').update(Buffer.from(b.L.buffer)).update(Buffer.from(b.R.buffer)).digest('hex').slice(0, 16));
