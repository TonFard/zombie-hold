import { Shape } from 'three';
import { Rng } from '../../../game/core/rng';
import type { Prop } from '../../../game/world/types';
import { Builder, Pal } from '../../kit';
import { rectOf, matte, metal } from './kit';

/* 集装箱 */

const CONTAINER_COLORS = [0x9c3b2e, 0x2f5a7a, 0x4d6a3e, 0xc27a2a, 0x8d8a80, 0x6b2f2f];

/**
 * 波纹板的截面：沿 X 长 len，外侧凸起 depth，背面厚 0.015。
 * 挤出方向是板的高度；外凸朝 +Y（摆放时再转到朝外）。
 */
function corrugation(len: number, period: number, depth: number): Shape {
  const s = new Shape();
  const half = len / 2;
  s.moveTo(-half, -0.015);
  s.lineTo(half, -0.015);
  s.lineTo(half, 0);
  const flat = period * 0.36;
  const slope = period * 0.14;
  let x = half;
  // 从右往左：内平 → 斜坡 → 外平 → 斜坡
  while (x - period > -half) {
    s.lineTo(x - flat, 0);
    s.lineTo(x - flat - slope, depth);
    s.lineTo(x - flat * 2 - slope, depth);
    s.lineTo(x - period, 0);
    x -= period;
  }
  s.lineTo(-half, 0);
  s.closePath();
  return s;
}

export function container(b: Builder, p: Prop, rng: Rng): void {
  const r = rectOf(p);
  const L = r.L - 0.12;
  const W = Math.min(r.T - 0.12, 1.9);
  const H = 2.3;
  const col = CONTAINER_COLORS[(p.variant + (p.x0 % 3)) % CONTAINER_COLORS.length] as number;
  const dark = Pal.steel;
  const hole = matte(0x141414, { jitter: 0, ao: 0 });
  const paint = metal(col, { jitter: 0.2, ao: 0.5, aoH: 1.6 });
  const frame = metal(dark, { jitter: 0.06, ao: 0.1 });
  b.push({ x: r.cx, z: r.cz, ry: r.horiz ? 0 : Math.PI / 2 });

  // 底架 + 内胆（挡住波纹板之间的缝）
  b.box(L, 0.14, W, {}, matte(dark, { ao: 0 }));
  b.box(L - 0.2, H - 0.3, W - 0.14, { y: 0.14 }, metal(col, { jitter: 0.1, ao: 0.6, aoH: 1.6 }));
  const panelH = H - 0.3;
  const side = corrugation(L - 0.36, 0.28, 0.04);
  for (const s of [1, -1]) {
    b.extrude(side, panelH, { y: 0.15 + panelH / 2, z: s * (W / 2 - 0.06), rx: s > 0 ? Math.PI / 2 : -Math.PI / 2 }, paint);
  }
  // 封闭端的波纹板（竖纹沿 Z）
  b.extrude(corrugation(W - 0.3, 0.28, 0.035), panelH, { x: -L / 2 + 0.07, y: 0.15 + panelH / 2, ry: -Math.PI / 2, rx: Math.PI / 2 }, paint);
  // 顶板：浅波纹沿 X
  for (let x = -L / 2 + 0.35; x < L / 2 - 0.3; x += 0.42) b.box(0.18, 0.025, W - 0.22, { x, y: H - 0.06 }, metal(col, { jitter: 0.2, ao: 0 }));
  b.box(L - 0.2, 0.02, W - 0.2, { y: H - 0.07 }, metal(col, { jitter: 0.15, ao: 0 }));

  // 框架：上下纵梁、端梁、角柱、角件（带孔）
  for (const s of [1, -1]) {
    b.box(L, 0.16, 0.14, { y: H - 0.16, z: s * (W / 2 - 0.07) }, frame);
    b.box(L, 0.18, 0.14, { y: 0.08, z: s * (W / 2 - 0.07) }, frame);
    // 叉车槽
    for (const x of [-L * 0.22, L * 0.22]) b.box(0.36, 0.1, 0.02, { x, y: 0.11, z: s * (W / 2 + 0.002) }, hole);
    for (const e of [1, -1]) {
      const cx = e * (L / 2 - 0.09);
      const cz = s * (W / 2 - 0.09);
      b.box(0.16, H - 0.3, 0.16, { x: cx, y: 0.15, z: cz }, frame);
      for (const y of [0, H - 0.18]) {
        b.box(0.2, 0.18, 0.2, { x: cx, y, z: cz }, metal(0x2b3138, { jitter: 0.05, ao: 0 }));
        b.box(0.1, 0.06, 0.02, { x: cx, y: y + 0.06, z: cz + s * 0.1 }, hole);
        b.box(0.02, 0.06, 0.08, { x: cx + e * 0.1, y: y + 0.06, z: cz }, hole);
      }
    }
  }
  for (const e of [1, -1]) {
    b.box(0.14, 0.2, W, { x: e * (L / 2 - 0.07), y: H - 0.2 }, frame);
    b.box(0.14, 0.18, W, { x: e * (L / 2 - 0.07), y: 0.08 }, frame);
  }

  // 门端：两扇门，横向压筋、4 根锁杆、凸轮座、把手、铰链
  const ex = L / 2 - 0.05;
  const doorH = H - 0.5;
  const leafW = W / 2 - 0.12;
  const doorStyle = metal(col, { jitter: 0.18, ao: 0.45, aoH: 1.6 });
  const rodStyle = metal(0x9aa0a4, { jitter: 0.05, ao: 0 });
  const leaf = (open: boolean, s: number) => {
    // s = +1 右扇（铰链在 +Z），-1 左扇
    const hingeZ = s * (W / 2 - 0.16);
    b.push({ x: ex, y: 0.26, z: hingeZ, ry: open ? -s * 1.9 : 0 });
    const mid = -s * leafW / 2;
    b.box(0.04, doorH, leafW, { z: mid }, doorStyle);
    for (let y = 0.25; y < doorH - 0.1; y += 0.42) b.box(0.03, 0.2, leafW - 0.1, { x: 0.03, y, z: mid }, doorStyle);
    for (const f of [0.28, 0.72]) {
      const z = -s * leafW * f;
      b.cyl(0.024, 0.024, doorH + 0.1, 6, { x: 0.07, y: -0.05, z }, rodStyle);
      for (const y of [-0.04, doorH - 0.02]) b.box(0.06, 0.08, 0.08, { x: 0.06, y, z }, metal(0x6a7076, { ao: 0 }));
      b.box(0.04, 0.05, 0.05, { x: 0.08, y: 1.05, z }, rodStyle);
      b.rod([0.08, 1.07, z], [0.13, 0.75, z + s * 0.02], 0.016, rodStyle, 4);
    }
    // 铰链
    for (const y of [0.15, doorH / 2, doorH - 0.2]) b.box(0.06, 0.1, 0.06, { x: 0.02, y, z: 0 }, metal(0x6a7076, { ao: 0 }));
    // 海关铅封 / 标签
    if (s > 0) b.box(0.01, 0.22, 0.3, { x: 0.03, y: 1.35, z: mid }, matte(Pal.white, { jitter: 0.2, ao: 0 }));
    b.pop();
  };
  const ajar = p.variant % 2 === 1;
  b.box(0.02, doorH, W - 0.3, { x: ex - 0.04, y: 0.26 }, matte(0x16130f, { jitter: 0, ao: 0 }));
  leaf(false, -1);
  leaf(ajar, 1);

  // 通风口、编号、色带
  for (const s of [1, -1]) {
    for (const e of [-1, 1]) {
      const vx = e * (L / 2 - 0.5);
      b.box(0.22, 0.12, 0.03, { x: vx, y: H - 0.42, z: s * (W / 2 - 0.005) }, metal(0x5f666c, { ao: 0 }));
      for (let i = 0; i < 3; i++) b.box(0.18, 0.012, 0.035, { x: vx, y: H - 0.4 + i * 0.035, z: s * (W / 2 - 0.003) }, hole);
    }
    const zz = s * (W / 2 + 0.03);
    b.box(L * 0.33, 0.3, 0.012, { x: -L * 0.12, y: 1.55, z: zz }, matte(Pal.white, { jitter: 0.2, ao: 0 }));
    for (let i = 0; i < 7; i++) b.box(0.13, 0.16, 0.014, { x: -L * 0.12 - L * 0.13 + i * 0.17, y: 1.62, z: zz }, matte(0x222222, { jitter: 0, ao: 0 }));
    b.box(L * 0.18, 0.07, 0.014, { x: -L * 0.12, y: 1.32, z: zz }, matte(0x222222, { jitter: 0, ao: 0 }));
    b.box(0.5, 0.5, 0.012, { x: L * 0.25, y: 1.4, z: zz }, matte(rng.pick([Pal.white, 0x222222, Pal.hazard]), { jitter: 0.15, ao: 0 }));
  }
  // 锈迹：从角件往下淌
  for (let i = 0; i < 6; i++) {
    const s = rng.chance(0.5) ? 1 : -1;
    const x = rng.range(-L / 2 + 0.4, L / 2 - 0.4);
    b.box(rng.range(0.08, 0.35), rng.range(0.4, 1.4), 0.006, { x, y: rng.range(0.2, H - 1.6), z: s * (W / 2 + 0.045) }, matte(0x4c3a2e, { jitter: 0.3, ao: 0 }));
  }
  // 凹痕：一块往里压的板
  if (rng.chance(0.6)) {
    const s = rng.chance(0.5) ? 1 : -1;
    b.box(rng.range(0.6, 1.2), rng.range(0.4, 0.8), 0.02, { x: rng.range(-L / 3, L / 3), y: rng.range(0.4, 1.0), z: s * (W / 2 - 0.02), rx: s * 0.12 }, metal(col, { jitter: 0.3, ao: 0.3 }));
  }
  b.pop();
}
