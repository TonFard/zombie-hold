import { Rng } from '../../game/core/rng';
import type { WallStyle } from '../../game/world/types';
import type { LootPlace } from '../game/items';
import { Colliders } from './colliders';
import type { HouseId } from './houses';
import { buildHouse, houseDims, type HouseOpts, type HouseOut } from './housing';
import SIZES from './model-sizes.json';
import { hash2 } from './noise';
import { GRID, ROAD_W, type RoadNode, type Roads } from './roads';
import { WATER, type Flat, type Paint, type SiteRef, type Terrain } from './terrain';

/**
 * 地点：起点（路边的停车带）、加油站、小镇、农场、货场、林间木屋、公路检查站、军事基地。
 * 无限地图上每个路口按种子决定有没有地点、是哪一种；出生点附近几个是固定的
 * （原点 = 起点，往北依次是加油站、小镇、军事基地，往南是农场），再远的随机，军事基地越远越多。
 * 地点都贴着路口：路口四周 64 米的路是笔直的（正南北 / 正东西），所以模板只管「门朝着路」的本地坐标。
 * 一个地点的全部内容（墙、屋顶、道具、碰撞、压平区）在第一次被问到时一次算完并缓存，纯 TS，不碰 three。
 *
 * 每个地点是一个「院落」而不是空地上的几个盒子：房子围着院子或者沿街排开，有围栏和大门、从门口到路上的车道、
 * 墙根的柴堆垃圾桶、角上的杂物棚。屋外的东西一律靠墙、靠围栏、进角落，码整齐，不挡路（过人的地方至少 2.5 米，过车的至少 4 米）；
 * 不到半米高的不设碰撞。
 */

/** shutter = 旧铁皮（卷帘门、铁门、车棚的柱子） */
/** plaster_in = 屋里的抹灰墙面（和 plaster 同一张贴图，提亮：屋里只有环境光） */
/** xxx_in = 同一种料子朝屋里的那一面（见 houses.ts 的 SKIN_IN） */
export type Skin = WallStyle | 'planks' | 'plaster_old' | 'plaster_in' | 'compound_in' | 'brick_in' | 'metal_in' | 'planks_in' | 'wallpaper' | 'shutter';
/** 墙的一个面：[材质, 颜色] */
export type Face = readonly [Skin, number];
/** 屋面：红瓦、灰绿的瓦楞铁、深色的油毡瓦、生锈的铁皮 */
export type RoofTex = 'roof_tiles' | 'wall_metal' | 'shingle' | 'rust';
/** pave = 露天的水泥地（人行道、停机坪）：和 concrete 一样，只是下雪会变白 */
export type SlabTex = 'floor' | 'floor_tile' | 'concrete' | 'pave' | 'deck' | 'roof' | 'ceil' | 'canopy' | 'pillar' | 'mattress' | 'blanket' | 'blanket2' | 'blanket3' | 'carpet' | 'rug' | 'rug2';
/** camp = 起点。名字是沿用下来的（丧尸模块按它判断「出生点不刷丧尸」），内容早就不是营地了：公路边的一段停车带 */
export type SiteKind = 'camp' | 'gas' | 'town' | 'farm' | 'yard' | 'cabin' | 'post' | 'base';
export type FenceKind = 'picket' | 'board' | 'rail' | 'brick' | 'concrete';

type V3 = [number, number, number];
const SIZE = SIZES as unknown as Record<string, V3>;

/** 一个模型实例（世界坐标）。follow：不在压平区里的东西，高度在显示时按实际地面算，值 = 往下埋多少 */
export interface Inst {
  id: string;
  x: number;
  y: number;
  z: number;
  ry: number;
  rx?: number;
  sx: number;
  sy: number;
  sz: number;
  /** 小东西（家具、箱子、杂物）：远了不画 */
  small?: boolean;
  follow?: number;
  /** 在哪栋房子里（SiteContent.interiors 的下标）：屋里的东西走到那栋房子跟前才画 */
  house?: number;
}

export interface WallBox {
  x: number;
  z: number;
  L: number;
  T: number;
  y0: number;
  h: number;
  horiz: boolean;
  skin: Skin;
  tint: number;
  /** 两个大面各自的材质（不写 = 和 skin 一样）：neg 朝 -z（横墙）/ -x（竖墙），pos 朝 +z / +x。外墙朝外是外墙皮、朝屋里是内墙面 */
  neg?: Face;
  pos?: Face;
}

/** 一块窗玻璃（竖直的矩形，在墙的中线上）：a = 有多脏（越大越不透明） */
export interface Pane {
  x: number;
  z: number;
  L: number;
  y0: number;
  y1: number;
  horiz: boolean;
  a: number;
}

export interface Slab {
  x: number;
  z: number;
  w: number;
  d: number;
  y0: number;
  h: number;
  tex: SlabTex;
  /** 换个颜色（雨棚、招牌） */
  color?: number;
}

/**
 * 一块屋顶。(x0, z0)–(x1, z1) 是它盖住的墙的外轮廓（世界坐标），y 是墙顶。四条边的顺序：0 北（-z）1 东（+x）2 南（+z）3 西（-x）
 *   gable 双坡：屋脊沿 X（ridgeX）或沿 Z，rise = 屋脊比墙顶高多少
 *   shed  单坡：hi 那一边高出 rise
 * over = 四边各出檐多少；ends = 四边的墙要不要一直砌到屋面（山墙的三角、单坡高的那一边）
 */
export interface Roof {
  kind: 'gable' | 'shed';
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y: number;
  rise: number;
  over: [number, number, number, number];
  ridgeX: boolean;
  hi: number;
  ends: [boolean, boolean, boolean, boolean];
  /** 山墙的材质（null = 没有墙：门廊、车棚） */
  skin: Skin | null;
  tint: number;
  tex: RoofTex;
  rtint: number;
}

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** 一块地（贴着一条路的矩形）。本地坐标：x 沿路 0…W，z 从后往前 0…D，z = D 那条边对着路 */
export interface Lot {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  cx: number;
  cz: number;
  /** 0 = 路在南边，1 = 西，2 = 北，3 = 东 */
  rot: number;
  W: number;
  D: number;
  /** 门前那条路的宽度 */
  fw: number;
  /** 正面那条边离路边多远 */
  set: number;
  /** 路口在 x = W 那一头（不写 = 在 x = 0 那一头）：镇子靠路口的一头是铺面 */
  flip?: boolean;
  paint?: Paint;
}

/** 镇子的一个街区怎么排（地块的本地坐标）。铺装（压平区）和房子都按它来，所以在生成地点的时候就定下 */
export interface BlockItem {
  id: HouseId;
  x: number;
  z: number;
  w: number;
  d: number;
  shop: boolean;
  o: HouseOpts;
}
export interface BlockPlan {
  /** 临街的一排、后巷里面的一排 */
  front: BlockItem[];
  back: BlockItem[];
  /** 从街上通到后巷的车道（中线的 x） */
  lanes: number[];
  /** 后巷（z 的范围） */
  a0: number;
  a1: number;
}

export interface Site {
  key: number;
  i: number;
  j: number;
  kind: SiteKind;
  name: string;
  /** 路口 */
  nx: number;
  nz: number;
  /** 包住所有地块的圆 */
  x: number;
  z: number;
  r: number;
  h: number;
  /** 危险度：离出生点的公里数 */
  danger: number;
  /** 路口周围这么远以内的路面和地点一样高 */
  plateau: number;
  lots: Lot[];
  flats: Flat[];
  /** 镇子：每块地的街区布局 */
  blocks?: BlockPlan[];
}

/** 一个可能有战利品的位置（世界坐标，y = 东西放在多高）。放什么由玩法层按 place 和地点的危险等级抽（game/items.ts 的 rollLoot） */
export interface LootSpot {
  x: number;
  y: number;
  z: number;
  place: LootPlace;
  /** 在哪栋房子里（interiors 的下标）；-1 = 屋外 */
  house: number;
}

/** 头顶有东西的范围（屋顶、雨棚）：世界坐标的矩形，y = 顶的高度。雨雪落不到它下面 */
export interface Cover extends Rect {
  y: number;
}

/** 房子的一扇外门：(x, z) 门里面一米的点，(ox, oz) 门外面一米多的点 */
export interface Door {
  x: number;
  z: number;
  ox: number;
  oz: number;
}

/** 一栋房子的里面：能站人的空格（世界坐标 x, z, x, z…）。以后放物资、刷丧尸用；测试用它检查每一格都走得到 */
export interface Interior {
  id: HouseId;
  /** 外轮廓（世界坐标） */
  rect: Rect;
  /** 地板面的高度（世界坐标）：站在屋里时脚底的高度 */
  y: number;
  /** 正门外面一米多的一个点（没有门的废墟是 null） */
  entry: [number, number] | null;
  /** 所有的外门（宽门每一格算一扇）。丧尸、找路用：屋里屋外隔着墙时先走到门口 */
  doors: Door[];
  free: number[];
}

/** 地点里的全部东西：走近了才生成（见 Sites.content） */
export interface SiteContent {
  inst: Inst[];
  walls: WallBox[];
  slabs: Slab[];
  roofs: Roof[];
  /** 窗玻璃（一个地点合成一个半透明的网格） */
  panes: Pane[];
  lamps: Array<{ x: number; y: number; z: number }>;
  cols: Colliders;
  /** 有地板的房子的外轮廓（里面不长草；地图上画出来） */
  houses: Rect[];
  interiors: Interior[];
  /** 能停一辆车的空位（世界坐标，yaw = 车头朝向）：车辆模块按种子决定这里有没有一台能开的车 */
  parking: Array<{ x: number; z: number; yaw: number }>;
  /** 加油机（世界坐标）：车停在旁边能加油 */
  pumps: Array<{ x: number; z: number }>;
  /** 可能有战利品的位置 */
  loot: LootSpot[];
  /** 屋顶、雨棚盖住的范围 */
  covers: Cover[];
  spawn?: { x: number; z: number; yaw: number };
}

/** 地块离别的路至少这么远（自己门前那条路按 SPEC 里的退让算） */
const CLEAR = 8;

/** 抹灰墙的颜色：旧房子各刷各的 */
const PLASTER = [0xffffff, 0xe9dfc6, 0xd3dcc6, 0xcdd6dc, 0xe3cdbd, 0xd9d2c4];
/** 铁皮房、瓦屋面、谷仓木板的颜色 */
const METAL_TINT = [0xffffff, 0xe2d2bc, 0xcfdade, 0xdcb8a8, 0xd0d8c0];
const TILE_TINT = [0xffffff, 0xf2d6c6, 0xdcc4b4, 0xcfcfcf];
const BARN_TINT = [0xd89a88, 0xc9bca6, 0xb8a890];
/** 镇子里的住宅、后巷里的小房子 */
const HOMES: readonly HouseId[] = ['bungalow', 'cottage', 'ranch', 'bungalow', 'cottage', 'cabin'];
const BACKS: readonly HouseId[] = ['cabin', 'shack', 'bungalow', 'cottage', 'shack', 'ruin', 'cabin'];
const NAME_A = ['溪', '石', '白', '松', '红', '柳', '青', '北', '旧', '三', '黑', '长', '野', '铁', '落', '风', '南', '双', '老', '枯', '灰', '大', '东', '西'];
const NAME_B = ['口', '桥', '杨', '岭', '土', '湾', '石', '坡', '河', '岔', '水', '岗', '马', '山', '雁', '沟', '泉', '塘', '井', '崖', '渡', '营', '屯', '原'];

interface PutOpts {
  /** 离地点地面的高度（不给 = 落地，往下埋 sink） */
  dy?: number;
  rx?: number;
  sink?: number;
  small?: boolean;
}

function rectDist(x: number, z: number, x0: number, z0: number, x1: number, z1: number): number {
  return Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1));
}

/** 地块的本地坐标 → 世界坐标 */
export function lotPt(l: Lot, lx: number, lz: number): [number, number] {
  const a = lx - l.W / 2;
  const b = lz - l.D / 2;
  switch (l.rot) {
    case 0:
      return [l.cx + a, l.cz + b];
    case 1:
      return [l.cx - b, l.cz + a];
    case 2:
      return [l.cx - a, l.cz - b];
    default:
      return [l.cx + b, l.cz - a];
  }
}

/** 一栋房子的外观：墙皮、颜色、屋面各不相同，左右随机镜像 */
function look(id: HouseId, rng: Rng): HouseOpts {
  const o: HouseOpts = { mirror: rng.chance(0.5), board: rng.range(0.12, 0.42) };
  if (id === 'store' || id === 'clinic') {
    o.skin = rng.pick(['plaster', 'plaster', 'plaster_old', 'brick'] as const);
    if (o.skin !== 'brick') o.tint = rng.pick(PLASTER);
  } else if (id === 'garage' || id === 'warehouse') o.tint = rng.pick(METAL_TINT);
  else if (id === 'bungalow' || id === 'cottage' || id === 'ranch') {
    o.skin = rng.pick(['brick', 'plaster', 'plaster', 'plaster_old'] as const);
    if (o.skin !== 'brick') o.tint = rng.pick(PLASTER);
    o.roofTex = rng.pick(['roof_tiles', 'roof_tiles', 'shingle'] as const);
    if (o.roofTex === 'roof_tiles') o.rtint = rng.pick(TILE_TINT);
  } else if (id === 'barn') o.tint = rng.pick(BARN_TINT);
  return o;
}

/**
 * 镇子的一个街区：临街一排从路口那头排起——先是一两间铺面（贴着人行道），再是住宅（退后几米，有前院）；
 * 铺面和住宅之间留一条通后巷的车道；后巷里面还有一排小房子。
 */
export function planBlock(l: Lot, rng: Rng, li = 0): BlockPlan {
  const { W, D } = l;
  const a1 = D - 22;
  const a0 = a1 - 4.4;
  const at = (u: number, w: number): number => (l.flip ? W - u - w : u);
  const front: BlockItem[] = [];
  const back: BlockItem[] = [];
  const lanes: number[] = [];
  // 铺面按地块轮着来（li = 镇子里的第几块地）：一个镇子里便利店、修车铺、诊所都有
  const cycle: readonly HouseId[] = ['store', 'garage', 'clinic'];
  const shops: HouseId[] = [cycle[li % 3] as HouseId, cycle[(li + 1 + rng.int(0, 1)) % 3] as HouseId];
  const nShop = rng.int(1, 2);
  let u = 1;
  for (let k = 0; k < 6; k++) {
    const shop = k < nShop;
    let id: HouseId = shop ? (shops[k] as HouseId) : rng.pick(HOMES);
    if (u + houseDims(id)[0] > W - 1) {
      // 放不下：换小的，再不行这一排就到头了
      const small = shop ? undefined : (['cabin', 'shack'] as const).find((q) => u + houseDims(q)[0] <= W - 1);
      if (!small) break;
      id = small;
    }
    const [w, d] = houseDims(id);
    // 铺面贴着人行道（雨棚伸到人行道上），住宅退后几米留出前院
    const set = shop ? rng.range(1, 1.5) : id === 'shack' ? rng.range(5, 7) : rng.range(4.2, 5.6);
    front.push({ id, x: at(u, w), z: D - set - d, w, d, shop, o: look(id, rng) });
    const lane = k === nShop - 1;
    const gap = lane ? 5 : shop ? 2.4 : rng.range(2.6, 3.4);
    if (lane) lanes.push(l.flip ? W - (u + w + gap / 2) : u + w + gap / 2);
    u += w + gap;
  }
  let v = rng.range(2, 5);
  for (let k = 0; k < 3; k++) {
    const id = rng.pick(BACKS);
    const [w, d] = houseDims(id);
    if (v + w > W - 1.5) break;
    if (rng.chance(0.8)) back.push({ id, x: at(v, w), z: Math.max(0.8, a0 - rng.range(1.2, 2.4) - d), w, d, shop: false, o: look(id, rng) });
    v += w + rng.range(4, 8);
  }
  return { front, back, lanes, a0, a1 };
}

/** 一块地上小块的铺装（本地坐标的矩形）：从门口到路上的车道、人行道、院子、田。画在地面上，比整块地的铺装优先 */
function paints(kind: SiteKind, l: Lot, plan: BlockPlan | null): Array<[number, number, number, number, Paint]> {
  const { W, D } = l;
  const road = D + l.set + 1;
  switch (kind) {
    case 'town': {
      const out: Array<[number, number, number, number, Paint]> = [];
      if (!plan) return out;
      // 铺面门前的场地、后面卸货的院子
      for (const it of plan.front) {
        if (!it.shop) continue;
        out.push([it.x - 1, it.z + it.d - 1, it.x + it.w + 1, D, 'concrete']);
        out.push([it.x, plan.a1 - 0.5, it.x + it.w, it.z + 1, 'gravel']);
      }
      for (const c of plan.lanes) out.push([c - 2.6, plan.a1 - 0.5, c + 2.6, D, 'gravel']);
      // 人行道：整条街面；后巷：通到路口那头的横街
      out.push([-1, D - 1.5, W + 1, road, 'concrete']);
      out.push([l.flip ? 1 : -l.set - 1, plan.a0, l.flip ? W + l.set + 1 : W - 1, plan.a1, 'gravel']);
      return out;
    }
    case 'farm':
      return [
        [W / 2 - 3.5, D - 2, W / 2 + 3.5, road, 'dirt'],
        [18, 37, W - 3, D - 1, 'dirt'],
        [2, 2, W - 2, 24, 'field'],
      ];
    case 'gas':
      return [[1, D - 1, W - 1, road, 'asphalt']];
    case 'yard':
      return [[W / 2 - 6, D - 1, W / 2 + 6, road, 'asphalt']];
    case 'cabin':
      return [[19, 13, 26, road, 'dirt']];
    case 'post':
      return [[0, D - 1, W, road, 'gravel']];
    case 'base':
      return [
        [W / 2 - 7, D - 1, W / 2 + 7, road, 'asphalt'],
        [W / 2 - 6, 27, W / 2 + 6, D, 'asphalt'],
        [3, 27, W - 3, 33, 'asphalt'],
        [4, 60, W / 2 - 8, D - 3, 'concrete'],
        [W / 2 + 8, 62, W - 7, D - 12, 'concrete'],
      ];
    default:
      return [[-1, D - 1, W + 1, road, 'gravel']];
  }
}

// ---------------------------------------------------------------- 搭建器（本地坐标 → 世界坐标）

export class Builder {
  readonly inst: Inst[] = [];
  readonly walls: WallBox[] = [];
  readonly slabs: Slab[] = [];
  readonly roofs: Roof[] = [];
  readonly panes: Pane[] = [];
  readonly lamps: Array<{ x: number; y: number; z: number }> = [];
  readonly houses: Rect[] = [];
  readonly interiors: Interior[] = [];
  readonly parking: Array<{ x: number; z: number; yaw: number }> = [];
  readonly pumps: Array<{ x: number; z: number }> = [];
  readonly loot: LootSpot[] = [];
  readonly covers: Cover[] = [];
  readonly cols: Colliders;
  lot!: Lot;
  /** 打开后放的东西都贴着实际地面（地块外面、路上的东西） */
  follow = false;
  /** 正在搭哪栋房子（-1 = 屋外）：这期间放的东西都记在它名下 */
  houseTag = -1;

  constructor(
    readonly rng: Rng,
    readonly h: number,
    ox: number,
    oz: number,
  ) {
    this.cols = new Colliders(ox, oz);
  }

  pt(lx: number, lz: number): [number, number] {
    return lotPt(this.lot, lx, lz);
  }

  /** 本地朝向 → 世界朝向（地块顺时针转了 rot × 90°） */
  ang(ry: number): number {
    return ry - (this.lot.rot * Math.PI) / 2;
  }

  size(id: string): V3 {
    const s = SIZE[id];
    if (!s) throw new Error(`没有模型 ${id} 的尺寸（重新跑 node scripts/tools/open-model-sizes.mjs）`);
    return s;
  }

  put(id: string, lx: number, lz: number, ry: number, s: number | V3, o: PutOpts = {}): Inst {
    const [sx, sy, sz] = typeof s === 'number' ? [s, s, s] : s;
    const [x, z] = this.pt(lx, lz);
    const sink = o.sink ?? 0.03;
    const it: Inst = { id, x, y: this.h + (o.dy ?? -sink), z, ry: this.ang(ry), sx, sy, sz };
    if (o.rx) it.rx = o.rx;
    if (o.small) it.small = true;
    if (this.houseTag >= 0) it.house = this.houseTag;
    if (this.follow && o.dy === undefined) it.follow = sink;
    this.inst.push(it);
    return it;
  }

  /** 按真实尺寸放：长 L 米（模型的长边），H / W 不给就等比 */
  real(id: string, lx: number, lz: number, ry: number, L: number, H = 0, W = 0, o: PutOpts = {}): Inst {
    const [w, h, d] = this.size(id);
    const k = L / w;
    return this.put(id, lx, lz, ry, [k, H ? H / h : k, W ? W / d : k], o);
  }

  /** 碰撞盒（本地坐标，dy0 / dy1 相对地点地面）。贴地的东西高度不确定，上下各放宽 6 米 */
  box(lx: number, lz: number, hx: number, hz: number, ry: number, dy0: number, dy1: number): void {
    const [x, z] = this.pt(lx, lz);
    const pad = this.follow ? 6 : 0;
    this.cols.addBox(x, z, hx, hz, this.ang(ry), this.h + dy0 - pad, this.h + dy1 + pad);
  }

  circle(lx: number, lz: number, r: number, dy0: number, dy1: number): void {
    const [x, z] = this.pt(lx, lz);
    const pad = this.follow ? 6 : 0;
    this.cols.addCircle(x, z, r, this.h + dy0 - pad, this.h + dy1 + pad);
  }

  /** 按实例的外轮廓挡路 */
  solid(it: Inst, shrink = 0.85, hMax = Infinity): void {
    const [w, h, d] = this.size(it.id);
    const pad = it.follow !== undefined ? 6 : 0;
    this.cols.addBox(it.x, it.z, ((w * it.sx) / 2) * shrink, ((d * it.sz) / 2) * shrink, it.ry, it.y - pad, it.y + Math.min(h * it.sy, hMax) + pad);
  }

  /** 一段墙：中心、长、是否沿本地 X、底（相对地面）、高 */
  wall(lx: number, lz: number, L: number, alongX: boolean, dy0: number, h: number, skin: Skin, tint = 0xffffff, T = 0.92, solid = true): void {
    const [x, z] = this.pt(lx, lz);
    const horiz = alongX !== (this.lot.rot % 2 === 1);
    this.walls.push({ x, z, L, T, y0: this.h + dy0, h, horiz, skin, tint });
    if (solid) this.cols.addBox(x, z, horiz ? L / 2 : T / 2, horiz ? T / 2 : L / 2, 0, this.h + dy0, this.h + dy0 + h);
  }

  /** 沿本地轴线的一道墙 / 栅栏（两端点） */
  fence(ax: number, az: number, bx: number, bz: number, h: number, skin: Skin, tint = 0xffffff, T = 0.5): void {
    const alongX = Math.abs(bx - ax) >= Math.abs(bz - az);
    this.wall((ax + bx) / 2, (az + bz) / 2, Math.hypot(bx - ax, bz - az) + T, alongX, -0.5, h + 0.5, skin, tint, T);
  }

  /**
   * 一段薄墙（不带碰撞）。horiz = 沿本地 X；line = 墙的中线（横墙是 z，竖墙是 x）；v0…v1 = 沿墙的范围；dy0…dy1 相对地面。
   * neg / pos = 朝本地 -z（竖墙 -x）、+z（+x）那一面的材质，不给就和墙体一样
   */
  seg(horiz: boolean, line: number, v0: number, v1: number, T: number, dy0: number, dy1: number, skin: Skin, tint = 0xffffff, neg?: Face, pos?: Face): void {
    const [x, z] = horiz ? this.pt((v0 + v1) / 2, line) : this.pt(line, (v0 + v1) / 2);
    const rot = this.lot.rot;
    const w: WallBox = { x, z, L: v1 - v0, T, y0: this.h + dy0, h: dy1 - dy0, horiz: horiz !== (rot % 2 === 1), skin, tint };
    if (neg || pos) {
      // 地块转过以后，本地「负的一面」可能到了世界的正的一面
      const side = ((horiz ? 0 : 3) + rot) & 3;
      const keep = side === 0 || side === 3;
      const n = keep ? neg : pos;
      const p = keep ? pos : neg;
      if (n) w.neg = n;
      if (p) w.pos = p;
    }
    this.walls.push(w);
  }

  /** 一块窗玻璃（参数同 seg） */
  pane(horiz: boolean, line: number, v0: number, v1: number, dy0: number, dy1: number, a: number): void {
    const [x, z] = horiz ? this.pt((v0 + v1) / 2, line) : this.pt(line, (v0 + v1) / 2);
    this.panes.push({ x, z, L: v1 - v0, y0: this.h + dy0, y1: this.h + dy1, horiz: horiz !== (this.lot.rot % 2 === 1), a });
  }

  /** 一块屋顶（本地坐标的矩形 = 墙的外轮廓；over / ends 的四边按本地的 0 后 1 右 2 前 3 左，见 Roof） */
  roof(
    kind: Roof['kind'],
    ax: number,
    az: number,
    bx: number,
    bz: number,
    dy: number,
    rise: number,
    over: readonly [number, number, number, number],
    ridgeX: boolean,
    hi: number,
    ends: readonly [boolean, boolean, boolean, boolean],
    skin: Skin | null,
    tint: number,
    tex: RoofTex,
    rtint: number,
  ): void {
    const [x0, z0] = this.pt(ax, az);
    const [x1, z1] = this.pt(bx, bz);
    const rot = this.lot.rot;
    const o: Roof['over'] = [0, 0, 0, 0];
    const e: Roof['ends'] = [false, false, false, false];
    for (let s = 0; s < 4; s++) {
      o[(s + rot) & 3] = over[s] as number;
      e[(s + rot) & 3] = ends[s] as boolean;
    }
    this.roofs.push({ kind, x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), y: this.h + dy, rise, over: o, ridgeX: ridgeX !== (rot % 2 === 1), hi: (hi + rot) & 3, ends: e, skin, tint, tex, rtint });
  }

  slab(lx: number, lz: number, w: number, d: number, dy0: number, h: number, tex: SlabTex, color?: number): void {
    const [x, z] = this.pt(lx, lz);
    const odd = this.lot.rot % 2 === 1;
    const sl: Slab = { x, z, w: odd ? d : w, d: odd ? w : d, y0: this.h + dy0, h, tex };
    if (color !== undefined) sl.color = color;
    this.slabs.push(sl);
  }

  /** 一个可能有战利品的位置（本地坐标，dy = 离地点地面多高） */
  lootAt(lx: number, lz: number, dy: number, place: LootPlace): void {
    const [x, z] = this.pt(lx, lz);
    this.loot.push({ x, y: this.h + dy, z, place, house: this.houseTag });
  }

  /** 头顶有东西的范围（本地坐标的矩形，dy = 顶离地点地面多高） */
  cover(ax: number, az: number, bx: number, bz: number, dy: number): void {
    const [x0, z0] = this.pt(ax, az);
    const [x1, z1] = this.pt(bx, bz);
    this.covers.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), y: this.h + dy });
  }

  /** 留一个能停车的空位（本地坐标，ry = 车头朝向） */
  park(lx: number, lz: number, ry: number): void {
    const [x, z] = this.pt(lx, lz);
    this.parking.push({ x, z, yaw: this.ang(ry) });
  }

  lampAt(lx: number, lz: number): void {
    const [x, z] = this.pt(lx, lz);
    this.lamps.push({ x, y: this.h, z });
  }

  // ---------------------------------------------------------------- 常用道具

  car(lx: number, lz: number, ry: number, kind = this.rng.int(0, 4), dy?: number): void {
    const id = (['car_sedan1', 'car_sedan2', 'car_crashed', 'car_truck', 'van_wreck'] as const)[kind % 5] as string;
    const L = id === 'car_truck' ? 5.3 : id === 'van_wreck' ? 4.4 : 4.6;
    const it = this.real(id, lx, lz, ry, L, 0, 0, dy === undefined ? { sink: 0.02 } : { dy });
    this.box(lx, lz, L / 2 - 0.15, id === 'car_sedan1' || id === 'car_sedan2' || id === 'car_crashed' ? 0.92 : 1.0, ry, -0.2, this.size(id)[1] * it.sy * 0.8);
    // 车门边上可能掉着东西
    if (this.houseTag < 0 && !this.follow && this.rng.chance(0.5)) {
      const side = this.rng.chance(0.5) ? 1 : -1;
      const along = this.rng.range(-1, 1);
      // 车身的长边沿本地 X（ry = 0 时），所以「车门边上」是往本地 Z 挪
      this.lootAt(lx + Math.cos(ry) * along + Math.sin(ry) * 1.5 * side, lz - Math.sin(ry) * along + Math.cos(ry) * 1.5 * side, 0.02, 'car');
    }
  }

  container(lx: number, lz: number, ry: number, layers = 1): void {
    let dy = -0.05;
    for (let k = 0; k < layers; k++) {
      const id = (k + this.rng.int(0, 1)) % 2 ? 'container_blue' : 'container_rust';
      const [w, h, d] = this.size(id);
      this.put(id, lx + (k ? this.rng.range(-0.15, 0.15) : 0), lz, ry + (k ? this.rng.range(-0.02, 0.02) : 0) + (this.rng.chance(0.5) ? Math.PI : 0), [6.06 / w, 2.6 / h, 2.44 / d], { dy });
      dy += 2.6;
    }
    this.box(lx, lz, 3.03, 1.22, ry, -0.3, dy);
  }

  barrel(lx: number, lz: number, dy = -0.03): void {
    const id = this.rng.pick(['Barrel_01', 'Barrel_02', 'barrel_03']);
    this.put(id, lx, lz, this.rng.range(0, 6.28), 0.92 / this.size(id)[1], { dy, small: true });
    this.circle(lx, lz, 0.32, dy - 0.2, dy + 0.92);
  }

  /** 一摞箱子。L = 箱子多长（屋里一格一摞，短一点）。返回垛顶离地点地面多高 */
  crates(lx: number, lz: number, ry: number, n: number, mil = false, dy0 = -0.02, L = mil ? 1.2 : 0.95): number {
    let dy = dy0;
    for (let k = 0; k < n; k++) {
      const id = mil ? 'wooden_military_crate' : k === 0 && this.rng.chance(0.4) ? 'plastic_container' : 'wooden_crate_01';
      const [w, h] = this.size(id);
      const s = Math.min(L / w, 1.25);
      this.put(id, lx + this.rng.range(-0.04, 0.04), lz + this.rng.range(-0.04, 0.04), ry + this.rng.range(-0.12, 0.12), s, { dy, small: true });
      dy += h * s;
    }
    this.box(lx, lz, L / 2, mil ? L * 0.225 : L * 0.31, ry, dy0 - 0.2, dy);
    return dy;
  }

  lamp(lx: number, lz: number, ry: number): void {
    this.put('street_lamp_01', lx, lz, ry, 4.35 / this.size('street_lamp_01')[1]);
    this.circle(lx, lz, 0.14, -0.2, 4.3);
    this.lampAt(lx, lz);
  }

  barrierLine(ax: number, az: number, bx: number, bz: number, gapEvery = 0): void {
    const L = Math.hypot(bx - ax, bz - az);
    const [w, h, d] = this.size('concrete_road_barrier');
    const n = Math.max(1, Math.round(L / w));
    const ry = Math.atan2(-(bz - az), bx - ax);
    for (let i = 0; i < n; i++) {
      if (gapEvery && i % gapEvery === gapEvery - 1) continue;
      const t = (i + 0.5) / n;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      this.put('concrete_road_barrier', x, z, ry + this.rng.range(-0.05, 0.05), [((L / n) * 0.97) / w, 1, 1]);
      this.box(x, z, L / n / 2, (d / 2) * 0.9, ry, -0.2, h);
    }
  }

  sandbagLine(ax: number, az: number, bx: number, bz: number, layers = 1): void {
    const L = Math.hypot(bx - ax, bz - az);
    const [w, h, d] = this.size('sandbags');
    const sy = 0.85 / h;
    const n = Math.max(1, Math.round(L / (w * sy)));
    const ry = Math.atan2(-(bz - az), bx - ax);
    const seg = L / n;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      for (let k = 0; k < layers; k++) this.put('sandbags', ax + (bx - ax) * t, az + (bz - az) * t, ry + (i % 2 ? Math.PI : 0), [seg / w, sy, 0.6 / d], { dy: -0.05 + k * 0.8 });
    }
    this.box((ax + bx) / 2, (az + bz) / 2, L / 2, 0.32, ry, -0.5, -0.05 + layers * 0.8);
  }

  /** 油桶、油壶（汽油）：油桶码成两排，油壶在前面（本地 +z 一侧）摆一溜 */
  fuelPile(lx: number, lz: number, n: number): void {
    const nb = Math.max(2, Math.round(n * 0.45));
    const cols = Math.ceil(nb / 2);
    for (let k = 0; k < nb; k++) this.barrel(lx + (Math.floor(k / 2) - (cols - 1) / 2) * 0.74, lz - (k % 2) * 0.74);
    const nc = n - nb;
    for (let k = 0; k < nc; k++) this.put(k % 3 === 2 ? 'plastic_jerrycan' : 'metal_jerrycan_green', lx + (k - (nc - 1) / 2) * 0.36, lz + 0.72, Math.PI / 2 + this.rng.range(-0.25, 0.25), 1, { small: true });
    for (let k = 0; k < 1 + Math.floor(n / 5); k++) this.lootAt(lx + (k - Math.floor(n / 5) / 2) * 0.9, lz + 1.35, 0.02, 'fuel');
  }

  /** 垃圾桶（靠墙一排；第三个是垃圾袋） */
  bins(lx: number, lz: number, alongX: boolean, n = 2): void {
    for (let k = 0; k < n; k++) {
      const o = (k - (n - 1) / 2) * 0.72;
      const x = lx + (alongX ? o : 0);
      const z = lz + (alongX ? 0 : o);
      if (k === 2) {
        this.put('trashbag', x, z, this.rng.range(0, 6.28), 1, { small: true });
        continue;
      }
      this.put('metal_trash_can', x, z, this.rng.range(0, 6.28), 0.9, { small: true });
      this.circle(x, z, 0.25, -0.2, 0.8);
    }
  }

  /** 柴堆：六根原木码两层，长边沿墙 */
  woodpile(lx: number, lz: number, alongX: boolean): void {
    for (let k = 0; k < 6; k++) {
      const o = ((k % 3) - 1) * 0.32;
      const along = this.rng.range(-0.08, 0.08);
      this.real('dead_tree_trunk', lx + (alongX ? along : o), lz + (alongX ? o : along), (alongX ? 0 : Math.PI / 2) + this.rng.range(-0.04, 0.04), 2.4, 0, 0, { dy: 0.02 + Math.floor(k / 3) * 0.26, small: true });
    }
    this.box(lx, lz, alongX ? 1.2 : 0.5, alongX ? 0.5 : 1.2, 0, -0.2, 0.6);
  }

  /** 一摞平放的轮胎 */
  tyres(lx: number, lz: number, n: number): void {
    const [, my, mz] = this.size('old_tyre');
    for (let k = 0; k < n; k++) this.put('old_tyre', lx + this.rng.range(-0.03, 0.03), lz + my / 2 + this.rng.range(-0.03, 0.03), 0, 1, { rx: -Math.PI / 2, dy: 0.01 + k * mz + mz / 2, small: true });
    if (n * mz >= 0.5) this.circle(lx, lz, 0.33, -0.2, n * mz);
  }

  /** 一垛托盘（layers 层；不到半米高的不挡人） */
  pallets(lx: number, lz: number, ry: number, layers: number): void {
    const it = this.real('pallets', lx, lz, ry, 1.2, 0.15 * layers, 0, { small: true });
    if (layers >= 4) this.solid(it, 0.92);
  }

  dumpster(lx: number, lz: number, ry: number): void {
    this.solid(this.real('dumpster', lx, lz, ry, 1.9, 1.3), 0.9);
  }

  /** 卧式储油罐（长 L 米） */
  tank(lx: number, lz: number, ry: number, L: number): void {
    const it = this.real('fuel_tank', lx, lz, ry, L);
    this.circle(lx, lz, L * 0.45, -0.3, this.size('fuel_tank')[1] * it.sy);
  }

  /** 一排箱子垛（n 垛，沿 X 或沿 Z 排开） */
  /** 一摞两只军用木箱：守城时的军械箱（借枪用，玩法见 game/siege.ts）。不用随机数 */
  armsCrate(lx: number, lz: number, ry: number): void {
    const [w, h] = this.size('wooden_military_crate');
    const k = 1.2 / w;
    this.put('wooden_military_crate', lx, lz, ry, k, { dy: -0.02 });
    this.put('wooden_military_crate', lx, lz, ry + 0.14, k, { dy: -0.02 + h * k });
    this.box(lx, lz, 0.6, 0.27, ry, -0.22, -0.02 + h * k * 2);
  }

  /** 发电机（中心 lx, lz，长边朝 ry）旁边放一摞军械箱：沿着长边的两头挑一头空着的，都不空就不放 */
  armsBeside(lx: number, lz: number, ry: number): void {
    for (const sg of [1, -1]) {
      const cx = lx + Math.cos(ry) * 1.75 * sg;
      const cz = lz - Math.sin(ry) * 1.75 * sg;
      const [x, z] = this.pt(cx, cz);
      if (this.cols.overlaps(x, z, 0.62)) continue;
      this.armsCrate(cx, cz, ry);
      return;
    }
  }

  /**
   * 守城的据点：空地上一台柴油发电机 + 一摞军械箱。cands = 几个候选位置 [lx, lz, ry]，用第一个周围两米多都空着的。
   * 不用随机数——加了它，这个地点别的东西（包括战利品的位置）一样不变
   */
  genset(cands: ReadonlyArray<readonly [number, number, number]>): void {
    for (const [lx, lz, ry] of cands) {
      const [x, z] = this.pt(lx, lz);
      if (this.cols.overlaps(x, z, 2.3)) continue;
      this.solid(this.real('generator_diesel', lx, lz, ry, 1.9, 1.3), 0.9);
      this.armsBeside(lx, lz, ry);
      return;
    }
  }

  crateRow(lx: number, lz: number, n: number, alongX: boolean, mil = false): void {
    for (let k = 0; k < n; k++) this.crates(lx + (alongX ? k * 1.5 : 0), lz + (alongX ? 0 : k * 1.5), (alongX ? 0 : Math.PI / 2) + this.rng.range(-0.05, 0.05), this.rng.int(mil ? 2 : 1, mil ? 4 : 3), mil);
  }

  // ---------------------------------------------------------------- 围栏

  /** 一段围栏 / 院墙（本地坐标，横平竖直）：板子 + 立柱，整段一个碰撞盒 */
  fenceRun(ax: number, az: number, bx: number, bz: number, kind: FenceKind): void {
    const alongX = Math.abs(bx - ax) >= Math.abs(bz - az);
    const L = alongX ? Math.abs(bx - ax) : Math.abs(bz - az);
    if (L < 0.4) return;
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    const posts = (h: number, w: number, skin: Skin, tint: number, every: number): void => {
      const n = Math.max(1, Math.round(L / every));
      for (let k = 0; k <= n; k++) {
        const t = (k / n - 0.5) * L;
        this.wall(mx + (alongX ? t : 0), mz + (alongX ? 0 : t), w, true, -0.3, h + 0.3, skin, tint, w, false);
      }
    };
    let top: number;
    switch (kind) {
      case 'picket':
        // 白漆的矮木栏：三道横板
        for (const y of [0.2, 0.47, 0.74]) this.wall(mx, mz, L, alongX, y, 0.12, 'plaster', 0xe4e0d6, 0.035, false);
        posts(0.95, 0.09, 'plaster', 0xe6e2d8, 1.8);
        top = 0.9;
        break;
      case 'board':
        this.wall(mx, mz, L, alongX, 0.06, 1.7, 'planks', 0xcbbfab, 0.05, false);
        posts(1.84, 0.1, 'planks', 0xa89c88, 2.4);
        top = 1.76;
        break;
      case 'rail':
        for (const y of [0.42, 0.88]) this.wall(mx, mz, L, alongX, y, 0.11, 'planks', 0xc6baa6, 0.045, false);
        posts(1.12, 0.12, 'planks', 0xb0a490, 2.6);
        top = 1.0;
        break;
      case 'brick':
        this.wall(mx, mz, L, alongX, -0.4, 1.9, 'brick', 0xe0d8d0, 0.24, false);
        this.slab(mx, mz, alongX ? L + 0.06 : 0.32, alongX ? 0.32 : L + 0.06, 1.5, 0.07, 'pillar');
        top = 1.57;
        break;
      default:
        this.wall(mx, mz, L, alongX, -0.4, 2.6, 'compound', 0xb9b6ad, 0.22, false);
        top = 2.2;
        break;
    }
    this.box(mx, mz, alongX ? L / 2 : 0.07, alongX ? 0.07 : L / 2, 0, -0.5, top);
  }

  /**
   * 围一圈。四条边：0 后（z0）1 右（x1）2 前（z1）3 左（x0）；gaps = 大门 [哪条边, 中心, 宽]；skip = 哪几条边不围
   */
  fenceRect(x0: number, z0: number, x1: number, z1: number, kind: FenceKind, gaps: ReadonlyArray<readonly [number, number, number]> = [], skip: readonly number[] = []): void {
    for (let s = 0; s < 4; s++) {
      if (skip.includes(s)) continue;
      const alongX = s % 2 === 0;
      const line = s === 0 ? z0 : s === 2 ? z1 : s === 3 ? x0 : x1;
      const a1 = alongX ? x1 : z1;
      const cuts = gaps
        .filter((g) => g[0] === s)
        .map((g) => [g[1] - g[2] / 2, g[1] + g[2] / 2] as const)
        .sort((p, q) => p[0] - q[0]);
      let a = alongX ? x0 : z0;
      const run = (u0: number, u1: number): void => {
        if (alongX) this.fenceRun(u0, line, u1, line, kind);
        else this.fenceRun(line, u0, line, u1, kind);
      };
      for (const [c0, c1] of cuts) {
        if (c0 > a) run(a, Math.min(c0, a1));
        a = Math.max(a, c1);
      }
      if (a1 > a) run(a, a1);
    }
  }

  // ---------------------------------------------------------------- 房子、院子

  /** 在本地 (lx, lz)（左后角）搭一栋房子（平面图见 houses.ts，搭建见 housing.ts）；r 0–3 顺时针转 90°，r = 0 时正面朝路 */
  house(id: HouseId, lx: number, lz: number, r: number, o: HouseOpts = {}): HouseOut {
    this.houseTag = this.interiors.length;
    const out = buildHouse(this, id, lx, lz, r, o);
    this.houseTag = -1;
    return out;
  }

  /**
   * 贴着房子某一面墙放东西的位置：side 0 后 1 右 2 前 3 左，u = 沿墙 0…1，half = 东西沿墙占的半宽，depth = 进深。
   * 门口两边留出来；那一段没有墙（L 形的缺口）、是门廊、或者已经有东西了返回 null。返回 [x, z, 墙是不是沿 X]
   */
  against(o: HouseOut, side: number, u: number, half: number, depth: number): [number, number, boolean] | null {
    const alongX = side % 2 === 0;
    const a0 = (alongX ? o.x0 : o.z0) + half + 0.4;
    const a1 = (alongX ? o.x1 : o.z1) - half - 0.4;
    if (a1 < a0) return null;
    const a = a0 + (a1 - a0) * u;
    const sg = side === 0 || side === 3 ? -1 : 1;
    const face = side === 0 ? o.z0 : side === 2 ? o.z1 : side === 3 ? o.x0 : o.x1;
    for (const d of o.doors) if (d.s === side && Math.abs((alongX ? d.x : d.z) - a) < d.n / 2 + half + 0.9) return null;
    const hit = (along: number, across: number, r: number): boolean => {
      const [x, z] = alongX ? this.pt(along, across) : this.pt(across, along);
      return this.cols.overlaps(x, z, r);
    };
    const c = face + sg * (depth / 2 + 0.08);
    const r = Math.max(0.2, Math.min(half, depth / 2) - 0.03);
    for (const t of [-1, 0, 1]) {
      // 背后得真有墙，自己这块地方得是空的
      if (!hit(a + t * (half - 0.1), face - sg * 0.13, 0.05)) return null;
      if (hit(a + t * (half - r), c, r)) return null;
    }
    return alongX ? [a, c, true] : [c, a, false];
  }

  /** 住宅的院子（房子正面朝路）：前院白漆的矮栅栏，正对房门和车棚留口；后院木板围栏围到 backZ，留一个门；角上一间杂物棚；墙根的垃圾桶、柴堆 */
  homeYard(o: HouseOut, backZ: number, frontZ: number, shed: boolean): void {
    const rng = this.rng;
    if (frontZ - o.z1 > 2.2 && rng.chance(0.75)) {
      const door = o.doors.find((d) => d.s === 2);
      const gaps: Array<[number, number, number]> = [[2, door ? door.x : (o.x0 + o.x1) / 2, 1.9]];
      for (const p of o.ports) gaps.push([2, (p.x0 + p.x1) / 2, p.x1 - p.x0 + 0.5]);
      this.fenceRect(o.gx0 + 0.15, o.z1, o.gx1 - 0.15, frontZ, 'picket', gaps, [0]);
    }
    if (o.z0 - backZ > 3.2) {
      const left = rng.chance(0.5);
      const withShed = shed && o.z0 - backZ > 6.4;
      // 院门开在没有棚子的那一半
      const half = (o.gx1 - o.gx0) / 2;
      const gate = (left ? o.gx0 + half : o.gx0) + 1.3 + rng.next() * Math.max(0.2, half - 2.6);
      this.fenceRect(o.gx0 + 0.15, backZ, o.gx1 - 0.15, o.z0, 'board', [[0, gate, 1.9]], [2]);
      if (withShed) this.house('shed', left ? o.gx0 + 0.7 : o.gx1 - 4.7, backZ + 0.7, 0);
      else if (rng.chance(0.6)) {
        // 没有棚子：角上堆点东西（院门开在另一半）
        const cx = left ? o.gx0 + 1.0 : o.gx1 - 1.0;
        if (rng.chance(0.5)) this.crates(cx, backZ + 0.75, rng.range(-0.1, 0.1), rng.int(1, 2));
        else this.tyres(cx, backZ + 0.7, rng.int(2, 4));
        this.barrel(cx + (left ? 1.0 : -1.0), backZ + 0.6);
      }
    }
    const bn = this.against(o, 0, rng.range(0.15, 0.85), 0.8, 0.6);
    if (bn) this.bins(bn[0], bn[1], true, rng.int(1, 3));
    if (rng.chance(0.5)) {
      const wp = this.against(o, rng.chance(0.5) ? 1 : 3, rng.range(0.3, 0.7), 1.25, 1.0);
      if (wp) this.woodpile(wp[0], wp[1], false);
    }
  }

  /** 铺面的前后：后墙根的垃圾箱、托盘，后院一个车位（有时停着送货的车），门口的长椅和垃圾桶 */
  shopYard(o: HouseOut, backZ: number, tyres: boolean): void {
    const rng = this.rng;
    const d = this.against(o, 0, rng.range(0.6, 0.92), 1.0, 1.5);
    if (d) this.dumpster(d[0], d[1], 0);
    const p = this.against(o, 0, rng.range(0.08, 0.36), 0.65, 0.9);
    if (p) {
      this.pallets(p[0], p[1], 0, rng.int(2, 5));
      this.lootAt(p[0] - 1.0, p[1] + 0.2, 0.02, 'store');
    }
    if (tyres) {
      const t = this.against(o, rng.chance(0.5) ? 1 : 3, rng.range(0.2, 0.8), 0.4, 0.7);
      if (t) this.tyres(t[0], t[1], rng.int(3, 5));
    }
    if (o.z0 - backZ > 7) {
      const cx = (o.x0 + o.x1) / 2;
      if (rng.chance(0.4)) this.car(cx + rng.range(-2, 2), backZ + 2.4, rng.range(-0.08, 0.08), rng.pick([3, 4, 0]));
      else this.park(cx, backZ + 2.4, Math.PI / 2);
    }
    const b = this.against(o, 2, rng.range(0.03, 0.2), 0.9, 0.6);
    if (b) {
      this.put('painted_wooden_bench', b[0] - 0.3, b[1], 0, 1.2, { small: true });
      this.bins(b[0] + 0.75, b[1], true, 1);
    }
  }

  // ---------------------------------------------------------------- 模板

  /**
   * 起点：公路边的一段停车带。出生点背后是一辆撞在隔离墩上的车、一辆抛锚的面包车和散了一地的行李，
   * 旁边是歇脚的长椅和垃圾桶；正前方三十多米是空的（玩家的车停在那儿）。没有武器，没有工事。
   */
  start(l: Lot): { x: number; z: number; yaw: number } {
    const { W, D } = l;
    const rng = this.rng;
    // 停车带的两头：隔离墩
    this.barrierLine(0.6, 1.5, 0.6, D - 4);
    this.barrierLine(W - 0.6, 1.5, W - 0.6, D - 4);
    this.car(3.7, 11.4, 0.4, 2);
    this.car(4.5, 4.6, -0.12, 4);
    for (const [x, z, id, sc] of [
      [7.4, 3.3, 'vintage_suitcase', 0.62],
      [8.1, 5.4, 'vintage_suitcase', 0.55],
      [7.0, 6.3, 'cardboard_box_01', 0.9],
      [9.2, 3.9, 'trashbag', 1],
      [6.5, 2.1, 'cardboard_box_01', 0.6],
    ] as const)
      this.put(id, x, z, rng.range(0, 6.28), sc, { small: true });
    this.tyres(2.2, 7.8, 1);
    // 行李里能翻出点东西
    this.lootAt(9.6, 5.3, 0.02, 'home');
    this.lootAt(8.3, 2.3, 0.02, 'home');
    this.lootAt(10.5, 3.2, 0.02, 'home');
    // 歇脚的地方：长椅、垃圾桶、路灯
    this.put('painted_wooden_bench', 15, 1.5, 0, 1.25, { small: true });
    this.bins(16.6, 1.4, true, 1);
    this.lootAt(13.7, 1.7, 0.02, 'store');
    this.lamp(12, 0.9, 0);
    this.lamp(W - 7, 0.9, 0);
    // 远处一辆被丢下的轿车
    this.car(W - 6.5, 3.4, 0.08, rng.int(0, 1));
    // 给玩家的车留的位置
    this.park(25, 5.4, Math.PI / 2);
    this.park(32, 5.4, Math.PI / 2);
    this.follow = true;
    this.real('road_sign', -2.5, D + 0.8, Math.PI, 1, 0, 0, { sink: 0.1 });
    this.follow = false;
    const [x, z] = this.pt(10.5, 9.2);
    const [fx, fz] = this.pt(30, 9.2);
    return { x, z, yaw: Math.atan2(fx - x, fz - z) };
  }

  /** 加油站：雨棚下两条加油岛、四台加油机；后面一排是便利店和修车间；后角上的储油罐；后面和两侧围着木板墙 */
  gas(l: Lot): void {
    const { W, D } = l;
    const rng = this.rng;
    const cx = W / 2 + 1;
    const cz = D - 10;
    for (const dz of [-3, 3]) {
      // 加油岛：比地面高一拃，人踩得上去，车压得过去
      this.slab(cx, cz + dz, 13.6, 1.3, -0.2, 0.36, 'concrete');
      this.box(cx, cz + dz, 6.8, 0.65, 0, -0.2, 0.16);
      for (const dx of [-6, 6]) {
        this.slab(cx + dx, cz + dz, 0.42, 0.42, 0.16, 4.5, 'pillar');
        this.box(cx + dx, cz + dz, 0.21, 0.21, 0, 0.1, 4.6);
      }
      for (const dx of [-2.6, 2.6]) {
        this.solid(this.real('gas_pump', cx + dx, cz + dz, 0, 1.5, 0, 0, { dy: 0.16 }), 0.9);
        const [px, pz] = this.pt(cx + dx, cz + dz);
        this.pumps.push({ x: px, z: pz });
      }
    }
    // 雨棚：白顶，一圈红边
    this.slab(cx, cz, 17, 10.4, 4.62, 0.55, 'canopy', 0xe4e0d6);
    this.slab(cx, cz, 17.16, 10.56, 4.74, 0.26, 'canopy', 0xb2362c);
    this.cover(cx - 8.5, cz - 5.2, cx + 8.5, cz + 5.2, 4.62);
    this.lampAt(cx - 4, cz);
    this.lampAt(cx + 4, cz);
    const shop = this.house('store', 4, 3.5, 0, look('store', rng));
    const bay = this.house('garage', 26, 4, 0, look('garage', rng));
    // 店门口：一个车位、一辆被丢下的车
    this.park(7.5, shop.z1 + 3.6, Math.PI);
    this.car(17, shop.z1 + 3.5, Math.PI / 2 + 0.06, rng.int(0, 1));
    this.shopYard(shop, 0, false);
    const t = this.against(bay, 3, 0.25, 0.4, 0.7);
    if (t) this.tyres(t[0], t[1], 4);
    const pl = this.against(bay, 0, 0.3, 0.65, 0.9);
    if (pl) this.pallets(pl[0], pl[1], 0, 3);
    // 储油罐、油桶
    this.tank(W - 4.6, 7, Math.PI / 2, 4.4);
    this.fuelPile(W - 4.6, 13, 6);
    this.fenceRect(0.4, 0.6, W - 0.4, D - 14, 'board', [], [2]);
    this.lamp(1.6, D - 1.6, Math.PI / 2);
    this.lamp(W - 1.6, D - 1.6, Math.PI / 2);
    this.follow = true;
    this.real('road_sign', 2, D + l.set - 1.5, Math.PI, 1, 0, 0, { sink: 0.1 });
    this.follow = false;
    // 备用发电机：守城的据点（放在最后、不用随机数，见 genset）
    this.genset([
      [W - 7.5, 21, 0],
      [W - 12, 19.5, 0],
      [10, 21, 0],
    ]);
  }

  /** 农场：农舍、谷仓、杂物棚围着一个土院子，木栏杆围一圈，正面是大门；后面是围起来的田 */
  farm(l: Lot): void {
    const { W, D } = l;
    const rng = this.rng;
    const fz = 25;
    // 农舍在院子西边，门朝东（朝院子）；谷仓在北头，大门朝南；中间一间杂物棚
    const hid = rng.pick(['cottage', 'cottage', 'bungalow', 'ranch'] as const);
    const home = this.house(hid, 4.5, 30, 3, look(hid, rng));
    const barn = this.house('barn', W - 23, fz + 3, 0, look('barn', rng));
    this.house('shed', 26, fz + 3.5, 0);
    this.fenceRect(1, fz + 1, W - 1, D - 0.6, 'rail', [[2, W / 2, 8]], [0]);
    this.fenceRect(1, 1, W - 1, fz + 1, 'rail', [[2, barn.x0 + 6, 5]]);
    // 皮卡停在院子里；大门里留一个车位
    this.car(23, 47, 1.0, 3);
    this.park(W / 2 + 5, D - 7, 0);
    // 储油罐靠着谷仓的西墙，油桶码在旁边
    this.tank(barn.x0 - 1.9, barn.z0 + 3, Math.PI / 2, 3.2);
    this.fuelPile(barn.x0 - 1.7, barn.z0 + 7.4, 4);
    // 谷仓大门两边成垛的托盘，杂物棚边的轮胎，农舍墙根的柴堆和垃圾桶
    for (const u of [0.04, 0.96]) {
      const p = this.against(barn, 2, u, 0.65, 0.9);
      if (p) this.pallets(p[0], p[1], 0, rng.int(3, 6));
    }
    this.lootAt(barn.x0 + 2.4, barn.z1 + 0.6, 0.02, 'store');
    this.tyres(30.6, fz + 5, 3);
    const wp = this.against(home, 0, 0.5, 1.25, 1.0);
    if (wp) this.woodpile(wp[0], wp[1], true);
    const bn = this.against(home, 2, 0.4, 0.8, 0.6);
    if (bn) this.bins(bn[0], bn[1], true, 2);
    this.lamp(W / 2 - 5.5, D - 1.6, Math.PI / 2);
    // 田里几个树桩
    for (let k = 0; k < 5; k++) this.put('tree_stump_01', rng.range(4, W - 4), rng.range(4, fz - 3), rng.range(0, 6.28), rng.range(0.5, 0.8), { sink: 0.1 });
  }

  /** 集装箱货场：围墙、大门、岗亭；集装箱三组，每组背靠背两排，中间是车道；仓库和修车间背靠正面的围墙，门朝着场子 */
  yard(l: Lot): void {
    const { W, D } = l;
    const rng = this.rng;
    this.fenceRect(0.3, 0.3, W - 0.3, D - 0.3, 'concrete', [[2, W / 2, 10]]);
    this.house('guard', W / 2 + 6.5, D - 7, 1);
    for (let g = 0; g < 3; g++) {
      for (let row = 0; row < 2; row++) {
        for (let c = 0; c < 8; c++) {
          if (rng.chance(0.2)) continue;
          // 两个一组头接头，组和组之间留 3 米多的横道
          this.container(7 + c * 6.3 + Math.floor(c / 2) * 3.4, 6 + g * 12 + row * 2.6, 0, rng.chance(0.35) ? 2 : 1);
        }
      }
    }
    const wh = this.house('warehouse', 5, D - 13, 2, look('warehouse', rng));
    const gar = this.house('garage', W - 21, D - 11, 2, look('garage', rng));
    for (const u of [0.05, 0.3]) {
      const p = this.against(wh, 0, u, 0.65, 0.9);
      if (p) this.pallets(p[0], p[1], 0, rng.int(3, 6));
    }
    this.lootAt(wh.x0 + 5.4, wh.z0 - 0.7, 0.02, 'store');
    const t = this.against(gar, 0, 0.9, 0.4, 0.7);
    if (t) this.tyres(t[0], t[1], 4);
    this.crateRow(1.6, 40, 5, false);
    this.lootAt(2.9, 43, 0.02, 'store');
    // 大门里：一辆卡车、一个车位
    this.car(25.5, D - 8.5, Math.PI / 2 + 0.05, 3);
    this.park(28.6, D - 8.5, Math.PI);
    this.park(W - 4, 40.5, Math.PI);
    for (const [x, z] of [
      [1.3, 14],
      [W - 1.3, 14],
      [1.3, 37],
      [W - 1.3, 37],
      [W / 2 - 6.5, D - 1.4],
    ] as const)
      this.lamp(x, z, 0);
    // 备用发电机：守城的据点
    this.genset([
      [W - 10, 38.2, 0],
      [10, 37, 0],
      [W / 2 - 9, 38, 0],
    ]);
  }

  /** 林间木屋：带门廊的木屋、杂物棚、墙根的柴堆和接雨水的桶，土路尽头停着车，三面围着木栏杆 */
  cabin(l: Lot): void {
    const { W, D } = l;
    const rng = this.rng;
    const home = this.house('cabin', 7.5, 4.5, 0, { board: 0.5, mirror: rng.chance(0.5) });
    this.house('shed', 2, 8, 0);
    const wp = this.against(home, 3, 0.5, 1.25, 1.0);
    if (wp) this.woodpile(wp[0], wp[1], false);
    const wp2 = this.against(home, 0, 0.3, 1.25, 1.0);
    if (wp2) this.woodpile(wp2[0], wp2[1], true);
    this.barrel(home.x1 + 0.45, home.z0 + 0.5);
    this.barrel(home.x1 + 0.45, home.z0 + 1.3);
    if (rng.chance(0.55)) this.car(22.5, 15.5, Math.PI / 2 + rng.range(-0.1, 0.1), rng.int(2, 4));
    this.park(22.5, 21.5, 0);
    this.fenceRect(1, 1.5, W - 1, D - 0.8, 'rail', [[2, 22.5, 6]], [0]);
    // 门前的空地：树桩当凳子，中间是火塘
    for (const [x, z, sc] of [
      [6.4, 19.2, 0.8],
      [4.6, 20.6, 0.62],
      [7.4, 21.4, 0.7],
    ] as const)
      this.put('tree_stump_01', x, z, rng.range(0, 6.28), sc, { sink: 0.08 });
    this.lootAt(5.9, 20.4, 0.02, 'store');
    this.tyres(15.6, 21.8, 2);
  }

  /** 公路检查站：岗亭、帐篷、军卡、岗楼排在路边，路上两道错开的隔离墩（车要拐着弯慢慢过，两边各留四米多） */
  post(l: Lot): void {
    const { W, D } = l;
    const rng = this.rng;
    const hut = this.house('guard', W / 2 - 2.5, D - 7.5, 0);
    this.solid(this.real('mil_tent', 7, 6.5, 0, 8.4), 0.8);
    this.solid(this.real('mil_tent', 17.5, 6.5, 0, 8.4), 0.8);
    this.solid(this.real('mil_truck', 28.5, 7, Math.PI / 2 + 0.03, 7.6), 0.85);
    this.solid(this.real('watchtower', W - 3.5, D - 3.5, Math.PI, 3.7), 0.8);
    // 岗亭后墙根的发电机，侧墙边成垛的军用箱，角上的油桶
    const g = this.against(hut, 0, 0.5, 1.0, 1.4);
    if (g) this.solid(this.real('generator_diesel', g[0], g[1], 0, 1.9, 1.3), 0.9);
    this.crateRow(hut.x1 + 0.9, hut.z0 + 0.6, 3, false, true);
    this.lootAt(hut.x1 + 1.9, hut.z0 + 2.1, 0.02, 'mil');
    this.fuelPile(3.4, D - 6, 4);
    // 沙袋：正面两段，中间敞着
    this.sandbagLine(0, D, W / 2 - 9, D, 2);
    this.sandbagLine(W / 2 + 9, D, W, D, 2);
    this.lamp(1.6, D - 1.6, Math.PI / 2);
    this.lamp(W - 8, D - 1.6, Math.PI / 2);
    this.park(W / 2 + 7, D - 4, Math.PI / 2);
    // 发电机旁边的军械箱（守城的据点；放在别的东西都摆好以后）
    if (g) this.armsBeside(g[0], g[1], 0);
    this.follow = true;
    const z0 = D + l.set;
    const keep = 4.2;
    this.barrierLine(8, z0 + 0.4, 8, z0 + Math.max(1.2, l.fw - keep));
    this.barrierLine(W - 8, z0 + Math.min(l.fw - 1.2, keep), W - 8, z0 + l.fw - 0.4);
    // 路对面沟里一辆冲出去的车
    this.car(W / 2, z0 + l.fw + 3.4, 0.25, rng.int(0, 2));
    this.follow = false;
  }

  /** 小镇的一个街区（布局见 planBlock）：铺面带前后场，住宅带前院后院，后巷里的小房子，街边的路灯电线杆 */
  block(l: Lot, plan: BlockPlan): void {
    const { W, D } = l;
    const rng = this.rng;
    const yardZ = plan.a1 + 0.7;
    for (const it of plan.front) {
      const out = this.house(it.id, it.x, it.z, 0, it.o);
      if (it.shop) this.shopYard(out, yardZ, it.id === 'garage');
      else this.homeYard(out, yardZ, D - 0.7, rng.chance(0.5));
    }
    for (const it of plan.back) {
      const out = this.house(it.id, it.x, it.z, 0, it.o);
      if (it.id === 'ruin') continue;
      if (rng.chance(0.6)) {
        const wp = this.against(out, rng.chance(0.5) ? 1 : 3, rng.range(0.3, 0.7), 1.25, 1.0);
        if (wp) this.woodpile(wp[0], wp[1], false);
      }
      const bn = this.against(out, 0, rng.range(0.2, 0.8), 0.8, 0.6);
      if (bn) this.bins(bn[0], bn[1], true, rng.int(1, 2));
    }
    // 通后巷的车道上留一个车位
    const lane = plan.lanes[0];
    if (lane !== undefined) this.park(lane, plan.a1 + 6, 0);
    // 人行道：比路肩高出一拃的水泥板（只是看上去有个路沿，不挡人也不挡车），通后巷的车道口断开；铺面门前一直铺到墙根
    let sx = -0.5;
    const walk = (x0: number, x1: number): void => {
      if (x1 - x0 > 0.6) this.slab((x0 + x1) / 2, D + 0.7, x1 - x0, 2.4, -0.2, 0.27, 'pave');
    };
    for (const c of [...plan.lanes].sort((p, q) => p - q)) {
      walk(sx, c - 2.6);
      sx = c + 2.6;
    }
    walk(sx, W + 0.5);
    for (const it of plan.front) {
      if (!it.shop) continue;
      // 铺面正面外墙的墙面（墙在最后一格的中线上，半厚 0.13）
      const face = it.z + it.d - 0.36;
      this.slab(it.x + it.w / 2, (face + D - 0.5) / 2, it.w + 0.6, D - 0.5 - face, -0.2, 0.268, 'pave');
    }
    // 街边（人行道外侧、路肩上）：路灯、电线杆；一两辆丢在路边的车，一两个空车位。都不压路面，人行道留三米
    this.follow = true;
    const zs = D + l.set;
    this.lamp(4, zs - 0.9, Math.PI / 2);
    this.lamp(W - 4, zs - 0.9, Math.PI / 2);
    const px = W / 2 + 1.5;
    const pole = this.real('power_pole', px, zs - 0.8, 0, 2.7, 0, 0, { sink: 0.2 });
    this.circle(px, zs - 0.8, 0.22, -1, this.size('power_pole')[1] * pole.sy);
    let wrecks = 0;
    let spots = 0;
    for (const t of [0.2, 0.4, 0.62, 0.82]) {
      const x = W * t + rng.range(-1.5, 1.5);
      if (Math.abs(x - px) < 3.6 || plan.lanes.some((c) => Math.abs(c - x) < 5.4)) continue;
      const pick = rng.next();
      if (pick < 0.3 && wrecks < 2) {
        wrecks++;
        const ry = rng.range(-0.05, 0.05) + (rng.chance(0.5) ? Math.PI : 0);
        this.car(x, zs - 1.5, ry, rng.int(0, 2));
        this.lootAt(x + rng.range(-1, 1), zs - 3.0, 0.02, 'car');
      } else if (pick < 0.62 && spots < 2) {
        spots++;
        this.park(x, zs - 1.5, Math.PI / 2);
      }
    }
    this.follow = false;
  }

  /**
   * 军事基地：围墙、大门、岗亭、岗楼。正中一条大道，后面一条横道。
   * 大道西边：四栋营房排成两排，前面是指挥所和车场（军卡、装甲车）；
   * 大道东边：军械库和三间军用仓库排成两排，前面是露天的物资堆场，东墙根一排集装箱；
   * 横道后面：西北角停机坪，中间一排帐篷，东北角油库。
   */
  base(l: Lot): void {
    const { W, D } = l;
    const rng = this.rng;
    const C = 0xb9b6ad;
    const OLIVE = 0xa6aa94;
    const mid = W / 2;
    const g = 6;
    // 围墙：3.2 米高的混凝土墙，正面中间是大门
    for (const [ax, az, bx, bz] of [
      [0, 0, W, 0],
      [0, 0, 0, D],
      [W, 0, W, D],
      [0, D, mid - g, D],
      [mid + g, D, W, D],
    ] as const)
      this.fence(ax, az, bx, bz, 3.2, 'compound', C, 0.5);
    for (const sd of [-1, 1]) {
      this.slab(mid + sd * (g + 0.1), D, 1, 1, -0.3, 4.2, 'pillar');
      this.box(mid + sd * (g + 0.1), D, 0.5, 0.5, 0, -0.3, 3.9);
    }
    this.house('guard', mid + 8, D - 8, 1);
    for (const [x, z, ry] of [
      [4.5, 4.5, 0],
      [W - 4.5, 4.5, 0],
      [4.5, D - 4.5, Math.PI],
      [W - 4.5, D - 4.5, Math.PI],
      [mid - 12, D - 4.5, Math.PI],
    ] as const)
      this.solid(this.real('watchtower', x, z, ry, 3.7), 0.8);
    // 大门里两段沙袋，夹着大道
    this.sandbagLine(mid - 15, D - 10, mid - 8, D - 10, 2);

    // ---- 西边：营房两排四栋
    for (const z of [35, 48]) for (const x of [6, 28]) this.house('barracks', x, z, 0, { tint: OLIVE, board: 0.1, mirror: x > 20 });
    // 指挥所（正面朝大门）、车场
    const cmd = this.house('command', 33, 63, 0, { tint: C, board: 0.3 });
    const g1 = this.against(cmd, 3, 0.5, 1.0, 1.4);
    if (g1) this.solid(this.real('generator_diesel', g1[0], g1[1], Math.PI / 2, 1.9, 1.3), 0.9);
    for (let k = 0; k < 3; k++) this.solid(this.real('mil_truck', 8 + k * 6.6, 68, Math.PI / 2 + rng.range(-0.04, 0.04), 7.6), 0.85);
    for (let k = 0; k < 2; k++) this.solid(this.real('mil_apc', 9.5 + k * 9, 82, Math.PI / 2 + rng.range(-0.05, 0.05), 7.65), 0.85);
    this.fuelPile(28.5, 84, 5);
    this.park(37, 78.5, Math.PI / 2);
    this.park(44, 78.5, Math.PI / 2);

    // ---- 东边：军械库、三间军用仓库（货架上全是弹药箱，地上成垛的军用木箱，桌上墙上是枪）
    const arm = this.house('armoury', mid + 10, 35, 0, { tint: C });
    this.house('warehouse', mid + 28, 35, 0, { skin: 'compound', tint: C, theme: 'mil' });
    this.house('warehouse', mid + 9, 50, 0, { tint: 0xd0d8c0, theme: 'mil' });
    this.house('warehouse', mid + 28, 50, 0, { tint: 0xd8d0bc, theme: 'mil', mirror: true });
    const g2 = this.against(arm, 0, 0.8, 1.0, 1.4);
    if (g2) this.solid(this.real('generator_diesel', g2[0], g2[1], 0, 1.9, 1.3), 0.9);
    // 露天的物资堆场：军用木箱码成四排，排和排之间走得过人，外面一圈沙袋
    for (let r = 0; r < 4; r++) {
      this.crateRow(mid + 12, 65 + r * 3.1, 8, true, true);
      this.lootAt(mid + 13.5 + r * 2.9, 66.5 + r * 3.1, 0.02, 'mil');
    }
    this.sandbagLine(mid + 10.5, 77.4, mid + 24, 77.4);
    for (let k = 0; k < 3; k++) this.pallets(mid + 28 + k * 1.6, 65.5, 0, rng.int(4, 7));
    this.park(W - 22, D - 9, Math.PI / 2);
    // 集装箱：东墙根一排
    for (let k = 0; k < 7; k++) if (!rng.chance(0.15)) this.container(W - 4.2, 37 + k * 6.6, Math.PI / 2, rng.chance(0.45) ? 2 : 1);

    // ---- 横道后面：停机坪（西北角）
    this.slab(18.5, 16, 22, 22, -0.25, 0.29, 'pave');
    this.box(18.5, 16, 11, 11, 0, -0.25, 0.04);
    const heli = this.real('heli_wreck', 18.5, 16, 0.5, 19.2, 0, 0, { dy: 0.04 });
    this.box(18.5, 16, 8.4, 1.5, 0.5, 0, this.size('heli_wreck')[1] * heli.sy * 0.7);
    // 中间一排帐篷，帐篷前面成垛的箱子
    for (let c = 0; c < 4; c++) {
      this.solid(this.real('mil_tent', 36 + c * 11.2, 13, 0, 9.4), 0.8);
      this.crates(32.2 + c * 11.2, 19.4, rng.range(-0.1, 0.1), rng.int(2, 3), true);
    }
    this.lootAt(42, 20.6, 0.02, 'mil');
    this.lootAt(64.5, 20.6, 0.02, 'mil');
    // 油库（东北角）：三个储油罐，沙袋围着，油桶码在前面
    for (let k = 0; k < 3; k++) this.tank(W - 27 + k * 9, 11, k * 1.3, 5);
    this.sandbagLine(W - 33, 19, W - 21, 19, 2);
    this.sandbagLine(W - 16, 19, W - 4, 19, 2);
    this.fuelPile(W - 27, 22.5, 9);
    this.fuelPile(W - 10, 22.5, 9);
    // 路灯：大道两边、横道边上
    for (const z of [40, 58, 76]) {
      this.lamp(mid - 7, z, Math.PI / 2);
      this.lamp(mid + 7, z, -Math.PI / 2);
    }
    this.lamp(24, 33.6, 0);
    this.lamp(W - 24, 33.6, 0);
    // 指挥所那台发电机旁边的军械箱（守城的据点）
    if (g1) this.armsBeside(g1[0], g1[1], Math.PI / 2);
    // 大门外：两道错开的隔离墩，隔开九米
    this.follow = true;
    this.barrierLine(mid - 6, D + 3, mid - 0.8, D + 3);
    this.barrierLine(mid + 0.8, D + 11, mid + 6, D + 11);
    this.follow = false;
  }
}

// ---------------------------------------------------------------- 地点表

const KIND_NAME: Record<SiteKind, (n: string) => string> = {
  camp: () => '路边停车带',
  gas: (n) => `${n}加油站`,
  town: (n) => `${n}镇`,
  farm: (n) => `${n}农场`,
  yard: (n) => `${n}货场`,
  cabin: () => '林间木屋',
  post: () => '公路检查站',
  base: (n) => `${n}军事基地`,
};

/**
 * 每种地点的地块：沿路的宽、进深、最多几块、整块地铺什么、正面离路边多远。
 * 镇子、加油站、检查站贴着路（中间只隔一条人行道 / 路肩），农场、木屋退得远，中间是车道。
 */
const SPEC: Record<SiteKind, [number, number, number, Paint | undefined, number]> = {
  camp: [46, 16, 1, 'gravel', 3],
  gas: [52, 38, 1, 'asphalt', 5],
  town: [54, 42, 4, undefined, 4.5],
  farm: [64, 58, 1, undefined, 12],
  yard: [70, 56, 1, 'asphalt', 8],
  cabin: [28, 26, 1, undefined, 10],
  post: [36, 24, 1, 'gravel', 4],
  base: [116, 92, 1, 'gravel', 12],
};

/** 危险等级 1–5：离出生点越远越高，军事基地、检查站、镇子再加。起点永远是 1 */
export function siteLevel(s: Site): number {
  if (s.kind === 'camp') return 1;
  const bonus = s.kind === 'base' ? 2 : s.kind === 'post' || s.kind === 'town' || s.kind === 'yard' ? 1 : 0;
  return Math.max(1, Math.min(5, 1 + Math.floor(s.danger / 1.1) + bonus));
}

export class Sites {
  private readonly cache = new Map<number, Site | null>();
  private readonly contents = new Map<number, SiteContent>();
  private readonly hit: Site[] = [];
  private readonly colsOut: Colliders[] = [];

  constructor(
    private readonly seed: number,
    private readonly roads: Roads,
    private readonly terrain: Terrain,
  ) {}

  /** 这个路口是哪种地点（null = 没有） */
  private kindAt(n: RoadNode): SiteKind | null {
    const { i, j } = n;
    if (i === 0) {
      if (j === 0) return 'camp';
      if (j === -1) return 'gas';
      if (j === -2) return 'town';
      if (j === -3) return 'base';
      if (j === 1) return 'farm';
    }
    if (!n.n && !n.s && !n.e && !n.w) return null;
    const d = Math.hypot(n.x, n.z) / 1000;
    const paved = [n.n, n.s, n.e, n.w].some((k) => k && k !== 'dirt');
    const table: Array<[SiteKind, number]> =
      i === 0
        ? [
            ['gas', 0.16],
            ['town', 0.2],
            ['post', 0.12],
            ['yard', 0.1],
            ['base', d > 2.4 ? 0.12 : 0],
            ['farm', 0.08],
          ]
        : paved
          ? [
              ['town', 0.16],
              ['farm', 0.16],
              ['gas', 0.08],
              ['yard', 0.08],
              ['cabin', 0.1],
              ['base', d > 3 ? 0.07 : 0],
            ]
          : [
              ['cabin', 0.26],
              ['farm', 0.2],
              ['town', 0.06],
            ];
    const r = hash2(i, j, this.seed + 71);
    let acc = 0;
    for (const [k, p] of table) {
      acc += p;
      if (r < acc) return k;
    }
    return null;
  }

  /** 矩形离所有的路都够远吗 */
  private clear(x0: number, z0: number, x1: number, z1: number, margin: number): boolean {
    for (const s of this.roads.segsIn(x0, z0, x1, z1, 30)) {
      for (let k = 0; k <= 4; k++) {
        const t = k / 4;
        if (rectDist(s.ax + (s.bx - s.ax) * t, s.az + (s.bz - s.az) * t, x0, z0, x1, z1) < s.w / 2 + margin) return false;
      }
    }
    return true;
  }

  /** 在路口四个象限里找地：W 沿路、D 进深，最多 max 块，离路边 set 米；优先朝着宽的路 */
  private lots(n: RoadNode, W: number, D: number, max: number, extra: number, paint: Paint | undefined, set: number): Lot[] {
    const wv = Math.max(n.n ? ROAD_W[n.n] : 0, n.s ? ROAD_W[n.s] : 0);
    const wh = Math.max(n.e ? ROAD_W[n.e] : 0, n.w ? ROAD_W[n.w] : 0);
    const gv = (wv ? wv / 2 + set : 8) + extra;
    const gh = (wh ? wh / 2 + set : 8) + extra;
    const cands: Array<{ sx: number; sz: number; front: 'v' | 'h'; w: number; o: number }> = [];
    for (const sx of [1, -1]) {
      for (const sz of [1, -1]) {
        const va = sz < 0 ? n.n : n.s;
        const ha = sx > 0 ? n.e : n.w;
        const o = hash2(n.i * 4 + (sx > 0 ? 1 : 0), n.j * 4 + (sz > 0 ? 1 : 0), this.seed + 72);
        if (va) cands.push({ sx, sz, front: 'v', w: ROAD_W[va], o });
        if (ha) cands.push({ sx, sz, front: 'h', w: ROAD_W[ha], o: o + 0.0001 });
      }
    }
    cands.sort((a, b) => b.w - a.w || a.o - b.o);
    const out: Lot[] = [];
    const used = new Set<number>();
    for (const c of cands) {
      if (out.length >= max) break;
      const q = (c.sx > 0 ? 2 : 0) + (c.sz > 0 ? 1 : 0);
      if (used.has(q)) continue;
      const dx = c.front === 'v' ? D : W;
      const dz = c.front === 'v' ? W : D;
      const xa = n.x + c.sx * gv;
      const za = n.z + c.sz * gh;
      const x0 = Math.min(xa, xa + c.sx * dx);
      const x1 = Math.max(xa, xa + c.sx * dx);
      const z0 = Math.min(za, za + c.sz * dz);
      const z1 = Math.max(za, za + c.sz * dz);
      if (!this.clear(x0, z0, x1, z1, Math.min(CLEAR, set - 1.5))) continue;
      used.add(q);
      const lot: Lot = { x0, z0, x1, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, rot: c.front === 'v' ? (c.sx > 0 ? 1 : 3) : c.sz < 0 ? 0 : 2, W, D, fw: c.w, set: set + extra };
      if (paint) lot.paint = paint;
      const [ax, az] = lotPt(lot, 0, D / 2);
      const [bx, bz] = lotPt(lot, W, D / 2);
      if (Math.hypot(bx - n.x, bz - n.z) < Math.hypot(ax - n.x, az - n.z)) lot.flip = true;
      out.push(lot);
    }
    return out;
  }

  at(i: number, j: number): Site | null {
    const key = (i + 4096) * 8192 + (j + 4096);
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    if (this.cache.size > 900) this.cache.clear();
    const n = this.roads.node(i, j);
    const kind = this.kindAt(n);
    const site = kind ? this.build(n, kind, key) : null;
    this.cache.set(key, site);
    return site;
  }

  private build(n: RoadNode, kind: SiteKind, key: number): Site | null {
    const fixed = n.i === 0 && Math.abs(n.j) <= 3;
    const [W, D, max, paint, set] = SPEC[kind];
    let lots: Lot[] = [];
    // 固定的地点一定要放得下：放不下就离路远一点再试
    for (const extra of fixed ? [0, 12, 26, 44, 70] : [0]) {
      lots = this.lots(n, W, D, max, extra, paint, set);
      if (lots.length) break;
    }
    if (!lots.length) return null;
    // 地点的地面至少比水面高 2.6 米（洼地里的地点是一块垫高的台地）
    const h = Math.max(this.terrain.smooth(n.x, n.z), WATER + 2.6);
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (const l of lots) {
      x0 = Math.min(x0, l.x0);
      z0 = Math.min(z0, l.z0);
      x1 = Math.max(x1, l.x1);
      z1 = Math.max(z1, l.z1);
    }
    const x = (x0 + x1) / 2;
    const z = (z0 + z1) / 2;
    const flats: Flat[] = [];
    const blocks: BlockPlan[] = [];
    // 先放小块的铺装（车道、人行道、院子）：同一个点上先放的说了算，整块地的压平区放在最后
    lots.forEach((l, li) => {
      const plan = kind === 'town' ? planBlock(l, new Rng((this.seed ^ Math.imul(n.i, 73856093) ^ Math.imul(n.j, 19349663) ^ Math.imul(li + 1, 83492791)) >>> 0), li) : null;
      if (plan) blocks.push(plan);
      for (const [ax, az, bx, bz, p] of paints(kind, l, plan)) {
        const [px0, pz0] = lotPt(l, ax, az);
        const [px1, pz1] = lotPt(l, bx, bz);
        flats.push({ x0: Math.min(px0, px1), z0: Math.min(pz0, pz1), x1: Math.max(px0, px1), z1: Math.max(pz0, pz1), h, blend: 2, paint: p });
      }
    });
    for (const l of lots) {
      const f: Flat = { x0: l.x0 - 1, z0: l.z0 - 1, x1: l.x1 + 1, z1: l.z1 + 1, h, blend: kind === 'base' ? 26 : 18 };
      if (l.paint) f.paint = l.paint;
      flats.push(f);
    }
    const name = KIND_NAME[kind](`${NAME_A[Math.floor(hash2(n.i * 7 + 3, n.j * 13 + 5, this.seed + 73) * NAME_A.length)]}${NAME_B[Math.floor(hash2(n.j * 11 + 1, n.i * 17 + 9, this.seed + 74) * NAME_B.length)]}`);
    const far = Math.max(...lots.map((l) => Math.max(Math.abs(l.x0 - n.x), Math.abs(l.x1 - n.x), Math.abs(l.z0 - n.z), Math.abs(l.z1 - n.z))));
    const site: Site = {
      key,
      i: n.i,
      j: n.j,
      kind,
      name,
      nx: n.x,
      nz: n.z,
      x,
      z,
      r: Math.hypot(x1 - x0, z1 - z0) / 2 + 24,
      h,
      danger: Math.hypot(n.x, n.z) / 1000,
      plateau: Math.min(150, Math.max(60, far - 10)),
      lots,
      flats,
    };
    if (blocks.length) site.blocks = blocks;
    return site;
  }

  /** 已经算好的内容（没算过返回 null，不会触发生成：地图用） */
  peek(s: Site): SiteContent | null {
    return this.contents.get(s.key) ?? null;
  }

  /** 地点里的全部东西：第一次要的时候才生成（最大的地点约 20 毫秒），最近用过的 40 个留在缓存里 */
  content(s: Site): SiteContent {
    const hit = this.contents.get(s.key);
    if (hit) {
      // 最近用过的挪到队尾
      this.contents.delete(s.key);
      this.contents.set(s.key, hit);
      return hit;
    }
    const b = new Builder(new Rng((this.seed ^ Math.imul(s.i, 73856093) ^ Math.imul(s.j, 19349663)) >>> 0), s.h, s.x, s.z);
    let spawn: SiteContent['spawn'];
    for (let li = 0; li < s.lots.length; li++) {
      const l = s.lots[li] as Lot;
      b.lot = l;
      switch (s.kind) {
        case 'camp':
          spawn = b.start(l);
          break;
        case 'gas':
          b.gas(l);
          break;
        case 'town':
          b.block(l, s.blocks?.[li] ?? planBlock(l, new Rng(li + 1), li));
          break;
        case 'farm':
          b.farm(l);
          break;
        case 'yard':
          b.yard(l);
          break;
        case 'cabin':
          b.cabin(l);
          break;
        case 'post':
          b.post(l);
          break;
        default:
          b.base(l);
          break;
      }
    }
    const c: SiteContent = { inst: b.inst, walls: b.walls, slabs: b.slabs, roofs: b.roofs, panes: b.panes, lamps: b.lamps, cols: b.cols, houses: b.houses, interiors: b.interiors, parking: b.parking, pumps: b.pumps, loot: b.loot, covers: b.covers };
    if (spawn) c.spawn = spawn;
    if (this.contents.size >= 40) {
      const oldest = this.contents.keys().next().value;
      if (oldest !== undefined) this.contents.delete(oldest);
    }
    this.contents.set(s.key, c);
    return c;
  }

  /** 圆 (x, z, r) 碰到的地点 */
  near(x: number, z: number, r: number, out: Site[] = []): Site[] {
    const R = r + 420;
    const i0 = Math.round((x - R) / GRID);
    const i1 = Math.round((x + R) / GRID);
    const j0 = Math.round((z - R) / GRID);
    const j1 = Math.round((z + R) / GRID);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const s = this.at(i, j);
        if (s && Math.hypot(s.x - x, s.z - z) < r + s.r) out.push(s);
      }
    }
    return out;
  }

  /** 会影响这片区域地形的地点：圆离得近（压平区、石山避让），或者路口的平台够得着 */
  sitesIn(x0: number, z0: number, x1: number, z1: number, out: SiteRef[]): void {
    const i0 = Math.round((x0 - 400) / GRID);
    const i1 = Math.round((x1 + 400) / GRID);
    const j0 = Math.round((z0 - 400) / GRID);
    const j1 = Math.round((z1 + 400) / GRID);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const s = this.at(i, j);
        if (!s) continue;
        const p = s.plateau + 125;
        if (rectDist(s.x, s.z, x0, z0, x1, z1) < s.r + 170 || (s.nx > x0 - p && s.nx < x1 + p && s.nz > z0 - p && s.nz < z1 + p)) out.push(s);
      }
    }
  }

  /** 玩家所在的地点的碰撞体（返回的数组是复用的，下次调用会被覆盖） */
  collidersNear(x: number, z: number, r: number): Colliders[] {
    this.hit.length = 0;
    this.near(x, z, r, this.hit);
    this.colsOut.length = 0;
    for (const s of this.hit) this.colsOut.push(this.content(s).cols);
    return this.colsOut;
  }

  /** 附近的屋顶、雨棚（雨雪落不到下面） */
  coversNear(x: number, z: number, r: number, out: Cover[] = []): Cover[] {
    for (const s of this.near(x, z, r)) {
      const c = this.peek(s);
      if (c) for (const q of c.covers) out.push(q);
    }
    return out;
  }

  /** 房子的外轮廓（不长草的范围） */
  housesNear(x: number, z: number, r: number): Rect[] {
    const out: Rect[] = [];
    for (const s of this.near(x, z, r)) for (const h of this.content(s).houses) out.push(h);
    return out;
  }

  /** 出生点（重生也是这里）：路边停车带上，面朝停车带的另一头，正前方三十米是空的 */
  spawn(): { x: number; z: number; yaw: number } {
    const s = this.at(0, 0);
    return (s && this.content(s).spawn) ?? { x: 7, z: 10, yaw: Math.PI };
  }
}
