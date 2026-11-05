import { NO_MOD, WEAPON_ORDER, WEAPONS, type WeaponKind, type WeaponMod } from './weapons';

/**
 * 武器工作台（大厅）：每把枪一张台子，四条强化线各 3 级，花「补给」。
 * 和局内工坊的升级（零件，每局清零）不同，这里的强化永久生效、每一局都带着。
 */
export type BenchLine = 'damage' | 'recoil' | 'lighter' | 'mag';

export const BENCH_LINES: BenchLine[] = ['damage', 'recoil', 'lighter', 'mag'];

export const BENCH_NAME: Record<BenchLine, string> = { damage: '弹药改装', recoil: '制退器', lighter: '轻量化', mag: '扩容' };

/** 每一级的效果 */
const STEP: Record<BenchLine, number> = { damage: 0.06, recoil: 0.12, lighter: 0, mag: 0.12 };

export const BENCH_MAX = 3;

/** 每把枪每条线 1–3 级的价格（补给）：越贵的枪越贵 */
export function benchPrice(k: WeaponKind, lv: number): number {
  const base = k === 'pistol' ? 30 : 30 + WEAPONS[k].price / 20;
  const k2 = [1, 1.8, 3][lv] ?? 3;
  return Math.round((base * k2) / 5) * 5;
}

/** 减重：每级减掉 12% 的重量（手枪本来就轻，每级 0.1 千克） */
const lighterPerLevel = (k: WeaponKind) => (k === 'pistol' ? 0.1 : Math.round(WEAPONS[k].weight * 0.12 * 10) / 10);

export const benchKey = (k: WeaponKind, line: BenchLine) => `${k}.${line}`;

/** 某一条线到 lv 级时的描述 */
export function benchDesc(k: WeaponKind, line: BenchLine, lv: number): string {
  if (lv <= 0) return '—';
  switch (line) {
    case 'damage':
      return `伤害 +${Math.round(STEP.damage * lv * 100)}%`;
    case 'recoil':
      return `后坐力 −${Math.round(STEP.recoil * lv * 100)}%`;
    case 'lighter':
      return `重量 −${(lighterPerLevel(k) * lv).toFixed(1)} 千克`;
    case 'mag':
      return `弹匣 +${Math.round(STEP.mag * lv * 100)}%`;
  }
}

/** 存档里的等级表 → 每把枪的强化倍率 */
export function benchMods(levels: Record<string, number>): Record<WeaponKind, WeaponMod> {
  const out = {} as Record<WeaponKind, WeaponMod>;
  for (const k of WEAPON_ORDER) {
    const lv = (line: BenchLine) => Math.max(0, Math.min(BENCH_MAX, levels[benchKey(k, line)] ?? 0));
    out[k] = {
      ...NO_MOD,
      damage: 1 + STEP.damage * lv('damage'),
      recoil: 1 - STEP.recoil * lv('recoil'),
      lighter: lighterPerLevel(k) * lv('lighter'),
      mag: 1 + STEP.mag * lv('mag'),
    };
  }
  return out;
}
