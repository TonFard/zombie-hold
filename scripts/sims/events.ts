// M17 风险事件：npm run sim:events
// 每个事件：代价一个断言、奖励一个断言；再让机器人接下所有事件打几局，确认不会卡死。
import { Game, STEP } from '../../src/game/sim';
import { RISKS, RISK_FX, RISK_ORDER, acceptRisk, planRisk, type RiskId } from '../../src/game/systems/events';
import { chooseCard, skipDay, startRun } from '../../src/game/systems/run';
import { medalsFor, suppliesFor } from '../../src/game/meta/progress';
import { serialize, loadCheckpoint } from '../../src/game/save/checkpoint';
import { FEATURES } from '../../src/game/data/features';
// 风险事件默认下线（2026-11-06），测试时打开
FEATURES.riskEvents = true;

const failures: string[] = [];
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures.push(msg);
};

/** 正式规则的一局，第 n 天，强制今天的事件是 id */
function dayWith(id: RiskId, n = 3, seed = 1): Game {
  const g = new Game(seed);
  g.config = { ...g.config, extras: true };
  g.invulnerablePlayer = true;
  g.invulnerableCore = true;
  startRun(g);
  g.run.night = n;
  // 反复抽，直到抽中想要的事件（planRisk 内部用 rng，概率 25% × 1/5）
  for (let i = 0; i < 400 && g.ev.id !== id; i++) planRisk(g);
  return g;
}
/** 打完这一夜（清怪），停在黎明 */
function clearNight(g: Game, killAll = true): void {
  skipDay(g);
  for (let t = 0; t < 60 * 240 && g.run.phase === 'night'; t++) {
    if (killAll) for (const z of g.zombies) if (z.alive) g.damageZombie(z, 1e6, { weapon: 'pistol' });
    g.update(STEP);
  }
}

console.log('\n== 出现概率 ==');
{
  const g = new Game(2);
  g.config = { ...g.config, extras: true };
  startRun(g);
  g.run.night = 4;
  const seen: Record<string, number> = {};
  let any = 0;
  for (let i = 0; i < 4000; i++) {
    planRisk(g);
    if (g.ev.id) {
      any++;
      seen[g.ev.id] = (seen[g.ev.id] ?? 0) + 1;
    }
  }
  check(Math.abs(any / 4000 - 0.25) < 0.03 && RISK_ORDER.every((k) => (seen[k] ?? 0) > 100), `每天约 25% 出现（${((any / 4000) * 100).toFixed(1)}%），五种都会出现（${JSON.stringify(seen)}）`);
  g.run.night = 1;
  let first = 0;
  for (let i = 0; i < 500; i++) {
    planRisk(g);
    if (g.ev.id) first++;
  }
  check(first === 0, '第 1 天不出事件');
  const gd = new Game(2);
  gd.config = { ...gd.config, extras: true, daily: '2026-11-05' };
  startRun(gd);
  gd.run.night = 4;
  let daily = 0;
  for (let i = 0; i < 500; i++) {
    planRisk(gd);
    if (gd.ev.id) daily++;
  }
  check(daily === 0, '每日挑战不出事件');
}

console.log('\n== 不接 = 什么都不发生 ==');
{
  for (const id of RISK_ORDER) {
    const g = dayWith(id);
    const scrap0 = g.scrap;
    clearNight(g);
    if (g.ev.id !== id) continue;
    const ok = g.ev.stage === 0 && g.ev.supplies === 0 && g.ev.migrationNights.length === 0 && g.ev.freeUpgrade === 0 && g.run.cardChoices.length === g.config.cardChoices;
    check(ok && g.scrap >= scrap0, `${RISKS[id].name}：没接，代价和奖励都没有`);
  }
}

console.log('\n== 军事广播 ==');
{
  const g = dayWith('broadcast');
  check(acceptRisk(g), '接下');
  clearNight(g);
  const elites = g.stats.eliteKills;
  check(elites >= 1, `代价：这一夜多一只精英（击杀精英 ${elites}）`);
  const xp = g.stats.weaponKills.pistol;
  check(g.stats.bonusXp.pistol === xp && xp > 0, `奖励：这一夜手枪击杀 ${xp}，额外熟练度经验 ${g.stats.bonusXp.pistol}（×2）`);
}

console.log('\n== 燃料告急 ==');
{
  const g = dayWith('fuel');
  g.mods.coreRegen = 5;
  check(acceptRisk(g), '接下');
  skipDay(g);
  g.core.hp = 100;
  for (let t = 0; t < 120; t++) g.update(STEP);
  check(g.core.hp === 100, `代价：发电机自修 5/秒，这一夜不回血（${g.core.hp}）`);
  const sup = suppliesFor({ difficulty: 'normal', nights: 3, won: false, kills: 0, headshotKills: 0, eventSupplies: g.ev.supplies });
  const sup0 = suppliesFor({ difficulty: 'normal', nights: 3, won: false, kills: 0, headshotKills: 0 });
  check(g.ev.supplies === RISK_FX.fuelSupplies && sup - sup0 === RISK_FX.fuelSupplies, `奖励：结算补给多 ${sup - sup0}`);
}

console.log('\n== 幸存者求救 ==');
{
  const g = dayWith('survivor');
  const n0 = g.zombies.length;
  check(acceptRisk(g) && g.zombies.length - n0 === RISK_FX.survivorGuards, `代价：信号弹旁边刷出 ${g.zombies.length - n0} 只守卫`);
  for (const z of g.zombies) g.damageZombie(z, 1e6);
  g.player.x = g.ev.x;
  g.player.z = g.ev.z;
  g.input.useHeld = true;
  for (let t = 0; t < 60 * (RISK_FX.survivorHold + 0.5) && g.ev.stage === 1; t++) {
    g.player.x = g.ev.x;
    g.player.z = g.ev.z;
    g.input.useHeld = true;
    g.update(STEP);
  }
  check(g.ev.stage === 2 && g.ev.extraCard === 1, `按住 E ${RISK_FX.survivorHold} 秒救下`);
  g.input.useHeld = false;
  clearNight(g);
  check(g.run.cardChoices.length === g.config.cardChoices + 1, `奖励：黎明给 ${g.run.cardChoices.length} 张卡（平时 ${g.config.cardChoices}）`);
  chooseCard(g, g.run.cardChoices[0] as string);
  clearNight(g);
  check(g.run.cardChoices.length === g.config.cardChoices, '只多这一次');
  // 离开信号弹就不涨
  const h = dayWith('survivor', 3, 5);
  acceptRisk(h);
  h.player.x = h.ev.x + 6;
  h.player.z = h.ev.z;
  h.input.useHeld = true;
  for (let t = 0; t < 60 * 6; t++) h.update(STEP);
  check(h.ev.stage === 1 && h.ev.hold === 0, '不在信号弹旁边，按住 E 也没用');
}

console.log('\n== 尸潮迁徙 ==');
{
  const g = dayWith('migration');
  check(acceptRisk(g) && g.ev.gate >= 0, `接下：预告 ${g.ev.gate + 1} 号入口`);
  const gate = g.map.spawns[g.ev.gate]!;
  let atGate = 0;
  let total = 0;
  g.events.on('zombieSpawned', (z) => {
    total++;
    if (Math.hypot(z.x - gate.x, z.z - gate.z) < 4) atGate++;
  });
  clearNight(g);
  check(atGate / total > 0.45, `代价：这一夜 ${atGate}/${total}（${Math.round((atGate / total) * 100)}%）从那个入口来（平时约 ${Math.round(100 / g.map.spawns.length)}% 左右）`);
  const m1 = medalsFor({ difficulty: 'normal', nights: 3, won: false, kills: 0, headshotKills: 0, migrationNights: g.ev.migrationNights });
  const m0 = medalsFor({ difficulty: 'normal', nights: 3, won: false, kills: 0, headshotKills: 0 });
  check(m1.events === Math.round((4 + 2 * 3) * 0.3) && m1.total > m0.total, `奖励：这一夜的勋章 +30%（+${m1.events}）`);
}

console.log('\n== 黑市商人 ==');
{
  const g = dayWith('market');
  g.scrap = 100;
  check(!acceptRisk(g), '零件不够 150 时接不了');
  g.scrap = 400;
  check(acceptRisk(g) && g.scrap === 250, `代价：花 ${RISK_FX.marketCost} 零件（剩 ${g.scrap}）`);
  const before = g.scrap;
  check(g.upgradeWeapon('pistol') && g.scrap === before && g.loadout.pistol.tier === 1, '奖励：下一次升级不要零件');
  const before2 = g.scrap;
  g.upgradeWeapon('pistol');
  check(g.scrap < before2, '只免这一次');
}

console.log('\n== 检查点：事件状态一起存 ==');
{
  const g = dayWith('survivor');
  acceptRisk(g);
  const raw = JSON.stringify(serialize(g, 1));
  const h = new Game(1);
  check(loadCheckpoint(h, raw) === null && h.ev.id === 'survivor' && h.ev.stage === 1 && h.ev.x === g.ev.x, '读档后事件、进度、信号弹位置都在');
}

console.log('\n== 机器人接下所有事件 ==');
{
  let finished = 0;
  for (const seed of [11, 12, 13]) {
    const g = new Game(seed);
    g.config = { ...g.config, extras: true };
    g.invulnerableCore = true;
    g.invulnerablePlayer = true;
    startRun(g);
    let accepted = 0;
    for (let night = 0; night < 6; night++) {
      if (g.run.phase !== 'day') break;
      if (g.ev.id && acceptRisk(g)) accepted++;
      clearNight(g);
      if ((g.run.phase as string) === 'cards') chooseCard(g, g.run.cardChoices[0] as string);
    }
    if (g.run.night >= 6) finished++;
    console.log(`     种子 ${seed}：打到第 ${g.run.night} 天，接了 ${accepted} 个事件`);
  }
  check(finished === 3, '3 局都能打满 6 夜（接事件不会卡住流程）');
}

console.log('');
if (failures.length) {
  console.log(`未通过 ${failures.length} 项`);
  process.exit(1);
}
console.log('全部通过');
