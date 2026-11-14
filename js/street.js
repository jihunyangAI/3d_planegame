// 거리 시설물: 신호등, 교통표지판, 방향 이정표, 도로명판, 지하철 출구 표지, 가로등 기둥.
// 지도 좌표 (x 동, y 북) -> three.js (x, 높이, -y). 충돌은 없다.
import * as THREE from 'three';
import { SIGNAL } from './roadgrid.js';

const POLE = 0x6b7076, DARK = 0x24272b;
const KFONT = '"Pretendard", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';

function canvasTex(w, h, draw) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

// 진행 방향(나침반 방위)에 따른 행선지
const DEST = [['연남동', 'Yeonnam-dong'], ['연희동', 'Yeonhui-dong'], ['신촌', 'Sinchon'], ['서강대교', 'Seogang Bridge'],
  ['상수', 'Sangsu'], ['합정', 'Hapjeong'], ['망원', 'Mangwon'], ['성산', 'Seongsan']];

export function buildStreet(scene, D, lampPos) {
  const group = new THREE.Group();
  scene.add(group);
  const std = o => new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.2, ...o });
  const face = map => new THREE.MeshBasicMaterial({ map, fog: true });
  const back = std({ color: 0x8b9096 });
  const dummy = new THREE.Object3D();
  const colliders = [];                             // 드론과 레이저가 부딪히는 것 (world.addProps 로 넘긴다)

  // ----- 기둥·가로대: 한 InstancedMesh 에 모은다 -----
  const bars = [];                                  // [x, y, z, sx, sy, sz, rotY, color]
  const bar = (x, y, z, sx, sy, sz, rot = 0, color = POLE) => bars.push([x, y, z, sx, sy, sz, rot, color]);
  const pole = (x, z, h, r = 0.09, color = POLE) => bar(x, h / 2, z, r * 2, h, r * 2, 0, color);
  // 표지판 면이 바라볼 방향: 지도상 진행 방향 (ux,uy) 으로 오는 차를 마주 본다
  const facing = (ux, uy) => Math.atan2(-ux, uy);

  // ----- 표지판 그림 -----
  const speed = n => canvasTex(128, 128, (g) => {
    g.fillStyle = '#fff'; g.beginPath(); g.arc(64, 64, 62, 0, 7); g.fill();
    g.strokeStyle = '#d6201f'; g.lineWidth = 15; g.beginPath(); g.arc(64, 64, 53, 0, 7); g.stroke();
    g.fillStyle = '#111'; g.font = 'bold 62px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(n, 64, 68);
  });
  const noPark = canvasTex(128, 128, (g) => {
    g.fillStyle = '#1f55b5'; g.beginPath(); g.arc(64, 64, 62, 0, 7); g.fill();
    g.strokeStyle = '#d6201f'; g.lineWidth = 13; g.beginPath(); g.arc(64, 64, 54, 0, 7); g.stroke();
    g.beginPath(); g.moveTo(27, 27); g.lineTo(101, 101); g.stroke();
  });
  const crossSign = canvasTex(128, 128, (g) => {       // 횡단보도: 파란 바탕에 흰 삼각형과 보행자
    g.fillStyle = '#1f55b5'; roundRect(g, 2, 2, 124, 124, 10); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(64, 14); g.lineTo(116, 108); g.lineTo(12, 108); g.closePath(); g.fill();
    g.fillStyle = '#111'; g.beginPath(); g.arc(64, 46, 8, 0, 7); g.fill();
    g.lineWidth = 8; g.strokeStyle = '#111'; g.lineCap = 'round';
    g.beginPath(); g.moveTo(64, 56); g.lineTo(62, 80); g.lineTo(50, 100); g.moveTo(62, 80); g.lineTo(76, 100); g.moveTo(50, 70); g.lineTo(64, 62); g.lineTo(78, 72); g.stroke();
  });
  const signTypes = {
    s50: { tex: speed('50'), round: true, list: [] }, s30: { tex: speed('30'), round: true, list: [] },
    nopark: { tex: noPark, round: true, list: [] }, cross: { tex: crossSign, round: false, list: [] },
  };
  // 기둥 + 표지판 하나. (x,y) 지도 좌표, rot 은 면의 방향
  const sign = (type, x, y, rot, h = 2.9) => { pole(x, -y, h + 0.35, 0.05); signTypes[type].list.push([x, h, -y, rot]); };

  // ----- 신호등 -----
  const heads = [], lamps = { r: [[], []], y: [[], []], g: [[], []] };
  function signal(x, y, ux, uy, w, grp) {            // (ux,uy) 방향으로 달리는 차를 위한 신호등
    const nx = -uy, ny = ux, rot = facing(ux, uy);
    const px = x - ux * 5 - nx * (w / 2 + 1.3), py = y - uy * 5 - ny * (w / 2 + 1.3);       // 진행 방향 오른쪽 길가
    const arm = Math.min(w / 2 - 0.5, 7.5), H = 6.4;
    pole(px, -py, H + 0.3, 0.11);
    bar(px + nx * arm / 2, H, -(py + ny * arm / 2), arm, 0.14, 0.14, Math.atan2(ny, nx));
    for (const k of [0.45, 1]) {                    // 가로대 중간과 끝에 등 뭉치
      const hx = px + nx * arm * k, hy = py + ny * arm * k;
      heads.push([hx, H - 0.05, -hy, rot]);
      ['r', 'y', 'g'].forEach((c, i) => {           // 가로형: 왼쪽부터 빨강·노랑·초록
        const o = (i - 1) * 0.4;
        lamps[c][grp].push([hx - nx * o - ux * 0.17, H - 0.05, -(hy - ny * o - uy * 0.17), rot]);
      });
    }
    sign('cross', px - ux * 1.2, py - uy * 1.2, rot, 2.6);
  }
  D.crossings.forEach(([x, y, ux, uy, w], i) => {
    if (w < 10) { sign('cross', x - ux * 3 + uy * (w / 2 + 1), y - uy * 3 - ux * (w / 2 + 1), facing(ux, uy)); return; }
    signal(x, y, ux, uy, w, i % 2);
    signal(x, y, -ux, -uy, w, i % 2);
  });

  // ----- 길을 따라: 제한속도, 주정차 금지, 방향 이정표, 도로명판 -----
  const guides = [], plates = new Map();
  for (const [grp, w, name, f, oneway] of D.roads) {
    if (grp > 3) continue;
    let len = 0; const n = f.length / 2;
    for (let i = 0; i < n - 1; i++) len += Math.hypot(f[2 * i + 2] - f[2 * i], f[2 * i + 3] - f[2 * i + 1]);
    if (len < 60) continue;
    // 길 위의 거리 s 인 점과 방향
    const at = s => {
      for (let i = 0; i < n - 1; i++) {
        const dx = f[2 * i + 2] - f[2 * i], dy = f[2 * i + 3] - f[2 * i + 1], L = Math.hypot(dx, dy);
        if (s <= L || i === n - 2) { const t = Math.min(1, s / (L || 1)); return [f[2 * i] + dx * t, f[2 * i + 1] + dy * t, dx / (L || 1), dy / (L || 1)]; }
        s -= L;
      }
    };
    const side = w / 2 + (grp <= 2 ? 1.5 : 0.7);
    const put = (type, s, dir) => {                 // dir: +1 이면 진행 방향, -1 이면 반대편 차로용
      const [x, y, ux, uy] = at(s);
      sign(type, x + uy * side * dir, y - ux * side * dir, facing(ux * dir, uy * dir));
    };
    if (grp <= 2) {
      for (let s = 40; s < len - 20; s += 260) { put('s50', s, 1); if (!oneway) put('s50', Math.min(len - 5, s + 130), -1); }
      for (let s = 150; s < len - 20; s += 310) put('nopark', s, 1);
    } else if (len > 110 && plates.size % 3 === 0) put('s30', 12, 1);
    if (grp <= 1 && w >= 24 && len > 150) {
      for (let s = 90, k = 0; s < len - 60; s += 330, k++) {
        guides.push([...at(s), w, name, 1]);
        if (!oneway) guides.push([...at(Math.min(len - 30, s + 165)), w, name, -1]);
      }
    }
    if (name && len > 80) {                         // 도로명판: 이름마다 가장 긴 구간의 양 끝에
      const cur = plates.get(name);
      if (!cur || cur.len < len) plates.set(name, { len, a: at(8), b: at(len - 8), side });
    }
  }

  // 방향 이정표 (초록 바탕 흰 글씨, 길 위로 뻗은 외팔 기둥)
  const guideGeo = new THREE.BoxGeometry(6.4, 2.5, 0.12);
  for (const [x, y, ux0, uy0, w, name, dir] of guides.slice(0, 40)) {
    const ux = ux0 * dir, uy = uy0 * dir, nx = -uy, ny = ux, rot = facing(ux, uy);
    const px = x - nx * (w / 2 + 1.6), py = y - ny * (w / 2 + 1.6), H = 7.6, arm = 6.2;
    pole(px, -py, H + 1.3, 0.16);
    bar(px + nx * arm / 2, H + 1.0, -(py + ny * arm / 2), arm, 0.18, 0.18, Math.atan2(ny, nx));
    bar(px + nx * arm / 2, H - 0.9, -(py + ny * arm / 2), arm, 0.14, 0.14, Math.atan2(ny, nx));
    const sector = Math.round(((Math.atan2(ux, uy) * 180 / Math.PI + 360) % 360) / 45) % 8;
    const ahead = DEST[sector], right = DEST[(sector + 2) % 8];
    const tex = canvasTex(512, 200, (g, W, Hh) => {
      g.fillStyle = '#0c6a3d'; roundRect(g, 0, 0, W, Hh, 14); g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 6; roundRect(g, 7, 7, W - 14, Hh - 14, 10); g.stroke();
      g.fillStyle = '#fff'; g.textBaseline = 'middle';
      g.font = `bold 74px ${KFONT}`; g.textAlign = 'left'; g.fillText('↑', 26, 78);
      g.font = `bold 62px ${KFONT}`; g.fillText(ahead[0], 92, 72);
      g.font = '26px Arial'; g.fillText(ahead[1], 94, 122);
      g.fillRect(292, 24, 3, Hh - 48);
      g.font = `bold 40px ${KFONT}`; g.fillText(right[0] + ' →', 310, 66);
      g.font = '20px Arial'; g.fillText(right[1], 312, 100);
      if (name) { g.fillStyle = '#ffe37a'; g.font = `bold 30px ${KFONT}`; g.fillText(name, 310, 152); }
    });
    const m = new THREE.Mesh(guideGeo, [back, back, back, back, face(tex), back]);
    m.position.set(px + nx * (arm - 3.0), H, -(py + ny * (arm - 3.0))); m.rotation.y = rot;
    group.add(m);
    colliders.push({ k: 'box', x: m.position.x, y: H, z: m.position.z, hx: 3.2, hy: 1.25, hz: 0.12, rot });
  }

  // 도로명판 (파란 바탕, 앞뒤 양면)
  const plateGeo = new THREE.BoxGeometry(1.7, 0.46, 0.05);
  let pc = 0;
  for (const [name, { a, b, side }] of plates) {
    if (pc >= 90) break;
    const tex = canvasTex(256, 70, (g, W, H) => {
      g.fillStyle = '#1d4e9e'; roundRect(g, 0, 0, W, H, 10); g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 3; roundRect(g, 4, 4, W - 8, H - 8, 7); g.stroke();
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      let size = 36; g.font = `bold ${size}px ${KFONT}`;
      while (g.measureText(name).width > W - 70 && size > 16) { size -= 2; g.font = `bold ${size}px ${KFONT}`; }
      g.fillText(name, W / 2 - 14, H / 2 + 2);
      g.font = 'bold 30px Arial'; g.fillText('→', W - 30, H / 2 + 1);
    });
    const mat = face(tex);
    for (const [x, y, ux, uy] of [a, b]) {
      const px = x + uy * side, py = y - ux * side;
      pole(px, -py, 3.4, 0.045);
      const m = new THREE.Mesh(plateGeo, [back, back, back, back, mat, mat]);
      m.position.set(px, 3.15, -py); m.rotation.y = Math.atan2(uy, ux) + Math.PI / 2;      // 길을 가로질러 달아, 오가는 쪽 모두에서 읽힌다
      group.add(m);
      pc++;
    }
  }

  // ----- 지하철 출구 표지 -----
  const exitGeo = new THREE.BoxGeometry(1.0, 1.25, 0.3);
  const station = (D.stations[0] && D.stations[0][2]) || '홍대입구';
  for (const [x, y, ref] of D.exits) {
    const tex = canvasTex(160, 200, (g, W, H) => {
      g.fillStyle = '#16233f'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#f5c518'; g.fillRect(0, 0, W, 16); g.fillRect(0, H - 16, W, 16);
      g.beginPath(); g.arc(W / 2, 86, 46, 0, 7); g.fill();
      g.fillStyle = '#16233f'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold 62px Arial'; g.fillText(ref || '·', W / 2, 90);
      g.fillStyle = '#fff'; g.font = `bold 24px ${KFONT}`; g.fillText(station, W / 2, 160);
    });
    const mat = face(tex), side = std({ color: 0xf5c518 });
    pole(x, -y, 3.0, 0.1, 0x30343a);
    const m = new THREE.Mesh(exitGeo, [side, side, side, side, mat, mat]);
    m.position.set(x, 3.4, -y); m.rotation.y = (ref ? +ref : 0) * 0.7;
    group.add(m);
    colliders.push({ k: 'box', x, y: 3.4, z: -y, hx: 0.5, hy: 0.63, hz: 0.16, rot: m.rotation.y });
  }

  // ----- 가로등 기둥 -----
  for (let i = 0; i < lampPos.length; i += 3) {
    const h = lampPos[i + 1];
    pole(lampPos[i], lampPos[i + 2], h, 0.07, 0x565a60);
    bar(lampPos[i], h + 0.06, lampPos[i + 2], 0.7, 0.12, 0.28, (i * 0.37) % 3.14, 0x3c4046);
  }

  // 기둥은 세로 원기둥, 긴 가로대는 상자로 부딪힌다 (가로등 머리 같은 작은 것은 뺀다)
  for (const [x, y, z, sx, sy, sz, rot] of bars) {
    if (sx === sz && sy > 1) colliders.push({ k: 'cyl', x, z, r: Math.max(sx / 2, 0.08), y0: y - sy / 2, y1: y + sy / 2 });
    else if (sx > 1.5) colliders.push({ k: 'box', x, y, z, hx: sx / 2, hy: Math.max(sy / 2, 0.1), hz: Math.max(sz / 2, 0.1), rot });
  }
  for (const [x, y, z, rot] of heads) colliders.push({ k: 'box', x, y, z, hx: 0.68, hy: 0.23, hz: 0.15, rot });

  // ----- 인스턴스 메시로 굽기 -----
  {
    const m = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), std({}), bars.length), c = new THREE.Color();
    bars.forEach(([x, y, z, sx, sy, sz, rot, color], i) => {
      dummy.position.set(x, y, z); dummy.rotation.set(0, rot, 0); dummy.scale.set(sx, sy, sz); dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix); m.setColorAt(i, c.set(color));
    });
    group.add(m);
  }
  dummy.scale.set(1, 1, 1);
  const place = (mesh, list) => {
    list.forEach(([x, y, z, rot], i) => { dummy.position.set(x, y, z); dummy.rotation.set(0, rot, 0); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); });
    group.add(mesh);
    return mesh;
  };
  const discGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.04, 24); discGeo.rotateX(Math.PI / 2);    // 둥근 표지의 뒤판
  const discFace = new THREE.CircleGeometry(0.355, 24); discFace.translate(0, 0, 0.022);             // 앞면 (+Z)
  const sqGeo = new THREE.BoxGeometry(0.72, 0.72, 0.04);
  for (const k in signTypes) {
    const t = signTypes[k];
    if (!t.list.length) continue;
    if (t.round) { place(new THREE.InstancedMesh(discGeo, back, t.list.length), t.list); place(new THREE.InstancedMesh(discFace, face(t.tex), t.list.length), t.list); }
    else place(new THREE.InstancedMesh(sqGeo, [back, back, back, back, face(t.tex), back], t.list.length), t.list);
  }
  place(new THREE.InstancedMesh(new THREE.BoxGeometry(1.35, 0.46, 0.3), std({ color: DARK }), heads.length), heads);
  const lampGeo = new THREE.CircleGeometry(0.15, 16);
  const ON = { r: 0xff3b30, y: 0xffc21a, g: 0x2fe07a }, OFF = { r: 0x3a1210, y: 0x3a2c08, g: 0x0d2f1c };
  const lampMats = {};
  for (const c of ['r', 'y', 'g']) lampMats[c] = [0, 1].map(grp => {
    const mat = new THREE.MeshBasicMaterial({ color: OFF[c], fog: false });
    if (lamps[c][grp].length) place(new THREE.InstancedMesh(lampGeo, mat, lamps[c][grp].length), lamps[c][grp]);
    return mat;
  });

  // 신호 주기: 두 무리가 번갈아 초록 → 노랑 → 빨강
  let t = 0;
  function update(dt) {
    SIGNAL.t = (SIGNAL.t + dt) % 40;                  // 차와 보행자도 이 시각을 보고 움직인다
    for (const grp of [0, 1]) {
      const on = SIGNAL.car(grp);
      for (const c of ['r', 'y', 'g']) lampMats[c][grp].color.set(c === on ? ON[c] : OFF[c]);
    }
  }
  update(0);
  return { update, colliders };
}
