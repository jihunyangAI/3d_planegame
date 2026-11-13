// 홍대 드론 로얄 — 2단계: 비행 + 레이저 사격 연습
import * as THREE from 'three';
import { buildCity } from './city.js';
import { World } from './world.js';
import { Drone } from './drone.js';
import { CFG } from './config.js';
import { Gun, Bolts } from './weapons.js';
import { Targets } from './targets.js';
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

// 경기장 경계 벽
{
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(D.radius, D.radius, 90, 160, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xff5a5f, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false, fog: false }));
  wall.position.y = 45;
  scene.add(wall);
}

// ---------- 플레이어 ----------
const player = new Drone(0x35d6ff);
scene.add(player.model.root);
const blob = new THREE.Mesh(new THREE.CircleGeometry(1.9, 24),            // 고도를 가늠하게 해 주는 바닥 그림자
  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
blob.rotation.x = -Math.PI / 2;
scene.add(blob);

const fx = new Particles(scene), bolts = new Bolts(scene), gun = new Gun(), targets = new Targets(scene, world);

const aim = { yaw: 0, pitch: -0.12 };
function spawn() {
  // 원점(9번출구)에서 가장 가까운 트인 곳
  let sx = 0, sz = 0;
  search: for (let r = 0; r < 300; r += 6) for (let a = 0; a < 12; a++) {
    const x = Math.cos(a * Math.PI / 6) * r, z = Math.sin(a * Math.PI / 6) * r;
    if (world.isOpen(x, z, 9)) { sx = x; sz = z; break search; }
  }
  player.pos.set(sx, CFG.spawnAlt, sz);
  player.vel.set(0, 0, 0);
  player.boost = CFG.drone.boostMax;
  // 가장 멀리 트인 방향(길을 따라)을 바라본다
  let best = -1;
  for (let a = 0; a < 32; a++) {
    const yaw = a * Math.PI / 16, t = world.raycast(sx, CFG.spawnAlt, sz, -Math.sin(yaw), 0, -Math.cos(yaw), 600);
    if (t > best) { best = t; aim.yaw = yaw; }
  }
  aim.pitch = -0.12;
  camDist = CFG.camera.dist;
  gun.heat = 0; gun.overheated = false;
  targets.reset(player.pos);
}

// ---------- 입력 ----------
const keys = new Set();
const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight']);
let zoom = false, trigger = false, playing = false, debugPlay = false;
addEventListener('keydown', e => {
  if (GAME_KEYS.has(e.code)) e.preventDefault();
  keys.add(e.code);
  if (e.code === 'KeyR' && playing) spawn();
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
  const S = mm.width, c = S / 2;
  mctx.clearRect(0, 0, S, S);
  mctx.save();
  mctx.beginPath(); mctx.arc(c, c, c - 2, 0, 7); mctx.clip();
  mctx.fillStyle = '#10151c'; mctx.fillRect(0, 0, S, S);
  const mx = player.pos.x, my = -player.pos.z;                          // 지도 좌표
  const sx = (mx - MM.range + D.radius) * MM.px, sy = (D.radius - my - MM.range) * MM.px, sw = 2 * MM.range * MM.px;
  mctx.drawImage(mapImg, sx, sy, sw, sw, 0, 0, S, S);
  const k = c / MM.range;                                               // 표적: 범위 밖이면 테두리에 작게
  for (const t of targets.list) {
    if (!t.alive) continue;
    let dx = (t.pos.x - player.pos.x) * k, dy = (t.pos.z - player.pos.z) * k, r = 7;
    const d = Math.hypot(dx, dy), lim = c - 12;
    if (d > lim) { dx *= lim / d; dy *= lim / d; r = 4; }
    mctx.beginPath(); mctx.arc(c + dx, c + dy, r, 0, 7);
    mctx.fillStyle = '#ff5a4a'; mctx.strokeStyle = '#2a0b08'; mctx.lineWidth = 2; mctx.fill(); mctx.stroke();
  }
  mctx.translate(c, c); mctx.rotate(-aim.yaw);                          // 플레이어 화살표 (북쪽이 위)
  mctx.beginPath(); mctx.moveTo(0, -13); mctx.lineTo(9, 10); mctx.lineTo(0, 5); mctx.lineTo(-9, 10); mctx.closePath();
  mctx.fillStyle = '#35d6ff'; mctx.strokeStyle = '#06222c'; mctx.lineWidth = 2.5; mctx.fill(); mctx.stroke();
  mctx.restore();
  mctx.beginPath(); mctx.arc(c, c, c - 2, 0, 7); mctx.strokeStyle = 'rgba(255,255,255,.55)'; mctx.lineWidth = 3; mctx.stroke();
}

// ---------- HUD ----------
const hud = { speed: $('h-speed'), alt: $('h-alt'), boost: $('h-boost'), warn: $('h-warn'), place: $('h-place'),
  heat: $('h-heat'), heatLabel: $('h-heat-label'), kills: $('h-kills'), hitmark: $('hitmark'), toast: $('toast'), bars: $('tbars') };
let toastTimer = 0, hitTimer = 0;
function toast(text) { hud.toast.textContent = text; hud.toast.classList.add('show'); toastTimer = 1.4; }
function hitMark(kill) { hud.hitmark.className = 'hud show' + (kill ? ' kill' : ''); hitTimer = kill ? 0.35 : 0.12; }
const barEls = targets.list.map(() => { const el = document.createElement('div'); el.className = 'tbar'; el.appendChild(document.createElement('i')); hud.bars.appendChild(el); return el; });
const _v = new THREE.Vector3();
function updateTargetBars() {
  targets.list.forEach((t, i) => {
    const el = barEls[i];
    let show = false;
    if (t.alive) {
      _v.copy(t.pos).sub(camera.position);
      const dist = _v.length();
      if (dist < 450 && (t.hp < CFG.target.hp || dist < 220) && _v.dot(fwd) > 0) {
        _v.divideScalar(dist);
        if (world.raycast(camera.position.x, camera.position.y, camera.position.z, _v.x, _v.y, _v.z, dist) >= dist - 0.01) {
          _v.copy(t.pos); _v.y += 2.8; _v.project(camera);
          if (Math.abs(_v.x) < 1 && Math.abs(_v.y) < 1) {
            show = true;
            el.style.transform = `translate(${((_v.x + 1) / 2 * innerWidth).toFixed(1)}px, ${((1 - _v.y) / 2 * innerHeight).toFixed(1)}px)`;
            el.firstChild.style.width = Math.max(0, t.hp / CFG.target.hp * 100) + '%';
          }
        }
      }
    }
    el.style.display = show ? 'block' : 'none';
  });
}
function updateHud() {
  hud.speed.textContent = Math.round(player.speed * 3.6);
  hud.alt.textContent = Math.round(player.pos.y);
  hud.boost.style.width = (player.boost / CFG.drone.boostMax * 100).toFixed(1) + '%';
  hud.boost.parentElement.classList.toggle('on', player.boosting);
  const edge = Math.hypot(player.pos.x, player.pos.z) > D.radius - 40;
  const top = player.pos.y > CFG.drone.ceiling - 0.3;
  hud.warn.textContent = edge ? '경기장 경계입니다' : top ? '최고 고도' : '';
  const dist = Math.round(Math.hypot(player.pos.x, player.pos.z));
  hud.place.textContent = `9번출구에서 ${dist}m`;
  hud.heat.style.width = gun.heat.toFixed(1) + '%';
  hud.heat.parentElement.classList.toggle('over', gun.overheated);
  hud.heatLabel.textContent = gun.overheated ? '과열! 식는 중' : '레이저 열';
  hud.kills.textContent = targets.kills;
  if (toastTimer > 0 && (toastTimer -= dt) <= 0) hud.toast.classList.remove('show');
  if (hitTimer > 0 && (hitTimer -= dt) <= 0) hud.hitmark.className = 'hud';
  updateTargetBars();
}

// ---------- 사격 ----------
const _aimP = new THREE.Vector3(), _muz = new THREE.Vector3(), _dir = new THREE.Vector3(), _sp = new THREE.Vector3();
const COL = { laser: new THREE.Color(CFG.laser.color), spark: new THREE.Color(0xbfefff), fire: new THREE.Color(0xff9a3c), hot: new THREE.Color(0xfff1c9), red: new THREE.Color(0xff5a4a) };
const loud = p => clamp(1 - p.distanceTo(player.pos) / 420, 0.12, 1);

// 조준점: 화면 가운데 광선이 닿는 곳. 조준 보정 각도 안에 표적이 있으면 그 표적(이동 예측 포함).
function resolveAim(out) {
  const o = camera.position, c = CFG.laser;
  const wallT = world.raycast(o.x, o.y, o.z, fwd.x, fwd.y, fwd.z, c.range);
  const lim = Math.tan(THREE.MathUtils.degToRad(c.assistDeg) * camera.fov / CFG.camera.fov);
  let best = null, bestAng = Infinity, bestDist = 0;
  for (const t of targets.list) {
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

function shoot() {
  player.model.root.updateMatrixWorld(true);
  player.model.muzzle.getWorldPosition(_muz);
  resolveAim(_aimP);
  _dir.copy(_aimP).sub(_muz);
  if (_dir.length() < 4 || _dir.dot(fwd) <= 0) _dir.copy(fwd);
  bolts.fire(_muz, _dir, player, CFG.laser.color);
  fx.emit(_muz.x, _muz.y, _muz.z, player.vel.x, player.vel.y, player.vel.z, COL.laser, 2.2, 0.07);
  sfx.laser();
}

function onBoltHit(b, victim, p) {
  _sp.copy(p).addScaledVector(b.dir, -0.25);
  if (!victim) {
    fx.burst(_sp, 5, COL.spark, 9, 0.4, 0.22, 10);
    sfx.wall(loud(p) * 0.7);
    return;
  }
  fx.burst(_sp, 9, COL.fire, 13, 0.55, 0.28, 6);
  if (targets.damage(victim, b.damage)) {
    fx.burst(victim.pos, 44, COL.fire, 27, 1.7, 0.95, 6);
    fx.burst(victim.pos, 16, COL.red, 12, 2.6, 0.6, 2);
    fx.burst(victim.pos, 10, COL.hot, 6, 4.2, 0.3);
    fx.emit(victim.pos.x, victim.pos.y, victim.pos.z, 0, 0, 0, COL.hot, 16, 0.16);
    sfx.explode(loud(victim.pos));
    hitMark(true);
    toast('표적 격추!');
  } else {
    sfx.hit(loud(p));
    hitMark(false);
  }
}

// ---------- 카메라 (3인칭 추적) ----------
let camDist = CFG.camera.dist;
const fwd = new THREE.Vector3(), pivot = new THREE.Vector3(), want = new THREE.Vector3();
function updateCamera(dt) {
  const cc = CFG.camera, cp = Math.cos(aim.pitch);
  fwd.set(-Math.sin(aim.yaw) * cp, Math.sin(aim.pitch), -Math.cos(aim.yaw) * cp);
  pivot.copy(player.pos); pivot.y += 1.1;
  want.copy(pivot).addScaledVector(fwd, -cc.dist); want.y += cc.height;
  want.sub(pivot);
  const len = want.length(); want.divideScalar(len);
  // 건물에 가리지 않도록 당긴다 (당길 땐 즉시, 물러날 땐 천천히)
  const free = world.raycast(pivot.x, pivot.y, pivot.z, want.x, want.y, want.z, len + 0.8) - 0.8;
  const target = clamp(free, 1.2, len);
  camDist = target < camDist ? target : Math.min(target, camDist + 12 * dt);
  camera.position.copy(pivot).addScaledVector(want, camDist);
  camera.rotation.set(aim.pitch, aim.yaw, 0);
  const fov = (zoom ? cc.zoomFov : cc.fov) + (player.boosting ? cc.boostFov : 0);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * (1 - Math.exp(-10 * dt)); camera.updateProjectionMatrix(); }
  // 카메라가 바짝 붙으면 드론이 화면을 가리므로 숨긴다
  player.model.root.visible = camDist > 2.2;
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- 메인 루프 ----------
const idle = { fwd: 0, right: 0, up: 0, boost: false, yaw: 0 };
let last = performance.now(), frame = 0, turn = 0, dt = 0;
function tick(now) {
  requestAnimationFrame(tick);
  dt = Math.min(0.05, (now - last) / 1000); last = now;
  const active = playing || debugPlay;
  // 좌우 키는 게걸음이 아니라 기수를 돌린다 (시점도 함께 돈다)
  const steer = active ? axis(['ArrowLeft', 'KeyA'], ['ArrowRight', 'KeyD']) : 0;
  turn += (steer * CFG.drone.turnRate * (zoom ? 0.45 : 1) - turn) * (1 - Math.exp(-CFG.drone.turnAccel * dt));
  aim.yaw += turn * dt;
  const cmd = active ? {
    fwd: axis(['KeyW'], ['KeyS']),
    right: 0,
    up: axis(['ArrowUp'], ['ArrowDown']),
    boost: keys.has('ShiftLeft') || keys.has('ShiftRight'),
    yaw: aim.yaw,
  } : (idle.yaw = aim.yaw, idle);
  player.update(dt, cmd, world);

  const ground = world.surfaceBelow(player.pos.x, player.pos.y, player.pos.z);
  const h = player.pos.y - ground;
  blob.position.set(player.pos.x, ground + 0.45, player.pos.z);
  blob.scale.setScalar(1 + h * 0.03);
  blob.material.opacity = 0.4 * clamp(1 - h / 60, 0.15, 1);

  city.updateCars(dt);
  targets.update(dt, player.pos);
  updateCamera(dt);
  if (gun.update(dt, active && (trigger || keys.has('Space')))) shoot();
  if (gun.justOverheated) { gun.justOverheated = false; sfx.overheat(); }
  bolts.update(dt, world, targets.list, onBoltHit);
  fx.update(dt, camera, innerHeight);
  renderer.render(scene, camera);
  updateHud();
  if (frame++ % 2 === 0) drawMinimap();
}

spawn();
$('loading').remove();
requestAnimationFrame(tick);

// 디버그·자동 시험용
window.__game = { player, aim, world, keys, camera, scene, renderer, spawn, CFG, gun, bolts, targets, fx, setDebugPlay: v => { debugPlay = v; } };
