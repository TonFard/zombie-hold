import { clamp } from '../core/math';
import { HALF_H, HALF_W, type Grid } from './grid';

export interface Pos {
  x: number;
  z: number;
}

/**
 * 把圆从阻挡格里推出来，沿墙面滑动而不是停下。
 * 返回是否发生过碰撞。
 */
export function resolveCircleVsGrid(grid: Grid, p: Pos, r: number): boolean {
  let hit = false;
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    const cx0 = grid.cellX(p.x);
    const cy0 = grid.cellY(p.z);
    for (let cy = cy0 - 1; cy <= cy0 + 1; cy++) {
      for (let cx = cx0 - 1; cx <= cx0 + 1; cx++) {
        if (!grid.isBlocked(cx, cy)) continue;
        const minX = cx - HALF_W;
        const minZ = cy - HALF_H;
        const maxX = minX + 1;
        const maxZ = minZ + 1;
        const qx = clamp(p.x, minX, maxX);
        const qz = clamp(p.z, minZ, maxZ);
        const dx = p.x - qx;
        const dz = p.z - qz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-9) {
          const d = Math.sqrt(d2);
          const k = (r - d) / d;
          p.x += dx * k;
          p.z += dz * k;
        } else {
          // 圆心落在格子内部：沿最近的边推出去
          const l = p.x - minX;
          const rr = maxX - p.x;
          const t = p.z - minZ;
          const b = maxZ - p.z;
          const m = Math.min(l, rr, t, b);
          if (m === l) p.x = minX - r;
          else if (m === rr) p.x = maxX + r;
          else if (m === t) p.z = minZ - r;
          else p.z = maxZ + r;
        }
        moved = true;
        hit = true;
      }
    }
    if (!moved) break;
  }
  return hit;
}

/** 点到轴对齐矩形的距离（点在矩形内为 0） */
export function rectDist(px: number, pz: number, x0: number, z0: number, x1: number, z1: number): number {
  const qx = clamp(px, x0, x1);
  const qz = clamp(pz, z0, z1);
  return Math.hypot(px - qx, pz - qz);
}
