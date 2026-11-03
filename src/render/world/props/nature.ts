import { CylinderGeometry } from 'three';
import { Rng } from '../../../game/core/rng';
import { HALF_H, HALF_W } from '../../../game/world/grid';
import type { Prop } from '../../../game/world/types';
import { Builder, Pal } from '../../kit';
import { matte } from './kit';

/* 枯树 */

export function tree(b: Builder, p: Prop, rng: Rng): void {
  const cx = (p.x0 + p.x1) / 2 - HALF_W;
  const cz = (p.y0 + p.y1) / 2 - HALF_H;
  const h = p.h ?? 3;
  const bark = rng.chance(0.5) ? Pal.bark : Pal.barkGray;
  b.push({ x: cx, z: cz, ry: rng.range(0, 6.28) });
  const trunkStyle = matte(bark, { jitter: 0.25, ao: 0.5, aoH: 1.2 });
  const limb = matte(bark, { jitter: 0.22, ao: 0.1 });
  const leafy = rng.chance(0.35);
  type V3 = [number, number, number];
  // 树干：三段，逐段变细、方向轻微扭动
  const pts: V3[] = [[0, 0, 0]];
  const radii = [0.22, 0.16, 0.11, 0.07];
  let dx = rng.range(-0.08, 0.08);
  let dz = rng.range(-0.08, 0.08);
  for (let i = 1; i <= 3; i++) {
    dx += rng.range(-0.1, 0.1);
    dz += rng.range(-0.1, 0.1);
    const prev = pts[i - 1] as V3;
    pts.push([prev[0] + dx * h * 0.2, prev[1] + h * 0.2, prev[2] + dz * h * 0.2]);
  }
  for (let i = 0; i < 3; i++) {
    const a = pts[i] as V3;
    const c = pts[i + 1] as V3;
    const len = Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    const g = new CylinderGeometry(radii[i + 1] as number, radii[i] as number, len, 8, 2);
    g.translate(0, len / 2, 0);
    b.push({ x: a[0], y: a[1], z: a[2], rx: Math.atan2(c[2] - a[2], c[1] - a[1]), rz: -Math.atan2(c[0] - a[0], c[1] - a[1]) });
    b.add(g, {}, trunkStyle);
    b.pop();
    // 树皮的竖向裂纹
    if (i === 0) {
      for (let k = 0; k < 5; k++) {
        const ang = rng.range(0, 6.28);
        b.box(0.03, len * 0.8, 0.02, { x: Math.cos(ang) * 0.19, z: Math.sin(ang) * 0.19, y: 0.1, ry: -ang }, matte(0x2a221c, { jitter: 0.2, ao: 0.3 }));
      }
    }
  }
  // 树根：根部隆起向外伸
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * 6.28 + rng.range(-0.3, 0.3);
    const L = rng.range(0.35, 0.6);
    b.rod([Math.cos(a) * 0.12, 0.3, Math.sin(a) * 0.12], [Math.cos(a) * L, 0.02, Math.sin(a) * L], 0.07, matte(bark, { jitter: 0.2, ao: 0.4 }), 5);
    b.rod([Math.cos(a) * L, 0.02, Math.sin(a) * L], [Math.cos(a) * (L + 0.25), -0.04, Math.sin(a) * (L + 0.25)], 0.035, matte(bark, { jitter: 0.2, ao: 0.4 }), 4);
  }
  // 递归分枝：每级 2–3 根，越往外越细
  const branch = (from: V3, yaw: number, pitch: number, len: number, r: number, depth: number): void => {
    const to: V3 = [
      from[0] + Math.cos(yaw) * Math.cos(pitch) * len,
      from[1] + Math.sin(pitch) * len,
      from[2] + Math.sin(yaw) * Math.cos(pitch) * len,
    ];
    b.rod(from, to, r, limb, depth > 1 ? 6 : 4);
    if (depth <= 1) {
      if (leafy && rng.chance(0.6)) b.sphere(rng.range(0.2, 0.34), 6, 4, { x: to[0], y: to[1], z: to[2], sy: 0.65 }, matte(rng.pick([Pal.leaf, 0x4f5e33, 0x6b6a3a]), { jitter: 0.3, ao: 0 }));
      return;
    }
    const kids = rng.int(2, 3);
    for (let k = 0; k < kids; k++) {
      branch(to, yaw + rng.range(-0.9, 0.9), Math.min(1.3, pitch + rng.range(-0.25, 0.4)), len * rng.range(0.5, 0.7), r * 0.6, depth - 1);
    }
  };
  const n = rng.int(3, 5);
  for (let i = 0; i < n; i++) {
    const seg = rng.int(1, 3);
    const a = pts[seg] as V3;
    const c = pts[Math.min(3, seg + 1)] as V3;
    const f = rng.range(0.2, 0.9);
    const from: V3 = [a[0] + (c[0] - a[0]) * f, a[1] + (c[1] - a[1]) * f, a[2] + (c[2] - a[2]) * f];
    branch(from, (i / n) * 6.28 + rng.range(-0.4, 0.4), rng.range(0.35, 0.8), rng.range(0.8, 1.3), (radii[seg] as number) * 0.45, 3);
  }
  // 树冠顶端
  branch(pts[3] as V3, rng.range(0, 6.28), 1.2, 0.7, 0.04, 2);
  // 断掉的枝桩
  if (rng.chance(0.5)) {
    const a = rng.range(0, 6.28);
    const p1 = pts[1] as V3;
    b.rod(p1, [p1[0] + Math.cos(a) * 0.25, p1[1] + 0.05, p1[2] + Math.sin(a) * 0.25], 0.06, limb, 6);
  }
  b.pop();
}
