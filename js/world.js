// 충돌 세계: 건물을 "윤곽 + 높이" 기둥으로 보고 격자 색인으로 빠르게 찾는다.
// 좌표는 three.js 기준 (x=동, y=높이, z=-북).
import { PARAPET } from './city.js';

const CELL = 40;

export class World {
  constructor(D) {
    this.R = D.radius;
    this.buildings = [];
    this.cells = new Map();
    this.propCells = new Map();
    this.hitKind = null; this.hitColor = 0;
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
      if (this._collideProps(pos, r, vel)) hit = moved = true;
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
  // props 가 참이면 나무·기둥·옥상 구조물에도 막힌다 (레이저용). 무엇에 닿았는지는 hitKind 에 남는다:
  // 'wall' 건물, 'ground' 땅, 'prop' 기둥·상자, 'leaf' 나뭇잎(이때 hitColor 는 잎 색), null 안 닿음.
  raycast(ox, oy, oz, dx, dy, dz, maxT, props = false) {
    let best = maxT;
    this.hitKind = null; this.hitColor = 0;
    if (dy < 0) { const t = -oy / dy; if (t < best) { best = t; this.hitKind = 'ground'; } }
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
          if (y >= 0 && y <= b.top) { best = t; this.hitKind = 'wall'; }
        }
      }
      // 지붕
      if (dy < 0 && oy > b.top) {
        const t = (b.top - oy) / dy;
        if (t < best && inside(b, ox + dx * t, oz + dz * t)) { best = t; this.hitKind = 'wall'; }
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
      if (props) { const pc = this.propCells.get(key(ci, cj)); if (pc) for (const p of pc) best = this._rayProp(p, ox, oy, oz, dx, dy, dz, best); }
      const tNext = Math.min(tx, tz);
      if (tNext >= best) break;
      if (tx < tz) { ci += si; tx += tdx; } else { cj += sj; tz += tdz; }
    }
    return best;
  }

  // ----- 소품: 건물이 아닌 장애물 -----
  // cyl  세로 기둥 { x, z, r, y0, y1 }           나무 줄기, 가로등·표지판 기둥, 물탱크
  // box  돌려 놓은 상자 { x, y, z, hx, hy, hz, rot } 옥탑, 신호등 가로대, 이정표 판
  // leaf 나뭇잎 덩어리 { x, z, r, y0, y1, color }  드론은 뚫고 지나가되 느려지고, 레이저는 막힌다
  addProps(list) {
    for (const p of list) {
      let rad = p.r;
      if (p.k === 'box') { p.c = Math.cos(p.rot); p.s = Math.sin(p.rot); rad = Math.hypot(p.hx, p.hz); }
      if (p.k === 'leaf') { p.yc = (p.y0 + p.y1) / 2; p.hy = (p.y1 - p.y0) / 2; }
      p.seen = 0;
      for (let i = Math.floor((p.x - rad) / CELL), i1 = Math.floor((p.x + rad) / CELL); i <= i1; i++)
        for (let j = Math.floor((p.z - rad) / CELL), j1 = Math.floor((p.z + rad) / CELL); j <= j1; j++) {
          const k = key(i, j);
          let c = this.propCells.get(k);
          if (!c) this.propCells.set(k, c = []);
          c.push(p);
        }
    }
  }

  // 구를 기둥·상자 밖으로 밀어낸다. 부딪혔으면 true.
  _collideProps(pos, r, vel) {
    let hit = false;
    const stamp = ++this._stamp;
    for (let i = Math.floor((pos.x - r) / CELL), i1 = Math.floor((pos.x + r) / CELL); i <= i1; i++)
      for (let j = Math.floor((pos.z - r) / CELL), j1 = Math.floor((pos.z + r) / CELL); j <= j1; j++) {
        const c = this.propCells.get(key(i, j));
        if (!c) continue;
        for (const p of c) {
          if (p.seen === stamp || p.k === 'leaf') continue;
          p.seen = stamp;
          let nx = 0, ny = 0, nz = 0, push = 0;
          if (p.k === 'cyl') {
            if (pos.y - r >= p.y1 || pos.y + r <= p.y0) continue;
            const dx = pos.x - p.x, dz = pos.z - p.z, d = Math.hypot(dx, dz);
            const qy = Math.max(p.y0, Math.min(p.y1, pos.y)), k = d > p.r ? p.r / d : 1;      // 기둥에서 가장 가까운 점
            const ex = dx - dx * k, ey = pos.y - qy, ez = dz - dz * k, e = Math.hypot(ex, ey, ez);
            if (e >= r) continue;
            if (e > 1e-5) { nx = ex / e; ny = ey / e; nz = ez / e; push = r - e; }
            else if (d > 1e-5) { nx = dx / d; nz = dz / d; push = r + p.r - d; }               // 기둥 속: 옆으로
            else { nx = 1; push = r + p.r; }
          } else {
            const dx = pos.x - p.x, dy = pos.y - p.y, dz = pos.z - p.z;
            const lx = dx * p.c - dz * p.s, lz = dx * p.s + dz * p.c;                           // 상자 기준 좌표
            const qx = Math.max(-p.hx, Math.min(p.hx, lx)), qy = Math.max(-p.hy, Math.min(p.hy, dy)), qz = Math.max(-p.hz, Math.min(p.hz, lz));
            let ex = lx - qx, ey = dy - qy, ez = lz - qz;
            const e = Math.hypot(ex, ey, ez);
            if (e >= r) continue;
            if (e > 1e-5) { ex /= e; ey /= e; ez /= e; push = r - e; }
            else { ex = 0; ey = 1; ez = 0; push = r + p.hy - dy; }                              // 상자 속: 위로
            nx = ex * p.c + ez * p.s; ny = ey; nz = -ex * p.s + ez * p.c;
          }
          pos.x += nx * push; pos.y += ny * push; pos.z += nz * push;
          const vn = vel.x * nx + vel.y * ny + vel.z * nz;
          if (vn < 0) { vel.x -= vn * nx; vel.y -= vn * ny; vel.z -= vn * nz; }
          hit = true;
        }
      }
    return hit;
  }

  // 광선이 소품 p 에 best 보다 먼저 닿으면 그 거리를 돌려준다
  _rayProp(p, ox, oy, oz, dx, dy, dz, best) {
    const ex = ox - p.x, ez = oz - p.z;
    if (p.k === 'box') {
      const ey = oy - p.y;
      const lo = [ex * p.c - ez * p.s, ey, ex * p.s + ez * p.c], ld = [dx * p.c - dz * p.s, dy, dx * p.s + dz * p.c], h = [p.hx, p.hy, p.hz];
      let t0 = 0, t1 = best;
      for (let a = 0; a < 3; a++) {
        if (Math.abs(ld[a]) < 1e-9) { if (Math.abs(lo[a]) > h[a]) return best; continue; }
        let u = (-h[a] - lo[a]) / ld[a], v = (h[a] - lo[a]) / ld[a];
        if (u > v) { const w = u; u = v; v = w; }
        if (u > t0) t0 = u;
        if (v < t1) t1 = v;
        if (t0 > t1) return best;
      }
      if (t0 > 0 && t0 < best) { this.hitKind = 'prop'; return t0; }
      return best;
    }
    if (p.k === 'leaf') {                             // 타원체: 세로를 눌러 구로 보고 푼다
      const k = p.r / p.hy, ey = (oy - p.yc) * k, fy = dy * k;
      const a = dx * dx + fy * fy + dz * dz, b = ex * dx + ey * fy + ez * dz, c = ex * ex + ey * ey + ez * ez - p.r * p.r;
      const disc = b * b - a * c;
      if (disc < 0 || a < 1e-9) return best;
      const t = (-b - Math.sqrt(disc)) / a;
      if (t > 0 && t < best) { this.hitKind = 'leaf'; this.hitColor = p.color; return t; }
      return best;
    }
    const a = dx * dx + dz * dz, b = ex * dx + ez * dz, c = ex * ex + ez * ez - p.r * p.r;
    if (a > 1e-9) {
      const disc = b * b - a * c;
      if (disc >= 0) {
        const t = (-b - Math.sqrt(disc)) / a, y = oy + dy * t;
        if (t > 0 && t < best && y >= p.y0 && y <= p.y1) { this.hitKind = 'prop'; return t; }
      }
    }
    if (dy < 0 && oy > p.y1) {                        // 윗면
      const t = (p.y1 - oy) / dy, hx = ex + dx * t, hz = ez + dz * t;
      if (t < best && hx * hx + hz * hz <= p.r * p.r) { this.hitKind = 'prop'; return t; }
    }
    return best;
  }

  // pos 가 나뭇잎 덩어리 속이면 그 덩어리, 아니면 null
  inFoliage(pos) {
    const c = this.propCells.get(key(Math.floor(pos.x / CELL), Math.floor(pos.z / CELL)));
    if (c) for (const p of c) {
      if (p.k !== 'leaf') continue;
      const dx = pos.x - p.x, dz = pos.z - p.z, dy = (pos.y - p.yc) / p.hy;
      if ((dx * dx + dz * dz) / (p.r * p.r) + dy * dy < 1) return p;
    }
    return null;
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
