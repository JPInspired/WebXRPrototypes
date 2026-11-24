import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/**
 * Soft studio reflections for a lesson's scene, so metal, glass and glossy surfaces look real (a bright room
 * reflected in them). Made once in code, nothing downloaded.
 * Plain (non-metal) surfaces that have not chosen their own strength get a gentler reflection, so light colours
 * (paper, wood, sand) do not wash out; this is checked every couple of seconds, so parts added later are included.
 * Materials that set envMapIntensity themselves keep it.
 */
export function studioReflections(app) {
  const pmrem = new THREE.PMREMGenerator(app.renderer);
  app.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  const seen = new WeakSet();
  const tone = () => {
    app.scene.traverse((o) => {
      const list = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of list) {
        if (seen.has(m) || !m.isMeshStandardMaterial) continue;
        seen.add(m);
        if (m.envMapIntensity === 1 && m.metalness < 0.3) m.envMapIntensity = 0.4;
      }
    });
  };
  tone();
  setTimeout(tone, 0); // right after the lesson has built its scene
  setInterval(tone, 2000);
}
