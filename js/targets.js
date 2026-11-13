// 연습용 표적 드론: 제자리에 떠 있거나 길을 따라 천천히 왕복한다. 쏘지는 않는다.
import * as THREE from 'three';
import { createDroneModel } from './drone.js';
import { CFG } from './config.js';

class Target {
  constructor(scene) {
    this.model = createDroneModel(0xff5a4a);
    this.pos = this.model.root.position;
    this.vel = new THREE.Vector3();
    this.hitRadius = CFG.target.hitRadius;
    this.alive = false;
    this.hp = 0;
    this.respawn = 0;
    this.flash = 0;                // 맞았을 때 잠깐 번쩍
    this.base = new THREE.Vector3(); this.dir = new THREE.Vector3(); this.span = 0; this.phase = 0;
    scene.add(this.model.root);
    this.model.root.visible = false;
  }
}

export class Targets {
  constructor(scene, world) {
    this.world = world;
    this.list = Array.from({ length: CFG.target.count }, () => new Target(scene));
    this.kills = 0;
  }

  // center(플레이어) 주변의 트인 곳에 표적을 놓는다. 앞쪽 몇 대는 가까이.
  place(t, center, near) {
    const w = this.world, c = CFG.target;
    for (let tries = 0; tries < 400; tries++) {
      const a = Math.random() * 6.283, r = near ? 50 + Math.random() * 90 : 90 + Math.random() * (c.spread - 90);
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      if (!w.isOpen(x, z, 9)) continue;
      const y = 7 + Math.random() * 24;
      t.pos.set(x, y, z);
      // 가장 길게 트인 방향으로 왕복 (절반은 제자리)
      t.span = 0;
      if (Math.random() < c.movingRatio) {
        let best = 0, ba = 0;
        for (let k = 0; k < 16; k++) {
          const d = w.raycast(x, y, z, Math.cos(k * Math.PI / 8), 0, Math.sin(k * Math.PI / 8), 120);
          if (d > best) { best = d; ba = k * Math.PI / 8; }
        }
        if (best > 35) { t.span = Math.min(best - 12, 80); t.dir.set(Math.cos(ba), 0, Math.sin(ba)); }
      }
      t.base.copy(t.pos); t.phase = 0; t.bob = Math.random() * 6.283;
      t.hp = c.hp; t.alive = true; t.vel.set(0, 0, 0); t.flash = 0;
      t.model.root.visible = true;
      t.model.root.rotation.y = Math.random() * 6.283;
      return;
    }
  }

  reset(center) {
    this.kills = 0;
    this.list.forEach((t, i) => this.place(t, center, i < 4));
  }

  // 피해를 주고, 격추되면 true
  damage(t, amount) {
    if (!t.alive) return false;
    t.hp -= amount; t.flash = 0.12;
    if (t.hp > 0) return false;
    t.alive = false; t.model.root.visible = false; t.respawn = CFG.target.respawn;
    this.kills++;
    return true;
  }

  update(dt, center) {
    const c = CFG.target;
    for (const t of this.list) {
      if (!t.alive) {
        if ((t.respawn -= dt) <= 0) this.place(t, center, false);
        continue;
      }
      const px = t.pos.x, py = t.pos.y, pz = t.pos.z;
      t.bob += dt * 1.6;
      if (t.span > 0) {
        t.phase += dt * c.speed * 2 / t.span;
        const s = t.span * (0.5 - 0.5 * Math.cos(t.phase));
        t.pos.copy(t.base).addScaledVector(t.dir, s);
      }
      t.pos.y = t.base.y + Math.sin(t.bob) * 0.5;
      if (dt > 0) t.vel.set((t.pos.x - px) / dt, (t.pos.y - py) / dt, (t.pos.z - pz) / dt);
      const m = t.model;
      if (t.span > 0 && Math.hypot(t.vel.x, t.vel.z) > 0.4) {            // 진행 방향을 바라본다
        let d = Math.atan2(-t.vel.x, -t.vel.z) - m.root.rotation.y;
        d -= Math.round(d / 6.283) * 6.283;
        m.root.rotation.y += d * (1 - Math.exp(-3 * dt));
      } else if (t.span === 0) m.root.rotation.y += dt * 0.35;
      m.rotors.forEach((r, i) => { r.rotation.y += (i % 2 ? 36 : -36) * dt; });
      t.flash = Math.max(0, t.flash - dt);
      m.tilt.scale.setScalar(1 + t.flash * 1.2);
    }
  }
}
