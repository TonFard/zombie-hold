import { Shape } from 'three';
import { Rng } from '../game/core/rng';
import { HALF_H, HALF_W } from '../game/world/grid';
import type { Prop } from '../game/world/types';
import { Builder, Pal, type Style } from './kit';

/**
 * 地图道具的几何体。每个函数在局部坐标系里建模：长边沿 X，厚度沿 Z，原点在底面中心，
 * 外层统一用 push() 摆到世界位置。
 */

interface Rect {
  cx: number;
  cz: number;
  /** 长边 / 短边（世界单位） */
  L: number;
  T: number;
  horiz: boolean;
}

function rectOf(p: Prop): Rect {
  const w = p.x1 - p.x0;
  const d = p.y1 - p.y0;
  return {
    cx: (p.x0 + p.x1) / 2 - HALF_W,
    cz: (p.y0 + p.y1) / 2 - HALF_H,
    L: Math.max(w, d),
    T: Math.min(w, d),
    horiz: w >= d,
  };
}

const matte = (color: number, o: Partial<Style> = {}): Style => ({ color, ...o });
const metal = (color: number, o: Partial<Style> = {}): Style => ({ color, mat: 'metal', ...o });
const glow = (color: number, k = 1.5): Style => ({ color, mat: 'glow', glow: k });

// ---------------------------------------------------------------- 墙体

function wall(b: Builder, p: Prop, rng: Rng): void {
  const r = rectOf(p);
  const L = r.L;
  const h = p.h ?? 2.4;
  const style = p.style ?? 'compound';
  b.push({ x: r.cx, z: r.cz, ry: r.horiz ? 0 : Math.PI / 2 });

  const footH = 0.28;
  const capH = 0.14;
  const bodyH = h - footH - capH;
  const pal = {
    compound: { body: Pal.concrete, foot: Pal.concreteDark, cap: Pal.concreteLight },
    brick: { body: rng.chance(0.5) ? Pal.brick : Pal.brickDark, foot: Pal.concreteDark, cap: Pal.concreteLight },
    plaster: { body: Pal.plaster, foot: Pal.plasterDark, cap: Pal.white },
    metal: { body: Pal.sheet, foot: Pal.concreteDark, cap: Pal.steelLight },
  }[style];

  b.box(L + 0.06, footH, 1.06, {}, matte(pal.foot, { ao: 0.2 }));
  b.box(L, bodyH, 0.9, { y: footH }, matte(pal.body, { jitter: 0.16, ao: 0.42, aoH: 1.4 }));
  b.box(L + 0.1, capH, 1.0, { y: h - capH }, matte(pal.cap, { jitter: 0.08, ao: 0 }));

  if (style === 'compound') {
    // 预制板接缝
    for (let x = -L / 2 + 2; x < L / 2 - 0.2; x += 2) {
      b.box(0.05, bodyH - 0.1, 0.94, { x, y: footH }, matte(0x44433f, { jitter: 0, ao: 0 }));
    }
    // 倒钩铁丝网
    b.box(L, 0.03, 0.03, { y: h + 0.22 }, metal(0x2a2a2a, { jitter: 0, ao: 0 }));
    b.box(L, 0.03, 0.03, { y: h + 0.42 }, metal(0x2a2a2a, { jitter: 0, ao: 0 }));
    for (let x = -L / 2 + 0.3, i = 0; x < L / 2; x += 1.5, i++) {
      b.box(0.05, 0.55, 0.05, { x, y: h, rx: i % 2 ? 0.35 : -0.35 }, metal(0x2a2a2a, { jitter: 0, ao: 0 }));
      b.box(0.04, 0.04, 0.2, { x: x + 0.3, y: h + 0.3 }, metal(0x2a2a2a, { jitter: 0, ao: 0 }));
    }
    // 污渍、裂缝
    for (let i = 0; i < Math.floor(L / 3); i++) {
      const x = rng.range(-L / 2 + 0.5, L / 2 - 0.5);
      const s = rng.chance(0.5) ? 1 : -1;
      b.box(rng.range(0.4, 1.0), rng.range(0.3, 0.8), 0.01, { x, y: rng.range(0.4, 1.4), z: s * 0.455 }, matte(0x55534d, { jitter: 0.2, ao: 0 }));
    }
    // 墙脚的碎块和钢筋
    if (L >= 3 && rng.chance(0.55)) {
      const s = rng.chance(0.5) ? 1 : -1;
      const x = rng.range(-L / 2 + 0.6, L / 2 - 0.6);
      for (let i = 0; i < 3; i++) {
        b.box(rng.range(0.15, 0.3), rng.range(0.1, 0.25), rng.range(0.15, 0.3), { x: x + rng.range(-0.3, 0.3), z: s * rng.range(0.6, 0.8), ry: rng.range(0, 3), rx: rng.range(-0.3, 0.3) }, matte(Pal.concreteDark, { jitter: 0.2 }));
      }
      b.rod([x, h - 0.1, s * 0.1], [x + 0.1, h + 0.5, s * 0.25], 0.025, metal(Pal.rust, { jitter: 0.1, ao: 0 }));
    }
  } else if (style === 'brick' || style === 'plaster') {
    // 水平砖缝 / 腰线
    const step = style === 'brick' ? 0.6 : 1.2;
    for (let y = footH + 0.3; y < h - capH - 0.1; y += step) {
      b.box(L, 0.03, 0.92, { y }, matte(style === 'brick' ? 0x3d2a22 : pal.foot, { jitter: 0.05, ao: 0 }));
    }
    // 壁柱
    for (let x = -L / 2 + 0.1; x <= L / 2 - 0.1; x += 5) {
      b.box(0.3, h - capH - footH, 1.04, { x, y: footH }, matte(style === 'brick' ? Pal.brickDark : Pal.white, { jitter: 0.1, ao: 0.4, aoH: 1.4 }));
    }
    // 窗
    const slots = Math.floor((L - 0.8) / 2.4);
    const start = -((slots - 1) * 2.4) / 2;
    for (let i = 0; i < slots; i++) {
      const x = start + i * 2.4;
      b.box(1.0, 1.15, 1.0, { x, y: 1.0 }, matte(0x2b2622, { jitter: 0, ao: 0 }));
      b.box(0.8, 0.95, 1.02, { x, y: 1.1 }, metal(Pal.glass, { jitter: 0, ao: 0 }));
      b.box(0.04, 0.95, 1.03, { x, y: 1.1 }, matte(0x2b2622, { jitter: 0, ao: 0 }));
      b.box(1.2, 0.08, 1.14, { x, y: 0.94 }, matte(Pal.concreteLight, { jitter: 0.05, ao: 0 }));
      if (rng.chance(0.14)) b.box(0.7, 0.88, 0.99, { x, y: 1.13 }, glow(0xffb866, 1.1));
    }
  } else {
    // 铁皮：下半截混凝土墙裙，上面是波纹板
    b.box(L, 0.5, 0.95, { y: footH }, matte(Pal.concreteDark, { jitter: 0.12, ao: 0.2 }));
    for (let x = -L / 2 + 0.25; x < L / 2; x += 0.5) {
      b.box(0.1, bodyH - 0.55, 0.96, { x, y: footH + 0.5 }, metal(0x5d6b71, { jitter: 0.22, ao: 0.3, aoH: 2 }));
    }
    for (let x = -L / 2 + 3; x < L / 2; x += 6) {
      b.box(0.25, bodyH, 1.04, { x, y: footH }, metal(Pal.steel, { jitter: 0.06, ao: 0.2 }));
    }
    // 锈迹
    for (let i = 0; i < Math.floor(L / 2.5); i++) {
      const s = rng.chance(0.5) ? 1 : -1;
      b.box(rng.range(0.3, 0.9), rng.range(0.25, 0.7), 0.005, { x: rng.range(-L / 2 + 1, L / 2 - 1), y: rng.range(1.0, 2.0), z: s * 0.485 }, matte(0x4c3a2e, { jitter: 0.25, ao: 0 }));
    }
  }
  b.pop();
}

function doorframe(b: Builder, p: Prop): void {
  const r = rectOf(p);
  const L = r.L;
  const h = p.h ?? 2.4;
  const style = p.style ?? 'compound';
  const col = style === 'brick' || style === 'plaster' ? 0x4d3a2a : Pal.steel;
  b.push({ x: r.cx, z: r.cz, ry: r.horiz ? 0 : Math.PI / 2 });
  b.box(0.22, h, 1.04, { x: -L / 2 + 0.11 }, matte(col, { jitter: 0.08 }));
  b.box(0.22, h, 1.04, { x: L / 2 - 0.11 }, matte(col, { jitter: 0.08 }));
  b.box(L, 0.34, 1.04, { y: h - 0.34 }, matte(col, { jitter: 0.08, ao: 0 }));
  if (style === 'compound' || style === 'metal') {
    // 警示条
    for (let x = -L / 2 + 0.15, i = 0; x < L / 2 - 0.2; x += 0.3, i++) {
      b.box(0.28, 0.02, 0.9, { x: x + 0.14, y: h }, matte(i % 2 ? Pal.hazard : 0x222222, { jitter: 0, ao: 0 }));
    }
    // 门楣上的笼灯
    b.box(0.3, 0.12, 0.2, { y: h - 0.46, z: 0.5 }, metal(Pal.steel, { jitter: 0, ao: 0 }));
    b.box(0.22, 0.06, 0.12, { y: h - 0.5, z: 0.5 }, glow(0xffe2b0, 2.2));
    b.box(0.3, 0.12, 0.2, { y: h - 0.46, z: -0.5 }, metal(Pal.steel, { jitter: 0, ao: 0 }));
    b.box(0.22, 0.06, 0.12, { y: h - 0.5, z: -0.5 }, glow(0xffe2b0, 2.2));
  }
  b.pop();
}

// ---------------------------------------------------------------- 集装箱

const CONTAINER_COLORS = [0x9c3b2e, 0x2f5a7a, 0x4d6a3e, 0xc27a2a, 0x8d8a80, 0x6b2f2f];

function container(b: Builder, p: Prop, rng: Rng): void {
  const r = rectOf(p);
  const L = r.L - 0.12;
  const W = Math.min(r.T - 0.12, 1.9);
  const H = 2.3;
  const col = CONTAINER_COLORS[(p.variant + (p.x0 % 3)) % CONTAINER_COLORS.length] as number;
  const dark = Pal.steel;
  b.push({ x: r.cx, z: r.cz, ry: r.horiz ? 0 : Math.PI / 2 });
  b.box(L, 0.12, W, { y: 0.0 }, matte(dark, { ao: 0 }));
  b.box(L - 0.08, H - 0.25, W - 0.06, { y: 0.12 }, metal(col, { jitter: 0.2, ao: 0.5, aoH: 1.6 }));
  // 波纹肋
  for (let x = -L / 2 + 0.3; x < L / 2 - 0.45; x += 0.34) {
    for (const s of [1, -1]) {
      b.box(0.1, H - 0.55, 0.06, { x, y: 0.28, z: s * (W / 2 - 0.02) }, metal(col, { jitter: 0.25, ao: 0.5, aoH: 1.6 }));
    }
  }
  // 顶梁、底梁、角件
  for (const s of [1, -1]) {
    b.box(L, 0.14, 0.12, { y: H - 0.14, z: s * (W / 2 - 0.05) }, metal(dark, { jitter: 0.05, ao: 0 }));
    b.box(L, 0.14, 0.12, { y: 0.1, z: s * (W / 2 - 0.05) }, metal(dark, { jitter: 0.05, ao: 0 }));
    for (const e of [1, -1]) b.box(0.22, H, 0.22, { x: e * (L / 2 - 0.11), z: s * (W / 2 - 0.08) }, metal(dark, { jitter: 0.05, ao: 0.3 }));
  }
  // 顶部肋
  for (let x = -L / 2 + 0.4; x < L / 2 - 0.3; x += 0.5) {
    b.box(0.08, 0.04, W - 0.15, { x, y: H - 0.1 }, metal(col, { jitter: 0.2, ao: 0 }));
  }
  // 门端：门缝、锁杆、把手
  const ex = L / 2 - 0.05;
  b.box(0.04, H - 0.5, W - 0.2, { x: ex, y: 0.25 }, matte(0x201c18, { jitter: 0, ao: 0 }));
  for (const z of [-0.55, -0.2, 0.2, 0.55].map((v) => v * (W / 1.9))) {
    b.cyl(0.03, 0.03, H - 0.55, 5, { x: ex + 0.04, y: 0.27, z }, metal(0x9aa0a4, { jitter: 0.05, ao: 0 }));
    b.box(0.06, 0.16, 0.05, { x: ex + 0.06, y: 1.1, z }, metal(0x9aa0a4, { jitter: 0.05, ao: 0 }));
  }
  // 编号牌和色带
  for (const s of [1, -1]) {
    b.box(L * 0.35, 0.28, 0.02, { x: -L * 0.1, y: 1.5, z: s * (W / 2 + 0.02) }, matte(Pal.white, { jitter: 0.15, ao: 0 }));
    b.box(L * 0.2, 0.08, 0.025, { x: -L * 0.1, y: 1.25, z: s * (W / 2 + 0.02) }, matte(0x222222, { jitter: 0, ao: 0 }));
  }
  // 锈蚀斑块
  for (let i = 0; i < 4; i++) {
    const s = rng.chance(0.5) ? 1 : -1;
    b.box(rng.range(0.25, 0.8), rng.range(0.2, 0.6), 0.012, { x: rng.range(-L / 2 + 0.8, L / 2 - 0.8), y: rng.range(0.4, 1.8), z: s * (W / 2 + 0.01) }, matte(0x4c3a2e, { jitter: 0.25, ao: 0 }));
  }
  // 有的门被撬开了
  if (p.variant % 2 === 1) {
    b.push({ x: ex + 0.02, y: 0.25, z: W / 2 - 0.1, ry: -1.9 });
    b.box(0.05, H - 0.55, W / 2 - 0.12, {}, metal(col, { jitter: 0.2, ao: 0.4 }));
    b.pop();
  }
  b.pop();
}

// ---------------------------------------------------------------- 车辆

const CAR_COLORS = [0x8f3a30, 0x35566e, 0xb5b0a2, 0x55663f, 0xb8982f, 0x6a5a4a, 0x7a8286];

function car(b: Builder, p: Prop, rng: Rng): void {
  const r = rectOf(p);
  const L = r.L - 0.3;
  const W = Math.min(r.T - 0.2, 1.75);
  const kind = p.variant % 4; // 0 轿车 1 两厢 2 厢式货车 3 皮卡
  const col = rng.pick(CAR_COLORS);
  const dust = { jitter: 0.2, ao: 0.4, aoH: 0.8 };
  b.push({ x: r.cx, z: r.cz, ry: (r.horiz ? 0 : Math.PI / 2) + rng.range(-0.06, 0.06) });
  const roll = rng.range(-0.04, 0.04);
  b.push({ rz: roll });

  // 底盘与车身
  b.rbox(L * 0.96, 0.22, W * 0.86, 0.04, { y: 0.2 }, matte(0x24262a, { ao: 0 }));
  const bodyH = kind === 2 ? 0.95 : 0.55;
  b.rbox(L * 0.97, bodyH, W * 0.95, 0.12, { y: 0.34 }, metal(col, dust));

  const glass = metal(Pal.glass, { jitter: 0.05, ao: 0 });
  if (kind === 0 || kind === 1) {
    const cl = kind === 0 ? L * 0.5 : L * 0.62;
    const cx = kind === 0 ? -L * 0.04 : -L * 0.1;
    b.rbox(cl, 0.5, W * 0.84, 0.13, { x: cx, y: 0.88 }, metal(col, { jitter: 0.2, ao: 0.1 }));
    b.box(cl - 0.2, 0.3, W * 0.84 + 0.02, { x: cx, y: 0.97 }, glass);
    b.box(cl + 0.02, 0.3, W * 0.5, { x: cx, y: 0.97 }, glass);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.07, 0.34, 0.06, { x: cx + sx * (cl / 2 - 0.05), y: 0.95, z: sz * (W * 0.42) }, metal(col, { jitter: 0.2, ao: 0 }));
    // 发动机盖折线
    b.box(0.03, 0.01, W * 0.8, { x: L * 0.3, y: 0.9 }, matte(0x151515, { jitter: 0, ao: 0 }));
  } else if (kind === 2) {
    b.rbox(L * 0.28, 0.75, W * 0.92, 0.12, { x: L * 0.3, y: 1.0 }, metal(col, dust));
    b.box(0.05, 0.4, W * 0.8, { x: L * 0.44, y: 1.22 }, glass);
    b.rbox(L * 0.62, 0.75, W * 0.94, 0.1, { x: -L * 0.14, y: 1.28 }, metal(0xb0aca0, { jitter: 0.25, ao: 0.3 }));
  } else {
    b.rbox(L * 0.3, 0.5, W * 0.84, 0.12, { x: L * 0.22, y: 0.88 }, metal(col, { jitter: 0.2, ao: 0.1 }));
    b.box(L * 0.22, 0.28, W * 0.86, { x: L * 0.22, y: 0.97 }, glass);
    // 货斗：四壁 + 里面的杂物
    for (const sz of [-1, 1]) b.box(L * 0.5, 0.3, 0.06, { x: -L * 0.22, y: 0.88, z: sz * (W * 0.46) }, metal(col, dust));
    b.box(0.06, 0.3, W * 0.9, { x: -L * 0.47, y: 0.88 }, metal(col, dust));
    b.box(0.06, 0.3, W * 0.9, { x: L * 0.02, y: 0.88 }, metal(col, dust));
    b.cyl(0.3, 0.3, 0.12, 8, { x: -L * 0.3, y: 0.88, rx: 0.0 }, matte(Pal.tire, { ao: 0 }));
  }

  // 保险杠、灯
  b.rbox(0.12, 0.2, W * 0.9, 0.04, { x: L * 0.49, y: 0.32 }, matte(0x2a2a2a, { ao: 0 }));
  b.rbox(0.12, 0.2, W * 0.9, 0.04, { x: -L * 0.49, y: 0.32 }, matte(0x2a2a2a, { ao: 0 }));
  for (const sz of [-1, 1]) {
    b.box(0.04, 0.12, 0.26, { x: L * 0.485, y: 0.56, z: sz * W * 0.32 }, glow(0xfff0c8, 0.5));
    b.box(0.04, 0.1, 0.22, { x: -L * 0.485, y: 0.56, z: sz * W * 0.32 }, glow(0xff3a2a, 0.7));
  }
  // 车轮：偶尔缺一只、瘪一只
  const missing = rng.chance(0.25) ? rng.int(0, 3) : -1;
  let wi = 0;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const flat = rng.chance(0.2);
      const rad = flat ? 0.24 : 0.3;
      if (wi++ !== missing) {
        b.cyl(rad, rad, 0.22, 10, { x: sx * L * 0.32, y: 0, z: sz * (W * 0.46), rx: Math.PI / 2 }, matte(Pal.tire, { ao: 0, jitter: 0.05 }));
        b.cyl(0.15, 0.15, 0.24, 8, { x: sx * L * 0.32, y: 0, z: sz * (W * 0.46), rx: Math.PI / 2 }, metal(0x8a9094, { ao: 0, jitter: 0.1 }));
      } else {
        b.cyl(0.14, 0.14, 0.2, 6, { x: sx * L * 0.32, y: 0, z: sz * (W * 0.42), rx: Math.PI / 2 }, metal(0x6a6e72, { ao: 0 }));
      }
    }
  }
  // 锈斑
  for (let i = 0; i < 3; i++) {
    b.box(rng.range(0.2, 0.5), 0.01, rng.range(0.2, 0.5), { x: rng.range(-L * 0.35, L * 0.35), y: bodyH + 0.34, z: rng.range(-W * 0.3, W * 0.3) }, matte(Pal.rust, { jitter: 0.3, ao: 0 }));
  }
  b.pop();
  b.pop();
}

// ---------------------------------------------------------------- 树

function tree(b: Builder, p: Prop, rng: Rng): void {
  const cx = (p.x0 + p.x1) / 2 - HALF_W;
  const cz = (p.y0 + p.y1) / 2 - HALF_H;
  const h = p.h ?? 3;
  const bark = rng.chance(0.5) ? Pal.bark : Pal.barkGray;
  b.push({ x: cx, z: cz, ry: rng.range(0, 6.28) });
  const lean = rng.range(-0.08, 0.08);
  b.cyl(0.1, 0.22, h * 0.55, 7, { rz: lean }, matte(bark, { jitter: 0.2, ao: 0.5, aoH: 1.2 }));
  // 树根
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * 6.28 + rng.range(-0.3, 0.3);
    b.rod([Math.cos(a) * 0.1, 0.25, Math.sin(a) * 0.1], [Math.cos(a) * 0.4, 0.0, Math.sin(a) * 0.4], 0.07, matte(bark, { jitter: 0.2, ao: 0.4 }), 5);
  }
  const top: [number, number, number] = [Math.sin(lean) * -h * 0.55, h * 0.55, 0];
  const n = rng.int(4, 6);
  const leafy = rng.chance(0.35);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.28 + rng.range(-0.4, 0.4);
    const f = rng.range(0.55, 0.95);
    const base: [number, number, number] = [top[0] * f, h * 0.55 * f + h * 0.05, 0];
    const len = rng.range(0.9, 1.7);
    const up = rng.range(0.5, 1.0);
    const end: [number, number, number] = [base[0] + Math.cos(a) * len, base[1] + up, base[2] + Math.sin(a) * len];
    b.rod(base, end, 0.045, matte(bark, { jitter: 0.2, ao: 0.1 }), 5);
    // 小枝
    const mid: [number, number, number] = [(base[0] + end[0]) / 2, (base[1] + end[1]) / 2, (base[2] + end[2]) / 2];
    b.rod(mid, [mid[0] + Math.cos(a + 0.7) * 0.6, mid[1] + 0.5, mid[2] + Math.sin(a + 0.7) * 0.6], 0.025, matte(bark, { jitter: 0.2, ao: 0 }), 4);
    if (leafy && rng.chance(0.7)) {
      b.sphere(rng.range(0.25, 0.4), 6, 4, { x: end[0], y: end[1], z: end[2], sy: 0.7 }, matte(Pal.leaf, { jitter: 0.3, ao: 0 }));
    }
  }
  b.pop();
}

// ---------------------------------------------------------------- 低矮杂物

function crate(b: Builder, p: Prop, rng: Rng): void {
  const w = p.x1 - p.x0;
  const d = p.y1 - p.y0;
  const mil = p.variant >= 2 && w === 1 && d === 1;
  for (let ix = 0; ix < w; ix++) {
    for (let iz = 0; iz < d; iz++) {
      const x = p.x0 + ix + 0.5 - HALF_W;
      const z = p.y0 + iz + 0.5 - HALF_H;
      const levels = w * d > 1 ? rng.int(1, 2) : 1;
      for (let lv = 0; lv < levels; lv++) {
        const s = w * d > 1 ? 0.92 : Math.min(0.9, (p.h ?? 0.9));
        const yaw = rng.range(-0.15, 0.15);
        b.push({ x, y: lv * s, z, ry: yaw });
        if (mil) {
          b.rbox(0.88, 0.62, 0.62, 0.04, {}, matte(Pal.olive, { jitter: 0.15, ao: 0.4 }));
          b.box(0.9, 0.05, 0.14, { y: 0.62 }, matte(0x333a28, { ao: 0 }));
          b.box(0.12, 0.08, 0.64, { x: -0.3, y: 0.3 }, matte(Pal.hazard, { jitter: 0.1, ao: 0 }));
          b.box(0.3, 0.04, 0.04, { y: 0.66, z: 0.0 }, metal(0x9aa0a4, { ao: 0 }));
        } else {
          b.box(s, s, s, {}, matte(Pal.wood, { jitter: 0.2, ao: 0.5, aoH: 1.0 }));
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.1, s + 0.02, 0.1, { x: sx * (s / 2 - 0.05), z: sz * (s / 2 - 0.05) }, matte(Pal.woodDark, { jitter: 0.15, ao: 0.3 }));
          for (const y of [0.04, s - 0.1]) {
            b.box(s + 0.02, 0.08, s + 0.02, { y }, matte(Pal.woodDark, { jitter: 0.15, ao: 0 }));
          }
          b.rod([-s / 2 + 0.05, 0.1, s / 2 + 0.015], [s / 2 - 0.05, s - 0.1, s / 2 + 0.015], 0.035, matte(Pal.woodDark, { jitter: 0.15, ao: 0 }), 4);
        }
        b.pop();
      }
    }
  }
}

function barrier(b: Builder, p: Prop): void {
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
  for (let i = 0; i < n; i++) {
    const z = -r.L / 2 + 0.5 + i;
    b.push({ z });
    b.extrude(s, 0.94, {}, matte(0x7b7a76, { jitter: 0.2, ao: 0.5, aoH: 0.8 }));
    if (i % 2 === 0) b.box(0.12, 0.02, 0.3, { y: h, z: 0 }, matte(0xb5522c, { jitter: 0.1, ao: 0 }));
    b.pop();
  }
  b.pop();
}

function pump(b: Builder, p: Prop, rng: Rng): void {
  const r = rectOf(p);
  b.push({ x: r.cx, z: r.cz, ry: r.horiz ? 0 : Math.PI / 2 });
  b.box(r.L * 0.9, 0.12, 0.9, {}, matte(Pal.concreteDark, { ao: 0 }));
  b.rbox(r.L * 0.7, 1.45, 0.5, 0.06, { y: 0.12 }, matte(Pal.red, { jitter: 0.15, ao: 0.4, aoH: 1.4 }));
  b.box(r.L * 0.72, 0.18, 0.54, { y: 1.5 }, matte(Pal.white, { jitter: 0.1, ao: 0 }));
  for (const s of [1, -1]) {
    b.box(r.L * 0.28, 0.2, 0.02, { x: -r.L * 0.12, y: 1.0, z: s * 0.26 }, glow(0x66ffaa, 0.9));
    b.box(r.L * 0.4, 0.55, 0.02, { x: 0, y: 0.35, z: s * 0.26 }, matte(0x4a2018, { ao: 0 }));
    b.box(0.08, 0.5, 0.1, { x: r.L * 0.25, y: 0.5, z: s * 0.3 }, metal(0x1e1e1e, { ao: 0 }));
    b.rod([r.L * 0.25, 0.9, s * 0.3], [r.L * 0.1, 0.4, s * 0.4 + 0.0], 0.03, matte(0x151515, { ao: 0 }), 4);
  }
  if (rng.chance(0.5)) b.box(0.3, 0.02, 0.3, { x: r.L * 0.3, y: 0.12 }, matte(0x151210, { ao: 0, jitter: 0 }));
  b.pop();
}

function pillar(b: Builder, p: Prop): void {
  const cx = (p.x0 + p.x1) / 2 - HALF_W;
  const cz = (p.y0 + p.y1) / 2 - HALF_H;
  const h = p.h ?? 3.4;
  b.box(0.7, 0.2, 0.7, { x: cx, z: cz }, matte(Pal.concreteDark, { ao: 0 }));
  b.cyl(0.18, 0.2, h, 8, { x: cx, z: cz, y: 0.2 }, matte(Pal.concreteLight, { jitter: 0.12, ao: 0.4, aoH: 1.5 }));
  for (let i = 0; i < 4; i++) b.cyl(0.215, 0.215, 0.12, 8, { x: cx, z: cz, y: 0.3 + i * 0.12 }, matte(i % 2 ? 0x222222 : Pal.hazard, { jitter: 0, ao: 0 }));
  b.box(0.5, 0.15, 0.5, { x: cx, z: cz, y: h + 0.05 }, matte(Pal.concreteDark, { ao: 0 }));
}

function canopy(b: Builder, p: Prop): void {
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

function rack(b: Builder, p: Prop, rng: Rng): void {
  const r = rectOf(p);
  b.push({ x: r.cx, z: r.cz, ry: r.horiz ? 0 : Math.PI / 2 });
  const L = r.L;
  const H = p.h ?? 2.0;
  for (let x = -L / 2 + 0.05; x <= L / 2 - 0.04; x += Math.min(1.0, L - 0.1)) {
    for (const z of [-0.4, 0.4]) b.box(0.08, H, 0.08, { x, z }, metal(0x2c4a6a, { jitter: 0.1, ao: 0.4 }));
  }
  for (const y of [0.12, 0.8, 1.48]) {
    b.box(L, 0.05, 0.9, { y }, metal(0xb8741f, { jitter: 0.15, ao: 0.1 }));
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

function rubble(b: Builder, p: Prop, rng: Rng): void {
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

function chunk(b: Builder, p: Prop, rng: Rng): void {
  const cx = (p.x0 + p.x1) / 2 - HALF_W;
  const cz = (p.y0 + p.y1) / 2 - HALF_H;
  const h = p.h ?? 1.3;
  b.push({ x: cx, z: cz, ry: rng.range(0, 3) });
  b.box(0.95, h, 0.4, { y: 0.05, rz: 0.12, rx: 0.06 }, matte(Pal.concrete, { jitter: 0.2, ao: 0.5, aoH: 1.2 }));
  b.box(0.5, 0.45, 0.35, { x: 0.25, z: 0.3, y: 0, ry: 0.7 }, matte(Pal.concreteDark, { jitter: 0.2 }));
  b.rod([-0.2, h * 0.9, 0], [-0.1, h + 0.55, 0.05], 0.025, metal(Pal.rust, { ao: 0 }), 4);
  b.rod([0.1, h * 0.85, 0.05], [0.25, h + 0.4, -0.05], 0.025, metal(Pal.rust, { ao: 0 }), 4);
  b.pop();
}

function lamp(b: Builder, p: Prop): void {
  const cx = (p.x0 + p.x1) / 2 - HALF_W;
  const cz = (p.y0 + p.y1) / 2 - HALF_H;
  const h = p.h ?? 4.2;
  b.push({ x: cx, z: cz, ry: (p.variant * Math.PI) / 2 });
  b.cyl(0.18, 0.22, 0.25, 8, {}, metal(Pal.steel, { ao: 0 }));
  b.cyl(0.05, 0.09, h - 0.2, 8, { y: 0.2 }, metal(0x2f3236, { jitter: 0.1, ao: 0.4, aoH: 2 }));
  b.rod([0, h - 0.05, 0], [0.6, h + 0.15, 0], 0.045, metal(0x2f3236, { jitter: 0.1, ao: 0 }), 6);
  b.rbox(0.5, 0.1, 0.24, 0.03, { x: 0.6, y: h + 0.1 }, metal(0x3a3d42, { jitter: 0.08, ao: 0 }));
  b.box(0.38, 0.04, 0.17, { x: 0.6, y: h + 0.07 }, glow(0xffd9a0, 2.8));
  b.pop();
}

function barrel(b: Builder, p: Prop, rng: Rng): void {
  const cx = (p.x0 + p.x1) / 2 - HALF_W + rng.range(-0.1, 0.1);
  const cz = (p.y0 + p.y1) / 2 - HALF_H + rng.range(-0.1, 0.1);
  const col = [0x2f5f8a, 0x9a3a2a, 0xc7a52e, 0x7a4a2a][p.variant % 4] as number;
  const lying = p.variant === 3;
  b.push({ x: cx, z: cz, y: lying ? 0.3 : 0, rx: lying ? Math.PI / 2 : 0, ry: rng.range(0, 6) });
  b.cyl(0.3, 0.3, 0.9, 10, {}, metal(col, { jitter: 0.25, ao: 0.45, aoH: 0.9 }));
  for (const y of [0.12, 0.45, 0.78]) b.cyl(0.318, 0.318, 0.05, 10, { y }, metal(col, { jitter: 0.2, ao: 0.2 }));
  b.cyl(0.26, 0.26, 0.03, 10, { y: 0.9 }, metal(0x8a8e92, { jitter: 0.1, ao: 0 }));
  b.pop();
}

function sandbag(b: Builder, p: Prop, rng: Rng): void {
  const r = rectOf(p);
  b.push({ x: r.cx, z: r.cz, ry: r.horiz ? 0 : Math.PI / 2 });
  const rows = Math.max(1, Math.round(r.T));
  for (let layer = 0; layer < 2; layer++) {
    for (let row = 0; row < rows; row++) {
      for (let x = -r.L / 2 + 0.28 + (layer % 2) * 0.25; x < r.L / 2 - 0.1; x += 0.5) {
        b.rbox(0.5, 0.22, 0.34, 0.09, { x, y: layer * 0.2, z: (row - (rows - 1) / 2) * 0.4 + rng.range(-0.03, 0.03), ry: rng.range(-0.12, 0.12) }, matte(rng.chance(0.5) ? Pal.sandbag : 0x938660, { jitter: 0.18, ao: 0.4, aoH: 0.4 }));
      }
    }
  }
  b.pop();
}

function fence(b: Builder, p: Prop, rng: Rng): void {
  const r = rectOf(p);
  b.push({ x: r.cx, z: r.cz, ry: r.horiz ? 0 : Math.PI / 2 });
  for (let x = -r.L / 2; x <= r.L / 2 + 0.01; x += 1.5) {
    b.cyl(0.03, 0.03, 1.5, 5, { x, rx: rng.range(-0.2, 0.2), rz: rng.range(-0.15, 0.15) }, metal(0x6b6f72, { jitter: 0.1, ao: 0.2 }));
  }
  for (const y of [0.35, 0.8, 1.3]) b.box(r.L, 0.02, 0.02, { y: y - rng.range(0, 0.1) }, metal(0x6b6f72, { jitter: 0.1, ao: 0 }));
  b.pop();
}

// ---------------------------------------------------------------- 发电机、工坊

function generator(b: Builder, p: Prop): void {
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

function workbench(b: Builder, p: Prop): void {
  const r = rectOf(p);
  b.push({ x: r.cx, z: r.cz, ry: r.horiz ? 0 : Math.PI / 2 });
  const L = r.L;
  // 桌面、桌腿、抽屉
  b.box(L - 0.1, 0.1, 0.85, { y: 0.8 }, matte(Pal.wood, { jitter: 0.18, ao: 0.1 }));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.1, 0.8, 0.1, { x: sx * (L / 2 - 0.2), z: sz * 0.34 }, metal(Pal.steel, { jitter: 0.08, ao: 0.4 }));
  b.box(L - 0.6, 0.3, 0.7, { y: 0.45 }, metal(0x3a4750, { jitter: 0.1, ao: 0.2 }));
  for (let i = 0; i < 3; i++) b.box(0.4, 0.04, 0.02, { x: -0.8 + i * 0.8, y: 0.62, z: 0.36 }, metal(0x9aa0a4, { ao: 0 }));
  // 台钳
  b.box(0.3, 0.2, 0.25, { x: -L / 2 + 0.5, y: 0.9, z: 0.15 }, metal(0x4a5560, { jitter: 0.08, ao: 0 }));
  b.box(0.1, 0.12, 0.3, { x: -L / 2 + 0.5, y: 1.0, z: 0.3 }, metal(0x2a2f33, { ao: 0 }));
  // 桌上的零件：枪管、弹药盒、扳手
  b.cyl(0.04, 0.04, 0.8, 6, { x: 0.2, y: 0.95, z: 0.1, rz: Math.PI / 2 }, metal(0x2a2a2a, { ao: 0 }));
  b.rbox(0.35, 0.2, 0.22, 0.03, { x: 0.9, y: 0.9, z: -0.1 }, matte(Pal.olive, { jitter: 0.1, ao: 0 }));
  b.box(0.45, 0.02, 0.07, { x: -0.3, y: 0.9, z: -0.2, ry: 0.5 }, metal(0x9aa0a4, { ao: 0 }));
  // 墙板和挂着的工具
  b.box(L - 0.2, 1.0, 0.06, { y: 1.15, z: -0.46 }, matte(0x3c342c, { jitter: 0.12, ao: 0.2 }));
  for (let i = 0; i < 7; i++) {
    const x = -L / 2 + 0.35 + i * ((L - 0.7) / 6);
    b.box(0.06, 0.3 + (i % 3) * 0.1, 0.04, { x, y: 1.4 + (i % 2) * 0.1, z: -0.42 }, metal(i % 2 ? 0x9aa0a4 : Pal.red, { ao: 0, jitter: 0.1 }));
  }
  // 台灯
  b.rod([L / 2 - 0.3, 0.9, -0.2], [L / 2 - 0.3, 1.6, -0.1], 0.02, metal(0x2a2a2a, { ao: 0 }), 4);
  b.rod([L / 2 - 0.3, 1.6, -0.1], [L / 2 - 0.65, 1.55, 0.1], 0.02, metal(0x2a2a2a, { ao: 0 }), 4);
  b.cone(0.13, 0.14, 8, { x: L / 2 - 0.7, y: 1.4, z: 0.12, rx: Math.PI }, metal(Pal.hazard, { ao: 0 }));
  b.sphere(0.04, 6, 4, { x: L / 2 - 0.7, y: 1.5, z: 0.12 }, glow(0xffe0a0, 2.6));
  b.pop();
}

// ---------------------------------------------------------------- 总入口

export function buildProp(b: Builder, p: Prop): void {
  const rng = new Rng(((p.x0 * 73856093) ^ (p.y0 * 19349663) ^ 0x9e3779b9) >>> 0);
  switch (p.kind) {
    case 'wall':
      return wall(b, p, rng);
    case 'doorframe':
      return doorframe(b, p);
    case 'container':
      return container(b, p, rng);
    case 'car':
      return car(b, p, rng);
    case 'tree':
      return tree(b, p, rng);
    case 'crate':
      return crate(b, p, rng);
    case 'barrier':
      return barrier(b, p);
    case 'pump':
      return pump(b, p, rng);
    case 'pillar':
      return pillar(b, p);
    case 'canopy':
      return canopy(b, p);
    case 'rack':
      return rack(b, p, rng);
    case 'rubble':
      return rubble(b, p, rng);
    case 'chunk':
      return chunk(b, p, rng);
    case 'lamp':
      return lamp(b, p);
    case 'barrel':
      return barrel(b, p, rng);
    case 'sandbag':
      return sandbag(b, p, rng);
    case 'fence':
      return fence(b, p, rng);
    case 'generator':
      return generator(b, p);
    case 'workbench':
      return workbench(b, p);
    case 'scrapbox':
      return;
  }
}
