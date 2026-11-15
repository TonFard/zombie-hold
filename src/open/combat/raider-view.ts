import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Sphere,
  Vector3,
  type PerspectiveCamera,
  type Scene,
  type SkinnedMesh,
  type WebGLRenderer,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';
import { buildBody, type Body } from '../../render/actors/body-mesh';
import type { Look } from '../../render/actors/body-paint';
import { startDeath, updateDeath, type DeathState } from '../../render/actors/deaths';
import { B, HUMAN, RigActor, makeJoints } from '../../render/actors/rig';
import { Builder, type Style } from '../../render/kit';
import { worldGun, worldGunCache, type WorldGun } from '../../render/tacz/worldgun';
import { GUN_LIST } from '../game/api';
import type { World } from '../world/world';
import type { Human } from './raider-brain';

/**
 * 带枪的人的样子。身体和据点模式的丧尸 / 对战里的士兵是同一套放样出来的蒙皮网格（render/actors/body-mesh.ts，活人的配色），
 * 上面加帽子、围巾、背包、胸挂这些小件；手里是和玩家一样的 TACZ 枪模（render/tacz/worldgun.ts，一把枪一个合并的网格），
 * 两只手用 IK 够到握把和护木。死的时候用 render/actors/deaths.ts 的倒地动画。
 *
 * 为了不卡：
 *   - 开局把 8 套外观的几何体、18 个人的骨架、18 把枪的模型和贴图全部建好，头几帧放在地底下画一遍（传上显卡、编译着色器），之后只是拿 / 放回；
 *   - 一个人两次绘制：身体（连同身上的小件，一个网格）+ 枪；枪口的火光是三个共用的面片，开枪的那几帧才画；
 *   - 三档细节（约 1 万 / 3 千 / 1 千 3 百个三角形），最精细的那一档最多三个人；160 米外不画；影子只给最近的几个；
 *   - 同伴（ally）胳膊上的浅色袖标和身体在同一个网格里（排在索引的最后），敌人的那一份只是少画最后那一段，不多一次绘制；
 *   - 枪模很细（一把 AK 九千个三角形）：25 米外换成开局简化出来的几百个三角形的版本，100 米外不画。
 */

const J = makeJoints({ ...HUMAN, shoulderX: 0.2 });
/** 池子里一共多少副骨架：同时活着的最多 10 个，剩下的给尸体 */
const POOL = 18;
const BOUNDS = new Sphere(new Vector3(0, 0.9, 0), 2.6);
/** 同伴的袖标：浅灰白。不能用纯白：正午的太阳底下会过曝，被光晕（bloom）糊成一团亮斑 */
const LIGHT = 0xb4c0c6;

const matte = (color: number, o: Partial<Style> = {}): Style => ({ color, jitter: 0.12, ao: 0.22, aoH: 1.3, ...o });
const flat = (color: number): Style => ({ color, jitter: 0.05, ao: 0 });

interface Spec {
  look: Partial<Look> & Pick<Look, 'outfit' | 'shirt' | 'accent' | 'pants'>;
  skin: number;
  hair: number | null;
  long?: boolean;
  /** 头上戴的：棒球帽 / 毛线帽 / 头盔 / 什么都没有 */
  head: 'cap' | 'beanie' | 'helmet' | 'none';
  headCol: number;
  /** 蒙着脸的围巾 / 头巾的颜色（null = 不蒙） */
  mask: number | null;
  /** 背包、胸挂 / 防弹背心的颜色（null = 没有） */
  pack: number | null;
  rig: number | null;
  /** 军装：防弹背心、护膝、护目镜 */
  mil?: boolean;
}

/** 平民：旧的户外衣服，颜色发灰发暗（不要鲜艳的） */
const CIV: Spec[] = [
  { look: { outfit: 'jacket', shirt: 0x6b6a62, accent: 0x4d5540, pants: 0x39424f }, skin: 0xc89a76, hair: 0x2a2018, head: 'cap', headCol: 0x3a3d42, mask: null, pack: 0x4a4336, rig: null },
  { look: { outfit: 'hoodie', shirt: 0x3c3f45, accent: 0x3c3f45, pants: 0x4a4a3c }, skin: 0xa87a56, hair: 0x1a1a1a, head: 'beanie', headCol: 0x2c2f33, mask: 0x4a4038, pack: 0x30343a, rig: null },
  { look: { outfit: 'jacket', shirt: 0x7a7468, accent: 0x5a4632, pants: 0x2e3238 }, skin: 0xd8ae8c, hair: 0x4a3a28, head: 'beanie', headCol: 0x5a3030, mask: null, pack: null, rig: 0x4a4a3e },
  { look: { outfit: 'hoodie', shirt: 0x5e3a34, accent: 0x5e3a34, pants: 0x3a4456 }, skin: 0x7c5238, hair: 0x1a1a1a, head: 'cap', headCol: 0x4d3b2c, mask: 0x2a2c30, pack: 0x5a5444, rig: null },
  { look: { outfit: 'jacket', shirt: 0x5c6670, accent: 0x6a6248, pants: 0x33373c, female: true }, skin: 0xd0a282, hair: 0x3a2a1c, long: true, head: 'none', headCol: 0, mask: null, pack: 0x3c4a40, rig: null },
  { look: { outfit: 'shirt', shirt: 0x4f5d52, accent: 0x4f5d52, pants: 0x4d4436 }, skin: 0xb88a66, hair: 0x2a2018, head: 'none', headCol: 0, mask: 0x3d3a34, pack: 0x2f2f2f, rig: 0x3e4038 },
];
/** 基地、检查站的人：橄榄绿 / 狼棕色的作战服，头盔，防弹背心 */
const MIL: Spec[] = [
  { look: { outfit: 'tee', shirt: 0x4a5038, accent: 0x4a5038, pants: 0x434832, gloves: true }, skin: 0xc89a76, hair: 0x2a2018, head: 'helmet', headCol: 0x3c4230, mask: null, pack: 0x3a3f2e, rig: 0x33382a, mil: true },
  { look: { outfit: 'tee', shirt: 0x5a5444, accent: 0x5a5444, pants: 0x4a4638, gloves: true }, skin: 0xa87a56, hair: 0x1a1a1a, head: 'helmet', headCol: 0x4a4636, mask: 0x23252a, pack: null, rig: 0x3e3a2e, mil: true },
];

/** 一套外观：三档细节，每档两份（带袖标 / 不带）。六份几何体共用同一批顶点数据，只是索引不同 */
interface Variant {
  band: BufferGeometry[];
  plain: BufferGeometry[];
  tris: number[];
}

const _p = new Vector3();
const _q = new Vector3();

/** Builder 做出来的小件（不带索引）补一份顺序索引，好和身体（带索引）并成一个网格 */
function indexed(g: BufferGeometry | null): BufferGeometry | null {
  if (!g) return null;
  const n = g.getAttribute('position').count;
  const idx = new Array<number>(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  g.setIndex(idx);
  return g;
}

/**
 * 身上的小件。big = 哪一档都画的（帽子、围巾）；small = 只有最精细的那一档画的（圆角的背包和背心、眼睛、背带、口袋）；
 * far = 另外两档画的（背包、背心换成方盒子：一个圆角盒就是三百个三角形，远处看不出区别）；band = 同伴的袖标
 */
function gear(s: Spec, body: Body, big: Builder, small: Builder, far: Builder, band: Builder): void {
  const T = body.torso;
  const H = body.head;
  const hy = J.head[1];
  const hz = -0.012;
  const ey = (H.eyes[0].y + H.eyes[1].y) / 2;
  const ez = (H.eyes[0].z + H.eyes[1].z) / 2;
  const fz = T.at(0, 1.26, 0, _p).z;
  const bz = T.at(Math.PI, 1.26, 0, _p).z;

  // ---- 头
  big.bone(B.head);
  small.bone(B.head);
  if (s.head === 'cap') {
    const rim = ey + 0.04;
    const dome = H.top + 0.014 - rim;
    const st = matte(s.headCol, { jitter: 0.1, ao: 0 });
    big.lathe(
      [
        [0.0835, 0],
        [0.085, dome * 0.3],
        [0.079, dome * 0.62],
        [0.06, dome * 0.86],
        [0.03, dome * 0.97],
        [0.001, dome],
      ],
      14,
      { y: rim, z: hz, rx: -Math.PI / 2, sy: 1.27 },
      st,
    );
    // 帽檐：往前伸七厘米，略往下压
    big.cyl(0.072, 0.072, 0.007, 10, { y: rim - 0.002, z: hz + 0.118, sz: 0.86, rx: 0.16 }, st);
  } else if (s.head === 'beanie') {
    const rim = ey + 0.028;
    const dome = H.top + 0.022 - rim;
    const st = matte(s.headCol, { jitter: 0.18, ao: 0 });
    big.lathe(
      [
        [0.086, 0],
        [0.0875, dome * 0.28],
        [0.082, dome * 0.6],
        [0.062, dome * 0.86],
        [0.03, dome * 0.98],
        [0.001, dome],
      ],
      14,
      { y: rim, z: hz, rx: -Math.PI / 2, sy: 1.25 },
      st,
    );
    // 翻上来的一圈边
    big.cyl(0.09, 0.0895, 0.034, 14, { y: rim - 0.004, z: hz, sz: 1.25 }, matte(s.headCol, { jitter: 0.1, ao: 0 }));
  } else if (s.head === 'helmet') {
    const rim = ey + 0.032;
    const dome = H.top + 0.024 - rim;
    const st = matte(s.headCol, { jitter: 0.08, ao: 0.05 });
    big.lathe(
      [
        [0.103, 0],
        [0.107, dome * 0.24],
        [0.102, dome * 0.53],
        [0.085, dome * 0.79],
        [0.05, dome * 0.94],
        [0.001, dome],
      ],
      16,
      { y: rim, z: hz, rx: -Math.PI / 2, sy: 1.13 },
      st,
    );
    big.cyl(0.103, 0.098, 0.012, 16, { y: rim - 0.012, z: hz, sz: 1.13 }, flat(0x17191b));
    // 下巴上的带子
    for (const sd of [-1, 1]) small.rod([sd * 0.092, rim - 0.004, hz + 0.01], [sd * 0.05, hy + 0.036, hz + 0.066], 0.005, flat(0x1c1c1a));
  }
  if (s.mask !== null) {
    // 围巾 / 头巾：从鼻梁往下蒙住半张脸，在脖子上绕一圈
    const st = matte(s.mask, { jitter: 0.16, ao: 0 });
    big.lathe(
      [
        [0.064, -0.03],
        [0.07, 0.0],
        [0.0735, 0.05],
        [0.0745, 0.095],
        [0.0735, 0.122],
      ],
      14,
      { y: hy, z: hz + 0.004, rx: -Math.PI / 2, sy: 1.5 },
      st,
    );
    // 鼻子把布顶起来的那一块
    big.sphere(0.026, 7, 5, { y: hy + 0.103, z: hz + 0.104, sy: 1.25, sz: 0.8 }, st);
    if (!s.mil) small.rbox(0.2, 0.05, 0.16, 0.022, { y: hy - 0.036, z: hz - 0.004 }, st);
  }
  if (s.mil && s.mask !== null) {
    // 护目镜：一整条深色的镜片
    big.box(0.146, 0.046, 0.03, { y: ey - 0.023, z: ez + 0.026 }, flat(0x0e1418));
  } else {
    for (const e of H.eyes) {
      small.sphere(H.eyeR, 7, 5, { x: e.x, y: e.y, z: e.z }, flat(0xcfc8bc));
      small.sphere(H.eyeR * 0.52, 6, 4, { x: e.x, y: e.y, z: e.z + H.eyeR * 0.66 }, flat(0x1e1610));
    }
  }

  // 同伴：头上扎一圈浅色的布（在帽子 / 头盔外面）
  band.bone(B.head);
  const hr = s.head === 'helmet' ? 0.1095 : s.head === 'beanie' ? 0.0935 : 0.0915;
  band.cyl(hr, hr, 0.03, 14, { y: ey + (s.head === 'none' ? 0.036 : 0.05), z: hz, sz: s.head === 'helmet' ? 1.13 : 1.26 }, flat(LIGHT));

  // ---- 躯干
  big.bone(B.chest);
  small.bone(B.chest);
  far.bone(B.chest);
  band.bone(B.chest);
  const sx = Math.abs(T.at(Math.PI / 2, 1.2, 0, _p).x);
  if (s.pack !== null) {
    // 背包：包体、顶盖、前面的小兜；两条背带从胸前绕过肩膀
    const st = matte(s.pack, { jitter: 0.14 });
    const pz = bz - 0.074;
    small.rbox(0.25, 0.33, 0.13, 0.04, { y: 1.07, z: pz }, st);
    small.rbox(0.2, 0.16, 0.05, 0.02, { y: 1.1, z: pz - 0.078 }, matte(s.pack, { jitter: 0.2 }));
    small.rbox(0.23, 0.05, 0.12, 0.02, { y: 1.385, z: pz + 0.006 }, st);
    far.box(0.24, 0.36, 0.13, { y: 1.07, z: pz }, st);
    const strap = flat(0x22231f);
    for (const sd of [-1, 1]) {
      const a = T.at(sd * 0.5, 1.2, 0.006, _p);
      const top = T.at(sd * 0.55, 1.415, 0.008, _q);
      small.rod([a.x, a.y, a.z], [top.x, top.y, top.z], 0.013, strap, 5);
      small.rod([top.x, top.y, top.z], [sd * 0.1, 1.497, -0.012], 0.013, strap, 5);
      small.rod([sd * 0.1, 1.497, -0.012], [sd * 0.095, 1.4, pz + 0.06], 0.013, strap, 5);
      small.rod([a.x, a.y, a.z], [sd * (sx + 0.004), 1.12, pz + 0.07], 0.01, strap, 4);
    }
    // 同伴：背包上扎一条浅色的布，从背后也认得出来
    band.box(0.2, 0.05, 0.012, { y: 1.29, z: pz - 0.07 }, flat(LIGHT));
  } else band.box(0.17, 0.05, 0.012, { y: 1.31, z: bz - 0.016 }, flat(LIGHT));
  if (s.rig !== null) {
    const y0 = s.mil ? 1.075 : 1.1;
    const y1 = s.mil ? 1.375 : 1.29;
    const st = matte(s.rig, { jitter: 0.1 });
    const pouch = matte(s.rig, { jitter: 0.2 });
    // 胸前一块板（军装的背后还有一块，两侧有腰封），下面一排弹匣包
    small.rbox(0.28, y1 - y0, 0.05, 0.018, { y: y0, z: fz + 0.008 }, st);
    far.box(0.28, y1 - y0, 0.07, { y: y0, z: fz + 0.016 }, st);
    if (s.mil) {
      small.rbox(0.28, y1 - y0, 0.05, 0.018, { y: y0, z: bz - 0.006 }, st);
      far.box(0.28, y1 - y0, 0.05, { y: y0, z: bz - 0.006 }, st);
      for (const sd of [-1, 1]) {
        small.box(0.032, 0.14, fz - bz + 0.02, { x: sd * (sx + 0.004), y: 1.08, z: (fz + bz) / 2 }, st);
        small.box(0.05, 0.028, fz - bz + 0.03, { x: sd * 0.093, y: y1 - 0.012, z: (fz + bz) / 2 }, st);
      }
    } else {
      // 胸挂的带子：绕到背后
      for (const sd of [-1, 1]) small.box(0.03, 0.03, fz - bz + 0.05, { x: sd * 0.1, y: 1.38, z: (fz + bz) / 2 }, flat(0x22231f));
    }
    for (const x of [-0.088, 0, 0.088]) small.box(0.072, 0.115, 0.04, { x, y: y0 + 0.012, z: fz + 0.05 }, pouch);
    if (s.mil) small.box(0.052, 0.11, 0.034, { x: 0.105, y: y0 + 0.16, z: fz + 0.046 }, flat(0x17191b));
  }
  // 同伴：左胸一小块浅色的布
  band.box(0.07, 0.045, 0.01, { x: 0.075, y: 1.335, z: T.at(0.4, 1.335, 0, _p).z + (s.rig !== null ? 0.05 : 0.012) }, flat(LIGHT));

  // ---- 腰、腿
  small.bone(B.pelvis);
  small.box(0.07, 0.085, 0.045, { x: 0.165, y: J.pelvis[1] - 0.06, z: 0.03 }, matte(0x2e2c26));
  if (s.mil) {
    for (const side of [0, 1] as const) {
      const kn = side === 0 ? J.kneeL : J.kneeR;
      small.bone(side === 0 ? B.legLL : B.legLR);
      small.rbox(0.1, 0.1, 0.045, 0.02, { x: kn[0], y: kn[1] - 0.06, z: 0.054 }, flat(0x1d1f1c));
    }
  }

  // ---- 同伴的袖标：两条上臂各一圈
  for (const side of [0, 1] as const) {
    const sh = side === 0 ? J.shoulderL : J.shoulderR;
    band.bone(side === 0 ? B.armUL : B.armUR);
    band.cyl(0.0715, 0.069, 0.1, 10, { x: sh[0] + (side === 0 ? 0.012 : -0.012), y: sh[1] - 0.235, sz: 1.1 }, flat(LIGHT));
  }
}

/** 枪的远景版：顶点数据和原来的共用，只换一份简化过的索引（四百个三角形上下）。简化不了就用原来的 */
function gunLow(g: BufferGeometry): BufferGeometry {
  const pos = g.getAttribute('position');
  const n = g.index ? g.index.count : pos.count;
  if (!MeshoptSimplifier.supported || n / 3 < 900) return g;
  const idx = new Uint32Array(n);
  if (g.index) for (let i = 0; i < n; i++) idx[i] = g.index.getX(i);
  else for (let i = 0; i < n; i++) idx[i] = i;
  const positions = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    positions[i * 3] = pos.getX(i);
    positions[i * 3 + 1] = pos.getY(i);
    positions[i * 3 + 2] = pos.getZ(i);
  }
  const want = 400 * 3;
  try {
    let [out] = MeshoptSimplifier.simplify(idx, positions, 3, want, 0.08, ['Prune']);
    // 枪是一堆互不相连的小方块，普通简化压不下去：换成不保拓扑的
    if (out.length > want * 1.7) [out] = MeshoptSimplifier.simplifySloppy(idx, positions, 3, null, want, 0.12);
    if (out.length < 60 || out.length > n * 0.8) return g;
    const low = new BufferGeometry();
    for (const name of Object.keys(g.attributes)) low.setAttribute(name, g.getAttribute(name));
    low.setIndex(new BufferAttribute(out, 1));
    low.boundingSphere = g.boundingSphere;
    return low;
  } catch {
    return g;
  }
}

/** 把身体那一段的索引简化到 target 个三角形左右（顶点数据不动，只出一份新的索引） */
function simplify(index: Uint32Array, positions: Float32Array, target: number, error: number): Uint32Array {
  if (!MeshoptSimplifier.supported || index.length / 3 < target * 1.5) return index;
  try {
    const [out] = MeshoptSimplifier.simplify(index, positions, 3, Math.floor(target) * 3, error, ['Prune']);
    return out.length >= 300 && out.length < index.length ? out : index;
  } catch {
    return index;
  }
}

function buildVariant(s: Spec, seed: number): Variant {
  const L: Look = {
    skin: s.mil && s.mask !== null ? s.mask : s.skin,
    shoe: 0x241f1a,
    hair: s.mil && s.mask !== null ? null : s.hair,
    // 戴着帽子的：头发只在帽子下面露一圈颜色（不然头发的那一层会从帽子里戳出来）
    hairStyle: s.head !== 'none' ? (s.long ? 'long' : 'bald') : s.long ? 'long' : 'short',
    eyes: 0,
    eyeGlow: 0,
    bulk: 0.98 + (seed % 5) * 0.022,
    depth: 1.02,
    sleeves: 'long',
    missingArm: 0,
    wounds: 0,
    gaunt: false,
    jaw: 0,
    noNose: false,
    female: false,
    legs: 'long',
    clean: true,
    ...s.look,
  };
  const body = buildBody(J, L, 500 + seed * 7);
  const big = new Builder(true);
  const small = new Builder(true);
  const far = new Builder(true);
  const band = new Builder(true);
  gear(s, body, big, small, far, band);
  const parts = [body.geometry, indexed(big.build().matte), indexed(small.build().matte), indexed(far.build().matte), indexed(band.build().matte)];
  const counts = parts.map((g) => g?.index?.count ?? 0);
  const all = mergeGeometries(parts.filter((g): g is BufferGeometry => g !== null), false);
  for (const g of parts) g?.dispose();
  const src = all.index as BufferAttribute;
  const full = new Uint32Array(src.count);
  for (let i = 0; i < full.length; i++) full[i] = src.getX(i);
  const [nBody, nBig, nSmall, nFar, nBand] = counts as [number, number, number, number, number];
  const pos = all.getAttribute('position');
  const positions = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    positions[i * 3] = pos.getX(i);
    positions[i * 3 + 1] = pos.getY(i);
    positions[i * 3 + 2] = pos.getZ(i);
  }
  // 索引的顺序：身体 | 哪档都画的 | 近处的 | 远处的 | 袖标。袖标排最后：不带袖标的那一份只是少画最后一段
  const bodyIdx = full.subarray(0, nBody);
  const bigIdx = full.subarray(nBody, nBody + nBig);
  const smallIdx = full.subarray(nBody + nBig, nBody + nBig + nSmall);
  const farIdx = full.subarray(nBody + nBig + nSmall, nBody + nBig + nSmall + nFar);
  const bandIdx = full.subarray(nBody + nBig + nSmall + nFar);
  const cat = (...list: Uint32Array[]): Uint32Array => {
    let n = 0;
    for (const a of list) n += a.length;
    const out = new Uint32Array(n);
    n = 0;
    for (const a of list) {
      out.set(a, n);
      n += a.length;
    }
    return out;
  };
  const mid = simplify(bodyIdx, positions, 2600, 0.03);
  const low = simplify(mid, positions, 850, 0.1);
  const v: Variant = { band: [], plain: [], tris: [] };
  for (const idx of [cat(bodyIdx, bigIdx, smallIdx, bandIdx), cat(mid, bigIdx, farIdx, bandIdx), cat(low, bigIdx, farIdx, bandIdx)]) {
    const attr = new BufferAttribute(idx, 1);
    for (const withBand of [true, false]) {
      const g = new BufferGeometry();
      for (const name of Object.keys(all.attributes)) g.setAttribute(name, all.getAttribute(name));
      g.setIndex(attr);
      if (!withBand) g.setDrawRange(0, idx.length - nBand);
      g.boundingSphere = BOUNDS;
      (withBand ? v.band : v.plain).push(g);
    }
    v.tris.push((idx.length - nBand) / 3);
  }
  return v;
}

/** 枪口火光的贴图：中间亮、往外散开的一团加几道尖刺 */
function flashTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255, 244, 214, 1)');
  g.addColorStop(0.22, 'rgba(255, 200, 110, 0.85)');
  g.addColorStop(0.55, 'rgba(255, 130, 40, 0.22)');
  g.addColorStop(1, 'rgba(255, 110, 20, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(32, 32);
  for (let i = 0; i < 6; i++) {
    ctx.rotate(Math.PI / 3);
    const len = i % 2 ? 22 : 31;
    const sp = ctx.createLinearGradient(0, 0, len, 0);
    sp.addColorStop(0, 'rgba(255, 230, 170, 0.9)');
    sp.addColorStop(1, 'rgba(255, 150, 50, 0)');
    ctx.fillStyle = sp;
    ctx.beginPath();
    ctx.moveTo(0, -3.5);
    ctx.lineTo(len, 0);
    ctx.lineTo(0, 3.5);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** 肘往哪边拐：右肘朝外下方，左肘朝下 */
const HINT_R = new Vector3(-0.7, -1, -0.25);
const HINT_L = new Vector3(0.45, -1, 0.05);
const FORE_DEFAULT = new Vector3(0, 0.03, 0.26);
const RELOAD_AT = new Vector3(0.01, -0.14, 0.09);
const TWISTED = [B.armUL, B.armUR, B.legUL, B.legUR];
const _r = new Vector3();
const _l = new Vector3();
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

/** 一个人的模型（池子里循环用） */
export class RView {
  readonly mesh: SkinnedMesh;
  /** 枪的挂点（胸骨的子节点）：握把在它的原点 */
  readonly mount = new Group();
  readonly gun: Mesh;
  wg: WorldGun | null = null;
  /** 枪的远景版；现在画的是不是它 */
  low: BufferGeometry | null = null;
  far = false;
  variant: Variant | null = null;
  banded = false;
  lod = -1;
  casting = false;
  /** 举枪的程度：0 = 枪口朝下端着，1 = 抵肩瞄准 */
  aim = 0;
  reload = 0;
  /** 隔几帧才摆一次姿势的那些用它错开 */
  tick = 0;
  // ---- 尸体
  death: DeathState | null = null;
  deadAge = 0;
  /** 死的时候脚底多高、那里的地面多高；躺定以后的高度 */
  baseY = 0;
  baseG = 0;
  restY = 0;
  life = 0;
  sunk = 0;

  constructor(
    readonly actor: RigActor,
    gunMat: MeshStandardMaterial,
  ) {
    this.mesh = actor.meshes[0] as SkinnedMesh;
    this.mesh.boundingSphere = BOUNDS;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    actor.bone(B.chest).add(this.mount);
    this.gun = new Mesh(this.mesh.geometry, gunMat);
    this.gun.visible = false;
    this.gun.receiveShadow = true;
    this.mount.add(this.gun);
    actor.group.visible = false;
  }

  setGeo(): void {
    const v = this.variant;
    if (!v) return;
    const i = Math.max(0, this.lod);
    this.mesh.geometry = (this.banded ? v.band : v.plain)[i] as BufferGeometry;
  }

  setShadow(on: boolean): void {
    if (on === this.casting) return;
    this.casting = on;
    // 枪不投影子：细细的一条，看不出来，省一次绘制
    this.mesh.castShadow = on;
  }

  /** 活着的时候的姿势：走路摆腿、蹲、上身跟着枪口转、两只手握枪 */
  pose(h: Human, dt: number): void {
    const a = this.actor;
    a.resetPose();
    const move = Math.min(1, h.sp / 2.5);
    const run = clamp((h.sp - 3) / 1.5, 0, 1);
    const sn = Math.sin(h.walkPhase);
    const cs = Math.cos(h.walkPhase);
    const crouch = h.ck;
    const swing = 0.6 + 0.25 * run;
    a.bone(B.legUL).rotation.x = sn * swing * move - 1.1 * crouch;
    a.bone(B.legUR).rotation.x = -sn * swing * move - 0.3 * crouch;
    a.bone(B.legLL).rotation.x = Math.max(0, -cs) * (0.9 + 0.4 * run) * move + 1.6 * crouch;
    a.bone(B.legLR).rotation.x = Math.max(0, cs) * (0.9 + 0.4 * run) * move + 1.3 * crouch;
    a.bone(B.pelvis).position.y = a.pelvisBaseY - 0.04 * move * (0.5 - 0.5 * Math.cos(2 * h.walkPhase)) - 0.38 * crouch;
    // 上身朝瞄准方向扭过去（身体朝走路方向时也能侧着开枪）
    let twist = (h.aimYaw - h.yaw) % (Math.PI * 2);
    if (twist > Math.PI) twist -= Math.PI * 2;
    else if (twist < -Math.PI) twist += Math.PI * 2;
    twist = clamp(twist, -1.2, 1.2);
    const heal = h.mode === 'heal' ? 1 : 0;
    const chest = a.bone(B.chest);
    const kick = Math.max(0, 1 - h.sinceShot / 0.08);
    chest.rotation.y = twist * 0.75;
    chest.rotation.x = 0.1 + 0.1 * crouch + 0.1 * run + 0.25 * heal - h.aimPitch * 0.4 - 0.05 * kick - 0.22 * h.flinch;
    chest.rotation.z = 0.1 * h.flinch * (h.seed & 1 ? 1 : -1);
    const head = a.bone(B.head);
    head.rotation.y = twist * 0.25;
    // ---- 枪：有目标 / 刚开过枪就抵肩瞄准，戒备时端在胸前，平时枪口朝下；换弹、包扎时压低
    const want = h.tk !== 0 || h.sinceShot < 1.2 ? 1 : h.mode === 'alert' || h.mode === 'search' || h.mode === 'look' || h.mode === 'cover' ? 0.5 : 0;
    this.aim += (want * (1 - 0.6 * run) - this.aim) * Math.min(1, dt * 9);
    this.reload += ((h.reloadT > 0 || heal ? 1 : 0) - this.reload) * Math.min(1, dt * 10);
    const aim = this.aim;
    const rel = this.reload;
    const pistol = h.spec.kind === 'pistol';
    const down = (pistol ? 0.75 : 0.55) * (1 - aim) + 0.5 * rel;
    const m = this.mount;
    if (pistol) m.position.set(lerp(-0.06, -0.03, aim), lerp(0.2, 0.43, aim) - 0.08 * rel, lerp(0.3, 0.44, aim) - 0.03 * kick);
    else m.position.set(-0.085, lerp(0.25, 0.375, aim) - 0.05 * rel, lerp(0.21, 0.2, aim) - 0.025 * kick);
    // 胸骨自己已经带着一部分俯仰，枪再补上剩下的，合起来就是瞄准的俯仰
    m.rotation.set(-h.aimPitch + down - chest.rotation.x - 0.04 * kick, (pistol ? 0.04 : 0.07) + twist * 0.25, 0);
    m.updateMatrix();
    head.rotation.x = -h.aimPitch * 0.5 - 0.05 + 0.3 * heal - 0.3 * h.flinch;
    head.rotation.z = pistol ? 0 : -0.1 * aim;
    // 右手握把：手腕在握把后下方一点（手掌在手腕前面）
    _r.set(0.012, -0.04, -0.055).applyMatrix4(m.matrix);
    a.solveArm(1, _r, HINT_R);
    // 左手：长枪扶护木（换弹时去够弹匣），手枪托在右手下面
    if (pistol) _l.set(0.04, -0.05, -0.045);
    else {
      _l.copy(this.wg ? this.wg.fore : FORE_DEFAULT);
      _l.y -= 0.045;
      _l.z -= 0.035;
      _l.lerp(RELOAD_AT, rel * 0.85);
    }
    _l.applyMatrix4(m.matrix);
    a.solveArm(0, _l, HINT_L);
  }

  /** 放回池子：把倒地时改的东西都改回来 */
  reset(): void {
    const a = this.actor;
    a.group.visible = false;
    this.gun.visible = false;
    if (this.death) {
      this.death = null;
      for (const i of TWISTED) a.bone(i).rotation.order = 'XYZ';
      a.group.rotation.order = 'XYZ';
      a.group.rotation.set(0, 0, 0);
    }
    a.resetPose();
    this.setShadow(false);
    this.lod = -1;
    this.far = false;
    this.aim = 0;
    this.reload = 0;
    this.sunk = 0;
    this.deadAge = 0;
  }
}

interface Flash {
  mesh: Mesh;
  t: number;
}

/** 所有人的模型：池子、每帧的细节档 / 姿势、尸体、枪口的火光 */
export class RaiderViews {
  private readonly free: RView[] = [];
  private readonly corpses: RView[] = [];
  private readonly all: RView[] = [];
  private readonly flashes: Flash[] = [];
  private flashNext = 0;
  private warm = 4;
  private frame = 0;
  // ---- 画质
  private k = 1;
  private lod0N = 3;
  private shadowN = 4;
  private maxCorpses = 6;
  // ---- 相机
  private readonly vm = new Float64Array(16);
  private tanX = 1;
  private tanY = 1;
  private secX = 1;
  private secY = 1;
  private cx = 0;
  private cy = 0;
  private cz = 0;
  private readonly dOf = new Float32Array(POOL);
  private readonly dSort = new Float32Array(POOL);
  private readonly lows = new Map<string, BufferGeometry>();
  /** 调试 / 量性能：画面里几个、这一帧摆了几个姿势、尸体几具；每档细节多少个三角形；开局建模型花了多久 */
  readonly info = { shown: 0, posed: 0, corpses: 0, tris: [0, 0, 0], buildMs: 0, loadMs: 0, guns: 0 };

  private constructor(
    scene: Scene,
    private readonly world: World,
    private readonly civ: Variant[],
    private readonly mil: Variant[],
    private readonly guns: Map<string, WorldGun>,
  ) {
    const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.02 });
    const first = civ[0] as Variant;
    const gunMat = (guns.values().next().value as WorldGun | undefined)?.material ?? mat;
    for (let i = 0; i < POOL; i++) {
      const actor = new RigActor({ matte: first.band[0] as BufferGeometry, metal: null, glow: null }, { matte: mat, metal: mat, glow: mat }, J, mat);
      const v = new RView(actor, gunMat as MeshStandardMaterial);
      scene.add(actor.group);
      this.all.push(v);
      this.free.push(v);
    }
    // 倒地动画第一次用到一份几何体时要把它量一遍（一两毫秒）：开局就量好
    [...civ, ...mil].forEach((vr, i) => {
      const v = this.all[i % POOL] as RView;
      v.mesh.geometry = vr.band[0] as BufferGeometry;
      v.death = startDeath(v.actor, { kind: 'walker', seed: 1, head: false, x: 0, z: 0, yaw: 0, air: 0, kbx: 0, kbz: 1, vx: 0, vz: 0 });
      v.reset();
    });
    // 枪口的火光：三个共用的面片（三片互相垂直：从哪边看都是一团）
    const p1 = new PlaneGeometry(1, 1);
    const p2 = new PlaneGeometry(1, 1).rotateY(Math.PI / 2);
    const p3 = new PlaneGeometry(1, 1).rotateX(Math.PI / 2);
    const fg = mergeGeometries([p1, p2, p3], false);
    const fm = new MeshBasicMaterial({ map: flashTexture(), transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false, side: DoubleSide });
    for (let i = 0; i < 3; i++) {
      const mesh = new Mesh(fg, fm);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 5;
      scene.add(mesh);
      this.flashes.push({ mesh, t: 0 });
    }
    for (const [id, wg] of guns) this.lows.set(id, gunLow(wg.geometry));
    this.info.tris = [...first.tris];
    this.info.guns = guns.size;
  }

  /** 建好 8 套外观、18 副骨架，加载 18 把枪的模型。之后运行中不再建任何东西 */
  static async load(scene: Scene, renderer: WebGLRenderer, world: World): Promise<RaiderViews> {
    const t0 = performance.now();
    // 枪：先全部开始加载，一边建身体一边等
    for (const g of GUN_LIST) worldGun(g.id);
    await MeshoptSimplifier.ready;
    const civ: Variant[] = [];
    const mil: Variant[] = [];
    for (let i = 0; i < CIV.length; i++) {
      civ.push(buildVariant(CIV[i] as Spec, i));
      // 让出主线程：加载画面不至于卡住不动
      await new Promise((r) => setTimeout(r, 0));
    }
    for (let i = 0; i < MIL.length; i++) {
      mil.push(buildVariant(MIL[i] as Spec, 10 + i));
      await new Promise((r) => setTimeout(r, 0));
    }
    const t1 = performance.now();
    const guns = new Map<string, WorldGun>();
    for (let tries = 0; tries < 300; tries++) {
      let pending = 0;
      for (const g of GUN_LIST) {
        const wg = worldGunCache.get(g.id);
        if (wg === undefined) pending++;
        else if (wg && !guns.has(g.id)) guns.set(g.id, wg);
      }
      if (!pending) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    for (const wg of guns.values()) {
      wg.geometry.boundingSphere ??= new Sphere(new Vector3(0, 0, 0.2), 0.9);
      if (wg.material.map) renderer.initTexture(wg.material.map);
    }
    const views = new RaiderViews(scene, world, civ, mil, guns);
    views.info.buildMs = Math.round(t1 - t0);
    views.info.loadMs = Math.round(performance.now() - t0);
    views.showcase(true);
    return views;
  }

  /**
   * 开局头几帧：池子里所有的骨架放在脚下的地底（看不见），每一套外观、每一档细节、每一把枪都画一遍，
   * 把几何体和骨骼贴图传上显卡，蒙皮的阴影着色器也在这时候编译（不然第一个人走进画面的那一帧会卡一下）
   */
  private showcase(on: boolean): void {
    const vs = [...this.civ, ...this.mil];
    const guns = [...this.guns.values()];
    const lows = [...this.lows.values()];
    this.all.forEach((v, i) => {
      const g = v.actor.group;
      g.visible = on;
      v.mesh.frustumCulled = !on;
      v.gun.frustumCulled = !on;
      v.mesh.castShadow = on;
      v.casting = on;
      if (on) {
        v.variant = vs[i % vs.length] as Variant;
        v.banded = true;
        v.lod = (i + this.warm) % 3;
        v.setGeo();
        const wg = guns[i % Math.max(1, guns.length)];
        if (wg) {
          v.wg = wg;
          v.low = lows[i % lows.length] as BufferGeometry;
          v.gun.geometry = wg.geometry;
          v.gun.material = wg.material;
          v.gun.visible = true;
        }
      } else v.reset();
    });
    for (const f of this.flashes) {
      f.mesh.visible = on;
      f.mesh.scale.setScalar(0.01);
    }
  }

  setQuality(k: number): void {
    this.k = k;
    this.lod0N = k >= 0.85 ? 3 : k >= 0.7 ? 2 : 1;
    this.shadowN = k >= 0.85 ? 4 : k >= 0.7 ? 2 : 0;
    this.maxCorpses = k >= 0.7 ? 6 : 4;
  }

  /** 以 (x, y, z) 为球心、半径 r 的球在不在画面里（只看视锥，不管被没被挡住） */
  sees(x: number, y: number, z: number, r: number): boolean {
    const m = this.vm;
    const vx = (m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z + (m[12] as number);
    const vy = (m[1] as number) * x + (m[5] as number) * y + (m[9] as number) * z + (m[13] as number);
    const d = -((m[2] as number) * x + (m[6] as number) * y + (m[10] as number) * z + (m[14] as number));
    if (d < -r) return false;
    return Math.abs(vx) - r * this.secX < d * this.tanX && Math.abs(vy) - r * this.secY < d * this.tanY;
  }

  /** 给一个新来的人拿一副骨架。池子空了就把最早的那具尸体收回来用 */
  acquire(h: Human): RView | null {
    let v = this.free.pop();
    if (!v) {
      const old = this.corpses.shift();
      if (!old) return null;
      old.reset();
      v = old;
    }
    const list = h.mil ? this.mil : this.civ;
    v.variant = list[h.seed % list.length] as Variant;
    v.banded = h.side === 'ally';
    v.lod = -1;
    v.setGeo();
    const wg = this.guns.get(h.gun) ?? null;
    v.wg = wg;
    v.low = this.lows.get(h.gun) ?? null;
    v.far = false;
    if (wg) {
      v.gun.geometry = wg.geometry;
      v.gun.material = wg.material;
      v.gun.visible = true;
    } else v.gun.visible = false;
    const a = v.actor;
    // 个头差一点：一伙里不会一样高
    a.group.scale.setScalar(0.97 + 0.06 * (((h.seed >>> 8) % 1000) / 1000));
    a.group.position.set(h.x, h.y, h.z);
    a.group.rotation.set(0, h.yaw, 0);
    a.group.visible = true;
    v.tick = h.id;
    v.aim = 0;
    v.reload = 0;
    v.pose(h, 1);
    h.view = v;
    return v;
  }

  release(h: Human): void {
    const v = h.view as RView | null;
    if (!v) return;
    h.view = null;
    v.reset();
    this.free.push(v);
  }

  /** 换了阵营：袖标跟着换 */
  setSide(h: Human): void {
    const v = h.view as RView | null;
    if (!v) return;
    v.banded = h.side === 'ally';
    v.setGeo();
  }

  /** 死了：模型转成尸体，躺 life 秒以后沉进地里 */
  kill(h: Human, life: number): void {
    const v = h.view as RView | null;
    if (!v) return;
    h.view = null;
    const a = v.actor;
    const g = a.group;
    v.gun.visible = false;
    // 倒地动画要先量一遍这个网格（每份几何体只量一次）：都用最精细、带袖标的那一份量，别的档不用再量
    v.mesh.geometry = (v.variant as Variant).band[0] as BufferGeometry;
    g.rotation.order = 'YXZ';
    const w = this.world;
    const y = h.y + 0.5;
    v.death = startDeath(a, {
      kind: 'walker',
      seed: h.seed,
      head: h.head,
      x: h.x,
      z: h.z,
      yaw: h.yaw,
      air: 0,
      kbx: h.killDx * h.killPush,
      kbz: h.killDz * h.killPush,
      vx: h.vx,
      vz: h.vz,
      room: (dx, dz, want) => Math.max(0, Math.min(want + 0.15, w.raycast(h.x, y, h.z, dx, 0, dz, want + 0.15, false)) - 0.15),
    });
    v.setGeo();
    v.deadAge = 0;
    v.baseY = h.y;
    v.baseG = w.groundAt(h.x, h.z);
    v.restY = h.y;
    v.life = life;
    v.sunk = 0;
    this.corpses.push(v);
    // 尸体太多：最早的那具现在就开始沉
    if (this.corpses.length > this.maxCorpses) {
      const old = this.corpses[0] as RView;
      old.life = Math.min(old.life, old.deadAge);
    }
  }

  /** 尸体全部收走（调试 / 量性能时换场景用） */
  clearCorpses(): void {
    for (const v of this.corpses) {
      v.reset();
      this.free.push(v);
    }
    this.corpses.length = 0;
  }

  /** 开了一枪：在枪口放一团火光（要在这一帧的姿势摆好以后调） */
  flash(h: Human): void {
    const v = h.view as RView | null;
    if (!v || !v.wg || !v.actor.group.visible) return;
    if (!this.sees(h.x, h.y + 1.2, h.z, 2)) return;
    const f = this.flashes[this.flashNext] as Flash;
    this.flashNext = (this.flashNext + 1) % this.flashes.length;
    v.mount.updateWorldMatrix(true, false);
    f.mesh.position.copy(v.wg.muzzle).applyMatrix4(v.mount.matrixWorld);
    f.mesh.quaternion.setFromRotationMatrix(v.mount.matrixWorld).normalize();
    f.mesh.rotateZ(Math.random() * 6.28);
    const k = h.spec.kind;
    f.mesh.scale.setScalar((k === 'pistol' ? 0.24 : k === 'shotgun' ? 0.46 : k === 'smg' ? 0.3 : 0.38) * (0.85 + Math.random() * 0.3));
    f.mesh.visible = true;
    f.t = 0.045;
  }

  update(dt: number, humans: readonly Human[], camera: PerspectiveCamera): void {
    const info = this.info;
    info.shown = 0;
    info.posed = 0;
    const e = camera.matrixWorldInverse.elements;
    for (let i = 0; i < 16; i++) this.vm[i] = e[i] as number;
    this.tanY = Math.tan((camera.fov * Math.PI) / 360) / camera.zoom;
    this.tanX = this.tanY * camera.aspect;
    this.secX = Math.hypot(1, this.tanX);
    this.secY = Math.hypot(1, this.tanY);
    this.cx = camera.position.x;
    this.cy = camera.position.y;
    this.cz = camera.position.z;
    const frame = ++this.frame;
    if (this.warm > 0) {
      this.all.forEach((v, i) => {
        v.actor.group.position.set(this.cx + (i % 6) - 2.5, this.cy - 14, this.cz + Math.floor(i / 6) - 1);
        v.lod = (i + this.warm) % 3;
        v.setGeo();
        // 枪的两个版本轮着画一遍
        if (v.wg && v.low) v.gun.geometry = this.warm % 2 ? v.low : v.wg.geometry;
      });
      for (const f of this.flashes) f.mesh.position.set(this.cx, this.cy - 14, this.cz);
      if (--this.warm === 0) this.showcase(false);
      else return;
    }
    for (const f of this.flashes) {
      if (!f.mesh.visible) continue;
      f.t -= dt;
      if (f.t <= 0) f.mesh.visible = false;
    }
    // ---- 先量一遍离相机多远：最精细的那一档、投影子的各取最近的几个
    const n = Math.min(humans.length, POOL);
    const { dOf, dSort } = this;
    for (let i = 0; i < n; i++) {
      const h = humans[i] as Human;
      const d = Math.fround(Math.hypot(h.x - this.cx, h.y + 1 - this.cy, h.z - this.cz));
      dOf[i] = d;
      dSort[i] = d;
    }
    dSort.fill(Infinity, n);
    dSort.sort();
    const r0 = 13 * this.k;
    const r1 = 44 * this.k;
    const lod0R = Math.min(r0, dSort[this.lod0N - 1] as number);
    const shadowR = this.shadowN > 0 ? Math.min(30, dSort[this.shadowN - 1] as number) : -1;
    for (let i = 0; i < n; i++) {
      const h = humans[i] as Human;
      const v = h.view as RView | null;
      if (!v) continue;
      const g = v.actor.group;
      const d = dOf[i] as number;
      if (d > 160) {
        g.visible = false;
        continue;
      }
      g.visible = true;
      g.position.set(h.x, h.y, h.z);
      g.rotation.y = h.yaw;
      this.lodOf(v, d, lod0R, r1);
      v.setShadow(d <= shadowR);
      // 100 米外枪只有几个像素：不画；25 米外用简化过的
      v.gun.visible = !!v.wg && d < 100;
      const far = d > (v.far ? 23 : 27);
      if (far !== v.far && v.wg) {
        v.far = far;
        v.gun.geometry = far && v.low ? v.low : v.wg.geometry;
      }
      const seen = this.sees(h.x, h.y + 0.9, h.z, 1.6);
      if (seen) info.shown++;
      // 画面外的不摆姿势（贴身的除外：影子可能在画面里）；远处的隔两帧摆一次
      if ((seen && (d < 60 || (frame + v.tick) % 3 === 0)) || d < 12) {
        v.pose(h, d < 60 ? dt : dt * 3);
        info.posed++;
      }
    }
    // ---- 尸体
    const cs = this.corpses;
    for (let i = cs.length - 1; i >= 0; i--) {
      const v = cs[i] as RView;
      const d = v.death as DeathState;
      const g = v.actor.group;
      v.deadAge += dt;
      const dist = Math.hypot(g.position.x - this.cx, g.position.y + 0.5 - this.cy, g.position.z - this.cz);
      if (v.deadAge > v.life) v.sunk += dt * 0.25;
      if (v.sunk > 0.7 || dist > 170) {
        cs[i] = cs[cs.length - 1] as RView;
        cs.pop();
        v.reset();
        this.free.push(v);
        continue;
      }
      this.lodOf(v, dist, r0, r1);
      if (!d.done) {
        updateDeath(v.actor, d, v.deadAge, 0);
        // 倒下的时候身体会挪开一两米：坡上跟着地面走（屋里的地板是平的，差值是 0）
        g.position.y += v.baseY + this.world.groundAt(g.position.x, g.position.z) - v.baseG;
        v.restY = g.position.y;
        v.setShadow(dist <= shadowR || dist < 12);
      } else {
        // 躺平以后影子很小：不投了
        g.position.y = v.restY - v.sunk;
        v.setShadow(false);
      }
    }
    info.corpses = cs.length;
  }

  /** 按距离换细节档（换的时候留一点余量，免得在分界上来回跳） */
  private lodOf(v: RView, d: number, r0: number, r1: number): void {
    let i = v.lod;
    if (i < 0) i = d <= r0 ? 0 : d < r1 ? 1 : 2;
    else {
      while (i < 2 && d > (i ? r1 : r0) * 1.06) i++;
      while (i > 0 && d < (i > 1 ? r1 : r0) * 0.94) i--;
    }
    if (i !== v.lod) {
      v.lod = i;
      v.setGeo();
    }
  }
}
