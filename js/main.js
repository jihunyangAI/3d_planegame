// 홍대 드론 로얄: 8명 중 마지막 1명이 이기는 한 판 (자기장 · 아이템 · 난이도)
import * as THREE from 'three';
import { buildCity } from './city.js';
import { World } from './world.js';
import { buildStreet } from './street.js';
import { buildPeople } from './people.js';
import { Nav } from './nav.js';
import { Fighter } from './fighter.js';
import { Bot } from './bots.js';
import { Zone } from './zone.js';
import { Items, ITEM } from './items.js';
import { CFG, DIFFS, applyDifficulty } from './config.js';
import { Bolts } from './weapons.js';
import { Particles } from './fx.js';
import { sfx, unlock as unlockAudio, toggleMute, setEngine, setTraffic } from './audio.js';

const D = window.MAP_DATA;
const $ = id => document.getElementById(id);
const { clamp } = THREE.MathUtils;

// ---------- 장면 ----------
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CFG.camera.fov, innerWidth / innerHeight, 0.3, 40000);
camera.rotation.order = 'YXZ';
const renderer = new THREE.WebGLRenderer({ antialias: true });
let pixelRatio = Math.min(devicePixelRatio, 1.5);       // 느리면 자동으로 낮춘다 (tick 참고)
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
$('app').appendChild(renderer.domElement);
const canvas = renderer.domElement;

const city = buildCity(scene, renderer, D);
const street = buildStreet(scene, D, city.lampPos);
const people = buildPeople(scene, D);
const world = new World(D);
const nav = new Nav(D, world);
world.addProps(city.colliders.concat(street.colliders));     // 나무·옥상 구조물·기둥·이정표 (길찾기 그래프를 만든 뒤에 넣는다)
const zone = new Zone(scene, D.radius);
const items = new Items(scene, D, world, nav);

// ---------- 전투원 ----------
const ENEMY = 0xff5a4a;
const me = new Fighter(scene, '나', CFG.laser.color, CFG.player, true);
const bots = Array.from({ length: CFG.bot.count }, (_, i) => new Bot(new Fighter(scene, '적 ' + (i + 1), ENEMY, CFG.bot)));
const fighters = [me, ...bots.map(b => b.f)];
const fx = new Particles(scene), bolts = new Bolts(scene);

const blob = new THREE.Mesh(new THREE.CircleGeometry(1.9, 24),            // 고도를 가늠하게 해 주는 바닥 그림자
  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
blob.rotation.x = -Math.PI / 2;
scene.add(blob);

// 적이 쏘기 전에 보여 주는 붉은 조준선
const beamGeo = new THREE.CylinderGeometry(0.09, 0.09, 1, 6, 1, true); beamGeo.rotateX(Math.PI / 2); beamGeo.translate(0, 0, 0.5);   // 원점에서 +Z 로 뻗는 막대
const beams = bots.map(() => {
  const m = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.9, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
  m.frustumCulled = false; m.visible = false; m.renderOrder = 4;
  scene.add(m);
  return m;
});

// ---------- 경기 ----------
const aim = { yaw: 0, pitch: -0.12 };
let lives = CFG.player.lives, respawnT = 0, deadWhy = '', livesShown = -1;      // 남은 목숨, 재출격까지 남은 시간
const look = { x: 0, y: 0 };                       // 아직 시점에 반영하지 않은 마우스 회전량
let over = false, spectate = null, zoneTick = 0, startT = 0, lastCount = 0, prevShrink = false, shake = 0, heartT = 0;
// 가장 멀리 트인 방향(길을 따라)
function openYaw(x, y, z) {
  let best = -1, yaw = 0;
  for (let a = 0; a < 32; a++) {
    const t = world.raycast(x, y, z, -Math.sin(a * Math.PI / 16), 0, -Math.cos(a * Math.PI / 16), 600);
    if (t > best) { best = t; yaw = a * Math.PI / 16; }
  }
  return yaw;
}
function startMatch() {
  over = false; spectate = null; zoneTick = 0; shake = 0;
  lives = CFG.player.lives; respawnT = 0; look.x = look.y = 0;
  hurt = 0; toastTimer = 0; hud.toast.classList.remove('show');      // 지난 경기의 피격 표시와 알림을 지운다
  startT = 3; lastCount = 4; prevShrink = false;      // 3초 초읽기 뒤에 시작
  zone.reset(nav); items.reset();
  // 참가자를 길 위에 서로 떨어뜨려 놓는다
  const taken = [];
  let spread = CFG.match.spawnSpread;
  for (const f of fighters) {
    let x = 0, z = 0;
    for (let k = 0; ; k++) {
      const n = nav.random(); x = nav.x[n]; z = nav.z[n];
      if (taken.every(p => Math.hypot(p[0] - x, p[1] - z) > spread)) break;
      if (k % 50 === 49) spread *= 0.85;             // 자리가 없으면 간격을 줄인다
    }
    taken.push([x, z]);
    f.kills = f.deaths = 0;
    if (f === me) {
      aim.yaw = openYaw(x, CFG.spawnAlt, z); aim.pitch = -0.12;
      me.spawn(x, CFG.spawnAlt, z, aim.yaw, 3 + CFG.player.spawnProtect);
    } else {
      const b = bots.find(o => o.f === f);
      b.reset();
      f.maxHp = CFG.bot.hp; f.maxShield = CFG.bot.shield;      // 난이도에 따라 달라진다
      f.spawn(x, b.alt, z, Math.random() * 6.283, 0);
    }
  }
  camDist = CFG.camera.dist;
  for (const b of bolts.list) b.alive = false;
  hud.dead.classList.remove('show'); hud.result.classList.remove('show');
  while (feed.length) feed.pop().el.remove();
  hud.diff.textContent = DIFFS[CFG.difficulty].label;
}
// 재출격을 기다리는 나도 아직 경기에 남아 있는 것으로 센다
const waiting = () => respawnT > 0 && !me.alive;
const aliveCount = () => fighters.reduce((n, f) => n + (f.alive ? 1 : 0), 0) + (waiting() ? 1 : 0);
// 목숨이 남았을 때: 자기장 안쪽, 적에게서 떨어진 길 위에 다시 나온다
function respawnMe() {
  let best = -1, bestScore = -Infinity, far = 140;
  for (let k = 0; k < 240; k++) {
    const n = nav.random(), x = nav.x[n], z = nav.z[n];
    const inside = zone.cur.r - Math.hypot(x - zone.cur.x, z - zone.cur.z);
    let near = 1e9;
    for (const f of fighters) if (f.alive) near = Math.min(near, Math.hypot(f.pos.x - x, f.pos.z - z));
    if (inside > 20 && near > far) { best = n; break; }
    const score = Math.min(inside, 20) * 4 + Math.min(near, far);       // 딱 맞는 자리가 없으면 가장 나은 곳
    if (score > bestScore) { bestScore = score; best = n; }
    if (k % 40 === 39) far *= 0.75;
  }
  const x = nav.x[best], z = nav.z[best];
  respawnT = 0;
  aim.yaw = openYaw(x, CFG.spawnAlt, z); aim.pitch = -0.12; look.x = look.y = 0; turn = 0;
  me.spawn(x, CFG.spawnAlt, z, aim.yaw, CFG.player.spawnProtect);
  spectate = null; camDist = CFG.camera.dist; hurt = 0;
  hud.dead.classList.remove('show');
  toast(lives > 1 ? `재출격! 남은 목숨 ${lives}` : '재출격! 마지막 목숨입니다');
  sfx.go();
}

function onDeath(victim, killer) {
  fx.burst(victim.pos, 44, COL.fire, 27, 1.7, 0.95, 6);
  fx.burst(victim.pos, 16, victim.isPlayer ? COL.laser : COL.red, 12, 2.6, 0.6, 2);
  fx.burst(victim.pos, 10, COL.hot, 6, 4.2, 0.3);
  fx.emit(victim.pos.x, victim.pos.y, victim.pos.z, 0, 0, 0, COL.hot, 16, 0.16);
  sfx.explode(loud(victim.pos));
  addFeed(killer, victim);
  shake += Math.max(0, 1 - victim.pos.distanceTo(view().pos) / 70) * 0.6;
  if (victim === me) {
    lives--;
    if (lives > 0 && !over) respawnT = CFG.player.respawnDelay;      // 목숨이 남았으면 잠시 뒤 다시 출격
  }
  const left = aliveCount();
  if (victim === me) {
    deadWhy = killer ? killer.name + '의 레이저에 맞았습니다' : '자기장에 휩쓸렸습니다';
    hud.dead.classList.add('show'); hurt = 1;
    if (waiting()) hud.deadSub.textContent = `${deadWhy} · 남은 목숨 ${lives} · ${Math.ceil(respawnT)}초 뒤 재출격`;
    else {
      me.place = left + 1;
      hud.deadSub.textContent = `${deadWhy} · ${me.place}위 · 남은 싸움을 관전 중 · R 다시 시작`;
      spectate = killer && killer.alive ? killer : null;
    }
  } else {
    victim.place = left + 1;
    if (killer === me) { hitMark(true); toast(victim.name + ' 격추!'); }
  }
  if (left <= 1 && !over) endMatch(fighters.find(f => f.alive) || (waiting() ? me : null));
}
function endMatch(winner) {
  over = true;
  const won = winner === me;
  hud.dead.classList.remove('show');
  hud.result.className = 'hud show' + (won ? '' : ' lost');
  hud.resTitle.textContent = won ? '우승!' : me.place + '위';
  hud.resSub.textContent = `격추 ${me.kills}` + (won ? ' · 마지막까지 살아남았습니다' : winner ? ` · 우승: ${winner.name}` : ' · 우승자 없음');
  if (won) sfx.win(); else sfx.lose();
  // 난이도별 전적 (이 브라우저에만 저장)
  let line = '';
  try {
    const all = JSON.parse(localStorage.getItem('hdr-stats') || '{}'), st = all[CFG.difficulty] || { plays: 0, wins: 0 };
    st.plays++; if (won) st.wins++;
    all[CFG.difficulty] = st;
    localStorage.setItem('hdr-stats', JSON.stringify(all));
    line = `${DIFFS[CFG.difficulty].label} 난이도 · ${st.plays}판 중 우승 ${st.wins}회`;
  } catch (e) {}
  hud.resStats.textContent = line;
}

// 격추된 기체: 불붙은 채 돌면서 떨어지다가 건물이나 땅에 부딪혀 한 번 더 터진다
const _wv = new THREE.Vector3();
function updateWrecks() {
  for (const f of fighters) {
    if (!f.wrecking) continue;
    f.wreckT += dt;
    f.vel.y -= 16 * dt; f.vel.x *= 1 - 0.6 * dt; f.vel.z *= 1 - 0.6 * dt;
    f.pos.addScaledVector(f.vel, dt);
    const m = f.drone.model;
    m.tilt.rotation.x += 2.6 * dt; m.tilt.rotation.z += 1.9 * dt;
    fx.emit(f.pos.x, f.pos.y + 0.3, f.pos.z, (Math.random() - 0.5) * 3, 2 + Math.random() * 3, (Math.random() - 0.5) * 3, Math.random() < 0.5 ? COL.fire : COL.smoke, 1.6 + Math.random(), 0.6);
    _wv.copy(f.vel);
    if (world.collideSphere(f.pos, 1.2, _wv, 1.0, 999) || f.pos.y <= 1.05 || f.wreckT > 8) {
      fx.burst(f.pos, 26, COL.fire, 18, 1.5, 0.8, 8);
      fx.emit(f.pos.x, f.pos.y, f.pos.z, 0, 0, 0, COL.hot, 11, 0.14);
      sfx.explode(loud(f.pos) * 0.6);
      shake += Math.max(0, 1 - f.pos.distanceTo(view().pos) / 60) * 0.4;
      f.wrecking = false; m.root.visible = false; m.tilt.rotation.set(0, 0, 0);
    }
  }
}

// ---------- 입력 ----------
const keys = new Set();
const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight']);
let zoom = false, trigger = false, playing = false, debugPlay = false;
let sensScale = 1;                                 // [ ] 키로 바꾸는 마우스 감도 배율 (이 브라우저에 저장)
try { sensScale = clamp(parseFloat(localStorage.getItem('hdr-sens')) || 1, 0.3, 3); } catch (e) {}
addEventListener('keydown', e => {
  if (GAME_KEYS.has(e.code)) e.preventDefault();
  keys.add(e.code);
  if (e.code === 'KeyR' && playing) { startMatch(); toast('새 경기'); }
  if (e.code === 'KeyM') toast(toggleMute() ? '소리 끔' : '소리 켬');
  if (!playing && DIFF_KEYS[e.code]) setDifficulty(DIFF_KEYS[e.code]);
  if (e.code === 'KeyT') { const names = Object.keys(TIMES); setTimeOfDay(names[(names.indexOf(timeName) + 1) % names.length]); toast('시간대: ' + TIMES[timeName].label); }
  if (e.code === 'BracketLeft' || e.code === 'BracketRight') {        // 마우스 감도
    sensScale = clamp(sensScale * (e.code === 'BracketRight' ? 1.15 : 1 / 1.15), 0.3, 3);
    try { localStorage.setItem('hdr-sens', sensScale.toFixed(3)); } catch (err) {}
    toast('마우스 감도 ' + Math.round(sensScale * 100) + '%');
  }
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); zoom = trigger = false; });
canvas.addEventListener('mousedown', e => { if (e.button === 2) zoom = true; if (e.button === 0 && playing) trigger = true; });
addEventListener('mouseup', e => { if (e.button === 2) zoom = false; if (e.button === 0) trigger = false; });
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('mousemove', e => {
  if (document.pointerLockElement !== canvas || !me.alive) return;
  // 바로 돌리지 않고 쌓아 두었다가 simulate() 에서 부드럽게 따라붙는다. 튀는 값은 잘라 낸다.
  const s = CFG.mouse.sens * sensScale * (camera.fov / CFG.camera.fov), m = CFG.mouse.maxStep;
  look.x -= clamp(e.movementX, -m, m) * s;
  look.y -= clamp(e.movementY, -m, m) * s;
});
const overlay = $('overlay');
overlay.addEventListener('click', () => canvas.requestPointerLock());
// 난이도: 시작·일시 정지 화면의 버튼 또는 1·2·3 키. 바꾸면 새 경기가 준비된다.
const DIFF_KEYS = { Digit1: 'easy', Digit2: 'normal', Digit3: 'hard' };
const diffButtons = [...document.querySelectorAll('#diffs button')];
function setDifficulty(name, restart = true) {
  applyDifficulty(name);
  try { localStorage.setItem('hdr-diff', CFG.difficulty); } catch (e) {}
  diffButtons.forEach(b => b.classList.toggle('on', b.dataset.diff === CFG.difficulty));
  if (restart) { startMatch(); $('ov-title').textContent = '홍대 드론 로얄'; $('ov-go').textContent = '클릭하면 시작합니다'; }
}
diffButtons.forEach(b => b.addEventListener('click', e => { e.stopPropagation(); setDifficulty(b.dataset.diff); }));
// 시간대: 시작·일시 정지 화면의 버튼 또는 T 키. 경기 중에도 바로 바뀐다.
const TIMES = { day: { label: '낮', hour: CFG.timeOfDay }, dusk: { label: '노을', hour: 17.75 }, night: { label: '밤', hour: 21 } };
const timeButtons = [...document.querySelectorAll('#times button')];
let timeName = 'day';
function setTimeOfDay(name) {
  timeName = TIMES[name] ? name : 'day';
  city.setTime(TIMES[timeName].hour);
  try { localStorage.setItem('hdr-time', timeName); } catch (e) {}
  timeButtons.forEach(b => b.classList.toggle('on', b.dataset.time === timeName));
}
timeButtons.forEach(b => b.addEventListener('click', e => { e.stopPropagation(); setTimeOfDay(b.dataset.time); }));
canvas.addEventListener('click', () => { if (document.pointerLockElement !== canvas) canvas.requestPointerLock(); });
document.addEventListener('pointerlockchange', () => {
  playing = document.pointerLockElement === canvas;
  overlay.classList.toggle('hidden', playing);
  if (playing) unlockAudio();
  if (!playing) { keys.clear(); zoom = trigger = false; $('ov-title').textContent = '일시 정지'; $('ov-go').textContent = '클릭하면 계속합니다'; }
});
const axis = (pos, neg) => (pos.some(k => keys.has(k)) ? 1 : 0) - (neg.some(k => keys.has(k)) ? 1 : 0);

// ---------- 미니맵 ----------
const MM = { size: 190, range: 230, px: 1.0 };       // 표시 크기(px), 표시 반경(m), 원본 해상도(px/m)
const mapImg = document.createElement('canvas');
{
  const R = D.radius, S = Math.ceil(2 * R * MM.px);
  mapImg.width = mapImg.height = S;
  const g = mapImg.getContext('2d');
  g.translate(S / 2, S / 2); g.scale(MM.px, -MM.px);                    // 지도 좌표 (x 동, y 북)
  g.fillStyle = '#10151c'; g.fillRect(-R, -R, 2 * R, 2 * R);
  g.beginPath(); g.arc(0, 0, R, 0, 7); g.fillStyle = '#39404a'; g.fill();
  const poly = f => { g.moveTo(f[0], f[1]); for (let i = 2; i < f.length; i += 2) g.lineTo(f[i], f[i + 1]); g.closePath(); };
  g.fillStyle = '#4c6b4a';
  for (const gr of D.greens) { g.beginPath(); poly(gr[1]); g.fill(); }
  g.lineCap = g.lineJoin = 'round';
  for (const [grp, w, , f] of D.roads) {
    if (grp === 4 || grp === 6) continue;
    g.beginPath(); g.moveTo(f[0], f[1]); for (let i = 2; i < f.length; i += 2) g.lineTo(f[i], f[i + 1]);
    g.strokeStyle = grp <= 2 ? '#1d2229' : '#272d35'; g.lineWidth = w; g.stroke();
  }
  for (const [H, , , f, holes] of D.buildings) {                        // 넘을 수 없는 고층은 주황색
    g.beginPath(); poly(f); for (const h of holes) poly(h);
    g.fillStyle = H > CFG.drone.ceiling ? '#d98a4a' : '#8d96a3'; g.fill('evenodd');
  }
}
const mm = $('minimap'); mm.width = mm.height = MM.size * 2;             // 2배 해상도로 그린다
const mctx = mm.getContext('2d');
function drawMinimap() {
  const S = mm.width, c = S / 2, k = c / MM.range, v = view();
  const px = v.pos.x, pz = v.pos.z;
  mctx.clearRect(0, 0, S, S);
  mctx.save();
  mctx.beginPath(); mctx.arc(c, c, c - 2, 0, 7); mctx.clip();
  mctx.fillStyle = '#10151c'; mctx.fillRect(0, 0, S, S);
  const sx = (px - MM.range + D.radius) * MM.px, sy = (D.radius + pz - MM.range) * MM.px, sw = 2 * MM.range * MM.px;
  mctx.drawImage(mapImg, sx, sy, sw, sw, 0, 0, S, S);
  // 자기장: 바깥을 보랏빛으로 덮고, 다음 원은 흰 점선
  const zc = zone.cur, zn = zone.next;
  mctx.beginPath(); mctx.rect(0, 0, S, S); mctx.arc(c + (zc.x - px) * k, c + (zc.z - pz) * k, Math.max(0, zc.r * k), 0, 7);
  mctx.fillStyle = 'rgba(138,107,255,.42)'; mctx.fill('evenodd');
  mctx.beginPath(); mctx.arc(c + (zc.x - px) * k, c + (zc.z - pz) * k, Math.max(0, zc.r * k), 0, 7);
  mctx.strokeStyle = '#b9a6ff'; mctx.lineWidth = 3; mctx.stroke();
  if (!zone.done && zn.r > 0) {
    mctx.beginPath(); mctx.arc(c + (zn.x - px) * k, c + (zn.z - pz) * k, zn.r * k, 0, 7);
    mctx.setLineDash([10, 8]); mctx.strokeStyle = '#ffffff'; mctx.lineWidth = 2.5; mctx.stroke(); mctx.setLineDash([]);
  }
  const lim = c - 12;
  for (const it of items.list) {                                        // 아이템: 종류 색의 마름모
    if (!it.active) continue;
    const dx = (it.x - px) * k, dy = (it.z - pz) * k;
    if (Math.hypot(dx, dy) > lim) continue;
    mctx.save(); mctx.translate(c + dx, c + dy); mctx.rotate(Math.PI / 4);
    mctx.fillStyle = ITEM[it.kind].css; mctx.strokeStyle = '#10151c'; mctx.lineWidth = 2;
    mctx.fillRect(-5, -5, 10, 10); mctx.strokeRect(-5, -5, 10, 10); mctx.restore();
  }
  for (const b of bots) {                                               // 적: 범위 밖이면 테두리에 작게, 나를 노리면 노란 테
    if (!b.f.alive || b.f === v) continue;
    let dx = (b.f.pos.x - px) * k, dy = (b.f.pos.z - pz) * k, r = 7;
    const d = Math.hypot(dx, dy);
    if (d > lim) { dx *= lim / d; dy *= lim / d; r = 4; }
    mctx.beginPath(); mctx.arc(c + dx, c + dy, r, 0, 7);
    mctx.fillStyle = '#ff5a4a'; mctx.strokeStyle = b.target === me ? '#ffd166' : '#2a0b08'; mctx.lineWidth = b.target === me ? 3.5 : 2; mctx.fill(); mctx.stroke();
  }
  // 다음 안전구역이 미니맵 밖이면 테두리에 방향 표시
  const ndx = zn.x - px, ndz = zn.z - pz, nd = Math.hypot(ndx, ndz);
  if (!zone.done && nd > zn.r && nd * k > lim) {
    mctx.save(); mctx.translate(c, c); mctx.rotate(Math.atan2(ndx, -ndz));
    mctx.beginPath(); mctx.moveTo(0, -c + 6); mctx.lineTo(11, -c + 26); mctx.lineTo(-11, -c + 26); mctx.closePath();
    mctx.fillStyle = '#ffffff'; mctx.strokeStyle = '#3a2a80'; mctx.lineWidth = 2.5; mctx.fill(); mctx.stroke(); mctx.restore();
  }
  mctx.translate(c, c); mctx.rotate(-aim.yaw);                          // 보고 있는 드론의 화살표 (북쪽이 위)
  mctx.beginPath(); mctx.moveTo(0, -13); mctx.lineTo(9, 10); mctx.lineTo(0, 5); mctx.lineTo(-9, 10); mctx.closePath();
  mctx.fillStyle = v === me ? '#35d6ff' : '#ff5a4a'; mctx.strokeStyle = '#06222c'; mctx.lineWidth = 2.5; mctx.fill(); mctx.stroke();
  mctx.restore();
  mctx.beginPath(); mctx.arc(c, c, c - 2, 0, 7); mctx.strokeStyle = 'rgba(255,255,255,.55)'; mctx.lineWidth = 3; mctx.stroke();
}

// ---------- HUD ----------
const hud = { speed: $('h-speed'), alt: $('h-alt'), boost: $('h-boost'), warn: $('h-warn'), place: $('h-place'),
  heat: $('h-heat'), heatLabel: $('h-heat-label'), kills: $('h-kills'), hitmark: $('hitmark'), toast: $('toast'), bars: $('tbars'),
  hp: $('h-hp'), hpNum: $('h-hp-num'), shield: $('h-shield'), shieldNum: $('h-shield-num'), vignette: $('vignette'), feed: $('feed'),
  dead: $('dead'), deadSub: $('dead-sub'), lives: $('h-lives'), threats: $('threats'),
  diff: $('h-diff'), count: $('count'), resStats: $('res-stats'),
  alive: $('h-alive'), zone: $('h-zone'), buffs: $('buffs'), result: $('result'), resTitle: $('res-title'), resSub: $('res-sub') };
let toastTimer = 0, hitTimer = 0, hurt = 0, countTimer = 0;
function showCount(text) { hud.count.textContent = text; hud.count.classList.add('show'); countTimer = 0.85; }
function toast(text) { hud.toast.textContent = text; hud.toast.classList.add('show'); toastTimer = 1.4; }
function hitMark(kill) { hud.hitmark.className = 'hud show' + (kill ? ' kill' : ''); hitTimer = kill ? 0.35 : 0.12; }
const feed = [];
function addFeed(killer, victim) {
  const el = document.createElement('div');
  const a = document.createElement('b'), b = document.createElement('b');
  a.textContent = killer ? killer.name : '자기장'; b.textContent = victim.name;
  a.className = killer && killer.isPlayer ? 'me' : 'foe'; b.className = victim.isPlayer ? 'me' : 'foe';
  el.append(a, ' ▸ ', b);
  hud.feed.prepend(el);
  feed.push({ el, t: 7 });
  while (feed.length > 5) feed.shift().el.remove();
}
const barEls = bots.map(() => { const el = document.createElement('div'); el.className = 'tbar'; el.appendChild(document.createElement('i')); hud.bars.appendChild(el); return el; });
const threatEls = bots.map(() => { const el = document.createElement('i'); hud.threats.appendChild(el); return el; });
const buffEls = { twin: document.createElement('span'), boost: document.createElement('span') };
buffEls.twin.style.color = ITEM.twin.css; buffEls.boost.style.color = ITEM.boost.css;
hud.buffs.append(buffEls.twin, buffEls.boost);
const _v = new THREE.Vector3();
function updateEnemyMarks() {
  const sy = Math.sin(aim.yaw), cy = Math.cos(aim.yaw);
  let aimed = false;
  bots.forEach((b, i) => {
    const f = b.f, el = barEls[i], th = threatEls[i];
    let show = false;
    if (f.alive && f !== view()) {               // 관전 중인 드론 자신의 체력 바는 그리지 않는다
      _v.copy(f.pos).sub(camera.position);
      const dist = _v.length(), full = f.maxHp + f.maxShield, now = f.hp + f.shield;
      if (dist < 450 && (now < full || dist < 220) && _v.dot(fwd) > 0) {
        _v.divideScalar(dist);
        if (world.raycast(camera.position.x, camera.position.y, camera.position.z, _v.x, _v.y, _v.z, dist) >= dist - 0.01) {
          _v.copy(f.pos); _v.y += 2.8; _v.project(camera);
          if (Math.abs(_v.x) < 1 && Math.abs(_v.y) < 1) {
            show = true;
            el.style.transform = `translate(${((_v.x + 1) / 2 * innerWidth).toFixed(1)}px, ${((1 - _v.y) / 2 * innerHeight).toFixed(1)}px)`;
            el.firstChild.style.width = (now / full * 100) + '%';
          }
        }
      }
    }
    el.style.display = show ? 'block' : 'none';
    // 위협 방향: 나를 조준 중이면 노랑, 방금 나를 맞혔으면 빨강
    const hitMe = me.lastAttacker === f && me.sinceHit < 1.2;
    const aimingMe = f.alive && b.target === me && (b.aiming || b.phase === 'burst');
    if (me.alive && (hitMe || aimingMe)) {
      const dx = f.pos.x - me.pos.x, dz = f.pos.z - me.pos.z;
      const ang = Math.atan2(dx * cy - dz * sy, -dx * sy - dz * cy);
      th.style.display = 'block'; th.className = hitMe ? 'hit' : '';
      th.style.transform = `rotate(${ang.toFixed(3)}rad) translateY(-118px)`;
      if (aimingMe) aimed = true;
    } else th.style.display = 'none';
  });
  return aimed;
}
const mmss = t => { t = Math.max(0, Math.ceil(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
function updateHud() {
  const d = me.drone;
  hud.speed.textContent = Math.round(me.alive ? d.speed * 3.6 : 0);
  hud.alt.textContent = Math.round(me.pos.y);
  hud.boost.style.width = (d.boost / CFG.drone.boostMax * 100).toFixed(1) + '%';
  hud.boost.parentElement.classList.toggle('on', d.boosting);
  hud.place.textContent = `9번출구에서 ${Math.round(Math.hypot(me.pos.x, me.pos.z))}m`;
  hud.heat.style.width = me.gun.heat.toFixed(1) + '%';
  hud.heat.parentElement.classList.toggle('over', me.gun.overheated);
  hud.heatLabel.textContent = me.gun.overheated ? '과열! 식는 중' : '레이저 열';
  hud.kills.textContent = me.kills;
  hud.hp.style.width = (me.hp / me.maxHp * 100).toFixed(1) + '%';
  hud.hp.parentElement.classList.toggle('low', me.hp < me.maxHp * 0.35);
  hud.shield.style.width = (me.shield / me.maxShield * 100).toFixed(1) + '%';
  hud.hpNum.textContent = Math.ceil(me.hp); hud.shieldNum.textContent = Math.ceil(me.shield);
  if (lives !== livesShown) {                      // 목숨: 남은 만큼 밝은 하트
    livesShown = lives;
    hud.lives.innerHTML = '';
    for (let i = 0; i < CFG.player.lives; i++) { const h = document.createElement('i'); h.textContent = '♥'; if (i >= lives) h.className = 'off'; hud.lives.appendChild(h); }
  }
  if (waiting()) hud.deadSub.textContent = `${deadWhy} · 남은 목숨 ${lives} · ${Math.ceil(respawnT)}초 뒤 재출격`;
  buffEls.twin.style.display = me.alive && me.twinT > 0 ? '' : 'none'; buffEls.twin.textContent = '쌍발 레이저 ' + Math.ceil(me.twinT) + '초';
  buffEls.boost.style.display = me.alive && me.boostT > 0 ? '' : 'none'; buffEls.boost.textContent = '부스트 강화 ' + Math.ceil(me.boostT) + '초';
  hurt = Math.max(0, hurt - dt * 1.8);
  hud.vignette.style.opacity = Math.max(hurt, me.alive && me.hp < me.maxHp * 0.35 ? 0.3 : 0).toFixed(2);
  if (toastTimer > 0 && (toastTimer -= dt) <= 0) hud.toast.classList.remove('show');
  if (hitTimer > 0 && (hitTimer -= dt) <= 0) hud.hitmark.className = 'hud';
  if (countTimer > 0 && (countTimer -= dt) <= 0) hud.count.classList.remove('show');
  for (let i = feed.length - 1; i >= 0; i--) if ((feed[i].t -= dt) <= 0) { feed[i].el.remove(); feed.splice(i, 1); }
  const aimed = updateEnemyMarks();

  // 경기 상황: 생존자 수와 자기장
  hud.alive.textContent = aliveCount();
  const out = me.alive ? zone.outside(me.pos) : -1;
  hud.zone.className = out > 0 ? 'out' : '';
  hud.zone.textContent = out > 0 ? `자기장 밖! 안전구역까지 ${Math.ceil(out)}m`
    : zone.done ? '자기장이 모두 닫혔습니다'
    : zone.shrinking ? `자기장 축소 중 ${mmss(zone.timeLeft)}` : `자기장 축소까지 ${mmss(zone.timeLeft)}`;
  const top = me.pos.y > CFG.drone.ceiling - 0.3;
  hud.warn.textContent = !me.alive || over ? '' : me.protT > 0 ? '출격 보호 중' : aimed ? '조준당하는 중!' : top ? '최고 고도' : '';
  hud.warn.classList.toggle('danger', me.alive && me.protT <= 0 && aimed);
}

// ---------- 사격 ----------
const _aimP = new THREE.Vector3(), _muz = new THREE.Vector3(), _dir = new THREE.Vector3(), _sp = new THREE.Vector3(), _side = new THREE.Vector3();
const COL = { laser: new THREE.Color(CFG.laser.color), spark: new THREE.Color(0xbfefff), fire: new THREE.Color(0xff9a3c), hot: new THREE.Color(0xfff1c9),
  red: new THREE.Color(ENEMY), shield: new THREE.Color(0x6fb8ff), smoke: new THREE.Color(0x6b4630) };
const loud = p => clamp(1 - p.distanceTo(view().pos) / 420, 0.1, 1);

// 조준점: 화면 가운데 광선이 닿는 곳. 조준 보정 각도 안에 적이 있으면 그 적(이동 예측 포함).
function resolveAim(out) {
  const o = camera.position, c = CFG.laser;
  const wallT = world.raycast(o.x, o.y, o.z, fwd.x, fwd.y, fwd.z, c.range, true);
  const lim = Math.tan(THREE.MathUtils.degToRad(c.assistDeg) * camera.fov / CFG.camera.fov);
  let best = null, bestAng = Infinity, bestDist = 0;
  for (const b of bots) {
    const t = b.f;
    if (!t.alive) continue;
    _v.copy(t.pos).sub(o);
    const along = _v.dot(fwd);
    if (along < 6 || along > wallT + t.hitRadius) continue;
    const ang = Math.sqrt(Math.max(0, _v.lengthSq() - along * along)) / along;
    if (ang < Math.max(lim, t.hitRadius / along) && ang < bestAng) { bestAng = ang; best = t; bestDist = along; }
  }
  if (best) out.copy(best.pos).addScaledVector(best.vel, bestDist / c.speed);
  else out.copy(o).addScaledVector(fwd, wallT);
}
function muzzleOf(f, out) { f.drone.model.root.updateMatrixWorld(true); f.drone.model.muzzle.getWorldPosition(out); }
// 총구에서 dir 방향으로 발사. 쌍발 레이저 중이면 좌우로 나란히 두 발.
function launch(f, color, damage) {
  if (f.twinT > 0) {
    _side.set(-_dir.z, 0, _dir.x).normalize().multiplyScalar(0.55);
    bolts.fire(_sp.copy(_muz).add(_side), _dir, f, color, damage);
    bolts.fire(_sp.copy(_muz).sub(_side), _dir, f, color, damage);
  } else bolts.fire(_muz, _dir, f, color, damage);
}

function shoot() {
  muzzleOf(me, _muz);
  resolveAim(_aimP);
  _dir.copy(_aimP).sub(_muz);
  if (_dir.length() < 4 || _dir.dot(fwd) <= 0) _dir.copy(fwd);
  launch(me, CFG.laser.color, CFG.laser.damage);
  fx.emit(_muz.x, _muz.y, _muz.z, me.vel.x, me.vel.y, me.vel.z, COL.laser, 2.2, 0.07);
  sfx.laser();
}

// 적의 사격: 이동을 어느 정도만 예측하고, 거리에 따라 퍼지게 쏜다 (쉬움: 가까이서 4발 중 1발쯤 명중)
function botFire(bot, t, dist) {
  const c = CFG.bot, f = bot.f;
  muzzleOf(f, _muz);
  const R = t.hitRadius * c.spread * (0.7 + dist / 200);
  let ox, oy, oz;
  do { ox = Math.random() * 2 - 1; oy = Math.random() * 2 - 1; oz = Math.random() * 2 - 1; } while (ox * ox + oy * oy + oz * oz > 1);
  _aimP.copy(t.pos).addScaledVector(t.vel, dist / CFG.laser.speed * c.lead);
  _aimP.x += ox * R; _aimP.y += oy * R; _aimP.z += oz * R;
  _dir.copy(_aimP).sub(_muz);
  launch(f, ENEMY, c.damage);
  fx.emit(_muz.x, _muz.y, _muz.z, f.vel.x, f.vel.y, f.vel.z, COL.red, 2.2, 0.07);
  sfx.laser(loud(f.pos) * 0.55, 0.62);
}

const _leaf = new THREE.Color();
function onBoltHit(b, victim, p, kind, tint) {
  _sp.copy(p).addScaledVector(b.dir, -0.25);
  const res = victim && !over && victim.damage(b.damage, b.owner);
  if (!res) {                                    // 드론이 아닌 것에 맞았다 (또는 보호 중인 상대)
    if (kind === 'leaf') { fx.burst(_sp, 9, _leaf.set(tint), 6, 0.75, 0.55, 5); sfx.rustle(loud(p) * 0.7); }               // 나뭇잎이 흩날린다
    else if (kind === 'prop' || kind === 'car') { fx.burst(_sp, 8, COL.hot, 13, 0.4, 0.25, 10); sfx.ting(loud(p) * 0.8); }  // 쇠붙이에 튄다
    else { fx.burst(_sp, 5, COL.spark, 9, 0.4, 0.22, 10); sfx.wall(loud(p) * 0.7); }
    return;
  }
  fx.burst(_sp, 9, res === 'shield' ? COL.shield : COL.fire, 13, 0.55, 0.28, 6);
  if (victim === me) { hurt = Math.min(1, hurt + (res === 'shield' ? 0.35 : 0.6)); shake += res === 'shield' ? 0.12 : 0.25; sfx.hurt(res === 'shield'); }
  if (res === 'kill') onDeath(victim, b.owner);
  else if (b.owner === me) { sfx.hit(); hitMark(false); }
}

function onPickup(f, it) {
  _sp.set(it.x, it.y, it.z);
  fx.burst(_sp, 14, new THREE.Color(ITEM[it.kind].color), 9, 0.9, 0.5, -3);
  if (f !== me) return;
  sfx.pickup();
  toast(ITEM[it.kind].label + (it.kind === 'repair' ? ' +' + CFG.items.repair : it.kind === 'shield' ? ' 완료' : ' ' + (it.kind === 'twin' ? CFG.items.twinTime : CFG.items.boostTime) + '초'));
}

// 다음 안전구역 안의 길 위 한 점
function zoneNode() {
  const n = zone.next, r = Math.max(n.r * 0.8, 25);
  for (let k = 0; k < 50; k++) {
    const i = nav.random();
    if (Math.hypot(nav.x[i] - n.x, nav.z[i] - n.z) < r) return i;
  }
  return nav.nearest(n.x, 6, n.z, false);
}
const ctx = {
  world, nav, fighters, fire: botFire, zoneNode,
  // 쉬움: 플레이어를 동시에 노리는 적의 수를 제한한다
  canTarget(bot, o) {
    if (!o.isPlayer) return true;
    let n = 0;
    for (const b of bots) if (b !== bot && b.f.alive && b.target === o) n++;
    return n < CFG.bot.maxOnPlayer;
  },
  // 순찰 목적지: 다음 안전구역 안. 가끔은 플레이어 근처로 향한다.
  patrolNode() {
    const n = zone.next;
    if (me.alive && Math.random() < CFG.bot.huntChance) {
      for (let k = 0; k < 40; k++) {
        const i = nav.random(), d = Math.hypot(nav.x[i] - me.pos.x, nav.z[i] - me.pos.z);
        if (d > 60 && d < 260 && Math.hypot(nav.x[i] - n.x, nav.z[i] - n.z) < n.r) return i;
      }
    }
    return zoneNode();
  },
  // 0 안전 · 1 곧 줄어들 자리 · 2 자기장 밖
  zoneNeed(p) {
    if (zone.outside(p) > -15) return 2;
    const n = zone.next;
    return !zone.done && Math.hypot(p.x - n.x, p.z - n.z) > n.r - 10 && (zone.shrinking || zone.timeLeft < 25) ? 1 : 0;
  },
  // 체력이 낮은 적이 찾아갈 수리·실드 아이템 (자기장 안, 320m 이내)
  findItem(f) {
    const kinds = f.hp < f.maxHp ? ['repair', 'shield'] : ['shield'];
    return items.nearest(f.pos, kinds, 320, it => Math.hypot(it.x - zone.cur.x, it.z - zone.cur.z) < zone.cur.r - 20);
  },
};

// ---------- 카메라 (3인칭 추적) ----------
// 지금 화면이 따라가는 드론: 살아 있으면 나, 격추된 뒤에는 관전 대상
function view() {
  if (me.alive || me.wrecking || waiting()) return me;        // 내 기체가 떨어지는 동안, 재출격을 기다리는 동안은 그 자리를 본다
  if (!spectate || !spectate.alive) spectate = fighters.find(f => f.alive) || null;
  return spectate || me;
}
let camDist = CFG.camera.dist;
const fwd = new THREE.Vector3(), pivot = new THREE.Vector3(), want = new THREE.Vector3();
function updateCamera(dt) {
  const cc = CFG.camera, v = view();
  if (v !== me) {                                // 관전: 그 드론의 기수를 따라 돈다
    let dy = v.drone.yaw - aim.yaw; dy -= Math.round(dy / (2 * Math.PI)) * 2 * Math.PI;
    const k = 1 - Math.exp(-4 * dt);
    aim.yaw += dy * k; aim.pitch += (-0.18 - aim.pitch) * k;
  }
  const cp = Math.cos(aim.pitch);
  fwd.set(-Math.sin(aim.yaw) * cp, Math.sin(aim.pitch), -Math.cos(aim.yaw) * cp);
  pivot.copy(v.pos); pivot.y += 1.1;
  want.copy(pivot).addScaledVector(fwd, -cc.dist); want.y += cc.height;
  want.sub(pivot);
  const len = want.length(); want.divideScalar(len);
  // 건물에 가리지 않도록 당긴다 (당길 땐 즉시, 물러날 땐 천천히)
  const free = world.raycast(pivot.x, pivot.y, pivot.z, want.x, want.y, want.z, len + 0.8) - 0.8;
  const target = clamp(free, 1.2, len);
  camDist = target < camDist ? target : Math.min(target, camDist + 12 * dt);
  camera.position.copy(pivot).addScaledVector(want, camDist);
  camera.rotation.set(aim.pitch, aim.yaw, 0);
  if (shake > 0.002) {                           // 피격·폭발의 흔들림
    const k = Math.min(shake, 1.2);
    camera.position.x += (Math.random() - 0.5) * k * 0.5; camera.position.y += (Math.random() - 0.5) * k * 0.5; camera.position.z += (Math.random() - 0.5) * k * 0.5;
    camera.rotation.z = (Math.random() - 0.5) * k * 0.03;
    shake *= Math.exp(-7 * dt);
  }
  const fov = (zoom && me.alive ? cc.zoomFov : cc.fov) + (me.alive && me.drone.boosting ? cc.boostFov : 0);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * (1 - Math.exp(-10 * dt)); camera.updateProjectionMatrix(); }
  // 카메라가 바짝 붙으면 드론이 화면을 가리므로 숨긴다. 출격 보호 중에는 깜빡인다.
  me.drone.model.root.visible = me.wrecking || (me.alive && camDist > 2.2 && !(me.protT > 0 && startT <= 0 && Math.floor(me.protT * 10) % 2));
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- 메인 루프 ----------
const cmd = { fwd: 0, right: 0, up: 0, boost: false, yaw: 0 };
let last = performance.now(), frame = 0, turn = 0, dt = 0, fpsAvg = 60, perfT = 0, passT = 0, hornT = 5, bumpT = 0, rustleT = 0;
const actors = [];                                // 살아 있는 드론들 (차·보행자와의 상호작용용)
let pedsOnRoad = [];
function simulate() {
  // 시작 초읽기: 3, 2, 1 동안은 모두 제자리에 있다
  const counting = startT > 0;
  if (counting) {
    startT -= dt;
    const n = Math.max(0, Math.ceil(startT));
    if (n !== lastCount) { lastCount = n; if (n > 0) { showCount(n); sfx.count(); } else { showCount('출격!'); sfx.go(); } }
  }
  if (waiting() && (respawnT -= dt) <= 0) respawnMe();
  if (me.alive) {
    // 마우스: 쌓인 회전량을 조금씩 나눠 반영해 시점이 홱 돌지 않게 한다
    const lk = 1 - Math.exp(-CFG.mouse.smooth * dt), mx = look.x * lk, my = look.y * lk;
    look.x -= mx; look.y -= my;
    aim.yaw += mx; aim.pitch = clamp(aim.pitch + my, -CFG.mouse.pitchMax, CFG.mouse.pitchMax);
    // 좌우 키는 게걸음이 아니라 기수를 돌린다 (시점도 함께 돈다)
    const steer = axis(['ArrowLeft', 'KeyA'], ['ArrowRight', 'KeyD']);
    turn += (steer * CFG.drone.turnRate * (zoom ? 0.45 : 1) - turn) * (1 - Math.exp(-CFG.drone.turnAccel * dt));
    aim.yaw += turn * dt;
    cmd.fwd = counting ? 0 : axis(['KeyW'], ['KeyS']); cmd.up = counting ? 0 : axis(['ArrowUp'], ['ArrowDown']);
    cmd.boost = keys.has('ShiftLeft') || keys.has('ShiftRight'); cmd.yaw = aim.yaw;
    me.drone.aimPitch = aim.pitch;
    const sp0 = me.drone.speed;
    me.drone.update(dt, cmd, world);
    bumpT -= dt;
    if (me.drone.bumped && sp0 > 8 && sp0 - me.drone.speed > 1.5 && bumpT <= 0) { bumpT = 0.35; sfx.bump(Math.min(1, sp0 / 25)); shake += 0.12; }   // 세게 부딪히면 쿵
  }

  bots.forEach((b, i) => {
    const f = b.f, beam = beams[i];
    if (f.alive && !over && !counting) b.update(dt, ctx);
    const locking = f.alive && b.target === me && b.aiming;      // 나를 조준하기 시작하면 경고음
    if (locking && !b.warned) sfx.lock();
    b.warned = locking;
    beam.visible = f.alive && !over && b.aiming && !!b.target;
    if (beam.visible) {
      const t = b.target.pos;
      beam.position.set(f.pos.x, f.pos.y - 0.3, f.pos.z);
      beam.lookAt(t);
      beam.scale.set(1, 1, beam.position.distanceTo(t));
      beam.material.opacity = 0.6 + 0.35 * Math.sin(performance.now() * 0.03);
      if (frame % 3 === 0) fx.emit(f.pos.x, f.pos.y - 0.3, f.pos.z, 0, 0, 0, COL.red, 3.2, 0.12);
    }
  });
  for (const f of fighters) {
    f.tick(dt);
    if (f.alive && f.drone.boosting && frame % 2 === 0) {            // 부스트 꼬리
      const sy = Math.sin(f.drone.yaw), cy = Math.cos(f.drone.yaw);
      fx.emit(f.pos.x + sy * 1.4, f.pos.y - 0.15, f.pos.z + cy * 1.4, sy * 5, 0, cy * 5, f.isPlayer ? COL.laser : COL.red, 1.3, 0.3);
    }
    if (f.alive && f.drone.leaf && f.drone.speed > 2 && frame % 2 === 0) fx.burst(f.pos, 2, _leaf.set(f.drone.leaf.color), 4, 0.6, 0.5, 4);   // 나뭇잎을 헤치고 지나간다
    if (f.alive && f.hp < f.maxHp * 0.35 && frame % 5 === 0) fx.emit(f.pos.x, f.pos.y, f.pos.z, (Math.random() - 0.5) * 2, 2.5, (Math.random() - 0.5) * 2, COL.fire, 0.8, 0.45, -2);   // 손상된 기체의 불티
  }
  updateWrecks();
  if (me.alive && me.drone.leaf && me.drone.speed > 3 && (rustleT -= dt) <= 0) { rustleT = 0.22; sfx.rustle(0.8); }
  if (me.alive && me.hp < me.maxHp * 0.35 && (heartT -= dt) <= 0) { heartT = 0.85; sfx.heart(); }
  setEngine(me.alive ? me.drone.speed / CFG.drone.boostSpeed : 0, me.alive && me.drone.boosting, me.alive);

  if (!over && !counting) {
    zone.update(dt, nav);
    if (zone.shrinking && !prevShrink) { toast('자기장이 줄어듭니다'); sfx.alarm(); }
    prevShrink = zone.shrinking;
    const dmg = zone.dps * dt;                     // 자기장 밖이면 실드와 상관없이 체력이 깎인다
    for (const f of fighters) if (f.alive && zone.outside(f.pos) > 0 && f.damage(dmg, null, true) === 'kill') onDeath(f, null);
    if (me.alive && zone.outside(me.pos) > 0) {
      hurt = Math.max(hurt, 0.45);
      if ((zoneTick -= dt) <= 0) { zoneTick = 0.8; sfx.zone(); }
    }
    items.update(dt, fighters, onPickup);
  }

  // 차 소리: 주변 교통량만큼 웅웅거리고, 가까이 스치면 지나가는 소리, 가끔 경적
  actors.length = 0;
  for (const f of fighters) if (f.alive) actors.push(f);
  const heard = city.updateCars(dt, view().pos, actors, pedsOnRoad);
  if (me.carBump) { me.carBump = false; if (bumpT <= 0) { bumpT = 0.5; sfx.bump(0.9); sfx.horn(1); shake += 0.2; hornT = 3; } }      // 차에 부딪히면 경적이 울린다
  setTraffic(heard.level);
  passT -= dt; hornT -= dt;
  if (heard.near < 16 && passT <= 0) { passT = 1.3 + Math.random() * 1.2; sfx.pass(clamp(1 - heard.near / 16, 0.25, 1)); }
  if (hornT <= 0) { hornT = 4 + Math.random() * 9; if (heard.near < 110) sfx.horn(clamp(1 - heard.near / 110, 0.1, 1)); }
  street.update(dt);
  pedsOnRoad = people.update(dt, actors, city.carNear);       // 차도 위의 보행자: 다음 프레임에 차들이 이들 앞에서 선다
  updateCamera(dt);
  if (me.gun.update(dt, me.alive && !over && !counting && (trigger || keys.has('Space')))) shoot();
  if (me.gun.justOverheated) { me.gun.justOverheated = false; sfx.overheat(); }
  bolts.update(dt, world, fighters, onBoltHit, city.carRay);
  fx.update(dt, camera, innerHeight);
}
function tick(now) {
  requestAnimationFrame(tick);
  const raw = (now - last) / 1000;
  dt = Math.min(0.05, raw); last = now;
  if (playing || debugPlay) simulate();            // 시작 전·일시 정지 중에는 세상이 멈춘다
  else { dt = 0; updateCamera(0); setEngine(0, false, false); setTraffic(0); }
  // 계속 느리면 해상도를 한 단계씩 낮춘다
  if (raw > 0 && raw < 0.5) {
    fpsAvg += (1 / raw - fpsAvg) * 0.05;
    if ((perfT += raw) > 3) { perfT = 0; if (fpsAvg < 42 && pixelRatio > 0.75) { pixelRatio = Math.max(0.75, pixelRatio - 0.25); renderer.setPixelRatio(pixelRatio); } }
  }

  const v = view(), ground = world.surfaceBelow(v.pos.x, v.pos.y, v.pos.z), h = v.pos.y - ground;
  blob.visible = v.alive;
  blob.position.set(v.pos.x, ground + 0.45, v.pos.z);
  blob.scale.setScalar(1 + h * 0.03);
  blob.material.opacity = 0.4 * clamp(1 - h / 60, 0.15, 1);

  renderer.render(scene, camera);
  updateHud();
  if (frame++ % 2 === 0) drawMinimap();
}

let savedDiff = 'easy';
try { savedDiff = localStorage.getItem('hdr-diff') || 'easy'; } catch (e) {}
setDifficulty(savedDiff, false);
let savedTime = 'day';
try { savedTime = localStorage.getItem('hdr-time') || 'day'; } catch (e) {}
setTimeOfDay(savedTime);
startMatch();
$('loading').remove();
requestAnimationFrame(tick);

// 디버그·자동 시험용
window.__game = { traffic: city.traffic, people, step: d => { dt = d; simulate(); }, me, bots, fighters, aim, world, nav, zone, items, keys, camera, scene, renderer, bolts, fx, CFG,
  startMatch, setDifficulty, setTimeOfDay, isOver: () => over, lives: () => lives, look, setDebugPlay: v => { debugPlay = v; } };
