// =============================================================================
// e1993 — THE FIRST DIGITAL CREATURES (16.0-18.0, 1.85:1, CLEAN DIGITAL, prop: clapperboard, portal EYE @ (1000,450) r=120)
//   This era is drawn with a RULER: no wobble, no boil, crisp vector fills with airbrush gradients (Amrita style 'clean').
//   Gradient dusk sky, a striped digital sun, straight-edged mountains, a perspective NEON GRID floor.
//   An original DIGITAL CREATURE (six-legged, armoured, long-necked, a big amber eye — not any film's animal) is a real little
//   3D mesh (~1200 triangles) projected through a pinhole camera and painted by a painter's algorithm in THREE modes:
//     WIREFRAME (cyan hidden-line look) -> FLAT-SHADED polygons -> SMOOTH (Gouraud via per-triangle gradients)
//   16.0-16.5  the wireframe walks across the grid (tripod gait, IK legs, swaying tail); Amrita (low left, clapperboard) winds up
//   16.50      CLAP + the SCAN: a bright vertical scanner bar sweeps left to right; behind it the mesh is flat-shaded, then smooth
//   17.00      ROAR (creature_roar): head thrown back, jaw open, shockwave rings, the grid ripples, the camera shudders
//   17.2-17.45 the head swings round to face us while the lens punches in; the EYE (glossy, slit pupil, specular glints) turns to
//              look at us and fills the portal circle (1000,450) r=120 exactly — pristine, unoccluded from 17.4 on.
// Pure function of T.t (no random, no state).
// =============================================================================
import * as P from '../pencil.js';
import { hash } from '../rng.js';
import { clamp, lerp, smooth, smoother, outCubic, outBack, spring } from '../ease.js';
import { ERAS } from '../../../shared/cues.js';

const ERA = ERAS[6], PORT = ERA.portal;            // {type:'eye', cx:1000, cy:450, r:120}
const T0 = ERA.t0, TAU = Math.PI * 2;
const SCAN_T = 16.5, ROAR_T = 17.0, TURN_T = 17.18, FINAL_T = 17.45, ZOOM_T = 17.16;
const FLAT_W = 230;                                // px of flat-shaded polygons trailing the scan bar

// ------------------------------------------------------------------ small vector maths
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vlen = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const vlerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgb = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const hex = (h) => P.hex2rgb(h);

// ------------------------------------------------------------------ camera: a pinhole at (0, 1.5, 15) looking slightly down; horizon at y = 515
const CAM = { F: 1700, cx: 960, cy: 615, y: 1.55, z: 17.6, hz: 590 };
const PH = Math.atan2(CAM.cy - CAM.hz, CAM.F), cPH = Math.cos(PH), sPH = Math.sin(PH);
function proj(p) {
  const dx = p[0], dy = p[1] - CAM.y, dz = p[2] - CAM.z;
  const zc = -dy * sPH - dz * cPH, yc = dy * cPH - dz * sPH, k = CAM.F / zc;
  return [CAM.cx + dx * k, CAM.cy - yc * k, zc];
}
const CAMPOS = [0, CAM.y, CAM.z];
const HZ = CAM.hz, DY = HZ - 515;                    // layout was drawn for a horizon at 515

// ------------------------------------------------------------------ creature motion
const V0 = 3.5, X_STOP = 2.0, STEP = 2.1, DC = STEP * 2;
function distLeft(t) {                             // metres still to walk before the stop at 16.95
  if (t <= 16.7) return V0 * (16.7 - t + 0.125);
  if (t >= 16.95) return 0;
  const u = (t - 16.7) / 0.25; return V0 * 0.25 * ((1 - u) - 0.5 + u * u * u - (u * u * u * u) / 2);
}
const speed = (t) => (t <= 16.7 ? V0 : t >= 16.95 ? 0 : V0 * (1 - smooth((t - 16.7) / 0.25)));
const frac = (x) => x - Math.floor(x);

function bodyState(t) {
  const X = X_STOP - distLeft(t), ph = X / DC, rear = smooth((t - 16.88) / 0.12);
  const bob = 0.075 * Math.sin(TAU * 2 * ph), pitch = 0.03 * Math.sin(TAU * 2 * ph + 1.2) + 0.075 * rear;
  return { X, ph, bob, pitch, cp: Math.cos(pitch), sp: Math.sin(pitch) };
}
const bodyPt = (B, l) => [B.X + l[0] * B.cp - l[1] * B.sp, 0.0 + B.bob + l[0] * B.sp + l[1] * B.cp, l[2]];
const bodyN = (B, n) => [n[0] * B.cp - n[1] * B.sp, n[0] * B.sp + n[1] * B.cp, n[2]];

// piecewise keyframe track with per-segment easing
function track(t, keys) {
  if (t <= keys[0].t) return keys[0].v.slice();
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i].t) {
      const a = keys[i - 1], b = keys[i], u = clamp((t - a.t) / (b.t - a.t)), e = b.ease === 'back' ? outBack(u, 1.6) : b.ease === 'lin' ? u : smooth(u);
      return a.v.map((x, k) => x + (b.v[k] - x) * e);
    }
  }
  return keys[keys.length - 1].v.slice();
}
//                  rel x   y    z    psi   theta  jaw
const HEAD_KEYS = [
  { t: 16.0, v: [1.95, 2.05, 0.10, 0.04, -0.10, 0.04] },
  { t: 16.5, v: [2.10, 2.30, 0.00, 0.00, -0.04, 0.03] },
  { t: 16.9, v: [1.75, 1.95, 0.00, 0.00, -0.24, 0.03] },
  { t: 17.08, v: [0.25, 2.30, 0.00, 0.00, 0.98, 1.00], ease: 'back' },
  { t: 17.18, v: [0.20, 2.35, 0.00, 0.00, 1.02, 0.95] },
  { t: 17.45, v: [1.55, 1.75, 2.60, 0.58, -0.10, 0.16] },
];
const SHOULDER = [2.05, 2.7, 0];                    // neck root in body space

function headPose(t, B) {
  const k = track(Math.min(t, FINAL_T), HEAD_KEYS);
  const trem = t > ROAR_T + 0.05 && t < ROAR_T + 0.3 ? 0.05 * Math.sin(t * 95) : 0;
  const S = bodyPt(B, SHOULDER), rel = [k[0], k[1], k[2]], psi = k[3], th = k[4], jaw = clamp(k[5] + trem, 0, 1.2);
  const H = add(S, rel);
  const xh = norm([Math.cos(th) * Math.cos(psi), Math.sin(th), Math.cos(th) * Math.sin(psi)]);
  const zh = norm(cross(xh, [0, 1, 0])), yh = cross(zh, xh);
  const thN = th + 1.1, tN = norm([Math.cos(thN) * Math.cos(psi), Math.sin(thN), Math.cos(thN) * Math.sin(psi)]);   // the neck enters the skull from below/behind
  const O = sub(H, mul(xh, 0.12));
  return { S, H, O, xh, yh, zh, tN, jaw, psi, th };
}
const hp = (Hd, l) => add(Hd.O, add(add(mul(Hd.xh, l[0]), mul(Hd.yh, l[1])), mul(Hd.zh, l[2])));
const EYE_L = [0.26, 0.20, 0.43], EYE_R = 0.27;
function eyeInfo(t) {
  const B = bodyState(t), Hd = headPose(t, B), E = hp(Hd, EYE_L), q = proj(E), nE = norm(add(add(mul(Hd.zh, 0.9), mul(Hd.xh, 0.28)), mul(Hd.yh, 0.1))), toCam = norm(sub(CAMPOS, E));
  return { E, p: q, r: (CAM.F * EYE_R) / q[2], n: nE, toCam, facing: dot(nE, toCam), Hd, B };
}
const FINAL_EYE = eyeInfo(FINAL_T);
const ZF = PORT.r / FINAL_EYE.r;                    // final lens punch-in so the eye is exactly r = 120

// ------------------------------------------------------------------ mesh builders (world-space triangles)
function triS(M, a, b, c, na, nb, nc, mat) {         // smooth: orientation from the vertex normals
  let fn = norm(cross(sub(b, a), sub(c, a)));
  if (dot(fn, add(add(na, nb), nc)) < 0) { [b, c] = [c, b]; [nb, nc] = [nc, nb]; fn = mul(fn, -1); }
  M.push({ a, b, c, na, nb, nc, fn, mat, dbl: false });
}
function triF(M, a, b, c, center, mat, dbl = false) { // flat: orientation away from `center`
  let fn = norm(cross(sub(b, a), sub(c, a)));
  const cen = mul(add(add(a, b), c), 1 / 3);
  if (!dbl && dot(fn, sub(cen, center)) < 0) { [b, c] = [c, b]; fn = mul(fn, -1); }
  M.push({ a, b, c, na: fn, nb: fn, nc: fn, fn, mat, dbl });
}
function tube(M, path, sides, mat, o = {}) {        // path: [{p, r (along ref), rs (along side)}]
  const m = path.length, rings = []; let nPrev = o.ref || [0, 0, 1];
  for (let i = 0; i < m; i++) {
    const pa = path[Math.max(0, i - 1)].p, pb = path[Math.min(m - 1, i + 1)].p, t = norm(sub(pb, pa));
    let nn = sub(nPrev, mul(t, dot(nPrev, t))); if (vlen(nn) < 1e-4) nn = Math.abs(t[1]) < 0.9 ? cross(t, [0, 1, 0]) : cross(t, [1, 0, 0]); nn = norm(nn);
    const sd = cross(t, nn), r = path[i].r, rs = path[i].rs ?? r, ring = []; nPrev = nn;
    for (let k = 0; k < sides; k++) { const a = (k / sides) * TAU, c = Math.cos(a), s = Math.sin(a); ring.push({ p: add(path[i].p, add(mul(nn, r * c), mul(sd, rs * s))), n: norm(add(mul(nn, c * rs), mul(sd, s * r))) }); }
    rings.push({ ring, t });
  }
  for (let i = 0; i < m - 1; i++) for (let k = 0; k < sides; k++) {
    const a = rings[i].ring[k], b = rings[i].ring[(k + 1) % sides], c = rings[i + 1].ring[(k + 1) % sides], d = rings[i + 1].ring[k];
    triS(M, a.p, b.p, c.p, a.n, b.n, c.n, mat); triS(M, a.p, c.p, d.p, a.n, c.n, d.n, mat);
  }
  const cap = (idx, dir) => { const c0 = path[idx].p, rg = rings[idx].ring; for (let k = 0; k < sides; k++) triS(M, c0, rg[k].p, rg[(k + 1) % sides].p, dir, dir, dir, mat); };
  if (o.capStart) cap(0, mul(rings[0].t, -1)); if (o.capEnd) cap(m - 1, rings[m - 1].t);
}
function ellipsoid(M, c, ax, ay, az, nLat, nLon, mat, B = null) {
  const V = [];
  for (let i = 0; i <= nLat; i++) { const th = (Math.PI * i) / nLat, st = Math.sin(th), ct = Math.cos(th); const row = []; for (let j = 0; j <= nLon; j++) { const ph = (TAU * j) / nLon, u = [st * Math.cos(ph), ct, st * Math.sin(ph)]; let p = [c[0] + ax * u[0], c[1] + ay * u[1], c[2] + az * u[2]], n = norm([u[0] / ax, u[1] / ay, u[2] / az]); if (B) { p = bodyPt(B, p); n = bodyN(B, n); } row.push({ p, n }); } V.push(row); }
  for (let i = 0; i < nLat; i++) for (let j = 0; j < nLon; j++) { const a = V[i][j], b = V[i][j + 1], cc = V[i + 1][j + 1], d = V[i + 1][j]; if (i > 0) triS(M, a.p, b.p, cc.p, a.n, b.n, cc.n, mat); if (i < nLat - 1) triS(M, a.p, cc.p, d.p, a.n, cc.n, d.n, mat); }
}
function plate(M, c, nrm, upHint, size, height, sides, mat, topK = 0.5, rot = 0) {   // flat hex scute: raised flat-topped pyramid
  const n = norm(nrm); let u = sub(upHint, mul(n, dot(upHint, n))); if (vlen(u) < 1e-3) u = cross(n, [1, 0, 0]); u = norm(u); const v = cross(n, u);
  const base = [], top = [], tc = add(c, mul(n, height)), cen = add(c, mul(n, height * 0.3));
  for (let k = 0; k < sides; k++) { const a = rot + (k / sides) * TAU, d = add(mul(u, Math.cos(a)), mul(v, Math.sin(a))); base.push(add(c, mul(d, size))); top.push(add(tc, mul(d, size * topK))); }
  for (let k = 0; k < sides; k++) { const k2 = (k + 1) % sides; triF(M, base[k], base[k2], top[k2], cen, mat); triF(M, base[k], top[k2], top[k], cen, mat); triF(M, tc, top[k], top[k2], cen, mat); }
}
function cone(M, b, dir, r, L, sides, mat, up = [0, 1, 0]) {
  const d = norm(dir); let u = sub(up, mul(d, dot(up, d))); if (vlen(u) < 1e-3) u = cross(d, [1, 0, 0]); u = norm(u); const v = cross(d, u), apex = add(b, mul(d, L)), cen = add(b, mul(d, L * 0.3)), ring = [];
  for (let k = 0; k < sides; k++) { const a = (k / sides) * TAU; ring.push(add(b, add(mul(u, Math.cos(a) * r), mul(v, Math.sin(a) * r)))); }
  for (let k = 0; k < sides; k++) triF(M, ring[k], ring[(k + 1) % sides], apex, cen, mat);
}
const bez = (p0, p1, p2, p3, t) => { const u = 1 - t; return [0, 1, 2].map((i) => u * u * u * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2[i] + t * t * t * p3[i]); };

// ------------------------------------------------------------------ the creature
const LEGS = [{ hx: 1.75, s: 1, g: 0 }, { hx: 1.75, s: -1, g: 1 }, { hx: 0.0, s: 1, g: 1 }, { hx: 0.0, s: -1, g: 0 }, { hx: -1.75, s: 1, g: 0 }, { hx: -1.75, s: -1, g: 1 }];
const MAT = {
  skin: { c: hex('#35BE7C'), spec: 0.12 }, skinD: { c: hex('#1F9468'), spec: 0.1 }, plate: { c: hex('#F4B83A'), spec: 0.55 },
  roof: { c: hex('#7A1040'), spec: 0.0 }, frill: { c: hex('#FF4F9A'), spec: 0.2 }, tongue: { c: hex('#E0558E'), spec: 0.1 }, tooth: { c: hex('#FFF4DC'), spec: 0.4 }, belly: { c: hex('#7FD99A'), spec: 0.1 },
};
function legIK(H, F, hint, l1 = 1.55, l2 = 1.7) {
  const d0 = sub(F, H); let d = vlen(d0); const dir = norm(d0); d = Math.min(d, l1 + l2 - 0.02);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  let bend = sub(hint, mul(dir, dot(hint, dir))); bend = norm(bend);
  return add(add(H, mul(dir, a)), mul(bend, h));
}
function buildCreature(t) {
  const M = [], B = bodyState(t), Hd = headPose(t, B), v = speed(t);
  // --- torso (smooth ellipsoid) + dorsal scutes
  ellipsoid(M, [0, 2.15, 0], 2.55, 1.18, 1.3, 11, 14, 'skin', B);
  const topAt = (x, z) => { const k = 1 - (x / 2.55) ** 2 - (z / 1.3) ** 2; return k > 0 ? 2.15 + 1.18 * Math.sqrt(k) : 2.15; };
  const topN = (x, z) => norm([x / (2.55 * 2.55), (topAt(x, z) - 2.15) / (1.18 * 1.18), z / (1.3 * 1.3)]);
  for (let i = 0; i < 7; i++) {                   // overlapping armour bands arching over the back (gold), each with a spine
    const x = -1.95 + i * 0.66, kx = Math.sqrt(Math.max(0.02, 1 - (x / 2.55) ** 2)), ay = 1.18 * kx * 1.06, az = 1.3 * kx * 1.06, path = [];
    for (let k = 0; k <= 8; k++) { const a = lerp(-1.4, 1.4, k / 8); path.push({ p: bodyPt(B, [x, 2.15 + ay * Math.cos(a), az * Math.sin(a)]), r: 0.23 - 0.02 * Math.abs(i - 3), rs: 0.11 }); }
    tube(M, path, 5, 'plate', { ref: bodyN(B, [1, 0, 0]), capStart: true, capEnd: true });
    const topP = bodyPt(B, [x, 2.15 + ay + 0.04, 0]), tn = bodyN(B, topN(x, 0));
    cone(M, topP, tn, 0.2 - 0.012 * Math.abs(i - 3), 0.62 - 0.04 * Math.abs(i - 3), 5, 'plate', bodyN(B, [1, 0, 0]));
    for (const sgn of [-1, 1]) { const a = sgn * 0.85, q = bodyPt(B, [x, 2.15 + ay * Math.cos(a) + 0.02, az * Math.sin(a)]); cone(M, q, norm([0, Math.cos(a), Math.sin(a)]), 0.12, 0.34, 4, 'plate', bodyN(B, [1, 0, 0])); }
  }
  // --- legs (tripod gait, 2-bone IK) + knee scutes + foot pads
  const settle = smooth((t - 16.85) / 0.2);
  LEGS.forEach((L, li) => {
    const p = frac(B.ph + 0.5 * L.g); let fx, lift = 0;
    if (p < 0.5) fx = STEP / 2 - (p / 0.5) * STEP; else { const u = (p - 0.5) / 0.5; fx = -STEP / 2 + smooth(u) * STEP; lift = Math.sin(Math.PI * u) * 0.55; }
    fx = lerp(fx, 0, settle); lift = lift * (1 - settle) + Math.sin(Math.PI * settle) * 0.12 * (settle < 1 ? 1 : 0);
    const hip = bodyPt(B, [L.hx, 1.72, L.s * 0.95]), foot = [B.X + L.hx + fx, 0.0 + lift, L.s * 1.75], ank = add(foot, [0, 0.22, 0]);
    const knee = legIK(hip, ank, [0.25, 0.55, L.s * 1.0]);
    tube(M, [{ p: add(hip, [0, 0.0, 0]), r: 0.42 }, { p: knee, r: 0.30 }, { p: ank, r: 0.2 }], 6, 'skinD', { ref: [0, 0, 1], capEnd: true });
    plate(M, add(knee, [0, 0, 0]), norm([0.2, 0.35, L.s]), [0, 1, 0], 0.27, 0.18, 6, 'plate', 0.5);
    plate(M, [foot[0], foot[1] + 0.02, foot[2]], [0, 1, 0], [1, 0, 0], 0.46, 0.2, 6, 'skinD', 0.7, 0.3);
  });
  // --- tail (sways like a travelling wave), club + spikes
  const tw = TAU * B.ph * 2, tail = [], N = 8;
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1), lx = -2.3 - u * 4.5, ly = 1.95 - u * 0.95 + 0.25 * Math.sin(u * 3), lz = Math.sin(tw * 0.5 + u * 3.2) * 0.55 * u;
    tail.push({ p: bodyPt(B, [lx, ly, 0]).map((q, k) => (k === 2 ? lz : q)), r: 0.62 * (1 - 0.8 * u) + 0.08 });
  }
  tube(M, tail, 6, 'skin', { ref: [0, 0, 1], capEnd: true });
  const tipP = tail[N - 1].p; ellipsoid(M, tipP, 0.3, 0.3, 0.3, 5, 8, 'plate');
  for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; cone(M, add(tipP, [0, Math.sin(a) * 0.25, Math.cos(a) * 0.25]), [0.2, Math.sin(a), Math.cos(a)], 0.1, 0.4, 4, 'plate'); }
  for (let i = 1; i < N - 2; i++) { const q = tail[i].p; cone(M, add(q, [0, tail[i].r * 0.9, 0]), [-0.3, 1, 0], 0.17 - 0.012 * i, 0.38 - 0.03 * i, 4, 'plate'); }
  // --- neck: cubic bezier from the shoulder to the skull, with spines
  const S0 = bodyPt(B, [SHOULDER[0] - 0.55, SHOULDER[1] - 0.45, 0]), P1 = add(S0, mul(norm([0.5 + 0.0, 1, 0]), 1.5)), P3 = Hd.O, P2 = sub(P3, mul(Hd.tN, 1.45)), neck = [], NN = 10;
  for (let i = 0; i < NN; i++) { const u = i / (NN - 1); neck.push({ p: bez(S0, P1, P2, P3, u), r: lerp(0.62, 0.27, Math.pow(u, 0.8)) }); }
  tube(M, neck, 7, 'skin', { ref: [0, 0, 1] });
  for (let i = 2; i < NN - 1; i += 1) {
    const a = neck[i - 1].p, b = neck[i + 1].p, tg = norm(sub(b, a)), nrm = norm([-tg[1], tg[0], 0.0001]);
    plate(M, add(neck[i].p, mul(nrm, neck[i].r * 0.85)), nrm, tg, 0.2 + 0.05 * (1 - i / NN), 0.2, 5, 'plate', 0.5);
  }
  // --- head: skull+snout tube, lower jaw (hinged), brow plates, frill, teeth, mouth interior, eye socket bump
  const HP = (l) => hp(Hd, l);
  const sk = [[-0.15, 0.00, 0.40, 0.40], [0.25, 0.05, 0.50, 0.52], [0.75, -0.01, 0.38, 0.42], [1.2, -0.08, 0.28, 0.30], [1.62, -0.13, 0.18, 0.20]].map(([x, y, r, rs]) => ({ p: HP([x, y, 0]), r, rs }));
  tube(M, sk, 8, 'skin', { ref: Hd.yh, capStart: true, capEnd: true });
  const hinge = [0.12, -0.32], ja = Hd.jaw, jc = Math.cos(ja), js = Math.sin(ja);
  const JP = (x, y, z) => { const dx = x - hinge[0], dy = y - hinge[1]; return HP([hinge[0] + dx * jc + dy * js, hinge[1] - dx * js + dy * jc, z]); };
  const jawSec = [[0.1, -0.36, 0.12, 0.30], [0.55, -0.42, 0.11, 0.25], [1.0, -0.43, 0.10, 0.19], [1.5, -0.38, 0.075, 0.12]].map(([x, y, r, rs]) => ({ p: JP(x, y, 0), r, rs }));
  tube(M, jawSec, 6, 'skinD', { ref: Hd.yh, capEnd: true, capStart: true });
  // mouth interior (double-sided): palate + tongue
  if (ja > 0.12) {
    const pal = [HP([0.2, -0.3, -0.26]), HP([0.2, -0.3, 0.26]), HP([1.5, -0.2, 0.1]), HP([1.5, -0.2, -0.1])];
    triF(M, pal[0], pal[1], pal[2], mul(add(pal[0], pal[2]), 0.5), 'roof', true); triF(M, pal[0], pal[2], pal[3], mul(add(pal[0], pal[2]), 0.5), 'roof', true);
    const fl = [JP(0.2, -0.3, -0.2), JP(0.2, -0.3, 0.2), JP(1.35, -0.31, 0.07), JP(1.35, -0.31, -0.07)];
    triF(M, fl[0], fl[1], fl[2], mul(add(fl[0], fl[2]), 0.5), 'tongue', true); triF(M, fl[0], fl[2], fl[3], mul(add(fl[0], fl[2]), 0.5), 'tongue', true);
    for (let k = 0; k < 5; k++) { const x = 0.75 + k * 0.17; for (const s of [-1, 1]) { cone(M, HP([x, -0.3 + 0.01 * k, s * (0.2 - 0.02 * k)]), sub(HP([x + 0.02, -0.52, s * (0.2 - 0.02 * k)]), HP([x, -0.3, s * (0.2 - 0.02 * k)])), 0.045, 0.18, 4, 'tooth'); cone(M, JP(x + 0.04, -0.33, s * (0.17 - 0.02 * k)), sub(HP([x + 0.04, -0.1, 0]), HP([x + 0.04, -0.3, 0])), 0.04, 0.15, 4, 'tooth'); } }
  }
  for (const s of [-1, 1]) {
    plate(M, HP([0.32, 0.46, s * 0.30]), norm(add(mul(Hd.yh, 1), mul(Hd.zh, s * 0.5))), Hd.xh, 0.2, 0.18, 5, 'plate', 0.5);
    plate(M, HP([0.7, 0.34, s * 0.2]), norm(add(mul(Hd.yh, 1), mul(Hd.zh, s * 0.4))), Hd.xh, 0.14, 0.14, 5, 'plate', 0.5);
    ellipsoid(M, HP([EYE_L[0], EYE_L[1], s * EYE_L[2] * 0.82]), 0.36, 0.34, 0.3, 6, 10, 'skin', null);    // the socket bump / eyelid ring (skin) around the eye
  }
  {   // the frill: a fan of gold spines with hot-pink membrane between them
    const base = HP([-0.05, 0.22, 0]), tips = [];
    for (let k = -3; k <= 3; k++) { const dir = norm(add(mul(Hd.xh, -0.75), add(mul(Hd.yh, 0.42 + 0.14 * (3 - Math.abs(k)) * 0.5), mul(Hd.zh, k * 0.34)))), L = 1.05 - 0.09 * Math.abs(k), b0 = HP([-0.05, 0.22 + 0.04 * (3 - Math.abs(k)) * 0.3, k * 0.13]); cone(M, b0, dir, 0.075, L, 4, 'plate', Hd.yh); tips.push(add(b0, mul(dir, L * 0.96))); }
    for (let k = 0; k < tips.length - 1; k++) triF(M, tips[k], tips[k + 1], base, mul(add(add(tips[k], tips[k + 1]), base), 1 / 3), 'frill', true);
  }
  for (const s of [-1, 1]) cone(M, HP([0.5, 0.42, s * 0.2]), add(mul(Hd.xh, 0.45), mul(Hd.yh, 1)), 0.09, 0.5, 5, 'plate', Hd.xh);
  cone(M, HP([1.5, 0.05, 0]), add(mul(Hd.xh, 0.4), mul(Hd.yh, 1)), 0.07, 0.3, 4, 'plate', Hd.xh);
  return { M, B, Hd };
}

// ------------------------------------------------------------------ shading
const KEY = norm([-0.5, 0.72, 0.46]), RIMD = norm([0.35, 0.25, -1]);
const SKY_C = [0.62, 0.34, 0.78], GND_C = [0.16, 0.62, 0.78], KEY_C = [1.0, 0.93, 0.82], RIM_C = [1.0, 0.55, 0.32];
function shadeV(n, mat, view) {
  const m = MAT[mat], ndl = Math.max(0, dot(n, KEY)), hemi = 0.5 + 0.5 * n[1];
  const amb = [lerp(GND_C[0], SKY_C[0], hemi), lerp(GND_C[1], SKY_C[1], hemi), lerp(GND_C[2], SKY_C[2], hemi)];
  const rim = Math.pow(Math.max(0, dot(n, RIMD)), 1.6) * Math.pow(1 - clamp(dot(n, view), 0, 1), 1.4) * 0.7;
  const h = norm(add(KEY, view)), spec = Math.pow(Math.max(0, dot(n, h)), 36) * m.spec * 255;
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) out[i] = clamp(m.c[i] * (amb[i] * 0.55 + KEY_C[i] * ndl * 0.82) + RIM_C[i] * rim * 255 + spec, 0, 255);
  return out;
}
function gouraud(ctx, p, c) {
  const l = c.map((k) => 0.299 * k[0] + 0.587 * k[1] + 0.114 * k[2]);
  const e1x = p[1][0] - p[0][0], e1y = p[1][1] - p[0][1], e2x = p[2][0] - p[0][0], e2y = p[2][1] - p[0][1], det = e1x * e2y - e1y * e2x;
  const avg = [(c[0][0] + c[1][0] + c[2][0]) / 3, (c[0][1] + c[1][1] + c[2][1]) / 3, (c[0][2] + c[1][2] + c[2][2]) / 3];
  let fill = rgb(avg), stroke = fill;
  if (Math.abs(det) > 1e-6) {
    const d1 = l[1] - l[0], d2 = l[2] - l[0], gx = (d1 * e2y - d2 * e1y) / det, gy = (e1x * d2 - e2x * d1) / det, gl = Math.hypot(gx, gy);
    if (gl > 1e-5) {
      const dx = gx / gl, dy = gy / gl, s = p.map((q) => (q[0] - p[0][0]) * dx + (q[1] - p[0][1]) * dy), smin = Math.min(...s), smax = Math.max(...s);
      if (smax - smin > 0.5) {
        const g = ctx.createLinearGradient(p[0][0] + dx * smin, p[0][1] + dy * smin, p[0][0] + dx * smax, p[0][1] + dy * smax);
        [0, 1, 2].sort((a, b) => s[a] - s[b]).forEach((i) => g.addColorStop(clamp((s[i] - smin) / (smax - smin), 0, 1), rgb(c[i])));
        fill = stroke = g;
      }
    }
  }
  ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]); ctx.lineTo(p[1][0], p[1][1]); ctx.lineTo(p[2][0], p[2][1]); ctx.closePath(); ctx.fill(); ctx.lineWidth = 0.9; ctx.stroke();
}

// ------------------------------------------------------------------ painting the creature (painter's algorithm, 3 render modes split by the scan bar)
const WIRE_C = { skin: '#52F1FF', skinD: '#40D8F0', plate: '#FFE070', roof: '#FF63B4', tongue: '#FF63B4', tooth: '#FFFFFF', belly: '#52F1FF', frill: '#FF8AD0' };
const SCAN_D = 0.45, SCAN_LAG = 0.1;
function scanX(t) { return t < SCAN_T ? -1e5 : t >= SCAN_T + SCAN_D ? 1e5 : lerp(-140, 2080, (t - SCAN_T) / SCAN_D); }
function paintCreature(ctx, t, cr, sx, sx2) {
  const { M } = cr, tris = [];
  for (const T3 of M) {
    const pa = proj(T3.a), pb = proj(T3.b), pc = proj(T3.c);
    if (pa[2] < 0.5 || pb[2] < 0.5 || pc[2] < 0.5) continue;
    const cen = mul(add(add(T3.a, T3.b), T3.c), 1 / 3), view = norm(sub(CAMPOS, cen)), facing = dot(T3.fn, view);
    if (!T3.dbl && facing <= 0) continue;
    tris.push({ T3, p: [pa, pb, pc], d: (pa[2] + pb[2] + pc[2]) / 3, cx: (pa[0] + pb[0] + pc[0]) / 3, view, facing });
  }
  tris.sort((a, b) => b.d - a.d);
  ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const wireIdx = [];
  for (const q of tris) {
    const mode = q.cx > sx ? 0 : q.cx > sx2 ? 1 : 2, T3 = q.T3, P3 = q.p;
    if (mode === 0) {
      // wireframe: dark translucent fill (so far edges dim), bright neon edges, brighter for nearer faces
      ctx.fillStyle = 'rgba(14,6,52,0.62)'; ctx.beginPath(); ctx.moveTo(P3[0][0], P3[0][1]); ctx.lineTo(P3[1][0], P3[1][1]); ctx.lineTo(P3[2][0], P3[2][1]); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = WIRE_C[T3.mat]; ctx.globalAlpha = clamp(1.25 - (q.d - 10) / 22, 0.45, 1); ctx.lineWidth = 1.5; ctx.stroke(); ctx.globalAlpha = 1;
      wireIdx.push(q);
    } else if (mode === 1) {
      const n = (T3.dbl && q.facing < 0) ? mul(T3.fn, -1) : T3.fn, c = shadeV(n, T3.mat, q.view);
      const hot = clamp(1 - (sx - q.cx) / 70, 0, 1);              // polygons just behind the scan bar glow white at their edges
      ctx.fillStyle = rgb(hot > 0 ? mixc(c, [255, 255, 255], hot * 0.35) : c); ctx.strokeStyle = hot > 0 ? `rgba(255,255,255,${0.35 + 0.65 * hot})` : rgb(mixc(c, [10, 8, 40], 0.18)); ctx.lineWidth = hot > 0 ? 0.9 + 0.9 * hot : 0.9;
      ctx.beginPath(); ctx.moveTo(P3[0][0], P3[0][1]); ctx.lineTo(P3[1][0], P3[1][1]); ctx.lineTo(P3[2][0], P3[2][1]); ctx.closePath(); ctx.fill(); ctx.stroke();
    } else {
      const flip = T3.dbl && q.facing < 0, nn = [T3.na, T3.nb, T3.nc].map((n) => (flip ? mul(n, -1) : n));
      const verts = [T3.a, T3.b, T3.c], cols = nn.map((n, i) => shadeV(n, T3.mat, norm(sub(CAMPOS, verts[i]))));
      gouraud(ctx, P3, cols);
    }
  }
  // neon glow over the wire part (one additive pass)
  if (wireIdx.length) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = 'rgba(60,220,255,0.10)'; ctx.lineWidth = 5; ctx.beginPath();
    for (const q of wireIdx) { ctx.moveTo(q.p[0][0], q.p[0][1]); ctx.lineTo(q.p[1][0], q.p[1][1]); ctx.lineTo(q.p[2][0], q.p[2][1]); ctx.closePath(); } ctx.stroke(); ctx.restore();
  }
  ctx.restore();
}

// ------------------------------------------------------------------ the EYE
function paintEye(ctx, t, ei, sx, sx2) {
  if (ei.facing < 0.04) return;
  const [x, y] = ei.p, r = ei.r, mode = x > sx ? 0 : x > sx2 ? 1 : 2;
  const look = smooth((t - 17.12) / 0.3), fill = smooth((t - 17.18) / 0.27);
  // gaze: head forward -> toward us
  const fwd = norm(add(ei.Hd.xh, mul(ei.Hd.yh, -0.1))), gaze = norm(vlerp(fwd, ei.toCam, look)), pg = proj(add(ei.E, mul(gaze, 0.4)));
  let gx = pg[0] - x, gy = pg[1] - y; const gl = Math.hypot(gx, gy) || 1, mag = clamp(gl / ((CAM.F * 0.4) / ei.p[2]), 0, 1); gx /= gl; gy /= gl;
  const ir = r * (0.8 + 0.22 * fill), off = mag * r * 0.52 * (1 - fill), ix = x + gx * off, iy = y + gy * off, ratio = Math.sqrt(1 - mag * mag * (1 - fill)), ang = Math.atan2(gy, gx);
  ctx.save();
  if (mode === 0) {
    ctx.strokeStyle = '#52F1FF'; ctx.lineWidth = Math.max(1.5, r * 0.08); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
    ctx.lineWidth = Math.max(1, r * 0.05); ctx.beginPath(); ctx.arc(ix, iy, ir * 0.62, 0, TAU); ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); ctx.stroke();
    ctx.restore(); return;
  }
  const flat = mode === 1;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.clip();
  // eyeball base (dark amber)
  ctx.fillStyle = flat ? '#8A3A08' : (() => { const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r); g.addColorStop(0, '#C45E0E'); g.addColorStop(1, '#4A1A02'); return g; })(); ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  // iris (ellipse foreshortened along the gaze direction)
  ctx.save(); ctx.translate(ix, iy); ctx.rotate(ang); ctx.scale(ratio, 1);
  const ig = ctx.createRadialGradient(0, 0, ir * 0.1, 0, 0, ir);
  if (flat) ctx.fillStyle = '#FFA21E'; else { ig.addColorStop(0, '#FFF2A0'); ig.addColorStop(0.35, '#FFD23A'); ig.addColorStop(0.75, '#FF9A1E'); ig.addColorStop(1, '#B04A00'); ctx.fillStyle = ig; }
  ctx.beginPath(); ctx.arc(0, 0, ir, 0, TAU); ctx.fill();
  if (!flat) {                                       // ruler-straight radial fibres
    ctx.lineCap = 'butt';
    for (let i = 0; i < 40; i++) { const a = (i / 40) * TAU; ctx.strokeStyle = i % 2 ? 'rgba(255,248,190,0.34)' : 'rgba(150,50,0,0.34)'; ctx.lineWidth = Math.max(0.8, ir * 0.028); ctx.beginPath(); ctx.moveTo(Math.cos(a) * ir * 0.3, Math.sin(a) * ir * 0.3); ctx.lineTo(Math.cos(a) * ir * 0.96, Math.sin(a) * ir * 0.96); ctx.stroke(); }
  }
  // limbal ring
  ctx.strokeStyle = 'rgba(70,24,0,0.9)'; ctx.lineWidth = ir * 0.085; ctx.beginPath(); ctx.arc(0, 0, ir * 0.955, 0, TAU); ctx.stroke();
  // slit pupil (dilates when it looks at us)
  const dil = 0.17 + 0.12 * fill + 0.03 * Math.sin(t * 7);
  ctx.fillStyle = '#0A0510'; ctx.beginPath(); ctx.ellipse(0, 0, ir * dil, ir * 0.7, -ang, 0, TAU); ctx.fill();
  ctx.restore();
  // outer edge shade (ties the ball into the socket)
  if (!flat) { const og = ctx.createRadialGradient(x, y, r * 0.78, x, y, r * 1.02); og.addColorStop(0, 'rgba(30,8,0,0)'); og.addColorStop(1, 'rgba(30,8,0,0.7)'); ctx.fillStyle = og; ctx.fillRect(x - r, y - r, 2 * r, 2 * r); }
  // glints: a softbox window (rounded rect) up-left, a dot down-right, a cool reflection of the neon grid along the bottom
  ctx.save(); ctx.translate(x - r * 0.34, y - r * 0.4); ctx.rotate(-0.3); ctx.fillStyle = 'rgba(255,255,255,0.96)'; ctx.beginPath(); ctx.roundRect(-r * 0.24, -r * 0.15, r * 0.48, r * 0.3, r * 0.06); ctx.fill(); ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(x + r * 0.4, y + r * 0.36, r * 0.07, 0, TAU); ctx.fill();
  if (!flat) { ctx.strokeStyle = 'rgba(90,240,255,0.5)'; ctx.lineWidth = r * 0.05; ctx.beginPath(); ctx.arc(x, y, r * 0.8, 0.28 * Math.PI, 0.72 * Math.PI); ctx.stroke(); }
  ctx.restore();
  // crisp dark edge ring (the eyeball's outline): drawn outside the portal radius' interior so the glass stays clean
  if (!flat) { ctx.save(); ctx.strokeStyle = 'rgba(20,6,0,0.9)'; ctx.lineWidth = Math.max(2, r * 0.05); ctx.beginPath(); ctx.arc(x, y, r + r * 0.025, 0, TAU); ctx.stroke(); ctx.restore(); }
}

// ------------------------------------------------------------------ the world (sky, sun, mountains, grid)
function drawSky(ctx) {
  const g = ctx.createLinearGradient(0, -800, 0, HZ + 4);
  [[0, '#06031E'], [0.5, '#1B0A55'], [0.72, '#4A1580'], [0.84, '#9A2C94'], [0.92, '#E84A86'], [0.97, '#FF8458'], [1, '#FFC46A']].forEach(([o, c]) => g.addColorStop(o, c));
  ctx.fillStyle = g; ctx.fillRect(-4000, -4000, 9920, 4000 + HZ + 4);
  // crisp stars (ruler: tiny squares)
  ctx.fillStyle = '#FFFFFF';
  for (let i = 0; i < 70; i++) { const x = hash(i, 3, 1) * 1920, y = 20 + hash(i, 3, 2) * 400, a = 0.25 + 0.6 * hash(i, 3, 3) * (1 - y / 480); ctx.globalAlpha = a; const s = hash(i, 3, 4) < 0.2 ? 3 : 2; ctx.fillRect(x, y, s, s); }
  ctx.globalAlpha = 1;
}
function drawSun(ctx) {
  const cx = 540, cy = 440 + DY, r = 175;
  // airbrush glow
  let g = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 3.2); g.addColorStop(0, 'rgba(255,120,150,0.55)'); g.addColorStop(1, 'rgba(255,120,150,0)'); ctx.fillStyle = g; ctx.fillRect(cx - r * 3.4, cy - r * 3.4, r * 6.8, r * 6.8);
  // striped disc: horizontal bands, the lower ones thinner and gapped (a ruler-straight digital sun)
  const gs = ctx.createLinearGradient(0, cy - r, 0, cy + r); gs.addColorStop(0, '#FFE46A'); gs.addColorStop(0.5, '#FF9A5A'); gs.addColorStop(1, '#FF3E8E');
  ctx.fillStyle = gs;
  const bands = [[-175, -60], [-52, -14], [-8, 18], [24, 44], [50, 66], [72, 84], [90, 99]];
  bands.forEach(([a, b]) => { ctx.save(); ctx.beginPath(); ctx.rect(cx - r, cy + a, 2 * r, b - a); ctx.clip(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill(); ctx.restore(); });
}
const FAR = [[-400, 474], [-200, 452], [-20, 488], [150, 430], [330, 480], [480, 446], [650, 494], [830, 438], [1000, 486], [1210, 432], [1390, 484], [1570, 442], [1780, 490], [1980, 448], [2320, 482]];
const NEAR = [[-400, 504], [-120, 480], [60, 508], [270, 484], [520, 514], [770, 482], [980, 512], [1210, 488], [1450, 516], [1690, 484], [1890, 510], [2320, 490]];
function drawMountains(ctx) {
  const ridge = (pts, c0, c1) => { const g = ctx.createLinearGradient(0, 420 + DY, 0, HZ + 4); g.addColorStop(0, c0); g.addColorStop(1, c1); ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(pts[0][0], HZ + 6); pts.forEach(([x, y]) => ctx.lineTo(x, y + DY)); ctx.lineTo(pts[pts.length - 1][0], HZ + 6); ctx.closePath(); ctx.fill(); };
  ridge(FAR, '#5A2490', '#C0489A');
  // sunlit facets (flat polygons) on the far ridge
  ctx.fillStyle = 'rgba(255,170,150,0.20)'; for (let i = 1; i < FAR.length - 1; i += 2) { const [x, y0] = FAR[i], y = y0 + DY; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 70, HZ + 4); ctx.lineTo(x - 18, HZ + 4); ctx.closePath(); ctx.fill(); }
  ridge(NEAR, '#2A1166', '#7A2C86');
  const hz = ctx.createLinearGradient(0, HZ - 70, 0, HZ + 8); hz.addColorStop(0, 'rgba(255,150,120,0)'); hz.addColorStop(1, 'rgba(255,190,130,0.55)'); ctx.fillStyle = hz; ctx.fillRect(-400, HZ - 70, 2800, 78);
}
function drawFloor(ctx) {
  const g = ctx.createLinearGradient(0, HZ, 0, 1200); g.addColorStop(0, '#4A1A70'); g.addColorStop(0.12, '#1C0E4E'); g.addColorStop(1, '#070622'); ctx.fillStyle = g; ctx.fillRect(-4000, HZ, 9920, 3000);
}
function ripple(x, z, t, cx0) {                       // vertical displacement of the floor from the roar's shockwave
  const d = t - ROAR_T; if (d < 0 || d > 1.4) return 0;
  const r = Math.hypot(x - cx0, (z - 0) * 1.0), front = d * 16, w = r - front, env = Math.exp(-d * 2.2) * Math.exp(-(w * w) / 18) * 1.0;
  return 0.42 * env * Math.cos(w * 1.7);
}
function drawGrid(ctx, t, cx0) {
  const live = t >= ROAR_T && t < ROAR_T + 1.4, N = live ? 36 : 2, fade = (zc) => clamp(1.15 - (zc - 6) / 70, 0.06, 1);
  ctx.save(); ctx.lineCap = 'butt';
  const pass = (w, a, col) => {
    ctx.lineWidth = w; ctx.strokeStyle = col;
    // lines running away from the camera (constant x)
    for (let xi = -60; xi <= 60; xi += 2) {
      let prev = null; ctx.beginPath();
      for (let k = 0; k <= N; k++) {
        const z = lerp(13.2, -110, k / N), y = live ? ripple(xi, z, t, cx0) : 0, p = proj([xi, y, z]); if (p[2] < 0.6) { prev = null; continue; }
        if (!prev) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); prev = p;
      }
      ctx.globalAlpha = a * (xi % 10 === 0 ? 1 : 0.78); ctx.stroke();
    }
    // lines across (constant z)
    for (let zi = 12; zi >= -110; zi -= 2) {
      const dz = CAM.z - zi; if (dz < 1.2) continue; ctx.beginPath(); let started = false;
      for (let k = 0; k <= N; k++) { const x = lerp(-60, 60, k / N), y = live ? ripple(x, zi, t, cx0) : 0, p = proj([x, y, zi]); if (!started) { ctx.moveTo(p[0], p[1]); started = true; } else ctx.lineTo(p[0], p[1]); }
      ctx.globalAlpha = a * fade(dz) * (zi % 10 === 0 ? 1 : 0.8); ctx.stroke();
    }
  };
  ctx.globalCompositeOperation = 'lighter'; pass(4.5, 0.10, '#20E4FF'); ctx.globalCompositeOperation = 'source-over'; pass(1.4, 0.92, '#2CE8FF');
  ctx.restore();
  // the horizon: a hot line + soft glow
  const hg = ctx.createLinearGradient(0, HZ - 3, 0, HZ + 26); hg.addColorStop(0, 'rgba(255,120,200,0.9)'); hg.addColorStop(1, 'rgba(255,120,200,0)'); ctx.fillStyle = hg; ctx.fillRect(-400, HZ - 1, 2800, 27);
}
function drawShadows(ctx, cr) {
  const B = cr.B; ctx.save();
  const sh = (x, z, rx, rz, a) => { const c = proj([x, 0, z]), e = proj([x + rx, 0, z]), f = proj([x, 0, z + rz]), ex = Math.abs(e[0] - c[0]), ey = Math.abs(f[1] - c[1]); ctx.save(); ctx.translate(c[0], c[1]); ctx.scale(1, Math.max(0.05, ey / ex)); const g = ctx.createRadialGradient(0, 0, 0, 0, 0, ex); g.addColorStop(0, `rgba(0,0,10,${a})`); g.addColorStop(0.7, `rgba(0,0,10,${a * 0.5})`); g.addColorStop(1, 'rgba(0,0,10,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, ex, 0, TAU); ctx.fill(); ctx.restore(); };
  sh(B.X, 0, 3.6, 1.8, 0.65);
  LEGS.forEach((L) => sh(B.X + L.hx, L.s * 1.75, 0.8, 0.5, 0.45));
  ctx.restore();
}
function drawScanBar(ctx, sx, t) {
  if (t < SCAN_T - 0.001 || t > SCAN_T + SCAN_D + 0.03) return;
  const x = sx, y0 = -400, y1 = 1500;
  ctx.save();
  const tr = ctx.createLinearGradient(x - 200, 0, x, 0); tr.addColorStop(0, 'rgba(70,230,255,0)'); tr.addColorStop(1, 'rgba(70,230,255,0.28)'); ctx.fillStyle = tr; ctx.fillRect(x - 200, y0, 200, y1 - y0);
  // scan lines in the trailing band (ruler-straight)
  ctx.strokeStyle = 'rgba(190,250,255,0.16)'; ctx.lineWidth = 1; ctx.beginPath(); for (let y = 0; y < 1100; y += 6) { ctx.moveTo(x - 200, y); ctx.lineTo(x, y); } ctx.stroke();
  const gl = ctx.createLinearGradient(x - 30, 0, x + 30, 0); gl.addColorStop(0, 'rgba(120,240,255,0)'); gl.addColorStop(0.5, 'rgba(180,250,255,0.55)'); gl.addColorStop(1, 'rgba(120,240,255,0)'); ctx.fillStyle = gl; ctx.fillRect(x - 30, y0, 60, y1 - y0);
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(x - 2, y0, 4, y1 - y0);
  // tick marks + caps (a bar drawn with a ruler)
  ctx.fillStyle = '#FFFFFF'; for (let y = 40; y < 1060; y += 40) ctx.fillRect(x + 4, y, y % 120 === 40 ? 22 : 11, 2);
  ctx.beginPath(); ctx.moveTo(x - 14, 22); ctx.lineTo(x + 14, 22); ctx.lineTo(x, 44); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(x - 14, 1058); ctx.lineTo(x + 14, 1058); ctx.lineTo(x, 1036); ctx.closePath(); ctx.fill();
  ctx.restore();
}
function drawRoarFx(ctx, t, ei) {
  const d = t - ROAR_T; if (d < 0 || d > 0.42) return;
  const m = proj(add(ei.Hd.O, add(mul(ei.Hd.xh, 1.5), mul(ei.Hd.yh, -0.2))));
  ctx.save(); ctx.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const dd = d - i * 0.07; if (dd <= 0) continue; const r = 40 + 1500 * smooth(dd / 0.38) * 0.75 * (1 + 0.0), a = (1 - clamp(dd / 0.36)) * 0.85;
    ctx.strokeStyle = i % 2 ? `rgba(255,120,210,${a})` : `rgba(160,250,255,${a})`; ctx.lineWidth = 7 - i; ctx.beginPath(); ctx.arc(m[0], m[1], r, 0, TAU); ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = `rgba(255,255,255,${a * 0.8})`; ctx.beginPath(); ctx.arc(m[0], m[1], r - 9, 0, TAU); ctx.stroke();
  }
  // radiating ticks (comic "sound" lines drawn with a ruler)
  const ra = (1 - clamp(d / 0.3)) * 0.9; ctx.strokeStyle = `rgba(255,255,255,${ra})`; ctx.lineWidth = 3;
  for (let i = 0; i < 18; i++) { const a = (i / 18) * TAU + 0.1, r0 = 70 + 330 * smooth(d / 0.3), r1 = r0 + 60 + 40 * hash(i, 4, 1); ctx.beginPath(); ctx.moveTo(m[0] + Math.cos(a) * r0, m[1] + Math.sin(a) * r0); ctx.lineTo(m[0] + Math.cos(a) * r1, m[1] + Math.sin(a) * r1); ctx.stroke(); }
  ctx.restore();
}

// ------------------------------------------------------------------ Amrita (low left, clapperboard) — style 'clean'
const AM = { x: 330, y: 838, R: 104 };
function drawAmrita(ctx, T, S, shk) {
  const t = T.t, lt = t - T0, R = AM.R, ca = S.amrita2d.clapAt(t, SCAN_T), bd = t - ROAR_T;
  const startle = bd >= 0 ? Math.exp(-bd / 0.18) * Math.cos(bd * 26) : 0, joy = smooth((bd - 0.35) / 0.2), sur = smooth((bd + 0.02) / 0.04) * (1 - smooth((bd - 0.3) / 0.25));
  const wind = smooth((t - 16.1) / 0.3) * (1 - smooth((t - SCAN_T) / 0.05));
  const hit = t >= SCAN_T ? Math.exp(-(t - SCAN_T) / 0.12) * Math.cos((t - SCAN_T) * 30) : 0;
  const hov = S.amrita2d.hoverBob(T, { size: R });
  const eye = { open: 1, surprised: 0.55 + 0.4 * sur, happy: 0.55 * (1 - sur * 0.6) + 0.35 * joy, determined: 0, lookX: 0.8, lookY: -0.35 };
  const ei = eyeInfo(Math.min(t, FINAL_T));
  const o = { x: AM.x + hov.dx + shk[0] * 0.5, y: AM.y + hov.dy - startle * 8 + shk[1] * 0.5, size: R, yaw: 0.45, roll: hov.roll + 0.05 * startle, squash: hov.squash + 0.1 * startle + 0.08 * hit, eye, style: 'clean', prop: 'clapper', propSide: 1, propAnim: { t, clap: ca.clap, hit: ca.hit }, propScale: 1.4, shadow: false, seed: 17 };
  if (bd >= 0.02 && bd < 0.5) { o.fx = [{ kind: 'exclaim' }]; o.fxT = bd; }
  // soft ground glow from the neon grid under her (airbrush)
  ctx.save(); const g = ctx.createRadialGradient(o.x, o.y + R * 1.0, 0, o.x, o.y + R * 1.0, R * 2.2); g.addColorStop(0, 'rgba(40,230,255,0.28)'); g.addColorStop(1, 'rgba(40,230,255,0)'); ctx.fillStyle = g; ctx.fillRect(o.x - R * 3, o.y - R, R * 6, R * 3.6); ctx.restore();
  S.amrita2d.drawAmrita(ctx, T, S, o);
}

// ================================================================== the frame
export default {
  id: 'e1993', kind: '2d',
  draw(ctx, T, S) {
    const t = T.t, B0 = bodyState(t), ei = eyeInfo(t), sx = scanX(t), sx2 = scanX(t - SCAN_LAG);
    // camera shudder (rolls off to exactly zero by 17.4) + zoom (lens punch-in about the eye) after the roar
    const d = t - ROAR_T, env = d >= 0 ? Math.exp(-d / 0.11) * (1 - smooth((d - 0.2) / 0.2)) : 0;
    const shk = [(hash(Math.floor(t * 60), 61, 1) - 0.5) * 2 * 16 * env, (hash(Math.floor(t * 60), 61, 2) - 0.5) * 2 * 12 * env, (hash(Math.floor(t * 60), 61, 3) - 0.5) * 2 * 0.006 * env];
    const zk = smoother((t - ZOOM_T) / (FINAL_T - ZOOM_T)), push = smooth((t - 16.96) / 0.14) * 0.24 * (1 - zk), z = Math.exp(Math.log(ZF) * zk + push), kq = Math.max(zk, push * 1.6), q = [lerp(ei.p[0], PORT.cx, kq), lerp(ei.p[1], PORT.cy, kq)];
    ctx.save();
    ctx.translate(960 + shk[0], 540 + shk[1]); ctx.rotate(shk[2]); ctx.translate(-960, -540);
    ctx.translate(q[0], q[1]); ctx.scale(z, z); ctx.translate(-ei.p[0], -ei.p[1]);
    drawSky(ctx); drawSun(ctx); drawMountains(ctx); drawFloor(ctx);
    drawGrid(ctx, t, B0.X);
    // airbrush rim glow behind the creature's head (follows it through the lens punch-in)
    { const hg = ctx.createRadialGradient(ei.p[0], ei.p[1], 0, ei.p[0], ei.p[1], 420); hg.addColorStop(0, `rgba(255,96,176,${0.30 + 0.12 * zk})`); hg.addColorStop(1, 'rgba(255,96,176,0)'); ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = hg; ctx.fillRect(ei.p[0] - 420, ei.p[1] - 420, 840, 840); ctx.restore(); }
    const cr = buildCreature(t);
    drawShadows(ctx, cr);
    paintCreature(ctx, t, cr, sx, sx2);
    paintEye(ctx, t, ei, sx, sx2);
    drawRoarFx(ctx, t, ei);
    drawScanBar(ctx, sx, t);
    // flash on the clap + the roar (airbrush, additive)
    ctx.restore();
    const fl = Math.max(t >= SCAN_T ? Math.exp(-(t - SCAN_T) / 0.05) * 0.22 : 0, d >= 0 ? Math.exp(-d / 0.05) * 0.16 : 0);
    if (fl > 0.01) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = `rgba(190,240,255,${fl})`; ctx.fillRect(0, 0, 1920, 1080); ctx.restore(); }
    drawAmrita(ctx, T, S, shk);
  },
  grade: () => ({}),
  barColor: '#06040f',
};
