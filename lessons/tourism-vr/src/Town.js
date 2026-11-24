import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// The town round the lesson: houses along the edge of every area, ground, sky and light. Original scenery, all made in
// code. Areas are in ENGAGE's metres (z north); here z is turned round (north is −z).

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const colour = new THREE.Color();
/** Give a whole geometry one colour (vertex colours, so many things can be one mesh). */
export function paint(geo, hex) {
  colour.set(hex);
  const n = geo.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([colour.r, colour.g, colour.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}

function canvasTexture(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Rows of windows on a wall: one cell is cell × cell metres. */
const windowTexture = ({ wall, frame, glass, sill = null, w = 0.46, h = 0.5, cols = 1 }) => canvasTexture(256, 256, (g) => {
  g.fillStyle = wall;
  g.fillRect(0, 0, 256, 256);
  const r = rng(3);
  for (let i = 0; i < 120; i++) {
    g.fillStyle = `rgba(60,55,50,${r() * 0.06})`;
    g.fillRect(r() * 256, r() * 256, 10 + r() * 50, 4 + r() * 20);
  }
  for (let c = 0; c < cols; c++) {
    const W = (256 / cols) * w;
    const x = (256 / cols) * (c + 0.5) - W / 2;
    const H = 256 * h;
    const y = 128 - H / 2;
    g.fillStyle = frame;
    g.fillRect(x - 7, y - 7, W + 14, H + 14);
    g.fillStyle = glass;
    g.fillRect(x, y, W, H);
    g.fillStyle = 'rgba(255,255,255,0.22)';
    g.beginPath();
    g.moveTo(x, y); g.lineTo(x + W * 0.6, y); g.lineTo(x, y + H * 0.7);
    g.fill();
    g.fillStyle = frame;
    g.fillRect(x + W / 2 - 3, y, 6, H);
    if (sill) {
      g.fillStyle = sill;
      g.fillRect(x - 12, y + H + 7, W + 24, 9);
    }
  }
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(0, 252, 256, 4);
});

const TEX = {
  flats: () => windowTexture({ wall: '#b9b2a8', frame: '#e8e6e0', glass: '#3c4852', sill: '#8d877d', w: 0.5, h: 0.44 }),
  grey: () => windowTexture({ wall: '#c3c5c6', frame: '#2c3036', glass: '#39434c', w: 0.5, h: 0.4 }),
  dark: () => windowTexture({ wall: '#2c313b', frame: '#d7d9dc', glass: '#6f8796', w: 0.4, h: 0.34 }),
  house: () => windowTexture({ wall: '#ffffff', frame: '#8a7a64', glass: '#42525c', sill: '#b3a68f', w: 0.34, h: 0.54 }),
  // the cinema: white plaster, framed posters, a dark band at the foot (6 × 6 m)
  cinema: () => canvasTexture(512, 512, (g) => {
    g.fillStyle = '#ece8e0';
    g.fillRect(0, 0, 512, 512);
    g.fillStyle = '#c9c3b4';
    for (let x = 0; x < 512; x += 128) for (let y = 0; y < 250; y += 84) g.strokeRect(x, y, 128, 84);
    g.fillStyle = '#c65a80';
    g.fillRect(0, 262, 512, 9);
    for (const x of [40, 296]) {
      g.strokeStyle = '#ffffff';
      g.lineWidth = 16;
      g.strokeRect(x - 10, 318, 196, 92);
      g.fillStyle = '#23262c';
      g.fillRect(x, 326, 176, 76);
      g.fillStyle = '#b8cfdb';
      for (let k = 0; k < 4; k++) g.fillRect(x + 12 + k * 40, 340, 30, 48);
    }
    g.fillStyle = '#2d2e33';
    g.fillRect(0, 458, 512, 54);
  }),
  // the church: pale stone with round arches (6 × 9 m)
  church: () => canvasTexture(512, 768, (g) => {
    g.fillStyle = '#cfc3ad';
    g.fillRect(0, 0, 512, 768);
    const r = rng(9);
    for (let y = 0; y < 768; y += 32) {
      for (let x = (y / 32) % 2 ? -32 : 0; x < 512; x += 64) {
        g.fillStyle = `rgba(${r() < 0.5 ? '255,250,235' : '90,75,55'},${r() * 0.22})`;
        g.fillRect(x + 1, y + 1, 62, 30);
      }
    }
    const arch = (x, y, w, h) => {
      g.beginPath();
      g.moveTo(x, y + h); g.lineTo(x, y + w / 2);
      g.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0);
      g.lineTo(x + w, y + h);
      g.closePath();
      g.fill();
    };
    for (const x of [64, 320]) {
      g.fillStyle = '#b3a48a';
      arch(x - 22, 220, 172, 380);
      g.fillStyle = '#d9cfba';
      arch(x, 244, 128, 356);
      g.fillStyle = '#4a5148';
      arch(x + 28, 300, 72, 230);
      g.fillStyle = 'rgba(230,200,120,0.5)';
      for (let k = 0; k < 5; k++) g.fillRect(x + 36, 330 + k * 40, 56, 22);
    }
    g.fillStyle = '#a4967c';
    g.fillRect(0, 700, 512, 68);
  }),
  // the market hall: grey columns, glass, yellow notices (9 × 7 m)
  hall: () => canvasTexture(512, 400, (g) => {
    g.fillStyle = '#c9ccce';
    g.fillRect(0, 0, 512, 400);
    g.fillStyle = '#8f9498';
    g.fillRect(0, 0, 512, 92);
    for (let x = 0; x < 512; x += 128) {
      g.fillStyle = '#5d6a72';
      g.fillRect(x + 22, 120, 98, 150);
      g.fillStyle = 'rgba(200,225,235,0.4)';
      g.fillRect(x + 28, 126, 40, 138);
      g.fillStyle = '#eef0f1';
      g.fillRect(x, 92, 18, 308);
      g.fillStyle = '#3f86b5';
      for (let k = 0; k < 3; k++) g.fillRect(x + 28 + k * 30, 300, 16, 70);
    }
    g.fillStyle = '#e8c53a';
    g.fillRect(160, 108, 46, 46);
    g.fillRect(420, 108, 46, 46);
  }),
  redteal: () => canvasTexture(512, 400, (g) => {
    g.fillStyle = '#7c2b2a';
    g.fillRect(0, 0, 512, 400);
    g.fillStyle = '#3b4148';
    for (const x of [0, 160, 340, 494]) g.fillRect(x, 0, 18, 400);
    g.fillRect(0, 0, 512, 26);
    g.fillStyle = '#39b7bd';
    g.fillRect(40, 60, 96, 170);
    for (let k = 0; k < 4; k++) g.fillRect(192 + k * 36, 70, 22, 150);
    g.fillRect(376, 60, 96, 170);
    g.fillStyle = '#b21e3b';
    g.fillRect(0, 262, 512, 26);
    g.fillStyle = '#cfe04a';
    for (const x of [44, 92, 384, 432]) g.fillRect(x, 310, 34, 60);
    g.fillStyle = '#f2f4f6';
    g.fillRect(196, 306, 124, 94);
  }),
  stadium: () => canvasTexture(512, 512, (g) => {
    g.fillStyle = '#8d9296';
    g.fillRect(0, 0, 512, 512);
    g.fillStyle = '#5c3d34';
    g.fillRect(0, 20, 512, 60);
    g.fillStyle = '#c3c7ca';
    g.fillRect(0, 80, 512, 130);
    g.fillStyle = '#4b5054';
    for (let x = 0; x < 512; x += 128) g.fillRect(x + 14, 226, 100, 250);
    g.fillStyle = 'rgba(255,255,255,0.14)';
    for (let y = 230; y < 476; y += 14) g.fillRect(0, y, 512, 4);
    g.fillStyle = '#d7dadc';
    for (let x = 0; x < 512; x += 16) g.fillRect(x, 420, 5, 92);
  }),
};
/** How each kind of building is made: the texture's size in metres, its height and its roof. */
const STYLES = {
  flats: { u: 3.2, v: 3, h: [18, 21, 24], roof: 'flat', depth: 12, width: 22 },
  grey: { u: 4, v: 3.4, h: [10.2], roof: 'flat', depth: 10, width: 16 },
  dark: { u: 4.2, v: 3.4, h: [10.2], roof: 'flat', depth: 10, width: 20 },
  cinema: { u: 6, v: 6, h: [6], roof: 'flat', depth: 12, width: 40 },
  church: { u: 6, v: 9, h: [9], roof: 'tiles', depth: 11, width: 40 },
  hall: { u: 9, v: 7, h: [7], roof: 'slope', depth: 14, width: 60 },
  redteal: { u: 12, v: 9, h: [9], roof: 'flat', depth: 10, width: 24 },
  stadium: { u: 12, v: 13, h: [13], roof: 'stadium', depth: 14, width: 60 },
  house: { u: 3, v: 3, h: [6, 9, 12], roof: 'tiles', depth: 8, width: 8 },
};

/** Which kind of building stands along an edge: worked out from a recording of the original lesson. */
function styleAt(x, z, ox, oz) {
  if (z > 21 && z < 36 && x < -3 && x > -24) return 'church';
  if (Math.abs(x + 22.7) < 0.2 && z > 9) return 'cinema';
  if (oz > 0 && Math.abs(z - 9.1) < 0.2 && x < -37) return 'flats';
  if (oz > 0 && Math.abs(z - 9.1) < 0.2 && x < -22) return 'cinema';
  if (x < -37 && z > -15) return 'flats';
  if (x > 8 && z > 20 && z < 48) return 'hall';
  if (Math.abs(x - 34) < 0.3 && z > -9) return z < 12 ? 'redteal' : 'flats';
  if (x > 8 && z < 22 && z > -20) return 'flats';
  if (x < -40 && z < -12) return 'grey';
  if (x < -19 && z < -13) return 'stadium';
  if (x < -8 && z < -13 && z > -70) return 'dark';
  if (z < -60) return 'house';
  return z > 40 ? 'house' : 'flats';
}

const paving = (base, line, size) => canvasTexture(256, 256, (g) => {
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  const r = rng(11);
  const n = size;
  const s = 256 / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '60,45,30'},${r() * 0.16})`;
      g.fillRect(x * s + ((y % 2) * s) / 2 + 1, y * s + 1, s - 2, s - 2);
    }
  }
  g.fillStyle = line;
  for (let y = 0; y < n; y++) {
    g.fillRect(0, y * s, 256, 1.6);
    for (let x = 0; x < n; x++) g.fillRect(x * s + ((y % 2) * s) / 2, y * s, 1.6, s);
  }
});

const grassTexture = () => canvasTexture(256, 256, (g) => {
  g.fillStyle = '#7ba05b';
  g.fillRect(0, 0, 256, 256);
  const r = rng(5);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(${40 + r() * 80},${90 + r() * 90},${30 + r() * 40},0.35)`;
    g.fillRect(r() * 256, r() * 256, 1.5, 3 + r() * 5);
  }
});

const roofTexture = () => canvasTexture(128, 128, (g) => {
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  for (let x = 0; x < 8; x++) {
    const k = g.createLinearGradient(x * 16, 0, x * 16 + 16, 0);
    k.addColorStop(0, 'rgba(70,20,8,0.55)');
    k.addColorStop(0.5, 'rgba(255,220,200,0.15)');
    k.addColorStop(1, 'rgba(70,20,8,0.55)');
    g.fillStyle = k;
    g.fillRect(x * 16, 0, 16, 128);
  }
  g.fillStyle = 'rgba(60,20,10,0.35)';
  for (let y = 0; y < 8; y++) g.fillRect(0, y * 16, 128, 2);
});

/** Multiply a box/plane geometry's uvs, so a texture keeps its real size. */
function scaleUV(geo, u, v, ou = 0) {
  const a = geo.attributes.uv;
  for (let i = 0; i < a.count; i++) a.setXY(i, a.getX(i) * u + ou, a.getY(i) * v);
  return geo;
}

export class Town {
  constructor(scene, areas, lawns = []) {
    this.areas = areas;
    this.lawns = lawns;
    this.group = new THREE.Group();
    this.group.name = 'town';
    scene.add(this.group);
    this.buildSky(scene);
    this.buildGround();
    this.buildHouses();
    for (const m of this.group.children) {
      m.matrixAutoUpdate = false;
      m.updateMatrix();
    }
  }

  /** Is (x, z) in ENGAGE's metres inside an area, at least `margin` from any wall? */
  inside(x, z, margin = 0) {
    const one = (px, pz) => this.areas.some(([x0, x1, z0, z1]) => px >= x0 && px <= x1 && pz >= z0 && pz <= z1);
    if (!one(x, z)) return false;
    if (!margin) return true;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) if (!one(x + dx * margin, z + dz * margin)) return false;
    return true;
  }

  /** Can you see from one place to another without a wall between? */
  clear(x0, z0, x1, z1) {
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.5);
    for (let i = 1; i < n; i++) if (!this.inside(x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n)) return false;
    return true;
  }

  buildSky(scene) {
    const uniforms = { top: { value: new THREE.Color('#4f9be0') }, low: { value: new THREE.Color('#dcecf5') } };
    this.sky = uniforms;
    this.skyGoal = { top: new THREE.Color('#4f9be0'), low: new THREE.Color('#dcecf5') };
    const dome = new THREE.Mesh(new THREE.SphereGeometry(420, 24, 14), new THREE.ShaderMaterial({
      uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 low; varying float h; void main(){ gl_FragColor = vec4(mix(low, top, pow(clamp(h, 0.0, 1.0), 0.55)), 1.0);\n#include <colorspace_fragment>\n}',
    }));
    dome.renderOrder = -10;
    this.group.add(dome);
    this.dome = dome;
    scene.fog = new THREE.Fog('#dcecf5', 60, 260);
    this.fog = scene.fog;
  }

  /** The "Skybox (Eerie)" of the original: a dim, brown sky. */
  setEerie(on) {
    this.skyGoal.top.set(on ? '#4a4138' : '#4f9be0');
    this.skyGoal.low.set(on ? '#b98a5c' : '#dcecf5');
    this.eerie = on;
  }

  update(dt) {
    const k = 1 - Math.exp(-dt * 1.5);
    this.sky.top.value.lerp(this.skyGoal.top, k);
    this.sky.low.value.lerp(this.skyGoal.low, k);
    this.fog.color.copy(this.sky.low.value);
    this.fog.far += ((this.eerie ? 110 : 260) - this.fog.far) * k;
    this.fog.near += ((this.eerie ? 15 : 60) - this.fog.near) * k;
  }

  buildGround() {
    const gravel = new THREE.MeshLambertMaterial({ map: canvasTexture(256, 256, (g) => {
      g.fillStyle = '#c2b196';
      g.fillRect(0, 0, 256, 256);
      const r = rng(17);
      for (let i = 0; i < 5200; i++) {
        const c = r();
        g.fillStyle = c < 0.4 ? `rgba(90,75,55,${0.15 + r() * 0.25})` : `rgba(245,236,218,${0.15 + r() * 0.3})`;
        g.fillRect(r() * 256, r() * 256, 1 + r() * 2.5, 1 + r() * 2);
      }
    }) });
    const kinds = {
      road: new THREE.MeshLambertMaterial({ map: paving('#b9b0a2', 'rgba(70,60,50,0.5)', 16) }),
      paving: new THREE.MeshLambertMaterial({ map: paving('#c4c0b6', 'rgba(90,88,82,0.4)', 8) }),
      grass: new THREE.MeshLambertMaterial({ map: grassTexture() }),
      gravel,
    };
    kinds.park = kinds.grass;
    // a wide field beyond the town, so no edge shows
    const field = new THREE.Mesh(new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x8aa56a }));
    field.position.y = -0.06;
    this.group.add(field);
    this.areas.forEach(([x0, x1, z0, z1, kind], i) => {
      const w = x1 - x0;
      const d = z1 - z0;
      const m = new THREE.Mesh(scaleUV(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), w / 4, d / 4), kinds[kind]);
      // (a hair's difference in height where areas overlap; the road lies lowest)
      m.position.set((x0 + x1) / 2, kind === 'road' ? 0 : 0.004 + i * 0.0012, -(z0 + z1) / 2);
      this.group.add(m);
    });
    // lawns with grey kerbs
    const kerb = [];
    for (const [x0, x1, z0, z1] of this.lawns) {
      const w = x1 - x0;
      const d = z1 - z0;
      const m = new THREE.Mesh(scaleUV(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), w / 4, d / 4), kinds.grass);
      m.position.set((x0 + x1) / 2, 0.05, -(z0 + z1) / 2);
      this.group.add(m);
      for (const x of [x0, x1]) kerb.push(new THREE.BoxGeometry(0.28, 0.12, d).translate(x, 0.03, -(z0 + z1) / 2));
      for (const z of [z0, z1]) kerb.push(new THREE.BoxGeometry(w, 0.12, 0.28).translate((x0 + x1) / 2, 0.03, -z));
    }
    this.group.add(new THREE.Mesh(mergeGeometries(kerb), new THREE.MeshLambertMaterial({ color: 0x8b8f93 })));
    // the road north and south of the square
    const tar = new THREE.MeshLambertMaterial({ color: 0x55575c });
    for (const [z0, z1] of [[-98, -14], [22, 113]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(7.4, z1 - z0).rotateX(-Math.PI / 2), tar);
      m.position.set(0.2, 0.04, -(z0 + z1) / 2);
      this.group.add(m);
    }
    const list = [];
    for (let z = -95; z < 112; z += 6) if (z < -15 || z > 24) list.push(new THREE.PlaneGeometry(0.14, 2.6).rotateX(-Math.PI / 2).translate(0.2, 0.055, -z));
    this.group.add(new THREE.Mesh(mergeGeometries(list), new THREE.MeshLambertMaterial({ color: 0xd9d4c7 })));
  }

  /** The stretches of wall along the edge of every area: [x, z, length, the way out (dx, dz), park?] */
  edges() {
    const runs = [];
    const covered = (x, z) => this.inside(x, z);
    for (const [x0, x1, z0, z1, kind] of this.areas) {
      const side = (len, at, out) => {
        let from = null;
        for (let s = 0.05; s <= len + 0.2; s += 0.1) {
          const [x, z] = at(s);
          const open = s > len || covered(x + out[0] * 0.3, z + out[1] * 0.3);
          if (!open && from === null) from = s - 0.05;
          if (open && from !== null) {
            const to = Math.min(len, s - 0.05);
            if (to - from > 0.4) runs.push({ from, to, at, out, kind });
            from = null;
          }
        }
      };
      side(x1 - x0, (s) => [x0 + s, z0], [0, -1]);
      side(x1 - x0, (s) => [x0 + s, z1], [0, 1]);
      side(z1 - z0, (s) => [x0, z0 + s], [-1, 0]);
      side(z1 - z0, (s) => [x1, z0 + s], [1, 0]);
    }
    return runs;
  }

  buildHouses() {
    const r = rng(42);
    const walls = {}; // style → its fronts
    const tiles = [];
    const plain = [];
    const tint = ['#fff3dc', '#f6dcb4', '#f2c59a', '#fbe9cf', '#f0d0b4', '#f7efe2', '#e9b98f'];
    for (const run of this.edges()) {
      const [ox, oz] = run.out;
      if (run.kind === 'park') {
        // a low wall and a hedge
        const len = run.to - run.from;
        const [x, z] = run.at((run.from + run.to) / 2);
        plain.push(paint(new THREE.BoxGeometry(ox ? 0.35 : len, 0.8, ox ? len : 0.35).translate(x + ox * 0.2, 0.4, -(z + oz * 0.2)), '#b9b3a4'));
        plain.push(paint(new THREE.BoxGeometry(ox ? 0.9 : len, 1.7, ox ? len : 0.9).translate(x + ox * 0.9, 0.85, -(z + oz * 0.9)), '#567d42'));
        continue;
      }
      let s = run.from;
      while (s < run.to - 0.01) {
        // a stretch of one style, no wider than that style's buildings
        const name = styleAt(...run.at(Math.min(s + 0.4, run.to - 0.01)), ox, oz);
        const st = STYLES[name];
        const wide = name === 'house' ? 6 + Math.floor(r() * 3) * 1.5 : st.width * (0.75 + r() * 0.5);
        let w = 0;
        while (s + w < run.to - 0.005 && w < wide && styleAt(...run.at(Math.min(s + w + 0.2, run.to - 0.01)), ox, oz) === name) w = Math.min(w + 0.5, run.to - s);
        if (run.to - s - w < 3 && name === styleAt(...run.at(run.to - 0.02), ox, oz)) w = run.to - s;
        w = Math.max(w, 0.2);
        const [x, z] = run.at(s + w / 2);
        let depth = st.depth;
        while (depth > 0.5 && !this.roomFor(x, z, ox, oz, w, depth)) depth -= 0.5;
        const h = st.h[Math.floor(r() * st.h.length)];
        const cx = x + (ox * depth) / 2;
        const cz = -(z + (oz * depth) / 2);
        const sx = ox ? depth : w;
        const sz = ox ? w : depth;
        const c = name === 'house' ? tint[Math.floor(r() * tint.length)] : '#ffffff';
        const body = { flats: '#b9b2a8', grey: '#c3c5c6', dark: '#2c313b', cinema: '#ece8e0', church: '#cfc3ad', hall: '#c9ccce', redteal: '#7c2b2a', stadium: '#8d9296', house: c }[name];
        // (a little narrower than its front, so a neighbour round the corner shows its own front)
        plain.push(paint(new THREE.BoxGeometry(ox ? sx : sx - 0.06, h, ox ? sz - 0.06 : sz).translate(cx, h / 2, cz), body));
        const ry = Math.atan2(-ox, oz); // facing back into the area
        const list = (walls[name] ??= []);
        const vs = Math.max(1, Math.round(h / st.v));
        const us = Math.max(1, Math.round((w / st.u) * 2) / 2);
        list.push(paint(scaleUV(new THREE.PlaneGeometry(w, h), us, vs).translate(0, h / 2, 0.02).rotateY(ry).translate(x, 0, -z), c));
        if (depth > 2) {
          // the ends too, where no other building hides them
          for (const k of [-1, 1]) {
            const end = scaleUV(new THREE.PlaneGeometry(depth, h), Math.max(1, Math.round(depth / st.u)), vs).translate(0, h / 2, w / 2 - 0.02).rotateY(k > 0 ? 0 : Math.PI);
            list.push(paint(end.rotateY(Math.PI / 2 + ry).translate(cx, 0, cz), c));
          }
        }
        if (st.roof === 'tiles') {
          const rise = name === 'church' ? 3.4 : 1.5;
          tiles.push(paint(scaleUV(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).scale(sx + 0.8, rise, sz + 0.8), 8, 1.5).translate(cx, h + rise / 2, cz), name === 'church' ? '#a8583c' : '#b8623f'));
        } else if (st.roof === 'slope') plain.push(paint(new THREE.CylinderGeometry(0.5, 0.5, 1, 3).rotateX(Math.PI / 2).rotateY(ox ? 0 : Math.PI / 2).scale(sx + 2, 2.4, sz + 2).translate(cx, h + 0.4, cz), '#7f8488'));
        else if (st.roof === 'stadium') plain.push(paint(new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 1).scale(sx + 6, 2, sz + 6).translate(cx, h + 0.8, cz), '#9a9fa3'));
        else plain.push(paint(new THREE.BoxGeometry(sx + 0.3, 0.35, sz + 0.3).translate(cx, h + 0.1, cz), name === 'cinema' ? '#c65a80' : name === 'dark' ? '#1f232a' : '#a7a49c'));
        s += w;
      }
    }
    this.landmarks(plain, tiles);
    // hills and far blocks of flats round the town
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2 + r() * 0.2;
      const d = 190 + r() * 60;
      plain.push(paint(new THREE.SphereGeometry(1, 10, 6).scale(46 + r() * 40, 12 + r() * 18, 46 + r() * 30).translate(Math.cos(a) * d, -3, Math.sin(a) * d - 20), ['#8ca56d', '#7d9a66', '#9aab78'][i % 3]));
    }
    const far = (walls.flats ??= []);
    for (const [x, z, w, h] of [[-46, 46, 34, 24], [-80, 20, 26, 21], [-84, -24, 24, 18], [60, -30, 34, 27], [70, 24, 30, 24], [-30, 62, 26, 18], [52, 60, 26, 21]]) {
      plain.push(paint(new THREE.BoxGeometry(w, h, 12).translate(x, h / 2, -z), '#b9b2a8'));
      for (const k of [-1, 1]) far.push(paint(scaleUV(new THREE.PlaneGeometry(w, h), Math.round(w / 3.2), Math.round(h / 3)).rotateY(k > 0 ? 0 : Math.PI).translate(x, h / 2, -z + k * 6.03), '#ffffff'));
    }
    const add = (list, o) => this.group.add(new THREE.Mesh(mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g))), new THREE.MeshLambertMaterial({ vertexColors: true, ...o })));
    add(plain, {});
    add(tiles, { map: roofTexture(), flatShading: true });
    for (const [name, list] of Object.entries(walls)) add(list, { map: TEX[name]() });
  }

  /** The things that tell you where you are: tower, cinema front, playground, kiosk, statues, lamps and trees. */
  landmarks(p, tiles) {
    const B = (w, h, d, x, y, z, c) => p.push(paint(new THREE.BoxGeometry(w, h, d).translate(x, y, -z), c));
    const C = (r0, r1, h, x, y, z, c, seg = 14) => p.push(paint(new THREE.CylinderGeometry(r1, r0, h, seg).translate(x, y, -z), c));
    // the church tower, grey between brick buttresses, with crosses
    B(5, 11, 5, -18.6, 5.5, 24.6, '#8b8d8c');
    for (const [x, z] of [[-21.2, 22], [-16, 22], [-21.2, 27], [-16, 27]]) {
      B(1.1, 9.4, 1.1, x, 4.7, z, '#a8663f');
      B(0.16, 1.6, 0.16, x, 10.2, z, '#5b4632');
      B(0.8, 0.16, 0.16, x, 10.4, z, '#5b4632');
    }
    C(3, 1.2, 6, -18.6, 14, 24.6, '#cfc3ad', 8);
    tiles.push(paint(new THREE.ConeGeometry(1.6, 3, 8).translate(-18.6, 18.4, -24.6), '#a8583c'));
    // the cinema's rounded corner, doors and upper wall
    C(2.9, 2.9, 8.6, -24.6, 4.3, 10.6, '#efece5', 28);
    C(3.05, 3.05, 0.5, -24.6, 8.6, 10.6, '#c65a80', 28);
    C(2.96, 2.96, 1.1, -24.6, 0.55, 10.6, '#2d2e33', 28);
    for (let k = -2; k <= 2; k++) {
      const a = -0.55 + k * 0.42;
      const g = new THREE.BoxGeometry(0.8, 2, 0.1).translate(0, 2, 2.9).rotateY(a + 0.95);
      p.push(paint(g.translate(-24.6, 0, -10.6), k % 2 ? '#33383f' : '#dfe6ea'));
    }
    B(9, 7, 8, -31, 9, 15.5, '#d8d2c6');
    // the playground by the stadium: slides, a frame, a striped stall
    for (const [x, z, c] of [[-33, -18, '#f2c230'], [-27, -20, '#8d9296']]) {
      const g = new THREE.BoxGeometry(0.9, 0.12, 4).rotateX(0.5).translate(x, 1.1, -z);
      p.push(paint(g, c));
      B(0.12, 2.2, 0.12, x - 0.5, 1.1, z - 1.9, '#c0392b');
      B(0.12, 2.2, 0.12, x + 0.5, 1.1, z - 1.9, '#c0392b');
      B(1.2, 0.1, 1.2, x, 2.1, z - 2.3, '#2c6fbb');
    }
    B(1.6, 0.4, 1.6, -30, 0.2, -16.2, '#2c6fbb');
    for (const [x, z] of [[-1.1, -0.9], [1.1, -0.9], [-1.1, 0.9], [1.1, 0.9]]) C(0.05, 0.05, 2.3, -23 + x, 1.15, -17.5 + z, '#d7dadc', 6);
    for (let k = 0; k < 8; k++) B(0.33, 0.08, 2.3, -24.15 + k * 0.33, 2.35, -17.5, k % 2 ? '#ffffff' : '#3185fc');
    B(2.3, 0.9, 0.5, -23, 0.45, -16.7, '#b98f5f');
    // the teal kiosk across the square, a round planted island, white statues and lamps
    B(7, 2.8, 4, 25, 1.4, 18, '#2fb0b8');
    B(7.6, 0.3, 4.6, 25, 2.95, 18, '#3f9a52');
    B(6.4, 1.6, 0.06, 25, 1.5, 15.97, '#bfe3e8');
    C(4.2, 4.2, 0.25, 22, 0.12, -10.2, '#9aa08f', 36);
    C(3.8, 3.8, 0.3, 22, 0.16, -10.2, '#6f9a52', 36);
    for (const [x, z] of [[10, 8], [12.5, -8], [22, -10.2]]) {
      C(0.75, 0.6, 1.1, x, 0.55, z, '#e8eaec', 8);
      C(0.34, 0.2, 1.6, x, 1.9, z, '#eef0f2', 10);
      p.push(paint(new THREE.SphereGeometry(0.2, 10, 8).translate(x, 2.85, -z), '#eef0f2'));
    }
    for (const [x, z] of [[14, 4], [14, -4], [18, 10], [-14, -11], [-34, -4], [-46, -4]]) {
      C(0.07, 0.05, 4, x, 2, z, '#26282c', 8);
      p.push(paint(new THREE.SphereGeometry(0.2, 10, 8).translate(x, 4.1, -z), '#fff6d8'));
    }
    const r = rng(33);
    for (const [x, z, k] of [[-7.4, 18.6, 1.5], [-36, 7, 1.1], [-47, 7, 1.2], [-54, -9, 1.2], [-40, -10, 1], [13, 23.5, 1], [30, 15, 1.1], [31, -11.5, 1]]) {
      C(0.2 * k, 0.11 * k, 3 * k, x, 1.5 * k, z, '#6f5a44', 8);
      for (let i = 0; i < 5; i++) p.push(paint(new THREE.IcosahedronGeometry((0.9 + r() * 0.5) * k, 1).translate(x + (r() - 0.5) * 1.5 * k, (3 + r() * 1.5) * k, -z + (r() - 0.5) * 1.5 * k), ['#7c9455', '#6d8749', '#8aa05f'][i % 3]));
    }
  }

  /** Is there room for a house w wide and `depth` deep, going out from a wall at (x, z)? */
  roomFor(x, z, ox, oz, w, depth) {
    for (let d = 0.4; d <= depth; d += 0.5) {
      for (let k = -w / 2 + 0.2; k <= w / 2 - 0.19; k += 0.5) {
        if (this.inside(x + ox * d + (ox ? 0 : k), z + oz * d + (oz ? 0 : k))) return false;
      }
    }
    return true;
  }
}
