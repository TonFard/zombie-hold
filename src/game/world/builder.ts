import type { Rng } from '../core/rng';
import { GRID_H, GRID_W, Grid } from './grid';
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
};

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
      const post = POST_RADIUS[kind] ?? 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = this.grid.idx(x, y);
          this.grid.height[i] = Math.max(this.grid.height[i] as number, h);
          this.grid.post[i] = post;
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
