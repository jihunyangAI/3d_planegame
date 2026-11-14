// 지도 좌표의 한 점이 차도(간선~이면도로, 보행자 거리) 위인지 빠르게 알아보는 색인.
// 인도를 깔 자리와 보행자가 걸을 자리를 고를 때 쓴다.
const SG = 40;

export function makeAsphaltTest(D) {
  const grid = new Map();
  for (const [grp, w, , f] of D.roads) {
    if (grp > 3 && grp !== 5) continue;
    for (let i = 0; i < f.length - 2; i += 2) {
      const seg = [f[i], f[i + 1], f[i + 2], f[i + 3], w / 2 + 0.2];
      for (let a = Math.floor((Math.min(seg[0], seg[2]) - seg[4]) / SG), a1 = Math.floor((Math.max(seg[0], seg[2]) + seg[4]) / SG); a <= a1; a++)
        for (let b = Math.floor((Math.min(seg[1], seg[3]) - seg[4]) / SG), b1 = Math.floor((Math.max(seg[1], seg[3]) + seg[4]) / SG); b <= b1; b++) {
          const k = a + ',' + b;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(seg);
        }
    }
  }
  return (x, y) => {
    const cell = grid.get(Math.floor(x / SG) + ',' + Math.floor(y / SG));
    if (!cell) return false;
    for (const [x0, y0, x1, y1, hw] of cell) {
      const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / l2)) : 0;
      if (Math.hypot(x - x0 - dx * t, y - y0 - dy * t) < hw) return true;
    }
    return false;
  };
}
