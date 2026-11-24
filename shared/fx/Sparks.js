import * as THREE from 'three';

// A small burst of soft sparks rising from a panel when a task is finished (see LessonApp.celebrate).
// One set of points reused for every burst: cheap enough for any headset.

const N = 48;
const LIFE = 1.4; // s

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const COLORS = [0x7ee2a8, 0xffe08a, 0x9aa8ff, 0xffffff];

export class Sparks {
  constructor(scene) {
    this.pos = new Float32Array(N * 3);
    this.col = new Float32Array(N * 3);
    this.vel = new Float32Array(N * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.016, map: dotTexture(), vertexColors: true, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false,
    }));
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.points.raycast = () => {};
    this.points.renderOrder = 6;
    scene.add(this.points);
    this.age = LIFE;
  }

  /** Burst from the top edge of a panel mesh. */
  burst(mesh) {
    mesh.updateWorldMatrix(true, false);
    const p = new THREE.Vector3();
    const w = mesh.geometry.parameters?.width ?? 0.6;
    const h = (mesh.geometry.parameters?.height ?? 0.2) * mesh.scale.y;
    const ws = mesh.getWorldScale(new THREE.Vector3()).x;
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      // along the top edge, in the panel's own frame
      p.set((Math.random() - 0.5) * w, h / 2 / Math.max(mesh.scale.y, 1e-3), 0.005).applyMatrix4(mesh.matrixWorld);
      this.pos.set([p.x, p.y, p.z], i * 3);
      const a = Math.random() * Math.PI * 2;
      const sp = (0.04 + Math.random() * 0.1) * ws;
      this.vel.set([Math.cos(a) * sp * 0.6, (0.12 + Math.random() * 0.22) * ws, Math.sin(a) * sp * 0.6], i * 3);
      c.set(COLORS[i % COLORS.length]);
      this.col.set([c.r, c.g, c.b], i * 3);
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    this.points.material.size = 0.016 * ws;
    this.age = 0;
    this.points.visible = true;
  }

  update(dt) {
    if (this.age >= LIFE) return;
    this.age += dt;
    const k = this.age / LIFE;
    for (let i = 0; i < N * 3; i += 3) {
      this.pos[i] += this.vel[i] * dt;
      this.pos[i + 1] += this.vel[i + 1] * dt;
      this.pos[i + 2] += this.vel[i + 2] * dt;
      this.vel[i + 1] -= 0.18 * dt; // slows as it rises
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.material.opacity = k < 0.1 ? k / 0.1 : (1 - k) ** 1.4;
    if (this.age >= LIFE) this.points.visible = false;
  }
}
