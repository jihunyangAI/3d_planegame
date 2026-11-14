// 보행자: 인도와 골목 가장자리, 보행자 거리를 따라 걷는다. 길 끝에 닿으면 돌아선다.
// 몸통·다리·팔을 각각 InstancedMesh 로 그리고, 다리와 팔은 걸음에 맞춰 앞뒤로 흔든다. 충돌은 없다.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeAsphaltTest } from './roadgrid.js';

function rng(seed) { let s = (seed * 2654435761) >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const SHIRTS = [0xf2f2f0, 0xf2f2f0, 0x1d1f24, 0x1d1f24, 0x8a8f96, 0x2f4a7a, 0xb23a2e, 0xe7c25a, 0x3f7a55, 0xd98aa6, 0x6a4f8a, 0xc9b79a, 0xe08a3c, 0x5fa3c9];
const PANTS = [0x23262c, 0x23262c, 0x2f3d57, 0x3d5273, 0x6b6f76, 0xb9ab8f, 0x4a3f36];
const SKIN = 0xe6b89a, HAIRS = [0x1b1714, 0x1b1714, 0x3a2a1e, 0x5a4632, 0x8a8a8a];

// 길 종류별: [인도 중심까지 차도 끝에서의 거리, 좌우로 흩어지는 폭, 몇 m 에 한 명, 바닥 높이]
const WALK = { 0: [1.6, 2.0, 11, 0.46], 1: [1.6, 2.0, 11, 0.46], 2: [1.6, 2.0, 14, 0.46], 3: [0.5, 0.5, 48, 0.46], 5: [0, 0, 7, 0.18] };

export function buildPeople(scene, D) {
  const r = rng(321), onAsphalt = makeAsphaltTest(D);
  const walkers = [];
  for (const [grp, w, , f] of D.roads) {
    const rule = WALK[grp];
    if (!rule) continue;
    const cum = [0];
    for (let i = 0; i < f.length / 2 - 1; i++) cum.push(cum[i] + Math.hypot(f[2 * i + 2] - f[2 * i], f[2 * i + 3] - f[2 * i + 1]));
    const len = cum[cum.length - 1];
    if (len < 30) continue;
    // 길 옆으로 off 만큼 떨어진 줄의, 거리 s 지점
    const at = (s, off) => {
      let lo = 0, hi = cum.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
      const dx = f[2 * lo + 2] - f[2 * lo], dy = f[2 * lo + 3] - f[2 * lo + 1], L = cum[lo + 1] - cum[lo] || 1, t = s - cum[lo];
      return [f[2 * lo] + dx / L * t + dy / L * off, f[2 * lo + 1] + dy / L * t - dx / L * off];
    };
    // 그 줄이 대부분 인도 위인가 (나란한 다른 차로나 교차로에 걸쳐 있으면 걷지 않는다)
    const walkable = off => {
      let bad = 0;
      const m = Math.max(4, Math.ceil(len / 8));
      for (let k = 0; k <= m; k++) if (onAsphalt(...at(len * k / m, off))) bad++;
      return bad <= m * 0.15;
    };
    const sides = grp === 5 ? null : [1, -1].filter(sd => walkable(sd * (w / 2 + rule[0])));
    if (sides && !sides.length) continue;
    const n = Math.floor(len / rule[2] * (sides ? sides.length / 2 : 1) + r());
    for (let k = 0; k < n; k++) {
      // 보행자 거리(5)는 길 전체에 흩어지고, 나머지는 인도가 있는 쪽에서만 걷는다
      const off = grp === 5 ? (r() - 0.5) * (w - 2) : sides[Math.floor(r() * sides.length)] * (w / 2 + rule[0] + (r() - 0.5) * rule[1]);
      walkers.push({ f, cum, len, s: r() * len, dir: r() < 0.5 ? 1 : -1, off, y: rule[3], speed: 1.0 + r() * 0.7, phase: r() * 6.28, h: 0.9 + r() * 0.2 });
    }
  }
  const N = walkers.length;

  // 몸통: 윗옷(색은 사람마다) + 머리 + 머리카락. 앞이 +X.
  const paint = (g, color, p) => {
    const n = g.attributes.position.count, col = new Float32Array(n * 3), pa = new Float32Array(n).fill(p), c = new THREE.Color(color);
    for (let i = 0; i < n; i++) { col[3 * i] = c.r; col[3 * i + 1] = c.g; col[3 * i + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('aPaint', new THREE.BufferAttribute(pa, 1));
    g.deleteAttribute('uv');
    return g.index ? g.toNonIndexed() : g;
  };
  const torso = new THREE.BoxGeometry(0.22, 0.56, 0.38); torso.translate(0, 1.12, 0);
  const head = new THREE.SphereGeometry(0.115, 8, 6); head.translate(0.01, 1.56, 0);
  const hair = new THREE.SphereGeometry(0.125, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.55); hair.translate(-0.012, 1.575, 0);
  const bodyGeo = mergeGeometries([paint(torso, 0xffffff, 1), paint(head, SKIN, 0), paint(hair, 0xffffff, 2)]);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = sh => {                       // aPaint 1: 윗옷 색(aTint), 2: 머리카락 색(aHair)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', 'attribute float aPaint;\nattribute vec3 aTint;\nattribute vec3 aHair;\n#include <common>')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvColor.rgb *= aPaint > 1.5 ? aHair : aPaint > 0.5 ? aTint : vec3(1.0);');
  };
  const tint = new Float32Array(N * 3), hairC = new Float32Array(N * 3), c = new THREE.Color();
  const legGeo = new THREE.BoxGeometry(0.15, 0.86, 0.15); legGeo.translate(0, -0.43, 0);        // 축이 엉덩이
  const armGeo = new THREE.BoxGeometry(0.1, 0.56, 0.1); armGeo.translate(0, -0.28, 0);          // 축이 어깨
  const limbMat = new THREE.MeshLambertMaterial();
  const body = new THREE.InstancedMesh(bodyGeo, mat, N);
  const legs = new THREE.InstancedMesh(legGeo, limbMat, N * 2), arms = new THREE.InstancedMesh(armGeo, limbMat, N * 2);
  walkers.forEach((p, i) => {
    c.set(SHIRTS[Math.floor(r() * SHIRTS.length)]); tint[3 * i] = c.r; tint[3 * i + 1] = c.g; tint[3 * i + 2] = c.b;
    arms.setColorAt(2 * i, c); arms.setColorAt(2 * i + 1, c);
    c.set(HAIRS[Math.floor(r() * HAIRS.length)]); hairC[3 * i] = c.r; hairC[3 * i + 1] = c.g; hairC[3 * i + 2] = c.b;
    c.set(PANTS[Math.floor(r() * PANTS.length)]); legs.setColorAt(2 * i, c); legs.setColorAt(2 * i + 1, c);
  });
  bodyGeo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
  bodyGeo.setAttribute('aHair', new THREE.InstancedBufferAttribute(hairC, 3));
  for (const m of [body, legs, arms]) { m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); }

  const dummy = new THREE.Object3D();
  dummy.rotation.order = 'YXZ';                       // 방향(Y)으로 돈 다음 걸음(Z)으로 흔든다
  function update(dt) {
    for (let i = 0; i < N; i++) {
      const p = walkers[i];
      p.s += p.speed * p.dir * dt;
      if (p.s > p.len) { p.s = p.len; p.dir = -1; } else if (p.s < 0) { p.s = 0; p.dir = 1; }
      p.phase += p.speed * dt * 4.2;
      let lo = 0, hi = p.cum.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p.cum[m] <= p.s) lo = m; else hi = m; }
      const x0 = p.f[2 * lo], y0 = p.f[2 * lo + 1], dx = p.f[2 * lo + 2] - x0, dy = p.f[2 * lo + 3] - y0, L = p.cum[lo + 1] - p.cum[lo] || 1;
      const ux = dx / L, uy = dy / L, t = p.s - p.cum[lo];
      const x = x0 + ux * t + uy * p.off, z = -(y0 + uy * t - ux * p.off);
      const head = Math.atan2(uy * p.dir, ux * p.dir), sw = Math.sin(p.phase) * 0.55, y = p.y + Math.abs(Math.cos(p.phase)) * 0.03;
      const sh = Math.sin(head), ch = Math.cos(head);
      dummy.scale.setScalar(p.h);
      dummy.position.set(x, y, z); dummy.rotation.set(0, head, 0); dummy.updateMatrix(); body.setMatrixAt(i, dummy.matrix);
      for (let k = 0; k < 2; k++) {
        const side = k ? 1 : -1, lz = side * 0.1 * p.h, az = side * 0.24 * p.h;                 // 몸 옆으로의 거리 (로컬 Z)
        dummy.position.set(x + sh * lz, y + 0.86 * p.h, z + ch * lz); dummy.rotation.set(0, head, sw * side); dummy.updateMatrix(); legs.setMatrixAt(2 * i + k, dummy.matrix);
        dummy.position.set(x + sh * az, y + 1.38 * p.h, z + ch * az); dummy.rotation.set(0, head, -sw * side * 0.8); dummy.updateMatrix(); arms.setMatrixAt(2 * i + k, dummy.matrix);
      }
    }
    body.instanceMatrix.needsUpdate = legs.instanceMatrix.needsUpdate = arms.instanceMatrix.needsUpdate = true;
  }
  update(0);
  return { update, count: N };
}
