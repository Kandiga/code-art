// =============================================================================
// stage3d.js — the shared cinematic SOUNDSTAGE set (v0). Meters, +Y up, camera looks toward -Z.
//   createStage(THREE, env, opts) -> { group, floor, cyc, chair, lights:{key,fill,rim,...}, setHaze(), ... }
// Dark curved cyc, glossy black floor with a soft reflection feel, truss silhouettes, spot pools.
// v0: minimal but valid; the stage author upgrades it (volumetric beams live in fx3d.js).
// =============================================================================
export function createStage(THREE, env, { size = 40 } = {}) {
  const group = new THREE.Group(); group.name = 'stage';
  const floorMat = new THREE.MeshPhysicalMaterial({ color: '#15141a', roughness: 0.28, metalness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.35 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(size, size), floorMat); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; group.add(floor);
  // curved cyclorama (back wall that sweeps into the floor)
  const prof = []; const rr = 4, wallZ = -9, hgt = 12;
  for (let i = 0; i <= 12; i++) { const a = (i / 12) * (Math.PI / 2); prof.push(new THREE.Vector2(wallZ + rr - Math.cos(a) * rr + 0 * i, Math.sin(a) * rr)); }
  const cycGeo = new THREE.PlaneGeometry(size, hgt, 1, 1); const cycMat = new THREE.MeshStandardMaterial({ color: '#1c1b24', roughness: 0.95 });
  const cyc = new THREE.Mesh(cycGeo, cycMat); cyc.position.set(0, hgt / 2, wallZ); cyc.receiveShadow = true; group.add(cyc);
  // truss bar overhead
  const trussMat = new THREE.MeshStandardMaterial({ color: '#0b0a0d', roughness: 0.6, metalness: 0.7 });
  for (const z of [-3, 0, 3]) { const bar = new THREE.Mesh(new THREE.BoxGeometry(size * 0.5, 0.12, 0.12), trussMat); bar.position.set(0, 7.2, z); group.add(bar); }
  // director's chair
  const chair = new THREE.Group(); chair.name = 'chair';
  const wood = new THREE.MeshStandardMaterial({ color: '#2b2118', roughness: 0.6 }), canvasM = new THREE.MeshStandardMaterial({ color: '#d8c9a8', roughness: 0.9 });
  const leg = (x, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.62, 0.05), wood); m.position.set(x, 0.31, z); m.castShadow = true; chair.add(m); };
  leg(-0.28, -0.24); leg(0.28, -0.24); leg(-0.28, 0.24); leg(0.28, 0.24);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.04, 0.5), canvasM); seat.position.y = 0.62; seat.castShadow = true; chair.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.3, 0.03), canvasM); back.position.set(0, 1.0, -0.26); back.castShadow = true; chair.add(back);
  for (const x of [-0.3, 0.3]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.5), wood); arm.position.set(x, 0.86, 0); chair.add(arm); const post = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.26, 0.04), wood); post.position.set(x, 0.74, 0.2); chair.add(post); }
  group.add(chair);
  // lights
  const lights = {};
  lights.key = new THREE.SpotLight('#ffe2b0', 220, 40, 0.5, 0.6, 2); lights.key.position.set(3, 8, 4); lights.key.castShadow = true; lights.key.shadow.mapSize.set(1024, 1024); lights.key.shadow.bias = -0.0004; lights.key.target.position.set(0, 0.5, 0);
  lights.fill = new THREE.PointLight('#7aa8ff', 25, 30, 2); lights.fill.position.set(-5, 3, 4);
  lights.rim = new THREE.SpotLight('#9fd4ff', 180, 40, 0.6, 0.7, 2); lights.rim.position.set(-3, 5, -5); lights.rim.target.position.set(0, 0.8, 0);
  lights.amb = new THREE.AmbientLight('#2a2f4a', 0.5);
  Object.values(lights).forEach((l) => { group.add(l); if (l.target) group.add(l.target); });
  return { group, floor, cyc, chair, lights, floorMat, cycMat };
}
