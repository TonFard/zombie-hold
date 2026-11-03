// 无头寻路验证：npm run sim:nav
// 固定随机种子，不依赖浏览器。任何一项不达标都会以退出码 1 结束。
import type { ZombieKind } from '../../src/game/data/zombies';
import { FlowField, INF } from '../../src/game/nav/flowfield';
import { Game, STEP } from '../../src/game/sim';
import { analyzeMap } from '../../src/game/world/map-outpost';

interface Result {
  name: string;
  zombies: number;
  arrivedRate: number;
  maxStuck: number;
  stuckEvents: number;
  violations: number;
  msPerTick: number;
  extra: Record<string, number | string>;
  stuckInfo: string[];
}

/** 用环境变量 SIM_SEED 换随机种子，确认结果不依赖某一个种子 */
const SEED = Number(process.env.SIM_SEED ?? 7);
const failures: string[] = [];
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures.push(msg);
};

function pickKind(g: Game): ZombieKind {
  const r = g.rng.next();
  if (r < 0.62) return 'walker';
  if (r < 0.82) return 'runner';
  if (r < 0.9) return 'bloater';
  return 'breaker';
}

/** 模拟一夜的刷怪节奏：前 6 秒每秒从每个入口出 6 只，另外每个入口各出一只巨像 */
function spawnHorde(g: Game, t: number, state: { colossus: boolean }): void {
  for (let s = 0; s < g.map.spawns.length; s++) {
    for (let k = 0; k < 6; k++) g.spawnAtGate(pickKind(g), s);
    if (!state.colossus && t < 0.1) g.spawnAtGate('colossus', s);
  }
  state.colossus = true;
}

function coreDist(g: Game, x: number, z: number): number {
  const f = g.nav.field('core', false, g.grid.indexAt(x, z));
  return f.dist[g.grid.indexAt(x, z)] as number;
}

function sealGates(g: Game): number {
  let n = 0;
  const place = (cx: number, cy: number) => {
    if (g.addStructure('barricade', cx, cy, true)) n++;
  };
  for (let x = 37; x < 43; x++) place(x, 26); // 北
  for (let y = 39; y < 42; y++) place(53, y); // 东
  for (let y = 38; y < 42; y++) place(26, y); // 西
  for (let x = 34; x < 42; x++) place(x, 53); // 南（塌口）
  return n;
}

interface RunOpts {
  name: string;
  seconds: number;
  setup?: (g: Game) => void;
  onSecond?: (g: Game, sec: number) => void;
  spawnSeconds?: number;
  seed?: number;
}

function run(o: RunOpts): Result {
  const g = new Game(o.seed ?? SEED);
  g.invulnerableCore = true;
  g.invulnerablePlayer = true;
  o.setup?.(g);

  const attacked = new Set<number>();
  const all = new Set<number>();
  let violations = 0;
  let tickMs = 0;
  let ticks = 0;
  const spawnState = { colossus: false };
  const spawnSeconds = o.spawnSeconds ?? 6;
  const total = Math.round(o.seconds / STEP);

  for (let t = 0; t < total; t++) {
    const time = t * STEP;
    if (t % 60 === 0) {
      const sec = t / 60;
      if (sec < spawnSeconds) spawnHorde(g, time, spawnState);
      o.onSecond?.(g, sec);
    }
    const t0 = performance.now();
    g.update(STEP);
    tickMs += performance.now() - t0;
    ticks++;
    for (const z of g.zombies) {
      all.add(z.id);
      if (z.state === 'attack') attacked.add(z.id);
    }
    if (t % 30 === 0) {
      for (const z of g.zombies) {
        if (g.grid.isBlocked(g.grid.cellX(z.x), g.grid.cellY(z.z))) violations++;
      }
    }
  }

  let arrived = 0;
  let maxStuck = 0;
  const late: string[] = [];
  const lateByKind: Record<string, number> = {};
  let lateMoving = 0;
  let lateMinDist = Infinity;
  let lateMaxDist = 0;
  let queued = 0;
  const touching = (z: (typeof g.zombies)[number]) =>
    g.zombies.some((o) => o !== z && Math.hypot(o.x - z.x, o.z - z.z) < z.radius + o.radius + 0.35);
  for (const z of g.zombies) {
    const d = coreDist(g, z.x, z.z);
    if (attacked.has(z.id) || d <= 8) arrived++;
    else if (d <= 16 && (Math.hypot(z.vx, z.vz) > 0.1 || touching(z))) queued++; // 在核心周围排队
    else {
      lateByKind[z.kind] = (lateByKind[z.kind] ?? 0) + 1;
      if (Math.hypot(z.vx, z.vz) > 0.3) lateMoving++;
      lateMinDist = Math.min(lateMinDist, d);
      lateMaxDist = Math.max(lateMaxDist, d);
      if (late.length < 5)
        late.push(
          `${z.kind} 位置(${z.x.toFixed(1)},${z.z.toFixed(1)}) 距核心代价 ${d >= INF ? '不可达' : d.toFixed(1)} 速度 ${Math.hypot(z.vx, z.vz).toFixed(2)} 状态=${z.state}`,
        );
    }
    if (z.maxStuck > maxStuck) maxStuck = z.maxStuck;
  }
  if (late.length) {
    console.log(
      `  [${o.name}] 未到位 ${Object.values(lateByKind).reduce((a, b) => a + b, 0)} 只 ${JSON.stringify(lateByKind)}，` +
        `仍在移动 ${lateMoving}，距核心代价 ${lateMinDist.toFixed(1)}–${lateMaxDist.toFixed(1)}`,
    );
    for (const s of late) console.log(`    未到位: ${s}`);
  }
  const n = g.zombies.length;
  const stuckInfo = g.zombies
    .filter((z) => z.maxStuck >= 2)
    .slice(0, 6)
    .map(
      (z) =>
        `${z.kind} 位置(${z.x.toFixed(1)},${z.z.toFixed(1)}) 格(${g.grid.cellX(z.x)},${g.grid.cellY(z.z)}) ` +
        `目标=${z.goal} 状态=${z.state} 最长卡住 ${z.maxStuck.toFixed(1)}s`,
    );
  return {
    name: o.name,
    stuckInfo,
    zombies: n,
    arrivedRate: n ? (arrived + queued) / n : 0,
    maxStuck,
    stuckEvents: g.stats.stuckEvents,
    violations,
    msPerTick: tickMs / ticks,
    extra: {
      到位: arrived,
      排队: queued,
      attacksOnStructure: g.stats.attacksOnStructure,
      structuresDestroyed: g.stats.structuresDestroyed,
      attacksOnCore: g.stats.attacksOnCore,
      unreachableTicks: g.stats.unreachableTicks,
      navRecomputes: g.nav.recomputes,
    },
  };
}

function report(r: Result): void {
  console.log(
    `  僵尸 ${r.zombies} 只 | 到位率 ${(r.arrivedRate * 100).toFixed(1)}% | 最长卡住 ${r.maxStuck.toFixed(2)}s | ` +
      `卡死事件 ${r.stuckEvents} | 嵌入障碍 ${r.violations} | ${r.msPerTick.toFixed(3)} ms/步`,
  );
  console.log(`  ${Object.entries(r.extra).map(([k, v]) => `${k}=${v}`).join('  ')}`);
  for (const s of r.stuckInfo) console.log(`    卡住: ${s}`);
}

function commonChecks(r: Result): void {
  check(r.arrivedRate >= 0.98, `到位或在核心周围排队 ≥ 98%（实际 ${(r.arrivedRate * 100).toFixed(1)}%）`);
  check(r.maxStuck < 2, `没有因地形卡住超过 2 秒（最长 ${r.maxStuck.toFixed(2)}s）`);
  check(r.violations === 0, `没有僵尸嵌进障碍格（${r.violations} 次）`);
}

// ---------------------------------------------------------------
console.log('\n== 地图连通性 ==');
{
  const g = new Game(1);
  const rep = analyzeMap(g.map);
  console.log(`  可走格 ${rep.freeCells}，走不到核心的格子 ${rep.enclosedFreeCells}`);
  check(rep.unreachableSpawns.length === 0, `所有刷怪点都能走到核心（不通：${rep.unreachableSpawns.join(',') || '无'}）`);
  check(
    rep.unreachableSpawnsLarge.length === 0,
    `大体型单位（肿胀者/巨像）也能从所有刷怪点到核心（不通：${rep.unreachableSpawnsLarge.join(',') || '无'}）`,
  );
  check(rep.unreachableScrap.length === 0, `所有零件箱都能走到（不通：${rep.unreachableScrap.join(',') || '无'}）`);
  check(rep.enclosedFreeCells === 0, `没有被封死的空洞（${rep.enclosedFreeCells} 格）`);
  for (const s of g.map.spawns) {
    const d = coreDist(g, s.x, s.z);
    console.log(`  ${s.name}: 到核心代价 ${d >= INF ? '不可达' : d.toFixed(1)}`);
  }
}

console.log('\n== 场景 A：入口全开，6 个刷怪点同时来 ==');
{
  const r = run({ name: 'A', seconds: 120 });
  report(r);
  commonChecks(r);
  check(r.msPerTick < 2, `平均每步耗时 < 2 ms（实际 ${r.msPerTick.toFixed(3)}）`);
}

console.log('\n== 场景 B：4 个入口全部用路障封死 ==');
{
  let placed = 0;
  const r = run({
    name: 'B',
    seconds: 120,
    setup: (g) => {
      placed = sealGates(g);
    },
  });
  console.log(`  放置路障 ${placed} 个`);
  report(r);
  commonChecks(r);
  check(Number(r.extra.attacksOnStructure) > 0, '僵尸会去攻击路障');
  check(Number(r.extra.structuresDestroyed) > 0, '路障被拆开后僵尸通过');
}

console.log('\n== 场景 C：封死后在第 25 秒全部拆除，路径要重新生效 ==');
{
  const r = run({
    name: 'C',
    seconds: 120,
    setup: (g) => {
      sealGates(g);
      // 加固路障，保证第 25 秒时还没被拆完
      for (const s of g.structures.values()) {
        s.hp = 1e6;
        s.maxHp = 1e6;
      }
    },
    onSecond: (g, sec) => {
      if (sec === 25) for (const id of [...g.structures.keys()]) g.removeStructure(id, false);
    },
  });
  report(r);
  commonChecks(r);
  check(Number(r.extra.attacksOnCore) > 0, '拆除后僵尸抵达核心并攻击');
}

console.log('\n== 场景 D：72 只奔袭者追一个以 3.0 格/秒在停车场迷宫里跑的玩家 ==');
{
  const g = new Game(SEED + 4);
  g.invulnerablePlayer = true;
  g.invulnerableCore = true;
  // 放大仇恨范围，保证所有僵尸都去追玩家；这里只测追逐时的寻路，不测仇恨判定
  g.aggroScale = 10;
  const open = (x: number, z: number) => {
    for (let r = 0; r < 10; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const px = x + dx;
          const pz = z + dz;
          let ok = true;
          for (let a = -1; a <= 1 && ok; a++) for (let b = -1; b <= 1; b++) if (g.grid.isBlocked(g.grid.cellX(px) + a, g.grid.cellY(pz) + b)) ok = false;
          if (ok) return { x: Math.floor(px) + 0.5, z: Math.floor(pz) + 0.5 };
        }
      }
    }
    return { x, z };
  };
  const route = [open(-27, 24), open(-12, 28), open(-27, 15), open(-8, 20)];
  let leg = 0;
  g.player.x = route[0]!.x;
  g.player.z = route[0]!.z;
  // 给"玩家绕障碍"用的临时寻路器：为每个目标点缓存一张距离场
  const walker = {
    cache: new Map<string, FlowField>(),
    field(t: { x: number; z: number }): FlowField {
      const key = `${t.x},${t.z}`;
      let f = this.cache.get(key);
      if (!f) {
        f = new FlowField(g.grid, false, false);
        f.compute([g.grid.indexAt(t.x, t.z)]);
        this.cache.set(key, f);
      }
      return f;
    },
  };

  const hitPlayer = new Set<number>();
  g.events.on('zombieAttack', ({ zombie, target }) => {
    if (target === 'player') hitPlayer.add(zombie.id);
  });

  let tickMs = 0;
  let ticks = 0;
  const total = Math.round(90 / STEP);
  const spawned: number[] = [];
  for (let t = 0; t < total; t++) {
    if (t % 60 === 0 && t / 60 < 3) {
      for (let s = 0; s < g.map.spawns.length; s++) {
        for (let k = 0; k < 4; k++) {
          // 只放奔袭者：它们（3.6）比玩家（3.0）快，才有可能追上
          const z = g.spawnAtGate('runner', s);
          if (z) spawned.push(z.id);
        }
      }
    }
    // 玩家以 3.0 格/秒沿路线移动。现在玩家会和墙、车辆碰撞，所以只在视线畅通时直走，
    // 否则贴着网格走向目标格（跟真实玩家绕过障碍物是一回事）
    const tgt = route[leg % route.length]!;
    const dx = tgt.x - g.player.x;
    const dz = tgt.z - g.player.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.4) leg++;
    else {
      let wx = tgt.x;
      let wz = tgt.z;
      if (!g.grid.sweptClear(g.player.x, g.player.z, tgt.x, tgt.z, g.player.radius)) {
        // 视线被挡：沿到目标的 BFS 下降方向走（用一张临时距离场）
        const f = walker.field(tgt);
        const ci = g.grid.indexAt(g.player.x, g.player.z);
        const nx = f.next[ci] as number;
        if (nx >= 0) {
          wx = g.grid.centerX(nx % 80);
          wz = g.grid.centerZ((nx / 80) | 0);
        }
      }
      const ex = wx - g.player.x;
      const ez = wz - g.player.z;
      const el = Math.hypot(ex, ez) || 1;
      g.input.moveX = ex / el;
      g.input.moveZ = ez / el;
    }
    if (d < 0.4) {
      g.input.moveX = 0;
      g.input.moveZ = 0;
    }
    const t0 = performance.now();
    g.update(STEP);
    tickMs += performance.now() - t0;
    ticks++;
  }
  let maxStuck = 0;
  for (const z of g.zombies) maxStuck = Math.max(maxStuck, z.maxStuck);
  const rate = spawned.length ? spawned.filter((id) => hitPlayer.has(id)).length / spawned.length : 0;
  console.log(
    `  僵尸 ${spawned.length} 只 | 追上并攻击玩家 ${(rate * 100).toFixed(1)}% | 最长卡住 ${maxStuck.toFixed(2)}s | ` +
      `卡死事件 ${g.stats.stuckEvents} | ${(tickMs / ticks).toFixed(3)} ms/步`,
  );
  check(rate >= 0.9, `追逐玩家的僵尸中 ≥ 90% 追上（实际 ${(rate * 100).toFixed(1)}%）`);
  check(maxStuck < 2, `没有因地形卡住超过 2 秒（最长 ${maxStuck.toFixed(2)}s）`);
}

console.log('\n== 场景 E：单个大体型单位（没有人群）从发电机四周出发，必须自己走到位 ==');
{
  // 隔离测试：没有别的僵尸，卡住只可能是地形 / 寻路的问题
  const ring: Array<[number, number]> = [];
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    ring.push([Math.cos(a) * 6.5, -1 + Math.sin(a) * 6.5]);
  }
  let fails = 0;
  let worst = 0;
  const reasons: string[] = [];
  for (const kind of ['bloater', 'colossus', 'breaker', 'walker'] as const) {
    for (const [px, pz] of ring) {
      const g = new Game(SEED);
      g.invulnerableCore = true;
      g.player.alive = false; // 只测"去打发电机"
      const z = g.spawnZombie(kind, px, pz);
      if (!z) continue;
      let attackedAt = -1;
      for (let t = 0; t < 30 / STEP; t++) {
        g.update(STEP);
        if (z.state === 'attack') {
          attackedAt = t * STEP;
          break;
        }
      }
      worst = Math.max(worst, z.maxStuck);
      if (attackedAt < 0 || z.maxStuck >= 2) {
        fails++;
        if (reasons.length < 6)
          reasons.push(`${kind} 起点(${px.toFixed(1)},${pz.toFixed(1)}) 终点(${z.x.toFixed(1)},${z.z.toFixed(1)}) 到位=${attackedAt >= 0} 卡住 ${z.maxStuck.toFixed(1)}s`);
      }
    }
  }
  console.log(`  64 次单体测试（4 种体型 × 发电机周围 16 个方向），失败 ${fails}，最长卡住 ${worst.toFixed(2)}s`);
  for (const r of reasons) console.log(`    失败: ${r}`);
  check(fails === 0, '单个僵尸（含肿胀者、巨像）从任何方向都能自己走到发电机并开始攻击');
}

console.log('');
if (failures.length) {
  console.log(`未通过 ${failures.length} 项：`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('全部通过');
