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
    this.sun.target.position.set(x, 0, z);
    this.sun.position.set(x + this.dir.x * 60, this.dir.y * 60, z + this.dir.z * 60);
    this.sun.target.updateMatrixWorld();
    // 雾的倍率平滑过渡
    const want = this.baseFog * this.fogMult;
    this.fog.density += (want - this.fog.density) * Math.min(1, dt * 1.5);

    // 路灯比灯光多，只有离玩家最近的几根真正打光。以前按距离挑灯、换灯时淡入淡出，走动中还是能看到光一跳一跳。
    // 现在每盏灯的亮度按"它比第 N+1 近的那根近多少"连续衰减：一根路灯被挤出前 N 名的那一刻，它的亮度正好是 0，
    // 换灯没有任何跳变（这个参考距离随玩家位置连续变化）。远处的路灯靠地上的光斑（lampPools）撑着
    const n = this.lampLights.length;
    const order = this.lampPos.map((p, i) => ({ i, d: Math.hypot(p.x - x, p.z - z) })).sort((a, b) => a.d - b.d);
    const ref = order[n]?.d ?? (order[order.length - 1]?.d ?? 0) + 8;
    const off = this.lampsOff ? 0 : 1;
    for (let k = 0; k < n; k++) {
      const l = this.lampLights[k] as PointLight;
      const e = order[k];
      if (!e) {
        l.intensity = 0;
        continue;
      }
      const p = this.lampPos[e.i] as { x: number; z: number };
      l.position.set(p.x + 0.4, 4.2, p.z);
      const w = Math.min(1, Math.max(0, (ref - e.d) / 5));
      l.intensity = 38 * this.lampStrength * w * w * (3 - 2 * w) * off;
    }
    // 停电时光斑也渐渐熄掉
    this.poolK += ((this.lampsOff ? 0 : 1) - this.poolK) * Math.min(1, dt * 3);
    this.poolMat.opacity = 0.38 * this.lampStrength * this.poolK;
    this.lampPools.visible = this.poolMat.opacity > 0.01;
  }
}
