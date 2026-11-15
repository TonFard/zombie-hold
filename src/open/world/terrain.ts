import { fbm, sstep } from './noise';
import type { RoadKind, Roads, Seg } from './roads';

/**
 * 无限地形：高度是 (x, z) 的纯函数——大丘陵 + 中丘陵 + 小起伏，局部有陡峭的石山（离路远的地方才长出来），
 * 路面和地点压平，低于水位的洼地是湖。不存任何数组，哪里都能算，所以地图没有边。
 * 坐标：x 向东、z 向南（北 = -z），原点是出生营地旁的路口。
 */

/** 全图同一个水位：比它低的地方是水 */
export const WATER = -13;

export type Paint = 'concrete' | 'asphalt' | 'gravel' | 'dirt' | 'field';

/** 一块压平的地（地点用）：矩形内部高度 = h，外面 blend 米内过渡回自然地形 */
export interface Flat {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  h: number;
  blend: number;
  paint?: Paint;
}

export interface RoadHit {
  d: number;
  w: number;
  kind: RoadKind;
  /** 中线上最近的点 */
  px: number;
  pz: number;
  /** 沿路方向（单位向量） */
  tx: number;
  tz: number;
  /** 横向位置（米，带符号：路的左边为负、右边为正） */
  side: number;
  /** 沿路的累计长度（米） */
  along: number;
}

/** 一片区域里要用到的路段和压平区：生成一个地形块时先取一次，块里每个点都用它 */
/** 地形眼里的一个地点：一个圆（石山不往上长）、路口周围的一块平台（路面和地点一样高）、若干压平区 */
export interface SiteRef {
  x: number;
  z: number;
  r: number;
  nx: number;
  nz: number;
  h: number;
  plateau: number;
  flats: Flat[];
}

export interface Ctx {
  segs: Seg[];
  flats: Flat[];
  sites: SiteRef[];
}

/** 路面两边再压平这么宽（米）：路面带子贴在上面，最细的网格（2 米一格）不会从带子边上戳出来 */
export const ROAD_BED = 3;
const ROAD_BLEND = 11;
/** 石山离路多远才开始长、多远长到全高 */
const HILL_NEAR = 80;
const HILL_FAR = 260;

export class Terrain {
  /** 由 Sites 填：取一片区域里的压平区 */
  sitesIn: (x0: number, z0: number, x1: number, z1: number, out: SiteRef[]) => void = () => {};

  constructor(
    readonly seed: number,
    readonly roads: Roads,
  ) {}

  /** 路面 / 地点用的平滑高度：只有大尺度那两层，并且不低于水面（路过洼地时是一条堤） */
  smooth(x: number, z: number): number {
    const s = this.seed;
    return Math.max(WATER + 1.4, fbm(x / 900, z / 900, s, 4) * 60 + fbm(x / 260, z / 260, s + 101, 4) * 16 * 0.5);
  }

  /** 石山的强度 0–1（大部分地方是 0） */
  hillMask(x: number, z: number): number {
    const m = fbm(x / 1400, z / 1400, this.seed + 500, 3) - 0.1;
    return m <= 0 ? 0 : Math.min(1, m * 3.2);
  }

  /** 树林的浓密程度 0–1 */
  forest(x: number, z: number): number {
    return Math.max(0, Math.min(1, fbm(x / 520, z / 520, this.seed + 900, 3) * 2.4 + 0.46));
  }

  /** 干旱程度 0–1：0 = 青草地，1 = 枯黄的荒地 */
  dry(x: number, z: number): number {
    // 出生点周围 600 米一定是青草地，再远才按噪声变
    const d = Math.hypot(x, z);
    return Math.max(0, Math.min(1, fbm(x / 1300, z / 1300, this.seed + 950, 3) * 2.6 + 0.4)) * sstep(250, 900, d);
  }

  /** 危险度：离出生点每公里 +1（0 起，不封顶） */
  danger(x: number, z: number): number {
    return Math.hypot(x, z) / 1000;
  }

  ctx(x0: number, z0: number, x1: number, z1: number): Ctx {
    const flats: Flat[] = [];
    const sites: SiteRef[] = [];
    this.sitesIn(x0, z0, x1, z1, sites);
    for (const s of sites) for (const f of s.flats) if (f.x1 + f.blend > x0 - 40 && f.x0 - f.blend < x1 + 40 && f.z1 + f.blend > z0 - 40 && f.z0 - f.blend < z1 + 40) flats.push(f);
    return { segs: this.roads.segsIn(x0, z0, x1, z1, HILL_FAR), flats, sites };
  }

  /** 路面高度：有地点的路口周围是一块平台（路和地点一样高），往外 90 米过渡回自然起伏 */
  roadH(x: number, z: number, ctx: Ctx): number {
    let h = this.smooth(x, z);
    for (const s of ctx.sites) {
      const d = Math.hypot(x - s.nx, z - s.nz);
      if (d < s.plateau + 90) h = s.h + (h - s.h) * sstep(s.plateau, s.plateau + 90, d);
    }
    return h;
  }

  /** 最近的路（只看 maxD 米以内的） */
  road(x: number, z: number, ctx: Ctx, maxD = 40): RoadHit | null {
    let best: RoadHit | null = null;
    let score = Infinity;
    for (const s of ctx.segs) {
      if (x < Math.min(s.ax, s.bx) - maxD || x > Math.max(s.ax, s.bx) + maxD || z < Math.min(s.az, s.bz) - maxD || z > Math.max(s.az, s.bz) + maxD) continue;
      const vx = s.bx - s.ax;
      const vz = s.bz - s.az;
      const L2 = vx * vx + vz * vz;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - s.ax) * vx + (z - s.az) * vz) / L2)) : 0;
      const px = s.ax + vx * t;
      const pz = s.az + vz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d > maxD) continue;
      // 路口：两条路离得一样近时按宽的那条算
      const sc = d - s.w * 0.01;
      if (sc < score) {
        const L = Math.sqrt(L2) || 1;
        score = sc;
        const cross = (vx * (z - s.az) - vz * (x - s.ax)) / L;
        best = { d, w: s.w, kind: s.kind, px, pz, tx: vx / L, tz: vz / L, side: cross < 0 ? -d : d, along: s.s0 + t * L };
      }
    }
    return best;
  }

  /** 自然地形（没有路、没有压平） */
  base(x: number, z: number): number {
    const s = this.seed;
    return fbm(x / 900, z / 900, s, 4) * 60 + fbm(x / 260, z / 260, s + 101, 4) * 16 + fbm(x / 64, z / 64, s + 202, 3) * 2.6 + fbm(x / 15, z / 15, s + 303, 2) * 0.3;
  }

  /** 最终地面高度 */
  height(x: number, z: number, ctx: Ctx = this.ctx(x, z, x, z)): number {
    let h = this.base(x, z);
    const hk = this.hillMask(x, z);
    const r = this.road(x, z, ctx, hk > 0 ? HILL_FAR : ROAD_BED + ROAD_BLEND + 8);
    if (hk > 0) {
      let far = sstep(HILL_NEAR, HILL_FAR, r ? r.d : HILL_FAR);
      if (far > 0) for (const s of ctx.sites) far *= sstep(s.r - 10, s.r + 150, Math.hypot(x - s.x, z - s.z));
      if (far > 0) {
        // 山脊：1 - |噪声| 是尖的，平方以后山脚缓、山顶陡
        const ridge = 1 - Math.abs(fbm(x / 210, z / 210, this.seed + 600, 4));
        h += hk * hk * far * (30 + ridge * ridge * 95);
      }
    }
    if (r) {
      const bed = r.w / 2 + ROAD_BED;
      if (r.d < bed + ROAD_BLEND) {
        const k = 1 - sstep(0, 1, (r.d - bed) / ROAD_BLEND);
        h += (this.roadH(r.px, r.pz, ctx) - h) * k;
      }
    }
    for (const f of ctx.flats) {
      const dx = Math.max(f.x0 - x, 0, x - f.x1);
      const dz = Math.max(f.z0 - z, 0, z - f.z1);
      if (dx >= f.blend || dz >= f.blend) continue;
      const d = Math.hypot(dx, dz);
      if (d >= f.blend) continue;
      h += (f.h - h) * (1 - sstep(0, 1, d / f.blend));
    }
    return h;
  }

  /** (x, z) 处起作用最强的压平区和它的权重 */
  flatAt(x: number, z: number, ctx: Ctx): { f: Flat; k: number } | null {
    let best: { f: Flat; k: number } | null = null;
    for (const f of ctx.flats) {
      const dx = Math.max(f.x0 - x, 0, x - f.x1);
      const dz = Math.max(f.z0 - z, 0, z - f.z1);
      const d = Math.hypot(dx, dz);
      if (d >= f.blend) continue;
      const k = 1 - sstep(0, 1, d / f.blend);
      if (!best || k > best.k) best = { f, k };
    }
    return best;
  }
}
