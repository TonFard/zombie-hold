import { clamp } from '../core/math';
import { ELITE_SCALE } from '../data/modifiers';
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

/**
 * 僵尸现在有多「跑起来」：0 = 站着，1 = 走 / 跑。
 * 渲染用它混合站立和移动的动作，头球用它在站姿和跑姿之间过渡 —— 两边必须是同一个数，头球才跟得上看到的头
 */
export function poseMoving(z: Zombie): number {
  return clamp(Math.hypot(z.vx, z.vz) / (z.def.speed * 0.35), 0, 1);
}

/** 命中体积的放大倍数：精英在画面里大一圈，体积跟着大 */
export const hitScale = (z: Zombie): number => (z.elite ? ELITE_SCALE : 1);

/** 硬直（受击动作，身体后仰）时头往回缩：前伸量 × 这个数。各种僵尸量出来都在 0.60–0.64 */
const STUN_LEAN = 0.62;

/** 头球的球心（跟着姿势走：跑起来时更低、更靠前；硬直时往回缩） */
export function headCenter(z: Zombie, out: { x: number; y: number; z: number }): void {
  const h = z.def.head;
  const s = hitScale(z);
  let y = h.y;
  let fwd = h.fwd;
  if (h.move) {
    const k = poseMoving(z);
    y += (h.move.y - y) * k;
    fwd += (h.move.fwd - fwd) * k;
    // 爬行者没有受击动作（也没有 move），硬直时还是趴着的姿势
    if (z.stunT > 0 || z.chargeState === 3) fwd *= STUN_LEAN;
  }
  out.x = z.x + Math.sin(z.yaw) * fwd * s;
  out.y = y * s + z.airY;
  out.z = z.z + Math.cos(z.yaw) * fwd * s;
}

/** 首领胸口核心（弱点）的球心 */
export function coreCenter(z: Zombie, out: { x: number; y: number; z: number }): void {
  const s = hitScale(z);
  const fwd = z.radius * 0.7 * s;
  out.x = z.x + Math.sin(z.yaw) * fwd;
  out.y = (z.def.charge?.core.y ?? 0) * s;
  out.z = z.z + Math.cos(z.yaw) * fwd;
}

const _c = { x: 0, y: 0, z: 0 };

/**
 * 子弹这一小段飞行轨迹（从 A 到 A+D）有没有打中这只僵尸。
 * 头球优先：同时擦到头和身体算爆头。
 */
export function segmentVsZombie(z: Zombie, ax: number, ay: number, az: number, dx: number, dy: number, dz: number): SegHit | null {
  const def = z.def;
  const s = hitScale(z);
  const hr = def.head.r * s;
  // 粗筛（水平）：线段离僵尸太远。头伸在身体前面，按伸得最远的姿势算
  const fwd = Math.max(def.head.fwd, def.head.move?.fwd ?? 0);
  const reach = (z.radius + fwd + def.head.r) * s + 0.05;
  const len2 = dx * dx + dz * dz;
  const tc = len2 > 1e-12 ? Math.max(0, Math.min(1, ((z.x - ax) * dx + (z.z - az) * dz) / len2)) : 0;
  const px = ax + dx * tc - z.x;
  const pz = az + dz * tc - z.z;
  if (px * px + pz * pz > reach * reach) return null;
  // 粗筛（竖直）：整段都在僵尸头顶 / 脚下（跳跃者在空中时整个体积抬高 airY）
  const air = z.airY;
  const top = Math.max(def.height, def.head.y + def.head.r, (def.head.move?.y ?? 0) + def.head.r) * s + air;
  if ((ay > top && ay + dy > top) || (ay < air && ay + dy < air)) return null;

  // 首领冲锋后的硬直：胸口核心是弱点，比头还优先
  const ch = def.charge;
  if (ch && z.chargeState === 3) {
    coreCenter(z, _c);
    const tc2 = segSphere(ax, ay, az, dx, dy, dz, _c.x, _c.y, _c.z, ch.core.r * s);
    if (tc2 >= 0) return { t: tc2, head: false, core: true };
  }
  headCenter(z, _c);
  const th = segSphere(ax, ay, az, dx, dy, dz, _c.x, _c.y, _c.z, hr);
  if (th >= 0) return { t: th, head: true };
  // 头和身体圆柱重叠（头没有伸到身体前面）时，圆柱只算到头的下沿：不然正面打头的子弹先撞上圆柱的前壁，
  // 这一帧的一小段恰好停在前壁和头之间时就算成了打身体
  const inside = Math.hypot(_c.x - z.x, _c.z - z.z) < (z.radius + def.head.r) * s;
  const bodyTop = inside ? Math.min(def.height * s, _c.y - air - hr) : def.height * s;
  const tb = segCylinder(ax, ay - air, az, dx, dy, dz, z.x, z.z, z.radius * s, bodyTop);
  if (tb >= 0) return { t: tb, head: false };
  return null;
}
