import * as THREE from 'three';
import { THEME } from '../ui/CanvasPanel.js';
import { sound } from '../util/sound.js';

// Lining up a same-room session, made visible and given a fallback (RoomAlign.js does the automatic part):
//  • Automatic (from each headset's room scan): a card says "Lining Up With the Room…", then "Lined Up With the
//    Room", and the room's outline is drawn on the floor for a few seconds so everyone can see it matches the
//    real walls. A headset that cannot line up says why, and what to do.
//  • Floor marks (the teacher switches to it: Teacher menu → Students → Room Line-Up): two pieces of tape on the
//    floor, A and B, about two metres apart. Every headset points at A and pinches (or pulls the trigger), then at
//    B. The room frame is then A, facing B, on the floor: the same for everyone, with no room scan needed.
//    Lining up again: Teacher menu → Students → Re-find room (all).
//
// One switch turns this off (back to the silent automatic line-up): ROOM_LINEUP.enabled = false.

export const ROOM_LINEUP = { enabled: true };
const UP = new THREE.Vector3(0, 1, 0);
const NOTE_MS = 12000; // how long a "cannot line up" note stays before it steps aside

export function makeRoomLineUp(app) {
  return ROOM_LINEUP.enabled ? new RoomLineUp(app) : null;
}

class RoomLineUp {
  constructor(app) {
    this.app = app;
    this.adminMode = 'auto'; // the teacher's choice
    this.remoteMode = 'auto'; // what the teacher has chosen (students)
    this.marks = []; // floor marks pointed at so far (world positions)
    this.manual = false; // lined up from floor marks
    this.lastStatus = null;
    this.statusSince = 0;
    this.okShown = 0;

    // the card in front of you
    this.canvas = document.createElement('canvas');
    this.canvas.width = 900;
    this.canvas.height = 250;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.card = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.117), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    this.card.renderOrder = 9985;
    this.card.visible = false;
    this.card.frustumCulled = false;
    app.scene.add(this.card);
    this.cardPos = null;
    this.drawn = '';

    // drawn on the floor: the room's outline, the marks, and where you are pointing
    this.floor = new THREE.Group();
    app.scene.add(this.floor);
    this.outline = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x7ee2a8, transparent: true, opacity: 0 }));
    this.outline.visible = false;
    this.outline.frustumCulled = false;
    this.floor.add(this.outline);
    const ring = (color) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.1, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      this.floor.add(m);
      return m;
    };
    this.aim = ring(0xffd36b);
    this.markA = ring(0x7ee2a8);
    this.markB = ring(0x7ee2a8);
    this.markA.add(this.letter('A'));
    this.markB.add(this.letter('B'));
    this.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0x7ee2a8 }));
    this.line.visible = false;
    this.floor.add(this.line);
  }

  letter(t) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#7ee2a8';
    g.font = '700 48px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText(t, 32, 48);
    const tex = new THREE.CanvasTexture(c);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.09), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    m.position.set(0, 0, 0.002);
    return m;
  }

  // ───────────── which way the class lines up ─────────────

  get mode() {
    return this.app.isAdmin ? this.adminMode : this.remoteMode;
  }

  /** Teacher: 'auto' (room scans) or 'marks' (floor marks). */
  setMode(m) {
    if (m === this.adminMode) return;
    this.adminMode = m;
    this.changed();
    this.app.broadcastAdmin();
    this.app.refresh();
  }

  /** Student: the teacher's choice arrived. */
  apply(m) {
    if (!m || m === this.remoteMode) return;
    this.remoteMode = m;
    this.changed();
  }

  /** The way of lining up changed (or Re-find room): start again. */
  changed() {
    this.reset();
    this.app.presence?.clearRoom('waiting');
    if (this.app.roomScan) this.app.roomScan.last = 0;
    this.app.onRoomFrame?.();
  }

  reset() {
    this.marks = [];
    this.manual = false;
    this.okShown = 0;
    this.markA.visible = this.markB.visible = this.line.visible = false;
  }

  /** Lining up from floor marks: LessonApp leaves the room frame alone. */
  get usesMarks() {
    return this.mode === 'marks';
  }

  /** Waiting for floor marks: pinches / triggers go here instead of to the lesson. */
  get wantsSelect() {
    return this.usesMarks && !this.manual && this.active;
  }

  get active() {
    return !!this.app.presence?.sameRoom && !!this.app.presenting;
  }

  // ───────────── floor marks ─────────────

  /** Where a controller / hand ray meets the floor (or null). */
  floorHit(c) {
    const m = new THREE.Matrix4().extractRotation(c.matrixWorld);
    const o = new THREE.Vector3().setFromMatrixPosition(c.matrixWorld);
    const d = new THREE.Vector3(0, 0, -1).applyMatrix4(m);
    const y = this.app.roomScan?.floorY ?? 0;
    if (d.y > -0.05) return null; // not pointing down
    const t = (y - o.y) / d.y;
    if (t < 0 || t > 8) return null;
    return o.addScaledVector(d, t);
  }

  select(c) {
    const p = this.floorHit(c);
    if (!p) return sound.wrong();
    this.marks.push(p);
    sound.tap();
    if (this.marks.length === 1) return;
    const [a, b] = this.marks;
    const x = b.clone().sub(a).setY(0);
    if (x.length() < 0.5) {
      // too close together: start again
      this.marks = [];
      sound.wrong();
      return;
    }
    x.normalize();
    const z = new THREE.Vector3().crossVectors(x, UP);
    const frame = new THREE.Matrix4().makeBasis(x, UP, z).setPosition(a.x, a.y, a.z);
    this.manual = true;
    this.app.presence.setRoomFrame(frame, 'ok');
    this.app.onRoomFrame?.();
    this.app.playersKey = null;
    this.okShown = performance.now();
    sound.correct();
  }

  // ───────────── every frame ─────────────

  update(dt) {
    const app = this.app;
    const pr = app.presence;
    if (!this.active) {
      this.card.visible = this.floor.visible = false;
      return;
    }
    this.floor.visible = true;
    const now = performance.now();
    let status = pr.roomStatus ?? 'waiting';
    if (status === 'screen') status = 'waiting'; // (just entered the headset: the scan has not been read yet)
    if (status !== this.lastStatus) {
      if (status === 'ok' && this.lastStatus !== null && !this.manual) this.okShown = now;
      if (status === 'ok' && this.lastStatus === null) this.okShown = now;
      this.lastStatus = status;
      this.statusSince = now;
    }

    // what the card says
    let card = null;
    this.aim.visible = false;
    if (this.usesMarks && !this.manual) {
      const which = this.marks.length ? 'B' : 'A';
      card = { title: `Point at Floor Mark ${which}`, text: 'Pinch, or pull the trigger, while pointing at the mark.', color: '#ffd36b' };
      // where you are pointing
      for (const c of app.interaction.controllers) {
        if (c.userData.mode !== 'tracked-pointer') continue;
        const p = this.floorHit(c);
        if (p) {
          this.aim.position.copy(p).add(new THREE.Vector3(0, 0.003, 0));
          this.aim.visible = true;
          break;
        }
      }
    } else if (status === 'ok' && now - this.okShown < 2800) {
      card = { title: 'Lined Up With the Room', text: this.manual ? 'From the floor marks.' : 'Everyone shares the same room.', color: THEME.good };
    } else if (status === 'waiting' && !this.usesMarks) {
      card = { title: 'Lining Up With the Room…', text: 'Look around the room for a moment.', color: THEME.text };
    } else if (status === 'no-scan' && now - this.statusSince < NOTE_MS) {
      card = { title: 'This Headset Has Not Scanned the Room', text: 'Quest Settings › Physical Space › Space Setup, or ask your teacher to use floor marks.', color: '#ffd36b' };
    } else if (status === 'unsure' && now - this.statusSince < NOTE_MS) {
      card = { title: 'Not Sure Which Way Round', text: 'Ask your teacher to press Re-find Room, or to use floor marks.', color: '#ffd36b' };
    }
    this.card.visible = !!card;
    if (card) {
      const key = JSON.stringify(card);
      if (key !== this.drawn) this.paint(card, (this.drawn = key));
      const cam = app.viewCamera();
      const head = cam.getWorldPosition(new THREE.Vector3());
      const q = cam.getWorldQuaternion(new THREE.Quaternion());
      const want = head.clone().add(new THREE.Vector3(0, -0.12, -0.85).applyQuaternion(q));
      if (!this.cardPos || this.cardPos.distanceTo(want) > 0.6) this.cardPos = want.clone();
      this.cardPos.lerp(want, Math.min(1, dt * 4));
      this.card.position.copy(this.cardPos);
      this.card.quaternion.copy(q);
    }

    // the floor marks, and the line between them
    this.markA.visible = this.marks.length >= 1;
    this.markB.visible = this.marks.length >= 2;
    if (this.markA.visible) this.markA.position.copy(this.marks[0]).add(new THREE.Vector3(0, 0.003, 0));
    if (this.markB.visible) {
      this.markB.position.copy(this.marks[1]).add(new THREE.Vector3(0, 0.003, 0));
      this.line.geometry.setFromPoints([this.markA.position, this.markB.position]);
      this.line.visible = true;
    }
    const fade = this.okShown ? Math.max(0, 1 - (now - this.okShown) / 5000) : 0;
    if (this.manual) for (const m of [this.markA, this.markB, this.line]) m.material.opacity = Math.max(0.15, fade);

    // the room's outline on the floor, for a few seconds after lining up automatically
    this.outline.visible = !this.manual && status === 'ok' && fade > 0 && !!pr.roomToWorld && !!this.size;
    if (this.outline.visible) {
      const [W, D] = this.size;
      const y = 0.01;
      const corners = [[-W / 2, -D / 2], [W / 2, -D / 2], [W / 2, D / 2], [-W / 2, D / 2]].map(([x, z]) => new THREE.Vector3(x, y, z).applyMatrix4(pr.roomToWorld));
      this.outline.geometry.setFromPoints(corners);
      this.outline.material.opacity = fade;
    }
  }

  /** The room's size from the automatic line-up (for the outline). */
  setSize(size) {
    this.size = size;
  }

  paint(l) {
    const g = this.canvas.getContext('2d');
    const W = this.canvas.width;
    const H = this.canvas.height;
    g.clearRect(0, 0, W, H);
    g.fillStyle = THEME.bg;
    g.strokeStyle = l.color;
    g.lineWidth = 5;
    g.beginPath();
    g.roundRect(6, 6, W - 12, H - 12, 40);
    g.fill();
    g.stroke();
    g.textAlign = 'center';
    g.fillStyle = l.color;
    g.font = '700 54px system-ui, -apple-system, "Segoe UI", sans-serif';
    g.fillText(l.title, W / 2, 104, W - 60);
    g.fillStyle = THEME.dim;
    g.font = '500 34px system-ui, -apple-system, "Segoe UI", sans-serif';
    g.fillText(l.text, W / 2, 172, W - 60);
    this.tex.needsUpdate = true;
  }
}
