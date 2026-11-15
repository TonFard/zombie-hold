import { Color, type Vector3 } from 'three';
import type { Joints } from './rig';
import { clamp01, fbm, noise, smooth } from './loft';

/** 僵尸的外观参数和上色（身体、头共用） */

/** combat = 作战服（对战里的士兵）：上衣扎在裤腰里、立领，下摆是齐的 */
export type Outfit = 'tee' | 'shirt' | 'hoodie' | 'vest' | 'scrubs' | 'jacket' | 'hazmat' | 'bare' | 'combat';

export interface Look {
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
  /** 女性的身形（窄肩、细腰、宽胯） */
  female?: boolean;
  /** 裤腿：long 到脚踝 / torn 撕到小腿 / shorts 到膝盖上面 */
  legs?: 'long' | 'torn' | 'shorts';
  /** 肚子往前鼓多少（米） */
  belly?: number;
  /** 四肢粗细倍数（不给 = 按 bulk 算） */
  limb?: number;
  /** 指尖长出来的爪子有多长（米；不给 = 没有） */
  claws?: number;
  /** 活人（对战里的士兵）：没有尸斑、血迹、伤口，衣服上只有一点灰 */
  clean?: boolean;
  /** 戴手套 */
  gloves?: boolean;
  // ---- 下面几项只有对战里的士兵用（僵尸不给，输出和以前一模一样）----
  /** 迷彩：衣服、裤子的底色上再叠两种颜色的斑块 */
  camo?: { dark: number; light: number };
  /** 作战靴：裤腿扎进高帮靴里（靴子的颜色用 shoe） */
  boots?: boolean;
  /** 袖子到哪（手臂上的位置：1 = 肘，2 = 腕）。不给 = 按 sleeves 来 */
  sleeveEnd?: number;
  /** 头套的颜色：整个头和脖子包起来，只露出眼睛那一条 */
  mask?: number;
  /** 手套的颜色（不给 = 深灰） */
  gloveColor?: number;
  /** 手指握起来多少：0 = 僵尸那样半张着的爪子，1 = 握拳（握着枪的手用 0.6 左右） */
  fist?: number;
}

export const BLOOD = new Color(0x3a0e0a);
export const BLOOD_FRESH = new Color(0x5a120c);
export const MUD = new Color(0x3a3228);

/** 建身体时到处要用的东西 */
export interface Ctx {
  J: Joints;
  L: Look;
  /** 每套外观一个偏移：脏污、血迹、褶皱的图案各不相同 */
  seed: number;
  skin: Color;
  /** 尸斑的颜色（发灰发紫） */
  livor: Color;
  top: Color;
  outer: Color;
  pants: Color;
  shoe: Color;
  /** 四肢粗细倍数 */
  limb: number;
  /** 0–1 干瘦 */
  gaunt: number;
  female: boolean;
  /** 尸斑、血、泥有多重：僵尸 1，活人 0 */
  gore: number;
  /** 迷彩的两种斑块颜色（没有迷彩就是 null） */
  camo: { dark: Color; light: Color } | null;
  /** 头套的颜色（没戴就是 null） */
  mask: Color | null;
}

/** 越靠近地面越暗（和 kit 里烘焙顶点色是一个意思） */
const groundAo = (y: number): number => {
  const t = clamp01(y / 1.4);
  return 1 - 0.3 * (1 - t) * (1 - t);
};

/** 皮肤：底色里混进一片片尸斑，再加一点细的明暗 */
export function skinColor(c: Ctx, p: Vector3, k: number, out: Color): Color {
  const m = smooth(0.42, 0.78, noise(p.x * 7 + c.seed, p.y * 7, p.z * 7));
  out.copy(c.skin).lerp(c.livor, 0.5 * m * c.gore);
  return out.multiplyScalar(k * groundAo(p.y) * (1 + 0.1 * fbm(p.x * 26, p.y * 26 + c.seed, p.z * 26)));
}

/** 布料：底色上有成片的污渍，再加一点细的明暗 */
export function clothColor(c: Ctx, base: Color, p: Vector3, k: number, out: Color): Color {
  const m = smooth(0.56, 0.86, noise(p.x * 5.5 + c.seed * 1.7, p.y * 5.5, p.z * 5.5 + 3));
  out.copy(base);
  // 迷彩（只染衣服和裤子，手套、鞋、头发不染）：大块的深色斑 + 小一些的浅色斑，边缘是晕开的
  if (c.camo && (base === c.top || base === c.outer || base === c.pants)) camoColor(c, p, out);
  out.lerp(MUD, 0.4 * m * (0.3 + 0.7 * c.gore));
  return out.multiplyScalar(k * groundAo(p.y) * (1 + 0.13 * fbm(p.x * 14 + c.seed, p.y * 14, p.z * 14)));
}

/** 迷彩斑块：在 out（底色）上叠深、浅两种颜色 */
export function camoColor(c: Ctx, p: Vector3, out: Color): Color {
  const cm = c.camo;
  if (!cm) return out;
  const s = c.seed;
  // 斑块拉成横向的条状（像真的迷彩那样顺着身体绕），竖直方向的频率高一些
  const big = noise(p.x * 7.5 + s, p.y * 10.5, p.z * 7.5 + 4.2);
  const mid = noise(p.x * 15 + 7.7, p.y * 19 + s * 0.6, p.z * 15 + 1.3);
  const fine = noise(p.x * 31 + 2.1, p.y * 34, p.z * 31 + s);
  out.lerp(cm.dark, 0.85 * smooth(0.52, 0.6, big + 0.12 * (fine - 0.5)));
  out.lerp(cm.light, 0.8 * smooth(0.6, 0.68, mid + 0.1 * (fine - 0.5)));
  return out;
}

/** 溅上去的血：0–1 */
export const splat = (c: Ctx, p: Vector3): number => (c.gore <= 0 ? 0 : c.gore * smooth(0.76, 0.86, noise(p.x * 5.5 + c.seed * 3.1, p.y * 5.5 + 11, p.z * 5.5)));
