import * as THREE from 'three';
import { sound } from '../util/sound.js';

// Using the lessons with bare hands (no controllers). Works with Interaction.js, which still does the
// pinching (the headset's own pinch = "select"). This adds:
//  • soft hands drawn over your own in VR (in mixed reality you see your real hands, so they stay hidden);
//  • pressing menu buttons by touching them with a fingertip;
//  • a small ring at the pinch point that closes as you pinch (and flashes instead of a controller buzz);
//  • grabbing with a closed hand (a fist) as well as a pinch, and a slightly larger reach for hands;
//  • a wrist menu: turn a palm towards your face for two buttons, Menus (hide / show all panels, like B on a
//    controller) and Move (the next pinch-and-hold anywhere moves the whole lab, like the grip).
// Held things are also smoothed for hands (see Interaction.update), so tracking jitter does not shake them.
//
// One switch turns all of this off: HANDS.enabled = false (or ?nohands in a lesson's address).

export const HANDS = { enabled: true };
const OFF = new URLSearchParams(location.search).has('nohands');

const FINGERS = ['thumb', 'index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];
const PARTS = {
  thumb: ['metacarpal', 'phalanx-proximal', 'phalanx-distal', 'tip'],
  other: ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'],
};
const JOINTS = ['wrist', ...FINGERS.flatMap((f) => (f === 'thumb' ? PARTS.thumb : PARTS.other).map((p) => `${f}-${p}`))];
const BONES = FINGERS.flatMap((f) => {
  const chain = ['wrist', ...(f === 'thumb' ? PARTS.thumb : PARTS.other).map((p) => `${f}-${p}`)];
  return chain.slice(1).map((j, i) => [chain[i], j]);
});
// across the palm, so it reads as a hand rather than a skeleton
BONES.push(['index-finger-metacarpal', 'middle-finger-metacarpal'], ['middle-finger-metacarpal', 'ring-finger-metacarpal'], ['ring-finger-metacarpal', 'pinky-finger-metacarpal'],
  ['index-finger-phalanx-proximal', 'middle-finger-phalanx-proximal'], ['middle-finger-phalanx-proximal', 'ring-finger-phalanx-proximal'], ['ring-finger-phalanx-proximal', 'pinky-finger-phalanx-proximal']);

const POKE_DEPTH = 0.012; // a fingertip this close to (or through) a panel presses it
const POKE_RESET = 0.03; // ... and must come back this far before it can press again
const FIST_ON = 0.05; // mean fingertip distance from the palm: closed
const FIST_OFF = 0.068; // ... open again
const FIST_REACH = 0.08;

const v = () => new THREE.Vector3();

export function makeHands(interaction) {
  if (!HANDS.enabled || OFF) return null;
  return new Hands(interaction);
}

class Hands {
  constructor(interaction) {
    this.ix = interaction;
    this.app = interaction.app;
    const scene = this.app.scene;
    // drawn hands: one sphere per joint and one stretched cylinder per bone, all in two instanced meshes per hand
    const skin = new THREE.MeshBasicMaterial({ color: 0xdfe6ff, transparent: true, opacity: 0.5, depthWrite: false });
    const knuckle = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false });
    this.hands = interaction.hands.map((hand, i) => {
      const joints = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), knuckle, JOINTS.length);
      const bones = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 8, 1, true), skin, BONES.length);
      for (const m of [joints, bones]) {
        m.frustumCulled = false;
        m.visible = false;
        m.renderOrder = 2;
        scene.add(m);
      }
      // the pinch ring
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
      ring.renderOrder = 20;
      ring.visible = false;
      scene.add(ring);
      return { hand, controller: interaction.controllers[i], joints, bones, ring, flash: 0, fist: false, pokeArmed: true, pokeHover: null };
    });
    this.wrist = this.makeWristMenu();
    this.moveNext = false; // the wrist menu's Move: the next pinch-and-hold on nothing moves the lab
  }

  /** Is this controller slot a tracked hand right now? */
  isHand(c) {
    return !!c?.userData.inputSource?.hand;
  }

  /** The hand's joint, if it is tracked this frame. */
  joint(h, name) {
    const j = h.hand.joints?.[name];
    return j && j.visible !== false ? j : null;
  }

  pos(h, name, out = v()) {
    const j = this.joint(h, name);
    return j ? j.getWorldPosition(out) : null;
  }

  /** A controller-less "buzz": the ring swells for a moment. */
  flash(c) {
    const h = this.hands.find((x) => x.controller === c);
    if (h) h.flash = 1;
  }

  /** Where the palm faces (unit vector) and its centre. */
  palm(h) {
    const w = this.pos(h, 'wrist');
    const i = this.pos(h, 'index-finger-metacarpal');
    const p = this.pos(h, 'pinky-finger-metacarpal');
    const m = this.pos(h, 'middle-finger-metacarpal');
    if (!w || !i || !p || !m) return null;
    const n = i.clone().sub(w).cross(p.clone().sub(w)).normalize();
    if (h.controller.userData.inputSource?.handedness === 'left') n.negate();
    const centre = m.clone().lerp(w, 0.35);
    return { normal: n, centre };
  }

  // ───────────── every frame ─────────────

  update(dt) {
    const xr = this.app.renderer.xr;
    if (!xr.isPresenting) return;
    const session = xr.getSession();
    const vr = session?.environmentBlendMode === 'opaque' || session?.environmentBlendMode === undefined;
    const head = this.app.viewCamera().getWorldPosition(v());
    let wristShown = false;
    for (const h of this.hands) {
      const tracked = this.isHand(h.controller) && !!this.joint(h, 'wrist');
      h.joints.visible = h.bones.visible = tracked && vr;
      h.ring.visible = tracked;
      if (!tracked) {
        if (h.fist) this.endFist(h);
        continue;
      }
      if (vr) this.drawHand(h);
      this.updateRing(h, head, dt);
      if (this.ix.blocked) continue; // the teacher has paused the class
      this.updateFist(h);
      this.updatePoke(h);
      if (!wristShown && this.updateWristMenu(h, head)) wristShown = true;
    }
    if (!wristShown) this.wrist.group.visible = false;
  }

  drawHand(h) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = v();
    const a = v();
    const b = v();
    const up = new THREE.Vector3(0, 1, 0);
    JOINTS.forEach((name, k) => {
      const j = this.joint(h, name);
      if (!j) return m.makeScale(0, 0, 0), h.joints.setMatrixAt(k, m);
      j.getWorldPosition(a);
      const r = (j.jointRadius ?? 0.008) * (name.endsWith('tip') ? 0.9 : 0.75);
      h.joints.setMatrixAt(k, m.compose(a, q.identity(), s.set(r, r, r)));
    });
    BONES.forEach(([ja, jb], k) => {
      const A = this.joint(h, ja);
      const B = this.joint(h, jb);
      if (!A || !B) return m.makeScale(0, 0, 0), h.bones.setMatrixAt(k, m);
      A.getWorldPosition(a);
      B.getWorldPosition(b);
      const len = a.distanceTo(b);
      const r = Math.min(A.jointRadius ?? 0.008, B.jointRadius ?? 0.008) * 0.85;
      q.setFromUnitVectors(up, b.clone().sub(a).normalize());
      h.bones.setMatrixAt(k, m.compose(a.add(b).multiplyScalar(0.5), q, s.set(r, len, r)));
    });
    h.joints.instanceMatrix.needsUpdate = true;
    h.bones.instanceMatrix.needsUpdate = true;
  }

  /** The ring between thumb and index: it closes as you pinch, and brightens when it will act on something. */
  updateRing(h, head, dt) {
    const a = this.pos(h, 'index-finger-tip');
    const b = this.pos(h, 'thumb-tip');
    if (!a || !b) return (h.ring.visible = false);
    const gap = a.distanceTo(b);
    const pinched = !!h.controller.userData.pending || this.ix.active.has(h.controller);
    const onSomething = !!this.ix.reach.get(h.controller);
    h.flash = Math.max(0, h.flash - dt * 5);
    const r = Math.max(0.0045, Math.min(0.016, gap * 0.45)) * (1 + h.flash * 0.6);
    h.ring.position.copy(a.add(b).multiplyScalar(0.5));
    h.ring.lookAt(head);
    h.ring.scale.setScalar(r);
    h.ring.material.color.setHex(pinched ? 0x7ee0a8 : onSomething ? 0xffffff : 0xb9c4ff);
    h.ring.material.opacity = pinched ? 0.95 : onSomething ? 0.9 : 0.45 + 0.3 * Math.max(0, 1 - gap / 0.06);
  }

  /** Closing the hand round something grabs it (as well as pinching). */
  updateFist(h) {
    const pal = this.palm(h);
    if (!pal) return;
    let sum = 0;
    let n = 0;
    for (const f of ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger']) {
      const t = this.pos(h, `${f}-tip`);
      if (t) sum += t.distanceTo(pal.centre), n++;
    }
    if (!n) return;
    const curl = sum / n;
    const c = h.controller;
    if (!h.fist && curl < FIST_ON && !this.ix.active.has(c) && !c.userData.pending) {
      h.fist = true;
      const target = this.ix.nearest(pal.centre, FIST_REACH);
      const wrist = this.joint(h, 'wrist');
      if (target && this.ix.startGrab(c, target, 'single', wrist)) {
        h.fistGrab = true;
        this.flash(c);
      }
    } else if (h.fist && curl > FIST_OFF) {
      this.endFist(h);
    }
  }

  endFist(h) {
    h.fist = false;
    if (h.fistGrab) {
      h.fistGrab = false;
      this.ix.endGrab(h.controller);
    }
  }

  /** Pressing a menu button by touching it with the index fingertip. */
  updatePoke(h) {
    const tip = this.pos(h, 'index-finger-tip');
    if (!tip) return;
    const rc = new THREE.Raycaster();
    const n = v();
    let best = null;
    for (const mesh of this.ix.panelMeshes) {
      n.set(0, 0, 1).transformDirection(mesh.matrixWorld); // the panel's front
      rc.ray.origin.copy(tip).addScaledVector(n, 0.06);
      rc.ray.direction.copy(n).negate();
      rc.far = 0.12;
      const hit = rc.intersectObject(mesh, false)[0];
      if (!hit) continue;
      const depth = 0.06 - hit.distance; // > 0: in front of the panel by that much; < 0: through it
      if (depth > 0.05 || depth < -0.03) continue;
      if (!best || Math.abs(depth) < Math.abs(best.depth)) best = { panel: mesh.userData.panel, uv: hit.uv, depth, point: hit.point };
    }
    h.pokeHover = best && best.depth < 0.05 ? best : null;
    if (!best) {
      h.pokeArmed = true;
      return;
    }
    if (best.depth > POKE_RESET) h.pokeArmed = true;
    if (h.pokeArmed && best.depth < POKE_DEPTH && best.depth > -0.025) {
      h.pokeArmed = false;
      if (best.panel.buttonAt(best.uv)) {
        this.ix.press({ panel: best.panel, uv: best.uv }, h.controller);
        this.flash(h.controller);
      }
    }
  }

  /** Buttons that are being touched (or nearly) light up like when pointed at. */
  hovers(map) {
    for (const h of this.hands) {
      const p = h.pokeHover;
      if (!p || map.has(p.panel)) continue;
      const b = p.panel.buttonAt(p.uv);
      if (b) map.set(p.panel, b.id);
    }
  }

  // ───────────── wrist menu ─────────────

  makeWristMenu() {
    const group = new THREE.Group();
    group.visible = false;
    group.renderOrder = 30;
    this.app.scene.add(group);
    const button = (id, draw) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 128;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(0.018, 32), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false }));
      mesh.renderOrder = 31;
      group.add(mesh);
      const b = { id, mesh, canvas, tex, draw, lit: false, armed: true };
      this.paint(b);
      return b;
    };
    const menus = button('menus', (ctx, lit) => {
      ctx.strokeStyle = ctx.fillStyle = lit ? '#15171c' : '#ffffff';
      ctx.lineWidth = 9;
      ctx.lineCap = 'round';
      for (const y of [44, 64, 84]) { ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(88, y); ctx.stroke(); }
      if (this.app.menusHidden) { ctx.strokeStyle = lit ? '#15171c' : '#ff8a80'; ctx.beginPath(); ctx.moveTo(34, 96); ctx.lineTo(94, 32); ctx.stroke(); }
    });
    const move = button('move', (ctx, lit) => {
      ctx.strokeStyle = lit ? '#15171c' : '#ffffff';
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const arrow = (x1, y1, x2, y2) => {
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        const a = Math.atan2(y2 - y1, x2 - x1);
        ctx.beginPath(); ctx.moveTo(x2 - 13 * Math.cos(a - 0.6), y2 - 13 * Math.sin(a - 0.6)); ctx.lineTo(x2, y2); ctx.lineTo(x2 - 13 * Math.cos(a + 0.6), y2 - 13 * Math.sin(a + 0.6)); ctx.stroke();
      };
      arrow(64, 64, 64, 28); arrow(64, 64, 64, 100); arrow(64, 64, 28, 64); arrow(64, 64, 100, 64);
    });
    return { group, buttons: [menus, move] };
  }

  paint(b) {
    const ctx = b.canvas.getContext('2d');
    ctx.clearRect(0, 0, 128, 128);
    const on = b.id === 'move' && this.moveNext;
    ctx.fillStyle = b.lit || on ? '#7ee0a8' : 'rgba(22, 26, 38, 0.88)';
    ctx.beginPath(); ctx.arc(64, 64, 62, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.65)';
    ctx.lineWidth = 4;
    ctx.stroke();
    b.draw(ctx, b.lit || on);
    b.tex.needsUpdate = true;
    b.key = `${b.lit}|${on}|${this.app.menusHidden}`;
  }

  /** Palm turned towards your face: show the two buttons above it, pressed with the other hand's fingertip. */
  updateWristMenu(h, head) {
    const pal = this.palm(h);
    if (!pal) return false;
    const toHead = head.clone().sub(pal.centre).normalize();
    if (pal.normal.dot(toHead) < 0.72 || this.ix.active.has(h.controller)) return false;
    const { group, buttons } = this.wrist;
    group.visible = true;
    group.position.copy(pal.centre).addScaledVector(pal.normal, 0.06);
    group.lookAt(head);
    // side by side, across the palm
    buttons[0].mesh.position.set(-0.024, 0, 0);
    buttons[1].mesh.position.set(0.024, 0, 0);
    buttons[1].mesh.visible = !this.app.state?.locked;
    buttons[0].mesh.visible = !this.app.ownMenuToggle;
    group.updateMatrixWorld(true);
    const other = this.hands.find((x) => x !== h);
    const tip = other && this.pos(other, 'index-finger-tip');
    for (const b of buttons) {
      if (!b.mesh.visible) continue;
      const c = b.mesh.getWorldPosition(v());
      const d = tip ? tip.distanceTo(c) : 1;
      const lit = d < 0.03;
      if (lit !== b.lit) b.lit = lit;
      if (d > 0.035) b.armed = true;
      if (b.armed && d < 0.016) {
        b.armed = false;
        this.pressWrist(b.id, other.controller);
      }
      const key = `${b.lit}|${b.id === 'move' && this.moveNext}|${this.app.menusHidden}`;
      if (key !== b.key) this.paint(b);
    }
    return true;
  }

  pressWrist(id, c) {
    sound.tap();
    this.flash(c);
    if (id === 'menus') this.app.toggleMenus();
    if (id === 'move') this.moveNext = !this.moveNext;
  }
}
