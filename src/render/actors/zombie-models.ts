import { Rng } from '../../game/core/rng';
import type { ZombieKind } from '../../game/data/zombies';
import { B, HUMAN, RigActor, makeJoints, type Joints, type Proportions } from './rig';
import { Builder, Mats, type Built, type Style } from '../kit';

/** 同一类僵尸预先生成的外观套数 */
export const VARIANTS = 4;

const matte = (color: number, o: Partial<Style> = {}): Style => ({ color, jitter: 0.14, ao: 0.3, aoH: 1.2, ...o });
const metal = (color: number, o: Partial<Style> = {}): Style => ({ color, mat: 'metal', jitter: 0.16, ao: 0.25, aoH: 1.2, ...o });
const glow = (color: number, k = 1.6): Style => ({ color, mat: 'glow', glow: k });

interface Look {
  skin: number;
  skinDark: number;
  shirt: number;
  pants: number;
  shoe: number;
  hair: number | null;
  hat: number | null;
  eyes: number;
  /** 躯干宽度倍数 */
  bulk: number;
  /** 躯干厚度倍数 */
  depth: number;
  sleeves: 'long' | 'short' | 'none';
  /** 0 无，1 缺左小臂，2 缺右小臂 */
  missingArm: 0 | 1 | 2;
  wounds: number;
  gaunt: boolean;
}

const SKINS = [0x6c7d5c, 0x78866a, 0x5f6e52, 0x82806a, 0x56664e, 0x707e60];
const SHIRTS = [0x55606a, 0x7a4a3a, 0x4a5a40, 0x8a8472, 0x3d3d44, 0x6a5a7a, 0x8a6a2e];
const PANTS = [0x2f3a4a, 0x4a4a3e, 0x3a3228, 0x2a2a30];
const HAIRS = [0x2a2018, 0x4a3a28, 0x6a5a40, 0x1a1a1a, 0x7a7468];

export const PROPORTIONS: Record<ZombieKind, Proportions> = {
  walker: HUMAN,
  runner: { ...HUMAN, hipY: 1.0, kneeY: 0.53, waistY: 1.07, neckY: 1.56, shoulderY: 1.48, shoulderX: 0.2, hipX: 0.09, upper: 0.32, fore: 0.3 },
  bloater: { ...HUMAN, hipY: 0.86, kneeY: 0.45, waistY: 0.92, neckY: 1.36, shoulderY: 1.28, shoulderX: 0.4, hipX: 0.17, upper: 0.28, fore: 0.25 },
  breaker: { ...HUMAN, shoulderX: 0.29, hipX: 0.12, neckY: 1.56, shoulderY: 1.48, waistY: 1.04, upper: 0.31, fore: 0.28 },
  colossus: { ...HUMAN, shoulderX: 0.34, hipX: 0.14, neckY: 1.55, shoulderY: 1.46, waistY: 1.02, upper: 0.32, fore: 0.3 },
  spitter: { ...HUMAN, neckY: 1.46, shoulderY: 1.4, waistY: 0.98 },
  screamer: { ...HUMAN, hipY: 0.95, kneeY: 0.5, waistY: 1.0, neckY: 1.48, shoulderY: 1.4, shoulderX: 0.18, hipX: 0.08, upper: 0.3, fore: 0.29 },
};

export const MODEL_SCALE: Record<ZombieKind, number> = { walker: 1, runner: 1, bloater: 1, breaker: 1, colossus: 2.1, spitter: 1, screamer: 1 };

function lookFor(kind: ZombieKind, variant: number): Look {
  const r = new Rng(variant * 7919 + kind.length * 104729 + kind.charCodeAt(0));
  const base: Look = {
    skin: r.pick(SKINS),
    skinDark: 0,
    shirt: r.pick(SHIRTS),
    pants: r.pick(PANTS),
    shoe: 0x2a2420,
    hair: r.chance(0.65) ? r.pick(HAIRS) : null,
    hat: r.chance(0.2) ? r.pick([0x3a4a5a, 0x6a2a2a, 0x2a2a2a]) : null,
    eyes: 0xffd060,
    bulk: 1,
    depth: 1,
    sleeves: r.pick(['long', 'short', 'short', 'none'] as const),
    missingArm: r.chance(0.22) ? (r.chance(0.5) ? 1 : 2) : 0,
    wounds: r.int(2, 5),
    gaunt: false,
  };
  base.skinDark = base.skin;
  switch (kind) {
    case 'runner':
      return { ...base, skin: r.pick([0x9a9c8a, 0x92947f, 0xa09c88]), eyes: 0xff4030, bulk: 0.82, depth: 0.85, sleeves: 'none', missingArm: 0, gaunt: true, hat: null, wounds: r.int(3, 6) };
    case 'bloater':
      return { ...base, skin: r.pick([0x8fa064, 0x9aa870, 0x7d9058, 0xa0a878]), eyes: 0xc8ff50, bulk: 1.75, depth: 1.5, sleeves: 'none', missingArm: 0, hat: null, hair: r.chance(0.3) ? base.hair : null, shirt: 0x6a6a52 };
    case 'breaker':
      return { ...base, skin: r.pick([0x7d8c70, 0x6f7d66, 0x8a9a78]), eyes: 0xff9030, bulk: 1.25, depth: 1.15, sleeves: 'none', missingArm: 0, hat: null, hair: null, shirt: r.pick([0x3d3d44, 0x4a4a3e, 0x2f3a4a]) };
    case 'spitter':
      return { ...base, skin: r.pick([0x7a8a4a, 0x8a9a50, 0x6f8044]), eyes: 0xb8ff3a, bulk: 1.05, sleeves: 'none', hat: null, hair: null, shirt: 0x4a5032, wounds: r.int(3, 6) };
    case 'screamer':
      return { ...base, skin: r.pick([0xb0aaa0, 0xa8a49a, 0xbab4a8]), eyes: 0xff3af0, bulk: 0.78, depth: 0.8, sleeves: 'none', missingArm: 0, gaunt: true, hat: null, hair: r.pick([0x7a7468, 0x2a2018]), shirt: 0x6a5a7a, wounds: r.int(2, 4) };
    case 'colossus':
      return { ...base, skin: 0x5a6068, eyes: 0xff2a1a, bulk: 1.5, depth: 1.3, sleeves: 'none', missingArm: 0, hat: null, hair: null, shirt: 0x4a3a34, pants: 0x3a3028, wounds: 8 };
    default:
      return base;
  }
}

function limb(b: Builder, x: number, yTop: number, yBot: number, w: number, d: number, st: Style, z = 0): void {
  b.rbox(w, yTop - yBot, d, Math.min(w, d) * 0.3, { x, y: yBot, z }, st);
}

function wound(b: Builder, rng: Rng, x: number, y: number, z: number, side: 1 | -1, size: number): void {
  b.box(size * 1.4, size, 0.012, { x, y, z: z + side * 0.006 }, matte(0x5a1812, { jitter: 0.25, ao: 0 }));
  b.box(size * 0.7, size * 0.55, 0.016, { x: x + rng.range(-0.01, 0.01), y: y + size * 0.2, z: z + side * 0.007 }, matte(0x9a3a2a, { jitter: 0.3, ao: 0 }));
}

function humanoid(b: Builder, J: Joints, L: Look, rng: Rng): void {
  const sk = matte(L.skin);
  const skD = matte(L.skin, { jitter: 0.28, ao: 0.4 });
  const shirt = matte(L.shirt, { jitter: 0.2 });
  const pants = matte(L.pants, { jitter: 0.2 });
  const waist = J.chest[1];
  const neck = J.head[1];
  const topY = neck - 0.03;
  const tw = 0.36 * L.bulk;
  const td = 0.21 * L.depth;

  // ---- 骨盆 ----
  b.bone(B.pelvis);
  b.rbox(0.3 * L.bulk, 0.22, td * 0.95, 0.05, { y: J.pelvis[1] - 0.14 }, pants);
  b.box(0.31 * L.bulk, 0.045, td * 0.97, { y: J.pelvis[1] + 0.02 }, matte(0x1e1a16, { jitter: 0.1, ao: 0 })); // 腰带
  b.box(0.06, 0.04, 0.01, { y: J.pelvis[1] + 0.02, z: td * 0.49 }, metal(0x9a9a8a, { ao: 0 })); // 皮带扣

  // ---- 躯干 ----
  b.bone(B.chest);
  b.rbox(tw, topY - waist, td, 0.06, { y: waist }, shirt);
  b.rbox(tw * 1.12, 0.14, td * 1.04, 0.05, { y: topY - 0.14 }, shirt); // 肩线
  b.box(tw * 0.5, 0.02, 0.012, { y: waist + 0.16, z: td / 2 + 0.002 }, matte(0x201c18, { jitter: 0.1, ao: 0 })); // 衣褶/破口
  if (L.gaunt) {
    // 干瘦：肋骨印
    for (let i = 0; i < 4; i++) b.box(tw * 0.7, 0.012, 0.01, { y: waist + 0.12 + i * 0.07, z: td / 2 + 0.004 }, matte(0x8a8a78, { jitter: 0.1, ao: 0 }));
  }
  // 伤口 / 污渍
  for (let i = 0; i < L.wounds; i++) {
    const side = rng.chance(0.65) ? 1 : -1;
    wound(b, rng, rng.range(-tw * 0.35, tw * 0.35), rng.range(waist + 0.1, topY - 0.08), (td / 2) * side, side, rng.range(0.04, 0.1));
  }
  // 背部污渍
  b.box(tw * 0.6, 0.18, 0.01, { y: waist + 0.2, z: -td / 2 - 0.004 }, matte(0x2a2420, { jitter: 0.3, ao: 0 }));

  // ---- 头 ----
  b.bone(B.head);
  const hy = neck;
  b.cyl(0.05, 0.06, 0.1, 6, { y: hy - 0.06 }, skD);
  b.rbox(0.19, 0.24, 0.21, 0.06, { y: hy + 0.03, z: 0.01 }, sk);
  b.rbox(0.15, 0.08, 0.17, 0.03, { y: hy + 0.0, z: 0.03 }, skD); // 下颌
  b.box(0.1, 0.03, 0.012, { y: hy + 0.075, z: 0.118 }, matte(0x201410, { jitter: 0, ao: 0 })); // 嘴
  b.box(0.012, 0.03, 0.012, { x: -0.025, y: hy + 0.05, z: 0.118 }, matte(0xb8b4a0, { jitter: 0.05, ao: 0 })); // 牙
  b.box(0.012, 0.03, 0.012, { x: 0.03, y: hy + 0.05, z: 0.118 }, matte(0xb8b4a0, { jitter: 0.05, ao: 0 }));
  for (const s of [-1, 1]) {
    b.box(0.04, 0.025, 0.016, { x: s * 0.05, y: hy + 0.17, z: 0.108 }, glow(L.eyes, 1.9));
    b.box(0.055, 0.012, 0.012, { x: s * 0.05, y: hy + 0.2, z: 0.112 }, matte(0x2a2418, { jitter: 0.1, ao: 0 })); // 眉
    b.box(0.02, 0.05, 0.04, { x: s * 0.105, y: hy + 0.12, z: 0.0 }, skD); // 耳
  }
  b.box(0.035, 0.05, 0.03, { y: hy + 0.115, z: 0.12 }, sk); // 鼻
  if (L.hair !== null) {
    b.rbox(0.2, 0.06, 0.22, 0.03, { y: hy + 0.24, z: 0.0 }, matte(L.hair, { jitter: 0.25 }));
    b.rbox(0.2, 0.14, 0.05, 0.02, { y: hy + 0.12, z: -0.1 }, matte(L.hair, { jitter: 0.25 }));
  }
  if (L.hat !== null) {
    b.rbox(0.22, 0.07, 0.24, 0.03, { y: hy + 0.25 }, matte(L.hat));
    b.box(0.2, 0.015, 0.1, { y: hy + 0.255, z: 0.17 }, matte(L.hat));
  }
  wound(b, rng, rng.range(-0.05, 0.05), hy + rng.range(0.05, 0.2), 0.115, 1, 0.045);

  // ---- 手臂 ----
  for (const side of [0, 1] as const) {
    const sg = side === 0 ? 1 : -1;
    const sh = side === 0 ? J.shoulderL : J.shoulderR;
    const el = side === 0 ? J.elbowL : J.elbowR;
    const wr = side === 0 ? J.wristL : J.wristR;
    const upperB = side === 0 ? B.armUL : B.armUR;
    const lowerB = side === 0 ? B.armLL : B.armLR;
    const cx = (sh[0] + el[0]) / 2;
    const aw = 0.09 * Math.min(1.5, L.bulk * 0.95 + 0.1);
    const missing = L.missingArm === (side === 0 ? 1 : 2);
    const upperSt = L.sleeves === 'none' ? skD : shirt;

    b.bone(upperB);
    b.sphere(aw * 0.62, 7, 5, { x: sh[0], y: sh[1] - 0.02 }, upperSt);
    limb(b, cx, sh[1] - 0.02, el[1], aw, aw * 0.95, upperSt);
    if (L.sleeves === 'short') limb(b, cx, el[1] + 0.12, el[1] - 0.0, aw * 0.9, aw * 0.9, skD); // 短袖下半截露皮肤
    if (L.sleeves === 'long') b.box(aw * 1.02, 0.02, aw * 1.02, { x: cx, y: el[1] + 0.01 }, matte(0x201c18, { jitter: 0.1, ao: 0 }));

    b.bone(lowerB);
    b.sphere(aw * 0.5, 6, 4, { x: el[0], y: el[1] }, skD);
    if (!missing) {
      limb(b, (el[0] + wr[0]) / 2, el[1], wr[1] + 0.02, aw * 0.82, aw * 0.8, skD);
      // 手：手掌 + 三根微曲的手指
      b.rbox(0.075, 0.09, 0.04, 0.015, { x: wr[0], y: wr[1] - 0.07, z: 0.0 }, sk);
      for (let f = -1; f <= 1; f++) b.rbox(0.017, 0.07, 0.017, 0.006, { x: wr[0] + f * 0.025, y: wr[1] - 0.14, z: 0.012 }, sk);
      b.rbox(0.02, 0.05, 0.02, 0.006, { x: wr[0] + sg * -0.045, y: wr[1] - 0.09, z: 0.025, rx: -0.5 }, sk);
    } else {
      // 断臂：参差的断口和暴露的骨头
      limb(b, el[0], el[1], el[1] - 0.1, aw * 0.8, aw * 0.8, skD);
      b.box(aw * 0.85, 0.03, aw * 0.85, { x: el[0], y: el[1] - 0.105 }, matte(0x7a1c14, { jitter: 0.2, ao: 0 }));
      b.cyl(0.012, 0.012, 0.06, 5, { x: el[0], y: el[1] - 0.14 }, matte(0xc8c4b0, { jitter: 0.1, ao: 0 }));
    }
  }

  // ---- 腿 ----
  for (const side of [0, 1] as const) {
    const hp = side === 0 ? J.hipL : J.hipR;
    const kn = side === 0 ? J.kneeL : J.kneeR;
    const an = side === 0 ? J.ankleL : J.ankleR;
    const upperB = side === 0 ? B.legUL : B.legUR;
    const lowerB = side === 0 ? B.legLL : B.legLR;
    const lw = 0.125 * Math.min(1.5, L.bulk * 0.9 + 0.12);
    b.bone(upperB);
    b.sphere(lw * 0.6, 7, 5, { x: hp[0], y: hp[1] }, pants);
    limb(b, hp[0], hp[1], kn[1], lw, lw * 1.05, pants);
    b.bone(lowerB);
    b.sphere(lw * 0.5, 6, 4, { x: kn[0], y: kn[1] }, pants);
    const torn = rng.chance(0.4);
    limb(b, kn[0], kn[1], an[1] + (torn ? 0.2 : 0.05), lw * 0.85, lw * 0.9, pants);
    if (torn) limb(b, kn[0], an[1] + 0.2, an[1] + 0.05, lw * 0.7, lw * 0.75, skD);
    // 鞋
    b.rbox(lw * 0.95, 0.09, 0.26, 0.03, { x: kn[0], y: 0.0, z: 0.07 }, matte(L.shoe, { jitter: 0.2 }));
    b.box(lw * 0.9, 0.025, 0.27, { x: kn[0], y: 0.0, z: 0.07 }, matte(0x151210, { jitter: 0, ao: 0 }));
  }
}

// ----------------------------------------------------------------------------------

function extrasBloater(b: Builder, J: Joints, L: Look, rng: Rng): void {
  b.bone(B.chest);
  const waist = J.chest[1];
  // 巨大的腹部和不断冒泡的脓包
  b.sphere(0.5, 12, 9, { y: waist + 0.12, z: 0.2, sy: 0.85, sx: 1.05 }, matte(L.skin, { jitter: 0.22, ao: 0.3 }));
  b.sphere(0.46, 10, 8, { y: waist + 0.1, z: 0.26, sy: 0.82, sx: 1.0 }, matte(0x7a8a4e, { jitter: 0.28, ao: 0.1 }));
  for (let i = 0; i < 14; i++) {
    const a = rng.range(-1.2, 1.2);
    const h = rng.range(-0.35, 0.4);
    const r = rng.range(0.05, 0.12);
    const px = Math.sin(a) * 0.48;
    const py = waist + 0.12 + h;
    const pz = 0.2 + Math.cos(a) * 0.5 * (1 - Math.abs(h) * 0.4);
    // 脓包：外面一圈暗绿的肿块，里面透出发光的黄绿色
    b.sphere(r * 1.3, 6, 4, { x: px, y: py, z: pz, sy: 0.8 }, matte(0x6a7a42, { jitter: 0.3, ao: 0 }));
    b.sphere(r * 0.85, 6, 4, { x: px, y: py, z: pz + r * 0.5, sy: 0.8 }, glow(0xc8ff50, 2.3));
  }
  // 后背的肿块
  b.sphere(0.3, 8, 6, { x: 0.15, y: waist + 0.5, z: -0.18 }, matte(0x6a7a44, { jitter: 0.25 }));
  // 滴落的酸液
  for (let i = 0; i < 3; i++) b.cyl(0.012, 0.02, 0.18, 5, { x: rng.range(-0.3, 0.3), y: 0.1, z: 0.52 }, glow(0x9aff40, 1.1));
}

function extrasBreaker(b: Builder, J: Joints): void {
  const hy = J.head[1];
  // 头盔：焊起来的铁桶，留一条发光的缝
  b.bone(B.head);
  b.cyl(0.14, 0.15, 0.3, 8, { y: hy + 0.0 }, metal(0x6a6e70, { jitter: 0.25, ao: 0.2 }));
  b.box(0.2, 0.025, 0.02, { y: hy + 0.17, z: 0.14 }, glow(0xff9030, 2.0));
  b.cyl(0.155, 0.155, 0.03, 8, { y: hy + 0.28 }, metal(0x4a4e50, { jitter: 0.2, ao: 0 }));
  b.rod([0.08, hy + 0.1, 0.14], [0.08, hy + 0.25, 0.14], 0.012, metal(0x2a2a2a, { ao: 0 }), 4);
  // 肩甲、胸甲（拼接的铁皮和轮胎）
  b.bone(B.chest);
  const c = J.chest[1];
  b.box(0.5, 0.36, 0.05, { y: c + 0.18, z: 0.17 }, metal(0x73777a, { jitter: 0.25, ao: 0.2 }));
  b.box(0.22, 0.2, 0.05, { x: 0.12, y: c + 0.1, z: 0.2 }, metal(0x5a4a3a, { jitter: 0.25, ao: 0.1 }));
  for (const [x, y] of [[-0.2, 0.32], [0.2, 0.32], [-0.2, 0.06], [0.2, 0.06]] as const) b.cyl(0.015, 0.015, 0.02, 6, { x, y: c + y, z: 0.2, rx: Math.PI / 2 }, metal(0xaaaaaa, { ao: 0 }));
  b.cyl(0.14, 0.14, 0.12, 10, { x: 0, y: c + 0.35, z: -0.12, rx: Math.PI / 2 }, matte(0x1c1c1e, { jitter: 0.1, ao: 0 })); // 背上的轮胎
  // 肩甲
  b.bone(B.armUL);
  b.rbox(0.26, 0.09, 0.24, 0.03, { x: J.shoulderL[0] + 0.02, y: J.shoulderL[1] - 0.02 }, metal(0x6a4a34, { jitter: 0.25, ao: 0.1 }));
  b.bone(B.armUR);
  b.rbox(0.26, 0.09, 0.24, 0.03, { x: J.shoulderR[0] - 0.02, y: J.shoulderR[1] - 0.02 }, metal(0x73777a, { jitter: 0.25, ao: 0.1 }));
  b.cone(0.03, 0.12, 5, { x: J.shoulderR[0] - 0.04, y: J.shoulderR[1] + 0.07 }, metal(0x4a4a4a, { ao: 0 }));
  // 防暴盾：比人还宽，浅灰蓝的钢板，上面一条黄色警示带，正对前方
  b.bone(B.chest);
  const sx = 0.14;
  const sy = c - 0.2;
  const sz = 0.46;
  b.box(0.8, 1.15, 0.07, { x: sx, y: sy, z: sz }, metal(0x8a98a4, { jitter: 0.18, ao: 0.1 }));
  b.box(0.86, 0.06, 0.1, { x: sx, y: sy + 1.14, z: sz }, metal(0x4a545c, { ao: 0 }));
  b.box(0.86, 0.06, 0.1, { x: sx, y: sy - 0.02, z: sz }, metal(0x4a545c, { ao: 0 }));
  for (const s of [-1, 1]) b.box(0.06, 1.15, 0.1, { x: sx + s * 0.4, y: sy, z: sz }, metal(0x4a545c, { ao: 0 }));
  for (let i = 0; i < 6; i++) b.box(0.13, 0.12, 0.075, { x: sx - 0.33 + i * 0.13, y: sy + 0.18, z: sz }, matte(i % 2 ? Pal2.hazard : 0x1e1e1e, { jitter: 0.1, ao: 0 }));
  b.box(0.34, 0.12, 0.02, { x: sx, y: sy + 0.85, z: sz + 0.04 }, glow(0x6ab0d0, 0.7)); // 观察窗
  // 盾上的弹痕和划痕
  b.box(0.36, 0.018, 0.075, { x: sx - 0.1, y: sy + 0.55, z: sz, rz: 0.4 }, matte(0x20262a, { jitter: 0, ao: 0 }));
  b.cone(0.03, 0.02, 6, { x: sx + 0.18, y: sy + 0.45, z: sz + 0.05, rx: Math.PI / 2 }, matte(0x2a2f33, { jitter: 0, ao: 0 }));
  b.cone(0.025, 0.02, 6, { x: sx - 0.22, y: sy + 0.35, z: sz + 0.05, rx: Math.PI / 2 }, matte(0x2a2f33, { jitter: 0, ao: 0 }));
  // 大锤：挂在右手骨上，姿势里手臂约 -1.1 弧度，所以杆在局部坐标里朝下偏后
  b.bone(B.armLR);
  const w = J.wristR;
  const dir: [number, number, number] = [0.05, -0.9, -0.44];
  const len = 1.15;
  const end: [number, number, number] = [w[0] + dir[0] * len, w[1] + dir[1] * len, w[2] + dir[2] * len];
  b.rod([w[0], w[1] + 0.1, w[2] + 0.04], end, 0.025, matte(0x5a4128, { jitter: 0.2, ao: 0.1 }), 6);
  b.push({ x: end[0], y: end[1], z: end[2], rx: -1.1 });
  b.box(0.3, 0.18, 0.18, { y: -0.09 }, metal(0x4a4e52, { jitter: 0.22, ao: 0 }));
  b.box(0.32, 0.04, 0.2, { y: 0.1 }, metal(0x2e3236, { ao: 0 }));
  b.pop();
}

const Pal2 = { hazard: 0xd6a824 };

function extrasColossus(b: Builder, J: Joints, L: Look): void {
  const c = J.chest[1];
  b.bone(B.chest);
  // 胸腔被撕开，露出肋骨和发光的核心
  b.box(0.36, 0.34, 0.03, { y: c + 0.16, z: 0.16 }, matte(0x5a1812, { jitter: 0.25, ao: 0 }));
  for (let i = 0; i < 4; i++) {
    for (const s of [-1, 1]) {
      b.rod([s * 0.02, c + 0.06 + i * 0.08, 0.17], [s * 0.2, c + 0.1 + i * 0.08, 0.15], 0.014, matte(0xcfcab8, { jitter: 0.1, ao: 0 }), 5);
    }
  }
  b.sphere(0.075, 8, 6, { y: c + 0.24, z: 0.18 }, glow(0xff3322, 2.4));
  b.sphere(0.11, 8, 6, { y: c + 0.24, z: 0.17 }, glow(0xc01808, 0.9));
  // 缠身的铁链
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    b.torus(0.035, 0.009, 5, 8, { x: -0.22 + t * 0.44, y: c + 0.5 - t * 0.38, z: -0.0 + 0.19, rz: 0.7, ry: i % 2 ? 1.5 : 0 }, metal(0x6a6e72, { jitter: 0.2, ao: 0 }));
  }
  // 背脊上的骨刺
  for (let i = 0; i < 5; i++) b.cone(0.035, 0.22 - i * 0.02, 5, { y: c + 0.1 + i * 0.1, z: -0.15, rx: -0.5 }, matte(0xcfcab8, { jitter: 0.12, ao: 0 }));
  // 肩上的铁刺
  b.bone(B.armUL);
  b.cone(0.06, 0.28, 6, { x: J.shoulderL[0] + 0.05, y: J.shoulderL[1] + 0.02, rz: -0.5 }, metal(0x5a5e62, { jitter: 0.2 }));
  b.bone(B.armUR);
  b.cone(0.06, 0.28, 6, { x: J.shoulderR[0] - 0.05, y: J.shoulderR[1] + 0.02, rz: 0.5 }, metal(0x5a5e62, { jitter: 0.2 }));
  // 巨拳：右手更大
  b.bone(B.armLR);
  const w = J.wristR;
  b.rbox(0.2, 0.2, 0.18, 0.04, { x: w[0], y: w[1] - 0.2 }, matte(L.skin, { jitter: 0.25, ao: 0.3 }));
  for (let i = -1; i <= 1; i++) b.rbox(0.045, 0.09, 0.045, 0.01, { x: w[0] + i * 0.06, y: w[1] - 0.27, z: 0.07 }, matte(L.skin, { jitter: 0.25, ao: 0.3 }));
  b.torus(0.07, 0.016, 5, 8, { x: w[0], y: w[1] + 0.02, rx: Math.PI / 2 }, metal(0x5a5e62, { jitter: 0.2 })); // 铁镣
  // 头：獠牙和断角
  b.bone(B.head);
  const hy = J.head[1];
  for (const s of [-1, 1]) {
    b.cone(0.02, 0.1, 5, { x: s * 0.06, y: hy + 0.0, z: 0.1, rx: Math.PI }, matte(0xe0dccb, { jitter: 0.1, ao: 0 }));
    b.cone(0.03, 0.2, 5, { x: s * 0.08, y: hy + 0.22, z: -0.02, rz: -s * 0.4 }, matte(0xcfcab8, { jitter: 0.15, ao: 0 }));
  }
}

function extrasRunner(b: Builder, J: Joints, rng: Rng): void {
  // 张大的嘴和暴起的青筋
  b.bone(B.head);
  const hy = J.head[1];
  b.box(0.09, 0.05, 0.02, { y: hy + 0.04, z: 0.112 }, matte(0x1a0c08, { jitter: 0, ao: 0 }));
  b.bone(B.armLL);
  for (let i = 0; i < 3; i++) b.box(0.006, 0.12, 0.006, { x: J.elbowL[0] + 0.03, y: J.elbowL[1] - 0.06 - i * 0.03, z: 0.04 }, matte(0x5a6a8a, { jitter: 0.1, ao: 0 }));
  b.bone(B.chest);
  for (let i = 0; i < 4; i++) wound(b, rng, rng.range(-0.1, 0.1), J.chest[1] + 0.1 + i * 0.07, 0.1, 1, 0.04);
}

/** 吐酸者：鼓起的绿色喉囊（爆头 = 打破它）和背上的酸瘤 */
function extrasSpitter(b: Builder, J: Joints, rng: Rng): void {
  b.bone(B.head);
  const hy = J.head[1];
  b.sphere(0.12, 10, 8, { y: hy - 0.02, z: 0.1, sy: 0.85 }, glow(0x9aff3a, 1.4));
  b.box(0.08, 0.035, 0.02, { y: hy + 0.05, z: 0.12 }, matte(0x1a2008, { jitter: 0, ao: 0 }));
  b.bone(B.chest);
  for (let i = 0; i < 4; i++) b.sphere(rng.range(0.04, 0.07), 7, 5, { x: rng.range(-0.12, 0.12), y: J.chest[1] + rng.range(0.15, 0.38), z: -0.12 }, glow(0x7ad02a, 0.9));
}

/** 尖啸者：张到极限的嘴、拉长的脖子上的声囊 */
function extrasScreamer(b: Builder, J: Joints): void {
  b.bone(B.head);
  const hy = J.head[1];
  b.box(0.08, 0.1, 0.02, { y: hy + 0.0, z: 0.11 }, matte(0x1a0814, { jitter: 0, ao: 0 }));
  b.sphere(0.07, 8, 6, { y: hy - 0.1, z: 0.04, sx: 1.3 }, matte(0x9a6a8a, { jitter: 0.2, ao: 0.2 }));
  b.box(0.012, 0.012, 0.004, { x: -0.05, y: hy + 0.11, z: 0.115 }, glow(0xff3af0, 2));
  b.box(0.012, 0.012, 0.004, { x: 0.05, y: hy + 0.11, z: 0.115 }, glow(0xff3af0, 2));
}

function buildKindGeometry(kind: ZombieKind, variant: number): Built {
  const b = new Builder(true);
  const J = makeJoints(PROPORTIONS[kind]);
  const L = lookFor(kind, variant);
  const rng = new Rng(variant * 31337 + kind.length * 977 + 11);
  humanoid(b, J, L, rng);
  if (kind === 'bloater') extrasBloater(b, J, L, rng);
  else if (kind === 'breaker') extrasBreaker(b, J);
  else if (kind === 'colossus') extrasColossus(b, J, L);
  else if (kind === 'runner') extrasRunner(b, J, rng);
  else if (kind === 'spitter') extrasSpitter(b, J, rng);
  else if (kind === 'screamer') extrasScreamer(b, J);
  return b.build();
}

const cache = new Map<string, Built>();

export function zombieGeometry(kind: ZombieKind, variant: number): Built {
  const key = `${kind}:${variant}`;
  let g = cache.get(key);
  if (!g) {
    g = buildKindGeometry(kind, variant);
    cache.set(key, g);
  }
  return g;
}

export function createZombieActor(kind: ZombieKind, seed: number): RigActor {
  const variant = seed % VARIANTS;
  const actor = new RigActor(zombieGeometry(kind, variant), Mats, makeJoints(PROPORTIONS[kind]), Mats.flash);
  actor.group.scale.setScalar(MODEL_SCALE[kind]);
  return actor;
}
