// 建造系统验证：npm run sim:build
import { Game, STEP } from '../src/game/sim';
import { checkPlace, repairNearby, sellStructure, tryPlace } from '../src/game/systems/building';
import type { Zombie } from '../src/game/entities/zombie';

const failures: string[] = [];
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures.push(msg);
};

function fresh(seed = 3): Game {
  const g = new Game(seed);
  g.invulnerablePlayer = true;
  g.invulnerableCore = true;
  g.aggroScale = 0;
  return g;
}

const cellCenter = (cx: number, cy: number) => ({ x: cx - 40 + 0.5, z: cy - 40 + 0.5 });

console.log('\n== 放置规则 ==');
{
  const g = fresh();
  g.scrap = 100;
  g.player.x = 0.5;
  g.player.z = 10;
  g.buildKind = 'barricade';
  check(checkPlace(g, 40, 45) === 'ok', '内院空地可以建');
  check(tryPlace(g, 40, 45) && g.scrap === 85, `建路障扣 15（剩 ${g.scrap}）`);
  check(g.grid.structure[g.grid.idx(40, 45)] >= 0, '网格上记录了建筑');
  check(checkPlace(g, 40, 45) === 'occupied', '同一格不能重复建');
  check(checkPlace(g, 40, 30) === 'range', '离玩家太远建不了');

  // 内院外面、不在入口 8 格范围内的一块空草地
  g.player.x = cellCenter(8, 34).x;
  g.player.z = cellCenter(8, 34).z;
  check(g.grid.buildable[g.grid.idx(10, 35)] === 0 && g.grid.solid[g.grid.idx(10, 35)] === 0, '（前提）格子 (10,35) 是空地且不可建造');
  check(checkPlace(g, 10, 35) === 'zone', '不在可建造区域建不了');
  // 被静态障碍（墙）占着的格子：站在内院西墙旁边，在墙上建
  g.player.x = cellCenter(28, 40).x;
  g.player.z = cellCenter(28, 40).z;
  check(g.grid.solid[g.grid.idx(26, 35)] === 1, '（前提）格子 (26,35) 是围墙');
  check(checkPlace(g, 26, 35) === 'occupied', '墙占着的格子建不了');

  g.player.x = 0.5;
  g.player.z = 10;
  g.scrap = 10;
  check(checkPlace(g, 41, 45) === 'scrap', '零件不够建不了');
  g.scrap = 100;
  const z = g.spawnZombie('walker', cellCenter(42, 45).x, cellCenter(42, 45).z, 1) as Zombie;
  check(checkPlace(g, 42, 45) === 'blocked', '僵尸站在上面建不了');
  g.damageZombie(z, 9999);
  g.player.x = cellCenter(43, 45).x;
  g.player.z = cellCenter(43, 45).z;
  check(checkPlace(g, 43, 45) === 'blocked', '玩家站在上面建不了');
  g.buildKind = 'spikes';
  check(checkPlace(g, 43, 45) === 'ok', '地刺不挡路，站在上面也能建');

  g.player.x = 0.5;
  g.player.z = 10;
  g.buildKind = 'barricade';
  const before = g.scrap;
  const id = g.grid.structure[g.grid.idx(40, 45)] as number;
  check(sellStructure(g, id) && g.scrap === before + 10, `拆除返还 70%（15→10，现在 ${g.scrap}）`);
  check(g.grid.structure[g.grid.idx(40, 45)] === -1, '网格上的建筑被清除');
  check(g.grid.structVersion > 0, '建筑变化会让寻路重算');
}

console.log('\n== 修理 ==');
{
  const g = fresh();
  g.scrap = 100;
  g.player.x = 0.5;
  g.player.z = 10;
  g.buildKind = 'barricade';
  tryPlace(g, 40, 45);
  const s = [...g.structures.values()][0]!;
  s.hp = 100;
  g.player.z = 7.5;
  const spent = repairNearby(g);
  check(spent === 12 && s.hp === 220, `缺 120 生命花 12 零件修满（花了 ${spent}，生命 ${s.hp}）`);
  g.scrap = 3;
  s.hp = 100;
  repairNearby(g);
  check(s.hp === 130 && g.scrap === 0, `零件不够时只修一部分（生命 ${s.hp}）`);
  g.scrap = 100;
  g.player.x = g.core.x;
  g.player.z = g.core.z + 2;
  g.core.hp = 400;
  repairNearby(g);
  check(g.core.hp === 500 && g.scrap === 90, `靠近发电机修发电机（生命 ${g.core.hp}，剩 ${g.scrap}）`);
}

console.log('\n== 炮塔 ==');
{
  const g = fresh();
  g.scrap = 500;
  g.player.x = 0.5;
  g.player.z = -6;
  g.buildKind = 'turret';
  tryPlace(g, 38, 30);
  const turret = [...g.structures.values()][0]!;
  let shots = 0;
  g.events.on('turretShot', () => shots++);
  // 僵尸从北门外走进来，经过炮塔射程（炮塔在北门内侧约 4 格处）
  for (let i = 0; i < 8; i++) g.spawnZombie('walker', -2 + i * 0.6, -17 - (i % 2) * 0.8, 1);
  // 玩家躲远一点，不参与战斗
  g.player.x = 20;
  g.player.z = 20;
  for (let t = 0; t < 25 / STEP; t++) g.update(STEP);
  check(shots >= 20, `炮塔开了火（${shots} 发）`);
  check(g.stats.kills >= 2, `炮塔击杀了僵尸（${g.stats.kills} 只）`);
  check(Math.abs(turret.aim) < Math.PI + 0.01, '炮塔会转向目标');

  // 墙后看不到：炮塔在围墙内侧，目标在墙外
  const g2 = fresh();
  g2.scrap = 500;
  g2.player.x = 0.5;
  g2.player.z = -10;
  g2.buildKind = 'turret';
  tryPlace(g2, 33, 27); // 北墙内侧，紧贴 y=26 的墙
  let shots2 = 0;
  g2.events.on('turretShot', () => shots2++);
  const outside = g2.spawnZombie('colossus', cellCenter(33, 22).x, cellCenter(33, 22).z, 1e6) as Zombie;
  g2.player.x = 20;
  g2.player.z = 20;
  for (let t = 0; t < 4 / STEP; t++) {
    g2.update(STEP);
    outside.x = cellCenter(33, 22).x;
    outside.z = cellCenter(33, 22).z;
  }
  check(shots2 === 0, `隔着围墙不会开火（${shots2} 发）`);
}

console.log('\n== 地刺 ==');
{
  const g = fresh();
  g.scrap = 500;
  g.player.x = 0.5;
  g.player.z = -8; // 离 y=28 行（z=-11.5）在建造范围内
  g.buildKind = 'spikes';
  for (let x = 37; x < 43; x++) tryPlace(g, x, 28);
  check(g.structures.size === 6, '放了一排 6 个地刺');
  const z = g.spawnZombie('colossus', cellCenter(39, 28).x, cellCenter(39, 28).z, 1e6) as Zombie;
  g.player.x = 20;
  g.player.z = 20;
  const hp0 = z.hp;
  let destroyed = 0;
  g.events.on('structureRemoved', (e) => {
    if (e.destroyed) destroyed++;
  });
  for (let t = 0; t < 3 / STEP; t++) {
    g.update(STEP);
    z.x = cellCenter(39, 28).x;
    z.z = cellCenter(39, 28).z;
    z.vx = z.vz = 0;
  }
  const dealt = hp0 - z.hp;
  check(dealt >= 60 && dealt <= 84, `站在地刺上 3 秒约受 72 点伤害（实际 ${dealt.toFixed(0)}）`);
  for (let t = 0; t < 14 / STEP; t++) {
    g.update(STEP);
    z.x = cellCenter(39, 28).x;
    z.z = cellCenter(39, 28).z;
    z.vx = z.vz = 0;
  }
  check(destroyed >= 1 && !g.grid.trap[g.grid.idx(39, 28)] !== undefined && g.grid.trap[g.grid.idx(39, 28)] === -1, `耐久耗尽后地刺消失（销毁 ${destroyed} 个）`);
}

console.log('\n== 路障改变僵尸走向 ==');
{
  // 从东北的刷怪点出发，默认走北门；把北门用路障堵住，应当改走东门，而不是去拆路障
  const run = (blockNorth: boolean) => {
    const g = fresh(9);
    g.scrap = 9999;
    g.player.x = 0.5;
    g.player.z = -8;
    g.buildKind = 'barricade';
    if (blockNorth) for (let x = 37; x < 43; x++) g.addStructure('barricade', x, 26, true);
    g.player.x = 20;
    g.player.z = 20;
    let north = 0;
    let east = 0;
    const seen = new Set<number>();
    for (let t = 0; t < 70 / STEP; t++) {
      if (t % 30 === 0 && t / 30 < 12) g.spawnAtGate('walker', 1);
      g.update(STEP);
      for (const z of g.zombies) {
        if (seen.has(z.id)) continue;
        // 进入内院：北门在 z=-14 附近，东门在 x=13 附近
        if (z.z > -13 && Math.abs(z.x) < 4.5) {
          north++;
          seen.add(z.id);
        } else if (z.x < 13 && z.x > 11 && Math.abs(z.z) < 3) {
          east++;
          seen.add(z.id);
        }
      }
    }
    return { north, east, hits: g.stats.attacksOnStructure };
  };
  const open = run(false);
  const blocked = run(true);
  console.log(`  北门开放：走北门 ${open.north} 只，走东门 ${open.east} 只`);
  console.log(`  北门堵死：走北门 ${blocked.north} 只，走东门 ${blocked.east} 只，攻击路障 ${blocked.hits} 次`);
  check(open.north > open.east, '北门开着时，从东北来的僵尸主要走北门');
  check(blocked.east > blocked.north, '北门堵死后，大部分改走东门');
}

console.log('');
if (failures.length) {
  console.log(`未通过 ${failures.length} 项：`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('全部通过');
