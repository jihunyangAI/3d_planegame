// 효과음. 파일 없이 WebAudio 로 합성한다. 첫 클릭 뒤 unlock() 을 불러야 소리가 난다.
let ctx = null, master = null, noiseBuf = null, muted = false;

export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.5; master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
}
export function toggleMute() { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.5; return muted; }

function tone(type, f0, f1, dur, vol) {
  const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol, cutoff0, cutoff1) {
  const t = ctx.currentTime, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf; f.type = 'lowpass';
  f.frequency.setValueAtTime(cutoff0, t); f.frequency.exponentialRampToValueAtTime(cutoff1, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f).connect(g).connect(master); s.start(t, Math.random() * 0.5, dur + 0.05);
}

// vol: 0~1 (거리에 따른 감쇠는 부르는 쪽에서)
export const sfx = {
  laser(vol = 1, pitch = 1) { if (!ctx) return; tone('sawtooth', 1250 * pitch, 240 * pitch, 0.13, 0.11 * vol); tone('square', 620 * pitch, 130 * pitch, 0.1, 0.05 * vol); },
  hurt(shield) { if (!ctx) return; if (shield) tone('sine', 520, 260, 0.14, 0.22); else { tone('sawtooth', 210, 70, 0.2, 0.26); noise(0.14, 0.2, 2600, 500); } },
  hit(vol = 1) { if (!ctx) return; tone('triangle', 1900, 900, 0.07, 0.2 * vol); },
  wall(vol = 1) { if (!ctx) return; noise(0.07, 0.1 * vol, 4000, 900); },
  explode(vol = 1) { if (!ctx) return; noise(0.7, 0.6 * vol, 1800, 70); tone('sine', 140, 35, 0.5, 0.45 * vol); },
  pickup() { if (!ctx) return; tone('sine', 660, 1320, 0.16, 0.2); tone('triangle', 990, 1980, 0.22, 0.1); },
  zone() { if (!ctx) return; tone('sine', 300, 180, 0.22, 0.16); },
  win() { if (!ctx) return; [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone('triangle', f, f, 0.35, 0.2), i * 140)); },
  lose() { if (!ctx) return; [392, 330, 262].forEach((f, i) => setTimeout(() => tone('triangle', f, f * 0.97, 0.4, 0.18), i * 200)); },
  overheat() { if (!ctx) return; tone('square', 190, 85, 0.3, 0.13); noise(0.4, 0.07, 6000, 1500); },
};
