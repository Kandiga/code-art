// =============================================================================
// e1927 — THE FIRST WORDS (8.0–10.0, 1.37, B&W talkie, prop: megaphone, portal SCREEN @ (960,520) half-width 230)
//  8.0  an ornate art-deco INTERTITLE CARD ("THEN CAME A VOICE", own letterforms) slams in (card_thunk) with a tiny bounce,
//       card-flicker scratches, sound-wave arcs pulse out of the word VOICE.
//  8.5  the card IRISES away (iris_click) -> Amrita, nervous, in tight close-up before a big old condenser microphone;
//       sweat, tremor, eyes darting, a gulp, an inhale.
//  9.0  "Hello!" - a comic speech balloon pops (action lines, squash, happy eyes, the mic shivers); grade warms by a hair.
//  9.12-9.42 the camera PULLS BACK (parallax: hall / stage / audience move differently): the grey backdrop was a huge CINEMA
//       SCREEN; the projector strikes, the beam rises from the audience, the screen blazes white at (960,520) 460x259 = the dive portal.
// Pure function of time. All world drawing is in the final wide-shot coordinates; the close-up is a camera on top of it.
// =============================================================================
import { hash, noise1 } from '../rng.js';
import { clamp, lerp, smooth, outCubic, outBack, inOutCubic } from '../ease.js';
import { path, cached, blit, hatchBox, bbox, solid, drape, INK, GOLD, GOLD_D, VEL, VEL_L, VEL_D } from './e1902.js';

const TAU = Math.PI * 2;
const SCR = { cx: 960, cy: 520, hw: 230 }; SCR.hh = (SCR.hw * 9) / 16; SCR.x0 = SCR.cx - SCR.hw; SCR.y0 = SCR.cy - SCR.hh; SCR.w = SCR.hw * 2; SCR.h = SCR.hh * 2; SCR.rad = SCR.hw * 0.08;
const AW = { x: 500, y: 790 }, RW = 126; // Amrita in the wide shot (world units)
const MIC = { x: 696, baseY: 918, headY: 776 };
const CU = { k: [738, 594], s1: 1.73, s0: 3.3 }; // close-up camera: Amrita screen position, foreground scale, hall scale
const FLOOR = { yb: 700, yf: 932 };
const PB0 = 9.12, PB1 = 9.42; // pull-back window (portal must be exact from 9.4)
const CREAM = '#F6EEDA', CARD = '#14121a';

// ---------- camera ------------------------------------------------------------------------------------------------------
function cam(t) {
  const p = inOutCubic(clamp((t - PB0) / (PB1 - PB0)));
  return { p, s0: Math.exp(lerp(Math.log(CU.s0), 0, p)), s1: lerp(CU.s1, 1, p), k1: [lerp(CU.k[0], AW.x, p), lerp(CU.k[1], AW.y, p)] };
}
const L0 = (c) => (x, y) => [SCR.cx + c.s0 * (x - SCR.cx), SCR.cy + c.s0 * (y - SCR.cy)];
const L1 = (c) => (x, y) => [c.k1[0] + c.s1 * (x - AW.x), c.k1[1] + c.s1 * (y - AW.y)];
function layer(ctx, kind, c, fn) {
  ctx.save();
  if (kind === 0) { ctx.translate(SCR.cx, SCR.cy); ctx.scale(c.s0, c.s0); ctx.translate(-SCR.cx, -SCR.cy); }
  else if (kind === 1) { ctx.translate(c.k1[0], c.k1[1]); ctx.scale(c.s1, c.s1); ctx.translate(-AW.x, -AW.y); }
  else ctx.translate(0, (1 - c.p) * 230);
  fn();
  ctx.restore();
}
const visL0 = (c, x0, y0, x1, y1) => { const a = L0(c)(x0, y0), b = L0(c)(x1, y1); return b[0] > 150 && a[0] < 1770 && b[1] > -20 && a[1] < 1100; };

// ---------- art-deco letterforms (cap height 100, baseline y=100) ---------------------------------------------------
const R = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const ell = (cx, cy, rx, ry, a0 = 0, a1 = TAU, n = 30) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * (i / n); return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]; });
// each glyph: {w, parts:[[pts, 'ink'|'bg']]}
const GLYPH = {
  T: { w: 92, parts: [[R(0, 0, 92, 11), 'i'], [R(0, 0, 11, 28), 'i'], [R(81, 0, 11, 28), 'i'], [R(32, 0, 28, 100), 'i'], [R(14, 90, 64, 10), 'i']] },
  H: { w: 112, parts: [[R(8, 0, 28, 100), 'i'], [R(76, 0, 28, 100), 'i'], [R(36, 44, 40, 10), 'i'], [R(0, 0, 46, 9), 'i'], [R(66, 0, 46, 9), 'i'], [R(0, 91, 46, 9), 'i'], [R(66, 91, 46, 9), 'i']] },
  E: { w: 78, parts: [[R(0, 0, 28, 100), 'i'], [R(0, 0, 78, 11), 'i'], [R(0, 44, 56, 10), 'i'], [R(0, 89, 78, 11), 'i'], [R(68, 0, 10, 30), 'i'], [R(68, 70, 10, 30), 'i'], [R(48, 36, 10, 26), 'i']] },
  N: { w: 104, parts: [[R(0, 0, 26, 100), 'i'], [R(78, 0, 26, 100), 'i'], [[[0, 0], [30, 0], [104, 100], [74, 100]], 'i'], [R(-8, 0, 42, 9), 'i'], [R(-8, 91, 42, 9), 'i'], [R(70, 91, 42, 9), 'i'], [R(70, 0, 42, 9), 'i']] },
  A: { w: 116, parts: [[[[44, 0], [72, 0], [116, 100], [86, 100]], 'i'], [[[44, 0], [58, 0], [20, 100], [4, 100]], 'i'], [R(30, 64, 50, 9), 'i'], [R(-4, 91, 36, 9), 'i'], [R(78, 91, 44, 9), 'i'], [R(36, 0, 28, 9), 'i']] },
  M: { w: 138, parts: [[R(0, 0, 24, 100), 'i'], [R(114, 0, 24, 100), 'i'], [[[0, 0], [30, 0], [78, 100], [54, 100]], 'i'], [[[138, 0], [124, 0], [74, 100], [62, 100]], 'i'], [R(-8, 0, 40, 9), 'i'], [R(-8, 91, 40, 9), 'i'], [R(106, 91, 40, 9), 'i'], [R(108, 0, 38, 9), 'i']] },
  V: { w: 112, parts: [[[[0, 0], [32, 0], [70, 100], [48, 100]], 'i'], [[[112, 0], [96, 0], [62, 100], [52, 100]], 'i'], [R(-8, 0, 48, 9), 'i'], [R(86, 0, 34, 9), 'i'], [R(44, 90, 24, 10), 'i']] },
  O: { w: 112, parts: [[ell(56, 50, 56, 50, 0, TAU, 40), 'i'], [ell(56, 50, 27, 37, 0, TAU, 40), 'b']] },
  C: { w: 108, parts: [[ell(54, 50, 54, 50, 0, TAU, 40), 'i'], [ell(54, 50, 27, 37, 0, TAU, 40), 'b'], [R(78, 24, 40, 52), 'b'], [R(76, 2, 12, 22), 'i'], [R(76, 76, 12, 22), 'i']] },
  I: { w: 64, parts: [[R(18, 0, 28, 100), 'i'], [R(0, 0, 64, 11), 'i'], [R(0, 89, 64, 11), 'i']] },
  ' ': { w: 56, parts: [] },
};
function textWidth(str, k, sp) { let w = 0; for (const ch of str) w += (GLYPH[ch] ? GLYPH[ch].w : 60) * k + sp; return w - sp; }
// draw hand-cut lettering; (x,y) = left / TOP of the line. wobble boils with B.
function letters(ctx, P, str, x, y, k, sp, { B, seed, color = CREAM, shadow = null, sh = [7, 7], hatchC = null } = {}) {
  let cx = x, idx = 0;
  for (const ch of str) {
    const g = GLYPH[ch]; if (!g) { cx += 60 * k + sp; continue; }
    const place = (pts) => pts.map(([px, py]) => [cx + px * k, y + py * k]);
    for (let pass = 0; pass < (shadow ? 2 : 1); pass++) {
      g.parts.forEach(([pts, kind], j) => {
        if (pass === 0 && shadow) { if (kind !== 'i') return; P.fill(ctx, place(pts).map(([a, b]) => [a + sh[0], b + sh[1]]), { color: shadow, comp: 'source-over', offset: [0, 0], boil: B, seed: seed + idx * 7 + j, amp: 0.9 }); return; }
        P.fill(ctx, place(pts), { color: kind === 'i' ? color : CARD, comp: 'source-over', offset: [kind === 'i' ? 2 : 0, kind === 'i' ? 1.5 : 0], boil: B, seed: seed + idx * 7 + j + 50, amp: kind === 'i' ? 0.9 : 0.5 });
      });
    }
    cx += g.w * k + sp; idx++;
  }
}

// ---------- the intertitle card ------------------------------------------------------------------------------------------
function cardRect(F) { return { x0: F.x + 30, x1: F.x + F.w - 30, y0: 178, y1: 934 }; }
function chamfer(x0, y0, x1, y1, c) { return [[x0 + c, y0], [x1 - c, y0], [x1, y0 + c], [x1, y1 - c], [x1 - c, y1], [x0 + c, y1], [x0, y1 - c], [x0, y0 + c]]; }
function drawCardBase(gx, S, B, F) {
  const P = S.pencil, C = cardRect(F), cx = (C.x0 + C.x1) / 2;
  P.paper(gx, S, { seed: 31 });
  // card plate (cut card, slightly off-register shadow on the paper)
  P.fill(gx, P.rectPts(C.x0 + 10, C.y0 + 12, C.x1 - C.x0, C.y1 - C.y0, 10), { color: '#3b362e', comp: 'multiply', offset: [0, 0], alpha: 0.5, boil: B, seed: 301, amp: 0.8 });
  P.fill(gx, P.rectPts(C.x0, C.y0, C.x1 - C.x0, C.y1 - C.y0, 10), { color: CARD, comp: 'source-over', offset: [0, 0], boil: B, seed: 302, amp: 1.0 });
  P.ink(gx, P.rectPts(C.x0, C.y0, C.x1 - C.x0, C.y1 - C.y0, 10), { color: '#0a090c', width: 4, boil: B, seed: 303, amp: 1.3 });
  // faint pencil grain on the black card
  gx.save(); gx.beginPath(); gx.roundRect(C.x0, C.y0, C.x1 - C.x0, C.y1 - C.y0, 10); gx.clip();
  hatchBox(gx, { x: C.x0, y: C.y0, w: C.x1 - C.x0, h: C.y1 - C.y0 }, { color: '#f0e8d4', gap: 9, width: 1, alpha: 0.05, angle: -0.6, seed: 305, boil: B, comp: 'source-over', dash: 120, keep: 0.7 });
  gx.restore();
  // double deco frame with stepped corners
  const f1 = chamfer(C.x0 + 22, C.y0 + 22, C.x1 - 22, C.y1 - 22, 44), f2 = chamfer(C.x0 + 40, C.y0 + 40, C.x1 - 40, C.y1 - 40, 30);
  P.ink(gx, f1, { color: CREAM, width: 6.5, boil: B, seed: 310, amp: 1.3, alpha: 0.95 });
  P.ink(gx, f2, { color: CREAM, width: 2.4, boil: B, seed: 311, amp: 1.2, alpha: 0.9 });
  // corner fans (3 rays + quarter ring) and small squares
  [[C.x0 + 22, C.y0 + 22, 1, 1], [C.x1 - 22, C.y0 + 22, -1, 1], [C.x0 + 22, C.y1 - 22, 1, -1], [C.x1 - 22, C.y1 - 22, -1, -1]].forEach(([x, y, sx, sy], i) => {
    for (let r = 0; r < 5; r++) { const a = (r / 4) * (Math.PI / 2); P.ink(gx, [[x + sx * 30 * Math.cos(a) + sx * 12, y + sy * 30 * Math.sin(a) + sy * 12], [x + sx * 92 * Math.cos(a) + sx * 12, y + sy * 92 * Math.sin(a) + sy * 12]], { closed: false, color: CREAM, width: 2.2, boil: B, seed: 320 + i * 7 + r, amp: 0.7, passes: 1, alpha: 0.9 }); }
    P.ink(gx, ell(x + sx * 12, y + sy * 12, 98, 98, sx > 0 ? (sy > 0 ? 0 : -Math.PI / 2) : (sy > 0 ? Math.PI / 2 : Math.PI), (sx > 0 ? (sy > 0 ? Math.PI / 2 : 0) : (sy > 0 ? Math.PI : Math.PI * 1.5)), 14), { closed: false, color: CREAM, width: 2.2, boil: B, seed: 360 + i, amp: 0.8, passes: 1, alpha: 0.9 });
  });
  // mid-edge lozenges
  [[cx, C.y0 + 22], [cx, C.y1 - 22]].forEach(([x, y], i) => {
    P.fill(gx, [[x - 46, y], [x, y - 14], [x + 46, y], [x, y + 14]], { color: CREAM, comp: 'source-over', offset: [0, 0], boil: B, seed: 370 + i, amp: 0.6 });
    P.fill(gx, [[x - 10, y], [x, y - 5], [x + 10, y], [x, y + 5]], { color: CARD, comp: 'source-over', offset: [0, 0], boil: B, seed: 372 + i, amp: 0.3 });
  });
  // lettering: small line + the big word
  const l1 = 'THEN CAME A', k1 = 0.84, sp1 = 20, w1 = textWidth(l1, k1, sp1);
  letters(gx, P, l1, cx - w1 / 2, 262, k1, sp1, { B, seed: 400, shadow: '#5a5560', sh: [4, 4] });
  const l2 = 'VOICE', k2 = 2.34, sp2 = 20, w2 = textWidth(l2, k2, sp2);
  letters(gx, P, l2, cx - w2 / 2, 440, k2, sp2, { B, seed: 500, shadow: '#6b6572', sh: [9, 9] });
  // divider between the lines (rule + diamond + rule)
  const dy = 392;
  P.ink(gx, [[cx - 330, dy], [cx - 60, dy]], { closed: false, color: CREAM, width: 3, boil: B, seed: 420, amp: 1.0, passes: 1 });
  P.ink(gx, [[cx + 60, dy], [cx + 330, dy]], { closed: false, color: CREAM, width: 3, boil: B, seed: 421, amp: 1.0, passes: 1 });
  P.fill(gx, [[cx - 46, dy], [cx, dy - 8], [cx + 46, dy], [cx, dy + 8]], { color: CREAM, comp: 'source-over', offset: [0, 0], boil: B, seed: 422, amp: 0.5 });
  // base ornament: row of small fans + rule
  P.ink(gx, [[cx - 520, 800], [cx + 520, 800]], { closed: false, color: CREAM, width: 2.4, boil: B, seed: 430, amp: 1.0, passes: 1, alpha: 0.9 });
  for (let i = -4; i <= 4; i++) {
    const x = cx + i * 66, big = i === 0;
    for (let r = 0; r < 7; r++) { const a = Math.PI + (r / 6) * Math.PI; P.ink(gx, [[x + Math.cos(a) * 8, 800 + Math.sin(a) * 8], [x + Math.cos(a) * (big ? 38 : 26), 800 + Math.sin(a) * (big ? 38 : 26)]], { closed: false, color: CREAM, width: 2, boil: B, seed: 440 + (i + 5) * 9 + r, amp: 0.5, passes: 1, alpha: 0.85 }); }
  }
}
function drawCard(ctx, T, S, irisR) {
  const t = T.t, lt = T.lt, F = T.frame, B = T.boil, P = S.pencil;
  const base = cached(S, 'card' + B + '|' + Math.round(F.x), (gx) => drawCardBase(gx, S, B, F));
  // slam: arrives a touch large, hits, tiny bounce
  const e = Math.exp(-lt * 15) * Math.cos(lt * 38);
  const k = 1 + 0.06 * e, dy = -10 * e;
  ctx.save();
  if (irisR > 0) { ctx.beginPath(); ctx.rect(-50, -50, 2100, 1200); ctx.arc(960, 540, irisR, 0, TAU, true); ctx.clip('evenodd'); }
  ctx.translate(960, 560 + dy); ctx.scale(k, k); ctx.translate(-960, -560);
  blit(ctx, base);
  // the word VOICE rings: soft glow pulses on the sub-beats after the slam
  const gl = 0.2 * Math.exp(-lt / 0.1) + 0.14 * Math.exp(-Math.max(0, lt - 0.25) / 0.1) * (lt >= 0.25 ? 1 : 0) + 0.08 * Math.exp(-Math.max(0, lt - 0.375) / 0.1) * (lt >= 0.375 ? 1 : 0);
  if (gl > 0.004) { const C = cardRect(F), cxx = (C.x0 + C.x1) / 2; const gr = ctx.createRadialGradient(cxx, 560, 40, cxx, 560, 640); gr.addColorStop(0, `rgba(246,238,218,${gl})`); gr.addColorStop(1, 'rgba(246,238,218,0)'); ctx.fillStyle = gr; ctx.fillRect(C.x0, C.y0, C.x1 - C.x0, C.y1 - C.y0); }
  ctx.restore();
  // iris edge
  if (irisR > 0 && irisR < 1400) {
    ctx.save(); P.ink(ctx, ell(960, 540, irisR, irisR, 0, TAU, 72), { closed: true, color: '#0a090c', width: 14, boil: B, seed: 650, amp: 1.5, passes: 2 }); P.ink(ctx, ell(960, 540, irisR + 9, irisR + 9, 0, TAU, 72), { closed: true, color: CREAM, width: 3, boil: B, seed: 651, amp: 1.0, passes: 1, alpha: 0.9 }); ctx.restore();
  }
  // card-flicker: hairline scratches, specks, an occasional exposure blink (per 30 fps frame)
  const fr = Math.floor(T.f + 1e-6);
  ctx.save(); ctx.beginPath(); ctx.rect(F.x, 0, F.w, 1080); ctx.clip();
  if (irisR > 0) { ctx.beginPath(); ctx.rect(-50, -50, 2100, 1200); ctx.arc(960, 540, irisR, 0, TAU, true); ctx.clip('evenodd'); }
  for (let i = 0; i < 3; i++) {
    if (hash(fr, i, 90) > 0.55) continue;
    const x = F.x + 60 + hash(fr, i, 91) * (F.w - 120), y0 = hash(fr, i, 92) * 500, len = 200 + hash(fr, i, 93) * 600;
    ctx.globalAlpha = 0.55; ctx.strokeStyle = hash(fr, i, 94) < 0.6 ? '#F6EEDA' : '#0a090c'; ctx.lineWidth = 1.4 + hash(fr, i, 95) * 1.4;
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x + (hash(fr, i, 96) - 0.5) * 6, y0 + len); ctx.stroke();
  }
  for (let i = 0; i < 6; i++) { if (hash(fr, i, 97) > 0.5) continue; const x = F.x + hash(fr, i, 98) * F.w, y = 180 + hash(fr, i, 99) * 760; ctx.globalAlpha = 0.5; ctx.fillStyle = hash(fr, i, 100) < 0.5 ? '#F6EEDA' : '#0a090c'; ctx.beginPath(); ctx.arc(x, y, 1.5 + hash(fr, i, 101) * 3, 0, TAU); ctx.fill(); }
  if (hash(fr, 7, 102) < 0.16 && lt > 0.05) { ctx.globalAlpha = 0.07; ctx.fillStyle = '#fff'; ctx.fillRect(F.x, 0, F.w, 1080); }
  ctx.restore();
}

// ---------- hall, screen, stage props --------------------------------------------------------------------------------------
function edgeLeft(y) { return 716 - 92 * Math.exp(-(((y - 566) / 120) ** 2)) - 14 * Math.exp(-(((y - 360) / 50) ** 2)); }
function drawHall(g, S, B, c, culled) {
  const P = S.pencil;
  g.fillStyle = '#0f0d13'; g.fillRect(-1500, -1500, 5000, 4200);
  hatchBox(g, { x: 220, y: 0, w: 1480, h: 760 }, { color: '#e8e0cf', gap: 14, width: 1, alpha: 0.05, angle: -0.4, seed: 701, boil: B, comp: 'source-over', dash: 160, keep: 0.7 });
  // deco sunburst fanning from the top of the screen
  for (let i = -9; i <= 9; i++) {
    const a0 = -Math.PI / 2 + (i - 0.5) * 0.17, a1 = a0 + 0.17, Rr = 1100;
    if (i % 2) { g.fillStyle = 'rgba(255,246,222,0.075)'; g.beginPath(); g.moveTo(960, 320); g.lineTo(960 + Math.cos(a0) * Rr, 320 + Math.sin(a0) * Rr); g.lineTo(960 + Math.cos(a1) * Rr, 320 + Math.sin(a1) * Rr); g.closePath(); g.fill(); }
  }
  // gilded pilasters + sconces on the side walls
  [[262, 352], [1568, 1658]].forEach(([x0, x1], si) => {
    const gr = g.createLinearGradient(x0, 0, x1, 0); gr.addColorStop(0, si ? '#4e4028' : '#8a7448'); gr.addColorStop(0.5, '#a58d58'); gr.addColorStop(1, si ? '#8a7448' : '#4e4028');
    g.fillStyle = gr; g.fillRect(x0, 150, x1 - x0, 560);
    for (let f = 1; f < 5; f++) P.ink(g, [[lerp(x0, x1, f / 5), 175], [lerp(x0, x1, f / 5), 690]], { closed: false, color: '#2c2212', width: 2.2, boil: B, seed: 710 + f + si * 9, amp: 1.0, passes: 1, alpha: 0.8 });
    solid(g, P, P.rectPts(x0 - 12, 128, x1 - x0 + 24, 40, 4), { fill: '#bfa468', hatch: '#4e3c14', w: 3, boil: B, seed: 730 + si, off: [2, 2], hatchOpt: { gap: 6, width: 1, alpha: 0.4, angle: -0.7, comp: 'multiply' } });
    solid(g, P, P.rectPts(x0 - 12, 690, x1 - x0 + 24, 30, 4), { fill: '#a38a52', hatch: '#4e3c14', w: 3, boil: B, seed: 732 + si, off: [2, 2], hatchOpt: { gap: 6, width: 1, alpha: 0.4, angle: -0.7, comp: 'multiply' } });
    const lx = (x0 + x1) / 2;
    [330, 520].forEach((ly, q) => {
      const halo = g.createRadialGradient(lx, ly, 3, lx, ly, 90); halo.addColorStop(0, 'rgba(255,240,190,0.75)'); halo.addColorStop(1, 'rgba(255,220,150,0)');
      g.fillStyle = halo; g.fillRect(lx - 90, ly - 90, 180, 180);
      g.fillStyle = '#FFF6D8'; g.beginPath(); g.ellipse(lx, ly, 13, 20, 0, 0, TAU); g.fill();
      P.ink(g, ell(lx, ly, 13, 20, 0, TAU, 16), { color: INK, width: 2.2, boil: B, seed: 740 + si * 3 + q, amp: 0.5, passes: 1 });
    });
  });
  // velvet curtains framing the screen + pelmet with fringe and marquee bar
  [-1, 1].forEach((side) => {
    drape(g, P, { xo: side < 0 ? 462 : 1458, edge: (y) => (side < 0 ? edgeLeft(y) : 1920 - edgeLeft(y)), y0: 392, y1: FLOOR.yb, folds: 7, seed: side < 0 ? 760 : 780, boil: B, lightBias: side < 0 ? 0 : 1 });
    const ex = side < 0 ? edgeLeft(566) : 1920 - edgeLeft(566), cx0 = side < 0 ? 462 : 1458;
    P.ink(g, [[cx0, 560], [lerp(cx0, ex, 0.5), 586], [ex, 574]], { closed: false, color: GOLD_D, width: 11, boil: B, seed: 790 + side, amp: 0.6, passes: 1 });
    P.ink(g, [[cx0, 560], [lerp(cx0, ex, 0.5), 586], [ex, 574]], { closed: false, color: GOLD, width: 7, boil: B, seed: 792 + side, amp: 0.6, passes: 1 });
    const tx = lerp(cx0, ex, 0.6), ty = 590;
    solid(g, P, [[tx - 5, ty], [tx + 5, ty], [tx + 16, ty + 40], [tx, ty + 50], [tx - 16, ty + 40]], { fill: GOLD, hatch: GOLD_D, w: 2.4, boil: B, seed: 794 + side, off: [2, 1], hatchOpt: { gap: 5, width: 1, alpha: 0.5, angle: 1.2, comp: 'multiply' } });
  });
  for (let k = 0; k < 4; k++) {
    const xa = 470 + k * 245, xb = xa + 245, bottom = [];
    for (let i = 0; i <= 16; i++) { const u = i / 16; bottom.push([lerp(xa, xb, u), 340 + 58 * Math.pow(Math.sin(u * Math.PI), 0.8)]); }
    const poly = [[xa, 338], [xb, 338], ...bottom.slice().reverse()];
    g.save(); path(g, poly); const gr = g.createLinearGradient(0, 338, 0, 400); gr.addColorStop(0, VEL_D); gr.addColorStop(0.5, k % 2 ? VEL : VEL_L); gr.addColorStop(1, VEL_D); g.fillStyle = gr; g.fill(); g.clip();
    for (let f = 1; f < 8; f++) { const u = f / 8, bi = Math.round(clamp(u + (u < 0.5 ? 0.07 : -0.07)) * 16); P.ink(g, [[lerp(xa, xb, u), 340], bottom[bi]], { closed: false, color: '#240510', width: 2, boil: B, seed: 800 + k * 11 + f, amp: 0.8, passes: 1, alpha: 0.65 }); }
    hatchBox(g, bbox(poly), { color: '#240510', gap: 7, width: 1.1, alpha: 0.3, angle: 1.1, seed: 820 + k, boil: B, comp: 'multiply', dash: 90 });
    g.restore();
    P.ink(g, bottom, { closed: false, color: INK, width: 3, boil: B, seed: 830 + k, amp: 1.0 });
    g.save(); g.strokeStyle = GOLD; g.lineWidth = 2.6; g.lineCap = 'round';
    for (let i = 0; i <= 34; i++) { const u = i / 34, x = lerp(xa, xb, u), y = 340 + 58 * Math.pow(Math.sin(u * Math.PI), 0.8) + 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (hash(i, k) - 0.5) * 2, y + 10); g.stroke(); }
    g.restore();
  }
  solid(g, P, P.rectPts(462, 322, 996, 22, 4), { fill: '#C9A453', hatch: GOLD_D, w: 3, boil: B, seed: 850, off: [2, 2], hatchOpt: { gap: 6, width: 1, alpha: 0.4, angle: -0.7, comp: 'multiply' } });
  // marquee lamp sockets (the lit bulbs are animated separately)
  for (let i = 0; i < 29; i++) { const x = 482 + i * 34.5; solid(g, P, ell(x, 333, 7, 7, 0, TAU, 10), { fill: '#6a5528', w: 1.6, boil: B, seed: 860 + i, off: [0, 0], amp: 0.4 }); }
}
function drawBulbs(ctx, T) {
  const k = Math.floor(T.t * 8 + 1e-6);
  for (let i = 0; i < 29; i++) {
    const on = (i + k) % 3 !== 0, x = 482 + i * 34.5;
    if (!on) continue;
    const halo = ctx.createRadialGradient(x, 333, 1, x, 333, 26); halo.addColorStop(0, 'rgba(255,244,200,0.9)'); halo.addColorStop(1, 'rgba(255,230,160,0)');
    ctx.fillStyle = halo; ctx.fillRect(x - 26, 307, 52, 52);
    ctx.fillStyle = '#FFFBEA'; ctx.beginPath(); ctx.arc(x, 333, 6.2, 0, TAU); ctx.fill();
  }
}
function drawScreen(ctx, S, T, bright) {
  const P = S.pencil, B = T.boil, fr = Math.floor(T.f + 1e-6);
  // black masking border + silver edge, then the picture surface
  ctx.save();
  ctx.fillStyle = '#08070a'; ctx.beginPath(); ctx.roundRect(SCR.x0 - 16, SCR.y0 - 16, SCR.w + 32, SCR.h + 32, SCR.rad + 8); ctx.fill();
  P.ink(ctx, P.rectPts(SCR.x0 - 16, SCR.y0 - 16, SCR.w + 32, SCR.h + 32, SCR.rad + 8), { color: '#8e8a82', width: 3, boil: B, seed: 870, amp: 0.8, passes: 1 });
  const dim = 0.60, lvl = lerp(dim, 1, bright), fl = 1 - 0.035 * hash(fr, 5, 3) * bright;
  const v = Math.round(255 * lvl * fl);
  const gr = ctx.createRadialGradient(SCR.cx, SCR.cy, 20, SCR.cx, SCR.cy, SCR.hw * 1.15);
  gr.addColorStop(0, `rgb(${v},${v - 2},${Math.round(v * 0.96)})`); gr.addColorStop(1, `rgb(${Math.round(v * 0.86)},${Math.round(v * 0.85)},${Math.round(v * 0.82)})`);
  ctx.fillStyle = gr; ctx.beginPath(); ctx.roundRect(SCR.x0, SCR.y0, SCR.w, SCR.h, SCR.rad); ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.roundRect(SCR.x0, SCR.y0, SCR.w, SCR.h, SCR.rad); ctx.clip();
  hatchBox(ctx, { x: SCR.x0, y: SCR.y0, w: SCR.w, h: SCR.h }, { color: '#6b675e', gap: 9, width: 1.0, alpha: 0.07 * (1 - bright) + 0.03, angle: Math.PI / 2 - 0.05, seed: 880, boil: B, comp: 'multiply', dash: 140, keep: 0.8 });
  hatchBox(ctx, { x: SCR.x0, y: SCR.y0, w: SCR.w, h: SCR.h }, { color: '#ffffff', gap: 16, width: 1.2, alpha: 0.18, angle: Math.PI / 2 + 0.03, seed: 881, boil: B, comp: 'source-over', dash: 100, keep: 0.5 });
  ctx.restore();
  ctx.restore();
}
function drawBeam(ctx, T, bright) {
  if (bright <= 0.005) return;
  const fr = Math.floor(T.f + 1e-6), fl = 0.9 + 0.1 * hash(fr, 3, 7);
  const ax = 960, ay = 1018, x0 = SCR.x0 + 8, x1 = SCR.x1 ?? SCR.x0 + SCR.w - 8, y = SCR.y0 + SCR.h + 2;
  const gr = ctx.createLinearGradient(0, ay, 0, y);
  gr.addColorStop(0, `rgba(255,248,226,${0.05 * bright * fl})`); gr.addColorStop(0.55, `rgba(255,248,226,${0.26 * bright * fl})`); gr.addColorStop(1, `rgba(255,252,240,${0.55 * bright * fl})`);
  ctx.save(); ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(ax - 14, ay); ctx.lineTo(ax + 14, ay); ctx.lineTo(x1, y); ctx.lineTo(x0, y); ctx.closePath(); ctx.fill();
  // edge streaks + drifting dust in the beam
  ctx.strokeStyle = `rgba(255,252,240,${0.5 * bright * fl})`; ctx.lineWidth = 2;
  [[ax - 14, ay, x0, y], [ax + 14, ay, x1, y]].forEach(([a, b, c, d]) => { ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke(); });
  for (let i = 0; i < 34; i++) {
    const u = (hash(i, 1) + T.t * (0.05 + 0.06 * hash(i, 2))) % 1, yy = lerp(ay - 40, y + 20, 1 - u), half = lerp(16, (x1 - x0) / 2 - 6, clamp((ay - yy) / (ay - y)));
    const xx = ax + (hash(i, 3) * 2 - 1) * half * 0.92 + Math.sin(T.t * 2 + i) * 4;
    ctx.fillStyle = `rgba(255,255,248,${0.55 * bright * (0.5 + 0.5 * Math.sin(T.t * 5 + i * 2))})`; ctx.beginPath(); ctx.arc(xx, yy, 1.4 + 1.6 * hash(i, 4), 0, TAU); ctx.fill();
  }
  ctx.restore();
}

function drawFloor(g, S, B, bright) {
  const P = S.pencil, yb = FLOOR.yb, yf = FLOOR.yf;
  const poly = [[300, yb], [1620, yb], [1900, yf + 40], [20, yf + 40]];
  g.save(); path(g, poly); g.clip();
  g.fillStyle = '#6a5d4e'; g.fillRect(0, yb, 1920, 400);
  const fg = g.createLinearGradient(0, yb, 0, yf); fg.addColorStop(0, 'rgba(10,8,6,0.5)'); fg.addColorStop(0.35, 'rgba(10,8,6,0.0)'); fg.addColorStop(1, 'rgba(10,8,6,0.22)');
  g.fillStyle = fg; g.fillRect(0, yb, 1920, 400);
  // light pool of the beam on the boards
  const pool = g.createRadialGradient(960, 800, 20, 960, 800, 300); pool.addColorStop(0, `rgba(255,248,226,${0.36 * bright + 0.1})`); pool.addColorStop(1, 'rgba(255,248,226,0)');
  g.fillStyle = pool; g.beginPath(); g.ellipse(960, 800, 330, 120, 0, 0, TAU); g.fill();
  hatchBox(g, { x: 0, y: yb, w: 1920, h: 260 }, { color: '#1a130c', gap: 8, width: 1.3, alpha: 0.45, angle: 0.02, seed: 900, boil: B, comp: 'multiply', dash: 170, keep: 0.8 });
  for (let i = -12; i <= 12; i++) P.ink(g, [[960 + i * 52, yb], [960 + i * 150, yf + 44]], { closed: false, color: '#150f08', width: 2.2, boil: B, seed: 910 + i + 12, amp: 1.0, alpha: 0.65, passes: 1 });
  g.restore();
  P.ink(g, [[300, yb], [1620, yb]], { closed: false, color: INK, width: 3.4, boil: B, seed: 905, amp: 1.2 });
  // apron lip
  g.fillStyle = '#17120e'; g.fillRect(0, yf + 2, 1920, 80);
  P.ink(g, [[0, yf + 2], [1920, yf + 2]], { closed: false, color: '#c9ab5c', width: 5, boil: B, seed: 906, amp: 0.8, passes: 1 });
}
function drawMic(g, S, B, shake, pulse) {
  const P = S.pencil, x = MIC.x + shake, hy = MIC.headY, by = MIC.baseY;
  // heavy base + pole
  solid(g, P, ell(x, by, 52, 13, 0, TAU, 24), { fill: '#2b2730', hatch: '#9a948a', w: 3, boil: B, seed: 920, off: [2, 2], hatchOpt: { gap: 6, width: 1, alpha: 0.4, angle: 0.3, comp: 'source-over' } });
  solid(g, P, [[x - 30, by - 4], [x + 30, by - 4], [x + 18, by - 26], [x - 18, by - 26]], { fill: '#3a3540', hatch: '#b8b2a6', w: 3, boil: B, seed: 921, off: [2, 2], hatchOpt: { gap: 6, width: 1, alpha: 0.35, angle: -0.6, comp: 'source-over' } });
  P.ink(g, [[x, by - 24], [x, hy + 48]], { closed: false, color: '#2a2733', width: 11, boil: B, seed: 922, amp: 0.5, passes: 1 });
  P.ink(g, [[x - 2, by - 24], [x - 2, hy + 48]], { closed: false, color: '#cfc8ba', width: 3, boil: B, seed: 923, amp: 0.5, passes: 1, alpha: 0.9 });
  // cable
  P.ink(g, [[x + 4, by - 10], [x + 70, by + 4], [x + 150, by - 8], [x + 230, by + 6]], { closed: false, color: '#0d0c10', width: 5, boil: B, seed: 924, amp: 1.0, passes: 1 });
  // yoke ring + springs + capsule
  const rr = 62 * (1 + 0.03 * pulse);
  P.ink(g, ell(x, hy, rr, rr, 0, TAU, 36), { closed: true, color: '#23202a', width: 8, boil: B, seed: 925, amp: 0.8, passes: 1 });
  P.ink(g, ell(x, hy, rr - 1, rr - 1, -2.6, -1.1, 12), { closed: false, color: '#d9d2c4', width: 2.4, boil: B, seed: 926, amp: 0.6, passes: 1 });
  P.ink(g, [[x - 18, hy + rr - 3], [x - 10, hy + rr + 12], [x + 10, hy + rr + 12], [x + 18, hy + rr - 3]], { closed: false, color: '#23202a', width: 6, boil: B, seed: 927, amp: 0.4, passes: 1 });
  for (let sgn = -1; sgn <= 1; sgn += 2) for (let k = 0; k < 2; k++) {
    const a0 = (sgn < 0 ? Math.PI : 0) + (k ? 0.55 : -0.55) * sgn * (sgn < 0 ? -1 : 1);
    const p0 = [x + Math.cos(a0) * rr, hy + Math.sin(a0) * rr], p1 = [x + Math.cos(a0) * 31, hy + Math.sin(a0) * 43];
    const pts = [p0]; for (let i = 1; i < 6; i++) { const u = i / 6, q = [lerp(p0[0], p1[0], u), lerp(p0[1], p1[1], u)]; pts.push([q[0] + (i % 2 ? 4 : -4), q[1]]); } pts.push(p1);
    P.ink(g, pts, { closed: false, color: '#2b2730', width: 2.4, boil: B, seed: 930 + k + (sgn > 0 ? 3 : 0), amp: 0.3, passes: 1 });
  }
  const cap = ell(x, hy, 33, 49, 0, TAU, 28);
  solid(g, P, cap, { fill: '#cbc5b8', hatch: '#2a2630', w: 3.4, boil: B, seed: 936, off: [2, 2], hatchOpt: { gap: 5, width: 1.1, alpha: 0.55, angle: 0.78, comp: 'multiply', dash: 40 } });
  g.save(); path(g, cap); g.clip(); hatchBox(g, { x: x - 33, y: hy - 49, w: 66, h: 98 }, { color: '#2a2630', gap: 5, width: 1.1, alpha: 0.5, angle: -0.78, seed: 937, boil: B, comp: 'multiply', dash: 40 }); g.restore();
  g.fillStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); g.ellipse(x - 12, hy - 16, 6, 19, 0.1, 0, TAU); g.fill();
}
function drawArcLamp(g, S, B) {
  const P = S.pencil, x = 1380, y = 700;
  [[-70, 215], [10, 224], [74, 214]].forEach(([dx, dy], i) => P.ink(g, [[x + dx * 0.15, y + 30], [x + dx, y + dy]], { closed: false, color: '#1b1820', width: 6, boil: B, seed: 940 + i, amp: 0.6, passes: 1 }));
  const gl = g.createRadialGradient(x - 56, y - 4, 4, x - 56, y - 4, 150); gl.addColorStop(0, 'rgba(255,250,230,0.8)'); gl.addColorStop(1, 'rgba(255,240,200,0)'); g.fillStyle = gl; g.fillRect(x - 210, y - 160, 300, 300);
  g.save(); g.translate(x, y); g.rotate(-0.12);
  solid(g, P, P.rectPts(-34, -40, 100, 80, 10), { fill: '#3a3540', hatch: '#b8b2a6', w: 3.4, boil: B, seed: 945, off: [2, 2], hatchOpt: { gap: 6, width: 1, alpha: 0.35, angle: -0.6, comp: 'source-over' } });
  solid(g, P, ell(-38, 0, 15, 40, 0, TAU, 18), { fill: '#FFF8E0', w: 3.4, boil: B, seed: 946, off: [0, 0] });
  for (let i = 0; i < 4; i++) P.ink(g, [[44 + i * 7, -28], [44 + i * 7, 28]], { closed: false, color: '#9a948a', width: 2, boil: B, seed: 947 + i, amp: 0.3, passes: 1 });
  g.restore();
}
function drawAudience(ctx, S, B, c) {
  const P = S.pencil, y0 = 1000;
  const grad = ctx.createLinearGradient(0, 880, 0, 972); grad.addColorStop(0, 'rgba(6,5,8,0)'); grad.addColorStop(1, 'rgba(6,5,8,0.7)'); ctx.fillStyle = grad; ctx.fillRect(0, 870, 1920, 110);
  [[944, 25, 66, 0], [912, 19, 56, 1]].forEach(([yy, r, step, row]) => {
    for (let x = 250 + (row ? 34 : 0); x < 1700; x += step) {
      const i = Math.round(x / step), jx = (hash(i, row, 5) - 0.5) * 18, jr = r * (0.9 + 0.2 * hash(i, row, 6)), cx = x + jx, cy = yy + (hash(i, row, 7) - 0.5) * 8, kind = Math.floor(hash(i, row, 8) * 4);
      const fillc = row ? '#0a090d' : '#050407';
      solid(ctx, P, ell(cx, cy + jr * 1.7, jr * 2.0, jr * 1.2, Math.PI, TAU, 14), { fill: fillc, w: 2.2, boil: B, seed: 950 + i + row * 40, off: [0, 0], ink: '#1d1a22' });
      solid(ctx, P, ell(cx, cy, jr, jr * 1.12, 0, TAU, 16), { fill: fillc, w: 2.2, boil: B, seed: 960 + i + row * 40, off: [0, 0], ink: '#1d1a22' });
      if (kind === 1) solid(ctx, P, [[cx - jr * 1.5, cy - jr * 0.3], [cx + jr * 1.5, cy - jr * 0.3], [cx + jr * 0.8, cy - jr * 0.55], [cx + jr * 0.7, cy - jr * 1.5], [cx - jr * 0.7, cy - jr * 1.5], [cx - jr * 0.8, cy - jr * 0.55]], { fill: fillc, w: 2.2, boil: B, seed: 970 + i + row * 40, off: [0, 0], ink: '#1d1a22' });
      else if (kind === 2) solid(ctx, P, ell(cx + jr * 0.2, cy - jr * 1.0, jr * 0.6, jr * 0.55, 0, TAU, 10), { fill: fillc, w: 2, boil: B, seed: 980 + i + row * 40, off: [0, 0], ink: '#1d1a22' });
      // beam rim light on the screen side of each head
      ctx.save(); ctx.globalAlpha = 0.5 * (1 - c.p * 0); P.ink(ctx, ell(cx, cy, jr, jr * 1.12, Math.PI * 1.15, Math.PI * 1.85, 8), { closed: false, color: '#E9E3D4', width: 2.2, boil: B, seed: 990 + i + row * 40, amp: 0.5, passes: 1 }); ctx.restore();
    }
  });
}

// ---------- Amrita ----------------------------------------------------------------------------------------------------------
const _scr = new Map();
function hero(ctx, T, S, o, pad) {
  pad = Math.ceil(pad / 64) * 64; const L = pad * 2, px = Math.round(L * S.scale), key = px;
  let cv = _scr.get(key); if (!cv) { cv = S.mk(px, px); _scr.set(key, cv); while (_scr.size > 8) _scr.delete(_scr.keys().next().value); }
  const g2 = cv.getContext('2d'); g2.setTransform(1, 0, 0, 1, 0, 0); g2.clearRect(0, 0, px, px);
  g2.setTransform(S.scale, 0, 0, S.scale, 0, 0); g2.translate(pad - o.x, pad - o.y); g2.globalCompositeOperation = 'source-over'; g2.globalAlpha = 1;
  const r = S.amrita2d.drawAmrita(g2, T, S, o);
  ctx.save(); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.drawImage(cv, o.x - pad, o.y - pad, L, L); ctx.restore();
  return r;
}
function amritaAt(t) { // world units
  const lt = t - 8.5;
  let dx = 0, dy = 0, squash = 0, roll = 0, mul = 1, eye, yaw = 0.34;
  const nerv = t < 8.88 ? 1 : 0;
  const f12 = Math.floor(t * 12 + 1e-6);
  if (t < 9.0) {
    dx = (hash(f12, 1, 4) - 0.5) * 5 * nerv; dy = (hash(f12, 2, 4) - 0.5) * 3.5 * nerv;
    squash = 0.025 * Math.sin(t * 40) * nerv;
    const gulp = Math.exp(-Math.pow((t - 8.8) / 0.05, 2));
    squash -= 0.13 * gulp;
    const inh = smooth((t - 8.88) / 0.1); mul = 1 + 0.07 * inh; squash -= 0.1 * inh;
    const dart = Math.floor(t * 5);
    eye = t < 8.9 ? { open: 1, surprised: 0.55, lookX: (dart % 2 ? 1 : -0.9) * 0.9, lookY: 0.25 + 0.2 * hash(dart, 3, 3), determined: -0.35 } : { open: 0.06 };
  } else {
    const d = t - 9.0;
    squash = 0.38 * Math.exp(-d * 9) * Math.cos(d * 22) - 0.04 * Math.sin(d * 7) * Math.exp(-d * 1.2);
    mul = 1 + 0.06 * Math.exp(-d * 9) * Math.cos(d * 22);
    dy = -22 * Math.abs(Math.sin(d * 8.5)) * Math.exp(-d * 3.4);
    roll = 0.06 * Math.sin(d * 7.5) * Math.exp(-d * 1.4);
    eye = { happy: 1 };
  }
  return { dx, dy, squash, roll, mul, eye, yaw };
}

// ---------- balloon, speech fx --------------------------------------------------------------------------------------------------
function balloon(ctx, S, T, c, tipScr) {
  const t = T.t, P = S.pencil, B = T.boil, d = t - 9.0;
  if (d < 0) return;
  const A = L1(c)(AW.x, AW.y), p = c.p;
  const offW = [lerp(250, -12, p), lerp(-150, -268, p)];
  const kb = c.s1 * (1 + 0.38 * p), W = 290 * kb, H = 142 * kb;
  const bob = Math.sin(t * 4.2) * 3 * kb / 2;
  let cx = A[0] + c.s1 * offW[0], cy = A[1] + c.s1 * offW[1] + bob;
  // pop from the tail tip: overshoot scale + jelly wobble
  const k = outBack(clamp(d / 0.15), 2.6), wob = Math.exp(-d * 8) * Math.cos(d * 36) * 0.1;
  const sx = k * (1 + wob), sy = k * (1 - wob);
  const tip = [tipScr[0], tipScr[1]];
  ctx.save(); ctx.translate(tip[0], tip[1]); ctx.scale(sx, sy); ctx.translate(-tip[0], -tip[1]);
  const rx = W / 2, ry = H / 2, th0 = Math.atan2((tip[1] - cy) / ry, (tip[0] - cx) / rx), pts = [];
  for (let i = 0; i <= 46; i++) { const a = th0 + 0.24 + (TAU - 0.48) * (i / 46), bump = 1 + 0.025 * Math.sin(a * 6 + 1.3); pts.push([cx + Math.cos(a) * rx * bump, cy + Math.sin(a) * ry * bump]); }
  const bA = [cx + Math.cos(th0 - 0.24) * rx, cy + Math.sin(th0 - 0.24) * ry], bB = pts[0];
  const mid = (a, b, u, off) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [lerp(a[0], b[0], u) - (dy / l) * off, lerp(a[1], b[1], u) + (dx / l) * off]; };
  pts.push(bA); pts.push(mid(bA, tip, 0.55, -10 * kb / 2)); pts.push(tip); pts.push(mid(tip, bB, 0.45, -10 * kb / 2));
  P.fill(ctx, pts.map(([x, y]) => [x + 9 * kb / 2, y + 11 * kb / 2]), { color: '#000000', comp: 'source-over', offset: [0, 0], alpha: 0.4, boil: B, seed: 1100, amp: 1.0 });
  P.fill(ctx, pts, { color: '#FFFFFF', comp: 'source-over', offset: [0, 0], boil: B, seed: 1101, amp: 1.0 });
  ctx.save(); path(ctx, pts); ctx.clip();
  hatchBox(ctx, { x: cx - rx, y: cy + ry * 0.1, w: W, h: ry * 1.0 }, { color: '#6b6770', gap: 7 * kb / 2, width: 1.2 * kb / 2, alpha: 0.2, angle: -0.8, seed: 1102, boil: B, comp: 'multiply', dash: 50 });
  ctx.restore();
  P.ink(ctx, pts, { color: INK, width: 3.4 * kb, boil: B, seed: 1103, amp: 1.5 * kb / 2, passes: 2 });
  ctx.restore();
  // lettering (pops with the balloon, writes on in 0.12 s)
  ctx.save(); ctx.translate(tip[0], tip[1]); ctx.scale(sx, sy); ctx.translate(-tip[0], -tip[1]);
  const fs = 74 * kb;
  P.text(ctx, 'Hello!', cx - 4 * kb / 2, cy + fs * 0.27, { font: `700 ${fs}px Caveat`, color: INK, align: 'center', boil: B, seed: 1110, reveal: clamp((d - 0.02) / 0.1), amp: 1.2 * kb / 2, rotate: -0.05, doubled: true });
  ctx.restore();
}
function speechFx(ctx, S, T, c, tipScr, sMul) {
  const d = T.t - 9.0; if (d < 0 || d > 0.4) return;
  const P = S.pencil, B = T.boil, u = clamp(d / 0.3), len = outCubic(u), fade = 1 - smooth((u - 0.5) / 0.5);
  for (let i = 0; i < 9; i++) {
    const a = -1.25 + (i / 8) * 1.55 + (hash(i, 2, 9) - 0.5) * 0.12, r0 = (30 + 20 * hash(i, 3, 9)) * sMul, r1 = r0 + (70 + 60 * hash(i, 4, 9)) * len * sMul;
    const p0 = [tipScr[0] + Math.cos(a) * r0, tipScr[1] + Math.sin(a) * r0], p1 = [tipScr[0] + Math.cos(a) * r1, tipScr[1] + Math.sin(a) * r1];
    ctx.save(); ctx.globalAlpha = fade; P.ink(ctx, [p0, p1], { closed: false, color: '#050407', width: 11 * sMul / 1.95, boil: B, seed: 1200 + i, amp: 0.4, passes: 1, taper: true }); P.ink(ctx, [p0, p1], { closed: false, color: '#FFFFFF', width: 6 * sMul / 1.95, boil: B, seed: 1220 + i, amp: 0.4, passes: 1, taper: true }); ctx.restore();
  }
}
function nervousFx(ctx, S, T, c, A, R) {
  const t = T.t; if (t < 8.5 || t > 9.0) return;
  const P = S.pencil, B = T.boil, s = c.s1;
  // tremor marks beside the disc
  const trem = t < 8.88 ? 1 : 0;
  if (trem) for (let side = -1; side <= 1; side += 2) for (let i = 0; i < 3; i++) {
    const x = A[0] + side * (R * 1.12 + i * R * 0.1 + hash(Math.floor(t * 12), i, 4) * 5), y0 = A[1] - R * 0.5 + i * R * 0.34;
    P.ink(ctx, [[x, y0], [x + side * R * 0.07, y0 + R * 0.1], [x, y0 + R * 0.2]], { closed: false, color: '#FFFFFF', width: 5 * s / 1.95, boil: B, seed: 1300 + i + (side > 0 ? 5 : 0), amp: 0.5, passes: 1 });
  }
  // sweat drops flying off
  [[8.58, 1.0], [8.7, 0.7], [8.82, 1.25]].forEach(([t0, k], i) => {
    const u = (t - t0) / 0.34; if (u < 0 || u > 1) return;
    const sx = A[0] + R * 0.78 + u * R * 0.55 * k, sy = A[1] - R * 0.72 - R * 0.45 * Math.sin(u * 2.4) * k + u * u * R * 0.9, w = R * 0.13;
    const pts = [[sx, sy - w * 1.7], [sx + w * 0.9, sy - w * 0.1], [sx + w * 0.85, sy + w * 0.5], [sx, sy + w], [sx - w * 0.85, sy + w * 0.5], [sx - w * 0.9, sy - w * 0.1]];
    ctx.save(); ctx.globalAlpha = 1 - smooth((u - 0.7) / 0.3);
    P.fill(ctx, pts, { color: '#FFFFFF', comp: 'source-over', offset: [0, 0], boil: B, seed: 1320 + i, amp: 0.5 });
    P.ink(ctx, pts, { color: INK, width: 3.2 * s / 1.95, boil: B, seed: 1330 + i, amp: 0.6, passes: 1 });
    ctx.restore();
  });
}

// ---------- the stage (everything after the iris) --------------------------------------------------------------------------
function drawStage(ctx, T, S) {
  const t = T.t, B = T.boil, c = cam(t), P = S.pencil;
  const bright = smooth((t - 9.1) / 0.28); // projector strikes
  ctx.save();
  ctx.fillStyle = '#0f0d13'; ctx.fillRect(0, 0, 1920, 1080);
  // hall (L0): static layers cached per boil once the camera has settled; vector otherwise
  layer(ctx, 0, c, () => {
    if (c.p >= 0.9999) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.setTransform(S.scale, 0, 0, S.scale, 0, 0); blit(ctx, cached(S, 'hall' + B, (gx) => drawHall(gx, S, B, c))); ctx.restore(); }
    else if (visL0(c, 220, 100, 1700, 720)) drawHall(ctx, S, B, c);
    if (visL0(c, 462, 300, 1458, 345)) drawBulbs(ctx, T);
    drawScreen(ctx, S, T, bright);
  });
  // stage floor (L1)
  layer(ctx, 1, c, () => { drawFloor(ctx, S, B, bright); });
  // projector beam (L0), rising from behind the audience
  layer(ctx, 0, c, () => { drawBeam(ctx, T, bright); });
  // props + Amrita
  layer(ctx, 1, c, () => {
    drawArcLamp(ctx, S, B);
    ctx.save(); const sg = ctx.createRadialGradient(AW.x, 925, 5, AW.x, 925, 130); sg.addColorStop(0, 'rgba(0,0,0,0.6)'); sg.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = sg; ctx.beginPath(); ctx.ellipse(AW.x, 925, 130, 20, 0, 0, TAU); ctx.fill(); ctx.restore();
    const d = t - 9.0, sh = d > 0 ? Math.sin(d * 90) * 2.6 * Math.exp(-d * 7) : 0;
    drawMic(ctx, S, B, sh, d > 0 ? Math.exp(-d * 8) * Math.cos(d * 40) : 0);
  });
  const st = amritaAt(t), A0 = L1(c)(AW.x + st.dx, AW.y + st.dy), RS = RW * st.mul * c.s1;
  const tipScr = [A0[0] + RS * 0.66 * Math.cos(st.yaw), A0[1] - RS * 0.04];
  // soft light pool behind her so the disc pops off the dark floor
  ctx.save(); const hg = ctx.createRadialGradient(A0[0], A0[1], RS * 0.4, A0[0], A0[1], RS * 1.8); hg.addColorStop(0, `rgba(255,248,230,${0.2 + 0.2 * bright})`); hg.addColorStop(1, 'rgba(255,248,230,0)'); ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(A0[0], A0[1], RS * 1.8, 0, TAU); ctx.fill(); ctx.restore();
  hero(ctx, T, S, { x: A0[0], y: A0[1], size: RS, yaw: st.yaw, roll: st.roll, squash: st.squash, eye: st.eye, prop: 'megaphone', propAnim: { t }, propSide: -1, propScale: 0.72, seed: 21, shadow: false }, 3.6 * CU.s1 * RW);
  nervousFx(ctx, S, T, c, A0, RS);
  // audience in the foreground (L2): rises into the bottom of frame during the pull-back
  layer(ctx, 2, c, () => { if (c.p > 0.001) drawAudience(ctx, S, B, c); });
  // the first word
  speechFx(ctx, S, T, c, [tipScr[0] + RS * 0.1, tipScr[1] - RS * 0.05], RS / RW);
  balloon(ctx, S, T, c, [tipScr[0] + 8 * c.s1, tipScr[1] - RS * 0.18]);
  ctx.restore();
}

// ---------- scene ------------------------------------------------------------------------------------------------------------
export default {
  id: 'e1927', kind: '2d',
  // after the first word the image warms by a hair (tint + a touch more contrast), eased in over 0.4 s
  grade: (T) => {
    const k = smooth((T.t - 9.0) / 0.4);
    if (k <= 0) return null;
    return { tint: 0.1 + 0.14 * k, highTint: [1.0, lerp(0.98, 0.95, k), lerp(0.95, 0.88, k)], shadowTint: [lerp(1, 1.0, k), lerp(1, 0.985, k), lerp(1, 0.96, k)] };
  },
  draw(ctx, T, S) {
    const lt = T.lt;
    // iris radius (card layer is clipped OUTSIDE this circle)
    const ir = lt < 0.5 ? 0 : 1300 * inOutCubic(clamp((lt - 0.5) / 0.3));
    ctx.save();
    if (lt >= 0.49) drawStage(ctx, T, S); else { ctx.fillStyle = '#0f0d13'; ctx.fillRect(0, 0, 1920, 1080); }
    if (lt < 0.81) drawCard(ctx, T, S, ir);
    ctx.restore();
  },
};
