import { Rng } from '../core/rng';
import { BLUEPRINTS, type BlueprintId } from './blueprints';
import { MapBuilder } from './builder';
import { GRID_H, GRID_W, Ground, HALF_H, HALF_W } from './grid';
import { placeModule, type Placed } from './modules';
import type { MapData, SpawnPoint } from './types';

/**
 * 第三章「湖畔营地」：东边三分之一是大湖（不能走，子弹 / 视线能从水面上飞过去），
 * 湖边一圈沙滩和浅水（能走但慢）。据点背靠湖，东面敞开对着水面；
 * 僵尸只能从北、西、南三面陆地过来，湖岸和木屋 / 船屋之间夹出几条窄道——霰弹枪、机枪的主场。
 */
export function buildLakeside(seed = 20260321): MapData {
  const rng = new Rng(seed);
  const b = new MapBuilder(rng);
  const g = b.grid;
  const G = Ground;

  // ---------- 湖岸线：每一行湖从哪一格开始（往东一直到地图边） ----------
  // 两个湖湾（北、南）往西咬进陆地，和木屋夹出窄道
  const cove = (y: number, cy: number, depth: number, width: number) => depth * Math.exp(-(((y - cy) / width) ** 2));
  const shoreX: number[] = [];
  for (let y = 0; y < GRID_H; y++) {
    const wobble = 2.2 * Math.sin(y * 0.13 + 0.4) + 1.2 * Math.sin(y * 0.47 + 1.3);
    shoreX.push(Math.round(55 + wobble - cove(y, 21, 6, 4.5) - cove(y, 60, 5, 4)));
  }
  const lakeCells: Array<[number, number]> = [];
  const isLake = new Uint8Array(g.count);
  for (let y = 0; y < GRID_H; y++) {
    for (let x = shoreX[y] as number; x < GRID_W; x++) {
      // 码头：一条 3 格宽的木栈道伸进湖里
      if (y >= 39 && y < 42 && x < (shoreX[y] as number) + 9) continue;
      lakeCells.push([x, y]);
      isLake[g.idx(x, y)] = 1;
    }
  }
  // 到湖的距离（切比雪夫），用来铺沙滩 / 浅水
  const dist = new Int16Array(g.count).fill(99);
  {
    const q: number[] = [];
    for (let i = 0; i < g.count; i++) if (isLake[i]) {
      dist[i] = 0;
      q.push(i);
    }
    for (let h = 0; h < q.length; h++) {
      const u = q[h] as number;
      const ux = u % GRID_W;
      const uy = (u / GRID_W) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = ux + dx;
          const ny = uy + dy;
          if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) continue;
          const v = g.idx(nx, ny);
          if (dist[v] as number <= (dist[u] as number) + 1) continue;
          dist[v] = (dist[u] as number) + 1;
          q.push(v);
        }
      }
    }
  }

  // ---------- 地面 ----------
  g.ground.fill(G.Grass);
  for (let i = 0; i < 60; i++) {
    const cx = rng.int(3, 50);
    const cy = rng.int(3, 76);
    const r = rng.int(2, 4);
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) continue;
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r && rng.chance(0.8)) g.ground[g.idx(x, y)] = G.Dirt;
      }
    }
  }
  // 沙滩：离湖 3–6 格，边缘参差
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const i = g.idx(x, y);
      const d = dist[i] as number;
      if (d >= 3 && (d <= 5 || (d === 6 && rng.chance(0.5)))) g.ground[i] = G.Sand;
    }
  }
  // 营地小路：从三面进来汇到据点
  b.ground(2, 38, 30, 41, G.Gravel);
  b.ground(38, 2, 41, 30, G.Gravel);
  b.ground(38, 50, 41, 78, G.Gravel);
  // 据点院子
  b.ground(30, 30, 50, 50, G.Dirt);
  // 西边停车场
  b.ground(12, 44, 28, 54, G.Asphalt);

  // ---------- 地图边界（断崖）----------
  b.markSolid(0, 0, GRID_W, 2);
  b.markSolid(0, GRID_H - 2, GRID_W, GRID_H);
  b.markSolid(0, 2, 2, GRID_H - 2);
  b.markSolid(GRID_W - 2, 2, GRID_W, GRID_H - 2);

  // ---------- 湖：深水 + 岸边 1–2 格浅水 ----------
  b.lake(lakeCells, G.Water);
  for (let y = 2; y < GRID_H - 2; y++) {
    for (let x = 2; x < GRID_W - 2; x++) {
      const i = g.idx(x, y);
      const d = dist[i] as number;
      if (d >= 1 && d <= 2 && !g.solid[i]) b.shallow(x, y, x + 1, y + 1, G.Water);
    }
  }
  // 湖边几块泥滩
  for (const [cx, cy] of [
    [50, 10],
    [46, 30],
    [44, 66],
    [52, 72],
  ] as const) {
    for (let y = cy - 2; y <= cy + 2; y++) {
      for (let x = cx - 3; x <= cx + 3; x++) {
        const i = g.idx(x, y);
        if (!g.solid[i] && (dist[i] as number) <= 4 && rng.chance(0.75)) b.shallow(x, y, x + 1, y + 1, G.Mud);
      }
    }
  }

  // ---------- 码头：木板地面，两侧托盘当栏杆，尽头堆几个木箱 ----------
  const pierX0 = shoreX[40] as number;
  for (let y = 39; y < 42; y++) {
    for (let x = Math.min(pierX0, shoreX[y] as number) - 2; x < pierX0 + 9; x++) {
      const i = g.idx(x, y);
      g.ground[i] = G.Floor;
      g.slow[i] = 0;
      g.extra[i] = 0;
    }
  }
  b.prop('pallet', pierX0 + 2, 39, pierX0 + 3, 40, { h: 0.9 });
  b.prop('pallet', pierX0 + 5, 41, pierX0 + 6, 42, { h: 0.9 });
  b.prop('crate', pierX0 + 8, 39, pierX0 + 9, 40, { h: 0.9 });
  b.prop('crate', pierX0 + 8, 41, pierX0 + 9, 42, { h: 0.9 });

  // ---------- 据点：背靠湖，东面敞开 ----------
  b.walls(
    30,
    30,
    50,
    50,
    [
      { side: 'N', at: 37, w: 5 },
      { side: 'W', at: 38, w: 3 },
      { side: 'S', at: 37, w: 4 },
      // 东墙整段拆掉：对着沙滩和湖面
      { side: 'E', at: 31, w: 18, frame: false },
    ],
    2.4,
    'compound',
  );
  // 发电机（核心）、工坊
  b.prop('generator', 42, 39, 44, 41, { h: 1.3 });
  b.prop('workbench', 34, 33, 37, 34, { h: 1.1 });
  const coreCells: number[] = [];
  for (let y = 39; y < 41; y++) for (let x = 42; x < 44; x++) coreCells.push(g.idx(x, y));
  // 院内掩体
  for (const [x, y] of [
    [32, 46],
    [33, 46],
    [32, 47],
    [47, 32],
  ] as const) {
    b.prop('crate', x, y, x + 1, y + 1, { h: 0.9 });
  }
  b.prop('sandbag', 46, 35, 48, 36, { variant: 0 });
  b.prop('sandbag', 46, 44, 48, 45, { variant: 1 });
  b.prop('barrel', 33, 31, 34, 32);
  b.prop('barrel', 48, 47, 49, 48);

  // ---------- 建筑 ----------
  const put = (id: BlueprintId, x: number, y: number, rot = 0): Placed => {
    const r = placeModule(b, BLUEPRINTS[id], x, y, rot);
    if (!r) throw new Error(`建筑 ${id} 摆不下：(${x}, ${y}) rot ${rot}`);
    return r;
  };
  // 北：两栋木屋，东边那栋和北湖湾夹出一条窄道
  const cabinN = put('house_small', 32, 12, 1);
  const lodge = put('house_long', 10, 8);
  // 西：长屋（营地小卖部 / 管理处）
  const office = put('shop', 8, 22, 1);
  // 南：船屋（仓库），和南湖湾夹出窄道
  const boathouse = put('warehouse', 28, 56, 1);
  const cabinS = put('house_small', 10, 60);

  // 船屋边的杂物
  b.prop('pallet', 37, 58, 38, 59, { h: 0.9 });
  b.prop('pallet', 37, 59, 38, 60, { h: 0.9 });
  b.prop('barrel', 37, 66, 38, 67);
  b.prop('dumpster', 25, 22, 27, 23, { h: 1.3 });
  b.prop('barrel', 28, 10, 29, 11, { variant: 1 });

  // 停车场：度假游客的车
  for (const x0 of [13, 18, 23]) {
    for (const y0 of [45, 50]) {
      if (rng.chance(0.3)) continue;
      const ox = x0 + rng.int(0, 1);
      if (b.isFree(ox - 1, y0 - 1, ox + 3, y0 + 4)) b.prop('car', ox, y0, ox + 2, y0 + 4, { variant: rng.int(0, 3) });
    }
  }
  // 湖岸路边抛锚的车（收窄沙滩通道）
  if (b.isFree(44, 4, 48, 6)) b.prop('car', 44, 4, 48, 6, { variant: 2 });
  if (b.isFree(46, 72, 50, 74)) b.prop('car', 46, 72, 50, 74, { variant: 1 });

  // ---------- 窄道里的沙袋 / 隔离墩（不封死，只收窄） ----------
  for (const [x0, y0, x1, y1] of [
    [45, 24, 47, 25],
    [45, 54, 47, 55],
    [22, 36, 23, 38],
    [22, 42, 23, 44],
    [34, 26, 36, 27],
    [43, 26, 45, 27],
  ] as const) {
    if (b.isFree(x0, y0, x1, y1)) b.prop('sandbag', x0, y0, x1, y1, { variant: rng.int(0, 1) });
  }

  // ---------- 刷怪点：只在北、西、南三面陆地 ----------
  const spawnDefs: Array<[string, number, number]> = [
    ['北湖岸', 50, 3],
    ['北', 30, 3],
    ['西北', 4, 4],
    ['西', 3, 40],
    ['西南', 4, 76],
    ['南', 26, 76],
    ['南湖岸', 42, 76],
  ];
  for (const [name, cx, cy] of spawnDefs) {
    const h = b.houses.find((q) => cx >= q.x0 - 2 && cx < q.x1 + 2 && cy >= q.y0 - 2 && cy < q.y1 + 2);
    if (h) throw new Error(`刷怪点 ${name} (${cx}, ${cy}) 离建筑太近`);
    if (g.solid[g.idx(cx, cy)]) throw new Error(`刷怪点 ${name} (${cx}, ${cy}) 在障碍里`);
  }
  const spawns: SpawnPoint[] = spawnDefs.map(([name, cx, cy]) => ({
    name,
    cx,
    cy,
    x: cx - HALF_W + 0.5,
    z: cy - HALF_H + 0.5,
  }));

  // ---------- 树：草地上的松树，不进据点、不挡窄道 ----------
  const inZone = (x: number, y: number) => x >= 26 && x < 54 && y >= 26 && y < 54;
  let trees = 0;
  for (let attempt = 0; attempt < 1200 && trees < 45; attempt++) {
    const cx = rng.int(4, 75);
    const cy = rng.int(4, 75);
    if (inZone(cx, cy)) continue;
    const i = g.idx(cx, cy);
    const gnd = g.ground[i];
    if (gnd !== G.Grass && gnd !== G.Dirt) continue;
    if ((dist[i] as number) < 7) continue;
    if (spawns.some((s) => Math.hypot(s.cx - cx, s.cy - cy) < 7)) continue;
    if (!b.isFree(cx - 2, cy - 2, cx + 3, cy + 3)) continue;
    if (b.houses.some((h) => cx >= h.x0 - 2 && cx < h.x1 + 2 && cy >= h.y0 - 2 && cy < h.y1 + 2)) continue;
    if (b.props.some((p) => p.kind === 'tree' && Math.hypot((p.x0 + p.x1) / 2 - cx, (p.y0 + p.y1) / 2 - cy) < 4)) continue;
    b.prop('tree', cx, cy, cx + 1, cy + 1, { h: 3.0 + rng.range(0, 1.6) });
    trees++;
  }

  // ---------- 零件箱：一半在屋里，码头尽头和沙滩上各一个 ----------
  const inside = (r: Placed, k: number) => {
    const c = r.floor[Math.floor(r.floor.length * k)] as [number, number];
    return { cx: c[0], cy: c[1] };
  };
  const scrapBoxes = [
    inside(cabinN, 0.6),
    inside(lodge, 0.45),
    inside(office, 0.3),
    inside(boathouse, 0.5),
    { cx: pierX0 + 7, cy: 40 },
    b.nearestOpen(49, 16),
    b.nearestOpen(20, 49),
    b.nearestOpen(18, 72),
  ];
  void cabinS;

  // ---------- 路灯：营地小路和湖岸 ----------
  const lampCells: Array<[number, number]> = [
    [37, 8], [41, 18], [37, 24],
    [37, 56], [41, 64], [37, 72],
    [10, 37], [18, 41], [26, 37],
    [31, 31], [48, 31], [31, 48], [48, 48],
    [pierX0 + 4, 39],
  ];
  const lamps: Array<{ x: number; z: number }> = [];
  for (const [x, y] of lampCells) {
    if (g.solid[g.idx(x, y)]) continue;
    b.prop('lamp', x, y, x + 1, y + 1, { h: 4.2 });
    lamps.push({ x: x - HALF_W + 0.5, z: y - HALF_H + 0.5 });
  }

  // ---------- 可建造区域：据点和三个陆地入口外侧、两条湖岸窄道 ----------
  const zones: Array<[number, number, number, number]> = [
    [31, 31, 53, 49],
    [34, 24, 45, 30],
    [34, 50, 45, 56],
    [24, 35, 30, 44],
    [44, 22, 52, 30],
    [44, 50, 52, 58],
  ];
  for (const [x0, y0, x1, y1] of zones) {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = g.idx(x, y);
        if (!g.solid[i]) g.buildable[i] = 1;
      }
    }
  }

  const start = b.nearestOpen(40, 44);
  const cwx0 = 42 - HALF_W;
  const cwz0 = 39 - HALF_H;
  return {
    grid: g,
    props: b.props,
    spawns,
    coreCells,
    coreRect: { x0: cwx0, z0: cwz0, x1: cwx0 + 2, z1: cwz0 + 2 },
    corePos: { x: cwx0 + 1, z: cwz0 + 1 },
    workbench: { x0: 34 - HALF_W, z0: 33 - HALF_H, x1: 37 - HALF_W, z1: 34 - HALF_H, x: 35.5 - HALF_W, z: 33.5 - HALF_H },
    scrapBoxes,
    lamps,
    playerStart: { x: start.cx - HALF_W + 0.5, z: start.cy - HALF_H + 0.5 },
    houses: b.houses,
  };
}
