// 一局流程验证 + 机器人试玩：npm run sim:run
// 机器人不是人，但如果它一路碾压或者第一夜就死，说明难度 / 经济肯定有问题。
import { CARD_BY_ID, CARDS } from '../../src/game/data/cards';
import { MAX_TIER, WEAPON_ORDER, WEAPONS, statsAt, type WeaponKind } from '../../src/game/data/weapons';
import { FINAL_NIGHT, bossFor, nightCount } from '../../src/game/data/waves';
import { ZOMBIES } from '../../src/game/data/zombies';
import { Game, STEP } from '../../src/game/sim';
import { tryPlace } from '../../src/game/systems/building';
import { chooseCard, skipDay, startRun } from '../../src/game/systems/run';

const failures: string[] = [];
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures.push(msg);
};

console.log('\n== 流程：白天 → 夜晚 → 卡牌 → 白天 ==');
{
  const g = new Game(4);
  g.invulnerablePlayer = true;
  g.invulnerableCore = true;
  check(g.run.phase === 'menu', '一开始在主菜单阶段，不刷怪');
  for (let i = 0; i < 120; i++) g.update(STEP);
  check(g.zombies.length === 0, '菜单阶段 2 秒内没有僵尸出现');

  const log: string[] = [];
  g.events.on('phase', (e) => log.push(`${e.phase}${e.night}`));
  startRun(g);
  check(g.run.phase === 'day' && g.run.night === 1 && g.run.timer === 60, '开局进入第 1 天，倒计时 60 秒');
  check(g.scrap === 120, `开局赠送 120 零件（${g.scrap}）`);
  // 白天不刷怪
  for (let i = 0; i < 10 * 60; i++) g.update(STEP);
  check(g.zombies.length === 0 && g.run.phase === 'day', '白天不刷怪');

  // 零件箱
  const box = g.scrapBoxes[0]!;
  g.player.x = box.x;
  g.player.z = box.z;
  const s0 = g.scrap;
  g.update(STEP);
  check(g.scrap >= s0 + 10 && g.scrap <= s0 + 25 && !box.alive, `走到零件箱上捡到 10–25 零件（${g.scrap - s0}）`);
  const s1 = g.scrap;
  g.update(STEP);
  check(g.scrap === s1, '同一个箱子不会重复捡');

  // Enter 提前开始夜晚
  g.input.confirm = true;
  g.update(STEP);
  check(g.run.phase === 'night', 'Enter 提前开始夜晚');
  check(g.run.total === nightCount(1) && g.run.total === 12, `第 1 夜是教学夜，共 ${g.run.total} 只`);
  check(nightCount(2) === 24 && nightCount(10) === 102, `第 2 夜 ${nightCount(2)} 只，第 10 夜 ${nightCount(10)} 只`);

  // 夜晚持续刷怪直到刷完
  let maxAlive = 0;
  for (let i = 0; i < 90 * 60 && g.run.toSpawn > 0; i++) {
    g.update(STEP);
    // 自动把僵尸清掉，避免它们真的打到什么
    for (const z of g.zombies) if (z.alive && z.x !== 0) g.damageZombie(z, 1e6, {});
    maxAlive = Math.max(maxAlive, g.zombies.length);
  }
  check(g.run.toSpawn === 0, '刷怪会按批次刷完');
  for (let i = 0; i < 5; i++) g.update(STEP);
  check(g.run.phase === 'cards', `清完后进入卡牌阶段（现在 ${g.run.phase}）`);
  check(g.run.cardChoices.length === 3 && new Set(g.run.cardChoices).size === 3, `给出 3 张不同的卡（${g.run.cardChoices.join(', ')}）`);
  check(g.scrapEarned >= 60, `夜晚奖励已发放（累计获得 ${g.scrapEarned}）`);

  const before = { hp: g.player.maxHp, speed: g.mods.speed };
  const pick = g.run.cardChoices[0] as string;
  check(!chooseCard(g, 'not-in-choices'), '不能选没给出的卡');
  check(chooseCard(g, pick), `选一张卡（${CARD_BY_ID[pick]?.name}）`);
  check(g.run.phase === 'day' && g.run.night === 2, '选完进入第 2 天');
  check(g.cardCounts[pick] === 1, '卡牌计数 +1');
  void before;
  check(['day1', 'night1', 'cards1', 'day2'].every((p, i) => log[i] === p), `阶段顺序正确（${log.join(' → ')}）`);
}

console.log('\n== 首领 ==');
{
  for (const n of [5, 10]) {
    const g = new Game(6);
    g.invulnerablePlayer = true;
    g.invulnerableCore = true;
    g.aggroScale = 0;
    startRun(g);
    g.run.night = n;
    skipDay(g);
    g.update(STEP);
    g.input.confirm = true;
    g.update(STEP);
    const exp = bossFor(n, g.config.chapter)!;
    const boss = g.zombies.find((z) => z.kind === exp.kind);
    const want = Math.round(ZOMBIES[exp.kind].hp * exp.hpScale);
    check(!!boss && boss.maxHp === want, `第 ${n} 夜出现首领 ${ZOMBIES[exp.kind].name}（生命 ${boss?.maxHp}，预期 ${want}）`);
    check(g.zombies.filter((z) => (exp.escort as string[]).includes(z.kind)).length >= exp.escorts - 1, `首领带了 ${exp.escorts} 个随从`);
  }
  const g = new Game(6);
  startRun(g);
  g.run.night = 3;
  skipDay(g);
  check(!g.zombies.some((z) => z.kind === 'colossus'), '第 3 夜没有首领');
}

console.log('\n== 胜负 ==');
{
  const g = new Game(8);
  g.invulnerablePlayer = true;
  g.invulnerableCore = true;
  startRun(g);
  g.run.night = FINAL_NIGHT;
  skipDay(g);
  g.run.toSpawn = 0;
  for (const z of g.zombies) g.damageZombie(z, 1e9);
  let won = false;
  g.events.on('runEnded', (e) => (won = e.won));
  for (let i = 0; i < 10; i++) g.update(STEP);
  check(g.run.phase === 'won' && won, '第 10 夜清完 → 胜利');

  const g2 = new Game(8);
  startRun(g2);
  let reason = '';
  g2.events.on('runEnded', (e) => (reason = e.reason));
  g2.core.hp = 0;
  g2.update(STEP);
  check(g2.run.phase === 'lost' && reason === 'core', '发电机被摧毁 → 失败');

  const g3 = new Game(8);
  startRun(g3);
  let r3 = '';
  g3.events.on('runEnded', (e) => (r3 = e.reason));
  g3.damagePlayer(9999);
  g3.update(STEP);
  check(g3.run.phase === 'lost' && r3 === 'player', '玩家死亡 → 失败');
}

console.log('\n== 卡牌效果 ==');
{
  const g = new Game(2);
  const apply = (id: string) => (CARD_BY_ID[id] as (typeof CARDS)[number]).apply(g);
  apply('vitality');
  check(g.player.maxHp === 120, '强健体魄：最大生命 120');
  apply('agility');
  check(Math.abs(g.mods.speed - 1.08) < 1e-9, '轻装上阵：移速 ×1.08');
  g.scrap = 500;
  g.player.x = 0.5;
  g.player.z = 10;
  g.buildKind = 'barricade';
  tryPlace(g, 40, 45);
  const s = [...g.structures.values()][0]!;
  const hp0 = s.maxHp;
  apply('fortify');
  check(s.maxHp === Math.round(hp0 * 1.3), `加固路障：已有路障生命 ${hp0} → ${s.maxHp}`);
  apply('armor');
  g.invulnerablePlayer = false;
  const hpBefore = g.player.hp;
  g.damagePlayer(100);
  check(Math.abs(hpBefore - g.player.hp - 88) < 1e-6, `重型护甲：受到 100 伤害实际扣 ${(hpBefore - g.player.hp).toFixed(0)}`);
  apply('lifesteal');
  g.player.hp = 50;
  const z = g.spawnZombie('walker', 0, 0, 1)!;
  g.damageZombie(z, 1e6);
  check(g.player.hp === 50 && g.healPool === 1, '嗜血：击杀不立刻回血，攒进回血池（1 点）');
  for (let i = 0; i < 9; i++) g.damageZombie(g.spawnZombie('walker', 0, 0, 1)!, 1e6);
  g.hurtT = 0;
  g.run.phase = 'night';
  g.run.toSpawn = 5;
  const hpLs = g.player.hp;
  for (let i = 0; i < 30; i++) g.update(STEP);
  check(g.player.hp - hpLs <= 2.01 && g.player.hp > hpLs, `嗜血：连杀 10 只，0.5 秒只回 ${(g.player.hp - hpLs).toFixed(1)} 点（每秒最多 4 点）`);
  apply('regen');
  g.core.hp = 100;
  g.run.phase = 'night';
  g.run.toSpawn = 5;
  for (let i = 0; i < 120; i++) g.update(STEP);
  check(g.core.hp > 100 + 2.5, `自动修复：发电机 2 秒回血（${g.core.hp.toFixed(1)}）`);
  apply('crit');
  check(Math.abs(g.mods.crit - 0.08) < 1e-9, '致命一击：暴击率 8%');
}

// ------------------------------------------------------------------
// 机器人试玩
// ------------------------------------------------------------------
interface BotResult {
  survived: number;
  won: boolean;
  reason: string;
  kills: number;
  scrapEarned: number;
  timeline: string[];
}

function playBot(seed: number, verbose = false): BotResult {
  const g = new Game(seed);
  g.aggroScale = 1;
  const timeline: string[] = [];
  startRun(g);
  g.player.x = 0.5;
  g.player.z = 4;
  // 炮塔放在发电机四周，这样不管僵尸从哪个入口来都在射程里
  const turretSpots: Array<[number, number]> = [[38, 36], [42, 36], [38, 42], [42, 42], [36, 39], [44, 39]];
  let turretIdx = 0;

  /** 机器人用的武器评分：持续 DPS，乘上穿透和范围伤害的价值；越后面买的枪越值得升级 */
  const score = (k: WeaponKind, tier: number): number => {
    const st = statsAt(k, tier);
    const dps = (st.damage * st.pellets * st.mag) / (st.mag / st.rate + st.reload);
    return dps * (1 + st.pierce * 0.15 + (st.aoe > 0 ? 0.5 : 0) + (st.burn > 0 ? 0.2 : 0));
  };
  const bestOwned = (): WeaponKind => {
    let best: WeaponKind = 'pistol';
    let bd = 0;
    for (const k of WEAPON_ORDER) {
      if (!g.loadout[k].owned) continue;
      const d = score(k, g.loadout[k].tier);
      if (d > bd) {
        bd = d;
        best = k;
      }
    }
    return best;
  };
  /** 升级目标：已拥有的武器里"升满后最强"的那一把，而不是当前最强的那一把 */
  const upgradeTarget = (): WeaponKind => {
    let best: WeaponKind = 'pistol';
    let bd = 0;
    for (const k of WEAPON_ORDER) {
      if (!g.loadout[k].owned) continue;
      const d = score(k, 5);
      if (d > bd) {
        bd = d;
        best = k;
      }
    }
    return best;
  };

  const tryTurret = (): boolean => {
    if (turretIdx >= turretSpots.length || g.scrap < 90) return false;
    const [cx, cy] = turretSpots[turretIdx] as [number, number];
    g.buildKind = 'turret';
    const px = g.player.x;
    const pz = g.player.z;
    g.player.x = cx - 40 + 0.5;
    g.player.z = cy - 40 + 3;
    const ok = tryPlace(g, cx, cy);
    g.player.x = px;
    g.player.z = pz;
    if (ok) turretIdx++;
    return ok;
  };

  const spend = () => {
    // 白天花钱：先有两座炮塔守着发电机，然后把武器升上去，够强了再买新枪，最后补更多炮塔
    let progress = true;
    while (progress) {
      progress = false;
      const nextBuy = (['smg', 'shotgun', 'rifle', 'lmg'] as WeaponKind[]).find((k) => !g.loadout[k].owned);
      const cur = upgradeTarget();
      const slot = g.loadout[cur];
      const up = slot.tier < MAX_TIER ? WEAPONS[cur].upgrades[slot.tier] : undefined;
      if (turretIdx < 2 && tryTurret()) {
        progress = true;
        continue;
      }
      // 有钱就换更好的枪：手枪升满也比不上别的枪升 1 级，所以不要把钱砸在手枪上。
      // 条件：买得起，并且买完还能立刻升 1 级
      if (nextBuy && g.scrap >= WEAPONS[nextBuy].price + (WEAPONS[nextBuy].upgrades[0]?.cost ?? 0) && (cur === 'pistol' || slot.tier >= 3)) {
        if (g.buyWeapon(nextBuy)) progress = true;
        continue;
      }
      if (up && g.scrap >= up.cost) {
        if (g.upgradeWeapon(cur)) progress = true;
        continue;
      }
      if (turretIdx >= 2 && tryTurret()) progress = true;
    }
  };

  const nearest = () => {
    let best = null as null | (typeof g.zombies)[number];
    let bd = 1e9;
    for (const z of g.zombies) {
      if (!z.alive) continue;
      const d = Math.hypot(z.x - g.player.x, z.z - g.player.z);
      if (d < bd) {
        bd = d;
        best = z;
      }
    }
    return { z: best, d: bd };
  };

  let lastNight = 0;
  const maxTicks = 60 * 60 * 25;
  for (let t = 0; t < maxTicks; t++) {
    const ph = g.run.phase;
    if (ph === 'won' || ph === 'lost') break;
    if (ph === 'day') {
      if (g.run.night !== lastNight) {
        lastNight = g.run.night;
        // 白天：把零件箱都捡了（直接传送过去，近似"跑过去捡"），再回来花钱
        for (const b of g.scrapBoxes) {
          g.player.x = b.x;
          g.player.z = b.z;
          g.update(STEP);
        }
        g.player.x = 0.5;
        g.player.z = 4;
        spend();
        skipDay(g);
      }
      g.update(STEP);
      continue;
    }
    if (ph === 'cards') {
      // 机器人随便选第一张，偏好生存类
      const prefer = ['vitality', 'armor', 'corehp', 'gunsmith', 'fortify', 'overclock'];
      const pick = g.run.cardChoices.find((c) => prefer.includes(c)) ?? (g.run.cardChoices[0] as string);
      timeline.push(`第${g.run.night}夜结束 hp=${Math.round(g.player.hp)}/${g.player.maxHp} 发电机=${Math.round(g.core.hp)} 零件=${g.scrap} 选${CARD_BY_ID[pick]?.name} 枪=${g.player.weapon}${g.player.tier}`);
      chooseCard(g, pick);
      continue;
    }
    // 夜晚：切到最好的枪，朝最近的僵尸开火；太近就后撤
    const best = bestOwned();
    if (g.player.weapon !== best) g.input.select = WEAPON_ORDER.indexOf(best) + 1;
    const { z, d } = nearest();
    g.input.fire = false;
    g.input.moveX = 0;
    g.input.moveZ = 0;
    if (z) {
      g.input.aimX = z.x;
      g.input.aimZ = z.z;
      // 瞄胸口（约 0.9 米高）：俯仰角按距离算，子弹是 3D 的，不再自动瞄准高度。
      // 僵尸驼着背冲过来时头在 1.1–1.5 米、胸口前面，瞄 1.2 米会发发爆头，机器人就不像「只会打身体的普通玩家」了
      g.input.aimPitch = Math.atan2(0.9 - g.player.eye, Math.max(0.5, d));
      g.input.fire = d < Math.min(16, statsAt(g.player.weapon, g.player.tier).range - 0.5);
      // 站在发电机附近，太近就往后退（保持距离射击）
      if (d < 3.5) {
        const away = Math.hypot(g.player.x - z.x, g.player.z - z.z) || 1;
        g.input.moveX = (g.player.x - z.x) / away;
        g.input.moveZ = (g.player.z - z.z) / away;
        g.input.sprint = true;
      } else g.input.sprint = false;
    }
    g.update(STEP);
  }
  void verbose;
  return { survived: g.run.night - (g.run.phase === 'won' ? 0 : 1), won: g.run.phase === 'won', reason: g.run.lostReason, kills: g.stats.kills, scrapEarned: g.scrapEarned, timeline };
}

console.log('\n== 机器人试玩（不是人，只用来发现明显失衡）==');
{
  const results: BotResult[] = [];
  for (const seed of [1, 2, 3]) {
    const r = playBot(seed);
    results.push(r);
    console.log(`  种子 ${seed}: ${r.won ? '通关' : `在第 ${r.survived + 1} 夜失败（${r.reason === 'core' ? '发电机被毁' : '玩家死亡'}）`}，击杀 ${r.kills}，累计零件 ${r.scrapEarned}`);
    if (seed === 1) for (const line of r.timeline) console.log(`     ${line}`);
  }
  const best = Math.max(...results.map((r) => r.survived + (r.won ? 1 : 0)));
  check(best >= 3, `机器人至少能撑过 3 夜（最好 ${best} 夜）：游戏不是一开始就无解`);
  const allWon = results.every((r) => r.won);
  check(!allWon, '机器人不会 3 次都轻松通关：游戏有挑战');
}

console.log('');
if (failures.length) {
  console.log(`未通过 ${failures.length} 项：`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('全部通过');
