// =============================================================================
// amrita3d.js — Amrita in 3D (v1): an EXTRUDED icon character built from the proposed mark.
//   disc body (thickness 0.28 R + bevels, gunmetal bezel) · 6 pinwheel aperture blades (beveled, pillowed, per-blade height
//   variation, baked AO + vermilion->amber gradient in vertex colours) · hex pit · raised cream rounded PLAY-TRIANGLE face plate
//   (soft emissive so it always reads) · two glossy black OVAL eyes (morphing "sausage" meshes: every expression is a smooth
//   numeric blend, clearcoat + env reflection + shader catch-light). No human anatomy: no limbs, no torso.
// Units: R = 0.5 m (disc diameter 1.0 m). Face looks toward +Z. She hovers; props float at her right (+X).
// Everything here is a PURE FUNCTION of the inputs you pass (time included): no Math.random/Date.now, no state between frames.
//
// ---- core API (v0, FROZEN) -----------------------------------------------------------------------------------------------
//   const A = createAmrita(THREE, { style:'solid', palette })           -> A
//   A.root                       THREE.Group (position / rotate / scale it; origin = disc centre)
//   A.pose({ squash, yaw, roll, bob })      squash -0.5..+0.5 (+ = stretch tall, area preserving), yaw rad (turn toward camera ~0.5)
//   A.eyes({ open, squint, happy, determined, surprised, sleepy, lookX, lookY })   (merges into the current eye state)
//   A.expression('neutral'|'happy'|'determined'|'surprised'|'squint'|'sleepy'|'blink'|'wink'|'worried'|'angry', amount=1)
//   A.setProp('crank'|'megaphone'|'viewfinder'|'clapper'|'slate'|'baton'|'brush'|null, { t, clap, crank, glow, scale, ... })
//   A.blinkAt(T)                 seeded natural blink (T = struct with .t, or a number): returns CLOSED amount 0..1
//   A.setStyle('solid'|'hologram'|'particles'|'ghost', { hue, alpha, form, size, t })
//   A.materials                  { blade, bladeAlt, face, eye, body, glow, plastic, metal } (tint / emissive tweaks)
//   A.faceWorldPos(v3)           world position of the face-plate centre
//
// ---- v1 additions --------------------------------------------------------------------------------------------------------
//   pose() also takes { pitch, pivot(-1 bottom..0 centre..+1 top: which point stays fixed while squashing), yawD (added to yaw), x,y,z }.
//   Motion helpers (pure; both as module exports and as A.* methods). They return pose deltas you can spread into / sum for A.pose:
//     hover(t,{amp,freq,seed})            -> {bob,roll,yawD,squash}       idle float
//     land(t,t0,{stretch,squash,...})     -> {squash,pivot}               stretch -> SQUASH at t0 -> overshoot -> settle
//     jump(t,t0,{height,air,squat,anticip}) -> {bob,squash,pivot}         anticipation squat, launch stretch, ballistic arc, land
//     dropIn(t,{t0,tLand,fromY})          -> {bob,squash,pivot}           falls in from above stretched, lands with squash (bob = offset from final height)
//     anticipate(t,t0,{dur,squat})        -> squash (scalar)              squat before an action at t0
//     squashStretchCurve(t,t0,opts)       -> squash (scalar)              the scalar behind land()
//     punch(t,t0,{amp,freq,damp})         -> squash (scalar)              one-shot spring kick (hits)
//     beatPulse(t,{bpm,amp,offset})       -> squash (scalar)              squash on every beat
//     addPose(a,b,...)                    -> summed pose delta
//     clapCurve(t,tHit,{rise,hold})       -> clap 0(open)..1(closed) for setProp('clapper',{clap})
//     blinkAmount(t,seed)                 -> same as A.blinkAt
//   A.lookAt(vec3|{x,y,z}, {gain})        eyes track a WORLD point (returns the lookX/lookY it set)
//   A.idle(T,{yaw,seed,amp,look})         one call per frame = hover + natural blinks + eye wander (use instead of pose()/eyes())
//   A.blend('happy','determined',k)       eye-state blend helper;  A.EXPR  presets
//   A.contactShadow({floorY,radius,opacity,soft,aspect}|false)   soft blob on the floor under her; scales/fades with hover height. Zero upkeep
//                                          (it follows A.root automatically at render time). Returns the mesh (child of A.root).
//   A.propAnchor(v3, name='tip')          world position of the active prop's business end (baton tip, brush tip, mouth, lens, ...)
//   A.setProp extras:  crank (rad)  clap (0..1)  glow (0..1)  speak (0..1 megaphone sound arcs)  stroke (0..1 brush path position)
//                      trail (0..1 brush paint opacity)  ictus (s: time of a baton down-beat) beat (s)  float (m)  rotY  pos:[x,y,z]  side:+1|-1
//   A.setStyle extras: 'particles' { form 0..1 (scattered -> assembled), size, hue, t }, 'hologram' { hue, alpha, t }, 'ghost' { alpha }
//   A.time(t)                             drives hologram scanlines / particle drift if you do not pass t to setStyle
//   A.useEnvironment(renderer?)           bakes the tiny built-in studio reflection env (done lazily on first render otherwise)
//   A.setEnvIntensity(x) · A.setShadows({cast,receive}) · A.glowLight  (optional PointLight, createAmrita(THREE,{glowLight:true}))
// Draw calls (solid): body 1 · blades 2 · face 1 · eyes 2 · prop 3-6 · shadow 1  => ~10-14.
// =============================================================================
import { clamp, lerp } from '../engine/ease.js';
import { hash, rng as makeRng, noise1 } from '../engine/rng.js';

export const AMRITA_R = 0.5;
const R = AMRITA_R;
const TAU = Math.PI * 2;
const rad = (d) => (d * Math.PI) / 180;
const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const tOf = (T) => (typeof T === 'number' ? T : T && T.t != null ? T.t : 0);

// ------------------------------------------------------------------------------------------------------------------------
// Pure motion helpers
// ------------------------------------------------------------------------------------------------------------------------
/** damped oscillation: 1 at dt=0, oscillating and decaying (freq Hz, damping ratio 0..1) */
export function settle(dt, freq = 3.2, damp = 0.28) {
  if (dt <= 0) return 1;
  const w = TAU * freq, wd = w * Math.sqrt(1 - damp * damp);
  return Math.exp(-damp * w * dt) * Math.cos(wd * dt);
}
export function addPose(...ps) {
  const o = { bob: 0, squash: 0, roll: 0, yawD: 0 };
  for (const p of ps) { if (!p) continue; o.bob += p.bob || 0; o.squash += p.squash || 0; o.roll += p.roll || 0; o.yawD += p.yawD || p.yaw || 0; if (p.pivot != null) o.pivot = p.pivot; }
  return o;
}
/** idle hover: gentle bob + roll/yaw drift. Add to your base pose (hover.yawD is an offset). */
export function hover(t, { amp = 0.035, freq = 0.42, seed = 0, tilt = 1 } = {}) {
  const ph = seed * 1.7, w = TAU * freq;
  return {
    bob: amp * (0.82 * Math.sin(w * t + ph) + 0.18 * Math.sin(w * 1.93 * t + ph * 2.1 + 1.3)),
    roll: 0.032 * tilt * Math.sin(w * 0.71 * t + ph + 0.6),
    yawD: 0.045 * tilt * Math.sin(w * 0.53 * t + ph * 0.7 + 2.0),
    squash: 0.012 * Math.sin(w * t + ph + 1.1),
  };
}
/** squat before an action at t0 (returns a NEGATIVE squash that ramps in over dur, then 0 after t0) */
export function anticipate(t, t0, { dur = 0.16, squat = 0.22 } = {}) {
  if (t >= t0) return 0;
  return -Math.abs(squat) * sstep(t0 - dur, t0, t);
}
/** stretch (falling) -> SQUASH at contact t0 -> overshoot stretch -> settle. scalar squash (+ = taller). */
export function squashStretchCurve(t, t0, { pre = 0.14, stretch = 0.28, squash = -0.34, freq = 3.0, damp = 0.27, snap = 0.045 } = {}) {
  const dt = t - t0;
  if (dt < -pre) return 0;
  if (dt < 0) return pre > 0 ? stretch * sstep(-pre, 0, dt) : 0;
  const base = lerp(pre > 0 ? stretch : 0, squash, sstep(0, snap, dt));
  if (dt < snap) return base;
  return squash * settle(dt - snap, freq, damp);
}
export function land(t, t0, o = {}) {
  const dt = t - t0;
  return { squash: squashStretchCurve(t, t0, o), pivot: -sstep(-0.03, 0.04, dt) * (o.pivot ?? 1), bob: 0 };
}
/** one-shot spring kick (hit / emphasis): squash goes `amp` then rings down */
export function punch(t, t0, { amp = -0.18, freq = 4.0, damp = 0.3 } = {}) { return t < t0 ? 0 : amp * settle(t - t0, freq, damp); }
export function beatPulse(t, { bpm = 120, amp = 0.06, offset = 0 } = {}) {
  const beat = 60 / bpm, dt = ((t - offset) % beat + beat) % beat;
  return -amp * settle(dt, 3.4, 0.3) * Math.exp(-dt * 2);
}
/** jump with anticipation, launch stretch, ballistic arc and landing squash. bob = height above start. */
export function jump(t, t0, { height = 0.9, air = 0.7, squat = 0.22, anticip = 0.2, stretch = 0.22 } = {}) {
  const tl = t0 + air, ta = t0 - anticip;
  if (t < ta) return { bob: 0, squash: 0, pivot: 0 };
  if (t < t0) return { bob: 0, squash: -squat * sstep(ta, t0, t), pivot: -0.6 * sstep(ta, t0, t) };
  if (t < tl) {
    const s = (t - t0) / air, up = stretch * Math.pow(Math.abs(Math.cos(Math.PI * s)), 1.5);
    return { bob: height * 4 * s * (1 - s), squash: lerp(-squat, up, sstep(0, 0.14, s)), pivot: 0 };
  }
  return { bob: 0, squash: squashStretchCurve(t, tl, { pre: 0, stretch, squash: -squat * 1.35 }), pivot: -sstep(0, 0.04, t - tl) * 0.8 };
}
/** falls from `fromY` above its final position (bob = offset to ADD to the final y), stretched, then lands with squash + a small dip. */
export function dropIn(t, { t0 = 0, tLand = 1, fromY = 3, stretch = 0.4, squash = -0.34, dip = 0.05 } = {}) {
  if (t < tLand) {
    const s = clamp((t - t0) / Math.max(1e-6, tLand - t0));
    return { bob: fromY * (1 - s * s), squash: stretch * Math.pow(s, 1.4), pivot: 0 };
  }
  const dt = t - tLand;
  return { bob: -dip * Math.exp(-dt * 5) * Math.sin(Math.min(1, dt * 7) * Math.PI), squash: squashStretchCurve(t, tLand, { pre: 0, stretch, squash }), pivot: -sstep(0, 0.04, dt) * Math.exp(-dt * 1.4) };
}
/** clapperboard stick: 1 = closed, 0 = fully open. Raises before tHit, holds, SNAPS shut at tHit and rebounds a hair. */
export function clapCurve(t, tHit, { rise = 0.3, hold = 0.14, bounce = 0.17 } = {}) {
  const tr0 = tHit - hold - rise, tr1 = tHit - hold, shut = 0.045;
  if (t < tr0) return 1;
  if (t < tr1) return 1 - sstep(tr0, tr1, t);
  if (t < tHit) return 0;
  const dt = t - tHit;
  if (dt < shut) return (dt / shut) * (dt / shut);
  const x = (dt - shut) / 0.16;
  return x < 1 ? 1 - bounce * Math.sin(Math.PI * x) * (1 - x) : 1;
}
function blinkShape(x) { if (x < 0 || x > 0.2) return 0; return x < 0.065 ? Math.sin((x / 0.065) * Math.PI * 0.5) : Math.cos(((x - 0.065) / 0.135) * Math.PI * 0.5) ** 1.3; }
/** natural seeded blinking: irregular 1.5..4 s gaps, ~22 % double blinks. returns closed amount 0..1 */
export function blinkAmount(t, seed = 0) {
  const SLOT = 2.7, k0 = Math.floor(t / SLOT);
  let c = 0;
  for (let k = k0 - 1; k <= k0; k++) {
    const t0 = (k + 0.08 + 0.84 * hash(k, seed + 11)) * SLOT;
    c = Math.max(c, blinkShape(t - t0));
    if (hash(k, seed + 29) > 0.78) c = Math.max(c, blinkShape(t - t0 - 0.27));
  }
  return c;
}
// classic 4-beat conducting pattern (ictus = lowest point of every beat; the DOWNBEAT drops from above onto its ictus).
// returns tip offsets {x,y} in -1..1 units (x: left/right, y: up/down)
const PAT = [[0, -0.55], [-0.62, -0.1], [0.55, -0.1], [0.12, 0.62]];
export function conductPath(t, { ictus = 0, beat = 0.5, pattern = 4 } = {}) {
  const pb = ((t - ictus) / beat % pattern + pattern) % pattern, k = Math.floor(pb), s = pb - k;
  const p0 = PAT[k % 4], p1 = PAT[(k + 1) % 4];
  if (k === 3) { const e = s * s; return { x: lerp(p0[0], p1[0], e), y: lerp(p0[1], p1[1], e) - 0.0 }; } // beat 4 -> 1: lift, then FALL onto the ictus
  const e = s * s * (3 - 2 * s);
  return { x: lerp(p0[0], p1[0], e), y: lerp(p0[1], p1[1], e) + 0.34 * Math.sin(Math.PI * s) };
}

// ------------------------------------------------------------------------------------------------------------------------
// Geometry kit (built once per THREE instance and cached). All model numbers below are in "R units" (disc radius = 1) and are
// scaled by R at the end. Vertex colours carry the albedo (white base materials) so a whole prop merges into 1-2 draw calls.
// ------------------------------------------------------------------------------------------------------------------------
function makeKit(THREE) {
  const K = {};
  const col = (c) => (c && c.isColor ? c : new THREE.Color(c));
  K.col = col;
  // paint a (indexed or not) geometry with one colour (adds uv if missing)
  K.paint = (g, c) => {
    const n = g.attributes.position.count, cc = col(c), a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = cc.r; a[i * 3 + 1] = cc.g; a[i * 3 + 2] = cc.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    return g;
  };
  K.xf = (g, { pos, rot, scl } = {}) => {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rot || [0, 0, 0])));
    m.compose(new THREE.Vector3(...(pos || [0, 0, 0])), q, new THREE.Vector3(...(scl || [1, 1, 1])));
    g.applyMatrix4(m); return g;
  };
  // merge to ONE non-indexed geometry with position/normal/uv/color
  K.merge = (list) => {
    const gs = list.map((g) => { const q = g.index ? g.toNonIndexed() : g; if (!q.attributes.color) K.paint(q, '#ffffff'); if (!q.attributes.uv) K.paint(q, '#ffffff'); return q; });
    let n = 0; for (const g of gs) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), cl = new Float32Array(n * 3);
    let o = 0;
    for (const g of gs) { const c = g.attributes.position.count; pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); uv.set(g.attributes.uv.array, o * 2); cl.set(g.attributes.color.array, o * 3); o += c; }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); out.setAttribute('color', new THREE.BufferAttribute(cl, 3));
    out.computeBoundingSphere(); return out;
  };
  // creased normals for non-indexed geometry (smooth within `deg`, hard across): welds by position
  K.crease = (g, deg = 38) => {
    const q = g.index ? g.toNonIndexed() : g, p = q.attributes.position.array, nt = p.length / 9;
    const fn = new Float32Array(nt * 3), map = new Map(), key = (i) => Math.round(p[i * 3] * 2e4) + '_' + Math.round(p[i * 3 + 1] * 2e4) + '_' + Math.round(p[i * 3 + 2] * 2e4);
    for (let t = 0; t < nt; t++) {
      const i0 = t * 3, ax = p[i0 * 3 + 3] - p[i0 * 3], ay = p[i0 * 3 + 4] - p[i0 * 3 + 1], az = p[i0 * 3 + 5] - p[i0 * 3 + 2], bx = p[i0 * 3 + 6] - p[i0 * 3], by = p[i0 * 3 + 7] - p[i0 * 3 + 1], bz = p[i0 * 3 + 8] - p[i0 * 3 + 2];
      fn[t * 3] = ay * bz - az * by; fn[t * 3 + 1] = az * bx - ax * bz; fn[t * 3 + 2] = ax * by - ay * bx;
      for (let v = 0; v < 3; v++) { const k = key(i0 + v); (map.get(k) || map.set(k, []).get(k)).push(t); }
    }
    const cosT = Math.cos(rad(deg)), out = new Float32Array(p.length), nz = (t) => Math.hypot(fn[t * 3], fn[t * 3 + 1], fn[t * 3 + 2]) || 1;
    for (let t = 0; t < nt; t++) for (let v = 0; v < 3; v++) {
      const l = map.get(key(t * 3 + v)), f0 = nz(t); let sx = 0, sy = 0, sz = 0;
      for (const u of l) { const fu = nz(u); if ((fn[t * 3] * fn[u * 3] + fn[t * 3 + 1] * fn[u * 3 + 1] + fn[t * 3 + 2] * fn[u * 3 + 2]) / (f0 * fu) > cosT) { sx += fn[u * 3]; sy += fn[u * 3 + 1]; sz += fn[u * 3 + 2]; } }
      const L = Math.hypot(sx, sy, sz) || 1; out[(t * 3 + v) * 3] = sx / L; out[(t * 3 + v) * 3 + 1] = sy / L; out[(t * 3 + v) * 3 + 2] = sz / L;
    }
    q.setAttribute('normal', new THREE.BufferAttribute(out, 3)); return q;
  };
  K.rrShape = (w, h, r) => {
    const s = new THREE.Shape(), x = -w / 2, y = -h / 2; r = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4);
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false); s.lineTo(x + w, y + h - r); s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
    s.lineTo(x + r, y + h); s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false); s.lineTo(x, y + r); s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false); return s;
  };
  // extruded shape centred on z, exact outline (bevel goes inward), creased normals, painted
  K.ext = (shape, depth, bevel, c, seg = 4, curve = 24) => {
    const b = Math.min(bevel, depth / 2 - 1e-4);
    const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(1e-4, depth - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: seg, curveSegments: curve });
    g.translate(0, 0, -(depth - 2 * b) / 2); return K.paint(K.crease(g, 40), c);
  };
  K.rbox = (w, h, d, r, c, bevel = Math.min(0.006, d * 0.3), seg = 4) => K.ext(K.rrShape(w, h, r), d, bevel, c, seg);
  K.box = (w, h, d, c, pos) => { const g = K.paint(new THREE.BoxGeometry(w, h, d), c); return pos ? K.xf(g, { pos }) : g; };
  K.cyl = (rt, rb, h, c, o = {}) => { const g = K.paint(new THREE.CylinderGeometry(rt, rb, h, o.seg || 32, 1, !!o.open), c); const rot = o.axis === 'x' ? [0, 0, -Math.PI / 2] : o.axis === 'z' ? [Math.PI / 2, 0, 0] : null; return K.xf(g, { rot, pos: o.pos }); };
  K.sph = (r, c, pos, sc) => K.xf(K.paint(new THREE.SphereGeometry(r, 24, 16), c), { pos, scl: sc });
  K.tor = (r, t, c, o = {}) => { const g = K.paint(new THREE.TorusGeometry(r, t, 12, o.seg || 40), c); return K.xf(g, { rot: o.axis === 'x' ? [0, Math.PI / 2, 0] : o.axis === 'y' ? [Math.PI / 2, 0, 0] : null, pos: o.pos }); };
  // indexed grid surface; fn(i,j) -> [x,y,z, r,g,b]; winding auto-oriented so normals face +z
  K.grid = (nu, nv, fn) => {
    const n = (nu + 1) * (nv + 1), pos = new Float32Array(n * 3), cl = new Float32Array(n * 3), idx = [], id = (i, j) => j * (nu + 1) + i;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const r = fn(i, j), o = id(i, j); pos[o * 3] = r[0]; pos[o * 3 + 1] = r[1]; pos[o * 3 + 2] = r[2]; cl[o * 3] = r[3]; cl[o * 3 + 1] = r[4]; cl[o * 3 + 2] = r[5]; }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = id(i, j), b = id(i + 1, j), c = id(i + 1, j + 1), d = id(i, j + 1); idx.push(a, b, c, a, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(cl, 3)); g.setIndex(idx); g.computeVertexNormals();
    let sz = 0; for (let i = 0; i < n; i++) sz += g.attributes.normal.array[i * 3 + 2];
    if (sz < 0) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } g.setIndex(idx); g.computeVertexNormals(); }
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2)); return g;
  };
  return K;
}

// ------------------------------------------------------------------------------------------------------------------------
// The model (blades, body lathe, face plate, particle samples) — built once per THREE
// ------------------------------------------------------------------------------------------------------------------------
const MODEL = new WeakMap(); // THREE -> Map(paletteKey -> model)
const Z = { back: -0.14, floor: 0.10, lip: 0.14, pit: 0.03, plateTop: 0.20, bladeBase: 0.10 };

function buildModel(THREE, pal) {
  const pkey = [pal.vermilion, pal.amber, pal.cream].join('|');
  if (!MODEL.has(THREE)) MODEL.set(THREE, new Map());
  if (MODEL.get(THREE).has(pkey)) return MODEL.get(THREE).get(pkey);
  const K = makeKit(THREE), M = { K };
  const cVer = new THREE.Color(pal.vermilion), cAmb = new THREE.Color(pal.amber), cCream = new THREE.Color(pal.cream);
  const cGraph = new THREE.Color('#2A2833'), cInk = new THREE.Color('#0E0D12');

  // ---- blades: 6 curved triangles that tile the annulus outside a regular hexagon of circumradius 0.62 (pinwheel) ----
  const Rh = 0.62, Ro = 0.938, gap = 0.0075, s3 = Math.sqrt(3) / 2;
  const A0 = [Rh, 0], dAB = [0.5, s3], dAC = [-0.5, s3], nAB = [-dAB[1], dAB[0]], nAC = [dAC[1], -dAC[0]];
  const Ap = [A0[0], A0[1] + 2 * gap];                                  // apex shifted by the groove inset (bisector = +y)
  const ray = (d) => { const b = Ap[0] * d[0] + Ap[1] * d[1], s = -b + Math.sqrt(b * b - (Ap[0] * Ap[0] + Ap[1] * Ap[1]) + Ro * Ro); return [Ap[0] + d[0] * s, Ap[1] + d[1] * s]; };
  const Bp = ray(dAB), Cp = ray(dAC), thB = Math.atan2(Bp[1], Bp[0]), thC = Math.atan2(Cp[1], Cp[0]);
  const HK = [0.0365, 0.0405, 0.0345, 0.0395, 0.0355, 0.0415], TILT = [0.004, -0.003, 0.0035, -0.004, 0.003, -0.0035];
  const BEV = 0.03;
  // surface sample of blade k at fan params (s along the rim 0..1, v from apex 0 to rim 1). returns {x,y,z,d,q,ao}
  function bladePt(k, s, v) {
    const th = lerp(thB, thC, s), ax = Ap[0] + v * (Ro * Math.cos(th) - Ap[0]), ay = Ap[1] + v * (Ro * Math.sin(th) - Ap[1]);
    const d1 = (ax - Ap[0]) * nAB[0] + (ay - Ap[1]) * nAB[1], d2 = (ax - Ap[0]) * nAC[0] + (ay - Ap[1]) * nAC[1], d3 = Ro - Math.hypot(ax, ay);
    const d = Math.max(0, Math.min(d1, d2, d3));
    const x = Math.min(1, d / BEV), prof = Math.sqrt(Math.max(0, 1 - (1 - x) * (1 - x)));
    const h = HK[k] * (prof * (1 + 0.12 * sstep(BEV, 0.2, d))) + TILT[k] * (s - 0.5) * v;
    const a = rad(60 * k), c = Math.cos(a), sn = Math.sin(a);
    // colour param: sweep from the short edge (vermilion) to the long edge (amber), warmer toward the pit
    const q = clamp(Math.pow(s, 1.15) * 0.82 + (1 - v) * 0.14 + 0.04);
    const ao = lerp(0.5, 1, sstep(0, 0.05, d)) * lerp(0.82, 1, sstep(0, 0.3, v));
    return { x: ax * c - ay * sn, y: ax * sn + ay * c, z: Z.bladeBase + Math.max(0, h), d, q, ao, k, s, v };
  }
  const bladeCol = (p) => {
    const alt = p.k % 2, q = alt ? lerp(0.55, 1.0, p.q) : lerp(0.0, 0.5, p.q);
    const c = cVer.clone().lerp(cAmb, q); const hi = 0.92 + 0.14 * p.ao; c.multiplyScalar(p.ao * hi);
    return c;
  };
  M.bladePt = bladePt; M.bladeCol = bladeCol;
  const NS = 28, NV = 20;
  const bladeGeos = [[], []];
  for (let k = 0; k < 6; k++) {
    const g = K.grid(NS, NV, (i, j) => {
      const s = 0.5 - 0.5 * Math.cos((Math.PI * i) / NS), v = Math.sin((Math.PI / 2) * (j / NV)), p = bladePt(k, s, v), c = bladeCol(p);
      return [p.x, p.y, p.z, c.r, c.g, c.b];
    });
    bladeGeos[k % 2].push(g);
  }
  M.bladeEven = K.merge(bladeGeos[0]); M.bladeOdd = K.merge(bladeGeos[1]);

  // ---- body: lathe profile (r, z) in R units ----
  const arc = (cx, cz, r, a0, a1, n) => { const o = []; for (let i = 0; i <= n; i++) { const a = rad(a0 + ((a1 - a0) * i) / n); o.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]); } return o; };
  const prof = [];
  const P = (pts, c) => pts.forEach((p) => prof.push({ r: p[0], z: p[1], c }));
  const gBack = cGraph.clone().multiplyScalar(1.1), gSide = cGraph.clone().multiplyScalar(1.7), gFloor = cInk.clone().multiplyScalar(1.4), gPit = cGraph.clone().multiplyScalar(1.15), gLip = cGraph.clone().multiplyScalar(2.1), gAmb = new THREE.Color('#8a5a14');
  P([[0, Z.back + 0.012], [0.52, Z.back + 0.012]], gBack); P([[0.545, Z.back + 0.004], [0.575, Z.back]], gBack); P([[0.62, Z.back]], gBack); P([[0.628, Z.back + 0.012], [0.662, Z.back + 0.012]], gAmb); P([[0.672, Z.back], [0.9, Z.back]], gBack);
  P(arc(0.96, -0.10, 0.04, -90, 0, 8).slice(0), gSide);
  P([[1.0, 0.0], [1.0, 0.0 + 0.1125]], gSide);
  P(arc(0.9725, 0.1125, 0.0275, 0, 180, 14).slice(1), gLip);
  P([[0.945, 0.1], [0.9, Z.floor]], gFloor);
  P([[0.8, Z.floor], [0.66, Z.floor]], gFloor);
  P(arc(0.632, 0.088, 0.012, 90, 180, 5).slice(0), gFloor);
  P([[0.62, 0.06]], gPit.clone().multiplyScalar(0.8));
  P(arc(0.60, 0.05, 0.02, 0, -90, 5).slice(0), gPit);
  P([[0.4, Z.pit], [0.0, Z.pit]], gPit);
  const lp = prof.map((p) => new THREE.Vector2(p.r, p.z));
  let bg = new THREE.LatheGeometry(lp, 112); bg.rotateX(Math.PI / 2);
  const bcol = new Float32Array(bg.attributes.position.count * 3), np = lp.length;
  for (let i = 0; i < bg.attributes.position.count; i++) { const c = prof[i % np].c; bcol[i * 3] = c.r; bcol[i * 3 + 1] = c.g; bcol[i * 3 + 2] = c.b; }
  bg.setAttribute('color', new THREE.BufferAttribute(bcol, 3)); bg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(bg.attributes.position.count * 2), 2));
  M.body = bg;

  // ---- face plate: rounded play-triangle (circumradius 0.60, corner radius 0.10), pillowed, bevelled ----
  const rc0 = 0.40, rr = 0.10, bev = 0.02, dome = 0.010, MA = 10;
  const ringPts = (d) => {
    const rcc = d <= rr ? rc0 : Math.max(0.0005, rc0 - 2 * (d - rr)), rad_ = Math.max(1e-4, rr - d), out = [];
    for (let c = 0; c < 3; c++) { const th = rad(120 * c), cx = rcc * Math.cos(th), cy = rcc * Math.sin(th); for (let i = 0; i <= MA; i++) { const f = th + rad(-60 + (120 * i) / MA); out.push([cx + rad_ * Math.cos(f), cy + rad_ * Math.sin(f)]); } }
    return out;
  };
  const rings = [{ d: 0, z: Z.pit + 0.02, ao: 0.45 }, { d: 0, z: Z.plateTop - bev, ao: 0.9 }];
  for (let i = 1; i <= 6; i++) { const a = (i / 6) * (Math.PI / 2); rings.push({ d: bev * (1 - Math.cos(a)), z: Z.plateTop - bev + bev * Math.sin(a), ao: 1 }); }
  for (const d of [0.045, 0.085, 0.13, 0.18, 0.23, 0.275]) rings.push({ d, z: Z.plateTop + dome * sstep(bev, 0.3, d), ao: 1 });
  M.plateTop = Z.plateTop; M.plateZ = (d) => Z.plateTop + dome * sstep(bev, 0.3, d);
  const NP = 3 * (MA + 1), nR = rings.length, verts = [], colr = [], idx = [];
  rings.forEach((rg) => { ringPts(rg.d).forEach((p) => { verts.push(p[0], p[1], rg.z); const c = cCream.clone().multiplyScalar(rg.ao); colr.push(c.r, c.g, c.b); }); });
  verts.push(0, 0, Z.plateTop + dome); colr.push(cCream.r, cCream.g, cCream.b);
  for (let r = 0; r < nR - 1; r++) for (let i = 0; i < NP; i++) { const a = r * NP + i, b = r * NP + ((i + 1) % NP), c = (r + 1) * NP + ((i + 1) % NP), d = (r + 1) * NP + i; idx.push(a, b, c, a, c, d); }
  for (let i = 0; i < NP; i++) idx.push((nR - 1) * NP + i, (nR - 1) * NP + ((i + 1) % NP), nR * NP);
  let pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); pg.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3)); pg.setIndex(idx); pg.computeVertexNormals();
  { let sz = 0; for (let i = 0; i < pg.attributes.normal.count; i++) sz += pg.attributes.normal.array[i * 3 + 2]; if (sz < 0) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } pg.setIndex(idx); pg.computeVertexNormals(); } }
  pg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(pg.attributes.position.count * 2), 2));
  M.plate = pg; M.plateOutline = ringPts(0);
  { const parts_ = [], Rr = 0.585, ap = Rr * Math.cos(rad(30)), th = 0.011, c0 = new THREE.Color(pal.amber).multiplyScalar(1.15);
    for (let e = 0; e < 6; e++) { const b = K.paint(new THREE.BoxGeometry(Rr + th, th, 0.009), c0); b.translate(0, ap, Z.pit + 0.014); b.rotateZ(rad(60 * e + 0)); parts_.push(b); }
    M.hexRing = K.merge(parts_); }

  // ---- deterministic particle cloud sampling the silhouette ----
  M.sample = (N = 1) => {
    const r = makeRng(7771), out = [];
    const push = (x, y, z, c, sz, w = 1) => out.push({ x, y, z, c, sz, w });
    for (let k = 0; k < 6; k++) for (let i = 0; i < Math.round(560 * N); i++) { const p = bladePt(k, r(), Math.sqrt(r())); if (p.d < 0.012) continue; const c = bladeCol(p).multiplyScalar(0.95); push(p.x, p.y, p.z + 0.01, c, 0.8 + r() * 0.7); }
    // blade rims (outlines glow)
    for (let k = 0; k < 6; k++) for (let i = 0; i < Math.round(110 * N); i++) { const s = r(), p = bladePt(k, s, 1), c = cAmb.clone().multiplyScalar(1.3); push(p.x, p.y, p.z + 0.01, c, 0.7 + r() * 0.5); }
    // face plate
    const poly = M.plateOutline, inside = (x, y) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
    for (let n = 0, g = 0; n < Math.round(2600 * N) && g < 60000; g++) { const x = lerp(-0.32, 0.52, r()), y = lerp(-0.54, 0.54, r()); if (!inside(x, y)) continue; n++; push(x, y, Z.plateTop + 0.012 + r() * 0.02, cCream.clone().multiplyScalar(1.5), 0.9 + r() * 0.8, 1.3); }
    for (let i = 0; i < Math.round(420 * N); i++) { const q = poly[Math.floor(r() * poly.length)]; push(q[0], q[1], Z.plateTop - 0.01 + r() * 0.03, cCream.clone().multiplyScalar(2.0), 0.9 + r() * 0.6, 1.2); }
    // bezel ring + side
    for (let i = 0; i < Math.round(1000 * N); i++) { const a = r() * TAU, rr_ = lerp(0.95, 0.995, r()); push(rr_ * Math.cos(a), rr_ * Math.sin(a), Z.lip, new THREE.Color('#8B7DFF').multiplyScalar(0.75), 0.8 + r() * 0.6); }
    for (let i = 0; i < Math.round(700 * N); i++) { const a = r() * TAU; push(Math.cos(a), Math.sin(a), lerp(Z.back, 0.1, r()), new THREE.Color('#6B5BFF').multiplyScalar(0.5), 0.7 + r() * 0.5, 0.8); }
    // hex opening
    for (let i = 0; i < Math.round(360 * N); i++) { const e = Math.floor(r() * 6), f = r(), a0 = rad(60 * e), a1 = rad(60 * (e + 1)); const x = lerp(Rh * Math.cos(a0), Rh * Math.cos(a1), f), y = lerp(Rh * Math.sin(a0), Rh * Math.sin(a1), f); push(x, y, Z.bladeBase + 0.02, cAmb.clone().multiplyScalar(1.7), 0.8 + r() * 0.5); }
    return out;
  };
  MODEL.get(THREE).set(pkey, M);
  return M;
}

// ------------------------------------------------------------------------------------------------------------------------
// Shaders
// ------------------------------------------------------------------------------------------------------------------------
const HOLO_VS = `varying vec3 vN; varying vec3 vV; varying vec3 vW; varying vec3 vC;
void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = -mv.xyz; vW = (modelMatrix * vec4(position,1.0)).xyz; vC = color; gl_Position = projectionMatrix * mv; }`;
const HOLO_FS = `varying vec3 vN; varying vec3 vV; varying vec3 vW; varying vec3 vC; uniform vec3 uTint; uniform float uAlpha, uTime;
void main(){
  vec3 n = normalize(vN), v = normalize(vV); float f = pow(1.0 - abs(dot(n, v)), 2.2);
  float lum = dot(vC, vec3(0.30, 0.55, 0.15));
  float scan = 0.5 + 0.5 * sin(vW.y * 150.0 + uTime * 5.0); scan = mix(0.5, 1.0, smoothstep(0.15, 0.85, scan));
  float sweep = smoothstep(0.93, 1.0, sin(vW.y * 7.0 - uTime * 1.6)) * 0.55;
  float flick = 0.94 + 0.06 * sin(uTime * 43.0 + vW.y * 9.0);
  float edge = clamp(length(fwidth(n)) * 7.0, 0.0, 1.0);
  vec3 col = uTint * (0.05 + 0.5 * lum + 2.0 * f + sweep * 0.8 + edge * 1.6) * scan * flick + vec3(0.55, 0.85, 0.95) * (f * f * 0.5 + edge * 0.35);
  gl_FragColor = vec4(col, uAlpha);
}`;
const PT_VS = `attribute vec4 aRnd; attribute float aSize; uniform float uTime, uForm, uSize, uViewH, uSpread, uDrift; varying vec3 vCol; varying float vTw;
void main(){
  float f = clamp(uForm * 1.45 - aRnd.x * 0.45, 0.0, 1.0); f = f * f * (3.0 - 2.0 * f);
  float th = aRnd.y * 6.2831853, cp = 2.0 * aRnd.z - 1.0, sp = sqrt(1.0 - cp * cp);
  vec3 dir = vec3(sp * cos(th), sp * sin(th), cp);
  float rr = uSpread * (0.35 + 1.65 * aRnd.w);
  vec3 sc = dir * rr + 0.16 * vec3(sin(uTime * 0.5 + aRnd.x * 40.0), cos(uTime * 0.4 + aRnd.y * 40.0), sin(uTime * 0.3 + aRnd.z * 40.0));
  float a = uTime * 0.35 * (1.0 - f); float ca = cos(a), sa = sin(a); sc.xz = mat2(ca, -sa, sa, ca) * sc.xz;
  vec3 p = mix(sc, position, f);
  p += uDrift * (1.0 - 0.7 * f) * vec3(sin(uTime * 1.7 + aRnd.x * 30.0), sin(uTime * 1.3 + aRnd.y * 30.0), sin(uTime * 1.9 + aRnd.z * 30.0));
  vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
  vTw = 0.72 + 0.28 * sin(uTime * (2.5 + aRnd.w * 4.0) + aRnd.x * 40.0);
  gl_PointSize = max(1.5, uSize * aSize * (0.65 + 0.35 * vTw) * uViewH * 0.5 * projectionMatrix[1][1] / max(-mv.z, 0.05));
  vCol = color;
}`;
const PT_FS = `varying vec3 vCol; varying float vTw; uniform float uAlpha;
void main(){ vec2 c = gl_PointCoord * 2.0 - 1.0; float d = dot(c, c); if (d > 1.0) discard; float a = exp(-d * 3.2) * (1.0 - d * d); gl_FragColor = vec4(vCol * a * (0.8 + 0.4 * vTw) * uAlpha, 1.0); }`;
const SLATE_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SLATE_FS = `varying vec2 vUv; uniform float uT, uGlow;
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  vec2 uv = vUv; vec2 p = (uv - 0.5) * vec2(0.72, 1.0) * 2.0;
  vec3 col = mix(vec3(0.03, 0.02, 0.13), vec3(0.17, 0.10, 0.50), smoothstep(0.0, 1.0, uv.y) * 0.75);
  vec2 g = abs(fract(uv * vec2(8.0, 11.0)) - 0.5); col += vec3(0.3, 0.35, 1.0) * smoothstep(0.46, 0.5, max(g.x, g.y)) * 0.07;
  vec2 c = p - vec2(0.0, 0.16); float r = length(c);
  float ring = 0.0; for (int i = 0; i < 3; i++) { float ph = fract(uT * 0.45 + float(i) / 3.0); float rr = 0.12 + ph * 0.58; ring += smoothstep(0.035, 0.0, abs(r - rr)) * (1.0 - ph); }
  float core = exp(-r * r * 16.0) * 1.7, nodes = 0.0, lines = 0.0; vec2 prev = vec2(0.0);
  for (int i = 0; i < 7; i++) {
    float fi = float(i); float a = fi * 0.8976 + uT * (0.25 + 0.05 * fi); float rad = 0.2 + 0.09 * sin(fi * 2.3 + uT * 0.6) + 0.15 * fract(fi * 0.37);
    vec2 np = vec2(cos(a), sin(a)) * rad; nodes += exp(-dot(c - np, c - np) * 800.0) * 1.6;
    vec2 pa = c - np, ba = -np; float hh = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); lines += smoothstep(0.011, 0.0, length(pa - ba * hh)) * (0.35 + 0.25 * sin(uT * 3.0 + fi));
    if (i > 0) { vec2 pb = c - prev, bb = np - prev; float h2 = clamp(dot(pb, bb) / dot(bb, bb), 0.0, 1.0); lines += smoothstep(0.008, 0.0, length(pb - bb * h2)) * 0.28; }
    prev = np;
  }
  float bars = 0.0; if (uv.y > 0.05 && uv.y < 0.22) { float bi = floor(uv.x * 18.0); float hg = 0.03 + 0.1 * h21(vec2(bi, floor(uT * 6.0 + bi))); float fx = fract(uv.x * 18.0); bars = step(uv.y, 0.05 + hg) * step(0.15, fx) * step(fx, 0.85); }
  float top = step(0.925, uv.y) * step(0.06, uv.x) * step(uv.x, 0.94); float prog = top * 0.3 + top * step(uv.x, 0.06 + 0.88 * fract(uT * 0.12)) * 0.8;
  vec3 cV = vec3(0.42, 0.36, 1.0), cS = vec3(0.49, 0.77, 1.0), cC = vec3(1.0, 0.95, 0.84), cA = vec3(1.0, 0.71, 0.18);
  col += cV * (ring * 1.5 + lines * 1.3) + cS * bars * 0.95 + cC * (core + nodes) + cA * prog;
  float sw = smoothstep(0.03, 0.0, abs(fract(uT * 0.3) * 1.5 - 0.25 - uv.y)); col += cS * sw * 0.3;
  float e = smoothstep(0.0, 0.07, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y))); col *= 0.62 + 0.38 * e;
  col *= 0.5 + 1.0 * uGlow; gl_FragColor = vec4(col, 1.0);
}`;
const HALO_FS = `varying vec2 vUv; uniform vec3 uCol; uniform float uK; void main(){ vec2 c = vUv - 0.5; float r2 = dot(c, c) * 4.0; gl_FragColor = vec4(uCol * exp(-r2 * 5.5) * uK, 1.0); }`;

// tiny studio environment (dark room + a few HDR softboxes) -> PMREM; one per renderer
const ENVS = new WeakMap();
function studioEnv(THREE, renderer) {
  if (ENVS.has(renderer)) return ENVS.get(renderer);
  const sc = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(24, 24, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.012, 0.012, 0.018), side: THREE.BackSide })); sc.add(room);
  const panel = (w, h, x, y, z, c, ry = 0, rx = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); m.lookAt(0, 0, 0); sc.add(m); };
  panel(7, 4.5, 0, 9, 1.5, new THREE.Color(5.0, 4.7, 4.3));        // top softbox
  panel(1.2, 8, -9, 1.5, 2, new THREE.Color(5.5, 6.2, 7.5));      // cool key strip (left)
  panel(3, 5, 9, 0.5, 3, new THREE.Color(3.4, 2.5, 1.5));         // warm fill (right)
  panel(1, 7, -4, 2, -9, new THREE.Color(7, 8, 9.5));             // rim strips (back)
  panel(1, 7, 5, 2, -9, new THREE.Color(8, 6.5, 5.5));
  panel(10, 3, 0, -9, 2, new THREE.Color(0.35, 0.3, 0.4));        // floor bounce
  const pm = new THREE.PMREMGenerator(renderer); const tex = pm.fromScene(sc, 0.03, 0.1, 60).texture; pm.dispose();
  room.geometry.dispose(); ENVS.set(renderer, tex); return tex;
}

// ------------------------------------------------------------------------------------------------------------------------
// createAmrita
// ------------------------------------------------------------------------------------------------------------------------
const EXPR = Object.freeze({
  neutral: {}, happy: { happy: 1 }, determined: { determined: 1 }, surprised: { surprised: 1 }, squint: { squint: 1 }, sleepy: { sleepy: 1 }, blink: { open: 0 },
  wink: { wink: 1 }, worried: { determined: -1 }, angry: { determined: 1, squint: 0.35 },
});
const EYE0 = () => ({ open: 1, squint: 0, happy: 0, determined: 0, surprised: 0, sleepy: 0, wink: 0, lookX: 0, lookY: 0 });
export { EXPR };

export function createAmrita(THREE, { style = 'solid', palette = {}, glowLight = false, env = true } = {}) {
  const pal = { vermilion: '#F2542D', amber: '#FFB62E', cream: '#FFF3D6', ink: '#0E0D12', teal: '#1FB5A6', violet: '#6B5BFF', sky: '#7CC4FF', graphite: '#2A2833', ...palette };
  const M = buildModel(THREE, pal), K = M.K, C = K.col;
  const root = new THREE.Group(); root.name = 'amrita';
  const body = new THREE.Group(); body.name = 'amrita-body'; root.add(body);
  const rg = new THREE.Group(); rg.name = 'amrita-model'; rg.scale.setScalar(R); body.add(rg);   // model is authored in R units
  const parts = []; const reg = (mesh, kind = 'prop', mat = mesh.material) => { parts.push({ mesh, kind, mat }); return mesh; };
  const phys = [];                                                                            // every PBR material (env intensity etc.)

  // ---------- materials ----------
  const ghostU = { value: 0 };
  const ghostHook = (sh) => {
    sh.uniforms.uGhost = ghostU;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uGhost;')
      .replace('#include <opaque_fragment>', 'float gF = pow(1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), 1.7); diffuseColor.a *= mix(1.0, 0.2 + 0.8 * gF, uGhost); outgoingLight = mix(outgoingLight, outgoingLight * 1.25 + gF * vec3(0.45, 0.75, 0.85) * 0.9, uGhost);\n#include <opaque_fragment>');
  };
  const solid = (p) => { const m = new THREE.MeshPhysicalMaterial({ color: '#ffffff', vertexColors: true, ...p }); m.onBeforeCompile = ghostHook; m.customProgramCacheKey = () => 'a3d-solid'; phys.push(m); return m; };
  const mats = {
    blade: solid({ roughness: 0.27, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1 }),
    bladeAlt: solid({ roughness: 0.3, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.12 }),
    body: solid({ roughness: 0.38, metalness: 0.5, clearcoat: 0.55, clearcoatRoughness: 0.22 }),
    face: solid({ roughness: 0.32, metalness: 0.0, clearcoat: 0.9, clearcoatRoughness: 0.14, emissive: pal.cream, emissiveIntensity: 0.3 }),
    plastic: solid({ roughness: 0.42, metalness: 0.0, clearcoat: 0.75, clearcoatRoughness: 0.22 }),
    metal: solid({ roughness: 0.3, metalness: 0.9, clearcoat: 0.25, clearcoatRoughness: 0.2 }),
  };
  mats.eye = new THREE.MeshPhysicalMaterial({ color: '#050408', roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, ior: 1.6, specularIntensity: 1 });
  mats.eye.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aGl; varying vec3 vGl;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGl = vec3(uv, aGl);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vGl;').replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
    { vec2 p = vGl.xy; vec2 d1 = (p - vec2(-0.36, 0.5)) / vec2(0.2, 0.17); float g1 = smoothstep(1.0, 0.5, dot(d1, d1));
      vec2 d2 = (p - vec2(0.4, -0.52)) / vec2(0.1, 0.08); float g2 = smoothstep(1.0, 0.55, dot(d2, d2)) * 0.55;
      totalEmissiveRadiance += vec3(3.2) * (g1 + g2) * vGl.z; }`);
  };
  mats.eye.customProgramCacheKey = () => 'a3d-eye'; phys.push(mats.eye);
  mats.glow = new THREE.MeshBasicMaterial({ color: '#ffffff', vertexColors: true, toneMapped: false });
  const holoMat = new THREE.ShaderMaterial({
    vertexShader: HOLO_VS, fragmentShader: HOLO_FS, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
    uniforms: { uTint: { value: new THREE.Color() }, uAlpha: { value: 0.55 }, uTime: { value: 0 } },
  });
  const timeU = holoMat.uniforms.uTime;

  // ---------- body, blades, face plate ----------
  const mBody = new THREE.Mesh(M.body, mats.body); rg.add(reg(mBody, 'body'));
  const mBladeE = new THREE.Mesh(M.bladeEven, mats.blade), mBladeO = new THREE.Mesh(M.bladeOdd, mats.bladeAlt); rg.add(reg(mBladeE, 'body'), reg(mBladeO, 'body'));
  const mFace = new THREE.Mesh(M.plate, mats.face); rg.add(reg(mFace, 'body'));
  const mRing = new THREE.Mesh(M.hexRing, mats.glow); rg.add(reg(mRing, 'bodyEmit'));
  for (const m of [mBody, mBladeE, mBladeO, mFace]) m.castShadow = true;

  // ---------- eyes: morphing sausage meshes ----------
  const NC = 24, NR = 14, EX = -0.08, EY = [0.17, -0.17], EZ = M.plateTop + 0.0025, DMAX = 0.05;
  const NV = 2 + (NC - 1) * (NR + 1), colXi = [], cosPsi = [], sinPsi = [];
  for (let i = 0; i <= NC; i++) colXi.push(-Math.cos((Math.PI * i) / NC));
  for (let j = 0; j <= NR; j++) { cosPsi.push(Math.cos((Math.PI * j) / NR)); sinPsi.push(Math.sin((Math.PI * j) / NR)); }
  const eyeIdx = []; {
    const vid = (i, j) => 1 + (i - 1) * (NR + 1) + j, pL = 0, pR = NV - 1;
    for (let j = 0; j < NR; j++) eyeIdx.push(pL, vid(1, j + 1), vid(1, j));
    for (let i = 1; i < NC - 1; i++) for (let j = 0; j < NR; j++) { const a = vid(i, j), b = vid(i + 1, j), c = vid(i + 1, j + 1), d = vid(i, j + 1); eyeIdx.push(a, d, c, a, c, b); }
    for (let j = 0; j < NR; j++) eyeIdx.push(pR, vid(NC - 1, j), vid(NC - 1, j + 1));
  }
  const mkEye = (e) => {
    const g = new THREE.BufferGeometry(), pos = new Float32Array(NV * 3), uv = new Float32Array(NV * 2), gl = new Float32Array(NV);
    uv[0] = -1; uv[1] = 0; uv[(NV - 1) * 2] = 1; uv[(NV - 1) * 2 + 1] = 0;
    for (let i = 1; i < NC; i++) for (let j = 0; j <= NR; j++) { const o = 1 + (i - 1) * (NR + 1) + j; uv[o * 2] = colXi[i]; uv[o * 2 + 1] = cosPsi[j]; }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(NV * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('aGl', new THREE.BufferAttribute(gl, 1)); g.setIndex(eyeIdx);
    const m = new THREE.Mesh(g, mats.eye); m.frustumCulled = false; m.castShadow = false; m.name = 'amrita-eye-' + e; rg.add(reg(m, 'eye')); return { m, g, pos, gl, e };
  };
  const E = [mkEye(0), mkEye(1)];
  const eyeState = EYE0();
  let eyeKey = '', eyeFlip = false;
  function evalEye(e, s, xi, out) {
    const hpw = (s.wink > 0 && e === 0) || (s.wink < 0 && e === 1) ? Math.abs(s.wink) : 0, hp = clamp(Math.max(s.happy, hpw));
    const sur = clamp(s.surprised), sq = clamp(s.squint), sl = clamp(s.sleepy), det = clamp(s.determined, -1, 1);
    const w = lerp(lerp(0.075 + 0.012 * sq, 0.102, sur), 0.092, hp), h0 = lerp(0.125, 0.122, sur), op = Math.max(0.07, s.open) * (1 - 0.5 * sq), hh = h0 * op;
    const c = Math.sqrt(Math.max(0, 1 - xi * xi));
    let top = hh * c, bot = -hh * c;
    if (sq > 0) bot = Math.max(bot, -hh * c * (1 - 0.35 * sq) + 0.22 * sq * hh * (1 - xi * xi));
    if (sl > 0) top = Math.min(top, hh * (1 - 0.95 * sl) - 0.12 * hh * sl * xi);
    if (det !== 0) { const a = Math.abs(det); top = Math.min(top, hh * (lerp(1.8, 0.5, a) - Math.sign(det) * lerp(0, 0.62, a) * xi)); }
    if (hp > 0) {
      const ych = 0.066 * (1 - xi * xi) - 0.033, tk = 0.027 * Math.pow(c, 0.7) * (0.45 + 0.55 * Math.min(1, op));
      top = lerp(top, ych + tk, hp); bot = lerp(bot, ych - tk, hp);
    }
    if (top < bot + 0.005) { const m = (top + bot) / 2; top = m + 0.0025; bot = m - 0.0025; }
    const t = (top - bot) / 2, vis = clamp(t / (h0 * c + 1e-4), 0.05, 1);
    out.x = EX + s.lookX * 0.032 + xi * w; out.yc = EY[e] + s.lookY * 0.03 - 0.014 * sl + (top + bot) / 2; out.t = t;
    out.D = DMAX * Math.pow(c, 0.9) * lerp(1, 0.6, hp) * (0.45 + 0.55 * vis);
    out.gl = clamp((op - 0.5) * 2.2) * (1 - hp) * (1 - 0.5 * sq) * (1 - 0.6 * sl);
  }
  const _o = { x: 0, yc: 0, t: 0, D: 0, gl: 0 };
  function applyEyes() {
    const s = eyeState, key = [s.open, s.squint, s.happy, s.determined, s.surprised, s.sleepy, s.wink, s.lookX, s.lookY].map((v) => Math.round(v * 5000)).join(',');
    if (key === eyeKey) return; eyeKey = key;
    for (const E_ of E) {
      const { pos, gl, e } = E_; let o = 0;
      evalEye(e, s, -1, _o); pos[0] = _o.x; pos[1] = _o.yc; pos[2] = EZ; gl[0] = 0;
      for (let i = 1; i < NC; i++) {
        evalEye(e, s, colXi[i], _o);
        for (let j = 0; j <= NR; j++) { o = 1 + (i - 1) * (NR + 1) + j; pos[o * 3] = _o.x; pos[o * 3 + 1] = _o.yc + _o.t * cosPsi[j]; pos[o * 3 + 2] = EZ + _o.D * sinPsi[j]; gl[o] = _o.gl; }
      }
      evalEye(e, s, 1, _o); pos[(NV - 1) * 3] = _o.x; pos[(NV - 1) * 3 + 1] = _o.yc; pos[(NV - 1) * 3 + 2] = EZ; gl[NV - 1] = 0;
      E_.g.attributes.position.needsUpdate = true; E_.g.attributes.aGl.needsUpdate = true; E_.g.computeVertexNormals();
      if (!eyeFlip && e === 0) { // orient once: normals must face +z
        let sz = 0; const na = E_.g.attributes.normal.array; for (let i = 0; i < NV; i++) sz += na[i * 3 + 2];
        if (sz < 0) { eyeFlip = true; for (const E2 of E) { const ix = E2.g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } E2.g.index.needsUpdate = true; } E_.g.computeVertexNormals(); }
      }
      E_.g.computeBoundingSphere();
    }
  }
  const blend = (a, b, k) => { const A_ = typeof a === 'string' ? { ...EYE0(), ...EXPR[a] } : { ...EYE0(), ...a }, B_ = typeof b === 'string' ? { ...EYE0(), ...EXPR[b] } : { ...EYE0(), ...b }; const o = {}; for (const key in A_) o[key] = lerp(A_[key], B_[key], k); return o; };

  // ---------- props (floating at her right; authored in metres, +Z forward, +Y up) ----------
  const propRoot = new THREE.Group(); propRoot.position.set(R * 1.45, -R * 0.1, R * 0.25); root.add(propRoot);
  const props = {}; let curProp = null, curKind = null;
  const mk = (geo, mat, kind = 'prop') => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; reg(m, kind, mat); return m; };
  const col = { amber: '#FFB62E', verm: '#F2542D', cream: '#FFF3D6', graph: '#2A2833', gun: '#3d3a49', ink: '#0E0D12', steel: '#9a98a8', violet: '#6B5BFF', sky: '#7CC4FF', teal: '#1FB5A6' };
  const emitMat = () => new THREE.MeshBasicMaterial({ color: '#ffffff', vertexColors: true, toneMapped: false });
  const addMat = (extra = {}) => new THREE.MeshBasicMaterial({ color: '#ffffff', vertexColors: true, toneMapped: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, ...extra });
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  // light ribbon (two crossed quads per segment) that is rewritten each frame from a pure path function
  const makeTrail = (N) => {
    const g = new THREE.BufferGeometry(), pos = new Float32Array(N * 12), cl = new Float32Array(N * 12), idx = [];
    for (let i = 0; i < N - 1; i++) { const a = i * 4, b = (i + 1) * 4; idx.push(a, a + 1, b, a + 1, b + 1, b, a + 2, a + 3, b + 2, a + 3, b + 3, b + 2); }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(cl, 3)); g.setIndex(idx);
    const m = new THREE.Mesh(g, addMat()); m.frustumCulled = false; reg(m, 'emit');
    const t1 = V3(), n1 = V3(), n2 = V3(), z = V3(0, 0, 1), y = V3(0, 1, 0);
    return {
      m, N,
      write(pts, bright, width, rgb) { // pts: array of Vector3
        for (let i = 0; i < N; i++) {
          const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(N - 1, i + 1)];
          t1.subVectors(b, a); if (t1.lengthSq() < 1e-10) t1.set(1, 0, 0); t1.normalize();
          n1.crossVectors(t1, Math.abs(t1.z) > 0.95 ? y : z).normalize(); n2.crossVectors(t1, n1).normalize();
          const w = width[i], br = bright[i];
          for (let k = 0; k < 4; k++) {
            const o = (i * 4 + k) * 3, n_ = k < 2 ? n1 : n2, sg = k % 2 ? 1 : -1;
            pos[o] = p.x + n_.x * w * sg; pos[o + 1] = p.y + n_.y * w * sg; pos[o + 2] = p.z + n_.z * w * sg;
            cl[o] = rgb[0] * br; cl[o + 1] = rgb[1] * br; cl[o + 2] = rgb[2] * br;
          }
        }
        g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
      },
    };
  };
  const tipOf = {};
  { // ---- hand-crank camera (profile view, lens toward +X) ----
    const g = new THREE.Group();
    const plastic = K.merge([K.rbox(0.30, 0.19, 0.16, 0.02, col.gun, 0.008), K.xf(K.rbox(0.022, 0.15, 0.17, 0.006, col.amber, 0.004), { pos: [0.152, 0, 0] }), K.cyl(0.041, 0.041, 0.008, '#0d1426', { axis: 'x', pos: [0.268, 0, 0] }), K.sph(0.0105, col.verm, [-0.12, 0.062, 0.081]), K.rbox(0.05, 0.012, 0.05, 0.004, col.graph, 0.003)]);
    const metal = K.merge([K.cyl(0.05, 0.05, 0.07, col.steel, { axis: 'x', pos: [0.205, 0, 0] }), K.tor(0.05, 0.0075, col.amber, { axis: 'x', pos: [0.25, 0, 0] }), K.cyl(0.062, 0.062, 0.02, col.amber, { axis: 'x', pos: [0.168, 0, 0] }), K.cyl(0.013, 0.013, 0.045, col.steel, { axis: 'z', pos: [-0.1, -0.005, 0.098] }), K.cyl(0.011, 0.011, 0.04, col.steel, { axis: 'z', pos: [-0.055, 0.15, 0] }), K.cyl(0.011, 0.011, 0.04, col.steel, { axis: 'z', pos: [0.078, 0.15, 0] })]);
    const reelShape = () => { const s = new THREE.Shape(); s.absarc(0, 0, 0.062, 0, TAU, false); for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU + 0.3, h = new THREE.Path(); h.absarc(Math.cos(a) * 0.038, Math.sin(a) * 0.038, 0.0158, 0, TAU, true); s.holes.push(h); } return s; };
    const reelGeo = K.ext(reelShape(), 0.014, 0.003, col.amber, 3, 32);
    const reelA = mk(reelGeo, mats.metal), reelB = mk(reelGeo, mats.metal); reelA.position.set(-0.055, 0.15, 0); reelB.position.set(0.078, 0.15, 0);
    const crank = new THREE.Group(); crank.position.set(-0.1, -0.005, 0.082);
    const crankGeo = K.merge([K.rbox(0.078, 0.014, 0.01, 0.005, col.amber, 0.003).translate(0.039, 0, 0.004), K.cyl(0.012, 0.012, 0.03, col.verm, { axis: 'z', pos: [0.076, 0, 0.02] })]);
    crank.add(mk(crankGeo, mats.plastic));
    g.add(mk(plastic, mats.plastic), mk(metal, mats.metal), reelA, reelB, crank);
    const tip = new THREE.Object3D(); tip.position.set(0.28, 0, 0); g.add(tip); tipOf.crank = tip;
    props.crank = { g, anim: (o, t) => { const a = o.crank ?? t * 8; crank.rotation.z = -a; reelA.rotation.z = reelB.rotation.z = -a * 0.45; g.rotation.y = 0; } };
  }
  { // ---- megaphone (bell toward +X) ----
    const g = new THREE.Group(); const ptsO = [], ptsI = [], cs = [];
    const rOut = (y) => 0.034 + 0.117 * Math.pow((y + 0.14) / 0.34, 1.75);
    const N = 22; for (let i = 0; i <= N; i++) { const y = -0.14 + (0.34 * i) / N; ptsO.push([rOut(y), y]); }
    const lp = []; lp.push([0.02, -0.15]); ptsO.forEach((p) => lp.push(p)); for (let i = 1; i <= 6; i++) { const a = (i / 6) * Math.PI; lp.push([ptsO[N][0] - 0.0035 + Math.cos(a) * 0.0035, 0.2 + Math.sin(a) * 0.0035]); }
    for (let i = N; i >= 0; i--) { const y = -0.14 + (0.34 * i) / N; lp.push([rOut(y) - 0.007, y]); }
    const lg = new THREE.LatheGeometry(lp.map((p) => new THREE.Vector2(p[0], p[1])), 56); const cArr = new Float32Array(lg.attributes.position.count * 3), np = lp.length;
    const cV = C(col.verm), cC = C(col.cream), cI = C('#2c1d24');
    for (let i = 0; i < lg.attributes.position.count; i++) { const j = i % np, p = lp[j], inner = j > N + 7; const band = !inner && p[1] > 0.085 && p[1] < 0.125; const c = inner ? cI : band ? cC : cV; cArr[i * 3] = c.r; cArr[i * 3 + 1] = c.g; cArr[i * 3 + 2] = c.b; }
    lg.setAttribute('color', new THREE.BufferAttribute(cArr, 3)); lg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(lg.attributes.position.count * 2), 2));
    const shell = K.merge([lg, K.xf(K.rbox(0.034, 0.085, 0.036, 0.012, col.graph, 0.004), { pos: [0.052, -0.05, 0], rot: [0, 0, 0.18] }), K.xf(K.rbox(0.014, 0.03, 0.02, 0.004, col.amber, 0.002), { pos: [0.04, -0.01, 0], rot: [0, 0, 0.3] })]);
    const metal = K.merge([K.tor(0.1535, 0.0085, col.amber, { axis: 'y', pos: [0, 0.2, 0] }), K.cyl(0.036, 0.036, 0.05, col.graph, { pos: [0, -0.165, 0] }), K.tor(0.037, 0.005, col.steel, { axis: 'y', pos: [0, -0.14, 0] })]);
    const sh = mk(shell, mats.plastic), me = mk(metal, mats.metal);
    const holder = new THREE.Group(); holder.add(sh, me); holder.rotation.z = -Math.PI / 2; g.add(holder);
    // sound arcs (visible while speaking)
    const arcs = [0, 1, 2].map(() => { const m = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.0075, 6, 28, rad(86)), new THREE.MeshBasicMaterial({ color: pal.amber, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })); m.geometry.rotateZ(-rad(43)); m.visible = false; reg(m, 'emit'); g.add(m); return m; });
    const tip = new THREE.Object3D(); tip.position.set(0.21, 0, 0); g.add(tip); tipOf.megaphone = tip;
    props.megaphone = { g, anim: (o, t) => { const sp = o.speak ?? 0; arcs.forEach((a, i) => { const ph = ((t * 1.7 + i / 3) % 1 + 1) % 1, k = 0.5 + ph * 1.5; a.visible = sp > 0.01; a.position.set(0.2, 0, 0); a.scale.setScalar(k); a.material.opacity = sp * (1 - ph) * (1 - ph) * 0.9; }); g.rotation.z = 0.12; } };
  }
  { // ---- viewfinder: director's frame with glowing brackets ----
    const g = new THREE.Group(), W = 0.36, H = 0.23, w2 = 0.31, h2 = 0.18;
    const outer = K.rrShape(W, H, 0.03), hole = new THREE.Path(), r = 0.015, x = -w2 / 2, y = -h2 / 2;
    hole.moveTo(x + r, y); hole.lineTo(x + w2 - r, y); hole.absarc(x + w2 - r, y + r, r, -Math.PI / 2, 0, false); hole.lineTo(x + w2, y + h2 - r); hole.absarc(x + w2 - r, y + h2 - r, r, 0, Math.PI / 2, false); hole.lineTo(x + r, y + h2); hole.absarc(x + r, y + h2 - r, r, Math.PI / 2, Math.PI, false); hole.lineTo(x, y + r); hole.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
    outer.holes.push(hole);
    const frame = K.merge([K.ext(outer, 0.034, 0.006, col.amber, 4, 20), K.xf(K.rbox(0.058, 0.115, 0.05, 0.016, col.graph, 0.005), { pos: [0.1, -0.165, 0], rot: [0, 0, 0.12] }), K.xf(K.rbox(0.034, 0.02, 0.05, 0.006, col.verm, 0.003), { pos: [-0.095, -0.108, 0] })]);
    const metalFrame = mk(frame, mats.metal);
    const e = [], T_ = 0.0075, L = 0.05, ix = w2 / 2 - 0.012, iy = h2 / 2 - 0.012, hot = [C(col.cream).multiplyScalar(1.5)];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) { e.push(K.paint(new THREE.BoxGeometry(L, T_, 0.006), hot[0]).translate(sx * (ix - L / 2), sy * iy, 0.01), K.paint(new THREE.BoxGeometry(T_, L, 0.006), hot[0]).translate(sx * ix, sy * (iy - L / 2), 0.01)); }
    e.push(K.paint(new THREE.BoxGeometry(0.036, 0.004, 0.004), C(col.sky).multiplyScalar(2)).translate(0, 0, 0.01), K.paint(new THREE.BoxGeometry(0.004, 0.036, 0.004), C(col.sky).multiplyScalar(2)).translate(0, 0, 0.01));
    const fx = 0.05, fy = 0.034; for (const [a, b, c_, d] of [[0, fy, fx * 2, 0.003], [0, -fy, fx * 2, 0.003], [fx, 0, 0.003, fy * 2], [-fx, 0, 0.003, fy * 2]]) e.push(K.paint(new THREE.BoxGeometry(c_, d, 0.004), C(col.cream).multiplyScalar(1.6)).translate(a, b, 0.01));
    const brackets = mk(K.merge(e), mats.glow, 'emit');
    const recMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }); const rec = mk(new THREE.SphereGeometry(0.0105, 14, 10), recMat, 'emit'); rec.position.set(-ix + 0.012, iy - 0.052 + 0.0, 0.012);
    const glassMat = new THREE.MeshBasicMaterial({ color: pal.teal, transparent: true, opacity: 0.075, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const glass = mk(new THREE.PlaneGeometry(w2, h2), glassMat, 'emit');
    g.add(metalFrame, brackets, rec, glass);
    const tip = new THREE.Object3D(); tip.position.set(0, 0, 0.02); g.add(tip); tipOf.viewfinder = tip;
    props.viewfinder = { g, anim: (o, t) => { const on = ((t * 0.9) % 1 + 1) % 1 < 0.62 ? 1 : 0.18; recMat.color.setRGB(3.2 * on, 0.45 * on, 0.25 * on); g.rotation.z = 0.04; } };
  }
  { // ---- clapperboard with a real hinged clap ----
    const g = new THREE.Group(), SW = 0.34, hing = [-SW / 2, 0.15];
    const stripes = (y0, h, phase) => { const out = [], n = 7, w = SW / n; for (let i = 0; i < n; i++) { const c = (i + phase) % 2 ? col.cream : col.graph, sh = new THREE.Shape(), x0 = -SW / 2 + i * w, sk = h * 0.9; sh.moveTo(x0, y0 - h / 2); sh.lineTo(x0 + w, y0 - h / 2); sh.lineTo(x0 + w + sk * 0.5, y0 + h / 2); sh.lineTo(x0 + sk * 0.5, y0 + h / 2); sh.closePath(); out.push(K.ext(sh, 0.026, 0.003, c, 2, 4)); } return out; };
    const chalk = (x0, y0, w, h) => K.paint(new THREE.BoxGeometry(w, h, 0.003), C(col.cream)).translate(x0, y0, 0.0125);
    const slab = K.merge([K.rbox(SW, 0.225, 0.024, 0.012, '#2c2a37', 0.004).translate(0, -0.0, 0), chalk(0, 0.045, 0.3, 0.004), chalk(0, -0.012, 0.3, 0.004), chalk(0, -0.07, 0.3, 0.004), chalk(-0.04, -0.041, 0.004, 0.058), chalk(0.06, -0.041, 0.004, 0.058), chalk(-0.04, 0.0165, 0.004, 0.058),
      K.rbox(SW, 0.044, 0.026, 0.006, col.graph, 0.003).translate(0, 0.1245, 0), ...stripes(0.1245, 0.04, 0)]);
    const stickGeo = K.merge([K.rbox(SW, 0.044, 0.026, 0.006, col.graph, 0.003).translate(SW / 2, 0, 0), ...stripes(0, 0.04, 1).map((s) => s.translate(SW / 2, 0, 0))]);
    const arm = new THREE.Group(); arm.position.set(hing[0], 0.1245 + 0.022 + 0.0035 + 0.022, 0); arm.add(mk(stickGeo, mats.plastic));
    const hingeP = mk(K.cyl(0.011, 0.011, 0.034, col.amber, { axis: 'z', pos: [hing[0] + 0.0, 0.1245 + 0.022 + 0.0025, 0] }), mats.metal);
    g.add(mk(slab, mats.plastic), arm, hingeP);
    const tip = new THREE.Object3D(); tip.position.set(0, 0.15, 0.02); g.add(tip); tipOf.clapper = tip;
    props.clapper = { g, anim: (o) => { const c = o.clap ?? 1; arm.rotation.z = (1 - clamp(c, 0, 1.1)) * 0.62; g.rotation.z = 0.05; } };
  }
  { // ---- glowing neural slate ----
    const g = new THREE.Group();
    const frame = mk(K.merge([K.rbox(0.30, 0.40, 0.024, 0.03, '#1b1a22', 0.006), K.xf(K.rbox(0.05, 0.004, 0.006, 0.002, col.amber, 0.001), { pos: [0, -0.18, 0.012] })]), mats.plastic);
    const scrU = { uT: { value: 0 }, uGlow: { value: 1 } };
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.262, 0.362), new THREE.ShaderMaterial({ vertexShader: SLATE_VS, fragmentShader: SLATE_FS, uniforms: scrU, toneMapped: false })); screen.position.z = 0.0128; reg(screen, 'emit');
    const haloU = { uCol: { value: new THREE.Color(0.28, 0.2, 1.0) }, uK: { value: 0.9 } };
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.0), new THREE.ShaderMaterial({ vertexShader: SLATE_VS, fragmentShader: HALO_FS, uniforms: haloU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })); halo.position.z = -0.03; reg(halo, 'emit');
    g.add(frame, screen, halo); const tip = new THREE.Object3D(); tip.position.set(0, 0, 0.02); g.add(tip); tipOf.slate = tip;
    props.slate = { g, anim: (o, t) => { scrU.uT.value = t; const gl = o.glow ?? 1; scrU.uGlow.value = gl; haloU.uK.value = 0.9 * gl; g.rotation.y = 0; } };
  }
  { // ---- conducting baton with a light trail ----
    const g = new THREE.Group(), LEN = 0.42;
    const rod = mk(K.merge([K.cyl(0.0035, 0.0085, LEN, col.cream, { seg: 12, pos: [0, LEN / 2 + 0.01, 0] }), K.sph(0.024, col.graph, [0, 0, 0], [1, 1.3, 1]), K.cyl(0.0255, 0.0255, 0.008, col.amber, { pos: [0, 0.026, 0] })]), mats.plastic);
    const tipM = new THREE.Mesh(new THREE.SphereGeometry(0.0115, 14, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.2, 0.7), toneMapped: false })); reg(tipM, 'emit');
    const pivot = new THREE.Group(); pivot.add(rod, tipM); g.add(pivot);
    const N = 30, trail = makeTrail(N); g.add(trail.m);
    const pts = Array.from({ length: N }, () => V3()), br = new Float32Array(N), wd = new Float32Array(N), dir = V3(), up = V3(0, 1, 0), q = new THREE.Quaternion(), base = V3();
    const tipLocal = (t, o, out) => { const p = conductPath(t, { ictus: o.ictus ?? 0, beat: o.beat ?? 0.5 }), amp = o.amp ?? 1; dir.set(0.5 + 0.62 * p.x * 0.75 * amp, 0.72 + 0.5 * p.y * amp, 0.62 + 0.0 * p.y).normalize(); return out.copy(dir).multiplyScalar(LEN + 0.02); };
    const tip = new THREE.Object3D(); g.add(tip); tipOf.baton = tip;
    props.baton = { g, anim: (o, t) => {
      for (let i = 0; i < N; i++) { tipLocal(t - i * 0.011, o, pts[i]); const a = 1 - i / (N - 1); br[i] = (o.trail ?? 1) * a * a * 2.4; wd[i] = 0.0085 * (0.2 + 0.8 * a); }
      trail.write(pts, br, wd, [1.0, 0.62, 0.18]);
      tipLocal(t, o, base); dir.copy(base).normalize(); q.setFromUnitVectors(up, dir); pivot.quaternion.copy(q); tipM.position.copy(base); tip.position.copy(base);
    } };
  }
  { // ---- paintbrush that paints light ----
    const g = new THREE.Group(), N = 56;
    const handle = mk(K.merge([K.cyl(0.0105, 0.0055, 0.26, col.cream, { seg: 16, pos: [0, 0.18, 0] }), K.cyl(0.0095, 0.0095, 0.03, col.amber, { seg: 16, pos: [0, 0.327, 0] }), K.sph(0.0095, col.amber, [0, 0.342, 0], [1, 1.2, 1]), K.cyl(0.0105, 0.0125, 0.056, col.steel, { seg: 16, pos: [0, 0.027, 0] })]), mats.plastic);
    const bristle = new THREE.Mesh(new THREE.ConeGeometry(0.0125, 0.07, 16, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(3.4, 2.3, 0.8), toneMapped: false })); bristle.geometry.rotateX(Math.PI); bristle.position.y = -0.035; reg(bristle, 'emit');
    const glowM = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.ShaderMaterial({ vertexShader: SLATE_VS, fragmentShader: HALO_FS, uniforms: { uCol: { value: new THREE.Color(1.0, 0.62, 0.18) }, uK: { value: 0.8 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })); reg(glowM, 'emit');
    const brush = new THREE.Group(); brush.add(handle, bristle); g.add(brush, glowM);
    const trail = makeTrail(N); g.add(trail.m);
    const pts = Array.from({ length: N }, () => V3()), br = new Float32Array(N), wd = new Float32Array(N);
    // stroke path (prop-local metres): a broad swoosh toward +x / up, curling toward the viewer
    const path = (u, out) => out.set(-0.02 + 0.74 * u, 0.02 + 0.34 * Math.sin(u * 2.6) - 0.12 * u, 0.04 + 0.1 * Math.sin(u * 3.0));
    const tipP = V3(), q = new THREE.Quaternion(), tv = V3(), tvn = V3(), up = V3(0, 1, 0);
    const tip = new THREE.Object3D(); g.add(tip); tipOf.brush = tip;
    props.brush = { g, anim: (o, t) => {
      let u, fade = 1; if (o.stroke != null) { u = clamp(o.stroke); fade = o.trail ?? 1; } else { const per = 1.5, ph = ((t / per) % 1 + 1) % 1; u = clamp(ph / 0.66); fade = ph < 0.66 ? 1 : 1 - sstep(0.66, 1, ph); fade *= o.trail ?? 1; }
      const ue = o.stroke != null ? u : (((t / 1.5) % 1 + 1) % 1 < 0.66 ? u : 1);
      for (let i = 0; i < N; i++) { const a = i / (N - 1); path(ue * a, pts[i]); const age = 1 - a; br[i] = fade * (0.35 + 0.65 * (1 - age * age)) * (u > 0.001 ? 1 : 0) * 1.5; wd[i] = 0.0075 * (0.2 + 0.8 * (1 - 0.7 * age)); }
      trail.write(pts, br, wd, [1.0, 0.64, 0.2]);
      path(ue, tipP); const u2 = Math.min(1, ue + 0.02); path(u2, tv); tv.sub(tipP);
      // brush tilts back along its motion: handle points up/back
      tvn.set(-0.55 - 0.3 * tv.x * 10, 0.85, 0.15).normalize(); q.setFromUnitVectors(up, tvn); brush.quaternion.copy(q); brush.position.copy(tipP).add(V3(0, 0.0, 0)); glowM.position.copy(tipP); glowM.position.z += 0.02; glowM.material.uniforms.uK.value = 0.8 * (u > 0.001 ? 1 : 0.3); tip.position.copy(tipP);
    } };
  }
  Object.values(props).forEach((p) => { p.g.visible = false; propRoot.add(p.g); });

  // ---------- particles ----------
  const samp = M.sample(1), PN = samp.length, pgeo = new THREE.BufferGeometry();
  { const ps = new Float32Array(PN * 3), pc = new Float32Array(PN * 3), pr = new Float32Array(PN * 4), pz = new Float32Array(PN), r = makeRng(99);
    samp.forEach((s, i) => { ps[i * 3] = s.x; ps[i * 3 + 1] = s.y; ps[i * 3 + 2] = s.z; pc[i * 3] = s.c.r; pc[i * 3 + 1] = s.c.g; pc[i * 3 + 2] = s.c.b; pr[i * 4] = r(); pr[i * 4 + 1] = r(); pr[i * 4 + 2] = r(); pr[i * 4 + 3] = r(); pz[i] = s.sz * s.w; });
    pgeo.setAttribute('position', new THREE.BufferAttribute(ps, 3)); pgeo.setAttribute('color', new THREE.BufferAttribute(pc, 3)); pgeo.setAttribute('aRnd', new THREE.BufferAttribute(pr, 4)); pgeo.setAttribute('aSize', new THREE.BufferAttribute(pz, 1)); }
  const ptU = { uTime: timeU, uForm: { value: 1 }, uSize: { value: 0.0095 }, uViewH: { value: 1080 }, uSpread: { value: 1.5 / R }, uDrift: { value: 0.006 }, uAlpha: { value: 0.9 } };
  const pts = new THREE.Points(pgeo, new THREE.ShaderMaterial({ vertexShader: PT_VS, fragmentShader: PT_FS, uniforms: ptU, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  pts.frustumCulled = false; pts.visible = false; rg.add(pts); const _sz = new THREE.Vector2();
  pts.onBeforeRender = (renderer) => { const rt = renderer.getRenderTarget(); if (rt) ptU.uViewH.value = rt.height; else { renderer.getDrawingBufferSize(_sz); ptU.uViewH.value = _sz.y; } };

  // ---------- contact shadow ----------
  const shTex = (() => { const n = 64, d = new Uint8Array(n * n * 4); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const u = (x + 0.5) / n * 2 - 1, v = (y + 0.5) / n * 2 - 1, r2 = u * u + v * v, a = Math.exp(-r2 * 3.4) * (1 - sstep(0.7, 1.0, Math.sqrt(r2))); const o = (y * n + x) * 4; d[o] = d[o + 1] = d[o + 2] = Math.round(a * 255); d[o + 3] = 255; } const t = new THREE.DataTexture(d, n, n, THREE.RGBAFormat); t.needsUpdate = true; t.magFilter = t.minFilter = THREE.LinearFilter; return t; })();
  const shMat = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: shTex, transparent: true, depthWrite: false, opacity: 0.6, toneMapped: false });
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shMat); shadow.visible = false; shadow.frustumCulled = false; shadow.renderOrder = -1; shadow.name = 'amrita-contact-shadow'; root.add(shadow);
  const shOpt = { floorY: 0, radius: 0.62, opacity: 0.62, soft: 0.55, aspect: 0.74 };
  const _wp = new THREE.Vector3(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();
  shadow.onBeforeRender = () => {
    _wp.setFromMatrixPosition(root.matrixWorld);
    const h = Math.max(0, _wp.y - shOpt.floorY - R), wx = body.matrixWorld.elements[0], wz = body.matrixWorld.elements[2], ang = Math.atan2(-wz, wx);
    const k = shOpt.radius * (1 + shOpt.soft * h);
    _q1.setFromEuler(_e.set(-Math.PI / 2, 0, 0)); _q2.setFromEuler(_e.set(0, ang, 0)); _q2.multiply(_q1); _s.set(k * 2, k * 2 * shOpt.aspect, 1);
    shadow.matrixWorld.compose(_wp.set(_wp.x, shOpt.floorY + 0.004, _wp.z), _q2, _s);
    shMat.opacity = shOpt.opacity / (1 + 2.4 * h * h);
  };

  // ---------- optional glow light, env ----------
  let gl = null; if (glowLight) { gl = new THREE.PointLight('#8a7bff', 0, 4, 2); gl.position.set(R * 1.2, 0, R * 0.7); root.add(gl); }
  let envDone = false, envInt = 0.5;
  const applyEnv = (renderer) => { if (envDone || !env) return; envDone = true; const tex = studioEnv(THREE, renderer); for (const m of phys) { m.envMap = tex; m.envMapIntensity = m === mats.eye ? 1.0 : envInt; m.needsUpdate = true; } };
  mBody.onBeforeRender = (renderer) => applyEnv(renderer);

  // ---------- style ----------
  const st = { name: null, hue: 0.49, alpha: 0.55 };
  function setStyle(name, o = {}) {
    if (o.hue != null) st.hue = o.hue; if (o.alpha != null) st.alpha = o.alpha;
    if (o.t != null) timeU.value = o.t;
    holoMat.uniforms.uTint.value.setHSL(st.hue, 0.92, 0.52); holoMat.uniforms.uAlpha.value = o.alpha ?? (name === 'hologram' ? st.alpha : holoMat.uniforms.uAlpha.value);
    if (name === 'particles') { if (o.form != null) ptU.uForm.value = o.form; if (o.size != null) ptU.uSize.value = 0.0095 * o.size; if (o.alpha != null) ptU.uAlpha.value = o.alpha; if (o.spread != null) ptU.uSpread.value = o.spread / R; if (o.drift != null) ptU.uDrift.value = o.drift; }
    if (name === 'ghost') { const a = o.alpha ?? st.alpha; for (const m of [mats.blade, mats.bladeAlt, mats.body, mats.face, mats.plastic, mats.metal]) m.opacity = a; }
    if (name !== st.name) {
      st.name = name; const holo = name === 'hologram', part = name === 'particles', ghost = name === 'ghost';
      for (const p of parts) { if (p.kind === 'bodyEmit') { p.mesh.visible = !part; continue; } if (p.kind === 'eye' || p.kind === 'emit') continue; p.mesh.material = holo || (part && p.kind === 'prop') ? holoMat : p.mat; if (p.kind === 'body') p.mesh.visible = !part; }
      pts.visible = part; ghostU.value = ghost ? 1 : 0;
      for (const m of [mats.blade, mats.bladeAlt, mats.body, mats.face, mats.plastic, mats.metal]) { m.transparent = ghost; m.depthWrite = !ghost; m.opacity = ghost ? (o.alpha ?? st.alpha) : 1; m.needsUpdate = true; }
      if (part) holoMat.uniforms.uAlpha.value = 0.55;
    }
    return api;
  }

  // ---------- public ----------
  const _lv = new THREE.Vector3();
  const api = {
    root, body, materials: mats, eyesState: eyeState, parts: { blades: [mBladeE, mBladeO], face: mFace, E: E.map((e) => e.m), body: mBody, points: pts, shadow }, EXPR, THREE,
    glowLight: gl, props, propRoot,
    pose({ squash = 0, yaw = 0.5, roll = 0, bob = 0, pitch = 0, pivot = 0, yawD = 0, x = 0, y = 0, z = 0 } = {}) {
      const sy = 1 + squash, sx = 1 / Math.sqrt(Math.max(0.2, sy));
      body.scale.set(sx, sy, sx); body.rotation.set(pitch, yaw + yawD, roll); body.position.set(x, bob + y - pivot * R * (sy - 1), z);
      return api;
    },
    eyes(o = {}) { Object.assign(eyeState, o); applyEyes(); return api; },
    expression(name = 'neutral', amount = 1, from = 'neutral') {
      const p0 = typeof from === 'string' ? EXPR[from] || {} : from, p1 = typeof name === 'string' ? EXPR[name] || {} : name;
      const A_ = { ...EYE0(), ...p0 }, B_ = { ...EYE0(), ...p1 };
      for (const k of ['open', 'squint', 'happy', 'determined', 'surprised', 'sleepy', 'wink']) eyeState[k] = lerp(A_[k], B_[k], amount);
      applyEyes(); return api;
    },
    blend, EYE0,
    /** one-call life: hover + irregular seeded blinks + slow eye wander. Call every frame instead of pose()/eyes(). */
    idle(T, { yaw = 0.5, seed = 0, amp = 0.03, tilt = 1, look = 0.35, blink = true } = {}) {
      const t = tOf(T); api.pose({ yaw, ...hover(t, { amp, seed, tilt }) });
      eyeState.lookX = look * noise1(t * 0.35, seed + 3); eyeState.lookY = look * 0.6 * noise1(t * 0.31, seed + 7);
      if (blink) eyeState.open = 1 - blinkAmount(t, seed);
      applyEyes(); return api;
    },
    lookAt(target, { gain = 2.4, yaw = false } = {}) {
      body.updateWorldMatrix(true, false); _lv.set(target.x, target.y, target.z); body.worldToLocal(_lv); _lv.z -= M.plateTop * R; _lv.normalize();
      eyeState.lookX = clamp(_lv.x * gain, -1, 1); eyeState.lookY = clamp(_lv.y * gain, -1, 1); applyEyes(); return { lookX: eyeState.lookX, lookY: eyeState.lookY };
    },
    setProp(kind, o = {}) {
      for (const [k, p] of Object.entries(props)) p.g.visible = k === kind;
      curKind = kind || null; curProp = kind ? props[kind] || null : null;
      if (curProp) {
        const t = o.t || 0, side = o.side ?? 1, pp = o.pos || [0, 0, 0];
        propRoot.scale.setScalar(o.scale ?? 1);
        propRoot.position.set(side * R * 1.45 + pp[0], -R * 0.1 + Math.sin(t * 2.2) * (o.float ?? 0.025) + pp[1], R * 0.25 + pp[2]);
        propRoot.rotation.y = o.rotY ?? -0.3 * side; if (o.t != null) timeU.value = o.t;
        curProp.anim(o, t);
      }
      return api;
    },
    propAnchor(v, name = curKind) { const t = tipOf[name]; if (!t) return v.set(0, 0, 0); root.updateWorldMatrix(true, true); return t.getWorldPosition(v); },
    blinkAt(T, seed = 0) { const t = tOf(T); timeU.value = t; return blinkAmount(t, seed); },
    setStyle, time(t) { timeU.value = t; return api; },
    contactShadow(o = {}) { if (o === false) { shadow.visible = false; return shadow; } Object.assign(shOpt, o); shadow.visible = true; return shadow; },
    faceWorldPos(v) { body.updateWorldMatrix(true, false); return body.localToWorld(v.set(0, 0, (M.plateTop + 0.01) * R)); },
    useEnvironment(renderer) { if (renderer) applyEnv(renderer); return api; },
    setEnvIntensity(x) { envInt = x; for (const m of phys) if (m !== mats.eye) m.envMapIntensity = x; return api; },
    setShadows({ cast = true, receive = false } = {}) { for (const p of parts) { p.mesh.castShadow = cast && p.kind !== 'eye' && p.kind !== 'emit'; p.mesh.receiveShadow = receive && p.kind !== 'emit'; } return api; },
    hover, land, jump, dropIn, anticipate, squashStretchCurve, punch, beatPulse, addPose, clapCurve, blinkAmount, settle, conductPath,
  };
  // glow-light intensity follows the slate glow (opt-in)
  const _setProp = api.setProp; if (gl) api.setProp = (kind, o = {}) => { _setProp(kind, o); gl.intensity = kind === 'slate' ? 3.5 * (o.glow ?? 1) : 0; return api; };
  setStyle(style); api.pose(); applyEyes();
  return api;
}
