// =============================================================================
// hud.js — the era HUD (v1).  draw(ctx, T, S, mode)   mode 'paper' (Act I) | 'digital' (the future 2050/2100/2150)
//
//   * bottom FILM STRIP: a 35 mm strip (8 perfs per frame) that scrolls with the running year; every era is a frame cell with a
//     tiny hand-drawn PICTOGRAM, the current cell is lit, amber (paper) / teal (digital) playhead pointers; the strip is one
//     continuous film: 9 eras + 3 futures (the futures are unexposed "?" frames in Act I).
//   * big running YEAR counter (odometer drums, motion-blurred while they roll in the dive beat t0+1.5..t0+2.0); at NOW_T it
//     is stamped over by "NOW" (stamp-down scale pop + glow + hand-drawn double underline + burst ticks).
//   * era CAPTION top-left: a taped paper label with write-on pencil lettering (paper) / decoded condensed type in the top
//     letterbox bar (digital). Out cleanly at each dive; digital: glitchy forward JUMP of the counter at 42.0 / 44.0 / 46.0.
//   Paper mode = drawn on the paper world (pencil fill, hatch, doubled ink, multiply) with 12 fps boil. Digital = crisp.
// Pure function of T (no state between frames); only seeded caches (strip body textures, pictogram geometry, font metrics).
// Extra exports (additive): PICTO_IDS, drawPictogram, captionBox, counterBox, HUD_RECTS.
// =============================================================================
import { ERAS, FUTURES, yearAt, BRAND, NOW_T, eraIndexAt } from '../../shared/cues.js';
import { F } from './fonts.js';
import * as P from './pencil.js';
import { clamp, lerp, smooth, outCubic, spring } from './ease.js';
import { hash } from './rng.js';

const pal = BRAND.palette;
const INK = pal.ink, GRAPH = pal.graphite, PAPER = pal.paper, CREAM = pal.cream, AMBER = pal.amber, VERM = pal.vermilion, TEAL = pal.teal, VIOLET = pal.violet, SKY = pal.sky;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- layout (logical 1920x1080) ---------------------------------
const BAND = { y: 955, h: 92 }; // the film strip: y 955..1047 (scenes keep y>955 clear); text/pictograms stay inside the 90 % safe area
const PERF_H = 13; // perforation row height
const HEAD_X = 830; // playhead x (centre of the lit cell)
const PITCH = 116, CELL_W = 98; // one frame = 8 perforations (pitch 14.5)
const HOLE_P = PITCH / 8;
const CELL_Y = BAND.y + PERF_H + 2, CELL_H = BAND.h - 2 * PERF_H - 4; // 970..1030
const PLATE = { x: 96, y: BAND.y, h: BAND.h };
const DIGIT_PX = 88, DIGIT_CAP = DIGIT_PX * 0.7, COL_W = 44, N_COL = 4, PLATE_W = COL_W * N_COL + 44;
const BASE_Y = 1025; // digit baseline (text stays above y=1026)
export const HUD_ZONES = {
  caption: { x: 96, y: 54, w: 900, h: 110 },
  strip: { x: 0, y: BAND.y, w: 1920, h: BAND.h },
  counter: { x: PLATE.x, y: BAND.y, w: PLATE_W, h: BAND.h },
};
// rects of what the HUD really draws (for QA / other agents): per mode, given T
export function captionBox(ctx, T, mode = 'paper') {
  const e = T.era || ERAS[Math.max(0, eraIndexAt(T.t))];
  if (mode === 'digital') return { x: 96, y: 56, w: 760, h: 78 };
  const tw = P.measure(ctx, e.caption, F.hand(66, 700));
  return { x: 96, y: 58, w: tw + 60, h: 84 };
}
export const counterBox = () => ({ ...HUD_ZONES.counter });
export const HUD_RECTS = HUD_ZONES;

// ---------------------------------------------------------------- tiny utils -----------------------------------------------
const jit = (i, boil, seed, amp) => (hash(i | 0, boil | 0, seed | 0) - 0.5) * 2 * amp;
const rgba = P.rgba;
const rr = (x, y, w, h, r) => P.rectPts(x, y, w, h, r, 4);
const ci = (cx, cy, r, n = 16) => P.circlePts(cx, cy, r, n);
const el = (cx, cy, rx, ry, rot = 0, n = 18) => P.ellipsePts(cx, cy, rx, ry, rot, n);
function rpath(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function resetCtx(ctx) {
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.shadowBlur = 0; ctx.shadowColor = 'rgba(0,0,0,0)';
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.letterSpacing = '0px'; ctx.setLineDash([]); ctx.lineWidth = 1; ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
}
const fontOK = (font) => { try { return document.fonts.check(font); } catch { return true; } };

// ================================================================ PICTOGRAMS ===============================================
// Geometry lives in a 80 x 42 box centred on (0,0) (x -40..40, y -21..21, y down). Each op: {p: pts, f: fill colour, h: hatch colour,
// line: open polyline, w: line weight, c: closed?, text, x, y, px, dot: tiny filled dot, a: accent (digital) 't|a|v|s|c'}.
const K = {
  ink: GRAPH, dark: '#3B3846', paper: '#FBF6E8', sand: '#E9C98B', verm: VERM, amber: AMBER, sky: SKY, teal: TEAL, violet: VIOLET,
  moon: '#FFD56B', grass: '#8CC472', hill: P.mix(TEAL, '#9BD071', 0.5), dune: '#E8A25A', lav: P.lighten(VIOLET, 0.5), cyan: '#46D3E6',
};
const heartPts = (cx, cy, s, n = 22) => Array.from({ length: n }, (_, i) => {
  const a = (i / n) * TAU, x = 16 * Math.sin(a) ** 3, y = -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a));
  return [cx + (x * s) / 16, cy + (y * s) / 16 + s * 0.12];
});
const starPts = (cx, cy, r, rot = 0, k = 0.38) => Array.from({ length: 8 }, (_, i) => { const a = rot + (i / 8) * TAU - Math.PI / 2, rad = i % 2 ? r * k : r; return [cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]; });
function crescent(c1x, c1y, r1, c2x, c2y, r2, n = 22) {
  const dx = c2x - c1x, dy = c2y - c1y, d = Math.hypot(dx, dy), phi = Math.atan2(dy, dx);
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, r1 * r1 - a * a)), th = Math.atan2(h, a), b = Math.atan2(h, a - d), out = [];
  for (let i = 0; i <= n; i++) { const t = phi + th + (i / n) * (TAU - 2 * th); out.push([c1x + Math.cos(t) * r1, c1y + Math.sin(t) * r1]); }
  for (let i = 1; i < n; i++) { const t = phi - b - (i / n) * (TAU - 2 * b); out.push([c2x + Math.cos(t) * r2, c2y + Math.sin(t) * r2]); }
  return out;
}
function ribbon(center, w0, w1) {
  const n = center.length, L = [], R = [];
  for (let i = 0; i < n; i++) {
    const p = center[i], q = center[Math.min(n - 1, i + 1)], o = center[Math.max(0, i - 1)];
    let tx = q[0] - o[0], ty = q[1] - o[1]; const m = Math.hypot(tx, ty) || 1; tx /= m; ty /= m;
    const w = lerp(w0, w1, i / (n - 1)) / 2;
    L.push([p[0] - ty * w, p[1] + tx * w]); R.push([p[0] + ty * w, p[1] - tx * w]);
  }
  return [...L, ...R.reverse()];
}
const arcPts = (cx, cy, r, a0, a1, n = 14) => Array.from({ length: n + 1 }, (_, i) => { const a = lerp(a0, a1, i / n); return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; });
const deg = (d) => (d * Math.PI) / 180;

const PICTOS = {};
// 1895 - steam locomotive (side view) with steam puffs
PICTOS.train = [
  { p: [[-40, 19.5], [40, 19.5]], line: 1, w: 0.9 },
  { p: rr(-15, -6, 46, 16, 6), f: K.dark, h: INK },
  { p: rr(-35, -15, 23, 25, 2), f: K.verm, h: P.darken(K.verm, 0.35) },
  { p: rr(-37, -17.5, 27, 4, 1), f: K.ink },
  { p: rr(-31, -10.5, 10, 8, 1.5), f: K.sky, s: 1 },
  { p: [[17, -6], [17, -12], [13.5, -16], [27, -16], [23.5, -12], [23.5, -6]], f: K.ink },
  { p: el(3, -8.5, 5, 4, 0, 14), f: K.amber, s: 1 },
  { p: ci(31.5, 0.5, 3.6, 12), f: K.amber, s: 1 },
  { p: [[27, 10], [40, 18.5], [26, 18.5]], f: K.dark },
  { p: ci(-22, 13.5, 7), f: '#E7DDC6' }, { p: ci(-5, 14.8, 5.2), f: '#E7DDC6' }, { p: ci(10, 15.5, 4.4), f: '#E7DDC6' }, { p: ci(24, 15.5, 4.4), f: '#E7DDC6' },
  { p: [[-22, 13.5], [10, 15.5]], line: 1, w: 0.8 },
  { p: ci(-22, 13.5, 1.5, 8), f: K.ink, dot: 1 },
  { p: ci(20, -21, 3.1, 10), w: 0.8 }, { p: ci(13.5, -20.5, 3.9, 10), w: 0.8 }, { p: ci(5, -19, 3.1, 10), w: 0.7 },
];
// 1902 - painted crescent moon with a sleepy face + stars
PICTOS.moon = [
  { p: crescent(-6, 0, 19.5, 5, -1.5, 16), f: K.moon, h: P.darken(K.moon, 0.25), w: 1.1 },
  { p: arcPts(-14, -5.5, 4.2, deg(30), deg(150), 8), line: 1, w: 0.9, a: 'c' },
  { p: ci(-14.5, 2.5, 2.8, 8), f: K.verm, dot: 1 },
  { p: [[-23, -1], [-26, 2], [-23, 4]], line: 1, w: 0.9 },
  { p: starPts(24, -10, 6, 0.1), f: K.amber, a: 'a' }, { p: starPts(31, 9, 4, 0.4), f: K.amber, a: 'a' }, { p: starPts(14, 13, 3.4, 0), f: K.sky, a: 's' },
  { p: ci(35, -2, 1.1, 6), f: K.ink, dot: 1 }, { p: ci(18, -17, 1.1, 6), f: K.ink, dot: 1 },
];
// 1927 - speech balloon with the first spoken word
(() => {
  const n = 30, rx = 30, ry = 15, cx = 0, cy = -3, ptsB = [], a0 = deg(112), a1 = deg(142);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    if (a > a0 && a < a1) { if (!ptsB.tail) { ptsB.push([-24, 20]); ptsB.tail = 1; } continue; }
    ptsB.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  delete ptsB.tail;
  PICTOS.balloon = [
    { p: ptsB, f: K.paper, h: '#C9BFA8' },
    { text: 'Hello!', x: 0, y: 2.6, px: 19, color: INK },
    { p: [[27, -17], [33, -21]], line: 1, w: 0.8 }, { p: [[32, -10], [39, -12]], line: 1, w: 0.8 }, { p: [[-33, -14], [-38, -19]], line: 1, w: 0.8 },
  ];
})();
// 1939 - a winding road through candy hills to a castle with a round window
(() => {
  const road = [], N = 12;
  const cl = (t) => 6.5 - 8 * t + 12 * Math.sin(t * 5.2) * (0.25 + t * 0.55), wd = (t) => 2 + 20 * t * t + 5 * t;
  for (let i = 0; i <= N; i++) { const t = i / N; road.push([cl(t) - wd(t) / 2, -5 + 26 * t]); }
  for (let i = N; i >= 0; i--) { const t = i / N; road.push([cl(t) + wd(t) / 2, -5 + 26 * t]); }
  const dash = [];
  for (let i = 2; i <= N; i += 3) { const t0 = i / N, t1 = Math.min(1, (i + 1.2) / N); dash.push({ p: [[cl(t0), -5 + 26 * t0], [cl(t1), -5 + 26 * t1]], line: 1, w: 0.9, ink: K.amber }); }
  PICTOS.road = [
    { p: ci(-27, -13, 5, 12), f: K.amber, a: 'a' },
    { p: P.smoothPts([[-40, 8], [-30, -2], [-16, 2], [0, -7], [16, -1], [40, -6], [40, 21], [-40, 21]], { closed: true, n: 5 }), f: K.hill, h: P.darken(K.hill, 0.3) },
    { p: rr(1.5, -17, 4.6, 10, 0.5), f: K.verm }, { p: rr(8, -20, 5, 13, 0.5), f: K.verm }, { p: rr(4.5, -14, 5, 7, 0.5), f: K.amber, a: 'a' },
    { p: [[0.5, -17], [3.8, -22], [7, -17]], f: K.violet, a: 'v' }, { p: [[7, -20], [10.5, -25], [14, -20]], f: K.violet, a: 'v' },
    { p: ci(10.5, -14.5, 1.6, 8), f: K.sky, dot: 1, a: 's' },
    { p: road, f: K.sand, h: P.darken(K.sand, 0.25), a: 'c' },
    ...dash,
  ];
})();
// 1960 - desert epic: huge sun on the dunes, a caravan
(() => {
  const rays = [];
  for (let i = 0; i < 9; i++) { const a = deg(-170 + i * 20), r0 = 15.5, r1 = i % 2 ? 19.5 : 21; rays.push({ p: [[Math.cos(a) * r0, 4 + Math.sin(a) * r0], [Math.cos(a) * r1, 4 + Math.sin(a) * r1]], line: 1, w: 1, ink: K.amber, a: 'a' }); }
  const cam = (x, y) => [{ p: el(x, y, 2.8, 1.7, 0, 8), f: K.ink, dot: 1 }, { p: [[x - 2, y + 1.1], [x - 2.3, y + 4]], line: 1, w: 0.7 }, { p: [[x + 2, y + 1.1], [x + 2.2, y + 4]], line: 1, w: 0.7 }, { p: [[x + 2.4, y - 0.8], [x + 3.9, y - 3.2]], line: 1, w: 0.8 }];
  PICTOS.sun = [
    ...rays,
    { p: ci(2, 4.5, 12.5, 22), f: K.amber, h: K.verm, a: 'a' },
    { p: ci(2, 4.5, 6.6, 14), f: K.moon, dot: 1, a: 'a' },
    { p: P.smoothPts([[-40, 21], [-40, 11], [-27, 6.5], [-12, 12.5], [6, 9], [24, 14], [40, 10], [40, 21]], { closed: true, n: 5 }), f: K.dune, h: P.darken(K.dune, 0.3) },
    { p: P.smoothPts([[-40, 21], [-40, 17], [-22, 15.5], [0, 19], [18, 17], [40, 19.5], [40, 21]], { closed: true, n: 5 }), f: P.darken(K.dune, 0.12), w: 0.8 },
    ...cam(15, 9.8), ...cam(23, 12.2), ...cam(31, 11.6),
    { p: ci(-31, -7, 2, 8), f: K.paper, w: 0.8 }, { p: ci(-36, -1, 1.2, 6), f: K.paper, w: 0.7 },
  ];
})();
// 1977 - cardboard starship on strings, laser bolt
PICTOS.ship = [
  { p: [[-9, -7], [-9, -21]], line: 1, w: 0.6 }, { p: [[14, -5], [14, -21]], line: 1, w: 0.6 },
  { p: [[39, 0], [15, -5.5], [-8, -8], [-25, -19], [-23, -5], [-31, -3.5], [-31, 3.5], [-23, 5], [-25, 19], [-8, 8], [15, 5.5]], f: K.sand, h: P.darken(K.sand, 0.3) },
  { p: [[-8, -8], [-3, 0], [-8, 8]], line: 1, w: 0.7 }, { p: [[15, -5.5], [20, 0], [15, 5.5]], line: 1, w: 0.7 },
  { p: el(21, 0, 8, 3.2, 0, 14), f: K.sky, s: 1, a: 's' },
  { p: [[-31, -2.5], [-40, 0], [-31, 2.5]], f: K.amber, a: 'a' },
  { p: ci(-5, 0, 2.2, 8), f: K.verm, dot: 1, a: 'a' },
  { p: [[27, -15], [38.5, -11.5]], line: 1, w: 1.6, ink: K.verm, a: 'a' },
  { p: starPts(-34, -14, 3.6), f: K.amber, a: 'a' }, { p: starPts(30, 15, 3), f: K.amber, a: 'a' }, { p: ci(-34, 15, 1, 6), f: K.ink, dot: 1 },
];
// 1993 - wireframe creature (half flat-shaded) on a grid floor
PICTOS.creature = [
  { p: [[-40, 19.5], [40, 19.5]], line: 1, w: 0.7, ink: K.teal },
  { p: [[-34, 21], [-22, 19.5]], line: 1, w: 0.6, ink: K.teal }, { p: [[0, 21], [0, 19.5]], line: 1, w: 0.6, ink: K.teal }, { p: [[26, 21], [18, 19.5]], line: 1, w: 0.6, ink: K.teal },
  { p: [[10.5, 8], [13.5, 14], [12, 19.5]], line: 1, w: 1 }, { p: [[4.5, 9], [7.5, 14], [5, 19.5]], line: 1, w: 1 },
  { p: [[-13, 8], [-17, 14], [-14, 19.5]], line: 1, w: 1 }, { p: [[-7.5, 9], [-9.5, 14], [-7, 19.5]], line: 1, w: 1 },
  { p: [[-19, -1], [-27, -5], [-32, -12], [-38, -14]], line: 1, w: 1 },
  { p: [[10, -4], [15, -8], [26, -17], [22, -9], [14, 2]], f: K.paper, h: K.teal, a: 't' },
  { p: el(-3, 1.5, 17, 8.5, 0, 24), f: P.lighten(K.teal, 0.35), h: K.teal, a: 't' },
  { p: el(-3, 1.5, 9, 8.5, 0, 18), line: 0, c: 1, w: 0.7, ink: K.teal }, { p: [[-20, 1.5], [14, 1.5]], line: 1, w: 0.6, ink: K.teal },
  { p: [[-9, -6], [-7.5, -11], [-5, -6.5]], f: K.teal, a: 't' }, { p: [[-1, -7], [0.5, -12], [3, -7.2]], f: K.teal, a: 't' }, { p: [[7, -6.5], [8.5, -10.5], [10, -5]], f: K.teal, a: 't' },
  { p: [[24, -17.5], [35, -14.5], [37, -10.5], [28.5, -9.5]], f: K.paper, h: K.teal, a: 't' },
  { p: ci(29.5, -13.8, 1.6, 8), f: K.verm, dot: 1, s: 1, a: 'a' }, { p: [[30, -10.5], [36, -11.5]], line: 1, w: 0.7 },
];
// 2009 - chunky 3D glasses, red / cyan, with a pop-out star
PICTOS.glasses = [
  { p: [[-37, -3], [-40.5, -8]], line: 1, w: 1.2 }, { p: [[37, -3], [40.5, -8]], line: 1, w: 1.2 },
  { p: P.smoothPts([[-8, -4], [-3, -8.5], [3, -8.5], [8, -4]], { n: 6 }), line: 1, w: 1.3 },
  { p: rr(-37, -9, 30, 24, 8), f: K.verm, w: 1.8 }, { p: rr(7, -9, 30, 24, 8), f: K.cyan, w: 1.8, a: 's' },
  { p: [[-31, -3], [-24, -3]], line: 1, w: 0.9, ink: K.paper }, { p: [[13, -3], [20, -3]], line: 1, w: 0.9, ink: K.paper },
  { p: [[-33, 4], [-28, -1]], line: 1, w: 0.9, ink: K.paper }, { p: [[11, 4], [16, -1]], line: 1, w: 0.9, ink: K.paper },
  { p: starPts(0, -16, 4.4, 0.2), f: K.amber, a: 'a' }, { p: starPts(-20, -17, 2.8), f: K.amber, a: 'a' }, { p: starPts(21, -17.5, 2.8), f: K.amber, a: 'a' },
  { p: [[-32, 19.5], [32, 19.5]], line: 1, w: 0.5, ink: '#C9BFA8' },
];
// 2025 - vertical phone video: hearts + record dot
PICTOS.phone = [
  { p: rr(-12, -20, 24, 40, 5), f: K.dark, w: 1.3 },
  { p: rr(-9.6, -16.5, 19.2, 33, 2.5), f: K.lav, s: 1 },
  { p: ci(-5.5, -12.5, 1.9, 8), f: K.verm, dot: 1, s: 1, a: 'a' },
  { p: heartPts(0, 1.5, 6.4), f: K.verm, s: 1, a: 'a' },
  { p: [[-6, 12.5], [6, 12.5]], line: 1, w: 0.9, ink: K.dark },
  { p: heartPts(-25, -8, 5.6), f: K.verm, a: 'a' }, { p: heartPts(24, -13, 4.2), f: K.amber, a: 'a' }, { p: heartPts(27, 7, 3.2), f: K.verm, a: 'a' },
  { p: rr(-39, 5, 15, 9, 3), f: K.paper }, { p: [[-36, 14], [-34, 18], [-31, 14]], f: K.paper },
];
// 2050 - hologram cube on a projector disc
PICTOS.holo = [
  { p: el(0, 16.5, 15, 3.6, 0, 20), f: K.paper, h: K.teal, a: 't' }, { p: el(0, 16.5, 8, 1.8, 0, 14), line: 0, c: 1, w: 0.7 },
  { p: [[-13, 15.5], [-21, -5]], line: 1, w: 0.7, dash: 1 }, { p: [[13, 15.5], [21, -5]], line: 1, w: 0.7, dash: 1 },
  { p: [[0, -19], [11, -13], [11, 0], [0, 6], [-11, 0], [-11, -13]], f: P.lighten(K.teal, 0.55), a: 't', w: 1.2 },
  { p: [[-11, -13], [0, -7], [11, -13]], line: 1, w: 0.9 }, { p: [[0, -7], [0, 6]], line: 1, w: 0.9 },
  { p: [[-3, -5.8], [-3, 1.6], [4, -2.2]], f: K.amber, s: 1, a: 'a', w: 0.7 },
  { p: starPts(-26, -14, 3.4), f: K.sky, a: 's' }, { p: starPts(27, -16, 2.6), f: K.sky, a: 's' }, { p: ci(30, 3, 1.1, 6), f: K.ink, dot: 1 }, { p: ci(-31, 1, 1.1, 6), f: K.ink, dot: 1 },
];
// 2100 - brain with thought ribbons
(() => {
  const bump = Array.from({ length: 44 }, (_, i) => { const a = (i / 44) * TAU, r = 1 + 0.085 * Math.sin(a * 9 + 0.6) + 0.04 * Math.sin(a * 5); return [-8 + Math.cos(a) * 21 * r, -2 + Math.sin(a) * 14.5 * r * (Math.sin(a) > 0 ? 0.9 : 1)]; });
  const r1 = P.bezier([13, -6], [26, -20], [30, -2], [41, -12], 16), r2 = P.bezier([13, -1], [26, 4], [30, -8], [41, 2], 16), r3 = P.bezier([11, 4], [24, 18], [32, 6], [41, 15], 16);
  PICTOS.brain = [
    { p: ribbon(r1, 4.5, 1), f: K.violet, a: 'v', w: 0.8 }, { p: ribbon(r2, 4.5, 1), f: K.teal, a: 't', w: 0.8 }, { p: ribbon(r3, 4.5, 1), f: K.amber, a: 'a', w: 0.8 },
    { p: bump, f: K.lav, h: K.violet, a: 'v', w: 1.2 },
    { p: P.smoothPts([[-8, -15], [-6, -9], [-10, -5], [-7, 1], [-9, 6], [-8, 11]], { n: 5 }), line: 1, w: 0.8 },
    { p: P.smoothPts([[-24, -3], [-19, -7], [-15, -3]], { n: 5 }), line: 1, w: 0.8 }, { p: P.smoothPts([[-21, 5], [-16, 2], [-13, 7]], { n: 5 }), line: 1, w: 0.8 },
    { p: P.smoothPts([[-1, -9], [3, -5], [8, -8]], { n: 5 }), line: 1, w: 0.8 }, { p: P.smoothPts([[-3, 4], [2, 1], [7, 5]], { n: 5 }), line: 1, w: 0.8 },
    { p: starPts(-31, -16, 3), f: K.amber, a: 'a' }, { p: ci(-34, 11, 1.1, 6), f: K.ink, dot: 1 },
  ];
})();
// 2150 - particle dome with the audience made of light
(() => {
  const ops = [];
  [10, 16.5, 23].forEach((R, ri) => {
    const n = [9, 14, 20][ri], col = [K.teal, K.sky, K.violet][ri], acc = ['t', 's', 'v'][ri];
    for (let i = 0; i < n; i++) {
      const a = deg(-176 + (172 * (i + 0.5)) / n) + (hash(ri, i, 5) - 0.5) * 0.08, rr0 = R + (hash(ri, i, 9) - 0.5) * 2.4, s = 0.9 + hash(ri, i, 3) * 0.9;
      ops.push({ p: ci(Math.cos(a) * rr0, 9 + Math.sin(a) * rr0, s, 6), f: col, dot: 1, a: acc });
    }
  });
  ops.push({ p: arcPts(0, 9, 26.5, deg(-180), deg(0), 28), line: 1, w: 0.7, dash: 1 });
  ops.push({ p: starPts(0, -1, 5, 0.2, 0.45), f: K.amber, a: 'a' });
  for (let r = 0; r < 2; r++) for (let i = 0; i < 12; i++) { const x = -34 + i * 6.2 + (r ? 3.1 : 0); ops.push({ p: ci(x, 16.5 + r * 4.4, 1.7, 6), f: K.ink, dot: 1, a: 't' }); }
  PICTOS.dome = ops;
})();
// the unexposed frame of a future we have not reached yet
PICTOS.unknown = [{ text: '?', x: 0, y: 8, px: 34, color: CREAM }];

export const PICTO_IDS = Object.keys(PICTOS);
const ACCENT = { t: TEAL, a: AMBER, v: VIOLET, s: SKY, c: CREAM };
const accentOf = (op) => (op.a ? ACCENT[op.a] : TEAL);

function fillTiny(ctx, pts, color, k, boil, seed, alpha = 0.95, solid = false) {
  const w = P.wobble(P.resample(pts, 3.2, true), { boil, amp: 0.4, seed: seed + 3, closed: true });
  ctx.save(); ctx.globalCompositeOperation = solid ? 'source-over' : 'multiply'; ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.translate(solid ? 0 : 1.1 * k, solid ? 0 : 0.9 * k);
  ctx.beginPath(); ctx.moveTo(w[0][0], w[0][1]); for (let i = 1; i < w.length; i++) ctx.lineTo(w[i][0], w[i][1]); ctx.closePath(); ctx.fill(); ctx.restore();
}
// Draw pictogram `id` centred at (cx,cy). size = scale (1 = 80x42 px). o: {mode:'paper'|'digital', boil, seed, lit, glow, color}
export function drawPictogram(ctx, id, cx, cy, size = 1, o = {}) {
  const ops = PICTOS[id]; if (!ops) return;
  const k = size, boil = o.boil | 0, seed = (o.seed | 0) + 11, dig = o.mode === 'digital', lit = o.lit ?? 1;
  ctx.save();
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.text) {
      if (dig) { ctx.font = F.hand(op.px * k, 700); ctx.textAlign = 'center'; ctx.fillStyle = rgba(op.color === CREAM ? TEAL : TEAL, 0.9 * lit); ctx.fillText(op.text, cx + op.x * k, cy + op.y * k); }
      else P.text(ctx, op.text, cx + op.x * k, cy + op.y * k, { font: F.hand(op.px * k, 700), color: op.color || GRAPH, align: 'center', boil, seed: seed + i, amp: 0.35, doubled: false });
      continue;
    }
    const pts = P.xform(op.p, { x: cx, y: cy, sx: k });
    const closed = !op.line && op.c !== false;
    if (dig) {
      const col = op.ink && op.ink !== GRAPH && op.ink !== K.paper ? (op.a ? accentOf(op) : TEAL) : accentOf(op);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let j = 1; j < pts.length; j++) ctx.lineTo(pts[j][0], pts[j][1]); if (closed) ctx.closePath();
      if (op.dot) { ctx.fillStyle = rgba(col, 0.95 * lit); ctx.fill(); continue; }
      if (closed && op.f) { ctx.fillStyle = rgba(col, 0.16 * lit); ctx.fill(); }
      ctx.setLineDash(op.dash ? [3 * k, 2.5 * k] : []); ctx.strokeStyle = rgba(col, (op.ink === K.paper ? 0.5 : 0.95) * lit); ctx.lineWidth = Math.max(0.9, 1.35 * k * (op.w || 1)); ctx.stroke(); ctx.setLineDash([]);
      continue;
    }
    if (op.line) { P.ink(ctx, pts, { closed: false, color: op.ink || GRAPH, width: Math.max(0.9, 1.5 * k * (op.w || 1)), amp: 0.42, passes: 2, step: 4, boil, seed: seed + i, alpha: 0.95, taper: false }); continue; }
    if (op.dot) { fillTiny(ctx, pts, op.f, k, boil, seed + i, 1); ctx.save(); ctx.fillStyle = op.f; ctx.globalAlpha = 0.9; ctx.beginPath(); pts.forEach((p, j) => (j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill(); ctx.restore(); continue; }
    if (op.f) fillTiny(ctx, pts, op.f, k, boil, seed + i, 0.95, !!op.s);
    if (op.h) P.hatch(ctx, pts, { color: op.h, gap: Math.max(2.4, 3.2 * k), width: 0.8, alpha: 0.5, boil, seed: seed + i, angle: -0.85, jitter: 0.35, segLen: 12 * k, comp: 'multiply' });
    P.ink(ctx, pts, { closed, color: op.ink || GRAPH, width: Math.max(0.9, 1.45 * k * (op.w || 1)), amp: 0.42, passes: 2, step: 4, boil, seed: seed + i, alpha: 0.95 });
  }
  ctx.restore();
}

// ================================================================ cells (strip frames) =====================================
const CELLS = [
  ...ERAS.map((e) => ({ id: e.id, year: e.year, picto: { e1895: 'train', e1902: 'moon', e1927: 'balloon', e1939: 'road', e1960: 'sun', e1977: 'ship', e1993: 'creature', e2009: 'glasses', e2025: 'phone' }[e.id] })),
  ...FUTURES.map((f) => ({ id: f.id, year: f.year, picto: { f2050: 'holo', f2100: 'brain', f2150: 'dome' }[f.id] })),
];
const N_ERA = ERAS.length;

// ---- the film strip body (paper): pencil-shaded black film with a doubled ink edge, cached per boil variant ----------------
const bodyCache = new Map();
function stripBody(S, variant) {
  const key = S.scale + ':' + variant;
  if (bodyCache.has(key)) return bodyCache.get(key);
  const W = 1960, H = BAND.h + 8, c = S.mk(Math.round(W * S.scale), Math.round(H * S.scale)), g = c.getContext('2d');
  g.setTransform(S.scale, 0, 0, S.scale, 0, 0);
  const y0 = 4, h = BAND.h;
  const gr = g.createLinearGradient(0, y0, 0, y0 + h); gr.addColorStop(0, '#2B2933'); gr.addColorStop(0.5, '#211F28'); gr.addColorStop(1, '#17151C');
  g.fillStyle = gr; g.fillRect(0, y0, W, h);
  g.save(); g.beginPath(); g.rect(0, y0, W, h); g.clip(); g.lineCap = 'round';
  for (let i = 0; i < W / 3.1; i++) { // pencil shading: diagonal strokes, dark + light
    const x = i * 3.1 + (hash(i, variant, 1) - 0.5) * 2, t0 = hash(i, variant, 2) * 0.35, t1 = t0 + 0.4 + hash(i, variant, 3) * 0.6, dx = 0.7 * h;
    g.strokeStyle = hash(i, 5, 7) < 0.7 ? 'rgba(8,7,12,0.5)' : 'rgba(255,243,214,0.07)'; g.lineWidth = 1.1 + hash(i, 4, 4) * 0.6;
    g.beginPath(); g.moveTo(x + dx * t0, y0 + h * t0); g.lineTo(x + dx * t1, y0 + h * t1); g.stroke();
  }
  g.restore();
  g.fillStyle = 'rgba(255,243,214,0.10)'; g.fillRect(0, y0 + 1.5, W, 1.5); // top bevel
  const o = { closed: false, color: INK, width: 3, amp: 1.0, passes: 2, step: 10, boil: variant, alpha: 0.95 };
  P.ink(g, [[0, y0], [W, y0]], { ...o, seed: 11 }); P.ink(g, [[0, y0 + h], [W, y0 + h]], { ...o, seed: 23 });
  bodyCache.set(key, c);
  return c;
}

// ---- digit metrics -------------------------------------------------------------------------------------------------------
function colPos(v) { // odometer drum positions [thousands, hundreds, tens, units] for a (fractional) year v
  const m10 = v % 10, m100 = v % 100, m1000 = v % 1000;
  return [Math.floor(v / 1000) + clamp(m1000 - 999), Math.floor(v / 100) + clamp(m100 - 99), Math.floor(v / 10) + clamp(m10 - 9), v];
}
const wrapDigit = (n) => ((Math.floor(n) % 10) + 10) % 10;
// one drum column: digits roll up as the value increases, cylinder-foreshortened and faded toward the window edges
function drumColumn(ctx, pos, cx, capMid, rowH, px, fill, alpha) {
  const base = Math.floor(pos), fr = pos - base;
  for (let d = -1; d <= 2; d++) {
    const off = d - fr; if (off < -1.1 || off > 1.1) continue;
    const a = alpha * (1 - Math.min(1, Math.abs(off)) ** 1.5 * 0.92), sy = Math.max(0.35, Math.cos(clamp(off, -1.1, 1.1) * 0.9));
    ctx.save(); ctx.translate(cx, capMid + off * rowH); ctx.scale(1, sy); ctx.globalAlpha *= a; ctx.fillStyle = fill; ctx.fillText(String(wrapDigit(base + d)), 0, DIGIT_CAP / 2); ctx.restore();
  }
}

// year at a (motion-blur) sample time, clamped to the visible window of the current segment so shutter samples never read the "hidden" year
const yearSample = (ts, dig) => yearAt(dig ? clamp(ts, 42, 50 - 1e-3) : clamp(ts, 4, 22 - 1e-3));

// ================================================================ PAPER MODE ===============================================
function stripScroll(y, e, t) { // fractional cell index under the playhead (+ a tiny mechanical settle after each landing)
  const cur = e.index + (y.roll || 0);
  const tl = t - e.t0; // time since the era started (= landing of the previous roll)
  const settle = e.index > 0 && tl >= 0 && tl < 0.5 ? 0.05 * Math.exp(-tl * 13) * Math.sin(tl * 34) : 0;
  return cur + settle;
}

function drawHoles(ctx, scroll, boil, dig) {
  const m0 = Math.floor((scroll - HEAD_X) / HOLE_P) - 2, n = Math.ceil(1920 / HOLE_P) + 4;
  for (let q = 0; q < n; q++) {
    const m = m0 + q, x = HEAD_X + (m + 0.5) * HOLE_P - scroll; if (x < -12 || x > 1932) continue;
    for (let row = 0; row < 2; row++) {
      const jx = dig ? 0 : jit(m * 2 + row, boil, 5, 0.45), jy = dig ? 0 : jit(m * 2 + row, boil, 6, 0.4);
      const y = (row ? BAND.y + BAND.h - PERF_H + 3.2 : BAND.y + 3.2) + jy, w = 8.6, h = 6.6;
      rpath(ctx, x - w / 2 + jx, y, w, h, 2.1);
      if (dig) { ctx.fillStyle = 'rgba(0,0,0,0.95)'; ctx.fill(); ctx.strokeStyle = rgba(TEAL, 0.35); ctx.lineWidth = 1; ctx.stroke(); }
      else { ctx.fillStyle = '#D9D0B9'; ctx.fill(); ctx.strokeStyle = 'rgba(14,13,18,0.55)'; ctx.lineWidth = 0.9; ctx.stroke(); }
    }
  }
}

function drawCellsPaper(ctx, T, st) {
  const { boil, cur, nowS } = st;
  for (let i = 0; i < CELLS.length; i++) {
    const cx = HEAD_X + (i - cur) * PITCH; if (cx < -70 || cx > 1990) continue;
    const lit = smooth(1 - Math.abs(i - cur)), x = cx - CELL_W / 2, y = CELL_Y, c = CELLS[i], unknown = i >= N_ERA;
    if (lit > 0.04) { ctx.save(); ctx.shadowColor = rgba(AMBER, 0.85 * lit); ctx.shadowBlur = 22; ctx.fillStyle = AMBER; ctx.fillRect(x, y, CELL_W, CELL_H); ctx.restore(); }
    if (unknown) {
      const pul = i === N_ERA && nowS > 0 ? 0.3 + 0.4 * Math.exp(-(nowS) * 2) : 0.18; // the next frame waits to be exposed
      ctx.save(); rpath(ctx, x, y, CELL_W, CELL_H, 4); ctx.fillStyle = 'rgba(255,243,214,0.06)'; ctx.fill(); ctx.setLineDash([7, 5]); ctx.strokeStyle = rgba(CREAM, 0.38); ctx.lineWidth = 1.6; ctx.stroke(); ctx.restore();
      ctx.save(); ctx.globalAlpha = 0.35 + pul; drawPictogram(ctx, 'unknown', cx, CELL_Y + CELL_H / 2 - 4, 1.05, { mode: 'paper', boil, seed: 40 + i }); ctx.restore();
      continue;
    }
    // film frame = a small sheet of paper with the era's drawing
    const pg = ctx.createLinearGradient(0, y, 0, y + CELL_H); pg.addColorStop(0, '#FBF6E8'); pg.addColorStop(1, '#E9DFC7');
    rpath(ctx, x, y, CELL_W, CELL_H, 4); ctx.fillStyle = pg; ctx.fill();
    drawPictogram(ctx, c.picto, cx, y + 23, 0.93, { mode: 'paper', boil, seed: 100 + i * 13 });
    ctx.save(); ctx.font = F.hand(20, 700); ctx.textAlign = 'center'; ctx.fillStyle = GRAPH; const jx = jit(i, boil, 8, 0.4); ctx.fillText(String(c.year), cx + jx, y + CELL_H - 4.5); ctx.restore();
    const dim = 0.56 * (1 - lit);
    if (dim > 0.01) { rpath(ctx, x, y, CELL_W, CELL_H, 4); ctx.fillStyle = `rgba(14,13,18,${dim})`; ctx.fill(); }
    P.ink(ctx, P.rectPts(x, y, CELL_W, CELL_H, 4, 3), { closed: true, color: INK, width: 1.6, amp: 0.6, passes: 2, step: 6, boil, seed: 60 + i, alpha: 0.85 });
  }
}

function drawPlayheadPaper(ctx, T, st) {
  const { boil, bp } = st, B = BAND, x = HEAD_X;
  // lit frame: amber doubled outline + beat-synced glow
  const x0 = x - CELL_W / 2, y0 = CELL_Y;
  ctx.save(); ctx.shadowColor = rgba(AMBER, 0.55 + 0.35 * bp); ctx.shadowBlur = 10 + 10 * bp;
  P.ink(ctx, P.rectPts(x0 - 2, y0 - 2, CELL_W + 4, CELL_H + 4, 5, 3), { closed: true, color: AMBER, width: 2.6, amp: 0.7, passes: 2, step: 6, boil, seed: 71, alpha: 1 });
  ctx.restore();
  // playhead pointers (top + bottom perf rows)
  [[B.y - 0.5, 1], [B.y + B.h + 0.5, -1]].forEach(([yy, dir], r) => {
    const pts = [[x - 10, yy], [x + 10, yy], [x, yy + dir * 15]];
    P.fill(ctx, pts, { color: AMBER, offset: [0, 0], comp: 'source-over', alpha: 1, amp: 0.3, boil, seed: 80 + r });
    P.ink(ctx, pts, { closed: true, color: INK, width: 2, amp: 0.5, passes: 2, step: 5, boil, seed: 82 + r, alpha: 1 });
  });
}

function drawPlatePaper(ctx, T, st) {
  const { boil, nowS, isNow } = st, t = T.t;
  const grow = isNow ? Math.min(1.12, spring(nowS, 2.6, 0.55)) : 0, ex = 38 * grow, wx = 64 * grow;
  const px = PLATE.x, py = PLATE.y - ex, pw = PLATE_W + wx, ph = PLATE.h + ex, cx0 = px + 22 + COL_W / 2;
  ctx.save();
  P.fill(ctx, rr(px, py, pw, ph, 9), { color: INK, offset: [6, 8], alpha: 0.32, amp: 1, boil, seed: 3 });
  rpath(ctx, px, py, pw, ph, 9); ctx.fillStyle = '#17151C'; ctx.fill();
  ctx.save(); rpath(ctx, px, py, pw, ph, 9); ctx.clip(); ctx.lineCap = 'round';
  for (let i = 0; i < (pw + ph) / 5; i++) { const x = px - ph + i * 5 + jit(i, boil, 2, 0.8); ctx.strokeStyle = i % 3 ? 'rgba(255,243,214,0.05)' : 'rgba(255,243,214,0.09)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, py + ph); ctx.lineTo(x + ph, py); ctx.stroke(); }
  if (isNow) { const f = Math.exp(-nowS * 6); ctx.fillStyle = rgba(AMBER, 0.6 * f); ctx.fillRect(px, py, pw, ph); const hg = ctx.createLinearGradient(0, py, 0, py + ph); hg.addColorStop(0, rgba(AMBER, 0.20)); hg.addColorStop(1, rgba(AMBER, 0.02)); ctx.fillStyle = hg; ctx.fillRect(px, py, pw, ph); }
  ctx.restore();
  P.ink(ctx, rr(px, py, pw, ph, 9), { closed: true, color: INK, width: 3.4, amp: 1.1, passes: 2, step: 7, boil, seed: 31, alpha: 1 });
  P.ink(ctx, rr(px + 5, py + 5, pw - 10, ph - 10, 6), { closed: true, color: isNow ? AMBER : P.mix(AMBER, INK, 0.45), width: isNow ? 2.2 : 1.5, amp: 0.55, passes: 1, step: 7, boil, seed: 33, alpha: isNow ? 1 : 0.8 });
  ctx.restore();

  const capMid = BASE_Y - DIGIT_CAP / 2, rowH = 86;
  if (!isNow) {
    // odometer digits (motion blur: several time samples across a 180-degree shutter while the drums move)
    const v0 = yearSample(t - 1 / 60).year, v1 = yearSample(t + 1 / 60).year, moving = Math.abs(v1 - v0) > 1e-3, N = moving ? 7 : 1;
    ctx.save(); rpath(ctx, px + 9, py + 7, pw - 18, ph - 16, 4); ctx.clip();
    ctx.font = F.display(DIGIT_PX); ctx.textAlign = 'center'; ctx.shadowColor = rgba(AMBER, 0.55); ctx.shadowBlur = moving ? 4 : 10;
    const jx = jit(1, boil, 9, 0.7), jy = jit(2, boil, 9, 0.6);
    for (let s = 0; s < N; s++) {
      const ts = N === 1 ? t : t + ((s + 0.5) / N - 0.5) * (1 / 30) * 0.8, pos = colPos(yearSample(ts).year), a = N === 1 ? 1 : 0.34;
      ctx.save(); ctx.translate(jx, jy);
      pos.forEach((p, c) => drumColumn(ctx, p, cx0 + c * COL_W, capMid, rowH, DIGIT_PX, CREAM, a));
      if (N === 1) { ctx.translate(0.9, 0.8); ctx.globalAlpha = 0.3; pos.forEach((p, c) => drumColumn(ctx, p, cx0 + c * COL_W, capMid, rowH, DIGIT_PX, AMBER, 1)); } // pencil double
      ctx.restore();
    }
    ctx.restore();
    ctx.save(); ctx.strokeStyle = 'rgba(255,243,214,0.14)'; ctx.lineWidth = 1;
    for (let c = 1; c < N_COL; c++) { const x = cx0 + (c - 0.5) * COL_W; ctx.beginPath(); ctx.moveTo(x, py + 11); ctx.lineTo(x, BASE_Y + 1); ctx.stroke(); }
    ctx.restore();
    const cur = st.cur; // era pips (12 chapters of the strip)
    for (let i = 0; i < 12; i++) {
      const x = px + 22 + 4 + i * 14.4 + (i >= N_ERA ? 3 : 0), act = clamp(1 - Math.abs(i - cur)), past = i < cur - 0.5;
      ctx.fillStyle = i >= N_ERA ? 'rgba(255,243,214,0.2)' : act > 0.5 ? AMBER : past ? 'rgba(255,243,214,0.62)' : 'rgba(255,243,214,0.24)';
      ctx.fillRect(x, 1034, 8.5, act > 0.5 ? 4.6 : 3.2);
    }
  } else {
    drawNow(ctx, T, st, { x: px + pw / 2, y: BASE_Y, py, ph });
  }
}

// "NOW": stamp-down scale pop + glow + burst ticks + hand-drawn double underline
const NOW_PX = 124;
function drawNow(ctx, T, st, g) {
  const { nowS, boil } = st, s = Math.max(0, nowS), t = T.t;
  const k = 1 + 0.95 * (1 - spring(s, 3.4, 0.5)), a = clamp(s / 0.03);
  const sh = Math.exp(-s * 12), shx = (hash(Math.floor(t * 30), 41) - 0.5) * 8 * sh, shy = (hash(Math.floor(t * 30), 42) - 0.5) * 7 * sh;
  ctx.save();
  // burst ticks (hand-drawn, radiate from the tab, pop then settle)
  const bk = clamp((s - 0.02) / 0.12), bf = 1 - clamp((s - 0.28) / 0.3), cx = g.x, cy = g.py + g.ph / 2;
  if (bf > 0.01) {
    for (let i = 0; i < 11; i++) {
      const ang = deg(196 + i * 14.8 + (hash(i, 5, 1) - 0.5) * 6), d0 = 12 + 30 * bk + hash(i, 6, 1) * 8, d1 = d0 + 16 + hash(i, 7, 1) * 16 * bk;
      const at = (d) => [cx + Math.cos(ang) * (150 + d), cy + Math.sin(ang) * (g.ph / 2 + 18 + d * 0.8)];
      P.line(ctx, [at(d0), at(d1)], { color: i % 3 === 0 ? VERM : AMBER, width: 4.5, boil, seed: 90 + i, alpha: bf * bk, passes: 2, amp: 0.8 });
    }
  }
  ctx.translate(g.x + shx, g.y - DIGIT_CAP * (NOW_PX / DIGIT_PX) / 2 + shy); ctx.scale(k, k); ctx.translate(0, DIGIT_CAP * (NOW_PX / DIGIT_PX) / 2);
  ctx.font = F.display(NOW_PX); ctx.textAlign = 'center'; ctx.globalAlpha = a; ctx.letterSpacing = '5px';
  ctx.shadowColor = rgba(AMBER, 1); ctx.shadowBlur = 14 + 56 * Math.exp(-s * 5);
  ctx.fillStyle = s < 0.07 ? '#FFFFFF' : AMBER; ctx.fillText('NOW', 2.5, 0);
  ctx.shadowBlur = 0; ctx.fillStyle = rgba(CREAM, 0.35 * Math.exp(-s * 8)); ctx.fillText('NOW', 2.5, 0);
  ctx.restore();
  // double underline, hand-drawn, written on right after the stamp
  ctx.save(); ctx.font = F.display(NOW_PX); ctx.letterSpacing = '5px'; const w = ctx.measureText('NOW').width; ctx.restore();
  const u0 = g.x - w / 2 - 4, u1 = g.x + w / 2 + 8;
  P.underline(ctx, u0, u1, 1036.5, { color: VERM, width: 5, boil, seed: 51, reveal: clamp((s - 0.1) / 0.22) });
  P.underline(ctx, u0 + 14, u1 - 10, 1042.5, { color: AMBER, width: 3, boil, seed: 53, reveal: clamp((s - 0.2) / 0.22) });
}

// ---- caption: a taped paper label with write-on pencil lettering ------------------------------------------------------------
function drawCaptionPaper(ctx, T, e) {
  const lt = T.t - e.t0, boil = T.boil, idx = e.index;
  const exit = e.hasDive ? clamp((lt - 1.5) / 0.26) : 0; if (exit >= 1) return;
  const font = F.hand(66, 700), tw = P.measure(ctx, e.caption, font), w = tw + 60, h = 84, x = 96, y = 58;
  const rot = -0.012 + (hash(idx, 3, 3) - 0.5) * 0.014, inK = smooth(clamp((lt - 0.02) / 0.22)), outK = smooth(exit), tapeK = clamp((lt - 0.0) / 0.16);
  ctx.save(); ctx.translate(x, y + h / 2); ctx.rotate(rot + exit * 0.025); ctx.translate(-x, -(y + h / 2));
  // everything lives inside a wipe: left->right when it is drawn on, right->left when it is wiped off at the dive
  ctx.beginPath(); ctx.rect(x - 16, y - 20, (w + 44) * inK * (1 - outK), h + 48); ctx.clip();
  P.fill(ctx, rr(x, y, w, h, 5), { color: INK, offset: [5, 6], alpha: 0.3, amp: 0.8, boil, seed: 7 + idx });
  rpath(ctx, x, y, w, h, 5); ctx.fillStyle = '#FBF7EA'; ctx.fill();
  ctx.save(); rpath(ctx, x, y, w, h, 5); ctx.clip(); ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(42,40,51,0.07)'; ctx.lineWidth = 1;
  for (let i = 0; i < (w + h) / 7; i++) { const xx = x - h + i * 7 + jit(i, boil, 12, 0.7); ctx.beginPath(); ctx.moveTo(xx, y + h); ctx.lineTo(xx + h, y); ctx.stroke(); }
  ctx.restore();
  P.ink(ctx, rr(x, y, w, h, 5), { closed: true, color: GRAPH, width: 2.8, amp: 1.0, passes: 2, step: 8, boil, seed: 21 + idx, alpha: 0.95 });
  // masking tape (two pieces) pops on
  const tp = (tx, ty, rt) => {
    ctx.save(); ctx.translate(tx, ty); ctx.rotate(rt); ctx.scale(tapeK, tapeK); const tape = [[-30, -11], [30, -11], [32, -5], [30, 0], [32, 5], [30, 11], [-30, 11], [-32, 5], [-30, 0], [-32, -5]];
    ctx.fillStyle = 'rgba(232,196,120,0.9)'; ctx.beginPath(); tape.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(42,40,51,0.45)'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,243,214,0.55)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-26, -5); ctx.lineTo(26, -5); ctx.stroke(); ctx.restore();
  };
  tp(x + 14, y + 6, -0.42); tp(x + w - 18, y + h - 6, -0.38);
  // write-on lettering + underline
  const reveal = clamp((lt - 0.1) / 0.42) * (1 - clamp(exit * 1.5));
  P.text(ctx, e.caption, x + 30, y + 58, { font, color: GRAPH, boil, reveal, seed: 77 + idx * 3, amp: 1.05 });
  P.underline(ctx, x + 26, x + 34 + tw, y + 72, { color: VERM, width: 4.4, boil, seed: 9 + idx, reveal: clamp((lt - 0.45) / 0.3) * (1 - clamp(exit * 2)) });
  ctx.restore();
}

// ================================================================ DIGITAL MODE ===============================================
function chamfer(ctx, x, y, w, h, c) { ctx.beginPath(); ctx.moveTo(x + c, y); ctx.lineTo(x + w - c, y); ctx.lineTo(x + w, y + c); ctx.lineTo(x + w, y + h - c); ctx.lineTo(x + w - c, y + h); ctx.lineTo(x + c, y + h); ctx.lineTo(x, y + h - c); ctx.lineTo(x, y + c); ctx.closePath(); }

function drawStripDigital(ctx, T, st) {
  const { cur, bp, t, boil, glitch } = st, B = BAND;
  // dark glass band + rails + a slow light sweep (every 2 bars)
  ctx.fillStyle = 'rgba(2,5,8,0.97)'; ctx.fillRect(0, B.y - 4, 1920, B.h + 8);
  const gr = ctx.createLinearGradient(0, B.y, 0, B.y + B.h); gr.addColorStop(0, 'rgba(31,181,166,0.10)'); gr.addColorStop(0.5, 'rgba(31,181,166,0.02)'); gr.addColorStop(1, 'rgba(31,181,166,0.10)');
  ctx.fillStyle = gr; ctx.fillRect(0, B.y, 1920, B.h);
  ctx.fillStyle = rgba(TEAL, 0.55); ctx.fillRect(0, B.y - 1, 1920, 1.6); ctx.fillRect(0, B.y + B.h - 0.6, 1920, 1.6);
  const sw = ((t / 4) % 1) * 2600 - 340; const sg = ctx.createLinearGradient(sw - 300, 0, sw + 300, 0); sg.addColorStop(0, 'rgba(31,181,166,0)'); sg.addColorStop(0.5, 'rgba(31,181,166,0.13)'); sg.addColorStop(1, 'rgba(31,181,166,0)'); ctx.fillStyle = sg; ctx.fillRect(sw - 300, B.y, 600, B.h);
  drawHoles(ctx, cur * PITCH, boil, true);
  // cells
  for (let i = 0; i < CELLS.length; i++) {
    const cx = HEAD_X + (i - cur) * PITCH; if (cx < -70 || cx > 1990) continue;
    const lit = smooth(1 - Math.abs(i - cur)), x = cx - CELL_W / 2, y = CELL_Y, c = CELLS[i];
    rpath(ctx, x, y, CELL_W, CELL_H, 4);
    ctx.fillStyle = rgba(TEAL, 0.05 + 0.16 * lit); ctx.fill();
    if (lit > 0.04) { ctx.save(); ctx.shadowColor = rgba(TEAL, 0.8 * lit); ctx.shadowBlur = 16 + 8 * bp; ctx.strokeStyle = rgba(TEAL, 0.95 * lit); ctx.lineWidth = 2; ctx.stroke(); ctx.restore(); }
    else { ctx.strokeStyle = rgba(TEAL, 0.28); ctx.lineWidth = 1; ctx.stroke(); }
    const al = 0.4 + 0.6 * lit;
    ctx.save(); if (lit > 0.5) { ctx.shadowColor = rgba(TEAL, 0.7); ctx.shadowBlur = 6; }
    drawPictogram(ctx, c.picto, cx, y + 23, 0.93, { mode: 'digital', lit: al });
    ctx.restore();
    ctx.save(); ctx.font = F.condensed(16, 500); ctx.letterSpacing = '2px'; ctx.textAlign = 'center'; ctx.fillStyle = lit > 0.5 ? CREAM : rgba(CREAM, 0.5); ctx.fillText(String(c.year), cx + 1, y + CELL_H - 4); ctx.restore();
  }
  // playhead pointers + corner brackets of the lit frame
  const x = HEAD_X;
  ctx.fillStyle = TEAL; ctx.shadowColor = TEAL; ctx.shadowBlur = 8 + 6 * bp;
  ctx.beginPath(); ctx.moveTo(x - 9, B.y - 0.5); ctx.lineTo(x + 9, B.y - 0.5); ctx.lineTo(x, B.y + 13); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x - 9, B.y + B.h + 0.5); ctx.lineTo(x + 9, B.y + B.h + 0.5); ctx.lineTo(x, B.y + B.h - 13); ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0; ctx.strokeStyle = CREAM; ctx.lineWidth = 2; const bx0 = x - CELL_W / 2 - 4, bx1 = x + CELL_W / 2 + 4, by0 = CELL_Y - 3, by1 = CELL_Y + CELL_H + 3, L = 9;
  [[bx0, by0, 1, 1], [bx1, by0, -1, 1], [bx0, by1, 1, -1], [bx1, by1, -1, -1]].forEach(([px, py, sx, sy]) => { ctx.beginPath(); ctx.moveTo(px, py + sy * L); ctx.lineTo(px, py); ctx.lineTo(px + sx * L, py); ctx.stroke(); });
  // glitch: chromatic ghost of the whole strip row during the jump
  if (glitch > 0.02) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5 * glitch; const dx = 10 * glitch;
    ctx.beginPath(); ctx.rect(0, B.y, 1920, B.h); ctx.clip();
    const fr = Math.floor(t * 30);
    for (let k = 0; k < 3; k++) { const y0 = B.y + hash(fr, k, 1) * B.h, hh = 6 + hash(fr, k, 2) * 16; ctx.fillStyle = rgba(k % 2 ? VIOLET : SKY, 0.3); ctx.fillRect(0, y0, 1920, hh); ctx.fillStyle = rgba(TEAL, 0.35); ctx.fillRect(dx * (hash(fr, k, 3) - 0.3) * 6, y0 + hh, 1920, 1.5); }
    ctx.restore();
  }
}

function drawPlateDigital(ctx, T, st) {
  const { t, boil, bp, glitch, cur } = st, px = PLATE.x, py = PLATE.y, pw = PLATE_W, ph = PLATE.h, cx0 = px + 22 + COL_W / 2, fr = Math.floor(t * 30);
  const kick = 1 + 0.05 * Math.min(1, T.impact || 0);
  ctx.save(); ctx.translate(px + pw / 2, py + ph / 2); ctx.scale(kick, kick); ctx.translate(-(px + pw / 2), -(py + ph / 2));
  // glass plate
  chamfer(ctx, px, py, pw, ph, 11); ctx.fillStyle = 'rgba(3,8,11,0.96)'; ctx.fill();
  ctx.save(); chamfer(ctx, px, py, pw, ph, 11); ctx.clip(); const pg = ctx.createLinearGradient(0, py, 0, py + ph); pg.addColorStop(0, rgba(TEAL, 0.22)); pg.addColorStop(0.55, rgba(TEAL, 0.03)); pg.addColorStop(1, rgba(TEAL, 0.12)); ctx.fillStyle = pg; ctx.fillRect(px, py, pw, ph);
  for (let y = py; y < py + ph; y += 4) { ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(px, y, pw, 1.4); } ctx.restore(); // scanlines
  ctx.save(); ctx.shadowColor = rgba(TEAL, 0.8); ctx.shadowBlur = 10 + 6 * bp; chamfer(ctx, px, py, pw, ph, 11); ctx.strokeStyle = rgba(TEAL, 0.95); ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
  // digits (rolling drums, motion blurred; glitch = RGB split + sliced displacement)
  const v0 = yearSample(t - 1 / 60, 1).year, v1 = yearSample(t + 1 / 60, 1).year, moving = Math.abs(v1 - v0) > 1e-3, N = moving ? 6 : 1, capMid = BASE_Y - DIGIT_CAP / 2, rowH = 86;
  const pass = (dx, dy, fill, alpha, comp, clipY0, clipY1) => {
    ctx.save(); rpath(ctx, px + 8, py + 6, pw - 16, ph - 14, 3); ctx.clip(); if (clipY0 != null) { ctx.beginPath(); ctx.rect(px, clipY0, pw, clipY1 - clipY0); ctx.clip(); }
    ctx.globalCompositeOperation = comp; ctx.font = F.display(DIGIT_PX); ctx.textAlign = 'center'; ctx.translate(dx, dy);
    for (let s = 0; s < N; s++) {
      const ts = N === 1 ? t : t + ((s + 0.5) / N - 0.5) * (1 / 30) * 0.8, pos = colPos(yearSample(ts, 1).year), a = (N === 1 ? 1 : 0.4) * alpha;
      pos.forEach((p, c) => drumColumn(ctx, p, cx0 + c * COL_W, capMid, rowH, DIGIT_PX, fill, a));
    }
    ctx.restore();
  };
  if (glitch > 0.02) {
    const ns = 5, sh = (ph - 14) / ns;
    pass(-9 * glitch, 0, SKY, 0.8, 'lighter'); pass(9 * glitch, 0, VIOLET, 0.8, 'lighter');
    for (let k = 0; k < ns; k++) { const dx = (hash(fr, k, 7) - 0.5) * 2 * 34 * glitch * (hash(fr, k, 8) < 0.7 ? 1 : 0.2); pass(dx, 0, CREAM, 1, 'source-over', py + 7 + k * sh, py + 7 + (k + 1) * sh); }
  } else { ctx.save(); ctx.shadowColor = rgba(TEAL, 0.9); ctx.shadowBlur = 14; pass(0, 0, CREAM, 1, 'source-over'); ctx.restore(); }
  ctx.save(); ctx.strokeStyle = rgba(TEAL, 0.25); ctx.lineWidth = 1; for (let c = 1; c < N_COL; c++) { const x = cx0 + (c - 0.5) * COL_W; ctx.beginPath(); ctx.moveTo(x, py + 10); ctx.lineTo(x, BASE_Y + 1); ctx.stroke(); } ctx.restore();
  // pips
  for (let i = 0; i < 12; i++) {
    const x = px + 22 + 4 + i * 14.4 + (i >= N_ERA ? 3 : 0), act = clamp(1 - Math.abs(i - cur)), past = i < cur - 0.5;
    ctx.fillStyle = act > 0.5 ? TEAL : past ? rgba(CREAM, 0.6) : rgba(CREAM, 0.2); ctx.fillRect(x, 1034, 8.5, act > 0.5 ? 4.6 : 3.2);
  }
  ctx.restore();
}

function drawCaptionDigital(ctx, T, st) {
  const { t, glitch } = st, fut = st.fut, k = FUTURES.indexOf(fut), lt = t - fut.t0, rem = fut.t1 - t, fr = Math.floor(t * 30);
  const outK = k < FUTURES.length - 1 ? clamp((0.18 - rem) / 0.18) : 0; // slice out just before the next jump
  if (outK >= 1) return;
  const cap = fut.caption, inK = clamp((lt - 0.04) / 0.5), x = 100, by = 124, size = 46;
  ctx.save(); ctx.globalAlpha = 1 - outK * outK;
  // accent bar + kicker
  ctx.fillStyle = TEAL; ctx.shadowColor = TEAL; ctx.shadowBlur = 10; ctx.fillRect(96, 64, 4, 63); ctx.shadowBlur = 0;
  ctx.font = F.label(15, 600); ctx.letterSpacing = '6px'; ctx.fillStyle = rgba(TEAL, 0.95); ctx.fillText(`${fut.year}   ·   FUTURE ${k + 1} / ${FUTURES.length}`, x + 16, 76);
  // caption: characters decode from glyph noise, then settle
  ctx.font = F.condensed(size, 500); ctx.letterSpacing = '0px';
  const chars = [...cap], ws = chars.map((c) => ctx.measureText(c).width + 9), total = ws.reduce((a, b) => a + b, 0), GL = '01<>/\\|#%&=+';
  const draw = (dx, dy, color, alpha, comp) => {
    ctx.save(); ctx.globalCompositeOperation = comp; ctx.font = F.condensed(size, 500); ctx.letterSpacing = '0px'; let cx = x + 16;
    chars.forEach((c, i) => {
      const ti = i * 0.022, dec = clamp((inK * 0.5 + 0.5 * inK - ti) / 0.12 + (lt > 0.7 ? 9 : 0));
      let ch = c; let al = alpha; if (c !== ' ' && dec < 1) { ch = GL[Math.floor(hash(fr >> 1, i, 3) * GL.length)]; al *= 0.4 + 0.5 * dec; if (dec <= 0) al = 0; }
      ctx.globalAlpha = al * (c === ' ' ? 0 : 1); ctx.fillStyle = color; ctx.fillText(ch, cx + dx, by + dy); cx += ws[i];
    });
    ctx.restore();
  };
  if (glitch > 0.02 || outK > 0) {
    const g = Math.max(glitch, outK); draw(-5 * g, 0, SKY, 0.8, 'lighter'); draw(5 * g, 0, VIOLET, 0.8, 'lighter');
    for (let s = 0; s < 3; s++) { const y0 = by - 40 + s * 17; ctx.save(); ctx.beginPath(); ctx.rect(0, y0, 1920, 17); ctx.clip(); draw((hash(fr, s, 11) - 0.5) * 36 * g, 0, CREAM, 1, 'source-over'); ctx.restore(); }
  } else { ctx.save(); ctx.shadowColor = rgba(TEAL, 0.8); ctx.shadowBlur = 12; draw(0, 0, CREAM, 1, 'source-over'); ctx.restore(); }
  // underline: grows then a light runs along it on the bar
  const ul = outCubic(clamp((lt - 0.25) / 0.45)), ux0 = x + 16, uw = (total + 8) * ul;
  ctx.fillStyle = rgba(TEAL, 0.85); ctx.fillRect(ux0, by + 9, uw, 2.5);
  const run = ((t * 0.5) % 1) * (total + 80) - 40; if (ul > 0.99) { const lg = ctx.createLinearGradient(ux0 + run - 40, 0, ux0 + run, 0); lg.addColorStop(0, 'rgba(255,243,214,0)'); lg.addColorStop(1, 'rgba(255,243,214,0.95)'); ctx.fillStyle = lg; ctx.fillRect(ux0 + Math.max(0, run - 40), by + 9, Math.min(40, run, total + 8 - (run - 40)), 2.5); }
  ctx.restore();
}

// ================================================================ the public entry ===========================================
export function draw(ctx, T, S, mode = 'paper') {
  const y = yearAt(T.t); if (!y.show) return;
  const dig = mode === 'digital', t = T.t, boil = T.boil | 0;
  const bph = T.beat - Math.floor(T.beat), bp = Math.exp(-bph * 5); // beat pulse 1 -> 0 (120 bpm)
  ctx.save(); resetCtx(ctx);
  if (!dig) {
    const e = T.era || ERAS[Math.max(0, eraIndexAt(t))] || ERAS[0], cur = stripScroll(y, e, t), nowS = t - NOW_T, isNow = y.now && nowS >= 0;
    const st = { t, boil, cur, y, bp, nowS, isNow };
    // strip: body, shadow, holes, frames, playhead
    const body = stripBody(S, boil % 3);
    ctx.save(); const sg = ctx.createLinearGradient(0, BAND.y + BAND.h, 0, BAND.y + BAND.h + 14); sg.addColorStop(0, 'rgba(14,13,18,0.28)'); sg.addColorStop(1, 'rgba(14,13,18,0)'); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = sg; ctx.fillRect(0, BAND.y + BAND.h, 1920, 14); ctx.restore();
    ctx.drawImage(body, -20, BAND.y - 4, 1960, BAND.h + 8);
    drawHoles(ctx, cur * PITCH, boil, false);
    drawCellsPaper(ctx, T, st);
    drawPlayheadPaper(ctx, T, st);
    drawPlatePaper(ctx, T, { ...st, y });
    drawCaptionPaper(ctx, T, e);
  } else {
    const fut = FUTURES.find((f) => t >= f.t0 && t < f.t1) || (t < FUTURES[0].t0 ? FUTURES[0] : FUTURES[FUTURES.length - 1]), k = FUTURES.indexOf(fut);
    const cur = N_ERA - 1 + k + (y.roll || 0), js = t - fut.t0, glitch = js >= 0 && js < 0.4 ? (1 - js / 0.4) ** 1.5 : 0;
    const settle = js > 0.25 && js < 0.75 ? 0.04 * Math.exp(-(js - 0.25) * 14) * Math.sin((js - 0.25) * 36) : 0;
    const st = { t, boil, cur: cur + settle, y, bp, glitch, fut };
    drawStripDigital(ctx, T, st);
    drawPlateDigital(ctx, T, st);
    drawCaptionDigital(ctx, T, st);
  }
  ctx.restore();
}
