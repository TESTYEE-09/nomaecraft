// Procedural sound engine. No external assets — every effect is synthesized
// from oscillators + a small white-noise buffer. Created on first user gesture
// (browser autoplay policy) and reused for the rest of the session.

let ctx = null;
let master = null;
let noiseBuf = null;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  // pre-bake a 1s mono white noise buffer for impact / foot / hurt
  const n = ctx.sampleRate | 0;
  noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
  const ch = noiseBuf.getChannelData(0);
  for (let i = 0; i < n; i++) ch[i] = Math.random() * 2 - 1;
  return ctx;
}

export function resumeAudio() {
  const c = ensure();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}

function envGain(attack, decay, peak = 0.6) {
  const c = ensure(); if (!c) return null;
  const g = c.createGain();
  const t = c.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}

function rand(min, max) { return min + Math.random() * (max - min); }

// ---- helpers ----------------------------------------------------------------
function noiseSource() {
  const c = ensure(); if (!c || !noiseBuf) return null;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  return src;
}

function tone(freq, type = 'sine', detune = 0) {
  const c = ensure(); if (!c) return null;
  const o = c.createOscillator();
  o.type = type; o.frequency.value = freq; o.detune.value = detune;
  return o;
}

function biquad(type, freq, q = 1) {
  const c = ensure(); if (!c) return null;
  const f = c.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  return f;
}

function connectChain(nodes, dest) {
  for (let i = 0; i < nodes.length; i++) {
    nodes[i].connect(i + 1 < nodes.length ? nodes[i + 1] : dest);
  }
}

// ---- presets ----------------------------------------------------------------

// Mining: short noise burst through a band-pass — the classic "thunk"
export function playMine(material = 'stone') {
  const c = ensure(); if (!c) return;
  const t = c.currentTime;
  const profiles = {
    stone:   { freq: 320, q: 5,  dur: 0.10, gain: 0.45, click: 900 },
    dirt:    { freq: 180, q: 2,  dur: 0.09, gain: 0.35, click: 0   },
    sand:    { freq: 220, q: 1.5,dur: 0.07, gain: 0.30, click: 0   },
    wood:    { freq: 260, q: 3,  dur: 0.10, gain: 0.40, click: 700 },
    leaves:  { freq: 150, q: 0.6,dur: 0.12, gain: 0.28, click: 0   },
    glass:   { freq: 1200,q: 8,  dur: 0.06, gain: 0.50, click: 2200},
    default: { freq: 260, q: 3,  dur: 0.10, gain: 0.40, click: 600 },
  };
  const p = profiles[material] || profiles.default;
  // noise burst
  const n = noiseSource(); const bp = biquad('bandpass', p.freq * rand(0.9, 1.1), p.q);
  const g = envGain(0.005, p.dur, p.gain);
  if (n && bp && g) {
    n.connect(bp).connect(g).connect(master);
    n.start(t); n.stop(t + p.dur + 0.05);
  }
  // small click for hard blocks
  if (p.click > 0) {
    const o = tone(p.click * rand(0.9, 1.1), 'square');
    const og = envGain(0.001, 0.04, 0.18);
    if (o && og) { o.connect(og).connect(master); o.start(t); o.stop(t + 0.06); }
  }
}

// Block break: a louder, slightly longer version of the mining hit + debris rattle
export function playBreak(material = 'stone') {
  const c = ensure(); if (!c) return;
  const t = c.currentTime;
  // big thump
  playMine(material);
  // descending noise "rattle"
  const n = noiseSource();
  const lp = biquad('lowpass', 1800, 0.7);
  const g = envGain(0.003, 0.22, 0.5);
  if (n && lp && g) { n.connect(lp).connect(g).connect(master); n.start(t); n.stop(t + 0.28); }
  // low body
  const o = tone(rand(60, 90), 'sine');
  const og = envGain(0.005, 0.18, 0.45);
  if (o && og) { o.connect(og).connect(master); o.start(t); o.stop(t + 0.22); }
}

// Block place: woody knock (low-pass filtered noise + sine click)
export function playPlace(material = 'stone') {
  const c = ensure(); if (!c) return;
  const t = c.currentTime;
  const woodish = ['wood', 'planks', 'leaves', 'crafting_table', 'torch'].includes(material);
  if (woodish) {
    const n = noiseSource(); const lp = biquad('lowpass', 800, 1);
    const g = envGain(0.003, 0.10, 0.35);
    if (n && lp && g) { n.connect(lp).connect(g).connect(master); n.start(t); n.stop(t + 0.14); }
  } else {
    // stony click
    const n = noiseSource(); const bp = biquad('bandpass', 600, 4);
    const g = envGain(0.002, 0.08, 0.32);
    if (n && bp && g) { n.connect(bp).connect(g).connect(master); n.start(t); n.stop(t + 0.10); }
  }
  const o = tone(rand(280, 420), 'square');
  const og = envGain(0.001, 0.04, 0.12);
  if (o && og) { o.connect(og).connect(master); o.start(t); o.stop(t + 0.05); }
}

// Footstep: soft noise tap, pitch alternates with side
let stepSide = 0;
export function playStep(sprinting = false) {
  const c = ensure(); if (!c) return;
  const t = c.currentTime;
  stepSide = 1 - stepSide;
  const n = noiseSource();
  const lp = biquad('lowpass', 400 + (sprinting ? 150 : 0), 1);
  const g = envGain(0.002, 0.06, 0.18);
  if (n && lp && g) { n.connect(lp).connect(g).connect(master); n.start(t); n.stop(t + 0.08); }
  // very low body thud
  const o = tone(rand(70, 100) + stepSide * 10, 'sine');
  const og = envGain(0.002, 0.05, 0.18);
  if (o && og) { o.connect(og).connect(master); o.start(t); o.stop(t + 0.07); }
}

// Hurt: harsh low square + noise hiss
export function playHurt() {
  const c = ensure(); if (!c) return;
  const t = c.currentTime;
  const o = tone(rand(160, 200), 'sawtooth', rand(-30, 30));
  const og = envGain(0.005, 0.22, 0.4);
  if (o && og) { o.connect(og).connect(master); o.start(t); o.stop(t + 0.25); }
  const n = noiseSource(); const hp = biquad('highpass', 1200, 1);
  const ng = envGain(0.002, 0.18, 0.25);
  if (n && hp && ng) { n.connect(hp).connect(ng).connect(master); n.start(t); n.stop(t + 0.20); }
}

// Eat: quick ascending blip
export function playEat() {
  const c = ensure(); if (!c) return;
  const t = c.currentTime;
  const o = tone(400, 'square');
  o.frequency.setValueAtTime(400, t);
  o.frequency.exponentialRampToValueAtTime(900, t + 0.12);
  const g = envGain(0.005, 0.13, 0.22);
  if (o && g) { o.connect(g).connect(master); o.start(t); o.stop(t + 0.15); }
}

// Pickup: friendly two-note chime
export function playPickup() {
  const c = ensure(); if (!c) return;
  const t = c.currentTime;
  for (const [f, t0, dur] of [[700, 0, 0.07], [1100, 0.06, 0.10]]) {
    const o = tone(f, 'sine');
    const g = envGain(0.003, dur, 0.25);
    if (o && g) { o.connect(g).connect(master); o.start(t + t0); o.stop(t + t0 + dur + 0.02); }
  }
}

// Drop / throw item: descending whoosh
export function playDrop() {
  const c = ensure(); if (!c) return;
  const t = c.currentTime;
  const n = noiseSource(); const bp = biquad('bandpass', 800, 2);
  const g = envGain(0.003, 0.18, 0.22);
  if (n && bp && g) {
    bp.frequency.setValueAtTime(1200, t);
    bp.frequency.exponentialRampToValueAtTime(300, t + 0.15);
    n.connect(bp).connect(g).connect(master);
    n.start(t); n.stop(t + 0.20);
  }
}

// Mob hurt: short low thud
export function playMobHurt() {
  const c = ensure(); if (!c) return;
  const t = c.currentTime;
  const o = tone(rand(110, 150), 'square');
  const g = envGain(0.002, 0.08, 0.22);
  if (o && g) { o.connect(g).connect(master); o.start(t); o.stop(t + 0.10); }
}

// Map a block id to a sound-material label
export function blockMaterial(blockId) {
  // dirt/sand/gravel/snow → 'dirt'
  if ([2, 5, 18, 17].includes(blockId)) return 'sand';  // soft
  if (blockId === 7) return 'leaves';
  if ([6, 8, 16, 20].includes(blockId)) return 'wood';
  if (blockId === 15) return 'glass';
  return 'stone';
}
