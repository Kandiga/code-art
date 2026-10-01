// Lab harness for stage3d.js + fx3d.js: builds its OWN scene/camera and renders tiles through S.post.render (the same chain as the film:
// 4 sub-frames, DOF, bloom, ACES). Pages: stage3d.html (stage sheet) · stage3d_fx.html (FX gallery) · stage3d_fx2.html · stage3d_looks.html · stage3d_perf.html
// URL params: ?sub=4 (sub-frames, default 1 for speed) ?w=960 ?h=402 ?bloom=1
import '/web/engine/main.js';

const Q = new URLSearchParams(location.search);
const SUB = +(Q.get('sub') || 1), TW = +(Q.get('w') || 960), TH = +(Q.get('h') || 402);

export async function run(sheet) {
  await new Promise((r) => { const i = setInterval(() => { if (window.film) { clearInterval(i); r(); } }, 20); });
  await window.film.init({ scale: 1 });
  const S = window.film.S, THREE = S.THREE, R_ = S.renderer;
  const FX = await import('/web/engine/fx3d.js');
  const ST = await import('/web/engine/stage3d.js');
  const { subTimes } = await import('/web/engine/post.js');
  const errors = []; window.addEventListener('error', (e) => errors.push(e.message));

  // ---------- world ----------
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#03040a'); scene.fog = new THREE.FogExp2('#0a0c14', 0.016);
  const tS = performance.now();
  const stage = ST.createStage(THREE, { S, renderer: R_ }, { layout: 'showcase', ...(Q.get('opts') ? JSON.parse(Q.get('opts')) : {}) }); scene.add(stage.group);
  const setupMs = performance.now() - tS;
  scene.environment = stage.envMap; scene.environmentIntensity = 0.5;
  const camera = new THREE.PerspectiveCamera(30, TW / TH, 0.1, 90);
  const A = S.amrita3d.createAmrita(THREE); A.root.visible = false; scene.add(A.root); A.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  A.contactShadow({ radius: 0.7, opacity: 0.5 });
  const ampRefl = stage.reflect(A.root, { strength: 1.1 });
  const L = stage.lights;
  L.key.shadow.camera.near = 3; L.key.shadow.camera.far = 22;
  const beamSet = stage.rig.beams({ sel: 'front', max: 4, intensity: 1.0, angle: 0.16 });
  const beamTop = stage.rig.beams({ sel: 'top', max: 2, intensity: 0.8, angle: 0.15 });
  const beamBack = stage.rig.beams({ sel: 'back', max: 4, intensity: 0.8, angle: 0.13 });
  const allBeams = [beamSet, beamTop, beamBack];
  const haze = FX.createHaze(THREE, { count: 900, bounds: { min: [-7, 0.1, -7], max: [7, 7, 5] }, size: 0.022 }); scene.add(haze.object);
  const T0 = 3.7;

  const cv = document.createElement('canvas'); cv.width = sheet === 'one' ? TW : 1920; cv.height = sheet === 'perf' ? 400 : sheet === 'one' ? TH : TH * 3; document.body.appendChild(cv);
  const g = cv.getContext('2d'); g.fillStyle = '#0b0a0d'; g.fillRect(0, 0, cv.width, cv.height);
  const stats = [];

  const defaults = () => {
    stage.setLook('neutral'); stage.setHaze(1); stage.setGlow(1); stage.rig.set('all', { intensity: 1, on: true, color: null });
    stage.rig.get('all').forEach((f) => { f.color = null; });
    ST.rigThreePoint(stage, { target: [0, 0.8, 0] });
    L.key.intensity = 260; L.rim.intensity = 330; L.fill.intensity = 7;
    allBeams.forEach((b) => { b.group.visible = true; b.beams.forEach((x) => x.setIntensity(x.fixture.group === 'front' ? 1.0 : 0.8)); });
    haze.object.visible = true; A.root.visible = false; stage.chair.position.set(0, 0, 0); stage.chair.rotation.y = 0.35; stage.chair.visible = true;
    scene.fog.density = 0.016;
  };

  function countDraws() { // draw calls of ONE plain scene render (what a sub-frame costs), shadow pass included
    R_.info.autoReset = false; R_.info.reset(); R_.setRenderTarget(null); R_.render(scene, camera); const c = R_.info.render.calls; R_.info.autoReset = true; return c;
  }
  // ---------- tile renderer ----------
  let curW = 0, curH = 0;
  function tile(x, y, w, h, o) {
    if (w !== curW || h !== curH) { R_.setSize(w, h, false); curW = w; curH = h; }
    defaults(); if (o.setup) o.setup();
    camera.fov = o.fov || 30; camera.aspect = w / h; camera.near = o.near || 0.1; camera.far = 90;
    const t = o.t ?? T0;
    const apply = (tt) => {
      camera.position.set(...o.cam); camera.lookAt(...o.look); camera.updateProjectionMatrix();
      stage.update(tt); allBeams.forEach((b) => b.update(tt)); haze.attachBeams([...beamSet.beams, ...beamTop.beams]); haze.update(tt);
      if (o.fn) o.fn(tt);
    };
    apply(t);
    const focus = o.focus ?? camera.position.distanceTo(new THREE.Vector3(...o.look));
    const times = SUB > 1 ? subTimes(t, 30, SUB, 0.5) : [t];
    const t0 = performance.now();
    S.post.render({ scene, camera, w, h, times, update: apply, dof: o.dof || { focus, strength: 0.55, maxPx: 12, bokeh: 1.3 }, bloom: o.bloom || { strength: 0.42, radius: 0.55, threshold: 0.9 }, exposure: o.exposure ?? 1, jitter: SUB > 1 });
    const gl = R_.getContext(); const px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const ms = performance.now() - t0; const calls = o.count ? countDraws() : 0; stats.push([o.label, ms, calls]);
    g.drawImage(R_.domElement, 0, 0, w, h, x, y, w, h);
    if (o.label) { g.save(); g.font = '16px monospace'; g.fillStyle = 'rgba(255,255,255,0.9)'; g.shadowColor = '#000'; g.shadowBlur = 4; g.fillText(`${o.label}  ${Math.round(ms)}ms${calls ? ' ' + calls + ' draws' : ''}`, x + 8, y + 20); g.restore(); }
  }
  const col = (i) => (i % 2) * TW, row = (i) => Math.floor(i / 2) * TH;
  const amritaOn = (x = 0.95, y = 0.82, z = 0.5, yaw = -0.5) => { A.root.visible = true; A.root.position.set(x, y, z); A.root.rotation.set(0, 0, 0); A.pose({ yaw, bob: 0 }); A.eyes({ open: 1, lookX: 0.5, lookY: 0.1 }); A.expression('happy', 0.6); A.setProp('slate', { t: T0, glow: 1 }); };

  const SHOTS = {
    wide: { label: 'WIDE establishing', cam: [0.8, 1.9, 13.0], look: [0, 3.0, -2], fov: 40, focus: 14, dof: { focus: 14, strength: 0.25, maxPx: 8, bokeh: 1.2 }, setup() { ST.rigThreePoint(stage, { target: [0, 0.8, 0], key: { dist: 11 } }); stage.rig.set('front', { intensity: 1.3 }); amritaOn(1.05, 0.8, 0.45, -0.5); } },
    chair: { label: 'CHAIR hero (low)', cam: [2.6, 0.32, 3.9], look: [-0.05, 0.74, 0], fov: 24, focus: 4.6, setup() { L.key.intensity = 300; stage.rig.set('front', { intensity: 1.4 }); beamSet.group.visible = false; beamBack.group.visible = false; beamTop.beams.forEach((b) => b.setIntensity(0.9)); ST.rigThreePoint(stage, { target: [0, 0.8, 0], key: { az: -50, el: 30 }, rim: { az: 150 } }); } },
    rim: { label: 'RIM-LIT empty set', cam: [0.0, 1.15, 8.0], look: [0, 1.1, 0], fov: 28, focus: 8, setup() { L.key.intensity = 0; L.fill.intensity = 0; L.rim.intensity = 520; L.rim.color.set('#bfe2ff'); stage.rig.set('front', { intensity: 0.15 }); stage.rig.set('back', { intensity: 1.8 }); beamSet.group.visible = false; beamTop.group.visible = false; } },
    rig: { label: 'RIG detail (truss + fixtures)', cam: [-5.6, 4.6, 8.2], look: [-2.8, 7.0, 2.6], fov: 36, focus: 8, dof: { focus: 8, strength: 0.4, maxPx: 10, bokeh: 1.4 }, setup() { stage.rig.set('front', { intensity: 1.6 }); stage.rig.set('back', { intensity: 1.2 }); } },
    props: { label: 'TABLE + clapper', cam: [-1.7, 1.28, 0.3], look: [-3.35, 0.88, -1.45], fov: 26, focus: 2.6, setup() { stage.clapper.setOpen(0.5); L.key.intensity = 300; } },
    cases: { label: 'CASES + cables + tape', cam: [-2.2, 0.75, 2.2], look: [-5.2, 0.4, -1.4], fov: 32, focus: 4.6, setup() { L.key.intensity = 300; } },
    hero: { label: 'AMRITA hero + reflection', cam: [2.0, 0.55, 4.2], look: [0.5, 0.75, 0.3], fov: 26, focus: 4.4, setup() { amritaOn(0.75, 0.8, 0.5, -0.5); L.key.intensity = 320; ST.rigThreePoint(stage, { target: [0.5, 0.8, 0.3] }); beamBack.group.visible = false; beamSet.group.visible = false; beamTop.beams.forEach((b, i) => b.setIntensity(i ? 0 : 1.1)); } },
    low: { label: 'FLOOR sheen, grazing', cam: [0.0, 0.16, 6.5], look: [0, 0.3, -4], fov: 30, focus: 8, setup() { amritaOn(0.2, 0.7, 0.2, -0.4); } },
    teal: { label: 'look: teal-orange', cam: [2.0, 0.55, 4.2], look: [0.3, 0.8, 0], fov: 26, focus: 4.4, setup() { stage.setLook('teal-orange'); ST.rigThreePoint(stage, { target: [0.3, 0.8, 0] }); amritaOn(0.7, 0.8, 0.5, -0.5); } },
    noir: { label: 'look: noir', cam: [2.0, 0.55, 4.2], look: [0.3, 0.8, 0], fov: 26, focus: 4.4, setup() { stage.setLook('noir'); ST.rigThreePoint(stage, { target: [0.3, 0.8, 0] }); amritaOn(0.7, 0.8, 0.5, -0.5); } },
    warm: { label: 'look: warm', cam: [2.0, 0.55, 4.2], look: [0.3, 0.8, 0], fov: 26, focus: 4.4, setup() { stage.setLook('warm'); ST.rigThreePoint(stage, { target: [0.3, 0.8, 0] }); amritaOn(0.7, 0.8, 0.5, -0.5); } },
    neutral: { label: 'look: neutral', cam: [2.0, 0.55, 4.2], look: [0.3, 0.8, 0], fov: 26, focus: 4.4, setup() { ST.rigThreePoint(stage, { target: [0.3, 0.8, 0] }); amritaOn(0.7, 0.8, 0.5, -0.5); } },
  };
  const API = { S, THREE, FX, ST, stage, scene, camera, A, haze, allBeams, tile, TW, TH, cv, g, stats, defaults, SHOTS, col, row, errors, R_, setupMs, subTimes, T0, amritaOn };
  window.__lab = API;


  // ---------- FX gallery (each tile = its own group parked at x = 40*k, rendered from its own camera) ----------
  const fxRoot = new THREE.Group(); scene.add(fxRoot);
  const fxGroups = {}; const fxUpd = {};
  const slot = (k) => { const gr = new THREE.Group(); gr.userData.k = k; gr.visible = false; fxRoot.add(gr); return gr; };
  const flatFloor = (gr, y = 0, c = '#0b0b10') => { const m = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: c, roughness: 0.3, metalness: 0.4 })); m.rotation.x = -Math.PI / 2; m.position.set(40 * (gr.userData.k || 0), y, 0); gr.add(m); return m; };
  const P = (x, y, z, k) => [x + 40 * k, y, z];
  {
    // 1 beams: three crossing beams (amber / teal / violet) over a hazy floor
    const gr = fxGroups.beams = slot(1); flatFloor(gr);
    const mk = (from, to, color, a, i) => FX.createBeam(THREE, { from: P(...from, 1), to: P(...to, 1), color, angle: a, intensity: i });
    const bs = [mk([-4, 7, -2], [0.5, 0, 0], '#ffb62e', 0.16, 1.0), mk([4.5, 7, -3], [-0.5, 0, 0.5], '#1fb5a6', 0.14, 1.0), mk([0, 7.5, -5], [0, 0, 1], '#6b5bff', 0.12, 1.2)];
    bs.forEach((b) => gr.add(b.object));
    const hz = FX.createHaze(THREE, { count: 1200, bounds: { min: P(-7, 0.1, -7, 1), max: P(7, 7, 5, 1) }, size: 0.022 }); hz.attachBeams(bs); gr.add(hz.object);
    fxUpd.beams = (t) => { bs.forEach((b) => b.update(t)); hz.update(t); };
    fxGroups.beams.userData.beams = bs;
  }
  {
    // 2 haze macro: one beam, dust motes with heavy bokeh
    const gr = fxGroups.haze = slot(2); flatFloor(gr);
    const b = FX.createBeam(THREE, { from: P(-1.5, 5.5, -3, 2), to: P(0.3, 0, 0, 2), color: '#ffe2b0', angle: 0.13, intensity: 1.3 }); gr.add(b.object);
    const hz = FX.createHaze(THREE, { count: 2200, bounds: { min: P(-3, 0.1, -3, 2), max: P(3, 5, 2.5, 2) }, size: 0.03, boost: 3.0, ambient: 0.08 }); hz.attachBeams([b]); gr.add(hz.object);
    fxUpd.haze = (t) => { b.update(t); hz.update(t); };
  }
  {
    // 3 particle field: swirl that morphs into a ring (aperture)
    const gr = fxGroups.particles = slot(3); flatFloor(gr);
    const N = 6000, pf = FX.createParticleField(THREE, { count: N, shape: 'disc', radius: 2.6, center: P(0, 1.6, 0, 3), bounds: { min: P(-2.6, 0.2, -2.6, 3), max: P(2.6, 3.4, 2.6, 3) }, flow: 'swirl', speed: 1.1, size: 0.03, colors: ['#ffb62e', '#7cc4ff', '#6b5bff', '#fff3d6'], morph: true, seed: 8 });
    const tg = new Float32Array(N * 3); for (let i = 0; i < N; i++) { const a = (i / N) * Math.PI * 2 * 7, rr = i % 3 === 0 ? 1.35 : 1.05 + 0.12 * Math.sin(a * 3), sw = ((i * 7) % N) / N; tg[i * 3] = 40 * 3 + Math.cos(a) * rr; tg[i * 3 + 1] = 1.7 + Math.sin(a) * rr; tg[i * 3 + 2] = (sw - 0.5) * 0.25; }
    pf.setTargets(tg); gr.add(pf.object);
    fxUpd.particles = (t) => pf.update(t, { morph: 0.55 });
    fxGroups.particles.userData.pf = pf;
  }
  {
    // 4 ribbons: neural bundle from a head-ish origin
    const gr = fxGroups.ribbons = slot(4); flatFloor(gr, -0.01, '#06060a');
    const rb = FX.createRibbons(THREE, { bundle: { curve: [P(-2.2, 1.0, 0, 4), P(-1.0, 1.7, 0.4, 4), P(0.4, 2.4, -0.2, 4), P(1.8, 3.2, 0.3, 4), P(3.0, 4.4, -0.4, 4)], count: 90, spread: 0.55, twist: 1.2 }, width: 0.035, wave: 0.12, speed: 0.4, colors: ['#6b5bff', '#7cc4ff', '#1fb5a6', '#ffb62e'], intensity: 1.1, segments: 80 });
    gr.add(rb.object);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.7, 24, 16), FX.hologramMaterial(THREE, { color: '#6b5bff', alpha: 0.7 })); head.position.set(...P(-2.4, 1.0, 0, 4)); gr.add(head);
    fxUpd.ribbons = (t) => { rb.update(t); head.material.userData.update(t); };
  }
  {
    // 5 hologram: knot + sphere over a holo floor, framed
    const gr = fxGroups.holo = slot(5); flatFloor(gr, -0.02, '#05060a');
    const hf = FX.createHoloFloor(THREE, { size: 18, cell: 0.5, color: '#1fb5a6', color2: '#7cc4ff', glow: 1.2 }); hf.group.position.x = 200; gr.add(hf.group);
    const m1 = FX.hologramMaterial(THREE, { color: '#4fd8ff', alpha: 1.0 }), m2 = FX.hologramMaterial(THREE, { color: '#ffb62e', alpha: 0.9 });
    const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(0.55, 0.16, 140, 16), m1); knot.position.set(...P(-0.9, 1.3, 0, 5)); gr.add(knot);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.22, 48, 1), m2); disc.rotation.x = Math.PI / 2 - 0.35; disc.position.set(...P(1.1, 1.2, 0.2, 5)); gr.add(disc);
    fxUpd.holo = (t) => { hf.update(t); m1.userData.update(t); m2.userData.update(t); knot.rotation.y = t * 0.5; };
  }
  {
    // 6 lens flare + glow on a fixture-like emitter + glowing text
    const gr = fxGroups.flare = slot(6); flatFloor(gr);
    const fl = FX.lensFlare(THREE, { color: '#ffcf96', size: 0.5, intensity: 1.2 }); fl.position.set(...P(1.6, 2.4, -2, 6)); gr.add(fl);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.12, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd9a0').multiplyScalar(6), toneMapped: false })); lens.position.copy(fl.position); gr.add(lens);
    const tx = FX.createTextPlane(THREE, 'WORLD  BUILDING', { height: 0.42, color: '#fff3d6', glowColor: '#ffb62e', glow: 0.8, intensity: 1.6, font: S.F.display(160) }); tx.mesh.position.set(...P(-0.5, 1.25, 0, 6)); gr.add(tx.mesh);
    fxUpd.flare = (t) => {};
  }
  {
    // 7 film strip: helix of frames
    const gr = fxGroups.strip = slot(7); flatFloor(gr, -0.01, '#05060a');
    const pts = []; for (let i = 0; i <= 40; i++) { const u = i / 40, a = u * Math.PI * 2.2 - 0.6; pts.push(new THREE.Vector3(40 * 7 + Math.cos(a) * 1.6 + (u - 0.5) * 1.4, 0.4 + u * 2.6, Math.sin(a) * 1.6)); }
    const fs = FX.createFilmStrip(THREE, { curve: pts, width: 0.62, up: [0, 1, 0] }); gr.add(fs.object); fxUpd.strip = (t) => fs.update(t);
    const sh = FX.createGodrayCard(THREE, { width: 5, height: 5, color: '#7cc4ff', intensity: 0.5, mode: 'radial', origin: [0.5, 0.5], rays: 24 }); sh.mesh.position.set(...P(0, 1.6, -1.6, 7)); gr.add(sh.mesh); fxUpd.strip2 = (t) => sh.update(t);
  }
  {
    // 8 panels: storyboard frames with glowing screens + text
    const gr = fxGroups.panels = slot(8); flatFloor(gr);
    const cols = ['#ffb62e', '#1fb5a6', '#6b5bff', '#f2542d'];
    for (let i = 0; i < 4; i++) { const pf = FX.createPanelFrame(THREE, { w: 1.5, h: 0.84, edge: cols[i], screen: { color: cols[i], intensity: 0.35 }, glow: 0.9, brackets: i === 3 }); pf.group.position.set(...P(-2.4 + (i % 2) * 2.6 + (i > 1 ? 0.3 : 0), 1.9 - Math.floor(i / 2) * 1.2, -0.2 * i, 8)); pf.group.rotation.y = -0.18 + i * 0.07; gr.add(pf.group); }
    fxUpd.panels = () => {};
  }
  {
    // 9 godray window card
    const gr = fxGroups.godray = slot(9); flatFloor(gr);
    const sh = FX.createGodrayCard(THREE, { width: 6, height: 7, color: '#ffe2b0', intensity: 0.9, mode: 'parallel', rays: 7, slant: 0.5 }); sh.mesh.position.set(...P(0, 3.4, -3, 9)); sh.mesh.rotation.y = 0.2; gr.add(sh.mesh);
    const hz = FX.createHaze(THREE, { count: 900, bounds: { min: P(-4, 0.1, -5, 9), max: P(4, 6, 2, 9) }, size: 0.02, ambient: 0.1 }); gr.add(hz.object);
    fxUpd.godray = (t) => { sh.update(t); hz.update(t); };
  }
  const FXSHOTS = {
    beams: { fxk: 'beams', label: 'BEAMS + haze motes', cam: P(0, 1.1, 9.5, 1), look: P(0, 2.6, -1, 1), fov: 34, bloom: { strength: 0.5, radius: 0.6, threshold: 0.7 } },
    haze: { fxk: 'haze', label: 'HAZE macro (bokeh)', cam: P(0.4, 1.4, 3.6, 2), look: P(0, 1.8, 0, 2), fov: 30, dof: { focus: 3.4, strength: 1.6, maxPx: 18, bokeh: 1.8 } },
    particles: { fxk: 'particles', label: 'PARTICLES swirl→ring (morph .55)', cam: P(0, 1.9, 7.5, 3), look: P(0, 1.8, 0, 3), fov: 36, bloom: { strength: 0.55, radius: 0.6, threshold: 0.5 } },
    ribbons: { fxk: 'ribbons', label: 'RIBBONS neural bundle', cam: P(0.6, 2.4, 8.5, 4), look: P(0.2, 2.5, 0, 4), fov: 36, bloom: { strength: 0.6, radius: 0.6, threshold: 0.4 } },
    holo: { fxk: 'holo', label: 'HOLOGRAM + holo floor', cam: P(0, 1.6, 6.8, 5), look: P(0, 1.1, 0, 5), fov: 34, bloom: { strength: 0.55, radius: 0.6, threshold: 0.5 } },
    flare: { fxk: 'flare', label: 'LENS FLARE + 3D text', cam: P(-0.6, 1.5, 6.0, 6), look: P(0.4, 1.7, 0, 6), fov: 38, bloom: { strength: 0.5, radius: 0.6, threshold: 0.8 } },
    strip: { fxk: 'strip', label: 'FILM STRIP helix + godray', cam: P(0, 2.0, 7.0, 7), look: P(0, 1.8, 0, 7), fov: 36, bloom: { strength: 0.4, radius: 0.5, threshold: 0.9 } },
    panels: { fxk: 'panels', label: 'PANEL FRAMES (storyboard)', cam: P(0, 1.7, 6.2, 8), look: P(0, 1.5, 0, 8), fov: 34, bloom: { strength: 0.5, radius: 0.6, threshold: 0.8 } },
    godray: { fxk: 'godray', label: 'GODRAY card + motes', cam: P(0, 1.5, 7.0, 9), look: P(0, 2.4, -1, 9), fov: 38, bloom: { strength: 0.45, radius: 0.6, threshold: 0.7 } },
  };
  function fxTile(x, y, w, h, o) {
    Object.values(fxGroups).forEach((gr) => { gr.visible = false; }); fxGroups[o.fxk].visible = true; stage.group.visible = false; haze.object.visible = false; A.root.visible = false;
    if (w !== curW || h !== curH) { R_.setSize(w, h, false); curW = w; curH = h; }
    camera.fov = o.fov || 34; camera.aspect = w / h; const t = o.t ?? T0, saveFog = scene.fog.density; scene.fog.density = 0.0;
    const apply = (tt) => { camera.position.set(...o.cam); camera.lookAt(...o.look); camera.updateProjectionMatrix(); fxUpd[o.fxk](tt); if (o.fxk === 'strip') fxUpd.strip2(tt); stage.update(tt); };
    apply(t); const focus = camera.position.distanceTo(new THREE.Vector3(...o.look)), times = SUB > 1 ? subTimes(t, 30, SUB, 0.5) : [t], t0 = performance.now();
    S.post.render({ scene, camera, w, h, times, update: apply, dof: o.dof || { focus, strength: 0.5, maxPx: 10, bokeh: 1.3 }, bloom: o.bloom || { strength: 0.45, radius: 0.55, threshold: 0.9 }, exposure: 1, jitter: SUB > 1 });
    const gl = R_.getContext(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); const ms = performance.now() - t0; stats.push([o.label, ms, 0]);
    g.drawImage(R_.domElement, 0, 0, w, h, x, y, w, h);
    if (o.label) { g.save(); g.font = '15px monospace'; g.fillStyle = 'rgba(255,255,255,0.9)'; g.shadowColor = '#000'; g.shadowBlur = 4; g.fillText(`${o.label}  ${Math.round(ms)}ms`, x + 8, y + 20); g.restore(); }
    scene.fog.density = saveFog; stage.group.visible = true;
  }
  API.fxTile = fxTile; API.FXSHOTS = FXSHOTS;
  const fxSheets = { fx: ['beams', 'haze', 'particles', 'ribbons', 'holo', 'flare'], fx2: ['strip', 'panels', 'godray', 'beams', 'holo', 'particles'] };
  if (fxSheets[sheet]) fxSheets[sheet].forEach((k, i) => fxTile(col(i), row(i), TW, TH, FXSHOTS[k]));


  if (sheet === 'perf') {
    // ms / frame at 1080p-wide (1920x804, 2.39:1) with the film's 4 sub-frames + DOF + bloom, several content levels. NOTE: software GL, machine shared.
    const W = 1920, H = 804, rows = [], hero = SHOTS.hero;
    const measure = (name, setup, reps = 2) => {
      R_.setSize(W, H, false); curW = W; curH = H; camera.aspect = W / H; camera.fov = hero.fov;
      let best = 1e9, calls = 0;
      for (let r = 0; r < reps; r++) {
        defaults(); setup(); camera.position.set(...hero.cam); camera.lookAt(...hero.look); camera.updateProjectionMatrix();
        const apply = (tt) => { camera.position.set(...hero.cam); camera.lookAt(...hero.look); camera.updateProjectionMatrix(); stage.update(tt); allBeams.forEach((b) => b.update(tt)); haze.attachBeams([...beamSet.beams, ...beamTop.beams]); haze.update(tt); };
        apply(T0); const times = subTimes(T0, 30, 4, 0.5), t0 = performance.now();
        S.post.render({ scene, camera, w: W, h: H, times, update: apply, dof: { focus: hero.focus, strength: 0.55, maxPx: 12, bokeh: 1.3 }, bloom: { strength: 0.42, radius: 0.55, threshold: 0.9 }, exposure: 1, jitter: true });
        const gl = R_.getContext(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); const ms = performance.now() - t0; if (r > 0 || reps === 1) best = Math.min(best, ms);
        if (r === reps - 1) calls = countDraws();
      }
      rows.push({ name, ms: Math.round(best), draws: calls }); console.log('PERF', name, Math.round(best), 'ms', calls, 'draws');
    };
    const none = () => { allBeams.forEach((b) => { b.group.visible = false; }); haze.object.visible = false; };
    measure('stage only (no beams/haze/Amrita)', none);
    measure('+ Amrita + reflection', () => { none(); amritaOn(0.75, 0.8, 0.5, -0.5); });
    measure('+ 4 front beams', () => { none(); amritaOn(0.75, 0.8, 0.5, -0.5); beamSet.group.visible = true; });
    measure('+ 10 beams + 900 motes (full)', () => { amritaOn(0.75, 0.8, 0.5, -0.5); });
    measure('stage w/o reflections (chair mirror off)', () => { none(); amritaOn(0.75, 0.8, 0.5, -0.5); ampRefl.setVisible(false); stage.chairReflection && stage.chairReflection.setVisible(false); });
    g.fillStyle = '#fff'; g.font = '22px monospace'; rows.forEach((r, i) => g.fillText(`${r.name}: ${r.ms} ms   ${r.draws} draws`, 20, 40 + i * 34)); API.perfRows = rows;
  }

  const sheets = {
    main: ['wide', 'chair', 'rim', 'rig', 'props', 'cases'],
    hero: ['hero', 'low', 'chair', 'wide', 'rim', 'rig'],
    looks: ['neutral', 'teal', 'noir', 'warm', 'hero', 'low'],
  };
  if (sheet === 'one') { const k = Q.get('shot') || 'chair'; if (SHOTS[k]) tile(0, 0, TW, TH, SHOTS[k]); else fxTile(0, 0, TW, TH, FXSHOTS[k]); }
  if (sheets[sheet]) sheets[sheet].forEach((k, i) => tile(col(i), row(i), TW, TH, SHOTS[k]));
  return API;
}
