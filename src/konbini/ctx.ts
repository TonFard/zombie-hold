import { Box3, Group, Ray, Vector3, type Material, type Object3D, type Scene, type Texture } from 'three';
import type { Atlas } from './atlas';
import type { Sfx } from './audio';
import { Kit, Solids, type MatKey, type Solid } from './kit';
export type { Solid } from './kit';

/** 可交互的东西：一个包围盒 + 提示文字 + 按 E 时做什么 */
export interface Interact {
  box: Box3;
  label: () => string;
  use: () => void;
  /** false 时暂时不能交互（例如商品已被拿走） */
  on?: () => boolean;
}

/** 世界共享的上下文：各个建造模块往里面登记网格、碰撞体、交互点和每帧动画 */
export class World {
  readonly root = new Group();
  readonly solids = new Solids();
  /** 遮挡交互射线的东西（墙、玻璃） */
  readonly walls = new Solids();
  readonly inter: Interact[] = [];
  readonly tick: Array<(dt: number, t: number) => void> = [];
  /** 雨的状态（0 = 停，1 = 下）：渐变的值由 main 每帧写入 */
  rain = 1;
  wet = 1;
  /** 玩家位置（门感应、店内判断用） */
  readonly player = new Vector3();
  /** 购物袋里的东西数量（结账前 / 结账后） */
  bag = { unpaid: 0, paid: 0 };
  holdingUmbrella = false;
  /** 屏幕下方的一行小字提示（main 里接到 DOM 上） */
  say: (s: string) => void = () => {};
  /** 世界时间（秒） */
  time = 0;

  constructor(
    readonly scene: Scene,
    readonly atlas: Atlas,
    readonly mats: Record<MatKey, Material>,
    readonly ramp: Texture,
    readonly sfx: Sfx,
  ) {
    scene.add(this.root);
  }

  /** 新建一个拼模型工具（共享图集材质；solid = 部件登记成碰撞体） */
  kit(mats: Record<MatKey, Material> = this.mats): Kit {
    return new Kit(mats, this.atlas.get('white'), this.solids);
  }

  add(o: Object3D): Object3D {
    this.root.add(o);
    return o;
  }

  /** 墙：同时是碰撞体和交互遮挡 */
  wall(minx: number, miny: number, minz: number, maxx: number, maxy: number, maxz: number): Solid {
    this.walls.add(minx, miny, minz, maxx, maxy, maxz);
    return this.solids.add(minx, miny, minz, maxx, maxy, maxz);
  }

  interact(i: Interact): Interact {
    this.inter.push(i);
    return i;
  }

  /** 按住 E 的时候选中谁：射线最近的可交互物，且前面没有墙挡住 */
  pick(ray: Ray, maxDist: number, from: Vector3, reach: number): Interact | null {
    let best: Interact | null = null;
    let bestT = maxDist;
    for (const it of this.inter) {
      if (it.on && !it.on()) continue;
      const c = it.box;
      // 先粗筛：离玩家太远的不考虑
      const dx = Math.max(c.min.x - from.x, 0, from.x - c.max.x);
      const dy = Math.max(c.min.y - from.y, 0, from.y - c.max.y);
      const dz = Math.max(c.min.z - from.z, 0, from.z - c.max.z);
      if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
      const t = rayBox(ray, c.min.x, c.min.y, c.min.z, c.max.x, c.max.y, c.max.z);
      if (t !== null && t < bestT) {
        bestT = t;
        best = it;
      }
    }
    if (!best) return null;
    for (const w of this.walls.list) {
      if (!w.on) continue;
      const t = rayBox(ray, w.minx, w.miny, w.minz, w.maxx, w.maxy, w.maxz);
      if (t !== null && t < bestT - 0.02) return null;
    }
    return best;
  }
}

/** 射线与轴对齐盒相交，返回进入距离（起点在盒内返回 0） */
export function rayBox(r: Ray, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number | null {
  let tmin = 0;
  let tmax = Infinity;
  const o = r.origin;
  const d = r.direction;
  for (const [oo, dd, a, b] of [
    [o.x, d.x, x0, x1],
    [o.y, d.y, y0, y1],
    [o.z, d.z, z0, z1],
  ] as const) {
    if (Math.abs(dd) < 1e-9) {
      if (oo < a || oo > b) return null;
      continue;
    }
    let t0 = (a - oo) / dd;
    let t1 = (b - oo) / dd;
    if (t0 > t1) [t0, t1] = [t1, t0];
    tmin = Math.max(tmin, t0);
    tmax = Math.min(tmax, t1);
    if (tmin > tmax) return null;
  }
  return tmin;
}

export const box3 = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Box3 => new Box3(new Vector3(x0, y0, z0), new Vector3(x1, y1, z1));

/** 店铺的范围（室内判断、雨的遮挡） */
export const STORE = { x0: -8, x1: 7, z0: -12, z1: -2, floor: 0.3, ceil: 3.2 };
