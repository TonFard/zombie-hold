import { ZOMBIES } from '../../game/data/zombies';

/**
 * 开放世界里的丧尸种类和数值（纯数据，不碰 three）。
 * 生命、伤害、爆头系数沿用据点模式的表（src/game/data/zombies.ts），这样和武器模块用的枪械伤害是一套；
 * 速度是这里另定的：据点模式的地图小，开放世界里玩家走 4.3 / 跑 7.0 米每秒，行尸要比走路慢、奔袭者要比走路快。
 */

/** mother = 生化模式的母体：只由 spawnAt 放，坑位里不会有（zombie-spawn.ts 的 kindFor 不出它） */
export type ZKind = 'walker' | 'runner' | 'crawler' | 'bloater' | 'armored' | 'mother';
export const ZKINDS: readonly ZKind[] = ['walker', 'runner', 'crawler', 'bloater', 'armored', 'mother'];

export interface KindSpec {
  kind: ZKind;
  hp: number;
  /** 追人、闲逛的速度（米/秒） */
  chase: number;
  roam: number;
  /** 和墙碰撞用的半径（都不超过 0.34：一米宽的门要挤得过去） */
  radius: number;
  /** 命中体积：身体圆柱的半径和高 */
  hitR: number;
  hitH: number;
  headR: number;
  /** 头的脆弱系数（1 = 吃满爆头倍率） */
  headVuln: number;
  /** 一下打多少血（实际 ±20%） */
  damage: number;
  /** 出手动作放多快（1 = 原速：前摇约 0.67 秒）、打完歇多久（秒） */
  swing: number;
  rest: number;
  /** 离玩家身体边缘多近开始出手（出手时身体再往前蹭到 0.55 米站住；出手那一刻不超过 reach + 0.12 才算打中） */
  reach: number;
  /** 转身速度（弧度/秒） */
  turn: number;
  /** 看不见玩家多久以后放弃（秒） */
  lose: number;
  /** 越重越不容易被打退、打出硬直 */
  mass: number;
  /** 眼睛的高度（看玩家用） */
  eye: number;
  /** 正面钢板：身体正面 ±arc 的伤害 × front，累计吃掉 plate × 生命以后钢板失效（只有重装有） */
  armor: { arc: number; front: number; plate: number } | null;
}

const base = (kind: Exclude<ZKind, 'mother'>): Pick<KindSpec, 'kind' | 'hp' | 'damage' | 'headVuln' | 'armor'> => {
  const d = ZOMBIES[kind];
  return { kind, hp: d.hp, damage: d.damage, headVuln: d.headVuln, armor: d.armor ?? null };
};

export const SPECS: Record<ZKind, KindSpec> = {
  walker: { ...base('walker'), chase: 2.2, roam: 0.95, radius: 0.3, hitR: 0.33, hitH: 1.62, headR: 0.2, swing: 1.1, rest: 1.0, reach: 0.75, turn: 5, lose: 7, mass: 1, eye: 1.45 },
  runner: { ...base('runner'), chase: 5.0, roam: 1.1, radius: 0.28, hitR: 0.3, hitH: 1.6, headR: 0.19, swing: 1.45, rest: 0.6, reach: 0.75, turn: 8, lose: 10, mass: 0.8, eye: 1.42 },
  crawler: { ...base('crawler'), chase: 1.25, roam: 0.5, radius: 0.3, hitR: 0.34, hitH: 0.5, headR: 0.2, swing: 1.6, rest: 0.9, reach: 0.7, turn: 4, lose: 8, mass: 0.9, eye: 0.4 },
  bloater: { ...base('bloater'), chase: 1.3, roam: 0.6, radius: 0.34, hitR: 0.46, hitH: 1.6, headR: 0.22, swing: 0.85, rest: 1.2, reach: 0.85, turn: 3, lose: 9, mass: 2.6, eye: 1.45 },
  armored: { ...base('armored'), chase: 1.4, roam: 0.6, radius: 0.34, hitR: 0.4, hitH: 1.68, headR: 0.21, swing: 0.9, rest: 1.2, reach: 0.85, turn: 3.2, lose: 10, mass: 2.4, eye: 1.5 },
  // 母体（据点模式的表里没有，数值是生化模式定的）：血很厚、比人跑步慢一点（人跑 7.0）、一下 34、打完几乎不歇、打不退。
  // 头没那么脆（爆头 1.9 倍而不是 2.5 倍），不然一梭子打头就没了
  mother: { kind: 'mother', hp: 2600, damage: 34, headVuln: 0.6, armor: null, chase: 5.6, roam: 1.3, radius: 0.34, hitR: 0.38, hitH: 1.86, headR: 0.22, swing: 1.3, rest: 0.4, reach: 0.9, turn: 7, lose: 14, mass: 3.2, eye: 1.66 },
};

/** 爆头倍率。据点模式是按枪定的（1.6–3.0），这里武器模块只给基础伤害、不说是哪把枪，统一用步枪那一档；再乘上各类丧尸头的脆弱系数 */
export const HEAD_MULT = 2.5;
export const headFactor = (s: KindSpec): number => 1 + (HEAD_MULT - 1) * s.headVuln;

/*
 * 出手的节奏（站着不动挨打时）：一下 = 出手动作 1.033 / swing 秒 + 歇 rest 秒（±20%）。
 *   行尸 10 血 / 1.94 秒 ≈ 5 血每秒，一只把满血的人打死要 18 秒左右；奔袭者 7 血 / 1.31 秒；肿胀者 18 血 / 2.4 秒；重装 22 血 / 2.35 秒。
 * 一群围着打：同时出手的只数有上限（白天一只、夜里两只），两次出手之间还要隔一会（白天 1.35 秒、夜里 0.85 秒，
 *   见 zombie-brain.ts 的 ATK_GAP_*），所以被三只以上的行尸围住：白天约 7.4 血每秒（12 秒多），夜里约 11.8 血每秒（8 秒左右）。
 *   前摇 0.6 秒，退开半步就打空；行尸追人 2.2 米/秒，走着就能甩开。
 * 这个节奏是按目标算的：玩家和他旁边的同伴（Prey）各有各的名额，两个人会同时挨打。发电机这种大件同时三只。
 * 母体：34 血 / 约 1.2 秒，前摇 0.5 秒。
 */

/** 出手动作（punching）的总时长和手伸到最前面的时刻（清单里各个外观都是 1.033 秒、0.645） */
export const PUNCH_DUR = 1.033;
export const PUNCH_HIT = 0.645;
