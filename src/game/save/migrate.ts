import { FINAL_NIGHT } from '../data/waves';
import { defaultSave, isObj, isQuality, type SaveData } from './schema';

const clampNum = (v: unknown, fallback: number, min: number, max: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);

/**
 * v1（只有统计和设置）→ v2。v1 的读档本来就是宽松的（坏字段用默认值），这里保持一致：
 * 统计和设置尽量保留，局外进度从零开始；通关过的话解锁困难难度。
 */
export function migrateV1(v: unknown): SaveData {
  const d = defaultSave();
  if (!isObj(v)) return d;
  const wins = Math.round(clampNum(v.wins, 0, 0, 1e7));
  return {
    ...d,
    bestNight: Math.round(clampNum(v.bestNight, 0, 0, FINAL_NIGHT)),
    bestKills: Math.round(clampNum(v.bestKills, 0, 0, 1e7)),
    wins,
    runs: Math.round(clampNum(v.runs, 0, 0, 1e7)),
    totalKills: Math.round(clampNum(v.totalKills, 0, 0, 1e9)),
    bestWinTime: clampNum(v.bestWinTime, 0, 0, 1e7),
    volume: clampNum(v.volume, d.volume, 0, 1),
    quality: isQuality(v.quality) ? v.quality : d.quality,
    sensitivity: clampNum(v.sensitivity, d.sensitivity, 0.2, 3),
    meta: { ...d.meta, cleared: wins > 0 ? ['normal'] : [] },
  };
}
