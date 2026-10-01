// Lab harness for amrita3d.js: builds its OWN scene/camera/lights and renders tiles through S.post.render (same chain as the film).
// Pages: amrita3d.html (overview sheet) · amrita3d_expr.html · amrita3d_props.html · amrita3d_styles.html · amrita3d_motion.html · amrita3d_hero.html
import '/web/engine/main.js';

const SRC = new URLSearchParams(location.search).get('src') === 'dev' ? '/web/lab/_a3d_dev.js' : '/web/engine/amrita3d.js';

export async function run(sheet) {
  await new Promise((r) => { const i = setInterval(() => { if (window.film) { clearInterval(i); r(); } }, 20); });
  await window.film.init({ scale: 1 });
  const S = window.film.S, THREE = S.THREE, F = S.F, R_ = S.renderer;
  const M3 = await import(SRC);
  const { createAmrita } = M3;

  // ---------- rig ----------
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#14131b');
  const key = new THREE.SpotLight('#ffe2b0', 85, 30, 0.55, 0.7, 2); key.position.set(2.4, 3.2, 4.4); key.target.position.set(0, 0, 0);
  const rim = new THREE.SpotLight('#9fd4ff', 170, 30, 0.7, 0.7, 2); rim.position.set(-3.2, 2.4, -3.6); rim.target.position.set(0, 0, 0);
  const fill = new THREE.PointLight('#7aa8ff', 3.5, 30, 2); fill.position.set(-3.5, 0.2, 3.5);
  const amb = new THREE.AmbientLight('#2a2f4a', 0.3);
  scene.add(key, key.target, rim, rim.target, fill, amb);
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 80);
  const floorMat = new THREE.MeshPhysicalMaterial({ color: '#15141a', roughness: 0.28, metalness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.35 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), floorMat); floor.rotation.x = -Math.PI / 2; floor.visible = false; scene.add(floor);
  const A = createAmrita(THREE, { fullEnv: new URLSearchParams(location.search).get('fullenv') === '1' }); scene.add(A.root);

  const cv = document.createElement('canvas'); cv.width = 1920; cv.height = 1080; document.body.appendChild(cv);
  const g = cv.getContext('2d'); g.fillStyle = '#0b0a0d'; g.fillRect(0, 0, 1920, 1080);
  const stats = [];

  // ---------- tile renderer ----------
  let curW = 0, curH = 0;
  function tile(x, y, w, h, o) {
    if (w !== curW || h !== curH) { R_.setSize(w, h, false); curW = w; curH = h; }
    camera.fov = o.fov || 28; camera.aspect = w / h; camera.near = 0.1; camera.far = 80;
    const t = o.t ?? 1.0;
    const apply = (tt) => {
      A.root.position.set(...(o.at || [0, 0, 0])); A.root.rotation.set(0, 0, 0);
      A.pose({ yaw: 0.45, ...(o.pose || {}) });
      A.expression('neutral'); if (o.expr) A.expression(o.expr, o.exprAmt ?? 1, o.exprFrom); if (o.eyes) A.eyes(o.eyes);
      if (o.look) A.eyes({ lookX: o.look[0], lookY: o.look[1] });
      A.setProp(o.prop || null, { t: tt, ...(o.propO || {}) });
      A.setStyle(o.style || 'solid', { t: tt, ...(o.styleO || {}) });
      A.contactShadow(o.shadow || false);
      floor.visible = !!o.floor;
      camera.position.set(...o.cam); camera.lookAt(...o.look3); camera.updateProjectionMatrix();
      if (o.fn) o.fn(A, tt);
    };
    apply(t);
    const t0 = performance.now();
    S.post.render({ scene, camera, w, h, times: o.times || [t], update: (tt) => apply(tt), dof: o.dof || { enabled: false }, bloom: o.bloom || { strength: 0.3, radius: 0.4, threshold: 1.0 }, exposure: o.exposure ?? 1, jitter: !!o.times });
    stats.push(performance.now() - t0);
    g.drawImage(R_.domElement, 0, 0, w, h, x, y, w, h);
    if (o.label) { g.save(); g.font = `${o.fs || 15}px monospace`; g.fillStyle = 'rgba(255,255,255,0.85)'; g.shadowColor = '#000'; g.shadowBlur = 4; g.fillText(o.label, x + 8, y + (o.fs || 15) + 4); g.restore(); }
  }
  const FACE = { fov: 24, cam: [0.1, 0.0, 1.9], look3: [0.05, 0, 0.1] };
  const FULL = { fov: 28, cam: [0, 0.04, 3.0], look3: [0, 0, 0] };
  const WITHP = { fov: 28, cam: [0.45, 0.1, 3.4], look3: [0.38, -0.02, 0] };
  const PCLOSE = { fov: 30, cam: [0.9, 0.0, 1.25], look3: [0.72, -0.05, 0.12] };
  const EXPRS = ['neutral', 'blink', 'squint', 'happy', 'determined', 'surprised', 'sleepy', 'wink', 'worried', 'angry'];
  const PROPS = ['crank', 'megaphone', 'viewfinder', 'clapper', 'slate', 'baton', 'brush'];
  const PROP_T = { crank: 0.35, megaphone: 0.5, viewfinder: 0.3, clapper: 0.5, slate: 0.8, baton: 0.5, brush: 0.55 };
  const PROP_O = { clapper: { clap: 0.25 }, megaphone: { speak: 1 }, baton: {}, brush: {} };

  if (sheet === 'expr') {
    const tw = 480, th = 480;
    ['neutral', 'blink', 'squint', 'happy', 'determined', 'surprised', 'sleepy', 'wink'].forEach((e, i) => tile((i % 4) * tw, Math.floor(i / 4) * th, tw, th, { ...FACE, expr: e, label: e, fs: 20, t: 1 }));
  } else if (sheet === 'expr2') {
    const tw = 480, th = 480;
    [['worried'], ['angry'], ['neutral', { look: [1, 0] }], ['neutral', { look: [-1, 0] }], ['neutral', { look: [0, 1] }], ['neutral', { look: [0, -1] }], ['happy', { exprAmt: 0.5 }], ['determined', { exprAmt: 0.5 }]].forEach(([e, o], i) => tile((i % 4) * tw, Math.floor(i / 4) * th, tw, th, { ...FACE, expr: e, ...(o || {}), label: e + (o ? ' ' + JSON.stringify(o) : ''), fs: 18, t: 1 }));
  } else if (sheet === 'yaw') {
    const tw = 320, th = 360, yaws = [-0.6, 0, 0.35, 0.7, 1.05, 1.5], rows = [
      yaws.map((y) => ({ pose: { yaw: y }, label: 'yaw ' + y })),
      [{ pose: { yaw: 0.5, roll: 0.35 }, label: 'roll .35' }, { pose: { yaw: 0.5, pitch: -0.5 }, label: 'pitch -.5' }, { pose: { yaw: 0.5, pitch: 0.45 }, label: 'pitch .45' }, { pose: { yaw: 2.3 }, label: 'yaw 2.3 (back 3/4)' }, { pose: { yaw: 3.14 }, label: 'back' }, { pose: { yaw: 0.5, squash: 0.35 }, label: 'stretch .35' }],
    ];
    rows.forEach((row, r) => row.forEach((o, i) => tile(i * tw, r * th, tw, th, { ...FULL, fov: 30, cam: [0, 0.04, 3.2], ...o, expr: 'happy', exprAmt: r ? 0 : 0.0, t: 1, fs: 16 })));
  } else if (sheet === 'props') {
    const tw = 480, th = 480;
    PROPS.forEach((p, i) => tile((i % 4) * tw, Math.floor(i / 4) * th, tw, th, { ...WITHP, prop: p, propO: PROP_O[p], t: PROP_T[p], expr: 'happy', label: p, fs: 20 }));
  } else if (sheet === 'propsc') {
    const tw = 480, th = 480;
    PROPS.forEach((p, i) => tile((i % 4) * tw, Math.floor(i / 4) * th, tw, th, { ...PCLOSE, pose: { yaw: 0.5 }, prop: p, propO: PROP_O[p], t: PROP_T[p], label: p, fs: 20 }));
  } else if (sheet === 'propsanim') {
    const tw = 480, th = 480;
    [['clapper', { clap: 1 }, 0.5], ['clapper', { clap: 0.55 }, 0.5], ['clapper', { clap: 0 }, 0.5], ['baton', {}, 0.0], ['baton', {}, 0.25], ['baton', {}, 0.5], ['baton', {}, 0.75], ['brush', {}, 0.95]].forEach(([p, po, t], i) => tile((i % 4) * tw, Math.floor(i / 4) * th, tw, th, { ...PCLOSE, pose: { yaw: 0.5 }, prop: p, propO: po, t, label: `${p} ${JSON.stringify(po)} t=${t}`, fs: 18 }));
  } else if (sheet === 'styles') {
    const tw = 480, th = 480;
    [['solid', {}], ['hologram', { hue: 0.49, alpha: 0.6 }], ['particles', { form: 1 }], ['particles', { form: 0.55 }], ['particles', { form: 0.2 }], ['ghost', { alpha: 0.5 }], ['hologram', { hue: 0.75, alpha: 0.6 }], ['particles', { form: 1, hue: 0.1 }]].forEach(([s, so], i) => tile((i % 4) * tw, Math.floor(i / 4) * th, tw, th, { ...FULL, fov: 30, cam: [0, 0.04, 2.9], style: s, styleO: so, prop: i === 1 ? 'slate' : null, expr: 'happy', t: 2.3, label: `${s} ${JSON.stringify(so)}`, fs: 18 }));
  } else if (sheet === 'motion') {
    const tw = 240, th = 270, ts = [0.2, 0.55, 0.8, 0.9, 0.96, 1.03, 1.12, 1.4];
    const drop = (t) => ({ ...A.dropIn(t, { t0: 0, tLand: 0.95, fromY: 2.6 }) });
    ts.forEach((t, i) => tile(i * tw, 0, tw, th, { fov: 34, cam: [0, 1.2, 5.2], look3: [0, 1.15, 0], floor: true, shadow: { floorY: 0 }, at: [0, 0.75, 0], t, fn: (a, tt) => { const m = drop(tt); a.pose({ yaw: 0.5, ...m }); }, label: 'drop t=' + t, fs: 13 }));
    const jt = [-0.15, -0.02, 0.1, 0.3, 0.55, 0.78, 0.86, 1.05];
    jt.forEach((t, i) => tile(i * tw, th, tw, th, { fov: 34, cam: [0, 1.2, 5.2], look3: [0, 1.15, 0], floor: true, shadow: { floorY: 0 }, at: [0, 0.75, 0], t, fn: (a, tt) => { a.pose({ yaw: 0.5, ...a.jump(tt, 0, { height: 0.9, air: 0.8 }) }); }, label: 'jump t=' + t, fs: 13 }));
    const lt = [-0.12, 0.0, 0.05, 0.1, 0.17, 0.26, 0.4, 0.7];
    lt.forEach((t, i) => tile(i * tw, th * 2, tw, th, { fov: 34, cam: [0, 1.2, 5.2], look3: [0, 1.15, 0], floor: true, shadow: { floorY: 0 }, at: [0, 0.75, 0], t, fn: (a, tt) => { a.pose({ yaw: 0.5, ...a.addPose(a.land(tt, 0), a.hover(tt, {})) }); }, expr: 'surprised', label: 'land t=' + t, fs: 13 }));
    const eyesRow = [0, 0.04, 0.08, 0.12, 0.17, 0.5, 1.0, 1.5];
    eyesRow.forEach((t, i) => tile(i * tw, th * 3, tw, th, { ...FACE, fov: 30, t, fn: (a, tt) => { a.pose({ yaw: 0.45 }); a.eyes({ open: 1 - a.blinkAmount(tt + 2.55 - 0.0, 0) }); }, label: 'blink t=' + t, fs: 13 }));
  } else if (sheet === 'hero') {
    // film-like hero shot: floor, rim, DOF, bloom, 4 sub-frames
    const times = M3.__subTimes ? M3.__subTimes(1.0) : [0.99, 1.0, 1.01, 1.02];
    key.intensity = 95; rim.intensity = 120; floorMat.roughness = 0.75; floorMat.metalness = 0.1; floorMat.clearcoat = 0; floor.visible = true; rim.position.set(-2.4, 2.6, -3.8);
    const w = 1920, h = Math.round(1920 / 2.39 / 2) * 2;
    tile(0, 0, w, h, { fov: 26, cam: [1.5, 0.95, 3.3], look3: [0.2, 0.74, 0], floor: true, shadow: { floorY: 0, opacity: 0.7 }, at: [0, 0.78, 0], prop: 'slate', propO: {}, expr: 'determined', exprAmt: 0.7, pose: { yaw: 0.55 }, t: 1.0, times: [0.98, 0.993, 1.007, 1.02], dof: { enabled: true, focus: 3.65, strength: 0.8, maxPx: 10 }, bloom: { strength: 0.3, radius: 0.5, threshold: 0.95 }, fn: (a, tt) => { a.pose({ yaw: 0.55, ...a.hover(tt, {}) }); a.eyes({ open: 1 - a.blinkAt(tt) }); } });
  } else if (sheet === 'perf') {
    // real cost: gl.finish() after every frame, 4 sub-frames + DOF + bloom, 1920x804 (2.39 matte) -- includes the lab floor + 3 lights, no shadows
    const w = 1920, h = 804, gl = R_.getContext(), px = new Uint8Array(4); key.intensity = 95; rim.intensity = 120; floor.visible = true; R_.setSize(w, h, false); curW = w; curH = h;
    const cfgs = [['solid+slate', 'solid', 'slate'], ['solid+crank', 'solid', 'crank'], ['hologram', 'hologram', null], ['particles', 'particles', null], ['ghost', 'ghost', null]];
    camera.fov = 26; camera.aspect = w / h; camera.position.set(1.5, 0.95, 3.3); camera.lookAt(0.2, 0.74, 0); camera.updateProjectionMatrix();
    for (const [name, sty, prop] of cfgs) {
      const run = (t) => S.post.render({ scene, camera, w, h, times: [t - 0.008, t - 0.0027, t + 0.0027, t + 0.008], update: (tt) => { A.root.position.set(0, 0.78, 0); A.idle(tt, { yaw: 0.55 }); A.setProp(prop, { t: tt }); A.setStyle(sty, { t: tt, form: 0.8 }); A.contactShadow({ floorY: 0 }); }, dof: { enabled: true, focus: 3.65, strength: 0.8, maxPx: 10 }, bloom: { strength: 0.3, radius: 0.5, threshold: 0.95 }, jitter: true });
      run(1); gl.finish(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);          // warm-up (compile)
      const t0 = performance.now(); for (let i = 0; i < 4; i++) { run(2 + i * 0.033); gl.finish(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); } const ms = (performance.now() - t0) / 4;
      console.log(`PERF ${name}: ${ms.toFixed(0)} ms/frame (1920x804, 4 sub-frames, DOF+bloom)`);
    }
    // the same with NO character (floor + lights only) = baseline
    A.root.visible = false; const t1 = performance.now(); for (let i = 0; i < 3; i++) { S.post.render({ scene, camera, w, h, times: [1, 1.003, 1.006, 1.009], update: () => {}, dof: { enabled: true, focus: 3.65, strength: 0.8, maxPx: 10 }, bloom: { strength: 0.3, radius: 0.5, threshold: 0.95 }, jitter: true }); gl.finish(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); } console.log(`PERF baseline (no character): ${((performance.now() - t1) / 3).toFixed(0)} ms/frame`); A.root.visible = true;
  } else if (sheet === 'perfmat') {
    // which material feature costs what? Amrita only, no post, direct render, min of 3 with gl.finish
    const w = 1920, h = 804, gl = R_.getContext(), px = new Uint8Array(4); R_.setSize(w, h, false); curW = w; curH = h;
    camera.fov = 26; camera.aspect = w / h; camera.position.set(1.5, 0.95, 3.3); camera.lookAt(0.2, 0.74, 0); camera.updateProjectionMatrix();
    A.root.position.set(0, 0.78, 0); A.pose({ yaw: 0.55 }); A.setProp('slate', { t: 1 }); A.setStyle('solid'); A.contactShadow(false); A.useEnvironment(R_);
    const M = A.materials, list = [M.blade, M.bladeAlt, M.body, M.face, M.plastic, M.metal], all = [...list, M.eye];
    const time = (name) => { R_.render(scene, camera); gl.finish(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); let best = 1e9; for (let i = 0; i < 3; i++) { const t0 = performance.now(); R_.render(scene, camera); gl.finish(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); best = Math.min(best, performance.now() - t0); } console.log(`PERFMAT ${name.padEnd(34)} ${best.toFixed(0)} ms`); };
    floor.visible = false; scene.background = new THREE.Color('#14131b');
    A.root.visible = false; time('empty scene');
    A.root.visible = true; time('current (physical+cc+env, 3 lights)');
    const env = new Map(all.map((m) => [m, m.envMap]));
    for (const m of all) { m.envMap = null; m.needsUpdate = true; } time('env OFF');
    const cc = new Map(all.map((m) => [m, m.clearcoat]));
    for (const m of all) { m.clearcoat = 0; m.needsUpdate = true; } time('env OFF + clearcoat OFF');
    for (const m of all) { m.envMap = env.get(m); m.needsUpdate = true; } time('env ON + clearcoat OFF');
    for (const m of all) { m.clearcoat = cc.get(m); m.needsUpdate = true; }
    const eyeOnly = (on) => { for (const m of all) { m.envMap = (m === M.eye) === on ? env.get(m) : null; m.needsUpdate = true; } };
    eyeOnly(true); time('env on EYE only (cc on)');
    // lights
    for (const m of all) { m.envMap = null; m.needsUpdate = true; } rim.visible = false; fill.visible = false; time('env OFF, 1 spot only');
    rim.visible = true; fill.visible = true;
    // plain standard material for everything (upper bound of the cheap path)
    A.root.traverse((o) => { if (o.isMesh && o.material && o.material.isMeshPhysicalMaterial) { o.userData.m0 = o.material; o.material = new THREE.MeshStandardMaterial({ color: o.material.color, vertexColors: o.material.vertexColors, roughness: o.material.roughness, metalness: o.material.metalness }); } }); time('MeshStandardMaterial everywhere');
    A.root.traverse((o) => { if (o.isMesh && o.userData.m0) o.material = o.userData.m0; });
    time('current again (noise check)');
  } else { // overview
    const tw = 240, th = 240;
    EXPRS.slice(0, 8).forEach((e, i) => tile(i * tw, 0, tw, th, { ...FACE, fov: 28, expr: e, label: e, fs: 13 }));
    [-0.6, 0, 0.35, 0.7, 1.05, 1.5, 2.4, 3.14].forEach((y, i) => tile(i * tw, th, tw, th, { ...FULL, fov: 32, cam: [0, 0.04, 3.2], pose: { yaw: y }, expr: 'happy', label: 'yaw ' + y, fs: 13 }));
    PROPS.forEach((p, i) => tile(i * tw, th * 2, tw, th, { fov: 34, cam: [0.35, 0.1, 3.8], look3: [0.35, -0.02, 0], prop: p, propO: PROP_O[p], t: PROP_T[p], expr: 'happy', label: p, fs: 13 }));
    tile(7 * tw, th * 2, tw, th, { ...FULL, fov: 32, cam: [0, 0.04, 3.2], style: 'ghost', styleO: { alpha: 0.5 }, label: 'ghost', fs: 13 });
    [['hologram', { hue: 0.49 }], ['particles', { form: 1 }], ['particles', { form: 0.5 }], ['particles', { form: 0.2 }]].forEach(([s, so], i) => tile(i * tw, th * 3, tw, th, { ...FULL, fov: 32, cam: [0, 0.04, 3.2], style: s, styleO: so, expr: 'happy', t: 2.3, label: s + JSON.stringify(so), fs: 13 }));
    [0.9, 1.0, 1.05, 1.2].forEach((t, i) => tile((4 + i) * tw, th * 3, tw, th, { fov: 34, cam: [0, 1.2, 5.2], look3: [0, 1.15, 0], floor: true, shadow: { floorY: 0 }, at: [0, 0.75, 0], t, fn: (a, tt) => { a.pose({ yaw: 0.5, ...a.dropIn(tt, { t0: 0, tLand: 0.95, fromY: 2.6 }) }); }, label: 'drop ' + t, fs: 13 }));
  }
  // draw-call count for the current rig (solid + prop)
  { A.root.position.set(0, 0, 0); A.pose({ yaw: 0.5 }); A.setProp('crank', { t: 1 }); A.setStyle('solid'); A.contactShadow({ floorY: -1 }); camera.position.set(0, 0, 3); camera.lookAt(0, 0, 0); camera.aspect = 1; camera.updateProjectionMatrix(); floor.visible = false;
    R_.setRenderTarget(null); R_.info.reset(); R_.render(scene, camera); console.log('draw calls (solid+crank+shadow):', R_.info.render.calls, 'tris', R_.info.render.triangles); }
  console.log('tile ms:', stats.map((s) => Math.round(s)).join(','));
  window.__done = true;
}
