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

// one bay of an upper floor (3 × 3 m): plaster, a shuttered window and a little balcony
const bayTexture = () => canvasTexture(256, 256, (g) => {
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 256);
  const r = rng(3);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(120,100,70,${r() * 0.07})`;
    g.fillRect(r() * 256, r() * 256, 10 + r() * 40, 4 + r() * 14);
  }
  g.fillStyle = '#cbbfa8';
  g.fillRect(84, 52, 88, 142);
  g.fillStyle = '#3d5563';
  g.fillRect(92, 60, 72, 128);
  g.fillStyle = 'rgba(200,225,240,0.45)';
  g.beginPath();
  g.moveTo(92, 60); g.lineTo(140, 60); g.lineTo(92, 130);
  g.fill();
  g.fillStyle = '#f3efe6';
  g.fillRect(125, 60, 6, 128);
  g.fillRect(92, 118, 72, 5);
  for (const x of [46, 172]) {
    g.fillStyle = '#4c7a68';
    g.fillRect(x, 52, 38, 142);
    g.fillStyle = 'rgba(0,0,0,0.16)';
    for (let y = 60; y < 188; y += 9) g.fillRect(x + 5, y, 28, 3);
  }
  g.fillStyle = '#2b2b2b';
  g.fillRect(66, 194, 124, 5);
  g.fillRect(66, 158, 124, 3);
  for (let x = 68; x < 190; x += 11) g.fillRect(x, 158, 2, 38);
  g.fillStyle = 'rgba(90,70,50,0.25)';
  g.fillRect(0, 250, 256, 6);
});

// the ground floor (12 × 3 m): doors, shop fronts and awnings
const groundTexture = () => canvasTexture(1024, 256, (g) => {
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 1024, 256);
  g.fillStyle = 'rgba(110,90,70,0.35)';
  g.fillRect(0, 222, 1024, 34);
  const door = (x, c) => {
    g.fillStyle = '#b9a98c';
    g.fillRect(x - 8, 44, 102, 212);
    g.fillStyle = c;
    g.fillRect(x, 52, 86, 204);
    g.fillStyle = 'rgba(0,0,0,0.2)';
    for (const [a, b] of [[10, 12], [48, 12], [10, 112], [48, 112]]) g.fillRect(x + a, 52 + b, 28, 82);
  };
  const shop = (x, c) => {
    g.fillStyle = '#6a4d34';
    g.fillRect(x, 60, 240, 190);
    g.fillStyle = '#36505c';
    g.fillRect(x + 12, 84, 130, 130);
    g.fillRect(x + 160, 84, 64, 166);
    g.fillStyle = 'rgba(210,230,240,0.35)';
    g.fillRect(x + 20, 92, 40, 114);
    for (let i = 0; i < 10; i++) {
      g.fillStyle = i % 2 ? '#ffffff' : c;
      g.fillRect(x - 6 + i * 25.2, 34, 25.2, 46);
    }
  };
  door(40, '#7a4a2b');
  shop(190, '#b5553a');
  door(492, '#2f5d6b');
  shop(640, '#4c7a68');
  door(915, '#6b3d3d');
});

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
  constructor(scene, areas) {
    this.areas = areas;
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
    const kinds = {
      road: new THREE.MeshLambertMaterial({ map: paving('#b9b0a2', 'rgba(70,60,50,0.5)', 16) }),
      plaza: new THREE.MeshLambertMaterial({ map: paving('#d8c39c', 'rgba(110,85,55,0.45)', 8) }),
      paving: new THREE.MeshLambertMaterial({ map: paving('#c8b793', 'rgba(100,80,55,0.45)', 10) }),
      grass: new THREE.MeshLambertMaterial({ map: grassTexture() }),
    };
    kinds.park = kinds.grass;
    // a wide field beyond the town, so no edge shows
    const field = new THREE.Mesh(new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x8aa56a }));
    field.position.y = -0.06;
    this.group.add(field);
    this.areas.forEach(([x0, x1, z0, z1, kind], i) => {
      const w = x1 - x0;
      const d = z1 - z0;
      const geo = scaleUV(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), w / 4, d / 4);
      const m = new THREE.Mesh(geo, kinds[kind]);
      // (a hair's difference in height where areas overlap; the road lies lowest)
      m.position.set((x0 + x1) / 2, kind === 'road' ? 0 : 0.006 + i * 0.0015, -(z0 + z1) / 2);
      this.group.add(m);
    });
    // the carriageway down the long street, either side of the plaza
    const tar = new THREE.MeshLambertMaterial({ color: 0x55575c });
    for (const [z0, z1] of [[-98, -14], [14.5, 113]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(9.2, z1 - z0).rotateX(-Math.PI / 2), tar);
      m.position.set(-0.4, 0.03, -(z0 + z1) / 2);
      this.group.add(m);
    }
    const list = [];
    for (let z = -95; z < 112; z += 6) if (z < -15 || z > 15) list.push(new THREE.PlaneGeometry(0.14, 2.6).rotateX(-Math.PI / 2).translate(-0.4, 0.045, -z));
    for (const x of [-5.1, 4.3]) for (const [z0, z1] of [[-98, -14], [14.5, 113]]) list.push(new THREE.BoxGeometry(0.22, 0.12, z1 - z0).translate(x, 0.04, -(z0 + z1) / 2));
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
    const upper = [];
    const ground = [];
    const roofs = [];
    const plain = [];
    const walls = ['#fff3dc', '#f6dcb4', '#f2c59a', '#fbe9cf', '#f0d0b4', '#f7efe2', '#e9b98f', '#f4e2a8'];
    const tiles = ['#b5553a', '#c0623f', '#a94e36', '#bb6a48'];
    for (const run of this.edges()) {
      const [ox, oz] = run.out;
      if (run.kind === 'park' || run.kind === 'grass') {
        // a low wall and a hedge
        const len = run.to - run.from;
        const [x, z] = run.at((run.from + run.to) / 2);
        const along = ox ? [0.35, len] : [len, 0.35];
        plain.push(paint(new THREE.BoxGeometry(along[0], 0.8, along[1]).translate(x + ox * 0.2, 0.4, -(z + oz * 0.2)), '#cdbd9c'));
        plain.push(paint(new THREE.BoxGeometry(along[0] * (ox ? 2.6 : 1), 1.7, along[1] * (ox ? 1 : 2.6)).translate(x + ox * 0.9, 0.85, -(z + oz * 0.9)), '#567d42'));
        continue;
      }
      let s = run.from;
      while (s < run.to - 0.01) {
        let w = 6 + Math.floor(r() * 3) * 1.5;
        if (run.to - s - w < 4) w = run.to - s;
        const [x, z] = run.at(s + w / 2);
        // as deep as there is room for
        let depth = 8;
        while (depth > 0.5 && !this.roomFor(x, z, ox, oz, w, depth)) depth -= 0.5;
        const floors = 1 + Math.floor(r() * 2.6); // above the ground floor
        const h = 3.1 + floors * 3;
        const cx = x + (ox * depth) / 2;
        const cz = -(z + (oz * depth) / 2);
        const sx = ox ? depth : w;
        const sz = ox ? w : depth;
        const wall = walls[Math.floor(r() * walls.length)];
        // the body, and the front drawn with bays and a ground floor
        // (a little narrower than its front, so a neighbour round the corner shows its own front)
        plain.push(paint(new THREE.BoxGeometry(ox ? sx : sx - 0.06, h, ox ? sz - 0.06 : sz).translate(cx, h / 2, cz), wall));
        const ry = Math.atan2(-ox, oz); // facing back into the area
        const face = (g, y) => g.translate(0, y, 0.02).rotateY(ry).translate(x, 0, -z);
        const bays = Math.max(1, Math.round(w / 3));
        upper.push(paint(face(scaleUV(new THREE.PlaneGeometry(w, floors * 3), bays, floors), 3.1 + (floors * 3) / 2), wall));
        // windows on the ends too, where no other house hides them
        const ends = Math.max(1, Math.round(depth / 3));
        for (const k of depth > 2 ? [-1, 1] : []) {
          const end = scaleUV(new THREE.PlaneGeometry(depth, floors * 3), ends, floors).translate(0, 3.1 + (floors * 3) / 2, w / 2 - 0.02).rotateY(k > 0 ? 0 : Math.PI);
          // (made as if the house faced +z at its middle, then turned and put in place)
          upper.push(paint(end.rotateY(Math.PI / 2 + ry).translate(cx, 0, cz), wall));
        }
        ground.push(paint(face(scaleUV(new THREE.PlaneGeometry(w, 3.1), w / 12, 1, Math.floor(r() * 4) / 4), 1.55), wall));
        // a tiled roof with eaves
        const roof = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).scale(sx + 0.8, 1.6 + r() * 0.8, sz + 0.8);
        roofs.push(paint(scaleUV(roof, 8, 1.5).translate(cx, h + 0.9, cz), tiles[Math.floor(r() * tiles.length)]));
        plain.push(paint(new THREE.BoxGeometry(sx + 0.7, 0.16, sz + 0.7).translate(cx, h + 0.06, cz), '#8a5a3c'));
        s += w;
      }
    }
    // a church tower to the east, to find your way by
    plain.push(paint(new THREE.BoxGeometry(7, 24, 7).translate(44, 12, -24), '#efe0c4'));
    plain.push(paint(new THREE.BoxGeometry(7.6, 0.6, 7.6).translate(44, 19, -24), '#d9c7a4'));
    plain.push(paint(new THREE.BoxGeometry(2, 3.4, 7.1).translate(44, 21.6, -24), '#5c4c3c'));
    plain.push(paint(new THREE.BoxGeometry(7.1, 3.4, 2).translate(44, 21.6, -24), '#5c4c3c'));
    roofs.push(paint(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4).scale(8.4, 6, 8.4).translate(44, 27, -24), '#a94e36'));
    // hills round the town
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2 + r() * 0.2;
      const d = 190 + r() * 60;
      plain.push(paint(new THREE.SphereGeometry(1, 10, 6).scale(46 + r() * 40, 14 + r() * 22, 46 + r() * 30).translate(Math.cos(a) * d, -3, Math.sin(a) * d - 20), ['#8ca56d', '#7d9a66', '#9aab78'][i % 3]));
    }
    const add = (list, o) => this.group.add(new THREE.Mesh(mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g))), new THREE.MeshLambertMaterial({ vertexColors: true, ...o })));
    add(plain, {});
    add(upper, { map: bayTexture() });
    add(ground, { map: groundTexture() });
    add(roofs, { map: roofTexture(), flatShading: true });
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
