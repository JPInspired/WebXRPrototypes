import * as THREE from 'three';

// A soft glow around whatever a hand or pointer is on (and whatever is held), so students can see what they are
// about to grab. It is a slightly larger copy of the object's own shape, drawn faintly and additively: brighter
// at the outline, a gentle tint across the middle. It fades in and out, and costs one extra draw per glowing part.
//
// Some grabbable things are not one plain shape: an invisible hit zone around a model, or many small copies of
// one shape (instanced). Those glow through the visible shapes that make them up: their own children, or the
// shapes beside them in the same group.

const COLOR = 0xbfe4ff;
const MAX_RADIUS = 0.6; // m: bigger things (a whole bench) do not glow
const MAX_PARTS = 8;

export class HoverGlow {
  constructor(scene) {
    this.scene = scene;
    this.items = new Map(); // object → { parts: [{ src, mesh }], a }
    this.t = 0;
    this.mat = null;
  }

  /** A plain, visible shape that can be copied. */
  plain(o) {
    if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || !o.geometry || !o.visible) return false;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m || m.visible === false || (m.transparent && m.opacity < 0.05) || m.colorWrite === false) return false;
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    return true;
  }

  /** The visible shapes that show this object. */
  sources(o) {
    if (this.plain(o)) return [o];
    const found = [];
    o.traverse((c) => { if (c !== o && found.length < MAX_PARTS && this.plain(c)) found.push(c); });
    if (!found.length && o.parent) {
      for (const c of o.parent.children) if (c !== o && found.length < MAX_PARTS && this.plain(c)) found.push(c);
    }
    return found;
  }

  make(object) {
    const parts = this.sources(object).map((src) => {
      const mesh = new THREE.Mesh(src.geometry, new THREE.MeshBasicMaterial({
        color: COLOR, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      }));
      mesh.matrixAutoUpdate = false;
      mesh.raycast = () => {};
      mesh.renderOrder = 5;
      mesh.visible = false;
      this.scene.add(mesh);
      return { src, mesh };
    });
    return { parts, a: 0 };
  }

  /** on: the objects that should glow now. held: the grabs in progress (they glow a little less). */
  update(on, dt, held) {
    this.t += dt;
    const heldSet = new Set([...held.values()].map((g) => g.object));
    for (const o of on) if (!this.items.has(o)) this.items.set(o, this.make(o));
    const c = new THREE.Vector3();
    const s = new THREE.Vector3();
    const t1 = new THREE.Matrix4();
    const sc = new THREE.Matrix4();
    const t2 = new THREE.Matrix4();
    for (const [o, it] of this.items) {
      const want = on.has(o) && o.visible && o.parent ? (heldSet.has(o) ? 0.55 : 1) : 0;
      it.a += (want - it.a) * Math.min(1, dt * 14);
      if (it.a < 0.02 && want === 0) {
        for (const p of it.parts) {
          p.mesh.removeFromParent();
          p.mesh.material.dispose();
        }
        this.items.delete(o);
        continue;
      }
      // several overlapping shapes add up: each is fainter, so the whole glows about as much as one shape
      const opacity = it.a * (0.11 + 0.04 * Math.sin(this.t * 5)) * (it.parts.length > 1 ? 0.55 : 1);
      for (const { src, mesh } of it.parts) {
        src.updateWorldMatrix(true, false);
        // the same shape, a few millimetres bigger, around the shape's own centre
        src.getWorldScale(s);
        const bs = src.geometry.boundingSphere;
        const r = bs.radius * Math.max(s.x, s.y, s.z);
        if (r > MAX_RADIUS || !src.visible) { mesh.visible = false; continue; }
        const k = 1 + THREE.MathUtils.clamp(0.004 / Math.max(r, 1e-4), 0.03, 0.18);
        c.copy(bs.center);
        mesh.matrix.copy(src.matrixWorld)
          .multiply(t1.makeTranslation(c.x, c.y, c.z))
          .multiply(sc.makeScale(k, k, k))
          .multiply(t2.makeTranslation(-c.x, -c.y, -c.z));
        mesh.matrixWorld.copy(mesh.matrix);
        mesh.visible = true;
        mesh.material.opacity = opacity;
      }
    }
  }
}
