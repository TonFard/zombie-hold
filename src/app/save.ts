import type { Quality } from '../render/view';

/** 本地存档：只存跨局的统计和设置，不存一局中途的进度 */
const KEY = 'zombie-hold-save-v1';

export interface SaveData {
  version: 1;
  bestNight: number;
  bestKills: number;
  wins: number;
  runs: number;
  totalKills: number;
  /** 最快通关用时（秒），0 = 还没通关过 */
  bestWinTime: number;
  volume: number;
  quality: Quality;
  /** 鼠标灵敏度倍率 */
  sensitivity: number;
}

export const defaultSave = (): SaveData => ({ version: 1, bestNight: 0, bestKills: 0, wins: 0, runs: 0, totalKills: 0, bestWinTime: 0, volume: 0.8, quality: 'high', sensitivity: 1 });

const isQuality = (v: unknown): v is Quality => v === 'low' || v === 'mid' || v === 'high';

const num = (v: unknown, fallback: number, max = 1e9): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : fallback);

export function loadSave(): SaveData {
  const d = defaultSave();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const o = JSON.parse(raw) as Record<string, unknown>;
    return {
      version: 1,
      bestNight: num(o.bestNight, 0, 10),
      bestKills: num(o.bestKills, 0),
      wins: num(o.wins, 0),
      runs: num(o.runs, 0),
      totalKills: num(o.totalKills, 0),
      bestWinTime: num(o.bestWinTime, 0),
      volume: num(o.volume, d.volume, 1),
      quality: isQuality(o.quality) ? o.quality : d.quality,
      sensitivity: Math.max(0.2, num(o.sensitivity, d.sensitivity, 3)),
    };
  } catch {
    return d;
  }
}

export function writeSave(s: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 隐私模式等情况下写不进去，忽略 */
  }
}

export interface RunSummary {
  won: boolean;
  night: number;
  kills: number;
  time: number;
}

/** 一局结束后更新统计，返回 [新存档, 是否刷新了最高夜数] */
export function recordRun(s: SaveData, r: RunSummary): [SaveData, boolean] {
  const next: SaveData = { ...s, runs: s.runs + 1, totalKills: s.totalKills + r.kills };
  const reached = r.won ? 10 : r.night;
  const newBest = reached > s.bestNight;
  if (newBest) next.bestNight = reached;
  if (r.kills > s.bestKills) next.bestKills = r.kills;
  if (r.won) {
    next.wins = s.wins + 1;
    if (s.bestWinTime === 0 || r.time < s.bestWinTime) next.bestWinTime = Math.round(r.time);
  }
  return [next, newBest];
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
