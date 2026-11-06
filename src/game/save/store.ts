import { migrateV1 } from './migrate';
import { EPOCH_KEY, SAVE_EPOCH, SAVE_KEY, SAVE_KEY_V1, SaveError, defaultSave, parseSave, type SaveData } from './schema';
import type { Storage } from './storage';

export interface LoadResult {
  save: SaveData;
  /** 存档坏了被丢弃时的原因（界面提示 + console.warn）；正常为空串 */
  warning: string;
  /** 这次是从 v1 迁移过来的 */
  migrated: boolean;
}

/**
 * 版本更新时重置：纪元不一样就清掉跨局存档和检查点（runKey），只把设置搬到新存档里。
 * 第一次打开（没有任何存档）只记下纪元，不算重置
 */
export function resetOnUpdate(st: Storage, runKey: string, epoch = SAVE_EPOCH): boolean {
  if (st.get(EPOCH_KEY) === String(epoch)) return false;
  const had = st.get(SAVE_KEY) !== null || st.get(SAVE_KEY_V1) !== null || st.get(runKey) !== null;
  let keep: Pick<SaveData, 'volume' | 'quality' | 'sensitivity' | 'mix'> | null = null;
  const raw = st.get(SAVE_KEY);
  if (raw !== null) {
    try {
      const old = parseSave(JSON.parse(raw));
      keep = { volume: old.volume, quality: old.quality, sensitivity: old.sensitivity, mix: old.mix };
    } catch {
      keep = null;
    }
  }
  clearSave(st);
  st.remove(runKey);
  if (keep) writeSave(st, { ...defaultSave(), ...keep });
  st.set(EPOCH_KEY, String(epoch));
  return had;
}

/** 读跨局存档：优先 v2；没有 v2 时迁移 v1；坏档当作没有存档。不抛异常 */
export function loadSave(st: Storage): LoadResult {
  const raw = st.get(SAVE_KEY);
  if (raw !== null) {
    try {
      return { save: parseSave(JSON.parse(raw)), warning: '', migrated: false };
    } catch (e) {
      const why = e instanceof SaveError ? e.message : 'JSON 损坏';
      return { save: defaultSave(), warning: `存档损坏，已重置（${why}）`, migrated: false };
    }
  }
  const old = st.get(SAVE_KEY_V1);
  if (old !== null) {
    try {
      const save = migrateV1(JSON.parse(old));
      writeSave(st, save);
      return { save, warning: '', migrated: true };
    } catch {
      return { save: defaultSave(), warning: '旧存档损坏，已重置', migrated: false };
    }
  }
  return { save: defaultSave(), warning: '', migrated: false };
}

export function writeSave(st: Storage, s: SaveData): void {
  st.set(SAVE_KEY, JSON.stringify(s));
}

export function clearSave(st: Storage): void {
  st.remove(SAVE_KEY);
  st.remove(SAVE_KEY_V1);
}
