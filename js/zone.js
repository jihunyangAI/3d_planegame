// 자기장: 단계마다 기다렸다가 다음 원으로 줄어든다. 원 밖에 있으면 피해를 받는다.
import * as THREE from 'three';
import { CFG } from './config.js';

export class Zone {
  constructor(scene, R) {
    this.R = R;
    this.cur = { x: 0, z: 0, r: R }; this.next = { x: 0, z: 0, r: R }; this.from = { x: 0, z: 0, r: R };
    this.phase = 0; this.t = 0; this.shrinking = false;
    this.mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 110, 160, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x8a6bff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, fog: false }));
    this.mesh.renderOrder = 3;
    scene.add(this.mesh);
  }

  reset(nav) {
    this.cur.x = this.cur.z = 0; this.cur.r = this.R;
    this.phase = 0; this.t = 0; this.shrinking = false;
    this.pickNext(nav);
    this.draw();
  }

  // 다음 원: 지금 원 안에 완전히 들어가는 곳 중 길 위의 한 점을 중심으로 삼는다
  pickNext(nav) {
    const ph = CFG.zone.phases[this.phase];
    if (!ph) { Object.assign(this.next, this.cur); return; }
    const slack = (this.cur.r - ph.radius) * 0.85;
    let x = this.cur.x, z = this.cur.z;
    for (let k = 0; k < 80; k++) {
      const n = nav.random();
      if (Math.hypot(nav.x[n] - this.cur.x, nav.z[n] - this.cur.z) <= slack) { x = nav.x[n]; z = nav.z[n]; break; }
    }
    this.next.x = x; this.next.z = z; this.next.r = ph.radius;
  }

  get done() { return this.phase >= CFG.zone.phases.length; }
  get dps() { const p = CFG.zone.phases; return p[Math.min(this.phase, p.length - 1)].dps * (CFG.zone.dpsScale || 1); }
  // 다음 변화(축소 시작 또는 축소 끝)까지 남은 시간
  get timeLeft() { const ph = CFG.zone.phases[this.phase]; return ph ? (this.shrinking ? ph.shrink : ph.wait) - this.t : 0; }
  // 원 밖으로 얼마나 나가 있는가 (안쪽이면 음수)
  outside(p) { return Math.hypot(p.x - this.cur.x, p.z - this.cur.z) - this.cur.r; }

  update(dt, nav) {
    const ph = CFG.zone.phases[this.phase];
    if (!ph) return;
    this.t += dt;
    if (!this.shrinking) {
      if (this.t >= ph.wait) { this.shrinking = true; this.t = 0; Object.assign(this.from, this.cur); }
    } else {
      const k = Math.min(1, this.t / ph.shrink);
      this.cur.x = this.from.x + (this.next.x - this.from.x) * k;
      this.cur.z = this.from.z + (this.next.z - this.from.z) * k;
      this.cur.r = this.from.r + (this.next.r - this.from.r) * k;
      if (k >= 1) { this.shrinking = false; this.t = 0; this.phase++; this.pickNext(nav); }
    }
    this.draw();
  }

  draw() {
    const r = Math.max(0.01, this.cur.r);
    this.mesh.visible = this.cur.r > 0.5;
    this.mesh.position.set(this.cur.x, 55, this.cur.z);
    this.mesh.scale.set(r, 1, r);
  }
}
