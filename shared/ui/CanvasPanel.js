import * as THREE from 'three';

// A flat UI panel drawn on a 2D canvas and shown as a texture in 3D.
// The same panel works with a mouse, touch, XR controllers and hand pinches:
// whatever ray hits it gives us a UV coordinate, which we map to a button.

// The house style (one look for every panel in every lesson). STYLE.enabled = false goes back to the plain
// panels of v2.1: flat background, white hover outline, no fade-in, no tidy-up of button sizes.
export const STYLE = { enabled: true };

export const THEME = {
  bg: 'rgba(14, 18, 32, 0.9)',
  bgTop: 'rgba(30, 37, 66, 0.94)', // the panel's background shades from this at the top…
  bgBottom: 'rgba(11, 14, 27, 0.94)', // …to this at the bottom
  border: 'rgba(124, 140, 255, 0.55)',
  text: '#eef1ff',
  dim: '#a3abd1',
  accent: '#9aa8ff',
  btn: '#252e50',
  btnHover: '#36427a',
  btnActive: '#5b6cff',
  btnDisabled: '#1a2038',
  box: 'rgba(91, 108, 255, 0.14)',
  good: '#7ee2a8',
};

const PRESS_MS = 170; // how long a pressed button shows as pressed
const APPEAR_MS = 220; // how long a panel takes to fade in
let frame = 0; // counts the lesson's frames (panelFrame(), called once a frame by LessonApp)
/** Once a frame: lets panels tell "drawn last frame too" from "hidden until now". */
export const panelFrame = () => frame++;

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
export const font = (size, weight = 400) => `${weight} ${size}px ${FONT}`;

/** House style: one text size for a given button height, the same in every lesson (long labels still shrink to fit). */
const labelSize = (height) => Math.round(Math.min(30, Math.max(18, height * 0.4)));

const SCROLLBAR_W = 58; // width of the scroll buttons (canvas px)

export function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class CanvasPanel {
  /**
   * fit: a minimum height (m) to make the panel shrink to fit its content (never taller than `height`, which
   * is then the most it grows to before it scrolls). Its top edge stays where it is.
   */
  constructor({ width = 0.5, height = 0.75, pxPerMeter = 1500, name = 'panel', fit = 0 } = {}) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(width * pxPerMeter);
    this.canvas.height = Math.round(height * pxPerMeter);
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, toneMapped: false }),
    );
    this.mesh.name = name;
    this.mesh.frustumCulled = false; // (so turning away and back does not count as the panel appearing again)
    this.mesh.userData.panel = this;
    this.buttons = [];
    this.hoverId = null;
    this.builder = null;
    // Scrolling: when the content is taller than the panel, it scrolls (scrollbar with ▲ ▼ on the right).
    this.scroll = 0;
    this.maxScroll = 0;
    this.heightM = height;
    this.fit = fit ? Math.round(fit * pxPerMeter) : 0;
    this.shownPx = this.canvas.height; // how much of the canvas is showing (all of it unless it fits)
    this.onResize = null;
    this.pressed = null; // { id, t }: the button just pressed (drawn pressed in for a moment)
    this.doneAt = 0; // when a task finished: the panel's border glows green for a few seconds
    this.pxPerMeter = pxPerMeter;
    // House style: a panel fades in over a moment whenever it appears (it was hidden, or is new).
    this.seenFrame = -9;
    this.shownAt = 0;
    this.mesh.onBeforeRender = () => {
      if (!STYLE.enabled) return;
      const now = performance.now();
      if (frame - this.seenFrame > 1) this.shownAt = now; // not drawn last frame: it has just appeared
      this.seenFrame = frame;
      const k = Math.min(1, (now - this.shownAt) / APPEAR_MS);
      this.mesh.material.opacity = 1 - (1 - k) ** 3;
    };
  }

  /**
   * Shrink to fit the content from now on (min: the smallest height, m). For panels made with a fixed height
   * whose content is often shorter, which otherwise leaves an empty band at the bottom.
   */
  setFit(min) {
    if (this.fit) return;
    this.fit = Math.round(min * this.pxPerMeter);
    this.redraw();
  }

  /** The panel's height in metres as it is showing now. */
  get shownHeight() {
    return (this.heightM * this.shownPx) / this.canvas.height;
  }

  /** Show only the top `px` of the canvas, keeping the panel's top edge in place. */
  applyFit(px) {
    const H = this.canvas.height;
    const before = this.shownHeight;
    this.shownPx = px;
    const f = px / H;
    this.texture.repeat.set(1, f);
    this.texture.offset.set(0, 1 - f);
    this.mesh.scale.y = f;
    this.mesh.position.y += (before - this.shownHeight) / 2;
    this.onResize?.(this);
  }

  setBuilder(fn) {
    this.builder = fn;
    this.redraw();
  }

  get scrollable() {
    return this.maxScroll > 0;
  }

  /** Scroll by `px` canvas pixels (positive = down). Returns true if it moved. */
  scrollBy(px) {
    const was = this.scroll;
    this.scroll = Math.max(0, Math.min(this.maxScroll, this.scroll + px));
    if (this.scroll === was) return false;
    this.redraw();
    return true;
  }

  redraw() {
    const { ctx, canvas } = this;
    const W = canvas.width;
    const H = this.fit ? this.shownPx : canvas.height;
    ctx.clearRect(0, 0, W, canvas.height);
    roundRect(ctx, 4, 4, W - 8, H - 8, 36);
    if (STYLE.enabled) {
      // shaded from a lighter top to a deeper bottom, with a soft sheen along the top edge
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, THEME.bgTop);
      bg.addColorStop(Math.min(1, 260 / H), 'rgba(18, 23, 42, 0.93)');
      bg.addColorStop(1, THEME.bgBottom);
      ctx.fillStyle = bg;
      ctx.fill();
      const edge = ctx.createLinearGradient(0, 0, 0, H);
      edge.addColorStop(0, 'rgba(150, 165, 255, 0.85)');
      edge.addColorStop(1, 'rgba(110, 125, 240, 0.35)');
      ctx.lineWidth = 4;
      ctx.strokeStyle = edge;
      ctx.stroke();
      ctx.save();
      roundRect(ctx, 10, 10, W - 20, H - 20, 30);
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.fillStyle = THEME.bg;
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = THEME.border;
      ctx.stroke();
    }
    const done = this.doneGlow;
    if (done > 0) {
      ctx.save();
      ctx.globalAlpha = done;
      ctx.lineWidth = 7;
      ctx.strokeStyle = THEME.good;
      ctx.shadowColor = THEME.good;
      ctx.shadowBlur = 18;
      roundRect(ctx, 6, 6, W - 12, H - 12, 34);
      ctx.stroke();
      ctx.restore();
    }
    this.buttons = [];
    if (!this.builder) {
      this.texture.needsUpdate = true;
      return;
    }
    // draw the content shifted up by the scroll amount, clipped to the panel
    ctx.save();
    roundRect(ctx, 6, 6, W - 12, H - 12, 34);
    ctx.clip();
    ctx.translate(0, -this.scroll);
    const ui = new PanelDrawer(this);
    if (this.maxScroll > 0) ui.scrollbarRoom = SCROLLBAR_W; // keep content clear of the scrollbar
    this.builder(ui);
    ctx.restore();
    // how tall was it? (content below the panel's bottom edge needs scrolling)
    const contentH = ui.y + 24;
    if (this.fit) {
      const want = Math.round(Math.max(this.fit, Math.min(canvas.height, contentH + this.scroll)));
      if (Math.abs(want - this.shownPx) > 2) {
        this.applyFit(want);
        this.redraw();
        return;
      }
    }
    const max = Math.max(0, Math.round(contentH - H));
    const needsBar = max > 0;
    if (needsBar !== this.maxScroll > 0 || Math.min(this.scroll, max) !== this.scroll) {
      // first time it overflows (content is re-laid out narrower), or it got shorter: draw again
      this.maxScroll = max;
      this.scroll = Math.min(this.scroll, max);
      this.redraw();
      return;
    }
    this.maxScroll = max;
    if (needsBar) this.drawScrollbar(contentH);
    this.texture.needsUpdate = true;
  }

  drawScrollbar(contentH) {
    const { ctx } = this;
    const W = this.canvas.width;
    const H = this.shownPx;
    const x = W - SCROLLBAR_W - 14;
    const btn = SCROLLBAR_W;
    // soft fade where content continues above / below
    const fade = (y0, y1) => {
      const g = ctx.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, 'rgba(14,18,32,0)');
      g.addColorStop(1, 'rgba(14,18,32,0.95)');
      ctx.fillStyle = g;
      ctx.fillRect(8, Math.min(y0, y1), x - 16, Math.abs(y1 - y0));
    };
    if (this.scroll < this.maxScroll) fade(H - 90, H - 8);
    if (this.scroll > 0) fade(90, 8);
    // track and thumb
    const top = 18 + btn + 10;
    const bottom = H - 18 - btn - 10;
    roundRect(ctx, x + btn / 2 - 6, top, 12, bottom - top, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fill();
    const thumbH = Math.max(50, ((bottom - top) * H) / contentH);
    const thumbY = top + ((bottom - top - thumbH) * this.scroll) / this.maxScroll;
    roundRect(ctx, x + btn / 2 - 6, thumbY, 12, thumbH, 6);
    ctx.fillStyle = THEME.accent;
    ctx.fill();
    // ▲ ▼ buttons (work with every kind of input)
    const page = H * 0.6;
    const drawer = new PanelDrawer(this);
    drawer.fixed = true;
    drawer.button({ id: 'scroll-up', label: '▲', disabled: this.scroll <= 0, onClick: () => this.scrollBy(-page) }, x, 18, btn, btn, 30);
    drawer.button({ id: 'scroll-down', label: '▼', disabled: this.scroll >= this.maxScroll, onClick: () => this.scrollBy(page) }, x, H - 18 - btn, btn, btn, 30);
  }

  buttonAt(uv) {
    const x = uv.x * this.canvas.width;
    const y = (1 - uv.y) * this.shownPx;
    // the scroll buttons stay put; everything else moves with the scroll
    const fixed = this.buttons.find((b) => b.fixed && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    if (fixed) return fixed;
    const cy = y + this.scroll;
    return this.buttons.find((b) => !b.fixed && x >= b.x && x <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) || null;
  }

  setHover(id) {
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.redraw();
  }

  /** Returns true if a button was pressed. */
  click(uv) {
    const b = this.buttonAt(uv);
    if (!b || b.disabled) return false;
    this.pressed = { id: b.id, t: performance.now() };
    b.onClick?.();
    this.redraw();
    clearTimeout(this.pressTimer);
    this.pressTimer = setTimeout(() => { this.pressed = null; this.redraw(); }, PRESS_MS);
    return true;
  }

  /** 0..1: how strongly the "task finished" border glows now (fades over 3 s). */
  get doneGlow() {
    const t = (performance.now() - this.doneAt) / 3000;
    return this.doneAt && t < 1 ? (1 - t) ** 1.5 : 0;
  }

  /** A task finished: glow green around the edge for a few seconds. */
  flashDone() {
    this.doneAt = performance.now();
    clearInterval(this.doneTimer);
    this.doneTimer = setInterval(() => {
      this.redraw();
      if (!this.doneGlow) clearInterval(this.doneTimer);
    }, 80);
  }
}

/** Simple top-to-bottom layout helper handed to panel builders. */
class PanelDrawer {
  constructor(panel) {
    this.panel = panel;
    this.ctx = panel.ctx;
    this.W = panel.canvas.width;
    this.H = panel.canvas.height;
    this.pad = 40;
    this.y = 40;
    this.auto = 0;
    this.scrollbarRoom = 0; // set while the panel scrolls
    this.fixed = false; // buttons that do not scroll (the scrollbar's own)
  }

  get contentWidth() {
    return this.W - this.pad * 2 - this.scrollbarRoom;
  }

  /** x of the right edge of the content. */
  get right() {
    return this.W - this.pad - this.scrollbarRoom;
  }

  gap(px = 16) {
    this.y += px;
  }

  wrap(text, maxWidth) {
    const lines = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        const test = line ? `${line} ${word}` : word;
        if (line && this.ctx.measureText(test).width > maxWidth) {
          lines.push(line);
          line = word;
        } else line = test;
      }
      lines.push(line);
    }
    return lines;
  }

  title(text, { size = 50, color = THEME.text } = {}) {
    this.text(text, { size, weight: 700, color });
  }

  heading(text, { size = 30 } = {}) {
    this.gap(6);
    const y = this.y;
    this.text(text.toUpperCase(), { size, weight: 700, color: THEME.accent });
    if (STYLE.enabled) {
      // a fine rule from the end of the heading to the right edge
      const { ctx } = this;
      ctx.font = font(size, 700);
      const end = this.pad + Math.min(ctx.measureText(text.toUpperCase()).width, this.contentWidth) + 18;
      if (this.y - y < size * 1.5 && end < this.right - 30) {
        const g = ctx.createLinearGradient(end, 0, this.right, 0);
        g.addColorStop(0, 'rgba(154, 168, 255, 0.35)');
        g.addColorStop(1, 'rgba(154, 168, 255, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(end, y + size * 0.55, this.right - end, 2);
      }
    }
    this.gap(2);
  }

  text(str, { size = 30, weight = 400, color = THEME.text, lineHeight = 1.32, x = this.pad, width = this.contentWidth } = {}) {
    const { ctx } = this;
    ctx.font = font(size, weight);
    ctx.fillStyle = color;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    for (const line of this.wrap(str, width)) {
      ctx.fillText(line, x, this.y);
      this.y += size * lineHeight;
    }
  }

  /** Label on the left, value on the right of the same line. */
  kv(label, value, { size = 30, color = THEME.text } = {}) {
    const { ctx } = this;
    ctx.textBaseline = 'top';
    ctx.font = font(size, 400);
    ctx.fillStyle = THEME.dim;
    ctx.textAlign = 'left';
    ctx.fillText(label, this.pad, this.y);
    ctx.font = font(size, 700);
    ctx.fillStyle = color;
    ctx.textAlign = 'right';
    ctx.fillText(String(value), this.right, this.y);
    ctx.textAlign = 'left';
    this.y += size * 1.4;
  }

  /** Text in a tinted rounded box. */
  box(str, { size = 28, color = THEME.text } = {}) {
    const { ctx } = this;
    ctx.font = font(size, 400);
    const inner = this.contentWidth - 48;
    const lines = this.wrap(str, inner);
    const h = lines.length * size * 1.32 + 40;
    roundRect(ctx, this.pad, this.y, this.contentWidth, h, 20);
    ctx.fillStyle = THEME.box;
    ctx.fill();
    if (STYLE.enabled) {
      // an accent stripe down the left edge
      ctx.save();
      ctx.clip();
      ctx.fillStyle = 'rgba(123, 136, 255, 0.7)';
      ctx.fillRect(this.pad, this.y, 6, h);
      ctx.restore();
    }
    const y0 = this.y;
    this.y += 20;
    this.text(str, { size, color, x: this.pad + 24, width: inner });
    this.y = y0 + h + 12;
  }

  button({ id, label, onClick, active = false, disabled = false, color = null }, x, y, w, h, size) {
    const { ctx } = this;
    id = id ?? `auto-${this.auto++}`;
    const hover = this.panel.hoverId === id && !disabled;
    const pressed = this.panel.pressed?.id === id && !disabled;
    // pressed: pushed in a little (2 px lower, a touch smaller and darker)
    const inset = pressed ? 3 : 0;
    x += inset; y += inset + 1; w -= inset * 2; h -= inset * 2;
    if (!disabled && !pressed) {
      // a soft shadow under the button, so it looks pressable
      roundRect(ctx, x, y + 3, w, h, 16);
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fill();
    }
    roundRect(ctx, x, y, w, h, 16);
    ctx.fillStyle = disabled ? THEME.btnDisabled : active ? THEME.btnActive : hover ? THEME.btnHover : (color || THEME.btn);
    if (STYLE.enabled && !disabled && (active || hover)) {
      // lit from within: a soft glow of its own colour around it
      ctx.save();
      ctx.shadowColor = active ? 'rgba(110, 125, 255, 0.75)' : 'rgba(140, 155, 255, 0.45)';
      ctx.shadowBlur = active ? 18 : 12;
      ctx.fill();
      ctx.restore();
    } else ctx.fill();
    if (STYLE.enabled && !disabled && active) {
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, '#7b88ff');
      g.addColorStop(1, '#4b5cf0');
      ctx.fillStyle = g;
      ctx.fill();
    }
    if (!disabled) {
      // light from above: brighter at the top edge
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, pressed ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.12)');
      g.addColorStop(0.5, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fill();
    }
    if (active && !disabled) {
      ctx.save();
      ctx.shadowColor = THEME.btnActive;
      ctx.shadowBlur = 14;
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.stroke();
      ctx.restore();
    }
    if (hover) {
      ctx.lineWidth = STYLE.enabled ? 2.5 : 3;
      ctx.strokeStyle = STYLE.enabled ? 'rgba(255, 255, 255, 0.8)' : '#ffffff';
      ctx.stroke();
    }
    x -= inset; y -= inset + 1; w += inset * 2; h += inset * 2;
    let s = size;
    ctx.font = font(s, 600);
    while (s > 16 && ctx.measureText(label).width > w - 20) {
      s -= 1;
      ctx.font = font(s, 600);
    }
    ctx.fillStyle = disabled ? '#5c6488' : THEME.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2 + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    this.panel.buttons.push({ id, x, y, w, h, onClick, disabled, fixed: this.fixed });
  }

  /**
   * The panel's title with small round icon buttons on the right (e.g. ⚙ settings, × close).
   * icons: [{ id, label, onClick, active }]
   */
  header(text, icons = [], { size = 40 } = {}) {
    const { ctx } = this;
    const d = 64;
    const room = icons.length * (d + 12);
    ctx.font = font(size, 700);
    let s = size;
    while (s > 22 && ctx.measureText(text).width > this.contentWidth - room) ctx.font = font(--s, 700);
    ctx.fillStyle = THEME.text;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(text, this.pad, this.y + d / 2);
    if (STYLE.enabled) {
      // a short accent bar under the title
      const g = ctx.createLinearGradient(this.pad, 0, this.pad + 64, 0);
      g.addColorStop(0, '#7b88ff');
      g.addColorStop(1, 'rgba(123, 136, 255, 0.2)');
      ctx.fillStyle = g;
      roundRect(ctx, this.pad, this.y + d / 2 + s * 0.62, 64, 5, 2.5);
      ctx.fill();
    }
    icons.forEach((ic, i) => {
      const x = this.right - (icons.length - i) * (d + 12) + 12;
      this.button({ ...ic, id: ic.id }, x, this.y, d, d, 34);
    });
    ctx.textBaseline = 'top';
    this.y += d + 14;
  }

  /**
   * A row of tabs: the chosen one is filled, the others outlined. specs: [{ id, label, active, onClick }]
   */
  tabs(specs, { height = 58, size = 22, gap = 8, cols = specs.length } = {}) {
    const { ctx } = this;
    if (STYLE.enabled) size = labelSize(height, size);
    specs.forEach((spec, i) => {
      const { x, y, w } = this.cell(i, specs.length, cols, height, gap);
      if (spec.active) this.button(spec, x, y, w, height, size);
      else {
        const id = spec.id ?? `auto-${this.auto++}`;
        const hover = this.panel.hoverId === id;
        roundRect(ctx, x + 1.5, y + 1.5, w - 3, height - 3, 16);
        ctx.fillStyle = hover ? THEME.btnHover : 'rgba(255,255,255,0.03)';
        ctx.fill();
        ctx.lineWidth = STYLE.enabled ? 2 : 2.5;
        ctx.strokeStyle = hover ? (STYLE.enabled ? 'rgba(255,255,255,0.8)' : '#ffffff') : STYLE.enabled ? 'rgba(124, 140, 255, 0.4)' : THEME.border;
        ctx.stroke();
        let s = size;
        ctx.font = font(s, 600);
        while (s > 15 && ctx.measureText(spec.label).width > w - 16) ctx.font = font(--s, 600);
        ctx.fillStyle = THEME.dim;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(spec.label, x + w / 2, y + height / 2 + 1);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        this.panel.buttons.push({ id, x, y, w, h: height, onClick: spec.onClick, disabled: !!spec.disabled, fixed: this.fixed });
      }
    });
    this.y += Math.ceil(specs.length / cols) * (height + gap) + 6;
  }

  /** A grid of buttons, `cols` per row (defaults to all in one row). */
  buttons(specs, { cols = specs.length, height = 76, size = 30, gap = 14 } = {}) {
    if (STYLE.enabled) size = labelSize(height, size);
    specs.forEach((spec, i) => {
      const { x, y, w } = this.cell(i, specs.length, cols, height, gap);
      this.button(spec, x, y, w, height, size);
    });
    this.y += Math.ceil(specs.length / cols) * (height + gap);
  }

  /**
   * Where the i-th of n buttons goes in a grid of `cols` columns. In the house style a part-filled last row
   * shares out the full width (no lone half-width button with an empty space beside it).
   */
  cell(i, n, cols, height, gap) {
    const row = Math.floor(i / cols);
    const rows = Math.ceil(n / cols);
    const inRow = STYLE.enabled && row === rows - 1 ? n - row * cols : cols;
    const col = i - row * cols;
    const w = (this.contentWidth - gap * (inRow - 1)) / inRow;
    return { x: this.pad + col * (w + gap), y: this.y + row * (height + gap), w };
  }

  /** Horizontal bar with a label and value, e.g. for energy. */
  bar(label, value, max, color, unit = 'kJ') {
    const { ctx } = this;
    ctx.font = font(24, 600);
    ctx.fillStyle = THEME.dim;
    ctx.textBaseline = 'top';
    ctx.fillText(label, this.pad, this.y);
    ctx.textAlign = 'right';
    ctx.fillStyle = THEME.text;
    ctx.fillText(`${Math.round(value)} ${unit}`, this.right, this.y);
    ctx.textAlign = 'left';
    this.y += 32;
    roundRect(ctx, this.pad, this.y, this.contentWidth, 22, 11);
    ctx.fillStyle = THEME.btnDisabled;
    ctx.fill();
    const w = Math.max(0, Math.min(1, value / max)) * this.contentWidth;
    if (w > 4) {
      roundRect(ctx, this.pad, this.y, w, 22, 11);
      ctx.fillStyle = color;
      ctx.fill();
    }
    this.y += 36;
  }

  /** "Protons   [−]  6  [+]" */
  stepper(label, value, { id, onMinus, onPlus, color = THEME.text, size = 34 }) {
    const { ctx } = this;
    const h = 76;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(this.pad + 16, this.y + h / 2, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = font(size, 600);
    ctx.fillStyle = THEME.text;
    ctx.textBaseline = 'middle';
    ctx.fillText(label, this.pad + 46, this.y + h / 2);
    const bw = 110;
    const right = this.right;
    this.button({ id: `${id}-plus`, label: '+', onClick: onPlus }, right - bw, this.y, bw, h, 46);
    ctx.font = font(44, 700);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = THEME.text;
    ctx.fillText(String(value), right - bw - 70, this.y + h / 2);
    ctx.textAlign = 'left';
    this.button({ id: `${id}-minus`, label: '−', onClick: onMinus }, right - bw * 2 - 140, this.y, bw, h, 46);
    ctx.textBaseline = 'top';
    this.y += h + 14;
  }
}
