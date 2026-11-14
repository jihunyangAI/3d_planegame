// 드론 기체: 유선형 동체 + 덕트 팬 4개 + 착륙 스키드 + 후방 추진기.
// 기수는 -Z, 갑판(조종사가 서는 면)은 y=0.03. 움직이지 않는 부분은 재질별로 한 덩어리로 합쳐 둔다.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const UP = new THREE.Vector3(0, 1, 0);
export const ROTOR_AT = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => new THREE.Vector3(sx * 1.04, 0.05, sz * 1.04));

let GEO = null;                                    // 재질 이름 -> 합친 모양 (한 번만 만든다)
function build() {
  if (GEO) return GEO;
  const parts = { hull: [], dark: [], trim: [], glow: [], metal: [], navR: [], navG: [] };
  const add = (k, g) => { parts[k].push(g.index ? g.toNonIndexed() : g); return g; };
  const box = (k, w, h, l, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const g = new THREE.BoxGeometry(w, h, l);
    if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
    g.translate(x, y, z); return add(k, g);
  };
  // 두 점을 잇는 막대 (a 쪽 반지름 r0, b 쪽 r1)
  const rod = (k, a, b, r0, r1 = r0, seg = 8) => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), len = d.length();
    const g = new THREE.CylinderGeometry(r1, r0, len, seg);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()));
    g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2); return add(k, g);
  };
  const ball = (k, r, x, y, z) => { const g = new THREE.SphereGeometry(r, 10, 8); g.translate(x, y, z); return add(k, g); };
  const ring = (k, r, tube, x, y, z) => { const g = new THREE.TorusGeometry(r, tube, 6, 28); g.rotateX(Math.PI / 2); g.translate(x, y, z); return add(k, g); };

  // ----- 동체: 위에서 본 윤곽을 두께 방향으로 밀어 올리고 모서리를 깎는다 -----
  const outline = [[0, 1.26], [0.2, 1.1], [0.42, 0.62], [0.5, 0.05], [0.46, -0.55], [0.36, -0.9], [0.16, -1.02]];   // [x, -z] (기수가 위)
  const sh = new THREE.Shape();
  sh.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) sh.lineTo(outline[i][0], outline[i][1]);
  for (let i = outline.length - 1; i >= 1; i--) sh.lineTo(-outline[i][0], outline[i][1]);
  sh.closePath();
  const hull = new THREE.ExtrudeGeometry(sh, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.07, bevelSegments: 2, steps: 1 });
  hull.rotateX(-Math.PI / 2); hull.translate(0, -0.19, 0);            // 윗면이 y=0.03
  add('hull', hull);
  box('dark', 0.56, 0.016, 1.0, 0, 0.034, 0.12);                      // 갑판의 미끄럼 방지 패드
  for (const s of [-1, 1]) box('glow', 0.3, 0.012, 0.045, s * 0.12, 0.04, -0.6, 0, s * -0.6, 0);   // 갑판 앞 V 표식
  box('hull', 0.46, 0.14, 0.5, 0, 0.09, -0.88, 0.32);                 // 기수 덮개
  box('dark', 0.4, 0.12, 0.05, 0, 0.19, -0.66, -0.55);                // 바람막이
  box('dark', 0.5, 0.17, 1.15, 0, -0.335, 0.05);                      // 배 쪽 배터리 팩
  box('glow', 0.3, 0.02, 0.85, 0, -0.425, 0.05);                      // 바닥 발광 띠
  for (const s of [-1, 1]) {
    box('trim', 0.06, 0.13, 0.95, s * 0.52, -0.09, 0.02);             // 옆구리 장갑판
    box('glow', 0.012, 0.022, 0.85, s * 0.553, -0.05, 0.02);          // 옆구리 발광선
    box('dark', 0.03, 0.06, 0.3, s * 0.545, -0.12, -0.2);             // 흡기구
    box('glow', 0.1, 0.03, 0.03, s * 0.15, -0.11, -1.2);              // 전조등
    // 착륙 스키드
    rod('metal', [s * 0.38, -0.58, -0.7], [s * 0.38, -0.58, 0.78], 0.028);
    rod('metal', [s * 0.38, -0.58, -0.7], [s * 0.38, -0.49, -0.88], 0.028);
    rod('metal', [s * 0.3, -0.4, -0.42], [s * 0.38, -0.58, -0.46], 0.022);
    rod('metal', [s * 0.3, -0.4, 0.5], [s * 0.38, -0.58, 0.54], 0.022);
    // 후방 추진기
    rod('metal', [s * 0.2, -0.1, 0.9], [s * 0.2, -0.1, 1.22], 0.085, 0.1, 12);
    rod('glow', [s * 0.2, -0.1, 1.2], [s * 0.2, -0.1, 1.225], 0.075, 0.075, 12);
    box('dark', 0.24, 0.06, 0.2, s * 0.2, -0.02, 0.98);
    // 꼬리 날개
    box('hull', 0.03, 0.3, 0.36, s * 0.33, 0.15, 0.84, 0, 0, s * -0.35);
    box('trim', 0.034, 0.07, 0.36, s * 0.385, 0.285, 0.84, 0, 0, s * -0.35);
  }
  ball('dark', 0.1, 0, -0.3, -0.95);                                  // 기수 아래 카메라
  ball('glow', 0.042, 0, -0.32, -1.04);
  box('glow', 0.42, 0.03, 0.02, 0, -0.05, 1.07);                      // 꼬리등
  rod('metal', [0.12, 0.03, 0.95], [0.12, 0.5, 1.03], 0.01);          // 안테나
  ball('glow', 0.022, 0.12, 0.5, 1.03);

  // ----- 팔 + 모터 + 덕트 팬 틀 -----
  const duct = [[0.6, -0.1], [0.68, -0.1], [0.7, 0], [0.67, 0.1], [0.61, 0.1], [0.6, -0.1]].map(([r, y]) => new THREE.Vector2(r, y));
  for (const c of ROTOR_AT) {
    const sx = Math.sign(c.x), sz = Math.sign(c.z);
    rod('hull', [sx * 0.42, -0.1, sz * 0.5], [c.x * 0.93, c.y - 0.08, c.z * 0.93], 0.08, 0.055);       // 팔
    rod('glow', [sx * 0.46, -0.03, sz * 0.54], [c.x * 0.8, c.y - 0.015, c.z * 0.8], 0.013);             // 팔 위 발광선
    rod('metal', [c.x, c.y - 0.16, c.z], [c.x, c.y + 0.04, c.z], 0.13, 0.12, 12);                       // 모터
    rod('dark', [c.x, c.y - 0.12, c.z], [c.x, c.y - 0.09, c.z], 0.15, 0.15, 12);                        // 냉각 핀
    rod('dark', [c.x, c.y - 0.05, c.z], [c.x, c.y - 0.02, c.z], 0.15, 0.15, 12);
    const lathe = new THREE.LatheGeometry(duct, 28); lathe.translate(c.x, c.y, c.z); add('hull', lathe);  // 덕트
    ring('glow', 0.64, 0.013, c.x, c.y + 0.105, c.z);                                                   // 덕트 윗테 발광선
    ring('trim', 0.705, 0.02, c.x, c.y - 0.03, c.z);                                                    // 덕트 바깥 띠
    for (let k = 0; k < 3; k++) {                                                                       // 모터를 붙드는 살
      const a = k * 2.094 + 0.6;
      box('dark', 0.5, 0.025, 0.045, c.x + Math.cos(a) * 0.36, c.y - 0.06, c.z - Math.sin(a) * 0.36, 0, a, 0);
    }
    if (sz < 0) ball(sx < 0 ? 'navR' : 'navG', 0.04, c.x + sx * 0.5, c.y + 0.02, c.z - 0.5);            // 항법등: 왼쪽 빨강, 오른쪽 초록
  }
  GEO = {};
  for (const k in parts) GEO[k] = mergeGeometries(parts[k]);

  // ----- 프로펠러 (돌아가는 부분) -----
  const blades = [];
  for (let k = 0; k < 3; k++) {
    const b = new THREE.BoxGeometry(0.5, 0.014, 0.1);
    b.rotateX(0.24); b.translate(0.31, 0, 0); b.rotateY(k * 2.094);
    blades.push(b.toNonIndexed());
  }
  const cap = new THREE.ConeGeometry(0.06, 0.11, 10); cap.translate(0, 0.045, 0);
  blades.push(cap.toNonIndexed());
  GEO.blades = mergeGeometries(blades);
  GEO.disc = new THREE.CircleGeometry(0.58, 24); GEO.disc.rotateX(-Math.PI / 2);
  GEO.flame = new THREE.ConeGeometry(0.075, 0.7, 8); GEO.flame.rotateX(Math.PI / 2); GEO.flame.translate(0, 0, 0.35);   // 뒤(+Z)로 뻗는 불꽃
  return GEO;
}

const MATS = {};
function materials(accent, enemy) {
  const key = accent + (enemy ? 'e' : 'p');
  if (MATS[key]) return MATS[key];
  const std = (color, roughness, metalness, extra) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  return MATS[key] = {
    hull: std(enemy ? 0x33363c : 0xe6e9ec, 0.38, 0.55, { side: THREE.DoubleSide }),      // 아군은 흰 동체, 적은 검은 동체
    dark: std(0x1c1f24, 0.6, 0.45),
    trim: std(enemy ? 0x8c1d22 : 0xd9622a, 0.5, 0.35),
    glow: std(accent, 0.4, 0, { emissive: accent, emissiveIntensity: 1.7 }),
    metal: std(0x9aa0a6, 0.35, 0.85),
    navR: std(0xff3b30, 0.4, 0, { emissive: 0xff3b30, emissiveIntensity: 2 }),
    navG: std(0x2fe07a, 0.4, 0, { emissive: 0x2fe07a, emissiveIntensity: 2 }),
    disc: new THREE.MeshBasicMaterial({ color: 0xd8e4ee, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide }),
    flame: new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
  };
}

// group: 기체 전체, rotors: 돌릴 프로펠러 4개, flames: 부스트할 때 켜는 추진 불꽃
export function createDroneBody(accent, enemy) {
  const geo = build(), m = materials(accent, enemy);
  const group = new THREE.Group();
  for (const k of ['hull', 'dark', 'trim', 'glow', 'metal', 'navR', 'navG']) group.add(new THREE.Mesh(geo[k], m[k]));
  const rotors = ROTOR_AT.map(c => {
    const spin = new THREE.Group(); spin.position.set(c.x, c.y + 0.02, c.z);
    spin.add(new THREE.Mesh(geo.blades, m.dark), new THREE.Mesh(geo.disc, m.disc));
    group.add(spin);
    return spin;
  });
  const flames = new THREE.Group();
  for (const s of [-1, 1]) { const f = new THREE.Mesh(geo.flame, m.flame); f.position.set(s * 0.2, -0.1, 1.22); flames.add(f); }
  flames.visible = false;
  group.add(flames);
  return { group, rotors, flames };
}
