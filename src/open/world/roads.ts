import { hash2 } from './noise';

/**
 * 无限路网：480 米一格的网格，每格一个路口（位置随机抖动），相邻路口之间按概率连一条路。
 * i = 0 那一列永远连着：这是贯穿南北的公路（越往远处越危险的主线）。
 * 路口附近每条路先笔直伸出 ARM 米（地点模板可以假设路是正南北 / 正东西的），中间用贝塞尔曲线接起来。
 * 全部由种子算出来，不存任何东西；查过的路口和路段缓存在表里。
 */

export const GRID = 480;
const JIT = 110;
export const ARM = 64;
const SAMPLES = 16;

export type RoadKind = 'highway' | 'road' | 'dirt';
export const ROAD_W: Record<RoadKind, number> = { highway: 11, road: 7.5, dirt: 5 };

export interface RoadNode {
  i: number;
  j: number;
  x: number;
  z: number;
  /** 四个方向伸出去的路（没有就是 null）。北 = -z */
  n: RoadKind | null;
  s: RoadKind | null;
  e: RoadKind | null;
  w: RoadKind | null;
}

/** 两个路口之间的一条路：折线（x, z 交替）、每个点的累计长度 */
export interface Edge {
  key: string;
  kind: RoadKind;
  w: number;
  pts: Float32Array;
  cum: Float32Array;
  len: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface Seg {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  w: number;
  kind: RoadKind;
  /** 这一段起点沿整条路的累计长度（画虚线用） */
  s0: number;
}

export class Roads {
  private readonly nodes = new Map<number, RoadNode>();
  private readonly edges = new Map<string, Edge | null>();

  constructor(readonly seed: number) {}

  /** 路口 (i, j) → (i + 1, j) 的路 */
  kindH(i: number, j: number): RoadKind | null {
    if (hash2(i, j, this.seed + 11) < 0.42) return null;
    return hash2(i, j, this.seed + 12) < 0.5 ? 'road' : 'dirt';
  }

  /** 路口 (i, j) → (i, j + 1) 的路 */
  kindV(i: number, j: number): RoadKind | null {
    if (i === 0) return 'highway';
    if (hash2(i, j, this.seed + 13) < 0.55) return null;
    return hash2(i, j, this.seed + 14) < 0.4 ? 'road' : 'dirt';
  }

  node(i: number, j: number): RoadNode {
    const key = (i + 4096) * 8192 + (j + 4096);
    let n = this.nodes.get(key);
    if (n) return n;
    // 公路那一列左右少抖一点，公路大体是直的；出生点固定在原点
    const jx = i === 0 ? 36 : JIT;
    const origin = i === 0 && j === 0;
    n = {
      i,
      j,
      x: i * GRID + (origin ? 0 : (hash2(i, j, this.seed + 1) - 0.5) * 2 * jx),
      z: j * GRID + (origin ? 0 : (hash2(i, j, this.seed + 2) - 0.5) * 2 * JIT),
      n: this.kindV(i, j - 1),
      s: this.kindV(i, j),
      e: this.kindH(i, j),
      w: this.kindH(i - 1, j),
    };
    this.nodes.set(key, n);
    return n;
  }

  edge(axis: 'h' | 'v', i: number, j: number): Edge | null {
    const key = `${axis}${i},${j}`;
    const hit = this.edges.get(key);
    if (hit !== undefined) return hit;
    const kind = axis === 'h' ? this.kindH(i, j) : this.kindV(i, j);
    let e: Edge | null = null;
    if (kind) {
      const a = this.node(i, j);
      const b = axis === 'h' ? this.node(i + 1, j) : this.node(i, j + 1);
      const dx = axis === 'h' ? 1 : 0;
      const dz = axis === 'h' ? 0 : 1;
      const p0x = a.x + dx * ARM;
      const p0z = a.z + dz * ARM;
      const p3x = b.x - dx * ARM;
      const p3z = b.z - dz * ARM;
      const L = Math.hypot(p3x - p0x, p3z - p0z) / 3;
      const p1x = p0x + dx * L;
      const p1z = p0z + dz * L;
      const p2x = p3x - dx * L;
      const p2z = p3z - dz * L;
      const n = SAMPLES + 3;
      const pts = new Float32Array(n * 2);
      pts[0] = a.x;
      pts[1] = a.z;
      for (let k = 0; k <= SAMPLES; k++) {
        const t = k / SAMPLES;
        const u = 1 - t;
        const c0 = u * u * u;
        const c1 = 3 * u * u * t;
        const c2 = 3 * u * t * t;
        const c3 = t * t * t;
        pts[(k + 1) * 2] = c0 * p0x + c1 * p1x + c2 * p2x + c3 * p3x;
        pts[(k + 1) * 2 + 1] = c0 * p0z + c1 * p1z + c2 * p2z + c3 * p3z;
      }
      pts[(n - 1) * 2] = b.x;
      pts[(n - 1) * 2 + 1] = b.z;
      const cum = new Float32Array(n);
      let x0 = Infinity;
      let z0 = Infinity;
      let x1 = -Infinity;
      let z1 = -Infinity;
      for (let k = 0; k < n; k++) {
        const x = pts[k * 2] as number;
        const z = pts[k * 2 + 1] as number;
        if (k) cum[k] = (cum[k - 1] as number) + Math.hypot(x - (pts[k * 2 - 2] as number), z - (pts[k * 2 - 1] as number));
        x0 = Math.min(x0, x);
        z0 = Math.min(z0, z);
        x1 = Math.max(x1, x);
        z1 = Math.max(z1, z);
      }
      e = { key, kind, w: ROAD_W[kind], pts, cum, len: cum[n - 1] as number, x0, z0, x1, z1 };
    }
    // 表太大就清掉（走了几十公里以后）：都是算得出来的，清了再算
    if (this.edges.size > 4000) this.edges.clear();
    if (this.nodes.size > 4000) this.nodes.clear();
    this.edges.set(key, e);
    return e;
  }

  /** 包围盒（外扩 pad）碰到的所有路 */
  edgesIn(x0: number, z0: number, x1: number, z1: number, pad = 0): Edge[] {
    const out: Edge[] = [];
    const ia = Math.floor((x0 - pad) / GRID) - 1;
    const ib = Math.floor((x1 + pad) / GRID) + 1;
    const ja = Math.floor((z0 - pad) / GRID) - 1;
    const jb = Math.floor((z1 + pad) / GRID) + 1;
    for (let j = ja; j <= jb; j++) {
      for (let i = ia; i <= ib; i++) {
        for (const axis of ['h', 'v'] as const) {
          const e = this.edge(axis, i, j);
          if (e && e.x1 >= x0 - pad && e.x0 <= x1 + pad && e.z1 >= z0 - pad && e.z0 <= z1 + pad) out.push(e);
        }
      }
    }
    return out;
  }

  /** 包围盒（外扩 pad）碰到的路段 */
  segsIn(x0: number, z0: number, x1: number, z1: number, pad: number): Seg[] {
    const out: Seg[] = [];
    for (const e of this.edgesIn(x0, z0, x1, z1, pad)) {
      const p = e.pts;
      for (let k = 0; k + 3 < p.length; k += 2) {
        const ax = p[k] as number;
        const az = p[k + 1] as number;
        const bx = p[k + 2] as number;
        const bz = p[k + 3] as number;
        if (Math.max(ax, bx) < x0 - pad || Math.min(ax, bx) > x1 + pad || Math.max(az, bz) < z0 - pad || Math.min(az, bz) > z1 + pad) continue;
        out.push({ ax, az, bx, bz, w: e.w, kind: e.kind, s0: e.cum[k / 2] as number });
      }
    }
    return out;
  }
}
