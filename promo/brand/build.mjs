// brand/build.mjs — regenerates the PROPOSED brand files from the same geometry the film uses (web/engine/amrita2d.js).
//   node brand/build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { markSVG, monoSVG, characterSVG } from '../web/engine/amrita2d.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const out = (n, s) => { fs.writeFileSync(path.join(here, n), s); console.log('wrote brand/' + n, s.length + ' bytes'); };
out('amrita-mark.svg', markSVG({ size: 512 }));
out('amrita-mark-mono.svg', monoSVG({ size: 512 }));
out('amrita-character.svg', characterSVG({ size: 512 }));
out('amrita-character-mono.svg', monoSVG({ size: 512, eyes: true, title: 'Amrita character, one colour (PROPOSAL)' }));
