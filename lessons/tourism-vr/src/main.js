import * as THREE from 'three';
import { LessonApp } from '../../../shared/LessonApp.js';
import { CanvasPanel, THEME } from '../../../shared/ui/CanvasPanel.js';
import { makeLabel } from '../../../shared/ui/labels.js';
import { sound } from '../../../shared/util/sound.js';
import { EFFECTS } from './data/effects.js';
import { AREAS, START, PLACES, PHRASES, PICTURES } from './data/place.js';
import { Town } from './Town.js';
import { Walk } from './Walk.js';
import { Noise } from './Noise.js';
import { MODELS, FLOATS, sign, letterBlock } from './models.js';

// The Impact of Tourism (Spanish), in virtual reality: Inspired's own ENGAGE lesson played again. Every object is where
// it was, and appears and goes at the times it did (data/effects.js). A button jumps the lesson's clock, as in ENGAGE.
// The town and the models are new (Town.js, models.js).

const TURNS = [['Turn: 30°', Math.PI / 6], ['Turn: 45°', Math.PI / 4], ['Turn: Smooth', 0]];
const TOUCH = 0.34; // how near a letter must come to its place (m)
const STAGES = [[0, 'The quiet town'], [300, '1. Bad tourist'], [1200, '2. Damage'], [2100, '3. Traffic'], [3000, '4. Mass tourism'], [4500, 'Knowledge check'], [5400, 'After the lesson']];

/** ENGAGE's angles (degrees, z forward) as a three.js turn (z back). */
function turn([x, y, z]) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(x * THREE.MathUtils.DEG2RAD, y * THREE.MathUtils.DEG2RAD, z * THREE.MathUtils.DEG2RAD, 'YXZ'));
  return new THREE.Quaternion(-q.x, -q.y, q.z, q.w);
}

class App extends LessonApp {
  constructor() {
    super({ labPos: new THREE.Vector3(0, 1.4, 0), background: 0xdcecf5 });
    this.state = {
      ...this.state, menu: true, turn: 0, quiz: { i: 0, picked: null, score: 0, open: false },
      explain: null,
    };
    this.grid.visible = false;
    this.camera.fov = 70;
    this.camera.near = 0.05;
    this.camera.far = 600;
    this.camera.updateProjectionMatrix();
    // walking instead of orbiting, on a screen
    this.controls.dispose();
    this.controls = { enabled: true, target: new THREE.Vector3(), update() {} };
    this.keys = new Set();
    this.ownMenuToggle = true;

    this.time = 0; // the lesson's clock, in seconds
    this.fired = new Map(); // trigger id → when it fired
    this.town = new Town(this.scene, AREAS);
    this.walk = new Walk(this, this.town);
    this.noise = new Noise();
    this.goTo(START.at, START.look, false);
    this.buildMenu();
    this.buildObjects();
    this.buildPhrases();
    this.buildQuiz();
    this.buildRings();
    this.initScreen();
    this.start();
    // (there is no information panel here, so the Teacher menu takes its place on the right)
    this.adminPanel?.mesh.position.set(0.64, 0.1, 0.1);
    if (this.adminPanel) this.adminPanel.mesh.rotation.y = -0.42;
    this.explain({ title: 'El impacto del turismo', text: 'Find the blue button, Effects of Tourism, and press it. There are four in the town.' });
  }

  // ───────────── the lesson's objects ─────────────

  buildObjects() {
    this.objects = [];
    this.pressable = [];
    this.letters = [];
    this.triggers = [];
    for (const e of EFFECTS) {
      const pos = new THREE.Vector3(e.p[0], e.p[1], -e.p[2]);
      let o = null;
      if (e.kind.startsWith('button')) {
        const blue = e.kind === 'button-blue';
        const w = [6, 35].includes(e.id) ? 0.64 : 1; // (those two stand close beside a text)
        o = sign(e.text, { w: w * e.s, h: w * 0.4 * e.s, bg: blue ? '#2554d8' : '#f4f6fb', ink: blue ? '#ffffff' : '#1b2340', edge: blue ? '#9fb8ff' : '#2554d8', size: 84 });
        Object.assign(o.userData, { handler: this, effect: e, tapOnly: true });
        this.pressable.push(o);
      } else if (e.kind === 'text') {
        // the boards of the knowledge check are close together; the others stand alone and can be larger
        const check = e.start > 4000 && e.start < 5000 && e.s > 1.1;
        const k = check ? e.s * 0.62 : 0.74 * e.s;
        o = sign(e.text.replace(/\s+l\s+/, '\n\n'), { w: k, h: check ? k * 0.82 : k, size: 60 });
      } else if (e.kind === 'picture') o = this.picture(e);
      else if (e.kind === 'letter') {
        o = letterBlock(e.letter);
        Object.assign(o.userData, { handler: this, effect: e, home: pos.clone() });
        this.letters.push(o);
      } else if (e.kind === 'letter-trigger') {
        o = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.04), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2, depthWrite: false }));
        o.add(new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry), new THREE.LineBasicMaterial({ color: 0xffffff })));
        this.triggers.push({ e, o, pos });
      } else if (MODELS[e.kind]) {
        o = MODELS[e.kind](e);
        if (!FLOATS.has(e.kind)) pos.y = 0;
        if (e.id === 9) pos.add(new THREE.Vector3(-2.4, 0, 1.6)); // (this crowd is life-size: clear of the text it stood beside)
        if (e.kind === 'ball') {
          Object.assign(o.userData, { handler: this, effect: e, home: pos.clone() });
          this.ball = o;
        }
      }
      if (o) {
        o.position.copy(pos);
        // people, animals, cars… stand upright; panels and floating things keep all their angles
        if (MODELS[e.kind] && !FLOATS.has(e.kind)) o.rotation.y = -e.e[1] * THREE.MathUtils.DEG2RAD;
        else if (e.kind === 'letter-trigger') o.rotation.y = -Math.PI / 2; // (a marker over its board)
        else if (e.kind === 'letter') o.rotation.y = 0;
        else if (e.kind === 'graffiti') o.quaternion.copy(turn([0, 90, 0]));
        else if (e.kind === 'star') o.rotation.set(0, -Math.PI / 2, 0);
        else o.quaternion.copy(turn(e.e));
        if (e.kind === 'graffiti') o.position.y = 1.35;
        if (e.kind === 'blackboard' || e.kind === 'whiteboard') {
          // straight, and just behind the words on it (the original's leaned a few degrees)
          o.rotation.y = Math.round(o.rotation.y / (Math.PI / 2)) * (Math.PI / 2);
          if (e.id === 66) o.position.z += 0.06;
          if (e.id === 65) o.position.x += 0.06;
        }
        if (e.kind === 'star') {
          o.scale.setScalar(e.s * 1.2);
          o.position.y += 0.75; // (above its letter, clear of the words)
        }
        o.visible = false;
        this.scene.add(o);
      }
      this.objects.push({ e, o, on: false, k: 0 });
    }
  }

  picture(e) {
    const file = PICTURES[e.name];
    const w = 1.3 * e.s;
    if (e.name === 'tourism') return null; // the whiteboard's picture: rebuilt as sentences (buildPhrases)
    const o = sign(`Picture to Be Replaced\n${e.name}`, { w, h: w * 0.62, bg: '#efe9dc', ink: '#6b6250', edge: '#8a5f3c', size: 56 });
    if (file) {
      new THREE.TextureLoader().load(new URL(`../pictures/${file}`, import.meta.url).href, (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        o.userData.face.map = t;
        o.userData.face.needsUpdate = true;
        o.scale.y = (t.image.height / t.image.width) / 0.62;
      });
    }
    return o;
  }

  /** Should an object be showing at this moment? */
  showing(e) {
    const t = this.time;
    if (e.after !== undefined) {
      const f = this.fired.get(e.after);
      return f !== undefined && this.real - f < e.end;
    }
    return t >= e.start && t < e.end;
  }

  updateObjects(dt) {
    for (const it of this.objects) {
      const { e, o } = it;
      const on = this.showing(e);
      if (on !== it.on) {
        it.on = on;
        this.switched(e, on, o);
      }
      if (!o) continue;
      // fade in and out over half a second (by growing, which costs nothing)
      it.k = THREE.MathUtils.clamp(it.k + (on ? dt : -dt) / 0.5, 0, 1);
      o.visible = it.k > 0;
      const held = this.interaction?.isHeld(o);
      if (o.visible && it.k < 1 && !held) {
        it.base ??= o.scale.clone();
        o.scale.copy(it.base).multiplyScalar(Math.max(0.01, it.k * it.k * (3 - 2 * it.k)));
      } else if (it.base && it.k >= 1) o.scale.copy(it.base);
      if (e.kind === 'star' && o.visible) o.rotation.y += dt * 1.2;
    }
  }

  switched(e, on, o) {
    if (e.kind === 'eerie-sky') this.town.setEerie(on);
    else if (e.kind === 'crowd-noise') this.noise.crowd(on);
    else if (e.kind === 'city-noise') this.noise.city(on);
    else if ((e.kind === 'letter' || e.kind === 'ball') && on) {
      o.position.copy(o.userData.home);
      if (e.kind === 'letter') this.fired.delete(this.triggers.find((t) => t.e.letter === e.letter)?.e.id);
    }
  }

  /** Jump the lesson's clock. */
  jump(to) {
    this.time = to;
    this.broadcastAdmin();
    this.refresh();
  }

  get stage() {
    return STAGES.filter(([t]) => this.time >= t).pop()[1];
  }

  // ───────────── pressing and picking up ─────────────

  describe(o) {
    const { effect: e, phrase, menu } = o.userData;
    if (menu) return 'Menu';
    if (phrase !== undefined) return 'Pick up';
    return e?.text ?? (e?.letter ? `Letter ${e.letter}` : '');
  }

  tap(o) {
    const e = o.userData.effect;
    if (!e?.kind?.startsWith('button')) return;
    this.noise.wake();
    if (this.followsAdmin) {
      this.explain({ title: 'Your Teacher Leads', text: 'In a class, your teacher presses the buttons, so the town changes for everyone at the same time.' });
      return;
    }
    this.fired.set(e.id, this.real);
    for (const x of EFFECTS) {
      if (x.after !== e.id) continue;
      if (x.kind === 'skip') this.jump(x.to);
      if (x.kind === 'quiz') this.openQuiz();
    }
    sound.power();
    this.interaction.pulseAll(0.4, 40);
  }

  grab(o) {
    if (o.userData.placed || o.userData.tapOnly) return null; // (buttons are pressed, not picked up)
    const keep = o.position.clone();
    return {
      move: (p) => {
        o.position.copy(p);
        if (o.userData.phrase !== undefined) o.lookAt(this.viewCamera().getWorldPosition(new THREE.Vector3()));
        if (o.userData.effect?.kind === 'letter') this.touch(o);
      },
      release: () => {
        if (o.userData.phrase !== undefined) this.dropPhrase(o);
        else if (o.userData.effect?.kind === 'letter') this.dropLetter(o);
        else if (o === this.ball) this.throwBall(keep);
      },
    };
  }

  /** How far apart two places are; on a screen, as seen along the view (a mouse cannot reach in or out). */
  gap(a, b) {
    if (this.presenting) return a.distanceTo(b);
    const eye = this.camera.position;
    const dir = a.clone().sub(eye).normalize();
    const along = b.clone().sub(eye).dot(dir);
    return along <= 0 ? Infinity : b.distanceTo(eye.clone().addScaledVector(dir, along));
  }

  /** A letter near its Spanish sentence: the star appears, as in the original. */
  touch(o) {
    const t = this.triggers.find((x) => x.e.letter === o.userData.effect.letter);
    if (!t || this.fired.has(t.e.id) || this.gap(o.position, t.pos) > TOUCH) return;
    this.fired.set(t.e.id, this.real);
    sound.correct();
    this.interaction.pulseAll(0.5, 60);
    if (this.triggers.every((x) => this.fired.has(x.e.id))) this.explain({ title: '¡Muy bien!', text: 'All four sentences are matched with their Spanish translations.', done: true });
  }

  dropLetter(o) {
    this.touch(o);
    const near = this.triggers.find((x) => this.gap(o.position, x.pos) < TOUCH);
    if (near && near.e.letter === o.userData.effect.letter) {
      o.position.copy(near.pos);
      o.position.x -= 0.08;
      o.rotation.y = -Math.PI / 2;
      return;
    }
    if (near) {
      sound.wrong();
      this.explain({ title: 'Not That One', text: 'Read the English above the letter again, and look for a word you know in the Spanish.' });
    }
    o.position.copy(o.userData.home);
    o.rotation.y = 0;
  }

  throwBall(from) {
    // it drops to the ground, then goes back to where it was
    const b = this.ball;
    b.userData.fall = { y: b.position.y, t: 0, from };
  }

  // ───────────── the whiteboard: match the phrases ─────────────

  buildPhrases() {
    const board = EFFECTS.find((e) => e.kind === 'whiteboard');
    const basket = EFFECTS.find((e) => e.kind === 'basket');
    const at = new THREE.Vector3(board.p[0], 0, -board.p[2]);
    const g = new THREE.Group();
    g.position.copy(at);
    g.rotation.y = -Math.PI / 2; // facing west, towards the plaza and the basket
    this.scene.add(g);
    this.slots = [];
    PHRASES.forEach((p, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = -0.79 + col * 1.58;
      const y = 2.0 - row * 0.55;
      const s = sign(p.en, { w: 0.78, h: 0.44, bg: '#e8eefc', ink: '#1b2340', edge: '#9fb0e0', size: 58 });
      s.position.set(x - 0.39, y, 0.05);
      const slot = new THREE.Mesh(new THREE.PlaneGeometry(0.74, 0.42), new THREE.MeshBasicMaterial({ color: 0x9aa8ff, transparent: true, opacity: 0.25, depthWrite: false }));
      slot.position.set(x + 0.39, y, 0.05);
      g.add(s, slot);
      this.slots.push(slot);
    });
    g.updateMatrixWorld(true);
    this.phraseCards = PHRASES.map((p, i) => {
      const c = sign(p.es, { w: 0.62, h: 0.36, bg: '#fff5dc', ink: '#4a2c14', edge: '#b5553a', size: 60 });
      // fanned out over the basket, facing you as you come from the plaza
      const k = [3, 0, 5, 1, 4, 2][i] ?? i; // (not in the order of the sentences)
      const a = (k - (PHRASES.length - 1) / 2) * 0.5;
      const home = new THREE.Vector3(basket.p[0] - 0.45 + (k % 2) * 0.1, 0.36 + (k % 2) * 0.42, -basket.p[2] + a * 0.75);
      c.position.copy(home);
      c.rotation.y = -Math.PI / 2;
      Object.assign(c.userData, { handler: this, phrase: i, home, turn: c.quaternion.clone() });
      this.scene.add(c);
      return c;
    });
    this.phraseGroup = g;
  }

  dropPhrase(c) {
    const w = new THREE.Vector3();
    let best = -1;
    let d = 0.4;
    this.slots.forEach((s, i) => {
      const k = this.gap(c.position, s.getWorldPosition(w));
      if (k < d && !this.phraseCards.some((x) => x.userData.placed === i + 1)) { d = k; best = i; }
    });
    if (best === c.userData.phrase) {
      c.userData.placed = best + 1;
      this.slots[best].getWorldPosition(c.position);
      c.position.x -= 0.02;
      c.quaternion.copy(c.userData.turn);
      c.scale.setScalar(1.15);
      c.userData.face.color.set(0xc4f5d4);
      const n = this.phraseCards.filter((x) => x.userData.placed).length;
      if (n < PHRASES.length) sound.correct();
      else this.explain({ title: '¡Perfecto!', text: 'Every phrase is on the board. Now decide together: which are benefits of tourism, and which are problems?', done: true });
      return;
    }
    if (best >= 0) sound.wrong();
    c.position.copy(c.userData.home);
    c.quaternion.copy(c.userData.turn);
  }

  // ───────────── the quiz ─────────────

  buildQuiz() {
    const e = EFFECTS.find((x) => x.kind === 'quiz');
    this.quizPanel = new CanvasPanel({ width: 0.8, height: 0.8, name: 'quiz', fit: 0.3 });
    this.quizPanel.mesh.position.set(e.p[0] + 0.5, 2.05, -e.p[2] + 0.1);
    this.quizPanel.mesh.scale.setScalar(1.5);
    this.quizPanel.mesh.visible = false;
    this.scene.add(this.quizPanel.mesh);
    this.quizPanel.setBuilder((ui) => this.drawQuiz(ui));
    this.panels.push(this.quizPanel);
  }

  openQuiz() {
    this.state.quiz = { i: 0, picked: null, score: 0, open: true };
    this.refresh();
  }

  drawQuiz(ui) {
    const q = this.state.quiz;
    ui.header('Alojamiento y casas', [{ id: 'quiz-close', label: '×', onClick: () => { q.open = false; this.refresh(); } }], { size: 36 });
    if (q.i >= PHRASES.length) {
      ui.title(`Score: ${q.score} of ${PHRASES.length}`, { size: 44 });
      ui.buttons([{ id: 'quiz-again', label: 'Try Again', onClick: () => this.openQuiz() }], { height: 70, size: 28 });
      return;
    }
    const cur = PHRASES[q.i];
    const right = q.picked === cur.benefit;
    ui.text(`¿Ventaja o problema?  ${q.i + 1} / ${PHRASES.length}`, { size: 26, weight: 700, color: THEME.accent });
    ui.title(cur.es, { size: 40 });
    ui.buttons([true, false].map((b) => ({
      id: `quiz-${b}`, label: b ? 'Ventaja' : 'Problema', active: q.picked != null && cur.benefit === b, color: q.picked === b && !right ? '#5a2f3a' : null,
      disabled: q.picked != null && cur.benefit !== b && q.picked !== b,
      onClick: () => {
        if (q.picked != null) return;
        q.picked = b;
        if (b === cur.benefit) q.score++;
        sound[b === cur.benefit ? 'correct' : 'wrong']();
        this.refresh();
      },
    })), { height: 80, size: 30 });
    if (q.picked == null) return;
    ui.box(`${right ? '✓ ' : '✗ '}${cur.en}.`, { size: 28, color: right ? '#7ee2a8' : '#ffc36b' });
    ui.buttons([{ id: 'quiz-next', label: q.i + 1 < PHRASES.length ? 'Next' : 'See My Score', onClick: () => { q.i++; q.picked = null; this.refresh(); } }], { height: 70, size: 28 });
  }

  // ───────────── the menu ─────────────

  buildMenu() {
    // one small panel in front of you (B or Y hides it), with the card above it
    this.lab.remove(this.infoPanel.mesh, this.explainPanel.mesh);
    this.panels = [this.controlPanel];
    this.controlPanel.mesh.position.set(-0.62, 0, 0.1);
    this.explainPanel = new CanvasPanel({ width: 0.62, height: 0.24, name: 'card' });
    this.explainPanel.mesh.position.set(0, 0.36, 0);
    this.lab.add(this.explainPanel.mesh);
    this.panels.push(this.explainPanel);
    this.controlPanel.setBuilder((ui) => this.drawMenu(ui));
    this.explainPanel.setBuilder((ui) => {
      const e = this.state.explain;
      if (!e) return;
      ui.header(e.title, [{ id: 'card-close', label: '×', onClick: () => { this.set({ explain: null }); this.refresh(); } }], { size: 36 });
      ui.text(e.text, { size: 27 });
    });
  }

  drawMenu(ui) {
    ui.header('The Impact of Tourism', [], { size: 30 });
    ui.text(this.stage, { size: 24, weight: 700, color: THEME.accent });
    if (!this.lockedByAdmin) ui.heading('Take me to', { size: 20 });
    if (!this.lockedByAdmin) ui.buttons(PLACES.map(([name, at, look]) => ({ id: `go-${name}`, label: name, onClick: () => this.goTo(at, look) })), { cols: 2, height: 48, size: 19, gap: 8 });
    ui.heading('Settings', { size: 20 });
    ui.buttons([
      { id: 'turn', label: TURNS[this.state.turn][0], onClick: () => { this.state.turn = (this.state.turn + 1) % TURNS.length; } },
      { id: 'sound', label: sound.muted ? 'Sound: Off' : 'Sound: On', active: !sound.muted, onClick: () => { sound.muted = !sound.muted; this.noise.setMuted(sound.muted); } },
      { id: 'restart', label: 'Start the Lesson Again', disabled: this.followsAdmin, onClick: () => this.restart() },
      ...(this.lockedByAdmin ? [] : [this.lessonsButton()]),
    ], { cols: 2, height: 48, size: 19, gap: 8 });
    ui.text(this.presenting ? 'B or Y hides this menu.' : 'M hides this menu. W A S D or a click on the ground to walk, drag to look.', { size: 18, color: THEME.dim });
  }

  restart() {
    this.fired.clear();
    for (const o of this.letters) {
      o.position.copy(o.userData.home);
      o.rotation.y = 0;
    }
    for (const c of this.phraseCards) {
      c.userData.placed = 0;
      c.position.copy(c.userData.home);
      c.quaternion.copy(c.userData.turn);
      c.scale.setScalar(1);
      c.userData.face.color.set(0xffffff);
    }
    this.state.quiz.open = false;
    this.set({ explain: null });
    this.jump(0);
    this.goTo(START.at, START.look);
  }

  refresh() {
    if (!this.objects) return;
    const on = this.state.menu;
    this.controlPanel.mesh.visible = on;
    this.explainPanel.mesh.visible = !!this.state.explain;
    this.quizPanel.mesh.visible = this.state.quiz.open;
    this.redrawPanels();
  }

  toggleMenu() {
    this.state.menu = !this.state.menu;
    this.labSnap = true;
    sound[this.state.menu ? 'open' : 'close']();
    this.refresh();
  }

  // ───────────── the teacher ─────────────

  adminLessonButtons() {
    return [
      { heading: 'Part of the lesson', cols: 2, text: 'Moves the lesson for everyone, as the buttons in the town do.', buttons: STAGES.slice(0, 6).map(([t, label]) => ({ id: `stage-${t}`, label, active: this.stage === label, onClick: () => this.jump(t ? t + 1 : 0) })) },
      { heading: 'Bring everyone', cols: 1, buttons: [{ id: 'bring', label: 'Bring Everyone to Me', onClick: () => this.bring() }] },
    ];
  }

  bring() {
    const p = this.viewCamera().getWorldPosition(new THREE.Vector3());
    const d = this.viewCamera().getWorldDirection(new THREE.Vector3());
    this.call = { n: (this.call?.n ?? 0) + 1, x: +p.x.toFixed(2), z: +p.z.toFixed(2), dx: +d.x.toFixed(3), dz: +d.z.toFixed(3) };
    this.broadcastAdmin();
    sound.attention();
  }

  adminLessonState() {
    return { t: +this.time.toFixed(2), call: this.call ?? null };
  }

  /** Students: the teacher's clock, and being brought to the teacher (checked, as it comes from another device). */
  onAdminLesson(l) {
    if (!l) return;
    if (Number.isFinite(l.t) && l.t >= 0 && l.t < 1e6 && Math.abs(l.t - this.time) > 1.5) {
      this.time = l.t;
      this.refresh();
    }
    const c = l.call;
    if (!this.heardTeacher) {
      // just joined: an earlier Bring Everyone is not for us
      this.heardTeacher = true;
      this.lastCall = c?.n;
      return;
    }
    if (c && [c.n, c.x, c.z, c.dx, c.dz].every(Number.isFinite) && c.n !== this.lastCall) {
      this.lastCall = c.n;
      // stand round the teacher, not on the same spot
      const a = Math.random() * Math.PI * 2;
      for (const r of [1.4, 1, 0.6, 0]) {
        const x = c.x + Math.cos(a) * r;
        const z = c.z + Math.sin(a) * r;
        if (!this.walk.ok(x, z)) continue;
        this.teleport(x, z, [x + c.dx, z + c.dz]);
        break;
      }
      sound.attention();
    }
  }

  // ───────────── other people ─────────────

  netState() {
    const p = this.viewCamera().getWorldPosition(new THREE.Vector3());
    const d = this.viewCamera().getWorldDirection(new THREE.Vector3());
    return { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), a: +Math.atan2(-d.x, -d.z).toFixed(2) };
  }

  /** Someone else: a simple head and body with their name, where they are in the town. */
  createReplica() {
    const body = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: 0x5b6cff });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14), new THREE.MeshLambertMaterial({ color: 0xf4efe6 }));
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.09, 0.08), new THREE.MeshLambertMaterial({ color: 0x20243a }));
    visor.position.set(0, 0.02, -0.1);
    head.add(visor);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.42, 4, 12), mat);
    torso.position.y = -0.5;
    body.add(head, torso);
    body.visible = false;
    this.scene.add(body);
    const avatar = { body, mat, want: null, label: null, name: '' };
    (this.avatars ??= []).push(avatar);
    const replica = {
      group: new THREE.Group(),
      apply: (s) => {
        if (s && [s.x, s.y, s.z, s.a].every((v) => Number.isFinite(v) && Math.abs(v) < 500)) avatar.want = s;
      },
    };
    avatar.replica = replica;
    return replica;
  }

  updateAvatars(dt) {
    if (!this.avatars) return;
    this.avatars = this.avatars.filter((a) => {
      const peer = [...(this.presence?.peers.values() ?? [])].find((p) => p.replica === a.replica);
      if (!peer) {
        a.age = (a.age ?? 0) + dt;
        if (!a.seen && a.age < 5) return true; // (only just made)
        this.scene.remove(a.body);
        return false;
      }
      a.seen = true;
      if (a.name !== peer.name) {
        a.name = peer.name;
        if (a.label) a.body.remove(a.label);
        a.label = makeLabel(peer.host ? 'Teacher' : peer.name, { height: 0.09 });
        a.label.position.y = 0.3;
        a.body.add(a.label);
        a.mat.color.set(peer.color ?? 0x5b6cff);
      }
      const w = a.want;
      if (!w) return true;
      const p = new THREE.Vector3(w.x, w.y, w.z);
      if (!a.body.visible || a.body.position.distanceTo(p) > 4) a.body.position.copy(p);
      a.body.visible = true;
      const k = 1 - Math.exp(-dt * 6);
      a.body.position.lerp(p, k);
      a.body.rotation.y += Math.atan2(Math.sin(w.a - a.body.rotation.y), Math.cos(w.a - a.body.rotation.y)) * k;
      return true;
    });
  }

  // ───────────── getting about ─────────────

  /** To a place in ENGAGE's metres. */
  goTo(at, look, smooth = true) {
    this.teleport(at[0], -at[1], look && [look[0], -look[1]], smooth);
  }

  teleport(x, z, look = null, smooth = true) {
    if (this.presenting && this.walk.baseRef) {
      this.walk.teleportXR(x, z, look);
      this.labSnap = true;
    } else this.walk.teleportDesk(x, z, look, smooth);
  }

  initXRButtons() {
    // virtual reality only
    const btn = document.getElementById('btn-ar');
    const hint = document.getElementById('hint');
    const none = (text) => {
      btn.textContent = text;
      btn.classList.add('unavailable');
      hint.textContent = 'Explore on screen: W A S D or a click on the ground to walk, drag to look, click the buttons.';
    };
    if (!('xr' in navigator)) return none('VR Not Available');
    navigator.xr.isSessionSupported('immersive-vr').catch(() => false).then((vr) => {
      if (!vr) return none('VR Not Supported Here');
      btn.textContent = 'Enter VR';
      btn.disabled = false;
      btn.onclick = () => {
        this.noise.wake();
        this.startSession('immersive-vr');
      };
      hint.textContent = 'Put on your headset and press Enter VR.';
    });
  }

  onXRStart() {
    this.grid.visible = false;
    this.walk.startXR();
    this.placedXR = false;
  }

  onXREnd() {
    this.walk.stopXR();
  }

  placeInFrontOfUser() {
    if (!this.placedXR) {
      const d = this.walk.desk; // start where you were on the screen
      this.walk.teleportXR(d.x, d.z, [d.x - Math.sin(d.yaw), d.z - Math.cos(d.yaw)]);
      this.placedXR = true;
    }
    this.labSnap = true;
  }

  recenter() {
    this.labSnap = true;
  }

  buildRings() {
    this.rings = [0, 1].map(() => {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.32, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x7ee2ff, transparent: true, opacity: 0.9, depthWrite: false }));
      m.visible = false;
      m.renderOrder = 8;
      this.scene.add(m);
      return m;
    });
  }

  onSelectNothing(c) {
    const p = c.userData.teleport;
    if (!p) return;
    this.teleport(p.x, p.z);
    this.interaction.pulse(0.3, 20, c);
  }

  updateXR(dt) {
    if (!this.walk.baseRef) return;
    this.interaction.controllers.forEach((c, i) => {
      const src = c.userData.inputSource;
      const ring = this.rings[i];
      ring.visible = false;
      c.userData.teleport = null;
      if (!src || c.userData.mode !== 'tracked-pointer') return;
      const pad = src.gamepad;
      if (pad && !this.interaction.blocked) {
        const ax = pad.axes[2] ?? 0;
        const ay = pad.axes[3] ?? 0;
        if (src.handedness === 'left') this.walk.moveXR(-ay, ax, dt);
        else {
          const angle = TURNS[this.state.turn][1];
          if (!angle) { if (Math.abs(ax) > 0.2) this.walk.turnXR(-ax * dt * 1.8); } else if (Math.abs(ax) > 0.7 && !c.userData.turned) {
            this.walk.turnXR(-Math.sign(ax) * angle);
            c.userData.turned = true;
          } else if (Math.abs(ax) < 0.3) c.userData.turned = false;
        }
        const b = !!pad.buttons[5]?.pressed;
        if (b && !c.userData.menuDown) this.toggleMenu();
        c.userData.menuDown = b;
      }
      if (this.interaction.blocked || this.interaction.active.has(c) || this.interaction.castFromController(c)) return;
      const from = new THREE.Vector3().setFromMatrixPosition(c.matrixWorld);
      const dir = new THREE.Vector3(0, 0, -1).applyMatrix4(new THREE.Matrix4().extractRotation(c.matrixWorld));
      const hit = this.walk.aim(from, dir);
      if (!hit) return;
      ring.position.set(hit.x, 0.06, hit.z);
      ring.visible = true;
      c.userData.teleport = hit;
      c.userData.line.scale.z = hit.distanceTo(from);
    });
  }

  initScreen() {
    const dom = this.renderer.domElement;
    const shrink = () => document.getElementById('overlay')?.setMini?.(true);
    dom.addEventListener('pointerdown', shrink, { once: true });
    addEventListener('keydown', (e) => {
      if (e.target.closest?.('input, textarea')) return;
      shrink();
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (k === 'm') this.toggleMenu();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
    const ray = (e) => {
      const r = dom.getBoundingClientRect();
      const rc = new THREE.Raycaster();
      rc.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
      return rc;
    };
    let drag = null;
    dom.addEventListener('pointerdown', (e) => {
      if (this.presenting) return;
      this.noise.wake();
      // (the shared input layer has already looked at what is under the mouse)
      drag = this.interaction.mouse?.hit ? null : { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY };
    });
    dom.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const d = this.walk.desk;
      d.yaw += (e.clientX - drag.x) * 0.004;
      d.pitch = Math.max(-1.2, Math.min(1.2, d.pitch + (e.clientY - drag.y) * 0.004));
      drag.x = e.clientX;
      drag.y = e.clientY;
    });
    dom.addEventListener('pointerup', (e) => {
      const was = drag;
      drag = null;
      if (!was || this.presenting || this.interaction.blocked || Math.hypot(e.clientX - was.sx, e.clientY - was.sy) > 6) return;
      const rc = ray(e);
      const hit = this.walk.aim(rc.ray.origin, rc.ray.direction);
      if (hit) this.walk.teleportDesk(hit.x, hit.z, null);
    });
  }

  /** (shared/ui/Interaction.js) On a screen, things are dragged at the depth they were picked up from. */
  dragPoint(o) {
    return o.getWorldPosition(new THREE.Vector3());
  }

  updateScreen(dt) {
    const k = this.keys;
    if (!this.interaction.blocked) {
      const f = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
      const s = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0);
      this.walk.desk.yaw += ((k.has('arrowleft') || k.has('q') ? 1 : 0) - (k.has('arrowright') || k.has('e') ? 1 : 0)) * dt * 1.6;
      if (f || s) this.walk.moveDesk(f, s, dt);
    }
    this.walk.update(dt, this.camera);
  }

  /** The menu and the card: a display on a screen; in the headset they come along when you go. */
  updateMenu(dt) {
    const lab = this.lab;
    const cam = this.viewCamera();
    const pos = cam.getWorldPosition(new THREE.Vector3());
    const dir = cam.getWorldDirection(new THREE.Vector3());
    if (!this.presenting) {
      lab.position.copy(pos).addScaledVector(dir, 1.15);
      lab.quaternion.copy(cam.getWorldQuaternion(new THREE.Quaternion()));
      return;
    }
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    const want = pos.clone().addScaledVector(dir, 0.95);
    want.y = pos.y - 0.12;
    const yaw = Math.atan2(-dir.x, -dir.z);
    const away = lab.position.distanceTo(want);
    const angle = Math.abs(Math.atan2(Math.sin(yaw - lab.rotation.y), Math.cos(yaw - lab.rotation.y)));
    if (this.labSnap || away > 3) {
      lab.position.copy(want);
      lab.rotation.set(0, yaw, 0);
      this.labSnap = this.follow = false;
      return;
    }
    if (this.interaction.labGrabber) return;
    if (away > 1.2 || angle > 1.1) this.follow = true;
    if (!this.follow) return;
    const k = Math.min(1, dt * 3);
    lab.position.lerp(want, k);
    lab.rotation.y += Math.atan2(Math.sin(yaw - lab.rotation.y), Math.cos(yaw - lab.rotation.y)) * k;
    if (away < 0.08 && angle < 0.05) this.follow = false;
  }

  grabTargets() {
    if (!this.objects) return [];
    const near = this.viewCamera().getWorldPosition(new THREE.Vector3());
    return [...this.pressable, ...this.letters, this.ball, ...this.phraseCards.filter((c) => !c.userData.placed)].filter((o) => o && o.visible && o.position.distanceTo(near) < 12);
  }

  update(dt) {
    this.real = performance.now() / 1000;
    if (!this.presence || this.isAdmin || this.presence.status === 'connected' || !this.followsAdmin) this.time += dt;
    const stage = this.stage;
    if (stage !== this.lastStage) {
      this.lastStage = stage;
      this.redrawPanels();
    }
    this.updateObjects(dt);
    this.town.update(dt);
    const b = this.ball;
    const f = b?.userData.fall;
    if (f) {
      f.t += dt;
      b.position.y = Math.max(0.11, f.y - 4.9 * f.t * f.t);
      if (f.t > 2.5) {
        b.position.copy(b.userData.home);
        b.userData.fall = null;
      }
    }
    if (this.presenting) this.updateXR(dt);
    else this.updateScreen(dt);
    this.updateMenu(dt);
    this.updateAvatars(dt);
  }
}

window.app = new App();
