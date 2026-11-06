/**
 * 模型落地点（纯函数，没有 three 依赖：检查脚本 check-props 用；运行时 realProps.ts 用的是同一个规则）。
 *
 * 规则就是最低点落地。试过"忽略面积小、比主体低的网格"，结果被忽略的正是车轮——
 * 轮子面积小、底在 0，车身从离地间隙往上——那样会把车埋进地里。所以车 / 集装箱都按最低点落地是对的，
 * 悬空如果出现，要看摆放（缩放后的 y、叠放层高）和地面高度，不是模型本身。
 */
export interface MeshBox {
  name: string;
  min: [number, number, number];
  max: [number, number, number];
}

export interface GroundFit {
  /** 应该贴地的高度（模型坐标）= 最低点 */
  y: number;
  /** 模型总高 */
  height: number;
  /** 底边离落地点 2% 高度以内的网格（真正接触地面的：车轮、箱底、支脚） */
  contact: string[];
}

export function groundOf(boxes: MeshBox[]): GroundFit {
  if (!boxes.length) return { y: 0, height: 0, contact: [] };
  const y = Math.min(...boxes.map((b) => b.min[1]));
  const height = Math.max(1e-6, Math.max(...boxes.map((b) => b.max[1])) - y);
  const contact = boxes.filter((b) => b.min[1] <= y + height * 0.02).map((b) => b.name);
  return { y, height, contact };
}
