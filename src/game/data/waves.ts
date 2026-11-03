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
  title: string;
}

/** 第 5、10 夜有首领；无尽模式里每 5 夜一个，越来越硬 */
export function bossFor(n: number): Boss | null {
  if (n === 5) return { kind: 'colossus', hpScale: 1, escorts: 4, title: '巨像·初代' };
  if (n === 10) return { kind: 'colossus', hpScale: 6500 / 2400, escorts: 8, title: '巨像·终焉' };
  if (n > 10 && n % 5 === 0) return { kind: 'colossus', hpScale: (6500 / 2400) * (1 + 0.35 * ((n - 10) / 5)), escorts: Math.min(16, 8 + (n - 10) / 5 * 2), title: `巨像·第 ${n} 夜` };
  return null;
}

/** 夜晚清空后的奖励零件 */
export function nightBonus(n: number): number {
  return 40 + 20 * n;
}
