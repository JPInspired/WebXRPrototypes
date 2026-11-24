import * as THREE from 'three';

// Using the real room in mixed reality (from the headset's room scan, RoomAlign.js's RoomScan):
//  • The lab sits on a real table: when the scan shows a table in front of you at a working height (between
//    10 and 75 cm below your eyes, so a desk when seated, a bench when standing), the lab is put on its top.
//    This happens once, when the scan first arrives, unless you have already moved the lab yourself.
//  • The class board goes on a real wall: when it stands behind your bench (on your own, or in different
//    rooms), it moves flat against the real wall it would otherwise float through or in front of.
//    Same-room sessions keep the board where the teacher put it, so everyone shares it.
// Each headset can turn this off in ⚙ Settings › This headset › Real room (remembered on the headset).
// Also here: Hands in front (Settings › Hands in front, off unless chosen): on Quest 3, real hands and things
// between you and the lab hide the parts behind them (the headset's depth sensing, from the next time you enter).
// One switch turns it off everywhere: REAL_ROOM.enabled = false. Hintze Hall and Reef Dive are left out.

export const REAL_ROOM = { enabled: true };
const SKIP = ['hintze-hall', 'reef-dive'];
const KEY = 'webxr-classes:realroom';
const HANDS_KEY = 'webxr-classes:handsinfront';
const NO_DEPTH_KEY = 'webxr-classes:nodepth'; // this headset has no depth sensing (e.g. Quest 2): hide the setting
const UP = new THREE.Vector3(0, 1, 0);

export function makeRealRoom(app) {
  const lesson = (location.pathname.match(/lessons\/([^/]+)/) || [])[1];
  return REAL_ROOM.enabled && !SKIP.includes(lesson) ? new RealRoom(app) : null;
}

class RealRoom {
  constructor(app) {
    this.app = app;
    let saved = null;
    try { saved = localStorage.getItem(KEY); } catch {}
    this.on = saved !== 'off';
    // Hands in front (Quest 3): real hands and things between you and the lab hide it, as real objects would.
    // Off unless chosen (it needs the headset's depth sensing, and is new); remembered on the headset.
    let hands = null;
    try { hands = localStorage.getItem(HANDS_KEY); } catch {}
    this.handsInFront = hands === 'on';
    let noDepth = null;
    try { noDepth = localStorage.getItem(NO_DEPTH_KEY); } catch {}
    this.noDepth = noDepth === '1';
    this.tableTried = false;
    this.wall = null; // the wall the board is on (for the note in Settings)
  }

  /** Only in mixed reality, and only when switched on. */
  get active() {
    return this.on && !!this.app.presenting && !!this.app.isAR;
  }

  toggle() {
    this.on = !this.on;
    try { localStorage.setItem(KEY, this.on ? 'on' : 'off'); } catch {}
    if (this.on) this.tableTried = false; // try the table again
    else this.app.needsPlacement = true; // back in front of you, as before
    this.app.refresh();
  }

  /** The headset was asked for depth sensing and could not give it: hide Hands in front from now on. */
  markNoDepth() {
    this.noDepth = true;
    this.handsInFront = false;
    try {
      localStorage.setItem(NO_DEPTH_KEY, '1');
      localStorage.setItem(HANDS_KEY, 'off');
    } catch {}
    this.app.refresh();
  }

  toggleHands() {
    this.handsInFront = !this.handsInFront;
    try { localStorage.setItem(HANDS_KEY, this.handsInFront ? 'on' : 'off'); } catch {}
    this.app.refresh();
  }

  /** A new headset session: look for a table again once the scan arrives. */
  sessionStart() {
    this.tableTried = false;
    this.wall = null;
    this.startedAt = performance.now();
  }

  /** The lab was moved by hand (grip / Move / Place on surface): leave it where it is. */
  get labMovedByHand() {
    const ix = this.app.interaction;
    return !!ix?.labGrabber || !!this.app.state.placing || this.app.labMovedAt > (this.startedAt ?? 0);
  }

  // ───────────── the lab on a real table ─────────────

  tryTable() {
    const scan = this.app.roomScan;
    if (!scan?.version) return;
    if (this.labMovedByHand || this.app.state.locked) return (this.tableTried = true); // yours to place now
    const cam = this.app.viewCamera();
    const eye = cam.getWorldPosition(new THREE.Vector3());
    const dir = cam.getWorldDirection(new THREE.Vector3()).setY(0);
    if (dir.lengthSq() < 1e-6) return;
    dir.normalize();
    let best = null;
    for (const f of scan.features) {
      if (f.label !== 'table' && f.label !== 'desk' && f.label !== 'other') continue;
      const below = eye.y - f.p.y;
      if (below < 0.1 || below > 0.75 || f.a < 0.15) continue; // not a working height, or too small
      const to = f.p.clone().sub(eye).setY(0);
      const ahead = to.dot(dir);
      const side = Math.abs(to.clone().addScaledVector(dir, -ahead).length());
      if (ahead < 0.2 || ahead > 1.6 || side > 0.9) continue; // not in front of you
      const score = ahead + side * 1.5;
      if (!best || score < best.score) best = { f, ahead, score };
    }
    if (!best) return;
    const at = eye.clone().addScaledVector(dir, Math.min(0.95, Math.max(0.55, best.ahead)));
    const lab = this.app.lab;
    lab.position.set(at.x, best.f.p.y + 0.3, at.z); // (the same height above a surface as Place on surface)
    lab.rotation.set(0, Math.atan2(-dir.x, -dir.z), 0);
    this.onTable = true;
    this.tableTried = true;
    this.app.grounding?.landed(); // its shadow on the desk, and the arriving ring
    this.app.refresh();
  }

  // ───────────── the board on a real wall ─────────────

  /**
   * After the lesson has placed its board behind the bench: if a real wall stands in that direction, put the
   * board flat against it, facing the room. Same-room boards (placed in the shared room frame) are left alone.
   */
  boardToWall() {
    const app = this.app;
    const stage = app.boardStage;
    const scan = app.roomScan;
    if (!stage?.visible || !scan?.walls?.length) return (this.wall = null);
    if (app.presence?.sameRoom && app.presence.roomToWorld) return (this.wall = null);
    app.lab.updateMatrixWorld();
    const from = new THREE.Vector3().setFromMatrixPosition(app.lab.matrixWorld);
    const ahead = new THREE.Vector3(0, 0, -1).transformDirection(app.lab.matrixWorld).setY(0).normalize();
    let hit = null;
    for (const w of scan.walls) {
      const denom = w.n.dot(ahead);
      if (denom > -0.5) continue; // the wall must face back towards the lab
      const t = w.p.clone().sub(from).setY(0).dot(w.n) / denom;
      if (t < 1.0 || t > 4.5) continue; // too close to the bench, or too far away
      const p = from.clone().addScaledVector(ahead, t);
      const along = new THREE.Vector3().crossVectors(UP, w.n);
      if (Math.abs(p.clone().sub(w.p).dot(along)) > w.w / 2 + 0.2) continue; // past the end of the wall
      if (!hit || t < hit.t) hit = { t, p, w };
    }
    this.wall = hit;
    if (!hit) return;
    const y = stage.position.y; // keep the lesson's height
    stage.position.set(hit.p.x, y, hit.p.z).addScaledVector(hit.w.n, 0.06);
    stage.quaternion.setFromAxisAngle(UP, Math.atan2(hit.w.n.x, hit.w.n.z)); // facing out of the wall
  }

  // ───────────── every frame (after the lesson's own update) ─────────────

  update() {
    if (!this.active) return;
    // (the scan fills in over the first seconds: keep looking for a table for a little while)
    if (!this.tableTried && performance.now() - (this.startedAt ?? 0) < 8000) this.tryTable();
    this.boardToWall();
  }
}
