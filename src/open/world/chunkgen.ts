import { hash2, noise2, sstep } from './noise';
import { ROAD_BED, WATER, type Ctx, type Terrain } from './terrain';

/**
 * 地形块的数据（纯计算，不碰 three）。四叉树：第 L 级的块边长 64 × 2^L 米，每块都是 32 × 32 格，
 * 所以近处 2 米一格、最远 16 米一格，每块的生成开销一样。
 * 树的位置按 64 米的基础格生成并缓存：同一棵树在各级里位置相同，远处是面片、走近换成模型。
 */

export const BASE = 64;
export const SEG = 32;
export const MAX_LEVEL = 3;
/** 高度网格带一圈边（算法线用），一行 SEG + 3 个点 */
export const ROW = SEG + 3;

export interface ChunkData {
  level: number;
  ix: number;
  iz: number;
  size: number;
  step: number;
  x0: number;
  z0: number;
  /** 高度，ROW × ROW，下标 (j + 1) * ROW + (i + 1) 对应第 (i, j) 个顶点 */
  h: Float32Array;
  /** 地面贴图权重，(SEG + 1)² × 4：A = 青草 / 枯草 / 林地 / 土，B = 岩石 / 沙 / 碎石 / 沥青 */
  wA: Uint8Array;
  wB: Uint8Array;
  /** 路面，(SEG + 1)² × 4：横向位置（带符号）、沿路长度、半宽（0 = 不是铺装路）、保守的无符号距离 */
  rd: Float32Array;
  minY: number;
  maxY: number;
}

const _w = new Float32Array(8);
function over(i: number, k: number): void {
  if (k <= 0) return;
  const q = 1 - Math.min(1, k);
  for (let n = 0; n < 8; n++) _w[n] = (_w[n] as number) * q;
  _w[i] = (_w[i] as number) + Math.min(1, k);
}

export function genChunk(t: Terrain, level: number, ix: number, iz: number): ChunkData {
  const size = BASE << level;
  const step = size / SEG;
  const x0 = ix * size;
  const z0 = iz * size;
  const ctx = t.ctx(x0 - step, z0 - step, x0 + size + step, z0 + size + step);
  const h = new Float32Array(ROW * ROW);
  let minY = Infinity;
  let maxY = -Infinity;
  for (let j = 0; j < ROW; j++) {
    const z = z0 + (j - 1) * step;
    for (let i = 0; i < ROW; i++) {
      const v = t.height(x0 + (i - 1) * step, z, ctx);
      h[j * ROW + i] = v;
      if (v < minY) minY = v;
      if (v > maxY) maxY = v;
    }
  }
  // 树林 / 干旱变化很慢（几百米），每块算 5 × 5 个点再插值
  const C = 5;
  const forest = new Float32Array(C * C);
  const dry = new Float32Array(C * C);
  for (let j = 0; j < C; j++) {
    for (let i = 0; i < C; i++) {
      const x = x0 + (i / (C - 1)) * size;
      const z = z0 + (j / (C - 1)) * size;
      forest[j * C + i] = t.forest(x, z);
      dry[j * C + i] = t.dry(x, z);
    }
  }
  const lerp2 = (a: Float32Array, u: number, v: number) => {
    const fx = u * (C - 1);
    const fz = v * (C - 1);
    const i = Math.min(C - 2, Math.floor(fx));
    const j = Math.min(C - 2, Math.floor(fz));
    const tx = fx - i;
    const tz = fz - j;
    const k = j * C + i;
    return ((a[k] as number) * (1 - tx) + (a[k + 1] as number) * tx) * (1 - tz) + ((a[k + C] as number) * (1 - tx) + (a[k + C + 1] as number) * tx) * tz;
  };
  const n = SEG + 1;
  const wA = new Uint8Array(n * n * 4);
  const wB = new Uint8Array(n * n * 4);
  const rd = new Float32Array(n * n * 4);
  const s = t.seed;
  for (let j = 0; j < n; j++) {
    const z = z0 + j * step;
    for (let i = 0; i < n; i++) {
      const x = x0 + i * step;
      const k = (j + 1) * ROW + (i + 1);
      const hh = h[k] as number;
      const sl = Math.hypot((h[k + 1] as number) - (h[k - 1] as number), (h[k + ROW] as number) - (h[k - ROW] as number)) / (2 * step);
      const n1 = noise2(x / 9, z / 9, s + 31) - 0.5;
      const F = lerp2(forest, i / SEG, j / SEG);
      const D = Math.max(0, Math.min(1, lerp2(dry, i / SEG, j / SEG) + n1 * 0.25));
      _w.fill(0);
      _w[0] = 1 - D;
      _w[1] = D;
      over(2, sstep(0.5, 0.82, F + n1 * 0.35) * 0.9);
      over(3, sstep(0.7, 0.95, D + n1 * 0.6) * 0.75);
      over(5, sstep(WATER + 1.7, WATER + 0.4, hh + n1 * 0.9));
      over(4, Math.max(sstep(0.5, 0.85, sl + n1 * 0.2), sstep(60, 100, hh + n1 * 14) * 0.7));
      const r = t.road(x, z, ctx, 24);
      const ro = (j * n + i) * 4;
      // 没有路的顶点：横向位置写成很远，插值出来的路面遮罩是 0
      rd[ro] = 40;
      rd[ro + 3] = 40;
      if (r && r.kind !== 'dirt') {
        rd[ro] = r.side;
        rd[ro + 1] = r.along;
        rd[ro + 2] = r.w / 2;
        // 保守的无符号距离：相邻两个顶点分在路的两侧（一个带符号、一个是「很远」），或者最近的路不是同一条时，
        // 带符号的横向位置插值会穿过 0，在离路二十多米的地方画出一道假路面。这个值不会穿过 0，着色器取两者里大的
        rd[ro + 3] = r.d - step * 1.5;
      }
      if (r && r.d < 14) {
        const e = r.w / 2;
        if (r.kind === 'dirt') {
          const kk = sstep(e + 1.4, e - 0.8, r.d + n1 * 1.8);
          over(3, kk * 0.8);
          over(6, kk * 0.25);
        } else {
          // 路肩碎石；路面本身由着色器按 rd 画（边缘是清晰的）
          over(6, sstep(e + ROAD_BED + 1.5, e + 0.3, r.d + n1) * 0.85);
        }
      }
      const fa = t.flatAt(x, z, ctx);
      if (fa?.f.paint) {
        const f = fa.f;
        const m = Math.min(x - f.x0, f.x1 - x, z - f.z0, f.z1 - z);
        const kk = sstep(-2.5, 2, m + n1 * 4);
        over(f.paint === 'asphalt' ? 7 : f.paint === 'dirt' || f.paint === 'field' ? 3 : 6, kk);
      }
      let sum = 0;
      for (let q = 0; q < 8; q++) sum += _w[q] as number;
      const o = (j * n + i) * 4;
      for (let q = 0; q < 4; q++) {
        wA[o + q] = Math.round(((_w[q] as number) / sum) * 255);
        wB[o + q] = Math.round(((_w[q + 4] as number) / sum) * 255);
      }
    }
  }
  return { level, ix, iz, size, step, x0, z0, h, wA, wB, rd, minY, maxY };
}

/** 块里任意点的高度：和渲染的三角形完全一致（对角线 b–c） */
export function chunkHeight(c: ChunkData, x: number, z: number): number {
  const gx = (x - c.x0) / c.step;
  const gz = (z - c.z0) / c.step;
  const i = Math.max(0, Math.min(SEG - 1, Math.floor(gx)));
  const j = Math.max(0, Math.min(SEG - 1, Math.floor(gz)));
  const fx = Math.min(1, Math.max(0, gx - i));
  const fz = Math.min(1, Math.max(0, gz - j));
  const k = (j + 1) * ROW + (i + 1);
  const a = c.h[k] as number;
  const b = c.h[k + 1] as number;
  const cc = c.h[k + ROW] as number;
  if (fx + fz <= 1) return a + (b - a) * fx + (cc - a) * fz;
  const d = c.h[k + ROW + 1] as number;
  return d + (cc - d) * (1 - fx) + (b - d) * (1 - fz);
}

// ---------------------------------------------------------------- 植被（按 64 米基础格）

export interface Plant {
  /** 0–3 树的品种（0 / 1 针叶，2 / 3 阔叶），4 灌木，5 石头，6 倒木，7 枯树 */
  kind: number;
  x: number;
  y: number;
  z: number;
  ry: number;
  /** 树 / 灌木：高度（米）；石头：直径 */
  s: number;
}

const plantCache = new Map<number, Plant[]>();

/** 一个基础格里的树、灌木、石头（缓存；位置只由种子和格子决定） */
export function plantsInCell(t: Terrain, bx: number, bz: number): Plant[] {
  const key = (bx + 32768) * 65536 + (bz + 32768);
  const hit = plantCache.get(key);
  if (hit) return hit;
  const out: Plant[] = [];
  const x0 = bx * BASE;
  const z0 = bz * BASE;
  const ctx: Ctx = t.ctx(x0, z0, x0 + BASE, z0 + BASE);
  const s = t.seed;
  const G = 8;
  const cell = BASE / G;
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      const id = (bx * G + i) * 73856093 + (bz * G + j) * 19349663;
      const r0 = hash2(id, 1, s + 41);
      const x = x0 + (i + hash2(id, 2, s + 42)) * cell;
      const z = z0 + (j + hash2(id, 3, s + 43)) * cell;
      const F = t.forest(x, z);
      const D = t.dry(x, z);
      // 树：林子里密（留一些空隙），草地上零星几棵，荒地很少
      const pTree = Math.min(0.72, F * F * 0.9) + 0.03 * (1 - D);
      const pBush = 0.1 + F * 0.12;
      const pRock = 0.035 + t.hillMask(x, z) * 0.2;
      let kind = -1;
      // 成片的林相：这一带是针叶林（品种 0 / 1）还是阔叶林（2 / 3），由大尺度噪声决定，交界处混着长
      if (r0 < pTree) kind = (noise2(x / 380, z / 380, s + 47) + (hash2(id, 7, s + 48) - 0.5) * 0.3 > 0.5 ? 2 : 0) + (hash2(id, 4, s + 44) < 0.6 ? 0 : 1);
      else if (r0 < pTree + pBush) kind = 4;
      else if (r0 < pTree + pBush + pRock) kind = 5;
      else if (r0 < pTree + pBush + pRock + 0.012 * F) kind = 6;
      if (kind < 0) continue;
      // 干旱的地方一部分树是枯死的
      if (kind < 4 && D > 0.55 && hash2(id, 8, s + 49) < (D - 0.55) * 0.9) kind = 7;
      const tree = kind < 4 || kind === 7;
      const road = t.road(x, z, ctx, 12);
      if (road && road.d < road.w / 2 + (tree ? 4.5 : 2.5)) continue;
      const fa = t.flatAt(x, z, ctx);
      if (fa && fa.k > 0.03) continue;
      const y = t.height(x, z, ctx);
      if (y < WATER + 0.5) continue;
      const sl = Math.hypot(t.height(x + 1.5, z, ctx) - t.height(x - 1.5, z, ctx), t.height(x, z + 1.5, ctx) - t.height(x, z - 1.5, ctx)) / 3;
      if (kind !== 5 && sl > 0.7) continue;
      const r1 = hash2(id, 5, s + 45);
      const size = tree ? 7 + r1 * 7 : kind === 4 ? 0.9 + r1 * 1.3 : kind === 5 ? 0.8 + r1 * r1 * 3.2 : 3.5 + r1 * 3;
      out.push({ kind, x, y, z, ry: hash2(id, 6, s + 46) * 6.283, s: size });
    }
  }
  if (plantCache.size > 6000) plantCache.clear();
  plantCache.set(key, out);
  return out;
}
