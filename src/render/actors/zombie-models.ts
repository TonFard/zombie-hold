import { Group, Mesh, MeshStandardMaterial, SphereGeometry, TorusGeometry } from 'three';
import { Rng } from '../../game/core/rng';
import type { ZombieKind } from '../../game/data/zombies';
import { B, HUMAN, RigActor, makeJoints, type Joints, type Proportions } from './rig';
import { Builder, Mats, type Built, type Style } from '../kit';

/** 同一类僵尸预先生成的外观套数 */
export const VARIANTS = 4;

/**
 * 僵尸的材质：平滑着色（圆柱、球拼出来的身体不出棱面）。
 * 每个部件只绑一根骨头，关节弯曲时靠关节处的球遮住断口
 */
const ZMats = {
  matte: new MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.02 }),
  metal: new MeshStandardMaterial({ vertexColors: true, roughness: 0.46, metalness: 0.7 }),
  glow: Mats.glow,
};
const ZFlash = new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0, emissive: 0xff9070, emissiveIntensity: 1.6 });

const matte = (color: number, o: Partial<Style> = {}): Style => ({ color, jitter: 0.16, ao: 0.32, aoH: 1.4, ...o });
const skinSt = (color: number, o: Partial<Style> = {}): Style => ({ color, jitter: 0.24, ao: 0.22, aoH: 1.4, ...o });
const metal = (color: number, o: Partial<Style> = {}): Style => ({ color, mat: 'metal', jitter: 0.16, ao: 0.25, aoH: 1.2, ...o });
const glow = (color: number, k = 1.6): Style => ({ color, mat: 'glow', glow: k });
/** 干掉的血（发黑的暗红）和新鲜的血 */
const BLOOD = 0x3a0e0a;
const BLOOD_FRESH = 0x4e110c;
const blood = (fresh = false): Style => ({ color: fresh ? BLOOD_FRESH : BLOOD, jitter: 0.3, ao: 0 });
const dark = (color: number): Style => ({ color, jitter: 0.05, ao: 0 });

/** 颜色整体变亮 / 变暗 */
function shade(c: number, k: number): number {
  const ch = (s: number) => Math.min(255, Math.round(((c >> s) & 255) * k));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

type Outfit = 'tee' | 'shirt' | 'hoodie' | 'vest' | 'scrubs' | 'jacket' | 'hazmat' | 'bare';

interface Look {
  skin: number;
  shirt: number;
  /** 外套 / 反光背心 / 领带的颜色 */
  accent: number;
  pants: number;
  /** null = 光脚 */
  shoe: number | null;
  hair: number | null;
  hairStyle: 'short' | 'long' | 'bald';
  eyes: number;
  eyeGlow: number;
  /** 躯干宽度倍数 */
  bulk: number;
  /** 躯干厚度倍数 */
  depth: number;
  outfit: Outfit;
  sleeves: 'long' | 'short' | 'none';
  /** 0 无，1 缺左小臂，2 缺右小臂 */
  missingArm: 0 | 1 | 2;
  wounds: number;
  gaunt: boolean;
  /** 嘴张开的程度 0–1 */
  jaw: number;
  /** 鼻子烂掉了（只剩一个黑洞） */
  noNose: boolean;
}

/** 灰败的肤色：灰、发青、发黄，不用饱和的绿色 */
const SKINS = [0x7f7e72, 0x747c77, 0x88806c, 0x6d6857, 0x7b7a70, 0x656b60];
/** 褪色的衣服 */
const SHIRTS = [0x5b6670, 0x7a3b32, 0x4b5440, 0x9a9688, 0x34363c, 0x5a4f6a, 0x8a7240, 0x3e5568];
const PANTS = [0x3a4a60, 0x2e3a4c, 0x6a6450, 0x26262a, 0x4a3c2e];
const HAIRS = [0x2a2018, 0x4a3a28, 0x6a5a40, 0x1a1a1a, 0x7a7468, 0x5a3420];
const OUTFITS: Outfit[] = ['tee', 'tee', 'shirt', 'hoodie', 'vest', 'scrubs', 'jacket'];

export const PROPORTIONS: Record<ZombieKind, Proportions> = {
  walker: HUMAN,
  runner: { ...HUMAN, hipY: 1.0, kneeY: 0.53, waistY: 1.07, neckY: 1.56, shoulderY: 1.48, shoulderX: 0.2, hipX: 0.09, upper: 0.32, fore: 0.3 },
  bloater: { ...HUMAN, hipY: 0.86, kneeY: 0.45, waistY: 0.92, neckY: 1.36, shoulderY: 1.28, shoulderX: 0.4, hipX: 0.17, upper: 0.28, fore: 0.25 },
  breaker: { ...HUMAN, shoulderX: 0.29, hipX: 0.12, neckY: 1.56, shoulderY: 1.48, waistY: 1.04, upper: 0.31, fore: 0.28 },
  colossus: { ...HUMAN, shoulderX: 0.34, hipX: 0.14, neckY: 1.55, shoulderY: 1.46, waistY: 1.02, upper: 0.32, fore: 0.3 },
  spitter: { ...HUMAN, neckY: 1.46, shoulderY: 1.4, waistY: 0.98 },
  screamer: { ...HUMAN, hipY: 0.95, kneeY: 0.5, waistY: 1.0, neckY: 1.48, shoulderY: 1.4, shoulderX: 0.18, hipX: 0.08, upper: 0.3, fore: 0.29 },
  // 爬行者：瘦长，胳膊比腿长（四肢着地时上身能撑起来）
  crawler: { ...HUMAN, shoulderX: 0.18, hipX: 0.09, upper: 0.36, fore: 0.34 },
  // 重装感染者：宽肩、粗壮
  armored: { ...HUMAN, shoulderX: 0.3, hipX: 0.13, neckY: 1.6, shoulderY: 1.52, waistY: 1.06, upper: 0.32, fore: 0.29 },
  // 跳跃者：腿长、胳膊长、窄肩
  leaper: { ...HUMAN, hipY: 1.0, kneeY: 0.54, waistY: 1.06, neckY: 1.54, shoulderY: 1.46, shoulderX: 0.2, hipX: 0.09, upper: 0.33, fore: 0.31 },
  // 裂殖者：矮壮、宽
  splitter: { ...HUMAN, shoulderX: 0.27, hipX: 0.12, neckY: 1.48, shoulderY: 1.4, waistY: 1.0 },
  gasser: HUMAN,
  // 收割者：又高又瘦，胳膊长到膝盖
  reaper: { ...HUMAN, hipY: 1.02, kneeY: 0.55, waistY: 1.08, neckY: 1.58, shoulderY: 1.5, shoulderX: 0.22, hipX: 0.09, upper: 0.36, fore: 0.36 },
  // 母巢：矮、宽、肿成一座山
  brood: { ...HUMAN, hipY: 0.84, kneeY: 0.44, waistY: 0.9, neckY: 1.34, shoulderY: 1.26, shoulderX: 0.42, hipX: 0.18, upper: 0.3, fore: 0.28 },
  // 哀嚎女王：细长的四肢、窄肩
  siren: { ...HUMAN, hipY: 1.0, kneeY: 0.53, waistY: 1.06, neckY: 1.56, shoulderY: 1.48, shoulderX: 0.19, hipX: 0.085, upper: 0.36, fore: 0.37 },
};

export const MODEL_SCALE: Record<ZombieKind, number> = { walker: 1, runner: 1, bloater: 1, breaker: 1, colossus: 2.1, spitter: 1, screamer: 1, crawler: 1, armored: 1.05, leaper: 1, splitter: 1.02, gasser: 1, reaper: 1.8, brood: 1.72, siren: 1.6 };

function lookFor(kind: ZombieKind, variant: number): Look {
  const r = new Rng(variant * 7919 + kind.length * 104729 + kind.charCodeAt(0));
  const outfit = r.pick(OUTFITS);
  const base: Look = {
    skin: r.pick(SKINS),
    shirt: r.pick(SHIRTS),
    accent: r.pick([0x2e2a26, 0x4a3a2a, 0x3a3e46, 0x6a2a24]),
    pants: r.pick(PANTS),
    shoe: r.chance(0.12) ? null : r.pick([0x2a2420, 0x3a2e24, 0x1e1e22, 0x5a5850]),
    hair: r.chance(0.75) ? r.pick(HAIRS) : null,
    hairStyle: r.pick(['short', 'short', 'long', 'bald'] as const),
    eyes: 0xd8cc98,
    eyeGlow: 0.6,
    bulk: r.range(0.94, 1.08),
    depth: 1,
    outfit,
    sleeves: outfit === 'shirt' || outfit === 'hoodie' || outfit === 'jacket' ? 'long' : outfit === 'scrubs' ? 'short' : r.pick(['short', 'short', 'none'] as const),
    missingArm: r.chance(0.18) ? (r.chance(0.5) ? 1 : 2) : 0,
    wounds: r.int(2, 4),
    gaunt: false,
    jaw: r.range(0.2, 0.8),
    noNose: r.chance(0.25),
  };
  if (outfit === 'scrubs') {
    base.shirt = r.pick([0x4f7a78, 0x5a6e8a]);
    base.pants = base.shirt;
  }
  if (outfit === 'vest') base.accent = r.pick([0xa8b43a, 0xc0782a]);
  if (outfit === 'shirt') base.shirt = r.pick([0x9a9688, 0x7a8696, 0x8a8478]);
  switch (kind) {
    case 'runner':
      return { ...base, skin: r.pick([0x86847a, 0x7e7c6e, 0x8a8478]), eyes: 0xe05040, eyeGlow: 0.85, bulk: 0.84, depth: 0.86, outfit: 'tee', sleeves: 'none', missingArm: 0, gaunt: true, wounds: r.int(3, 5), jaw: 0.95 };
    case 'bloater':
      return { ...base, skin: r.pick([0x8e8f6c, 0x96946e, 0x868a66]), eyes: 0xc8d070, eyeGlow: 0.7, bulk: 1.75, depth: 1.5, outfit: 'tee', sleeves: 'none', missingArm: 0, hair: r.chance(0.3) ? base.hair : null, hairStyle: 'bald', shirt: 0x6a6656, jaw: 0.6 };
    case 'breaker':
      return { ...base, skin: r.pick([0x7e8478, 0x737a6e, 0x86887a]), eyes: 0xe09040, bulk: 1.25, depth: 1.15, outfit: 'jacket', sleeves: 'none', missingArm: 0, hair: null, shirt: r.pick([0x34363c, 0x4a4a3e, 0x2f3a4a]), accent: 0x3a3228 };
    case 'spitter':
      return { ...base, skin: r.pick([0x8a8a5e, 0x92905e, 0x7e8058]), eyes: 0xb0d050, eyeGlow: 0.8, bulk: 1.04, outfit: 'scrubs', shirt: 0x5a6a50, pants: 0x4a5442, sleeves: 'short', hair: null, wounds: r.int(3, 5), jaw: 0.9 };
    case 'screamer':
      return { ...base, skin: r.pick([0x9a948a, 0x928c84, 0x9e968c]), eyes: 0xd070c8, eyeGlow: 0.8, bulk: 0.8, depth: 0.82, outfit: 'tee', sleeves: 'none', missingArm: 0, gaunt: true, hair: r.pick([0x7a7468, 0x2a2018, 0x5a3420]), hairStyle: 'long', shirt: 0x5a4f6a, jaw: 1 };
    case 'crawler':
      return { ...base, skin: r.pick([0x7a7c70, 0x707468, 0x84867a]), eyes: 0xe07040, eyeGlow: 0.75, bulk: 0.8, depth: 0.82, outfit: 'bare', sleeves: 'none', missingArm: 0, gaunt: true, wounds: r.int(4, 6), pants: 0x3a3228, shoe: null, jaw: 0.8 };
    case 'armored':
      return { ...base, skin: r.pick([0x6e7466, 0x646a5e]), eyes: 0xe0b050, bulk: 1.3, depth: 1.2, outfit: 'jacket', sleeves: 'long', missingArm: 0, hair: null, shirt: 0x3a3e30, accent: 0x3e4232, pants: 0x34382a, shoe: 0x22201c };
    case 'colossus':
      return { ...base, skin: 0x5e626a, eyes: 0xe03a24, eyeGlow: 1.2, bulk: 1.5, depth: 1.3, outfit: 'bare', sleeves: 'none', missingArm: 0, hair: null, pants: 0x3a3028, shoe: null, wounds: 6, jaw: 0.7 };
    case 'leaper':
      // 光着上身、皮包骨，发黄的眼睛，嘴张到底
      return { ...base, skin: r.pick([0x787466, 0x706c5e, 0x7a7468]), eyes: 0xe0c040, eyeGlow: 0.85, bulk: 0.8, depth: 0.78, outfit: 'bare', sleeves: 'none', missingArm: 0, gaunt: true, wounds: r.int(3, 5), shoe: null, pants: r.pick([0x2e3a4c, 0x3a3228, 0x26262a]), hair: r.chance(0.5) ? r.pick(HAIRS) : null, hairStyle: 'long', jaw: 1, noNose: true };
    case 'splitter':
      // 肿得发紫，T 恤被撑破
      return { ...base, skin: r.pick([0x6e6468, 0x685e62, 0x726660]), eyes: 0xc06080, eyeGlow: 0.7, bulk: 1.28, depth: 1.25, outfit: 'tee', sleeves: 'none', missingArm: 0, hair: r.chance(0.4) ? base.hair : null, hairStyle: 'bald', shirt: r.pick([0x5b6670, 0x6a6656, 0x4b5440]), wounds: r.int(4, 6), jaw: 0.5 };
    case 'gasser': {
      // 防化服（褪色的黄）、黑胶靴；头套和面具在 extrasGasser 里
      const suit = r.pick([0x7c6e36, 0x746a34, 0x80703c]);
      return { ...base, skin: r.pick([0x7a8070, 0x747a66]), eyes: 0xa0c050, eyeGlow: 0.6, bulk: 1.12, depth: 1.08, outfit: 'hazmat', sleeves: 'long', missingArm: 0, hair: null, shirt: suit, pants: shade(suit, 0.9), shoe: 0x1c1c1a, wounds: r.int(2, 3) };
    }
    case 'reaper':
      // 毛边的长风衣、褶色的粗布裤；麻袋头套、镰刀和钩子在 extrasReaper 里
      return { ...base, skin: 0x6c6656, eyes: 0xe08a30, eyeGlow: 1.3, bulk: 0.9, depth: 0.85, outfit: 'jacket', sleeves: 'long', missingArm: 0, gaunt: true, hair: null, shirt: 0x6a5e48, accent: 0x4e3e2c, pants: 0x4a3e2c, shoe: 0x2a2018, wounds: 4, jaw: 0.5 };
    case 'brood':
      // 光着身子、灰白发青的皮；稀疏的长头发、嘴张到底
      return { ...base, skin: 0x8a8478, eyes: 0xc8d070, eyeGlow: 0.9, bulk: 1.9, depth: 1.7, outfit: 'bare', sleeves: 'none', missingArm: 0, hair: 0x2a2420, hairStyle: 'long', pants: 0x4a4038, shoe: null, wounds: 5, jaw: 1, noNose: true };
    case 'siren':
      // 撒碎的黑纱裙、惨白的皮、拖到腰的黑发；眼睛是冷白色
      return { ...base, skin: 0xa49c92, eyes: 0xe8e0ff, eyeGlow: 1.4, bulk: 0.78, depth: 0.78, outfit: 'tee', sleeves: 'none', missingArm: 0, gaunt: true, shirt: 0x2e2a34, pants: 0x2e2a34, hair: 0x1a1614, hairStyle: 'long', shoe: null, wounds: 3, jaw: 1, noNose: true };
    default:
      return base;
  }
}

/** 躯干的形状：三段椭圆柱（腰 → 胸 → 肩），贴在表面的东西用 rAt 算这个高度的半宽 */
interface Torso {
  waist: number;
  top: number;
  rx: number;
  /** z 方向 / x 方向的比例（躯干是扁的） */
  zk: number;
}
const T_MID = 0.45;
const T_CAP = 0.82;
function rAt(T: Torso, y: number): number {
  const f = (y - T.waist) / (T.top - T.waist);
  if (f <= T_MID) return T.rx * (0.92 + (0.97 - 0.92) * Math.max(0, f / T_MID));
  if (f <= T_CAP) return T.rx * (0.97 + (1.06 - 0.97) * ((f - T_MID) / (T_CAP - T_MID)));
  const k = Math.min(1, (f - T_CAP) / (1 - T_CAP));
  return T.rx * 1.06 * Math.sqrt(Math.max(0.05, 1 - k * k));
}

/** 贴在躯干表面的一块（破口、血迹、口袋）：a = 绕躯干的角度（0 = 正前方），w / h = 半宽 / 半高 */
function patch(b: Builder, T: Torso, a: number, y: number, w: number, h: number, st: Style, lift = 1.012): void {
  const r = rAt(T, y) * lift;
  b.sphere(1, 8, 6, { x: Math.sin(a) * r, y, z: Math.cos(a) * r * T.zk, ry: a, sx: w, sy: h, sz: 0.01 }, st);
}

/** 躯干上一处伤：衣服撕开露出皮肉，中间是发黑的血 */
function torsoWound(b: Builder, T: Torso, L: Look, rng: Rng, a: number, y: number, size: number): void {
  if (L.outfit !== 'bare') patch(b, T, a, y, size * 1.25, size * 0.95, skinSt(shade(L.skin, 0.62)));
  patch(b, T, a, y, size * 0.8, size * 0.6, blood(), 1.02);
  patch(b, T, a + rng.range(-0.06, 0.06), y + size * 0.1, size * 0.4, size * 0.3, blood(true), 1.028);
  // 往下流的一道
  if (rng.chance(0.6)) patch(b, T, a, y - size * 1.2, size * 0.18, size * 0.8, blood(), 1.018);
}

function humanoid(b: Builder, J: Joints, L: Look, rng: Rng): void {
  const sk = skinSt(L.skin);
  const skD = skinSt(shade(L.skin, 0.84), { jitter: 0.3 });
  const shirt = matte(L.shirt, { jitter: 0.2 });
  const pants = matte(L.pants, { jitter: 0.2, ao: 0.45 });
  const body = L.outfit === 'bare' ? sk : L.outfit === 'jacket' ? matte(L.accent, { jitter: 0.2 }) : shirt;
  const waist = J.chest[1];
  const hy = J.head[1];
  const T: Torso = { waist, top: hy - 0.04, rx: 0.165 * L.bulk, zk: (0.105 * L.depth) / (0.165 * L.bulk) };
  const H = T.top - waist;

  // ---- 骨盆 ----
  b.bone(B.pelvis);
  const py = J.pelvis[1];
  b.cyl(T.rx * 0.95, T.rx * 0.93, 0.21, 14, { y: py - 0.17, sz: T.zk }, pants);
  b.sphere(T.rx * 0.93, 14, 6, { y: py - 0.17, sy: 0.38, sz: T.zk }, pants);
  b.cyl(T.rx * 0.97, T.rx * 0.97, 0.036, 14, { y: py + 0.005, sz: T.zk }, matte(0x1e1a16, { jitter: 0.1, ao: 0 })); // 腰带
  b.box(0.05, 0.034, 0.01, { y: py + 0.006, z: T.rx * 0.97 * T.zk + 0.002 }, metal(0x8a8a7a, { ao: 0 })); // 皮带扣

  // ---- 躯干 ----
  b.bone(B.chest);
  const y1 = waist + H * T_MID;
  const y2 = waist + H * T_CAP;
  b.cyl(T.rx * 0.97, T.rx * 0.92, y1 - waist, 16, { y: waist, sz: T.zk }, body);
  b.cyl(T.rx * 1.06, T.rx * 0.97, y2 - y1, 16, { y: y1, sz: T.zk }, body);
  b.sphere(T.rx * 1.06, 16, 8, { y: y2, sy: (H * (1 - T_CAP)) / (T.rx * 1.06), sz: T.zk }, body);
  // 衣服下摆盖住腰带上沿
  if (L.outfit !== 'bare') b.cyl(T.rx * 0.95, T.rx * 0.95, 0.03, 16, { y: waist - 0.01, sz: T.zk }, matte(shade(L.outfit === 'jacket' ? L.accent : L.shirt, 0.85)));
  // 领口
  if (L.outfit !== 'bare') b.torus(0.062, 0.013, 6, 14, { y: T.top - 0.005, rx: Math.PI / 2, sz: 0.85 }, matte(shade(L.shirt, 0.8)));

  switch (L.outfit) {
    case 'shirt': {
      // 衬衫：一排扣子和一条歪掉的领带
      for (let i = 0; i < 4; i++) patch(b, T, 0, waist + 0.06 + i * 0.09, 0.008, 0.008, matte(0xd8d4c8, { jitter: 0, ao: 0 }), 1.02);
      patch(b, T, 0.08, T.top - 0.15, 0.022, 0.12, matte(L.accent, { jitter: 0.1 }), 1.03);
      break;
    }
    case 'hoodie': {
      // 帽兜耷拉在背后、前面一个大口袋
      b.sphere(0.12, 12, 8, { y: T.top - 0.02, z: -T.rx * T.zk - 0.03, sx: 1.15, sy: 0.6, sz: 0.62 }, matte(shade(L.shirt, 0.88)));
      patch(b, T, 0, waist + 0.08, 0.1, 0.055, matte(shade(L.shirt, 0.82)), 1.02);
      break;
    }
    case 'vest': {
      // 反光背心：褪色的荧光黄 / 橙，两道灰白的反光条
      b.cyl(T.rx * 1.09, T.rx * 1.0, H * 0.78, 16, { y: waist + 0.01, sz: T.zk * 1.02 }, matte(L.accent, { jitter: 0.22 }));
      for (const f of [0.22, 0.48]) b.cyl(T.rx * (1.1 + f * 0.02), T.rx * (1.1 + f * 0.02), 0.026, 16, { y: waist + H * f, sz: T.zk * 1.03 }, matte(0xa8a8a0, { jitter: 0.1, ao: 0 }));
      break;
    }
    case 'jacket': {
      // 敞着的外套：前面一竖条露出里面的 T 恤
      patch(b, T, 0, waist + H * 0.42, 0.055, H * 0.42, matte(L.shirt, { jitter: 0.2 }), 1.008);
      for (const s of [-1, 1]) patch(b, T, s * 0.2, waist + H * 0.42, 0.012, H * 0.42, matte(shade(L.accent, 0.75)), 1.02);
      break;
    }
    case 'scrubs': {
      patch(b, T, 0, T.top - 0.07, 0.05, 0.06, sk, 1.01); // V 领
      patch(b, T, -0.45, waist + H * 0.62, 0.045, 0.05, matte(shade(L.shirt, 0.85)), 1.02); // 胸前口袋
      break;
    }
    case 'hazmat': {
      // 防化服：拉链、胸口一块脱了色的标签、腰上缠一圈胶带
      patch(b, T, 0.06, waist + H * 0.45, 0.008, H * 0.45, dark(shade(L.shirt, 0.5)), 1.02);
      patch(b, T, -0.42, waist + H * 0.62, 0.05, 0.035, matte(0xa8a498, { jitter: 0.2, ao: 0 }), 1.025);
      patch(b, T, -0.42, waist + H * 0.62, 0.014, 0.014, dark(0x1a1a14), 1.03);
      b.cyl(T.rx * 0.99, T.rx * 0.99, 0.045, 16, { y: waist + 0.02, sz: T.zk * 1.01 }, matte(0x5a5a56, { jitter: 0.12, ao: 0 }));
      break;
    }
    default:
      break;
  }
  if (L.gaunt) {
    // 干瘦：肋骨的印子（光身子时是皮，穿着衣服时是贴在身上的褶皱）
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) patch(b, T, s * 0.35, waist + H * 0.38 + i * 0.055, 0.05, 0.006, dark(shade(L.outfit === 'bare' ? L.skin : L.shirt, 0.62)), 1.015);
  }
  for (let i = 0; i < L.wounds; i++) {
    const a = rng.chance(0.7) ? rng.range(-1.1, 1.1) : Math.PI + rng.range(-0.9, 0.9);
    torsoWound(b, T, L, rng, a, rng.range(waist + 0.06, T.top - 0.1), rng.range(0.035, 0.07));
  }
  // 背后的污迹和拖在地上沾的土
  patch(b, T, Math.PI, waist + H * 0.45, T.rx * 0.5, H * 0.3, dark(shade(L.outfit === 'bare' ? L.skin : L.shirt, 0.6)), 1.006);
  // 下巴滴到胸口的血
  patch(b, T, rng.range(-0.15, 0.15), T.top - 0.09, 0.02, 0.06, blood(), 1.02);

  // ---- 头 ----
  b.bone(B.head);
  b.cyl(0.05, 0.057, 0.12, 10, { y: hy - 0.07 }, skD);
  b.sphere(0.1, 16, 12, { y: hy + 0.14, sx: 0.9, sy: 1.1, sz: 1.04 }, sk); // 颅
  b.sphere(0.072, 12, 8, { y: hy + 0.06, z: 0.03, sx: 1.02, sy: 0.72, sz: 0.95 }, skD); // 下颌
  // 颊骨和眉弓：瘦得脱相，骨头的轮廓很明显
  for (const s of [-1, 1]) b.sphere(0.028, 8, 6, { x: s * 0.052, y: hy + 0.115, z: 0.062, sy: 0.75 }, sk);
  b.sphere(0.056, 10, 6, { y: hy + 0.178, z: 0.066, sx: 1.55, sy: 0.32, sz: 0.55 }, sk);
  // 眼窝深陷，里面一点浑浊的光（夜里远处还能看出它在看哪）
  for (const s of [-1, 1]) {
    b.sphere(0.024, 8, 6, { x: s * 0.036, y: hy + 0.153, z: 0.077, sy: 0.82 }, dark(0x241814));
    b.sphere(0.0105, 6, 4, { x: s * 0.036, y: hy + 0.153, z: 0.092 }, glow(L.eyes, L.eyeGlow));
    b.sphere(0.022, 8, 6, { x: s * 0.093, y: hy + 0.13, sx: 0.42, sy: 1.15 }, skD); // 耳
  }
  // 鼻子：烂掉的只剩一个黑洞
  if (L.noNose) b.sphere(0.016, 6, 4, { y: hy + 0.112, z: 0.09, sy: 1.3, sz: 0.5 }, dark(0x1c0e0a));
  else b.rbox(0.024, 0.048, 0.03, 0.009, { y: hy + 0.088, z: 0.09, rx: 0.22 }, sk);
  // 嘴：张开的黑洞 + 几颗发黄的牙，下巴上糊着血
  const mo = 0.012 + 0.03 * L.jaw;
  b.sphere(0.034, 10, 6, { y: hy + 0.062, z: 0.077, sx: 1.15, sy: mo / 0.034, sz: 0.5 }, dark(0x1a0806));
  for (let i = 0; i < 4; i++) b.box(0.009, 0.013, 0.008, { x: -0.02 + i * 0.013, y: hy + 0.062 + mo * 0.55, z: 0.088 }, matte(0xb4ac8c, { jitter: 0.15, ao: 0 }));
  for (let i = 0; i < 3; i++) b.box(0.009, 0.011, 0.008, { x: -0.013 + i * 0.013, y: hy + 0.062 - mo * 0.95, z: 0.086 }, matte(0xa49c7c, { jitter: 0.15, ao: 0 }));
  b.sphere(0.03, 8, 6, { y: hy + 0.035, z: 0.08, sx: 1.4, sy: 1.5, sz: 0.4 }, blood(true));
  // 头发
  if (L.hair !== null) {
    const hs = matte(L.hair, { jitter: 0.28, ao: 0 });
    if (L.hairStyle === 'bald') {
      // 秃顶：只剩两边和后脑勺一圈
      b.sphere(0.1, 12, 6, { y: hy + 0.13, z: -0.02, sx: 0.95, sy: 0.55, sz: 1.04 }, hs);
    } else {
      // 一顶半球盖在颅上，往后仰一点：前额露出来，后脑勺盖得更多
      b.add(new SphereGeometry(0.106, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.52), { y: hy + 0.148, z: -0.008, sx: 0.93, sy: 1.1, sz: 1.06, rx: -0.32 }, hs);
      if (L.hairStyle === 'long') {
        b.sphere(0.09, 10, 8, { y: hy + 0.07, z: -0.062, sx: 1.05, sy: 1.55, sz: 0.55 }, hs);
        for (const s of [-1, 1]) b.sphere(0.04, 8, 6, { x: s * 0.075, y: hy + 0.07, z: -0.01, sx: 0.5, sy: 2.1, sz: 0.9 }, hs);
      }
      // 几处掉光的头皮和一道抓伤
      if (rng.chance(0.5)) b.sphere(0.03, 8, 6, { x: rng.range(-0.05, 0.05), y: hy + 0.235, z: rng.range(-0.04, 0.04), sx: 1.2, sy: 0.3 }, sk);
    }
  }
  if (rng.chance(0.6)) b.sphere(0.028, 8, 6, { x: rng.range(-0.06, 0.06), y: hy + rng.range(0.17, 0.22), z: 0.072, sx: 1.4, sy: 0.9, sz: 0.4 }, blood());

  // ---- 手臂 ----
  const aw = 0.055 * Math.min(1.5, L.bulk * 0.95 + 0.1);
  for (const side of [0, 1] as const) {
    const sg = side === 0 ? 1 : -1;
    const sh = side === 0 ? J.shoulderL : J.shoulderR;
    const el = side === 0 ? J.elbowL : J.elbowR;
    const wr = side === 0 ? J.wristL : J.wristR;
    const missing = L.missingArm === (side === 0 ? 1 : 2);
    const sleeve = L.outfit === 'jacket' ? matte(L.accent, { jitter: 0.2 }) : shirt;
    const upperSt = L.sleeves === 'none' ? sk : sleeve;
    const cx = (sh[0] + el[0]) / 2;

    b.bone(side === 0 ? B.armUL : B.armUR);
    b.sphere(aw * 1.08, 10, 8, { x: sh[0] - sg * 0.006, y: sh[1] - 0.012 }, L.outfit === 'bare' || L.sleeves === 'none' ? sk : sleeve);
    b.cyl(aw * 0.98, aw * 0.8, sh[1] - el[1], 10, { x: cx, y: el[1] }, upperSt);
    if (L.sleeves === 'short') {
      // 短袖：上面 6 成是袖子，下面露出胳膊
      b.cyl(aw * 0.84, aw * 0.8, (sh[1] - el[1]) * 0.42, 10, { x: cx, y: el[1] }, sk);
      b.cyl(aw * 1.02, aw * 1.02, 0.02, 10, { x: cx, y: el[1] + (sh[1] - el[1]) * 0.42 }, matte(shade(L.shirt, 0.82)));
    }
    if (L.sleeves === 'none' && L.outfit !== 'bare') b.sphere(aw * 1.12, 10, 6, { x: sh[0] - sg * 0.03, y: sh[1] + 0.005, sy: 0.4 }, body); // 背心的肩带

    b.bone(side === 0 ? B.armLL : B.armLR);
    b.sphere(aw * 0.82, 10, 6, { x: el[0], y: el[1] }, L.sleeves === 'long' ? sleeve : skD);
    if (missing) {
      // 断臂：参差的断口和露出来的骨头
      b.cyl(aw * 0.78, aw * 0.74, 0.1, 10, { x: el[0], y: el[1] - 0.1 }, skD);
      b.sphere(aw * 0.76, 8, 6, { x: el[0], y: el[1] - 0.1, sy: 0.35 }, blood(true));
      b.cyl(0.011, 0.013, 0.07, 6, { x: el[0], y: el[1] - 0.16 }, matte(0xcfc8b0, { jitter: 0.1, ao: 0 }));
      continue;
    }
    const foreLen = el[1] - wr[1];
    if (L.sleeves === 'long') {
      b.cyl(aw * 0.84, aw * 0.72, foreLen * 0.8, 10, { x: (el[0] + wr[0]) / 2, y: wr[1] + foreLen * 0.2 }, sleeve);
      b.cyl(aw * 0.62, aw * 0.58, foreLen * 0.25, 10, { x: wr[0], y: wr[1] }, skD);
    } else {
      b.cyl(aw * 0.8, aw * 0.6, foreLen, 10, { x: (el[0] + wr[0]) / 2, y: wr[1] }, skD);
      // 前臂上的咬痕 / 抓伤
      if (rng.chance(0.55)) b.sphere(aw * 0.55, 8, 6, { x: (el[0] + wr[0]) / 2 + sg * aw * 0.35, y: wr[1] + foreLen * rng.range(0.35, 0.7), z: aw * 0.5, sx: 0.7, sy: 1.3, sz: 0.5 }, blood());
    }
    // 手：手掌 + 四根弯曲的手指 + 拇指，指尖发黑
    const hs = skinSt(shade(L.skin, 0.9), { jitter: 0.3 });
    b.rbox(0.058, 0.082, 0.028, 0.012, { x: wr[0], y: wr[1] - 0.088, z: 0.004 }, hs);
    for (let f = 0; f < 4; f++) {
      const fx = wr[0] + (f - 1.5) * 0.0145;
      const len = f === 0 || f === 3 ? 0.048 : 0.058;
      b.rod([fx, wr[1] - 0.084, 0.008], [fx, wr[1] - 0.084 - len * 0.8, 0.008 + len * 0.55], 0.0078, hs, 5);
      b.sphere(0.0082, 5, 4, { x: fx, y: wr[1] - 0.084 - len * 0.8, z: 0.008 + len * 0.55 }, dark(0x2a1e18));
    }
    b.rod([wr[0] + sg * 0.026, wr[1] - 0.04, 0.012], [wr[0] + sg * 0.03, wr[1] - 0.085, 0.04], 0.0085, hs, 5);
  }

  // ---- 腿 ----
  const lw = 0.084 * Math.min(1.5, L.bulk * 0.9 + 0.12);
  for (const side of [0, 1] as const) {
    const hp = side === 0 ? J.hipL : J.hipR;
    const kn = side === 0 ? J.kneeL : J.kneeR;
    const an = side === 0 ? J.ankleL : J.ankleR;
    b.bone(side === 0 ? B.legUL : B.legUR);
    b.sphere(lw * 1.04, 10, 8, { x: hp[0], y: hp[1] }, pants);
    b.cyl(lw, lw * 0.74, hp[1] - kn[1], 12, { x: hp[0], y: kn[1] }, pants);

    b.bone(side === 0 ? B.legLL : B.legLR);
    const torn = rng.chance(0.4);
    // 膝盖磨破：露出带血的皮
    b.sphere(lw * 0.76, 10, 6, { x: kn[0], y: kn[1], z: kn[2] }, pants);
    if (rng.chance(0.35)) b.sphere(lw * 0.5, 8, 6, { x: kn[0], y: kn[1], z: kn[2] + lw * 0.42, sz: 0.5 }, skinSt(shade(L.skin, 0.75)));
    const shin = kn[1] - an[1];
    if (torn) {
      // 裤腿撕到小腿中间，下面露出腿，破口是一圈参差的布边
      b.cyl(lw * 0.76, lw * 0.66, shin * 0.5, 12, { x: kn[0], y: kn[1] - shin * 0.5 }, pants);
      b.cyl(lw * 0.68, lw * 0.68, 0.025, 12, { x: kn[0], y: kn[1] - shin * 0.5 - 0.01 }, matte(shade(L.pants, 0.8)));
      b.cyl(lw * 0.58, lw * 0.44, shin * 0.5, 10, { x: kn[0], y: an[1] }, skD);
    } else {
      b.cyl(lw * 0.76, lw * 0.58, shin, 12, { x: kn[0], y: an[1] }, pants);
    }
    b.sphere(lw * 0.62, 8, 6, { x: kn[0], y: kn[1] - shin * 0.32, z: -lw * 0.18, sy: 1.6 }, torn ? pants : pants); // 腿肚
    if (L.shoe === null) {
      // 光脚：脏得发黑的脚掌
      b.rbox(lw * 1.0, 0.06, 0.22, 0.025, { x: an[0], y: 0, z: 0.05 }, skinSt(shade(L.skin, 0.62), { jitter: 0.35 }));
    } else {
      b.rbox(lw * 1.32, 0.085, 0.27, 0.032, { x: an[0], y: 0, z: 0.055 }, matte(L.shoe, { jitter: 0.2, ao: 0.2 }));
      b.box(lw * 1.36, 0.022, 0.275, { x: an[0], y: 0, z: 0.055 }, dark(0x141210)); // 鞋底
    }
  }
}

// ----------------------------------------------------------------------------------

function extrasBloater(b: Builder, J: Joints, L: Look, rng: Rng): void {
  b.bone(B.chest);
  const waist = J.chest[1];
  // 巨大的腹部和一层层的脓包（发一点暗光：打爆它会喷酸）
  b.sphere(0.5, 16, 12, { y: waist + 0.12, z: 0.2, sy: 0.85, sx: 1.05 }, skinSt(L.skin, { jitter: 0.3 }));
  b.sphere(0.46, 14, 10, { y: waist + 0.1, z: 0.26, sy: 0.82, sx: 1.0 }, skinSt(shade(L.skin, 0.88), { jitter: 0.34 }));
  // 紫黑的静脉纹
  for (let i = 0; i < 6; i++) {
    const a = rng.range(-1, 1);
    b.sphere(0.012, 5, 4, { x: Math.sin(a) * 0.46, y: waist + 0.1 + rng.range(-0.2, 0.25), z: 0.26 + Math.cos(a) * 0.46 * 0.82, ry: a, rz: rng.range(-1, 1), sx: 1, sy: 9, sz: 0.5 }, dark(0x3a3448));
  }
  for (let i = 0; i < 12; i++) {
    const a = rng.range(-1.2, 1.2);
    const h = rng.range(-0.35, 0.4);
    const r = rng.range(0.04, 0.1);
    const px = Math.sin(a) * 0.48;
    const py = waist + 0.12 + h;
    const pz = 0.2 + Math.cos(a) * 0.5 * (1 - Math.abs(h) * 0.4);
    b.sphere(r * 1.3, 8, 6, { x: px, y: py, z: pz, sy: 0.8 }, skinSt(shade(L.skin, 0.75), { jitter: 0.3 }));
    b.sphere(r * 0.8, 8, 6, { x: px, y: py, z: pz + r * 0.5, sy: 0.8 }, glow(0xa8bc50, 0.75));
  }
  b.sphere(0.3, 10, 8, { x: 0.15, y: waist + 0.5, z: -0.18 }, skinSt(shade(L.skin, 0.8), { jitter: 0.3 }));
  // 滴落的酸液
  for (let i = 0; i < 3; i++) b.cyl(0.01, 0.018, 0.16, 6, { x: rng.range(-0.3, 0.3), y: 0.1, z: 0.52 }, glow(0x8ac838, 0.6));
}

function extrasBreaker(b: Builder, J: Joints): void {
  const hy = J.head[1];
  // 头盔：焊起来的铁桶，留一条观察缝
  b.bone(B.head);
  b.cyl(0.13, 0.135, 0.3, 14, { y: hy + 0.0 }, metal(0x5e6264, { jitter: 0.25, ao: 0.2 }));
  b.box(0.18, 0.022, 0.02, { y: hy + 0.155, z: 0.128 }, glow(0xd88038, 1.1));
  b.cyl(0.14, 0.14, 0.03, 14, { y: hy + 0.28 }, metal(0x44484a, { jitter: 0.2, ao: 0 }));
  b.rod([0.08, hy + 0.1, 0.13], [0.08, hy + 0.25, 0.13], 0.011, metal(0x2a2a2a, { ao: 0 }), 5);
  for (const [x, y] of [[-0.09, 0.06], [0.06, 0.22], [-0.05, 0.24]] as const) b.sphere(0.012, 6, 4, { x, y: hy + y, z: 0.13, sz: 0.4 }, metal(0x6a3a24, { ao: 0 })); // 锈斑
  // 胸甲（拼接的铁皮和背上的轮胎）
  b.bone(B.chest);
  const c = J.chest[1];
  b.box(0.48, 0.34, 0.04, { y: c + 0.17, z: 0.16 }, metal(0x6a6e70, { jitter: 0.25, ao: 0.2 }));
  b.box(0.2, 0.18, 0.04, { x: 0.12, y: c + 0.1, z: 0.185 }, metal(0x5a4a3a, { jitter: 0.25, ao: 0.1 }));
  for (const [x, y] of [[-0.2, 0.3], [0.2, 0.3], [-0.2, 0.06], [0.2, 0.06]] as const) b.cyl(0.014, 0.014, 0.02, 6, { x, y: c + y, z: 0.185, rx: Math.PI / 2 }, metal(0xa0a0a0, { ao: 0 }));
  b.torus(0.12, 0.05, 8, 16, { x: 0, y: c + 0.36, z: -0.16 }, matte(0x1a1a1c, { jitter: 0.1, ao: 0 }));
  b.bone(B.armUL);
  b.rbox(0.24, 0.08, 0.22, 0.03, { x: J.shoulderL[0] + 0.02, y: J.shoulderL[1] + 0.02 }, metal(0x6a4a34, { jitter: 0.25, ao: 0.1 }));
  b.bone(B.armUR);
  b.rbox(0.24, 0.08, 0.22, 0.03, { x: J.shoulderR[0] - 0.02, y: J.shoulderR[1] + 0.02 }, metal(0x6a6e70, { jitter: 0.25, ao: 0.1 }));
  b.cone(0.028, 0.11, 6, { x: J.shoulderR[0] - 0.04, y: J.shoulderR[1] + 0.1 }, metal(0x44484a, { ao: 0 }));
  // 防暴盾：比人还宽，浅灰蓝的钢板，上面一条黄黑警示带，正对前方
  b.bone(B.chest);
  const sx = 0.14;
  const sy = c - 0.2;
  const sz = 0.46;
  b.box(0.8, 1.15, 0.06, { x: sx, y: sy, z: sz }, metal(0x7a8894, { jitter: 0.2, ao: 0.1 }));
  b.box(0.86, 0.05, 0.09, { x: sx, y: sy + 1.14, z: sz }, metal(0x44505a, { ao: 0 }));
  b.box(0.86, 0.05, 0.09, { x: sx, y: sy - 0.02, z: sz }, metal(0x44505a, { ao: 0 }));
  for (const s of [-1, 1]) b.box(0.05, 1.15, 0.09, { x: sx + s * 0.4, y: sy, z: sz }, metal(0x44505a, { ao: 0 }));
  for (let i = 0; i < 6; i++) b.box(0.13, 0.11, 0.065, { x: sx - 0.33 + i * 0.13, y: sy + 0.18, z: sz }, matte(i % 2 ? 0xb89020 : 0x1e1e1e, { jitter: 0.15, ao: 0 }));
  b.box(0.34, 0.11, 0.02, { x: sx, y: sy + 0.85, z: sz + 0.035 }, glow(0x5a90a8, 0.45)); // 观察窗
  b.box(0.36, 0.016, 0.065, { x: sx - 0.1, y: sy + 0.55, z: sz, rz: 0.4 }, dark(0x20262a));
  b.cone(0.03, 0.02, 6, { x: sx + 0.18, y: sy + 0.45, z: sz + 0.04, rx: Math.PI / 2 }, dark(0x2a2f33));
  b.cone(0.025, 0.02, 6, { x: sx - 0.22, y: sy + 0.35, z: sz + 0.04, rx: Math.PI / 2 }, dark(0x2a2f33));
  b.sphere(0.06, 8, 6, { x: sx + 0.05, y: sy + 0.7, z: sz + 0.036, sx: 1.6, sy: 2.2, sz: 0.1 }, blood()); // 盾上的血手印
  // 大锤：挂在右手骨上，姿势里手臂约 -1.1 弧度，所以杆在局部坐标里朝下偏后
  b.bone(B.armLR);
  const w = J.wristR;
  const dir: [number, number, number] = [0.05, -0.9, -0.44];
  const len = 1.15;
  const end: [number, number, number] = [w[0] + dir[0] * len, w[1] + dir[1] * len, w[2] + dir[2] * len];
  b.rod([w[0], w[1] + 0.1, w[2] + 0.04], end, 0.024, matte(0x5a4128, { jitter: 0.2, ao: 0.1 }), 8);
  b.push({ x: end[0], y: end[1], z: end[2], rx: -1.1 });
  b.box(0.3, 0.18, 0.18, { y: -0.09 }, metal(0x44484c, { jitter: 0.22, ao: 0 }));
  b.box(0.32, 0.04, 0.2, { y: 0.1 }, metal(0x2e3236, { ao: 0 }));
  b.pop();
}

function extrasColossus(b: Builder, J: Joints, L: Look): void {
  const c = J.chest[1];
  b.bone(B.chest);
  // 胸腔被撕开，露出肋骨和跳动的核心（弱点，留着亮光）
  b.sphere(0.2, 12, 8, { y: c + 0.25, z: 0.12, sx: 1.0, sy: 1.0, sz: 0.25 }, blood());
  for (let i = 0; i < 4; i++) {
    for (const s of [-1, 1]) b.rod([s * 0.02, c + 0.1 + i * 0.075, 0.16], [s * 0.19, c + 0.13 + i * 0.075, 0.13], 0.013, matte(0xc8c0a8, { jitter: 0.12, ao: 0 }), 6);
  }
  b.sphere(0.07, 10, 8, { y: c + 0.25, z: 0.15 }, glow(0xe0301e, 2.0));
  b.sphere(0.1, 10, 8, { y: c + 0.25, z: 0.14 }, glow(0x901408, 0.7));
  // 缠身的铁链
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    b.torus(0.035, 0.009, 6, 10, { x: -0.22 + t * 0.44, y: c + 0.5 - t * 0.38, z: 0.17, rz: 0.7, ry: i % 2 ? 1.5 : 0 }, metal(0x5e6266, { jitter: 0.2, ao: 0 }));
  }
  // 背脊上刺破皮肉的骨刺
  for (let i = 0; i < 5; i++) b.cone(0.032, 0.2 - i * 0.02, 6, { y: c + 0.1 + i * 0.1, z: -0.13, rx: -0.5 }, matte(0xc8c0a8, { jitter: 0.12, ao: 0 }));
  b.bone(B.armUL);
  b.cone(0.055, 0.26, 8, { x: J.shoulderL[0] + 0.05, y: J.shoulderL[1] + 0.02, rz: -0.5 }, metal(0x505458, { jitter: 0.2 }));
  b.bone(B.armUR);
  b.cone(0.055, 0.26, 8, { x: J.shoulderR[0] - 0.05, y: J.shoulderR[1] + 0.02, rz: 0.5 }, metal(0x505458, { jitter: 0.2 }));
  // 巨拳：右手更大，腕上还套着断掉的铁镣
  b.bone(B.armLR);
  const w = J.wristR;
  b.sphere(0.12, 12, 8, { x: w[0], y: w[1] - 0.13, sy: 1.1, sz: 0.85 }, skinSt(L.skin, { jitter: 0.3 }));
  for (let i = -1; i <= 1; i++) b.sphere(0.035, 8, 6, { x: w[0] + i * 0.055, y: w[1] - 0.23, z: 0.05, sy: 1.3 }, skinSt(shade(L.skin, 0.9)));
  b.torus(0.068, 0.016, 6, 12, { x: w[0], y: w[1] + 0.02, rx: Math.PI / 2 }, metal(0x505458, { jitter: 0.2 }));
  // 头：獠牙和断角
  b.bone(B.head);
  const hy = J.head[1];
  for (const s of [-1, 1]) {
    b.cone(0.016, 0.07, 6, { x: s * 0.04, y: hy + 0.03, z: 0.085, rx: Math.PI }, matte(0xd0c8b0, { jitter: 0.1, ao: 0 }));
    b.cone(0.028, 0.18, 6, { x: s * 0.075, y: hy + 0.22, z: -0.02, rz: -s * 0.45 }, matte(0xc0b8a0, { jitter: 0.15, ao: 0 }));
  }
}

/** 奔袭者：暴起的青筋、张到底的嘴上全是血 */
function extrasRunner(b: Builder, J: Joints, rng: Rng): void {
  b.bone(B.head);
  const hy = J.head[1];
  b.sphere(0.03, 8, 6, { y: hy + 0.02, z: 0.075, sx: 1.6, sy: 2.2, sz: 0.4 }, blood(true));
  for (const s of [-1, 1]) b.sphere(0.006, 4, 4, { x: s * 0.06, y: hy + 0.03, z: 0.05, sx: 1, sy: 6, sz: 1 }, dark(0x3e4458)); // 脖子上的青筋
  for (const [bone, el] of [[B.armLL, J.elbowL], [B.armLR, J.elbowR]] as const) {
    b.bone(bone);
    for (let i = 0; i < 2; i++) b.sphere(0.005, 4, 4, { x: el[0] + rng.range(-0.015, 0.015), y: el[1] - 0.08 - i * 0.06, z: 0.03, sx: 1, sy: 7, sz: 1 }, dark(0x3e4458));
  }
}

/** 吐酸者：鼓起来的嗉囊（爆头 = 打破它，透出一点黄绿的光）和背上的酸瘤 */
function extrasSpitter(b: Builder, J: Joints, L: Look, rng: Rng): void {
  b.bone(B.head);
  const hy = J.head[1];
  b.sphere(0.115, 12, 10, { y: hy - 0.02, z: 0.07, sy: 0.85 }, skinSt(shade(L.skin, 1.08), { jitter: 0.3 }));
  b.sphere(0.09, 10, 8, { y: hy - 0.02, z: 0.1, sy: 0.8 }, glow(0x98c83a, 0.9));
  b.sphere(0.035, 8, 6, { y: hy + 0.05, z: 0.085, sx: 1.4, sy: 1.6, sz: 0.4 }, glow(0x7ab030, 0.5)); // 嘴角挂着的酸液
  b.bone(B.chest);
  for (let i = 0; i < 4; i++) b.sphere(rng.range(0.035, 0.06), 8, 6, { x: rng.range(-0.12, 0.12), y: J.chest[1] + rng.range(0.15, 0.36), z: -0.1 }, glow(0x6aa828, 0.6));
}

/** 尖啸者：张到极限的嘴、拉长的脖子上鼓起的声囊 */
function extrasScreamer(b: Builder, J: Joints, L: Look): void {
  b.bone(B.head);
  const hy = J.head[1];
  b.sphere(0.034, 10, 6, { y: hy + 0.05, z: 0.078, sx: 1.2, sy: 1.8, sz: 0.55 }, dark(0x14060e));
  b.sphere(0.065, 10, 8, { y: hy - 0.08, z: 0.035, sx: 1.3 }, skinSt(shade(L.skin, 0.8), { jitter: 0.3 }));
  for (let i = 0; i < 3; i++) b.sphere(0.005, 4, 4, { x: -0.03 + i * 0.03, y: hy - 0.08, z: 0.095, sx: 1, sy: 5, sz: 1 }, dark(0x5a3a5a));
}

/** 爬行者：背上撕开的伤口、腿上拖着的碎布 */
function extrasCrawler(b: Builder, J: Joints, rng: Rng): void {
  b.bone(B.chest);
  for (let i = 0; i < 4; i++) b.sphere(rng.range(0.03, 0.05), 8, 6, { x: rng.range(-0.1, 0.1), y: J.chest[1] + rng.range(0.08, 0.38), z: -0.11, sx: 1.4, sy: 1, sz: 0.3 }, blood(i % 2 === 0));
  b.bone(B.legLL);
  b.box(0.1, 0.18, 0.012, { x: J.kneeL[0], y: J.kneeL[1] - 0.3, z: -0.05, rx: 0.3 }, matte(0x3a3228, { jitter: 0.3, ao: 0.2 }));
}

/** 重装感染者：肩甲、钢盔——胸前的钢板是单独的部件（armorPlate），背后什么都没有 */
function extrasArmored(b: Builder, J: Joints): void {
  const c = J.chest[1];
  b.bone(B.chest);
  for (const s of [-1, 1]) b.rbox(0.18, 0.08, 0.22, 0.025, { x: s * 0.3, y: c + 0.44, z: 0.02 }, metal(0x54585c, { jitter: 0.25, ao: 0.2 }));
  // 钢板掉了以后露出来的：焊疤和压出来的血印
  b.box(0.5, 0.5, 0.01, { y: c + 0.12, z: 0.16 }, dark(0x2a221e));
  for (const y of [0.38, -0.12]) b.box(0.52, 0.02, 0.02, { y: c + y, z: 0.165 }, metal(0x3a3632, { ao: 0 }));
  // 钢盔（头还是能打：盔沿下面露着脸）
  b.bone(B.head);
  const hy = J.head[1];
  b.add(new SphereGeometry(0.122, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), { y: hy + 0.15, sy: 1.0 }, metal(0x4a5442, { jitter: 0.2, ao: 0 }));
  b.cyl(0.14, 0.14, 0.012, 16, { y: hy + 0.14 }, metal(0x3a4232, { jitter: 0.2, ao: 0 }));
  b.box(0.008, 0.08, 0.004, { x: 0.09, y: hy + 0.06, z: 0.06, rz: 0.2 }, matte(0x2a2620, { ao: 0 })); // 下巴带
}

/** 跳跃者：发黑的长爪子、背上一节节凸出来的脊椎、脖子上绷起的筋 */
function extrasLeaper(b: Builder, J: Joints, L: Look): void {
  const claw = matte(0x2a221c, { jitter: 0.1, ao: 0 });
  for (const [bone, wr] of [[B.armLL, J.wristL], [B.armLR, J.wristR]] as const) {
    b.bone(bone);
    for (let f = 0; f < 4; f++) {
      const len = f === 0 || f === 3 ? 0.048 : 0.058;
      b.cone(0.0065, 0.05, 5, { x: wr[0] + (f - 1.5) * 0.0145, y: wr[1] - 0.084 - len * 0.8, z: 0.008 + len * 0.55, rx: 2.5 }, claw);
    }
  }
  b.bone(B.chest);
  const c = J.chest[1];
  const top = J.head[1] - 0.04;
  const back = -0.105 * L.depth;
  for (let y = c + 0.05; y < top - 0.04; y += 0.055) b.sphere(0.017, 6, 4, { y, z: back, sx: 1.2, sz: 0.8 }, skinSt(shade(L.skin, 0.92)));
  // 肩胛骨的棱
  for (const s of [-1, 1]) b.sphere(0.05, 8, 6, { x: s * 0.075, y: top - 0.12, z: back + 0.008, sx: 0.9, sy: 1.2, sz: 0.3 }, skinSt(shade(L.skin, 0.95)));
  b.bone(B.head);
  const hy = J.head[1];
  for (const s of [-1, 1]) b.sphere(0.007, 4, 4, { x: s * 0.03, y: hy - 0.02, z: 0.045, sx: 1, sy: 7, sz: 1 }, skinSt(shade(L.skin, 0.8)));
}

/** 裂殖者：背上、肩上长满紫红色的肉囊，胸口一道裂缝：里面是要钻出来的东西 */
function extrasSplitter(b: Builder, J: Joints, L: Look, rng: Rng): void {
  const flesh = (k: number): Style => skinSt(shade(0x6e3e4a, k), { jitter: 0.3, ao: 0.15 });
  b.bone(B.chest);
  const c = J.chest[1];
  const back = -0.105 * L.depth;
  for (let i = 0; i < 9; i++) {
    const r = rng.range(0.055, 0.12);
    const x = rng.range(-0.15, 0.15);
    const y = c + rng.range(0.05, 0.42);
    b.sphere(r, 10, 8, { x, y, z: back - r * 0.35, sy: rng.range(0.85, 1.15) }, flesh(rng.range(0.85, 1.15)));
    // 紧绷的皮下透出一团暗影（里面的小东西）
    b.sphere(r * 0.5, 8, 6, { x, y: y + r * 0.1, z: back - r * 1.28, sz: 0.3 }, dark(0x2e1218));
  }
  // 胸口的裂缝：参差的肉边
  for (let i = 0; i < 6; i++) b.sphere(0.03, 8, 6, { x: rng.range(-0.012, 0.012), y: c + 0.12 + i * 0.05, z: 0.105 * L.depth + 0.004, sx: 0.8, sy: 1.6, sz: 0.4 }, i % 2 ? blood(true) : flesh(0.7));
  // 肩上的囊
  for (const [bone, sh, s] of [[B.armUL, J.shoulderL, 1], [B.armUR, J.shoulderR, -1]] as const) {
    b.bone(bone);
    b.sphere(0.075, 10, 8, { x: sh[0] - s * 0.01, y: sh[1] + 0.03, z: -0.02 }, flesh(0.95));
    b.sphere(0.045, 8, 6, { x: sh[0] + s * 0.02, y: sh[1] - 0.06, z: 0.03 }, flesh(1.05));
  }
}

/** 毒雾者：防化头套、防毒面具（两块裂了的镜片、两个滤罐）、背上漏气的罐子 */
function extrasGasser(b: Builder, J: Joints, L: Look): void {
  const hy = J.head[1];
  const suit = matte(L.shirt, { jitter: 0.2, ao: 0.2 });
  const rubber = matte(0x23241f, { jitter: 0.12, ao: 0 });
  b.bone(B.head);
  // 头套：包住后脑勺和两侧，脸前面空着
  b.add(new SphereGeometry(0.128, 14, 10, Math.PI - 0.5, Math.PI + 1.0, 0, Math.PI * 0.78), { y: hy + 0.13, sy: 1.08 }, suit);
  b.torus(0.085, 0.014, 6, 16, { y: hy + 0.115, z: 0.06, rx: 0.1, sy: 1.15 }, matte(shade(L.shirt, 0.8)));
  // 面具：黑橡胶面罩盖住整张脸
  b.rbox(0.15, 0.15, 0.06, 0.025, { y: hy + 0.045, z: 0.078 }, rubber);
  for (const s of [-1, 1]) {
    b.cyl(0.031, 0.031, 0.014, 12, { x: s * 0.036, y: hy + 0.152, z: 0.106, rx: Math.PI / 2 }, metal(0x3a3c36, { ao: 0 }));
    b.cyl(0.024, 0.024, 0.006, 12, { x: s * 0.036, y: hy + 0.152, z: 0.114, rx: Math.PI / 2 }, glow(0x7a9a3a, 0.4));
    // 滤罐
    b.cyl(0.03, 0.03, 0.05, 10, { x: s * 0.058, y: hy + 0.05, z: 0.095, rx: Math.PI / 2 + 0.35, ry: s * 0.45 }, metal(0x4e5246, { jitter: 0.2, ao: 0 }));
  }
  // 左边镜片上的裂纹
  b.box(0.04, 0.003, 0.004, { x: 0.036, y: hy + 0.15, z: 0.118, rz: 0.6 }, dark(0x101210));
  // 背上的罐子、阀门；一根软管从罐子接到脖子
  b.bone(B.chest);
  const c = J.chest[1];
  const back = -0.105 * L.depth - 0.07;
  b.cyl(0.075, 0.075, 0.42, 14, { y: c + 0.02, z: back }, metal(0x6e7064, { jitter: 0.22, ao: 0.15 }));
  b.sphere(0.075, 12, 6, { y: c + 0.44, z: back, sy: 0.5 }, metal(0x6e7064, { jitter: 0.22, ao: 0 }));
  for (let i = 0; i < 4; i++) b.cyl(0.077, 0.077, 0.03, 14, { y: c + 0.1 + i * 0.03, z: back }, matte(i % 2 ? 0xb89020 : 0x1e1e1e, { jitter: 0.15, ao: 0 }));
  b.cyl(0.018, 0.018, 0.05, 8, { y: c + 0.47, z: back }, metal(0x3a3a36, { ao: 0 }));
  b.rod([0, c + 0.5, back], [0.06, J.head[1] - 0.02, -0.05], 0.014, rubber, 6);
  for (const s of [-1, 1]) b.rod([s * 0.06, c + 0.45, back + 0.04], [s * 0.1, c - 0.05, 0.02], 0.012, rubber, 5); // 背带
  // 手套
  for (const [bone, wr] of [[B.armLL, J.wristL], [B.armLR, J.wristR]] as const) {
    b.bone(bone);
    b.cyl(0.04, 0.036, 0.06, 10, { x: wr[0], y: wr[1] - 0.02 }, rubber);
  }
}

/**
 * 收割者：麻袋头套（缝死的嘴、两个烧着的眼洞）、背上绑着的十字木架、风衣下摆的布条、
 * 右前臂长成一把弯弯的骨镰、左手垂着一截铁链和钩子
 */
function extrasReaper(b: Builder, J: Joints, L: Look, rng: Rng): void {
  const burlap = matte(0x8a7650, { jitter: 0.35, ao: 0.2 });
  const rope = matte(0x6a5a3a, { jitter: 0.2, ao: 0 });
  const straw = matte(0xb8a060, { jitter: 0.25, ao: 0 });
  const wood = matte(0x4a3624, { jitter: 0.25, ao: 0.1 });
  const hy = J.head[1];
  b.bone(B.head);
  b.sphere(0.125, 14, 10, { y: hy + 0.14, sx: 0.95, sy: 1.12, sz: 1.06 }, burlap);
  b.cone(0.05, 0.1, 8, { y: hy + 0.29, rz: 0.2 }, burlap);
  b.torus(0.03, 0.01, 6, 10, { y: hy + 0.27, rx: Math.PI / 2 }, rope);
  b.torus(0.075, 0.014, 6, 14, { y: hy + 0.03, rx: Math.PI / 2 }, rope);
  for (const s of [-1, 1]) {
    b.sphere(0.028, 8, 6, { x: s * 0.044, y: hy + 0.16, z: 0.112, sz: 0.4 }, dark(0x120c08));
    b.sphere(0.013, 6, 4, { x: s * 0.044, y: hy + 0.16, z: 0.12 }, glow(L.eyes, 1.6));
  }
  b.box(0.08, 0.006, 0.006, { y: hy + 0.075, z: 0.124 }, dark(0x1a120c));
  for (let i = 0; i < 5; i++) b.box(0.005, 0.03, 0.006, { x: -0.032 + i * 0.016, y: hy + 0.075, z: 0.125 }, dark(0x2a1c10));
  for (let i = 0; i < 8; i++) {
    const a = rng.range(-1.3, 1.3) + (i % 2 ? Math.PI : 0);
    b.cone(0.006, rng.range(0.08, 0.15), 4, { x: Math.sin(a) * 0.07, y: hy - 0.03, z: Math.cos(a) * 0.06, rx: Math.cos(a) * 0.9, rz: -Math.sin(a) * 0.9 }, straw);
  }
  b.bone(B.chest);
  const c = J.chest[1];
  const back = -0.105 * L.depth - 0.05;
  b.box(1.05, 0.07, 0.07, { y: J.shoulderL[1] + 0.02, z: back }, wood);
  b.box(0.07, 1.0, 0.07, { y: c + 0.35, z: back - 0.01 }, wood);
  for (const s of [-1, 0, 1]) b.torus(0.05, 0.012, 6, 10, { x: s * 0.2, y: J.shoulderL[1] + 0.02, z: back, ry: Math.PI / 2 }, rope);
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) b.cone(0.007, rng.range(0.1, 0.16), 4, { x: s * (0.5 + i * 0.01), y: J.shoulderL[1] + 0.02, z: back, rz: s * -1.4 + rng.range(-0.3, 0.3) }, straw);
  b.bone(B.pelvis);
  const py = J.pelvis[1];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    if (Math.abs(Math.sin(a)) > 0.8) continue;
    const len = rng.range(0.36, 0.58);
    b.box(0.09, len, 0.012, { x: Math.sin(a) * 0.17, y: py - 0.1 - len / 2, z: Math.cos(a) * 0.13, ry: a }, matte(shade(L.accent, rng.range(0.85, 1.05)), { jitter: 0.25, ao: 0.3 }));
  }
  // 骨镰：从前臂中段长出来，过了手腕还有一米多，越往下越往前弯
  b.bone(B.armLR);
  const w = J.wristR;
  const bone = matte(0xc8bea4, { jitter: 0.18, ao: 0.1 });
  const edge = metal(0x6a6458, { jitter: 0.25, ao: 0 });
  for (let i = 0; i < 8; i++) {
    const t = i / 7;
    const y = w[1] + 0.12 - i * 0.13;
    const z = 0.02 + t * t * 0.42;
    b.box(0.03, 0.15, 0.1 - t * 0.06, { x: w[0] - 0.02, y, z, rx: -0.15 - t * 1.0 }, bone);
    b.box(0.012, 0.15, 0.02, { x: w[0] - 0.02, y, z: z + 0.06 - t * 0.03, rx: -0.15 - t * 1.0 }, edge);
  }
  b.sphere(0.04, 8, 6, { x: w[0] - 0.02, y: w[1] + 0.14, z: 0.02 }, blood(true));
  // 左手：一截铁链和钩子
  b.bone(B.armLL);
  const wl = J.wristL;
  const iron = metal(0x4e5052, { jitter: 0.25, ao: 0 });
  for (let i = 0; i < 5; i++) b.torus(0.026, 0.007, 5, 10, { x: wl[0], y: wl[1] - 0.1 - i * 0.045, ry: i % 2 ? Math.PI / 2 : 0 }, iron);
  b.add(new TorusGeometry(0.07, 0.013, 6, 14, Math.PI * 1.35), { x: wl[0], y: wl[1] - 0.4, z: 0.03, ry: Math.PI / 2, rx: Math.PI * 0.6 }, iron);
  b.cone(0.016, 0.05, 6, { x: wl[0], y: wl[1] - 0.36, z: 0.1, rx: -0.6 }, iron);
}

/**
 * 母巢：肿成球的肚子（皮下透出蛹曲的影子）、肋下两对萎缩的小手、嘴里垂下来的肉须。
 * 背上的卵囊是单独的部件（broodSacs），打爆一个藏一个
 */
function extrasBrood(b: Builder, J: Joints, L: Look, rng: Rng): void {
  b.bone(B.chest);
  const c = J.chest[1];
  const sk = (k: number) => skinSt(shade(L.skin, k), { jitter: 0.3 });
  b.sphere(0.56, 18, 12, { y: c + 0.1, z: 0.2, sy: 0.88, sx: 1.08 }, sk(1));
  b.sphere(0.5, 16, 10, { y: c + 0.06, z: 0.27, sy: 0.84 }, sk(0.92));
  for (let i = 0; i < 5; i++) {
    const a = rng.range(-0.8, 0.8);
    b.sphere(rng.range(0.06, 0.1), 8, 6, { x: Math.sin(a) * 0.5, y: c + rng.range(-0.15, 0.3), z: 0.27 + Math.cos(a) * 0.4, sx: 1.6, sy: 0.7, sz: 0.2, ry: a }, dark(0x3e3440));
  }
  for (let i = 0; i < 8; i++) {
    const a = rng.range(-1, 1);
    b.sphere(0.012, 5, 4, { x: Math.sin(a) * 0.52, y: c + rng.range(-0.2, 0.35), z: 0.27 + Math.cos(a) * 0.43, ry: a, rz: rng.range(-1, 1), sx: 1, sy: 10, sz: 0.5 }, dark(0x4a3458));
  }
  // 肋下的小手
  for (const s of [-1, 1]) {
    for (let k = 0; k < 2; k++) {
      const y = c + 0.05 + k * 0.18;
      const x0 = s * 0.42;
      const x1 = s * 0.58;
      b.rod([x0, y, 0.1], [x1, y - 0.12, 0.22], 0.022, sk(0.85), 6);
      b.rod([x1, y - 0.12, 0.22], [x1 - s * 0.02, y - 0.26, 0.3], 0.018, sk(0.85), 6);
      for (let f = 0; f < 3; f++) b.cone(0.006, 0.05, 4, { x: x1 - s * 0.02 + (f - 1) * 0.015, y: y - 0.3, z: 0.31, rx: Math.PI }, matte(0x2a221c, { ao: 0 }));
    }
  }
  b.bone(B.head);
  const hy = J.head[1];
  for (let i = 0; i < 5; i++) b.rod([(i - 2) * 0.016, hy + 0.06, 0.09], [(i - 2) * 0.03, hy - 0.12 - rng.range(0, 0.1), 0.12], 0.007, i % 2 ? blood(true) : skinSt(0x6e3e4a), 4);
}

/** 母巢背上的卵囊：第 i 个的位置（胸骨坐标系里的模型坐标） */
const SAC_AT: Array<[number, number, number]> = [
  [0.17, 0.44, -0.27],
  [-0.17, 0.44, -0.27],
  [0.22, 0.12, -0.3],
  [-0.22, 0.12, -0.3],
];

function broodSac(b: Builder, J: Joints, i: number): void {
  const [x, y, z] = SAC_AT[i] as [number, number, number];
  const c = J.chest[1];
  b.sphere(0.15, 14, 10, { x, y: c + y, z, sy: 1.15 }, skinSt(0x9a8a5a, { jitter: 0.3, ao: 0.1 }));
  b.sphere(0.11, 12, 8, { x, y: c + y, z: z - 0.05, sy: 1.1 }, glow(0xb8c050, 0.8));
  for (let k = 0; k < 3; k++) b.sphere(0.03, 6, 4, { x: x + (k - 1) * 0.04, y: c + y + (k % 2 ? 0.05 : -0.04), z: z - 0.13 }, dark(0x2e2a12));
  b.sphere(0.012, 5, 4, { x, y: c + y - 0.14, z, sx: 1, sy: 8, sz: 1 }, dark(0x4a3458));
}

/** 哀嚎女王：骨刺发冠、拖到腰的长发帘、裂到下巴的嘴和发紫的声囊、长爪、撒成布条的纱裙 */
function extrasSiren(b: Builder, J: Joints, L: Look, rng: Rng): void {
  const hy = J.head[1];
  const hair = matte(0x1a1614, { jitter: 0.12, ao: 0.2 });
  const boneSt = matte(0xd0c8b4, { jitter: 0.14, ao: 0 });
  b.bone(B.head);
  for (let i = 0; i < 9; i++) {
    const a = -1.4 + (i / 8) * 2.8;
    const len = 0.1 + (1 - Math.abs(a) / 1.4) * 0.12;
    b.cone(0.012, len, 5, { x: Math.sin(a) * 0.085, y: hy + 0.24 + len * 0.4, z: Math.cos(a) * 0.075 - 0.01, rx: Math.cos(a) * -0.25, rz: Math.sin(a) * -0.35 }, boneSt);
  }
  for (let i = 0; i < 12; i++) {
    const a = Math.PI * 0.35 + (i / 11) * Math.PI * 1.3;
    const len = rng.range(0.45, 0.75);
    b.box(0.045, len, 0.012, { x: Math.sin(a) * 0.1, y: hy + 0.2 - len / 2, z: Math.cos(a) * 0.1 - 0.02, ry: a }, hair);
  }
  for (const s of [-1, 1]) b.box(0.035, 0.42, 0.012, { x: s * 0.075, y: hy - 0.02, z: 0.08, rz: s * 0.06 }, hair);
  b.sphere(0.04, 10, 6, { y: hy + 0.03, z: 0.08, sx: 0.9, sy: 2.6, sz: 0.5 }, dark(0x0c0408));
  b.sphere(0.075, 10, 8, { y: hy - 0.09, z: 0.035, sx: 1.25 }, skinSt(shade(L.skin, 0.8), { jitter: 0.3 }));
  b.sphere(0.05, 8, 6, { y: hy - 0.09, z: 0.06, sx: 1.2 }, glow(0x9a70c8, 0.55));
  b.bone(B.chest);
  const c = J.chest[1];
  for (let i = 0; i < 6; i++) b.sphere(0.016, 6, 4, { y: c + 0.08 + i * 0.06, z: -0.085, sx: 1.2, sz: 0.8 }, skinSt(shade(L.skin, 0.9)));
  for (const s of [-1, 1]) b.rod([s * 0.03, J.head[1] - 0.06, 0.06], [s * 0.15, J.shoulderL[1] + 0.01, 0.03], 0.01, skinSt(shade(L.skin, 1.05)), 5);
  for (const [bone, wr] of [[B.armLL, J.wristL], [B.armLR, J.wristR]] as const) {
    b.bone(bone);
    for (let f = 0; f < 4; f++) b.cone(0.007, 0.13, 5, { x: wr[0] + (f - 1.5) * 0.015, y: wr[1] - 0.16, z: 0.03, rx: 2.8 }, matte(0x1e1814, { ao: 0 }));
  }
  b.bone(B.pelvis);
  const py = J.pelvis[1];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    if (Math.abs(Math.sin(a)) > 0.85) continue;
    const len = rng.range(0.4, 0.7);
    b.box(0.07, len, 0.01, { x: Math.sin(a) * 0.13, y: py - 0.08 - len / 2, z: Math.cos(a) * 0.1, ry: a, rx: Math.cos(a) * 0.08 }, matte(shade(L.shirt, rng.range(0.8, 1.15)), { jitter: 0.2, ao: 0.3 }));
  }
}

/** 重装感染者胸前的钢板（单独的部件：打掉了就藏起来） */
function armorPlate(b: Builder, J: Joints): void {
  const c = J.chest[1];
  b.box(0.6, 0.6, 0.05, { y: c + 0.12, z: 0.19 }, metal(0x62666a, { jitter: 0.3, ao: 0.25 }));
  b.box(0.56, 0.045, 0.055, { y: c + 0.42, z: 0.195 }, metal(0x44484c, { jitter: 0.2, ao: 0 }));
  for (const [x, y] of [[-0.25, 0.38], [0.25, 0.38], [-0.25, -0.12], [0.25, -0.12], [0, 0.12]] as const) b.cyl(0.016, 0.016, 0.02, 8, { x, y: c + y, z: 0.22, rx: Math.PI / 2 }, metal(0xa8a8a0, { ao: 0 }));
  b.box(0.48, 0.055, 0.004, { y: c - 0.04, z: 0.217 }, matte(0xb0901e, { jitter: 0.3, ao: 0 }));
  b.sphere(0.05, 8, 6, { x: -0.12, y: c + 0.25, z: 0.218, sx: 1.2, sy: 1.6, sz: 0.1 }, blood());
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
  else if (kind === 'spitter') extrasSpitter(b, J, L, rng);
  else if (kind === 'screamer') extrasScreamer(b, J, L);
  else if (kind === 'crawler') extrasCrawler(b, J, rng);
  else if (kind === 'armored') extrasArmored(b, J);
  else if (kind === 'leaper') extrasLeaper(b, J, L);
  else if (kind === 'splitter') extrasSplitter(b, J, L, rng);
  else if (kind === 'gasser') extrasGasser(b, J, L);
  else if (kind === 'reaper') extrasReaper(b, J, L, rng);
  else if (kind === 'brood') extrasBrood(b, J, L, rng);
  else if (kind === 'siren') extrasSiren(b, J, L, rng);
  return b.build();
}

/** 能单独藏起来的部件（挂在胸骨上）：重装的钢板、母巢背上的卵囊 */
export interface ZombieParts {
  plate: Group | null;
  sacs: Group[];
}

const partCache = new Map<string, Built>();

/** 一个部件：不蒙皮的几何体（模型坐标），挂到胸骨下、减掉胸骨的位置：骨头静止时没有旋转，这样就和身体对齐 */
function part(actor: RigActor, key: string, make: (b: Builder) => void): Group {
  let built = partCache.get(key);
  if (!built) {
    const b = new Builder(false);
    make(b);
    built = b.build();
    partCache.set(key, built);
  }
  const g = new Group();
  for (const [geo, mat] of [
    [built.matte, ZMats.matte],
    [built.metal, ZMats.metal],
    [built.glow, ZMats.glow],
  ] as const) {
    if (!geo) continue;
    const m = new Mesh(geo, mat);
    m.castShadow = mat !== ZMats.glow;
    g.add(m);
  }
  const c = actor.J.chest;
  g.position.set(-c[0], -c[1], -c[2]);
  actor.bone(B.chest).add(g);
  return g;
}

export function attachParts(actor: RigActor, kind: ZombieKind): ZombieParts {
  const J = actor.J;
  return {
    plate: kind === 'armored' ? part(actor, 'plate', (b) => armorPlate(b, J)) : null,
    sacs: kind === 'brood' ? SAC_AT.map((_, i) => part(actor, `sac${i}`, (b) => broodSac(b, J, i))) : [],
  };
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
  const actor = new RigActor(zombieGeometry(kind, variant), ZMats, makeJoints(PROPORTIONS[kind]), ZFlash);
  actor.group.scale.setScalar(MODEL_SCALE[kind]);
  return actor;
}
