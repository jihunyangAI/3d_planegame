// 레이저: 과열 게이지가 있는 포(Gun)와 날아가는 광선탄(Bolts).
import * as THREE from 'three';
import { CFG } from './config.js';

// 쏘는 쪽마다 하나씩 갖는 과열 상태
export class Gun {
  constructor() { this.heat = 0; this.overheated = false; this.justOverheated = false; this._wait = 0; this._idle = 0; }

  // 이번 프레임에 한 발 쏘아야 하면 true
  update(dt, wantFire) {
    const c = CFG.laser;
    this._wait -= dt; this._idle += dt;
    if (this._idle > c.coolDelay || this.overheated) this.heat = Math.max(0, this.heat - c.coolRate * (this.overheated ? 1.3 : 1) * dt);
    if (this.overheated && this.heat <= c.overheatUnlock) this.overheated = false;
    if (!wantFire || this.overheated || this._wait > 0) return false;
    this._wait = 1 / c.rate; this._idle = 0;
    this.heat = Math.min(100, this.heat + c.heatPerShot);
    if (this.heat >= 100) { this.overheated = true; this.justOverheated = true; }
    return true;
  }
}

const MAXB = 96;
const _q = new THREE.Quaternion(), _z = new THREE.Vector3(0, 0, 1), _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _hidden = new THREE.Matrix4().makeScale(0, 0, 0);

export class Bolts {
  constructor(scene) {
    const geo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true); geo.rotateX(Math.PI / 2);     // Z 축 방향 막대
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAXB * 2);       // 굵은 빛무리 + 가는 심
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 4;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const white = new THREE.Color(0xffffff);
    for (let i = 0; i < MAXB * 2; i++) { this.mesh.setMatrixAt(i, _hidden); this.mesh.setColorAt(i, white); }
    scene.add(this.mesh);
    this.list = Array.from({ length: MAXB }, () => ({ alive: false, pos: new THREE.Vector3(), dir: new THREE.Vector3(), left: 0, flown: 0, owner: null, damage: 0, color: new THREE.Color() }));
    this.next = 0;
  }

  fire(origin, dir, owner, color, damage = CFG.laser.damage) {
    const b = this.list[this.next]; this.next = (this.next + 1) % MAXB;
    b.alive = true; b.pos.copy(origin); b.dir.copy(dir).normalize(); b.left = CFG.laser.range; b.flown = 0;
    b.owner = owner; b.damage = damage; b.color.set(color);
    const i = this.list.indexOf(b);
    this.mesh.setColorAt(2 * i, b.color); this.mesh.instanceColor.needsUpdate = true;
  }

  // victims: [{ pos, hitRadius, alive }]. onHit(bolt, victim|null, point) — victim 이 null 이면 벽·지면.
  update(dt, world, victims, onHit) {
    const c = CFG.laser;
    for (let i = 0; i < MAXB; i++) {
      const b = this.list[i];
      if (!b.alive) continue;
      const step = Math.min(c.speed * dt, b.left);
      let t = world.raycast(b.pos.x, b.pos.y, b.pos.z, b.dir.x, b.dir.y, b.dir.z, step), who = null;
      const wallT = t;
      for (const v of victims) {
        if (!v.alive || v === b.owner) continue;
        // 선분과 구의 교차
        const ox = v.pos.x - b.pos.x, oy = v.pos.y - b.pos.y, oz = v.pos.z - b.pos.z;
        const along = ox * b.dir.x + oy * b.dir.y + oz * b.dir.z;
        if (along < -v.hitRadius || along > t + v.hitRadius) continue;
        const d2 = ox * ox + oy * oy + oz * oz - along * along, r2 = v.hitRadius * v.hitRadius;
        if (d2 > r2) continue;
        const th = Math.max(0, along - Math.sqrt(r2 - d2));
        if (th <= t) { t = th; who = v; }
      }
      const hit = who || wallT < step;
      b.pos.addScaledVector(b.dir, t); b.left -= t; b.flown += t;
      if (hit) { b.alive = false; onHit(b, who, b.pos); }
      else if (b.left <= 0 || Math.hypot(b.pos.x, b.pos.z) > world.R) b.alive = false;

      if (!b.alive) { this.mesh.setMatrixAt(2 * i, _hidden); this.mesh.setMatrixAt(2 * i + 1, _hidden); continue; }
      const len = Math.min(c.length, b.flown);                       // 총구에서 뻗어 나오듯
      _q.setFromUnitVectors(_z, b.dir);
      _p.copy(b.pos).addScaledVector(b.dir, -len / 2);
      this.mesh.setMatrixAt(2 * i, _m.compose(_p, _q, _s.set(0.22, 0.22, len)));
      this.mesh.setMatrixAt(2 * i + 1, _m.compose(_p, _q, _s.set(0.07, 0.07, len)));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
