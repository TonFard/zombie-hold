import { MASTERY_MAX, MASTERY_XP } from './mastery';
import { WEAPON_ORDER, type WeaponKind } from './weapons';

/**
 * 升星：熟练度精通之后继续用这把枪杀怪，经验继续累计，到门槛给一颗星（最多 3 颗）。
 * 每颗星是一个**特性**，不是纯数值加成——后期不会数值爆炸，玩家也愿意为了某个手感去练某把枪。
 *
 * 星级在出征时冻结进 config.stars（和武器台一样），局内读 g.config.stars[k]。
 * 特性的数值都在 STAR_FX 里，逻辑层按"这把枪几星"查。
 */
export const STAR_MAX = 3;

/** 精通之后再要多少经验（相对精通门槛的倍数）：★1 0.6、★2 1.4、★3 2.4 */
const STAR_K = [0.6, 1.4, 2.4];

/** 某把枪拿到第 n 颗星（1–3）要的累计经验 */
export const starXp = (k: WeaponKind, n: number): number => {
  const master = MASTERY_XP[k][MASTERY_MAX - 1] as number;
  return Math.round(master * (1 + (STAR_K[n - 1] ?? 0)));
};

/** 累计经验 → 星级（0–3）；没精通就是 0 */
export function starsOf(k: WeaponKind, xp: number): number {
  let n = 0;
  while (n < STAR_MAX && xp >= starXp(k, n + 1)) n++;
  return n;
}

export const starLevels = (xp: Partial<Record<WeaponKind, number>>): Record<WeaponKind, number> =>
  Object.fromEntries(WEAPON_ORDER.map((k) => [k, starsOf(k, xp[k] ?? 0)])) as Record<WeaponKind, number>;

/**
 * 每把枪三颗星的说明（界面用）。和最初的方案（PLAN.md M16）相比改了四条，原因都是"原效果在现有机制里不存在"：
 * 步枪 ★1「穿透后不衰减」→ 爆头 +20%（现在穿透本来就不衰减）；榴弹发射器整把删了；
 * 霰弹 ★1「多 2 颗弹丸」→ 3 米内伤害再 +20%（弹丸在开火时就定了，没法按距离加）；手枪 ★3 原来是双持换弹再快，双持删了以后改成爆头伤害 +25%
 */
export const STAR_TEXT: Record<WeaponKind, [string, string, string]> = {
  pistol: ['爆头击杀返还 1 发', '换弹时间 −25%', '爆头伤害 +25%'],
  smg: ['换弹后 2 秒射速 +15%', '移动中散布 −30%', '连杀 ≥ 5 时伤害 +10%'],
  shotgun: ['3 米内伤害再 +20%', '击退 +50%', '击杀让周围 2 米的僵尸硬直 0.5 秒'],
  rifle: ['爆头伤害 +20%', '举镜时间 −30%', '连续命中同一目标逐发 +3%（最多 +30%）'],
  sniper: ['首领弱点伤害 +25%', '爆头击杀再返还 1 发', '穿透 +1'],
  lmg: ['持续开火 2 秒后散布 −40%', '命中减速 +15%', '弹链最后 20 发伤害 +20%'],
};

/** 特性的数值（逻辑层用） */
export const STAR_FX = {
  pistolRefund: 1,
  pistolReload: 0.75,
  pistolHead: 1.25,
  smgBurst: { time: 2, rate: 1.15 },
  smgMoveSpread: 0.7,
  smgCombo: { combo: 5, damage: 1.1 },
  shotgunClose: 1.2,
  shotgunKnock: 1.5,
  shotgunStun: { radius: 2, time: 0.5 },
  rifleHead: 1.2,
  rifleAds: 0.7,
  rifleFocus: { step: 0.03, max: 0.3 },
  sniperCore: 1.25,
  sniperRefund: 1,
  sniperPierce: 1,
  lmgSustainSpread: 0.6,
  lmgSlow: 0.15,
  lmgTail: { last: 20, damage: 1.2 },
} as const;

/** 星级颜色：普通白、★ 蓝、★★ 紫、★★★ 金 */
export const STAR_COLOR = ['#d8dee4', '#6fd0e8', '#b48cf0', '#f0b83a'];
// 配色（M20）：和 style.css 的 --hud-cyan / --hud-accent 一致；紫色只给 ★★ 用
