import type { Grid } from './grid';

export type PropKind =
  | 'wall' // 围墙 / 建筑墙体
  | 'doorframe' // 门框（装饰）
  | 'container' // 集装箱
  | 'car' // 车辆残骸
  | 'tree' // 枯树
  | 'crate' // 木箱 / 弹药箱
  | 'barrier' // 隔离墩
  | 'pump' // 加油机
  | 'pillar' // 雨棚立柱
  | 'canopy' // 雨棚顶（装饰）
  | 'rack' // 货架
  | 'rubble' // 瓦砾堆（装饰）
  | 'chunk' // 塌落的墙块
  | 'lamp' // 路灯（装饰）
  | 'barrel' // 油桶（装饰）
  | 'sandbag' // 沙袋（装饰）
  | 'fence' // 铁丝网栅栏（装饰）
  | 'generator' // 发电机
  | 'workbench' // 武器工坊
  | 'pallet' // 托盘 / 木板堆
  | 'dumpster' // 垃圾箱
  | 'scrapbox'; // 零件箱（可拾取）

export type Side = 'N' | 'S' | 'W' | 'E';

/** 墙体风格：决定渲染时的材质和细节 */
export type WallStyle = 'compound' | 'brick' | 'plaster' | 'metal';

/** 以格为单位的矩形图元，[x0,x1) × [y0,y1) */
export interface Prop {
  kind: PropKind;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 是否写入导航网格（阻挡） */
  solid: boolean;
  /** 渲染高度（世界单位），缺省由渲染层按种类决定 */
  h?: number;
  /** 渲染变体 0–3 */
  variant: number;
  /** 门框朝向 */
  side?: Side;
  /** 墙体风格（wall / doorframe 使用） */
  style?: WallStyle;
}

export interface SpawnPoint {
  name: string;
  cx: number;
  cy: number;
  x: number;
  z: number;
}

export interface WorldRect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface MapData {
  grid: Grid;
  props: Prop[];
  spawns: SpawnPoint[];
  /** 发电机占据的格下标，作为寻路目标种子 */
  coreCells: number[];
  coreRect: WorldRect;
  corePos: { x: number; z: number };
  workbench: WorldRect & { x: number; z: number };
  scrapBoxes: Array<{ cx: number; cy: number }>;
  lamps: Array<{ x: number; z: number }>;
  playerStart: { x: number; z: number };
}
