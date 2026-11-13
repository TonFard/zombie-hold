import type { ZombieKind } from './zombies';

export const FINAL_NIGHT = 10;
/** 第一个白天长一点，让玩家有时间熟悉操作 */
export const DAY_FIRST = 60;
export const DAY_LEN = 45;
/** 同屏僵尸上限（性能预算） */
export const ALIVE_CAP = 70;

/** 第 n 夜的普通僵尸总数。第 1 夜是教学夜，只有 12 只 */
export function nightCount(n: number): number {
  if (n <= 1) return 12;
  return Math.round(12 + 5.5 * n + 0.35 * n * n);
}

/** 开局赠送的零件：够买几个路障或者一级武器升级 */
export const START_SCRAP = 120;

/** 生命系数 */
export function hpScale(n: number): number {
  return 1 + 0.1 * (n - 1);
}

/** 每一批刷多少只 / 隔多久刷一批（秒） */
export function batchSize(n: number): number {
  return 4 + Math.floor(n / 2);
}
export function batchInterval(n: number): number {
  return Math.max(3.2, 5.2 - 0.2 * n);
}

/** 按夜数加权随机一种普通僵尸；r 是 [0,1) 的随机数 */
export function pickKind(n: number, r: number): ZombieKind {
  const runner = n >= 2 ? Math.min(0.08 + (n - 2) * 0.04, 0.3) : 0;
  const bloater = n >= 3 ? Math.min(0.05 + (n - 3) * 0.02, 0.15) : 0;
  const breaker = n >= 4 ? Math.min(0.05 + (n - 4) * 0.025, 0.2) : 0;
  if (r < bloater) return 'bloater';
  if (r < bloater + breaker) return 'breaker';
  if (r < bloater + breaker + runner) return 'runner';
  return 'walker';
}

export interface Boss {
  kind: ZombieKind;
  hpScale: number;
  escorts: number;
  /** 护卫轮流出这两种 */
  escort: [ZombieKind, ZombieKind];
  title: string;
}

/** 每张地图的首领和它的护卫（顺序 = 战役顺序，无尽模式从本章开始轮换） */
export const MAP_BOSSES: Array<{ map: string; kind: ZombieKind; name: string; escort: [ZombieKind, ZombieKind] }> = [
  { map: 'outpost', kind: 'colossus', name: '巨像', escort: ['breaker', 'bloater'] },
  { map: 'farmland', kind: 'reaper', name: '收割者', escort: ['runner', 'leaper'] },
  { map: 'lakeside', kind: 'brood', name: '母巢', escort: ['bloater', 'spitter'] },
  { map: 'city', kind: 'siren', name: '哀嚎女王', escort: ['screamer', 'armored'] },
];

/** 第 5、10 夜有首领（哪一个看地图）；无尽模式里每 5 夜一个，四个首领轮着来，越来越硬 */
export function bossFor(n: number, map = 'outpost'): Boss | null {
  const at = Math.max(0, MAP_BOSSES.findIndex((b) => b.map === map));
  if (n === 5 || n === 10) {
    const b = MAP_BOSSES[at]!;
    return n === 5 ? { kind: b.kind, hpScale: 1, escorts: 4, escort: b.escort, title: `${b.name}·初现` } : { kind: b.kind, hpScale: 6500 / 2400, escorts: 8, escort: b.escort, title: `${b.name}·终焉` };
  }
  if (n > 10 && n % 5 === 0) {
    const k = (n - 10) / 5;
    const b = MAP_BOSSES[(at + k) % MAP_BOSSES.length]!;
    return { kind: b.kind, hpScale: (6500 / 2400) * (1 + 0.35 * k), escorts: Math.min(16, 8 + k * 2), escort: b.escort, title: `${b.name}·第 ${n} 夜` };
  }
  return null;
}

/** 夜晚清空后的奖励零件 */
export function nightBonus(n: number): number {
  return 40 + 20 * n;
}
