import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import type { Lighting } from '../../render/core/lighting';
import type { PostFX } from '../../render/core/postfx';
import type { Sky } from '../../render/core/sky';
import type { DayCycle } from '../daycycle';
import type { Player } from '../player';
import type { QualityControl } from '../quality';
import type { Garage } from '../vehicles/garage';
import type { HitKind, World } from '../world/world';

/**
 * 开放世界「玩法层」各模块之间的约定。模块各管各的文件，只通过这里的接口互相调用：
 *   weather.ts          天气（雨、雪、气温）
 *   combat/arsenal.ts   武器（枪、近战、弹药、视角模型、准星）
 *   combat/horde.ts     丧尸（刷新、行为、渲染、受伤）
 *   combat/raiders.ts   带枪的人（敌人、生化模式里的同伴）
 *   game/*              背包、物品、拾取、生存状态、界面、守城、生化模式、武器图鉴（main.ts 负责把它们接起来）
 * 改这个文件要通知所有模块的作者。
 */

// ---------------------------------------------------------------- 武器清单（战利品表和武器模块共用）

export type AmmoId = '9mm' | '45' | 'magnum' | '12g' | '556' | '762';
export type GunClass = 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'sniper' | 'lmg';

/** 弹药在背包里的物品 id */
export const AMMO_ITEM: Record<AmmoId, string> = {
  '9mm': 'ammo_9mm',
  '45': 'ammo_45',
  magnum: 'ammo_magnum',
  '12g': 'ammo_12g',
  '556': 'ammo_556',
  '762': 'ammo_762',
};

export const AMMO_NAME: Record<AmmoId, string> = {
  '9mm': '9 毫米手枪弹',
  '45': '.45 手枪弹',
  magnum: '马格南弹',
  '12g': '12 号霰弹',
  '556': '5.56 步枪弹',
  '762': '7.62 步枪弹',
};

export interface GunInfo {
  /** = public/tacz/<id>/ */
  id: string;
  name: string;
  cls: GunClass;
  ammo: AmmoId;
  /** 稀有度：1 民宅里偶尔有 · 2 少见 · 3 检查站 / 军事基地 · 4 只在军事基地深处 */
  tier: 1 | 2 | 3 | 4;
}

/** 开放世界里能找到的枪（用户要求：每类两到四把，枪是稀缺资源） */
export const GUN_LIST: readonly GunInfo[] = [
  { id: 'glock_17', name: '格洛克 17', cls: 'pistol', ammo: '9mm', tier: 1 },
  { id: 'm1911', name: 'M1911', cls: 'pistol', ammo: '45', tier: 1 },
  { id: 'rhino357', name: '犀牛 .357 左轮', cls: 'pistol', ammo: 'magnum', tier: 2 },
  { id: 'deagle', name: '沙漠之鹰', cls: 'pistol', ammo: 'magnum', tier: 3 },
  { id: 'uzi', name: '乌兹', cls: 'smg', ammo: '9mm', tier: 2 },
  { id: 'hk_mp5a5', name: 'MP5A5', cls: 'smg', ammo: '9mm', tier: 3 },
  { id: 'ump45', name: 'UMP45', cls: 'smg', ammo: '45', tier: 3 },
  { id: 'db_short', name: '短管双管猎枪', cls: 'shotgun', ammo: '12g', tier: 1 },
  { id: 'm870', name: 'M870', cls: 'shotgun', ammo: '12g', tier: 2 },
  { id: 'm1014', name: 'M1014', cls: 'shotgun', ammo: '12g', tier: 4 },
  { id: 'sks_tactical', name: 'SKS', cls: 'rifle', ammo: '762', tier: 2 },
  { id: 'ak47', name: 'AKM', cls: 'rifle', ammo: '762', tier: 3 },
  { id: 'm4a1', name: 'M4A1', cls: 'rifle', ammo: '556', tier: 3 },
  { id: 'scar_h', name: 'SCAR-H', cls: 'rifle', ammo: '762', tier: 4 },
  { id: 'kar98', name: 'Kar98k', cls: 'sniper', ammo: '762', tier: 2 },
  { id: 'svd', name: 'SVD', cls: 'sniper', ammo: '762', tier: 4 },
  { id: 'rpk', name: 'RPK', cls: 'lmg', ammo: '762', tier: 4 },
  { id: 'm249', name: 'M249', cls: 'lmg', ammo: '556', tier: 4 },
];

/** 近战武器（props 里有模型）。空手 = 拳头，不在表里 */
export type MeleeId = 'bat' | 'crowbar' | 'hatchet' | 'machete' | 'sledge';
export const MELEE_LIST: ReadonlyArray<{ id: MeleeId; name: string; model: string }> = [
  { id: 'bat', name: '棒球棍', model: 'baseball_bat' },
  { id: 'crowbar', name: '撬棍', model: 'crowbar_01' },
  { id: 'hatchet', name: '手斧', model: 'hatchet' },
  { id: 'machete', name: '砍刀', model: 'machete' },
  { id: 'sledge', name: '大锤', model: 'sledgehammer_01' },
];

// ---------------------------------------------------------------- 车：只有一辆皮卡，能放东西、能改装（用户 2026-11-14）

/** 改装件：在世界里找到（物品 id = `part_<id>`），站在车旁边装上去，车上能看到对应的模型 */
export type CarPartId = 'bullbar' | 'roofrack' | 'auxtank' | 'lightbar' | 'tires' | 'armor';

export const CAR_PARTS: ReadonlyArray<{ id: CarPartId; name: string; desc: string }> = [
  { id: 'bullbar', name: '防撞杠', desc: '撞丧尸更狠，车几乎不减速' },
  { id: 'roofrack', name: '车顶行李架', desc: '车上能多放 40 千克' },
  { id: 'auxtank', name: '副油箱', desc: '油箱多装 30 升' },
  { id: 'lightbar', name: '车顶射灯', desc: '夜里照得更宽更远' },
  { id: 'tires', name: '越野胎', desc: '泥地、草地、雪地上不打滑' },
  { id: 'armor', name: '车窗护网', desc: '坐在车里时丧尸很难伤到你' },
];

/**
 * 那辆车现在的状态（和 render/wx.ts 一样是共享对象：车辆模块写，别的模块读）。
 *   parts          装了哪些改装件
 *   cargoCapacity  车上能放多重（千克）：基础 60，行李架 +40。车上放了什么由玩法层管（game.trunk）
 *   armor          人在车里时丧尸的伤害乘多少（没装护网 1，装了 0.3）
 *   ram            撞丧尸的伤害倍率（没装防撞杠 1，装了 1.6）
 *   onRam          丧尸模块在车撞到一只丧尸时调：车辆模块在这里让车减速（speed = 撞上时的车速 米/秒，kg = 丧尸多重）
 */
export const CAR: { parts: Set<CarPartId>; cargoCapacity: number; armor: number; ram: number; onRam: (speed: number, kg: number) => void } = {
  parts: new Set<CarPartId>(),
  cargoCapacity: 60,
  armor: 1,
  ram: 1,
  onRam: () => {},
};

// ---------------------------------------------------------------- 背包、生存状态（game/ 里实现）

export interface BagApi {
  count(item: string): number;
  /** 放进去 n 个，返回实际放进去几个（超重放不下） */
  add(item: string, n?: number): number;
  /** 拿走最多 n 个，返回实际拿走几个 */
  take(item: string, n?: number): number;
}

/** 一个能交互的东西：界面上显示「[键] 文字」，按一下（或者按住 hold 秒）以后执行 act */
export interface Interaction {
  /** E = 主要动作（捡东西、上下车），F = 第二动作（加油、装改装件），Tab = 只是提示（打开背包 / 车厢） */
  key: 'KeyE' | 'KeyF' | 'Tab';
  /** 文字的颜色：1 好东西（蓝），2 稀有（金） */
  tone?: number;
  label: string;
  /** 要按住多少秒（不给 = 按一下就执行） */
  hold?: number;
  /** 同一个键同时有好几个时取最大的（捡东西 10，上下车 5，默认 0） */
  prio?: number;
  act(): void;
}

export interface SurvivalApi {
  /** 生命 0–100 */
  hp: number;
  readonly dead: boolean;
  /** 体力 0–1（跑步、近战会消耗，停下来恢复） */
  stamina: number;
  /** 受伤。from = 伤害来的方向（世界坐标，用来画受击方向），cause 用在死亡画面上 */
  hurt(amount: number, fromX?: number, fromZ?: number, cause?: string): void;
  /** 消耗体力；不够返回 false（不扣） */
  spend(stamina: number): boolean;
}

// ---------------------------------------------------------------- 天气（weather.ts）

export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow';

export interface WeatherApi {
  readonly kind: WeatherKind;
  /** 现在的雨 / 雪有多大 0–1（平滑过渡以后的值） */
  readonly rain: number;
  readonly snow: number;
  /** 地面有多湿 / 积雪多厚 0–1（下完以后慢慢干、慢慢化） */
  readonly wet: number;
  readonly cover: number;
  /** 气温（℃），已经算上昼夜和天气 */
  readonly temp: number;
  /** 风 0–1 */
  readonly wind: number;
  /** 界面上显示的文字：「小雨 6℃」 */
  label(): string;
  update(dt: number): void;
  /** 调试 / 存档恢复：直接换天气（snap = 不过渡） */
  set(kind: WeatherKind, snap?: boolean): void;
  /** 画质档位：粒子密度 0–1 */
  setQuality(k: number): void;
}

// ---------------------------------------------------------------- 丧尸（combat/horde.ts）

export interface ZombieHit {
  id: number;
  dist: number;
  head: boolean;
  x: number;
  y: number;
  z: number;
}

/** 丧尸的种类。mother = 生化模式的母体（血很厚、跑得快），平时不出现 */
export type ZombieKindId = 'walker' | 'runner' | 'crawler' | 'bloater' | 'armored' | 'mother';

/** 一只丧尸在哪（带枪的人找目标用） */
export interface ZombieRef {
  id: number;
  x: number;
  /** 脚底的高度 */
  y: number;
  z: number;
  /** 头离脚底多高（爬行者很矮） */
  h: number;
  /** 正在追谁：0 = 玩家，> 0 = 那个 Prey 的 id，-1 = 没在追 */
  after: number;
}

/**
 * 玩家以外、也会被丧尸追和打的东西：带枪的人、守城时的发电机。
 * 对象由登记的那个模块持有，位置原地改；丧尸模块每帧读，打中了调 bitten。
 */
export interface Prey {
  /** 正整数，登记的人自己保证不重复（带枪的人 1–9999，别的从 10000 起） */
  readonly id: number;
  x: number;
  z: number;
  /** 脚底的高度 */
  feet: number;
  /** false = 死了 / 撤了，丧尸不再追（登记的人记得 removePrey） */
  alive: boolean;
  /** 身体的半径和高（米）。发电机这种不会动的也按圆柱算 */
  radius: number;
  height: number;
  /** 被丧尸打中一下。from = 丧尸在哪 */
  bitten(amount: number, fromX: number, fromZ: number): void;
}

export interface HordeApi {
  /** 现在活着的丧尸数 */
  readonly count: number;
  /** 平时按坑位自动刷新、夜里游荡的开关（守城时不再新刷，生化模式整局关着）。默认 true；关掉以后已经在场的不动 */
  ambient: boolean;
  /** 丧尸不理玩家：看见了不追、不打、不挤（生化模式里玩家自己变成丧尸以后）。Prey 照追。默认 false */
  passive: boolean;
  /** 被贴身围住的程度 0–1（一只约 0.34，三只以上 = 1）：玩法层按它让人走不快，不能从尸群里直接跑过去 */
  readonly grip: number;
  update(dt: number): void;
  /** 射线（方向已归一化）打到的最近的丧尸，没有返回 null。只管丧尸，墙挡不挡由调用方用 world.raycast 比较距离 */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): ZombieHit | null;
  /**
   * 造成伤害。(dx, dz) = 子弹 / 挥击的水平方向（击退、倒地方向用）。返回这一下是不是打死了。
   * byPlayer = 是玩家打的（默认 true）；别人打死的在 kill 事件里 byPlayer = false，玩家不拿经验
   */
  damage(id: number, amount: number, head: boolean, dx: number, dz: number, byPlayer?: boolean): boolean;
  /** 爆炸：(x, y, z) 周围 radius 米内的丧尸按距离衰减受伤，中间有墙挡着的不算。返回伤到几只 */
  blast(x: number, y: number, z: number, radius: number, damage: number, byPlayer?: boolean): number;
  /** (x, z) 周围 r 米内活着的丧尸，从近到远填进 out（out 里的对象会被复用、不够就新建），返回个数 */
  near(x: number, z: number, r: number, out: ZombieRef[]): number;
  /** 登记 / 撤掉一个会被丧尸追的东西 */
  addPrey(p: Prey): void;
  removePrey(p: Prey): void;
  /**
   * 在 (x, z) 放一只（守城的一波、被感染的人变的）。
   *   hunt   0 = 一出来就知道玩家在哪、一直追到底，不会跟丢；> 0 = 追这个 id 的 Prey（它没了就改成 'near'）；
   *          'near' = 追最近的活人（玩家或者 Prey），这个没了换下一个；不给 = 和平时的一样自己看、自己听
   *   tag    给这一批起的编号（> 0），之后用 countTag / clearTag 管
   *   hp     生命改成这么多（不给 = 这一种本来的）；speedMul = 追人的速度乘多少（不给 = 1）
   * 返回丧尸 id；放不下（满了、模型池空了）返回 -1。带 tag 的不占平时的上限，但总数还是有硬上限
   */
  spawnAt(kind: ZombieKindId, x: number, z: number, opts?: { hunt?: number | 'near'; tag?: number; yaw?: number; hp?: number; speedMul?: number }): number;
  /** 在 (cx, cz) 周围 rMin–rMax 米找一个站得住、玩家现在看不见的点（一波丧尸从哪冒出来）。找不到返回 false */
  spotAround(cx: number, cz: number, rMin: number, rMax: number, out: { x: number; z: number }): boolean;
  /** 带这个 tag 的还活着几只 */
  countTag(tag: number): number;
  /** 把带这个 tag 的全撤掉（不算打死、不掉东西、不给经验） */
  clearTag(tag: number): void;
  /** 近战：(x, z) 朝 yaw 方向、reach 米、左右各 arc 弧度的扇形里的丧尸各受 amount 伤害。返回打中几只 */
  melee(x: number, z: number, yaw: number, reach: number, arc: number, amount: number): number;
  /** 声音：这个半径里的丧尸会被引过来（枪声、喇叭、引擎） */
  noise(x: number, z: number, radius: number): void;
  /** 画质档位：同时有多少只、多远以内有动画 0–1 */
  setQuality(k: number): void;
  /** 存档：哪些地方的丧尸打死了、还要空多久（load(null) = 全都还在） */
  save(): unknown;
  load(data: unknown): void;
}

// ---------------------------------------------------------------- 带枪的人（combat/raiders.ts）

/** raider = 敌人，见了玩家和玩家的同伴就打；ally = 玩家这边的（生化模式里一起守的幸存者），不打玩家 */
export type HumanSide = 'raider' | 'ally';

export interface HumanSpawn {
  x: number;
  z: number;
  yaw?: number;
  side: HumanSide;
  /** 拿哪把枪（GUN_LIST 里的 id）；不给 = 按 level 挑 */
  gun?: string;
  /** 1–5：枪有多好、打得多准、反应多快（平时按地点的危险等级） */
  level?: number;
  /** 一伙的编号（> 0）：同一伙的互相通报看见了什么 */
  squad?: number;
  name?: string;
  /** 给这一批起的编号（> 0）：带 tag 的不会被自动撤掉、不进存档 */
  tag?: number;
  /** 活动范围：不走出这个圈（生化模式的场地） */
  leash?: { x: number; z: number; r: number };
  /** 一出来就往这里去（听见动静过来看的那一伙） */
  goto?: { x: number; z: number };
  /** 死了掉不掉东西（枪、子弹、补给）。默认掉；生化模式里的同伴不掉 */
  loot?: boolean;
  /** 子弹打不完（生化模式）。默认 false：平时的人子弹有限，打光了会跑 / 换手枪 */
  freeAmmo?: boolean;
}

export interface HumanRef {
  id: number;
  x: number;
  z: number;
  feet: number;
  side: HumanSide;
  hp: number;
  alive: boolean;
  name: string;
  gun: string;
  tag: number;
}

export interface RaidersApi {
  /** 现在活着几个 */
  readonly count: number;
  /** 平时按地点自动出现的开关（生化模式里关着）。默认 true */
  ambient: boolean;
  update(dt: number): void;
  /** 射线打到的最近的人（和 HordeApi.raycast 一样的约定） */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): ZombieHit | null;
  /** 造成伤害，返回是不是打死了。byPlayer 默认 true：被玩家打的人会记仇、同伙会知道 */
  damage(id: number, amount: number, head: boolean, dx: number, dz: number, byPlayer?: boolean): boolean;
  melee(x: number, z: number, yaw: number, reach: number, arc: number, amount: number): number;
  blast(x: number, y: number, z: number, radius: number, damage: number, byPlayer?: boolean): number;
  /** 动静（玩家的枪声、车）：听得见的会警觉，过来看或者躲起来 */
  noise(x: number, z: number, radius: number): void;
  /** 放一个人，返回 id；放不下返回 -1 */
  spawn(o: HumanSpawn): number;
  /** 撤掉一个（不算打死、不掉东西） */
  remove(id: number): void;
  /** 把带这个 tag 的全撤掉 */
  clearTag(tag: number): void;
  /** 把带这个 tag 的全改成这个阵营（生化模式：玩家变成丧尸以后，原来的同伴开始打玩家） */
  setSide(tag: number, side: HumanSide): void;
  /** 活着的人填进 out（对象复用），返回个数 */
  list(out: HumanRef[]): number;
  /**
   * 有人被丧尸打中了。返回 true = 调用方已经处理（生化模式：被咬就是感染，由它把人撤掉、在原地放一只丧尸），不要再扣血。
   * 不设 = 照常扣血
   */
  onBitten: ((h: HumanRef, amount: number) => boolean) | null;
  setQuality(k: number): void;
  save(): unknown;
  load(data: unknown): void;
}

// ---------------------------------------------------------------- 打（game/combat.ts）：玩家的子弹、近战、手雷打到谁

export interface Hit extends ZombieHit {
  who: 'zombie' | 'human';
}

/** 丧尸和人合在一起的入口。武器模块只用这个，不直接找 horde / raiders */
export interface CombatApi {
  /** 射线上最近的丧尸或者人（墙挡不挡由调用方用 world.raycast 比较距离） */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): Hit | null;
  /** 玩家打的。返回是不是打死了 */
  damage(hit: Hit, amount: number, dx: number, dz: number): boolean;
  melee(x: number, z: number, yaw: number, reach: number, arc: number, amount: number): number;
  /** 玩家的手雷：丧尸、人、玩家自己都按距离受伤。返回伤到几个（不算玩家自己） */
  blast(x: number, y: number, z: number, radius: number, damage: number): number;
  /** 玩家弄出来的动静：丧尸过来看，带枪的人警觉 */
  noise(x: number, z: number, radius: number): void;
}

// ---------------------------------------------------------------- 特效（武器模块的 fx-pool.ts；带枪的人开枪也用它画）

export interface FxApi {
  /** 弹着点（kind = world.hitKind） */
  impact(kind: HitKind, x: number, y: number, z: number, dx: number, dy: number, dz: number, k?: number): void;
  blood(x: number, y: number, z: number, dx: number, dy: number, dz: number, k?: number): void;
  /** 曳光：从 s 到 e */
  tracer(sx: number, sy: number, sz: number, ex: number, ey: number, ez: number, gain?: number): void;
  /** 爆炸的火光和烟 */
  blast(x: number, y: number, z: number, radius: number): void;
}

// ---------------------------------------------------------------- 武器（combat/arsenal.ts）

export interface HeldGun {
  id: string;
  /** 弹匣里还有几发 */
  loaded: number;
  /**
   * 借来的（守城时从据点的军械箱里借的）：丢不掉（按 G 只提示一句）、死了不掉在地上、不进存档，
   * returnLoans() 的时候收走。借来的枪换弹不用背包里的子弹
   */
  loan?: boolean;
}

export interface ArsenalInput {
  fire: boolean;
  ads: boolean;
  /** 现在能不能用武器（没在开车、没开背包 / 地图、没死） */
  active: boolean;
}

export interface ArsenalApi {
  /** 鼠标灵敏度倍率（开镜时小于 1） */
  readonly lookScale: number;
  /** 换弹不用背包里的子弹（守城时据点的弹药箱、生化模式）。默认 false */
  freeAmmo: boolean;
  /** 生化模式里玩家变成了丧尸：只能空手，拳头换成爪子（伤害 ×6、够得更远、不耗体力），枪和近战武器拿不出来、东西也用不了。默认 false */
  claws: boolean;
  /** 曳光、弹着点、血雾、爆炸（带枪的人开枪也画在这里） */
  readonly fx: FxApi;
  /** 别人在 (x, y, z) 开了一枪：放这把枪的枪声（按离玩家多远变小、变闷，分左右） */
  shotAt(gunId: string, x: number, y: number, z: number): void;
  /** 两个枪位里现在是什么（界面显示用） */
  held(): ReadonlyArray<HeldGun | null>;
  /** 正在用东西（打针、吃、包扎）：这期间不能开枪、不能换弹 */
  readonly using: boolean;
  /**
   * 用一样东西（item = game/items.ts 的物品 id）：手上的武器放下，播 seconds 秒的动作（有专门的手部模型就用，没有就只是把手放下去），
   * 播完调 done（玩法层在那时才把东西用掉、生效）。中途被打断（死了、上车、切武器）就不调 done。
   * 返回 false = 现在用不了（正在用别的、正在换弹），什么都不会发生
   */
  use(item: string, seconds: number, done: () => void): boolean;
  /**
   * 手雷：按键归武器模块管（Q：拔销、扔出去），数量在背包里（物品 id = 'grenade'，用 ctx.bag.count / take）。
   * 落地弹跳、引信到了以后用 ctx.combat.blast 算伤害。这里只是让别的模块（带枪的人）也能扔一颗：
   * 从 (x, y, z) 以 (vx, vy, vz) 米/秒扔出去，fuse 秒后炸。byPlayer = 是不是玩家扔的（经验、仇恨算谁的）
   */
  throwGrenade(x: number, y: number, z: number, vx: number, vy: number, vz: number, fuse: number, byPlayer: boolean): void;
  /** 手上是不是拿着东西（枪或者近战武器；空手 = false） */
  readonly armed: boolean;
  /** 每帧，在摆相机之前：开火、换弹、切枪。后坐力直接改 ctx.player 的 yaw / pitch */
  update(dt: number, inp: ArsenalInput): void;
  /** 每帧，主相机摆好以后：摆视角模型、开镜的视野、镜头晃动。inCar = 在开车（视角模型藏起来） */
  view(camera: PerspectiveCamera, dt: number, inCar: boolean): void;
  /** 按键（KeyR、Digit1…、KeyG 这类）。返回 true = 这个键归武器模块，别的模块不要再处理 */
  key(code: string): boolean;
  /** 滚轮切枪：dir = 1 下一把，-1 上一把 */
  wheel(dir: number): void;
  /** 捡到一把枪：放进空槽，没有空槽就换掉手上那把（返回被换下来的，调用方把它丢在地上） */
  giveGun(gun: HeldGun): HeldGun | null;
  giveMelee(id: MeleeId): MeleeId | null;
  /** 死了：把手上的武器全丢在脚下（用 ctx.drop），回到空手 */
  strip(): void;
  /** 把借来的枪（loan）都收走；手上正拿着的话换成另一把或者空手 */
  returnLoans(): void;
  /** 存档（load(null) = 空手重新开始） */
  save(): unknown;
  load(data: unknown): void;
}

// ---------------------------------------------------------------- 模块拿到的环境

/**
 * kill：byPlayer 不给 = 是玩家打死的；human = 死的是带枪的人（kind = 他的阵营）。
 * shot：玩家开了一枪。
 */
export type GameEvent = { type: 'kill'; kind: string; x: number; z: number; head: boolean; byPlayer?: boolean; human?: boolean } | { type: 'shot'; x: number; z: number; loud: number };

/** survival = 生存世界；bio = 生化模式（单独一局：没有饿渴冷、不读写生存世界的存档） */
export type GameMode = 'survival' | 'bio';

export interface GameCtx {
  world: World;
  player: Player;
  camera: PerspectiveCamera;
  scene: Scene;
  renderer: WebGLRenderer;
  lighting: Lighting;
  post: PostFX;
  sky: Sky;
  clock: DayCycle;
  quality: QualityControl;
  garage: Garage;
  keys: ReadonlySet<string>;
  params: URLSearchParams;
  mode: GameMode;
  bag: BagApi;
  survival: SurvivalApi;
  /** 下面几个模块互相要用的话从这里拿（都建好以后才齐，构造函数里别用，等到 update 再用） */
  weather: WeatherApi;
  horde: HordeApi;
  arsenal: ArsenalApi;
  raiders: RaidersApi;
  /** 玩家的子弹、近战、手雷打谁：丧尸和人合在一起的入口 */
  combat: CombatApi;
  /**
   * 把东西丢在地上（变成能捡的东西）。item = 物品 id：枪是 `gun_<枪 id>`，近战武器是 `melee_<id>`，弹药见 AMMO_ITEM，其余见 game/items.ts。
   * loaded = 丢的是枪时弹匣里还剩几发（再捡起来还是这么多）；(x, z) 不给 = 玩家脚下（丧尸掉东西时给丧尸的位置）
   */
  drop(item: string, n?: number, loaded?: number, x?: number, z?: number): void;
  /** 屏幕中下方的一行提示，几秒后消失 */
  toast(text: string, seconds?: number): void;
  /** 发生了什么（打死丧尸、开枪）：经验、统计用 */
  emit(ev: GameEvent): void;
  /** 玩家头顶有没有屋顶（每秒查几次，有缓存） */
  indoors(): boolean;
}
