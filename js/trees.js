// 나무 여섯 종. 수종마다 줄기와 잎 덩어리를 한 모양으로 합쳐 InstancedMesh 하나로 그린다.
// 잎 색은 나무마다 조금씩 다르고(aTint), 줄기 색은 그대로다. 같은 구역의 나무는 대체로 같은 수종이다.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function rng(seed) { let s = (seed * 2654435761) >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const BARK = 0x5b4a3a, UP = new THREE.Vector3(0, 1, 0);

class Kit {
  constructor() { this.parts = []; }
  _push(g, color, leaf) {
    g = g.index ? g.toNonIndexed() : g;
    const n = g.attributes.position.count, col = new Float32Array(n * 3), pa = new Float32Array(n).fill(leaf), c = new THREE.Color(color);
    for (let i = 0; i < n; i++) { col[3 * i] = c.r; col[3 * i + 1] = c.g; col[3 * i + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('aPaint', new THREE.BufferAttribute(pa, 1));
    g.deleteAttribute('uv');
    this.parts.push(g);
    return this;
  }
  // 줄기·가지: 두 점을 잇는 막대
  wood(a, b, r0, r1) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), len = d.length();
    const g = new THREE.CylinderGeometry(r1, r0, len, 6);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()));
    g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
    return this._push(g, BARK, 0);
  }
  // 잎 덩어리 (shade: 밝기 배율)
  blob(x, y, z, rx, ry, rz, detail = 0, shade = 1) {
    const g = new THREE.IcosahedronGeometry(1, detail); g.scale(rx, ry, rz); g.translate(x, y, z);
    return this._push(g, new THREE.Color(shade, shade, shade), 1);
  }
  cone(y, r, h, shade = 1) {
    const g = new THREE.ConeGeometry(r, h, 7); g.translate(0, y + h / 2, 0);
    return this._push(g, new THREE.Color(shade, shade, shade), 1);
  }
  build() { return mergeGeometries(this.parts); }
}

// 수종: weight 는 흔한 정도, leaves 는 잎 색 후보. 충돌용으로 crown [반지름, 아래, 위], trunk [반지름, 높이] (크기 1 기준).
const SPECIES = [
  { name: '플라타너스', crown: [2.5, 2.9, 7.2], trunk: [0.3, 3.0], weight: 26, leaves: [0x4f7f3a, 0x5c8c42, 0x6b9648, 0x567f35],          // 둥글고 풍성한 활엽수
    build: () => new Kit().wood([0, 0, 0], [0, 3.0, 0], 0.26, 0.18)
      .blob(0, 4.9, 0, 2.2, 2.1, 2.2, 1).blob(1.5, 4.2, 0.4, 1.3, 1.2, 1.3, 0, 0.9).blob(-1.2, 4.5, -0.9, 1.4, 1.2, 1.4, 0, 0.94).blob(-0.3, 4.0, 1.5, 1.2, 1.1, 1.2, 0, 0.88).blob(0.3, 6.3, -0.2, 1.3, 1.0, 1.3, 0, 1.06).build() },
  { name: '은행나무', crown: [1.7, 3.4, 9.8], trunk: [0.26, 4.2], weight: 22, leaves: [0xd9b72e, 0xe0c23a, 0xcfa826, 0xc9b23a],            // 키 크고 길쭉한 황금빛 나무
    build: () => new Kit().wood([0, 0, 0], [0, 4.2, 0], 0.22, 0.13)
      .blob(0, 6.0, 0, 1.6, 3.0, 1.6, 1).blob(0.2, 8.6, 0, 0.9, 1.3, 0.9, 0, 1.08).blob(-0.8, 4.6, 0.5, 1.0, 1.0, 1.0, 0, 0.9).blob(0.9, 4.9, -0.4, 0.9, 1.0, 0.9, 0, 0.93).build() },
  { name: '느티나무', crown: [3.3, 4.0, 7.5], trunk: [0.34, 2.8], weight: 16, leaves: [0x5f8a3c, 0x6f9440, 0x7a9b4a, 0x86943e],            // 가지가 벌어지고 넓게 퍼진 나무
    build: () => new Kit().wood([0, 0, 0], [0, 2.6, 0], 0.3, 0.22)
      .wood([0, 2.4, 0], [1.6, 4.4, 0.3], 0.16, 0.08).wood([0, 2.4, 0], [-1.3, 4.5, 0.9], 0.16, 0.08).wood([0, 2.4, 0], [-0.3, 4.6, -1.5], 0.16, 0.08)
      .blob(0, 5.7, 0, 3.2, 1.5, 3.2, 1).blob(2.0, 5.0, 0.4, 1.5, 1.0, 1.5, 0, 0.9).blob(-1.7, 5.1, 1.2, 1.5, 1.0, 1.5, 0, 0.93).blob(-0.4, 5.1, -2.0, 1.5, 1.0, 1.5, 0, 0.88).blob(0.2, 6.7, 0.1, 1.9, 0.9, 1.9, 0, 1.06).build() },
  { name: '단풍나무', crown: [2.3, 2.5, 5.2], trunk: [0.24, 2.0], weight: 12, leaves: [0xc8562a, 0xd2692e, 0xb8432a, 0xd98a2e],            // 낮고 넓은 붉은 나무
    build: () => new Kit().wood([0, 0, 0], [0, 2.0, 0], 0.2, 0.15)
      .wood([0, 1.8, 0], [0.9, 3.0, 0.2], 0.1, 0.06).wood([0, 1.8, 0], [-0.8, 3.0, -0.4], 0.1, 0.06)
      .blob(0, 3.9, 0, 2.0, 1.3, 2.0, 1).blob(1.4, 3.4, 0.5, 1.1, 0.9, 1.1, 0, 0.9).blob(-1.3, 3.5, -0.6, 1.1, 0.9, 1.1, 0, 0.94).blob(0.1, 3.4, -1.5, 1.0, 0.8, 1.0, 0, 0.88).blob(-0.2, 3.5, 1.5, 1.0, 0.8, 1.0, 0, 1.05).build() },
  { name: '소나무', crown: [1.6, 1.6, 8.0], trunk: [0.24, 2.2], weight: 12, leaves: [0x2f5d3a, 0x356640, 0x2a5236, 0x3d6b3f],              // 층층이 쌓인 침엽수
    build: () => new Kit().wood([0, 0, 0], [0, 2.2, 0], 0.2, 0.14)
      .cone(1.6, 2.1, 2.6, 0.9).cone(3.2, 1.7, 2.4, 0.97).cone(4.7, 1.25, 2.2, 1.04).cone(6.1, 0.75, 1.9, 1.1).build() },
  { name: '미루나무', crown: [1.05, 1.7, 10.0], trunk: [0.2, 2.0], weight: 12, leaves: [0x4a7a3c, 0x548440, 0x406e3a, 0x5d8a48],            // 가늘고 높은 기둥 모양
    build: () => new Kit().wood([0, 0, 0], [0, 2.0, 0], 0.17, 0.12)
      .blob(0, 5.6, 0, 1.0, 3.9, 1.0, 1).blob(0.25, 3.0, 0.1, 0.85, 1.3, 0.85, 0, 0.9).blob(-0.1, 8.9, 0, 0.6, 1.2, 0.6, 0, 1.08).build() },
];
const TOTAL = SPECIES.reduce((a, s) => a + s.weight, 0);
function pick(v) { v *= TOTAL; for (let i = 0; i < SPECIES.length; i++) if ((v -= SPECIES[i].weight) < 0) return i; return 0; }
const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

// trees: [x, y(북), 크기] 목록 (지도 좌표)
export function buildTrees(scene, trees) {
  const r = rng(11), groups = SPECIES.map(() => []);
  for (const t of trees) {
    // 140m 구역마다 주된 수종이 있고(같은 길의 가로수는 같은 종), 넷 중 하나는 다른 종이 섞인다
    const zone = pick(hash(Math.floor(t[0] / 140), Math.floor(t[1] / 140)));
    groups[r() < 0.25 ? pick(r()) : zone].push(t);
  }
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', 'attribute float aPaint;\nattribute vec3 aTint;\n#include <common>')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvColor.rgb *= mix(vec3(1.0), aTint, aPaint);');
  };
  const dummy = new THREE.Object3D(), c = new THREE.Color(), colliders = [];
  SPECIES.forEach((sp, k) => {
    const list = groups[k];
    if (!list.length) return;
    const g = sp.build(), tint = new Float32Array(list.length * 3);
    const m = new THREE.InstancedMesh(g, mat, list.length);
    list.forEach(([x, y, s], i) => {
      dummy.position.set(x, 0, -y); dummy.rotation.set(0, r() * 6.28, 0);
      const sw = s * (0.9 + r() * 0.2), sy = s * (0.85 + r() * 0.35);
      dummy.scale.set(sw, sy, sw); dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      c.set(sp.leaves[Math.floor(r() * sp.leaves.length)]).multiplyScalar(0.86 + r() * 0.28);
      tint[3 * i] = c.r; tint[3 * i + 1] = c.g; tint[3 * i + 2] = c.b;
      colliders.push({ k: 'cyl', x, z: -y, r: sp.trunk[0] * sw + 0.05, y0: 0, y1: sp.trunk[1] * sy },
        { k: 'leaf', x, z: -y, r: sp.crown[0] * sw, y0: sp.crown[1] * sy, y1: sp.crown[2] * sy, color: c.getHex() });
    });
    g.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
    m.castShadow = m.receiveShadow = true; m.frustumCulled = false;
    scene.add(m);
  });
  return { colliders, count: trees.length, species: SPECIES.map((s, k) => [s.name, groups[k].length]) };
}
