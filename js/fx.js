// 불꽃·폭발 입자. 가산 혼합 점 하나로 모두 그린다.
import * as THREE from 'three';

const MAX = 900;

export class Particles {
  constructor(scene) {
    this.n = 0;                                   // 다음에 쓸 칸 (돌려 쓴다)
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX);
    this.vel = new Float32Array(MAX * 3);
    this.base = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.grav = new Float32Array(MAX);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { uScale: { value: 600 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float size; attribute vec3 color; varying vec3 vCol; uniform float uScale;
        void main(){ vCol = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * uScale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vCol;
        void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, d); gl_FragColor = vec4(vCol * a * a, 1.0); }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, color, size, life, grav = 0) {
    const i = this.n; this.n = (this.n + 1) % MAX;
    this.pos[3 * i] = x; this.pos[3 * i + 1] = y; this.pos[3 * i + 2] = z;
    this.vel[3 * i] = vx; this.vel[3 * i + 1] = vy; this.vel[3 * i + 2] = vz;
    this.base[3 * i] = color.r; this.base[3 * i + 1] = color.g; this.base[3 * i + 2] = color.b;
    this.size[i] = size; this.life[i] = this.maxLife[i] = life; this.grav[i] = grav;
  }

  // 사방으로 튀는 입자 묶음
  burst(p, count, color, speed, size, life, grav = 0) {
    for (let k = 0; k < count; k++) {
      const u = Math.random() * 2 - 1, a = Math.random() * 6.283, s = Math.sqrt(1 - u * u), v = speed * (0.35 + Math.random() * 0.65);
      this.emit(p.x, p.y, p.z, s * Math.cos(a) * v, u * v, s * Math.sin(a) * v, color, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.6), grav);
    }
  }

  update(dt, camera, viewportH) {
    this.uniforms.uScale.value = viewportH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    const drag = Math.exp(-2.2 * dt);
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      const l = (this.life[i] -= dt);
      if (l <= 0) { this.size[i] = 0; continue; }
      const j = 3 * i, f = l / this.maxLife[i];
      this.vel[j] *= drag; this.vel[j + 1] = this.vel[j + 1] * drag - this.grav[i] * dt; this.vel[j + 2] *= drag;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      this.col[j] = this.base[j] * f; this.col[j + 1] = this.base[j + 1] * f; this.col[j + 2] = this.base[j + 2] * f;
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.color.needsUpdate = a.size.needsUpdate = true;
  }
}
