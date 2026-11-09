// 长线成长模拟：npm run sim:progress [-- --runs 60 --seed 1]
// 机器人连续打很多局，每局结束按真实规则结算勋章 / 补给 / 熟练度，再在大厅里花掉，
// 用来回答：每局能拿多少、每把枪要练几局、带哪把枪收益最高、整张表买满要多久。
import { CARD_BY_ID } from '../../src/game/data/cards';
import { META_ITEMS, RANKS, rankOf } from '../../src/game/data/meta-catalog';
import { MASTERY_MAX, MASTERY_XP, masteryLevel } from '../../src/game/data/mastery';
import { MAX_TIER, WEAPON_ORDER, WEAPONS, statsAt, type WeaponKind } from '../../src/game/data/weapons';
import { BENCH_LINES } from '../../src/game/data/bench';
import { applyMeta } from '../../src/game/meta/loadout';
import { bonusesOf, buyBench, buyMeta, canBench, canBuy, masteryOf, medalsFor, newMeta, settleRun, suppliesFor, totalMetaCost, type MetaState, type RunOutcome } from '../../src/game/meta/progress';
import { Game, STEP } from '../../src/game/sim';
import { tryPlace } from '../../src/game/systems/building';
import { chooseCard, nightsSurvived, skipDay, startRun } from '../../src/game/systems/run';

const arg = (k: string, d: number): number => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? Number(process.argv[i + 1]) : d;
};
const RUNS = arg('runs', 40);
const SEED = arg('seed', 1);
/**
 * 机器人瞄胸口、不会爆头，人会。熟练度按「击杀 + 爆头击杀」算，普通玩家大约 15% 的击杀是爆头，
 * 这里把机器人的击杀 ×1.15 当成人类玩家的经验（勋章也按 15% 爆头补上）
 */
const HUMAN_HS = 0.15;

const failures: string[] = [];
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures.push(msg);
};

interface RunLog {
  i: number;
  nights: number;
  won: boolean;
  kills: number;
  main: WeaponKind;
  wk: Record<WeaponKind, number>;
  medals: number;
  supplies: number;
  bought: string[];
}

/** 一局：按存档里的局外加成开局，机器人打到死（或通关） */
function playRun(meta: MetaState, seed: number): { outcome: RunOutcome; main: WeaponKind } {
  const b = bonusesOf(meta);
  const g = new Game(seed);
  // 有「随身武器」就带上最新解锁的枪
  const side = [...WEAPON_ORDER].reverse().find((k) => k !== 'pistol' && b.weapons.has(k)) ?? null;
  applyMeta(g, b, { difficulty: 'normal', sidearm: b.sidearm ? side : null, bench: meta.bench });
  startRun(g);
  g.player.x = 0.5;
  g.player.z = 4;
  const turretSpots: Array<[number, number]> = [[38, 36], [42, 36], [38, 42], [42, 42], [36, 39], [44, 39], [40, 33], [40, 45]];
  let turretIdx = 0;
  /** 主武器：已解锁里最后一把（玩家总是想用新枪） */
  const newest = (): WeaponKind => [...WEAPON_ORDER].reverse().find((k) => g.config.weapons.includes(k)) ?? 'pistol';
  const tryTurret = (): boolean => {
    if (turretIdx >= turretSpots.length || g.scrap < 90 || g.turretCount() >= g.config.turretCap) return false;
    const [cx, cy] = turretSpots[turretIdx] as [number, number];
    g.buildKind = 'turret';
    const px = g.player.x;
    const pz = g.player.z;
    g.player.x = cx - 40 + 0.5;
    g.player.z = cy - 40 + 3;
    const ok = tryPlace(g, cx, cy);
    g.player.x = px;
    g.player.z = pz;
    turretIdx++;
    return ok;
  };
  /** 手上最好的枪：已拥有的里最新的一把 */
  const bestOwned = (): WeaponKind => [...WEAPON_ORDER].reverse().find((k) => g.loadout[k].owned) ?? 'pistol';
  const spend = () => {
    let progress = true;
    while (progress) {
      progress = false;
      if (g.turretCount() < 2 && tryTurret()) {
        progress = true;
        continue;
      }
      // 买得起新枪就买；买不起先把手上的枪升上去（不囤钱）
      const main = newest();
      if (main !== 'pistol' && !g.loadout[main].owned && g.scrap >= WEAPONS[main].price + (WEAPONS[main].upgrades[0]?.cost ?? 0)) {
        if (g.buyWeapon(main)) progress = true;
        continue;
      }
      const cur = bestOwned();
      const slot = g.loadout[cur];
      const up = slot.tier < Math.min(MAX_TIER, g.config.tierCap[cur]) ? WEAPONS[cur].upgrades[slot.tier] : undefined;
      // 新枪没买时，给它留一半的钱
      const reserve = main !== cur && !g.loadout[main].owned ? WEAPONS[main].price * 0.5 : 0;
      if (up && g.scrap - up.cost >= reserve) {
        if (g.upgradeWeapon(cur)) progress = true;
        continue;
      }
      if (!up && tryTurret()) progress = true;
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
  for (let t = 0; t < 60 * 60 * 30; t++) {
    const ph = g.run.phase;
    if (ph === 'won' || ph === 'lost') break;
    if (ph === 'day') {
      if (g.run.night !== lastNight) {
        lastNight = g.run.night;
        for (const box of g.scrapBoxes) {
          g.player.x = box.x;
          g.player.z = box.z;
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
      const prefer = ['vitality', 'armor', 'corehp', 'gunsmith', 'fortify', 'overclock'];
      const pick = g.run.cardChoices.find((c) => prefer.includes(c)) ?? (g.run.cardChoices[0] as string);
      void CARD_BY_ID;
      chooseCard(g, pick);
      continue;
    }
    const want = bestOwned();
    if (g.player.weapon !== want) g.input.select = WEAPON_ORDER.indexOf(want) + 1;
    const { z, d } = nearest();
    g.input.fire = false;
    g.input.moveX = 0;
    g.input.moveZ = 0;
    if (z) {
      g.input.aimX = z.x;
      g.input.aimZ = z.z;
      // 瞄目标身体中间（爬行者只有 0.7 米高，瞄胸口高度会从它头顶飞过去）
      g.input.aimPitch = Math.atan2(Math.min(1.2, z.def.height * 0.55) - g.player.eye, Math.max(0.5, d));
      // 霰弹枪散量大（14°），远了打不中，得像真人一样贴到 4–5 米再开火
      const close = g.player.weapon === 'shotgun';
      const fireRange = close ? 6 : Math.min(16, statsAt(g.player.weapon, g.player.tier).range - 0.5);
      g.input.fire = d < fireRange;
      const away = Math.hypot(g.player.x - z.x, g.player.z - z.z) || 1;
      if (close) {
        // 霰弹枪：保持 3–5 米，太远就压上去，太近就退一步
        if (d > 5) {
          g.input.moveX = (z.x - g.player.x) / away;
          g.input.moveZ = (z.z - g.player.z) / away;
        } else if (d < 2.5) {
          g.input.moveX = (g.player.x - z.x) / away;
          g.input.moveZ = (g.player.z - z.z) / away;
        }
      } else if (d < 3.5) {
        g.input.moveX = (g.player.x - z.x) / away;
        g.input.moveZ = (g.player.z - z.z) / away;
        g.input.sprint = true;
      } else g.input.sprint = false;
    }
    g.update(STEP);
  }
  const s = g.stats;
  // 人类玩家的爆头：按击杀的 15% 补上
  const heads = Object.fromEntries(WEAPON_ORDER.map((k) => [k, Math.round(s.weaponKills[k] * HUMAN_HS)])) as Record<WeaponKind, number>;
  const outcome: RunOutcome = { difficulty: 'normal', nights: nightsSurvived(g.run), won: g.run.phase === 'won', kills: s.kills, headshotKills: Math.round(s.kills * HUMAN_HS), weaponKills: { ...s.weaponKills }, weaponHeads: heads };
  return { outcome, main: newest() };
}

/** 大厅花钱：先解锁武器（有就买），再买武器台（补给），再按价格从低到高买别的 */
function shop(m: MetaState): [MetaState, string[]] {
  const bought: string[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    const unlock = META_ITEMS.find((it) => it.id.startsWith('unlock-') && it.section === 'armory' && canBuy(m, it.id) === 'ok');
    if (unlock) {
      [m] = buyMeta(m, unlock.id);
      bought.push(unlock.name);
      changed = true;
      continue;
    }
    // 下一把枪的解锁已经可以买、只是勋章不够：先攒着
    const saving = META_ITEMS.find((it) => it.id.startsWith('unlock-') && it.section === 'armory' && canBuy(m, it.id) === 'medals');
    const cands = META_ITEMS.filter((it) => canBuy(m, it.id) === 'ok')
      .map((it) => ({ it, price: it.prices[m.levels[it.id] ?? 0] as number }))
      .filter((c) => !saving || m.medals - c.price >= (saving.prices[0] as number))
      .sort((a, b) => a.price - b.price);
    const c = cands[0];
    if (c) {
      [m] = buyMeta(m, c.it.id);
      bought.push(c.it.name);
      changed = true;
    }
  }
  // 武器台：主武器优先
  const main = [...WEAPON_ORDER].reverse().find((k) => k === 'pistol' || bonusesOf(m).weapons.has(k)) ?? 'pistol';
  for (const k of [main, ...WEAPON_ORDER]) {
    for (const line of BENCH_LINES) {
      while (canBench(m, k, line) === 'ok') {
        m = buyBench(m, k, line) as MetaState;
        bought.push(`武器台·${WEAPONS[k].name}·${line}`);
      }
    }
  }
  return [m, bought];
}

console.log(`\n== 长线成长：${RUNS} 局（普通难度第一章，机器人 + 15% 爆头）==`);
let meta = newMeta();
const logs: RunLog[] = [];
const t0 = Date.now();
for (let i = 1; i <= RUNS; i++) {
  const { outcome, main } = playRun(meta, SEED * 1000 + i);
  const medals = medalsFor(outcome).total;
  const supplies = suppliesFor(outcome);
  [meta] = settleRun(meta, outcome);
  let bought: string[];
  [meta, bought] = shop(meta);
  logs.push({ i, nights: outcome.nights, won: outcome.won, kills: outcome.kills, main, wk: outcome.weaponKills as Record<WeaponKind, number>, medals, supplies, bought });
}
const short = (k: WeaponKind) => WEAPONS[k].name.replace(/^.*?(手枪|冲锋枪|霰弹枪|突击步枪|狙击步枪|轻机枪|榴弹发射器)$/, '$1');
console.log('  局  夜 通关 击杀  主武器    本局武器击杀              勋章 补给  熟练度（手/冲/霰/步/狙/机/榴）  买了');
let m2 = newMeta();
for (const l of logs) {
  const [mm] = settleRun(m2, { difficulty: 'normal', nights: l.nights, won: l.won, kills: l.kills, headshotKills: 0, weaponKills: l.wk, weaponHeads: Object.fromEntries(WEAPON_ORDER.map((k) => [k, Math.round(l.wk[k] * HUMAN_HS)])) });
  m2 = { ...m2, mastery: mm.mastery };
  const wk = WEAPON_ORDER.filter((k) => l.wk[k] > 0).map((k) => `${short(k)}${l.wk[k]}`).join(' ');
  const ms = WEAPON_ORDER.map((k) => masteryLevel(k, m2.mastery[k] ?? 0)).join('/');
  const bought = l.bought.filter((b) => !b.startsWith('武器台')).join('、');
  const bench = l.bought.filter((b) => b.startsWith('武器台')).length;
  console.log(`  ${String(l.i).padStart(2)}  ${String(l.nights).padStart(2)}  ${l.won ? '是' : '  '}  ${String(l.kills).padStart(4)}  ${short(l.main).padEnd(5, '　')}  ${wk.padEnd(22, ' ')}  ${String(l.medals).padStart(4)} ${String(l.supplies).padStart(4)}  ${ms.padEnd(14)}  ${bought}${bench ? `${bought ? '、' : ''}武器台 ${bench} 级` : ''}`);
}
console.log(`  （模拟用时 ${((Date.now() - t0) / 1000).toFixed(0)} 秒）`);

console.log('\n== 每把枪练到精通用了几局 ==');
const firstAt = (k: WeaponKind, lv: number): number | null => {
  let acc = newMeta();
  for (const l of logs) {
    const [mm] = settleRun(acc, { difficulty: 'normal', nights: l.nights, won: l.won, kills: l.kills, headshotKills: 0, weaponKills: l.wk, weaponHeads: Object.fromEntries(WEAPON_ORDER.map((x) => [x, Math.round(l.wk[x] * HUMAN_HS)])) });
    acc = { ...acc, mastery: mm.mastery };
    if (masteryLevel(k, acc.mastery[k] ?? 0) >= lv) return l.i;
  }
  return null;
};
const startedAt = (k: WeaponKind): number | null => logs.find((l) => l.wk[k] > 0)?.i ?? null;
const spans: Partial<Record<WeaponKind, number>> = {};
for (const k of WEAPON_ORDER) {
  const s = startedAt(k);
  const e = firstAt(k, MASTERY_MAX);
  if (s && e) spans[k] = e - s + 1;
  const perRun = logs.filter((l) => l.main === k && l.wk[k] > 0).map((l) => l.wk[k] * (1 + HUMAN_HS));
  const avg = perRun.length ? perRun.reduce((a, b) => a + b, 0) / perRun.length : 0;
  console.log(`  ${WEAPONS[k].name.padEnd(8, '　')} 开始用：第 ${s ?? '—'} 局，精通：第 ${e ?? '—'} 局${s && e ? `（练了 ${e - s + 1} 局）` : ''}，当主武器时每局约 ${avg.toFixed(0)} 经验，精通要 ${MASTERY_XP[k][MASTERY_MAX - 1]}`);
}

console.log('\n== 带什么枪收益最高（同一套局外加成，每把枪各打 3 局，取平均）==');
{
  // 用第 RUNS 局之后的存档，把所有枪都放开，看各自能打几夜、拿多少勋章
  const open: MetaState = { ...meta, levels: { ...meta.levels }, mastery: { ...meta.mastery } };
  for (const k of WEAPON_ORDER) if (k !== 'pistol') open.levels[`unlock-${k}`] = 1;
  for (const k of WEAPON_ORDER) open.mastery[k] = Math.max(open.mastery[k] ?? 0, MASTERY_XP[k][1] as number); // 都按熟练度 2（上限 6）比
  for (const only of WEAPON_ORDER) {
    let nights = 0;
    let medals = 0;
    let kills = 0;
    for (let s = 0; s < 3; s++) {
      const m3: MetaState = { ...open, levels: { ...open.levels } };
      for (const k of WEAPON_ORDER) if (k !== 'pistol' && k !== only) delete m3.levels[`unlock-${k}`];
      const r = playRun(m3, 9000 + s);
      nights += r.outcome.nights;
      medals += medalsFor(r.outcome).total;
      kills += (r.outcome.weaponKills as Record<WeaponKind, number>)[only];
    }
    console.log(`  ${WEAPONS[only].name.padEnd(8, '　')} 平均撑 ${(nights / 3).toFixed(1)} 夜，勋章 ${(medals / 3).toFixed(0)}，这把枪击杀 ${(kills / 3).toFixed(0)}（工坊价 ${WEAPONS[only].price}）`);
  }
}

console.log('\n== 总结 ==');
{
  const total = totalMetaCost();
  const earned = meta.medalsEarned;
  const avgMedals = earned / RUNS;
  console.log(`  ${RUNS} 局累计勋章 ${earned}（每局约 ${avgMedals.toFixed(0)}），军衔 ${RANKS[rankOf(earned)]?.name}，整张表 ${total}，按这个速度约 ${(total / avgMedals).toFixed(0)} 局买满`);
  console.log(`  最远：第 ${Math.max(...logs.map((l) => l.nights))} 夜，通关 ${logs.filter((l) => l.won).length} 次`);
  console.log(`  熟练度：${WEAPON_ORDER.map((k) => `${WEAPONS[k].name} ${masteryOf(meta, k)}`).join('，')}`);
  const pistolEnd = firstAt('pistol', MASTERY_MAX);
  const smgStart = startedAt('smg');
  check(pistolEnd !== null && pistolEnd >= 4 && pistolEnd <= 6, `手枪要打 4–6 局才精通（第 ${pistolEnd} 局）`);
  check(smgStart === null || (pistolEnd !== null && smgStart > pistolEnd), `手枪精通之前用不上冲锋枪（冲锋枪第 ${smgStart ?? '—'} 局开始用）`);
  const s = spans.smg;
  check(s === undefined || (s >= 3 && s <= 7), `冲锋枪从开始用到精通 3–7 局（${s ?? '没练到'}）`);
  // M16：每把练到了的枪，从开始用到精通都在 3–8 局（霰弹枪以前要 12 局）
  const outOf = WEAPON_ORDER.filter((k) => spans[k] !== undefined && ((spans[k] as number) < 3 || (spans[k] as number) > 8));
  check(outOf.length === 0, `每把枪开始用到精通 3–8 局（${WEAPON_ORDER.filter((k) => spans[k] !== undefined).map((k) => `${WEAPONS[k].name} ${spans[k]}`).join('、')}）`);
}

console.log('');
if (failures.length) {
  console.log(`未通过 ${failures.length} 项`);
  process.exit(1);
}
console.log('全部通过');
