import { Rng } from '../core/rng';
import { BLUEPRINTS, type BlueprintId } from './blueprints';
import { MapBuilder } from './builder';
import { GRID_H, GRID_W, type Grid, Ground, HALF_H, HALF_W } from './grid';
import { placeModule, type Placed } from './modules';
import type { MapData, SpawnPoint } from './types';

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
  // 子弹高度和写实模型一致（1.3 米）：之前 2 米高，站在发电机旁边平射也会打在上面
  b.prop('generator', 39, 38, 41, 40, { h: 1.3 });
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

  // ---------- 西北：居民区（模块化房屋，都能进去）----------
  // 房子按蓝图摆（src/game/world/blueprints.ts）：墙、门、窗、家具都是碰撞体
  const put = (id: BlueprintId, x: number, y: number, rot = 0): Placed => {
    const r = placeModule(b, BLUEPRINTS[id], x, y, rot);
    if (!r) throw new Error(`建筑 ${id} 摆不下：(${x}, ${y}) rot ${rot}`);
    return r;
  };
  const homeA = put('house_small', 5, 5);
  const homeB = put('house_long', 4, 17);
  put('ruin', 23, 8);
  // 后院：垃圾箱、托盘
  b.prop('dumpster', 21, 15, 23, 16, { h: 1.3 });
  b.prop('pallet', 24, 15, 25, 16, { h: 0.9 });
  b.prop('barrel', 3, 15, 4, 16, { variant: 1 });

  // ---------- 东北：加油站（便利店 + 加油棚）----------
  const shop = put('shop', 59, 4);
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
  b.prop('dumpster', 76, 9, 78, 10, { h: 1.3 });
  b.prop('barrel', 72, 14, 73, 15);
  b.prop('barrel', 73, 14, 74, 15);

  // ---------- 东南：仓库和集装箱堆场 ----------
  const depot = put('warehouse', 58, 59);
  // 东路北侧的值班平房
  const guard = put('house_small', 63, 26, 1);
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
  if (b.isFree(56, 47, 60, 49)) b.prop('car', 56, 47, 60, 49, { variant: 2 });

  // ---------- 刷怪点 ----------
  const spawnDefs: Array<[string, number, number]> = [
    ['北左', 25, 4],
    ['北右', 54, 4],
    ['东', 75, 40],
    ['南右', 62, 75],
    ['南左', 18, 75],
    ['西', 4, 40],
  ];
  for (const [name, cx, cy] of spawnDefs) {
    const h = b.houses.find((q) => cx >= q.x0 - 2 && cx < q.x1 + 2 && cy >= q.y0 - 2 && cy < q.y1 + 2);
    if (h) throw new Error(`刷怪点 ${name} (${cx}, ${cy}) 离建筑太近`);
  }
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
    if (b.houses.some((h) => cx >= h.x0 - 2 && cx < h.x1 + 2 && cy >= h.y0 - 2 && cy < h.y1 + 2)) continue;
    if (b.props.some((p) => p.kind === 'tree' && Math.hypot((p.x0 + p.x1) / 2 - cx, (p.y0 + p.y1) / 2 - cy) < 4)) continue;
    b.prop('tree', cx, cy, cx + 1, cy + 1, { h: 2.6 + rng.range(0, 1.4) });
    trees++;
  }

  // ---------- 零件箱（白天搜刮）----------
  // 一半放在屋里（要进屋搜刮），一半在外面
  const inside = (r: Placed, k: number) => {
    const c = r.floor[Math.floor(r.floor.length * k)] as [number, number];
    return { cx: c[0], cy: c[1] };
  };
  const scrapBoxes = [
    inside(homeA, 0.7),
    inside(homeB, 0.45),
    inside(shop, 0.3),
    inside(depot, 0.5),
    inside(guard, 0.6),
    b.nearestOpen(10, 61),
    b.nearestOpen(52, 66),
    b.nearestOpen(30, 9),
  ];

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
    houses: b.houses,
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
