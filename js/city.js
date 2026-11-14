// 지도 데이터(MAP_DATA)로 도시 장면을 만든다. viewer.html 지도 뷰어의 렌더링을 게임용으로 옮긴 것.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { buildTraffic } from './cars.js';
import { makeAsphaltTest } from './roadgrid.js';
import { buildTrees } from './trees.js';

const { smoothstep, lerp, clamp } = THREE.MathUtils;

// 결정적 난수 (건물마다 항상 같은 모양이 나오도록)
export function rng(seed) { let s = (seed * 2654435761) >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pickFrom = (arr, r) => arr[Math.min(arr.length - 1, Math.floor(r * arr.length))];

function centroid(f) { let x = 0, y = 0; const n = f.length / 2; for (let i = 0; i < n; i++) { x += f[2 * i]; y += f[2 * i + 1]; } return [x / n, y / n]; }
function signedArea(f) { let a = 0; const n = f.length / 2; for (let i = 0; i < n; i++) { const j = (i + 1) % n; a += f[2 * i] * f[2 * j + 1] - f[2 * j] * f[2 * i + 1]; } return a / 2; }
const areaOf = f => Math.abs(signedArea(f));
function inPoly(x, y, f) {
  let inside = false; const n = f.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = f[2 * i], yi = f[2 * i + 1], xj = f[2 * j], yj = f[2 * j + 1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const PARAPET = (H, area) => (H > 6 && area > 40 ? 0.9 : 0.3);   // 지붕 난간 높이 (충돌 판정과 공유)

// 지도 좌표(x=동, y=북, 미터) -> three.js (x, 높이, -y)
export function buildCity(scene, renderer, D) {
  const R = D.radius;

  // ---------- 조명 · 하늘 ----------
  scene.fog = new THREE.Fog(0xc4d0db, 500, 3200);
  const hemi = new THREE.HemisphereLight(0xdfeaff, 0x8a8478, 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3e0, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -1150, right: 1150, top: 1150, bottom: -1150, near: 100, far: 5200 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.5;
  scene.add(sun);
  // 도시는 움직이지 않으므로 그림자 지도는 시간대를 바꿀 때 한 번만 굽는다
  renderer.shadowMap.autoUpdate = false;

  const sky = new Sky();
  sky.scale.setScalar(40000);
  scene.add(sky);
  const envSky = new Sky();           // 유리창 반사용 환경맵을 굽는 데 쓰는 사본
  envSky.scale.setScalar(40000);
  const envScene = new THREE.Scene();
  envScene.add(envSky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT = null;

  // ---------- 지면 ----------
  const lotTrees = [];                               // 빈터 잔디밭에 심는 나무 (아래 나무 단계에서 함께 그린다)
  const outerMat = new THREE.MeshBasicMaterial({ color: 0xb7c6d6, fog: false });
  {
    const outer = new THREE.Mesh(new THREE.RingGeometry(R + 5, 30000, 96, 1), outerMat);
    outer.rotation.x = -Math.PI / 2; outer.position.y = -0.8;
    scene.add(outer);
    // 지면 그림(1픽셀 ≈ 1m): 온통 잔디로 칠한 뒤 건물 둘레 6m 와 도로 주변을 포장 색으로 덮는다.
    // 그러면 건물도 길도 없는 넓은 빈터만 잔디로 남는다.
    const GS = 2048, gk = GS / (2 * R), rg = rng(77);
    const gcv = document.createElement('canvas'); gcv.width = gcv.height = GS;
    const gx = gcv.getContext('2d', { willReadFrequently: true });
    gx.fillStyle = '#6a9552'; gx.fillRect(0, 0, GS, GS);
    for (let i = 0; i < 9000; i++) {                 // 잔디의 얼룩
      gx.fillStyle = `rgba(${40 + rg() * 70 | 0},${105 + rg() * 60 | 0},${35 + rg() * 40 | 0},0.22)`;
      gx.beginPath(); gx.arc(rg() * GS, rg() * GS, 1 + rg() * 6, 0, 7); gx.fill();
    }
    gx.setTransform(gk, 0, 0, -gk, GS / 2, GS / 2);  // 지도 좌표 (x 동, y 북)
    gx.lineJoin = gx.lineCap = 'round';
    gx.fillStyle = gx.strokeStyle = '#b4b0a7';
    gx.lineWidth = 12;
    for (const b of D.buildings) {
      const f = b[3];
      gx.beginPath(); gx.moveTo(f[0], f[1]); for (let i = 2; i < f.length; i += 2) gx.lineTo(f[i], f[i + 1]); gx.closePath();
      gx.fill(); gx.stroke();
    }
    for (const [grp, w, , f] of D.roads) {
      gx.lineWidth = grp <= 2 ? w + 10 : grp === 3 || grp === 5 ? w + 5 : w + 3;
      gx.beginPath(); gx.moveTo(f[0], f[1]); for (let i = 2; i < f.length; i += 2) gx.lineTo(f[i], f[i + 1]);
      gx.stroke();
    }
    for (const gr of D.greens) {                     // 운동장·놀이터에는 나무를 심지 않도록 잔디에서 뺀다
      if (gr[2] < 2) continue;
      const f = gr[1];
      gx.beginPath(); gx.moveTo(f[0], f[1]); for (let i = 2; i < f.length; i += 2) gx.lineTo(f[i], f[i + 1]); gx.closePath(); gx.fill();
    }
    gx.setTransform(1, 0, 0, 1, 0, 0);
    // 잔디로 남은 곳에 나무와 덤불을 심는다
    const gpx = gx.getImageData(0, 0, GS, GS).data;
    const grassAt = (x, y) => {
      const px = Math.round((x + R) * gk), py = Math.round((R - y) * gk);
      if (px < 0 || py < 0 || px >= GS || py >= GS) return false;
      const o = (py * GS + px) * 4;
      return gpx[o + 1] > gpx[o] + 18;               // 초록이 빨강보다 뚜렷이 강하면 잔디
    };
    const bushes = [];
    for (let i = 0; i < 26000 && bushes.length < 900; i++) {
      const a = rg() * 6.283, d = Math.sqrt(rg()) * (R - 12), x = Math.cos(a) * d, y = Math.sin(a) * d;
      if (!grassAt(x, y) || !grassAt(x + 3, y) || !grassAt(x - 3, y) || !grassAt(x, y + 3) || !grassAt(x, y - 3)) continue;
      if (lotTrees.length < 320 && rg() < 0.3) lotTrees.push([x, y, 0.8 + rg() * 0.6]);
      else bushes.push([x, y, 0.6 + rg() * 0.8]);
    }
    {
      const bm = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ flatShading: true }), bushes.length);
      const d = new THREE.Object3D(), c = new THREE.Color(), BG = [0x4f7f3a, 0x5c8c42, 0x44733a, 0x6b9648, 0x3f6b36];
      bushes.forEach(([x, y, sc], i) => {
        d.position.set(x, sc * 0.45, -y); d.rotation.set(0, rg() * 6.28, 0); d.scale.set(sc, sc * 0.65, sc * (0.8 + rg() * 0.4)); d.updateMatrix();
        bm.setMatrixAt(i, d.matrix); bm.setColorAt(i, c.set(BG[Math.floor(rg() * BG.length)]).multiplyScalar(0.85 + rg() * 0.3));
      });
      bm.castShadow = bm.receiveShadow = true;
      scene.add(bm);
    }
    const gtex = new THREE.CanvasTexture(gcv);
    gtex.colorSpace = THREE.SRGBColorSpace; gtex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    // 가까이서 밋밋하지 않게 5m 마다 되풀이되는 잔무늬를 곱한다
    const dcv = document.createElement('canvas'); dcv.width = dcv.height = 128;
    const dx2 = dcv.getContext('2d'), did = dx2.createImageData(128, 128);
    for (let i = 0; i < did.data.length; i += 4) { const v = 90 + rg() * 165 | 0; did.data[i] = did.data[i + 1] = did.data[i + 2] = v; did.data[i + 3] = 255; }
    dx2.putImageData(did, 0, 0);
    const dtex = new THREE.CanvasTexture(dcv); dtex.wrapS = dtex.wrapT = THREE.RepeatWrapping;
    const gmat = new THREE.MeshLambertMaterial({ map: gtex });
    gmat.onBeforeCompile = sh => {
      sh.uniforms.uDetail = { value: dtex };
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', 'uniform sampler2D uDetail;\n#include <common>')
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= 0.80 + 0.40 * texture2D(uDetail, vMapUv * 400.0).r;');
    };
    const ground = new THREE.Mesh(new THREE.CircleGeometry(R, 128), gmat);
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    scene.add(ground);
    const ring = new THREE.Mesh(new THREE.RingGeometry(R, R + 5, 160), new THREE.MeshBasicMaterial({ color: 0xe5484d }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.3;
    scene.add(ring);
  }

  // ---------- 녹지 / 수면 ----------
  function shapeFrom(flat) {
    const a = []; for (let i = 0; i < flat.length; i += 2) a.push(new THREE.Vector2(flat[i], flat[i + 1]));
    return new THREE.Shape(a);
  }
  function flatLayer(polys, color, y) {
    const geos = [];
    for (const f of polys) {
      try { const g = new THREE.ShapeGeometry(shapeFrom(f)); if (g.attributes.position.count) geos.push(g); } catch (e) {}
    }
    if (!geos.length) return;
    const m = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshLambertMaterial({ color }));
    m.rotation.x = -Math.PI / 2; m.position.y = y; m.receiveShadow = true;
    scene.add(m);
  }
  flatLayer(D.greens.filter(g => g[2] === 0).map(g => g[1]), 0x7fa866, 0.05);
  flatLayer(D.greens.filter(g => g[2] === 1).map(g => g[1]), 0x55793f, 0.06);
  flatLayer(D.greens.filter(g => g[2] === 2).map(g => g[1]), 0x86b06a, 0.07);   // 운동장(잔디 구장)
  flatLayer(D.greens.filter(g => g[2] === 3).map(g => g[1]), 0xc9a777, 0.07);   // 놀이터
  flatLayer(D.waters, 0x5d8fb5, 0.08);

  // ---------- 도로 ----------
  const lampPos = [];
  {
    const pos = [], col = [];
    const push = (x, y, h, c) => { pos.push(x, h, -y); col.push(c.r, c.g, c.b); };
    const C = hex => new THREE.Color(hex);
    // 폴리라인을 따라 폭 2*hw 의 띠를 만든다. off 는 진행방향 오른쪽으로의 평행 이동.
    function ribbon(f, hw, h, c, joints, off = 0) {
      const n = f.length / 2;
      for (let i = 0; i < n - 1; i++) {
        let x0 = f[2 * i], y0 = f[2 * i + 1], x1 = f[2 * i + 2], y1 = f[2 * i + 3];
        const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
        if (len < 0.01) continue;
        const ux = dx / len, uy = dy / len;
        if (off) { x0 += uy * off; y0 -= ux * off; x1 += uy * off; y1 -= ux * off; }
        const nx = -uy * hw, ny = ux * hw;
        push(x0 + nx, y0 + ny, h, c); push(x0 - nx, y0 - ny, h, c); push(x1 - nx, y1 - ny, h, c);
        push(x0 + nx, y0 + ny, h, c); push(x1 - nx, y1 - ny, h, c); push(x1 + nx, y1 + ny, h, c);
        if (joints && i > 0) {
          const SEG = 8;
          for (let k = 0; k < SEG; k++) {
            const a0 = k / SEG * Math.PI * 2, a1 = (k + 1) / SEG * Math.PI * 2;
            push(x0, y0, h, c); push(x0 + Math.cos(a0) * hw, y0 + Math.sin(a0) * hw, h, c); push(x0 + Math.cos(a1) * hw, y0 + Math.sin(a1) * hw, h, c);
          }
        }
      }
    }
    // 점선 (on 미터 그리고 gap 미터 띄움)
    function dashes(f, off, hw, h, c, on = 3, gap = 5) {
      const n = f.length / 2; let carry = 0;
      for (let i = 0; i < n - 1; i++) {
        const x0 = f[2 * i], y0 = f[2 * i + 1], dx = f[2 * i + 2] - x0, dy = f[2 * i + 3] - y0, len = Math.hypot(dx, dy);
        if (len < 0.01) continue;
        const ux = dx / len, uy = dy / len;
        let s = carry;
        for (; s < len; s += on + gap) {
          const e = Math.min(len, s + on);
          ribbon([x0 + ux * s, y0 + uy * s, x0 + ux * e, y0 + uy * e], hw, h, c, false, off);
        }
        carry = s - len;
      }
    }
    // 그룹: 0 간선 1 보조간선 2 집산 3 이면도로 4 서비스 5 보행자전용 6 보도/계단
    const ASPHALT = [C(0x3e4146), C(0x414449), C(0x45484c), C(0x55575a), C(0x66676a)];
    const SIDEWALK = C(0xa9a59d), PAVER = C(0xb7a585), FOOT = C(0xb3ada1), WHITE = C(0xe9e9e4), YELLOW = C(0xd9a520);
    const Y = [0.30, 0.28, 0.26, 0.22, 0.19, 0.16, 0.13];
    const onAsphalt = makeAsphaltTest(D);            // 인도가 다른 길의 차도를 가로지르지 않게 잘라 내는 데 쓴다
    // 길 양쪽에 차도 끝(inner)부터 폭 width 의 인도를 2.5m 조각으로 깐다. 차도 쪽에는 연석.
    const swPos = [], SW_H = 0.45, CURB = C(0xd4d1ca), CURB_SIDE = C(0x9c9992);
    function sidewalk(f, inner, width) {
      const mid = inner + width / 2, outer = inner + width, cw = Math.min(0.2, width * 0.3);
      for (let i = 0; i < f.length - 2; i += 2) {
        const x0 = f[i], y0 = f[i + 1], dx = f[i + 2] - x0, dy = f[i + 3] - y0, len = Math.hypot(dx, dy);
        if (len < 0.05) continue;
        const ux = dx / len, uy = dy / len, n = Math.max(1, Math.ceil(len / 2.5));
        for (const sd of [1, -1]) {
          const nx = -uy * sd, ny = ux * sd;
          for (let k = 0; k < n; k++) {
            const a = k / n * len, b = (k + 1) / n * len;
            if (onAsphalt(x0 + ux * a + nx * mid, y0 + uy * a + ny * mid) || onAsphalt(x0 + ux * (a + b) / 2 + nx * mid, y0 + uy * (a + b) / 2 + ny * mid) || onAsphalt(x0 + ux * b + nx * mid, y0 + uy * b + ny * mid)) continue;
            const ax = x0 + ux * a, ay = y0 + uy * a, bx = x0 + ux * b, by = y0 + uy * b;
            const P = (px, py, o, h) => [px + nx * o, h, -(py + ny * o)];
            swPos.push(...P(ax, ay, inner, SW_H), ...P(ax, ay, outer, SW_H), ...P(bx, by, outer, SW_H), ...P(ax, ay, inner, SW_H), ...P(bx, by, outer, SW_H), ...P(bx, by, inner, SW_H));
            // 연석: 윗면 띠와 차도 쪽 옆면
            const q = (o0, h0, o1, h1, c) => {
              push(ax + nx * o0, ay + ny * o0, h0, c); push(ax + nx * o1, ay + ny * o1, h1, c); push(bx + nx * o1, by + ny * o1, h1, c);
              push(ax + nx * o0, ay + ny * o0, h0, c); push(bx + nx * o1, by + ny * o1, h1, c); push(bx + nx * o0, by + ny * o0, h0, c);
            };
            q(inner, SW_H + 0.012, inner + cw, SW_H + 0.012, CURB);
            q(inner, 0.12, inner, SW_H + 0.012, CURB_SIDE);
          }
        }
      }
    }
    for (const [grp, w, , f, oneway, lanes] of D.roads) {
      if (grp <= 2) ribbon(f, w / 2 + 3.2, 0.10, SIDEWALK, true);      // 인도 밑바탕 (꺾이는 곳의 틈을 메운다)
      if (grp <= 3) sidewalk(f, w / 2, grp <= 2 ? 3.2 : 1.0);
      if (grp <= 4) ribbon(f, w / 2, Y[grp], ASPHALT[grp], w >= 3);
      else if (grp === 5) ribbon(f, w / 2, Y[5], PAVER, true);
      else ribbon(f, w / 2, Y[6], FOOT, false);

      // 차선
      if (grp <= 3 && w >= 6) {
        const lw = w / Math.max(1, lanes), hM = 0.36;
        if (!oneway) {
          if (grp <= 1 && lanes >= 4) { ribbon(f, 0.1, hM, YELLOW, false, 0.22); ribbon(f, 0.1, hM, YELLOW, false, -0.22); }
          else if (grp <= 2) ribbon(f, 0.12, hM, YELLOW, false);
          else dashes(f, 0, 0.09, hM, YELLOW, 3, 3);
        }
        if (grp <= 2) for (let k = 1; k < lanes; k++) {
          if (!oneway && k * 2 === lanes) continue;                     // 중앙선 자리
          dashes(f, -w / 2 + k * lw, 0.09, hM, WHITE);
        }
      }
      // 가로등 위치
      if (grp <= 3) {
        let carry = 14, side = 1;
        for (let i = 0; i < f.length / 2 - 1; i++) {
          const x0 = f[2 * i], y0 = f[2 * i + 1], dx = f[2 * i + 2] - x0, dy = f[2 * i + 3] - y0, len = Math.hypot(dx, dy);
          if (len < 0.01) continue;
          let s = carry;
          for (; s < len; s += grp <= 2 ? 30 : 42) {
            const o = (w / 2 + 0.8) * side; side = -side;
            lampPos.push(x0 + dx / len * s + dy / len * o, grp <= 2 ? 8 : 5.5, -(y0 + dy / len * s - dx / len * o));
          }
          carry = s - len;
        }
      }
    }
    // 횡단보도 (얼룩말 무늬)
    for (const [x, y, ux, uy, w] of D.crossings) {
      const depth = w > 12 ? 6 : 4, nx = -uy, ny = ux;
      for (let o = -w / 2 + 0.6; o < w / 2 - 0.3; o += 1.1) {
        const cx = x + nx * o, cy = y + ny * o;
        ribbon([cx - ux * depth / 2, cy - uy * depth / 2, cx + ux * depth / 2, cy + uy * depth / 2], 0.3, 0.4, WHITE, false);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    m.receiveShadow = true;
    scene.add(m);

    // 인도 면: 보도블록 무늬(0.5 x 0.25m, 엇갈려 쌓기)를 위치로 계산해 그린다
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(swPos, 3));
    sg.computeVertexNormals();
    const smat = new THREE.MeshLambertMaterial({ color: 0xb9b3a8, side: THREE.DoubleSide });
    smat.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', 'varying vec3 vWp;\n#include <common>')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', 'varying vec3 vWp;\n#include <common>')
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec2 pp = vWp.xz / vec2(0.5, 0.25);
          pp.x += 0.5 * mod(floor(pp.y), 2.0);
          vec2 fp = fract(pp), ip = floor(pp);
          float fw = max(fwidth(vWp.x), fwidth(vWp.z)) * 4.0;
          float fade = 1.0 - smoothstep(0.25, 1.0, fw);
          float joint = 1.0 - smoothstep(0.04, 0.04 + fw, min(min(fp.x, 1.0 - fp.x), min(fp.y, 1.0 - fp.y)));
          float tone = fract(sin(dot(ip, vec2(12.9898, 78.233))) * 43758.5453);
          diffuseColor.rgb *= mix(0.97, (0.88 + 0.22 * tone) * (1.0 - 0.32 * joint), fade);`);
    };
    const sm = new THREE.Mesh(sg, smat);
    sm.receiveShadow = true;
    scene.add(sm);

    const rp = [];
    for (const f of D.rails) for (let i = 0; i < f.length / 2 - 1; i++) rp.push(f[2 * i], 0.5, -f[2 * i + 1], f[2 * i + 2], 0.5, -f[2 * i + 3]);
    if (rp.length) {
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
      scene.add(new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x5a5e68 })));
    }
  }

  // 가로등 불빛 (밤에만 보임)
  const lampMat = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const cx = cv.getContext('2d'), gr = cx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,236,190,1)'); gr.addColorStop(0.25, 'rgba(255,200,120,.55)'); gr.addColorStop(1, 'rgba(255,180,90,0)');
    cx.fillStyle = gr; cx.fillRect(0, 0, 64, 64);
    return new THREE.PointsMaterial({ map: new THREE.CanvasTexture(cv), size: 16, sizeAttenuation: true, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false, color: 0xffd9a0 });
  })();
  const lampPool = lampMat.clone(); lampPool.size = 46; lampPool.color.set(0xff9c4a);
  {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(lampPos, 3));
    const pts = new THREE.Points(g, lampMat);
    pts.frustumCulled = false;
    scene.add(pts);
    const gp = new Float32Array(lampPos); for (let i = 1; i < gp.length; i += 3) gp[i] = 1.2;
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.BufferAttribute(gp, 3));
    const pool = new THREE.Points(g2, lampPool);
    pool.frustumCulled = false;
    scene.add(pool);
  }

  // ---------- 건물 ----------
  const PAL = {
    villa: ['#9b5d48', '#8a5140', '#b27b66', '#a8644e', '#c7b69d', '#d6cdbd', '#b5afa4', '#e2ddd2', '#8b8985', '#c09d80', '#d9d2c4'],
    commercial: ['#d5d1c8', '#bcb9b2', '#a5a6a8', '#e4e0d8', '#8c8e92', '#c5b6a3', '#6e7277', '#ad8c78', '#ebebe8', '#9a8f84'],
    glass: ['#55616e', '#3d4753', '#6f7a84', '#48525c', '#808a92', '#394450'],
    apartment: ['#e6e1d5', '#dad3c3', '#cdccc6', '#e0d6c9', '#c6cfd3', '#d8d0bd'],
    public: ['#b0674e', '#c6beb1', '#a56d58', '#d1cabd', '#b9b4aa'],
    roofGreen: ['#4c7557', '#436d4e', '#557d5e', '#3f6a55'],
    roofGrey: ['#96968f', '#aeaca6', '#838388', '#a39f96', '#8e9196'],
  };
  // 외벽 텍스처 10장을 한 장의 배열 텍스처로 묶는다 (assets/game/wall_XX.jpg). 다 받기 전에는 회색.
  const WALLS = 10, WALL_PX = 512;
  const blank = new THREE.DataArrayTexture(new Uint8Array(4 * WALLS).fill(190), 1, 1, WALLS);
  blank.colorSpace = THREE.SRGBColorSpace; blank.needsUpdate = true;
  const buildingUniforms = { uNight: { value: 0 }, uWalls: { value: blank } };
  {
    const data = new Uint8Array(WALL_PX * WALL_PX * 4 * WALLS);
    const cv = document.createElement('canvas'); cv.width = cv.height = WALL_PX;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    let left = WALLS;
    for (let i = 0; i < WALLS; i++) {
      const img = new Image();
      img.onload = () => {
        cx.drawImage(img, 0, 0, WALL_PX, WALL_PX);
        data.set(cx.getImageData(0, 0, WALL_PX, WALL_PX).data, i * WALL_PX * WALL_PX * 4);
        if (--left) return;
        const t = new THREE.DataArrayTexture(data, WALL_PX, WALL_PX, WALLS);
        t.format = THREE.RGBAFormat; t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
        t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        t.needsUpdate = true;
        buildingUniforms.uWalls.value = t;
      };
      img.src = `assets/game/wall_${String(i + 1).padStart(2, '0')}.jpg`;
    }
  }
  // 외관 유형별로 어울리는 텍스처 (0 벽돌 1 콘크리트 2 골함석 3 벗겨진 회벽 4 사암 5 나무 6 타일 7 복합패널 8 현무암 9 유리)
  const TEX_FOR = [[0, 0, 0, 3, 3, 4, 6, 5, 8, 1], [9, 9, 9, 7], [1, 1, 3, 7, 7], [1, 1, 7, 7, 6, 0, 4, 2, 8, 3, 9]];
  const roofBoxes = [], roofTanks = [];
  {
    const pos = [], nor = [], col = [], wall = [], style = [], tex = [];
    const cWall = new THREE.Color(), cRoof = new THREE.Color(), cTint = new THREE.Color(), WHITE = new THREE.Color(0xffffff);
    let layer = 0;
    const vert = (x, y, h, nx, ny, nz, c, u, L, H, type, seed, shop) => {
      pos.push(x, h, -y); nor.push(nx, ny, nz); col.push(c.r, c.g, c.b);
      wall.push(u, h, L, H); style.push(type, seed, shop); tex.push(type < 0 ? -1 : layer);
    };
    D.buildings.forEach((b, i) => {
      const [H, , , f, holes, kind] = b;
      const r = rng(i + 1), area = areaOf(f);
      // 외관 유형: 0 벽돌 빌라 1 유리 커튼월 2 아파트 3 일반 상가/콘크리트
      let type, pal, shop;
      const r1 = r(), r2 = r(), r3 = r(), r4 = r();
      if (kind === 1) { type = 0; pal = PAL.villa; shop = r1 < 0.25; }
      else if (kind === 2) { if (H < 22) { type = 0; pal = PAL.villa; shop = r1 < 0.3; } else { type = 2; pal = PAL.apartment; shop = false; } }
      else if (kind === 3) { if (H > 28 && r1 < 0.55) { type = 1; pal = PAL.glass; } else { type = 3; pal = PAL.commercial; } shop = true; }
      else if (kind === 4) { type = 3; pal = PAL.public; shop = false; }
      else if (area < 260 && H < 17) { if (r1 < 0.6) { type = 0; pal = PAL.villa; shop = r3 < 0.4; } else { type = 3; pal = PAL.commercial; shop = true; } }
      else if (H > 32 && r1 < 0.5) { type = 1; pal = PAL.glass; shop = true; }
      else { type = 3; pal = PAL.commercial; shop = r3 < 0.8; }
      if (H < 3.5) shop = false;
      cWall.set(pickFrom(pal, r2)).multiplyScalar(0.92 + r4 * 0.16);
      layer = pickFrom(TEX_FOR[type], r());                              // 외벽 텍스처는 무작위
      cTint.copy(cWall).lerp(WHITE, 0.78).multiplyScalar(0.9 + r4 * 0.2);     // 텍스처에 곱할 옅은 색조
      const greenRoof = H < 26 && r3 < 0.3;
      cRoof.set(pickFrom(greenRoof ? PAL.roofGreen : PAL.roofGrey, r4)).multiplyScalar(0.9 + r1 * 0.2);
      const seed = r2 * 97 + r4;
      const top = H + PARAPET(H, area);

      // 벽
      const rings = [f, ...holes];
      rings.forEach((rf, ri) => {
        const n = rf.length / 2;
        let sgn = signedArea(rf) > 0 ? 1 : -1;
        if (ri > 0) sgn = -sgn;
        for (let k = 0; k < n; k++) {
          const j = (k + 1) % n, x0 = rf[2 * k], y0 = rf[2 * k + 1], x1 = rf[2 * j], y1 = rf[2 * j + 1];
          const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
          if (L < 0.05) continue;
          const nx = sgn * dy / L, nz = sgn * dx / L;   // 지도 법선 (dy,-dx) -> three (dy, 0, dx)
          const A = [x0, y0, 0, 0], B = [x1, y1, 0, L], Cc = [x1, y1, top, L], Dd = [x0, y0, top, 0];
          const tris = sgn > 0 ? [A, B, Cc, A, Cc, Dd] : [A, Cc, B, A, Dd, Cc];
          for (const p of tris) vert(p[0], p[1], p[2], nx, 0, nz, cTint, p[3], L, H, type, seed, shop ? 1 : 0);
        }
      });
      // 지붕
      try {
        const toV = rf => { const a = []; for (let k = 0; k < rf.length; k += 2) a.push(new THREE.Vector2(rf[k], rf[k + 1])); return a; };
        const contour = toV(f), hs = holes.map(toV), all = contour.concat(...hs);
        for (const t of THREE.ShapeUtils.triangulateShape(contour, hs)) {
          let [a, bb, c] = t.map(k => all[k]);
          if ((bb.x - a.x) * (c.y - a.y) - (bb.y - a.y) * (c.x - a.x) < 0) [bb, c] = [c, bb];
          for (const p of [a, bb, c]) vert(p.x, p.y, H, 0, 1, 0, cRoof, 0, 1, H, -1, seed, 0);
        }
      } catch (e) {}

      // 옥상 구조물 (옥탑 · 물탱크 · 실외기)
      if (H > 7 && area > 70 && !holes.length) {
        const [cx, cy] = centroid(f);
        // 가장 긴 변의 방향에 맞춰 놓는다
        let best = 0, ang = 0;
        for (let k = 0, n = f.length / 2; k < n; k++) {
          const j = (k + 1) % n, dx = f[2 * j] - f[2 * k], dy = f[2 * j + 1] - f[2 * k + 1], L = dx * dx + dy * dy;
          if (L > best) { best = L; ang = Math.atan2(dy, dx); }
        }
        const s = Math.sqrt(area);
        const count = area > 900 ? 3 : 1;
        for (let q = 0; q < count; q++) {
          const ox = cx + (q ? (r() - 0.5) * s * 0.5 : (r() - 0.5) * s * 0.2), oy = cy + (q ? (r() - 0.5) * s * 0.5 : (r() - 0.5) * s * 0.2);
          const bw = clamp(s * (q ? 0.14 : 0.3), 2.2, 9), bd = clamp(s * (q ? 0.1 : 0.22), 2, 7), bh = q ? 1.6 : 2.7;
          const fits = [[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([sx, sy]) => {
            const lx = sx * bw / 2, ly = sy * bd / 2;
            return inPoly(ox + lx * Math.cos(ang) - ly * Math.sin(ang), oy + lx * Math.sin(ang) + ly * Math.cos(ang), f);
          });
          if (!fits) continue;
          roofBoxes.push({ x: ox, y: oy, h: H, w: bw, d: bd, bh, ang, c: q ? new THREE.Color(0x9ea1a4) : cWall.clone().lerp(new THREE.Color(0xd8d6d0), 0.45) });
          if (!q && type === 0 && r() < 0.45) roofTanks.push({ x: ox, y: oy, h: H + bh, c: r() < 0.6 ? 0xd9b23a : 0x4f86b8 });
        }
      }
    });

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aWall', new THREE.Float32BufferAttribute(wall, 4));
    g.setAttribute('aStyle', new THREE.Float32BufferAttribute(style, 3));
    g.setAttribute('aTex', new THREE.Float32BufferAttribute(tex, 1));

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.55 });
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, buildingUniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', 'attribute vec4 aWall;\nattribute vec3 aStyle;\nattribute float aTex;\nvarying vec4 vWall;\nvarying vec3 vStyle;\nvarying float vTex;\n#include <common>')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWall = aWall; vStyle = aStyle; vTex = aTex;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `
          uniform float uNight;
          uniform sampler2DArray uWalls;
          varying vec4 vWall; varying vec3 vStyle; varying float vTex;
          const float TILE[10] = float[10](2.6, 7.0, 4.0, 7.0, 3.6, 4.0, 3.2, 6.0, 4.0, 6.0);   // 텍스처 한 장이 덮는 크기 (m)
          float gGlass = 0.0;
          float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
          float band(float x,float a,float b,float w){ return smoothstep(a-w,a+w,x)*(1.0-smoothstep(b-w,b+w,x)); }
          #include <common>`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          if (vStyle.x > -0.5) {
            float type = vStyle.x, seed = vStyle.y, L = vWall.z, H = vWall.w, y = vWall.y;
            float tile = TILE[int(vTex + 0.5)];
            vec3 col = texture(uWalls, vec3(vWall.x / tile, -y / tile, floor(vTex + 0.5))).rgb * diffuseColor.rgb * (0.80 + 0.20*smoothstep(0.0, 6.0, y));
            if (L > 1.7 && y < H) {
              float bay = type < 0.5 ? 2.9 : type < 1.5 ? 1.5 : type < 2.5 ? 3.6 : 2.4;
              vec2 win = type < 0.5 ? vec2(0.42,0.40) : type < 1.5 ? vec2(0.90,0.80) : type < 2.5 ? vec2(0.76,0.52) : vec2(0.68,0.50);
              float sill = (type > 0.5 && type < 1.5) ? 0.10 : 0.30;
              float g0 = vStyle.z > 0.5 ? min(3.8, H) : 0.0;
              float nb = max(1.0, floor(L/bay + 0.5));
              float cu = vWall.x/L*nb, fu = fract(cu), iu = floor(cu);
              float du = fwidth(cu), dy = fwidth(y);
              if (y < g0) {                                   // 1층 상가: 쇼윈도 + 간판
                float f = 1.0 - smoothstep(0.4, 1.0, du);
                float gm = mix(0.45, band(fu,0.07,0.93,du)*band(y,0.4,2.7,dy), f);
                float sm = band(y,2.9,3.65,dy) * mix(0.8, band(fu,0.03,0.97,du), f);
                float hs = h21(vec2(iu + seed*57.0, seed*13.0));
                vec3 sgn = 0.5 + 0.42*cos(6.2832*(hs + vec3(0.0,0.33,0.67)));
                sgn = mix(sgn, vec3(0.9), step(0.62, h21(vec2(iu, seed*7.0))));
                sgn = mix(vec3(0.62), sgn, f);
                col = mix(col, vec3(0.13,0.16,0.19), gm);
                col = mix(col, sgn, sm);
                gGlass = gm*(1.0-sm)*0.8;
                totalEmissiveRadiance += uNight*(gm*(1.0-sm)*vec3(1.0,0.8,0.52)*1.0*step(0.3,hs) + sm*sgn*1.1);
              } else {                                        // 위층 창문
                float nF = max(1.0, floor((H-g0)/3.2 + 0.5));
                float cv = (y-g0)/max(0.1,H-g0)*nF, fv = fract(cv), iv = floor(cv);
                float dv = fwidth(cv);
                float f = 1.0 - smoothstep(0.35, 0.9, max(du,dv));
                float hw = h21(vec2(iu + seed*31.0, iv + seed*17.0));
                float lit = step(type > 0.5 && type < 1.5 ? 0.78 : 0.64, fract(hw*7.31)) * (0.35 + 0.65*fract(hw*13.7));
                vec3 lc = mix(vec3(1.0,0.72,0.40), vec3(0.82,0.90,1.0), step(0.72, fract(hw*3.7)));
                col *= 1.0 - 0.14*f*(1.0 - smoothstep(0.0, 0.05, fv));            // 층 사이 슬래브 선
                if (vTex > 8.5) {                                                 // 유리 커튼월: 텍스처 자체가 창
                  col *= 0.8 + 0.3*hw;
                  gGlass = 0.85;
                  totalEmissiveRadiance += uNight*mix(0.12, lit, f)*lc*0.6;
                } else {
                  float m = band(fu,0.5-win.x*0.5,0.5+win.x*0.5,du)*band(fv,sill,sill+win.y,dv);
                  float fr = band(fu,0.5-win.x*0.5-0.04,0.5+win.x*0.5+0.04,du)*band(fv,sill-0.05,sill+win.y+0.04,dv);
                  m = mix(win.x*win.y, m, f);
                  float blind = step(0.88, hw)*f;
                  col = mix(col, vec3(0.80,0.80,0.78), clamp(fr - m, 0.0, 1.0)*f*0.9);                       // 창틀
                  float gy = clamp((fv - sill)/win.y, 0.0, 1.0);
                  vec3 glass = mix(vec3(0.06,0.09,0.13), vec3(0.24,0.33,0.42), gy*0.7) * (1.0 - 0.5*smoothstep(0.75, 1.0, gy));   // 위쪽은 그늘
                  col = mix(col, mix(glass, vec3(0.27,0.28,0.29), blind), m);
                  gGlass = m*(1.0-blind);
                  totalEmissiveRadiance += uNight*m*mix(0.16, lit, f)*lc*1.1;
                }
              }
            }
            col *= 0.86 + 0.14*smoothstep(0.0, 0.3, min(vWall.x, L - vWall.x));   // 벽 모서리
            col *= 1.0 - 0.22*step(H - 0.4, y)*step(y, H);                         // 처마 띠
            if (y > H) col = mix(col, vec3(0.5), 0.55);                             // 옥상 난간
            diffuseColor.rgb = col;
          }`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.07, gGlass);')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.72, gGlass);');
    };
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // 옥상 구조물
  const stdMat = opts => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, envMapIntensity: 0.5, ...opts });
  {
    const dummy = new THREE.Object3D();
    const boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), stdMat({}), roofBoxes.length);
    roofBoxes.forEach((b, i) => {
      dummy.position.set(b.x, b.h + b.bh / 2, -b.y); dummy.rotation.set(0, b.ang, 0); dummy.scale.set(b.w, b.bh, b.d); dummy.updateMatrix();
      boxes.setMatrixAt(i, dummy.matrix); boxes.setColorAt(i, b.c);
    });
    boxes.castShadow = boxes.receiveShadow = true;
    scene.add(boxes);
    const tanks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.85, 0.85, 1.5, 10), stdMat({ roughness: 0.6 }), roofTanks.length);
    const c = new THREE.Color();
    roofTanks.forEach((t, i) => {
      dummy.position.set(t.x, t.h + 0.75, -t.y); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
      tanks.setMatrixAt(i, dummy.matrix); tanks.setColorAt(i, c.set(t.c));
    });
    tanks.castShadow = true;
    scene.add(tanks);
  }

  // ---------- 나무 ----------
  const treeInfo = buildTrees(scene, D.trees.concat(lotTrees));       // 가로수·공원·빈터의 나무 (수종 여섯 가지, trees.js)

  // ---------- 차량 ----------
  const traffic = buildTraffic(scene, D, lampMat);

  // ---------- 시간대 (태양 · 하늘 · 조명) ----------
  const sunDir = new THREE.Vector3();
  const FOG = { day: new THREE.Color(0xb7c6d6), dusk: new THREE.Color(0xc9a184), night: new THREE.Color(0x0b0f18) };
  function setTime(h) {
    const elev = 60 * Math.sin(Math.PI * (h - 6) / 12);                 // 태양 고도(도)
    const az = THREE.MathUtils.degToRad(90 + (h - 6) / 12 * 180);        // 방위: 동 → 남 → 서
    const e = THREE.MathUtils.degToRad(elev);
    sunDir.set(Math.sin(az) * Math.cos(e), Math.sin(e), -Math.cos(az) * Math.cos(e));
    const day = smoothstep(elev, -4, 7), night = 1 - smoothstep(elev, -9, 0), low = 1 - smoothstep(elev, 4, 28);

    for (const s of [sky, envSky]) {
      const u = s.material.uniforms;
      u.sunPosition.value.copy(sunDir);
      u.turbidity.value = lerp(3, 7, low); u.rayleigh.value = lerp(1.1, 2.6, low);
      u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82;
    }
    if (elev > -1) {
      sun.position.copy(sunDir).multiplyScalar(2600);
      sun.color.set(0xff9350).lerp(new THREE.Color(0xfff4e4), smoothstep(elev, 2, 30));
      sun.intensity = 2.0 * smoothstep(elev, -1, 7) * (1 + 0.35 * low);   // 해가 낮을수록 빛이 길고 짙게 든다
    } else {                                                             // 달빛
      sun.position.set(-900, 1700, 1100);
      sun.color.set(0x8fa6e8);
      sun.intensity = 0.85 * night;
    }
    hemi.intensity = lerp(0.42, 0.6, day);              // 밤에도 드론과 건물 윤곽이 보일 만큼은 밝게
    hemi.color.set(0x6276b0).lerp(new THREE.Color(0xdfeaff), day).lerp(new THREE.Color(0xffc49a), low * day * 0.55);   // 밤은 푸르게, 노을은 붉게
    hemi.groundColor.set(0x3c4250).lerp(new THREE.Color(0x8a8478), day);
    renderer.toneMappingExposure = lerp(0.7, 0.6, day);
    scene.fog.color.copy(FOG.night).lerp(FOG.dusk, smoothstep(elev, -10, 3)).lerp(FOG.day, smoothstep(elev, 3, 25));
    outerMat.color.copy(scene.fog.color).multiplyScalar(lerp(1.0, 0.86, day));
    buildingUniforms.uNight.value = night;
    lampMat.opacity = night; lampPool.opacity = night * 0.3; traffic.setNight(night);

    renderer.shadowMap.needsUpdate = true;
    const rt = pmrem.fromScene(envScene);                                // 유리 반사용 환경맵
    scene.environment = rt.texture;
    if (envRT) envRT.dispose();
    envRT = rt;
  }

  // 건물 밖의 장애물 (world.addProps 에 넘긴다)
  const colliders = treeInfo.colliders.concat(
    roofBoxes.map(b => ({ k: 'box', x: b.x, y: b.h + b.bh / 2, z: -b.y, hx: b.w / 2, hy: b.bh / 2, hz: b.d / 2, rot: b.ang })),
    roofTanks.map(t => ({ k: 'cyl', x: t.x, z: -t.y, r: 0.85, y0: t.h, y1: t.h + 1.5 })));
  return { setTime, updateCars: traffic.update, carRay: traffic.raycast, carNear: traffic.carNear, traffic, lampPos, colliders };
}
