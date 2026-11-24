import * as THREE from 'three';

// Smoother starts and ends for every lesson:
//  • On the start screen, a thin progress bar ("Preparing the Lesson … 3 of 5") follows the lesson's models and
//    pictures (everything loaded through three.js), then fades away; the 3D view behind fades in once it is ready.
//  • Entering the headset view, the lesson fades in from dark (a small ring turns while anything is still loading).
//  • Leaving for the lessons page, it fades out first.
// Hintze Hall and Reef Dive keep their own starts (they are left out of polish work).
//
// One switch turns all of this off: LOADING.enabled = false (or ?nofade in a lesson's address).

export const LOADING = { enabled: true };
const SKIP = ['hintze-hall', 'reef-dive'];
const MAX_WAIT_MS = 20000; // never hold anything back longer than this

export function makeLoading(app) {
  const lesson = (location.pathname.match(/lessons\/([^/]+)/) || [])[1];
  if (!LOADING.enabled || new URLSearchParams(location.search).has('nofade') || SKIP.includes(lesson)) return null;
  return new Loading(app);
}

class Loading {
  constructor(app) {
    this.app = app;
    this.total = 0;
    this.done = 0;
    this.ready = false;
    this.t0 = performance.now();
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // follow everything loaded through three.js (models, textures, files)
    const m = THREE.DefaultLoadingManager;
    const prev = { start: m.onStart, progress: m.onProgress, load: m.onLoad, error: m.onError };
    m.onStart = (url, loaded, total) => { this.count(loaded, total); prev.start?.(url, loaded, total); };
    m.onProgress = (url, loaded, total) => { this.count(loaded, total); prev.progress?.(url, loaded, total); };
    m.onLoad = () => { this.count(this.total, this.total); prev.load?.(); };
    m.onError = (url) => { this.count(this.done + 1, this.total); prev.error?.(url); };

    // the 3D view on screen fades in when ready
    const canvas = app.renderer.domElement;
    if (!this.reduced) {
      canvas.style.opacity = '0';
      canvas.style.transition = 'opacity 0.7s ease';
    }
    // the progress bar, under the start buttons
    const overlay = document.getElementById('overlay');
    const after = overlay?.querySelector('.buttons');
    if (after) {
      this.bar = document.createElement('div');
      this.bar.className = 'loadbar';
      this.bar.setAttribute('role', 'status');
      this.bar.innerHTML = '<div class="track"><span></span></div><small>Preparing the Lesson</small>';
      after.after(this.bar);
      this.draw();
    }
    // the headset fade: a dark shell round the head, and a turning ring while anything is still loading
    this.shell = new THREE.Mesh(
      new THREE.SphereGeometry(0.4, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0x05070c, side: THREE.BackSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false }),
    );
    this.shell.renderOrder = 9999;
    this.shell.visible = false;
    this.shell.frustumCulled = false;
    this.spinner = new THREE.Mesh(
      new THREE.RingGeometry(0.018, 0.022, 40, 1, 0, Math.PI * 1.4),
      new THREE.MeshBasicMaterial({ color: 0xb9c4ff, transparent: true, opacity: 0, depthTest: false, depthWrite: false }),
    );
    this.spinner.renderOrder = 10000;
    this.spinner.position.set(0, 0, -0.35);
    this.shell.add(this.spinner);
    app.scene.add(this.shell);
    this.fade = 0; // 1 = fully dark
    this.fadeTo = 0;
    this.after = null;
  }

  count(done, total) {
    this.total = Math.max(this.total, total);
    this.done = Math.max(this.done, Math.min(done, this.total));
    this.draw();
  }

  get pending() {
    return this.done < this.total;
  }

  draw() {
    if (!this.bar || this.ready) return;
    this.bar.classList.toggle('busy', !this.total); // nothing to count (models built in code): the bar glides
    if (!this.total) return;
    const pct = Math.round((this.done / this.total) * 100);
    this.bar.querySelector('span').style.width = `${Math.max(8, pct)}%`;
    this.bar.querySelector('small').textContent = this.total > 1 ? `Preparing the Lesson · ${this.done} of ${this.total}` : 'Preparing the Lesson';
  }

  /** The lesson has been built (LessonApp.start): it is ready once nothing is loading and a frame has been drawn. */
  started() {
    this.startedAt = performance.now();
  }

  markReady() {
    if (this.ready) return;
    this.ready = true;
    this.app.renderer.domElement.style.opacity = '1';
    if (this.bar) {
      this.bar.querySelector('span').style.width = '100%';
      this.bar.querySelector('small').textContent = 'Ready';
      this.bar.classList.remove('busy');
      this.bar.classList.add('done');
      setTimeout(() => this.bar?.remove(), 1600);
    }
  }

  /** Entering the headset view: start dark, fade in once ready. */
  enterXR() {
    if (this.reduced) return;
    this.fade = 1;
    this.fadeTo = 0;
  }

  /** Fade to dark, then do something (e.g. leave for the lessons page). */
  fadeOut(then) {
    if (this.reduced) return then();
    this.fadeTo = 1;
    this.after = then;
    this.app.renderer.domElement.style.transition = 'opacity 0.3s ease';
    this.app.renderer.domElement.style.opacity = '0';
    setTimeout(() => this.finish(), 450); // (in case no frame is drawn meanwhile)
  }

  finish() {
    const f = this.after;
    this.after = null;
    f?.();
  }

  update(dt) {
    const now = performance.now();
    if (!this.ready && this.startedAt && ((!this.pending && now - this.startedAt > 250) || now - this.t0 > MAX_WAIT_MS)) this.markReady();
    // in the headset: hold dark while still loading, then fade
    const holding = !this.ready && this.fadeTo === 0;
    const target = holding ? 1 : this.fadeTo;
    const speed = target > this.fade ? 1 / 0.3 : 1 / 0.6;
    this.fade = target > this.fade ? Math.min(target, this.fade + dt * speed) : Math.max(target, this.fade - dt * speed);
    const xr = this.app.renderer.xr.isPresenting;
    this.shell.visible = xr && this.fade > 0.001;
    if (this.shell.visible) {
      const cam = this.app.viewCamera();
      cam.getWorldPosition(this.shell.position);
      cam.getWorldQuaternion(this.shell.quaternion);
      this.shell.material.opacity = this.fade;
      this.spinner.material.opacity = holding ? 0.9 : 0;
      this.spinner.rotation.z -= dt * 5;
    }
    if (this.after && this.fade >= 0.999) this.finish();
  }
}
