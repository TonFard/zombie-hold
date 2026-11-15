import type { Colliders } from '../world/colliders';
import type { Interior, Site } from '../world/sites';
import type { World } from '../world/world';

/**
 * 丧尸找路：每个地点一张 0.4 米一格的「能不能站」位图，直接从地点的碰撞体（墙、家具、围栏、集装箱）栅格化出来，
 * 所以屋里屋外、门、围墙的缺口用的是同一套，不用单独记门在哪。地点以外是野地：只有树和石头，贴着滑过去就行，不用找路。
 *
 * 为什么是 0.4 米、留 0.26 米的余量：门洞宽 1.08 米（一格 1 米，两边的墙各缩 4 厘米），
 * 人的中心离门框 0.26 米以上才算能站，门洞里能站的那一条宽 0.56 米，比格子大，所以不管房子怎么对齐，门洞里至少有一列格子是通的。
 * 丧尸自己的碰撞半径是 0.3，走偏了几厘米由 world.collide 推回来。
 */

export const NAV_CELL = 0.4;
const CLEAR = 0.26;
/** 顶面比地面高不到这么多的东西（地板、托盘、路肩）能直接迈上去，不算障碍 */
const STEP = 0.49;
/** 底面比地面高出这么多的东西（门楣、雨棚）从下面走过去 */
const BODY = 1.5;
/** 一次搜索最多展开多少格（约 2–3 毫秒） */
export const MAX_EXPAND = 6000;
/** 一帧里所有搜索加起来大约展开这么多格（不到 1 毫秒）。每帧的第一次搜索不受它限制，不然大的搜索永远排不上 */
export const FRAME_EXPAND = 2000;
const SQ2 = Math.SQRT2;

// 搜索用的草稿（所有地点共用；按最大的那张图开）
let gCost = new Float32Array(0);
let parent = new Int32Array(0);
let stamp = new Uint32Array(0);
let searchId = 0;
const heap: number[] = [];
const heapF: number[] = [];
const cells: number[] = [];
const pts: number[] = [];

function heapPush(heap: number[], heapF: number[], node: number, f: number): void {
  let i = heap.length;
  heap.push(node);
  heapF.push(f);
  while (i > 0) {
    const p = (i - 1) >> 1;
    if ((heapF[p] as number) <= f) break;
    heap[i] = heap[p] as number;
    heapF[i] = heapF[p] as number;
    i = p;
  }
  heap[i] = node;
  heapF[i] = f;
}

function heapPop(heap: number[], heapF: number[]): number {
  const top = heap[0] as number;
  const node = heap.pop() as number;
  const f = heapF.pop() as number;
  const n = heap.length;
  if (n > 0) {
    let i = 0;
    for (;;) {
      let c = i * 2 + 1;
      if (c >= n) break;
      if (c + 1 < n && (heapF[c + 1] as number) < (heapF[c] as number)) c++;
      if ((heapF[c] as number) >= f) break;
      heap[i] = heap[c] as number;
      heapF[i] = heapF[c] as number;
      i = c;
    }
    heap[i] = node;
    heapF[i] = f;
  }
  return top;
}

/** 一个地点的位图 */
export class SiteNav {
  readonly x0: number;
  readonly z0: number;
  readonly n: number;
  readonly blocked: Uint8Array;
  /** 最近一次用到是什么时候（Nav 淘汰旧图用） */
  used = 0;
  /** 上一次 path() 展开了多少格 */
  expanded = 0;
  /** 上一次 path() 是到了上限停的（还有地方没搜）：不是真的走不到，是太绕 */
  cut = false;
  /** 每格在哪栋房子里（houses 的下标 + 1，0 = 屋外）。按房子里能站的格子标的，所以 L 形房子缺的那一角算屋外 */
  private readonly inHouse: Uint8Array;

  constructor(
    readonly site: Site,
    cols: Colliders,
    private readonly houses: readonly Interior[] = [],
  ) {
    const R = site.r + 6;
    this.n = Math.ceil((2 * R) / NAV_CELL);
    this.x0 = site.x - R;
    this.z0 = site.z - R;
    const n = this.n;
    const map = (this.blocked = new Uint8Array(n * n));
    const lo = site.h + STEP;
    const hi = site.h + BODY;
    const idx = (v: number, o: number): number => (v - o) / NAV_CELL - 0.5;
    for (const b of cols.boxes) {
      if (b.y1 <= lo || b.y0 >= hi) continue;
      const ex = Math.abs(b.c) * b.hx + Math.abs(b.s) * b.hz + CLEAR;
      const ez = Math.abs(b.s) * b.hx + Math.abs(b.c) * b.hz + CLEAR;
      const i0 = Math.max(0, Math.ceil(idx(b.x - ex, this.x0)));
      const i1 = Math.min(n - 1, Math.floor(idx(b.x + ex, this.x0)));
      const j0 = Math.max(0, Math.ceil(idx(b.z - ez, this.z0)));
      const j1 = Math.min(n - 1, Math.floor(idx(b.z + ez, this.z0)));
      for (let j = j0; j <= j1; j++) {
        const dz = this.z0 + (j + 0.5) * NAV_CELL - b.z;
        for (let i = i0; i <= i1; i++) {
          const dx = this.x0 + (i + 0.5) * NAV_CELL - b.x;
          // 和 Colliders.resolve 一样的换算：点到盒子的最近距离
          const lx = dx * b.c - dz * b.s;
          const lz = dx * b.s + dz * b.c;
          const px = lx - Math.max(-b.hx, Math.min(b.hx, lx));
          const pz = lz - Math.max(-b.hz, Math.min(b.hz, lz));
          if (px * px + pz * pz < CLEAR * CLEAR) map[j * n + i] = 1;
        }
      }
    }
    for (const c of cols.circles) {
      if (c.y1 <= lo || c.y0 >= hi) continue;
      const r = c.r + CLEAR;
      const i0 = Math.max(0, Math.ceil(idx(c.x - r, this.x0)));
      const i1 = Math.min(n - 1, Math.floor(idx(c.x + r, this.x0)));
      const j0 = Math.max(0, Math.ceil(idx(c.z - r, this.z0)));
      const j1 = Math.min(n - 1, Math.floor(idx(c.z + r, this.z0)));
      for (let j = j0; j <= j1; j++) {
        const dz = this.z0 + (j + 0.5) * NAV_CELL - c.z;
        for (let i = i0; i <= i1; i++) {
          const dx = this.x0 + (i + 0.5) * NAV_CELL - c.x;
          if (dx * dx + dz * dz < r * r) map[j * n + i] = 1;
        }
      }
    }
    // 房子里的格子（一米一格，房子可能是斜着放的）：格子中心 0.75 米以内的都算这栋房子里
    const inH = (this.inHouse = new Uint8Array(n * n));
    const HR = 0.75;
    for (let hi = 0; hi < houses.length && hi < 255; hi++) {
      const f = (houses[hi] as Interior).free;
      for (let q = 0; q + 1 < f.length; q += 2) {
        const fx = f[q] as number;
        const fz = f[q + 1] as number;
        const i0 = Math.max(0, Math.ceil(idx(fx - HR, this.x0)));
        const i1 = Math.min(n - 1, Math.floor(idx(fx + HR, this.x0)));
        const j0 = Math.max(0, Math.ceil(idx(fz - HR, this.z0)));
        const j1 = Math.min(n - 1, Math.floor(idx(fz + HR, this.z0)));
        for (let j = j0; j <= j1; j++) {
          const dz = this.z0 + (j + 0.5) * NAV_CELL - fz;
          for (let i = i0; i <= i1; i++) {
            const dx = this.x0 + (i + 0.5) * NAV_CELL - fx;
            if (dx * dx + dz * dz < HR * HR) inH[j * n + i] = hi + 1;
          }
        }
      }
    }
    if (gCost.length < n * n) {
      gCost = new Float32Array(n * n);
      parent = new Int32Array(n * n);
      stamp = new Uint32Array(n * n);
      searchId = 0;
    }
  }

  ci(x: number): number {
    return Math.floor((x - this.x0) / NAV_CELL);
  }

  cj(z: number): number {
    return Math.floor((z - this.z0) / NAV_CELL);
  }

  /** 这个点在不在这张图的范围里 */
  covers(x: number, z: number): boolean {
    const i = this.ci(x);
    const j = this.cj(z);
    return i >= 0 && j >= 0 && i < this.n && j < this.n;
  }

  /** 这个点在哪栋房子里（屋外、图外面返回 null） */
  houseAt(x: number, z: number): Interior | null {
    const i = this.ci(x);
    const j = this.cj(z);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return null;
    const k = this.inHouse[j * this.n + i] as number;
    return k ? (this.houses[k - 1] as Interior) : null;
  }

  /** 这个点站不了人（图外面算能站） */
  blockedAt(x: number, z: number): boolean {
    const i = this.ci(x);
    const j = this.cj(z);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return false;
    return this.blocked[j * this.n + i] === 1;
  }

  /**
   * 这个点所在的格子和周围八格是不是都能站。都能站 = 0.4 米以内没有任何碰撞体（比丧尸的半径大），
   * 这一步可以不做碰撞检测：空地上走的丧尸占大多数，省下的是最贵的那部分
   */
  openAround(x: number, z: number): boolean {
    const n = this.n;
    const i = this.ci(x);
    const j = this.cj(z);
    if (i < 1 || j < 1 || i >= n - 1 || j >= n - 1) return i < 0 || j < 0 || i >= n || j >= n;
    const m = this.blocked;
    const k = j * n + i;
    return !(m[k - n - 1] || m[k - n] || m[k - n + 1] || m[k - 1] || m[k] || m[k + 1] || m[k + n - 1] || m[k + n] || m[k + n + 1]);
  }

  /** 两点之间直着走过去会不会撞上东西（每 0.2 米看一眼） */
  lineClear(ax: number, az: number, bx: number, bz: number): boolean {
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    const k = Math.ceil(len / 0.2);
    for (let q = 1; q <= k; q++) {
      const t = q / k;
      if (this.blockedAt(ax + dx * t, az + dz * t)) return false;
    }
    return true;
  }

  /** (i, j) 周围最近的能站的格子；rad 格以内没有返回 -1 */
  nearestFree(i: number, j: number, rad: number): number {
    const n = this.n;
    i = Math.max(0, Math.min(n - 1, i));
    j = Math.max(0, Math.min(n - 1, j));
    if (!this.blocked[j * n + i]) return j * n + i;
    let best = -1;
    let bd = Infinity;
    for (let r = 1; r <= rad && best < 0; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const a = i + di;
          const b = j + dj;
          if (a < 0 || b < 0 || a >= n || b >= n || this.blocked[b * n + a]) continue;
          const d = di * di + dj * dj;
          if (d < bd) {
            bd = d;
            best = b * n + a;
          }
        }
      }
    }
    return best;
  }

  /** (x, z) 附近能站的点（自己能站就返回自己）；找不到返回 false */
  freeNear(x: number, z: number, out: { x: number; z: number }, rad = 5): boolean {
    if (!this.blockedAt(x, z)) {
      out.x = x;
      out.z = z;
      return true;
    }
    const k = this.nearestFree(this.ci(x), this.cj(z), rad);
    if (k < 0) return false;
    out.x = this.x0 + ((k % this.n) + 0.5) * NAV_CELL;
    out.z = this.z0 + (Math.floor(k / this.n) + 0.5) * NAV_CELL;
    return true;
  }

  /**
   * A*：从 A 到 B 的路点（x, z 交替，不含起点，最后一个是终点）写进 out。
   * 返回 1 = 走得到；2 = 走不到（或者太远没搜完），out 里是到「离终点最近的地方」的路；0 = 起点或终点周围全堵死了；
   * 3 = 这一帧的名额（max）不够搜完，out 没动，下一帧再来。own = 这次搜索自己的上限（max 比它小就是名额不够）
   */
  path(ax: number, az: number, bx: number, bz: number, out: number[], max = MAX_EXPAND, own = MAX_EXPAND): number {
    const n = this.n;
    this.expanded = 0;
    const map = this.blocked;
    const start = this.nearestFree(this.ci(ax), this.cj(az), 4);
    const gi0 = this.ci(bx);
    const gj0 = this.cj(bz);
    const goal = this.nearestFree(gi0, gj0, 8);
    if (start < 0 || goal < 0) {
      out.length = 0;
      return 0;
    }
    const gi = goal % n;
    const gj = (goal - gi) / n;
    // 终点原本就能站：最后一个路点用准确的坐标，不用格子中心
    const exact = gi === gi0 && gj === gj0;
    if (searchId > 0xfffffff0) {
      stamp.fill(0);
      searchId = 0;
    }
    searchId += 2;
    const open = searchId;
    const closed = searchId + 1;
    heap.length = 0;
    heapF.length = 0;
    // 八方向的距离；乘 1.2 让搜索更贪心（路稍微绕一点，后面会拉直）
    const D = (SQ2 - 1) * 1.2;
    const si = start % n;
    const sj = (start - si) / n;
    const hi0 = Math.abs(si - gi);
    const hj0 = Math.abs(sj - gj);
    gCost[start] = 0;
    parent[start] = -1;
    stamp[start] = open;
    let best = start;
    let bestH = Math.max(hi0, hj0) * 1.2 + D * Math.min(hi0, hj0);
    heapPush(heap, heapF, start, bestH);
    let found = false;
    let expand = 0;
    for (; heap.length && expand < max; expand++) {
      const cur = heapPop(heap, heapF);
      if (stamp[cur] === closed) continue;
      stamp[cur] = closed;
      if (cur === goal) {
        found = true;
        break;
      }
      const ci = cur % n;
      const cj = (cur - ci) / n;
      const ai = ci > gi ? ci - gi : gi - ci;
      const aj = cj > gj ? cj - gj : gj - cj;
      const hc = (ai > aj ? ai * 1.2 + D * aj : aj * 1.2 + D * ai);
      if (hc < bestH) {
        bestH = hc;
        best = cur;
      }
      const g = gCost[cur] as number;
      for (let dj = -1; dj <= 1; dj++) {
        const j = cj + dj;
        if (j < 0 || j >= n) continue;
        const bj = j > gj ? j - gj : gj - j;
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const i = ci + di;
          if (i < 0 || i >= n) continue;
          const k = j * n + i;
          if (map[k] || stamp[k] === closed) continue;
          // 斜着走：两边都得是空的，不然会蹭着墙角
          if (di && dj && (map[cj * n + i] || map[j * n + ci])) continue;
          const ng = g + (di && dj ? SQ2 : 1);
          if (stamp[k] === open && ng >= (gCost[k] as number)) continue;
          gCost[k] = ng;
          parent[k] = cur;
          stamp[k] = open;
          const bi = i > gi ? i - gi : gi - i;
          heapPush(heap, heapF, k, ng + (bi > bj ? bi * 1.2 + D * bj : bj * 1.2 + D * bi));
        }
      }
    }
    this.expanded = expand;
    this.cut = !found && heap.length > 0;
    // 没搜完是因为这一帧的名额不够（不是这次搜索本身到了上限）：结果不能用
    if (this.cut && max < own) return 3;
    out.length = 0;
    // 倒着收集格子
    cells.length = 0;
    for (let k = found ? goal : best; k >= 0; k = parent[k] as number) cells.push(k);
    cells.reverse();
    pts.length = 0;
    for (const k of cells) pts.push(this.x0 + ((k % n) + 0.5) * NAV_CELL, this.z0 + (Math.floor(k / n) + 0.5) * NAV_CELL);
    if (found && exact) {
      pts[pts.length - 2] = bx;
      pts[pts.length - 1] = bz;
    }
    this.pull(ax, az, pts, out);
    return found ? 1 : 2;
  }

  /** 拉直：从 (ax, az) 出发一直看到看不见为止，中间的路点都不要。p = 一格一格的路（x, z 交替），结果接在 out 后面 */
  pull(ax: number, az: number, p: readonly number[], out: number[]): void {
    const m = p.length / 2;
    let i = 0;
    let fx = ax;
    let fz = az;
    while (i < m) {
      let k = i;
      while (k + 1 < m && k - i < 60 && this.lineClear(fx, fz, p[(k + 1) * 2] as number, p[(k + 1) * 2 + 1] as number)) k++;
      fx = p[k * 2] as number;
      fz = p[k * 2 + 1] as number;
      out.push(fx, fz);
      i = k + 1;
    }
  }
}

/** 远路一次最多铺多少格（约 1.1 万平米：围栏里面的整个院子，加上从大门漏到外面的一圈） */
export const FIELD_MAX = 70000;
/** 远路一帧铺多少格（约半毫秒） */
export const FIELD_STEP = 1200;

/**
 * 远路：从终点往外一圈圈铺开，每格记下「往终点走的下一格」。
 * 为什么要有：农场、基地有围栏，从围栏外到屋里要绕到大门，几十上百米；A* 一次最多搜 MAX_EXPAND 格，搜不到，
 * 只能走到围栏边上离人最近的那一点，然后顶着围栏站着。
 * 铺一次要几万格，所以分很多帧铺（一帧 FIELD_STEP 格）；铺完以后所有去同一个地方的丧尸都从里面读自己的路，不用各搜各的。
 * 同一时间只铺一张（Nav.field）。
 */
export class Field {
  /** 0 = 空着，1 = 正在铺，2 = 铺好了（等着的丧尸还没读完） */
  state = 0;
  grid: SiteNav | null = null;
  /** 终点 */
  gx = 0;
  gz = 0;
  /** 已经铺了多少格 */
  size = 0;
  /** 能到的地方都铺到了（或者到了上限）。false = 等着的丧尸都够着了、提前停的 */
  whole = false;
  /** 铺到多远了（沿路走过去的距离，米） */
  radius = 0;
  /** 是到了上限停的：更远的地方走不走得到，这张图上看不出来 */
  capped = false;
  private exact = false;
  private id = 0;
  private cost = new Float32Array(0);
  private next = new Int32Array(0);
  private mark = new Uint32Array(0);
  private readonly heap: number[] = [];
  private readonly heapF: number[] = [];
  private readonly cells: number[] = [];

  /** 开始铺一张到 (gx, gz) 的。终点周围全堵死了返回 false */
  begin(grid: SiteNav, gx: number, gz: number): boolean {
    const n = grid.n;
    const gi = grid.ci(gx);
    const gj = grid.cj(gz);
    const goal = grid.nearestFree(gi, gj, 8);
    if (goal < 0) return false;
    if (this.cost.length < n * n) {
      this.cost = new Float32Array(n * n);
      this.next = new Int32Array(n * n);
      this.mark = new Uint32Array(n * n);
      this.id = 0;
    }
    if (this.id > 0xfffffff0) {
      this.mark.fill(0);
      this.id = 0;
    }
    // 每张图两个记号：id = 在堆里，id + 1 = 铺过了。换一张图记号就全作废，不用清数组
    this.id += 2;
    this.grid = grid;
    this.gx = gx;
    this.gz = gz;
    this.exact = gi >= 0 && gj >= 0 && gi < n && gj < n && goal === gj * n + gi;
    this.size = 0;
    this.whole = false;
    this.radius = 0;
    this.capped = false;
    this.heap.length = 0;
    this.heapF.length = 0;
    this.cost[goal] = 0;
    this.next[goal] = -1;
    this.mark[goal] = this.id;
    heapPush(this.heap, this.heapF, goal, 0);
    this.state = 1;
    return true;
  }

  /** 接着铺最多 max 格。返回 true = 能到的地方都铺到了（或者到了上限） */
  run(max: number): boolean {
    const grid = this.grid;
    if (!grid || this.state !== 1) return true;
    const n = grid.n;
    const map = grid.blocked;
    const { cost, next, mark, heap, heapF } = this;
    const open = this.id;
    const closed = open + 1;
    let done = 0;
    while (heap.length && done < max && this.size < FIELD_MAX) {
      const cur = heapPop(heap, heapF);
      if (mark[cur] === closed) continue;
      mark[cur] = closed;
      done++;
      this.size++;
      const ci = cur % n;
      const cj = (cur - ci) / n;
      const g = cost[cur] as number;
      this.radius = g * NAV_CELL;
      for (let dj = -1; dj <= 1; dj++) {
        const j = cj + dj;
        if (j < 0 || j >= n) continue;
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const i = ci + di;
          if (i < 0 || i >= n) continue;
          const k = j * n + i;
          if (map[k] || mark[k] === closed) continue;
          // 斜着走：两边都得是空的（和 A* 一样）
          if (di && dj && (map[cj * n + i] || map[j * n + ci])) continue;
          const ng = g + (di && dj ? SQ2 : 1);
          if (mark[k] === open && ng >= (cost[k] as number)) continue;
          cost[k] = ng;
          next[k] = cur;
          mark[k] = open;
          heapPush(heap, heapF, k, ng);
        }
      }
    }
    if (heap.length && this.size < FIELD_MAX) return false;
    this.whole = true;
    this.capped = heap.length > 0;
    return true;
  }

  /** (x, z) 所在的格子铺到了没有；没铺到返回 -1 */
  private cell(x: number, z: number): number {
    const grid = this.grid;
    if (!grid) return -1;
    const k = grid.nearestFree(grid.ci(x), grid.cj(z), 4);
    return k >= 0 && this.mark[k] === this.id + 1 ? k : -1;
  }

  /** (x, z) 这里铺到了没有 */
  reached(x: number, z: number): boolean {
    return this.cell(x, z) >= 0;
  }

  /** 从 (x, z) 到终点的路点写进 out（格式同 SiteNav.path：不含起点，最后一个是终点）。这里没铺到返回 false，out 不动 */
  trace(x: number, z: number, out: number[]): boolean {
    const grid = this.grid;
    let k = this.cell(x, z);
    if (!grid || k < 0) return false;
    const n = grid.n;
    const p = this.cells;
    p.length = 0;
    for (; k >= 0; k = this.next[k] as number) p.push(grid.x0 + ((k % n) + 0.5) * NAV_CELL, grid.z0 + (Math.floor(k / n) + 0.5) * NAV_CELL);
    if (this.exact) {
      p[p.length - 2] = this.gx;
      p[p.length - 1] = this.gz;
    }
    out.length = 0;
    grid.pull(x, z, p, out);
    return true;
  }
}

/** 所有地点的位图：用到才建（一两毫秒），留最近用过的几张 */
export class Nav {
  private readonly grids = new Map<number, SiteNav>();
  private readonly hit: Site[] = [];
  private tick = 0;
  /** 这一帧找路还能展开多少格（每帧开头由 Brain 重置成 FRAME_EXPAND）：一帧里花在找路上的时间有上限 */
  budget = FRAME_EXPAND;
  /** 这一帧还没搜过 */
  first = true;
  /** 远路（一次只铺一张，见 Field） */
  readonly field = new Field();
  /**
   * 「从哪些地方走得到这里」：从一个固定的点（守城的发电机、生化模式的场地中心）往外铺的一张图，horde.ts 的 spotAround 用它挑丧尸冒出来的地方。
   * 和上面那张用的是同一个上限（FIELD_MAX）、同一种铺法，所以这张图上够得着的点，放在那的丧尸要远路时也铺得到
   */
  readonly reach = new Field();

  /** 要做一次搜索：这次最多能展开多少格（limit = 这次搜索自己的上限）。0 = 这一帧没名额了 */
  grant(limit: number): number {
    if (this.first) return limit;
    return this.budget < 300 ? 0 : Math.min(limit, this.budget);
  }

  /** 搜完了：记账 */
  charge(g: SiteNav): void {
    this.first = false;
    this.budget -= g.expanded + 150;
  }

  constructor(private readonly world: World) {}

  /** (x, z) 所在地点的位图；不在任何地点里、或者地点的内容还没生成，返回 null */
  at(x: number, z: number): SiteNav | null {
    const hit = this.hit;
    hit.length = 0;
    this.world.sites.near(x, z, 6, hit);
    for (const s of hit) {
      let g = this.grids.get(s.key);
      if (!g) {
        const c = this.world.sites.peek(s);
        if (!c) continue;
        g = new SiteNav(s, c.cols, c.interiors);
        this.grids.set(s.key, g);
        if (this.grids.size > 5) {
          let old = -1;
          let ot = Infinity;
          for (const [k, v] of this.grids) {
            if (v !== g && v.used < ot) {
              ot = v.used;
              old = k;
            }
          }
          this.grids.delete(old);
        }
      }
      if (!g.covers(x, z)) continue;
      g.used = ++this.tick;
      return g;
    }
    return null;
  }
}
