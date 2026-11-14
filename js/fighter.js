// 전투원: 드론 + 체력·실드·레이저 포. 플레이어와 적이 함께 쓴다.
import { Drone } from './drone.js';
import { Gun } from './weapons.js';
import { CFG } from './config.js';

export class Fighter {
  constructor(scene, name, color, stats, isPlayer = false) {
    this.name = name; this.isPlayer = isPlayer; this.color = color;
    this.drone = new Drone(color, !isPlayer);
    scene.add(this.drone.model.root);
    this.pos = this.drone.pos; this.vel = this.drone.vel;
    this.gun = new Gun();
    this.maxHp = stats.hp; this.maxShield = stats.shield; this.hitRadius = stats.hitRadius;
    this.hp = 0; this.shield = 0; this.alive = false;
    this.kills = 0; this.deaths = 0;
    this.sinceHit = 99;          // 마지막으로 맞은 뒤 지난 시간
    this.lastAttacker = null;
    this.protT = 0;              // 출격 직후 무적 시간
    this.twinT = 0;              // 쌍발 레이저 남은 시간
    this.boostT = 0;             // 부스트 강화 남은 시간
    this.place = 0;              // 격추됐을 때의 순위
    this.drone.model.root.visible = false;
  }

  spawn(x, y, z, yaw, protect = 0) {
    this.pos.set(x, y, z); this.vel.set(0, 0, 0);
    this.drone.yaw = yaw; this.drone.model.root.rotation.y = yaw;
    this.drone.boost = CFG.drone.boostMax;
    this.gun.heat = 0; this.gun.overheated = false;
    this.hp = this.maxHp; this.shield = this.maxShield; this.alive = true;
    this.sinceHit = 99; this.lastAttacker = null; this.protT = protect;
    this.twinT = this.boostT = 0; this.place = 0;
    this.drone.model.root.visible = true;
  }

  tick(dt) {
    this.sinceHit += dt;
    this.protT = Math.max(0, this.protT - dt);
    this.twinT = Math.max(0, this.twinT - dt); this.boostT = Math.max(0, this.boostT - dt);
    this.drone.boostFree = this.boostT > 0;
    if (this.alive && this.sinceHit > CFG.player.shieldDelay) this.shield = Math.min(this.maxShield, this.shield + CFG.player.shieldRegen * dt);
  }

  // 'kill' | 'hit'(본체 피해) | 'shield'(실드가 다 막음) | null(무효). bypass: 자기장 피해처럼 실드를 무시한다.
  damage(amount, from, bypass = false) {
    if (!this.alive || this.protT > 0) return null;
    if (!bypass) { this.sinceHit = 0; this.lastAttacker = from; }
    const s = bypass ? 0 : Math.min(this.shield, amount);
    this.shield -= s; this.hp -= amount - s;
    if (this.hp > 0) return s === amount ? 'shield' : 'hit';
    this.hp = 0; this.alive = false; this.deaths++;
    if (from) from.kills++;
    this.drone.model.root.visible = false;
    return 'kill';
  }
}
