import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CustomBlending,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  Points,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  type PerspectiveCamera,
} from 'three';
import type { FxApi } from '../game/api';
import type { HitKind } from '../world/world';

/**
 * 开枪 / 近战的世界里的特效，全部开局建好、循环复用，一共两次绘制：
 *   粒子（一个 Points）：弹着点的尘土 / 木屑 / 碎石 / 火星、丧尸身上的血雾、爆炸的火球和烟。普通混合和加色混合用预乘透明度合在一次绘制里；
 *   曳光（一个 Mesh，48 条面片）：从枪口到弹着点的一道亮线，几帧就没。
 * 没有东西在飞的时候两个都不画。粒子不受光，所以颜色按现在的天光压暗（夜里不会发白）。
 */

const MAX_P = 512;
const MAX_T = 48;

const P_VERT = /* glsl */ `
attribute vec4 aColor;
attribute vec2 aSize;
uniform float uScale;
varying vec4 vColor;
varying float vAdd;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = aSize.x * uScale / max(0.1, -mvPosition.z);
  vColor = aColor;
  vAdd = aSize.y;
  #include <fog_vertex>
}`;

const P_FRAG = /* glsl */ `
varying vec4 vColor;
varying float vAdd;
#include <fog_pars_fragment>
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = vColor.a * smoothstep(1.0, 0.2, dot(d, d) * 4.0);
  if (a < 0.004) discard;
  vec3 col = vColor.rgb;
  #ifdef USE_FOG
    float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    col = mix(col, fogColor * (1.0 - vAdd), fogFactor);
  #endif
  // 预乘透明度：加色的粒子（火星）不遮后面的东西，alpha 输出 0
  gl_FragColor = vec4(col * a, a * (1.0 - vAdd));
}`;

const T_VERT = /* glsl */ `
attribute vec3 aCol;
varying vec3 vCol;
varying vec2 vUv;
void main() {
  vCol = aCol;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const T_FRAG = /* glsl */ `
varying vec3 vCol;
varying vec2 vUv;
void main() {
  float e = 1.0 - abs(vUv.y * 2.0 - 1.0);
  // 头亮尾暗，两边虚
  gl_FragColor = vec4(vCol * e * e * (0.15 + 0.85 * vUv.x * vUv.x), 1.0);
}`;

/** 一种粒子的样子：颜色（线性，白天的亮度）、大小从 s0 长到 s1（米）、活多久、重力、阻力 */
interface Look {
  r: number;
  g: number;
  b: number;
  a: number;
  s0: number;
  s1: number;
  life: number;
  grav: number;
  drag: number;
  add: number;
}

const DUST: Look = { r: 0.34, g: 0.31, b: 0.27, a: 0.5, s0: 0.1, s1: 0.5, life: 0.7, grav: -0.3, drag: 3.5, add: 0 };
const DIRT: Look = { r: 0.2, g: 0.15, b: 0.1, a: 0.6, s0: 0.09, s1: 0.42, life: 0.65, grav: 1.5, drag: 2.6, add: 0 };
const CLOD: Look = { r: 0.13, g: 0.1, b: 0.07, a: 0.95, s0: 0.035, s1: 0.03, life: 0.6, grav: 9, drag: 0.6, add: 0 };
const WOOD: Look = { r: 0.36, g: 0.26, b: 0.15, a: 0.95, s0: 0.03, s1: 0.025, life: 0.55, grav: 8, drag: 0.8, add: 0 };
const STONE: Look = { r: 0.3, g: 0.3, b: 0.3, a: 0.95, s0: 0.03, s1: 0.025, life: 0.5, grav: 9, drag: 0.6, add: 0 };
const SPARK: Look = { r: 3.2, g: 1.9, b: 0.7, a: 1, s0: 0.035, s1: 0.012, life: 0.28, grav: 7, drag: 1.2, add: 1 };
const GLINT: Look = { r: 2.6, g: 2.0, b: 1.2, a: 0.9, s0: 0.22, s1: 0.05, life: 0.07, grav: 0, drag: 0, add: 1 };
const BLOOD: Look = { r: 0.2, g: 0.012, b: 0.01, a: 0.9, s0: 0.04, s1: 0.03, life: 0.5, grav: 8, drag: 1, add: 0 };
const MIST: Look = { r: 0.16, g: 0.012, b: 0.01, a: 0.55, s0: 0.12, s1: 0.4, life: 0.4, grav: 0.6, drag: 4, add: 0 };
// ---- 爆炸：一下闪光、一团火、往上翻的黑烟、贴着地面推开的土、四散的火星和土块
const BOOM: Look = { r: 7, g: 5.2, b: 3, a: 1, s0: 3.2, s1: 4.6, life: 0.085, grav: 0, drag: 0, add: 1 };
const FIRE: Look = { r: 3.6, g: 1.6, b: 0.45, a: 0.95, s0: 0.8, s1: 1.9, life: 0.36, grav: -2, drag: 4.5, add: 1 };
const SMOKE: Look = { r: 0.075, g: 0.07, b: 0.065, a: 0.72, s0: 0.9, s1: 3, life: 2.6, grav: -0.9, drag: 2.4, add: 0 };
const GUST: Look = { r: 0.3, g: 0.26, b: 0.21, a: 0.5, s0: 0.5, s1: 1.9, life: 1.2, grav: -0.2, drag: 3.2, add: 0 };
const EMBER: Look = { r: 3.4, g: 1.8, b: 0.6, a: 1, s0: 0.06, s1: 0.02, life: 0.75, grav: 9, drag: 0.9, add: 1 };
const CHUNK: Look = { r: 0.11, g: 0.09, b: 0.07, a: 1, s0: 0.06, s1: 0.05, life: 1.1, grav: 10, drag: 0.5, add: 0 };
/** 手雷飞的时候身后的一点烟 */
const WISP: Look = { r: 0.3, g: 0.3, b: 0.3, a: 0.26, s0: 0.05, s1: 0.2, life: 0.4, grav: -0.3, drag: 3, add: 0 };

export class FxPool implements FxApi {
  readonly group = new Group();
  /** 现在的天光 0–1（粒子不受光，按它压暗）；每帧由武器模块按昼夜设 */
  light = 1;

  // ---- 粒子（结构数组）
  private readonly px = new Float32Array(MAX_P);
  private readonly py = new Float32Array(MAX_P);
  private readonly pz = new Float32Array(MAX_P);
  private readonly vx = new Float32Array(MAX_P);
  private readonly vy = new Float32Array(MAX_P);
  private readonly vz = new Float32Array(MAX_P);
  private readonly age = new Float32Array(MAX_P);
  private readonly life = new Float32Array(MAX_P);
  private readonly look: Array<Look | null> = new Array<Look | null>(MAX_P).fill(null);
  private readonly lit = new Float32Array(MAX_P);
  /** 这一颗比这种粒子平常的大多少倍（爆炸按半径放大） */
  private readonly big = new Float32Array(MAX_P);
  private next = 0;
  private alive = 0;
  /** 开局头几帧空着也不藏：让缓冲和着色器在真正的场景里用一次（第一枪就不用现传了） */
  private warmP = 4;
  private warmT = 4;
  private readonly pPos = new BufferAttribute(new Float32Array(MAX_P * 3), 3);
  private readonly pCol = new BufferAttribute(new Float32Array(MAX_P * 4), 4);
  private readonly pSize = new BufferAttribute(new Float32Array(MAX_P * 2), 2);
  private readonly points: Points;
  private readonly pMat: ShaderMaterial;

  // ---- 曳光
  private readonly tx = new Float32Array(MAX_T * 3);
  private readonly td = new Float32Array(MAX_T * 3);
  /** 每条：总长、已经过的时间、亮度 */
  private readonly tLen = new Float32Array(MAX_T);
  private readonly tAge = new Float32Array(MAX_T);
  private readonly tGain = new Float32Array(MAX_T);
  private tNext = 0;
  private tAlive = 0;
  private readonly tPos = new BufferAttribute(new Float32Array(MAX_T * 12), 3);
  private readonly tCol = new BufferAttribute(new Float32Array(MAX_T * 12), 3);
  private readonly tracers: Mesh;

  constructor() {
    const pg = new BufferGeometry();
    this.pPos.setUsage(DynamicDrawUsage);
    this.pCol.setUsage(DynamicDrawUsage);
    this.pSize.setUsage(DynamicDrawUsage);
    pg.setAttribute('position', this.pPos);
    pg.setAttribute('aColor', this.pCol);
    pg.setAttribute('aSize', this.pSize);
    this.pMat = new ShaderMaterial({
      uniforms: UniformsUtils.merge([UniformsLib.fog, { uScale: { value: 600 } }]),
      vertexShader: P_VERT,
      fragmentShader: P_FRAG,
      fog: true,
      transparent: true,
      depthWrite: false,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
    });
    this.points = new Points(pg, this.pMat);
    this.points.frustumCulled = false;
    this.points.name = 'fx-particles';
    pg.setDrawRange(0, 0);

    const tg = new BufferGeometry();
    this.tPos.setUsage(DynamicDrawUsage);
    this.tCol.setUsage(DynamicDrawUsage);
    const uv = new Float32Array(MAX_T * 8);
    const idx = new Uint16Array(MAX_T * 6);
    for (let i = 0; i < MAX_T; i++) {
      // 四个点：尾左、尾右、头左、头右
      uv.set([0, 0, 0, 1, 1, 0, 1, 1], i * 8);
      const b = i * 4;
      idx.set([b, b + 1, b + 2, b + 2, b + 1, b + 3], i * 6);
    }
    tg.setAttribute('position', this.tPos);
    tg.setAttribute('aCol', this.tCol);
    tg.setAttribute('uv', new BufferAttribute(uv, 2));
    tg.setIndex(new BufferAttribute(idx, 1));
    tg.setDrawRange(0, 0);
    const tm = new ShaderMaterial({ vertexShader: T_VERT, fragmentShader: T_FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide });
    this.tracers = new Mesh(tg, tm);
    this.tracers.frustumCulled = false;
    this.tracers.name = 'fx-tracers';
    // 开局先留着（main.ts 建完模块以后统一预编译着色器），第一次 update 发现没东西再藏起来
    this.group.add(this.points, this.tracers);
    this.group.name = 'arsenal-fx';
  }

  private emit(L: Look, x: number, y: number, z: number, vx: number, vy: number, vz: number, lifeK = 1, big = 1): void {
    const i = this.next;
    this.next = (i + 1) % MAX_P;
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.age[i] = 0;
    this.life[i] = L.life * lifeK * (0.75 + Math.random() * 0.5);
    this.look[i] = L;
    // 加色的（火星）不压暗；别的按现在的天光
    this.lit[i] = L.add ? 1 : this.light;
    this.big[i] = big;
    this.points.visible = true;
  }

  /** 朝 (nx, ny, nz) 方向的一小撮：n 个，速度 sp，散开 spread */
  private burst(L: Look, n: number, x: number, y: number, z: number, nx: number, ny: number, nz: number, sp: number, spread: number): void {
    for (let i = 0; i < n; i++) {
      const s = sp * (0.4 + Math.random() * 0.8);
      this.emit(L, x, y, z, (nx + (Math.random() * 2 - 1) * spread) * s, (ny + (Math.random() * 2 - 1) * spread) * s, (nz + (Math.random() * 2 - 1) * spread) * s);
    }
  }

  /**
   * 子弹 / 近战武器打在世界上。(dx, dy, dz) = 来的方向（已归一化），碎屑往回溅、往上飘。
   * k = 多少（霰弹的每颗弹丸给小一点，近战的大锤给大一点）
   */
  impact(kind: HitKind, x: number, y: number, z: number, dx: number, dy: number, dz: number, k = 1): void {
    if (kind === 'none') return;
    // 往回退一点，免得粒子一出生就埋在墙里
    const bx = x - dx * 0.04;
    const by = y - dy * 0.04;
    const bz = z - dz * 0.04;
    if (kind === 'ground') {
      // 地面：土往上喷
      this.burst(DIRT, Math.round(3 * k), bx, by + 0.03, bz, -dx * 0.3, 1, -dz * 0.3, 1.6, 0.5);
      this.burst(CLOD, Math.round(4 * k), bx, by + 0.03, bz, -dx * 0.4, 1, -dz * 0.4, 3.2, 0.7);
      return;
    }
    const nx = -dx;
    const ny = -dy + 0.35;
    const nz = -dz;
    if (kind === 'tree') {
      this.burst(DUST, Math.round(2 * k), bx, by, bz, nx, ny, nz, 0.9, 0.5);
      this.burst(WOOD, Math.round(5 * k), bx, by, bz, nx, ny, nz, 3, 0.8);
    } else if (kind === 'car') {
      this.emit(GLINT, bx, by, bz, 0, 0, 0);
      this.burst(SPARK, Math.round(6 * k), bx, by, bz, nx, ny, nz, 5, 0.9);
      this.burst(DUST, Math.round(1 * k), bx, by, bz, nx, ny, nz, 0.7, 0.4);
    } else {
      // 墙、家具、石头：一团灰 + 碎渣，偶尔蹦一两点火星
      this.burst(DUST, Math.round(3 * k), bx, by, bz, nx, ny, nz, 1.2, 0.55);
      this.burst(STONE, Math.round(3 * k), bx, by, bz, nx, ny, nz, 3, 0.8);
      if (kind === 'rock' || Math.random() < 0.35) this.burst(SPARK, 2, bx, by, bz, nx, ny, nz, 4, 0.9);
    }
  }

  /** 打在丧尸身上：血雾 + 几滴血，顺着子弹的方向往后溅 */
  blood(x: number, y: number, z: number, dx: number, dy: number, dz: number, k = 1): void {
    this.burst(MIST, Math.round(2 * k), x, y, z, dx * 0.4, dy * 0.4 + 0.2, dz * 0.4, 1.2, 0.6);
    this.burst(BLOOD, Math.round(5 * k), x, y, z, dx * 0.7, dy * 0.7 + 0.35, dz * 0.7, 3, 0.7);
  }

  /**
   * 爆炸：(x, y, z) = 炸点（手雷躺着的地方）。全是池子里的粒子：不加绘制、不加灯。
   * radius = 杀伤半径（米）；手雷是 7.5，火球和烟大约有它的三分之一大，别的半径按比例放大缩小
   */
  blast(x: number, y: number, z: number, radius: number): void {
    const k = Math.max(0.4, Math.min(2, radius / 7.5));
    const cy = y + 0.3 * k;
    this.emit(BOOM, x, cy + 0.2, z, 0, 0, 0, 1, k);
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * 6.283;
      const u = Math.random();
      const sp = (1.5 + 3 * Math.random()) * k;
      this.emit(FIRE, x, cy, z, Math.cos(a) * (1 - 0.6 * u) * sp, (0.6 + 1.6 * u) * sp, Math.sin(a) * (1 - 0.6 * u) * sp, 1, k);
    }
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * 6.283;
      const sp = (1.2 + 2.6 * Math.random()) * k;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      this.emit(SMOKE, x + c * 0.3 * k, cy + 0.2, z + sn * 0.3 * k, c * sp, (1.2 + 2.4 * Math.random()) * k, sn * sp, 1, k);
    }
    for (let i = 0; i < 8; i++) {
      const a = (i + Math.random()) * 0.785;
      const sp = (5 + 3 * Math.random()) * k;
      this.emit(GUST, x, y + 0.15, z, Math.cos(a) * sp, 0.5, Math.sin(a) * sp, 1, k);
    }
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * 6.283;
      const up = Math.random();
      const sp = (8 + 10 * Math.random()) * k;
      const h = Math.sqrt(1 - up * up);
      this.emit(EMBER, x, cy, z, Math.cos(a) * h * sp, (0.15 + up) * sp, Math.sin(a) * h * sp);
    }
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * 6.283;
      const sp = (2 + 5 * Math.random()) * k;
      this.emit(CHUNK, x, y + 0.1, z, Math.cos(a) * sp, (4 + 6 * Math.random()) * k, Math.sin(a) * sp);
    }
  }

  /** 手雷飞的时候身后留的一点烟 */
  puff(x: number, y: number, z: number): void {
    this.emit(WISP, x, y, z, 0, 0.2, 0);
  }

  /** 一道曳光：从 (sx, sy, sz) 到 (ex, ey, ez)。gain = 亮度（霰弹的弹丸暗一些） */
  tracer(sx: number, sy: number, sz: number, ex: number, ey: number, ez: number, gain = 1): void {
    const dx = ex - sx;
    const dy = ey - sy;
    const dz = ez - sz;
    const len = Math.hypot(dx, dy, dz);
    // 贴脸打的不画（一帧都活不到）
    if (len < 2.5) return;
    const i = this.tNext;
    this.tNext = (i + 1) % MAX_T;
    this.tx[i * 3] = sx;
    this.tx[i * 3 + 1] = sy;
    this.tx[i * 3 + 2] = sz;
    this.td[i * 3] = dx / len;
    this.td[i * 3 + 1] = dy / len;
    this.td[i * 3 + 2] = dz / len;
    this.tLen[i] = len;
    this.tAge[i] = 0;
    this.tGain[i] = gain;
    this.tracers.visible = true;
  }

  /** 每帧：推进粒子和曳光，把活着的写进缓冲。camera = 世界相机（面片朝向、点的大小用） */
  update(dt: number, camera: PerspectiveCamera, bufferHeight: number): void {
    // ---- 粒子
    if (this.points.visible) {
      const pos = this.pPos.array as Float32Array;
      const col = this.pCol.array as Float32Array;
      const size = this.pSize.array as Float32Array;
      let n = 0;
      for (let i = 0; i < MAX_P; i++) {
        const L = this.look[i];
        if (!L) continue;
        const a = (this.age[i] as number) + dt;
        const life = this.life[i] as number;
        if (a >= life) {
          this.look[i] = null;
          continue;
        }
        this.age[i] = a;
        const drag = Math.exp(-L.drag * dt);
        const vx = (this.vx[i] as number) * drag;
        const vy = ((this.vy[i] as number) - L.grav * dt) * drag;
        const vz = (this.vz[i] as number) * drag;
        this.vx[i] = vx;
        this.vy[i] = vy;
        this.vz[i] = vz;
        const x = (this.px[i] as number) + vx * dt;
        const y = (this.py[i] as number) + vy * dt;
        const z = (this.pz[i] as number) + vz * dt;
        this.px[i] = x;
        this.py[i] = y;
        this.pz[i] = z;
        const t = a / life;
        const lit = this.lit[i] as number;
        pos[n * 3] = x;
        pos[n * 3 + 1] = y;
        pos[n * 3 + 2] = z;
        col[n * 4] = L.r * lit;
        col[n * 4 + 1] = L.g * lit;
        col[n * 4 + 2] = L.b * lit;
        // 一出生就是最浓的，之后越来越淡
        col[n * 4 + 3] = L.a * (1 - t) * (1 - t * t);
        size[n * 2] = (L.s0 + (L.s1 - L.s0) * Math.sqrt(t)) * (this.big[i] as number);
        size[n * 2 + 1] = L.add;
        n++;
      }
      this.alive = n;
      this.points.geometry.setDrawRange(0, n);
      if (n) {
        this.pPos.needsUpdate = true;
        this.pCol.needsUpdate = true;
        this.pSize.needsUpdate = true;
        (this.pMat.uniforms.uScale as { value: number }).value = bufferHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
      } else if (this.warmP > 0) this.warmP--;
      else this.points.visible = false;
    }

    // ---- 曳光：头以 SPEED 往前飞，后面拖一段，尾巴到头就没了
    if (this.tracers.visible) {
      const SPEED = 280;
      const pos = this.tPos.array as Float32Array;
      const col = this.tCol.array as Float32Array;
      const cx = camera.position.x;
      const cy = camera.position.y;
      const cz = camera.position.z;
      let n = 0;
      for (let i = 0; i < MAX_T; i++) {
        const len = this.tLen[i] as number;
        if (len <= 0) continue;
        const age = this.tAge[i] as number;
        this.tAge[i] = age + dt;
        const streak = Math.min(len * 0.6, 14);
        // 第一帧就画出一段（不然 60 帧时第一眼看到的已经飞出去 4 米了）
        const head = Math.min(len, age * SPEED + streak * 0.7);
        const tail = Math.max(0, head - streak);
        if (age * SPEED - streak > len) {
          this.tLen[i] = 0;
          continue;
        }
        const ox = this.tx[i * 3] as number;
        const oy = this.tx[i * 3 + 1] as number;
        const oz = this.tx[i * 3 + 2] as number;
        const dx = this.td[i * 3] as number;
        const dy = this.td[i * 3 + 1] as number;
        const dz = this.td[i * 3 + 2] as number;
        const hx = ox + dx * head;
        const hy = oy + dy * head;
        const hz = oz + dz * head;
        const ax = ox + dx * tail;
        const ay = oy + dy * tail;
        const az = oz + dz * tail;
        // 面片朝向相机：侧向 = 方向 × (相机 → 中点)
        const mx = (hx + ax) / 2 - cx;
        const my = (hy + ay) / 2 - cy;
        const mz = (hz + az) / 2 - cz;
        let sx = dy * mz - dz * my;
        let sy = dz * mx - dx * mz;
        let sz = dx * my - dy * mx;
        const sl = Math.hypot(sx, sy, sz) || 1;
        // 宽度跟着距离走：远处也至少有一两个像素宽
        const w = (0.012 + Math.hypot(mx, my, mz) * 0.0016) / sl;
        sx *= w;
        sy *= w;
        sz *= w;
        const o = n * 12;
        pos[o] = ax - sx;
        pos[o + 1] = ay - sy;
        pos[o + 2] = az - sz;
        pos[o + 3] = ax + sx;
        pos[o + 4] = ay + sy;
        pos[o + 5] = az + sz;
        pos[o + 6] = hx - sx;
        pos[o + 7] = hy - sy;
        pos[o + 8] = hz - sz;
        pos[o + 9] = hx + sx;
        pos[o + 10] = hy + sy;
        pos[o + 11] = hz + sz;
        // 快到头的时候淡出
        const g = (this.tGain[i] as number) * Math.min(1, (len - tail) / Math.max(1, streak));
        for (let k = 0; k < 4; k++) {
          col[o + k * 3] = 2.6 * g;
          col[o + k * 3 + 1] = 2.0 * g;
          col[o + k * 3 + 2] = 1.2 * g;
        }
        n++;
      }
      this.tAlive = n;
      this.tracers.geometry.setDrawRange(0, n * 6);
      if (n) {
        this.tPos.needsUpdate = true;
        this.tCol.needsUpdate = true;
      } else if (this.warmT > 0) this.warmT--;
      else this.tracers.visible = false;
    }
  }

  /** 调试：现在有多少粒子 / 曳光 */
  stats(): { particles: number; tracers: number } {
    return { particles: this.alive, tracers: this.tAlive };
  }
}
