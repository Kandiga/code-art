// =============================================================================
// crowd3d.js — everything that is a CROWD or a CAST: icon characters, cinema audiences, the 2050 family
// on the sofa, light-particle audiences (2150 dream cinema) and the orchestra made of light (SCORE job).
// Units: meters, +Y up. Pure functions of time: every animated value is derived from T.t / T.beat inside the
// call (no accumulated state), so it is safe under the engine's 4 sub-frames and out-of-order frame rendering.
// THREE is always passed in (`S.THREE`); this file imports no three.js itself. NO real people: abstract icons only.
//
//   import { createIconCast, createAudience, createSeats, createCouchGroup,
//            createParticleAudience, createOrchestraOfLight, CAST_KINDS } from '../crowd3d.js';
//
// ---------------------------------------------------------------------------------------------------------------
// 1) createIconCast(THREE, { kinds, seed, size, colors, shadow })  ->  Array<Icon>      (job_cast)
//    kinds  default ['star','heart','crown','bolt','moon']  (also 'cloud','lens' — see CAST_KINDS)
//    size   height of one character in meters (default 0.95; Amrita's disc is Ø 1.0)
//    colors optional array of hex/palette-names overriding the default palette colour per kind
//    Icon = bold extruded glossy shape with Amrita's visual language: two glossy black OVAL eyes + white glint,
//    squash & stretch, no limbs. root origin = the character's SOLE (bottom centre), so root.position.y = floor.
//      c.root                THREE.Group — put it in the scene; its position is the floor contact point
//      c.kind, c.color, c.height, c.width, c.index, c.materials {body,trim,glass}
//      c.place(x,y,z)        set root position (and keep the contact shadow glued to c.floorY)
//      c.floorY              floor height the blob shadow sits on (default 0)
//      c.pose({squash,yaw,roll,bob})  squash -0.5..0.5 (+ = taller, area preserving, pivot at the sole);
//                                     yaw radians (0 = facing +Z, ~0.4 = 3/4 toward camera); roll rocks about the sole
//      c.eyes({open,happy,surprised,squint,lookX,lookY})   all 0..1 (look -1..1)
//      c.expression('neutral'|'happy'|'surprised'|'squint'|'sleepy'|'blink', amount)
//      c.blinkAt(T)          seeded natural blink (0..1 closed amount) — pass to eyes({open:1-c.blinkAt(T)})
//      c.lookAt(v3)          aim the eyes at a world point
//      c.idle(T, {amount, groove, blink, seedOffset})  breathing, sway, gaze wander, blink. groove = on-beat bob 0..1
//      c.hop(T, t0, from, to, height=0.7, dur=0.5) -> u   anticipation crouch (0.14 s before t0), stretch in the air,
//                            landing squash (see spot). from/to: [x,y,z] or Vector3, root-space. Before t0 it holds at
//                            `from`; after t0+dur it holds at `to`. Returns -1 before takeoff, 0..1 airborne, 1 landed.
//                            Chain hops with  `if (T.t < t1) c.hop(T,t0,A,B) else c.hop(T,t1,B,C)`  or use c.hops().
//      c.hops(T, start, [{t0,to,height?,dur?}...])  convenience: picks the active segment of a hop chain.
//      c.slide(T, t0, from, to, dur=0.6) -> u    glide with a lean (no hop).
//      c.spot(T, t0, {happy:true}) -> env        landing squash spring at t0 (the 'foot_tap' beat on the mark) 1..0
//      c.cheer(T, t0, {dur,height,spin}) -> u    jump-for-joy: two bounces, happy eyes, optional twirl.
//      c.popIn(T, t0, dur=0.35) -> scale         scale 0 -> 1 with overshoot (invisible before t0).
//      c.setGlow(k)          0..1 emissive kick (hits / spot flashes)
//      c.faceWorldPos(v3)    world position of the face centre
//    Call order per frame:  idle(T) -> hop()/slide()/cheer() -> spot() -> popIn().  Each method SETS its own channels.
//
// 2) createAudience(THREE, { rows, cols, spacing, seed, style, seats, facing, curve, riser, rowSpacing, empty,
//                            aisles, scale, faces, shadows, seatColor })
//       style  'silhouette' (near-black beans, rim-lit by the screen) | 'rim' (dark tinted, stronger rim) |
//              'icons' (bright toy-colour beans WITH faces)
//       facing 'screen' (looks along group −Z; row 0 = front row at local z=0, rows go +Z and UP) |
//              'camera' (looks along +Z; row 0 at z=0, rows go −Z and up) — faces (eyes) show when facing 'camera'
//       -> { group, update(T, opts), setLightColor(c, strength?), count, people, drawCalls, bounds, seatPos(i) }
//       update(T, { react:(t)=>0..1, standT, sitT, cheerT, applause, seed })
//          react   function of global time, 0..1 audience excitement (gasp / laugh); each person samples it with its own
//                  small delay so it ripples through the room. Raises arms progressively, bounces, tilts heads.
//          standT  global time at which everyone stands (staggered 0.45 s ripple), arms-up pop with overshoot.
//          sitT    optional: time they sit back down.     cheerT: number | number[]  jump + arms-up bursts (decays ~1.5 s)
//          applause number | (t)=>0..1 — arms held up clapping.   seed: extra variation (default 0)
//       setLightColor(c): the colour of the screen light that rim-lights the backs (THREE.Color | hex | number).
//       <= 8 draw calls (steps, seats, bodies, heads, arms, hair, eyes, glints), up to ~400 people.
//    createSeats(THREE, {...same layout opts}) -> { group, setLightColor, count } : empty cinema seats only (1-2 draw calls)
//    createCouchGroup(THREE, { people: 3..5, seed, style, facing, sofaColor }) -> { group, update(T,{react,awe,cheerT}), setLightColor }
//       a sofa + a cozy family of abstract bean silhouettes seen from behind (parents, a kid leaning on a shoulder, ...).
//       Origin = floor under the sofa centre; the family faces local −Z (toward the hologram), sofa back toward +Z.
//
// 3) createParticleAudience(THREE, { count, seed, bounds:{w,d,cx,cz,y}, layout:'rows'|'ring'|'scatter', pointsPerPerson,
//                                    size, focus:[x,y,z], depthWrite })
//       -> { group, points, update(T, {standT, litT, intensity, hue, cheerT, react, assemble:[t0,t1]}), count, positions }
//       People made of LIGHT POINTS (capsule + sphere volumes, rising sparks, a floor ring). Everything twinkles; they
//       "light up" at litT (staggered), "stand" at standT (arms up), cheer at cheerT. hue 0..1 (HSV) shifts the palette.
//
// 4) createOrchestraOfLight(THREE, { seed, count, radius, rowGap, arc, size })
//       -> { group, points, assemble(T,t0,t1), hit(T,t), update(T,{assemble:[t0,t1],hits:[...],intensity,play}),
//            conductor (THREE.Vector3 of the podium, = group origin), count }
//       Light-particle musicians (strings, cellos, winds, brass, timpani, harp), music stands, a podium ring. They assemble
//       from drifting sparks between t0..t1, then play (bows saw, bodies sway on T.beat). hit(T,t) registers an orchestra
//       hit at global time t: a burst of brightness, a radial push and an expanding shock ring. All pure in T.t.
//       Layout: the conductor stands at the group origin; the players sit on 3 curved rows around her (arc ~225 deg centred on -Z),
//       all facing her, open toward +Z so a camera behind/over her shoulder sees the whole orchestra. Rotate `group` to taste.
// ---------------------------------------------------------------------------------------------------------------
// Rendering notes: audience/couch materials are MeshStandardMaterial with a small rim shader injected (fresnel + screen
// facing term), so they read as lit silhouettes even in a dark scene; real scene lights still affect them. Particle
// systems are ShaderMaterial Points with additive blending; sizes are in METERS (perspective-correct, any render scale).
// =============================================================================
import { hash, seedOf, rng as mkRng } from './rng.js';
import { BRAND } from '../../shared/cues.js';

const PAL = BRAND.palette;
const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const outBack = (x, s = 1.70158) => { x = clamp(x) - 1; return x * x * ((s + 1) * x + s) + 1; };
const iseed = (s) => (typeof s === 'string' ? seedOf(s) : (s | 0));
const H = (...v) => hash(...v); // [0,1)
const palColor = (c) => (typeof c === 'string' && PAL[c] ? PAL[c] : c);
const xyz = (v) => (Array.isArray(v) ? v : [v.x, v.y, v.z]);
const spring = (t, freq = 3, damp = 0.35) => { // 0 -> 1 with overshoot
  if (t <= 0) return 0; const w = TAU * freq, wd = w * Math.sqrt(1 - damp * damp);
  return 1 - Math.exp(-damp * w * t) * (Math.cos(wd * t) + (damp / Math.sqrt(1 - damp * damp)) * Math.sin(wd * t));
};

// ---------------------------------------------------------------------------------------------------------------
// geometry helpers
// ---------------------------------------------------------------------------------------------------------------
// merge [{geo, m?:Matrix4}] into one non-indexed BufferGeometry (position + normal)
function mergeGeos(THREE, parts) {
  const pos = [], nor = [];
  for (const { geo, m } of parts) {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone());
    if (m) g.applyMatrix4(m);
    pos.push(g.attributes.position.array); nor.push(g.attributes.normal.array);
  }
  const cat = (arrs) => { let n = 0; for (const a of arrs) n += a.length; const o = new Float32Array(n); let k = 0; for (const a of arrs) { o.set(a, k); k += a.length; } return o; };
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(cat(pos), 3));
  out.setAttribute('normal', new THREE.BufferAttribute(cat(nor), 3));
  return out;
}
// rounded box: a box whose edges/corners are pulled onto spheres of radius r (toy look)
function roundedBox(THREE, w, h, d, r, seg = 6) {
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg), p = g.attributes.position, n = g.attributes.normal;
  const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r, v = new THREE.Vector3(), q = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); q.set(clamp(v.x, -hx, hx), clamp(v.y, -hy, hy), clamp(v.z, -hz, hz));
    v.sub(q); const l = v.length();
    if (l > 1e-6) { v.multiplyScalar(r / l); n.setXYZ(i, v.x / r, v.y / r, v.z / r); p.setXYZ(i, q.x + v.x, q.y + v.y, q.z + v.z); }
  }
  return g;
}
const mat4 = (THREE, [x, y, z] = [0, 0, 0], [sx, sy, sz] = [1, 1, 1], [rx, ry, rz] = [0, 0, 0]) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

// 1x1 soft round shadow texture (alpha gradient) without a DOM canvas
function blobTexture(THREE, n = 48) {
  const d = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = (x + 0.5) / n * 2 - 1, v = (y + 0.5) / n * 2 - 1, r = Math.hypot(u, v), a = Math.pow(clamp(1 - r), 1.6);
    const k = (y * n + x) * 4; d[k] = d[k + 1] = d[k + 2] = 0; d[k + 3] = Math.round(a * 255);
  }
  const t = new THREE.DataTexture(d, n, n, THREE.RGBAFormat); t.needsUpdate = true; t.magFilter = t.minFilter = THREE.LinearFilter; return t;
}

// ---------------------------------------------------------------------------------------------------------------
// RIM KIT — shared uniforms + standard materials with an injected "screen light" rim (fresnel x facing the screen)
// ---------------------------------------------------------------------------------------------------------------
function makeRimKit(THREE, { rimColor = '#9fd4ff', pow = 2.2, strength = 1.5, amb = 0.0, dir = [0, 0, -1] } = {}) {
  const U = {
    uRimColor: { value: new THREE.Color(rimColor) }, uRimPow: { value: pow }, uRimStr: { value: strength },
    uAmb: { value: amb }, uScreenV: { value: new THREE.Vector3(0, 0, -1) }, uUpV: { value: new THREE.Vector3(0, 1, 0) },
  };
  const world = new THREE.Vector3(...dir), tmpQ = new THREE.Quaternion();
  const kit = {
    U, group: null,
    mk(params, rimMul = 1) {
      const m = new THREE.MeshStandardMaterial(params);
      m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, U); sh.uniforms.uRimMul = { value: rimMul };
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor; uniform float uRimPow, uRimStr, uAmb, uRimMul; uniform vec3 uScreenV, uUpV;')
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  { vec3 nrm = normalize(normal); vec3 vd = normalize(vViewPosition);
    float fres = pow(1.0 - clamp(dot(nrm, vd), 0.0, 1.0), uRimPow);
    vec3 Ld = normalize(uScreenV * 0.8 + uUpV * 0.5);
    float fc = clamp(dot(nrm, Ld) * 0.5 + 0.5, 0.0, 1.0);
    float top = clamp(dot(nrm, uUpV), 0.0, 1.0);
    float lit = uRimStr * (fres * (0.35 + 0.65 * fc * fc) + 0.55 * pow(fc, 3.0) * (0.4 + 0.6 * fres) + 0.25 * top * top);
    float mc = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
    totalEmissiveRadiance += uRimMul * uRimColor * (lit + uAmb * (0.25 + 0.75 * fc)) * (0.4 + 0.6 * diffuseColor.rgb / max(mc, 0.02)) * mix(0.55, 1.0, clamp(mc * 5.0, 0.0, 1.0));
  }`);
      };
      m.customProgramCacheKey = () => 'crowd3d-rim-v2';
      return m;
    },
    // call from onBeforeRender: orient the screen-direction uniform to the current camera
    sync(camera) {
      if (!kit.group) return;
      kit.group.updateWorldMatrix(true, false);
      kit.group.getWorldQuaternion(tmpQ);
      U.uScreenV.value.copy(world).applyQuaternion(tmpQ).transformDirection(camera.matrixWorldInverse);
      U.uUpV.value.set(0, 1, 0).transformDirection(camera.matrixWorldInverse);
    },
    setColor(c, str) {
      if (c && c.isColor) U.uRimColor.value.copy(c); else U.uRimColor.value.set(c);
      if (str != null) U.uRimStr.value = str;
    },
  };
  return kit;
}

// ===============================================================================================================
// 1) ICON CAST
// ===============================================================================================================
export const CAST_KINDS = ['star', 'heart', 'crown', 'bolt', 'moon', 'cloud', 'lens'];
const KIND_COLOR = { star: 'amber', heart: 'vermilion', crown: 'violet', bolt: 'teal', moon: 'sky', cloud: 'paper', lens: 'cream' };

function roundedPoly(THREE, pts, r) {
  const s = new THREE.Shape(), n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i + n - 1) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const d1 = [p0[0] - p1[0], p0[1] - p1[1]], d2 = [p2[0] - p1[0], p2[1] - p1[1]], l1 = Math.hypot(...d1), l2 = Math.hypot(...d2);
    const rv = Array.isArray(r) ? r[i % r.length] : r, rr = Math.min(rv, l1 * 0.45, l2 * 0.45);
    const a = [p1[0] + (d1[0] / l1) * rr, p1[1] + (d1[1] / l1) * rr], b = [p1[0] + (d2[0] / l2) * rr, p1[1] + (d2[1] / l2) * rr];
    if (i === 0) s.moveTo(a[0], a[1]); else s.lineTo(a[0], a[1]);
    s.quadraticCurveTo(p1[0], p1[1], b[0], b[1]);
  }
  s.closePath(); return s;
}
function extrude(THREE, shape, depth, bevel) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 5, curveSegments: 28 });
  g.translate(0, 0, -depth / 2); return g;
}
// shape builders: unit height ~1, centred at origin. return { shape, depth, bevel, eye:{x,y,sep,w,h}, extras(THREE, mats, g) }
const SHAPES = {
  star(THREE) {
    const pts = []; for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 0.255 : 0.52; pts.push([Math.cos(a) * r, Math.sin(a) * r - 0.02]); }
    return { shape: roundedPoly(THREE, pts, [0.11, 0.05]), depth: 0.2, bevel: 0.07, eye: { x: 0, y: -0.04, sep: 0.21, w: 0.052, h: 0.088 } };
  },
  heart(THREE) {
    const s = new THREE.Shape();
    s.moveTo(0, -0.5); s.bezierCurveTo(-0.1, -0.42, -0.5, -0.17, -0.5, 0.13);
    s.bezierCurveTo(-0.5, 0.36, -0.34, 0.5, -0.17, 0.5); s.bezierCurveTo(-0.07, 0.5, -0.02, 0.44, 0, 0.36);
    s.bezierCurveTo(0.02, 0.44, 0.07, 0.5, 0.17, 0.5); s.bezierCurveTo(0.34, 0.5, 0.5, 0.36, 0.5, 0.13);
    s.bezierCurveTo(0.5, -0.17, 0.1, -0.42, 0, -0.5);
    return { shape: s, depth: 0.22, bevel: 0.08, eye: { x: 0, y: 0.08, sep: 0.26, w: 0.056, h: 0.095 } };
  },
  crown(THREE) {
    const pts = [[-0.5, -0.4], [0.5, -0.4], [0.5, 0.22], [0.27, -0.03], [0, 0.42], [-0.27, -0.03], [-0.5, 0.22]];
    return {
      shape: roundedPoly(THREE, pts, [0.06, 0.06, 0.05, 0.03, 0.05, 0.03, 0.05]), depth: 0.2, bevel: 0.06, eye: { x: 0, y: -0.15, sep: 0.27, w: 0.056, h: 0.095 },
      extras(THREE, M, g) {
        for (const [x, y, r] of [[-0.5, 0.25, 0.085], [0, 0.45, 0.1], [0.5, 0.25, 0.085]]) { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), M.trim); m.position.set(x, y, 0); m.castShadow = true; g.add(m); }
        const band = new THREE.Mesh(roundedBox(THREE, 1.02, 0.09, 0.3, 0.04, 4), M.trim); band.position.set(0, -0.33, 0.03); band.castShadow = true; g.add(band);
      },
    };
  },
  bolt(THREE) {
    const pts = [[-0.14, 0.52], [0.36, 0.52], [0.08, 0.12], [0.4, 0.12], [-0.22, -0.52], [-0.02, -0.06], [-0.4, -0.06]];
    return { shape: roundedPoly(THREE, pts, [0.07, 0.07, 0.04, 0.07, 0.07, 0.04, 0.07]), depth: 0.2, bevel: 0.065, eye: { x: 0.06, y: 0.3, sep: 0.21, w: 0.05, h: 0.085 } };
  },
  moon(THREE) {
    // crescent: outer circle r=0.5 at origin minus circle r=0.4 at (0.22, 0.12)
    const r1 = 0.5, c2 = [0.2, 0.1], r2 = 0.38, d = Math.hypot(...c2), a = (r1 * r1 - r2 * r2 + d * d) / (2 * d), h = Math.sqrt(r1 * r1 - a * a);
    const ux = c2[0] / d, uy = c2[1] / d, P1 = [ux * a - uy * h, uy * a + ux * h], P2 = [ux * a + uy * h, uy * a - ux * h];
    const th1 = Math.atan2(P1[1], P1[0]), th2 = Math.atan2(P2[1], P2[0]);
    const s = new THREE.Shape(); s.moveTo(P1[0], P1[1]);
    s.absarc(0, 0, r1, th1, th2 + TAU, false); // counter-clockwise the long way round
    const ph1 = Math.atan2(P2[1] - c2[1], P2[0] - c2[0]), ph2 = Math.atan2(P1[1] - c2[1], P1[0] - c2[0]);
    s.absarc(c2[0], c2[1], r2, ph1, ph2, true); s.closePath();
    return { shape: s, depth: 0.22, bevel: 0.07, eye: { x: -0.2, y: -0.02, sep: 0.17, w: 0.046, h: 0.08, tilt: 0.0 } };
  },
  cloud(THREE) {
    const C = [[-0.27, -0.1, 0.2], [-0.1, 0.06, 0.27], [0.14, 0.1, 0.24], [0.3, -0.07, 0.19], [0, -0.12, 0.22]];
    const c0 = [0, -0.06], pts = [];
    for (let i = 0; i < 180; i++) {
      const a = (i / 180) * TAU, ux = Math.cos(a), uy = Math.sin(a); let best = 0;
      for (const [cx, cy, cr] of C) { const dx = cx - c0[0], dy = cy - c0[1], b = ux * dx + uy * dy, cc = dx * dx + dy * dy - cr * cr, disc = b * b - cc; if (disc >= 0) best = Math.max(best, b + Math.sqrt(disc)); }
      pts.push([c0[0] + ux * best, Math.max(-0.28, c0[1] + uy * best)]);
    }
    const s = new THREE.Shape(); pts.forEach((p, i) => (i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1]))); s.closePath();
    return { shape: s, depth: 0.22, bevel: 0.07, eye: { x: 0, y: -0.02, sep: 0.27, w: 0.056, h: 0.095 } };
  },
};

function buildLens(THREE, M, size) {
  // a camera lens: barrel (lathe), glass dome, rings. axis = +Z. unit height ~1.
  const g = new THREE.Group();
  const prof = [[0.0, -0.16], [0.44, -0.16], [0.5, -0.1], [0.5, 0.1], [0.45, 0.16], [0.36, 0.16], [0.34, 0.1], [0.0, 0.1]].map(([x, y]) => new THREE.Vector2(x, y));
  const barrel = new THREE.Mesh(new THREE.LatheGeometry(prof, 56), M.body); barrel.rotation.x = Math.PI / 2; barrel.castShadow = true; g.add(barrel);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.345, 0.032, 12, 56), M.trim); ring.position.z = 0.15; ring.castShadow = true; g.add(ring);
  const glass = new THREE.Mesh(new THREE.SphereGeometry(0.33, 40, 20), M.glass); glass.scale.z = 0.3; glass.position.z = 0.1; g.add(glass);
  const flare = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.014, 8, 32, 0.9), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false })); flare.rotation.z = 1.9; flare.position.z = 0.185; g.add(flare);
  for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU; const k = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.06, 0.06), M.trim); k.position.set(Math.cos(a) * 0.485, Math.sin(a) * 0.485, 0); k.rotation.z = a; g.add(k); }
  return { group: g, depth: 0.3, front: 0.215, eye: { x: 0, y: -0.02, sep: 0.26, w: 0.05, h: 0.085 } };
}

function makeEyes(THREE, scaleU, { sep, w, h, front, tilt = 0 }, mats) {
  const g = new THREE.Group(), E = [];
  for (const s of [-1, 1]) {
    const eg = new THREE.Group(); eg.position.set((s * sep) / 2 * scaleU, 0, 0);
    const oval = new THREE.Mesh(mats.eyeGeo, mats.eye); oval.castShadow = false;
    const glint = new THREE.Mesh(mats.glintGeo, mats.glint);
    const arc = new THREE.Mesh(mats.arcGeo, mats.eye); arc.visible = false;
    eg.add(oval, glint, arc); g.add(eg); E.push({ eg, oval, glint, arc, s });
  }
  g.rotation.z = tilt;
  const st = { open: 1, happy: 0, surprised: 0, squint: 0, sleepy: 0, lookX: 0, lookY: 0 };
  const U = scaleU;
  function apply() {
    for (const e of E) {
      const oy = Math.max(0.06, st.open * (1 - 0.5 * st.squint) * (1 - 0.45 * st.sleepy) * (1 + 0.3 * st.surprised));
      const ew = w * U * (1 + 0.22 * st.surprised), eh = h * U * oy, ed = w * U * 0.9;
      e.oval.scale.set(ew, eh, ed);
      e.oval.position.set(st.lookX * w * U * 0.55, st.lookY * h * U * 0.35, 0);
      e.glint.scale.set(w * U * 0.5, w * U * 0.62, w * U * 0.3);
      e.glint.position.set(-w * U * 0.4 + st.lookX * w * U * 0.55, h * U * 0.5 * oy + st.lookY * h * U * 0.35, ed * 0.8);
      const hp = st.happy >= 0.5;
      e.oval.visible = !hp; e.glint.visible = !hp && oy > 0.3; e.arc.visible = hp;
      e.arc.scale.set(w * U * 1.0, w * U * 1.0, w * U * 1.0); e.arc.position.set(0, -w * U * 0.45, 0);
    }
  }
  g.position.set(0, 0, 0);
  return { group: g, st, apply, E };
}

export function createIconCast(THREE, { kinds = ['star', 'heart', 'crown', 'bolt', 'moon'], seed = 1, size = 0.95, colors = null, shadow = true } = {}) {
  seed = iseed(seed);
  const eyeMat = new THREE.MeshPhysicalMaterial({ color: PAL.ink, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.03, reflectivity: 0.9 });
  const glintMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
  const eyeGeo = new THREE.SphereGeometry(1, 28, 18), glintGeo = new THREE.SphereGeometry(1, 12, 8), arcGeo = new THREE.TorusGeometry(1, 0.34, 8, 24, Math.PI);
  const eyeKit = { eye: eyeMat, glint: glintMat, eyeGeo, glintGeo, arcGeo };
  const blob = shadow ? blobTexture(THREE) : null;
  return kinds.map((kind, index) => {
    const colHex = palColor((colors && colors[index]) || KIND_COLOR[kind] || 'amber');
    const color = new THREE.Color(colHex);
    const M = {
      body: new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.14, emissive: color, emissiveIntensity: 0.07 }),
      trim: new THREE.MeshPhysicalMaterial({ color: kind === 'lens' ? PAL.graphite : PAL.cream, roughness: 0.28, clearcoat: 0.9, clearcoatRoughness: 0.15, metalness: kind === 'lens' ? 0.35 : 0, emissive: kind === 'lens' ? '#000000' : PAL.cream, emissiveIntensity: kind === 'lens' ? 0 : 0.1 }),
      glass: new THREE.MeshPhysicalMaterial({ color: '#cfeaff', roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.02, emissive: '#7CC4FF', emissiveIntensity: 0.35 }),
    };
    const root = new THREE.Group(); root.name = 'icon_' + kind;
    const popG = new THREE.Group(), liftG = new THREE.Group(), pivot = new THREE.Group(), sq = new THREE.Group(), face = new THREE.Group();
    root.add(popG); popG.add(liftG); liftG.add(pivot); pivot.add(sq); // pivot sits at the sole (y=0): squash & roll happen about it
    let eyeCfg, frontZ, bodyH = 1, bodyW = 1, minY = -0.5;
    if (kind === 'lens') {
      const L = buildLens(THREE, M, size); L.group.scale.setScalar(size); sq.add(L.group); eyeCfg = L.eye; frontZ = L.front * size; minY = -0.5; bodyW = 1;
    } else {
      const B = (SHAPES[kind] || SHAPES.star)(THREE);
      const geo = extrude(THREE, B.shape, B.depth, B.bevel); geo.scale(size, size, size);
      const mesh = new THREE.Mesh(geo, M.body); mesh.castShadow = true; mesh.receiveShadow = false; sq.add(mesh);
      geo.computeBoundingBox(); minY = geo.boundingBox.min.y / size; bodyH = (geo.boundingBox.max.y - geo.boundingBox.min.y) / size; bodyW = (geo.boundingBox.max.x - geo.boundingBox.min.x) / size;
      frontZ = geo.boundingBox.max.z;
      if (B.extras) { const ex = new THREE.Group(); ex.scale.setScalar(size); B.extras(THREE, M, ex); sq.add(ex); }
      eyeCfg = B.eye;
    }
    // sole at y=0: shift everything up
    const sole = -minY * size; sq.position.y = sole; // children are centred on the shape origin
    const E = makeEyes(THREE, size, { sep: eyeCfg.sep, w: eyeCfg.w, h: eyeCfg.h, tilt: eyeCfg.tilt || 0 }, eyeKit);
    face.position.set(eyeCfg.x * size, eyeCfg.y * size, frontZ + 0.002); face.add(E.group); sq.add(face);
    // blob shadow
    let shadowMesh = null;
    if (shadow) {
      shadowMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: blob, transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      shadowMesh.rotation.x = -Math.PI / 2; shadowMesh.position.y = 0.004; shadowMesh.scale.set(size * bodyW * 1.5, size * bodyW * 1.2, 1); shadowMesh.renderOrder = -1; root.add(shadowMesh);
    }
    const height = size * bodyH, width = size * bodyW;
    const S0 = { squash: 0, yaw: 0, roll: 0, bob: 0, happyBySpot: false, cheerHappy: false };
    const c = {
      root, kind, color, height, width, index, floorY: 0, materials: M, eyesApi: E,
      _shadow: shadowMesh,
      _sync() {
        if (!shadowMesh) return; const lift = Math.max(0, root.position.y + S0.bob - c.floorY), k = clamp(lift / 1.2);
        shadowMesh.position.y = c.floorY - root.position.y + 0.004; shadowMesh.material.opacity = 0.6 * (1 - 0.55 * k); const s = 1 - 0.3 * k;
        shadowMesh.scale.set(size * bodyW * 1.5 * s, size * bodyW * 1.2 * s, 1);
      },
      place(x, y, z) { root.position.set(x, y, z); c._sync(); return c; },
      pose({ squash = S0.squash, yaw = S0.yaw, roll = S0.roll, bob = S0.bob } = {}) {
        S0.squash = squash; S0.yaw = yaw; S0.roll = roll; S0.bob = bob;
        const sy = 1 + squash, sx = 1 / Math.sqrt(Math.max(0.2, sy));
        pivot.scale.set(sx, sy, sx); pivot.rotation.set(0, yaw, roll); liftG.position.y = bob; return c;
      },
      eyes(o = {}) { Object.assign(E.st, o); E.apply(); return c; },
      expression(name = 'neutral', amount = 1) {
        Object.assign(E.st, { open: 1, happy: 0, surprised: 0, squint: 0, sleepy: 0 });
        if (name === 'blink') E.st.open = 1 - amount; else if (E.st[name] !== undefined) E.st[name] = amount;
        E.apply(); return c;
      },
      blinkAt(T) { const per = 2.2 + 0.9 * H(seed, index, 3), ph = (T.t + per * H(seed, index, 4)) % per, x = ph / 0.14; return x < 1 ? Math.sin(x * Math.PI) : 0; },
      lookAt(v) { const p = root.worldToLocal(new THREE.Vector3(v.x, v.y, v.z)); p.y -= height * 0.55; const d = Math.max(0.5, p.length()); E.st.lookX = clamp(p.x / d * 2.2, -1, 1); E.st.lookY = clamp(p.y / d * 2.2, -1, 1); E.apply(); return c; },
      setGlow(k) { M.body.emissiveIntensity = 0.07 + 0.9 * k; M.trim.emissiveIntensity = (kind === 'lens' ? 0 : 0.1) + 0.5 * k; return c; },
      faceWorldPos(v) { return face.getWorldPosition(v); },
      idle(T, { amount = 1, groove = 0, blink = true, seedOffset = 0 } = {}) {
        const t = T.t, ph = H(seed, index, 1) * TAU + seedOffset, per = 1.5 + 0.5 * H(seed, index, 2);
        let sq_ = 0.035 * amount * Math.sin(t * TAU / per + ph);
        if (groove > 0) { const f = ((T.beat % 1) + 1) % 1; sq_ -= groove * 0.09 * Math.exp(-f / 0.12) - groove * 0.045 * Math.exp(-((f - 0.5) ** 2) / 0.01); }
        c.pose({ squash: sq_, yaw: S0.yaw, roll: 0.035 * amount * Math.sin(t * 1.3 + ph * 1.7) + 0.02 * groove * Math.sin(T.beat * Math.PI + ph), bob: 0.012 * amount * Math.sin(t * 2.1 + ph) + groove * 0.025 * Math.abs(Math.sin(T.beat * Math.PI)) });
        const lx = 0.35 * Math.sin(t * 0.7 + ph) * amount, ly = 0.2 * Math.sin(t * 0.53 + ph * 2) * amount;
        E.st.lookX = lx; E.st.lookY = ly; if (blink) E.st.open = 1 - c.blinkAt(T); E.apply(); c._sync(); return c;
      },
      spot(T, t0, { happy = true } = {}) {
        const tau = T.t - t0;
        if (tau < 0) return 0;
        if (tau > 0.9) { if (S0.happyBySpot) { E.st.happy = 0; S0.happyBySpot = false; E.apply(); } return 0; } // settled: leave idle() in charge
        const sqv = -0.3 * Math.exp(-tau / 0.11) * Math.cos(tau * TAU * 3.0) * (tau < 0.8 ? 1 : 0);
        c.pose({ squash: sqv, yaw: S0.yaw, roll: S0.roll * Math.exp(-tau / 0.2), bob: 0 });
        if (happy) { const on = tau > 0.02 && tau < 0.45; if (on) { E.st.happy = 1; S0.happyBySpot = true; E.apply(); } else if (S0.happyBySpot) { E.st.happy = 0; S0.happyBySpot = false; E.apply(); } }
        return Math.exp(-tau / 0.2);
      },
      hop(T, t0, from, to, height = 0.7, dur = 0.5) {
        const t = T.t, a = xyz(from), b = xyz(to), ant = 0.14;
        if (t < t0 - ant) { root.position.set(a[0], a[1], a[2]); c.pose({ squash: 0, yaw: S0.yaw, roll: 0, bob: 0 }); c._sync(); return -1; }
        if (t < t0) { const k = sstep(0, 1, (t - (t0 - ant)) / ant); root.position.set(a[0], a[1], a[2]); c.pose({ squash: -0.3 * k, yaw: S0.yaw, roll: 0, bob: 0 }); c._sync(); return -1; }
        if (t < t0 + dur) {
          const u = (t - t0) / dur, e = u; // horizontal linear, vertical parabola
          root.position.set(lerp(a[0], b[0], e), lerp(a[1], b[1], u) + 4 * height * u * (1 - u), lerp(a[2], b[2], e));
          const dx = b[0] - a[0]; c.pose({ squash: 0.3 * Math.pow(Math.sin(Math.PI * u), 0.7) - 0.3 * Math.exp(-u / 0.06), yaw: S0.yaw, roll: -clamp(dx, -1.5, 1.5) * 0.08 * Math.sin(Math.PI * u), bob: 0 });
          c._sync(); return u;
        }
        root.position.set(b[0], b[1], b[2]); c._sync(); c.spot(T, t0 + dur); return 1;
      },
      hops(T, start, list) {
        let from = start, active = null, prevEnd = -Infinity;
        for (let i = 0; i < list.length; i++) { const h = list[i]; if (T.t >= h.t0 - 0.14) active = { h, from }; from = h.to; prevEnd = h.t0 + (h.dur ?? 0.5); }
        if (!active) return c.hop(T, list[0].t0, start, list[0].to, list[0].height ?? 0.7, list[0].dur ?? 0.5);
        return c.hop(T, active.h.t0, active.from, active.h.to, active.h.height ?? 0.7, active.h.dur ?? 0.5);
      },
      slide(T, t0, from, to, dur = 0.6) {
        const a = xyz(from), b = xyz(to), u = clamp((T.t - t0) / dur), e = u * u * (3 - 2 * u), v = 6 * u * (1 - u) / dur; // speed
        root.position.set(lerp(a[0], b[0], e), lerp(a[1], b[1], e), lerp(a[2], b[2], e));
        const dx = (b[0] - a[0]) * v; c.pose({ squash: -0.07 * Math.sin(Math.PI * u), yaw: S0.yaw, roll: -clamp(dx * 0.09, -0.3, 0.3), bob: 0 }); c._sync(); return u;
      },
      cheer(T, t0, { dur = 0.9, height = 0.45, spin = true } = {}) {
        const tau = T.t - t0; if (tau < 0) return 0; const u = clamp(tau / dur);
        if (tau > dur + 0.05) { if (S0.cheerHappy) { E.st.happy = 0; S0.cheerHappy = false; E.apply(); } return 1; }
        const bounce = Math.abs(Math.sin(u * Math.PI * 2)) * (1 - u * 0.5), by = bounce * height;
        c.pose({ squash: 0.2 * Math.sin(u * Math.PI * 4) * (1 - u), yaw: S0.yaw + (spin ? TAU * sstep(0, 0.8, u) : 0), roll: 0.12 * Math.sin(u * Math.PI * 4), bob: by });
        E.st.happy = 1; S0.cheerHappy = true; E.apply(); c._sync();
        return u;
      },
      popIn(T, t0, dur = 0.35) {
        const u = (T.t - t0) / dur, s = u <= 0 ? 0 : outBack(u, 2.2); popG.scale.setScalar(Math.max(s, 0.0001)); popG.visible = u > 0; if (shadowMesh) shadowMesh.visible = u > 0.05; return s;
      },
    };
    c.pose(); E.apply();
    return c;
  });
}

// ===============================================================================================================
// 2) AUDIENCE / SEATS / COUCH — instanced bean people (<= 8 draw calls)
// ===============================================================================================================
// seated person dimensions in meters at k = 1 (person faces local -Z, seat back toward +Z)
const PD = { sitBottom: 0.38, sitH: 0.58, standBottom: 0.26, standH: 1.02, headR: 0.17, bodyW: 0.48, bodyD: 0.34, armR: 0.07, armL: 0.27 };
const DARKS = ['#14111c', '#101420', '#1b1020', '#0e1a1e', '#18171e', '#201318'];
const TINTS = ['#2a1d3d', '#1c2a44', '#3a1f33', '#16363b', '#2b2a38', '#3a2a1e'];
const BRIGHTS = ['amber', 'vermilion', 'teal', 'violet', 'sky', 'cream'].map((n) => PAL[n]);
const HAIR = [
  null,
  { p: [0, 1.02, 0.05], s: [0.4, 0.4, 0.4] }, // bun on top
  { p: [0, 0.4, 0.0], s: [1.07, 0.82, 1.07] }, // beanie dome
  { p: [0, 0.12, 0.98], s: [0.4, 0.62, 0.4] }, // ponytail at the back
  { p: [0, 1.12, 0.0], s: [0.2, 0.5, 0.2] }, // tuft
  { p: [0, 0.28, 0.14], s: [1.3, 1.22, 1.22] }, // big puff
];

function seatGeometry(THREE) {
  const parts = [
    { geo: roundedBox(THREE, 0.6, 0.14, 0.54, 0.06, 5), m: mat4(THREE, [0, 0.33, -0.02]) },
    { geo: roundedBox(THREE, 0.6, 0.5, 0.12, 0.06, 5), m: mat4(THREE, [0, 0.49, 0.27], [1, 1, 1], [-0.1, 0, 0]) },
    { geo: roundedBox(THREE, 0.07, 0.3, 0.46, 0.03, 3), m: mat4(THREE, [-0.33, 0.46, 0]) },
    { geo: roundedBox(THREE, 0.07, 0.3, 0.46, 0.03, 3), m: mat4(THREE, [0.33, 0.46, 0]) },
    { geo: roundedBox(THREE, 0.14, 0.3, 0.14, 0.05, 3), m: mat4(THREE, [0, 0.15, 0.1]) },
  ];
  return mergeGeos(THREE, parts);
}

// layout for rows x cols. returns persons[] (+ meta). facing: 'screen'|'camera'
function layoutRows(o) {
  const { rows, cols, spacing, rowSpacing, riser, curve, aisles, empty, seed, facing, scale } = o;
  const dir = facing === 'camera' ? -1 : 1, P = [];
  const gap = spacing * 1.15;
  const colX = []; let x = 0; const aset = new Set(aisles || []);
  for (let c = 0; c < cols; c++) { colX.push(x); x += spacing + (aset.has(c) ? gap : 0); }
  const cx = (colX[cols - 1] + 0) / 2;
  const k0 = (spacing / 0.8) * scale;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const px = colX[c] - cx, kcurve = curve * 0.04;
    let pz = dir * r * rowSpacing - kcurve * px * px * (facing === 'camera' ? -1 : 1) * 1;
    const slope = 2 * kcurve * px, ang = Math.atan(slope) * (facing === 'camera' ? -1 : 1);
    P.push({ r, c, x: px, y: r * riser, z: pz, yaw: (facing === 'camera' ? Math.PI : 0) + ang, k: k0, empty: H(seed, r, c, 99) < empty, id: r * cols + c });
  }
  return P;
}

function personTraits(p, seed, style, i) {
  const h = (n) => H(seed, p.id ?? i, n);
  p.bw = 0.86 + 0.38 * h(1); p.bh = 0.9 + 0.28 * h(2); p.hs = 0.92 + 0.2 * h(3);
  const kid = p.kid ?? (h(4) < 0.1);
  if (kid) { p.kk = 0.78; p.hs *= 1.12; } else p.kk = 1;
  p.hair = Math.floor(h(5) * 6.99); if (p.hair === 0 && h(6) < 0.35) p.hair = 2;
  p.ph = h(7) * TAU; p.swf = 0.5 + h(8) * 0.9; p.nf = 0.8 + h(9) * 1.2; p.delay = h(10) * 0.22 + (p.r || 0) * 0.025;
  p.rb = Math.min(5, Math.floor((h(10) * 0.7 + (p.r || 0) * 0.04) * 6));
  p.sd = h(11) * 0.45 + (p.r || 0) * 0.02; p.cd = h(12) * 0.25;
  p.thrL = 0.12 + 0.85 * h(13); p.thrR = 0.12 + 0.85 * h(14); p.waver = h(15) < 0.07;
  p.lean = p.lean ?? (h(16) - 0.5) * 0.05; p.htilt = p.htilt ?? (h(17) - 0.5) * 0.18; p.lookF = 0.2 + h(18) * 0.3;
  const pick = (arr) => arr[Math.floor(h(19) * arr.length) % arr.length];
  return p;
}

function createCrowdCore(THREE, o) {
  const { persons, style = 'silhouette', faces = false, seatGeo = null, stepsGeo = null, shadows = false, rim = {}, seatColor = '#3a1420', stepColor = '#1a1822', seed = 1, facing = 'screen' } = o;
  const N = persons.length;
  const group = new THREE.Group(); group.name = 'crowd';
  const icons = style === 'icons';
  const kit = makeRimKit(THREE, { rimColor: '#9fd4ff', pow: icons ? 3 : 2.1, strength: icons ? 0.8 : style === 'rim' ? 3.0 : 2.3, amb: icons ? 0.0 : 0.04, ...rim });
  kit.group = group;
  const mkMat = (extra = {}) => kit.mk({ color: '#ffffff', roughness: icons ? 0.45 : 0.85, metalness: 0, ...extra });
  const meshes = {};
  const sync = (mesh) => { mesh.onBeforeRender = (r, s, camera) => kit.sync(camera); mesh.frustumCulled = false; mesh.castShadow = shadows; mesh.receiveShadow = false; return mesh; };
  const geos = {
    body: new THREE.CapsuleGeometry(0.5, 0.5, 5, 14), head: new THREE.SphereGeometry(1, 16, 12), arm: new THREE.CapsuleGeometry(0.5, 1.0, 3, 8),
    hair: new THREE.SphereGeometry(1, 12, 9), eye: new THREE.SphereGeometry(1, 10, 8),
  };
  const add = (name, geo, mat, count) => { const m = sync(new THREE.InstancedMesh(geo, mat, count)); m.name = 'crowd_' + name; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); meshes[name] = m; group.add(m); return m; };
  const bodyMat = mkMat(), headMat = mkMat(), hairMat = mkMat(), armMat = mkMat();
  add('body', geos.body, bodyMat, N); add('head', geos.head, headMat, N); add('arms', geos.arm, armMat, N * 2); add('hair', geos.hair, hairMat, N);
  if (faces) {
    add('eyes', geos.eye, new THREE.MeshStandardMaterial({ color: PAL.ink, roughness: 0.15, metalness: 0 }), N * 2);
    add('glints', geos.eye, new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), N * 2);
  }
  if (seatGeo) { const sm = kit.mk({ color: seatColor, roughness: 0.75 }); const m = add('seats', seatGeo, sm, N); }
  if (stepsGeo) { const m = sync(new THREE.Mesh(stepsGeo, kit.mk({ color: stepColor, roughness: 0.9 }, 0.18))); m.name = 'crowd_steps'; group.add(m); meshes.steps = m; }
  // ---- static per-instance data
  const c = new THREE.Color(), dark = DARKS.map((x) => new THREE.Color(x)), tint = TINTS.map((x) => new THREE.Color(x)), bright = BRIGHTS.map((x) => new THREE.Color(x));
  const hairCols = icons ? bright : dark;
  persons.forEach((p, i) => {
    const h = (n) => H(seed, p.id ?? i, 40 + n);
    let body, head, hair;
    if (icons) { body = bright[Math.floor(h(1) * bright.length)].clone(); head = body.clone().lerp(new THREE.Color(PAL.cream), 0.4); hair = bright[Math.floor(h(2) * bright.length)].clone().multiplyScalar(0.7); if (hair.equals(body)) hair.multiplyScalar(0.6); }
    else if (style === 'rim') { body = tint[Math.floor(h(1) * tint.length)].clone().multiplyScalar(0.9); head = body.clone().multiplyScalar(1.15); hair = body.clone().multiplyScalar(0.6); }
    else { body = dark[Math.floor(h(1) * dark.length)].clone(); head = body.clone().multiplyScalar(1.25); hair = dark[Math.floor(h(2) * dark.length)].clone().multiplyScalar(0.8); }
    meshes.body.setColorAt(i, body); meshes.head.setColorAt(i, head); meshes.hair.setColorAt(i, hair);
    meshes.arms.setColorAt(i * 2, body); meshes.arms.setColorAt(i * 2 + 1, body);
    if (meshes.seats) meshes.seats.setColorAt(i, c.set(seatColor).multiplyScalar(0.85 + 0.3 * h(3)));
  });
  for (const k of ['body', 'head', 'hair', 'arms', 'seats']) if (meshes[k] && meshes[k].instanceColor) meshes[k].instanceColor.needsUpdate = true;
  // ---- transforms
  const D = new THREE.Object3D(), qY = new THREE.Quaternion(), qB = new THREE.Quaternion(), qH = new THREE.Quaternion(), qT = new THREE.Quaternion(), qA = new THREE.Quaternion();
  const e1 = new THREE.Euler(), v = new THREE.Vector3(), v2 = new THREE.Vector3(), piv = new THREE.Vector3(), hc = new THREE.Vector3(), ax = new THREE.Vector3(), dn = new THREE.Vector3(0, 1, 0), dirv = new THREE.Vector3();
  const Yax = new THREE.Vector3(0, 1, 0);
  const put = (mesh, idx, pos, q, sx, sy, sz) => { D.position.copy(pos); D.quaternion.copy(q); D.scale.set(sx, sy, sz); D.updateMatrix(); mesh.setMatrixAt(idx, D.matrix); };
  const hide = (mesh, idx) => { D.position.set(0, -50, 0); D.scale.set(0, 0, 0); D.updateMatrix(); mesh.setMatrixAt(idx, D.matrix); };
  // seats (static)
  if (meshes.seats) persons.forEach((p, i) => { if (p.empty === 'gone') { hide(meshes.seats, i); return; } qY.setFromAxisAngle(Yax, p.yaw); v.set(p.x, p.y, p.z); put(meshes.seats, i, v, qY, p.k, p.k, p.k); meshes.seats.instanceMatrix.needsUpdate = true; });
  const RB = 6, rv = new Float32Array(RB);
  const sh = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
  const out = {
    group, kit, meshes, count: N, people: persons.filter((p) => !p.empty).length, drawCalls: Object.keys(meshes).length,
    setLightColor(col, strength) { kit.setColor(col, strength); return out; },
    update(T, opts = {}) {
      const t = T.t, { react = null, awe = null, standT = Infinity, sitT = Infinity, cheerT = null, applause = 0, seed: sx = 0 } = opts;
      const cheers = Array.isArray(cheerT) ? cheerT : cheerT == null ? [] : [cheerT];
      const apl = typeof applause === 'function' ? applause(t) : applause;
      for (let b = 0; b < RB; b++) { const tt = t - b * 0.08; rv[b] = Math.max(react ? clamp(react(tt)) : 0, awe ? clamp(awe(tt)) : 0); }
      const aweNow = awe ? clamp(awe(t)) : 0;
      for (let i = 0; i < N; i++) {
        const p = persons[i];
        if (p.empty) { hide(meshes.body, i); hide(meshes.head, i); hide(meshes.hair, i); hide(meshes.arms, 2 * i); hide(meshes.arms, 2 * i + 1); if (faces) { hide(meshes.eyes, 2 * i); hide(meshes.eyes, 2 * i + 1); hide(meshes.glints, 2 * i); hide(meshes.glints, 2 * i + 1); } continue; }
        const k = p.k * p.kk, ph = p.ph + sx * 1.7;
        const excite = rv[p.rb];
        let st = 0; if (t >= standT + p.sd) { const u = (t - standT - p.sd) / 0.5; st = outBack(u, 2.0); }
        if (t >= sitT + p.sd * 0.7) st *= 1 - sh((t - sitT - p.sd * 0.7) / 0.4);
        let ch = 0; for (let q = 0; q < cheers.length; q++) { const u = t - cheers[q] - p.cd; if (u > 0) ch = Math.max(ch, Math.min(1, u / 0.1) * Math.exp(-u / 1.5)); }
        const lvl = Math.max(excite, ch * 0.95, Math.min(1, st) * 0.9);
        const wv = p.waver ? sh((0.5 + 0.5 * Math.sin(t * 0.35 + ph * 3) - 0.8) / 0.15) : 0;
        let aL = Math.max(sh((lvl - p.thrL + 0.1) / 0.2), wv), aR = Math.max(sh((lvl - p.thrR + 0.1) / 0.2), wv * 0.3);
        let angL = lerp(0.1, 2.6, aL), angR = lerp(0.1, 2.6, aR);
        if (apl > 0.02) { const aa = sh((apl - p.thrL * 0.6) / 0.2); if (aa > 0) { const cl = 2.15 + 0.3 * Math.sin(t * 13 + ph); angL = lerp(angL, Math.max(angL, cl), aa); angR = lerp(angR, Math.max(angR, 2.15 + 0.3 * Math.sin(t * 13 + ph + 0.6)), aa); } }
        const waving = (ch > 0.15 || wv > 0.5) ? 0.2 * Math.sin(t * 9 + ph) : 0; if (angL > 2) angL += waving; if (angR > 2) angR -= waving * 0.8;
        const bob = (ch * 0.15 + excite * 0.02 + st * 0.0) * Math.abs(Math.sin(t * (6.5 + p.swf * 2) + ph));
        const roll = p.lean + (0.018 + 0.05 * lvl) * Math.sin(t * p.swf + ph);
        const pitch = 0.035 * Math.sin(t * p.nf + ph * 1.3) * (1 + 2 * excite) - 0.1 * aweNow + (st > 0 ? 0.06 * Math.min(1, st) : 0);
        const bottom = lerp(PD.sitBottom, PD.standBottom, st) * k + bob, Hh = lerp(PD.sitH, PD.standH, st) * p.bh * k;
        qY.setFromAxisAngle(Yax, p.yaw); e1.set(pitch, 0, roll, 'XYZ'); qT.setFromEuler(e1); qB.copy(qY).multiply(qT);
        // pivot at hips
        v.set(0, bottom, 0).applyQuaternion(qY).add(v2.set(p.x, p.y, p.z)); piv.copy(v);
        v.set(0, Hh / 2, 0).applyQuaternion(qB).add(piv);
        put(meshes.body, i, v, qB, PD.bodyW * p.bw * k, Hh / 1.5, PD.bodyD * p.bw * k);
        // head
        const hr = PD.headR * p.hs * p.kk * p.k;
        hc.set(0, Hh + hr * 0.55, 0).applyQuaternion(qB).add(piv);
        const lookY = 0.32 * Math.sin(t * p.lookF + ph) * Math.sin(t * 0.13 + ph * 2) * (1 - 0.6 * excite), tilt = p.htilt * (1 - 0.5 * excite) + 0.07 * Math.sin(t * 0.9 + ph * 3) + 0.0;
        e1.set(-0.22 * aweNow, lookY, tilt, 'YXZ'); qT.setFromEuler(e1); qH.copy(qB).multiply(qT);
        if (aweNow > 0) hc.add(v2.set(0, 0.03, 0.04).multiplyScalar(aweNow * k).applyQuaternion(qB));
        put(meshes.head, i, hc, qH, hr, hr, hr);
        const hd = HAIR[p.hair];
        if (hd) { v.set(hd.p[0] * hr, hd.p[1] * hr, hd.p[2] * hr).applyQuaternion(qH).add(hc); put(meshes.hair, i, v, qH, hd.s[0] * hr, hd.s[1] * hr, hd.s[2] * hr); } else hide(meshes.hair, i);
        // arms: pivot at shoulder, hanging down rotated outward about the person's forward axis
        for (let s = 0; s < 2; s++) {
          const side = s === 0 ? -1 : 1, ang = s === 0 ? angL : angR, al = (PD.armL * (1 + 0.4 * Math.min(1, ang / 2.6))) * k * p.bh * (p.kk === 1 ? 1 : 0.9);
          const shoulder = v2.set(side * PD.bodyW * 0.5 * p.bw * k * 0.8, Hh - 0.19 * k, 0).applyQuaternion(qB).add(piv);
          // direction: rotate straight-down about the body forward axis (local z) — right arm (+x) swings outward/up with +ang
          e1.set(0, 0, side * ang, 'XYZ'); qA.setFromEuler(e1); qA.premultiply(qB);
          dirv.set(0, -al / 2, 0).applyQuaternion(qA); v.copy(shoulder).add(dirv);
          put(meshes.arms, 2 * i + s, v, qA, PD.armR * 2 * k, al / 2, PD.armR * 2 * k);
        }
        if (faces) {
          for (let s = 0; s < 2; s++) {
            const side = s === 0 ? -1 : 1, bl = 1 - Math.max(0, Math.sin((t + p.ph * 0.37) * 1.7) > 0.985 ? 1 : 0);
            v.set(side * 0.36 * hr, 0.1 * hr, -0.9 * hr).applyQuaternion(qH).add(hc);
            put(meshes.eyes, 2 * i + s, v, qH, 0.16 * hr, 0.25 * hr * (0.15 + 0.85 * bl), 0.1 * hr);
            v.set(side * 0.36 * hr + 0.05 * hr, 0.1 * hr + 0.1 * hr * bl, -0.97 * hr).applyQuaternion(qH).add(hc);
            put(meshes.glints, 2 * i + s, v, qH, 0.055 * hr, 0.06 * hr * bl, 0.05 * hr);
          }
        }
      }
      for (const key of ['body', 'head', 'arms', 'hair', 'eyes', 'glints']) if (meshes[key]) meshes[key].instanceMatrix.needsUpdate = true;
    },
  };
  return out;
}

function stepsGeometry(THREE, persons, spacing, rowSpacing, riser) {
  const parts = [];
  for (const p of persons) {
    const top = p.y, bot = -0.6, hgt = top - bot;
    parts.push({ geo: new THREE.BoxGeometry(spacing * 1.02, hgt, rowSpacing * 1.02), m: mat4(THREE, [p.x, bot + hgt / 2, p.z + 0.0], [1, 1, 1], [0, p.yaw, 0]) });
  }
  return mergeGeos(THREE, parts);
}

function audienceOpts(o) {
  const spacing = o.spacing ?? 0.8;
  return { rows: o.rows ?? 8, cols: o.cols ?? 16, spacing, rowSpacing: o.rowSpacing ?? spacing * 1.35, riser: o.riser ?? spacing * 0.42, curve: o.curve ?? 0, aisles: o.aisles ?? [], empty: o.empty ?? 0.05, seed: iseed(o.seed ?? 1), facing: o.facing ?? 'screen', scale: o.scale ?? 1, style: o.style ?? 'silhouette', seats: o.seats ?? true, faces: o.faces, shadows: o.shadows ?? false, seatColor: o.seatColor, steps: o.steps ?? true };
}

export function createAudience(THREE, opts = {}) {
  const o = audienceOpts(opts);
  const persons = layoutRows(o).map((p, i) => personTraits(p, o.seed, o.style, i));
  const faces = o.faces ?? (o.facing === 'camera' || o.style === 'icons');
  const core = createCrowdCore(THREE, { persons, style: o.style, faces, seatGeo: o.seats ? seatGeometry(THREE) : null, stepsGeo: o.seats && o.steps ? stepsGeometry(THREE, persons, o.spacing, o.rowSpacing, o.riser) : null, shadows: o.shadows, seatColor: o.seatColor || '#3a1420', seed: o.seed, facing: o.facing });
  const xs = persons.map((p) => p.x), zs = persons.map((p) => p.z), ys = persons.map((p) => p.y);
  core.bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), maxY: Math.max(...ys) + 1.5 };
  core.seatPos = (i) => new THREE.Vector3(persons[i].x, persons[i].y, persons[i].z);
  core.persons = persons;
  core.update({ t: 0, beat: 0 }, {});
  return core;
}

export function createSeats(THREE, opts = {}) {
  const o = audienceOpts({ ...opts, seats: true });
  const persons = layoutRows(o).map((p, i) => personTraits(p, o.seed, o.style, i));
  persons.forEach((p) => { p.empty = H(o.seed, p.id, 77) < (opts.empty ?? 0) ? 'gone' : false; });
  const group = new THREE.Group(); group.name = 'seats';
  const kit = makeRimKit(THREE, { strength: 1.2, amb: 0.03 }); kit.group = group;
  const sm = kit.mk({ color: '#ffffff', roughness: 0.75 });
  const im = new THREE.InstancedMesh(seatGeometry(THREE), sm, persons.length); im.frustumCulled = false; im.onBeforeRender = (r, s, cam) => kit.sync(cam);
  const D = new THREE.Object3D(), c = new THREE.Color(), qY = new THREE.Quaternion();
  persons.forEach((p, i) => { qY.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw); D.position.set(p.x, p.y, p.z); D.quaternion.copy(qY); D.scale.setScalar(p.k); if (p.empty === 'gone') D.scale.setScalar(0); D.updateMatrix(); im.setMatrixAt(i, D.matrix); im.setColorAt(i, c.set(o.seatColor || '#3a1420').multiplyScalar(0.85 + 0.3 * H(o.seed, i, 3))); });
  group.add(im);
  if (opts.steps !== false) { const st = new THREE.Mesh(stepsGeometry(THREE, persons, o.spacing, o.rowSpacing, o.riser), kit.mk({ color: '#1a1822', roughness: 0.9 }, 0.18)); st.frustumCulled = false; st.onBeforeRender = (r, s, cam) => kit.sync(cam); group.add(st); }
  return { group, count: persons.length, setLightColor(col, s) { kit.setColor(col, s); return this; } };
}

// ---------------------------------------------------------------------------------------------------------------
// createCouchGroup — the 2050 living-room family on a sofa, seen from behind (facing local -Z)
// ---------------------------------------------------------------------------------------------------------------
export function createCouchGroup(THREE, { people = 4, seed = 11, style = 'rim', facing = 'screen', sofaColor = '#3b2a4a', width = null, pillow = true, faces } = {}) {
  seed = iseed(seed); people = clamp(Math.round(people), 3, 5);
  const ROLES = {
    3: [{ k: 1.06 }, { k: 0.74, kid: true, lean: 0.14, htilt: 0.2 }, { k: 1.0, htilt: -0.12 }],
    4: [{ k: 1.0, htilt: 0.1, hair: 3 }, { k: 0.74, kid: true, lean: -0.13, htilt: -0.2 }, { k: 0.78, kid: true, lean: 0.12, htilt: 0.2 }, { k: 1.06, htilt: -0.1 }],
    5: [{ k: 0.98, hair: 1, htilt: 0.1 }, { k: 1.08, htilt: 0.05 }, { k: 0.72, kid: true, lean: 0.1, htilt: 0.2 }, { k: 1.0, hair: 5, htilt: -0.08 }, { k: 0.76, kid: true, lean: -0.13, htilt: -0.2 }],
  }[people];
  const slot = 0.72, W = width ?? people * slot + 0.5;
  const persons = ROLES.map((r, i) => personTraits({ id: i, x: (i - (people - 1) / 2) * slot, y: 0.1, z: 0, yaw: facing === 'camera' ? Math.PI : 0, k: r.k, kk: 1, kid: !!r.kid, lean: r.lean ?? 0, htilt: r.htilt ?? 0, r: 0, empty: false }, seed, style, i));
  persons.forEach((p, i) => { if (ROLES[i].hair != null) p.hair = ROLES[i].hair; p.kk = 1; p.hs = p.kid ? p.hs * 1.1 : p.hs; p.waver = false; p.bh = 1; p.bw = p.kid ? 0.95 : 1.05; p.delay = i * 0.07; p.rb = Math.min(5, i + 1); p.sd = i * 0.08; p.cd = i * 0.05; });
  // sofa (static merged geometry, vertex-coloured)
  const sofa = new THREE.Group(); const C = (x) => new THREE.Color(x);
  const base = C(sofaColor), light = base.clone().lerp(C('#ffffff'), 0.12), dark = base.clone().multiplyScalar(0.7);
  const parts = [
    { geo: roundedBox(THREE, W, 0.26, 0.98, 0.08, 6), m: mat4(THREE, [0, 0.17, 0.0]), c: dark },
    { geo: roundedBox(THREE, W - 0.34, 0.14, 0.8, 0.06, 6), m: mat4(THREE, [0, 0.38, -0.04]), c: base },
    { geo: roundedBox(THREE, W, 0.48, 0.22, 0.09, 6), m: mat4(THREE, [0, 0.58, 0.42], [1, 1, 1], [-0.12, 0, 0]), c: base },
    { geo: roundedBox(THREE, 0.2, 0.5, 0.98, 0.09, 5), m: mat4(THREE, [-W / 2 + 0.1, 0.42, 0]), c: light },
    { geo: roundedBox(THREE, 0.2, 0.5, 0.98, 0.09, 5), m: mat4(THREE, [W / 2 - 0.1, 0.42, 0]), c: light },
  ];
  for (let i = 0; i < people; i++) parts.push({ geo: roundedBox(THREE, slot * 0.92, 0.4, 0.2, 0.09, 5), m: mat4(THREE, [(i - (people - 1) / 2) * slot, 0.62, 0.3], [1, 1, 1], [-0.1, 0, 0]), c: i % 2 ? light : base });
  if (pillow) parts.push({ geo: roundedBox(THREE, 0.36, 0.36, 0.14, 0.07, 5), m: mat4(THREE, [W / 2 - 0.5, 0.66, 0.24], [1, 1, 1], [-0.15, 0.2, 0.3]), c: C(PAL.amber).multiplyScalar(0.6) });
  const geo = mergeGeos(THREE, parts);
  // vertex colours: per part
  const colArr = []; parts.forEach((pt) => { const n = (pt.geo.index ? pt.geo.toNonIndexed() : pt.geo).attributes.position.count; for (let i = 0; i < n; i++) colArr.push(pt.c.r, pt.c.g, pt.c.b); });
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colArr), 3));
  const fc = faces ?? facing === 'camera';
  const core = createCrowdCore(THREE, { persons, style, faces: fc, seed, facing, rim: { strength: 1.6 } });
  const sofaMat = core.kit.mk({ color: '#ffffff', roughness: 0.9, vertexColors: true });
  const sm = new THREE.Mesh(geo, sofaMat); sm.frustumCulled = false; sm.onBeforeRender = (r, s, cam) => core.kit.sync(cam); sm.castShadow = true; core.group.add(sm);
  if (facing === 'camera') sm.rotation.y = Math.PI;
  core.group.name = 'couch'; core.sofa = sm; core.width = W;
  const upd = core.update;
  core.update = (T, opts = {}) => upd(T, { ...opts });
  core.update({ t: 0, beat: 0 }, {});
  return core;
}

// ===============================================================================================================
// 3) PARTICLE AUDIENCE + 4) ORCHESTRA OF LIGHT — point clouds of light, animated entirely in the vertex shader
// ===============================================================================================================
const rotY = (x, z, a) => { const c = Math.cos(a), s = Math.sin(a); return [x * c + z * s, -x * s + z * c]; };

// seated bean person as a cloud of points (local frame: faces -Z, floor y=0). part: 0 body, 1 head, 2 arm L, 3 arm R, 4 spark, 5 floor ring
function samplePerson(r, n) {
  const out = [], nb = Math.round(n * 0.44), nh = Math.round(n * 0.2), na = Math.round(n * 0.09), ns = Math.round(n * 0.09), nr = Math.max(2, n - nb - nh - 2 * na - ns);
  const B0 = 0.38, BH = 0.58, RX = 0.25, RZ = 0.18;
  let guard = 0;
  // body: 65 % on the bean's surface (so the outline reads), 35 % in the volume
  while (out.length < nb && guard++ < 6000) {
    const y = B0 + r() * BH, u = (y - B0) / BH, a = r() * TAU;
    const w = u < 0.2 ? Math.sqrt(Math.max(0, 1 - ((0.2 - u) / 0.2) ** 2)) : u > 0.8 ? Math.sqrt(Math.max(0, 1 - ((u - 0.8) / 0.2) ** 2)) : 1;
    const surf = r() < 0.65 ? 1 : Math.sqrt(r());
    out.push({ x: Math.cos(a) * RX * w * surf, y, z: Math.sin(a) * RZ * w * surf, part: 0 });
  }
  for (let i = 0; i < nh; i++) { const g = [r.gauss(), r.gauss(), r.gauss()], l = Math.hypot(...g) || 1, rad = 0.17 * (r() < 0.7 ? 1 : Math.cbrt(r())); out.push({ x: (g[0] / l) * rad, y: 1.08 + (g[1] / l) * rad, z: (g[2] / l) * rad, part: 1 }); }
  for (let s = 0; s < 2; s++) for (let i = 0; i < na; i++) { const side = s ? 1 : -1, t = r() * 0.27, a = r() * TAU, rr = 0.05 * Math.sqrt(r()); out.push({ x: side * 0.21 + Math.cos(a) * rr, y: 0.8 - t, z: Math.sin(a) * rr, part: 2 + s, px: side * 0.21, py: 0.8, pz: 0 }); }
  for (let i = 0; i < ns; i++) out.push({ x: (r() * 2 - 1) * 0.25, y: 1.3 + r() * 0.3, z: (r() * 2 - 1) * 0.25, part: 4 });
  for (let i = 0; i < nr; i++) { const a = r() * TAU; out.push({ x: Math.cos(a) * 0.42, y: 0.02, z: Math.sin(a) * 0.42, part: 5 }); }
  return out;
}

const PT_VERT_COMMON = `
const float TAU = 6.2831853;
float easeBack(float x){ x = clamp(x, 0.0, 1.0); float c1 = 2.0, c3 = c1 + 1.0; return 1.0 + c3 * pow(x - 1.0, 3.0) + c1 * pow(x - 1.0, 2.0); }
vec3 hsv2rgb(vec3 c){ vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0); vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www); return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y); }
vec3 rotA(vec3 v, vec3 k, float a){ float c = cos(a), s = sin(a); return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c); }
float hash11(float n){ return fract(sin(n * 127.1) * 43758.5453); }
`;
const PT_FRAG = `precision highp float; varying vec3 vCol; varying float vA; uniform float uCut;
void main(){ vec2 d = gl_PointCoord - 0.5; float r2 = dot(d, d) * 4.0; float a = exp(-r2 * 4.0) * vA; if (a < uCut) discard; gl_FragColor = vec4(vCol, a); }`;

function pointsMaterial(THREE, vertex, uniforms, { depthWrite = true } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: vertex, fragmentShader: PT_FRAG, uniforms: { uHalfH: { value: 540 }, uCut: { value: depthWrite ? 0.22 : 0.02 }, ...uniforms },
    transparent: true, depthWrite, depthTest: true, blending: THREE.AdditiveBlending, toneMapped: false,
  });
}
// keep uHalfH (half the current render-target height in px) up to date for perspective-correct sprite sizes
function hookPoints(THREE, points, mat) {
  const v2 = new THREE.Vector2();
  points.frustumCulled = false;
  points.onBeforeRender = (renderer) => { const rt = renderer.getRenderTarget(); let h; if (rt) h = rt.height; else { renderer.getDrawingBufferSize(v2); h = v2.y; } mat.uniforms.uHalfH.value = h / 2; };
}

// ---------------------------------------------------------------------------------------------------------------
export function createParticleAudience(THREE, { count = 72, seed = 5, bounds = {}, layout = 'rows', pointsPerPerson = 130, size = 0.03, focus = null, depthWrite = true, hue = 0.58, aura = 1 } = {}) {
  seed = iseed(seed); const r = mkRng(seed ^ 0x9e37);
  const B = { w: 14, d: 9, cx: 0, cz: 0, y: 0, ...bounds };
  // layout
  const people = [];
  if (layout === 'ring') {
    let placed = 0, ring = 0;
    while (placed < count) { const rad = 2.4 + ring * 1.15, cap = Math.max(4, Math.round((TAU * rad) / 1.05)); for (let i = 0; i < cap && placed < count; i++, placed++) { const a = (i / cap) * TAU + ring * 0.5 + (H(seed, placed, 1) - 0.5) * 0.12; people.push({ x: B.cx + Math.cos(a) * rad, z: B.cz + Math.sin(a) * rad * (B.d / B.w * 1.4 > 0.4 ? 1 : 1), face: [B.cx, B.cz] }); } ring++; }
  } else if (layout === 'scatter') {
    for (let i = 0; i < count; i++) people.push({ x: B.cx + (H(seed, i, 1) - 0.5) * B.w, z: B.cz + (H(seed, i, 2) - 0.5) * B.d, face: focus ? [focus[0], focus[2]] : null });
  } else {
    const nR = Math.max(1, Math.round(Math.sqrt((count * B.d) / B.w))), nC = Math.ceil(count / nR); let k = 0;
    for (let rr = 0; rr < nR && k < count; rr++) for (let cc = 0; cc < nC && k < count; cc++, k++) people.push({ x: B.cx + ((cc + 0.5) / nC - 0.5) * B.w + (H(seed, k, 1) - 0.5) * (B.w / nC) * 0.5, z: B.cz + ((rr + 0.5) / nR - 0.5) * B.d + (H(seed, k, 2) - 0.5) * (B.d / nR) * 0.5, face: focus ? [focus[0], focus[2]] : null, row: rr });
  }
  const N = people.length, per = [], P = [];
  const att = { pos: [], root: [], per: [], pt: [], pivot: [], K: [], org: [] };
  people.forEach((pp, i) => {
    const yaw = pp.face ? Math.atan2(pp.x - pp.face[0], pp.z - pp.face[1]) : 0, k = 0.92 + 0.2 * H(seed, i, 3);
    const pts = samplePerson(r, pointsPerPerson);
    const standDelay = 0.5 * H(seed, i, 4) + (pp.row || 0) * 0.03, litDelay = 1.1 * H(seed, i, 5), hueOff = H(seed, i, 6), ph = H(seed, i, 7);
    for (const q of pts) {
      let [x, z] = rotY(q.x * k, q.z * k, yaw); const y = q.y * k;
      att.pos.push(x, y, z); att.root.push(pp.x, B.y, pp.z); att.per.push(ph, standDelay, litDelay, hueOff);
      att.pt.push((0.7 + 0.6 * r()) * (q.part === 1 ? 1.1 : q.part === 5 ? 0.8 : 1), r(), r(), q.part);
      if (q.part === 2 || q.part === 3) { const [px, pz] = rotY(q.px * k, q.pz * k, yaw), side = q.part === 3 ? 1 : -1, [kx, kz] = rotY(0, side, yaw); att.pivot.push(px, q.py * k, pz); att.K.push(kx, 0, kz); } else { att.pivot.push(0, 0, 0); att.K.push(0, 0, 0); }
      att.org.push((r() - 0.5) * 16, 2 + r() * 9, (r() - 0.5) * 16);
    }
  });
  const geo = new THREE.BufferGeometry(); const F = (a, n) => new THREE.BufferAttribute(new Float32Array(a), n);
  geo.setAttribute('position', F(att.pos, 3)); geo.setAttribute('aRoot', F(att.root, 3)); geo.setAttribute('aPer', F(att.per, 4)); geo.setAttribute('aPt', F(att.pt, 4)); geo.setAttribute('aPivot', F(att.pivot, 3)); geo.setAttribute('aK', F(att.K, 3)); geo.setAttribute('aOrg', F(att.org, 3));
  const vert = `${PT_VERT_COMMON}
attribute vec3 aRoot; attribute vec4 aPer; attribute vec4 aPt; attribute vec3 aPivot; attribute vec3 aK; attribute vec3 aOrg;
uniform float uTime, uStandT, uLitT, uCheerT, uIntensity, uHue, uHalfH, uSize, uReact, uAsm, uAura; uniform vec2 uBounce;
varying vec3 vCol; varying float vA;
void main(){
  float part = aPt.w, ph = aPer.x * TAU;
  float stand = easeBack((uTime - uStandT - aPer.y) / 0.55);
  float lit = smoothstep(0.0, 1.0, (uTime - uLitT - aPer.z) / 0.9);
  float cu = uTime - uCheerT - aPer.y * 0.5; float ch = cu > 0.0 ? min(1.0, cu / 0.1) * exp(-cu / 1.5) : 0.0;
  float lvl = max(max(uReact, ch * 0.95), min(stand, 1.0) * 0.9);
  vec3 p = position; float kS = 1.0 + 0.55 * stand; float alpha = 1.0;
  if (part < 1.5) { p.y *= kS; }
  else if (part < 3.5) {
    float thr = 0.12 + 0.75 * fract(aPer.x * 7.31 + (part - 2.0) * 0.37);
    float raise = smoothstep(thr - 0.1, thr + 0.1, lvl);
    float ang = mix(0.1, 2.6, raise) + raise * 0.2 * sin(uTime * 9.0 + ph) * step(0.15, ch);
    vec3 rel = rotA(p - aPivot, aK, ang) * (1.0 + 0.35 * raise);
    p = aPivot * vec3(1.0, kS, 1.0) + rel;
  } else if (part < 4.5) {
    float rise = fract(uTime * (0.10 + 0.12 * aPt.z) + aPt.y); p.y = 1.15 * kS + rise * 1.1; p.xz += vec2(sin(uTime * 0.8 + aPt.y * TAU), cos(uTime * 0.7 + aPt.z * TAU)) * 0.08 * rise; alpha = sin(rise * 3.14159);
  }
  if (part > 6.5) { p.y *= kS; }
  if (part < 4.5 || part > 6.5) { p.y += ch * 0.13 * abs(sin(uTime * 7.5 + ph)); p.x += sin(uTime * 1.1 + ph) * 0.014 * p.y; p.z += cos(uTime * 0.9 + ph * 1.3) * 0.012 * p.y; }
  vec3 world = aRoot + p;
  float sa = clamp((uAsm - 0.55 * aPer.y - 0.02 * aPt.y) / 0.4, 0.0, 1.0), e = sa * sa * (3.0 - 2.0 * sa);
  if (e < 1.0) { vec3 o = aRoot + aOrg; float sw = (1.0 - e) * 3.0; vec3 d = o - world; world = mix(o, world, e); world.xz += vec2(-d.z, d.x) * 0.15 * sin(e * 3.14159) * (1.0 + aPt.y); }
  vec4 mv = modelViewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  float tw = 0.72 + 0.28 * sin(uTime * (2.0 + aPt.z * 5.0) + aPt.y * TAU);
  float spark = pow(max(0.0, sin(uTime * (1.0 + aPt.z * 3.0) + aPt.y * 50.0)), 24.0);
  float sz = uSize * aPt.x * (part > 6.5 ? 1.0 : (0.6 + 0.4 * tw + spark * 1.2)) * (1.0 + (part > 6.5 ? 0.0 : 0.6) * lit + 0.5 * lvl) * (0.4 + 0.6 * e) * 1.5;
  gl_PointSize = clamp(sz * uHalfH * projectionMatrix[1][1] / max(-mv.z, 0.1), 1.0, part > 6.5 ? 700.0 : 44.0);
  float hh = uHue + (aPer.w - 0.5) * 0.18 + part * 0.012;
  float val = (0.12 + 0.95 * lit) * (tw + spark) * uIntensity * (part > 4.5 ? 0.55 : 1.0) * (1.0 + 1.3 * ch) * (0.3 + 0.7 * e);
  vCol = hsv2rgb(vec3(hh, 0.5 + 0.3 * lit - 0.25 * spark, 1.0)) * val; vA = alpha;
  if (part > 6.5) { vCol = hsv2rgb(vec3(hh, 0.65, 1.0)) * (0.05 + 0.5 * lit) * uIntensity * uAura * (0.5 + 0.5 * e) * (1.0 + 1.5 * ch + 0.5 * lvl); vA = 1.0; }
}`;
  const mat = pointsMaterial(THREE, vert, {
    uTime: { value: 0 }, uStandT: { value: 1e6 }, uLitT: { value: -1e6 }, uCheerT: { value: 1e6 }, uIntensity: { value: 1 }, uHue: { value: hue }, uSize: { value: size }, uReact: { value: 0 }, uAsm: { value: 2 }, uBounce: { value: new THREE.Vector2() }, uAura: { value: aura },
  }, { depthWrite });
  const points = new THREE.Points(geo, mat); points.name = 'particleAudience'; hookPoints(THREE, points, mat);
  const group = new THREE.Group(); group.add(points);
  // soft aura: one big dim sprite per person (reads as a glowing figure from afar). No depth write.
  let auraPts = null;
  if (aura > 0) {
    const ag = { pos: [], root: [], per: [], pt: [], pivot: [], K: [], org: [] };
    people.forEach((pp, i) => { ag.pos.push(0, 0.72, 0); ag.root.push(pp.x, B.y, pp.z); ag.per.push(H(seed, i, 7), 0.5 * H(seed, i, 4) + (pp.row || 0) * 0.03, 1.1 * H(seed, i, 5), H(seed, i, 6)); ag.pt.push(30, 0.5, 0.5, 7); ag.pivot.push(0, 0, 0); ag.K.push(0, 0, 0); ag.org.push((H(seed, i, 8) - 0.5) * 16, 2 + 9 * H(seed, i, 9), (H(seed, i, 10) - 0.5) * 16); });
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', F(ag.pos, 3)); g2.setAttribute('aRoot', F(ag.root, 3)); g2.setAttribute('aPer', F(ag.per, 4)); g2.setAttribute('aPt', F(ag.pt, 4)); g2.setAttribute('aPivot', F(ag.pivot, 3)); g2.setAttribute('aK', F(ag.K, 3)); g2.setAttribute('aOrg', F(ag.org, 3));
    const m2 = pointsMaterial(THREE, vert, { ...mat.uniforms, uCut: { value: 0.0 } }, { depthWrite: false });
    auraPts = new THREE.Points(g2, m2); auraPts.name = 'particleAudienceAura'; auraPts.frustumCulled = false; auraPts.renderOrder = 2; group.add(auraPts);
  }
  const U = mat.uniforms;
  return {
    group, points, aura: auraPts, count: N, positions: people.map((p) => [p.x, B.y, p.z]), material: mat,
    update(T, { standT = 1e6, litT = -1e6, intensity = 1, hue: hh = hue, cheerT = 1e6, react = 0, assemble = null } = {}) {
      U.uTime.value = T.t; U.uStandT.value = standT; U.uLitT.value = litT; U.uIntensity.value = intensity; U.uHue.value = hh; U.uCheerT.value = cheerT;
      U.uReact.value = typeof react === 'function' ? clamp(react(T.t)) : react;
      U.uAsm.value = assemble ? clamp((T.t - assemble[0]) / (assemble[1] - assemble[0])) : 2;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// 4) ORCHESTRA OF LIGHT
// ---------------------------------------------------------------------------------------------------------------
export function createOrchestraOfLight(THREE, { seed = 7, count = 32, radius = 2.7, rowGap = 1.3, arc = 3.9, size = 1, sparks = 420, pointSize = 0.032, depthWrite = true } = {}) {
  seed = iseed(seed); const r = mkRng(seed ^ 0x0ac4);
  const colv = (hex, m = 1) => { const c = new THREE.Color(hex); return [c.r * m, c.g * m, c.b * m]; };
  const SEC = { vn: colv(PAL.amber, 1.5), va: colv('#ff8a4a', 1.5), vc: colv(PAL.vermilion, 1.6), fl: colv(PAL.teal, 1.7), br: colv('#ffd36b', 1.8), tp: colv(PAL.violet, 2.0), hp: colv(PAL.sky, 1.7) };
  const PAPER = colv(PAL.cream, 1.3), WHITE = colv('#ffffff', 1.5);
  const A = { pos: [], org: [], col: [], pt: [], per: [], ax: [] };
  const push = (x, y, z, o) => { A.pos.push(x, y, z); A.org.push(...(o.org || [0, 0, 0])); A.col.push(...o.c); A.pt.push(o.s ?? (0.7 + 0.6 * r()), r(), r(), o.part); A.per.push(o.ph ?? 0, o.start ?? 0, o.f ?? 1, o.a ?? 0); A.ax.push(...(o.ax || [1, 0, 0])); };
  const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], vmul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const vnorm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }, vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  // ---- layout
  const rowsDef = count <= 36 ? [0.38, 0.34, 0.28] : [0.3, 0.27, 0.23, 0.2];
  const rowN = rowsDef.map((w) => Math.round(count * w)); rowN[rowN.length - 1] += count - rowN.reduce((a, b) => a + b, 0);
  const KINDS = [['vn', 'vn', 'va', 'vn', 'vn', 'va'], ['vc', 'fl', 'fl', 'vc', 'fl', 'fl', 'vc'], ['br', 'br', 'hp', 'br', 'br'], ['tp', 'br', 'tp', 'hp']];
  const musicians = [];
  rowN.forEach((n, j) => { const R = radius + j * rowGap, ar = arc * (1 - 0.09 * j); for (let s = 0; s < n; s++) { const th = ((s + 0.5) / n - 0.5) * ar; let kind = KINDS[Math.min(j, KINDS.length - 1)][s % KINDS[Math.min(j, KINDS.length - 1)].length]; if (rowsDef.length === 3 && j === 2 && s === n - 1) kind = 'tp'; if (j === rowN.length - 1 && s === 0) kind = 'hp'; musicians.push({ x: R * Math.sin(th), z: -R * Math.cos(th), y: j * 0.3, kind, j, s, n }); } });
  // ---- instrument builders (local frame, faces -Z, +X right). each returns hands {L,R}; points are emitted through E()
  function buildMusician(m, mi) {
    const yaw = Math.atan2(m.x, m.z), sec = SEC[m.kind], k = size * (m.kind === 'va' ? 1.04 : 1);
    const ph = H(seed, mi, 1), grpStart = 0.5 * H(seed, mi, 2);
    const E = (x, y, z, o) => { // local -> world
      x *= k; y *= k; z *= k; const [wx, wz] = rotY(x, z, yaw);
      const ax = o.ax ? (() => { const [ax_, az_] = rotY(o.ax[0], o.ax[2], yaw); return [ax_, o.ax[1], az_]; })() : [Math.cos(yaw), 0, -Math.sin(yaw)];
      const start = grpStart + 0.1 * r() + (o.part === 4 ? -0.05 : o.part === 3 ? 0.06 : 0);
      const oo = { org: [m.x + wx * 0 + (r() - 0.5) * 16, 2 + r() * 10, m.z + (r() - 0.5) * 16], ph, start: clamp(start, 0, 0.59), ...o, ax };
      push(m.x + wx, m.y + y, m.z + wz, oo);
    };
    const lat = [1, 0, 0];
    // body + head
    for (const q of samplePerson(r, 210)) if (q.part < 2) {
      const lean = -0.14 * Math.max(0, q.y - 0.38); // lean toward the conductor
      E(q.x, q.y, q.z + lean, { part: q.part, c: q.part === 1 ? vmul(sec, 1.5) : vmul(sec, 1.1), ax: lat, f: 1, a: 0.03 * clamp((q.y - 0.35) / 0.7) });
    }
    const line = (a, b, n, o, jit = 0.012) => { for (let i = 0; i < n; i++) { const t = n === 1 ? 0.5 : i / (n - 1); const p = vadd(vmul(a, 1 - t), vmul(b, t)); E(p[0] + (r() - 0.5) * jit, p[1] + (r() - 0.5) * jit, p[2] + (r() - 0.5) * jit, o); } };
    const ellipse = (c, u, v, ru, rv, n, o, fill = 0.35) => { for (let i = 0; i < n; i++) { const a = (i / n) * TAU + r() * 0.4, rr = 1 - fill * r(); const p = vadd(c, vadd(vmul(u, Math.cos(a) * ru * rr), vmul(v, Math.sin(a) * rv * rr))); E(p[0], p[1], p[2], o); } };
    const arm = (sh, hand, o, ampHand) => { for (let i = 0; i < 9; i++) { const t = i / 8, p = vadd(vmul(sh, 1 - t), vmul(hand, t)); E(p[0] + (r() - 0.5) * 0.03, p[1] + (r() - 0.5) * 0.03, p[2] + (r() - 0.5) * 0.03, { part: 2, c: vmul(sec, 1.0), ax: o.ax || lat, f: o.f || 1, a: (o.a ?? 0.02) * (0.2 + 0.8 * t) }); } };
    const shL = [-0.21, 0.82, -0.02], shR = [0.21, 0.82, -0.02], up = [0, 1, 0];
    const ic = vmul(PAPER, 0.85), ib = vmul(sec, 1.1);
    const stand = () => {
      line([0, 0.55, -0.8], [0, 0.98, -0.8], 4, { part: 4, c: vmul(PAPER, 0.35), ax: lat, a: 0 }, 0.01);
      for (let i = 0; i < 4; i++) for (let jr = 0; jr < 2; jr++) E(-0.2 + 0.13 * i, 1.06 + 0.14 * jr, -0.84 - 0.02 * jr, { part: 4, c: vmul(PAPER, 0.55), ax: lat, a: 0, s: 0.6 });
    };
    switch (m.kind) {
      case 'vn': case 'va': {
        const chin = [-0.1, 1.0, -0.26], d = vnorm([-0.2, -0.02, -0.52]), u = vnorm(vcross(up, d));
        ellipse(vadd(chin, vmul(d, 0.16)), d, u, 0.11, 0.075, 14, { part: 3, c: ic, ax: lat, f: 1, a: 0.03 }); ellipse(vadd(chin, vmul(d, 0.36)), d, u, 0.12, 0.09, 16, { part: 3, c: ic, ax: lat, f: 1, a: 0.03 });
        line(vadd(chin, vmul(d, 0.46)), vadd(chin, vmul(d, 0.85)), 9, { part: 3, c: ib, ax: lat, f: 1, a: 0.03 });
        const b0 = [0.3, 0.8, -0.36], b1 = [-0.2, 0.95, -0.7], bd = vnorm(vsub(b1, b0)); line(b0, b1, 16, { part: 3, c: WHITE, ax: bd, f: 4, a: 0.12 }, 0.006);
        arm(shL, vadd(chin, vmul(d, 0.7)), { a: 0.02 }); arm(shR, b0, { ax: bd, f: 4, a: 0.06 }); stand(); break;
      }
      case 'vc': {
        const dd = vnorm([0, 1, 0.12]), uu = [1, 0, 0];
        ellipse([0, 0.74, -0.34], dd, uu, 0.17, 0.15, 14, { part: 3, c: ic, ax: lat, f: 1, a: 0.02 }); ellipse([0, 0.4, -0.33], dd, uu, 0.23, 0.2, 18, { part: 3, c: ic, ax: lat, f: 1, a: 0.02 });
        line([0, 0.9, -0.34], [0.02, 1.42, -0.26], 10, { part: 3, c: ib, ax: lat, f: 1, a: 0.02 }); line([0, 0.2, -0.32], [0, 0, -0.3], 4, { part: 3, c: ib, ax: lat, f: 1, a: 0 });
        const b0 = [0.55, 0.62, -0.5], b1 = [-0.2, 0.62, -0.46]; line(b0, b1, 16, { part: 3, c: WHITE, ax: [1, 0, 0], f: 3, a: 0.14 }, 0.006);
        arm(shL, [0.0, 1.1, -0.3], { a: 0.02 }); arm(shR, b0, { ax: [1, 0, 0], f: 3, a: 0.07 }); stand(); break;
      }
      case 'fl': {
        line([-0.08, 1.0, -0.2], [0.78, 1.03, -0.36], 22, { part: 3, c: vmul(sec, 1.3), ax: up, f: 1.5, a: 0.015 }, 0.008);
        for (let i = 0; i < 5; i++) E(0.05 + 0.13 * i, 1.04, -0.26 - 0.02 * i, { part: 3, c: WHITE, ax: up, f: 1.5, a: 0.015 });
        arm(shL, [0.3, 1.0, -0.28], { ax: up, f: 1.5, a: 0.015 }); arm(shR, [0.55, 1.01, -0.32], { ax: up, f: 1.5, a: 0.015 }); stand(); break;
      }
      case 'br': {
        for (let i = 0; i < 20; i++) { const a = (i / 20) * TAU; E(0.05 + 0.02 * Math.sin(a * 3), 0.78 + Math.sin(a) * 0.13, -0.4 + Math.cos(a) * 0.13, { part: 3, c: ib, ax: up, f: 1, a: 0.02 }); }
        line([0.05, 1.0, -0.2], [0.05, 0.9, -0.5], 6, { part: 3, c: ib, ax: up, f: 1, a: 0.02 });
        for (let i = 0; i < 6; i++) { const t = i / 5, c = [0.05, 0.92 + 0.12 * t, -0.52 - 0.5 * t], rad = 0.035 + 0.19 * t * t; for (let q = 0; q < 8; q++) { const a = (q / 8) * TAU + i; E(c[0] + Math.cos(a) * rad, c[1] + Math.sin(a) * rad, c[2], { part: 3, c: vmul(sec, 1.2), ax: up, f: 1, a: 0.045 }); } }
        arm(shL, [0.0, 0.9, -0.42], { ax: up, f: 1, a: 0.02 }); arm(shR, [0.08, 0.9, -0.38], { ax: up, f: 1, a: 0.02 }); stand(); break;
      }
      case 'tp': {
        for (const sx of [-1, 1]) {
          const c = [sx * 0.42, 0.5, -0.6];
          for (let i = 0; i < 34; i++) { const a = r() * TAU, e = Math.acos(r()) * 0.5 + Math.PI / 2; E(c[0] + Math.cos(a) * Math.sin(e) * 0.34, c[1] + Math.cos(e) * 0.34, c[2] + Math.sin(a) * Math.sin(e) * 0.34, { part: 3, c: ic, ax: up, f: 1, a: 0.0 }); }
          for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; E(c[0] + Math.cos(a) * 0.34, c[1], c[2] + Math.sin(a) * 0.34, { part: 3, c: WHITE, ax: up, f: 1, a: 0 }); }
          for (let i = 0; i < 10; i++) { const a = r() * TAU, rr = Math.sqrt(r()) * 0.3; E(c[0] + Math.cos(a) * rr, c[1] + 0.01, c[2] + Math.sin(a) * rr, { part: 3, c: vmul(sec, 1.4), ax: up, f: 1, a: -0.015 }); }
          line([sx * 0.16, 0.86, -0.3], [sx * 0.4, 0.62, -0.58], 8, { part: 3, c: WHITE, ax: up, f: 2 + (sx > 0 ? 0 : 0), a: -0.1 }, 0.006);
          arm(vmul([sx, 0, 0], 0.21).map((v, i) => v + [0, 0.82, -0.02][i]), [sx * 0.16, 0.86, -0.3], { ax: up, f: 2, a: -0.03 });
        }
        break;
      }
      case 'hp': {
        const x0 = 0.85; line([x0, 0, -0.45], [x0, 1.6, -0.45], 14, { part: 3, c: ib, ax: lat, f: 1, a: 0.01 });
        for (let i = 0; i < 12; i++) { const t = i / 11; E(lerp(x0, 0.15, t) , 1.6 - 0.28 * Math.sin(t * Math.PI * 0.8) * 0 - 0.22 * t * 0.9 + 0.08 * Math.sin(t * Math.PI), -0.45, { part: 3, c: ib, ax: lat, f: 1, a: 0.01 }); }
        line([0.15, 1.4, -0.45], [x0, 0.1, -0.45], 16, { part: 3, c: ic, ax: lat, f: 1, a: 0.01 });
        for (let sI = 0; sI < 9; sI++) { const t = (sI + 1) / 10, x = lerp(0.2, x0 - 0.05, t); line([x, lerp(1.4, 1.58, t) - 0.1 * Math.sin(t * Math.PI), -0.45], [x, lerp(0.2, 0.1, t) + (1 - t) * 1.1, -0.45], 7, { part: 3, c: WHITE, ax: [0, 0, 1], f: 6, a: 0.014 }, 0.004); }
        arm(shL, [0.5, 0.95, -0.42], { ax: [0, 0, 1], f: 6, a: 0.012 }); arm(shR, [0.65, 0.78, -0.42], { ax: [0, 0, 1], f: 6, a: 0.012 }); stand(); break;
      }
    }
  }
  musicians.forEach(buildMusician);
  // ---- podium rings (conductor) + ambient sparks + shock rings
  for (const [R, n] of [[0.95, 90], [0.6, 56]]) for (let i = 0; i < n; i++) { const a = (i / n) * TAU; push(Math.cos(a) * R, 0.02, Math.sin(a) * R, { part: 7, c: colv(PAL.amber, 2.2), org: [0, 0, 0], s: 0.9, ax: [0, 1, 0] }); }
  for (let i = 0; i < sparks; i++) { const a = r() * TAU, rr = 1.5 + Math.sqrt(r()) * 9; push(Math.cos(a) * rr, r() * 7, Math.sin(a) * rr, { part: 5, c: colv(r() < 0.5 ? PAL.amber : PAL.sky, 1.4), s: 0.5 + 0.8 * r(), f: r() }); }
  for (let L = 0; L < 3; L++) for (let i = 0; i < 300; i++) { const a = (i / 300) * TAU + L * 0.3; push(Math.cos(a), L / 2, Math.sin(a), { part: 6, c: colv('#fff1c8', 2.4), s: 1.0 }); }
  const N = A.pos.length / 3;
  const geo = new THREE.BufferGeometry(); const F = (a, n) => new THREE.BufferAttribute(new Float32Array(a), n);
  geo.setAttribute('position', F(A.pos, 3)); geo.setAttribute('aOrg', F(A.org, 3)); geo.setAttribute('aCol', F(A.col, 3)); geo.setAttribute('aPt', F(A.pt, 4)); geo.setAttribute('aPer', F(A.per, 4)); geo.setAttribute('aAx', F(A.ax, 3));
  const vert = `${PT_VERT_COMMON}
attribute vec3 aOrg; attribute vec3 aCol; attribute vec4 aPt; attribute vec4 aPer; attribute vec3 aAx;
uniform float uTime, uBeat, uAsm, uIntensity, uHalfH, uSize, uBurst, uRingAge, uPlay;
varying vec3 vCol; varying float vA;
void main(){
  float part = aPt.w; vec3 p = position; float alpha = 1.0, e = 1.0;
  if (part < 4.5) {
    float sa = clamp((uAsm - aPer.y) / 0.4, 0.0, 1.0); e = sa * sa * (3.0 - 2.0 * sa);
    float arg = uBeat * 3.14159265 * aPer.z + aPer.x * TAU; float osc = aPer.w < 0.0 ? (abs(sin(arg)) * 2.0 - 1.0) : sin(arg);
    vec3 q = p + aAx * osc * abs(aPer.w) * uPlay * e;
    if (e < 1.0) { vec3 d = aOrg - q; q = mix(aOrg, q, e); q += vec3(-d.z, 0.0, d.x) * 0.12 * sin(e * 3.14159); }
    p = q;
  } else if (part < 5.5) {
    float rise = fract(position.y / 7.0 + uTime * (0.03 + 0.05 * aPer.z)); p.y = rise * 7.0; p.xz += vec2(sin(uTime * 0.4 + aPt.y * TAU), cos(uTime * 0.35 + aPt.z * TAU)) * 0.5; alpha = sin(rise * 3.14159) * mix(1.0, 0.45, smoothstep(0.0, 1.0, uAsm));
  } else if (part < 6.5) {
    if (uRingAge < 0.0 || uRingAge > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vCol = vec3(0.0); vA = 0.0; return; }
    float R = 0.8 + uRingAge * 15.0; p = vec3(position.x * R, 0.05 + position.y * 0.18, position.z * R); alpha = pow(1.0 - uRingAge, 2.0);
  } else {
    alpha = smoothstep(0.0, 0.25, uAsm) * (0.75 + 0.25 * sin(uBeat * 3.14159265 * 2.0));
  }
  if (part < 4.5) { vec3 dir = p - vec3(0.0, 0.8, 0.0); float L = max(length(dir), 0.2); p += dir / L * uBurst * (0.1 + 0.3 * fract(aPt.y * 13.7)); }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float tw = 0.78 + 0.22 * sin(uTime * (2.0 + aPt.z * 5.0) + aPt.y * TAU);
  float spark = pow(max(0.0, sin(uTime * (1.0 + aPt.z * 3.0) + aPt.y * 50.0)), 30.0);
  float en = part < 4.5 ? mix(0.22, 1.0, e) : 1.0;
  float sz = uSize * aPt.x * (0.7 + 0.3 * tw + spark) * (0.45 + 0.55 * en) * (1.0 + 0.5 * uBurst) * (part > 5.5 && part < 6.5 ? 1.3 : 1.0) * 1.5;
  gl_PointSize = clamp(sz * uHalfH * projectionMatrix[1][1] / max(-mv.z, 0.1), 1.0, 46.0);
  vec3 c = aCol * (tw + spark * 1.2) * uIntensity * en * (1.0 + 1.1 * uBurst);
  c = mix(c, vec3(1.0, 0.92, 0.72) * dot(c, vec3(0.34)) * 1.3, clamp(uBurst * 0.3, 0.0, 0.4));
  vCol = c; vA = alpha;
}`;
  const mat = pointsMaterial(THREE, vert, { uTime: { value: 0 }, uBeat: { value: 0 }, uAsm: { value: 1 }, uIntensity: { value: 1 }, uSize: { value: pointSize }, uBurst: { value: 0 }, uRingAge: { value: -1 }, uPlay: { value: 1 } }, { depthWrite });
  const points = new THREE.Points(geo, mat); points.name = 'orchestraOfLight'; hookPoints(THREE, points, mat);
  const group = new THREE.Group(); group.add(points);
  const U = mat.uniforms, state = { asm: null, hits: [], intensity: 1, play: 1 };
  function refresh(T) {
    U.uTime.value = T.t; U.uBeat.value = T.beat ?? T.t * 2;
    U.uAsm.value = state.asm ? clamp((T.t - state.asm[0]) / Math.max(1e-4, state.asm[1] - state.asm[0])) : 1;
    let burst = 0, ring = -1;
    for (const ht of state.hits) { const age = T.t - ht; if (age >= -1 / 60 && age < 1.5) { burst += Math.exp(-Math.max(age, 0) / 0.2) * (age < 0 ? 0 : 1); if (age >= 0 && age < 1.0 && (ring < 0 || age < ring)) ring = age; } }
    U.uBurst.value = Math.min(burst, 1.5); U.uRingAge.value = ring; U.uIntensity.value = state.intensity; U.uPlay.value = state.play;
  }
  const api = {
    group, points, count: N, musicians: musicians.length, conductor: new THREE.Vector3(0, 0, 0), material: mat, layout: musicians,
    assemble(T, t0, t1) { state.asm = [t0, t1]; refresh(T); return U.uAsm.value; },
    hit(T, t) { if (!state.hits.includes(t)) state.hits.push(t); refresh(T); return Math.min(1.5, U.uBurst.value); },
    update(T, { assemble = state.asm, hits = null, intensity = state.intensity, play = state.play } = {}) {
      state.asm = assemble; if (hits) for (const h of hits) if (!state.hits.includes(h)) state.hits.push(h); state.intensity = intensity; state.play = play; refresh(T);
    },
  };
  return api;
}
