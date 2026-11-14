// 적 AI: 순찰 → 발견 → 교전 → (놓치면) 추격 → (체력이 낮으면) 후퇴.
import { CFG } from './config.js';

const TAU = Math.PI * 2;
const wrap = a => a - Math.round(a / TAU) * TAU;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const SCAN = 0.3;                                 // 주변을 살피는 간격 (초)

function sees(world, a, b, dist) {
  if (dist < 0.5) return true;
  return world.raycast(a.x, a.y, a.z, (b.x - a.x) / dist, (b.y - a.y) / dist, (b.z - a.z) / dist, dist) >= dist - 0.01;
}

export class Bot {
  constructor(fighter) {
    this.f = fighter;
    this.cmd = { fwd: 0, right: 0, up: 0, boost: false, yaw: 0 };
    this.lastKnown = { x: 0, y: 0, z: 0 };
    this.reset();
  }

  reset() {
    this.state = 'patrol';
    this.path = []; this.pi = 0;
    this.target = null; this.targetVisible = false; this.lostT = 0;
    this.pending = null; this.pendingT = 0;
    this.scanT = Math.random() * SCAN;
    this.alt = 8 + Math.random() * 22;            // 선호 고도
    this.altOff = (Math.random() - 0.5) * 10;     // 교전 때 상대보다 얼마나 위·아래에 있을지
    this.strafe = Math.random() < 0.5 ? 1 : -1; this.strafeT = 1;
    this.phase = 'cool'; this.phaseT = 1 + Math.random() * 2; this.shots = 0;
    this.aiming = false;                          // 조준선을 켜고 있는가
    this.stuckT = 0; this.stateT = 0; this.fled = false;
    this.zoneNeed = 0;                            // 자기장: 0 안전, 1 곧 줄어들 곳, 2 밖
    this.itemGoal = null;                         // 먹으러 가는 아이템
  }

  drop() { this.target = null; this.targetVisible = false; this.lostT = 0; this.pending = null; this.pendingT = 0; this.phase = 'cool'; this.phaseT = 0.8; }
  engage(t) { this.target = t; this.targetVisible = true; this.lostT = 0; this.state = 'engage'; this.lastKnown.x = t.pos.x; this.lastKnown.y = t.pos.y; this.lastKnown.z = t.pos.z; if (this.phase === 'cool') this.phaseT = Math.max(this.phaseT, 0.4); }

  goTo(node, ctx) {
    const p = this.f.pos;
    this.path = ctx.nav.path(ctx.nav.nearest(p.x, p.y, p.z), node);
    this.pi = 0;
  }

  // ctx: { world, nav, fighters, canTarget, fire, patrolNode, zoneNeed(pos), zoneNode(), findItem(fighter) }
  update(dt, ctx) {
    const f = this.f, c = CFG.bot, cmd = this.cmd, p = f.pos;
    cmd.fwd = cmd.right = cmd.up = 0; cmd.boost = false; cmd.yaw = f.drone.yaw;
    this.aiming = false; this.stateT += dt;
    f.drone.aimPitch *= Math.exp(-4 * dt);

    if (this.target && (!this.target.alive || this.target.protT > 0)) { this.drop(); if (this.state !== 'flee') this.state = 'patrol'; }
    // 맞으면 쏜 쪽으로 돌아선다
    const atk = f.lastAttacker;
    if (atk && f.sinceHit < SCAN && atk.alive && atk !== this.target && this.state !== 'flee' && ctx.canTarget(this, atk)) this.engage(atk);
    // 체력이 낮으면 한 번은 달아난다
    if (!this.fled && this.state !== 'flee' && f.hp + f.shield < (f.maxHp + f.maxShield) * c.fleeBelow) this.startFlee(ctx);

    if ((this.scanT -= dt) <= 0) { this.scanT = SCAN; this.zoneNeed = ctx.zoneNeed(f.pos); this.scan(ctx); }
    // 자기장: 밖이면 무조건, 곧 줄어들 곳이면 한가할 때 안쪽으로 간다
    if (this.state !== 'zone' && (this.zoneNeed === 2 || (this.zoneNeed === 1 && this.state === 'patrol'))) {
      if (this.zoneNeed === 2) this.drop();
      this.state = 'zone'; this.stateT = 0; this.itemGoal = null;
      this.goTo(ctx.zoneNode(), ctx);
    }

    let moving = true;
    switch (this.state) {
      case 'patrol':
        if (this.pi >= this.path.length) this.goTo(ctx.patrolNode(this), ctx);
        this.follow(dt, ctx);
        break;
      case 'engage':
        if (!this.target) { this.state = 'patrol'; break; }
        if (this.lostT > 1.5) {                   // 놓쳤다 → 마지막으로 본 곳으로
          this.state = 'chase'; this.stateT = 0;
          this.goTo(ctx.nav.nearest(this.lastKnown.x, this.lastKnown.y, this.lastKnown.z), ctx);
          break;
        }
        this.fight(dt, ctx); moving = false;
        break;
      case 'chase':
        if (this.targetVisible) { this.state = 'engage'; break; }
        if (this.follow(dt, ctx) || this.stateT > 9) { this.drop(); this.state = 'patrol'; }
        break;
      case 'flee': {
        cmd.boost = true;
        const it = this.itemGoal;
        if (it) {                                 // 수리·실드 아이템을 먹으러 간다
          if (!it.active || this.stateT > 25) { this.itemGoal = null; this.drop(); this.state = 'patrol'; }
          else if (this.follow(dt, ctx)) this.steer(it.x, it.y, it.z, dt);
        } else if (this.follow(dt, ctx) || this.stateT > c.fleeTime) { this.drop(); this.state = 'patrol'; }
        break;
      }
      case 'zone':
        cmd.boost = this.zoneNeed === 2;
        if (this.follow(dt, ctx)) this.state = 'patrol';
        break;
    }

    f.drone.speedScale = c.speedScale;
    f.drone.update(dt, cmd, ctx.world);

    // 길을 따라가는데 끼어서 못 움직이면 다른 곳으로
    if (moving && f.drone.speed < 1.5) { if ((this.stuckT += dt) > 2) { this.stuckT = 0; this.itemGoal = null; this.goTo(ctx.patrolNode(this), ctx); } }
    else this.stuckT = 0;
  }

  scan(ctx) {
    const f = this.f, c = CFG.bot, w = ctx.world;
    let best = null, bd = c.sight;
    for (const o of ctx.fighters) {
      if (o === f || !o.alive || o.protT > 0) continue;
      const d = f.pos.distanceTo(o.pos);
      if (d >= bd || !ctx.canTarget(this, o) || !sees(w, f.pos, o.pos, d)) continue;
      best = o; bd = d;
    }
    const t = this.target;
    if (t) {
      const d = f.pos.distanceTo(t.pos);
      this.targetVisible = d < c.sight * 1.3 && sees(w, f.pos, t.pos, d);
      if (this.targetVisible) { this.lostT = 0; this.lastKnown.x = t.pos.x; this.lastKnown.y = t.pos.y; this.lastKnown.z = t.pos.z; }
      else this.lostT += SCAN;
      if (best && best !== t && bd < d * 0.6 && this.state !== 'flee') this.engage(best);      // 훨씬 가까운 적이 나타나면 바꾼다
    } else if (best && this.state !== 'flee') {
      if (best === this.pending) this.pendingT += SCAN; else { this.pending = best; this.pendingT = 0; }
      if (this.pendingT >= c.reaction) this.engage(best);                                        // 반응 시간 뒤에야 알아챈다
    } else { this.pending = null; this.pendingT = 0; }
  }

  startFlee(ctx) {
    this.fled = true; this.state = 'flee'; this.stateT = 0;
    const it = ctx.findItem(this.f);
    if (it) { this.itemGoal = it; this.goTo(it.node, ctx); return; }
    this.itemGoal = null;
    const from = this.target ? this.target.pos : this.f.pos, nav = ctx.nav;
    let best = nav.random(), bd = -1;
    for (let k = 0; k < 12; k++) {                // 위협에서 멀고 나에게서 너무 멀지 않은 곳
      const n = nav.random(), dx = nav.x[n] - this.f.pos.x, dz = nav.z[n] - this.f.pos.z, mine = Math.hypot(dx, dz);
      if (mine > 320) continue;
      const d = Math.hypot(nav.x[n] - from.x, nav.z[n] - from.z);
      if (d > bd) { bd = d; best = n; }
    }
    this.goTo(best, ctx);
  }

  // 목표 지점 쪽으로 기수를 돌리며 전진한다
  steer(tx, ty, tz, dt) {
    const f = this.f, cmd = this.cmd;
    const err = wrap(Math.atan2(-(tx - f.pos.x), -(tz - f.pos.z)) - f.drone.yaw), a = Math.abs(err);
    cmd.yaw = f.drone.yaw + clamp(err, -CFG.bot.turnRate * dt, CFG.bot.turnRate * dt);
    cmd.fwd = a < 0.5 ? 1 : a < 1.2 ? 0.4 : 0;
    cmd.up = clamp((ty - f.pos.y) / 4, -1, 1);
  }

  // 경로의 다음 지점으로 간다. 끝에 닿으면 true.
  follow(dt, ctx) {
    if (this.pi >= this.path.length) return true;
    const n = this.path[this.pi], tx = ctx.nav.x[n], tz = ctx.nav.z[n];
    if (Math.hypot(tx - this.f.pos.x, tz - this.f.pos.z) < 9) { this.pi++; return this.pi >= this.path.length; }
    this.steer(tx, this.alt, tz, dt);
    return false;
  }

  fight(dt, ctx) {
    const f = this.f, c = CFG.bot, cmd = this.cmd, t = this.target, p = f.pos;
    const dx = t.pos.x - p.x, dz = t.pos.z - p.z, dist = p.distanceTo(t.pos);
    const err = wrap(Math.atan2(-dx, -dz) - f.drone.yaw);
    f.drone.aimPitch = Math.atan2(t.pos.y - p.y, Math.hypot(dx, dz));
    cmd.yaw = f.drone.yaw + clamp(err, -c.turnRate * dt, c.turnRate * dt);
    cmd.fwd = dist > c.far ? 1 : dist < c.near ? -0.6 : 0.15;
    // 좌우로 흔들며 피한다 (벽 쪽이면 방향을 바꾼다)
    if ((this.strafeT -= dt) <= 0 || f.drone.bumped) {
      this.strafeT = 1.2 + Math.random() * 1.6;
      this.strafe = -this.strafe;
      const yaw = f.drone.yaw, rx = Math.cos(yaw) * this.strafe, rz = -Math.sin(yaw) * this.strafe;
      if (ctx.world.raycast(p.x, p.y, p.z, rx, 0, rz, 8) < 8) this.strafe = -this.strafe;
    }
    cmd.right = this.strafe * 0.7;
    cmd.up = clamp((clamp(t.pos.y + this.altOff, 5, CFG.drone.ceiling - 4) - p.y) / 4, -1, 1);

    // 사격: 조준선 예고 → 점사 → 쉬기
    const ready = this.targetVisible && dist < c.fireRange && Math.abs(err) < 0.3;
    if (this.phase === 'cool') {
      if ((this.phaseT -= dt) <= 0 && ready) { this.phase = 'aim'; this.phaseT = c.aimTime; }
    } else if (this.phase === 'aim') {
      this.aiming = true;
      if (!this.targetVisible) { this.phase = 'cool'; this.phaseT = 0.5; }
      else if ((this.phaseT -= dt) <= 0) { this.phase = 'burst'; this.shots = c.burst; this.phaseT = 0; }
    } else if ((this.phaseT -= dt) <= 0) {
      if (this.targetVisible) ctx.fire(this, t, dist);
      this.phaseT = 1 / c.burstRate;
      if (--this.shots <= 0) { this.phase = 'cool'; this.phaseT = c.cooldown[0] + Math.random() * (c.cooldown[1] - c.cooldown[0]); }
    }
  }
}
