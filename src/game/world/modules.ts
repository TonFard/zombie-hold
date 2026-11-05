import { Ground } from './grid';
import type { MapBuilder } from './builder';
import type { FurnitureKind, PropKind, WallStyle } from './types';

/**
 * 模块化建筑：每栋房子是一张字符蓝图（1 字符 = 1 格 = 1 米），可以旋转、摆到地图任意位置。
 * 墙、门、窗都是真的碰撞体：门洞能走进去，窗台挡人但子弹从上面飞过去，屋里的家具也挡路。
 *
 * 蓝图字符：
 *   #  外墙          |  内墙（隔断，薄一些也是 1 格）
 *   D  门洞（外墙）   d  门洞（内墙，不画门框）
 *   W  窗（外墙）：0.95 米高的窗台挡人，上面空着，子弹能穿过
 *   .  室内地板       ,  室外 / 院子（不铺地板）  空格 = 什么都不放
 *   其余字母 = 家具 / 道具，见 FURNITURE 表；家具格本身也是室内地板
 *
 * 朝向：rot 0–3，按顺时针 90° 转。家具的朝向跟着转（渲染层按 rot 摆模型）。
 */

export interface Blueprint {
  name: string;
  rows: string[];
  wall: WallStyle;
  /** 墙高（米） */
  h: number;
  /** 室内地面 */
  floor: number;
  /** 屋顶：flat = 平顶（玩家在屋里时渲染层会把它藏起来）；none = 废墟 / 露天 */
  roof: 'flat' | 'none';
}

/**
 * 字母 → 家具。kind 决定碰撞高度和用什么模型；size 是占几格（宽 × 深，沿蓝图的 x / y），
 * 多格家具只在左上角那个字母处放一次，其余格写同一个字母即可（会被跳过）。
 * face：家具正面朝哪个方向（蓝图坐标里，0 = 朝 -y / 北，1 = 东，2 = 南，3 = 西）。
 */
const FURNITURE: Record<string, { kind: PropKind; f?: FurnitureKind; size: [number, number]; h?: number; face?: number }> = {
  b: { kind: 'furniture', f: 'bed', size: [1, 2], h: 0.6 },
  s: { kind: 'furniture', f: 'sofa', size: [2, 1], h: 0.85 },
  t: { kind: 'furniture', f: 'table', size: [2, 1], h: 0.8 },
  c: { kind: 'furniture', f: 'chair', size: [1, 1], h: 0.9 },
  k: { kind: 'furniture', f: 'kitchen', size: [2, 1], h: 0.95 },
  f: { kind: 'furniture', f: 'fridge', size: [1, 1], h: 1.8 },
  w: { kind: 'furniture', f: 'wardrobe', size: [1, 1], h: 2.0 },
  h: { kind: 'furniture', f: 'shelf', size: [1, 1], h: 2.0 },
  v: { kind: 'furniture', f: 'tv', size: [1, 1], h: 0.9 },
  o: { kind: 'furniture', f: 'stove', size: [1, 1], h: 0.95 },
  e: { kind: 'furniture', f: 'desk', size: [2, 1], h: 0.8 },
  r: { kind: 'rack', size: [2, 1], h: 2.0 },
  x: { kind: 'crate', size: [1, 1], h: 0.9 },
  B: { kind: 'barrel', size: [1, 1] },
  P: { kind: 'pallet', size: [1, 1], h: 0.9 },
  S: { kind: 'sandbag', size: [2, 1] },
};

/** 把蓝图坐标 (x, y)（宽 w、高 h）按 rot 转到摆放后的局部坐标 */
function turn(x: number, y: number, w: number, h: number, rot: number): [number, number] {
  switch (rot & 3) {
    case 1:
      return [h - 1 - y, x];
    case 2:
      return [w - 1 - x, h - 1 - y];
    case 3:
      return [y, w - 1 - x];
    default:
      return [x, y];
  }
}

export interface Placed {
  /** 摆放后的外轮廓（格） */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 门洞格（世界格坐标），给连通性检查和刷零件箱用 */
  doors: Array<[number, number]>;
  /** 室内空地（可以刷零件箱 / 补给） */
  floor: Array<[number, number]>;
}

/**
 * 在 (ox, oy) 摆一栋房子。墙按行 / 列合并成长段（少几个碰撞盒、渲染时少几个盒子）。
 * 返回摆放结果，失败（越界或压到已有障碍）返回 null，什么都不放。
 */
export function placeModule(b: MapBuilder, bp: Blueprint, ox: number, oy: number, rot = 0): Placed | null {
  const H = bp.rows.length;
  const W = Math.max(...bp.rows.map((r) => r.length));
  const R = rot & 3;
  const PW = R % 2 ? H : W;
  const PH = R % 2 ? W : H;
  if (!b.isFree(ox, oy, ox + PW, oy + PH)) return null;
  const at = (x: number, y: number): string => bp.rows[y]?.[x] ?? ' ';
  // 摆放后的字符图
  const map: string[][] = Array.from({ length: PH }, () => Array<string>(PW).fill(' '));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [px, py] = turn(x, y, W, H, R);
      (map[py] as string[])[px] = at(x, y);
    }
  }
  const ch = (x: number, y: number) => map[y]?.[x] ?? ' ';
  const house = b.houses.length;
  const out: Placed = { x0: ox, y0: oy, x1: ox + PW, y1: oy + PH, doors: [], floor: [] };

  // 地板
  for (let y = 0; y < PH; y++) {
    for (let x = 0; x < PW; x++) {
      const c = ch(x, y);
      if (c === ' ' || c === ',') continue;
      if (c === '#' || c === '|' || c === 'W') continue;
      b.ground(ox + x, oy + y, ox + x + 1, oy + y + 1, c === 'D' || c === 'd' ? Ground.Concrete : bp.floor);
    }
  }

  // 墙：先按行合并水平段，剩下的单格再按列合并竖直段
  const isWall = (c: string) => c === '#' || c === '|';
  const used = map.map((r) => r.map(() => false));
  const style = bp.wall;
  for (let y = 0; y < PH; y++) {
    let x = 0;
    while (x < PW) {
      if (!isWall(ch(x, y))) {
        x++;
        continue;
      }
      let e = x;
      while (e < PW && isWall(ch(e, y))) e++;
      if (e - x >= 2) {
        b.prop('wall', ox + x, oy + y, ox + e, oy + y + 1, { h: bp.h, style, house });
        for (let k = x; k < e; k++) (used[y] as boolean[])[k] = true;
      }
      x = e;
    }
  }
  for (let x = 0; x < PW; x++) {
    let y = 0;
    while (y < PH) {
      if (!isWall(ch(x, y)) || (used[y] as boolean[])[x]) {
        y++;
        continue;
      }
      let e = y;
      while (e < PH && isWall(ch(x, e)) && !(used[e] as boolean[])[x]) e++;
      b.prop('wall', ox + x, oy + y, ox + x + 1, oy + e, { h: bp.h, style, house });
      y = e;
    }
  }

  /**
   * 门 / 窗所在的那道墙沿哪个方向走：沿着同一行往两边找，碰到的第一个非门窗格是墙 → 沿 x；
   * 否则看同一列上下 → 沿 y。（门洞是 2 格宽，所以紧挨着的另一格也是门，要跳过去）
   */
  const opening = (c: string) => c === 'D' || c === 'd' || c === 'W';
  const runsAlongX = (x: number, y: number): boolean => {
    const scan = (dx: number, dy: number) => {
      let k = 1;
      while (opening(ch(x + dx * k, y + dy * k))) k++;
      return isWall(ch(x + dx * k, y + dy * k));
    };
    const alongX = scan(-1, 0) || scan(1, 0);
    const alongY = scan(0, -1) || scan(0, 1);
    return alongX || !alongY;
  };

  // 门、窗：门洞上方画过梁（doorframe 不挡路）；窗是矮墙，挡人不挡子弹
  for (let y = 0; y < PH; y++) {
    for (let x = 0; x < PW; x++) {
      const c = ch(x, y);
      const wx = ox + x;
      const wy = oy + y;
      const horiz = runsAlongX(x, y);
      if (c === 'D' || c === 'd') {
        out.doors.push([wx, wy]);
        if (c === 'D') b.prop('doorframe', wx, wy, wx + 1, wy + 1, { solid: false, h: bp.h, style, side: horiz ? 'N' : 'W', house });
      } else if (c === 'W') {
        b.prop('window', wx, wy, wx + 1, wy + 1, { h: 0.95, style, rot: horiz ? 0 : 1, house });
        // 窗台以上到墙顶的那一截（窗楣）只是装饰，碰撞按窗台高度算
        b.prop('doorframe', wx, wy, wx + 1, wy + 1, { solid: false, h: bp.h, style, side: horiz ? 'N' : 'W', house, variant: 9 });
      }
    }
  }

  // 家具：多格家具只在第一次遇到的格放
  const done = map.map((r) => r.map(() => false));
  for (let y = 0; y < PH; y++) {
    for (let x = 0; x < PW; x++) {
      const c = ch(x, y);
      const def = FURNITURE[c];
      if (!def || (done[y] as boolean[])[x]) continue;
      // 实际占的范围：从这里向右 / 向下数同一个字母
      let w = 1;
      while (ch(x + w, y) === c && w < 3) w++;
      let d = 1;
      while (ch(x, y + d) === c && d < 3) d++;
      for (let yy = y; yy < y + d; yy++) for (let xx = x; xx < x + w; xx++) (done[yy] as boolean[])[xx] = true;
      // 正面朝向：朝离得最近的空地（背靠墙）
      const face = facing(ch, x, y, w, d);
      const o: Parameters<MapBuilder['prop']>[5] = { h: def.h, rot: face, house };
      if (def.f) o.variant = FURN_IDS.indexOf(def.f);
      b.prop(def.kind, ox + x, oy + y, ox + x + w, oy + y + d, o);
    }
  }

  for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) if (ch(x, y) === '.') out.floor.push([ox + x, oy + y]);
  // 门洞两侧（穿过墙的方向）各要有 1 格空地，否则门被家具堵死：直接报错，别等到测试里才发现
  const open = (x: number, y: number) => '.,d D'.includes(ch(x, y)) || x < 0 || y < 0 || x >= PW || y >= PH;
  for (const [wx, wy] of out.doors) {
    const x = wx - ox;
    const y = wy - oy;
    // 墙沿 x 走 → 穿过门是沿 y 方向
    const ok = runsAlongX(x, y) ? open(x, y - 1) && open(x, y + 1) : open(x - 1, y) && open(x + 1, y);
    if (!ok) throw new Error(`蓝图 ${bp.name}：门 (${x}, ${y}) 前后被堵住了`);
  }
  b.houses.push({ x0: ox, y0: oy, x1: ox + PW, y1: oy + PH, h: bp.h, style, roof: bp.roof });
  return out;
}

export const FURN_IDS: FurnitureKind[] = ['bed', 'sofa', 'table', 'chair', 'kitchen', 'fridge', 'wardrobe', 'shelf', 'tv', 'stove', 'desk'];

/** 家具背靠墙：哪一侧贴着墙，正面就朝反方向（0 北 1 东 2 南 3 西） */
function facing(ch: (x: number, y: number) => string, x: number, y: number, w: number, d: number): number {
  const wallish = (c: string) => c === '#' || c === '|' || c === 'W';
  const side = (cells: Array<[number, number]>) => cells.filter(([a, b2]) => wallish(ch(a, b2))).length / cells.length;
  const n = side(Array.from({ length: w }, (_, i) => [x + i, y - 1] as [number, number]));
  const s = side(Array.from({ length: w }, (_, i) => [x + i, y + d] as [number, number]));
  const wv = side(Array.from({ length: d }, (_, i) => [x - 1, y + i] as [number, number]));
  const e = side(Array.from({ length: d }, (_, i) => [x + w, y + i] as [number, number]));
  const best = Math.max(n, s, wv, e);
  if (best === 0) return 2;
  if (best === n) return 2;
  if (best === s) return 0;
  if (best === wv) return 1;
  return 3;
}
