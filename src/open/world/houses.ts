import type { RoofTex, Skin, SlabTex } from './sites';

/**
 * 开放世界的房子（数据）：平面图 + 家具表 + 摆设表。搭建的代码在 housing.ts。
 *
 * 思路是大逃杀 / 搜打撤类游戏里房子的通行做法（只取做法，不照搬任何一张现成的地图）：
 *   - 每种房子的轮廓一眼认得出：带门廊的平房、L 形的农舍、带车棚和披屋的长屋、平顶带雨棚的铺面、山墙朝街的修车铺、谷仓……
 *   - 至少两个出入口，房间连成环，进门到出门有一条不拐弯抹角的通道；
 *   - 每个房间有明确的用途（卧室、厨房、客厅、储物间、营业厅、办公室），家具靠墙摆，中间留出走道。
 * 平面图里只画「大件」，其余的（墙边少量杂物、桌上的小东西、挂件、地毯、吊灯、门扇、战利品的位置）由 housing.ts 自动添置。
 *
 * 平面图一个字符 = 1 米见方的一格，第一行是屋后，最后一行是正面（朝路）。墙占一格，但搭出来是格子中线上的薄墙：
 *   # 外墙   | 隔墙   W 窗   G 落地大窗（铺面）   H 高窗（仓库）   R 关着的卷帘门
 *   D 外门（连着三格以上 = 卷帘门 / 谷仓的推拉门）   d 内门
 *   . 地板   , 废墟里露天的地面   p 门廊   y 车棚   空格 = 房子外面
 * 规矩（.logs/open/housetest.ts 会检查）：门里外那一格留空；高家具（w f h m）得有一面靠着实墙；每个空格都走得到；
 * 除了棚屋、岗亭、废墟，每栋房子至少两扇外门，玩家能从任何一扇门跑到另一扇。
 */

export type Theme = 'home' | 'shop' | 'store' | 'office' | 'mil';
/** 房间的用途：决定摆什么杂物 */
export type RoomKind = 'bed' | 'living' | 'storage' | 'shop' | 'office' | 'mil';

/** 屋顶的一块（也是房子的一个体块：这一块的墙可以比主屋矮）。方向：0 屋后 1 右 2 正面 3 左 */
export interface RoofPart {
  /** 盖住哪些格子（含墙）：[x0, z0, x1, z1] */
  r: readonly [number, number, number, number];
  kind: 'gable' | 'flat' | 'shed' | 'none';
  /** 这一块的墙高（不写 = 房子的墙高） */
  h?: number;
  /** 双坡：屋脊沿平面图的 x 还是 z（不写 = 沿长边） */
  ridge?: 'x' | 'z';
  rise?: number;
  /** 双坡：哪一头伸进主屋的屋顶里（L 形、丁字形的房子） */
  join?: number;
  /** 单坡：哪一边高 */
  hi?: number;
  /** 单坡：高的一边靠在更高的墙上（披屋） */
  attach?: boolean;
  /** 有没有吊顶（不写：住宅的双坡顶有，别的没有） */
  ceil?: boolean;
  /** 这一块的地面（不写 = 和主屋一样） */
  floor?: SlabTex;
}

/** 外墙的料子朝屋里的那一面用哪一种：同一张贴图，提亮（屋里晒不到太阳，只有环境光） */
export const SKIN_IN: Partial<Record<Skin, Skin>> = { compound: 'compound_in', brick: 'brick_in', plaster: 'plaster_in', metal: 'metal_in', planks: 'planks_in' };

export interface HousePlan {
  name: string;
  rows: string[];
  wall: Skin;
  /** 内墙面（null = 和外墙一样，仓库、车库） */
  inner: Skin | null;
  /** 墙高（米） */
  h: number;
  floor: Extract<SlabTex, 'floor' | 'floor_tile' | 'concrete' | 'deck'> | null;
  roof: 'gable' | 'flat' | 'metal' | 'none';
  theme: Theme;
  /** 屋里放几处战利品（最少、最多） */
  loot: readonly [number, number];
  /** 屋顶分块（不写 = 整栋一块） */
  parts?: readonly RoofPart[];
  roofTex?: RoofTex;
  /** 墙根的混凝土勒脚（不写 = 有） */
  plinth?: boolean;
  /** 正面的雨棚和招牌墙 */
  awning?: boolean;
  /** 烟囱在哪一格：墙上的格子 = 贴着外墙的烟囱垛，屋里的格子 = 从屋面伸出来 */
  chimney?: readonly [number, number];
  /** 宽门的样子：slide = 谷仓的推拉木门（不写 = 卷帘门） */
  gate?: 'slide';
  /** 宽门的门洞多高 */
  doorH?: number;
  /** 平面图里画的车有多大概率真的停着 */
  carP?: number;
}

export const HOUSES = {
  /** 棚屋：一个开间的木板房，铁皮单坡顶 */
  shack: {
    name: '棚屋',
    wall: 'planks',
    inner: null,
    h: 2.3,
    floor: 'deck',
    roof: 'metal',
    roofTex: 'rust',
    theme: 'home',
    loot: [2, 3],
    plinth: false,
    parts: [{ r: [0, 0, 5, 4], kind: 'shed', hi: 2, rise: 0.6 }],
    rows: ['######', '#b..h#', '#b...W', '#x..O#', '##D#W#'],
  },

  /** 杂物棚：后院里放工具的小棚子 */
  shed: {
    name: '杂物棚',
    wall: 'planks',
    inner: null,
    h: 2.1,
    floor: 'deck',
    roof: 'metal',
    roofTex: 'rust',
    theme: 'store',
    loot: [1, 2],
    plinth: false,
    parts: [{ r: [0, 0, 3, 3], kind: 'shed', hi: 2, rise: 0.45 }],
    rows: ['####', '#rx#', '#..#', '#D##'],
  },

  /** 林间木屋：一间卧室 + 起居室，正面一条通长的门廊，屋后有后门 */
  cabin: {
    name: '木屋',
    wall: 'planks',
    inner: null,
    h: 2.6,
    floor: 'floor',
    roof: 'gable',
    roofTex: 'shingle',
    theme: 'home',
    loot: [4, 6],
    chimney: [5, 1],
    rows: ['##W###D##', '#bn.|O..#', 'Wb..d...W', '#...|.tt#', '#w.x|.cc#', '##W##D#W#', 'ppppppppp', 'ppppppppp'],
  },

  /** 平房：厨房餐厅 + 客厅是一个大开间，右边一间卧室、一间储物间；正面门廊，后门、侧门 */
  bungalow: {
    name: '平房',
    wall: 'brick',
    inner: 'wallpaper',
    h: 2.8,
    floor: 'floor',
    roof: 'gable',
    theme: 'home',
    loot: [5, 8],
    chimney: [3, 1],
    rows: [
      '##WW#D##W###',
      '#kko...|.bb#',
      'W......d..n#',
      '#f.tt..|w..W',
      '#..cc..||||#',
      'W.ss...|x.r#',
      'W.ll...d...D',
      '#.vv..a|h.x#',
      '#W###D####W#',
      'pppppppp    ',
      'pppppppp    ',
    ],
  },

  /** 农舍：L 形。主屋是厨房餐厅和一间卧室，前面伸出去的一翼是主卧，拐角里是门廊；山墙上一根烟囱 */
  cottage: {
    name: '农舍',
    wall: 'plaster',
    inner: 'wallpaper',
    h: 2.8,
    floor: 'floor',
    roof: 'gable',
    theme: 'home',
    loot: [5, 8],
    chimney: [0, 3],
    parts: [
      { r: [0, 0, 12, 6], kind: 'gable', ridge: 'x' },
      { r: [8, 6, 12, 10], kind: 'gable', ridge: 'z', join: 0 },
    ],
    rows: [
      '##WW##D##WW##',
      '#kkof..|bb.w#',
      'W......|n...W',
      '#.tt...d....#',
      'W.cc...|q...#',
      '#...ssa||d||#',
      '##D#WW###.bb#',
      'pppppppp#..nW',
      'pppppppp#w..#',
      '        D...#',
      '        #WW##',
    ],
  },

  /** 长屋：厨房 + 两间卧室在后，通长的客厅在前；屋后一间披屋（杂物间、后门），侧面是车棚 */
  ranch: {
    name: '长屋',
    wall: 'plaster',
    inner: 'wallpaper',
    h: 2.8,
    floor: 'floor',
    roof: 'gable',
    roofTex: 'shingle',
    theme: 'home',
    loot: [6, 8],
    parts: [
      { r: [0, 2, 13, 10], kind: 'gable', ridge: 'x' },
      { r: [0, 0, 5, 2], kind: 'shed', hi: 2, attach: true, h: 2.1, rise: 0.4, floor: 'concrete' },
    ],
    rows: [
      '######            ',
      '#r...D            ',
      '##d####WW###W#yyyy',
      '#f.kko|bb.|nb#yyyy',
      'W.....|n..|.b#yyyy',
      '#.tt..|..w|..Dyyyy',
      '#.cc..|d|||d|#yyyy',
      'W..ss.......h#yyyy',
      '#a.ll.......eW    ',
      '#..vv.....q.c#    ',
      '#WW###D#WW####    ',
    ],
  },

  /** 便利店：前面是一排排货架和收银台（落地窗、双开门、雨棚），后面是库房和后门 */
  store: {
    name: '便利店',
    wall: 'plaster',
    inner: 'plaster',
    h: 3.2,
    floor: 'floor_tile',
    roof: 'flat',
    theme: 'shop',
    loot: [10, 14],
    awning: true,
    rows: [
      '####D###########',
      '#xx...Prr..xxB.#',
      '#..............#',
      '#|||d|||||||d||#',
      '#..............#',
      '#.r..r....r..c.#',
      '#.r..r....r.ii.#',
      '#.r..r....r....#',
      '#GGG#GDDG#GGG###',
    ],
  },

  /** 修车铺：山墙朝街的铁皮车间（一开一关两道卷帘门），旁边一间矮的办公室 */
  garage: {
    name: '修车铺',
    wall: 'metal',
    inner: null,
    h: 3.6,
    floor: 'concrete',
    roof: 'metal',
    theme: 'store',
    loot: [8, 12],
    doorH: 2.8,
    carP: 0.7,
    parts: [
      { r: [0, 0, 11, 7], kind: 'gable', ridge: 'z' },
      { r: [11, 0, 14, 7], kind: 'shed', hi: 3, attach: true, h: 2.5, rise: 0.45 },
    ],
    rows: ['######D########', '#uuTCC...rr#e.#', '#...CC.....#c.W', 'W...CC.....d..#', '#g..CC.....#h.#', '#B..CC.....#..D', '#B.......P.#q.#', '###DDD#RRR###W#'],
  },

  /** 诊所：前面是候诊大厅，后面是诊室和药房，中间一条走廊通后门 */
  clinic: {
    name: '诊所',
    wall: 'plaster',
    inner: 'plaster',
    h: 3.0,
    floor: 'floor_tile',
    roof: 'flat',
    theme: 'office',
    loot: [8, 10],
    awning: true,
    rows: [
      '##WW##D###WW##',
      '#ee..|..|h.rr#',
      'Wc...d..d....W',
      '#q.bb|..|x..q#',
      '#|d|||..|||d|#',
      '#q.......c..h#',
      'W.......ee...W',
      '#ss.l.......a#',
      '##GG##DD##GG##',
    ],
  },

  /** 仓库：正面一道卷帘门，侧门，高窗；货架、成垛的箱子和托盘靠边，中间一条通道 */
  warehouse: {
    name: '仓库',
    wall: 'metal',
    inner: null,
    h: 4.4,
    floor: 'concrete',
    roof: 'metal',
    theme: 'store',
    loot: [8, 12],
    doorH: 3.2,
    rows: [
      '###HH###RRR##HH#',
      '#rr.rr.....xx.P#',
      '#.............P#',
      '#rr.rr....xx...#',
      'D.........xx...H',
      '#rr.rr.........H',
      '#.........PP..T#',
      '#xx.......PP...#',
      '#xx.B........uu#',
      '###HH#DDD###W###',
    ],
  },

  /** 谷仓：前后两道推拉的大木门，高高的双坡顶，侧面一间披屋（工具间） */
  barn: {
    name: '谷仓',
    wall: 'planks',
    inner: null,
    h: 4.0,
    floor: 'deck',
    roof: 'metal',
    roofTex: 'rust',
    theme: 'store',
    loot: [8, 11],
    gate: 'slide',
    doorH: 3.0,
    parts: [
      { r: [0, 0, 11, 9], kind: 'gable', ridge: 'z', rise: 3.0 },
      { r: [11, 1, 15, 8], kind: 'shed', hi: 3, attach: true, h: 2.4, rise: 0.8, floor: 'concrete' },
    ],
    rows: [
      '####DDDD####    ',
      '#xx.....PP.#####',
      '#x......PP.#T.r#',
      'H..........d..r#',
      '#PP........#u..H',
      '#PP......B.#u..#',
      'H........B.#...D',
      '#x.........#B.x#',
      '#xx.....xx.#####',
      '####DDDD####    ',
    ],
  },

  /** 营房：两排铺位夹着中间的过道，两头和正面都有门 */
  barracks: {
    name: '营房',
    wall: 'compound',
    inner: 'plaster',
    h: 3.0,
    floor: 'concrete',
    roof: 'metal',
    theme: 'mil',
    loot: [8, 12],
    rows: [
      '####W###W###W###W###',
      '#bmb.bmb.bmb.bmb.ee#',
      '#b.b.b.b.b.b.b.b.c.#',
      'D..................D',
      '#..................#',
      '#b.b.b.b.b.b.xx....#',
      '#bmb.bmb.bmb.xx.q.h#',
      '####W###W######D####',
    ],
  },

  /** 军械库：前面是发枪的大厅（摆着枪的长桌、铁皮柜），后面是弹药库（货架、成垛的军用木箱）；卷帘门、侧门、后门 */
  armoury: {
    name: '军械库',
    wall: 'compound',
    inner: null,
    h: 3.4,
    floor: 'concrete',
    roof: 'flat',
    theme: 'mil',
    loot: [16, 24],
    doorH: 2.8,
    rows: [
      '######D#######',
      '#rr.rr...rr.x#',
      '#...........x#',
      '#rr.rr...xx..#',
      '#........xx..D',
      '#|||d||||||d|#',
      '#m..........m#',
      '#m..tt..tt..m#',
      '#x..........x#',
      '####DDD###H###',
    ],
  },

  /** 指挥所：前面是作战室（中间一张大地图桌），后面是通讯室和储藏间，中间的过道通后门 */
  command: {
    name: '指挥所',
    wall: 'compound',
    inner: 'plaster',
    h: 3.0,
    floor: 'concrete',
    roof: 'flat',
    theme: 'mil',
    loot: [10, 14],
    rows: [
      '##W###D###W###',
      '#ee.|..|x.xm.#',
      '#c..d..d.....#',
      '#h..|..|mx...#',
      '#||||..|||d||#',
      '#q......tt.m.#',
      'Wc.....ctt...W',
      '#e.......c.ss#',
      '###W##DD#W####',
    ],
  },

  /** 岗亭：大门口、检查站的小屋 */
  guard: {
    name: '岗亭',
    wall: 'compound',
    inner: null,
    h: 2.7,
    floor: 'concrete',
    roof: 'flat',
    theme: 'mil',
    loot: [2, 3],
    rows: ['#####', '#m.e#', 'W..cW', '#...#', '#WDW#'],
  },

  /** 废墟：塌了半边的砖房，没有屋顶 */
  ruin: {
    name: '废墟',
    wall: 'brick',
    inner: null,
    h: 2.6,
    floor: null,
    roof: 'none',
    theme: 'store',
    loot: [1, 3],
    plinth: false,
    rows: ['##W##,,###', '#...|,,.x#', '#.x.|,,..W', ',,..d....#', '#...|..B.,', '#j..|....,', '##W###D,,,'],
  },
} satisfies Record<string, HousePlan>;

export type HouseId = keyof typeof HOUSES;

// ---------------------------------------------------------------- 家具

/**
 * 一件家具。尺寸直接写模型的缩放（模型的真实尺寸见 model-sizes.json，长的水平边沿 X）。
 * 模型的正面默认是 +Z；front: 'x' = 正面是 +X（椅子、灶台这几个模型是侧着的）。
 */
export interface Piece {
  id: string;
  s: number | [number, number, number];
  front?: 'x';
  /** 给几格长的位置用（默认 1） */
  n?: number;
  /** 2 × 2 的位置：进深放大 */
  grow?: boolean;
  /** 能放东西的面：[高度（模型单位）, 类别]，从低到高。类别 'cap' = 封顶的板，不放东西，只用来算下面一层的净高 */
  tops?: ReadonlyArray<readonly [number, string]>;
  /** 能放东西的范围：进深方向（占进深的比例，-0.5 = 最里面）、宽度方向（占宽度的比例） */
  td?: readonly [number, number];
  tx?: number;
  /** 碰撞高度（米；不写 = 模型的高度） */
  solid?: number;
  /** 模型整体上下挪多少（模型单位） */
  lift?: number;
  /** 只在住宅 / 诊所里用（布沙发、铺桌布的餐桌不进仓库和军营） */
  home?: boolean;
  /** 不挡人（床头柜、小圆桌这些小件：跑过去不会被绊住） */
  soft?: boolean;
}

const HUTCH: Piece = {
  id: 'painted_wooden_cabinet_02',
  s: [0.96, 0.82, 0.85],
  tops: [
    [1.169, 'shelf'],
    [1.58, 'shelf'],
    [1.894, 'shelf'],
    [2.19, 'cap'],
  ],
  td: [-0.42, -0.1],
};
/** 这个模型看得见的部分比包围盒的底高 0.22（包围盒里算进了没人引用的顶点），往下挪回去 */
const DRAWERS: Piece = { id: 'drawer_cabinet', s: 0.85, lift: -0.221 };
const WHITE_SHELF: Piece = {
  id: 'Shelf_01',
  s: [0.9, 0.92, 1.25],
  tops: [
    [0.14, 'shelf'],
    [0.38, 'shelf'],
    [0.66, 'shelf'],
    [0.94, 'shelf'],
    [1.22, 'shelf'],
    [1.5, 'shelf'],
    [1.789, 'cap'],
  ],
  td: [-0.3, 0.34],
};
const CUBE_SHELF: Piece = {
  id: 'wooden_display_shelves_01',
  s: [0.88, 1.15, 1.1],
  tops: [
    [0.052, 'shelf'],
    [0.412, 'shelf'],
    [0.788, 'shelf'],
    [1.164, 'shelf'],
    [1.54, 'shelf'],
  ],
};
const SIDEBOARD: Piece = { id: 'painted_wooden_cabinet', s: 0.8, tops: [[1.18, 'night']] };
const NIGHTSTAND: Piece = { id: 'painted_wooden_nightstand', s: 1, soft: true, tops: [[0.616, 'night']] };
const SIDE_TABLE: Piece = {
  id: 'side_table_01',
  s: 1,
  soft: true,
  tops: [
    [0.052, 'shelf'],
    [0.352, 'shelf'],
    [0.552, 'night'],
  ],
};
const ROUND_TABLE: Piece = { id: 'WoodenTable_02', s: 1.5, soft: true, tops: [[0.416, 'night']] };
const CHAIR_A: Piece = { id: 'painted_wooden_chair_01', s: 1, front: 'x', solid: 0.5 };
const CHAIR_B: Piece = { id: 'painted_wooden_chair_02', s: 0.75, front: 'x', solid: 0.5 };
const CHAIR_C: Piece = { id: 'plastic_monobloc_chair_01', s: 0.85, solid: 0.5 };
const ARMCHAIR: Piece = { id: 'ArmChair_01', s: 1, solid: 0.6, home: true };
const LOUNGE: Piece = { id: 'modern_arm_chair_01', s: 0.9, front: 'x', solid: 0.6 };

export const BED_FRAME: Piece = { id: 'old_bed_frame', s: [0.98, 0.83, 1.02], solid: 0.6 };
export const DAY_BED: Piece = { id: 'vintage_day_bed', s: [0.99, 0.85, 1.06], solid: 0.6 };
export const CHAIRS: readonly Piece[] = [CHAIR_A, CHAIR_A, CHAIR_B, CHAIR_C];
/** 墙边自动添置的小柜子、小架子 */
export const STANDS: readonly Piece[] = [NIGHTSTAND, SIDE_TABLE, ROUND_TABLE, { id: 'painted_wooden_stool', s: 1, soft: true, tops: [[0.58, 'night']] }];
export const SMALL_SHELVES: readonly Piece[] = [
  {
    id: 'painted_wooden_shelves',
    s: 1.15,
    tops: [
      [0.46, 'shelf'],
      [0.736, 'shelf'],
      [1.1, 'cap'],
    ],
    td: [-0.4, 0.08],
  },
  WHITE_SHELF,
  CUBE_SHELF,
  {
    id: 'painted_wooden_bench',
    s: 0.85,
    tops: [
      [0.208, 'shelf'],
      [0.652, 'shelf'],
    ],
  },
];
/** 铁皮柜（配电箱的模型拉高） */
export const LOCKER: Piece = { id: 'utility_box_02', s: [0.9, 1.6, 1.1] };

export interface Def {
  kind: 'piece' | 'unit' | 'bed' | 'chair' | 'crate' | 'barrel' | 'pallet' | 'sandbag' | 'junk' | 'locker' | 'car';
  v?: readonly Piece[];
  /** 相邻的同一个字母最多合并几格 */
  max?: number;
}

export const FURN: Record<string, Def> = {
  b: { kind: 'bed', max: 2 },
  n: { kind: 'piece', v: [NIGHTSTAND, SIDE_TABLE, ROUND_TABLE] },
  w: { kind: 'piece', v: [HUTCH, DRAWERS, WHITE_SHELF] },
  q: { kind: 'piece', v: [SIDEBOARD, { id: 'vintage_wooden_drawer_01', s: [0.55, 0.75, 0.55], tops: [[1.084, 'night']] }] },
  s: {
    kind: 'piece',
    max: 2,
    v: [
      { id: 'sofa_02', s: [1.03, 1.1, 1.03], n: 2, solid: 0.6, tops: [[0.393, 'sofa']], td: [-0.1, 0.42] },
      { id: 'Sofa_01', s: 1.16, n: 2, solid: 0.6, home: true, tops: [[0.376, 'sofa']], td: [-0.1, 0.42] },
      { id: 'painted_wooden_sofa', s: 0.76, n: 2, solid: 0.6, tops: [[0.616, 'sofa']], td: [-0.3, 0.45] },
      ARMCHAIR,
    ],
  },
  a: { kind: 'piece', v: [ARMCHAIR, LOUNGE] },
  l: {
    kind: 'piece',
    max: 2,
    v: [{ id: 'modern_coffee_table_01', s: 1, n: 2, tops: [[0.388, 'table']] }, SIDE_TABLE, ROUND_TABLE, { id: 'modern_coffee_table_01', s: 0.75, tops: [[0.388, 'table']] }],
  },
  v: {
    kind: 'piece',
    max: 2,
    v: [
      { id: 'modern_wooden_cabinet', s: [0.76, 0.8, 0.85], n: 2, tops: [[0.68, 'tv']] },
      { id: 'vintage_wooden_drawer_01', s: [0.95, 0.68, 0.58], n: 2, tops: [[1.084, 'tv']] },
      { id: 'painted_wooden_cabinet', s: 0.8, tops: [[1.18, 'tv']] },
    ],
  },
  t: {
    kind: 'piece',
    max: 2,
    v: [
      { id: 'painted_wooden_table', s: [0.77, 0.79, 0.8], n: 2, grow: true, tops: [[0.96, 'table']] },
      { id: 'dining_table', s: [0.82, 0.9, 0.72], n: 2, grow: true, home: true, tops: [[0.805, 'table']] },
      { id: 'painted_wooden_table', s: [0.38, 0.79, 0.75], tops: [[0.96, 'table']] },
    ],
  },
  c: { kind: 'chair' },
  k: { kind: 'unit', v: [{ id: 'painted_wooden_cabinet', s: 0.82, tops: [[1.18, 'counter']] }] },
  o: { kind: 'piece', v: [{ id: 'electric_stove', s: [0.95, 1.07, 1.2], front: 'x', tops: [[0.852, 'stove']] }] },
  O: { kind: 'piece', v: [{ id: 'barrel_stove', s: 1.05 }] },
  f: { kind: 'piece', v: [HUTCH] },
  h: {
    kind: 'piece',
    max: 2,
    v: [
      CUBE_SHELF,
      WHITE_SHELF,
      {
        id: 'wooden_bookshelf_worn',
        s: [1.35, 0.97, 0.85],
        n: 2,
        tops: [
          [0.108, 'shelf'],
          [0.391, 'shelf'],
          [0.67, 'shelf'],
          [0.959, 'shelf'],
          [1.274, 'shelf'],
          [1.661, 'shelf'],
          [2.063, 'cap'],
        ],
      },
      {
        id: 'steel_frame_shelves_03',
        s: [0.8, 0.84, 0.8],
        n: 2,
        tops: [
          [0.659, 'shelf'],
          [1.317, 'shelf'],
          [1.75, 'cap'],
        ],
      },
    ],
  },
  e: {
    kind: 'piece',
    max: 2,
    v: [
      { id: 'metal_office_desk', s: [0.9, 0.98, 0.85], n: 2, tops: [[0.788, 'desk']], td: [-0.4, 0.12] },
      { id: 'metal_office_desk', s: [0.46, 0.98, 0.8], tops: [[0.788, 'desk']], td: [-0.4, 0.12] },
    ],
  },
  u: { kind: 'piece', max: 2, v: [{ id: 'metal_office_desk', s: [0.95, 1.1, 0.9], n: 2, tops: [[0.788, 'bench']] }] },
  i: { kind: 'piece', max: 2, v: [{ id: 'metal_office_desk', s: [0.9, 1.15, 0.75], n: 2, tops: [[0.788, 'till']] }] },
  r: {
    kind: 'unit',
    v: [
      {
        id: 'worn_metal_rack',
        s: [1.04, 1.02, 0.95],
        tops: [
          [0.432, 'shelf'],
          [0.921, 'shelf'],
          [1.411, 'shelf'],
          [1.9, 'cap'],
        ],
      },
      {
        id: 'steel_frame_shelves_01',
        s: [0.0875, 0.089, 0.1],
        tops: [
          [1.338, 'shelf'],
          [6.422, 'shelf'],
          [11.452, 'shelf'],
          [16.535, 'shelf'],
          [21.303, 'cap'],
        ],
        td: [-0.4, 0.4],
      },
    ],
  },
  T: { kind: 'piece', v: [{ id: 'tool_cart', s: 0.72, tops: [[0.896, 'cart']] }] },
  g: { kind: 'piece', v: [{ id: 'portable_generator', s: 1 }] },
  m: { kind: 'locker' },
  x: { kind: 'crate' },
  B: { kind: 'barrel' },
  P: { kind: 'pallet', max: 2 },
  S: { kind: 'sandbag', max: 3 },
  j: { kind: 'junk' },
  C: { kind: 'car' },
};

/** 高家具：得有一面靠着实墙（平面图检查用）。货架 r 不算：铺面、仓库里的货架是成排立在屋子中间的 */
export const TALL = 'wfhm';
/** 正面是 +X 的小物件（其余的正面是 +Z） */
export const FRONT_X: ReadonlySet<string> = new Set(['CashRegister_01']);

// ---------------------------------------------------------------- 桌上、架子上的小东西
//
// 这些只是摆设，捡不了。所以不放枪、近战武器、红色铁皮汽油桶、手电、急救箱——
// 这几样模型留给真能捡的战利品（game/items.ts），玩家看到了就一定拿得走

/** [模型, 缩放, 方式]：f = 平放（枪、锯子这些立着建模的），a = 正面朝外（电视、电脑） */
export type Item = readonly [string, number, string?];

const KITCHEN: readonly Item[] = [
  ['pot_enamel_01', 1],
  ['brass_pot_01', 0.8],
  ['brass_pan_01', 0.9],
  ['can_rusted', 1],
  ['can_rusted', 1],
  ['bleach_bottle', 1],
  ['multi_cleaner_5_litre', 1],
  ['cardboard_box_01', 0.5],
];
const TABLEWARE: readonly Item[] = [
  ['pot_enamel_01', 1],
  ['brass_pot_01', 0.7],
  ['brass_pan_01', 0.9],
  ['can_rusted', 1],
  ['office_notepads', 0.35],
  ['vintage_oil_lamp', 0.45],
];
const HOUSEHOLD: readonly Item[] = [
  ['cardboard_box_01', 0.55],
  ['cardboard_box_01', 0.42],
  ['boombox', 0.6, 'a'],
  ['vintage_oil_lamp', 0.45],
  ['binoculars', 1],
  ['stationery_supplies', 1],
  ['office_notepads', 0.35],
  ['can_rusted', 1],
  ['brass_pot_01', 0.7],
  ['metal_toolbox', 0.8],
];
const TOOLS: readonly Item[] = [
  ['metal_toolbox', 1],
  ['Drill_01', 1.2],
  ['oil_tin', 1],
  ['spray_paint_bottles', 1.2],
  ['can_rusted', 1.2],
  ['plastic_crate_02', 0.8],
  ['cardboard_box_01', 0.7],
  ['handsaw_wood', 1, 'f'],
  ['plastic_jerrycan', 0.8],
];
const GOODS: readonly Item[] = [
  ['cardboard_box_01', 0.7],
  ['cardboard_box_01', 0.5],
  ['plastic_crate_02', 0.8],
  ['can_rusted', 1.2],
  ['can_rusted', 1.2],
  ['bleach_bottle', 1],
  ['multi_cleaner_5_litre', 1],
  ['pot_enamel_01', 1],
  ['oil_tin', 1],
  ['spray_paint_bottles', 1.1],
  ['brass_pot_01', 0.7],
];
const DESK: readonly Item[] = [
  ['office_notepads', 0.42],
  ['stationery_supplies', 1],
  ['desk_lamp_arm_01', 0.6],
  ['cardboard_box_01', 0.5],
  ['bleach_bottle', 1],
  ['binoculars', 1],
];
const ARMS: readonly Item[] = [
  ['ammo_box', 1.25],
  ['ammo_box', 1.25],
  ['ammo_box', 1.25],
  ['ammo_box', 1.25],
  ['stick_grenade', 1],
  ['binoculars', 1],
  ['metal_toolbox', 0.9],
  ['cardboard_box_01', 0.5],
];
const ARMS_TABLE: readonly Item[] = [
  ['metal_toolbox', 0.9],
  ['office_notepads', 0.42],
  ['cardboard_box_01', 0.5],
  ['ammo_box', 1.25],
  ['ammo_box', 1.25],
  ['stick_grenade', 1],
  ['binoculars', 1],
];
const ARMS_DESK: readonly Item[] = [
  ['office_notepads', 0.42],
  ['binoculars', 1],
  ['ammo_box', 1.25],
  ['desk_lamp_arm_01', 0.6],
  ['stationery_supplies', 1],
];
const POTS: readonly Item[] = [
  ['pot_enamel_01', 1],
  ['brass_pot_01', 0.8],
  ['brass_pan_01', 0.9],
];
const NIGHT: readonly Item[] = [
  ['vintage_oil_lamp', 0.45],
  ['desk_lamp_arm_01', 0.55],
  ['stationery_supplies', 1],
  ['office_notepads', 0.3],
  ['binoculars', 1],
  ['can_rusted', 1],
  ['boombox', 0.55, 'a'],
];
const TVS: readonly Item[] = [
  ['Television_01', 0.9, 'a'],
  ['Television_01', 0.9, 'a'],
  ['television_02', 1.35, 'a'],
];
const LAPTOP: Item = ['classic_laptop', 0.55, 'a'];
const RADIO: Item = ['vintage_radio_transceiver', 1, 'a'];

export interface Deck {
  items: readonly Item[];
  /** 每个空位有多大概率放东西 */
  fill: number;
  /** 主角（电视、台钳、收银机）：先放它，其余的摆在两边 */
  mains?: readonly Item[];
  pMain?: number;
  /** 主角的位置（-1 最左，1 最右） */
  at?: number;
}

/** 一个面上摆什么：按面的类别、房间的用途、家具的字母挑 */
export function deckOf(kind: string, rk: RoomKind, letter: string): Deck {
  switch (kind) {
    case 'tv':
      return { items: HOUSEHOLD, fill: 0.3, mains: TVS, pMain: 0.9 };
    case 'night':
      return { items: [], fill: 0, mains: rk === 'mil' ? ARMS : NIGHT, pMain: 0.85 };
    case 'sofa':
      return { items: [], fill: 0, mains: [['throw_pillows_01', 0.7]], pMain: 0.6, at: 0.45 };
    case 'stove':
      return { items: POTS, fill: 0.25, mains: POTS, pMain: 0.7, at: -0.4 };
    case 'cart':
      return { items: [], fill: 0, mains: [['metal_tool_chest', 0.75, 'a']], pMain: 1 };
    case 'bench':
      return { items: TOOLS, fill: 0.7, mains: [['bench_vice_01', 1, 'a']], pMain: 1, at: 0.55 };
    case 'till':
      return { items: GOODS, fill: 0.35, mains: [['CashRegister_01', 0.62, 'a']], pMain: 1, at: -0.5 };
    case 'counter':
      return { items: KITCHEN, fill: 0.6, mains: [['vintage_microwave', 0.5, 'a']], pMain: 0.3 };
    case 'desk':
      return rk === 'mil' ? { items: ARMS_DESK, fill: 0.6, mains: [RADIO, LAPTOP], pMain: 0.8, at: -0.35 } : { items: DESK, fill: 0.55, mains: [LAPTOP], pMain: 0.6, at: -0.3 };
    case 'table':
      if (rk === 'mil') return { items: ARMS_TABLE, fill: 0.75 };
      if (rk === 'office') return { items: DESK, fill: 0.45 };
      if (rk === 'storage') return { items: TOOLS, fill: 0.6 };
      if (rk === 'shop') return { items: GOODS, fill: 0.5 };
      return letter === 'l' ? { items: HOUSEHOLD, fill: 0.45 } : { items: TABLEWARE, fill: 0.5 };
    default:
      if (rk === 'mil') return { items: ARMS, fill: 0.85 };
      if (rk === 'storage') return { items: TOOLS, fill: 0.7 };
      if (rk === 'shop') return { items: GOODS, fill: 0.85 };
      if (rk === 'office') return { items: DESK, fill: 0.55 };
      return letter === 'f' || letter === 'k' ? { items: KITCHEN, fill: 0.6 } : { items: HOUSEHOLD, fill: 0.55 };
  }
}

// ---------------------------------------------------------------- 自动添置的杂物

/** 墙边的杂物：blocks = 挡路（添置前要确认不会把路堵死），low = 矮（可以放在窗下） */
export const KINDS: Record<string, { blocks: boolean; low: boolean }> = {
  boxes: { blocks: true, low: true },
  suitcase: { blocks: false, low: true },
  stand: { blocks: true, low: true },
  chair: { blocks: true, low: true },
  sshelf: { blocks: true, low: false },
  bags: { blocks: true, low: true },
  bucket: { blocks: false, low: true },
  bin: { blocks: true, low: true },
  crates: { blocks: true, low: true },
  barrel: { blocks: true, low: true },
  tyres: { blocks: true, low: true },
  cans: { blocks: false, low: true },
  cement: { blocks: true, low: true },
  propane: { blocks: true, low: true },
  ladder: { blocks: true, low: false },
  truck: { blocks: true, low: false },
  mcrate: { blocks: true, low: true },
  ammo: { blocks: false, low: true },
  locker: { blocks: true, low: false },
  pcrate: { blocks: true, low: true },
  sign: { blocks: false, low: true },
  ext: { blocks: false, low: true },
  gen: { blocks: true, low: true },
};

type Weighted = ReadonlyArray<readonly [string, number]>;

export interface Dress {
  /** 靠墙的空格有多大概率堆东西；墙面有多大概率挂东西；空地上有多大概率有零碎 */
  wall: number;
  deco: number;
  floor: number;
  kinds: Weighted;
  decos: Weighted;
  /** 地上的零碎 */
  litter: readonly Item[];
  rug: 'rug' | 'carpet' | null;
}

const PAPER: Item = ['office_notepads', 0.6];

export const DRESS: Record<RoomKind, Dress> = {
  bed: {
    wall: 0.16,
    deco: 0.3,
    floor: 0.04,
    kinds: [
      ['boxes', 3],
      ['suitcase', 2.2],
      ['stand', 2],
      ['chair', 1],
      ['sshelf', 1.5],
      ['bags', 0.5],
      ['bucket', 0.4],
    ],
    decos: [
      ['picture', 3],
      ['clock', 1],
      ['wshelf', 2],
    ],
    litter: [PAPER, ['throw_pillows_01', 0.6], ['can_rusted', 1], ['cardboard_box_01', 0.4]],
    rug: 'rug',
  },
  living: {
    wall: 0.14,
    deco: 0.3,
    floor: 0.04,
    kinds: [
      ['boxes', 3],
      ['stand', 2],
      ['sshelf', 2],
      ['chair', 1.5],
      ['suitcase', 1],
      ['bin', 1],
      ['bags', 1],
      ['bucket', 1],
      ['crates', 0.5],
      ['cans', 0.3],
    ],
    decos: [
      ['picture', 3],
      ['clock', 1.5],
      ['dart', 0.7],
      ['wshelf', 2.5],
    ],
    litter: [PAPER, PAPER, ['can_rusted', 1], ['bleach_bottle', 1], ['cardboard_box_01', 0.4]],
    rug: 'rug',
  },
  storage: {
    wall: 0.3,
    deco: 0.2,
    floor: 0.05,
    kinds: [
      ['crates', 3],
      ['barrel', 2],
      ['tyres', 2],
      ['cans', 2],
      ['cement', 1.5],
      ['propane', 1],
      ['ladder', 0.8],
      ['truck', 0.8],
      ['boxes', 2.5],
      ['bags', 1],
      ['bucket', 1],
      ['bin', 0.5],
      ['gen', 0.3],
      ['ext', 0.5],
    ],
    decos: [
      ['wshelf', 3],
      ['mask', 1],
      ['clock', 0.4],
    ],
    litter: [PAPER, ['can_rusted', 1.2], ['oil_tin', 1], ['cardboard_box_01', 0.5], ['spray_paint_bottles', 1]],
    rug: null,
  },
  shop: {
    wall: 0.2,
    deco: 0.22,
    floor: 0.06,
    kinds: [
      ['boxes', 4],
      ['crates', 2],
      ['bin', 1],
      ['pcrate', 2.5],
      ['sign', 0.7],
      ['bags', 1],
      ['truck', 0.5],
      ['ext', 0.6],
    ],
    decos: [
      ['wshelf', 3],
      ['clock', 1],
      ['picture', 1],
    ],
    litter: [PAPER, ['can_rusted', 1.2], ['cardboard_box_01', 0.45], ['bleach_bottle', 1]],
    rug: null,
  },
  office: {
    wall: 0.16,
    deco: 0.3,
    floor: 0.06,
    kinds: [
      ['boxes', 3],
      ['stand', 2],
      ['sshelf', 2],
      ['chair', 2],
      ['bin', 1],
      ['suitcase', 0.5],
      ['bags', 0.5],
      ['ext', 0.6],
    ],
    decos: [
      ['picture', 2],
      ['clock', 1.5],
      ['wshelf', 2],
    ],
    litter: [PAPER, PAPER, PAPER, ['cardboard_box_01', 0.4]],
    rug: 'carpet',
  },
  mil: {
    wall: 0.26,
    deco: 0.34,
    floor: 0.05,
    kinds: [
      ['crates', 4],
      ['mcrate', 2],
      ['ammo', 2.5],
      ['cans', 2],
      ['locker', 1],
      ['barrel', 1],
      ['boxes', 1],
      ['ext', 0.4],
    ],
    decos: [
      ['mask', 2],
      ['wshelf', 2],
      ['clock', 0.5],
    ],
    litter: [PAPER, ['ammo_box', 1.25], ['ammo_box', 1.25], ['can_rusted', 1.2], ['stick_grenade', 1]],
    rug: null,
  },
};
