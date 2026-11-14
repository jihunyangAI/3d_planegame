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

// 드론 엔진음: 속도에 따라 높아지고, 부스트하면 바람 소리가 섞인다
let eng = null;
export function setEngine(speed, boosting, on) {
  if (!ctx) return;
  if (!eng) {
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o1.type = 'sawtooth'; o2.type = 'square'; f.type = 'lowpass'; f.frequency.value = 420; g.gain.value = 0;
    o1.connect(f); o2.connect(f); f.connect(g).connect(master); o1.start(); o2.start();
    const n = ctx.createBufferSource(), nf = ctx.createBiquadFilter(), ng = ctx.createGain();
    n.buffer = noiseBuf; n.loop = true; nf.type = 'bandpass'; nf.Q.value = 0.7; ng.gain.value = 0;
    n.connect(nf).connect(ng).connect(master); n.start();
    eng = { o1, o2, g, nf, ng };
  }
  const t = ctx.currentTime;
  eng.g.gain.setTargetAtTime(on ? 0.03 + speed * 0.028 : 0, t, 0.15);
  eng.o1.frequency.setTargetAtTime(62 + speed * 55 + (boosting ? 20 : 0), t, 0.2);
  eng.o2.frequency.setTargetAtTime(93 + speed * 82 + (boosting ? 30 : 0), t, 0.2);
  eng.ng.gain.setTargetAtTime(on ? speed * 0.045 + (boosting ? 0.07 : 0) : 0, t, 0.2);
  eng.nf.frequency.setTargetAtTime(700 + speed * 1400, t, 0.2);
}

// 주변 차들의 웅웅거림: level 0~1 (교통량과 거리로 정해진다)
let traffic = null;
export function setTraffic(level) {
  if (!ctx) return;
  if (!traffic) {
    const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    n.buffer = noiseBuf; n.loop = true; f.type = 'lowpass'; f.frequency.value = 300; g.gain.value = 0;
    n.connect(f).connect(g).connect(master); n.start();
    const o = ctx.createOscillator(), og = ctx.createGain();      // 낮게 깔리는 엔진 소리
    o.type = 'sawtooth'; o.frequency.value = 48; og.gain.value = 0;
    const of = ctx.createBiquadFilter(); of.type = 'lowpass'; of.frequency.value = 160;
    o.connect(of).connect(og).connect(master); o.start();
    traffic = { f, g, og };
  }
  const t = ctx.currentTime;
  traffic.g.gain.setTargetAtTime(level * 0.16, t, 0.3);
  traffic.f.frequency.setTargetAtTime(260 + level * 520, t, 0.3);
  traffic.og.gain.setTargetAtTime(level * 0.035, t, 0.3);
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
  count() { if (!ctx) return; tone('sine', 660, 660, 0.12, 0.22); },
  go() { if (!ctx) return; tone('sine', 990, 990, 0.32, 0.26); tone('triangle', 1485, 1485, 0.32, 0.1); },
  lock() { if (!ctx) return; tone('square', 1500, 1500, 0.06, 0.06); setTimeout(() => tone('square', 1500, 1500, 0.06, 0.06), 110); },
  alarm() { if (!ctx) return; [880, 660, 880, 660].forEach((f, i) => setTimeout(() => tone('sawtooth', f, f, 0.16, 0.09), i * 180)); },
  // 경적: 두 음을 겹친 짧은 '빵' (가끔 두 번)
  horn(vol = 1) {
    if (!ctx) return;
    const beep = () => { tone('square', 415, 410, 0.28, 0.05 * vol); tone('square', 520, 515, 0.28, 0.045 * vol); };
    beep();
    if (Math.random() < 0.4) setTimeout(beep, 380);
  },
  // 차가 바로 곁을 지나가는 소리
  pass(vol = 1) {
    if (!ctx) return;
    const t = ctx.currentTime, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(350, t); f.frequency.exponentialRampToValueAtTime(1100, t + 0.3); f.frequency.exponentialRampToValueAtTime(260, t + 0.8);
    g.gain.setValueAtTime(0.001, t); g.gain.exponentialRampToValueAtTime(0.22 * vol, t + 0.3); g.gain.exponentialRampToValueAtTime(0.001, t + 0.85);
    s.connect(f).connect(g).connect(master); s.start(t, Math.random() * 0.4, 0.9);
  },
  heart() { if (!ctx) return; tone('sine', 72, 44, 0.16, 0.4); },
  overheat() { if (!ctx) return; tone('square', 190, 85, 0.3, 0.13); noise(0.4, 0.07, 6000, 1500); },
};
