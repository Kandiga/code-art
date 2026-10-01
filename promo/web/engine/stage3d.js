// =============================================================================
// stage3d.js — the shared cinematic SOUNDSTAGE (v1). Meters, +Y up, camera looks toward -Z, floor y=0, cyc wall z=-9.
//
//   createStage(THREE, env, opts) -> { group, floor, cyc, chair, lights:{key,fill,rim,amb}, floorMat, cycMat, ...v1 }
//     env  = { THREE?, S?, renderer? }  (renderer is only used to bake a tiny studio PMREM for the props; S.renderer works too)
//     opts = { size:44, look:'neutral', truss:true, fixtures:true, chair:true, table:true, cases:true, cables:true, grips:true,
//              tubes:true, marks:true, fog:true, mist:true, reflections:true, reflectTable:false, bindLights:false, env:true, layout:'periphery', seed:7 }
//
// WHAT YOU GET (all deterministic, nothing random, no per-frame allocation, ~28 draw calls, 1 shadow-casting light (key)):
//   cyc          curved cyclorama: wall at z=-9 that sweeps (r=2.2 cove) into the floor, round corners at |x|>13. Dark, with an
//                emissive "cyc-light" wash (setLook colours it) so the horizon reads; the same wash is mirrored in the floor.
//   floor        glossy near-black PBR floor (scuffs/bump/roughness map) + analytic reflections: fresnel mirror of the cyc wash,
//                streaked reflections of the LED tubes / fixtures, height fog ("ground haze"), edge fade. Transparent-blended so
//                MIRRORED CLONES under it (stage.reflect(obj)) show through with fresnel + fade (cheap planar reflection, no 2nd pass).
//   truss/rig    box truss ring at y=7.4 + 17 fixtures (fresnels w/ barn doors, pars, LED panels), motors, hang cables. Lenses are
//                emissive InstancedMesh (HDR-glow, bloom-ready) + halo points. Drive them: stage.rig.set(sel, {color, intensity}).
//   chair        director's chair: dark walnut frame, cream canvas seat/back (weave + sag + vermilion piping), brass fittings.
//   table/clapper script-supervisor table with clapperboard (stage.clapper.setOpen(k)), 7" monitor with colour bars, script, mug, lamp.
//   cases/grips/cables/tubes/marks   flight cases w/ alloy rails, C-stands + flags, floor cables, LED tubes, gaffer-tape spike marks.
//   mist         two drifting ground-mist layers (premultiplied, camera-aware).
//
// ---- API additions (v0 names unchanged) -------------------------------------------------------------------------------------
//   stage.update(t | T)            OPTIONAL per-frame call (pure fn of t): animates mist / fog wisps. Without it the haze is static.
//   stage.setLook('noir'|'warm'|'teal-orange'|'neutral', {intensity, lights})   cyc wash + haze + fixture/tube colours (+ key/fill/rim/amb colours unless lights:false)
//   stage.blendLook(a, b, k)       interpolate two looks (names or objects) 0..1 — the COLOR job's flat -> graded transformation
//   stage.setHaze(k)               0..2 ground haze + mist amount (1 = default)      stage.setGlow(k)  master multiplier of every lens / tube / halo
//   stage.rig                      { fixtures[], get(sel), set(sel,{color,intensity,on}), beams(opts) }  sel = index|id|group('front'|'back'|'top'|'side')|'par'|'panel'|'all'|fn
//                                  rig.beams({sel,max,angle,intensity,noise,color}) -> { group, beams[], update(t) } fx3d volumetric beams from fixture lenses to the floor
//   stage.tubes                    { items[], set(i,{color,intensity}), setAll(), count }   6 LED tubes + the table-lamp bulb (emissive, reflected in the floor)
//   stage.reflect(obj3d, {strength,fade,filter}) -> handle   mirrored clone of ANY object under the glossy floor (Amrita, props, crowd, instanced meshes)
//   stage.bindLights(true)         visible fixtures follow lights.key / lights.rim (position, aim, colour, intensity) every render
//   stage.layout('periphery'|'showcase')   'periphery' (default): table + cases parked at the edges so they never collide with a scene's blocking.
//   stage.clapper.setOpen(0..1)    clapperboard arm      stage.table / casesLeft / casesRight / cases / truss / grips / cables / marks (Groups; move/hide freely)
//   stage.marksList [{x,z,color}]  the five coloured spike marks on the floor (z≈2..2.4)      stage.envMap  baked studio PMREM (or null)
//   stage.floor / cyc / chair / lights / floorMat / cycMat are exactly the v0 handles (floorMat is a MeshPhysicalMaterial, transparent+premultiplied: leave it that way).
//   module exports:  rigThreePoint(stage,{target,key,fill,rim})   spotPool(stage,{x,z,radius,color,intensity,...})   setLook(stage,name,opts)   blendLooks(T,a,b,k)
//                    reflect(stage,obj,opts)   LOOKS   makeStudioEnv(THREE,renderer)   pxScale(renderer,camera)   noiseTexture(T)   radialTexture(T)
// Lights are physical (candela): key = SpotLight (the ONLY shadow caster), fill = PointLight, rim = SpotLight, amb = AmbientLight. Scenes keep driving them exactly as in v0.
// Rendering contract: scene.background should be dark (the floor blends over it); keep floorMat.transparent=true. Per sub-frame cost: ~30 draw calls.
// =============================================================================
import { hash } from './rng.js';
import { createBeam, pxScale } from './fx3d.js';
export { pxScale };

const TAU = Math.PI * 2, DEG = Math.PI / 180;
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;

// ------------------------------------------------------------------------------------------------ looks
export const LOOKS = {
  neutral: {
    key: ['#ffe6c4', 1.0], fill: ['#8fb0ff', 1.0], rim: ['#bfe2ff', 1.0], amb: ['#2a2f4a', 0.5],
    washL: ['#34446e', 0.3], washR: ['#46386c', 0.27], pool: ['#566a9e', 0.22], glow: 1.0,
    haze: ['#6f86b8', 0.5], hazeD: 0.05, lens: ['#ffd9a0', '#bfe2ff', '#ffb62e'], tubes: ['#7cc4ff', '#6b5bff'], floor: '#0d0d12', bg: '#04050a',
  },
  noir: {
    key: ['#fff1de', 1.1], fill: ['#7a8fb8', 0.6], rim: ['#cfe6ff', 1.1], amb: ['#1a1d2a', 0.35],
    washL: ['#2a3550', 0.35], washR: ['#1c2438', 0.3], pool: ['#46608a', 0.38], glow: 0.8,
    haze: ['#566a90', 0.5], hazeD: 0.06, lens: ['#fff1de', '#cfe6ff', '#9fb4d8'], tubes: ['#cfe6ff', '#9fb4d8'], floor: '#08080b', bg: '#020306',
  },
  warm: {
    key: ['#ffc47a', 1.0], fill: ['#ff9a5a', 1.2], rim: ['#ffd9a0', 1.0], amb: ['#2a1d14', 0.5],
    washL: ['#a2400c', 0.5], washR: ['#c2620f', 0.5], pool: ['#e07a22', 0.55], glow: 1.1,
    haze: ['#a07050', 0.5], hazeD: 0.05, lens: ['#ffb86a', '#ffd9a0', '#ff8a3a'], tubes: ['#ffb62e', '#f2542d'], floor: '#100c0b', bg: '#060403',
  },
  'teal-orange': {
    key: ['#ffb070', 1.0], fill: ['#2a8f98', 1.3], rim: ['#19d1c0', 1.3], amb: ['#10282b', 0.5],
    washL: ['#0f8a92', 0.6], washR: ['#b8561a', 0.55], pool: ['#2ab5a6', 0.5], glow: 1.1,
    haze: ['#4a8088', 0.5], hazeD: 0.05, lens: ['#ffa860', '#19d1c0', '#ffb62e'], tubes: ['#1fb5a6', '#ff8a3a'], floor: '#0a0f11', bg: '#030708',
  },
};

// ------------------------------------------------------------------------------------------------ shared GLSL
const CYC_GLSL = /* glsl */`
uniform vec3 uWashL, uWashR, uWashC; uniform vec4 uPoolP; uniform float uWashH, uCycGlow, uWallZ; uniform sampler2D uNoise;
vec3 cycEmit(vec2 p){
  float h = max(p.y, 0.0);
  float xk = smoothstep(-13.0, 13.0, p.x);
  vec3 wash = mix(uWashL, uWashR, xk);
  float g = 0.62 * exp(-h / uWashH) + 0.38 * exp(-h * h / (uWashH * uWashH * 5.0));
  vec2 q = vec2((p.x - uPoolP.x) / uPoolP.z, (h - uPoolP.y) / uPoolP.w);
  float pool = exp(-dot(q, q));
  float cl = 0.74 + 0.5 * texture2D(uNoise, p * vec2(0.032, 0.05)).r;
  vec3 c = (wash * g + uWashC * pool) * cl;
  c *= smoothstep(11.8, 5.5, h);
  return c * uCycGlow;
}
uniform vec3 uHazeCol; uniform float uHazeD, uHazeH, uTime;
vec3 stageHaze(vec3 col, vec3 P){
  vec3 C = cameraPosition; float len = length(P - C);
  float k = (P.y - C.y) / uHazeH; float ek = abs(k) < 1e-3 ? 1.0 : (1.0 - exp(-k)) / k;
  float tau = uHazeD * len * exp(-C.y / uHazeH) * ek;
  float hn = 0.7 + 0.6 * texture2D(uNoise, P.xz * 0.05 + uTime * vec2(0.004, 0.0025)).b;
  float fa = 1.0 - exp(-tau * hn);
  return col * (1.0 - fa) + uHazeCol * fa;
}`;

const FLOOR_VERT = /* glsl */`#include <project_vertex>\nvFloorW = (modelMatrix * vec4(transformed, 1.0)).xyz;`;
const NLINE = 8;
const FLOOR_FRAG = /* glsl */`
{
  vec3 Vv = normalize(vFloorW - cameraPosition);
  vec3 Rr = vec3(Vv.x, -Vv.y, Vv.z);
  float cosT = clamp(-Vv.y, 0.0, 1.0);
  float Fr = 0.04 + 0.96 * pow(1.0 - cosT, 5.0);
  float rgh = clamp(material.roughness, 0.04, 1.0);
  vec3 refl = vec3(0.0);
  if (Rr.z < -0.02) { float s = (uWallZ - vFloorW.z) / Rr.z; vec3 hp = vFloorW + Rr * s; refl += cycEmit(hp.xy) * uCycRefl; }
  for (int i = 0; i < ${NLINE}; i++) {
    vec3 A = uLA[i] - vFloorW, B = uLB[i] - vFloorW, d = B - A;
    float dd = dot(d, d), rd = dot(Rr, d), den = dd - rd * rd;
    float u = den > 1e-5 ? clamp((dot(Rr, A) * rd - dot(A, d)) / den, 0.0, 1.0) : 0.0;
    vec3 Cp = A + d * u; float dist = max(length(Cp), 0.05);
    float sinA = length(cross(Rr, Cp)) / dist;
    float sig = 0.02 + rgh * 0.22 + uLR[i] / dist;
    float lobe = exp(-(sinA * sinA) / (sig * sig)) * step(0.0, dot(Rr, Cp));
    refl += uLC[i] * lobe * min(1.0, 0.045 / sig);
  }
  float brk = 0.8 + 0.36 * texture2D(uNoise, vFloorW.xz * vec2(0.9, 0.14)).g;
  outgoingLight += refl * min(Fr, 0.6) * brk * uReflK2;
  outgoingLight = stageHaze(outgoingLight, vFloorW);
  outgoingLight *= smoothstep(uFloorR, uFloorR * 0.6, length(vFloorW.xz));
  diffuseColor.a = 1.0 - clamp(Fr * uReflK * brk, 0.0, 0.85);
}
#include <opaque_fragment>`;

// ------------------------------------------------------------------------------------------------ noise / textures (pure, DOM-free)
function pnoise(x, y, per, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const m = (v) => ((v % per) + per) % per;
  const a = hash(m(ix), m(iy), seed), b = hash(m(ix + 1), m(iy), seed), c = hash(m(ix), m(iy + 1), seed), d = hash(m(ix + 1), m(iy + 1), seed);
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function pfbm(x, y, per, seed, oct = 4) {
  let s = 0, a = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { s += a * pnoise(x * f, y * f, per * f, seed + i * 31); norm += a; f *= 2; a *= 0.5; }
  return s / norm;
}
function dataTex(T, data, w, h, { repeat = true, aniso = 8, mip = true } = {}) {
  const t = new T.DataTexture(data, w, h, T.RGBAFormat, T.UnsignedByteType);
  t.wrapS = t.wrapT = repeat ? T.RepeatWrapping : T.ClampToEdgeWrapping;
  t.magFilter = T.LinearFilter; t.minFilter = mip ? T.LinearMipmapLinearFilter : T.LinearFilter; t.generateMipmaps = mip; t.anisotropy = aniso; t.needsUpdate = true;
  return t;
}
const texCache = new WeakMap();
function cached(T, key, fn) { let m = texCache.get(T); if (!m) { m = new Map(); texCache.set(T, m); } if (!m.has(key)) m.set(key, fn()); return m.get(key); }

/** 256² tileable RGB noise (R low-freq clouds, G mid streaky, B wisps). */
export function noiseTexture(T) {
  return cached(T, 'noise2d', () => {
    const N = 256, d = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N, o = (y * N + x) * 4;
      d[o] = clamp(pfbm(u * 4, v * 4, 4, 3, 5)) * 255; d[o + 1] = clamp(pfbm(u * 8, v * 8, 8, 17, 4)) * 255; d[o + 2] = clamp(pfbm(u * 6, v * 6, 6, 29, 4)) * 255; d[o + 3] = 255;
    }
    return dataTex(T, d, N, N);
  });
}
/** floor: R bump, G roughness mask, B darkening. 512², tile = 8 m. */
function floorTexture(T) {
  return cached(T, 'floor', () => {
    const N = 512, d = new Uint8Array(N * N * 4), scuff = new Float32Array(N * N);
    for (let k = 0; k < 260; k++) {
      let sx = hash(k, 1, 91) * N, sy = hash(k, 2, 91) * N; const a = (hash(k, 3, 91) - 0.5) * 1.1 + (hash(k, 9, 91) < 0.25 ? Math.PI / 2 : 0), L = 30 + hash(k, 4, 91) * 150, st = 0.25 + hash(k, 5, 91) * 0.6;
      const ca = Math.cos(a), sa = Math.sin(a);
      for (let s = 0; s < L; s++) { const x = ((Math.floor(sx + ca * s) % N) + N) % N, y = ((Math.floor(sy + sa * s) % N) + N) % N, f = st * Math.sin((s / L) * Math.PI); const i = y * N + x; if (f > scuff[i]) scuff[i] = f; }
    }
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N, i = y * N + x, o = i * 4;
      const big = pfbm(u * 5, v * 5, 5, 41, 4), fine = hash(x, y, 77);
      const sc = scuff[i];
      d[o] = clamp(0.5 + 0.2 * (big - 0.5) + 0.1 * (fine - 0.5) - 0.18 * sc) * 255;
      d[o + 1] = clamp(0.5 + 0.3 * (big - 0.5) + 0.22 * sc + 0.06 * fine) * 255;
      d[o + 2] = clamp(0.92 - 0.16 * sc - 0.08 * big) * 255; d[o + 3] = 255;
    }
    const t = dataTex(T, d, N, N); t.repeat.set(5.5, 5.5); return t;
  });
}
/** canvas weave 128² (RGB luminance + alpha=bump) */
function weaveTexture(T) {
  return cached(T, 'weave', () => {
    const N = 128, d = new Uint8Array(N * N * 4), P = 8;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const cx = Math.floor(x / P), cy = Math.floor(y / P), over = (cx + cy) & 1, fx = (x % P) / P, fy = (y % P) / P;
      const thread = over ? 0.5 + 0.5 * Math.cos((fx - 0.5) * Math.PI) : 0.5 + 0.5 * Math.cos((fy - 0.5) * Math.PI);
      const n = hash(x, y, 5) * 0.14, lum = clamp(0.8 + 0.16 * thread - n * 0.5), o = (y * N + x) * 4;
      d[o] = d[o + 1] = d[o + 2] = lum * 255; d[o + 3] = (0.35 + 0.65 * thread) * 255;
    }
    return dataTex(T, d, N, N);
  });
}
/** 7-bar colour test card for the little monitor (brand colours, no text) */
function barsTexture(T) {
  return cached(T, 'bars', () => {
    const W = 64, H = 36, d = new Uint8Array(W * H * 4), cols = [[0.95, 0.93, 0.85], [1, 0.71, 0.18], [0.12, 0.7, 0.65], [0.95, 0.33, 0.18], [0.42, 0.36, 1], [0.49, 0.77, 1], [0.1, 0.1, 0.14]];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4; let c = cols[Math.min(6, Math.floor((x / W) * 7))], k = y > H * 0.78 ? 0.45 + 0.55 * (x / W) : 1;
      if (y > H * 0.78 && y < H * 0.9) c = [1, 1, 1];
      d[o] = c[0] * k * 255; d[o + 1] = c[1] * k * 255; d[o + 2] = c[2] * k * 255; d[o + 3] = 255;
    }
    return dataTex(T, d, W, H, { repeat: false, mip: false, aniso: 1 });
  });
}

/** Tiny studio HDR env (softboxes in a dark room) baked to PMREM. Returns a Texture or null. */
export function makeStudioEnv(T, renderer) {
  if (!renderer || !T.PMREMGenerator) return null;
  try {
    const sc = new T.Scene(); const room = new T.Mesh(new T.BoxGeometry(34, 18, 34), new T.MeshBasicMaterial({ color: '#07070c', side: T.BackSide })); room.position.y = 7; sc.add(room);
    const panel = (w, h, pos, col, k) => { const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: new T.Color(col).multiplyScalar(k), side: T.DoubleSide })); m.position.set(...pos); m.lookAt(0, 1.2, 0); sc.add(m); };
    panel(9, 4, [-6, 9, 7], '#ffe3bd', 7); panel(2.4, 9, [8, 4, -6], '#9fd4ff', 5.5); panel(12, 3, [0, 15, -1], '#ffffff', 1.6);
    panel(6, 2.4, [5, 1.5, 9], '#ffb870', 1.5); panel(3, 8, [-9, 4, -5], '#6b5bff', 2.5);
    const pm = new T.PMREMGenerator(renderer); const rt = pm.fromScene(sc, 0.025); pm.dispose();
    room.geometry.dispose(); room.material.dispose();
    return rt.texture;
  } catch (e) { return null; }
}

// ------------------------------------------------------------------------------------------------ geometry builder (merges into ONE BufferGeometry)
class GeoBuilder {
  constructor(T) { this.T = T; this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; this.nv = 0; this._v = new T.Vector3(); this._nm = new T.Matrix3(); }
  add(geo, mat, color) {
    const v = this._v, nm = this._nm.getNormalMatrix(mat), pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv, idx = geo.index, flip = mat.determinant() < 0;
    const col = color ? (color.isColor ? [color.r, color.g, color.b] : color) : [1, 1, 1], vc = geo.attributes.color;
    for (let k = 0; k < pos.count; k++) {
      v.fromBufferAttribute(pos, k).applyMatrix4(mat); this.p.push(v.x, v.y, v.z);
      v.fromBufferAttribute(nor, k).applyMatrix3(nm).normalize(); this.n.push(v.x, v.y, v.z);
      this.u.push(uv ? uv.getX(k) : 0, uv ? uv.getY(k) : 0);
      if (vc) this.c.push(vc.getX(k) * col[0], vc.getY(k) * col[1], vc.getZ(k) * col[2]); else this.c.push(col[0], col[1], col[2]);
    }
    const b = this.nv;
    if (idx) for (let k = 0; k < idx.count; k += 3) { const x = idx.getX(k), y = idx.getX(k + 1), z = idx.getX(k + 2); if (flip) this.i.push(b + x, b + z, b + y); else this.i.push(b + x, b + y, b + z); }
    else for (let k = 0; k < pos.count; k += 3) { if (flip) this.i.push(b + k, b + k + 2, b + k + 1); else this.i.push(b + k, b + k + 1, b + k + 2); }
    this.nv += pos.count; return this;
  }
  build() {
    const T = this.T, g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(this.u, 2)); g.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.nv > 65000 ? new T.Uint32BufferAttribute(this.i, 1) : new T.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere(); g.computeBoundingBox(); return g;
  }
  get tris() { return this.i.length / 3; }
}

function makeKit(T) {
  const prim = { box: new T.BoxGeometry(1, 1, 1), cyl6: new T.CylinderGeometry(1, 1, 1, 6, 1), cyl8: new T.CylinderGeometry(1, 1, 1, 8, 1), cyl16: new T.CylinderGeometry(1, 1, 1, 16, 1), cap: new T.CylinderGeometry(1, 1, 1, 16, 1, true), sph: new T.SphereGeometry(1, 12, 8), sphLo: new T.SphereGeometry(1, 8, 6) };
  const q = new T.Quaternion(), up = new T.Vector3(0, 1, 0), m = new T.Matrix4(), s = new T.Vector3(), d = new T.Vector3(), mid = new T.Vector3(), one = new T.Vector3(1, 1, 1);
  const rbCache = new Map();
  const kit = {
    prim,
    /** cylinder from a to b (Vector3) radius r */
    seg(B, a, b, r, color, kind = 'cyl8') { d.subVectors(b, a); const len = d.length(); if (len < 1e-6) return; d.divideScalar(len); q.setFromUnitVectors(up, d); mid.addVectors(a, b).multiplyScalar(0.5); s.set(r, len, r); m.compose(mid, q, s); B.add(prim[kind], m, color); },
    box(B, pos, size, color, rot) { q.identity(); if (rot) q.setFromEuler(rot); m.compose(pos, q, s.set(size[0], size[1], size[2])); B.add(prim.box, m, color); },
    /** rounded box w×h×d (x,y,z), radius r — cached geometry */
    rbox(w, h, d2, r) {
      const key = [w, h, d2, r].map((x) => x.toFixed(4)).join(','); if (rbCache.has(key)) return rbCache.get(key);
      r = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d2 / 2 - 1e-4);
      const sh = new T.Shape(); const iw = w - 2 * r, ih = h - 2 * r; sh.moveTo(-iw / 2, -ih / 2); sh.lineTo(iw / 2, -ih / 2); sh.lineTo(iw / 2, ih / 2); sh.lineTo(-iw / 2, ih / 2); sh.closePath();
      const g = new T.ExtrudeGeometry(sh, { depth: d2 - 2 * r, bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelSegments: 2, curveSegments: 2, steps: 1 });
      g.translate(0, 0, -(d2 - 2 * r) / 2); rbCache.set(key, g); return g;
    },
    /** rounded bar from a to b with cross-section w (along xHint) × h */
    bar(B, a, b, w, h, r, color, xHint) {
      d.subVectors(b, a); const len = d.length(); if (len < 1e-6) return; d.divideScalar(len);
      const x = new T.Vector3().copy(xHint || new T.Vector3(1, 0, 0)); x.addScaledVector(d, -x.dot(d)); if (x.lengthSq() < 1e-6) x.set(0, 0, 1).addScaledVector(d, -d.z); x.normalize();
      const y = new T.Vector3().crossVectors(d, x), M = new T.Matrix4().makeBasis(x, y, d.clone()); M.setPosition(mid.addVectors(a, b).multiplyScalar(0.5));
      B.add(kit.rbox(w, h, len, r), M, color);
    },
    /** matrix whose +Z points from pos toward target (up hint +Y) */
    aim(pos, target, out = new T.Matrix4()) {
      const z = new T.Vector3().subVectors(target, pos).normalize(); let x = new T.Vector3().crossVectors(new T.Vector3(0, 1, 0), z); if (x.lengthSq() < 1e-6) x.set(1, 0, 0); x.normalize();
      const y = new T.Vector3().crossVectors(z, x); out.makeBasis(x, y, z); out.setPosition(pos); return out;
    },
    compose(px, py, pz, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) { q.setFromEuler(new T.Euler(rx, ry, rz)); return new T.Matrix4().compose(new T.Vector3(px, py, pz), q, new T.Vector3(sx, sy, sz)); },
    /** parametric surface -> BufferGeometry (indexed). fn(u,v,out[3]) ; colFn(u,v)->[r,g,b] optional */
    grid(nx, ny, fn, colFn, uvFn) {
      const P = [], U = [], Cc = [], I = [], o = [0, 0, 0], o2 = [0, 0, 0], o3 = [0, 0, 0];
      for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) { const u = i / nx, v = j / ny; fn(u, v, o); P.push(o[0], o[1], o[2]); const uv = uvFn ? uvFn(u, v) : [u, v]; U.push(uv[0], uv[1]); const c = colFn ? colFn(u, v) : [1, 1, 1]; Cc.push(c[0], c[1], c[2]); }
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, e = c + 1; I.push(a, c, b, b, c, e); }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(U, 2)); g.setAttribute('color', new T.Float32BufferAttribute(Cc, 3)); g.setIndex(I); g.computeVertexNormals(); return g;
    },
    dispose() { Object.values(prim).forEach((g) => g.dispose()); rbCache.forEach((g) => g.dispose()); },
  };
  return kit;
}

// ------------------------------------------------------------------------------------------------ the stage
export function createStage(THREE, env = {}, opts = {}) {
  const T = THREE;
  const O = { size: 44, look: 'neutral', truss: true, fixtures: true, chair: true, table: true, cases: true, cables: true, grips: true, tubes: true, marks: true, fog: true, mist: true, reflections: true, bindLights: false, env: true, layout: 'periphery', seed: 7, ...opts };
  const renderer = env.renderer || (env.S && env.S.renderer) || null;
  const size = O.size, C = (h) => new T.Color(h), kit = makeKit(T), V3 = (x, y, z) => new T.Vector3(x, y, z);
  const group = new T.Group(); group.name = 'stage';
  const noiseTex = noiseTexture(T);
  const envMap = O.env ? makeStudioEnv(T, renderer) : null;
  const stageU = { uTime: { value: 0 }, uHazeCol: { value: C('#6f86b8').multiplyScalar(0.05) }, uHazeD: { value: O.fog ? 0.05 : 0 }, uHazeH: { value: 0.7 }, uNoise: { value: noiseTex } };
  const cycU = {
    uWashL: { value: new T.Color() }, uWashR: { value: new T.Color() }, uWashC: { value: new T.Color() }, uPoolP: { value: new T.Vector4(0, 2.2, 4.5, 2.4) }, uWashH: { value: 0.85 }, uCycGlow: { value: 1 }, uWallZ: { value: -9 },
  };
  const floorU = {
    uLA: { value: Array.from({ length: NLINE }, () => new T.Vector3(0, -50, 0)) }, uLB: { value: Array.from({ length: NLINE }, () => new T.Vector3(0, -50, 0)) },
    uLC: { value: Array.from({ length: NLINE }, () => new T.Vector3()) }, uLR: { value: new Array(NLINE).fill(0.05) },
    uReflK: { value: 0.0 }, uReflK2: { value: 1.0 }, uCycRefl: { value: 0.4 }, uFloorR: { value: size * 0.46 },
  };
  const st = { time: 0, hazeK: 1, glowK: 1, look: null, lookName: O.look, dirty: true, mirrors: [], bound: [], reflOn: O.reflections, reflU: { uKeyDir: { value: V3(0.3, 0.8, 0.5).normalize() }, uKeyCol: { value: C('#ffe2b0') } } };

  // ------------------------------------------------------------ materials
  const phys = (p) => { const m = new T.MeshPhysicalMaterial(p); if (envMap) m.envMap = envMap; return m; };
  const std = (p) => { const m = new T.MeshStandardMaterial(p); if (envMap) m.envMap = envMap; return m; };
  const floorTex = floorTexture(T);
  const floorMat = new T.MeshPhysicalMaterial({ color: '#0d0d12', roughness: 0.36, metalness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.32, roughnessMap: floorTex, bumpMap: floorTex, bumpScale: 0.5 });
  floorMat.transparent = true; floorMat.depthWrite = true; floorMat.blending = T.CustomBlending; floorMat.blendSrc = T.OneFactor; floorMat.blendDst = T.OneMinusSrcAlphaFactor; floorMat.blendSrcAlpha = T.OneFactor; floorMat.blendDstAlpha = T.OneMinusSrcAlphaFactor;
  floorMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, stageU, cycU, floorU);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFloorW;').replace('#include <project_vertex>', FLOOR_VERT);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vFloorW;\nuniform vec3 uLA[${NLINE}], uLB[${NLINE}], uLC[${NLINE}]; uniform float uLR[${NLINE}]; uniform float uReflK, uReflK2, uCycRefl, uFloorR;\n${CYC_GLSL}`)
      .replace('#include <opaque_fragment>', FLOOR_FRAG);
  };
  floorMat.customProgramCacheKey = () => 'stage3d-floor-v1';
  const cycMat = new T.MeshStandardMaterial({ color: '#17161e', roughness: 0.94, metalness: 0 });
  cycMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, stageU, cycU);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCycW;').replace('#include <project_vertex>', '#include <project_vertex>\nvCycW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vCycW;\n${CYC_GLSL}`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += cycEmit(vCycW.xy);')
      .replace('#include <opaque_fragment>', 'outgoingLight = stageHaze(outgoingLight, vCycW);\n#include <opaque_fragment>');
  };
  cycMat.customProgramCacheKey = () => 'stage3d-cyc-v1';

  const metalDark = std({ color: '#ffffff', vertexColors: true, metalness: 0.7, roughness: 0.36, envMapIntensity: 2.2 });
  const metalAlu = std({ color: '#9fa2ae', metalness: 1, roughness: 0.36, envMapIntensity: 0.6 });
  const rubber = std({ color: '#0e0e11', roughness: 0.46, metalness: 0, envMapIntensity: 0.7 });
  const caseMat = std({ color: '#ffffff', vertexColors: true, roughness: 0.52, metalness: 0.12, envMapIntensity: 0.7 });
  const woodMat = phys({ color: '#ffffff', vertexColors: true, roughness: 0.42, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.4, envMapIntensity: 0.8 });
  const brassMat = std({ color: '#d9a548', metalness: 1, roughness: 0.27, envMapIntensity: 1.1 });
  const weave = weaveTexture(T);
  const canvasMat = phys({ color: '#ffffff', vertexColors: true, roughness: 0.9, metalness: 0, map: weave, bumpMap: weave, bumpScale: 0.2, side: T.DoubleSide, sheen: 0.5, sheenRoughness: 0.6, sheenColor: C('#fff1d0'), envMapIntensity: 0.5 });
  const tapeMat = new T.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.62, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

  // ------------------------------------------------------------ floor + cyc
  const floor = new T.Mesh(new T.PlaneGeometry(size, size), floorMat); floor.name = 'floor'; floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.renderOrder = -10; group.add(floor);

  const RR = 2.2, WALLZ = -9, HGT = 12.5, FLAT = 13, ENDR = 5.5;
  function planPoint(v, out) { // v in [-1,1] along the wall: flat part |x|<FLAT, then quarter-circle ends curving toward +z
    const ax = Math.abs(v) * (FLAT + ENDR * Math.PI / 2), sg = Math.sign(v) || 1;
    if (ax <= FLAT) { out.x = sg * ax; out.z = WALLZ; out.nx = 0; out.nz = 1; return; }
    const ph = (ax - FLAT) / ENDR; out.x = sg * (FLAT + ENDR * Math.sin(ph)); out.z = WALLZ + ENDR * (1 - Math.cos(ph)); out.nx = -sg * Math.sin(ph); out.nz = Math.cos(ph);
  }
  const cycGeo = (() => {
    const NV = 96, rows = [];
    for (let k = 0; k <= 14; k++) { const th = (k / 14) * Math.PI / 2; rows.push([RR * (1 - Math.sin(th)), RR * (1 - Math.cos(th)), Math.cos(th), Math.sin(th)]); }
    for (let k = 1; k <= 6; k++) rows.push([0, RR + ((HGT - RR) * k) / 6, 0, 1]);
    rows.reverse(); // wall top -> floor tangent
    const P = [], N = [], U = [], I = [], pt = { x: 0, z: 0, nx: 0, nz: 1 };
    for (let j = 0; j < rows.length; j++) for (let i = 0; i <= NV; i++) {
      planPoint((i / NV) * 2 - 1, pt); const r = rows[j];
      P.push(pt.x + pt.nx * r[0], r[1], pt.z + pt.nz * r[0]); N.push(pt.nx * r[3], r[2], pt.nz * r[3]); U.push(i / NV, j / (rows.length - 1));
    }
    for (let j = 0; j < rows.length - 1; j++) for (let i = 0; i < NV; i++) { const a = j * (NV + 1) + i, b = a + 1, c = a + NV + 1, d = c + 1; I.push(a, c, b, b, c, d); }
    { const mid = Math.floor(NV / 2), a = (rows.length - 2) * (NV + 1) + mid, c = a + NV + 1, b = a + 1; const pa = V3(P[a * 3], P[a * 3 + 1], P[a * 3 + 2]), pb = V3(P[b * 3], P[b * 3 + 1], P[b * 3 + 2]), pc = V3(P[c * 3], P[c * 3 + 1], P[c * 3 + 2]); const fn = pb.clone().sub(pa).cross(pc.clone().sub(pa)); if (fn.y * N[a * 3 + 1] + fn.z * N[a * 3 + 2] < 0) for (let k = 0; k < I.length; k += 3) { const t = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = t; } }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(U, 2)); g.setIndex(I);
    g.computeBoundingSphere(); return g;
  })();
  const cyc = new T.Mesh(cycGeo, cycMat); cyc.name = 'cyc'; cyc.receiveShadow = true; group.add(cyc);

  // ------------------------------------------------------------ truss + fixtures
  const trussGroup = new T.Group(); trussGroup.name = 'truss'; group.add(trussGroup);
  const fixtures = [];
  const RIGY = 7.4;
  function addTruss(B, a, b, o = {}) {
    const w = o.w ?? 0.3, h = o.h ?? 0.3, pitch = o.pitch ?? 0.3, A = V3(...a), Bv = V3(...b), dir = Bv.clone().sub(A), len = dir.length(); dir.normalize();
    const upH = Math.abs(dir.y) > 0.95 ? V3(1, 0, 0) : V3(0, 1, 0), side = new T.Vector3().crossVectors(dir, upH).normalize(), upv = new T.Vector3().crossVectors(side, dir).normalize();
    const P = (s, i, j) => A.clone().addScaledVector(dir, s).addScaledVector(side, (i * w) / 2).addScaledVector(upv, (j * h) / 2);
    const chord = C('#6a6a78'), lat = C('#4a4a56');
    for (const i of [-1, 1]) for (const j of [-1, 1]) kit.seg(B, P(0, i, j), P(len, i, j), 0.022, chord, 'cyl8');
    const n = Math.max(1, Math.round(len / pitch)), dl = len / n, faces = [[[-1, 1], [1, 1]], [[-1, -1], [1, -1]], [[-1, -1], [-1, 1]], [[1, -1], [1, 1]]];
    for (let k = 0; k < n; k++) for (const f of faces) { const s0 = k * dl, s1 = (k + 1) * dl, fl = (k + (f[0][0] === f[1][0] ? 1 : 0)) & 1; const c0 = fl ? f[1] : f[0], c1 = fl ? f[0] : f[1]; kit.seg(B, P(s0, c0[0], c0[1]), P(s1, c1[0], c1[1]), 0.009, lat, 'cyl6'); }
    for (const s of [0, len]) kit.box(B, P(s, 0, 0), [0.04, h + 0.05, w + 0.05], C('#34343d'));
  }
  function addFresnel(B, M, o = {}) {
    const col = { body: C('#18181d'), fin: C('#2e2e37'), barrel: C('#0e0e12'), ring: C('#55555f'), door: C('#0a0a0d'), acc: C('#6e4c12') };
    const W = new T.Matrix4(), put = (g, local, c) => { W.multiplyMatrices(M, local); B.add(g, W, c); };
    const cz = (z0, z1, r, c, g = kit.prim.cyl16) => put(g, kit.compose(0, 0, (z0 + z1) / 2, Math.PI / 2, 0, 0, r, z1 - z0, r), c);
    if (o.type === 'par') { cz(-0.2, 0.08, 0.1, col.body); cz(0.08, 0.15, 0.108, col.ring); cz(-0.24, -0.2, 0.07, col.barrel); for (const z of [-0.12, -0.07, -0.02]) cz(z - 0.008, z + 0.008, 0.106, col.fin); return; }
    cz(-0.2, 0.1, 0.125, col.body); cz(-0.25, -0.2, 0.09, col.barrel); cz(0.1, 0.205, 0.105, col.barrel); cz(0.2, 0.213, 0.113, col.ring);
    for (const z of [-0.14, -0.1, -0.06, -0.02]) cz(z - 0.007, z + 0.007, 0.132, col.fin);
    cz(0.05, 0.062, 0.128, col.acc);
    put(kit.prim.sph, kit.compose(0, 0.0, -0.26, 0, 0, 0, 0.04), col.ring);
    const ang = (o.door ?? 28) * DEG;
    for (let k = 0; k < 4; k++) {
      const hinge = kit.compose(0, 0, 0, 0, 0, (k * Math.PI) / 2), tr = kit.compose(0, 0.113, 0.21), rx = kit.compose(0, 0, 0, -ang, 0, 0), off = kit.compose(0, 0.004, 0.07, 0, 0, 0, k & 1 ? 0.15 : 0.215, 0.007, 0.14);
      put(kit.prim.box, new T.Matrix4().multiplyMatrices(hinge, tr).multiply(rx).multiply(off), col.door);
    }
  }
  function addPanel(B, M, w, h) {
    const W = new T.Matrix4(), put = (g, local, c) => { W.multiplyMatrices(M, local); B.add(g, W, c); };
    put(kit.prim.box, kit.compose(0, 0, -0.045, 0, 0, 0, w + 0.06, h + 0.06, 0.09), C('#15151a'));
    for (const sx of [-1, 1]) put(kit.prim.box, kit.compose(sx * (w / 2 + 0.03), 0, -0.02, 0, 0, 0, 0.03, h + 0.1, 0.07), C('#2c2c34'));
    for (const sy of [-1, 1]) put(kit.prim.box, kit.compose(0, sy * (h / 2 + 0.03), -0.02, 0, 0, 0, w + 0.1, 0.03, 0.07), C('#2c2c34'));
  }
  function addYoke(B, pos, dir, hang) {
    const hd = dir.clone().setY(0); const side = hd.lengthSq() < 1e-6 ? V3(1, 0, 0) : new T.Vector3().crossVectors(V3(0, 1, 0), hd.normalize()).normalize();
    const c = C('#26262e'), r = 0.011, a = pos.clone().addScaledVector(side, 0.158), b = pos.clone().addScaledVector(side, -0.158), a2 = a.clone().setY(pos.y + 0.17), b2 = b.clone().setY(pos.y + 0.17);
    kit.seg(B, a, a2, r, c); kit.seg(B, b, b2, r, c); kit.seg(B, a2, b2, r, c);
    const top = pos.clone().setY(hang); kit.seg(B, pos.clone().setY(pos.y + 0.17), top, 0.014, c);
    kit.box(B, top.clone().setY(hang + 0.03), [0.07, 0.06, 0.07], C('#3a3a44'));
    for (const s of [-1, 1]) kit.seg(B, pos.clone().addScaledVector(side, 0.158 * s), pos.clone().addScaledVector(side, 0.17 * s), 0.02, C('#3a3a44'));
  }

  const trussB = new GeoBuilder(T), rigB = new GeoBuilder(T);
  if (O.truss) {
    const x0 = -7.5, x1 = 7.5, zb = -5.2, zm = -1.4, zf = 2.6;
    for (const z of [zb, zm, zf]) addTruss(trussB, [x0, RIGY, z], [x1, RIGY, z]);
    for (const x of [x0, x1, 0]) addTruss(trussB, [x, RIGY, zb], [x, RIGY, zf]);
    for (const x of [x0, x1]) for (const z of [zb, zm, zf]) kit.box(trussB, V3(x, RIGY, z), [0.4, 0.4, 0.4], C('#33333c'));
    for (const [x, z] of [[x0, zb], [x1, zb], [x0, zf], [x1, zf], [0, zm], [-3.75, zb], [3.75, zb], [x0, zm], [x1, zm]]) {
      kit.box(trussB, V3(x, RIGY + 0.32, z), [0.24, 0.3, 0.2], C('#1b1b21')); kit.seg(trussB, V3(x, RIGY + 0.47, z), V3(x, 24, z), 0.012, C('#0d0d10'), 'cyl6');
      for (const k of [-1, 1]) kit.seg(trussB, V3(x + 0.12 * k, RIGY + 0.3, z + 0.1), V3(x + 0.04 * k, RIGY + 1.2, z), 0.006, C('#0d0d10'), 'cyl6');
    }
    const m = new T.Mesh(trussB.build(), metalDark); m.name = 'truss-mesh'; trussGroup.add(m);
  }
  const lensCircle = [], lensRect = [];
  if (O.fixtures) {
    const defs = [];
    for (const x of [-6, -3, 0, 3, 6]) defs.push({ type: 'fresnel', group: 'back', pos: [x, 7.02, -5.2], aim: [x * 0.22, 1.0, -0.6], role: 1 });
    for (const x of [-5, -1.7, 1.7, 5]) defs.push({ type: 'par', group: 'top', pos: [x, 7.04, -1.4], aim: [x * 0.18, 0.2, -1.0], role: 0 });
    for (const x of [-6, -3, 3, 6]) defs.push({ type: 'fresnel', group: 'front', pos: [x, 7.02, 2.6], aim: [-x * 0.12, 0.8, 0.0], role: x < 0 ? 0 : 2 });
    defs.push({ type: 'fresnel', group: 'side', pos: [-7.5, 6.95, -1.4], aim: [0, 1, -0.5], role: 1 }, { type: 'fresnel', group: 'side', pos: [7.5, 6.95, -1.4], aim: [0, 1, -0.5], role: 0 });
    defs.push({ type: 'panel', group: 'top', pos: [0, 7.1, -0.2], aim: [0, 0, -0.2], size: [1.3, 0.8], role: 0 }, { type: 'panel', group: 'top', pos: [0, 7.1, -2.8], aim: [0, 0, -2.8], size: [1.3, 0.8], role: 0 });
    defs.forEach((d, i) => {
      const pos = V3(...d.pos), aim = V3(...d.aim), M = kit.aim(pos, aim), dir = aim.clone().sub(pos).normalize();
      const f = { id: `${d.group}${i}`, index: i, type: d.type, group: d.group, pos, aim, dir, role: d.role, size: d.size || null, color: null, intensity: 1, on: true, lensPos: null, mat: M, lens: new T.Color() };
      if (d.type === 'panel') { addPanel(rigB, M, d.size[0], d.size[1]); f.lensPos = pos.clone().addScaledVector(dir, 0.004); addYoke(rigB, pos, dir, RIGY - 0.15); }
      else { addFresnel(rigB, M, { type: d.type, door: 22 + (i % 3) * 8 }); f.lensPos = pos.clone().addScaledVector(dir, d.type === 'par' ? 0.152 : 0.2); addYoke(rigB, pos, dir, RIGY - 0.15); }
      fixtures.push(f); (d.type === 'panel' ? lensRect : lensCircle).push(f);
    });
  }
  let lensMesh = null, panelMesh = null, haloGeo = null;
  if (fixtures.length) {
    const rm = new T.Mesh(rigB.build(), metalDark); rm.name = 'rig-housings'; trussGroup.add(rm);
    const lm = new T.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, fog: false });
    lensMesh = new T.InstancedMesh(new T.CircleGeometry(1, 20), lm, Math.max(1, lensCircle.length)); lensMesh.name = 'rig-lenses'; lensMesh.frustumCulled = false;
    lensCircle.forEach((f, k) => { const r = f.type === 'par' ? 0.092 : 0.098; lensMesh.setMatrixAt(k, new T.Matrix4().multiplyMatrices(f.mat, kit.compose(0, 0, f.type === 'par' ? 0.153 : 0.205, 0, 0, 0, r))); lensMesh.setColorAt(k, C('#ffffff')); });
    lensMesh.count = lensCircle.length; trussGroup.add(lensMesh);
    if (lensRect.length) {
      panelMesh = new T.InstancedMesh(new T.PlaneGeometry(1, 1), lm, lensRect.length); panelMesh.name = 'rig-panels'; panelMesh.frustumCulled = false;
      lensRect.forEach((f, k) => { panelMesh.setMatrixAt(k, new T.Matrix4().multiplyMatrices(f.mat, kit.compose(0, 0, 0.003, 0, 0, 0, f.size[0], f.size[1], 1))); panelMesh.setColorAt(k, C('#ffffff')); });
      trussGroup.add(panelMesh);
    }
    haloGeo = new T.BufferGeometry(); const n = fixtures.length;
    haloGeo.setAttribute('position', new T.Float32BufferAttribute(fixtures.flatMap((f) => [f.lensPos.x, f.lensPos.y, f.lensPos.z]), 3));
    haloGeo.setAttribute('aCol', new T.BufferAttribute(new Float32Array(n * 3), 3)); haloGeo.setAttribute('aAim', new T.Float32BufferAttribute(fixtures.flatMap((f) => [f.dir.x, f.dir.y, f.dir.z]), 3));
    haloGeo.setAttribute('aSize', new T.Float32BufferAttribute(fixtures.map((f) => (f.type === 'panel' ? 1.1 : f.type === 'par' ? 0.45 : 0.55)), 1));
    const hm = new T.ShaderMaterial({
      uniforms: { uPx: { value: 1000 } }, transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false, fog: false,
      vertexShader: `attribute vec3 aCol, aAim; attribute float aSize; uniform float uPx; varying vec3 vC;
        void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vec4 mv = viewMatrix * wp; gl_Position = projectionMatrix * mv;
          float face = smoothstep(-0.2, 0.6, dot(normalize(mat3(modelMatrix) * aAim), normalize(cameraPosition - wp.xyz)));
          gl_PointSize = clamp(aSize * uPx / max(-mv.z, 0.2), 2.0, 420.0); vC = aCol * face; }`,
      fragmentShader: `varying vec3 vC; void main(){ vec2 c = gl_PointCoord * 2.0 - 1.0; float r = length(c);
          float core = exp(-r * r * 30.0), glow = exp(-r * r * 4.0) * 0.28, cr = (exp(-abs(c.x) * 26.0) * exp(-abs(c.y) * 2.2) + exp(-abs(c.y) * 26.0) * exp(-abs(c.x) * 2.2)) * 0.22;
          float m = (core + glow + cr) * smoothstep(1.0, 0.7, r); gl_FragColor = vec4(vC * m, 1.0); }`,
    });
    const pts = new T.Points(haloGeo, hm); pts.frustumCulled = false; pts.name = 'rig-halos'; pts.renderOrder = 6;
    pts.onBeforeRender = (r, sc, cam) => { hm.uniforms.uPx.value = pxScale(r, cam); };
    trussGroup.add(pts);
  }

  // ------------------------------------------------------------ cases, grips, cables, tape (periphery layout; every cluster is its own Group)
  const casesGroup = new T.Group(); casesGroup.name = 'cases'; group.add(casesGroup);
  const casesL = new T.Group(), casesR = new T.Group(); casesL.name = 'cases-left'; casesR.name = 'cases-right'; casesGroup.add(casesL, casesR);
  const gripsGroup = new T.Group(); gripsGroup.name = 'grips'; group.add(gripsGroup);
  const cablesGroup = new T.Group(); cablesGroup.name = 'cables'; group.add(cablesGroup);
  const marksGroup = new T.Group(); marksGroup.name = 'marks'; group.add(marksGroup);
  const marks = [];
  const tubeDefs = [];
  if (O.tubes) for (const [x, z, h] of [[-5.9, -4.9, 1.7], [5.7, -5.1, 1.7], [-3.1, -6.1, 1.4], [3.2, -6.2, 1.4], [-7.2, -0.6, 1.5], [7.1, -0.2, 1.5]]) tubeDefs.push({ a: V3(x, 0.14, z), b: V3(x, 0.14 + h, z), r: 0.02, kind: 'tube' });
  if (O.cases) {
    const mkCluster = (parent, list) => {
      const caseB = new GeoBuilder(T), alu = new GeoBuilder(T);
      const addCase = (x, y, z, w, h, d, ry, tone = 1, wheels = false) => {
        const M = kit.compose(x, y + h / 2 + (wheels ? 0.08 : 0), z, 0, ry, 0), W = new T.Matrix4(), body = C('#2b2b34').multiplyScalar(tone);
        const put = (B, g, local, c) => { W.multiplyMatrices(M, local); B.add(g, W, c); };
        put(caseB, kit.rbox(w, h, d, 0.018), new T.Matrix4(), body);
        const e = 0.014, rails = [];
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) { rails.push([sx * w / 2, sy * h / 2, 0, e * 2, e * 2, d + 0.01]); rails.push([sx * w / 2, 0, sy * d / 2, e * 2, h + 0.01, e * 2]); rails.push([0, sx * h / 2, sy * d / 2, w + 0.01, e * 2, e * 2]); }
        for (const r of rails) put(alu, kit.prim.box, kit.compose(r[0], r[1], r[2], 0, 0, 0, r[3], r[4], r[5]), C('#ffffff'));
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) put(alu, kit.prim.box, kit.compose(sx * w / 2, sy * h / 2, sz * d / 2, 0, 0, 0, 0.055), C('#ffffff'));
        put(alu, kit.prim.box, kit.compose(0, h * 0.18, d / 2 + 0.006, 0, 0, 0, w * 0.96, 0.012, 0.012), C('#ffffff'));
        for (const sx of [-0.28, 0.28]) { put(alu, kit.prim.box, kit.compose(sx * w, h * 0.18, d / 2 + 0.012, 0, 0, 0, 0.07, 0.05, 0.016), C('#ffffff')); put(alu, kit.prim.box, kit.compose(sx * w, h * 0.18 - 0.05, d / 2 + 0.012, 0, 0, 0, 0.05, 0.03, 0.012), C('#ffffff')); }
        put(alu, kit.rbox(0.16, 0.035, 0.03, 0.01), kit.compose(0, h * 0.18 + h * 0.3, d / 2 + 0.02), C('#ffffff'));
        if (wheels) for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(caseB, kit.prim.cyl8, kit.compose(sx * (w / 2 - 0.08), -h / 2 - 0.04, sz * (d / 2 - 0.08), 0, 0, Math.PI / 2, 0.045, 0.05, 0.045), C('#0b0b0d'));
      };
      list(addCase);
      const bm = new T.Mesh(caseB.build(), caseMat); bm.name = 'cases-body'; bm.castShadow = true; parent.add(bm);
      const am = new T.Mesh(alu.build(), metalAlu); am.name = 'cases-alu'; parent.add(am);
    };
    mkCluster(casesL, (add) => { add(-7.4, 0, -2.7, 1.1, 0.72, 0.6, 0.28, 1.0); add(-7.35, 0.72, -2.7, 0.9, 0.48, 0.52, 0.14, 1.25); add(-7.7, 0, -1.3, 0.8, 0.6, 0.55, -0.35, 0.85); add(-6.6, 0, -4.4, 0.7, 1.15, 0.55, 0.55, 1.1, true); add(-8.2, 0, -3.9, 1.2, 0.5, 0.6, -0.1, 0.9); });
    mkCluster(casesR, (add) => { add(7.2, 0, -3.5, 0.62, 1.1, 0.62, -0.25, 1.0, true); add(6.9, 0, -2.0, 1.15, 0.58, 0.7, 0.4, 1.15); add(6.95, 0.58, -2.0, 0.7, 0.4, 0.5, 0.52, 0.9); add(7.9, 0, -4.6, 1.4, 0.5, 0.6, 0.1, 0.95); });
  }
  if (O.grips) {
    const gb = new GeoBuilder(T), flagB = new GeoBuilder(T), W = new T.Matrix4();
    const cstand = (x, z, ry) => {
      const M = kit.compose(x, 0, z, 0, ry, 0);
      for (let k = 0; k < 3; k++) { const a = (k * TAU) / 3 + 0.4, e = V3(Math.cos(a) * 0.5, 0.05, Math.sin(a) * 0.5), m = new T.Matrix4(); m.lookAt(V3(0, 0.05, 0), e, V3(0, 1, 0)); m.setPosition(e.x / 2, 0.05, e.z / 2); W.multiplyMatrices(M, m); gb.add(kit.rbox(0.035, 0.035, 0.52, 0.01), W, C('#c3c6d2')); }
      kit.seg(gb, V3(0, 0.05, 0).applyMatrix4(M), V3(0, 2.15, 0).applyMatrix4(M), 0.016, C('#d0d3de'), 'cyl8');
      kit.seg(gb, V3(0, 1.95, 0).applyMatrix4(M), V3(0.95, 2.0, 0).applyMatrix4(M), 0.011, C('#d0d3de'), 'cyl8');
      kit.box(gb, V3(0, 1.95, 0).applyMatrix4(M), [0.07, 0.07, 0.06], C('#2b2b33'));
      W.multiplyMatrices(M, kit.compose(0.95, 1.7, 0)); flagB.add(kit.rbox(0.5, 0.7, 0.012, 0.004), W, C('#0b0b0d'));
    };
    cstand(-9.0, -1.6, 0.5); cstand(8.8, -1.0, 3.4);
    for (const t of tubeDefs) { kit.box(gb, V3(t.a.x, 0.03, t.a.z), [0.2, 0.06, 0.2], C('#c3c6d2')); kit.seg(gb, V3(t.a.x, 0.06, t.a.z), t.a, 0.02, C('#c3c6d2')); kit.seg(gb, t.b.clone(), t.b.clone().setY(t.b.y + 0.04), 0.024, C('#c3c6d2')); }
    const m = new T.Mesh(gb.build(), metalAlu); m.name = 'grips-metal'; gripsGroup.add(m);
    const f = new T.Mesh(flagB.build(), std({ color: '#ffffff', vertexColors: true, roughness: 0.95, metalness: 0, side: T.DoubleSide })); f.name = 'grips-flags'; gripsGroup.add(f);
  }
  if (O.cables) {
    const cb = new GeoBuilder(T), P = (...a) => V3(...a);
    const run = (pts, r = 0.016) => { const curve = new T.CatmullRomCurve3(pts, false, 'catmullrom', 0.5); cb.add(new T.TubeGeometry(curve, 56, r, 6, false), new T.Matrix4(), C('#ffffff')); };
    run([P(-7.0, 0.02, -2.0), P(-5.9, 0.016, -1.6), P(-4.8, 0.016, -0.6), P(-3.8, 0.016, -0.3), P(-3.0, 0.016, 0.5), P(-2.6, 0.016, 0.9)]);
    run([P(-6.9, 0.02, -3.3), P(-5.6, 0.016, -3.2), P(-4.4, 0.016, -2.4), P(-3.4, 0.016, -1.5), P(-2.9, 0.02, -0.5)], 0.013);
    run([P(6.3, 0.02, -2.4), P(5.3, 0.016, -1.3), P(4.4, 0.016, 0.2), P(3.6, 0.016, 0.9), P(3.2, 0.016, 1.8)]);
    run([P(6.7, 0.02, -3.8), P(5.5, 0.016, -3.2), P(4.0, 0.016, -2.0), P(3.0, 0.016, -0.9)], 0.012);
    run([P(-6.2, 0.02, -4.2), P(-5.2, 0.016, -4.9), P(-3.2, 0.016, -4.7), P(-1.4, 0.016, -3.6), P(-0.2, 0.016, -2.9), P(0.6, 0.03, -2.3), P(0.9, 0.03, -2.7), P(0.5, 0.03, -3.0), P(0.2, 0.02, -2.6)], 0.017);
    const drop = (x, z, dx, dz) => run([P(x, 7.1, z), P(x + 0.1 * dx, 5, z), P(x + 0.3 * dx, 2, z + 0.1 * dz), P(x + 0.35 * dx, 0.25, z + 0.35 * dz), P(x + 0.7 * dx, 0.016, z + 0.9 * dz)], 0.009);
    drop(-7.5, -5.2, -1, 1); drop(7.5, -5.2, 1, 1);
    const m = new T.Mesh(cb.build(), std({ color: '#ffffff', vertexColors: true, roughness: 0.46, metalness: 0, envMapIntensity: 0.7 })); m.name = 'cables'; m.material.color.set('#101013'); cablesGroup.add(m);
  }
  if (O.marks) {
    const mb = new GeoBuilder(T), TY = 0.003;
    const tape = (x0, z0, x1, z1, w, col) => { const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz) || 1, nx = (-dz / len) * (w / 2), nz = (dx / len) * (w / 2); const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute([x0 - nx, TY, z0 - nz, x0 + nx, TY, z0 + nz, x1 + nx, TY, z1 + nz, x1 - nx, TY, z1 - nz], 3)); g.setAttribute('normal', new T.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3)); g.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2)); g.setIndex([0, 2, 1, 0, 3, 2]); mb.add(g, new T.Matrix4(), C(col)); g.dispose(); };
    const cross = (x, z, a, s, w, col) => { const c = Math.cos(a) * s / 2, sn = Math.sin(a) * s / 2; tape(x - c, z - sn, x + c, z + sn, w, col); tape(x + sn, z - c, x - sn, z + c, w, col); };
    const tmark = (x, z, a, s, w, col) => { const c = Math.cos(a), sn = Math.sin(a); tape(x - c * s / 2, z - sn * s / 2, x + c * s / 2, z + sn * s / 2, w, col); tape(x, z, x - sn * s * 0.9, z + c * s * 0.9, w, col); };
    const cols = ['#ffb62e', '#f2542d', '#1fb5a6', '#6b5bff', '#7cc4ff'];
    cross(0, 0, 0.78, 0.5, 0.045, '#ffb62e'); tmark(0.9, 0.5, 0.2, 0.26, 0.04, '#fff3d6'); tmark(-0.8, 0.7, -0.4, 0.26, 0.04, '#fff3d6');
    for (let k = 0; k < 5; k++) { const x = -2.4 + k * 1.2, z = 2.0 + (k % 2) * 0.35; cross(x, z, 0.1 * k, 0.28, 0.035, cols[k]); marks.push({ x, z, color: cols[k] }); }
    const ring = (cx, cz, r, w, col, n = 40) => { for (let k = 0; k < n; k++) { const a = (k / n) * TAU, b = ((k + 0.6) / n) * TAU; tape(cx + Math.cos(a) * r, cz + Math.sin(a) * r, cx + Math.cos(b) * r, cz + Math.sin(b) * r, w, col); } };
    ring(0, 0, 0.95, 0.03, '#d8cfb8', 56);
    const m = new T.Mesh(mb.build(), tapeMat); m.name = 'tape'; m.receiveShadow = true; marksGroup.add(m);
  }

  // ------------------------------------------------------------ the director's chair
  const chair = new T.Group(); chair.name = 'chair';
  if (O.chair) {
    const wb = new GeoBuilder(T), cbld = new GeoBuilder(T), bb = new GeoBuilder(T), X = V3(1, 0, 0);
    let wk = 0; const wood = () => C('#6a4326').multiplyScalar(0.85 + 0.3 * hash(wk++, 3, O.seed));
    const bar = (a, b, w, h, r) => kit.bar(wb, V3(...a), V3(...b), w, h, r, wood(), X);
    for (const sx of [-1, 1]) {
      const x = sx * 0.285;
      bar([x, 0.015, 0.235], [x, 0.60, -0.235], 0.024, 0.046, 0.009); bar([x, 0.015, -0.235], [x, 0.60, 0.235], 0.024, 0.046, 0.009);
      bar([x, 0.62, -0.27], [x, 0.62, 0.27], 0.03, 0.034, 0.01);
      bar([sx * 0.30, 0.62, 0.215], [sx * 0.30, 0.875, 0.215], 0.03, 0.03, 0.009);
      bar([sx * 0.30, 0.62, -0.245], [sx * 0.30, 1.19, -0.245], 0.03, 0.03, 0.009);
      bar([sx * 0.30, 0.888, -0.275], [sx * 0.30, 0.888, 0.31], 0.064, 0.026, 0.011);
      kit.seg(bb, V3(sx * 0.255, 0.30, 0), V3(sx * 0.33, 0.30, 0), 0.016, C('#ffffff'), 'cyl16'); kit.seg(bb, V3(sx * 0.33, 0.30, 0), V3(sx * 0.345, 0.30, 0), 0.022, C('#ffffff'), 'cyl16');
      kit.seg(bb, V3(sx * 0.30, 0.875, 0.215), V3(sx * 0.30, 0.89, 0.215), 0.019, C('#ffffff'), 'cyl16');
      for (const z of [0.235, -0.235]) kit.seg(wb, V3(x, 0.0, z), V3(x, 0.02, z), 0.017, C('#0b0b0d'), 'cyl8');
    }
    bar([-0.285, 0.035, 0.235], [0.285, 0.035, 0.235], 0.02, 0.03, 0.008); bar([-0.285, 0.035, -0.235], [0.285, 0.035, -0.235], 0.02, 0.03, 0.008);
    kit.seg(wb, V3(-0.31, 1.18, -0.255), V3(0.31, 1.18, -0.255), 0.017, wood(), 'cyl16'); kit.seg(wb, V3(-0.31, 0.935, -0.255), V3(0.31, 0.935, -0.255), 0.015, wood(), 'cyl16');
    kit.seg(wb, V3(-0.30, 0.64, 0.255), V3(0.30, 0.64, 0.255), 0.013, wood(), 'cyl16'); kit.seg(wb, V3(-0.30, 0.64, -0.255), V3(0.30, 0.64, -0.255), 0.013, wood(), 'cyl16');
    const cream = [0.66, 0.54, 0.34], pipe = [0.62, 0.12, 0.06];
    cbld.add(kit.grid(32, 12, (u, v, o) => { const x = (u - 0.5) * 0.56, z = (v - 0.5) * 0.5, sag = 0.034 * (1 - (x / 0.28) ** 2) * (1 - 0.35 * (z / 0.25) ** 2); o[0] = x; o[1] = 0.637 - sag; o[2] = z; }, (u, v) => (v < 0.045 || v > 0.955 ? pipe : cream), (u, v) => [u * 5.6, v * 5.0]), new T.Matrix4(), null);
    cbld.add(kit.grid(32, 8, (u, v, o) => { const x = (u - 0.5) * 0.56, y = 0.945 + v * 0.22, k = (y - 1.055) / 0.11; o[0] = x; o[1] = y; o[2] = -0.262 - 0.016 * (1 - k * k) * (1 - 0.3 * (x / 0.28) ** 2); }, (u, v) => (v < 0.06 || v > 0.94 ? pipe : cream), (u, v) => [u * 5.6, v * 2.2]), new T.Matrix4(), null);
    for (let k = 0; k < 9; k++) { const x = -0.255 + k * 0.06375; for (const y of [0.953, 1.157]) kit.seg(bb, V3(x, y, -0.2685), V3(x, y, -0.2595), 0.0075, C('#ffffff'), 'cyl8'); }
    for (let k = 0; k < 7; k++) { const z = -0.215 + k * 0.0717; for (const x of [-0.262, 0.262]) kit.seg(bb, V3(x, 0.628, z), V3(x, 0.639, z), 0.0075, C('#ffffff'), 'cyl8'); }
    chair.add(Object.assign(new T.Mesh(wb.build(), woodMat), { name: 'chair-wood', castShadow: true }));
    chair.add(Object.assign(new T.Mesh(cbld.build(), canvasMat), { name: 'chair-canvas', castShadow: true, receiveShadow: true }));
    chair.add(Object.assign(new T.Mesh(bb.build(), brassMat), { name: 'chair-brass' }));
  }
  group.add(chair);

  // ------------------------------------------------------------ table + clapper + monitor + lamp
  const table = new T.Group(); table.name = 'table';
  const clapper = { group: new T.Group(), arm: null, board: null, setOpen(k) { if (this.arm) this.arm.rotation.z = clamp(k, 0, 1) * 0.62; return this; } }; clapper.group.name = 'clapper';
  const LAMP = V3(-0.10, 0.99, -0.03); let lampDef = null;
  if (O.table) {
    const tb = new GeoBuilder(T), tm = new GeoBuilder(T), mug = new GeoBuilder(T), mon = new GeoBuilder(T);
    tb.add(kit.rbox(0.95, 0.04, 0.55, 0.012), kit.compose(0, 0.76, 0), C('#4a2f1e'));
    tb.add(kit.rbox(0.9, 0.018, 0.5, 0.006), kit.compose(0, 0.22, 0), C('#2a1a12'));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { kit.seg(tm, V3(sx * 0.43, 0.02, sz * 0.23), V3(sx * 0.43, 0.74, sz * 0.23), 0.019, C('#c3c6d2'), 'cyl16'); kit.seg(tm, V3(sx * 0.43, 0.0, sz * 0.23), V3(sx * 0.43, 0.02, sz * 0.23), 0.026, C('#0b0b0d'), 'cyl16'); }
    for (const sz of [-1, 1]) kit.seg(tm, V3(-0.43, 0.2, sz * 0.23), V3(0.43, 0.2, sz * 0.23), 0.012, C('#c3c6d2'));
    for (let k = 0; k < 4; k++) tb.add(kit.rbox(0.21, 0.004, 0.297, 0.001), kit.compose(0.12 + 0.004 * k, 0.784 + k * 0.0045, 0.12, 0, 0.1 + k * 0.05, 0), C('#f4ecd8'));
    kit.seg(tm, V3(0.06, 0.805, 0.2), V3(0.06, 0.812, 0.2), 0.008, C('#d9a548'), 'cyl8');
    kit.seg(tb, V3(0.0, 0.806, 0.02), V3(0.2, 0.806, 0.12), 0.004, C('#ffb62e'), 'cyl6');
    mug.add(new T.CylinderGeometry(0.04, 0.035, 0.09, 20, 1, false), kit.compose(-0.33, 0.825, 0.12), C('#f2542d')); mug.add(new T.TorusGeometry(0.026, 0.006, 6, 14, Math.PI), kit.compose(-0.285, 0.825, 0.12, 0, 0, -Math.PI / 2), C('#f2542d'));
    const lx = -0.32, lz = -0.14;
    kit.seg(tm, V3(lx, 0.78, lz), V3(lx, 0.8, lz), 0.07, C('#15151a'), 'cyl16'); kit.seg(tm, V3(lx, 0.8, lz), V3(lx + 0.06, 1.0, lz + 0.03), 0.009, C('#c3c6d2')); kit.seg(tm, V3(lx + 0.06, 1.0, lz + 0.03), V3(lx + 0.2, 1.05, lz + 0.1), 0.009, C('#c3c6d2'));
    tm.add(new T.CylinderGeometry(0.035, 0.085, 0.11, 20, 1, true), kit.compose(lx + 0.22, 1.03, lz + 0.11, 0.35, 0, -0.3), C('#15151a'));
    const MM = kit.compose(0.3, 0.915, -0.12, 0, -0.35, 0), W2 = new T.Matrix4();
    mon.add(kit.rbox(0.25, 0.165, 0.025, 0.008), MM, C('#0c0c10')); W2.multiplyMatrices(MM, kit.compose(0, -0.12, -0.02, 0.2, 0, 0, 0.03, 0.12, 0.012)); mon.add(kit.prim.box, W2, C('#15151a'));
    kit.box(mon, V3(0.3, 0.783, -0.12), [0.1, 0.006, 0.07], C('#15151a'));
    const mk = (g, mat, name) => { const m = new T.Mesh(g, mat); m.name = name; m.castShadow = true; table.add(m); return m; };
    mk(tb.build(), woodMat, 'table-wood'); mk(tm.build(), metalAlu, 'table-metal'); mk(mug.build(), phys({ color: '#ffffff', vertexColors: true, roughness: 0.25, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08 }), 'table-mug'); mk(mon.build(), rubber, 'table-monitor');
    const scr = new T.Mesh(new T.PlaneGeometry(0.225, 0.126), new T.MeshBasicMaterial({ map: barsTexture(T), color: C('#ffffff').multiplyScalar(0.8), toneMapped: false, fog: false })); scr.name = 'table-screen';
    scr.position.set(0.3 + 0.0128 * Math.sin(-0.35), 0.918, -0.12 + 0.0128 * Math.cos(-0.35)); scr.rotation.y = -0.35; table.add(scr);
    const cb = new GeoBuilder(T), ab = new GeoBuilder(T), bw = 0.34, bh = 0.25, chalk = C('#ece6d6');
    cb.add(kit.rbox(bw, bh, 0.022, 0.004), kit.compose(0, bh / 2 + 0.002, 0), C('#101014'));
    for (const y of [0.075, 0.125, 0.175]) cb.add(kit.prim.box, kit.compose(0, y, 0.0115, 0, 0, 0, bw * 0.92, 0.004, 0.001), chalk);
    cb.add(kit.prim.box, kit.compose(-0.06, 0.125, 0.0115, 0, 0, 0, 0.004, 0.1, 0.001), chalk); cb.add(kit.prim.box, kit.compose(0.07, 0.15, 0.0115, 0, 0, 0, 0.004, 0.05, 0.001), chalk);
    cb.add(kit.prim.box, kit.compose(0.1, 0.075, 0.0115, 0, 0, 0, 0.1, 0.03, 0.001), chalk.clone().multiplyScalar(0.55));
    const stripes = (B, y0, hgt, x0, x1, n, flip, mat0) => { for (let k = 0; k < n; k += 2) { const w = (x1 - x0) / n, xa = x0 + k * w, g = kit.grid(1, 1, (u, v, o) => { o[0] = xa + u * w + (flip ? 1 : -1) * (v - 0.5) * hgt * 0.8; o[1] = y0 + v * hgt; o[2] = 0; }); B.add(g, mat0, chalk); g.dispose(); } };
    cb.add(kit.rbox(bw, 0.034, 0.022, 0.004), kit.compose(0, bh + 0.03, 0), C('#101014')); stripes(cb, bh + 0.013, 0.034, -bw / 2 + 0.03, bw / 2 - 0.03, 10, true, kit.compose(0, 0, 0.0118));
    ab.add(kit.rbox(bw, 0.036, 0.022, 0.004), kit.compose(bw / 2, 0.018, 0), C('#101014')); stripes(ab, 0.0, 0.036, 0.03, bw - 0.03, 10, false, kit.compose(0, 0, 0.0118));
    const cm = phys({ color: '#ffffff', vertexColors: true, roughness: 0.5, metalness: 0, clearcoat: 0.2, envMapIntensity: 0.6 });
    const board = new T.Mesh(cb.build(), cm); board.name = 'clapper-board'; board.castShadow = true;
    const arm = new T.Mesh(ab.build(), cm); arm.name = 'clapper-arm'; arm.castShadow = true; arm.position.set(-bw / 2, bh + 0.052, 0.0); clapper.arm = arm; clapper.board = board;
    clapper.group.add(board, arm); clapper.group.position.set(-0.04, 0.782, -0.04); clapper.group.rotation.set(-0.2, 0.18, 0); clapper.setOpen(0.45); table.add(clapper.group);
    lampDef = { a: LAMP.clone(), b: LAMP.clone(), r: 0.03, kind: 'bulb' };
  }
  group.add(table);

  // ------------------------------------------------------------ LED tubes (+ lamp bulb) as emissive instances
  if (lampDef) tubeDefs.push(lampDef);
  const lampIdx = lampDef ? tubeDefs.length - 1 : -1;
  let tubeMesh = null;
  if (tubeDefs.length) {
    tubeMesh = new T.InstancedMesh(new T.CylinderGeometry(1, 1, 1, 10, 1), new T.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, fog: false }), tubeDefs.length); tubeMesh.name = 'tubes'; tubeMesh.frustumCulled = false;
    tubeDefs.forEach((t, k) => { const mid = t.a.clone().add(t.b).multiplyScalar(0.5), h = t.kind === 'bulb' ? 0.05 : t.b.y - t.a.y; tubeMesh.setMatrixAt(k, kit.compose(mid.x, mid.y, mid.z, 0, 0, 0, t.r, h, t.r)); tubeMesh.setColorAt(k, C('#ffffff')); });
    group.add(tubeMesh);
  }

  // ------------------------------------------------------------ mist (2 premultiplied layers)
  const mists = [];
  if (O.mist) {
    const mistU = { uTime: stageU.uTime, uNoise: stageU.uNoise, uColor: { value: new T.Color('#7c92c8') }, uCenter: { value: new T.Vector2(0, -1) }, uCenterCol: { value: new T.Color('#ffd7a0') } };
    [[0.22, 0.9, 0.06], [0.7, 1.4, 0.045]].forEach(([y, scale, amt], i) => {
      const mat = new T.ShaderMaterial({
        uniforms: { ...mistU, uAmt: { value: amt }, uH: { value: y }, uScale: { value: scale }, uSeed: { value: i } }, transparent: true, depthWrite: false, side: T.DoubleSide, fog: false, toneMapped: false,
        blending: T.CustomBlending, blendSrc: T.OneFactor, blendDst: T.OneMinusSrcAlphaFactor, blendSrcAlpha: T.OneFactor, blendDstAlpha: T.OneMinusSrcAlphaFactor,
        vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
        fragmentShader: `precision highp float; varying vec3 vW; uniform sampler2D uNoise; uniform vec3 uColor, uCenterCol; uniform vec2 uCenter; uniform float uTime, uAmt, uH, uScale, uSeed;
          void main(){ vec2 p = vW.xz * 0.05 * uScale;
            float n1 = texture2D(uNoise, p + vec2(uTime * 0.004, uTime * 0.0025) * uScale + uSeed * 0.37).r, n2 = texture2D(uNoise, p * 2.3 - vec2(uTime * 0.006, 0.0) + uSeed).g;
            float d = smoothstep(0.36, 0.86, n1 * 0.62 + n2 * 0.38);
            float dc = distance(cameraPosition, vW), camF = smoothstep(1.2, 4.5, dc), yF = smoothstep(0.0, 0.45, abs(cameraPosition.y - uH));
            float edge = smoothstep(19.0, 8.0, length(vW.xz));
            float pool = exp(-dot(vW.xz - uCenter, vW.xz - uCenter) / 22.0);
            vec3 col = uColor * (0.55 + 0.6 * smoothstep(-9.0, -3.0, vW.z)) + uCenterCol * pool * 1.4;
            float a = d * uAmt * camF * yF * edge; gl_FragColor = vec4(col * a, a * 0.55); }`,
      });
      const m = new T.Mesh(new T.PlaneGeometry(size * 0.9, size * 0.9), mat); m.rotation.x = -Math.PI / 2; m.position.y = y; m.renderOrder = -4; m.name = 'mist' + i; m.frustumCulled = false; group.add(m); mists.push(m);
    });
  }

  // ------------------------------------------------------------ lights (v0 contract)
  const lights = {};
  lights.key = new T.SpotLight('#ffe2b0', 220, 40, 0.5, 0.6, 2); lights.key.position.set(3, 8, 4); lights.key.castShadow = true; lights.key.shadow.mapSize.set(1024, 1024); lights.key.shadow.bias = -0.0004; lights.key.target.position.set(0, 0.5, 0);
  lights.fill = new T.PointLight('#7aa8ff', 25, 30, 2); lights.fill.position.set(-5, 3, 4);
  lights.rim = new T.SpotLight('#9fd4ff', 180, 40, 0.6, 0.7, 2); lights.rim.position.set(-3, 5, -5); lights.rim.target.position.set(0, 0.8, 0);
  lights.amb = new T.AmbientLight('#2a2f4a', 0.5);
  Object.values(lights).forEach((l) => { group.add(l); if (l.target) group.add(l.target); });

  // ------------------------------------------------------------ rig control
  const rig = {
    fixtures,
    get(sel) { if (sel == null || sel === 'all') return fixtures; if (typeof sel === 'number') return fixtures[sel] ? [fixtures[sel]] : []; if (typeof sel === 'function') return fixtures.filter(sel); if (Array.isArray(sel)) return sel.flatMap((s) => rig.get(s)); return fixtures.filter((f) => f.id === sel || f.group === sel || f.type === sel); },
    /** set({color, intensity, on}) on a selection (color:null -> back to the look's colour) */
    set(sel, p = {}) { for (const f of rig.get(sel)) { if ('color' in p) f.color = p.color == null ? null : new T.Color(p.color); if (p.intensity != null) f.intensity = p.intensity; if (p.on != null) f.on = p.on; } st.dirty = true; return rig; },
    /** volumetric beams from selected fixtures down to the floor: { group, beams[], update(t) }. o: {sel, max, angle, intensity, noise, color, beam:{...createBeam opts}} */
    beams(o = {}) {
      const sel = rig.get(o.sel ?? 'front').slice(0, o.max ?? 6), out = { group: new T.Group(), beams: [], update(t) { for (const b of this.beams) b.update(t); } }; out.group.name = 'rig-beams';
      for (const f of sel) {
        const to = f.aim.clone(); if (o.floor !== false && f.dir.y < -0.05) to.copy(f.lensPos).addScaledVector(f.dir, -f.lensPos.y / f.dir.y);
        const b = createBeam(T, { from: f.lensPos.clone(), to, color: o.color ?? (f.color ? f.color.clone() : lookLens(f.role)), angle: o.angle ?? 0.2, intensity: o.intensity ?? 1, noise: o.noise ?? 1, ...(o.beam || {}) }); b.fixture = f; out.beams.push(b); out.group.add(b.object);
      }
      group.add(out.group); return out;
    },
  };
  const tubesApi = {
    items: tubeDefs.map((t, i) => ({ i, a: t.a, b: t.b, kind: t.kind, color: null, intensity: 1, lens: new T.Color() })),
    get count() { return tubesApi.items.length; },
    set(i, p = {}) { const it = tubesApi.items[i]; if (!it) return tubesApi; if ('color' in p) it.color = p.color == null ? null : new T.Color(p.color); if (p.intensity != null) it.intensity = p.intensity; st.dirty = true; return tubesApi; },
    setAll(p) { tubesApi.items.forEach((_, i) => tubesApi.set(i, p)); return tubesApi; },
  };

  // ------------------------------------------------------------ per-render sync (matrices, uniforms, instance colours)
  const _c = new T.Color(), _m4 = new T.Matrix4(), _v = new T.Vector3(), _v2 = new T.Vector3(), _q = new T.Quaternion(), _s = new T.Vector3(1, 1, 1);
  const lookLens = (role) => C((st.look ? st.look.lens : LOOKS.neutral.lens)[role % 3]);
  function syncRig() {
    fixtures.forEach((f, k) => {
      const base = f.color || lookLens(f.role), e = (f.on ? f.intensity : 0) * st.glowK * (f.type === 'panel' ? 1.4 : 2.2);
      f.lens.copy(base).multiplyScalar(e);
      if (f.type === 'panel') panelMesh.setColorAt(lensRect.indexOf(f), f.lens); else lensMesh.setColorAt(lensCircle.indexOf(f), f.lens);
      haloGeo.attributes.aCol.setXYZ(k, f.lens.r * 0.2, f.lens.g * 0.2, f.lens.b * 0.2);
    });
    lensMesh.instanceColor.needsUpdate = true; if (panelMesh) panelMesh.instanceColor.needsUpdate = true; haloGeo.attributes.aCol.needsUpdate = true;
  }
  function syncTubes() {
    if (!tubeMesh) return;
    tubeDefs.forEach((t, k) => {
      const it = tubesApi.items[k], base = it.color || C(st.look ? st.look.tubes[k % 2] : '#7cc4ff');
      it.lens.copy(base).multiplyScalar((t.kind === 'bulb' ? 3.2 : 1.5) * it.intensity * st.glowK); tubeMesh.setColorAt(k, it.lens);
    });
    tubeMesh.instanceColor.needsUpdate = true;
  }
  function syncFloorLights() {
    const A = floorU.uLA.value, B = floorU.uLB.value, Cc = floorU.uLC.value, R = floorU.uLR.value; let n = 0;
    for (let k = 0; k < tubeDefs.length && n < NLINE; k++, n++) {
      const t = tubeDefs[k], it = tubesApi.items[k];
      if (t.kind === 'bulb') { A[n].copy(LAMP).applyMatrix4(table.matrix); B[n].copy(A[n]); R[n] = 0.05; } else { A[n].copy(t.a); B[n].copy(t.b); R[n] = t.r * 1.5; }
      Cc[n].set(it.lens.r * (t.kind === 'bulb' ? 0.3 : 0.6), it.lens.g * (t.kind === 'bulb' ? 0.3 : 0.6), it.lens.b * (t.kind === 'bulb' ? 0.3 : 0.6));
    }
    for (; n < NLINE; n++) { Cc[n].set(0, 0, 0); A[n].set(0, -50, 0); B[n].set(0, -50, 0); }
  }
  function syncBound() {
    for (const b of st.bound) {
      const l = b.light, p = _v.copy(l.position), tg = l.target ? _v2.copy(l.target.position) : _v2.set(0, 0.5, 0);
      kit.aim(p, tg, _m4); b.group.matrix.copy(_m4); b.group.matrixWorldNeedsUpdate = true;
      const k = clamp(l.intensity / b.ref, 0, 3); _c.copy(l.color).multiplyScalar(0.05 + 2.8 * k * st.glowK); b.lens.material.color.copy(_c);
      b.pipe.visible = p.y < RIGY - 0.2 && p.y > 2; b.pipe.position.set(p.x, (p.y + RIGY) / 2, p.z); b.pipe.scale.set(0.012, RIGY - p.y, 0.012);
      b.halo.material.color.copy(_c).multiplyScalar(0.3); b.halo.position.copy(p).addScaledVector(_v2.sub(p).normalize(), 0.22);
    }
  }
  const baseUpdate = T.Object3D.prototype.updateMatrixWorld;
  group.updateMatrixWorld = function (force) {
    if (st.dirty) { if (fixtures.length) syncRig(); syncTubes(); st.dirty = false; }
    table.updateMatrix();
    if (lampIdx >= 0) { _v.copy(LAMP).applyMatrix4(table.matrix); const mid = _v; _m4.compose(mid, _q.identity(), _s.set(0.03, 0.05, 0.03)); tubeMesh.setMatrixAt(lampIdx, _m4); tubeMesh.instanceMatrix.needsUpdate = true; }
    syncFloorLights(); if (st.bound.length) syncBound();
    if (st.mirrors.length) {
      const key = lights.key; _v.copy(key.position).sub(key.target.position).normalize(); st.reflU.uKeyDir.value.copy(_v); st.reflU.uKeyCol.value.copy(key.color).multiplyScalar(clamp(key.intensity / 220, 0.35, 1.4));
      let any = false; for (const m of st.mirrors) if (m.syncAll()) any = true; floorU.uReflK.value = any && st.reflOn ? 0.85 : 0;
    } else floorU.uReflK.value = 0;
    baseUpdate.call(this, force);
  };

  const boundGroup = new T.Group(); boundGroup.name = 'bound-fixtures'; group.add(boundGroup);
  const radial = () => radialTexture(T);
  function bindLightFixtures() {
    const B = new GeoBuilder(T); addFresnel(B, new T.Matrix4(), { door: 26 }); const geo = B.build();
    for (const [name, ref] of [['key', 260], ['rim', 260]]) {
      const light = lights[name], g = new T.Group(); g.matrixAutoUpdate = false;
      const body = new T.Mesh(geo, metalDark); body.scale.setScalar(1.15);
      const lens = new T.Mesh(new T.CircleGeometry(0.098 * 1.15, 20), new T.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, fog: false })); lens.position.z = 0.205 * 1.15;
      const pipe = new T.Mesh(kit.prim.cyl6, std({ color: '#1f1f26', metalness: 0.8, roughness: 0.4 })); pipe.frustumCulled = false;
      const halo = new T.Sprite(new T.SpriteMaterial({ map: radial(), color: '#ffffff', blending: T.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, fog: false })); halo.scale.set(1.3, 1.3, 1);
      g.add(body, lens); boundGroup.add(g, pipe, halo); st.bound.push({ light, group: g, lens, pipe, halo, ref });
    }
  }

  const POS = {
    periphery: { table: [6.9, 0, 0.7, -0.85], casesL: [0, 0, 0], casesR: [0, 0, 0] },
    showcase: { table: [-3.4, 0, -1.5, 0.55], casesL: [1.9, 0, 0.9], casesR: [-1.6, 0, 0.9] },
  };
  const api = {
    THREE: T, group, floor, cyc, chair, lights, floorMat, cycMat, rig, tubes: tubesApi, table, clapper, cases: casesGroup, casesLeft: casesL, casesRight: casesR, truss: trussGroup, grips: gripsGroup, cables: cablesGroup, marks: marksGroup, marksList: marks, mists, envMap, options: O,
    uniforms: { stage: stageU, cyc: cycU, floor: floorU }, state: st, kit,
    update(tOrT) { const t = typeof tOrT === 'number' ? tOrT : tOrT.t; stageU.uTime.value = t; st.time = t; return api; },
    setHaze(k) { st.hazeK = k; stageU.uHazeD.value = (O.fog ? 1 : 0) * (st.look ? st.look.hazeD : 0.05) * k; mists.forEach((m, i) => { m.material.uniforms.uAmt.value = [0.06, 0.045][i] * k * (st.look ? st.look.haze[1] * 2 : 1); }); return api; },
    setGlow(k) { st.glowK = k; st.dirty = true; return api; },
    setLook(name, o) { return setLook(api, name, o); },
    /** blend two looks (names or look objects), k 0..1; pass {lights:true} to also recolour key/fill/rim/amb */
    blendLook(a, b, k, o = {}) { return setLook(api, blendLooks(T, a, b, k), { lights: false, quiet: !o.lights, ...o }); },
    bindLights(on = true) { if (on && !st.bound.length) bindLightFixtures(); boundGroup.visible = on; if (!on) st.bound.length = 0; return api; },
    reflect(obj, o) { return reflect(api, obj, o); },
    /** 'periphery' (default, props out of the way) | 'showcase' (table + cases pulled in, for lab shots) */
    layout(name) { const p = POS[name] || POS.periphery; table.position.set(p.table[0], p.table[1], p.table[2]); table.rotation.y = p.table[3]; casesL.position.set(...p.casesL); casesR.position.set(...p.casesR); return api; },
    radialTexture: radial,
    dispose() { group.traverse((o) => { o.geometry && o.geometry.dispose(); const m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose()); }); kit.dispose(); },
  };
  api.layout(O.layout);
  if (O.bindLights) api.bindLights(true);
  setLook(api, O.look, { quiet: true });
  if (O.reflections && O.chair) api.chairReflection = reflect(api, chair, { strength: 1 });
  if (O.reflections && O.table && O.reflectTable) api.tableReflection = reflect(api, table, { strength: 0.9, filter: (m) => m.name !== 'table-screen' });
  { let meshes = 0, tris = 0; group.traverse((o) => { if ((o.isMesh || o.isPoints) && o.visible) { meshes++; const g = o.geometry; tris += ((g.index ? g.index.count : g.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1); } }); api.stats = { meshes, tris: Math.round(tris) }; }
  api.update(0);
  return api;
}

/** shared soft radial sprite texture (alpha falloff) */
export function radialTexture(T) {
  return cached(T, 'radial', () => { const N = 128, d = new Uint8Array(N * N * 4); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const r = Math.hypot(((x + 0.5) / N) * 2 - 1, ((y + 0.5) / N) * 2 - 1), a = Math.max(0, 1 - r), o = (y * N + x) * 4; d[o] = d[o + 1] = d[o + 2] = 255; d[o + 3] = Math.pow(a, 2.2) * 255; } return dataTex(T, d, N, N, { repeat: false, mip: false, aniso: 1 }); });
}

// ------------------------------------------------------------------------------------------------ looks / rigs / pools
export function setLook(stage, name = 'neutral', o = {}) {
  const T = stage.THREE, L = (name && typeof name === 'object') ? name : (LOOKS[name] || LOOKS.neutral), k = o.intensity ?? 1, cu = stage.uniforms.cyc, su = stage.uniforms.stage, st = stage.state, col = (v) => new T.Color(v);
  st.look = { ...L, name: typeof name === 'object' ? (L.name || 'blend') : name }; st.lookName = st.look.name;
  cu.uWashL.value.copy(col(L.washL[0])).multiplyScalar(L.washL[1] * k); cu.uWashR.value.copy(col(L.washR[0])).multiplyScalar(L.washR[1] * k); cu.uWashC.value.copy(col(L.pool[0])).multiplyScalar(L.pool[1] * k * 0.9); cu.uCycGlow.value = L.glow;
  su.uHazeCol.value.copy(col(L.haze[0])).multiplyScalar(L.haze[1] * 0.16 * (0.5 + k * 0.5));
  stage.floorMat.color.set(L.floor);
  stage.mists.forEach((m) => { m.material.uniforms.uColor.value.copy(col(L.haze[0])); m.material.uniforms.uCenterCol.value.copy(col(L.lens[0])).multiplyScalar(0.25); });
  if (o.lights !== false && !o.quiet) { const Ls = stage.lights; Ls.key.color.set(L.key[0]); Ls.fill.color.set(L.fill[0]); Ls.rim.color.set(L.rim[0]); Ls.amb.color.set(L.amb[0]); Ls.amb.intensity = L.amb[1]; }
  st.dirty = true; stage.setHaze(st.hazeK);
  return L;
}

/** Interpolated look object between two presets (k 0..1) — feed it to setLook / stage.blendLook. For the COLOR job's grade transformation. */
export function blendLooks(T, a, b, k) {
  const A = typeof a === 'string' ? LOOKS[a] : a, B = typeof b === 'string' ? LOOKS[b] : b, hx = (x, y, t) => '#' + new T.Color(x).lerp(new T.Color(y), t).getHexString(), lr = (x, y) => x + (y - x) * k;
  const pair = (p, q) => [hx(p[0], q[0], k), lr(p[1], q[1])], arr = (p, q) => p.map((v, i) => hx(v, q[i], k));
  return { key: pair(A.key, B.key), fill: pair(A.fill, B.fill), rim: pair(A.rim, B.rim), amb: pair(A.amb, B.amb), washL: pair(A.washL, B.washL), washR: pair(A.washR, B.washR), pool: pair(A.pool, B.pool), glow: lr(A.glow, B.glow), haze: pair(A.haze, B.haze), hazeD: lr(A.hazeD, B.hazeD), lens: arr(A.lens, B.lens), tubes: arr(A.tubes, B.tubes), floor: hx(A.floor, B.floor, k), bg: hx(A.bg, B.bg, k), name: 'blend' };
}

/** Position key/fill/rim around a target. Angles in DEGREES: az 0 = from the camera side (+Z), +az toward +X; el above the horizon.
 *  key/fill/rim: { az, el, dist, color, intensity, angle, penumbra, aim:[x,y,z] } */
export function rigThreePoint(stage, { target = [0, 0.9, 0], key = {}, fill = {}, rim = {}, look = null } = {}) {
  const L = look ? LOOKS[look] : stage.state.look || LOOKS.neutral, Ls = stage.lights;
  const place = (light, d, defAz, defEl, defDist, defCol, defI, defAng, defPen) => {
    const az = (d.az ?? defAz) * DEG, el = (d.el ?? defEl) * DEG, dist = d.dist ?? defDist;
    light.position.set(target[0] + Math.sin(az) * Math.cos(el) * dist, target[1] + Math.sin(el) * dist, target[2] + Math.cos(az) * Math.cos(el) * dist);
    if (light.target) { light.target.position.set(...(d.aim || target)); light.target.updateMatrixWorld(); }
    light.color.set(d.color ?? defCol); light.intensity = d.intensity ?? defI; if (light.isSpotLight) { light.angle = d.angle ?? defAng; light.penumbra = d.penumbra ?? defPen; }
  };
  place(Ls.key, key, -35, 38, 9.5, L.key[0], 230 * L.key[1], 0.42, 0.7);
  place(Ls.fill, fill, 55, 12, 9, L.fill[0], 7 * L.fill[1], 0, 0);
  place(Ls.rim, rim, 165, 32, 9, L.rim[0], 330 * L.rim[1], 0.38, 0.8);
  Ls.amb.intensity = L.amb[1]; Ls.amb.color.set(L.amb[0]);
  return Ls;
}

/** Soft additive light pool on the floor (cheap "spotlight on the floor" decal). Returns the Mesh; mesh.userData.set({x,z,radius,color,intensity,aspect,rot}) retunes it.
 *  o: { x,z,radius,color,intensity,aspect,rot,edge,ring,breakup,y, add:true } */
export function spotPool(stage, o = {}) {
  const T = stage.THREE, P = { x: 0, z: 0, radius: 2, color: '#ffd9a0', intensity: 0.5, aspect: 1, rot: 0, edge: 0.55, ring: 0, breakup: 0, y: 0.006, add: true, ...o };
  const mat = new T.ShaderMaterial({
    uniforms: { uCol: { value: new T.Color(P.color) }, uI: { value: P.intensity }, uEdge: { value: P.edge }, uRing: { value: P.ring }, uBreak: { value: P.breakup }, uNoise: stage.uniforms.stage.uNoise, uTime: stage.uniforms.stage.uTime },
    transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `precision highp float; varying vec2 vUv; uniform vec3 uCol; uniform float uI, uEdge, uRing, uBreak, uTime; uniform sampler2D uNoise;
      void main(){ vec2 p = (vUv - 0.5) * 2.0; float r = length(p); float a = smoothstep(1.0, 1.0 - uEdge, r); a *= a;
        a += uRing * exp(-pow((r - 0.86) / 0.07, 2.0)) * smoothstep(1.0, 0.8, r);
        float n = texture2D(uNoise, p * 0.7 + 0.5 + uTime * 0.01).g; a *= 1.0 + uBreak * (n - 0.5) * 2.0;
        gl_FragColor = vec4(uCol * uI * max(a, 0.0), 1.0); }`,
  });
  const m = new T.Mesh(new T.PlaneGeometry(1, 1), mat); m.name = 'spot-pool'; m.rotation.order = 'YXZ'; m.rotation.x = -Math.PI / 2; m.renderOrder = 2; m.frustumCulled = false;
  m.userData.set = (p = {}) => { Object.assign(P, p); m.position.set(P.x, P.y, P.z); m.scale.set(P.radius * 2 * P.aspect, P.radius * 2, 1); m.rotation.y = P.rot; mat.uniforms.uCol.value.set(P.color); mat.uniforms.uI.value = P.intensity; mat.uniforms.uEdge.value = P.edge; mat.uniforms.uRing.value = P.ring; mat.uniforms.uBreak.value = P.breakup; return m; };
  m.userData.set(); if (P.add) stage.group.add(m); return m;
}

// ------------------------------------------------------------------------------------------------ planar-ish reflections
const REFL_VS = /* glsl */`
varying vec3 vW; varying vec3 vN; varying vec2 vUv; varying vec3 vC;
void main(){
  vec3 tp = position;
  #ifdef USE_INSTANCING
    mat4 im = instanceMatrix; vec4 wp = modelMatrix * im * vec4(tp, 1.0); vec3 nw = mat3(modelMatrix) * mat3(im) * normal;
  #else
    vec4 wp = modelMatrix * vec4(tp, 1.0); vec3 nw = mat3(modelMatrix) * normal;
  #endif
  vW = wp.xyz; vN = nw; vUv = uv;
  #ifdef USE_COLOR
    vC = color;
  #else
    vC = vec3(1.0);
  #endif
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const REFL_FS = /* glsl */`
precision highp float;
varying vec3 vW; varying vec3 vN; varying vec2 vUv; varying vec3 vC;
uniform vec3 uColor, uEmis, uKeyDir, uKeyCol; uniform float uAmb, uFade, uStrength, uAlpha, uUnlit; uniform sampler2D uMap;
void main(){
  vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
  vec3 no = vec3(n.x, -n.y, n.z);
  float lam = max(dot(no, uKeyDir), 0.0);
  vec3 base = uColor * vC;
  #ifdef USE_MAP
    base *= texture2D(uMap, vUv).rgb;
  #endif
  float lit = mix(uAmb + (1.0 - uAmb) * lam * 1.4, 1.0, uUnlit);
  vec3 col = base * lit * mix(uKeyCol, vec3(1.0), uUnlit) + uEmis;
  float h = max(-vW.y, 0.0);
  col *= exp(-h * uFade) * uStrength;
  gl_FragColor = vec4(col, 1.0);
}`;

/** Mirror clone of `obj` under the floor (y=0): shows through the glossy floor with fresnel + height fade. Cheap: shares geometry, 1 draw per mesh.
 *  o: { strength=1, fade=1.1, ambient=0.45, filter(mesh)->bool }  returns { group, setStrength(k), setFade(k), setVisible(b), dispose() }.
 *  Skips glow decals (transparent && !depthWrite) unless mesh.userData.reflect; skips mesh.userData.noReflect. */
export function reflect(stage, obj, o = {}) {
  const T = stage.THREE, st = stage.state, filter = o.filter || (() => true);
  const root = new T.Group(); root.name = 'reflection'; root.matrixAutoUpdate = false; root.matrixWorldAutoUpdate = false;
  const U = { uFade: { value: o.fade ?? 1.1 }, uStrength: { value: o.strength ?? 1 }, uAmb: { value: o.ambient ?? 0.45 }, uKeyDir: st.reflU.uKeyDir, uKeyCol: st.reflU.uKeyCol };
  const entries = [], mats = new Map(), MIR = new T.Matrix4().makeScale(1, -1, 1);
  obj.updateWorldMatrix(true, true);
  obj.traverse((src) => {
    if (!src.isMesh || src.isSkinnedMesh || src.userData.noReflect) return;
    const sm = src.material; if (!sm || Array.isArray(sm)) return;
    if (sm.transparent && sm.depthWrite === false && !src.userData.reflect) return;
    if (sm.isShaderMaterial && !sm.userData.reflectColor) return;
    if (!filter(src)) return;
    const hasVC = !!(src.geometry.attributes.color && sm.vertexColors), key = sm.uuid + (hasVC ? 'c' : ''), basic = !!sm.isMeshBasicMaterial;
    let rec = mats.get(key);
    if (!rec) {
      const mat = new T.ShaderMaterial({
        uniforms: { ...U, uColor: { value: new T.Color() }, uEmis: { value: new T.Color() }, uAlpha: { value: 1 }, uUnlit: { value: basic ? 1 : 0 }, uMap: { value: sm.map || null } },
        vertexShader: REFL_VS, fragmentShader: REFL_FS, vertexColors: hasVC, defines: sm.map ? { USE_MAP: '' } : {}, side: sm.side === T.DoubleSide ? T.DoubleSide : T.FrontSide, fog: false, toneMapped: false,
      });
      rec = { src: sm, mat, basic }; mats.set(key, rec);
    }
    const clone = src.isInstancedMesh ? new T.InstancedMesh(src.geometry, rec.mat, src.count) : new T.Mesh(src.geometry, rec.mat);
    if (src.isInstancedMesh) { clone.instanceMatrix = src.instanceMatrix; if (src.instanceColor) clone.instanceColor = src.instanceColor; clone.frustumCulled = false; }
    clone.matrixAutoUpdate = false; clone.matrixWorldAutoUpdate = false; clone.castShadow = false; clone.receiveShadow = false; clone.renderOrder = -3; clone.name = 'refl-' + src.name;
    root.add(clone); entries.push({ src, clone });
  });
  stage.group.add(root);
  const h = {
    group: root, entries, uniforms: U, enabled: true,
    syncAll() {
      if (!h.enabled || !obj.parent && !obj.isScene) { root.visible = false; return false; }
      obj.updateWorldMatrix(true, true); let any = false;
      for (const e of entries) {
        let vis = true; for (let p = e.src; p; p = p.parent) if (!p.visible) { vis = false; break; }
        e.clone.visible = vis; if (!vis) continue; any = true;
        e.clone.matrixWorld.multiplyMatrices(MIR, e.src.matrixWorld);
        if (e.src.isInstancedMesh) e.clone.count = e.src.count;
      }
      for (const r of mats.values()) {
        const s = r.src, u = r.mat.uniforms;
        if (r.basic) { u.uColor.value.copy(s.color); u.uEmis.value.set(0, 0, 0); } else { u.uColor.value.copy(s.color); if (s.emissive) u.uEmis.value.copy(s.emissive).multiplyScalar(s.emissiveIntensity ?? 1); else u.uEmis.value.set(0, 0, 0); }
        if (s.map) u.uMap.value = s.map;
      }
      root.visible = true; return any;
    },
    setStrength(k) { U.uStrength.value = k; return h; }, setFade(k) { U.uFade.value = k; return h; }, setVisible(b) { h.enabled = b; root.visible = b; return h; },
    dispose() { stage.group.remove(root); st.mirrors.splice(st.mirrors.indexOf(h), 1); mats.forEach((r) => r.mat.dispose()); },
  };
  st.mirrors.push(h);
  return h;
}
