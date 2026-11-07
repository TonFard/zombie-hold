import { Box3, Group, type Material, Mesh, PlaneGeometry, Vector3 } from 'three';
import { buildAtoms, type AtomInstance } from './atoms';

/**
 * 房间模块的组装：房间不是资产，是「原子 + 摆放」。
 *
 * 一间卧室 = 一组房间模块（RM-JP-06）= 一份摆放数据 + 一批原子 id。
 * 换一套摆放数据就是另一间卧室，原子本身完全复用。
 * 这是资产树能撑住 25 km² 的原因：原子有限，摆放无限。
 */

export interface Placement {
  /** 原子 id */
  id: string;
  /** 相对房间原点的位置（米） */
  at: [number, number, number];
  /** 绕 Y 的朝向，弧度 */
  yaw?: number;
  scale?: number;
}

export interface RoomModule {
  id: string;
  /** 房间尺寸（米）：宽 X、深 Z、高 Y */
  size: [number, number, number];
  placements: Placement[];
}

/**
 * 日式卧室（RM-JP-06）：榻榻米、书桌、床、书架。
 * 这份数据是第一个真实房间模块，也是所有房间模块的写法范例。
 */
export const RM_JP_06_BEDROOM: RoomModule = {
  id: 'rm_jp_06',
  size: [3.6, 2.5, 4.2],
  placements: [
    // --- 书桌（桌面 + 四腿 + 抽屉 + 把手 + 理线孔 + 脚钉）---
    { id: 'jp_bedroom_desk_top_oak', at: [-1.0, 0.75, -0.7], yaw: 0 },
    { id: 'jp_bedroom_desk_leg_taper', at: [-1.55, 0.0, -0.95], yaw: 0 },
    { id: 'jp_bedroom_desk_leg_taper', at: [-0.45, 0.0, -0.95], yaw: 0 },
    { id: 'jp_bedroom_desk_leg_taper', at: [-1.55, 0.0, -0.45], yaw: 0 },
    { id: 'jp_bedroom_desk_leg_taper', at: [-0.45, 0.0, -0.45], yaw: 0 },
    { id: 'jp_bedroom_desk_pin_leg', at: [-1.55, 0.0, -0.95] },
    { id: 'jp_bedroom_desk_pin_leg', at: [-0.45, 0.0, -0.95] },
    { id: 'jp_bedroom_desk_pin_leg', at: [-1.55, 0.0, -0.45] },
    { id: 'jp_bedroom_desk_pin_leg', at: [-0.45, 0.0, -0.45] },
    { id: 'jp_bedroom_desk_apron', at: [-1.0, 0.68, -0.95] },
    { id: 'jp_bedroom_desk_apron', at: [-1.0, 0.68, -0.45] },
    { id: 'jp_bedroom_desk_drawer_box', at: [-1.0, 0.55, -0.7] },
    { id: 'jp_bedroom_desk_drawer_face', at: [-1.0, 0.55, -0.955] },
    { id: 'jp_bedroom_desk_handle_bar', at: [-1.0, 0.68, -0.97] },
    { id: 'jp_bedroom_desk_cable_grommet', at: [-0.55, 0.774, -0.87] },

    // --- 桌面上的书本：封面 / 书页 / 书脊 三件各一个 ---
    {
      id: 'jp_bedroom_book_hardcover_cover',
      at: [-1.25, 0.775, -0.72],
      yaw: 0.18,
    },
    { id: 'jp_bedroom_book_hardcover_pages', at: [-1.25, 0.777, -0.72], yaw: 0.18 },
    { id: 'jp_bedroom_book_hardcover_spine', at: [-1.32, 0.775, -0.72], yaw: 0.18 },
    {
      id: 'jp_bedroom_book_magazine_cover',
      at: [-1.02, 0.776, -0.62],
      yaw: -0.35,
    },
    { id: 'jp_bedroom_book_magazine_pages', at: [-1.02, 0.777, -0.62], yaw: -0.35 },
    { id: 'jp_bedroom_book_manga_cover', at: [-0.82, 0.776, -0.83], yaw: 0.52 },
    { id: 'jp_bedroom_book_manga_pages', at: [-0.82, 0.777, -0.83], yaw: 0.52 },
    { id: 'jp_bedroom_notebook_cover', at: [-0.72, 0.775, -0.55], yaw: -0.12 },
    { id: 'jp_bedroom_notebook_pages', at: [-0.72, 0.776, -0.55], yaw: -0.12 },

    // --- 桌上的文具 ---
    { id: 'jp_bedroom_pen_ballpoint_body', at: [-0.95, 0.775, -0.45], yaw: 0.4 },
    { id: 'jp_bedroom_pen_ballpoint_cap', at: [-0.95, 0.855, -0.45], yaw: 0.4 },
    { id: 'jp_bedroom_pen_ballpoint_tip', at: [-0.95, 0.775, -0.42], yaw: 0.4 },
    { id: 'jp_bedroom_pencil_body', at: [-0.88, 0.775, -0.52], yaw: -0.2 },
    { id: 'jp_bedroom_pencil_wood', at: [-0.88, 0.775, -0.49], yaw: -0.2 },
    { id: 'jp_bedroom_pencil_eraser', at: [-0.88, 0.87, -0.55], yaw: -0.2 },
    { id: 'jp_bedroom_marker_highlight_body', at: [-0.65, 0.775, -0.62], yaw: 0.9 },
    { id: 'jp_bedroom_marker_highlight_cap', at: [-0.65, 0.85, -0.62], yaw: 0.9 },
    { id: 'jp_bedroom_envelope', at: [-1.42, 0.775, -0.5], yaw: 0.28 },
    { id: 'jp_bedroom_stapler_body', at: [-0.62, 0.775, -0.86], yaw: -0.5 },
    { id: 'jp_bedroom_stapler_arm', at: [-0.62, 0.797, -0.86], yaw: -0.5 },
  ],
};

/** 把房间模块装进场景。房间原点是地板中心。 */
export async function buildRoom(module: RoomModule, parent: Group): Promise<Group> {
  const instances: AtomInstance[] = module.placements.map((p) => ({
    id: p.id,
    position: new Vector3(p.at[0], p.at[1], p.at[2]),
    yaw: p.yaw ?? 0,
    scale: p.scale,
  }));
  const built = await buildAtoms(instances, parent);
  built.name = `room:${module.id}`;
  return built;
}

/** 房间的地面（一张板，材质由调用方给）。 */
export function roomFloor(module: RoomModule, material: Material): Mesh {
  const [w, , d] = module.size;
  const mesh = new Mesh(new PlaneGeometry(w, d), material);
  mesh.name = `floor:${module.id}`;
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return mesh;
}

/** 房间模块里的所有原子（去重）。 */
export function atomsUsed(module: RoomModule): string[] {
  return [...new Set(module.placements.map((p) => p.id))];
}

/** 一个房间模块的包围盒（由摆放算，不加载模型）。 */
export function roomExtent(module: RoomModule): Box3 {
  const box = new Box3();
  for (const p of module.placements) {
    const s = p.scale ?? 1;
    box.expandByPoint(new Vector3(p.at[0] - 0.1 * s, p.at[1], p.at[2] - 0.1 * s));
    box.expandByPoint(new Vector3(p.at[0] + 0.1 * s, p.at[1] + 0.5 * s, p.at[2] + 0.1 * s));
  }
  return box;
}
