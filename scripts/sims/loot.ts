// M18 地图纵深：npm run sim:loot
// 地图检查（每章：刷怪点 / 零件箱 / 搜刮点都能走到、大体型能到核心、装饰不进网格、刷怪点到核心的路没被绕远太多）
// + 搜刮玩法（读条、受伤打断、每种奖励、危险区每局只开一处、污水伤人、检查点）
import { Game, STEP } from '../../src/game/sim';
import { MAP_ORDER, type MapId } from '../../src/game/world/maps';
import { analyzeMap } from '../../src/game/world/map-outpost';
import { FlowField, INF } from '../../src/game/nav/flowfield';
import { DANGER, LOOT, isDanger, lootAvailable, planLoot, refreshLoot, updateLoot } from '../../src/game/systems/loot';
import { startRun } from '../../src/game/systems/run';
import { loadCheckpoint, serialize } from '../../src/game/save/checkpoint';
import { FEATURES } from '../../src/game/data/features';
// 搜刮点 / 危险区默认下线（2026-11-06），测试时打开
FEATURES.lootSpots = true;

const failures: string[] = [];
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures.push(msg);
};

console.log('\n== 地图检查：每一章 ==');
for (const id of MAP_ORDER) {
  const g = new Game(1, id as MapId);
  const m = g.map;
  const r = analyzeMap(m);
  check(!r.unreachableSpawns.length && !r.unreachableSpawnsLarge.length && !r.unreachableScrap.length && r.enclosedFreeCells === 0, `${id}：刷怪点 / 大体型 / 零件箱都通，没有封死的口袋`);
  const loot = m.loot ?? [];
  if (!loot.length) continue;
  // 搜刮点都能走到（从发电机出发的距离场）
  const ff = new FlowField(m.grid, false, true);
  ff.compute(m.coreCells);
  const bad = loot.filter((l) => (ff.dist[m.grid.idx(l.cx, l.cy)] as number) >= INF || m.grid.solid[m.grid.idx(l.cx, l.cy)]);
  check(bad.length === 0, `${id}：${loot.length} 个搜刮点都能走到（不通：${bad.map((b) => b.name).join('、') || '无'}）`);
  const far = loot.filter((l) => Math.hypot(l.x - m.corePos.x, l.z - m.corePos.z) > 36);
  check(far.length === 0, `${id}：搜刮点都在离发电机 36 米以内（白天只有 45–60 秒）${far.length ? `：${far.map((f) => f.name).join('、')}` : ''}`);
  check(loot.filter((l) => isDanger(l.kind)).length === DANGER.length, `${id}：三个危险区都在`);
  // 不挡路的装饰（瓦砾）不进网格
  const deco = m.props.filter((p) => p.kind === 'rubble' && !p.solid);
  const leaked = deco.filter((p) => {
    for (let y = p.y0; y < p.y1; y++) for (let x = p.x0; x < p.x1; x++) if (m.grid.solid[m.grid.idx(x, y)] && !m.props.some((q) => q.solid && x >= q.x0 && x < q.x1 && y >= q.y0 && y < q.y1)) return true;
    return false;
  });
  check(leaked.length === 0, `${id}：装饰（瓦砾）没有把格子变成障碍`);
}

console.log('\n== 第一章：新加的东西没把路绕远 ==');
{
  // 和 M18 之前比：刷怪点到发电机的距离场代价，每个刷怪点变化 < 20%（之前的值是改地图前用同一段代码量的）
  const BEFORE: Record<string, number> = { 北左: 40, 北右: 40, 东: 35, 南右: 53, 南左: 52, 西: 35 };
  const g = new Game(1);
  const ff = new FlowField(g.map.grid, false, true);
  ff.compute(g.map.coreCells);
  const now = Object.fromEntries(g.map.spawns.map((s) => [s.name, ff.dist[g.map.grid.idx(s.cx, s.cy)] as number]));
  const worst = Math.max(...Object.entries(now).map(([k, v]) => Math.abs(v / (BEFORE[k] as number) - 1)));
  console.log(`     现在：${Object.entries(now).map(([k, v]) => `${k} ${v.toFixed(0)}（之前 ${BEFORE[k]}）`).join('、')}`);
  check(worst < 0.2, `刷怪点到发电机的路最多变长 ${(worst * 100).toFixed(1)}%（要求 < 20%）`);
}

/** 第一章的一局，正式规则，第 3 天白天 */
function day(seed = 1): Game {
  const g = new Game(seed);
  g.config = { ...g.config, extras: true };
  g.invulnerablePlayer = true;
  g.invulnerableCore = true;
  startRun(g);
  g.run.night = 3;
  for (const z of g.zombies) g.damageZombie(z, 1e6);
  return g;
}
/** 站在第 i 个搜刮点上按住 E 若干秒；hurtAt > 0 时在那一刻挨一下打 */
function holdAt(g: Game, i: number, seconds: number, hurtAt = -1): void {
  const q = (g.map.loot ?? [])[i]!;
  for (let t = 0; t < Math.round(seconds / STEP); t++) {
    g.player.x = q.x;
    g.player.z = q.z;
    if (t === Math.round(hurtAt / STEP)) g.damagePlayer(1);
    for (const z of g.zombies) if (z.alive) g.damageZombie(z, 1e6);
    updateLoot(g, STEP, true);
    g.hurtT += STEP;
  }
}

console.log('\n== 搜刮：读条和打断 ==');
{
  const g = day();
  const loot = g.map.loot!;
  const depot = loot.findIndex((l) => l.kind === 'depot');
  const s0 = g.scrap;
  holdAt(g, depot, LOOT.depot.hold - 0.5);
  check(g.scrap === s0 && g.loot.taken[depot] === 0, '读条没满：什么都没拿到');
  holdAt(g, depot, 1);
  check(g.scrap > s0 && g.loot.taken[depot] === 1, `读满 ${LOOT.depot.hold} 秒：仓库给零件 +${g.scrap - s0}`);
  check(!lootAvailable(g, depot), '同一个白天不能再搜');
  const h = day(2);
  const cars = loot.findIndex((l) => l.kind === 'cars');
  holdAt(h, cars, LOOT.cars.hold + 0.5, 1.5);
  check(h.loot.taken[cars] === 0, '读条中途挨打：被打断，要重新读');
  // 第二天刷新
  g.run.night = 4;
  refreshLoot(g);
  check(lootAvailable(g, depot), '第二天普通搜刮点刷新');
}

console.log('\n== 搜刮：每种奖励 ==');
{
  const loot = new Game(1).map.loot!;
  const at = (k: string) => loot.findIndex((l) => l.kind === k);
  {
    const g = day();
    g.player.hp = 30;
    holdAt(g, at('homes'), LOOT.homes.hold + 0.2);
    check(g.player.hp === 70 && g.loot.supplies === 15, `居民区：回血 40（${g.player.hp}）、补给 +15（${g.loot.supplies}）`);
  }
  {
    const g = day();
    const f = g.hz.frags;
    const fi = g.hz.fires;
    holdAt(g, at('gas'), LOOT.gas.hold + 0.2);
    check(g.hz.frags === f + 1 && g.hz.fires === fi + 1, '加油站：手雷 +1、燃烧弹 +1');
  }
  {
    const g = day();
    holdAt(g, at('cars'), LOOT.cars.hold + 0.2);
    check(g.stats.bonusXp.pistol === 25, `停车场：手上的手枪 +25 熟练度经验（${g.stats.bonusXp.pistol}）`);
  }
}

console.log('\n== 危险区：每局只开一处 ==');
{
  const seen = new Set<number>();
  for (let s = 1; s <= 30; s++) {
    const g = day(s);
    const loot = g.map.loot!;
    const open = loot.map((_, i) => i).filter((i) => isDanger(loot[i]!.kind) && lootAvailable(g, i));
    if (open.length !== 1) check(false, `种子 ${s}：开放了 ${open.length} 处`);
    seen.add(open[0] ?? -1);
  }
  check(seen.size === DANGER.length, `30 局里三处危险区都轮到过（${seen.size} 处）`);
  // 危险区搜过之后，整局都不会再开
  const g = day(3);
  const i = g.loot.open;
  holdAt(g, i, LOOT[g.map.loot![i]!.kind].hold + 0.2);
  g.run.night = 5;
  refreshLoot(g);
  check(g.loot.taken[i] === 1 && !lootAvailable(g, i), `危险区（${g.map.loot![i]!.name}）一局只能搜一次`);
  // 守卫
  const h = day(4);
  const n0 = h.zombies.filter((z) => z.alive).length;
  refreshLoot(h);
  const guards = h.zombies.filter((z) => z.alive).length - n0;
  check(guards >= 2, `白天开始时搜刮点旁边有守卫（${guards} 只）`);
}

console.log('\n== 污染区：污水伤人 ==');
{
  const g = day();
  const toxic = g.map.loot!.find((l) => l.kind === 'toxic')!;
  g.invulnerablePlayer = false;
  g.player.x = toxic.x;
  g.player.z = toxic.z;
  const hp0 = g.player.hp;
  for (let t = 0; t < 60; t++) {
    g.player.x = toxic.x;
    g.player.z = toxic.z;
    g.update(STEP);
  }
  check(hp0 - g.player.hp > 3, `站在污水里 1 秒掉 ${(hp0 - g.player.hp).toFixed(1)} 血`);
}

console.log('\n== 检查点 ==');
{
  const g = day();
  planLoot(g);
  g.loot.taken[0] = 1;
  const h = new Game(1);
  check(loadCheckpoint(h, JSON.stringify(serialize(g, 1))) === null && h.loot.taken[0] === 1 && h.loot.open === g.loot.open, '读档后搜过的点、开放的危险区都对');
}

console.log('');
if (failures.length) {
  console.log(`未通过 ${failures.length} 项`);
  process.exit(1);
}
console.log('全部通过');
