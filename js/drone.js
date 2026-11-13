// 드론(파일럿 탑승) 모델과 호버 비행 물리. 플레이어와 적이 함께 쓴다.
import * as THREE from 'three';
import { CFG } from './config.js';

// 기수는 -Z 방향. 원점이 충돌 구의 중심.
export function createDroneModel(accent = 0x35d6ff) {
  const root = new THREE.Group();          // 위치 + 방위(yaw)
  const tilt = new THREE.Group();          // 가속에 따른 기울임
  root.add(tilt);
  const dark = new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.55, metalness: 0.5 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x8b929b, roughness: 0.5, metalness: 0.6 });
  const glow = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 1.6, roughness: 0.4 });
  const suit = new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.8 });
  const add = (geo, mat, x, y, z, parent = tilt) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };

  // 기체
  add(new THREE.BoxGeometry(0.9, 0.26, 1.7), dark, 0, -0.1, 0);
  add(new THREE.BoxGeometry(0.5, 0.2, 0.5), grey, 0, 0.0, -0.95);                 // 기수
  add(new THREE.BoxGeometry(0.94, 0.06, 1.2), glow, 0, -0.25, 0.1);               // 바닥 발광 띠
  add(new THREE.BoxGeometry(0.3, 0.12, 0.08), glow, 0, -0.05, 0.86);              // 꼬리등
  // 로터 4개
  const rotors = [];
  const ringGeo = new THREE.TorusGeometry(0.62, 0.045, 6, 20); ringGeo.rotateX(Math.PI / 2);
  const bladeGeo = new THREE.BoxGeometry(1.15, 0.02, 0.1);
  const discMat = new THREE.MeshBasicMaterial({ color: 0xd8e4ee, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
  const discGeo = new THREE.CircleGeometry(0.58, 20); discGeo.rotateX(-Math.PI / 2);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const x = sx * 1.02, z = sz * 1.02;
    const arm = add(new THREE.BoxGeometry(0.1, 0.08, 1.25), grey, x / 2, -0.05, z / 2);
    arm.rotation.y = Math.atan2(x, z);
    add(new THREE.CylinderGeometry(0.11, 0.13, 0.22, 10), dark, x, 0.02, z);
    add(ringGeo, glow, x, 0.12, z);
    const spin = new THREE.Group(); spin.position.set(x, 0.16, z); tilt.add(spin);
    add(bladeGeo, dark, 0, 0, 0, spin);
    add(bladeGeo, dark, 0, 0, 0, spin).rotation.y = Math.PI / 2;
    add(discGeo, discMat, 0, 0.01, 0, spin);
    rotors.push(spin);
  }
  // 파일럿 (안장에 앉아 손잡이를 잡은 자세)
  add(new THREE.BoxGeometry(0.42, 0.14, 0.6), grey, 0, 0.1, 0.2);                 // 안장
  add(new THREE.CapsuleGeometry(0.2, 0.42, 4, 10), suit, 0, 0.62, 0.18).rotation.x = -0.25;
  add(new THREE.SphereGeometry(0.2, 14, 10), dark, 0, 1.12, 0.06);                // 헬멧
  add(new THREE.BoxGeometry(0.3, 0.1, 0.06), glow, 0, 1.13, -0.13);               // 바이저
  for (const s of [-1, 1]) {
    add(new THREE.CapsuleGeometry(0.075, 0.5, 3, 6), suit, s * 0.3, 0.68, -0.14).rotation.set(-1.05, 0, s * -0.25);   // 팔
    add(new THREE.CapsuleGeometry(0.09, 0.5, 3, 6), suit, s * 0.3, 0.2, -0.05).rotation.set(-1.2, 0, 0);             // 다리
  }
  add(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 6), dark, 0, 0.5, -0.45).rotation.z = Math.PI / 2;                 // 손잡이
  add(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 6), dark, 0, 0.27, -0.5).rotation.x = 0.3;
  // 레이저 포
  const barrelGeo = new THREE.CylinderGeometry(0.07, 0.09, 1.3, 10); barrelGeo.rotateX(Math.PI / 2);
  add(barrelGeo, grey, 0, -0.3, -0.75);
  add(new THREE.SphereGeometry(0.09, 10, 8), glow, 0, -0.3, -1.42);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, -0.3, -1.5); tilt.add(muzzle);

  root.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
  return { root, tilt, rotors, muzzle };
}

export class Drone {
  constructor(accent) {
    this.model = createDroneModel(accent);
    this.pos = this.model.root.position;
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this._yawRate = 0;
    this.boost = CFG.drone.boostMax;
    this.boosting = false;
    this.bumped = false;        // 이번 프레임에 벽에 닿았는가
    this._regenWait = 0;
    this._locked = false;
  }

  // cmd: { fwd, right, up: -1..1, boost: bool, yaw: 라디안 }
  update(dt, cmd, world) {
    const c = CFG.drone;
    // 선회 속도 (키·마우스 모두) — 기체를 선회 방향으로 눕히는 데 쓴다
    let dyaw = cmd.yaw - this.yaw;
    dyaw -= Math.round(dyaw / (2 * Math.PI)) * 2 * Math.PI;
    const rate = dt > 0 ? Math.max(-2.6, Math.min(2.6, dyaw / dt)) : 0;
    this._yawRate += (rate - this._yawRate) * (1 - Math.exp(-6 * dt));
    // 진행 방향도 기수를 따라 돌린다 (옆으로 미끄러지지 않게)
    const a = Math.max(-0.5, Math.min(0.5, dyaw)) * 0.75, ca = Math.cos(a), sa = Math.sin(a);
    const vx = this.vel.x, vz = this.vel.z;
    this.vel.x = vx * ca + vz * sa; this.vel.z = -vx * sa + vz * ca;
    this.yaw = cmd.yaw;
    const moving = cmd.fwd !== 0 || cmd.right !== 0 || cmd.up !== 0;

    if (this._locked && this.boost >= c.boostRelock) this._locked = false;
    this.boosting = cmd.boost && moving && this.boost > 0 && !this._locked;
    if (this.boosting) {
      this.boost = Math.max(0, this.boost - c.boostDrain * dt);
      this._regenWait = c.boostRegenDelay;
      if (this.boost === 0) this._locked = true;
    } else if ((this._regenWait -= dt) <= 0) {
      this.boost = Math.min(c.boostMax, this.boost + c.boostRegen * dt);
    }

    // 목표 속도 (기수 기준 전후좌우 + 수직)
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let hx = -sin * cmd.fwd + cos * cmd.right, hz = -cos * cmd.fwd - sin * cmd.right;
    const hl = Math.hypot(hx, hz);
    const sp = this.boosting ? c.boostSpeed : c.speed;
    if (hl > 1) { hx /= hl; hz /= hl; }
    const k = 1 - Math.exp(-c.accel * dt);
    this.vel.x += (hx * sp - this.vel.x) * k;
    this.vel.z += (hz * sp - this.vel.z) * k;
    this.vel.y += (cmd.up * c.vSpeed * (this.boosting ? 1.4 : 1) - this.vel.y) * k;

    // 이동 + 충돌 (빠를 때 벽을 뚫지 않도록 잘게 나눠서)
    const steps = Math.max(1, Math.ceil(this.vel.length() * dt / (c.radius * 0.5)));
    this.bumped = false;
    for (let i = 0; i < steps; i++) {
      this.pos.addScaledVector(this.vel, dt / steps);
      if (world.collideSphere(this.pos, c.radius, this.vel, c.minAlt, c.ceiling)) this.bumped = true;
    }

    // 모델: 속도에 따라 기울이고 로터를 돌린다
    const m = this.model;
    m.root.rotation.y = this.yaw;
    const vf = (-sin * this.vel.x - cos * this.vel.z) / c.boostSpeed, vr = (cos * this.vel.x - sin * this.vel.z) / c.boostSpeed;
    const kt = 1 - Math.exp(-8 * dt);
    m.tilt.rotation.x += (-vf * 0.42 - m.tilt.rotation.x) * kt;
    const bank = this._yawRate * c.bank * (0.45 + 0.55 * Math.min(1, this.speed / c.speed));
    m.tilt.rotation.z += (-vr * 0.5 + bank - m.tilt.rotation.z) * kt;
    const spin = (38 + this.vel.length() * 0.8) * dt;
    m.rotors.forEach((r, i) => { r.rotation.y += i % 2 ? spin : -spin; });
  }

  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
}
