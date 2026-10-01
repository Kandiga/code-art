// =============================================================================
// fx3d.js — the shared 3D FX kit for Act II (volumetric beams, haze, particles, ribbons, holograms, flares, film strips, grids, 3D text, panels).
// EVERYTHING here is a pure function of time: drive it from T.t inside your scene's update() (`fx.update(T.t)`); no Math.random / Date.now, no
// state between frames, no per-frame allocation (all motion is computed in shaders or in preallocated buffers). THREE is always passed in.
//
//  export                         returns                                   what / key options
//  ----------------------------------------------------------------------------------------------------------------------------------
//  createBeam(T,{from,to,color,angle,length,intensity,noise,...})   {object,mesh,foot,update(t),set(),setIntensity(),setColor(),pool,glow,uniforms}  (add beam.object to the scene)
//        VOLUMETRIC spotlight: analytic cone ray-march (additive, back-face raster + floor-footprint proxy), soft edges, axial falloff, animated
//        3D-noise haze (+ optional light-shaft streaks), clipped by the floor, contact pool + lens glow. COST: ~0.5-0.8 s per beam at 1080p x 4 sub-frames
//        in software GL (loaded box) — keep to <= 3 big beams per shot, use steps/gain/angle to trade. angle=half-angle rad (0.2), steps (5; adaptive, dithered per sub-frame), soft (0.42), falloff (1.1), streak (0 = off; 0.3 adds light-shaft striations, ~+30% cost), floorY (0)
//  createBeams(T,[opts...],shared) {group,beams,update(t),setIntensity(k)}      several beams in one go
//  createHaze(T,{count,bounds,seed,size,color,intensity,twinkle,drift,turbulence,ambient,boost})   {points,update(t),attachBeams(beams),uniforms}
//        dust motes (1 draw call, GPU) that drift/twinkle, wrap through `bounds` ({min:[x,y,z],max:[x,y,z]}) and LIGHT UP inside attached beams
//  createParticleField(T,{count,shape,bounds,radius,center,seed,size,colors,flow,speed,life,twinkle,intensity,morph,flowGLSL,positionFn})
//        {points,update(t,{morph,intensity,size}),setTargets(Float32Array),setColors(),uniforms}
//        flow: 'none'|'drift'|'rise'|'swirl'|'orbit'|'burst'|'stream'|'custom'(flowGLSL: `vec3 flowPos(vec4 s,float t){...}`)|'cpu'(positionFn(i,t,out))
//        morph: particles blend toward per-particle targets (setTargets) with uniform `morph` 0..1 (+ stagger) — audience/orchestra of light
//  createRibbons(T,{curves|bundle,count,segments,width,colors,speed,wave,seed,intensity})   {object,mesh,update(t),uniforms}
//        flowing light ribbons along curves (camera-facing strips, travelling pulses) — the neural scene
//  hologramMaterial(T,{color,color2,alpha,scan,fresnel,flicker,glitch,rim})   ShaderMaterial (mat.userData.update(t) / mat.uniforms.uTime)
//  glowSprite(T,{color,size,intensity})            additive radial glow Sprite          lensFlare(T,{color,size,intensity,streak,ghosts,...})  Group
//        lensFlare is self-driving: every element repositions itself in onBeforeRender from the light's world position and the render camera.
//  createGodrayCard(T,{width,height,color,intensity,mode:'radial'|'parallel',origin,rays,slant,billboard})   {mesh,update(t)}   fake light shafts
//  createFilmStrip(T,{curve|length,width,frames,atlas,atlasCols,atlasRows,tint,emissive,scroll})   {mesh,update(t),frames}   35 mm strip with perfs
//  createGrid(T,{size,cell,color,color2,glow,pulse,fade})  {mesh,update(t)}     holographic grid floor (AA lines, radial fade, travelling ring)
//  createHoloFloor(T,opts)   grid + soft base disc + concentric rings
//  createTextPlane(T,text,opts)  {mesh,setText(s),setReveal(k),setColor(c),setIntensity(k),width,height}   glowing canvas text in 3D (needs DOM canvas)
//  createPanelFrame(T,{w,h,depth,border,radius,color,edge,screen,glow,brackets})  {group,frame,screen,glowMesh,setScreen({map,color,intensity}),setGlow(k)}
//  helpers: noise3DTexture(T)  glowTexture(T)  pxScale(renderer,camera)  roundedRectShape(T,w,h,r)
// Beam / lens coordinates are WORLD units (meters). Colours are HDR: pass intensity > 1 to make things bloom. Additive, depthWrite=false, fog=false.
// =============================================================================
import { hash } from './rng.js';

const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const texCache = new WeakMap();
function cached(T, key, fn) { let m = texCache.get(T); if (!m) { m = new Map(); texCache.set(T, m); } if (!m.has(key)) m.set(key, fn()); return m.get(key); }
const toColor = (T, c, out) => { out = out || new T.Color(); if (c && c.isColor) return out.copy(c); if (Array.isArray(c)) return out.setRGB(c[0], c[1], c[2]); return out.set(c ?? '#ffffff'); };
const toVec = (T, v, out) => { out = out || new T.Vector3(); if (v && v.isVector3) return out.copy(v); if (Array.isArray(v)) return out.set(v[0], v[1], v[2]); return out.set(v.x, v.y, v.z); };

/** px per world unit at distance 1 for the current render target / camera (for gl_PointSize). */
export function pxScale(renderer, camera) {
  const rt = renderer.getRenderTarget(); let h = rt ? rt.height : 0;
  if (!h) { const s = renderer.getDrawingBufferSize(_sz); h = s.y || 1080; }
  return 0.5 * h * camera.projectionMatrix.elements[5];
}
const _sz = { x: 0, y: 0, set(a, b) { this.x = a; this.y = b; return this; }, floor() { this.x = Math.floor(this.x); this.y = Math.floor(this.y); return this; } };

// ------------------------------------------------------------------------------------------------ textures
function pnoise3(x, y, z, per, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz, m = (v) => ((v % per) + per) % per;
  const f = (t) => t * t * t * (t * (t * 6 - 15) + 10), u = f(fx), v = f(fy), w = f(fz), h = (a, b, c) => hash(m(ix + a), m(iy + b), m(iz + c), seed);
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(h(0, 0, 0), h(1, 0, 0), u), l(h(0, 1, 0), h(1, 1, 0), u), v), l(l(h(0, 0, 1), h(1, 0, 1), u), l(h(0, 1, 1), h(1, 1, 1), u), v), w);
}
/** 32³ tileable RGB 3D value noise (R low, G mid, B high-frequency) — the haze density source for beams. */
export function noise3DTexture(T, N = 32) {
  return cached(T, 'noise3d' + N, () => {
    const d = new Uint8Array(N * N * N * 4);
    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const o = ((z * N + y) * N + x) * 4, u = x / N, v = y / N, w = z / N;
      d[o] = (0.65 * pnoise3(u * 4, v * 4, w * 4, 4, 11) + 0.35 * pnoise3(u * 8, v * 8, w * 8, 8, 12)) * 255;
      d[o + 1] = (0.6 * pnoise3(u * 8, v * 8, w * 8, 8, 21) + 0.4 * pnoise3(u * 16, v * 16, w * 16, 16, 22)) * 255;
      d[o + 2] = (0.55 * pnoise3(u * 6, v * 6, w * 6, 6, 31) + 0.45 * pnoise3(u * 12, v * 12, w * 12, 12, 32)) * 255; d[o + 3] = 255;
    }
    const t = new T.Data3DTexture(d, N, N, N); t.format = T.RGBAFormat; t.type = T.UnsignedByteType; t.minFilter = t.magFilter = T.LinearFilter;
    t.wrapS = t.wrapT = t.wrapR = T.RepeatWrapping; t.unpackAlignment = 1; t.needsUpdate = true; return t;
  });
}
function alphaTex(T, N, fn, w = N, h = N) {
  const d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const a = clamp(fn(((x + 0.5) / w) * 2 - 1, ((y + 0.5) / h) * 2 - 1)), o = (y * w + x) * 4; d[o] = d[o + 1] = d[o + 2] = 255; d[o + 3] = a * 255; }
  const t = new T.DataTexture(d, w, h, T.RGBAFormat, T.UnsignedByteType); t.minFilter = t.magFilter = T.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true; return t;
}
/** soft radial glow (alpha) */
export function glowTexture(T) { return cached(T, 'glow', () => alphaTex(T, 128, (x, y) => { const r = Math.hypot(x, y); return r >= 1 ? 0 : Math.pow(1 - r, 2.2) * 0.85 + Math.exp(-r * r * 22) * 0.6; })); }
const ringTexture = (T) => cached(T, 'ring', () => alphaTex(T, 128, (x, y) => { const r = Math.hypot(x, y); return Math.exp(-Math.pow((r - 0.8) / 0.05, 2)) * 0.9 + Math.exp(-Math.pow((r - 0.8) / 0.18, 2)) * 0.18; }));
const discTexture = (T) => cached(T, 'disc', () => alphaTex(T, 128, (x, y) => { const r = Math.hypot(x, y); return r >= 1 ? 0 : (0.25 + 0.75 * Math.pow(r, 3)) * smooth01((1 - r) / 0.12); }));
const streakTexture = (T) => cached(T, 'streak', () => alphaTex(T, 256, (x, y) => Math.exp(-Math.abs(x) * 3.2) * Math.exp(-y * y * 900) * 1.0 + Math.exp(-Math.abs(x) * 6) * Math.exp(-y * y * 120) * 0.35, 256, 64));
const smooth01 = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };

// ================================================================================================ BEAM
const BEAM_VS = /* glsl */`
uniform float uFloorY; varying vec3 vWorld;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const BEAM_FS = /* glsl */`
precision highp float; precision highp sampler3D;
varying vec3 vWorld;
uniform vec3 uApex, uAxis, uBu, uBv, uColor;
uniform float uInt, uCos2, uTanA, uLen, uTime, uNoiseAmt, uFalloff, uSoft, uStartFade, uEndFade, uFloorY, uStreak, uSeed, uGain, uScale;
uniform sampler3D uNoise;
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main(){
  vec3 O = cameraPosition; vec3 D = normalize(vWorld - O);
  vec3 w = O - uApex;
  float aD = dot(uAxis, D), aW = dot(uAxis, w);
  float c2 = aD * aD - uCos2, c1 = aD * aW - uCos2 * dot(D, w), c0 = aW * aW - uCos2 * dot(w, w);
  float tlo = 0.1, thi = 1e4;
  if (abs(aD) > 1e-5) { float a = -aW / aD, b = (uLen - aW) / aD; tlo = max(tlo, min(a, b)); thi = min(thi, max(a, b)); }
  else if (aW < 0.0 || aW > uLen) discard;
  float disc = c1 * c1 - c2 * c0;
  if (abs(c2) > 1e-6) {
    if (disc < 0.0) { if (c2 < 0.0) discard; }
    else {
      float sq = sqrt(disc), r1 = (-c1 - sq) / c2, r2 = (-c1 + sq) / c2, lo = min(r1, r2), hi = max(r1, r2);
      if (c2 < 0.0) { tlo = max(tlo, lo); thi = min(thi, hi); }
      else if (aD > 0.0) tlo = max(tlo, hi); else thi = min(thi, lo);
    }
  }
  float tF = D.y < -1e-5 ? (uFloorY - O.y) / D.y : 1e9;
  #ifdef FOOT
  if (tF > thi + 0.012) discard;   // footprint proxy: only rays that reach the floor INSIDE the beam (the cone back-faces cover the rest)
  #endif
  thi = min(thi, tF);
  if (thi <= tlo) discard;
  float span = thi - tlo; int ns = int(clamp(span * 2.2, 3.0, float(STEPS)));
  float dt = span / float(ns), j = ign(gl_FragCoord.xy + uSeed * 17.0 + vec2(fract(uTime * 61.803) * 53.0, fract(uTime * 37.17) * 71.0)); // dither decorrelates across the 4 sub-frames (they differ in t)
  float acc = 0.0;
  for (int i = 0; i < STEPS; i++) {
    if (i >= ns) break;
    float t = tlo + (float(i) + j) * dt; vec3 P = O + D * t; vec3 v = P - uApex; float s = dot(v, uAxis);
    vec3 pr = v - uAxis * s; float rr = length(pr), R = max(s * uTanA, 1e-3), q = rr / R;
    float rad = 1.0 - smoothstep(1.0 - uSoft, 1.0, q);
    float core = mix(0.5, 1.0, 1.0 - q);
    float ax = exp(-s * uFalloff / uLen) * smoothstep(0.0, uStartFade, s) * (1.0 - uEndFade * smoothstep(0.8 * uLen, uLen, s));
    float d = rad * core * ax;
    if (uNoiseAmt > 0.0 && d > 0.0005) {
      vec3 nz = texture(uNoise, P * 0.23 * uScale + vec3(uTime * 0.02, -uTime * 0.045, uTime * 0.03)).rgb;
      float n = nz.r * 0.55 + nz.g * 0.45;
      float sk = 1.0;
      if (uStreak > 0.0) { float ang = atan(dot(pr, uBv) + 1e-6, dot(pr, uBu) + 1e-6); sk = mix(1.0, 0.3 + 1.4 * texture(uNoise, vec3(ang * 0.9549, s * 0.06, uTime * 0.02)).b, uStreak); }
      d *= mix(1.0, 0.18 + 1.7 * n, uNoiseAmt) * sk;
    }
    acc += d * smoothstep(0.4, 3.2, t);
  }
  acc *= dt;
  gl_FragColor = vec4(uColor * uInt * acc * uGain, 1.0);
}`;
const POOL_FS = /* glsl */`precision highp float; varying vec2 vUv; uniform vec3 uCol; uniform float uI, uEdge;
void main(){ vec2 p = (vUv - 0.5) * 2.0; float r = length(p); float a = smoothstep(1.0, 1.0 - uEdge, r); a *= a; gl_FragColor = vec4(uCol * uI * a, 1.0); }`;
const FLAT_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';

function coneGeometry(T, seg = 40) { // apex at the origin, axis +Z, unit length, base radius 1 at z=1 (outward CCW)
  const P = [0, 0, 0, 0, 0, 1], I = [];
  for (let i = 0; i < seg; i++) { const a = (i / seg) * TAU; P.push(Math.cos(a), Math.sin(a), 1); }
  for (let i = 0; i < seg; i++) { const a = 2 + i, b = 2 + ((i + 1) % seg); I.push(0, b, a); I.push(1, a, b); }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(P, 3)); g.setIndex(I); g.boundingSphere = new T.Sphere(new T.Vector3(0, 0, 0.5), 1.5); return g;
}

/** Volumetric spotlight cone. Returns { object (Group: add THIS), mesh, material, uniforms, update(t), set(p), setIntensity(k), setColor(c), pool, glow }.
 *  o: { from, to, color, angle=0.2, length, intensity=1, noise=1, steps=5, soft=0.42, falloff=1.1, streak=0, startFade=0.35, endFade=0, floorY=0,
 *       gain=0.55, scale=1 (noise feature scale), seed=0, pool=true, glow=true, poolIntensity=0.5, glowSize=0.9 }
 *  The cone is a function of its mesh transform (apex+axis are read at render time) so you may also move/rotate beam.object directly. */
export function createBeam(T, o = {}) {
  const P = { angle: 0.2, intensity: 1, noise: 1, steps: 5, soft: 0.42, falloff: 1.1, streak: 0, startFade: 0.35, endFade: 0, floorY: 0, gain: 0.2, scale: 1, seed: 0, pool: true, glow: true, poolIntensity: 0.22, glowSize: 0.55, ...o };
  const from = toVec(T, o.from ?? [0, 7, 0]), to = toVec(T, o.to ?? [0, 0, 0]), color = toColor(T, o.color ?? '#ffe2b0');
  const dir = to.clone().sub(from), dist = dir.length(); dir.divideScalar(Math.max(dist, 1e-6));
  P.length = o.length ?? dist * 1.12;
  const U = {
    uApex: { value: from.clone() }, uAxis: { value: dir.clone() }, uBu: { value: new T.Vector3(1, 0, 0) }, uBv: { value: new T.Vector3(0, 1, 0) }, uColor: { value: color.clone() },
    uInt: { value: P.intensity }, uCos2: { value: Math.cos(P.angle) ** 2 }, uTanA: { value: Math.tan(P.angle) }, uLen: { value: P.length }, uTime: { value: 0 }, uNoiseAmt: { value: P.noise },
    uFalloff: { value: P.falloff }, uSoft: { value: P.soft }, uStartFade: { value: P.startFade }, uEndFade: { value: P.endFade }, uFloorY: { value: P.floorY }, uStreak: { value: P.streak }, uSeed: { value: P.seed }, uGain: { value: P.gain }, uScale: { value: P.scale }, uNoise: { value: noise3DTexture(T) },
  };
  const mat = new T.ShaderMaterial({ uniforms: U, vertexShader: BEAM_VS, fragmentShader: BEAM_FS, defines: { STEPS: P.steps | 0 }, transparent: true, depthWrite: false, depthTest: true, blending: T.AdditiveBlending, side: T.BackSide, fog: false, toneMapped: false });
  const mesh = new T.Mesh(coneGeometry(T), mat); mesh.name = 'beam'; mesh.frustumCulled = false; mesh.renderOrder = 5; mesh.matrixAutoUpdate = true;
  const object = new T.Group(); object.name = 'beam-object'; object.add(mesh);
  const _a = new T.Vector3(), _b = new T.Vector3(), Z = new T.Vector3(0, 0, 1);
  const syncU = () => { // world apex + axis from the mesh transform (supports transformed parents / direct animation)
    const m = mesh.matrixWorld; _a.setFromMatrixPosition(m); U.uApex.value.copy(_a); _b.set(m.elements[8], m.elements[9], m.elements[10]).normalize(); U.uAxis.value.copy(_b);
    const h = Math.abs(_b.y) < 0.9 ? _a.set(0, 1, 0) : _a.set(1, 0, 0); U.uBu.value.crossVectors(_b, h).normalize(); U.uBv.value.crossVectors(_b, U.uBu.value);
  };
  mesh.onBeforeRender = syncU;
  // floor footprint proxy: the cone's back faces dip below the floor (depth-rejected), so rays that hit the floor INSIDE the beam are rasterised by this flat quad
  // (same analytic shader). The two sets of pixels are disjoint, so nothing is counted twice.
  const fmat = new T.ShaderMaterial({ uniforms: U, vertexShader: BEAM_VS, fragmentShader: BEAM_FS, defines: { STEPS: P.steps | 0, FOOT: 1 }, transparent: true, depthWrite: false, depthTest: true, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false, toneMapped: false });
  const foot = new T.Mesh(new T.PlaneGeometry(1, 1), fmat); foot.rotation.order = 'YXZ'; foot.rotation.x = -Math.PI / 2; foot.renderOrder = 5; foot.frustumCulled = false; foot.name = 'beam-footprint'; foot.onBeforeRender = syncU; object.add(foot);
  let pool = null, glow = null;
  if (P.pool) {
    const pm = new T.ShaderMaterial({ uniforms: { uCol: { value: color.clone() }, uI: { value: P.poolIntensity * P.intensity }, uEdge: { value: 0.7 } }, vertexShader: FLAT_VS, fragmentShader: POOL_FS, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    pool = new T.Mesh(new T.PlaneGeometry(1, 1), pm); pool.rotation.order = 'YXZ'; pool.rotation.x = -Math.PI / 2; pool.renderOrder = 4; pool.frustumCulled = false; pool.name = 'beam-pool'; object.add(pool);
  }
  if (P.glow) {
    glow = new T.Sprite(new T.SpriteMaterial({ map: glowTexture(T), color: color.clone().multiplyScalar(P.intensity * 0.9), blending: T.AdditiveBlending, depthWrite: false, depthTest: true, transparent: true, toneMapped: false, fog: false })); glow.scale.setScalar(P.glowSize); glow.renderOrder = 6; glow.name = 'beam-glow'; object.add(glow);
  }
  const api = { object, mesh, foot, material: mat, uniforms: U, pool, glow, params: P, color, from, to };
  api.set = (p = {}) => {
    if (p.from) toVec(T, p.from, api.from); if (p.to) toVec(T, p.to, api.to);
    if (p.angle != null) P.angle = p.angle; if (p.intensity != null) P.intensity = p.intensity;
    const d = api.to.clone().sub(api.from), L = d.length(); d.divideScalar(Math.max(L, 1e-6));
    P.length = p.length ?? (p.from || p.to ? L * 1.12 : P.length);
    mesh.position.copy(api.from); mesh.quaternion.setFromUnitVectors(Z, d); const R = P.length * Math.tan(P.angle) * 1.06; mesh.scale.set(R, R, P.length); mesh.updateMatrix();
    U.uCos2.value = Math.cos(P.angle) ** 2; U.uTanA.value = Math.tan(P.angle); U.uLen.value = P.length;
    U.uApex.value.copy(api.from); U.uAxis.value.copy(d);
    { const ok = d.y < -0.02; foot.visible = ok; if (ok) { const t = (api.from.y - P.floorY) / -d.y, hx = api.from.x + d.x * t, hz = api.from.z + d.z * t, rr = t * Math.tan(P.angle), st = 1 / Math.max(0.3, -d.y); foot.position.set(hx, P.floorY + 0.003, hz); foot.rotation.y = Math.atan2(d.x, d.z); foot.scale.set(rr * 2 * 1.5 + 0.2, rr * 2 * st * 1.5 + 0.2, 1); } }
    if (p.color != null) { toColor(T, p.color, color); U.uColor.value.copy(color); }
    U.uInt.value = P.intensity;
    if (pool) { // floor footprint: ellipse stretched along the projected axis
      const ok = d.y < -0.02; pool.visible = ok;
      if (ok) { const t = (api.from.y - P.floorY) / -d.y, hx = api.from.x + d.x * t, hz = api.from.z + d.z * t, rr = t * Math.tan(P.angle), st = 1 / Math.max(0.3, -d.y); pool.position.set(hx, P.floorY + 0.006, hz); pool.rotation.y = Math.atan2(d.x, d.z); pool.scale.set(rr * 2 * 1.05, rr * 2 * st * 1.05, 1); }
      pool.material.uniforms.uCol.value.copy(color); pool.material.uniforms.uI.value = P.poolIntensity * P.intensity;
    }
    if (glow) { glow.position.copy(api.from); glow.material.color.copy(color).multiplyScalar(P.intensity * 0.9); }
    return api;
  };
  api.setIntensity = (k) => api.set({ intensity: k });
  api.setColor = (c) => api.set({ color: c });
  api.update = (t) => { U.uTime.value = t; return api; };
  api.set({ from, to, length: P.length });
  return api;
}
/** several beams at once. list: [opts...]; shared: opts merged into every beam. */
export function createBeams(T, list, shared = {}) {
  const group = new T.Group(); group.name = 'beams'; const beams = list.map((o, i) => { const b = createBeam(T, { seed: i, ...shared, ...o }); group.add(b.object); return b; });
  return { group, beams, update(t) { for (const b of beams) b.update(t); return this; }, setIntensity(k) { for (const b of beams) b.setIntensity(k); return this; } };
}

// ================================================================================================ HAZE (dust motes)
/** Dust motes that drift/twinkle and light up inside attached beams. bounds: {min:[x,y,z], max:[x,y,z]} (default a 16x8x14 box around the set). */
export function createHaze(T, o = {}) {
  const P = { count: 700, seed: 3, size: 0.02, intensity: 1, twinkle: 0.7, drift: [0.01, 0.025, 0.006], turbulence: 0.25, ambient: 0.05, boost: 2.2, color: '#9db4e8', maxBeams: 6, ...o };
  const b = o.bounds || { min: [-8, 0.2, -8], max: [8, 7, 6] }, N = P.count, seeds = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) for (let k = 0; k < 4; k++) seeds[i * 4 + k] = hash(i, k, P.seed);
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(new Float32Array(N * 3), 3)); g.setAttribute('aSeed', new T.BufferAttribute(seeds, 4));
  const NB = P.maxBeams, U = {
    uMin: { value: toVec(T, b.min) }, uMax: { value: toVec(T, b.max) }, uDrift: { value: toVec(T, P.drift) }, uTime: { value: 0 }, uSize: { value: P.size }, uPx: { value: 1000 }, uTwinkle: { value: P.twinkle }, uTurb: { value: P.turbulence },
    uAmb: { value: P.ambient }, uBoost: { value: P.boost }, uInt: { value: P.intensity }, uColor: { value: toColor(T, P.color) },
    uBA: { value: Array.from({ length: NB }, () => new T.Vector3()) }, uBX: { value: Array.from({ length: NB }, () => new T.Vector3(0, 1, 0)) }, uBC: { value: Array.from({ length: NB }, () => new T.Vector3()) }, uBT: { value: Array.from({ length: NB }, () => new T.Vector2(1, 0)) },
  };
  const mat = new T.ShaderMaterial({
    uniforms: U, defines: { NB }, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false, toneMapped: false,
    vertexShader: `attribute vec4 aSeed; uniform vec3 uMin, uMax, uDrift, uColor; uniform float uTime, uSize, uPx, uTwinkle, uTurb, uAmb, uBoost, uInt;
      uniform vec3 uBA[NB], uBX[NB], uBC[NB]; uniform vec2 uBT[NB]; varying vec3 vC;
      void main(){
        vec3 ext = uMax - uMin; vec3 p = uMin + aSeed.xyz * ext + uDrift * uTime;
        p += uTurb * vec3(sin(uTime * 0.33 * (0.5 + aSeed.w) + aSeed.x * 37.0), sin(uTime * 0.27 * (0.5 + aSeed.z) + aSeed.y * 29.0), cos(uTime * 0.31 * (0.5 + aSeed.x) + aSeed.z * 41.0));
        vec3 q = fract((p - uMin) / ext); p = uMin + q * ext;
        float edge = smoothstep(0.0, 0.08, q.x) * smoothstep(1.0, 0.92, q.x) * smoothstep(0.0, 0.08, q.y) * smoothstep(1.0, 0.92, q.y) * smoothstep(0.0, 0.08, q.z) * smoothstep(1.0, 0.92, q.z);
        float tw = 0.5 + 0.5 * sin(uTime * (0.8 + 3.0 * aSeed.w) + aSeed.x * 91.0); tw = mix(1.0, tw * tw, uTwinkle);
        vec3 lit = vec3(0.0);
        for (int k = 0; k < NB; k++) { vec3 v = p - uBA[k]; float s = dot(v, uBX[k]); if (s > 0.0 && s < uBT[k].y) { float rr = length(v - uBX[k] * s); float m = 1.0 - smoothstep(0.55, 1.0, rr / max(s * uBT[k].x, 1e-3)); lit += uBC[k] * m * exp(-s * 0.08); } }
        vC = (uColor * uAmb + lit * uBoost) * uInt * tw * edge;
        vec4 mv = viewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uSize * uPx / max(-mv.z, 0.1) * (0.55 + 0.9 * aSeed.w), 1.2, 26.0); }`,
    fragmentShader: 'varying vec3 vC; void main(){ vec2 c = gl_PointCoord * 2.0 - 1.0; float r2 = dot(c, c); if (r2 > 1.0) discard; gl_FragColor = vec4(vC * exp(-r2 * 4.5), 1.0); }',
  });
  const points = new T.Points(g, mat); points.frustumCulled = false; points.name = 'haze'; points.renderOrder = 7;
  points.onBeforeRender = (r, sc, cam) => { U.uPx.value = pxScale(r, cam); };
  let attached = [];
  const api = {
    points, object: points, uniforms: U, material: mat,
    attachBeams(beams) { attached = (beams.beams || beams).slice(0, NB); return api; },
    update(t) {
      U.uTime.value = t;
      for (let k = 0; k < NB; k++) {
        const bm = attached[k];
        if (!bm) { U.uBT.value[k].set(1, 0); U.uBC.value[k].set(0, 0, 0); continue; }
        bm.mesh.updateWorldMatrix(true, false); const m = bm.mesh.matrixWorld.elements; U.uBA.value[k].set(m[12], m[13], m[14]); U.uBX.value[k].set(m[8], m[9], m[10]).normalize();
        U.uBT.value[k].set(bm.uniforms.uTanA.value, bm.uniforms.uLen.value); const c = bm.uniforms.uColor.value, i = bm.uniforms.uInt.value; U.uBC.value[k].set(c.r * i, c.g * i, c.b * i);
      }
      return api;
    },
  };
  return api;
}

// ================================================================================================ PARTICLE FIELD
const PF_MODES = { none: 0, drift: 1, rise: 2, swirl: 3, orbit: 4, burst: 5, stream: 6, custom: 7, cpu: 8 };
/** Light particles with soft sprites. See the header table. o: { count, shape:'box'|'sphere'|'disc', bounds, radius, center, seed, size, colors:['#hex'...], flow, speed, life, twinkle, intensity, stagger, morph:true, flowGLSL, positionFn } */
export function createParticleField(T, o = {}) {
  const P = { count: 2000, shape: 'box', radius: 3, center: [0, 1.5, 0], seed: 5, size: 0.04, flow: 'drift', speed: 1, life: 6, twinkle: 0.6, intensity: 1, stagger: 0.6, colors: ['#ffd9a0', '#9fd4ff', '#ffffff'], bounds: { min: [-4, 0, -4], max: [4, 4, 4] }, drift: [0.02, 0.05, 0.0], ...o };
  const N = P.count, seeds = new Float32Array(N * 4), cols = new Float32Array(N * 3), tgt = new Float32Array(N * 3), pos = new Float32Array(N * 3), cs = P.colors.map((c) => toColor(T, c));
  for (let i = 0; i < N; i++) { for (let k = 0; k < 4; k++) seeds[i * 4 + k] = hash(i, k, P.seed); const c = cs[Math.floor(hash(i, 9, P.seed) * cs.length) % cs.length], v = 0.6 + 0.8 * hash(i, 11, P.seed); cols[i * 3] = c.r * v; cols[i * 3 + 1] = c.g * v; cols[i * 3 + 2] = c.b * v; }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new T.BufferAttribute(seeds, 4)); g.setAttribute('aCol', new T.BufferAttribute(cols, 3));
  if (P.morph) g.setAttribute('aTarget', new T.BufferAttribute(tgt, 3));
  const mode = PF_MODES[P.flow] ?? 1, shapeId = { box: 0, sphere: 1, disc: 2 }[P.shape] ?? 0;
  const U = {
    uTime: { value: 0 }, uSize: { value: P.size }, uPx: { value: 1000 }, uTwinkle: { value: P.twinkle }, uSpeed: { value: P.speed }, uLife: { value: P.life }, uInt: { value: P.intensity }, uMorph: { value: 0 }, uStagger: { value: P.stagger },
    uMin: { value: toVec(T, P.bounds.min) }, uMax: { value: toVec(T, P.bounds.max) }, uCenter: { value: toVec(T, P.center) }, uRadius: { value: P.radius }, uDrift: { value: toVec(T, P.drift) },
  };
  const custom = P.flowGLSL || 'vec3 flowPos(vec4 s, float t){ return vec3(0.0); }';
  const mat = new T.ShaderMaterial({
    uniforms: U, defines: { MODE: mode, SHAPE: shapeId, ...(P.morph ? { MORPH: 1 } : {}) }, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false, toneMapped: false,
    vertexShader: `attribute vec4 aSeed; attribute vec3 aCol;
      #ifdef MORPH
      attribute vec3 aTarget;
      #endif
      uniform float uTime, uSize, uPx, uTwinkle, uSpeed, uLife, uInt, uMorph, uStagger, uRadius; uniform vec3 uMin, uMax, uCenter, uDrift; varying vec3 vC;
      ${custom}
      vec3 basePos(vec4 s){
        #if SHAPE == 1
          vec3 d = normalize(vec3(s.x, s.y, s.z) * 2.0 - 1.0 + 1e-4); return uCenter + d * uRadius * pow(fract(s.w * 7.13 + s.x), 0.4);
        #elif SHAPE == 2
          float a = s.x * 6.2831853, r = uRadius * sqrt(s.y); return uCenter + vec3(cos(a) * r, (s.z - 0.5) * (uMax.y - uMin.y), sin(a) * r);
        #else
          return uMin + s.xyz * (uMax - uMin);
        #endif
      }
      void main(){
        vec4 s = aSeed; vec3 p = basePos(s); float life = 1.0; vec3 ext = uMax - uMin;
        #if MODE == 1
          vec3 q = fract((p - uMin + uDrift * uTime * uSpeed) / ext); p = uMin + q * ext;
          float e = smoothstep(0.0, 0.06, q.y) * smoothstep(1.0, 0.94, q.y); life = e;
        #elif MODE == 2
          float a = fract(uTime * uSpeed / uLife + s.w); p.y = mix(uMin.y, uMax.y, a); p.xz += 0.25 * vec2(sin(uTime * 0.7 + s.x * 40.0), cos(uTime * 0.6 + s.z * 30.0)) * (0.3 + a); life = sin(3.14159 * a);
        #elif MODE == 3
          vec3 d = basePos(s) - uCenter; float r0 = max(length(d.xz), 0.05); float ang = atan(d.z, d.x) + uTime * uSpeed * (0.35 + 0.65 * s.w) / (0.35 + r0 * 0.4);
          float a = fract(s.z + uTime * 0.04 * uSpeed); p = uCenter + vec3(cos(ang) * r0, (a - 0.5) * ext.y + 0.15 * sin(uTime + s.x * 20.0), sin(ang) * r0); life = sin(3.14159 * a);
        #elif MODE == 4
          vec3 d = basePos(s) - uCenter; float r0 = max(length(d.xz), 0.2); float ang = s.x * 6.2831853 + uTime * uSpeed / (0.4 + r0 * 0.5); p = uCenter + vec3(cos(ang) * r0, d.y * 0.35 + 0.1 * sin(uTime * 1.3 + s.w * 30.0), sin(ang) * r0);
        #elif MODE == 5
          float a = fract(uTime * uSpeed / uLife + s.w); vec3 d = normalize(s.xyz * 2.0 - 1.0 + 1e-4); p = uCenter + d * uRadius * (1.0 - pow(1.0 - a, 3.0)); life = (1.0 - a) * smoothstep(0.0, 0.05, a);
        #elif MODE == 6
          float x = fract(s.x + uTime * 0.05 * uSpeed * (0.5 + s.w)); p.x = mix(uMin.x, uMax.x, x); p.yz += 0.2 * vec2(sin(uTime * 0.8 + s.y * 50.0 + x * 9.0), cos(uTime * 0.7 + s.z * 40.0 + x * 7.0)); life = smoothstep(0.0, 0.1, x) * smoothstep(1.0, 0.9, x);
        #elif MODE == 7
          p = flowPos(s, uTime);
        #elif MODE == 8
          p = position;
        #endif
        #ifdef MORPH
          float m = smoothstep(0.0, 1.0, clamp(uMorph * (1.0 + uStagger) - s.w * uStagger, 0.0, 1.0));
          vec3 tp = aTarget + 0.012 * vec3(sin(uTime * 1.7 + s.x * 60.0), sin(uTime * 1.3 + s.y * 50.0), sin(uTime * 1.5 + s.z * 70.0));
          p = mix(p, tp, m); life = mix(life, 1.0, m);
        #endif
        float tw = 0.5 + 0.5 * sin(uTime * (0.9 + 2.6 * s.w) + s.x * 91.0); tw = mix(1.0, tw * tw, uTwinkle);
        vC = aCol * uInt * tw * life;
        vec4 mv = viewMatrix * modelMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uSize * uPx / max(-mv.z, 0.1) * (0.6 + 0.8 * s.w), 1.2, 60.0); }`,
    fragmentShader: 'varying vec3 vC; void main(){ vec2 c = gl_PointCoord * 2.0 - 1.0; float r2 = dot(c, c); if (r2 > 1.0) discard; gl_FragColor = vec4(vC * (exp(-r2 * 5.0) + 0.5 * exp(-r2 * 30.0)), 1.0); }',
  });
  const points = new T.Points(g, mat); points.frustumCulled = false; points.name = 'particles'; points.renderOrder = 7;
  points.onBeforeRender = (r, sc, cam) => { U.uPx.value = pxScale(r, cam); };
  const out = [0, 0, 0];
  const api = {
    points, object: points, uniforms: U, material: mat, geometry: g, count: N,
    update(t, p = {}) {
      U.uTime.value = t; if (p.morph != null) U.uMorph.value = p.morph; if (p.intensity != null) U.uInt.value = p.intensity; if (p.size != null) U.uSize.value = p.size;
      if (mode === 8 && P.positionFn) { for (let i = 0; i < N; i++) { P.positionFn(i, t, out); pos[i * 3] = out[0]; pos[i * 3 + 1] = out[1]; pos[i * 3 + 2] = out[2]; } g.attributes.position.needsUpdate = true; }
      return api;
    },
    /** Float32Array (3*count) of morph targets in the points' local space */
    setTargets(arr) { if (!g.attributes.aTarget) throw new Error('createParticleField: pass {morph:true}'); g.attributes.aTarget.array.set(arr.subarray ? arr.subarray(0, N * 3) : arr.slice(0, N * 3)); g.attributes.aTarget.needsUpdate = true; return api; },
    setColors(fn) { for (let i = 0; i < N; i++) { const c = fn(i, out); cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b; } g.attributes.aCol.needsUpdate = true; return api; },
  };
  return api;
}

// ================================================================================================ RIBBONS
/** Flowing light ribbons. o: { curves:[THREE.Curve | [[x,y,z]...]] | bundle:{curve, count, spread, twist}, segments=64, width=0.04, colors, speed=0.35, wave=0.08, seed, intensity=1, taper=0.7, pulse=1 } */
export function createRibbons(T, o = {}) {
  const P = { segments: 64, width: 0.04, speed: 0.35, wave: 0.08, seed: 9, intensity: 1, taper: 0.7, pulse: 1, colors: ['#6b5bff', '#7cc4ff', '#1fb5a6'], ...o };
  const curves = [];
  const asCurve = (c) => (c.getPoint ? c : new T.CatmullRomCurve3(c.map((p) => toVec(T, p)), false, 'catmullrom', 0.5));
  if (o.bundle) {
    const bn = o.bundle, base = asCurve(bn.curve), n = bn.count ?? 24, sp = bn.spread ?? 0.4, tw = bn.twist ?? 1, S = 24;
    for (let r = 0; r < n; r++) {
      const pts = [], ph = hash(r, 1, P.seed) * TAU, rad = sp * (0.2 + 0.8 * Math.sqrt(hash(r, 2, P.seed)));
      for (let j = 0; j <= S; j++) { const u = j / S, c = base.getPoint(u), tg = base.getTangent(u), a = new T.Vector3(0, 1, 0).cross(tg).normalize(), b = tg.clone().cross(a), env = Math.sin(Math.PI * u) ** 0.6 * (0.35 + 0.65 * u), ang = ph + u * tw * 3 + 1.3 * Math.sin(u * 5 + r); pts.push(c.clone().addScaledVector(a, Math.cos(ang) * rad * env).addScaledVector(b, Math.sin(ang) * rad * env)); }
      curves.push(new T.CatmullRomCurve3(pts, false, 'catmullrom', 0.5));
    }
  } else for (const c of o.curves || []) curves.push(asCurve(c));
  const R = curves.length, S = P.segments, nv = R * (S + 1) * 2, pos = new Float32Array(nv * 3), tan = new Float32Array(nv * 3), aU = new Float32Array(nv), aSide = new Float32Array(nv), aR = new Float32Array(nv * 2), aCol = new Float32Array(nv * 3), idx = [];
  const cs = P.colors.map((c) => toColor(T, c)), v = new T.Vector3(), tg = new T.Vector3();
  curves.forEach((c, r) => {
    const col = cs[Math.floor(hash(r, 4, P.seed) * cs.length) % cs.length], wj = 0.6 + 0.8 * hash(r, 5, P.seed);
    for (let j = 0; j <= S; j++) {
      const u = j / S; c.getPoint(u, v); c.getTangent(u, tg);
      for (let s = 0; s < 2; s++) { const i = (r * (S + 1) + j) * 2 + s; pos.set([v.x, v.y, v.z], i * 3); tan.set([tg.x, tg.y, tg.z], i * 3); aU[i] = u; aSide[i] = s ? 1 : -1; aR[i * 2] = hash(r, 6, P.seed); aR[i * 2 + 1] = wj; aCol.set([col.r, col.g, col.b], i * 3); }
      if (j < S) { const a = (r * (S + 1) + j) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
  });
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('aTan', new T.BufferAttribute(tan, 3)); g.setAttribute('aU', new T.BufferAttribute(aU, 1)); g.setAttribute('aSide', new T.BufferAttribute(aSide, 1)); g.setAttribute('aR', new T.BufferAttribute(aR, 2)); g.setAttribute('aCol', new T.BufferAttribute(aCol, 3)); g.setIndex(idx);
  g.boundingSphere = new T.Sphere(new T.Vector3(), 1e3);
  const U = { uTime: { value: 0 }, uWidth: { value: P.width }, uSpeed: { value: P.speed }, uWave: { value: P.wave }, uInt: { value: P.intensity }, uTaper: { value: P.taper }, uPulse: { value: P.pulse } };
  const mat = new T.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false, toneMapped: false,
    vertexShader: `attribute vec3 aTan, aCol; attribute float aU, aSide; attribute vec2 aR; uniform float uTime, uWidth, uWave, uTaper; varying float vU, vSide, vSeed; varying vec3 vC;
      void main(){
        vec3 p = (modelMatrix * vec4(position, 1.0)).xyz; vec3 T = normalize(mat3(modelMatrix) * aTan); vec3 V = normalize(cameraPosition - p);
        vec3 sd = normalize(cross(T, V) + 1e-5); vec3 nm = cross(T, sd);
        float ph = aR.x * 6.2831 + aU * (6.0 + 5.0 * aR.x) - uTime * (0.8 + 0.6 * aR.y);
        p += (sd * sin(ph) + nm * cos(ph * 0.83)) * uWave * sin(3.14159 * aU) * (0.5 + aR.y * 0.5);
        float w = uWidth * aR.y * (1.0 - uTaper * pow(abs(aU * 2.0 - 1.0), 2.0)) * (0.8 + 0.2 * sin(aU * 20.0 + aR.x * 9.0 + uTime));
        p += sd * aSide * w; vU = aU; vSide = aSide; vSeed = aR.x; vC = aCol;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`,
    fragmentShader: `varying float vU, vSide, vSeed; varying vec3 vC; uniform float uTime, uSpeed, uInt, uPulse;
      void main(){
        float ph = fract(vU * 1.0 - uTime * uSpeed * (0.7 + 0.6 * vSeed) + vSeed * 3.1); float tail = exp(-ph * 5.0) * uPulse;
        float fade = smoothstep(0.0, 0.06, vU) * smoothstep(1.0, 0.9, vU);
        float core = exp(-vSide * vSide * 3.5), prof = 1.0 - smoothstep(0.0, 1.0, abs(vSide));
        gl_FragColor = vec4(vC * (0.1 + 1.6 * tail) * fade * uInt * 0.42 * (0.25 + 0.75 * core) * (0.4 + prof), 1.0); }`,
  });
  const mesh = new T.Mesh(g, mat); mesh.frustumCulled = false; mesh.renderOrder = 6; mesh.name = 'ribbons';
  return { object: mesh, mesh, uniforms: U, material: mat, count: R, update(t) { U.uTime.value = t; return this; } };
}

// ================================================================================================ HOLOGRAM
/** Hologram material (scanlines + fresnel rim + flicker + glitch). Use on any Mesh. o: { color, color2, alpha=1, scan=26, scanSpeed=1.2, fresnel=2.2, flicker=0.35, glitch=0.5, rim=1 } */
export function hologramMaterial(T, o = {}) {
  const P = { color: '#4fd8ff', color2: null, alpha: 1, scan: 26, scanSpeed: 1.2, fresnel: 2.2, flicker: 0.35, glitch: 0.5, rim: 1, ...o };
  const c1 = toColor(T, P.color), c2 = P.color2 ? toColor(T, P.color2) : c1.clone().lerp(new T.Color('#ffffff'), 0.55);
  const m = new T.ShaderMaterial({
    uniforms: { uColor: { value: c1 }, uColor2: { value: c2 }, uTime: { value: 0 }, uAlpha: { value: P.alpha }, uScanFreq: { value: P.scan }, uScanSpeed: { value: P.scanSpeed }, uFres: { value: P.fresnel }, uFlicker: { value: P.flicker }, uGlitch: { value: P.glitch }, uRim: { value: P.rim } },
    transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false, toneMapped: false,
    vertexShader: `uniform float uTime, uGlitch; varying vec3 vN, vW;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); float band = floor(w.y * 18.0 + floor(uTime * 10.0) * 3.0); float g = step(0.94, fract(sin(band * 91.7) * 437.5)); w.x += g * uGlitch * 0.06 * sin(band * 7.0);
        vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `varying vec3 vN, vW; uniform vec3 uColor, uColor2; uniform float uTime, uAlpha, uScanFreq, uScanSpeed, uFres, uFlicker, uRim;
      void main(){ vec3 V = normalize(cameraPosition - vW); vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N; float fres = pow(1.0 - abs(dot(N, V)), uFres);
        float scan = pow(0.5 + 0.5 * sin(vW.y * uScanFreq - uTime * uScanSpeed * 6.0), 3.0);
        float sweep = exp(-pow(fract(vW.y * 0.4 - uTime * 0.18) - 0.5, 2.0) * 90.0);
        float fl = 1.0 - uFlicker * step(0.93, fract(sin(floor(uTime * 30.0) * 12.9898) * 43758.5453)) - 0.05 * sin(uTime * 47.0);
        vec3 col = mix(uColor, uColor2, fres) * (0.1 + 0.95 * fres * uRim + 0.32 * scan + 0.5 * sweep);
        if (!gl_FrontFacing) col *= 0.4;
        gl_FragColor = vec4(col * uAlpha * fl, 1.0); }`,
  });
  m.userData.update = (t) => { m.uniforms.uTime.value = t; return m; }; m.userData.setTime = m.userData.update;
  return m;
}

// ================================================================================================ GLOW + LENS FLARE
/** Additive radial glow sprite. o: { color, size (m), intensity }. sprite.userData.set({color,size,intensity}) */
export function glowSprite(T, o = {}) {
  const P = { color: '#ffd9a0', size: 1, intensity: 1, ...o }, col = toColor(T, P.color);
  const s = new T.Sprite(new T.SpriteMaterial({ map: glowTexture(T), color: col.clone().multiplyScalar(P.intensity), blending: T.AdditiveBlending, depthWrite: false, depthTest: P.depthTest ?? true, transparent: true, toneMapped: false, fog: false }));
  s.scale.setScalar(P.size); s.renderOrder = 6; s.name = 'glow';
  s.userData.set = (p = {}) => { if (p.color != null) toColor(T, p.color, col); if (p.intensity != null) P.intensity = p.intensity; if (p.size != null) s.scale.setScalar(p.size); s.material.color.copy(col).multiplyScalar(P.intensity); return s; };
  return s;
}
/** Self-driving anamorphic lens flare at the group's world position. o: { color, size=0.5, intensity=1, streak=true, ghosts=5, ring=true, visibility=1, fadeEdge=true }.
 *  flare.userData.set({color,intensity,visibility}) (visibility 0..1 — e.g. 0 when the light is occluded). Position the returned Group at the light. */
export function lensFlare(T, o = {}) {
  const P = { color: '#ffcf96', size: 0.5, intensity: 1, streak: true, ghosts: 5, ring: true, visibility: 1, fadeEdge: true, ghostDist: 3, ...o }, col = toColor(T, P.color), g = new T.Group(); g.name = 'lens-flare';
  const parts = [], mkMat = (tex, c, k) => new T.SpriteMaterial({ map: tex, color: c.clone().multiplyScalar(k), blending: T.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, toneMapped: false, fog: false });
  const add = (tex, w, h, k, tint, pos, rot = 0) => { const s = new T.Sprite(mkMat(tex, tint, k)); s.frustumCulled = false; s.renderOrder = 20; s.material.rotation = rot; parts.push({ s, w, h, k, tint: tint.clone(), pos, base: k }); g.add(s); return s; };
  add(glowTexture(T), P.size * 3.2, P.size * 3.2, 1.8, col, 1); add(glowTexture(T), P.size * 9, P.size * 9, 0.22, col.clone().lerp(new T.Color('#6b5bff'), 0.4), 1);
  if (P.streak) { add(streakTexture(T), P.size * 18, P.size * 0.9, 1.5, col.clone().lerp(new T.Color('#7cc4ff'), 0.55), 1); add(streakTexture(T), P.size * 8, P.size * 0.45, 1.2, new T.Color('#ffffff'), 1); }
  if (P.ring) add(ringTexture(T), P.size * 4.5, P.size * 4.5, 0.55, col.clone().lerp(new T.Color('#ffffff'), 0.2), 1);
  const gk = [-0.55, -0.3, 0.35, 0.7, -1.1, 1.5, -0.8, 0.15], gt = ['#ffb62e', '#1fb5a6', '#6b5bff', '#f2542d', '#7cc4ff', '#ffb62e', '#1fb5a6', '#6b5bff'];
  for (let i = 0; i < P.ghosts; i++) add(discTexture(T), P.size * (0.7 + 1.6 * hash(i, 1, 7)), P.size * (0.7 + 1.6 * hash(i, 1, 7)), 0.16 + 0.1 * hash(i, 2, 7), new T.Color(gt[i % gt.length]), gk[i % gk.length]);
  const lw = new T.Vector3(), nd = new T.Vector3(), q = new T.Quaternion(), pp = new T.Vector3(), sc = new T.Vector3(), dirv = new T.Vector3(), ANG = 0.07;
  parts.forEach((p) => {
    p.s.onBeforeRender = (r, scene, cam) => { // angular-size sprites placed on the light->screen-centre axis (pure function of light + camera)
      g.updateWorldMatrix(true, false); lw.setFromMatrixPosition(g.matrixWorld); nd.copy(lw).project(cam); const behind = nd.z > 1;
      const edge = P.fadeEdge ? clamp(1.6 - Math.max(Math.abs(nd.x), Math.abs(nd.y)), 0, 1) : 1, vis = behind ? 0 : P.visibility * edge, k = p.pos;
      const dl = Math.max(0.5, lw.distanceTo(cam.position)), dist = k === 1 ? dl : P.ghostDist;
      dirv.set(nd.x * k, nd.y * k, 0.5).unproject(cam).sub(cam.position).normalize(); pp.copy(cam.position).addScaledVector(dirv, dist);
      sc.set(p.w * dist * ANG, p.h * dist * ANG, 1); q.identity(); p.s.matrixWorld.compose(pp, q, sc);
      p.s.material.color.copy(p.tint).multiplyScalar(p.base * P.intensity * vis); p.s.visible = vis > 0.001;
    };
  });
  g.userData.set = (p = {}) => { Object.assign(P, p); if (p.color != null) { toColor(T, p.color, col); parts.slice(0, 1).forEach((q2) => q2.tint.copy(col)); } return g; };
  g.userData.parts = parts;
  return g;
}

// ================================================================================================ GODRAY CARD
/** Fake light-shaft card. mode 'radial' (rays fan out from `origin` uv) | 'parallel' (slanted window shafts). o: { width, height, color, intensity, mode, origin:[0.5,1], rays=18, slant=0.35, billboard }  */
export function createGodrayCard(T, o = {}) {
  const P = { width: 4, height: 6, color: '#ffe2b0', intensity: 1, mode: 'parallel', origin: [0.5, 1.0], rays: 18, slant: 0.35, billboard: false, speed: 0.15, seed: 1, ...o };
  const U = { uColor: { value: toColor(T, P.color) }, uInt: { value: P.intensity }, uMode: { value: P.mode === 'radial' ? 0 : 1 }, uOrigin: { value: new T.Vector2(...P.origin) }, uRays: { value: P.rays }, uSlant: { value: P.slant }, uTime: { value: 0 }, uAspect: { value: P.width / P.height }, uSeed: { value: P.seed }, uSpeed: { value: P.speed }, uNoise: { value: noise3DTexture(T) } };
  const mat = new T.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false, toneMapped: false, vertexShader: FLAT_VS,
    fragmentShader: `precision highp float; precision highp sampler3D; varying vec2 vUv; uniform vec3 uColor; uniform float uInt, uMode, uRays, uSlant, uTime, uAspect, uSeed, uSpeed; uniform vec2 uOrigin; uniform sampler3D uNoise;
      void main(){
        float sh, fall; vec2 p = vUv;
        if (uMode < 0.5) { vec2 d = (p - uOrigin) * vec2(uAspect, 1.0); float r = length(d), a = atan(d.y, d.x); float n = texture(uNoise, vec3(a * 0.9549 * uRays / 6.0, r * 0.3, uTime * uSpeed + uSeed)).g; sh = 0.25 + 1.6 * pow(n, 1.5); fall = exp(-r * 1.6) * smoothstep(0.0, 0.08, r); }
        else { float u = p.x + (1.0 - p.y) * uSlant; float n = texture(uNoise, vec3(u * uRays * 0.5, p.y * 0.4, uTime * uSpeed + uSeed)).g; sh = 0.2 + 1.7 * pow(n, 1.6); fall = smoothstep(0.0, 0.3, p.y) * (0.35 + 0.65 * p.y); }
        float edge = smoothstep(0.0, 0.3, p.x) * smoothstep(1.0, 0.7, p.x) * smoothstep(0.0, 0.25, p.y) * smoothstep(1.0, 0.75, p.y);
        gl_FragColor = vec4(uColor * uInt * sh * fall * edge, 1.0); }`,
  });
  const mesh = new T.Mesh(new T.PlaneGeometry(P.width, P.height), mat); mesh.name = 'godray'; mesh.renderOrder = 4; mesh.frustumCulled = false;
  if (P.billboard) { const q = new T.Quaternion(), s = new T.Vector3(), p = new T.Vector3(); mesh.onBeforeRender = (r, sc, cam) => { mesh.updateWorldMatrix(true, false); p.setFromMatrixPosition(mesh.matrixWorld); s.setFromMatrixScale(mesh.matrixWorld); q.copy(cam.quaternion); mesh.matrixWorld.compose(p, q, s); }; }
  return { mesh, object: mesh, uniforms: U, update(t) { U.uTime.value = t; return this; } };
}

// ================================================================================================ FILM STRIP
/** 35 mm film strip along a curve with perforations + frames (procedural pictures or an atlas). o: { curve|length, width=0.35, atlas, atlasCols=4, atlasRows=4, tint, emissive=1.1, scroll=0, segments, widthDir:[0,1,0], seed }
 *  widthDir = which way the strip's width runs (default world up -> a vertical strip facing sideways to the curve; use [0,0,1] for a flat strip lying in a horizontal plane). */
export function createFilmStrip(T, o = {}) {
  const P = { width: 0.35, emissive: 1.1, scroll: 0, atlasCols: 4, atlasRows: 4, seed: 4, widthDir: [0, 1, 0], ...o };
  const curve = o.curve ? (o.curve.getPoint ? o.curve : new T.CatmullRomCurve3(o.curve.map((p) => toVec(T, p)))) : new T.LineCurve3(new T.Vector3(-(o.length ?? 4) / 2, 0, 0), new T.Vector3((o.length ?? 4) / 2, 0, 0));
  const L = curve.getLength(), frameLen = P.width * 0.543, frames = Math.max(1, Math.round(L / frameLen)), seg = P.segments ?? Math.max(24, Math.min(400, frames * 6));
  const pos = [], uv = [], idx = [], wd = toVec(T, P.widthDir), p = new T.Vector3(), tg = new T.Vector3(), sd = new T.Vector3();
  for (let j = 0; j <= seg; j++) {
    const u = j / seg; curve.getPointAt(u, p); curve.getTangentAt(u, tg); sd.copy(wd).addScaledVector(tg, -wd.dot(tg)); if (sd.lengthSq() < 1e-6) sd.set(0, 0, 1).addScaledVector(tg, -tg.z); sd.normalize();
    for (let s = 0; s < 2; s++) { const q = p.clone().addScaledVector(sd, (s ? 0.5 : -0.5) * P.width); pos.push(q.x, q.y, q.z); uv.push(u, s); }
    if (j < seg) { const a = j * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
  const U = { uTime: { value: 0 }, uFrames: { value: frames }, uLen: { value: L }, uWidth: { value: P.width }, uScroll: { value: P.scroll }, uInt: { value: P.emissive }, uTint: { value: toColor(T, P.tint ?? '#ffffff') }, uAtlas: { value: P.atlas || null }, uCols: { value: P.atlasCols }, uRows: { value: P.atlasRows }, uSeed: { value: P.seed } };
  const mat = new T.ShaderMaterial({
    uniforms: U, defines: P.atlas ? { ATLAS: 1 } : {}, side: T.DoubleSide, fog: false, toneMapped: false, vertexShader: 'varying vec2 vUv; varying vec3 vN, vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `precision highp float; varying vec2 vUv; varying vec3 vN, vW; uniform float uTime, uFrames, uLen, uWidth, uScroll, uInt, uCols, uRows, uSeed; uniform vec3 uTint; uniform sampler2D uAtlas;
      float h1(float n){ return fract(sin(n * 127.1 + uSeed * 31.7) * 43758.5453); }
      float sdR(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
      vec3 pal(float k){ k = fract(k); vec3 a = k < 0.2 ? vec3(1.0, 0.71, 0.18) : k < 0.4 ? vec3(0.12, 0.7, 0.65) : k < 0.6 ? vec3(0.42, 0.36, 1.0) : k < 0.8 ? vec3(0.95, 0.33, 0.18) : vec3(0.49, 0.77, 1.0); return a; }
      vec3 pic(float cell, vec2 q){
        float r1 = h1(cell), r2 = h1(cell + 11.0), r3 = h1(cell + 23.0), hz = 0.3 + 0.2 * r1;
        vec3 sky = mix(pal(r2) * 0.5, pal(r2 + 0.3), q.y), sun = pal(r3 + 0.1);
        vec2 sp = vec2(0.25 + 0.5 * r3, hz + 0.22 + 0.1 * r1); float sd = length((q - sp) * vec2(1.4, 1.0));
        vec3 c = sky + sun * (exp(-sd * sd * 90.0) * 1.8 + exp(-sd * 5.0) * 0.25);
        float ridge = hz + 0.07 * sin(q.x * 7.0 + r1 * 6.28) + 0.035 * sin(q.x * 17.0 + r2 * 6.28);
        if (q.y < ridge) c = mix(vec3(0.02, 0.015, 0.03), pal(r2) * 0.12, q.y / max(ridge, 0.01)) ;
        return c * (1.0 - 0.45 * length(q - 0.5)); }
      void main(){
        float fu = vUv.x * uFrames + uScroll; float cell = floor(fu), f = fract(fu);
        float fl = uLen / uFrames; vec2 p = vec2((f - 0.5) * fl, (vUv.y - 0.5) * uWidth);
        vec3 base = vec3(0.075, 0.05, 0.03) * uTint; vec3 col = base;
        // perforations: 4 per frame, both edges
        float pf = fract(fu * 4.0 + 0.5) - 0.5; vec2 pp = vec2(pf * fl * 0.25, abs(p.y) - uWidth * 0.425);
        float perf = sdR(pp, vec2(fl * 0.25 * 0.21, uWidth * 0.04), uWidth * 0.012);
        if (perf < 0.0) discard;
        // frame window 24x18 in 35x19
        vec2 wp = vec2(p.x, p.y); float win = sdR(wp, vec2(fl * 0.474, uWidth * 0.343), uWidth * 0.008);
        if (win < 0.0) {
          vec2 q = vec2(0.5 + p.x / (fl * 0.948), 0.5 + p.y / (uWidth * 0.686));
          #ifdef ATLAS
            float id = mod(cell, uCols * uRows); vec2 cr = vec2(mod(id, uCols), floor(id / uCols)); vec3 c0 = texture2D(uAtlas, (cr + vec2(q.x, q.y)) / vec2(uCols, uRows)).rgb;
          #else
            vec3 c0 = pic(cell, q);
          #endif
          col = c0 * uInt;
        } else {
          float edgeMark = step(0.5, h1(cell + 3.0)) * step(0.5, fract(fu * 6.0)) * step(abs(abs(p.y) - uWidth * 0.31), uWidth * 0.012) * 0.12; col += vec3(0.9, 0.55, 0.2) * edgeMark;
          vec3 V = normalize(cameraPosition - vW); float fr = pow(1.0 - abs(dot(normalize(vN + 1e-5), V)), 3.0); col += vec3(0.5, 0.55, 0.7) * fr * 0.18;
        }
        gl_FragColor = vec4(col, 1.0); }`,
  });
  const mesh = new T.Mesh(g, mat); mesh.name = 'filmstrip'; mesh.frustumCulled = false;
  return { mesh, object: mesh, uniforms: U, frames, length: L, update(t, o2 = {}) { U.uTime.value = t; if (o2.scroll != null) U.uScroll.value = o2.scroll; return this; } };
}

// ================================================================================================ GRID / HOLO FLOOR
/** Holographic grid on y=0 (rotate/position the mesh freely). o: { size=24, cell=0.5, color, color2, glow=1, fade=1.4, pulse=1, thickness=1 } */
export function createGrid(T, o = {}) {
  const P = { size: 24, cell: 0.5, color: '#1fb5a6', color2: '#7cc4ff', glow: 1, fade: 1.4, pulse: 1, thickness: 1, ...o };
  const U = { uColor: { value: toColor(T, P.color) }, uColor2: { value: toColor(T, P.color2) }, uCell: { value: P.cell }, uSize: { value: P.size }, uTime: { value: 0 }, uGlow: { value: P.glow }, uThick: { value: P.thickness }, uFade: { value: P.fade }, uPulse: { value: P.pulse }, uCenter: { value: new T.Vector2(0, 0) } };
  const mat = new T.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    vertexShader: 'varying vec3 vW; varying vec2 vL; void main(){ vL = position.xy; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `precision highp float; varying vec3 vW; varying vec2 vL; uniform vec3 uColor, uColor2; uniform float uCell, uSize, uTime, uGlow, uThick, uFade, uPulse; uniform vec2 uCenter;
      float line(vec2 p, float cell, float th){ vec2 q = p / cell; vec2 g = abs(fract(q - 0.5) - 0.5) / max(fwidth(q), vec2(1e-5)); float l = min(g.x, g.y); return 1.0 - smoothstep(th - 0.5, th + 0.5, l); }
      void main(){ vec2 p = vL - uCenter; float r = length(p);
        float minor = line(p, uCell, uThick), major = line(p, uCell * 5.0, uThick * 1.8);
        float fade = pow(1.0 - smoothstep(uSize * 0.08, uSize * 0.5, r), uFade);
        float ring = exp(-pow((r - mod(uTime * uSize * 0.1, uSize * 0.5)) / (0.12 + 0.01 * uSize), 2.0)) * uPulse;
        vec3 col = uColor * (minor * 0.45 + major * 1.1) + uColor2 * ring * (0.5 + 2.0 * major + 0.6 * minor) + uColor * 0.03;
        gl_FragColor = vec4(col * fade * uGlow, 1.0); }`,
  });
  const mesh = new T.Mesh(new T.PlaneGeometry(P.size, P.size), mat); mesh.rotation.x = -Math.PI / 2; mesh.position.y = 0.004; mesh.renderOrder = 3; mesh.frustumCulled = false; mesh.name = 'grid';
  return { mesh, object: mesh, uniforms: U, update(t) { U.uTime.value = t; return this; } };
}
/** Grid + soft base disc + concentric rings — a holographic stage. */
export function createHoloFloor(T, o = {}) {
  const g = createGrid(T, o), grp = new T.Group(), col = toColor(T, o.color ?? '#1fb5a6'), size = o.size ?? 24;
  const disc = new T.Mesh(new T.PlaneGeometry(size * 0.5, size * 0.5), new T.ShaderMaterial({ uniforms: { uC: { value: col.clone() }, uI: { value: 0.12 * (o.glow ?? 1) }, uTime: g.uniforms.uTime }, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false, toneMapped: false, vertexShader: FLAT_VS,
    fragmentShader: 'precision highp float; varying vec2 vUv; uniform vec3 uC; uniform float uI, uTime; void main(){ float r = length(vUv - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, r); float rings = 0.5 + 0.5 * cos(r * 40.0 - uTime * 1.5); gl_FragColor = vec4(uC * uI * (a * a * 0.7 + a * 0.3 * rings * rings * rings), 1.0); }' }));
  disc.rotation.x = -Math.PI / 2; disc.position.y = 0.002; disc.renderOrder = 2; disc.frustumCulled = false; grp.add(disc, g.mesh);
  return { group: grp, object: grp, mesh: g.mesh, grid: g, uniforms: g.uniforms, update(t) { g.update(t); return this; } };
}

// ================================================================================================ TEXT IN 3D
const _canvasCache = new Map();
/** Glowing text on a plane (canvas texture; DOM needed). o: { font:'160px "Bebas Neue"' | (px)=>css, height=0.3 (world height of one line), color='#fff3d6', glowColor, glow=0.5, intensity=1.3,
 *    align:'center'|'left'|'right', lineHeight=1.15, pxPerUnit=600, letterSpacing=0, reveal=1, soft=0.12, blend:'add'|'normal', doubleSide }
 *  Returns { mesh, setText(str), setReveal(0..1), setColor(c), setIntensity(k), width, height, material } — setText re-renders the texture (do it in setup, not per frame). */
export function createTextPlane(T, text, o = {}) {
  const P = { height: 0.3, color: '#fff3d6', glow: 0.5, intensity: 1.3, align: 'center', lineHeight: 1.15, pxPerUnit: 600, letterSpacing: 0, reveal: 1, soft: 0.12, blend: 'add', fontFamily: '"Bebas Neue", "Oswald", sans-serif', weight: '400', ...o };
  const glowCol = toColor(T, P.glowColor ?? P.color);
  const U = { uTex: { value: null }, uColor: { value: toColor(T, P.color) }, uGlowColor: { value: glowCol }, uInt: { value: P.intensity }, uGlow: { value: P.glow }, uReveal: { value: P.reveal }, uSoft: { value: P.soft }, uOpacity: { value: 1 } };
  const mat = new T.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: P.blend === 'add' ? T.AdditiveBlending : T.NormalBlending, side: P.doubleSide ? T.DoubleSide : T.FrontSide, fog: false, toneMapped: false, vertexShader: FLAT_VS,
    defines: P.blend === 'add' ? { ADD: 1 } : {},
    fragmentShader: `precision highp float; varying vec2 vUv; uniform sampler2D uTex; uniform vec3 uColor, uGlowColor; uniform float uInt, uGlow, uReveal, uSoft, uOpacity;
      void main(){ vec4 t = texture2D(uTex, vUv); float k = smoothstep(0.0, uSoft, uReveal * (1.0 + uSoft) - vUv.x);
        float m = t.r + t.g * uGlow * 0.6; vec3 col = (uColor * t.r + uGlowColor * t.g * uGlow * 0.6) * uInt * k * uOpacity;
        #ifdef ADD
          gl_FragColor = vec4(col, 1.0);
        #else
          gl_FragColor = vec4(col / max(m * k, 1e-3) , clamp(m, 0.0, 1.0) * k * uOpacity);
        #endif
      }`,
  });
  const mesh = new T.Mesh(new T.PlaneGeometry(1, 1), mat); mesh.name = 'text-plane'; mesh.renderOrder = 8;
  const api = { mesh, object: mesh, material: mat, uniforms: U, width: 1, height: 1, text: '' };
  api.setText = (str) => {
    if (typeof document === 'undefined') return api;
    const fontPx = 160, fontCss = typeof P.font === 'function' ? P.font(fontPx) : P.font ? P.font.replace(/\d+(\.\d+)?px/, fontPx + 'px') : `${P.weight} ${fontPx}px ${P.fontFamily}`;
    const lines = String(str).split('\n'), pad = Math.round(fontPx * (0.35 + P.glow * 0.5)), lh = Math.round(fontPx * P.lineHeight);
    const c0 = document.createElement('canvas'), x0 = c0.getContext('2d'); x0.font = fontCss; if ('letterSpacing' in x0) x0.letterSpacing = P.letterSpacing * fontPx + 'px';
    const wpx = Math.ceil(Math.max(...lines.map((l) => x0.measureText(l).width))), W = wpx + pad * 2, H = lh * lines.length + pad * 2;
    const draw = (blur, color) => {
      const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.font = fontCss; if ('letterSpacing' in g) g.letterSpacing = P.letterSpacing * fontPx + 'px'; g.textBaseline = 'alphabetic'; g.textAlign = P.align; g.fillStyle = '#fff'; g.shadowColor = '#fff'; g.shadowBlur = blur;
      const ax = P.align === 'center' ? W / 2 : P.align === 'left' ? pad : W - pad; lines.forEach((l, i) => g.fillText(l, ax, pad + lh * i + fontPx * 0.82 + (lh - fontPx) * 0.5));
      return g.getImageData(0, 0, W, H).data;
    };
    const core = draw(0), glow = draw(fontPx * 0.12 + P.glow * fontPx * 0.2), data = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const s = ((H - 1 - y) * W + x) * 4, d = (y * W + x) * 4; data[d] = core[s + 3]; data[d + 1] = glow[s + 3]; data[d + 2] = 0; data[d + 3] = 255; }
    if (U.uTex.value) U.uTex.value.dispose();
    const tex = new T.DataTexture(data, W, H, T.RGBAFormat, T.UnsignedByteType); tex.minFilter = T.LinearMipmapLinearFilter; tex.magFilter = T.LinearFilter; tex.generateMipmaps = true; tex.anisotropy = 8; tex.needsUpdate = true; U.uTex.value = tex;
    const uPerPx = P.height / (fontPx * P.lineHeight); api.width = W * uPerPx; api.height = H * uPerPx; mesh.scale.set(api.width, api.height, 1); api.text = String(str); return api;
  };
  api.setReveal = (k) => { U.uReveal.value = k; return api; }; api.setColor = (c) => { toColor(T, c, U.uColor.value); return api; }; api.setIntensity = (k) => { U.uInt.value = k; return api; };
  api.setText(text); return api;
}

// ================================================================================================ PANEL FRAME
export function roundedRectShape(T, w, h, r, hole = false) {
  const s = new T.Shape(), x = -w / 2, y = -h / 2; r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false); s.lineTo(x + w, y + h - r); s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + h); s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false); s.lineTo(x, y + r); s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false); return s;
}
/** Storyboard panel / screen: glossy rounded frame + emissive screen + soft glow + optional viewfinder brackets.
 *  o: { w=1.6, h=0.9, depth=0.05, border=0.05, radius=0.05, color='#17161d', edge='#7cc4ff', edgeIntensity=1.2, screen:{color,map,intensity}, glow=0.5, brackets=false } */
export function createPanelFrame(T, o = {}) {
  const P = { w: 1.6, h: 0.9, depth: 0.05, border: 0.05, radius: 0.05, color: '#2a2a35', edge: '#7cc4ff', edgeIntensity: 1.2, glow: 0.5, brackets: false, ...o }, group = new T.Group(); group.name = 'panel';
  const iw = P.w - 2 * P.border, ih = P.h - 2 * P.border, ir = Math.max(0.005, P.radius - P.border * 0.6);
  const outer = roundedRectShape(T, P.w, P.h, P.radius), holePath = roundedRectShape(T, iw, ih, ir); outer.holes.push(holePath);
  const fg = new T.ExtrudeGeometry(outer, { depth: P.depth, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 10 }); fg.translate(0, 0, -P.depth / 2);
  const frame = new T.Mesh(fg, new T.MeshPhysicalMaterial({ color: P.color, roughness: 0.32, metalness: 0.4, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 2.6, emissive: toColor(T, P.edge).multiplyScalar(0.07) })); frame.name = 'panel-frame'; frame.castShadow = true; group.add(frame);
  // emissive lip (thin ring just inside the frame)
  const lip = roundedRectShape(T, iw + 0.012, ih + 0.012, ir + 0.006); lip.holes.push(roundedRectShape(T, iw - 0.004, ih - 0.004, Math.max(0.003, ir - 0.002)));
  const edge = new T.Mesh(new T.ShapeGeometry(lip, 10), new T.MeshBasicMaterial({ color: toColor(T, P.edge).multiplyScalar(P.edgeIntensity), toneMapped: false, fog: false })); edge.position.z = P.depth / 2 + 0.0095; edge.name = 'panel-edge'; group.add(edge);
  const sc = P.screen || {}, sm = new T.MeshBasicMaterial({ color: toColor(T, sc.color ?? '#10151f').multiplyScalar(sc.intensity ?? 1), map: sc.map || null, toneMapped: false, fog: false });
  const screen = new T.Mesh(new T.PlaneGeometry(iw, ih), sm); screen.position.z = P.depth / 2 - 0.004; screen.name = 'panel-screen'; group.add(screen);
  const gm = new T.Mesh(new T.PlaneGeometry(P.w * 1.9, P.h * 2.1), new T.ShaderMaterial({ uniforms: { uC: { value: toColor(T, P.edge) }, uI: { value: P.glow * 0.14 }, uA: { value: P.w / P.h } }, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false, toneMapped: false, vertexShader: FLAT_VS,
    fragmentShader: 'precision highp float; varying vec2 vUv; uniform vec3 uC; uniform float uI, uA; void main(){ vec2 p = abs(vUv - 0.5) * 2.0; vec2 d = max(p - vec2(0.5, 0.48), 0.0); float r = length(d); float a = exp(-r * r * 18.0); gl_FragColor = vec4(uC * uI * a, 1.0); }' }));
  gm.position.z = -P.depth / 2 - 0.01; gm.name = 'panel-glow'; gm.renderOrder = 2; group.add(gm);
  if (P.brackets) {
    const bm = new T.MeshBasicMaterial({ color: toColor(T, P.edge).multiplyScalar(1.6), toneMapped: false, fog: false }), t = 0.012, l = Math.min(iw, ih) * 0.14, bx = iw / 2 + 0.05, by = ih / 2 + 0.05;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) { const a = new T.Mesh(new T.PlaneGeometry(l, t), bm), b = new T.Mesh(new T.PlaneGeometry(t, l), bm); a.position.set(sx * (bx - l / 2 + t / 2), sy * by, P.depth / 2 + 0.01); b.position.set(sx * bx, sy * (by - l / 2 + t / 2), P.depth / 2 + 0.01); group.add(a, b); }
  }
  return {
    group, object: group, frame, screen, edge, glowMesh: gm, width: P.w, height: P.h,
    setScreen(s = {}) { if (s.map !== undefined) { sm.map = s.map; sm.needsUpdate = true; } if (s.color != null) toColor(T, s.color, sm.color); if (s.intensity != null) sm.color.multiplyScalar(s.intensity); if (s.opacity != null) { sm.transparent = s.opacity < 1; sm.opacity = s.opacity; } return this; },
    setGlow(k) { gm.material.uniforms.uI.value = P.glow * 0.14 * k; return this; }, setEdge(c, k = 1) { toColor(T, c, edge.material.color).multiplyScalar(P.edgeIntensity * k); gm.material.uniforms.uC.value.set(c); return this; },
  };
}
