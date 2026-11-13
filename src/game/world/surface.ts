import { isTurret } from '../data/structures';
import type { Game } from '../sim';
import { Ground } from './grid';
import { FURN_IDS } from './modules';
import type { FurnitureKind, MapData, Prop, PropKind } from './types';

/** 子弹打到的东西是什么做的。只决定溅出来的碎屑和声音（渲染、音频用），不参与任何结算 */
export type Surface = 'metal' | 'concrete' | 'brick' | 'wood' | 'dirt' | 'sand' | 'water';

/** 表里存的是这个列表的下标；0 = 没有障碍物盖着的实心格（地图边上的岩壁），按混凝土算 */
const LIST: Surface[] = ['concrete', 'metal', 'brick', 'wood', 'dirt', 'sand', 'water'];
/** 铁皮墙：下面半米是混凝土墙裙 */
const SKIRT = 0x80;
const SKIRT_H = 0.55;

const PROP: Partial<Record<PropKind, Surface>> = {
  container: 'metal',
  car: 'metal',
  pump: 'metal',
  rack: 'metal',
  lamp: 'metal',
  barrel: 'metal',
  fence: 'metal',
  generator: 'metal',
  workbench: 'metal',
  dumpster: 'metal',
  scrapbox: 'metal',
  tree: 'wood',
  crate: 'wood',
  pallet: 'wood',
  sandbag: 'sand',
};
const METAL_FURNITURE: FurnitureKind[] = ['fridge', 'stove', 'tv'];
const GROUND: Record<number, Surface> = {
  [Ground.Grass]: 'dirt',
  [Ground.Asphalt]: 'concrete',
  [Ground.Dirt]: 'dirt',
  [Ground.Concrete]: 'concrete',
  [Ground.Floor]: 'wood',
  [Ground.Gravel]: 'concrete',
  [Ground.Water]: 'water',
  [Ground.Sand]: 'sand',
  [Ground.Mud]: 'dirt',
};

function ofProp(p: Prop): Surface {
  if (p.kind === 'wall' || p.kind === 'doorframe' || p.kind === 'window') return p.style === 'metal' ? 'metal' : p.style === 'brick' ? 'brick' : 'concrete';
  if (p.kind === 'furniture') return METAL_FURNITURE.includes(FURN_IDS[p.variant] as FurnitureKind) ? 'metal' : 'wood';
  return PROP[p.kind] ?? 'concrete';
}

const tables = new WeakMap<MapData, Uint8Array>();

/** 每一格上挡子弹的障碍物是什么材质（地图不会变，第一次用到时算一遍） */
function tableOf(map: MapData): Uint8Array {
  let t = tables.get(map);
  if (t) return t;
  const grid = map.grid;
  t = new Uint8Array(grid.count);
  for (const p of map.props) {
    if (!p.solid) continue;
    const code = LIST.indexOf(ofProp(p)) | (p.kind === 'wall' && p.style === 'metal' ? SKIRT : 0);
    for (let y = p.y0; y < p.y1; y++) {
      for (let x = p.x0; x < p.x1; x++) if (grid.inBounds(x, y)) t[grid.idx(x, y)] = code;
    }
  }
  tables.set(map, t);
  return t;
}

/**
 * 命中点 (x, z)、离地 y 米处是什么材质。ground = 打在地上，否则是打在障碍物 / 玩家造的建筑上
 * （和 combat.ts 的 obstruction 对应：实心格看地图上的障碍物，不是实心的格看上面的建筑）
 */
export function surfaceAt(g: Game, x: number, y: number, z: number, ground: boolean): Surface {
  const grid = g.grid;
  const cx = grid.cellX(x);
  const cy = grid.cellY(z);
  if (!grid.inBounds(cx, cy)) return 'concrete';
  const i = grid.idx(cx, cy);
  const under = GROUND[grid.ground[i] as number] ?? 'dirt';
  // 湖面：格子是实心的（不能走），但高度只有 1 厘米，打上去就是打在水面上
  const h = grid.height[i] as number;
  if (ground || (under === 'water' && h > 0 && h < 0.1)) return under;
  if (!grid.solid[i]) {
    const sid = grid.structure[i] as number;
    if (sid < 0) return 'concrete';
    return isTurret(g.structures.get(sid)?.kind ?? 'barricade') ? 'metal' : 'wood';
  }
  const code = tableOf(g.map)[i] as number;
  if (code & SKIRT && y < SKIRT_H) return 'concrete';
  return LIST[code & 0x7f] as Surface;
}
