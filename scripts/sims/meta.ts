// 局外成长 + 存档 + 检查点验证：npm run sim:meta
import { CARD_BY_ID } from '../../src/game/data/cards';
import { META_BY_ID, META_ITEMS, RANKS, SECTION_NAME, baseBonuses, rankFor, rankOf } from '../../src/game/data/meta-catalog';
import { FINAL_NIGHT } from '../../src/game/data/waves';
import { applyMeta, applyTraining, sidearmOk, widenMeta } from '../../src/game/meta/loadout';
import { bonusesOf, buyBench, buyMeta, canBench, canBuy, masteryOf, medalsFor, newMeta, settleRun, totalMetaCost, unlockedDifficulties, type MetaState } from '../../src/game/meta/progress';
import { MASTERY_XP, MASTERY_MAX } from '../../src/game/data/mastery';
import { WEAPON_ORDER } from '../../src/game/data/weapons';

/** 每把枪都练到某一级熟练度 */
const masteredAll = (lv = MASTERY_MAX): MetaState['mastery'] => Object.fromEntries(WEAPON_ORDER.map((k) => [k, MASTERY_XP[k][lv - 1] as number]));
import { RUN_KEY, applyCheckpoint, loadCheckpoint, parseCheckpoint, serialize } from '../../src/game/save/checkpoint';
import { SAVE_KEY, SAVE_KEY_V1, defaultSave } from '../../src/game/save/schema';
import { MemoryStorage } from '../../src/game/save/storage';
import * as storeModule from '../../src/game/save/store';
import { loadSave, writeSave } from '../../src/game/save/store';
import { Game, STEP } from '../../src/game/sim';
import { tryPlace } from '../../src/game/systems/building';
import { chooseCard, nightsSurvived, rerollCards, skipDay, startRun } from '../../src/game/systems/run';
import { Training } from '../../src/game/systems/training';

const failures: string[] = [];
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures.push(msg);
};

console.log('\n== 存档：写入后读回 ==');
{
  const st = new MemoryStorage();
  const s = defaultSave();
  s.bestNight = 7;
  s.totalKills = 1234;
  s.quality = 'mid';
  s.meta.medals = 321;
  s.meta.levels = { 'turret-cap': 2, 'unlock-sniper': 1 };
  s.meta.cleared = ['normal'];
  writeSave(st, s);
  const r = loadSave(st);
  check(JSON.stringify(r.save) === JSON.stringify(s) && r.warning === '', '读回的存档和写入的逐字段相等');
}

console.log('\n== 存档：v1 迁移 ==');
{
  const st = new MemoryStorage();
  st.set(SAVE_KEY_V1, JSON.stringify({ version: 1, bestNight: 6, bestKills: 210, wins: 1, runs: 9, totalKills: 1500, bestWinTime: 1800, volume: 0.4, quality: 'low', sensitivity: 1.6 }));
  const r = loadSave(st);
  const s = r.save;
  check(r.migrated && s.version === 2, '没有 v2 时自动迁移 v1');
  check(s.bestNight === 6 && s.bestKills === 210 && s.wins === 1 && s.runs === 9 && s.totalKills === 1500 && s.bestWinTime === 1800, '统计保留');
  check(s.volume === 0.4 && s.quality === 'low' && s.sensitivity === 1.6, '设置保留');
  check(s.meta.medals === 0 && s.meta.cleared.includes('normal'), '局外进度从零开始；通关过的话困难难度已解锁');
  check(st.get(SAVE_KEY) !== null, '迁移后写入了 v2');
}

console.log('\n== 存档：坏档 ==');
{
  const good = (): Record<string, unknown> => JSON.parse(JSON.stringify(defaultSave())) as Record<string, unknown>;
  const cases: Array<[string, string]> = [
    ['JSON 坏了', '{"version":2,'],
    ['不是对象', '[1,2,3]'],
    ['版本号不对', JSON.stringify({ ...good(), version: 9 })],
    ['字段缺失', JSON.stringify((({ runs: _r, ...rest }) => rest)(good()))],
    ['数值越界', JSON.stringify({ ...good(), bestNight: 99 })],
    ['类型不对', JSON.stringify({ ...good(), volume: 'loud' })],
    ['NaN', JSON.stringify({ ...good(), sensitivity: null })],
    ['枚举不对', JSON.stringify({ ...good(), quality: 'ultra' })],
    ['勋章为负', JSON.stringify({ ...good(), meta: { ...newMeta(), medals: -5 } })],
    ['通关记录不是数组', JSON.stringify({ ...good(), meta: { ...newMeta(), cleared: 'normal' } })],
  ];
  let rejected = 0;
  for (const [name, raw] of cases) {
    const st = new MemoryStorage();
    st.set(SAVE_KEY, raw);
    let threw = false;
    let warning = '';
    try {
      const r = loadSave(st);
      warning = r.warning;
      if (warning && JSON.stringify(r.save) === JSON.stringify(defaultSave())) rejected++;
    } catch {
      threw = true;
    }
    if (threw || !warning) console.log(`     ${name}: ${threw ? '抛了异常' : '没有被拒绝'}`);
  }
  check(rejected === cases.length, `${cases.length} 种坏档都被拒绝且不抛异常（${rejected}）`);
}

console.log('\n== 勋章结算 ==');
{
  // 直接按 12.5 的表算
  const table = (nights: number, won: boolean, kills: number, hs: number, mult: number) => {
    let t = 0;
    for (let n = 1; n <= nights; n++) t += 4 + 2 * n;
    if (nights >= 5) t += 15;
    if (nights >= 10) t += 30;
    t += Math.floor(kills / 25) + Math.floor(hs / 10) + (won ? 40 : 0);
    return Math.round(t * mult);
  };
  let ok = true;
  for (const d of ['normal', 'hard', 'nightmare'] as const) {
    const mult = d === 'normal' ? 1 : d === 'hard' ? 1.5 : 2;
    for (let n = 0; n <= FINAL_NIGHT; n++) {
      const won = n === FINAL_NIGHT;
      const kills = n * 37;
      const hs = n * 11;
      if (medalsFor({ difficulty: d, nights: n, won, kills, headshotKills: hs }).total !== table(n, won, kills, hs, mult)) ok = false;
    }
  }
  check(ok, '0–10 夜 × 3 种难度，实现和表格逐项一致');
  const d3 = medalsFor({ difficulty: 'normal', nights: 2, won: false, kills: 40, headshotKills: 5 }).total;
  const d6 = medalsFor({ difficulty: 'normal', nights: 5, won: false, kills: 160, headshotKills: 20 }).total;
  const win = medalsFor({ difficulty: 'normal', nights: 10, won: true, kills: 700, headshotKills: 120 }).total;
  console.log(`     死在第 3 夜 ≈ ${d3}，死在第 6 夜 ≈ ${d6}，通关 ≈ ${win}`);
  check(d3 >= 10 && d3 <= 20 && d6 >= 55 && d6 <= 85 && win >= 240 && win <= 300, '典型局的勋章在设计范围内（约 15 / 70 / 270）');

  // 中途放弃：按已经撑过的夜数结算
  const g = new Game(3);
  startRun(g);
  check(nightsSurvived(g.run) === 0, '第 1 天放弃：撑过 0 夜');
  g.run.night = 4;
  g.run.phase = 'night';
  check(nightsSurvived(g.run) === 3, '第 4 夜中途放弃：撑过 3 夜');
  g.run.phase = 'cards';
  check(nightsSurvived(g.run) === 4, '第 4 夜之后的黎明放弃：撑过 4 夜');
  const [m2] = settleRun(newMeta(), { difficulty: 'hard', nights: 10, won: true, kills: 0, headshotKills: 0 });
  check(m2.cleared.includes('hard') && unlockedDifficulties(m2).includes('nightmare'), '通关困难后噩梦解锁');
  check(!unlockedDifficulties(newMeta()).includes('hard'), '一开始只能选普通');
}

console.log('\n== 购买 ==');
{
  // 累计勋章 10000：军衔已到顶，这里只测价格和前置
  let m: MetaState = { ...newMeta(), medals: 1000, medalsEarned: 10000 };
  let r;
  [m, r] = buyMeta(m, 'unlock-smg');
  check(r === 'mastery' && m.medals === 1000, '手枪没精通时解锁不了冲锋枪（勋章再多也不行）');
  m = { ...m, mastery: { pistol: MASTERY_XP.pistol[MASTERY_MAX - 1] as number } };
  [m, r] = buyMeta(m, 'unlock-smg');
  check(r === 'ok' && bonusesOf(m).weapons.has('smg'), '手枪精通后能解锁冲锋枪');
  check(canBuy(m, 'unlock-shotgun') === 'mastery', '冲锋枪没精通时解锁不了霰弹枪（武器解锁是一条链）');
  m = { ...m, mastery: masteredAll() };
  [m] = buyMeta(m, 'unlock-shotgun');
  check(canBuy(m, 'unlock-sniper') === 'requires', '没解锁突击步枪时买不了狙击');
  [m] = buyMeta(m, 'unlock-rifle');
  const m0 = m.medals;
  const sniperPrice = META_BY_ID['unlock-sniper']?.prices[0] ?? 0;
  [m, r] = buyMeta(m, 'unlock-sniper');
  check(r === 'ok' && m.medals === m0 - sniperPrice && bonusesOf(m).weapons.has('sniper'), `冲锋 → 霰弹 → 步枪 → 狙击：扣 ${sniperPrice} 勋章，加成立刻生效`);
  m = { ...m, medals: 5 };
  [m, r] = buyMeta(m, 'turret-cap');
  check(r === 'medals' && m.medals === 5, '勋章不够时买不了');
  m = { ...m, medals: 5000 };
  [m, r] = buyMeta(m, 'unlock-sniper');
  check(r === 'maxed', '满级后不能再买');
  check(canBuy(m, 'unlock-hmg') === 'requires' && canBuy(m, 'four-cards') === 'requires' && canBuy(m, 'scrap-gain') === 'requires', '重机枪塔要先买炮塔上限、四选一要先买重抽、零件收益要先买两级开局零件');
  for (let i = 0; i < 5; i++) [m] = buyMeta(m, 'turret-cap');
  check(bonusesOf(m).turretCap === 8 && canBuy(m, 'turret-cap') === 'maxed', '炮塔上限买满到 8');
  check(canBuy(m, 'unlock-hmg') === 'ok' && canBuy(m, 'unlock-mortar') === 'requires', '买了炮塔上限能解锁重机枪塔，迫击炮还要先有喷火塔');
  check(canBuy(m, 'nope') === 'unknown', '未知项目被拒绝');
}

console.log('\n== 武器熟练度 ==');
{
  const xp5 = MASTERY_XP.pistol[MASTERY_MAX - 1] as number;
  const caps = [0, 1, 2, 3, 4, 5].map((lv) => bonusesOf({ ...newMeta(), mastery: { pistol: lv ? (MASTERY_XP.pistol[lv - 1] as number) : 0 } }).tierCap.pistol);
  check(caps.join() === '5,5,6,6,7,8', `手枪熟练度 0–5 级 → 局内等级上限 ${caps.join(' / ')}`);
  const [m1] = settleRun(newMeta(), { difficulty: 'normal', nights: 3, won: false, kills: 120, headshotKills: 20, weaponKills: { pistol: 80, smg: 0 }, weaponHeads: { pistol: 20 } });
  check(m1.mastery.pistol === 100 && !m1.mastery.smg, `一局手枪击杀 80、爆头 20 → 手枪经验 +100（${m1.mastery.pistol}）`);
  check(masteryOf(m1, 'pistol') === 1, `100 经验 = 手枪熟练度 1 级（门槛 ${MASTERY_XP.pistol[0]} / ${MASTERY_XP.pistol[1]}）`);
  // 武器台每条线：熟练度 1 / 3 / 5 级各开一级
  let b: MetaState = { ...newMeta(), supplies: 9999 };
  check(canBench(b, 'pistol', 'damage') === 'mastery', '熟练度 0：手枪武器台一级都买不了');
  b = { ...b, mastery: { pistol: MASTERY_XP.pistol[0] as number } };
  b = buyBench(b, 'pistol', 'damage') as MetaState;
  check(!!b && canBench(b, 'pistol', 'damage') === 'mastery', '熟练度 1：只能买到 1 级');
  b = { ...b, mastery: { pistol: xp5 } };
  b = buyBench(b, 'pistol', 'damage') as MetaState;
  b = buyBench(b, 'pistol', 'damage') as MetaState;
  check(!!b && canBench(b, 'pistol', 'damage') === 'maxed', '精通：3 级全开');
  check(canBuy({ ...newMeta(), medals: 999, mastery: { pistol: MASTERY_XP.pistol[2] as number } }, 'dual') === 'ok' && canBuy({ ...newMeta(), medals: 999, mastery: { pistol: MASTERY_XP.pistol[1] as number } }, 'dual') === 'mastery', '手枪双持要熟练度 3 级');
}

console.log('\n== 军衔 ==');
{
  const r1st = (RANKS[1] as { earned: number }).earned;
  check(rankOf(0) === 0 && rankOf(r1st - 1) === 0 && rankOf(r1st) === 1 && rankOf(1e6) === RANKS.length - 1, `累计勋章 0 / ${r1st - 1} / ${r1st} / 很多 对应列兵 / 列兵 / 下士 / 最高军衔`);
  const rich: MetaState = { ...newMeta(), medals: 9000, medalsEarned: 0 };
  check(canBuy(rich, 'turret-cap') === 'rank' && canBuy(rich, 'reroll') === 'rank', '列兵勋章再多也买不了炮塔上限、重抽');
  check(canBuy(rich, 'start-scrap') === 'ok' && canBuy(rich, 'max-hp') === 'ok', '列兵能买开局零件、最大生命的第一级');
  const [b1] = buyMeta(rich, 'start-scrap');
  check(canBuy(b1, 'start-scrap') === 'rank', '开局零件第二级要下士');
  // 全部军衔、全部勋章、全部精通：能按前置顺序把整张表买满（没有死锁）
  let all: MetaState = { ...newMeta(), medals: 1e6, medalsEarned: 1e6, mastery: masteredAll() };
  for (let pass = 0; pass < 10; pass++) for (const it of META_ITEMS) while (canBuy(all, it.id) === 'ok') [all] = buyMeta(all, it.id);
  check(META_ITEMS.every((it) => canBuy(all, it.id) === 'maxed'), '军衔到顶、全部精通时整张表都能按前置买满（没有死锁的前置）');
  const mono = META_ITEMS.every((it) => it.prices.every((_, i) => i === 0 || rankFor(it, i) >= rankFor(it, i - 1)) && (it.ranks ?? []).length <= it.prices.length);
  check(mono, '每个项目的军衔要求逐级不降，长度不超过级数');
  const pre = META_ITEMS.every((it) => !it.requires || rankFor(it, 0) >= rankFor(META_BY_ID[it.requires.id] as typeof it, 0));
  check(pre, '有前置的项目，军衔要求不低于前置');
}

console.log('\n== 版本更新不清进度（旧档宽松读取）==');
{
  check(!('resetOnUpdate' in storeModule), '没有「版本更新重置进度」这个函数了：更新游戏不会清玩家数据');
  // 一份"别的版本留下的"存档：有现在已经没有的项目、超过现在上限的级数、认不出的难度和武器
  const old = JSON.parse(JSON.stringify(defaultSave())) as { runs: number; totalKills: number; volume: number; meta: Record<string, unknown> };
  old.runs = 31;
  old.totalKills = 4800;
  old.volume = 0.3;
  old.meta.medals = 800;
  old.meta.medalsEarned = 2400;
  old.meta.levels = { 'unlock-smg': 1, 'unlock-shotgun': 1, sidearm: 1, 'turret-cap': 99, 'item-from-the-future': 2, 'max-hp': 'many' };
  old.meta.cleared = ['normal', 'easy'];
  old.meta.lastDifficulty = 'impossible';
  old.meta.lastSidearm = 'smg';
  const st = new MemoryStorage();
  st.set(SAVE_KEY, JSON.stringify(old));
  const r = loadSave(st);
  const m = r.save.meta;
  check(r.warning === '' && r.save.runs === 31 && r.save.totalKills === 4800 && r.save.volume === 0.3, '统计和设置原样保留，不报「存档损坏」');
  check(m.medals === 800 && m.medalsEarned === 2400, '勋章原样保留');
  check(m.levels['unlock-smg'] === 1 && m.levels['unlock-shotgun'] === 1 && m.levels.sidearm === 1, '已经买的解锁（含随身武器）原样保留');
  check(m.levels['turret-cap'] === 5, '级数超过现在的上限：按上限算，不丢档');
  check(!('item-from-the-future' in m.levels) && !('max-hp' in m.levels), '认不出的项目、坏掉的级数：只忽略这一项');
  check(m.cleared.join() === 'normal' && m.lastDifficulty === 'normal', '认不出的难度：忽略，回到默认');
  check(m.lastSidearm === 'smg', '上次选的随身武器保留');

  // 没有 lastSidearm 字段的存档（升级上来的旧档）：按没选过处理
  const noSide = JSON.parse(JSON.stringify(defaultSave())) as Record<string, unknown> & { meta: Record<string, unknown> };
  delete noSide.meta.lastSidearm;
  const st2 = new MemoryStorage();
  st2.set(SAVE_KEY, JSON.stringify(noSide));
  check(loadSave(st2).warning === '' && loadSave(st2).save.meta.lastSidearm === null, '没有 lastSidearm 字段的旧存档：照样能读，按没选处理');
  noSide.meta.lastSidearm = 'railgun';
  st2.set(SAVE_KEY, JSON.stringify(noSide));
  check(loadSave(st2).warning === '' && loadSave(st2).save.meta.lastSidearm === null, '认不出的武器名：忽略');
}

console.log('\n== 开局应用加成 ==');
{
  const m: MetaState = { ...newMeta(), levels: { 'start-scrap': 2, 'max-hp': 3, 'core-hp': 1, 'struct-hp': 1, 'unlock-rifle': 1 } };
  const g = new Game(5);
  applyMeta(g, bonusesOf(m), { difficulty: 'hard' });
  startRun(g);
  check(g.scrap === 120 + 80, `开局零件 +80（${g.scrap}）`);
  check(g.player.maxHp === 130 && g.player.hp === 130, `最大生命 +30（${g.player.maxHp}）`);
  check(g.core.maxHp === 550, `发电机生命 +50（${g.core.maxHp}）`);
  check(g.config.zombieHp === 1.3 && g.config.zombieCount === 1.15, '困难：僵尸生命 ×1.3、数量 ×1.15');

  // 开局手里是手枪；解锁了步枪也只是能在工坊里买
  check(g.player.weapon === 'pistol' && g.player.tier === 0, '开局手里是手枪');
  g.scrap = 9999;
  check(g.buyWeapon('rifle') && g.loadout.rifle.owned, '解锁了的步枪能在工坊里买');
  for (let i = 0; i < 9; i++) g.upgradeWeapon('rifle');
  check(g.loadout.rifle.tier === 5, `步枪能升到它自己的上限 5 级（${g.loadout.rifle.tier}）`);

  // 第一个白天的自动存档在 startRun 里就存了：读档继续时状态还在
  const gs = new Game(5);
  applyMeta(gs, bonusesOf({ ...newMeta(), levels: { 'unlock-smg': 1 } }), { difficulty: 'normal' });
  startRun(gs);
  const gr = new Game(5);
  check(loadCheckpoint(gr, JSON.stringify(serialize(gs, 0))) === null && gr.loadout.pistol.owned, '读第 1 天的检查点继续：状态正常');

  // 存档之后在大厅解锁了步枪、买了冲锋枪上限：继续这一局时要生效
  const later = bonusesOf({ ...newMeta(), levels: { 'unlock-smg': 1, 'unlock-rifle': 1, 'unlock-hmg': 1 }, mastery: { smg: MASTERY_XP.smg[3] as number } });
  widenMeta(gr, later);
  gr.scrap = 9999;
  check(gr.buyWeapon('smg'), '读档继续后，大厅里新解锁的冲锋枪工坊里能买');
  for (let i = 0; i < 9; i++) gr.upgradeWeapon('smg');
  check(gr.loadout.smg.tier === 7, `读档继续后，新买的冲锋枪上限生效（${gr.loadout.smg.tier}）`);
  check(gr.buyWeapon('rifle'), '读档继续后，大厅里新解锁的突击步枪工坊里能买');
  // 身上已经有手枪 + 冲锋枪，再买步枪：手里那把（手枪）放回工坊，等级保留
  check(gr.carried().join() === 'smg,rifle' && gr.player.weapon === 'rifle' && gr.loadout.pistol.owned && !gr.loadout.pistol.carried, `最多带两把：买步枪时手里的手枪放回工坊（${gr.carried().join()}）`);
  gr.input.cycle = 1;
  gr.update(STEP);
  check(gr.player.weapon === 'smg', '滚轮切到另一把');
  gr.input.select = 4;
  gr.update(STEP);
  check(gr.player.weapon === 'rifle', '数字键就是工坊里的编号：4 = 突击步枪');
  gr.input.select = 2;
  gr.update(STEP);
  check(gr.player.weapon === 'smg', '数字键就是工坊里的编号：2 = 冲锋枪');
  // 放回工坊的手枪：不用再买，取出来免费、等级还在，手里的冲锋枪放回去
  const sc = gr.scrap;
  check(gr.buyState('pistol') === 'owned' && !gr.buyWeapon('pistol'), '放回工坊的枪不用（也不能）再买一遍');
  gr.takeWeapon('pistol');
  check(gr.player.weapon === 'pistol' && gr.scrap === sc && gr.carried().join() === 'pistol,rifle' && gr.loadout.smg.owned && !gr.loadout.smg.carried && gr.loadout.smg.tier === 7, `取出手枪：免费、冲锋枪放回工坊、7 级还在（${gr.carried().join()}）`);
  const gr2 = new Game(5);
  check(loadCheckpoint(gr2, JSON.stringify(serialize(gr, 0))) === null && gr2.carried().join() === 'pistol,rifle' && gr2.loadout.smg.owned && !gr2.loadout.smg.carried, '存档读档后：身上的和工坊里的枪都对');
  gr.takeWeapon('rifle');
  check(gr.config.structures.includes('hmg') && gr.player.maxHp === 100, '新解锁的炮塔也能用；生命这类开局加成不重复叠加');

  // 双持：买了才生效
  const bs = bonusesOf({ ...newMeta(), levels: { dual: 1 } });
  check(bs.dual && !baseBonuses().dual, '双持：买了才有');
  const gp = new Game(5);
  applyMeta(gp, bs, { difficulty: 'normal' });
  check(gp.config.dual, '双持：开局规则里生效');

  const g0 = new Game(5);
  applyMeta(g0, baseBonuses(), { difficulty: 'normal' });
  check(!g0.loadout.rifle.owned, '开局不白送武器');
  g0.scrap = 9999;
  check(!g0.buyWeapon('shotgun'), '没解锁的霰弹枪工坊里买不了');
  check(!g0.buyWeapon('smg'), '冲锋枪要先在大厅解锁，工坊里才能买');
  const gU = new Game(5);
  applyMeta(gU, bonusesOf({ ...newMeta(), levels: { 'unlock-smg': 1 } }), { difficulty: 'normal', ammo: { smg: 500 } });
  gU.scrap = 9999;
  check(gU.buyWeapon('smg') && gU.loadout.smg.mag === 36 && gU.reserveOf('smg') === Infinity, '解锁后能买，弹匣装满（目前子弹无限）');
  for (let i = 0; i < 9; i++) gU.upgradeWeapon('smg');
  check(gU.loadout.smg.tier === 5, `没买等级上限时最多升到 5 级（${gU.loadout.smg.tier}）`);
  g0.buildKind = 'hmg';
  check(!tryPlace(g0, 40, 30), '没解锁的重机枪塔建不了');

  // 炮塔数量上限
  const g1 = new Game(5);
  applyMeta(g1, baseBonuses(), { difficulty: 'normal' });
  g1.scrap = 9999;
  g1.buildKind = 'turret';
  const spots: Array<[number, number]> = [[38, 36], [42, 36], [38, 42], [42, 42]];
  let placed = 0;
  for (const [cx, cy] of spots) {
    g1.player.x = cx - 40 + 0.5;
    g1.player.z = cy - 40 + 3;
    if (tryPlace(g1, cx, cy)) placed++;
  }
  check(placed === 3 && g1.turretCount() === 3, `炮塔上限 3 生效（建成 ${placed} 座）`);
  g1.buildKind = 'barricade';
  g1.player.x = 0.5;
  g1.player.z = 4;
  check(tryPlace(g1, 40, 45) || tryPlace(g1, 41, 45), '炮塔满了以后路障照样能建');

  // 训练场
  const gt = new Game(5);
  applyTraining(gt, bonusesOf({ ...newMeta(), levels: { 'unlock-lmg': 1 }, mastery: { lmg: MASTERY_XP.lmg[3] as number } }));
  check(gt.loadout.lmg.owned && gt.loadout.lmg.tier === 7 && gt.loadout.pistol.tier === 5 && !gt.loadout.shotgun.owned, '训练场：已解锁的武器按当前上限给满（轻机枪 7 级、手枪 5 级），没解锁的没有');
  const tr = new Training(gt);
  tr.start();
  const n0 = gt.zombies.length;
  const z0 = gt.zombies[0];
  const x0 = z0?.x ?? 0;
  for (let i = 0; i < 120; i++) {
    gt.update(STEP);
    tr.update(STEP);
  }
  check(n0 >= 6 && gt.zombies.length === n0 && Math.abs((z0?.x ?? 0) - x0) < 1e-6, `训练场摆出 ${n0} 个靶子，不会动，也不刷新的怪`);
  if (z0) gt.damageZombie(z0, 1e6);
  for (let i = 0; i < 60; i++) {
    gt.update(STEP);
    tr.update(STEP);
  }
  check(gt.zombies.length === n0 - 1, '打死的靶子 1 秒后还没复活');
  for (let i = 0; i < 70; i++) {
    gt.update(STEP);
    tr.update(STEP);
  }
  check(gt.zombies.length === n0, '打死 2 秒后原地复活');
  check(gt.run.phase === 'training' && gt.stats.kills === 1, '训练场不进入白天 / 夜晚流程');
}

console.log('\n== 随身武器 ==');
{
  const item = META_BY_ID['sidearm'];
  const price = item?.prices[0] ?? 0;
  check(!!item && item.section === 'armory' && item.prices.length === 1, '军械库里有「随身武器」，只有一级');
  check(item?.requires?.id === 'unlock-shotgun' && item.requires.level === 1, '前置：要先解锁霰弹枪');
  check(price > (META_BY_ID['unlock-shotgun']?.prices[0] ?? 0) && price < (META_BY_ID['unlock-rifle']?.prices[0] ?? 0), `价格 ${price} 勋章：比解锁霰弹枪贵、比解锁突击步枪便宜，攒一阵子才买得起`);
  check(!baseBonuses().sidearm, '默认没有随身武器');

  const rich: MetaState = { ...newMeta(), medals: 5000, medalsEarned: 10000 };
  check(canBuy(rich, 'sidearm') === 'requires', '没解锁霰弹枪：勋章再多也买不了');
  const withSg: MetaState = { ...rich, levels: { 'unlock-smg': 1, 'unlock-shotgun': 1 } };
  check(canBuy(withSg, 'sidearm') === 'ok', '解锁了霰弹枪：能买');
  check(canBuy({ ...withSg, medals: price - 1 }, 'sidearm') === 'medals', '勋章不够：买不了');
  const [bought, res] = buyMeta(withSg, 'sidearm');
  check(res === 'ok' && bought.medals === withSg.medals - price && bonusesOf(bought).sidearm, `买下扣 ${price} 勋章，加成立刻生效`);

  // 哪些枪能当随身武器带
  const b = bonusesOf(bought);
  check(sidearmOk(b, 'smg') && sidearmOk(b, 'shotgun') && !sidearmOk(b, 'pistol') && !sidearmOk(b, 'rifle') && !sidearmOk(b, 'bogus') && !sidearmOk(b, null), '解锁过的冲锋枪、霰弹枪能带；手枪、没解锁的、不认识的都不能带');
  check(!sidearmOk(bonusesOf(withSg), 'smg'), '没买「随身武器」时什么枪都不能带');

  // 开局
  const g = new Game(5);
  applyMeta(g, b, { difficulty: 'normal', sidearm: 'shotgun' });
  startRun(g);
  check(g.loadout.shotgun.owned && g.loadout.shotgun.carried && g.player.weapon === 'shotgun' && g.player.tier === 0, '开局手里拿的就是随身武器');
  check(g.loadout.shotgun.mag === g.statsOf('shotgun', 0).mag, '弹匣是满的');
  g.scrap = 9999;
  const sc = g.scrap;
  check(!g.buyWeapon('shotgun') && g.scrap === sc, '随身带的枪不能在工坊里再买一次（不扣零件）');
  for (let i = 0; i < 9; i++) g.upgradeWeapon('shotgun');
  check(g.loadout.shotgun.tier === 5 && g.player.tier === 5, `随身武器能升到它自己的上限 5 级（${g.loadout.shotgun.tier}）`);

  // 第一个白天的自动存档在 startRun 里就存了：读档继续时手里还是随身武器
  const gs = new Game(5);
  applyMeta(gs, b, { difficulty: 'normal', sidearm: 'smg' });
  startRun(gs);
  const gr = new Game(5);
  check(loadCheckpoint(gr, JSON.stringify(serialize(gs, 0))) === null && gr.player.weapon === 'smg' && gr.loadout.smg.owned, '带冲锋枪出征，读第 1 天的检查点继续：手里还是冲锋枪');

  // 没买 / 手枪 / 没解锁：什么都不变
  const g0 = new Game(5);
  applyMeta(g0, bonusesOf(withSg), { difficulty: 'normal', sidearm: 'smg' });
  check(!g0.loadout.smg.owned && g0.player.weapon === 'pistol', '没买「随身武器」时选了也带不上');
  const gp = new Game(5);
  applyMeta(gp, b, { difficulty: 'normal', sidearm: 'pistol' });
  check(gp.player.weapon === 'pistol' && gp.loadout.pistol.owned, '选手枪当随身武器时什么都不变');
  const gu = new Game(5);
  applyMeta(gu, b, { difficulty: 'normal', sidearm: 'rifle' });
  check(!gu.loadout.rifle.owned, '没解锁的突击步枪带不上');
}

console.log('\n== 卡牌重抽 / 四选一 ==');
{
  const g = new Game(9);
  applyMeta(g, bonusesOf({ ...newMeta(), levels: { reroll: 1, 'four-cards': 1 } }), { difficulty: 'normal' });
  g.invulnerableCore = true;
  g.invulnerablePlayer = true;
  startRun(g);
  skipDay(g);
  for (const z of g.zombies) g.damageZombie(z, 1e6);
  for (let t = 0; t < 60 * 120 && g.run.phase !== 'cards'; t++) {
    g.update(STEP);
    for (const z of g.zombies) g.damageZombie(z, 1e6);
  }
  check(g.run.phase === 'cards' && g.run.cardChoices.length === 4, `四选一：黎明给 ${g.run.cardChoices.length} 张`);
  const first = g.run.cardChoices.join();
  check(rerollCards(g) && g.run.cardChoices.length === 4, '可以重抽一次');
  check(!rerollCards(g), '同一个黎明不能重抽第二次');
  void first;
}

// ---------------------------------------------------------------- 检查点

/** 一个确定性的简单机器人：每帧的输入只由游戏状态决定 */
function drive(g: Game): void {
  const inp = g.input;
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
  inp.moveX = 0;
  inp.moveZ = 0;
  inp.fire = false;
  inp.sprint = false;
  if (best) {
    inp.aimX = best.x;
    inp.aimZ = best.z;
    inp.aimPitch = Math.atan2(1.2 - g.player.eye, Math.max(0.5, bd));
    inp.fire = bd < 16;
    if (bd < 3) {
      inp.moveX = (g.player.x - best.x) / bd;
      inp.moveZ = (g.player.z - best.z) / bd;
    }
  }
  if (g.run.phase === 'cards') chooseCard(g, g.run.cardChoices[0] as string);
}

function freshGame(): Game {
  const g = new Game(77);
  g.invulnerableCore = true;
  return g;
}

/** 两局的完整状态对比（去掉保存时间） */
const snap = (g: Game): string => JSON.stringify({ ...serialize(g), savedAt: 0 });

console.log('\n== 检查点：确定性 ==');
{
  const g = freshGame();
  applyMeta(g, bonusesOf({ ...newMeta(), levels: { 'unlock-hmg': 1, 'unlock-mortar': 1, 'turret-cap': 2 } }), { difficulty: 'hard' });
  startRun(g);
  g.scrap += 2000;
  const build: Array<[typeof g.buildKind, number, number]> = [['turret', 38, 36], ['hmg', 42, 36], ['mortar', 38, 42], ['barricade', 40, 45], ['spikes', 40, 34]];
  for (const [k, cx, cy] of build) {
    g.buildKind = k;
    g.player.x = cx - 40 + 0.5;
    g.player.z = cy - 40 + 3;
    tryPlace(g, cx, cy);
  }
  g.player.x = 0.5;
  g.player.z = 4;
  check(g.structures.size === 5, `布置了 5 座建筑（${g.structures.size}）`);

  // 打完第 1 夜，到第 2 天开头存一次档（正式游戏也是在这里自动存档）
  skipDay(g);
  let t = 0;
  for (; t < 60 * 300 && !(g.run.phase === 'day' && g.run.night === 2); t++) {
    drive(g);
    g.update(STEP);
  }
  check(g.run.phase === 'day' && g.run.night === 2, '打完第 1 夜进入第 2 天');
  const raw = JSON.stringify(serialize(g, 123));
  const h = freshGame();
  const why = loadCheckpoint(h, raw);
  check(why === null, `检查点读回成功${why ? `（${why}）` : ''}`);
  check(snap(h) === snap(g), '读回后的状态和存档时逐字段相等');

  // 两边一起往下模拟：白天 10 秒 + 第 2 夜 60 秒
  const run = (x: Game) => {
    for (let i = 0; i < 600; i++) {
      drive(x);
      x.update(STEP);
    }
    skipDay(x);
    for (let i = 0; i < 3600; i++) {
      drive(x);
      x.update(STEP);
    }
  };
  run(g);
  run(h);
  check(snap(h) === snap(g), `继续模拟 70 秒后两边完全一致（击杀 ${g.stats.kills} / ${h.stats.kills}，僵尸 ${g.zombies.length} / ${h.zombies.length}）`);

  // 夜里存档也能接上（正式游戏不在夜里存，但序列化本身要完整）
  const raw2 = JSON.stringify(serialize(g));
  const k = freshGame();
  check(loadCheckpoint(k, raw2) === null, '夜里的状态也能读回');
  for (let i = 0; i < 1800; i++) {
    for (const x of [g, k]) {
      drive(x);
      x.update(STEP);
    }
  }
  check(snap(k) === snap(g), `夜里存档、继续 30 秒后完全一致（场上 ${g.zombies.length} 只、子弹 ${g.bullets.length} 颗）`);
}

console.log('\n== 检查点：坏档 ==');
{
  const g = freshGame();
  startRun(g);
  g.scrap += 500;
  g.buildKind = 'barricade';
  g.player.x = 0.5;
  g.player.z = 4;
  tryPlace(g, 40, 45);
  const base = serialize(g);
  const mut = (f: (o: Record<string, any>) => void): string => {
    const o = JSON.parse(JSON.stringify(base)) as Record<string, any>;
    f(o);
    return JSON.stringify(o);
  };
  // 找一格墙
  let wall = [0, 0];
  for (let i = 0; i < g.grid.count; i++) if (g.grid.solid[i]) {
    wall = [i % g.grid.w, Math.floor(i / g.grid.w)];
    break;
  }
  const cases: Array<[string, string | null]> = [
    ['没有存档', null],
    ['JSON 坏了', '{"version":1,"rng":'],
    ['版本号不对', mut((o) => (o.version = 3))],
    ['字段缺失', mut((o) => delete o.player)],
    ['数值越界：生命超过上限', mut((o) => (o.player.hp = 99999))],
    ['数值越界：夜数', mut((o) => (o.run.night = 42))],
    ['类型不对', mut((o) => (o.scrap = 'lots'))],
    ['枚举不对：武器', mut((o) => (o.player.weapon = 'railgun'))],
    ['建筑落在墙里', mut((o) => ((o.structures[0].cx = wall[0]), (o.structures[0].cy = wall[1])))],
    ['两座建筑叠在一格', mut((o) => o.structures.push({ ...o.structures[0], id: 1 }))],
    ['未知卡牌', mut((o) => (o.cardCounts.godmode = 1))],
    ['阶段不能存档', mut((o) => (o.run.phase = 'lost'))],
  ];
  let rejected = 0;
  for (const [name, raw] of cases) {
    const fresh = freshGame();
    try {
      const why = loadCheckpoint(fresh, raw);
      if (why && fresh.structures.size === 0 && fresh.run.phase === 'menu') rejected++;
      else console.log(`     ${name}: 没有被拒绝`);
    } catch (e) {
      console.log(`     ${name}: 抛了异常 ${String(e)}`);
    }
  }
  check(rejected === cases.length, `${cases.length} 种坏检查点都被拒绝、不抛异常、不改动游戏（${rejected}）`);
  // 正常的检查点能通过（防止校验写得太严）
  const ok = freshGame();
  check(loadCheckpoint(ok, JSON.stringify(base)) === null && ok.structures.size === 1, '正常的检查点能通过校验');
  void parseCheckpoint;
  void applyCheckpoint;
  void RUN_KEY;
  void CARD_BY_ID;
}

console.log('\n== 价格总表 ==');
{
  const bySection: Record<string, number> = {};
  for (const it of META_ITEMS) bySection[SECTION_NAME[it.section]] = (bySection[SECTION_NAME[it.section]] ?? 0) + it.prices.reduce((a, b) => a + b, 0);
  const total = totalMetaCost();
  console.log(`     ${Object.entries(bySection).map(([k, v]) => `${k} ${v}`).join('，')}；合计 ${total} 勋章`);
  // 普通玩家：局外成长让人越打越远，按一轮 6 局「死在第 2 / 4 / 5 / 6 / 7 夜之后 + 通关 1 次」估算（普通难度，每夜约 35 击杀、10% 爆头）
  const casualRuns6 = [2, 4, 5, 6, 7, 10].map((n) => medalsFor({ difficulty: 'normal', nights: n, won: n === 10, kills: n * 35, headshotKills: n * 3 }).total);
  const casual = casualRuns6.reduce((a, b) => a + b, 0) / casualRuns6.length;
  // 熟练玩家：普通通关两三次后转困难，以困难通关为主
  const skilled = (medalsFor({ difficulty: 'normal', nights: 10, won: true, kills: 700, headshotKills: 150 }).total + 3 * medalsFor({ difficulty: 'hard', nights: 10, won: true, kills: 800, headshotKills: 200 }).total) / 4;
  const casualRuns = total / casual;
  const skilledRuns = total / skilled;
  console.log(`     普通玩家每局约 ${casual.toFixed(0)}，约 ${casualRuns.toFixed(0)} 局买满；熟练玩家每局约 ${skilled.toFixed(0)}，约 ${skilledRuns.toFixed(1)} 局买满`);
  check(casualRuns >= 65 && casualRuns <= 100 && skilledRuns >= 16 && skilledRuns <= 26, '买满所需局数在目标范围内（普通八十局左右、熟练二十局左右）');
  // 军衔：普通玩家第一把（死在第 2 夜，22 勋章）后还是列兵，打到第 5 夜左右的三四局后到下士；最高军衔要接近买满
  const firstRun = medalsFor({ difficulty: 'normal', nights: 2, won: false, kills: 60, headshotKills: 5 }).total;
  check(rankOf(firstRun) === 0, `第一局（${firstRun} 勋章）后还是列兵`);
  const top = (RANKS[RANKS.length - 1] as { earned: number }).earned;
  check(top >= total * 0.85 && top <= total * 1.1, `最高军衔（${top}）接近买满所需（${total}）`);
  const runsTo = (r: number) => Math.ceil((RANKS[r] as { earned: number }).earned / casual);
  console.log(`     普通玩家晋升：${RANKS.map((r, i) => `${r.name} ${runsTo(i)} 局`).join('，')}`);
}

console.log('');
if (failures.length) {
  console.log(`未通过 ${failures.length} 项：`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('全部通过');
