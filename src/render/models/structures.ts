import type { Group } from 'three';
import { Rng } from '../../game/core/rng';
import { Builder, toGroup, type Built, type Style } from '../kit';

const matte = (color: number, o: Partial<Style> = {}): Style => ({ color, jitter: 0.16, ao: 0.35, aoH: 1.0, ...o });
const metal = (color: number, o: Partial<Style> = {}): Style => ({ color, mat: 'metal', jitter: 0.14, ao: 0.2, aoH: 1.0, ...o });
const glow = (color: number, k = 2): Style => ({ color, mat: 'glow', glow: k });

const WOOD = 0x8a6a45;
const WOOD_D = 0x5a4128;
const WOOD_OLD = 0x6e5a42;

/**
 * 木制路障：两根交叉的原木支架 + 横向木板 + 沙袋压脚 + 倒钩铁丝网。
 * state 0 = 完好，1 = 受损（掉了木板、铁丝网歪了），2 = 濒毁（只剩骨架，倾斜）。
 */
function barricadeGeometry(state: number, seed: number): Built {
  const b = new Builder();
  const r = new Rng(seed);
  const tilt = state === 2 ? 0.14 : state === 1 ? 0.05 : 0;
  b.push({ rz: tilt, rx: state === 2 ? -0.06 : 0 });

  // 沙袋压脚
  for (const z of [-0.36, 0.36]) {
    for (let i = 0; i < 3; i++) {
      if (state === 2 && r.chance(0.4)) continue;
      b.rbox(0.32, 0.18, 0.26, 0.07, { x: -0.3 + i * 0.3, z, y: 0, ry: r.range(-0.1, 0.1) }, matte(r.chance(0.5) ? 0xa89a72 : 0x938660, { jitter: 0.2, ao: 0.5, aoH: 0.3 }));
    }
  }
  // 交叉支架（四根斜撑，两个 X）
  for (const z of [-0.32, 0.32]) {
    b.rod([-0.42, 0.12, z], [0.42, 1.12, z], 0.055, matte(WOOD_D, { jitter: 0.2 }), 6);
    b.rod([0.42, 0.12, z], [-0.42, 1.12, z], 0.055, matte(WOOD_D, { jitter: 0.2 }), 6);
  }
  // 横梁
  b.box(0.95, 0.09, 0.09, { y: 0.5, z: 0 }, matte(WOOD_D, { jitter: 0.2, ao: 0.1 }));
  b.box(0.95, 0.09, 0.09, { y: 1.0, z: 0 }, matte(WOOD_D, { jitter: 0.2, ao: 0.1 }));
  // 横向木板：每块 8% 概率掉；受损越重掉得越多
  const drop = state === 0 ? 0 : state === 1 ? 0.35 : 0.65;
  const planks = [0.26, 0.5, 0.74, 0.98];
  for (let i = 0; i < planks.length; i++) {
    for (const z of [-0.36, 0.36]) {
      if (r.chance(drop)) continue;
      const slip = state > 0 ? r.range(-0.05, 0.05) : 0;
      b.box(0.96, 0.17, 0.05, { y: planks[i] as number, z, rz: slip, x: r.range(-0.02, 0.02) }, matte(state === 0 ? WOOD : WOOD_OLD, { jitter: 0.24, ao: 0.3 }));
      // 钉子
      b.box(0.025, 0.025, 0.012, { x: -0.4, y: (planks[i] as number) + 0.08, z: z + Math.sign(z) * 0.03 }, metal(0xaaaaaa, { ao: 0, jitter: 0.05 }));
      b.box(0.025, 0.025, 0.012, { x: 0.4, y: (planks[i] as number) + 0.08, z: z + Math.sign(z) * 0.03 }, metal(0xaaaaaa, { ao: 0, jitter: 0.05 }));
    }
  }
  // 顶部铁丝网：完好时是一圈圈的线，受损时垂下来
  const wireY = state === 2 ? 1.0 : 1.18;
  b.rod([-0.48, wireY, 0], [0.48, wireY + (state === 2 ? -0.12 : 0.03), 0], 0.018, metal(0x2a2a2a, { ao: 0, jitter: 0.05 }), 4);
  for (let i = 0; i < 6; i++) {
    const x = -0.4 + i * 0.16;
    b.torus(0.07, 0.012, 4, 8, { x, y: wireY + 0.04, ry: Math.PI / 2, rx: r.range(-0.3, 0.3) }, metal(0x2a2a2a, { ao: 0, jitter: 0.05 }));
    if (state < 2) b.cone(0.012, 0.07, 4, { x, y: wireY + 0.1, rz: r.range(-0.6, 0.6) }, metal(0x3a3a3a, { ao: 0, jitter: 0.05 }));
  }
  b.pop();
  return b.build();
}

export function barricadeVariants(seed: number): Built[] {
  return [0, 1, 2].map((s) => barricadeGeometry(s, seed));
}

/** 炮塔底座（不转） */
function turretBase(): Built {
  const b = new Builder();
  b.cyl(0.46, 0.5, 0.14, 10, {}, matte(0x4a4d50, { jitter: 0.1 }));
  b.cyl(0.38, 0.42, 0.34, 10, { y: 0.14 }, metal(0x5a6168, { jitter: 0.14, ao: 0.4, aoH: 0.6 }));
  // 螺栓和警示条
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.cyl(0.025, 0.025, 0.04, 5, { x: Math.cos(a) * 0.43, z: Math.sin(a) * 0.43, y: 0.14 }, metal(0xa8acb0, { ao: 0, jitter: 0.05 }));
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.2;
    b.box(0.14, 0.06, 0.03, { x: Math.cos(a) * 0.4, z: Math.sin(a) * 0.4, y: 0.32, ry: -a }, matte(i % 2 ? 0xd6a824 : 0x222222, { jitter: 0.06, ao: 0 }));
  }
  // 沙袋围一圈
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.3;
    b.rbox(0.24, 0.14, 0.2, 0.05, { x: Math.cos(a) * 0.52, z: Math.sin(a) * 0.52, y: 0, ry: -a }, matte(i % 2 ? 0xa89a72 : 0x938660, { jitter: 0.2, ao: 0.5, aoH: 0.2 }));
  }
  return b.build();
}

/** 炮塔的转动部分：朝 +Z */
function turretHead(): Built {
  const b = new Builder();
  const y = 0.5;
  // 主体
  b.rbox(0.5, 0.26, 0.5, 0.06, { y }, metal(0x6a7480, { jitter: 0.14, ao: 0.2, aoH: 0.4 }));
  b.rbox(0.42, 0.1, 0.42, 0.04, { y: y + 0.26 }, metal(0x4a525c, { jitter: 0.1, ao: 0 }));
  // 双管
  for (const s of [-1, 1]) {
    b.rbox(0.09, 0.09, 0.4, 0.02, { x: s * 0.11, y: y + 0.08, z: 0.22 }, metal(0x2a2e33, { jitter: 0.1, ao: 0 }));
    b.cyl(0.028, 0.028, 0.38, 8, { x: s * 0.11, y: y + 0.125, z: 0.4, rx: Math.PI / 2 }, metal(0x14161a, { jitter: 0.06, ao: 0 }));
    b.cyl(0.04, 0.04, 0.06, 8, { x: s * 0.11, y: y + 0.125, z: 0.74, rx: Math.PI / 2 }, metal(0x1a1c20, { jitter: 0.06, ao: 0 }));
    // 散热孔
    for (let i = 0; i < 4; i++) b.box(0.1, 0.012, 0.03, { x: s * 0.11, y: y + 0.18, z: 0.2 + i * 0.07 }, metal(0x0c0d10, { jitter: 0, ao: 0 }));
  }
  // 弹链盒 + 弹链
  b.rbox(0.18, 0.2, 0.22, 0.03, { x: -0.3, y: y + 0.02, z: -0.04 }, matte(0x4d5a3a, { jitter: 0.14 }));
  b.rod([-0.26, y + 0.16, 0.04], [-0.12, y + 0.14, 0.2], 0.018, metal(0xb8943c, { ao: 0, jitter: 0.1 }), 4);
  // 传感器和红外灯
  b.cyl(0.05, 0.05, 0.08, 8, { x: 0, y: y + 0.36, z: 0.05 }, metal(0x1a1c20, { ao: 0 }));
  b.cyl(0.035, 0.035, 0.01, 8, { x: 0, y: y + 0.44, z: 0.05 }, glow(0xff3a2a, 2.4));
  b.box(0.1, 0.03, 0.01, { x: 0, y: y + 0.17, z: 0.255 }, glow(0x66e0ff, 1.8)); // 瞄准灯
  // 天线
  b.rod([0.18, y + 0.36, -0.1], [0.2, y + 0.75, -0.14], 0.008, metal(0x2a2a2a, { ao: 0 }), 4);
  return b.build();
}

/** 地刺：底板 + 一圈尖刺 */
function spikesPlate(): Built {
  const b = new Builder();
  b.box(0.92, 0.07, 0.92, {}, metal(0x4a4e52, { jitter: 0.16, ao: 0.3, aoH: 0.2 }));
  for (let i = 0; i < 4; i++) {
    b.box(0.92, 0.04, 0.05, { y: 0.07, z: -0.42 + i * 0.28 }, metal(0x363a3e, { jitter: 0.1, ao: 0 }));
  }
  for (const [x, z] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]] as const) b.cyl(0.04, 0.04, 0.05, 6, { x, z, y: 0.07 }, metal(0xa8acb0, { ao: 0, jitter: 0.06 }));
  return b.build();
}

function spikesBlades(): Built {
  const b = new Builder();
  const r = new Rng(5);
  for (let ix = 0; ix < 4; ix++) {
    for (let iz = 0; iz < 4; iz++) {
      const x = -0.33 + ix * 0.22;
      const z = -0.33 + iz * 0.22;
      const h = 0.34 + r.range(-0.04, 0.05);
      b.cone(0.055, h, 5, { x, z, y: 0.07, rx: r.range(-0.08, 0.08), rz: r.range(-0.08, 0.08) }, matte(0x8a9096, { jitter: 0.22, ao: 0.35, aoH: 0.35 }));
    }
  }
  return b.build();
}

export interface Parts {
  base: Group;
  head?: Group;
  blades?: Group;
}

let turretBaseGeo: Built | null = null;
let turretHeadGeo: Built | null = null;
let spikesPlateGeo: Built | null = null;
let spikesBladesGeo: Built | null = null;

const barricadeCache = new Map<number, Built[]>();

export function makeBarricade(seed: number, state: number): Group {
  let v = barricadeCache.get(seed);
  if (!v) {
    v = barricadeVariants(seed);
    barricadeCache.set(seed, v);
  }
  return meshes(v[state] as Built);
}

export function makeTurret(): Parts {
  turretBaseGeo ??= turretBase();
  turretHeadGeo ??= turretHead();
  return { base: meshes(turretBaseGeo), head: meshes(turretHeadGeo) };
}

export function makeSpikes(): Parts {
  spikesPlateGeo ??= spikesPlate();
  spikesBladesGeo ??= spikesBlades();
  return { base: meshes(spikesPlateGeo), blades: meshes(spikesBladesGeo) };
}

/** 几何体按种类缓存、实例间共享，材质也是共享的：不要对这些网格 dispose */
function meshes(built: Built): Group {
  return toGroup(built);
}
