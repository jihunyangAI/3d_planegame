// 홍대 드론 로얄 — 3단계: 적 드론과의 교전 (격추되면 양쪽 모두 다시 출격)
import * as THREE from 'three';
import { buildCity } from './city.js';
import { World } from './world.js';
import { Nav } from './nav.js';
import { Fighter } from './fighter.js';
import { Bot } from './bots.js';
import { CFG } from './config.js';
import { Bolts } from './weapons.js';
import { Particles } from './fx.js';
import { sfx, unlock as unlockAudio, toggleMute } from './audio.js';

const D = window.MAP_DATA;
const $ = id => document.getElementById(id);
const { clamp } = THREE.MathUtils;

// ---------- 장면 ----------
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CFG.camera.fov, innerWidth / innerHeight, 0.3, 40000);
camera.rotation.order = 'YXZ';
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
$('app').appendChild(renderer.domElement);
const canvas = renderer.domElement;

const city = buildCity(scene, renderer, D);
city.setTime(CFG.timeOfDay);
const world = new World(D);
const nav = new Nav(D, world);

// 경기장 경계 벽
{
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(D.radius, D.radius, 90, 160, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xff5a5f, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false, fog: false }));
  wall.position.y = 45;
  scene.add(wall);
}

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

const aim = { yaw: 0, pitch: -0.12 };
// 가장 멀리 트인 방향(길을 따라)
function openYaw(x, y, z) {
  let best = -1, yaw = 0;
  for (let a = 0; a < 32; a++) {
    const t = world.raycast(x, y, z, -Math.sin(a * Math.PI / 16), 0, -Math.cos(a * Math.PI / 16), 600);
    if (t > best) { best = t; yaw = a * Math.PI / 16; }
  }
  return yaw;
}
function spawnPlayer(first) {
  let sx = 0, sz = 0;
  if (first) {                                   // 원점(9번출구)에서 가장 가까운 트인 곳
    search: for (let r = 0; r < 300; r += 6) for (let a = 0; a < 12; a++) {
      const x = Math.cos(a * Math.PI / 6) * r, z = Math.sin(a * Math.PI / 6) * r;
      if (world.isOpen(x, z, 9)) { sx = x; sz = z; break search; }
    }
  } else {                                       // 적에게서 떨어진 길 위
    let bd = -1;
    for (let k = 0; k < 40; k++) {
      const n = nav.random();
      let d = Infinity;
      for (const b of bots) if (b.f.alive) d = Math.min(d, Math.hypot(nav.x[n] - b.f.pos.x, nav.z[n] - b.f.pos.z));
      if (d > bd) { bd = d; sx = nav.x[n]; sz = nav.z[n]; }
      if (d > 220) break;
    }
  }
  aim.yaw = openYaw(sx, CFG.spawnAlt, sz); aim.pitch = -0.12;
  me.spawn(sx, CFG.spawnAlt, sz, aim.yaw, first ? 0 : CFG.player.spawnProtect);
  camDist = CFG.camera.dist;
}
function spawnBot(bot) {
  bot.reset();
  let x = 0, z = 0;
  for (let k = 0; k < 60; k++) {
    const n = nav.random(); x = nav.x[n]; z = nav.z[n];
    if (Math.hypot(x - me.pos.x, z - me.pos.z) < CFG.bot.spawnAway) continue;
    if (fighters.every(o => o === bot.f || !o.alive || Math.hypot(x - o.pos.x, z - o.pos.z) > 80)) break;
  }
  bot.f.spawn(x, bot.alt, z, Math.random() * 6.283, 0);
}
function resetMatch() {
  for (const f of fighters) { f.kills = f.deaths = 0; f.alive = false; }
  spawnPlayer(true);
  bots.forEach(spawnBot);
  $('dead').classList.remove('show');
}

// ---------- 입력 ----------
const keys = new Set();
const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight']);
let zoom = false, trigger = false, playing = false, debugPlay = false;
addEventListener('keydown', e => {
  if (GAME_KEYS.has(e.code)) e.preventDefault();
  keys.add(e.code);
  if (e.code === 'KeyR' && playing) { resetMatch(); toast('처음부터 다시'); }
  if (e.code === 'KeyM') toast(toggleMute() ? '소리 끔' : '소리 켬');
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); zoom = trigger = false; });
canvas.addEventListener('mousedown', e => { if (e.button === 2) zoom = true; if (e.button === 0 && playing) trigger = true; });
addEventListener('mouseup', e => { if (e.button === 2) zoom = false; if (e.button === 0) trigger = false; });
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('mousemove', e => {
  if (document.pointerLockElement !== canvas) return;
  const s = CFG.mouse.sens * (camera.fov / CFG.camera.fov);
  aim.yaw -= e.movementX * s;
  aim.pitch = clamp(aim.pitch - e.movementY * s, -CFG.mouse.pitchMax, CFG.mouse.pitchMax);
});
const overlay = $('overlay');
overlay.addEventListener('click', () => canvas.requestPointerLock());
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
  g.beginPath(); g.arc(0, 0, R, 0, 7); g.strokeStyle = '#ff5a5f'; g.lineWidth = 6; g.stroke();
}
const mm = $('minimap'); mm.width = mm.height = MM.size * 2;             // 2배 해상도로 그린다
const mctx = mm.getContext('2d');
function drawMinimap() {
  const S = mm.width, c = S / 2, k = c / MM.range;
  mctx.clearRect(0, 0, S, S);
  mctx.save();
  mctx.beginPath(); mctx.arc(c, c, c - 2, 0, 7); mctx.clip();
  mctx.fillStyle = '#10151c'; mctx.fillRect(0, 0, S, S);
  const mx = me.pos.x, my = -me.pos.z;                                  // 지도 좌표
  const sx = (mx - MM.range + D.radius) * MM.px, sy = (D.radius - my - MM.range) * MM.px, sw = 2 * MM.range * MM.px;
  mctx.drawImage(mapImg, sx, sy, sw, sw, 0, 0, S, S);
  for (const b of bots) {                                               // 적: 범위 밖이면 테두리에 작게, 나를 노리면 노란 테
    if (!b.f.alive) continue;
    let dx = (b.f.pos.x - me.pos.x) * k, dy = (b.f.pos.z - me.pos.z) * k, r = 7;
    const d = Math.hypot(dx, dy), lim = c - 12;
    if (d > lim) { dx *= lim / d; dy *= lim / d; r = 4; }
    mctx.beginPath(); mctx.arc(c + dx, c + dy, r, 0, 7);
    mctx.fillStyle = '#ff5a4a'; mctx.strokeStyle = b.target === me ? '#ffd166' : '#2a0b08'; mctx.lineWidth = b.target === me ? 3.5 : 2; mctx.fill(); mctx.stroke();
  }
  mctx.translate(c, c); mctx.rotate(-aim.yaw);                          // 플레이어 화살표 (북쪽이 위)
  mctx.beginPath(); mctx.moveTo(0, -13); mctx.lineTo(9, 10); mctx.lineTo(0, 5); mctx.lineTo(-9, 10); mctx.closePath();
  mctx.fillStyle = '#35d6ff'; mctx.strokeStyle = '#06222c'; mctx.lineWidth = 2.5; mctx.fill(); mctx.stroke();
  mctx.restore();
  mctx.beginPath(); mctx.arc(c, c, c - 2, 0, 7); mctx.strokeStyle = 'rgba(255,255,255,.55)'; mctx.lineWidth = 3; mctx.stroke();
}

// ---------- HUD ----------
const hud = { speed: $('h-speed'), alt: $('h-alt'), boost: $('h-boost'), warn: $('h-warn'), place: $('h-place'),
  heat: $('h-heat'), heatLabel: $('h-heat-label'), kills: $('h-kills'), deaths: $('h-deaths'), hitmark: $('hitmark'), toast: $('toast'), bars: $('tbars'),
  hp: $('h-hp'), hpNum: $('h-hp-num'), shield: $('h-shield'), shieldNum: $('h-shield-num'), vignette: $('vignette'), feed: $('feed'),
  dead: $('dead'), deadBy: $('dead-by'), deadIn: $('dead-in'), threats: $('threats') };
let toastTimer = 0, hitTimer = 0, hurt = 0;
function toast(text) { hud.toast.textContent = text; hud.toast.classList.add('show'); toastTimer = 1.4; }
function hitMark(kill) { hud.hitmark.className = 'hud show' + (kill ? ' kill' : ''); hitTimer = kill ? 0.35 : 0.12; }
const feed = [];
function addFeed(killer, victim) {
  const el = document.createElement('div');
  const a = document.createElement('b'), b = document.createElement('b');
  a.textContent = killer.name; b.textContent = victim.name;
  a.className = killer.isPlayer ? 'me' : 'foe'; b.className = victim.isPlayer ? 'me' : 'foe';
  el.append(a, ' ▸ ', b);
  hud.feed.prepend(el);
  feed.push({ el, t: 6 });
  while (feed.length > 5) feed.shift().el.remove();
}
const barEls = bots.map(() => { const el = document.createElement('div'); el.className = 'tbar'; el.appendChild(document.createElement('i')); hud.bars.appendChild(el); return el; });
const threatEls = bots.map(() => { const el = document.createElement('i'); hud.threats.appendChild(el); return el; });
const _v = new THREE.Vector3();
function updateEnemyMarks() {
  const sy = Math.sin(aim.yaw), cy = Math.cos(aim.yaw);
  let aimed = false;
  bots.forEach((b, i) => {
    const f = b.f, el = barEls[i], th = threatEls[i];
    let show = false;
    if (f.alive) {
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
function updateHud() {
  const d = me.drone;
  hud.speed.textContent = Math.round(d.speed * 3.6);
  hud.alt.textContent = Math.round(me.pos.y);
  hud.boost.style.width = (d.boost / CFG.drone.boostMax * 100).toFixed(1) + '%';
  hud.boost.parentElement.classList.toggle('on', d.boosting);
  hud.place.textContent = `9번출구에서 ${Math.round(Math.hypot(me.pos.x, me.pos.z))}m`;
  hud.heat.style.width = me.gun.heat.toFixed(1) + '%';
  hud.heat.parentElement.classList.toggle('over', me.gun.overheated);
  hud.heatLabel.textContent = me.gun.overheated ? '과열! 식는 중' : '레이저 열';
  hud.kills.textContent = me.kills; hud.deaths.textContent = me.deaths;
  hud.hp.style.width = (me.hp / me.maxHp * 100).toFixed(1) + '%';
  hud.hp.parentElement.classList.toggle('low', me.hp < me.maxHp * 0.35);
  hud.shield.style.width = (me.shield / me.maxShield * 100).toFixed(1) + '%';
  hud.hpNum.textContent = Math.ceil(me.hp); hud.shieldNum.textContent = Math.ceil(me.shield);
  hurt = Math.max(0, hurt - dt * 1.8);
  hud.vignette.style.opacity = Math.max(hurt, me.alive && me.hp < me.maxHp * 0.35 ? 0.3 : 0).toFixed(2);
  if (toastTimer > 0 && (toastTimer -= dt) <= 0) hud.toast.classList.remove('show');
  if (hitTimer > 0 && (hitTimer -= dt) <= 0) hud.hitmark.className = 'hud';
  for (let i = feed.length - 1; i >= 0; i--) if ((feed[i].t -= dt) <= 0) { feed[i].el.remove(); feed.splice(i, 1); }
  const aimed = updateEnemyMarks();
  const edge = Math.hypot(me.pos.x, me.pos.z) > D.radius - 40, top = me.pos.y > CFG.drone.ceiling - 0.3;
  hud.warn.textContent = !me.alive ? '' : me.protT > 0 ? '출격 보호 중' : aimed ? '조준당하는 중!' : edge ? '경기장 경계입니다' : top ? '최고 고도' : '';
  hud.warn.classList.toggle('danger', me.alive && me.protT <= 0 && aimed);
  if (!me.alive) hud.deadIn.textContent = Math.max(0, me.respawnT).toFixed(1);
}

// ---------- 사격 ----------
const _aimP = new THREE.Vector3(), _muz = new THREE.Vector3(), _dir = new THREE.Vector3(), _sp = new THREE.Vector3();
const COL = { laser: new THREE.Color(CFG.laser.color), spark: new THREE.Color(0xbfefff), fire: new THREE.Color(0xff9a3c), hot: new THREE.Color(0xfff1c9),
  red: new THREE.Color(ENEMY), shield: new THREE.Color(0x6fb8ff) };
const loud = p => clamp(1 - p.distanceTo(me.pos) / 420, 0.1, 1);

// 조준점: 화면 가운데 광선이 닿는 곳. 조준 보정 각도 안에 적이 있으면 그 적(이동 예측 포함).
function resolveAim(out) {
  const o = camera.position, c = CFG.laser;
  const wallT = world.raycast(o.x, o.y, o.z, fwd.x, fwd.y, fwd.z, c.range);
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

function shoot() {
  muzzleOf(me, _muz);
  resolveAim(_aimP);
  _dir.copy(_aimP).sub(_muz);
  if (_dir.length() < 4 || _dir.dot(fwd) <= 0) _dir.copy(fwd);
  bolts.fire(_muz, _dir, me, CFG.laser.color, CFG.laser.damage);
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
  bolts.fire(_muz, _dir, f, ENEMY, c.damage);
  fx.emit(_muz.x, _muz.y, _muz.z, f.vel.x, f.vel.y, f.vel.z, COL.red, 2.2, 0.07);
  sfx.laser(loud(f.pos) * 0.55, 0.62);
}

function onBoltHit(b, victim, p) {
  _sp.copy(p).addScaledVector(b.dir, -0.25);
  const res = victim && victim.damage(b.damage, b.owner);
  if (!res) {                                    // 벽·지면 (또는 보호 중인 상대)
    fx.burst(_sp, 5, COL.spark, 9, 0.4, 0.22, 10);
    sfx.wall(loud(p) * 0.7);
    return;
  }
  fx.burst(_sp, 9, res === 'shield' ? COL.shield : COL.fire, 13, 0.55, 0.28, 6);
  const mine = b.owner === me;
  if (victim === me) { hurt = Math.min(1, hurt + (res === 'shield' ? 0.35 : 0.6)); sfx.hurt(res === 'shield'); }
  if (res === 'kill') {
    fx.burst(victim.pos, 44, COL.fire, 27, 1.7, 0.95, 6);
    fx.burst(victim.pos, 16, victim.isPlayer ? COL.laser : COL.red, 12, 2.6, 0.6, 2);
    fx.burst(victim.pos, 10, COL.hot, 6, 4.2, 0.3);
    fx.emit(victim.pos.x, victim.pos.y, victim.pos.z, 0, 0, 0, COL.hot, 16, 0.16);
    sfx.explode(loud(victim.pos));
    addFeed(b.owner, victim);
    victim.respawnT = victim.isPlayer ? CFG.player.respawn : CFG.bot.respawn;
    if (victim === me) { hud.deadBy.textContent = b.owner.name; hud.dead.classList.add('show'); hurt = 1; }
    if (mine) { hitMark(true); toast(victim.name + ' 격추!'); }
  } else if (mine) { sfx.hit(); hitMark(false); }
}

const ctx = {
  world, nav, fighters, fire: botFire,
  // 순찰 목적지: 싸움이 자주 벌어지도록 절반 넘게는 플레이어 근처로 모여든다
  patrolNode() {
    if (me.alive && Math.random() < CFG.bot.huntChance) {
      for (let k = 0; k < 40; k++) {
        const n = nav.random(), d = Math.hypot(nav.x[n] - me.pos.x, nav.z[n] - me.pos.z);
        if (d > 60 && d < 260) return n;
      }
    }
    return nav.random();
  },
  // 쉬움: 플레이어를 동시에 노리는 적의 수를 제한한다
  canTarget(bot, o) {
    if (!o.isPlayer) return true;
    let n = 0;
    for (const b of bots) if (b !== bot && b.f.alive && b.target === o) n++;
    return n < CFG.bot.maxOnPlayer;
  },
};

// ---------- 카메라 (3인칭 추적) ----------
let camDist = CFG.camera.dist;
const fwd = new THREE.Vector3(), pivot = new THREE.Vector3(), want = new THREE.Vector3();
function updateCamera(dt) {
  const cc = CFG.camera, cp = Math.cos(aim.pitch);
  fwd.set(-Math.sin(aim.yaw) * cp, Math.sin(aim.pitch), -Math.cos(aim.yaw) * cp);
  pivot.copy(me.pos); pivot.y += 1.1;
  want.copy(pivot).addScaledVector(fwd, -cc.dist); want.y += cc.height;
  want.sub(pivot);
  const len = want.length(); want.divideScalar(len);
  // 건물에 가리지 않도록 당긴다 (당길 땐 즉시, 물러날 땐 천천히)
  const free = world.raycast(pivot.x, pivot.y, pivot.z, want.x, want.y, want.z, len + 0.8) - 0.8;
  const target = clamp(free, 1.2, len);
  camDist = target < camDist ? target : Math.min(target, camDist + 12 * dt);
  camera.position.copy(pivot).addScaledVector(want, camDist);
  camera.rotation.set(aim.pitch, aim.yaw, 0);
  const fov = (zoom ? cc.zoomFov : cc.fov) + (me.drone.boosting ? cc.boostFov : 0);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * (1 - Math.exp(-10 * dt)); camera.updateProjectionMatrix(); }
  // 카메라가 바짝 붙으면 드론이 화면을 가리므로 숨긴다. 출격 보호 중에는 깜빡인다.
  me.drone.model.root.visible = me.alive && camDist > 2.2 && !(me.protT > 0 && Math.floor(me.protT * 10) % 2);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- 메인 루프 ----------
const cmd = { fwd: 0, right: 0, up: 0, boost: false, yaw: 0 };
let last = performance.now(), frame = 0, turn = 0, dt = 0;
function simulate() {
  // 좌우 키는 게걸음이 아니라 기수를 돌린다 (시점도 함께 돈다)
  const steer = axis(['ArrowLeft', 'KeyA'], ['ArrowRight', 'KeyD']);
  turn += (steer * CFG.drone.turnRate * (zoom ? 0.45 : 1) - turn) * (1 - Math.exp(-CFG.drone.turnAccel * dt));
  aim.yaw += turn * dt;

  if (me.alive) {
    cmd.fwd = axis(['KeyW'], ['KeyS']); cmd.up = axis(['ArrowUp'], ['ArrowDown']);
    cmd.boost = keys.has('ShiftLeft') || keys.has('ShiftRight'); cmd.yaw = aim.yaw;
    me.drone.update(dt, cmd, world);
  } else if ((me.respawnT -= dt) <= 0) { spawnPlayer(false); hud.dead.classList.remove('show'); }

  bots.forEach((b, i) => {
    const f = b.f, beam = beams[i];
    if (f.alive) b.update(dt, ctx);
    else if ((f.respawnT -= dt) <= 0) spawnBot(b);
    beam.visible = f.alive && b.aiming && !!b.target;
    if (beam.visible) {
      const t = b.target.pos;
      beam.position.set(f.pos.x, f.pos.y - 0.3, f.pos.z);
      beam.lookAt(t);
      beam.scale.set(1, 1, beam.position.distanceTo(t));
      beam.material.opacity = 0.6 + 0.35 * Math.sin(performance.now() * 0.03);
      if (frame % 3 === 0) fx.emit(f.pos.x, f.pos.y - 0.3, f.pos.z, 0, 0, 0, COL.red, 3.2, 0.12);
    }
  });
  for (const f of fighters) f.tick(dt);

  city.updateCars(dt);
  updateCamera(dt);
  if (me.gun.update(dt, me.alive && (trigger || keys.has('Space')))) shoot();
  if (me.gun.justOverheated) { me.gun.justOverheated = false; sfx.overheat(); }
  bolts.update(dt, world, fighters, onBoltHit);
  fx.update(dt, camera, innerHeight);
}
function tick(now) {
  requestAnimationFrame(tick);
  dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (playing || debugPlay) simulate();            // 시작 전·일시 정지 중에는 세상이 멈춘다
  else { dt = 0; updateCamera(0); }

  const ground = world.surfaceBelow(me.pos.x, me.pos.y, me.pos.z), h = me.pos.y - ground;
  blob.visible = me.alive;
  blob.position.set(me.pos.x, ground + 0.45, me.pos.z);
  blob.scale.setScalar(1 + h * 0.03);
  blob.material.opacity = 0.4 * clamp(1 - h / 60, 0.15, 1);

  renderer.render(scene, camera);
  updateHud();
  if (frame++ % 2 === 0) drawMinimap();
}

resetMatch();
$('loading').remove();
requestAnimationFrame(tick);

// 디버그·자동 시험용
window.__game = { step: d => { dt = d; simulate(); }, me, bots, fighters, aim, world, nav, keys, camera, scene, renderer, bolts, fx, CFG, resetMatch, setDebugPlay: v => { debugPlay = v; } };
