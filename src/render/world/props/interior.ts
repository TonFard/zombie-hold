import type { Rng } from '../../../game/core/rng';
import { FURN_IDS } from '../../../game/world/modules';
import type { Prop } from '../../../game/world/types';
import { Builder, Pal } from '../../kit';
import { rectOf, matte, metal, glow } from './kit';

/* 室内：窗、家具（程序模型；写实模型有的就用写实的，见 realProps.ts） */

/** 窗：窗台（挡人的矮墙）+ 窗框 + 碎玻璃；窗台以上的墙由门框过梁（doorframe variant 9）补上 */
export function windowSill(b: Builder, p: Prop, trimOnly: boolean): void {
  const r = rectOf(p);
  const h = p.h ?? 0.95;
  b.push({ x: r.cx, z: r.cz, ry: (p.rot ?? 0) % 2 ? Math.PI / 2 : 0 });
  const wall = p.style === 'brick' ? Pal.brick : p.style === 'metal' ? Pal.sheet : p.style === 'plaster' ? Pal.plaster : Pal.concrete;
  if (!trimOnly) b.box(1, h, 0.92, {}, matte(wall, { jitter: 0.16, ao: 0.4, aoH: 1 }));
  // 窗台石
  b.box(1.04, 0.06, 1.04, { y: h }, matte(Pal.concreteLight, { jitter: 0.08, ao: 0 }));
  // 窗框：两根立框 + 上框（高度到 2.2）
  const frame = matte(0x3a2e24, { jitter: 0.1, ao: 0 });
  for (const sx of [-1, 1]) b.box(0.06, 1.25, 0.1, { x: sx * 0.47, y: h + 0.06 }, frame);
  b.box(1, 0.06, 0.1, { y: h + 1.25 }, frame);
  b.box(0.04, 1.2, 0.06, { y: h + 0.06 }, frame);
  // 残留的玻璃碎片（两三块三角，略带反光）
  b.box(0.3, 0.22, 0.01, { x: -0.3, y: h + 0.08, rz: 0.4 }, metal(Pal.glass, { jitter: 0.05, ao: 0 }));
  b.box(0.2, 0.3, 0.01, { x: 0.32, y: h + 1.0, rz: -0.6 }, metal(Pal.glass, { jitter: 0.05, ao: 0 }));
  b.pop();
}

/** 家具（程序版）：按 FurnitureKind 画简单的形体 */
export function furniture(b: Builder, p: Prop, rng: Rng): void {
  const r = rectOf(p);
  const kind = FURN_IDS[p.variant] ?? 'table';
  const h = p.h ?? 0.8;
  // 正面朝向：rot 0 北（-z）1 东 2 南 3 西；模型默认正面朝 +z（南），所以要转 (rot - 2) × 90°
  const rot = p.rot ?? 2;
  const w = p.x1 - p.x0;
  const d = p.y1 - p.y0;
  // 局部坐标里 L 沿 x（宽），D 沿 z（深）
  const along = rot % 2 === 0;
  const L = (along ? w : d) - 0.1;
  const D = (along ? d : w) - 0.1;
  b.push({ x: r.cx, z: r.cz, ry: (-(rot - 2) * Math.PI) / 2 });
  const wood = matte(rng.pick([0x6b4a32, 0x5a3e2a, 0x7a5a3e]), { jitter: 0.15, ao: 0.3 });
  const dark = matte(0x2a2622, { jitter: 0.08, ao: 0.2 });
  const fabric = matte(rng.pick([0x4a5a6a, 0x6a4a3a, 0x5a6a4a, 0x7a6a5a]), { jitter: 0.12, ao: 0.35 });
  const white = matte(0xd8d4c8, { jitter: 0.08, ao: 0.3 });
  switch (kind) {
    case 'bed':
      b.box(L, 0.3, D, {}, wood);
      b.rbox(L - 0.06, 0.2, D - 0.06, 0.04, { y: 0.3 }, white);
      b.rbox(L * 0.6, 0.1, 0.35, 0.04, { y: 0.5, z: -D / 2 + 0.25 }, white);
      b.box(L, 0.5, 0.06, { y: 0.3, z: -D / 2 }, wood);
      b.rbox(L - 0.1, 0.06, D * 0.55, 0.03, { y: 0.5, z: D * 0.18 }, fabric);
      break;
    case 'sofa':
      b.rbox(L, 0.42, D, 0.06, {}, fabric);
      b.rbox(L, 0.45, 0.2, 0.06, { y: 0.4, z: -D / 2 + 0.1 }, fabric);
      for (const sx of [-1, 1]) b.rbox(0.18, 0.25, D, 0.05, { x: sx * (L / 2 - 0.09), y: 0.4 }, fabric);
      break;
    case 'table':
    case 'desk':
      b.box(L, 0.05, D, { y: h - 0.05 }, wood);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.06, h - 0.05, 0.06, { x: sx * (L / 2 - 0.06), z: sz * (D / 2 - 0.06) }, wood);
      if (kind === 'desk') b.box(L * 0.35, h - 0.1, D - 0.1, { x: L * 0.3, y: 0.02 }, wood);
      // 桌上的杂物
      b.box(0.25, 0.03, 0.18, { x: rng.range(-L / 3, L / 3), y: h, ry: rng.range(0, 3) }, white);
      b.cyl(0.04, 0.035, 0.1, 8, { x: rng.range(-L / 3, L / 3), y: h, z: 0.1 }, metal(0x8a8e92, { ao: 0 }));
      break;
    case 'chair':
      b.box(0.45, 0.05, 0.45, { y: 0.45 }, wood);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.04, 0.45, 0.04, { x: sx * 0.19, z: sz * 0.19 }, wood);
      b.box(0.45, 0.45, 0.04, { y: 0.5, z: -0.2 }, wood);
      break;
    case 'kitchen':
      b.box(L, h - 0.04, D * 0.9, { z: -D * 0.05 }, white);
      b.box(L + 0.02, 0.04, D, { y: h - 0.04 }, matte(0x5a5a58, { jitter: 0.06, ao: 0 }));
      for (let x = -L / 2 + 0.3; x < L / 2; x += 0.6) b.box(0.12, 0.02, 0.02, { x, y: h - 0.2, z: D * 0.4 }, metal(0x9aa0a4, { ao: 0 }));
      b.box(0.5, 0.02, 0.35, { x: L * 0.2, y: h, z: -0.02 }, metal(0x9aa0a4, { ao: 0 }));
      break;
    case 'stove':
      b.box(L, h, D * 0.9, {}, white);
      for (const [x, z] of [[-0.15, -0.12], [0.15, -0.12], [-0.15, 0.12], [0.15, 0.12]] as const) b.cyl(0.08, 0.08, 0.02, 10, { x, y: h, z }, dark);
      b.box(L - 0.1, 0.4, 0.02, { y: 0.15, z: D * 0.45 }, dark);
      break;
    case 'fridge':
      b.rbox(L * 0.85, h, D * 0.85, 0.04, {}, white);
      b.box(0.03, 0.4, 0.04, { x: L * 0.3, y: h * 0.55, z: D * 0.43 }, metal(0x9aa0a4, { ao: 0 }));
      b.box(L * 0.84, 0.01, 0.02, { y: h * 0.62, z: D * 0.43 }, dark);
      break;
    case 'wardrobe':
    case 'shelf':
      b.box(L, h, D * 0.8, { z: -D * 0.1 }, wood);
      if (kind === 'shelf') {
        for (let y = 0.4; y < h - 0.1; y += 0.45) {
          b.box(L - 0.06, 0.03, D * 0.75, { y, z: -D * 0.08 }, dark);
          for (let x = -L / 2 + 0.12; x < L / 2 - 0.1; x += rng.range(0.08, 0.16)) b.box(0.05, rng.range(0.2, 0.32), 0.18, { x, y: y + 0.03, z: -D * 0.05 }, matte(rng.pick([0x8a3a2a, 0x2a4a6a, 0x5a6a3a, 0xc0b090]), { jitter: 0.1, ao: 0 }));
        }
      } else {
        b.box(0.01, h - 0.1, 0.01, { y: 0.05, z: D * 0.3 }, dark);
        for (const sx of [-1, 1]) b.box(0.03, 0.15, 0.03, { x: sx * 0.06, y: h * 0.5, z: D * 0.31 }, metal(0x9aa0a4, { ao: 0 }));
      }
      break;
    case 'tv':
      b.box(L, 0.45, D * 0.7, {}, wood);
      b.box(L * 0.8, 0.45, 0.06, { y: 0.45, z: -D * 0.1 }, dark);
      b.box(L * 0.74, 0.38, 0.01, { y: 0.48, z: -D * 0.1 + 0.035 }, matte(0x10141a, { jitter: 0, ao: 0 }));
      if (rng.chance(0.3)) b.box(L * 0.7, 0.34, 0.005, { y: 0.5, z: -D * 0.1 + 0.04 }, glow(0x6a8aaa, 0.4));
      break;
  }
  b.pop();
}
