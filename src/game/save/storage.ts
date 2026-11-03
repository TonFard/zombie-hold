/** 存档读写接口：浏览器里用 localStorage，测试里用内存实现。逻辑层不直接碰 localStorage */
export interface Storage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export class MemoryStorage implements Storage {
  readonly data = new Map<string, string>();
  get(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  set(key: string, value: string): void {
    this.data.set(key, value);
  }
  remove(key: string): void {
    this.data.delete(key);
  }
}

/** 浏览器存储：隐私模式等情况下写不进去时静默失败（返回值不变） */
export function browserStorage(ls: { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }): Storage {
  return {
    get: (k) => {
      try {
        return ls.getItem(k);
      } catch {
        return null;
      }
    },
    set: (k, v) => {
      try {
        ls.setItem(k, v);
      } catch {
        /* 写不进去，忽略 */
      }
    },
    remove: (k) => {
      try {
        ls.removeItem(k);
      } catch {
        /* ignore */
      }
    },
  };
}
