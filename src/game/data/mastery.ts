import { WEAPON_ORDER, type WeaponKind } from './weapons';

/**
 * 武器熟练度：用哪把枪打死僵尸，就涨哪把枪的经验（爆头击杀算两份）。熟练度跨局永久保留。
 *
 * 它是武器成长的主线——不能再用勋章直接跳过：
 * - 熟练度决定局内工坊能把这把枪升到几级（等级上限 5 → 8）
 * - 熟练度决定大厅武器台的强化能买到几级（1 → 3）
 * - 熟练度满（精通）才能解锁下一把枪（军械库里还要花勋章）
 *
 * 数值由 npm run sim:progress 校准：普通玩家手枪大约打 4–5 局精通，之后每把枪 4–6 局
 */
export const MASTERY_MAX = 5;

/** 每把枪升到 1–5 级要的累计经验（越后面的枪，每局击杀越多，门槛也越高） */
export const MASTERY_XP: Record<WeaponKind, number[]> = {
  pistol: [50, 120, 220, 350, 500],
  // 680 → 640：没有「随身武器」后冲锋枪要自己买、要晚几局才开始练，门槛跟着压一点。
  // 560 → 470：僵尸不再互相重叠以后人堆散一些，扫射每局击杀少了，机器人要 8 局才精通（sim:progress 每局约 80 经验）
  smg: [60, 145, 265, 400, 470],
  // 霰弹枪每局经验最少（sim:progress 约 38），门槛压低；机器人现在会贴到 5 米内打
  shotgun: [30, 70, 120, 180, 260],
  // 1300 → 1200：突击步枪每局约 155 经验。1000 → 900：第 4–5 夜起加了跳跃者 / 毒雾者 / 裂殖者，每局击杀变少
  rifle: [120, 270, 470, 700, 900],
  sniper: [50, 120, 220, 350, 500],
  // 880 → 700（M17）：后期加了爬行者、重装感染者，每局击杀变少（sim:progress 每局约 98 经验）
  lmg: [70, 180, 320, 500, 700],
};

/** 一次击杀给多少经验 */
export const xpFor = (kills: number, headshotKills: number): number => kills + headshotKills;

/** 累计经验对应的熟练度等级（0–5） */
export function masteryLevel(k: WeaponKind, xp: number): number {
  const t = MASTERY_XP[k];
  let lv = 0;
  while (lv < MASTERY_MAX && xp >= (t[lv] as number)) lv++;
  return lv;
}

/** 当前等级的进度：[本级起点, 下一级门槛]；满级时下一级为 null */
export function masteryProgress(k: WeaponKind, xp: number): { lv: number; from: number; to: number | null } {
  const lv = masteryLevel(k, xp);
  const t = MASTERY_XP[k];
  return { lv, from: lv > 0 ? (t[lv - 1] as number) : 0, to: lv < MASTERY_MAX ? (t[lv] as number) : null };
}

/** 熟练度 → 局内等级上限：2 级 6、4 级 7、精通 8 */
export const masteryTierCap = (lv: number): number => 5 + (lv >= 2 ? 1 : 0) + (lv >= 4 ? 1 : 0) + (lv >= 5 ? 1 : 0);

/** 熟练度 → 武器台每条强化线最多几级：1 级开 1、3 级开 2、精通开 3 */
export const masteryBenchCap = (lv: number): number => (lv >= 5 ? 3 : lv >= 3 ? 2 : lv >= 1 ? 1 : 0);

/** 每一级的奖励（界面用） */
export const MASTERY_PERKS: string[] = ['武器台强化 1 级', '局内等级上限 6', '武器台强化 2 级', '局内等级上限 7', '精通：等级上限 8、强化 3 级、可解锁下一把枪'];

/** 熟练度等级要求出现在哪一级奖励里：给「武器台第 lv 级要熟练度几级」用 */
export const benchNeeds = (benchLv: number): number => (benchLv <= 0 ? 1 : benchLv === 1 ? 3 : 5);

/** 存档里的经验表 → 每把枪的熟练度等级 */
export function masteryLevels(xp: Partial<Record<WeaponKind, number>>): Record<WeaponKind, number> {
  const out = {} as Record<WeaponKind, number>;
  for (const k of WEAPON_ORDER) out[k] = masteryLevel(k, xp[k] ?? 0);
  return out;
}
