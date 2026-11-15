import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  Group,
  HalfFloatType,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  ShaderChunk,
  type Texture,
  Vector3,
  WebGLRenderTarget,
  type Object3D,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';
import { loadModel, type Model } from '../../render/world/realProps';
import SIZES from '../world/model-sizes.json';
import { SKIN_IN } from '../world/houses';
import type { Face, Roof, RoofTex, Site, SiteContent, Skin, SlabTex } from '../world/sites';
import type { World } from '../world/world';
import { loadArray } from './ground';
import { SNOW_RGB, WX } from './wx';

/**
 * 地点的渲染：走近了才加载，走远了卸掉。
 * - 房子的墙、地板、屋顶：一个地点合成一个网格、一次绘制（16 种贴图放在一张贴图数组里，按顶点选层）；窗玻璃是另一个半透明的网格。
 * - 道具：同一个模型在一个地点里的所有摆放是一个 InstancedMesh。家具、箱子这些小东西只在走到跟前时画。
 * - 模型用到才加载；贴图一帧传一两张、着色器异步编译，地点是「准备好了才出现」，不会卡一下。
 */

const LAYERS = ['wall_concrete', 'wall_brick', 'wall_plaster', 'wall_metal', 'planks', 'plaster_old', 'floor', 'floor_tile', 'concrete', 'roof', 'roof_tiles', 'wallpaper', 'carpet', 'rug', 'cloth', 'trim_metal'];
const ROUGH = [0.92, 0.95, 0.95, 0.62, 0.9, 0.95, 0.72, 0.6, 0.95, 0.9, 0.85, 0.95, 1, 1, 1, 0.7];
// 铁皮是刷了漆的波纹板：金属度高了、周围又没有东西可反射，看上去就是一片黑
const METAL = [0, 0, 0, 0.12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.15];
const SKIN: Record<Skin, { layer: number; tile: number; gain?: number }> = {
  compound: { layer: 0, tile: 2.0 },
  brick: { layer: 1, tile: 1.0 },
  plaster: { layer: 2, tile: 2.0 },
  metal: { layer: 3, tile: 2.7, gain: 1.35 },
  planks: { layer: 4, tile: 1.8 },
  plaster_old: { layer: 5, tile: 3.2, gain: 1.3 },
  // gain：提亮系数（顶点色可以大于 1）。屋里只有环境光，墙纸的贴图本身又偏暗
  plaster_in: { layer: 2, tile: 2.0, gain: 1.5 },
  compound_in: { layer: 0, tile: 2.0, gain: 1.7 },
  brick_in: { layer: 1, tile: 1.0, gain: 1.5 },
  metal_in: { layer: 3, tile: 2.7, gain: 2.1 },
  planks_in: { layer: 4, tile: 1.8, gain: 1.5 },
  wallpaper: { layer: 11, tile: 2.4, gain: 2.2 },
  shutter: { layer: 15, tile: 2.2 },
};
/** 屋面：贴图层、多大一块、背面（从屋里往上看）用哪一层、什么颜色 */
const ROOF: Record<RoofTex, { layer: number; tile: number; under: number; ucol: number; ugain: number }> = {
  roof_tiles: { layer: 10, tile: 4, under: 4, ucol: 0xc8c0b0, ugain: 2.8 },
  shingle: { layer: 9, tile: 3, under: 4, ucol: 0xc8c0b0, ugain: 2.8 },
  wall_metal: { layer: 3, tile: 2.7, under: 2, ucol: 0xaeb0ac, ugain: 2.4 },
  rust: { layer: 15, tile: 2.6, under: 2, ucol: 0xa8a49c, ugain: 2.2 },
};
/** 加在层号上：这个面露天、朝上，下雪的时候会变白 */
const SNOWY = 32;
/** 屋面的厚度、山墙的厚度 */
const ROOF_T = 0.14;
const GABLE_T = 0.26;
const SLAB: Record<SlabTex, { layer: number; tile: number; color: number; gain?: number }> = {
  floor: { layer: 6, tile: 2.0, color: 0xffffff },
  floor_tile: { layer: 7, tile: 2.0, color: 0xffffff, gain: 1.3 },
  concrete: { layer: 8, tile: 3.0, color: 0xd8d4cc, gain: 1.25 },
  pave: { layer: 8, tile: 3.0, color: 0xe2ded4, gain: 1.3 },
  // 门廊、谷仓的旧木板地
  deck: { layer: 4, tile: 1.8, color: 0xcdbda6 },
  // 平屋面：铺了石子的防水层，浅灰
  roof: { layer: 8, tile: 4.0, color: 0xb4b0a6 },
  // 天花板朝下，只吃得到地面反上来的环境光：不提亮的话抬头一片黑
  ceil: { layer: 2, tile: 2.5, color: 0xe6e1d6, gain: 2.3 },
  canopy: { layer: 2, tile: 2.0, color: 0xb83a30 },
  pillar: { layer: 0, tile: 2.0, color: 0xc9c5bc },
  // 床垫、被子、地毯
  mattress: { layer: 2, tile: 1.4, color: 0xd6cfbd },
  blanket: { layer: 14, tile: 1.1, color: 0xffffff },
  blanket2: { layer: 13, tile: 0.9, color: 0xd8d4d0 },
  blanket3: { layer: 12, tile: 1.3, color: 0xc4c8a4 },
  carpet: { layer: 12, tile: 1.6, color: 0xffffff },
  rug: { layer: 13, tile: 1.3, color: 0xffffff },
  rug2: { layer: 14, tile: 1.7, color: 0xe6dccb },
};

/** 多远开始加载 / 卸载一个地点；小东西多远才画；多远以内投影 */
const R_LOAD = 720;
const R_DROP = 900;
const R_SMALL = 70;
/** 很小的东西（桌上的瓶瓶罐罐、墙上的挂件，不到 0.6 米）：更近才画，也不投影（都在屋里） */
const R_TINY = 38;
const TINY = 0.6;
/** 屋里的东西：相机离那栋房子的外墙这么近才画（家具 / 小物件）。从街上看过去屋里是空的，走到门口才出现 */
const R_IN = 30;
const R_IN_TINY = 12;
const R_SHADOW = 70;
/** 离地点这么近才按实例分远近（再远全部用简化版，小东西不画） */
const NEAR = 140;
const SIZE = SIZES as unknown as Record<string, [number, number, number]>;
/** 贴图上限：小道具 512，大件 1024（原图多数是 1024–4096，全部原样加载要 1 GB 多显存） */
const BIG = new Set(['car_sedan1', 'car_sedan2', 'car_crashed', 'car_truck', 'van_wreck', 'container_blue', 'container_rust', 'mil_truck', 'mil_tent', 'mil_apc', 'heli_wreck', 'watchtower', 'fuel_tank', 'gas_pump', 'power_pole', 'sandbags', 'concrete_road_barrier', 'street_lamp_01', 'generator_diesel', 'dumpster']);

const _c = new Color();
const _m = new Matrix4();
const _q = new Quaternion();
const _qx = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _up = new Vector3(0, 1, 0);
const _xAxis = new Vector3(1, 0, 0);

let warmTarget: WebGLRenderTarget | null = null;

/**
 * 提前（异步）编译着色器。画面是先画到后期的渲染目标上的（不做色调映射、线性输出），
 * 而 three 的 compileAsync 按「当前的渲染目标」选着色器变体——在帧与帧之间调用时当前目标是画布，
 * 编出来的是另一个变体，真正要用的那个还是会在第一次画的时候同步编译（卡几百毫秒）。
 * 所以调用的那一瞬间先绑一个渲染目标。
 */
export async function precompile(renderer: WebGLRenderer, object: Object3D, camera: PerspectiveCamera, scene: Scene | null = null): Promise<void> {
  warmTarget ??= new WebGLRenderTarget(1, 1, { type: HalfFloatType });
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(warmTarget);
  let job: Promise<unknown>;
  try {
    job = renderer.compileAsync(object, camera, scene);
  } finally {
    renderer.setRenderTarget(prev);
  }
  try {
    await job;
  } catch {
    // 不支持异步编译：第一次画的时候同步编译
  }
}

// ---------------------------------------------------------------- 房子的网格

class MeshWriter {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  lay: number[] = [];
  idx: number[] = [];

  private v(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, w: number, layer: number): void {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, w);
    this.col.push(_c.r, _c.g, _c.b);
    this.lay.push(layer);
  }

  /** 四个点逆时针（从外面看） */
  quad(p: number[], n: [number, number, number], uv: number[], layer: number): void {
    const b = this.pos.length / 3;
    for (let k = 0; k < 4; k++) this.v(p[k * 3] as number, p[k * 3 + 1] as number, p[k * 3 + 2] as number, n[0], n[1], n[2], uv[k * 2] as number, uv[k * 2 + 1] as number, layer);
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }

  tri(p: number[], n: [number, number, number], uv: number[], layer: number): void {
    const b = this.pos.length / 3;
    for (let k = 0; k < 3; k++) this.v(p[k * 3] as number, p[k * 3 + 1] as number, p[k * 3 + 2] as number, n[0], n[1], n[2], uv[k * 2] as number, uv[k * 2 + 1] as number, layer);
    this.idx.push(b, b + 1, b + 2);
  }

  /** 盒子的一个面（0 +x 1 -x 2 +z 3 -z 4 +y 5 -y）：贴图按米平铺（坐标是相对地点中心的，相邻的墙段贴图是连着的） */
  private side(d: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, layer: number, t: number): void {
    switch (d) {
      case 0:
        this.quad([x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1], [1, 0, 0], [-z1 * t, y0 * t, -z0 * t, y0 * t, -z0 * t, y1 * t, -z1 * t, y1 * t], layer);
        break;
      case 1:
        this.quad([x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0], [-1, 0, 0], [z0 * t, y0 * t, z1 * t, y0 * t, z1 * t, y1 * t, z0 * t, y1 * t], layer);
        break;
      case 2:
        this.quad([x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1], [0, 0, 1], [x0 * t, y0 * t, x1 * t, y0 * t, x1 * t, y1 * t, x0 * t, y1 * t], layer);
        break;
      case 3:
        this.quad([x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0], [0, 0, -1], [-x1 * t, y0 * t, -x0 * t, y0 * t, -x0 * t, y1 * t, -x1 * t, y1 * t], layer);
        break;
      case 4:
        this.quad([x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0], [0, 1, 0], [x0 * t, -z1 * t, x1 * t, -z1 * t, x1 * t, -z0 * t, x0 * t, -z0 * t], layer);
        break;
      default:
        this.quad([x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1], [0, -1, 0], [x0 * t, z0 * t, x1 * t, z0 * t, x1 * t, z1 * t, x0 * t, z1 * t], layer);
        break;
    }
  }

  private tint(color: number, gain = 1): void {
    _c.setHex(color);
    if (gain !== 1) _c.multiplyScalar(gain);
  }

  /** 盒子。top = 顶面用的层号（露天的顶面加 SNOWY） */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, layer: number, tile: number, color: number, gain = 1, top = layer): void {
    this.tint(color, gain);
    const t = 1 / tile;
    for (let d = 0; d < 6; d++) this.side(d, x0, y0, z0, x1, y1, z1, d === 4 ? top : layer, t);
  }

  /** 墙：两个大面可以各用各的材质（外墙朝外 / 朝屋里），其余的面用墙体的材质 */
  wall(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, horiz: boolean, skin: Skin, color: number, neg?: Face, pos?: Face): void {
    const nd = horiz ? 3 : 1;
    const pd = horiz ? 2 : 0;
    const sk = SKIN[skin];
    this.tint(color, sk.gain);
    for (let d = 0; d < 6; d++) if (!((d === nd && neg) || (d === pd && pos))) this.side(d, x0, y0, z0, x1, y1, z1, sk.layer, 1 / sk.tile);
    if (neg) {
      const k = SKIN[neg[0]];
      this.tint(neg[1], k.gain);
      this.side(nd, x0, y0, z0, x1, y1, z1, k.layer, 1 / k.tile);
    }
    if (pos) {
      const k = SKIN[pos[0]];
      this.tint(pos[1], k.gain);
      this.side(pd, x0, y0, z0, x1, y1, z1, k.layer, 1 / k.tile);
    }
  }

  /**
   * 屋顶（双坡 / 单坡）：有厚度的坡面 + 檐口、封檐板 + 砌到屋面的山墙。
   * 在局部坐标 (a, y, b) 里搭：坡面沿 b 升高，a 是檐口的方向；屋脊沿 Z 的（或者单坡朝东西的）把 a、b 对调。
   * 每个面的绕向按「应该朝哪边」自动摆正，不用管对调以后手性变没变。
   */
  roof(r: Roof, ox: number, oy: number, oz: number): void {
    const k = ROOF[r.tex];
    const swap = r.kind === 'gable' ? !r.ridgeX : r.hi === 1 || r.hi === 3;
    const a0 = swap ? r.z0 - oz : r.x0 - ox;
    const a1 = swap ? r.z1 - oz : r.x1 - ox;
    const b0 = swap ? r.x0 - ox : r.z0 - oz;
    const b1 = swap ? r.x1 - ox : r.z1 - oz;
    const y = r.y - oy;
    // a 小的一头 / 大的一头、b 小的一边 / 大的一边各是东南西北的哪一边
    const sA0 = swap ? 0 : 3;
    const sA1 = swap ? 2 : 1;
    const sB0 = swap ? 3 : 0;
    const sB1 = swap ? 1 : 2;
    const A0 = a0 - r.over[sA0];
    const A1 = a1 + r.over[sA1];
    const T = ROOF_T;
    /** 一个面：p = 3 或 4 个点 (a, y, b)，n = 朝哪边 (a, y, b)，uv 和点一一对应 */
    const face = (p: number[], n: [number, number, number], uv: number[], layer: number): void => {
      const m = p.length / 3;
      const ux = (p[3] as number) - (p[0] as number);
      const uy = (p[4] as number) - (p[1] as number);
      const uz = (p[5] as number) - (p[2] as number);
      const vx = (p[m * 3 - 3] as number) - (p[0] as number);
      const vy = (p[m * 3 - 2] as number) - (p[1] as number);
      const vz = (p[m * 3 - 1] as number) - (p[2] as number);
      // 点的绕向和要的朝向相反：倒过来。对调 a、b 是一次镜像，再倒一次
      const back = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2] < 0;
      const order = back !== swap ? (m === 4 ? [0, 3, 2, 1] : [0, 2, 1]) : m === 4 ? [0, 1, 2, 3] : [0, 1, 2];
      const P: number[] = [];
      const U: number[] = [];
      for (const q of order) {
        const pa = p[q * 3] as number;
        const pb = p[q * 3 + 2] as number;
        P.push(swap ? pb : pa, p[q * 3 + 1] as number, swap ? pa : pb);
        U.push(uv[q * 2] as number, uv[q * 2 + 1] as number);
      }
      const N: [number, number, number] = swap ? [n[2], n[1], n[0]] : n;
      if (m === 4) this.quad(P, N, U, layer);
      else this.tri(P, N, U, layer);
    };
    /** 一片坡面：低的一边 (bL, yL)、高的一边 (bH, yH)；verge = 两头要不要封檐板；ridge = 高的一边要不要封口（单坡） */
    const slope = (bL: number, yL: number, bH: number, yH: number, ridge: boolean): void => {
      const g = bL > bH ? 1 : -1;
      const run = Math.abs(bL - bH);
      const len = Math.hypot(run, yH - yL);
      const cs = run / len;
      const sn = (yH - yL) / len;
      const st = 1 / k.tile;
      const uv = [A0 * st, 0, A1 * st, 0, A1 * st, len * st, A0 * st, len * st];
      this.tint(r.rtint);
      face([A0, yL + T, bL, A1, yL + T, bL, A1, yH + T, bH, A0, yH + T, bH], [0, cs, g * sn], uv, k.layer + SNOWY);
      this.tint(k.ucol, k.ugain);
      face([A0, yL, bL, A1, yL, bL, A1, yH, bH, A0, yH, bH], [0, -cs, -g * sn], uv, k.under);
      // 檐口、封檐板：木板色（铁皮顶是灰的）
      this.tint(k.under === 4 ? 0xb8b0a0 : 0x8f918c);
      const edge = k.under === 4 ? 4 : 15;
      face([A0, yL, bL, A1, yL, bL, A1, yL + T, bL, A0, yL + T, bL], [0, 0, g], [A0 * st, 0, A1 * st, 0, A1 * st, T * st, A0 * st, T * st], edge);
      if (ridge) face([A0, yH, bH, A1, yH, bH, A1, yH + T, bH, A0, yH + T, bH], [0, 0, -g], [A0 * st, 0, A1 * st, 0, A1 * st, T * st, A0 * st, T * st], edge);
      for (const [a, dir] of [
        [A0, -1],
        [A1, 1],
      ] as const)
        face([a, yL, bL, a, yH, bH, a, yH + T, bH, a, yL + T, bL], [dir, 0, 0], [0, 0, len * st, 0, len * st, T * st, 0, T * st], edge);
    };
    const sk = r.skin ? SKIN[r.skin] : null;
    /** 山墙朝屋里的那一片有多亮 */
    const gin = r.skin ? SKIN[SKIN_IN[r.skin] ?? r.skin].gain : 1;
    const wt = sk ? 1 / sk.tile : 1;
    if (r.kind === 'gable') {
      const bc = (b0 + b1) / 2;
      const S = (b1 - b0) / 2;
      const yR = y + r.rise;
      const o0 = r.over[sB0];
      const o1 = r.over[sB1];
      slope(b0 - o0, y - (r.rise * o0) / S, bc, yR, false);
      slope(b1 + o1, y - (r.rise * o1) / S, bc, yR, false);
      if (!sk) return;
      // 山墙的三角：外面一片、里面一片（和墙一样厚）
      this.tint(r.tint, sk.gain);
      for (const [a, dir, on] of [
        [a0, -1, r.ends[sA0]],
        [a1, 1, r.ends[sA1]],
      ] as const) {
        if (!on) continue;
        const uv = [b0 * wt, y * wt, b1 * wt, y * wt, bc * wt, yR * wt];
        this.tint(r.tint, sk.gain);
        face([a, y, b0, a, y, b1, a, yR, bc], [dir, 0, 0], uv, sk.layer);
        const ai = a - dir * GABLE_T;
        this.tint(r.tint, gin);
        face([ai, y, b0, ai, y, b1, ai, yR, bc], [-dir, 0, 0], uv, sk.layer);
      }
      return;
    }
    // 单坡：hi 那一边高
    const hiMax = r.hi === sB1;
    const g = hiMax ? -1 : 1;
    const span = b1 - b0;
    const bLw = hiMax ? b0 : b1;
    const bHw = hiMax ? b1 : b0;
    const oL = r.over[hiMax ? sB0 : sB1];
    const oH = r.over[hiMax ? sB1 : sB0];
    slope(bLw + g * oL, y - (r.rise * oL) / span, bHw - g * oH, y + r.rise * (1 + oH / span), true);
    if (!sk) return;
    this.tint(r.tint, sk.gain);
    const yH = y + r.rise;
    for (const [a, dir, on] of [
      [a0, -1, r.ends[sA0]],
      [a1, 1, r.ends[sA1]],
    ] as const) {
      if (!on) continue;
      const uv = [bLw * wt, y * wt, bHw * wt, y * wt, bHw * wt, yH * wt];
      this.tint(r.tint, sk.gain);
      face([a, y, bLw, a, y, bHw, a, yH, bHw], [dir, 0, 0], uv, sk.layer);
      const ai = a - dir * GABLE_T;
      this.tint(r.tint, gin);
      face([ai, y, bLw, ai, y, bHw, ai, yH, bHw], [-dir, 0, 0], uv, sk.layer);
    }
    if (r.ends[r.hi]) {
      const uv = [a0 * wt, y * wt, a1 * wt, y * wt, a1 * wt, yH * wt, a0 * wt, yH * wt];
      this.tint(r.tint, sk.gain);
      face([a0, y, bHw, a1, y, bHw, a1, yH, bHw, a0, yH, bHw], [0, 0, -g], uv, sk.layer);
      const bi = bHw + g * GABLE_T;
      const yi = y + r.rise * (1 - GABLE_T / span);
      this.tint(r.tint, gin);
      face([a0, y, bi, a1, y, bi, a1, yi, bi, a0, yi, bi], [0, 0, g], uv, sk.layer);
    }
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('aLayer', new BufferAttribute(new Float32Array(this.lay), 1));
    const n = this.pos.length / 3;
    g.setIndex(new BufferAttribute(n > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

function structGeometry(s: Site, c: SiteContent): BufferGeometry {
  const w = new MeshWriter();
  for (const b of c.walls) {
    const hx = (b.horiz ? b.L : b.T) / 2;
    const hz = (b.horiz ? b.T : b.L) / 2;
    const x = b.x - s.x;
    const z = b.z - s.z;
    const y = b.y0 - s.h;
    if (b.neg || b.pos) w.wall(x - hx, y, z - hz, x + hx, y + b.h, z + hz, b.horiz, b.skin, b.tint, b.neg, b.pos);
    else {
      const sk = SKIN[b.skin];
      w.box(x - hx, y, z - hz, x + hx, y + b.h, z + hz, sk.layer, sk.tile, b.tint, sk.gain);
    }
  }
  for (const b of c.slabs) {
    const k = SLAB[b.tex];
    const x = b.x - s.x;
    const z = b.z - s.z;
    const y = b.y0 - s.h;
    // 平屋顶、雨棚、女儿墙的压顶露天：下雪会积雪
    const open = b.tex === 'roof' || b.tex === 'canopy' || b.tex === 'pillar' || b.tex === 'pave';
    w.box(x - b.w / 2, y, z - b.d / 2, x + b.w / 2, y + b.h, z + b.d / 2, k.layer, k.tile, b.color ?? k.color, k.gain, open ? k.layer + SNOWY : k.layer);
  }
  for (const r of c.roofs) w.roof(r, s.x, s.h, s.z);
  return w.geometry();
}

/** 窗玻璃：一块一个矩形（双面材质，一次绘制）。顶点色的 alpha = 有多脏 */
function glassGeometry(s: Site, c: SiteContent): BufferGeometry | null {
  const n = c.panes.length;
  if (!n) return null;
  const pos = new Float32Array(n * 12);
  const nor = new Float32Array(n * 12);
  const col = new Float32Array(n * 16);
  const idx = n * 4 > 65535 ? new Uint32Array(n * 6) : new Uint16Array(n * 6);
  c.panes.forEach((p, i) => {
    const x = p.x - s.x;
    const z = p.z - s.z;
    const hx = p.horiz ? p.L / 2 : 0;
    const hz = p.horiz ? 0 : p.L / 2;
    const y0 = p.y0 - s.h;
    const y1 = p.y1 - s.h;
    pos.set([x - hx, y0, z - hz, x + hx, y0, z + hz, x + hx, y1, z + hz, x - hx, y1, z - hz], i * 12);
    for (let k = 0; k < 4; k++) {
      nor[i * 12 + k * 3 + (p.horiz ? 2 : 0)] = 1;
      // 深色的玻璃：从外面看是暗的（屋里比外面暗），从屋里往外看只是略微发灰
      col.set([0.07, 0.1, 0.11, p.a], i * 16 + k * 4);
    }
    idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nor, 3));
  g.setAttribute('color', new BufferAttribute(col, 4));
  g.setIndex(new BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// ---------------------------------------------------------------- 模型

interface Part {
  geo: BufferGeometry;
  /** 远处用的简化版（null = 这个零件本来就省，远近都用原模型） */
  low: BufferGeometry | null;
  mat: Material;
}

interface Loaded {
  parts: Part[];
  /** 多近以内用原模型（米） */
  hiDist: number;
}

function mergeParts(model: Model): Array<{ geo: BufferGeometry; mat: Material }> {
  const by = new Map<Material, BufferGeometry[]>();
  for (const p of model.parts) {
    const g = p.geo.clone().applyMatrix4(p.local);
    const mat = (Array.isArray(p.mat) ? p.mat[0] : p.mat) as Material;
    // 透射玻璃（KHR_materials_transmission：挂钟、工业吊灯、发电机的玻璃）：画面里只要有一个，three.js 就先把
    // 所有不透明物体画进一张离屏贴图、再正式画一遍。实测营地小屋里 454 次绘制 / 562 万三角形 → 290 次 / 337 万，
    // 帧率 60 → 150。改成普通的半透明玻璃
    const glass = mat as MeshStandardMaterial & { transmission?: number };
    if ((glass.transmission ?? 0) > 0) {
      glass.transmission = 0;
      glass.transparent = true;
      glass.opacity = Math.min(glass.opacity, 0.3);
      glass.depthWrite = false;
    }
    // 带顶点色的材质：颜色属性要留着（删了的话顶点色是默认的黑色，整个模型发黑）
    const keep = (mat as MeshStandardMaterial).vertexColors && g.getAttribute('color') ? ['position', 'normal', 'uv', 'color'] : ['position', 'normal', 'uv'];
    if ((mat as MeshStandardMaterial).vertexColors && !g.getAttribute('color')) (mat as MeshStandardMaterial).vertexColors = false;
    for (const name of Object.keys(g.attributes)) if (!keep.includes(name)) g.deleteAttribute(name);
    if (!g.getAttribute('uv')) g.setAttribute('uv', new BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (!g.index) g.setIndex(Array.from({ length: g.getAttribute('position').count }, (_, i) => i));
    const list = by.get(mat) ?? [];
    list.push(g);
    by.set(mat, list);
  }
  const out: Array<{ geo: BufferGeometry; mat: Material }> = [];
  for (const [mat, geos] of by) {
    const merged = geos.length === 1 ? (geos[0] as BufferGeometry) : mergeGeometries(geos, false);
    if (merged) out.push({ geo: merged, mat });
    else for (const g of geos) out.push({ geo: g, mat });
  }
  return out;
}

/** meshoptimizer 简化到 target 个三角形左右（顶点数据和原模型共用，只换索引）；本来就省或者简化不动返回 null */
function simplify(geo: BufferGeometry, target: number): BufferGeometry | null {
  const index = geo.index;
  if (!index || !MeshoptSimplifier.supported || index.count / 3 < target * 1.6) return null;
  const pos = geo.getAttribute('position');
  const positions = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    positions[i * 3] = pos.getX(i);
    positions[i * 3 + 1] = pos.getY(i);
    positions[i * 3 + 2] = pos.getZ(i);
  }
  const indices = new Uint32Array(index.array);
  const want = Math.max(36, Math.floor(target) * 3);
  if (want >= index.count) return null;
  let [out] = MeshoptSimplifier.simplify(indices, positions, 3, want, 0.12, ['Prune']);
  // 细碎的模型（一堆互不相连的小零件）普通简化压不下去：换成不保拓扑的简化
  if (out.length > want * 1.7) [out] = MeshoptSimplifier.simplifySloppy(indices, positions, 3, null, want, 0.15);
  if (out.length < 12 || out.length > index.count * 0.75) return null;
  const g = new BufferGeometry();
  for (const [name, attr] of Object.entries(geo.attributes)) g.setAttribute(name, attr as BufferAttribute);
  g.setIndex(new BufferAttribute(out, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

const TEX_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'] as const;

/** 贴图缩到上限以内（在后台线程里缩，不占主线程） */
async function shrink(t: Texture, cap: number): Promise<void> {
  const img = t.image as { width?: number; height?: number } | null;
  if (!img?.width || !img.height || Math.max(img.width, img.height) <= cap || typeof createImageBitmap !== 'function') return;
  const k = cap / Math.max(img.width, img.height);
  try {
    const small = await createImageBitmap(img as ImageBitmapSource, { resizeWidth: Math.max(1, Math.round(img.width * k)), resizeHeight: Math.max(1, Math.round(img.height * k)), resizeQuality: 'medium' });
    (img as { close?: () => void }).close?.();
    t.image = small;
    t.needsUpdate = true;
  } catch {
    // 缩不了就用原图
  }
}

// ---------------------------------------------------------------- 视图

/** 一个地点里同一种模型的所有摆放 */
interface Batch {
  hi: InstancedMesh[];
  lo: InstancedMesh[];
  /** 所有实例的矩阵（n × 16）和世界坐标 */
  m: Float32Array;
  px: Float32Array;
  pz: Float32Array;
  /** 每个实例现在怎么画：0 不画，1 原模型，2 简化版 */
  st: Uint8Array;
  n: number;
  small: boolean;
  /** 多远以外不画（Infinity = 一直画） */
  cull: number;
  tiny: boolean;
  /** 每个实例在哪栋房子里（null = 这一批都在屋外） */
  house: Int16Array | null;
  hiDist: number;
}

interface View {
  site: Site;
  content: SiteContent;
  group: Group;
  struct: Mesh | null;
  glass: Mesh | null;
  batches: Batch[];
  ready: boolean;
  dead: boolean;
  shadow: boolean;
  /** 相机到每栋房子外轮廓的距离 */
  hd: Float32Array;
  /** 上次分远近时相机的位置 */
  px: number;
  pz: number;
}

export interface SitesView {
  group: Group;
  update(camera: PerspectiveCamera): void;
  /** 等玩家周围的地点全部加载好（开局、传送后用） */
  settle(camera: PerspectiveCamera, radius?: number): Promise<void>;
  /** 画质档位：小东西画多远、多远以内投影、多近换回原模型（都是相对默认值的倍率） */
  setQuality(q: { props: number; shadow: number; lod: number }): void;
  stats(): { sites: number; building: number; models: number; inst: number };
  dispose(): void;
}

export async function buildSitesView(
  world: World,
  manifest: { assets: Record<string, { file: string }>; textures: Record<string, string> },
  renderer: WebGLRenderer,
  scene: Scene,
  anisotropy: number,
  onLamps: (lamps: Array<{ x: number; y: number; z: number }>) => void,
): Promise<SitesView> {
  const base = `${import.meta.env.BASE_URL}props/`;
  const dirs = LAYERS.map((k) => `${base}${manifest.textures[k] ?? manifest.textures.wall_concrete ?? ''}`);
  const [diffArr, norArr] = await Promise.all([loadArray(dirs.map((d) => `${d}diff.jpg`), 1024, true, anisotropy), loadArray(dirs.map((d) => `${d}nor.jpg`), 512, false, Math.min(4, anisotropy)), MeshoptSimplifier.ready]);
  const dummy = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  dummy.needsUpdate = true;
  const flat = new DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
  flat.needsUpdate = true;
  // map / normalMap 只是占位：让 three 生成贴图坐标和切线空间，真正采样的是贴图数组
  const structMat = new MeshStandardMaterial({ map: dummy, normalMap: flat, vertexColors: true, roughness: 1, metalness: 1 });
  structMat.normalScale.set(0.8, 0.8);
  structMat.onBeforeCompile = (sh) => {
    sh.uniforms.uSDiff = { value: diffArr };
    sh.uniforms.uSNor = { value: norArr };
    sh.uniforms.uWxSnow = WX.snow;
    // vUp：这个面有多朝上（地点的网格不旋转，模型空间的法线就是世界空间的）
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aLayer;\nvarying float vLayer;\nvarying float vUp;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLayer = aLayer;\nvUp = normal.y;');
    const normalMaps = ShaderChunk.normal_fragment_maps.replace('texture2D( normalMap, vNormalMapUv )', 'texture( uSNor, vec3( vNormalMapUv, sL ) )');
    if (normalMaps === ShaderChunk.normal_fragment_maps) console.warn('地点材质：法线贴图的采样语句没对上（three 版本变了？）');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform highp sampler2DArray uSDiff;
uniform highp sampler2DArray uSNor;
uniform float uWxSnow;
varying float vLayer;
varying float vUp;
const float sRough[${LAYERS.length}] = float[${LAYERS.length}](${ROUGH.map((v) => v.toFixed(2)).join(', ')});
const float sMetal[${LAYERS.length}] = float[${LAYERS.length}](${METAL.map((v) => v.toFixed(2)).join(', ')});`,
      )
      // 层号 ≥ 32 = 露天朝上的面（屋面、雨棚）：下雪变白。雪盖在贴图和顶点色上面，所以放在 color_fragment 之后
      .replace('#include <map_fragment>', 'float sL = floor(vLayer + 0.5);\nfloat sSnow = step(31.5, sL);\nsL -= 32.0 * sSnow;\ndiffuseColor *= texture( uSDiff, vec3( vMapUv, sL ) );')
      .replace('#include <color_fragment>', `#include <color_fragment>\ndiffuseColor.rgb = mix( diffuseColor.rgb, ${SNOW_RGB}, sSnow * uWxSnow * smoothstep( 0.3, 0.7, vUp ) * 0.94 );`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * sRough[int(sL)];')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = metalness * sMetal[int(sL)];')
      .replace('#include <normal_fragment_maps>', normalMaps);
  };
  structMat.customProgramCacheKey = () => 'openStruct4';
  // 窗玻璃：普通的半透明材质（不是透射：透射会让整个场景多画一遍）。双面、不写深度、一次画完
  const glassMat = new MeshStandardMaterial({ color: 0xffffff, vertexColors: true, transparent: true, roughness: 0.08, metalness: 0, depthWrite: false, side: DoubleSide });
  glassMat.forceSinglePass = true;

  const root = new Group();
  root.name = 'sites';
  const loader = new GLTFLoader();
  const models = new Map<string, Promise<Loaded | null>>();
  /** 等着传到显卡的贴图：每帧传一两张 */
  const uploads: Array<{ t: Texture; ok: () => void }> = [];
  let modelCount = 0;
  /** 重活（解析模型、合并、简化）排队：一帧只放行一件，几十个模型同时到也不会挤在同一帧里 */
  const jobs: Array<() => void> = [];
  let rush = false;
  const turn = (): Promise<void> => (rush ? Promise.resolve() : new Promise((ok) => jobs.push(ok)));
  /** 同时只下载、解析两个模型 */
  let active = 0;
  const waiting: Array<() => void> = [];
  const slot = async (): Promise<void> => {
    if (active >= 2) await new Promise<void>((ok) => waiting.push(ok));
    active++;
  };
  const release = (): void => {
    active--;
    waiting.shift()?.();
  };
  /** L：这个模型摆出来大概多大（米），决定简化版留多少面、多近换回原模型 */
  const getModel = (id: string, L: number): Promise<Loaded | null> => {
    let p = models.get(id);
    if (p) return p;
    p = (async () => {
      const f = manifest.assets[id];
      if (!f) return null;
      await slot();
      try {
        const model = await loadModel(loader, f.file, id);
        await turn();
        const merged = mergeParts(model);
        const seen = new Set<Texture>();
        for (const part of merged) {
          for (const k of TEX_KEYS) {
            const t = (part.mat as unknown as Record<string, Texture | null>)[k];
            if (t) seen.add(t);
          }
        }
        const cap = BIG.has(id) ? 1024 : 512;
        await Promise.all([...seen].map((t) => shrink(t, cap)));
        await Promise.all([...seen].map((t) => new Promise<void>((ok) => uploads.push({ t, ok }))));
        const total = merged.reduce((s, q) => s + (q.geo.index?.count ?? 0) / 3, 0);
        const budget = Math.min(2600, Math.max(80, 60 + 230 * L));
        const parts: Part[] = [];
        for (const q of merged) {
          let low: BufferGeometry | null = null;
          if (total > budget * 1.6) {
            await turn();
            low = simplify(q.geo, (budget * ((q.geo.index?.count ?? 0) / 3)) / total);
          }
          parts.push({ geo: q.geo, mat: q.mat, low });
        }
        modelCount++;
        return { parts, hiDist: Math.min(45, Math.max(7, L * 9)) };
      } catch (e) {
        console.warn(`地点：模型 ${id} 加载失败`, e);
        return null;
      } finally {
        release();
      }
    })();
    models.set(id, p);
    return p;
  };

  const views = new Map<number, View>();
  /** 画质档位的倍率（setQuality） */
  let kProps = 1;
  let kShadow = 1;
  let kLod = 1;
  let lampsDirty = false;
  let cam: PerspectiveCamera | null = null;

  const disposeView = (v: View): void => {
    v.dead = true;
    root.remove(v.group);
    v.struct?.geometry.dispose();
    v.glass?.geometry.dispose();
    for (const b of v.batches) for (const im of [...b.hi, ...b.lo]) im.dispose();
    if (v.ready) lampsDirty = true;
  };

  /** 按到相机的距离给每个实例分档：近的原模型、远的简化版，小东西太远就不画。只有档位变了才重写实例缓冲 */
  const partition = (v: View, x: number, z: number, force = false): void => {
    v.px = x;
    v.pz = z;
    const near = Math.hypot(v.site.x - x, v.site.z - z) - v.site.r < NEAR;
    const hd = v.hd;
    if (near) {
      const hs = v.content.interiors;
      for (let k = 0; k < hs.length; k++) {
        const r = (hs[k] as SiteContent['interiors'][number]).rect;
        hd[k] = Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));
      }
    }
    for (const b of v.batches) {
      if (!b.lo.length && !b.small && !force) continue;
      const hi2 = near ? (b.hiDist * kLod) ** 2 : -1;
      const cull2 = b.small ? (near ? (b.cull * kProps) ** 2 : -1) : Infinity;
      const house = b.small ? b.house : null;
      // 屋里的东西最多收到七成：再近的话走到门口才冒出来
      const rin = (b.tiny ? R_IN_TINY : R_IN) * Math.max(0.7, kProps);
      let changed = force;
      for (let i = 0; i < b.n; i++) {
        const dx = (b.px[i] as number) - x;
        const dz = (b.pz[i] as number) - z;
        const d2 = dx * dx + dz * dz;
        let s = d2 > cull2 ? 0 : d2 < hi2 || !b.lo.length ? 1 : 2;
        if (s && house && (hd[house[i] as number] as number) > rin) s = 0;
        if (s !== b.st[i]) {
          b.st[i] = s;
          changed = true;
        }
      }
      if (!changed) continue;
      let nh = 0;
      let nl = 0;
      for (let i = 0; i < b.n; i++) {
        const s = b.st[i];
        if (s === 0) continue;
        const list = s === 1 ? b.hi : b.lo;
        const at = (s === 1 ? nh++ : nl++) * 16;
        for (const im of list) {
          const a = im.instanceMatrix.array;
          for (let q = 0; q < 16; q++) a[at + q] = b.m[i * 16 + q] as number;
        }
      }
      for (const im of b.hi) {
        im.count = nh;
        im.visible = nh > 0;
        im.instanceMatrix.needsUpdate = true;
      }
      for (const im of b.lo) {
        im.count = nl;
        im.visible = nl > 0;
        im.instanceMatrix.needsUpdate = true;
      }
    }
  };

  const build = async (site: Site): Promise<void> => {
    const content = world.sites.content(site);
    const v: View = { site, content, group: new Group(), struct: null, glass: null, batches: [], ready: false, dead: false, shadow: false, hd: new Float32Array(content.interiors.length), px: Infinity, pz: Infinity };
    views.set(site.key, v);
    v.group.name = `site:${site.kind}:${site.i},${site.j}`;
    v.group.position.set(site.x, site.h, site.z);
    v.group.updateMatrixWorld(true);
    v.group.matrixAutoUpdate = false;
    // 内容生成、房子的网格、道具各占一帧：不挤在同一帧里
    await new Promise((r) => requestAnimationFrame(r));
    if (v.dead) return;
    if (content.walls.length + content.slabs.length + content.roofs.length) {
      const m = new Mesh(structGeometry(site, content), structMat);
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      m.name = 'struct';
      v.group.add(m);
      v.struct = m;
    }
    const gg = glassGeometry(site, content);
    if (gg) {
      const m = new Mesh(gg, glassMat);
      m.matrixAutoUpdate = false;
      m.name = 'glass';
      v.group.add(m);
      v.glass = m;
    }
    const byId = new Map<string, SiteContent['inst']>();
    const sizeOf = new Map<string, number>();
    for (const it of content.inst) {
      const key = `${it.id}|${it.small ? 1 : 0}|${it.house === undefined ? 0 : 1}`;
      let a = byId.get(key);
      if (!a) byId.set(key, (a = []));
      a.push(it);
      if (!sizeOf.has(it.id)) {
        const s = SIZE[it.id] ?? [1, 1, 1];
        sizeOf.set(it.id, Math.max(s[0] * it.sx, s[1] * it.sy, s[2] * it.sz));
      }
    }
    const loaded = new Map<string, Loaded | null>();
    await Promise.all([...sizeOf].map(async ([id, L]) => loaded.set(id, await getModel(id, L))));
    if (v.dead) return;
    for (const [key, list] of byId) {
      const [id, sm, ind] = key.split('|') as [string, string, string];
      const md = loaded.get(id);
      if (!md) continue;
      const n = list.length;
      const tiny = sm === '1' && (sizeOf.get(id) ?? 1) < TINY;
      const b: Batch = { hi: [], lo: [], m: new Float32Array(n * 16), px: new Float32Array(n), pz: new Float32Array(n), st: new Uint8Array(n).fill(1), n, small: sm === '1', cull: sm === '1' ? (tiny ? R_TINY : R_SMALL) : Infinity, tiny, house: ind === '1' ? new Int16Array(n) : null, hiDist: md.hiDist };
      list.forEach((it, i) => {
        _q.setFromAxisAngle(_up, it.ry);
        if (it.rx) _q.multiply(_qx.setFromAxisAngle(_xAxis, it.rx));
        const y = it.follow === undefined ? it.y : world.groundAt(it.x, it.z) - it.follow;
        _m.compose(_p.set(it.x - site.x, y - site.h, it.z - site.z), _q, _s.set(it.sx, it.sy, it.sz)).toArray(b.m, i * 16);
        b.px[i] = it.x;
        b.pz[i] = it.z;
        if (b.house) b.house[i] = it.house ?? 0;
      });
      const make = (geo: BufferGeometry, mat: Material, name: string): InstancedMesh => {
        const im = new InstancedMesh(geo, mat, n);
        im.instanceMatrix.array.set(b.m);
        im.instanceMatrix.needsUpdate = true;
        // 包围球按全部实例算一次（之后只改画几个，不再重算）
        im.computeBoundingSphere();
        im.receiveShadow = true;
        im.castShadow = false;
        im.matrixAutoUpdate = false;
        im.name = name;
        v.group.add(im);
        return im;
      };
      const hasLow = md.parts.some((p) => p.low);
      for (const p of md.parts) {
        b.hi.push(make(p.geo, p.mat, key));
        if (hasLow) b.lo.push(make(p.low ?? p.geo, p.mat, `${key}|low`));
      }
      v.batches.push(b);
    }
    v.group.updateMatrixWorld(true);
    if (cam) await precompile(renderer, v.group, cam, scene);
    if (v.dead) {
      disposeView(v);
      return;
    }
    partition(v, cam ? cam.position.x : site.x, cam ? cam.position.z : site.z, true);
    root.add(v.group);
    v.ready = true;
    lampsDirty = true;
  };

  const near: Site[] = [];
  let scanT = 0;
  let lastX = Infinity;
  let lastZ = Infinity;
  let instShown = 0;

  const scan = (x: number, z: number): void => {
    lastX = x;
    lastZ = z;
    near.length = 0;
    world.sites.near(x, z, R_LOAD, near);
    // 一帧最多开始加载一个地点（生成内容要几到二十毫秒）；先加载近的
    let best: Site | null = null;
    let bd = Infinity;
    for (const s of near) {
      if (views.has(s.key)) continue;
      const d = Math.hypot(s.x - x, s.z - z) - s.r;
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    if (best) void build(best);
    for (const [k, v] of views) {
      if (Math.hypot(v.site.x - x, v.site.z - z) - v.site.r > R_DROP) {
        disposeView(v);
        views.delete(k);
      }
    }
  };

  const update = (camera: PerspectiveCamera): void => {
    cam = camera;
    const x = camera.position.x;
    const z = camera.position.z;
    const job = jobs.shift();
    if (job) job();
    else {
      const u = uploads.shift();
      if (u) {
        renderer.initTexture(u.t);
        u.ok();
      }
    }
    if (--scanT <= 0 || Math.hypot(x - lastX, z - lastZ) > 40) {
      scanT = 12;
      scan(x, z);
    }
    instShown = 0;
    for (const v of views.values()) {
      if (!v.ready) continue;
      const d = Math.max(0, Math.hypot(v.site.x - x, v.site.z - z) - v.site.r);
      if (Math.hypot(x - v.px, z - v.pz) > (d < NEAR ? 1.5 : 30)) partition(v, x, z);
      const shadow = d < R_SHADOW * kShadow;
      if (shadow !== v.shadow) {
        v.shadow = shadow;
        if (v.struct) v.struct.castShadow = shadow;
        for (const b of v.batches) {
          if (b.tiny || (b.house && b.small)) continue;
          for (const im of b.hi) im.castShadow = shadow;
          for (const im of b.lo) im.castShadow = shadow;
        }
      }
      for (const b of v.batches) instShown += (b.hi[0]?.count ?? 0) + (b.lo[0]?.count ?? 0);
    }
    if (lampsDirty) {
      lampsDirty = false;
      const lamps: Array<{ x: number; y: number; z: number }> = [];
      for (const v of views.values()) if (v.ready) lamps.push(...v.content.lamps);
      onLamps(lamps);
    }
  };

  return {
    group: root,
    update,
    async settle(camera, radius = 420) {
      cam = camera;
      const want = world.sites.near(camera.position.x, camera.position.z, radius);
      for (const s of want) if (!views.has(s.key)) void build(s);
      const t0 = performance.now();
      // 开局 / 传送：不用一帧一件地排队，全速加载
      rush = true;
      for (;;) {
        for (let job = jobs.shift(); job; job = jobs.shift()) job();
        while (uploads.length) {
          const u = uploads.shift() as { t: Texture; ok: () => void };
          renderer.initTexture(u.t);
          u.ok();
        }
        if (want.every((s) => views.get(s.key)?.ready) || performance.now() - t0 > 30000) break;
        await new Promise((r) => setTimeout(r, 16));
      }
      rush = false;
      update(camera);
    },
    setQuality(q) {
      kProps = q.props;
      kShadow = q.shadow;
      kLod = q.lod;
      // 下一帧每个地点重新分一遍远近
      for (const v of views.values()) v.px = Infinity;
    },
    stats: () => ({ sites: [...views.values()].filter((v) => v.ready).length, building: [...views.values()].filter((v) => !v.ready).length, models: modelCount, inst: instShown }),
    dispose() {
      for (const v of views.values()) disposeView(v);
      views.clear();
      structMat.dispose();
      glassMat.dispose();
      diffArr.dispose();
      norArr.dispose();
    },
  };
}
