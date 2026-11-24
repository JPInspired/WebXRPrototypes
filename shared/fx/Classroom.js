import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// A light, simple classroom around each lesson, styled for its subject (chemistry lab, physics lab, biology lab,
// computer room), instead of a dark grid. It shows on a computer screen and in full virtual reality; in mixed
// reality the real classroom is visible instead, so it hides.
//
// Built to stay light on a headset: everything is drawn once onto a few canvas pictures (walls, floor, ceiling),
// the furniture is one merged shape, and nothing is lit in real time (the shading is painted in). About eight
// draw calls in all.
//
// ┌──────────────────────────────────────────────────────────────────────────────────────────────────────────┐
// │ THE ONE SWITCH: set `enabled` to false to turn the rooms off in every lesson (the dark grid comes back). │
// └──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
export const ROOMS = { enabled: true };

// Which room each lesson gets. A lesson that is not listed (Hintze Hall, Reef Dive: they have their own places)
// keeps the grid.
const SUBJECT = {
  'atomic-models': 'chemistry', 'acid-lab': 'chemistry', 'lithium-lab': 'chemistry', 'kinetics-lab': 'chemistry', 'voltaic-lab': 'chemistry',
  'waves-lab': 'physics', 'bounce-lab': 'physics', 'radiation-lab': 'physics', 'circular-lab': 'physics', 'kinematics-lab': 'physics', 'pendulum-lab': 'physics',
  'cell-explorer': 'biology', 'heart-lab': 'biology', 'enzyme-lab': 'biology', 'microscope-lab': 'biology', 'osmosis-lab': 'biology', 'organs-lab': 'biology',
  'pc-builder': 'computing',
  'art-gallery': 'art',
};

const THEMES = {
  art: { wall: '#ece4d8', trim: '#8a5a3c', floor: 'wood', floorA: '#a9805a', floorB: '#9c754f', ceiling: '#f5f2ec', wood: '#8a6a4a', top: '#3b3530', accent: '#a21caf', board: ['colour · line · shape', 'light and shadow', 'foreground · background'] },
  chemistry: { wall: '#dfe7e4', trim: '#5d8a86', floor: 'vinyl', floorA: '#b9c1c4', floorB: '#b2babe', ceiling: '#f2f2ef', wood: '#7f8c8d', top: '#2f3640', accent: '#2d8a83', board: ['2H₂ + O₂ → 2H₂O', 'pH 7 = neutral', 'acid + alkali → salt + water'] },
  physics: { wall: '#e9e3d7', trim: '#5a6a8c', floor: 'wood', floorA: '#b98f62', floorB: '#a87f55', ceiling: '#f4f2ec', wood: '#9a7a55', top: '#3a3f4a', accent: '#3f5fa8', board: ['v = f λ', 'F = m a', 'E = ½ m v²'] },
  biology: { wall: '#e0e9d9', trim: '#5f8a55', floor: 'vinyl', floorA: '#c9c6b8', floorB: '#c2bfb1', ceiling: '#f3f4ee', wood: '#8a9a6e', top: '#34413a', accent: '#4f8a3f', board: ['6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂', 'cell → tissue → organ → system'] },
  computing: { wall: '#e2e5ec', trim: '#4f5d7a', floor: 'carpet', floorA: '#6d7586', floorB: '#687081', ceiling: '#f2f3f5', wood: '#8b93a3', top: '#2c313b', accent: '#4a5fd0', board: ['if temperature > 30:', '    fan.speed = HIGH', '01001000 01101001'] },
};

// The room: x from −5 to 5, z from −5.5 (in front of you, on a computer) to 4.5, 3.2 m high.
const X0 = -5;
const X1 = 5;
const Z0 = -5.5;
const Z1 = 4.5;
const H = 3.2;
const PPM = 128; // canvas pixels per metre for the walls

function canvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = Math.round(w);
  c.height = Math.round(h);
  draw(c.getContext('2d'), c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const shade = (hex, k) => {
  const c = new THREE.Color(hex);
  c.r = Math.min(1, c.r * k); c.g = Math.min(1, c.g * k); c.b = Math.min(1, c.b * k);
  return `#${c.getHexString()}`;
};

// ───────────── painted wall decorations (positions in metres: x from the wall's left end, y from the floor) ─────────────

function rect(g, x, y, w, h, fill) {
  g.fillStyle = fill;
  g.fillRect(x, y, w, h);
}

function frameShadow(g, x, y, w, h) {
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.22)';
  g.shadowBlur = 14;
  g.shadowOffsetY = 5;
  rect(g, x, y, w, h, '#000');
  g.restore();
}

const DECOR = {
  window(g, x, y, w, h) {
    frameShadow(g, x, y, w, h);
    rect(g, x, y, w, h, '#f7f7f5');
    const p = 8;
    const sky = g.createLinearGradient(0, y, 0, y + h);
    sky.addColorStop(0, '#9cc6ec');
    sky.addColorStop(0.65, '#d8ebf8');
    sky.addColorStop(1, '#eef6fb');
    rect(g, x + p, y + p, w - 2 * p, h - 2 * p, sky);
    // distant trees along the bottom of the view
    g.fillStyle = '#9dbb8a';
    for (let i = 0; i < 9; i++) {
      const cx = x + p + ((i + 0.5) / 9) * (w - 2 * p);
      g.beginPath();
      g.ellipse(cx, y + h - p - h * 0.08, w * 0.09, h * 0.12, 0, 0, Math.PI * 2);
      g.fill();
    }
    rect(g, x + p, y + h - p - h * 0.06, w - 2 * p, h * 0.06, '#a9c39a');
    // frame bars and a soft reflection
    rect(g, x + w / 2 - 4, y, 8, h, '#f2f2f0');
    rect(g, x, y + h * 0.36, w, 7, '#f2f2f0');
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.beginPath();
    g.moveTo(x + w * 0.15, y + h - p); g.lineTo(x + w * 0.4, y + p); g.lineTo(x + w * 0.5, y + p); g.lineTo(x + w * 0.25, y + h - p);
    g.fill();
    rect(g, x - 10, y + h, w + 20, 12, '#ececea'); // sill
  },
  whiteboard(g, x, y, w, h, t) {
    frameShadow(g, x, y, w, h);
    rect(g, x, y, w, h, '#b8bcc2');
    rect(g, x + 6, y + 6, w - 12, h - 12, '#fbfbfa');
    const sheen = g.createLinearGradient(x, y, x + w, y + h);
    sheen.addColorStop(0, 'rgba(255,255,255,0)'); sheen.addColorStop(0.5, 'rgba(220,226,235,0.35)'); sheen.addColorStop(1, 'rgba(255,255,255,0)');
    rect(g, x + 6, y + 6, w - 12, h - 12, sheen);
    g.font = `500 ${Math.round(h * 0.11)}px "Segoe Print", "Comic Sans MS", cursive`;
    g.textBaseline = 'top';
    t.board.forEach((line, i) => {
      g.fillStyle = i % 2 ? '#c0392b' : '#1f4fa8';
      g.globalAlpha = 0.85;
      g.fillText(line, x + w * 0.06, y + h * (0.12 + i * 0.22));
    });
    g.globalAlpha = 1;
    rect(g, x + w * 0.1, y + h - 4, w * 0.8, 10, '#9ea3aa'); // pen tray
  },
  noticeboard(g, x, y, w, h, t) {
    frameShadow(g, x, y, w, h);
    rect(g, x, y, w, h, '#8a6a48');
    rect(g, x + 6, y + 6, w - 12, h - 12, '#c49a6c');
    const papers = ['#ffffff', '#fff3b0', '#d7ecff', '#ffd9d0', '#e3f5d8', '#ffffff'];
    for (let i = 0; i < 7; i++) {
      const pw = w * (0.18 + (i % 3) * 0.03);
      const ph = h * (0.3 + (i % 2) * 0.08);
      const px = x + 14 + ((i * 0.37) % 1) * (w - pw - 28);
      const py = y + 14 + ((i * 0.53) % 1) * (h - ph - 28);
      g.save();
      g.translate(px + pw / 2, py + ph / 2);
      g.rotate(((i % 3) - 1) * 0.04);
      g.shadowColor = 'rgba(0,0,0,0.25)'; g.shadowBlur = 4; g.shadowOffsetY = 2;
      rect(g, -pw / 2, -ph / 2, pw, ph, papers[i % papers.length]);
      g.shadowColor = 'transparent';
      g.fillStyle = 'rgba(60,70,90,0.35)';
      for (let l = 0; l < 4; l++) g.fillRect(-pw / 2 + 6, -ph / 2 + 10 + l * ph * 0.18, pw * (0.5 + (l % 2) * 0.3), 3);
      g.fillStyle = t.accent;
      g.beginPath(); g.arc(0, -ph / 2 + 5, 4, 0, Math.PI * 2); g.fill();
      g.restore();
    }
  },
  periodic(g, x, y, w, h) {
    poster(g, x, y, w, h, '#ffffff');
    const cols = 18;
    const cw = (w - 24) / cols;
    const ch = (h - 40) / 7;
    const colour = (c, r) => (c === 0 ? '#f4a261' : c === 1 ? '#f6c56b' : c >= 12 && c <= 16 && r > 0 ? '#8ecae6' : c === 17 ? '#b39ddb' : c > 1 && c < 12 ? '#a8d5ba' : '#90caf9');
    for (let r = 0; r < 7; r++) for (let c = 0; c < cols; c++) {
      if (r === 0 && c > 0 && c < 17) continue;
      if ((r === 1 || r === 2) && c > 1 && c < 12) continue;
      rect(g, x + 12 + c * cw + 1, y + 30 + r * ch + 1, cw - 2, ch - 2, colour(c, r));
    }
    g.fillStyle = '#333'; g.font = `700 ${Math.round(h * 0.07)}px system-ui, sans-serif`; g.textBaseline = 'top';
    g.fillText('The Periodic Table', x + 14, y + 8);
  },
  hazards(g, x, y, w, h) {
    poster(g, x, y, w, h, '#ffffff');
    g.fillStyle = '#333'; g.font = `700 ${Math.round(h * 0.1)}px system-ui, sans-serif`; g.textBaseline = 'top';
    g.fillText('Safety First', x + 14, y + 10);
    for (let i = 0; i < 4; i++) {
      const cx = x + w * (0.16 + i * 0.23);
      const cy = y + h * 0.62;
      const s = Math.min(w * 0.09, h * 0.24);
      g.save(); g.translate(cx, cy); g.rotate(Math.PI / 4);
      rect(g, -s, -s, 2 * s, 2 * s, '#d62828');
      rect(g, -s + 5, -s + 5, 2 * s - 10, 2 * s - 10, '#ffffff');
      g.restore();
      g.fillStyle = '#222';
      g.beginPath(); g.arc(cx, cy, s * 0.35, 0, Math.PI * 2); g.fill();
    }
  },
  spectrum(g, x, y, w, h) {
    poster(g, x, y, w, h, '#1c2340');
    const grd = g.createLinearGradient(x + 12, 0, x + w - 12, 0);
    ['#5b2c83', '#3a3fd1', '#2b9be0', '#38b44a', '#f2d53c', '#f08a24', '#d7263d', '#6b1a1a'].forEach((c, i, a) => grd.addColorStop(i / (a.length - 1), c));
    rect(g, x + 12, y + h * 0.45, w - 24, h * 0.22, grd);
    g.strokeStyle = '#ffffff'; g.lineWidth = 3; g.beginPath();
    for (let i = 0; i <= 200; i++) {
      const px = x + 12 + (i / 200) * (w - 24);
      const f = 40 - 34 * (i / 200);
      g.lineTo(px, y + h * 0.3 + Math.sin((i / 200) * f) * h * 0.08);
    }
    g.stroke();
    g.fillStyle = '#fff'; g.font = `700 ${Math.round(h * 0.1)}px system-ui, sans-serif`; g.textBaseline = 'top';
    g.fillText('The Electromagnetic Spectrum', x + 14, y + 10);
  },
  planets(g, x, y, w, h) {
    poster(g, x, y, w, h, '#0f1630');
    const P = [['#f4b942', 0.16], ['#b0a08a', 0.03], ['#e3c27a', 0.04], ['#3f7fd6', 0.045], ['#c4553a', 0.035], ['#d8b37e', 0.1], ['#e6d29a', 0.085], ['#8fd3e0', 0.06], ['#4a6fe0', 0.06]];
    // sized so the row of planets fits across the poster
    const sum = P.reduce((a, [, r]) => a + 2 * r, 0);
    const k = Math.min(h * 1.4, (w - 20 - w * 0.02 * P.length) / sum);
    let px = x + 10;
    for (const [c, r] of P) {
      const rad = r * k;
      g.fillStyle = c;
      g.beginPath(); g.arc(px + rad, y + h * 0.58, rad, 0, Math.PI * 2); g.fill();
      px += rad * 2 + w * 0.02;
    }
    g.fillStyle = '#fff'; g.font = `700 ${Math.round(h * 0.1)}px system-ui, sans-serif`; g.textBaseline = 'top';
    g.fillText('The Solar System', x + 14, y + 10);
  },
  cell(g, x, y, w, h) {
    poster(g, x, y, w, h, '#ffffff');
    const cx = x + w / 2;
    const cy = y + h * 0.58;
    g.fillStyle = '#f7c9c9'; g.strokeStyle = '#c96a6a'; g.lineWidth = 4;
    g.beginPath(); g.ellipse(cx, cy, w * 0.36, h * 0.34, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = '#9b7fd1'; g.beginPath(); g.arc(cx - w * 0.05, cy, h * 0.11, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f08a3c';
    for (let i = 0; i < 5; i++) { g.beginPath(); g.ellipse(cx + Math.cos(i * 1.3) * w * 0.22, cy + Math.sin(i * 1.3) * h * 0.2, w * 0.04, h * 0.025, i, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#333'; g.font = `700 ${Math.round(h * 0.1)}px system-ui, sans-serif`; g.textBaseline = 'top';
    g.fillText('The Animal Cell', x + 14, y + 10);
  },
  dna(g, x, y, w, h) {
    poster(g, x, y, w, h, '#ffffff');
    const cx = x + w / 2;
    for (let i = 0; i < 28; i++) {
      const t = i / 27;
      const py = y + h * 0.18 + t * h * 0.74;
      const s = Math.sin(t * Math.PI * 4) * w * 0.28;
      g.strokeStyle = ['#e76f51', '#2a9d8f', '#e9c46a', '#457b9d'][i % 4]; g.lineWidth = 4;
      g.beginPath(); g.moveTo(cx - s, py); g.lineTo(cx + s, py); g.stroke();
      g.fillStyle = '#264653';
      g.beginPath(); g.arc(cx - s, py, 5, 0, Math.PI * 2); g.arc(cx + s, py, 5, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = '#333'; g.font = `700 ${Math.round(h * 0.08)}px system-ui, sans-serif`; g.textBaseline = 'top';
    g.fillText('DNA', x + 14, y + 10);
  },
  circuit(g, x, y, w, h) {
    poster(g, x, y, w, h, '#1d4d3a');
    g.strokeStyle = '#d9b85c'; g.lineWidth = 3;
    for (let i = 0; i < 16; i++) {
      const sx = x + 14 + ((i * 0.618) % 1) * (w - 28);
      const sy = y + h * 0.25 + ((i * 0.381) % 1) * (h * 0.65);
      g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + w * 0.12, sy); g.lineTo(sx + w * 0.12, sy + h * 0.1); g.stroke();
      g.fillStyle = '#d9b85c'; g.beginPath(); g.arc(sx, sy, 5, 0, Math.PI * 2); g.fill();
    }
    rect(g, x + w * 0.38, y + h * 0.45, w * 0.24, h * 0.25, '#222');
    g.fillStyle = '#fff'; g.font = `700 ${Math.round(h * 0.1)}px system-ui, sans-serif`; g.textBaseline = 'top';
    g.fillText('Inside a Computer', x + 14, y + 10);
  },
  binary(g, x, y, w, h) {
    poster(g, x, y, w, h, '#151a2c');
    g.font = `600 ${Math.round(h * 0.075)}px ui-monospace, Consolas, monospace`; g.textBaseline = 'top';
    for (let r = 0; r < 8; r++) {
      g.fillStyle = r % 3 ? '#5ad1a0' : '#8fb2ff';
      let s = '';
      for (let c = 0; c < 16; c++) s += ((r * 7 + c * 3) % 5) > 1 ? '1' : '0';
      g.fillText(s, x + 14, y + h * 0.14 + r * h * 0.1);
    }
  },
  clock(g, x, y, w) {
    const r = w / 2;
    const cx = x + r;
    const cy = y + r;
    g.save(); g.shadowColor = 'rgba(0,0,0,0.25)'; g.shadowBlur = 10; g.shadowOffsetY = 4;
    g.fillStyle = '#2b2f36'; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill(); g.restore();
    g.fillStyle = '#fbfbf8'; g.beginPath(); g.arc(cx, cy, r - 6, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#333'; g.lineWidth = 3;
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; g.beginPath(); g.moveTo(cx + Math.cos(a) * r * 0.78, cy + Math.sin(a) * r * 0.78); g.lineTo(cx + Math.cos(a) * r * 0.88, cy + Math.sin(a) * r * 0.88); g.stroke(); }
    g.lineWidth = 5; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + r * 0.45, cy - r * 0.2); g.stroke();
    g.lineWidth = 3; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx - r * 0.1, cy - r * 0.7); g.stroke();
  },
  door(g, x, y, w, h, t) {
    rect(g, x - 8, y - 8, w + 16, h + 8, shade(t.trim, 1.1));
    const wood = g.createLinearGradient(x, 0, x + w, 0);
    wood.addColorStop(0, shade(t.wood, 0.95)); wood.addColorStop(1, shade(t.wood, 1.1));
    rect(g, x, y, w, h, wood);
    rect(g, x + w * 0.3, y + h * 0.12, w * 0.4, h * 0.28, '#cfe3ef'); // vision panel
    rect(g, x + w * 0.82, y + h * 0.52, w * 0.1, 6, '#c9ccd2'); // handle
  },
};

function poster(g, x, y, w, h, bg) {
  frameShadow(g, x, y, w, h);
  rect(g, x, y, w, h, '#ffffff');
  rect(g, x + 4, y + 4, w - 8, h - 8, bg);
}

/** One wall: the paint (with its painted-in shading), skirting, a rail, and its decorations. */
function wallTexture(t, length, items) {
  return canvas(length * PPM, H * PPM, (g, W, Hp) => {
    const top = g.createLinearGradient(0, 0, 0, Hp);
    top.addColorStop(0, shade(t.wall, 0.93)); // under the ceiling: a little darker
    top.addColorStop(0.15, shade(t.wall, 1.02));
    top.addColorStop(0.75, t.wall);
    top.addColorStop(1, shade(t.wall, 0.86)); // near the floor
    rect(g, 0, 0, W, Hp, top);
    // corners: darker where two walls meet
    for (const [x0, x1] of [[0, 0.7 * PPM], [W, W - 0.7 * PPM]]) {
      const c = g.createLinearGradient(x0, 0, x1, 0);
      c.addColorStop(0, 'rgba(0,0,0,0.16)'); c.addColorStop(1, 'rgba(0,0,0,0)');
      rect(g, Math.min(x0, x1), 0, Math.abs(x1 - x0), Hp, c);
    }
    // a fine paint texture
    for (let i = 0; i < W * Hp * 0.004; i++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},0.025)`;
      g.fillRect(Math.random() * W, Math.random() * Hp, 2, 2);
    }
    // dado rail at 1 m and skirting board
    const yOf = (m) => Hp - m * PPM;
    rect(g, 0, yOf(1.02), W, 0.035 * PPM, shade(t.wall, 0.82));
    rect(g, 0, yOf(1.02) + 0.035 * PPM, W, 3, 'rgba(0,0,0,0.12)');
    rect(g, 0, yOf(0.11), W, 0.11 * PPM, t.trim);
    rect(g, 0, yOf(0.11), W, 3, shade(t.trim, 1.25));
    for (const [kind, x, y, w, h] of items) {
      DECOR[kind](g, x * PPM, yOf(y + h), w * PPM, h * PPM, t);
    }
  });
}

function floorTexture(t) {
  const tex = canvas(1024, 1024, (g, W) => {
    if (t.floor === 'wood') {
      const rows = 8; // planks 0.25 m wide over 2 m
      for (let r = 0; r < rows; r++) {
        let x = -((r * 397) % 600);
        while (x < W) {
          const len = 380 + ((x * 7 + r * 131) % 260);
          const k = 0.92 + ((r * 13 + Math.floor(x)) % 9) * 0.02;
          rect(g, x, r * (W / rows), len, W / rows, shade(r % 2 ? t.floorA : t.floorB, k));
          g.strokeStyle = 'rgba(60,35,15,0.10)'; g.lineWidth = 1;
          for (let s = 0; s < 6; s++) { g.beginPath(); const yy = r * (W / rows) + 8 + s * 20; g.moveTo(x, yy); g.bezierCurveTo(x + len * 0.3, yy + 6, x + len * 0.7, yy - 6, x + len, yy); g.stroke(); }
          rect(g, x, r * (W / rows), 3, W / rows, 'rgba(50,30,10,0.35)');
          x += len;
        }
        rect(g, 0, r * (W / rows), W, 3, 'rgba(50,30,10,0.4)');
      }
    } else if (t.floor === 'carpet') {
      const n = 4; // 0.5 m carpet tiles over 2 m
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        rect(g, i * W / n, j * W / n, W / n, W / n, (i + j) % 2 ? t.floorA : t.floorB);
      }
      for (let k = 0; k < 60000; k++) {
        g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},0.06)`;
        g.fillRect(Math.random() * W, Math.random() * W, 2, 2);
      }
      g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 2;
      for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * W / n, 0); g.lineTo(i * W / n, W); g.moveTo(0, i * W / n); g.lineTo(W, i * W / n); g.stroke(); }
    } else {
      const n = 4; // 0.5 m vinyl tiles over 2 m
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        rect(g, i * W / n, j * W / n, W / n, W / n, shade((i + j) % 2 ? t.floorA : t.floorB, 0.98 + ((i * 3 + j * 5) % 4) * 0.015));
      }
      for (let k = 0; k < 30000; k++) {
        g.fillStyle = `rgba(${Math.random() < 0.5 ? '40,40,40' : '255,255,255'},${0.08 + Math.random() * 0.1})`;
        g.fillRect(Math.random() * W, Math.random() * W, 2 + Math.random() * 2, 2);
      }
      g.strokeStyle = 'rgba(0,0,0,0.10)'; g.lineWidth = 2;
      for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * W / n, 0); g.lineTo(i * W / n, W); g.moveTo(0, i * W / n); g.lineTo(W, i * W / n); g.stroke(); }
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set((X1 - X0) / 2, (Z1 - Z0) / 2);
  return tex;
}

function ceilingTexture(t) {
  const W = (X1 - X0) * 96;
  const D = (Z1 - Z0) * 96;
  return canvas(W, D, (g) => {
    rect(g, 0, 0, W, D, t.ceiling);
    g.strokeStyle = 'rgba(0,0,0,0.08)'; g.lineWidth = 3;
    for (let x = 0; x <= W; x += 0.6 * 96) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, D); g.stroke(); }
    for (let y = 0; y <= D; y += 0.6 * 96) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    // light panels, glowing softly
    for (const lx of [2.4, 5, 7.6]) for (const lz of [2.4, 5, 7.6]) {
      const x = lx * 96 - 0.6 * 96;
      const y = lz * 96 - 0.3 * 96;
      g.save(); g.shadowColor = 'rgba(255,255,240,0.9)'; g.shadowBlur = 40;
      rect(g, x, y, 1.2 * 96, 0.6 * 96, '#ffffff'); g.restore();
      rect(g, x, y, 1.2 * 96, 0.6 * 96, '#fffef8');
    }
  });
}

// ───────────── furniture: boxes with painted-in shading, all merged into one shape ─────────────

function box(list, w, h, d, x, y, z, color, rotY = 0) {
  const geo = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  const c = new THREE.Color(color);
  const n = geo.attributes.normal;
  const colors = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) {
    const ny = n.getY(i);
    const nz = n.getZ(i);
    const k = ny > 0.5 ? 1.0 : ny < -0.5 ? 0.45 : Math.abs(nz) > 0.5 ? 0.86 : 0.74; // light from above
    colors.set([c.r * k, c.g * k, c.b * k], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.deleteAttribute('uv');
  geo.rotateY(rotY);
  geo.translate(x, y, z);
  list.push(geo);
}

/** A run of lab benches: cupboard base, worktop, and handles. Along x (rotY 0) or along z (rotY π/2). */
function benchRun(list, t, len, x, z, rotY, depth = 0.75) {
  const along = rotY ? [0, 1] : [1, 0];
  box(list, rotY ? depth : len, 0.86, rotY ? len : depth, x, 0.43, z, shade(t.wood, 1.05));
  box(list, rotY ? depth + 0.04 : len + 0.04, 0.04, rotY ? len + 0.04 : depth + 0.04, x, 0.88, z, t.top);
  const doors = Math.floor(len / 0.6);
  for (let i = 0; i < doors; i++) {
    const o = -len / 2 + (i + 0.5) * (len / doors);
    const fx = x + along[0] * o + (rotY ? (x < 0 ? depth / 2 + 0.005 : -depth / 2 - 0.005) : 0);
    const fz = z + along[1] * o + (rotY ? 0 : (z < 0 ? depth / 2 + 0.005 : -depth / 2 - 0.005));
    box(list, rotY ? 0.01 : 0.12, 0.02, rotY ? 0.12 : 0.01, fx, 0.74, fz, '#c9ccd2');
  }
}

function furniture(subject, t) {
  const list = [];
  // benches under the windows (left wall) and along the right wall
  benchRun(list, t, 6, X0 + 0.38, -1.2, Math.PI / 2);
  benchRun(list, t, 4.2, X1 - 0.38, 0.2, Math.PI / 2);
  // tall cupboards at the back of the right wall
  box(list, 0.6, 2.1, 1.8, X1 - 0.3, 1.05, -4.3, shade(t.wood, 0.95));
  box(list, 0.01, 1.9, 0.02, X1 - 0.605, 1.05, -4.3, '#5a5e66');
  if (subject === 'chemistry') {
    // a fume cupboard: cabinet, glass front, and a hood
    box(list, 0.8, 0.9, 1.4, X1 - 0.4, 0.45, -2.65, shade(t.wood, 1.0));
    box(list, 0.8, 1.2, 1.4, X1 - 0.4, 1.5, -2.65, '#dfe4e8');
    box(list, 0.02, 0.9, 1.25, X1 - 0.81, 1.45, -2.65, '#8fb3c7');
    box(list, 0.8, 0.25, 1.4, X1 - 0.4, 2.25, -2.65, '#cdd3d8');
    // bottles along the window bench
    for (let i = 0; i < 9; i++) box(list, 0.07, 0.16 + (i % 3) * 0.05, 0.07, X0 + 0.3, 0.98 + (i % 3) * 0.025, -3.5 + i * 0.35, ['#b5651d', '#4f7cac', '#e9e9e9'][i % 3]);
  } else if (subject === 'physics') {
    // a ramp and a trolley on the window bench, boxes of kit on the right bench
    box(list, 0.3, 0.03, 1.4, X0 + 0.38, 1.05, -2.5, '#c9a46a', 0);
    box(list, 0.12, 0.08, 0.2, X0 + 0.38, 1.12, -2.3, '#c0392b');
    for (let i = 0; i < 4; i++) box(list, 0.4, 0.22, 0.3, X1 - 0.4, 1.01, -1.2 + i * 0.6, ['#3f5fa8', '#e0b13c', '#3f5fa8', '#7f8c8d'][i]);
  } else if (subject === 'biology') {
    // plants on the window bench, a fish tank on the right
    for (let i = 0; i < 6; i++) {
      const z = -3.8 + i * 0.95;
      box(list, 0.18, 0.16, 0.18, X0 + 0.32, 0.98, z, '#b5653a');
      for (let k = 0; k < 4; k++) box(list, 0.2 - k * 0.03, 0.1, 0.2 - k * 0.03, X0 + 0.32, 1.12 + k * 0.08, z, shade('#5f9a4a', 0.9 + k * 0.06), k * 0.5);
    }
    box(list, 0.45, 0.4, 1.0, X1 - 0.4, 1.1, 0.8, '#7fb6d6');
    box(list, 0.47, 0.03, 1.02, X1 - 0.4, 1.31, 0.8, '#3a3f4a');
  } else if (subject === 'computing') {
    // monitors and towers along both benches
    for (const [bx, n, z0] of [[X0 + 0.45, 7, -3.9], [X1 - 0.45, 5, -1.7]]) {
      for (let i = 0; i < n; i++) {
        const z = z0 + i * 0.85;
        const face = bx < 0 ? 1 : -1;
        box(list, 0.04, 0.32, 0.52, bx + face * 0.05, 1.1, z, '#1d2027');
        box(list, 0.005, 0.28, 0.48, bx + face * 0.073, 1.1, z, '#3a4f7a');
        box(list, 0.12, 0.02, 0.2, bx - face * 0.02, 0.91, z, '#2a2d33');
        box(list, 0.05, 0.12, 0.05, bx, 0.96, z, '#2a2d33');
      }
    }
  }
  const geo = mergeGeometries(list);
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true }));
}

/** Darker near the walls and under the benches: painted-in shadow across the floor. */
function floorShading(geo) {
  const p = geo.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const d = Math.min(x - X0, X1 - x, z - Z0, Z1 - z);
    const bench = (x < X0 + 0.9 || x > X1 - 0.9) ? 0.12 : 0;
    const k = 1 - 0.3 * Math.max(0, 1 - d / 1.4) ** 2 - bench * Math.max(0, 1 - d / 0.9);
    col.set([k, k, k], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

export class Classroom {
  constructor(app, subject) {
    this.app = app;
    this.subject = subject;
    const t = THEMES[subject];
    this.group = new THREE.Group();
    this.group.name = 'classroom';
    this.ar = false;
    this.hidden = false;
    const basic = (map) => new THREE.MeshBasicMaterial({ map, side: THREE.FrontSide });
    const L = X1 - X0;
    const D = Z1 - Z0;

    // floor (slightly below 0, so things standing on the real floor never flicker against it)
    const fg = new THREE.PlaneGeometry(L, D, 40, 40).rotateX(-Math.PI / 2).translate((X0 + X1) / 2, -0.004, (Z0 + Z1) / 2);
    floorShading(fg);
    const fm = basic(floorTexture(t));
    fm.vertexColors = true;
    this.group.add(new THREE.Mesh(fg, fm));

    // walls, facing in: front (ahead of you on a computer), left (windows), right, back (behind you, with the door)
    const wall = (len, items, pos, rotY) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, H), basic(wallTexture(t, len, items)));
      m.position.copy(pos);
      m.rotation.y = rotY;
      this.group.add(m);
    };
    const poster = { chemistry: ['periodic', 'hazards'], physics: ['spectrum', 'planets'], biology: ['cell', 'dna'], computing: ['circuit', 'binary'], art: ['spectrum', 'noticeboard'] }[subject];
    wall(L, [['whiteboard', L / 2 - 1.6, 0.95, 3.2, 1.2], [poster[0], 0.9, 1.15, 1.5, 0.95], ['clock', L / 2 - 0.2, 2.4, 0.4, 0.4], [poster[1], L - 2.4, 1.15, 1.5, 0.95]], new THREE.Vector3(0, H / 2, Z0), 0);
    wall(D, [['window', 1.4, 1.0, 1.7, 1.75], ['window', 4.15, 1.0, 1.7, 1.75], ['window', 6.9, 1.0, 1.7, 1.75]], new THREE.Vector3(X0, H / 2, (Z0 + Z1) / 2), Math.PI / 2);
    wall(D, [['noticeboard', 5.6, 1.2, 2.2, 1.1]], new THREE.Vector3(X1, H / 2, (Z0 + Z1) / 2), -Math.PI / 2);
    wall(L, [['door', L - 2.2, 0, 1.0, 2.1], ['noticeboard', 1.5, 1.2, 2.4, 1.1], [poster[0], 4.6, 1.15, 1.4, 0.9]], new THREE.Vector3(0, H / 2, Z1), Math.PI);

    // ceiling
    this.ceiling = new THREE.Mesh(new THREE.PlaneGeometry(L, D).rotateX(Math.PI / 2).translate((X0 + X1) / 2, H, (Z0 + Z1) / 2), basic(ceilingTexture(t)));
    this.group.add(this.ceiling);

    this.group.add(furniture(subject, t));

    // a soft shadow on the floor under the lesson, so the bench does not seem to float
    const sh = canvas(256, 256, (g, W) => {
      const r = g.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2);
      r.addColorStop(0, 'rgba(0,0,0,0.32)'); r.addColorStop(0.6, 'rgba(0,0,0,0.14)'); r.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = r; g.fillRect(0, 0, W, W);
    });
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: sh, transparent: true, depthWrite: false }));
    this.blob.renderOrder = -1;
    this.group.add(this.blob);

    for (const o of this.group.children) {
      o.raycast = () => {};
      o.matrixAutoUpdate = false;
      o.updateMatrix();
    }
    this.blob.matrixAutoUpdate = true;
    app.scene.add(this.group);
  }

  /** The ceiling can open (the Kinematics Lab's life-size tower rises through it). */
  setCeiling(on) {
    this.ceiling.visible = on;
    // open to a daytime sky (in mixed reality there is no background to change)
    if (this.app.scene.background) this.app.scene.background = on ? this.app.background : (this.sky ??= new THREE.Color(0xa9cdee));
  }

  /** In mixed reality the real room shows instead. */
  setAR(ar) {
    this.ar = ar;
    this.apply();
  }

  /** A lesson can hide the room for a moment (e.g. a view that reaches far beyond the walls). */
  setHidden(hidden) {
    this.hidden = hidden;
    this.apply();
  }

  apply() {
    this.group.visible = !this.ar && !this.hidden;
  }

  update() {
    if (!this.group.visible) return;
    const lab = this.app.lab;
    this.blob.position.set(lab.position.x, 0.002, lab.position.z);
    this.blob.rotation.y = lab.rotation.y;
    const s = lab.scale.x;
    this.blob.scale.set(1.7 * s, 1, 1.1 * s);
  }
}

/** The room for this lesson, or null (switched off, or a lesson with a place of its own). */
export function makeClassroom(app) {
  const subject = SUBJECT[app.lessonId];
  if (!ROOMS.enabled || !subject || new URLSearchParams(location.search).has('noroom')) return null;
  return new Classroom(app, subject);
}
