import { Rng } from '../../../game/core/rng';
import type { Prop } from '../../../game/world/types';
import { Builder, Pal } from '../../kit';
import { rectOf, matte, metal, glow } from './kit';

/* 墙体、门框 */

export function wall(b: Builder, p: Prop, rng: Rng): void {
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
    // 预制板：接缝处是凸出的 H 型钢柱，板面有吊装孔和水平浇筑线
    for (let x = -L / 2 + 2; x < L / 2 - 0.2; x += 2) {
      b.box(0.05, bodyH - 0.1, 0.94, { x, y: footH }, matte(0x44433f, { jitter: 0, ao: 0 }));
      for (const s of [1, -1]) {
        b.box(0.16, bodyH + 0.06, 0.03, { x, y: footH - 0.02, z: s * 0.47 }, metal(0x4a4f54, { jitter: 0.1, ao: 0.3, aoH: 1.4 }));
        b.box(0.03, bodyH + 0.06, 0.05, { x, y: footH - 0.02, z: s * 0.45 }, metal(0x4a4f54, { jitter: 0.1, ao: 0.3, aoH: 1.4 }));
      }
    }
    for (let x = -L / 2 + 1; x < L / 2; x += 2) {
      for (const s of [1, -1]) {
        b.box(0.08, 0.08, 0.01, { x: x - 0.45, y: h - 0.45, z: s * 0.452 }, matte(0x2f2e2b, { jitter: 0, ao: 0 }));
        b.box(0.08, 0.08, 0.01, { x: x + 0.45, y: h - 0.45, z: s * 0.452 }, matte(0x2f2e2b, { jitter: 0, ao: 0 }));
        b.box(1.9, 0.015, 0.008, { x, y: footH + bodyH * 0.5, z: s * 0.452 }, matte(0x6e6c66, { jitter: 0.1, ao: 0 }));
      }
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

export function doorframe(b: Builder, p: Prop): void {
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
