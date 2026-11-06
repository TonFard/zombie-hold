import { Rng } from '../core/rng';
import { MapBuilder } from './builder';
import { GRID_H, GRID_W, Ground, HALF_H, HALF_W } from './grid';
import type { MapData, SpawnPoint } from './types';

/**
 * 5v5 团队死斗地图「交汇站」：南北对称（蓝队在南，红队在北），三条路线——
 *   西路：仓库区，窄巷 + 集装箱，近距离；
 *   中路：开阔的广场和一条断墙，中远距离，中间一座高台（矮墙围着）抢视野；
 *   东路：停车场，车辆残骸当掩体，中距离。
 * 三条路之间有几个连接口，可以绕后。地图外圈一圈围墙，两边出生点各有一道矮墙挡枪。
 * 只用了地图里的 generator / workbench 以外的道具：TDM 不需要发电机和工坊，但 MapData 要这两个字段，
 * 放在地图外的角落里（实心格子里，碰不到也看不见）。
 */
export function buildArena(seed = 20260505): MapData {
  const rng = new Rng(seed);
  const b = new MapBuilder(rng);
  const g = b.grid;
  const G = Ground;

  // 地面：中路混凝土，西路水泥地，东路沥青，出生区碎石
  g.ground.fill(G.Concrete);
  b.ground(4, 4, 24, 76, G.Gravel);
  b.ground(56, 4, 76, 76, G.Asphalt);
  b.ground(24, 4, 56, 12, G.Gravel);
  b.ground(24, 68, 56, 76, G.Gravel);

  // 外圈：地图边界 + 一圈围墙
  b.markSolid(0, 0, GRID_W, 2);
  b.markSolid(0, GRID_H - 2, GRID_W, GRID_H);
  b.markSolid(0, 2, 2, GRID_H - 2);
  b.markSolid(GRID_W - 2, 2, GRID_W, GRID_H - 2);
  b.prop('wall', 2, 2, 78, 4, { h: 3.2, style: 'compound' });
  b.prop('wall', 2, 76, 78, 78, { h: 3.2, style: 'compound' });
  b.prop('wall', 2, 4, 4, 76, { h: 3.2, style: 'compound' });
  b.prop('wall', 76, 4, 78, 76, { h: 3.2, style: 'compound' });

  /** 南北对称地放一个道具（y → 79 − y） */
  const sym = (kind: Parameters<MapBuilder['prop']>[0], x0: number, y0: number, x1: number, y1: number, o: Parameters<MapBuilder['prop']>[5] = {}) => {
    b.prop(kind, x0, y0, x1, y1, o);
    b.prop(kind, x0, GRID_H - y1, x1, GRID_H - y0, o);
  };

  // ---- 三条路线之间的隔墙（留几个口子）----
  // 西路 | 中路：x 24–25，口子在 y 20–24、36–44（中间）、56–60
  for (const [y0, y1] of [
    [4, 20],
    [24, 36],
  ] as const)
    sym('wall', 24, y0, 26, y1, { h: 3, style: 'brick' });
  // 中路 | 东路：x 54–56
  for (const [y0, y1] of [
    [4, 18],
    [22, 35],
  ] as const)
    sym('wall', 54, y0, 56, y1, { h: 3, style: 'metal' });

  // ---- 出生区：各有一道矮墙挡住正面，左右两个出口 ----
  sym('sandbag', 30, 12, 50, 13, { h: 1.1 });
  sym('barrier', 26, 14, 29, 15, { h: 0.9 });
  sym('barrier', 51, 14, 54, 15, { h: 0.9 });

  // ---- 西路：仓库区窄巷 ----
  sym('container', 7, 16, 9, 22, { h: 2.6, variant: 0 });
  sym('container', 14, 18, 20, 20, { h: 2.6, variant: 1 });
  sym('container', 6, 28, 12, 30, { h: 5, variant: 1 });
  sym('container', 16, 26, 18, 33, { h: 2.6, variant: 0 });
  sym('crate', 11, 34, 13, 35, { h: 0.9 });
  sym('crate', 20, 31, 21, 33, { h: 0.9 });
  sym('pallet', 8, 35, 10, 36, { h: 0.9 });
  // 中线：两排货架，能从缝里对枪
  b.prop('rack', 7, 39, 12, 40, { h: 2 });
  b.prop('rack', 15, 39, 21, 40, { h: 2 });

  // ---- 中路：断墙 + 高台 ----
  sym('chunk', 31, 22, 34, 23, { h: 1.3 });
  sym('chunk', 46, 22, 49, 23, { h: 1.3 });
  sym('barrel', 38, 20, 39, 21);
  sym('barrel', 41, 20, 42, 21);
  sym('wall', 30, 30, 37, 31, { h: 2.2, style: 'plaster' });
  sym('wall', 43, 30, 50, 31, { h: 2.2, style: 'plaster' });
  sym('crate', 27, 34, 29, 36, { h: 0.9 });
  sym('crate', 51, 34, 53, 36, { h: 0.9 });
  // 中心：四面矮墙围起来的高地，矮墙后面蹲着能挡子弹，站起来能看全场
  b.prop('sandbag', 35, 37, 39, 38, { h: 1.0 });
  b.prop('sandbag', 41, 37, 45, 38, { h: 1.0 });
  b.prop('sandbag', 35, 42, 39, 43, { h: 1.0 });
  b.prop('sandbag', 41, 42, 45, 43, { h: 1.0 });
  b.prop('sandbag', 34, 38, 35, 42, { h: 1.0 });
  b.prop('sandbag', 45, 38, 46, 42, { h: 1.0 });

  // ---- 东路：停车场 ----
  for (const [x0, y0, w, h] of [
    [59, 16, 4, 2],
    [67, 18, 2, 4],
    [60, 25, 2, 4],
    [69, 28, 4, 2],
    [63, 33, 4, 2],
  ] as const)
    sym('car', x0, y0, x0 + w, y0 + h, { variant: rng.int(0, 3) });
  sym('dumpster', 72, 22, 74, 23, { h: 1.3 });
  sym('barrier', 57, 36, 60, 37, { h: 0.9 });
  b.prop('car', 58, 39, 62, 41, { variant: 3 });
  b.prop('car', 69, 39, 73, 41, { variant: 2 });

  // 路灯
  const lamps: Array<{ x: number; z: number }> = [];
  for (const [x, y] of [
    [27, 18], [52, 18], [27, 61], [52, 61],
    [40, 26], [40, 53], [14, 38], [65, 38],
    [10, 12], [70, 12], [10, 67], [70, 67],
  ] as const) {
    if (g.solid[g.idx(x, y)]) continue;
    b.prop('lamp', x, y, x + 1, y + 1, { h: 4.2 });
    lamps.push({ x: x - HALF_W + 0.5, z: y - HALF_H + 0.5 });
  }
  // 几棵树
  for (const [x, y] of [
    [5, 6], [74, 6], [5, 73], [74, 73], [22, 40], [57, 44],
  ] as const) {
    if (!g.solid[g.idx(x, y)]) b.prop('tree', x, y, x + 1, y + 1, { h: 3 });
  }

  // 发电机 / 工坊：TDM 用不到，塞在角落的实心格里（MapData 需要这两个字段）
  b.prop('generator', 0, 0, 2, 2, { h: 0.01, solid: false });
  b.prop('workbench', 0, 2, 2, 3, { h: 0.01, solid: false });
  const coreCells = [g.idx(0, 0), g.idx(1, 0), g.idx(0, 1), g.idx(1, 1)];
  const cw = (x: number) => x - HALF_W;
  const ch = (y: number) => y - HALF_H;

  // 出生点：蓝队南（y 68–74），红队北（y 5–11），每队 5 个
  const spawnRow = (team: number): SpawnPoint[] => {
    const y = team === 0 ? 72 : 7;
    return [30, 35, 40, 45, 50].map((x, i) => ({ name: `${team === 0 ? '蓝' : '红'}${i + 1}`, cx: x, cy: y, x: x - HALF_W + 0.5, z: y - HALF_H + 0.5 }));
  };
  const spawns = [...spawnRow(0), ...spawnRow(1)];
  for (const s of spawns) if (g.solid[g.idx(s.cx, s.cy)]) throw new Error(`出生点 ${s.name} 在墙里`);

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
    playerStart: { x: 40 - HALF_W + 0.5, z: 72 - HALF_H + 0.5 },
    houses: b.houses,
  };
}

/** 两队的出生点（世界坐标） */
export function arenaSpawns(map: MapData, team: 0 | 1): SpawnPoint[] {
  return map.spawns.filter((s) => s.name.startsWith(team === 0 ? '蓝' : '红'));
}
