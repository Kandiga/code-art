// =============================================================================
// amrita2d.js — Amrita drawn in the pencil world (v0). Same character in every era; the era look comes from
// the grade pass (B&W / sepia / colour...) plus `style` here. Geometry = the proposed mark (see BRAND.md):
//   disc R, 6 pinwheel aperture blades, cream rounded PLAY-TRIANGLE face, two glossy black OVAL eyes.
//
// API (stable):
//   drawAmrita(ctx, T, S, o) -> { faceBox:{x,y,w,h}, eyeY, center:[x,y] }
//     o = { x, y, size (=R px), yaw (rad, 0.45 typical), roll, squash (-.5..+.5, + = taller),
//           eye: {open,squint,happy,determined,surprised,sleepy,lookX,lookY} | expr:'neutral'|'happy'|'determined'|'surprised'|'squint'|'sleepy'|'blink',
//           prop: 'crank'|'megaphone'|'viewfinder'|'clapper'|'slate'|null, propAnim:{crank,clap,glow,t}, propSide:1|-1,
//           style: 'ink' (hand drawn, default) | 'clean' (crisp digital) | 'line' (ink only, no fill: 1895),
//           palette:{blade,bladeAlt,face}, alpha, seed, shadow:true }
//   drawProp(ctx, T, S, kind, {x,y,size,anim,boil,seed,style})
//   drawMark(ctx, S, {x,y,size,style:'flat'|'ink', boil}) flat logo (aperture + play triangle, no eyes)
//   EXPR: expression presets
// =============================================================================
import * as P from './pencil.js';
import { BRAND } from '../../shared/cues.js';
import { clamp, lerp } from './ease.js';

export const EXPR = {
  neutral: {}, happy: { happy: 1 }, determined: { determined: 1 }, surprised: { surprised: 1 }, squint: { squint: 1 }, sleepy: { sleepy: 1 }, blink: { open: 0 },
};
const rad = (d) => (d * Math.PI) / 180;

function bladePts(i, R) {
  const a0 = rad(i * 60), ro = R * 0.985, ri = R * 0.62, pts = [];
  for (let k = 0; k <= 12; k++) { const a = a0 + rad(70) * (k / 12); pts.push([Math.cos(a) * ro, Math.sin(a) * ro]); }
  pts.push([Math.cos(a0 + rad(98)) * ri, Math.sin(a0 + rad(98)) * ri]);
  pts.push([Math.cos(a0 + rad(18)) * ri, Math.sin(a0 + rad(18)) * ri]);
  return pts;
}
function trianglePts(R) {
  const rc = R * 0.60, V = [0, 120, 240].map((d) => [Math.cos(rad(d)) * rc, Math.sin(rad(d)) * rc]);
  return P.smoothPts(V, { closed: true, n: 10, tension: 0.9 }).length ? roundTri(V, R * 0.14) : V;
}
function roundTri(V, r) {
  const out = [];
  for (let i = 0; i < 3; i++) {
    const p0 = V[(i + 2) % 3], p1 = V[i], p2 = V[(i + 1) % 3];
    const d1 = [p0[0] - p1[0], p0[1] - p1[1]], d2 = [p2[0] - p1[0], p2[1] - p1[1]], l1 = Math.hypot(...d1), l2 = Math.hypot(...d2);
    const a = [p1[0] + (d1[0] / l1) * r * 1.7, p1[1] + (d1[1] / l1) * r * 1.7], b = [p1[0] + (d2[0] / l2) * r * 1.7, p1[1] + (d2[1] / l2) * r * 1.7];
    for (let k = 0; k <= 8; k++) { const t = k / 8, u = 1 - t; out.push([u * u * a[0] + 2 * u * t * p1[0] + t * t * b[0], u * u * a[1] + 2 * u * t * p1[1] + t * t * b[1]]); }
  }
  return out;
}

export function drawMark(ctx, S, { x = 960, y = 540, size = 200, style = 'flat', boil = 0, palette = {}, seed = 4, alpha = 1, play = true } = {}) {
  const pal = { blade: BRAND.palette.vermilion, bladeAlt: BRAND.palette.amber, face: BRAND.palette.cream, ink: BRAND.palette.graphite, ...palette };
  ctx.save(); ctx.translate(x, y); ctx.globalAlpha = alpha;
  const hand = style === 'ink';
  for (let i = 0; i < 6; i++) {
    const pts = bladePts(i, size);
    if (hand) P.shape(ctx, pts, { boil, seed: seed + i, fill: { color: i % 2 ? pal.bladeAlt : pal.blade, offset: [size * 0.02, size * 0.015] }, hatch: { color: P.darken(i % 2 ? pal.bladeAlt : pal.blade, 0.25), gap: size * 0.045, width: 1.2, alpha: 0.5, angle: rad(i * 60 + 40) }, ink: { color: pal.ink, width: size * 0.016 } });
    else { ctx.fillStyle = i % 2 ? pal.bladeAlt : pal.blade; ctx.beginPath(); pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill(); }
  }
  if (play) {
    const tri = roundTri([0, 120, 240].map((d) => [Math.cos(rad(d)) * size * 0.6, Math.sin(rad(d)) * size * 0.6]), size * 0.14);
    if (hand) P.shape(ctx, tri, { boil, seed: seed + 9, fill: { color: pal.face, offset: [size * 0.015, size * 0.01], comp: 'source-over' }, ink: { color: pal.ink, width: size * 0.015 } });
    else { ctx.fillStyle = pal.face; ctx.beginPath(); tri.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill(); }
  }
  ctx.restore();
}

export function drawProp(ctx, T, S, kind, { x = 0, y = 0, size = 100, anim = {}, boil = 0, seed = 7, style = 'ink' } = {}) {
  if (!kind) return;
  const ink = BRAND.palette.graphite, gold = BRAND.palette.amber, s = size, B = boil;
  const sh = (pts, fill, extra = {}) => P.shape(ctx, pts, { boil: B, seed, fill: fill ? { color: fill, offset: [3, 2] } : false, ink: { color: ink, width: Math.max(2, s * 0.03) }, ...extra });
  ctx.save(); ctx.translate(x, y);
  if (kind === 'crank') {
    sh(P.rectPts(-s * 0.5, -s * 0.3, s, s * 0.6, 6), '#B7A58B');
    sh(P.circlePts(-s * 0.22, -s * 0.45, s * 0.24, 22), gold); sh(P.circlePts(s * 0.2, -s * 0.45, s * 0.24, 22), gold);
    sh(P.rectPts(-s * 0.85, -s * 0.14, s * 0.4, s * 0.28, 4), '#8F7F66');
    const a = (anim.crank ?? (anim.t || 0) * 8); const hx = s * 0.5 + Math.cos(a) * s * 0.16, hy = Math.sin(a) * s * 0.16;
    P.line(ctx, [[s * 0.5, 0], [hx, hy]], { boil: B, seed, color: ink, width: s * 0.04 }); P.shape(ctx, P.circlePts(hx, hy, s * 0.06, 10), { boil: B, seed, fill: gold, ink: { color: ink, width: 2 } });
  } else if (kind === 'megaphone') {
    sh([[-s * 0.2, -s * 0.12], [s * 0.7, -s * 0.5], [s * 0.7, s * 0.5], [-s * 0.2, s * 0.12]], gold); sh(P.rectPts(-s * 0.55, -s * 0.12, s * 0.36, s * 0.24, 4), '#B7A58B'); sh(P.rectPts(-s * 0.4, s * 0.1, s * 0.12, s * 0.32, 3), '#8F7F66');
  } else if (kind === 'viewfinder') {
    sh(P.rectPts(-s * 0.5, -s * 0.38, s, s * 0.76, 4), null); P.hatch(ctx, P.rectPts(-s * 0.5, -s * 0.38, s, s * 0.76, 4), { color: gold, gap: 9, alpha: 0.35, boil: B, seed });
    sh(P.rectPts(-s * 0.25, s * 0.38, s * 0.5, s * 0.22, 3), '#8F7F66');
  } else if (kind === 'clapper') {
    sh(P.rectPts(-s * 0.5, -s * 0.28, s, s * 0.6, 3), '#3a3844'); const ang = -(1 - (anim.clap ?? 1)) * 0.5;
    ctx.save(); ctx.translate(-s * 0.5, -s * 0.28); ctx.rotate(ang);
    for (let i = 0; i < 5; i++) sh([[i * s * 0.2, -s * 0.2], [i * s * 0.2 + s * 0.12, -s * 0.2], [i * s * 0.2 + s * 0.08, 0], [i * s * 0.2 - s * 0.04, 0]], i % 2 ? '#FFF3D6' : gold, { ink: false });
    P.ink(ctx, P.rectPts(0, -s * 0.2, s, s * 0.2), { boil: B, seed, color: ink, width: 3 }); ctx.restore();
  } else if (kind === 'slate') {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 0.9); g.addColorStop(0, 'rgba(107,91,255,0.55)'); g.addColorStop(1, 'rgba(107,91,255,0)');
    ctx.save(); ctx.globalCompositeOperation = style === 'clean' ? 'source-over' : 'multiply'; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, s * 0.9, 0, 7); ctx.fill(); ctx.restore();
    sh(P.rectPts(-s * 0.33, -s * 0.45, s * 0.66, s * 0.9, 10), '#2a2833'); P.shape(ctx, P.rectPts(-s * 0.27, -s * 0.38, s * 0.54, s * 0.76, 6), { boil: B, seed, fill: { color: '#6B5BFF', comp: 'source-over', offset: [0, 0] }, ink: false });
    ctx.save(); ctx.strokeStyle = '#FFF3D6'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, s * 0.14, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
  ctx.restore();
}

export function drawAmrita(ctx, T, S, o = {}) {
  const { x = 960, y = 540, size = 200, yaw = 0.45, roll = 0, squash = 0, prop = null, propAnim = {}, propSide = 1, style = 'ink', alpha = 1, seed = 11, shadow = true } = o;
  const pal = { blade: BRAND.palette.vermilion, bladeAlt: BRAND.palette.amber, face: BRAND.palette.cream, ink: BRAND.palette.graphite, ...(o.palette || {}) };
  const boil = style === 'clean' ? 0 : T.boil;
  const amp = style === 'clean' ? 0 : 1;
  const eye = { open: 1, squint: 0, happy: 0, determined: 0, surprised: 0, sleepy: 0, lookX: 0, lookY: 0, ...(o.expr ? EXPR[o.expr] : {}), ...(o.eye || {}) };
  const R = size, sy = 1 + squash, sx = (1 / Math.sqrt(Math.max(0.2, sy))) * Math.cos(yaw);
  const inkW = Math.max(2.2, R * 0.022);
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.rotate(roll);
  if (shadow && style !== 'clean') P.smudge(ctx, 0, R * 1.18 * sy, R * 0.9, { color: '#2A2833', alpha: 0.22 });
  ctx.scale(sx / Math.cos(yaw) * Math.cos(yaw), sy); // applied below via explicit x-scale
  ctx.restore();

  // --- body drawn with explicit transform so wobble stays in screen space ---
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.rotate(roll);
  const X = (px, py) => [px * sx, py * sy];
  const T2 = (pts, dx = 0, dy = 0) => pts.map(([px, py]) => [px * sx + dx, py * sy + dy]);
  const thick = Math.sin(yaw) * R * 0.16; // visible edge thickness
  // back plate (thickness edge on the far side)
  const back = T2(P.circlePts(0, 0, R, 48), -thick, 0);
  P.shape(ctx, back, { boil, seed, fill: { color: '#3A3844', offset: [3, 2], comp: 'source-over' }, ink: { color: pal.ink, width: inkW, amp: 1.6 * amp } });
  for (let i = 0; i < 6; i++) {
    const pts = T2(bladePts(i, R), 0, 0), col = i % 2 ? pal.bladeAlt : pal.blade;
    P.shape(ctx, pts, {
      boil, seed: seed + i * 3,
      fill: style === 'line' ? false : { color: col, offset: [R * 0.02, R * 0.014], amp: 1.4 * amp },
      hatch: style === 'ink' ? { color: P.darken(col, 0.28), gap: R * 0.05, width: 1.3, alpha: 0.5, angle: rad(i * 60 + 35), seed: seed + i } : false,
      ink: { color: pal.ink, width: inkW, amp: 1.5 * amp },
    });
  }
  // face plate (parallax: shifted toward the yaw direction)
  const fx = Math.sin(yaw) * R * 0.1, fy = 0;
  const tri = T2(roundTri([0, 120, 240].map((d) => [Math.cos(rad(d)) * R * 0.6, Math.sin(rad(d)) * R * 0.6]), R * 0.14), fx, fy);
  P.shape(ctx, tri, { boil, seed: seed + 40, fill: { color: pal.face, offset: [R * 0.015, R * 0.01], comp: 'source-over' }, hatch: style === 'ink' ? { color: '#E0C9A0', gap: R * 0.06, width: 1.1, alpha: 0.35, angle: -0.6, seed: seed + 41 } : false, ink: { color: pal.ink, width: inkW * 0.9, amp: 1.2 * amp } });
  // eyes
  const eyeC = [[-R * 0.08 * sx + fx, R * 0.17 * sy + fy], [-R * 0.08 * sx + fx, -R * 0.17 * sy + fy]];
  const openY = Math.max(0.07, eye.open * (1 - 0.55 * eye.squint) * (1 - 0.45 * eye.sleepy) * (1 + 0.35 * eye.surprised));
  const ew = R * 0.075 * (1 + 0.25 * eye.surprised) * sx / Math.max(0.35, Math.cos(yaw)) * Math.cos(yaw) * 1.0, eh = R * 0.125 * openY * sy;
  const eyePts = [];
  eyeC.forEach(([ex, ey], idx) => {
    const lx = eye.lookX * R * 0.03, ly = eye.lookY * R * 0.03;
    if (eye.happy >= 0.5) {
      const pts = []; for (let k = 0; k <= 10; k++) { const a = Math.PI + (k / 10) * Math.PI; pts.push([ex + Math.cos(a) * ew * 1.2 + lx, ey + Math.sin(a) * eh * 1.0 + eh * 0.5 + ly]); }
      P.ink(ctx, pts, { closed: false, color: pal.ink, width: R * 0.05, amp: 0.8 * amp, boil, seed: seed + 50 + idx, passes: 2 });
    } else {
      const e = P.ellipsePts(ex + lx, ey + ly, ew, eh, 0, 22);
      ctx.save(); ctx.fillStyle = '#0E0D12'; ctx.beginPath(); e.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill(); ctx.restore();
      P.ink(ctx, e, { color: '#0E0D12', width: 2, amp: 0.6 * amp, boil, seed: seed + 60 + idx, passes: 1 });
      if (openY > 0.3) { ctx.save(); ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.beginPath(); ctx.ellipse(ex + lx - ew * 0.3, ey + ly - eh * 0.4, ew * 0.22, eh * 0.2, 0, 0, 7); ctx.fill(); ctx.restore(); }
      if (eye.determined > 0.05) { // slanted lid cap
        const d = eye.determined, sgn = idx === 0 ? 1 : -1;
        const lid = [[ex - ew * 1.4, ey - eh * 1.3 - (sgn > 0 ? 0 : 0)], [ex + ew * 1.4, ey - eh * 1.3], [ex + ew * 1.4, ey - eh * (0.1 + 0.5 * (1 - d)) + sgn * ew * 0.9 * d], [ex - ew * 1.4, ey - eh * (0.1 + 0.5 * (1 - d)) - sgn * ew * 0.9 * d]];
        ctx.save(); ctx.fillStyle = pal.face; ctx.beginPath(); lid.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill(); ctx.restore();
        P.ink(ctx, [lid[3], lid[2]], { closed: false, color: pal.ink, width: 3, amp: 0.8 * amp, boil, seed: seed + 70 + idx, passes: 1 });
      }
    }
    eyePts.push([ex, ey]);
  });
  // prop floating at her side
  if (prop) { const px = propSide * R * 1.55 * sx, py = R * 0.05 + Math.sin((T.t || 0) * 2.2) * R * 0.03; drawProp(ctx, T, S, prop, { x: px, y: py, size: R * 0.55, anim: { t: T.t, ...propAnim }, boil, seed: seed + 80, style }); }
  ctx.restore();
  // faceBox in canvas coords (approx, ignoring roll)
  const fb = { x: x + fx - R * 0.35 * sx, y: y - R * 0.35 * sy, w: R * 0.7 * sx, h: R * 0.7 * sy };
  return { faceBox: fb, eyeY: y - R * 0.17 * sy, center: [x, y], R };
}
