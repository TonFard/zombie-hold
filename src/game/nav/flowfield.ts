import { GRID_H, GRID_W, type Grid } from '../world/grid';

export const INF = 1e9;
const SQRT2 = 1.41421356;

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

/**
 * 距离场：从目标出发做 Dijkstra，得到每格到目标的代价 dist 和下一步 next。
 *
 * - 阻挡型建筑可通行但代价高（由 Grid.extra 提供），所以通路被封死时路径会穿过建筑，
 *   僵尸会停下来拆它，而不是堵在原地。
 * - 斜向移动要求两侧的正交格都不阻挡，避免擦着墙角穿过去。
 * - large=true 时静态障碍向外膨胀一格，大体型单位只走够宽的通道。
 */
export class FlowField {
  readonly dist = new Float32Array(GRID_W * GRID_H);
  readonly next = new Int32Array(GRID_W * GRID_H);

  private heapK: Float32Array;
  private heapV: Int32Array;
  private heapN = 0;

  constructor(
    private readonly grid: Grid,
    readonly large: boolean,
    /** 目标是不是发电机（影响大体型地图是否豁免发电机的膨胀） */
    private readonly toCore: boolean,
  ) {
    const cap = GRID_W * GRID_H * 8 + 16;
    this.heapK = new Float32Array(cap);
    this.heapV = new Int32Array(cap);
  }

  private push(k: number, v: number): void {
    let i = this.heapN++;
    const hk = this.heapK;
    const hv = this.heapV;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((hk[p] as number) <= k) break;
      hk[i] = hk[p] as number;
      hv[i] = hv[p] as number;
      i = p;
    }
    hk[i] = k;
    hv[i] = v;
  }

  /** 弹出最小项，结果放进 popK / popV */
  private popK = 0;
  private popV = 0;
  private pop(): void {
    const hk = this.heapK;
    const hv = this.heapV;
    this.popK = hk[0] as number;
    this.popV = hv[0] as number;
    const n = --this.heapN;
    if (n === 0) return;
    const k = hk[n] as number;
    const v = hv[n] as number;
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && (hk[c + 1] as number) < (hk[c] as number)) c++;
      if ((hk[c] as number) >= k) break;
      hk[i] = hk[c] as number;
      hv[i] = hv[c] as number;
      i = c;
    }
    hk[i] = k;
    hv[i] = v;
  }

  compute(seeds: ArrayLike<number>): void {
    const { grid, dist, next } = this;
    const mask = this.large ? grid.largeMask(this.toCore) : grid.solid;
    const structure = grid.structure;
    const extra = grid.extra;
    dist.fill(INF);
    next.fill(-1);
    this.heapN = 0;
    for (let i = 0; i < seeds.length; i++) {
      const s = seeds[i] as number;
      // 大体型地图：目标格本身在膨胀区里（玩家躲在屋里、贴着墙）时，只有从相邻的可通行格才算"到得了"。
      // 否则从这个种子往外扩散，会把整个挤不进去的房间都算成可达，巨像就会对着门框硬挤
      if (this.large && mask[s] && !this.toCore) {
        const sx = s % GRID_W;
        const sy = (s / GRID_W) | 0;
        for (let k = 0; k < 8; k++) {
          const nx = sx + (DX[k] as number);
          const ny = sy + (DY[k] as number);
          if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) continue;
          const n = ny * GRID_W + nx;
          if (mask[n] || dist[n] === 0) continue;
          dist[n] = 0;
          this.push(0, n);
        }
        continue;
      }
      dist[s] = 0;
      this.push(0, s);
    }

    while (this.heapN > 0) {
      this.pop();
      const d = this.popK;
      const u = this.popV;
      if (d > (dist[u] as number)) continue;
      const ux = u % GRID_W;
      const uy = (u / GRID_W) | 0;
      // 其他格走进 u 要付的额外代价
      const enter = extra[u] as number;
      for (let k = 0; k < 8; k++) {
        const vx = ux + (DX[k] as number);
        const vy = uy + (DY[k] as number);
        if (vx < 0 || vy < 0 || vx >= GRID_W || vy >= GRID_H) continue;
        const v = vy * GRID_W + vx;
        if (mask[v]) continue;
        if (k >= 4) {
          // 斜向：两侧正交格都不能阻挡
          const ax = vy * GRID_W + ux;
          const bx = uy * GRID_W + vx;
          if (mask[ax] || mask[bx] || (structure[ax] as number) >= 0 || (structure[bx] as number) >= 0) continue;
        }
        const nd = d + (k >= 4 ? SQRT2 : 1) + enter;
        if (nd < (dist[v] as number)) {
          dist[v] = nd;
          next[v] = u;
          this.push(nd, v);
        }
      }
    }
  }
}
