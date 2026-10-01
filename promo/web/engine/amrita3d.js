// =============================================================================
// amrita3d.js — Amrita in 3D: an EXTRUDED icon character built from the proposed mark
// (aperture-iris blades + cream play-triangle face + glossy black oval eyes). No human anatomy.
// Units: R = 0.5 m (disc diameter 1.0 m). Face looks toward +Z. She hovers; props float at her right.
//
// API (stable — scenes code against this):
//   const A = createAmrita(THREE, { style:'solid'|'hologram', color })   -> A
//   A.root                      THREE.Group (position / rotate / scale it; origin = disc centre)
//   A.pose({ squash, yaw, roll, bob })   squash: -0.5..+0.5 (+ = stretch tall, area preserving), yaw radians (turn toward camera ~0.5)
//   A.eyes({ open, squint, happy, determined, surprised, sleepy, lookX, lookY })  all 0..1 (look -1..1)
//   A.expression('neutral'|'happy'|'determined'|'surprised'|'squint'|'sleepy'|'blink', amount=1)
//   A.setProp(kind|null, { t, clap, crank, glow, scale })   kind: 'crank'|'megaphone'|'viewfinder'|'clapper'|'slate'
//   A.blinkAt(T)                seeded natural blinking (call from update; returns 0..1 closed amount)
//   A.setStyle('solid'|'hologram', {hue, alpha})
//   A.materials                 {blade, bladeAlt, face, eye, body, glow} so scenes can tint / change emissive
//   A.faceWorldPos(v3)          writes the world position of her face centre
// =============================================================================
const R = 0.5;

export function createAmrita(THREE, { style = 'solid', palette = {} } = {}) {
  const pal = { vermilion: '#F2542D', amber: '#FFB62E', cream: '#FFF3D6', ink: '#0E0D12', ...palette };
  const root = new THREE.Group(); root.name = 'amrita';
  const body = new THREE.Group(); root.add(body); // squash/yaw group
  const mats = {
    blade: new THREE.MeshPhysicalMaterial({ color: pal.vermilion, roughness: 0.32, metalness: 0.0, clearcoat: 0.9, clearcoatRoughness: 0.18 }),
    bladeAlt: new THREE.MeshPhysicalMaterial({ color: pal.amber, roughness: 0.3, metalness: 0.0, clearcoat: 0.9, clearcoatRoughness: 0.18 }),
    body: new THREE.MeshPhysicalMaterial({ color: '#2A2833', roughness: 0.4, metalness: 0.4, clearcoat: 0.6 }),
    face: new THREE.MeshPhysicalMaterial({ color: pal.cream, roughness: 0.38, clearcoat: 0.7, clearcoatRoughness: 0.25, emissive: pal.cream, emissiveIntensity: 0.08 }),
    eye: new THREE.MeshPhysicalMaterial({ color: pal.ink, roughness: 0.08, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.03, reflectivity: 0.9 }),
    glint: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
    glow: new THREE.MeshBasicMaterial({ color: pal.amber, toneMapped: false }),
  };
  const ex = (shape, depth, bevel = 0.012) => new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 40 });

  // disc back plate
  const disc = new THREE.Shape(); disc.absarc(0, 0, R * 1.0, 0, Math.PI * 2, false);
  const back = new THREE.Mesh(ex(disc, R * 0.22, 0.02), mats.body); back.position.z = -R * 0.22; back.castShadow = true; body.add(back);
  // 6 pinwheel blades
  const blades = [];
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * Math.PI * 2, s = new THREE.Shape(), steps = 14, ro = R * 0.985, ri = R * 0.62;
    for (let k = 0; k <= steps; k++) { const a = a0 + (k / steps) * (Math.PI / 180) * 70; const x = Math.cos(a) * ro, y = Math.sin(a) * ro; k === 0 ? s.moveTo(x, y) : s.lineTo(x, y); }
    s.lineTo(Math.cos(a0 + (Math.PI / 180) * 98) * ri, Math.sin(a0 + (Math.PI / 180) * 98) * ri);
    s.lineTo(Math.cos(a0 + (Math.PI / 180) * 18) * ri, Math.sin(a0 + (Math.PI / 180) * 18) * ri);
    s.closePath();
    const m = new THREE.Mesh(ex(s, R * 0.05, 0.008), i % 2 ? mats.bladeAlt : mats.blade);
    m.position.z = i * 0.004; m.castShadow = true; body.add(m); blades.push(m);
  }
  // cream rounded play-triangle face
  const tri = new THREE.Shape(), rc = R * 0.60, cr = R * 0.12;
  const V = [0, 120, 240].map((d) => [Math.cos((d * Math.PI) / 180) * rc, Math.sin((d * Math.PI) / 180) * rc]);
  for (let i = 0; i < 3; i++) {
    const p0 = V[(i + 2) % 3], p1 = V[i], p2 = V[(i + 1) % 3];
    const d1 = [p0[0] - p1[0], p0[1] - p1[1]], d2 = [p2[0] - p1[0], p2[1] - p1[1]], l1 = Math.hypot(...d1), l2 = Math.hypot(...d2);
    const a = [p1[0] + (d1[0] / l1) * cr * 1.7, p1[1] + (d1[1] / l1) * cr * 1.7], b = [p1[0] + (d2[0] / l2) * cr * 1.7, p1[1] + (d2[1] / l2) * cr * 1.7];
    i === 0 ? tri.moveTo(a[0], a[1]) : tri.lineTo(a[0], a[1]);
    tri.quadraticCurveTo(p1[0], p1[1], b[0], b[1]);
  }
  tri.closePath();
  const face = new THREE.Mesh(ex(tri, R * 0.045, 0.014), mats.face); face.position.z = R * 0.07; face.castShadow = true; body.add(face);

  // eyes (on the face plate): oval = scaled sphere; happy arcs; lids for determined/sleepy
  const faceZ = R * 0.07 + R * 0.045 + 0.012;
  const mkEye = (sx) => {
    const g = new THREE.Group(); g.position.set(-R * 0.08, sx * R * 0.17, faceZ);
    const oval = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), mats.eye); oval.scale.set(R * 0.075, R * 0.125, R * 0.04); oval.castShadow = false; g.add(oval);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), mats.glint); glint.scale.set(R * 0.02, R * 0.03, R * 0.01); glint.position.set(-R * 0.02, R * 0.04, R * 0.036); g.add(glint);
    const arc = new THREE.Mesh(new THREE.TorusGeometry(R * 0.075, R * 0.022, 8, 24, Math.PI), mats.eye); arc.rotation.z = 0; arc.position.y = -R * 0.03; arc.visible = false; g.add(arc);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(R * 0.26, R * 0.12, R * 0.03), mats.face); lid.position.set(0, R * 0.13, R * 0.02); lid.visible = false; g.add(lid);
    body.add(g); return { g, oval, glint, arc, lid, side: sx };
  };
  const E = [mkEye(1), mkEye(-1)];
  const eyeState = { open: 1, squint: 0, happy: 0, determined: 0, surprised: 0, sleepy: 0, lookX: 0, lookY: 0 };
  function applyEyes() {
    const s = eyeState;
    for (const e of E) {
      const openY = Math.max(0.06, s.open * (1 - 0.55 * s.squint) * (1 - 0.45 * s.sleepy) * (1 + 0.35 * s.surprised));
      e.oval.scale.set(R * 0.075 * (1 + 0.25 * s.surprised), R * 0.125 * openY, R * 0.04);
      e.oval.position.set(s.lookX * R * 0.03, s.lookY * R * 0.03, 0);
      e.glint.position.set(-R * 0.02 + s.lookX * R * 0.03, R * 0.04 * openY + s.lookY * R * 0.03, R * 0.036);
      e.oval.visible = s.happy < 0.5; e.glint.visible = s.happy < 0.5; e.arc.visible = s.happy >= 0.5;
      e.lid.visible = s.determined > 0.05; e.lid.position.y = R * (0.19 - 0.06 * s.determined); e.lid.rotation.z = (e.side > 0 ? -1 : 1) * 0.5 * s.determined;
    }
  }
  const EXPR = { neutral: {}, happy: { happy: 1 }, determined: { determined: 1 }, surprised: { surprised: 1 }, squint: { squint: 1 }, sleepy: { sleepy: 1 }, blink: { open: 0 } };

  // ---------- props (floating at her right) ----------
  const propRoot = new THREE.Group(); propRoot.position.set(R * 1.45, -R * 0.1, R * 0.25); root.add(propRoot);
  const propMat = new THREE.MeshStandardMaterial({ color: '#3a3844', roughness: 0.5, metalness: 0.5 });
  const accent = new THREE.MeshStandardMaterial({ color: pal.amber, roughness: 0.4, metalness: 0.6 });
  const props = {}; let curProp = null;
  const box = (w, h, d, m = propMat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  const cyl = (rt, rb, h, m = propMat, seg = 24) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  { // hand-crank camera
    const g = new THREE.Group(); const body_ = box(0.34, 0.22, 0.2); g.add(body_);
    const r1 = cyl(0.11, 0.11, 0.05, accent); r1.rotation.x = Math.PI / 2; r1.position.set(-0.05, 0.2, 0); g.add(r1);
    const r2 = cyl(0.11, 0.11, 0.05, accent); r2.rotation.x = Math.PI / 2; r2.position.set(0.12, 0.2, 0); g.add(r2);
    const lens = cyl(0.07, 0.09, 0.14, propMat); lens.rotation.z = Math.PI / 2; lens.position.set(-0.24, 0, 0); g.add(lens);
    const crank = new THREE.Group(); crank.position.set(0.18, 0, 0.12); const arm = box(0.14, 0.02, 0.02, accent); arm.position.x = 0.07; crank.add(arm); g.add(crank);
    props.crank = { g, anim: (o) => { crank.rotation.z = o.crank ?? (o.t || 0) * 8; } };
  }
  { // megaphone
    const g = new THREE.Group(); const cone = cyl(0.2, 0.06, 0.4, accent); cone.rotation.z = -Math.PI / 2; g.add(cone); const h = cyl(0.035, 0.035, 0.16, propMat); h.position.set(-0.05, -0.12, 0); g.add(h);
    props.megaphone = { g, anim: () => {} };
  }
  { // viewfinder (director's frame)
    const g = new THREE.Group(); const t = 0.03, w = 0.34, h = 0.2; [[0, h / 2, w, t], [0, -h / 2, w, t], [-w / 2, 0, t, h], [w / 2, 0, t, h]].forEach(([x, y, a, b]) => { const m = box(a, b, 0.04, accent); m.position.set(x, y, 0); g.add(m); });
    const lens = cyl(0.05, 0.06, 0.12, propMat); lens.rotation.x = Math.PI / 2; lens.position.set(0.1, -0.16, 0); g.add(lens);
    props.viewfinder = { g, anim: () => {} };
  }
  { // clapperboard
    const g = new THREE.Group(); const slab = box(0.34, 0.22, 0.03, propMat); g.add(slab);
    const arm = new THREE.Group(); arm.position.set(-0.17, 0.11, 0.0); const stripe = box(0.34, 0.05, 0.035, accent); stripe.position.set(0.17, 0.03, 0); arm.add(stripe); g.add(arm);
    props.clapper = { g, anim: (o) => { arm.rotation.z = (1 - (o.clap ?? 1)) * 0.5; } };
  }
  { // glowing neural slate
    const g = new THREE.Group(); const frame = box(0.3, 0.4, 0.025, propMat); g.add(frame);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.36), new THREE.MeshBasicMaterial({ color: '#6B5BFF', toneMapped: false })); screen.position.z = 0.014; g.add(screen);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.008, 8, 32), new THREE.MeshBasicMaterial({ color: '#FFF3D6', toneMapped: false })); ring.position.z = 0.02; g.add(ring);
    props.slate = { g, anim: (o) => { screen.material.color.setHSL(0.68 + 0.04 * Math.sin((o.t || 0) * 2), 0.8, 0.45 + 0.25 * (o.glow ?? 1)); ring.rotation.z = (o.t || 0) * 0.6; } };
  }
  Object.values(props).forEach((p) => { p.g.visible = false; p.g.traverse((m) => { if (m.isMesh) m.castShadow = true; }); propRoot.add(p.g); });

  // ---------- public ----------
  const api = {
    root, body, materials: mats, eyesState: eyeState, parts: { blades, face, E },
    pose({ squash = 0, yaw = 0.5, roll = 0, bob = 0 } = {}) {
      const sy = 1 + squash, sx = 1 / Math.sqrt(Math.max(0.2, sy));
      body.scale.set(sx, sy, sx); body.rotation.set(0, yaw, roll); body.position.y = bob;
      return api;
    },
    eyes(o = {}) { Object.assign(eyeState, o); applyEyes(); return api; },
    expression(name = 'neutral', amount = 1) {
      Object.assign(eyeState, { open: 1, squint: 0, happy: 0, determined: 0, surprised: 0, sleepy: 0 });
      const p = EXPR[name] || {}; for (const k in p) eyeState[k] = k === 'open' ? 1 - amount : amount * p[k];
      applyEyes(); return api;
    },
    setProp(kind, o = {}) {
      for (const [k, p] of Object.entries(props)) p.g.visible = k === kind;
      curProp = kind ? props[kind] : null;
      if (curProp) { propRoot.scale.setScalar(o.scale ?? 1); propRoot.position.y = -R * 0.1 + Math.sin((o.t || 0) * 2.2) * 0.025; propRoot.rotation.y = -0.3; curProp.anim(o); }
      return api;
    },
    blinkAt(T) { // seeded natural blink: ~every 2.4 s, 0.14 s long
      const per = 2.4, ph = (T.t + 0.9) % per; const x = ph / 0.14; const c = x < 1 ? Math.sin(x * Math.PI) : 0;
      return c;
    },
    setStyle(st, { hue = 0.55, alpha = 0.55 } = {}) {
      const holo = st === 'hologram';
      for (const m of [mats.blade, mats.bladeAlt, mats.face, mats.body]) { m.transparent = holo; m.opacity = holo ? alpha : 1; if (holo) { m.emissive = new THREE.Color().setHSL(hue, 1, 0.5); m.emissiveIntensity = 0.9; } else m.emissiveIntensity = m === mats.face ? 0.08 : 0; }
      return api;
    },
    faceWorldPos(v) { return root.localToWorld(v.set(0, 0, faceZ)); },
  };
  api.setStyle(style); api.pose(); applyEyes();
  return api;
}
export { R as AMRITA_R };
