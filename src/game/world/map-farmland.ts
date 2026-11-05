import { Rng } from '../core/rng';
import { BLUEPRINTS, type BlueprintId } from './blueprints';
import { MapBuilder } from './builder';
import { GRID_H, GRID_W, Ground, HALF_H, HALF_W } from './grid';
import { placeModule, type Placed } from './modules';
import type { MapData, SpawnPoint } from './types';

/**
 * 第二章：荒野农场。
 * 围墙农院（院里是农舍）在地图中部偏西北，东侧是谷仓，南边一条小溪横穿全图（浅水 + 泥岸，东段有个深水塘）。
 * 四周是开阔的庄稼地和土路：视野远，步枪 / 狙击好用，但僵尸从七个方向来，南面的要先蹚过小溪。
 */
export function buildFarmland(seed = 20260314): MapData {
  const rng = new Rng(seed);
  const b = new MapBuilder(rng);
  const g = b.grid;
  const G = Ground;

  type Rect = [number, number, number, number];
  const within = (r: Rect, x: number, y: number) => x >= r[0] && x < r[2] && y >= r[1] && y < r[3];

  // ---------- 地面：荒草地，零星裸土 ----------
  g.ground.fill(G.Grass);
  for (let i = 0; i < 40; i++) {
    const cx = rng.int(3, 76);
    const cy = rng.int(3, 76);
    const r = rng.int(1, 3);
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) continue;
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r && rng.chance(0.7)) g.ground[g.idx(x, y)] = G.Dirt;
      }
    }
  }

  // 庄稼地：一垄土一垄草（犁沟），南北向 / 东西向交替
  const fields: Rect[] = [
    [56, 4, 76, 22], // 东北：玉米地
    [4, 20, 22, 40], // 西：麦田
    [56, 46, 76, 58], // 东南：收割完的地（草垛）
    [4, 49, 24, 58], // 西南：菜地
  ];
  fields.forEach(([x0, y0, x1, y1], k) => {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const furrow = k % 2 === 0 ? (x - x0) % 2 === 0 : (y - y0) % 2 === 0;
        g.ground[g.idx(x, y)] = k === 2 || furrow ? G.Dirt : G.Grass;
      }
    }
  });

  // 土路：北路、西路、东路通到院门，南路蹚过小溪
  const roads: Rect[] = [
    [46, 2, 50, 26],
    [2, 44, 26, 47],
    [54, 38, 78, 43],
    [46, 54, 50, 78],
  ];
  for (const [x0, y0, x1, y1] of roads) b.ground(x0, y0, x1, y1, G.Dirt);
  // 院子里压实的碎石地
  b.ground(27, 27, 53, 53, G.Gravel);

  // ---------- 南边的小溪：浅水 + 泥岸，东段汇成深水塘（不能走，子弹能飞过） ----------
  const pond = (x: number, y: number) => ((x - 62) / 5.5) ** 2 + ((y - 65) / 3.5) ** 2 <= 1;
  const pondShore = (x: number, y: number) => ((x - 62) / 7) ** 2 + ((y - 65) / 5) ** 2 <= 1;
  const creekCenter = (x: number) => Math.round(64 + 3 * Math.sin(x / 6));
  for (let x = 2; x < GRID_W - 2; x++) {
    const c = creekCenter(x);
    b.shallow(x, c - 2, x + 1, c - 1, G.Mud);
    b.shallow(x, c - 1, x + 1, c + 2, G.Water);
    b.shallow(x, c + 2, x + 1, c + 3, G.Mud);
  }
  const pondCells: Array<[number, number]> = [];
  for (let y = 58; y < 72; y++) {
    for (let x = 54; x < 70; x++) {
      if (pond(x, y)) pondCells.push([x, y]);
      else if (pondShore(x, y) && g.ground[g.idx(x, y)] !== G.Water && g.ground[g.idx(x, y)] !== G.Mud) g.ground[g.idx(x, y)] = G.Sand;
    }
  }
  b.lake(pondCells, G.Water);
  const isWet = (x: number, y: number) => {
    const gnd = g.ground[g.idx(x, y)];
    return gnd === G.Water || gnd === G.Mud || gnd === G.Sand;
  };

  // ---------- 地图边界 ----------
  b.markSolid(0, 0, GRID_W, 2);
  b.markSolid(0, GRID_H - 2, GRID_W, GRID_H);
  b.markSolid(0, 2, 2, GRID_H - 2);
  b.markSolid(GRID_W - 2, 2, GRID_W, GRID_H - 2);

  // ---------- 农院：五个入口，宽度各不相同 ----------
  b.walls(
    26,
    26,
    54,
    54,
    [
      { side: 'N', at: 46, w: 4 }, // 北路
      { side: 'E', at: 38, w: 5 }, // 东路（谷仓那边）
      { side: 'W', at: 44, w: 3 }, // 西路
      { side: 'S', at: 33, w: 6, frame: false }, // 南墙塌了一段
      { side: 'S', at: 47, w: 3 }, // 南路小门
    ],
    2.2,
    'compound',
  );
  // 南墙缺口：倒下的墙块
  b.prop('rubble', 33, 52, 39, 55, { solid: false, variant: 2 });
  for (let y = 52; y < 55; y++) for (let x = 33; x < 39; x++) g.setRubble(g.idx(x, y));
  b.prop('chunk', 34, 54, 35, 55, { h: 1.2 });
  b.prop('chunk', 37, 55, 38, 56, { h: 0.9 });

  const put = (id: BlueprintId, x: number, y: number, rot = 0): Placed => {
    const r = placeModule(b, BLUEPRINTS[id], x, y, rot);
    if (!r) throw new Error(`建筑 ${id} 摆不下：(${x}, ${y}) rot ${rot}`);
    return r;
  };

  // 农舍：贴着院子西北角，前门朝南开进院子
  const farmhouse = put('house_small', 27, 27);

  // 发电机（核心）、工坊
  b.prop('generator', 40, 43, 42, 45, { h: 1.3 });
  b.prop('workbench', 45, 46, 48, 47, { h: 1.1 });
  const coreCells: number[] = [];
  for (let y = 43; y < 45; y++) for (let x = 40; x < 42; x++) coreCells.push(g.idx(x, y));

  // 院里掩体：草垛（托盘）、木箱、油桶、停着的拖拉机
  b.prop('pallet', 29, 40, 31, 41, { h: 1.0 });
  b.prop('pallet', 29, 41, 31, 42, { h: 1.0 });
  b.prop('crate', 50, 30, 51, 31, { h: 0.9 });
  b.prop('crate', 51, 30, 52, 31, { h: 0.9 });
  b.prop('crate', 50, 31, 51, 32, { h: 0.9 });
  b.prop('sandbag', 33, 47, 35, 48, { variant: 0 });
  b.prop('sandbag', 49, 41, 51, 42, { variant: 1 });
  b.prop('barrel', 44, 30, 45, 31);
  b.prop('barrel', 45, 30, 46, 31, { variant: 1 });
  b.prop('car', 28, 48, 32, 50, { variant: 1 });

  // ---------- 东边：谷仓（铁皮仓库）和料场 ----------
  const barn = put('warehouse', 58, 26);
  b.prop('container', 64, 37, 70, 39, { variant: 1 });
  b.prop('pallet', 56, 35, 58, 36, { h: 1.0 });
  b.prop('barrel', 74, 30, 75, 31);
  b.prop('barrel', 74, 31, 75, 32, { variant: 2 });

  // ---------- 西北：邻居家的长屋 ----------
  const neighbor = put('house_long', 4, 6);
  b.prop('pallet', 24, 10, 25, 11, { h: 0.9 });
  b.prop('barrel', 24, 13, 25, 14);

  // ---------- 溪南：塌了的老工具棚 ----------
  const shed = put('ruin', 20, 70);

  // ---------- 田埂上的木栅栏：一段一段，留大缺口，不会围死 ----------
  const fenceH = 1.1;
  const fenceRow = (x0: number, x1: number, y: number) => {
    for (let x = x0; x < x1; x += 8) {
      const e = Math.min(x + 5, x1);
      if (b.isFree(x, y, e, y + 1)) b.prop('fence', x, y, e, y + 1, { h: fenceH, side: 'N' });
    }
  };
  const fenceCol = (x: number, y0: number, y1: number) => {
    for (let y = y0; y < y1; y += 8) {
      const e = Math.min(y + 5, y1);
      if (b.isFree(x, y, x + 1, e)) b.prop('fence', x, y, x + 1, e, { h: fenceH, side: 'W' });
    }
  };
  fenceRow(56, 76, 23); // 玉米地南沿
  fenceCol(55, 5, 22); // 玉米地西沿
  fenceRow(5, 22, 41); // 麦田南沿
  fenceCol(22, 21, 40); // 麦田东沿
  fenceRow(5, 24, 48); // 菜地北沿
  fenceRow(57, 76, 45); // 收割地北沿

  // 收割完的地里散落的草垛（矮掩体，子弹能从上面过）
  let bales = 0;
  for (let attempt = 0; attempt < 200 && bales < 7; attempt++) {
    const x = rng.int(57, 73);
    const y = rng.int(47, 56);
    const vertical = rng.chance(0.4);
    const w = vertical ? 1 : 2;
    const h = vertical ? 2 : 1;
    if (!b.isFree(x - 2, y - 2, x + w + 2, y + h + 2)) continue;
    b.prop('pallet', x, y, x + w, y + h, { h: 1.0, variant: rng.int(0, 3) });
    bales++;
  }
  // 地里扔下的拖拉机、路上抛锚的皮卡
  if (b.isFree(63, 11, 67, 13)) b.prop('car', 63, 11, 67, 13, { variant: 2 });
  if (b.isFree(9, 28, 11, 32)) b.prop('car', 9, 28, 11, 32, { variant: 3 });
  if (b.isFree(46, 13, 48, 17)) b.prop('car', 46, 13, 48, 17, { variant: 0 });
  // 溪边的几块石头 / 木箱，给南面一点掩体
  for (const [x, y] of [
    [12, 58],
    [30, 59],
    [42, 58],
    [72, 59],
  ] as const) {
    if (b.isFree(x, y, x + 1, y + 1)) b.prop('crate', x, y, x + 1, y + 1, { h: 0.9 });
  }

  // ---------- 刷怪点：七个方向 ----------
  const spawnDefs: Array<[string, number, number]> = [
    ['北路', 48, 3],
    ['东北', 76, 14],
    ['东', 76, 41],
    ['东南', 74, 76],
    ['南', 48, 76],
    ['西南', 4, 74],
    ['西', 3, 45],
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

  // ---------- 零散的树：不进院子、不上路、不进田、不下水 ----------
  const compoundZone: Rect = [22, 22, 58, 58];
  let trees = 0;
  for (let attempt = 0; attempt < 900 && trees < 28; attempt++) {
    const cx = rng.int(4, 75);
    const cy = rng.int(4, 75);
    if (within(compoundZone, cx, cy)) continue;
    if (fields.some((r) => within(r, cx, cy)) || roads.some((r) => within(r, cx, cy))) continue;
    if (isWet(cx, cy)) continue;
    if (spawns.some((s) => Math.hypot(s.cx - cx, s.cy - cy) < 7)) continue;
    if (!b.isFree(cx - 2, cy - 2, cx + 3, cy + 3)) continue;
    if (b.houses.some((h) => cx >= h.x0 - 2 && cx < h.x1 + 2 && cy >= h.y0 - 2 && cy < h.y1 + 2)) continue;
    if (b.props.some((p) => p.kind === 'tree' && Math.hypot((p.x0 + p.x1) / 2 - cx, (p.y0 + p.y1) / 2 - cy) < 5)) continue;
    b.prop('tree', cx, cy, cx + 1, cy + 1, { h: 3.0 + rng.range(0, 2.0) });
    trees++;
  }

  // ---------- 零件箱：一半在屋里，一半在野地 ----------
  const inside = (r: Placed, k: number) => {
    const c = r.floor[Math.floor(r.floor.length * k)] as [number, number];
    return { cx: c[0], cy: c[1] };
  };
  const scrapBoxes = [
    inside(farmhouse, 0.7),
    inside(barn, 0.5),
    inside(neighbor, 0.45),
    inside(shed, 0.6),
    b.nearestOpen(68, 8),
    b.nearestOpen(14, 53),
    b.nearestOpen(66, 50),
    b.nearestOpen(38, 72),
  ];

  // ---------- 路灯：乡下只有几盏，在院门外 ----------
  const lampCells: Array<[number, number]> = [
    [45, 24],
    [51, 24],
    [55, 37],
    [24, 43],
    [45, 56],
    [32, 56],
  ];
  const lamps: Array<{ x: number; z: number }> = [];
  for (const [x, y] of lampCells) {
    if (g.solid[g.idx(x, y)]) continue;
    b.prop('lamp', x, y, x + 1, y + 1, { h: 4.0 });
    lamps.push({ x: x - HALF_W + 0.5, z: y - HALF_H + 0.5 });
  }

  // ---------- 可建造区域：院子（农舍里不行）和各入口外侧 ----------
  const zones: Rect[] = [
    [27, 27, 53, 53],
    [42, 18, 54, 26], // 北门外
    [54, 36, 62, 45], // 东门外
    [18, 41, 26, 50], // 西门外
    [30, 55, 52, 59], // 南面（到溪边为止）
  ];
  const house0 = b.houses[0] as { x0: number; y0: number; x1: number; y1: number };
  for (const [x0, y0, x1, y1] of zones) {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = g.idx(x, y);
        if (x >= house0.x0 && x < house0.x1 && y >= house0.y0 && y < house0.y1) continue;
        if (!g.solid[i] && !g.slow[i]) g.buildable[i] = 1;
      }
    }
  }

  const cwx0 = 40 - HALF_W;
  const cwz0 = 43 - HALF_H;
  return {
    grid: g,
    props: b.props,
    spawns,
    coreCells,
    coreRect: { x0: cwx0, z0: cwz0, x1: cwx0 + 2, z1: cwz0 + 2 },
    corePos: { x: cwx0 + 1, z: cwz0 + 1 },
    workbench: { x0: 45 - HALF_W, z0: 46 - HALF_H, x1: 48 - HALF_W, z1: 47 - HALF_H, x: 46.5 - HALF_W, z: 46.5 - HALF_H },
    scrapBoxes,
    lamps,
    // 院子里、发电机东南边
    playerStart: { x: 44 - HALF_W + 0.5, z: 50 - HALF_H + 0.5 },
    houses: b.houses,
  };
}
