// v0 pipeline-test scene (the SCRIPT author replaces this file).
import { createStage } from '../stage3d.js';
import { createAmrita } from '../amrita3d.js';

export default {
  id: 'job_script', kind: '3d', ratio: 2.39,
  setup({ THREE, S }) {
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#07060a'); scene.fog = new THREE.FogExp2('#07060a', 0.035);
    const stage = createStage(THREE, { S }); scene.add(stage.group);
    const A = createAmrita(THREE); A.root.position.set(0, 0.7, 0); scene.add(A.root);
    const camera = new THREE.PerspectiveCamera(32, 2.39, 0.1, 80);
    return { scene, camera, stage, A, THREE };
  },
  update(st, T) {
    const { camera, A, THREE } = st, lt = T.lt;
    A.pose({ squash: 0.08 * Math.sin(lt * 6), yaw: 0.5, bob: Math.sin(lt * 3) * 0.03 }).eyes({ open: 1 - A.blinkAt(T) });
    A.setProp('slate', { t: T.t });
    camera.position.set(1.5 - lt * 0.3, 1.2, 5.2 - lt * 0.5); camera.lookAt(0, 0.9, 0);
    st.stage.lights.key.target.position.set(0, 0.8, 0);
    return { dof: { focus: camera.position.distanceTo(A.root.position), strength: 0.8, maxPx: 10 }, bloom: { strength: 0.4 } };
  },
};
