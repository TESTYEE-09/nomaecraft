// Tiny procedural sound effects via Web Audio — no audio assets shipped,
// matching the project's "everything generated in code" approach to assets.

let ctx: AudioContext | null = null;

/** Must be called from inside a user-gesture handler (autoplay policy). */
export function initAudio(): void {
  if (ctx) return;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  ctx = new Ctor();
}

function noiseBurst(duration: number, filterFreq: number, gain: number): void {
  if (!ctx) return;
  const size = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, size, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < size; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / size);

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = filterFreq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  src.connect(filter).connect(g).connect(ctx.destination);
  src.start();
}

function tone(freq: number, duration: number, gain: number, type: OscillatorType): void {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  osc.connect(g).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration);
}

export function playBreak(): void {
  noiseBurst(0.12, 1100 + Math.random() * 600, 0.25);
}

export function playPlace(): void {
  noiseBurst(0.08, 280 + Math.random() * 100, 0.3);
}

export function playFootstep(): void {
  noiseBurst(0.06, 450 + Math.random() * 200, 0.1);
}

export function playJump(): void {
  tone(440, 0.08, 0.07, 'triangle');
}

export function playLand(): void {
  noiseBurst(0.1, 220, 0.16);
}
