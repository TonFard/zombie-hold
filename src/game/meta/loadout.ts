import { NO_META, type RunConfig } from '../config';
import { DIFFICULTIES, type Difficulty } from '../data/difficulty';
import { baseBonuses, type MetaBonuses } from '../data/meta-catalog';
import type { Daily } from './achievements';
import { STRUCTURE_ORDER } from '../data/structures';
import { MAX_TIER, WEAPON_ORDER, statsAt, type WeaponKind } from '../data/weapons';
import type { Game } from '../sim';

/** 出征时的选择 */
export interface Deploy {
  difficulty: Difficulty;
  /** 随身武器：需要买了「随身武器」并且这把枪已解锁 */
  sidearm: WeaponKind | null;
}

/** 按局外加成和难度生成这一局的规则 */
export function configFor(b: MetaBonuses, d: Difficulty): RunConfig {
  const def = DIFFICULTIES[d];
  return {
    difficulty: d,
    zombieHp: def.hp,
    zombieCount: def.count,
    zombieDamage: def.damage,
    tierCap: { ...b.tierCap },
    weapons: WEAPON_ORDER.filter((k) => b.weapons.has(k)),
    structures: STRUCTURE_ORDER.filter((k) => b.structures.has(k)),
    turretCap: b.turretCap,
    rerolls: b.rerolls,
    cardChoices: b.cardChoices,
    training: false,
    extras: true,
    endless: true,
    fixedMod: '',
    daily: '',
    meta: { ...NO_META },
  };
}

/**
 * 开局应用局外加成：在 new Game() 之后、startRun() 之前调用。
 * 开局零件在这里加，startRun 再加上固定的 START_SCRAP。
 */
export function applyMeta(g: Game, b: MetaBonuses, dep: Deploy): void {
  g.config = configFor(b, dep.difficulty);
  g.mods.turret *= b.turretDamage;
  g.mods.structHp *= b.structHp;
  g.mods.scrap *= b.scrapGain;
  g.mods.armor *= b.armor;
  g.mods.regen += b.regen;
  g.mods.speed *= b.speed;
  g.mods.fireRate *= b.fireRate;
  g.player.maxHp += b.maxHp;
  g.player.hp = g.player.maxHp;
  g.core.maxHp += b.coreHp;
  g.core.hp = g.core.maxHp;
  g.scrap += b.startScrap;
  g.scrapEarned += b.startScrap;
  g.config.meta = { maxHp: b.maxHp, coreHp: b.coreHp, structHp: b.structHp, turretDamage: b.turretDamage, scrapGain: b.scrapGain, armor: b.armor, regen: b.regen, speed: b.speed, fireRate: b.fireRate };
  const side = dep.sidearm;
  if (sidearmOk(b, side)) {
    const slot = g.loadout[side];
    slot.owned = true;
    slot.tier = 0;
    slot.mag = statsAt(side, 0).mag;
    // 直接拿在手上：startRun 里第一个白天就会存检查点，要在那之前换好，读档继续时手里才是随身武器
    g.player.weapon = side;
    g.player.tier = 0;
  }
}

/**
 * 读档继续时补上存档之后在大厅新买的东西：检查点里的规则和数值是开局时冻结的，
 * 不补的话大厅里刚解锁的武器在工坊里仍然显示「未解锁」、刚买的生命 / 建筑生命 / 炮塔伤害也不生效。
 * 解锁和上限只放宽（取并集 / 取大）；数值加成按 config.meta 里记的"已经吃到多少"补差额，不会重复叠加。
 * 开局零件是一次性的，不补
 */
export function widenMeta(g: Game, b: MetaBonuses): void {
  const c = g.config;
  if (c.training || c.daily) return;
  c.weapons = WEAPON_ORDER.filter((k) => c.weapons.includes(k) || b.weapons.has(k));
  c.structures = STRUCTURE_ORDER.filter((k) => c.structures.includes(k) || b.structures.has(k));
  for (const k of WEAPON_ORDER) c.tierCap[k] = Math.max(c.tierCap[k], b.tierCap[k]);
  c.turretCap = Math.max(c.turretCap, b.turretCap);
  c.rerolls = Math.max(c.rerolls, b.rerolls);
  c.cardChoices = Math.max(c.cardChoices, b.cardChoices);
  const m = c.meta;
  const dHp = b.maxHp - m.maxHp;
  if (dHp > 0) {
    g.player.maxHp += dHp;
    g.player.hp += dHp;
    m.maxHp = b.maxHp;
  }
  const dCore = b.coreHp - m.coreHp;
  if (dCore > 0) {
    g.core.maxHp += dCore;
    g.core.hp += dCore;
    m.coreHp = b.coreHp;
  }
  if (b.structHp > m.structHp) {
    const k = b.structHp / m.structHp;
    g.mods.structHp *= k;
    // 已经建好的建筑按比例加生命
    for (const s of g.structures.values()) {
      s.maxHp = Math.round(s.maxHp * k);
      s.hp = Math.round(s.hp * k);
    }
    m.structHp = b.structHp;
  }
  if (b.turretDamage > m.turretDamage) {
    g.mods.turret *= b.turretDamage / m.turretDamage;
    m.turretDamage = b.turretDamage;
  }
  if (b.scrapGain > m.scrapGain) {
    g.mods.scrap *= b.scrapGain / m.scrapGain;
    m.scrapGain = b.scrapGain;
  }
  if (b.armor < m.armor) {
    g.mods.armor *= b.armor / m.armor;
    m.armor = b.armor;
  }
  if (b.regen > m.regen) {
    g.mods.regen += b.regen - m.regen;
    m.regen = b.regen;
  }
  if (b.speed > m.speed) {
    g.mods.speed *= b.speed / m.speed;
    m.speed = b.speed;
  }
  if (b.fireRate > m.fireRate) {
    g.mods.fireRate *= b.fireRate / m.fireRate;
    m.fireRate = b.fireRate;
  }
}

/** 这把武器能不能当随身武器带：买了「随身武器」、已解锁、不是手枪（手枪本来就有） */
export function sidearmOk(b: MetaBonuses, k: string | null): k is WeaponKind {
  return !!k && b.sidearm && k !== 'pistol' && b.weapons.has(k as WeaponKind);
}

/** 训练场：所有已解锁的武器按当前等级上限给满，炮塔不限 */
export function applyTraining(g: Game, b: MetaBonuses): void {
  g.config = { ...configFor(b, 'normal'), training: true };
  for (const k of WEAPON_ORDER) {
    if (!b.weapons.has(k)) continue;
    const slot = g.loadout[k];
    slot.owned = true;
    slot.tier = Math.min(MAX_TIER, b.tierCap[k]);
    slot.mag = statsAt(k, slot.tier).mag;
  }
  g.player.tier = g.loadout[g.player.weapon].tier;
}

/**
 * 每日挑战：不吃局外加成（大家条件一样），固定种子 + 每夜固定词缀 + 只能用一把武器。
 * 只在本地记录成绩，不结算勋章
 */
export function applyDaily(g: Game, d: Daily): void {
  const base = configFor(baseBonuses(), 'normal');
  g.config = { ...base, weapons: [d.weapon], endless: false, fixedMod: d.mod, daily: d.key, turretCap: 4 };
  if (d.weapon !== 'pistol') {
    const slot = g.loadout[d.weapon];
    slot.owned = true;
    slot.tier = 0;
    slot.mag = statsAt(d.weapon, 0).mag;
    g.loadout.pistol.owned = false;
    g.player.weapon = d.weapon;
    g.player.tier = 0;
  }
}
