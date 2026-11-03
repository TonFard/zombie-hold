import type { Zombie } from '../entities/zombie';

/** 一条线段打中僵尸的位置：t 是线段上的比例（0–1），head 表示打中的是头 */
export interface SegHit {
  t: number;
  head: boolean;
  /** 打中了首领硬直时裸露的胸口核心（弱点） */
  core?: boolean;
}

/** 线段 A + t·D（t∈[0,1]）与球的第一个交点；没有返回 -1。起点在球内返回 0 */
export function segSphere(ax: number, ay: number, az: number, dx: number, dy: number, dz: number, cx: number, cy: number, cz: number, r: number): number {
  const ox = ax - cx;
  const oy = ay - cy;
  const oz = az - cz;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy + dz * dz;
  if (a < 1e-12) return -1;
  const b = 2 * (ox * dx + oy * dy + oz * dz);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}

/** 线段与竖直圆柱（轴在 (cx,cz)，半径 r，高 0–h）的第一个交点；没有返回 -1 */
export function segCylinder(ax: number, ay: number, az: number, dx: number, dy: number, dz: number, cx: number, cz: number, r: number, h: number): number {
  const ox = ax - cx;
  const oz = az - cz;
  const c = ox * ox + oz * oz - r * r;
  const a = dx * dx + dz * dz;
  let best = -1;
  if (c <= 0) {
    // 起点已经在圆柱的水平截面里：高度也对就是贴脸命中
    if (ay >= 0 && ay <= h) return 0;
  } else if (a > 1e-12) {
    const b = 2 * (ox * dx + oz * dz);
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / (2 * a);
      if (t >= 0 && t <= 1) {
        const y = ay + dy * t;
        if (y >= 0 && y <= h) best = t;
      }
    }
  }
  // 从上方穿过顶面
  if (dy < 0 && ay > h && ay + dy <= h) {
    const t = (h - ay) / dy;
    const px = ox + dx * t;
    const pz = oz + dz * t;
    if (px * px + pz * pz <= r * r && (best < 0 || t < best)) best = t;
  }
  return best;
}

/** 头球的球心 */
export function headCenter(z: Zombie, out: { x: number; y: number; z: number }): void {
  const h = z.def.head;
  out.x = z.x + Math.sin(z.yaw) * h.fwd;
  out.y = h.y;
  out.z = z.z + Math.cos(z.yaw) * h.fwd;
}

const _c = { x: 0, y: 0, z: 0 };

/**
 * 子弹这一小段飞行轨迹（从 A 到 A+D）有没有打中这只僵尸。
 * 头球优先：同时擦到头和身体算爆头。
 */
export function segmentVsZombie(z: Zombie, ax: number, ay: number, az: number, dx: number, dy: number, dz: number): SegHit | null {
  const def = z.def;
  // 粗筛：线段离僵尸的水平距离太远，或者整段都在僵尸头顶 / 脚下
  const reach = z.radius + def.head.fwd + def.head.r + 0.05;
  const len2 = dx * dx + dz * dz;
  const tc = len2 > 1e-12 ? Math.max(0, Math.min(1, ((z.x - ax) * dx + (z.z - az) * dz) / len2)) : 0;
  const px = ax + dx * tc - z.x;
  const pz = az + dz * tc - z.z;
  if (px * px + pz * pz > reach * reach) return null;
  const top = def.height + def.head.r;
  if ((ay > top && ay + dy > top) || (ay < 0 && ay + dy < 0)) return null;

  // 首领冲锋后的硬直：胸口核心是弱点，比头还优先
  const ch = def.charge;
  if (ch && z.chargeState === 3) {
    const tc2 = segSphere(ax, ay, az, dx, dy, dz, z.x + Math.sin(z.yaw) * z.radius * 0.7, ch.core.y, z.z + Math.cos(z.yaw) * z.radius * 0.7, ch.core.r);
    if (tc2 >= 0) return { t: tc2, head: false, core: true };
  }
  headCenter(z, _c);
  const th = segSphere(ax, ay, az, dx, dy, dz, _c.x, _c.y, _c.z, def.head.r);
  if (th >= 0) return { t: th, head: true };
  const tb = segCylinder(ax, ay, az, dx, dy, dz, z.x, z.z, z.radius, def.height);
  if (tb >= 0) return { t: tb, head: false };
  return null;
}
