import * as THREE from 'three';

// Keeps lessons smooth on a headset.
//  • A frames-per-second counter, in the bottom-left corner of your view: shown to the teacher in a shared
//    session (the admin) while in the headset, or to anyone who opens a lesson with ?fps in its address
//    (e.g. lesson/?fps), on a computer too.
//  • A safety net: in a headset, if a lesson cannot keep up with the headset's frame rate for a few seconds, it
//    switches off its heaviest effects, one step at a time, on that headset only (computers keep the full look):
//      step 1: reflections off (scene environment) and the strongest fixed foveation (fewer pixels at the edges)
//      step 2: the glossy clear coat and sheen off every material
//    A lesson can do more of its own at each step with onLite(level).
//  • Light for everyone: the teacher can put every device in the class on the lighter look from the start
//    (Teacher menu → Students → Effects), for older headsets. Anyone can also open a lesson with ?light.
// Nothing is saved: the next session starts with the full look again (unless the teacher chose Light).

const WARMUP = 4; // s after entering before judging (loading, placing the lab)
const SLOW_FOR = 3; // s of slow frames before stepping down
const COOLDOWN = 5; // s after a step before judging again

export class PerfGuard {
  constructor(app) {
    this.app = app;
    this.level = 0;
    this.frames = 0;
    this.acc = 0;
    this.fps = 0;
    this.slow = 0;
    this.wait = WARMUP;
    this.last = performance.now();
    this.forced = new URLSearchParams(location.search).has('fps');
    this.saved = null;
    this.mode = new URLSearchParams(location.search).has('light') ? 'light' : 'auto'; // 'auto' | 'light'

    // the counter: a small sprite that follows your view
    this.canvas = document.createElement('canvas');
    this.canvas.width = 256;
    this.canvas.height = 96;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, depthTest: false, depthWrite: false, toneMapped: false, transparent: true }));
    this.sprite.renderOrder = 999;
    this.sprite.raycast = () => {};
    this.sprite.visible = false;
    if (!app.camera.parent) app.scene.add(app.camera);
    app.camera.add(this.sprite);
  }

  get target() {
    return this.app.renderer.xr.getSession?.()?.frameRate || 72;
  }

  get show() {
    return this.forced || (!!this.app.isAdmin && !!this.app.presenting);
  }

  /** 'auto' (the safety net decides, headsets only) or 'light' (the lighter look everywhere, now). */
  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === 'light') while (this.level < 2) this.stepDown();
    else if (!this.app.presenting) { this.restore(); this.level = 0; }
    this.draw();
  }

  /** Call when a headset session starts / ends. */
  start() {
    if (this.mode === 'light') return;
    this.level = 0;
    this.slow = 0;
    this.wait = WARMUP;
  }

  end() {
    if (this.mode === 'light') return;
    this.restore();
    this.level = 0;
  }

  /** Every frame. */
  update() {
    const now = performance.now();
    const dt = (now - this.last) / 1000;
    this.last = now;
    if (dt <= 0 || dt > 1) return;
    this.frames++;
    this.acc += dt;
    if (this.acc < 1) return;
    // once a second
    this.fps = this.frames / this.acc;
    this.frames = 0;
    this.acc = 0;
    if (this.mode === 'light') {
      if (this.level < 2) while (this.level < 2) this.stepDown();
      else this.lighten(); // parts added since (a rebuilt model, a new part) get the lighter look too
    } else if (this.app.presenting) this.judge(1);
    this.draw();
  }

  judge(sec) {
    if (this.wait > 0) {
      this.wait -= sec;
      return;
    }
    const tooSlow = this.fps < this.target * 0.85;
    this.slow = tooSlow ? this.slow + sec : 0;
    if (this.slow >= SLOW_FOR && this.level < 2) {
      this.stepDown();
      this.slow = 0;
      this.wait = COOLDOWN;
    }
  }

  stepDown() {
    const app = this.app;
    this.level++;
    this.saved ??= { env: app.scene.environment, mats: new Map() };
    if (this.level === 1) {
      app.scene.environment = null;
      try { app.renderer.xr.setFoveation(1); } catch { /* not supported */ }
    }
    if (this.level === 2) this.lighten();
    app.onLite?.(this.level);
    console.info(`PerfGuard: ${this.mode === 'light' ? 'light mode' : `${this.fps.toFixed(0)} fps (target ${this.target})`}: lighter effects, step ${this.level}`);
  }

  /** Step 2: the glossy clear coat and sheen off every material in the scene. */
  lighten() {
    this.app.scene.environment = null;
    this.app.scene.traverse((o) => {
      const list = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of list) {
        if (!m.isMeshPhysicalMaterial || this.saved.mats.has(m)) continue;
        this.saved.mats.set(m, { clearcoat: m.clearcoat, sheen: m.sheen });
        m.clearcoat = 0;
        m.sheen = 0;
        m.needsUpdate = true;
      }
    });
  }

  restore() {
    if (!this.saved) return;
    this.app.scene.environment = this.saved.env;
    for (const [m, v] of this.saved.mats) {
      m.clearcoat = v.clearcoat;
      m.sheen = v.sheen;
      m.needsUpdate = true;
    }
    this.saved = null;
    this.app.onLite?.(0);
  }

  draw() {
    this.sprite.visible = this.show;
    if (!this.show) return;
    // bottom-left of the view, near enough to read, small enough not to be in the way
    this.sprite.position.set(-0.13, -0.1, -0.45);
    this.sprite.scale.set(0.08, 0.03, 1);
    const g = this.canvas.getContext('2d');
    const ok = this.fps >= this.target * 0.85;
    g.clearRect(0, 0, 256, 96);
    g.fillStyle = 'rgba(10,14,28,0.78)';
    g.beginPath();
    g.roundRect(4, 4, 248, 88, 18);
    g.fill();
    g.fillStyle = ok ? '#7ee2a8' : '#ff8a5c';
    g.font = '800 46px system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.fillText(`${Math.round(this.fps)} fps`, 20, 40);
    g.fillStyle = '#c8d0e0';
    g.font = '600 20px system-ui, sans-serif';
    g.fillText(this.mode === 'light' ? 'light mode (teacher)' : this.app.presenting ? `target ${this.target}${this.level ? ` · lighter effects ${this.level}` : ''}` : 'on screen', 20, 74);
    this.tex.needsUpdate = true;
  }
}
