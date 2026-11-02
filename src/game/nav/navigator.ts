import { GRID_H, GRID_W, type Grid } from '../world/grid';
import { FlowField, INF } from './flowfield';

export type GoalKind = 'core' | 'player';

/**
 * 管理 2 个目标 × 2 个体型 = 4 张距离场。
 * - 核心场：建筑变化时重算。
 * - 玩家场：玩家换格时重算，节流到每秒 8 次。
 */
export class Navigator {
  private readonly coreSmall: FlowField;
  private readonly coreLarge: FlowField;
  private readonly playerSmall: FlowField;
  private readonly playerLarge: FlowField;

  private structVersion = -1;
  private playerCell = -1;
  private playerAccum = 1;
  private playerDirty = true;
  /** 统计：用于性能核查 */
  recomputes = 0;

  constructor(
    private readonly grid: Grid,
    private readonly coreCells: number[],
  ) {
    this.coreSmall = new FlowField(grid, false, true);
    this.coreLarge = new FlowField(grid, true, true);
    this.playerSmall = new FlowField(grid, false, false);
    this.playerLarge = new FlowField(grid, true, false);
  }

  update(dt: number, playerX: number, playerZ: number, playerAlive: boolean): void {
    const { grid } = this;
    if (grid.structVersion !== this.structVersion) {
      this.structVersion = grid.structVersion;
      this.coreSmall.compute(this.coreCells);
      this.coreLarge.compute(this.coreCells);
      this.recomputes += 2;
      this.playerDirty = true;
    }
    this.playerAccum += dt;
    if (!playerAlive) return;
    const cell = grid.indexAt(playerX, playerZ);
    if (cell !== this.playerCell) {
      this.playerCell = cell;
      this.playerDirty = true;
    }
    if (this.playerDirty && this.playerAccum >= 0.125) {
      this.playerDirty = false;
      this.playerAccum = 0;
      this.playerSmall.compute([cell]);
      this.playerLarge.compute([cell]);
      this.recomputes += 2;
    }
  }

  /**
   * 最近一次 field() 调用的"借用起点"：大体型单位站在被膨胀的格子里（贴着墙）时，
   * 它自己的格子在大体型地图里不可通行，这时借用相邻的可通行格作为路径起点。-1 表示不需要。
   */
  prefix = -1;

  /** 取距离场；大体型单位在大体型地图里完全到不了时才退回普通场 */
  field(goal: GoalKind, large: boolean, cell: number): FlowField {
    this.prefix = -1;
    const small = goal === 'core' ? this.coreSmall : this.playerSmall;
    if (!large) return small;
    const big = goal === 'core' ? this.coreLarge : this.playerLarge;
    if ((big.dist[cell] as number) < INF) return big;
    const cx = cell % GRID_W;
    const cy = (cell / GRID_W) | 0;
    let best = -1;
    let bestD = INF;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) continue;
        const n = ny * GRID_W + nx;
        const d = big.dist[n] as number;
        if (d < bestD) {
          bestD = d;
          best = n;
        }
      }
    }
    if (best >= 0) {
      this.prefix = best;
      return big;
    }
    return small;
  }
}
