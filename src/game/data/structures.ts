export type StructureKind = 'barricade' | 'turret' | 'spikes' | 'hmg' | 'flamer' | 'mortar';

export const STRUCTURE_ORDER: StructureKind[] = ['barricade', 'turret', 'spikes', 'hmg', 'flamer', 'mortar'];

export interface StructureDef {
  kind: StructureKind;
  name: string;
  desc: string;
  cost: number;
  hp: number;
  /** 是否挡路 */
  blocks: boolean;
  /** 寻路时穿过这格的额外代价；僵尸宁愿绕远路，路被封死才会拆 */
  navCost: number;
}

export const STRUCTURES: Record<StructureKind, StructureDef> = {
  barricade: { kind: 'barricade', name: '木制路障', desc: '挡住通道，僵尸会绕路，绕不过去才拆', cost: 15, hp: 220, blocks: true, navCost: 25 },
  turret: { kind: 'turret', name: '自动炮塔', desc: '射程 9，自动射击最靠近发电机的僵尸', cost: 90, hp: 150, blocks: true, navCost: 30 },
  spikes: { kind: 'spikes', name: '地刺', desc: '不挡路，踩上去的僵尸持续受伤', cost: 30, hp: 25, blocks: false, navCost: 3 },
  hmg: { kind: 'hmg', name: '重机枪塔', desc: '射程 12，伤害高、转得慢、很耐打', cost: 150, hp: 320, blocks: true, navCost: 35 },
  flamer: { kind: 'flamer', name: '喷火塔', desc: '射程 5，向前方扇形喷火，点燃范围内所有僵尸', cost: 130, hp: 180, blocks: true, navCost: 35 },
  mortar: { kind: 'mortar', name: '迫击炮', desc: '射程 6–20，炮弹走抛物线，落地范围爆炸', cost: 170, hp: 140, blocks: true, navCost: 30 },
};

/** 会自动开火、计入炮塔数量上限的建筑 */
export type TurretKind = 'turret' | 'hmg' | 'flamer' | 'mortar';
export const isTurret = (k: StructureKind): k is TurretKind => k === 'turret' || k === 'hmg' || k === 'flamer' || k === 'mortar';

export interface TurretDef {
  range: number;
  /** 最小射程（迫击炮打不了脚下） */
  minRange: number;
  /** 每秒开火次数 */
  rate: number;
  /** 每次命中伤害（喷火塔是每次对扇形内每只僵尸） */
  damage: number;
  /** 转速（弧度 / 秒） */
  turn: number;
  /** 喷火塔：扇形半角（弧度）和点燃的每秒伤害 */
  cone: number;
  burn: number;
  /** 迫击炮：爆炸半径 */
  aoe: number;
}

const tdef = (o: Partial<TurretDef>): TurretDef => ({ range: 9, minRange: 0, rate: 4, damage: 8, turn: 9, cone: 0, burn: 0, aoe: 0, ...o });

/**
 * 炮塔参数。单体"每零件 DPS"不得超过自动炮塔（check:balance 检查）：
 * 重机枪塔胜在射程和耐打，喷火塔胜在群伤，迫击炮胜在射程和范围。
 */
export const TURRETS: Record<TurretKind, TurretDef> = {
  turret: tdef({}),
  hmg: tdef({ range: 12, rate: 3, damage: 16, turn: 3.5 }),
  flamer: tdef({ range: 5, rate: 6, damage: 3.5, turn: 5, cone: 0.45, burn: 6 }),
  mortar: tdef({ range: 20, minRange: 6, rate: 0.4, damage: 55, turn: 2.5, aoe: 2.4 }),
};

/** 炮塔参数（旧名，自动炮塔） */
export const TURRET = TURRETS.turret;
/** 地刺参数：每 0.5 秒对站在上面的僵尸造成一次伤害，每次命中消耗 1 点耐久 */
export const SPIKES = { interval: 0.5, damage: 12 };
/** 拆除返还比例 */
export const SELL_REFUND = 0.7;
/** 修理：每点零件修复的生命值 */
export const REPAIR_HP_PER_SCRAP = 10;
/** 玩家离多远还能建造 / 修理 */
export const BUILD_RANGE = 9;
export const REPAIR_RANGE = 2.6;

/** 单体持续 DPS（喷火塔算上灼烧；不算群伤和范围） */
export function turretDps(k: TurretKind): number {
  const t = TURRETS[k];
  return t.rate * t.damage + t.burn;
}
