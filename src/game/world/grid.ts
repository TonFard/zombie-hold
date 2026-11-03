export const GRID_W = 80;
export const GRID_H = 80;
export const HALF_W = GRID_W / 2;
export const HALF_H = GRID_H / 2;
const COUNT = GRID_W * GRID_H;

/** 地面类型，渲染用 */
export const Ground = { Grass: 0, Asphalt: 1, Dirt: 2, Concrete: 3, Floor: 4, Gravel: 5 } as const;

/**
 * 导航与碰撞网格。每格 1×1 世界单位，世界坐标原点在网格中心：
 * 世界 x = 格 x − 40 + 0.5，世界 z = 格 y − 40 + 0.5。
 */
export class Grid {
  readonly w = GRID_W;
  readonly h = GRID_H;
  readonly count = COUNT;

  /** 1 = 静态实体（墙、车、树……） */
  readonly solid = new Uint8Array(COUNT);
  /** 1 = 瓦砾，可通行但减速 */
  readonly slow = new Uint8Array(COUNT);
  /** 阻挡型建筑的 id，没有为 -1。可被僵尸攻击拆除 */
  readonly structure = new Int32Array(COUNT).fill(-1);
  /** 非阻挡建筑（地刺）的 id */
  readonly trap = new Int32Array(COUNT).fill(-1);
  /** 寻路额外成本（瓦砾、地刺、建筑） */
  readonly extra = new Float32Array(COUNT);
  readonly ground = new Uint8Array(COUNT);
  readonly buildable = new Uint8Array(COUNT);
  /**
   * 静态障碍的高度（米）。子弹低于它会被挡住，高于它会飞过去：
   * 平着打能越过木箱、隔离墩、车顶，打不穿围墙。0 = 没有静态障碍。
   */
  readonly height = new Float32Array(COUNT);
  /**
   * 细障碍（树干、灯杆、油桶）的精细形状：圆柱半径（米），0 = 整格方块。
   * 寻路仍然把整格当成障碍，但玩家的碰撞和子弹按真实粗细算，不会撞上"空气墙"。
   */
  readonly post = new Float32Array(COUNT);

  /** 阻挡建筑变化时自增，寻路据此重算 */
  structVersion = 0;

  private structCost = new Float32Array(COUNT);
  private inflatedMask: Array<Uint8Array | null> = [null, null];

  idx(cx: number, cy: number): number {
    return cy * GRID_W + cx;
  }

  inBounds(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < GRID_W && cy < GRID_H;
  }

  cellX(x: number): number {
    return Math.floor(x + HALF_W);
  }

  cellY(z: number): number {
    return Math.floor(z + HALF_H);
  }

  /** 世界坐标所在格的下标，越界时夹到边缘 */
  indexAt(x: number, z: number): number {
    let cx = Math.floor(x + HALF_W);
    let cy = Math.floor(z + HALF_H);
    if (cx < 0) cx = 0;
    else if (cx >= GRID_W) cx = GRID_W - 1;
    if (cy < 0) cy = 0;
    else if (cy >= GRID_H) cy = GRID_H - 1;
    return cy * GRID_W + cx;
  }

  centerX(cx: number): number {
    return cx - HALF_W + 0.5;
  }

  centerZ(cy: number): number {
    return cy - HALF_H + 0.5;
  }

  /** 静态障碍，越界视为障碍 */
  isStaticSolid(cx: number, cy: number): boolean {
    return cx < 0 || cy < 0 || cx >= GRID_W || cy >= GRID_H || this.solid[cy * GRID_W + cx] === 1;
  }

  /** 实际挡住移动：静态障碍或阻挡型建筑 */
  isBlocked(cx: number, cy: number): boolean {
    if (cx < 0 || cy < 0 || cx >= GRID_W || cy >= GRID_H) return true;
    const i = cy * GRID_W + cx;
    return this.solid[i] === 1 || this.structure[i] >= 0;
  }

  private refresh(i: number): void {
    let c = 0;
    if (this.slow[i]) c += 2;
    if (this.trap[i] >= 0) c += 3;
    if (this.structure[i] >= 0) c += this.structCost[i] as number;
    this.extra[i] = c;
  }

  setRubble(i: number): void {
    this.slow[i] = 1;
    this.refresh(i);
  }

  placeBlocking(i: number, id: number, navCost: number): void {
    this.structure[i] = id;
    this.structCost[i] = navCost;
    this.refresh(i);
    this.structVersion++;
  }

  clearBlocking(i: number): void {
    this.structure[i] = -1;
    this.structCost[i] = 0;
    this.refresh(i);
    this.structVersion++;
  }

  placeTrap(i: number, id: number): void {
    this.trap[i] = id;
    this.refresh(i);
    this.structVersion++;
  }

  clearTrap(i: number): void {
    this.trap[i] = -1;
    this.refresh(i);
    this.structVersion++;
  }

  private inflateExempt = new Uint8Array(COUNT);
  private largeCache: Array<Uint8Array | null> = [null, null];
  private largeVersion = [-1, -1];

  /** 目标本身（发电机）自身仍是障碍，但不向外膨胀 */
  setInflateExempt(cells: number[]): void {
    this.inflateExempt.fill(0);
    for (const c of cells) this.inflateExempt[c] = 1;
    this.inflatedMask = [null, null];
    this.largeCache = [null, null];
    this.largeVersion = [-1, -1];
  }

  /**
   * 大体型单位的不可通行图：静态障碍膨胀 1 格，再加上被建筑 / 障碍夹住的窄缺口
   * （左右或上下两侧都被挡住的空格）。建筑格本身保持可通行，大体型单位会去拆它。
   * toCore = true 用于"以发电机为目标"的场：发电机周围一圈不被封死，否则永远走不到它身边。
   * 追玩家的场不能豁免，否则路径会紧贴发电机，半径 0.95 的巨像挤不进去。
   */
  largeMask(toCore: boolean): Uint8Array {
    const k = toCore ? 1 : 0;
    const cached = this.largeCache[k];
    if (cached && this.largeVersion[k] === this.structVersion) return cached;
    const m = cached ?? new Uint8Array(COUNT);
    m.set(this.inflated(toCore));
    for (let cy = 1; cy < GRID_H - 1; cy++) {
      for (let cx = 1; cx < GRID_W - 1; cx++) {
        const i = cy * GRID_W + cx;
        if (m[i] === 1 || this.structure[i] >= 0) continue;
        const l = this.isBlocked(cx - 1, cy);
        const r = this.isBlocked(cx + 1, cy);
        const u = this.isBlocked(cx, cy - 1);
        const d = this.isBlocked(cx, cy + 1);
        if ((l && r) || (u && d)) m[i] = 1;
      }
    }
    this.largeCache[k] = m;
    this.largeVersion[k] = this.structVersion;
    return m;
  }

  /** 静态障碍向外膨胀 1 格。toCore = true 时发电机自身不向外膨胀 */
  inflated(toCore = false): Uint8Array {
    const k = toCore ? 1 : 0;
    const cached = this.inflatedMask[k];
    if (cached) return cached;
    const m = new Uint8Array(COUNT);
    for (let cy = 0; cy < GRID_H; cy++) {
      for (let cx = 0; cx < GRID_W; cx++) {
        const ci = cy * GRID_W + cx;
        if (this.solid[ci] !== 1) continue;
        m[ci] = 1;
        if (toCore && this.inflateExempt[ci] === 1) continue;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx >= 0 && ny >= 0 && nx < GRID_W && ny < GRID_H) m[ny * GRID_W + nx] = 1;
          }
        }
      }
    }
    this.inflatedMask[k] = m;
    return m;
  }

  /** 从 (x0,z0) 沿单位向量 (dx,dz) 前进，返回碰到第一个阻挡格的距离；没碰到返回 maxDist */
  rayDist(x0: number, z0: number, dx: number, dz: number, maxDist: number): number {
    const gx = x0 + HALF_W;
    const gy = z0 + HALF_H;
    let cx = Math.floor(gx);
    let cy = Math.floor(gy);
    if (this.isBlocked(cx, cy)) return 0;
    const stepX = dx > 0 ? 1 : -1;
    const stepY = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaY = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tMaxX = dx > 0 ? (cx + 1 - gx) / dx : dx < 0 ? (gx - cx) / -dx : Infinity;
    let tMaxY = dz > 0 ? (cy + 1 - gy) / dz : dz < 0 ? (gy - cy) / -dz : Infinity;
    for (let guard = 0; guard < 400; guard++) {
      let t: number;
      if (tMaxX < tMaxY) {
        t = tMaxX;
        tMaxX += tDeltaX;
        cx += stepX;
      } else {
        t = tMaxY;
        tMaxY += tDeltaY;
        cy += stepY;
      }
      if (t >= maxDist) return maxDist;
      if (this.isBlocked(cx, cy)) return t;
    }
    return maxDist;
  }

  /**
   * 线段是否畅通（网格 DDA）。检查线段经过的每个格，是否包含终点所在格由 includeEnd 决定。
   */
  segmentClear(x0: number, z0: number, x1: number, z1: number, includeEnd = false): boolean {
    const gx0 = x0 + HALF_W;
    const gy0 = z0 + HALF_H;
    const gx1 = x1 + HALF_W;
    const gy1 = z1 + HALF_H;
    let cx = Math.floor(gx0);
    let cy = Math.floor(gy0);
    const ex = Math.floor(gx1);
    const ey = Math.floor(gy1);
    const dx = gx1 - gx0;
    const dy = gy1 - gy0;
    const stepX = dx > 0 ? 1 : -1;
    const stepY = dy > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    let tMaxX = dx > 0 ? (cx + 1 - gx0) / dx : dx < 0 ? (gx0 - cx) / -dx : Infinity;
    let tMaxY = dy > 0 ? (cy + 1 - gy0) / dy : dy < 0 ? (gy0 - cy) / -dy : Infinity;
    let guard = Math.abs(ex - cx) + Math.abs(ey - cy) + 2;
    while (guard-- > 0) {
      const atEnd = cx === ex && cy === ey;
      if (atEnd && !includeEnd) return true;
      if (this.isBlocked(cx, cy)) return false;
      if (atEnd) return true;
      if (tMaxX < tMaxY) {
        cx += stepX;
        tMaxX += tDeltaX;
      } else {
        cy += stepY;
        tMaxY += tDeltaY;
      }
    }
    return true;
  }

  /** 以半径 r 的圆盘扫过线段是否畅通：中心线加左右两条偏移线 */
  sweptClear(x0: number, z0: number, x1: number, z1: number, r: number): boolean {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return true;
    if (!this.segmentClear(x0, z0, x1, z1, false)) return false;
    const px = (-dz / len) * r;
    const pz = (dx / len) * r;
    return (
      this.segmentClear(x0 + px, z0 + pz, x1 + px, z1 + pz, true) &&
      this.segmentClear(x0 - px, z0 - pz, x1 - px, z1 - pz, true)
    );
  }
}
