import { Color, Vector3 } from 'three';
import { B } from './rig';
import { bell, clamp01, fbm, lerp, noise, smooth, superCos, superSin, table, type Loft } from './loft';
import { BLOOD, BLOOD_FRESH, clothColor, skinColor, type Ctx } from './body-paint';

/**
 * 僵尸的头：一张从脖子根到头顶的连续曲面。先按截面表放样出颅骨和下颌的大形，再在脸上压出眼窝、嘴，
 * 鼓出眉弓、鼻子、颧骨、下巴；嘴按张开的程度把下巴往下拉。耳朵、头发是贴在上面的几块。
 *
 * 头自己的坐标：原点在头骨（脖子根），+Y 往上，+Z 是脸的朝向。下巴底在 y ≈ 0.03，嘴 0.07，鼻底 0.1，眼睛 0.147，头顶 0.254。
 */

/** 截面：[高度, 半宽, 前半厚, 后半厚, 中线的前后偏移, 方度] */
const HEAD: ReadonlyArray<readonly number[]> = [
  [-0.08, 0.05, 0.05, 0.052, -0.012, 2.0],
  [-0.02, 0.052, 0.05, 0.054, -0.012, 2.0],
  [0.015, 0.053, 0.052, 0.056, -0.012, 2.0],
  [0.03, 0.052, 0.068, 0.06, -0.012, 1.95],
  [0.04, 0.051, 0.09, 0.066, -0.012, 1.9],
  [0.055, 0.053, 0.1, 0.074, -0.012, 2.0],
  [0.075, 0.057, 0.103, 0.082, -0.012, 2.15],
  [0.1, 0.063, 0.102, 0.088, -0.012, 2.35],
  [0.125, 0.069, 0.1, 0.094, -0.012, 2.5],
  [0.148, 0.072, 0.098, 0.097, -0.012, 2.45],
  [0.168, 0.074, 0.101, 0.098, -0.012, 2.4],
  [0.195, 0.0755, 0.098, 0.096, -0.011, 2.3],
  [0.22, 0.071, 0.086, 0.088, -0.01, 2.15],
  [0.238, 0.058, 0.066, 0.07, -0.01, 2.05],
  [0.249, 0.036, 0.04, 0.044, -0.01, 2.0],
  [0.254, 0.012, 0.014, 0.015, -0.01, 2.0],
];
const HEAD_Y = [-0.075, -0.045, -0.015, 0.012, 0.027, 0.036, 0.044, 0.053, 0.062, 0.071, 0.08, 0.089, 0.098, 0.107, 0.116, 0.125, 0.134, 0.142, 0.15, 0.158, 0.166, 0.175, 0.186, 0.198, 0.21, 0.222, 0.233, 0.242, 0.249, 0.253];
const SEG_HEAD = 30;
const TAU = Math.PI * 2;

const SOCKET = new Color(0x1c1210);
const MOUTH = new Color(0x140605);
const LIP = new Color(0x3a2a2c);
/** 活人的嘴唇（比肤色深一点、偏红） */
const LIP_LIVE = new Color(0x8c5a50);
const _mask = new Color();

export interface HeadAnchors {
  /** 两只眼睛的球心（模型坐标，[左, 右]）和眼球半径 */
  eyes: [Vector3, Vector3];
  eyeR: number;
  /** 嘴里（牙齿摆在这）：中心、半宽、半高 */
  mouth: Vector3;
  mouthW: number;
  mouthH: number;
  /** 头顶的高度（模型坐标） */
  top: number;
  /**
   * 头表面上的点（模型坐标；往头上贴东西用）。th = 绕头的角度（0 = 正前方，正 = 左），y = 离头骨原点（脖子根）多高，
   * lift = 再往外抬多少。plain = 不要脸上的起伏（眼窝、鼻子），只要颅骨的大形
   */
  at(th: number, y: number, lift: number, out: Vector3, plain?: boolean): Vector3;
  /** 耳朵中心（模型坐标，x 取正；左右对称） */
  ear: Vector3;
}

/** 发际线的高度：at = 离正前方多少弧度 */
const HAIRLINE: ReadonlyArray<readonly number[]> = [
  [0, 0.206],
  [0.5, 0.212],
  [0.95, 0.196],
  [1.25, 0.15],
  [1.4, 0.14],
  [1.52, 0.17],
  [1.88, 0.172],
  [2.05, 0.11],
  [2.5, 0.07],
  [3.15, 0.058],
];

export function addHead(loft: Loft, c: Ctx, neckK: number): HeadAnchors {
  const { J, L } = c;
  const O = new Vector3(...J.head);
  const g = c.gaunt;
  const drop = 0.004 + 0.021 * Math.min(1.7, Math.max(0, L.jaw));
  /** 上嘴唇的下沿（张嘴时不动） */
  const yTop = 0.079;
  /** 嘴张开的半高、中线的高度（下巴掉下去之前的形状里） */
  const mo = 0.0035 + drop * 0.3;
  const ym = yTop - mo;
  /** 下巴往下掉多少：上嘴唇以上不动，下嘴唇以下整个掉下去，到脖子根渐渐收住；只有朝前的这半边动 */
  const jawDrop = (y: number, z: number): number => drop * smooth(yTop - mo * 0.6, yTop - mo * 1.5, y) * smooth(-0.045, 0.02, y) * smooth(-0.01, 0.035, z);

  const sec = { a: 0, bf: 0, bb: 0, cz: 0, n: 2 };
  const section = (y: number): void => {
    const nk = lerp(neckK, 1, smooth(0.0, 0.04, y));
    sec.a = table(HEAD, 1, y) * nk * (c.female ? lerp(0.9, 0.97, smooth(0, 0.05, y)) : 1);
    sec.bf = table(HEAD, 2, y) * lerp(nk, 1, smooth(0.0, 0.04, y));
    sec.bb = table(HEAD, 3, y) * nk;
    sec.cz = table(HEAD, 4, y);
    sec.n = table(HEAD, 5, y);
    if (c.gore <= 0) {
      // 活人：下半张脸的截面方一点、宽一点（下颌是个 U 形，不是往前收成一个尖嘴）
      const jw = bell(y, 0.066, 0.04);
      sec.n += 0.75 * jw;
      sec.a *= 1 + 0.07 * jw;
      sec.bf *= 1 - 0.035 * bell(y, 0.05, 0.03);
    }
  };

  /** 嘴的半宽 */
  const mw = 0.026;
  /** 眼窝：0–1，中心最深。外眼角略低（耷拉着） */
  const socket = (ax: number, y: number): number => Math.exp(-(((ax - 0.032) / 0.0185) ** 2) - ((y - 0.147 + 0.1 * (ax - 0.032)) / 0.0125) ** 2);
  /** 张开的嘴：0–1，里面是平的、边上陡 */
  const mouthPit = (x: number, y: number): number => {
    const e = (x / mw) ** 2 + ((y - ym) / (mo + 0.004)) ** 2;
    return Math.exp(-e * e);
  };
  /** 活人（对战里的士兵）嘴是闭着的：洞只留一点点深，颜色也只是一道暗线 */
  const agape = 0.2 + 0.8 * c.gore;
  /** 活人的脸：眼窝浅一点、眉弓不皱着、鼻头小一点、下巴结实一点（僵尸的数不动） */
  const live = c.gore <= 0;
  const SOCKET_D = live ? 0.0105 : 0.015;
  const BROW_D = live ? 0.0045 : 0.007;
  const BROW_TILT = live ? 0.02 : 0.08;
  const NOSE_TIP = live ? 0.0155 : 0.0185;
  const CHIN_D = live ? 0.006 : 0.004;
  /** 头套露出来的那一条（眼睛一圈）：1 = 露着，0 = 包着 */
  const slit = (ax: number, y: number): number => smooth(0.128, 0.134, y) * smooth(0.168, 0.162, y) * smooth(0.068, 0.058, ax);

  /** 脸上的起伏（米，往外为正）。x / y 是没有起伏时的位置；fm / fm2 = 朝前的程度 */
  const feat = (x: number, y: number, fm: number, fm2: number): number => {
    const ax = Math.abs(x);
    let d = 0;
    // 眼窝；眉弓压在眼窝上面，中间低、两头高（皱着眉）
    d -= SOCKET_D * socket(ax, y) * fm;
    d += BROW_D * bell(y, 0.1645 + BROW_TILT * (ax - 0.03), 0.0075) * smooth(0.074, 0.03, ax) * smooth(0.002, 0.014, ax) * fm;
    if (L.noNose) d -= 0.011 * Math.exp(-((x / 0.013) ** 2) - ((y - 0.112) / 0.017) ** 2) * fm;
    else {
      // 鼻梁、鼻头、鼻翼
      d += 0.0065 * Math.exp(-((x / 0.009) ** 2) - ((y - 0.134) / 0.024) ** 2) * fm;
      d += NOSE_TIP * Math.exp(-((x / 0.0115) ** 2) - ((y - 0.1075) / 0.0125) ** 2) * fm;
      d += 0.0045 * Math.exp(-(((ax - 0.013) / 0.007) ** 2) - ((y - 0.102) / 0.0075) ** 2) * fm;
    }
    // 颧骨、凹下去的腮帮子、太阳穴、下颌角
    d += 0.0055 * Math.exp(-(((ax - 0.05) / 0.018) ** 2) - ((y - 0.124) / 0.014) ** 2) * fm2;
    d -= (live ? 0.0015 : 0.005 + 0.007 * g) * Math.exp(-(((ax - 0.044) / 0.017) ** 2) - ((y - 0.086) / 0.02) ** 2) * fm2;
    d -= 0.003 * Math.exp(-(((ax - 0.064) / 0.016) ** 2) - ((y - 0.18) / 0.02) ** 2) * fm2;
    // 嘴：张开的洞；上唇、下唇各一道
    d -= 0.017 * (live ? 0.07 : agape) * mouthPit(x, y) * fm;
    d += 0.0028 * Math.exp(-((x / 0.03) ** 2)) * (bell(y, ym + mo + 0.006, 0.004) + bell(y, ym - mo - 0.006, 0.004)) * fm;
    // 下巴、喉结
    d += CHIN_D * Math.exp(-((x / 0.018) ** 2) - ((y - 0.043) / 0.012) ** 2) * fm;
    // 活人：下颌的两个角撑起来一点（脸的下半截不至于尖成一个锥）
    if (live) d += 0.0065 * Math.exp(-(((ax - 0.042) / 0.022) ** 2) - ((y - 0.052) / 0.022) ** 2) * fm2;
    if (!c.female) d += 0.004 * Math.exp(-((x / 0.012) ** 2) - ((y + 0.008) / 0.012) ** 2) * fm;
    return d;
  };

  /** 头的表面（头自己的坐标）。face = false 时不要脸上的起伏（头发用） */
  const skull = (th: number, y: number, extra: number, face: boolean, out: Vector3): Vector3 => {
    section(y);
    const sx = superSin(th, sec.n);
    const cz = superCos(th, sec.n);
    const b = cz >= 0 ? sec.bf : sec.bb;
    const x = sec.a * sx;
    const z = b * cz;
    let nx = sx / sec.a;
    let nz = cz / b;
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl;
    nz /= nl;
    let d = extra;
    let yy = y;
    if (face) {
      const fm = smooth(0.0, 0.04, z);
      const fm2 = smooth(-0.025, 0.03, z);
      d += feat(x, y, fm, fm2);
      // 头套：布有厚度，把鼻子、嘴的起伏盖平一点
      if (c.mask) d += 0.0035 * (1 - slit(Math.abs(x), y) * fm);
      // 下巴跟着嘴张开往下掉
      yy -= jawDrop(y, z);
    }
    return out.set(x + nx * d, yy, sec.cz + z + nz * d);
  };

  const hair = L.hair !== null && L.hairStyle !== 'bald' ? new Color(L.hair) : null;
  const fringe = L.hair !== null && L.hairStyle === 'bald' ? new Color(L.hair) : null;
  const hairline = (th: number): number => {
    let t = th % TAU;
    if (t > Math.PI) t -= TAU;
    if (t < -Math.PI) t += TAU;
    return table(HAIRLINE, 1, Math.abs(t)) + 0.006 * fbm(Math.sin(th) * 3 + c.seed, Math.cos(th) * 3, 2);
  };

  const local = new Vector3();
  loft.tube(
    HEAD_Y.length,
    SEG_HEAD,
    (i, k, v) => {
      const y = HEAD_Y[i] as number;
      // 前面（脸）的顶点密，后脑勺稀
      const phi = (k / SEG_HEAD) * TAU;
      const th = phi - 0.42 * Math.sin(phi);
      skull(th, y, 0, true, local);
      const x = local.x;
      const ax = Math.abs(x);
      const front = smooth(0.0, 0.04, local.z - sec.cz);
      v.p.copy(local).add(O);
      // 明暗：下巴底下、脖子、凹进去的腮帮子
      let kk = 1;
      kk *= 1 - 0.3 * smooth(0.04, 0.02, y) * front;
      kk *= lerp(0.86, 1, smooth(-0.02, 0.04, y));
      kk *= 1 - 0.2 * Math.exp(-(((ax - 0.046) / 0.018) ** 2) - ((y - 0.084) / 0.02) ** 2) * (0.5 + 0.5 * g);
      skinColor(c, v.p, kk, v.c);
      // 头皮：头发底下 / 秃顶剩下的一圈
      const hl = hairline(th);
      if (hair && y > hl) v.c.lerp(hair, 0.8).multiplyScalar(0.7);
      else if (fringe && y > hl - 0.004 && y < 0.2 && Math.abs(th - Math.PI) < 2.2) v.c.lerp(fringe, 0.55 * smooth(hl - 0.004, hl + 0.01, y));
      // 眼窝、嘴、嘴唇、烂掉的鼻子
      const es = socket(ax, y) * front;
      v.c.lerp(SOCKET, (live ? 0.24 : 0.4 + 0.5 * c.gore) * smooth(0.06, 0.55, es));
      // 嘴唇（发乌）、嘴里（黑）
      const lip = Math.exp(-((x / 0.032) ** 2) - ((y - ym) / (mo + 0.011)) ** 2) * front;
      if (live) v.c.lerp(LIP_LIVE, 0.26 * smooth(0.45, 0.8, lip));
      else v.c.lerp(LIP, (0.25 + 0.3 * c.gore) * smooth(0.35, 0.7, lip));
      // 活人的嘴闭着：只有两片嘴唇之间的一道线
      if (live) v.c.lerp(MOUTH, 0.5 * bell(y, 0.071, 0.0042) * smooth(mw * 1.0, mw * 0.6, ax) * front);
      else v.c.lerp(MOUTH, (0.3 + 0.7 * c.gore) * smooth(0.3, 0.75, mouthPit(x, y) * front));
      if (L.noNose) v.c.lerp(MOUTH, 0.9 * smooth(0.3, 0.7, Math.exp(-((x / 0.013) ** 2) - ((y - 0.112) / 0.017) ** 2) * front));
      // 嘴边、下巴上的血，一直流到脖子
      const bm = c.gore * smooth(0.3, 0.6, noise(v.p.x * 30 + c.seed, v.p.y * 18, v.p.z * 30)) * Math.exp(-((x / 0.04) ** 2)) * smooth(0.105, 0.075, y) * smooth(-0.07, 0.0, y) * front * (0.35 + 0.65 * clamp01(L.jaw)) * (1 - mouthPit(x, y));
      v.c.lerp(BLOOD_FRESH, 0.92 * bm);
      // 头上的伤
      const gash = c.gore * smooth(0.74, 0.8, noise(v.p.x * 16 + c.seed * 2.3, v.p.y * 16, v.p.z * 16 + 9)) * smooth(0.11, 0.16, y);
      v.c.lerp(BLOOD, 0.85 * gash);
      // 头套：除了眼睛那一条，整个头和脖子都是布
      if (c.mask) {
        clothColor(c, c.mask, v.p, kk * (1 - 0.25 * smooth(0.3, 0.75, mouthPit(x, y) * front)), _mask);
        v.c.lerp(_mask, 1 - slit(ax, y) * front);
      }
      v.blend(B.chest, B.head, smooth(-0.05, 0.03, y));
    },
    { capB: true },
  );

  // 耳朵：一片斜着贴在头两侧的耳廓，后缘翘出来
  section(0.139);
  const earX = sec.a;
  for (const sd of [-1, 1]) {
    const p = new Vector3(sd * (earX + 0.0035), 0.139, sec.cz - 0.004).add(O);
    loft.blob(
      p,
      new Vector3(0.0042 * sd, 0, 0.001),
      new Vector3(-0.0055 * sd, 0, 0.0125),
      new Vector3(0.0035 * sd, 0.027, -0.003),
      (v) => {
        skinColor(c, v.p, 0.8, v.c);
        if (c.mask) clothColor(c, c.mask, v.p, 0.9, v.c);
        v.bone(B.head);
      },
      5,
      8,
    );
  }

  // 头发：贴着颅骨的一层，沿发际线收边（绕过耳朵）；长发从耳后垂到肩上；掉了头发的地方露出头皮
  if (hair) {
    const long = L.hairStyle === 'long';
    const HY = [0.2538, 0.2495, 0.241, 0.226, 0.204, 0.18, 0.156, 0.132, 0.108, 0.084, 0.06];
    if (long) HY.push(0.03, 0.0, -0.035, -0.07);
    const SEG = 24;
    loft.tube(
      HY.length,
      SEG,
      (i, k, v) => {
        const y = HY[i] as number;
        const phi = (k / SEG) * TAU;
        const th = phi - 0.3 * Math.sin(phi);
        const at = Math.abs(th > Math.PI ? th - TAU : th);
        const hl = hairline(th);
        // 掉光了的几块（头顶不掉：那里一掉就戳出一个尖）
        const bald = smooth(0.76, 0.84, noise(Math.sin(th) * 2.6 + c.seed * 1.9, y * 14, Math.cos(th) * 2.6)) * smooth(0.244, 0.22, y);
        const tuft = 0.007 + 0.007 * noise(Math.sin(th) * 5 + c.seed, y * 22, Math.cos(th) * 5);
        const hang = long && at > 1.3;
        let k2 = 1;
        if (y >= hl || !hang) {
          const yy = Math.max(y, hl);
          const d = lerp(0.0015, tuft, smooth(hl, hl + 0.02, y)) * (1 - 0.9 * bald);
          skull(th, yy, d, false, local);
          // 头顶的头发往上也有厚度
          local.y += d * smooth(0.19, 0.25, yy);
          if (y < hl) k2 = 0.7;
        } else {
          // 垂下来的头发：贴着后脑勺和脖子往下，越往下越往外散，发梢参差
          skull(th, Math.max(y, 0.05), 0.012, false, local);
          const fall = smooth(0.06, -0.07, y);
          const spread = 1 + 0.36 * fall + 0.07 * noise(Math.sin(th) * 4 + c.seed, 3, Math.cos(th) * 4);
          local.x *= spread;
          local.z = sec.cz + (local.z - sec.cz) * (spread + 0.12 * fall);
          local.y = y + 0.025 * noise(Math.sin(th) * 6 + c.seed, 1, Math.cos(th) * 6) * fall;
          k2 = 0.95 - 0.22 * fall;
        }
        v.p.copy(local).add(O);
        // 一绺一绺的明暗
        const streak = 0.72 + 0.5 * noise(Math.sin(th) * 9 + c.seed, y * 3, Math.cos(th) * 9);
        clothColor(c, hair, v.p, 1.25 * streak * k2, v.c);
        if (bald > 0.5 && y >= hl) skinColor(c, v.p, 0.8, v.c).lerp(BLOOD, 0.55 * c.gore);
        v.bone(B.head);
      },
      { capA: true, capB: long },
    );
  }

  // 锚点：眼睛、嘴
  const eye = (s: number): Vector3 => {
    section(0.147);
    const x = 0.032;
    const z = sec.bf * (1 - (x / sec.a) ** sec.n) ** (1 / sec.n) + sec.cz;
    return new Vector3(s * x, 0.146, z - 0.0145).add(O);
  };
  section(ym);
  // 牙：上排挂在上嘴唇底下，下排立在掉下去的下嘴唇上
  const yBot = yTop - 2 * mo - jawDrop(yTop - 2 * mo, 0.05);
  return {
    eyes: [eye(1), eye(-1)],
    eyeR: 0.0092,
    mouth: new Vector3(0, (yTop + yBot) / 2, sec.cz + sec.bf - 0.0065).add(O),
    mouthW: mw * 0.84,
    mouthH: (yTop - yBot) / 2,
    top: O.y + 0.256,
    at: (th, y, lift, out, plain = false) => skull(th, y, lift, !plain, out).add(O),
    ear: new Vector3(earX + 0.0035, 0.139, -0.016).add(O),
  };
}

