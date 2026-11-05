import type { Difficulty } from './data/difficulty';
import { STRUCTURE_ORDER, type StructureKind } from './data/structures';
import { MAX_TIER, WEAPON_ORDER, noMods, type WeaponKind, type WeaponMod } from './data/weapons';
import type { MapId } from './world/maps';

/**
 * 一局的规则：难度系数和局外成长决定的上限 / 解锁。
 * 默认值是"沙盒"：什么都解锁、没有上限、系数全为 1——模拟脚本和调试用它，结果和接入局外成长之前完全一致。
 * 正式开局时由 meta/loadout.ts 按存档里的局外进度生成一份受限的配置。
 */
export interface RunConfig {
  difficulty: Difficulty;
  zombieHp: number;
  zombieCount: number;
  zombieDamage: number;
  /** 每把武器在局内能升到的最高级 */
  tierCap: Record<WeaponKind, number>;
  /** 工坊里能买的武器 */
  weapons: WeaponKind[];
  /** 能建的建筑 */
  structures: StructureKind[];
  /** 所有炮塔类型合计的数量上限 */
  turretCap: number;
  /** 每个黎明能重抽几次卡牌 */
  rerolls: number;
  /** 黎明时给几张卡牌选 */
  cardChoices: number;
  /** 训练场：靶子不会动、不结算 */
  training: boolean;
  /**
   * M12 的玩法：可射击的爆炸物、夜晚词缀、新僵尸、连杀与挑战、手雷补给。
   * 沙盒默认关（旧的 sim:* 结果保持不变），正式出征和 ?autostart 打开
   */
  extras: boolean;
  /** 通关后继续：无尽模式 */
  endless: boolean;
  /** 每日挑战：每夜固定的词缀（空串 = 随机）；不结算勋章以外的局外加成 */
  fixedMod: string;
  daily: string;
  /**
   * 这一局已经吃到的局外数值加成（开局时记下来，读档继续时和大厅里新买的比较，只补差额）。
   * 沙盒 / 训练场 / 每日挑战都是 0 / 1（没有加成）
   */
  meta: MetaApplied;
  /** 战役章节（决定地图、僵尸构成、勋章倍率） */
  chapter: MapId;
  /** 弹药有限：手枪以外的枪要用大厅里买的子弹（沙盒 / 训练场 / 每日挑战无限） */
  ammo: boolean;
  /** 大厅工作台给每把枪的强化 */
  weaponMods: Record<WeaponKind, WeaponMod>;
  /** 双持手枪 */
  dual: boolean;
}

export interface MetaApplied {
  maxHp: number;
  coreHp: number;
  structHp: number;
  turretDamage: number;
  scrapGain: number;
  armor: number;
  regen: number;
  speed: number;
  fireRate: number;
}

export const NO_META: MetaApplied = { maxHp: 0, coreHp: 0, structHp: 1, turretDamage: 1, scrapGain: 1, armor: 1, regen: 0, speed: 1, fireRate: 1 };

export function sandboxConfig(): RunConfig {
  const tierCap = {} as Record<WeaponKind, number>;
  for (const k of WEAPON_ORDER) tierCap[k] = MAX_TIER;
  return {
    difficulty: 'normal',
    zombieHp: 1,
    zombieCount: 1,
    zombieDamage: 1,
    tierCap,
    weapons: [...WEAPON_ORDER],
    structures: [...STRUCTURE_ORDER],
    turretCap: 999,
    rerolls: 0,
    cardChoices: 3,
    training: false,
    extras: false,
    endless: false,
    fixedMod: '',
    daily: '',
    meta: { ...NO_META },
    chapter: 'outpost',
    ammo: false,
    weaponMods: noMods(),
    dual: false,
  };
}
