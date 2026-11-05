import type { MapData } from './types';
import { buildOutpost } from './map-outpost';
import { buildFarmland } from './map-farmland';
import { buildLakeside } from './map-lakeside';
import { buildCity } from './map-city';

/**
 * 战役地图：从郊外一路打进市区，一张比一张难。
 *   1 外围郊区（据点）→ 2 荒野农场 → 3 湖畔营地 → 4 市区街道
 * 每张图 80×80 格，发电机（据点核心）+ 工坊 + 若干刷怪点 + 零件箱。
 */
export type MapId = 'outpost' | 'farmland' | 'lakeside' | 'city';

export const MAP_ORDER: MapId[] = ['outpost', 'farmland', 'lakeside', 'city'];

export const MAP_BUILDERS: Record<MapId, () => MapData> = {
  outpost: buildOutpost,
  farmland: buildFarmland,
  lakeside: buildLakeside,
  city: buildCity,
};

export const isMapId = (v: unknown): v is MapId => typeof v === 'string' && (MAP_ORDER as string[]).includes(v);
