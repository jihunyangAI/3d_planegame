// 전투원: 드론 + 체력·실드·레이저 포. 플레이어와 적이 함께 쓴다.
import { Drone } from './drone.js';
import { Gun } from './weapons.js';
import { CFG } from './config.js';

export class Fighter {
  constructor(scene, name, color, stats, isPlayer = false) {
    this.name = name; this.isPlayer = isPlayer; this.color = color;
    this.drone = new Drone(color);
    scene.add(this.drone.model.root);
    this.pos = this.drone.pos; this.vel = this.drone.vel;
    this.gun = new Gun();
    this.maxHp = stats.hp; this.maxShield = stats.shield; this.hitRadius = stats.hitRadius;
    this.hp = 0; this.shield = 0; this.alive = false;
    this.kills = 0; this.deaths = 0;
    this.sinceHit = 99;          // 마지막으로 맞은 뒤 지난 시간
    this.lastAttacker = null;
    this.protT = 0;              // 출격 직후 무적 시간
    this.respawnT = 0;
    this.drone.model.root.visible = false;
  }

  spawn(x, y, z, yaw, protect = 0) {
    this.pos.set(x, y, z); this.vel.set(0, 0, 0);
    this.drone.yaw = yaw; this.drone.model.root.rotation.y = yaw;
    this.drone.boost = CFG.drone.boostMax;
    this.gun.heat = 0; this.gun.overheated = false;
    this.hp = this.maxHp; this.shield = this.maxShield; this.alive = true;
    this.sinceHit = 99; this.lastAttacker = null; this.protT = protect;
    this.drone.model.root.visible = true;
  }

  tick(dt) {
    this.sinceHit += dt;
    this.protT = Math.max(0, this.protT - dt);
    if (this.alive && this.sinceHit > CFG.player.shieldDelay) this.shield = Math.min(this.maxShield, this.shield + CFG.player.shieldRegen * dt);
  }

  // 'kill' | 'hit'(본체 피해) | 'shield'(실드가 다 막음) | null(무효)
  damage(amount, from) {
    if (!this.alive || this.protT > 0) return null;
    this.sinceHit = 0; this.lastAttacker = from;
    const s = Math.min(this.shield, amount);
    this.shield -= s; this.hp -= amount - s;
    if (this.hp > 0) return s === amount ? 'shield' : 'hit';
    this.hp = 0; this.alive = false; this.deaths++;
    if (from) from.kills++;
    this.drone.model.root.visible = false;
    return 'kill';
  }
}
