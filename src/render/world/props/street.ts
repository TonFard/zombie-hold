import { Rng } from '../../../game/core/rng';
import { HALF_H, HALF_W } from '../../../game/world/grid';
import type { Prop } from '../../../game/world/types';
import { Builder, Pal } from '../../kit';
import { rectOf, matte, metal, glow, latheY } from './kit';

/* 街道杂物：路灯、油桶、沙袋、铁丝网 */

export function lamp(b: Builder, p: Prop): void {
  const cx = (p.x0 + p.x1) / 2 - HALF_W;
  const cz = (p.y0 + p.y1) / 2 - HALF_H;
  const h = p.h ?? 4.2;
  b.push({ x: cx, z: cz, ry: (p.variant * Math.PI) / 2 });
  const steel = metal(0x2f3236, { jitter: 0.1, ao: 0.4, aoH: 2 });
  // 混凝土基座 + 法兰 + 4 颗地脚螺栓
  b.cyl(0.24, 0.27, 0.12, 10, {}, matte(Pal.concreteDark, { ao: 0 }));
  b.cyl(0.16, 0.18, 0.06, 10, { y: 0.12 }, metal(Pal.steel, { ao: 0 }));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    b.cyl(0.02, 0.02, 0.05, 6, { x: Math.cos(a) * 0.13, z: Math.sin(a) * 0.13, y: 0.17 }, metal(0x8a8e92, { ao: 0 }));
  }
  // 灯杆：锥形，下段检修门
  b.cyl(0.06, 0.1, h - 0.18, 10, { y: 0.18 }, steel);
  b.box(0.1, 0.32, 0.015, { y: 0.5, z: 0.092 }, metal(0x3a3d42, { ao: 0 }));
  b.cyl(0.11, 0.11, 0.06, 10, { y: 0.9 }, metal(0x3a3d42, { ao: 0 }));
  // 路牌 / 小广告
  if (p.variant % 2 === 0) b.box(0.3, 0.42, 0.01, { y: 1.9, z: 0.08 }, matte(rng0(p) ? 0x2a5a8a : Pal.white, { jitter: 0.25, ao: 0 }));
  // 灯臂：两段弯管，加一根斜撑
  b.rod([0, h - 0.1, 0], [0.35, h + 0.12, 0], 0.04, steel, 6);
  b.rod([0.35, h + 0.12, 0], [0.75, h + 0.18, 0], 0.035, steel, 6);
  b.rod([0, h - 0.45, 0], [0.3, h + 0.1, 0], 0.018, steel, 4);
  // 灯头：扁壳 + 玻璃罩 + 散热鳍
  b.rbox(0.56, 0.12, 0.26, 0.04, { x: 0.8, y: h + 0.1 }, metal(0x3a3d42, { jitter: 0.08, ao: 0 }));
  for (let i = 0; i < 4; i++) b.box(0.4, 0.03, 0.01, { x: 0.8, y: h + 0.22, z: -0.09 + i * 0.06 }, metal(0x3a3d42, { ao: 0 }));
  b.box(0.42, 0.03, 0.19, { x: 0.8, y: h + 0.075 }, glow(0xffd9a0, 2.8));
  // 电线垂下来（有些灯坏了，线断了）
  if (p.variant === 3) b.rod([0.1, h - 0.2, 0.05], [0.25, h - 1.1, 0.12], 0.008, matte(0x111111, { ao: 0 }), 3);
  b.pop();
}

function rng0(p: Prop): boolean {
  return ((p.x0 * 7 + p.y0 * 13) & 1) === 0;
}

export function barrel(b: Builder, p: Prop, rng: Rng): void {
  const cx = (p.x0 + p.x1) / 2 - HALF_W + rng.range(-0.1, 0.1);
  const cz = (p.y0 + p.y1) / 2 - HALF_H + rng.range(-0.1, 0.1);
  const col = [0x2f5f8a, 0x9a3a2a, 0xc7a52e, 0x7a4a2a][p.variant % 4] as number;
  const lying = p.variant === 3;
  b.push({ x: cx, z: cz, y: lying ? 0.3 : 0, rx: lying ? Math.PI / 2 : 0, ry: rng.range(0, 6) });
  const paint = metal(col, { jitter: 0.25, ao: 0.45, aoH: 0.9 });
  // 车削出卷边、两道滚箍和略鼓的桶身
  const R = 0.3;
  b.add(
    latheY([
      [0.0, 0.02], [0.28, 0.02], [0.295, 0.0], [0.305, 0.0], [0.305, 0.04], [R - 0.005, 0.06],
      [R, 0.27], [0.314, 0.29], [0.314, 0.31], [R, 0.33], [R + 0.006, 0.45], [R, 0.57],
      [0.314, 0.59], [0.314, 0.61], [R, 0.63], [R - 0.005, 0.84], [0.305, 0.86], [0.305, 0.9],
      [0.295, 0.9], [0.28, 0.88], [0.0, 0.88],
    ], 16),
    {},
    paint,
  );
  // 顶盖：两个螺塞、凹面
  b.cyl(0.27, 0.27, 0.008, 16, { y: 0.875 }, metal(0x7a7e82, { jitter: 0.1, ao: 0 }));
  b.cyl(0.04, 0.04, 0.025, 8, { x: 0.17, y: 0.88 }, metal(0x9aa0a4, { ao: 0 }));
  b.cyl(0.025, 0.025, 0.02, 6, { x: -0.18, y: 0.88, z: 0.04 }, metal(0x9aa0a4, { ao: 0 }));
  // 标签 / 危险品菱形
  b.push({ ry: rng.range(0, 6) });
  b.box(0.22, 0.2, 0.01, { y: 0.38, z: R + 0.005 }, matte(Pal.white, { jitter: 0.2, ao: 0 }));
  b.box(0.12, 0.12, 0.01, { y: 0.42, z: R + 0.008, rz: Math.PI / 4 }, matte(p.variant === 1 ? 0xd6a824 : 0xa8362a, { jitter: 0.1, ao: 0 }));
  b.pop();
  // 锈迹和流挂
  for (let i = 0; i < 3; i++) {
    const a = rng.range(0, 6.28);
    b.box(rng.range(0.06, 0.14), rng.range(0.1, 0.3), 0.006, { x: Math.sin(a) * (R + 0.003), z: Math.cos(a) * (R + 0.003), y: rng.range(0.05, 0.6), ry: a }, matte(0x4c3a2e, { jitter: 0.3, ao: 0 }));
  }
  b.pop();
  // 倒地的桶漏出一滩油
  if (lying) b.cyl(0.5, 0.5, 0.005, 12, { x: cx + 0.2, z: cz + 0.5, sz: 0.7 }, matte(0x0d0c0a, { jitter: 0.05, ao: 0 }));
}


export function sandbag(b: Builder, p: Prop, rng: Rng): void {
  const r = rectOf(p);
  b.push({ x: r.cx, z: r.cz, ry: r.horiz ? 0 : Math.PI / 2 });
  const rows = Math.max(1, Math.round(r.T));
  // 4 层，越往上越窄（金字塔码法），总高约 0.85 和障碍高度一致
  const layers = 4;
  for (let layer = 0; layer < layers; layer++) {
    const inset = layer * 0.04;
    for (let row = 0; row < rows; row++) {
      for (let x = -r.L / 2 + 0.24 + inset + (layer % 2) * 0.22; x < r.L / 2 - 0.12 - inset; x += 0.44) {
        const z = (row - (rows - 1) / 2) * 0.4 + rng.range(-0.025, 0.025);
        const y = layer * 0.205;
        const ry = rng.range(-0.1, 0.1);
        const col = rng.pick([Pal.sandbag, 0x938660, 0x9d8f68, 0x857a58]);
        b.push({ x, y, z, ry, rz: rng.range(-0.04, 0.04) });
        // 鼓起的袋身：压扁的球 + 圆角盒
        b.rbox(0.44, 0.2, 0.32, 0.08, {}, matte(col, { jitter: 0.2, ao: 0.4, aoH: 0.4 }));
        b.sphere(0.2, 8, 5, { y: 0.11, sx: 1.05, sy: 0.42, sz: 0.75 }, matte(col, { jitter: 0.2, ao: 0.2, aoH: 0.4 }));
        // 扎口：收紧的一端
        b.cyl(0.05, 0.07, 0.035, 6, { x: 0.215, y: 0.1, rz: -Math.PI / 2 }, matte(col, { jitter: 0.2, ao: 0 }));
        b.cyl(0.03, 0.03, 0.015, 6, { x: 0.25, y: 0.1, rz: -Math.PI / 2 }, matte(0x5a4a30, { jitter: 0.1, ao: 0 }));
        // 缝线
        b.box(0.4, 0.008, 0.005, { y: 0.1, z: 0.161 }, matte(0x6a5e40, { jitter: 0, ao: 0 }));
        b.pop();
      }
    }
  }
  // 漏出的沙堆
  for (let i = 0; i < 2; i++) {
    const s = rng.chance(0.5) ? 1 : -1;
    b.sphere(0.2, 12, 4, { x: rng.range(-r.L / 2 + 0.4, r.L / 2 - 0.4), z: s * (r.T * 0.2 + 0.24), sy: 0.15 }, matte(0x9a8d68, { jitter: 0.25, ao: 0.2 }));
  }
  b.pop();
}

export function fence(b: Builder, p: Prop, rng: Rng): void {
  const r = rectOf(p);
  b.push({ x: r.cx, z: r.cz, ry: r.horiz ? 0 : Math.PI / 2 });
  const pole = metal(0x6b6f72, { jitter: 0.1, ao: 0.2 });
  const wire = metal(0x7a7e80, { jitter: 0.1, ao: 0 });
  const posts: Array<[number, number, number]> = [];
  for (let x = -r.L / 2; x <= r.L / 2 + 0.01; x += 1.5) {
    const lean = rng.range(-0.12, 0.12);
    posts.push([x, lean, rng.range(-0.08, 0.08)]);
    b.cyl(0.03, 0.035, 1.55, 6, { x, rx: lean, rz: rng.range(-0.08, 0.08) }, pole);
    b.cyl(0.05, 0.05, 0.03, 6, { x, y: 1.55 }, pole);
    b.box(0.12, 0.08, 0.12, { x }, matte(Pal.concreteDark, { ao: 0 }));
  }
  // 顶 / 中 / 底拉线，略微下垂
  for (const y of [0.1, 0.78, 1.5]) {
    for (let i = 0; i + 1 < posts.length; i++) {
      const a = posts[i] as [number, number, number];
      const c = posts[i + 1] as [number, number, number];
      const za = -Math.sin(a[1]) * y;
      const zc = -Math.sin(c[1]) * y;
      const mx = (a[0] + c[0]) / 2;
      b.rod([a[0], y, za], [mx, y - 0.05, (za + zc) / 2], 0.008, wire, 3);
      b.rod([mx, y - 0.05, (za + zc) / 2], [c[0], y, zc], 0.008, wire, 3);
    }
  }
  // 铁丝网：斜交的细线做出菱形网格（每段 1.5 米 8 根斜线）
  for (let i = 0; i + 1 < posts.length; i++) {
    const a = posts[i] as [number, number, number];
    const c = posts[i + 1] as [number, number, number];
    if (rng.chance(0.2)) continue; // 有的网片被剪掉了
    const span = c[0] - a[0];
    const step = span / 6;
    for (let k = 0; k <= 6; k++) {
      const x0 = a[0] + k * step;
      b.rod([x0, 0.12, 0], [Math.min(c[0], x0 + 1.38), Math.min(1.48, 0.12 + (c[0] - x0)), 0], 0.004, wire, 3);
      b.rod([x0, 0.12, 0], [Math.max(a[0], x0 - 1.38), Math.min(1.48, 0.12 + (x0 - a[0])), 0], 0.004, wire, 3);
    }
  }
  b.pop();
}
