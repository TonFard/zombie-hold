import { DIFFICULTY_ORDER, isDifficulty } from '../data/difficulty';
import { META_BY_ID } from '../data/meta-catalog';
import type { Quality } from '../data/quality';
import { WEAPON_ORDER, type WeaponKind } from '../data/weapons';
import { GUN_BY_ID, gunFits } from '../data/guns';
import { FINAL_NIGHT } from '../data/waves';
import { newCodex, type Codex } from '../meta/achievements';
import { newMeta, type MetaState } from '../meta/progress';
import { BENCH_LINES, BENCH_MAX } from '../data/bench';
import { MAP_ORDER, isMapId } from '../world/maps';
import { ZOMBIES } from '../data/zombies';

export const SAVE_KEY = 'zombie-hold-save-v2';
export const SAVE_KEY_V1 = 'zombie-hold-save-v1';
/**
 * 存档纪元：只随存档上传做记录，**不再用来清档**。
 * 以前纪元对不上就整份丢弃重来；现在更新游戏一律保留玩家进度，旧档靠 parseSave 宽松读取、缺的字段补默认值、
 * 认不出的项目忽略。改了存档结构时在 parseSave / parseMeta 里兼容旧字段，不要靠重置。
 */
export const SAVE_EPOCH = 13;

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
  /** 分类音量（M20）：武器 / 僵尸 / 环境 / 界面，0–1 */
  mix: { weapons: number; zombies: number; world: number; ui: number };
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
  mix: { weapons: 1, zombies: 1, world: 1, ui: 1 },
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

/** 分类音量：缺字段 / 坏值都按 1 */
function parseMix(v: unknown): SaveData['mix'] {
  const o = isObj(v) ? v : {};
  const f = (k: string) => (typeof o[k] === 'number' && Number.isFinite(o[k] as number) ? Math.min(1, Math.max(0, o[k] as number)) : 1);
  return { weapons: f('weapons'), zombies: f('zombies'), world: f('world'), ui: f('ui') };
}

/** 删掉的「手枪双持」当时的价格（勋章）：旧存档里买过的退回 */
const DUAL_REFUND = 80;
/** 删掉的榴弹发射器：解锁价（勋章）和武器台每条线 1–3 级的价格（补给，按当时的 benchPrice 算好的） */
const LAUNCHER_UNLOCK_REFUND = 400;
const LAUNCHER_BENCH_PRICES = [75, 130, 220];

/** 旧存档里已经删掉的东西退回多少：勋章（双持、榴弹解锁）和补给（榴弹的武器台强化） */
function goneRefund(v: Record<string, unknown>): { medals: number; supplies: number } {
  const lv = isObj(v.levels) ? v.levels : {};
  const has = (id: string) => typeof lv[id] === 'number' && (lv[id] as number) > 0;
  const medals = (has('dual') ? DUAL_REFUND : 0) + (has('unlock-launcher') ? LAUNCHER_UNLOCK_REFUND : 0);
  let supplies = 0;
  if (isObj(v.bench)) {
    for (const [key, n] of Object.entries(v.bench)) {
      if (!key.startsWith('launcher.') || typeof n !== 'number' || !Number.isInteger(n)) continue;
      for (let i = 0; i < Math.min(n, LAUNCHER_BENCH_PRICES.length); i++) supplies += LAUNCHER_BENCH_PRICES[i] as number;
    }
  }
  return { medals, supplies };
}

function parseMeta(v: unknown): MetaState {
  if (!isObj(v)) throw new SaveError('meta 缺失');
  const levels: Record<string, number> = {};
  if (!isObj(v.levels)) throw new SaveError('meta.levels 缺失');
  for (const [id, lv] of Object.entries(v.levels)) {
    const item = META_BY_ID[id];
    if (!item) continue; // 旧版本里有、新版本删掉的项目：忽略（不能因为一个认不出的项目丢掉整份存档）
    if (typeof lv !== 'number' || !Number.isFinite(lv)) continue;
    // 级数超过现在的上限（项目被砍过级）：按上限算，不丢档
    const n = Math.min(item.prices.length, Math.floor(lv));
    if (n > 0) levels[id] = n;
  }
  if (!Array.isArray(v.cleared)) throw new SaveError('meta.cleared 不合法');
  // 上次出征选的东西只是个记忆：认不出（旧版本的难度名、没了的武器）就回到默认
  const side = v.lastSidearm;
  // 删掉的「手枪双持」和榴弹发射器：买过的退回勋章 / 补给
  const refund = goneRefund(v);
  const supply = parseSupply(v);
  return {
    medals: num(v, 'medals', 0, 1e7, true) + refund.medals,
    medalsEarned: num(v, 'medalsEarned', 0, 1e8, true),
    levels,
    cleared: DIFFICULTY_ORDER.filter((d) => (v.cleared as unknown[]).includes(d)),
    lastDifficulty: isDifficulty(v.lastDifficulty) ? v.lastDifficulty : 'normal',
    lastSidearm: typeof side === 'string' && (WEAPON_ORDER as string[]).includes(side) ? (side as WeaponKind) : null,
    ...supply,
    supplies: Math.min(1e8, supply.supplies + refund.supplies),
  };
}

/** 补给 / 库存子弹 / 工作台 / 章节：缺省时按新档处理（旧存档升级上来） */
function parseSupply(v: Record<string, unknown>): Pick<MetaState, 'supplies' | 'ammo' | 'bench' | 'chapters' | 'lastChapter' | 'mastery' | 'guns' | 'gunPick'> {
  // 枪械型号：未知的 id、默认型号（不用解锁）、选了别的类的型号都丢掉
  const guns = Array.isArray(v.guns) ? [...new Set(v.guns.filter((id): id is string => typeof id === 'string' && (GUN_BY_ID[id]?.medals ?? 0) > 0))] : [];
  const gunPick: Partial<Record<WeaponKind, string>> = {};
  if (isObj(v.gunPick)) {
    for (const k of WEAPON_ORDER) {
      const id = v.gunPick[k];
      if (typeof id === 'string' && gunFits(k, id)) gunPick[k] = id;
    }
  }
  const mastery: Partial<Record<WeaponKind, number>> = {};
  if (isObj(v.mastery)) {
    for (const k of WEAPON_ORDER) {
      const n = v.mastery[k];
      if (typeof n === 'number' && Number.isFinite(n) && n > 0) mastery[k] = Math.min(1e7, Math.floor(n));
    }
  }
  const ammo: Partial<Record<WeaponKind, number>> = {};
  if (isObj(v.ammo)) {
    for (const k of WEAPON_ORDER) {
      const n = v.ammo[k];
      if (typeof n === 'number' && Number.isFinite(n) && n > 0) ammo[k] = Math.min(1e7, Math.floor(n));
    }
  }
  const bench: Record<string, number> = {};
  if (isObj(v.bench)) {
    for (const [key, lv] of Object.entries(v.bench)) {
      const [k, line] = key.split('.');
      if (!(WEAPON_ORDER as string[]).includes(k ?? '') || !(BENCH_LINES as string[]).includes(line ?? '')) continue;
      if (typeof lv === 'number' && Number.isInteger(lv) && lv > 0) bench[key] = Math.min(BENCH_MAX, lv);
    }
  }
  const chapters = Array.isArray(v.chapters) ? MAP_ORDER.filter((c) => (v.chapters as unknown[]).includes(c)) : [];
  return {
    supplies: typeof v.supplies === 'number' && Number.isFinite(v.supplies) && v.supplies >= 0 ? Math.min(1e8, Math.floor(v.supplies)) : 60,
    ammo,
    bench,
    chapters,
    lastChapter: isMapId(v.lastChapter) ? v.lastChapter : 'outpost',
    mastery,
    guns,
    gunPick,
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
    mix: parseMix(v.mix),
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
