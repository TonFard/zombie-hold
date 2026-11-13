import type { WeaponKind, WeaponStats } from './weapons';

/** 有模型可换的枪类（现在每一类都有） */
export type GunClass = WeaponKind;

/**
 * 同一类枪里的不同型号（TACZ 模型）。熟练度、升星、工作台强化、局内升级都按枪类算，
 * 型号只在这一类的数值上乘一组倍率（升级照常叠在上面）。
 * 每类第一把是默认型号（倍率全是 1），其余的是侧重不同的取舍，不是单纯更强
 */
export interface GunDef {
  /** = TACZ 枪包里的枪 id（public/tacz/<id>/） */
  id: string;
  cls: GunClass;
  name: string;
  /** 一句话特点 */
  desc: string;
  /** 数值倍率（弹匣乘完取整） */
  mul?: Partial<Record<'damage' | 'rate' | 'mag' | 'reload' | 'spread' | 'range' | 'adsTime', number>>;
  /** 数值增量 */
  add?: Partial<Record<'pellets' | 'pierce', number>>;
  /** 后坐力倍率 */
  recoil?: number;
  /** 重量增减（千克） */
  weight?: number;
  /** 解锁：这一类枪的熟练度至少几级，再花多少勋章；默认型号是 0 / 0 */
  mastery: number;
  medals: number;
}

const gun = (o: GunDef): GunDef => o;

export const GUNS: GunDef[] = [
  // ---- 手枪：基础 20 伤害 × 3 发/秒、12 发 ----
  gun({ id: 'glock_17', cls: 'pistol', name: '格洛克 17', desc: '中规中矩，哪里都不差', mastery: 0, medals: 0 }),
  gun({ id: 'm1911', cls: 'pistol', name: 'M1911', desc: '.45 大口径：一发更疼，弹匣只有 7 发', mul: { damage: 1.45, rate: 0.75, mag: 0.6, spread: 0.9 }, recoil: 1.25, mastery: 1, medals: 30 }),
  gun({ id: 'b93r', cls: 'pistol', name: 'B93R 冲锋手枪', desc: '冲锋手枪：射速翻倍、弹匣 20 发，但散、单发轻', mul: { damage: 0.7, rate: 1.8, mag: 1.67, spread: 1.4, reload: 1.15 }, recoil: 0.9, mastery: 3, medals: 60 }),
  gun({ id: 'deagle', cls: 'pistol', name: '沙漠之鹰', desc: '.50 手炮：一发一个窟窿，能穿 1 只；很慢、跳得厉害', mul: { damage: 2.2, rate: 0.5, mag: 0.6, reload: 1.1, spread: 0.8 }, add: { pierce: 1 }, recoil: 1.8, weight: 0.6, mastery: 5, medals: 100 }),
  gun({ id: 'm9a4', cls: 'pistol', name: '贝雷塔 M9A4', desc: '18 发大弹匣、稳；单发稍轻', mul: { damage: 0.92, mag: 1.5, spread: 0.9 }, recoil: 0.85, mastery: 1, medals: 30 }),
  gun({ id: 'p320', cls: 'pistol', name: 'P320', desc: '.45 口径：比格洛克疼一些、射速稍慢', mul: { damage: 1.25, rate: 0.85, mag: 0.85 }, recoil: 1.1, weight: 0.2, mastery: 2, medals: 45 }),
  gun({ id: 'tec_9', cls: 'pistol', name: 'TEC-9', desc: '全自动：射速是格洛克的两倍多、20 发；很散、单发轻', mul: { damage: 0.6, rate: 2.2, mag: 1.67, spread: 1.6, reload: 1.1 }, recoil: 0.8, weight: 0.4, mastery: 4, medals: 80 }),
  gun({ id: 'rhino357', cls: 'pistol', name: '犀牛 .357 左轮', desc: '左轮：6 发、单发重、准；换弹慢', mul: { damage: 1.8, rate: 0.6, mag: 0.5, reload: 1.6, spread: 0.7 }, recoil: 1.5, weight: 0.85, mastery: 4, medals: 85 }),
  // ---- 冲锋枪：10 × 13 发/秒、36 发 ----
  gun({ id: 'ump45', cls: 'smg', name: 'UMP45', desc: '.45 冲锋枪，稳当', mastery: 0, medals: 0 }),
  gun({ id: 'hk_mp5a5', cls: 'smg', name: 'MP5A5', desc: '准：散布和后坐都小一截，单发稍轻', mul: { damage: 0.9, spread: 0.65 }, recoil: 0.7, mastery: 1, medals: 40 }),
  gun({ id: 'p90', cls: 'smg', name: 'P90', desc: '50 发弹匣，一路打不停；换弹慢', mul: { damage: 0.85, rate: 1.1, mag: 1.4, reload: 1.2 }, mastery: 3, medals: 80 }),
  gun({ id: 'vector45', cls: 'smg', name: '维克托', desc: '射速快一半，贴脸最狠；弹匣打得飞快、更散', mul: { damage: 0.8, rate: 1.45, mag: 0.85, spread: 1.15 }, recoil: 1.2, weight: -0.2, mastery: 5, medals: 120 }),
  gun({ id: 'uzi', cls: 'smg', name: '乌兹', desc: '老式开膛冲锋枪：单发重一点、射速慢、换弹快', mul: { damage: 1.15, rate: 0.8, mag: 0.85, reload: 0.85, spread: 1.1 }, recoil: 1.1, weight: 0.4, mastery: 1, medals: 40 }),
  gun({ id: 'hk_mp7a1', cls: 'smg', name: 'MP7A1', desc: '4.6 毫米穿甲弹：能穿 1 只、轻、射速快；弹匣小', mul: { damage: 0.8, rate: 1.15, mag: 0.75 }, add: { pierce: 1 }, recoil: 0.85, weight: -0.5, mastery: 2, medals: 60 }),
  gun({ id: 'cz75', cls: 'smg', name: 'CZ 75 全自动', desc: '全自动手枪当冲锋枪用：最轻、举枪最快；弹匣小、散', mul: { damage: 0.85, rate: 1.1, mag: 0.6, spread: 1.25, adsTime: 0.7, reload: 0.8 }, recoil: 0.9, weight: -1.5, mastery: 4, medals: 90 }),
  gun({ id: 'type_81', cls: 'smg', name: '81-1 短突', desc: '7.62 步枪弹：单发重、射程远，射速只有一半', mul: { damage: 1.7, rate: 0.6, mag: 0.85, range: 1.4, spread: 0.8 }, recoil: 1.35, weight: 0.9, mastery: 4, medals: 100 }),
  // ---- 霰弹枪：11 × 9 弹丸、3 发/秒、8 发 ----
  gun({ id: 'm870', cls: 'shotgun', name: 'M870', desc: '泵动霰弹，贴脸一枚一只', mastery: 0, medals: 0 }),
  gun({ id: 'm1014', cls: 'shotgun', name: 'M1014', desc: '半自动：射速快一些，单发稍弱、稍散', mul: { damage: 0.9, rate: 1.2, spread: 1.1 }, recoil: 0.9, mastery: 1, medals: 40 }),
  gun({ id: 'spas_12', cls: 'shotgun', name: 'SPAS-12', desc: '收束好、打得远，射速慢', mul: { damage: 1.2, rate: 0.75, spread: 0.75, range: 1.25 }, recoil: 1.1, weight: 0.4, mastery: 3, medals: 80 }),
  gun({ id: 'aa12', cls: 'shotgun', name: 'AA-12', desc: '全自动霰弹 + 16 发弹鼓：一路喷过去；单发弱、换弹慢、重', mul: { damage: 0.75, rate: 1.6, mag: 2, reload: 1.35 }, recoil: 1.25, weight: 1, mastery: 5, medals: 120 }),
  gun({ id: 'm1897', cls: 'shotgun', name: 'M1897 战壕枪', desc: '泵动连发：射速快一些、弹丸更集中；弹仓 6 发', mul: { rate: 1.15, mag: 0.75, spread: 0.85 }, recoil: 1.05, mastery: 1, medals: 40 }),
  gun({ id: 'db_short', cls: 'shotgun', name: 'DB-2 短管', desc: '锯短双管：两发、每发 13 颗弹丸、换弹快；很散', mul: { rate: 1.6, mag: 0.25, reload: 0.6, spread: 1.4 }, add: { pellets: 4 }, recoil: 1.4, weight: -1, mastery: 2, medals: 55 }),
  gun({ id: 'db_long', cls: 'shotgun', name: 'DB-4 长管', desc: '长管双管：两发、伤害高、收束好打得远', mul: { damage: 1.35, rate: 1.4, mag: 0.25, reload: 0.6, spread: 0.7, range: 1.3 }, recoil: 1.5, weight: -0.6, mastery: 4, medals: 85 }),
  // ---- 突击步枪：24 × 6.5 发/秒、30 发、穿 1 ----
  gun({ id: 'ak12', cls: 'rifle', name: 'AK-12', desc: '均衡的突击步枪', mastery: 0, medals: 0 }),
  gun({ id: 'm4a1', cls: 'rifle', name: 'M4A1', desc: '轻、稳、射速快；单发轻', mul: { damage: 0.85, rate: 1.2, spread: 0.8 }, recoil: 0.8, weight: -0.4, mastery: 1, medals: 40 }),
  gun({ id: 'scar_h', cls: 'rifle', name: 'SCAR-H', desc: '7.62 战斗步枪：单发重、穿 2 只；射速慢、弹匣 20 发', mul: { damage: 1.45, rate: 0.7, mag: 0.67 }, add: { pierce: 1 }, recoil: 1.35, weight: 0.4, mastery: 3, medals: 80 }),
  gun({ id: 'hk416d', cls: 'rifle', name: 'HK416', desc: '精工：射速快、换弹快、稳', mul: { damage: 0.95, rate: 1.2, reload: 0.85, spread: 0.9 }, recoil: 0.9, mastery: 5, medals: 120 }),
  gun({ id: 'ak47', cls: 'rifle', name: 'AKM', desc: '7.62 老 AK：单发更重、射速稍慢、跳得厉害', mul: { damage: 1.2, rate: 0.9 }, recoil: 1.3, weight: 0.1, mastery: 1, medals: 40 }),
  gun({ id: 'mk18', cls: 'rifle', name: 'MK18', desc: '短枪管：轻、举枪快、换弹快；射程短一些', mul: { damage: 0.92, rate: 1.1, reload: 0.85, adsTime: 0.8, range: 0.8 }, recoil: 0.9, weight: -0.6, mastery: 2, medals: 60 }),
  gun({ id: 'aug', cls: 'rifle', name: 'AUG', desc: '无托：自带瞄具，准、稳；换弹慢一点', mul: { damage: 0.95, rate: 1.1, spread: 0.65, reload: 1.15 }, recoil: 0.75, weight: -0.3, mastery: 4, medals: 90 }),
  gun({ id: 'g36k', cls: 'rifle', name: 'G36K', desc: '射速最快的步枪；单发轻、穿透照常', mul: { damage: 0.8, rate: 1.4, spread: 1.05 }, recoil: 0.85, weight: -0.2, mastery: 4, medals: 95 }),
  // ---- 狙击步枪：130 × 1.4 发/秒、5 发、穿 3 ----
  gun({ id: 'svd', cls: 'sniper', name: 'SVD', desc: '半自动狙击，连续点射', mastery: 0, medals: 0 }),
  gun({ id: 'm700', cls: 'sniper', name: 'M700', desc: '栓动：一发更狠、开镜快、轻；每发要拉栓', mul: { damage: 1.35, rate: 0.6, adsTime: 0.85 }, weight: -1, mastery: 1, medals: 50 }),
  gun({ id: 'm107', cls: 'sniper', name: 'M107 反器材', desc: '.50 半自动：10 发弹匣、穿 4 只；很重、后坐大、开镜慢', mul: { damage: 1.15, rate: 0.9, mag: 2, adsTime: 1.2 }, add: { pierce: 1 }, recoil: 1.5, weight: 3, mastery: 3, medals: 90 }),
  gun({ id: 'ai_awp', cls: 'sniper', name: 'AWM', desc: '.338 马格南：一发穿 5 只、伤害 ×1.7；射速最慢', mul: { damage: 1.7, rate: 0.55, reload: 1.1 }, add: { pierce: 2 }, recoil: 1.2, weight: 0.6, mastery: 5, medals: 130 }),
  gun({ id: 'sks_tactical', cls: 'sniper', name: 'SKS 战术', desc: '半自动射手步枪：射速快、轻；单发轻、少穿 1 只', mul: { damage: 0.6, rate: 1.8, mag: 2 }, add: { pierce: -1 }, recoil: 0.7, weight: -2, mastery: 1, medals: 50 }),
  gun({ id: 'kar98', cls: 'sniper', name: 'Kar98k', desc: '栓动老枪：伤害高、开镜快、最轻；只装 4 发', mul: { damage: 1.25, rate: 0.65, mag: 0.8, adsTime: 0.8, reload: 1.25 }, recoil: 1.1, weight: -2, mastery: 2, medals: 65 }),
  gun({ id: 'mk14', cls: 'sniper', name: 'MK14 EBR', desc: '7.62 射手步枪：射速快、10 发；单发稍轻', mul: { damage: 0.75, rate: 1.4, mag: 2 }, recoil: 0.95, weight: -0.7, mastery: 4, medals: 100 }),
  gun({ id: 'm95', cls: 'sniper', name: 'M95 反器材', desc: '.50 栓动：伤害 ×2、穿 6 只；很重、射速最慢', mul: { damage: 2, rate: 0.45, reload: 1.4, adsTime: 1.25 }, add: { pierce: 3 }, recoil: 1.7, weight: 4, mastery: 4, medals: 115 }),
  // ---- 轻机枪：12 × 11 发/秒、100 发 ----
  gun({ id: 'm249', cls: 'lmg', name: 'M249', desc: '弹链 100 发，压制', mastery: 0, medals: 0 }),
  gun({ id: 'rpk', cls: 'lmg', name: 'RPK', desc: '弹匣供弹：45 发、换弹快一倍、轻、准', mul: { damage: 1.1, rate: 0.85, mag: 0.45, reload: 0.55, spread: 0.75 }, recoil: 0.9, weight: -2.5, mastery: 1, medals: 50 }),
  gun({ id: 'pkm', cls: 'lmg', name: 'PKM', desc: '7.62 通用机枪：单发重、射速慢、后坐大、更重', mul: { damage: 1.35, rate: 0.8 }, recoil: 1.3, weight: 1, mastery: 3, medals: 90 }),
  gun({ id: 'fn_evolys', cls: 'lmg', name: 'EVOLYS', desc: '新一代轻机枪：准、稳、换弹快一些', mul: { damage: 1.1, rate: 1.05, reload: 0.9, spread: 0.85 }, recoil: 0.85, weight: -1, mastery: 5, medals: 130 }),
  gun({ id: 'hk_g3', cls: 'lmg', name: 'G3 班用', desc: '7.62 战斗步枪当火力支援：轻得多、单发重；20 发要常换', mul: { damage: 1.8, rate: 0.5, mag: 0.2, reload: 0.5, spread: 0.7 }, add: { pierce: 1 }, recoil: 1.2, weight: -4, mastery: 1, medals: 50 }),
  gun({ id: 'fn_fal', cls: 'lmg', name: 'FN FAL', desc: '自由世界的右臂：比 G3 射速快一点、弹匣也大一点', mul: { damage: 1.7, rate: 0.55, mag: 0.25, reload: 0.5, spread: 0.75 }, add: { pierce: 1 }, recoil: 1.2, weight: -3.8, mastery: 2, medals: 65 }),
  gun({ id: 'hcar', cls: 'lmg', name: 'H.C.A.R', desc: '.30-06 重型自动步枪：单发最重、穿 2 只；弹匣 30 发', mul: { damage: 2, rate: 0.45, mag: 0.3, reload: 0.6, spread: 0.8 }, add: { pierce: 2 }, recoil: 1.45, weight: -3, mastery: 4, medals: 110 }),
];

export const GUN_BY_ID: Record<string, GunDef> = Object.fromEntries(GUNS.map((g) => [g.id, g]));

export const GUN_CLASSES: GunClass[] = ['pistol', 'smg', 'shotgun', 'rifle', 'sniper', 'lmg'];

export const isGunClass = (k: WeaponKind): k is GunClass => GUN_CLASSES.includes(k);

/** 某一类的型号（第一把是默认） */
export const gunsOf = (k: WeaponKind): GunDef[] => GUNS.filter((g) => g.cls === k);

/** 每一类的默认型号 */
export function defaultGuns(): Record<WeaponKind, string> {
  return { pistol: 'glock_17', smg: 'ump45', shotgun: 'm870', rifle: 'ak12', sniper: 'svd', lmg: 'm249' };
}

/** 这个型号能不能装在这一类上 */
export const gunFits = (k: WeaponKind, id: string): boolean => GUN_BY_ID[id]?.cls === k;

/** 型号倍率作用到一组数值上（直接改 st） */
export function applyGun(st: WeaponStats, g: GunDef | undefined): void {
  if (!g) return;
  const m = g.mul ?? {};
  if (m.damage) st.damage *= m.damage;
  if (m.rate) st.rate *= m.rate;
  if (m.mag) st.mag = Math.max(1, Math.round(st.mag * m.mag));
  if (m.reload) st.reload *= m.reload;
  if (m.spread) st.spread *= m.spread;
  if (m.range) st.range = Math.round(st.range * m.range);
  if (m.adsTime) st.adsTime *= m.adsTime;
  if (g.add?.pellets) st.pellets += g.add.pellets;
  if (g.add?.pierce) st.pierce += g.add.pierce;
}
