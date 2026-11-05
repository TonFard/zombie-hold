import {
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  PointLight,
  Scene,
  Vector3,
} from 'three';
import type { MapData } from '../../game/world/types';

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

const _c1 = new Color();
const _c2 = new Color();

export class Lighting {
  readonly sun: DirectionalLight;
  readonly hemi: HemisphereLight;
  readonly fog: FogExp2;
  private readonly lampLights: PointLight[] = [];
  /** 每盏灯现在挂在哪根路灯上（lampPos 的下标，-1 = 空闲）和它当前的亮度 0–1 */
  private readonly lampSlot: number[] = [];
  private readonly lampFade: number[] = [];
  private readonly lampPos: Array<{ x: number; z: number }>;
  private lampStrength = 1;
  private lampTimer = 0;
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
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.fog = new FogExp2(0x000000, 0.01);
    scene.fog = this.fog;

    this.lampPos = map.lamps;
    for (let i = 0; i < 6; i++) {
      const l = new PointLight(0xffc880, 0, 13, 2);
      l.castShadow = false;
      scene.add(l);
      this.lampLights.push(l);
      this.lampSlot.push(-1);
      this.lampFade.push(0);
    }
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
    this.sun.target.position.set(x, 0, z);
    this.sun.position.set(x + this.dir.x * 60, this.dir.y * 60, z + this.dir.z * 60);
    this.sun.target.updateMatrixWorld();
    // 雾的倍率平滑过渡
    const want = this.baseFog * this.fogMult;
    this.fog.density += (want - this.fog.density) * Math.min(1, dt * 1.5);

    // 路灯比灯光多，只有离玩家最近的几根真正打光。之前每 0.2 秒重新挑一次、直接把灯瞬移过去，
    // 走动时最近的那几根一换，路面上的光就一闪一闪。现在：挑选时留余量（已经亮着的优先保留），
    // 换下来的灯先淡出，熄灭了才挂到新的路灯上再淡入
    this.lampTimer -= dt;
    if (this.lampTimer <= 0) {
      this.lampTimer = 0.25;
      const want = this.lampPos
        .map((p, i) => ({ i, d: (p.x - x) ** 2 + (p.z - z) ** 2 }))
        // 已经挂着灯的路灯算近 15%，避免两根距离差不多的路灯来回抢
        .map((e) => (this.lampSlot.includes(e.i) ? { ...e, d: e.d * 0.72 } : e))
        .sort((a, b) => a.d - b.d)
        .slice(0, this.lampLights.length)
        .map((e) => e.i);
      const free = this.lampSlot.map((s, k) => (s < 0 || !want.includes(s) ? k : -1)).filter((k) => k >= 0);
      for (const idx of want) {
        if (this.lampSlot.includes(idx)) continue;
        // 只用已经熄灭的灯去接新路灯，正在淡出的等下一轮
        const k = free.find((f) => (this.lampFade[f] as number) <= 0.01);
        if (k === undefined) break;
        free.splice(free.indexOf(k), 1);
        this.lampSlot[k] = idx;
        const p = this.lampPos[idx] as { x: number; z: number };
        (this.lampLights[k] as PointLight).position.set(p.x + 0.4, 4.2, p.z);
      }
      for (let k = 0; k < this.lampSlot.length; k++) if ((this.lampSlot[k] as number) >= 0 && !want.includes(this.lampSlot[k] as number)) this.lampSlot[k] = -2 - (this.lampSlot[k] as number);
    }
    // 淡入淡出：挂着路灯的灯亮到 1，被换下来的（slot ≤ -2）暗到 0 后释放
    const k1 = Math.min(1, dt * 2.5);
    for (let k = 0; k < this.lampLights.length; k++) {
      const s = this.lampSlot[k] as number;
      const target = s >= 0 ? 1 : 0;
      let f = this.lampFade[k] as number;
      f += (target - f) * k1;
      if (target === 0 && f < 0.01) {
        f = 0;
        if (s <= -2) this.lampSlot[k] = -1;
      }
      this.lampFade[k] = f;
      (this.lampLights[k] as PointLight).intensity = this.lampsOff ? 0 : 38 * this.lampStrength * f;
    }
  }
}
