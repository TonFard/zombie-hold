import { HALF_H, HALF_W } from '../../../game/world/grid';
import type { Prop } from '../../../game/world/types';
import { Builder, Pal } from '../../kit';
import { rectOf, matte, metal, glow } from './kit';

/* 据点设施：发电机、工坊 */

export function generator(b: Builder, p: Prop): void {
  const cx = (p.x0 + p.x1) / 2 - HALF_W;
  const cz = (p.y0 + p.y1) / 2 - HALF_H;
  b.push({ x: cx, z: cz });
  b.box(2.2, 0.12, 2.2, {}, matte(Pal.concreteDark, { ao: 0 }));
  // 雪橇底座
  for (const z of [-0.8, 0.8]) b.box(1.9, 0.16, 0.2, { y: 0.12, z }, metal(Pal.steel, { jitter: 0.05, ao: 0 }));
  // 机壳
  b.rbox(1.7, 1.0, 1.25, 0.08, { y: 0.28 }, metal(0xe0b030, { jitter: 0.14, ao: 0.35, aoH: 1.4 }));
  b.box(1.72, 0.06, 1.27, { y: 1.26 }, metal(0x6b5018, { jitter: 0.1, ao: 0 }));
  // 散热格栅
  b.box(0.9, 0.4, 0.02, { x: -0.45, y: 0.55, z: 0.63 }, matte(0x1c1c1c, { ao: 0, jitter: 0 }));
  for (let i = 0; i < 7; i++) b.box(0.04, 0.34, 0.03, { x: -0.8 + i * 0.13, y: 0.58, z: 0.645 }, metal(0x5a5f64, { jitter: 0.1, ao: 0 }));
  // 燃油罐
  b.cyl(0.32, 0.32, 1.5, 12, { x: -0.1, y: 1.0, z: -0.62, rz: Math.PI / 2, ry: 0 }, metal(0x3d5a40, { jitter: 0.15, ao: 0.2 }));
  // 排气管
  b.cyl(0.07, 0.07, 1.0, 8, { x: 0.65, y: 1.3, z: -0.4 }, metal(0x2a2a2a, { jitter: 0.1, ao: 0.1 }));
  b.cyl(0.11, 0.07, 0.1, 8, { x: 0.65, y: 2.25, z: -0.4 }, metal(0x2a2a2a, { jitter: 0.1, ao: 0 }));
  b.cyl(0.08, 0.08, 0.04, 8, { x: 0.65, y: 2.33, z: -0.4 }, glow(0xff6a20, 0.9));
  // 控制面板
  b.rbox(0.7, 0.45, 0.14, 0.03, { x: 0.35, y: 0.58, z: 0.7 }, metal(0x2b2f33, { jitter: 0.05, ao: 0 }));
  for (let i = 0; i < 4; i++) b.box(0.06, 0.06, 0.02, { x: 0.15 + i * 0.13, y: 0.85, z: 0.78 }, glow([0x66ff88, 0x66ff88, 0xffcc44, 0xff4444][i] as number, 1.6));
  b.box(0.5, 0.14, 0.02, { x: 0.35, y: 0.62, z: 0.78 }, glow(0x66ffaa, 0.8));
  // 吊环、护栏
  for (const sx of [-1, 1]) b.torus(0.12, 0.02, 6, 10, { x: sx * 0.6, y: 1.36, rx: Math.PI / 2 }, metal(0x8a9094, { ao: 0 }));
  b.pop();
}

/** 发电机顶部的能量核心：单独成网格，渲染时可以脉动 */
export function buildGeneratorCore(cx: number, cz: number): Builder {
  const b = new Builder();
  b.push({ x: cx, z: cz });
  b.cyl(0.26, 0.26, 0.5, 10, { x: -0.1, y: 1.34 }, glow(0x66e0ff, 2.6));
  b.cyl(0.32, 0.32, 0.05, 10, { x: -0.1, y: 1.3 }, glow(0x2a90b0, 1.6));
  b.cyl(0.32, 0.32, 0.05, 10, { x: -0.1, y: 1.84 }, glow(0x2a90b0, 1.6));
  b.pop();
  return b;
}

export function workbench(b: Builder, p: Prop): void {
  const r = rectOf(p);
  b.push({ x: r.cx, z: r.cz, ry: r.horiz ? 0 : Math.PI / 2 });
  const L = r.L - 0.1;
  const D = 0.85;
  const top = 0.86;
  const frame = metal(0x2c3238, { jitter: 0.08, ao: 0.35, aoH: 0.8 });
  const frameLight = metal(0x4a535c, { jitter: 0.06, ao: 0 });
  const steel = metal(0x9aa0a4, { jitter: 0.06, ao: 0 });
  const dark = metal(0x23272b, { jitter: 0.05, ao: 0 });

  // ---- 钢架：方管桌腿 + 底部横撑 + 调平脚 ----
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * (L / 2 - 0.08);
      const z = sz * (D / 2 - 0.08);
      b.box(0.07, top - 0.06, 0.07, { x, y: 0.04, z }, frame);
      b.cyl(0.05, 0.06, 0.04, 8, { x, z }, dark);
    }
    b.box(0.05, 0.05, D - 0.16, { x: sx * (L / 2 - 0.08), y: 0.18 }, frame);
  }
  b.box(L - 0.16, 0.05, 0.05, { y: 0.18, z: -(D / 2 - 0.08) }, frame);
  // 底层搁板，上面放着工具箱和弹药箱
  b.box(L - 0.2, 0.03, D - 0.2, { y: 0.22 }, frameLight);
  b.rbox(0.5, 0.26, 0.3, 0.03, { x: L / 2 - 0.6, y: 0.25, z: 0.05 }, metal(0xa8362a, { jitter: 0.12, ao: 0.2 }));
  b.box(0.2, 0.03, 0.04, { x: L / 2 - 0.6, y: 0.54 , z: 0.05 }, dark);
  for (let i = 0; i < 2; i++) b.rbox(0.42, 0.22, 0.24, 0.02, { x: -L / 2 + 0.45 + i * 0.5, y: 0.25, z: 0.1 - i * 0.05, ry: i * 0.15 }, matte(Pal.olive, { jitter: 0.12, ao: 0.2 }));

  // ---- 桌面：厚木板 + 金属包边 ----
  b.rbox(L, 0.07, D, 0.015, { y: top }, matte(Pal.wood, { jitter: 0.2, ao: 0.08 }));
  for (let i = 0; i < 5; i++) b.box(L - 0.02, 0.002, 0.004, { y: top + 0.07, z: -D / 2 + 0.15 + i * 0.15 }, matte(Pal.woodDark, { jitter: 0, ao: 0 })); // 木纹缝
  b.box(L + 0.02, 0.05, 0.02, { y: top + 0.01, z: D / 2 }, frameLight);

  // ---- 桌下抽屉柜：三层抽屉 + 拉手 ----
  const cw = 0.7;
  const cx = -L / 2 + 0.5;
  b.box(cw, 0.55, D - 0.12, { x: cx, y: top - 0.56 }, metal(0x3a4750, { jitter: 0.1, ao: 0.25 }));
  for (let i = 0; i < 3; i++) {
    const y = top - 0.52 + i * 0.18;
    b.box(cw - 0.04, 0.15, 0.015, { x: cx, y, z: (D - 0.12) / 2 + 0.008 }, metal(0x45535e, { jitter: 0.08, ao: 0 }));
    b.box(0.22, 0.02, 0.03, { x: cx, y: y + 0.1, z: (D - 0.12) / 2 + 0.02 }, steel);
    b.box(0.06, 0.03, 0.005, { x: cx + 0.22, y: y + 0.11, z: (D - 0.12) / 2 + 0.017 }, matte(0xd9d6cc, { jitter: 0, ao: 0 })); // 标签
  }

  // ---- 台钳：底座、固定钳口、活动钳口、丝杠和手柄，夹着一截枪管 ----
  const vx = L / 2 - 0.35;
  b.push({ x: vx, y: top + 0.07, z: 0.2 });
  b.cyl(0.09, 0.1, 0.04, 12, {}, metal(0x2f4a6a, { jitter: 0.1, ao: 0 }));
  b.rbox(0.16, 0.12, 0.14, 0.015, { y: 0.04, z: -0.04 }, metal(0x2f4a6a, { jitter: 0.1, ao: 0 }));
  b.box(0.16, 0.06, 0.02, { y: 0.16, z: 0.03 }, dark);
  b.rbox(0.16, 0.12, 0.08, 0.015, { y: 0.06, z: 0.12 }, metal(0x2f4a6a, { jitter: 0.1, ao: 0 }));
  b.box(0.16, 0.06, 0.02, { y: 0.12, z: 0.075 }, dark);
  b.cyl(0.012, 0.012, 0.2, 8, { y: 0.09, z: 0.24, rx: Math.PI / 2 }, steel);
  b.cyl(0.008, 0.008, 0.2, 6, { y: 0.09, z: 0.33, rz: Math.PI / 2 }, steel);
  b.cyl(0.018, 0.018, 0.5, 10, { x: -0.1, y: 0.18, z: 0.055, rz: Math.PI / 2 }, dark);
  b.pop();

  // ---- 桌上：拆开的步枪（机匣、枪管、弹匣）、散落子弹、扳手、零件盒、笔记本 ----
  const g = (x: number, z: number, ry: number) => b.push({ x, y: top + 0.07, z, ry });
  g(-0.15, -0.05, 0.12);
  b.rbox(0.36, 0.08, 0.06, 0.01, { y: 0.0 }, dark);
  b.box(0.22, 0.02, 0.05, { x: -0.02, y: 0.08 }, frameLight); // 导轨
  b.rbox(0.26, 0.1, 0.05, 0.02, { x: -0.31, y: 0.0, rz: 0.08 }, matte(0x1b1c1e, { jitter: 0.06, ao: 0 })); // 枪托
  b.cyl(0.013, 0.013, 0.42, 8, { x: 0.38, y: 0.04, rz: Math.PI / 2 }, dark);
  b.box(0.05, 0.14, 0.03, { x: 0.05, y: -0.0, z: 0.12, rx: Math.PI / 2 - 0.1 }, dark); // 弹匣（平放）
  b.pop();
  for (let i = 0; i < 6; i++) b.cyl(0.006, 0.006, 0.04, 6, { x: 0.35 + i * 0.03, y: top + 0.075, z: 0.25 + (i % 2) * 0.03, rz: Math.PI / 2, ry: i * 0.6 }, metal(0xc09a48, { jitter: 0.05, ao: 0 }));
  b.box(0.3, 0.015, 0.04, { x: 0.1, y: top + 0.075, z: 0.28, ry: 0.5 }, steel);
  b.torus(0.03, 0.01, 6, 10, { x: 0.23, y: top + 0.08, z: 0.21, rx: Math.PI / 2 }, steel);
  b.rbox(0.28, 0.06, 0.18, 0.01, { x: -L / 2 + 0.35, y: top + 0.07, z: 0.15 }, matte(0x2f6a8a, { jitter: 0.1, ao: 0 }));
  for (let i = 0; i < 4; i++) b.box(0.05, 0.004, 0.14, { x: -L / 2 + 0.25 + i * 0.065, y: top + 0.13, z: 0.15 }, dark);
  b.box(0.2, 0.01, 0.26, { x: -0.65, y: top + 0.075, z: 0.18, ry: -0.2 }, matte(0xd8d0b8, { jitter: 0.05, ao: 0 }));

  // ---- 背板：洞洞板 + 挂着的工具 + 顶部发光招牌 ----
  const bz = -D / 2 + 0.03;
  for (const sx of [-1, 1]) b.box(0.06, 1.25, 0.06, { x: sx * (L / 2 - 0.08), y: top + 0.07, z: bz }, frame);
  b.box(L - 0.18, 0.95, 0.03, { y: top + 0.3, z: bz }, matte(0x6b5a44, { jitter: 0.12, ao: 0.15 }));
  for (let ix = 0; ix < Math.floor((L - 0.3) / 0.1); ix++) {
    for (let iy = 0; iy < 8; iy++) {
      if ((ix + iy) % 2) continue;
      b.box(0.012, 0.012, 0.005, { x: -L / 2 + 0.2 + ix * 0.1, y: top + 0.38 + iy * 0.1, z: bz + 0.016 }, matte(0x2a241c, { jitter: 0, ao: 0 }));
    }
  }
  const tz = bz + 0.04;
  // 扳手组（由小到大）
  for (let i = 0; i < 5; i++) {
    const x = -L / 2 + 0.3 + i * 0.07;
    const len = 0.16 + i * 0.03;
    b.box(0.018, len, 0.008, { x, y: top + 1.05 - len, z: tz }, steel);
    b.torus(0.018 + i * 0.002, 0.006, 4, 8, { x, y: top + 1.06, z: tz }, steel);
  }
  // 锤子、螺丝刀、钳子
  const hx = -0.15;
  b.box(0.025, 0.3, 0.02, { x: hx, y: top + 0.62, z: tz }, matte(Pal.woodDark, { jitter: 0.1, ao: 0 }));
  b.box(0.13, 0.045, 0.04, { x: hx, y: top + 0.92, z: tz }, dark);
  for (let i = 0; i < 4; i++) {
    const x = 0.05 + i * 0.06;
    b.cyl(0.012, 0.015, 0.09, 6, { x, y: top + 0.88, z: tz }, matte([Pal.red, 0xd6a824, Pal.red, 0x2f6a8a][i] as number, { jitter: 0.05, ao: 0 }));
    b.cyl(0.004, 0.004, 0.12, 4, { x, y: top + 0.76, z: tz }, steel);
  }
  b.rod([0.38, top + 0.95, tz], [0.33, top + 0.68, tz], 0.008, matte(Pal.red, { ao: 0 }), 4);
  b.rod([0.38, top + 0.95, tz], [0.43, top + 0.68, tz], 0.008, matte(Pal.red, { ao: 0 }), 4);
  // 挂在板上的手枪和备用弹匣（这是"武器工坊"）
  b.push({ x: L / 2 - 0.55, y: top + 0.72, z: tz });
  b.rbox(0.22, 0.05, 0.03, 0.008, { y: 0.06 }, dark);
  b.rbox(0.045, 0.12, 0.03, 0.008, { x: -0.07, y: -0.03, rz: -0.25 }, matte(0x1b1c1e, { jitter: 0.05, ao: 0 }));
  for (let i = 0; i < 3; i++) b.box(0.03, 0.1, 0.02, { x: 0.12 + i * 0.045, y: -0.05 }, dark);
  b.pop();
  // 顶部灯箱招牌
  b.rbox(L * 0.55, 0.16, 0.06, 0.02, { y: top + 1.18, z: bz + 0.02 }, dark);
  b.box(L * 0.52, 0.11, 0.01, { y: top + 1.205, z: bz + 0.055 }, glow(0xffb040, 1.8));
  for (let i = 0; i < 3; i++) b.box(0.06, 0.06, 0.012, { x: -0.25 + i * 0.25, y: top + 1.23, z: bz + 0.06 }, matte(0x1a1206, { jitter: 0, ao: 0 }));

  // ---- 可调台灯：底座、两节灯臂、灯罩、灯泡 ----
  const lx = L / 2 - 0.15;
  b.cyl(0.07, 0.08, 0.025, 10, { x: lx, y: top + 0.07, z: -0.2 }, dark);
  b.rod([lx, top + 0.09, -0.2], [lx, top + 0.6, -0.12], 0.012, dark, 6);
  b.sphere(0.02, 6, 4, { x: lx, y: top + 0.6, z: -0.12 }, steel);
  b.rod([lx, top + 0.6, -0.12], [lx - 0.25, top + 0.55, 0.1], 0.012, dark, 6);
  b.lathe([[0.0, 0.0], [0.05, 0.0], [0.1, 0.1], [0.11, 0.12], [0.0, 0.12]], 14, { x: lx - 0.27, y: top + 0.6, z: 0.12, rx: Math.PI / 2 }, metal(Pal.hazard, { jitter: 0.06, ao: 0 }));
  b.sphere(0.035, 8, 6, { x: lx - 0.27, y: top + 0.5, z: 0.12 }, glow(0xffe0a0, 2.8));
  b.pop();
}
