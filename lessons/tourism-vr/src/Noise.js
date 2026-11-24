// The lesson's two background sounds, made in code (the original's crowd recording was on ENGAGE's servers):
// a murmuring crowd, and city traffic. They fade in and out. Silent until the first press (browsers ask for that).

const LEVEL = 0.16;

export class Noise {
  constructor() {
    this.ctx = null;
    this.want = { crowd: false, city: false };
    this.muted = false;
    try { this.muted = localStorage.getItem('webxr-classes:sound') === 'off'; } catch { /* not remembered */ }
  }

  /** Call from a press: starts the audio. */
  wake() {
    const A = window.AudioContext ?? window.webkitAudioContext;
    if (this.ctx || !A) {
      this.ctx?.resume?.();
      return;
    }
    const a = (this.ctx = new A());
    const buf = a.createBuffer(1, a.sampleRate * 4, a.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    const layer = (filters) => {
      const out = a.createGain();
      out.gain.value = 0;
      out.connect(a.destination);
      for (const [freq, q, gain, wobble] of filters) {
        const s = a.createBufferSource();
        s.buffer = buf;
        s.loop = true;
        s.playbackRate.value = 0.8 + Math.random() * 0.5;
        const f = a.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = freq;
        f.Q.value = q;
        const g = a.createGain();
        g.gain.value = gain;
        // voices rise and fall
        const o = a.createOscillator();
        o.frequency.value = wobble;
        const og = a.createGain();
        og.gain.value = gain * 0.6;
        o.connect(og).connect(g.gain);
        s.connect(f).connect(g).connect(out);
        s.start();
        o.start();
      }
      return out;
    };
    this.layers = {
      crowd: layer([[320, 2, 2.2, 2.3], [520, 3, 2.4, 3.1], [760, 4, 2.2, 4.3], [1100, 4, 1.4, 5.2]]),
      city: layer([[90, 0.7, 2, 0.13], [240, 1, 0.9, 0.21], [600, 1.2, 0.4, 0.37]]),
    };
    this.apply();
  }

  crowd(on) {
    this.want.crowd = on;
    this.apply();
  }

  city(on) {
    this.want.city = on;
    this.apply();
  }

  setMuted(m) {
    this.muted = m;
    this.apply();
  }

  apply() {
    if (!this.layers) return;
    for (const [k, g] of Object.entries(this.layers)) g.gain.setTargetAtTime(this.want[k] && !this.muted ? LEVEL : 0, this.ctx.currentTime, 0.8);
  }
}
