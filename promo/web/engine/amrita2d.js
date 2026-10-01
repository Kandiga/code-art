// =============================================================================
// amrita2d.js — Amrita drawn (v1). The SAME character in every era; the era look = `style` here + the engine's grade pass.
// Geometry = the proposed mark (BRAND.md, PROPOSAL): a disc R, six pinwheel aperture blades (vermilion / amber) around a
// hexagonal opening (circumradius .62), a cream rounded PLAY-TRIANGLE face plate (.60, tip right, corner r .10) and two
// glossy black OVAL eyes (.13 x .22 at (-.08, +-.17)). She is an icon, never a human: no limbs, no torso.
//
// MAIN API (frozen signatures — v0 callers keep working):
//   drawAmrita(ctx, T, S, o) -> { faceBox:{x,y,w,h}, eyeY, center:[x,y], R, eyes:[[x,y],[x,y]], prop:{x,y,size}|null }
//     o = { x, y, size (=R px), yaw (rad, .45 = toward camera), pitch, roll, squash (-.5..+.5, + taller),
//           eye: {open,squint,happy,determined(+/-),surprised,sleepy,lookX,lookY,wink} | expr:'neutral'|'blink'|'squint'|'happy'|
//                'determined'|'surprised'|'sleepy'|'sad'|'smug'|'wink'|'joy' (+ exprAmt 0..1),
//           prop: 'crank'|'megaphone'|'viewfinder'|'clapper'|'slate'|'baton'|'brush'|null, propAnim:{t,crank,clap,glow,...}, propSide:1|-1,
//           propDx, propDy, propScale, propRot,
//           style: 'ink' (hand drawn, default) | 'line' (1895 ink only) | 'clean' (crisp digital) | 'phone' (UI sticker) |
//                  'hologram' (teal additive) | 'glow' (luminous: neural / dream),
//           fx: ['sparkle','lines','sweat','confetti','zzz','heart','exclaim','question','poof'] (+ fxT seconds since trigger, fxAngle),
//           palette:{blade,bladeAlt,face,ink,eye}, alpha, seed, shadow:true|false|{y,a,w}, groundY, thick, iris, glow:'#hex', hue }
//   drawProp(ctx, T, S, kind, {x,y,size,anim,boil,seed,style})
//   drawMark(ctx, S, {x,y,size,style:'flat'|'ink'|'mono', boil, palette, seed, alpha, play, eyes, expr, iris, yaw, color})
//   more o: blink (0..1 closed, e.g. blinkAmount(T)), blush (0..1, auto when happy), pitch (rad), hue/glow ('#hex' for hologram / glow), iris (.04..1.5 aperture opening)
//   helpers: EXPR (presets) · STYLES · blinkAmount(T,{seed}) · eyeAnim(T, script) · hoverBob(T,{size}) · poseAt('hop'|'pop'|'land'|'anticipate'|'dash'|'nod', u) ·
//            clapAt(t, tHit) -> {clap,hit} · lookToward(x,y,tx,ty) · mixEye(a,b,t) · eyeFor(expr,amt) · eyeShape / apertureGeom / triUnit / GEO (unit geometry)
//   usage:  const e = eyeAnim(T, [{t:0,expr:'neutral'},{t:1.2,expr:'happy',ease:'spring'}]);  drawAmrita(ctx,T,S,{x,y,size:260,eye:e, ...hoverBob})
//   markSVG / monoSVG / characterSVG (string builders: brand/ files are generated from the same geometry by brand/build.mjs)
// Every frame is a pure function of its inputs (seeded hashing only).
// =============================================================================
import * as P from './pencil.js';
import { BRAND } from '../../shared/cues.js';
import { clamp, lerp, smooth, spring, outBack, outCubic, inOutCubic } from './ease.js';
import { hash, noise1, rng } from './rng.js';

const TAU = Math.PI * 2;
const rad = (d) => (d * Math.PI) / 180;
const C = BRAND.palette;
const smoothstep = (a, b, x) => smooth((x - a) / (b - a));

export const STYLES = ['ink', 'line', 'clean', 'phone', 'hologram', 'glow'];

// ---------------------------------------------------------------------------------------------------------------------
// expressions
// ---------------------------------------------------------------------------------------------------------------------
const EYE0 = { open: 1, squint: 0, happy: 0, determined: 0, surprised: 0, sleepy: 0, lookX: 0, lookY: 0, wink: 0 };
export const EXPR = {
  neutral: {}, happy: { happy: 1 }, determined: { determined: 1 }, surprised: { surprised: 1 }, squint: { squint: 1 }, sleepy: { sleepy: 1 }, blink: { open: 0 },
  // extras (all are just eye numbers)
  sad: { determined: -0.85, open: 0.92 }, worried: { determined: -0.7, surprised: 0.25 }, smug: { squint: 0.35, determined: 0.45, sleepy: 0.25 },
  wink: { wink: 1 }, joy: { happy: 1, surprised: 0.25 }, focus: { determined: 0.55, squint: 0.2 }, awe: { surprised: 0.8, open: 1 },
};
// expression name (+ amount) -> eye numbers.  amount 0..1 scales the expression from neutral (like amrita3d.expression()).
export function eyeFor(expr = 'neutral', amt = 1) {
  const e = { ...EYE0 }; const p = (typeof expr === 'string' ? EXPR[expr] : expr) || {};
  for (const k in p) e[k] = k === 'open' ? lerp(1, p[k], amt) : p[k] * amt;
  return e;
}
export function mixEye(a, b, t) {
  const A = { ...EYE0, ...a }, B = { ...EYE0, ...b }, o = {};
  for (const k in EYE0) o[k] = lerp(A[k], B[k], t);
  return o;
}
function resolveEye(o) {
  let e = { ...EYE0 };
  if (o.expr) e = eyeFor(o.expr, o.exprAmt ?? 1);
  if (o.eye) e = { ...e, ...o.eye };
  return e;
}

// ---------------------------------------------------------------------------------------------------------------------
// unit-space geometry (R = 1)  — the single source of truth, also used by the SVG builders
// ---------------------------------------------------------------------------------------------------------------------
export const GEO = { hex: 0.62, tri: 0.60, triR: 0.10, eyeHW: 0.075, eyeHH: 0.125, eyeX: -0.08, eyeY: 0.17, thick: 0.28, blades: 6 };

// hexagonal opening + the 6 pinwheel rays: each ray starts at a hexagon vertex V_k and continues the hexagon edge (V_{k+1}->V_k)
// until it meets the outer circle at C_k.  Blade k = V_k -> C_{k-1} (straight, passes through V_{k-1}), arc C_{k-1} -> C_k, back to V_k.
export function apertureGeom(rh = GEO.hex, n = GEO.blades, rot = 0) {
  const V = [], Cc = [];
  for (let k = 0; k < n; k++) { const a = rot + (k * TAU) / n; V.push([Math.cos(a) * rh, Math.sin(a) * rh]); }
  for (let k = 0; k < n; k++) {
    const A = V[k], B = V[(k + 1) % n]; let dx = A[0] - B[0], dy = A[1] - B[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const b = A[0] * dx + A[1] * dy, c = rh * rh - 1, s = -b + Math.sqrt(Math.max(0, b * b - c));
    Cc.push([A[0] + dx * s, A[1] + dy * s]);
  }
  return { V, C: Cc, n, rh };
}
export function bladeUnit(g, k, arcN = 14) {
  const n = g.n, V = g.V[k], Cp = g.C[(k - 1 + n) % n], Ck = g.C[k];
  let a0 = Math.atan2(Cp[1], Cp[0]), a1 = Math.atan2(Ck[1], Ck[0]); while (a1 < a0) a1 += TAU;
  const pts = [V.slice(), Cp.slice()];
  for (let i = 1; i < arcN; i++) { const a = lerp(a0, a1, i / arcN); pts.push([Math.cos(a), Math.sin(a)]); }
  pts.push(Ck.slice());
  return pts;
}
// rounded convex polygon (circular fillets, radius r)
export function roundedPoly(V, r, n = 8) {
  const out = [], N = V.length;
  for (let i = 0; i < N; i++) {
    const p0 = V[(i + N - 1) % N], p1 = V[i], p2 = V[(i + 1) % N];
    let u1 = [p0[0] - p1[0], p0[1] - p1[1]], u2 = [p2[0] - p1[0], p2[1] - p1[1]];
    const l1 = Math.hypot(...u1), l2 = Math.hypot(...u2); u1 = [u1[0] / l1, u1[1] / l1]; u2 = [u2[0] / l2, u2[1] / l2];
    const ang = Math.acos(clamp(u1[0] * u2[0] + u1[1] * u2[1], -1, 1)), sb = r / Math.tan(ang / 2);
    const bis = [u1[0] + u2[0], u1[1] + u2[1]], bl = Math.hypot(...bis), cd = r / Math.sin(ang / 2);
    const c = [p1[0] + (bis[0] / bl) * cd, p1[1] + (bis[1] / bl) * cd];
    const t1 = [p1[0] + u1[0] * sb, p1[1] + u1[1] * sb], t2 = [p1[0] + u2[0] * sb, p1[1] + u2[1] * sb];
    const a1 = Math.atan2(t1[1] - c[1], t1[0] - c[0]); let da = Math.atan2(t2[1] - c[1], t2[0] - c[0]) - a1; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
    for (let k = 0; k <= n; k++) { const a = a1 + (da * k) / n; out.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]); }
  }
  return out;
}
export const triVerts = (rc = GEO.tri) => [0, 120, 240].map((d) => [Math.cos(rad(d)) * rc, Math.sin(rad(d)) * rc]);
export const triUnit = (rc = GEO.tri, r = GEO.triR) => roundedPoly(triVerts(rc), r, 8);

// convex hull (monotone chain) of a point cloud
function hull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); if (p.length < 3) return p;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = []; for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  const up = []; for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  lo.pop(); up.pop(); return lo.concat(up);
}
const chaikin = (pts) => { const o = []; const n = pts.length; for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; o.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); } return o; };
const circleU = (r, n = 64, z = 0) => Array.from({ length: n }, (_, i) => [Math.cos((i / n) * TAU) * r, Math.sin((i / n) * TAU) * r]);

// ---------------------------------------------------------------------------------------------------------------------
// the eye shape: oval <-> happy arch (morph), lids for squint / sleepy / determined (slanted) — all continuous in the numbers
// returns the polygon (unit coords, relative to the eye centre) + glint info
// ---------------------------------------------------------------------------------------------------------------------
export function eyeShape(e, side = 1, n = 14) {
  const sur = clamp(e.surprised || 0, 0, 1.2), hp = clamp(e.happy || 0, 0, 1), det = clamp(e.determined || 0, -1.2, 1.2), slp = clamp(e.sleepy || 0, 0, 1), sq = clamp(e.squint || 0, 0, 1);
  const wk = e.wink || 0, hpE = clamp(Math.max(hp, side > 0 ? clamp(wk, 0, 1) : clamp(-wk, 0, 1) + (wk > 0 ? 0 : 0)), 0, 1);
  const openE = e.open * (1 - 0.0);
  const hwB = GEO.eyeHW * (1 + 0.32 * sur + 0.30 * hpE), hhB = GEO.eyeHH * (1 + 0.16 * sur);
  const v = Math.max(0.075, openE), hh = hhB * v, hw = hwB * (1 + 0.1 * (1 - clamp(v, 0, 1)));
  const top = [], bot = [], adet = Math.abs(det);
  // squint = a flattened lens with a cheek lift (rounded, no hard lid corners); sleepy/determined = lid lines (clip) on top
  const sqk = 1 - 0.46 * sq, curl = (1 - clamp(v / 0.42, 0, 1)); // curl: a closing eye droops into a soft arc
  for (let i = 0; i <= n; i++) {
    const th = (Math.PI * i) / n, u = -Math.cos(th), s = Math.sqrt(Math.max(0, 1 - u * u));
    let t = -hh * s * sqk + sq * hh * 0.10 * s, b = hh * s * sqk - sq * hh * (0.16 * s + 0.10 * (1 - s));
    // happy arch
    const tA = hhB * (0.36 - 0.80 * s), bA = tA + hhB * (0.20 + 0.28 * s);
    t = lerp(t, tA, hpE); b = lerp(b, bA, hpE);
    // lids
    const lidK = 1 - hpE, topLid = -hh * sqk + 2 * hh * sqk * (slp * 0.55 + adet * 0.34) + det * 0.95 * hh * u;
    t = lerp(t, Math.max(t, topLid), lidK); b = lerp(b, Math.max(Math.min(b, hh), t + 0.0), lidK);
    const dr = curl * 0.30 * hhB * s * lidK; t += dr; b += dr;
    if (b < t + 0.012) { const m = (t + b) / 2; t = m - 0.006; b = m + 0.006; }
    top.push([u * hw, t]); bot.push([u * hw, b]);
  }
  let pts = top.concat(bot.slice().reverse().slice(1, -1));
  if (hpE < 0.5) pts = chaikin(pts);
  const vis = (top.length ? (bot[Math.floor(n * 0.35)][1] - top[Math.floor(n * 0.35)][1]) : 0);
  const gAlpha = clamp((vis / (2 * hhB) - 0.28) * 3.2, 0, 1) * (1 - hpE);
  const ty = top[Math.floor(n * 0.35)][1], by = bot[Math.floor(n * 0.35)][1];
  return {
    pts, hw, hh, hhB, happy: hpE, glintA: gAlpha,
    glint: { x: -0.30 * hw, y: ty + (by - ty) * 0.30, rx: 0.30 * hw, ry: Math.max(0.006, Math.min(0.30 * hhB * 0.85, (by - ty) * 0.2)) },
    glint2: { x: 0.34 * hw, y: ty + (by - ty) * 0.78, r: 0.13 * hw },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// figure builder: orthographic projection of the 3D-ish disc (yaw about the vertical axis, pitch about the horizontal)
// ---------------------------------------------------------------------------------------------------------------------
const Z_PLATE = 0.115, Z_PLATE_TH = 0.055, Z_EYE = 0.19;
function buildFig(R, o, eyeP) {
  const th = o.thick ?? GEO.thick;
  const yaw = clamp(o.yaw ?? 0.45, -1.35, 1.35), pitch = clamp(o.pitch ?? 0, -0.9, 0.9);
  const sy = 1 + (o.squash || 0), sx = 1 / Math.sqrt(Math.max(0.2, sy));
  const cy = Math.cos(yaw), sn = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const pr = (x, y, z = 0) => [(x * cy + z * sn) * R * sx, (y * cp - (-x * sn + z * cy) * sp) * R * sy];
  const M = (pts, z = 0) => pts.map((p) => pr(p[0], p[1], z));
  const F = { R, pr, M, yaw, pitch, sx, sy, th };
  const circ = (z) => M(circleU(1, 72), z);
  F.front = circ(0); F.back = circ(-th);
  const off = Math.hypot(F.front[0][0] - F.back[0][0], F.front[0][1] - F.back[0][1]);
  F.band = off > R * 0.018 ? hull(F.front.concat(F.back)) : null;
  F.silo = hull(F.front.concat(F.back));
  const iris = clamp(o.iris ?? 1, 0.04, 1.5), rh = clamp(GEO.hex * iris, 0.03, 0.97);
  F.g = apertureGeom(rh);
  F.blades = []; for (let k = 0; k < 6; k++) { const u = bladeUnit(F.g, k); F.blades.push({ k, u, pts: M(u, 0 + k * 0.0004) }); }
  F.hex = M(F.g.V, 0);
  F.seams = F.g.V.map((v, k) => [pr(v[0], v[1], 0), pr(F.g.C[k][0], F.g.C[k][1], 0)]);
  // plate
  const ts = clamp(iris / 1, 0.35, 1.2), triU = triUnit(GEO.tri * (iris < 1 ? Math.max(0.5, iris) : 1), GEO.triR);
  F.triU = triU; F.tri = M(triU, Z_PLATE); F.triBase = M(triU, Z_PLATE - Z_PLATE_TH);
  F.triBand = hull(F.tri.concat(F.triBase)); F.triShadow = M(triU, 0);
  // eyes
  F.eyes = [];
  const lx = (eyeP.lookX || 0) * 0.045, ly = (eyeP.lookY || 0) * 0.04;
  for (const side of [-1, 1]) {
    const sh = eyeShape(eyeP, side);
    const cx = GEO.eyeX + lx, cyy = side * GEO.eyeY + ly;
    const E = { side, sh, c: pr(cx, cyy, Z_EYE), pts: M(sh.pts.map((p) => [p[0] + cx, p[1] + cyy]), Z_EYE) };
    const ell = (g, N = 14) => Array.from({ length: N }, (_, i) => [cx + g.x + Math.cos((i / N) * TAU) * g.rx, cyy + g.y + Math.sin((i / N) * TAU) * g.ry]);
    E.glint = M(ell(sh.glint), Z_EYE + 0.004);
    E.glint2 = M(ell({ x: sh.glint2.x, y: sh.glint2.y, rx: sh.glint2.r, ry: sh.glint2.r }, 10), Z_EYE + 0.004);
    F.eyes.push(E);
  }
  F.eyeU = F.eyes.map((E) => E.sh);
  return F;
}
const centroid = (pts) => { let x = 0, y = 0; for (const p of pts) { x += p[0]; y += p[1]; } return [x / pts.length, y / pts.length]; };
const path = (ctx, pts, closed = true) => { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); if (closed) ctx.closePath(); };
const arcPts = (pts, a0, a1) => { const n = pts.length; return Array.from({ length: Math.round(((a1 - a0) / TAU) * n) + 1 }, (_, i) => pts[(Math.round((a0 / TAU) * n) + i + n * 4) % n]); };


// ---------------------------------------------------------------------------------------------------------------------
// batched colored-pencil hatching: same strokes as pencil.hatch (same seeds / jitter / density), but segments are collected
// into 3 alpha buckets and stroked with 3 calls instead of one call per segment (raster cost, not JS cost, dominated v0).
// ---------------------------------------------------------------------------------------------------------------------
function hatchB(ctx, pts, { color = '#C0431F', angle = -0.75, gap = 7, width = 1.3, alpha = 0.65, boil = 0, seed = 3, jitter = 1.2, cross = 0, shade = null, comp = 'multiply', margin = 0, segLen = 38 } = {}) {
  const b = P.bounds(pts), Rr = Math.hypot(b.w, b.h) / 2 + 6;
  ctx.save(); path(ctx, pts); ctx.clip();
  ctx.globalCompositeOperation = comp; ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineWidth = width;
  const buckets = [new Path2D(), new Path2D(), new Path2D()], used = [false, false, false];
  const dirs = cross ? [angle, angle + Math.PI / 2 + 0.25] : [angle];
  dirs.forEach((ang, di) => {
    const c = Math.cos(ang), s = Math.sin(ang), nx = -s, ny = c, lines = Math.ceil((Rr * 2) / gap);
    for (let li = 0; li < lines; li++) {
      const off = -Rr + li * gap + (hash(li, seed, di) - 0.5) * gap * 0.5 + noise1(li * 0.31, seed + boil * 7) * jitter;
      const ox = b.cx + nx * off, oy = b.cy + ny * off; let t0 = -Rr, guard = 0;
      while (t0 < Rr && guard++ < 400) {
        const len = segLen * (0.6 + hash(li, Math.floor((t0 + Rr) / segLen), seed + 5 * di) * 0.9), t1 = Math.min(Rr, t0 + len);
        const mx = ox + (c * (t0 + t1)) / 2, my = oy + (s * (t0 + t1)) / 2, dens = shade ? shade(mx, my) : 1;
        if (hash(li, Math.floor(t0), seed + 11) < dens * (0.55 + margin) || shade == null) {
          const j = (k) => noise1(li * 0.7 + k, seed * 3 + boil * 5) * jitter, bi = Math.min(2, Math.floor(hash(li, Math.floor(t0), seed + 7) * 3)), pa = buckets[bi]; used[bi] = true;
          pa.moveTo(ox + c * t0 + nx * j(0), oy + s * t0 + ny * j(0));
          pa.quadraticCurveTo(ox + (c * (t0 + t1)) / 2 + nx * j(1) * 1.5, oy + (s * (t0 + t1)) / 2 + ny * j(1) * 1.5, ox + c * t1 + nx * j(2), oy + s * t1 + ny * j(2));
        }
        t0 = t1 + gap * (0.15 + hash(li, Math.floor(t0), seed + 13) * 0.6);
      }
    }
  });
  for (let k = 0; k < 3; k++) if (used[k]) { ctx.globalAlpha = alpha * (0.6 + 0.4 * ((k + 0.5) / 3)); ctx.stroke(buckets[k]); }
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------------------------------
// painters
// ---------------------------------------------------------------------------------------------------------------------
const DARK = '#14121A';
function palOf(o) {
  return { blade: C.vermilion, bladeAlt: C.amber, face: C.cream, ink: C.graphite, eye: C.ink, ...(o.palette || {}) };
}
const bladeCol = (pal, k) => (k % 2 ? pal.bladeAlt : pal.blade);


// soft cheek blush on the play-plate when she is happy (o.blush overrides: 0..1)
function drawBlush(ctx, F, o, pal) {
  if (o.noEyes || o.style === 'line') return;
  const amt = o.blush != null ? o.blush : clamp((F.eyes[0].sh.happy - 0.35) / 0.65, 0, 1) * 0.9;
  if (amt < 0.03) return;
  const col = o.style === 'phone' ? '#FF7A6E' : C.vermilion;
  for (const side of [-1, 1]) {
    const c = F.pr(0.17, side * 0.21, Z_PLATE + 0.004), rx = F.R * 0.085 * F.sx, ry = F.R * 0.055 * F.sy;
    ctx.save(); ctx.translate(c[0], c[1]); ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, P.rgba(col, 0.55 * amt)); g.addColorStop(0.6, P.rgba(col, 0.28 * amt)); g.addColorStop(1, P.rgba(col, 0));
    if (o.style === 'ink') ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rx, 0, TAU); ctx.fill(); ctx.restore();
  }
}

// ---- hand-drawn (ink / line) ---------------------------------------------------------------------------------------
function renderHand(ctx, F, o, pal, boil, seed) {
  const R = F.R, line = o.style === 'line';
  const k = clamp(R / 220, 0.42, 2.4), iw = Math.max(1.7, R * 0.021) * (line ? 1.08 : 1), amp = 1.45 * Math.pow(k, 0.7), step = clamp(9 * k, 4.5, 16);
  const inkC = pal.ink;
  const ink = (pts, x = {}) => P.ink(ctx, pts, { color: inkC, width: iw, amp, boil, step, seed: seed + (x.s || 0), passes: 2, ...x });
  const off = [R * 0.016, R * 0.012], off2 = [R * 0.011, R * 0.009];
  const hg = R * 0.048, hw = Math.max(1, R * 0.0055), seg = clamp(R * 0.16, 9, 40);
  const light = [-0.55, -0.8];
  const shadeFn = (cx0, cy0) => (x, y) => clamp(0.35 + 0.9 * (((x - cx0) * -light[0] + (y - cy0) * -light[1]) / R), 0.1, 1);
  // 1) thickness edge
  const bandCol = P.mix(C.graphite, '#4B2A3A', 0.35);
  if (F.band) {
    if (!line) P.fill(ctx, F.band, { color: bandCol, offset: off2, boil, amp, seed: seed + 1, comp: 'source-over' });
    else { ctx.save(); ctx.fillStyle = '#F3EBDB'; path(ctx, F.band); ctx.fill(); ctx.globalAlpha = 0.78; ctx.fillStyle = inkC; path(ctx, F.band); ctx.fill(); ctx.restore(); }
    hatchB(ctx, F.band, { color: line ? inkC : '#0E0D12', gap: R * (line ? 0.03 : 0.035), width: hw * (line ? 1.4 : 1.1), alpha: line ? 0.85 : 0.55, angle: 0.5 + F.yaw * 0.3, boil, seed: seed + 2, comp: 'source-over', cross: line ? 1 : 0, segLen: seg, jitter: 0.8 });
    ink(F.band, { s: 3 });
  }
  // 2) pale base under the blades (so mis-registered fills never expose the dark edge)
  ctx.save(); ctx.fillStyle = line ? '#F6EFE0' : '#FFE9B4'; path(ctx, F.front); ctx.fill(); ctx.restore();
  // 3) blades
  const cc = centroid(F.front);
  F.blades.forEach((b) => {
    const col = bladeCol(pal, b.k), cen = centroid(b.pts), even = b.k % 2 === 0;
    const ang = Math.atan2(F.seams[b.k][1][1] - F.seams[b.k][0][1], F.seams[b.k][1][0] - F.seams[b.k][0][0]);
    if (!line) {
      P.fill(ctx, b.pts, { color: col, offset: off, boil, amp, seed: seed + 10 + b.k, comp: 'source-over' });
      // pale lit side (light pencil) then dark pencil on the shadow side
      hatchB(ctx, b.pts, { color: '#FFF3D6', gap: hg * 1.15, width: hw * 1.6, alpha: 0.5, angle: ang + 0.12, boil, seed: seed + 20 + b.k, comp: 'source-over', shade: (x, y) => clamp(1.15 - shadeFn(cc[0], cc[1])(x, y) * 1.1, 0, 1), margin: 0.1, segLen: seg, jitter: 0.8 });
      hatchB(ctx, b.pts, { color: P.darken(col, 0.38), gap: hg, width: hw * 1.15, alpha: 0.55, angle: ang + 0.12, boil, seed: seed + 30 + b.k, shade: shadeFn(cc[0], cc[1]), margin: 0.15, segLen: seg, jitter: 0.8 });
    } else {
      hatchB(ctx, b.pts, { color: inkC, gap: R * (even ? 0.032 : 0.085), width: hw * (even ? 1.35 : 1.0), alpha: even ? 0.88 : 0.6, angle: ang + 0.1, boil, seed: seed + 30 + b.k, comp: 'source-over', segLen: seg, jitter: 0.8 });
      if (even) hatchB(ctx, b.pts, { color: inkC, gap: R * 0.05, width: hw * 1.1, alpha: 0.7, angle: ang + 1.1, boil, seed: seed + 40 + b.k, comp: 'source-over', segLen: seg, jitter: 0.8 });
      else hatchB(ctx, b.pts, { color: inkC, gap: R * 0.07, width: hw, alpha: 0.5, angle: ang + 1.1, boil, seed: seed + 40 + b.k, comp: 'source-over', segLen: seg, jitter: 0.8, shade: shadeFn(cc[0], cc[1]), margin: 0.0 });
    }
    // seam shadow: the blade is tucked under its pinwheel neighbour -> soft graphite smudge along the seam
    const s = F.seams[b.k], dx = s[1][0] - s[0][0], dy = s[1][1] - s[0][1], L = Math.hypot(dx, dy) || 1; let nx = -dy / L, ny = dx / L;
    if ((cen[0] - s[0][0]) * nx + (cen[1] - s[0][1]) * ny < 0) { nx = -nx; ny = -ny; }
    const w = R * 0.11, g = ctx.createLinearGradient(s[0][0], s[0][1], s[0][0] + nx * w, s[0][1] + ny * w);
    g.addColorStop(0, P.rgba(line ? C.graphite : P.darken(col, 0.55), line ? 0.0 : 0.5)); g.addColorStop(1, P.rgba(P.darken(col, 0.5), 0));
    ctx.save(); path(ctx, b.pts); ctx.clip(); ctx.fillStyle = g; ctx.globalCompositeOperation = 'multiply'; ctx.fillRect(cen[0] - R * 1.3, cen[1] - R * 1.3, R * 2.6, R * 2.6); ctx.restore();
  });
  // 4) the hole
  if (!line) P.fill(ctx, F.hex, { color: DARK, offset: off2, boil, amp, seed: seed + 50, comp: 'source-over' });
  else { P.fill(ctx, F.hex, { color: inkC, offset: [0, 0], boil, amp: amp * 0.8, seed: seed + 50, comp: 'source-over', alpha: 0.93 }); }
  // inner depth: lighter rim just inside the hole (a pencil highlight on the bottom edge), subtle
  // 5) ink: outer circle, seams, hexagon
  ink(F.front, { s: 60, width: iw * 1.12 });
  F.seams.forEach((s, i) => ink(s, { closed: false, s: 70 + i * 5, width: iw * 0.92, taper: true, amp: amp * 0.9 }));
  ink(F.hex, { s: 90, width: iw * 0.95 });
  // 6) plate: cast shadow on the hole, thickness, face
  const tsh = F.triShadow.map((p) => [p[0] + R * 0.03, p[1] + R * 0.045]);
  ctx.save(); ctx.beginPath(); path(ctx, F.hex); ctx.clip(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = 'rgba(0,0,0,0.55)'; path(ctx, tsh); ctx.fill(); ctx.restore();
  const ptC = P.mix(pal.face, '#C99A5A', 0.55);
  P.fill(ctx, F.triBand, { color: ptC, offset: [0, 0], boil, amp: amp * 0.6, seed: seed + 100, comp: 'source-over' });
  ink(F.triBand, { s: 101, width: iw * 0.8, amp: amp * 0.8 });
  P.fill(ctx, F.tri, { color: line ? '#FBF6EA' : pal.face, offset: [R * 0.012, R * 0.009], boil, amp: amp * 0.7, seed: seed + 102, comp: 'source-over' });
  if (!line) hatchB(ctx, F.tri, { color: '#D9B77C', gap: R * 0.052, width: hw, alpha: 0.4, angle: 2.2, boil, seed: seed + 103, comp: 'multiply', shade: (x, y) => clamp(0.25 + 0.9 * (((x - cc[0]) * -light[0] + (y - cc[1]) * -light[1]) / R), 0, 1), margin: 0.1, segLen: seg * 0.8, jitter: 0.6 });
  else hatchB(ctx, F.tri, { color: inkC, gap: R * 0.085, width: hw * 0.9, alpha: 0.4, angle: 2.2, boil, seed: seed + 103, comp: 'source-over', shade: (x, y) => clamp(0.05 + 0.8 * (((x - cc[0]) * -light[0] + (y - cc[1]) * -light[1]) / R), 0, 1), margin: 0, segLen: seg * 0.8, jitter: 0.6 });
  ink(F.tri, { s: 104, width: iw * 0.88, amp: amp * 0.8 });
  // 7) eyes
  drawBlush(ctx, F, o, pal);
  if (!o.noEyes) F.eyes.forEach((E, i) => handEye(ctx, F, E, o, pal, boil, seed, iw, amp));
  // 8) rim light (a pencil highlight along the upper-left of the disc)
  const rimPts = arcPts(F.front.map((p) => [p[0] * 0.93, p[1] * 0.93]), Math.PI * 1.06, Math.PI * 1.62);
  ctx.save(); ctx.globalAlpha = 0.7; P.ink(ctx, rimPts, { closed: false, color: '#FFF8E8', width: R * 0.03, amp: amp * 0.5, boil, seed: seed + 120, passes: 1, step, taper: true, alpha: 0.85 }); ctx.restore();
}
function handEye(ctx, F, E, o, pal, boil, seed, iw, amp) {
  const R = F.R, sh = E.sh;
  ctx.save(); ctx.fillStyle = pal.eye; path(ctx, E.pts); ctx.fill(); ctx.restore();
  P.ink(ctx, E.pts, { color: pal.eye, width: Math.max(1.5, R * 0.012), amp: amp * 0.35, boil, seed: seed + 130 + E.side, passes: 1, step: 5 });
  if (sh.happy > 0.55) { // arches are drawn as heavy pen strokes: add a second pass for ink weight
    P.ink(ctx, E.pts, { color: pal.eye, width: Math.max(2, R * 0.02), amp: amp * 0.5, boil, seed: seed + 140 + E.side, passes: 1, step: 5 });
  }
  if (sh.glintA > 0.02) {
    ctx.save(); ctx.globalAlpha = sh.glintA; ctx.fillStyle = '#FFFFFF'; path(ctx, E.glint); ctx.fill(); path(ctx, E.glint2); ctx.fill(); ctx.restore();
    // cool reflection crescent at the bottom (glossy)
    ctx.save(); ctx.globalAlpha = 0.35 * sh.glintA; ctx.strokeStyle = '#7CC4FF'; ctx.lineWidth = Math.max(1, R * 0.008); ctx.lineCap = 'round';
    const c = E.c, n = E.pts.length; ctx.beginPath(); for (let i = Math.floor(n * 0.62); i <= Math.floor(n * 0.88); i++) { const p = E.pts[i % n], q = [c[0] + (p[0] - c[0]) * 0.72, c[1] + (p[1] - c[1]) * 0.72]; i === Math.floor(n * 0.62) ? ctx.moveTo(q[0], q[1]) : ctx.lineTo(q[0], q[1]); } ctx.stroke(); ctx.restore();
  }
}

// ---- vector (clean / phone / glow) ---------------------------------------------------------------------------------
function renderVector(ctx, F, o, pal, boil, seed, px) {
  const R = F.R, phone = o.style === 'phone', glow = o.style === 'glow';
  const lw = Math.max(1, R * 0.012);
  const dk = (c, t) => P.darken(c, t), lt = (c, t) => P.lighten(c, t);
  const grad = (x0, y0, x1, y1, stops) => { const g = ctx.createLinearGradient(x0, y0, x1, y1); stops.forEach(([t, c]) => g.addColorStop(t, c)); return g; };
  const cc = centroid(F.front);
  if (phone) { // sticker border + flat drop shadow
    ctx.save(); ctx.fillStyle = 'rgba(20,16,30,0.22)'; ctx.translate(R * 0.035, R * 0.06); path(ctx, F.silo); ctx.fill(); ctx.restore();
    ctx.save(); ctx.lineJoin = 'round'; ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = R * 0.12; ctx.fillStyle = '#FFFFFF'; path(ctx, F.silo); ctx.stroke(); ctx.fill(); ctx.restore();
  }
  // thickness edge
  const bandA = P.mix(C.graphite, '#4B2A3A', 0.3);
  if (F.band) {
    const dx = F.back[0][0] - F.front[0][0], dy = F.back[0][1] - F.front[0][1];
    ctx.save(); ctx.fillStyle = phone ? bandA : grad(cc[0], cc[1], cc[0] + dx * 3, cc[1] + dy * 3, [[0, '#4A3448'], [1, '#1C1722']]);
    path(ctx, F.band); ctx.fill(); ctx.restore();
    if (!phone) { ctx.save(); ctx.strokeStyle = 'rgba(255,200,150,0.35)'; ctx.lineWidth = lw * 0.9; ctx.lineJoin = 'round'; const bp = F.back; ctx.beginPath(); const n = bp.length; for (let i = Math.floor(n * 0.30); i <= Math.floor(n * 0.62); i++) { const p = bp[i % n]; i === Math.floor(n * 0.30) ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1]); } ctx.stroke(); ctx.restore(); }
  }
  // base disc (hides AA seams)
  ctx.save(); ctx.fillStyle = pal.blade; path(ctx, F.front); ctx.fill(); ctx.restore();
  // blades
  F.blades.forEach((b) => {
    const col = bladeCol(pal, b.k), tip = F.seams[b.k][0], cen = centroid(b.pts);
    const far = b.pts[Math.floor(b.pts.length * 0.55)];
    let fill = col;
    if (!phone) {
      const ev = b.k % 2 === 0, inner = ev ? '#D83A17' : '#F29A14', outer = ev ? '#FF7A4A' : '#FFD468';
      fill = grad(tip[0], tip[1], far[0] * 1.0, far[1] * 1.0, [[0, inner], [0.5, col], [1, outer]]);
    }
    ctx.save(); ctx.fillStyle = fill; ctx.strokeStyle = fill; ctx.lineWidth = 1; ctx.lineJoin = 'round'; path(ctx, b.pts); ctx.fill(); ctx.stroke();
    if (!phone) { // seam shadow (tucked under its neighbour) + soft form shading
      ctx.clip();
      const s = F.seams[b.k], dx = s[1][0] - s[0][0], dy = s[1][1] - s[0][1], L = Math.hypot(dx, dy) || 1; let nx = -dy / L, ny = dx / L;
      if ((cen[0] - s[0][0]) * nx + (cen[1] - s[0][1]) * ny < 0) { nx = -nx; ny = -ny; }
      const w = R * 0.16, g = ctx.createLinearGradient(s[0][0], s[0][1], s[0][0] + nx * w, s[0][1] + ny * w);
      g.addColorStop(0, P.rgba(dk(col, 0.62), 0.42)); g.addColorStop(1, P.rgba(dk(col, 0.62), 0)); ctx.fillStyle = g; ctx.fillRect(cen[0] - R * 1.3, cen[1] - R * 1.3, R * 2.6, R * 2.6);
      const gs = ctx.createLinearGradient(cc[0] - R * 0.7, cc[1] - R * 0.9, cc[0] + R * 0.7, cc[1] + R * 0.9); gs.addColorStop(0, 'rgba(255,255,255,0.16)'); gs.addColorStop(0.5, 'rgba(255,255,255,0)'); gs.addColorStop(1, 'rgba(60,10,0,0.26)');
      ctx.fillStyle = gs; ctx.fillRect(cen[0] - R * 1.3, cen[1] - R * 1.3, R * 2.6, R * 2.6);
    }
    ctx.restore();
  });
  // seams + outer line
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = phone ? 'rgba(42,40,51,0.45)' : 'rgba(60,12,0,0.38)'; ctx.lineWidth = lw * (phone ? 1.4 : 1.0);
  F.seams.forEach((s) => { ctx.beginPath(); ctx.moveTo(s[0][0], s[0][1]); ctx.lineTo(s[1][0], s[1][1]); ctx.stroke(); });
  ctx.strokeStyle = phone ? C.graphite : 'rgba(42,40,51,0.85)'; ctx.lineWidth = lw * (phone ? 1.5 : 1.15); path(ctx, F.front); ctx.stroke(); ctx.restore();
  // hole
  ctx.save(); ctx.fillStyle = phone ? DARK : (() => { const g = ctx.createRadialGradient(cc[0], cc[1], 0, cc[0], cc[1], R * 0.7); g.addColorStop(0, '#0F0D14'); g.addColorStop(1, '#2B2535'); return g; })(); path(ctx, F.hex); ctx.fill();
  if (!phone) { ctx.clip(); ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = lw * 1.4; path(ctx, F.hex); ctx.stroke(); }
  ctx.restore();
  // plate: cast shadow, thickness, face
  ctx.save(); path(ctx, F.hex); ctx.clip();
  ctx.fillStyle = phone ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.5)'; ctx.translate(R * 0.025, R * 0.04); path(ctx, F.triShadow); ctx.fill(); ctx.restore();
  ctx.save(); ctx.fillStyle = P.mix(pal.face, '#C99A5A', 0.5); path(ctx, F.triBand); ctx.fill(); ctx.restore();
  ctx.save();
  const tb = P.bounds(F.tri);
  ctx.fillStyle = phone ? pal.face : grad(tb.x, tb.y, tb.x1, tb.y1, [[0, '#FFFDF4'], [0.45, pal.face], [1, '#F1D9A8']]);
  path(ctx, F.tri); ctx.fill();
  ctx.strokeStyle = phone ? 'rgba(42,40,51,0.55)' : 'rgba(180,130,70,0.55)'; ctx.lineWidth = lw * 0.9; ctx.lineJoin = 'round'; path(ctx, F.tri); ctx.stroke(); ctx.restore();
  // eyes
  drawBlush(ctx, F, o, pal);
  if (!o.noEyes) F.eyes.forEach((E) => vectorEye(ctx, F, E, pal, phone, glow));
  // gloss highlight: a thin white arc along the upper-left rim
  if (!phone) {
    const rimPts = arcPts(F.front.map((p) => [p[0] * 0.925, p[1] * 0.925]), Math.PI * 1.04, Math.PI * 1.6);
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = R * 0.035; ctx.beginPath(); rimPts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke(); ctx.restore();
  }
}
function vectorEye(ctx, F, E, pal, phone, glow) {
  const R = F.R, sh = E.sh;
  ctx.save();
  if (!phone && sh.happy < 0.5) { const b = P.bounds(E.pts), g = ctx.createLinearGradient(0, b.y, 0, b.y1); g.addColorStop(0, '#0B0A10'); g.addColorStop(0.6, pal.eye); g.addColorStop(1, '#262B3C'); ctx.fillStyle = g; } else ctx.fillStyle = pal.eye;
  path(ctx, E.pts); ctx.fill();
  if (sh.happy > 0.4) { ctx.strokeStyle = pal.eye; ctx.lineWidth = R * 0.012; ctx.lineJoin = 'round'; path(ctx, E.pts); ctx.stroke(); }
  if (sh.glintA > 0.02) { ctx.globalAlpha = sh.glintA; ctx.fillStyle = '#FFFFFF'; path(ctx, E.glint); ctx.fill(); path(ctx, E.glint2); ctx.fill(); }
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------------------------------
// shadows
// ---------------------------------------------------------------------------------------------------------------------
function drawShadow(ctx, o, x, y, R, sy, style, px) {
  const sh = o.shadow; if (sh === false) return;
  const so = typeof sh === 'object' ? sh : {};
  const gy = so.y != null ? y + so.y : (o.groundY != null ? o.groundY : y + R * 1.32 * sy);
  const hgt = Math.max(0, gy - y - R * sy), k = 1 / (1 + hgt / (R * 3.2)), w = R * 0.95 * k * (so.w ?? 1), a = (so.a ?? 1) * k;
  ctx.save(); ctx.translate(x, gy); ctx.scale(1, 0.2);
  if (style === 'ink' || style === 'line') {
    P.smudge(ctx, 0, 0, w * 1.15, { color: C.graphite, alpha: 0.30 * a }); P.smudge(ctx, 0, 0, w * 0.62, { color: C.graphite, alpha: 0.22 * a });
  } else if (style === 'hologram') {
    ctx.globalCompositeOperation = 'lighter'; const g = ctx.createRadialGradient(0, 0, w * 0.2, 0, 0, w * 1.1); g.addColorStop(0, 'rgba(31,181,166,0)'); g.addColorStop(0.7, `rgba(31,181,166,${0.35 * a})`); g.addColorStop(1, 'rgba(31,181,166,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, w * 1.1, 0, TAU); ctx.fill();
  } else {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 1.15); g.addColorStop(0, `rgba(8,6,14,${0.55 * a})`); g.addColorStop(0.55, `rgba(8,6,14,${0.28 * a})`); g.addColorStop(1, 'rgba(8,6,14,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, w * 1.15, 0, TAU); ctx.fill();
  }
  ctx.restore();
}


// ---- hologram ------------------------------------------------------------------------------------------------------
function renderHolo(ctx, F, o, pal, boil, seed, T) {
  const R = F.R, hue = o.hue || C.teal, bright = P.lighten(hue, 0.5), hot = P.lighten(hue, 0.88);
  const fl = 0.8 + 0.2 * (noise1(boil * 0.9, seed) * 0.5 + 0.5), lw = Math.max(1.1, R * 0.011);
  const b = P.bounds(F.silo);
  const vg = (a0, a1, col) => { const g = ctx.createLinearGradient(0, b.y, 0, b.y1); g.addColorStop(0, P.rgba(col, a0)); g.addColorStop(1, P.rgba(col, a1)); return g; };
  const edge = (pts, closed = true, a = 1, w = lw, col = bright) => {
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; path(ctx, pts, closed);
    ctx.strokeStyle = P.rgba(col, 0.07 * a); ctx.lineWidth = w * 6; ctx.stroke();
    ctx.strokeStyle = P.rgba(col, 0.22 * a); ctx.lineWidth = w * 2.6; ctx.stroke();
    ctx.strokeStyle = P.rgba(col, 0.9 * a); ctx.lineWidth = w; ctx.stroke();
  };
  const body = (alpha) => {
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha *= alpha;
    if (F.band) { ctx.fillStyle = vg(0.10, 0.2, hue); path(ctx, F.band); ctx.fill(); edge(F.band, true, 0.55, lw * 0.9, hue); }
    F.blades.forEach((bl) => { ctx.fillStyle = vg(bl.k % 2 ? 0.20 : 0.10, bl.k % 2 ? 0.46 : 0.28, hue); path(ctx, bl.pts); ctx.fill(); });
    edge(F.front, true, 1, lw * 1.2);
    F.seams.forEach((s) => edge(s, false, 0.7, lw * 0.9, hue));
    edge(F.hex, true, 0.85, lw);
    ctx.fillStyle = vg(0.35, 0.65, bright); path(ctx, F.tri); ctx.fill(); edge(F.triBand, true, 0.8, lw * 0.9, hue); edge(F.tri, true, 1, lw, hot);
    F.eyes.forEach((E) => { const g = ctx.createRadialGradient(E.c[0], E.c[1], 0, E.c[0], E.c[1], R * 0.18); g.addColorStop(0, P.rgba(hot, 0.5)); g.addColorStop(1, P.rgba(hot, 0)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(E.c[0], E.c[1], R * 0.18, 0, TAU); ctx.fill(); ctx.fillStyle = P.rgba('#FFFFFF', 0.95); path(ctx, E.pts); ctx.fill(); });
    ctx.restore();
  };
  ctx.save(); ctx.globalAlpha *= fl;
  body(1);
  // scanlines + a moving scan band, clipped to the silhouette
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; path(ctx, F.silo); ctx.clip();
  const sp = Math.max(2.4, R * 0.048); ctx.fillStyle = P.rgba(bright, 0.10);
  for (let y = b.y - ((b.y % sp) + sp) % sp; y < b.y1; y += sp) ctx.fillRect(b.x - 2, y, b.w + 4, Math.max(1, sp * 0.32));
  const yb = b.y + ((((T && T.t) || 0) * 0.45) % 1.3 - 0.15) * b.h, g = ctx.createLinearGradient(0, yb - R * 0.25, 0, yb + R * 0.25); g.addColorStop(0, P.rgba(hot, 0)); g.addColorStop(0.5, P.rgba(hot, 0.28)); g.addColorStop(1, P.rgba(hot, 0));
  ctx.fillStyle = g; ctx.fillRect(b.x - 2, yb - R * 0.25, b.w + 4, R * 0.5); ctx.restore();
  // glitch slice (a few frames per second, deterministic)
  const gk = Math.floor(boil / 3), gh = hash(gk, seed, 5);
  if (gh > 0.82) {
    const gy = (hash(gk, seed, 6) * 1.5 - 0.75) * R, gH = R * (0.05 + 0.1 * hash(gk, seed, 7)), dx = (hash(gk, seed, 8) > 0.5 ? 1 : -1) * R * (0.04 + 0.07 * hash(gk, seed, 9));
    ctx.save(); ctx.beginPath(); ctx.rect(-R * 1.5, gy, R * 3, gH); ctx.clip(); ctx.translate(dx, 0); body(0.9); ctx.restore();
  }
  ctx.restore();
}

// ---- glow: halo + emissive extras around the vector body -------------------------------------------------------------
function glowBefore(ctx, F, o, T, boil, seed) {
  const R = F.R, gc = o.glow || C.amber, pulse = 0.88 + 0.12 * Math.sin(((T && T.t) || 0) * 2.4);
  const mid = P.mix(gc, C.violet, 0.55);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(0, 0, R * 0.8, 0, 0, R * 2.6 * pulse);
  g.addColorStop(0, P.rgba(gc, 0.62)); g.addColorStop(0.3, P.rgba(mid, 0.28)); g.addColorStop(1, P.rgba(mid, 0));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R * 2.6 * pulse, 0, TAU); ctx.fill(); ctx.restore();
}
function glowAfter(ctx, F, o, T, boil, seed) {
  const R = F.R, gc = o.glow || C.amber, t = (T && T.t) || 0;
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  path(ctx, F.front); ctx.strokeStyle = P.rgba(gc, 0.10); ctx.lineWidth = R * 0.09; ctx.stroke(); ctx.strokeStyle = P.rgba('#FFF3D6', 0.28); ctx.lineWidth = R * 0.022; ctx.stroke();
  F.seams.forEach((s) => { ctx.beginPath(); ctx.moveTo(s[0][0], s[0][1]); ctx.lineTo(s[1][0], s[1][1]); ctx.strokeStyle = P.rgba('#FFE6A8', 0.22); ctx.lineWidth = R * 0.012; ctx.stroke(); });
  // plate bloom
  const c = centroid(F.tri), pg = ctx.createRadialGradient(c[0], c[1], 0, c[0], c[1], R * 0.7); pg.addColorStop(0, 'rgba(255,243,214,0.20)'); pg.addColorStop(1, 'rgba(255,243,214,0)'); ctx.fillStyle = pg; path(ctx, F.hex); ctx.fill();
  // drifting light motes
  for (let i = 0; i < 9; i++) {
    const a = hash(i, seed, 1) * TAU + t * (0.18 + 0.1 * hash(i, seed, 2)), r = R * (1.15 + 0.7 * hash(i, seed, 3)), tw = 0.5 + 0.5 * Math.sin(t * (2 + 3 * hash(i, seed, 4)) + i * 2);
    const mx = Math.cos(a) * r, my = Math.sin(a) * r * 0.85 - (((t * 0.15 + hash(i, seed, 5)) % 1) - 0.5) * R * 0.4, mr = R * (0.012 + 0.02 * hash(i, seed, 6));
    const mg = ctx.createRadialGradient(mx, my, 0, mx, my, mr * 4); mg.addColorStop(0, P.rgba('#FFF3D6', 0.9 * tw)); mg.addColorStop(1, P.rgba(gc, 0)); ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(mx, my, mr * 4, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------------------------------
// prop painter — one small API over the six styles (hand / clean / phone / hologram / glow)
// ---------------------------------------------------------------------------------------------------------------------
const lum = (c) => { const [r, g, b] = P.hex2rgb(c); return (0.3 * r + 0.59 * g + 0.11 * b) / 255; };
function mkPP(ctx, style, boil, seed, s, pal) {
  const hand = style === 'ink' || style === 'line', holo = style === 'hologram', flat = style === 'phone';
  const iw = Math.max(1.6, s * 0.034), amp = 1.25 * clamp(s / 130, 0.4, 2), step = clamp((8 * s) / 130, 4, 14);
  let n = 0;
  const pp = {
    hand, holo, flat, iw, s, style,
    poly(pts, col, x = {}) {
      const sd = seed + 13 * ++n, { ink = true, hatchC = null, gap = s * 0.06, ang = 0.7, col2 = null, w = iw, alpha = 1, closed = true, dir = [0, 1] } = x;
      const hw = Math.max(1, s * 0.0085);
      if (hand) {
        if (style === 'ink') {
          if (col) P.fill(ctx, pts, { color: col, offset: [s * 0.018, s * 0.013], boil, amp, seed: sd, comp: 'source-over', alpha });
          if (hatchC) hatchB(ctx, pts, { color: hatchC, gap, width: hw, alpha: 0.5, angle: ang, boil, seed: sd + 1, segLen: s * 0.3, jitter: 0.8 });
        } else if (col) {
          const L = lum(col);
          if (L < 0.32) hatchB(ctx, pts, { color: pal.ink, gap: s * 0.036, width: hw * 1.3, alpha: 0.85, angle: ang, cross: 1, comp: 'source-over', boil, seed: sd + 1, segLen: s * 0.3, jitter: 0.6 });
          else if (L < 0.75) hatchB(ctx, pts, { color: pal.ink, gap: s * (0.045 + 0.09 * ((L - 0.32) / 0.43)), width: hw, alpha: 0.6, angle: ang, comp: 'source-over', boil, seed: sd + 1, segLen: s * 0.3, jitter: 0.6 });
        }
        if (ink && ink !== 'none') P.ink(ctx, pts, { closed, color: pal.ink, width: w, amp, boil, step, seed: sd + 2, passes: 2 });
      } else if (holo) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        if (col && closed) { ctx.fillStyle = P.rgba(P.mix(C.teal, '#FFFFFF', 0.3), 0.06 + 0.2 * lum(col)); path(ctx, pts); ctx.fill(); }
        if (ink && ink !== 'none') { path(ctx, pts, closed); ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(93,242,224,0.2)'; ctx.lineWidth = w * 3.5; ctx.stroke(); ctx.strokeStyle = 'rgba(160,255,240,0.9)'; ctx.lineWidth = w * 0.6; ctx.stroke(); }
        ctx.restore();
      } else {
        ctx.save();
        if (col && closed) {
          if (col2 && !flat) { const b = P.bounds(pts), g = ctx.createLinearGradient(b.cx - dir[0] * b.w / 2, b.cy - dir[1] * b.h / 2, b.cx + dir[0] * b.w / 2, b.cy + dir[1] * b.h / 2); g.addColorStop(0, col); g.addColorStop(1, col2); ctx.fillStyle = g; }
          else ctx.fillStyle = col;
          ctx.globalAlpha *= alpha; path(ctx, pts); ctx.fill(); ctx.globalAlpha /= alpha;
        }
        if (ink && ink !== 'none') { ctx.lineJoin = 'round'; ctx.lineCap = 'round'; path(ctx, pts, closed); ctx.strokeStyle = flat ? pal.ink : 'rgba(30,24,36,0.82)'; ctx.lineWidth = Math.max(1, w * (flat ? 0.75 : 0.55)); ctx.stroke(); }
        ctx.restore();
      }
    },
    circle(cx, cy, r, col, x = {}) { pp.poly(P.circlePts(cx, cy, r, clamp(Math.round(r * 0.8), 14, 34)), col, x); },
    ellipse(cx, cy, rx, ry, col, x = {}) { pp.poly(P.ellipsePts(cx, cy, rx, ry, x.rot || 0, 26), col, x); },
    rect(x0, y0, w, h, rad, col, x = {}) { pp.poly(P.rectPts(x0, y0, w, h, rad), col, x); },
    // open polyline (pen line)
    line(pts, x = {}) {
      const { color = pal.ink, width = iw, alpha = 1, taper = false } = x, sd = seed + 13 * ++n;
      if (hand) P.ink(ctx, pts, { closed: false, color, width, amp: amp * 0.8, boil, step, seed: sd, passes: x.passes ?? 2, taper, alpha });
      else if (holo) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; path(ctx, pts, false); ctx.strokeStyle = 'rgba(93,242,224,0.2)'; ctx.lineWidth = width * 3.5; ctx.stroke(); ctx.strokeStyle = 'rgba(180,255,245,0.9)'; ctx.lineWidth = width * 0.7; ctx.stroke(); ctx.restore(); }
      else { ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha *= alpha; path(ctx, pts, false); ctx.strokeStyle = color; ctx.lineWidth = width * (flat ? 0.9 : 0.8); ctx.stroke(); ctx.restore(); }
    },
    // light gloss streak
    gloss(pts, a = 0.5, w = s * 0.03) { if (hand && style === 'line') return; ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha *= a; path(ctx, pts, false); ctx.strokeStyle = holo ? 'rgba(200,255,250,1)' : '#FFFFFF'; ctx.lineWidth = w; ctx.stroke(); ctx.restore(); },
  };
  return pp;
}
const WOOD = '#8A5A3B', WOOD_D = '#5A3624', STEEL = '#CFCBD6', NAVY = '#1B1730';
const rot2 = (pts, a, cx = 0, cy = 0) => { const c = Math.cos(a), sn = Math.sin(a); return pts.map(([x, y]) => [cx + (x - cx) * c - (y - cy) * sn, cy + (x - cx) * sn + (y - cy) * c]); };
const sc = (pts, s) => pts.map(([x, y]) => [x * s, y * s]);
function star4(cx, cy, r, ri = 0.28, rot = 0) { const pts = []; for (let i = 0; i < 8; i++) { const a = rot + (i * Math.PI) / 4 - Math.PI / 2, rr = i % 2 ? r * ri : r; pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]); } return pts; }
const tri3 = (a, b, c) => [a, b, c];

// ---------------------------------------------------------------------------------------------------------------------
// PROPS — each drawn in local coordinates, s = size (about the half-width of the object). Facing right (mouth / lens outward).
// ---------------------------------------------------------------------------------------------------------------------
const PROPS = {
  // ---- hand-crank camera ----
  crank(pp, ctx, s, a, T) {
    const t = a.t || 0, ang = a.crank ?? t * 8, reel = a.reel ?? ang * 0.5;
    const reelFn = (cx, cy, r, rot, col) => {
      pp.circle(cx * s, cy * s, r * s, col, { hatchC: P.darken(col, 0.4), ang: 0.9 });
      pp.circle(cx * s, cy * s, r * 0.78 * s, null, { ink: true, w: pp.iw * 0.55 });
      for (let i = 0; i < 4; i++) { const th = rot + (i * TAU) / 4, hx = cx + Math.cos(th) * r * 0.46, hy = cy + Math.sin(th) * r * 0.46; pp.circle(hx * s, hy * s, r * 0.15 * s, C.cream, { w: pp.iw * 0.55 }); }
      pp.circle(cx * s, cy * s, r * 0.14 * s, C.graphite, { w: pp.iw * 0.6 });
    };
    // reels (behind the body)
    reelFn(-0.34, -0.60, 0.25, reel, C.amber); reelFn(0.18, -0.60, 0.25, -reel * 1.0 + 0.5, P.lighten(C.amber, 0.25));
    // film path
    pp.line([[-0.34 * s, -0.35 * s], [-0.22 * s, -0.31 * s], [-0.05 * s, -0.35 * s], [0.18 * s, -0.35 * s]], { color: C.graphite, width: pp.iw * 0.9, passes: 1 });
    // body
    pp.poly(P.rectPts(-0.64 * s, -0.31 * s, 1.08 * s, 0.66 * s, 0.07 * s), WOOD, { hatchC: WOOD_D, gap: s * 0.055, ang: 0.15, col2: WOOD_D, dir: [0, 1] });
    pp.rect(-0.64 * s, -0.31 * s, 1.08 * s, 0.09 * s, 0.03 * s, C.amber, { w: pp.iw * 0.8 });
    pp.rect(-0.64 * s, 0.27 * s, 1.08 * s, 0.08 * s, 0.03 * s, C.amber, { w: pp.iw * 0.8 });
    pp.circle(-0.18 * s, 0.03 * s, 0.11 * s, C.amber, { w: pp.iw * 0.8 }); pp.circle(-0.18 * s, 0.03 * s, 0.045 * s, C.graphite, { w: pp.iw * 0.5 });
    pp.rect(0.12 * s, -0.10 * s, 0.22 * s, 0.22 * s, 0.03 * s, C.cream, { w: pp.iw * 0.7 });
    // lens barrel
    pp.poly([[0.43 * s, -0.17 * s], [0.80 * s, -0.13 * s], [0.80 * s, 0.13 * s], [0.43 * s, 0.17 * s]], C.graphite, { col2: '#4a4660', dir: [0, 1] });
    pp.rect(0.77 * s, -0.17 * s, 0.09 * s, 0.34 * s, 0.03 * s, C.amber, { w: pp.iw * 0.8 });
    pp.ellipse(0.87 * s, 0, 0.04 * s, 0.14 * s, NAVY, { w: pp.iw * 0.6 });
    pp.circle(0.865 * s, -0.05 * s, 0.014 * s, '#FFFFFF', { ink: 'none' });
    pp.gloss([[0.50 * s, -0.12 * s], [0.74 * s, -0.095 * s]], 0.5, s * 0.025);
    pp.gloss([[-0.58 * s, -0.19 * s], [0.38 * s, -0.19 * s]], 0.0, 1);
    // crank (on the side nearest her): hub + turning arm + knob
    const hx = -0.64 * s, hy = 0.02 * s, L = 0.36 * s, kx = hx + Math.cos(ang) * L, ky = hy + Math.sin(ang) * L;
    const nx = -Math.sin(ang) * 0.035 * s, ny = Math.cos(ang) * 0.035 * s;
    pp.poly([[hx + nx, hy + ny], [kx + nx, ky + ny], [kx - nx, ky - ny], [hx - nx, hy - ny]], C.amber, { w: pp.iw * 0.8 });
    pp.circle(hx, hy, 0.07 * s, P.lighten(C.amber, 0.2), { w: pp.iw * 0.8 });
    pp.circle(kx, ky, 0.075 * s, C.vermilion, { w: pp.iw * 0.8 });
    pp.circle(kx - 0.02 * s, ky - 0.02 * s, 0.02 * s, '#FFFFFF', { ink: 'none' });
  },
  // ---- megaphone ----
  megaphone(pp, ctx, s, a, T) {
    const t = a.t || 0, sound = a.sound ?? 0;
    const hy = (x) => 0.12 + ((x + 0.45) * 0.30) / 1.07;
    // sound arcs (behind)
    if (sound > 0.01) for (let i = 0; i < 3; i++) {
      const ph = (t * 1.6 + i / 3) % 1, r = (0.16 + ph * 0.62) * s, al = (1 - ph) * clamp(sound, 0, 1), cx0 = 0.74 * s;
      const pts = []; for (let k = 0; k <= 10; k++) { const th = -0.75 + (1.5 * k) / 10; pts.push([cx0 + Math.cos(th) * r, Math.sin(th) * r]); }
      pp.line(pts, { color: pp.hand ? C.vermilion : C.amber, width: pp.iw * 1.3 * (1 - ph * 0.4), alpha: al, passes: 1, taper: true });
    }
    // handle
    pp.poly(P.rectPts(-0.16 * s, 0.08 * s, 0.15 * s, 0.44 * s, 0.05 * s), C.graphite, { col2: '#46425a', dir: [1, 0] });
    pp.rect(-0.16 * s, 0.08 * s, 0.15 * s, 0.07 * s, 0.02 * s, C.amber, { w: pp.iw * 0.7 });
    // back cap + cone
    pp.ellipse(-0.45 * s, 0, 0.065 * s, 0.14 * s, C.graphite, { w: pp.iw * 0.8 });
    pp.poly([[-0.45 * s, -0.12 * s], [0.64 * s, -0.42 * s], [0.64 * s, 0.42 * s], [-0.45 * s, 0.12 * s]], C.vermilion, { hatchC: P.darken(C.vermilion, 0.4), gap: s * 0.055, ang: 0.28, col2: '#FF7447', dir: [1, 0] });
    const x1 = 0.20, x2 = 0.33; pp.poly([[x1 * s, -hy(x1) * s], [x2 * s, -hy(x2) * s], [x2 * s, hy(x2) * s], [x1 * s, hy(x1) * s]], C.cream, { w: pp.iw * 0.7 });
    pp.gloss([[-0.30 * s, -0.115 * s], [0.15 * s, -0.26 * s]], 0.55, s * 0.03);
    // mouth: rim + dark opening
    pp.ellipse(0.65 * s, 0, 0.075 * s, 0.43 * s, C.amber, { w: pp.iw });
    pp.ellipse(0.675 * s, 0, 0.05 * s, 0.35 * s, NAVY, { w: pp.iw * 0.6 });
    // trigger
    pp.circle(-0.085 * s, 0.045 * s, 0.035 * s, C.vermilion, { w: pp.iw * 0.6 });
  },
  // ---- viewfinder: the director's frame ----
  viewfinder(pp, ctx, s, a, T) {
    const t = a.t || 0, W = 0.78, H = 0.52, bl = 0.26, th = 0.075;
    // glass tint
    if (!pp.holo) pp.poly(P.rectPts(-W * s, -H * s, 2 * W * s, 2 * H * s, 0), pp.hand ? null : 'rgba(255,182,46,0.0)', { ink: 'none', hatchC: pp.hand && pp.style === 'ink' ? '#E9A21A' : null, gap: s * 0.11, ang: 0.8, alpha: 0.1 });
    // L-shaped corner brackets
    const corner = (sx, sy) => {
      const x0 = sx * W * s, y0 = sy * H * s, a0 = sx * bl * s, b0 = sy * bl * s * 0.8, tt = th * s;
      const pts = [[x0, y0], [x0 - a0, y0], [x0 - a0, y0 - sy * tt], [x0 - sx * tt, y0 - sy * tt], [x0 - sx * tt, y0 - b0], [x0, y0 - b0]];
      pp.poly(pts, C.amber, { w: pp.iw * 0.9, col2: '#FFD36B', dir: [sx, sy] });
    };
    corner(-1, -1); corner(1, -1); corner(-1, 1); corner(1, 1);
    // thin thirds + centre cross
    const thin = pp.hand ? C.graphite : 'rgba(255,243,214,0.55)';
    pp.line([[-W * s * 0.33, -H * s * 0.7], [-W * s * 0.33, H * s * 0.7]], { color: thin, width: pp.iw * 0.45, passes: 1, alpha: 0.5 });
    pp.line([[W * s * 0.33, -H * s * 0.7], [W * s * 0.33, H * s * 0.7]], { color: thin, width: pp.iw * 0.45, passes: 1, alpha: 0.5 });
    pp.line([[-W * s * 0.8, -H * s * 0.34], [W * s * 0.8, -H * s * 0.34]], { color: thin, width: pp.iw * 0.45, passes: 1, alpha: 0.5 });
    pp.line([[-W * s * 0.8, H * s * 0.34], [W * s * 0.8, H * s * 0.34]], { color: thin, width: pp.iw * 0.45, passes: 1, alpha: 0.5 });
    // focus box + cross (pulses)
    const f = 0.9 + 0.1 * Math.sin(t * 5), fb = 0.15 * s * f;
    const fbrk = (sx, sy) => pp.line([[sx * fb, sy * fb * 0.4], [sx * fb, sy * fb], [sx * fb * 0.4, sy * fb]], { color: pp.hand ? C.vermilion : '#FFF3D6', width: pp.iw * 0.95, passes: 1 });
    fbrk(-1, -1); fbrk(1, -1); fbrk(-1, 1); fbrk(1, 1);
    pp.line([[-0.04 * s, 0], [0.04 * s, 0]], { color: pp.hand ? C.vermilion : '#FFF3D6', width: pp.iw * 0.7, passes: 1 });
    pp.line([[0, -0.04 * s], [0, 0.04 * s]], { color: pp.hand ? C.vermilion : '#FFF3D6', width: pp.iw * 0.7, passes: 1 });
    // REC dot (blinks) + label
    const on = (Math.floor(t * 1.5) % 2) === 0 || a.rec;
    pp.circle((-W + 0.36) * s, (-H + 0.13) * s, 0.05 * s, on ? C.vermilion : P.mix(C.vermilion, C.graphite, 0.6), { w: pp.iw * 0.7 });
    { const m = ctx.getTransform(), mir = m.a * m.d - m.b * m.c < 0; ctx.save(); ctx.font = `700 ${Math.round(s * 0.11)}px Inter, sans-serif`; ctx.textBaseline = 'middle'; ctx.fillStyle = pp.hand ? C.graphite : '#FFF3D6'; ctx.globalAlpha *= pp.holo ? 0.9 : 0.95;
      ctx.translate((-W + 0.44) * s, (-H + 0.135) * s); if (mir) { ctx.scale(-1, 1); ctx.textAlign = 'right'; } ctx.fillText('REC', 0, 0); ctx.restore(); }
    // grip tube under the frame
    pp.poly(P.rectPts(-0.10 * s, (H + 0.02) * s, 0.20 * s, 0.30 * s, 0.05 * s), C.graphite, { col2: '#46425a', dir: [1, 0] });
    pp.rect(-0.13 * s, (H + 0.02) * s, 0.26 * s, 0.07 * s, 0.025 * s, C.amber, { w: pp.iw * 0.7 });
    pp.line([[0, H * s], [0, (H + 0.04) * s]], { color: C.graphite, width: pp.iw, passes: 1 });
  },
  // ---- clapperboard ----
  clapper(pp, ctx, s, a, T) {
    const clap = clamp(a.clap ?? 1, 0, 1), ang = -(1 - clap) * 0.58, hit = a.hit || 0;
    const X0 = -0.56, W = 1.12;
    // board
    pp.poly(P.rectPts(X0 * s, -0.02 * s, W * s, 0.62 * s, 0.04 * s), C.graphite, { col2: '#3c3850', dir: [0, 1] });
    // chalk fields
    const ch = pp.hand ? '#F4EDDC' : '#FFF3D6';
    [0.13, 0.30, 0.47].forEach((y, i) => pp.line([[(X0 + 0.08) * s, y * s], [(X0 + W - 0.08 - (i === 1 ? 0.35 : 0)) * s, y * s]], { color: ch, width: pp.iw * 0.7, passes: 1, alpha: 0.9 }));
    pp.line([[0.05 * s, 0.02 * s], [0.05 * s, 0.58 * s]], { color: ch, width: pp.iw * 0.55, passes: 1, alpha: 0.65 });
    pp.circle((X0 + 0.16) * s, 0.22 * s, 0.035 * s, C.amber, { ink: 'none' });
    // stripe bars
    const bar = (yy, rotA, accent) => {
      ctx.save(); ctx.translate((X0) * s, (yy + 0.11) * s); ctx.rotate(rotA); ctx.translate(-X0 * s, -(yy + 0.11) * s);
      pp.poly(P.rectPts(X0 * s, yy * s, W * s, 0.22 * s, 0.025 * s), C.cream, {});
      const nS = 7, sw = (W * s) / nS;
      ctx.save(); path(ctx, P.rectPts(X0 * s, yy * s, W * s, 0.22 * s, 0.025 * s)); ctx.clip();
      for (let i = -1; i < nS; i += 2) {
        const x0 = X0 * s + i * sw, st = [[x0 + sw * 0.35, yy * s], [x0 + sw * 1.35, yy * s], [x0 + sw * 1.0, (yy + 0.22) * s], [x0 + sw * 0.0, (yy + 0.22) * s]];
        pp.poly(st, accent, { ink: 'none' });
      }
      ctx.restore();
      pp.poly(P.rectPts(X0 * s, yy * s, W * s, 0.22 * s, 0.025 * s), null, {});
      ctx.restore();
    };
    bar(-0.24, 0, C.graphite);
    // moving stick (hinged at the left top corner of the fixed bar)
    ctx.save(); ctx.translate(X0 * s, -0.24 * s); ctx.rotate(ang); ctx.translate(-X0 * s, 0.24 * s); bar(-0.46, 0, C.vermilion); ctx.restore();
    pp.circle(X0 * s, -0.24 * s, 0.04 * s, C.amber, { w: pp.iw * 0.7 });
    // snap burst
    if (hit > 0.02) for (let i = 0; i < 6; i++) { const th = -2.9 + i * 0.42, r0 = (0.62 + 0.1 * hit) * s, r1 = r0 + (0.12 + 0.2 * hit) * s; pp.line([[X0 * s + Math.cos(th) * r0 + W * s * 0.7, -0.3 * s + Math.sin(th) * r0 * 0.6], [X0 * s + Math.cos(th) * r1 + W * s * 0.7, -0.3 * s + Math.sin(th) * r1 * 0.6]], { color: C.amber, width: pp.iw * 1.2, passes: 1, alpha: hit, taper: true }); }
  },
  // ---- glowing neural slate ----
  slate(pp, ctx, s, a, T) {
    const t = a.t || 0, glow = a.glow ?? 1, hand = pp.hand;
    // halo (reads on any background: source-over ramp on paper, additive on dark)
    ctx.save(); const gr = ctx.createRadialGradient(0, 0, s * 0.2, 0, 0, s * 1.15);
    gr.addColorStop(0, `rgba(124,196,255,${0.40 * glow})`); gr.addColorStop(0.45, `rgba(107,91,255,${0.26 * glow})`); gr.addColorStop(1, 'rgba(107,91,255,0)');
    if (!hand) ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, s * 1.15, 0, TAU); ctx.fill(); ctx.restore();
    // device
    pp.poly(P.rectPts(-0.34 * s, -0.48 * s, 0.68 * s, 0.96 * s, 0.1 * s), C.graphite, { col2: '#46425a', dir: [1, 1] });
    const scr = P.rectPts(-0.285 * s, -0.42 * s, 0.57 * s, 0.84 * s, 0.065 * s);
    if (hand) { P.fill(ctx, scr, { color: C.violet, offset: [0, 0], comp: 'source-over', boil: pp.boil || 0, seed: 77, amp: 0.6 }); hatchB(ctx, scr, { color: '#2a1f8a', gap: s * 0.05, width: 1.2, alpha: 0.45, angle: 0.9, boil: pp.boil || 0, seed: 78, segLen: s * 0.3 }); }
    else { ctx.save(); const sg = ctx.createLinearGradient(0, -0.42 * s, 0, 0.42 * s); sg.addColorStop(0, P.mix(C.violet, '#9AA8FF', 0.45 * glow)); sg.addColorStop(1, P.mix(C.violet, '#2A1F8A', 0.55)); ctx.fillStyle = sg; path(ctx, scr); ctx.fill(); ctx.restore(); }
    ctx.save(); path(ctx, scr); ctx.clip();
    const cream = '#FFF3D6', K = (v) => v * s;
    // status dots
    [0, 1, 2].forEach((i) => { ctx.fillStyle = i === 2 ? C.amber : 'rgba(255,243,214,0.75)'; ctx.beginPath(); ctx.arc(K(-0.2 + i * 0.07), K(-0.35), K(0.017), 0, TAU); ctx.fill(); });
    // spark glyph top-right
    ctx.fillStyle = cream; path(ctx, star4(K(0.2), K(-0.35), K(0.045 * (0.8 + 0.2 * Math.sin(t * 4))))); ctx.fill();
    // mini mark (aperture + play triangle) pulsing
    const pr = 0.8 + 0.2 * Math.sin(t * 2.2), mr = K(0.2 * pr);
    ctx.save(); ctx.translate(0, K(-0.12)); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const g6 = apertureGeom(0.5, 6, t * 0.5);
    ctx.strokeStyle = cream; ctx.lineWidth = Math.max(1.2, K(0.022)); ctx.beginPath(); ctx.arc(0, 0, mr, 0, TAU); ctx.stroke();
    ctx.beginPath(); g6.V.forEach((v, k) => { ctx.moveTo(v[0] * mr, v[1] * mr); ctx.lineTo(g6.C[k][0] * mr, g6.C[k][1] * mr); }); ctx.stroke();
    ctx.fillStyle = cream; path(ctx, triUnit(0.42, 0.08).map(([x, y]) => [x * mr * 0.85 + mr * 0.04, y * mr * 0.85])); ctx.fill(); ctx.restore();
    // typing lines
    const lines = [[0.42, 0.9], [0.30, 0.65], [0.36, 0.5]];
    lines.forEach(([w, ph], i) => { const reveal = i === 2 ? 0.5 + 0.5 * Math.sin(t * 2.4) : 1; ctx.fillStyle = i === 0 ? cream : 'rgba(255,243,214,0.6)'; ctx.fillRect(K(-0.2), K(0.1 + i * 0.075), K(w * 1.1 * reveal), Math.max(1.5, K(0.026))); });
    // waveform
    for (let i = 0; i < 9; i++) { const h = (0.25 + 0.75 * Math.abs(Math.sin(t * 3.1 + i * 0.9))) * 0.1; ctx.fillStyle = i % 3 === 0 ? C.amber : 'rgba(124,196,255,0.95)'; ctx.fillRect(K(-0.2 + i * 0.047), K(0.32 - h / 2 - 0.01), Math.max(1.4, K(0.026)), K(h)); }
    // scan sweep
    const sy = K(-0.42 + ((t * 0.5) % 1) * 0.84), sg2 = ctx.createLinearGradient(0, sy - K(0.1), 0, sy + K(0.1)); sg2.addColorStop(0, 'rgba(255,255,255,0)'); sg2.addColorStop(0.5, `rgba(255,255,255,${0.20 * glow})`); sg2.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = sg2; ctx.fillRect(K(-0.3), sy - K(0.1), K(0.6), K(0.2));
    ctx.restore();
    pp.poly(scr, null, { w: pp.iw * 0.6 });
    pp.gloss([[-0.25 * s, -0.38 * s], [-0.25 * s, -0.12 * s]], 0.35, s * 0.03);
    // outer glow rim (additive) for non-hand styles
    if (!hand) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; path(ctx, P.rectPts(-0.285 * s, -0.42 * s, 0.57 * s, 0.84 * s, 0.065 * s)); ctx.strokeStyle = `rgba(160,190,255,${0.35 * glow})`; ctx.lineWidth = s * 0.03; ctx.stroke(); ctx.restore(); }
  },
  // ---- baton ----
  baton(pp, ctx, s, a, T) {
    const t = a.t || 0, ang = a.angle ?? Math.sin(t * 3) * 0.35, sw = a.swing ?? 0;
    // swing trail (motion arc)
    if (sw > 0.01) { const pts = []; for (let i = 0; i <= 14; i++) { const th = ang + 0.7 * (i / 14) * sw * 2 - 0.0; const L = 1.28 * s; pts.push([-0.55 * s + Math.cos(th - 0.55) * L, 0.45 * s + Math.sin(th - 0.55) * L]); } pp.line(pts, { color: pp.hand ? C.vermilion : C.amber, width: pp.iw * 1.2, passes: 1, alpha: 0.65 * clamp(sw, 0, 1), taper: true }); }
    ctx.save(); ctx.translate(-0.55 * s, 0.45 * s); ctx.rotate(ang - 0.55);
    // stick
    pp.poly([[0.02 * s, -0.04 * s], [1.28 * s, -0.016 * s], [1.28 * s, 0.016 * s], [0.02 * s, 0.04 * s]], C.cream, { col2: '#FFFFFF', dir: [1, 0], w: pp.iw * 0.9 });
    // handle bulb
    pp.poly([[-0.18 * s, 0], [-0.13 * s, -0.08 * s], [0.0, -0.10 * s], [0.10 * s, -0.055 * s], [0.10 * s, 0.055 * s], [0.0, 0.10 * s], [-0.13 * s, 0.08 * s]], C.vermilion, { hatchC: P.darken(C.vermilion, 0.4), gap: s * 0.045, ang: 0.9 });
    pp.circle(-0.02 * s, -0.03 * s, 0.012 * s, '#FFFFFF', { ink: 'none' });
    // glowing tip
    const tw = 0.7 + 0.3 * Math.sin(t * 9);
    ctx.save(); const tg = ctx.createRadialGradient(1.28 * s, 0, 0, 1.28 * s, 0, s * 0.2); tg.addColorStop(0, `rgba(255,214,120,${0.85 * tw})`); tg.addColorStop(1, 'rgba(255,182,46,0)'); if (!pp.hand) ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = tg; ctx.beginPath(); ctx.arc(1.28 * s, 0, s * 0.2, 0, TAU); ctx.fill(); ctx.restore();
    pp.poly(star4(1.28 * s, 0, s * 0.09 * tw, 0.3, 0.2), C.amber, { w: pp.iw * 0.6 });
    ctx.restore();
  },
  // ---- brush: paints light ----
  brush(pp, ctx, s, a, T) {
    const t = a.t || 0, paint = a.paint ?? (0.5 + 0.5 * Math.sin(t * 1.5)), ang = a.angle ?? Math.sin(t * 2.2) * 0.2;
    ctx.save(); ctx.translate(-0.28 * s, -0.12 * s); ctx.rotate(ang);
    // ribbon of light behind the tip
    const N = 26, rib = [], rib2 = [];
    for (let i = 0; i <= N; i++) { const u = i / N, L = u * paint * 1.6; const x = 0.55 * s - L * s, y = 0.55 * s + Math.sin(u * 5.5 + t * 2) * s * 0.12 * (0.3 + u) + u * s * 0.22; const w = (0.025 + 0.07 * Math.sin(Math.PI * Math.min(1, u * 1.1))) * s * (1 - u * 0.35); rib.push([x, y - w]); rib2.push([x, y + w]); }
    if (paint > 0.03) {
      const rpts = rib.concat(rib2.reverse());
      ctx.save(); if (!pp.hand) ctx.globalCompositeOperation = 'lighter';
      if (pp.hand) pp.poly(rpts, C.amber, { hatchC: C.vermilion, gap: s * 0.05, ang: 0.4, w: pp.iw * 0.8 });
      else { const g = ctx.createLinearGradient(0.55 * s, 0, -1.0 * s, 0); g.addColorStop(0, 'rgba(255,243,214,0.95)'); g.addColorStop(0.35, 'rgba(255,182,46,0.8)'); g.addColorStop(1, 'rgba(242,84,45,0)'); ctx.fillStyle = g; path(ctx, rpts); ctx.fill(); }
      ctx.restore();
    }
    // handle (long, tapered), ferrule, bristles
    ctx.save(); ctx.translate(0.55 * s, 0.55 * s); ctx.rotate(-0.78);
    pp.poly([[0.10 * s, -0.035 * s], [1.15 * s, -0.05 * s], [1.2 * s, 0], [1.15 * s, 0.05 * s], [0.10 * s, 0.035 * s]], C.vermilion, { hatchC: P.darken(C.vermilion, 0.4), gap: s * 0.05, ang: 0.4, col2: '#FF7447', dir: [1, 0] });
    pp.poly([[0.0, -0.05 * s], [0.14 * s, -0.045 * s], [0.14 * s, 0.045 * s], [0.0, 0.05 * s]], STEEL, { w: pp.iw * 0.8 });
    pp.poly([[0.0, -0.05 * s], [-0.16 * s, -0.04 * s], [-0.26 * s, 0], [-0.16 * s, 0.045 * s], [0.0, 0.05 * s]], C.amber, { hatchC: '#E9A21A', gap: s * 0.04, ang: 0.8 });
    // glowing bristle tip
    ctx.save(); const tg = ctx.createRadialGradient(-0.26 * s, 0, 0, -0.26 * s, 0, s * 0.22); tg.addColorStop(0, 'rgba(255,243,214,0.9)'); tg.addColorStop(1, 'rgba(255,182,46,0)'); if (!pp.hand) ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = tg; ctx.beginPath(); ctx.arc(-0.26 * s, 0, s * 0.22, 0, TAU); ctx.fill(); ctx.restore();
    ctx.restore(); ctx.restore();
  },
};
const PROP_K = { slate: 1.3, baton: 1.15, brush: 1.1, viewfinder: 1.08, crank: 1.12, megaphone: 1.18, clapper: 1.12 };
PROPS.clapperboard = PROPS.clapper; PROPS.camera = PROPS.crank; PROPS.finder = PROPS.viewfinder;

const PROP_ALIAS = { clapperboard: 'clapper', camera: 'crank', finder: 'viewfinder' };
export function drawProp(ctx, T, S, kind, { x = 0, y = 0, size = 100, anim = {}, boil = (T && T.boil) || 0, seed = 7, style = 'ink', palette = {} } = {}) {
  kind = PROP_ALIAS[kind] || kind; const fn = PROPS[kind]; if (!fn) return;
  const st = STYLES.includes(style) ? style : 'ink', pal = { ...palOf({ palette }) };
  const b = st === 'clean' || st === 'phone' || st === 'glow' ? 0 : boil;
  const pp = mkPP(ctx, st, b, seed, size * (PROP_K[kind] || 1), pal); pp.boil = b;
  ctx.save(); ctx.translate(x, y);
  if (anim.flip) ctx.scale(-1, 1);
  if (anim.rot) ctx.rotate(anim.rot);
  if (st === 'phone') { ctx.save(); ctx.fillStyle = 'rgba(20,16,30,0.18)'; ctx.translate(size * 0.04, size * 0.07); ctx.restore(); }
  const k = PROP_K[kind] || 1; fn(pp, ctx, size * k, { t: (T && T.t) || 0, ...anim }, T);
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------------------------------
// emotive extras (o.fx = ['sparkle','lines','sweat','confetti','zzz','heart','exclaim','question','poof'])
// ---------------------------------------------------------------------------------------------------------------------
const heartPts = (cx, cy, r) => { const pts = []; for (let i = 0; i < 28; i++) { const t = (i / 28) * TAU, x = 16 * Math.sin(t) ** 3, y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)); pts.push([cx + (x / 17) * r, cy + (y / 17) * r]); } return pts; };
function dropShape(cx, cy, r) { // classic teardrop: round bottom, pointed top (slightly concave sides)
  const ap = [cx, cy - r * 1.95], al = Math.acos(1 / 1.95), a0 = -Math.PI / 2 + al, a1 = -Math.PI / 2 - al + TAU, pts = [ap];
  const tr = [cx + Math.cos(a0) * r, cy + Math.sin(a0) * r], tl = [cx + Math.cos(a1) * r, cy + Math.sin(a1) * r];
  for (let i = 1; i <= 6; i++) { const u = i / 6, k = Math.sin(Math.PI * u) * r * 0.09; pts.push([lerp(ap[0], tr[0], u) - k, lerp(ap[1], tr[1], u)]); }
  for (let i = 1; i < 18; i++) { const a = lerp(a0, a1, i / 18); pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  for (let i = 0; i <= 5; i++) { const u = i / 6, k = Math.sin(Math.PI * u) * r * 0.09; pts.push([lerp(tl[0], ap[0], u) + k, lerp(tl[1], ap[1], u)]); }
  return pts;
}
function drawFx(ctx, T, F, o, pal, style, boil, seed) {
  const R = F.R, list = Array.isArray(o.fx) ? o.fx : [o.fx], t = (T && T.t) || 0, hand = style === 'ink' || style === 'line', holo = style === 'hologram';
  const iw = Math.max(1.6, R * 0.016), amp = 1.1 * clamp(R / 200, 0.4, 2), step = clamp(R * 0.045, 4, 12);
  const pp = mkPP(ctx, style, boil, seed + 500, R * 0.8, pal);
  const dark = style === 'clean' || style === 'phone' || style === 'glow' || holo;
  const fxT = o.fxT != null ? o.fxT : t % 2.4;
  list.forEach((fx, fi) => {
    const kind = typeof fx === 'string' ? fx : fx.kind, fo = typeof fx === 'string' ? {} : fx, sd = seed + 600 + fi * 37;
    if (kind === 'sparkle') {
      const N = fo.n || 5;
      for (let i = 0; i < N; i++) {
        const a = -0.9 + hash(i, sd, 1) * 4.6, rr = R * (1.1 + 0.4 * hash(i, sd, 2)), ph = (t * 0.85 + hash(i, sd, 3)) % 1, k = Math.pow(Math.sin(Math.PI * ph), 1.4);
        const cx = Math.cos(a) * rr * F.sx, cy = Math.sin(a) * rr * 0.92, r = R * (0.16 + 0.2 * hash(i, sd, 4)) * k; if (r < 1) continue;
        const col = hash(i, sd, 5) > 0.5 ? C.amber : (dark ? '#FFFFFF' : C.vermilion);
        if (holo) pp.poly(star4(cx, cy, r, 0.26, 0), null, { w: pp.iw });
        else { pp.poly(star4(cx, cy, r, 0.26, 0), col, { w: iw * 0.7, ink: hand }); if (dark) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.2); g.addColorStop(0, 'rgba(255,230,160,0.35)'); g.addColorStop(1, 'rgba(255,182,46,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r * 2.2, 0, TAU); ctx.fill(); ctx.restore(); } }
      }
    } else if (kind === 'lines') {
      const dir = o.fxAngle ?? fo.angle ?? 0, N = fo.n || 6, L0 = R * (fo.len || 1.4), col = hand ? C.graphite : (holo ? '#7CF5E6' : '#FFFFFF');
      ctx.save(); ctx.rotate(dir);
      for (let i = 0; i < N; i++) {
        const lat = (-0.85 + (1.7 * (i + 0.5)) / N + (hash(i, sd, 1) - 0.5) * 0.2) * R, len = L0 * (0.55 + 0.7 * hash(i, sd, 2)) * (0.85 + 0.15 * Math.sin(boil * 2.1 + i * 1.7)), x0 = -R * (1.15 + 0.25 * hash(i, sd, 3));
        const pts = [[x0, lat], [x0 - len * 0.5, lat + (hash(i, sd, 4) - 0.5) * 3], [x0 - len, lat]];
        if (hand) P.ink(ctx, pts, { closed: false, color: col, width: iw * 0.9, amp: amp * 0.6, boil, seed: sd + i, passes: 2, taper: true, step, alpha: 0.9 });
        else { const g = ctx.createLinearGradient(x0, 0, x0 - len, 0); g.addColorStop(0, P.rgba(col, 0.75)); g.addColorStop(1, P.rgba(col, 0)); ctx.save(); if (holo) ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = g; ctx.lineCap = 'round'; ctx.lineWidth = iw * 1.1 * (0.6 + hash(i, sd, 5)); ctx.beginPath(); ctx.moveTo(x0, lat); ctx.lineTo(x0 - len, lat); ctx.stroke(); ctx.restore(); }
      }
      ctx.restore();
    } else if (kind === 'sweat') {
      const ph = (t * 0.7) % 1, k = clamp(ph * 6, 0, 1) * clamp((1 - ph) * 5, 0, 1), cx = R * 0.78 * F.sx, cy = -R * 0.72 + ph * R * 0.5, r = R * 0.15 * (0.7 + 0.3 * k);
      const dp = dropShape(cx, cy, r);
      ctx.save(); ctx.globalAlpha *= clamp(k * 1.6, 0, 1);
      pp.poly(dp, '#7CC4FF', { w: iw * 0.8, hatchC: '#3C8BD9', gap: r * 0.5, ang: 0.8, col2: '#BFE4FF', dir: [0, 1] });
      ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.ellipse(cx - r * 0.35, cy + r * 0.05, r * 0.16, r * 0.3, -0.3, 0, TAU); ctx.fill();
      ctx.restore();
    } else if (kind === 'confetti') {
      const N = fo.n || 26, ft = fxT, cols = [C.vermilion, C.amber, C.sky, C.teal, C.violet, C.cream];
      for (let i = 0; i < N; i++) {
        const a = hash(i, sd, 1) * TAU, v = R * (1.6 + 2.4 * hash(i, sd, 2)), k = 1 - Math.exp(-ft * 3.2), x = Math.cos(a) * v * k / 2.4 * 1.0, g = R * 2.4 * ft * ft * (0.6 + 0.6 * hash(i, sd, 7));
        const y = Math.sin(a) * v * k / 2.4 * 0.9 - R * 0.2 * k + g, al = clamp((2.6 - ft) / 0.8, 0, 1) * clamp(ft * 12, 0, 1); if (al <= 0) continue;
        const w = R * (0.075 + 0.07 * hash(i, sd, 3)), h = w * (0.5 + 0.3 * hash(i, sd, 4)), rot = ft * (3 + 6 * hash(i, sd, 5)) + hash(i, sd, 6) * 6, col = cols[i % cols.length];
        const sq = Math.abs(Math.cos(ft * (4 + 5 * hash(i, sd, 8)) + i));
        const pts = rot2(P.rectPts(x - w / 2, y - (h * sq) / 2, w, Math.max(1, h * sq), 0), rot, x, y);
        ctx.save(); ctx.globalAlpha *= al; if (hand) pp.poly(pts, col, { w: iw * 0.5 }); else { ctx.fillStyle = col; path(ctx, pts); ctx.fill(); } ctx.restore();
      }
    } else if (kind === 'zzz') {
      for (let i = 0; i < 3; i++) {
        const ph = ((t * 0.45 + i / 3) % 1), x = R * (0.75 + ph * 0.7), y = -R * (0.65 + ph * 0.9), sz = R * (0.2 + ph * 0.28), al = Math.sin(Math.PI * ph);
        ctx.save(); ctx.globalAlpha *= al; ctx.translate(x, y); ctx.rotate(0.2 + ph * 0.2);
        const col = hand ? C.graphite : '#FFFFFF'; ctx.font = `700 ${Math.round(sz)}px Caveat, cursive`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = col; if (holo) ctx.globalCompositeOperation = 'lighter'; ctx.fillText('Z', 0, 0); ctx.restore();
      }
    } else if (kind === 'heart') {
      for (let i = 0; i < 4; i++) {
        const ph = ((t * 0.6 + i / 4 + hash(i, sd, 1) * 0.1) % 1), x = R * (0.7 + 0.5 * Math.sin(i * 2.4) + Math.sin(ph * 7 + i) * 0.1) * (i % 2 ? -1 : 1), y = -R * (0.5 + ph * 1.4), r = R * (0.09 + 0.07 * hash(i, sd, 2)) * (0.5 + 0.8 * Math.sin(Math.PI * Math.min(1, ph * 1.3)));
        if (r < 1) continue; ctx.save(); ctx.globalAlpha *= clamp((1 - ph) * 3, 0, 1); pp.poly(heartPts(x, y, r), i % 2 ? C.vermilion : '#FF7A9A', { w: iw * 0.7, hatchC: P.darken(C.vermilion, 0.3), gap: r * 0.4, ang: 0.8 }); ctx.restore();
      }
    } else if (kind === 'exclaim') {
      const k = clamp(fxT / 0.3, 0, 1), s = outBack(k) * R * 0.34, cx = R * 0.95 * F.sx, cy = -R * 1.05 + Math.sin(t * 6) * R * 0.02; if (s < 1) return;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(0.15);
      pp.poly([[-s * 0.22, -s * 0.9], [s * 0.22, -s * 0.9], [s * 0.12, s * 0.28], [-s * 0.12, s * 0.28]], C.vermilion, { w: iw * 0.9, col2: '#FF7447', dir: [0, 1] });
      pp.circle(0, s * 0.62, s * 0.15, C.vermilion, { w: iw * 0.9 }); ctx.restore();
    } else if (kind === 'question') {
      const k = clamp(fxT / 0.3, 0, 1), s = outBack(k) * R * 0.5, cx = R * 0.95 * F.sx, cy = -R * 1.0 + Math.sin(t * 4) * R * 0.03; if (s < 1) return;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(0.2); ctx.font = `700 ${Math.round(s * 1.5)}px Caveat, cursive`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2, s * 0.14); ctx.strokeStyle = hand ? '#F2EBDC' : 'rgba(20,16,30,0.85)'; ctx.strokeText('?', 0, 0); ctx.fillStyle = hand ? C.vermilion : C.amber; ctx.fillText('?', 0, 0); ctx.restore();
    } else if (kind === 'poof') {
      const ft = fxT, N = 14; const k = clamp(ft / 0.9, 0, 1);
      for (let i = 0; i < N; i++) {
        const a = (i / N) * TAU + hash(i, sd, 1) * 0.5, d = R * (0.25 + 0.75 * outCubic(k)) * (0.75 + 0.5 * hash(i, sd, 2)), r = R * (0.18 + 0.2 * hash(i, sd, 3)) * (0.5 + 0.8 * outCubic(k)), al = clamp(1 - k * 1.05, 0, 1) * 0.95;
        if (al <= 0.01) continue; const cx = Math.cos(a) * d, cy = Math.sin(a) * d * 0.8 - k * R * 0.2;
        ctx.save(); ctx.globalAlpha *= al;
        if (hand) { pp.circle(cx, cy, r, '#FBF7EE', { w: iw * 0.8, hatchC: '#B9B3A8', gap: r * 0.3, ang: 0.8 }); }
        else { const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.7, 'rgba(235,232,245,0.7)'); g.addColorStop(1, 'rgba(220,215,235,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill(); }
        ctx.restore();
      }
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// drawAmrita
// ---------------------------------------------------------------------------------------------------------------------
export function drawAmrita(ctx, T, S, o = {}) {
  const { x = 960, y = 540, size = 200, roll = 0, alpha = 1, seed = 11, prop = null, propAnim = {}, propSide = 1 } = o;
  const style = STYLES.includes(o.style) ? o.style : 'ink';
  const R = size, pal = palOf(o), eyeP = resolveEye(o);
  if (!(R > 0.75)) return { faceBox: { x, y, w: 0, h: 0 }, eyeY: y, center: [x, y], R, eyes: [[x, y], [x, y]], prop: null };
  if (o.blink != null) eyeP.open *= 1 - clamp(o.blink, 0, 1);
  const flatStyle = style === 'clean' || style === 'phone' || style === 'glow';
  const boil = flatStyle ? 0 : (T && T.boil) || 0;
  const m = ctx.getTransform(), px = Math.hypot(m.a, m.b) || 1;
  const F = buildFig(R, o, eyeP);
  ctx.save(); ctx.globalAlpha *= alpha;
  drawShadow(ctx, o, x, y, R, F.sy, style, px);
  ctx.translate(x, y);
  ctx.save(); ctx.rotate(roll);
  if (style === 'glow') glowBefore(ctx, F, o, T, boil, seed);
  let propInfo = null;
  // prop sits beside her; drawn before the body when she faces it (so the disc overlaps its near edge), after otherwise
  const drawPropNow = () => {
    if (!prop) return null;
    const side = propSide >= 0 ? 1 : -1, ps = (o.propScale ?? 1) * R * 0.95, bobT = ((propAnim.t != null ? propAnim.t : T && T.t) || 0);
    const dx = (o.propDx ?? 0) + side * R * (F.sx * (0.98 + 0.12 * Math.abs(Math.sin(F.yaw))) + 0.92 * (o.propScale ?? 1)), dy = (o.propDy ?? 0) + R * 0.06 + Math.sin(bobT * 2.2 + 0.7) * R * 0.04, pr = (o.propRot ?? 0) + Math.sin(bobT * 1.7) * 0.05;
    ctx.save(); ctx.translate(dx, dy); ctx.rotate(pr); if (side < 0) ctx.scale(-1, 1);
    drawProp(ctx, T, S, prop, { x: 0, y: 0, size: ps, anim: { t: bobT, ...propAnim }, boil, seed: seed + 80, style, palette: o.palette });
    ctx.restore();
    return { x: x + dx, y: y + dy, size: ps };
  };
  if (style === 'ink' || style === 'line') renderHand(ctx, F, { ...o, style }, pal, boil, seed);
  else if (style === 'hologram') renderHolo(ctx, F, o, pal, boil, seed, T);
  else renderVector(ctx, F, { ...o, style }, pal, boil, seed, px);
  if (style === 'glow') glowAfter(ctx, F, o, T, boil, seed);
  propInfo = drawPropNow();
  if (o.fx && o.fx.length) drawFx(ctx, T, F, o, pal, style, boil, seed);
  ctx.restore(); ctx.restore();
  const fc = F.pr(GEO.tri * 0.1, 0, Z_PLATE), ey = (F.eyes[0].c[1] + F.eyes[1].c[1]) / 2;
  const cr = Math.cos(roll), sr = Math.sin(roll), rot = ([a, b]) => [x + a * cr - b * sr, y + a * sr + b * cr];
  return { faceBox: { x: x + fc[0] - R * 0.42 * F.sx, y: y - R * 0.42 * F.sy, w: R * 0.84 * F.sx, h: R * 0.84 * F.sy }, eyeY: y + ey, center: [x, y], R, eyes: F.eyes.map((E) => rot(E.c)), prop: propInfo };
}

// ---------------------------------------------------------------------------------------------------------------------
// blade with a built-in gap (for the one-colour mark: no knock-out needed)
// ---------------------------------------------------------------------------------------------------------------------
export function bladeInset(g, k, d = 0.018, arcN = 14) {
  const n = g.n, A = g.V[k], B = g.C[(k - 1 + n) % n], Cn = g.C[k], cen = [(A[0] + B[0] + Cn[0]) / 3, (A[1] + B[1] + Cn[1]) / 3];
  const lineOff = (Q) => { let dx = Q[0] - A[0], dy = Q[1] - A[1]; const l = Math.hypot(dx, dy); dx /= l; dy /= l; let nx = -dy, ny = dx; if ((cen[0] - A[0]) * nx + (cen[1] - A[1]) * ny < 0) { nx = -nx; ny = -ny; } return { p: [A[0] + nx * d, A[1] + ny * d], d: [dx, dy] }; };
  const L1 = lineOff(B), L2 = lineOff(Cn);
  const cr = L1.d[0] * L2.d[1] - L1.d[1] * L2.d[0], w = [L2.p[0] - L1.p[0], L2.p[1] - L1.p[1]], tt = (w[0] * L2.d[1] - w[1] * L2.d[0]) / cr;
  const apex = [L1.p[0] + L1.d[0] * tt, L1.p[1] + L1.d[1] * tt];
  const hit = (L) => { const bq = L.p[0] * L.d[0] + L.p[1] * L.d[1], c = L.p[0] * L.p[0] + L.p[1] * L.p[1] - 1, s = -bq + Math.sqrt(Math.max(0, bq * bq - c)); return [L.p[0] + L.d[0] * s, L.p[1] + L.d[1] * s]; };
  const p1 = hit(L1), p2 = hit(L2);
  let a0 = Math.atan2(p1[1], p1[0]), a1 = Math.atan2(p2[1], p2[0]); while (a1 < a0) a1 += TAU;
  const pts = [apex, p1]; for (let i = 1; i < arcN; i++) { const a = lerp(a0, a1, i / arcN); pts.push([Math.cos(a), Math.sin(a)]); } pts.push(p2);
  return { apex, p1, p2, pts };
}

// ---------------------------------------------------------------------------------------------------------------------
// drawMark — the logo
// ---------------------------------------------------------------------------------------------------------------------
export function drawMark(ctx, S, o = {}) {
  const { x = 960, y = 540, size = 200, style = 'flat', boil = 0, palette = {}, seed = 4, alpha = 1, play = true, eyes = false, iris = 1, yaw = 0, color = null } = o;
  const pal = palOf({ palette }), R = size;
  const eyeP = resolveEye({ expr: o.expr, eye: o.eye });
  const F = buildFig(R, { yaw, iris, thick: yaw ? undefined : 0, squash: o.squash || 0, pitch: o.pitch || 0 }, eyeP);
  ctx.save(); ctx.globalAlpha *= alpha; ctx.translate(x, y);
  const opts = { style: 'clean', noEyes: !eyes, play };
  if (style === 'ink') { renderHand(ctx, F, { style: 'ink', noEyes: !eyes }, pal, boil, seed); }
  else if (style === 'mono') {
    const col = color || pal.ink, g = F.g; ctx.fillStyle = col;
    for (let k = 0; k < 6; k++) { const b = bladeInset(g, k, 0.02); path(ctx, F.M(b.pts, 0)); ctx.fill(); }
    if (play) { ctx.beginPath(); const tp = F.M(triUnit(GEO.tri * (iris < 1 ? Math.max(0.5, iris) : 1), GEO.triR), 0); tp.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); if (eyes) F.eyes.forEach((E) => { const e = E.pts.map(([px, py]) => [px, py]); e.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); }); ctx.fill('evenodd'); }
  } else { // flat: crisp, two-stop blade gradients, no outline, no gloss
    ctx.fillStyle = pal.blade; path(ctx, F.front); ctx.fill();
    F.blades.forEach((bl) => {
      const col = bladeCol(pal, bl.k), tip = F.seams[bl.k][0], far = bl.pts[Math.floor(bl.pts.length * 0.55)];
      const g = ctx.createLinearGradient(tip[0], tip[1], far[0], far[1]); g.addColorStop(0, P.darken(col, 0.1)); g.addColorStop(1, P.lighten(col, 0.16));
      ctx.fillStyle = g; ctx.strokeStyle = g; ctx.lineWidth = 1; path(ctx, bl.pts); ctx.fill(); ctx.stroke();
    });
    ctx.save(); ctx.strokeStyle = 'rgba(70,16,0,0.30)'; ctx.lineWidth = Math.max(1, R * 0.008); F.seams.forEach((s) => { ctx.beginPath(); ctx.moveTo(s[0][0], s[0][1]); ctx.lineTo(s[1][0], s[1][1]); ctx.stroke(); }); ctx.restore();
    ctx.fillStyle = DARK; path(ctx, F.hex); ctx.fill();
    if (play) { ctx.fillStyle = pal.face; path(ctx, F.tri); ctx.fill(); if (eyes) F.eyes.forEach((E) => vectorEye(ctx, F, E, pal, true, false)); }
  }
  ctx.restore();
  return { center: [x, y], R };
}

// ---------------------------------------------------------------------------------------------------------------------
// helpers: blinking, eye scripts, hover, anticipation / squash & stretch poses
// ---------------------------------------------------------------------------------------------------------------------
// Seeded natural blinking: returns how CLOSED the eyes are, 0..1 (use eye.open = 1 - blinkAmount(T)).  ~every 2.2-3.4 s, sometimes a double blink.
export function blinkAmount(T, { seed = 3, period = 2.9, dur = 0.17, time = null, skip = 0.12 } = {}) {
  const t = time != null ? time : T && T.t != null ? T.t : 0, i0 = Math.floor(t / period);
  const one = (s0) => { const x = (t - s0) / dur; return x < 0 || x > 1 ? 0 : x < 0.32 ? smooth(x / 0.32) : x < 0.46 ? 1 : 1 - smooth((x - 0.46) / 0.54); };
  let c = 0;
  for (let i = i0 - 1; i <= i0; i++) {
    if (hash(i, seed, 1) < skip) continue;
    const s0 = i * period + hash(i, seed, 2) * period * 0.78 + 0.1; c = Math.max(c, one(s0));
    if (hash(i, seed, 3) > 0.82) c = Math.max(c, one(s0 + dur * 1.35));
  }
  return c;
}
// look direction toward a point (px) -> {lookX, lookY} in -1..1
export function lookToward(x, y, tx, ty, reach = 380) { const dx = tx - x, dy = ty - y, d = Math.hypot(dx, dy) || 1, k = clamp(d / reach, 0, 1); return { lookX: (dx / d) * k, lookY: (dy / d) * k }; }
// Script: [{t, expr:'happy'|eye:{...}, amt, look:[x,y] | lookX/lookY, dur=0.16, ease:'smooth'|'spring'|'snap'}, ...] (times in `opts.time`: 'lt' (scene-local, default) or 't')
// Returns eye numbers (interpolated, plus natural blinking unless opts.blink === false).
export function eyeAnim(T, script = [], opts = {}) {
  const tm = opts.time === 't' ? T.t : (T.lt != null ? T.lt : T.t), ks = script.slice().sort((a, b) => a.t - b.t);
  const target = (k) => { const e = k.eye ? { ...EYE0, ...k.eye } : eyeFor(k.expr || 'neutral', k.amt ?? 1); if (k.look) { e.lookX = k.look[0]; e.lookY = k.look[1]; } if (k.lookX != null) e.lookX = k.lookX; if (k.lookY != null) e.lookY = k.lookY; return e; };
  let cur = { ...EYE0 };
  for (let i = 0; i < ks.length; i++) {
    const k = ks[i], tg = target(k), d = k.dur ?? 0.16, x = (tm - k.t) / d;
    if (tm < k.t) break;
    if (k.ease === 'snap' || d <= 0) cur = tg;
    else { const e = k.ease === 'spring' ? spring(tm - k.t, 3.5, 0.45) : smooth(x); cur = mixEye(cur, tg, tm - k.t >= d && k.ease !== 'spring' ? 1 : e); if (k.ease === 'spring' && tm - k.t > 1.2) cur = tg; }
    if (x >= 1 && k.ease !== 'spring') cur = tg;
  }
  const out = { ...cur };
  if (opts.blink !== false) out.open = (out.open ?? 1) * (1 - blinkAmount(T, { seed: opts.seed ?? 3, time: opts.time === 't' ? T.t : T.t })) ;
  return out;
}
// Clapperboard timing: returns {clap (0 open .. 1 shut), hit (0..1 impact burst)} for a snap at global/scene time `tHit`
// (stick lifts over `pre` s, holds open, slams shut at tHit with a tiny rebound).  Feed into propAnim: { clap, hit }.
export function clapAt(time, tHit, { pre = 0.4, hold = 0.12 } = {}) {
  const d = time - tHit;
  if (d < -pre) return { clap: 1, hit: 0 };
  if (d < -hold) return { clap: 1 - smooth((d + pre) / (pre - hold)), hit: 0 };
  if (d < 0) return { clap: 0, hit: 0 };
  const k = d / 0.14, shut = k < 0.35 ? smooth(k / 0.35) : 1 - 0.1 * Math.sin(Math.min(1, (k - 0.35) / 0.65) * Math.PI) * Math.exp(-k);
  return { clap: clamp(shut, 0, 1), hit: Math.exp(-d / 0.09) * (d < 0.4 ? 1 : 0) };
}

// Idle hover: gentle bob + breathing squash + a hint of roll.  Returns {dy (px if size given), dx, roll, squash}.
export function hoverBob(T, { size = 1, amp = 0.045, freq = 0.62, phase = 0, drift = 0.015 } = {}) {
  const t = (T && T.t) || 0, w = TAU * freq;
  return { dy: Math.sin(w * t + phase) * amp * size, dx: Math.sin(w * t * 0.5 + phase * 1.3 + 1) * drift * size, roll: Math.sin(w * t * 0.5 + phase + 0.6) * 0.035, squash: Math.sin(w * t + phase + 1.6) * 0.012 };
}
// Anticipation & squash-and-stretch poses.  u 0..1 over the move.  Returns {squash, dy (x size, + = up), dx, roll, scale}; feed to drawAmrita (y -= dy*size).
//   'hop'  : crouch -> launch stretch -> apex -> fall stretch -> landing squash -> spring settle
//   'pop'  : scale-in with overshoot and a decaying squash wobble (appear)
//   'land' : impact squash and spring recovery
//   'anticipate': slow crouch back + lean (before a dash), 'dash': stretch forward + roll, 'nod': tiny squash bob
export function poseAt(kind, u, { height = 1.2, dir = 1 } = {}) {
  u = clamp(u, 0, 1);
  if (kind === 'hop') {
    const A = 0.2, L = 0.34, Dn = 0.78;
    if (u < A) { const k = smooth(u / A); return { squash: -0.3 * k, dy: -0.1 * k * 0.5, dx: 0, roll: -0.05 * dir * k, scale: 1 }; }
    if (u < L) { const k = (u - A) / (L - A); return { squash: lerp(-0.3, 0.26, smooth(k)), dy: lerp(-0.05, 0.18 * height, k), dx: 0, roll: 0, scale: 1 }; }
    if (u < Dn) { const k = (u - L) / (Dn - L), h = Math.sin(Math.PI * k); return { squash: lerp(0.26, 0.12, k) * (1 - 0.3 * h), dy: 0.18 * height + h * height, dx: 0, roll: 0.05 * dir * Math.sin(k * Math.PI), scale: 1 }; }
    const k = (u - Dn) / (1 - Dn); const sp = spring(k * 0.9, 3, 0.35);
    return { squash: -0.34 * Math.exp(-k * 5) * Math.cos(k * 14) + (1 - sp) * -0.0, dy: Math.max(0, 0.18 * height * (1 - smooth(Math.min(1, k * 5)))), dx: 0, roll: 0, scale: 1 };
  }
  if (kind === 'pop') { const e = Math.exp(-5 * u); return { squash: 0.32 * e * Math.cos(15 * u), dy: 0, dx: 0, roll: 0.12 * dir * e * Math.sin(12 * u), scale: clamp(outBack(clamp(u * 2.2), 2.2), 0, 1.3) }; }
  if (kind === 'land') { const e = Math.exp(-6 * u); return { squash: -0.36 * e * Math.cos(16 * u), dy: 0, dx: 0, roll: 0, scale: 1 }; }
  if (kind === 'anticipate') { const k = smooth(u); return { squash: -0.22 * k, dy: -0.06 * k, dx: -0.18 * dir * k, roll: -0.12 * dir * k, scale: 1 }; }
  if (kind === 'dash') { const k = outCubic(u); return { squash: -0.25 * Math.sin(Math.PI * u), dy: 0, dx: 0, roll: 0.1 * dir * Math.sin(Math.PI * u), scale: 1 + 0.05 * k }; }
  if (kind === 'nod') { const e = Math.sin(Math.PI * u); return { squash: -0.12 * e, dy: -0.02 * e, dx: 0, roll: 0, scale: 1 }; }
  return { squash: 0, dy: 0, dx: 0, roll: 0, scale: 1 };
}

// ---------------------------------------------------------------------------------------------------------------------
// SVG builders (same geometry as the canvas renderers; brand/build.mjs writes them to brand/*.svg)
// ---------------------------------------------------------------------------------------------------------------------
const f4 = (v) => String(Math.round(v * 10000) / 10000);
function svgTriPath(rc = GEO.tri, r = GEO.triR) {
  const V = triVerts(rc), N = V.length; let d = '';
  for (let i = 0; i < N; i++) {
    const p0 = V[(i + N - 1) % N], p1 = V[i], p2 = V[(i + 1) % N];
    let u1 = [p0[0] - p1[0], p0[1] - p1[1]], u2 = [p2[0] - p1[0], p2[1] - p1[1]]; const l1 = Math.hypot(...u1), l2 = Math.hypot(...u2); u1 = [u1[0] / l1, u1[1] / l1]; u2 = [u2[0] / l2, u2[1] / l2];
    const ang = Math.acos(clamp(u1[0] * u2[0] + u1[1] * u2[1], -1, 1)), sb = r / Math.tan(ang / 2), t1 = [p1[0] + u1[0] * sb, p1[1] + u1[1] * sb], t2 = [p1[0] + u2[0] * sb, p1[1] + u2[1] * sb];
    d += `${i ? 'L' : 'M'}${f4(t1[0])} ${f4(t1[1])}A${f4(r)} ${f4(r)} 0 0 1 ${f4(t2[0])} ${f4(t2[1])}`;
  }
  return d + 'Z';
}
const svgEllipse = (cx, cy, rx, ry, fill, extra = '') => `<ellipse cx="${f4(cx)}" cy="${f4(cy)}" rx="${f4(rx)}" ry="${f4(ry)}" fill="${fill}"${extra}/>`;
export function markSVG({ size = 512, eyes = false, palette = {}, title = 'Amrita mark (PROPOSAL)', iris = 1, bg = null, desc = '' } = {}) {
  const pal = palOf({ palette }), g = apertureGeom(GEO.hex * iris), hexD = 'M' + g.V.map((v) => `${f4(v[0])} ${f4(v[1])}`).join('L') + 'Z';
  let defs = '', blades = '';
  for (let k = 0; k < 6; k++) {
    const col = bladeCol(pal, k), tip = g.V[k], u = bladeUnit(g, k), far = u[Math.floor(u.length * 0.55)], Cp = g.C[(k + 5) % 6], Ck = g.C[k];
    defs += `<linearGradient id="b${k}" gradientUnits="userSpaceOnUse" x1="${f4(tip[0])}" y1="${f4(tip[1])}" x2="${f4(far[0])}" y2="${f4(far[1])}"><stop offset="0" stop-color="${P.darken(col, 0.1)}"/><stop offset="1" stop-color="${P.lighten(col, 0.16)}"/></linearGradient>`;
    blades += `<path d="M${f4(tip[0])} ${f4(tip[1])}L${f4(Cp[0])} ${f4(Cp[1])}A1 1 0 0 1 ${f4(Ck[0])} ${f4(Ck[1])}Z" fill="url(#b${k})" stroke="url(#b${k})" stroke-width="0.004" stroke-linejoin="round"/>`;
  }
  let seams = ''; g.V.forEach((v, k) => { seams += `M${f4(v[0])} ${f4(v[1])}L${f4(g.C[k][0])} ${f4(g.C[k][1])}`; });
  let eyeSvg = '';
  if (eyes) for (const sd of [-1, 1]) { const cx = GEO.eyeX, cy = sd * GEO.eyeY; eyeSvg += svgEllipse(cx, cy, GEO.eyeHW, GEO.eyeHH, pal.eye) + svgEllipse(cx - GEO.eyeHW * 0.3, cy - GEO.eyeHH * 0.34, GEO.eyeHW * 0.3, GEO.eyeHH * 0.24, '#FFFFFF') + svgEllipse(cx + GEO.eyeHW * 0.34, cy + GEO.eyeHH * 0.42, GEO.eyeHW * 0.13, GEO.eyeHW * 0.13, '#FFFFFF'); }
  const v = 1.06, px = size;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-v} ${-v} ${2 * v} ${2 * v}" width="${px}" height="${px}" role="img" aria-label="${title}">
<title>${title}</title>
<desc>${desc || 'PROPOSAL (no brand mark existed): six pinwheel aperture blades (vermilion / amber) around a hexagonal opening of circumradius 0.62, a cream rounded play-triangle (circumradius 0.60, corner radius 0.10, tip right)' + (eyes ? ', and two glossy black oval eyes.' : '.')} Unit disc radius 1.</desc>
<defs>${defs}</defs>
${bg ? `<rect x="${-v}" y="${-v}" width="${2 * v}" height="${2 * v}" fill="${bg}"/>` : ''}<circle r="1" fill="${pal.blade}"/>
<g id="blades">${blades}</g>
<path d="${seams}" fill="none" stroke="#461000" stroke-opacity="0.3" stroke-width="0.008" stroke-linecap="round"/>
<path id="opening" d="${hexD}" fill="${DARK}"/>
<path id="play" d="${svgTriPath()}" fill="${pal.face}"/>
${eyeSvg ? `<g id="eyes">${eyeSvg}</g>\n` : ''}</svg>
`;
}
export function monoSVG({ size = 512, color = '#0E0D12', eyes = false, title = 'Amrita mark, one colour (PROPOSAL)' } = {}) {
  const g = apertureGeom(GEO.hex); let d = '';
  for (let k = 0; k < 6; k++) { const b = bladeInset(g, k, 0.02); d += `M${f4(b.apex[0])} ${f4(b.apex[1])}L${f4(b.p1[0])} ${f4(b.p1[1])}A1 1 0 0 1 ${f4(b.p2[0])} ${f4(b.p2[1])}Z`; }
  let tri = svgTriPath();
  if (eyes) for (const sd of [-1, 1]) { const cx = GEO.eyeX, cy = sd * GEO.eyeY, rx = GEO.eyeHW, ry = GEO.eyeHH; tri += `M${f4(cx - rx)} ${f4(cy)}A${f4(rx)} ${f4(ry)} 0 1 0 ${f4(cx + rx)} ${f4(cy)}A${f4(rx)} ${f4(ry)} 0 1 0 ${f4(cx - rx)} ${f4(cy)}Z`; }
  const v = 1.06;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-v} ${-v} ${2 * v} ${2 * v}" width="${size}" height="${size}" role="img" aria-label="${title}">
<title>${title}</title>
<desc>PROPOSAL. Single-colour version: blades are inset so the seams are real gaps (transparent), no knock-out masks. Recolour by editing the fill on the group.</desc>
<g fill="${color}" fill-rule="evenodd"><path id="blades" d="${d}"/><path id="play" d="${tri}"/></g>
</svg>
`;
}
export const characterSVG = (o = {}) => markSVG({ title: 'Amrita (character, PROPOSAL)', ...o, eyes: true });
export default { drawAmrita, drawProp, drawMark, EXPR, STYLES, blinkAmount, eyeAnim, hoverBob, poseAt, lookToward, clapAt, mixEye, eyeFor, markSVG, monoSVG, characterSVG, GEO };
