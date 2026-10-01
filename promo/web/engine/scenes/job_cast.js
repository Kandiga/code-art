// =============================================================================
// job_cast.js — "CAST" (34.0 – 36.0) · wide 28 mm on the soundstage.
//   34.00  cut in on five glowing spike MARKS laid in an arc; the first icon is already dropping in
//   34.25 + 0.25k  (foot_tap x5, pan -0.6..+0.6)  one stylized ICON character per beat hops down onto its mark: stretch in the air,
//                  big landing squash, shock ring + floor ring pulse + spark fan, its colour beam ignites, the mark locks on
//   35.50  (cast_ready) all five strike a pose (anticipation -> pop -> land), every mark flashes, Amrita snaps her clapperboard
//   35.5 - 36.0  held pose, beams breathing, poster frame
// Amrita (right third, face turned toward the cast, eyes snapping to every landing) watches with her clapper.
// Everything is a pure function of T.t (4 sub-frames per frame = motion blur). No Math.random / Date.now.
// Exports a few small helpers (decals, sparks, rings, env) so job_score.js shares the same lighting language.
// =============================================================================
import { createStage, rigThreePoint, setLook as stageSetLook, LOOKS } from '../stage3d.js';
import { createAmrita } from '../amrita3d.js';
import { createIconCast } from '../crowd3d.js';
import { createBeam, createHaze, pxScale, glowTexture } from '../fx3d.js';
import * as E from '../ease.js';
import { hash, rng as mkRng, noise1 } from '../rng.js';

const { clamp, lerp, smooth, smoother, outCubic, outBack } = E;
const TAU = Math.PI * 2;
const seg = (x, a, b) => clamp((x - a) / (b - a));
const PX = { amber: '#FFB62E', cream: '#FFF3D6', vermilion: '#F2542D', teal: '#1FB5A6', violet: '#6B5BFF', sky: '#7CC4FF', ink: '#0E0D12' };

// ============================== KIT (exported, shared with job_score) ===============================
/** 36 mm-gate focal length -> vertical fov in degrees for a given render aspect */
export function lensFov(mm, ratio = 2.39, gate = 36) { return (2 * Math.atan(Math.tan(Math.atan(gate / (2 * mm))) / ratio) * 180) / Math.PI; }

/** soft studio environment (PMREM) so clear-coated PBR has something to reflect */
export function makeEnv(THREE, renderer, boxes) {
  const sc = new THREE.Scene(); sc.background = new THREE.Color(0x020204);
  for (const b of boxes) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(b.w, b.h), new THREE.MeshBasicMaterial({ color: new THREE.Color(b.color).multiplyScalar(b.i), side: THREE.DoubleSide }));
    m.position.set(...b.pos); m.lookAt(0, 0, 0); sc.add(m);
  }
  const pm = new THREE.PMREMGenerator(renderer); const rt = pm.fromScene(sc, 0.035); pm.dispose();
  return rt.texture;
}

/** analytic spark bursts: every spark has a fixed birth time and flies on a drag+gravity arc computed in the vertex shader.
 *  bursts: [{t, pos:[x,y,z], n, speed:[a,b], life:[a,b], dir:[x,y,z], spread 0..1, size:[a,b] (m), color:[r,g,b] HDR, seed}] */
export function makeSparks(THREE, bursts, { gravity = [0, -1.6, 0], drag = 1.8 } = {}) {
  let N = 0; for (const b of bursts) N += b.n;
  const o = new Float32Array(N * 3), v = new Float32Array(N * 3), tl = new Float32Array(N * 3), col = new Float32Array(N * 3);
  let i = 0;
  bursts.forEach((b, bi) => {
    const r = mkRng((b.seed ?? bi) * 7919 + 101), dm = Math.hypot(...b.dir) || 1, dx = b.dir[0] / dm, dy = b.dir[1] / dm, dz = b.dir[2] / dm;
    for (let k = 0; k < b.n; k++, i++) {
      const u = r() * 2 - 1, ph = r() * TAU, s = Math.sqrt(1 - u * u), rx = s * Math.cos(ph), ry = u, rz = s * Math.sin(ph);
      let ax = lerp(dx, rx, b.spread), ay = lerp(dy, ry, b.spread), az = lerp(dz, rz, b.spread); const am = Math.hypot(ax, ay, az) || 1; ax /= am; ay /= am; az /= am;
      const sp = lerp(b.speed[0], b.speed[1], r());
      o.set([b.pos[0], b.pos[1], b.pos[2]], i * 3); v.set([ax * sp, ay * sp, az * sp], i * 3);
      tl.set([b.t + r() * 0.012, lerp(b.life[0], b.life[1], r()), lerp(b.size[0], b.size[1], r())], i * 3);
      const hot = r(); col.set([b.color[0] * (0.7 + 0.5 * hot), b.color[1] * (0.7 + 0.5 * hot), b.color[2] * (0.7 + 0.5 * hot)], i * 3);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(o, 3)); geo.setAttribute('aVel', new THREE.BufferAttribute(v, 3)); geo.setAttribute('aTL', new THREE.BufferAttribute(tl, 3)); geo.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPx: { value: 1000 }, uG: { value: new THREE.Vector3(...gravity) }, uDrag: { value: drag } },
    vertexShader: `attribute vec3 aVel; attribute vec3 aTL; attribute vec3 aCol; uniform float uTime,uPx,uDrag; uniform vec3 uG; varying vec3 vC; varying float vA;
      void main(){ float age = uTime - aTL.x; float life = aTL.y;
        if (age < 0.0 || age > life) { gl_Position = vec4(2.0,2.0,2.0,1.0); gl_PointSize = 0.0; vC = vec3(0.0); vA = 0.0; return; }
        float k = (1.0 - exp(-uDrag*age))/uDrag; vec3 p = position + aVel*k + 0.5*uG*age*age; p.y = max(p.y, 0.02);
        float x = age/life; vA = pow(1.0-x, 1.4) * smoothstep(0.0,0.03,age); vC = aCol * (1.0 + 2.0*(1.0-x));
        vec4 mv = modelViewMatrix*vec4(p,1.0); gl_Position = projectionMatrix*mv; gl_PointSize = max(aTL.z*(1.0-0.55*x)*uPx/max(-mv.z,0.1), 1.2); }`,
    fragmentShader: `varying vec3 vC; varying float vA; void main(){ float d = length(gl_PointCoord-0.5)*2.0; float a = smoothstep(1.0,0.0,d); float core = smoothstep(0.55,0.0,d); if (a*vA < 0.04) discard; gl_FragColor = vec4(vC*(0.5+1.5*core), a*vA); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false,
  });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 9; pts.name = 'sparks';
  pts.onBeforeRender = (r, sc, cam) => { mat.uniforms.uPx.value = pxScale(r, cam); };
  pts.userData.update = (t) => { mat.uniforms.uTime.value = t; };
  return pts;
}

/** camera-facing shock rings (additive). rings: [{t, pos, r0, r1, dur, color:[r,g,b], width?}] ; group.userData.update(t, camera) */
export function makeRings(THREE, rings) {
  const grp = new THREE.Group(); grp.name = 'rings';
  const geo = new THREE.RingGeometry(0.955, 1.0, 96, 1);
  const items = rings.map((r) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(...r.color), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide, toneMapped: false }));
    m.position.set(...r.pos); m.renderOrder = 8; m.visible = false; m.frustumCulled = false; grp.add(m); return { m, r };
  });
  grp.userData.update = (t, camera) => {
    for (const { m, r } of items) {
      const a = (t - r.t) / r.dur;
      if (a < 0 || a > 1) { m.visible = false; continue; }
      const e = 1 - (1 - a) ** 3, rad = lerp(r.r0, r.r1, e);
      m.visible = true; m.quaternion.copy(camera.quaternion); m.scale.set(rad, rad, 1); m.material.opacity = (1 - a) ** 2.2;
    }
  };
  return grp;
}

// ---- the glowing floor SPIKE MARK: dashed target ring + gaffer cross + soft pool + expanding floor shock rings (one draw call per mark)
export function makeMarkDecal(THREE, color, seed = 0) {
  const U = { uCol: { value: new THREE.Color(color) }, uOn: { value: 0.25 }, uAge: { value: -1 }, uFlash: { value: 0 }, uRot: { value: 0.35 + 0.4 * seed }, uTime: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `precision highp float; varying vec2 vUv; uniform vec3 uCol; uniform float uOn, uAge, uFlash, uRot, uTime;
      float aa(float d, float w){ return 1.0 - smoothstep(0.0, w, d); }
      void main(){
        vec2 p = (vUv - 0.5) * 3.6; float r = length(p);                              // metres
        float cs = cos(uRot), sn = sin(uRot); vec2 q = mat2(cs, -sn, sn, cs) * p;
        float w = 0.012 + fwidth(r) * 1.2;
        float cross = aa(min(abs(q.x), abs(q.y)) - 0.028, w) * aa(max(abs(q.x), abs(q.y)) - 0.30, w);
        float ang = atan(p.y, p.x);
        float dash = step(0.35, fract(ang * 3.8197 + uRot));                             // 24 dashes
        float ring = aa(abs(r - 0.56) - 0.018, w) * mix(1.0, dash, 0.55);
        float ring2 = aa(abs(r - 0.66) - 0.006, w) * 0.65;
        float pool = exp(-r * r / 0.42);
        float shock = 0.0, shock2 = 0.0;
        if (uAge >= 0.0) {
          float R = 0.45 + 1.35 * (1.0 - exp(-uAge * 6.5)); shock = aa(abs(r - R) - (0.035 + 0.05 * uAge), w + 0.01) * exp(-uAge * 4.2);
          float R2 = 0.35 + 1.0 * (1.0 - exp(-max(uAge - 0.07, 0.0) * 5.0)); shock2 = aa(abs(r - R2) - 0.018, w) * exp(-max(uAge - 0.07, 0.0) * 6.0) * step(0.07, uAge);
        }
        float k = uOn;
        vec3 c = uCol * (k * (cross * 1.5 + ring * 0.9 + ring2 * 0.6) + pool * (0.16 * k + 0.9 * uFlash * 0.4) + (shock * 1.8 + shock2 * 1.1))
               + vec3(1.0, 0.95, 0.85) * uFlash * (cross * 1.6 + ring * 0.9 + shock * 0.5);
        gl_FragColor = vec4(c, 1.0); }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), mat); m.rotation.x = -Math.PI / 2; m.position.y = 0.012; m.renderOrder = 2; m.frustumCulled = false; m.name = 'mark';
  m.userData.U = U;
  return m;
}

// beam brightness helper (createBeam keeps intensity in several places; set them all without re-allocating)
export function setBeamK(b, k) {
  b.uniforms.uInt.value = k; b.params.intensity = k;
  if (b.pool) b.pool.material.uniforms.uI.value = b.params.poolIntensity * k;
  if (b.glow) b.glow.material.color.copy(b.color).multiplyScalar(k * 0.9);
  const on = k > 0.004; b.mesh.visible = on; if (b.pool) b.pool.visible = on && b.pool.userData.ok !== false; if (b.glow) b.glow.visible = on;
}

// ============================== SCENE ===================================
const T0 = 34, T1 = 36;
// five spike marks in an arc that opens toward Amrita (right third). x, z in metres.
const MARKS = [[-3.5, -0.3], [-2.05, -1.05], [-0.6, -1.4], [0.85, -1.1], [2.3, -0.35]];
const KINDS = ['star', 'heart', 'crown', 'bolt', 'moon'];
const COLS = [PX.amber, PX.vermilion, PX.violet, PX.teal, PX.sky];
const BEAMC = ['#ffc460', '#ff7a62', '#8c7dff', '#3fe0c8', '#8fd0ff'];
const HDR = [[2.9, 1.9, 0.55], [2.9, 0.75, 0.45], [1.5, 1.1, 3.2], [0.45, 2.7, 2.4], [1.2, 2.3, 3.2]];
// final poses (yaw toward camera, roll)
const POSE = [{ yaw: 0.28, roll: -0.14 }, { yaw: -0.10, roll: 0.12 }, { yaw: 0.0, roll: -0.05 }, { yaw: 0.14, roll: 0.20 }, { yaw: -0.24, roll: -0.20 }];
const AM = [3.75, 1.02, 1.05];                    // Amrita's centre
const FALL = 0.5;                                 // drop-hop duration (s): lands exactly on the foot_tap
const BEAM_APEX_Y = 6.7;

export default {
  id: 'job_cast', kind: '3d', ratio: 2.39,
  setup({ THREE, S, renderer }) {
    const cues = S.cues;
    const taps = cues.SFX.filter((e) => e.id === 'foot_tap').map((e) => e.t).sort((a, b) => a - b);
    const ready = (cues.SFX.find((e) => e.id === 'cast_ready') || { t: 35.5 }).t;
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#04050a'); scene.fog = new THREE.FogExp2('#0a0b16', 0.012);
    const stage = createStage(THREE, { THREE, S, renderer }, { look: 'neutral', table: false, cases: false, cables: false, grips: false, tubes: false, marks: false });
    scene.add(stage.group);
    stageSetLook(stage, { ...LOOKS.neutral, washL: ['#2c4688', 0.46], washR: ['#6a3c92', 0.42], pool: ['#e49a4c', 0.5], haze: ['#7a8cc4', 0.5] }, { intensity: 1.45 });
    scene.environment = makeEnv(THREE, renderer, [
      { w: 7, h: 3.5, pos: [-5, 4, 6], color: '#ffe2b8', i: 4.5 }, { w: 2.4, h: 8, pos: [7, 3, -4], color: '#9fd4ff', i: 3.2 },
      { w: 9, h: 2, pos: [0, 8, 1], color: '#ffffff', i: 1.4 }, { w: 6, h: 2, pos: [3, 0.5, 6], color: '#ffb870', i: 0.9 },
    ]);
    scene.environmentIntensity = 0.55;
    // perf: no shadow maps (icons carry blob shadows, Amrita a contact shadow), weaker fill
    stage.lights.key.castShadow = false; stage.floor.receiveShadow = false; stage.cyc.receiveShadow = false;
    const camera = new THREE.PerspectiveCamera(lensFov(28), 2.39, 0.1, 90);

    // ---- Amrita + her chair
    const A = createAmrita(THREE);
    A.root.position.set(...AM); scene.add(A.root);
    A.contactShadow({ radius: 0.7, opacity: 0.5 });
    stage.chair.position.set(5.6, 0, -0.5); stage.chair.rotation.y = -0.85;
    stage.reflect(A.root, { strength: 0.8 });

    // ---- the cast
    const cast = createIconCast(THREE, { kinds: KINDS, seed: 3, size: 1.08 });
    cast.forEach((c) => { scene.add(c.root); stage.reflect(c.root, { strength: 0.85 }); });

    // ---- marks, beams, haze, rings, sparks
    const marks = MARKS.map(([x, z], k) => { const m = makeMarkDecal(THREE, COLS[k], k); m.position.set(x, 0.012, z); scene.add(m); return m; });
    const beams = MARKS.map(([x, z], k) => {
      const b = createBeam(THREE, { from: [x + (k - 2) * 0.55, BEAM_APEX_Y, z - 1.7], to: [x, 0, z], color: BEAMC[k], angle: 0.092, intensity: 0, noise: 1, steps: 9, soft: 0.5, falloff: 0.9, streak: 0.55, gain: 0.34, glow: false, pool: false, seed: k });
      b.material.depthWrite = true; scene.add(b.object); return b;
    });
    const haze = createHaze(THREE, { count: 520, seed: 5, bounds: { min: [-9, 0.2, -7], max: [9, 6.5, 6] }, size: 0.03, intensity: 1, ambient: 0.05, boost: 3.0, color: '#9db4e8', drift: [0.01, 0.02, 0.005], turbulence: 0.25 });
    haze.attachBeams(beams); scene.add(haze.object);
    const rings = [], bursts = [];
    MARKS.forEach(([x, z], k) => {
      const t = taps[k], c = HDR[k];
      rings.push({ t, pos: [x, 0.16, z], r0: 0.12, r1: 1.05, dur: 0.30, color: [c[0] * 0.8, c[1] * 0.8, c[2] * 0.8] });
      rings.push({ t: t + 0.05, pos: [x, 0.16, z], r0: 0.08, r1: 0.62, dur: 0.22, color: [1.4, 1.4, 1.3] });
      bursts.push({ t, pos: [x, 0.05, z], n: 26, speed: [0.7, 2.6], life: [0.28, 0.7], dir: [0, 1, 0.15], spread: 0.55, size: [0.012, 0.03], color: c, seed: 10 + k });
      bursts.push({ t: ready + 0.02, pos: [x, 0.3, z], n: 34, speed: [0.8, 3.4], life: [0.4, 0.95], dir: [0, 1, 0.2], spread: 0.8, size: [0.014, 0.036], color: c, seed: 30 + k });
      rings.push({ t: ready, pos: [x, 0.2, z], r0: 0.15, r1: 1.2, dur: 0.34, color: [c[0] * 0.8, c[1] * 0.8, c[2] * 0.8] });
    });
    // distant bokeh lights on the cyc: out-of-focus practicals give the wide shot depth (DOF turns them into discs)
    const bokeh = (() => {
      const n = 70, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), pal = [[1.0, 0.62, 0.22], [1.0, 0.85, 0.55], [0.35, 0.75, 1.0], [0.9, 0.35, 0.55], [0.4, 1.0, 0.85], [0.6, 0.5, 1.0]];
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1), x = lerp(-11, 11, u) + (hash(i, 1, 4) - 0.5) * 1.1, y = 0.5 + 4.2 * Math.pow(hash(i, 2, 4), 1.4), z = -7.6 - 1.2 * hash(i, 3, 4);
        pos.set([x, y, z], i * 3); const c = pal[Math.floor(hash(i, 4, 4) * pal.length) % pal.length], v = 0.35 + 1.1 * hash(i, 5, 4); col.set([c[0] * v, c[1] * v, c[2] * v], i * 3);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const m = new THREE.PointsMaterial({ size: 1.5, sizeAttenuation: true, map: glowTexture(THREE), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
      const p = new THREE.Points(g, m); p.frustumCulled = false; p.renderOrder = -2; return p;
    })();
    scene.add(bokeh);
    const sparks = makeSparks(THREE, bursts); scene.add(sparks);
    const ringsG = makeRings(THREE, rings); scene.add(ringsG);

    // rim + key + fill rigging (physical lights, candela)
    const L = stage.lights;
    L.key.color.set('#ffe2bc'); L.key.intensity = 260; L.key.position.set(-8.5, 7.5, 5.0); L.key.target.position.set(0.0, 0.9, -0.8); L.key.angle = 0.62; L.key.penumbra = 0.75; L.key.target.updateMatrixWorld();
    L.rim.color.set('#9fd8ff'); L.rim.intensity = 1100; L.rim.position.set(2.0, 11.5, -9.0); L.rim.target.position.set(0.6, 1.0, -0.5); L.rim.angle = 0.72; L.rim.penumbra = 0.8; L.rim.target.updateMatrixWorld();
    L.fill.color.set('#8a9cff'); L.fill.intensity = 40; L.fill.position.set(-7, 3.2, 5);
    L.amb.intensity = 0.55;
    // second rim (warm) dedicated to Amrita so her silhouette separates from the blue wash
    const amRim = new THREE.SpotLight('#ffb678', 150, 30, 0.5, 0.8, 2); amRim.position.set(8.2, 4.4, -3.0); amRim.target.position.set(AM[0], AM[1], AM[2]); amRim.target.updateMatrixWorld(); scene.add(amRim, amRim.target);

    const tmp = { v: new THREE.Vector3(), v2: new THREE.Vector3(), q: new THREE.Quaternion() };
    return { scene, camera, stage, A, cast, THREE, taps, ready, marks, beams, haze, sparks, ringsG, amRim, bokeh, tmp, S };
  },

  update(st, T, S) {
    const { THREE, camera, A, cast, marks, beams, haze, sparks, ringsG, stage, tmp, taps, ready, amRim } = st;
    const t = T.t, lt = clamp(T.lt, 0, 2), imp = Math.min(1, T.impact), D = globalThis.__dbg || {};
    if (globalThis.__dbg) {                                                   // developer toggles (tools only; never set in the render)
      beams.forEach((b) => { b.object.visible = !D.noBeams; }); haze.object.visible = !D.noHaze; st.bokeh.visible = !D.noBokeh; st.sparks.visible = !D.noSparks; st.ringsG.visible = !D.noRings;
      marks.forEach((m) => { m.visible = !D.noMarks; }); A.root.visible = !D.noAmrita; cast.forEach((c) => { if (D.noCast) c.root.visible = false; }); stage.group.visible = !D.noStage; st.amRim.visible = !D.noAmRim;
      stage.cyc.visible = !D.noCyc; stage.truss.visible = !D.noTruss; stage.group.traverse((o) => { if (o.name && o.name.startsWith('mist')) o.visible = !D.noMist; }); stage.floor.visible = !D.noFloor;
      { const m = stage.floorMat, key = (D.flClear ? 1 : 0) + (D.flBump ? 2 : 0) + (D.flRough ? 4 : 0);
        if (st._flKey !== key) { st._flKey = key; if (D.flClear) m.clearcoat = 0; if (D.flBump) m.bumpMap = null; if (D.flRough) m.roughnessMap = null; if (key) m.needsUpdate = true; } }
    }
    stage.update(t);

    // landing envelope helpers
    const since = (t0) => t - t0;
    const lastTap = (() => { let k = -1; for (let i = 0; i < taps.length; i++) if (t >= taps[i] - 1e-6) k = i; return k; })();
    const nextTap = Math.min(4, lastTap + 1);
    const rdy = since(ready);

    // ---------------- icons ----------------
    cast.forEach((c, k) => {
      const tk = taps[k], t0 = tk - FALL, [mx, mz] = MARKS[k];
      const to = [mx, 0, mz], from = [mx - 1.0 + 0.12 * k, k === 0 ? 3.4 : 4.7, mz - 0.55 + 0.15 * k];
      const P = POSE[k], yawBase = 0.18 * (k - 2) * -0.5 - 0.12;
      c.root.visible = t >= t0 - 0.02;
      c.pose({ yaw: yawBase });
      // ---- the drop-hop: free-fall from the rig on a diagonal arc (stretch + tumble), lands exactly on the foot_tap
      { const u = (t - t0) / FALL;
        if (u < 1) {
          const uu = Math.max(u, 0), y = to[1] + (from[1] - to[1]) * (1 - uu * uu), e = 1 - Math.pow(1 - uu, 1.7);
          c.root.position.set(lerp(from[0], to[0], e), y, lerp(from[2], to[2], uu));
          c.pose({ squash: 0.3 * smooth(uu) + 0.05 * Math.sin(uu * 9), yaw: yawBase - 0.35 * (1 - uu), roll: -0.55 * (1 - uu) * Math.sign(1 + 0.3 * (2 - k)), bob: 0 });
        } else c.root.position.set(to[0], to[1], to[2]);
      }
      const tau = t - tk, hh = hash(k, 11);
      const per = 1.5 + 0.5 * hash(k, 12), idleSq = 0.03 * Math.sin(t * TAU / per + hh * TAU);
      const groove = 0.45, f = ((T.beat % 1) + 1) % 1, gSq = groove * (-0.07 * Math.exp(-f / 0.12) + 0.035 * Math.exp(-((f - 0.5) ** 2) / 0.01));
      let sq = 0, roll = 0, bob = 0, yaw = yawBase, happy = 0, glow = 0;
      if (tau >= 0) {
        // landing squash + one tiny secondary hop (as spot(), plus a visible rebound)
        sq = -0.32 * Math.exp(-tau / 0.11) * Math.cos(tau * TAU * 3.0) * (tau < 0.8 ? 1 : 0);
        bob = 0.07 * Math.abs(Math.sin(clamp(tau - 0.16, 0, 0.2) / 0.2 * Math.PI)) * (tau > 0.16 && tau < 0.36 ? 1 : 0);
        sq += idleSq * smooth(tau / 0.6) + gSq * smooth((tau - 0.3) / 0.4);
        happy = tau > 0.03 && tau < 0.42 ? 1 : 0; glow = 0.45 * Math.exp(-tau / 0.28);
        roll = 0.035 * Math.sin(t * 1.3 + hh * 5) * smooth(tau / 0.5);
      }
      // ---- cast_ready: all strike a pose
      if (rdy > -0.16) {
        const a = rdy;
        const JUMP = 0.34, u = clamp(a / JUMP);
        if (a < 0) sq = -0.28 * smooth((a + 0.16) / 0.16);
        else if (a < JUMP) { bob = 0.30 * 4 * u * (1 - u); sq = lerp(-0.1, 0.26, smooth(u * 3)) * (1 - smooth((u - 0.7) / 0.3)) + (u > 0.75 ? -0.22 * smooth((u - 0.75) / 0.25) : 0); }
        else { const w = a - JUMP; sq = -0.26 * Math.exp(-w / 0.1) * Math.cos(w * TAU * 3.2) + 0.03 * Math.sin(w * 6) * smooth(w / 0.5); bob = 0.0; }
        const kk = smooth(seg(a, 0.0, 0.34));
        yaw = lerp(yawBase, P.yaw, kk); roll = lerp(roll, P.roll, kk) + 0.05 * Math.sin(a * 11) * Math.exp(-Math.max(a, 0) / 0.4) * (a > 0 ? 1 : 0);
        happy = a > 0.0 && a < 0.45 ? 1 : 0; glow = a > 0 ? 0.6 * Math.exp(-a / 0.3) + 0.1 : glow;
      }
      if (tau >= 0) c.pose({ squash: sq, yaw, roll, bob });
      const lookX = 0.35 * Math.sin(t * 0.7 + hh * 6), lookY = 0.12 * Math.sin(t * 0.53 + hh * 9);
      c.eyes({ open: 1 - c.blinkAt(T) * (happy ? 0 : 1), happy, lookX: rdy > 0.4 ? 0.0 : lookX, lookY: rdy > 0.4 ? 0.05 : lookY, surprised: 0 });
      c.setGlow(glow);
      c._sync();
      if (c._shadow) c._shadow.material.opacity *= smooth(seg(t, t0 + 0.14, tk));   // no shadow under an icon that has not dropped in yet
      // mark + beam for this icon
      const mk = marks[k].userData.U;
      const on = tau >= 0 ? 1 : 0, ageL = tau >= 0 ? tau : -1;
      mk.uOn.value = 0.22 + 0.78 * smooth(tau / 0.12) * on * 0.85 + (tau >= 0 ? 0.15 : 0); mk.uAge.value = rdy >= 0 ? Math.min(ageL, rdy) : ageL;
      if (rdy >= 0) mk.uAge.value = Math.min(rdy, 0.7); // the ready pulse re-uses the shock ring
      mk.uFlash.value = (tau >= 0 ? 0.45 * Math.exp(-tau / 0.14) : 0) + (rdy >= 0 ? 0.6 * Math.exp(-rdy / 0.26) : 0);
      mk.uTime.value = t;
      const bk = tau >= 0 ? 0.16 + smooth(tau / 0.07) * (0.5 + 0.55 * Math.exp(-tau / 0.22)) + (rdy >= 0 ? 0.9 * Math.exp(-rdy / 0.25) : 0) : 0.16;
      setBeamK(beams[k], bk * [1.0, 1.1, 1.7, 1.15, 1.05][k]);
      beams[k].update(t);
    });
    haze.update(t); st.bokeh.material.color.setScalar(1 + (rdy >= 0 ? 0.9 * Math.exp(-rdy / 0.3) : 0));
    sparks.userData.update(t); ringsG.userData.update(t, camera);

    // ---------------- camera: wide 28 mm, slow dolly-in + drift, tiny weight on every landing ----------------
    const cu = smooth(lt / 2);
    let kick = 0; for (const tk of taps) { const a = t - tk; if (a >= 0 && a < 0.4) kick += Math.exp(-a / 0.07) * Math.cos(a * 40); }
    const rk = rdy >= 0 ? Math.exp(-rdy / 0.12) * Math.cos(rdy * 34) : 0;
    camera.position.set(lerp(0.0, 0.45, cu) + 0.012 * noise1(t * 0.7, 1), lerp(2.9, 2.4, cu) - 0.016 * kick - 0.03 * rk + 0.006 * noise1(t * 0.8, 2) + imp * 0.01 * noise1(t * 47, 9), lerp(9.0, 7.6, cu));
    camera.fov = lensFov(28) * (1 - 0.03 * smooth(seg(rdy, 0, 0.45)) * (rdy >= 0 ? 1 : 0));
    camera.lookAt(tmp.v.set(lerp(0.4, 0.65, cu), lerp(0.85, 0.8, cu), -0.9));
    camera.updateProjectionMatrix();

    // ---------------- Amrita ----------------
    const tapPunch = (() => { let s = 0; for (const tk of taps) { const a = t - tk; if (a >= 0 && a < 0.5) s += -0.07 * Math.exp(-a / 0.1) * Math.cos(a * TAU * 3); } return s; })();
    const rdyPunch = rdy >= 0 ? A.punch(t, ready, { amp: -0.22, freq: 3.4, damp: 0.3 }) : A.anticipate(t, ready, { dur: 0.16, squat: 0.14 });
    const hv = A.hover(t, { amp: 0.03, seed: 2 });
    A.pose({ yaw: -0.5 + hv.yawD + 0.05 * smooth(seg(rdy, 0, 0.5)), roll: hv.roll, bob: hv.bob, squash: hv.squash + tapPunch + rdyPunch });
    // gaze: snap to each landing icon, look at the cast centre when all are in place
    const gz = tmp.v2;
    if (rdy >= 0.0) gz.set(0.0, 0.95, -1.3); else if (lastTap >= 0 && t - taps[lastTap] < 0.2) gz.set(MARKS[lastTap][0], 0.5, MARKS[lastTap][1]); else gz.set(MARKS[nextTap][0], 1.2, MARKS[nextTap][1]);
    A.eyes({ open: 1 - A.blinkAt(T), determined: rdy < 0 ? 0.45 : 0, happy: rdy >= 0.04 ? 1 : 0, surprised: rdy >= 0 && rdy < 0.04 ? 0.7 : 0, squint: 0 });
    A.lookAt(tmp.v2.set(gz.x, gz.y, gz.z), { gain: 2.2 });
    // clapperboard: stays open, ticks with every foot tap, SNAPS shut exactly on cast_ready
    let clap;
    if (rdy < 0) { clap = 0.12; for (const tk of taps) { const a = t - tk; if (a >= 0 && a < 0.12) clap += 0.20 * Math.exp(-a / 0.035); } clap = Math.min(clap, 0.6); if (t < taps[0]) clap = 0.12; }
    else { const x = (rdy - 0.045) / 0.16; clap = rdy < 0.045 ? 0.12 + 0.88 * (rdy / 0.045) ** 2 : x < 1 ? 1 - 0.17 * Math.sin(Math.PI * x) * (1 - x) : 1; }
    A.setProp('clapper', { t, clap, side: -1, scale: 1.2, pos: [-0.12, 0.1, 0.12], rotY: 0.2 + 0.05 * Math.sin(t * 2), float: 0.03 });
    A.glow(0.0 + (rdy >= 0 ? 0.35 * Math.exp(-rdy / 0.3) : 0) + 0.15 * imp);
    A.root.position.set(AM[0], AM[1], AM[2]);

    // lights breathe with the beats; rim on the icons flashes at cast_ready
    stage.lights.rim.intensity = 1100 * (1 + (rdy >= 0 ? 0.8 * Math.exp(-rdy / 0.3) : 0));
    amRim.intensity = 150 * (1 + (rdy >= 0 ? 0.6 * Math.exp(-rdy / 0.3) : 0));
    stage.lights.key.intensity = 260 * (1 + 0.1 * kick * 0 + (rdy >= 0 ? 0.35 * Math.exp(-rdy / 0.25) : 0));

    // DOF: the five icons (~10 m); Amrita is at the same depth band
    const fd = tmp.v.set(0.9, 0.9, -0.2).distanceTo(camera.position);
    return { dof: { focus: fd, strength: 0.45, maxPx: 8, bokeh: 1.1 }, bloom: { strength: 0.42 + 0.3 * imp + (rdy >= 0 ? 0.14 * Math.exp(-rdy / 0.25) : 0), radius: 0.6, threshold: 0.85 }, exposure: 1 };
  },
};
