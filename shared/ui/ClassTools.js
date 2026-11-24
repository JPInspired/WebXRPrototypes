import * as THREE from 'three';
import { THEME } from './CanvasPanel.js';
import { sound } from '../util/sound.js';

// The teacher's class tools (Teacher menu → Class), for shared sessions:
//  • Pause the Class: every student's view dims, a message asks them to look towards the teacher, and their
//    controls do nothing until the teacher resumes (the teacher's own view is not paused).
//  • Look Here: for 8 seconds every student sees an arrow towards the teacher and a ring above the teacher's head.
//  • Timer: 1, 2, 5 or 10 minutes, counting down near the top of everyone's view, with a chime at the end.
// They travel with the rest of the teacher's settings (LessonApp.broadcastAdmin → onAdmin), so anyone who joins
// late or reconnects gets them at once.
//
// One switch turns the Class tab off: CLASS_TOOLS.enabled = false.

export const CLASS_TOOLS = { enabled: true };
const LOOK_MS = 8000;
const TIMERS = [1, 2, 5, 10];

const fmt = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function makeClassTools(app) {
  return CLASS_TOOLS.enabled ? new ClassTools(app) : null;
}

class ClassTools {
  constructor(app) {
    this.app = app;
    this.paused = false;
    this.timerEnd = 0; // performance.now() when the timer runs out (0 = no timer)
    this.timerTotal = 0;
    this.timeUp = 0; // when "Time is up" started showing
    this.lookEnd = 0;

    // a small display that follows your view (near the top), drawn on a canvas
    this.canvas = document.createElement('canvas');
    this.canvas.width = 768;
    this.canvas.height = 220;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.hud = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.103), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    this.hud.renderOrder = 9990;
    this.hud.visible = false;
    this.hud.frustumCulled = false;
    app.scene.add(this.hud);
    // the arrow towards the teacher (Look Here)
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.05); shape.lineTo(0.035, 0); shape.lineTo(0.012, 0); shape.lineTo(0.012, -0.04); shape.lineTo(-0.012, -0.04); shape.lineTo(-0.012, 0); shape.lineTo(-0.035, 0); shape.closePath();
    this.arrow = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, depthTest: false, depthWrite: false }));
    this.arrow.renderOrder = 9991;
    this.arrow.visible = false;
    app.scene.add(this.arrow);
    // the ring above the teacher
    this.beacon = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.012, 10, 48), new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, depthWrite: false }));
    this.beacon.visible = false;
    app.scene.add(this.beacon);
    // the dimming while paused (a shell round the head)
    this.dim = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16), new THREE.MeshBasicMaterial({ color: 0x05070c, side: THREE.BackSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
    this.dim.renderOrder = 9980;
    this.dim.visible = false;
    this.dim.frustumCulled = false;
    app.scene.add(this.dim);
    this.dimLevel = 0;
    this.hudPos = null;
    this.drawnKey = '';
  }

  /** A student, while the teacher has paused the class: their controls do nothing. */
  get blocked() {
    return this.paused && !this.app.isAdmin;
  }

  // ───────────── the teacher ─────────────

  setPaused(on) {
    this.paused = on;
    (on ? sound.pause : sound.resume)();
    this.send();
  }

  startTimer(min) {
    this.timerTotal = min * 60000;
    this.timerEnd = performance.now() + this.timerTotal;
    this.timeUp = 0;
    sound.tap();
    this.send();
  }

  stopTimer() {
    this.timerEnd = 0;
    this.timeUp = 0;
    this.send();
  }

  look() {
    this.lookEnd = performance.now() + LOOK_MS;
    sound.attention();
    this.send();
  }

  send() {
    this.app.broadcastAdmin();
    this.app.refresh();
  }

  /** What travels to the students (times as "milliseconds left", since every device has its own clock). */
  snapshot() {
    const now = performance.now();
    return {
      paused: this.paused,
      timerLeft: this.timerEnd ? Math.max(0, this.timerEnd - now) : null,
      timerTotal: this.timerTotal,
      lookLeft: Math.max(0, this.lookEnd - now),
    };
  }

  /** A student: the teacher's latest settings. */
  apply(t) {
    if (!t) return;
    const now = performance.now();
    if (!!t.paused !== this.paused) {
      this.paused = !!t.paused;
      (this.paused ? sound.pause : sound.resume)();
      this.app.refresh();
    }
    if (t.timerLeft == null) this.timerEnd = 0;
    else {
      const end = now + t.timerLeft;
      if (!this.timerEnd || Math.abs(end - this.timerEnd) > 1500) this.timerEnd = end; // (ignore small delays)
      this.timerTotal = t.timerTotal;
    }
    if (t.lookLeft > 0 && this.lookEnd < now) sound.attention();
    this.lookEnd = t.lookLeft > 0 ? now + t.lookLeft : 0;
  }

  /** The Class tab of the Teacher menu. */
  drawTab(ui) {
    ui.heading('Pause', { size: 22 });
    ui.buttons([{ id: 'class-pause', label: this.paused ? 'Resume the Class' : 'Pause the Class', active: this.paused, onClick: () => this.setPaused(!this.paused) }], { height: 54, size: 21 });
    ui.text(this.paused ? 'Every student’s view is dimmed and their controls are paused.' : 'Dims every student’s view and asks them to look towards you.', { size: 19, color: THEME.dim });
    ui.heading('Attention', { size: 22 });
    const looking = this.lookEnd > performance.now();
    ui.buttons([{ id: 'class-look', label: looking ? 'Pointing to You…' : 'Look Here', active: looking, onClick: () => this.look() }], { height: 54, size: 21 });
    ui.text('Shows every student an arrow towards you, and a ring above you, for 8 seconds.', { size: 19, color: THEME.dim });
    ui.heading('Timer', { size: 22 });
    ui.buttons(TIMERS.map((m) => ({ id: `class-timer-${m}`, label: `${m} min`, onClick: () => this.startTimer(m) })), { cols: 4, height: 50, size: 20, gap: 8 });
    if (this.timerEnd) {
      ui.buttons([{ id: 'class-timer-stop', label: `Stop the Timer (${fmt(this.timerEnd - performance.now())})`, onClick: () => this.stopTimer() }], { height: 50, size: 20 });
    } else ui.text('A countdown near the top of everyone’s view, with a chime at the end.', { size: 19, color: THEME.dim });
  }

  // ───────────── every frame ─────────────

  update(dt) {
    const app = this.app;
    const now = performance.now();
    const cam = app.viewCamera();
    const head = cam.getWorldPosition(new THREE.Vector3());
    const q = cam.getWorldQuaternion(new THREE.Quaternion());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    // the timer
    if (this.timerEnd && now >= this.timerEnd) {
      this.timerEnd = 0;
      this.timeUp = now;
      sound.done();
      if (app.isAdmin) app.refresh();
    }
    if (app.isAdmin && this.timerEnd && app.adminTab === 'class' && Math.floor(now / 1000) !== this.lastSecond) {
      this.lastSecond = Math.floor(now / 1000);
      app.adminPanel?.redraw(); // the countdown on the Stop button
    }
    const looking = this.lookEnd > now;
    const student = !app.isAdmin;
    // what the display says
    let lines = null;
    if (this.paused && student) lines = { title: 'The Class Is Paused', text: 'Please look towards your teacher.', color: '#ffd36b' };
    else if (looking && student) lines = { title: 'Look Here', text: 'Your teacher would like your attention.', color: '#ffd36b' };
    else if (this.timerEnd) lines = { title: fmt(this.timerEnd - now), text: this.paused ? 'Timer · the class is paused' : 'Time left', color: THEME.text, big: true };
    else if (this.timeUp && now - this.timeUp < 6000) lines = { title: 'Time Is Up', text: 'The timer has finished.', color: THEME.good };
    else if (this.paused) lines = { title: 'Class Paused', text: 'Only you can use the controls.', color: '#ffd36b' };
    else if (looking) lines = { title: 'Students Are Looking at You', text: '', color: '#ffd36b' };
    this.hud.visible = !!lines;
    if (lines) {
      const key = JSON.stringify(lines);
      if (key !== this.drawnKey) this.paint(lines, (this.drawnKey = key));
      // follows the view lazily: near the top, about 0.9 m away
      const centred = this.paused && student;
      const want = head.clone().addScaledVector(fwd, 0.9).addScaledVector(up, centred ? 0.02 : 0.24);
      if (!this.hudPos || this.hudPos.distanceTo(want) > 0.6) this.hudPos = want.clone();
      this.hudPos.lerp(want, Math.min(1, dt * 4));
      this.hud.position.copy(this.hudPos);
      this.hud.quaternion.copy(q);
    }
    // dimming while paused
    const dimTo = this.paused && student ? 0.6 : 0;
    this.dimLevel += Math.sign(dimTo - this.dimLevel) * Math.min(Math.abs(dimTo - this.dimLevel), dt * 1.5);
    this.dim.visible = this.dimLevel > 0.005;
    if (this.dim.visible) {
      this.dim.position.copy(head);
      this.dim.material.opacity = this.dimLevel;
    }
    // Look Here: an arrow towards the teacher, and a ring above them
    const teacher = student && looking ? this.teacherHead() : null;
    this.beacon.visible = !!teacher;
    this.arrow.visible = false;
    if (teacher) {
      this.beacon.position.copy(teacher).add(new THREE.Vector3(0, 0.32, 0));
      this.beacon.lookAt(head);
      this.beacon.scale.setScalar(1 + 0.15 * Math.sin(now / 160));
      this.beacon.material.opacity = 0.65 + 0.3 * Math.sin(now / 160);
      const local = teacher.clone().sub(head).applyQuaternion(q.clone().invert());
      const ahead = local.z < 0 && Math.abs(Math.atan2(local.x, -local.z)) < 0.35 && Math.abs(Math.atan2(local.y, -local.z)) < 0.35;
      if (!ahead) {
        // on the edge of the view, pointing the way to turn
        const ang = Math.atan2(local.y, local.x);
        this.arrow.visible = true;
        this.arrow.position.copy(head).addScaledVector(fwd, 0.7).add(new THREE.Vector3(Math.cos(ang) * 0.16, Math.sin(ang) * 0.11, 0).applyQuaternion(q));
        this.arrow.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ang - Math.PI / 2));
      }
    }
  }

  /** Where the teacher's head is in this student's world (or null). */
  teacherHead() {
    const pr = this.app.presence;
    const t = pr && [...pr.peers.values()].find((p) => p.host);
    return t ? pr.headOf(t) : null;
  }

  paint(l) {
    const c = this.canvas.getContext('2d');
    const W = this.canvas.width;
    const H = this.canvas.height;
    c.clearRect(0, 0, W, H);
    c.fillStyle = THEME.bg;
    c.strokeStyle = l.color;
    c.lineWidth = 5;
    c.beginPath();
    c.roundRect(6, 6, W - 12, H - 12, 40);
    c.fill();
    c.stroke();
    c.textAlign = 'center';
    c.fillStyle = l.color;
    c.font = `700 ${l.big ? 96 : 64}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    c.fillText(l.title, W / 2, l.text ? (l.big ? 112 : 100) : 132);
    if (l.text) {
      c.fillStyle = THEME.dim;
      c.font = '500 40px system-ui, -apple-system, "Segoe UI", sans-serif';
      c.fillText(l.text, W / 2, l.big ? 175 : 165);
    }
    this.tex.needsUpdate = true;
  }
}
