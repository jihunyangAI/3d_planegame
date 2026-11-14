// 도로 위 차량 20종. assets/cars 의 참고 이미지를 보고 상자·바퀴로 조립한 저폴리 모델이다.
// 차는 +X 가 앞, 바닥이 y=0. 종류마다 InstancedMesh 하나로 그린다.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { signalCrossings, SIGNAL } from './roadgrid.js';

function rng(seed) { let s = (seed * 2654435761) >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const GLASS = 0x1c242d, TIRE = 0x17181a, HUB = 0x9a9da1, DARK = 0x2a2c30, CHROME = 0xb9bdc2, HEAD = 0xfff3c4, TAIL = 0xc81e1e, AMBER = 0xff9d1c;

// 모델 조립 도구. paint=1 인 부분은 차마다 다른 도색(aTint)이 곱해진다.
class Kit {
  constructor() { this.parts = []; this._c = new THREE.Color(); }
  _push(g, color, paint) {
    const n = g.attributes.position.count, col = new Float32Array(n * 3), pa = new Float32Array(n).fill(paint);
    this._c.set(color);
    for (let i = 0; i < n; i++) { col[3 * i] = this._c.r; col[3 * i + 1] = this._c.g; col[3 * i + 2] = this._c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aPaint', new THREE.BufferAttribute(pa, 1));
    g.deleteAttribute('uv');
    this.parts.push(g);
    return this;
  }
  // 길이 l(X) · 높이 h · 폭 w(Z). x,z 는 중심, y 는 바닥. taper [앞, 뒤, 옆]: 윗면을 그만큼 안으로 좁힌다.
  box(l, h, w, x, y, z, color, paint = 0, taper = null) {
    const g = new THREE.BoxGeometry(l, h, w);
    if (taper) {
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        if (p.getY(i) < 0) continue;
        p.setX(i, p.getX(i) > 0 ? p.getX(i) - taper[0] : p.getX(i) + taper[1]);
        p.setZ(i, p.getZ(i) * (1 - (taper[2] || 0) * 2 / w));
      }
      g.computeVertexNormals();
    }
    g.translate(x, y + h / 2, z);
    return this._push(g, color, paint);
  }
  // 좌우 대칭으로 두 개
  pair(l, h, w, x, y, z, color, paint = 0) { return this.box(l, h, w, x, y, z, color, paint).box(l, h, w, x, y, -z, color, paint); }
  // 차축: x 위치, 바퀴 중심의 z(반폭), 반지름, 폭. dual: 뒷바퀴 복륜
  axle(x, z, r, w = 0.26, dual = false) {
    for (const s of [-1, 1]) {
      const t = new THREE.CylinderGeometry(r, r, dual ? w * 2 : w, 8); t.rotateX(Math.PI / 2); t.translate(x, r, s * (dual ? z - w * 0.5 : z));
      this._push(t, TIRE, 0);
      const h = new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.04, 6); h.rotateX(Math.PI / 2); h.translate(x, r, s * (z + w / 2 + 0.005));
      this._push(h, HUB, 0);
    }
    return this;
  }
  // 앞뒤 등화: 전조등(앞), 후미등(뒤)
  lamps(front, rear, y, z, h = 0.14, w = 0.3) {
    return this.pair(0.06, h, w, front, y, z, HEAD).pair(0.06, h, w, rear, y, z, TAIL);
  }
  // 경광등
  bar(x, y, w, left = 0xd8261c, right = 0x2456d8) {
    return this.box(0.3, 0.14, w * 0.45, x, y, w * 0.25, left).box(0.3, 0.14, w * 0.45, x, y, -w * 0.25, right).box(0.34, 0.06, w + 0.1, x, y - 0.05, 0, DARK);
  }
  build() { const g = mergeGeometries(this.parts); g.computeBoundingSphere(); return g; }
}

// 승용차 공통 뼈대: 차체 + 유리 캐빈 + 지붕
function passenger(k, o) {
  const { L, W, H, ride = 0.28, bodyH = 0.55, hood, trunk, fIn = 0.5, rIn = 0.45, wheel = 0.33, paint = 1, color = 0xffffff } = o;
  const cabL = L - hood - trunk, cabX = (trunk - hood) / 2, cabH = H - bodyH - ride - 0.06, top = ride + bodyH;
  k.box(L, bodyH, W, 0, ride, 0, color, paint, [0.08, 0.06, 0.04]);
  k.box(L - 0.1, 0.16, W + 0.02, 0, ride - 0.02, 0, DARK);                                   // 하단 몰딩·범퍼
  k.box(cabL, cabH, W * 0.94, cabX, top, 0, GLASS, 0, [fIn, rIn, 0.13]);                     // 유리
  k.box(cabL - fIn - rIn + 0.04, 0.06, W * 0.94 - 0.24, cabX + (rIn - fIn) / 2, top + cabH - 0.01, 0, color, paint);   // 지붕
  for (const px of [cabX + (cabL - fIn - rIn) * 0.02]) k.pair(0.09, cabH * 0.9, 0.04, px, top, W * 0.47 - 0.07, color, paint);   // B 필러
  k.lamps(L / 2 - 0.02, -L / 2 + 0.02, ride + bodyH * 0.55, W / 2 - 0.3);
  k.box(0.05, 0.16, W * 0.5, L / 2, ride + 0.2, 0, DARK);                                    // 그릴
  k.pair(0.16, 0.1, 0.06, cabX + cabL / 2 - fIn - 0.05, top + 0.05, W / 2 + 0.03, DARK);     // 사이드미러
  const wb = L * 0.3;
  k.axle(wb, W / 2 - 0.13, wheel).axle(-wb, W / 2 - 0.13, wheel);
  return k;
}
// 버스 공통: 긴 차체 + 창문 띠
function busBody(k, o) {
  const { L, W, H, color, lower = color, winY = 1.35, winH = 1.0, ride = 0.35 } = o;
  k.box(L, H - ride, W, 0, ride, 0, color, 0, [0.12, 0.05, 0.03]);
  if (lower !== color) k.box(L + 0.02, 0.75, W + 0.02, 0, ride, 0, lower);
  k.box(L - 0.5, winH, W + 0.03, -0.1, winY, 0, GLASS);                                       // 옆 창
  k.box(0.08, winH + 0.35, W - 0.3, L / 2 - 0.03, winY - 0.25, 0, GLASS);                     // 앞 유리
  k.box(0.06, winH * 0.7, W - 0.5, -L / 2 + 0.01, winY + 0.1, 0, GLASS);                      // 뒤 유리
  for (let x = -L / 2 + 1.2; x < L / 2 - 0.8; x += 1.35) k.pair(0.09, winH, 0.03, x, winY, W / 2 + 0.012, color);   // 창 기둥
  k.lamps(L / 2, -L / 2, ride + 0.3, W / 2 - 0.3, 0.16, 0.34);
  k.axle(L / 2 - 2.0, W / 2 - 0.16, 0.48, 0.3).axle(-L / 2 + 2.4, W / 2 - 0.16, 0.48, 0.3, true);
  return k;
}
// 트럭 운전석 (보닛 없는 캡오버 / 보닛 있는 형)
function cab(k, x, o) {
  const { W, H, len = 1.9, color, ride = 0.5, hood = 0 } = o;
  if (hood) {
    k.box(hood, 1.0, W * 0.8, x + len / 2 + hood / 2, ride, 0, color, 0, [0.15, 0, 0.06]);
    k.box(0.06, 0.7, W * 0.6, x + len / 2 + hood, ride + 0.15, 0, CHROME);                    // 그릴
    k.pair(0.06, 0.16, 0.24, x + len / 2 + hood + 0.01, ride + 0.3, W * 0.4 - 0.2, HEAD);
  } else k.pair(0.06, 0.16, 0.3, x + len / 2 + 0.01, ride + 0.25, W / 2 - 0.3, HEAD);
  k.box(len, H - ride, W, x, ride, 0, color, 0, [hood ? 0.25 : 0.12, 0, 0.04]);
  k.box(0.08, (H - ride) * 0.42, W - 0.24, x + len / 2 - (hood ? 0.18 : 0.06), ride + (H - ride) * 0.5, 0, GLASS);       // 앞 유리
  k.pair(len * 0.5, (H - ride) * 0.34, 0.04, x + len * 0.12, ride + (H - ride) * 0.54, W / 2 - 0.03, GLASS);              // 옆 창
  k.box(0.25, 0.28, W + 0.06, x + len / 2 + hood - 0.05, ride - 0.12, 0, DARK);              // 범퍼
  k.pair(0.1, 0.3, 0.1, x + len / 2 - 0.3, ride + (H - ride) * 0.55, W / 2 + 0.12, DARK);    // 사이드미러
  return k;
}

const sedan = o => passenger(new Kit(), { L: 4.5, W: 1.8, H: 1.45, hood: 1.25, trunk: 0.95, ...o });
const TYPES = {
  sedan: { w: 16, len: 4.5, build: () => sedan({}).build() },
  hatchback: { w: 12, len: 4.0, build: () => passenger(new Kit(), { L: 4.0, W: 1.75, H: 1.5, hood: 1.05, trunk: 0.12, rIn: 0.3 }).build() },
  wagon: { w: 6, len: 4.7, build: () => passenger(new Kit(), { L: 4.7, W: 1.8, H: 1.5, hood: 1.25, trunk: 0.1, rIn: 0.22 })
    .pair(2.2, 0.05, 0.05, -0.55, 1.5, 0.62, DARK).build() },
  suv: { w: 12, len: 4.8, build: () => passenger(new Kit(), { L: 4.8, W: 1.95, H: 1.85, ride: 0.42, bodyH: 0.72, hood: 1.25, trunk: 0.08, fIn: 0.4, rIn: 0.18, wheel: 0.4 })
    .pair(2.3, 0.06, 0.06, -0.55, 1.85, 0.7, DARK).box(0.06, 0.06, 1.4, 0.3, 1.85, 0, DARK).box(0.06, 0.06, 1.4, -1.4, 1.85, 0, DARK)
    .box(0.2, 0.3, 2.0, 2.38, 0.35, 0, DARK).build() },
  pickup: { w: 5, len: 5.3, build: () => passenger(new Kit(), { L: 5.3, W: 1.95, H: 1.85, ride: 0.42, bodyH: 0.72, hood: 1.35, trunk: 1.75, fIn: 0.4, rIn: 0.12, wheel: 0.4 })
    .pair(1.7, 0.42, 0.08, -1.75, 1.14, 0.93, 0xffffff, 1).box(0.08, 0.42, 1.9, -2.6, 1.14, 0, 0xffffff, 1).box(1.6, 0.04, 1.75, -1.75, 1.15, 0, DARK)
    .box(0.2, 0.3, 2.0, 2.62, 0.35, 0, DARK).build() },
  coupe: { w: 3, len: 4.5, build: () => passenger(new Kit(), { L: 4.5, W: 1.88, H: 1.27, ride: 0.2, bodyH: 0.5, hood: 1.45, trunk: 0.75, fIn: 0.75, rIn: 0.8, wheel: 0.35 })
    .box(0.28, 0.04, 1.6, -2.05, 1.02, 0, DARK).pair(0.06, 0.2, 0.06, -2.05, 0.82, 0.6, DARK).box(0.5, 0.05, 0.6, 1.3, 0.71, 0, DARK).build() },
  minivan: { w: 6, len: 5.0, build: () => passenger(new Kit(), { L: 5.0, W: 1.95, H: 1.78, bodyH: 0.75, hood: 0.95, trunk: 0.05, fIn: 0.7, rIn: 0.15 })
    .pair(2.0, 0.05, 0.05, -0.6, 1.78, 0.68, DARK).build() },
  taxi: { w: 10, len: 4.5, build: () => {                                 // 노란 택시: 지붕 표시등 + 옆면 체크무늬
    const k = sedan({ paint: 0, color: 0xf2b619 });
    k.box(0.5, 0.2, 0.3, -0.1, 1.44, 0, 0xf6c21c).box(0.52, 0.06, 0.32, -0.1, 1.42, 0, DARK);
    for (let i = 0; i < 14; i++) k.pair(0.11, 0.07, 0.02, -1.5 + i * 0.22, 0.66 + (i % 2) * 0.07, 0.905, 0x1d1d1d);
    return k.build();
  } },
  police: { w: 1.5, len: 4.7, build: () => sedan({ L: 4.7, paint: 0, color: 0x15171b })   // 검은 차체 + 흰 문
    .pair(1.75, 0.5, 0.02, -0.1, 0.33, 0.9, 0xf2f2f0).box(1.2, 0.07, 1.45, -0.12, 1.42, 0, 0xf2f2f0).bar(-0.1, 1.5, 1.2).box(0.14, 0.4, 1.7, 2.4, 0.25, 0, DARK).build() },
  cargoVan: { w: 5, len: 5.7, build: () => new Kit()                     // 크림색 밴: 옆 창이 없는 높은 적재함
    .box(5.7, 2.15, 2.0, 0, 0.35, 0, 0xe6dcc0, 0, [0.75, 0.04, 0.06]).box(5.6, 0.22, 2.03, 0, 0.3, 0, DARK)
    .box(0.9, 0.75, 1.7, 2.25, 1.35, 0, GLASS, 0, [0.5, 0, 0.05]).pair(0.9, 0.5, 0.04, 1.55, 1.45, 0.985, GLASS)
    .box(3.9, 0.12, 2.02, -0.9, 0.95, 0, 0x8d8a80).lamps(2.86, -2.86, 0.75, 0.75).axle(1.75, 0.87, 0.36).axle(-1.8, 0.87, 0.36).build() },
  boxTruck: { w: 5, len: 7.2, build: () => cab(new Kit(), 2.6, { W: 2.2, H: 2.4, color: 0xf1f1ee })   // 흰 탑차
    .box(5.2, 2.7, 2.4, -0.95, 1.0, 0, 0xe9e9e6).box(5.25, 0.06, 2.44, -0.95, 3.66, 0, 0xc9c9c6).box(6.6, 0.3, 1.1, -0.2, 0.62, 0, DARK)
    .pair(0.05, 2.5, 0.03, -3.5, 1.1, 0.6, 0xbdbdb8).pair(0.06, 0.14, 0.3, -3.58, 0.8, 0.9, TAIL)
    .axle(2.5, 0.95, 0.42, 0.28).axle(-2.2, 0.98, 0.42, 0.28, true).build() },
  cityBus: { w: 6, len: 11, build: () => busBody(new Kit(), { L: 11, W: 2.5, H: 3.0, color: 0x1f9aa0 })   // 청록 시내버스
    .box(2.6, 0.22, 1.5, 1.2, 3.0, 0, 0xb5babf).box(1.6, 0.18, 1.3, -2.4, 3.0, 0, 0xb5babf)
    .pair(1.1, 1.9, 0.02, 3.6, 0.45, 1.262, 0x16292d).pair(1.1, 1.9, 0.02, -0.6, 0.45, 1.262, 0x16292d)
    .box(0.06, 0.3, 1.6, 5.5, 2.5, 0, 0x101214).build() },
  coach: { w: 2, len: 12, build: () => busBody(new Kit(), { L: 12, W: 2.55, H: 3.4, color: 0xf0efec, lower: 0x7a1f2b, winY: 1.5, winH: 1.15 })   // 흰색·자주색 관광버스
    .box(10, 0.12, 2.58, 0, 1.3, 0, 0x7a1f2b).box(3, 0.2, 1.6, -1, 3.4, 0, 0xc6c9cc).build() },
  schoolBus: { w: 1, len: 10.5, build: () => {                            // 노란 스쿨버스: 앞으로 튀어나온 보닛 + 검은 줄
    const k = busBody(new Kit(), { L: 9, W: 2.45, H: 3.0, color: 0xf5b81a, winY: 1.6, winH: 0.8 });
    k.box(1.6, 1.25, 2.0, 5.2, 0.45, 0, 0xf5b81a, 0, [0.25, 0, 0.1]).box(0.08, 0.7, 1.3, 6.0, 0.6, 0, 0x1c1c1c).pair(0.06, 0.2, 0.26, 6.02, 0.95, 0.75, HEAD);
    for (const y of [0.75, 1.15, 2.55]) k.box(9.02, 0.07, 2.48, 0, y, 0, 0x1c1c1c);
    k.pair(0.1, 0.22, 0.22, 4.4, 2.75, 0.8, AMBER).pair(0.1, 0.22, 0.22, 4.4, 2.75, 0.45, TAIL);
    return k.build();
  } },
  dumpTruck: { w: 1.5, len: 7.6, build: () => cab(new Kit(), 2.3, { W: 2.4, H: 2.9, len: 1.7, color: 0xf0a81c, ride: 0.9, hood: 1.2 })   // 노란 덤프
    .box(4.6, 0.2, 2.5, -1.3, 1.45, 0, 0xe39b17).pair(4.6, 1.3, 0.14, -1.3, 1.6, 1.2, 0xe39b17).box(0.14, 1.6, 2.5, 0.95, 1.6, 0, 0xe39b17)
    .box(0.9, 0.14, 2.5, 1.5, 3.1, 0, 0xe39b17).box(0.14, 1.1, 2.5, -3.55, 1.6, 0, 0xd18d12).box(4.3, 0.9, 2.2, -1.3, 1.62, 0, 0x4a4036)
    .box(6.6, 0.35, 1.1, -0.4, 0.95, 0, DARK).pair(0.1, 1.5, 0.1, 1.2, 2.2, 1.3, CHROME)
    .axle(3.0, 1.05, 0.58, 0.36).axle(-1.4, 1.02, 0.58, 0.36, true).axle(-2.75, 1.02, 0.58, 0.36, true).build() },
  semi: { w: 1.5, len: 14, build: () => cab(new Kit(), 4.6, { W: 2.4, H: 3.1, len: 2.2, color: 0x8c1d22, ride: 0.75, hood: 1.7 })   // 빨간 트랙터 + 은색 트레일러
    .box(1.4, 3.0, 2.4, 2.9, 0.75, 0, 0x8c1d22).pair(0.12, 3.4, 0.12, 3.65, 0.9, 1.28, CHROME)
    .box(9.6, 2.9, 2.5, -2.4, 1.25, 0, 0xc3c7cb).box(9.65, 0.08, 2.54, -2.4, 4.1, 0, 0x9da1a5).box(13, 0.3, 1.0, 0, 0.8, 0, DARK)
    .pair(0.06, 0.14, 0.3, -7.22, 1.4, 0.95, TAIL).pair(1.4, 0.5, 0.4, 3.0, 0.5, 1.0, CHROME)
    .axle(5.6, 1.02, 0.5, 0.3).axle(2.6, 1.0, 0.5, 0.3, true).axle(1.4, 1.0, 0.5, 0.3, true).axle(-5.2, 1.02, 0.5, 0.3, true).axle(-6.4, 1.02, 0.5, 0.3, true).build() },
  towTruck: { w: 1, len: 6.6, build: () => cab(new Kit(), 1.9, { W: 2.2, H: 2.2, len: 1.9, color: 0xe8641d, ride: 0.6, hood: 1.2 })   // 주황 견인차
    .bar(1.9, 2.27, 1.3, AMBER, AMBER).box(3.9, 0.16, 2.3, -1.25, 1.05, 0, 0x55585c).pair(3.9, 0.12, 0.08, -1.25, 1.2, 1.12, 0xe8641d)
    .box(0.5, 0.9, 1.6, 0.55, 1.2, 0, 0xe8641d).box(0.5, 0.5, 0.5, 0.2, 1.25, 0, DARK).box(5.6, 0.3, 1.0, -0.5, 0.65, 0, DARK)
    .box(0.3, 0.5, 2.3, 3.75, 0.45, 0, DARK).pair(0.06, 0.14, 0.3, -3.22, 0.9, 0.9, TAIL)
    .axle(2.4, 0.97, 0.45, 0.28).axle(-2.0, 0.97, 0.45, 0.28, true).build() },
  garbageTruck: { w: 1, len: 8.0, build: () => cab(new Kit(), 2.7, { W: 2.4, H: 2.8, len: 1.8, color: 0x2e7d3c, ride: 0.8, hood: 1.1 })   // 초록 청소차
    .box(4.6, 2.5, 2.5, -1.0, 1.15, 0, 0x2f8040, 0, [0.1, 0.1, 0.1]).box(1.5, 2.3, 2.4, -3.6, 0.9, 0, 0x286f37, 0, [0.1, 0.9, 0.08])
    .pair(4.4, 0.12, 0.04, -1.0, 2.1, 1.26, 0x24632f).pair(4.4, 0.12, 0.04, -1.0, 2.9, 1.22, 0x24632f)
    .box(7.0, 0.3, 1.0, -0.6, 0.85, 0, DARK).pair(0.06, 0.14, 0.3, -4.36, 1.2, 0.9, TAIL).pair(0.1, 0.1, 0.1, 2.2, 2.82, 0.9, AMBER)
    .axle(3.2, 1.03, 0.52, 0.32).axle(-1.5, 1.02, 0.52, 0.32, true).axle(-2.75, 1.02, 0.52, 0.32, true).build() },
  ambulance: { w: 0.8, len: 6.4, build: () => cab(new Kit(), 1.9, { W: 2.1, H: 2.1, len: 1.7, color: 0xf3f3f1, ride: 0.55, hood: 1.15 })   // 흰 구급차: 빨간 띠 + 경광등
    .box(3.9, 2.35, 2.3, -1.2, 0.75, 0, 0xf3f3f1).box(3.92, 0.3, 2.33, -1.2, 1.55, 0, 0xcc2020).pair(1.2, 0.25, 0.02, 2.2, 1.3, 1.06, 0xcc2020)
    .bar(0.55, 3.12, 1.6, 0xd8261c, 0xd8261c).bar(-3.0, 3.12, 1.6, 0xd8261c, 0xd8261c).box(1.0, 0.25, 0.9, -1.2, 3.1, 0, 0xdadad6)
    .pair(0.8, 0.6, 0.02, -0.4, 2.1, 1.16, GLASS).box(5.4, 0.3, 1.0, -0.5, 0.6, 0, DARK).pair(0.06, 0.14, 0.3, -3.16, 1.1, 0.9, TAIL)
    .axle(2.35, 0.93, 0.42, 0.28).axle(-2.1, 0.98, 0.42, 0.28, true).build() },
  fireEngine: { w: 0.6, len: 8.6, build: () => {                          // 빨간 소방차: 흰 띠 + 지붕 사다리
    const k = cab(new Kit(), 3.1, { W: 2.5, H: 2.9, len: 2.4, color: 0xc81f1f, ride: 0.6 });
    k.box(5.6, 2.2, 2.5, -1.3, 0.6, 0, 0xc81f1f).box(8.0, 0.22, 2.53, -0.1, 1.25, 0, 0xf2f2f0).bar(3.6, 2.97, 1.8);
    k.pair(1.2, 1.0, 0.03, 0.5, 1.5, 1.262, 0x9fa3a6).pair(1.2, 1.0, 0.03, -1.0, 1.5, 1.262, 0x9fa3a6).pair(1.2, 1.0, 0.03, -2.6, 1.5, 1.262, 0x9fa3a6);
    k.pair(6.4, 0.1, 0.08, -0.9, 3.05, 0.35, CHROME);                                         // 사다리 세로대
    for (let x = -3.9; x < 2.2; x += 0.55) k.box(0.07, 0.07, 0.7, x, 3.06, 0, CHROME);       // 사다리 가로대
    k.box(0.9, 0.5, 0.9, -3.4, 2.8, 0, 0x8e9296).box(0.3, 0.6, 2.6, 4.4, 0.4, 0, CHROME).pair(0.06, 0.14, 0.3, -4.12, 1.0, 1.0, TAIL);
    return k.axle(3.0, 1.08, 0.52, 0.32).axle(-2.0, 1.06, 0.52, 0.32, true).axle(-3.2, 1.06, 0.52, 0.32, true).build();
  } },
};
// 도색: 흰색·회색·검정이 많고 원색은 드물다
const PAINTS = [0xf2f2f0, 0xf2f2f0, 0xe4e5e6, 0xb9bdc2, 0xb9bdc2, 0x8f9499, 0x52565c, 0x1c1d20, 0x1c1d20, 0x26355c, 0x8f1d1f, 0x2f5a3c, 0xcbbfa3, 0x3c5a7a, 0xb5501e];

export function buildTraffic(scene, D, lampMat) {
  const names = Object.keys(TYPES), total = names.reduce((a, n) => a + TYPES[n].w, 0);
  const r = rng(99);
  const pick = (heavy) => {                         // heavy: 큰 차가 다닐 만한 넓은 길인가
    for (;;) {
      let v = r() * total, name = names[0];
      for (const n of names) if ((v -= TYPES[n].w) < 0) { name = n; break; }
      if (heavy || TYPES[name].len < 7.5) return name;
    }
  };
  const paths = D.carPaths.map(([w, oneway, lanes, f]) => {
    const cum = [0];
    for (let i = 0; i < f.length / 2 - 1; i++) cum.push(cum[i] + Math.hypot(f[2 * i + 2] - f[2 * i], f[2 * i + 3] - f[2 * i + 1]));
    return { w, oneway, lanes, f, cum, len: cum[cum.length - 1] };
  });
  // 이면도로(골목)에도 차가 다닌다: 끝이 맞닿은 도로 조각을 되도록 곧게 이어 긴 경로로 만든다
  {
    const segs = D.roads.filter(rd => rd[0] === 3 && rd[3].length >= 4).map(rd => rd[3]);
    const key = (x, y) => Math.round(x * 10) + ',' + Math.round(y * 10);
    const ends = new Map();
    segs.forEach((f, i) => {
      for (const e of [0, 1]) {
        const k = e ? key(f[f.length - 2], f[f.length - 1]) : key(f[0], f[1]);
        if (!ends.has(k)) ends.set(k, []);
        ends.get(k).push({ i, e });
      }
    });
    const used = new Uint8Array(segs.length);
    const reversed = f => { const o = []; for (let i = f.length - 2; i >= 0; i -= 2) o.push(f[i], f[i + 1]); return o; };
    const extend = pts => {                         // pts 의 끝에서 이어지는 조각을 계속 붙인다
      for (;;) {
        const n = pts.length, dx = pts[n - 2] - pts[n - 4], dy = pts[n - 1] - pts[n - 3], dl = Math.hypot(dx, dy) || 1;
        let best = null, bd = 0.35;                 // 너무 꺾이는 길로는 잇지 않는다
        for (const c of ends.get(key(pts[n - 2], pts[n - 1])) || []) {
          if (used[c.i]) continue;
          const f = c.e ? reversed(segs[c.i]) : segs[c.i];
          const ex = f[2] - f[0], ey = f[3] - f[1], el = Math.hypot(ex, ey) || 1, dot = (dx * ex + dy * ey) / (dl * el);
          if (dot > bd) { bd = dot; best = { i: c.i, f }; }
        }
        if (!best) return pts;
        used[best.i] = 1;
        for (let k = 2; k < best.f.length; k++) pts.push(best.f[k]);
      }
    };
    segs.forEach((f0, i) => {
      if (used[i]) return;
      used[i] = 1;
      const f = reversed(extend(reversed(extend([...f0]))));
      const cum = [0];
      for (let k = 0; k < f.length / 2 - 1; k++) cum.push(cum[k] + Math.hypot(f[2 * k + 2] - f[2 * k], f[2 * k + 3] - f[2 * k + 1]));
      if (cum[cum.length - 1] >= 50) paths.push({ w: 12, oneway: 0, lanes: 2, f, cum, len: cum[cum.length - 1], alley: true });
    });
  }
  // 경로마다 신호등 있는 횡단보도의 위치(정지선)를 찾아 둔다
  const signals = signalCrossings(D);
  for (const p of paths) {
    p.stops = [];
    for (const sg of signals) {
      let best = 9, at = 0;
      for (let i = 0; i < p.f.length / 2 - 1; i++) {
        const x0 = p.f[2 * i], y0 = p.f[2 * i + 1], dx = p.f[2 * i + 2] - x0, dy = p.f[2 * i + 3] - y0, l2 = dx * dx + dy * dy;
        const t = l2 > 0 ? Math.max(0, Math.min(1, ((sg.x - x0) * dx + (sg.y - y0) * dy) / l2)) : 0;
        const d = Math.hypot(sg.x - x0 - dx * t, sg.y - y0 - dy * t);
        if (d < best) { best = d; at = p.cum[i] + Math.sqrt(l2) * t; }
      }
      if (best < 3) p.stops.push({ s: at, grp: sg.grp });
    }
  }
  const cars = [], counts = {};
  for (const p of paths) {
    const lw = p.w / p.lanes, lanesList = [];
    if (p.oneway) for (let k = 0; k < p.lanes; k++) lanesList.push({ off: -p.w / 2 + (k + 0.5) * lw, dir: 1 });
    else { const half = Math.max(1, Math.floor(p.lanes / 2)), hw = p.w / 2 / half; for (let k = 0; k < half; k++) { lanesList.push({ off: (k + 0.5) * hw, dir: 1 }); lanesList.push({ off: (k + 0.5) * hw, dir: -1 }); } }
    for (const ln of lanesList) {
      const speed = p.alley ? 3.5 + r() * 3.5 : 7 + r() * 6;     // 같은 차로는 같은 속도 → 추돌 없음. 골목은 천천히.
      let s = r() * (p.alley ? 90 : 40);
      while (s < p.len) {
        const type = pick(p.w >= 24), len = TYPES[type].len;
        cars.push({ p, s, speed, v: speed, off: ln.off, dir: ln.dir, type, slot: counts[type] = (counts[type] || 0), half: len / 2, x: 0, z: 0, c: 1, sn: 0, solid: false });
        counts[type]++;
        s += len + (p.alley ? 45 + r() * 110 : 22 + r() * 70);
      }
    }
  }

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.35, envMapIntensity: 0.7 });
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', 'attribute float aPaint;\nattribute vec3 aTint;\n#include <common>')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvColor.rgb *= mix(vec3(1.0), aTint, aPaint);');
  };
  const meshes = {}, dims = {}, c = new THREE.Color();
  for (const name of names) {
    const n = counts[name] || 0;
    if (!n) continue;
    const g = TYPES[name].build(), tint = new Float32Array(n * 3);
    g.computeBoundingBox(); dims[name] = { h: g.boundingBox.max.y, w: g.boundingBox.max.z };     // 충돌용 높이·반폭
    for (let i = 0; i < n; i++) { c.set(PAINTS[Math.floor(r() * PAINTS.length)]); tint[3 * i] = c.r; tint[3 * i + 1] = c.g; tint[3 * i + 2] = c.b; }
    g.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
    const m = new THREE.InstancedMesh(g, mat, n);
    m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(m);
    meshes[name] = m;
  }
  const lg = new THREE.BufferGeometry();            // 전조등 (밤)
  lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cars.length * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const lights = new THREE.Points(lg, lampMat.clone());
  lights.material.size = 7; lights.frustumCulled = false;
  scene.add(lights);

  const dummy = new THREE.Object3D();
  // listener: 소리를 듣는 위치 (three.js 좌표). 돌려주는 값: level 주변 교통량 0~1, near 가장 가까운 차까지의 거리(m)
  const heard = { level: 0, near: Infinity };
  const NONE = [], low = [];
  // 드론(구)을 차(돌려 놓은 상자) 밖으로 밀어낸다. 차는 꿈쩍하지 않고, 드론은 차가 가는 쪽으로 조금 떠밀린다.
  function bump(car, a) {
    const ex = a.pos.x - car.x, ez = a.pos.z - car.z, lim = car.half + 2.4;
    if (ex * ex + ez * ez > lim * lim) return;
    const d = dims[car.type], R = 1.6, cy = 0.3 + d.h / 2;
    const lx = ex * car.c - ez * car.sn, lz = ex * car.sn + ez * car.c, ly = a.pos.y - cy;
    const qx = Math.max(-car.half, Math.min(car.half, lx)), qy = Math.max(-d.h / 2, Math.min(d.h / 2, ly)), qz = Math.max(-d.w, Math.min(d.w, lz));
    let nx = lx - qx, ny = ly - qy, nz = lz - qz, push;
    const e = Math.hypot(nx, ny, nz);
    if (e >= R) return;
    if (e > 1e-4) { nx /= e; ny /= e; nz /= e; push = R - e; } else { nx = 0; ny = 1; nz = 0; push = R + d.h / 2 - ly; }
    const wx = nx * car.c + nz * car.sn, wz = -nx * car.sn + nz * car.c;
    a.pos.x += wx * push; a.pos.y += ny * push; a.pos.z += wz * push;
    const vn = a.vel.x * wx + a.vel.y * ny + a.vel.z * wz;
    if (vn < 0) { a.vel.x -= vn * wx; a.vel.y -= vn * ny; a.vel.z -= vn * wz; }
    a.vel.x += car.c * car.speed * 0.3; a.vel.z -= car.sn * car.speed * 0.3;
    a.carBump = true;
  }
  // 레이저가 차에 맞는가: 닿는 거리 (없으면 maxT)
  function raycast(ox, oy, oz, dx, dy, dz, maxT) {
    if (Math.min(oy, oy + dy * maxT) > 5) return maxT;       // 차보다 높이 지나간다
    let best = maxT;
    for (const car of cars) {
      if (!car.solid) continue;
      const ex = ox - car.x, ez = oz - car.z, lim = best + car.half + 2;
      if (ex * ex + ez * ez > lim * lim) continue;
      const d = dims[car.type], ey = oy - (0.3 + d.h / 2);
      const lo = [ex * car.c - ez * car.sn, ey, ex * car.sn + ez * car.c], ld = [dx * car.c - dz * car.sn, dy, dx * car.sn + dz * car.c], h = [car.half, d.h / 2, d.w];
      let t0 = 0, t1 = best, miss = false;
      for (let a = 0; a < 3 && !miss; a++) {
        if (Math.abs(ld[a]) < 1e-9) { if (Math.abs(lo[a]) > h[a]) miss = true; continue; }
        let u = (-h[a] - lo[a]) / ld[a], v = (h[a] - lo[a]) / ld[a];
        if (u > v) { const w = u; u = v; v = w; }
        if (u > t0) t0 = u;
        if (v < t1) t1 = v;
        if (t0 > t1) miss = true;
      }
      if (!miss && t0 > 0 && t0 < best) best = t0;
    }
    return best;
  }
  // 차들의 위치 격자 (16m 칸): 앞차 찾기와 '근처에 차가 있나' 검사에 쓴다
  const GC = 16, grid = new Map();
  const gkey = (x, z) => (Math.floor(x / GC) + 256) * 1024 + Math.floor(z / GC) + 256;
  function regrid() {
    for (const cell of grid.values()) cell.length = 0;
    for (const car of cars) {
      const k = gkey(car.x, car.z);
      let cell = grid.get(k);
      if (!cell) grid.set(k, cell = []);
      cell.push(car);
    }
  }
  // (x,z) 반경 r 안에 차가 있는가 (보행자가 길을 건널 틈을 볼 때 쓴다). moving: 움직이는 차만 센다
  function carNear(x, z, r, moving = true) {
    const n = Math.ceil(r / GC);
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
      const cell = grid.get(gkey(x + i * GC, z + j * GC));
      if (cell) for (const car of cell) if (car.solid && (!moving || car.v > 1) && (car.x - x) * (car.x - x) + (car.z - z) * (car.z - z) < r * r) return true;
    }
    return false;
  }
  // 이 차가 지금 설 수 있는 가장 가까운 장애물까지의 여유 거리 (없으면 큰 값)
  function gapAhead(car, idx, peds) {
    const p = car.p, fx = car.c, fz = -car.sn;       // 진행 방향 (three.js x,z)
    let gap = 1e9;
    // 빨간 신호의 정지선
    for (const st of p.stops) {
      const d = car.dir > 0 ? st.s - 4.5 - (car.s + car.half) : (car.s - car.half) - (st.s + 4.5);
      if (d < -1.5 || d > 60) continue;                // 이미 지났거나 아직 멀다
      const light = SIGNAL.car(st.grp);
      if (light === 'r' || (light === 'y' && d > 7)) gap = Math.min(gap, d);
    }
    // 앞차. 같은 차로의 앞차는 언제나 따라가며 선다.
    // 내 앞을 가로지르는 차에는 번호가 앞선 차가 움직이며 지나갈 때만 양보한다 (서로 기다리다 꽉 막히지 않게).
    const look = car.v * 1.6 + car.half + 14;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const cell = grid.get(gkey(car.x + fx * look * 0.5 + i * GC, car.z + fz * look * 0.5 + j * GC));
      if (!cell) continue;
      for (const o of cell) {
        if (o === car) continue;
        const rx = o.x - car.x, rz = o.z - car.z, ahead = rx * fx + rz * fz;
        const sameLane = o.p === p && o.off === car.off && o.dir === car.dir;
        if (sameLane) {
          // 같은 차로: 경로 위의 거리로 누가 앞인지 가린다 (겹쳐 있어도 뒤차만 서므로 서로 막히지 않는다)
          const lead = (o.s - car.s) * car.dir;
          if (lead > look || lead < 0 || (lead === 0 && o.idx > idx)) continue;
          gap = Math.min(gap, lead - car.half - o.half - 2.2);
          continue;
        }
        if (ahead <= 0 || ahead > look || Math.abs(rx * fz - rz * fx) > 1.7) continue;
        if (!(o.solid && o.idx < idx && o.v > 3 && o.c * fx - o.sn * fz < 0.5)) continue;      // 가로지르는 차: 번호가 앞서고 움직이는 차에만 양보
        gap = Math.min(gap, ahead - car.half - o.half - 2.2);
      }
    }
    // 내 차로 바로 앞 차도 위의 보행자 (멈출 수 있는 거리 안)
    const pl = car.v * car.v / 7 + car.half + 5;
    for (const q of peds) {
      const rx = q.x - car.x, rz = q.z - car.z, ahead = rx * fx + rz * fz;
      if (ahead <= 0 || ahead > pl || Math.abs(rx * fz - rz * fx) > 1.8) continue;
      gap = Math.min(gap, ahead - car.half - 2.5);
    }
    return gap;
  }
  cars.forEach((car, i) => { car.idx = i; });

  // actors: 차와 부딪힐 수 있는 드론들 [{ pos, vel }]. peds: 차도 위에 있는 보행자들 [{ x, z }]
  function update(dt, listener, actors, peds = NONE) {
    let sum = 0, near2 = Infinity;
    low.length = 0;
    for (const a of actors || NONE) if (a.pos.y < 6.5) low.push(a);
    const lx = listener ? listener.x : 0, ly = listener ? listener.y : 0, lz = listener ? listener.z : 0;
    const lp = lg.attributes.position;
    regrid();
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i], p = car.p;
      // 속도: 막힌 곳이 없으면 제 속도로, 있으면 그 앞에서 멈추도록 줄인다
      let want = car.speed;
      if (car.solid && dt > 0) {
        const gap = gapAhead(car, i, peds);
        if (gap < 1e8) want = gap <= 0.3 ? 0 : Math.min(car.speed, Math.sqrt(2 * 3.5 * gap));
      }
      car.v += Math.max(-9 * dt, Math.min(2.6 * dt, want - car.v));
      if (car.v < 0.05 && want === 0) car.v = 0;
      car.s += car.v * dt * car.dir;
      if (car.s > p.len) car.s -= p.len; else if (car.s < 0) car.s += p.len;
      let lo = 0, hi = p.cum.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p.cum[m] <= car.s) lo = m; else hi = m; }
      const x0 = p.f[2 * lo], y0 = p.f[2 * lo + 1], dx = p.f[2 * lo + 2] - x0, dy = p.f[2 * lo + 3] - y0, L = p.cum[lo + 1] - p.cum[lo] || 1;
      const ux = dx / L, uy = dy / L, t = car.s - p.cum[lo], o = car.off * car.dir;
      const x = x0 + ux * t + uy * o, y = y0 + uy * t - ux * o;
      dummy.position.set(x, 0.3, -y);
      // 경로의 끝에서 갑자기 사라지거나 나타나지 않게 양 끝 8m 에서 크기를 줄인다
      dummy.scale.setScalar(Math.min(1, Math.max(0.02, Math.min(car.s, p.len - car.s) / 8)));
      if (listener) {
        const d2 = (x - lx) * (x - lx) + ly * ly + (-y - lz) * (-y - lz);
        if (d2 < 14400) { sum += 1 / (1 + d2 / 500); if (d2 < near2) near2 = d2; }
      }
      dummy.rotation.y = Math.atan2(uy * car.dir, ux * car.dir);
      car.x = x; car.z = -y; car.c = ux * car.dir; car.sn = uy * car.dir; car.solid = dummy.scale.x > 0.6;
      if (car.solid) for (let k = 0; k < low.length; k++) bump(car, low[k]);
      dummy.updateMatrix();
      meshes[car.type].setMatrixAt(car.slot, dummy.matrix);
      lp.setXYZ(i, x + ux * car.dir * car.half, 1.0, -(y + uy * car.dir * car.half));
    }
    for (const n in meshes) meshes[n].instanceMatrix.needsUpdate = true;
    lp.needsUpdate = true;
    heard.level = Math.min(1, sum / 3.5); heard.near = Math.sqrt(near2);
    return heard;
  }
  update(0);
  return { update, raycast, carNear, cars, count: cars.length, setNight(n) { lights.material.opacity = n; lights.visible = n > 0.02; } };
}
