// 아이템: 지하철 출구와 큰 공원에 떠 있다. 닿으면 먹고, 얼마 뒤 다른 종류로 다시 생긴다.
import * as THREE from 'three';
import { CFG } from './config.js';

export const ITEM = {
  repair: { color: 0x6ee7a0, css: '#6ee7a0', label: '수리 키트', weight: 35 },
  shield: { color: 0x6fb8ff, css: '#6fb8ff', label: '실드 충전', weight: 30 },
  twin: { color: 0xffa64a, css: '#ffa64a', label: '쌍발 레이저', weight: 20 },
  boost: { color: 0xffe066, css: '#ffe066', label: '부스트 강화', weight: 15 },
};
const KINDS = Object.keys(ITEM);
const TOTAL = KINDS.reduce((a, k) => a + ITEM[k].weight, 0);
function roll() { let r = Math.random() * TOTAL; for (const k of KINDS) if ((r -= ITEM[k].weight) < 0) return k; return KINDS[0]; }

function area(f) { let a = 0; for (let i = 0, j = f.length - 2; i < f.length; j = i, i += 2) a += f[j] * f[i + 1] - f[i] * f[j + 1]; return Math.abs(a / 2); }

// 종류별 모양 (색으로도 구분된다)
function icon(kind) {
  const mat = new THREE.MeshBasicMaterial({ color: ITEM[kind].color, fog: false });
  const g = new THREE.Group();
  const add = (geo, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
  if (kind === 'repair') { add(new THREE.BoxGeometry(2.2, 0.7, 0.7)); add(new THREE.BoxGeometry(0.7, 2.2, 0.7)); }
  else if (kind === 'shield') add(new THREE.IcosahedronGeometry(1.2, 0));
  else if (kind === 'twin') { for (const s of [-1, 1]) add(new THREE.CylinderGeometry(0.28, 0.28, 2.4, 8), s * 0.5).rotation.x = Math.PI / 2; }
  else add(new THREE.ConeGeometry(0.9, 2.2, 4));
  return g;
}

export class Items {
  constructor(scene, D, world, nav) {
    // 자리: 지하철 출구 + 넓은 공원. 건물 속이면 가까운 길 위로 옮기고, 너무 붙은 자리는 뺀다.
    const raw = D.exits.map(e => [e[0], -e[1]]);
    D.greens.map(g => ({ f: g[1], a: area(g[1]) })).filter(o => o.a > 1500).sort((a, b) => b.a - a.a).slice(0, CFG.items.parks).forEach(({ f }) => {
      let x = 0, y = 0; const n = f.length / 2;
      for (let i = 0; i < f.length; i += 2) { x += f[i]; y += f[i + 1]; }
      raw.push([x / n, -y / n]);
    });
    this.list = [];
    const pillarGeo = new THREE.CylinderGeometry(0.3, 0.3, 40, 8, 1, true); pillarGeo.translate(0, 20, 0);
    const ringGeo = new THREE.TorusGeometry(1.9, 0.09, 6, 28); ringGeo.rotateX(Math.PI / 2);
    for (let [x, z] of raw) {
      if (Math.hypot(x, z) > D.radius - 30) continue;
      const node = nav.nearest(x, 6, z, false);
      if (!world.isOpen(x, z, 4)) { x = nav.x[node]; z = nav.z[node]; }
      if (this.list.some(o => Math.hypot(o.x - x, o.z - z) < 45)) continue;
      const group = new THREE.Group(); group.position.set(x, CFG.items.alt, z);
      const icons = {};
      for (const k of KINDS) { icons[k] = icon(k); group.add(icons[k]); }
      const glow = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide });
      const pillar = new THREE.Mesh(pillarGeo, glow), ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
      group.add(pillar, ring);
      scene.add(group);
      this.list.push({ x, y: CFG.items.alt, z, node, kind: 'repair', active: false, wait: 0, group, icons, glow, ring, spin: Math.random() * 6 });
    }
  }

  set(it, kind) {
    it.kind = kind; it.active = true; it.group.visible = true;
    for (const k of KINDS) it.icons[k].visible = k === kind;
    it.glow.color.set(ITEM[kind].color); it.ring.material.color.set(ITEM[kind].color);
  }

  reset() { for (const it of this.list) this.set(it, roll()); }

  // 효과 적용. 쓸모가 없으면(이미 가득) false 를 돌려주고 아이템은 남는다.
  apply(f, kind) {
    if (kind === 'repair') { if (f.hp >= f.maxHp) return false; f.hp = Math.min(f.maxHp, f.hp + CFG.items.repair); }
    else if (kind === 'shield') { if (f.shield >= f.maxShield) return false; f.shield = f.maxShield; }
    else if (kind === 'twin') f.twinT = CFG.items.twinTime;
    else { f.boostT = CFG.items.boostTime; f.drone.boost = CFG.drone.boostMax; }
    return true;
  }

  update(dt, fighters, onPickup) {
    const r2 = CFG.items.pickup * CFG.items.pickup;
    for (const it of this.list) {
      if (!it.active) { if ((it.wait -= dt) <= 0) this.set(it, roll()); continue; }
      it.spin += dt * 1.6;
      it.icons[it.kind].rotation.y = it.spin;
      it.icons[it.kind].position.y = Math.sin(it.spin * 1.3) * 0.35;
      for (const f of fighters) {
        if (!f.alive) continue;
        const dx = f.pos.x - it.x, dy = f.pos.y - it.y, dz = f.pos.z - it.z;
        if (dx * dx + dy * dy + dz * dz > r2 || !this.apply(f, it.kind)) continue;
        it.active = false; it.group.visible = false; it.wait = CFG.items.respawn;
        onPickup(f, it);
        break;
      }
    }
  }

  // pos 에서 가장 가까운, kinds 에 드는 아이템 (ok(item) 이 참인 것만)
  nearest(pos, kinds, maxDist, ok) {
    let best = null, bd = maxDist;
    for (const it of this.list) {
      if (!it.active || !kinds.includes(it.kind) || (ok && !ok(it))) continue;
      const d = Math.hypot(it.x - pos.x, it.z - pos.z);
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  }
}
