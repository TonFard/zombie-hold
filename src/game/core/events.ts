/** 极简的带类型事件总线：逻辑层发事件，渲染层和音频层订阅。 */
export class Emitter<E extends object> {
  private handlers = new Map<keyof E, Set<(payload: unknown) => void>>();

  on<K extends keyof E>(key: K, fn: (payload: E[K]) => void): () => void {
    let set = this.handlers.get(key);
    if (!set) {
      set = new Set();
      this.handlers.set(key, set);
    }
    const target = set;
    const h = fn as (payload: unknown) => void;
    target.add(h);
    return () => target.delete(h);
  }

  emit<K extends keyof E>(key: K, payload: E[K]): void {
    const set = this.handlers.get(key);
    if (!set) return;
    for (const h of set) h(payload);
  }
}
