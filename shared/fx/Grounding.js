import * as THREE from 'three';
import { sound } from '../util/sound.js';

// Making the lab sit in the real room (mixed reality only):
//  • A soft shadow under the lab on the real surface it stands on (a desk, a bench or the floor), so it rests
//    on it instead of hovering. Only while the lab really is on a surface: put there with Place on surface, or
//    onto a desk by the real room (RealRoom.js). When it floats in front of you, there is no shadow.
//  • Arriving: when the lab appears or lands, it grows into place over a moment, and a ring of light spreads
//    out across the surface it has landed on.
// Part of "Real room" in ⚙ Settings (off there: no shadow and no arrival, as before).
// One switch turns it off everywhere: GROUNDING.enabled = false. Hintze Hall and Reef Dive are left out.

export const GROUNDING = { enabled: true };
const SKIP = ['hintze-hall', 'reef-dive'];
const SURFACE_Y = -0.3; // the lab's bottom, in its own space (it is placed 0.3 m above the surface it is on)
const ARRIVE_S = 0.55; // how long arriving takes
const RING_S = 0.9; // how long the ring takes to spread and fade

export function makeGrounding(app) {
  const lesson = (location.pathname.match(/lessons\/([^/]+)/) || [])[1];
  return GROUNDING.enabled && !SKIP.includes(lesson) ? new Grounding(app) : null;
}

/** A soft rounded-rectangle shadow: dark in the middle, fading out towards its edges. */
function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.filter = 'blur(18px)';
  g.fillStyle = 'rgba(0,0,0,1)';
  g.beginPath();
  g.roundRect(44, 44, 168, 168, 44);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function ringTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(128, 128, 90, 128, 128, 126);
  r.addColorStop(0, 'rgba(160,175,255,0)');
  r.addColorStop(0.7, 'rgba(190,200,255,0.9)');
  r.addColorStop(1, 'rgba(160,175,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class Grounding {
  constructor(app) {
    this.app = app;
    this.onSurface = false;
    this.arriveT = 1; // 0 → 1 while arriving
    this.ringT = 1;
    this.size = null; // the lab's footprint (x, z), measured the first time it is needed
    const flat = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.shadow = new THREE.Mesh(flat, new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
    this.shadow.name = 'real-shadow';
    this.shadow.renderOrder = -1;
    this.shadow.raycast = () => {};
    this.shadow.visible = false;
    this.ring = new THREE.Mesh(flat, new THREE.MeshBasicMaterial({ map: ringTexture(), transparent: true, opacity: 0, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
    this.ring.name = 'arrive-ring';
    this.ring.raycast = () => {};
    this.ring.visible = false;
    this.shadow.position.y = SURFACE_Y + 0.002;
    this.ring.position.y = SURFACE_Y + 0.004;
    app.lab.add(this.shadow, this.ring);
  }

  /** Mixed reality with the real room switched on. */
  get active() {
    return !!this.app.presenting && !!this.app.isAR && this.app.realRoom?.on !== false;
  }

  /** How big the lab is across, from above (its panels left out), in its own space. */
  footprint() {
    if (this.size) return this.size;
    const lab = this.app.lab;
    lab.updateMatrixWorld(true);
    const inv = lab.matrixWorld.clone().invert();
    const box = new THREE.Box3();
    const b = new THREE.Box3();
    const skip = (o) => o === this.shadow || o === this.ring || o.userData?.panel || o.isSprite || o.name === 'contact-shadows';
    const visit = (o) => {
      if (!o.visible || skip(o)) return;
      if (o.isMesh && o.geometry) {
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        b.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
        if (b.min.y < SURFACE_Y + 0.25) box.union(b); // only what stands near the surface
      }
      for (const c of o.children) visit(c);
    };
    for (const c of lab.children) visit(c);
    const w = box.isEmpty() ? 0.9 : box.max.x - box.min.x;
    const d = box.isEmpty() ? 0.6 : box.max.z - box.min.z;
    const cx = box.isEmpty() ? 0 : (box.max.x + box.min.x) / 2;
    const cz = box.isEmpty() ? 0 : (box.max.z + box.min.z) / 2;
    this.size = { w: THREE.MathUtils.clamp(w, 0.3, 1.4), d: THREE.MathUtils.clamp(d, 0.25, 1.0), cx, cz };
    return this.size;
  }

  /** The lab has been put on a real surface (Place on surface, or onto a desk). */
  landed() {
    const was = this.onSurface;
    this.onSurface = true;
    if (!was && this.active) {
      this.arrive();
      this.ringT = 0;
      sound.land();
    }
  }

  /** The lab now floats (placed in front of you, or picked up). */
  lifted() {
    this.onSurface = false;
  }

  /** Play the arriving animation (the lab grows into place). */
  arrive() {
    if (!this.active) return;
    this.arriveT = 0;
    sound.arrive();
  }

  /** A new headset session: nothing is on a surface yet. */
  sessionStart() {
    this.onSurface = false;
    this.arriveT = 1;
    this.ringT = 1;
  }

  update(dt) {
    const lab = this.app.lab;
    const on = this.active;
    // the lab grows into place: a little overshoot, then settles
    if (this.arriveT < 1) {
      this.arriveT = Math.min(1, this.arriveT + dt / ARRIVE_S);
      const t = this.arriveT;
      const c = 1.6;
      const k = 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; // ease out, with a slight overshoot
      lab.scale.setScalar(on ? 0.85 + 0.15 * k : 1);
    } else if (lab.scale.x !== 1) lab.scale.setScalar(1);
    // the shadow on the surface (fades in and out)
    const placing = !!this.app.state.placing && !!this.app.reticle?.visible;
    const want = on && (this.onSurface || placing) && !this.app.interaction?.labGrabber ? 0.62 : 0;
    const m = this.shadow.material;
    m.opacity += (want - m.opacity) * Math.min(1, dt * 8);
    this.shadow.visible = m.opacity > 0.01;
    if (this.shadow.visible) {
      const f = this.footprint();
      this.shadow.position.x = f.cx;
      this.shadow.position.z = f.cz;
      this.shadow.scale.set(f.w * 1.55, 1, f.d * 1.7);
    }
    // the ring of light spreading out from under the lab
    if (this.ringT < 1 && on) {
      this.ringT = Math.min(1, this.ringT + dt / RING_S);
      const f = this.footprint();
      const s = Math.max(f.w, f.d) * (0.6 + 1.6 * (1 - (1 - this.ringT) ** 2));
      this.ring.scale.set(s, 1, s);
      this.ring.position.x = f.cx;
      this.ring.position.z = f.cz;
      this.ring.material.opacity = 0.8 * (1 - this.ringT);
      this.ring.visible = true;
    } else this.ring.visible = false;
  }
}
