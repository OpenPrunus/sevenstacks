// Sevenstacks — petits bruits de cartes synthétisés (aucun fichier audio). Il faut un geste de l'utilisateur : unlock().
let ctx = null;
let muted = false;
try { muted = localStorage.getItem('sevenstacks.muted') === '1'; } catch { /* ignoré */ }

export function unlock() {
  if (ctx || typeof AudioContext === 'undefined') {
    if (ctx?.state === 'suspended') ctx.resume();
    return;
  }
  ctx = new AudioContext();
}

export const isMuted = () => muted;
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem('sevenstacks.muted', m ? '1' : '0'); } catch { /* ignoré */ }
}

function tone(freq, dur, { type = 'triangle', gain = 0.05, delay = 0 } = {}) {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function snap(dur, { gain = 0.12, freq = 2200, delay = 0 } = {}) {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime + delay;
  const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 3;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(ctx.destination);
  src.start(t0);
}

export const sfx = {
  place: () => snap(0.05, { freq: 1800 }),
  flip: () => { snap(0.04, { freq: 3200, gain: 0.09 }); },
  draw: () => snap(0.06, { freq: 2600, gain: 0.08 }),
  found: () => { snap(0.04, { freq: 2000 }); tone(880, 0.12, { gain: 0.035, delay: 0.02 }); },
  nope: () => tone(160, 0.12, { type: 'square', gain: 0.03 }),
  win: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.25, { gain: 0.045, delay: i * 0.11 })),
};
