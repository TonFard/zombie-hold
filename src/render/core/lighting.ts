import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  PointLight,
  Scene,
  ShaderChunk,
  Vector3,
} from 'three';
import type { MapData } from '../../game/world/types';

/**
 * 阴影边缘"跑起来就闪"的根因之一：three 的 PCF 用屏幕像素坐标（gl_FragCoord）算一个噪声去旋转 5 个采样点。
 * 相机一动，同一块地面落到不同的屏幕像素上，采样图案每帧都变，柔边上的像素就一闪一闪（噪声在画面上"爬"）。
 * 改成固定的旋转角：采样图案和阴影贴图一起锁在世界里（阴影相机已按纹素对齐），相机怎么动阴影边缘都不变。
 * 代价是柔边上可能看到很轻的条纹，radius 只有 1.2 个纹素时几乎看不出来
 */
{
  const IGN = 'float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;';
  if (ShaderChunk.shadowmap_pars_fragment.includes(IGN)) ShaderChunk.shadowmap_pars_fragment = ShaderChunk.shadowmap_pars_fragment.replace(IGN, 'float phi = 0.7;');
  else console.warn('阴影采样补丁没有生效：three 的 shadowmap_pars_fragment 改过了');
}

/** 真正打光的路灯数，和满亮 / 熄灭的距离（米） */
const LAMP_LIGHTS = 10;
const LAMP_FULL = 14;
const LAMP_FAR = 20;

const _right = new Vector3();
const _up = new Vector3();
const _p = new Vector3();

interface Look {
  sun: number;
  sunI: number;
  sunDir: [number, number, number];
  sky: number;
  ground: number;
  hemiI: number;
  fog: number;
  fogD: number;
  lamps: number;
}

/** 黄昏：低角度暖光、长阴影 */
const DUSK: Look = {
  sun: 0xffc9a0,
  sunI: 3.3,
  sunDir: [-0.62, 0.46, 0.66],
  sky: 0xb4c2de,
  ground: 0x75685a,
  hemiI: 1.5,
  fog: 0x4d4e5c,
  fogD: 0.011,
  lamps: 0.35,
};

/** 夜：冷色月光、高角度、路灯和发电机成为主要光源 */
const NIGHT: Look = {
  sun: 0x7f9bdc,
  sunI: 1.15,
  sunDir: [-0.35, 0.8, 0.5],
  sky: 0x4a5c8c,
  ground: 0x242630,
  hemiI: 0.95,
  fog: 0x0b101c,
  fogD: 0.02,
  lamps: 1.0,
};

/** 光斑贴图：中心亮、边缘柔和衰减的圆 */
function poolTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

const _c1 = new Color();
const _c2 = new Color();

export class Lighting {
  readonly sun: DirectionalLight;
  readonly hemi: HemisphereLight;
  readonly fog: FogExp2;
  private readonly lampLights: PointLight[] = [];
  /** 每盏点光源认领的路灯下标（-1 = 空着）和当前亮度 0–1 */
  private readonly lampOwner: number[] = [];
  private readonly lampLevel: number[] = [];
  private readonly lampPos: Array<{ x: number; z: number }>;
  private lampStrength = 1;
  /** 每根路灯下面一块常亮的暖色光斑（贴地加色面片），不算光照，全部一次画完 */
  private readonly lampPools: InstancedMesh;
  private readonly poolMat: MeshBasicMaterial;
  private poolK = 1;
  /** 0 = 黄昏，1 = 深夜 */
  night = 0;
  /** 夜晚词缀：雾浓度倍率（浓雾）、路灯熄灭（停电） */
  fogMult = 1;
  lampsOff = false;
  private baseFog = 0.011;

  constructor(
    private readonly scene: Scene,
    map: MapData,
    shadowSize: number,
  ) {
    this.hemi = new HemisphereLight(0xffffff, 0x444444, 1);
    scene.add(this.hemi);

    this.sun = new DirectionalLight(0xffffff, 1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    const cam = this.sun.shadow.camera;
    cam.left = -26;
    cam.right = 26;
    cam.top = 26;
    cam.bottom = -26;
    cam.near = 1;
    cam.far = 120;
    // bias：负值消除 shadow acne，但太大会让阴影从物体底部"飘"开（peter-panning）。
    // normalBias 沿法线方向偏移，对地面有帮助但对薄物体（墙、栏杆）会让阴影缩进去。
    // 旧值 bias -0.0004 / normalBias 0.04，车和集装箱底部的阴影有明显离地感。
    // 收紧 normalBias 到 0.02，阴影更贴物体底部
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.02;
    // 阴影边缘柔一点（M19）：PCF 的模糊半径。r187 去掉了 PCFSoftShadowMap，用 radius 达到同样的效果。
    // radius 太大（旧值 2.5）跑动时阴影边缘会一帧一帧地跳——texel 对齐只管整数偏移，
    // blur 核跨越多个 texel 后亚 texel 漂移仍然可见。收到 1.2 + 提高采样次数，阴影仍柔但抖动不可见
    this.sun.shadow.radius = 1.2;
    this.sun.shadow.blurSamples = 16;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.fog = new FogExp2(0x000000, 0.01);
    scene.fog = this.fog;

    this.lampPos = map.lamps;
    // 10 盏：第一章 20 米内最多 10 根路灯（按 4 张图统计），这样附近的路灯始终全亮
    for (let i = 0; i < LAMP_LIGHTS; i++) {
      const l = new PointLight(0xffc880, 0, 13, 2);
      l.castShadow = false;
      scene.add(l);
      this.lampLights.push(l);
      this.lampOwner.push(-1);
      this.lampLevel.push(0);
    }
    this.poolMat = new MeshBasicMaterial({ map: poolTexture(), color: 0xffb860, transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const pg = new PlaneGeometry(9, 9);
    pg.rotateX(-Math.PI / 2);
    this.lampPools = new InstancedMesh(pg, this.poolMat, Math.max(1, map.lamps.length));
    this.lampPools.count = map.lamps.length;
    const mtx = new Matrix4();
    map.lamps.forEach((p, i) => this.lampPools.setMatrixAt(i, mtx.makeTranslation(p.x + 0.4, 0.04, p.z)));
    this.lampPools.renderOrder = 1;
    scene.add(this.lampPools);
    this.setNight(0);
  }

  /** t：0 黄昏 → 1 夜 */
  setNight(t: number): void {
    this.night = t;
    const mix = (a: number, b: number) => a + (b - a) * t;
    _c1.set(DUSK.sun);
    _c2.set(NIGHT.sun);
    this.sun.color.copy(_c1).lerp(_c2, t);
    this.sun.intensity = mix(DUSK.sunI, NIGHT.sunI);
    _c1.set(DUSK.sky);
    _c2.set(NIGHT.sky);
    this.hemi.color.copy(_c1).lerp(_c2, t);
    _c1.set(DUSK.ground);
    _c2.set(NIGHT.ground);
    this.hemi.groundColor.copy(_c1).lerp(_c2, t);
    this.hemi.intensity = mix(DUSK.hemiI, NIGHT.hemiI);
    _c1.set(DUSK.fog);
    _c2.set(NIGHT.fog);
    this.fog.color.copy(_c1).lerp(_c2, t);
    this.baseFog = mix(DUSK.fogD, NIGHT.fogD);
    this.fog.density = this.baseFog * this.fogMult;
    this.scene.background = this.fog.color;
    this.lampStrength = mix(DUSK.lamps, NIGHT.lamps);
    // 环境反射光夜里要收掉，否则夜晚也像白天
    this.scene.environmentIntensity = mix(0.4, 0.07);
  }

  /** 从目标指向太阳的单位向量 */
  readonly dir = new Vector3();

  /** 让阴影相机跟着目标走，并按目标附近最近的路灯分配有限的点光源 */
  follow(x: number, z: number, dt: number): void {
    const t = this.night;
    const d = [
      DUSK.sunDir[0] + (NIGHT.sunDir[0] - DUSK.sunDir[0]) * t,
      DUSK.sunDir[1] + (NIGHT.sunDir[1] - DUSK.sunDir[1]) * t,
      DUSK.sunDir[2] + (NIGHT.sunDir[2] - DUSK.sunDir[2]) * t,
    ] as const;
    this.dir.set(d[0], d[1], d[2]).normalize();
    // 对齐到阴影贴图的一个像素（在光源视角的平面里取整）：阴影随玩家移动时一格一格地走，边缘不会每帧抖动
    const cam = this.sun.shadow.camera;
    const texel = (cam.right - cam.left) / this.sun.shadow.mapSize.x;
    _right.set(this.dir.z, 0, -this.dir.x).normalize();
    _up.crossVectors(this.dir, _right).normalize();
    _p.set(x, 0, z);
    const a = Math.round(_p.dot(_right) / texel) * texel;
    const b = Math.round(_p.dot(_up) / texel) * texel;
    const c = _p.dot(this.dir);
    _p.copy(_right).multiplyScalar(a).addScaledVector(_up, b).addScaledVector(this.dir, c);
    this.sun.target.position.copy(_p);
    this.sun.position.copy(_p).addScaledVector(this.dir, 60);
    this.sun.target.updateMatrixWorld();
    // 雾的倍率平滑过渡
    const want = this.baseFog * this.fogMult;
    this.fog.density += (want - this.fog.density) * Math.min(1, dt * 1.5);

    // 路灯比灯光多，只有离玩家最近的几根真正打光（6 盏点光源）。
    // 以前每帧按距离重新排序，第 k 近的路灯用第 k 盏灯：两根路灯的远近一交换，同一盏灯就从这根瞬移到那根
    // （实测一帧跳 10–22 米、亮度不变），画面上看就是灯光在闪。
    // 现在每盏灯"认领"一根路灯，只要那根还在最近的 N 根里就一直跟着它；被挤出去时先淡到 0，
    // 再去认领新进来的那根（从 0 淡入）。亮度仍按"比第 N+1 近的那根近多少"连续衰减，所以换灯时亮度本来就是 0
    // 亮度只看"这根路灯离玩家多远"（固定的 LAMP_FULL → LAMP_FAR 米淡出），不再看"比第 N+1 近的那根近多少"：
    // 以前那个参考距离随着走路一直在变，身边 8–12 米的路灯会在 0 和满亮之间来回变（实测 6.5 / 0.1 / 16 / 11.9，满亮是 38），
    // 跑起来地面上的灯光就一明一暗地晃。现在 14 米内一律满亮，淡出发生在 14–20 米外
    const n = this.lampLights.length;
    const order = this.lampPos.map((p, i) => ({ i, d: Math.hypot(p.x - x, p.z - z) })).sort((a, b) => a.d - b.d);
    // 灯不够用时（离得近的路灯比 N 多）才退回按名次淡出
    const ref = Math.min(LAMP_FAR, order[n]?.d ?? Infinity);
    const full = Math.min(LAMP_FULL, ref - 3);
    const off = this.lampsOff ? 0 : 1;
    const wanted = new Set(order.slice(0, n).map((e) => e.i));
    const dist = new Map(order.map((e) => [e.i, e.d]));
    // 1) 认领的路灯已经不在前 N 名：放手（这时它的目标亮度是 0，见下面的衰减公式）
    for (let k = 0; k < n; k++) {
      const own = this.lampOwner[k] as number;
      if (own >= 0 && !wanted.has(own)) this.lampOwner[k] = -1;
    }
    // 2) 前 N 名里还没被认领的路灯，分给空着的灯
    const taken = new Set(this.lampOwner.filter((o) => o >= 0));
    for (const i of wanted) {
      if (taken.has(i)) continue;
      const free = this.lampOwner.indexOf(-1);
      if (free < 0) break;
      this.lampOwner[free] = i;
      taken.add(i);
      // 新认领：从 0 开始淡入，位置直接放过去（这时亮度是 0，看不出移动）
      this.lampLevel[free] = 0;
    }
    for (let k = 0; k < n; k++) {
      const l = this.lampLights[k] as PointLight;
      const own = this.lampOwner[k] as number;
      let target = 0;
      if (own >= 0) {
        const p = this.lampPos[own] as { x: number; z: number };
        l.position.set(p.x + 0.4, 4.2, p.z);
        const w = Math.min(1, Math.max(0, (ref - (dist.get(own) as number)) / Math.max(1, ref - full)));
        target = w * w * (3 - 2 * w);
      }
      // 亮度平滑跟随目标（约 0.15 秒），即使目标突变也不会一帧跳过去
      const cur = this.lampLevel[k] as number;
      this.lampLevel[k] = cur + (target - cur) * Math.min(1, dt * 7);
      l.intensity = 38 * this.lampStrength * (this.lampLevel[k] as number) * off;
    }
    // 停电时光斑也渐渐熄掉
    this.poolK += ((this.lampsOff ? 0 : 1) - this.poolK) * Math.min(1, dt * 3);
    this.poolMat.opacity = 0.38 * this.lampStrength * this.poolK;
    this.lampPools.visible = this.poolMat.opacity > 0.01;
  }
}
