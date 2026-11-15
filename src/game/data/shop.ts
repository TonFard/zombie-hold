import { GUN_BY_ID, catOf, type GunCat, type GunDef } from './guns';
import { NO_MOD, effectiveStats, type WeaponKind, type WeaponStats } from './weapons';

/**
 * 回合制对战（8v8）的商店和经济：每把枪的价格、击杀奖励、护甲，以及每局发多少钱。
 * 数值的底子还是打僵尸那一套（枪类 × 型号倍率），这里只管"对人"时再乘多少、卖多少钱。
 */

/** 对战里所有的枪都按局内 2 级算（和以前的团队死斗一样：射速 / 弹匣比 0 级好一点） */
export const ARENA_TIER = 2;

/**
 * 对人伤害倍率（按枪类）。打僵尸的数值直接拿来对人，步枪远近通吃、冲锋枪出了射程就被衰减吃掉；
 * 这里按"没穿甲的人 0.3–0.7 秒倒"拉平。步枪贵，所以比以前的团队死斗（0.75）给得多一点
 */
export const VS_HUMAN: Record<WeaponKind, number> = { pistol: 1.4, smg: 1.5, shotgun: 1.0, rifle: 0.9, sniper: 0.8, lmg: 1.2 };

/**
 * 个别型号再调一下：机枪底子的战斗步枪单发还差一点（要三枪倒一个没穿甲的）；短突是冲锋枪的底子，照冲锋枪乘就比 AKM 还狠；
 * .50 半自动和最便宜的栓动不该连穿甲的人都一枪一个
 */
const VS_HUMAN_GUN: Record<string, number> = { hk_g3: 1.1, fn_fal: 1.1, hcar: 1.1, type_81: 0.9, m107: 0.9, kar98: 0.85 };

export const vsHuman = (id: string, cls: WeaponKind): number => VS_HUMAN[cls] * (VS_HUMAN_GUN[id] ?? 1);

/** 价格（金币）。每类里从便宜到贵 */
export const PRICES: Record<string, number> = {
  // 手枪：格洛克是白给的
  glock_17: 0,
  m9a4: 250,
  p320: 300,
  m1911: 350,
  b93r: 450,
  tec_9: 500,
  rhino357: 600,
  deagle: 700,
  // 冲锋枪
  cz75: 900,
  uzi: 1050,
  ump45: 1200,
  hk_mp5a5: 1400,
  hk_mp7a1: 1500,
  p90: 2100,
  vector45: 2300,
  // 霰弹枪
  db_short: 900,
  m1897: 1100,
  m870: 1300,
  db_long: 1500,
  m1014: 1800,
  spas_12: 2000,
  aa12: 2800,
  // 突击步枪
  type_81: 2000,
  mk18: 2400,
  ak47: 2700,
  m4a1: 2900,
  g36k: 2900,
  ak12: 3000,
  aug: 3200,
  hk416d: 3300,
  // 射手步枪
  sks_tactical: 2400,
  hk_g3: 2800,
  fn_fal: 2900,
  scar_h: 3100,
  hcar: 3300,
  mk14: 3400,
  svd: 3800,
  // 狙击步枪
  kar98: 2600,
  m700: 3600,
  ai_awp: 4600,
  m107: 5400,
  m95: 5800,
  // 机枪
  rpk: 3000,
  m249: 4200,
  pkm: 4400,
  fn_evolys: 4600,
};

export const priceOf = (id: string): number => PRICES[id] ?? 9999;

/** 用这一类枪打死一个人给多少钱：越难用、越便宜的枪给得越多 */
export const KILL_REWARD: Record<GunCat, number> = { pistol: 400, smg: 500, shotgun: 650, rifle: 300, dmr: 300, sniper: 200, lmg: 350 };

export const DEFAULT_PISTOL = 'glock_17';

/** 护甲 */
export const GEAR = {
  vest: { name: '防弹衣', price: 600, note: '打在身上的伤害少三成，挨打会磨损' },
  helmet: { name: '头盔', price: 350, note: '爆头伤害少三成五' },
  nade: { name: '破片手雷', price: 300, note: '按 G 扔出去，1.7 秒后炸，躲在掩体后面的人也炸得到；一局只能带一颗' },
} as const;
export type GearId = keyof typeof GEAR;

export const ARMOR = {
  max: 100,
  /** 身上的伤害被防弹衣吃掉的比例；吃掉多少护甲就掉多少的 1.6 倍（一条命打下来大概掉一半多） */
  body: 0.3,
  wear: 1.6,
  /** 头盔吃掉的爆头伤害比例 */
  head: 0.35,
};

/** 挨一下：返回掉多少血、护甲还剩多少 */
export function throughArmor(dmg: number, head: boolean, armor: number, helmet: boolean): { hp: number; armor: number } {
  if (head) return { hp: helmet ? dmg * (1 - ARMOR.head) : dmg, armor };
  if (armor <= 0) return { hp: dmg, armor: 0 };
  const eaten = Math.min(dmg * ARMOR.body, armor / ARMOR.wear);
  return { hp: dmg - eaten, armor: Math.max(0, armor - eaten * ARMOR.wear) };
}

/**
 * 刀（人人都有，不用买）：左键横挥、右键捅；从背后捅一刀毙命。拿着刀跑得快一点。
 * dur = 一下多长，hitAt = 挥出去多久算打中，range = 够得着多远（到对方身体表面），back = 从背后打的伤害
 */
export const KNIFE = {
  slash: { dur: 0.5, hitAt: 0.19, range: 1.45, damage: 40, back: 90 },
  stab: { dur: 0.85, hitAt: 0.3, range: 1.3, damage: 65, back: 180 },
  /** 左右各这么宽的扇形里才够得着 */
  arc: (50 * Math.PI) / 180,
  /** 拿着刀的移动速度倍率；把枪换回来要多久 */
  speed: 1.12,
  draw: 0.4,
  /** 用刀杀一个人给的钱 */
  reward: 1500,
} as const;

/** 破片手雷：一局最多带一颗。中心伤害、伤害半径（往外线性减到 0）、引信、出手速度、抬手时间 */
export const NADE = { max: 1, damage: 110, radius: 6.5, fuse: 1.7, speed: 15, windup: 0.4, cd: 0.8, reward: 300 } as const;

/** 备弹：每一类枪带几个弹匣的量（每局开始补满） */
export const RESERVE_MAGS: Record<WeaponKind, number> = { pistol: 4, smg: 4, shotgun: 4, rifle: 3, sniper: 3, lmg: 2 };

/** 发钱的规矩 */
export const ECON = {
  start: 800,
  cap: 12000,
  win: 3000,
  /** 输了也给：连输越多给得越多，赢一局清零 */
  loss: 1700,
  lossStep: 500,
  lossMax: 3400,
};

export const lossBonus = (streak: number): number => Math.min(ECON.lossMax, ECON.loss + ECON.lossStep * Math.max(0, streak - 1));

/**
 * 射程（子弹飞多远就没了）放大多少。打僵尸的图上交火都在二十米以内，冲锋枪 16 米、步枪 32 米够用；
 * 对战的图一条路就有四十多米：照原样的话冲锋枪连对面的人都够不着，比手枪还没用。
 * 距离衰减是按射程的比例算的，跟着一起拉长：冲锋枪 16 米内满伤害、32 米处剩一半多，步枪 45 米内满伤害
 */
const ARENA_RANGE: Record<WeaponKind, number> = { pistol: 1.5, smg: 2, shotgun: 1.4, rifle: 2, sniper: 1.6, lmg: 2.3 };

const statCache = new Map<string, WeaponStats>();

/** 这把枪在对战里的属性（只读，别改返回值） */
export function arenaStats(id: string): WeaponStats {
  let st = statCache.get(id);
  if (!st) {
    const g = GUN_BY_ID[id] as GunDef;
    st = effectiveStats(g.cls, ARENA_TIER, NO_MOD, g);
    st = { ...st, range: Math.round(st.range * ARENA_RANGE[g.cls]) };
    statCache.set(id, st);
  }
  return st;
}

/** 这把枪带多少备弹 */
export const reserveFor = (id: string): number => {
  const g = GUN_BY_ID[id] as GunDef;
  return Math.round(arenaStats(id).mag * RESERVE_MAGS[g.cls]);
};

/** 每发子弹（每颗弹丸）打在没穿甲的人身上掉多少血（不算距离衰减） */
export const humanDamage = (id: string): number => {
  const g = GUN_BY_ID[id] as GunDef;
  return arenaStats(id).damage * vsHuman(id, g.cls);
};

export interface ShopRow {
  gun: GunDef;
  cat: GunCat;
  price: number;
}

/** 某一类的货架：按价格从低到高 */
export function shelf(cat: GunCat): ShopRow[] {
  return Object.keys(PRICES)
    .filter((id) => GUN_BY_ID[id] && catOf(id) === cat)
    .map((id) => ({ gun: GUN_BY_ID[id] as GunDef, cat, price: priceOf(id) }))
    .sort((a, b) => a.price - b.price);
}
