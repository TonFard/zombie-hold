import { Vector3, type PerspectiveCamera } from 'three';

interface Item {
  el: HTMLDivElement;
  active: boolean;
  x: number;
  y: number;
  z: number;
  vy: number;
  age: number;
  life: number;
  owner: number;
  value: number;
  crit: boolean;
  kind: 'dmg' | 'scrap';
  /** 屏幕上的随机水平偏移 */
  ox: number;
}

/** 浮动数字：伤害和零件。用 DOM 元素池，每帧把世界坐标投影到屏幕上 */
export class FloatingText {
  private readonly items: Item[] = [];
  private readonly v = new Vector3();

  constructor(
    container: HTMLElement,
    private readonly camera: PerspectiveCamera,
    private readonly size: () => { w: number; h: number },
    max = 48,
  ) {
    for (let i = 0; i < max; i++) {
      const el = document.createElement('div');
      el.className = 'fx-text';
      el.style.display = 'none';
      container.appendChild(el);
      this.items.push({ el, active: false, x: 0, y: 0, z: 0, vy: 0, age: 0, life: 0, owner: -1, value: 0, crit: false, kind: 'dmg', ox: 0 });
    }
  }

  private take(): Item {
    for (const it of this.items) if (!it.active) return it;
    // 都在用：覆盖最老的
    let oldest = this.items[0] as Item;
    for (const it of this.items) if (it.age > oldest.age) oldest = it;
    return oldest;
  }

  /** 同一只僵尸 0.15 秒内的多次命中（霰弹的多颗弹丸）合并成一个数字 */
  damage(owner: number, x: number, y: number, z: number, amount: number, crit: boolean): void {
    for (const it of this.items) {
      if (it.active && it.kind === 'dmg' && it.owner === owner && it.age < 0.15) {
        it.value += amount;
        it.crit = it.crit || crit;
        this.paint(it);
        return;
      }
    }
    const it = this.take();
    Object.assign(it, { active: true, x, y, z, vy: 2.0, age: 0, life: crit ? 1.0 : 0.75, owner, value: amount, crit, kind: 'dmg' as const, ox: (Math.random() - 0.5) * 30 });
    it.el.style.display = 'block';
    this.paint(it);
  }

  scrap(x: number, y: number, z: number, amount: number): void {
    const it = this.take();
    Object.assign(it, { active: true, x, y, z, vy: 1.6, age: 0, life: 1.5, owner: -1, value: amount, crit: false, kind: 'scrap' as const, ox: 22 });
    it.el.style.display = 'block';
    this.paint(it);
  }

  private paint(it: Item): void {
    const v = Math.round(it.value);
    if (it.kind === 'scrap') {
      // 金色描边大字 + 零件图标；零件箱这种大额收入更大
      it.el.textContent = `◆ +${v}`;
      it.el.className = 'fx-text fx-scrap';
      it.el.style.color = '';
      it.el.style.fontSize = `${Math.min(30, 19 + Math.sqrt(v) * 0.9).toFixed(0)}px`;
      return;
    }
    it.el.className = 'fx-text';
    it.el.textContent = String(v);
    const big = Math.min(34, 15 + v * 0.12);
    it.el.style.fontSize = `${it.crit ? big + 8 : big}px`;
    it.el.style.color = it.crit ? '#ffd23a' : v >= 60 ? '#ffb070' : '#f2f2ea';
  }

  update(dt: number): void {
    const { w, h } = this.size();
    for (const it of this.items) {
      if (!it.active) continue;
      it.age += dt;
      if (it.age >= it.life) {
        it.active = false;
        it.el.style.display = 'none';
        continue;
      }
      it.y += it.vy * dt;
      it.vy *= Math.exp(-2.5 * dt);
      this.v.set(it.x, it.y, it.z).project(this.camera);
      if (this.v.z > 1) {
        it.el.style.opacity = '0';
        continue;
      }
      const px = (this.v.x * 0.5 + 0.5) * w + it.ox;
      const py = (-this.v.y * 0.5 + 0.5) * h;
      const k = it.age / it.life;
      const pop = it.age < 0.08 ? 0.6 + (it.age / 0.08) * 0.6 : 1.2 - Math.min(0.2, (it.age - 0.08) * 0.6);
      it.el.style.opacity = String(k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4);
      it.el.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) translate(-50%, -50%) scale(${pop.toFixed(2)})`;
    }
  }

  dispose(): void {
    for (const it of this.items) it.el.remove();
  }
}
