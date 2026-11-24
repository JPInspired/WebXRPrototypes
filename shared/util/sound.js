// Small synthesised sound effects (no audio files), shared by every lesson so they all sound like one family:
// soft, warm and short. Browsers only allow audio after a tap/click, which always happens before anything here
// can play.
//
//   UI        tap (any menu button: played for you by the shared input code), click (same, for older lessons),
//             hover (a button lit up by a pointer or hand, in the headset), open / close (a pop-up card)
//   class     pause / resume, attention (Look Here), arrive (the lab appears or lands), land (on a surface)
//   hands     pick (picked something up), put (put it down: played for you unless the lesson made its own sound)
//   answers   correct / bond, wrong / refuse, done (a task finished: see LessonApp.celebrate)
//   lab       snap, thud, beep, power, release(kJ)
//   loops     loop('bubbles' | 'hum' | 'fizz') → { set(level 0..1), stop() } for sounds that last (fizzing, fans)
// Each headset can switch sound off (⚙ Settings › Sound): sound.muted, remembered on the headset.

const MUTE_KEY = 'webxr-classes:sound';
let muted = false;
try { muted = localStorage.getItem(MUTE_KEY) === 'off'; } catch { /* no storage: sound on */ }
const LEVEL = 0.9;

let ctx = null;
let out = null;
function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    // everything goes through one gentle compressor, so several sounds at once never get harsh
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    out = ctx.createGain();
    out.gain.value = muted ? 0 : LEVEL;
    out.connect(comp).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/** Counts every sound played: lets shared code tell whether a lesson already made a sound for an action. */
let stamp = 0;
const last = new Map(); // name → time, so the same sound twice in a few ms (lesson + shared code) plays once

function tone(freq, dur, { type = 'sine', gain = 0.15, to = null, attack = 0.006, delay = 0 } = {}) {
  const a = ac();
  if (!a) return;
  const t0 = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(out);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

/** A soft bell: a sine with a quiet overtone. */
function bell(freq, dur, gain, delay = 0) {
  tone(freq, dur, { gain, delay, attack: 0.004 });
  tone(freq * 2.01, dur * 0.6, { gain: gain * 0.25, delay, attack: 0.004 });
}

let noiseBuf = null;
function noiseBuffer(a) {
  if (!noiseBuf) {
    noiseBuf = a.createBuffer(1, a.sampleRate * 2, a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

function noise(dur, gain, freq, { type = 'lowpass', q = 0.7, delay = 0 } = {}) {
  const a = ac();
  if (!a) return;
  const t0 = a.currentTime + delay;
  const src = a.createBufferSource();
  src.buffer = noiseBuffer(a);
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(out);
  src.start(t0, Math.random());
  src.stop(t0 + dur + 0.02);
}

/** Wrap a sound so it counts towards `stamp` and does not double up when two callers play it at once. */
function play(name, fn, gapMs = 45) {
  return (...args) => {
    const now = performance.now();
    if (now - (last.get(name) ?? -1e9) < gapMs) return;
    last.set(name, now);
    stamp++;
    fn(...args);
  };
}

const tap = () => { tone(880, 0.06, { type: 'triangle', gain: 0.05, to: 700 }); noise(0.025, 0.04, 4000, { type: 'highpass' }); };
const correct = () => { bell(660, 0.35, 0.07); bell(990, 0.45, 0.07, 0.09); };
const wrong = () => { tone(220, 0.16, { type: 'triangle', gain: 0.08, to: 180 }); tone(196, 0.22, { type: 'triangle', gain: 0.07, to: 160, delay: 0.12 }); };

export const sound = {
  get stamp() { return stamp; },

  /** Sound switched off on this headset (Settings › Sound). */
  get muted() { return muted; },
  set muted(m) {
    muted = !!m;
    try { localStorage.setItem(MUTE_KEY, muted ? 'off' : 'on'); } catch { /* not remembered */ }
    if (out) out.gain.setTargetAtTime(muted ? 0 : LEVEL, ctx.currentTime, 0.05);
  },

  // UI (quiet: they happen often)
  hover: play('hover', () => tone(1400, 0.025, { type: 'sine', gain: 0.012, attack: 0.002 }), 70),
  open: play('open', () => { tone(520, 0.14, { gain: 0.035, to: 780 }); noise(0.1, 0.012, 3000, { type: 'highpass' }); }, 120),
  close: play('close', () => { tone(700, 0.12, { gain: 0.03, to: 460 }); noise(0.08, 0.01, 2500, { type: 'highpass' }); }, 120),

  // the class
  pause: play('pause', () => { bell(784, 0.5, 0.05); bell(523, 0.7, 0.05, 0.14); }, 300),
  resume: play('resume', () => { bell(523, 0.4, 0.05); bell(784, 0.6, 0.05, 0.12); }, 300),
  attention: play('attention', () => { bell(880, 0.5, 0.055); bell(1175, 0.7, 0.05, 0.16); bell(880, 0.8, 0.035, 0.32); }, 400),
  arrive: play('arrive', () => { noise(0.45, 0.03, 900, { type: 'bandpass', q: 0.8 }); tone(330, 0.5, { gain: 0.03, to: 495, attack: 0.08 }); }, 300),
  land: play('land', () => { tone(180, 0.16, { gain: 0.08, to: 90 }); noise(0.07, 0.04, 900); }, 200),

  // UI
  tap: play('tap', tap, 60),
  click: play('tap', tap, 60), // older name: the same sound as every other menu button

  // hands
  pick: play('pick', () => { tone(520, 0.08, { gain: 0.05, to: 700 }); noise(0.04, 0.03, 2500); }),
  put: play('put', () => { tone(300, 0.1, { gain: 0.07, to: 220 }); noise(0.05, 0.05, 1500); }),

  // answers
  correct: play('correct', correct, 80),
  bond: play('correct', correct, 80), // older name
  wrong: play('wrong', wrong, 80),
  refuse: play('wrong', wrong, 80), // older name
  done: play('done', () => {
    [523, 659, 784, 1047].forEach((f, i) => bell(f, 0.7, 0.06, i * 0.09));
    noise(0.5, 0.02, 7000, { type: 'highpass', delay: 0.3 });
  }, 400),

  // lab
  snap: play('snap', () => { noise(0.06, 0.25, 2600); tone(320, 0.12, { type: 'triangle', gain: 0.09, to: 150 }); }),
  thud: play('thud', () => { tone(150, 0.18, { gain: 0.18, to: 60 }); noise(0.08, 0.08, 400); }),
  beep: play('beep', () => tone(1000, 0.2, { gain: 0.07, attack: 0.01 })),
  power: play('power', () => { tone(220, 0.18, { type: 'triangle', gain: 0.08 }); tone(330, 0.2, { type: 'triangle', gain: 0.08, delay: 0.1 }); tone(440, 0.3, { type: 'triangle', gain: 0.08, delay: 0.2 }); }, 200),
  /** A whoomph whose size depends on how much energy was released (kJ/mol). */
  release: play('release', (kj) => {
    const k = Math.min(1, Math.abs(kj) / 800);
    noise(0.6 + k, 0.3 + 0.5 * k, 600 + 1500 * k);
    tone(90, 0.8 + k, { gain: 0.2 + 0.25 * k, to: 35 });
    bell(660, 0.5, 0.05, 0.25);
  }, 150),

  /**
   * A sound that lasts: 'bubbles' (gas bubbling through water), 'fizz' (a fast fizzing reaction) or 'hum'
   * (computer fans). set(level) from 0 (silent) to 1; stop() when done. Quietly does nothing without audio.
   */
  loop(kind) {
    const a = ac();
    if (!a) return { set() {}, stop() {} };
    const g = a.createGain();
    g.gain.value = 0;
    g.connect(out);
    let level = 0;
    let timer = null;
    let nodes = [];
    if (kind === 'hum') {
      // fans: filtered noise (air) plus a low tone (motor)
      const src = a.createBufferSource();
      src.buffer = noiseBuffer(a);
      src.loop = true;
      const f = a.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 500;
      f.Q.value = 0.6;
      const air = a.createGain();
      air.gain.value = 0.05;
      src.connect(f).connect(air).connect(g);
      const o = a.createOscillator();
      o.frequency.value = 118;
      const og = a.createGain();
      og.gain.value = 0.012;
      o.connect(og).connect(g);
      src.start();
      o.start();
      nodes = [src, o];
    } else {
      // bubbles / fizz: many tiny rising blips; more of them as the level goes up
      const fizz = kind === 'fizz';
      const blip = () => {
        if (level > 0.02) {
          const t0 = a.currentTime;
          const o = a.createOscillator();
          const bg = a.createGain();
          const f0 = fizz ? 1800 + Math.random() * 2500 : 350 + Math.random() * 600;
          o.frequency.setValueAtTime(f0, t0);
          o.frequency.exponentialRampToValueAtTime(f0 * (fizz ? 1.3 : 1.8), t0 + 0.05);
          bg.gain.setValueAtTime(0.0001, t0);
          bg.gain.exponentialRampToValueAtTime(fizz ? 0.025 : 0.05, t0 + 0.004);
          bg.gain.exponentialRampToValueAtTime(0.0001, t0 + (fizz ? 0.03 : 0.07));
          o.connect(bg).connect(g);
          o.start(t0);
          o.stop(t0 + 0.09);
        }
        const rate = fizz ? 8 + 60 * level : 2 + 20 * level; // blips per second
        timer = setTimeout(blip, (1000 / rate) * (0.4 + Math.random() * 1.2));
      };
      blip();
    }
    return {
      set(v) {
        level = Math.max(0, Math.min(1, v));
        g.gain.setTargetAtTime(level, a.currentTime, 0.15);
      },
      stop() {
        clearTimeout(timer);
        g.gain.setTargetAtTime(0, a.currentTime, 0.1);
        setTimeout(() => { for (const n of nodes) try { n.stop(); } catch { /* already stopped */ } g.disconnect(); }, 600);
      },
    };
  },
};
