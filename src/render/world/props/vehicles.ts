import { Shape } from 'three';
import { Rng } from '../../../game/core/rng';
import type { Prop } from '../../../game/world/types';
import { Builder, Pal } from '../../kit';
import { rectOf, matte, metal, glow } from './kit';

/* 报废车辆 */

const CAR_COLORS = [0x8f3a30, 0x35566e, 0xb5b0a2, 0x55663f, 0xb8982f, 0x6a5a4a, 0x7a8286];

export function car(b: Builder, p: Prop, rng: Rng): void {
  const r = rectOf(p);
  const L = r.L - 0.3;
  const W = Math.min(r.T - 0.2, 1.75);
  const kind = p.variant % 4; // 0 轿车 1 两厢 2 厢式货车 3 皮卡
  const col = rng.pick(CAR_COLORS);
  const paint = metal(col, { jitter: 0.2, ao: 0.4, aoH: 0.8 });
  const paintClean = metal(col, { jitter: 0.16, ao: 0.1 });
  const trim = matte(0x1d1f22, { jitter: 0.05, ao: 0 });
  const chrome = metal(0x9aa2a8, { jitter: 0.05, ao: 0 });
  const glass = metal(Pal.glass, { jitter: 0.04, ao: 0 });
  const H = L / 2;
  b.push({ x: r.cx, z: r.cz, ry: (r.horiz ? 0 : Math.PI / 2) + rng.range(-0.06, 0.06) });
  b.push({ rz: rng.range(-0.04, 0.04) });

  // 车身侧面轮廓（x 沿车长，y 向上），沿车宽挤出，带倒角——比叠盒子圆润得多
  const ride = 0.24; // 车身底边离地
  const belt = kind === 2 ? 1.25 : 0.86; // 腰线高度
  const arch = 0.38; // 轮拱半径
  const wx = L * 0.32; // 轮距（前后轴到中心）
  const body = new Shape();
  body.moveTo(-H, ride + 0.08);
  body.lineTo(-wx - arch - 0.02, ride);
  body.absarc(-wx, ride, arch, Math.PI, 0, true);
  body.lineTo(wx - arch, ride);
  body.absarc(wx, ride, arch, Math.PI, 0, true);
  body.lineTo(H, ride + 0.08);
  body.lineTo(H + 0.02, belt - 0.22);
  body.quadraticCurveTo(H, belt - 0.02, H - 0.2, belt);
  body.lineTo(-H + 0.15, belt);
  body.quadraticCurveTo(-H, belt - 0.02, -H - 0.01, belt - 0.2);
  body.lineTo(-H, ride + 0.08);
  b.extrude(body, W * 0.96, {}, paint, 0.05);
  // 底盘裙边（黑）
  b.box(L * 0.92, 0.12, W * 0.82, { y: ride - 0.02 }, matte(0x18191b, { ao: 0 }));

  // 驾驶舱：梯形轮廓（前风挡斜、后窗斜），玻璃是同一轮廓内缩一点、往外凸出
  const cabin = (x0: number, x1: number, top: number, rake0: number, rake1: number, width: number) => {
    const s = new Shape();
    s.moveTo(x0, belt - 0.01);
    s.lineTo(x1, belt - 0.01);
    s.lineTo(x1 - rake1, top);
    s.lineTo(x0 + rake0, top);
    s.lineTo(x0, belt - 0.01);
    b.extrude(s, width, {}, paintClean, 0.04);
    // 侧窗
    const g = new Shape();
    const m = 0.07;
    g.moveTo(x0 + m * 1.6, belt + 0.05);
    g.lineTo(x1 - m * 1.6, belt + 0.05);
    g.lineTo(x1 - rake1 - m * 0.6, top - m);
    g.lineTo(x0 + rake0 + m * 0.6, top - m);
    g.lineTo(x0 + m * 1.6, belt + 0.05);
    b.extrude(g, width + 0.02, {}, glass);
    // 风挡 / 后窗：斜面上的玻璃片
    const fz = width * 0.84;
    const fl = Math.hypot(rake1, top - belt) - 0.08;
    b.box(0.02, fl, fz, { x: x1 - rake1 / 2 + 0.008, y: (top + belt) / 2, rz: Math.atan2(rake1, top - belt) }, glass);
    const bl = Math.hypot(rake0, top - belt) - 0.08;
    b.box(0.02, bl, fz, { x: x0 + rake0 / 2 - 0.008, y: (top + belt) / 2, rz: -Math.atan2(rake0, top - belt) }, glass);
    // B 柱
    b.box(0.07, top - belt - 0.06, width + 0.03, { x: (x0 + x1) / 2 + 0.05, y: belt + 0.02 }, trim);
    // 车顶行李架 / 天线
    if (rng.chance(0.4)) for (const sz of [-1, 1]) b.box(x1 - x0 - rake0 - rake1 - 0.1, 0.03, 0.03, { x: (x0 + rake0 + x1 - rake1) / 2, y: top + 0.03, z: sz * width * 0.4 }, trim);
    else b.cyl(0.006, 0.004, 0.45, 4, { x: x0 + rake0 + 0.1, y: top, z: width * 0.35, rz: 0.4 }, trim);
  };

  if (kind === 0) cabin(-L * 0.3, L * 0.18, 1.36, 0.36, 0.42, W * 0.86);
  else if (kind === 1) cabin(-H + 0.08, L * 0.16, 1.4, 0.12, 0.46, W * 0.86);
  else if (kind === 2) {
    // 厢式货车：高车头 + 货厢
    cabin(L * 0.12, H - 0.05, 1.95, 0.0, 0.3, W * 0.92);
    b.rbox(L * 0.6, 1.0, W * 0.98, 0.06, { x: -L * 0.2, y: belt - 0.02 }, metal(0xb4b0a4, { jitter: 0.25, ao: 0.3, aoH: 1 }));
    for (let i = 0; i < 6; i++) b.box(0.03, 0.9, W * 0.99, { x: -L * 0.48 + i * L * 0.11, y: belt + 0.03 }, metal(0x9a968c, { jitter: 0.1, ao: 0 }));
    b.box(0.02, 0.9, 0.02, { x: -H - 0.005, y: belt + 0.05 }, trim); // 后门缝
  } else {
    // 皮卡：短驾驶舱 + 货斗
    cabin(-L * 0.02, L * 0.24, 1.38, 0.08, 0.4, W * 0.86);
    for (const sz of [-1, 1]) b.box(L * 0.44, 0.32, 0.06, { x: -L * 0.26, y: belt - 0.01, z: sz * W * 0.46 }, paint);
    b.box(0.06, 0.32, W * 0.92, { x: -H + 0.05, y: belt - 0.01 }, paint);
    b.box(0.06, 0.3, W * 0.92, { x: -L * 0.04, y: belt - 0.01 }, paint);
    // 货斗里的杂物：备胎、油桶、帆布
    b.cyl(0.3, 0.3, 0.16, 12, { x: -L * 0.3, y: belt + 0.05, z: -W * 0.15 }, matte(Pal.tire, { ao: 0 }));
    b.cyl(0.18, 0.18, 0.5, 10, { x: -L * 0.18, y: belt - 0.01, z: W * 0.22 }, metal(0x9a3a2a, { jitter: 0.2, ao: 0.2 }));
    b.rbox(0.5, 0.18, 0.5, 0.08, { x: -L * 0.38, y: belt, z: W * 0.15, ry: 0.3 }, matte(0x5a5f44, { jitter: 0.2, ao: 0.2 }));
  }

  // 车门缝、门把手、后视镜
  const doors = kind === 2 ? [L * 0.12] : kind === 3 ? [-L * 0.02, L * 0.24] : [-L * 0.3, -L * 0.04, L * 0.2];
  for (const sz of [-1, 1]) {
    const z = sz * (W * 0.48 + 0.002);
    for (const x of doors) b.box(0.012, belt - ride - 0.12, 0.01, { x, y: ride + 0.08, z }, trim);
    for (let i = 0; i < doors.length - 1; i++) b.box(0.12, 0.03, 0.02, { x: (doors[i] as number) + 0.2, y: belt - 0.14, z }, chrome);
    b.box(L * 0.92, 0.04, 0.012, { y: ride + 0.2, z }, trim); // 防擦条
    const mx = kind === 2 ? L * 0.38 : kind === 3 ? L * 0.17 : L * 0.1;
    b.rbox(0.1, 0.09, 0.14, 0.02, { x: mx, y: belt + 0.03, z: sz * (W * 0.5 + 0.06) }, trim);
  }

  // 前脸：格栅、大灯、保险杠、车牌；车尾：尾灯、保险杠
  const fy = belt - 0.32;
  b.box(0.03, 0.18, W * 0.5, { x: H + 0.02, y: fy }, matte(0x111214, { ao: 0 }));
  for (let i = 0; i < 4; i++) b.box(0.035, 0.012, W * 0.48, { x: H + 0.025, y: fy + 0.03 + i * 0.04 }, chrome);
  for (const sz of [-1, 1]) {
    b.rbox(0.05, 0.12, 0.26, 0.03, { x: H + 0.01, y: fy + 0.02, z: sz * W * 0.36 }, chrome);
    b.box(0.02, 0.08, 0.2, { x: H + 0.035, y: fy + 0.04, z: sz * W * 0.36 }, glow(0xfff0c8, rng.chance(0.3) ? 1.2 : 0.35));
    b.rbox(0.05, 0.14, 0.18, 0.02, { x: -H - 0.01, y: belt - 0.28, z: sz * W * 0.38 }, glow(0xff3a2a, 0.6));
  }
  b.rbox(0.16, 0.2, W * 0.98, 0.06, { x: H + 0.04, y: ride + 0.02 }, matte(0x2a2b2e, { ao: 0, jitter: 0.08 }));
  b.rbox(0.16, 0.2, W * 0.98, 0.06, { x: -H - 0.04, y: ride + 0.02 }, matte(0x2a2b2e, { ao: 0, jitter: 0.08 }));
  b.box(0.01, 0.1, 0.32, { x: -H - 0.12, y: ride + 0.12 }, matte(0xd8d4c4, { jitter: 0, ao: 0 }));

  // 车轮：轮胎（圆环截面）+ 轮毂 + 辐条；偶尔缺一只、瘪一只
  const missing = rng.chance(0.25) ? rng.int(0, 3) : -1;
  let wi = 0;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * wx;
      // 轮胎外侧要露出车身一点（车身半宽 0.48W），否则从侧面只能看到轮毂
      const z = sz * (W * 0.48 - 0.04);
      if (wi++ === missing) {
        b.cyl(0.12, 0.12, 0.18, 8, { x, y: 0.12, z, rx: Math.PI / 2 }, metal(0x5a5e62, { ao: 0 })); // 刹车盘
        b.box(0.3, 0.12, 0.3, { x, y: 0.06, z }, matte(0x6a6560, { jitter: 0.2 })); // 垫着的砖
        continue;
      }
      const flat = rng.chance(0.2);
      const R = flat ? 0.28 : 0.33;
      const cy = R - (flat ? 0.02 : 0);
      b.torus(R - 0.09, 0.09, 8, 18, { x, y: cy, z, sy: flat ? 0.82 : 1 }, matte(Pal.tire, { ao: 0, jitter: 0.05 }));
      b.cyl(R - 0.1, R - 0.1, 0.16, 16, { x, y: cy, z, rx: Math.PI / 2 }, metal(0x6e757a, { ao: 0, jitter: 0.1 }));
      b.cyl(0.04, 0.04, 0.2, 8, { x, y: cy, z, rx: Math.PI / 2 }, chrome);
      // 轮毂外侧的凹盘和 5 颗螺母
      b.cyl(R - 0.15, R - 0.13, 0.02, 16, { x, y: cy, z: z + sz * 0.08, rx: Math.PI / 2 }, metal(0x8a9196, { ao: 0 }));
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        b.cyl(0.012, 0.012, 0.02, 6, { x: x + Math.cos(a) * 0.07, y: cy + Math.sin(a) * 0.07, z: z + sz * 0.09, rx: Math.PI / 2 }, chrome);
      }
    }
  }
  // 锈斑、灰尘
  for (let i = 0; i < 3; i++) {
    b.box(rng.range(0.2, 0.5), 0.01, rng.range(0.2, 0.5), { x: rng.range(-L * 0.35, L * 0.35), y: belt + 0.005, z: rng.range(-W * 0.3, W * 0.3) }, matte(Pal.rust, { jitter: 0.3, ao: 0 }));
  }
  b.pop();
  b.pop();
}
