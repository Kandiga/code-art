import { createStage } from '../stage3d.js';
import { createAmrita } from '../amrita3d.js';
const lensFov = (mm, ratio = 2.39, gate = 36) => (2 * Math.atan(Math.tan(Math.atan(gate / (2 * mm))) / ratio) * 180) / Math.PI;
export default {
  id: 'job_camera', kind: '3d', ratio: 2.39,
  setup({ THREE, S, renderer }) {
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#040306');
    const stage = createStage(THREE, { S, renderer }, { look: 'noir' }); scene.add(stage.group);
    const camera = new THREE.PerspectiveCamera(lensFov(24), 2.39, 0.1, 80);
    const A = createAmrita(THREE); A.root.position.set(1, 1, 0); scene.add(A.root);
    return { scene, camera, stage, A, THREE };
  },
  update(st, T, S) {
    const { camera, A, stage } = st;
    camera.position.set(0.2, 1.4, 5.5); camera.lookAt(0.8, 1.0, 0);
    A.idle(T, { yaw: 0.4 }); A.setProp('viewfinder', { t: T.t });
    stage.update(T);
    return { dof: { focus: 5.5, strength: 0.7, maxPx: 12 }, bloom: { strength: 0.4 } };
  },
};
