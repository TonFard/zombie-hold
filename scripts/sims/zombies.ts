// M17 新僵尸：npm run sim:zombies
// 爬行者（从路障下面钻过、只追人、站着平射打不到）和重装感染者（正面减伤、打头 / 背后 / 爆炸正常）
import { Game, STEP } from '../../src/game/sim';
import type { Zombie } from '../../src/game/entities/zombie';
import { ZOMBIES } from '../../src/game/data/zombies';
import { statsAt } from '../../src/game/data/weapons';
import { tryPlace } from '../../src/game/systems/building';
import { explode } from '../../src/game/systems/combat';
import { pickKindForTest } from '../../src/game/systems/run';
import { HALF_H, HALF_W } from '../../src/game/world/grid';

const failures: string[] = [];
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures.push(msg);
};
const wx = (cx: number) => cx - HALF_W + 0.5;
const wz = (cy: number) => cy - HALF_H + 0.5;

/** 东门（x = 54，y 39–41）用路障封死，玩家站在内院东侧 */
function eastBlocked(): Game {
  const g = new Game(3);
  g.invulnerablePlayer = true;
  g.invulnerableCore = true;
  g.scrap = 9999;
  g.buildKind = 'barricade';
  for (const cy of [39, 40, 41]) {
    g.player.x = wx(52);
    g.player.z = wz(cy);
    if (!tryPlace(g, 54, cy)) console.log(`     （${54},${cy} 没放上）`);
  }
  g.player.x = wx(48);
  g.player.z = wz(40);
  return g;
}

console.log('\n== 爬行者：从路障下面钻过 ==');
{
  // 同一个起点（东门外 8 格）：爬行者走东门、行尸绕路，记录各自经过的格子
  const run = (kind: 'crawler' | 'walker') => {
    const g = eastBlocked();
    const z = g.spawnZombie(kind, wx(62), wz(40)) as Zombie;
    let throughGate = false;
    let reached = false;
    let attackedBarricade = false;
    g.events.on('zombieAttack', (e) => {
      if (e.zombie === z && e.target === 'structure') attackedBarricade = true;
    });
    for (let t = 0; t < 60 * 25 && z.alive; t++) {
      g.update(STEP);
      const cx = g.grid.cellX(z.x);
      const cy = g.grid.cellY(z.z);
      if (cx === 54 && cy >= 39 && cy <= 41) throughGate = true;
      if (cx < 53) reached = true;
      if (reached) break;
    }
    return { throughGate, reached, attackedBarricade, t: g.run.time };
  };
  const c = run('crawler');
  const w = run('walker');
  check(c.throughGate && c.reached && !c.attackedBarricade, `爬行者从封死的东门底下钻进内院，没停下来拆（钻过 ${c.throughGate}、进院 ${c.reached}、拆 ${c.attackedBarricade}）`);
  check(!w.throughGate || w.attackedBarricade, `行尸过不去：要么绕路、要么停下来拆（穿门 ${w.throughGate}、拆 ${w.attackedBarricade}）`);
  // 钻的时候减速：速度是平滑趋近目标的，只路过一格看不出来；把它按在路障格里走 1 秒，看稳定速度
  const steady = (cx: number) => {
    const g = eastBlocked();
    const z = g.spawnZombie('crawler', wx(cx), wz(40)) as Zombie;
    let v = 0;
    for (let t = 0; t < 60; t++) {
      g.update(STEP);
      v = Math.hypot(z.vx, z.vz);
      z.x = wx(cx);
      z.z = wz(40);
    }
    return v;
  };
  const under = steady(54);
  const open = steady(58);
  check(under > 0 && Math.abs(under / open - ZOMBIES.crawler.crawl!.slow) < 0.08, `钻路障时减速：底下 ${under.toFixed(2)} / 空地 ${open.toFixed(2)} 米每秒（×${(under / open).toFixed(2)}，应 ×${ZOMBIES.crawler.crawl!.slow}）`);
  // 炮塔钻不过去
  const gt = new Game(3);
  gt.scrap = 9999;
  gt.buildKind = 'turret';
  gt.player.x = wx(52);
  gt.player.z = wz(40);
  tryPlace(gt, 54, 40);
  check(gt.grid.blocksCrawler(54, 40) && !gt.grid.blocksCrawler(54, 41), '炮塔格对爬行者也是挡的，空地不挡');
}

console.log('\n== 爬行者：只追人 ==');
{
  const g = new Game(4);
  g.invulnerablePlayer = true;
  g.player.x = 15;
  g.player.z = 15;
  const z = g.spawnZombie('crawler', 25, 15) as Zombie;
  for (let t = 0; t < 30; t++) g.update(STEP);
  check(z.goal === 'player', `14 米外就盯上玩家，不去打发电机（goal = ${z.goal}）`);
}

console.log('\n== 爬行者：站着平射打不到 ==');
{
  const shoot = (pitch: number) => {
    const g = new Game(5);
    g.invulnerablePlayer = true;
    g.aggroScale = 0;
    g.player.x = -8;
    g.player.z = 6;
    const slot = g.loadout.rifle;
    slot.owned = true;
    slot.tier = 0;
    slot.mag = statsAt('rifle', 0).mag;
    g.player.weapon = 'rifle';
    const z = g.spawnZombie('crawler', -8 + 8, 6) as Zombie;
    g.input.aimX = 20;
    g.input.aimZ = 6;
    g.input.aimPitch = pitch;
    g.input.fire = true;
    for (let t = 0; t < 30; t++) {
      g.update(STEP);
      z.x = 0;
      z.z = 6;
    }
    return z.hp < z.maxHp;
  };
  const level = shoot(0);
  const down = shoot(Math.atan2(0.4 - 1.62, 8));
  check(!level && down, `平射（瞄胸口高度）打不中，压低枪口打得中（平射 ${level}、压低 ${down}）`);
  check(ZOMBIES.crawler.height < 1 && ZOMBIES.crawler.head.y < 0.5, `命中体积压扁：高 ${ZOMBIES.crawler.height} 米、头 ${ZOMBIES.crawler.head.y} 米`);
}

console.log('\n== 重装感染者：正面装甲 ==');
{
  /** 让重装感染者面朝 yaw，从 (-8, 6) 朝 +X 打它 8 米外的身体 / 头，返回伤害 */
  const hit = (yaw: number, head: boolean) => {
    const g = new Game(6);
    g.invulnerablePlayer = true;
    g.aggroScale = 0;
    g.player.x = -8;
    g.player.z = 6;
    const slot = g.loadout.rifle;
    slot.owned = true;
    slot.mag = 1;
    g.player.weapon = 'rifle';
    const z = g.spawnZombie('armored', 0, 6, 100) as Zombie;
    g.input.aimX = 20;
    g.input.aimZ = 6;
    g.input.aimPitch = head ? Math.atan2(z.def.head.y - g.player.eye, 8 - z.def.head.fwd) : Math.atan2(1.2 - g.player.eye, 8);
    g.input.fire = true;
    let dmg = 0;
    g.events.on('zombieHit', (e) => {
      if (e.zombie === z) dmg += e.amount;
    });
    for (let t = 0; t < 40; t++) {
      g.update(STEP);
      z.x = 0;
      z.z = 6;
      z.vx = z.vz = 0;
      z.kbx = z.kbz = 0;
      z.yaw = yaw;
    }
    return dmg;
  };
  // 子弹沿 +X 飞：僵尸朝 −X（yaw = −π/2）就是正面对着子弹
  const front = hit(-Math.PI / 2, false);
  const back = hit(Math.PI / 2, false);
  const side = hit(0, false);
  const headF = hit(-Math.PI / 2, true);
  check(Math.abs(front / back - 0.4) < 0.02, `正面打身体 ×${(front / back).toFixed(2)}（背后 ${back.toFixed(1)}，正面 ${front.toFixed(1)}）`);
  check(Math.abs(side / back - 1) < 0.02, `侧面（90°）不减伤 ×${(side / back).toFixed(2)}`);
  check(headF > back, `正面打头不减伤（头 ${headF.toFixed(1)} > 背后身体 ${back.toFixed(1)}）`);
  // 爆炸不看朝向
  const ge = new Game(7);
  const a = ge.spawnZombie('armored', 0, 6, 100) as Zombie;
  a.yaw = -Math.PI / 2;
  const hp0 = a.hp;
  explode(ge, -1, 6, 2.2, 50, a, 0, false);
  check(Math.abs(hp0 - a.hp - 50) < 1e-6, `榴弹直接命中照常 50 伤害（${(hp0 - a.hp).toFixed(1)}）`);
}

console.log('\n== 出场 ==');
{
  // 用出场函数本身统计：第 3 夜没有新僵尸，第 8 夜两种都有
  const pick = pickKindForTest;
  {
    const g = new Game(9);
    g.config = { ...g.config, extras: true };
    const tally = (n: number) => {
      const t: Record<string, number> = {};
      for (let i = 0; i < 3000; i++) {
        const k = pick(g, n);
        t[k] = (t[k] ?? 0) + 1;
      }
      return t;
    };
    const n3 = tally(3);
    const n8 = tally(8);
    check(!n3.crawler && !n3.armored, `第 3 夜没有爬行者和重装（${JSON.stringify(n3)}）`);
    check((n8.crawler ?? 0) > 100 && (n8.armored ?? 0) > 60, `第 8 夜爬行者 ${n8.crawler}、重装 ${n8.armored}（3000 次里）`);
  }
}

console.log('');
if (failures.length) {
  console.log(`未通过 ${failures.length} 项`);
  process.exit(1);
}
console.log('全部通过');
