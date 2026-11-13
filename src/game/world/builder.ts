import type { Rng } from '../core/rng';
import { GRID_H, GRID_W, Grid, SANDBAG_HALF, SLAB_HALF } from './grid';
import type { Prop, PropKind, Side, WallStyle } from './types';

/** 地图搭建工具：往网格上放道具（同时写入碰撞、子弹遮挡高度），以及一圈带门洞的墙 */

export interface Door {
  side: Side;
  /** N/S 门为起始 x，W/E 门为起始 y */
  at: number;
  w: number;
  /** 是否画门框，默认 true */
  frame?: boolean;
}

export interface PropOpts {
  solid?: boolean;
  h?: number;
  variant?: number;
  side?: Side;
  style?: WallStyle;
  /** 朝向（0–3，×90°）：家具、窗户这类有正面的道具 */
  rot?: number;
  /** 属于哪栋房子（室内道具），渲染层按它决定是否画屋顶 */
  house?: number;
}

/** 没写 h 时各类障碍的高度（米），和 render/props.ts 里的模型对齐 */
export const PROP_HEIGHT: Partial<Record<PropKind, number>> = {
  container: 2.4,
  car: 1.35,
  crate: 0.9,
  barrier: 0.9,
  pump: 1.6,
  rack: 2.0,
  chunk: 1.3,
  barrel: 0.95,
  sandbag: 0.85,
  lamp: 4.2,
  generator: 2.0,
  workbench: 1.1,
  fence: 2.1,
  pallet: 0.9,
  dumpster: 1.3,
  window: 0.95,
  furniture: 0.8,
};

/** 细障碍：按圆柱碰撞（半径，米） */
const POST_RADIUS: Partial<Record<PropKind, number>> = {
  tree: 0.3,
  lamp: 0.11,
  pillar: 0.2,
  barrel: 0.34,
  // 断墙块：0.94 × 0.4 米、朝向随机，按外接圆算，不占满整格的四个角
  chunk: 0.5,
};

/**
 * 车的模型伸出格子多少（米）：[沿车长, 沿车宽]，按 variant（渲染层按它选模型：0 轿车、1 轿车（开着门）、2 撞毁的车、3 皮卡）。
 * 车按真实长度摆（轿车 4.6 米、皮卡 5.3 米），比 4 格长；车宽算上开着的车门、后视镜。
 * 在游戏里量的（.logs/clip，0.15–1.7 米高的顶点），取比最外沿略小的值：门板很薄，蹭到一点看不出来
 */
export const CAR_PAD: ReadonlyArray<readonly [number, number]> = [
  [0.28, 0.34],
  [0.15, 0.5],
  [0.15, 0.42],
  [0.6, 0.22],
];

/** [a,b) 去掉门洞之后剩下的段 */
export function segments(a: number, b: number, gaps: Array<[number, number]>): Array<[number, number]> {
  const sorted = gaps.slice().sort((p, q) => p[0] - q[0]);
  const out: Array<[number, number]> = [];
  let cur = a;
  for (const [s, e] of sorted) {
    if (s > cur) out.push([cur, s]);
    cur = Math.max(cur, e);
  }
  if (cur < b) out.push([cur, b]);
  return out;
}

export class MapBuilder {
  readonly grid = new Grid();
  readonly props: Prop[] = [];
  /** 房子：外轮廓（格）、屋顶高度、风格 */
  readonly houses: Array<{ x0: number; y0: number; x1: number; y1: number; h: number; style: WallStyle; roof: 'flat' | 'none' }> = [];

  constructor(readonly rng: Rng) {}

  ground(x0: number, y0: number, x1: number, y1: number, g: number): void {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.grid.ground[this.grid.idx(x, y)] = g;
  }

  /** 浅水 / 泥地：能走但人和僵尸都减速（和瓦砾一样走 slow 标记，寻路会稍微绕开） */
  shallow(x0: number, y0: number, x1: number, y1: number, g: number): void {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = this.grid.idx(x, y);
        this.grid.ground[i] = g;
        this.grid.setRubble(i);
      }
    }
  }

  /** 深水（湖）：不能走，但不挡子弹和视线（障碍高度 0） */
  lake(cells: Array<[number, number]>, g: number): void {
    for (const [x, y] of cells) {
      const i = this.grid.idx(x, y);
      this.grid.ground[i] = g;
      this.grid.solid[i] = 1;
      // 不能写 0：0 会被当成"没写高度"按整面墙算
      this.grid.height[i] = 0.01;
    }
  }

  markSolid(x0: number, y0: number, x1: number, y1: number): void {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.grid.solid[this.grid.idx(x, y)] = 1;
  }

  prop(kind: PropKind, x0: number, y0: number, x1: number, y1: number, o: PropOpts = {}): Prop {
    const p: Prop = {
      kind,
      x0,
      y0,
      x1,
      y1,
      solid: o.solid ?? true,
      variant: o.variant ?? this.rng.int(0, 3),
    };
    if (o.h !== undefined) p.h = o.h;
    if (o.side !== undefined) p.side = o.side;
    if (o.style !== undefined) p.style = o.style;
    if (o.rot !== undefined) p.rot = o.rot;
    if (o.house !== undefined) p.house = o.house;
    this.props.push(p);
    if (p.solid) {
      this.markSolid(x0, y0, x1, y1);
      // 子弹 / 视线用的障碍高度，和渲染出来的模型高度一致
      const h = p.h ?? PROP_HEIGHT[kind] ?? 2.4;
      // 树干粗细跟着树高走（模型按高度等比缩放）：矮树 0.2 米、最高的 0.42 米
      const post = kind === 'tree' ? Math.min(0.42, Math.max(0.2, 0.083 * (p.h ?? 3))) : (POST_RADIUS[kind] ?? 0);
      // 栅栏：只有中间一道薄墙挡人，不是整格
      // 单排沙袋（1 格厚）同理：模型只有 0.6 米厚
      const thin = kind === 'fence' ? SLAB_HALF : kind === 'sandbag' && Math.min(x1 - x0, y1 - y0) === 1 ? SANDBAG_HALF : 0;
      const slab = thin === 0 ? 0 : (p.side ? p.side === 'N' || p.side === 'S' : x1 - x0 >= y1 - y0) ? 1 : 2;
      const carPad = kind === 'car' ? CAR_PAD[p.variant % CAR_PAD.length] : undefined;
      const long = x1 - x0 >= y1 - y0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = this.grid.idx(x, y);
          this.grid.height[i] = Math.max(this.grid.height[i] as number, h);
          this.grid.post[i] = post;
          this.grid.slab[i] = slab;
          this.grid.slabHalf[i] = thin;
          if (carPad) {
            this.grid.padX[i] = long ? carPad[0] : carPad[1];
            this.grid.padZ[i] = long ? carPad[1] : carPad[0];
          }
        }
      }
    }
    return p;
  }

  /** 一圈墙，按门洞留缺口 */
  walls(x0: number, y0: number, x1: number, y1: number, doors: Door[], h: number, style: WallStyle): void {
    const gapsOf = (side: Side): Array<[number, number]> =>
      doors.filter((d) => d.side === side).map((d) => [d.at, d.at + d.w]);
    const o = { h, style };
    for (const [s, e] of segments(x0, x1, gapsOf('N'))) this.prop('wall', s, y0, e, y0 + 1, o);
    for (const [s, e] of segments(x0, x1, gapsOf('S'))) this.prop('wall', s, y1 - 1, e, y1, o);
    for (const [s, e] of segments(y0 + 1, y1 - 1, gapsOf('W'))) this.prop('wall', x0, s, x0 + 1, e, o);
    for (const [s, e] of segments(y0 + 1, y1 - 1, gapsOf('E'))) this.prop('wall', x1 - 1, s, x1, e, o);
    for (const d of doors) {
      if (d.frame === false) continue;
      const f = { solid: false, h, style };
      if (d.side === 'N') this.prop('doorframe', d.at, y0, d.at + d.w, y0 + 1, { ...f, side: 'N' });
      if (d.side === 'S') this.prop('doorframe', d.at, y1 - 1, d.at + d.w, y1, { ...f, side: 'S' });
      if (d.side === 'W') this.prop('doorframe', x0, d.at, x0 + 1, d.at + d.w, { ...f, side: 'W' });
      if (d.side === 'E') this.prop('doorframe', x1 - 1, d.at, x1, d.at + d.w, { ...f, side: 'E' });
    }
  }

  /** 整个矩形都在界内且没有静态障碍 */
  isFree(x0: number, y0: number, x1: number, y1: number): boolean {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (x < 2 || y < 2 || x >= GRID_W - 2 || y >= GRID_H - 2) return false;
        if (this.grid.solid[this.grid.idx(x, y)]) return false;
      }
    }
    return true;
  }

  /** 找离 (cx,cy) 最近、周围 3×3 都空闲的格 */
  nearestOpen(cx: number, cy: number): { cx: number; cy: number } {
    for (let r = 0; r < 12; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (this.isFree(cx + dx - 1, cy + dy - 1, cx + dx + 2, cy + dy + 2)) return { cx: cx + dx, cy: cy + dy };
        }
      }
    }
    return { cx, cy };
  }
}
