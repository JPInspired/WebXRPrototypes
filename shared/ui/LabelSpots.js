import * as THREE from 'three';

// Spots to stick labels on, for "label it" activities: one dashed outline beside the model for each part, with a
// line from it to a point on that part (the point that faces you). A label dropped on a spot counts for the part
// its line points to, so even tiny or tucked-away parts are easy to label. The lines show through the model, and
// follow it when it is turned.
//
//   const spots = new LabelSpots(app, parentGroup, { w: 0.14, h: 0.035 });
//   spots.build([{ id, objects: [mesh/group…] }], modelBox);   // modelBox: the model's bounds, in parentGroup space
//   spots.at(worldPoint) → id | null        spots.place(id) → where a label for it sits (parentGroup space)
//   spots.done(id)      spots.held = the label being dragged (or null), so its spot lights up
// They keep themselves up to date each frame while they are shown.

const COLOR = 0xfff1a8;

export class LabelSpots {
  constructor(app, parent, { w = 0.14, h = 0.035, gap = 0.012, reach = null } = {}) {
    this.app = app;
    this.parent = parent;
    this.w = w;
    this.h = h;
    this.gap = gap;
    this.reach = reach ?? Math.max(h * 1.6, 0.05); // how close a dropped label must be to a spot
    this.group = new THREE.Group();
    parent.add(this.group);
    this.spots = [];
    this.held = null;
    this.last = 0;
    this.lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthTest: false });
    this.dotMat = new THREE.MeshBasicMaterial({ color: COLOR, depthTest: false });
  }

  clear() {
    for (const s of this.spots) s.dispose();
    this.spots = [];
  }

  /** The point on a part that faces the viewer most directly, as [object, point in that object's space]. */
  static facingPoint(objects, eye) {
    const pts = [];
    const v = new THREE.Vector3();
    const m = new THREE.Matrix4();
    for (const root of objects) {
      root.updateWorldMatrix(true, true);
      root.traverse((o) => {
        if (!o.isMesh || !o.visible) return;
        if (o.isInstancedMesh) {
          for (let i = 0; i < o.count; i++) {
            o.getMatrixAt(i, m);
            pts.push([o, v.setFromMatrixPosition(m).clone()]);
          }
          return;
        }
        const pos = o.geometry.getAttribute('position');
        const step = Math.max(1, Math.floor(pos.count / 1500));
        for (let i = 0; i < pos.count; i += step) pts.push([o, v.fromBufferAttribute(pos, i).clone()]);
      });
    }
    if (!pts.length) return null;
    const world = pts.map(([o, p]) => o.localToWorld(p.clone()));
    const centre = world.reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(1 / world.length);
    // nearest to you, but not off at an extreme edge of the part
    let best = 0, score = Infinity;
    world.forEach((p, i) => {
      const s = p.distanceTo(eye) + 0.6 * p.distanceTo(centre);
      if (s < score) { score = s; best = i; }
    });
    return pts[best];
  }

  /**
   * Lay out one spot per part: in two columns either side of the model (each part on the side it is on), at the
   * height of its point, spread so they do not overlap.
   */
  build(parts, box) {
    this.clear();
    const eye = this.app.viewCamera().getWorldPosition(new THREE.Vector3());
    const items = [];
    for (const { id, objects } of parts) {
      const fp = LabelSpots.facingPoint(objects, eye);
      if (!fp) continue;
      const local = this.parent.worldToLocal(fp[0].localToWorld(fp[1].clone()));
      items.push({ id, obj: fp[0], at: fp[1], local });
    }
    const cx = (box.min.x + box.max.x) / 2;
    const byX = [...items].sort((a, b) => a.local.x - b.local.x);
    const half = Math.ceil(byX.length / 2);
    const cols = [[-1, byX.slice(0, half)], [1, byX.slice(half)]];
    const step = this.h + this.gap;
    for (const [side, list] of cols) {
      list.sort((a, b) => b.local.y - a.local.y);
      // spread them round their points' heights, centred on the model
      const ys = [];
      let y = Infinity;
      for (const it of list) {
        y = Math.min(it.local.y, y - step);
        ys.push(y);
      }
      const shift = Math.max(0, (box.min.y + this.h) - ys[ys.length - 1]); // keep them above the bottom of the model
      // clear of the model (spots sit in front of it, so leave room for perspective)
      const x = side < 0 ? Math.min(box.min.x, cx - 0.2) - 0.05 - this.w / 2 : Math.max(box.max.x, cx + 0.2) + 0.05 + this.w / 2;
      list.forEach((it, i) => this.spots.push(this.makeSpot(it, new THREE.Vector3(x, ys[i] + shift, box.max.z + 0.02), side)));
    }
  }

  makeSpot(it, pos, side) {
    const g = new THREE.Group();
    g.position.copy(pos);
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(this.w, this.h)),
      new THREE.LineDashedMaterial({ color: COLOR, dashSize: 0.007, gapSize: 0.005, transparent: true, opacity: 0.9 }),
    );
    outline.computeLineDistances();
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(this.w, this.h), new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide }));
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0045, 10, 8), this.dotMat);
    dot.position.x = -side * this.w / 2;
    dot.renderOrder = 7;
    g.add(outline, fill, dot);
    this.group.add(g);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), this.lineMat);
    line.renderOrder = 7;
    line.frustumCulled = false;
    line.onBeforeRender = () => {
      const now = performance.now();
      if (now - this.last < 4) return; // once a frame (a headset draws each eye)
      this.last = now;
      this.update(this.held ? this.held.getWorldPosition(new THREE.Vector3()) : null);
    };
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.004, 10, 8), this.dotMat);
    tip.renderOrder = 7;
    this.group.add(line, tip);
    const start = pos.clone().add(new THREE.Vector3(-side * this.w / 2, 0, 0));
    return {
      id: it.id, g, fill, line, tip, start, obj: it.obj, at: it.at, done: false,
      dispose: () => {
        this.group.remove(g, line, tip);
        outline.geometry.dispose();
        fill.geometry.dispose();
        line.geometry.dispose();
      },
    };
  }

  /** Distance (m) between world points: in 3D in a headset; across the screen (at b's depth) on a screen. */
  dist(a, b) {
    if (this.app.presenting) return a.distanceTo(b);
    const cam = this.app.camera;
    const pa = a.clone().project(cam);
    const pb = b.clone().project(cam);
    const h = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * cam.position.distanceTo(b);
    return (Math.hypot((pa.x - pb.x) * cam.aspect, pa.y - pb.y) * h) / 2;
  }

  /** The id of the open spot a world point is on, or null. */
  at(world) {
    let best = null;
    for (const s of this.spots) {
      if (s.done) continue;
      const d = this.dist(world, s.g.getWorldPosition(new THREE.Vector3()));
      if (d < this.reach && (!best || d < best.d)) best = { s, d };
    }
    return best?.s.id ?? null;
  }

  /** Where a label for this part sits once it is right (parent space). */
  place(id) {
    return this.spots.find((s) => s.id === id)?.g.position.clone() ?? null;
  }

  done(id) {
    const s = this.spots.find((x) => x.id === id);
    if (!s) return;
    s.done = true;
    s.g.children.forEach((c) => { if (c !== s.g.children[2]) c.visible = false; }); // keep just the dot
  }

  /** Lines follow the model; the spot under a held label lights up. */
  update(held) {
    const hover = held ? this.at(held) : null;
    const w = new THREE.Vector3();
    for (const s of this.spots) {
      s.obj.localToWorld(w.copy(s.at));
      const end = this.group.worldToLocal(w);
      const lp = s.line.geometry.getAttribute('position');
      lp.setXYZ(0, s.start.x, s.start.y, s.start.z);
      lp.setXYZ(1, end.x, end.y, end.z);
      lp.needsUpdate = true;
      s.tip.position.copy(end);
      if (!s.done) {
        const lit = s.id === hover;
        s.fill.material.opacity = lit ? 0.35 : 0.08 + 0.04 * Math.sin(performance.now() / 330);
        s.g.scale.setScalar(lit ? 1.08 : 1);
      }
    }
  }
}
