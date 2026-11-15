import { Color, Vector3, type Scene } from 'three';
import type { Lighting } from '../render/core/lighting';
import type { PostFX } from '../render/core/postfx';
import type { Sky } from '../render/core/sky';

/**
 * 开放世界的昼夜：一个 24 小时的钟。太阳从东边（+x）升起、偏南走、西边落下。
 * 据点模式的 Lighting 只有黄昏 → 夜晚两套颜色；这里先让它按夜晚程度算好（路灯、夜色），
 * 再按白天程度把太阳、天光、雾的颜色往白天那套拉，太阳方向由钟决定。
 */

const DAY = {
  sun: new Color(0xfff0d8),
  sunI: 3.1,
  sky: new Color(0xb9cbe2),
  ground: new Color(0x6d6450),
  hemiI: 1.35,
  fog: new Color(0x9aa6b0),
  zenith: new Color(0x4a6f9e),
};

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const MOON = new Vector3(-0.35, 0.8, 0.5).normalize();
const _sun = new Vector3();
const _zen = new Color();

export class DayCycle {
  /** 现在几点（0–24） */
  hours = 9;
  /** 第几天（从 1 开始） */
  day = 1;
  /** 一个游戏小时等于多少现实秒（60 → 一天 24 分钟） */
  secPerHour = 60;
  /** 0 = 白天 … 1 = 深夜（给后期、界面用） */
  night = 0;
  /** 0 = 不是白天 … 1 = 正午附近 */
  dayK = 1;
  fogBase = 0.0042;

  constructor(
    private readonly scene: Scene,
    private readonly lighting: Lighting,
    sky: Sky,
    private readonly post: PostFX,
  ) {
    sky.zenith = _zen;
  }

  /** 时钟文字：第 1 天 09:12 */
  label(): string {
    const h = Math.floor(this.hours);
    const m = Math.floor((this.hours - h) * 60);
    return `第 ${this.day} 天 ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  set(hours: number): void {
    this.hours = ((hours % 24) + 24) % 24;
    this.update(0, true);
  }

  update(dt: number, snap = false): void {
    this.hours += dt / this.secPerHour;
    if (this.hours >= 24) {
      this.hours -= 24;
      this.day++;
    }
    // 太阳：6 点在东边地平线，12 点最高，18 点在西边地平线
    const a = ((this.hours - 6) / 12) * Math.PI;
    const elev = Math.sin(a);
    _sun.set(Math.cos(a), Math.max(0.1, elev) * 1.15, 0.38).normalize();
    const day = smooth(0.04, 0.32, elev);
    const night = smooth(0.06, -0.16, elev);
    // 平滑过渡（跳时间时 snap）
    const k = snap ? 1 : Math.min(1, dt * 2);
    this.night += (night - this.night) * k;
    this.dayK += (day - this.dayK) * k;
    const L = this.lighting;
    L.setNight(this.night);
    const d = this.dayK;
    L.sun.color.lerp(DAY.sun, d);
    L.sun.intensity += (DAY.sunI - L.sun.intensity) * d;
    L.hemi.color.lerp(DAY.sky, d);
    L.hemi.groundColor.lerp(DAY.ground, d);
    L.hemi.intensity += (DAY.hemiI - L.hemi.intensity) * d;
    L.fog.color.lerp(DAY.fog, d);
    // 太阳方向：白天 / 黄昏跟着钟走，夜里换成月亮
    const dir = (L.dirOverride ??= new Vector3());
    dir.copy(_sun).lerp(MOON, this.night).normalize();
    // 白天路灯不亮
    L.lampsOff = d > 0.5;
    // Lighting.follow 会把雾的浓度拉向 基础值 × fogMult，所以这里换算成倍率（基础值：黄昏 0.011 → 夜 0.02）
    const want = this.fogBase * (1 + this.night * 1.1 + (1 - d) * (1 - this.night) * 0.3);
    L.fogMult = want / (0.011 + 0.009 * this.night);
    if (snap) L.fog.density = want;
    this.scene.environmentIntensity = 0.07 + (0.4 - 0.07) * (1 - this.night) + 0.15 * d;
    _zen.set(0x2c3764).lerp(DAY.zenith, d);
    this.post.setNight(this.night);
  }
}
