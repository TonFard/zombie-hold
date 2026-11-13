// M17 新僵尸：npm run sim:zombies
// 爬行者（从路障下面钻过、只追人、站着平射打不到）和重装感染者（正面减伤、打头 / 背后 / 爆炸正常）
import { Game, STEP } from '../../src/game/sim';
import type { Zombie } from '../../src/game/entities/zombie';
import { ZOMBIES } from '../../src/game/data/zombies';
import { statsAt } from '../../src/game/data/weapons';
import { tryPlace } from '../../src/game/systems/building';
import { explode } from '../../src/game/systems/combat';
import { pickKindForTest } from '../../src/game/systems/run';
import { segmentVsZombie } from '../../src/game/systems/hitvolume';
import { NIGHT_MODS } from '../../src/game/data/modifiers';
import { bossFor } from '../../src/game/data/waves';
import { applyCheckpoint, parseCheckpoint, serialize } from '../../src/game/save/checkpoint';
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
    // 打身体瞄 1 米高：重装驼着背，头在胸口前面 1.35 米往上，再高就蹭到头了
    g.input.aimPitch = head ? Math.atan2(z.def.head.y - g.player.eye, 8 - z.def.head.fwd) : Math.atan2(1.0 - g.player.eye, 8);
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
  check(Math.abs(hp0 - a.hp - 50) < 1e-6, `爆炸直接命中照常 50 伤害（${(hp0 - a.hp).toFixed(1)}）`);
}

console.log('\n== 狙击枪：穿甲 ==');
{
  /** 开镜从 (-8, 6) 朝 +X 打 8 米外的僵尸（面朝 yaw）的身体 / 头，返回伤害 */
  const shot = (weapon: 'rifle' | 'sniper', kind: 'armored' | 'breaker' | 'colossus', yaw: number, head: boolean): number => {
    const g = new Game(6);
    g.invulnerablePlayer = true;
    g.aggroScale = 0;
    g.player.x = -8;
    g.player.z = 6;
    const slot = g.loadout[weapon];
    slot.owned = true;
    slot.mag = 1;
    g.player.weapon = weapon;
    const z = g.spawnZombie(kind, 0, 6, 100) as Zombie;
    const pin = () => {
      z.x = 0;
      z.z = 6;
      z.vx = z.vz = 0;
      z.kbx = z.kbz = 0;
      z.yaw = yaw;
    };
    g.input.aimX = 20;
    g.input.aimZ = 6;
    g.input.aimPitch = head ? Math.atan2(z.def.head.y - g.player.eye, 8 - z.def.head.fwd) : Math.atan2(1.0 - g.player.eye, 8);
    // 狙击枪腰射很散：先举好镜再开枪
    g.input.ads = true;
    for (let t = 0; t < 60 && g.player.ads < 1; t++) {
      g.update(STEP);
      pin();
    }
    let dmg = 0;
    g.events.on('zombieHit', (e) => {
      if (e.zombie === z) dmg += e.amount;
    });
    g.input.fire = true;
    for (let t = 0; t < 40; t++) {
      g.update(STEP);
      pin();
    }
    return dmg;
  };
  const F = -Math.PI / 2;
  const B = Math.PI / 2;
  const sf = shot('sniper', 'armored', F, false);
  const sb = shot('sniper', 'armored', B, false);
  check(sb > 0 && Math.abs(sf / sb - 1) < 0.02, `狙击枪正面打重装的身体不减伤 ×${(sf / sb).toFixed(2)}（正面 ${sf.toFixed(0)}，背后 ${sb.toFixed(0)}）`);
  const helm = (w: 'rifle' | 'sniper') => shot(w, 'breaker', F, true) / shot(w, 'breaker', F, false);
  check(Math.abs(helm('sniper') - 3) < 0.05, `狙击枪打破墙者的头盔照样吃满爆头倍率 ×${helm('sniper').toFixed(2)}（应 ×3）`);
  check(Math.abs(helm('rifle') - 2.05) < 0.05, `步枪打头盔还是打七折 ×${helm('rifle').toFixed(2)}（应 ×2.05）`);
  const boss = shot('sniper', 'colossus', F, true) / shot('sniper', 'colossus', F, false);
  check(Math.abs(boss - 2.2) < 0.05, `首领头上的装甲照旧：狙击爆头 ×${boss.toFixed(2)}（应 ×2.2）`);
}

console.log('\n== 跳跃者 ==');
{
  // 东门封死，玩家在内院：跳跃者不拆路障，直接跳进来
  {
    const g = eastBlocked();
    const z = g.spawnZombie('leaper', wx(62), wz(40)) as Zombie;
    let jumped = 0;
    let chewed = false;
    let maxAir = 0;
    g.events.on('leap', (e) => {
      if (e.zombie === z && e.stage === 'jump') jumped++;
    });
    g.events.on('zombieAttack', (e) => {
      if (e.zombie === z && e.target === 'structure') chewed = true;
    });
    let inside = false;
    for (let t = 0; t < 60 * 20 && !inside; t++) {
      g.update(STEP);
      maxAir = Math.max(maxAir, z.airY);
      if (g.grid.cellX(z.x) < 53 && z.leapState === 0) inside = true;
    }
    const bars = [...g.structures.values()].filter((s) => s.kind === 'barricade');
    check(inside && !chewed && jumped >= 1, `跳过封死的东门进了内院（进院 ${inside}、起跳 ${jumped} 次、拆路障 ${chewed}，最高离地 ${maxAir.toFixed(2)} 米）`);
    check(bars.length === 3 && bars.every((s) => s.hp === s.maxHp), '路障一点没掉血');
  }
  // 空地上隔 6 米扑人：蓄力→起跳→落地咬中
  {
    const g = new Game(4);
    g.player.x = 15;
    g.player.z = 15;
    const z = g.spawnZombie('leaper', 21, 15) as Zombie;
    z.leapCd = 0;
    const hp0 = g.player.hp;
    let landHit = -1;
    g.events.on('leap', (e) => {
      if (e.zombie === z && e.stage === 'land' && landHit < 0) landHit = e.hit ? 1 : 0;
    });
    let t = 0;
    for (; t < 60 * 3 && landHit < 0; t++) g.update(STEP);
    check(landHit > 0 && hp0 - g.player.hp >= ZOMBIES.leaper.leap!.damage - 0.01, `6 米外扑过来咬中：${(t / 60).toFixed(2)} 秒落地，掉血 ${(hp0 - g.player.hp).toFixed(1)}`);
  }
  // 蓄力时被推开 / 电晕就跳不起来
  {
    const g = new Game(4);
    g.invulnerablePlayer = true;
    g.player.x = 15;
    g.player.z = 15;
    const z = g.spawnZombie('leaper', 21, 15) as Zombie;
    z.leapCd = 0;
    let jumped = false;
    g.events.on('leap', (e) => {
      if (e.zombie === z && e.stage === 'jump') jumped = true;
    });
    for (let t = 0; t < 60 && z.leapState !== 1; t++) g.update(STEP);
    const wound = z.leapState === 1;
    z.stunT = 1;
    for (let t = 0; t < 50; t++) g.update(STEP);
    check(wound && !jumped && z.leapState === 0, `蓄力中被打断：没起跳（蓄力 ${wound}、起跳 ${jumped}）`);
  }
  // 在空中：命中体积跟着抬高
  {
    const g = new Game(4);
    const z = g.spawnZombie('leaper', 0, 6) as Zombie;
    z.yaw = -Math.PI / 2;
    const h = ZOMBIES.leaper.head;
    const ray = (y: number) => segmentVsZombie(z, -3, y, 6, 6, 0, 0);
    const ground = ray(h.y);
    z.leapState = 2;
    z.airY = 1.1;
    const oldHead = ray(h.y);
    const newHead = ray(h.y + 1.1);
    const under = ray(0.3);
    check(!!ground?.head && !oldHead?.head && !!newHead?.head && !under, `离地 1.1 米时：头球跟着上去（原高度 ${oldHead ? (oldHead.head ? '头' : '身体') : '打空'}，抬高后 ${newHead?.head ? '头' : '没打到头'}，脚下 ${under ? '打到' : '打空'}）`);
  }
}

console.log('\n== 裂殖者 ==');
{
  const die = (o: Parameters<Game['damageZombie']>[2]) => {
    const g = new Game(5);
    const z = g.spawnZombie('splitter', 0, 6, 2) as Zombie;
    g.damageZombie(z, 1e6, o);
    const kids = g.zombies.filter((q) => q.alive && q.kind === 'crawler');
    return { g, kids };
  };
  const body = die({ weapon: 'rifle' });
  const head = die({ weapon: 'rifle', head: true });
  const boom = die({ src: 'grenade' });
  const k0 = body.kids[0];
  check(body.kids.length === 3 && body.kids.every((q) => q.minion), `打身体打死裂成 ${body.kids.length} 只小爬行者`);
  check(!!k0 && k0.maxHp === Math.round(ZOMBIES.crawler.hp * 2 * 0.5), `小爬行者的生命跟着这一夜的倍率走（${k0?.maxHp}，应 ${Math.round(ZOMBIES.crawler.hp * 2 * 0.5)}）`);
  check(head.kids.length === 0 && boom.kids.length === 0, `爆头 / 炸死不裂（${head.kids.length} / ${boom.kids.length}）`);
  if (k0) {
    const s0 = body.g.scrap;
    body.g.damageZombie(k0, 1e6, { weapon: 'rifle' });
    check(body.g.scrap - s0 === Math.round(ZOMBIES.crawler.reward * 0.25), `小爬行者的零件只给四分之一（${body.g.scrap - s0}）`);
  }
}

console.log('\n== 毒雾者 ==');
{
  const setup = () => {
    const g = new Game(6);
    g.config = { ...g.config, extras: true };
    g.aggroScale = 0;
    g.player.x = -6;
    g.player.z = 6;
    return g;
  };
  // 贴近了被熏
  {
    const g = setup();
    const z = g.spawnZombie('gasser', -4.5, 6) as Zombie;
    const hp0 = g.player.hp;
    for (let t = 0; t < 120; t++) {
      g.update(STEP);
      z.x = -4.5;
      z.z = 6;
    }
    const lost = hp0 - g.player.hp;
    check(Math.abs(lost - 2 * ZOMBIES.gasser.gas!.auraDps) < 1.5, `站在 1.5 米外 2 秒掉血 ${lost.toFixed(1)}（每秒 ${ZOMBIES.gasser.gas!.auraDps}）`);
  }
  // 打死：留一团毒雾，站进去掉血
  {
    const g = setup();
    const z = g.spawnZombie('gasser', 0, 6) as Zombie;
    g.damageZombie(z, 1e6, { weapon: 'rifle' });
    const cloud = g.hz.hazards.find((h) => h.kind === 'gas');
    const life0 = cloud?.life;
    g.player.x = 0.5;
    const hp0 = g.player.hp;
    for (let t = 0; t < 60; t++) g.update(STEP);
    check(!!cloud && hp0 - g.player.hp > 6, `毒雾半径 ${cloud?.r}、持续 ${life0} 秒；站在里面 1 秒掉血 ${(hp0 - g.player.hp).toFixed(1)}`);
  }
  // 烧死：不留毒雾，爆燃炸伤旁边的僵尸，玩家不吃爆炸
  {
    const g = setup();
    g.player.x = 1.5;
    const z = g.spawnZombie('gasser', 0, 6) as Zombie;
    const w = g.spawnZombie('walker', 1.2, 7, 3) as Zombie;
    const hp0 = g.player.hp;
    g.damageZombie(z, 1e6, { src: 'fire' });
    const gas = g.hz.hazards.some((h) => h.kind === 'gas');
    check(!gas && w.maxHp - w.hp > 80 && g.player.hp === hp0, `烧死时毒气爆燃：旁边的行尸掉 ${(w.maxHp - w.hp).toFixed(0)}，玩家掉 ${(hp0 - g.player.hp).toFixed(0)}，留毒雾 ${gas}`);
  }
  // 燃烧弹扔进毒雾：毒雾爆燃
  {
    const g = setup();
    const z = g.spawnZombie('gasser', 0, 6) as Zombie;
    g.damageZombie(z, 1e6, { weapon: 'rifle' });
    const w = g.spawnZombie('walker', 0.8, 6.5, 3) as Zombie;
    g.hz.hazards.push({ kind: 'fire', x: 1.5, z: 6, r: 1.2, life: 2 });
    g.update(STEP);
    const gas = g.hz.hazards.some((h) => h.kind === 'gas');
    check(!gas && w.maxHp - w.hp > 60, `火碰到毒雾：毒雾没了，里面的行尸掉 ${(w.maxHp - w.hp).toFixed(0)}`);
  }
}

console.log('\n== 重装感染者：钢板打得掉 ==');
{
  /** 从正面连打 shots 发身体，返回每发的伤害 */
  const burst = (plate: number, shots: number) => {
    const g = new Game(6);
    g.invulnerablePlayer = true;
    g.aggroScale = 0;
    g.player.x = -8;
    g.player.z = 6;
    const slot = g.loadout.rifle;
    slot.owned = true;
    slot.mag = shots;
    g.player.weapon = 'rifle';
    const z = g.spawnZombie('armored', 0, 6, 100) as Zombie;
    z.plateHp = plate;
    let broke = false;
    const hits: number[] = [];
    g.events.on('zombieHit', (e) => {
      if (e.zombie === z) hits.push(e.amount);
    });
    g.events.on('plateBreak', (e) => {
      if (e.zombie === z) broke = true;
    });
    g.input.aimX = 20;
    g.input.aimZ = 6;
    g.input.aimPitch = Math.atan2(1.0 - g.player.eye, 8);
    g.input.fire = true;
    for (let t = 0; t < 90; t++) {
      g.update(STEP);
      z.x = 0;
      z.z = 6;
      z.vx = z.vz = 0;
      z.kbx = z.kbz = 0;
      z.yaw = -Math.PI / 2;
    }
    return { hits, broke, plate: z.plateHp };
  };
  const fresh = new Game(1).spawnZombie('armored', 0, 6) as Zombie;
  check(fresh.maxHp === ZOMBIES.armored.hp && fresh.plateHp === Math.round(ZOMBIES.armored.hp * ZOMBIES.armored.armor!.plate), `新的重装：生命 ${fresh.maxHp}、钢板耐久 ${fresh.plateHp}`);
  const r = burst(1, 3);
  const [a, b2] = r.hits;
  check(r.broke && r.plate === 0 && !!a && !!b2 && Math.abs(b2 / a - 1 / ZOMBIES.armored.armor!.front) < 0.05, `钢板只剩 1 点：第一发打掉钢板（${a?.toFixed(1)}），第二发正面全额（${b2?.toFixed(1)}）`);
  const full = burst(9999, 3);
  check(!full.broke && full.hits.every((h) => Math.abs(h - (full.hits[0] as number)) < 1e-6), `钢板还在：每发都是四成（${full.hits.map((h) => h.toFixed(1)).join(' / ')}）`);
}

console.log('\n== 首领：每张地图一个 ==');
{
  const want: Record<string, string> = { outpost: 'colossus', farmland: 'reaper', lakeside: 'brood', city: 'siren' };
  const got = Object.keys(want).map((m) => [m, bossFor(5, m)?.kind, bossFor(10, m)?.kind] as const);
  check(got.every(([m, a, b]) => a === want[m] && b === want[m]), `第 5 / 10 夜：${got.map(([m, a]) => `${m} ${a}`).join('、')}`);
  check(!bossFor(4, 'city') && !bossFor(12, 'city'), '其他夜没有首领');
  const e = [15, 20, 25, 30].map((n) => bossFor(n, 'outpost')?.kind);
  check(e.join(',') === 'reaper,brood,siren,colossus', `无尽模式从下一张地图的首领开始轮换（${e.join(' → ')}）`);
  check((bossFor(10, 'farmland')?.hpScale ?? 0) > 2.5 && bossFor(5, 'lakeside')?.escort.join() === 'bloater,spitter', '第 10 夜更硬；护卫跟着地图走（湖畔：肿胀者 + 吐酸者）');
}

/** 空地上：玩家在 (15, 15)，首领在东边 d 米 */
function bossArena(kind: 'colossus' | 'reaper' | 'brood' | 'siren', d: number) {
  const g = new Game(4);
  g.config = { ...g.config, extras: true };
  g.player.x = 15;
  g.player.z = 15;
  const z = g.spawnZombie(kind, 15 + d, 15) as Zombie;
  z.chargeCd = 99;
  z.leapCd = 99;
  z.hookCd = 99;
  z.cleaveCd = 99;
  z.lobCd = 99;
  z.shriekCd = 99;
  z.summonCd = 99;
  z.broodT = 99;
  const seen: string[] = [];
  g.events.on('bossSkill', (e) => {
    if (e.id === z.id) seen.push(`${e.skill}:${e.stage}`);
  });
  return { g, z, seen };
}

console.log('\n== 收割者：钩子 + 横扫 ==');
{
  {
    const { g, z, seen } = bossArena('reaper', 7);
    z.hookCd = 0;
    const hp0 = g.player.hp;
    for (let t = 0; t < 150 && !(seen.includes('hook:hit') && z.skill === 0); t++) g.update(STEP);
    const d = Math.hypot(g.player.x - z.x, g.player.z - z.z);
    check(seen.includes('hook:windup') && seen.includes('hook:hit') && d < z.radius + g.player.radius + 1.3, `7 米外钩中，拽到身前（剩 ${d.toFixed(2)} 米）`);
    check(Math.abs(hp0 - g.player.hp - ZOMBIES.reaper.boss!.hook!.damage) < 0.01, `钩中掉血 ${(hp0 - g.player.hp).toFixed(1)}`);
    g.update(STEP);
    check(z.skill === 2, '拽过来以后马上接横扫蓄力');
  }
  {
    // 蓄力时方向就锁死了：往旁边躲 3 米就钩不中
    const { g, z, seen } = bossArena('reaper', 7);
    z.hookCd = 0;
    let moved = false;
    for (let t = 0; t < 150 && !seen.includes('hook:end'); t++) {
      g.update(STEP);
      if (!moved && seen.includes('hook:windup')) {
        g.player.z += 3;
        moved = true;
      }
    }
    check(moved && !seen.includes('hook:hit') && seen.includes('hook:end'), `蓄力时侧移 3 米：钩子落空（${seen.join(' ')}）`);
  }
  {
    // 蓄力时被电击脉冲眩晕：技能取消
    const { g, z, seen } = bossArena('reaper', 7);
    z.hookCd = 0;
    for (let t = 0; t < 20 && !seen.includes('hook:windup'); t++) g.update(STEP);
    z.stunT = 2;
    for (let t = 0; t < 60; t++) g.update(STEP);
    check(seen.includes('hook:windup') && !seen.includes('hook:go') && z.skill === 0, '蓄力中被眩晕：钩子没甩出来');
  }
  {
    const cleave = (dodge: boolean) => {
      const { g, z, seen } = bossArena('reaper', 2.6);
      z.cleaveCd = 0;
      const hp0 = g.player.hp;
      let moved = false;
      for (let t = 0; t < 90 && !seen.includes('cleave:end'); t++) {
        g.update(STEP);
        if (dodge && !moved && seen.includes('cleave:windup')) {
          g.player.x -= 3.5;
          moved = true;
        }
      }
      return hp0 - g.player.hp;
    };
    const stand = cleave(false);
    const dodged = cleave(true);
    check(Math.abs(stand - ZOMBIES.reaper.boss!.cleave!.damage) < 0.01 && dodged === 0, `横扫：站着掉 ${stand.toFixed(0)}，蓄力时后退出扇形掉 ${dodged.toFixed(0)}`);
  }
}

console.log('\n== 巨像：二阶段砸碎石 ==');
{
  const rocks = (dodge: boolean) => {
    const { g, z } = bossArena('colossus', 11);
    z.lobCd = 0;
    let phase = false;
    g.events.on('bossPhase', (e) => {
      if (e.zombie === z) phase = true;
    });
    // 半血以前不扔
    for (let t = 0; t < 30; t++) g.update(STEP);
    const before = g.hz.marks.length;
    z.hp = z.maxHp * 0.45;
    g.update(STEP);
    const marks = g.hz.marks.length;
    if (dodge) g.player.z += 5;
    const hp0 = g.player.hp;
    for (let t = 0; t < 120; t++) g.update(STEP);
    return { before, marks, phase, rage: z.rage, lost: hp0 - g.player.hp, left: g.hz.marks.length };
  };
  const s = rocks(false);
  const d = rocks(true);
  check(s.before === 0 && s.phase && s.rage && s.marks >= 2, `半血前不扔；进二阶段后地上出现 ${s.marks} 个预警圈`);
  check(s.left === 0 && s.lost >= ZOMBIES.colossus.boss!.lob!.damage - 0.01 && d.lost === 0, `站在圈里掉 ${s.lost.toFixed(0)}，躲开掉 ${d.lost.toFixed(0)}`);
}

console.log('\n== 母巢：孵化和卵囊 ==');
{
  {
    const { g, z } = bossArena('brood', 9);
    z.broodT = 0.01;
    g.update(STEP);
    const kids = g.zombies.filter((q) => q.alive && q.kind === 'crawler' && q.minion);
    check(kids.length === 3, `卵囊还在：一次孵出 ${kids.length} 只小爬行者`);
    z.sacs = 0;
    z.broodT = 0.01;
    for (let t = 0; t < 10; t++) g.update(STEP);
    check(g.zombies.filter((q) => q.alive && q.kind === 'crawler').length === kids.length, '卵囊全打爆：不再孵');
  }
  {
    /** 从 (-8, 6) 朝 +X 打母巢的身体一发：back = 打背后 */
    const shot = (back: boolean, preset = 0) => {
      const g = new Game(6);
      g.config = { ...g.config, extras: true };
      g.invulnerablePlayer = true;
      g.aggroScale = 0;
      g.player.x = -8;
      g.player.z = 6;
      const slot = g.loadout.rifle;
      slot.owned = true;
      slot.mag = 1;
      g.player.weapon = 'rifle';
      const z = g.spawnZombie('brood', 0, 6) as Zombie;
      z.broodT = 99;
      z.lobCd = 99;
      z.sacDmg = preset;
      let dmg = 0;
      let popped = -1;
      g.events.on('zombieHit', (e) => {
        if (e.zombie === z) dmg += e.amount;
      });
      g.events.on('bossSac', (e) => {
        if (e.zombie === z) popped = e.left;
      });
      g.input.aimX = 20;
      g.input.aimZ = 6;
      g.input.aimPitch = Math.atan2(1.2 - g.player.eye, 8);
      g.input.fire = true;
      for (let t = 0; t < 40; t++) {
        g.update(STEP);
        z.x = 0;
        z.z = 6;
        z.vx = z.vz = 0;
        z.kbx = z.kbz = 0;
        z.yaw = back ? Math.PI / 2 : -Math.PI / 2;
      }
      return { dmg, popped, sacs: z.sacs, sacHp: ZOMBIES.brood.boss!.brood!.sacHp * z.maxHp };
    };
    const f = shot(false);
    const b = shot(true);
    check(f.dmg > 0 && Math.abs(b.dmg / f.dmg - 1.6) < 0.02, `从背后打卵囊 ×${(b.dmg / f.dmg).toFixed(2)}（正面 ${f.dmg.toFixed(1)}，背后 ${b.dmg.toFixed(1)}）`);
    const p = shot(true, b.sacHp - 1);
    check(p.popped === 3 && p.sacs === 3, `一个卵囊吃够 ${b.sacHp.toFixed(0)} 就爆掉（还剩 ${p.sacs} 个）`);
  }
  {
    const { g, z } = bossArena('brood', 9);
    z.lobCd = 0;
    g.update(STEP);
    const acid = g.hz.marks.filter((m) => m.kind === 'acid').length;
    for (let t = 0; t < 100; t++) g.update(STEP);
    check(acid >= 2 && g.hz.hazards.some((h) => h.kind === 'acid'), `酸弹：${acid} 个预警圈，落地留下酸池`);
  }
}

console.log('\n== 哀嚎女王：尖啸、召唤、跳扑 ==');
{
  {
    const { g, z, seen } = bossArena('siren', 8);
    z.shriekCd = 0;
    const hp0 = g.player.hp;
    for (let t = 0; t < 90 && !seen.includes('shriek:go'); t++) g.update(STEP);
    check(seen.includes('shriek:hit') && g.hz.dazeT > 2 && Math.abs(hp0 - g.player.hp - ZOMBIES.siren.boss!.shriek!.damage) < 0.01, `8 米内被尖啸震住 ${g.hz.dazeT.toFixed(1)} 秒、掉血 ${(hp0 - g.player.hp).toFixed(0)}`);
    // 被震住时走得慢
    const walk = (daze: number) => {
      const w = new Game(4);
      w.invulnerablePlayer = true;
      w.player.x = 15;
      w.player.z = 15;
      w.hz.dazeT = daze;
      w.input.moveX = -1;
      for (let t = 0; t < 30; t++) w.update(STEP);
      return 15 - w.player.x;
    };
    const slow = walk(5) / walk(0);
    check(Math.abs(slow - 0.55) < 0.06, `震慑时移动速度 ×${slow.toFixed(2)}`);
  }
  {
    const { g, z, seen } = bossArena('siren', 8);
    z.summonCd = 0;
    for (let t = 0; t < 30; t++) g.update(STEP);
    const early = seen.includes('howl:windup');
    z.hp = z.maxHp * 0.4;
    for (let t = 0; t < 90 && !seen.includes('howl:go'); t++) g.update(STEP);
    const kids = g.zombies.filter((q) => q.alive && q.kind === 'runner' && q.minion).length;
    check(!early && kids >= 3, `半血前不召唤；二阶段咆哮一声叫来 ${kids} 只奔袭者`);
  }
  {
    const { g, z } = bossArena('siren', 9);
    z.leapCd = 0;
    let slam = false;
    g.events.on('bossSlam', () => {
      slam = true;
    });
    const hp0 = g.player.hp;
    for (let t = 0; t < 180 && !slam; t++) g.update(STEP);
    check(slam && hp0 - g.player.hp >= ZOMBIES.siren.boss!.quake!.damage * 0.5, `9 米外扑过来，落地震荡（掉血 ${(hp0 - g.player.hp).toFixed(0)}）`);
  }
}

console.log('\n== 首领：放技能到一半存档 ==');
{
  const { g, z } = bossArena('brood', 9);
  z.lobCd = 0;
  z.hp = z.maxHp * 0.4;
  z.sacs = 2;
  g.hz.dazeT = 1.5;
  for (let t = 0; t < 5; t++) g.update(STEP);
  g.run.phase = 'night';
  const cp = JSON.parse(JSON.stringify(serialize(g))) as unknown;
  const g2 = new Game(4);
  g2.config = { ...g2.config, extras: true };
  applyCheckpoint(g2, parseCheckpoint(new Game(4), cp));
  const z2 = g2.zombies.find((q) => q.kind === 'brood');
  check(!!z2 && z2.rage && z2.sacs === 2 && g2.hz.marks.length === g.hz.marks.length && g2.hz.marks.length > 0 && Math.abs(g2.hz.dazeT - g.hz.dazeT) < 1e-9, `读回：二阶段 ${z2?.rage}、卵囊 ${z2?.sacs}、预警圈 ${g2.hz.marks.length}、震慑 ${g2.hz.dazeT.toFixed(2)}`);
  // 旧存档：没有这些字段、击杀统计里没有新僵尸
  const old = JSON.parse(JSON.stringify(cp)) as { hz: Record<string, unknown>; zombies: Array<Record<string, unknown>>; stats: { killsBy: Record<string, unknown> } };
  delete old.hz.marks;
  delete old.hz.dazeT;
  for (const q of old.zombies) for (const k of ['plateHp', 'skill', 'sacs', 'rage', 'broodT']) delete q[k];
  for (const k of ['reaper', 'brood', 'siren', 'leaper']) delete old.stats.killsBy[k];
  let ok = true;
  try {
    parseCheckpoint(new Game(4), old);
  } catch (e) {
    ok = false;
    console.log(`     ${String(e)}`);
  }
  check(ok, '没有首领字段、击杀统计少几种僵尸的旧检查点照样能读');
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
    const n4 = tally(4);
    check(!n3.gasser && !n3.leaper && !n3.splitter && (n4.gasser ?? 0) > 30 && !n4.leaper && !n4.splitter, `毒雾者第 4 夜起、跳跃者和裂殖者第 5 夜起（第 4 夜 ${JSON.stringify(n4)}）`);
    check((n8.leaper ?? 0) > 120 && (n8.splitter ?? 0) > 80 && (n8.gasser ?? 0) > 80, `第 8 夜跳跃者 ${n8.leaper}、裂殖者 ${n8.splitter}、毒雾者 ${n8.gasser}`);
    const theme = NIGHT_MODS.leapers.theme!;
    let lp = 0;
    for (let i = 0; i < 3000; i++) if (pickKindForTest(g, 3, theme) === 'leaper') lp++;
    check(Math.abs(lp / 3000 - theme.share) < 0.03, `跳尸夜（第 3 夜）跳跃者占 ${((lp / 3000) * 100).toFixed(0)}%（应 ${theme.share * 100}%）`);
  }
}

console.log('');
if (failures.length) {
  console.log(`未通过 ${failures.length} 项`);
  process.exit(1);
}
console.log('全部通过');
