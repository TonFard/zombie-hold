export type StructureKind = 'barricade' | 'turret' | 'spikes';

export const STRUCTURE_ORDER: StructureKind[] = ['barricade', 'turret', 'spikes'];

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
};

/** 炮塔参数 */
export const TURRET = { range: 9, rate: 4, damage: 8, turn: 9 };
/** 地刺参数：每 0.5 秒对站在上面的僵尸造成一次伤害，每次命中消耗 1 点耐久 */
export const SPIKES = { interval: 0.5, damage: 12 };
/** 拆除返还比例 */
export const SELL_REFUND = 0.7;
/** 修理：每点零件修复的生命值 */
export const REPAIR_HP_PER_SCRAP = 10;
/** 玩家离多远还能建造 / 修理 */
export const BUILD_RANGE = 9;
export const REPAIR_RANGE = 2.6;
