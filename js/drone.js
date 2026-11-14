// 드론(파일럿 탑승) 모델과 호버 비행 물리. 플레이어와 적이 함께 쓴다.
import * as THREE from 'three';
import { CFG } from './config.js';
import { createPilot } from './pilot.js';
import { createDroneBody } from './dronemodel.js';

// 기수는 -Z 방향. 원점이 충돌 구의 중심.
export function createDroneModel(accent = 0x35d6ff, enemy = false) {
  const root = new THREE.Group();          // 위치 + 방위(yaw)
  const tilt = new THREE.Group();          // 가속에 따른 기울임
  root.add(tilt);
  const body = createDroneBody(accent, enemy);     // 동체·덕트 팬·스키드·추진기 (dronemodel.js)
  tilt.add(body.group);
  const rotors = body.rotors;
  // 조종사: 드론 위에 올라서서 레이저총을 겨눈다
  const pilot = createPilot({ enemy });
  pilot.root.position.set(0, 0.03, 0.04);
  tilt.add(pilot.root);
  const muzzle = pilot.muzzle;

  return { root, tilt, rotors, muzzle, pilot, flames: body.flames };
}

export class Drone {
  constructor(accent, enemy = false) {
    this.model = createDroneModel(accent, enemy);
    this.pos = this.model.root.position;
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this._yawRate = 0;
    this.speedScale = 1;        // 속도 배율 (적은 조금 느리다)
    this.boostFree = false;     // 부스트 강화: 게이지가 줄지 않는다
    this.aimPitch = 0;          // 조준 높낮이 (조종사 상체와 총이 따라간다)
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
      if (!this.boostFree) this.boost = Math.max(0, this.boost - c.boostDrain * dt);
      this._regenWait = c.boostRegenDelay;
      if (this.boost === 0) this._locked = true;
    } else if ((this._regenWait -= dt) <= 0) {
      this.boost = Math.min(c.boostMax, this.boost + c.boostRegen * dt);
    }

    // 목표 속도 (기수 기준 전후좌우 + 수직)
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let hx = -sin * cmd.fwd + cos * cmd.right, hz = -cos * cmd.fwd - sin * cmd.right;
    const hl = Math.hypot(hx, hz);
    const sp = (this.boosting ? c.boostSpeed : c.speed) * this.speedScale;
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
    m.pilot.setPitch(this.aimPitch - m.tilt.rotation.x);
    const vf = (-sin * this.vel.x - cos * this.vel.z) / c.boostSpeed, vr = (cos * this.vel.x - sin * this.vel.z) / c.boostSpeed;
    const kt = 1 - Math.exp(-8 * dt);
    m.tilt.rotation.x += (-vf * 0.42 - m.tilt.rotation.x) * kt;
    const bank = this._yawRate * c.bank * (0.45 + 0.55 * Math.min(1, this.speed / c.speed));
    m.tilt.rotation.z += (-vr * 0.5 + bank - m.tilt.rotation.z) * kt;
    const spin = (38 + this.vel.length() * 0.8) * dt;
    m.rotors.forEach((r, i) => { r.rotation.y += i % 2 ? spin : -spin; });
    m.flames.visible = this.boosting;                 // 부스트할 때 추진기에서 불꽃이 뻗는다
    if (this.boosting) m.flames.scale.set(1, 1, 0.75 + Math.random() * 0.5);
  }

  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
}
