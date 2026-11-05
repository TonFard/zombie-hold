import { Rng } from '../core/rng';
import { BLUEPRINTS, type BlueprintId } from './blueprints';
import { MapBuilder } from './builder';
import { GRID_H, GRID_W, Ground, HALF_H, HALF_W } from './grid';
import { placeModule, type Placed } from './modules';
import type { MapData, SpawnPoint, WallStyle } from './types';

/**
 * 第 4 章 · 市区街道：最终章。街区网格 + 中央广场（核心）。
 *
 * 道路（格坐标，[a,b)）：
 *   外环街：x 8–12 / 68–72（南北向，贯通），y 8–12 / 68–72（东西向，贯通）
 *   大道：x 37–43（北、南两段，从地图边缘通到广场），y 37–43（西、东两段）
 *   广场环路：外框 [22,58)，内框 [26,54)（广场围墙）
 *   小巷：西南 x 32–37、东南 x 53–57、西侧空地 y 51–58、东侧空地 y 43–50
 * 其余是街区：可进入的建筑（蓝图）+ 进不去的实心楼体（'wall' 道具）。
 */
export function buildCity(seed = 20260404): MapData {
  const rng = new Rng(seed);
  const b = new MapBuilder(rng);
  const g = b.grid;
  const G = Ground;

  // ---------- 地面：整张图先铺沥青，街区铺人行道（混凝土）----------
  g.ground.fill(G.Asphalt);
  const blocks: Array<[number, number, number, number]> = [
    // 北、南两条街区带
    [12, 12, 37, 22],
    [43, 12, 68, 22],
    [12, 58, 37, 68],
    [43, 58, 68, 68],
    // 广场东西两侧
    [12, 22, 22, 37],
    [12, 43, 22, 58],
    [58, 22, 68, 37],
    [58, 43, 68, 58],
    // 地图边缘的楼群
    [2, 2, 8, 8],
    [12, 2, 37, 8],
    [43, 2, 68, 8],
    [72, 2, 78, 8],
    [2, 72, 8, 78],
    [12, 72, 37, 78],
    [43, 72, 68, 78],
    [72, 72, 78, 78],
    [2, 12, 8, 37],
    [2, 43, 8, 68],
    [72, 12, 78, 37],
    [72, 43, 78, 68],
  ];
  for (const [x0, y0, x1, y1] of blocks) b.ground(x0, y0, x1, y1, G.Concrete);
  // 小巷还是沥青
  b.ground(32, 58, 37, 68, G.Asphalt);
  b.ground(53, 58, 57, 68, G.Asphalt);
  // 广场
  b.ground(26, 26, 54, 54, G.Concrete);

  // ---------- 地图边界 ----------
  b.markSolid(0, 0, GRID_W, 2);
  b.markSolid(0, GRID_H - 2, GRID_W, GRID_H);
  b.markSolid(0, 2, 2, GRID_H - 2);
  b.markSolid(GRID_W - 2, 2, GRID_W, GRID_H - 2);

  // ---------- 实心楼体：进不去的街区（挡人挡子弹挡视线）----------
  const styles: WallStyle[] = ['brick', 'plaster', 'metal'];
  const mass = (x0: number, y0: number, x1: number, y1: number, h: number, style?: WallStyle) =>
    b.prop('wall', x0, y0, x1, y1, { h, style: style ?? (styles[rng.int(0, 2)] as WallStyle) });
  /** 沿长边切成几栋紧挨着的楼，高度、外墙各不相同 */
  const row = (x0: number, y0: number, x1: number, y1: number) => {
    const alongX = x1 - x0 >= y1 - y0;
    const len = alongX ? x1 - x0 : y1 - y0;
    let s = 0;
    while (s < len) {
      let e = Math.min(len, s + rng.int(5, 9));
      if (len - e < 4) e = len;
      if (alongX) mass(x0 + s, y0, x0 + e, y1, rng.range(5, 10));
      else mass(x0, y0 + s, x1, y0 + e, rng.range(5, 10));
      s = e;
    }
  };
  // 边缘楼群：贴着地图边，留 1 格人行道
  row(2, 2, 7, 7);
  row(12, 2, 37, 7);
  row(43, 2, 68, 7);
  row(73, 2, 78, 7);
  row(2, 73, 7, 78);
  row(12, 73, 37, 78);
  row(43, 73, 68, 78);
  row(73, 73, 78, 78);
  row(2, 12, 7, 37);
  row(2, 43, 7, 68);
  row(73, 12, 78, 37);
  row(73, 43, 78, 68);

  // ---------- 可进入的建筑 ----------
  const put = (id: BlueprintId, x: number, y: number, rot = 0): Placed => {
    const r = placeModule(b, BLUEPRINTS[id], x, y, rot);
    if (!r) throw new Error(`建筑 ${id} 摆不下：(${x}, ${y}) rot ${rot}`);
    return r;
  };
  // 西北：便利店 + 废墟
  const shop = put('shop', 13, 12);
  const ruinN = put('ruin', 31, 12, 1);
  // 东北：仓库 + 实心楼
  const depot = put('warehouse', 45, 13);
  mass(63, 13, 68, 21, 7.5, 'brick');
  // 广场西、东两侧的平房（门朝外环街）
  const homeW = put('house_small', 12, 23, 1);
  const homeE = put('house_small', 58, 23, 3);
  // 西南：长屋
  const homeS = put('house_long', 13, 58);
  // 东南：实心楼 + 塌了的废墟
  mass(44, 59, 53, 67, 8.5, 'brick');
  const ruinS = put('ruin', 57, 59);
  // 西侧：实心楼，南面空地
  mass(12, 43, 21, 51, 6.5, 'plaster');
  // 东侧：实心楼，北面空地（楼塌了一半）
  mass(60, 50, 68, 58, 6.0, 'metal');

  // ---------- 中央广场：围墙 6 个入口，宽窄不一 ----------
  b.walls(
    26,
    26,
    54,
    54,
    [
      { side: 'N', at: 38, w: 4 },
      { side: 'N', at: 29, w: 2 }, // 西北小门
      { side: 'E', at: 39, w: 3 },
      { side: 'E', at: 48, w: 2 }, // 东南小门
      { side: 'W', at: 38, w: 5 },
      { side: 'S', at: 36, w: 7, frame: false }, // 南墙被炸开
    ],
    2.6,
    'compound',
  );
  // 南墙缺口：瓦砾 + 塌落的墙块
  b.prop('rubble', 36, 52, 43, 56, { solid: false, variant: 2 });
  for (let y = 52; y < 56; y++) for (let x = 36; x < 43; x++) g.setRubble(g.idx(x, y));
  b.prop('chunk', 37, 54, 38, 55, { h: 1.4 });
  b.prop('chunk', 41, 55, 42, 56, { h: 1.0 });

  // 发电机（核心）、工坊
  b.prop('generator', 39, 38, 41, 40, { h: 1.3 });
  b.prop('workbench', 45, 31, 48, 32, { h: 1.1 });
  const coreCells: number[] = [];
  for (let y = 38; y < 40; y++) for (let x = 39; x < 41; x++) coreCells.push(g.idx(x, y));

  // 广场工事：集装箱挡住北门直线视野，沙袋、隔离墩、弹药箱
  b.prop('container', 36, 30, 42, 32, { variant: 0, h: 2.6 });
  b.prop('container', 28, 46, 34, 48, { variant: 1, h: 2.6 });
  b.prop('container', 49, 28, 51, 34, { variant: 0, h: 2.6 });
  b.prop('sandbag', 34, 36, 36, 37, { variant: 0 });
  b.prop('sandbag', 34, 42, 36, 43, { variant: 1 });
  b.prop('sandbag', 44, 36, 46, 37, { variant: 2 });
  b.prop('sandbag', 44, 42, 46, 43, { variant: 0 });
  b.prop('barrier', 30, 39, 31, 42, { h: 0.9 });
  b.prop('barrier', 48, 40, 49, 43, { h: 0.9 });
  b.prop('barrier', 38, 48, 42, 49, { h: 0.9 });
  for (const [x, y] of [
    [28, 28],
    [29, 28],
    [28, 29],
    [50, 50],
    [51, 50],
    [51, 49],
  ] as const) {
    b.prop('crate', x, y, x + 1, y + 1, { h: 0.9 });
  }
  b.prop('barrel', 46, 50, 47, 51);
  b.prop('barrel', 47, 50, 48, 51);
  b.prop('pallet', 31, 50, 33, 51, { h: 0.9 });

  // ---------- 街上：废弃车辆、公交（集装箱当卡车 / 大巴）、垃圾箱 ----------
  const tryProp = (kind: 'car' | 'container' | 'dumpster' | 'barrier' | 'pallet', x0: number, y0: number, x1: number, y1: number, h?: number) => {
    if (!b.isFree(x0, y0, x1, y1)) return;
    b.prop(kind, x0, y0, x1, y1, h === undefined ? {} : { h });
  };
  // 大道（6 格宽）：车贴着一侧停，另一侧留出 3–4 格
  tryProp('car', 37, 4, 39, 8);
  tryProp('car', 41, 15, 43, 19);
  tryProp('car', 37, 62, 39, 66);
  tryProp('container', 41, 69, 43, 75, 2.9); // 侧翻的大巴
  tryProp('container', 14, 37, 20, 39, 2.9); // 大巴
  tryProp('car', 3, 41, 7, 43);
  tryProp('car', 61, 41, 65, 43);
  tryProp('car', 73, 37, 77, 39);
  // 外环街只有 4 格宽，不停车：再窄大体型僵尸就过不去了
  // 小巷、空地
  tryProp('dumpster', 35, 60, 37, 61, 1.3);
  tryProp('dumpster', 55, 66, 57, 67, 1.3);
  tryProp('dumpster', 29, 13, 30, 15, 1.3);
  tryProp('dumpster', 61, 14, 62, 16, 1.3);
  tryProp('dumpster', 20, 56, 22, 57, 1.3);
  tryProp('pallet', 13, 52, 15, 53, 0.9);
  tryProp('car', 14, 54, 18, 56);
  tryProp('car', 62, 44, 66, 46);
  // 路障：大道上零散的隔离墩（和车错开，保证大体型僵尸有 2 格宽的路）
  tryProp('barrier', 37, 22, 39, 23, 0.9);
  tryProp('barrier', 41, 60, 43, 61, 0.9);
  tryProp('barrier', 22, 37, 23, 39, 0.9);
  tryProp('barrier', 57, 41, 58, 43, 0.9);

  // ---------- 瓦砾：塌楼的地方（能走但慢）----------
  const rubble = (x0: number, y0: number, x1: number, y1: number) => {
    b.prop('rubble', x0, y0, x1, y1, { solid: false, variant: rng.int(0, 3) });
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = g.idx(x, y);
        if (g.solid[i]) continue;
        g.setRubble(i);
        g.ground[i] = G.Gravel;
      }
    }
  };
  rubble(58, 46, 62, 50); // 东侧塌楼
  b.prop('chunk', 66, 47, 67, 48, { h: 1.2 });
  rubble(15, 51, 20, 54); // 西侧空地
  rubble(53, 62, 57, 65); // 东南小巷
  rubble(9, 30, 12, 34); // 外环西街
  rubble(68, 18, 71, 22); // 外环东街
  rubble(30, 21, 36, 22); // 北废墟门前

  // ---------- 刷怪点：8 条街的尽头 ----------
  const spawnDefs: Array<[string, number, number]> = [
    ['北大道', 40, 3],
    ['南大道', 39, 76],
    ['西大道', 3, 39],
    ['东大道', 76, 40],
    ['西北街', 10, 3],
    ['东北街', 76, 10],
    ['东南街', 70, 76],
    ['西南街', 3, 70],
  ];
  for (const [name, cx, cy] of spawnDefs) {
    const h = b.houses.find((q) => cx >= q.x0 - 2 && cx < q.x1 + 2 && cy >= q.y0 - 2 && cy < q.y1 + 2);
    if (h) throw new Error(`刷怪点 ${name} (${cx}, ${cy}) 离建筑太近`);
    if (g.solid[g.idx(cx, cy)]) throw new Error(`刷怪点 ${name} (${cx}, ${cy}) 压在障碍上`);
  }
  const spawns: SpawnPoint[] = spawnDefs.map(([name, cx, cy]) => ({
    name,
    cx,
    cy,
    x: cx - HALF_W + 0.5,
    z: cy - HALF_H + 0.5,
  }));

  // ---------- 零件箱：一半在屋里 ----------
  const inside = (r: Placed, k: number) => {
    const c = r.floor[Math.floor(r.floor.length * k)] as [number, number];
    return { cx: c[0], cy: c[1] };
  };
  const scrapBoxes = [
    inside(shop, 0.3),
    inside(depot, 0.5),
    inside(homeW, 0.6),
    inside(homeE, 0.7),
    inside(homeS, 0.45),
    inside(ruinN, 0.5),
    inside(ruinS, 0.4),
    b.nearestOpen(34, 64),
    b.nearestOpen(64, 47),
    b.nearestOpen(17, 56),
  ];

  // ---------- 路灯 ----------
  const lampCells: Array<[number, number]> = [
    // 大道
    [37, 10], [42, 20], [42, 59], [37, 70],
    [10, 37], [20, 42], [59, 37], [70, 42],
    // 外环街
    [8, 16], [11, 28], [8, 48], [11, 62],
    [71, 16], [68, 28], [71, 48], [68, 62],
    [18, 8], [30, 11], [50, 8], [60, 11],
    [20, 71], [28, 68], [48, 71], [62, 68],
    // 广场环路四角
    [23, 23], [56, 23], [23, 56], [56, 56],
  ];
  const lamps: Array<{ x: number; z: number }> = [];
  for (const [x, y] of lampCells) {
    if (g.solid[g.idx(x, y)]) continue;
    b.prop('lamp', x, y, x + 1, y + 1, { h: 4.2 });
    lamps.push({ x: x - HALF_W + 0.5, z: y - HALF_H + 0.5 });
  }

  // ---------- 可建造区域：广场内和每个入口外侧 ----------
  const zones: Array<[number, number, number, number]> = [
    [27, 27, 53, 53],
    [36, 18, 44, 26], // 北门
    [27, 22, 33, 26], // 西北小门
    [54, 36, 62, 44], // 东门
    [54, 46, 58, 52], // 东南小门
    [34, 54, 46, 62], // 南缺口
    [18, 36, 26, 44], // 西门
  ];
  for (const [x0, y0, x1, y1] of zones) {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = g.idx(x, y);
        if (!g.solid[i]) g.buildable[i] = 1;
      }
    }
  }

  // 玩家出生在广场里、发电机南边
  const ps = b.nearestOpen(40, 44);
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
    playerStart: { x: ps.cx - HALF_W + 0.5, z: ps.cy - HALF_H + 0.5 },
    houses: b.houses,
  };
}
