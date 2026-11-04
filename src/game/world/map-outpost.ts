import { Rng } from '../core/rng';
import { GRID_H, GRID_W, Grid, Ground, HALF_H, HALF_W } from './grid';
import type { MapData, Prop, PropKind, Side, SpawnPoint, WallStyle } from './types';

interface Door {
  side: Side;
  /** N/S 门为起始 x，W/E 门为起始 y */
  at: number;
  w: number;
  /** 是否画门框，默认 true */
  frame?: boolean;
}

interface PropOpts {
  solid?: boolean;
  h?: number;
  variant?: number;
  side?: Side;
  style?: WallStyle;
}

/** 没写 h 时各类障碍的高度（米），和 render/props.ts 里的模型对齐 */
const PROP_HEIGHT: Partial<Record<PropKind, number>> = {
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
};

/** 细障碍：按圆柱碰撞（半径，米） */
const POST_RADIUS: Partial<Record<PropKind, number>> = {
  tree: 0.3,
  lamp: 0.11,
  pillar: 0.2,
  barrel: 0.34,
};

/** [a,b) 去掉门洞之后剩下的段 */
function segments(a: number, b: number, gaps: Array<[number, number]>): Array<[number, number]> {
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

class MapBuilder {
  readonly grid = new Grid();
  readonly props: Prop[] = [];

  constructor(readonly rng: Rng) {}

  ground(x0: number, y0: number, x1: number, y1: number, g: number): void {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.grid.ground[this.grid.idx(x, y)] = g;
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

export function buildOutpost(seed = 20260207): MapData {
  const rng = new Rng(seed);
  const b = new MapBuilder(rng);
  const g = b.grid;
  const G = Ground;

  // ---------- 地面 ----------
  g.ground.fill(G.Grass);
  for (let i = 0; i < 70; i++) {
    const cx = rng.int(3, 76);
    const cy = rng.int(3, 76);
    const r = rng.int(2, 5);
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) continue;
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r && rng.chance(0.8)) g.ground[g.idx(x, y)] = G.Dirt;
      }
    }
  }
  // 道路：四条进出据点的路
  b.ground(38, 2, 42, 26, G.Asphalt);
  b.ground(38, 54, 42, 78, G.Asphalt);
  b.ground(2, 38, 26, 42, G.Asphalt);
  b.ground(54, 38, 78, 42, G.Asphalt);
  // 停车场、加油站、仓库院
  b.ground(4, 56, 32, 74, G.Asphalt);
  b.ground(56, 14, 72, 25, G.Concrete);
  b.ground(55, 55, 77, 76, G.Gravel);
  b.ground(26, 26, 54, 54, G.Concrete);

  // ---------- 地图边界（断崖）----------
  b.markSolid(0, 0, GRID_W, 2);
  b.markSolid(0, GRID_H - 2, GRID_W, GRID_H);
  b.markSolid(0, 2, 2, GRID_H - 2);
  b.markSolid(GRID_W - 2, 2, GRID_W, GRID_H - 2);

  // ---------- 内院：4 个入口，宽度各不相同 ----------
  b.walls(
    26,
    26,
    54,
    54,
    [
      { side: 'N', at: 37, w: 6 },
      { side: 'E', at: 39, w: 3 },
      { side: 'W', at: 38, w: 4 },
      { side: 'S', at: 34, w: 8, frame: false }, // 南墙塌了一段
    ],
    2.4,
    'compound',
  );
  // 南墙缺口：瓦砾（可走但慢）和两块塌落的墙体
  b.prop('rubble', 34, 52, 42, 55, { solid: false, variant: 1 });
  for (let y = 52; y < 55; y++) for (let x = 34; x < 42; x++) g.setRubble(g.idx(x, y));
  b.prop('chunk', 36, 53, 37, 54, { h: 1.5 });
  b.prop('chunk', 40, 53, 41, 54, { h: 1.1 });

  // 发电机（核心）、工坊
  b.prop('generator', 39, 38, 41, 40, { h: 2 });
  b.prop('workbench', 45, 31, 48, 32, { h: 1.1 });
  const coreCells: number[] = [];
  for (let y = 38; y < 40; y++) for (let x = 39; x < 41; x++) coreCells.push(g.idx(x, y));
  // 内院掩体：弹药箱和沙袋
  for (const [x, y] of [
    [29, 29],
    [30, 29],
    [29, 30],
    [50, 48],
    [49, 49],
    [50, 49],
  ] as const) {
    b.prop('crate', x, y, x + 1, y + 1, { h: 0.9 });
  }
  // 沙袋、油桶都是实体掩体：挡人挡僵尸，子弹从上面能飞过去
  b.prop('sandbag', 31, 36, 33, 37, { variant: 0 });
  b.prop('sandbag', 47, 42, 49, 43, { variant: 1 });
  b.prop('barrel', 29, 48, 30, 49);
  b.prop('barrel', 30, 48, 31, 49);

  // ---------- 西北：废弃居民区（两栋砖楼 + 后巷）----------
  // 北楼：两间屋，东门通后巷，南门对着院子
  b.ground(6, 6, 19, 12, G.Floor);
  b.walls(
    5,
    5,
    20,
    13,
    [
      { side: 'S', at: 9, w: 2 },
      { side: 'E', at: 8, w: 2 },
    ],
    2.8,
    'brick',
  );
  b.prop('wall', 12, 6, 13, 10, { h: 2.8, style: 'brick' });
  b.prop('rack', 14, 6, 18, 7, { h: 2.0 });
  b.prop('crate', 6, 11, 8, 12, { h: 0.9, variant: 0 });
  b.prop('pallet', 16, 11, 18, 12, { h: 0.7 });
  // 南楼
  b.ground(6, 16, 12, 24, G.Floor);
  b.walls(
    5,
    15,
    13,
    25,
    [
      { side: 'N', at: 8, w: 2 },
      { side: 'E', at: 19, w: 2 },
    ],
    2.8,
    'brick',
  );
  b.prop('wall', 6, 20, 9, 21, { h: 2.8, style: 'brick' });
  b.prop('crate', 10, 22, 12, 24, { h: 1.8, variant: 0 });
  // 后巷：垃圾箱、托盘、烧毁的车，铁丝网隔开公路
  b.ground(13, 13, 24, 15, G.Concrete);
  b.prop('dumpster', 14, 13, 16, 14, { h: 1.3 });
  b.prop('pallet', 17, 13, 18, 14, { h: 0.9 });
  b.prop('fence', 15, 17, 23, 18, { h: 2.1 });
  b.prop('barrier', 21, 20, 22, 23, { h: 0.9 });
  b.prop('car', 21, 7, 25, 9, { variant: 2 });
  b.prop('barrel', 22, 11, 23, 12, { variant: 1 });

  // ---------- 东北：加油站（便利店 + 加油棚）----------
  b.ground(59, 7, 69, 12, G.Floor);
  b.walls(
    58,
    6,
    70,
    13,
    [
      { side: 'W', at: 8, w: 2 },
      { side: 'S', at: 63, w: 2 },
    ],
    2.8,
    'plaster',
  );
  b.prop('rack', 64, 7, 68, 8, { h: 1.8 });
  b.prop('rack', 66, 10, 69, 11, { h: 1.8 });
  b.ground(56, 14, 72, 25, G.Concrete);
  b.prop('canopy', 57, 16, 71, 23, { solid: false, h: 3.6 });
  for (const [x, y] of [
    [58, 16],
    [69, 16],
    [58, 22],
    [69, 22],
  ] as const) {
    b.prop('pillar', x, y, x + 1, y + 1, { h: 3.6 });
  }
  b.prop('pump', 62, 18, 63, 20, { h: 1.7 });
  b.prop('pump', 66, 18, 67, 20, { h: 1.7 });
  // 停在油泵边上没开走的车
  b.prop('car', 64, 17, 66, 21, { variant: 0 });
  b.prop('car', 73, 9, 77, 11, { variant: 1 });
  // 店后：垃圾箱、托盘、油桶
  b.prop('dumpster', 71, 6, 73, 7, { h: 1.3 });
  b.prop('pallet', 71, 11, 73, 12, { h: 0.9 });
  b.prop('barrel', 71, 14, 72, 15);
  b.prop('barrel', 72, 14, 73, 15);

  // ---------- 东南：仓库和集装箱堆场 ----------
  b.ground(58, 58, 74, 69, G.Floor);
  b.walls(
    57,
    57,
    75,
    70,
    [
      { side: 'N', at: 64, w: 3 },
      { side: 'W', at: 62, w: 2 },
      { side: 'E', at: 63, w: 2 },
    ],
    3.2,
    'metal',
  );
  b.prop('rack', 60, 60, 64, 61, { h: 2.0 });
  b.prop('rack', 67, 60, 72, 61, { h: 2.0 });
  b.prop('rack', 60, 66, 64, 67, { h: 2.0 });
  b.prop('rack', 67, 66, 72, 67, { h: 2.0 });
  b.prop('crate', 65, 63, 67, 65, { h: 1.84 });
  b.prop('pallet', 69, 63, 71, 64, { h: 0.9 });
  // 集装箱：南边两排叠了两层，挡住南面的视线
  b.prop('container', 56, 72, 62, 74, { variant: 0, h: 5.0 });
  b.prop('container', 66, 72, 72, 74, { variant: 1, h: 5.0 });
  b.prop('container', 53, 59, 55, 65, { variant: 1 });
  b.prop('container', 45, 67, 51, 69, { variant: 0 });
  b.prop('pallet', 52, 70, 54, 71, { h: 0.9 });

  // ---------- 西南：停车场（车辆残骸迷宫）----------
  for (const y0 of [58, 63, 68]) {
    for (const x0 of [6, 13, 20, 27]) {
      if (rng.chance(0.28)) continue;
      const vertical = rng.chance(0.45);
      const w = vertical ? 2 : 4;
      const h = vertical ? 4 : 2;
      const ox = x0 + rng.int(0, 1);
      const oy = y0 + rng.int(0, 1);
      if (b.isFree(ox - 1, oy - 1, ox + w + 1, oy + h + 1)) b.prop('car', ox, oy, ox + w, oy + h, { variant: rng.int(0, 3) });
    }
  }
  b.prop('dumpster', 3, 55, 5, 56, { h: 1.3 });

  // ---------- 散落的隔离墩、沙袋，用来改变路线 ----------
  for (const [x0, y0, x1, y1] of [
    [30, 12, 33, 13],
    [47, 14, 50, 15],
    [30, 66, 33, 67],
    [47, 64, 50, 65],
    [14, 30, 15, 33],
    [14, 46, 15, 49],
    [64, 30, 65, 33],
    [64, 46, 65, 49],
  ] as const) {
    if (b.isFree(x0, y0, x1, y1)) b.prop('barrier', x0, y0, x1, y1, { h: 0.9 });
  }
  // 公路上抛锚的车
  if (b.isFree(6, 36, 10, 38)) b.prop('car', 6, 36, 10, 38, { variant: 3 });
  if (b.isFree(70, 42, 74, 44)) b.prop('car', 70, 42, 74, 44, { variant: 2 });

  // ---------- 刷怪点 ----------
  const spawnDefs: Array<[string, number, number]> = [
    ['北左', 25, 4],
    ['北右', 60, 4],
    ['东', 75, 40],
    ['南右', 62, 75],
    ['南左', 18, 75],
    ['西', 4, 40],
  ];
  const spawns: SpawnPoint[] = spawnDefs.map(([name, cx, cy]) => ({
    name,
    cx,
    cy,
    x: cx - HALF_W + 0.5,
    z: cy - HALF_H + 0.5,
  }));

  // ---------- 枯树：只放在空旷处，不会堵住通道 ----------
  const inZone = (x: number, y: number) => x >= 20 && x < 60 && y >= 20 && y < 60;
  let trees = 0;
  for (let attempt = 0; attempt < 900 && trees < 40; attempt++) {
    const cx = rng.int(4, 75);
    const cy = rng.int(4, 75);
    if (inZone(cx, cy)) continue;
    const gnd = g.ground[g.idx(cx, cy)];
    if (gnd !== G.Grass && gnd !== G.Dirt) continue;
    if (spawns.some((s) => Math.hypot(s.cx - cx, s.cy - cy) < 8)) continue;
    if (!b.isFree(cx - 2, cy - 2, cx + 3, cy + 3)) continue;
    if (b.props.some((p) => p.kind === 'tree' && Math.hypot((p.x0 + p.x1) / 2 - cx, (p.y0 + p.y1) / 2 - cy) < 4)) continue;
    b.prop('tree', cx, cy, cx + 1, cy + 1, { h: 2.6 + rng.range(0, 1.4) });
    trees++;
  }

  // ---------- 零件箱（白天搜刮）----------
  const scrapWish: Array<[number, number]> = [
    [8, 8],
    [8, 22],
    [62, 9],
    [70, 65],
    [10, 61],
    [55, 67],
    [30, 9],
    [66, 33],
  ];
  const scrapBoxes = scrapWish.map(([x, y]) => b.nearestOpen(x, y));

  // ---------- 路灯（装饰，部分发光）----------
  const lampCells: Array<[number, number]> = [
    [36, 12], [44, 12], [36, 22], [44, 22],
    [36, 64], [44, 64], [36, 74], [44, 74],
    [14, 36], [14, 44], [22, 36], [22, 44],
    [58, 36], [58, 44], [66, 36], [66, 44],
    [28, 28], [51, 28], [28, 51], [51, 51],
  ];
  const lamps: Array<{ x: number; z: number }> = [];
  for (const [x, y] of lampCells) {
    if (g.solid[g.idx(x, y)]) continue;
    // 灯杆是实体（细圆柱碰撞），玩家能贴着走过去，子弹打中会冒火花
    b.prop('lamp', x, y, x + 1, y + 1, { h: 4.2 });
    lamps.push({ x: x - HALF_W + 0.5, z: y - HALF_H + 0.5 });
  }

  // ---------- 可建造区域：内院和各入口外侧 ----------
  const zones: Array<[number, number, number, number]> = [
    [27, 27, 53, 53],
    [34, 18, 46, 26],
    [54, 36, 62, 45],
    [32, 54, 46, 62],
    [18, 35, 26, 45],
  ];
  for (const [x0, y0, x1, y1] of zones) {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = g.idx(x, y);
        if (!g.solid[i]) g.buildable[i] = 1;
      }
    }
  }

  const cwx0 = 39 - HALF_W;
  const cwz0 = 38 - HALF_H;
  return {
    grid: g,
    props: b.props,
    spawns,
    coreCells,
    coreRect: { x0: cwx0, z0: cwz0, x1: cwx0 + 2, z1: cwz0 + 2 },
    corePos: { x: cwx0 + 1, z: cwz0 + 1 },
    workbench: { x0: 45 - HALF_W, z0: 31 - HALF_H, x1: 48 - HALF_W, z1: 32 - HALF_H, x: 46.5 - HALF_W, z: 31.5 - HALF_H },
    scrapBoxes,
    lamps,
    playerStart: { x: 0.5, z: 3.5 },
  };
}

export interface MapReport {
  unreachableSpawns: string[];
  unreachableSpawnsLarge: string[];
  unreachableScrap: number[];
  /** 非障碍但走不到核心的格子数（被封死的口袋） */
  enclosedFreeCells: number;
  freeCells: number;
}

function flood(grid: Grid, starts: number[], large: boolean): Uint8Array {
  const mask = large ? grid.inflated(true) : grid.solid;
  const seen = new Uint8Array(grid.count);
  const queue: number[] = [];
  for (const s of starts) {
    seen[s] = 1;
    queue.push(s);
  }
  for (let head = 0; head < queue.length; head++) {
    const u = queue[head] as number;
    const ux = u % GRID_W;
    const uy = (u / GRID_W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = ux + dx;
      const ny = uy + dy;
      if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) continue;
      const v = ny * GRID_W + nx;
      if (seen[v] || mask[v]) continue;
      seen[v] = 1;
      queue.push(v);
    }
  }
  return seen;
}

/** 检查地图连通性：每个刷怪点和零件箱都必须能走到核心 */
export function analyzeMap(map: MapData): MapReport {
  const { grid } = map;
  const small = flood(grid, map.coreCells, false);
  const large = flood(grid, map.coreCells, true);
  let free = 0;
  let enclosed = 0;
  for (let i = 0; i < grid.count; i++) {
    if (grid.solid[i]) continue;
    free++;
    if (!small[i]) enclosed++;
  }
  return {
    unreachableSpawns: map.spawns.filter((s) => !small[grid.idx(s.cx, s.cy)]).map((s) => s.name),
    unreachableSpawnsLarge: map.spawns.filter((s) => !large[grid.idx(s.cx, s.cy)]).map((s) => s.name),
    unreachableScrap: map.scrapBoxes.map((c, k) => (small[grid.idx(c.cx, c.cy)] ? -1 : k)).filter((k) => k >= 0),
    enclosedFreeCells: enclosed,
    freeCells: free,
  };
}
