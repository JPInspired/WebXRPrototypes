import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Lab equipment shared by the chemistry lessons, built in code (nothing downloaded): glass beakers with a lip,
// markings and a curved liquid surface, reagent bottles with labels, a lab bench top, a white spotting tile with
// wells, a Bunsen burner with its two-part flame, and metals that look like the real ones.
// Glass and metal look their best with studioReflections() (shared/util/reflections.js) switched on.

const cache = new Map();
const once = (key, make) => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
};

function canvasTexture(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const lathe = (profile, seg = 32) => new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);

// ── materials ──────────────────────────────────────────

/** Clear lab glass: see-through, with a glossy reflective surface. */
export const glassMaterial = () => once('glass', () => new THREE.MeshPhysicalMaterial({
  color: 0xe4f2ff, transparent: true, opacity: 0.22, roughness: 0.03, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03,
  side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.4,
}));

/** A liquid: slightly see-through, with a wet shine. One per colour (the lessons recolour them). */
export const liquidMaterial = (color, opacity = 0.6) => new THREE.MeshPhysicalMaterial({
  color, transparent: true, opacity, roughness: 0.02, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 0.45, depthWrite: false,
});

/** Metals as they really look (for strips, electrodes and samples). */
const METALS = {
  zn: [0xa9b4bd, 0.45], cu: [0xc8764a, 0.3], mg: [0xd4d8de, 0.3], fe: [0x6e7277, 0.55], pb: [0x7d8590, 0.6],
  ag: [0xe6e8ec, 0.18], al: [0xc9cdd2, 0.35], li: [0xb8bcc0, 0.45], na: [0xc6c2b4, 0.5], k: [0xbfb9a8, 0.5],
};
export function metalMaterial(kind, fallback = 0x9aa0aa) {
  const [color, roughness] = METALS[kind] ?? [fallback, 0.4];
  return once(`metal-${kind}-${fallback}`, () => new THREE.MeshStandardMaterial({ color, metalness: 0.9, roughness, map: brushed(), envMapIntensity: 1 }));
}

/** Fine brushing marks, for metal. */
const brushed = () => once('brushed', () => {
  const t = canvasTexture(128, 128, (g, W, H) => {
    g.fillStyle = '#e0e0e0';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${0.03 + Math.random() * 0.06})`;
      g.fillRect(0, Math.random() * H, W, 1);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
});

// ── glassware ──────────────────────────────────────────

/** White volume markings printed on a beaker (a see-through texture). */
const graduations = () => once('grad', () => {
  const t = canvasTexture(256, 256, (g, W, H) => {
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    for (let i = 0; i < 9; i++) {
      const y = H * 0.18 + i * H * 0.08;
      g.fillRect(W * 0.08, y, i % 2 ? W * 0.05 : W * 0.09, 2);
    }
    g.font = '700 16px sans-serif';
    for (let i = 0; i < 9; i += 2) g.fillText(`${(8 - i) * 10}`, W * 0.18, H * 0.18 + i * H * 0.08 + 6);
  });
  return t;
});

/**
 * A glass beaker of radius r and height h with a liquid filling `fill` of it. Returns a group whose userData is
 * { glass, liquid, r, liquidTop } (glass: the mesh to pick; liquid: recolour its material).
 */
export function makeBeaker(r, h, color, fill = 0.62) {
  const g = new THREE.Group();
  const t = Math.max(0.0012, r * 0.04); // glass thickness
  // the glass: a thick base, straight sides, a rolled lip
  const glass = new THREE.Mesh(lathe([[0, 0], [r * 0.94, 0], [r * 0.98, 0.002], [r, 0.006], [r, h - 0.002], [r + t * 0.8, h], [r - t * 0.2, h + t * 0.4], [r - t, h - 0.002], [r - t, t * 2], [0, t * 2]], 40), glassMaterial());
  glass.renderOrder = 2;
  // markings on the side facing you
  const marks = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.0003, r + 0.0003, h * 0.8, 32, 1, true, -0.55, 1.1), new THREE.MeshBasicMaterial({ map: graduations(), transparent: true, depthWrite: false, toneMapped: false, opacity: 0.75 }));
  marks.position.y = h * 0.45;
  marks.renderOrder = 3;
  // the liquid, with its surface curving up a little at the glass (meniscus)
  const lh = h * fill;
  const lr = r - t * 1.1;
  const liquid = new THREE.Mesh(lathe([[0, t * 2], [lr, t * 2], [lr, lh + 0.0016], [lr * 0.92, lh + 0.0004], [lr * 0.6, lh], [0, lh]], 36), liquidMaterial(color));
  liquid.renderOrder = 1;
  g.add(liquid, glass, marks);
  g.userData = { glass, liquid, r, liquidTop: lh };
  return g;
}

/**
 * A reagent bottle: glass (tinted `glassColor`) with the liquid inside, a screw cap and a paper label.
 * Returns a group; userData.liquid is the liquid mesh.
 */
export function reagentBottle({ r = 0.017, h = 0.05, liquid = 0xe8f0f4, cap = 0x2b3560, glassColor = 0xe4f2ff, label = null } = {}) {
  const g = new THREE.Group();
  const neck = r * 0.5;
  const body = new THREE.Mesh(lathe([[0, 0], [r * 0.95, 0], [r, 0.003], [r, h * 0.72], [r * 0.85, h * 0.82], [neck, h * 0.9], [neck, h], [0, h]], 32),
    new THREE.MeshPhysicalMaterial({ color: glassColor, transparent: true, opacity: 0.38, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.05, depthWrite: false, envMapIntensity: 1.2 }));
  body.renderOrder = 2;
  const fillMesh = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r * 0.9, h * 0.62, 28), liquidMaterial(liquid, 0.9));
  fillMesh.position.y = h * 0.33;
  const capMesh = new THREE.Mesh(new THREE.CylinderGeometry(neck * 1.25, neck * 1.25, h * 0.16, 24), new THREE.MeshStandardMaterial({ color: cap, roughness: 0.45 }));
  capMesh.position.y = h + h * 0.07;
  g.add(fillMesh, body, capMesh);
  if (label) {
    const map = once(`label-${label}`, () => canvasTexture(256, 128, (c, W, H) => {
      c.fillStyle = '#f6f3ea';
      c.fillRect(0, 0, W, H);
      c.fillStyle = '#2b3560';
      c.fillRect(0, 0, W, 14);
      c.fillStyle = '#1d2236';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      let s = 40;
      c.font = `700 ${s}px sans-serif`;
      while (c.measureText(label).width > W * 0.9 && s > 14) c.font = `700 ${--s}px sans-serif`;
      c.fillText(label, W / 2, H * 0.58);
    }));
    const lab = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.01, r * 1.01, h * 0.34, 28, 1, true, -1.1, 2.2), new THREE.MeshStandardMaterial({ map, roughness: 0.85 }));
    lab.position.y = h * 0.38;
    g.add(lab);
  }
  g.userData = { liquid: fillMesh, body, cap: capMesh };
  return g;
}

// ── benches and tiles ──────────────────────────────────

/** A lab bench top (dark epoxy resin, with a fine speckle), w × d. Returns a group whose top face is at its
 * own y = 0, so placing the group at the bench height puts the surface exactly there. */
export function benchTop(w, d, { color = 0x2a3140, thickness = 0.014 } = {}) {
  const map = once(`bench-${color}`, () => {
    const t = canvasTexture(256, 256, (g, W, H) => {
      g.fillStyle = `#${new THREE.Color(color).getHexString()}`;
      g.fillRect(0, 0, W, H);
      for (let i = 0; i < 2500; i++) {
        g.fillStyle = `rgba(255,255,255,${0.02 + Math.random() * 0.05})`;
        g.fillRect(Math.random() * W, Math.random() * H, 1, 1);
      }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(w / 0.3, d / 0.3);
    return t;
  });
  const top = new THREE.Mesh(new THREE.BoxGeometry(w, thickness, d), new THREE.MeshPhysicalMaterial({ color: 0xffffff, map, roughness: 0.45, clearcoat: 0.4, clearcoatRoughness: 0.4, envMapIntensity: 0.4 }));
  top.position.y = -thickness / 2;
  const g = new THREE.Group();
  g.add(top);
  return g;
}

/** A white glazed tile, w × d (h thick), with a row of shallow wells (or none); top face at y = 0. */
export function spottingTile(w, d, wells = 3, { h = 0.006 } = {}) {
  const g = new THREE.Group();
  const glaze = new THREE.MeshPhysicalMaterial({ color: 0xf6f7f8, roughness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.15, envMapIntensity: 0.6 });
  const s = new THREE.Shape();
  s.moveTo(-w / 2, -d / 2);
  s.lineTo(w / 2, -d / 2);
  s.lineTo(w / 2, d / 2);
  s.lineTo(-w / 2, d / 2);
  s.closePath();
  const wr = Math.min(d * 0.22, w / (wells * 2.6));
  for (let i = 0; i < wells; i++) {
    const hole = new THREE.Path();
    hole.absarc(-w / 2 + (w / wells) * (i + 0.5), 0, wr, 0, Math.PI * 2, true);
    s.holes.push(hole);
  }
  const slab = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: true, bevelThickness: 0.0012, bevelSize: 0.0012, bevelSegments: 2, curveSegments: 24 });
  slab.rotateX(-Math.PI / 2);
  slab.translate(0, -h - 0.0012, 0);
  g.add(new THREE.Mesh(slab, glaze));
  // the wells: shallow bowls
  for (let i = 0; i < wells; i++) {
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(wr, 24, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), glaze);
    bowl.scale.y = (h * 0.7) / wr;
    bowl.position.set(-w / 2 + (w / wells) * (i + 0.5), 0, 0);
    g.add(bowl);
  }
  return g;
}

// ── bubbles ────────────────────────────────────────────

/** A gas bubble seen from any side: a clear centre, a bright rim and a highlight (for Points materials). */
export const bubbleTexture = () => once('bubble', () => canvasTexture(64, 64, (g, W) => {
  g.clearRect(0, 0, W, W);
  const r = g.createRadialGradient(W / 2, W / 2, W * 0.18, W / 2, W / 2, W * 0.46);
  r.addColorStop(0, 'rgba(255,255,255,0.08)');
  r.addColorStop(0.75, 'rgba(255,255,255,0.35)');
  r.addColorStop(0.92, 'rgba(255,255,255,0.95)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.beginPath();
  g.arc(W / 2, W / 2, W * 0.47, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.95)'; // the highlight
  g.beginPath();
  g.ellipse(W * 0.38, W * 0.34, W * 0.08, W * 0.05, -0.6, 0, Math.PI * 2);
  g.fill();
}));

// ── the Bunsen burner ──────────────────────────────────

/**
 * A Bunsen burner: a heavy base, the barrel with its air-hole collar, the gas tap, and a two-part flame
 * (a pale outer flame and a bright blue inner cone) that flickers. Returns a group; userData:
 * { flame (group), barrelTop (height of the barrel's top), setFlame(on), update(t) }.
 */
export function bunsenBurner({ barrel = 0.12 } = {}) {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xb9bec6, metalness: 0.85, roughness: 0.3, envMapIntensity: 1 });
  const base = new THREE.Mesh(lathe([[0, 0], [0.042, 0], [0.044, 0.004], [0.04, 0.012], [0.014, 0.018], [0, 0.018]], 40), new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: 0.5, metalness: 0.4 }));
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0075, barrel, 24), steel);
  tube.position.y = 0.018 + barrel / 2;
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.0095, 0.0095, 0.018, 24), steel);
  collar.position.y = 0.032;
  const hole = new THREE.Mesh(new THREE.CircleGeometry(0.0035, 16), new THREE.MeshBasicMaterial({ color: 0x0b0c0f }));
  hole.position.set(0, 0.032, 0.0096);
  const tap = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.03, 12), steel);
  tap.rotation.z = Math.PI / 2;
  tap.position.set(0.03, 0.01, 0);
  const tapEnd = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.0045, 0.012, 12), new THREE.MeshStandardMaterial({ color: 0xd04a2a, roughness: 0.6 }));
  tapEnd.rotation.z = Math.PI / 2;
  tapEnd.position.set(0.048, 0.01, 0);
  g.add(base, tube, collar, hole, tap, tapEnd);
  // the flame: additive, so it glows
  const flame = new THREE.Group();
  const flameMat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const outer = new THREE.Mesh(lathe([[0.0072, 0], [0.0095, 0.012], [0.0085, 0.04], [0.004, 0.07], [0, 0.085]], 24), flameMat(0x6f8cff, 0.35));
  const inner = new THREE.Mesh(lathe([[0.0062, 0], [0.006, 0.008], [0.0035, 0.022], [0, 0.03]], 24), flameMat(0x4fd0ff, 0.85));
  const tip = new THREE.Mesh(lathe([[0.002, 0.06], [0.004, 0.072], [0, 0.092]], 16), flameMat(0xffa860, 0.18));
  flame.add(outer, inner, tip);
  const barrelTop = 0.018 + barrel;
  flame.position.y = barrelTop;
  g.add(flame);
  const light = new THREE.PointLight(0x6f9cff, 0, 0.6, 2);
  light.position.y = barrelTop + 0.03;
  g.add(light);
  g.userData = {
    flame, barrelTop,
    setFlame(on) {
      flame.visible = on;
      light.intensity = on ? 0.6 : 0;
    },
    update(t) {
      const k = 1 + 0.06 * Math.sin(t * 23) + 0.04 * Math.sin(t * 37 + 1);
      outer.scale.set(1, k, 1);
      inner.scale.set(1, 1 + 0.03 * Math.sin(t * 31), 1);
      tip.scale.set(1, 0.9 + 0.2 * Math.abs(Math.sin(t * 7)), 1);
    },
  };
  return g;
}

// ── physics apparatus ──────────────────────────────────

/** Cast-iron stand bases: heavy, dark, slightly glossy paint. */
export const castIron = () => once('castIron', () => new THREE.MeshStandardMaterial({ color: 0x2b3040, metalness: 0.45, roughness: 0.45, envMapIntensity: 0.7 }));
/** Polished steel (rods, clamps). */
export const steel = () => once('steel', () => new THREE.MeshStandardMaterial({ color: 0xc8cdd5, metalness: 0.9, roughness: 0.22, envMapIntensity: 1 }));
/** Brass (slotted masses, bobs). */
export const brass = () => once('brass', () => new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.9, roughness: 0.28, envMapIntensity: 1 }));

/** A retort-stand base (w × d), its top face at y = 0. */
export function standBase(w, d) {
  const g = new THREE.Group();
  const slab = new THREE.Mesh(new RoundedBoxGeometry(w, 0.012, d, 2, 0.003), castIron());
  slab.position.y = -0.006;
  const lip = new THREE.Mesh(new THREE.BoxGeometry(w * 0.96, 0.002, d * 0.96), castIron());
  lip.position.y = 0.0005;
  g.add(slab, lip);
  return g;
}

/** A boss head (the block that clamps an arm to a stand's rod), with its two thumbscrews. Centre at origin. */
export function bossHead() {
  const g = new THREE.Group();
  const block = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.022, 0.022), castIron());
  g.add(block);
  for (const [x, z] of [[0, 0.015], [0.015, 0]]) {
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.012, 10), steel());
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.003, 16), steel());
    if (z) { screw.rotation.x = Math.PI / 2; head.rotation.x = Math.PI / 2; }
    else { screw.rotation.z = Math.PI / 2; head.rotation.z = Math.PI / 2; }
    screw.position.set(x, 0, z);
    head.position.set(x * 1.45, 0, z * 1.45);
    g.add(screw, head);
  }
  g.traverse((m) => { if (m.isMesh) m.raycast = () => {}; });
  return g;
}

/**
 * A stack of brass slotted masses on a hanger (a single mesh, total height h, radius r), centred on its middle,
 * like the cylinder it replaces: discs with grooves between them and the slot cut in one side.
 */
export function slottedMassGeometry(r, h, discs = 3) {
  const pts = [[0, -h / 2]];
  const step = h / discs;
  for (let i = 0; i < discs; i++) {
    const y0 = -h / 2 + i * step;
    pts.push([r * 0.92, y0], [r, y0 + step * 0.08], [r, y0 + step * 0.9], [r * 0.9, y0 + step]);
  }
  pts.push([r * 0.12, h / 2], [r * 0.12, h / 2 + 0.012], [0, h / 2 + 0.012]); // the hanger's rod
  return new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 32);
}
