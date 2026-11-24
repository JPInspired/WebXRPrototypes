import * as THREE from 'three';
import { connect } from './transport.js';
import { NET_CONFIG } from './config.js';
import { openLobby } from './lobby.js';
import { teacherKey, prove, check, pinned, pin, keysSupported, FP_RE } from './teacherKey.js';

// Shared sessions: everyone keeps their own models, and sees everyone else working beside them.
//
//  • Each person's lab is a "desk". Other people's desks appear side by side next to yours
//    (if you see someone on your right, they see you on their left).
//  • On each desk you see a live copy of that person's work, built by the lesson from the state they
//    share (lesson.netState / lesson.createReplica). There are no avatars: in mixed reality you see the
//    real people.
//  • Everything is sent relative to the sender's own lab, so it lines up whatever room they are in.
//  • Same-room sessions (?room=same): every headset lines itself up with the room from its room scan
//    (RoomAlign.js), so each desk appears where that person really is.
//  • Reconnecting (NET_CONFIG.autoReconnect): if this headset loses touch (it slept, the Wi-Fi dropped,
//    nobody has been heard from for a while) it leaves and joins again by itself, with the same id, so
//    its desk and work come straight back for everyone. A start that fails is retried (5, 10, 20, 30 s…).

const COLORS = [0x5b8cff, 0xff8a5c, 0x3ccf91, 0xffc94d, 0xb48cff, 0xff6b9a, 0x4cc9ff, 0xe0e070];
const SEAT_GAP = 1.75; // metres between desks
const POSE_HZ = 15;
const BEAT_MS = 2000; // a small "still here" to everyone, even in a background tab
const AWAY_MS = 7000; // nothing heard for this long: shown as "not responding"
const CHECK_MS = 4500; // after waking up: if nobody answers within this long, reconnect

export function sessionFromURL() {
  const p = new URLSearchParams(location.search);
  const code = p.get('session');
  const teacher = p.get('teacher');
  return code ? { code: code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8), net: p.get('net') || 'p2p', sameRoom: p.get('room') === 'same', host: p.get('host') === '1', teacher: FP_RE.test(teacher ?? '') ? teacher : null } : null;
}

export function myName() {
  try {
    return localStorage.getItem('webxr-classes:name') || 'Guest';
  } catch {
    return 'Guest';
  }
}

/** Two room frames within 1 cm and about half a degree: do not move anything. */
function nearlySame(a, b) {
  const pa = new THREE.Vector3().setFromMatrixPosition(a);
  const pb = new THREE.Vector3().setFromMatrixPosition(b);
  const xa = new THREE.Vector3(1, 0, 0).transformDirection(a);
  const xb = new THREE.Vector3(1, 0, 0).transformDirection(b);
  return pa.distanceTo(pb) < 0.01 && xa.dot(xb) > Math.cos(0.009);
}

const hashColor = (id) => COLORS[[...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length];
const q3 = (v) => Math.round(v * 1000) / 1000;

/** Numbers only, a sensible size: n finite numbers within ±1 km, or null. */
const nums = (a, n) => (Array.isArray(a) && a.length === n && a.every((v) => Number.isFinite(v) && Math.abs(v) < 1000) ? a : null);
/** Another headset's position message, checked (anything else in it is dropped). */
function cleanPose(d) {
  if (!d || typeof d !== 'object') return null;
  return { h: nums(d.h, 3), lab: nums(d.lab, 4), room: typeof d.room === 'string' ? d.room.slice(0, 16) : null };
}

export class Presence {
  constructor(app, { lessonId, code, net, sameRoom = false, host = false, teacher = null }) {
    this.app = app;
    this.host = host; // started the session: runs the shared world (if the lesson has one)
    this.code = code;
    // Who the real teacher is (shared/net/teacherKey.js): the teacher's headset signs its connection with a
    // secret key; everyone else trusts one key's fingerprint (from the code or link, or the one most trust).
    this.secure = keysSupported();
    if (teacher) pin(code, teacher);
    this.trusted = this.secure ? pinned(code) : null;
    this.key = null;
    this.keyReady = host && this.secure
      ? teacherKey(code).then((k) => { this.key = k; if (k) this.trusted = k.fp; }).catch((e) => console.warn('Teacher key:', e.message))
      : Promise.resolve();
    this.sameRoom = sameRoom;
    this.roomToWorld = null; // set once this headset has lined up with the room
    this.name = myName();
    this.status = 'connecting';
    this.error = null; // why it could not start (plain language)
    this.problem = null; // something going wrong while connected (plain language)
    this.peers = new Map();
    this.blocked = new Set(); // headsets the teacher removed: everything from them is ignored
    this.poseClock = 0;
    this.stateClock = 0;
    this.lastState = '';
    this.sinceFull = 0;
    this.net = net;
    this.lessonId = lessonId;
    this.roomId = `${lessonId}-${code}`;
    this.auto = NET_CONFIG.autoReconnect !== false;
    this.gen = 0; // which connection attempt is current
    this.tries = 0; // failed starts in a row (for the wait before the next)
    this.reconnects = 0;
    this.open();
    if (this.auto) {
      addEventListener('online', () => this.reconnect('online'));
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.hiddenAt = performance.now();
        else if (this.hiddenAt && performance.now() - this.hiddenAt > 4000) this.check('woke');
      });
      // once a second, whether or not the page is drawing (a background tab, or a headset that is off)
      this.beat = setInterval(() => {
        const now = performance.now();
        if (this.lastTick && now - this.lastTick > 5000) this.check('paused'); // the device slept
        this.lastTick = now;
        if (this.status !== 'connected') return;
        if (this.peers.size && now - (this.lastBeat ?? 0) >= BEAT_MS - 100) {
          this.lastBeat = now;
          this.beatCh?.send(1);
        }
        this.watch(now);
      }, 1000);
    }
  }

  /** Join the session (again). A failed start is retried by itself, waiting a little longer each time. */
  open() {
    const gen = ++this.gen;
    connect(this.net, this.roomId)
      .then((t) => {
        if (gen !== this.gen) return t.leave(); // (superseded by a newer attempt)
        this.tries = 0;
        this.retryAt = null;
        this.start(t);
      })
      .catch((e) => {
        if (gen !== this.gen) return;
        this.status = 'failed';
        this.error = e.message;
        if (this.auto) {
          const wait = Math.min(30, 5 * 2 ** this.tries++);
          this.retryAt = performance.now() + wait * 1000;
          clearTimeout(this.retryTimer);
          this.retryTimer = setTimeout(() => {
            if (gen !== this.gen) return;
            this.status = this.everConnected ? 'reconnecting' : 'connecting';
            this.app.refresh();
            this.open();
          }, wait * 1000);
        }
        this.app.refresh();
      });
  }

  /** Leave and join again (keeps everyone's desks: they come back with the same ids). */
  reconnect(reason) {
    if (!this.auto || this.status === 'connecting' || this.status === 'reconnecting') return;
    console.info('Shared session: reconnecting (' + reason + ')');
    clearTimeout(this.retryTimer);
    this.checkAt = null;
    this.lastReconnect = performance.now();
    this.reconnects++;
    this.closeTransport();
    this.status = 'reconnecting';
    this.app.refresh();
    this.open();
  }

  /** Something suggests the connection may be gone (woke up, long pause): reconnect unless someone answers soon. */
  check(reason) {
    if (!this.auto) return;
    if (this.status === 'failed') return this.reconnect(reason); // (try now rather than waiting)
    if (this.status !== 'connected') return;
    if (!this.peers.size) return this.reconnect(reason); // nobody to hear from: nothing to lose
    this.checkAt = performance.now();
    this.checkReason = reason;
    this.beatCh?.send(1);
  }

  closeTransport() {
    const t = this.t;
    const lobby = this.lobby;
    this.t = null;
    this.lobby = null;
    try { t?.leave(); } catch {}
    try { lobby?.leave(); } catch {}
  }

  /** Heard from someone: they are here. */
  heard(id) {
    const p = this.peers.get(id);
    if (!p) return;
    p.seen = performance.now();
    if (p.away) {
      p.away = false;
      this.app.refresh();
    }
  }

  start(t) {
    this.t = t;
    this.selfId = t.selfId;
    this.status = 'connected';
    this.everConnected = true;
    this.error = null;
    this.connectedAt = performance.now();
    // the teacher's lesson tells students who type only the code (top of the lessons page) where to go
    // the teacher's proof for this connection (sent with every hello)
    this.proof = null;
    this.proofReady = this.keyReady.then(async () => {
      if (this.key && this.t === t) this.proof = await prove(this.key, this.code, t.selfId);
    }).catch((e) => console.warn('Teacher proof:', e.message));
    if (this.host) {
      this.keyReady
        .then(() => openLobby(this.code, { lesson: this.lessonId, sameRoom: this.sameRoom, teacher: this.key?.fp ?? null }, this.net))
        .then((l) => (this.t === t ? (this.lobby = l) : l.leave()))
        .catch((e) => console.warn('Lobby:', e.message));
    }
    t.onProblem?.((text) => {
      if (this.peers.size) return; // already working with others: a hiccup with one more device
      this.problem = text;
      this.app.refresh();
    });
    setTimeout(() => this.app.refresh(), 20500); // "nobody found yet" help appears after 20 s
    // (every channel below ignores headsets the teacher has removed)
    const open = t.channel.bind(t);
    t.channel = (name) => {
      const c = open(name);
      return { send: c.send, onMessage: (fn) => c.onMessage((d, id) => { if (!this.blocked.has(id)) fn(d, id); }) };
    };
    this.helloCh = t.channel('hello');
    this.poseCh = t.channel('pose');
    this.stateCh = t.channel('state');
    // A lesson with ONE shared world (e.g. the reef): the host runs it and broadcasts it ('world');
    // everyone else asks the host to change things ('ask').
    this.worldCh = t.channel('world');
    this.askCh = t.channel('ask');
    this.worldCh.onMessage((d, id) => {
      if (id === this.hostId) this.app.onWorld?.(d, id); // (only whoever runs the shared world)
    });
    this.askCh.onMessage((d, id) => {
      if (this.isHost) this.app.onAsk?.(d, id);
    });
    // The admin (whoever opened the session) runs the class: settings for everyone ('admin') and the
    // room's fingerprint that every headset lines itself up with ('room'). Only the admin is listened to.
    this.roomRef = null;
    this.adminCh = t.channel('admin');
    this.adminCh.onMessage((d, id) => {
      if (id === this.hostId && this.peers.get(id)?.host && !this.isHost) this.app.onAdmin?.(d); // the real teacher only
    });
    this.roomCh = t.channel('room');
    this.roomCh.onMessage((d, id) => {
      if (id === this.hostId && this.peers.get(id)?.host && !this.isHost) this.roomRef = d;
    });
    this.beatCh = t.channel('beat');
    this.beatCh.onMessage((d, id) => this.heard(id));
    t.onPeerJoin((id) => {
      if (this.t !== t || this.blocked.has(id)) return;
      this.problem = null;
      this.ensure(id);
      this.heard(id);
      this.sayHello(id, t);
      if (this.isHost) setTimeout(() => {
        this.app.onPeerJoinedWorld?.(id);
        this.app.onPeerJoinedAdmin?.(id);
      }, 300);
      this.sendState(true, id);
      this.app.refresh();
    });
    t.onPeerLeave((id) => {
      if (this.t === t) this.remove(id); // (not when this headset is the one reconnecting)
    });
    this.helloCh.onMessage((d, id) => {
      if (!d || typeof d !== 'object') return;
      const p = this.ensure(id);
      this.heard(id);
      p.name = String(d.name ?? 'Guest').slice(0, 24);
      p.trust = typeof d.trust === 'string' && FP_RE.test(d.trust) ? d.trust : null;
      p.claims = !!d.host; // (says it is a teacher: no vote in decideTeacher)
      if (!this.secure) p.host = !!d.host; // (no cryptography here: as before)
      else if (d.host) {
        check(d.proof, this.code, id).then((fp) => {
          p.fp = fp; // a proven teacher key (or null)
          this.decideTeacher();
          p.host = !!fp && fp === this.trusted;
          this.app.refresh();
        });
      } else {
        p.host = false;
        this.decideTeacher();
      }
      this.app.refresh();
    });
    this.poseCh.onMessage((d, id) => {
      const pose = cleanPose(d);
      if (pose) this.ensure(id).pose = pose; // (a broken or made-up message is ignored, not drawn)
      this.heard(id);
    });
    this.stateCh.onMessage((d, id) => {
      const p = this.ensure(id);
      try {
        p.replica?.apply(d);
      } catch (e) {
        console.warn('Could not show a colleague’s work', e);
      }
    });
    this.app.refresh();
  }

  // ───────────── people ─────────────

  get people() {
    const hostId = this.hostId;
    return [
      { id: this.selfId, plain: this.name, name: `${this.name} (you)`, you: true, host: hostId === this.selfId, room: this.sameRoom ? this.roomStatus : null, color: hashColor(this.selfId ?? 'me') },
      ...[...this.peers.values()].map((p) => ({ id: p.id, plain: p.name, name: p.name, you: false, host: hostId === p.id, room: this.sameRoom ? p.pose?.room ?? 'waiting' : null, color: p.color, away: !!p.away })),
    ];
  }

  /**
   * Where the shared room frame is in this headset's world (see RoomAlign.js), or null.
   * status: 'ok' | 'unsure' (could not tell which way round) | 'no-scan' (no room scan) | 'waiting'.
   */
  setRoomFrame(matrix, status) {
    this.roomStatus = status;
    if (!matrix) {
      this.clearRoom(status);
      return false;
    }
    const changed = !this.roomToWorld || !nearlySame(this.roomToWorld, matrix);
    if (changed) {
      this.roomToWorld = matrix.clone();
      this.worldToRoom = matrix.clone().invert();
    }
    return changed;
  }

  clearRoom(status = 'waiting') {
    this.roomToWorld = null;
    this.worldToRoom = null;
    this.roomStatus = status;
  }

  /** Is this colleague shown at their real place in the room? */
  aligned(p) {
    return this.sameRoom && !!this.roomToWorld && !!p.pose?.lab;
  }

  ensure(id) {
    if (this.peers.has(id)) return this.peers.get(id);
    const color = hashColor(id);
    const root = new THREE.Group(); // their desk, placed beside yours
    this.app.lab.add(root);
    const p = { id, name: 'Guest', color, root, pose: null, seen: performance.now() };
    this.everJoined = true; // (so "waiting" can tell "nobody yet" from "everyone dropped out")
    p.replica = this.app.createReplica?.() ?? null;
    if (p.replica) root.add(p.replica.group);
    this.peers.set(id, p);
    this.layout();
    return p;
  }

  remove(id) {
    const p = this.peers.get(id);
    if (!p) return;
    this.app.lab.remove(p.root);
    this.peers.delete(id);
    this.layout();
    this.app.refresh();
  }

  /** Desks side by side, in the same order for everyone. */
  layout() {
    const ids = [this.selfId, ...this.peers.keys()].sort();
    const me = ids.indexOf(this.selfId);
    for (const p of this.peers.values()) {
      const k = ids.indexOf(p.id) - me;
      p.seat = { pos: new THREE.Vector3(k * SEAT_GAP, 0, Math.abs(k) * 0.25), yaw: -Math.sign(k) * 0.3 }; // turned a little towards you
      if (!this.aligned(p)) {
        p.root.position.copy(p.seat.pos);
        p.root.rotation.set(0, p.seat.yaw, 0);
      }
    }
  }

  /** Put a colleague's desk where their lab really is (same room, both lined up). */
  placeAtRealDesk(p) {
    const [x, y, z, yaw] = p.pose.lab;
    const theirLab = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
    const world = this.roomToWorld.clone().multiply(theirLab);
    this.app.lab.updateMatrixWorld();
    const local = this.app.lab.matrixWorld.clone().invert().multiply(world);
    local.decompose(p.root.position, p.root.quaternion, new THREE.Vector3());
  }

  // ───────────── sending ─────────────

  myPose() {
    const app = this.app;
    const cam = app.viewCamera();
    const pos = app.lab.worldToLocal(cam.getWorldPosition(new THREE.Vector3())); // where they are (e.g. so animals steer round them)
    // Same room: where my lab really is, in the shared room frame (so others can put my desk there).
    let lab = null;
    if (this.sameRoom && this.worldToRoom) {
      const m = this.worldToRoom.clone().multiply(app.lab.matrixWorld);
      const p = new THREE.Vector3();
      const r = new THREE.Quaternion();
      m.decompose(p, r, new THREE.Vector3());
      lab = [...p.toArray(), new THREE.Euler().setFromQuaternion(r, 'YXZ').y].map(q3);
    }
    return { h: pos.toArray().map(q3), lab, room: this.sameRoom ? this.roomStatus ?? 'waiting' : null };
  }

  /** Stop listening to these headsets (removed by the teacher) and take their desks away. */
  block(ids) {
    if (!Array.isArray(ids)) return;
    for (const id of ids.slice(0, 60)) {
      if (typeof id !== 'string' || id.length > 40 || id === this.selfId || this.blocked.has(id)) continue;
      this.blocked.add(id);
      this.remove(id);
    }
  }

  /** Say who this headset is (and, for the teacher, prove it). */
  sayHello(id, t = this.t) {
    this.proofReady.then(() => {
      if (this.t === t) this.helloCh.send({ name: this.name, host: this.host, proof: this.proof, trust: this.trusted }, id);
    });
  }

  /**
   * A student who was not told which teacher to trust (no code or link with it): after a moment, trust the
   * teacher key that most headsets here trust or prove, and keep it for this session.
   */
  decideTeacher() {
    if (!this.secure || this.trusted || this.deciding) return;
    this.deciding = setTimeout(() => {
      this.deciding = null;
      if (this.trusted) return;
      // Students' votes count (2 each); a teacher's own claim only breaks a tie (1), and a headset that
      // claims to be a teacher has no vote, so a pretend teacher cannot outvote the class on its own.
      const votes = new Map();
      for (const p of this.peers.values()) {
        if (p.claims) { if (p.fp) votes.set(p.fp, (votes.get(p.fp) ?? 0) + 1); }
        else if (p.trust) votes.set(p.trust, (votes.get(p.trust) ?? 0) + 2);
      }
      let best = null;
      for (const [fp, n] of votes) if (!best || n > best.n) best = { fp, n };
      if (!best) return;
      this.trusted = best.fp;
      pin(this.code, best.fp);
      for (const p of this.peers.values()) p.host = !!p.fp && p.fp === this.trusted;
      this.app.refresh();
    }, 1500);
  }

  /** Who runs the shared world: the (real) teacher, or (if they left) the first by id. */
  get hostId() {
    if (!this.selfId) return null;
    const all = [{ id: this.selfId, host: this.host }, ...[...this.peers.values()].map((p) => ({ id: p.id, host: !!p.host }))];
    const flagged = all.filter((x) => x.host).map((x) => x.id).sort();
    return flagged[0] ?? all.map((x) => x.id).sort()[0];
  }

  get isHost() {
    return !this.selfId || this.hostId === this.selfId;
  }

  sendWorld(data, to) {
    this.worldCh?.send(data, to);
  }

  ask(data) {
    const h = this.hostId;
    if (h && h !== this.selfId) this.askCh?.send(data, h);
  }

  sendState(force = false, to) {
    if (!this.stateCh || !this.app.netState) return;
    const s = this.app.netState();
    const json = JSON.stringify(s);
    if (!force && json === this.lastState) return;
    this.lastState = json;
    this.stateCh.send(s, to);
  }

  // ───────────── every frame ─────────────

  update(dt) {
    if (this.status !== 'connected') return;
    if (this.peers.size) {
      this.poseClock += dt;
      if (this.poseClock > 1 / POSE_HZ) {
        this.poseClock = 0;
        this.poseCh.send(this.myPose());
      }
      this.stateClock += dt;
      this.sinceFull += dt;
      if (this.stateClock > 0.3) {
        this.stateClock = 0;
        this.sendState(this.sinceFull > 4); // resend everything now and then, in case a message was lost
        if (this.sinceFull > 4) this.sinceFull = 0;
      }
    }
    for (const p of this.peers.values()) {
      try {
        p.replica?.update?.(dt);
      } catch (e) {
        if (!p.badUpdate) console.warn('Could not show a colleague’s work', e);
        p.badUpdate = true; // (one headset sending something odd must not stop the lesson for everyone)
      }
      if (!p.pose) continue;
      // Same room and lined up: their desk goes where it really is.
      const real = this.aligned(p);
      if (real) this.placeAtRealDesk(p);
      else if (p.seat && p.wasReal) {
        p.root.position.copy(p.seat.pos);
        p.root.rotation.set(0, p.seat.yaw, 0);
      }
      p.wasReal = real;
    }
  }

  /** Who has gone quiet, and whether it is this headset that has lost touch. */
  watch(now) {
    let anyHere = false;
    for (const p of this.peers.values()) {
      // kept through a reconnect, but they never came back: they really have gone
      if (p.seen < this.connectedAt && now - this.connectedAt > 20000) {
        this.remove(p.id);
        continue;
      }
      const away = now - p.seen > AWAY_MS;
      if (away !== !!p.away) {
        p.away = away;
        this.app.refresh();
      }
      if (!away) anyHere = true;
    }
    // after waking up: nobody answered
    if (this.checkAt && now - this.checkAt > CHECK_MS) {
      const answered = [...this.peers.values()].some((p) => p.seen > this.checkAt);
      const why = this.checkReason;
      this.checkAt = null;
      if (!answered) return this.reconnect(why);
    }
    // everyone went quiet at once: probably this headset. Try again, less often each time (20 s … 2 min).
    if (this.peers.size && !anyHere) {
      this.quietSince ??= now;
      const gap = Math.min(120000, 20000 * 2 ** Math.min(3, this.reconnects));
      if (now - this.quietSince > 8000 && now - (this.lastReconnect ?? 0) > gap) this.reconnect('silent');
    } else {
      this.quietSince = null;
      if (anyHere) this.reconnects = 0;
    }
  }

  /** Where a colleague's head is, in world space (or null). */
  headOf(p) {
    if (!p.pose?.h) return null;
    return p.root.localToWorld(new THREE.Vector3(p.pose.h[0], p.pose.h[1], p.pose.h[2]));
  }

  leave() {
    this.gen++;
    this.auto = false;
    clearTimeout(this.retryTimer);
    clearInterval(this.beat);
    this.closeTransport();
  }
}
