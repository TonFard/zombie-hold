import { NIGHT_MOD_ORDER, type NightModId } from '../data/modifiers';
import type { ZombieKind } from '../data/zombies';

/**
 * 图鉴和成就（M13）：图鉴记录见过（击杀过）的僵尸；成就按跨局统计判定，达成一次给勋章。
 * 进度存在存档 v2 的 codex 字段里；旧存档没有这个字段时按空的处理。
 */
export interface Codex {
  /** 每种僵尸的累计击杀 */
  kills: Partial<Record<ZombieKind, number>>;
  /** 已达成的成就 id */
  done: string[];
  /** 每日挑战：日期（YYYY-MM-DD）→ 最远夜数 */
  daily: Record<string, number>;
  /** 累计完成的夜间挑战 */
  challenges: number;
}

export const newCodex = (): Codex => ({ kills: {}, done: [], daily: {}, challenges: 0 });

/** 一局结束时用来判定成就的数据 */
export interface AchvInput {
  totalKills: number;
  totalHeadshots: number;
  wins: number;
  bestNight: number;
  clearedHard: boolean;
  clearedNightmare: boolean;
  bestCombo: number;
  challenges: number;
  codex: Codex;
}

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  medals: number;
  test(a: AchvInput): boolean;
}

const seenAll = (c: Codex, kinds: ZombieKind[]): boolean => kinds.every((k) => (c.kills[k] ?? 0) > 0);

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'kills-100', name: '初出茅庐', desc: '累计击杀 100', medals: 10, test: (a) => a.totalKills >= 100 },
  { id: 'kills-1000', name: '尸山', desc: '累计击杀 1000', medals: 30, test: (a) => a.totalKills >= 1000 },
  { id: 'kills-5000', name: '尸海', desc: '累计击杀 5000', medals: 60, test: (a) => a.totalKills >= 5000 },
  { id: 'head-100', name: '眼疾手快', desc: '累计爆头击杀 100', medals: 15, test: (a) => a.totalHeadshots >= 100 },
  { id: 'head-1000', name: '一枪一个', desc: '累计爆头击杀 1000', medals: 50, test: (a) => a.totalHeadshots >= 1000 },
  { id: 'night-5', name: '首领杀手', desc: '撑过第 5 夜', medals: 15, test: (a) => a.bestNight >= 5 },
  { id: 'win', name: '守住了', desc: '通关一次', medals: 30, test: (a) => a.wins >= 1 },
  { id: 'win-hard', name: '老兵', desc: '通关困难', medals: 50, test: (a) => a.clearedHard },
  { id: 'win-nightmare', name: '噩梦终结者', desc: '通关噩梦', medals: 100, test: (a) => a.clearedNightmare },
  { id: 'endless-15', name: '无尽之夜', desc: '无尽模式撑过第 15 夜', medals: 60, test: (a) => a.bestNight >= 15 },
  { id: 'combo-15', name: '收割机', desc: '一局里打出 15 连杀', medals: 20, test: (a) => a.bestCombo >= 15 },
  { id: 'challenges-10', name: '挑战者', desc: '累计完成 10 个夜间挑战', medals: 25, test: (a) => a.challenges >= 10 },
  { id: 'codex', name: '博物学家', desc: '图鉴里集齐全部 7 种僵尸', medals: 30, test: (a) => seenAll(a.codex, ['walker', 'runner', 'bloater', 'breaker', 'colossus', 'spitter', 'screamer']) },
];

/** 新达成的成就（不含已经达成过的） */
export function newlyDone(a: AchvInput): Achievement[] {
  return ACHIEVEMENTS.filter((x) => !a.codex.done.includes(x.id) && x.test(a));
}

// ---------------------------------------------------------------- 每日挑战

/** 当天的日期串（本地时区） */
export const todayKey = (d = new Date()): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 每日挑战：固定种子 + 固定词缀 + 固定限制（只能用一把武器），同一天大家打的是同一局 */
export interface Daily {
  key: string;
  seed: number;
  mod: NightModId;
  /** 限定武器：只能用这一把（开局就给，工坊里买不了别的） */
  weapon: 'pistol' | 'smg' | 'shotgun' | 'rifle';
}

export function dailyFor(key: string): Daily {
  // 日期串的简单散列
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
  const weapons = ['pistol', 'smg', 'shotgun', 'rifle'] as const;
  return { key, seed: h & 0xffff, mod: NIGHT_MOD_ORDER[h % NIGHT_MOD_ORDER.length] as NightModId, weapon: weapons[(h >>> 8) % weapons.length] as Daily['weapon'] };
}
