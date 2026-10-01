// =============================================================================
// turn.js — THE TURN (22.0 – 26.0): the frozen Act-I frame is a REAL sheet of paper that TEARS and
// peels away, revealing the dark soundstage; a spot ignites on the director's chair; Amrita drops in.
//
//   22.0  FREEZE   the frozen Act-I frame (S.act1Frame(21.9999)) is a textured paper plane in 3D, filling the
//                  16:9 view exactly (shader inverts ACES so the first 3D frame matches the last 2D frame).
//   22.4  hairline crack of light            22.5  HIT L: five jagged cracks burst out of the centre, white-hot seam,
//   22.5-24.0  the five torn pieces PEEL (page-curl bend about a travelling fold line, cream back, white fibre rim),
//                  release, flutter and fly past the lens; light burst + rays dies down on a dark hazy stage.
//   24.0  HIT M: the spot ignites on the director's chair (analytic volumetric cone, dust motes, floor pool)
//   24.5-25.0  Amrita drops in (stretch) -> lands 25.0 (squash, shock ring, rim pops, chair swivels, eyes open)
//   25.0-26.0  hero push-in (35 -> 50 mm), title 'Meet Amrita.' is drawn by the engine in the 'lower' zone.
//
// Pure function of T.t. All "randomness" is hash based (rng.js). Libraries used: stage3d.createStage, amrita3d.createAmrita.
// Everything else (paper physics, beam, motes, burst) is local to this file.
// =============================================================================
import { createStage } from '../stage3d.js';
import { createAmrita } from '../amrita3d.js';
import { hash, hashSigned, noise1 } from '../rng.js';
import { clamp, lerp, smooth, spring, outCubic } from '../ease.js';

// ------------------------------------------------------------------ timeline / constants
const TEAR = 22.5, SPOT = 24.0, DROP = 24.5, LAND = 25.0;
const SENSOR_H = 20.25; // 16:9 crop of a 36 mm wide sensor: 35 mm lens -> 32.3 deg vertical
const ASPECT = 16 / 9;
const DP = 1.3; // camera -> paper distance at the freeze (m); the sheet is therefore ~1.34 x 0.75 m
const SEED = 2207;
const NC = 5; // number of cracks == number of pieces
const CELL = 0.0065; // paper mesh cell (m)
const MARGIN = 0.012; // the mesh is slightly larger than the frame so jitter never shows an edge
const RMAX = 1.0; // radial range of the crack tables (m)
const NT = 1024;
const DEG = Math.PI / 180;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const vfovOf = (mm) => (2 * Math.atan(SENSOR_H / 2 / mm)) / DEG;

// ------------------------------------------------------------------ camera path (stage metres)
const CAM = [
  { t: 22.5, p: [0.0, 1.55, 8.4], g: [0.0, 1.05, 0.0], mm: 35 },
  { t: 23.25, p: [0.1, 1.52, 8.12], g: [0.04, 1.05, 0.0], mm: 35 },
  { t: 24.0, p: [0.42, 1.42, 7.45], g: [0.22, 1.0, 0.1], mm: 37 },
  { t: 25.0, p: [0.85, 1.28, 6.3], g: [0.5, 1.0, 0.25], mm: 44 },
  { t: 26.0, p: [1.0, 1.25, 5.6], g: [0.55, 1.02, 0.3], mm: 50 },
];
function hermite(a, b, ma, mb, u, dt) { const u2 = u * u, u3 = u2 * u; return (2 * u3 - 3 * u2 + 1) * a + (u3 - 2 * u2 + u) * dt * ma + (-2 * u3 + 3 * u2) * b + (u3 - u2) * dt * mb; }
function camAt(t, out) {
  t = clamp(t, CAM[0].t, CAM[CAM.length - 1].t - 1e-6);
  let i = 0; while (i < CAM.length - 2 && t >= CAM[i + 1].t) i++;
  const k0 = CAM[i], k1 = CAM[i + 1], dt = k1.t - k0.t, u = (t - k0.t) / dt;
  const slope = (j, get) => { if (j === 0 || j === CAM.length - 1) return 0; const a = CAM[j - 1], b = CAM[j + 1]; return (get(b) - get(a)) / (b.t - a.t); };
  for (let n = 0; n < 3; n++) {
    out.p[n] = hermite(k0.p[n], k1.p[n], slope(i, (k) => k.p[n]), slope(i + 1, (k) => k.p[n]), u, dt);
    out.g[n] = hermite(k0.g[n], k1.g[n], slope(i, (k) => k.g[n]), slope(i + 1, (k) => k.g[n]), u, dt);
  }
  out.mm = hermite(k0.mm, k1.mm, slope(i, (k) => k.mm), slope(i + 1, (k) => k.mm), u, dt);
  return out;
}

// ------------------------------------------------------------------ the tear: crack field (shared by CPU mesh + GPU shader)
const CRACK_BASE = [-30, 40, 113, 190, 262].map((d, k) => d * DEG + hashSigned(SEED, k, 1) * 0.1);
function crackLat(k, r) { // lateral meander of crack k at radius r (m)
  const ramp = sstep(0.015, 0.2, r);
  return ramp * (0.032 * noise1(r / 0.32 + k * 11.3, SEED + k) + 0.015 * noise1(r / 0.09 + 7 + k * 5.1, SEED + 31 + k) + 0.0065 * noise1(r / 0.032 + 13 + k * 3.7, SEED + 57 + k));
}
const CRACK_OFF = Array.from({ length: NC }, (_, k) => { const a = new Float32Array(NT); for (let i = 0; i < NT; i++) { const r = (i / (NT - 1)) * RMAX; a[i] = crackLat(k, r) / Math.max(r, 0.05); } return a; });
function crackAngle(k, r) { const f = clamp(r / RMAX, 0, 1) * (NT - 1), i = Math.min(NT - 2, Math.floor(f)), u = f - i; return CRACK_BASE[k] + CRACK_OFF[k][i] * (1 - u) + CRACK_OFF[k][i + 1] * u; }
const wrapPi = (a) => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
const CRACK_C = [0.0, 0.012]; // crack origin on the sheet (m, from centre)
// signed arc distances to the piece's two cracks (+ = inside the wedge)
function wedgeDist(k, x, y) {
  const px = x - CRACK_C[0], py = y - CRACK_C[1], r = Math.hypot(px, py), phi = Math.atan2(py, px), kb = (k + 1) % NC;
  return [wrapPi(phi - crackAngle(k, r)) * r, wrapPi(crackAngle(kb, r) - phi) * r, r];
}

// ------------------------------------------------------------------ piece (petal) dynamics
const PIECES = Array.from({ length: NC }, (_, k) => {
  const kb = (k + 1) % NC;
  const a0 = crackAngle(k, 0.4), a1 = crackAngle(kb, 0.4) + (kb === 0 ? 2 * Math.PI : 0), phi = (a0 + a1) / 2;
  const h = (n) => hash(SEED, k, n);
  return {
    k, kA: k, kB: kb, phi, d: [Math.cos(phi), Math.sin(phi)], l: [-Math.sin(phi), Math.cos(phi)],
    t0: TEAR + [0.0, 0.045, 0.02, 0.075, 0.035][k], // stagger of the peel start
    dur: 0.78 + 0.26 * h(1), // time for the fold line to sweep the whole piece
    thMax: 2.72 + 0.3 * h(2), // final fold angle (rad), ~160-175 deg: cream back faces the lens
    rho0: 0.055 + 0.02 * h(3), rho1: 0.03 + 0.01 * h(4), // fold radius (m) start -> end
    twist: (h(5) < 0.5 ? -1 : 1) * (0.28 + 0.4 * h(6)), // roll of the flap about the peel axis
    fAmp: 0.18 + 0.16 * h(7), fW: 5.5 + 3 * h(8), fK: 7 + 5 * h(9), fPh: 6.28 * h(10), // flutter of the flap
    relDelay: 0.34 + 0.2 * h(11), relDur: 0.9 + 0.3 * h(12), // rigid release / fly-away
    psi: 1.15 + 0.5 * h(13), drift: 1.25 + 0.5 * h(14), side: (h(15) - 0.5) * 0.9, zTrav: DP + 1.0 + 0.4 * h(16), spin: (h(17) - 0.5) * 3.2,
    S: 0.8, // longest extent along d (set from the mesh in setup)
  };
});
// per-frame state of one piece -> object with the curl lookup table (reused buffers)
const DU = 0.005, NU = 260;
function makeScratch() { return { X: new Float32Array(NU + 2), Z: new Float32Array(NU + 2), G: new Float32Array(NU + 2) }; }
function pieceState(pc, t, sc) {
  const x = t - pc.t0;
  const ps = { on: x > 0, x };
  if (x <= 0) return ps;
  const p = (() => { const q = clamp(x / pc.dur, 0, 1); const e = q * q * (3 - 2 * q); return mix(q, e, 0.55); })();
  const Sc = p * (pc.S + 0.05);
  const th = pc.thMax * sstep(0, 0.5, x);
  const rho = mix(pc.rho0, pc.rho1, sstep(0, 1, p));
  const fenv = sstep(0.05, 0.4, x) * (1 - 0.45 * p);
  const n = Math.min(NU, Math.ceil(Sc / DU) + 2);
  let X = 0, Z = 0, th0 = 0;
  sc.X[0] = 0; sc.Z[0] = 0; sc.G[0] = 0;
  for (let i = 1; i <= n; i++) {
    const u = i * DU;
    const fl = pc.fAmp * fenv * Math.sin(pc.fW * x - pc.fK * u + pc.fPh) * sstep(0, 0.14, u);
    const thu = th * Math.tanh(u / (rho * Math.max(th, 0.2))) + fl;
    const mid = (th0 + thu) * 0.5;
    X -= Math.cos(mid) * DU; Z += Math.sin(mid) * DU; th0 = thu;
    sc.X[i] = X; sc.Z[i] = Z; sc.G[i] = pc.twist * sstep(0, 0.3, u) * (0.25 + 0.75 * sstep(0, 0.7, x));
  }
  const w = clamp((x - pc.relDelay) / pc.relDur, 0, 1), w15 = Math.pow(w, 1.6), w2 = w * w;
  ps.p = p; ps.Sc = Sc; ps.n = n; ps.w = w;
  ps.psi = pc.psi * w2; ps.ts = pc.drift * w15; ps.tl = pc.side * w15; ps.tz = pc.zTrav * Math.pow(w, 2.1); ps.beta = pc.spin * w15;
  ps.cb = Math.cos(ps.beta); ps.sb = Math.sin(ps.beta); ps.cp = Math.cos(ps.psi); ps.sp = Math.sin(ps.psi);
  ps.pivS = pc.S * 0.92;
  ps.gone = w >= 1 && ps.tz > pc.zTrav * 0.99;
  return ps;
}
// deform one flat sheet point (x,y) -> out[0..2] in sheet-local metres
function deform(pc, ps, sc, x, y, out) {
  const dx = x - CRACK_C[0], dy = y - CRACK_C[1];
  if (!ps.on) { out[0] = x; out[1] = y; out[2] = 0; return; }
  const s = dx * pc.d[0] + dy * pc.d[1], l = dx * pc.l[0] + dy * pc.l[1];
  let S = s, L = l, Z = 0;
  if (s < ps.Sc) {
    const f = (ps.Sc - s) / DU, i = Math.min(ps.n - 1, Math.floor(f)), u = f - i;
    S = ps.Sc + sc.X[i] * (1 - u) + sc.X[i + 1] * u; Z = sc.Z[i] * (1 - u) + sc.Z[i + 1] * u;
    const g = sc.G[i] * (1 - u) + sc.G[i + 1] * u, cg = Math.cos(g), sg = Math.sin(g);
    const L2 = l * cg - Z * sg; Z = l * sg + Z * cg; L = L2;
  }
  // rigid release: tilt about the outer edge, spin, drift + fly toward the lens
  if (ps.w > 0) {
    let vS = S - ps.pivS, vZ = Z;
    const nS = vS * ps.cp + vZ * ps.sp, nZ = -vS * ps.sp + vZ * ps.cp; vS = nS; vZ = nZ;
    const rS = vS * ps.cb - L * ps.sb, rL = vS * ps.sb + L * ps.cb;
    S = ps.pivS + rS + ps.ts; L = rL + ps.tl; Z = vZ + ps.tz;
  }
  out[0] = CRACK_C[0] + S * pc.d[0] + L * pc.l[0]; out[1] = CRACK_C[1] + S * pc.d[1] + L * pc.l[1]; out[2] = Z;
}

// ------------------------------------------------------------------ textures / geometry builders
function makeNoiseTex(THREE, size = 256) {
  const data = new Uint8Array(size * size * 4);
  const lat = (ix, iy, f, seed) => hash(((ix % f) + f) % f, ((iy % f) + f) % f, seed);
  const vn = (u, v, fx, fy, seed) => { // tileable bilinear value noise, fx x fy cells
    const x = u * fx, y = v * fy, ix = Math.floor(x), iy = Math.floor(y), fxr = x - ix, fyr = y - iy;
    const sx = fxr * fxr * (3 - 2 * fxr), sy = fyr * fyr * (3 - 2 * fyr);
    const a = lat2(ix, iy, fx, fy, seed), b = lat2(ix + 1, iy, fx, fy, seed), c = lat2(ix, iy + 1, fx, fy, seed), d = lat2(ix + 1, iy + 1, fx, fy, seed);
    return mix(mix(a, b, sx), mix(c, d, sx), sy);
  };
  const lat2 = (ix, iy, fx, fy, seed) => hash(((ix % fx) + fx) % fx, ((iy % fy) + fy) % fy, seed);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const u = i / size, v = j / size, o = (j * size + i) * 4;
    let f = 0, a = 0.5, tot = 0; for (let k = 0; k < 5; k++) { const fr = 8 << k; f += a * vn(u, v, fr, fr, 11 + k); tot += a; a *= 0.55; }
    let g = 0; a = 0.55; tot = 0; for (let k = 0; k < 3; k++) { const fr = 3 << k; g += a * vn(u, v, fr, fr, 41 + k); a *= 0.5; }
    const b = 0.6 * vn(u, v, 128, 5, 71) + 0.4 * vn(u, v, 64, 3, 72);
    data[o] = clamp(((f / 0.99) - 0.5) * 1.5 + 0.5, 0, 1) * 255; data[o + 1] = clamp((g / 0.85 - 0.5) * 1.6 + 0.5, 0, 1) * 255; data[o + 2] = clamp(b, 0, 1) * 255; data[o + 3] = hash(i, j, 5) * 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = true; tex.needsUpdate = true;
  return tex;
}
function makeCrackTex(THREE) {
  const data = new Uint16Array(NT * NC * 4);
  for (let k = 0; k < NC; k++) for (let i = 0; i < NT; i++) { const o = (k * NT + i) * 4; data[o] = THREE.DataUtils.toHalfFloat(CRACK_OFF[k][i]); data[o + 3] = THREE.DataUtils.toHalfFloat(1); }
  const tex = new THREE.DataTexture(data, NT, NC, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.needsUpdate = true;
  return tex;
}

// ------------------------------------------------------------------ shaders
const PAPER_VERT = /* glsl */`
varying vec2 vUv; varying vec3 vN; varying vec3 vWP;
void main(){
  vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const PAPER_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tMap, tNoise, tAng;
uniform vec2 uSize, uC; uniform float uRMax;
uniform float uBaseA, uBaseB, uRowA, uRowB, uFrontA, uFrontB, uHairA, uHairB;
uniform float uGap, uSeam, uHairI, uLit, uTrans;
uniform vec3 uLightDir, uBackPos; uniform float uDL0;
uniform mat3 uInvOut, uInvIn;
varying vec2 vUv; varying vec3 vN; varying vec3 vWP;
const float PI = 3.14159265;
float wrapPi(float a){ return a - 2.0*PI*floor((a + PI)/(2.0*PI)); }
// exact inverse of three's ACESFilmic (exposure 1) so the flat, unlit sheet re-produces the 2D frame after OutputPass
vec3 invACES(vec3 y){
  y = clamp(y, 0.0, 0.985);
  vec3 x = clamp(uInvOut * y, 0.0, 0.982);
  vec3 a = 1.0 - 0.983729 * x, b = 0.0245786 - 0.432951 * x, c = -0.000090537 - 0.238081 * x;
  vec3 v = (-b + sqrt(max(b*b - 4.0*a*c, 0.0))) / (2.0*a);
  return max(uInvIn * v, 0.0) * 0.6;
}
void main(){
  vec2 pf = (vUv - 0.5) * uSize, pc = pf - uC;
  float r = length(pc), phi = atan(pc.y, pc.x), ru = clamp(r / uRMax, 0.0, 1.0);
  float oA = texture2D(tAng, vec2(ru, uRowA)).r, oB = texture2D(tAng, vec2(ru, uRowB)).r;
  float sA = wrapPi(phi - (uBaseA + oA)) * r, sB = wrapPi((uBaseB + oB) - phi) * r;
  float openA = 1.0 - smoothstep(uFrontA - 0.03, uFrontA, r), openB = 1.0 - smoothstep(uFrontB - 0.03, uFrontB, r);
  vec4 n1 = texture2D(tNoise, pf * 9.0), n2 = texture2D(tNoise, pf * 2.3 + 0.37), n3 = texture2D(tNoise, pf * 31.0 + 0.11);
  float gA = uGap * openA * (0.3 + 1.2 * n1.r), gB = uGap * openB * (0.3 + 1.2 * n3.r);
  if (sA < gA || sB < gB) discard;
  float dA = sA - gA, dB = sB - gB;
  float dMin = min(dA, dB), torn = dA < dB ? openA : openB;
  float band = torn * (1.0 - smoothstep(0.0015, 0.010 + 0.013 * n2.g, dMin));
  bool fr = gl_FrontFacing;
  vec3 tex = texture2D(tMap, vUv).rgb;
  vec3 albF = invACES(tex);
  float lum = dot(tex, vec3(0.3, 0.55, 0.15));
  vec3 albB = invACES(vec3(0.90, 0.855, 0.745) * (0.93 + 0.12 * n2.g + 0.05 * (n1.r - 0.5))) * (1.0 - 0.2 * (1.0 - clamp(lum * 1.4, 0.0, 1.0)));
  vec3 albW = invACES(vec3(0.96, 0.94, 0.89) * (0.82 + 0.2 * n3.b));
  vec3 alb = fr ? albF : albB;
  alb *= 1.0 + uLit * 0.06 * (n1.a - 0.5);
  alb = mix(alb, albW, band * 0.9);
  vec3 N = normalize(vN); if (!fr) N = -N;
  vec3 V = normalize(cameraPosition - vWP), L = normalize(uLightDir);
  float dl = max(dot(N, L), 0.0);
  float shade = (0.40 + 1.0 * dl) / (0.40 + 1.0 * uDL0);
  shade = mix(1.0, shade, uLit);
  vec3 Lb = normalize(uBackPos - vWP); float dB2 = length(uBackPos - vWP);
  float rimB = pow(clamp(1.0 - abs(dot(N, V)), 0.0, 1.0), 3.0) * uTrans * 0.6;
  float tr = max(-dot(N, Lb), 0.0) * uTrans * (0.9 * exp(-max(dMin, 0.0) / 0.07) * torn + 0.1 * exp(-r / 0.25));
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), fr ? 26.0 : 10.0) * (fr ? 0.16 : 0.07) * uLit;
  vec3 col = alb * shade + vec3(1.0, 0.96, 0.88) * spec;
  col += mix(alb, albB, 0.7) * vec3(1.0, 0.8, 0.5) * (tr * 2.2 + rimB);
  // seam of light through the torn fibres
  vec3 hot = vec3(1.0, 0.86, 0.6);
  col += hot * uSeam * torn * (exp(-max(dMin, 0.0) / 0.0035) + 0.05 * exp(-max(dMin, 0.0) / 0.04));
  // hairline crack of light (before the tear, intact sheet)
  float hA = uHairA > 0.0 ? exp(-pow(sA / 0.0018, 2.0)) * (1.0 - smoothstep(uHairA - 0.03, uHairA, r)) : 0.0;
  float hB = uHairB > 0.0 ? exp(-pow(sB / 0.0018, 2.0)) * (1.0 - smoothstep(uHairB - 0.03, uHairB, r)) : 0.0;
  col += hot * uHairI * (max(hA, hB) + 0.12 * max(exp(-abs(sA) / 0.02) * step(0.0, uHairA) * (1.0 - smoothstep(uHairA - 0.03, uHairA, r)), 0.0) * step(0.0001, uHairA));
  gl_FragColor = vec4(col, 1.0);
}`;
const GLOW_VERT = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const GLOW_FRAG = /* glsl */`
precision highp float; varying vec2 vUv; uniform float uI, uTime, uSeed;
void main(){
  vec2 p = (vUv - 0.5) * vec2(2.0 * 1.7778, 2.0); float r = length(p), a = atan(p.y, p.x);
  float core = exp(-r * r * 5.0), halo = exp(-r * 1.5) * 0.35;
  float rays = pow(0.5 + 0.5 * sin(a * 13.0 + uSeed + 2.5 * sin(a * 4.0 + uTime * 0.4)), 4.0) * exp(-r * 1.1);
  float rays2 = pow(0.5 + 0.5 * sin(a * 27.0 - uSeed * 1.7 + uTime * 0.6), 6.0) * exp(-r * 1.8);
  vec3 col = vec3(1.0, 0.86, 0.6) * (core * 1.6 + halo + rays * 0.8 + rays2 * 0.5) * uI;
  gl_FragColor = vec4(col, 1.0);
}`;
const BEAM_VERT = /* glsl */`varying vec3 vWP; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`;
const BEAM_FRAG = /* glsl */`
precision highp float;
uniform vec3 uApex, uAxis, uCol; uniform float uCos2, uTanA, uH, uInt, uTime;
uniform vec4 uSph0, uSph1;
varying vec3 vWP;
float h31(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(h31(i), h31(i+vec3(1,0,0)), f.x), mix(h31(i+vec3(0,1,0)), h31(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i+vec3(0,0,1)), h31(i+vec3(1,0,1)), f.x), mix(h31(i+vec3(0,1,1)), h31(i+vec3(1,1,1)), f.x), f.y), f.z); }
float sph(vec3 ro, vec3 rd, vec4 s){ vec3 oc = ro - s.xyz; float b = dot(oc, rd), c = dot(oc, oc) - s.w * s.w, d = b*b - c; if (d < 0.0) return 1e9; float t = -b - sqrt(d); return t > 0.0 ? t : 1e9; }
void main(){
  vec3 ro = cameraPosition, rd = normalize(vWP - ro);
  vec3 w = ro - uApex; float da = dot(rd, uAxis), wa = dot(w, uAxis);
  float A = da*da - uCos2, B = 2.0 * (wa*da - uCos2 * dot(w, rd)), C = wa*wa - uCos2 * dot(w, w);
  float disc = B*B - 4.0*A*C; if (disc <= 0.0 || abs(A) < 1e-6) discard;
  float sq = sqrt(disc), s1 = (-B - sq) / (2.0*A), s2 = (-B + sq) / (2.0*A); if (s1 > s2){ float t = s1; s1 = s2; s2 = t; }
  float sa = -1e9, sb = 1e9;
  if (abs(da) > 1e-5){ float q0 = (0.0 - wa)/da, q1 = (uH - wa)/da; sa = min(q0, q1); sb = max(q0, q1); } else if (wa < 0.0 || wa > uH) discard;
  float s0 = max(max(s1, sa), 0.0), se = min(s2, sb);
  if (rd.y < 0.0) se = min(se, -ro.y / rd.y);
  se = min(se, min(sph(ro, rd, uSph0), sph(ro, rd, uSph1)));
  if (se <= s0) discard;
  const int N = 14; float ds = (se - s0) / float(N), acc = 0.0;
  for (int i = 0; i < N; i++){
    float s = s0 + (float(i) + 0.5) * ds; vec3 p = ro + rd * s, v = p - uApex; float h = dot(v, uAxis); vec3 rad = v - uAxis * h;
    float rn = length(rad) / max(h * uTanA, 1e-3);
    float prof = smoothstep(1.0, 0.25, rn);
    float ax = 1.0 / (1.0 + 0.012 * h * h) * smoothstep(0.0, 1.2, h);
    float nz = 0.72 + 0.4 * vn(p * vec3(1.3, 0.8, 1.3) + vec3(0.0, uTime * 0.18, uTime * 0.05)) + 0.2 * vn(p * 3.1 - vec3(0.0, uTime * 0.3, 0.0));
    acc += prof * ax * nz * ds;
  }
  gl_FragColor = vec4(uCol * uInt * acc, 1.0);
}`;
const MOTE_VERT = /* glsl */`
attribute float aSize, aPh; uniform float uScale, uTime, uInt; varying float vA;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * uScale / max(-mv.z, 0.1), 1.0, 14.0);
  vA = uInt * (0.55 + 0.45 * sin(uTime * (1.3 + aPh) + aPh * 40.0));
}`;
const MOTE_FRAG = /* glsl */`precision highp float; varying float vA; uniform vec3 uCol;
void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c) * 2.0; if (d > 1.0) discard; float a = pow(1.0 - d, 1.5); gl_FragColor = vec4(uCol * vA * a, 1.0); }`;
const FLAT_VERT = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const POOL_FRAG = /* glsl */`precision highp float; varying vec2 vUv; uniform vec3 uCol; uniform float uI;
void main(){ vec2 p = (vUv - 0.5) * 2.0; float r = length(p); float a = smoothstep(1.0, 0.15, r); a = a * a; gl_FragColor = vec4(uCol * uI * a, 1.0); }`;
const RING_FRAG = /* glsl */`precision highp float; varying vec2 vUv; uniform vec3 uCol; uniform float uI, uR, uW;
void main(){ vec2 p = (vUv - 0.5) * 2.0 * 4.0; float r = length(p); float d = (r - uR) / uW; float a = exp(-d * d) * uI * (1.0 - smoothstep(2.0, 4.0, r)); gl_FragColor = vec4(uCol * a, 1.0); }`;
const DOT_VERT = /* glsl */`attribute float aSize; attribute vec3 aCol; uniform float uScale, uInt; varying vec3 vC;
void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(aSize * uScale / max(-mv.z, 0.1), 1.0, 12.0); vC = aCol * uInt; }`;
const DOT_FRAG = /* glsl */`precision highp float; varying vec3 vC; void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c) * 2.0; if (d > 1.0) discard; gl_FragColor = vec4(vC * (1.0 - 0.5 * d * d), 1.0); }`;

// ------------------------------------------------------------------ the scene module
const V = (THREE) => new THREE.Vector3();
export default {
  id: 'turn', kind: '3d', ratio: ASPECT,

  setup({ THREE, S, renderer }) {
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#05040a'); scene.fog = new THREE.FogExp2('#0a0912', 0.026);
    const camera = new THREE.PerspectiveCamera(vfovOf(35), ASPECT, 0.08, 90);

    // ---- the soundstage behind the paper
    const stage = createStage(THREE, { S }); scene.add(stage.group);
    const L = stage.lights;
    L.key.castShadow = true; L.key.shadow.mapSize.set(1024, 1024); L.key.shadow.camera.near = 3; L.key.shadow.camera.far = 14; L.key.shadow.bias = -0.0005;
    const rim2 = new THREE.PointLight('#1FB5A6', 0, 30, 2); scene.add(rim2); // cool teal rim from the right-back (no shadow)
    const burst = new THREE.PointLight('#ffd9a0', 0, 40, 1.6); scene.add(burst); // light of the tear
    // backdrop haze glow + distant practicals (give the DOF something to bokeh)
    const mkMat = (frag, uniforms, extra = {}) => new THREE.ShaderMaterial({ vertexShader: FLAT_VERT, fragmentShader: frag, uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false, ...extra });
    const dotN = 46, dotPos = new Float32Array(dotN * 3), dotSize = new Float32Array(dotN), dotCol = new Float32Array(dotN * 3);
    const palCols = [[1.0, 0.72, 0.28], [0.3, 0.85, 0.8], [0.55, 0.5, 1.0], [0.55, 0.78, 1.0], [1.0, 0.45, 0.28]];
    for (let i = 0; i < dotN; i++) {
      const z = -8.6 + hash(SEED, i, 3) * 2.6, x = (hash(SEED, i, 1) - 0.5) * 20, y = 0.35 + Math.pow(hash(SEED, i, 2), 1.4) * 6.2;
      dotPos.set([x, y, z], i * 3); dotSize[i] = 5 + hash(SEED, i, 4) * 7; const c = palCols[Math.floor(hash(SEED, i, 5) * palCols.length)], k = 0.5 + 1.8 * hash(SEED, i, 6); dotCol.set([c[0] * k, c[1] * k, c[2] * k], i * 3);
    }
    const dotGeo = new THREE.BufferGeometry(); dotGeo.setAttribute('position', new THREE.BufferAttribute(dotPos, 3)); dotGeo.setAttribute('aSize', new THREE.BufferAttribute(dotSize, 1)); dotGeo.setAttribute('aCol', new THREE.BufferAttribute(dotCol, 3));
    const dotMat = new THREE.ShaderMaterial({ vertexShader: DOT_VERT, fragmentShader: DOT_FRAG, uniforms: { uScale: { value: 1000 }, uInt: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false });
    const dots = new THREE.Points(dotGeo, dotMat); dots.frustumCulled = false; scene.add(dots);
    const glowBack = new THREE.Mesh(new THREE.PlaneGeometry(46, 22), mkMat(`precision highp float; varying vec2 vUv; uniform float uI; void main(){ vec2 p=(vUv-vec2(0.5,0.42))*vec2(1.6,2.0); float r=length(p); float g=exp(-r*r*3.2); gl_FragColor=vec4(vec3(0.16,0.2,0.46)*g*uI+vec3(0.05,0.03,0.09)*uI*0.5,1.0);} `, { uI: { value: 0.3 } }));
    glowBack.position.set(0, 5, -8.7); scene.add(glowBack);

    // ---- Amrita + chair
    const A = createAmrita(THREE); A.root.visible = false; scene.add(A.root);
    // ---- spotlight volume: analytic cone raymarch (one bounding cone mesh per beam)
    const apex = new THREE.Vector3(0.55, 7.0, 1.2), base = new THREE.Vector3(0.45, 0, 0.35), axis = base.clone().sub(apex).normalize();
    const BEAM_H = base.distanceTo(apex) * 1.04, BEAM_TAN = Math.tan(0.215), BEAM_ANG = Math.atan(BEAM_TAN);
    const beamU = { uApex: { value: apex }, uAxis: { value: axis }, uCol: { value: new THREE.Color(1.0, 0.82, 0.55) }, uCos2: { value: Math.cos(BEAM_ANG) ** 2 }, uTanA: { value: BEAM_TAN }, uH: { value: BEAM_H }, uInt: { value: 0 }, uTime: { value: 0 }, uSph0: { value: new THREE.Vector4(0, -9, 0, 0.5) }, uSph1: { value: new THREE.Vector4(0, 0.62, 0, 0.5) } };
    const coneGeo = new THREE.ConeGeometry(BEAM_H * BEAM_TAN * 1.12, BEAM_H * 1.01, 40, 1, true); coneGeo.translate(0, -BEAM_H * 1.01 / 2, 0);
    const beam = new THREE.Mesh(coneGeo, new THREE.ShaderMaterial({ vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, uniforms: beamU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false, side: THREE.FrontSide }));
    beam.position.copy(apex); beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), axis); beam.frustumCulled = false; beam.renderOrder = 5; scene.add(beam);
    // basis perpendicular to the beam axis, for motes
    const bu = new THREE.Vector3(1, 0, 0).sub(axis.clone().multiplyScalar(axis.x)).normalize(), bv = axis.clone().cross(bu).normalize();
    // dust motes inside the cone
    const MN = 340, mPos = new Float32Array(MN * 3), mSize = new Float32Array(MN), mPh = new Float32Array(MN);
    const motes = Array.from({ length: MN }, (_, i) => ({ h: 0.8 + Math.pow(hash(SEED, i, 21), 0.8) * 5.9, th: hash(SEED, i, 22) * 6.283, rf: Math.sqrt(hash(SEED, i, 23)) * 0.92, w: (hash(SEED, i, 24) - 0.5) * 0.5, p1: hash(SEED, i, 25) * 6.283, p2: hash(SEED, i, 26) * 6.283, a1: 0.05 + 0.2 * hash(SEED, i, 27) }));
    for (let i = 0; i < MN; i++) { mSize[i] = 0.7 + 1.8 * Math.pow(hash(SEED, i, 28), 2.5); mPh[i] = hash(SEED, i, 29); }
    const moteGeo = new THREE.BufferGeometry(); moteGeo.setAttribute('position', new THREE.BufferAttribute(mPos, 3).setUsage(THREE.DynamicDrawUsage)); moteGeo.setAttribute('aSize', new THREE.BufferAttribute(mSize, 1)); moteGeo.setAttribute('aPh', new THREE.BufferAttribute(mPh, 1));
    const moteMat = new THREE.ShaderMaterial({ vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, uniforms: { uScale: { value: 1000 }, uTime: { value: 0 }, uInt: { value: 0 }, uCol: { value: new THREE.Color(1.0, 0.9, 0.7) } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false });
    const moteObj = new THREE.Points(moteGeo, moteMat); moteObj.frustumCulled = false; moteObj.renderOrder = 6; scene.add(moteObj);
    // floor pool glow + landing shock ring
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 3.8), mkMat(POOL_FRAG, { uCol: { value: new THREE.Color(1.0, 0.72, 0.4) }, uI: { value: 0 } })); pool.rotation.x = -Math.PI / 2; pool.position.set(0.45, 0.012, 0.35); pool.renderOrder = 4; scene.add(pool);
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), mkMat(RING_FRAG, { uCol: { value: new THREE.Color(1.0, 0.85, 0.6) }, uI: { value: 0 }, uR: { value: 0 }, uW: { value: 0.12 } })); ring.rotation.x = -Math.PI / 2; ring.position.set(1.05, 0.02, 0.5); ring.renderOrder = 4; scene.add(ring);
    // puff of dust flung out of the landing
    const PN = 90, pPos = new Float32Array(PN * 3), pSize = new Float32Array(PN), pPh = new Float32Array(PN);
    for (let i = 0; i < PN; i++) { pSize[i] = 2.5 + 4 * hash(SEED, i, 41); pPh[i] = hash(SEED, i, 42); }
    const puffGeo = new THREE.BufferGeometry(); puffGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage)); puffGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1)); puffGeo.setAttribute('aPh', new THREE.BufferAttribute(pPh, 1));
    const puffMat = new THREE.ShaderMaterial({ vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, uniforms: { uScale: { value: 1000 }, uTime: { value: 0 }, uInt: { value: 0 }, uCol: { value: new THREE.Color(1.0, 0.8, 0.55) } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false });
    const puff = new THREE.Points(puffGeo, puffMat); puff.frustumCulled = false; puff.renderOrder = 6; scene.add(puff);

    // ---- THE PAPER: sheet frame placed from the freeze camera
    const vf0 = vfovOf(35), Hp = 2 * DP * Math.tan((vf0 * DEG) / 2), Wp = Hp * ASPECT;
    const sheet = new THREE.Group(); sheet.name = 'paper'; scene.add(sheet);
    {
      const P0 = new THREE.Vector3(...CAM[0].p), G0 = new THREE.Vector3(...CAM[0].g), f0 = G0.clone().sub(P0).normalize();
      sheet.position.copy(P0).addScaledVector(f0, DP);
      sheet.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(P0, G0, new THREE.Vector3(0, 1, 0)));
      sheet.updateMatrixWorld(true);
    }
    const noiseTex = makeNoiseTex(THREE), crackTex = makeCrackTex(THREE);
    const inM = new THREE.Matrix3().fromArray([0.59719, 0.076, 0.0284, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777]);
    const outM = new THREE.Matrix3().fromArray([1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602]);
    const lightLocal = new THREE.Vector3(-0.45, 0.65, 0.62).normalize();
    const shared = {
      tMap: { value: null }, tNoise: { value: noiseTex }, tAng: { value: crackTex }, uSize: { value: new THREE.Vector2(Wp, Hp) }, uC: { value: new THREE.Vector2(CRACK_C[0], CRACK_C[1]) }, uRMax: { value: RMAX },
      uGap: { value: 0 }, uSeam: { value: 0 }, uHairI: { value: 0 }, uLit: { value: 0 }, uTrans: { value: 0 },
      uLightDir: { value: lightLocal.clone().applyQuaternion(sheet.quaternion) }, uBackPos: { value: new THREE.Vector3(0, 0.02, -0.45).applyMatrix4(sheet.matrixWorld) }, uDL0: { value: lightLocal.z },
      uInvOut: { value: outM.clone().invert() }, uInvIn: { value: inM.clone().invert() },
    };
    // grid
    const hw = Wp / 2 + MARGIN, hh = Hp / 2 + MARGIN, nx = Math.ceil((2 * hw) / CELL), ny = Math.ceil((2 * hh) / CELL), gx = (i) => -hw + (i * 2 * hw) / nx, gy = (j) => -hh + (j * 2 * hh) / ny;
    const vid = (i, j) => j * (nx + 1) + i;
    const pieces = PIECES.map((pc) => {
      const sel = new Uint8Array((nx + 1) * (ny + 1));
      let Smax = 0;
      for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) { const [a, b] = wedgeDist(pc.k, gx(i), gy(j)); if (a > -0.04 && b > -0.04) { sel[vid(i, j)] = 1; } }
      const map = new Int32Array((nx + 1) * (ny + 1)).fill(-1), vx = [], vy = [], idx = [];
      const take = (i, j) => { const v = vid(i, j); if (map[v] < 0) { map[v] = vx.length; vx.push(gx(i)); vy.push(gy(j)); const s = (gx(i) - CRACK_C[0]) * pc.d[0] + (gy(j) - CRACK_C[1]) * pc.d[1]; const [a, b] = wedgeDist(pc.k, gx(i), gy(j)); if (a > 0 && b > 0 && s > Smax) Smax = s; } return map[v]; };
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        if (!(sel[vid(i, j)] || sel[vid(i + 1, j)] || sel[vid(i, j + 1)] || sel[vid(i + 1, j + 1)])) continue;
        const a = take(i, j), b = take(i + 1, j), c = take(i + 1, j + 1), d = take(i, j + 1);
        idx.push(a, b, c, a, c, d);
      }
      pc.S = Smax;
      const nV = vx.length, flat = new Float32Array(nV * 2), pos = new Float32Array(nV * 3), nor = new Float32Array(nV * 3), uv = new Float32Array(nV * 2);
      for (let v = 0; v < nV; v++) { flat[v * 2] = vx[v]; flat[v * 2 + 1] = vy[v]; pos[v * 3] = vx[v]; pos[v * 3 + 1] = vy[v]; nor[v * 3 + 2] = 1; uv[v * 2] = vx[v] / Wp + 0.5; uv[v * 2 + 1] = vy[v] / Hp + 0.5; }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(new THREE.BufferAttribute(nV > 65000 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
      const u = {}; for (const key in shared) u[key] = shared[key]; // share the uniform objects (same references), per-piece ones below
      Object.assign(u, { uBaseA: { value: CRACK_BASE[pc.kA] }, uBaseB: { value: CRACK_BASE[pc.kB] + (pc.kB === 0 ? 2 * Math.PI : 0) }, uRowA: { value: (pc.kA + 0.5) / NC }, uRowB: { value: (pc.kB + 0.5) / NC }, uFrontA: { value: 0 }, uFrontB: { value: 0 }, uHairA: { value: 0 }, uHairB: { value: 0 } });
      const mat = new THREE.ShaderMaterial({ vertexShader: PAPER_VERT, fragmentShader: PAPER_FRAG, uniforms: u, side: THREE.DoubleSide, toneMapped: false, fog: false });
      const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; sheet.add(mesh);
      return { pc, mesh, geo, flat, pos, nor, nV, scratch: makeScratch(), u, flatDone: false };
    });
    // burst glow behind the paper
    const glowU = { uI: { value: 0 }, uTime: { value: 0 }, uSeed: { value: 1.3 } };
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(Wp * 2.8, Hp * 2.8), mkMat(GLOW_FRAG, glowU)); glow.position.set(CRACK_C[0], CRACK_C[1], -0.3); glow.renderOrder = 3; sheet.add(glow);

    const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
    return { THREE, scene, camera, stage, L, rim2, burst, A, beam, moteObj, beamU, apex, axis, bu, bv, motes, mPos, moteGeo, moteMat, puffGeo, puffMat, pPos, PN, MN, pool, ring, dotMat, glowBack, sheet, pieces, shared, glow, glowU, tmpV, tmpV2, camState: { p: [0, 0, 0], g: [0, 0, 0], mm: 35 }, nx, ny, Wp, Hp, tex: null, texCanvas: null };
  },

  async prepare(st, T, S) {
    if (T.t >= 24.6) return; // the paper is long gone
    const cv = await S.act1Frame(21.9999);
    if (st.texCanvas !== cv) {
      const { THREE } = st; if (st.tex) st.tex.dispose();
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = S.renderer.capabilities.getMaxAnisotropy(); tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.generateMipmaps = true; tex.needsUpdate = true;
      st.tex = tex; st.texCanvas = cv; st.shared.tMap.value = tex;
    }
  },

  update(st, T, S) {
    const { THREE, camera, stage, L, A, shared, pieces } = st;
    const t = clamp(T.t, 21.9, 26.2), lt = clamp(T.lt, -0.1, 4.1);
    const imp = T.impact, D = globalThis.__turnDbg || {};
    const isCentre = Math.abs(T.f - Math.round(T.f)) < 1e-4;

    // ---------------- camera
    const cs = camAt(t, st.camState);
    camera.fov = vfovOf(cs.mm);
    camera.position.set(cs.p[0], cs.p[1], cs.p[2]);
    const g = st.tmpV.set(cs.g[0], cs.g[1], cs.g[2]);
    // hit kicks (3 hits after the freeze): tiny push + shake, pure function of impact
    if (t >= TEAR - 0.02) {
      const f = st.tmpV2.copy(g).sub(camera.position).normalize();
      const k = Math.min(1.2, imp) * 0.045; camera.position.addScaledVector(f, k);
      const hf = Math.floor(T.t * 60); const sh = 0.0022 * imp;
      g.x += hashSigned(hf, 5) * sh * 8; g.y += hashSigned(hf, 6) * sh * 8;
    }
    camera.lookAt(g);
    const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
    const zDepth = (x, y, z) => (x - camera.position.x) * fwd.x + (y - camera.position.y) * fwd.y + (z - camera.position.z) * fwd.z;
    camera.updateMatrixWorld(true);
    // point sprite scale = half the render height / tan(fov/2)
    const renderH = Math.round((S.W * S.scale) / ASPECT / 2) * 2, ptScale = (0.5 * renderH) / Math.tan((camera.fov * DEG) / 2) * 0.0035;

    // ---------------- paper
    const paperOn = t < 24.7;
    st.sheet.visible = paperOn;
    st.glow.visible = t < 24.2 && !D.noGlow;
    if (paperOn && st.tex) {
      const x = t - TEAR;
      const hairK = sstep(22.38, 22.42, t) * (1 - sstep(TEAR - 0.004, TEAR + 0.02, t));
      shared.uLit.value = sstep(22.0, 22.5, t);
      shared.uGap.value = 0.0032 * sstep(0, 0.07, x);
      shared.uSeam.value = D.noSeam ? 0 : x < 0 ? 0 : 9 * Math.exp(-x / 0.4) * sstep(0, 0.02, x);
      shared.uHairI.value = 7 * hairK;
      shared.uTrans.value = D.noTrans ? 0 : x < 0 ? 0 : 1.0 * Math.exp(-x / 0.9) * sstep(0, 0.05, x);
      const hairLen = 0.04 + 0.28 * sstep(22.4, 22.5, t);
      for (const P of pieces) {
        const pc = P.pc, u = P.u;
        const fr = (kk) => { const xx = x - 0.012 * kk - (kk % 2) * 0.01; return xx <= 0 ? 0 : 1.15 * (1 - Math.exp(-xx / 0.05)); };
        u.uFrontA.value = fr(pc.kA); u.uFrontB.value = fr(pc.kB);
        u.uHairA.value = pc.kA === 0 && hairK > 0 ? hairLen : 0; u.uHairB.value = pc.kB === 0 && hairK > 0 ? hairLen : 0;
        const ps = pieceState(pc, t, P.scratch);
        P.mesh.visible = !ps.gone;
        if (!ps.on) { if (!P.flatDone) { for (let v = 0; v < P.nV; v++) { P.pos[v * 3] = P.flat[v * 2]; P.pos[v * 3 + 1] = P.flat[v * 2 + 1]; P.pos[v * 3 + 2] = 0; P.nor[v * 3] = 0; P.nor[v * 3 + 1] = 0; P.nor[v * 3 + 2] = 1; } P.geo.attributes.position.needsUpdate = true; P.geo.attributes.normal.needsUpdate = true; P.flatDone = true; } continue; }
        P.flatDone = false;
        if (ps.gone || isCentre) continue; // the centre call only reads dof/bloom: skip the heavy geometry
        const o = [0, 0, 0];
        for (let v = 0; v < P.nV; v++) { deform(pc, ps, P.scratch, P.flat[v * 2], P.flat[v * 2 + 1], o); P.pos[v * 3] = o[0]; P.pos[v * 3 + 1] = o[1]; P.pos[v * 3 + 2] = o[2]; }
        P.geo.attributes.position.needsUpdate = true; P.geo.computeVertexNormals();
      }
      // burst light behind the paper
      const bi = x < 0 ? 0.0 : (1 - sstep(0, 0.03, 0.03 - x)) * (12 * Math.exp(-x / 0.45) + 0.8 * Math.exp(-x / 1.4));
      st.glowU.uI.value = ((x < 0 ? 0.0 : 1.0) * (9 * Math.exp(-x / 0.4) * sstep(0, 0.03, x) + 0.7 * Math.exp(-x / 1.0)) + hairK * 1.4) * (1 - sstep(23.2, 23.9, t));
      st.glowU.uTime.value = t;
      st.burst.intensity = x < 0 ? 0 : 520 * Math.exp(-x / 0.5) + 30 * Math.exp(-x / 1.6);
      st.burst.position.copy(new THREE.Vector3(0, 0.05, -1.4).applyMatrix4(st.sheet.matrixWorld));
      shared.uBackPos.value.copy(new THREE.Vector3(CRACK_C[0], CRACK_C[1] + 0.02, -0.4).applyMatrix4(st.sheet.matrixWorld));
    } else st.burst.intensity = 0;

    // ---------------- stage lights
    const spotK = t < SPOT ? 0 : (() => { const x = t - SPOT; return (1 + 0.9 * Math.exp(-x / 0.12) * Math.sin(2 * Math.PI * x * 11 + 1.2) + 1.6 * Math.exp(-x / 0.06)) * smooth(x / 0.012 + 0.02); })();
    const settled = sstep(SPOT, SPOT + 1.2, t);
    L.key.position.copy(st.apex); L.key.target.position.set(0.45, 0.2, 0.35); L.key.target.updateMatrixWorld();
    L.key.angle = 0.215; L.key.penumbra = 0.55; L.key.color.set('#ffe0b0'); L.key.intensity = 620 * spotK; L.key.distance = 0; L.key.decay = 2;
    const landX = 1.05, landZ = 0.5;
    // Amrita path
    const tl = t - LAND;
    st.rimK = t < LAND ? 0.0 : (1 + 1.6 * Math.exp(-tl / 0.18)) * 1.0;
    L.rim.position.set(-2.4, 3.4, -3.6); L.rim.target.position.set(0.8, 0.85, 0.3); L.rim.target.updateMatrixWorld();
    L.rim.color.set('#9fd4ff'); L.rim.intensity = 110 * st.rimK; L.rim.angle = 0.5;
    st.rim2.position.set(3.2, 2.2, -3.2); st.rim2.intensity = 40 * st.rimK;
    L.fill.intensity = 3 + 8 * smooth((t - SPOT) / 1.0); L.fill.color.set('#6f8cff');
    L.amb.intensity = 0.22 + 0.1 * settled; L.amb.color.set('#2a2f55');
    st.dotMat.uniforms.uInt.value = 0.55 + 0.25 * settled; st.dotMat.uniforms.uScale.value = ptScale;
    st.glowBack.material.uniforms.uI.value = 0.3 + 0.2 * sstep(LAND - 0.05, LAND + 0.4, t);

    // chair: swivels when she lands
    const ch = stage.chair; ch.position.set(0, 0, 0);
    ch.rotation.y = lerp(0.95, 0.28, spring(t - (LAND + 0.03), 1.5, 0.3));

    // ---------------- Amrita: wait high, drop (stretch), land (squash), hover
    let ay, sq = 0, vis = true;
    if (t < 24.12) vis = false;
    if (t < DROP - 0.1) ay = lerp(4.3, 2.95, outCubic(clamp((t - 24.12) / 0.4)));
    else if (t < DROP) { const u = (t - (DROP - 0.1)) / 0.1; ay = lerp(2.95, 3.35, smooth(u)); sq = -0.1 * smooth(u); }
    else if (t < LAND) { const u = (t - DROP) / 0.5; const e = Math.pow(u, 1.9); ay = lerp(3.35, 0.5, e); sq = 0.5 * Math.sin(Math.min(1, u * 1.15) * Math.PI * 0.5) * (u < 0.96 ? 1 : 1 - (u - 0.96) / 0.04 * 0.6); }
    else {
      const x = tl; // contact: squash on the floor, then spring up to the hover height
      const sqz = -0.42 * Math.exp(-x / 0.09) + 0.1 * Math.sin(x * 22) * Math.exp(-x / 0.25) * smooth(x / 0.1);
      sq = sqz; const hover = 0.78 + 0.035 * Math.sin(t * 2.6) * smooth(x / 0.6);
      const base = 0.5 * (1 + sqz) * 0.92;
      ay = lerp(base, hover, spring(Math.max(0, x - 0.05), 2.1, 0.3)) ; if (x < 0.05) ay = base;
    }
    A.root.visible = vis && T.t >= 24.1;
    const yaw = -0.45 + 0.25 * Math.sin(t * 1.3) * smooth(tl / 0.8);
    A.root.position.set(landX, ay, landZ); A.root.rotation.set(0, 0, 0);
    A.pose({ squash: sq, yaw, roll: t >= LAND ? 0.05 * Math.sin(t * 2.0) : 0.0, bob: 0 });
    if (t < LAND + 0.1) A.eyes({ open: 0, determined: 0, happy: 0 });
    else if (t < LAND + 0.45) A.eyes({ open: sstep(LAND + 0.1, LAND + 0.2, t), determined: 1, happy: 0, lookX: 0.6, lookY: 0.1 });
    else A.eyes({ open: 1, determined: 0, happy: 1, lookX: 0.6, lookY: 0.1 });
    A.setProp('slate', { t, glow: 1 });
    st.beamU.uSph0.value.set(landX, ay, landZ, 0.5); st.beamU.uSph1.value.set(0, 0.62, 0, 0.5);

    // beam / motes / pool / ring / puff
    st.beam.visible = !D.noBeam; st.moteObj.visible = !D.noBeam;
    st.beamU.uInt.value = 0.1 * spotK * (0.9 + 0.1 * settled); st.beamU.uTime.value = t;
    const apexV = st.apex, ax = st.axis, tanA = Math.tan(0.215);
    const shock = t >= LAND ? 1 - Math.exp(-tl / 0.3) : 0;
    for (let i = 0; i < st.MN; i++) {
      const m = st.motes[i];
      const h = m.h + 0.35 * Math.sin(t * 0.35 + m.p1) + (t > DROP && t < LAND + 0.4 ? -0.8 * smooth((t - DROP) / 0.6) * (1 - smooth((t - LAND) / 0.4)) : 0);
      const th = m.th + m.w * t, rf = clamp(m.rf + 0.04 * Math.sin(t * 0.9 + m.p2), 0, 0.95), rr = rf * h * tanA;
      let px = apexV.x + ax.x * h + (st.bu.x * Math.cos(th) + st.bv.x * Math.sin(th)) * rr, py = apexV.y + ax.y * h + (st.bu.y * Math.cos(th) + st.bv.y * Math.sin(th)) * rr, pz = apexV.z + ax.z * h + (st.bu.z * Math.cos(th) + st.bv.z * Math.sin(th)) * rr;
      if (shock > 0) { const dx = px - landX, dz = pz - landZ, d = Math.hypot(dx, dz) + 0.05, k = 0.9 * shock * Math.exp(-py / 1.3) * Math.exp(-(t - LAND) / 1.2); px += (dx / d) * k; pz += (dz / d) * k; py += 0.25 * shock * Math.exp(-py / 1.0); }
      st.mPos[i * 3] = px; st.mPos[i * 3 + 1] = py; st.mPos[i * 3 + 2] = pz;
    }
    st.moteGeo.attributes.position.needsUpdate = true;
    st.moteMat.uniforms.uTime.value = t; st.moteMat.uniforms.uScale.value = ptScale; st.moteMat.uniforms.uInt.value = 1.25 * spotK * (0.2 + 0.8 * settled);
    st.pool.material.uniforms.uI.value = 0.7 * spotK * (0.5 + 0.5 * settled);
    // shock ring + puff
    const rx = Math.max(0, tl);
    st.ring.material.uniforms.uI.value = t < LAND ? 0 : 2.4 * Math.exp(-rx / 0.28); st.ring.material.uniforms.uR.value = 0.5 + 3.6 * (1 - Math.exp(-rx / 0.45)); st.ring.material.uniforms.uW.value = 0.1 + 0.25 * rx;
    for (let i = 0; i < st.PN; i++) {
      const a = hash(SEED, i, 51) * 6.283, sp = 0.8 + 2.4 * hash(SEED, i, 52), up = 0.3 + 1.6 * hash(SEED, i, 53), x = Math.max(0, tl), drag = 1 - Math.exp(-x / 0.35);
      st.pPos[i * 3] = landX + Math.cos(a) * sp * drag * 0.6; st.pPos[i * 3 + 1] = 0.08 + up * x * Math.exp(-x * 1.4) * 0.9; st.pPos[i * 3 + 2] = landZ + Math.sin(a) * sp * drag * 0.6;
    }
    st.puffGeo.attributes.position.needsUpdate = true; st.puffMat.uniforms.uScale.value = ptScale; st.puffMat.uniforms.uTime.value = t; st.puffMat.uniforms.uInt.value = t < LAND ? 0 : 1.1 * Math.exp(-rx / 0.55) * spotK;

    // ---------------- DOF / bloom
    const chairZ = zDepth(0, 0.7, 0), amriZ = zDepth(landX, 0.8, landZ);
    let focus = DP;
    focus = lerp(DP, chairZ, sstep(23.2, 23.95, t));
    focus = lerp(focus, lerp(chairZ, amriZ, sstep(24.3, 24.95, t)), sstep(24.3, 24.9, t));
    const dof = { focus, strength: lerp(0.5, 0.42, sstep(23.5, 24.5, t)), maxPx: 16, bokeh: 1.3 };
    const frozen = t < TEAR - 0.045;
    const bloom = { strength: frozen || D.noBloom ? 0 : 0.42 + 0.3 * Math.min(1, imp), radius: 0.62, threshold: lerp(3.2, 0.85, sstep(23.0, 24.3, t)) };
    return { dof, bloom, exposure: 1, jitter: !frozen };
  },
};
