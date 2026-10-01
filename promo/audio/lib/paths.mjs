// Project paths (absolute), derived from this file's location: promo/audio/lib/paths.mjs
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const LIB = path.dirname(fileURLToPath(import.meta.url));
export const AUDIO = path.resolve(LIB, '..');
export const ROOT = path.resolve(AUDIO, '..'); // promo/
export const BUILD = path.join(AUDIO, 'build');
export const STEMS = path.join(BUILD, 'stems');
export const TMP = path.join(BUILD, 'tmp');
export const OUT = path.join(ROOT, 'out');
/** absolute path of a stem wav: stemPath('music') -> audio/build/stems/music.wav */
export const stemPath = (name) => path.join(STEMS, name.endsWith('.wav') ? name : name + '.wav');
export const masterPath = path.join(OUT, 'audio_master.wav');
export const ensure = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
