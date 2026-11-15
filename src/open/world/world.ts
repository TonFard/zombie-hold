import { BASE, plantsInCell, type Plant } from './chunkgen';
import { Roads } from './roads';
import { Sites, type Site } from './sites';
import { Terrain, WATER, type Ctx } from './terrain';

/**
 * 无限世界的总入口：种子 → 路网 → 地形 → 植被 → 地点。所有东西都是按坐标算出来的，
 * 这里只管缓存和「玩家周围」的碰撞查询。地点（sites.ts）加载时把自己的压平区和碰撞体挂进来。
 */

const TREE_R = 0.035;

/** 会动的碰撞体（车）：挡人、能站在车顶上 */
export interface DynCollider {
  resolve(p: { x: number; z: number }, feet: number, height: number, r: number, step: number): boolean;
  topAt(x: number, z: number, r: number, feet: number, step: number): number;
  /** 射线打到外壳的距离（没打到返回 Infinity） */
  raycast?(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): number;
}

/** 射线打到了什么 */
export type HitKind = 'none' | 'ground' | 'solid' | 'tree' | 'rock' | 'car';

export class World {
  readonly roads: Roads;
  readonly terrain: Terrain;
  readonly sites: Sites;
  /** 车这类会动的碰撞体（玩家走路时挡人；车和地图碰撞时不算，车和车单独算） */
  readonly dynamic: DynCollider[] = [];
  /** 渲染层提供：按最细那档地形网格的三角形插值（和看到的地面完全一致）；没加载到就返回 null */
  exactHeight: (x: number, z: number) => number | null = () => null;
  private readonly ctxCache = new Map<number, Ctx>();
  /** 最近一次 raycast 打到的是什么 */
  hitKind: HitKind = 'none';
  private readonly raySites: Site[] = [];

  constructor(readonly seed: number) {
    this.roads = new Roads(seed);
    this.terrain = new Terrain(seed, this.roads);
    this.sites = new Sites(seed, this.roads, this.terrain);
    this.terrain.sitesIn = (x0, z0, x1, z1, out) => this.sites.sitesIn(x0, z0, x1, z1, out);
  }

  /** 64 米格的上下文（路段 + 压平区），缓存 */
  ctxAt(x: number, z: number): Ctx {
    const bx = Math.floor(x / BASE);
    const bz = Math.floor(z / BASE);
    const key = (bx + 32768) * 65536 + (bz + 32768);
    let c = this.ctxCache.get(key);
    if (!c) {
      if (this.ctxCache.size > 800) this.ctxCache.clear();
      c = this.terrain.ctx(bx * BASE, bz * BASE, (bx + 1) * BASE, (bz + 1) * BASE);
      this.ctxCache.set(key, c);
    }
    return c;
  }

  /** 地点加载 / 卸载后压平区变了：清缓存 */
  invalidate(): void {
    this.ctxCache.clear();
  }

  /** 解析高度（任何地方都能算） */
  heightAt(x: number, z: number): number {
    return this.terrain.height(x, z, this.ctxAt(x, z));
  }

  /** 玩家 / 车脚下的地面：优先用渲染网格的高度 */
  groundAt(x: number, z: number): number {
    return this.exactHeight(x, z) ?? this.heightAt(x, z);
  }

  waterDepth(x: number, z: number): number {
    return Math.max(0, WATER - this.groundAt(x, z));
  }

  slopeAt(x: number, z: number): number {
    return Math.hypot(this.groundAt(x + 1, z) - this.groundAt(x - 1, z), this.groundAt(x, z + 1) - this.groundAt(x, z - 1)) / 2;
  }

  /** (x, z) 周围 r 米内的植被 */
  plantsNear(x: number, z: number, r: number, out: Plant[] = []): Plant[] {
    const b0 = Math.floor((x - r) / BASE);
    const b1 = Math.floor((x + r) / BASE);
    const c0 = Math.floor((z - r) / BASE);
    const c1 = Math.floor((z + r) / BASE);
    for (let bz = c0; bz <= c1; bz++) {
      for (let bx = b0; bx <= b1; bx++) {
        for (const p of plantsInCell(this.terrain, bx, bz)) if (Math.hypot(p.x - x, p.z - z) < r) out.push(p);
      }
    }
    return out;
  }

  /** 把圆柱（脚底 feet、身高 height、半径 r）从树、石头和地点的碰撞体里推出来 */
  collide(p: { x: number; z: number }, feet: number, height: number, r: number, step: number, withDynamic = true): boolean {
    let hit = false;
    for (const pl of this.plantsNear(p.x, p.z, 5)) {
      // 树干：半径跟着树高走；石头：按直径的 0.38；灌木、倒木不挡
      const pr = pl.kind < 4 || pl.kind === 7 ? Math.min(0.5, pl.s * TREE_R) : pl.kind === 5 ? pl.s * 0.38 : 0;
      if (pr <= 0) continue;
      if (pl.kind === 5 && pl.y + pl.s * 0.55 <= feet + step) continue;
      const dx = p.x - pl.x;
      const dz = p.z - pl.z;
      const d = Math.hypot(dx, dz);
      if (d >= pr + r) continue;
      if (d > 1e-5) {
        p.x = pl.x + (dx / d) * (pr + r);
        p.z = pl.z + (dz / d) * (pr + r);
      } else p.x += pr + r;
      hit = true;
    }
    for (const c of this.sites.collidersNear(p.x, p.z, r + 2)) if (c.resolve(p, feet, height, r, step)) hit = true;
    if (withDynamic) for (const d of this.dynamic) if (d.resolve(p, feet, height, r, step)) hit = true;
    return hit;
  }

  /**
   * 射线（方向已归一化）在 max 米以内打到的最近的东西：返回距离（没打到返回 Infinity），打到的是什么记在 hitKind 里。
   * 算上：地点的碰撞体（墙、地板、家具、车的残骸）、会动的车、树干和石头、地面（terrain = false 时不算地面：视线检查用，便宜）
   */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number, terrain = true): number {
    let best = max;
    let kind: HitKind = 'none';
    // 地点：只查已经生成过内容的（玩家周围的都生成过了）
    const hit = this.raySites;
    hit.length = 0;
    this.sites.near(ox + dx * max * 0.5, oz + dz * max * 0.5, max * 0.5 + 2, hit);
    for (const s of hit) {
      const c = this.sites.peek(s);
      if (!c) continue;
      const d = c.cols.raycast(ox, oy, oz, dx, dy, dz, best);
      if (d < best) {
        best = d;
        kind = 'solid';
      }
    }
    for (const v of this.dynamic) {
      const d = v.raycast ? v.raycast(ox, oy, oz, dx, dy, dz, best) : Infinity;
      if (d < best) {
        best = d;
        kind = 'car';
      }
    }
    // 树干、石头：沿着射线每 32 米看一眼所在的 64 米格
    let lastKey = -1;
    for (let t = 0; t <= Math.min(best, 260) + 32; t += 32) {
      const tt = Math.min(t, best);
      const bx = Math.floor((ox + dx * tt) / BASE);
      const bz = Math.floor((oz + dz * tt) / BASE);
      const key = (bx + 32768) * 65536 + (bz + 32768);
      if (key === lastKey) continue;
      lastKey = key;
      for (const pl of plantsInCell(this.terrain, bx, bz)) {
        const tree = pl.kind < 4 || pl.kind === 7;
        if (!tree && pl.kind !== 5) continue;
        const r = tree ? Math.min(0.5, pl.s * TREE_R) : pl.s * 0.38;
        const top = pl.y + (tree ? pl.s * 0.55 : pl.s * 0.5);
        const rx = ox - pl.x;
        const rz = oz - pl.z;
        const a = dx * dx + dz * dz;
        if (a < 1e-9) continue;
        const hb = rx * dx + rz * dz;
        const disc = hb * hb - a * (rx * rx + rz * rz - r * r);
        if (disc < 0) continue;
        const d = (-hb - Math.sqrt(disc)) / a;
        if (d < 0 || d >= best) continue;
        const y = oy + dy * d;
        if (y < pl.y - 0.5 || y > top) continue;
        best = d;
        kind = tree ? 'tree' : 'rock';
      }
    }
    // 地面：一步一步走，钻到地面以下就二分找交点
    if (terrain) {
      let t0 = 0;
      for (let t = 0.6; t0 < best; t += t < 40 ? 1 : t < 120 ? 2 : 4) {
        const tt = Math.min(t, best);
        const y = oy + dy * tt;
        if (y < this.groundAt(ox + dx * tt, oz + dz * tt)) {
          let a = t0;
          let b = tt;
          for (let k = 0; k < 6; k++) {
            const m = (a + b) / 2;
            if (oy + dy * m < this.groundAt(ox + dx * m, oz + dz * m)) b = m;
            else a = m;
          }
          best = a;
          kind = 'ground';
          break;
        }
        // 往上打、已经高出地面很多：不会再碰到地面了
        if (dy > 0.02 && y > 140) break;
        t0 = tt;
        if (tt >= best) break;
      }
    }
    this.hitKind = kind;
    return best < max ? best : Infinity;
  }

  /** 脚下能站的碰撞体顶面（房子的地板、台子）；没有返回 -Infinity */
  topAt(x: number, z: number, r: number, feet: number, step: number): number {
    let top = -Infinity;
    for (const c of this.sites.collidersNear(x, z, r + 2)) top = Math.max(top, c.topAt(x, z, r, feet, step));
    for (const d of this.dynamic) top = Math.max(top, d.topAt(x, z, r, feet, step));
    return top;
  }
}
