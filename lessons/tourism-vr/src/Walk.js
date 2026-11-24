import * as THREE from 'three';

// Moving around the town, in the headset and on a screen (after Hintze Hall's Walker, without the scanned building:
// the ground is flat and the walls are the edges of the areas). In the headset we never move the scene: we move the
// user, by offsetting the WebXR reference space. x and z here are three.js's (north is −z).

const EYE = 1.6;
const MARGIN = 0.35; // how close you can get to a wall (m)
const FAR = 22; // the furthest teleport (m)
const yawOf = (x, z) => Math.atan2(-x, -z); // the turn about y that faces (x, z)

export class Walk {
  constructor(app, town) {
    this.app = app;
    this.town = town;
    this.origin = { x: 0, z: 0, yaw: 0 }; // headset: where the play area is in the town
    this.desk = { x: 0, z: 0, yaw: 0, pitch: -0.05 }; // screen: the walking camera
    this.baseRef = null;
    this.glide = null;
  }

  ok(x, z) {
    return this.town.inside(x, -z, MARGIN);
  }

  /** Walk from (x, z) by (dx, dz), sliding along walls. */
  step(x, z, dx, dz) {
    for (const [mx, mz] of [[dx, dz], [dx, 0], [0, dz]]) if ((mx || mz) && this.ok(x + mx, z + mz)) return [x + mx, z + mz];
    return [x, z];
  }

  /** Where a pointing ray meets ground you could teleport to (or null). */
  aim(from, dir) {
    if (dir.y > -0.03) return null;
    const t = -from.y / dir.y;
    const x = from.x + dir.x * t;
    const z = from.z + dir.z * t;
    if (Math.hypot(x - from.x, z - from.z) > FAR || !this.ok(x, z)) return null;
    return this.town.clear(from.x, -from.z, x, -z) ? new THREE.Vector3(x, 0, z) : null;
  }

  // ───────────── headset ─────────────

  startXR() {
    this.baseRef = this.app.renderer.xr.getReferenceSpace();
    this.apply();
  }

  stopXR() {
    this.baseRef = null;
  }

  matrix() {
    const o = this.origin;
    return new THREE.Matrix4().compose(new THREE.Vector3(o.x, 0, o.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.yaw), new THREE.Vector3(1, 1, 1));
  }

  apply() {
    if (!this.baseRef) return;
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    this.matrix().invert().decompose(p, q, new THREE.Vector3());
    this.app.renderer.xr.setReferenceSpace(this.baseRef.getOffsetReferenceSpace(new XRRigidTransform({ x: p.x, y: p.y, z: p.z }, { x: q.x, y: q.y, z: q.z, w: q.w })));
  }

  head() {
    return this.app.renderer.xr.getCamera().getWorldPosition(new THREE.Vector3());
  }

  facing() {
    const d = this.app.renderer.xr.getCamera().getWorldDirection(new THREE.Vector3());
    d.y = 0;
    return d.lengthSq() < 1e-6 ? new THREE.Vector3(0, 0, -1) : d.normalize();
  }

  moveXR(forward, strafe, dt) {
    if (Math.abs(forward) < 0.15 && Math.abs(strafe) < 0.15) return;
    const f = this.facing();
    const r = new THREE.Vector3(-f.z, 0, f.x);
    const d = f.multiplyScalar(forward * 2 * dt).addScaledVector(r, strafe * 2 * dt);
    const h = this.head();
    const [x, z] = this.step(h.x, h.z, d.x, d.z);
    this.origin.x += x - h.x;
    this.origin.z += z - h.z;
    this.apply();
  }

  turnXR(angle) {
    const h = this.head();
    const o = this.origin;
    const rel = new THREE.Vector3(o.x - h.x, 0, o.z - h.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    o.x = h.x + rel.x;
    o.z = h.z + rel.z;
    o.yaw += angle;
    this.apply();
  }

  teleportXR(x, z, look) {
    const o = this.origin;
    const local = this.head().applyMatrix4(this.matrix().invert());
    if (look) {
      const f = this.facing().applyAxisAngle(new THREE.Vector3(0, 1, 0), -o.yaw);
      o.yaw = yawOf(look[0] - x, look[1] - z) - yawOf(f.x, f.z);
    }
    const off = new THREE.Vector3(local.x, 0, local.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), o.yaw);
    o.x = x - off.x;
    o.z = z - off.z;
    this.apply();
  }

  // ───────────── screen ─────────────

  teleportDesk(x, z, look, smooth = true) {
    const d = this.desk;
    const to = { x, z, yaw: look ? yawOf(look[0] - x, look[1] - z) : d.yaw, pitch: look ? -0.04 : d.pitch };
    if (!smooth) {
      Object.assign(d, to);
      this.glide = null;
    } else this.glide = { from: { ...d }, to, t: 0 };
  }

  moveDesk(forward, strafe, dt) {
    if (this.glide) return;
    const d = this.desk;
    const s = 3 * dt;
    const fx = -Math.sin(d.yaw);
    const fz = -Math.cos(d.yaw);
    [d.x, d.z] = this.step(d.x, d.z, (fx * forward - fz * strafe) * s, (fz * forward + fx * strafe) * s);
  }

  update(dt, camera) {
    const g = this.glide;
    const d = this.desk;
    if (g) {
      g.t = Math.min(1, g.t + dt / 0.7);
      const k = g.t * g.t * (3 - 2 * g.t);
      for (const key of ['x', 'z', 'pitch']) d[key] = g.from[key] + (g.to[key] - g.from[key]) * k;
      d.yaw = g.from.yaw + Math.atan2(Math.sin(g.to.yaw - g.from.yaw), Math.cos(g.to.yaw - g.from.yaw)) * k;
      if (g.t >= 1) this.glide = null;
    }
    camera.position.set(d.x, EYE, d.z);
    camera.rotation.set(d.pitch, d.yaw, 0, 'YXZ');
  }
}
