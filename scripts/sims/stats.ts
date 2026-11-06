// 数值后台对账：npm run sim:stats
// Tab 面板显示的"基础 × 各来源 = 最终"必须和游戏里真正用的数一致，否则面板会误导排查。
import { CARDS } from '../../src/game/data/cards';
import { DIFFICULTY_ORDER } from '../../src/game/data/difficulty';
import { MAP_ORDER } from '../../src/game/world/maps';
import { META_ITEMS } from '../../src/game/data/meta-catalog';
import { MASTERY_XP } from '../../src/game/data/mastery';
import { WEAPON_ORDER, weightOf } from '../../src/game/data/weapons';
import { applyMeta } from '../../src/game/meta/loadout';
import { bonusesOf, newMeta, type MetaState } from '../../src/game/meta/progress';
import { Game, STEP, defaultMods, type Mods } from '../../src/game/sim';
import { liveBreakdown, modsBreakdown, rebuiltMods, weaponBreakdown } from '../../src/game/stats/breakdown';
import { Rng } from '../../src/game/core/rng';
import { skipDay, startRun } from '../../src/game/systems/run';
import { tryPlace } from '../../src/game/systems/building';

const failures: string[] = [];
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures.push(msg);
};
const KEYS = Object.keys(defaultMods()) as Array<keyof Mods>;
/** 重算的 Mods 和游戏里的逐字段比较，返回对不上的字段 */
const diff = (g: Game): string[] => {
  const r = rebuiltMods(g);
  return KEYS.filter((k) => Math.abs((r[k] as number) - (g.mods[k] as number)) > 1e-9 * Math.max(1, Math.abs(g.mods[k] as number))).map((k) => `${k}: 面板 ${r[k]} / 实际 ${g.mods[k]}`);
};
/** 给游戏加一张卡（和 chooseCard 一样：apply + 计数） */
const giveCard = (g: Game, id: string) => {
  const c = CARDS.find((x) => x.id === id);
  if (!c) return;
  c.apply(g);
  g.cardCounts[id] = (g.cardCounts[id] ?? 0) + 1;
};
const fullMeta = (): MetaState => {
  const levels: Record<string, number> = {};
  for (const it of META_ITEMS) levels[it.id] = it.prices.length;
  return { ...newMeta(), levels, mastery: Object.fromEntries(WEAPON_ORDER.map((k) => [k, MASTERY_XP[k][4] as number])) };
};

console.log('\n== 没有任何加成：面板全是基础值 ==');
{
  const g = new Game(1);
  startRun(g);
  check(diff(g).length === 0 && modsBreakdown(g).every((l) => l.parts.length === 0), '沙盒开局：所有属性没有来源、等于基础值');
}

console.log('\n== 每张卡单独加：面板 = 实际 ==');
{
  const bad: string[] = [];
  for (const c of CARDS) {
    for (const n of [1, c.max]) {
      const g = new Game(2);
      startRun(g);
      for (let i = 0; i < n; i++) giveCard(g, c.id);
      const d = diff(g);
      if (d.length) bad.push(`${c.name}×${n}：${d.join('；')}`);
    }
  }
  for (const b of bad) console.log(`     ${b}`);
  check(bad.length === 0, `${CARDS.length} 张卡 × 1 层 / 满层，面板和实际一致`);
}

console.log('\n== 局外、难度、章节：面板 = 实际 ==');
{
  const bad: string[] = [];
  for (const d of DIFFICULTY_ORDER) {
    for (const ch of MAP_ORDER) {
      for (const meta of [newMeta(), fullMeta()]) {
        const g = new Game(3, ch);
        applyMeta(g, bonusesOf(meta), { difficulty: d, sidearm: null, chapter: ch });
        startRun(g);
        const x = diff(g);
        if (x.length) bad.push(`${d}/${ch}/${meta === undefined ? '' : Object.keys(meta.levels).length ? '满局外' : '无局外'}：${x.join('；')}`);
      }
    }
  }
  for (const b of bad.slice(0, 6)) console.log(`     ${b}`);
  check(bad.length === 0, `${DIFFICULTY_ORDER.length} 难度 × ${MAP_ORDER.length} 章 × 有无局外，面板和实际一致`);
  const g = new Game(3, 'city');
  applyMeta(g, bonusesOf(fullMeta()), { difficulty: 'hard', sidearm: null, chapter: 'city' });
  const sc = modsBreakdown(g).find((l) => l.id === 'scrap');
  check(!!sc && sc.parts.some((p) => p.kind === 'difficulty') && sc.parts.some((p) => p.kind === 'chapter') && sc.parts.some((p) => p.kind === 'meta'), `零件收益拆成：${sc?.parts.map((p) => `${p.name} ×${p.value.toFixed(2)}`).join('、')}`);
}

console.log('\n== 随机组合 200 次 ==');
{
  const rng = new Rng(7);
  let bad = 0;
  let example = '';
  for (let t = 0; t < 200; t++) {
    const ch = MAP_ORDER[Math.floor(rng.next() * MAP_ORDER.length)] as (typeof MAP_ORDER)[number];
    const d = DIFFICULTY_ORDER[Math.floor(rng.next() * 3)] as (typeof DIFFICULTY_ORDER)[number];
    const g = new Game(10 + t, ch);
    applyMeta(g, bonusesOf(rng.next() < 0.5 ? fullMeta() : newMeta()), { difficulty: d, sidearm: null, chapter: ch });
    startRun(g);
    const n = 1 + Math.floor(rng.next() * 12);
    for (let i = 0; i < n; i++) {
      const c = CARDS[Math.floor(rng.next() * CARDS.length)];
      if (c && (g.cardCounts[c.id] ?? 0) < c.max) giveCard(g, c.id);
    }
    const x = diff(g);
    if (x.length) {
      bad++;
      if (!example) example = `${Object.entries(g.cardCounts).map(([k, v]) => `${k}×${v}`).join(',')} → ${x.join('；')}`;
    }
  }
  if (example) console.log(`     例：${example}`);
  check(bad === 0, `200 局随机（局外 + 难度 + 章节 + 1–12 张卡）面板和实际一致（不一致 ${bad}）`);
}

console.log('\n== 武器面板 = statsOf() ==');
{
  const bad: string[] = [];
  for (const dual of [false, true]) {
    const meta = fullMeta();
    if (!dual) delete meta.levels.dual;
    meta.supplies = 1e6;
    meta.bench = Object.fromEntries(WEAPON_ORDER.flatMap((k) => ['damage', 'recoil', 'rate', 'lighter', 'mag'].map((l) => [`${k}.${l}`, 3])));
    const g = new Game(4);
    applyMeta(g, bonusesOf(meta), { difficulty: 'normal', sidearm: null, bench: meta.bench });
    startRun(g);
    giveCard(g, 'gunsmith');
    giveCard(g, 'quickhands');
    for (const k of WEAPON_ORDER) {
      for (const tier of [0, 4, 8]) {
        g.player.weapon = k;
        const st = g.statsOf(k, tier);
        const w = weaponBreakdown(g, k, tier);
        const get = (id: string) => w.find((x) => x.id === id)?.final ?? NaN;
        const want = { damage: st.damage * st.pellets * g.mods.damage, rate: st.rate * 60 * g.mods.fireRate, mag: st.mag, reload: st.reload / g.mods.reload, weight: weightOf(k, g.config.weaponMods[k], g.config.dual) };
        for (const [id, v] of Object.entries(want)) if (Math.abs(get(id) - v) > 1e-6 * Math.max(1, v)) bad.push(`${k} ${tier} 级${dual ? '（双持）' : ''} ${id}：面板 ${get(id).toFixed(3)} / 实际 ${v.toFixed(3)}`);
      }
    }
  }
  for (const b of bad.slice(0, 8)) console.log(`     ${b}`);
  check(bad.length === 0, '7 把枪 × 3 个等级 × 有无双持，伤害 / 射速 / 弹匣 / 换弹 / 重量和实际一致（含背着的枪）');
}

console.log('\n== 重量和截断 ==');
{
  const meta = fullMeta();
  const g = new Game(5);
  applyMeta(g, bonusesOf(meta), { difficulty: 'normal', sidearm: null });
  startRun(g);
  g.scrap = 1e6;
  g.buyWeapon('lmg');
  g.player.weapon = 'lmg';
  const sp = liveBreakdown(g).find((l) => l.id === 'speed');
  const w = g.weightNow();
  check(!!sp && sp.parts.some((p) => p.kind === 'weight') && Math.abs(sp.final - g.mods.speed * w.speed) < 1e-9, `扛轻机枪：移速面板 ${((sp?.final ?? 0) * 100).toFixed(1)}% = 局外 × 重量 ${(w.speed * 100).toFixed(1)}%`);
}

console.log('\n== 战斗复盘：伤害来源加起来 = 僵尸失去的总生命 ==');
{
  const g = new Game(31);
  g.config = { ...g.config, extras: true };
  g.invulnerableCore = true;
  startRun(g);
  g.scrap = 5000;
  g.buyWeapon('rifle');
  // 两座炮塔 + 一颗手雷，让伤害来自好几种来源
  g.buildKind = 'turret';
  for (const [cx, cy] of [[38, 36], [42, 42]] as Array<[number, number]>) {
    g.player.x = cx - 40 + 0.5;
    g.player.z = cy - 40 + 3;
    tryPlace(g, cx, cy);
  }
  g.player.x = 0.5;
  g.player.z = 4;
  // 记下每只僵尸受伤前的生命，出生时登记
  const lost = { v: 0 };
  const seen = new Map<number, number>();
  g.events.on('zombieSpawned', (z) => seen.set(z.id, z.hp));
  g.events.on('zombieHit', ({ zombie }) => void zombie);
  skipDay(g);
  for (let t = 0; t < 60 * 90 && g.run.phase === 'night'; t++) {
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
    g.input.fire = !!best && bd < 16;
    if (best) {
      g.input.aimX = best.x;
      g.input.aimZ = best.z;
      g.input.aimPitch = Math.atan2(1.2 - g.player.eye, Math.max(0.5, bd));
    }
    if (t === 600 && best) {
      g.input.grenade = true;
    }
    g.update(STEP);
  }
  for (const z of g.zombies) {
    const hp0 = seen.get(z.id);
    if (hp0 !== undefined) lost.v += hp0 - Math.max(0, z.alive ? z.hp : 0);
  }
  // 已经死了、被移出列表的僵尸：按出生生命全部算掉
  const alive = new Set(g.zombies.map((z) => z.id));
  for (const [id, hp0] of seen) if (!alive.has(id)) lost.v += hp0;
  const s = g.stats;
  const byWeapon = Object.values(s.weaponDamage).reduce((a, b) => a + b, 0);
  const bySrc = Object.values(s.srcDamage).reduce((a, b) => a + b, 0);
  const sum = byWeapon + bySrc;
  const err = Math.abs(sum - lost.v) / Math.max(1, lost.v);
  console.log(`     枪 ${byWeapon.toFixed(0)}（${Object.entries(s.weaponDamage).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v.toFixed(0)}`).join('、')}），其他 ${bySrc.toFixed(0)}（${Object.entries(s.srcDamage).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v.toFixed(0)}`).join('、')}），僵尸共失去 ${lost.v.toFixed(0)}`);
  check(err < 0.01, `各来源伤害之和和僵尸失去的生命相差 ${(err * 100).toFixed(2)}%（要求 < 1%）`);
  check(s.srcDamage.turret > 0 && byWeapon > 0, '炮塔和枪的伤害都记上了');
  const kills = Object.values(s.weaponKills).reduce((a, b) => a + b, 0) + Object.values(s.srcKills).reduce((a, b) => a + b, 0);
  check(kills === s.kills, `各来源击杀之和 = 总击杀（${kills} / ${s.kills}）`);
  const nl = s.nights[0];
  check(s.nights.length === 1 && !!nl && nl.night === 1 && nl.kills === s.kills && nl.coreLow <= 1, `第 1 夜的复盘记录：击杀 ${nl?.kills}、发电机最低 ${Math.round((nl?.coreLow ?? 0) * 100)}%`);
  check(Object.values(s.fireTime).some((t) => t > 0), `开火时间：${Object.entries(s.fireTime).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v.toFixed(1)} 秒`).join('、')}`);
}

console.log('');
if (failures.length) {
  console.log(`未通过 ${failures.length} 项`);
  process.exit(1);
}
console.log('全部通过');
