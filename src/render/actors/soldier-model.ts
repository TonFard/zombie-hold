import { Color, Vector3, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Builder, type Built, type Style, type Xf } from '../kit';
import { buildBody, type LimbAt } from './body-mesh';
import { clothColor, type Look } from './body-paint';
import { Loft, Vert, bell, clamp01, fbm, lerp, smooth, table } from './loft';
import { B, HUMAN, makeJoints, type Joints } from './rig';

/**
 * 对战里士兵的模型（只管长什么样，不管动作）：身体和僵尸是同一套放样出来的蒙皮网格（活人的配色：没有尸斑和血），
 * 穿迷彩作战服、高帮作战靴。身上的装具分两种做法：
 *   - 贴着身体的软东西（插板背心、腰带、护膝护肘、裤兜、头盔、围巾、风镜）也是放样出来的，
 *     表面是「身体那里的表面再往外抬一截」，骨头权重照抄下面的衣服，弯腰抬腿的时候跟着一起动、不会穿帮；
 *   - 硬的小件（弹匣包、电台、背包、枪套、头盔上的导轨和夜视仪座）用 kit 的 Builder 拼。
 * 四套外观是四个不同的人（脸 / 头套 / 眼镜、体型、背的东西、胸前挂的东西各不一样），按队伍上色（蓝 / 红）。
 * 动作、手里的枪、倒地在 soldiers.ts。
 */

const TAU = Math.PI * 2;
const PI = Math.PI;
const wrap = (th: number): number => {
  let t = th % TAU;
  if (t > PI) t -= TAU;
  if (t < -PI) t += TAU;
  return t;
};

const matte = (color: number, o: Partial<Style> = {}): Style => ({ color, jitter: 0.07, ao: 0.22, aoH: 1.2, ...o });
const metal = (color: number, o: Partial<Style> = {}): Style => ({ color, mat: 'metal', jitter: 0.06, ao: 0.15, aoH: 1.2, ...o });
const glow = (color: number, k = 1.35): Style => ({ color, mat: 'glow', glow: k });

/**
 * 两队的配色。蓝队：深蓝灰的城市迷彩 + 黑色装具；红队：卡其色的沙漠迷彩 + 狼棕色装具。
 * accent = 围巾、臂章底板这些布的颜色（不发光）；band = 发光的队标（臂章、盔后的识别灯），黄昏里远处也认得出
 */
const TEAM = [
  { top: 0x3b4d64, pants: 0x2f3c4d, camoDark: 0x1c2532, camoLight: 0x667a92, gear: 0x1a1f27, pouch: 0x222933, web: 0x2d3641, helmet: 0x262f3b, boot: 0x17181b, glove: 0x1b1d21, pad: 0x121519, accent: 0x2a5687, band: 0x4aa8ff },
  { top: 0x8c7551, pants: 0x756140, camoDark: 0x523f2b, camoLight: 0xb09a72, gear: 0x48392a, pouch: 0x554430, web: 0x66543b, helmet: 0x5b4b33, boot: 0x4f3e2b, glove: 0x3b3023, pad: 0x2e251b, accent: 0x8c3528, band: 0xff5a3a },
] as const;
type Team = (typeof TEAM)[number];

/** 四套外观：四个不同的人 */
interface Kit {
  skin: number;
  hair: number;
  /** 体型：躯干宽、厚，四肢粗细 */
  bulk: number;
  depth: number;
  limb: number;
  /** 头套：none 露脸；dark 黑头套；team 和作战服一个色的面巾 */
  mask: 'none' | 'dark' | 'team';
  /** 眼睛上戴的：none / 射击眼镜 / 风镜 */
  eyewear: 'none' | 'glasses' | 'goggles';
  /** 风镜推在头盔上 */
  parked: boolean;
  /** 头盔套着迷彩盔罩（不然是素色的盔壳） */
  cover: boolean;
  /** 夜视仪翻在头盔上 */
  nvg: boolean;
  headset: boolean;
  /** 袖子卷到肘 */
  rolled: boolean;
  scarf: boolean;
  /** 背上：突击包 / 大背囊 / 水袋 / 电台 */
  pack: 'assault' | 'ruck' | 'hydro' | 'radio';
  /** 胸前：三联弹匣包 / 两个弹箱包 / 弹匣包 + 手雷包 / 四联 */
  front: 'mags' | 'boxes' | 'nade' | 'quad';
  /** 护膝：2 = 两边，1 = 只有右膝（跪姿射击的那条腿） */
  knees: 0 | 1 | 2;
  elbows: boolean;
}

const KITS: readonly Kit[] = [
  { skin: 0xc9a07e, hair: 0x3a2a1c, bulk: 1.06, depth: 1.05, limb: 1.1, mask: 'none', eyewear: 'none', parked: true, cover: true, nvg: false, headset: true, rolled: false, scarf: false, pack: 'assault', front: 'mags', knees: 2, elbows: false },
  { skin: 0x8a5c40, hair: 0x18120e, bulk: 1.14, depth: 1.1, limb: 1.19, mask: 'none', eyewear: 'glasses', parked: false, cover: false, nvg: false, headset: false, rolled: true, scarf: true, pack: 'ruck', front: 'boxes', knees: 1, elbows: false },
  { skin: 0xb88a68, hair: 0x2a2018, bulk: 1.0, depth: 1.02, limb: 1.05, mask: 'dark', eyewear: 'goggles', parked: false, cover: true, nvg: false, headset: true, rolled: false, scarf: false, pack: 'hydro', front: 'nade', knees: 2, elbows: true },
  { skin: 0xd2ab8a, hair: 0x4a3a28, bulk: 1.09, depth: 1.06, limb: 1.13, mask: 'team', eyewear: 'none', parked: false, cover: false, nvg: true, headset: true, rolled: false, scarf: true, pack: 'radio', front: 'quad', knees: 2, elbows: true },
];
export const SOLDIER_VARIANTS = KITS.length;

const J = makeJoints(HUMAN);
const cache = new Map<string, Built>();
const _p = new Vector3();
const _q = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _c = new Color();

function soldierLook(team: 0 | 1, variant: number): Look {
  const T = TEAM[team] as Team;
  const K = KITS[variant % KITS.length] as Kit;
  const L: Look = {
    skin: K.skin,
    shirt: T.top,
    accent: T.top,
    pants: T.pants,
    shoe: T.boot,
    hair: K.mask === 'none' ? K.hair : null,
    hairStyle: 'short',
    eyes: 0,
    eyeGlow: 0,
    bulk: K.bulk,
    depth: K.depth,
    limb: K.limb,
    outfit: 'combat',
    sleeves: 'long',
    // 长袖的袖口压在手套上（不露手腕）
    sleeveEnd: K.rolled ? 1.08 : 1.96,
    missingArm: 0,
    wounds: 0,
    gaunt: false,
    jaw: 0,
    noNose: false,
    female: false,
    legs: 'long',
    clean: true,
    gloves: true,
    gloveColor: T.glove,
    fist: 0.6,
    boots: true,
    camo: { dark: T.camoDark, light: T.camoLight },
  };
  if (K.mask === 'dark') L.mask = 0x1b1d21;
  else if (K.mask === 'team') L.mask = team === 0 ? 0x34404e : 0x6f5d42;
  return L;
}

// ------------------------------------------------------------------------------------------ 放样的小工具

/** 装具的颜色：底色 × 亮度，越靠近地面越暗，带一点细的明暗（和身体上色是一个路数） */
function tint(base: Color, p: Vector3, k: number, out: Color): Color {
  const t = clamp01(p.y / 1.4);
  return out.copy(base).multiplyScalar(k * (1 - 0.3 * (1 - t) * (1 - t)) * (1 + 0.09 * fbm(p.x * 22, p.y * 22, p.z * 22)));
}

type ShellAt = (u: number, th: number, outer: boolean, v: Vert) => void;
type ShellPaint = (u: number, th: number, v: Vert, k: number) => void;

/**
 * 绕一圈的壳（背心、腰带、头盔、绑带）：us = 从下沿到上沿的位置（0–1），下沿和上沿各多一圈贴着里面的表面（看得出厚度）。
 * cap = 顶上封口（头盔），这时没有上沿那一圈
 */
function shell(loft: Loft, segs: number, us: readonly number[], at: ShellAt, paint: ShellPaint, cap = false): void {
  const n = us.length + (cap ? 1 : 2);
  loft.tube(
    n,
    segs,
    (i, k, v) => {
      const th = (k / segs) * TAU;
      const edge = i === 0 || (!cap && i === n - 1);
      const u = us[Math.min(us.length - 1, Math.max(0, i - 1))] as number;
      at(u, th, !edge, v);
      paint(u, th, v, edge ? 0.55 : 1);
    },
    cap ? { capB: true } : {},
  );
}

/** 垫子的截面怎么分：边上一小截是斜下去的棱，中间是平的 */
const PAD_K = [0, 0.07, 0.25, 0.5, 0.75, 0.93, 1];

/**
 * 贴在肢体（或头）表面的一块垫子（护膝、护肘、裤兜、风镜）：s0–s1 × th0–th1 这一片往外鼓 thick。
 * 背面只有三个顶点（藏在肢体里面，看不见）：这样一圈里朝外的面占多数，放样判断朝向不会错
 */
function pad(loft: Loft, at: LimbAt, s0: number, s1: number, th0: number, th1: number, thick: number, paint: (ks: number, kt: number, v: Vert) => void, rows: readonly number[] = PAD_K, cols: readonly number[] = PAD_K): void {
  const nT = cols.length;
  const INNER = [1, 0.5, 0];
  loft.tube(
    rows.length,
    nT + INNER.length,
    (i, k, v) => {
      const ks = rows[i] as number;
      const outer = k < nT;
      const kt = outer ? (cols[k] as number) : (INNER[k - nT] as number);
      const rim = ks <= 0 || ks >= 1 || kt <= 0 || kt >= 1;
      at(lerp(s0, s1, ks), lerp(th0, th1, kt), outer ? (rim ? 0.002 : thick) : -0.012, v);
      paint(ks, kt, v);
    },
    { capA: true, capB: true },
  );
}

/** 绕肢体一圈的带子 */
function strap(loft: Loft, at: LimbAt, s0: number, s1: number, lift: number, color: Color, segs = 12): void {
  shell(
    loft,
    segs,
    [0, 1],
    (u, th, outer, v) => at(lerp(s0, s1, u), th, outer ? lift : 0.001, v),
    (_u, _th, v, k) => {
      tint(color, v.p, k, v.c);
    },
  );
}

/** kit 的 Builder 拼出来的东西没有索引：补一份顺序索引，才能和放样的几何体并在一起 */
function indexed(g: BufferGeometry): BufferGeometry {
  const n = g.getAttribute('position').count;
  const idx = new Array<number>(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  g.setIndex(idx);
  return g;
}

function join(list: Array<BufferGeometry | null>): BufferGeometry | null {
  const gs = list.filter((g): g is BufferGeometry => !!g);
  if (!gs.length) return null;
  if (gs.length === 1) return gs[0] as BufferGeometry;
  const out = mergeGeometries(gs, false);
  for (const g of gs) g.dispose();
  return out;
}

/** 挂在躯干上的硬件：骨头权重按高度重写成和衣服一样的（腰以下跟胯、往上跟胸），弯腰时贴着背心不分家 */
function followTorso(g: BufferGeometry | null, weight: (v: Vert) => void): void {
  if (!g) return;
  const pos = g.getAttribute('position');
  const si = g.getAttribute('skinIndex');
  const sw = g.getAttribute('skinWeight');
  const v = new Vert();
  for (let i = 0; i < pos.count; i++) {
    v.p.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    weight(v);
    si.setXYZW(i, v.b[0], v.b[1], v.b[2], v.b[3]);
    sw.setXYZW(i, v.w[0], v.w[1], v.w[2], v.w[3]);
  }
}

// ------------------------------------------------------------------------------------------ 一个士兵

export function soldierGeometry(team: 0 | 1, variant: number): Built {
  const key = `${team}:${variant}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const T = TEAM[team] as Team;
  const K = KITS[variant % KITS.length] as Kit;
  const body = buildBody(J, soldierLook(team, variant), 300 + team * 17 + variant * 5);
  const { torso, ctx } = body;
  const H = body.head;
  /** 放样的装具 */
  const gear = new Loft();
  /** 挂在躯干上的硬件（权重最后按躯干重写）、别处的硬件（各绑一根骨头） */
  const tb = new Builder(true);
  const b = new Builder(true);

  const cGear = new Color(T.gear);
  const cWeb = new Color(T.web);
  const cPad = new Color(T.pad);
  const cAccent = new Color(T.accent);
  const cHelmet = new Color(K.cover ? T.helmet : T.gear).multiplyScalar(K.cover ? 1 : 1.25);
  const sGear = matte(T.gear);
  const sPouch = matte(T.pouch);
  const sWeb = matte(T.web, { jitter: 0.04 });
  const sDark = matte(0x121416, { jitter: 0.05, ao: 0 });
  const sBand = glow(T.band);
  const sGun = metal(0x1a1c1f, { ao: 0 });

  // ---------------------------------------------------------------- 插板背心
  const VEST_TOP_F = 1.398;
  const VEST_TOP_B = 1.412;
  const VEST_TOP_S = 1.215;
  /** 前后两块插板的范围：1 = 插板，0 = 两侧的腰封 */
  const plate = (a: number): number => Math.max(smooth(0.98, 0.7, a), smooth(PI - 0.98, PI - 0.7, a));
  const vTop = (a: number): number => VEST_TOP_S + (VEST_TOP_F - VEST_TOP_S) * smooth(1.02, 0.74, a) + (VEST_TOP_B - VEST_TOP_S) * smooth(PI - 1.02, PI - 0.74, a);
  const vBot = (a: number): number => 1.082 - 0.014 * plate(a);
  /** 背心外表面上的点（再往外 extra）：插板那一块比胸廓平 */
  const vest = (th: number, y: number, extra: number, out: Vector3): Vector3 => {
    const a = Math.abs(wrap(th));
    const pl = plate(a);
    const lift = lerp(0.011, 0.023, pl) + extra;
    torso.at(th, y, lift, out);
    if (pl > 0) {
      const front = a < PI / 2;
      const zc = torso.at(front ? 0 : PI, y, lift, _q).z;
      const flat = front ? zc - 0.8 * out.x * out.x : zc + 0.8 * out.x * out.x;
      out.z = lerp(out.z, front ? Math.max(out.z, flat) : Math.min(out.z, flat), pl);
    }
    return out;
  };
  shell(
    gear,
    32,
    [0, 0.12, 0.26, 0.4, 0.54, 0.68, 0.82, 0.93, 1],
    (u, th, outer, v) => {
      const a = Math.abs(wrap(th));
      const y = lerp(vBot(a), vTop(a), u);
      if (outer) vest(th, y, 0, v.p);
      else torso.at(th, y, 0.002, v.p);
      torso.weight(v);
    },
    (u, th, v, k) => {
      const pl = plate(Math.abs(wrap(th)));
      // 插板和腰封接缝的地方暗一道；腰封是织带的颜色
      const seam = 1 - 0.3 * bell(pl, 0.5, 0.22);
      tint(_c.copy(cWeb).lerp(cGear, smooth(0.3, 0.7, pl)), v.p, k * seam * (1 - 0.12 * smooth(0.25, 0, u)), v.c);
    },
  );
  // 肩带：从前插板的上角翻过肩膀接到后插板
  for (const sg of [1, -1]) {
    const pts = [
      vest(sg * 0.5, 1.365, 0.004, new Vector3()),
      torso.at(sg * 0.6, 1.418, 0.014, new Vector3()),
      torso.at(sg * 0.9, 1.45, 0.012, new Vector3()),
      torso.at(sg * (PI / 2), 1.464, 0.012, new Vector3()),
      torso.at(sg * (PI - 0.9), 1.45, 0.012, new Vector3()),
      torso.at(sg * (PI - 0.6), 1.42, 0.014, new Vector3()),
      vest(sg * (PI - 0.5), 1.375, 0.004, new Vector3()),
    ];
    gear.pipe(pts, () => [0.027, 0.0075], 6, new Vector3(1, 0, 0), (_i, k, v) => {
      // 肩带中间一条缝线
      tint(cGear, v.p, k === 1 || k === 2 ? 1.12 : 0.92, v.c);
      torso.weight(v);
    });
  }

  /** 背心表面上的一个安装位：原点在表面上，+Z 朝外，+X 沿着表面 */
  const onVest = (th: number, y: number, extra = 0): Xf => {
    vest(th - 0.04, y, extra, _a);
    vest(th + 0.04, y, extra, _b);
    vest(th, y, extra, _p);
    return { x: _p.x, y: _p.y, z: _p.z, ry: Math.atan2(-(_b.z - _a.z), _b.x - _a.x) };
  };
  /** 躯干（衣服 / 腰带）表面上的安装位 */
  const onTorso = (th: number, y: number, lift: number): Xf => {
    torso.at(th - 0.04, y, lift, _a);
    torso.at(th + 0.04, y, lift, _b);
    torso.at(th, y, lift, _p);
    return { x: _p.x, y: _p.y, z: _p.z, ry: Math.atan2(-(_b.z - _a.z), _b.x - _a.x) };
  };

  // 织带（MOLLE）：后插板五道、两侧腰封各三道、前插板弹匣包上面一道
  for (const y of [1.12, 1.17, 1.22, 1.27, 1.32]) tb.push(onVest(PI, y)).box(0.21, 0.02, 0.005, { z: -0.001 }, sWeb).pop();
  for (const sg of [1, -1]) for (const y of [1.1, 1.145, 1.19]) tb.push(onVest(sg * (PI / 2), y)).box(0.105, 0.02, 0.005, { z: -0.001 }, sGear).pop();
  tb.push(onVest(0, 1.222)).box(0.22, 0.02, 0.005, { z: -0.001 }, sWeb).pop();

  // ---- 胸前挂的东西 ----
  /** 开口的弹匣包：露出弹匣的顶，一根弹力绳勒着 */
  const magPouch = (th: number, w: number): void => {
    tb.push(onVest(th, 1.078));
    tb.box(w, 0.1, 0.034, { z: 0.015 }, sPouch);
    tb.box(w * 0.78, 0.036, 0.02, { y: 0.094, z: 0.016 }, sGun);
    tb.box(0.007, 0.045, 0.03, { y: 0.09, z: 0.016 }, sDark);
    tb.box(w + 0.004, 0.012, 0.037, { y: 0.03, z: 0.015 }, sWeb);
    tb.pop();
  };
  if (K.front === 'mags' || K.front === 'nade') for (const th of [-0.45, 0, 0.45]) magPouch(th, 0.066);
  else if (K.front === 'quad') for (const th of [-0.62, -0.21, 0.21, 0.62]) magPouch(th, 0.058);
  else {
    // 机枪手：两个装弹链的大包，中间一个杂物包
    for (const th of [-0.5, 0.5]) {
      tb.push(onVest(th, 1.07));
      tb.rbox(0.092, 0.118, 0.055, 0.012, { z: 0.024 }, sPouch);
      tb.box(0.096, 0.034, 0.059, { y: 0.09, z: 0.024 }, sGear);
      tb.box(0.02, 0.022, 0.008, { y: 0.086, z: 0.056 }, sDark);
      tb.pop();
    }
    tb.push(onVest(0, 1.08)).box(0.05, 0.085, 0.03, { z: 0.013 }, sGear).pop();
  }
  if (K.front === 'nade') {
    // 腰封左前挂一个手雷包
    tb.push(onVest(0.92, 1.085));
    tb.cyl(0.027, 0.03, 0.075, 8, { z: 0.026 }, sPouch);
    tb.cyl(0.012, 0.014, 0.022, 6, { y: 0.075, z: 0.026 }, sGun);
    tb.pop();
  }
  // 胸口的杂物包 + 队标（发光的小条，贴在魔术贴底板上）
  if (K.front !== 'boxes') {
    tb.push(onVest(0, 1.262));
    tb.box(0.14, 0.078, 0.016, { z: 0.006 }, sPouch);
    tb.box(0.064, 0.03, 0.004, { x: -0.03, y: 0.036, z: 0.016 }, sDark);
    tb.box(0.05, 0.012, 0.004, { x: -0.03, y: 0.045, z: 0.018 }, sBand);
    tb.pop();
  } else {
    tb.push(onVest(-0.3, 1.3));
    tb.box(0.064, 0.03, 0.004, { z: 0.001 }, sDark);
    tb.box(0.05, 0.012, 0.004, { y: 0.009, z: 0.003 }, sBand);
    tb.pop();
    // 左胸一把刀
    tb.push({ ...onVest(0.36, 1.25), rz: 0.5 });
    tb.box(0.03, 0.12, 0.012, { z: 0.005 }, sDark);
    tb.box(0.022, 0.06, 0.016, { y: 0.12, z: 0.006 }, sGun);
    tb.pop();
  }
  // 电台：左肩带下面，天线伸过肩膀；右肩带上一个手咪
  tb.push(onVest(0.66, 1.235));
  tb.box(0.052, 0.112, 0.032, { z: 0.014 }, sDark);
  tb.cyl(0.0045, 0.0045, K.pack === 'radio' ? 0.1 : 0.2, 5, { x: 0.016, y: 0.112, z: 0.018 }, sDark);
  tb.cyl(0.008, 0.008, 0.016, 6, { x: -0.014, y: 0.112, z: 0.018 }, sDark);
  tb.pop();
  tb.push(onVest(-0.55, 1.335)).box(0.034, 0.05, 0.02, { z: 0.008 }, sDark).pop();

  // ---- 背上背的东西 ----
  if (K.pack === 'assault') {
    tb.push(onVest(PI, 1.085));
    tb.rbox(0.235, 0.31, 0.092, 0.03, { z: 0.042 }, sPouch);
    tb.rbox(0.17, 0.15, 0.04, 0.014, { y: 0.02, z: 0.104 }, sGear);
    tb.box(0.05, 0.014, 0.03, { y: 0.31, z: 0.02 }, sWeb);
    for (const y of [0.2, 0.245]) tb.box(0.15, 0.016, 0.005, { y, z: 0.09 }, sWeb);
    tb.pop();
  } else if (K.pack === 'ruck') {
    tb.push(onVest(PI, 1.03));
    tb.rbox(0.29, 0.4, 0.145, 0.04, { z: 0.066 }, sPouch);
    tb.rbox(0.3, 0.07, 0.155, 0.02, { y: 0.36, z: 0.068 }, sGear);
    for (const sg of [1, -1]) tb.rbox(0.055, 0.18, 0.09, 0.016, { x: sg * 0.165, y: 0.03, z: 0.07 }, sGear);
    // 顶上横捆着一卷防潮垫
    tb.cyl(0.052, 0.052, 0.34, 10, { x: -0.17, y: 0.48, z: 0.07, rz: -PI / 2 }, matte(T.camoLight, { jitter: 0.1 }));
    for (const x of [-0.09, 0.09]) tb.box(0.016, 0.11, 0.112, { x, y: 0.425, z: 0.07 }, sDark);
    tb.box(0.14, 0.11, 0.03, { y: 0.1, z: 0.148 }, sGear);
    tb.pop();
  } else if (K.pack === 'hydro') {
    tb.push(onVest(PI, 1.1));
    tb.rbox(0.14, 0.3, 0.04, 0.016, { z: 0.016 }, sPouch);
    tb.box(0.035, 0.022, 0.02, { y: 0.292, z: 0.012 }, sDark);
    tb.pop();
    // 拖拽提手、从右肩绕到胸前的吸管
    tb.push(onVest(PI, 1.4)).box(0.085, 0.014, 0.022, { y: 0.004, z: 0.006 }, sWeb).pop();
    const a0 = vest(PI + 0.25, 1.38, 0.012, new Vector3());
    const a1 = torso.at(-(PI / 2) - 0.2, 1.47, 0.026, new Vector3());
    const a2 = vest(-0.42, 1.36, 0.014, new Vector3());
    tb.rod([a0.x, a0.y, a0.z], [a1.x, a1.y, a1.z], 0.005, sDark);
    tb.rod([a1.x, a1.y, a1.z], [a2.x, a2.y, a2.z], 0.005, sDark);
  } else {
    // 背负式电台：方盒子 + 一根长鞭状天线 + 旁边一个电池包
    tb.push(onVest(PI, 1.13));
    tb.box(0.2, 0.24, 0.075, { z: 0.034 }, sGear);
    tb.box(0.2, 0.03, 0.079, { y: 0.21, z: 0.034 }, sDark);
    tb.box(0.06, 0.05, 0.012, { x: 0.05, y: 0.12, z: 0.078 }, sDark);
    tb.cyl(0.009, 0.011, 0.03, 6, { x: -0.07, y: 0.24, z: 0.04 }, sDark);
    tb.cyl(0.0035, 0.005, 0.42, 5, { x: -0.07, y: 0.27, z: 0.04, rx: 0.14 }, sDark);
    for (const y of [0.05, 0.16]) tb.box(0.205, 0.016, 0.005, { y, z: 0.074 }, sWeb);
    tb.pop();
  }

  // 背上的队标：一小块魔术贴 + 发光的条（从背后看也分得清是哪一队）
  tb.push(onVest(PI, 1.345, K.pack === 'assault' ? 0.09 : K.pack === 'ruck' ? 0.148 : K.pack === 'hydro' ? 0.038 : 0.076));
  tb.box(0.074, 0.036, 0.004, { z: -0.001 }, sDark);
  tb.box(0.054, 0.014, 0.004, { y: 0.011, z: 0.001 }, sBand);
  tb.pop();

  // ---------------------------------------------------------------- 腰带和腰上的包
  shell(
    gear,
    28,
    [0, 0.5, 1],
    (u, th, outer, v) => {
      torso.at(th, lerp(0.953, 1.0, u), outer ? 0.011 : 0.002, v.p);
      torso.weight(v);
    },
    (_u, _th, v, k) => {
      tint(cGear, v.p, k * 0.95, v.c);
    },
  );
  tb.push(onTorso(0, 0.958, 0.011)).box(0.05, 0.04, 0.008, { z: 0.002 }, sGun).pop();
  // 左后腰的回收袋、后腰的急救包、右前腰两个手枪弹匣
  tb.push(onTorso(2.05, 0.845, 0.006)).rbox(0.1, 0.125, 0.05, 0.016, { z: 0.02 }, sPouch).pop();
  tb.push(onTorso(PI + 0.55, 0.9, 0.006));
  tb.box(0.105, 0.085, 0.048, { z: 0.02 }, sPouch);
  tb.box(0.03, 0.03, 0.004, { y: 0.03, z: 0.045 }, matte(0x8a2a22, { jitter: 0, ao: 0 }));
  tb.pop();
  for (const th of [-0.62, -0.9]) tb.push(onTorso(th, 0.925, 0.008)).box(0.028, 0.075, 0.02, { z: 0.008 }, sDark).pop();

  // ---------------------------------------------------------------- 围巾（队伍的颜色，围在领口，前面垂下来一个角）
  if (K.scarf) {
    const SC: ReadonlyArray<readonly [number, number]> = [
      [1.468, 0.01],
      [1.482, 0.024],
      [1.497, 0.03],
      [1.511, 0.024],
      [1.52, 0.008],
    ];
    gear.tube(
      SC.length,
      20,
      (i, k, v) => {
        const th = (k / 20) * TAU;
        const a = Math.abs(wrap(th));
        const row = SC[i] as readonly [number, number];
        // 前面垂下来的那个角：越往下越垂得多
        const drape = 0.05 * smooth(0.6, 0, a) * (1 - i / (SC.length - 1)) ** 1.5;
        const fold = 0.006 * fbm(Math.sin(th) * 4 + team, i * 1.7, Math.cos(th) * 4);
        torso.at(th, row[0] - drape, row[1] + fold + 0.008 * smooth(0.6, 0, a) * (drape > 0.01 ? 1 : 0), v.p);
        tint(cAccent, v.p, 0.82 + 0.3 * fbm(Math.sin(th) * 7, i * 2.3 + 1, Math.cos(th) * 7), v.c);
        torso.weight(v);
      },
      { capB: false },
    );
  }

  // ---------------------------------------------------------------- 胳膊：臂章、护肘
  const tv = new Vert();
  for (const side of [0, 1] as const) {
    const at = body.arm[side];
    const out = side === 0 ? PI / 2 : -PI / 2;
    const sg = side === 0 ? 1 : -1;
    // 臂章：魔术贴底板 + 发光的队标
    at(0.37, out, 0.004, tv);
    b.bone(side === 0 ? B.armUL : B.armUR);
    b.box(0.006, 0.064, 0.07, { x: tv.p.x - sg * 0.002, y: tv.p.y - 0.032, z: tv.p.z }, sDark);
    b.box(0.006, 0.03, 0.05, { x: tv.p.x + sg * 0.002, y: tv.p.y - 0.008, z: tv.p.z }, sBand);
    if (K.elbows) {
      pad(gear, at, 0.87, 1.15, PI - 1.2, PI + 1.2, 0.013, (ks, kt, v) => {
        const hard = smooth(0.1, 0.24, ks) * smooth(0.9, 0.76, ks) * smooth(0.1, 0.24, kt) * smooth(0.9, 0.76, kt);
        tint(_c.copy(cWeb).lerp(cPad, hard), v.p, 1, v.c);
      });
      strap(gear, at, 0.9, 0.95, 0.005, cGear, 10);
      strap(gear, at, 1.08, 1.13, 0.005, cGear, 10);
    }
  }

  // ---------------------------------------------------------------- 腿：裤兜、护膝、枪套
  for (const side of [0, 1] as const) {
    const at = body.leg[side];
    const out = side === 0 ? PI / 2 : -PI / 2;
    // 大腿外侧的裤兜（和裤子一个迷彩），上面三分之一是兜盖
    pad(
      gear,
      at,
      0.27,
      0.68,
      out - 0.7,
      out + 0.7,
      0.013,
      (ks, _kt, v) => {
        clothColor(ctx, ctx.pants, v.p, ks > 0.3 && ks < 0.36 ? 0.62 : ks <= 0.3 ? 1.06 : 0.97, v.c);
      },
      [0, 0.06, 0.3, 0.33, 0.36, 0.65, 0.94, 1],
    );
    if (K.knees === 2 || (K.knees === 1 && side === 1)) {
      // 护膝：中间一块硬壳，周围是软垫；上下各一根绑带
      pad(
        gear,
        at,
        0.87,
        1.14,
        -1.2,
        1.2,
        0.017,
        (ks, kt, v) => {
          const hard = smooth(0.12, 0.26, ks) * smooth(0.88, 0.74, ks) * smooth(0.14, 0.28, kt) * smooth(0.86, 0.72, kt);
          tint(_c.copy(cWeb).lerp(cPad, hard), v.p, 1 + 0.25 * hard * bell(ks, 0.4, 0.2), v.c);
        },
        [0, 0.07, 0.22, 0.38, 0.55, 0.75, 0.93, 1],
      );
      strap(gear, at, 0.9, 0.95, 0.005, cGear);
      strap(gear, at, 1.07, 1.12, 0.005, cGear);
    }
  }
  // 右腿的快拔枪套：腿板挂在腰带上，两根带子勒着大腿
  {
    const at = body.leg[1];
    strap(gear, at, 0.3, 0.35, 0.005, cGear);
    strap(gear, at, 0.47, 0.52, 0.005, cGear);
    at(0.4, -PI / 2, 0.006, tv);
    b.bone(B.legUR);
    b.push({ x: tv.p.x, y: tv.p.y, z: tv.p.z + 0.004, ry: -PI / 2 });
    b.box(0.095, 0.15, 0.012, { y: -0.07, z: 0.004 }, sGear);
    b.box(0.035, 0.11, 0.008, { y: 0.07, z: 0.002 }, sGear);
    b.box(0.058, 0.135, 0.034, { x: 0.006, y: -0.07, z: 0.026 }, sDark);
    // 露在外面的握把和套筒尾
    b.box(0.034, 0.03, 0.03, { x: 0.012, y: 0.065, z: 0.026 }, sGun);
    b.box(0.03, 0.075, 0.026, { x: -0.014, y: 0.05, z: 0.026, rz: -0.3 }, sGun);
    b.pop();
  }

  // ---------------------------------------------------------------- 头盔
  /** 盔沿的高度（离脖子根）：前面压在眉毛上，耳朵上面切上去（给耳机让位），后面盖住后脑勺 */
  const RIM: ReadonlyArray<readonly number[]> = [
    [0, 0.181],
    [0.75, 0.18],
    [1.12, 0.176],
    [1.38, 0.183],
    [1.62, 0.192],
    [1.9, 0.18],
    [2.25, 0.15],
    [2.7, 0.131],
    [3.15, 0.127],
  ];
  const rim = (th: number): number => table(RIM, 1, Math.abs(wrap(th)));
  /** 盔壳外表面离颅骨多远、盔顶比头顶高多少 */
  const SHELL = 0.019;
  const RISE = 0.012;
  const CROWN = 0.2536;
  /** 头盔上的点：u = 0 盔沿，1 盔顶；extra = 在盔壳外表面的基础上再往外多少 */
  const helm = (th: number, u: number, extra: number, out: Vector3): Vector3 => {
    const r = rim(th);
    const ys = lerp(r, CROWN, 1 - (1 - u) ** 1.35);
    // 前额那里的盔壳比颅骨直一点（不是一个圆球扣在头上）
    const a = Math.abs(wrap(th));
    H.at(th, ys, SHELL + extra + 0.004 * smooth(1.0, 0.3, a) * smooth(0.5, 0.1, u), out, true);
    out.y = J.head[1] + r + (ys - r) * (1 + RISE / (CROWN - r));
    return out;
  };
  shell(
    gear,
    32,
    [0, 0.08, 0.2, 0.34, 0.48, 0.62, 0.75, 0.86, 0.94, 1],
    (u, th, outer, v) => {
      if (outer) helm(th, u, 0, v.p);
      else H.at(th, rim(th) + 0.002, 0.003, v.p, true).setY(J.head[1] + rim(th) + 0.002);
      v.bone(B.head);
    },
    (u, th, v, k) => {
      // 盔罩是迷彩布；素盔是哑光的漆。盔沿包着一圈边
      if (K.cover) clothColor(ctx, ctx.top, v.p, 0.92 * k, v.c).lerp(cHelmet, 0.25);
      else tint(cHelmet, v.p, k, v.c);
      v.c.multiplyScalar(1 - 0.3 * smooth(0.05, 0, u));
      void th;
    },
    true,
  );
  /** 头盔表面上的安装位 */
  const onHelm = (th: number, u: number, extra = 0): Xf => {
    helm(th - 0.05, u, extra, _a);
    helm(th + 0.05, u, extra, _b);
    helm(th, u, extra, _p);
    return { x: _p.x, y: _p.y, z: _p.z, ry: Math.atan2(-(_b.z - _a.z), _b.x - _a.x) };
  };
  b.bone(B.head);
  // 夜视仪座、两侧的导轨、盔后的识别灯（队标）
  b.push(onHelm(0, 0.2)).box(0.038, 0.036, 0.009, { y: -0.012, z: 0.001 }, sDark).box(0.02, 0.014, 0.012, { y: -0.004, z: 0.006 }, sGun).pop();
  for (const sg of [1, -1]) {
    b.push(onHelm(sg * 1.6, 0.13)).box(0.095, 0.014, 0.008, { y: -0.004, z: 0.001 }, sDark).pop();
    // 侧面一小块魔术贴 + 队标
    b.push(onHelm(sg * 1.75, 0.42));
    b.box(0.044, 0.026, 0.004, { z: -0.001 }, sDark);
    b.box(0.03, 0.012, 0.004, { y: 0.007, z: 0.001 }, sBand);
    b.pop();
  }
  b.push(onHelm(PI, 0.5)).box(0.03, 0.016, 0.014, { z: 0.002 }, sBand).pop();
  if (K.nvg || !K.cover) {
    // 盔后的配重 / 电池包
    b.push(onHelm(PI, 0.2)).box(0.07, 0.04, 0.022, { y: -0.01, z: 0.004 }, sPouch).pop();
  }
  if (K.nvg) {
    // 翻上去的双筒夜视仪：支臂 + 两根镜筒，斜着朝上朝前
    b.push({ ...onHelm(0, 0.26), rx: -0.95 });
    b.box(0.016, 0.05, 0.016, { z: 0.012 }, sGun);
    b.box(0.07, 0.022, 0.03, { y: 0.045, z: 0.014 }, sDark);
    for (const x of [-0.019, 0.019]) {
      b.cyl(0.0145, 0.0155, 0.062, 8, { x, y: 0.05, z: 0.014 }, sDark);
      b.cyl(0.011, 0.011, 0.004, 8, { x, y: 0.112, z: 0.014 }, metal(0x1c3a34, { jitter: 0, ao: 0 }));
    }
    b.pop();
  }
  // 下巴带：从耳朵前面的盔沿拉到下巴，下巴上一个托
  for (const sg of [1, -1]) {
    const pts = [H.at(sg * 1.22, 0.172, 0.004, new Vector3()), H.at(sg * 1.08, 0.115, 0.005, new Vector3()), H.at(sg * 0.8, 0.066, 0.005, new Vector3()), H.at(sg * 0.42, 0.04, 0.006, new Vector3()), H.at(0, 0.031, 0.006, new Vector3())];
    gear.pipe(pts, () => [0.0055, 0.003], 5, new Vector3(0, 0.5, 1), (_i, _k, v) => {
      tint(cPad, v.p, 1.3, v.c);
      v.bone(B.head);
    });
  }
  gear.blob(
    H.at(0, 0.033, 0.004, new Vector3()),
    new Vector3(0.021, 0, 0),
    new Vector3(0, 0.011, 0.003),
    new Vector3(0, -0.004, 0.009),
    (v) => {
      tint(cPad, v.p, 1.2, v.c);
      v.bone(B.head);
    },
    4,
    8,
  );

  // ---------------------------------------------------------------- 耳机、话筒
  const ear = H.ear;
  if (K.headset) {
    for (const sg of [1, -1]) {
      gear.blob(
        new Vector3(sg * (ear.x + 0.013), ear.y - 0.003, ear.z),
        new Vector3(0, 0, 0.03),
        new Vector3(0, 0.04, 0),
        new Vector3(sg * 0.021, 0, 0),
        (v) => {
          tint(cPad, v.p, 1.5, v.c);
          v.bone(B.head);
        },
        5,
        10,
      );
      // 挂到导轨上的支臂
      b.box(0.008, 0.035, 0.014, { x: sg * (ear.x + 0.024), y: ear.y + 0.026, z: ear.z }, sDark);
    }
    // 左边伸到嘴角的话筒
    const m0 = new Vector3(ear.x + 0.02, ear.y - 0.03, ear.z + 0.018);
    const m1 = new Vector3(ear.x + 0.006, H.mouth.y + 0.006, H.mouth.z - 0.02);
    const m2 = new Vector3(0.034, H.mouth.y - 0.002, H.mouth.z + 0.022);
    b.rod([m0.x, m0.y, m0.z], [m1.x, m1.y, m1.z], 0.003, sDark);
    b.rod([m1.x, m1.y, m1.z], [m2.x, m2.y, m2.z], 0.003, sDark);
    b.sphere(0.008, 6, 5, { x: m2.x, y: m2.y, z: m2.z }, sDark);
  }

  // ---------------------------------------------------------------- 眼睛、眉毛、眼镜
  const R = H.eyeR;
  const eyesShown = K.eyewear === 'none' || K.parked;
  if (eyesShown) {
    const lid = matte(K.skin, { jitter: 0, ao: 0 });
    const iris = matte(variant % 2 === 0 ? 0x4a3420 : 0x3c4a52, { jitter: 0, ao: 0 });
    for (const e of H.eyes) {
      b.sphere(R * 0.96, 10, 8, { x: e.x, y: e.y, z: e.z - 0.0012 }, matte(0xd6d0c6, { jitter: 0, ao: 0 }));
      b.sphere(R * 0.5, 8, 6, { x: e.x, y: e.y - R * 0.08, z: e.z + R * 0.56 }, iris);
      b.sphere(R * 0.24, 6, 5, { x: e.x, y: e.y - R * 0.08, z: e.z + R * 0.86 }, matte(0x0a0806, { jitter: 0, ao: 0 }));
      // 上下眼皮：把瞪着的眼球盖住一半
      b.sphere(1, 10, 6, { x: e.x, y: e.y + R * 0.62, z: e.z + R * 0.02, sx: R * 1.32, sy: R * 0.8, sz: R * 1.16 }, lid);
      b.sphere(1, 10, 6, { x: e.x, y: e.y - R * 0.82, z: e.z - R * 0.08, sx: R * 1.25, sy: R * 0.6, sz: R * 1.1 }, lid);
    }
    if (K.mask === 'none') {
      // 眉毛：贴着眉弓，内侧低一点
      const brow = matte(K.hair, { jitter: 0, ao: 0 });
      for (const sg of [1, -1]) {
        H.at(sg * 0.47, 0.1672, 0.0006, _p);
        b.box(0.03, 0.0052, 0.006, { x: _p.x, y: _p.y - 0.0026, z: _p.z - 0.002, ry: sg * 0.45, rz: sg * 0.1 }, brow);
      }
    }
  }
  if (K.eyewear === 'glasses') {
    // 射击眼镜：一整片包着眼睛的深色弧形镜片（鼻梁那里下沿抬起来），两根镜腿搭到耳朵上
    const lensLo = new Color(0x0c1014);
    const lensHi = new Color(0x34424e);
    pad(
      gear,
      (s, th, lift, v) => {
        const y = s + (s < 0.142 ? 0.011 * bell(th, 0, 0.13) : 0);
        H.at(th, y, lift, v.p, true);
        v.bone(B.head);
      },
      0.1335,
      0.1625,
      -0.84,
      0.84,
      0.0095,
      (ks, _kt, v) => {
        tint(_c.copy(lensLo).lerp(lensHi, smooth(0.3, 0.9, ks)), v.p, 1, v.c);
        // 上沿一道细框
        if (ks > 0.9) tint(cPad, v.p, 1.2, v.c);
      },
      [0, 0.1, 0.3, 0.55, 0.8, 0.93, 1],
      [0, 0.04, 0.16, 0.3, 0.42, 0.5, 0.58, 0.7, 0.84, 0.96, 1],
    );
    for (const sg of [1, -1]) {
      H.at(sg * 0.84, 0.152, 0.006, _p, true);
      b.rod([_p.x, _p.y, _p.z], [sg * (ear.x + 0.002), ear.y + 0.012, ear.z + 0.004], 0.0028, sDark, 4);
    }
  }
  /** 风镜：一圈软框 + 一整片镜片。onFace = 戴在眼睛上（不然推在头盔上） */
  const goggles = (onFace: boolean): void => {
    const lensLo = new Color(0x10151a);
    const lensHi = new Color(0x3a4a58);
    const paint = (ks: number, kt: number, v: Vert): void => {
      const frame = 1 - smooth(0.1, 0.22, ks) * smooth(0.9, 0.78, ks) * smooth(0.06, 0.14, kt) * smooth(0.94, 0.86, kt);
      // 镜片上亮下暗，像反着天光
      tint(_c.copy(lensLo).lerp(lensHi, smooth(0.35, 0.85, ks)), v.p, 1, v.c).lerp(tint(cPad, v.p, 1.6, _c), frame);
    };
    const cols = [0, 0.05, 0.16, 0.3, 0.44, 0.5, 0.56, 0.7, 0.84, 0.95, 1];
    if (onFace) {
      pad(
        gear,
        (s, th, lift, v) => {
          // 鼻梁那里的下沿抬起来一点
          const y = s + (s < 0.14 ? 0.008 * bell(th, 0, 0.16) : 0);
          H.at(th, y, lift * (1 + 0.25 * bell(th, 0, 0.5)), v.p, true);
          v.bone(B.head);
        },
        0.126,
        0.172,
        -1.02,
        1.02,
        0.017,
        paint,
        PAD_K,
        cols,
      );
    } else {
      pad(
        gear,
        (s, th, lift, v) => {
          helm(th, s, lift, v.p);
          v.bone(B.head);
        },
        0.12,
        0.44,
        -0.88,
        0.88,
        0.02,
        paint,
        PAD_K,
        cols,
      );
    }
    // 松紧带：绕头盔一圈
    const u0 = onFace ? 0.04 : 0.2;
    shell(
      gear,
      24,
      [0, 1],
      (u, th, outer, v) => {
        helm(th, u0 + 0.13 * u, outer ? 0.005 : 0.0005, v.p);
        v.bone(B.head);
      },
      (_u, _th, v, k) => {
        tint(cPad, v.p, 1.5 * k, v.c);
      },
    );
  };
  if (K.eyewear === 'goggles') goggles(true);
  else if (K.parked) goggles(false);

  // ---------------------------------------------------------------- 合起来
  const torsoParts = tb.build();
  for (const g of [torsoParts.matte, torsoParts.metal, torsoParts.glow]) followTorso(g, torso.weight);
  const parts = b.build();
  // 金属的小件（弹匣顶、扣具、枪套里的手枪）也并进哑光那一块：一个士兵只有两个网格（身体 + 发光的队标），
  // 16 个人同屏时少画十几次（每个网格在阴影那一遍里还要再画一次）
  const hard = join([torsoParts.matte, parts.matte, torsoParts.metal, parts.metal]);
  const matteGeo = mergeGeometries([body.geometry, gear.build(), ...(hard ? [indexed(hard)] : [])], false);
  const built: Built = { matte: matteGeo, metal: null, glow: join([torsoParts.glow, parts.glow]) };
  cache.set(key, built);
  return built;
}

/** 不带枪的士兵几何体（给别的场景当玩家角色用，例如雨夜街角） */
export function soldierBody(team: 0 | 1, variant: number): Built {
  return soldierGeometry(team, variant);
}
export const SOLDIER_JOINTS: Joints = J;
