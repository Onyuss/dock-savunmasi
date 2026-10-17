// Ses dosyası olmadan, WebAudio ile üretilen basit efektler.
let ctx = null;
let noise = null;
let master = null;
const last = {};

export function initAudio() {
  if (ctx) return;
  ctx = new AudioContext();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

function throttle(name, gap) {
  const t = ctx.currentTime;
  if (last[name] && t - last[name] < gap) return false;
  last[name] = t;
  return true;
}

function burst({ freq, q = 1, type = 'lowpass', dur, vol, pan = 0 }) {
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  const p = ctx.createStereoPanner();
  p.pan.value = pan;
  src.connect(f).connect(g).connect(p).connect(master);
  src.start(t, Math.random() * 0.5, dur + 0.05);
}

function tone({ freq, to, dur, vol, type = 'sine' }) {
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export const sfx = {
  rifle() {
    if (!ctx || !throttle('rifle', 0.05)) return;
    burst({ freq: 2200, type: 'bandpass', q: 0.8, dur: 0.09, vol: 0.5 });
  },
  apuGun(side = 0, vol = 1) {
    if (!ctx || !throttle('apu' + side + (vol < 1 ? 'ai' : ''), vol < 1 ? 0.09 : 0.04)) return;
    burst({ freq: 700, dur: 0.18, vol: 0.9 * vol, pan: side * 0.4 });
    tone({ freq: 120, to: 40, dur: 0.12, vol: 0.5 * vol });
  },
  flak(vol = 1) {
    if (!ctx || !throttle('flak' + (vol < 1 ? 'ai' : ''), vol < 1 ? 0.09 : 0.04)) return;
    burst({ freq: 1200, type: 'bandpass', q: 0.6, dur: 0.14, vol: 0.7 * vol });
  },
  step() {
    if (!ctx) return;
    tone({ freq: 70, to: 30, dur: 0.25, vol: 0.8 });
    burst({ freq: 300, dur: 0.15, vol: 0.3 });
  },
  pop() {
    if (!ctx || !throttle('pop', 0.03)) return;
    burst({ freq: 900, type: 'bandpass', q: 1.5, dur: 0.2, vol: 0.35 });
    tone({ freq: 500, to: 120, dur: 0.15, vol: 0.12, type: 'square' });
  },
  thud() {
    if (!ctx || !throttle('thud', 0.07)) return;
    tone({ freq: 95, to: 38, dur: 0.22, vol: 0.35 });
    burst({ freq: 500, dur: 0.12, vol: 0.25 });
  },
  hurt() {
    if (!ctx || !throttle('hurt', 0.25)) return;
    tone({ freq: 160, to: 60, dur: 0.2, vol: 0.4, type: 'sawtooth' });
  },
  overheat() {
    if (!ctx || !throttle('heat', 0.5)) return;
    burst({ freq: 4000, type: 'highpass', dur: 0.6, vol: 0.3 });
  },
  enter() {
    if (!ctx) return;
    tone({ freq: 200, to: 600, dur: 0.25, vol: 0.2, type: 'triangle' });
  },
  drill() {
    if (!ctx || !throttle('drill', 2)) return;
    tone({ freq: 55, to: 45, dur: 1.8, vol: 0.25, type: 'sawtooth' });
  },
};
