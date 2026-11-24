import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CanvasPanel } from './ui/CanvasPanel.js';
import { Interaction } from './ui/Interaction.js';
import { THEME, STYLE, panelFrame } from './ui/CanvasPanel.js';
import { Presence, sessionFromURL } from './net/Presence.js';
import { wasRemoved, markRemoved } from './net/removed.js';
import { RoomScan, solveRoom, fingerprint } from './net/RoomAlign.js';
import { newSessionCode } from './net/code.js';
import { findClass } from './net/lobby.js';
import { initStartScreen } from './ui/StartScreen.js';
import { PerfGuard } from './util/PerfGuard.js';
import { sound } from './util/sound.js';
import { Sparks } from './fx/Sparks.js';
import { makeClassroom } from './fx/Classroom.js';
import { makeLoading } from './fx/Loading.js';
import { makeClassTools } from './ui/ClassTools.js';
import { makeRoomLineUp } from './net/RoomLineUp.js';
import { makeRealRoom } from './fx/RealRoom.js';
import { makeGrounding } from './fx/Grounding.js';

// Everything every WebXR lesson needs, so each lesson only adds its own content:
//  • three.js scene, desktop camera + orbit controls, lights, floor grid
//  • a "lab" group holding the lesson, with a control panel (left), info panel (right)
//    and a floating explanation card (top)
//  • entering mixed reality / VR, placing the lab in front of the user or on a surface (hit-test)
//  • one input layer for mouse, touch, controllers and hands (shared/ui/Interaction.js)
//
// A lesson extends this class, sets up its content, then calls `this.start()`. Hooks it can provide:
//   refresh()            redraw 3D content + panels from state (call this.redrawPanels())
//   update(dt, frame)    per-frame animation
//   grabTargets()        objects that can be picked up / tapped
//   onXRStart(session, isAR), onXREnd(), onXRFrame(frame, refSpace)
//   onLite(level)        the headset is struggling: 1–2 = switch off more of the lesson's heavy effects, 0 = back to full
//                        (shared/util/PerfGuard.js already turns off reflections, clear coat and sheen)
//
// Shared sessions (?session=CODE in the URL): everyone keeps their own models and sees the others' work
// beside them (no avatars: in mixed reality you see the real people). A lesson takes part by providing:
//   netState()           a small JSON snapshot of what it shows (sent to the others when it changes)
//   createReplica()      → { group, apply(snapshot), update(dt)? } to show someone else's work

// Where the side panels sit (lab coordinates): far enough out to the sides, and high enough, to stay clear of
// the bench and anything on it (benches are up to about 0.92 m wide).
export const PANEL_X = 0.74;
export const PANEL_Y = 0.04;
export const PANEL_Z = 0.14;

export class LessonApp {
  constructor({ labPos = new THREE.Vector3(0, 1.2, 0), camPos = new THREE.Vector3(0, 1.45, 1.35), camTarget = null, background = 0x0d1020, panelX = PANEL_X } = {}) {
    this.labPos = labPos.clone();
    this.panelX = panelX; // a lesson with a wider set-up can move its side panels further out
    this.camPos = camPos.clone();
    this.camTarget = (camTarget ?? labPos).clone(); // what the on-screen view looks at
    this.state = {
      explain: null, // { title, text } shown on the floating card
      placing: false,
      speak: false,
      seated: false, // seated students: lab placed closer and lower
      locked: false, // lab cannot be moved by grabbing it
    };
    this.presenting = false;
    this.hitTestSource = null;
    this.needsPlacement = false;
    this.initThree(background);
    this.loading = makeLoading(this); // progress bar, fade-ins and fade-outs (shared/fx/Loading.js)
    this.initLab();
  }

  /** Call at the end of the lesson's constructor. */
  start() {
    // always load the latest version of the site after an update (see sw.js)
    navigator.serviceWorker?.register(new URL('../../sw.js', location.href)).catch(() => {});
    this.interaction = new Interaction(this);
    this.lessonId = (location.pathname.match(/lessons\/([^/]+)/) || [])[1] || 'lesson';
    let session = sessionFromURL();
    if (session && !session.host && wasRemoved(session.code)) {
      // this headset was removed from this session by the teacher: work on your own instead
      this.removedFrom = session.code;
      session = null;
    }
    if (session) {
      this.presence = new Presence(this, { lessonId: this.lessonId, ...session });
      // same room: lining up is shown, with floor marks as a fallback (shared/net/RoomLineUp.js)
      if (session.sameRoom) this.roomLineUp = makeRoomLineUp(this);
      this.sessionPanel = new CanvasPanel({ width: 0.5, height: session.sameRoom ? 0.19 : 0.14, name: 'session' });
      this.sessionPanel.mesh.position.set(-this.panelX, PANEL_Y + (session.sameRoom ? -0.475 : -0.45), PANEL_Z);
      this.sessionPanel.mesh.rotation.y = 0.42;
      this.lab.add(this.sessionPanel.mesh);
      this.sessionPanel.setBuilder((ui) => this.drawSession(ui));
      if (STYLE.enabled) {
        this.sessionPanel.onResize = () => this.layoutStacks();
        this.sessionPanel.setFit(0.06);
      }
      this.panels.push(this.sessionPanel);
      this.initPlayerList();
      this.initAdmin();
    }
    // house style: the explanation card fits round its words (shared/ui/CanvasPanel.js STYLE)
    if (STYLE.enabled) this.explainPanel?.setFit(0.1);
    this.initSessionUI(session);
    this.initXRButtons();
    this.loading?.started();
    this.realRoom = makeRealRoom(this); // the real room in mixed reality: lab on a table, board on a wall (shared/fx/RealRoom.js)
    this.grounding = makeGrounding(this); // its shadow on the real surface, and arriving (shared/fx/Grounding.js)
    this.refresh();
    this.sparks = new Sparks(this.scene); // the finished-task sparks (celebrate)
    // the subject's classroom around the lesson (shared/fx/Classroom.js: one switch there turns them all off)
    this.classroom = makeClassroom(this);
    if (this.classroom) this.grid.visible = false;
    this.perf = new PerfGuard(this); // frames-per-second counter (teacher, or ?fps) and the headset safety net
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop((t, frame) => this.frame(frame));
    if (this.removedFrom) {
      this.explain({ title: 'Removed From the Session', text: `Your teacher removed this headset from session ${this.removedFrom}. You can still use the lesson on your own. Ask your teacher if you should rejoin.` });
    }
  }

  // ───────────── setup ─────────────

  initThree(background) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    document.body.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.background = new THREE.Color(background);
    this.scene.background = this.background;

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 100000);
    this.camera.position.copy(this.camPos);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.target.copy(this.camTarget);
    this.controls.enableDamping = true;
    this.controls.maxDistance = 20;
    this.controls.update();

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(1, 3, 2);
    this.scene.add(sun);

    // Floor grid for on-screen / VR use; hidden in mixed reality where the real room is visible.
    this.grid = new THREE.GridHelper(20, 40, 0x334070, 0x1c2340);
    this.scene.add(this.grid);

    // Reticle for placing the lab on a real surface (AR hit-test).
    const ring = new THREE.RingGeometry(0.06, 0.08, 40).rotateX(-Math.PI / 2);
    this.reticle = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.reticle.matrixAutoUpdate = false;
    this.reticle.visible = false;
    this.scene.add(this.reticle);

    window.addEventListener('resize', () => {
      if (this.renderer.xr.isPresenting) return;
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  initLab() {
    // Everything in the lesson lives in one group so it can be moved / placed as a whole.
    this.lab = new THREE.Group();
    this.lab.position.copy(this.labPos);
    this.scene.add(this.lab);

    this.controlPanel = new CanvasPanel({ width: 0.5, height: 0.72, name: 'controls', fit: STYLE.enabled ? 0.16 : 0.3 });
    this.infoPanel = new CanvasPanel({ width: 0.5, height: 0.72, name: 'info', fit: STYLE.enabled ? 0.16 : 0.3 });
    // the panels below each side menu follow its bottom edge as it grows and shrinks
    this.controlPanel.onResize = () => this.layoutStacks();
    this.infoPanel.onResize = () => this.layoutStacks();
    this.controlPanel.mesh.position.set(-this.panelX, PANEL_Y, PANEL_Z);
    this.controlPanel.mesh.rotation.y = 0.42;
    this.infoPanel.mesh.position.set(this.panelX, PANEL_Y, PANEL_Z);
    this.infoPanel.mesh.rotation.y = -0.42;
    // Floating card above the model that explains whatever you just picked up or changed.
    this.explainPanel = new CanvasPanel({ width: 0.68, height: 0.25, name: 'explain' });
    this.explainPanel.mesh.position.set(0, 0.44, -0.04);
    this.explainPanel.mesh.rotation.x = 0.22;
    this.lab.add(this.controlPanel.mesh, this.infoPanel.mesh, this.explainPanel.mesh);
    this.panels = [this.controlPanel, this.infoPanel, this.explainPanel];
  }

  /** Keep the session panel just under the controls, and the players button and list just under the info panel. */
  layoutStacks() {
    const bottom = (p) => p.mesh.position.y - p.shownHeight / 2;
    const below = (above, panel, gap = 0.02) => {
      if (!panel) return;
      panel.mesh.position.y = bottom(above) - gap - panel.shownHeight / 2;
    };
    below(this.controlPanel, this.sessionPanel);
    below(this.infoPanel, this.playersPanel);
    if (this.playersPanel) below(this.playersPanel, this.playersListPanel, 0.01);
  }

  // ───────────── hooks (override in a lesson) ─────────────

  refresh() {
    this.redrawPanels();
  }

  redrawPanels() {
    for (const p of this.panels) p.redraw();
  }

  update() {}

  grabTargets() {
    return [];
  }

  // ───────────── shared actions ─────────────

  set(patch) {
    Object.assign(this.state, patch);
  }

  /**
   * Show an explanation on the floating card (and read it out if voice is on).
   * done: true marks the end of a task (every part labelled, every organ placed…): see celebrate().
   */
  explain(e) {
    if (!e) return;
    this.state.explain = e;
    this.say(`${e.title}. ${e.text}`);
    this.refresh();
    if (e.done) this.celebrate();
  }

  /**
   * A task is finished: the same moment in every lesson. A chime, a buzz in both controllers, the card's edge
   * glows green and a few sparks rise from it.
   */
  celebrate() {
    sound.done();
    this.interaction?.pulseAll(0.6, 120);
    this.explainPanel?.flashDone();
    if (this.explainPanel) this.sparks.burst(this.explainPanel.mesh);
  }

  say(text) {
    if (this.state.speak && 'speechSynthesis' in window) {
      speechSynthesis.cancel();
      speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    }
  }

  toggleSpeak() {
    this.state.speak = !this.state.speak;
    if (!this.state.speak && 'speechSynthesis' in window) speechSynthesis.cancel();
  }

  toggleSeated() {
    this.state.seated = !this.state.seated;
    if (this.presenting) this.needsPlacement = true;
  }

  toggleLocked() {
    if (this.lockedByAdmin) return;
    this.state.locked = !this.state.locked;
    if (this.state.locked) this.state.placing = false;
  }

  /** Standard buttons for the bottom of a control panel: move the lab, seated mode, lock, voice. */
  generalButtons() {
    const s = this.state;
    if (this.lockedByAdmin) return [{ id: 'speak', label: s.speak ? 'Voice: On' : 'Voice: Off', active: s.speak, onClick: () => this.toggleSpeak(), disabled: !('speechSynthesis' in window) }];
    const b = [{ id: 'recenter', label: this.presenting ? 'Bring Lab to Me' : 'Reset View', onClick: () => this.recenter() }];
    if (this.hitTestSource) b.push({ id: 'place', label: s.placing ? 'Tap to Drop Here' : 'Place on Surface', active: s.placing, disabled: s.locked, onClick: () => this.togglePlacing() });
    b.push({ id: 'seated', label: s.seated ? 'Seated: On' : 'Seated: Off', active: s.seated, onClick: () => this.toggleSeated() });
    if (this.realRoom && (this.isAR || !this.presenting)) b.push({ id: 'realroom', label: this.realRoom.on ? 'Real Room: On' : 'Real Room: Off', active: this.realRoom.on, onClick: () => this.realRoom.toggle() });
    if (this.realRoom?.on && !this.realRoom.noDepth && (this.isAR || !this.presenting)) {
      // real hands (and things) in front hide the lab behind them: Quest 3, from the next time you enter
      const h = this.realRoom.handsInFront;
      const later = this.presenting && h !== !!this.depthRequested ? ' (next time)' : '';
      b.push({ id: 'occlude', label: `Hands in front: ${h ? 'on' : 'off'}${later}`, active: h, onClick: () => this.realRoom.toggleHands() });
    }
    b.push({ id: 'lock', label: s.locked ? 'Lab Locked' : 'Lab Unlocked', active: s.locked, onClick: () => this.toggleLocked() });
    b.push({ id: 'speak', label: s.speak ? 'Voice: On' : 'Voice: Off', active: s.speak, onClick: () => this.toggleSpeak(), disabled: !('speechSynthesis' in window) });
    b.push({ id: 'sound', label: sound.muted ? 'Sound: Off' : 'Sound: On', active: !sound.muted, onClick: () => { sound.muted = !sound.muted; this.refresh(); } });
    b.push(this.lessonsButton());
    return b;
  }

  // ───────────── menu helpers shared by every lesson ─────────────

  /**
   * No shared session: whoever is using it runs the lesson themselves, so the teacher's own controls (which
   * prediction is on the board, revealing answers…) appear in their menu. In a session they are only in the
   * Teacher menu, which only the teacher sees.
   */
  get soloTeacher() {
    return !this.presence;
  }

  /** The ⚙ button for the top corner of a lesson's controls. */
  settingsIcon() {
    return { id: 'settings', label: '⚙', active: this.popupOpen === 'Settings', onClick: () => this.openLessonSettings() };
  }

  /** The settings pop-up: the level (unless the teacher chooses it), the class board (solo), the lesson's own extras, the headset's buttons. */
  openLessonSettings() {
    if (this.popupOpen === 'Settings') return this.closePopup();
    this.openSettings((ui) => {
      const s = this.state;
      const levels = this.levelOptions?.() ?? [['core', 'Core'], ['advanced', 'Advanced']];
      if ('level' in s && this.setLevel && !this.followsAdmin && levels.length) {
        ui.heading('Level', { size: 22 });
        ui.buttons(levels.map(([id, label]) => ({ id: `level-${id}`, label, active: s.level === id, onClick: () => this.setLevel(id) })), { height: 56, size: 21, gap: 10 });
      }
      if (this.soloTeacher && this.toggleBoard && 'big' in s) {
        ui.heading('Class board', { size: 22 });
        ui.buttons([{ id: 'board', label: s.big ? 'Shown (Tap to Hide)' : 'Hidden (Tap to Show)', active: s.big, onClick: () => this.toggleBoard() }], { height: 56, size: 21 });
      }
      this.settingsSections?.(ui);
    });
  }

  /** A pop-up opened by a button, closed by pressing it again. */
  togglePopup(title, builder, opts) {
    if (this.popupOpen === title) return this.closePopup();
    this.openPopup(title, builder, opts);
  }

  /** The "Ask the …" button for the bottom of a lesson's info panel; the questions open in a pop-up. */
  askButton(title, builder) {
    return { id: 'ask', label: title, active: this.popupOpen === title, onClick: () => this.togglePopup(title, builder, { height: 0.72 }) };
  }

  // ───────────── pop-up card (settings, "ask the expert", …) ─────────────

  /**
   * Show a pop-up card in front of the lab. builder(ui) draws its content (below a title and a × button).
   * Used by lessons that keep their side menus short: settings, questions for the expert, discussion prompts.
   */
  openPopup(title, builder, { width = 0.56, height = 0.66 } = {}) {
    if (!this.popupPanel || this.popupPanel.w !== width || this.popupPanel.h !== height) {
      if (this.popupPanel) {
        this.lab.remove(this.popupPanel.mesh);
        this.panels = this.panels.filter((p) => p !== this.popupPanel);
      }
      this.popupPanel = new CanvasPanel({ width, height, name: 'popup', fit: STYLE.enabled ? 0.15 : 0 }); // (house style: fits round its content)
      this.popupPanel.w = width;
      this.popupPanel.h = height;
      this.popupPanel.mesh.position.set(0, PANEL_Y + 0.02, 0.3);
      this.popupPanel.mesh.rotation.x = -0.12;
      this.popupPanel.mesh.renderOrder = 10;
      this.lab.add(this.popupPanel.mesh);
    }
    if (!this.panels.includes(this.popupPanel)) this.panels.push(this.popupPanel);
    this.popupTitle = title;
    this.popupPanel.setBuilder((ui) => {
      ui.header(this.popupTitle, [{ id: 'popup-close', label: '×', onClick: () => this.closePopup() }]);
      builder(ui);
    });
    this.popupPanel.scroll = 0;
    if (!this.popupPanel.mesh.visible || this.popupOpen !== title) sound.open();
    this.popupPanel.mesh.visible = true;
    this.popupOpen = title;
    this.refresh();
  }

  closePopup() {
    if (this.popupPanel?.mesh.visible) sound.close();
    if (this.popupPanel) this.popupPanel.mesh.visible = false;
    this.popupOpen = null;
    this.refresh();
  }

  /**
   * The settings pop-up: lessonSections(ui) draws the lesson's own (e.g. level, class board), then the
   * general buttons (move the lab, seated, lock, voice, back to the lessons).
   */
  openSettings(lessonSections = null) {
    this.openPopup('Settings', (ui) => {
      lessonSections?.(ui);
      ui.heading('This headset', { size: 22 });
      ui.buttons(this.generalButtons(), { cols: 2, height: 56, size: 21, gap: 10 });
    });
  }

  /** "← Lessons": back to the lessons page. Press twice (within 3 s) so nobody leaves by accident. */
  lessonsButton() {
    const armed = this.leaveArmed && performance.now() - this.leaveArmed < 3000;
    return { id: 'lessons', label: armed ? 'Tap Again to Leave' : '← Lessons', active: armed, color: '#3a2f55', onClick: () => this.backToLessons() };
  }

  backToLessons() {
    const armed = this.leaveArmed && performance.now() - this.leaveArmed < 3000;
    if (!armed) {
      this.leaveArmed = performance.now();
      setTimeout(() => this.refresh(), 3100); // the button goes back to "← Lessons"
      return;
    }
    const url = this.lessonsURL();
    const go = () => { location.href = url; };
    const session = this.renderer.xr.getSession();
    const leave = () => (session ? session.end().then(go, go) : go()); // leave the headset view first, then the page
    if (this.loading) this.loading.fadeOut(leave);
    else leave();
  }

  /** The lessons page (keeps a shared session's name so people do not retype it). */
  lessonsURL() {
    const url = new URL('../../', location.href);
    const name = new URLSearchParams(location.search).get('name');
    if (name) url.searchParams.set('name', name);
    return url.toString();
  }

  togglePlacing() {
    this.state.placing = !this.state.placing;
  }

  confirmPlacement() {
    if (this.reticle?.visible) this.grounding?.landed(); // dropped onto a real surface
    this.state.placing = false;
    this.labMovedAt = performance.now(); // placed by hand: RealRoom leaves it there
    this.refresh();
  }

  recenter() {
    if (this.presenting) {
      this.needsPlacement = true;
      return;
    }
    this.lab.position.copy(this.labPos);
    this.lab.rotation.set(0, 0, 0);
    this.camera.position.copy(this.camPos);
    this.controls.target.copy(this.camTarget);
  }

  /** The camera currently in use (headset or desktop). */
  viewCamera() {
    return this.presenting ? this.renderer.xr.getCamera() : this.camera;
  }

  // ───────────── shared sessions ─────────────

  /** A headset's room status in a few words (see RoomAlign.js). */
  roomNote(room) {
    return { ok: '✓ in place', unsure: '⚠ unsure which way round', 'no-scan': '⚠ needs Space Setup', waiting: '… finding the room', screen: 'on a computer' }[room] ?? '';
  }

  /** How the session is doing: a few words for the title line, and help text when something is wrong. */
  sessionStatus() {
    const pr = this.presence;
    if (pr.status === 'failed') {
      const secs = pr.retryAt ? Math.max(1, Math.ceil((pr.retryAt - performance.now()) / 1000)) : 0;
      return { text: pr.retryAt ? ' · trying again…' : ' · could not connect', help: (pr.error ?? 'Could not connect to the class.') + (pr.retryAt ? ` Trying again by itself (in about ${secs} s).` : ''), bad: true };
    }
    if (pr.status === 'reconnecting') return { text: ' · reconnecting…', help: 'Lost touch with the class for a moment. Reconnecting by itself: your work stays as it is.' };
    if (pr.status !== 'connected') return { text: ' · connecting…', help: null };
    if (pr.peers.size) return { text: '', help: this.adminHere ? null : 'Your teacher is not connected right now. Everything carries on as they left it.' };
    const waiting = this.isAdmin ? ' · waiting for students' : ' · waiting for your teacher';
    if (pr.everJoined) {
      return { text: waiting, help: this.isAdmin ? 'Everyone else has left. They can rejoin with the same code.' : 'Your teacher is not connected right now. Everything carries on as they left it.' };
    }
    const long = performance.now() - (pr.connectedAt ?? 0) > 20000;
    // the teacher is told straight away what students do; a student only after a while (it usually just works)
    const help = pr.problem ?? (this.isAdmin
      ? `Students type ${pr.code} at the top of the lessons page, on the same Wi-Fi as you.`
      : !long ? null : 'Your teacher has not been found yet. Check the code, and that you are on the same Wi-Fi as your teacher.');
    return { text: waiting, help };
  }

  drawSession(ui) {
    const pr = this.presence;
    ui.y = 18;
    const st = this.sessionStatus();
    ui.text(`CLASS ${pr.code}${st.text}`, { size: 24, weight: 700, color: st.bad ? '#ff6b6b' : THEME.accent });
    if (st.help) {
      ui.text(st.help, { size: 21, color: st.bad ? '#ff9a9a' : '#ffd166' });
      return;
    }
    if (pr.sameRoom) {
      const r = pr.roomStatus ?? 'waiting';
      const text = {
        ok: 'Room: in place ✓',
        unsure: 'Room: found, but not sure which way round. Tell your teacher.',
        'no-scan': 'Room: this headset has not scanned the room (Space Setup). Tell your teacher.',
        waiting: 'Room: finding the room…',
        screen: 'Room: lines up by itself in the headset',
      }[r];
      ui.text(text, { size: 22, color: r === 'ok' || r === 'screen' ? '#7ee2a8' : '#ffd166' });
    }
    const ctx = ui.ctx;
    let x = ui.pad;
    for (const person of pr.people.slice(0, 6)) {
      ctx.font = '600 22px system-ui, sans-serif';
      const w = ctx.measureText(person.name).width + 34;
      if (x + w > ui.W - ui.pad) break;
      ctx.fillStyle = `#${person.color.toString(16).padStart(6, '0')}`;
      ctx.beginPath();
      ctx.arc(x + 9, ui.y + 14, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = THEME.text;
      ctx.textBaseline = 'top';
      ctx.fillText(person.name, x + 24, ui.y + 2);
      x += w + 14;
    }
    ui.y += 30; // (so the panel fits round the names)
  }

  // ───────────── player list (a panel beside the others) ─────────────

  /**
   * Who is in the session: a "Players" button under the info panel (mirroring the session panel under the
   * controls); the list drops down below it.
   */
  initPlayerList() {
    this.playersOpen = false;
    const add = (panel, y) => {
      panel.mesh.position.set(this.panelX, PANEL_Y + y, PANEL_Z);
      panel.mesh.rotation.y = -0.42;
      this.lab.add(panel.mesh);
      this.panels.push(panel);
      return panel;
    };
    this.playersPanel = add(new CanvasPanel({ width: 0.5, height: 0.07, name: 'players' }), -0.36 - 0.02 - 0.035);
    this.playersPanel.setBuilder((ui) => {
      const n = this.presence.people.length;
      ui.button({ id: 'players', label: `In the Class (${n}) ${this.playersOpen ? '▴' : '▾'}`, active: this.playersOpen, onClick: () => this.togglePlayerList() }, 10, 10, ui.W - 20, ui.H - 20, 34);
    });
    this.playersListPanel = add(new CanvasPanel({ width: 0.5, height: 0.34, name: 'players-list' }), -0.465 - 0.01 - 0.17);
    this.playersListPanel.setBuilder((ui) => this.drawPlayerList(ui));
    this.playersListPanel.mesh.visible = false;
    this.matchPanelLook(this.playersPanel, this.playersListPanel);
  }

  /** New panels look like the lesson's own (draw order, fog). */
  matchPanelLook(...panels) {
    for (const p of panels) {
      p.mesh.renderOrder = this.controlPanel.mesh.renderOrder;
      p.mesh.material.fog = this.controlPanel.mesh.material.fog;
    }
  }

  togglePlayerList() {
    this.playersOpen = !this.playersOpen;
    this.playersListPanel.mesh.visible = this.playersOpen;
    this.playersKey = null;
    this.refreshPlayerList();
  }

  /** A short note about a person: you / admin, and (same room) whether their headset found the room. */
  personNote(person) {
    const notes = [];
    if (person.you) notes.push('you');
    if (person.host) notes.push('admin');
    if (person.away) notes.push('not responding');
    if (this.presence.sameRoom) notes.push(this.roomNote(person.room));
    return notes.join(' · ');
  }

  refreshPlayerList() {
    const pr = this.presence;
    if (!pr || !this.playersPanel) return;
    const key = JSON.stringify([this.playersOpen, pr.status, this.sessionStatus().help, pr.people.map((p) => [p.plain, p.color, this.personNote(p)]), this.isAdmin, this.admin, this.kickArmed]);
    if (key === this.playersKey) return;
    this.playersKey = key;
    this.playersPanel.redraw();
    if (this.playersOpen) this.playersListPanel.redraw();
    if (this.adminPanel?.mesh.visible) this.adminPanel.redraw();
  }

  /** A row per person: colour, name, note. Returns nothing; advances ui.y. */
  drawPerson(ui, person, right = ui.right) {
    const ctx = ui.ctx;
    const y = ui.y + 2;
    ctx.fillStyle = `#${person.color.toString(16).padStart(6, '0')}`;
    ctx.beginPath();
    ctx.arc(ui.pad + 10, y + 18, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.textBaseline = 'top';
    ctx.fillStyle = THEME.text;
    ctx.font = '600 27px system-ui, sans-serif';
    ctx.fillText(person.plain.slice(0, 22), ui.pad + 32, y + 2, right - ui.pad - 40);
    ctx.fillStyle = THEME.dim;
    ctx.font = '400 21px system-ui, sans-serif';
    ctx.fillText(this.personNote(person), ui.pad + 32, y + 34, right - ui.pad - 40);
  }

  drawPlayerList(ui) {
    const pr = this.presence;
    ui.y = 22;
    const st = this.sessionStatus();
    ui.text(`CLASS ${pr.code}${st.text}`, { size: 24, weight: 700, color: st.bad ? '#ff6b6b' : THEME.accent });
    if (st.help) ui.text(st.help, { size: 21, color: st.bad ? '#ff9a9a' : '#ffd166' });
    ui.y += 6;
    for (const person of pr.people) {
      this.drawPerson(ui, person);
      ui.y += 66;
    }
  }

  // ───────────── same room: the room frame (automatic) ─────────────

  /**
   * Re-read the room scan and work out where the shared room frame is (RoomAlign.js). The admin's headset
   * uses the shared rule and sends its room "fingerprint"; everyone else matches it. Nothing to press.
   */
  updateRoomFrame() {
    if (this.roomLineUp?.usesMarks) return; // lined up from floor marks instead (RoomLineUp.js)
    const pr = this.presence;
    const scan = this.roomScan;
    const admin = pr.isHost;
    const sol = scan.hasRoom ? solveRoom(scan, admin ? null : pr.roomRef) : null;
    const changed = pr.setRoomFrame(sol?.matrix ?? null, !scan.hasRoom || !sol ? 'no-scan' : sol.sure ? 'ok' : 'unsure');
    this.roomLineUp?.setSize(sol?.size);
    if (admin && sol) {
      const ref = { size: sol.size, features: fingerprint(scan, sol.matrix) };
      const fresh = JSON.stringify(ref) !== JSON.stringify(this.roomRefOut);
      this.roomRefOut = ref;
      if (fresh) pr.roomCh?.send(ref);
    }
    if (changed) this.onRoomFrame?.();
    this.playersKey = null;
  }

  /**
   * The headset recentred (long press on the Meta button) or lost tracking: its coordinates jumped. The room
   * scan comes back in the new coordinates, so just read it again now: the room frame puts itself right.
   */
  onTrackingReset() {
    if (this.roomScan) this.roomScan.last = 0;
  }

  // ───────────── admin (whoever opened the session) ─────────────

  /**
   * Whoever opened the session. Only they are ever admin: if their headset drops out (e.g. it goes to sleep),
   * nobody else gets admin powers; students keep the last settings until the admin is back.
   */
  get isAdmin() {
    const pr = this.presence;
    if (!pr?.host) return false;
    return pr.selfId ? pr.isHost : true;
  }

  /** Is the admin (whoever opened the session) here? */
  get adminHere() {
    const pr = this.presence;
    return !!pr && (pr.host || [...pr.peers.values()].some((p) => p.host));
  }

  /** A student in a shared session: the admin chooses some things for everyone. */
  get followsAdmin() {
    return !!this.presence && !this.isAdmin;
  }

  /** Who the admin is, for "chosen by …" notes. */
  get adminName() {
    const pr = this.presence;
    if (!pr || this.isAdmin) return 'you';
    const admin = [...pr.peers.values()].filter((p) => p.host).sort((a, b) => (a.id < b.id ? -1 : 1))[0];
    return admin?.name ?? 'the teacher';
  }

  /** The Admin menu: to the left of the controls, only for the admin. */
  initAdmin() {
    this.admin = { lock: false, effects: 'auto' }; // what the admin has set for everyone
    this.lockedByAdmin = false; // (students) the admin has locked my menus
    this.adminPanel = new CanvasPanel({ width: 0.5, height: 0.8, name: 'admin', fit: STYLE.enabled ? 0.2 : 0.3 });
    this.adminPanel.mesh.position.set(-this.panelX - 0.56, PANEL_Y + 0.04, PANEL_Z + 0.08); // just beyond the controls, turned to face you
    this.adminPanel.mesh.rotation.y = 0.62;
    this.adminTab = 'lesson';
    this.adminPanel.mesh.visible = false;
    this.adminPanel.setBuilder((ui) => this.drawAdmin(ui));
    this.lab.add(this.adminPanel.mesh);
    this.panels.push(this.adminPanel);
    this.matchPanelLook(this.adminPanel);
    this.adminClock = 0;
    this.classTools = makeClassTools(this); // Teacher menu → Class: pause, look here, timer (shared/ui/ClassTools.js)
  }

  /**
   * The Teacher menu: only the teacher (whoever opened the session) sees it. Tabs:
   *   Lesson   – the activity and level for everyone, the prediction on the board and revealing it, and any of
   *              the lesson's own teacher controls;
   *   Board    – where the class board is and whether it is showing;
   *   Students – their progress, locking their menus, finding the room again, removing someone;
   *   Class    – pausing the class, Look Here and a timer (ClassTools.js).
   */
  drawAdmin(ui) {
    ui.header('Teacher', []);
    const tab = this.adminTab;
    ui.tabs([['lesson', 'Lesson'], ['board', 'Board'], ['students', 'Students'], ...(this.classTools ? [['class', 'Class']] : [])].map(([id, label]) => ({ id: `admin-tab-${id}`, label, active: tab === id, onClick: () => { this.adminTab = id; this.refresh(); } })), { height: 54, size: 20 });
    const sections = this.adminLessonButtons?.() ?? [];
    const isBoard = (s) => /board/i.test(s.heading);
    const isProgress = (s) => /progress/i.test(s.heading);
    const draw = (section) => {
      ui.heading(section.heading, { size: 22 });
      if (section.text) ui.text(section.text, { size: 20, color: THEME.dim });
      if (section.buttons.length) ui.buttons(section.buttons, { cols: section.cols ?? 2, height: 52, size: 20, gap: 8 });
    };
    if (tab === 'class' && this.classTools) return this.classTools.drawTab(ui);
    if (tab === 'lesson') {
      const y0 = ui.y;
      for (const s of sections.filter((x) => !isBoard(x) && !isProgress(x))) draw(s);
      this.drawTeacherPrediction(ui);
      this.teacherControls?.(ui);
      if (ui.y === y0) ui.text('Everyone explores this lesson at their own pace: there is nothing to choose for the class here. See the Students tab.', { size: 21, color: THEME.dim });
      return;
    }
    if (tab === 'board') {
      if (this.toggleBoard && 'big' in this.state) {
        ui.heading('Class board', { size: 22 });
        ui.buttons([{ id: 'admin-board', label: this.state.big ? 'Showing (Tap to Hide)' : 'Hidden (Tap to Show)', active: this.state.big, onClick: () => this.toggleBoard() }], { height: 52, size: 20 });
      }
      for (const s of sections.filter(isBoard)) draw(s);
      return;
    }
    for (const s of sections.filter(isProgress)) draw(s);
    ui.heading('Students', { size: 22 });
    ui.buttons([
      { id: 'lock-students', label: this.admin.lock ? 'Menus: Locked' : 'Menus: Unlocked', active: this.admin.lock, onClick: () => this.toggleStudentLock() },
      ...(this.presence.sameRoom ? [{ id: 'refind', label: 'Re-find Room (All)', onClick: () => { this.adminSend({ k: 'refind' }); this.roomLineUp?.changed(); } }] : []),
    ], { height: 52, size: 21, gap: 8 });
    if (this.roomLineUp) {
      ui.heading('Room Line-Up', { size: 22 });
      ui.buttons([
        { id: 'lineup-auto', label: 'Automatic', active: this.roomLineUp.adminMode === 'auto', onClick: () => this.roomLineUp.setMode('auto') },
        { id: 'lineup-marks', label: 'Floor Marks', active: this.roomLineUp.adminMode === 'marks', onClick: () => this.roomLineUp.setMode('marks') },
      ], { height: 52, size: 21, gap: 8 });
      ui.text(this.roomLineUp.adminMode === 'marks'
        ? 'Every headset points at floor mark A, then B: two pieces of tape about two metres apart.'
        : 'Each headset lines up from its room scan. Use floor marks if a headset has no scan or is unsure.', { size: 19, color: THEME.dim });
    }
    const students = this.presence.people.filter((p) => !p.you);
    ui.heading('Effects (every device)', { size: 22 });
    ui.buttons([
      { id: 'effects-auto', label: 'Full (Automatic)', active: this.admin.effects !== 'light', onClick: () => this.setClassEffects('auto') },
      { id: 'effects-light', label: 'Light', active: this.admin.effects === 'light', onClick: () => this.setClassEffects('light') },
    ], { height: 52, size: 21, gap: 8 });
    ui.text('Light: no reflections or gloss, for older or slower headsets. Full still lightens any headset that struggles.', { size: 19, color: THEME.dim });
    if (!students.length) ui.text('Nobody else has joined yet.', { size: 21, color: THEME.dim });
    for (const person of students) {
      const armed = this.kickArmed?.id === person.id && performance.now() - this.kickArmed.t < 3000;
      this.drawPerson(ui, person, ui.right - 160);
      ui.button({ id: `kick-${person.id}`, label: armed ? 'Sure?' : 'Remove', active: armed, color: '#5a2f3a', onClick: () => this.kick(person.id) }, ui.right - 150, ui.y + 6, 150, 50, 21);
      ui.y += 66;
    }
  }

  /** In the Teacher menu (or a solo user's own menu): which prediction is on the board, and revealing it. */
  drawTeacherPrediction(ui) {
    if (!this.predictions || !this.challenge || !this.setRound || this.customTeacherPrediction) return;
    const d = this.myDemo?.() ?? this.state;
    if ((d.mode ?? this.state.mode) !== 'predict') return;
    const ch = this.challenge();
    if (!ch) return;
    ui.heading('Prediction on the board', { size: 22 });
    ui.buttons(this.predictions().map((p, i) => ({ id: `t-round-${i}`, label: `${i + 1}. ${p.name}`, active: this.state.round === i, onClick: () => { this.setRound(i); this.refresh(); } })), { cols: 2, height: 50, size: 19, gap: 8 });
    ui.buttons([{ id: 't-reveal', label: ch.revealed ? 'Hide the Answer' : 'Reveal the Answer', active: ch.revealed, onClick: () => { this.reveal(); this.refresh(); } }], { height: 58, size: 22 });
    const t = this.tally?.(ch);
    if (t) ui.text(`${t.votes} answer${t.votes === 1 ? '' : 's'} in so far.`, { size: 20, weight: 700 });
  }

  adminSend(d, to) {
    this.presence?.adminCh?.send(d, to);
  }

  /** Everything the admin has set, sent to everyone now and then (and to anyone who joins). */
  broadcastAdmin(to) {
    if (this.isAdmin) this.adminSend({ k: 'state', lock: this.admin.lock, effects: this.admin.effects, lesson: this.adminLessonState?.() ?? null, tools: this.classTools?.snapshot() ?? null, lineup: this.roomLineUp?.adminMode, removed: this.admin.removed ?? [] }, to);
  }

  onPeerJoinedAdmin(id) {
    this.broadcastAdmin(id);
    if (this.roomRefOut) this.presence.roomCh?.send(this.roomRefOut, id);
  }

  /** Teacher: the look for every device in the class ('auto' = full, lightened only where needed; 'light'). */
  setClassEffects(mode) {
    this.admin.effects = mode;
    this.perf?.setMode(mode);
    this.broadcastAdmin();
    this.refresh();
  }

  toggleStudentLock() {
    this.admin.lock = !this.admin.lock;
    this.broadcastAdmin();
    this.refresh();
  }

  /** Remove someone from the session (press twice). */
  kick(id) {
    const armed = this.kickArmed?.id === id && performance.now() - this.kickArmed.t < 3000;
    if (!armed) {
      this.kickArmed = { id, t: performance.now() };
      setTimeout(() => this.refreshPlayerList(), 3100);
      this.refreshPlayerList();
      return;
    }
    this.kickArmed = null;
    this.adminSend({ k: 'kick' }, id);
    // everyone else stops listening to them too (the list goes out with the class settings)
    this.admin.removed = [...(this.admin.removed ?? []), id].slice(-60);
    this.presence.block([id]);
    this.broadcastAdmin();
    this.refresh();
  }

  /** The teacher removed this headset: leave, remember it for this code, and go back to the lessons. */
  removedByTeacher() {
    if (this.leavingRemoved) return;
    this.leavingRemoved = true;
    markRemoved(this.presence.code); // (and not straight back in with the code)
    this.presence.leave();
    this.explain({ title: 'You Have Left the Class', text: 'Your teacher removed you from the class. Going back to the lessons…' });
    const go = () => { location.href = this.lessonsURL(); };
    setTimeout(() => {
      const session = this.renderer.xr.getSession();
      if (session) session.end().then(go, go);
      else go();
    }, 3500);
  }

  /** Messages from the admin (students only). */
  onAdmin(d) {
    if (d.k === 'state') {
      const lock = !!d.lock;
      if (lock !== this.lockedByAdmin) {
        this.lockedByAdmin = lock;
        this.state.locked = lock; // locked: the lab and its panels cannot be moved
        if (lock) this.state.placing = false;
        this.refresh();
      }
      if (d.effects) this.perf?.setMode(d.effects);
      this.classTools?.apply(d.tools);
      this.roomLineUp?.apply(d.lineup);
      this.presence?.block(d.removed);
      if (Array.isArray(d.removed) && d.removed.includes(this.presence?.selfId)) this.removedByTeacher(); // (in case the one-off message was missed)
      this.onAdminLesson?.(d.lesson);
    } else if (d.k === 'kick') {
      this.removedByTeacher();
    } else if (d.k === 'refind' && this.roomLineUp) {
      this.roomLineUp.changed(); // line up again (floor marks: point at them again)
    } else if (d.k === 'refind' && this.roomScan) {
      this.roomScan.last = 0;
      this.presence.clearRoom('waiting');
    }
  }

  /** Every frame: the admin menu shows for the admin only; the admin re-sends its settings now and then. */
  updateAdmin(dt) {
    if (!this.adminPanel) return;
    const show = this.isAdmin && !this.menusHidden;
    if (show !== this.adminPanel.mesh.visible) {
      this.adminPanel.mesh.visible = show;
      if (show) this.adminPanel.redraw();
    }
    if (!this.isAdmin) return;
    this.adminClock += dt;
    if (this.adminClock > 3) {
      this.adminClock = 0;
      this.broadcastAdmin(); // in case a message was lost, or the admin changed
      if (this.roomRefOut) this.presence.roomCh?.send(this.roomRefOut);
    }
  }

  // ───────────── B (right controller): hide / show all menus ─────────────

  updateMenuButton() {
    if (!this.presenting || this.ownMenuToggle) return;
    let pressed = false;
    for (const src of this.renderer.xr.getSession()?.inputSources ?? []) {
      if (src.handedness === 'right' && src.gamepad?.buttons[5]?.pressed) pressed = true;
    }
    if (pressed && !this.menuButtonDown) this.toggleMenus();
    this.menuButtonDown = pressed;
  }

  toggleMenus() {
    this.menusHidden = !this.menusHidden;
    if (!this.menusHidden) {
      for (const p of this.panels) {
        if (p.mesh.userData.hiddenByMenu) p.mesh.visible = true;
        p.mesh.userData.hiddenByMenu = false;
      }
      if (this.playersListPanel) this.playersListPanel.mesh.visible = this.playersOpen;
      this.refresh();
    }
  }

  /** While menus are hidden, keep every panel hidden (lessons may show some again when they refresh). */
  hideMenus() {
    if (!this.menusHidden) return;
    for (const p of this.panels) {
      if (!p.mesh.visible) continue;
      p.mesh.visible = false;
      p.mesh.userData.hiddenByMenu = true;
    }
  }

  /** The 2D start screen: show the session code, or offer to start / join one. */
  initSessionUI(session) {
    const overlay = initStartScreen(this.lessonsURL());
    if (!overlay) return;
    const box = document.createElement('div');
    box.className = 'session-box';
    const url = new URL(location.href);
    if (session) {
      url.searchParams.set('session', session.code);
      url.searchParams.delete('host'); // the shared link makes others join, not host
      // …and tells them which teacher to trust (shared/net/teacherKey.js)
      this.presence?.keyReady.then(() => { if (this.presence.key) url.searchParams.set('teacher', this.presence.key.fp); });
      // what a first-time teacher needs: the code, big; what students do; who has joined (updated live)
      const where = session.sameRoom ? 'Everyone is in this room: the lessons line up with the classroom.' : 'Students may be in different rooms.';
      box.innerHTML = session.host
        ? `<p class="label">Your Class Code</p>
        <div class="bigcode" aria-label="Class code">${session.code}</div>
        <ol class="steps"><li>Students open this lesson, type <b>${session.code}</b> under Joining a Class? and press <b>Join the Class</b>.</li><li>Everyone presses <b>Enter VR</b>.</li></ol>
        <p class="who" id="session-who" role="status">Waiting for students to join…</p>
        <p class="note">${where}${session.sameRoom ? ' Each headset needs to have scanned the room once (Quest Settings › Physical Space › Space Setup).' : ''}</p>
        <div class="buttons"><button class="secondary" id="copy-link">Copy the Link for Students</button><button class="secondary" id="leave-session">End the Class Session</button></div>`
        : `<p class="label">You Are in Class <span class="code">${session.code}</span></p>
        <p class="who" id="session-who" role="status">Connecting to the class…</p>
        <p class="note">${where} Press <b>Enter VR</b> to begin.</p>
        <div class="buttons"><button class="secondary" id="copy-link">Copy the Link</button><button class="secondary" id="leave-session">Leave the Class</button></div>`;
      box.querySelector('#copy-link').onclick = (e) => {
        navigator.clipboard?.writeText(url.toString()).then(() => { e.target.textContent = 'Link Copied'; }).catch(() => prompt('Copy this link:', url.toString()));
      };
      box.querySelector('#leave-session').onclick = () => {
        url.searchParams.delete('session');
        url.searchParams.delete('room');
        location.href = url.toString();
      };
    } else {
      box.innerHTML = `<p class="label">Teaching a Class?</p>
        <p class="note">Start a class session, then share its code: every student joins your lesson and you lead it from the Teacher menu.</p>
        <div class="buttons"><button id="start-session">Start a Class Session</button></div>
        <p class="label join-label">Joining a Class?</p>
        <form class="buttons" id="join-form"><input id="join-code" maxlength="8" placeholder="CODE" autocomplete="off" aria-label="Class code"><button class="secondary">Join the Class</button></form>`;
      // (no "same room" choice: lining up with the real room needs every headset to have scanned it first, too much
      // to ask in a school; a lesson address with &room=same still turns it on)
      box.querySelector('#start-session').onclick = () => {
        url.searchParams.set('session', newSessionCode());
        url.searchParams.set('host', '1');
        location.href = url.toString();
      };
      box.querySelector('#join-form').onsubmit = async (e) => {
        e.preventDefault();
        const code = box.querySelector('#join-code').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!code) return;
        const btn = box.querySelector('#join-form button');
        btn.disabled = true;
        btn.textContent = 'Looking…';
        // ask the teacher's lesson which lesson it is and which teacher to trust (shared/net/teacherKey.js),
        // as the join box on the lessons page does; nobody answering: join with the code alone, as before
        let to = url;
        try {
          const found = await findClass(code, { net: url.searchParams.get('net') || 'p2p', timeoutMs: 12000 });
          to = new URL(`../${found.lesson}/`, location.href);
          for (const k of ['net', 'name']) if (url.searchParams.get(k)) to.searchParams.set(k, url.searchParams.get(k));
          if (found.sameRoom) to.searchParams.set('room', 'same');
          if (found.teacher) to.searchParams.set('teacher', found.teacher);
        } catch { /* not found in time */ }
        to.searchParams.set('session', code);
        location.href = to.toString();
      };
    }
    overlay.appendChild(box);
  }

  /** The start screen's line about who is in the class (the teacher sees students arrive). */
  updateSessionWho() {
    const el = document.getElementById('session-who');
    const pr = this.presence;
    if (!el || !pr) return;
    const others = pr.people.filter((p) => !p.you).map((p) => p.plain);
    let text;
    if (pr.status === 'failed' || pr.error) text = pr.error ?? 'Could not connect. Check the Wi-Fi, then reload the page.';
    else if (pr.status !== 'connected') text = 'Connecting to the class…';
    else if (!others.length) text = pr.host ? 'Waiting for students to join… Nobody has joined yet.' : 'Connected. Waiting for your teacher…';
    else if (pr.host) text = `${others.length} ${others.length === 1 ? 'student has' : 'students have'} joined: ${others.slice(0, 8).join(', ')}${others.length > 8 ? ' and more' : ''}.`;
    else {
      // (the teacher shows as 'your teacher', whatever name their headset has)
      const names = pr.people.filter((p) => !p.you).map((p) => (p.host ? 'your teacher' : p.plain));
      text = `In the class with ${names.slice(0, 8).join(', ')}${names.length > 8 ? ' and more' : ''}.`;
    }
    if (el.textContent !== text) el.textContent = text;
  }

  // ───────────── WebXR ─────────────

  async initXRButtons() {
    const arBtn = document.getElementById('btn-ar');
    const vrBtn = document.getElementById('btn-vr');
    const hint = document.getElementById('hint');
    if (!('xr' in navigator)) {
      arBtn.textContent = 'Mixed Reality Not Available';
      arBtn.classList.add('unavailable');
      hint.textContent = window.isSecureContext
        ? 'This browser has no WebXR. Open this page in the Meta Quest Browser (or Chrome on Android) for mixed reality — you can still explore on screen.'
        : 'WebXR needs a secure (https://) page. You can still explore on screen.';
      return;
    }
    const [ar, vr] = await Promise.all([
      navigator.xr.isSessionSupported('immersive-ar').catch(() => false),
      navigator.xr.isSessionSupported('immersive-vr').catch(() => false),
    ]);
    if (ar) {
      arBtn.disabled = false;
      arBtn.textContent = 'Enter Mixed Reality';
      arBtn.onclick = () => this.startSession('immersive-ar');
    } else {
      arBtn.textContent = 'Mixed Reality Not Supported Here';
      arBtn.classList.add('unavailable');
    }
    if (vr) {
      vrBtn.hidden = false;
      vrBtn.onclick = () => this.startSession('immersive-vr');
    }
    hint.textContent = ar
      ? 'Put on your headset and press “Enter Mixed Reality”. The lab appears in front of you.'
      : 'Explore on screen, or open this page on a mixed reality headset.';
  }

  async startSession(type) {
    try {
      const options = { optionalFeatures: ['local-floor', 'hand-tracking', 'hit-test', 'plane-detection'] };
      // real hands in front of the lab hide it (Quest 3's depth sensing; three.js draws the real depth first)
      this.depthRequested = type === 'immersive-ar' && !!this.realRoom?.handsInFront;
      if (this.depthRequested) {
        options.optionalFeatures.push('depth-sensing');
        options.depthSensing = { usagePreference: ['gpu-optimized'], dataFormatPreference: ['luminance-alpha', 'float32', 'unsigned-short'] };
      }
      const session = await navigator.xr.requestSession(type, options);
      let refType = 'local-floor';
      try {
        await session.requestReferenceSpace('local-floor');
      } catch {
        refType = 'local';
      }
      this.renderer.xr.setReferenceSpaceType(refType);
      await this.renderer.xr.setSession(session);
      this.onSessionStart(session, type === 'immersive-ar');
    } catch (err) {
      console.error(err);
      document.getElementById('hint').textContent = `Could not start the session: ${err.message}`;
    }
  }

  onSessionStart(session, isAR) {
    this.presenting = true;
    this.isAR = isAR;
    this.realRoom?.sessionStart();
    this.grounding?.sessionStart();
    // asked for depth sensing (Hands in front) and the headset could not give it (e.g. Quest 2): hide the setting
    if (isAR && this.depthRequested && Array.isArray(session.enabledFeatures) && !session.enabledFeatures.includes('depth-sensing')) this.realRoom?.markNoDepth();
    this.scene.background = isAR ? null : this.background;
    this.grid.visible = !isAR && !this.classroom;
    this.classroom?.setAR(isAR);
    document.body.classList.add('in-xr');
    this.needsPlacement = true;
    this.framesSinceStart = 0;
    this.perf?.start();
    this.loading?.enterXR();
    this.onXRStart?.(session, isAR);
    if (this.isAdmin) {
      let seen = null;
      try { seen = localStorage.getItem('webxr-classes:teacher-hint'); } catch {}
      if (!seen) {
        try { localStorage.setItem('webxr-classes:teacher-hint', '1'); } catch {}
        this.explain({ title: 'Your Teacher Menu', text: 'The Teacher menu is on your left. Use it to choose the activity for everyone, pause the class, start a timer and see who has joined.' });
      }
    }
    // recentring (or lost tracking) moves the headset's coordinates: the room line-up must be redone
    this.renderer.xr.getReferenceSpace()?.addEventListener?.('reset', () => this.onTrackingReset());

    if (isAR && session.requestHitTestSource) {
      session.requestReferenceSpace('viewer')
        .then((space) => session.requestHitTestSource({ space }))
        .then((source) => {
          this.hitTestSource = source;
          this.refresh();
        })
        .catch(() => { /* hit-test not available: placement in front of the user still works */ });
    }
    session.addEventListener('end', () => this.onSessionEnd());
    this.refresh();
  }

  onSessionEnd() {
    this.presenting = false;
    this.hitTestSource = null;
    this.reticle.visible = false;
    this.state.placing = false;
    this.scene.background = this.background;
    this.grid.visible = !this.classroom;
    this.classroom?.setAR(false);
    document.body.classList.remove('in-xr');
    this.perf?.end();
    this.onXREnd?.();
    // Each new headset session has a new coordinate system: the room frame is found again from the scan.
    this.presence?.clearRoom();
    this.roomLineUp?.reset();
    this.roomScan = null;
    this.recenter();
    this.refresh();
  }

  /** Put the lab in front of the user, just below eye height, facing them (closer and lower when seated). */
  placeInFrontOfUser() {
    const cam = this.renderer.xr.getCamera();
    const pos = new THREE.Vector3();
    const dir = new THREE.Vector3();
    cam.getWorldPosition(pos);
    cam.getWorldDirection(dir);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    this.lab.position.copy(pos).addScaledVector(dir, this.state.seated ? 0.68 : 0.85);
    this.lab.position.y = pos.y - (this.state.seated ? 0.22 : 0.15);
    this.lab.rotation.set(0, Math.atan2(-dir.x, -dir.z), 0);
    this.grounding?.lifted(); // floating in front of you: no shadow
    this.grounding?.arrive();
  }

  updateHitTest(frame) {
    if (!frame || !this.hitTestSource) return;
    const results = frame.getHitTestResults(this.hitTestSource);
    const pose = results.length && results[0].getPose(this.renderer.xr.getReferenceSpace());
    this.reticle.visible = !!pose && this.state.placing;
    if (!pose) return;
    this.reticle.matrix.fromArray(pose.transform.matrix);
    if (this.state.placing) {
      const p = new THREE.Vector3().setFromMatrixPosition(this.reticle.matrix);
      const cam = new THREE.Vector3();
      this.renderer.xr.getCamera().getWorldPosition(cam);
      this.lab.position.set(p.x, p.y + 0.3, p.z);
      this.lab.rotation.set(0, Math.atan2(cam.x - p.x, cam.z - p.z), 0);
    }
  }

  // ───────────── render loop ─────────────

  frame(frame) {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    if (this.presenting) {
      this.framesSinceStart++;
      // Wait a few frames so the headset pose is valid before placing the lab.
      if (this.needsPlacement && this.framesSinceStart > 3) {
        this.placeInFrontOfUser();
        this.needsPlacement = false;
      }
      this.updateHitTest(frame);
      this.onXRFrame?.(frame, this.renderer.xr.getReferenceSpace());
      // same room: every headset lines itself up from its room scan (nothing to press)
      if (this.presence?.sameRoom && (this.roomScan ??= new RoomScan()).update(frame, this.renderer.xr.getReferenceSpace())) this.updateRoomFrame();
      else if (!this.presence?.sameRoom && this.realRoom?.active) (this.roomScan ??= new RoomScan()).update(frame, this.renderer.xr.getReferenceSpace());
      this.updateMenuButton();
    } else {
      this.controls.update();
    }
    this.perf.update();
    this.interaction.update();
    this.sparks.update(dt);
    this.classroom?.update();
    this.loading?.update(dt);
    panelFrame();
    this.update(dt, frame);
    this.realRoom?.update(); // after the lesson has placed its board
    this.grounding?.update(dt);
    if (this.presence) {
      this.presence.update(dt);
      this.sessionRedraw = (this.sessionRedraw ?? 0) + dt;
      if (this.sessionRedraw > 1) {
        this.sessionRedraw = 0;
        this.sessionPanel.redraw();
        this.refreshPlayerList();
        this.updateSessionWho();
      }
      if (this.presence.sameRoom && !this.presenting && this.presence.roomStatus !== 'screen') {
        this.presence.clearRoom('screen');
        this.onRoomFrame?.();
      }
      this.updateAdmin(dt);
      this.classTools?.update(dt);
      this.roomLineUp?.update(dt);
    }
    this.hideMenus();
    this.layoutStacks();
    this.renderer.render(this.scene, this.camera);
  }
}

