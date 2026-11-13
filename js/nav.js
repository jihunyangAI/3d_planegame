// 길찾기: 넓힌 도로의 중심선을 그래프로 만들어 적 드론이 건물에 박지 않고 다니게 한다.
// 좌표는 three.js 기준 (x, z). 고도는 드론이 따로 정한다.
const FLYABLE = new Set([0, 1, 2, 3, 5]);     // 도로 그룹: 간선~이면도로, 보행자전용
const MAX_SEG = 45;                           // 긴 구간은 이 길이로 나눈다
const CELL = 60;

export class Nav {
  constructor(D, world) {
    const xs = [], zs = [], adj = [], index = new Map();
    const node = (x, z) => {
      const k = Math.round(x * 10) + ',' + Math.round(z * 10);
      let i = index.get(k);
      if (i === undefined) { i = xs.length; index.set(k, i); xs.push(x); zs.push(z); adj.push([]); }
      return i;
    };
    const lim = D.radius - 20;
    // 구간이 드론 폭만큼 비어 있는가 (중심선과 좌우 2.5m 를 확인)
    const clear = (ax, az, bx, bz) => {
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
      if (len < 0.01) return false;
      const ux = dx / len, uz = dz / len;
      for (const o of [0, 2.5, -2.5])
        if (world.raycast(ax - uz * o, 6, az + ux * o, ux, 0, uz, len) < len - 0.01) return false;
      return true;
    };
    for (const [grp, , , f] of D.roads) {
      if (!FLYABLE.has(grp)) continue;
      for (let i = 0; i < f.length - 2; i += 2) {
        const ax = f[i], az = -f[i + 1], bx = f[i + 2], bz = -f[i + 3];
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / MAX_SEG));
        for (let k = 0; k < n; k++) {
          const x0 = ax + (bx - ax) * k / n, z0 = az + (bz - az) * k / n, x1 = ax + (bx - ax) * (k + 1) / n, z1 = az + (bz - az) * (k + 1) / n;
          if (Math.hypot(x0, z0) > lim || Math.hypot(x1, z1) > lim || !clear(x0, z0, x1, z1)) continue;
          const a = node(x0, z0), b = node(x1, z1);
          if (a !== b && !adj[a].includes(b)) { adj[a].push(b); adj[b].push(a); }
        }
      }
    }
    // 가장 큰 연결 덩어리만 쓴다
    const comp = new Int32Array(xs.length).fill(-1);
    let bestC = -1, bestN = 0;
    for (let s = 0, c = 0; s < xs.length; s++) {
      if (comp[s] >= 0) continue;
      let n = 0; const st = [s]; comp[s] = c;
      while (st.length) { const u = st.pop(); n++; for (const v of adj[u]) if (comp[v] < 0) { comp[v] = c; st.push(v); } }
      if (n > bestN) { bestN = n; bestC = c; }
      c++;
    }
    this.x = Float32Array.from(xs); this.z = Float32Array.from(zs); this.adj = adj;
    this.ok = [];                               // 쓸 수 있는 노드 번호
    this.cells = new Map();
    for (let i = 0; i < xs.length; i++) {
      if (comp[i] !== bestC) continue;
      this.ok.push(i);
      const k = Math.floor(xs[i] / CELL) + ',' + Math.floor(zs[i] / CELL);
      let c = this.cells.get(k);
      if (!c) this.cells.set(k, c = []);
      c.push(i);
    }
    this.world = world;
    this._g = new Float32Array(xs.length); this._from = new Int32Array(xs.length); this._mark = new Int32Array(xs.length); this._run = 0;
  }

  random() { return this.ok[Math.floor(Math.random() * this.ok.length)]; }

  // (x,y,z) 에서 가장 가까운 노드. 되도록 건물에 가리지 않고 곧장 갈 수 있는 노드를 고른다.
  nearest(x, y, z, needVisible = true) {
    const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
    let best = -1, bd = Infinity, any = -1, ad = Infinity;
    for (let ring = 0; ring <= 3 && best < 0; ring++) {
      for (let i = ci - ring; i <= ci + ring; i++) for (let j = cj - ring; j <= cj + ring; j++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== ring) continue;
        const c = this.cells.get(i + ',' + j);
        if (!c) continue;
        for (const n of c) {
          const dx = this.x[n] - x, dz = this.z[n] - z, d = Math.hypot(dx, dz);
          if (d < ad) { ad = d; any = n; }
          if (d >= bd) continue;
          if (needVisible && d > 0.5 && this.world.raycast(x, y, z, dx / d, 0, dz / d, d) < d - 0.01) continue;
          bd = d; best = n;
        }
      }
    }
    if (best >= 0) return best;
    if (any >= 0) return any;
    let m = this.ok[0], md = Infinity;           // 주변에 없으면 전체에서
    for (const n of this.ok) { const d = Math.hypot(this.x[n] - x, this.z[n] - z); if (d < md) { md = d; m = n; } }
    return m;
  }

  // A* 최단 경로 (노드 번호 배열, 시작과 끝 포함)
  path(a, b) {
    if (a === b) return [a];
    const run = ++this._run, g = this._g, from = this._from, mark = this._mark, X = this.x, Z = this.z;
    const heap = [], hf = [];                    // 이진 힙 (노드, f값)
    const push = (n, f) => {
      let i = heap.length; heap.push(n); hf.push(f);
      while (i > 0) { const p = (i - 1) >> 1; if (hf[p] <= f) break; heap[i] = heap[p]; hf[i] = hf[p]; i = p; }
      heap[i] = n; hf[i] = f;
    };
    const pop = () => {
      const top = heap[0], n = heap.pop(), f = hf.pop();
      if (heap.length) {
        let i = 0;
        for (;;) {
          let c = 2 * i + 1;
          if (c >= heap.length) break;
          if (c + 1 < heap.length && hf[c + 1] < hf[c]) c++;
          if (hf[c] >= f) break;
          heap[i] = heap[c]; hf[i] = hf[c]; i = c;
        }
        heap[i] = n; hf[i] = f;
      }
      return top;
    };
    g[a] = 0; from[a] = -1; mark[a] = run;
    push(a, Math.hypot(X[b] - X[a], Z[b] - Z[a]));
    while (heap.length) {
      const u = pop();
      if (u === b) {
        const out = [];
        for (let n = b; n >= 0; n = from[n]) out.push(n);
        return out.reverse();
      }
      for (const v of this.adj[u]) {
        const ng = g[u] + Math.hypot(X[v] - X[u], Z[v] - Z[u]);
        if (mark[v] === run && g[v] <= ng) continue;
        g[v] = ng; from[v] = u; mark[v] = run;
        push(v, ng + Math.hypot(X[b] - X[v], Z[b] - Z[v]));
      }
    }
    return [a];
  }
}
