// =============================================================================
// job_score.js — "SCORE" (36.0 – 38.0) · orbit, 40 mm. "She scores."
//   36.00 - 37.00  (orch_tune swell) an ORCHESTRA MADE OF LIGHT assembles out of drifting sparks: music stands, instrument silhouettes,
//                  light-person musicians (lib: crowd3d.createOrchestraOfLight). Amrita hovers over a glowing podium; her BATON rises
//                  (36.0-36.4), hangs trembling at the top (anticipation, 36.4-36.84), then the fast stroke 36.84 -> 37.0.
//   37.00  (baton_whoosh, HIT L = the BIG orchestral hit) the baton lands EXACTLY on the ictus: orchestra BURSTS (lib hit()), floor shock
//                  wave + camera-facing shock rings, radial god-rays, flash, 200 sparks, light ribbons surge, camera push + FOV punch + shake,
//                  bloom kick. Warm gold / cream brass light and cool blue strings, volumetric beams from above.
//   37.50  beat 2 of the pattern: the baton swings left and a soft light-wave pulses out through the orchestra; 38.0 beat 3.
// Everything is a pure function of T.t (4 sub-frames per frame = motion blur). No Math.random / Date.now.
// =============================================================================
import { createStage, setLook as stageSetLook, LOOKS } from '../stage3d.js';
import { createAmrita } from '../amrita3d.js';
import { createOrchestraOfLight } from '../crowd3d.js';
import { createBeam, createHaze, createRibbons, createGodrayCard, glowSprite } from '../fx3d.js';
import * as E from '../ease.js';
import { hash, noise1 } from '../rng.js';
import { lensFov, makeEnv, makeSparks, makeRings, setBeamK } from './job_cast.js';

const { clamp, lerp, smooth, smoother, outCubic } = E;
const TAU = Math.PI * 2;
const seg = (x, a, b) => clamp((x - a) / (b - a));
const BEAT = 0.5;

// ---- the baton: map real time -> phase (in beats) of Amrita's built-in 4-beat conducting pattern (ictus = pb 0 mod 4)
//   36.00-36.40 raise (pb 2.2 -> 3.0 = the top of the beat-4 up-flick)   36.40-36.84 hang + tremble   36.84-37.00 FAST stroke (3 -> 4)
//   after 37.00 the pattern runs at 120 BPM: beat 2 (left) 37.5, beat 3 (right) 38.0
export function batonPhase(t, t0, tHit) {
  const raise = t0 + 0.4, hang = tHit - 0.16;
  if (t < raise) return 2.2 + 0.8 * smooth((t - t0) / 0.4);
  if (t < hang) return 3.0 - 0.02 * smooth((t - raise) / 0.1) + 0.012 * Math.sin((t - raise) * 38) * smooth((t - raise) / 0.2);
  if (t < tHit) { const s = (t - hang) / (tHit - hang); return 2.98 + 1.02 * s; }
  return 4 + (t - tHit) / BEAT;
}

// ---- big flat decal on the floor: expanding shock-wave rings (hit + beat pulses), one draw call. ev: [{t, max, w, k}]
function makeShockDecal(THREE, events, size = 34) {
  const U = { uE: { value: events.map(() => new THREE.Vector4(-1, 1, 0.2, 1)) }, uCol: { value: new THREE.Color(1.0, 0.82, 0.5) }, uCol2: { value: new THREE.Color(0.5, 0.7, 1.0) } };
  const n = events.length;
  const mat = new THREE.ShaderMaterial({
    uniforms: U, defines: { NE: n }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    vertexShader: `varying vec2 vP; void main(){ vP = position.xy * ${size.toFixed(1)}; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `precision highp float; varying vec2 vP; uniform vec4 uE[NE]; uniform vec3 uCol, uCol2;
      void main(){ float r = length(vP); vec3 c = vec3(0.0);
        for (int i = 0; i < NE; i++) {
          float age = uE[i].x; if (age < 0.0 || age > 1.6) continue;
          float R = uE[i].y * (1.0 - exp(-age * 4.6)), w = uE[i].z * (0.55 + 1.5 * age), fade = exp(-age * 2.6) * uE[i].w;
          float ring = exp(-pow((r - R) / w, 2.0)), tail = exp(-max(R - r, 0.0) * 0.9) * step(r, R) * 0.16;
          c += (uCol * ring + uCol2 * ring * ring * 0.4 + uCol * tail) * fade;
          c += uCol * exp(-r * r / (1.2 + 8.0 * age)) * exp(-age * 6.5) * uE[i].w * 0.7;
        }
        gl_FragColor = vec4(c, 1.0); }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat); m.rotation.x = -Math.PI / 2; m.scale.set(size, size, 1); m.position.y = 0.016; m.renderOrder = 2; m.frustumCulled = false; m.name = 'shock-decal';
  m.userData.set = (t) => { events.forEach((e, i) => { U.uE.value[i].set(t >= e.t ? t - e.t : -1, e.max, e.w, e.k); }); };
  return m;
}

// ============================== SCENE ===================================
const PODIUM_H = 0.34;
const AM_Y = PODIUM_H + 0.82;                       // Amrita's centre height (hovering over the podium)

export default {
  id: 'job_score', kind: '3d', ratio: 2.39,
  setup({ THREE, S, renderer }) {
    const cues = S.cues;
    const sc = cues.sceneById('job_score');
    const tHit = (cues.HITS.find((h) => h.s === 'L' && h.t >= sc.t0 && h.t < sc.t1) || { t: 37.0 }).t;                 // baton-down hit (L) from cues
    const tune = cues.SFX.find((e) => e.id === 'orch_tune') || { t: 36.0, dur: 1.0 };
    const tAsm0 = tune.t, tAsm1 = tune.t + (tune.dur || 1.0);
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#05040a'); scene.fog = new THREE.FogExp2('#0c0a12', 0.011);
    const stage = createStage(THREE, { THREE, S, renderer }, { look: 'warm', table: false, cases: false, cables: false, grips: false, tubes: false, marks: false, chair: false });
    scene.add(stage.group);
    stageSetLook(stage, { ...LOOKS.warm, washL: ['#b87a22', 0.5], washR: ['#2b4cc4', 0.5], pool: ['#f2b25a', 0.5], haze: ['#9a86a8', 0.5], key: ['#ffd9a0', 1.0], rim: ['#9fc4ff', 1.0] }, { intensity: 1 });
    scene.environment = makeEnv(THREE, renderer, [
      { w: 7, h: 3.5, pos: [-5, 4, 6], color: '#ffd9a0', i: 4.5 }, { w: 2.4, h: 8, pos: [7, 3, -4], color: '#8fb8ff', i: 3.4 },
      { w: 9, h: 2, pos: [0, 8, 1], color: '#fff1d8', i: 1.4 }, { w: 6, h: 2, pos: [-3, 0.5, 6], color: '#ffb870', i: 0.9 },
    ]);
    scene.environmentIntensity = 0.5;
    stage.lights.key.castShadow = false; stage.floor.receiveShadow = false; stage.cyc.receiveShadow = false; stage.setHaze(0.55);
    const camera = new THREE.PerspectiveCamera(lensFov(40), 2.39, 0.1, 100);

    // ---- podium + Amrita
    const podMat = new THREE.MeshStandardMaterial({ color: '#17141c', roughness: 0.32, metalness: 0.6, envMapIntensity: 1.2 });
    const podium = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 1.0, PODIUM_H, 56), podMat); podium.position.y = PODIUM_H / 2; scene.add(podium);
    const lipMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 1.9, 0.55), toneMapped: false });
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.93, 0.016, 8, 96), lipMat); lip.rotation.x = Math.PI / 2; lip.position.y = PODIUM_H + 0.004; scene.add(lip);
    const A = createAmrita(THREE);
    A.root.position.set(0, AM_Y, 0); scene.add(A.root);
    A.contactShadow({ radius: 0.62, opacity: 0.6, floorY: PODIUM_H });
    stage.reflect(A.root, { strength: 0.7 });

    // ---- the orchestra made of light (library): conductor at the origin, players on 3 curved rows facing her, open toward +Z
    const orch = createOrchestraOfLight(THREE, { seed: 2, count: 30, radius: 2.8, rowGap: 1.25, arc: 3.5, size: 1.05, sparks: 220, pointSize: 0.046 });
    scene.add(orch.group);
    // mirrored copy under the glossy floor (same geometry/material, flipped in Y) -> light reflections of the whole orchestra
    const om = orch.points.material, mirMat = new THREE.ShaderMaterial({
      uniforms: om.uniforms, vertexShader: om.vertexShader, fragmentShader: om.fragmentShader.replace('gl_FragColor = vec4(vCol, a);', 'gl_FragColor = vec4(vCol * 3.2, a);'),   // shares every uniform with the orchestra; brighter, because the glossy floor only lets ~15 % through
      transparent: true, depthWrite: true, depthTest: true, blending: THREE.AdditiveBlending, toneMapped: false,
    });
    const mir = new THREE.Points(orch.points.geometry, mirMat); mir.scale.y = -1; mir.frustumCulled = false; mir.renderOrder = -11; mir.onBeforeRender = orch.points.onBeforeRender; mir.name = 'orch-mirror';
    scene.add(mir);

    // ---- beams from above, haze, shock decal, rings, sparks, ribbons, rays, flash
    const BEAMS = [
      // gold brass-light from the front-left onto the conductor
      { from: [-2.6, 7.4, 2.6], to: [0.0, 0.5, 0.0], color: '#ffc872', angle: 0.105, on: 0.0, k: 0.85 },
      // cool blue "strings" light from behind left / right
      { from: [-5.2, 7.4, -3.2], to: [-3.4, 0.4, -3.4], color: '#6fa6ff', angle: 0.12, on: 0.55, k: 0.9 },
      { from: [5.2, 7.4, -3.2], to: [3.4, 0.4, -3.6], color: '#78b4ff', angle: 0.12, on: 0.55, k: 0.9 },
      // warm brass behind
      { from: [-1.6, 7.6, -6.5], to: [-1.0, 0.6, -5.4], color: '#ffd27a', angle: 0.11, on: 1.0, k: 0.95 },
      // the column: ignites on the downbeat
      { from: [0.0, 8.0, -0.2], to: [0.0, 0.0, -0.2], color: '#fff0cc', angle: 0.075, on: 1.0, k: 1.4 },
    ];
    const beams = BEAMS.map((o, i) => {
      const b = createBeam(THREE, { from: o.from, to: o.to, color: o.color, angle: o.angle, intensity: 0, noise: 1, steps: 9, soft: 0.5, falloff: 0.9, streak: 0.35, gain: 0.3, pool: false, glow: false, seed: i });
      b.material.depthWrite = true; scene.add(b.object); return b;
    });
    const haze = createHaze(THREE, { count: 520, seed: 9, bounds: { min: [-9, 0.2, -9], max: [9, 7, 6] }, size: 0.022, intensity: 1, ambient: 0.05, boost: 2.6, color: '#ffe0b0', drift: [0.01, 0.025, 0.005], turbulence: 0.25 });
    haze.attachBeams(beams); scene.add(haze.object);
    const shock = makeShockDecal(THREE, [{ t: tHit, max: 13, w: 0.32, k: 1.5 }, { t: tHit + BEAT, max: 8, w: 0.3, k: 0.55 }, { t: tHit + 2 * BEAT, max: 8, w: 0.3, k: 0.4 }]); scene.add(shock);
    const rings = [
      { t: tHit, pos: [0, AM_Y, 0.2], r0: 0.35, r1: 6.8, dur: 0.55, color: [1.6, 1.1, 0.5] },
      { t: tHit + 0.04, pos: [0, AM_Y, 0.2], r0: 0.2, r1: 4.2, dur: 0.4, color: [1.1, 1.1, 1.0] },
      { t: tHit + 0.12, pos: [0, AM_Y, 0.2], r0: 0.2, r1: 8.5, dur: 0.7, color: [0.7, 1.0, 2.0] },
      { t: tHit + BEAT, pos: [0, AM_Y, 0.2], r0: 0.85, r1: 4.2, dur: 0.45, color: [0.8, 0.58, 0.28] },
      { t: tHit + 2 * BEAT - 0.02, pos: [0, AM_Y, 0.2], r0: 0.85, r1: 3.6, dur: 0.4, color: [0.45, 0.55, 0.9] },
    ];
    const ringsG = makeRings(THREE, rings); scene.add(ringsG);
    const TIP = [1.25, 1.2, 0.85];                      // approx. baton tip at the ictus (refined by propAnchor in update)
    const bursts = [
      { t: tHit, pos: TIP, n: 70, speed: [1.0, 6.5], life: [0.4, 1.1], dir: [0.4, 0.6, 0.5], spread: 1, size: [0.016, 0.045], color: [3.0, 2.2, 0.9], seed: 1 },
      { t: tHit, pos: [0, 0.5, 0], n: 90, speed: [3.0, 9.0], life: [0.5, 1.3], dir: [0, 0.18, 0], spread: 1, size: [0.016, 0.045], color: [3.0, 2.0, 0.8], seed: 2 },
      { t: tHit + 0.01, pos: [0, 1.6, -3.0], n: 90, speed: [1.0, 7.0], life: [0.6, 1.4], dir: [0, 1, 0], spread: 0.8, size: [0.016, 0.05], color: [1.2, 1.8, 3.2], seed: 3 },
      { t: tHit + BEAT, pos: [0, 0.5, 0], n: 40, speed: [2.0, 6.0], life: [0.4, 0.9], dir: [0, 0.2, 0], spread: 1, size: [0.014, 0.036], color: [2.4, 1.7, 0.7], seed: 4 },
    ];
    const sparks = makeSparks(THREE, bursts, { gravity: [0, -1.0, 0], drag: 1.3 }); scene.add(sparks);
    // light ribbons: a spiral around the conductor, an arch over the orchestra, a low swirl through the rows
    const spiral = []; for (let i = 0; i <= 16; i++) { const u = i / 16, a = u * TAU * 1.6, r = 1.2 + 1.6 * u; spiral.push([Math.cos(a) * r, 0.4 + 5.2 * Math.pow(u, 0.85), Math.sin(a) * r - 0.4]); }
    const arch = []; for (let i = 0; i <= 14; i++) { const u = i / 14, a = Math.PI * (1.05 - 1.1 * u); arch.push([Math.cos(a) * 6.2, 0.6 + Math.sin(a) * 4.6, -2.8 + 0.8 * Math.sin(u * 5)]); }
    const swirl = []; for (let i = 0; i <= 14; i++) { const u = i / 14, a = Math.PI * (0.1 + 0.8 * u) + Math.PI; swirl.push([Math.cos(a) * (3.6 + 0.4 * Math.sin(u * 6)), 0.8 + 0.7 * Math.sin(u * 7), Math.sin(a) * (3.6 + 0.4 * Math.sin(u * 6)) - 0.2]); }
    const PAL = ['#ffd36b', '#fff3d6', '#7cc4ff', '#ffb62e', '#6b5bff'];
    const rib = [
      createRibbons(THREE, { bundle: { curve: spiral, count: 22, spread: 0.55, twist: 1.4 }, segments: 72, width: 0.05, colors: PAL, speed: 0.55, wave: 0.14, seed: 3, intensity: 0 }),
      createRibbons(THREE, { bundle: { curve: arch, count: 20, spread: 0.7, twist: 1.0 }, segments: 72, width: 0.05, colors: PAL, speed: 0.45, wave: 0.18, seed: 5, intensity: 0 }),
      createRibbons(THREE, { bundle: { curve: swirl, count: 18, spread: 0.45, twist: 1.8 }, segments: 64, width: 0.045, colors: PAL, speed: 0.6, wave: 0.12, seed: 7, intensity: 0 }),
    ];
    rib.forEach((r) => scene.add(r.object));
    const rays = createGodrayCard(THREE, { width: 17, height: 17, mode: 'radial', origin: [0.5, 0.5], rays: 26, billboard: true, intensity: 0, color: '#ffe6b4', speed: 0.2, seed: 3 });
    rays.object.position.set(0, AM_Y + 0.1, -0.9); scene.add(rays.object);
    const flash = glowSprite(THREE, { color: '#ffdca0', size: 3.0, intensity: 0, depthTest: true }); flash.renderOrder = 15; scene.add(flash);
    const halo = glowSprite(THREE, { color: '#ffcf8a', size: 4.4, intensity: 0, depthTest: true }); halo.renderOrder = 14; halo.position.set(0, AM_Y, -0.35); scene.add(halo);

    // key / rim / fill
    const L = stage.lights;
    L.key.color.set('#ffdba8'); L.key.intensity = 300; L.key.position.set(-6.0, 7.2, 7.5); L.key.target.position.set(0, 1.0, 0); L.key.angle = 0.5; L.key.penumbra = 0.8; L.key.target.updateMatrixWorld();
    L.rim.color.set('#9cc8ff'); L.rim.intensity = 1300; L.rim.position.set(1.2, 11.0, -9.0); L.rim.target.position.set(0, 1.0, 0); L.rim.angle = 0.6; L.rim.penumbra = 0.8; L.rim.target.updateMatrixWorld();
    L.fill.color.set('#ff9d5c'); L.fill.intensity = 30; L.fill.position.set(7, 3.0, 5);
    L.amb.intensity = 0.4;
    const tmp = { v: new THREE.Vector3(), v2: new THREE.Vector3(), v3: new THREE.Vector3() };
    return { scene, camera, stage, A, orch, mir, beams, haze, shock, ringsG, sparks, rib, rays, flash, halo, podium, lip, lipMat, tHit, tAsm0, tAsm1, tmp, THREE, BEAMS };
  },

  update(st, T, S) {
    const { camera, A, orch, beams, haze, shock, ringsG, sparks, rib, rays, flash, halo, stage, tmp, tHit, tAsm0, tAsm1, BEAMS, lipMat } = st;
    const D = globalThis.__dbg || {};
    const t = T.t, lt = clamp(T.lt, 0, 2), imp = Math.min(1, T.impact);
    const age = t - tHit, a0 = Math.max(age, 0);
    stage.update(t);
    if (globalThis.__dbg) {                                                   // developer toggles (tools only; never set in the render)
      st.orch.group.visible = !D.noOrch; st.mir.visible = !D.noOrch && !D.noMirror; haze.object.visible = !D.noHaze; sparks.visible = !D.noSparks; ringsG.visible = !D.noRings; rib.forEach((r) => { r.object.visible = !D.noRibbons; });
      stage.group.visible = !D.noStage; stage.cyc.visible = !D.noCyc; stage.truss.visible = !D.noTruss; stage.group.traverse((o) => { if (o.name && o.name.startsWith('mist')) o.visible = !D.noMist; });
      shock.visible = !D.noShock; A.root.visible = !D.noAmrita; beams.forEach((b) => { b.object.visible = !D.noBeams; }); flash.visible = !D.noFlash; halo.visible = !D.noHalo; st.podium.visible = !D.noPodium; stage.floor.visible = !D.noFloor;
      { const m = stage.floorMat, key = (D.flClear ? 1 : 0) + (D.flBump ? 2 : 0) + (D.flRough ? 4 : 0);
        if (st._flKey !== key) { st._flKey = key; if (D.flClear) m.clearcoat = 0; if (D.flBump) m.bumpMap = null; if (D.flRough) m.roughnessMap = null; if (key) m.needsUpdate = true; } }
    }

    // ---- the music: energy envelope (tuning swell -> HIT -> sustained with a pulse on every beat)
    const asm = clamp((t - tAsm0) / (tAsm1 - tAsm0));
    const bph = ((t - tHit) / BEAT % 1 + 1) % 1;                            // 0 on each beat after the hit
    const beatEnv = age >= 0 ? Math.exp(-bph / 0.16) : 0;
    const burstL = age >= 0 ? Math.min(1.5, Math.exp(-age / 0.2)) : 0;     // = the library's own burst envelope (crowd3d: exp(-age/0.2)); used to keep the total brightness in range
    const hitEnv = age >= 0 ? Math.exp(-age / 0.22) : 0;                     // body of the hit
    const flashEnv = age >= -0.01 ? Math.exp(-a0 / 0.07) * smooth((age + 0.01) / 0.012) : 0; // the white-hot instant
    const energy = age < 0 ? 0.08 + 0.3 * smooth(asm) + 0.12 * Math.max(0, Math.sin(asm * 22)) * asm : 0.7 + 0.25 * beatEnv + 0.9 * hitEnv;
    orch.update(T, { assemble: [tAsm0, tAsm1], hits: [tHit], intensity: (D.orchK ?? 1) * (age < 0 ? 0.85 + 0.15 * smooth(asm) : (0.95 + 0.2 * beatEnv) * lerp(0.36, 1.0, smooth(a0 / 0.55))), play: age < 0 ? 0.22 + 0.3 * asm : 0.9 + 0.1 * smooth(age / 0.2) });
    haze.update(t); sparks.userData.update(t); ringsG.userData.update(t, camera); shock.userData.set(t);
    rib.forEach((r, i) => { r.update(t); r.uniforms.uInt.value = (asm < 0.35 ? 0 : 0.04 * smooth((asm - 0.35) / 0.65)) + (age >= 0 ? 0.3 * smooth(age / 0.05) * (0.5 + 1.0 * hitEnv + 0.5 * beatEnv) : 0); });
    rib[0].uniforms.uWave.value = 0.14 + 0.25 * hitEnv; rib[1].uniforms.uWave.value = 0.18 + 0.3 * hitEnv; rib[2].uniforms.uWave.value = 0.12 + 0.2 * beatEnv;

    // ---- beams: gold key on the podium from the start, blue strings lights come up with the tune-up, everything ignites on the downbeat
    beams.forEach((b, i) => {
      const o = BEAMS[i];
      let k;
      if (o.on === 0) k = 0.55 + 0.25 * asm + (age >= 0 ? 0.4 * hitEnv + 0.1 * beatEnv : 0);
      else if (o.on < 0.9) k = 0.3 * smooth(seg(t, tAsm0 + 0.15, tAsm0 + 0.9)) + 0.2 * asm + (age >= 0 ? 0.4 + 0.4 * hitEnv + 0.1 * beatEnv : 0);
      else k = age >= 0 ? (0.5 + 0.5 * hitEnv + 0.12 * beatEnv) * smooth(age / 0.035) : 0.0;
      setBeamK(b, k * o.k); b.update(t);
    });
    rays.update(t); rays.uniforms.uInt.value = age >= 0 ? 0.32 * Math.exp(-age / 0.13) * smooth(age / 0.02) : 0; rays.object.visible = rays.uniforms.uInt.value > 0.002 && !D.noRays;
    lipMat.color.setRGB(2.2 + 1.2 * hitEnv + 0.4 * beatEnv, 1.4 + 0.7 * hitEnv, 0.4 + 0.3 * hitEnv);

    // ---- Amrita ----------------------------------------------------------------------------------------------------------------
    const hv = A.hover(t, { amp: 0.02, seed: 4 });
    const squash = hv.squash + (age < 0 ? A.anticipate(t, tHit, { dur: 0.2, squat: 0.2 }) + 0.05 * smooth(seg(t, tHit - 0.55, tHit - 0.25)) : A.punch(t, tHit, { amp: 0.3, freq: 3.0, damp: 0.32 }) + A.beatPulse(t, { bpm: 120, amp: 0.045, offset: tHit }) * smooth(age / 0.4));
    const thC = lerp(0.62, -0.1, smooth(lt / 2)), yawBase = 0.8 * thC - 0.12;
    A.pose({ yaw: yawBase + hv.yawD, roll: hv.roll - 0.05 * (age >= 0 ? Math.sin(age * TAU / 2) * smooth(age / 0.5) : 0), bob: hv.bob + (age >= 0 ? 0.06 * Math.exp(-age / 0.2) : -0.02 * smooth(seg(t, tHit - 0.4, tHit - 0.04))), squash });
    // baton
    const pb = batonPhase(t, tAsm0, tHit);
    A.setProp('baton', { t: pb * BEAT, ictus: 0, beat: BEAT, amp: 1.9, scale: 3.0, side: 1, trail: 1.0, float: 0.0, rotY: -0.25 });
    A.glow(0.1 + 0.3 * hitEnv + 0.1 * beatEnv);
    A.propAnchor(tmp.v);                                                   // baton tip (world)
    // eyes: determined while she builds it, WIDE on the downbeat, then radiant joy; they follow the baton / the beat
    const wide = age >= 0 ? Math.exp(-age / 0.1) : 0;
    A.eyes({ open: 1 - A.blinkAt(T) * (age >= -0.3 && age < 0.3 ? 0 : 1), determined: age < 0 ? 0.55 * smooth(seg(t, tAsm0, tAsm0 + 0.5)) : 0, surprised: 0.8 * wide, happy: age >= 0.12 ? 1 : 0, squint: 0 });
    tmp.v2.set(tmp.v.x * 0.6, tmp.v.y + 0.4, tmp.v.z + 2.0);
    if (age >= BEAT * 0.9 && age < BEAT * 1.9) tmp.v2.set(-3.0, 1.8, 0.3); else if (age >= BEAT * 1.9) tmp.v2.set(3.0, 1.8, 0.3);
    A.lookAt(tmp.v2, { gain: 2.0 });
    A.root.position.set(0, AM_Y, 0);
    // flash on the baton tip
    flash.position.copy(tmp.v); flash.userData.set({ intensity: age >= -0.01 ? 1.2 * flashEnv + 0.25 * hitEnv : 0.5 * smooth(seg(t, tHit - 0.5, tHit - 0.05)), size: 1.6 + 1.8 * flashEnv });
    halo.userData.set({ intensity: age >= 0 ? 0.25 * hitEnv + 0.1 * beatEnv : 0.2 * asm, size: 3.8 + 1.8 * hitEnv });

    // ---- camera: orbit (40 mm) from the right side of the podium to the front, crane-down; pull-back during the hang, SLAM push on the hit
    const u = smooth(lt / 2);
    const th = lerp(0.62, -0.1, u), rho0 = lerp(9.6, 8.2, u);
    const rx = Math.cos(th), rz = -Math.sin(th);                           // camera-right on the floor plane
    const pull = 0.3 * smooth(seg(t, tHit - 0.55, tHit - 0.02)) * (age < 0 ? 1 : 0);
    const push = age >= 0 ? 1.15 * (1 - Math.exp(-a0 / 0.07)) * (0.55 + 0.45 * Math.exp(-a0 / 0.7)) : 0;
    const rho = rho0 + pull - push, hgt = lerp(4.3, 3.0, u) - 0.1 * push;
    const shk = imp * 0.06;
    camera.position.set(Math.sin(th) * rho + shk * noise1(t * 53, 1), hgt + shk * 0.7 * noise1(t * 47, 2), -0.6 + Math.cos(th) * rho + shk * noise1(t * 59, 3));
    camera.fov = lensFov(40) * (1 - 0.05 * hitEnv * smooth(age / 0.03) - 0.02 * smooth(seg(t, tHit - 0.5, tHit)) * (age < 0 ? 1 : 0));
    camera.lookAt(tmp.v3.set(-1.45 * rx, lerp(1.1, 1.3, u), -0.7 - 1.45 * rz));
    camera.rotateZ(0.012 * hitEnv * noise1(t * 31, 5));
    camera.updateProjectionMatrix();

    // lights flare with the music
    stage.lights.key.intensity = 300 * (0.55 + 0.45 * smooth(asm) + 0.35 * hitEnv + 0.1 * beatEnv);
    stage.lights.rim.intensity = 1300 * (0.5 + 0.5 * smooth(asm) + 0.4 * hitEnv);

    const fd = tmp.v3.set(0, AM_Y, 0).distanceTo(camera.position);
    return { dof: { enabled: !D.noDof, focus: fd, strength: 0.5, maxPx: 9, bokeh: 1.2 }, bloom: { strength: (D.noBloom ? 0 : 1) * (D.bloomK ?? 1) * (0.38 + 0.36 * flashEnv + 0.1 * hitEnv + 0.07 * beatEnv), radius: 0.65, threshold: D.bloomTh ?? 0.8 }, exposure: 1 + 0.08 * flashEnv, shake: 6 };
  },
};
