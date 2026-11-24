import * as THREE from 'three';
import { makeLabel } from './labels.js';
import { sound } from '../util/sound.js';
import { HoverGlow } from './HoverGlow.js';
import { makeHands } from './Hands.js';

// One input layer for everything:
//  • mouse / touch on a normal screen (with OrbitControls)
//  • XR controllers and tracked hands, with a ray or by reaching out and grabbing directly
//  • phone AR screen taps ("transient" input)
//
// Things that can be picked up carry `userData.handler` with:
//   grab(object, mode, worldPos) → { move(worldPos), release(worldPos) } | null   (mode: 'single' | 'group')
//   tap(object)?            — quick press without dragging
//   describe(object)?       — short hover text
//
// The feel is the same in every lesson: whatever you are about to grab glows softly (and the controller gives a
// tiny tick when you reach it), picking up and putting down make a soft sound (unless the lesson makes its own),
// menu buttons tap, and things that are put somewhere ease into place instead of jumping there.
// Bare hands get extra help (Hands.js): drawn hands in VR, touch-to-press buttons, a pinch ring, fist grabs,
// a wrist menu, a slightly larger reach, and smoothing of whatever they hold.

const NEAR = 0.035; // reach distance (m) for grabbing directly with a controller
const HAND_NEAR = 0.06; // ... and with a tracked hand (pinching precisely in mid-air is harder)
const TAP_MS = 350;
const DRAG_PX = 24; // canvas pixels a pinch / press must move on a panel before it scrolls instead of clicking

export class Interaction {
  constructor(app) {
    this.app = app;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.mouseInside = false;
    this.mouse = null; // current mouse press
    this.labGrabber = null;
    this.controllers = [];
    this.hands = [];
    this.active = new Map(); // source → { session, handle }
    this.tmp = new THREE.Matrix4();
    this.plane = new THREE.Plane();
    this.hoverLabel = null;
    this.hoverText = '';
    this.glow = new HoverGlow(app.scene);
    this.settling = []; // things easing into the place they were put
    this.reach = new Map(); // controller → what it was last reaching for (for the haptic tick)

    const dom = app.renderer.domElement;
    // Capture phase so OrbitControls does not rotate the view when something is pressed.
    dom.addEventListener('pointerdown', (ev) => this.onPointerDown(ev), { capture: true });
    dom.addEventListener('pointermove', (ev) => this.onPointerMove(ev));
    dom.addEventListener('pointerup', (ev) => this.onPointerUp(ev));
    dom.addEventListener('pointerleave', () => { this.mouseInside = false; });
    // Mouse wheel over a panel scrolls it (instead of zooming the view).
    dom.addEventListener('wheel', (ev) => this.onWheel(ev), { capture: true, passive: false });
    this.lastUpdate = performance.now();

    for (let i = 0; i < 2; i++) this.setupController(i);
    this.handsFx = makeHands(this); // null when switched off (Hands.js)
  }

  // ───────────── picking ─────────────

  get panelMeshes() {
    return this.app.panels.filter((p) => p.mesh.visible).map((p) => p.mesh);
  }

  get targets() {
    return this.app.grabTargets().filter((o) => o.visible && o.userData.handler);
  }

  intersect() {
    const hits = this.raycaster.intersectObjects([...this.panelMeshes, ...this.targets], false);
    const hit = hits[0];
    if (!hit) return null;
    const panel = hit.object.userData.panel;
    return panel
      ? { panel, uv: hit.uv, point: hit.point, distance: hit.distance }
      : { object: hit.object, point: hit.point, distance: hit.distance };
  }

  /**
   * The grabbable your hand is reaching for. Of everything within reach, pick the one whose centre is
   * closest relative to its size — so a small part inside the bounds of a big, hollow one
   * (a mitochondrion beside curved ER sheets) still wins.
   */
  nearest(point, reach = NEAR) {
    let best = null;
    let bestScore = Infinity;
    const c = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (const o of this.targets) {
      if (o.userData.tapOnly) continue;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      o.getWorldScale(s);
      const r = o.geometry.boundingSphere.radius * Math.max(s.x, s.y, s.z);
      c.copy(o.geometry.boundingSphere.center).applyMatrix4(o.matrixWorld);
      const d = c.distanceTo(point);
      if (d - r > reach) continue; // out of reach
      const score = d / Math.max(r, 0.01);
      if (score < bestScore) {
        best = o;
        bestScore = score;
      }
    }
    return best;
  }

  setPointer(ev) {
    const r = this.app.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  }

  castFromScreen() {
    this.raycaster.setFromCamera(this.pointer, this.app.camera);
    return this.intersect();
  }

  castFromController(c) {
    this.tmp.identity().extractRotation(c.matrixWorld);
    this.raycaster.ray.origin.setFromMatrixPosition(c.matrixWorld);
    this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tmp);
    return this.intersect();
  }

  /** Where a hand/controller "is": the pinch point for tracked hands, else the controller tip. */
  sourcePoint(c) {
    const hand = this.hands[this.controllers.indexOf(c)];
    const tip = hand?.joints?.['index-finger-tip'];
    const thumb = hand?.joints?.['thumb-tip'];
    if (c.userData.inputSource?.hand && tip && thumb && tip.visible !== false) {
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      tip.getWorldPosition(a);
      thumb.getWorldPosition(b);
      return a.add(b).multiplyScalar(0.5);
    }
    return new THREE.Vector3().setFromMatrixPosition(c.matrixWorld);
  }

  /** What a controller/hand would act on: something within reach first, then whatever its ray hits. */
  pick(c) {
    const near = this.nearest(this.sourcePoint(c), this.handsFx && c.userData.inputSource?.hand ? HAND_NEAR : NEAR);
    if (near) return { object: near, direct: true };
    return this.castFromController(c);
  }

  // ───────────── grabbing ─────────────

  startGrab(source, object, mode, anchor = null) {
    const handle = new THREE.Object3D();
    object.getWorldPosition(handle.position);
    const world = handle.position.clone();
    const session = object.userData.handler.grab?.(object, mode, world);
    if (!session) return false;
    this.app.scene.add(handle);
    if (source !== 'mouse') (anchor ?? source).attach(handle); // (a fist grab holds on to the wrist)
    this.active.set(source, { session, handle, object, from: world.clone() });
    this.pulse(0.3, 20, source);
    sound.pick();
    this.app.refresh();
    return true;
  }

  endGrab(source) {
    const g = this.active.get(source);
    if (!g) return;
    this.active.delete(source);
    const p = new THREE.Vector3();
    g.handle.getWorldPosition(p);
    g.handle.removeFromParent();
    const before = sound.stamp;
    const held = g.object.getWorldPosition(new THREE.Vector3());
    g.session.release(p);
    if (sound.stamp === before) sound.put(); // the lesson did not make a sound of its own
    this.settle(g.object, held);
    this.app.refresh();
  }

  /**
   * Something was let go and the lesson moved it (snapped into its place, or back to the desk): ease it there
   * from where the hand left it, instead of jumping. Any lesson that moves it again takes over at once.
   */
  settle(object, fromWorld) {
    if (!object.parent) return;
    object.updateWorldMatrix(true, false);
    const to = object.position.clone();
    const from = object.parent.worldToLocal(fromWorld.clone());
    const d = from.distanceTo(to);
    const scale = object.parent.getWorldScale(new THREE.Vector3()).x || 1;
    if (d * scale < 0.004 || d * scale > 0.8) return; // did not move, or went somewhere far (a reset)
    this.settling = this.settling.filter((s) => s.object !== object);
    object.position.copy(from);
    this.settling.push({ object, from, to, t: 0, dur: 0.12 + Math.min(0.2, d * scale * 0.4), last: from.clone() });
  }

  updateSettling(dt) {
    this.settling = this.settling.filter((s) => {
      if (!s.object.position.equals(s.last) || this.isHeld(s.object)) return false; // moved by the lesson / grabbed
      s.t = Math.min(1, s.t + dt / s.dur);
      const k = 1 - (1 - s.t) ** 3; // ease out
      s.object.position.lerpVectors(s.from, s.to, k);
      s.last.copy(s.object.position);
      return s.t < 1;
    });
  }

  isHeld(object) {
    for (const g of this.active.values()) if (g.object === object) return true;
    return false;
  }

  press(hit, controller = null) {
    if (hit.panel.click(hit.uv)) {
      sound.tap();
      this.app.refresh();
      this.pulse(0.4, 25, controller);
    }
  }

  /** Haptic buzz on every connected controller (e.g. when a reaction goes off). */
  pulseAll(intensity = 1, ms = 200) {
    for (const c of this.controllers) c.userData.inputSource?.gamepad?.hapticActuators?.[0]?.pulse?.(intensity, ms);
  }

  /** Haptic buzz on the given source, or on every source holding something. */
  pulse(intensity = 0.5, ms = 30, source = null) {
    const sources = source ? [source] : [...this.active.keys()];
    for (const s of sources) {
      if (s === 'mouse' || !s) continue;
      if (s.userData.inputSource?.hand) this.handsFx?.flash(s); // hands cannot buzz: the pinch ring flashes
      s.userData.inputSource?.gamepad?.hapticActuators?.[0]?.pulse?.(intensity, ms);
    }
  }

  // ───────────── mouse / touch ─────────────

  /** A student while the teacher has paused the class: nothing responds. */
  get blocked() {
    return !!this.app.classTools?.blocked;
  }

  onPointerDown(ev) {
    const { app } = this;
    if (app.renderer.xr.isPresenting || this.blocked) return;
    this.setPointer(ev);
    const hit = this.castFromScreen();
    this.mouse = { x: ev.clientX, y: ev.clientY, t: performance.now(), hit };
    if (!hit) return;
    app.controls.enabled = false;
    if (hit.panel?.scrollable) this.mouse.drag = { panel: hit.panel, v0: hit.uv.y, scroll0: hit.panel.scroll };
    if (hit.object) {
      const mode = ev.shiftKey ? 'group' : 'single';
      if (this.startGrab('mouse', hit.object, mode)) {
        // Drag on a screen-facing plane through the model, so things dropped "onto" it land there.
        const p = new THREE.Vector3();
        if (app.dragPoint) p.copy(app.dragPoint(hit.object)); // (a lesson whose things are all round you)
        else app.lab.getWorldPosition(p);
        const n = new THREE.Vector3();
        app.camera.getWorldDirection(n);
        this.plane.setFromNormalAndCoplanarPoint(n, p);
      }
    }
  }

  onPointerMove(ev) {
    this.setPointer(ev);
    this.mouseInside = ev.pointerType === 'mouse';
    const d = this.mouse?.drag;
    if (d && Math.hypot(ev.clientX - this.mouse.x, ev.clientY - this.mouse.y) > 8) {
      this.raycaster.setFromCamera(this.pointer, this.app.camera);
      this.dragScroll(d);
    }
    const g = this.active.get('mouse');
    if (g) {
      this.raycaster.setFromCamera(this.pointer, this.app.camera);
      const p = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(this.plane, p)) g.handle.position.copy(p);
    }
  }

  onPointerUp(ev) {
    const { app } = this;
    app.controls.enabled = true;
    const down = this.mouse;
    this.mouse = null;
    if (!down || app.renderer.xr.isPresenting) return;
    const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
    const quick = moved < 8 && performance.now() - down.t < 600;
    if (this.active.has('mouse')) {
      this.endGrab('mouse');
      return;
    }
    if (!quick || !down.hit) return;
    if (down.hit.panel) {
      this.setPointer(ev);
      const hit = this.castFromScreen();
      if (hit?.panel) this.press(hit);
    } else if (down.hit.object?.userData.handler.tap) {
      const before = sound.stamp;
      down.hit.object.userData.handler.tap(down.hit.object);
      if (sound.stamp === before) sound.tap();
      app.refresh();
    }
  }

  onWheel(ev) {
    if (this.app.renderer.xr.isPresenting) return;
    this.setPointer(ev);
    const hit = this.castFromScreen();
    if (!hit?.panel?.scrollable) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    hit.panel.scrollBy(ev.deltaY * (ev.deltaMode === 1 ? 40 : 1));
  }

  /** Drag-scrolling: the content follows the pointer / ray (raycaster already aimed). */
  dragScroll(d) {
    const hit = this.raycaster.intersectObject(d.panel.mesh, false)[0];
    if (!hit) return;
    const dy = (hit.uv.y - d.v0) * (d.panel.shownPx ?? d.panel.canvas.height);
    if (!d.moving && Math.abs(dy) < DRAG_PX) return;
    d.moving = true;
    const target = Math.max(0, Math.min(d.panel.maxScroll, d.scroll0 + dy));
    if (target !== d.panel.scroll) d.panel.scrollBy(target - d.panel.scroll);
  }

  // ───────────── XR controllers & hands ─────────────

  setupController(i) {
    const { renderer, scene } = this.app;
    const c = renderer.xr.getController(i);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
      new THREE.LineBasicMaterial({ color: 0x9aa8ff, transparent: true, opacity: 0.85 }),
    );
    line.scale.z = 1.5;
    c.add(line);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.006, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    dot.visible = false;
    scene.add(dot);
    c.userData = { line, dot, mode: null, inputSource: null, pending: null };

    c.addEventListener('connected', (ev) => {
      c.userData.mode = ev.data.targetRayMode;
      c.userData.inputSource = ev.data;
      line.visible = ev.data.targetRayMode === 'tracked-pointer';
    });
    c.addEventListener('disconnected', () => {
      c.userData.mode = null;
      dot.visible = false;
      this.endGrab(c);
      if (this.labGrabber === c) this.releaseLab(c);
    });

    c.addEventListener('selectstart', () => {
      // lining up from floor marks: the pinch / trigger marks the spot on the floor
      if (this.app.roomLineUp?.wantsSelect) {
        c.userData.lineupPress = true;
        this.app.roomLineUp.select(c);
        return;
      }
      if (this.app.state.placing || this.blocked) return;
      const hit = this.pick(c);
      // the wrist menu's Move: pinch and hold on nothing to move the whole lab
      if (this.handsFx?.moveNext && !hit?.panel && !hit?.object) {
        c.userData.movingLab = true;
        this.grabLab(c);
        return;
      }
      c.userData.pending = hit ? { ...hit, t: performance.now() } : null;
      c.userData.drag = hit?.panel?.scrollable ? { panel: hit.panel, v0: hit.uv.y, scroll0: hit.panel.scroll } : null;
      if (hit?.object && !this.startGrab(c, hit.object, 'single')) {
        // not grabbable (e.g. a bond): it may still be tapped on release
      }
    });
    c.addEventListener('select', () => {
      if (this.app.state.placing) {
        this.app.confirmPlacement();
        return;
      }
      if (c.userData.movingLab || c.userData.lineupPress || this.blocked) return;
      const dragged = c.userData.drag?.moving;
      c.userData.drag = null;
      if (c.userData.pending?.panel && !dragged) {
        const hit = this.castFromController(c);
        if (hit?.panel) this.press(hit, c);
      } else if (!c.userData.pending && !dragged) {
        this.app.onSelectNothing?.(c); // e.g. teleport to the floor you are pointing at
      }
    });
    c.addEventListener('selectend', () => {
      if (c.userData.lineupPress) {
        c.userData.lineupPress = false;
        return;
      }
      if (c.userData.movingLab) {
        c.userData.movingLab = false;
        this.releaseLab(c);
        if (this.handsFx) this.handsFx.moveNext = false;
        return;
      }
      const pending = c.userData.pending;
      c.userData.pending = null;
      c.userData.drag = null;
      if (this.active.has(c)) {
        this.endGrab(c);
      } else if (pending?.object?.userData.handler.tap && performance.now() - pending.t < TAP_MS * 3) {
        const before = sound.stamp;
        pending.object.userData.handler.tap(pending.object);
        if (sound.stamp === before) sound.tap();
        this.pulse(0.4, 25, c);
        this.app.refresh();
      }
    });

    // Grip: grab a whole molecule if you are on one, otherwise move the whole lab.
    c.addEventListener('squeezestart', () => {
      if (c.userData.mode !== 'tracked-pointer' || this.blocked) return;
      const hit = this.pick(c);
      if (hit?.object && this.startGrab(c, hit.object, 'group')) return;
      this.grabLab(c);
    });
    c.addEventListener('squeezeend', () => {
      if (this.active.has(c)) this.endGrab(c);
      else this.releaseLab(c);
    });

    scene.add(c);
    this.controllers.push(c);
    const hand = renderer.xr.getHand(i);
    scene.add(hand);
    this.hands.push(hand);
  }

  /** While lining up with the room, a press that is not on a panel marks a point. */
  grabLab(c) {
    if (this.labGrabber) return;
    if (this.app.state.locked) {
      this.pulse(0.2, 20, c); // locked: the lab stays put
      return;
    }
    this.labGrabber = c;
    this.app.grounding?.lifted(); // picked up off its surface
    c.attach(this.app.lab);
  }

  releaseLab(c) {
    if (this.labGrabber !== c) return;
    this.labGrabber = null;
    this.app.labMovedAt = performance.now(); // moved by hand: RealRoom leaves it there
    const lab = this.app.lab;
    this.app.scene.attach(lab);
    // Keep the lab upright: only keep its rotation around the vertical axis.
    const e = new THREE.Euler().setFromQuaternion(lab.quaternion, 'YXZ');
    lab.rotation.set(0, e.y, 0);
  }

  // ───────────── every frame ─────────────

  update() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastUpdate) / 1000);
    this.lastUpdate = now;
    for (const [src, g] of this.active) {
      const p = g.handle.getWorldPosition(new THREE.Vector3());
      if (this.handsFx && src !== 'mouse' && src.userData.inputSource?.hand) {
        // smooth out hand-tracking jitter: small wobbles are damped, real movements are followed at once
        g.smooth ??= p.clone();
        const k = Math.min(1, 0.3 + 6 * g.smooth.distanceTo(p));
        p.copy(g.smooth.lerp(p, k));
      }
      g.session.move(p);
    }
    this.handsFx?.update(dt);
    this.updateSettling(dt);
    const hovers = new Map();
    let hoverObject = null;
    const reaching = new Set(); // what hands / rays are on now (all of them glow)
    if (this.app.renderer.xr.isPresenting) {
      for (const c of this.controllers) {
        const { line, dot, mode } = c.userData;
        if (c.userData.drag) {
          // pinch / trigger held on a panel and moved: scroll it
          this.tmp.identity().extractRotation(c.matrixWorld);
          this.raycaster.ray.origin.setFromMatrixPosition(c.matrixWorld);
          this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tmp);
          this.dragScroll(c.userData.drag);
        }
        if (mode !== 'tracked-pointer') {
          dot.visible = false;
          continue;
        }
        const holding = this.active.has(c);
        const hit = holding ? null : this.pick(c);
        line.visible = !holding && !hit?.direct;
        line.scale.z = hit?.distance ?? 1.5;
        dot.visible = !!hit && !hit.direct;
        if (hit?.point) dot.position.copy(hit.point);
        if (hit?.panel) {
          // thumbstick up / down while pointing at a panel scrolls it
          const axes = c.userData.inputSource?.gamepad?.axes;
          const stick = axes ? (Math.abs(axes[3] ?? 0) > Math.abs(axes[1] ?? 0) ? axes[3] : axes[1]) ?? 0 : 0;
          if (hit.panel.scrollable && Math.abs(stick) > 0.2) hit.panel.scrollBy(stick * dt * 1400);
          const b = hit.panel.buttonAt(hit.uv);
          if (b) hovers.set(hit.panel, b.id);
        } else if (hit?.object) {
          hoverObject = hit.object;
          reaching.add(hit.object);
        }
        // a tiny tick in the controller when it reaches something new to grab
        const was = this.reach.get(c) ?? null;
        const now = hit?.object ?? null;
        if (now !== was) {
          this.reach.set(c, now);
          if (now) this.pulse(hit.direct ? 0.25 : 0.12, 12, c);
        }
      }
    } else if (this.mouseInside && !this.active.has('mouse')) {
      const hit = this.castFromScreen();
      const b = hit?.panel && hit.panel.buttonAt(hit.uv);
      if (b) hovers.set(hit.panel, b.id);
      if (hit?.object) {
        hoverObject = hit.object;
        reaching.add(hit.object);
      }
      this.app.renderer.domElement.style.cursor = b ? 'pointer' : hit?.object ? 'grab' : '';
    }
    this.handsFx?.hovers(hovers); // buttons being touched light up too
    for (const p of this.app.panels) {
      const id = hovers.get(p) ?? null;
      if (id && id !== p.hoverId && this.app.presenting) sound.hover(); // a faint tick as a button lights up
      p.setHover(id);
    }
    this.showHover(hoverObject);
    // what is held glows a little too, so it is clear what you have got
    for (const g of this.active.values()) if (g.object.visible) reaching.add(g.object);
    this.glow.update(reaching, dt, this.active);
  }

  /** Small floating label saying what you are pointing at. */
  showHover(object) {
    const text = object ? object.userData.handler.describe?.(object) ?? '' : '';
    if (text !== this.hoverText) {
      this.hoverText = text;
      if (this.hoverLabel) {
        this.hoverLabel.removeFromParent();
        this.hoverLabel.userData.dispose();
        this.hoverLabel = null;
      }
      if (text) {
        this.hoverLabel = makeLabel(text, { height: 0.022, size: 40 });
        this.hoverLabel.renderOrder = 10;
        this.hoverLabel.material.depthTest = false;
        this.app.scene.add(this.hoverLabel);
      }
    }
    if (this.hoverLabel && object) {
      object.getWorldPosition(this.hoverLabel.position);
      this.hoverLabel.position.y += 0.05;
    }
  }
}
