import { GUN_BY_ID } from '../../game/data/guns';
import { NO_MOD, effectiveStats } from '../../game/data/weapons';
import { AMMO_ITEM, AMMO_NAME, CAR_PARTS, GUN_LIST, MELEE_LIST, type AmmoId, type CarPartId, type GunClass, type MeleeId } from './api';

/**
 * 开放世界里能捡的东西 + 战利品表。
 * 地上的样子用现成的写实道具模型（public/props）；枪在地上统一用一把步枪 / 手枪的模型，捡起来才是具体的型号。
 */

export type ItemKind = 'food' | 'drink' | 'med' | 'warm' | 'ammo' | 'throw' | 'fuel' | 'gear' | 'gun' | 'melee' | 'part';

export interface ItemDef {
  id: string;
  name: string;
  kind: ItemKind;
  /** 一个多重（千克） */
  weight: number;
  /** 地上的样子：模型、缩放、是不是放倒 */
  model: string;
  scale: number;
  flat?: boolean;
  /** 染色（乘在模型原来的颜色上）：好几样东西共用一个模型时靠它区分 */
  tint?: number;
  /**
   * 消耗品包（public/stims，只在本机有）里对应的模型：有就用它（真实大小，不染色），没有就用上面的 model。
   * 手上用的时候的动作也是按这个 id 找的（武器模块）
   */
  alt?: string;
  desc: string;
  /**
   * 用掉以后：饱 / 水 / 生命 / 体温各加多少；heat = 持续保暖多少秒；
   * boost = 兴奋多少秒（跑步不耗体力、走得快一成）；numb = 镇痛多少秒（受到的伤害少三成）
   */
  use?: { hunger?: number; thirst?: number; hp?: number; warm?: number; heat?: number; stamina?: number; boost?: number; numb?: number };
  /** 用一次要多少秒（手上的武器要先放下）。不写 = 马上生效 */
  time?: number;
  /** 地上一堆是几个（弹药一盒多少发） */
  pack?: [number, number];
  /** 0 普通 · 1 好东西 · 2 稀有（地上闪光的颜色、背包里名字的颜色） */
  rare: number;
  gun?: string;
  melee?: MeleeId;
  /** 车的改装件 */
  part?: CarPartId;
  /** 汽油（升） */
  fuel?: number;
}

const list: ItemDef[] = [
  // ---- 吃的
  { id: 'canned_meat', name: '肉罐头', kind: 'food', weight: 0.4, model: 'can_rusted', scale: 1.1, tint: 0xd9a08a, desc: '顶饿', use: { hunger: 34 }, time: 2.6, rare: 0 },
  { id: 'canned_fruit', name: '水果罐头', kind: 'food', weight: 0.4, model: 'can_rusted', scale: 1.0, tint: 0xf2d27a, desc: '解一点饿，也解一点渴', use: { hunger: 16, thirst: 14 }, time: 2.4, rare: 0 },
  { id: 'biscuits', name: '压缩饼干', kind: 'food', weight: 0.2, model: 'cardboard_box_01', scale: 0.32, desc: '很干，吃了会口渴', use: { hunger: 24, thirst: -6 }, time: 2, rare: 0 },
  { id: 'cheese', name: '奶酪', kind: 'food', weight: 0.9, model: 'cardboard_box_01', scale: 0.4, tint: 0xf2d27a, alt: 'big_cheese', desc: '一整块，很顶饿，吃完口渴', use: { hunger: 52, thirst: -8 }, time: 3.2, rare: 0 },
  { id: 'mre', name: '军用口粮', kind: 'food', weight: 0.6, model: 'plastic_crate_02', scale: 0.5, desc: '一整顿饭，自带加热包', use: { hunger: 60, thirst: 8, warm: 12 }, time: 4, rare: 1 },
  // ---- 喝的
  { id: 'water', name: '瓶装水', kind: 'drink', weight: 0.5, model: 'bleach_bottle', scale: 1, desc: '干净的水', use: { thirst: 36 }, time: 1.8, rare: 0 },
  { id: 'soda', name: '汽水', kind: 'drink', weight: 0.35, model: 'can_rusted', scale: 0.9, tint: 0x8fb8f0, desc: '解渴，有点糖分', use: { thirst: 22, hunger: 5 }, time: 1.6, rare: 0 },
  { id: 'water_jug', name: '桶装水', kind: 'drink', weight: 2.2, model: 'multi_cleaner_5_litre', scale: 1, desc: '一大桶，很重', use: { thirst: 100 }, time: 3, rare: 1 },
  { id: 'energy', name: '能量饮料', kind: 'drink', weight: 0.3, model: 'can_rusted', scale: 0.8, tint: 0x9be08a, desc: '解一点渴，体力马上回满', use: { thirst: 12, stamina: 1 }, time: 1.5, rare: 0 },
  { id: 'liquor', name: '白酒', kind: 'drink', weight: 0.5, model: 'bleach_bottle', scale: 0.85, tint: 0xe0c9a0, desc: '喝了身上暖和，但更口渴', use: { warm: 30, thirst: -8 }, time: 1.8, rare: 0 },
  // ---- 药
  { id: 'bandage', name: '绷带', kind: 'med', weight: 0.1, model: 'stationery_supplies', scale: 0.8, desc: '包扎伤口', use: { hp: 22 }, time: 3, rare: 0 },
  { id: 'medkit', name: '急救包', kind: 'med', weight: 0.8, model: 'medical_box', scale: 0.75, desc: '能救命', use: { hp: 70 }, time: 5, rare: 1 },
  { id: 'painkiller', name: '止痛药', kind: 'med', weight: 0.05, model: 'oil_tin', scale: 0.6, tint: 0xf4f4f4, desc: '顶一下', use: { hp: 12 }, time: 1.4, rare: 0 },
  { id: 'balm', name: '清凉油', kind: 'med', weight: 0.05, model: 'oil_tin', scale: 0.45, tint: 0xe8c860, alt: 'golden_star', desc: '抹一点提神、止痒，身上也暖一点', use: { hp: 8, warm: 10, stamina: 0.5 }, time: 2, rare: 0 },
  { id: 'injector', name: '镇痛针', kind: 'med', weight: 0.1, model: 'oil_tin', scale: 0.5, tint: 0x9fd0ff, alt: 'hopium', desc: '马上回一截血，之后四十秒挨打少疼三成', use: { hp: 40, numb: 40 }, time: 2, rare: 1 },
  { id: 'stim', name: '肾上腺素针', kind: 'med', weight: 0.1, model: 'oil_tin', scale: 0.5, tint: 0xff9a7a, alt: 'adrenaline_stim', desc: '体力回满，之后半分钟跑不累、腿脚快一成', use: { stamina: 1, hp: 6, boost: 30 }, time: 1.6, rare: 1 },
  // ---- 保暖
  { id: 'warmer', name: '暖宝宝', kind: 'warm', weight: 0.1, model: 'office_notepads', scale: 0.22, desc: '贴上暖和三分钟', use: { warm: 20, heat: 180 }, time: 1.5, rare: 0 },
  { id: 'cigarettes', name: '香烟', kind: 'warm', weight: 0.05, model: 'office_notepads', scale: 0.16, tint: 0xd8c8b0, alt: 'cigars', desc: '抽一根，身上暖和一点，嘴更干', use: { warm: 14, thirst: -4 }, time: 3.2, rare: 0 },
  { id: 'coat', name: '厚外套', kind: 'gear', weight: 0, model: 'throw_pillows_01', scale: 0.55, desc: '穿上不容易冷', rare: 1 },
  // ---- 装备
  { id: 'backpack', name: '背包', kind: 'gear', weight: 0, model: 'vintage_suitcase', scale: 0.4, desc: '多背 15 千克', rare: 1 },
  { id: 'flashlight', name: '手电筒', kind: 'gear', weight: 0, model: 'pastic_torch_6v', scale: 1.1, desc: '按 T 开关', rare: 1 },
  // ---- 投掷
  { id: 'grenade', name: '手雷', kind: 'throw', weight: 0.35, model: 'oil_tin', scale: 0.55, tint: 0x6f7a58, alt: 'rgd_5', desc: '按 Q 拔销扔出去，三秒多以后炸，七米内都够呛——别扔在自己脚边', rare: 2 },
  // ---- 汽油
  { id: 'fuel_can', name: '汽油桶', kind: 'fuel', weight: 7, model: 'metal_jerrycan', scale: 1, desc: '10 升汽油：站在车旁边按 F 加进去', rare: 1, fuel: 10 },
];

const AMMO_PACK: Record<AmmoId, [number, number]> = { '9mm': [8, 16], '45': [6, 12], magnum: [4, 8], '12g': [4, 8], '556': [10, 20], '762': [8, 16] };
const AMMO_W: Record<AmmoId, number> = { '9mm': 0.012, '45': 0.02, magnum: 0.02, '12g': 0.045, '556': 0.012, '762': 0.022 };
/** 弹药盒的颜色：手枪弹偏黄、马格南偏橙、霰弹偏红、步枪弹偏绿 */
const AMMO_TINT: Record<AmmoId, number> = { '9mm': 0xf0e0a0, '45': 0xe8c880, magnum: 0xf0a868, '12g': 0xf08878, '556': 0xa8d8a0, '762': 0x88b890 };
for (const a of Object.keys(AMMO_ITEM) as AmmoId[]) {
  list.push({ id: AMMO_ITEM[a], name: AMMO_NAME[a], kind: 'ammo', weight: AMMO_W[a], model: 'ammo_box', scale: 1.15, tint: AMMO_TINT[a], desc: '弹药', pack: AMMO_PACK[a], rare: 1 });
}
/** 拿在手上的武器不占负重；放进背包 / 车厢的才算 */
const GUN_W: Record<GunClass, number> = { pistol: 1, smg: 2.6, shotgun: 3.3, rifle: 3.6, sniper: 4.4, lmg: 7.5 };
const CLS_NAME: Record<GunClass, string> = { pistol: '手枪', smg: '冲锋枪', shotgun: '霰弹枪', rifle: '步枪', sniper: '狙击枪', lmg: '机枪' };
for (const g of GUN_LIST) {
  const long = g.cls !== 'pistol';
  list.push({ id: `gun_${g.id}`, name: g.name, kind: 'gun', weight: GUN_W[g.cls], model: long ? 'bolt_action_rifle_7_62' : 'service_pistol', scale: long ? 0.85 : 1, flat: true, desc: `${CLS_NAME[g.cls]} · 用${AMMO_NAME[g.ammo]}`, rare: 2, gun: g.id });
}
const MELEE_W: Record<MeleeId, number> = { bat: 1, crowbar: 1.6, hatchet: 1.1, machete: 0.8, sledge: 4.5 };
for (const m of MELEE_LIST) {
  list.push({ id: `melee_${m.id}`, name: m.name, kind: 'melee', weight: MELEE_W[m.id], model: m.model, scale: 1, flat: true, desc: '近战武器', rare: 1, melee: m.id });
}

/** 改装件在地上的样子（装到车上以后是车辆模块自己做的模型）、多重 */
const PART_LOOK: Record<CarPartId, [string, number, number, boolean]> = {
  bullbar: ['metal_tool_chest', 0.8, 12, false],
  roofrack: ['wooden_ladder_02', 0.7, 9, true],
  auxtank: ['metal_jerrycan_green', 1.35, 6, false],
  lightbar: ['mounted_fluorescent_lights', 0.8, 3, false],
  tires: ['old_tyre', 1.15, 14, true],
  armor: ['plastic_container', 0.8, 10, false],
};
for (const c of CAR_PARTS) {
  const [model, scale, weight, flat] = PART_LOOK[c.id];
  list.push({ id: `part_${c.id}`, name: c.name, kind: 'part', weight, model, scale, flat, desc: `皮卡的改装件：${c.desc}。站在车旁边按 F 装上`, rare: 2, part: c.id });
}

export const ITEMS: Record<string, ItemDef> = Object.fromEntries(list.map((d) => [d.id, d]));
export const itemOf = (id: string): ItemDef | undefined => ITEMS[id];

/** 这把枪的弹匣装几发（和主游戏的数值一致）、用什么子弹 */
export function magOf(gunId: string): number {
  const g = GUN_LIST.find((q) => q.id === gunId);
  return g ? effectiveStats(g.cls, 0, NO_MOD, GUN_BY_ID[g.id]).mag : 0;
}
export function ammoOf(gunId: string): AmmoId | null {
  return GUN_LIST.find((q) => q.id === gunId)?.ammo ?? null;
}

// ---------------------------------------------------------------- 战利品表

/** 在哪种地方：住家、商店、仓库 / 修车铺 / 废墟、诊所、军营、屋外的车、加油站 */
export type LootPlace = 'home' | 'shop' | 'store' | 'office' | 'mil' | 'car' | 'fuel';

type Row = readonly [string, number];

/**
 * 每个位置抽一行。@ 开头的是「再抽一次」：
 *   @gunN 一把稀有度不超过 N 的枪 · @melee 近战武器 · @ammo 民用弹药 · @ammoMil 军用弹药 · @part 皮卡的改装件
 * 枪是稀缺资源：民宅里平均十几栋才有一把（而且多半是手枪 / 猎枪），好枪只在检查站和军事基地里。
 */
const TABLE: Record<LootPlace, Row[]> = {
  home: [
    ['canned_meat', 14],
    ['canned_fruit', 12],
    ['biscuits', 10],
    ['water', 16],
    ['soda', 10],
    ['water_jug', 2],
    ['energy', 4],
    ['liquor', 4],
    ['painkiller', 5],
    ['bandage', 9],
    ['medkit', 1.2],
    ['warmer', 7],
    ['coat', 2.2],
    ['backpack', 1.4],
    ['flashlight', 2.2],
    ['cheese', 4],
    ['cigarettes', 5],
    ['balm', 3],
    ['@melee', 4.5],
    ['@ammo', 4],
    ['@gun1', 1.6],
  ],
  shop: [
    ['canned_meat', 16],
    ['canned_fruit', 14],
    ['biscuits', 14],
    ['water', 20],
    ['soda', 16],
    ['water_jug', 5],
    ['energy', 10],
    ['liquor', 7],
    ['painkiller', 4],
    ['bandage', 5],
    ['warmer', 6],
    ['flashlight', 2.5],
    ['backpack', 1.2],
    ['fuel_can', 2.5],
    ['cheese', 6],
    ['cigarettes', 8],
    ['balm', 2],
    ['@melee', 1.5],
    ['@ammo', 1.5],
  ],
  store: [
    ['fuel_can', 11],
    ['@melee', 10],
    ['flashlight', 5],
    ['water', 8],
    ['canned_meat', 7],
    ['biscuits', 5],
    ['bandage', 6],
    ['warmer', 5],
    ['backpack', 2.5],
    ['coat', 2],
    ['cigarettes', 3],
    ['@ammo', 5],
    ['@gun2', 1.3],
    ['@part', 3.2],
  ],
  office: [
    ['bandage', 26],
    ['painkiller', 16],
    ['medkit', 9],
    ['water', 12],
    ['soda', 6],
    ['warmer', 8],
    ['biscuits', 6],
    ['flashlight', 3],
    ['coat', 2],
    ['balm', 6],
    ['stim', 5],
    ['injector', 4],
    ['@ammo', 2],
  ],
  mil: [
    ['@ammoMil', 26],
    ['mre', 14],
    ['water', 10],
    ['medkit', 7],
    ['bandage', 9],
    ['fuel_can', 6],
    ['backpack', 3],
    ['coat', 3],
    ['flashlight', 3],
    ['stim', 4],
    ['injector', 3],
    ['cigarettes', 3],
    ['grenade', 4],
    ['@melee', 3],
    ['@gun3', 5],
    ['@part', 1.6],
  ],
  car: [
    ['fuel_can', 10],
    ['water', 10],
    ['soda', 6],
    ['energy', 4],
    ['liquor', 3],
    ['canned_meat', 5],
    ['bandage', 6],
    ['warmer', 4],
    ['flashlight', 3],
    ['cigarettes', 4],
    ['stim', 0.8],
    ['@melee', 6],
    ['@ammo', 3],
    ['@gun1', 0.8],
    ['@part', 1.4],
  ],
  fuel: [
    ['fuel_can', 30],
    ['water', 6],
    ['soda', 6],
    ['@melee', 3],
    ['@part', 3],
  ],
};

const AMMO_CIVIL: Row[] = [
  ['9mm', 5],
  ['45', 3],
  ['12g', 4],
  ['magnum', 1.5],
  ['762', 1.5],
  ['556', 0.6],
];
const AMMO_MIL: Row[] = [
  ['762', 6],
  ['556', 5],
  ['9mm', 3],
  ['45', 2],
  ['12g', 2],
  ['magnum', 0.8],
];

function pick(rows: readonly Row[], r: number): string {
  let total = 0;
  for (const q of rows) total += q[1];
  let t = r * total;
  for (const q of rows) {
    t -= q[1];
    if (t <= 0) return q[0];
  }
  return (rows[rows.length - 1] as Row)[0];
}

/** 一把稀有度不超过 maxTier 的枪：越稀有的越难抽到 */
export function rollGun(maxTier: number, r: number): string {
  const rows: Row[] = GUN_LIST.filter((g) => g.tier <= maxTier).map((g) => [`gun_${g.id}`, [0, 6, 3.2, 1.6, 0.8][g.tier] as number]);
  return pick(rows, r);
}

export interface Drop {
  item: string;
  n: number;
}

/**
 * 抽一件战利品。rnd() 给 0–1 的随机数（按地点的种子，同一个世界每次都一样）。
 * level = 地点的危险等级 1–5：等级高的地方枪的稀有度上限也高。
 */
export function rollLoot(place: LootPlace, level: number, rnd: () => number): Drop {
  let id = pick(TABLE[place], rnd());
  if (id.startsWith('@gun')) id = rollGun(Math.min(4, Number(id.slice(4)) + (level >= 4 ? 1 : 0)), rnd());
  else if (id === '@melee') id = `melee_${(MELEE_LIST[Math.floor(rnd() * MELEE_LIST.length)] as (typeof MELEE_LIST)[number]).id}`;
  else if (id === '@ammo') id = AMMO_ITEM[pick(AMMO_CIVIL, rnd()) as AmmoId];
  else if (id === '@ammoMil') id = AMMO_ITEM[pick(AMMO_MIL, rnd()) as AmmoId];
  else if (id === '@part') id = `part_${(CAR_PARTS[Math.floor(rnd() * CAR_PARTS.length)] as (typeof CAR_PARTS)[number]).id}`;
  const def = ITEMS[id] as ItemDef;
  const n = def.pack ? def.pack[0] + Math.floor(rnd() * (def.pack[1] - def.pack[0] + 1)) : 1;
  return { item: id, n };
}
