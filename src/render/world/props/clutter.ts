import { Shape } from 'three';
import { Rng } from '../../../game/core/rng';
import { HALF_H, HALF_W } from '../../../game/world/grid';
import type { Prop } from '../../../game/world/types';
import { Builder, Pal } from '../../kit';
import { rectOf, matte, metal, glow } from './kit';

/* 低矮杂物：木箱、水泥墩、加油机、柱子、雨棚、货架、碎石、断墙 */

/** 边长 s 的木板箱：每面 4 块木板（有缝、色差），四边框条，正面斜撑，钉子和喷漆 */
function woodCrate(b: Builder, s: number, rng: Rng): void {
  const gap = matte(0x2a1e14, { jitter: 0, ao: 0.3 });
  b.box(s - 0.04, s - 0.04, s - 0.04, { y: 0.02 }, gap);
  const plank = () => matte(rng.pick([Pal.wood, 0x93744d, 0x7f6140]), { jitter: 0.22, ao: 0.45, aoH: 1.0 });
  const trim = matte(Pal.woodDark, { jitter: 0.15, ao: 0.3 });
  const n = 4;
  const pw = (s - 0.02) / n;
  // 四个侧面：竖放木板
  for (let f = 0; f < 4; f++) {
    b.push({ ry: (f * Math.PI) / 2 });
    for (let i = 0; i < n; i++) {
      const x = -s / 2 + 0.01 + pw * (i + 0.5);
      b.box(pw - 0.012, s - 0.02, 0.025, { x, y: 0.01, z: s / 2 - 0.0125, rz: rng.range(-0.006, 0.006) }, plank());
    }
    // 框条
    for (const y of [0, s - 0.09]) b.box(s, 0.09, 0.03, { y, z: s / 2 + 0.005 }, trim);
    for (const x of [-1, 1]) b.box(0.09, s - 0.18, 0.03, { x: x * (s / 2 - 0.045), y: 0.09, z: s / 2 + 0.005 }, trim);
    // 斜撑（交替方向）
    const d = f % 2 ? 1 : -1;
    const e = s / 2 - 0.1;
    b.rod([-d * e, 0.1, s / 2 + 0.008], [d * e, s - 0.1, s / 2 + 0.008], 0.03, trim, 4);
    // 钉子
    for (const x of [-1, 1]) for (const y of [0.045, s - 0.045]) b.box(0.012, 0.012, 0.01, { x: x * (s / 2 - 0.045), y, z: s / 2 + 0.022 }, metal(0x555555, { ao: 0 }));
    b.pop();
  }
  // 顶盖：横放木板
  for (let i = 0; i < n; i++) b.box(s - 0.02, 0.025, pw - 0.012, { y: s - 0.025, z: -s / 2 + 0.01 + pw * (i + 0.5) }, plank());
  for (const z of [-1, 1]) b.box(s, 0.03, 0.08, { y: s - 0.005, z: z * (s / 2 - 0.04) }, trim);
  // 喷漆标记
  if (rng.chance(0.6)) {
    const f = rng.int(0, 3);
    b.push({ ry: (f * Math.PI) / 2 });
    b.box(s * 0.36, s * 0.14, 0.004, { y: s * 0.62, z: s / 2 + 0.024 }, matte(rng.pick([0x1d1d1d, 0x8a2a20, 0xd6d0c0]), { jitter: 0.25, ao: 0 }));
    b.box(s * 0.22, s * 0.06, 0.004, { y: s * 0.48, z: s / 2 + 0.024 }, matte(0x1d1d1d, { jitter: 0.25, ao: 0 }));
    b.pop();
  }
}

/** 军绿弹药箱：圆角箱体、加强筋、两侧提手、搭扣、模板字 */
function militaryCase(b: Builder, rng: Rng): void {
  const body = matte(Pal.olive, { jitter: 0.15, ao: 0.4 });
  const dark = matte(0x333a28, { jitter: 0.1, ao: 0 });
  const steel = metal(0x8a9094, { ao: 0 });
  b.rbox(0.88, 0.5, 0.6, 0.04, {}, body);
  b.rbox(0.9, 0.14, 0.62, 0.03, { y: 0.49 }, body);
  b.box(0.92, 0.02, 0.64, { y: 0.49 }, dark);
  // 加强筋
  for (const x of [-0.3, 0, 0.3]) b.box(0.04, 0.46, 0.62, { x, y: 0.02 }, body);
  for (const x of [-0.32, 0.32]) b.box(0.05, 0.1, 0.63, { x, y: 0.52 }, body);
  // 搭扣
  for (const x of [-0.22, 0.22]) {
    b.box(0.07, 0.12, 0.02, { x, y: 0.42, z: 0.31 }, steel);
    b.box(0.05, 0.03, 0.025, { x, y: 0.52, z: 0.31 }, steel);
  }
  // 两端提手
  for (const e of [-1, 1]) {
    b.box(0.02, 0.06, 0.2, { x: e * 0.445, y: 0.36 }, steel);
    b.torus(0.07, 0.012, 4, 8, { x: e * 0.465, y: 0.33, ry: Math.PI / 2, rz: Math.PI }, steel, Math.PI);
  }
  // 模板字和色带
  b.box(0.36, 0.06, 0.004, { x: -0.1, y: 0.3, z: 0.301 }, matte(0xd8d2b8, { jitter: 0.25, ao: 0 }));
  b.box(0.2, 0.04, 0.004, { x: -0.18, y: 0.2, z: 0.301 }, matte(0xd8d2b8, { jitter: 0.25, ao: 0 }));
  b.box(0.06, 0.5, 0.004, { x: 0.36, y: 0.02, z: 0.301 }, matte(Pal.hazard, { jitter: 0.1, ao: 0 }));
  if (rng.chance(0.4)) b.box(0.12, 0.12, 0.004, { x: 0.18, y: 0.25, z: 0.301 }, matte(0x8a2a20, { jitter: 0.15, ao: 0 }));
}

export function crate(b: Builder, p: Prop, rng: Rng): void {
  const w = p.x1 - p.x0;
  const d = p.y1 - p.y0;
  const mil = p.variant >= 2 && w === 1 && d === 1;
  for (let ix = 0; ix < w; ix++) {
    for (let iz = 0; iz < d; iz++) {
      const x = p.x0 + ix + 0.5 - HALF_W;
      const z = p.y0 + iz + 0.5 - HALF_H;
      // 多格木箱按设定高度决定叠几层（和子弹的障碍高度一致）
      const levels = w * d > 1 ? ((p.h ?? 0.9) > 1 ? 2 : 1) : 1;
      for (let lv = 0; lv < levels; lv++) {
        const s = w * d > 1 ? 0.92 : Math.min(0.9, (p.h ?? 0.9));
        const yaw = rng.range(-0.15, 0.15);
        b.push({ x, y: lv * s, z, ry: yaw });
        if (mil) {
          militaryCase(b, rng);
        } else {
          woodCrate(b, s, rng);
        }
        b.pop();
      }
    }
  }
}

export function barrier(b: Builder, p: Prop): void {
  const r = rectOf(p);
  const h = p.h ?? 0.9;
  const s = new Shape();
  const k = h / 0.9;
  s.moveTo(-0.32, 0);
  s.lineTo(0.32, 0);
  s.lineTo(0.32, 0.2 * k);
  s.lineTo(0.14, 0.55 * k);
  s.lineTo(0.14, h);
  s.lineTo(-0.14, h);
  s.lineTo(-0.14, 0.55 * k);
  s.lineTo(-0.32, 0.2 * k);
  s.closePath();
  b.push({ x: r.cx, z: r.cz, ry: r.horiz ? Math.PI / 2 : 0 });
  // 每个单元 1 格长，中间留缝
  const n = Math.round(r.L);
  const rng = new Rng(((p.x0 * 31) ^ (p.y0 * 17)) >>> 0);
  for (let i = 0; i < n; i++) {
    const z = -r.L / 2 + 0.5 + i;
    b.push({ z, ry: rng.range(-0.03, 0.03) });
    const concrete = matte(rng.pick([0x7b7a76, 0x86847d, 0x716f6a]), { jitter: 0.22, ao: 0.5, aoH: 0.8 });
    b.extrude(s, 0.94, {}, concrete, 0.025);
    // 底部叉车 / 排水口
    for (const sx of [-1, 1]) b.box(0.02, 0.07, 0.2, { x: sx * 0.32, y: 0.02 }, matte(0x1c1c1a, { jitter: 0, ao: 0 }));
    // 顶部吊环
    b.torus(0.04, 0.01, 4, 8, { y: h + 0.01, z: 0.25 }, metal(Pal.rust, { ao: 0 }), Math.PI);
    b.torus(0.04, 0.01, 4, 8, { y: h + 0.01, z: -0.25 }, metal(Pal.rust, { ao: 0 }), Math.PI);
    // 反光条 / 警示斜纹
    if (i % 2 === 0) {
      for (const sx of [-1, 1]) {
        b.box(0.006, 0.06, 0.8, { x: sx * 0.142, y: h - 0.2 }, matte(0xb5522c, { jitter: 0.1, ao: 0 }));
        b.box(0.006, 0.02, 0.8, { x: sx * 0.142, y: h - 0.12 }, matte(0xd9d6cc, { jitter: 0.1, ao: 0 }));
      }
    }
    // 崩角、污渍
    if (rng.chance(0.35)) b.box(0.12, 0.1, 0.16, { x: rng.chance(0.5) ? 0.12 : -0.12, y: h - 0.07, z: rng.range(-0.35, 0.35), ry: 0.6, rx: 0.4 }, matte(0x55544f, { jitter: 0.2, ao: 0 }));
    b.box(0.005, rng.range(0.08, 0.16), rng.range(0.2, 0.6), { x: 0.322, y: 0.0, z: rng.range(-0.2, 0.2) }, matte(0x4f4a42, { jitter: 0.25, ao: 0 }));
    b.pop();
  }
  b.pop();
}

export function pump(b: Builder, p: Prop, rng: Rng): void {
  const r = rectOf(p);
  b.push({ x: r.cx, z: r.cz, ry: r.horiz ? 0 : Math.PI / 2 });
  const L = r.L;
  const shell = matte(Pal.red, { jitter: 0.15, ao: 0.4, aoH: 1.4 });
  const dark = metal(0x1e1e1e, { ao: 0 });
  // 安全岛：路缘石 + 防撞柱
  b.rbox(L * 0.95, 0.14, 0.95, 0.03, {}, matte(Pal.concreteDark, { ao: 0 }));
  b.box(L * 0.97, 0.03, 0.97, { y: 0.11 }, matte(Pal.hazard, { jitter: 0.1, ao: 0 }));
  for (const e of [-1, 1]) {
    b.cyl(0.07, 0.07, 0.75, 8, { x: e * L * 0.44, y: 0.14 }, matte(Pal.hazard, { jitter: 0.1, ao: 0.2 }));
    b.cyl(0.075, 0.075, 0.08, 8, { x: e * L * 0.44, y: 0.5 }, matte(0x222222, { ao: 0 }));
  }
  // 机身：下部底座、上部屏幕箱、顶部广告灯箱
  b.rbox(L * 0.66, 0.5, 0.52, 0.04, { y: 0.14 }, matte(0x3a3a3a, { jitter: 0.12, ao: 0.4 }));
  b.rbox(L * 0.7, 0.95, 0.48, 0.07, { y: 0.62 }, shell);
  b.rbox(L * 0.74, 0.22, 0.56, 0.04, { y: 1.55 }, matte(Pal.white, { jitter: 0.1, ao: 0 }));
  b.box(L * 0.66, 0.12, 0.57, { y: 1.6 }, glow(0xe8e0d0, 1.0));
  b.box(L * 0.2, 0.08, 0.575, { x: -L * 0.2, y: 1.62 }, glow(0xd84a30, 1.2));
  for (const s of [1, -1]) {
    const z = s * 0.245;
    // 价格屏（发光）、数字条
    b.box(L * 0.3, 0.24, 0.02, { x: -L * 0.12, y: 1.15, z }, matte(0x111111, { ao: 0 }));
    b.box(L * 0.26, 0.05, 0.022, { x: -L * 0.12, y: 1.3, z }, glow(0x66ffaa, 0.9));
    b.box(L * 0.26, 0.05, 0.022, { x: -L * 0.12, y: 1.2, z }, glow(0xffb040, 0.8));
    // 油品选择按钮
    for (let i = 0; i < 3; i++) b.box(0.07, 0.05, 0.025, { x: L * 0.08 + i * 0.09, y: 1.18, z }, matte([0x2a8a3a, 0xc7a52e, 0x2a5a8a][i] as number, { ao: 0 }));
    // 键盘 + 读卡器
    b.box(0.16, 0.12, 0.03, { x: L * 0.17, y: 0.92, z, rx: s * 0.2 }, metal(0x2a2e33, { ao: 0 }));
    // 下部检修面板 + 通风栅
    b.box(L * 0.4, 0.45, 0.02, { y: 0.66, z, x: -L * 0.08 }, matte(0x4a2018, { ao: 0 }));
    for (let i = 0; i < 5; i++) b.box(L * 0.34, 0.012, 0.024, { y: 0.72 + i * 0.07, z, x: -L * 0.08 }, matte(0x2a120e, { ao: 0 }));
    // 油枪挂座 + 油枪 + 软管（软管下垂成弧）
    const gx = L * 0.3;
    b.box(0.1, 0.24, 0.08, { x: gx, y: 0.85, z: s * 0.28 }, dark);
    b.box(0.05, 0.16, 0.05, { x: gx, y: 0.92, z: s * 0.33, rx: s * 0.4 }, matte(0x111111, { ao: 0 }));
    b.rod([gx, 0.88, s * 0.36], [gx + 0.04, 0.95, s * 0.42], 0.012, metal(0x9aa0a4, { ao: 0 }), 4);
    const hose: Array<[number, number, number]> = [
      [gx, 1.45, s * 0.25], [gx + 0.12, 1.1, s * 0.34], [gx + 0.12, 0.55, s * 0.38], [gx + 0.05, 0.35, s * 0.36], [gx, 0.85, s * 0.32],
    ];
    for (let i = 0; i + 1 < hose.length; i++) b.rod(hose[i] as [number, number, number], hose[i + 1] as [number, number, number], 0.022, matte(0x151515, { ao: 0 }), 5);
  }
  // 侧面的灭火器
  b.cyl(0.07, 0.07, 0.42, 8, { x: -L * 0.42, y: 0.14, z: 0.3 }, matte(0xb82a20, { jitter: 0.1, ao: 0.2 }));
  b.cyl(0.03, 0.04, 0.06, 6, { x: -L * 0.42, y: 0.56, z: 0.3 }, dark);
  if (rng.chance(0.5)) b.cyl(0.35, 0.35, 0.004, 10, { x: L * 0.3, y: 0.141, sz: 0.6 }, matte(0x151210, { ao: 0, jitter: 0 }));
  b.pop();
}

export function pillar(b: Builder, p: Prop): void {
  const cx = (p.x0 + p.x1) / 2 - HALF_W;
  const cz = (p.y0 + p.y1) / 2 - HALF_H;
  const h = p.h ?? 3.4;
  b.box(0.7, 0.2, 0.7, { x: cx, z: cz }, matte(Pal.concreteDark, { ao: 0 }));
  b.cyl(0.18, 0.2, h, 8, { x: cx, z: cz, y: 0.2 }, matte(Pal.concreteLight, { jitter: 0.12, ao: 0.4, aoH: 1.5 }));
  for (let i = 0; i < 4; i++) b.cyl(0.215, 0.215, 0.12, 8, { x: cx, z: cz, y: 0.3 + i * 0.12 }, matte(i % 2 ? 0x222222 : Pal.hazard, { jitter: 0, ao: 0 }));
  b.box(0.5, 0.15, 0.5, { x: cx, z: cz, y: h + 0.05 }, matte(Pal.concreteDark, { ao: 0 }));
}

export function canopy(b: Builder, p: Prop): void {
  const r = rectOf(p);
  const h = p.h ?? 3.4;
  const w = p.x1 - p.x0;
  const d = p.y1 - p.y0;
  const cx = r.cx;
  const cz = r.cz;
  // 只做边梁和椽条，不遮挡下面的加油机
  const edge = (len: number, x: number, z: number, ry: number, i: number) => {
    b.box(len, 0.28, 0.2, { x, y: h, z, ry }, matte(i % 2 ? Pal.red : Pal.white, { jitter: 0.1, ao: 0.1 }));
  };
  edge(w, cx, cz - d / 2, 0, 0);
  edge(w, cx, cz + d / 2, 0, 1);
  edge(d, cx - w / 2, cz, Math.PI / 2, 1);
  edge(d, cx + w / 2, cz, Math.PI / 2, 0);
  for (let x = -w / 2 + 2.8; x < w / 2 - 0.5; x += 2.8) {
    b.box(0.05, 0.1, d, { x: cx + x, y: h + 0.06, z: cz }, metal(0x59636b, { jitter: 0.08, ao: 0 }));
  }
  for (const z of [-d / 4, d / 4]) {
    b.box(w, 0.06, 0.06, { x: cx, y: h + 0.04, z: cz + z }, metal(0x59636b, { jitter: 0.08, ao: 0 }));
    for (let x = -w / 2 + 2; x < w / 2; x += 3.5) b.box(0.5, 0.05, 0.14, { x: cx + x, y: h - 0.03, z: cz + z }, glow(0xdfeaff, 2.0));
  }
}

export function rack(b: Builder, p: Prop, rng: Rng): void {
  const r = rectOf(p);
  b.push({ x: r.cx, z: r.cz, ry: r.horiz ? 0 : Math.PI / 2 });
  const L = r.L;
  const H = p.h ?? 2.0;
  for (let x = -L / 2 + 0.05; x <= L / 2 - 0.04; x += Math.min(1.0, L - 0.1)) {
    for (const z of [-0.4, 0.4]) b.box(0.08, H, 0.08, { x, z }, metal(0x2c4a6a, { jitter: 0.1, ao: 0.4 }));
  }
  // 立柱上的冲孔、底脚、交叉拉杆
  for (let x = -L / 2 + 0.05; x <= L / 2 - 0.04; x += Math.min(1.0, L - 0.1)) {
    for (const z of [-0.4, 0.4]) {
      for (let y = 0.25; y < H - 0.1; y += 0.15) b.box(0.03, 0.05, 0.085, { x, y, z }, matte(0x111418, { jitter: 0, ao: 0 }));
      b.box(0.14, 0.02, 0.14, { x, z }, metal(0x2c4a6a, { ao: 0 }));
    }
    b.rod([x, 0.15, -0.4], [x, H * 0.5, 0.4], 0.012, metal(0x2c4a6a, { ao: 0 }), 4);
    b.rod([x, H * 0.5, -0.4], [x, H - 0.1, 0.4], 0.012, metal(0x2c4a6a, { ao: 0 }), 4);
  }
  for (const y of [0.12, 0.8, 1.48]) {
    // 橙色横梁 + 木托板
    for (const z of [-0.42, 0.42]) b.box(L, 0.1, 0.05, { y: y - 0.06, z }, metal(0xb8741f, { jitter: 0.15, ao: 0.1 }));
    b.box(L - 0.1, 0.04, 0.84, { y }, matte(Pal.wood, { jitter: 0.2, ao: 0.1 }));
    for (let x = -L / 2 + 0.2; x < L / 2 - 0.1; x += 0.25) b.box(0.012, 0.042, 0.84, { x, y: y + 0.001 }, matte(Pal.woodDark, { jitter: 0, ao: 0 }));
    for (let x = -L / 2 + 0.3; x < L / 2 - 0.2; x += rng.range(0.6, 0.95)) {
      const bw = rng.range(0.35, 0.65);
      const bh = rng.range(0.25, 0.55);
      if (rng.chance(0.2)) continue;
      if (rng.chance(0.3)) b.cyl(0.2, 0.2, bh, 8, { x, y: y + 0.05, z: rng.range(-0.15, 0.15) }, matte(rng.pick([0x2f5f8a, 0x9a3a2a, 0x7a4a2a]), { jitter: 0.15, ao: 0.2 }));
      else b.box(bw, bh, rng.range(0.4, 0.7), { x, y: y + 0.05, z: rng.range(-0.1, 0.1), ry: rng.range(-0.1, 0.1) }, matte(rng.pick([0xa68660, 0x8a6f4a, 0x7c6a52]), { jitter: 0.15, ao: 0.2 }));
    }
  }
  b.pop();
}

export function rubble(b: Builder, p: Prop, rng: Rng): void {
  const w = p.x1 - p.x0;
  const d = p.y1 - p.y0;
  const cx = (p.x0 + p.x1) / 2 - HALF_W;
  const cz = (p.y0 + p.y1) / 2 - HALF_H;
  const n = Math.floor(w * d * (p.variant === 1 ? 2.2 : 1.4));
  for (let i = 0; i < n; i++) {
    const x = cx + rng.range(-w / 2 + 0.2, w / 2 - 0.2);
    const z = cz + rng.range(-d / 2 + 0.2, d / 2 - 0.2);
    const mound = 1 - Math.min(1, Math.hypot((x - cx) / (w / 2), (z - cz) / (d / 2)));
    const s = rng.range(0.15, p.variant === 1 ? 0.5 : 0.35);
    b.box(s, s * rng.range(0.5, 1.0), s * rng.range(0.7, 1.2), { x, z, y: mound * 0.28, rx: rng.range(-0.5, 0.5), ry: rng.range(0, 3.2), rz: rng.range(-0.5, 0.5) }, matte(rng.pick([Pal.concreteDark, Pal.concrete, 0x6d5f52]), { jitter: 0.22, ao: 0.3 }));
  }
  for (let i = 0; i < Math.max(2, Math.floor(w * d / 6)); i++) {
    const x = cx + rng.range(-w / 2 + 0.4, w / 2 - 0.4);
    const z = cz + rng.range(-d / 2 + 0.4, d / 2 - 0.4);
    b.rod([x, 0.1, z], [x + rng.range(-0.4, 0.4), rng.range(0.5, 0.9), z + rng.range(-0.4, 0.4)], 0.022, metal(Pal.rust, { jitter: 0.2, ao: 0 }), 4);
  }
}

export function chunk(b: Builder, p: Prop, rng: Rng): void {
  const cx = (p.x0 + p.x1) / 2 - HALF_W;
  const cz = (p.y0 + p.y1) / 2 - HALF_H;
  const h = p.h ?? 1.3;
  b.push({ x: cx, z: cz, ry: rng.range(0, 3) });
  // 断墙：锯齿状的断面轮廓
  const s = new Shape();
  s.moveTo(-0.47, 0);
  s.lineTo(0.47, 0);
  s.lineTo(0.47, h * 0.55);
  s.lineTo(0.3, h * 0.7);
  s.lineTo(0.18, h * 0.62);
  s.lineTo(0.05, h);
  s.lineTo(-0.15, h * 0.88);
  s.lineTo(-0.3, h * 0.95);
  s.lineTo(-0.47, h * 0.78);
  s.closePath();
  b.extrude(s, 0.4, { y: 0.02, rz: 0.06, rx: 0.05 }, matte(Pal.concrete, { jitter: 0.22, ao: 0.5, aoH: 1.2 }), 0.03);
  // 露出的砌块分层
  for (let y = 0.3; y < h * 0.5; y += 0.3) b.box(0.94, 0.02, 0.41, { y, rz: 0.06, rx: 0.05 }, matte(0x6e6c66, { jitter: 0.1, ao: 0 }));
  b.box(0.5, 0.45, 0.35, { x: 0.25, z: 0.3, y: 0, ry: 0.7, rx: 0.2 }, matte(Pal.concreteDark, { jitter: 0.2 }));
  for (let i = 0; i < 4; i++) {
    const t = rng.range(0.1, 0.25);
    b.box(t, t * 0.7, t, { x: rng.range(-0.6, 0.6), z: rng.range(-0.5, 0.6), ry: rng.range(0, 3), rx: rng.range(-0.4, 0.4) }, matte(rng.pick([Pal.concreteDark, Pal.concrete]), { jitter: 0.2 }));
  }
  b.rod([-0.2, h * 0.9, 0], [-0.1, h + 0.55, 0.05], 0.025, metal(Pal.rust, { ao: 0 }), 4);
  b.rod([0.1, h * 0.85, 0.05], [0.25, h + 0.4, -0.05], 0.025, metal(Pal.rust, { ao: 0 }), 4);
  b.pop();
}
