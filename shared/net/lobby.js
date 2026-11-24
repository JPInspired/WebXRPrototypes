import { connect } from './transport.js';
import { FP_RE } from './teacherKey.js';

// Joining a class with only its code (from the top of the lessons page).
//
// Whoever starts a shared session (the teacher, ?host=1) also waits in a small "lobby" for that code.
// A student who types the code on the lessons page enters the same lobby, the teacher's lesson says
// which lesson it is (and whether the class is in the same room), and the student is taken straight there.
// The lobby uses the same connection as the lessons (transport.js), so it is also limited to devices on
// the same network. Nothing else is sent, and the student leaves the lobby as soon as they have the answer.

const lobbyRoom = (code) => `lobby-${code}`;

/** The teacher's side: answer anyone who asks which lesson this code belongs to. */
export async function openLobby(code, info, net = 'p2p') {
  const t = await connect(net, lobbyRoom(code));
  const ch = t.channel('which');
  const tell = (peerId) => ch.send({ ...info, code }, peerId);
  t.onPeerJoin(tell);
  ch.onMessage((_, peerId) => tell(peerId)); // asked again (e.g. the first answer was missed)
  return t;
}

/**
 * The student's side: find the lesson for a code. Resolves { lesson, sameRoom, teacher } (teacher: the
 * fingerprint of the teacher's key, see teacherKey.js), or rejects with a
 * plain-language Error if nobody answers within timeoutMs.
 */
export async function findClass(code, { net = 'p2p', timeoutMs = 20000 } = {}) {
  const t = await connect(net, lobbyRoom(code));
  const ch = t.channel('which');
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(ask);
      setTimeout(() => t.leave(), 300); // (a moment for the last message to be acknowledged)
      fn(value);
    };
    // Collect answers for a moment: only the teacher should answer, but if two headsets claim this code (a
    // student opening it with host=1), pass on no teacher at all, and the lesson finds the real one by
    // asking the headsets already there (Presence.decideTeacher).
    const answers = new Map(); // answering headset → its answer (each counted once)
    let settle = null;
    ch.onMessage((m, peerId) => {
      if (!m || typeof m.lesson !== 'string' || !/^[a-z0-9-]+$/.test(m.lesson)) return;
      answers.set(peerId, { lesson: m.lesson, sameRoom: !!m.sameRoom, teacher: FP_RE.test(m.teacher ?? '') ? m.teacher : null });
      settle ??= setTimeout(() => {
        const all = [...answers.values()];
        const agree = all.every((a) => a.teacher === all[0].teacher);
        finish(resolve, { ...all[0], teacher: agree ? all[0].teacher : null });
      }, 1500);
    });
    t.onPeerJoin((peerId) => ch.send({ ask: true }, peerId));
    const ask = setInterval(() => ch.send({ ask: true }), 2000);
    const timer = setTimeout(() => finish(reject, new Error('No class was found with that code. Check the code, that the teacher’s lesson is open, and that this device is on the same Wi-Fi as the teacher.')), timeoutMs);
  });
}
