// 충돌 세계: 건물을 "윤곽 + 높이" 기둥으로 보고 격자 색인으로 빠르게 찾는다.
// 좌표는 three.js 기준 (x=동, y=높이, z=-북).
import { PARAPET } from './city.js';

const CELL = 40;

export class World {
  constructor(D) {
    this.R = D.radius;
    this.buildings = [];
    this.cells = new Map();
    this._stamp = 0;
    for (const [H, , name, f, holes] of D.buildings) {
      const ring = flip(f);
      const b = { top: H + PARAPET(H, Math.abs(area(ring))), name, ring, holes: holes.map(flip), rings: null, seen: 0,
        x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
      b.rings = [b.ring, ...b.holes];
      for (let i = 0; i < ring.length; i += 2) {
        b.x0 = Math.min(b.x0, ring[i]); b.x1 = Math.max(b.x1, ring[i]);
        b.z0 = Math.min(b.z0, ring[i + 1]); b.z1 = Math.max(b.z1, ring[i + 1]);
      }
      this.buildings.push(b);
      for (let i = Math.floor(b.x0 / CELL); i <= Math.floor(b.x1 / CELL); i++)
        for (let j = Math.floor(b.z0 / CELL); j <= Math.floor(b.z1 / CELL); j++) {
          const k = key(i, j);
          let c = this.cells.get(k);
          if (!c) this.cells.set(k, c = []);
          c.push(b);
        }
    }
  }

  // (x,z) 에 건물이 있으면 그 건물, 없으면 null
  buildingAt(x, z) {
    const c = this.cells.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (c) for (const b of c) if (inside(b, x, z)) return b;
    return null;
  }

  // 바로 아래 표면 높이 (지붕 또는 지면 0)
  surfaceBelow(x, y, z) {
    const b = this.buildingAt(x, z);
    return b && b.top <= y + 0.5 ? b.top : 0;
  }

  // 반지름 r 인 구가 (x,z) 주변 건물과 margin 이상 떨어져 있는가 (지면 높이 기준)
  isOpen(x, z, margin) {
    if (Math.hypot(x, z) > this.R - margin) return false;
    let open = true;
    this._near(x, z, margin, b => {
      if (inside(b, x, z) || edgeDist(b, x, z).d < margin) open = false;
    });
    return open;
  }

  // 구(pos, r)를 건물·지면·경계 밖으로 밀어내고 vel 에서 벽 쪽 성분을 없앤다. 부딪혔으면 true.
  collideSphere(pos, r, vel, minY, maxY) {
    let hit = false;
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      this._near(pos.x, pos.z, r, b => {
        if (pos.y - r >= b.top) return;
        const e = edgeDist(b, pos.x, pos.z);
        let nx = 0, ny = 0, nz = 0, push = 0;
        if (inside(b, pos.x, pos.z)) {
          const up = b.top + r - pos.y, side = e.d + r;
          if (up <= side) { ny = 1; push = up; }
          else { const k = e.d > 1e-6 ? 1 / e.d : 0; nx = (e.x - pos.x) * k; nz = (e.z - pos.z) * k; push = side; }
        } else {
          const dy = Math.max(0, pos.y - b.top);          // 지붕 모서리보다 위에 있으면 모서리까지의 3D 거리
          const d3 = Math.hypot(e.d, dy);
          if (d3 >= r) return;
          if (d3 < 1e-6) { ny = 1; push = r; }
          else { nx = (pos.x - e.x) / d3; nz = (pos.z - e.z) / d3; ny = dy / d3; push = r - d3; }
        }
        if (push <= 0) return;
        pos.x += nx * push; pos.y += ny * push; pos.z += nz * push;
        const vn = vel.x * nx + vel.y * ny + vel.z * nz;
        if (vn < 0) { vel.x -= vn * nx; vel.y -= vn * ny; vel.z -= vn * nz; }
        hit = moved = true;
      });
      if (!moved) break;
    }
    if (pos.y < minY) { pos.y = minY; if (vel.y < 0) vel.y = 0; }
    if (pos.y > maxY) { pos.y = maxY; if (vel.y > 0) vel.y = 0; }
    const d = Math.hypot(pos.x, pos.z), lim = this.R - r - 2;
    if (d > lim) {
      const nx = pos.x / d, nz = pos.z / d;
      pos.x = nx * lim; pos.z = nz * lim;
      const vn = vel.x * nx + vel.z * nz;
      if (vn > 0) { vel.x -= vn * nx; vel.z -= vn * nz; }
    }
    return hit;
  }

  // 광선 (o + d*t, d 는 단위벡터) 이 건물이나 지면에 처음 닿는 거리. 없으면 maxT.
  raycast(ox, oy, oz, dx, dy, dz, maxT) {
    let best = maxT;
    if (dy < 0) { const t = -oy / dy; if (t < best) best = t; }
    const stamp = ++this._stamp;
    const test = b => {
      if (b.seen === stamp) return;
      b.seen = stamp;
      // 벽
      for (const ring of b.rings) {
        const n = ring.length;
        for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
          const ax = ring[j], az = ring[j + 1], ex = ring[i] - ax, ez = ring[i + 1] - az;
          const den = dx * ez - dz * ex;
          if (Math.abs(den) < 1e-9) continue;
          const t = ((ax - ox) * ez - (az - oz) * ex) / den;
          if (t <= 0 || t >= best) continue;
          const s = ((ax - ox) * dz - (az - oz) * dx) / den;
          if (s < 0 || s > 1) continue;
          const y = oy + dy * t;
          if (y >= 0 && y <= b.top) best = t;
        }
      }
      // 지붕
      if (dy < 0 && oy > b.top) {
        const t = (b.top - oy) / dy;
        if (t < best && inside(b, ox + dx * t, oz + dz * t)) best = t;
      }
    };
    // 격자를 광선 방향으로 따라간다 (2D DDA)
    let ci = Math.floor(ox / CELL), cj = Math.floor(oz / CELL);
    const si = dx > 0 ? 1 : -1, sj = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(CELL / dx) : Infinity, tdz = dz !== 0 ? Math.abs(CELL / dz) : Infinity;
    let tx = dx !== 0 ? ((dx > 0 ? (ci + 1) * CELL : ci * CELL) - ox) / dx : Infinity;
    let tz = dz !== 0 ? ((dz > 0 ? (cj + 1) * CELL : cj * CELL) - oz) / dz : Infinity;
    for (let guard = 0; guard < 400; guard++) {
      const c = this.cells.get(key(ci, cj));
      if (c) for (const b of c) test(b);
      const tNext = Math.min(tx, tz);
      if (tNext >= best) break;
      if (tx < tz) { ci += si; tx += tdx; } else { cj += sj; tz += tdz; }
    }
    return best;
  }

  _near(x, z, r, fn) {
    const stamp = ++this._stamp;
    for (let i = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL); i <= i1; i++)
      for (let j = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL); j <= j1; j++) {
        const c = this.cells.get(key(i, j));
        if (!c) continue;
        for (const b of c) {
          if (b.seen === stamp) continue;
          b.seen = stamp;
          if (x + r < b.x0 || x - r > b.x1 || z + r < b.z0 || z - r > b.z1) continue;
          fn(b);
        }
      }
  }
}

const key = (i, j) => (i + 512) * 4096 + (j + 512);
function flip(f) { const a = new Float32Array(f.length); for (let i = 0; i < f.length; i += 2) { a[i] = f[i]; a[i + 1] = -f[i + 1]; } return a; }
function area(f) { let a = 0; for (let i = 0, j = f.length - 2; i < f.length; j = i, i += 2) a += f[j] * f[i + 1] - f[i] * f[j + 1]; return a / 2; }

function inRing(f, x, z) {
  let c = false;
  for (let i = 0, j = f.length - 2; i < f.length; j = i, i += 2) {
    const xi = f[i], zi = f[i + 1], xj = f[j], zj = f[j + 1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
}
function inside(b, x, z) {
  if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1 || !inRing(b.ring, x, z)) return false;
  for (const h of b.holes) if (inRing(h, x, z)) return false;
  return true;
}
// 건물 윤곽(구멍 포함)에서 가장 가까운 점과 거리
const _e = { d: 0, x: 0, z: 0 };
function edgeDist(b, x, z) {
  let best = Infinity, bx = x, bz = z;
  for (const f of b.rings) {
    for (let i = 0, j = f.length - 2; i < f.length; j = i, i += 2) {
      const ax = f[j], az = f[j + 1], ex = f[i] - ax, ez = f[i + 1] - az;
      const l2 = ex * ex + ez * ez;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2)) : 0;
      const px = ax + ex * t, pz = az + ez * t, d = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (d < best) { best = d; bx = px; bz = pz; }
    }
  }
  _e.d = Math.sqrt(best); _e.x = bx; _e.z = bz;
  return _e;
}
