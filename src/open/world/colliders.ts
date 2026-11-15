/**
 * 开放世界的碰撞：墙、车、集装箱这些是竖直的盒子（可以斜着摆），树、桶、路灯是圆柱。
 * 都有高度范围 [y0, y1]：比脚高一个台阶以内的东西能踩上去（地板、栈桥），更高的挡人。
 * 按 16 米一格建空间索引，玩家每帧只查身边几格。
 */

export interface Box {
  x: number;
  z: number;
  hx: number;
  hz: number;
  /** 朝向的 cos / sin（和 three 的绕 Y 旋转一致） */
  c: number;
  s: number;
  y0: number;
  y1: number;
}

export interface Circle {
  x: number;
  z: number;
  r: number;
  y0: number;
  y1: number;
}

const CELL = 16;
const OFF = 64;

export class Colliders {
  readonly boxes: Box[] = [];
  readonly circles: Circle[] = [];
  private readonly cells = new Map<number, { b: number[]; c: number[] }>();
  private readonly raySeen = new Set<number>();

  /** (ox, oz)：这一份碰撞体的中心。空间索引只覆盖中心周围 ±1000 米 */
  constructor(
    private readonly ox = 0,
    private readonly oz = 0,
  ) {}

  private key(i: number, j: number): number {
    return (j + OFF) * 1024 + (i + OFF);
  }

  private cell(i: number, j: number): { b: number[]; c: number[] } {
    const k = this.key(i, j);
    let e = this.cells.get(k);
    if (!e) this.cells.set(k, (e = { b: [], c: [] }));
    return e;
  }

  private span(x: number, z: number, ex: number, ez: number, f: (i: number, j: number) => void): void {
    const i0 = Math.max(-OFF, Math.floor((x - this.ox - ex) / CELL));
    const i1 = Math.min(OFF - 1, Math.floor((x - this.ox + ex) / CELL));
    const j0 = Math.max(-OFF, Math.floor((z - this.oz - ez) / CELL));
    const j1 = Math.min(OFF - 1, Math.floor((z - this.oz + ez) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) f(i, j);
  }

  /** 盒子：中心、半长（沿自身 X）、半宽（沿自身 Z）、朝向 ry、高度范围 */
  addBox(x: number, z: number, hx: number, hz: number, ry: number, y0: number, y1: number): void {
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    const id = this.boxes.length;
    this.boxes.push({ x, z, hx, hz, c, s, y0, y1 });
    const ex = Math.abs(c) * hx + Math.abs(s) * hz;
    const ez = Math.abs(s) * hx + Math.abs(c) * hz;
    this.span(x, z, ex, ez, (i, j) => this.cell(i, j).b.push(id));
  }

  addCircle(x: number, z: number, r: number, y0: number, y1: number): void {
    const id = this.circles.length;
    this.circles.push({ x, z, r, y0, y1 });
    this.span(x, z, r, r, (i, j) => this.cell(i, j).c.push(id));
  }

  private visit(x: number, z: number, r: number, fb: (b: Box) => void, fc: (c: Circle) => void): void {
    const seen = new Set<number>();
    this.span(x, z, r, r, (i, j) => {
      const e = this.cells.get(this.key(i, j));
      if (!e) return;
      for (const id of e.b) {
        if (seen.has(id)) continue;
        seen.add(id);
        fb(this.boxes[id] as Box);
      }
      for (const id of e.c) {
        if (seen.has(-1 - id)) continue;
        seen.add(-1 - id);
        fc(this.circles[id] as Circle);
      }
    });
  }

  /**
   * 把竖直圆柱（脚底 feet、身高 height、半径 r）从挡路的碰撞体里推出来。
   * 顶面在 feet + step 以下的不挡（能直接迈上去），底面在头顶以上的也不挡（门楣、雨棚）
   */
  resolve(p: { x: number; z: number }, feet: number, height: number, r: number, step: number): boolean {
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      this.visit(
        p.x,
        p.z,
        r + 1,
        (b) => {
          if (b.y1 <= feet + step || b.y0 >= feet + height) return;
          const dx = p.x - b.x;
          const dz = p.z - b.z;
          const lx = dx * b.c - dz * b.s;
          const lz = dx * b.s + dz * b.c;
          const qx = Math.max(-b.hx, Math.min(b.hx, lx));
          const qz = Math.max(-b.hz, Math.min(b.hz, lz));
          let px = lx - qx;
          let pz = lz - qz;
          const d = Math.hypot(px, pz);
          if (d >= r) return;
          if (d > 1e-6) {
            px = (px / d) * (r - d);
            pz = (pz / d) * (r - d);
          } else {
            // 圆心已经在盒子里：从最近的那条边推出去
            const ox = b.hx - Math.abs(lx);
            const oz = b.hz - Math.abs(lz);
            if (ox < oz) {
              px = (ox + r) * Math.sign(lx || 1);
              pz = 0;
            } else {
              px = 0;
              pz = (oz + r) * Math.sign(lz || 1);
            }
          }
          p.x += px * b.c + pz * b.s;
          p.z += -px * b.s + pz * b.c;
          moved = true;
        },
        (c) => {
          if (c.y1 <= feet + step || c.y0 >= feet + height) return;
          const dx = p.x - c.x;
          const dz = p.z - c.z;
          const d = Math.hypot(dx, dz);
          const min = c.r + r;
          if (d >= min) return;
          if (d > 1e-6) {
            p.x = c.x + (dx / d) * min;
            p.z = c.z + (dz / d) * min;
          } else p.x = c.x + min;
          moved = true;
        },
      );
      if (!moved) break;
      hit = true;
    }
    return hit;
  }

  /** 脚下能站的碰撞体顶面（地板、栈桥、矮台）：顶面不高于 feet + step 的里面最高的；没有返回 -Infinity */
  topAt(x: number, z: number, r: number, feet: number, step: number): number {
    let top = -Infinity;
    const m = r * 0.6;
    this.visit(
      x,
      z,
      r + 1,
      (b) => {
        if (b.y1 > feet + step + 0.01 || b.y1 <= top) return;
        const dx = x - b.x;
        const dz = z - b.z;
        const lx = dx * b.c - dz * b.s;
        const lz = dx * b.s + dz * b.c;
        if (Math.abs(lx) <= b.hx + m && Math.abs(lz) <= b.hz + m) top = b.y1;
      },
      (c) => {
        if (c.y1 > feet + step + 0.01 || c.y1 <= top) return;
        if (Math.hypot(x - c.x, z - c.z) <= c.r + m) top = c.y1;
      },
    );
    return top;
  }

  /**
   * 射线（方向已归一化）打到的最近的碰撞体：返回距离，max 以内没打到返回 Infinity。
   * 盒子 = 带朝向的矩形 × 高度范围，圆 = 竖直的圆柱。沿着射线一格一格地查空间索引
   */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): number {
    let best = max;
    const seen = this.raySeen;
    seen.clear();
    let i = Math.floor((ox - this.ox) / CELL);
    let j = Math.floor((oz - this.oz) / CELL);
    const si = dx > 0 ? 1 : -1;
    const sj = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? CELL / Math.abs(dx) : Infinity;
    const tdz = dz !== 0 ? CELL / Math.abs(dz) : Infinity;
    let tx = dx !== 0 ? ((i + (dx > 0 ? 1 : 0)) * CELL + this.ox - ox) / dx : Infinity;
    let tz = dz !== 0 ? ((j + (dz > 0 ? 1 : 0)) * CELL + this.oz - oz) / dz : Infinity;
    // 高度那一对平面
    const ySlab = (y0: number, y1: number, t: [number, number]): boolean => {
      if (Math.abs(dy) < 1e-9) return oy >= y0 && oy <= y1;
      const a = (y0 - oy) / dy;
      const b = (y1 - oy) / dy;
      t[0] = Math.max(t[0], Math.min(a, b));
      t[1] = Math.min(t[1], Math.max(a, b));
      return t[0] <= t[1];
    };
    const t: [number, number] = [0, 0];
    for (let n = 0; n < 400; n++) {
      const e = i >= -OFF && i < OFF && j >= -OFF && j < OFF ? this.cells.get(this.key(i, j)) : undefined;
      if (e) {
        for (const id of e.b) {
          if (seen.has(id)) continue;
          seen.add(id);
          const b = this.boxes[id] as Box;
          const rx = ox - b.x;
          const rz = oz - b.z;
          const lx = rx * b.c - rz * b.s;
          const lz = rx * b.s + rz * b.c;
          const ldx = dx * b.c - dz * b.s;
          const ldz = dx * b.s + dz * b.c;
          t[0] = 0;
          t[1] = best;
          if (!ySlab(b.y0, b.y1, t)) continue;
          if (Math.abs(ldx) < 1e-9) {
            if (Math.abs(lx) > b.hx) continue;
          } else {
            const a = (-b.hx - lx) / ldx;
            const c = (b.hx - lx) / ldx;
            t[0] = Math.max(t[0], Math.min(a, c));
            t[1] = Math.min(t[1], Math.max(a, c));
            if (t[0] > t[1]) continue;
          }
          if (Math.abs(ldz) < 1e-9) {
            if (Math.abs(lz) > b.hz) continue;
          } else {
            const a = (-b.hz - lz) / ldz;
            const c = (b.hz - lz) / ldz;
            t[0] = Math.max(t[0], Math.min(a, c));
            t[1] = Math.min(t[1], Math.max(a, c));
            if (t[0] > t[1]) continue;
          }
          if (t[0] < best) best = t[0];
        }
        for (const id of e.c) {
          if (seen.has(-1 - id)) continue;
          seen.add(-1 - id);
          const c = this.circles[id] as Circle;
          const rx = ox - c.x;
          const rz = oz - c.z;
          t[0] = 0;
          t[1] = best;
          if (!ySlab(c.y0, c.y1, t)) continue;
          const a = dx * dx + dz * dz;
          const cc = rx * rx + rz * rz - c.r * c.r;
          if (a < 1e-9) {
            if (cc > 0) continue;
          } else {
            const hb = rx * dx + rz * dz;
            const disc = hb * hb - a * cc;
            if (disc < 0) continue;
            const q = Math.sqrt(disc);
            t[0] = Math.max(t[0], (-hb - q) / a);
            t[1] = Math.min(t[1], (-hb + q) / a);
            if (t[0] > t[1]) continue;
          }
          if (t[0] < best) best = t[0];
        }
      }
      // 已经找到的命中比这一格的出口还近：后面的格子里不会有更近的
      const next = Math.min(tx, tz);
      if (best <= next || next > max) break;
      if (tx < tz) {
        i += si;
        tx += tdx;
      } else {
        j += sj;
        tz += tdz;
      }
    }
    return best < max ? best : Infinity;
  }

  /** 这个圆（水平）是否和任何碰撞体重叠（摆道具时避让用，不看高度） */
  overlaps(x: number, z: number, r: number): boolean {
    let hit = false;
    this.visit(
      x,
      z,
      r + 1,
      (b) => {
        if (hit) return;
        const dx = x - b.x;
        const dz = z - b.z;
        const lx = dx * b.c - dz * b.s;
        const lz = dx * b.s + dz * b.c;
        const qx = Math.max(-b.hx, Math.min(b.hx, lx));
        const qz = Math.max(-b.hz, Math.min(b.hz, lz));
        if (Math.hypot(lx - qx, lz - qz) < r) hit = true;
      },
      (c) => {
        if (!hit && Math.hypot(x - c.x, z - c.z) < c.r + r) hit = true;
      },
    );
    return hit;
  }
}
