import * as THREE from 'three';

// Soft shadows under the things on a bench, so they sit on it instead of floating just above it.
// Each object near the bench gets a faint blurred blob on the bench top, sized to its footprint. The blob fades
// as the object is lifted, and follows it when it is moved. Cheap enough for a headset: no extra rendering,
// just a few see-through squares updated a few times a second.
//
//   addContactShadows(app, group, benchY)   group: the lesson's bench group; benchY: the bench top (group space)
//   options: { skip(obj) → true to leave an object out, maxSize: biggest footprint that gets a shadow (m) }

let blobTex = null;
function blobTexture() {
  if (blobTex) return blobTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(0,0,0,1)');
  r.addColorStop(0.5, 'rgba(0,0,0,0.6)');
  r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  blobTex = new THREE.CanvasTexture(c);
  return blobTex;
}

const LIFT = 0.18; // m above the bench where the shadow has faded out

/** Is this object something that should cast a shadow (a solid thing, not a label, panel or effect)? */
function solid(o) {
  let ok = false;
  o.traverse((m) => {
    if (ok || !m.isMesh || !m.visible) return;
    const list = Array.isArray(m.material) ? m.material : [m.material];
    if (list.some((x) => x && !x.isMeshBasicMaterial && !x.isSpriteMaterial && (!x.transparent || x.opacity > 0.2))) ok = true;
  });
  return ok;
}

export function addContactShadows(app, group, benchY, { skip = () => false, maxSize = 0.45, strength = 0.8 } = {}) {
  const layer = new THREE.Group();
  layer.name = 'contact-shadows';
  group.add(layer);
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const blobs = new Map(); // object → blob mesh
  const box = new THREE.Box3();
  const inv = new THREE.Matrix4();
  const min = new THREE.Vector3();
  const max = new THREE.Vector3();

  const update = () => {
    group.updateWorldMatrix(true, true);
    inv.copy(group.matrixWorld).invert();
    const seen = new Set();
    // the things on the bench: each child of the group, or, for a group too big to be one thing (a whole kit
    // of equipment), its own children in turn
    const things = [];
    const visit = (o, depth) => {
      if (o === layer || !o.visible || skip(o) || !solid(o)) return;
      box.setFromObject(o);
      if (box.isEmpty()) return;
      min.copy(box.min).applyMatrix4(inv);
      max.copy(box.max).applyMatrix4(inv);
      const w = Math.abs(max.x - min.x), d = Math.abs(max.z - min.z);
      if ((w > maxSize || d > maxSize) && depth < 3) {
        for (const c of o.children) visit(c, depth + 1);
        return;
      }
      things.push([o, min.clone(), max.clone()]);
    };
    for (const o of group.children) visit(o, 0);
    for (const [o, lo, hi] of things) {
      min.copy(lo);
      max.copy(hi);
      const w = Math.abs(max.x - min.x), d = Math.abs(max.z - min.z);
      const lowest = Math.min(min.y, max.y);
      if (w > maxSize || d > maxSize || w < 0.004 || d < 0.004) continue; // the bench itself, or specks
      const gap = lowest - benchY;
      if (gap < -0.02 || gap > LIFT) continue;
      seen.add(o);
      let b = blobs.get(o);
      if (!b) {
        b = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, toneMapped: false }));
        b.renderOrder = -1;
        b.raycast = () => {};
        layer.add(b);
        blobs.set(o, b);
      }
      const k = Math.max(0, 1 - Math.max(0, gap) / LIFT);
      b.visible = true;
      b.position.set((min.x + max.x) / 2, benchY + 0.0008, (min.z + max.z) / 2);
      // small things get a wider, darker halo; big ones (a trough, a hot plate) a lighter, tighter one
      const size = Math.max(w, d);
      const spread = 1.2 + 0.45 * Math.min(1, 0.08 / size);
      b.scale.set(w * spread * (1 + (1 - k) * 0.6), 1, d * spread * (1 + (1 - k) * 0.6)); // spreads as it lifts
      b.material.opacity = strength * k * k * Math.min(1, 0.1 / size + 0.25);
    }
    for (const [o, b] of blobs) if (!seen.has(o)) b.visible = false;
  };

  // Updated a few times a second (enough, and cheap), driven by an empty mesh: it draws nothing, but three.js
  // calls its onBeforeRender every frame while the bench is shown.
  const driver = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  driver.frustumCulled = false;
  let last = 0;
  driver.onBeforeRender = () => {
    const now = performance.now();
    if (now - last < 150) return;
    last = now;
    update();
  };
  layer.add(driver);
  update();
  return { layer, update };
}
