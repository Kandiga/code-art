// Fonts are local woff2 files from @fontsource (SIL OFL), loaded before frame 0.
import { BRAND } from '../../shared/cues.js';

const FS = '/node_modules/@fontsource';
export const FONT_FILES = [
  { family: 'Bebas Neue', url: `${FS}/bebas-neue/files/bebas-neue-latin-400-normal.woff2`, weight: '400' },
  { family: 'Oswald', url: `${FS}/oswald/files/oswald-latin-500-normal.woff2`, weight: '500' },
  { family: 'Oswald', url: `${FS}/oswald/files/oswald-latin-700-normal.woff2`, weight: '700' },
  { family: 'Inter', url: `${FS}/inter/files/inter-latin-400-normal.woff2`, weight: '400' },
  { family: 'Inter', url: `${FS}/inter/files/inter-latin-600-normal.woff2`, weight: '600' },
  { family: 'Inter', url: `${FS}/inter/files/inter-latin-800-normal.woff2`, weight: '800' },
  { family: 'Caveat', url: `${FS}/caveat/files/caveat-latin-500-normal.woff2`, weight: '500' },
  { family: 'Caveat', url: `${FS}/caveat/files/caveat-latin-700-normal.woff2`, weight: '700' },
  { family: 'Special Elite', url: `${FS}/special-elite/files/special-elite-latin-400-normal.woff2`, weight: '400' },
  { family: 'Archivo Black', url: `${FS}/archivo-black/files/archivo-black-latin-400-normal.woff2`, weight: '400' },
];

export async function loadFonts() {
  const faces = FONT_FILES.map((f) => new FontFace(f.family, `url(${f.url}) format("woff2")`, { weight: f.weight }));
  await Promise.all(faces.map(async (ff) => { await ff.load(); document.fonts.add(ff); }));
  // warm every family so first-frame text is correct
  await Promise.all([
    document.fonts.load('48px "Bebas Neue"'), document.fonts.load('500 40px "Oswald"'), document.fonts.load('600 30px "Inter"'),
    document.fonts.load('500 60px "Caveat"'), document.fonts.load('40px "Special Elite"'), document.fonts.load('40px "Archivo Black"'),
  ]);
  await document.fonts.ready;
  return true;
}
export const F = {
  display: (px) => `${px}px "${BRAND.fonts.display}", "Oswald", sans-serif`,
  condensed: (px, w = 500) => `${w} ${px}px "Oswald", sans-serif`,
  label: (px, w = 600) => `${w} ${px}px "Inter", sans-serif`,
  hand: (px, w = 500) => `${w} ${px}px "Caveat", cursive`,
  type: (px) => `${px}px "Special Elite", monospace`,
  black: (px) => `${px}px "Archivo Black", sans-serif`,
};
