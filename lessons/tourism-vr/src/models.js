import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { font, roundRect } from '../../../shared/ui/CanvasPanel.js';
import { paint, rng } from './Town.js';

// Stand-ins for the objects of the original lesson, all original and made in code at real size. Each is one merged
// mesh, standing on y = 0 and facing −z. They replace uploaded and library models that belong to other people.

const LAMBERT = new THREE.MeshLambertMaterial({ vertexColors: true });
const B = (w, h, d, x, y, z, c) => paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), c);
const C = (r0, r1, h, x, y, z, c, seg = 12) => paint(new THREE.CylinderGeometry(r1, r0, h, seg).translate(x, y, z), c);
const S = (r, x, y, z, c, sx = 1, sy = 1, sz = 1) => paint(new THREE.SphereGeometry(r, 12, 9).scale(sx, sy, sz).translate(x, y, z), c);
/** A limb from one point to another. */
function limb(a, b, r, c, r2 = r) {
  const A = new THREE.Vector3(...a);
  const D = new THREE.Vector3(...b).sub(A);
  const g = new THREE.CylinderGeometry(r2, r, D.length(), 8).translate(0, D.length() / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), D.clone().normalize()));
  return paint(g.translate(...a), c);
}
const mesh = (parts) => new THREE.Mesh(mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g))), LAMBERT);

// ───────────── people ─────────────

const SKIN = ['#f1c9a5', '#d9a77c', '#b07a52', '#7a4e33'];
const TOPS = ['#e4572e', '#17bebb', '#ffc914', '#2e86ab', '#f25f5c', '#70c1b3', '#f7f7f7', '#8e7dbe', '#3f7d58'];
const LEGS = ['#34495e', '#6b5b4b', '#c9b48a', '#2c3e50', '#7d8597'];
const HAIR = ['#2b1d14', '#5a3a22', '#a8763e', '#1b1b1f', '#8d8d8d'];
const pick = (r, a) => a[Math.floor(r() * a.length)];

/** The parts of one person (about 1.7 m). o: sit, arms ('down' | 'photo' | 'phone' | 'up'), hat, bag, camera, muscle */
function person(r, o = {}) {
  const skin = pick(r, SKIN);
  const top = o.top ?? pick(r, TOPS);
  const legs = pick(r, LEGS);
  const p = [];
  const hip = o.sit ? 0.5 : 0.88;
  const w = o.muscle ? 1.25 : 1;
  for (const s of [-1, 1]) {
    if (o.sit) {
      p.push(limb([s * 0.1, hip, 0], [s * 0.11, hip, -0.42], 0.085, legs, 0.07));
      p.push(limb([s * 0.11, hip, -0.42], [s * 0.11, 0.07, -0.44], 0.065, legs, 0.05));
      p.push(B(0.1, 0.08, 0.25, s * 0.11, 0.04, -0.5, '#3b2f2a'));
    } else {
      const step = (s * (o.stride ?? 0.06));
      p.push(limb([s * 0.1, hip, 0], [s * 0.11, 0.08, step], 0.09, legs, 0.058));
      p.push(B(0.1, 0.08, 0.26, s * 0.11, 0.04, step - 0.05, '#3b2f2a'));
    }
  }
  p.push(paint(new THREE.CapsuleGeometry(0.165 * w, 0.32, 4, 12).scale(1, 1, 0.68).translate(0, hip + 0.3, 0), top));
  p.push(S(0.17, 0, hip + 0.02, 0, legs, 1, 0.6, 0.75));
  const sh = hip + 0.5;
  for (const s of [-1, 1]) {
    const a = o.arms === 'photo' ? [[s * 0.28, sh - 0.22, -0.16], [s * 0.07, sh + 0.12, -0.3]]
      : o.arms === 'phone' && s > 0 ? [[0.26, sh - 0.24, -0.12], [0.14, sh - 0.02, -0.34]]
        : o.arms === 'up' && s > 0 ? [[0.4, sh + 0.12, 0], [0.34, sh + 0.42, -0.04]]
          : [[s * 0.27 * w, sh - 0.27, 0.02], [s * 0.26 * w, sh - 0.52, -0.08]];
    p.push(limb([s * 0.2 * w, sh, 0], a[0], 0.058 * w, top, 0.046 * w));
    p.push(limb(a[0], a[1], 0.042 * w, skin, 0.034 * w));
    p.push(S(0.045, ...a[1], skin));
  }
  p.push(C(0.055, 0.05, 0.1, 0, sh + 0.12, 0, skin));
  p.push(S(0.105, 0, sh + 0.27, 0, skin, 0.92, 1.15, 1));
  p.push(S(0.025, 0, sh + 0.26, -0.105, skin));
  for (const s of [-1, 1]) p.push(S(0.013, s * 0.038, sh + 0.29, -0.093, '#22201f'));
  if (o.hat) {
    p.push(C(0.19, 0.19, 0.015, 0, sh + 0.33, 0, '#e8d6a8', 18));
    p.push(C(0.11, 0.09, 0.09, 0, sh + 0.38, 0, '#e8d6a8', 14));
  } else p.push(paint(new THREE.SphereGeometry(0.113, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.52).scale(0.96, 1.12, 1.02).rotateX(0.28).translate(0, sh + 0.28, 0.012), pick(r, HAIR)));
  if (o.bag) p.push(paint(new THREE.CapsuleGeometry(0.13, 0.18, 3, 8).scale(1, 1, 0.7).translate(0, sh - 0.14, 0.19), pick(r, ['#c0392b', '#2c6fbb', '#3d5a40'])));
  if (o.camera) {
    p.push(B(0.12, 0.08, 0.06, 0, sh + 0.14, -0.31, '#202024'));
    p.push(paint(new THREE.CylinderGeometry(0.032, 0.032, 0.07, 10).rotateX(Math.PI / 2).translate(0, sh + 0.14, -0.37), '#111114'));
  }
  if (o.arms === 'phone') p.push(B(0.07, 0.13, 0.012, 0.14, sh + 0.05, -0.35, '#15151a'));
  return p;
}
const moved = (parts, x, z, ry = 0) => parts.map((g) => g.rotateY(ry).translate(x, 0, z));

function chair(c = '#6b4a2f') {
  const p = [B(0.44, 0.04, 0.42, 0, 0.44, 0, c), B(0.44, 0.46, 0.04, 0, 0.69, 0.2, c)];
  for (const x of [-0.19, 0.19]) for (const z of [-0.18, 0.18]) p.push(C(0.02, 0.02, 0.44, x, 0.22, z, c, 6));
  return p;
}

function crowd(seed, n, spread) {
  const r = rng(seed);
  const parts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.5;
    const d = spread * (0.35 + r() * 0.65);
    parts.push(...moved(person(r, { hat: r() < 0.4, bag: r() < 0.5, arms: pick(r, ['down', 'photo', 'phone', 'up', 'down']), stride: 0.05 + r() * 0.16 }), Math.cos(a) * d, Math.sin(a) * d, r() * 6.28));
  }
  return mesh(parts);
}

function restaurant() {
  const r = rng(77);
  const p = [];
  for (const [x, z] of [[-2.6, 0], [0, 0.5], [2.6, 0]]) {
    p.push(C(0.42, 0.42, 0.04, x, 0.74, z, '#f5efe2', 20), C(0.03, 0.03, 2.4, x, 1.2, z, '#8a8f96', 8), C(0.22, 0.22, 0.03, x, 0.015, z, '#8a8f96'));
    p.push(paint(new THREE.ConeGeometry(1.45, 0.55, 8).translate(x, 2.45, z), pick(r, ['#c0392b', '#e6b84c', '#2f6f8f'])));
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.6;
      const px = x + Math.sin(a) * 0.85;
      const pz = z + Math.cos(a) * 0.85;
      p.push(...moved(chair(), px, pz, a));
      if (r() < 0.8) p.push(...moved(person(r, { sit: true, arms: pick(r, ['down', 'phone']), hat: r() < 0.3 }), px, pz, a));
      p.push(C(0.035, 0.03, 0.12, x + Math.sin(a) * 0.28, 0.82, z + Math.cos(a) * 0.28, pick(r, ['#e0a030', '#f7f7f7', '#c0392b']), 8));
    }
  }
  p.push(...moved(person(r, { top: '#1f1f24', arms: 'up' }), 1.2, -1.6, 0.6)); // a waiter
  return mesh(p);
}

// ───────────── vehicles ─────────────

function wheels(p, x, zs, rad = 0.32) {
  for (const s of [-1, 1]) {
    for (const z of zs) {
      p.push(paint(new THREE.CylinderGeometry(rad, rad, 0.22, 18).rotateZ(Math.PI / 2).translate(s * x, rad, z), '#1c1c1f'));
      p.push(paint(new THREE.CylinderGeometry(rad * 0.55, rad * 0.55, 0.23, 12).rotateZ(Math.PI / 2).translate(s * x, rad, z), '#b9bec6'));
    }
  }
}

/** A body from a side outline [[z, y], …], w wide. */
function hull(outline, w, c) {
  const sh = new THREE.Shape(outline.map(([z, y]) => new THREE.Vector2(z, y)));
  return paint(new THREE.ExtrudeGeometry(sh, { depth: w, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 2 }).translate(0, 0, -w / 2).rotateY(-Math.PI / 2), c);
}

function car(c) {
  const p = [hull([[-1.85, 0.35], [1.85, 0.35], [1.88, 0.85], [-1.1, 0.9], [-1.88, 0.75]], 1.55, c), hull([[-1.0, 0.92], [1.6, 0.9], [1.3, 1.42], [-0.35, 1.45]], 1.36, c)];
  p.push(hull([[-0.9, 0.96], [1.45, 0.95], [1.2, 1.36], [-0.34, 1.38]], 1.47, '#27343d'));
  for (const s of [-1, 1]) p.push(S(0.12, s * 0.58, 0.66, -1.9, '#fdf6d8', 1, 0.8, 0.4), B(0.24, 0.12, 0.04, s * 0.6, 0.72, 1.93, '#b3202a'));
  p.push(B(0.5, 0.12, 0.03, 0, 0.45, -1.94, '#f4f4f4'), B(0.5, 0.12, 0.03, 0, 0.5, 1.95, '#f4f4f4'));
  wheels(p, 0.76, [-1.15, 1.15]);
  return mesh(p);
}

function pickup(c, angular = false) {
  const p = angular
    ? [hull([[-2.6, 0.45], [2.6, 0.45], [2.65, 1.1], [0.2, 1.85], [-2.65, 0.95]], 1.85, c), hull([[-1.4, 1.2], [1.1, 1.22], [0.2, 1.7]], 1.97, '#20262b')]
    : [hull([[-2.5, 0.45], [2.5, 0.45], [2.5, 0.95], [-2.5, 0.95]], 1.75, c), hull([[-1.1, 0.95], [0.6, 0.95], [0.5, 1.65], [-0.6, 1.65]], 1.55, c), hull([[-0.95, 1.0], [0.5, 1.0], [0.42, 1.56], [-0.55, 1.56]], 1.66, '#27343d'), B(1.55, 0.06, 1.7, 0, 1.0, 1.6, '#5b4a3a'), B(0.1, 0.35, 1.8, 0.85, 1.12, 1.6, c), B(0.1, 0.35, 1.8, -0.85, 1.12, 1.6, c)];
  for (const s of [-1, 1]) p.push(B(0.35, 0.12, 0.06, s * 0.65, 0.78, angular ? -2.7 : -2.58, '#fdf6d8'));
  wheels(p, 0.92, [-1.6, 1.6], 0.4);
  return mesh(p);
}

function coach() {
  const p = [hull([[-5.6, 0.45], [5.6, 0.45], [5.6, 3.1], [-5.1, 3.15], [-5.65, 1.6]], 2.4, '#f3f3ee'), B(2.54, 0.95, 9.4, 0, 2.2, 0.4, '#25323b'), B(2.52, 0.3, 10.6, 0, 1.2, 0, '#d1495b'), B(2.1, 1.2, 0.2, 0, 2.2, -5.45, '#25323b')];
  for (const s of [-1, 1]) p.push(S(0.16, s * 0.9, 0.9, -5.66, '#fdf6d8', 1, 0.8, 0.4), B(0.08, 0.5, 0.3, s * 1.4, 2.3, -5.5, '#222'));
  wheels(p, 1.12, [-3.7, 2.9, 4], 0.48);
  return mesh(p);
}

// ───────────── animals ─────────────

/** A four-legged animal. h: shoulder height; len, body thickness, colours, and what it has. */
function animal({ h, len, fat, c, belly = c, neck = 0.3, head = 0.1, snout = 0.1, ear = 0.06, tail = 0.15, bush = 0.02, antlers = false }) {
  const p = [];
  const y = h - fat * 0.6;
  p.push(S(1, 0, y, 0, c, fat * 0.75, fat, len / 2), S(1, 0, y - fat * 0.35, 0, belly, fat * 0.6, fat * 0.7, len * 0.4));
  for (const s of [-1, 1]) for (const z of [-len * 0.32, len * 0.33]) p.push(limb([s * fat * 0.45, y, z], [s * fat * 0.45, 0, z + 0.01], fat * 0.26, c, fat * 0.14));
  const hd = [0, h + neck * 0.75, -len * 0.5 - neck * 0.55];
  p.push(limb([0, y + fat * 0.3, -len * 0.36], hd, fat * 0.5, c, head * 0.75), S(head, ...hd, c, 0.8, 0.95, 1.15));
  p.push(limb([0, hd[1] - head * 0.15, hd[2] - head * 0.5], [0, hd[1] - head * 0.45, hd[2] - head - snout], head * 0.6, c, head * 0.32), S(head * 0.22, 0, hd[1] - head * 0.42, hd[2] - head - snout, '#1f1a18'));
  for (const s of [-1, 1]) {
    p.push(limb([s * head * 0.5, hd[1] + head * 0.6, hd[2] + head * 0.2], [s * head * 0.8, hd[1] + head * 0.6 + ear, hd[2] + head * 0.3], head * 0.3, c, 0.005), S(head * 0.14, s * head * 0.68, hd[1] + head * 0.2, hd[2] - head * 0.55, '#15110f'));
    if (antlers) {
      p.push(limb([s * 0.05, hd[1] + head * 0.8, hd[2]], [s * 0.3, hd[1] + 0.5, hd[2] + 0.12], 0.022, '#cdb48c', 0.016), limb([s * 0.3, hd[1] + 0.5, hd[2] + 0.12], [s * 0.26, hd[1] + 0.82, hd[2] - 0.02], 0.018, '#cdb48c', 0.006));
      p.push(limb([s * 0.2, hd[1] + 0.34, hd[2] + 0.08], [s * 0.22, hd[1] + 0.52, hd[2] - 0.18], 0.015, '#cdb48c', 0.005), limb([s * 0.3, hd[1] + 0.5, hd[2] + 0.12], [s * 0.48, hd[1] + 0.68, hd[2] + 0.1], 0.015, '#cdb48c', 0.005));
    }
  }
  p.push(limb([0, y + fat * 0.3, len * 0.46], [0, y + fat * 0.1 + tail * 0.2, len * 0.46 + tail], bush || 0.02, c, (bush || 0.02) * 0.7));
  if (bush > 0.04) p.push(S(bush * 1.2, 0, y + fat * 0.1 + tail * 0.2, len * 0.46 + tail, belly));
  return mesh(p);
}

// ───────────── trees, rubbish and street things ─────────────

function tree(p, x, z, k, r) {
  const g = pick(r, ['#4f8a43', '#5c9a4c', '#44783b', '#6ba152']);
  p.push(C(0.13 * k, 0.08 * k, 3 * k, x, 1.5 * k, z, '#6f4e32', 8));
  for (let i = 0; i < 4; i++) p.push(paint(new THREE.IcosahedronGeometry((0.75 + r() * 0.45) * k, 1).translate(x + (r() - 0.5) * 1.1 * k, (3.2 + r() * 1.3) * k, z + (r() - 0.5) * 1.1 * k), g));
}

function forest(seed, n, spread) {
  const r = rng(seed);
  const p = [];
  for (let i = 0; i < n; i++) {
    const a = r() * 6.28;
    const d = Math.sqrt(r()) * spread;
    tree(p, Math.cos(a) * d, Math.sin(a) * d, 0.8 + r() * 0.7, r);
  }
  return mesh(p);
}

function bush(seed, k) {
  const r = rng(seed);
  const p = [];
  for (let i = 0; i < 7; i++) p.push(paint(new THREE.IcosahedronGeometry((0.3 + r() * 0.25) * k, 1).translate((r() - 0.5) * k, (0.25 + r() * 0.3) * k, (r() - 0.5) * k), pick(r, ['#3f6d35', '#4c7d3f', '#5a8a47'])));
  for (let i = 0; i < 14; i++) p.push(S(0.035 * k, (r() - 0.5) * 1.3 * k, (0.2 + r() * 0.6) * k, (r() - 0.5) * 1.3 * k, '#5a1f3d'));
  return mesh(p);
}

function trash(seed) {
  const r = rng(seed);
  const p = [];
  for (let i = 0; i < 34; i++) {
    const a = r() * 6.28;
    const d = Math.sqrt(r()) * 0.9;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const c = pick(r, ['#ffffff', '#e84855', '#f9dc5c', '#3185fc', '#c9a97a', '#7bb662']);
    const kind = r();
    const g = kind < 0.4 ? new THREE.BoxGeometry(0.1 + r() * 0.14, 0.03 + r() * 0.06, 0.1 + r() * 0.1) : kind < 0.7 ? new THREE.CylinderGeometry(0.033, 0.033, 0.13, 10).rotateZ(Math.PI / 2) : new THREE.IcosahedronGeometry(0.06 + r() * 0.05, 0);
    p.push(paint(g.rotateY(r() * 6).translate(x, 0.04 + r() * 0.08 * (1 - d), z), c));
  }
  p.push(paint(new THREE.IcosahedronGeometry(0.28, 1).scale(1, 0.7, 1).translate(0.1, 0.16, 0), '#2a2c31'));
  return mesh(p);
}

function bags(seed) {
  const r = rng(seed);
  const p = [];
  for (let i = 0; i < 7; i++) {
    const x = (r() - 0.5) * 1.3;
    const z = (r() - 0.5) * 0.9;
    const s = 0.28 + r() * 0.14;
    p.push(paint(new THREE.IcosahedronGeometry(s, 2).scale(1, 0.85, 1).translate(x, s * 0.75, z), i % 3 ? '#23252a' : '#34383f'), limb([x, s * 1.4, z], [x + 0.03, s * 1.4 + 0.12, z], 0.04, '#23252a', 0.07));
  }
  return mesh(p);
}

function bin(full) {
  const p = [C(0.24, 0.29, 0.85, 0, 0.45, 0, '#3d5a52', 18), C(0.3, 0.3, 0.05, 0, 0.88, 0, '#2a3f39', 18)];
  if (!full) p.push(C(0.22, 0.12, 0.14, 0, 0.98, 0, '#2a3f39', 18));
  else {
    const r = rng(8);
    for (let i = 0; i < 16; i++) p.push(paint(new THREE.IcosahedronGeometry(0.08 + r() * 0.07, 0).translate((r() - 0.5) * 0.45, 0.92 + r() * 0.25, (r() - 0.5) * 0.45), pick(r, ['#ffffff', '#e84855', '#f9dc5c', '#3185fc', '#23252a'])));
    for (let i = 0; i < 18; i++) p.push(paint(new THREE.BoxGeometry(0.12, 0.05, 0.09).rotateY(r() * 6).translate((r() - 0.5) * 1.7, 0.03, (r() - 0.5) * 1.5), pick(r, ['#ffffff', '#c9a97a', '#e84855', '#7bb662'])));
    p.push(B(0.5, 0.36, 0.42, 0.6, 0.18, 0.2, '#b98f5f'), B(0.9, 0.7, 0.08, -0.7, 0.35, 0.1, '#8a6a48'));
  }
  return mesh(p);
}

function vending() {
  const p = [B(0.95, 1.85, 0.8, 0, 0.93, 0, '#c8202f'), B(0.62, 1.3, 0.03, -0.1, 1.08, -0.41, '#20303a'), B(0.16, 0.5, 0.03, 0.35, 1.2, -0.41, '#e9e9e9'), B(0.6, 0.16, 0.03, -0.1, 0.24, -0.41, '#1a1a1d')];
  const cs = ['#f9dc5c', '#3185fc', '#7bb662', '#ffffff', '#f2994a'];
  for (let y = 0; y < 5; y++) for (let x = 0; x < 6; x++) p.push(C(0.034, 0.034, 0.15, -0.36 + x * 0.105, 0.58 + y * 0.25, -0.43, cs[(x + y * 2) % 5], 8));
  // the same front on both sides
  p.push(...p.slice(1).map((g) => g.clone().rotateY(Math.PI)));
  return mesh(p);
}

function plazaFountain() {
  const p = [C(2.6, 2.6, 0.5, 0, 0.25, 0, '#cfc4ae', 40), C(2.35, 2.35, 0.02, 0, 0.5, 0, '#68aecb', 40), C(3.4, 3.4, 0.14, 0, 0.07, 0, '#c9ccd0', 40), C(3, 3, 0.28, 0, 0.14, 0, '#d4d7da', 40), C(0.8, 0.6, 1.4, 0, 1.1, 0, '#dfe2e5', 16), C(0.5, 1.4, 0.35, 0, 1.95, 0, '#e6e9eb', 24), C(1.25, 1.25, 0.02, 0, 2.13, 0, '#68aecb', 24), C(0.45, 0.3, 1.2, 0, 2.7, 0, '#dfe2e5', 14), C(0.3, 0.8, 0.25, 0, 3.4, 0, '#e6e9eb', 20), C(0.3, 0.16, 1.1, 0, 4.0, 0, '#dfe2e5', 12), S(0.3, 0, 4.7, 0, '#eef0f2', 0.8, 1.2, 0.8)];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const x = Math.cos(a) * 6.4;
    const z = Math.sin(a) * 6.4;
    const bench = [B(1.6, 0.07, 0.45, 0, 0.45, 0, '#8a5f3c'), B(1.6, 0.4, 0.06, 0, 0.72, 0.22, '#8a5f3c'), B(0.08, 0.45, 0.4, -0.65, 0.22, 0, '#2d2f33'), B(0.08, 0.45, 0.4, 0.65, 0.22, 0, '#2d2f33')];
    if (i % 2) p.push(...bench.map((g) => g.rotateY(Math.PI / 2 - a + Math.PI).translate(x, 0, z)));
    else p.push(C(0.05, 0.04, 3.4, x, 1.7, z, '#2d2f33', 8), S(0.2, x, 3.5, z, '#fff6d8'), C(0.16, 0.12, 0.3, x, 0.15, z, '#2d2f33', 10));
  }
  return mesh(p);
}

/** A little fortress on a stand, with tiny tourists round it. */
function towerModel() {
  const p = [B(1.3, 0.9, 1.3, 0, 0.45, 0, '#8a6a48'), B(1.36, 0.05, 1.36, 0, 0.92, 0, '#7ba05b')];
  const st = '#cfc4ae';
  p.push(B(0.4, 0.42, 0.4, 0, 1.15, 0, st));
  for (const x of [-1, 1]) for (const z of [-1, 1]) p.push(C(0.07, 0.07, 0.56, x * 0.2, 1.22, z * 0.2, st, 10), paint(new THREE.ConeGeometry(0.085, 0.14, 10).translate(x * 0.2, 1.57, z * 0.2), '#6b7a86'), C(0.08, 0.08, 0.22, x * 0.5, 1.05, z * 0.5, st, 10));
  for (const s of [-1, 1]) p.push(B(1, 0.15, 0.05, 0, 1.02, s * 0.5, st), B(0.05, 0.15, 1, s * 0.5, 1.02, 0, st));
  const r = rng(4);
  for (let i = 0; i < 26; i++) {
    const x = (r() - 0.5) * 0.85;
    const z = (r() < 0.5 ? -1 : 1) * (0.28 + r() * 0.16);
    p.push(C(0.014, 0.012, 0.05, x, 0.97, z, pick(r, TOPS), 6), S(0.012, x, 1.007, z, pick(r, SKIN)));
  }
  return mesh(p);
}

function signpost() {
  const p = [C(0.05, 0.05, 2.2, 0, 1.1, 0, '#6b4a2f', 8), S(0.08, 0, 2.25, 0, '#6b4a2f')];
  [['#2f6f8f', 2.0, 0.3], ['#b5553a', 1.78, -0.5], ['#4c7a68', 1.56, 0.1]].forEach(([c, y, a]) => p.push(paint(new THREE.BoxGeometry(0.85, 0.16, 0.03).translate(0.3, 0, 0).rotateY(a).translate(0, y, 0), c)));
  return mesh(p);
}

function board(c, w = 1.15, h = 0.95) {
  // (its face is −z… the original's boards are read from their back, like its panels, so both sides are the same)
  const p = [B(w, h, 0.03, 0, 1.45, 0, c), B(w + 0.08, 0.05, 0.07, 0, 1.45 + h / 2, 0, '#8a5f3c'), B(w + 0.08, 0.05, 0.07, 0, 1.45 - h / 2, 0, '#8a5f3c')];
  for (const s of [-1, 1]) p.push(B(0.05, h + 0.1, 0.07, s * (w / 2 + 0.02), 1.45, 0, '#8a5f3c'), limb([s * w * 0.4, 0, 0.28], [s * w * 0.4, 1.45 - h / 2, 0], 0.025, '#8a5f3c'), limb([s * w * 0.4, 0, -0.28], [s * w * 0.4, 1.45 - h / 2, 0], 0.025, '#8a5f3c'));
  return mesh(p);
}

function basket() {
  const p = [paint(new THREE.CylinderGeometry(0.34, 0.26, 0.34, 20, 1, true).translate(0, 0.17, 0), '#b98a52'), C(0.26, 0.26, 0.02, 0, 0.01, 0, '#9b7040', 20)];
  for (let i = 0; i < 4; i++) p.push(paint(new THREE.TorusGeometry(0.265 + i * 0.026, 0.014, 6, 24).rotateX(Math.PI / 2).translate(0, 0.05 + i * 0.09, 0), i % 2 ? '#8e6538' : '#c99a60'));
  const m = mesh(p);
  m.material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  return m;
}

function star() {
  const sh = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const d = i % 2 ? 0.11 : 0.26;
    sh[i ? 'lineTo' : 'moveTo'](Math.cos(a) * d, -Math.sin(a) * d);
  }
  return new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.06, bevelSize: 0.015, bevelThickness: 0.015 }).translate(0, 0, -0.03), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
}

function graffitiPlane(w, h, seed) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = Math.round((512 * h) / w);
  const g = c.getContext('2d');
  const r = rng(seed);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (let k = 0; k < 9; k++) {
    // filled, outlined shapes in a row, like tags
    const x = 30 + k * 52 + r() * 14;
    const y = c.height * (0.35 + r() * 0.3);
    g.beginPath();
    for (let i = 0; i <= 9; i++) g.lineTo(x + Math.cos(i * 0.9 + k) * (24 + r() * 16), y + Math.sin(i * 1.3 + k) * (c.height * (0.16 + r() * 0.14)));
    g.closePath();
    g.fillStyle = pick(r, ['#e83f6f', '#2ab7ca', '#f2f2f2', '#6a4c93', '#ffd23f']);
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = '#16161a';
    g.stroke();
  }
  for (let k = 0; k < 5; k++) {
    g.strokeStyle = pick(r, ['#e83f6f', '#2ab7ca', '#ffd23f', '#6a4c93', '#111111', '#66d17a']);
    g.lineWidth = 3 + r() * 6;
    g.beginPath();
    const y = (0.2 + r() * 0.6) * c.height;
    const f = 1 + r() * 4;
    for (let i = 0; i <= 40; i++) g.lineTo(30 + i * 11.3, y + Math.sin((i / 40) * 6.28 * f + r() * 0.3) * c.height * 0.2);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
}

// ───────────── words ─────────────

const EDGE = new THREE.MeshLambertMaterial({ color: 0x3a3f55 });
/** A box whose `sides` (of 0–5) use the second material and the rest the first: two draw calls instead of six. */
function faceLast(geo, sides) {
  const ix = [...geo.index.array];
  const part = (want) => [0, 1, 2, 3, 4, 5].filter((i) => sides.includes(i) === want).flatMap((i) => ix.slice(i * 6, i * 6 + 6));
  const rest = part(false);
  const front = part(true);
  geo.setIndex([...rest, ...front]);
  geo.clearGroups();
  geo.addGroup(0, rest.length, 0);
  geo.addGroup(rest.length, front.length, 1);
  return geo;
}

/** A flat sign with words, read from +z (like the original's panels). */
export function sign(text, { w = 0.9, h = 0.56, bg = '#14182c', ink = '#ffffff', edge = 'rgba(255,255,255,0.35)', size = 60, align = 'center', radius = 30 } = {}) {
  const c = document.createElement('canvas');
  c.width = 768;
  c.height = Math.round((768 * h) / w);
  const g = c.getContext('2d');
  roundRect(g, 3, 3, c.width - 6, c.height - 6, Math.min(radius, c.height / 2 - 4));
  g.fillStyle = bg;
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = edge;
  g.stroke();
  let lines;
  let s = size;
  for (; s > 18; s -= 2) {
    g.font = font(s, 600);
    lines = [];
    for (const para of text.split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        const t = line ? `${line} ${word}` : word;
        if (line && g.measureText(t).width > c.width - 70) {
          lines.push(line);
          line = word;
        } else line = t;
      }
      lines.push(line);
    }
    if (lines.length * s * 1.25 < c.height - 44 && Math.max(...lines.map((l) => g.measureText(l).width)) <= c.width - 60) break;
  }
  g.fillStyle = ink;
  g.textBaseline = 'middle';
  g.textAlign = align;
  lines.forEach((l, i) => g.fillText(l, align === 'center' ? c.width / 2 : 36, c.height / 2 + (i - (lines.length - 1) / 2) * s * 1.25));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  const face = new THREE.MeshBasicMaterial({ map: t, transparent: radius > 40 });
  // a rounded button is just its face; a panel is a thin board (drawn in two goes: the face, and the rest together)
  const m = radius > 40 ? new THREE.Mesh(new THREE.PlaneGeometry(w, h), face) : new THREE.Mesh(faceLast(new THREE.BoxGeometry(w, h, 0.02), [4]), [EDGE, face]);
  m.userData.face = face;
  return m;
}

/** A letter to pick up: a block with the letter on its front and back. */
export function letterBlock(letter) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#e4572e';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 12;
  g.strokeRect(10, 10, 236, 236);
  g.fillStyle = '#ffffff';
  g.font = font(190, 800);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(letter, 128, 140);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  const face = new THREE.MeshLambertMaterial({ map: t });
  const side = new THREE.MeshLambertMaterial({ color: 0xb8431f });
  return new THREE.Mesh(faceLast(new THREE.BoxGeometry(0.28, 0.28, 0.1), [4, 5]), [side, face]);
}

// ───────────── what each kind of object looks like ─────────────
// floor: it stands on the ground whatever height its original's middle was at

export const MODELS = {
  man: () => mesh(person(rng(6), { top: '#f25f5c', muscle: true, hat: true })),
  woman: () => mesh(person(rng(15), { top: '#ffc914', arms: 'phone', bag: true, hat: true })),
  people: (e) => crowd(e.id * 31, 9, 1.35),
  'man-sitting': () => mesh([...chair('#5b4636'), ...person(rng(9), { sit: true, arms: 'phone' })]),
  photographer: () => mesh([...person(rng(12), { arms: 'photo', camera: true, bag: true }), ...[0, 2.1, 4.2].map((a) => limb([Math.sin(a) * 0.35, 0, -0.75 + Math.cos(a) * 0.35], [0, 1.3, -0.75], 0.016, '#24262b')), B(0.16, 0.12, 0.12, 0, 1.38, -0.75, '#1c1c20')]),
  restaurant,
  'car-white': () => car('#eceff1'),
  'car-red': () => car('#b3302f'),
  truck: () => pickup('#aeb4ba', true),
  pickup: () => pickup('#3f7d58'),
  coach,
  rabbit: () => animal({ h: 0.2, len: 0.32, fat: 0.1, c: '#9b8468', belly: '#e6dccb', neck: 0.06, head: 0.06, snout: 0.02, ear: 0.13, tail: 0.04, bush: 0.045 }),
  stag: () => animal({ h: 1.2, len: 1.6, fat: 0.32, c: '#8a5f3c', belly: '#c9ad88', neck: 0.6, head: 0.13, snout: 0.2, ear: 0.14, tail: 0.12, bush: 0.05, antlers: true }),
  deer: () => animal({ h: 0.95, len: 1.25, fat: 0.25, c: '#a8764a', belly: '#e0cbaa', neck: 0.5, head: 0.11, snout: 0.16, ear: 0.14, tail: 0.1, bush: 0.05 }),
  fox: () => animal({ h: 0.4, len: 0.65, fat: 0.13, c: '#c8622b', belly: '#f3e7d8', neck: 0.14, head: 0.08, snout: 0.11, ear: 0.08, tail: 0.36, bush: 0.07 }),
  wolf: () => animal({ h: 0.75, len: 1.05, fat: 0.22, c: '#6f7278', belly: '#b9b6ae', neck: 0.26, head: 0.12, snout: 0.16, ear: 0.1, tail: 0.38, bush: 0.07 }),
  squirrel: () => animal({ h: 0.15, len: 0.2, fat: 0.06, c: '#8f4e26', belly: '#eadcc6', neck: 0.05, head: 0.042, snout: 0.02, ear: 0.035, tail: 0.16, bush: 0.055 }),
  forest: (e) => forest(e.id, Math.round(4 + e.s * 1.1), e.s * 0.85),
  bush: (e) => bush(e.id, e.s),
  trash: (e) => trash(e.id),
  bags: (e) => bags(e.id),
  bin: () => bin(false),
  'bin-full': () => bin(true),
  vending,
  plaza: plazaFountain,
  'tower-model': towerModel,
  signpost,
  blackboard: () => board('#23382f', 3.6, 1.5),
  whiteboard: () => board('#f7f8fa', 3.2, 1.7),
  basket,
  pavement: () => mesh([B(14, 0.08, 7, 0, 0.04, 0, '#b7b2a8')]),
  ball: () => new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 3), new THREE.MeshLambertMaterial({ color: 0xd8b45a })),
  star,
  graffiti: () => graffitiPlane(8, 2.5, 3),
  'graffiti-tall': () => graffitiPlane(9, 2.5, 9),
};
/** Kinds that keep the height they had; everything else stands on the ground. */
export const FLOATS = new Set(['star', 'ball', 'graffiti', 'graffiti-tall']);
