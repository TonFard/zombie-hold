import { DIFFICULTIES, DIFFICULTY_ORDER, type Difficulty } from '../data/difficulty';
import { META_BY_ID, META_ITEMS, baseBonuses, rankFor, rankOf, type MetaBonuses, type MetaItem } from '../data/meta-catalog';
import { WEAPONS, type WeaponKind } from '../data/weapons';
import type { MapId } from '../world/maps';
import { CHAPTER_BY_ID } from '../data/chapters';
import { BENCH_MAX, benchKey, benchPrice, type BenchLine } from '../data/bench';
import { CHALLENGE_MEDALS } from '../data/modifiers';
import { FINAL_NIGHT } from '../data/waves';

/** 局外进度：存档 v2 的一部分 */
export interface MetaState {
  medals: number;
  /** 累计获得的勋章（统计用） */
  medalsEarned: number;
  /** 已买的项目及级数 */
  levels: Record<string, number>;
  /** 通关过的难度 */
  cleared: Difficulty[];
  /** 上次出征选的难度和随身武器 */
  lastDifficulty: Difficulty;
  lastSidearm: WeaponKind | null;
  /** 补给点：买子弹、工作台强化用（和勋章分开，每局都按表现结算） */
  supplies: number;
  /** 库存子弹（手枪无限，不记）。出征时整份带进去，打剩下的结算时退回 */
  ammo: Partial<Record<WeaponKind, number>>;
  /** 工作台强化等级：「武器.强化线」→ 级数 */
  bench: Record<string, number>;
  /** 通关过的章节 */
  chapters: MapId[];
  /** 上次选的章节 */
  lastChapter: MapId;
}

export const newMeta = (): MetaState => ({ medals: 0, medalsEarned: 0, levels: {}, cleared: [], lastDifficulty: 'normal', lastSidearm: null, supplies: 60, ammo: {}, bench: {}, chapters: [], lastChapter: 'outpost' });

// ---------------------------------------------------------------- 勋章结算

export interface RunOutcome {
  difficulty: Difficulty;
  /** 撑过的夜数（0–10） */
  nights: number;
  won: boolean;
  kills: number;
  headshotKills: number;
  /** 完成的夜间挑战数（M12） */
  challenges?: number;
  /** 哪一章（勋章、补给按章节倍率；缺省第一章） */
  chapter?: MapId;
}

export interface MedalBreakdown {
  nights: number;
  bosses: number;
  kills: number;
  headshots: number;
  win: number;
  challenges: number;
  /** 乘难度倍率之前的合计 */
  base: number;
  mult: number;
  total: number;
}

/** 撑过第 n 夜得 4 + 2n；第 5 / 10 夜首领 15 / 30；每 25 击杀 1；每 10 爆头击杀 1；通关 40；最后乘难度倍率 */
export function medalsFor(o: RunOutcome): MedalBreakdown {
  // 无尽模式：第 10 夜以后每夜按第 10 夜的价格算（26），每个首领 30
  const n = Math.max(0, Math.min(FINAL_NIGHT, Math.floor(o.nights)));
  const extra = Math.max(0, Math.floor(o.nights) - FINAL_NIGHT);
  const nights = 4 * n + n * (n + 1) + extra * (4 + 2 * FINAL_NIGHT);
  const bosses = (n >= 5 ? 15 : 0) + (n >= 10 ? 30 : 0) + Math.floor(extra / 5) * 30;
  const kills = Math.floor(o.kills / 25);
  const headshots = Math.floor(o.headshotKills / 10);
  const win = o.won ? 40 : 0;
  const challenges = (o.challenges ?? 0) * CHALLENGE_MEDALS;
  const base = nights + bosses + kills + headshots + win + challenges;
  const mult = DIFFICULTIES[o.difficulty].medals * (o.chapter ? CHAPTER_BY_ID[o.chapter].medals : 1);
  return { nights, bosses, kills, headshots, win, challenges, base, mult, total: Math.round(base * mult) };
}

/**
 * 补给点：每撑过一夜 6 + 2n，每 10 击杀 1，通关 50，乘章节倍率。
 * 大约够每局把主力枪的子弹补满，余下的慢慢攒工作台强化
 */
export function suppliesFor(o: RunOutcome): number {
  const n = Math.max(0, Math.floor(o.nights));
  const base = 6 * n + n * (n + 1) + Math.floor(o.kills / 10) + (o.won ? 50 : 0);
  return Math.round(base * (o.chapter ? CHAPTER_BY_ID[o.chapter].medals : 1));
}

/** 一局结束：加勋章和补给，通关就记下这个难度和章节。返回新状态和明细（不修改传入的对象） */
export function settleRun(m: MetaState, o: RunOutcome): [MetaState, MedalBreakdown] {
  const b = medalsFor(o);
  const next: MetaState = { ...cloneMeta(m), medals: m.medals + b.total, medalsEarned: m.medalsEarned + b.total, supplies: m.supplies + suppliesFor(o) };
  if (o.won && !next.cleared.includes(o.difficulty)) next.cleared.push(o.difficulty);
  if (o.won && o.chapter && !next.chapters.includes(o.chapter)) next.chapters.push(o.chapter);
  return [next, b];
}

export const cloneMeta = (m: MetaState): MetaState => ({ ...m, levels: { ...m.levels }, cleared: [...m.cleared], ammo: { ...m.ammo }, bench: { ...m.bench }, chapters: [...m.chapters] });

// ---------------------------------------------------------------- 补给：子弹和工作台

/** 买一份子弹（WEAPONS[k].ammo.pack 发）：返回新状态，补给不够 / 手枪返回 null */
export function buyAmmo(m: MetaState, k: WeaponKind, packs = 1): MetaState | null {
  const a = WEAPONS[k].ammo;
  if (!a || packs <= 0) return null;
  const cost = a.price * packs;
  if (m.supplies < cost) return null;
  const next = cloneMeta(m);
  next.supplies -= cost;
  next.ammo[k] = (next.ammo[k] ?? 0) + a.pack * packs;
  return next;
}

export const benchLevel = (m: MetaState, k: WeaponKind, line: BenchLine): number => m.bench[benchKey(k, line)] ?? 0;

export type BenchResult = 'ok' | 'maxed' | 'supplies' | 'locked';

/** 工作台：这把枪要先在军械库解锁（手枪一开始就有） */
export function canBench(m: MetaState, k: WeaponKind, line: BenchLine): BenchResult {
  const lv = benchLevel(m, k, line);
  if (lv >= BENCH_MAX) return 'maxed';
  if (k !== 'pistol' && !bonusesOf(m).weapons.has(k)) return 'locked';
  if (m.supplies < benchPrice(k, lv)) return 'supplies';
  return 'ok';
}

export function buyBench(m: MetaState, k: WeaponKind, line: BenchLine): MetaState | null {
  if (canBench(m, k, line) !== 'ok') return null;
  const lv = benchLevel(m, k, line);
  const next = cloneMeta(m);
  next.supplies -= benchPrice(k, lv);
  next.bench[benchKey(k, line)] = lv + 1;
  return next;
}

// ---------------------------------------------------------------- 购买

export type BuyResult = 'ok' | 'unknown' | 'maxed' | 'medals' | 'requires' | 'rank';

export const levelOf = (m: MetaState, id: string): number => m.levels[id] ?? 0;

/** 下一级的价格；已满级返回 null */
export function nextPrice(m: MetaState, item: MetaItem): number | null {
  return item.prices[levelOf(m, item.id)] ?? null;
}

export function canBuy(m: MetaState, id: string): BuyResult {
  const item = META_BY_ID[id];
  if (!item) return 'unknown';
  const price = nextPrice(m, item);
  if (price === null) return 'maxed';
  if (item.requires && levelOf(m, item.requires.id) < item.requires.level) return 'requires';
  if (rankOf(m.medalsEarned) < rankFor(item, levelOf(m, item.id))) return 'rank';
  if (m.medals < price) return 'medals';
  return 'ok';
}

/** 买下一级：返回 [新状态, 结果]；买不了时原样返回 */
export function buyMeta(m: MetaState, id: string): [MetaState, BuyResult] {
  const r = canBuy(m, id);
  if (r !== 'ok') return [m, r];
  const item = META_BY_ID[id] as MetaItem;
  const price = nextPrice(m, item) as number;
  const next = cloneMeta(m);
  next.medals -= price;
  next.levels[id] = levelOf(m, id) + 1;
  return [next, 'ok'];
}

export function bonusesOf(m: MetaState): MetaBonuses {
  const b = baseBonuses();
  for (const item of META_ITEMS) item.apply(b, levelOf(m, item.id));
  return b;
}

/** 把整张表买满需要多少勋章 */
export const totalMetaCost = (): number => META_ITEMS.reduce((a, it) => a + it.prices.reduce((x, y) => x + y, 0), 0);

// ---------------------------------------------------------------- 难度

export function difficultyUnlocked(m: MetaState, d: Difficulty): boolean {
  const req = DIFFICULTIES[d].requires;
  return req === null || m.cleared.includes(req);
}

export const unlockedDifficulties = (m: MetaState): Difficulty[] => DIFFICULTY_ORDER.filter((d) => difficultyUnlocked(m, d));
