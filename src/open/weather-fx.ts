import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, MeshBasicMaterial, ShaderMaterial, Vector2, Vector3, Vector4 } from 'three';
import type { GameCtx } from './game/api';
import { WX } from './render/wx';
import type { Cover } from './world/sites';
import { WATER } from './world/terrain';

/**
 * 雨丝、水花、雪花、闪电的电光。
 *
 * 雨和雪各是一个实例化的网格（一次绘制），粒子全部在顶点着色器里算，CPU 每帧只改几个 uniform：
 * - 粒子住在跟着相机走的盒子里：位置对盒子取模，相机走到哪盒子就包到哪，不用生成也不用回收。
 *   三圈盒子（16 / 32 / 64 米见方）叠在一起，近处密、远处疏，屏幕上看起来远近一样多。
 * - 下落、飘动都是时间的周期函数，周期都是 LOOP 的整数分之一：时间到 LOOP 回绕时一点不跳，
 *   着色器里的数永远不大，跑多久都不会因为浮点精度抖起来。
 * - 风把雨吹斜：水平位移由 CPU 按风速累加（uDrift），所有粒子一起平移；雨丝朝「雨相对相机的速度」拉长，
 *   所以开车时雨是迎面扑过来的。
 * - 屋顶、雨棚下面没有雨雪：附近最近的十块顶（world.sites.coversNear）传给着色器，落在它下面的粒子不画。
 * - 远处的雨丝不到一个像素宽：宽度至少按 0.6 个像素画，透明度相应降低，不会一闪一闪。
 */

/** 一圈动画多长（秒）。render/ground.ts 里涟漪的时间（WX.time）也是它 */
export const LOOP = 128;
/** 最里面一圈盒子的大小（米）；外面两圈是它的 2 倍、4 倍 */
const BOX = 16;
const BOX_Y = 12;
/** 相机位置、风的位移对它取模（= 最外圈盒子的大小） */
const WRAP = BOX * 4;
const WRAP_Y = BOX_Y * 4;
/** 最多传几块屋顶 */
const NCOV = 10;
/** 最高画质、最大的雨 / 雪有多少粒子（每十个雨粒子里有一个是地上的水花） */
const RAIN_MAX = 16000;
const SNOW_MAX = 18000;
const SPLASH_EVERY = 10;
/** 风力 1 的时候雨 / 雪横着走多快（米/秒） */
const RAIN_WIND = 8;
const SNOW_WIND = 6.5;
/** 闪电最多几段 */
const BOLT_SEGS = 32;

const HEAD = /* glsl */ `
attribute vec4 aSeed;
attribute vec4 aRnd;
uniform float uTime;
uniform vec3 uCamM;
uniform vec2 uDrift;
uniform float uPix;
uniform vec4 uCov[${NCOV}];
uniform float uCovY[${NCOV}];
uniform vec4 uShelter;
varying vec2 vUv;
varying float vA;

// 这个点头顶有没有屋顶 / 雨棚（世界坐标）
float covered(vec3 w) {
  float hide = 0.0;
  for (int i = 0; i < ${NCOV}; i++) {
    vec4 c = uCov[i];
    if (w.x > c.x && w.x < c.z && w.z > c.y && w.z < c.w && w.y < uCovY[i]) hide = 1.0;
  }
  // 坐在车里：相机周围一小圈（车顶下面）没有
  vec2 sd = w.xz - uShelter.xy;
  if (dot(sd, sd) < uShelter.z * uShelter.z && w.y < uShelter.w) hide = 1.0;
  return hide;
}
`;

const RAIN_VERT = /* glsl */ `
${HEAD}
uniform vec3 uWind;
uniform vec3 uVel;
uniform vec4 uGround;
varying float vKind;

float h1(vec2 p) {
  p = fract(p * vec2(0.1031, 0.1030));
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x);
}

void main() {
  float kind = aRnd.w;
  // 第几圈：1 / 2 / 4 倍的盒子（水花只在最里面一圈）
  float lv = kind > 0.5 || aSeed.w < 0.4 ? 1.0 : (aSeed.w < 0.75 ? 2.0 : 4.0);
  vec3 box = vec3(${BOX.toFixed(1)}, ${BOX_Y.toFixed(1)}, ${BOX.toFixed(1)}) * lv;
  vec3 rel;
  vec3 p;
  float alpha = 0.4 + 0.6 * aRnd.y;
  if (kind < 0.5) {
    // 雨丝：每秒落 9–12 米。n = 一圈动画里穿过盒子几次（整数，时间回绕时不跳）
    float n = floor(mix(24.0, 32.99, aRnd.x)) * (4.0 / lv);
    rel.y = (fract(aSeed.y - uTime * n / ${LOOP.toFixed(1)} - uCamM.y / box.y + 0.5) - 0.5) * box.y;
    rel.xz = mod(aSeed.xz * box.xz + uDrift - uCamM.xz + box.xz * 0.5, box.xz) - box.xz * 0.5;
    vec3 c = mat3(viewMatrix) * rel;
    float dist = length(c);
    alpha *= (1.0 - smoothstep(box.y * 0.36, box.y * 0.5, abs(rel.y))) * (1.0 - smoothstep(box.x * 0.36, box.x * 0.5, length(rel.xz))) * smoothstep(0.5, 3.0, dist);
    // 朝「雨相对相机的速度」拉长：长度 = 曝光时间里走过的路
    vec3 ax = mat3(viewMatrix) * (vec3(uWind.x, -n * box.y / ${LOOP.toFixed(1)}, uWind.z) - uVel) * 0.024;
    vec3 side = normalize(cross(ax, c) + vec3(0.0, 1e-6, 0.0));
    // 粗细：近处最多两个像素宽（不然是一根根白面条），远处不到 0.6 个像素的按 0.6 画、相应变淡
    float w0 = 0.004 + 0.004 * aRnd.z;
    float px = uPix * dist;
    float hw = clamp(w0, px * 0.6, px * 2.0);
    alpha *= min(1.0, w0 / hw);
    p = c - ax * position.y + side * (position.x * hw);
  } else {
    // 水花：一朵 0.2–0.34 秒，每次换一个落点；落在相机脚下那块地面的切平面上（uGround，CPU 每秒量十次）
    float ph = aSeed.y + uTime * floor(mix(380.0, 640.0, aRnd.x)) / ${LOOP.toFixed(1)};
    float life = fract(ph);
    float cyc = floor(ph);
    vec2 sp = vec2(h1(aSeed.xz * 91.7 + cyc * 0.37), h1(aSeed.zx * 53.3 + cyc * 0.71 + 11.0));
    rel.xz = mod(sp * box.xz - uCamM.xz + box.xz * 0.5, box.xz) - box.xz * 0.5;
    rel.y = max(uGround.x + dot(uGround.yz, rel.xz), uGround.w) + 0.012;
    vec3 c = mat3(viewMatrix) * rel;
    float dist = length(c);
    float s = (0.028 + 0.03 * aRnd.z) * (0.45 + 0.55 * sqrt(life));
    float hw = max(s, uPix * dist * 0.8);
    alpha *= (1.0 - life) * (1.0 - life) * (s / hw) * (1.0 - smoothstep(4.5, 7.6, length(rel.xz))) * smoothstep(0.3, 1.2, dist);
    vec3 up = mat3(viewMatrix) * vec3(0.0, 1.0, 0.0);
    vec3 right = normalize(cross(up, c) + vec3(1e-6, 0.0, 0.0));
    p = c + right * (position.x * hw) + up * (position.y * hw * 1.5);
  }
  float hide = covered(cameraPosition + rel);
  vUv = position.xy;
  vA = alpha;
  vKind = kind;
  gl_Position = hide > 0.5 || alpha < 0.004 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * vec4(p, 1.0);
}
`;

const RAIN_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying vec2 vUv;
varying float vA;
varying float vKind;
void main() {
  float a;
  if (vKind < 0.5) {
    // 雨丝：中间实、两边虚；头上亮，往后拖着淡掉
    a = (1.0 - abs(vUv.x)) * smoothstep(0.0, 0.05, vUv.y) * (1.0 - vUv.y);
  } else {
    // 水花：贴着地的一小团，往上溅开
    vec2 d = vec2(vUv.x, vUv.y * 1.25 - 0.25);
    a = max(0.0, 1.0 - dot(d, d));
    a *= a * 1.3;
  }
  gl_FragColor = vec4(uColor, a * vA * uAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const SNOW_VERT = /* glsl */ `
${HEAD}
uniform float uSwirl;
void main() {
  float lv = aSeed.w < 0.4 ? 1.0 : (aSeed.w < 0.75 ? 2.0 : 4.0);
  vec3 box = vec3(${BOX.toFixed(1)}, ${BOX_Y.toFixed(1)}, ${BOX.toFixed(1)}) * lv;
  // 每秒落 0.75–1.9 米
  float n = floor(mix(2.0, 5.99, aRnd.x)) * (4.0 / lv);
  vec3 rel;
  rel.y = (fract(aSeed.y - uTime * n / ${LOOP.toFixed(1)} - uCamM.y / box.y + 0.5) - 0.5) * box.y;
  // 飘：每片雪花自己左右晃（一圈 4–10 秒，频率是整数：时间回绕时不跳）
  float k1 = 13.0 + floor(aRnd.z * 19.99);
  float k2 = 13.0 + floor(fract(aRnd.z * 7.31) * 19.99);
  float ph = aRnd.y * 6.2832;
  vec2 sw = vec2(sin(uTime * k1 * ${((Math.PI * 2) / LOOP).toFixed(6)} + ph), cos(uTime * k2 * ${((Math.PI * 2) / LOOP).toFixed(6)} + ph * 1.7)) * (0.22 + 0.4 * aRnd.z) * uSwirl;
  rel.xz = mod(aSeed.xz * box.xz + uDrift + sw - uCamM.xz + box.xz * 0.5, box.xz) - box.xz * 0.5;
  vec3 c = mat3(viewMatrix) * rel;
  float dist = length(c);
  float alpha = (0.55 + 0.45 * aRnd.y) * (1.0 - smoothstep(box.y * 0.36, box.y * 0.5, abs(rel.y))) * (1.0 - smoothstep(box.x * 0.36, box.x * 0.5, length(rel.xz))) * smoothstep(0.35, 1.3, dist);
  // 太远的雪花不到一个像素：按一个多像素画、相应变淡；贴着镜头的不让它糊成一大团
  float r0 = 0.009 + 0.013 * aRnd.y * aRnd.y;
  float px = uPix * dist;
  float hw = clamp(r0, px * 0.8, px * 7.0);
  alpha *= min(1.0, r0 / hw);
  float hide = covered(cameraPosition + rel);
  vUv = position.xy;
  vA = alpha;
  gl_Position = hide > 0.5 || alpha < 0.004 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * vec4(c + vec3(position.xy * hw, 0.0), 1.0);
}
`;

const SNOW_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying vec2 vUv;
varying float vA;
void main() {
  float a = 1.0 - smoothstep(0.3, 1.0, length(vUv));
  gl_FragColor = vec4(uColor, a * vA * uAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** n 个粒子：一个方片 × n 个实例，每个实例 8 个随机数。y0 = 方片的下沿（雨丝 0…1，雪花 −1…1） */
function particles(n: number, y0: number, splashEvery: number, seed: number): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([-1, y0, 0, 1, y0, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const a = new Float32Array(n * 4);
  const b = new Float32Array(n * 4);
  const rnd = rng(seed);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 4; k++) {
      a[i * 4 + k] = rnd();
      b[i * 4 + k] = rnd();
    }
    // 水花均匀地插在雨丝中间：只画前面一部分粒子（雨小、画质低）时两样一起变少
    b[i * 4 + 3] = splashEvery > 0 && i % splashEvery === splashEvery - 1 ? 1 : 0;
  }
  g.setAttribute('aSeed', new InstancedBufferAttribute(a, 4));
  g.setAttribute('aRnd', new InstancedBufferAttribute(b, 4));
  g.instanceCount = 0;
  return g;
}

const wrap = (v: number, m: number): number => ((v % m) + m) % m;
const _size = new Vector2();
const _dir = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();

export class PrecipFx {
  private readonly rain: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  private readonly snow: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  private readonly bolt: Mesh<BufferGeometry, MeshBasicMaterial>;
  private readonly boltPos = new Float32Array(BOLT_SEGS * 12);
  private readonly boltCol = new Float32Array(BOLT_SEGS * 12);
  private boltN = 0;
  private boltOn = false;
  /** 雨和雪共用的 uniform */
  private readonly uTime = { value: 0 };
  private readonly uCamM = { value: new Vector3() };
  private readonly uPix = { value: 0.001 };
  private readonly uCov = { value: new Float32Array(NCOV * 4) };
  private readonly uCovY = { value: new Float32Array(NCOV) };
  private readonly uShelter = { value: new Vector4() };
  private readonly rainDrift = new Vector2();
  private readonly snowDrift = new Vector2();
  private readonly rainWind = new Vector3();
  private readonly vel = new Vector3();
  private readonly ground = new Vector4();
  private readonly rainCol = new Color();
  private readonly snowCol = new Color();
  private readonly rainAlpha = { value: 0 };
  private readonly snowAlpha = { value: 0 };
  private readonly swirl = { value: 1 };
  private time = 0;
  /** 画质档位：粒子密度 0–1 */
  quality = 1;
  /** 开局头几帧所有网格都算「可见」（实例数是 0，不产生绘制）：着色器 main.ts 预编译时已经编好了，这里只是让第一次绑定程序、上传顶点缓冲发生在加载阶段，而不是第一次下雨的那一帧 */
  private warm = 3;
  private readonly last = new Vector3();
  private hasLast = false;
  private covT = 0;
  private readonly covers: Cover[] = [];
  private covX = 0;
  private covZ = 0;
  private readonly byDist = (p: Cover, q: Cover): number => this.coverDist(p) - this.coverDist(q);
  /** 相机脚下的地面：一个点 + 两个方向的坡度（水花落在这个平面上） */
  private gT = 0;
  private gX = 0;
  private gZ = 0;
  private gY = 0;
  private gSx = 0;
  private gSz = 0;

  constructor(private readonly ctx: GameCtx) {
    const shared = { uTime: this.uTime, uCamM: this.uCamM, uPix: this.uPix, uCov: this.uCov, uCovY: this.uCovY, uShelter: this.uShelter };
    const rainMat = new ShaderMaterial({
      vertexShader: RAIN_VERT,
      fragmentShader: RAIN_FRAG,
      uniforms: { ...shared, uDrift: { value: this.rainDrift }, uWind: { value: this.rainWind }, uVel: { value: this.vel }, uGround: { value: this.ground }, uColor: { value: this.rainCol }, uAlpha: this.rainAlpha },
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    const snowMat = new ShaderMaterial({
      vertexShader: SNOW_VERT,
      fragmentShader: SNOW_FRAG,
      uniforms: { ...shared, uDrift: { value: this.snowDrift }, uSwirl: this.swirl, uColor: { value: this.snowCol }, uAlpha: this.snowAlpha },
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.rain = new Mesh(particles(RAIN_MAX, 0, SPLASH_EVERY, 9001), rainMat);
    this.snow = new Mesh(particles(SNOW_MAX, -1, 0, 9002), snowMat);
    for (const m of [this.rain, this.snow]) {
      m.frustumCulled = false;
      m.matrixAutoUpdate = false;
      // 画在水面、路灯光斑这些透明的东西后面
      m.renderOrder = 6;
      ctx.scene.add(m);
    }
    this.rain.name = 'weather:rain';
    this.snow.name = 'weather:snow';

    // 闪电的电光：一串朝着相机的细长面片，每次打雷重新摆
    const bg = new BufferGeometry();
    bg.setAttribute('position', new BufferAttribute(this.boltPos, 3));
    bg.setAttribute('color', new BufferAttribute(this.boltCol, 3));
    const idx: number[] = [];
    for (let i = 0; i < BOLT_SEGS; i++) idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    bg.setIndex(idx);
    bg.setDrawRange(0, 0);
    const bm = new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, side: DoubleSide });
    // 比白还亮：后期的光晕会让它发光
    bm.color.setRGB(2.6, 2.9, 3.8);
    this.bolt = new Mesh(bg, bm);
    this.bolt.frustumCulled = false;
    this.bolt.matrixAutoUpdate = false;
    this.bolt.renderOrder = 5;
    this.bolt.name = 'weather:bolt';
    ctx.scene.add(this.bolt);
  }

  private coverDist(c: Cover): number {
    return Math.hypot(Math.max(c.x0 - this.covX, 0, this.covX - c.x1), Math.max(c.z0 - this.covZ, 0, this.covZ - c.z1));
  }

  /** 附近的屋顶：挑离相机最近的 NCOV 块传给着色器（一秒查三次） */
  private findCovers(x: number, z: number): void {
    const list = this.covers;
    list.length = 0;
    this.ctx.world.sites.coversNear(x, z, WRAP * 0.75, list);
    this.covX = x;
    this.covZ = z;
    if (list.length > NCOV) list.sort(this.byDist);
    const rect = this.uCov.value;
    const top = this.uCovY.value;
    for (let i = 0; i < NCOV; i++) {
      const c = list[i];
      rect[i * 4] = c ? c.x0 : 0;
      rect[i * 4 + 1] = c ? c.z0 : 0;
      rect[i * 4 + 2] = c ? c.x1 : 0;
      rect[i * 4 + 3] = c ? c.z1 : 0;
      top[i] = c ? c.y : -1e5;
    }
  }

  /**
   * 每帧：只改 uniform 和实例数。rain / snow 0–1；(windX, windZ) = 风的方向 × 风力（0–1）；
   * rainCol / snowCol = 粒子的颜色（跟着天光变，打闪时被照亮）；flash = 电光有多亮 0–1
   */
  update(dt: number, rain: number, snow: number, windX: number, windZ: number, rainCol: Color, snowCol: Color, flash: number): void {
    const cam = this.ctx.camera;
    const cp = cam.position;
    this.time = (this.time + dt) % LOOP;
    this.uTime.value = this.time;
    WX.time.value = this.time;
    this.uCamM.value.set(wrap(cp.x, WRAP), wrap(cp.y, WRAP_Y), wrap(cp.z, WRAP));
    this.ctx.renderer.getDrawingBufferSize(_size);
    this.uPix.value = (2 * Math.tan((cam.fov * Math.PI) / 360)) / Math.max(1, _size.y);

    // 相机的速度（平滑过的；传送那一帧不算）
    if (this.hasLast && dt > 1e-4) {
      const dx = cp.x - this.last.x;
      const dy = cp.y - this.last.y;
      const dz = cp.z - this.last.z;
      const jump = dx * dx + dy * dy + dz * dz > 25;
      const k = jump ? 1 : Math.min(1, dt * 8);
      this.vel.x += ((jump ? 0 : dx / dt) - this.vel.x) * k;
      this.vel.y += ((jump ? 0 : dy / dt) - this.vel.y) * k;
      this.vel.z += ((jump ? 0 : dz / dt) - this.vel.z) * k;
    }
    this.last.copy(cp);
    this.hasLast = true;

    // 风：水平位移累加起来（对最外圈盒子取模）
    this.rainWind.set(windX * RAIN_WIND, 0, windZ * RAIN_WIND);
    this.rainDrift.set(wrap(this.rainDrift.x + windX * RAIN_WIND * dt, WRAP), wrap(this.rainDrift.y + windZ * RAIN_WIND * dt, WRAP));
    this.snowDrift.set(wrap(this.snowDrift.x + windX * SNOW_WIND * dt, WRAP), wrap(this.snowDrift.y + windZ * SNOW_WIND * dt, WRAP));
    // 风大的时候雪花被风带着直着走，自己晃得少
    this.swirl.value = 1 - 0.55 * Math.min(1, Math.hypot(windX, windZ));

    const on = rain > 0.01 || snow > 0.01;
    this.covT -= dt;
    if (on && (this.covT <= 0 || Math.hypot(cp.x - this.covX, cp.z - this.covZ) > 6)) {
      this.covT = 0.3;
      this.findCovers(cp.x, cp.z);
    }
    // 坐在车里（车内视角）：相机周围一小圈没有雨雪
    const g = this.ctx.garage;
    const car = g.driving;
    if (on && car && g.view === 'cockpit' && car.def.kind === 'car') this.uShelter.value.set(cp.x, cp.z, 1.25, cp.y + 0.7);
    else this.uShelter.value.set(0, 0, 0, -1e5);

    if (rain > 0.01) {
      this.gT -= dt;
      if (this.gT <= 0 || Math.hypot(cp.x - this.gX, cp.z - this.gZ) > 3) {
        this.gT = 0.1;
        const w = this.ctx.world;
        this.gX = cp.x;
        this.gZ = cp.z;
        this.gY = w.groundAt(cp.x, cp.z);
        this.gSx = (w.groundAt(cp.x + 4, cp.z) - w.groundAt(cp.x - 4, cp.z)) / 8;
        this.gSz = (w.groundAt(cp.x, cp.z + 4) - w.groundAt(cp.x, cp.z - 4)) / 8;
      }
      this.ground.set(this.gY + this.gSx * (cp.x - this.gX) + this.gSz * (cp.z - this.gZ) - cp.y, this.gSx, this.gSz, WATER - cp.y);
    }

    this.rainCol.copy(rainCol);
    this.snowCol.copy(snowCol);
    const q = this.quality;
    const rn = rain > 0.01 ? Math.round(RAIN_MAX * q * (0.3 + 0.7 * rain)) : 0;
    const sn = snow > 0.01 ? Math.round(SNOW_MAX * q * (0.3 + 0.7 * snow)) : 0;
    this.rain.geometry.instanceCount = rn;
    this.snow.geometry.instanceCount = sn;
    // 刚开始下 / 快停的时候整体淡入淡出
    this.rainAlpha.value = 0.8 * Math.min(1, rain / 0.1);
    this.snowAlpha.value = 0.92 * Math.min(1, snow / 0.1);
    const warm = this.warm > 0;
    if (warm) this.warm--;
    this.rain.visible = warm || rn > 0;
    this.snow.visible = warm || sn > 0;

    const lit = this.boltOn && flash > 0.02;
    if (this.boltOn && flash <= 0.02) this.boltOn = false;
    this.bolt.material.opacity = lit ? Math.min(1, flash * 1.4) : 0;
    this.bolt.visible = warm || lit;
  }

  private seg(ax: number, ay: number, az: number, bx: number, by: number, bz: number, half: number, bright: number): void {
    if (this.boltN >= BOLT_SEGS) return;
    // 面片朝着相机：宽度方向 = 线段方向 × 视线方向
    const cp = this.ctx.camera.position;
    _a.set(bx - ax, by - ay, bz - az);
    _b.set(ax - cp.x, ay - cp.y, az - cp.z);
    _c.crossVectors(_a, _b).normalize().multiplyScalar(half);
    const o = this.boltN * 12;
    const p = this.boltPos;
    p[o] = ax - _c.x;
    p[o + 1] = ay - _c.y;
    p[o + 2] = az - _c.z;
    p[o + 3] = ax + _c.x;
    p[o + 4] = ay + _c.y;
    p[o + 5] = az + _c.z;
    p[o + 6] = bx + _c.x;
    p[o + 7] = by + _c.y;
    p[o + 8] = bz + _c.z;
    p[o + 9] = bx - _c.x;
    p[o + 10] = by - _c.y;
    p[o + 11] = bz - _c.z;
    for (let k = 0; k < 12; k++) this.boltCol[o + k] = bright;
    this.boltN++;
  }

  /**
   * 打一道闪电：在镜头前方一带随机挑个落点，摆好电光（之后几帧由 update 的 flash 控制亮灭）。
   * inCloud = 只在云里闪，看不到电光。返回落点离相机多远（米）：雷声按它延迟
   */
  strike(inCloud: boolean): number {
    const cam = this.ctx.camera;
    const d = 240 + Math.random() * Math.random() * 760;
    if (inCloud) return d * 2;
    cam.getWorldDirection(_dir);
    const yaw = Math.atan2(_dir.x, _dir.z) + (Math.random() - 0.5) * 1.7;
    const sx = Math.sin(yaw);
    const sz = Math.cos(yaw);
    const bx = cam.position.x + sx * d;
    const bz = cam.position.z + sz * d;
    const y0 = Math.max(this.ctx.world.heightAt(bx, bz), WATER);
    const y1 = y0 + 300 + Math.random() * 140;
    // 在垂直于视线的平面里往下走：每一步横着随机偏一点，最后收到落点上
    const rx = sz;
    const rz = -sx;
    const half = d * 0.0017;
    const steps = 13;
    this.boltN = 0;
    let off = (Math.random() - 0.5) * 110;
    let py = y1;
    let branches = 0;
    for (let i = 0; i < steps; i++) {
      const left = steps - i;
      const ny = y1 + ((y0 - y1) * (i + 1)) / steps;
      const noff = left === 1 ? 0 : off - off / left + (Math.random() - 0.5) * 34;
      this.seg(bx + rx * off, py, bz + rz * off, bx + rx * noff, ny, bz + rz * noff, half, 1);
      // 分叉：往一边斜着下去几段，越来越细
      if (i > 0 && i < steps - 3 && branches < 3 && Math.random() < 0.34) {
        branches++;
        const dirSign = Math.random() < 0.5 ? -1 : 1;
        let qo = noff;
        let qy = ny;
        const n = 3 + Math.floor(Math.random() * 3);
        for (let k = 0; k < n; k++) {
          const no = qo + dirSign * (10 + Math.random() * 22);
          const nq = qy - (10 + Math.random() * 20);
          this.seg(bx + rx * qo, qy, bz + rz * qo, bx + rx * no, nq, bz + rz * no, half * (0.5 - k * 0.07), 0.4);
          qo = no;
          qy = nq;
        }
      }
      off = noff;
      py = ny;
    }
    const geo = this.bolt.geometry;
    (geo.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (geo.getAttribute('color') as BufferAttribute).needsUpdate = true;
    geo.setDrawRange(0, this.boltN * 6);
    this.boltOn = true;
    return d;
  }

  /** 调试：现在各画了多少粒子 */
  stats(): { rain: number; snow: number; covers: number } {
    return { rain: this.rain.geometry.instanceCount, snow: this.snow.geometry.instanceCount, covers: Math.min(NCOV, this.covers.length) };
  }
}
