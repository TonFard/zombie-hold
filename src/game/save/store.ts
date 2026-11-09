import { migrateV1 } from './migrate';
import { SAVE_KEY, SAVE_KEY_V1, SaveError, defaultSave, parseSave, type SaveData } from './schema';
import type { Storage } from './storage';

export interface LoadResult {
  save: SaveData;
  /** 存档坏了被丢弃时的原因（界面提示 + console.warn）；正常为空串 */
  warning: string;
  /** 这次是从 v1 迁移过来的 */
  migrated: boolean;
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
