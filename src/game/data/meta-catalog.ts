import type { StructureKind } from './structures';
import { WEAPONS, type WeaponKind } from './weapons';
import { REGEN_PER_LEVEL } from './heal';
import { MASTERY_MAX } from './mastery';

/** 局外成长：大厅里用勋章买的项目。一张表同时给逻辑（加成）和界面（列表）用 */
export type MetaSection = 'armory' | 'engineering' | 'supply' | 'fitness';

export const SECTION_NAME: Record<MetaSection, string> = { armory: '军械库', engineering: '工程部', supply: '补给站', fitness: '体能训练' };

export interface MetaItem {
  id: string;
  section: MetaSection;
  name: string;
  /** 描述；{n} 会换成下一级的数值 */
  desc: string;
  /** 每一级的价格，长度 = 最高级 */
  prices: number[];
  /** 前置：另一个项目至少到几级 */
  requires?: { id: string; level: number };
  /** 前置：某把枪的熟练度至少到几级（武器解锁链靠它，不靠勋章） */
  mastery?: { weapon: WeaponKind; level: number };
  /** 每一级要求的军衔（RANKS 的下标），长度 = prices；不写 = 全部 0 */
  ranks?: number[];
  /** 效果（汇总进 MetaBonuses），level 是当前已买的级数 */
  apply(b: MetaBonuses, level: number): void;
}

/** 局外加成汇总：开局时由 meta/loadout.ts 应用到一局上 */
export interface MetaBonuses {
  weapons: Set<WeaponKind>;
  /** 每把武器的局内等级上限（5–8）：由熟练度决定（progress.bonusesOf 里填） */
  tierCap: Record<WeaponKind, number>;
  /** 允许带一把随身武器开局 */
  sidearm: boolean;
  /** 双持手枪 */
  dual: boolean;
  structures: Set<StructureKind>;
  turretCap: number;
  turretDamage: number;
  structHp: number;
  startScrap: number;
  maxHp: number;
  coreHp: number;
  scrapGain: number;
  rerolls: number;
  cardChoices: number;
  /** 受到伤害的倍率（< 1 更耐打） */
  armor: number;
  /** 脱战后每秒回复的生命 */
  regen: number;
  /** 移动速度倍率 */
  speed: number;
  /** 射速倍率（所有武器） */
  fireRate: number;
}

export function baseBonuses(): MetaBonuses {
  return {
    weapons: new Set<WeaponKind>(['pistol']),
    tierCap: { pistol: 5, smg: 5, shotgun: 5, rifle: 5, sniper: 5, lmg: 5, launcher: 5 },
    sidearm: false,
    dual: false,
    structures: new Set<StructureKind>(['barricade', 'turret', 'spikes']),
    turretCap: 3,
    turretDamage: 1,
    structHp: 1,
    startScrap: 0,
    maxHp: 0,
    coreHp: 0,
    scrapGain: 1,
    rerolls: 0,
    cardChoices: 3,
    armor: 1,
    regen: 0,
    speed: 1,
    fireRate: 1,
  };
}

/**
 * 军衔：按累计获得的勋章（medalsEarned，花掉的也算）晋升。每个项目的每一级都要求一个军衔，
 * 勋章再多也不能一口气把好东西全买了，得一局一局打上去。
 */
export interface Rank {
  name: string;
  /** 累计勋章达到多少晋升到这一级 */
  earned: number;
}

export const RANKS: Rank[] = [
  { name: '列兵', earned: 0 },
  { name: '下士', earned: 170 },
  { name: '中士', earned: 500 },
  { name: '上士', earned: 1100 },
  { name: '少尉', earned: 1950 },
  { name: '中尉', earned: 3150 },
  { name: '上尉', earned: 4600 },
  { name: '少校', earned: 6400 },
];

/** 累计勋章对应的军衔下标 */
export function rankOf(earned: number): number {
  let r = 0;
  for (let i = 0; i < RANKS.length; i++) if (earned >= (RANKS[i] as Rank).earned) r = i;
  return r;
}

/** 某个项目第 level + 1 级要求的军衔 */
export const rankFor = (m: MetaItem, level: number): number => m.ranks?.[level] ?? 0;

/**
 * 价格：下面的表 ×0.56 取整到 5，全部买满约 8000 勋章（大约是最早那版的两倍），
 * 普通玩家八十局左右、熟练玩家二十局左右；再加上军衔门槛和前置
 * （武器、炮塔、卡牌都是一条链），不能跳着买（sim:meta 输出）。
 */
const P = (...xs: number[]): number[] => xs.map((x) => Math.max(5, Math.round((x * PRICE_K) / 5) * 5));

/** 价格系数：加了「体能训练」这一栏之后整体下调，总价保持在 8000 左右 */
const PRICE_K = 0.5;

const WEAPON_NAMES: Record<WeaponKind, string> = { pistol: '手枪', smg: '冲锋枪', shotgun: '霰弹枪', rifle: '突击步枪', sniper: '狙击步枪', lmg: '轻机枪', launcher: '榴弹发射器' };

/**
 * 武器解锁链：手枪 → 冲锋枪 → 霰弹枪 → 突击步枪 → 狙击 / 轻机枪 → 榴弹（要先精通轻机枪）。
 * 解锁一把枪要先把上一把枪练到精通（熟练度 5 级，见 data/mastery.ts），再花勋章。
 * 等级上限也不再用勋章买，由这把枪自己的熟练度决定——想用好枪，就得先把手里的枪用熟
 */
const UNLOCK_PRE: Record<Exclude<WeaponKind, 'pistol'>, WeaponKind> = { smg: 'pistol', shotgun: 'smg', rifle: 'shotgun', sniper: 'rifle', lmg: 'rifle', launcher: 'lmg' };

const unlockWeapon = (k: Exclude<WeaponKind, 'pistol'>, price: number, desc: string): MetaItem => ({
  id: `unlock-${k}`,
  section: 'armory',
  name: `解锁${WEAPON_NAMES[k]}`,
  // 解锁只是让工坊里能买，局内还要花零件：写在描述里，免得以为解锁了就直接有枪
  desc: `${desc}；之后每局在工坊花 ${WEAPONS[k].price} 零件购买`,
  // 武器解锁价格不打折：门槛主要是熟练度，勋章只是最后一步
  prices: [price],
  mastery: { weapon: UNLOCK_PRE[k], level: MASTERY_MAX },
  ...(UNLOCK_PRE[k] !== 'pistol' ? { requires: { id: `unlock-${UNLOCK_PRE[k]}`, level: 1 } } : {}),
  apply: (b, lv) => {
    if (lv > 0) b.weapons.add(k);
  },
});

export const META_ITEMS: MetaItem[] = [
  // ---- 军械库 ----
  unlockWeapon('smg', 60, '射速 13，城区巷战主力'),
  unlockWeapon('shotgun', 120, '全自动，近距离一喷一片'),
  unlockWeapon('rifle', 200, '射程 32 米，从一开始就穿透'),
  unlockWeapon('sniper', 300, '初速 420，爆头 ×3，穿透 2'),
  unlockWeapon('lmg', 300, '弹链 100 发，压制减速'),
  unlockWeapon('launcher', 400, '榴弹范围爆炸，伤害 120'),
  // 双持：手枪练到 3 级就能买，是手枪前期的大目标；后期手枪当副武器也用得上
  { id: 'dual', section: 'armory', name: '手枪双持', desc: '左右手各一把：弹匣 ×2、射速 ×1.7，但换弹更慢、重量翻倍、散布变大、不能举镜', prices: P(160), mastery: { weapon: 'pistol', level: 3 }, apply: (b, lv) => { b.dual = lv > 0; } },
  // 随身武器：开局就带一把已解锁的枪。要先解锁霰弹枪（不能靠它在前期跳过武器解锁链），
  // 勋章 150：比解锁霰弹枪（120）贵一些、比解锁突击步枪（200）便宜，攒一阵子才买得起；不打折，和武器解锁同价档
  { id: 'sidearm', section: 'armory', name: '随身武器', desc: '开局就带着一把已解锁的武器（出征时选）；要先解锁霰弹枪', prices: [150], requires: { id: 'unlock-shotgun', level: 1 }, apply: (b, lv) => { b.sidearm = lv > 0; } },
  // ---- 工程部 ----
  { id: 'turret-cap', section: 'engineering', name: '炮塔数量上限', desc: '所有炮塔合计最多 {n} 座', prices: P(80, 140, 210, 300, 420), ranks: [1, 2, 4, 5, 6], apply: (b, lv) => { b.turretCap = 3 + lv; } },
  { id: 'unlock-hmg', section: 'engineering', name: '解锁重机枪塔', desc: '射程 12，伤害高，转得慢，能吃伤害', prices: P(200), ranks: [2], requires: { id: 'turret-cap', level: 1 }, apply: (b, lv) => { if (lv) b.structures.add('hmg'); } },
  { id: 'unlock-flamer', section: 'engineering', name: '解锁喷火塔', desc: '射程 5，扇形喷火，点燃范围内所有僵尸', prices: P(300), ranks: [4], requires: { id: 'unlock-hmg', level: 1 }, apply: (b, lv) => { if (lv) b.structures.add('flamer'); } },
  { id: 'unlock-mortar', section: 'engineering', name: '解锁迫击炮', desc: '射程 6–20，抛物线炮弹，落地范围爆炸', prices: P(450), ranks: [5], requires: { id: 'unlock-flamer', level: 1 }, apply: (b, lv) => { if (lv) b.structures.add('mortar'); } },
  { id: 'turret-dmg', section: 'engineering', name: '炮塔伤害', desc: '炮塔和地刺伤害 +{n}%', prices: P(120, 220, 350), ranks: [2, 4, 6], requires: { id: 'unlock-hmg', level: 1 }, apply: (b, lv) => { b.turretDamage = 1 + 0.1 * lv; } },
  { id: 'struct-hp', section: 'engineering', name: '建筑生命', desc: '所有建筑生命 +{n}%', prices: P(90, 170, 270), ranks: [1, 3, 5], apply: (b, lv) => { b.structHp = 1 + 0.15 * lv; } },
  // ---- 补给站 ----
  { id: 'start-scrap', section: 'supply', name: '开局零件', desc: '开局多带 {n} 零件', prices: P(60, 110, 170, 250, 350), ranks: [0, 1, 3, 4, 6], apply: (b, lv) => { b.startScrap = 40 * lv; } },
  { id: 'max-hp', section: 'supply', name: '最大生命', desc: '最大生命 +{n}', prices: P(50, 100, 160, 230, 320), ranks: [0, 2, 3, 5, 6], apply: (b, lv) => { b.maxHp = 10 * lv; } },
  { id: 'core-hp', section: 'supply', name: '发电机生命', desc: '发电机生命 +{n}', prices: P(50, 100, 160, 230, 320), ranks: [0, 1, 3, 4, 6], apply: (b, lv) => { b.coreHp = 50 * lv; } },
  { id: 'scrap-gain', section: 'supply', name: '零件收益', desc: '零件收益 +{n}%', prices: P(180, 300, 450), ranks: [2, 4, 7], requires: { id: 'start-scrap', level: 2 }, apply: (b, lv) => { b.scrapGain = 1 + 0.05 * lv; } },
  { id: 'reroll', section: 'supply', name: '卡牌重抽', desc: '每个黎明可以重抽一次卡牌', prices: P(250), ranks: [3], apply: (b, lv) => { b.rerolls = lv; } },
  // ---- 体能训练：数值都偏保守，局内卡牌（同类加成更大）才是主力 ----
  { id: 'armor', section: 'fitness', name: '防弹插板', desc: '受到的伤害 −{n}%', prices: P(60, 110, 170, 240), ranks: [0, 2, 4, 6], apply: (b, lv) => { b.armor = 1 - 0.04 * lv; } },
  { id: 'regen', section: 'fitness', name: '急救训练', desc: '5 秒没受伤后每秒回复 {n} 点生命', prices: P(90, 160, 240), ranks: [1, 3, 5], requires: { id: 'max-hp', level: 1 }, apply: (b, lv) => { b.regen = REGEN_PER_LEVEL * lv; } },
  { id: 'move-speed', section: 'fitness', name: '负重训练', desc: '移动速度 +{n}%', prices: P(70, 130, 200), ranks: [1, 3, 5], apply: (b, lv) => { b.speed = 1 + 0.03 * lv; } },
  { id: 'fire-rate', section: 'fitness', name: '射击训练', desc: '所有武器射速 +{n}%', prices: P(110, 200, 300), ranks: [2, 4, 6], requires: { id: 'unlock-shotgun', level: 1 }, apply: (b, lv) => { b.fireRate = 1 + 0.04 * lv; } },
  { id: 'four-cards', section: 'supply', name: '卡牌四选一', desc: '黎明时给 4 张卡牌选', prices: P(500), ranks: [7], requires: { id: 'reroll', level: 1 }, apply: (b, lv) => { b.cardChoices = 3 + lv; } },
];

export const META_BY_ID: Record<string, MetaItem> = Object.fromEntries(META_ITEMS.map((m) => [m.id, m]));

/** 描述里 {n} 对应的数值：按"买了 level 级之后"算 */
export function metaValue(id: string, level: number): number {
  switch (id) {
    case 'turret-cap':
      return 3 + level;
    case 'turret-dmg':
      return 10 * level;
    case 'struct-hp':
      return 15 * level;
    case 'start-scrap':
      return 40 * level;
    case 'max-hp':
      return 10 * level;
    case 'core-hp':
      return 50 * level;
    case 'scrap-gain':
      return 5 * level;
    case 'armor':
      return 4 * level;
    case 'move-speed':
      return 3 * level;
    case 'fire-rate':
      return 4 * level;
    case 'regen':
      return Math.round(REGEN_PER_LEVEL * level * 10) / 10;
    default:
      return level;
  }
}

export const metaDesc = (m: MetaItem, level: number): string => m.desc.replace('{n}', String(metaValue(m.id, level)));
