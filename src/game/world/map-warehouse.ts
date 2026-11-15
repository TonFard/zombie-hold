import { Rng } from '../core/rng';
import { MapBuilder } from './builder';
import { GRID_H, GRID_W, Ground, HALF_H, HALF_W } from './grid';
import { placeModule, type Blueprint } from './modules';
import type { MapData, SpawnPoint } from './types';

/**
 * 8v8 对战地图「北港仓库」：南北对称（一队在南，一队在北，半场换边），中间一座大库房，四条路——
 *   堆场（西）：露天的集装箱堆场，箱子之间是窄巷，中远距离，能从库房西侧的门窗打进打出；
 *   库房（中）：一排排货架隔出来的过道，正中横着一只集装箱挡住南北通视，近距离为主；
 *   后巷（东）：库房和办公楼之间一条 6 米宽的直巷，垃圾箱、木箱当掩体，长枪的地方；
 *   办公楼（最东）：隔成几间的小楼，贴脸。
 * 库房南北两头各有一条横向的装卸场，把四条路连起来；出生区在最外面，前面有几段矮墙挡着。
 *
 * MapData 要有发电机和工坊这两个字段，对战用不到：塞在地图外的角落（实心格子里，碰不到也看不见）。
 */

/** 库房的北半边（南半边是它的镜像）：32 × 18 */
const HALL_NORTH = [
  '####DD########DDDD##############',
  '#.....................|........#',
  '#..xx.................|.ee...h.#',
  '#..xx.......PP........d........#',
  '#.....................d.....c..#',
  '#..r..r..r..........r.|||dd||||#',
  '#..r..r..r..........r..........#',
  '#..r..r..r..........r..r..r..x.#',
  '#..r..r..r..........r..r..r....W',
  'D..r..r..r..........r..r..r....W',
  'D..............................#',
  '#..............................#',
  '#..r..r..r..r......r..r..r..r..#',
  '#..r..r..r..r..B.B.r..r..r..r..#',
  'W..r..r..r..r......r..r..r..r..#',
  'W..............................#',
  '#....PP...........xx.....PP....#',
  '#..............................D',
];

/** 办公楼的北半边：14 × 13 */
const OFFICE_NORTH = [
  '####DD##WW####',
  '#............#',
  '#.ee....h.h..#',
  '#.c..........#',
  'W............#',
  'W............#',
  '#|dd|||||dd||#',
  '#.....|......#',
  'D.....d...ee.#',
  'D.....d...c..#',
  '#.....|......#',
  '#.ss..|..h.h.#',
  'W.....|......#',
];

const mirrored = (rows: string[]): string[] => [...rows, ...rows.slice().reverse()];

const HALL: Blueprint = { name: '库房', rows: mirrored(HALL_NORTH), wall: 'metal', h: 6, floor: Ground.Concrete, roof: 'flat' };
const OFFICE: Blueprint = { name: '办公楼', rows: mirrored(OFFICE_NORTH), wall: 'plaster', h: 3.2, floor: Ground.Floor, roof: 'flat' };

/** 库房、办公楼左上角的格子 */
const HALL_AT = [24, 22] as const;
const OFFICE_AT = [62, 27] as const;

/** 出生的那一排（格子 y）和每个人的 x */
const SPAWN_Y = [GRID_H - 9, 8] as const;
const SPAWN_X = [19, 25, 31, 37, 43, 49, 55, 61];

/** 买东西的地方：出生区那一条（格子 y，含两头）。0 = 南，1 = 北 */
export const BUY_ZONE: ReadonlyArray<readonly [number, number]> = [
  [GRID_H - 14, GRID_H - 4],
  [4, 14],
];

/**
 * 人机走的四条路（格子坐标，从南到北）：堆场、库房、后巷、办公楼。
 * 南边的队伍顺着走，北边的倒着走；中间那个点在地图中线上，两队在那一带碰面
 */
export const ROUTES: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[13, 62], [22, 50], [22, 40], [22, 29], [13, 17]],
  [[40, 62], [40, 52], [33, 40], [40, 27], [40, 17]],
  [[60, 60], [59, 50], [57, 40], [59, 29], [60, 20]],
  [[66, 60], [66, 49], [65, 40], [66, 30], [66, 19]],
];
/** 8 个人怎么分到四条路上（下标 = 队里第几个） */
export const ROUTE_OF = [1, 0, 2, 1, 3, 0, 1, 2];

export function buildWarehouse(seed = 20261114): MapData {
  const rng = new Rng(seed);
  const b = new MapBuilder(rng);
  const g = b.grid;
  const G = Ground;

  // 地面：装卸场沥青，堆场碎石，后巷水泥，出生区碎石
  g.ground.fill(G.Asphalt);
  b.ground(4, 14, 24, 66, G.Gravel);
  b.ground(56, 27, 62, 53, G.Concrete);
  b.ground(4, 4, 76, 14, G.Gravel);
  b.ground(4, 66, 76, 76, G.Gravel);
  // 库房大门口的水泥坡道
  b.ground(36, 18, 44, 22, G.Concrete);
  b.ground(36, 58, 44, 62, G.Concrete);

  // 两栋楼先摆（placeModule 要求那一块是空的）
  const hall = placeModule(b, HALL, HALL_AT[0], HALL_AT[1]);
  const office = placeModule(b, OFFICE, OFFICE_AT[0], OFFICE_AT[1]);
  if (!hall || !office) throw new Error('北港仓库：库房 / 办公楼放不下');

  // 外圈：地图边界 + 一圈围墙
  b.markSolid(0, 0, GRID_W, 2);
  b.markSolid(0, GRID_H - 2, GRID_W, GRID_H);
  b.markSolid(0, 2, 2, GRID_H - 2);
  b.markSolid(GRID_W - 2, 2, GRID_W, GRID_H - 2);
  b.prop('wall', 2, 2, 78, 4, { h: 3.4, style: 'compound' });
  b.prop('wall', 2, 76, 78, 78, { h: 3.4, style: 'compound' });
  b.prop('wall', 2, 4, 4, 76, { h: 3.4, style: 'compound' });
  b.prop('wall', 76, 4, 78, 76, { h: 3.4, style: 'compound' });

  type Kind = Parameters<MapBuilder['prop']>[0];
  type Opts = Parameters<MapBuilder['prop']>[5];
  /** 南北对称地放一个道具（y → 80 − y）；跨在中线上的只放一次 */
  const sym = (kind: Kind, x0: number, y0: number, x1: number, y1: number, o: Opts = {}) => {
    b.prop(kind, x0, y0, x1, y1, o);
    if (y0 + y1 !== GRID_H) b.prop(kind, x0, GRID_H - y1, x1, GRID_H - y0, o);
  };

  // ---- 出生区前面的几段矮墙：挡住从装卸场直接打进来的枪线，中间留口子 ----
  for (const [x0, x1] of [
    [10, 17],
    [26, 34],
    [46, 54],
    [63, 70],
  ] as const)
    sym('wall', x0, 12, x1, 13, { h: 2.4, style: 'compound' });

  // ---- 库房里面：过道里的集装箱 ----
  // 大门进来往西一点竖着一只（挡住门口到货架区的斜线）；正中横着一只，南北大门之间不通视
  sym('container', 35, 26, 37, 32, { h: 2.6, variant: 0, house: 0 });
  b.prop('container', 37, 39, 43, 41, { h: 2.6, variant: 1, house: 0 });
  sym('crate', 40, 31, 42, 33, { h: 0.9, house: 0 });

  // ---- 堆场（西）：集装箱错开摆，中间留弯弯曲曲的路 ----
  sym('container', 6, 16, 12, 18, { h: 2.6, variant: 0 });
  sym('container', 16, 15, 18, 21, { h: 2.6, variant: 1 });
  sym('container', 8, 22, 10, 28, { h: 5, variant: 1 });
  sym('container', 13, 24, 19, 26, { h: 2.6, variant: 0 });
  sym('container', 6, 31, 8, 37, { h: 2.6, variant: 1 });
  sym('container', 12, 31, 18, 33, { h: 5, variant: 0 });
  b.prop('container', 9, 39, 15, 41, { h: 2.6, variant: 1 });
  // 中线两边各一只，中间留一个两米的口子
  sym('container', 18, 33, 20, 39, { h: 2.6, variant: 0 });
  sym('pallet', 14, 28, 16, 29, { h: 0.9 });
  sym('sandbag', 18, 29, 21, 30, { h: 1.0 });
  sym('barrel', 11, 20, 12, 21);
  sym('barrel', 21, 22, 22, 23);
  sym('crate', 4, 26, 5, 28, { h: 0.9 });
  sym('pallet', 22, 36, 23, 38, { h: 0.9 });

  // ---- 装卸场（库房南北两头）----
  sym('car', 28, 16, 32, 18, { variant: 3 });
  sym('sandbag', 33, 18, 36, 19, { h: 1.0 });
  sym('sandbag', 43, 18, 46, 19, { h: 1.0 });
  sym('barrier', 47, 16, 50, 17, { h: 0.9 });
  sym('crate', 51, 18, 53, 20, { h: 0.9 });
  sym('pallet', 25, 20, 27, 21, { h: 0.9 });

  // ---- 办公楼前后的停车场 ----
  sym('car', 58, 16, 62, 18, { variant: 0 });
  sym('car', 66, 21, 70, 23, { variant: 3 });
  sym('car', 72, 15, 74, 19, { variant: 2 });
  sym('dumpster', 63, 25, 65, 26, { h: 1.3 });
  sym('barrier', 57, 22, 60, 23, { h: 0.9 });

  // ---- 后巷：掩体左右交错，不能一枪打到底 ----
  sym('dumpster', 56, 31, 58, 32, { h: 1.3 });
  b.prop('container', 58, 37, 60, 43, { h: 2.6, variant: 0 });
  sym('crate', 60, 33, 62, 34, { h: 0.9 });
  sym('barrel', 60, 29, 61, 30);

  // 路灯
  const lamps: Array<{ x: number; z: number }> = [];
  for (const [x, y] of [
    [22, 14], [57, 14], [22, 65], [57, 65],
    [5, 40], [74, 24], [74, 55], [40, 15], [40, 64],
    [12, 9], [67, 9], [12, 70], [67, 70],
  ] as const) {
    if (g.solid[g.idx(x, y)]) continue;
    b.prop('lamp', x, y, x + 1, y + 1, { h: 4.2 });
    lamps.push({ x: x - HALF_W + 0.5, z: y - HALF_H + 0.5 });
  }
  // 几棵树
  for (const [x, y] of [
    [5, 5], [74, 5], [5, 74], [74, 74], [4, 14], [4, 65], [75, 14], [75, 65],
  ] as const) {
    if (!g.solid[g.idx(x, y)]) b.prop('tree', x, y, x + 1, y + 1, { h: 3.2 });
  }

  // 发电机 / 工坊：对战用不到，塞在角落的实心格里
  b.prop('generator', 0, 0, 2, 2, { h: 0.01, solid: false });
  b.prop('workbench', 0, 2, 2, 3, { h: 0.01, solid: false });
  const coreCells = [g.idx(0, 0), g.idx(1, 0), g.idx(0, 1), g.idx(1, 1)];
  const cw = (x: number) => x - HALF_W;
  const ch = (y: number) => y - HALF_H;

  // 出生点：南边一排、北边一排，每边 8 个
  const spawnRow = (side: 0 | 1): SpawnPoint[] => SPAWN_X.map((x, i) => ({ name: `${side === 0 ? '南' : '北'}${i + 1}`, cx: x, cy: SPAWN_Y[side], x: x - HALF_W + 0.5, z: SPAWN_Y[side] - HALF_H + 0.5 }));
  const spawns = [...spawnRow(0), ...spawnRow(1)];
  for (const s of spawns) if (g.solid[g.idx(s.cx, s.cy)]) throw new Error(`出生点 ${s.name} 在墙里`);
  for (const r of ROUTES) for (const [x, y] of r) if (g.solid[g.idx(x, y)]) throw new Error(`路线上的点 (${x}, ${y}) 在墙里`);

  return {
    grid: g,
    props: b.props,
    spawns,
    coreCells,
    coreRect: { x0: cw(0), z0: ch(0), x1: cw(2), z1: ch(2) },
    corePos: { x: cw(1), z: ch(1) },
    workbench: { x0: cw(0), z0: ch(2), x1: cw(2), z1: ch(3), x: cw(1), z: ch(2.5) },
    scrapBoxes: [],
    lamps,
    playerStart: { x: 37 - HALF_W + 0.5, z: SPAWN_Y[0] - HALF_H + 0.5 },
    houses: b.houses,
  };
}

/** 南边（0）/ 北边（1）的出生点 */
export function arenaSpawns(map: MapData, side: 0 | 1): SpawnPoint[] {
  return map.spawns.filter((s) => s.name.startsWith(side === 0 ? '南' : '北'));
}
