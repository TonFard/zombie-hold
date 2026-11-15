import { Color, Matrix4, Vector3, type BufferGeometry } from 'three';
import { B, type Joints } from './rig';
import { Loft, bell, clamp01, fbm, lerp, noise, smooth, superCos, superSin, table, type Vert } from './loft';
import { BLOOD, BLOOD_FRESH, MUD, clothColor, skinColor, splat, type Ctx, type Look, type Outfit } from './body-paint';
import { addHead, type HeadAnchors } from './head-mesh';

/**
 * 僵尸的身体：一整张蒙皮网格，按真人的解剖比例放样出来（标准身材 = 1.75 米的男性）。
 *
 * 以前是「圆柱当四肢、球遮住关节」的木偶；现在躯干是一条从胯到脖子的连续曲面（腰、胸廓、肩胛、斜方肌都在截面表里），
 * 四肢是带肌肉起伏的管子，肩 / 肘 / 髋 / 膝 / 腰 / 脖子两侧的顶点同时跟两根骨头走，弯起来是圆的。
 * 衣服是身体外面的一层：比皮肤鼓出一截，往下垂；下摆、袖口、裤脚是一道硬棱，里面露出皮肤或裤子。
 *
 * 坐标：模型朝 +Z，左手边是 +X，脚底在 y = 0。绕身体的角度 th：0 = 正前方，往左（+X）为正。
 */

const TAU = Math.PI * 2;
const wrap = (th: number): number => {
  let t = th % TAU;
  if (t > Math.PI) t -= TAU;
  if (t < -Math.PI) t += TAU;
  return t;
};

const LEATHER = new Color(0x1e1a16);
const REFLECT = new Color(0xa8a8a0);
const NAIL = new Color(0x2a1e18);
const BONE = new Color(0xcfc8b0);

function piecewise(x: number, from: readonly number[], to: readonly number[]): number {
  const n = from.length;
  let i = 0;
  while (i < n - 2 && x > (from[i + 1] as number)) i++;
  const a = from[i] as number;
  const b = from[i + 1] as number;
  return (to[i] as number) + (((to[i + 1] as number) - (to[i] as number)) * (x - a)) / (b - a || 1);
}

// ------------------------------------------------------------------------------------------ 躯干

/** 标准身材的躯干截面：[高度, 半宽, 前半厚, 后半厚, 中线的前后偏移, 方度（2 = 椭圆）] */
const TORSO: ReadonlyArray<readonly number[]> = [
  [0.815, 0.03, 0.03, 0.038, 0, 2.0],
  [0.835, 0.095, 0.066, 0.082, 0, 2.1],
  [0.87, 0.152, 0.084, 0.104, -0.004, 2.2],
  [0.91, 0.172, 0.09, 0.112, -0.006, 2.3],
  [0.95, 0.17, 0.094, 0.104, -0.004, 2.3],
  [0.99, 0.16, 0.098, 0.092, 0, 2.3],
  [1.04, 0.15, 0.1, 0.084, 0.004, 2.25],
  [1.09, 0.146, 0.098, 0.082, 0.006, 2.25],
  [1.15, 0.152, 0.099, 0.088, 0.004, 2.3],
  [1.21, 0.162, 0.104, 0.098, 0, 2.4],
  [1.27, 0.172, 0.11, 0.106, -0.004, 2.5],
  [1.33, 0.176, 0.106, 0.112, -0.008, 2.5],
  [1.38, 0.168, 0.094, 0.11, -0.012, 2.4],
  [1.42, 0.16, 0.08, 0.1, -0.014, 2.3],
  [1.45, 0.15, 0.066, 0.09, -0.014, 2.2],
  [1.475, 0.105, 0.058, 0.078, -0.012, 2.1],
  [1.495, 0.066, 0.054, 0.066, -0.01, 2.0],
  [1.52, 0.056, 0.052, 0.06, -0.006, 2.0],
];
/** 躯干放样的高度（标准身材的米） */
const TORSO_Y = [0.815, 0.835, 0.862, 0.893, 0.925, 0.957, 0.99, 1.022, 1.056, 1.09, 1.125, 1.16, 1.195, 1.23, 1.265, 1.3, 1.335, 1.368, 1.398, 1.425, 1.448, 1.468, 1.485, 1.5, 1.518];
const SEG_TORSO = 28;

/** 上衣比皮肤鼓出多少、往里收得多快（越小越直筒）、下摆在哪、领口在哪（标准高度） */
const TOPS: Record<Outfit, { fit: number; slope: number; hem: number; collar: number }> = {
  tee: { fit: 0.006, slope: 0.32, hem: 0.925, collar: 1.468 },
  shirt: { fit: 0.009, slope: 0.28, hem: 0.905, collar: 1.49 },
  hoodie: { fit: 0.018, slope: 0.14, hem: 0.9, collar: 1.488 },
  vest: { fit: 0.014, slope: 0.2, hem: 0.95, collar: 1.468 },
  scrubs: { fit: 0.012, slope: 0.18, hem: 0.9, collar: 1.468 },
  jacket: { fit: 0.017, slope: 0.18, hem: 0.9, collar: 1.486 },
  hazmat: { fit: 0.024, slope: 0.1, hem: 0, collar: 1.5 },
  bare: { fit: 0, slope: 0, hem: 0, collar: 0 },
  // 作战服：下摆扎在裤腰里（在腰带上面鼓出来一圈），立领
  combat: { fit: 0.013, slope: 0.24, hem: 0.992, collar: 1.494 },
};

export interface Torso {
  /** 躯干最外面那层（衣服或皮肤）上的点。a = 绕身体的角度（0 = 正前，正 = 左），y = 高度（米），lift = 再往外抬多少 */
  at(a: number, y: number, lift: number, out: Vector3): Vector3;
  /** 脖子比标准身材粗多少倍（头那边的脖子要跟着粗） */
  neckK: number;
  /** 按 v.p 的高度写上躯干的骨头权重（贴在躯干上的装具用：和下面的衣服一起动） */
  weight(v: Vert): void;
}

/** 四肢表面上的点：s = 沿肢体的位置（0 = 肩 / 髋，1 = 肘 / 膝，2 = 腕 / 踝），th = 绕肢体的角度（0 = 正前方），
 *  lift = 再往外抬多少（米）。写进 v 的有位置、那里的衣服 / 皮肤颜色、骨头权重 */
export type LimbAt = (s: number, th: number, lift: number, v: Vert) => void;

function addTorso(loft: Loft, c: Ctx): Torso {
  const { J, L } = c;
  const py = J.pelvis[1];
  const wy = J.chest[1];
  const sy = J.shoulderL[1];
  const ny = J.head[1];
  const ls = py / 0.95;
  const STD = [0.815, 0.95, 1.02, 1.42, 1.5];
  const ACT = [py - 0.135 * ls, py, wy, sy, ny];
  const fromStd = (ys: number): number => piecewise(ys, STD, ACT);
  const toStd = (y: number): number => piecewise(y, ACT, STD);
  const shK = J.shoulderL[0] / 0.2;
  const neckK = shK * 0.35 + 0.65;
  const belly = L.belly ?? 0;
  const g = c.gaunt;

  const sec = { a: 0, bf: 0, bb: 0, zc: 0, n: 2 };
  const section = (ys: number): void => {
    // 胯和腰按 bulk，肩那一段跟着肩关节的位置走；脖子只跟着粗一点
    let kw = lerp(L.bulk, shK, smooth(1.12, 1.36, ys));
    let kd = L.depth;
    const neck = smooth(1.42, 1.49, ys);
    kw = lerp(kw, 1 + (kw - 1) * 0.35, neck);
    kd = lerp(kd, 1 + (kd - 1) * 0.3, neck);
    let a = table(TORSO, 1, ys) * kw;
    let bf = table(TORSO, 2, ys) * kd;
    const bb = table(TORSO, 3, ys) * kd;
    if (c.female) a *= (1 + 0.06 * bell(ys, 0.91, 0.07)) * (1 - 0.1 * bell(ys, 1.1, 0.09));
    // 干瘦：腰细、肚子瘪进去
    a *= 1 - 0.07 * g * bell(ys, 1.09, 0.13);
    bf -= 0.022 * g * bell(ys, 1.07, 0.1);
    bf += belly * bell(ys, 1.04, 0.14);
    a += belly * 0.35 * bell(ys, 1.03, 0.14);
    sec.a = a;
    sec.bf = bf;
    sec.bb = bb;
    sec.zc = table(TORSO, 4, ys);
    sec.n = table(TORSO, 5, ys);
  };

  /** 皮肤上的起伏（米，往外为正） */
  const feat = (t: number, ys: number): number => {
    const at = Math.abs(t);
    const back = Math.PI - at;
    let d = 0;
    // 脊柱沟、肩胛骨、臀
    d -= 0.006 * bell(back, 0, 0.16) * smooth(0.98, 1.08, ys) * smooth(1.46, 1.38, ys);
    d += 0.007 * bell(back, 0.62, 0.3) * bell(ys, 1.335, 0.055);
    d += 0.012 * bell(back, 0.5, 0.36) * bell(ys, 0.895, 0.05);
    d -= 0.008 * bell(back, 0, 0.12) * bell(ys, 0.88, 0.05);
    // 胸
    if (c.female) d += 0.03 * bell(at, 0.42, 0.28) * bell(ys, 1.275, 0.045);
    else d += 0.007 * bell(at, 0.45, 0.3) * bell(ys, 1.31, 0.045);
    // 锁骨、肋弓下面的凹陷（瘦的更明显）
    d += (0.002 + 0.004 * g) * bell(ys, 1.415, 0.012) * smooth(1.3, 0.3, at);
    d -= 0.008 * g * bell(at, 0.75, 0.4) * bell(ys, 1.13, 0.05);
    return d;
  };

  /** 皮肤表面离中轴多远（这个角度、这个高度） */
  const radial = (th: number, ys: number): number => {
    section(ys);
    const sx = superSin(th, sec.n);
    const cz = superCos(th, sec.n);
    return Math.hypot(sec.a * sx, (cz >= 0 ? sec.bf : sec.bb) * cz) + feat(wrap(th), ys);
  };

  /** 皮肤表面再往外 extra 米处的点 */
  const surf = (th: number, ys: number, extra: number, out: Vector3): Vector3 => {
    section(ys);
    const sx = superSin(th, sec.n);
    const cz = superCos(th, sec.n);
    const b = cz >= 0 ? sec.bf : sec.bb;
    let nx = sx / sec.a;
    let nz = cz / b;
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl;
    nz /= nl;
    const d = extra + feat(wrap(th), ys);
    return out.set(sec.a * sx + nx * d, fromStd(ys), sec.zc + b * cz + nz * d);
  };

  const top = TOPS[L.outfit];
  const onePiece = L.outfit === 'hazmat';
  const bare = L.outfit === 'bare';
  /** 敞着的外套：正面这么宽的一条露出里面的 T 恤 */
  const gap = (ys: number): number => 0.17 + 0.12 * clamp01((1.47 - ys) / 0.5);
  /** 作战服的下摆是齐的（扎在裤腰里）；别的衣服下摆破破烂烂 */
  const neat = L.outfit === 'combat';
  const hem = (th: number): number =>
    neat ? top.hem + 0.004 * Math.sin(th * 3 + c.seed) : top.hem + 0.014 * fbm(Math.sin(th) * 2.2 + c.seed, Math.cos(th) * 2.2, c.seed * 0.7) - 0.02 * smooth(0.8, 0.88, noise(Math.sin(th) * 1.7 + c.seed * 2, Math.cos(th) * 1.7, 4));

  /** 上衣比皮肤鼓出多少：贴着肩和胸，从上面最鼓的地方垂下来，加上褶皱 */
  const upperExtra = (th: number, ys: number): number => {
    const t = wrap(th);
    let fit = top.fit;
    if (L.outfit === 'jacket' && Math.abs(t) < gap(ys)) fit = 0.006;
    let best = fit;
    if (ys < 1.3) {
      const r0 = radial(th, ys);
      for (let i = 1; i <= 6; i++) {
        const y2 = ys + ((1.3 - ys) * i) / 6;
        const d = radial(th, y2) + fit - top.slope * (y2 - ys) - r0;
        if (d > best) best = d;
      }
    }
    // 腰上横着的褶、下摆竖着的褶
    const low = smooth(1.2, 0.95, ys);
    best += 0.0035 * Math.sin(ys * 70 + 3 * noise(Math.sin(th) * 2 + c.seed, ys * 4, Math.cos(th) * 2)) * bell(ys, 1.09, 0.1) * (0.4 + fit * 40);
    best += 0.005 * Math.sin(th * 9 + 4 * noise(c.seed, ys * 3, 1)) * low * (0.3 + fit * 40);
    return Math.max(0.003, best);
  };
  const lowerExtra = (th: number, ys: number): number => 0.008 + 0.004 * bell(ys, 0.995, 0.012) + 0.003 * fbm(Math.sin(th) * 3, ys * 30, Math.cos(th) * 3 + c.seed);

  const weight = (v: Vert): void => {
    v.blend(B.pelvis, B.chest, smooth(py, wy + 0.1, v.p.y));
  };

  const paintLower = (th: number, ys: number, v: Vert, k: number): void => {
    if (ys > 0.978 && !onePiece) {
      // 腰带
      v.c.copy(LEATHER).multiplyScalar(k * (1 + 0.1 * fbm(v.p.x * 30, v.p.y * 30, v.p.z * 30)));
      return;
    }
    const at = Math.abs(wrap(th));
    // 裆下、两腿之间暗；大腿正面磨得发白
    const ao = lerp(0.72, 1, smooth(0.83, 0.9, ys)) * (1 - 0.12 * bell(at, 0, 0.3) * smooth(0.93, 0.86, ys));
    clothColor(c, c.pants, v.p, k * ao, v.c);
    const bl = splat(c, v.p);
    if (bl > 0) v.c.lerp(BLOOD, bl * 0.8);
  };

  const paintUpper = (th: number, ys: number, v: Vert, k: number): void => {
    const t = wrap(th);
    const at = Math.abs(t);
    let base = c.top;
    let kk = k;
    let skin = false;
    switch (L.outfit) {
      case 'jacket':
        base = at < gap(ys) ? c.top : c.outer;
        break;
      case 'vest':
        // 反光背心：两道灰白的反光条，正面一条拉链
        base = bell(ys, 1.12, 0.016) + bell(ys, 1.27, 0.016) > 0.45 ? REFLECT : c.outer;
        if (at < 0.045) kk *= 0.6;
        break;
      case 'hoodie':
        // 前面的大口袋
        if (at < 0.55 && ys > 1.0 && ys < 1.13) kk *= 0.82;
        break;
      case 'shirt':
        // 门襟、一条歪掉的领带
        if (at < 0.05) kk *= 1.12;
        if (t > 0.01 && t < 0.15 && ys > 1.16 && ys < 1.47) base = c.outer;
        break;
      case 'scrubs':
        // V 领、胸前口袋
        skin = at < 0.33 && ys > 1.47 - 0.1 * (1 - at / 0.33);
        if (t < -0.3 && t > -0.62 && ys > 1.245 && ys < 1.31) kk *= 0.82;
        break;
      case 'hazmat':
        // 拉链、腰上缠的一圈胶带
        if (at < 0.04) kk *= 0.5;
        if (bell(ys, 1.01, 0.02) > 0.5) base = REFLECT;
        break;
      default:
        break;
    }
    if (skin) {
      skinColor(c, v.p, k, v.c);
      return;
    }
    // 腋下暗一点
    kk *= 1 - 0.22 * bell(at, Math.PI / 2, 0.35) * bell(ys, 1.3, 0.07);
    clothColor(c, base, v.p, kk, v.c);
    // 从下巴滴到胸口的血、溅上去的血
    const drip = c.gore * smooth(0.38, 0.62, noise(v.p.x * 9 + c.seed, v.p.y * 6, v.p.z * 9)) * bell(at, 0, 0.36) * smooth(1.2, 1.4, ys) * (0.35 + 0.65 * clamp01(L.jaw));
    const bl = Math.max(drip, splat(c, v.p));
    if (bl > 0) v.c.lerp(BLOOD, bl * 0.85);
  };

  const paintSkin = (th: number, ys: number, v: Vert, k: number): void => {
    const at = Math.abs(wrap(th));
    let kk = k;
    // 腋下、锁骨窝、瘦的肋骨印子
    kk *= 1 - 0.2 * bell(at, Math.PI / 2, 0.35) * bell(ys, 1.3, 0.07);
    if (g > 0) kk *= 1 - 0.16 * g * smooth(0.3, 0.9, Math.sin(ys * 118)) * bell(at, 0.85, 0.45) * smooth(1.1, 1.16, ys) * smooth(1.33, 1.27, ys);
    skinColor(c, v.p, kk, v.c);
    // 头套一直包到领口里面
    if (c.mask) clothColor(c, c.mask, v.p, kk, v.c);
    const drip = c.gore * smooth(0.4, 0.62, noise(v.p.x * 9 + c.seed, v.p.y * 6, v.p.z * 9)) * bell(at, 0, 0.36) * smooth(1.25, 1.42, ys) * (0.35 + 0.65 * clamp01(L.jaw));
    const bl = Math.max(drip, splat(c, v.p) * 0.8);
    if (bl > 0) v.c.lerp(BLOOD, bl * 0.85);
  };

  type YS = number | ((th: number) => number);
  const rings: Array<(k: number, v: Vert) => void> = [];
  const TH = (k: number): number => (k / SEG_TORSO) * TAU;
  const ring = (ys: YS, layer: 'lower' | 'upper' | 'skin', k = 1, add = 0): void => {
    rings.push((i, v) => {
      const th = TH(i);
      const y = typeof ys === 'number' ? ys : ys(th);
      if (layer === 'lower') {
        surf(th, y, (onePiece ? upperExtra(th, y) : lowerExtra(th, y)) + add, v.p);
        if (onePiece) paintUpper(th, y, v, k);
        else paintLower(th, y, v, k);
      } else if (layer === 'upper') {
        surf(th, y, upperExtra(th, y) + add, v.p);
        paintUpper(th, y, v, k);
      } else {
        surf(th, y, add, v.p);
        paintSkin(th, y, v, k);
      }
      weight(v);
    });
  };

  if (bare) {
    for (const ys of TORSO_Y) if (ys < 0.985) ring(ys, 'lower');
    ring(1.002, 'lower');
    ring(1.002, 'lower', 0.5);
    ring(1.002, 'skin', 0.55);
    for (const ys of TORSO_Y) if (ys > 1.01) ring(ys, 'skin', ys < 1.03 ? 0.8 : 1);
  } else if (onePiece) {
    for (const ys of TORSO_Y) if (ys < top.collar - 0.012) ring(ys, 'lower');
    ring(top.collar, 'lower', 0.85, 0.004);
    ring(top.collar, 'lower', 0.4, 0.004);
    ring(top.collar, 'skin', 0.5);
    for (const ys of TORSO_Y) if (ys > top.collar + 0.008) ring(ys, 'skin', 0.85);
  } else {
    for (const ys of TORSO_Y) if (ys < top.hem - 0.02) ring(ys, 'lower');
    // 下摆：里面的裤子（暗）→ 下摆朝下的那一圈 → 上衣
    ring((th) => hem(th) + 0.02, 'lower', 0.7);
    ring((th) => hem(th) + 0.02, 'lower', 0.35);
    ring(hem, 'upper', 0.4, 0.003);
    ring(hem, 'upper', 0.92, 0.003);
    for (const ys of TORSO_Y) if (ys > top.hem + 0.04 && ys < top.collar - 0.012) ring(ys, 'upper');
    // 领口：一圈稍厚的边，里面露出脖子
    ring(top.collar, 'upper', 0.8, 0.003);
    ring(top.collar, 'upper', 0.4, 0.003);
    ring(top.collar, 'skin', 0.5);
    for (const ys of TORSO_Y) if (ys > top.collar + 0.008) ring(ys, 'skin', 0.85);
  }
  loft.tube(rings.length, SEG_TORSO, (i, k, v) => (rings[i] as (k: number, v: Vert) => void)(k, v), { capA: true, capB: true });

  // 脖子的断口：平时封在脖子里看不见；爆头把头缩没了以后，露出来的就是它
  loft.blob(
    new Vector3(0, ny + 0.024, -0.012),
    new Vector3(0.04 * neckK, 0, 0),
    new Vector3(0, 0, 0.04 * neckK),
    new Vector3(0, 0.02, 0),
    (v) => {
      v.c.copy(BLOOD_FRESH).multiplyScalar(0.6 + 0.8 * noise(v.p.x * 70, v.p.y * 70, v.p.z * 70));
      v.bone(B.chest);
    },
    4,
    10,
  );

  // 连帽衫：帽兜耷拉在背后
  if (L.outfit === 'hoodie') {
    const p = surf(Math.PI, 1.43, 0.02, new Vector3());
    loft.blob(
      p,
      new Vector3(0.13, 0, 0),
      new Vector3(0, 0.03, -0.05),
      new Vector3(0, 0.075, 0.03),
      (v) => {
        clothColor(c, c.top, v.p, 0.86, v.c);
        v.c.multiplyScalar(1 - 0.25 * smooth(p.z - 0.01, p.z + 0.04, v.p.z));
        v.bone(B.chest);
      },
      7,
      12,
    );
  }

  section(1.5);
  return {
    at(a, y, lift, out) {
      const ys = toStd(y);
      let extra = 0;
      if (!bare) {
        if (onePiece) extra = upperExtra(a, ys);
        else if (ys > top.hem + 0.03 && ys < top.collar) extra = upperExtra(a, ys);
        else if (ys <= top.hem + 0.03) extra = lowerExtra(a, ys);
      } else if (ys < 1.0) extra = lowerExtra(a, ys);
      return surf(a, ys, extra + lift, out);
    },
    neckK,
    weight,
  };
}

// ------------------------------------------------------------------------------------------ 四肢

/** 手臂的粗细：[位置（0 = 肩，1 = 肘，2 = 腕；负的在肩关节上面），左右半宽, 前后半宽] */
const ARM: ReadonlyArray<readonly number[]> = [
  [-0.115, 0.014, 0.018],
  [-0.085, 0.033, 0.04],
  [-0.03, 0.044, 0.052],
  [0.08, 0.047, 0.055],
  [0.25, 0.046, 0.054],
  [0.42, 0.044, 0.051],
  [0.65, 0.04, 0.046],
  [0.88, 0.036, 0.041],
  [1.0, 0.035, 0.04],
  [1.12, 0.038, 0.043],
  [1.3, 0.036, 0.041],
  [1.6, 0.03, 0.034],
  [1.85, 0.0245, 0.0275],
  [2.0, 0.0215, 0.0225],
];
const ARM_S = [-0.115, -0.085, -0.04, 0.02, 0.1, 0.22, 0.36, 0.5, 0.64, 0.76, 0.86, 0.93, 1.0, 1.07, 1.14, 1.24, 1.37, 1.52, 1.68, 1.84, 1.95, 2.0];
const SEG_ARM = 12;

/** 腿的粗细：[位置（0 = 髋，1 = 膝，2 = 踝）, 左右半宽, 前半厚, 后半厚] */
const LEG: ReadonlyArray<readonly number[]> = [
  [-0.16, 0.03, 0.03, 0.03],
  [-0.08, 0.07, 0.07, 0.075],
  [0.02, 0.086, 0.082, 0.088],
  [0.25, 0.082, 0.082, 0.084],
  [0.5, 0.072, 0.074, 0.072],
  [0.78, 0.058, 0.06, 0.056],
  [0.93, 0.052, 0.056, 0.05],
  [1.0, 0.052, 0.058, 0.05],
  [1.08, 0.048, 0.05, 0.05],
  [1.25, 0.05, 0.046, 0.062],
  [1.45, 0.045, 0.042, 0.054],
  [1.7, 0.035, 0.036, 0.038],
  [1.9, 0.029, 0.032, 0.032],
  [2.0, 0.03, 0.034, 0.034],
];
const LEG_S = [-0.16, -0.1, -0.03, 0.05, 0.15, 0.27, 0.4, 0.53, 0.66, 0.78, 0.87, 0.94, 1.0, 1.06, 1.13, 1.22, 1.33, 1.46, 1.6, 1.74, 1.86, 1.95, 2.0];
const SEG_LEG = 14;

interface LimbRing {
  s: number;
  /** 0 = 皮肤，1 = 布 */
  layer: 0 | 1;
  /** 亮度倍数 */
  k: number;
  /** 这一圈是袖口 / 裤脚：位置按角度参差一点 */
  hem?: boolean;
}

/** 袖子 / 裤腿在 end 处收口：end 之前是布，收口处一道硬棱，后面是皮肤 */
function limbRings(base: readonly number[], end: number, from = -9, to = 9): LimbRing[] {
  const out: LimbRing[] = [];
  for (const s of base) {
    if (s < from || s > to) continue;
    if (end <= -1) out.push({ s, layer: 0, k: 1 });
    else if (s < end - 0.035) out.push({ s, layer: 1, k: 1 });
  }
  if (end > -1) {
    out.push({ s: end, layer: 1, k: 0.9, hem: true }, { s: end, layer: 1, k: 0.4, hem: true }, { s: end, layer: 0, k: 0.45, hem: true });
    let first = true;
    for (const s of base) {
      if (s <= end + 0.035 || s > to) continue;
      out.push({ s, layer: 0, k: first ? 0.72 : 1 });
      first = false;
    }
  }
  return out;
}

function addArm(loft: Loft, c: Ctx, side: 0 | 1): LimbAt {
  const { J, L } = c;
  const sg = side === 0 ? 1 : -1;
  const S = new Vector3(...(side === 0 ? J.shoulderL : J.shoulderR));
  const E = new Vector3(...(side === 0 ? J.elbowL : J.elbowR));
  const W = new Vector3(...(side === 0 ? J.wristL : J.wristR));
  const upperB = side === 0 ? B.armUL : B.armUR;
  const foreB = side === 0 ? B.armLL : B.armLR;
  const missing = L.missingArm === (side === 0 ? 1 : 2);
  const thick = c.limb * (1 - 0.14 * c.gaunt);

  // 袖子到哪：-1 = 没有袖子
  let end = -1;
  if (L.outfit === 'hazmat') end = 1.93;
  else if (L.outfit !== 'bare') {
    if (L.sleeves === 'long') end = 1.9 - (missing ? 0.75 : 0) - 0.5 * smooth(0.82, 0.9, noise(c.seed * 3 + side * 7, 2, 5));
    else if (L.sleeves === 'short') end = L.outfit === 'scrubs' ? 0.66 : 0.56;
  }
  if (L.sleeveEnd !== undefined) end = L.sleeveEnd;
  /** 袖子卷起来了（作战服卷到肘上下）：袖口是厚厚的一圈 */
  const rolled = L.sleeveEnd !== undefined && end < 1.6;
  const baggy = L.outfit === 'hoodie' ? 0.016 : L.outfit === 'jacket' ? 0.015 : L.outfit === 'hazmat' ? 0.02 : L.outfit === 'combat' ? 0.014 : 0.009;
  const sleeve = L.outfit === 'jacket' ? c.outer : c.top;
  const rings = limbRings(ARM_S, end, -9, missing ? 1.3 : 9);
  if (missing) rings.push({ s: 1.36, layer: 0, k: -1 });

  const cen = new Vector3();
  loft.tube(
    rings.length,
    SEG_ARM,
    (i, k, v) => {
      const r = rings[i] as LimbRing;
      const th = (k / SEG_ARM) * TAU;
      let s = r.s;
      if (r.hem) s += 0.022 * fbm(Math.sin(th) * 1.6 + c.seed + side * 3, Math.cos(th) * 1.6, 2);
      if (s <= 1) cen.lerpVectors(S, E, s);
      else cen.lerpVectors(E, W, s - 1);
      cen.x -= sg * 0.022 * smooth(0.12, -0.115, s);
      let rx = table(ARM, 1, s) * thick;
      let rz = table(ARM, 2, s) * thick;
      // 肘尖
      const back = Math.cos(th) < 0 ? -Math.cos(th) : 0;
      rz += 0.005 * back * bell(s, 1.0, 0.05);
      if (r.layer === 1) {
        let off = end < 1 ? lerp(0.004, 0.009, clamp01(s / end)) : baggy * (s > 1.84 && L.outfit === 'hoodie' ? 0.4 : 1) + 0.004 * bell(s, 1.0, 0.16) + 0.003 * fbm(Math.sin(th) * 2 + c.seed, s * 16, Math.cos(th) * 2);
        if (rolled) off = baggy + 0.009 * smooth(end - 0.16, end - 0.03, s);
        rx += off;
        rz += off;
      }
      if (r.k < 0) {
        // 断臂的断口：往里收一点
        rx *= 0.82;
        rz *= 0.82;
      }
      v.p.set(cen.x + Math.sin(th) * rx, cen.y, cen.z + Math.cos(th) * rz);
      if (r.k < 0) v.c.copy(BLOOD_FRESH).multiplyScalar(0.8 + 0.4 * noise(v.p.x * 60, v.p.y * 60, v.p.z * 60));
      else if (r.layer === 1) {
        // 腋下（朝身体的那侧）暗
        clothColor(c, sleeve, v.p, r.k * (1 - 0.2 * clamp01(-sg * Math.sin(th)) * smooth(0.5, 0, s)), v.c);
        const bl = splat(c, v.p);
        if (bl > 0) v.c.lerp(BLOOD, bl * 0.8);
      } else {
        skinColor(c, v.p, r.k * (1 - 0.15 * clamp01(-sg * Math.sin(th)) * smooth(0.5, 0, s)), v.c);
        // 前臂上的血、断口上面一截发黑
        const bl = Math.max(splat(c, v.p) * 0.8, missing ? smooth(1.05, 1.3, s) * 0.8 : 0);
        if (bl > 0) v.c.lerp(BLOOD, bl);
        const hb = smooth(0.42, 0.7, noise(v.p.x * 13 + c.seed * 2, v.p.y * 13, v.p.z * 13 + side * 5)) * 0.3 * smooth(1.55, 2.0, s);
        if (hb > 0) v.c.lerp(BLOOD_FRESH, hb);
      }
      if (s < 0.5) v.blend(B.chest, upperB, smooth(-0.115, 0.2, s));
      else v.blend(upperB, foreB, smooth(0.84, 1.16, s));
    },
    { capA: true, capB: true },
  );

  if (missing) {
    // 露出来的骨头
    const a = new Vector3().lerpVectors(E, W, 0.3);
    const b = new Vector3().lerpVectors(E, W, 0.56);
    loft.pipe([a, b], (i) => (i === 0 ? 0.012 : 0.0095), 6, new Vector3(1, 0, 0), (_i, _k, v) => {
      v.c.copy(BONE).multiplyScalar(0.9 + 0.2 * noise(v.p.x * 50, v.p.y * 50, v.p.z * 50));
      v.bone(foreB);
    });
  } else addHand(loft, c, side, W, L.outfit === 'hazmat' || !!L.gloves, 0.022 * thick);

  // 手臂表面上的点（装具用）：和上面放样用的是同一套算法
  return (s, th, lift, v) => {
    if (s <= 1) cen.lerpVectors(S, E, s);
    else cen.lerpVectors(E, W, s - 1);
    cen.x -= sg * 0.022 * smooth(0.12, -0.115, s);
    let rx = table(ARM, 1, s) * thick;
    let rz = table(ARM, 2, s) * thick;
    const back = Math.cos(th) < 0 ? -Math.cos(th) : 0;
    rz += 0.005 * back * bell(s, 1.0, 0.05);
    const cloth = end > -1 && s < end;
    if (cloth) {
      let off = end < 1 ? lerp(0.004, 0.009, clamp01(s / end)) : baggy * (s > 1.84 && L.outfit === 'hoodie' ? 0.4 : 1) + 0.004 * bell(s, 1.0, 0.16);
      if (rolled) off = baggy + 0.009 * smooth(end - 0.16, end - 0.03, s);
      rx += off;
      rz += off;
    }
    v.p.set(cen.x + Math.sin(th) * (rx + lift), cen.y, cen.z + Math.cos(th) * (rz + lift));
    if (cloth) clothColor(c, sleeve, v.p, 1, v.c);
    else skinColor(c, v.p, 1, v.c);
    if (s < 0.5) v.blend(B.chest, upperB, smooth(-0.115, 0.2, s));
    else v.blend(upperB, foreB, smooth(0.84, 1.16, s));
  };
}

/** 四根手指的指根位置（右手：x 正 = 拇指侧）、长度、粗细。食指排第一 */
const FINGERS: ReadonlyArray<{ x: number; z: number; len: readonly [number, number, number]; r: number; splay: number }> = [
  { x: 0.031, z: 0.088, len: [0.044, 0.027, 0.023], r: 0.0092, splay: 0.14 },
  { x: 0.0105, z: 0.092, len: [0.048, 0.03, 0.024], r: 0.0095, splay: 0.03 },
  { x: -0.0105, z: 0.089, len: [0.045, 0.028, 0.023], r: 0.009, splay: -0.08 },
  { x: -0.031, z: 0.082, len: [0.036, 0.022, 0.021], r: 0.0081, splay: -0.2 },
];
/** 手掌的截面：[沿手指方向的位置, 半宽, 半厚, 往拇指侧偏多少] */
const PALM: ReadonlyArray<readonly number[]> = [
  [-0.012, 0.022, 0.0145, 0],
  [0.01, 0.028, 0.016, 0.002],
  [0.038, 0.038, 0.0155, 0.004],
  [0.066, 0.042, 0.013, 0.002],
  [0.086, 0.0415, 0.0105, 0],
  [0.095, 0.038, 0.007, 0],
];

/**
 * 手：手掌 + 四根弯着的手指 + 拇指，整个跟着前臂（没有单独的骨头）。
 * 手自己的坐标：原点在手腕，+Z 手指方向，+Y 手背，+X 拇指侧（右手；左手镜像）。
 * 垂着的时候掌心朝后朝里，胳膊往前伸出去就是掌心朝下的爪子
 */
function addHand(loft: Loft, c: Ctx, side: 0 | 1, W: Vector3, glove: boolean, wrist: number): void {
  const bone = side === 0 ? B.armLL : B.armLR;
  // 前臂旋前的角度：0 = 掌心朝大腿，90° = 掌心朝后
  const phi = 0.95;
  // 手背的方向：右手 (-cos, 0, sin)，左手 (cos, 0, sin)
  const Y = new Vector3(side === 1 ? -Math.cos(phi) : Math.cos(phi), 0, Math.sin(phi));
  const Z = new Vector3(0, -1, 0);
  const X = new Vector3().crossVectors(Y, Z);
  // 手腕耷拉着：往掌心那边弯一点
  const flex = 0.28;
  const m = new Matrix4().makeBasis(X, Y, Z);
  m.multiply(new Matrix4().makeRotationX(flex));
  m.setPosition(W.x, W.y, W.z);
  // 左手：几何体左右镜像（拇指在 -X）
  const mir = side === 0 ? -1 : 1;
  const size = 0.84 + 0.2 * c.limb;
  /** 手腕的粗细（手自己的尺寸里） */
  const wr = wrist / size;
  m.multiply(new Matrix4().makeScale(mir * size, size, size));
  const prev = loft.xf;
  loft.xf = m;

  const base = glove ? new Color(c.L.gloveColor ?? 0x2a2a26) : null;
  const tmp = new Vector3();
  const clawLen = (c.L.claws ?? 0) / size;
  const claw = (from: Vector3, tip: Vector3, r: number, len: number): void => {
    if (len <= 0) return;
    const d = new Vector3().subVectors(tip, from).normalize();
    const pts = [tip.clone().addScaledVector(d, -0.006), tip.clone().addScaledVector(d, len * 0.5), tip.clone().addScaledVector(d, len)];
    (pts[1] as Vector3).y -= len * 0.07;
    (pts[2] as Vector3).y -= len * 0.26;
    loft.pipe(pts, (i) => r * ([0.74, 0.5, 0.07][i] as number), 5, new Vector3(1, 0, 0), (i, _k, v) => {
      v.c.copy(NAIL).multiplyScalar(i === 2 ? 0.7 : 1.1);
      v.bone(bone);
    });
  };
  const paint = (v: Vert, k: number, tip: number): void => {
    // 颜色按摆好以后的位置算（噪声图案才连续）
    tmp.copy(v.p).applyMatrix4(m);
    if (base) clothColor(c, base, tmp, k, v.c);
    else {
      skinColor(c, tmp, k * 0.92, v.c);
      // 指尖发黑、手上的血
      v.c.lerp(NAIL, 0.6 * tip * c.gore);
      const bl = c.gore * smooth(0.42, 0.7, noise(tmp.x * 13 + c.seed * 2, tmp.y * 13, tmp.z * 13 + side * 5)) * (0.3 + 0.5 * tip);
      if (bl > 0) v.c.lerp(BLOOD_FRESH, bl);
    }
    v.bone(bone);
  };

  // 手掌
  loft.tube(
    PALM.length,
    10,
    (i, k, v) => {
      const row = PALM[i] as readonly number[];
      const t = (k / 10) * TAU;
      // 掌根接着手腕：头两圈不比手腕细
      const hw = i === 0 ? wr : i === 1 ? Math.max(row[1] as number, wr * 0.96) : (row[1] as number);
      const ht = i === 0 ? wr * 0.84 : i === 1 ? Math.max(row[2] as number, wr * 0.72) : (row[2] as number);
      v.p.set((row[3] as number) + hw * superCos(t, 2.7), ht * superSin(t, 2.7), row[0] as number);
      // 掌心暗一点
      paint(v, 1 - 0.18 * clamp01(-Math.sin(t)), 0);
    },
    { capA: true, capB: true },
  );

  // 四指：三节往掌心弯（爪子）
  const up = new Vector3(1, 0, 0);
  for (const [fi, f] of FINGERS.entries()) {
    const curl = 0.75 + 0.5 * noise(c.seed * 5 + fi * 3.3 + side * 9, 1, 2);
    const fist = c.L.fist ?? 0;
    const bends = [0.2 * curl + 0.75 * fist, 0.62 * curl + 0.6 * fist, 0.42 * curl + 0.35 * fist];
    const pts: Vector3[] = [new Vector3(f.x, -0.001, f.z - 0.006)];
    let ang = 0;
    let p = new Vector3(f.x, -0.001, f.z);
    pts.push(p.clone());
    for (let j = 0; j < 3; j++) {
      ang += bends[j] as number;
      const dir = new Vector3(Math.sin(f.splay), -Math.sin(ang), Math.cos(ang)).normalize();
      const len = (f.len[j] as number) * (j === 2 ? 0.9 : 1);
      // 每节中间加一圈：弯的地方不会被压扁
      pts.push(p.clone().addScaledVector(dir, len * 0.5));
      p = p.clone().addScaledVector(dir, len);
      pts.push(p.clone());
    }
    const n = pts.length;
    loft.pipe(pts, (i) => f.r * lerp(1.05, 0.76, i / (n - 1)) * (i === 3 || i === 5 ? 1.07 : 1), 5, up, (i, k, v) => {
      const t = (k / 5) * TAU;
      paint(v, 1 - 0.15 * clamp01(-Math.sin(t)), smooth(n - 4.5, n - 1, i));
    });
    claw(pts[n - 2] as Vector3, pts[n - 1] as Vector3, f.r, clawLen * (fi === 0 || fi === 3 ? 0.84 : 1));
  }

  // 拇指：从大鱼际伸出来，往食指那边收
  const tp = [new Vector3(0.02, -0.007, 0.012), new Vector3(0.044, -0.013, 0.038), new Vector3(0.058, -0.019, 0.064), new Vector3(0.063, -0.027, 0.086)];
  loft.pipe(tp, (i) => [0.0145, 0.012, 0.0108, 0.0085][i] as number, 6, new Vector3(0, 0, 1), (i, _k, v) => {
    paint(v, 0.96, smooth(1.6, 3, i));
  });
  claw(tp[2] as Vector3, tp[3] as Vector3, 0.0105, clawLen * 0.8);
  loft.xf = prev;
}

function addLeg(loft: Loft, c: Ctx, side: 0 | 1): LimbAt {
  const { J, L } = c;
  const sg = side === 0 ? 1 : -1;
  const H = new Vector3(...(side === 0 ? J.hipL : J.hipR));
  const K = new Vector3(...(side === 0 ? J.kneeL : J.kneeR));
  const A = new Vector3(...(side === 0 ? J.ankleL : J.ankleR));
  const upperB = side === 0 ? B.legUL : B.legUR;
  const lowerB = side === 0 ? B.legLL : B.legLR;
  const thick = c.limb * (1 - 0.12 * c.gaunt);
  const onePiece = L.outfit === 'hazmat';
  const legs = onePiece ? 'long' : (L.legs ?? 'long');
  /** 作战靴：裤腿在小腿中间扎进靴筒，下面一截是靴子不是皮肤 */
  const boots = !!L.boots && !onePiece && L.shoe !== null;
  const end = boots ? BOOT_TOP : legs === 'shorts' ? 0.86 : legs === 'torn' ? 1.38 + 0.25 * noise(c.seed * 2 + side * 5, 3, 1) : 1.94;
  const rings = limbRings(boots ? LEG_S_BOOT : LEG_S, end);
  /** 靴筒比腿粗多少：皮子有厚度，脚踝那里是硬的、不跟着收细；靴口是一圈软垫 */
  const shaftX = (s: number, r: number): number => Math.max(r + 0.01, 0.049 * (0.82 + 0.18 * c.limb)) + 0.004 * bell(s, BOOT_TOP + 0.03, 0.03);
  const shaftZ = (s: number, r: number, front: boolean): number => Math.max(r + 0.01, (front ? 0.052 : 0.055) * (0.82 + 0.18 * c.limb)) + 0.004 * bell(s, BOOT_TOP + 0.03, 0.03);
  /** 作战裤：比普通裤子肥，裤脚在靴口上面鼓出来一圈 */
  const cargo = (s: number): number => lerp(0.09, 0.066, clamp01(s / 1.6)) * (0.6 + 0.4 * thick) + 0.01 * smooth(1.3, 1.5, s);
  const cloth = onePiece ? c.top : c.pants;
  const cen = new Vector3();

  loft.tube(
    rings.length,
    SEG_LEG,
    (i, k, v) => {
      const r = rings[i] as LimbRing;
      const th = (k / SEG_LEG) * TAU;
      let s = r.s;
      if (r.hem && legs !== 'long') s += 0.05 * fbm(Math.sin(th) * 1.6 + c.seed + side * 3, Math.cos(th) * 1.6, 6);
      if (s <= 1) cen.lerpVectors(H, K, s);
      else cen.lerpVectors(K, A, s - 1);
      const front = Math.cos(th) >= 0;
      let rx = table(LEG, 1, s) * thick;
      let rz = table(LEG, front ? 2 : 3, s) * thick;
      if (r.layer === 1) {
        // 裤腿：贴着大腿，往下是直筒，脚踝上堆着几道褶
        const tube = boots ? cargo(s) : lerp(0.076, onePiece ? 0.07 : 0.061, clamp01(s / 2)) * (0.6 + 0.4 * thick);
        const fold = 0.004 * fbm(Math.sin(th) * 2 + c.seed, s * 12, Math.cos(th) * 2 + side) + 0.005 * Math.sin(s * 58) * smooth(1.55, 1.9, s) + 0.004 * Math.sin(s * 64) * bell(s, 1.0, 0.12) * (front ? 0.3 : 1);
        rx = Math.max(rx + 0.011, tube) + fold;
        rz = Math.max(rz + 0.011, tube) + fold;
        if (onePiece) {
          rx += 0.008;
          rz += 0.008;
        }
      } else if (boots) {
        rx = shaftX(s, rx);
        rz = shaftZ(s, rz, front);
      }
      v.p.set(cen.x + Math.sin(th) * rx, cen.y, cen.z + Math.cos(th) * rz);
      // 大腿内侧暗
      const inner = clamp01(-sg * Math.sin(th)) * smooth(0.7, 0, s);
      if (r.layer === 1) {
        // 大腿正面、膝盖磨得发白；裤脚和膝盖沾着泥
        const wear = 1 + 0.16 * (front ? 1 : 0) * Math.abs(Math.cos(th)) * (bell(s, 0.45, 0.3) + bell(s, 1.0, 0.1));
        clothColor(c, cloth, v.p, r.k * wear * (1 - 0.3 * inner), v.c);
        const mud = (smooth(1.5, 1.95, s) * 0.5 + bell(s, 1.0, 0.09) * (front ? 0.3 : 0)) * (0.3 + 0.7 * c.gore);
        v.c.lerp(MUD, mud * (0.5 + 0.5 * noise(v.p.x * 17, v.p.y * 17 + c.seed, v.p.z * 17)));
        const bl = splat(c, v.p);
        if (bl > 0) v.c.lerp(BLOOD, bl * 0.8);
      } else if (boots) bootColor(c, v, s, th, r.k);
      else {
        skinColor(c, v.p, r.k * (1 - 0.25 * inner), v.c);
        const bl = splat(c, v.p);
        if (bl > 0) v.c.lerp(BLOOD, bl);
      }
      if (s < 0.5) v.blend(B.pelvis, upperB, smooth(-0.1, 0.12, s));
      else v.blend(upperB, lowerB, smooth(0.86, 1.14, s));
    },
    { capA: true, capB: true },
  );
  addFoot(loft, c, side, A);

  // 腿表面上的点（装具用）：和上面放样用的是同一套算法（不带褶皱）
  return (s, th, lift, v) => {
    if (s <= 1) cen.lerpVectors(H, K, s);
    else cen.lerpVectors(K, A, s - 1);
    const front = Math.cos(th) >= 0;
    let rx = table(LEG, 1, s) * thick;
    let rz = table(LEG, front ? 2 : 3, s) * thick;
    const isCloth = s < end;
    if (isCloth) {
      const tube = boots ? cargo(s) : lerp(0.076, onePiece ? 0.07 : 0.061, clamp01(s / 2)) * (0.6 + 0.4 * thick);
      rx = Math.max(rx + 0.011, tube) + (onePiece ? 0.008 : 0);
      rz = Math.max(rz + 0.011, tube) + (onePiece ? 0.008 : 0);
    } else if (boots) {
      rx = shaftX(s, rx);
      rz = shaftZ(s, rz, front);
    }
    v.p.set(cen.x + Math.sin(th) * (rx + lift), cen.y, cen.z + Math.cos(th) * (rz + lift));
    if (isCloth) clothColor(c, cloth, v.p, 1, v.c);
    else if (boots) bootColor(c, v, s, th, 1);
    else skinColor(c, v.p, 1, v.c);
    if (s < 0.5) v.blend(B.pelvis, upperB, smooth(-0.1, 0.12, s));
    else v.blend(upperB, lowerB, smooth(0.86, 1.14, s));
  };
}

/** 靴口在腿上的位置（1 = 膝，2 = 踝）：小腿中间偏下 */
const BOOT_TOP = 1.6;
/** 穿靴子的腿：膝盖以下的圈密一些（裤脚鼓出来的一圈、靴筒上一道道的鞋带都要靠它） */
const LEG_S_BOOT = [...LEG_S.filter((x) => x < 1.3), 1.33, 1.4, 1.46, 1.52, 1.56, 1.65, 1.69, 1.73, 1.77, 1.81, 1.85, 1.89, 1.93, 1.97, 2.0];
const LACE = new Color(0x9a927e);
const _lace = new Color();

/** 靴筒的颜色：前面一条鞋舌，上面一道一道的鞋带；靴口一圈软垫颜色深一点 */
function bootColor(c: Ctx, v: Vert, s: number, th: number, k: number): void {
  clothColor(c, c.shoe, v.p, 1.25 * k, v.c);
  const f = Math.cos(th);
  // 鞋舌（正前方窄窄的一条）比两边暗；鞋带每隔一圈一道
  const tongue = smooth(0.82, 0.96, f);
  v.c.multiplyScalar(1 - 0.35 * tongue);
  const row = Math.round((s - BOOT_TOP) / 0.04);
  if (row % 2 === 1 && s > BOOT_TOP + 0.03) v.c.lerp(_lace.copy(c.shoe).lerp(LACE, 0.45), 0.7 * tongue);
  v.c.multiplyScalar(1 - 0.3 * bell(s, BOOT_TOP + 0.03, 0.025));
}

/** 光脚（到前脚掌为止，脚趾另外做）：[前后位置（0 = 脚踝正下方）, 半宽, 脚背的高度] */
const FOOT: ReadonlyArray<readonly number[]> = [
  [-0.068, 0.014, 0.03],
  [-0.057, 0.026, 0.056],
  [-0.032, 0.03, 0.084],
  [0, 0.032, 0.094],
  [0.035, 0.034, 0.074],
  [0.075, 0.04, 0.052],
  [0.112, 0.046, 0.037],
  [0.14, 0.047, 0.029],
  [0.156, 0.044, 0.023],
];
/** 脚趾（大脚趾排第一）：x = 往内侧偏多少，z = 趾根的前后位置，len = 长度，r = 粗细 */
const TOES: ReadonlyArray<{ x: number; z: number; len: number; r: number }> = [
  { x: 0.03, z: 0.15, len: 0.05, r: 0.0135 },
  { x: 0.0105, z: 0.153, len: 0.043, r: 0.0096 },
  { x: -0.0055, z: 0.15, len: 0.038, r: 0.009 },
  { x: -0.0205, z: 0.144, len: 0.032, r: 0.0085 },
  { x: -0.034, z: 0.136, len: 0.026, r: 0.0082 },
];
/** 鞋：比脚大一圈，鞋头更高更圆，鞋口到脚踝 */
const SHOE: ReadonlyArray<readonly number[]> = [
  [-0.082, 0.02, 0.05],
  [-0.07, 0.034, 0.085],
  [-0.04, 0.04, 0.112],
  [0, 0.042, 0.118],
  [0.04, 0.045, 0.094],
  [0.08, 0.05, 0.072],
  [0.125, 0.055, 0.058],
  [0.165, 0.054, 0.052],
  [0.192, 0.046, 0.044],
  [0.206, 0.03, 0.03],
];
const SOLE = new Color(0x141210);
/** 作战靴：鞋头又高又圆，后跟包得高，接着靴筒 */
const BOOT: ReadonlyArray<readonly number[]> = [
  [-0.092, 0.024, 0.07],
  [-0.08, 0.04, 0.108],
  [-0.046, 0.047, 0.128],
  [0, 0.049, 0.134],
  [0.042, 0.05, 0.112],
  [0.086, 0.054, 0.086],
  [0.13, 0.058, 0.074],
  [0.172, 0.058, 0.07],
  [0.202, 0.051, 0.062],
  [0.219, 0.034, 0.044],
];

function addFoot(loft: Loft, c: Ctx, side: 0 | 1, A: Vector3): void {
  const { L } = c;
  const bone = side === 0 ? B.legLL : B.legLR;
  const sg = side === 0 ? 1 : -1;
  const shoe = L.shoe !== null;
  const boots = shoe && !!L.boots && L.outfit !== 'hazmat';
  const rows = boots ? BOOT : shoe ? SHOE : FOOT;
  /** 鞋底多厚：皮鞋 2 厘米，作战靴是带齿的厚底 */
  const soleH = boots ? 0.034 : 0.021;
  const k = 0.82 + 0.18 * c.limb;
  const SEG = 12;
  /** 脚尖略往外撇 */
  const skew = (z: number): number => sg * 0.012 * clamp01(z / 0.18);
  /** 光脚：脚底、脚趾脏得发黑 */
  const barefoot = (v: Vert, z: number): void => {
    skinColor(c, v.p, 1.35 * (0.6 + 0.4 * smooth(0.005, 0.04, v.p.y)), v.c);
    v.c.lerp(MUD, 0.5 * smooth(0.1, 0.19, z) + 0.3 * noise(v.p.x * 20, c.seed, v.p.z * 20));
  };
  loft.tube(
    rows.length,
    SEG,
    (i, j, v) => {
      const row = rows[i] as readonly number[];
      const t = (j / SEG) * TAU;
      const w = (row[1] as number) * k;
      const top = row[2] as number;
      // 下半圈压扁成脚底
      const sn = Math.sin(t);
      const mid = Math.min(top * 0.42, 0.024);
      let y = sn >= 0 ? mid + (top - mid) * superSin(t, 2.3) : mid + mid * superSin(t, 3.2);
      // 鞋面的底埋在鞋底里
      if (shoe) y = Math.max(y, boots ? 0.024 : 0.012);
      const z = row[0] as number;
      v.p.set(A.x + w * superCos(t, 2.5) + skew(z), y, A.z + z);
      if (boots) {
        // 鞋头的包头、后跟颜色深一点；脚背上接着靴筒的鞋带
        clothColor(c, c.shoe, v.p, 1.25 * (1 - 0.22 * smooth(0.15, 0.19, z)) * (1 - 0.18 * smooth(-0.04, -0.075, z)), v.c);
        const lace = smooth(0.55, 0.9, sn) * smooth(0.135, 0.11, z) * smooth(-0.01, 0.02, z);
        v.c.multiplyScalar(1 - 0.3 * lace);
        if (i % 2 === 0) v.c.lerp(_lace.copy(c.shoe).lerp(LACE, 0.45), 0.6 * lace);
        v.c.lerp(MUD, 0.3 * noise(v.p.x * 15 + c.seed, v.p.y * 15, v.p.z * 15) * smooth(0.07, 0.03, y));
      } else if (shoe) {
        // 鞋头、鞋口暗一点；沾着泥
        clothColor(c, c.shoe, v.p, 1.2 * (1 - 0.25 * smooth(0.15, 0.19, z)) * (1 - 0.35 * smooth(0.098, 0.116, y)), v.c);
        v.c.lerp(MUD, 0.45 * (0.3 + 0.7 * c.gore) * noise(v.p.x * 15 + c.seed, v.p.y * 15, v.p.z * 15));
      } else barefoot(v, z);
      v.bone(bone);
    },
    { capA: true, capB: true },
  );
  if (shoe) {
    loft.tube(
      rows.length,
      8,
      (i, j, v) => {
        const row = rows[i] as readonly number[];
        const t = ((j + 0.5) / 8) * TAU;
        const w = (row[1] as number) * k * 1.05 + (boots ? 0.005 : 0.003);
        const z = (row[0] as number) * 1.03;
        // 作战靴的底：脚心那一段从下面挖进去一点（前掌和后跟之间的弓）
        const arch = boots && Math.sin(t) < 0 ? 0.012 * bell(z, 0.035, 0.03) : 0;
        v.p.set(A.x + w * superCos(t, 5) + skew(z), soleH / 2 + (soleH / 2) * superSin(t, 5) + arch, A.z + z);
        v.c.copy(SOLE).multiplyScalar(0.8 + 0.4 * noise(v.p.x * 40, 1, v.p.z * 40));
        // 鞋底和鞋面之间的那道沿条浅一点
        if (boots && Math.sin(t) > 0.5) v.c.multiplyScalar(1.9);
        v.bone(bone);
      },
      { capA: true, capB: true },
    );
    return;
  }
  const up = new Vector3(1, 0, 0);
  for (const t of TOES) {
    const r = t.r * k;
    const x = A.x - sg * t.x * k;
    const zs = [t.z - 0.014, t.z + t.len * 0.55, t.z + t.len];
    const pts = zs.map((z, j) => new Vector3(x + skew(z), r * ([1.1, 0.95, 0.78][j] as number), A.z + z));
    loft.pipe(pts, (j) => [r * (j === 2 ? 0.84 : 1), r * (j === 2 ? 0.7 : 0.92)], 6, up, (j, _k, v) => {
      barefoot(v, zs[j] as number);
      if (j === 2) v.c.lerp(NAIL, 0.4);
      v.bone(bone);
    });
  }
}

// ------------------------------------------------------------------------------------------ 整个身体

export interface Body {
  /** 索引几何体：position / normal / color / skinIndex / skinWeight */
  geometry: BufferGeometry;
  torso: Torso;
  head: HeadAnchors;
  triangles: number;
  /** 上色用的那一套东西（装具要和衣服同一种迷彩时用） */
  ctx: Ctx;
  /** 手臂 / 腿表面上的点，[左, 右]（往身上贴装具用） */
  arm: [LimbAt, LimbAt];
  leg: [LimbAt, LimbAt];
}

export function buildBody(J: Joints, L: Look, seed: number): Body {
  const skin = new Color(L.skin);
  const c: Ctx = {
    J,
    L,
    seed: (seed % 97) * 1.37 + 0.5,
    skin,
    livor: skin.clone().lerp(new Color(0x4a4452), 0.55),
    top: new Color(L.shirt),
    outer: new Color(L.accent),
    pants: new Color(L.pants),
    shoe: new Color(L.shoe ?? 0x2a2420),
    limb: L.limb ?? Math.min(1.5, Math.max(0.74, L.bulk * 0.9 + 0.1)),
    gaunt: L.gaunt ? 1 : 0,
    female: !!L.female,
    gore: L.clean ? 0 : 1,
    camo: L.camo ? { dark: new Color(L.camo.dark), light: new Color(L.camo.light) } : null,
    mask: L.mask !== undefined ? new Color(L.mask) : null,
  };
  const loft = new Loft();
  const torso = addTorso(loft, c);
  const arm: LimbAt[] = [];
  const leg: LimbAt[] = [];
  for (const side of [0, 1] as const) {
    arm.push(addArm(loft, c, side));
    leg.push(addLeg(loft, c, side));
  }
  const head = addHead(loft, c, torso.neckK);
  return { geometry: loft.build(), torso, head, triangles: loft.triangleCount, ctx: c, arm: arm as [LimbAt, LimbAt], leg: leg as [LimbAt, LimbAt] };
}

