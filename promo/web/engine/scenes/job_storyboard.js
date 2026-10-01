// =============================================================================
// job_storyboard.js — "STORYBOARD" (28.0 – 30.0) · dolly-in 35 mm on a cool "drafting room" set-up.
//   28.000          ghost brackets of a 3x2 grid fade in in front of Amrita (she faces the grid, stylus in hand)
//   28.25 + 0.125k  six pencil-sketch panels are dealt from her stylus and SNAP into the grid (overshoot, click flash, spark)
//   29.500          POP: every frame extrudes into a shadow box; its thumbnail splits into 4 parallax cards (a tiny diorama);
//                   whoosh + bloom kick + shock ring; the camera orbits to sell the parallax
// Panel art is drawn on canvases with the engine's pencil toolkit (S.pencil), one canvas per depth layer.
// Pure function of T.t / T.lt. Shares its light/FX kit with job_script.js.
// =============================================================================
import { createStage } from '../stage3d.js';
import { createAmrita } from '../amrita3d.js';
import * as E from '../ease.js';
import { hash, rng as mkRng, noise1 } from '../rng.js';
import { lensFov, pxPerUnit, radialTexture, makeEnv, makeBeam, makeDust, makeSparks, makeRings, makeStylus, makeBackdrop, buildStage } from './job_script.js';

const { clamp, lerp, smooth, smoother, outCubic, outBack, spring } = E;
const TAU = Math.PI * 2;
const seg = (x, a, b) => clamp((x - a) / (b - a));
const T0 = 28;
const SNAPS = Array.from({ length: 6 }, (_, k) => 0.25 + 0.125 * k);   // lt of the six panel_snap events (28.25 + 0.125k)
const POP = 1.5;                                                        // lt of panel_pop_3d (29.5)
const PW = 0.94, PH = 0.529, GAPX = 0.13, BORD = 0.045;                 // panel (picture) size, grid gap, frame border (m)
const GRID = [0.85, 1.2, 0.3];                                          // grid centre
const AM = [-1.45, 1.1, 0];                                              // Amrita's centre
const CELLS = Array.from({ length: 6 }, (_, k) => [GRID[0] + ((k % 3) - 1) * (PW + GAPX + 2 * BORD * 0.5), GRID[1] + (0.5 - Math.floor(k / 3)) * (PH + GAPX + 2 * BORD * 0.5), GRID[2]]);
const LAYER_Z = [-0.22, -0.09, 0.04, 0.17];                             // parallax depths of the 4 cards once popped (m)
const LAYER_SHADE = [0.42, 0.62, 0.82, 1.0];                            // atmospheric dimming of far cards once popped

// ============================== PENCIL THUMBNAILS =============================
// Each panel = 4 transparent-ish layers (0 = paper + sky/background, 1 = far, 2 = subject, 3 = foreground), drawn with S.pencil.
const TW = 640, TH = 360, TS = 1.2;                                     // logical thumbnail space and texture oversampling
const INK = '#2A2833', CR = '#FFF3D6', AMB = '#FFB62E', VER = '#F2542D', TEAL = '#1FB5A6', VIO = '#6B5BFF', SKY = '#7CC4FF';
function makeThumbs(THREE, S) {
  const P = S.pencil, F = S.F;
  const L = () => { const c = S.mk(TW * TS, TH * TS), g = c.getContext('2d'); g.scale(TS, TS); return { c, g }; };
  const ell = (cx, cy, rx, ry, rot = 0, n = 34) => P.ellipsePts(cx, cy, rx, ry, rot, n);
  const rect = (x, y, w, h, r = 0) => P.rectPts(x, y, w, h, r);
  const sm = (pts, closed = true) => P.smoothPts(pts, { closed, n: 7 });
  const top = (pts) => [...sm(pts, false), [TW + 20, TH + 20], [-20, TH + 20]];       // smooth ridge line + closed to the bottom
  // shape helper: fill (multiply on paper / plain on cut-outs), hatch, doubled ink
  const sh = (g, pts, o = {}) => P.shape(g, pts, {
    fill: o.fill ? { color: o.fill, offset: o.off || [3, 2], alpha: o.fa ?? 0.95, comp: o.comp || 'multiply' } : false,
    hatch: o.hatch ? { color: o.hatch, gap: o.gap || 8, width: 1.8, alpha: o.ha ?? 0.7, angle: o.ang ?? -0.7, cross: o.cross || 0, shade: o.shade, comp: o.hcomp || 'multiply' } : false,
    ink: o.ink === false ? false : { color: o.inkc || INK, width: o.w || 4.2, amp: 1.2, passes: 2, alpha: 0.95 }, boil: 0, seed: o.seed || 1, closed: o.closed ?? true,
  });
  const ln = (g, pts, o = {}) => P.line(g, pts, { color: o.c || INK, width: o.w || 3.4, amp: o.amp ?? 1.1, boil: 0, seed: o.seed || 3, alpha: o.a ?? 0.95 });
  const paper = (g, seed) => g.drawImage(P.paperCanvas(Math.round(TW * TS), Math.round(TH * TS), { seed }), 0, 0, TW, TH);
  const star = (g, x, y, r, c = CR) => { ln(g, [[x - r, y], [x + r, y]], { c, w: 2.4, amp: 0.4 }); ln(g, [[x, y - r], [x, y + r]], { c, w: 2.4, amp: 0.4 }); };
  const stars = (g, seed, n, y0, y1, c = CR) => { const r = mkRng(seed); for (let i = 0; i < n; i++) star(g, r() * TW, y0 + r() * (y1 - y0), 3 + r() * 5, c); };
  const num = (g, n) => { sh(g, rect(14, 12, 64, 40, 8), { fill: CR, comp: 'source-over', w: 3.2, seed: 40 + n }); P.text(g, String(n), 46, 44, { font: F.hand(40, 700), color: INK, align: 'center', boil: 0, seed: n }); };
  const bg = (g, col, hatchCol, seed, ang = -0.55) => sh(g, rect(0, 0, TW, TH), { fill: col, hatch: hatchCol, gap: 7, ang, ink: false, fa: 0.92, seed, shade: (x, y) => 0.4 + 0.6 * (1 - y / TH) });
  const out = {};

  // ---- 1  THE TRAIN: night sky, hills, a head-on-sideways locomotive with a glowing lamp, rails
  { const A = [L(), L(), L(), L()];
    paper(A[0].g, 11); bg(A[0].g, '#4d63a8', '#243a82', 11); stars(A[0].g, 5, 16, 14, 190); sh(A[0].g, ell(540, 78, 30, 30), { fill: CR, comp: 'source-over', w: 3.4 }); num(A[0].g, 1);
    sh(A[1].g, top([[-20, 240], [110, 205], [250, 238], [400, 196], [540, 232], [660, 214]]), { fill: '#3f4a96', hatch: '#1f2a6e', gap: 7, ang: -0.9, seed: 12, w: 3.6 });
    { const g = A[2].g; ln(g, [[0, 301], [640, 296]], { w: 4 });
      sh(g, rect(410, 200, 110, 90, 6), { fill: TEAL, hatch: '#0d7a70', seed: 13 }); sh(g, rect(528, 200, 140, 90, 6), { fill: AMB, hatch: '#b87708', seed: 14 });
      sh(g, rect(150, 190, 250, 74, 30), { fill: VER, hatch: '#a02a10', seed: 15 }); sh(g, rect(330, 156, 86, 112, 6), { fill: '#59546a', hatch: INK, gap: 9, seed: 16 });
      sh(g, rect(322, 144, 102, 16, 4), { fill: CR, comp: 'source-over', seed: 17 }); sh(g, rect(346, 172, 40, 34, 5), { fill: SKY, comp: 'source-over', seed: 18 });
      sh(g, [[168, 192], [178, 150], [214, 150], [224, 192]], { fill: '#59546a', hatch: INK, seed: 19 }); sh(g, rect(160, 140, 72, 14, 5), { fill: INK, comp: 'source-over', seed: 20 });
      [[236, 112, 24], [276, 80, 30], [326, 56, 36]].forEach(([x, y, r], i) => sh(g, ell(x, y, r, r * 0.86), { fill: CR, comp: 'source-over', seed: 21 + i, w: 3.6 }));
      for (let i = 0; i < 5; i++) ln(g, [[118, 216 + (i - 2) * 5], [40 - i * 5, 216 + (i - 2) * 16]], { c: AMB, w: 3.4 });
      sh(g, ell(138, 216, 18, 18), { fill: AMB, comp: 'source-over', seed: 26 }); sh(g, ell(138, 216, 8, 8), { fill: CR, comp: 'source-over', ink: false });
      sh(g, [[150, 262], [104, 292], [150, 292]], { fill: '#59546a', hatch: INK, seed: 27 });
      [212, 292, 372].forEach((x, i) => { sh(g, ell(x, 270, 29, 29), { fill: '#59546a', hatch: INK, gap: 9, seed: 28 + i, w: 4.4 }); ln(g, [[x - 24, 270], [x + 24, 270]], { w: 2.4 }); ln(g, [[x, 246], [x, 294]], { w: 2.4 }); }); }
    { const g = A[3].g; sh(g, [[-10, 322], [660, 316], [660, 380], [-10, 380]], { fill: '#6a5a46', hatch: '#2b2a1c', gap: 7, seed: 31 });
      for (let i = 0; i < 22; i++) ln(g, [[i * 31 - 8, 322 + (i % 2) * 2], [i * 31 - 20, 346]], { w: 2.6, amp: 0.7 });
      for (let i = 0; i < 9; i++) { const x = 20 + i * 76 + hash(i, 9) * 30; ln(g, [[x, 322], [x - 5, 304]], { c: '#3a7a3a', w: 2.8 }); ln(g, [[x, 322], [x + 7, 300]], { c: '#3a7a3a', w: 2.8 }); ln(g, [[x, 322], [x + 1, 296]], { c: '#3a7a3a', w: 2.8 }); } }
    out.train = A; }

  // ---- 2  THE MOON: a sleepy crescent with a face, drifting clouds, rooftops
  { const A = [L(), L(), L(), L()];
    paper(A[0].g, 12); bg(A[0].g, '#6a5bd6', '#2c2490', 12, -0.45); stars(A[0].g, 8, 22, 12, 330); num(A[0].g, 2);
    { const g = A[1].g, cx = 330, cy = 165, R = 112, pts = [];
      for (let i = 0; i <= 28; i++) { const a = ((57.8 + (i / 28) * 244.4) * Math.PI) / 180; pts.push([cx + Math.cos(a) * R, cy - Math.sin(a) * R]); }
      const ic = [cx + 0.45 * R, cy], ir = 0.85 * R;
      for (let i = 0; i <= 28; i++) { const a = ((275.6 - (i / 28) * 191.2) * Math.PI) / 180; pts.push([ic[0] + Math.cos(a) * ir, ic[1] - Math.sin(a) * ir]); }
      sh(g, pts, { fill: '#ffe39a', comp: 'source-over', hatch: '#e0a020', gap: 9, seed: 41, w: 4.6, shade: (x) => (x < 270 ? 0.9 : 0.35) });
      ln(g, [[246, 160], [262, 168], [280, 160]], { w: 4 }); ln(g, [[240, 196], [262, 210], [286, 208]], { w: 3.6 });
      sh(g, ell(238, 190, 9, 6), { fill: VER, comp: 'source-over', ink: false, fa: 0.55 }); ln(g, [[252, 130], [270, 120]], { w: 3 }); }
    { const g = A[2].g; [[150, 255, 1], [470, 210, 0.8], [570, 290, 1.1]].forEach(([x, y, s], i) => {
        const pts = [[x - 70 * s, y + 20 * s], [x - 70 * s, y - 4 * s], [x - 40 * s, y - 24 * s], [x - 8 * s, y - 14 * s], [x + 18 * s, y - 36 * s], [x + 52 * s, y - 20 * s], [x + 74 * s, y - 2 * s], [x + 70 * s, y + 20 * s]];
        sh(g, sm(pts), { fill: '#e8e4ff', comp: 'source-over', hatch: '#8a84d6', gap: 8, seed: 42 + i, shade: (px, py) => (py > y ? 0.9 : 0.2) }); }); }
    { const g = A[3].g; sh(g, [[-10, 330], [60, 330], [60, 280], [120, 250], [180, 280], [180, 330], [240, 330], [240, 296], [320, 296], [320, 330], [410, 330], [410, 262], [470, 232], [530, 262], [530, 330], [660, 330], [660, 380], [-10, 380]], { fill: '#3c3552', comp: 'source-over', hatch: INK, gap: 7, seed: 45, w: 4 });
      sh(g, rect(95, 292, 14, 28), { fill: AMB, comp: 'source-over', ink: false }); sh(g, rect(448, 280, 16, 30), { fill: AMB, comp: 'source-over', ink: false }); sh(g, rect(268, 304, 14, 20), { fill: AMB, comp: 'source-over', ink: false });
      sh(g, rect(140, 236, 14, 36), { fill: '#3c3552', comp: 'source-over', hatch: INK, seed: 46 }); }
    out.moon = A; }

  // ---- 3  THE ROAD: sunset, ridges, a winding road to the horizon, signpost + fence posts
  { const A = [L(), L(), L(), L()];
    paper(A[0].g, 13); bg(A[0].g, '#ff9f5c', '#d9461f', 13, -0.3); sh(A[0].g, ell(330, 214, 70, 70), { fill: '#ffe08a', comp: 'source-over', hatch: AMB, gap: 8, ang: -0.3, seed: 51, w: 3.6, shade: (x, y) => (y > 190 ? 0.9 : 0.3) }); num(A[0].g, 3);
    sh(A[1].g, top([[-20, 232], [90, 208], [200, 236], [330, 214], [450, 238], [560, 206], [660, 228]]), { fill: '#8b5aa8', hatch: '#4a2a78', gap: 8, ang: -0.9, seed: 52, w: 3.6 });
    { const g = A[2].g; sh(g, top([[-20, 262], [120, 238], [260, 250], [330, 244], [470, 252], [560, 236], [660, 258]]), { fill: '#3f9a58', hatch: '#175a2c', gap: 8, ang: -0.8, seed: 53 });
      const c = [[330, 372, 230], [352, 316, 150], [306, 272, 92], [330, 246, 44], [326, 238, 22]];
      const left = sm(c.map(([x, y, w]) => [x - w / 2, y]), false), right = sm(c.map(([x, y, w]) => [x + w / 2, y]), false).reverse();
      sh(g, [...left, ...right], { fill: '#d8c9ae', comp: 'source-over', hatch: '#7a6a52', gap: 9, ang: 0.9, seed: 54, w: 4.2 });
      [[352, 330, 14], [316, 286, 8], [330, 256, 4]].forEach(([x, y, w], i) => ln(g, [[x, y - w * 1.1], [x, y + w * 1.1]], { c: AMB, w: 4.4 - i, amp: 0.3 }));
      sh(g, ell(440, 240, 18, 22), { fill: '#175a2c', comp: 'source-over', hatch: INK, seed: 55 }); ln(g, [[440, 258], [440, 272]], { w: 4 }); }
    { const g = A[3].g; ln(g, [[88, 380], [88, 250]], { w: 7 }); sh(g, [[88, 266], [168, 266], [190, 282], [168, 298], [88, 298]], { fill: '#c98b4a', comp: 'source-over', hatch: '#6a4018', gap: 8, seed: 56 });
      ln(g, [[110, 282], [166, 282]], { w: 3.4 }); ln(g, [[154, 274], [166, 282], [154, 290]], { w: 3.4 });
      for (let i = 0; i < 4; i++) { const x = 470 + i * 56; sh(g, rect(x, 286 + i * 6, 14, 100), { fill: '#b07a44', comp: 'source-over', hatch: '#5a3a14', seed: 57 + i, w: 3.6 }); }
      ln(g, [[466, 306], [660, 326]], { w: 3.4 }); ln(g, [[466, 338], [660, 358]], { w: 3.4 });
      for (let i = 0; i < 10; i++) { const x = 8 + i * 66 + hash(i, 4) * 20; ln(g, [[x, 372], [x - 4, 346]], { c: '#2d7a40', w: 3 }); ln(g, [[x, 372], [x + 7, 342]], { c: '#2d7a40', w: 3 }); } }
    out.road = A; }

  // ---- 4  THE SPACESHIP: a ringed planet, a chunky saucer with a flame, rocks in the foreground
  { const A = [L(), L(), L(), L()];
    paper(A[0].g, 14); bg(A[0].g, '#2a2f78', '#101450', 14, -0.6); stars(A[0].g, 9, 30, 10, 345); num(A[0].g, 4);
    { const g = A[1].g; sh(g, ell(150, 120, 62, 62), { fill: '#3fd2c4', comp: 'source-over', hatch: '#0d7f76', gap: 8, seed: 61, w: 4.4, shade: (x, y) => (x > 140 ? 0.9 : 0.3) });
      sh(g, ell(150, 124, 118, 24, -0.28), { fill: '#ffd58a', comp: 'source-over', hatch: '#c78a1a', gap: 8, ang: 0.4, seed: 62, w: 3.8, closed: true });
      sh(g, ell(530, 300, 24, 24), { fill: '#b5b0d8', comp: 'source-over', hatch: '#5a54a0', seed: 63 }); }
    { const g = A[2].g; for (let i = 0; i < 6; i++) ln(g, [[210 - i * 4, 200 + (i - 3) * 14], [20 - i * 14, 200 + (i - 3) * 14]], { c: SKY, w: 3.2 - i * 0.2 });
      sh(g, [[230, 212], [170, 190], [172, 232]], { fill: VER, comp: 'source-over', hatch: '#a02a10', seed: 64 }); sh(g, [[220, 224], [168, 244], [236, 246]], { fill: AMB, comp: 'source-over', hatch: '#b87708', seed: 65 });
      sh(g, ell(360, 206, 168, 62), { fill: '#e9e4f6', comp: 'source-over', hatch: '#8a84b4', gap: 9, ang: -0.5, seed: 66, w: 5, shade: (x, y) => (y > 210 ? 0.95 : 0.25) });
      sh(g, [[270, 178], [296, 128], [424, 128], [452, 178]], { fill: SKY, comp: 'source-over', hatch: '#3a86c4', gap: 9, seed: 67, w: 4.6, shade: (x, y) => 0.3 + 0.7 * ((y - 128) / 50) });
      sh(g, ell(360, 156, 20, 18), { fill: CR, comp: 'source-over', seed: 68, w: 3.4 }); sh(g, ell(354, 154, 4, 6), { fill: INK, comp: 'source-over', ink: false }); sh(g, ell(368, 154, 4, 6), { fill: INK, comp: 'source-over', ink: false });
      [[300, 220], [350, 232], [400, 232], [450, 220]].forEach(([x, y]) => sh(g, ell(x, y, 8, 8), { fill: AMB, comp: 'source-over', seed: 69, w: 3 }));
      sh(g, [[470, 220], [560, 196], [540, 244], [490, 240]], { fill: VER, comp: 'source-over', hatch: '#a02a10', seed: 70 }); }
    { const g = A[3].g; sh(g, [[-10, 330], [30, 292], [90, 306], [130, 340], [150, 380], [-10, 380]], { fill: '#6a6a82', comp: 'source-over', hatch: INK, gap: 7, seed: 71 }); sh(g, [[520, 380], [560, 322], [610, 302], [660, 320], [660, 380]], { fill: '#6a6a82', comp: 'source-over', hatch: INK, gap: 7, seed: 72 });
      star(g, 300, 330, 8, AMB); star(g, 380, 300, 6, CR); star(g, 220, 350, 5, SKY); }
    out.ship = A; }

  // ---- 5  THE CREATURE: a friendly horned monster in a teal forest
  { const A = [L(), L(), L(), L()];
    paper(A[0].g, 15); bg(A[0].g, '#5fc9a8', '#1a8a6a', 15, 1.2); num(A[0].g, 5);
    { const g = A[1].g; for (let i = 0; i < 6; i++) { const x = 40 + i * 118 + hash(i, 5) * 30, w = 26 + hash(i, 6) * 18; sh(g, rect(x, 40 + hash(i, 7) * 40, w, 340), { fill: '#2f7a5c', hatch: '#124a38', gap: 7, ang: 1.5, seed: 81 + i, w: 3.6 }); sh(g, ell(x + w / 2, 70 + hash(i, 8) * 30, 56, 44), { fill: '#3ea87e', hatch: '#14684a', seed: 90 + i, w: 3.6 }); } }
    { const g = A[2].g; sh(g, ell(350, 232, 142, 108), { fill: '#a98bff', comp: 'source-over', hatch: '#5a3cc0', gap: 9, ang: -0.6, seed: 101, w: 5, shade: (x, y) => 0.25 + 0.75 * ((y - 130) / 220) });
      [[290, 118, -0.35], [410, 118, 0.35]].forEach(([x, y, r], i) => sh(g, [[x - 18, y + 24], [x + r * 40, y - 54], [x + 18, y + 24]], { fill: AMB, comp: 'source-over', hatch: '#b87708', seed: 102 + i, w: 4.4 }));
      [[310, 206], [396, 206]].forEach(([x, y]) => { sh(g, ell(x, y, 30, 34), { fill: '#ffffff', comp: 'source-over', seed: 104, w: 4 }); sh(g, ell(x + 3, y + 3, 13, 15), { fill: INK, comp: 'source-over', ink: false }); sh(g, ell(x - 2, y - 3, 4, 4), { fill: '#ffffff', comp: 'source-over', ink: false }); });
      sh(g, [[300, 262], [330, 292], [372, 292], [402, 262], [372, 276], [330, 276]], { fill: '#fff3d6', comp: 'source-over', seed: 106, w: 3.8 }); for (let i = 0; i < 4; i++) ln(g, [[322 + i * 22, 276], [322 + i * 22, 290]], { w: 2.6, amp: 0.4 });
      [[260, 330], [330, 340], [390, 340], [450, 330]].forEach(([x, y], i) => sh(g, rect(x - 18, y - 10, 36, 44, 14), { fill: '#7a5ce0', comp: 'source-over', hatch: '#3a2090', seed: 107 + i, w: 4 }));
      sh(g, [[480, 250], [560, 214], [540, 266], [500, 280]], { fill: '#a98bff', comp: 'source-over', hatch: '#5a3cc0', seed: 112, w: 4 }); }
    { const g = A[3].g; for (let i = 0; i < 8; i++) { const x = (i % 2 ? 600 : 40) + (i % 2 ? -1 : 1) * Math.floor(i / 2) * 22, y = 372; [-1, 0, 1].forEach((d, j) => sh(g, [[x, y], [x + d * 30 - 8, y - 70 - j * 6], [x + d * 30 + 8, y - 70 - j * 6]], { fill: '#2ea25e', comp: 'source-over', hatch: '#0d5a2c', seed: 113 + i * 3 + j, w: 3.4 })); }
      sh(g, ell(220, 356, 34, 24), { fill: VER, comp: 'source-over', hatch: '#a02a10', seed: 140, w: 4 }); [[208, 350], [226, 344], [236, 356]].forEach(([x, y]) => sh(g, ell(x, y, 5, 5), { fill: CR, comp: 'source-over', ink: false }));
      ln(g, [[220, 372], [220, 356]], { w: 7, c: '#c9b99a' }); }
    out.creature = A; }

  // ---- 6  THE HEART: sunburst, a big heart, floating hearts, red curtains
  { const A = [L(), L(), L(), L()];
    paper(A[0].g, 16); bg(A[0].g, '#ffd27a', '#e98a1a', 16, -0.3);
    { const g = A[0].g, r = mkRng(77); g.save(); for (let i = 0; i < 28; i++) { const a = (i / 28) * TAU; g.globalCompositeOperation = 'multiply'; ln(g, [[320 + Math.cos(a) * 40, 190 + Math.sin(a) * 40], [320 + Math.cos(a) * 520, 190 + Math.sin(a) * 520]], { c: '#f2542d', w: 3.4, a: 0.25 + 0.25 * r(), amp: 0.5 }); } g.restore(); num(g, 6); }
    const heart = (cx, cy, s) => { const pts = []; for (let i = 0; i < 48; i++) { const t = (i / 48) * TAU, x = 16 * Math.sin(t) ** 3, y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t); pts.push([cx + x * s, cy - y * s]); } return pts; };
    { const g = A[1].g; sh(g, heart(330, 190, 10.5), { fill: VER, comp: 'source-over', hatch: '#9a1e0a', gap: 8, ang: -0.6, seed: 121, w: 5.4, shade: (x, y) => 0.25 + 0.75 * ((x - 220) / 230) });
      sh(g, ell(268, 130, 26, 12, -0.6), { fill: '#ffffff', comp: 'source-over', ink: false, fa: 0.7 }); }
    { const g = A[2].g; [[190, 110, 2.6, AMB], [480, 98, 3.2, '#ff7aa8'], [510, 250, 2.2, CR], [140, 240, 2.8, '#ff7aa8']].forEach(([x, y, s, c], i) => sh(g, heart(x, y, s), { fill: c, comp: 'source-over', hatch: '#c0301a', gap: 7, seed: 122 + i, w: 3.6 }));
      star(g, 330, 70, 10, '#ffffff'); star(g, 420, 320, 8, '#ffffff'); star(g, 240, 310, 7, '#ffffff'); star(g, 440, 150, 6, '#ffffff'); }
    { const g = A[3].g; [[0, 1], [TW, -1]].forEach(([x0, d], i) => { const pts = [[x0, -10], [x0 + d * 120, -10], [x0 + d * 96, 80], [x0 + d * 126, 180], [x0 + d * 90, 280], [x0 + d * 104, 380], [x0, 380]];
        sh(g, sm(pts), { fill: '#c2281a', comp: 'source-over', hatch: '#6a0e08', gap: 9, ang: 1.45, seed: 130 + i, w: 4.6 }); for (let j = 1; j < 5; j++) ln(g, [[x0 + d * j * 22, 0], [x0 + d * (j * 22 + 8), 370]], { c: '#6a0e08', w: 2.6, a: 0.5 }); }); }
    out.heart = A; }

  const tex = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.generateMipmaps = true; return t; };
  const order = ['train', 'moon', 'road', 'ship', 'creature', 'heart'];
  return order.map((k) => out[k].map((l) => tex(l.c)));
}

// ============================== PANELS =======================================
function roundedRectShape(THREE, w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s;
}
function bracketTexture(THREE, S) {   // amber corner brackets + faint cross: the "ghost cell" a panel will snap into
  const w = 640, h = 380, c = S.mk(w, h), g = c.getContext('2d'); g.strokeStyle = '#FFB62E'; g.lineWidth = 9; g.lineCap = 'round'; g.lineJoin = 'round';
  const m = 26, a = 78; [[m, m, 1, 1], [w - m, m, -1, 1], [m, h - m, 1, -1], [w - m, h - m, -1, -1]].forEach(([x, y, dx, dy]) => { g.beginPath(); g.moveTo(x + dx * a, y); g.lineTo(x, y); g.lineTo(x, y + dy * a); g.stroke(); });
  g.lineWidth = 4; g.globalAlpha = 0.6; g.beginPath(); g.moveTo(w / 2 - 22, h / 2); g.lineTo(w / 2 + 22, h / 2); g.moveTo(w / 2, h / 2 - 22); g.lineTo(w / 2, h / 2 + 22); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function buildPanel(THREE, texs, k) {
  const g = new THREE.Group(); g.name = 'panel' + k;
  const outer = roundedRectShape(THREE, PW + 2 * BORD, PH + 2 * BORD, 0.07); outer.holes.push(new THREE.Path(roundedRectShape(THREE, PW, PH, 0.03).getPoints(6)));
  const geo = new THREE.ExtrudeGeometry(outer, { depth: 1, bevelEnabled: false, curveSegments: 6 }); geo.translate(0, 0, -0.6);
  const frameMat = new THREE.MeshStandardMaterial({ color: '#1d1c25', roughness: 0.5, metalness: 0.2, emissive: new THREE.Color('#bcd8ff'), emissiveIntensity: 0 });
  const frame = new THREE.Mesh(geo, frameMat); frame.scale.z = 0.012; g.add(frame);
  // thin amber "light lip" on the front edge of the frame (neon edge: the panel lights up when it snaps / pops)
  const lipOuter = roundedRectShape(THREE, PW + 2 * BORD, PH + 2 * BORD, 0.07); lipOuter.holes.push(new THREE.Path(roundedRectShape(THREE, PW + 2 * BORD - 0.026, PH + 2 * BORD - 0.026, 0.055).getPoints(6)));
  const lipMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.35, 0.4), toneMapped: true });
  const lip = new THREE.Mesh(new THREE.ExtrudeGeometry(lipOuter, { depth: 0.004, bevelEnabled: false, curveSegments: 6 }), lipMat); g.add(lip);
  const layers = texs.map((tx, i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), new THREE.MeshStandardMaterial({ map: tx, emissiveMap: tx, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.22, roughness: 0.9, metalness: 0, transparent: i > 0, alphaTest: i > 0 ? 0.02 : 0, side: THREE.FrontSide }));
    m.renderOrder = 1 + i; g.add(m); return m;
  });
  return { g, frame, frameMat, lip, lipMat, layers };
}

// ============================== SCENE ========================================
export default {
  id: 'job_storyboard', kind: '3d', ratio: 2.39,
  setup({ THREE, S, renderer }) {
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#03050a'); scene.fog = new THREE.FogExp2('#080c14', 0.024);
    const stage = buildStage(THREE, { THREE, S, renderer }, { look: 'neutral', tubes: false, cables: false, marks: false, grips: false, cases: false, table: false }); scene.add(stage.group);
    if (stage.setLook) stage.setLook('neutral', { intensity: 0.7 });
    scene.environment = makeEnv(THREE, renderer, [
      { w: 7, h: 3.5, pos: [-5, 4, 5], color: '#dbe9ff', i: 2.4 }, { w: 2.2, h: 8, pos: [6, 3, -4], color: '#ffd9b0', i: 2.2 },
      { w: 10, h: 2, pos: [0, 8, 1], color: '#ffffff', i: 1.0 }, { w: 6, h: 2, pos: [3, 0.5, 6], color: '#9ad0ff', i: 0.9 },
    ]);
    scene.environmentIntensity = 0.3;
    // perf: unlit baked backdrop instead of the PBR cyc; no shadow maps (blob decal below); drop the weak stage fill light
    stage.lights.key.castShadow = false; stage.floor.receiveShadow = false; stage.cyc.receiveShadow = false; stage.lights.fill.visible = false;
    stage.cyc.visible = false; scene.add(makeBackdrop(THREE, S, [
      { x: -2.5, y: 3.6, rx: 6, ry: 3.4, color: '110,150,230', a: 0.2 }, { x: 2.5, y: 2.6, rx: 5.5, ry: 3.0, color: '140,170,240', a: 0.12 },
      { x: 6.5, y: 2.8, rx: 4.5, ry: 3.2, color: '255,150,60', a: 0.16 }, { x: 0.5, y: 0.4, rx: 12, ry: 0.9, color: '110,120,160', a: 0.1 },
    ], { base: ['#04060b', '#090d16'] }));
    const camera = new THREE.PerspectiveCamera(lensFov(35), 2.39, 0.1, 80);
    const A = createAmrita(THREE); A.root.position.set(...AM); scene.add(A.root);
    if (stage.reflect) stage.reflect(A.root, { strength: 0.8 }); A.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const stylus = makeStylus(THREE); A.root.add(stylus.group); stylus.group.position.set(0.82, 0.12, 0.45); stylus.group.rotation.z = -0.9;
    const glowTex = radialTexture(THREE, S);
    const sprite = (col, sx, sy, op = 1) => { const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(...col), transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); m.scale.set(sx, sy, 1); m.renderOrder = 4; return m; };
    const tipHalo = sprite([0.8, 0.9, 1.0], 0.5, 0.5, 0.6); stylus.inner.add(tipHalo); tipHalo.position.copy(stylus.tipPos);

    // ---- set dressing for THIS set-up: a cool drafting room — soft cool practicals + distant chair
    stage.chair.position.set(4.6, 0, -2.8); stage.chair.rotation.y = -0.8;
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ fog: false }), 40);
    { const r = mkRng(21), m = new THREE.Matrix4(), c = new THREE.Color(); let i = 0; for (let j = 0; j < 26; j++, i++) { const x = lerp(-8.5, 8.5, r()), y = 0.9 + r() * 4.2, z = -7 - r() * 4; m.makeScale(0.07, 0.07, 0.07); m.setPosition(x, y, z); bulbs.setMatrixAt(i, m); const p = r(); c.set(p < 0.5 ? '#cfe8ff' : p < 0.78 ? '#ffc070' : p < 0.9 ? '#7fe3d6' : '#b9a8ff').multiplyScalar(0.9 + r() * 1.1); bulbs.setColorAt(i, c); } bulbs.count = i; }
    scene.add(bulbs);

    // floor light pools + contact shadow
    const poolGeo = new THREE.PlaneGeometry(1, 1);
    const pool = (col, sx, sz, x, z) => { const m = new THREE.Mesh(poolGeo, new THREE.MeshBasicMaterial({ map: glowTex, color: new THREE.Color(...col), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.004, z); m.scale.set(sx, sz, 1); m.renderOrder = 3; scene.add(m); return m; };
    const poolGrid = pool([0.5, 0.75, 1.0], 6.0, 2.8, GRID[0], GRID[2] + 0.2), poolAm = pool([1.0, 0.62, 0.28], 3.2, 2.0, AM[0], AM[2]);
    const blob = new THREE.Mesh(poolGeo, new THREE.MeshBasicMaterial({ map: radialTexture(THREE, S, [[0, 'rgba(0,0,0,0.85)'], [0.5, 'rgba(0,0,0,0.35)'], [1, 'rgba(0,0,0,0)']]), color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false, fog: false }));
    blob.rotation.x = -Math.PI / 2; blob.position.set(AM[0], 0.006, AM[2]); blob.scale.set(1.6, 1.1, 1); blob.renderOrder = 2; scene.add(blob);

    // ---- light cones + dust (cool key from the front-left, amber rim from behind-right)
    const KEYP = new THREE.Vector3(-4.2, 6.6, 5.2), RIMP = new THREE.Vector3(4.4, 6.0, -4.6);
    const beamKey = makeBeam(THREE, { color: '#bcdcff', length: 11, radius: 1.1, intensity: 0.13, power: 1.5 }); scene.add(beamKey); beamKey.userData.aim(KEYP, new THREE.Vector3(-3.3, 0.8, 0.4), 11);
    const beamRim = makeBeam(THREE, { color: '#ffb868', length: 12, radius: 1.1, intensity: 0.085, power: 1.5 }); scene.add(beamRim); beamRim.userData.aim(RIMP, new THREE.Vector3(1.6, 1.0, 0.2), 12);
    const dustA = makeDust(THREE, { count: 320, center: [0, 2.0, 0.5], size: [9, 5, 6], color: '#d8ecff', psize: 0.02, intensity: 1.1, seed: 7 }); dustA.userData.setBeam(KEYP, beamKey.userData.dir, 0.1); scene.add(dustA);
    const dustB = makeDust(THREE, { count: 160, center: [0, 2.0, 0], size: [10, 5, 8], color: '#ffd9a0', psize: 0.017, intensity: 0.55, seed: 8 }); dustB.userData.setBeam(RIMP, beamRim.userData.dir, 0.12); scene.add(dustB);

    // ---- panels
    const thumbs = makeThumbs(THREE, S), brk = bracketTexture(THREE, S);
    const panels = thumbs.map((t, k) => {
      const p = buildPanel(THREE, t, k); scene.add(p.g); p.g.visible = false;
      const ghost = new THREE.Mesh(new THREE.PlaneGeometry(PW + 0.13, (PW + 0.13) * 380 / 640), new THREE.MeshBasicMaterial({ map: brk, transparent: true, opacity: 0, alphaTest: 0.25, depthWrite: true, blending: THREE.AdditiveBlending, color: new THREE.Color(1.6, 1.1, 0.4), fog: false }));
      ghost.position.set(CELLS[k][0], CELLS[k][1], CELLS[k][2] - 0.02); ghost.renderOrder = 3; scene.add(ghost);
      const halo = sprite([0.55, 0.72, 1.0], 2.1, 1.35, 0); halo.position.set(CELLS[k][0], CELLS[k][1], CELLS[k][2] - 0.25); scene.add(halo);
      return { ...p, ghost, halo, cell: CELLS[k] };
    });
    // whoosh speed-lines (camera-facing billboard, radial streaks)
    const whoosh = new THREE.Mesh(new THREE.PlaneGeometry(12, 12 / 2.39 * 1.3), new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `varying vec2 vUv; uniform float uT; void main(){ vec2 p = (vUv*2.0-1.0)*vec2(1.0,0.8); float r = length(p); float a = atan(p.y,p.x);
        float rays = smoothstep(0.55,0.95, 0.5+0.5*sin(a*46.0 + sin(a*9.0)*2.0)) * smoothstep(0.35,0.9, 0.5+0.5*sin(a*17.0+1.3));
        float band = smoothstep(uT*1.1+0.02, uT*1.1+0.12, r) * (1.0 - smoothstep(uT*1.1+0.12, uT*1.1+0.5, r));
        float lab = 1.0 - smoothstep(0.0,0.5, length((vUv-vec2(0.12,0.12))*vec2(1.4,1.0))*1.6 - 0.2); float f = rays*band*(1.0-uT)*(1.0-uT)*(1.0-0.9*lab); gl_FragColor = vec4(vec3(0.75,0.88,1.0)*f*1.3, f); }` }));
    whoosh.renderOrder = 9; whoosh.visible = false; whoosh.frustumCulled = false; scene.add(whoosh);

    const glow = new THREE.PointLight('#bfdcff', 0, 16, 2); scene.add(glow);

    // ---- sparks + rings
    const bursts = [], rings = [], cool = [1.8, 2.3, 3.0], warm = [3.0, 2.2, 1.0];
    panels.forEach((p, k) => {
      const c = p.cell, t = T0 + SNAPS[k];
      bursts.push({ t, pos: [c[0], c[1] - 0.2, c[2] + 0.12], n: 16, speed: [0.4, 2.2], life: [0.3, 0.7], dir: [0, 0.2, 1], spread: 0.85, size: [0.012, 0.028], color: k % 2 ? warm : cool, seed: k + 1 });
      rings.push({ t, pos: [c[0], c[1], c[2] + 0.04], r0: 0.08, r1: 0.78, dur: 0.2, color: [0.9, 1.15, 1.5], width: 0.05 });
      bursts.push({ t: T0 + POP + 0.025 * k, pos: [c[0], c[1], c[2] + 0.1], n: 14, speed: [0.8, 3.4], life: [0.4, 0.9], dir: [0, 0, 1], spread: 0.95, size: [0.012, 0.026], color: (k % 2 ? cool : warm).map((v) => v * 0.7), seed: 50 + k });
    });
    rings.push({ t: T0 + POP, pos: [GRID[0], GRID[1], GRID[2] + 0.2], r0: 0.4, r1: 2.8, dur: 0.34, color: [0.7, 0.85, 1.1], width: 0.03 });
    const sparks = makeSparks(THREE, bursts); scene.add(sparks);
    const ringsG = makeRings(THREE, rings); scene.add(ringsG);

    const tmp = { v: new THREE.Vector3(), v2: new THREE.Vector3(), v3: new THREE.Vector3(), q: new THREE.Quaternion() };
    return { scene, camera, stage, A, THREE, stylus, tipHalo, panels, bulbs, whoosh, glow, beamKey, beamRim, dustA, dustB, sparks, ringsG, poolGrid, poolAm, blob, tmp, KEYP, RIMP };
  },

  update(st, T, S) {
    const { THREE, camera, A, panels, tmp, stage } = st;
    const lt = clamp(T.lt, 0, 2), t = T.t, imp = Math.min(1, T.impact);
    // DEV-HOOK (removed before delivery): globalThis.__dbg.hide = ['beamKey', 'stage.group', ...] toggles visibility of named parts for profiling
    { const D = globalThis.__dbg || {}; if (D.hide !== undefined || st._hid) { for (const n of st._hid || []) { const o = n.split('.').reduce((a, k) => a && a[k], st); if (o) o.visible = true; } st._hid = D.hide || []; for (const n of st._hid) { const o = n.split('.').reduce((a, k) => a && a[k], st); if (o) o.visible = false; } } }
    const popK = lt >= POP ? Math.exp(-(lt - POP) / 0.12) : 0;
    const nSnap = SNAPS.reduce((n, s) => n + (lt >= s ? 1 : 0), 0), lastSnap = nSnap ? SNAPS[nSnap - 1] : -1;

    // ---------------- camera: constant-speed dolly-in (35 mm) + a lateral swoop on the pop so the diorama layers parallax
    const s = lerp(lt / 2, smooth(lt / 2), 0.4), swoop = smooth(seg(lt, POP - 0.05, 2.0));
    camera.position.set(lerp(-0.8, -0.35, s) + 0.5 * swoop + 0.012 * noise1(t * 0.8, 1) + imp * 0.02 * noise1(t * 53, 7), lerp(1.02, 1.26, s) + imp * 0.014 * noise1(t * 47, 9) + 0.03 * swoop, lerp(6.5, 5.2, s));
    camera.fov = lensFov(35) * (1 - 0.035 * popK);
    camera.lookAt(tmp.v.set(lerp(-0.3, 0.0, s) + 0.25 * swoop, lerp(1.12, 1.2, s), 0.2));
    camera.updateProjectionMatrix();

    // ---------------- Amrita: watches the grid, flicks the stylus on each snap, startles at the pop, then smiles
    const sg = lt - lastSnap, nod = nSnap && lt < 1.0 ? -0.07 * Math.exp(-sg / 0.05) : 0;
    const popB = lt >= POP ? 0.15 * Math.exp(-(lt - POP) / 0.12) * Math.cos((lt - POP) * 24) : 0;
    A.pose({ squash: nod + popB, yaw: 0.34 + 0.03 * Math.sin(t * 1.5), roll: 0.02 * Math.sin(t * 1.3), bob: 0.035 * Math.sin(t * 2.3) });
    A.eyes({ open: 1 - A.blinkAt(T), squint: 0, sleepy: 0, determined: lt < 0.95 ? 0.5 : 0, surprised: lt >= POP && lt < 1.62 ? 0.8 * Math.exp(-(lt - POP) / 0.2) : 0, happy: (lt >= 0.95 && lt < POP) || lt >= 1.62 ? 1 : 0, lookX: 0.85, lookY: 0.1 });
    A.setProp(null);
    { const fl = nSnap && lt < 1.0 ? Math.exp(-sg / 0.06) : 0, idle = Math.sin(t * 2.5) * 0.02;
      st.stylus.group.position.set(0.82, 0.12 + idle + 0.04 * fl, 0.45); st.stylus.group.rotation.z = -0.9 + 0.4 * fl - 0.15 * popK;
      st.stylus.tipM.color.setRGB(2.4 + 6 * fl + 6 * popK, 2.8 + 5 * fl + 5 * popK, 3.2 + 3 * fl + 3 * popK); st.tipHalo.material.opacity = 0.35 + 0.65 * Math.max(fl, popK); st.tipHalo.scale.setScalar(0.4 + 0.5 * Math.max(fl, popK)); }

    // ---------------- panels
    const HAND = [-0.5, 1.28, 0.62];
    let flash = 0;
    panels.forEach((p, k) => {
      const tS = SNAPS[k], FD = 0.26, c = p.cell, a = lt - tS, pr = (lt - (tS - FD)) / FD, col = k % 3, row = Math.floor(k / 3);
      // ghost brackets
      const gIn = 0.55 + 0.45 * smooth(seg(lt, 0.02 * k, 0.2 + 0.02 * k));
      p.ghost.material.opacity = a < 0 ? 0.55 * gIn : (0.5 * Math.exp(-a / 0.1) + 1.4 * Math.exp(-a / 0.035));
      p.ghost.visible = p.ghost.material.opacity > 0.01;
      p.g.visible = pr >= 0;
      if (pr < 0) { p.halo.material.opacity = 0; return; }
      const pc = clamp(pr), ee = Math.pow(pc, 1.8), v = 1 - ee;
      const mx = (HAND[0] + c[0]) / 2, my = Math.max(HAND[1], c[1]) + 0.55, mz = 1.2;
      let x = v * v * HAND[0] + 2 * v * ee * mx + ee * ee * c[0], y = v * v * HAND[1] + 2 * v * ee * my + ee * ee * c[1], z = v * v * HAND[2] + 2 * v * ee * mz + ee * ee * c[2];
      let sc = lerp(0.2, 1, Math.pow(pc, 1.1)), rz = (k % 2 ? 1 : -1) * 1.2 * v, ry = (col - 1 + 0.01) * 1.0 * v;
      const bump = a >= 0 ? Math.exp(-a / 0.055) : 0;
      if (a >= 0) { z += 0.16 * bump * Math.cos(a * 36); sc *= 1 + 0.06 * bump * Math.cos(a * 30); }
      const idle = a >= 0 ? smooth(seg(a, 0.2, 0.5)) : 0; y += idle * 0.012 * Math.sin(t * 2.1 + k * 0.9); rz += idle * 0.008 * Math.sin(t * 1.7 + k);
      // pop: extrude the frame into a shadow box, split the thumbnail into parallax cards
      const pa = lt - (POP + 0.025 * k), pp = seg(pa, 0, 0.3), ep = outBack(pp, 1.5), pPop = pa >= 0 ? Math.exp(-pa / 0.08) : 0;
      sc *= 1 + 0.07 * Math.sin(Math.PI * seg(pa, 0, 0.35)) * (pa >= 0 ? 1 : 0);
      const fan = smooth(seg(lt, POP + 0.05, POP + 0.45)), yaw = -(col - 1) * 0.2 * fan + 0.05 * Math.sin(t * 2.2 + k * 0.8) * fan, pit = (row - 0.5) * 0.1 * fan;
      p.g.position.set(x, y, z); p.g.rotation.set(pit, ry + yaw, rz); p.g.scale.setScalar(sc);
      const Dp = 0.012 + 0.5 * ep; p.frame.scale.z = Dp;
      p.layers.forEach((m, i) => { m.position.z = LAYER_Z[i] * 1.2 * ep + 0.0016 * i; m.material.color.setScalar(lerp(1, LAYER_SHADE[i], smooth(pp))); m.material.emissiveIntensity = 0.22 * lerp(1, 0.8, smooth(pp)) + 0.7 * pPop * (0.4 + 0.2 * i) + 0.9 * bump; });
      p.frameMat.emissiveIntensity = 1.5 * bump + 1.3 * pPop + (pp > 0 ? 0.05 : 0);
      p.lip.position.z = 0.4 * Dp + 0.002; p.lipMat.color.setRGB(2.2, 1.35, 0.4).multiplyScalar(0.55 + 0.9 * bump + 0.6 * pPop + 0.25 * ep);
      p.halo.visible = true; p.halo.material.opacity = clamp((a >= 0 ? 0.06 : 0) + 0.45 * bump + 0.35 * pPop + 0.05 * ep, 0, 1);
      flash += bump * 0.5 + pPop * 0.6;
    });

    // whoosh speed-lines on the pop
    { const wa = (lt - POP) / 0.36; st.whoosh.visible = wa >= 0 && wa < 1; if (st.whoosh.visible) { st.whoosh.position.set(GRID[0] + 0.1, GRID[1], GRID[2] + 1.2); st.whoosh.quaternion.copy(camera.quaternion); st.whoosh.material.uniforms.uT.value = wa; } }

    // ---------------- lights
    if (stage.update) stage.update(T);
    const L = stage.lights;
    L.key.color.set('#fff1e0'); L.key.intensity = 235; L.key.position.set(-2.6, 4.6, 6.4); L.key.target.position.set(-0.8, 1.0, 0.3); L.key.angle = 0.5; L.key.penumbra = 0.75;
    L.rim.color.set('#ffb35c'); L.rim.intensity = 330; L.rim.position.copy(st.RIMP); L.rim.target.position.set(0.8, 1.1, 0); L.rim.angle = 0.3; L.rim.penumbra = 0.8;
    L.fill.color.set('#5f7fc0'); L.fill.intensity = 6; L.amb.intensity = 0.08;
    st.glow.position.set(GRID[0] - 0.3, GRID[1] + 0.2, 2.4); st.glow.intensity = 1.5 * (nSnap / 6) + 1.5 * flash * 0.5 + 2.5 * popK;
    st.poolGrid.material.opacity = 0.15 * (nSnap / 6) + 0.2 * popK; st.poolAm.material.opacity = 0.16 + 0.05 * popK;

    // ---------------- uniforms
    const px = pxPerUnit(S, camera.fov);
    st.sparks.material.uniforms.uTime.value = t; st.sparks.material.uniforms.uPx.value = px;
    for (const d of [st.dustA, st.dustB]) { d.material.uniforms.uTime.value = t; d.material.uniforms.uPx.value = px; }
    st.beamKey.material.uniforms.uTime.value = t; st.beamRim.material.uniforms.uTime.value = t; st.ringsG.userData.update(t, camera);

    const fp = tmp.v.set(lerp(AM[0], GRID[0], 0.45), 1.15, lerp(AM[2], GRID[2], 0.85));
    return { dof: { focus: camera.position.distanceTo(fp), strength: 0.6, maxPx: 13, bokeh: 1.4 }, bloom: { strength: 0.34 + 0.2 * imp + 0.3 * popK + 0.06 * Math.min(1, flash), radius: 0.5, threshold: 1.15 } };
  },
};
