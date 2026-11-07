// 资产目录的类型：建模（Blender）和平台之间的约定。
//
// 目录（catalog.json）由 scripts/tools/konbini-catalog.ts 生成，字段和这里的类型一一对应。
// scripts/tools/catalog/types.ts 是同一套类型的工具侧副本（生成脚本不依赖 src/）。

/** 交互类型：开关、触发、循环、状态切换、显隐、可拾取、纯代码逻辑 */
export type InteractionType = 'toggle' | 'trigger' | 'loop' | 'state' | 'visibility' | 'pick' | 'code';

/** 一个可交互部件 */
export interface Interaction {
  id: string;
  /** 界面上的名字 */
  label: string;
  type: InteractionType;
  /** 动画名（glb 里的动画剪辑） */
  clip?: string;
  /** 要动的节点名 */
  nodes?: string[];
  /** 每个节点各自播一遍动画 */
  perNode?: boolean;
  /** 持续时间（秒） */
  duration?: number;
  /** 给建模的补充说明 */
  note?: string;
}

/** 一个款式（SKU / 变体） */
export interface Variant {
  id: string;
  name: string;
  /** 商品价格（日元），非商品没有 */
  price?: number;
  /** 主色（#rrggbb） */
  color?: string;
  status: AssetStatus;
  /** 交付的 glb 路径（相对 public/assets/konbini） */
  file?: string;
}

/** 资产状态：还没做 / 只有程序生成的样例 / 已交付 */
export type AssetStatus = 'pending' | 'sample' | 'delivered';

/** 一个资产条目 */
export interface AssetEntry {
  id: string;
  name: string;
  category: string;
  /** 尺寸（米）：宽、高、深 */
  dims: [number, number, number];
  /** 三角形预算 */
  budget?: number;
  /** 场景里放几个 */
  count?: number;
  /** 贴图最长边（px） */
  maxTexture?: number;
  status: AssetStatus;
  /** 出自哪个文件哪一行 */
  source?: string;
  /** 建模说明 */
  notes?: string;
  /** 款式在界面上的叫法（款式 / SKU） */
  variantLabel?: string;
  variants?: Variant[];
  interactions: Interaction[];
  /** 原点约定：默认底面中心，custom 表示按说明来 */
  origin?: 'default' | 'custom';
  /** 交付的 glb 路径（相对 public/assets/konbini） */
  file?: string;
}

/** 分类 */
export interface CatalogCategory {
  id: string;
  name: string;
}

/** 整张资产目录 */
export interface Catalog {
  title: string;
  version: number;
  /** 交付约定（单位、朝向、原点、格式…） */
  conventions: string[];
  categories: CatalogCategory[];
  assets: AssetEntry[];
}
