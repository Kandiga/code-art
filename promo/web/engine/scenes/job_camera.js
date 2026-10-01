// =============================================================================
// job_camera.js — "CAMERA" (30.0 – 32.0) · crane-down 24 mm on the soundstage (dark set, rim-lit chrome).
//   30.00  HIT (S) cut-in on a high wide: two virtual CINEMA CRANES (jib arm, camera head, counterweights, head lamp) and four DRONES
//          (icon quadcopters with a glowing eye-lens) arrive around Amrita; the camera craned down from 5 m starts to descend.
//   30.0 -> 31.0  crane_servo: both jibs swing into position on spring servos (overshoot, settle); heads track her; drones spiral in (drone_buzz 30.25 ->)
//   30.5   the crane head lamps ignite (hard flicker-on): two volumetric beams sweep with the arms and land on her
//   31.0   viewfinder_on: tally lights go red, drones lock into formation, the VIEWFINDER OVERLAY appears (overlay2d: brackets, thirds, centre cross,
//          REC dot, timecode, 24 mm mark, tracking boxes, focus box hunting)
//   31.5   focus_beep: the focus box racks onto her eye and turns green, rings ping out, bloom kick, she pops
//   31.5 - 32.0  held poster: Amrita eyes-to-lens at the right third, two beams crossing, drone ring, chrome rim glints
// Pure function of T.t / T.lt (4 sub-frames per frame = motion blur). No Math.random / Date.now.
// =============================================================================
import * as BGU from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createStage, LOOKS } from '../stage3d.js';
import { createAmrita } from '../amrita3d.js';
import { createBeam, createHaze, glowSprite, lensFlare } from '../fx3d.js';
import * as E from '../ease.js';
import { hash, noise1 } from '../rng.js';

const { clamp, lerp, smooth, outCubic, outQuad, spring } = E;
const TAU = Math.PI * 2;
const seg = (x, a, b) => clamp((x - a) / (b - a));
const T0 = 30;
const LAMP_ON = [0.5, 0.56];        // lt: crane head lamps ignite (A, B)
const VF_ON = 1.0, BEEP = 1.5;      // lt of viewfinder_on / focus_beep
const AM = [1.0, 1.0, 0.0];         // Amrita's centre
const AMF = [1.0, 1.02, 0.1];       // what the cranes/drones aim at (her face plate)
const PX = { amber: '#FFB62E', cream: '#FFF3D6', vermilion: '#F2542D', teal: '#1FB5A6', violet: '#6B5BFF', sky: '#7CC4FF' };

const lensFov = (mm, ratio = 2.39, gate = 36) => (2 * Math.atan(Math.tan(Math.atan(gate / (2 * mm))) / ratio) * 180) / Math.PI;
// hard-on lamp flicker (pure function of dt = seconds since ignition): returns multiplier 0..1.35
const flicker = (dt, seed = 0) => {
  if (dt < 0) return 0;
  if (dt < 0.16) return [1.0, 0.1, 0.9, 0.0, 1.25, 0.35, 1.1, 0.7][(Math.floor(dt / 0.02) + seed) % 8];
  return 1 + 0.35 * Math.exp(-(dt - 0.16) / 0.12);
};

// ============================== geometry kit (merged, vertex-coloured) ==============================
function geoKit(THREE) {
  const unit = { box: new THREE.BoxGeometry(1, 1, 1), cyl: new THREE.CylinderGeometry(1, 1, 1, 16, 1), sph: new THREE.SphereGeometry(1, 20, 14) };
  const m4 = new THREE.Matrix4(), qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), eu = new THREE.Euler(), pv = new THREE.Vector3(), sv = new THREE.Vector3(), col = new THREE.Color();
  const Y = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3(), mid = new THREE.Vector3();
  const AX = { x: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)), z: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), y: new THREE.Quaternion() };
  function builder() {
    const list = [];
    const put = (geo, p, q, s, c) => {
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      m4.compose(pv.set(...p), q, sv.set(...s)); g.applyMatrix4(m4);
      col.set(c); const n = g.attributes.position.count, a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
      list.push(g);
    };
    const B = {
      box: (w, h, dd, o = {}) => put(unit.box, o.p || [0, 0, 0], qa.setFromEuler(eu.set(...(o.r || [0, 0, 0]))), [w, h, dd], o.c || '#ffffff'),
      rbox: (w, h, dd, r, o = {}) => put(new RoundedBoxGeometry(w, h, dd, 3, r), o.p || [0, 0, 0], qa.setFromEuler(eu.set(...(o.r || [0, 0, 0]))), [1, 1, 1], o.c || '#ffffff'),
      cyl: (r, h, o = {}) => { qa.setFromEuler(eu.set(...(o.r || [0, 0, 0]))); qb.copy(qa).multiply(AX[o.axis || 'y']); put(unit.cyl, o.p || [0, 0, 0], qb, [r, h, r], o.c || '#ffffff'); },
      sph: (r, o = {}) => put(unit.sph, o.p || [0, 0, 0], qa.setFromEuler(eu.set(...(o.r || [0, 0, 0]))), o.s ? o.s.map((v) => v * r) : [r, r, r], o.c || '#ffffff'),
      tor: (R, r, o = {}) => put(new THREE.TorusGeometry(R, r, 8, 28), o.p || [0, 0, 0], qa.setFromEuler(eu.set(...(o.r || [0, 0, 0]))), [1, 1, 1], o.c || '#ffffff'),
      tube: (a, b, r, o = {}) => { d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); const len = d.length(); mid.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2); qa.setFromUnitVectors(Y, d.divideScalar(len || 1)); put(unit.cyl, [mid.x, mid.y, mid.z], qa, [r, len, r], o.c || '#ffffff'); },
      circle: (r, o = {}) => put(new THREE.CircleGeometry(r, 24), o.p || [0, 0, 0], qa.setFromEuler(eu.set(...(o.r || [0, 0, 0]))), [1, 1, 1], o.c || '#ffffff'),
      build: () => { const g = BGU.mergeGeometries(list, false); list.forEach((x) => x.dispose()); g.computeBoundingSphere(); return g; },
    };
    return B;
  }
  return { builder };
}

// ============================== the cinema crane (shared geometry) ==============================
const ARM_L = 2.7, ARM_B = 1.0, TURRET_Y = 1.83, MOUNT_DROP = 0.36;
function craneGeos(kit) {
  const G = {};
  { // base: track, dolly, wheels, column, turret ring
    const c = kit.builder(), s = kit.builder();
    for (const z of [-0.32, 0.32]) c.box(5.4, 0.05, 0.06, { p: [0, 0.025, z], c: '#cfd3dc' });
    for (let i = -4; i <= 4; i++) s.box(0.12, 0.03, 0.9, { p: [i * 0.6, 0.012, 0], c: '#1c1c23' });
    s.rbox(1.5, 0.16, 0.96, 0.04, { p: [0, 0.31, 0], c: '#2a2a33' });
    c.box(1.52, 0.018, 0.03, { p: [0, 0.392, 0.47], c: '#e1e5ee' }); c.box(1.52, 0.018, 0.03, { p: [0, 0.392, -0.47], c: '#e1e5ee' });
    for (const x of [-0.52, 0.52]) for (const z of [-0.32, 0.32]) { s.cyl(0.125, 0.075, { axis: 'z', p: [x, 0.175, z], c: '#101014' }); c.cyl(0.07, 0.082, { axis: 'z', p: [x, 0.175, z], c: '#e1e5ee' }); }
    c.cyl(0.095, 1.36, { p: [0, 1.07, 0], c: '#d9dde6' });
    s.cyl(0.21, 0.06, { p: [0, 0.43, 0], c: '#2a2a33' });
    for (const y of [0.66, 1.18]) s.cyl(0.13, 0.045, { p: [0, y, 0], c: '#2a2a33' });
    s.cyl(0.18, 0.1, { p: [0, 1.78, 0], c: '#2a2a33' });
    s.rbox(0.34, 0.2, 0.3, 0.02, { p: [-0.5, 0.5, 0.26], c: '#F2542D' });
    s.box(0.2, 0.012, 0.16, { p: [-0.5, 0.608, 0.26], c: '#101014' });
    G.baseChrome = c.build(); G.baseSteel = s.build();
  }
  { // turret yoke (rotates with yaw)
    const c = kit.builder(), s = kit.builder();
    for (const sx of [-1, 1]) s.rbox(0.06, 0.46, 0.38, 0.015, { p: [sx * 0.17, 0.12, 0], c: '#2a2a33' });
    s.cyl(0.15, 0.06, { p: [0, -0.02, 0], c: '#2a2a33' });
    c.cyl(0.05, 0.5, { axis: 'x', p: [0, 0.22, 0], c: '#e1e5ee' });
    G.turretChrome = c.build(); G.turretSteel = s.build();
  }
  { // the arm (pitch frame, +Z front): tapered truss, rear tube, counterweights, end plate, head post
    const c = kit.builder(), s = kit.builder();
    const af = (z) => 1 - 0.42 * clamp(z / ARM_L), hw = 0.075, hh = 0.09, z00 = -0.1;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) c.tube([sx * hw, sy * hh, z00], [sx * hw * af(ARM_L), sy * hh * af(ARM_L), ARM_L], 0.017, { c: '#e1e5ee' });
    const nb = 9, dz = (ARM_L - z00) / nb;
    for (let i = 0; i < nb; i++) {
      const z0 = z00 + i * dz, z1 = z0 + dz, a0 = af(z0), a1 = af(z1), f = i % 2 ? 1 : -1;
      for (const sx of [-1, 1]) c.tube([sx * hw * a0, -f * hh * a0, z0], [sx * hw * a1, f * hh * a1, z1], 0.0085, { c: '#cfd3dc' });
      for (const sy of [-1, 1]) c.tube([-f * hw * a0, sy * hh * a0, z0], [f * hw * a1, sy * hh * a1, z1], 0.0085, { c: '#cfd3dc' });
      for (const sy of [-1, 1]) c.tube([-hw * a0, sy * hh * a0, z0], [hw * a0, sy * hh * a0, z0], 0.007, { c: '#cfd3dc' });
    }
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) c.tube([sx * hw, sy * hh, -ARM_B], [sx * hw, sy * hh, z00], 0.017, { c: '#e1e5ee' });
    for (let i = 0; i < 3; i++) { const z0 = -ARM_B + i * 0.35, f = i % 2 ? 1 : -1; for (const sx of [-1, 1]) c.tube([sx * hw, -f * hh, z0], [sx * hw, f * hh, z0 + 0.35], 0.0085, { c: '#cfd3dc' }); }
    s.rbox(0.28, 0.3, 0.34, 0.03, { p: [0, 0, 0], c: '#2a2a33' });
    for (const sx of [-1, 1]) c.cyl(0.062, 0.03, { axis: 'x', p: [sx * 0.235, 0, 0], c: '#e1e5ee' });
    // counterweight stack hanging at the rear
    const zw = -ARM_B + 0.15;
    s.box(0.04, 0.6, 0.04, { p: [0, -0.4, zw], c: '#1c1c23' });
    for (let k = 0; k < 7; k++) { const y = -0.2 - 0.078 * k; s.rbox(0.54, 0.07, 0.36, 0.012, { p: [0, y, zw], c: k % 2 ? '#34343e' : '#2a2a33' }); s.box(0.5, 0.012, 0.012, { p: [0, y, zw + 0.182], c: '#F2542D' }); s.box(0.5, 0.012, 0.012, { p: [0, y, zw - 0.182], c: '#F2542D' }); }
    s.rbox(0.18, 0.24, 0.08, 0.02, { p: [0, 0, ARM_L + 0.04], c: '#2a2a33' });
    c.cyl(0.032, MOUNT_DROP, { p: [0, -MOUNT_DROP / 2, ARM_L], c: '#d9dde6' });
    G.armChrome = c.build(); G.armSteel = s.build();
  }
  { // pan bearing + yoke
    const c = kit.builder(), s = kit.builder();
    s.cyl(0.07, 0.05, { p: [0, 0.025, 0], c: '#2a2a33' });
    s.rbox(0.36, 0.035, 0.24, 0.01, { p: [0, 0.07, 0], c: '#2a2a33' });
    for (const sx of [-1, 1]) { s.rbox(0.035, 0.34, 0.16, 0.01, { p: [sx * 0.185, 0.24, 0], c: '#2a2a33' }); c.cyl(0.04, 0.03, { axis: 'x', p: [sx * 0.2, 0.2, 0], c: '#e1e5ee' }); }
    G.panChrome = c.build(); G.panSteel = s.build();
  }
  { // camera + matte box + lamp (tilt frame, +Z forward, origin on the tilt axis)
    const c = kit.builder(), s = kit.builder();
    s.rbox(0.2, 0.22, 0.34, 0.025, { p: [0, 0, -0.04], c: '#1d1d24' });
    s.rbox(0.19, 0.05, 0.3, 0.015, { p: [0, 0.135, -0.04], c: '#2a2a33' });
    s.rbox(0.205, 0.04, 0.14, 0.01, { p: [0, -0.06, -0.1], c: '#F2542D' });
    s.cyl(0.115, 0.14, { axis: 'x', p: [0, 0.255, -0.12], c: '#23232b' });
    for (const sx of [-1, 1]) c.cyl(0.055, 0.01, { axis: 'x', p: [sx * 0.074, 0.255, -0.12], c: '#e1e5ee' });
    s.cyl(0.07, 0.2, { axis: 'z', p: [0, 0, 0.23], c: '#15151a' });
    c.cyl(0.079, 0.026, { axis: 'z', p: [0, 0, 0.17], c: '#e1e5ee' }); c.cyl(0.075, 0.03, { axis: 'z', p: [0, 0, 0.31], c: '#e1e5ee' });
    s.rbox(0.26, 0.2, 0.12, 0.012, { p: [0, 0, 0.4], c: '#0e0e12' });
    s.box(0.3, 0.008, 0.18, { p: [0, 0.115, 0.47], r: [-0.12, 0, 0], c: '#15151a' });
    s.box(0.008, 0.2, 0.16, { p: [0.15, 0, 0.47], r: [0, 0.3, 0], c: '#15151a' }); s.box(0.008, 0.2, 0.16, { p: [-0.15, 0, 0.47], r: [0, -0.3, 0], c: '#15151a' });
    for (const sx of [-0.045, 0.045]) c.cyl(0.007, 0.34, { axis: 'z', p: [sx, -0.118, 0.2], c: '#e1e5ee' });
    s.tube([0, 0.14, 0.05], [0, 0.31, 0.08], 0.012, { c: '#2a2a33' });
    // head lamp (fresnel with barn doors)
    s.cyl(0.075, 0.16, { axis: 'z', p: [0, 0.38, 0.1], c: '#1b1b21' });
    for (let k = 0; k < 3; k++) s.cyl(0.083, 0.012, { axis: 'z', p: [0, 0.38, 0.045 + 0.028 * k], c: '#2e2e37' });
    c.cyl(0.082, 0.02, { axis: 'z', p: [0, 0.38, 0.185], c: '#e1e5ee' });
    s.box(0.13, 0.006, 0.07, { p: [0, 0.38 + 0.098, 0.225], r: [-0.4, 0, 0], c: '#0e0e12' }); s.box(0.13, 0.006, 0.07, { p: [0, 0.38 - 0.098, 0.225], r: [0.4, 0, 0], c: '#0e0e12' });
    s.box(0.006, 0.13, 0.07, { p: [0.098, 0.38, 0.225], r: [0, 0.4, 0], c: '#0e0e12' }); s.box(0.006, 0.13, 0.07, { p: [-0.098, 0.38, 0.225], r: [0, -0.4, 0], c: '#0e0e12' });
    G.camChrome = c.build(); G.camSteel = s.build();
  }
  return G;
}

// ============================== the drone (shared geometry) ==============================
function droneGeos(THREE, kit) {
  const G = {};
  const b = kit.builder(), e = kit.builder(), r = kit.builder();
  b.sph(0.11, { s: [1, 0.78, 1.12], c: '#e8e2d4' });                       // pod
  b.tor(0.108, 0.011, { r: [Math.PI / 2, 0, 0], c: '#2a2833' });            // band
  b.sph(0.066, { p: [0, 0, 0.082], s: [1, 1, 0.5], c: '#15141b' });         // eye housing
  b.sph(0.052, { p: [0, 0, 0.1], s: [1, 1, 0.42], c: '#03040a' });          // glossy lens glass
  for (const a of [Math.PI / 4, -Math.PI / 4]) b.box(0.4, 0.016, 0.026, { p: [0, 0.012, 0], r: [0, a, 0], c: '#2a2833' }); // arms
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * 0.142, z = sz * 0.142;
    b.cyl(0.03, 0.045, { p: [x, 0.03, z], c: '#cfd3dc' });
    b.tor(0.108, 0.0035, { p: [x, 0.062, z], r: [Math.PI / 2, 0, 0], c: '#2a2833' });
    e.sph(0.0075, { p: [x, 0.012, z], c: '#ffffff' });
    r.circle(0.108, { p: [x, 0.058, z], r: [-Math.PI / 2, 0, 0], c: '#ffffff' });
  }
  e.tor(0.039, 0.0065, { p: [0, 0, 0.1155], c: '#ffffff' });                // iris ring
  e.sph(0.0125, { p: [0, 0, 0.1205], c: '#ffffff' });                       // pupil
  G.body = b.build(); G.eye = e.build(); G.rotor = r.build();
  return G;
}

// ============================== small shaders ==============================
const CONE_VS = `varying vec3 vN; varying vec3 vV; varying float vH; uniform float uLen;
  void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = -mv.xyz; vH = -position.y/uLen; gl_Position = projectionMatrix*mv; }`;
const CONE_FS = `varying vec3 vN; varying vec3 vV; varying float vH; uniform vec3 uColor; uniform float uI, uPow;
  void main(){ float f = abs(dot(normalize(vN), normalize(vV))); float e = pow(f, uPow); float lf = smoothstep(0.0,0.08,vH)*pow(max(1.0-vH,0.0),1.1); gl_FragColor = vec4(uColor*e*lf*uI, 1.0); }`;
function makeCone(THREE, { length = 5, radius = 0.5, apex = 0.012 } = {}) {
  const geo = new THREE.CylinderGeometry(apex, radius, length, 28, 1, true); geo.translate(0, -length / 2, 0);
  const mat = new THREE.ShaderMaterial({ uniforms: { uColor: { value: new THREE.Color() }, uI: { value: 0 }, uPow: { value: 1.5 }, uLen: { value: length } }, vertexShader: CONE_VS, fragmentShader: CONE_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false });
  const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.renderOrder = 6; m.visible = false; return m;
}
const ROTOR_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
const ROTOR_FS = `varying vec2 vUv; uniform float uT; void main(){ vec2 p = vUv*2.0-1.0; float r = length(p); float a = atan(p.y,p.x);
  float sw = 0.55 + 0.45*sin(a*2.0 + uT*260.0); float disc = smoothstep(1.0,0.82,r)*(0.05 + 0.1*sw*smoothstep(0.1,0.7,r)); gl_FragColor = vec4(vec3(0.85,0.92,1.0)*disc, 1.0); }`;

// billboard shock rings (additive), all events known up front
function makeRings(THREE, rings) {
  const grp = new THREE.Group(), geo = new THREE.RingGeometry(0.955, 1.0, 72, 1);
  const items = rings.map((r) => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(...r.color), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide, toneMapped: false })); m.visible = false; m.frustumCulled = false; m.renderOrder = 9; grp.add(m); return { m, r }; });
  grp.userData.update = (lt, camera) => { for (const { m, r } of items) { const a = (lt - r.t) / r.dur; if (a < 0 || a > 1) { m.visible = false; continue; } const e = 1 - (1 - a) ** 3, rad = lerp(r.r0, r.r1, e); m.visible = true; m.position.set(...r.pos); m.quaternion.copy(camera.quaternion); m.scale.set(rad, rad, 1); m.material.opacity = (1 - a) ** 2.2; } };
  return grp;
}

// Baked "rim-lit chrome" matcap (PMREM lookups are very slow in software GL): dark studio, cyan strip left, amber strip right, soft top box.
// Sampled with the view-space normal and added to the PBR result (same trick as amrita3d.js), so metals get edges to catch without an env map.
function makeMatcap(THREE, S) {
  const N = 192, c = S.mk(N, N), g = c.getContext('2d'), R = N / 2;
  g.fillStyle = '#05060b'; g.fillRect(0, 0, N, N);
  const lin = (x0, y0, x1, y1, stops) => { const gr = g.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, col]) => gr.addColorStop(o, col)); return gr; };
  g.fillStyle = lin(0, N, 0, 0, [[0, 'rgba(46,52,86,0.55)'], [0.35, 'rgba(10,11,20,0)'], [0.7, 'rgba(10,11,20,0)'], [1, 'rgba(120,130,170,0.35)']]); g.fillRect(0, 0, N, N);       // floor bounce / sky
  g.fillStyle = lin(0, 0, N, 0, [[0, 'rgba(159,230,255,0)'], [0.06, 'rgba(159,230,255,0.95)'], [0.2, 'rgba(159,230,255,0.28)'], [0.42, 'rgba(159,230,255,0)']]); g.fillRect(0, 0, N, N);   // cyan strip, left
  g.fillStyle = lin(N, 0, 0, 0, [[0, 'rgba(255,184,104,0)'], [0.06, 'rgba(255,184,104,0.95)'], [0.2, 'rgba(255,184,104,0.28)'], [0.42, 'rgba(255,184,104,0)']]); g.fillRect(0, 0, N, N);   // amber strip, right
  const top = g.createRadialGradient(R * 0.9, N * 0.14, 0, R * 0.9, N * 0.14, R * 0.7); top.addColorStop(0, 'rgba(255,255,255,0.9)'); top.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = top; g.fillRect(0, 0, N, N);       // top soft box
  const fr = g.createRadialGradient(R * 0.8, R * 1.1, 0, R * 0.8, R * 1.1, R * 0.5); fr.addColorStop(0, 'rgba(120,130,180,0.35)'); fr.addColorStop(1, 'rgba(120,130,180,0)'); g.fillStyle = fr; g.fillRect(0, 0, N, N);                 // faint front fill
  const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; return tx;
}
function matcapHook(tex, k) {
  return (sh) => {
    sh.uniforms.uMatcap = { value: tex }; sh.uniforms.uMatK = { value: k };
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uMatcap; uniform float uMatK;')
      .replace('#include <opaque_fragment>', `{ float nV = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0); vec3 Fm = material.specularColor + (vec3(material.specularF90) - material.specularColor) * pow(1.0 - nV, 5.0);
        outgoingLight += texture2D(uMatcap, normal.xy * 0.5 + 0.5).rgb * uMatK * Fm * (1.0 - 0.6 * material.roughness); }
      #include <opaque_fragment>`);
  };
}

// ============================== layout ==============================
// crane heads' final world positions; the base is derived from the arm heading
const CRANES = [
  { id: 'A', head: [-1.45, 1.2, 0.8], head0: 'left', az: [1.0, -0.22], stow: 1.8, el0: 0.34, d0: 0.0, lamp: '#fff0dc', lampI: 20, beam: 0.12, ign: LAMP_ON[0], seed: 1 },
  { id: 'B', head: [3.0, 1.35, -1.0], az: [-0.75, 0.66], stow: -1.8, el0: 0.38, d0: 0.08, lamp: '#ffbf72', lampI: 30, beam: 0.12, ign: LAMP_ON[1], seed: 5 },
];
// drones: formation (world) + colours + arrival time
const DRONES = [
  { F: [-0.5, 1.65, 0.95], col: PX.teal, d: 0.0, dir: 1, seed: 1 },
  { F: [-2.6, 0.7, -0.2], col: PX.amber, d: 0.27, dir: -1, seed: 2 },
  { F: [2.75, 1.2, 0.55], col: PX.violet, d: 0.21, dir: 1, seed: 3 },
  { F: [1.55, 1.9, -1.4], col: PX.sky, d: 0.33, dir: -1, seed: 4 },
];
const CAM0 = { p: [0.8, 3.7, 6.6], g: [0.3, 0.8, 0] }, CAM1 = { p: [-0.2, 1.2, 5.0], g: [-0.2, 0.78, 0] };

// ============================== the scene ==============================
export default {
  id: 'job_camera', kind: '3d', ratio: 2.39,
  setup({ THREE, S, renderer }) {
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#030307');
    const stage = createStage(THREE, { S, renderer }, { look: 'noir', table: false, cases: false, grips: false, cables: false, marks: false, tubes: false, mist: false });
    stage.chair.position.set(-3.1, 0, -1.7); stage.chair.rotation.y = 0.55; scene.add(stage.group);
    stage.setLook({ ...LOOKS.noir, name: 'cam', washL: ['#2c4c92', 0.8], washR: ['#58399a', 0.7], pool: ['#3b66a8', 0.6], haze: ['#5a73a8', 0.55] });
    const L = stage.lights;
    L.key.castShadow = false; L.key.angle = 0.3; L.key.penumbra = 0.85; L.rim.angle = 0.3; L.rim.penumbra = 0.85;
    stage.rig.set('all', { intensity: 0.25 });
    const rimL = new THREE.SpotLight('#9fe6ff', 300, 40, 0.15, 0.9, 2); rimL.position.set(-5.5, 5.5, -5.5); rimL.target.position.set(AM[0], AM[1], AM[2]); scene.add(rimL, rimL.target);
    L.fill.visible = false;     // 3 lights + ambient only: key = crane A lamp, rim = crane B lamp, rimL = cool back-left edge (each light costs ~0.25 cpu-s per frame in software GL)

    const matcap = makeMatcap(THREE, S);
    const pbr = (p, k) => { const m = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, ...p }); m.onBeforeCompile = matcapHook(matcap, k); m.customProgramCacheKey = () => 'cam-matcap-' + k; return m; };
    const chrome = pbr({ metalness: 1, roughness: 0.2 }, 3.2), steel = pbr({ metalness: 0.85, roughness: 0.42 }, 2.4), plastic = pbr({ metalness: 0.15, roughness: 0.32 }, 1.8);
    const glassMat = new THREE.MeshStandardMaterial({ color: '#05070d', metalness: 0.2, roughness: 0.06 }); glassMat.vertexColors = false; glassMat.onBeforeCompile = matcapHook(matcap, 2.2); glassMat.customProgramCacheKey = () => 'cam-matcap-glass';

    const camera = new THREE.PerspectiveCamera(lensFov(24), 2.39, 0.1, 80);
    const kit = geoKit(THREE), CG = craneGeos(kit), DG = droneGeos(THREE, kit);
    const mesh = (g, m, parent) => { const o = new THREE.Mesh(g, m); parent.add(o); return o; };

    // ---- cranes
    const cranes = CRANES.map((cd) => {
      const h = cd.head, len = Math.hypot(...cd.az), ax = cd.az[0] / len, az = cd.az[1] / len;
      const tipY = h[1] + MOUNT_DROP, pivY = TURRET_Y + 0.22, el1 = Math.asin(clamp((tipY - pivY) / ARM_L, -0.6, 0.6));
      const reach = ARM_L * Math.cos(el1), bx = h[0] - ax * reach, bz = h[2] - az * reach;
      const root = new THREE.Group(); root.position.set(bx, 0, bz); scene.add(root);
      mesh(CG.baseChrome, chrome, root); mesh(CG.baseSteel, steel, root);
      const turret = new THREE.Group(); turret.position.set(0, TURRET_Y, 0); root.add(turret); mesh(CG.turretChrome, chrome, turret); mesh(CG.turretSteel, steel, turret);
      const pitch = new THREE.Group(); pitch.position.set(0, 0.22, 0); turret.add(pitch); mesh(CG.armChrome, chrome, pitch); mesh(CG.armSteel, steel, pitch);
      const mount = new THREE.Group(); mount.position.set(0, -MOUNT_DROP, ARM_L); pitch.add(mount);
      const pan = new THREE.Group(); pan.scale.setScalar(1.5); mount.add(pan); mesh(CG.panChrome, chrome, pan); mesh(CG.panSteel, steel, pan);
      const tilt = new THREE.Group(); tilt.position.set(0, 0.2, 0); pan.add(tilt); mesh(CG.camChrome, chrome, tilt); mesh(CG.camSteel, steel, tilt);
      const glass = new THREE.Mesh(new THREE.CircleGeometry(0.057, 20), glassMat); glass.position.set(0, 0, 0.327); tilt.add(glass);
      const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.05, 0.05), toneMapped: false });
      const lampLens = new THREE.Mesh(new THREE.CircleGeometry(0.066, 22), lampMat); lampLens.position.set(0, 0.38, 0.196); tilt.add(lampLens);
      const tallyMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.01, 0.01), toneMapped: false });
      const tally = new THREE.Mesh(new THREE.SphereGeometry(0.013, 10, 8), tallyMat); tally.position.set(0.075, 0.115, -0.215); tilt.add(tally);
      const yaw1 = Math.atan2(ax, az), yaw0 = yaw1 + cd.stow;
      return { cd, root, turret, pitch, mount, pan, tilt, lampMat, tallyMat, lampLens, yaw0, yaw1, el0: el1 + cd.el0, el1, d0: cd.d0, seed: cd.seed };
    });
    // crane lamps: volumetric beams + glows + flares
    const beams = cranes.map((c) => createBeam(THREE, { from: [0, 5, 0], to: [1, 0, 0], color: c.cd.lamp, angle: c.cd.beam, intensity: 0, noise: 1, steps: 4, soft: 0.5, falloff: 0.6, startFade: 0.5, endFade: 1, pool: false, glow: false, gain: 0.4, seed: c.seed }));
    beams.forEach((b) => scene.add(b.object));
    const lampGlow = cranes.map((c) => { const g = glowSprite(THREE, { color: c.cd.lamp, size: 0.9, intensity: 0 }); scene.add(g); return g; });
    const flares = cranes.map((c) => { const f = lensFlare(THREE, { color: c.cd.lamp, size: 0.2, intensity: 0, ghosts: 3, ring: true }); scene.add(f); return f; });
    const haze = createHaze(THREE, { count: 220, seed: 5, size: 0.015, intensity: 1.1, color: '#8fa8e0', ambient: 0.05, boost: 2.4, bounds: { min: [-6.5, 0.3, -5.5], max: [6.5, 5, 5.5] } }); haze.attachBeams(beams); scene.add(haze.points);

    // ---- drones
    const rotorMat = new THREE.ShaderMaterial({ uniforms: { uT: { value: 0 } }, vertexShader: ROTOR_VS, fragmentShader: ROTOR_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
    const drones = DRONES.map((dd) => {
      const g = new THREE.Group(); g.scale.setScalar(1.7); g.visible = false; scene.add(g);
      mesh(DG.body, plastic, g);
      const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(dd.col).multiplyScalar(2.5), toneMapped: false, vertexColors: true }); mesh(DG.eye, eyeMat, g);
      mesh(DG.rotor, rotorMat, g);
      const halo = glowSprite(THREE, { color: dd.col, size: 0.55, intensity: 0 }); halo.position.set(0, 0, 0.14); g.add(halo);
      const cone = makeCone(THREE, { length: 5, radius: 0.2 }); cone.material.uniforms.uColor.value.set(dd.col); scene.add(cone);
      return { dd, g, eyeMat, halo, cone };
    });

    // ---- Amrita + props
    const A = createAmrita(THREE); A.root.position.set(...AM); scene.add(A.root);
    A.contactShadow({ floorY: 0, radius: 0.62, opacity: 0.5 });
    const refl = stage.reflect(A.root, { strength: 0.9 });
    const ringEvents = [];
    drones.forEach((d, i) => ringEvents.push({ t: 1.2 + 0.05 * i, pos: d.dd.F, r0: 0.1, r1: 0.45, dur: 0.28, color: new THREE.Color(d.dd.col).multiplyScalar(1.4).toArray() }));
    ringEvents.push({ t: BEEP, pos: [AM[0], AM[1], AM[2] + 0.2], r0: 0.5, r1: 1.7, dur: 0.45, color: [0.2, 0.7, 0.4] }, { t: BEEP + 0.07, pos: [AM[0], AM[1], AM[2] + 0.2], r0: 0.4, r1: 1.1, dur: 0.35, color: [0.6, 0.55, 0.4] });
    const ringsG = makeRings(THREE, ringEvents); scene.add(ringsG);

    const tmp = { v: new THREE.Vector3(), v2: new THREE.Vector3(), v3: new THREE.Vector3(), v4: new THREE.Vector3(), q: new THREE.Quaternion(), m: new THREE.Matrix4() };
    return { scene, camera, stage, A, refl, cranes, beams, lampGlow, flares, haze, drones, rotorMat, ringsG, rimL, tmp, THREE, trk: [], eye: { x: 960, y: 540, vis: 0 }, M: null };
  },

  update(st, T, S) {
    const { THREE, camera, A, stage, cranes, beams, drones, tmp } = st;
    const lt = clamp(T.lt, 0, 2), t = T0 + lt, imp = Math.min(1, T.impact);
    const beepAge = Math.max(0, lt - BEEP), beep = lt >= BEEP ? Math.exp(-beepAge / 0.11) : 0;
    const M = S.overlay.matteRect(2.39); st.M = M;
    // DEV-HOOK (removed before delivery): globalThis.__dbg = { hide:['a.b'], noDof, noBloom } toggles parts for profiling
    const DBG = globalThis.__dbg || {};
    if (DBG.hide !== undefined || st._hid) { for (const n of st._hid || []) { const o = n.split('.').reduce((a, k) => a && a[k], st); if (o) o.visible = true; } st._hid = DBG.hide || []; for (const n of st._hid) { const o = n.split('.').reduce((a, k) => a && a[k], st); if (o) o.visible = false; } }

    // ---------------- camera: crane-down, 24 mm
    const u = outCubic(lt / 2);
    camera.position.set(lerp(CAM0.p[0], CAM1.p[0], u), lerp(CAM0.p[1], CAM1.p[1], u), lerp(CAM0.p[2], CAM1.p[2], u) - 0.05 * beep - 0.012 * imp);
    camera.fov = lensFov(24); camera.updateProjectionMatrix();
    tmp.v.set(lerp(CAM0.g[0], CAM1.g[0], u), lerp(CAM0.g[1], CAM1.g[1], u), lerp(CAM0.g[2], CAM1.g[2], u)); camera.lookAt(tmp.v);
    camera.updateMatrixWorld(true);

    // ---------------- cranes: servo-driven swing with overshoot, heads track her
    const AMFv = tmp.v2.set(...AMF);
    cranes.forEach((c, i) => {
      const s1 = spring(lt - c.d0, 0.95, 0.5), s2 = spring(lt - c.d0 - 0.06, 1.15, 0.5);
      const yaw = lerp(c.yaw0, c.yaw1, s1), el = lerp(c.el0, c.el1, s2);
      c.turret.rotation.y = yaw; c.pitch.rotation.x = -el; c.mount.rotation.x = el;
      c.root.updateMatrixWorld(true);
      c.mount.getWorldPosition(tmp.v3);
      const aimS = spring(lt - c.d0 - 0.12, 1.25, 0.42);
      const ax = lerp(tmp.v3.x + Math.sin(yaw) * 8, AMFv.x, aimS), ay = lerp(tmp.v3.y - 0.5, AMFv.y, aimS), az = lerp(tmp.v3.z + Math.cos(yaw) * 8, AMFv.z, aimS);
      const dx = ax - tmp.v3.x, dy = ay - (tmp.v3.y + 0.2), dz = az - tmp.v3.z;
      c.pan.rotation.y = Math.atan2(dx, dz) - yaw; c.tilt.rotation.x = -Math.atan2(dy, Math.hypot(dx, dz));
      c.root.updateMatrixWorld(true);
      // lamp
      const k = flicker(lt - c.cd.ign, c.seed), kk = lt >= BEEP ? 1 + 0.25 * beep : 1;
      c.lampMat.color.setRGB(0.04 + 4.2 * k, 0.04 + 3.5 * k, 0.04 + 2.9 * k);
      const tally = lt >= VF_ON ? (((lt - VF_ON) % 1.0) < 0.62 ? 1 : 0.15) : 0.03;
      c.tallyMat.color.setRGB(3.2 * tally, 0.3 * tally, 0.2 * tally);
      c.lampLens.getWorldPosition(tmp.v4);
      tmp.q.setFromRotationMatrix(c.tilt.matrixWorld);
      const fwd = tmp.v.set(0, 0, 1).applyQuaternion(tmp.q);
      const dA = Math.hypot(tmp.v4.x - AM[0], tmp.v4.y - AM[1], tmp.v4.z - AM[2]), far = tmp.v3.copy(tmp.v4).addScaledVector(fwd, clamp(dA + 1.7, 3.2, 7.5) / 1.12);
      beams[i].set({ from: tmp.v4, to: far, intensity: 1.15 * k * kk, color: c.cd.lamp });
      beams[i].update(t);
      st.lampGlow[i].position.copy(tmp.v4).addScaledVector(fwd, 0.08); st.lampGlow[i].userData.set({ intensity: 0.8 * k * kk, size: 0.38 + 0.3 * Math.min(1.35, k) });
      st.flares[i].position.copy(tmp.v4); st.flares[i].userData.set({ intensity: 0.32 * k * kk, visibility: 1 });
      // real light on her: key = crane A lamp, rim = crane B lamp
      const light = i === 0 ? stage.lights.key : stage.lights.rim;
      light.color.set(c.cd.lamp); light.intensity = c.cd.lampI * k * kk; light.position.copy(tmp.v4); light.target.position.set(AM[0], AM[1], AM[2]);
    });
    stage.lights.amb.color.set('#4a5688'); stage.lights.amb.intensity = 0.35;
    st.rimL.intensity = 300 * (1 + 0.4 * beep);
    stage.update(T);

    // ---------------- drones: spiral in, orbit, lock into formation
    st.rotorMat.uniforms.uT.value = t;
    const lockK = smooth(seg(lt, 0.78, 1.18));
    drones.forEach((d, i) => {
      const dd = d.dd, tau = clamp((lt - dd.d) / (1.28 - dd.d)), s = 1 - (1 - tau) ** 2.2;
      const fx = dd.F[0] - AM[0], fz = dd.F[2] - AM[2], rF = Math.hypot(fx, fz), phF = Math.atan2(fz, fx), hF = dd.F[1];
      const ph = phF + dd.dir * 1.5 * Math.PI * (1 - s) ** 1.2, r = rF + (6.8 - rF) * (1 - s) ** 1.6, h = hF + (2.4 + 0.5 * i) * (1 - s) ** 1.4 + 0.12 * Math.sin(lt * 5 + i * 1.7) * (1 - lockK);
      const settle = lt > 1.1 ? 0.045 * Math.exp(-(lt - 1.1) / 0.35) * Math.sin((lt - 1.1) * 22 + i) : 0;
      const hov = 0.02 * Math.sin(t * 2.3 + i * 2.1) * lockK;
      let zz = AM[2] + r * Math.sin(ph); if (zz > 1.6) zz = 1.6 + (zz - 1.6) * 0.22;   // keep the fly-in out of the lens
      d.g.position.set(AM[0] + r * Math.cos(ph) + settle * 0.6, h + hov + settle, zz);
      d.g.visible = lt > dd.d - 0.02;
      // aim lens at her face with a bank into the turn
      d.g.updateMatrixWorld(true);
      d.g.lookAt(AMFv);                                   // Object3D.lookAt: +Z (the lens) points at her
      const bank = clamp(-dd.dir * 0.55 * (1 - s) ** 0.7, -0.6, 0.6) * (lt < 1.28 ? 1 : 0);
      d.g.rotateZ(bank);
      d.g.updateMatrixWorld(true);
      // beam + lens glow
      const lockedI = smooth(seg(lt, 1.05 + 0.05 * i, 1.2 + 0.05 * i)), fl = flicker(lt - (1.1 + 0.05 * i), i + 2), big = 1 + 0.5 * beep;
      d.halo.userData.set({ intensity: (0.25 + 0.9 * lockedI) * big * (fl > 0 ? Math.min(1.3, fl) : 1), size: 0.5 + 0.4 * beep });
      d.eyeMat.color.set(dd.col).multiplyScalar(2.0 + 1.6 * lockedI + 2.0 * beep);
      d.cone.visible = lockedI > 0.01;
      if (d.cone.visible) {
        tmp.v3.set(0, 0, 0.13).applyMatrix4(d.g.matrixWorld);  // lens position
        tmp.v4.copy(AMFv).sub(tmp.v3); const dist = tmp.v4.length(), dir = tmp.v4.divideScalar(dist);
        d.cone.position.copy(tmp.v3); d.cone.quaternion.setFromUnitVectors(tmp.v.set(0, -1, 0), dir);
        const len = dist * 1.18; d.cone.scale.set(len / 5 * 0.9 + 0.2, len / 5, len / 5 * 0.9 + 0.2);
        d.cone.material.uniforms.uI.value = 0.13 * lockedI * (0.6 + 0.4 * Math.min(1.2, fl)) * big;
      }
    });

    // ---------------- Amrita: directs. She follows crane A, crane B, the drones, then looks into the lens at the beep.
    const sq = A.punch(t, T0 + 0.0, { amp: -0.12 }) + A.punch(t, T0 + VF_ON, { amp: -0.07 }) + (lt >= BEEP ? 0.2 * Math.exp(-beepAge / 0.12) * Math.cos(beepAge * 26) : 0) + A.anticipate(t, T0 + 0.5, { dur: 0.15, squat: 0.1 });
    const yawAim = lerp(lerp(-0.62, 0.3, smooth(seg(lt, 0.3, 0.7))), 0.16, smooth(seg(lt, 0.95, 1.4)));
    A.pose({ squash: sq, yaw: yawAim + 0.03 * Math.sin(t * 1.7), roll: 0.025 * Math.sin(t * 1.3) - 0.03 * Math.exp(-lt / 0.4), bob: 0.03 * Math.sin(t * 2.2) + 0.012 * beep });
    // gaze target
    { const w1 = smooth(seg(lt, 0.35, 0.6)), w2 = smooth(seg(lt, 0.75, 1.0)), w3 = smooth(seg(lt, 1.15, 1.4));
      const cA = cranes[0].tilt.getWorldPosition(tmp.v), cB = cranes[1].tilt.getWorldPosition(tmp.v2), dr = drones[0].g.position;
      tmp.v3.copy(cA).lerp(cB, w1).lerp(dr, w2).lerp(camera.position, w3);
      A.lookAt(tmp.v3, { gain: 2.6 }); }
    A.eyes({ open: 1 - A.blinkAt(T), determined: lt < BEEP ? 0.55 : 0, surprised: lt >= BEEP ? 0.7 * Math.exp(-beepAge / 0.15) : 0, happy: lt >= BEEP + 0.12 ? smooth(seg(lt, BEEP + 0.12, BEEP + 0.3)) * 0.9 : 0, squint: 0 });
    A.glow(0.1 + 0.35 * beep + 0.1 * seg(lt, VF_ON, VF_ON + 0.2));
    A.setProp('viewfinder', { t, pos: [0, 0.1 * smooth(seg(lt, 0, 0.3)) - 0.04 * smooth(seg(lt, 0.7, 1.0)), 0.06 * smooth(seg(lt, 0.6, 1.1))], rotY: -0.3 + 0.5 * smooth(seg(lt, 0.4, 0.9)), float: 0.025, scale: 1.0 });
    A.root.updateMatrixWorld(true);

    // ---------------- screen-space positions for the viewfinder overlay (eye + tracking boxes)
    { const pxm = (M.h / 2) / Math.tan((camera.fov * Math.PI) / 360);
      const proj = (v, size) => { tmp.v4.copy(v).project(camera); const dist = camera.position.distanceTo(v); return { x: M.x + (tmp.v4.x * 0.5 + 0.5) * M.w, y: M.y + (0.5 - tmp.v4.y * 0.5) * M.h, s: (size * pxm) / dist, z: tmp.v4.z }; };
      A.body.updateWorldMatrix(true, false); tmp.v.set(-0.08 * 0.5, 0, 0.2025 * 0.5); A.body.localToWorld(tmp.v);
      st.eye = proj(tmp.v, 0.2); st.face = proj(A.root.position, 1.15);
      st.trk.length = 0;
      drones.forEach((d) => st.trk.push({ ...proj(d.g.position, 0.62), id: 'd' }));
      cranes.forEach((c) => { c.tilt.getWorldPosition(tmp.v2); st.trk.push({ ...proj(tmp.v2, 0.6), id: 'c' }); });
    }
    st.haze.update(t); st.ringsG.userData.update(lt, camera);

    // ---------------- DOF: she is the subject
    const focus = camera.position.distanceTo(tmp.v.set(AM[0], AM[1], AM[2]));
    return { dof: { focus, strength: 0.5, maxPx: DBG.noDof ? 0 : 12, bokeh: 1.3 }, bloom: { strength: DBG.noBloom ? 0 : 0.4 + 0.22 * imp + 0.22 * beep, radius: 0.55, threshold: 0.88 } };
  },

  // ============================== VIEWFINDER OVERLAY (31.0 -> ) ==============================
  overlay2d(ctx, T, S, st) {
    const lt = T.lt, t = T.t, beep = lt >= BEEP ? Math.exp(-(lt - BEEP) / 0.11) : 0;
    if (lt < VF_ON - 0.001 || !st.M) return;
    const a0 = lt - VF_ON, M = st.M, F = S.F;
    // power-on flicker for the first 0.12 s
    const pw = a0 < 0.12 ? [0, 1, 0.25, 1, 0.6][Math.min(4, Math.floor(a0 / 0.025))] : 1;
    if (pw <= 0.01) return;
    const grow = 1 + 0.05 * (1 - smooth(a0 / 0.18));
    const ix = 70, iy = M.y + 16, iw = 1920 - 2 * ix, ih = M.h - 32, cx = 960, cy = M.y + M.h / 2;
    const px = (x) => cx + (x - cx) * grow, py = (y) => cy + (y - cy) * grow;
    const CR = '#FFF3D6', GREEN = '#37F28E';
    ctx.save(); ctx.globalAlpha = pw; ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
    ctx.shadowColor = 'rgba(0,0,0,0.75)'; ctx.shadowBlur = 6;
    // thirds
    ctx.strokeStyle = 'rgba(255,243,214,0.26)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); for (let i = 1; i < 3; i++) { ctx.moveTo(px(ix + (iw * i) / 3), py(iy)); ctx.lineTo(px(ix + (iw * i) / 3), py(iy + ih)); ctx.moveTo(px(ix), py(iy + (ih * i) / 3)); ctx.lineTo(px(ix + iw), py(iy + (ih * i) / 3)); } ctx.stroke();
    // centre cross
    ctx.strokeStyle = 'rgba(255,243,214,0.55)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx - 16, cy); ctx.lineTo(cx + 16, cy); ctx.moveTo(cx, cy - 16); ctx.lineTo(cx, cy + 16); ctx.stroke();
    // corner brackets
    ctx.strokeStyle = CR; ctx.lineWidth = 4; const bl = 46;
    for (const [sx, sy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const x = px(ix + sx * iw), y = py(iy + sy * ih), dx = sx ? -1 : 1, dy = sy ? -1 : 1; ctx.beginPath(); ctx.moveTo(x + dx * bl, y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy * bl); ctx.stroke(); }
    // REC dot + label (top-left)
    const recOn = (a0 % 1.0) < 0.62;
    ctx.shadowBlur = 8; ctx.fillStyle = recOn ? '#FF3B30' : 'rgba(255,59,48,0.18)'; ctx.beginPath(); ctx.arc(px(ix + 36), py(iy + 40), 10, 0, TAU); ctx.fill();
    ctx.fillStyle = CR; ctx.font = F.label(24, 700); ctx.textBaseline = 'middle'; ctx.letterSpacing = '5px'; ctx.fillText('REC', px(ix + 56), py(iy + 41)); ctx.letterSpacing = '3px'; ctx.font = F.label(18, 600); ctx.fillStyle = 'rgba(255,243,214,0.7)'; ctx.fillText('A-CAM', px(ix + 140), py(iy + 42));
    // timecode (top-right), fixed-advance digits
    { const ss = Math.floor(t) % 60, ff = Math.floor((t % 1) * 24), tc = `00:00:${String(ss).padStart(2, '0')}:${String(ff).padStart(2, '0')}`; ctx.font = F.label(26, 600); ctx.fillStyle = CR; ctx.textAlign = 'left'; ctx.letterSpacing = '0px';
      const x0 = px(ix + iw - 36) - 11 * 17; for (let i = 0; i < tc.length; i++) { const ch = tc[i], w = ch === ':' ? 9 : 17; ctx.fillText(ch, x0 + (ch === ':' ? 4 : 0) + i * 17 - (ch === ':' ? 0 : 0), py(iy + 40)); } }
    // lens mark + exposure (bottom-right)
    { const x = px(ix + iw - 36), y = py(iy + ih - 38); ctx.textAlign = 'right'; ctx.letterSpacing = '2px';
      ctx.font = F.display(58); ctx.fillStyle = CR; ctx.fillText('24', x - 62, y); ctx.font = F.label(18, 700); ctx.fillStyle = 'rgba(255,243,214,0.75)'; ctx.fillText('MM', x - 4, y + 12); ctx.fillText('T2.8   1/48', x - 4, y - 18);
      ctx.beginPath(); ctx.arc(x - 175, y - 2, 18, 0, TAU); ctx.lineWidth = 2.5; ctx.strokeStyle = CR; ctx.stroke(); ctx.beginPath(); ctx.arc(x - 175, y - 2, 7, 0, TAU); ctx.stroke(); ctx.textAlign = 'left'; }
    // level / horizon (bottom centre)
    { const y = py(iy + ih - 30); ctx.strokeStyle = 'rgba(255,243,214,0.55)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx - 80, y); ctx.lineTo(cx - 14, y); ctx.moveTo(cx + 14, y); ctx.lineTo(cx + 80, y); ctx.moveTo(cx, y - 8); ctx.lineTo(cx, y + 8); ctx.stroke(); }
    // audio meters (right edge)
    { for (let ch = 0; ch < 2; ch++) { const x = px(ix + iw - 22 - ch * 14), yb = py(cy + 90), hgt = 150, lvl = 0.45 + 0.35 * noise1(t * 7 + ch * 31, 3) + 0.1 * Math.sin(t * 19 + ch);
        ctx.fillStyle = 'rgba(255,243,214,0.18)'; ctx.fillRect(x, yb - hgt, 5, hgt); for (let k = 0; k < 14; k++) { const on = k / 14 < lvl; ctx.fillStyle = on ? (k > 11 ? '#FF5A4A' : k > 8 ? '#FFB62E' : GREEN) : 'rgba(255,243,214,0.0)'; if (on) ctx.fillRect(x, yb - (k + 1) * (hgt / 14) + 1, 5, hgt / 14 - 2); } } }
    ctx.shadowBlur = 0;

    // ---- tracking boxes (thin) over drones and crane heads, fading when the focus locks
    const trkA = (0.75 * smooth(seg(a0, 0.05, 0.25))) * (1 - 0.65 * smooth(seg(lt, BEEP, BEEP + 0.15)));
    if (trkA > 0.01) { ctx.strokeStyle = `rgba(255,243,214,${trkA})`; ctx.lineWidth = 2; ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 4;
      for (const o of st.trk) { const s = clamp(o.s * 0.5, 22, 110), x = o.x, y = o.y; if (x < 40 || x > 1880 || y < M.y + 10 || y > M.y + M.h - 10) continue; const k = s * 0.34;
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { ctx.beginPath(); ctx.moveTo(x + sx * s, y + sy * (s - k)); ctx.lineTo(x + sx * s, y + sy * s); ctx.lineTo(x + sx * (s - k), y + sy * s); ctx.stroke(); } }
      ctx.shadowBlur = 0; }

    // ---- focus box: hunts (centre -> drone -> crane -> her body) then RACKS onto her eye at the beep, confirm green
    { const E0 = st.eye, Fc = st.face;
      const pts = [{ x: cx, y: cy, s: 92 }, { x: st.trk[0].x, y: st.trk[0].y, s: 64 }, { x: st.trk[5].x, y: st.trk[5].y, s: 70 }, { x: Fc.x, y: Fc.y, s: Math.max(120, Fc.s * 0.55) }];
      const times = [0, 0.13, 0.26, 0.38]; let bx = pts[0].x, by = pts[0].y, bs = pts[0].s;
      for (let i = 1; i < pts.length; i++) { const k = smooth(seg(a0, times[i], times[i] + 0.07)); bx = lerp(bx, pts[i].x, k); by = lerp(by, pts[i].y, k); bs = lerp(bs, pts[i].s, k); }
      const rk = lt >= BEEP ? spring(lt - BEEP, 4.5, 0.55) : 0; // rack with a little overshoot
      bx = lerp(bx, E0.x, rk); by = lerp(by, E0.y, rk); bs = lerp(bs, Math.max(44, E0.s * 1.15), clamp(rk, 0, 1.05));
      const locked = lt >= BEEP, hunt = locked ? 0 : 1, jit = hunt * (a0 < 0.45 ? 5 : 0);
      bx += jit * noise1(t * 40, 1); by += jit * noise1(t * 43, 2);
      const col = locked ? GREEN : CR, w = locked ? 4.5 : 3;
      ctx.save(); ctx.shadowColor = locked ? 'rgba(55,242,142,0.85)' : 'rgba(0,0,0,0.7)'; ctx.shadowBlur = locked ? 16 + 14 * beep : 5; ctx.strokeStyle = col; ctx.lineWidth = w; ctx.globalAlpha = pw * smooth(seg(a0, 0.1, 0.22));
      const k = bs * 0.42;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { ctx.beginPath(); ctx.moveTo(bx + sx * bs, by + sy * (bs - k)); ctx.lineTo(bx + sx * bs, by + sy * bs); ctx.lineTo(bx + sx * (bs - k), by + sy * bs); ctx.stroke(); }
      if (locked) { // confirm: flash ring, tick and small label
        const age = lt - BEEP; ctx.globalAlpha = pw * Math.exp(-age / 0.18); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(bx, by, bs * (1.1 + 1.6 * outQuad(age / 0.3)), 0, TAU); ctx.stroke();
        ctx.globalAlpha = pw; ctx.fillStyle = GREEN; ctx.shadowBlur = 10; ctx.beginPath(); ctx.arc(bx + bs + 20, by - bs + 4, 6, 0, TAU); ctx.fill();
        ctx.font = F.label(17, 800); ctx.letterSpacing = '4px'; ctx.textBaseline = 'middle'; ctx.fillText('AF  LOCK', bx + bs + 34, by - bs + 5);
      }
      ctx.restore(); }
    ctx.restore();
  },
};
