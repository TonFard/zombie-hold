// 资产目录的类型：工具侧的入口。
//
// 类型本身放在 src/viewer/catalog-types.ts（资产平台页面要用），这里只是转发，
// 免得同一套类型写两遍。
export type {
  AssetEntry,
  AssetStatus,
  Catalog,
  CatalogCategory,
  Interaction,
  InteractionType,
  Variant,
} from '../../../src/viewer/catalog-types';
