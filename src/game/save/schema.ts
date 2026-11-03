import { DIFFICULTY_ORDER, isDifficulty } from '../data/difficulty';
import { META_BY_ID } from '../data/meta-catalog';
import type { Quality } from '../data/quality';
import { WEAPON_ORDER, type WeaponKind } from '../data/weapons';
import { FINAL_NIGHT } from '../data/waves';
import { newCodex, type Codex } from '../meta/achievements';
import { newMeta, type MetaState } from '../meta/progress';
import { ZOMBIES } from '../data/zombies';

export const SAVE_KEY = 'zombie-hold-save-v2';
export const SAVE_KEY_V1 = 'zombie-hold-save-v1';
/** 存档纪元：记在单独的键里。和这里的值不一样时清掉进度重新开始（只保留音量、画质、灵敏度） */
export const EPOCH_KEY = 'zombie-hold-epoch';
/** 每次更新游戏都把它加一：玩家打开新版本时进度全部重置 */
export const SAVE_EPOCH = 2;

/** 跨局存档：统计、设置、局外进度 */
export interface SaveData {
  version: 2;
  bestNight: number;
  bestKills: number;
  wins: number;
  runs: number;
  totalKills: number;
  totalHeadshots: number;
  /** 最快通关用时（秒），0 = 还没通关过 */
  bestWinTime: number;
  volume: number;
  quality: Quality;
  /** 鼠标灵敏度倍率 */
  sensitivity: number;
  meta: MetaState;
  /** 图鉴、成就、每日挑战成绩（M13；旧存档没有时为空） */
  codex: Codex;
}

export const defaultSave = (): SaveData => ({
  version: 2,
  bestNight: 0,
  bestKills: 0,
  wins: 0,
  runs: 0,
  totalKills: 0,
  totalHeadshots: 0,
  bestWinTime: 0,
  volume: 0.8,
  quality: 'high',
  sensitivity: 1,
  meta: newMeta(),
  codex: newCodex(),
});

// ---------------------------------------------------------------- 校验

/** 校验失败：带上原因，调用方记 console.warn 并提示玩家 */
export class SaveError extends Error {}

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function num(o: Record<string, unknown>, key: string, min: number, max: number, int = false): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new SaveError(`${key} 不是数字`);
  if (v < min || v > max) throw new SaveError(`${key} 越界（${v}）`);
  if (int && !Number.isInteger(v)) throw new SaveError(`${key} 不是整数`);
  return v;
}

export function bool(o: Record<string, unknown>, key: string): boolean {
  const v = o[key];
  if (typeof v !== 'boolean') throw new SaveError(`${key} 不是布尔值`);
  return v;
}

export function oneOf<T extends string>(o: Record<string, unknown>, key: string, allowed: readonly T[]): T {
  const v = o[key];
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) throw new SaveError(`${key} 取值不合法`);
  return v as T;
}

export const isQuality = (v: unknown): v is Quality => v === 'low' || v === 'mid' || v === 'high';

function parseMeta(v: unknown): MetaState {
  if (!isObj(v)) throw new SaveError('meta 缺失');
  const levels: Record<string, number> = {};
  if (!isObj(v.levels)) throw new SaveError('meta.levels 缺失');
  for (const [id, lv] of Object.entries(v.levels)) {
    const item = META_BY_ID[id];
    if (!item) continue; // 旧版本里有、新版本删掉的项目：忽略
    if (typeof lv !== 'number' || !Number.isInteger(lv) || lv < 0 || lv > item.prices.length) throw new SaveError(`meta.levels.${id} 越界`);
    if (lv > 0) levels[id] = lv;
  }
  if (!Array.isArray(v.cleared) || !v.cleared.every(isDifficulty)) throw new SaveError('meta.cleared 不合法');
  const side = v.lastSidearm;
  if (side !== null && !(typeof side === 'string' && (WEAPON_ORDER as string[]).includes(side))) throw new SaveError('meta.lastSidearm 不合法');
  return {
    medals: num(v, 'medals', 0, 1e7, true),
    medalsEarned: num(v, 'medalsEarned', 0, 1e8, true),
    levels,
    cleared: DIFFICULTY_ORDER.filter((d) => (v.cleared as unknown[]).includes(d)),
    lastDifficulty: oneOf(v, 'lastDifficulty', DIFFICULTY_ORDER),
    lastSidearm: side as WeaponKind | null,
  };
}

function parseCodex(v: unknown): Codex {
  if (v === undefined) return newCodex();
  if (!isObj(v) || !isObj(v.kills) || !Array.isArray(v.done) || !isObj(v.daily)) throw new SaveError('codex 不合法');
  const kills: Codex['kills'] = {};
  for (const [k, n] of Object.entries(v.kills)) {
    if (!(k in ZOMBIES)) continue;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 1e9) throw new SaveError(`codex.kills.${k} 越界`);
    kills[k as keyof typeof ZOMBIES] = n;
  }
  const daily: Record<string, number> = {};
  for (const [k, n] of Object.entries(v.daily)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 999) throw new SaveError('codex.daily 不合法');
    daily[k] = n;
  }
  const ch = v.challenges ?? 0;
  if (typeof ch !== 'number' || !Number.isInteger(ch) || ch < 0 || ch > 1e7) throw new SaveError('codex.challenges 越界');
  return { kills, done: v.done.filter((x): x is string => typeof x === 'string'), daily, challenges: ch };
}

/** 校验并规范化一份 v2 存档；不合法时抛 SaveError */
export function parseSave(v: unknown): SaveData {
  if (!isObj(v)) throw new SaveError('不是对象');
  if (v.version !== 2) throw new SaveError(`版本号不对（${String(v.version)}）`);
  if (!isQuality(v.quality)) throw new SaveError('quality 取值不合法');
  return {
    version: 2,
    bestNight: num(v, 'bestNight', 0, FINAL_NIGHT, true),
    bestKills: num(v, 'bestKills', 0, 1e7, true),
    wins: num(v, 'wins', 0, 1e7, true),
    runs: num(v, 'runs', 0, 1e7, true),
    totalKills: num(v, 'totalKills', 0, 1e9, true),
    totalHeadshots: num(v, 'totalHeadshots', 0, 1e9, true),
    bestWinTime: num(v, 'bestWinTime', 0, 1e7),
    volume: num(v, 'volume', 0, 1),
    quality: v.quality,
    sensitivity: num(v, 'sensitivity', 0.2, 3),
    meta: parseMeta(v.meta),
    codex: parseCodex(v.codex),
  };
}

// ---------------------------------------------------------------- 统计

export interface RunSummary {
  won: boolean;
  night: number;
  kills: number;
  headshotKills: number;
  time: number;
}

/** 一局结束后更新统计，返回 [新存档, 是否刷新了最高夜数]（局外勋章另由 meta/progress 的 settleRun 结算） */
export function recordRun(s: SaveData, r: RunSummary): [SaveData, boolean] {
  const next: SaveData = { ...s, runs: s.runs + 1, totalKills: s.totalKills + r.kills, totalHeadshots: s.totalHeadshots + r.headshotKills };
  const reached = r.won ? FINAL_NIGHT : r.night;
  const newBest = reached > s.bestNight;
  if (newBest) next.bestNight = reached;
  if (r.kills > s.bestKills) next.bestKills = r.kills;
  if (r.won) {
    next.wins = s.wins + 1;
    if (s.bestWinTime === 0 || r.time < s.bestWinTime) next.bestWinTime = Math.round(r.time);
  }
  return [next, newBest];
}
