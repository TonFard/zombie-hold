/** 夜晚词缀：从第 2 夜起，每个白天预告下一夜的一个词缀 */
export type NightModId = 'bloodmoon' | 'fog' | 'blackout' | 'horde' | 'elite';

export const NIGHT_MOD_ORDER: NightModId[] = ['bloodmoon', 'fog', 'blackout', 'horde', 'elite'];

export interface NightMod {
  id: NightModId;
  name: string;
  desc: string;
  /** 僵尸移动速度倍率 */
  speed: number;
  /** 零件收益倍率 */
  scrap: number;
  /** 僵尸数量 / 生命倍率 */
  count: number;
  hp: number;
  /** 炮塔射速倍率 */
  turretRate: number;
  /** 奔袭者出场权重倍率 */
  runner: number;
  /** 每批带一只精英 */
  elite: boolean;
  /** 画面：雾浓度倍率；雷达范围倍率 */
  fog: number;
  radar: number;
}

const mod = (o: Partial<NightMod> & Pick<NightMod, 'id' | 'name' | 'desc'>): NightMod => ({ speed: 1, scrap: 1, count: 1, hp: 1, turretRate: 1, runner: 1, elite: false, fog: 1, radar: 1, ...o });

export const NIGHT_MODS: Record<NightModId, NightMod> = {
  bloodmoon: mod({ id: 'bloodmoon', name: '血月', desc: '僵尸速度 +25%，零件 +50%', speed: 1.25, scrap: 1.5 }),
  fog: mod({ id: 'fog', name: '浓雾', desc: '视距变短，雷达范围减半，奔袭者变多', runner: 1.8, fog: 2.4, radar: 0.5 }),
  blackout: mod({ id: 'blackout', name: '停电', desc: '炮塔射速 −40%，路灯熄灭', turretRate: 0.6 }),
  horde: mod({ id: 'horde', name: '尸群', desc: '数量 +30%，生命 −20%', count: 1.3, hp: 0.8 }),
  elite: mod({ id: 'elite', name: '精英夜', desc: '每批带 1 只金色精英（生命 ×3，掉落 ×3）', elite: true }),
};

/** 没有词缀时的系数 */
export const NO_MOD: NightMod = mod({ id: 'bloodmoon', name: '', desc: '' });

export const nightMod = (id: string): NightMod => NIGHT_MODS[id as NightModId] ?? NO_MOD;

/** 精英：生命和掉落倍率 */
export const ELITE_HP = 3;
export const ELITE_REWARD = 3;

// ---------------------------------------------------------------- 夜间挑战

export type ChallengeId = 'pistol' | 'nobreach' | 'headshot' | 'blitz';

export const CHALLENGE_ORDER: ChallengeId[] = ['pistol', 'nobreach', 'headshot', 'blitz'];

export interface ChallengeDef {
  id: ChallengeId;
  name: string;
  desc: string;
  /** 进度目标（显示用） */
  goal: number;
}

export const CHALLENGES: Record<ChallengeId, ChallengeDef> = {
  pistol: { id: 'pistol', name: '老伙计', desc: '用手枪击杀 15 只', goal: 15 },
  nobreach: { id: 'nobreach', name: '固若金汤', desc: '这一夜一个路障都不被拆', goal: 1 },
  headshot: { id: 'headshot', name: '神枪手', desc: '这一夜爆头击杀率 ≥ 40%（至少 15 杀）', goal: 40 },
  blitz: { id: 'blitz', name: '闪电战', desc: '30 秒内击杀 20 只', goal: 20 },
};

/** 完成挑战的奖励：零件 + 勋章（勋章在一局结算时加上） */
export const CHALLENGE_SCRAP = 60;
export const CHALLENGE_MEDALS = 5;

/** 连杀：两次击杀间隔不超过这么久就累加；每层 +5% 零件，最多 +50% */
export const COMBO_WINDOW = 3;
export const comboMult = (combo: number): number => 1 + Math.min(0.5, Math.max(0, combo - 1) * 0.05);

/** 手电筒：电量（秒）、每秒充电、照明距离（米）、开灯时僵尸索敌范围倍率 */
export const FLASHLIGHT = { battery: 12, recharge: 0.6, range: 25, aggro: 1.3 };
