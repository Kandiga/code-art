// =============================================================================
// e1895 — 4.0-6.0 s, 4:3 B&W flicker.  "THE TRAIN ARRIVES"   prop: hand-crank camera   portal: LENS @ (1240,590) r=110
//   4.00-4.45  IRIS-IN from black (hand-drawn soft edge, bright rim carries the cold-open's white light through the aperture)
//   4.0-5.4    a steam locomotive comes HEAD-ON down the track: it GROWS from far to near (uniform scale about the vanishing
//              point), chuff puffs on 4.25 4.5 4.75 5.0 5.25 (+5.5), whistle jet 4.75, bystanders lean back, hats fly, Amrita
//              (left third, crank camera cranking, irregular like a hand) goes curious -> wide-eyed flinch at 5.0, keeps cranking
//   5.4-6.0    the headlamp IS the portal: a big brass lens (concentric rings + hot core) at exactly (1240,590) r=110, unoccluded
// Pure function of T.t. All randomness = seeded hashing. Every pencil call gets T.boil (12 fps line boil).
// =============================================================================
import * as P from '../pencil.js';
import { hash, noise1 } from '../rng.js';
import { clamp, lerp, smooth, outCubic, outBack, spring } from '../ease.js';
import { ERAS } from '../../../shared/cues.js';

const ERA = ERAS[0], PORTAL = ERA.portal;               // {type:'lens', cx:1240, cy:590, r:110}
const rad = (d) => (d * Math.PI) / 180;
const TAU = Math.PI * 2;
const VP = [1000, 450];                                  // vanishing point of the track
const EYE = 1.7;                                         // eye height above the platform (m)
// world -> screen. X metres right of camera, Y metres above the platform floor, c = pixels per metre at that depth
const WP = (X, Y, c) => [VP[0] + X * c, VP[1] + (EYE - Y) * c];
const BAR = '#0b0a0d';
const INK = '#2A2833', INKL = '#55505e';
// B&W-friendly value ramp (multiplied onto the paper; the grade then maps to monochrome)
const V = { l1: '#E9E0CE', l2: '#D6CCB8', m1: '#B4AB98', m2: '#8E8778', d1: '#5F5A66', d2: '#3D3A45', d3: '#26242C' };
const CHUFF = [4.25, 4.5, 4.75, 5.0, 5.25, 5.5];         // = SFX train_chuff beat grid (0.25 s)
const WHISTLE_T = 4.75;                                   // = SFX train_whistle
const FLINCH_T = 5.0;                                     // the "audience flinches" beat
const LENS_T = 5.4;                                       // loco arrives, lamp == portal from here on

// ----------------------------------------------------------------- loco growth
const S0 = 0.075;
function locoScale(t) {
  const u = clamp((t - 4.0) / (LENS_T - 4.0));
  if (u >= 1) return 1;
  const g = 1 - Math.pow(1 - Math.pow(u, 1.15), 1.6);    // accelerating, then braking into the stop (zero speed at arrival)
  return S0 * Math.pow(1 / S0, g);
}
// loco space: pixels at s = 1, origin = vanishing point.  lamp centre = (240,140) -> screen (1240,590)
const LAMP = [PORTAL.cx - VP[0], PORTAL.cy - VP[1]];     // [240,140]
const SMOKEBOX = { c: [LAMP[0], 290], R: 310 };

// --------------------------------------------------------------- tiny tools
function shp(g, pts, o = {}) {
  P.shape(g.ctx, pts, {
    boil: g.boil, seed: o.seed ?? 1,
    fill: o.fill ? { color: o.fill, offset: o.off ?? [3, 2], amp: o.famp ?? 1.2, alpha: o.fa ?? 1, comp: o.comp ?? 'multiply' } : false,
    hatch: o.hatch ? { color: o.hatch, gap: o.gap ?? 7, width: o.hw ?? 1.2, alpha: o.ha ?? 0.5, angle: o.ang ?? -0.75, cross: o.cross ?? 0, shade: o.shade ?? null, segLen: o.seg ?? 38, margin: o.margin ?? 0, comp: o.hcomp ?? 'multiply' } : false,
    ink: o.ink === false ? false : { color: o.ic ?? INK, width: o.w ?? 2.4, amp: o.amp ?? 1.2, alpha: o.ia ?? 0.92, passes: o.passes ?? 2, step: o.step ?? 9 },
    closed: o.closed ?? true,
  });
}
function ln(g, pts, o = {}) {
  P.ink(g.ctx, pts, { closed: false, boil: g.boil, seed: o.seed ?? 1, color: o.c ?? INK, width: o.w ?? 2, amp: o.amp ?? 1, alpha: o.a ?? 0.9, passes: o.passes ?? 2, taper: o.taper ?? false, step: o.step ?? 10 });
}
const poly = (ctx, pts) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); };
const circ = (cx, cy, r, n = 28, rot = 0) => P.circlePts(cx, cy, r, n, rot);
// loco-space helper: returns a point mapper for the current scale
const mk = (s) => ({ s, p: (u, v) => [VP[0] + u * s, VP[1] + v * s], pts: (a) => a.map(([u, v]) => [VP[0] + u * s, VP[1] + v * s]), lw: (w) => Math.max(1.4, w * Math.pow(s, 0.55)), amp: (a = 1.2) => Math.max(0.5, a * Math.pow(s, 0.4)) });

// ================================================================= ENVIRONMENT
function skyAndSkyline(g) {
  const { ctx } = g;
  // a few pencil clouds up in the right half (keeps the HUD caption zone clean)
  for (let i = 0; i < 4; i++) {
    const cx = 1230 + i * 130 + hash(i, 1) * 60, cy = 215 + hash(i, 2) * 60 + (i % 2) * 36, w = 120 + hash(i, 3) * 90;
    const pts = P.smoothPts([[cx - w, cy + 14], [cx - w * 0.7, cy - 12], [cx - w * 0.3, cy - 30], [cx + w * 0.1, cy - 22], [cx + w * 0.55, cy - 34], [cx + w, cy - 6], [cx + w * 0.8, cy + 16]], { closed: true, n: 6 });
    shp(g, pts, { seed: 40 + i, fill: V.l1, fa: 0.7, hatch: V.m1, ha: 0.28, gap: 9, ang: -0.1, w: 1.8, ia: 0.5, amp: 1.6 });
  }
  // distant skyline along the horizon: roofs, chimneys, a little spire
  const y0 = VP[1] + 3; let x = 190, i = 0;
  while (x < 1760) {
    const w = 34 + hash(i, 7) * 70, h = 10 + hash(i, 8) * 40 * (0.6 + 0.4 * Math.sin(i * 1.3) ** 2);
    const pts = [[x, y0], [x, y0 - h], [x + w * 0.5, y0 - h - (hash(i, 9) < 0.5 ? 12 : 0)], [x + w, y0 - h], [x + w, y0]];
    shp(g, pts, { seed: 60 + i, fill: V.l2, hatch: V.m2, ha: 0.32, gap: 6, ang: 0.0, w: 1.7, ia: 0.6, amp: 1.0, off: [2, 1.5] });
    if (hash(i, 10) < 0.35) shp(g, P.rectPts(x + w * 0.62, y0 - h - 26, 7, 26, 0), { seed: 90 + i, fill: V.m1, w: 1.4, ia: 0.6, amp: 0.6 });
    x += w * 0.92; i++;
  }
  // church spire
  const sx = 1130;
  shp(g, [[sx - 16, y0], [sx - 16, y0 - 54], [sx, y0 - 118], [sx + 16, y0 - 54], [sx + 16, y0]], { seed: 120, fill: V.l2, hatch: V.m2, ha: 0.4, gap: 5, ang: 0.0, w: 2, ia: 0.7, amp: 0.8 });
  // smoke from a far chimney (the factory beyond the station)
  for (let k = 0; k < 4; k++) ln(g, P.smoothPts([[1540 + k * 6, y0 - 70], [1530 + k * 14, y0 - 100 - k * 12], [1560 + k * 20, y0 - 134 - k * 14]], { n: 5 }), { c: INKL, w: 2, a: 0.35, seed: 130 + k });
}

function walls(g) {
  const { ctx } = g;
  // LEFT building facade: wall plane X=-6.5, runs back to the vanishing point
  const wl = (Y, c) => WP(-6.5, Y, c), cL = 154;
  const wallL = [VP, wl(5.4, cL), wl(0, cL)];
  shp(g, wallL, { seed: 140, fill: V.l1, hatch: V.m1, ha: 0.3, gap: 8, ang: 0.02, w: 2.2, ia: 0.7, amp: 0.9 });
  // arched windows in perspective (Z = 600 / c)
  for (let k = 0; k < 7; k++) {
    const Z0 = 5.2 + k * 3.4, c0 = 600 / Z0, c1 = 600 / (Z0 + 1.7);
    const q = [wl(3.4, c0), wl(3.4, c1), wl(0.9, c1), wl(0.9, c0)];
    if (q[0][0] < 150) continue;
    shp(g, q, { seed: 150 + k, fill: V.d2, hatch: V.d3, ha: 0.5, gap: 5, ang: 0.0, w: 2, amp: 0.7, off: [1.5, 1], step: 7 });
    const mid0 = wl(2.15, c0), mid1 = wl(2.15, c1), cm = wl(3.4, (c0 + c1) / 2), cb = wl(0.9, (c0 + c1) / 2);
    ln(g, [mid0, mid1], { c: V.l1, w: 1.8, a: 0.7, seed: 160 + k }); ln(g, [cm, cb], { c: V.l1, w: 1.8, a: 0.7, seed: 170 + k });
  }
  // string course + base line
  ln(g, [VP, wl(3.9, cL)], { c: INKL, w: 1.6, a: 0.6, seed: 181 }); ln(g, [VP, wl(0.2, cL)], { c: INKL, w: 1.6, a: 0.6, seed: 182 });
  // RIGHT building (far side of the tracks): plane X=+9
  const wr = (Y, c) => WP(9, Y, c), cR = 80;
  shp(g, [VP, wr(5.0, cR), wr(0, cR)], { seed: 190, fill: V.l1, hatch: V.m1, ha: 0.28, gap: 8, ang: 0.02, w: 2.2, ia: 0.7, amp: 0.9 });
  for (let k = 0; k < 6; k++) {
    const Z0 = 7.6 + k * 4.2, c0 = 600 / Z0, c1 = 600 / (Z0 + 2.0);
    const q = [wr(3.2, c0), wr(3.2, c1), wr(1.0, c1), wr(1.0, c0)];
    if (q[0][0] > 1740) continue;
    shp(g, q, { seed: 200 + k, fill: V.d2, hatch: V.d3, ha: 0.5, gap: 5, ang: 0.0, w: 2, amp: 0.7, off: [1.5, 1], step: 7 });
  }
  // far platform floor + its face (facing us)
  const fe = (Y, c) => WP(3.6, Y, c);
  shp(g, [VP, fe(0, 195), wr(0, cR)], { seed: 210, fill: V.l2, hatch: V.m1, ha: 0.25, gap: 8, ang: 0.0, w: 2, ia: 0.6, amp: 1.0 });
  shp(g, [VP, fe(0, 195), fe(-0.9, 195)], { seed: 211, fill: V.d1, hatch: V.d3, ha: 0.4, gap: 6, ang: 0.1, w: 2, amp: 1 });
}

function canopy(g) {
  const { ctx } = g;
  // roof underside: plane from the wall top (X=-6.5, 5.4 m) down to the gutter (X=-1.8, 4.2 m) — light, so the HUD caption reads over it
  const roofY = (X) => 5.4 - ((X + 6.5) * 1.2) / 4.7;
  const rf = (X, c) => WP(X, roofY(X), c);
  // purlins fan out from the vanishing point
  for (const X of [-6.5, -5.3, -4.1, -2.9, -1.8]) ln(g, [VP, rf(X, 210)], { c: INKL, w: X === -1.8 ? 3 : 1.8, a: X === -1.8 ? 0.85 : 0.55, seed: 220 + Math.round(-X * 10) });
  // rafters (trusses) with a light X lattice, getting smaller toward the vanishing point
  for (let k = 0; k < 14; k++) {
    const Z = 4.6 + k * 2.4, c = 600 / Z, a = rf(-6.5, c), b = rf(-1.8, c);
    ln(g, [a, b], { c: INK, w: Math.max(1.4, 3.4 * Math.pow(c / 130, 0.5)), a: 0.75, seed: 240 + k, amp: 0.8 });
    if (k < 5) {
      const m1 = rf(-5.0, c), m2 = rf(-3.4, c), d = WP(-3.4, roofY(-3.4) - 0.9, c), d2 = WP(-5.0, roofY(-5.0) - 0.9, c), d3 = WP(-6.5, roofY(-6.5) - 0.9, c), d4 = WP(-1.8, roofY(-1.8) - 0.9, c);
      ln(g, [d3, d2, d, d4], { c: INKL, w: 1.5, a: 0.6, seed: 260 + k, amp: 0.7 });
      ln(g, [m1, d], { c: INKL, w: 1.3, a: 0.5, seed: 270 + k }); ln(g, [m2, d2], { c: INKL, w: 1.3, a: 0.5, seed: 280 + k });
    }
  }
  // glass: very light diagonal hatch in a few bays
  for (let k = 0; k < 5; k++) {
    const c0 = 600 / (4.6 + k * 2.4), c1 = 600 / (4.6 + (k + 1) * 2.4);
    const bay = [rf(-6.5, c0), rf(-1.8, c0), rf(-1.8, c1), rf(-6.5, c1)];
    P.hatch(g.ctx, bay, { color: '#9aa4a8', gap: 11, width: 1, alpha: 0.2, angle: 0.55, boil: g.boil, seed: 290 + k, jitter: 0.6 });
  }
}

function platformAndTrack(g) {
  const { ctx } = g, XE = -0.49;
  // LEFT platform floor with flagstones
  const floor = [VP, WP(XE, 0, 370), [0, 1080], [0, WP(-6.5, 0, 154)[1]]];
  shp(g, floor, { seed: 300, fill: V.l2, hatch: V.m1, ha: 0.2, gap: 12, ang: -0.5, w: 2, ia: 0.6, amp: 1.2, off: [0, 0] });
  for (const X of [-1.2, -2.2, -3.3, -4.5, -5.7]) ln(g, [VP, WP(X, 0, 400)], { c: INKL, w: 1.4, a: 0.38, seed: 310 + Math.round(-X * 10) });
  for (let j = 0; j < 22; j++) { const Z = 1.55 + j * 0.95 * (1 + j * 0.06), c = 600 / Z, a = WP(XE, 0, c), b = WP(-6.5, 0, c); if (a[1] > 1090) continue; ln(g, [a, b], { c: INKL, w: 1.3, a: 0.34, seed: 330 + j, amp: 0.8 }); }
  // the platform edge: coping stone line + the dark wall face dropping to the track bed
  shp(g, [VP, WP(XE, 0, 242), WP(XE, -0.9, 242)], { seed: 360, fill: V.d1, hatch: V.d3, ha: 0.45, gap: 6, ang: 0.08, w: 2.2, amp: 1.0 });
  ln(g, [VP, WP(XE, 0, 370)], { c: INK, w: 3.4, a: 0.95, seed: 361, amp: 1.0 });
  ln(g, [VP, WP(XE + 0.18, 0, 370)], { c: V.m1, w: 2, a: 0.7, seed: 362 });
  // TRACK BED (0.9 m below the platform): gravel
  const bed = [VP, WP(XE, -0.9, 242), [1920, 1080], [1920, WP(3.6, -0.9, 255.6)[1]]];
  shp(g, bed, { seed: 370, fill: V.m1, hatch: V.d1, ha: 0.35, gap: 8, ang: -0.04, w: 0.01, ia: 0, amp: 0.5, off: [0, 0], seg: 18, ink: false });
  // sleepers
  for (let j = 0; j < 34; j++) {
    const Z = 2.0 + j * 0.62 * (1 + j * 0.035), c0 = 600 / Z, c1 = 600 / (Z + 0.3 + j * 0.01);
    const q = [WP(-0.2, -0.9, c0), WP(2.2, -0.9, c0), WP(2.2, -0.9, c1), WP(-0.2, -0.9, c1)];
    if (q[0][1] > 1100 && q[3][1] > 1100) continue;
    shp(g, q, { seed: 380 + j, fill: V.d1, w: Math.max(1.2, 2.3 * Math.pow(c0 / 200, 0.5)), ia: 0.8, amp: 0.7, off: [1, 1], step: 12 });
  }
  // rails: wedge strips + a bright head line
  for (const [Xr, id] of [[0.1, 0], [1.9, 1]]) {
    const w = 0.1;
    shp(g, [VP, WP(Xr - w, -0.78, 300), WP(Xr + w, -0.78, 300)], { seed: 420 + id, fill: V.d3, w: 2, ia: 0.9, amp: 0.7, off: [1, 1], step: 14 });
    ln(g, [VP, WP(Xr - w * 0.3, -0.78, 300)], { c: '#ffffff', w: 2, a: 0.55, seed: 430 + id });
  }
  // far platform coping line
  ln(g, [VP, WP(3.6, 0, 195)], { c: INK, w: 2.8, a: 0.85, seed: 440 });
}

function columnsAndFurniture(g, t) {
  const { ctx } = g;
  // cast-iron columns along the platform (X = -1.8), geometrically spaced
  const cols = [];
  for (let k = 0; k < 9; k++) cols.push(600 / (4.6 + k * 2.5));
  // gantry + sign + clock (c = 130 depth, hung on the first column)
  const c1 = cols[0];
  const topY = (c) => WP(-1.8, 4.2, c)[1];
  for (let k = cols.length - 1; k >= 0; k--) {
    const c = cols[k], x = 1000 - 1.8 * c, yb = 450 + EYE * c, yt = topY(c), w = Math.max(3, 0.26 * c);
    const col = [[x - w * 0.5, yb], [x - w * 0.42, yt], [x + w * 0.42, yt], [x + w * 0.5, yb]];
    shp(g, col, { seed: 450 + k, fill: V.d2, hatch: V.d3, ha: 0.4, gap: Math.max(3, 5 * (c / 130)), ang: 1.4, w: Math.max(1.4, 2.6 * Math.pow(c / 130, 0.5)), amp: 0.7, off: [1.5, 1], step: 10 });
    // base plinth + capital
    shp(g, P.rectPts(x - w * 0.72, yb - w * 0.7, w * 1.44, w * 0.7, 0), { seed: 470 + k, fill: V.d1, w: Math.max(1.2, 2 * Math.pow(c / 130, 0.5)), amp: 0.6, off: [1, 1] });
    shp(g, P.rectPts(x - w * 0.7, yt - 2, w * 1.4, w * 0.45, 0), { seed: 480 + k, fill: V.d1, w: Math.max(1.2, 2 * Math.pow(c / 130, 0.5)), amp: 0.6, off: [1, 1] });
    // spandrel bracket to the roof (curved)
    if (k < 5) ln(g, P.smoothPts([[x, yt + 0.9 * c * 0.7], [x - 0.25 * c * 0.6, yt + 0.28 * c * 0.7], [x - 0.9 * c * 0.45, yt - 0.02 * c]], { n: 6 }), { c: INK, w: Math.max(1.3, 2.4 * Math.pow(c / 130, 0.5)), a: 0.7, seed: 490 + k });
  }
  // gas lamp posts on the platform edge strip (X=-0.95): lantern glows
  for (const Z of [3.7, 6.1, 8.6, 11.1]) {
    const c = 600 / Z, x = 1000 - 0.95 * c, yb = 450 + EYE * c, yt = 450 + (EYE - 3.1) * c, w = Math.max(2, 0.1 * c);
    shp(g, [[x - w * 0.6, yb], [x - w * 0.35, yt], [x + w * 0.35, yt], [x + w * 0.6, yb]], { seed: 500 + Math.round(Z * 3), fill: V.d2, w: Math.max(1.3, 2 * Math.pow(c / 130, 0.5)), amp: 0.6, off: [1, 1] });
    const lw = 0.34 * c, lh = 0.5 * c, ly = yt - lh;
    shp(g, [[x - lw * 0.5, yt], [x - lw * 0.62, ly + lh * 0.25], [x, ly - lh * 0.15], [x + lw * 0.62, ly + lh * 0.25], [x + lw * 0.5, yt]], { seed: 520 + Math.round(Z * 3), fill: '#ffffff', fa: 1, comp: 'source-over', w: Math.max(1.3, 2.2 * Math.pow(c / 130, 0.5)), amp: 0.7, off: [1, 1] });
    ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = 'rgba(255,230,160,0.0)'; ctx.restore();
  }
  // ---- the station gantry: beam from the wall to column 1, two chains, the hand-lettered ORRINGDALE board
  const by = 450 + (EYE - 3.5) * c1, bx0 = 150, bx1 = 1000 - 1.8 * c1;
  shp(g, [[bx0, by - 7], [bx1 + 10, by - 7], [bx1 + 10, by + 7], [bx0, by + 7]], { seed: 540, fill: V.d2, w: 2.6, amp: 0.8, off: [1.5, 1] });
  const sx0 = 372, sx1 = 706, sy0 = by + 56, sy1 = sy0 + 82;
  ln(g, [[sx0 + 30, by + 7], [sx0 + 30, sy0]], { c: INK, w: 2.4, a: 0.9, seed: 541 }); ln(g, [[sx1 - 30, by + 7], [sx1 - 30, sy0]], { c: INK, w: 2.4, a: 0.9, seed: 542 });
  const sway = Math.sin(t * 1.3) * 0.004;
  ctx.save(); ctx.translate((sx0 + sx1) / 2, by + 7); ctx.rotate(sway); ctx.translate(-(sx0 + sx1) / 2, -(by + 7));
  const board = P.rectPts(sx0, sy0, sx1 - sx0, sy1 - sy0, 10);
  shp(g, board, { seed: 543, fill: V.d3, hatch: '#000', ha: 0.35, gap: 6, ang: 0.0, w: 3.2, amp: 1.0, off: [4, 3] });
  shp(g, P.rectPts(sx0 + 9, sy0 + 9, sx1 - sx0 - 18, sy1 - sy0 - 18, 6), { seed: 544, ic: '#F2EBDC', w: 1.8, ia: 0.9, amp: 0.9, fill: false });
  ctx.save(); ctx.font = '700 66px Caveat, cursive'; ctx.textAlign = 'center'; ctx.restore();
  P.text(ctx, 'ORRINGDALE', (sx0 + sx1) / 2, sy0 + 58, { font: '700 64px Caveat, cursive', color: '#F6EFE0', align: 'center', boil: g.boil, seed: 545, amp: 1.0, doubled: true });
  ctx.restore();
  // ---- pocket-watch clock hung from the beam end (the minute hand clicks round to 12 on the whistle)
  drawClock(g, 845, by + 52, 60, t);
}
function drawClock(g, cx, cy, r, t) {
  const { ctx } = g;
  // bracket arm
  ln(g, [[1000 - 1.8 * 130 + 4, cy - r - 24], [cx, cy - r - 24], [cx, cy - r - 8]], { c: INK, w: 3, a: 0.9, seed: 550 });
  // pocket-watch crown + ring on top
  shp(g, circ(cx, cy - r - 11, 9, 14), { seed: 551, fill: '#c9a24a', w: 2.2, amp: 0.5, off: [1, 1] });
  shp(g, P.rectPts(cx - 7, cy - r - 4, 14, 10, 3), { seed: 552, fill: '#c9a24a', w: 2, amp: 0.4, off: [1, 1] });
  // case + face
  shp(g, circ(cx, cy, r, 40), { seed: 553, fill: '#b99a4c', w: 4, amp: 0.9, off: [3, 3] });
  shp(g, circ(cx, cy, r * 0.82, 40), { seed: 554, fill: '#fbf5e6', fa: 1, comp: 'source-over', w: 2.4, amp: 0.7, off: [0, 0] });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU - Math.PI / 2, big = i % 3 === 0, r0 = r * (big ? 0.58 : 0.66), r1 = r * 0.76;
    ln(g, [[cx + Math.cos(a) * r0, cy + Math.sin(a) * r0], [cx + Math.cos(a) * r1, cy + Math.sin(a) * r1]], { c: INK, w: big ? 3.2 : 1.8, a: 0.9, seed: 560 + i, passes: 1 });
  }
  // hands: hour hand at 3, minute hand clicks 59 -> 60 on the whistle (4.75)
  const click = smooth((t - WHISTLE_T) / 0.07), minute = lerp(59, 60, click) / 60, hour = (3 + minute) / 12;
  const hand = (a, len, w, id) => ln(g, [[cx, cy], [cx + Math.cos(a - Math.PI / 2) * len, cy + Math.sin(a - Math.PI / 2) * len]], { c: INK, w, a: 0.95, seed: 580 + id, passes: 2, amp: 0.5 });
  hand(hour * TAU, r * 0.46, 4.2, 1); hand(minute * TAU, r * 0.7, 2.8, 2);
  shp(g, circ(cx, cy, 4.5, 10), { seed: 590, fill: INK, w: 1, amp: 0.3, off: [0, 0], ic: INK });
}

// ===================================================================== LOCOMOTIVE
function lensRings(g, cx, cy, r, s, hot) {
  const { ctx } = g;
  // hot glass: radial glow core (source-over so it stays bright after the grade)
  const gr = ctx.createRadialGradient(cx - r * 0.12, cy - r * 0.12, 0, cx, cy, r);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.35, '#fffdf4'); gr.addColorStop(0.72, '#ece6d4'); gr.addColorStop(1, '#bdb6a2');
  ctx.save(); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill(); ctx.restore();
  // Fresnel rings (concentric) — alternate light/dark so the lens reads as a big glass lens, not a disc
  const n = 7;
  for (let i = 1; i <= n; i++) {
    const rr = r * (i / (n + 0.6));
    P.ink(ctx, circ(cx, cy, rr, 40, i), { color: i % 2 ? INK : '#8a8474', width: Math.max(1.1, (i % 2 ? 2.8 : 1.8) * Math.pow(s, 0.5)), amp: Math.max(0.4, 0.9 * Math.pow(s, 0.4)), boil: g.boil, seed: 700 + i, alpha: i % 2 ? 0.72 : 0.6, passes: 1, step: 10 });
  }
  // hot core + lens flare glints
  const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.42);
  cg.addColorStop(0, 'rgba(255,255,255,1)'); cg.addColorStop(0.6, 'rgba(255,255,250,0.95)'); cg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.save(); ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cx, cy, r * 0.42, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.beginPath(); ctx.ellipse(cx - r * 0.42, cy - r * 0.46, r * 0.17, r * 0.08, -0.7, 0, TAU); ctx.fill();
  ctx.restore();
}

function drawLoco(g, s) {
  const { ctx } = g, M = mk(s);
  const W = (a) => M.pts(a), lw = M.lw, am = M.amp;
  const [lu, lv] = LAMP, [su, sv] = SMOKEBOX.c, SR = SMOKEBOX.R;
  const detail = s > 0.2;
  // ----- cab + boiler hump behind (rear plane scaled 0.55 toward the vanishing point)
  const q = 0.55;
  const cab = W([[-53, -132], [317, -132], [317, 343], [-53, 343]]);
  shp(g, cab, { seed: 800, fill: V.d2, hatch: V.d3, ha: 0.5, gap: Math.max(4, 7 * Math.pow(s, 0.5)), ang: 1.3, w: lw(3), amp: am(1.1), off: [3, 2] });
  // cab roof overhang + window
  shp(g, W([[-78, -150], [342, -150], [335, -128], [-70, -128]]), { seed: 801, fill: V.d1, w: lw(3), amp: am(1), off: [2, 2] });
  if (detail) {
    shp(g, W(P.rectPts(10, -88, 128, 94, 8)), { seed: 802, fill: '#f4efe2', fa: 1, comp: 'source-over', w: lw(2.6), amp: am(0.9), off: [0, 0] });
    ln(g, W([[74, -88], [74, 6]]), { c: INK, w: lw(2.2), seed: 803 }); ln(g, W([[10, -41], [138, -41]]), { c: INK, w: lw(2.2), seed: 804 });
  }
  // whistle on the cab roof (jet comes from here)
  shp(g, W([[32, -150], [48, -150], [46, -186], [34, -186]]), { seed: 805, fill: '#c9a24a', w: lw(2), amp: am(0.6), off: [1, 1] });
  shp(g, W(P.rectPts(26, -200, 28, 16, 4)), { seed: 806, fill: '#c9a24a', w: lw(2), amp: am(0.6), off: [1, 1] });
  // ----- smokebox: dark disc, door ring, straps, rivets
  const disc = W(circ(su, sv, SR, 56, 0.3));
  shp(g, disc, { seed: 810, fill: V.d2, hatch: V.d3, ha: 0.55, gap: Math.max(4, 7 * Math.pow(s, 0.5)), ang: -0.9, cross: 0, w: lw(4), amp: am(1.4), off: [4, 3], shade: (x, y) => (x - (VP[0] + su * s)) * 0.0 + 0.55 + 0.45 * smooth(((y - (VP[1] + (sv - SR) * s)) / (SR * 1.4 * s))) });
  if (detail) {
    P.ink(ctx, W(circ(su, sv, SR * 0.9, 50, 1)), { color: '#b8b2a4', width: lw(3), amp: am(1), boil: g.boil, seed: 811, alpha: 0.85, passes: 2 });
    P.ink(ctx, W(circ(su, sv, SR * 0.78, 46, 2)), { color: '#8d8878', width: lw(2), amp: am(0.9), boil: g.boil, seed: 812, alpha: 0.7, passes: 1 });
    for (let i = 0; i < 4; i++) { const a = i * (TAU / 4) + 0.785, p0 = [su + Math.cos(a) * 60, sv + Math.sin(a) * 60 + 40], p1 = [su + Math.cos(a) * SR * 0.78, sv + Math.sin(a) * SR * 0.78]; ln(g, W([p0, p1]), { c: '#b8b2a4', w: lw(4), a: 0.75, seed: 813 + i }); }
    for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU, p = W([[su + Math.cos(a) * SR * 0.9, sv + Math.sin(a) * SR * 0.9]])[0]; ctx.save(); ctx.fillStyle = 'rgba(220,214,196,0.8)'; ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(1, 5 * s), 0, TAU); ctx.fill(); ctx.restore(); }
    // door handle + number plate
    shp(g, W(circ(su, sv + 130, 26, 16)), { seed: 840, fill: '#c9a24a', w: lw(2.5), amp: am(0.6), off: [2, 2] });
    shp(g, W(P.rectPts(su - 92, sv + 172, 184, 66, 10)), { seed: 841, fill: '#e8e0cc', fa: 1, comp: 'source-over', w: lw(3), amp: am(0.8), off: [0, 0] });
    P.text(ctx, '1 8 9 5', VP[0] + su * s, VP[1] + (sv + 222) * s, { font: `700 ${Math.max(8, Math.round(54 * s))}px Caveat, cursive`, color: INK, align: 'center', boil: g.boil, seed: 842, amp: am(0.8) });
  }
  // ----- cylinders + wheels + buffer beam (lower hull)
  for (const sd of [-1, 1]) {
    const cx = sd < 0 ? -112 : 592, cyl = W(P.rectPts(cx - 52, 380, 104, 150, 30));
    shp(g, cyl, { seed: 850 + sd, fill: V.d1, hatch: V.d3, ha: 0.5, gap: Math.max(4, 6 * Math.pow(s, 0.5)), ang: 1.0, w: lw(3.2), amp: am(1), off: [3, 2] });
    shp(g, W(P.ellipsePts(cx + (sd < 0 ? -34 : 34), 470, 20, 150, 0, 24)), { seed: 856 + sd, fill: V.d3, w: lw(3), amp: am(0.8), off: [2, 2] });
  }
  shp(g, W(P.rectPts(-90, 538, 660, 62, 8)), { seed: 860, fill: V.d3, hatch: '#000', ha: 0.4, gap: 7, ang: 0.0, w: lw(3.4), amp: am(1), off: [3, 2] });
  for (const bx of [-30, 510]) { shp(g, W(circ(bx, 569, 40, 22)), { seed: 861 + (bx > 0), fill: V.m1, w: lw(3), amp: am(0.8), off: [2, 2] }); if (detail) ln(g, W([[bx - 18, 560], [bx + 6, 548]]), { c: '#fff', w: lw(2), a: 0.8, seed: 863 + (bx > 0), passes: 1 }); }
  shp(g, W([[200, 600], [280, 600], [250, 640], [230, 640]]), { seed: 865, fill: V.d1, w: lw(2.4), amp: am(0.6), off: [1, 1] });
  // ----- chimney (balloon stack) — behind the lamp
  const stack = W([[170, 0], [310, 0], [296, -96], [348, -168], [352, -200], [128, -200], [132, -168], [184, -96]]);
  shp(g, stack, { seed: 870, fill: V.d3, hatch: '#000', ha: 0.45, gap: Math.max(4, 6 * Math.pow(s, 0.5)), ang: 1.35, w: lw(3.4), amp: am(1.1), off: [3, 2] });
  if (detail) { ln(g, W([[130, -176], [350, -176]]), { c: '#9c9686', w: lw(2.6), a: 0.8, seed: 871 }); ln(g, W([[150, -190], [330, -190]]), { c: '#9c9686', w: lw(1.8), a: 0.6, seed: 872, passes: 1 }); }
  // ----- lamp housing (brass) + the LENS
  const hr = 140;
  shp(g, W(circ(lu, lv, hr, 44, 0.4)), { seed: 880, fill: '#bfa357', hatch: '#6b5a2a', ha: 0.5, gap: Math.max(4, 7 * Math.pow(s, 0.5)), ang: -0.6, w: lw(4.2), amp: am(1.3), off: [4, 3] });
  shp(g, W([[lu - 52, lv - hr + 6], [lu + 52, lv - hr + 6], [lu + 36, lv - hr - 30], [lu - 36, lv - hr - 30]]), { seed: 881, fill: V.d2, w: lw(3), amp: am(0.9), off: [2, 2] });
  shp(g, W(P.rectPts(lu - 66, lv + hr - 8, 132, 26, 6)), { seed: 882, fill: V.d2, w: lw(3), amp: am(0.9), off: [2, 2] });
  const lp = M.p(lu, lv), lr = PORTAL.r * s;
  P.ink(ctx, circ(lp[0], lp[1], lr * 1.1, 40, 0.2), { color: INK, width: lw(5), amp: am(1.2), boil: g.boil, seed: 883, alpha: 0.95, passes: 2 });
  lensRings(g, lp[0], lp[1], lr, s);
  P.ink(ctx, circ(lp[0], lp[1], lr, 48, 0.5), { color: INK, width: lw(5.5), amp: am(0.9), boil: g.boil, seed: 884, alpha: 1, passes: 2 });
}

// ================================================================== STEAM
// a billowing hatched cloud made of overlapping bubbles, painted back-to-front so only the bumpy silhouette + partial inner arcs remain
function cloud(g, cx, cy, R, age, seed, alpha) {
  const { ctx } = g, n = 7;
  for (let i = 0; i < n; i++) {
    const a = hash(i, seed, 1) * TAU, d = R * (0.1 + 0.62 * hash(i, seed, 2)) * (0.45 + 0.55 * Math.min(1, age * 2.2)), r = R * (0.42 + 0.36 * hash(i, seed, 3)) * (0.7 + 0.3 * Math.min(1, age * 3));
    const x = cx + Math.cos(a) * d * 1.1, y = cy + Math.sin(a) * d * 0.78 - (i / n) * R * 0.1;
    const pts = circ(x, y, r, 22, a);
    const lw = Math.max(1.3, Math.min(2.6, R * 0.03));
    P.fill(ctx, pts, { color: '#fbf8f0', offset: [0, 0], amp: 0.5, boil: g.boil, seed: seed * 7 + i, alpha: alpha, comp: 'source-over' });
    if (r > 18) P.hatch(ctx, pts, { color: '#6f6b78', gap: Math.max(5, r * 0.2), width: 1.1, alpha: 0.32 * alpha, angle: -0.8, boil: g.boil, seed: seed * 11 + i, shade: (px, py) => smooth(((px - x) * 0.6 + (py - y) * 0.9) / (r * 1.1) + 0.45), jitter: 0.8, margin: 0.2, segLen: 26 });
    P.ink(ctx, pts, { color: INK, width: lw, amp: Math.max(0.7, r * 0.03), boil: g.boil, seed: seed * 13 + i, alpha: 0.82 * alpha, passes: 1, step: 8 });
  }
}
function drawPuffs(g, t) {
  // one cloud per chuff, rising + drifting + growing from the stack mouth (at the loco scale of its emission time)
  for (let k = 0; k < CHUFF.length; k++) {
    const te = CHUFF[k], age = t - te; if (age < 0 || age > 2.4) continue;
    const se = locoScale(te), mouth = [VP[0] + 240 * se, VP[1] - 205 * se];
    const grow = 1 - Math.exp(-age / 0.42), R = (26 + 120 * se) * (0.35 + 1.5 * grow), rise = (46 + 200 * se) * Math.pow(age, 0.82), drift = -(14 + 60 * se) * age;
    const cx = mouth[0] + drift + noise1(age * 1.5, k) * 6, cy = mouth[1] - rise;
    const alpha = clamp((2.4 - age) / 0.9, 0, 1);
    cloud(g, cx, cy, R, age, 31 + k * 5, alpha);
    // second smaller puff trailing the first (the chuff is a double beat)
    if (age > 0.12) cloud(g, cx + R * 0.7, cy + R * 0.55, R * 0.58, age - 0.1, 77 + k * 5, alpha * 0.9);
  }
}
function drawWhistle(g, t, s) {
  const age = t - WHISTLE_T; if (age < 0 || age > 0.95) return;
  const { ctx } = g, sw = locoScale(t), base = [VP[0] + 40 * sw, VP[1] - 205 * sw];
  const L = (60 + 300 * sw) * outCubic(clamp(age / 0.22)) * (1 - 0.15 * smooth((age - 0.6) / 0.35)), fade = clamp((0.95 - age) / 0.4, 0, 1), w0 = 6 + 10 * sw;
  ctx.save();
  // tapered fan of curved hatched strokes = the jet
  for (let i = 0; i < 9; i++) {
    const sp = (i / 8 - 0.5), bend = noise1(i * 1.7 + age * 4, 5) * 6;
    const pts = []; for (let k = 0; k <= 10; k++) { const u = k / 10; pts.push([base[0] + sp * (w0 + u * u * 60 * (0.4 + sw)) + bend * u, base[1] - u * L]); }
    P.ink(ctx, pts, { closed: false, color: INK, width: 1.8, amp: 0.8, boil: g.boil, seed: 900 + i, alpha: 0.7 * fade * (1 - Math.abs(sp) * 0.7), passes: 1, taper: true, step: 8 });
  }
  cloud(g, base[0] + noise1(age * 2, 4) * 4, base[1] - L, 26 + 60 * sw, age, 950, fade);
  ctx.restore();
  // hand-lettered TOOOT!
  if (age < 0.8) {
    const k = outBack(clamp(age / 0.18), 2);
    ctx.save(); ctx.translate(base[0] + 74 + 60 * sw, base[1] - L * 0.55); ctx.rotate(-0.12); ctx.scale(k, k);
    P.text(ctx, 'TOOOOT!', 0, 0, { font: '700 58px Caveat, cursive', color: INK, boil: g.boil, seed: 960, amp: 1.6, alpha: clamp((0.8 - age) / 0.25, 0, 1), stroke: 7, strokeColor: '#F2EBDC' });
    ctx.restore();
  }
}
function cylinderSteam(g, t) {
  const { ctx } = g;
  for (let k = 0; k < CHUFF.length; k++) {
    const age = t - CHUFF[k]; if (age < 0 || age > 0.42) continue;
    const se = locoScale(t), M = mk(se); if (se < 0.22) continue;
    for (const sd of [-1, 1]) {
      const o = M.p(sd < 0 ? -112 : 592, 520), a = outCubic(clamp(age / 0.42)), R = (40 + 70 * a) * se * 1.3 + 8;
      cloud(g, o[0] + sd * (30 + 150 * a) * se, o[1] + 18 * se * a, R, age, 1000 + k * 3 + (sd > 0 ? 1 : 0), clamp((0.42 - age) / 0.25, 0, 1) * 0.95);
    }
  }
}
function speedLines(g, t, s) {
  // hand-drawn zoom streaks radiating from the vanishing point, only outside the lens circle's radius band (never over the portal)
  const k = smooth((t - 4.7) / 0.6) * (1 - smooth((t - 5.55) / 0.3)); if (k <= 0.01) return;
  const { ctx } = g;
  for (let i = 0; i < 22; i++) {
    const a = hash(i, 71) * TAU, r0 = 470 + 260 * hash(i, 72), r1 = r0 + 130 + 220 * hash(i, 73);
    const dx = Math.cos(a), dy = Math.sin(a), x0 = VP[0] + dx * r0, y0 = VP[1] + dy * r0 * 0.78, x1 = VP[0] + dx * r1, y1 = VP[1] + dy * r1 * 0.78;
    if (y0 > 930 && y1 > 930) continue;
    ln(g, [[x0, y0], [x1, y1]], { c: INKL, w: 1.6 + 1.6 * hash(i, 74), a: 0.5 * k, seed: 1100 + i, passes: 1, taper: true });
  }
}

// ================================================================== FRAME (iris + rounded corners)
function drawIris(g, T) {
  const { ctx } = g, lt = T.t - 4.0, F = T.frame; if (lt >= 0.62) return;
  const cx = F.x + F.w / 2, cy = F.y + F.h / 2, u = clamp(lt / 0.45);
  const e = 1 - Math.pow(1 - u, 2.4), r = 14 + (1180 - 14) * e;
  // black everywhere outside a hand-drawn, wobbly circle
  const edge = P.wobble(circ(cx, cy, r, 72), { boil: T.boil, amp: Math.min(7, 2 + r * 0.02), seed: 4, scale: 0.35, closed: true });
  ctx.save(); ctx.fillStyle = BAR; ctx.beginPath(); ctx.rect(-20, -20, 1960, 1120); edge.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill('evenodd'); ctx.restore();
  // charcoal feather inside the edge (soft pencil-smudged iris) + a white-hot rim at the start (the cold open's light going through the gate)
  ctx.save(); ctx.lineJoin = 'round';
  for (const [w, a, off] of [[46, 0.22, 24], [26, 0.3, 13], [12, 0.38, 6]]) { ctx.strokeStyle = `rgba(11,10,13,${a})`; ctx.lineWidth = w; ctx.beginPath(); P.wobble(circ(cx, cy, Math.max(2, r - off), 72), { boil: T.boil, amp: 3, seed: 5, scale: 0.4, closed: true }).forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.stroke(); }
  const rim = 1 - smooth((lt - 0.02) / 0.3);
  if (rim > 0.01) {
    ctx.globalCompositeOperation = 'lighter';
    for (const [w, a] of [[34, 0.35], [16, 0.55], [6, 0.95]]) { ctx.strokeStyle = `rgba(255,243,214,${a * rim})`; ctx.lineWidth = w; ctx.beginPath(); P.wobble(circ(cx, cy, r + 2, 72), { boil: T.boil, amp: 2, seed: 6, scale: 0.4, closed: true }).forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.stroke(); }
  }
  ctx.restore();
}
function drawFrameCorners(g, T) {
  // 1895 gate: the picture area has softly rounded corners
  const { ctx } = g, F = T.frame, R = 44;
  ctx.save(); ctx.fillStyle = BAR;
  for (const [x, y, sx, sy] of [[F.x, F.y, 1, 1], [F.x + F.w, F.y, -1, 1], [F.x, F.y + F.h, 1, -1], [F.x + F.w, F.y + F.h, -1, -1]]) {
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + sx * R, y); ctx.arc(x + sx * R, y + sy * R, R, sy > 0 ? -Math.PI / 2 : Math.PI / 2, sx > 0 ? Math.PI : 0, sx * sy > 0); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

// ================================================================= SCENE
export default {
  id: 'e1895', kind: '2d',
  draw(ctx, T, S) {
    const t = T.t, s = locoScale(t), g = { ctx, T, S, boil: T.boil, t };
    P.paper(ctx, S, { seed: 9 });
    skyAndSkyline(g);
    walls(g);
    canopy(g);
    platformAndTrack(g);
    columnsAndFurniture(g, t);
    speedLines(g, t, s);
    drawPuffs(g, t);
    drawLoco(g, s);
    drawWhistle(g, t, s);
    cylinderSteam(g, t);
    drawFrameCorners(g, T);
    drawIris(g, T);
  },
};
