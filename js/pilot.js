// 조종사와 레이저총.
// 조종사: assets/character 의 앞·뒤 그림을 몸 부위별 입체에 투영해 입힌다 (앞을 보는 면은 앞 그림, 뒤를 보는 면은 뒤 그림).
// 부위는 관절로 이어져 있어서 드론 위에 올라선 사격 자세로 꺾을 수 있다.
// 총: assets/gun 의 그림을 보고 상자로 조립했다. 모두 -Z 가 앞.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// 원본 그림(1536x1024)에서 잰 값. tools/build_assets.py 와 맞아야 한다.
const IMG = { cxFront: 408, cxBack: 1096, half: 205, sole: 985, top: 25, h: 1024 };
const HEIGHT = 1.62;                               // 키 (m)
const SCALE = 1.3;                                 // 주인공이 잘 보이도록 실제보다 크게 그린다
const S = HEIGHT / (IMG.sole - IMG.top);           // 그림 1픽셀 = S 미터
// 앞 그림의 픽셀 좌표 -> 몸 좌표 (캐릭터의 오른쪽이 +X, 위가 +Y, 앞이 -Z)
const P = (px, py, z = 0) => new THREE.Vector3(-(px - IMG.cxFront) * S, (IMG.sole - py) * S, z);

let texture = null;
function pilotTexture() {
  if (!texture) {
    texture = new THREE.TextureLoader().load('assets/game/pilot.jpg');
    texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  }
  return texture;
}

// 삼각형마다 앞·뒤 그림 중 하나를 골라 UV 를 매긴다 (몸 좌표 기준 정투영)
// axis: 그 부위의 중심축 [a, b]. 표면 점을 축 쪽으로 조금 당겨서 읽어, 윤곽 바깥의 번진 색이 옆면에 묻지 않게 한다.
function project(geo, axis) {
  const g = geo.index ? geo.toNonIndexed() : geo, p = g.attributes.position, uv = new Float32Array(p.count * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  const ad = axis[1].clone().sub(axis[0]), al = ad.lengthSq() || 1, KEEP = 0.8;
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    n.copy(b).sub(a).cross(c.sub(a));
    const front = n.z < 0;
    for (let k = 0; k < 3; k++) {
      let x = p.getX(i + k), y = p.getY(i + k);
      const t = THREE.MathUtils.clamp(((x - axis[0].x) * ad.x + (y - axis[0].y) * ad.y) / al, 0, 1);
      const ax = axis[0].x + ad.x * t, ay = axis[0].y + ad.y * t;
      x = ax + (x - ax) * KEEP; y = ay + (y - ay) * KEEP;
      const px = front ? IMG.cxFront - x / S : IMG.cxBack + x / S, py = IMG.sole - y / S;
      const u = THREE.MathUtils.clamp((px - ((front ? IMG.cxFront : IMG.cxBack) - IMG.half)) / (2 * IMG.half), 0.004, 0.996);
      uv[2 * (i + k)] = (front ? 0 : 0.5) + u * 0.5;
      uv[2 * (i + k) + 1] = 1 - py / IMG.h;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
// 두 점을 잇는 캡슐 (팔다리)
function limb(a, b, r0, r1 = r0) {
  const d = b.clone().sub(a), len = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, 10, 1);       // 위(+Y)가 b 쪽
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}
function ball(c, rx, ry, rz) { const g = new THREE.SphereGeometry(1, 14, 10); g.scale(rx, ry, rz); g.translate(c.x, c.y, c.z); return g; }
// 타원 단면 기둥 (몸통): y0~y1, 아래 반폭 w0 → 위 반폭 w1, 반두께 d
function trunk(y0, y1, w0, w1, d) { const g = new THREE.CylinderGeometry(w1, w0, y1 - y0, 14, 2); g.scale(1, 1, d / Math.max(w0, w1)); g.translate(0, (y0 + y1) / 2, 0); return g; }

// 재질은 모든 드론이 함께 쓴다
const M = {};
function mats() {
  if (!M.metal) {
    M.metal = new THREE.MeshStandardMaterial({ color: 0x3b3e42, roughness: 0.55, metalness: 0.6 });
    M.orange = new THREE.MeshStandardMaterial({ color: 0xd9622a, roughness: 0.6, metalness: 0.25 });
    M.glow = new THREE.MeshStandardMaterial({ color: 0x35e0c8, emissive: 0x35e0c8, emissiveIntensity: 1.8, roughness: 0.3 });
    M.hair = new THREE.MeshStandardMaterial({ color: 0xb23a1c, roughness: 0.9 });
    M.boot = new THREE.MeshStandardMaterial({ color: 0x35363a, roughness: 0.8 });
    M.sole = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.9 });
    M.helm = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.4, metalness: 0.5 });
    M.visor = new THREE.MeshStandardMaterial({ color: 0xff3b30, emissive: 0xff3b30, emissiveIntensity: 1.6 });
    M.body = new THREE.MeshStandardMaterial({ map: pilotTexture(), roughness: 0.85, metalness: 0 });
    M.enemyBody = new THREE.MeshStandardMaterial({ map: pilotTexture(), roughness: 0.85, metalness: 0, color: 0xffa59a });
  }
  return M;
}

let rifleGeo = null;                               // 재질별로 합친 총 모양 (한 번만 만든다)
function rifleParts() {
  if (rifleGeo) return rifleGeo;
  const parts = { metal: [], orange: [], glow: [] };
  const box = (w, h, l, x, y, z, mat, rx = 0) => { const g = new THREE.BoxGeometry(w, h, l); if (rx) g.rotateX(rx); g.translate(x, y, z); parts[mat].push(g); };
  box(0.085, 0.12, 0.40, 0, 0, -0.02, 'metal');                     // 몸체
  const cell = new THREE.CylinderGeometry(0.055, 0.055, 0.15, 12); cell.rotateX(Math.PI / 2); cell.translate(0, 0.005, -0.03); parts.glow.push(cell.toNonIndexed());   // 에너지 셀
  box(0.1, 0.13, 0.03, 0, 0, 0.06, 'metal'); box(0.1, 0.13, 0.03, 0, 0, -0.12, 'metal');   // 셀을 물고 있는 고리
  box(0.08, 0.105, 0.36, 0, 0.005, -0.38, 'metal');                 // 총열 덮개
  box(0.092, 0.07, 0.22, 0, 0.02, -0.29, 'orange');                 // 주황 장갑판 (위)
  box(0.092, 0.035, 0.2, 0, -0.045, -0.36, 'orange');               // 주황 장갑판 (아래)
  for (let i = 0; i < 3; i++) box(0.086, 0.012, 0.035, 0, 0.005, -0.44 - i * 0.05, 'glow');   // 청록 슬릿
  box(0.1, 0.12, 0.07, 0, 0.005, -0.59, 'metal');                   // 총구 뭉치
  box(0.07, 0.085, 0.012, 0, 0.005, -0.628, 'glow');                // 총구 발광면
  box(0.04, 0.02, 0.42, 0, 0.07, -0.12, 'metal');                   // 위 레일
  box(0.05, 0.065, 0.085, 0, 0.115, -0.02, 'metal'); box(0.052, 0.03, 0.05, 0, 0.1, 0.0, 'orange'); box(0.036, 0.04, 0.008, 0, 0.122, -0.064, 'glow');   // 조준경
  box(0.055, 0.075, 0.24, 0, -0.005, 0.29, 'metal');                // 개머리판 뼈대
  box(0.07, 0.15, 0.05, 0, -0.03, 0.43, 'metal'); box(0.074, 0.06, 0.14, 0, 0.045, 0.34, 'orange'); box(0.074, 0.035, 0.055, 0, -0.1, 0.43, 'orange');   // 견착부 + 주황 패드
  box(0.05, 0.15, 0.065, 0, -0.125, 0.11, 'metal', 0.3); box(0.054, 0.03, 0.07, 0, -0.195, 0.132, 'orange', 0.3);   // 권총 손잡이
  box(0.02, 0.012, 0.11, 0, -0.085, 0.03, 'metal');                 // 방아쇠울
  rifleGeo = {};
  for (const k in parts) rifleGeo[k] = mergeGeometries(parts[k].map(g => g.index ? g.toNonIndexed() : g));
  return rifleGeo;
}
export function createRifle() {
  const g = new THREE.Group(), geo = rifleParts(), m = mats();
  for (const k in geo) g.add(new THREE.Mesh(geo[k], m[k]));
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.005, -0.66); g.add(muzzle);
  return { root: g, muzzle };
}

// enemy: 붉은 기가 도는 옷 + 머리 대신 헬멧 (아군과 구분)
export function createPilot({ enemy = false } = {}) {
  const MT = mats(), mat = enemy ? MT.enemyBody : MT.body;
  const root = new THREE.Group();
  const bootMat = MT.boot, soleMat = MT.sole, tabMat = MT.orange;
  // 관절: pivot 을 중심으로 도는 그룹. geos 는 기준 자세(그림 속 A자 자세)의 몸 좌표로 만든 입체들.
  const joint = (parent, pivot, parentPivot, geos, axis) => {
    const j = new THREE.Group(); j.position.copy(pivot).sub(parentPivot);
    for (const geo of geos) { const g = project(geo, axis); g.translate(-pivot.x, -pivot.y, -pivot.z); j.add(new THREE.Mesh(g, mat)); }
    parent.add(j);
    return j;
  };
  const O = new THREE.Vector3();
  const hipC = P(408, 545), waist = P(408, 440), neck = P(408, 172);
  const MID = [P(408, 985), P(408, 25)];             // 몸 한가운데 세로축
  const hips = joint(root, hipC, O, [trunk(P(0, 575).y, P(0, 432).y, 0.132, 0.114, 0.094)], MID);
  const spine = joint(hips, waist, hipC, [trunk(waist.y - 0.01, P(0, 222).y, 0.112, 0.15, 0.098), trunk(P(0, 228).y, P(0, 160).y, 0.05, 0.043, 0.045)], MID);
  const head = joint(spine, neck, waist, [ball(P(402, 98, -0.005), 0.1, 0.124, 0.108)], [P(402, 170), P(402, 25)]);
  if (enemy) {
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.128, 16, 12), MT.helm);
    helm.position.set(0, P(0, 92).y - neck.y, 0); helm.scale.set(1, 1.08, 1.08); head.add(helm);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.055, 0.06), MT.visor);
    visor.position.set(0, P(0, 100).y - neck.y, -0.105); head.add(visor);
  } else {                                         // 삐죽 솟은 붉은 머리
    const tufts = [], hy = P(0, 98).y - neck.y;
    const spikes = [[0, 0.115, -0.05, -0.5, 0], [0.045, 0.118, -0.02, -0.3, -0.35], [-0.045, 0.118, -0.02, -0.3, 0.35], [0, 0.125, 0.02, 0.1, 0], [0.05, 0.11, 0.04, 0.3, -0.4], [-0.05, 0.11, 0.04, 0.3, 0.4], [0.02, 0.12, -0.075, -0.85, -0.15], [-0.03, 0.117, -0.07, -0.8, 0.2]];
    for (const [x, y, z, rx, rz] of spikes) {
      const c = new THREE.ConeGeometry(0.034, 0.1, 6);
      c.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, 0, rz))); c.translate(x, hy + y, z);
      tufts.push(c.toNonIndexed());
    }
    const cap = new THREE.SphereGeometry(0.097, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.42);
    cap.scale(1, 1.05, 1.08); cap.translate(0, hy + 0.03, 0.004);
    tufts.push(cap.toNonIndexed());
    head.add(new THREE.Mesh(mergeGeometries(tufts), MT.hair));
  }
  // 팔: side = +1 캐릭터 오른팔(+X, 앞 그림의 왼쪽), -1 왼팔
  const arm = side => {
    const m = px => IMG.cxFront - side * (IMG.cxFront - px);       // 왼팔은 좌우 대칭 위치
    const sh = P(m(322), 245), el = P(m(287), 385), wr = P(m(247), 465), hd = P(m(243), 510);
    const upper = joint(spine, sh, waist, [limb(sh, el, 0.058, 0.05), ball(sh, 0.064, 0.06, 0.064)], [sh, el]);
    const fore = joint(upper, el, sh, [limb(el, wr, 0.048, 0.034)], [el, wr]);
    const hand = joint(fore, wr, el, [ball(hd, 0.04, 0.052, 0.034)], [wr, hd]);
    return { upper, fore, hand };
  };
  const leg = side => {
    const m = px => IMG.cxFront - side * (IMG.cxFront - px);
    const hp = P(m(356), 545), kn = P(m(358), 690), an = P(m(331), 850);
    const thigh = joint(hips, hp, hipC, [limb(hp, kn, 0.09, 0.066)], [hp, kn]);
    const shin = joint(thigh, kn, hp, [limb(kn, an, 0.064, 0.046)], [kn, an]);
    // 군화: 그림 대신 단색으로 (짙은 회색 + 밑창 + 주황 끈 고리)
    const foot = joint(shin, an, kn, [], [kn, an]);
    const bx = P(m(329), 0).x - an.x;
    const bootPart = (w, h, l, y, z, mt) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mt); b.position.set(bx, y - an.y + h / 2, z); foot.add(b); };
    bootPart(0.1, 0.2, 0.15, 0.03, 0.01, bootMat); bootPart(0.1, 0.1, 0.14, 0.03, -0.12, bootMat);
    bootPart(0.108, 0.035, 0.3, 0, -0.045, soleMat); bootPart(0.03, 0.05, 0.012, 0.17, -0.066, tabMat);
    return { thigh, shin, foot };
  };
  const R = arm(1), L = arm(-1), legR = leg(1), legL = leg(-1);

  // ----- 사격 자세: 무릎을 굽혀 드론 위에 서고, 총을 오른쪽 어깨에 견착 -----
  const bendT = 0.62, bendS = -1.12;
  for (const [lg, s] of [[legR, 1], [legL, -1]]) {
    lg.thigh.rotation.set(bendT + (s < 0 ? 0.22 : -0.1), 0, s * -0.1);   // 왼발을 조금 앞으로
    lg.shin.rotation.x = bendS;
    lg.foot.rotation.x = -(bendT + bendS) - (s < 0 ? 0.22 : -0.1);       // 발바닥은 수평
  }
  const LEAN = -0.22;
  spine.rotation.x = LEAN;
  head.rotation.x = 0.16;
  // 오른팔: 팔꿈치를 굽혀 손잡이를 쥔다. 왼팔: 앞으로 뻗어 총열 덮개를 받친다.
  R.upper.rotation.set(0.55, 0, -0.42); R.fore.rotation.set(1.75, 0, -0.35); R.hand.rotation.set(0.2, 0, 0);
  L.upper.rotation.set(1.25, 0, 0.62); L.fore.rotation.set(0.75, 0, 0.5); L.hand.rotation.set(0.2, 0, 0);
  const rifle = createRifle();
  rifle.root.scale.setScalar(0.92);
  rifle.root.position.set(0.085, P(0, 262).y - waist.y, -0.33);
  rifle.root.rotation.x = -LEAN;
  spine.add(rifle.root);

  // 발바닥이 y=0 에 닿도록 골반 높이를 맞춘다
  const thighLen = P(0, 545).y - P(0, 690).y, shinLen = P(0, 690).y - P(0, 850).y, ankle = P(0, 850).y;
  hips.position.y = thighLen * Math.cos(bendT) + shinLen * Math.cos(bendT + bendS) + ankle;
  hips.position.z = 0.02;
  root.scale.setScalar(SCALE);

  return {
    root, muzzle: rifle.muzzle,
    // 조준 높낮이에 맞춰 상체(와 총)를 숙이거나 젖힌다
    setPitch(p) {
      p = THREE.MathUtils.clamp(p, -0.7, 0.7);
      spine.rotation.x = LEAN + p * 0.85;
      rifle.root.rotation.x = p - spine.rotation.x;      // 상체가 숙여져 있어도 총은 조준선과 나란히
    },
  };
}
