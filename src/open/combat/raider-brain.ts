import { Rng } from '../../game/core/rng';
import type { HumanSide, ZombieHit, ZombieRef } from '../game/api';
import type { Plant } from '../world/chunkgen';
import type { Door, Interior } from '../world/sites';
import { WATER } from '../world/terrain';
import type { HitKind, World } from '../world/world';
import { falloff, type GunSpec } from './gun-data';
import { Nav, type SiteNav } from './zombie-nav';

/**
 * 带枪的人的行为（纯逻辑，不碰 three：.logs/open/raidtest.ts 不开浏览器直接跑它）。参考 8v8 对战的人机（src/game/systems/tdm.ts）。
 *
 * 像真人靠这几件事：
 *   - 看：正面 ±80° 的视野、要有视线、夜里看得近；每秒只「看」十次，每帧的视线检查有上限；
 *   - 反应：发现新目标以后要过 0.45–1.1 秒（按等级）才开第一枪，目标在背后更慢；
 *   - 瞄：枪口的偏差刚发现时很大，盯着才慢慢收拢；手一直在晃（等级越低晃得越厉害）；跟不上横着跑的目标；连射时枪口往上跳；
 *   - 打：2–6 发一个点射、点射之间停一下；弹匣、换弹时间是那把枪自己的；子弹是真的射线，打偏了就打在墙上、地上；
 *   - 记：看不见了去最后看见的地方找，12 秒没有动静才算跟丢；同一伙的互相通报；听见枪声会警觉，派一两个过去看；
 *   - 动：交火时横移、蹲下；换弹、挨打、残血时躲到对方看不见的地方；残血躲好以后包扎；一伙里有一个绕到侧面；子弹打光了就跑。
 *
 * 状态：idle 站着 / walk 走去下一个地方 / alert 听见动静原地戒备 / search 去看动静、去最后看见的地方 / look 到了以后张望
 *       / fight 交火 / cover 躲 / heal 包扎 / flee 没子弹了跑 / dead。
 */

export type HMode = 'idle' | 'walk' | 'alert' | 'search' | 'look' | 'fight' | 'cover' | 'heal' | 'flee' | 'dead';

/** 平时搜刮的一个地方（一栋房子）：门外的点，和屋里能站的几个格子（x, z 交替） */
export interface Poi {
  x: number;
  z: number;
  cells: number[];
}

/** 一伙人：共用「最后在哪看见 / 听见」 */
export interface Squad {
  id: number;
  members: Human[];
  /** 最后一次有人看见敌人：在哪、什么时候（brain 的钟）、是谁（1 玩家，2 人） */
  lkx: number;
  lkz: number;
  lkT: number;
  lkKind: number;
  /** 平时搜到第几栋房子了、什么时候换下一栋 */
  focus: number;
  focusT: number;
  /** 这次交火谁去绕（Human.id，0 = 还没定） */
  flanker: number;
  contactT: number;
}

export interface Human {
  id: number;
  side: HumanSide;
  name: string;
  /** 1–5 */
  level: number;
  /** 0.7–1.5：反应、转枪口、收拢的快慢 */
  skill: number;
  seed: number;
  sq: Squad;
  tag: number;
  /** 平时自动出现的那一伙的编号和在里面排第几（spawn() 放的是 0 / 0） */
  group: number;
  member: number;
  loot: boolean;
  freeAmmo: boolean;
  helmet: boolean;
  /** 军装（基地、检查站的人） */
  mil: boolean;
  gun: string;
  spec: GunSpec;
  alive: boolean;
  hp: number;
  x: number;
  /** 脚底的高度 */
  y: number;
  z: number;
  /** 身体的朝向；枪口（视线）的朝向和俯仰 */
  yaw: number;
  aimYaw: number;
  aimPitch: number;
  vx: number;
  vz: number;
  /** 实际走出来的速度（平滑过） */
  sp: number;
  gnd: number;
  top: number;
  topX: number;
  topZ: number;
  crouch: boolean;
  /** 蹲下的程度 0–1（平滑过：命中体积、动作都用它） */
  ck: number;
  walkPhase: number;
  // ---- 枪
  mag: number;
  /** 身上还有多少发（不算弹匣里的） */
  ammo: number;
  reloadT: number;
  fireT: number;
  /** 这个点射打了几发、打算打几发 */
  burst: number;
  burstN: number;
  sinceShot: number;
  shots: number;
  /** 对着最后看见的地方压制还能打几个点射 */
  supp: number;
  // ---- 感知
  think: number;
  scanT: number;
  zedT: number;
  /** 离玩家多远 */
  dist: number;
  /** 目标：0 没有，1 玩家，2 人（tid = Human.id），3 丧尸（tid = 丧尸 id） */
  tk: number;
  tid: number;
  /** 丧尸目标的位置（脚底）和头的高度 */
  zx: number;
  zy: number;
  zz: number;
  zh: number;
  /** 多久没看见目标了 */
  seen: number;
  /** 发现目标以后还要多久才开第一枪 */
  react: number;
  errYaw: number;
  errPitch: number;
  /** 枪口正跟着的那个点：慢慢追目标现在的位置（横着跑的人会被落下一截，来回晃的人枪口停在中间） */
  tax: number;
  taz: number;
  /** 盯了这个目标多久（越久手越稳） */
  track: number;
  /** 枪口离目标的真实方向差多少弧度 */
  off: number;
  headAim: boolean;
  /** 最后知道敌人在哪（自己看见的、同伙告诉的、挨打猜的）和时间 */
  lkx: number;
  lkz: number;
  lkT: number;
  /** 警觉还剩多久；听见的动静在哪；是不是派去看的那个 */
  alertT: number;
  heardX: number;
  heardZ: number;
  scout: boolean;
  sinceHurt: number;
  /** 受击的抖动 1 → 0 */
  flinch: number;
  /** 刚被车撞过：到这个时刻（raiders.ts 的钟）以前不再算撞 */
  carT: number;
  // ---- 打算
  mode: HMode;
  /** 进入现在这个状态多久了；这个状态还要保持多久 */
  t: number;
  modeT: number;
  coverT: number;
  /** 躲好以后要包扎 */
  wantHeal: boolean;
  heals: number;
  strafe: number;
  strafeT: number;
  /** 绕侧面：0 不绕，1 正在绕，2 绕到了 */
  flank: number;
  /** 要去的地方、用多快的速度（0 = 没有要去的地方） */
  goalX: number;
  goalZ: number;
  speed: number;
  idleT: number;
  lookYaw: number;
  lookT: number;
  // ---- 找路
  grid: SiteNav | null;
  /** 0 = 还没定，1 = 直着走，2 = 跟着路点走 */
  nmode: number;
  path: number[];
  wp: number;
  full: boolean;
  navT: number;
  gx: number;
  gz: number;
  noDoor: number;
  stuck: number;
  bias: number;
  biasT: number;
  jx: number;
  jz: number;
  jam: number;
  // ---- 平时
  hx: number;
  hz: number;
  leash: { x: number; z: number; r: number } | null;
  pois: Poi[] | null;
  /** 站岗的那个（不进屋搜） */
  watch: boolean;
  /** 一出来先去的地方 */
  hasGoto: boolean;
  gotoX: number;
  gotoZ: number;
  // ---- 死
  head: boolean;
  byPlayer: boolean;
  killDx: number;
  killDz: number;
  /** 打死他的那一下有多猛（倒地动画用：子弹 1.3，爆炸 3 以上会飞出去） */
  killPush: number;
  /** 渲染层、丧尸模块的猎物对象挂在这里 */
  view: unknown;
  prey: unknown;
}

export type HEvent = 'die' | 'hurt' | 'spot' | 'reload' | 'heal';

export interface RaidEnv {
  world: World;
  player: { x: number; z: number; feet: number; eye: number; crouch: number; vx: number; vz: number; sprinting: boolean };
  playerDead(): boolean;
  /** 玩家是不是坐在车里（伤害减半，隔着车壳也算打得到） */
  driving(): boolean;
  /** 0 白天 … 1 深夜 */
  night(): number;
  hurtPlayer(amount: number, fromX: number, fromZ: number): void;
  /** 附近的丧尸（从近到远），返回个数 */
  zombiesNear(x: number, z: number, r: number, out: ZombieRef[]): number;
  /** 子弹这条射线上最近的丧尸 */
  zombieRay(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): ZombieHit | null;
  hitZombie(id: number, amount: number, head: boolean, dx: number, dz: number): void;
  /** 开了一枪：枪声、枪口的火光、把丧尸引过来 */
  shot(h: Human): void;
  tracer(sx: number, sy: number, sz: number, ex: number, ey: number, ez: number, gain: number): void;
  impact(kind: HitKind, x: number, y: number, z: number, dx: number, dy: number, dz: number, k: number): void;
  blood(x: number, y: number, z: number, dx: number, dy: number, dz: number): void;
  on(ev: HEvent, h: Human): void;
  /** 附近有没有车（车是会动的碰撞体，不在位图里）。不给 = 没有 */
  carNear?(x: number, z: number): boolean;
}

export interface SpawnOpts {
  x: number;
  z: number;
  yaw?: number;
  side: HumanSide;
  gun: string;
  spec: GunSpec;
  level: number;
  squad: number;
  name: string;
  tag?: number;
  group?: number;
  member?: number;
  loot?: boolean;
  freeAmmo?: boolean;
  mil?: boolean;
  leash?: { x: number; z: number; r: number } | null;
  goto?: { x: number; z: number } | null;
  pois?: Poi[] | null;
  watch?: boolean;
  /** 身上带几个弹匣的子弹（不给 = 按等级 2–4 个） */
  mags?: number;
}

// ---------------------------------------------------------------- 数值

export const HUMAN_HP = 100;
const RADIUS = 0.3;
const PLAYER_R = 0.34;
/** 走、小跑（交火时挪位置）、跑（找掩体、逃） */
const WALK = 1.4;
const JOG = 2.9;
const RUN = 4.6;
/** 白天能看多远；夜里减半 */
const SIGHT = 70;
const CONE = Math.cos((80 * Math.PI) / 180);
const CONE_ALERT = Math.cos((115 * Math.PI) / 180);
/** 多久没有动静算跟丢；正在往最后看见的地方赶的最多再给这么久（走到了、张望完了才算完） */
const LOSE = 12;
const LOSE_MAX = 28;
/** 下面几张表按等级取（下标 1–5）。反应时间是平均值，每次 ±12% */
const REACT = [1.1, 1.1, 0.95, 0.8, 0.62, 0.45];
/** 手晃的幅度（弧度）：30 米外人的半宽是 0.01 弧度 */
const WOBBLE = [0.0125, 0.0125, 0.0105, 0.0085, 0.0062, 0.004];
/** 跟枪慢多少秒：瞄的是目标这么久以前的位置（横着跑的人打不中，站着不动的才好打） */
const LAG = [0.26, 0.26, 0.22, 0.18, 0.14, 0.11];
/** 换弹 / 挨打时去找掩体的可能 */
const COVER_P = [0.4, 0.4, 0.55, 0.7, 0.85, 0.95];
/** 打人、打丧尸时瞄头的可能（打玩家不分头和身子） */
const HEAD_AIM = [0, 0, 0.05, 0.12, 0.22, 0.35];
/**
 * 打在玩家身上的伤害倍率（按主游戏的枪类）。玩家只有 100 血、常常只有一把手枪：
 * 栓动 / 半自动大口径（单发 78–162）照原样一枪就死，这里压到一枪三四十；每发还有上限 CAP
 */
const VS_PLAYER: Record<string, number> = { pistol: 1.25, smg: 1.3, shotgun: 0.8, rifle: 0.88, sniper: 0.45, lmg: 1 };
const CAP = 46;
/** 霰弹一枪（所有弹丸加起来）最多打掉玩家多少血：双管猎枪贴脸连着两枪也剩一口气，来得及跑 */
const CAP_SHELL = 45;
/** 玩家身上距离衰减最低到多少（手枪 30 米外还剩六成的话几乎不疼） */
const FALLOFF_MIN = 0.8;
const HEAD_MULT = 2.5;
const HELMET_MULT = 1.6;
/** 一帧里最多做多少次视线检查（找掩体的也算在里面；子弹不算） */
const RAY_BUDGET = 10;
/** 一帧里找路最多展开多少格 */
const NAV_BUDGET = 1200;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

const P = { x: 0, z: 0 };
const T = { x: 0, y: 0, z: 0, ah: 1.15 };
const plants: Plant[] = [];
const VIA: number[] = [];
const LEG: number[] = [];
const TMP: number[] = [];
const zrefs: ZombieRef[] = [];
const VOL = new Float32Array(6);
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

function angDiff(a: number, b: number): number {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
}

/** 射线和球：返回进入球的距离（起点就在球里返回 0），没打到返回 -1 */
export function raySphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cy: number, cz: number, r: number): number {
  const lx = ox - cx;
  const ly = oy - cy;
  const lz = oz - cz;
  const b = lx * dx + ly * dy + lz * dz;
  const c = lx * lx + ly * ly + lz * lz - r * r;
  if (c <= 0) return 0;
  if (b > 0) return -1;
  const h = b * b - c;
  return h < 0 ? -1 : -b - Math.sqrt(h);
}

/** 射线和胶囊（a → b 的线段，半径 r）：返回距离，没打到返回 -1 */
export function rayCapsule(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number): number {
  const bax = bx - ax;
  const bay = by - ay;
  const baz = bz - az;
  const baba = bax * bax + bay * bay + baz * baz;
  if (baba < 1e-6) return raySphere(ox, oy, oz, dx, dy, dz, ax, ay, az, r);
  const oax = ox - ax;
  const oay = oy - ay;
  const oaz = oz - az;
  const bard = bax * dx + bay * dy + baz * dz;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = dx * oax + dy * oay + dz * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  const t0 = Math.max(0, Math.min(1, baoa / baba));
  if (oaoa - 2 * t0 * baoa + t0 * t0 * baba < r * r) return 0;
  const a = baba - bard * bard;
  if (a < 1e-9) {
    const t1 = raySphere(ox, oy, oz, dx, dy, dz, ax, ay, az, r);
    const t2 = raySphere(ox, oy, oz, dx, dy, dz, bx, by, bz, r);
    return t1 < 0 ? t2 : t2 < 0 ? t1 : Math.min(t1, t2);
  }
  const b = baba * rdoa - baoa * bard;
  const c = baba * oaoa - baoa * baoa - r * r * baba;
  const h = b * b - a * c;
  if (h < 0) return -1;
  const t = (-b - Math.sqrt(h)) / a;
  const y = baoa + t * bard;
  if (y > 0 && y < baba) return t >= 0 ? t : -1;
  return y <= 0 ? raySphere(ox, oy, oz, dx, dy, dz, ax, ay, az, r) : raySphere(ox, oy, oz, dx, dy, dz, bx, by, bz, r);
}

/** 这栋房子的哪扇门最顺路：enter = 从外面进去，否则是从里面出来 */
function pickDoor(h: Interior, sx: number, sz: number, gx: number, gz: number, enter: boolean): Door | null {
  let best: Door | null = null;
  let bd = Infinity;
  for (const d of h.doors) {
    const c = enter ? Math.hypot(d.ox - sx, d.oz - sz) + Math.hypot(d.x - gx, d.z - gz) : Math.hypot(d.x - sx, d.z - sz) + Math.hypot(d.ox - gx, d.oz - gz);
    if (c < bd) {
      bd = c;
      best = d;
    }
  }
  return best;
}

/** 眼睛离脚底多高 */
export const eyeOf = (h: Human): number => 1.62 - 0.38 * h.ck;

/**
 * 命中体积用的两个点（世界坐标）：out = [头的球心 x, y, z, 髋 x, y, z]。和渲染层摆的姿势是一套数：
 * 站着头在 1.64 米，蹲下髋低 0.38 米、上身前倾，头在 1.25 米、往前探 0.14 米
 */
export function volumesOf(h: Human, out: Float32Array): void {
  const lean = 0.1 + 0.1 * h.ck;
  const hip = h.y + 0.95 - 0.38 * h.ck;
  const f = 0.62 * Math.sin(lean) + 0.02;
  out[0] = h.x + Math.sin(h.yaw) * f;
  out[1] = hip + 0.07 + 0.62 * Math.cos(lean);
  out[2] = h.z + Math.cos(h.yaw) * f;
  out[3] = h.x;
  out[4] = hip;
  out[5] = h.z;
}
export const HEAD_R = 0.14;
const TORSO_R = 0.21;
const LEG_R = 0.19;

/** 射线打在这个人身上哪里：返回距离（没打到 -1），打的是不是头记在 rayHead 里 */
let rayHead = false;
function rayHuman(h: Human, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): number {
  // 粗筛：射线离身体中间那一点超过 1.4 米的不用细算
  const mx = h.x - ox;
  const my = h.y + 0.9 - oy;
  const mz = h.z - oz;
  const t = mx * dx + my * dy + mz * dz;
  if (t < -1.5 || t > max + 1.5) return -1;
  const px = mx - dx * t;
  const py = my - dy * t;
  const pz = mz - dz * t;
  if (px * px + py * py + pz * pz > 1.96) return -1;
  volumesOf(h, VOL);
  const hx = VOL[0] as number;
  const hy = VOL[1] as number;
  const hz = VOL[2] as number;
  const qx = VOL[3] as number;
  const qy = VOL[4] as number;
  const qz = VOL[5] as number;
  const th = raySphere(ox, oy, oz, dx, dy, dz, hx, hy, hz, HEAD_R);
  let tb = rayCapsule(ox, oy, oz, dx, dy, dz, qx, qy, qz, qx + (hx - qx) * 0.72, qy + (hy - qy) * 0.72, qz + (hz - qz) * 0.72, TORSO_R);
  const tl = rayCapsule(ox, oy, oz, dx, dy, dz, h.x, h.y + LEG_R, h.z, qx, qy, qz, LEG_R);
  if (tl >= 0 && (tb < 0 || tl < tb)) tb = tl;
  rayHead = false;
  if (th >= 0 && (tb < 0 || th <= tb + 0.12)) {
    rayHead = true;
    return th <= max ? th : -1;
  }
  return tb >= 0 && tb <= max ? tb : -1;
}

export class RaidBrain {
  readonly humans: Human[] = [];
  readonly nav: Nav;
  readonly squads = new Map<number, Squad>();
  /** 自己的钟（秒） */
  time = 0;
  /** 这一帧还能做几次视线检查；调试：这一帧做了几次、开了几枪 */
  private rays = RAY_BUDGET;
  readonly info = { rays: 0, shots: 0, thinks: 0 };
  private readonly rng: Rng;
  private nextId = 1;
  private ax = 0;
  private az = 0;
  private arrived = false;
  private stepT = 0;
  private readonly hit = { id: 0, dist: 0, head: false, x: 0, y: 0, z: 0 };

  constructor(
    private readonly env: RaidEnv,
    seed = 20261115,
  ) {
    this.nav = new Nav(env.world);
    this.rng = new Rng(seed);
  }

  private rnd(): number {
    return this.rng.next();
  }

  private squad(id: number): Squad {
    let s = this.squads.get(id);
    if (!s) {
      s = { id, members: [], lkx: 0, lkz: 0, lkT: -99, lkKind: 0, focus: 0, focusT: 0, flanker: 0, contactT: -99 };
      this.squads.set(id, s);
    }
    return s;
  }

  byId(id: number): Human | null {
    for (const h of this.humans) if (h.id === id) return h;
    return null;
  }

  /** 放一个人（位置要调用方保证能站） */
  spawn(o: SpawnOpts): Human {
    // 编号 1–9999 循环用（丧尸模块拿它当猎物的编号）
    let id = this.nextId;
    for (let k = 0; k < 9999 && this.byId(id); k++) id = (id % 9999) + 1;
    this.nextId = (id % 9999) + 1;
    const level = clamp(Math.round(o.level), 1, 5);
    const sq = this.squad(o.squad);
    const yaw = o.yaw ?? this.rnd() * TAU;
    const st = o.spec.st;
    const mags = o.mags ?? 1.6 + 0.35 * level + this.rnd() * 1.2;
    const h: Human = {
      id,
      side: o.side,
      name: o.name,
      level,
      skill: 0.55 + 0.17 * level + this.rnd() * 0.12,
      seed: (Math.imul(id, 2654435761) ^ Math.floor(this.rnd() * 0xffff)) >>> 0,
      sq,
      tag: o.tag ?? 0,
      group: o.group ?? 0,
      member: o.member ?? 0,
      loot: o.loot ?? true,
      freeAmmo: o.freeAmmo ?? false,
      helmet: o.mil ?? level >= 4,
      mil: o.mil ?? level >= 4,
      gun: o.gun,
      spec: o.spec,
      alive: true,
      hp: HUMAN_HP,
      x: o.x,
      y: 0,
      z: o.z,
      yaw,
      aimYaw: yaw,
      aimPitch: 0,
      vx: 0,
      vz: 0,
      sp: 0,
      gnd: 0,
      top: -Infinity,
      topX: Infinity,
      topZ: Infinity,
      crouch: false,
      ck: 0,
      walkPhase: this.rnd() * 6,
      mag: st.mag,
      ammo: Math.round(st.mag * mags),
      reloadT: 0,
      fireT: 0,
      burst: 0,
      burstN: 3,
      sinceShot: 9,
      shots: 0,
      supp: 0,
      think: this.rnd() * 0.1,
      scanT: 0,
      zedT: this.rnd() * 0.3,
      dist: 999,
      tk: 0,
      tid: 0,
      zx: 0,
      zy: 0,
      zz: 0,
      zh: 1.6,
      seen: 99,
      react: 0,
      errYaw: 0,
      errPitch: 0,
      tax: o.x,
      taz: o.z,
      track: 0,
      off: 9,
      headAim: false,
      lkx: o.x,
      lkz: o.z,
      lkT: -99,
      alertT: 0,
      heardX: o.x,
      heardZ: o.z,
      scout: false,
      sinceHurt: 9,
      flinch: 0,
      carT: 0,
      mode: 'idle',
      t: 0,
      modeT: 0,
      coverT: 0,
      wantHeal: false,
      heals: 0,
      strafe: 0,
      strafeT: 0,
      flank: 0,
      goalX: o.x,
      goalZ: o.z,
      speed: 0,
      idleT: o.goto ? 0.2 + this.rnd() * 0.6 : 0.5 + this.rnd() * 3,
      lookYaw: yaw,
      lookT: 0,
      grid: null,
      nmode: 0,
      path: [],
      wp: 0,
      full: true,
      navT: 0,
      gx: o.x,
      gz: o.z,
      noDoor: 0,
      stuck: 0,
      bias: id & 1 ? 1 : -1,
      biasT: 0,
      jx: o.x,
      jz: o.z,
      jam: 0,
      hx: o.x,
      hz: o.z,
      leash: o.leash ?? null,
      pois: o.pois ?? null,
      watch: o.watch ?? false,
      hasGoto: !!o.goto,
      gotoX: o.goto?.x ?? 0,
      gotoZ: o.goto?.z ?? 0,
      head: false,
      byPlayer: false,
      killDx: 0,
      killDz: 1,
      killPush: 1.3,
      view: null,
      prey: null,
    };
    h.grid = this.nav.at(h.x, h.z);
    h.gnd = this.env.world.groundAt(h.x, h.z);
    h.y = h.gnd;
    h.y = this.floor(h);
    sq.members.push(h);
    this.humans.push(h);
    return h;
  }

  /** 从名单里拿掉（走远了撤掉、死了转成尸体） */
  remove(h: Human): void {
    const i = this.humans.indexOf(h);
    if (i >= 0) {
      this.humans[i] = this.humans[this.humans.length - 1] as Human;
      this.humans.pop();
    }
    const m = h.sq.members;
    const k = m.indexOf(h);
    if (k >= 0) m.splice(k, 1);
    if (!m.length) this.squads.delete(h.sq.id);
    // 正拿他当目标的：不打了
    for (const o of this.humans) {
      if (o.tk === 2 && o.tid === h.id) {
        o.tk = 0;
        o.seen = 99;
      }
    }
  }

  /** 换阵营（生化模式里同伴变成敌人）：手上的目标作废，重新看。伙的编号最低位 = 阵营（raiders.ts 定的），换阵营就是换到另一伙 */
  setSide(h: Human, side: HumanSide): void {
    if (h.side === side) return;
    h.side = side;
    const old = h.sq;
    const key = old.id - (old.id & 1) + (side === 'ally' ? 1 : 0);
    if (key !== old.id) {
      const k = old.members.indexOf(h);
      if (k >= 0) old.members.splice(k, 1);
      if (!old.members.length) this.squads.delete(old.id);
      h.sq = this.squad(key);
      h.sq.members.push(h);
    }
    h.scout = false;
    h.flank = 0;
    h.tk = 0;
    h.seen = 99;
    h.lkT = -99;
    h.sq.lkT = -99;
    for (const o of this.humans) {
      if (o.tk === 2 && o.tid === h.id) {
        o.tk = 0;
        o.seen = 99;
      }
    }
  }

  // ---------------------------------------------------------------- 每帧

  update(dt: number): void {
    this.time += dt;
    this.rays = RAY_BUDGET;
    this.info.rays = 0;
    this.info.shots = 0;
    this.info.thinks = 0;
    this.nav.budget = NAV_BUDGET;
    this.nav.first = true;
    const hs = this.humans;
    const p = this.env.player;
    // 互相别挤在一起（人少，两两比一遍）
    for (let i = 0; i < hs.length; i++) {
      const a = hs[i] as Human;
      for (let j = i + 1; j < hs.length; j++) {
        const b = hs[j] as Human;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= 0.81 || d2 < 1e-6 || Math.abs(a.y - b.y) > 1.5) continue;
        const d = Math.sqrt(d2);
        const push = ((0.9 - d) / d) * Math.min(0.5, dt * 5) * 0.5;
        a.x -= dx * push;
        a.z -= dz * push;
        b.x += dx * push;
        b.z += dz * push;
      }
    }
    // 玩家跑步的脚步声：十米以内听得见（背后摸过去要走着或者蹲着）
    this.stepT -= dt;
    if (this.stepT <= 0) {
      this.stepT = 0.4;
      if (p.sprinting && !this.env.playerDead() && !this.env.driving()) this.noise(p.x, p.z, 10, null, true);
    }
    for (let i = hs.length - 1; i >= 0; i--) this.step(hs[i] as Human, dt);
    this.info.rays = RAY_BUDGET - this.rays;
  }

  private step(h: Human, dt: number): void {
    if (!h.alive) return;
    const p = this.env.player;
    h.t += dt;
    h.modeT -= dt;
    h.coverT -= dt;
    h.noDoor -= dt;
    h.alertT -= dt;
    h.sinceHurt += dt;
    h.sinceShot += dt;
    h.strafeT -= dt;
    if (h.flinch > 0) h.flinch = Math.max(0, h.flinch - dt * 4);
    h.ck += ((h.crouch ? 1 : 0) - h.ck) * Math.min(1, dt * 9);
    h.dist = Math.hypot(p.x - h.x, p.z - h.z);
    h.think -= dt;
    if (h.think <= 0) {
      // 远处的想得慢一点；这一帧的视线检查用完了就等下一帧
      const every = h.dist < 90 || h.tk ? 0.1 : 0.25;
      if (this.rays > 0 || h.think < -0.15) {
        const el = every - h.think;
        h.think = every * (0.85 + 0.3 * this.rnd());
        this.info.thinks++;
        this.perceive(h, el);
        this.decide(h, el);
      }
    }
    // 包扎：蹲着不动 4 秒
    if (h.mode === 'heal' && h.modeT <= 0) {
      h.hp = Math.min(HUMAN_HP, h.hp + 40);
      h.heals++;
      h.wantHeal = false;
      this.setMode(h, h.tk ? 'fight' : 'look');
      h.idleT = 2;
      h.crouch = false;
    }
    this.aim(h, dt);
    let speed = h.speed;
    let gx = h.goalX;
    let gz = h.goalZ;
    if (h.mode === 'idle' || h.mode === 'alert' || h.mode === 'look' || h.mode === 'heal') speed = 0;
    if (speed > 0 && Math.hypot(gx - h.x, gz - h.z) < 0.35) speed = 0;
    if (h.crouch && speed > 0) speed = Math.min(speed, 1.3);
    // 有目标 / 警觉时身体跟着枪口；平时朝走的方向
    const face = h.tk || h.mode === 'alert' || h.mode === 'look' || h.mode === 'heal' || (h.mode === 'idle' && speed === 0) ? h.aimYaw : NaN;
    if (speed <= 0) {
      gx = h.x;
      gz = h.z;
    }
    this.move(h, dt, gx, gz, speed, face);
    this.shoot(h, dt);
  }

  private setMode(h: Human, m: HMode): void {
    if (h.mode === m) return;
    h.mode = m;
    h.t = 0;
    h.nmode = 0;
    h.jx = h.x;
    h.jz = h.z;
    h.jam = 0;
  }

  private go(h: Human, x: number, z: number, speed: number): void {
    const L = h.leash;
    if (L) {
      const dx = x - L.x;
      const dz = z - L.z;
      const d = Math.hypot(dx, dz);
      const r = Math.max(0.5, L.r - 0.6);
      if (d > r) {
        x = L.x + (dx / d) * r;
        z = L.z + (dz / d) * r;
      }
    }
    if (Math.hypot(x - h.goalX, z - h.goalZ) > 0.05) {
      h.jx = h.x;
      h.jz = h.z;
      h.jam = 0;
    }
    h.goalX = x;
    h.goalZ = z;
    h.speed = speed;
  }

  private stop(h: Human): void {
    h.speed = 0;
    h.goalX = h.x;
    h.goalZ = h.z;
  }

  // ---------------------------------------------------------------- 看、听

  /** 目标现在在哪：写进 T（脚底的位置、瞄多高）。目标没了返回 false */
  private target(h: Human): boolean {
    const env = this.env;
    if (h.tk === 1) {
      const p = env.player;
      if (env.playerDead()) return false;
      T.x = p.x;
      T.y = p.feet;
      T.z = p.z;
      T.ah = env.driving() ? 1.0 : p.crouch > 0.5 ? 0.72 : 1.15;
      return true;
    }
    if (h.tk === 2) {
      const o = this.byId(h.tid);
      if (!o || !o.alive) return false;
      T.x = o.x;
      T.y = o.y;
      T.z = o.z;
      T.ah = h.headAim ? 1.6 - 0.4 * o.ck : 1.15 - 0.35 * o.ck;
      return true;
    }
    if (h.tk === 3) {
      T.x = h.zx;
      T.y = h.zy;
      T.z = h.zz;
      T.ah = h.zh * (h.headAim ? 0.93 : 0.62);
      return true;
    }
    return false;
  }

  /** 眼睛到 (tx, ty, tz) 之间有没有东西挡着（算一次视线检查）。car = 目标坐在车里：打到车壳算看见 */
  private los(h: Human, tx: number, ty: number, tz: number, car = false): boolean {
    const w = this.env.world;
    const oy = h.y + eyeOf(h);
    const dx = tx - h.x;
    const dz = tz - h.z;
    const dy = ty - oy;
    const d = Math.hypot(dx, dz);
    if (d < 0.6) return true;
    this.rays--;
    const L = Math.hypot(d, dy);
    // 地形挡不挡：world.raycast 不算地面时才便宜，沿线看三个点
    if (d > 10) {
      for (let k = 1; k <= 3; k++) {
        const t = k / 4;
        if (w.groundAt(h.x + dx * t, h.z + dz * t) > oy + dy * t + 0.15) return false;
      }
    }
    const hit = w.raycast(h.x, oy, h.z, dx / L, dy / L, dz / L, L - 0.3, false);
    if (hit === Infinity) return true;
    return car && w.hitKind === 'car' && hit > L - 5;
  }

  /** 看得见这个目标吗：先看胸口，挡住了再看头（露出半个头也算） */
  private sees(h: Human, x: number, y: number, z: number, top: number, car: boolean): boolean {
    if (this.los(h, x, y + top * 0.66, z, car)) return true;
    return this.rays > 0 && this.los(h, x, y + top - 0.08, z, car);
  }

  private hostile(h: Human, o: Human): boolean {
    return o.alive && o.side !== h.side;
  }

  /** 发现了：新目标要重新反应、重新瞄；告诉同伙 */
  private spot(h: Human, kind: number, id: number, x: number, z: number): void {
    const now = this.time;
    const d = Math.hypot(x - h.x, z - h.z);
    if (h.tk !== kind || h.tid !== id) {
      const ang = Math.abs(angDiff(Math.atan2(x - h.x, z - h.z), h.aimYaw));
      // 已经在打别的、已经警觉着：反应快一些。丧尸慢吞吞的，不用想
      const ready = h.tk !== 0 || now - h.lkT < 3 ? 0.55 : h.alertT > 0 ? 0.75 : 1;
      h.react = kind === 3 ? 0.25 + 0.3 * this.rnd() + ang * 0.15 : (REACT[h.level] as number) * (0.88 + 0.24 * this.rnd()) * ready + ang * 0.25;
      h.errYaw = ((this.rnd() - 0.5) * (0.14 + d * 0.005)) / h.skill;
      h.errPitch = ((this.rnd() - 0.5) * 0.07) / h.skill;
      h.headAim = kind !== 1 && this.rnd() < (HEAD_AIM[h.level] as number);
      h.burst = 0;
      h.tax = x;
      h.taz = z;
      h.track = 0;
      h.tk = kind;
      h.tid = id;
      if (kind !== 3) this.env.on('spot', h);
    }
    h.seen = 0;
    if (kind === 3) return;
    h.lkx = x;
    h.lkz = z;
    h.lkT = now;
    h.alertT = Math.max(h.alertT, 20);
    const sq = h.sq;
    if (now - sq.contactT > 20) {
      // 新的一次接触：定一个去绕侧面的（两个人以上才绕；拿栓动枪的不绕）
      sq.flanker = 0;
      if (sq.members.length >= 2) {
        for (const m of sq.members) {
          if (m !== h && m.spec.kind !== 'sniper' && m.hp > 50) {
            sq.flanker = m.id;
            break;
          }
        }
      }
      for (const m of sq.members) {
        m.flank = m.id === sq.flanker ? 1 : 0;
        // 别的人：人躲起来以后朝他躲的地方压制一两个点射
        m.supp = m.id !== sq.flanker && m.spec.auto ? 1 + Math.floor(this.rnd() * 2) : 0;
      }
    }
    sq.contactT = now;
    sq.lkx = x;
    sq.lkz = z;
    sq.lkT = now;
    sq.lkKind = kind;
    for (const m of sq.members) {
      if (m === h || !m.alive) continue;
      if (Math.hypot(m.x - h.x, m.z - h.z) > 80) continue;
      if (m.lkT < now - 0.5) {
        m.lkx = x;
        m.lkz = z;
        m.lkT = now;
      }
      m.alertT = Math.max(m.alertT, 20);
    }
  }

  private perceive(h: Human, el: number): void {
    const env = this.env;
    const p = env.player;
    const night = env.night();
    const range = SIGHT * (1 - 0.5 * night);
    const fx = Math.sin(h.aimYaw);
    const fz = Math.cos(h.aimYaw);
    const wary = h.tk !== 0 || h.alertT > 0;
    const cone = wary ? CONE_ALERT : CONE;
    h.grid = this.nav.at(h.x, h.z);
    h.seen += el;

    // ---- 现在的目标还看得见吗
    if (h.tk === 1 || h.tk === 2) {
      let ok = this.target(h);
      if (ok) {
        const d = Math.hypot(T.x - h.x, T.z - h.z);
        const car = h.tk === 1 && env.driving();
        ok = d < range * 1.35 && this.rays > 0 && this.sees(h, T.x, T.y, T.z, h.tk === 1 ? (car ? 1.3 : p.eye + 0.1) : 1.7 - 0.4 * (this.byId(h.tid)?.ck ?? 0), car);
        if (ok) this.spot(h, h.tk, h.tid, T.x, T.z);
        else if (h.seen < 0.5 && Math.hypot(T.x - h.lkx, T.z - h.lkz) < 3) {
          // 刚拐过墙角的那一下：看得出人往哪边去了（只有半秒、几步路；再往后就真的不知道了）
          h.lkx = T.x;
          h.lkz = T.z;
        }
      } else h.seen = 99;
      // 0.8 秒没看见才算丢（晃过一根柱子就要重新反应的话根本开不了枪）
      if (h.seen > 0.8) {
        h.tk = 0;
        // 点射从头数：接下来朝他躲的地方压制的那一两个点射是新的，不接着交火时数到一半的那个
        h.burst = 0;
      }
    }

    // ---- 丧尸：冲着自己来的、已经贴到跟前的
    h.zedT -= el;
    if (h.zedT <= 0 || h.tk === 3) {
      h.zedT = 0.3;
      const n = env.zombiesNear(h.x, h.z, 25, zrefs);
      let found = false;
      let pick: ZombieRef | null = null;
      for (let i = 0; i < n; i++) {
        const z = zrefs[i] as ZombieRef;
        if (h.tk === 3 && z.id === h.tid) {
          found = true;
          h.zx = z.x;
          h.zy = z.y;
          h.zz = z.z;
          h.zh = z.h;
        }
        if (pick) continue;
        const d = Math.hypot(z.x - h.x, z.z - h.z);
        // 同伴（ally）见了追人的就打；别的人只管冲自己来的和贴到跟前的
        const threat = z.after === h.id || d < 7 || (h.side === 'ally' && z.after >= 0);
        if (threat && Math.abs(z.y - h.y) < 3) pick = z;
      }
      if (h.tk === 3 && !found) {
        h.tk = 0;
        h.seen = 99;
      }
      if (pick) {
        const d = Math.hypot(pick.x - h.x, pick.z - h.z);
        // 有人正拿枪对着自己的时候，远处的丧尸先不管
        const busy = (h.tk === 1 || h.tk === 2) && d > 6;
        if (!busy && (h.tk !== 3 || pick.id !== h.tid) && this.rays > 0 && this.los(h, pick.x, pick.y + pick.h * 0.6, pick.z)) {
          const cur = h.tk === 3 ? Math.hypot(h.zx - h.x, h.zz - h.z) : Infinity;
          if (d < cur - 1.5) {
            this.spot(h, 3, pick.id, pick.x, pick.z);
            h.zx = pick.x;
            h.zy = pick.y;
            h.zz = pick.z;
            h.zh = pick.h;
          }
        }
      }
      if (h.tk === 3) h.seen = 0;
    }

    // ---- 找新的目标（手上有目标时隔半秒才重新比一次）
    h.scanT -= el;
    if (h.tk === 1 || h.tk === 2) {
      if (h.scanT > 0) return;
    } else if (h.tk === 3 && Math.hypot(h.zx - h.x, h.zz - h.z) < 6) return;
    h.scanT = 0.5;
    let best = 0;
    let bid = 0;
    let bs = Infinity;
    let bx = 0;
    let by = 0;
    let bz = 0;
    let btop = 1.7;
    if (h.side === 'raider' && !env.playerDead()) {
      const dx = p.x - h.x;
      const dz = p.z - h.z;
      const d = Math.hypot(dx, dz);
      const car = env.driving();
      let r = range;
      if (car) r *= 1.3;
      else if (p.crouch > 0.5) r *= 0.6;
      if (d < r) {
        const dot = (fx * dx + fz * dz) / (d || 1);
        // 贴身：背对着也察觉得到（蹲着摸过去要更近）
        const close = d < (car ? 8 : p.crouch > 0.5 ? 1.8 : 4);
        if (dot > cone || close) {
          bs = d + Math.acos(clamp(dot, -1, 1)) * 8 - (h.tk === 1 ? 6 : 0);
          best = 1;
          bx = p.x;
          by = p.feet;
          bz = p.z;
          btop = car ? 1.3 : p.eye + 0.1;
        }
      }
    }
    for (const o of this.humans) {
      if (o === h || !this.hostile(h, o)) continue;
      const dx = o.x - h.x;
      const dz = o.z - h.z;
      const d = Math.hypot(dx, dz);
      if (d > range) continue;
      const dot = (fx * dx + fz * dz) / (d || 1);
      if (dot <= cone && d > 4) continue;
      const s = d + Math.acos(clamp(dot, -1, 1)) * 8 - (h.tk === 2 && h.tid === o.id ? 6 : 0);
      if (s < bs) {
        bs = s;
        best = 2;
        bid = o.id;
        bx = o.x;
        by = o.y;
        bz = o.z;
        btop = 1.7 - 0.4 * o.ck;
      }
    }
    if (!best || (best === h.tk && bid === h.tid) || this.rays <= 0) return;
    if (this.sees(h, bx, by, bz, btop, best === 1 && env.driving())) this.spot(h, best, bid, bx, bz);
  }

  /**
   * 动静（枪声、车、跑步声）：半径以内没在交火的会警觉；每一伙派离得最近的一两个过去看，别的原地戒备。
   * from = 谁弄出来的（同一伙的不用听：他们本来就互相通报）；soft = 脚步声这种小动静（只是转头看，不派人）
   */
  noise(x: number, z: number, radius: number, from: Human | null, soft = false): void {
    for (const sq of this.squads.values()) {
      if (from && from.sq === sq) continue;
      let n = 0;
      for (const m of sq.members) {
        if (!m.alive || m.tk === 1 || m.tk === 2 || m.mode === 'heal' || m.mode === 'flee') continue;
        const d = Math.hypot(m.x - x, m.z - z);
        if (d > radius) continue;
        // 听得不那么准：离得越远偏得越多
        const j = Math.min(8, d * 0.15);
        const nx = x + (this.rnd() - 0.5) * j;
        const nz = z + (this.rnd() - 0.5) * j;
        const fresh = m.alertT <= 0;
        m.alertT = Math.max(m.alertT, soft ? 6 : 18);
        if (fresh || Math.hypot(nx - m.heardX, nz - m.heardZ) > 6) {
          m.heardX = nx;
          m.heardZ = nz;
        }
        if (soft) continue;
        n++;
      }
      if (!n || soft) continue;
      // 已经有人在路上了就不再派
      let out = 0;
      for (const m of sq.members) if (m.scout && m.alertT > 0) out++;
      const want = sq.members.length >= 3 ? 2 : 1;
      while (out < want) {
        let pick: Human | null = null;
        let bd = Infinity;
        for (const m of sq.members) {
          if (!m.alive || m.scout || m.watch || m.tk || m.alertT <= 0 || m.mode === 'heal' || m.mode === 'flee') continue;
          const d = Math.hypot(m.x - x, m.z - z);
          if (d < bd) {
            bd = d;
            pick = m;
          }
        }
        if (!pick) break;
        pick.scout = true;
        out++;
      }
    }
  }

  // ---------------------------------------------------------------- 打算

  /** 这把枪喜欢在多远打 */
  private wantRange(h: Human): number {
    const k = h.spec.kind;
    if (k === 'sniper') return 42;
    if (k === 'shotgun') return 8;
    if (k === 'smg') return 13;
    if (k === 'pistol') return 15;
    return 30;
  }

  private decide(h: Human, el: number): void {
    const now = this.time;
    const sq = h.sq;
    const env = this.env;
    if (h.mode === 'heal') return;
    // 同伙刚报的位置比自己知道的新
    if (sq.lkT > h.lkT + 0.5 && Math.hypot(sq.lkx - h.x, sq.lkz - h.z) < 90) {
      h.lkx = sq.lkx;
      h.lkz = sq.lkz;
      h.lkT = sq.lkT;
    }
    // 子弹打光了：跑
    const dry = h.mag <= 0 && h.ammo <= 0 && !h.freeAmmo;
    if (dry && (h.tk !== 0 || now - h.lkT < 30 || (h.side === 'raider' && h.dist < 60 && !env.playerDead()))) {
      h.tk = 0;
      if (h.mode !== 'flee' || h.modeT <= 0) {
        this.setMode(h, 'flee');
        h.modeT = 2;
        h.crouch = false;
        // 背着威胁跑；不知道威胁在哪就背着玩家
        const tx = now - h.lkT < 30 ? h.lkx : env.player.x;
        const tz = now - h.lkT < 30 ? h.lkz : env.player.z;
        const a = Math.atan2(h.x - tx, h.z - tz) + (this.rnd() - 0.5) * 0.9;
        this.go(h, h.x + Math.sin(a) * 30, h.z + Math.cos(a) * 30, RUN);
      }
      return;
    }
    if (h.tk) {
      if (!this.target(h)) return;
      const tx = T.x;
      const ty = T.y;
      const tz = T.z;
      const d = Math.hypot(tx - h.x, tz - h.z);
      const zed = h.tk === 3;
      const low = h.hp < 35 && h.heals < 2;
      const pinned = h.sinceHurt < 0.5 && h.hp < 80;
      // ---- 该躲了：残血、换弹、正在挨打（不是每次都躲，看等级）
      if (!zed && h.mode !== 'cover' && h.coverT <= 0 && (low || h.reloadT > 0 || pinned)) {
        h.coverT = 1.2 + this.rnd() * 0.6;
        if ((low || this.rnd() < (COVER_P[h.level] as number)) && this.findCover(h, tx, ty + 1.5, tz)) {
          this.setMode(h, 'cover');
          h.wantHeal = low;
          h.modeT = low ? 8 : h.reloadT > 0 ? h.reloadT + 0.6 : 1.4 + this.rnd() * 1.2;
          h.crouch = false;
          this.go(h, P.x, P.z, RUN);
        } else if (low) h.wantHeal = true;
      }
      if (h.mode === 'cover') {
        const there = Math.hypot(h.goalX - h.x, h.goalZ - h.z) < 0.7;
        if (there) {
          // 躲好了：蹲下；要包扎的看不见人了才包
          h.crouch = true;
          if (h.wantHeal && h.seen > 0.4) this.startHeal(h);
        }
        if (h.modeT > 0 && !(there && !h.wantHeal && h.reloadT <= 0)) return;
        h.crouch = false;
      }
      this.setMode(h, 'fight');
      const want = this.wantRange(h);
      if (zed) {
        // 丧尸：站住了打，贴到跟前就往后退
        if (d < 4) this.go(h, h.x - ((tx - h.x) / (d || 1)) * 5, h.z - ((tz - h.z) / (d || 1)) * 5, JOG);
        else this.stop(h);
        h.crouch = false;
        return;
      }
      const visible = h.seen < 0.35;
      if (h.flank === 1) {
        // 绕侧面：以目标为圆心转过去 50–80 度，到了（或者已经贴近了）就算绕到
        if (h.t < 0.15 || Math.hypot(h.goalX - h.x, h.goalZ - h.z) < 1.5 || h.speed === 0) {
          if (h.t > 0.15 && (Math.hypot(h.goalX - h.x, h.goalZ - h.z) < 1.5 || d < want * 0.7)) h.flank = 2;
          else if (!this.flankPoint(h, tx, tz, d, want)) h.flank = 2;
        }
        if (h.flank === 1) {
          h.crouch = false;
          return;
        }
      }
      const longGun = h.spec.kind === 'sniper' || h.spec.kind === 'rifle' || h.spec.kind === 'lmg';
      if (d > want + 6 || !visible) {
        // 太远 / 看不见：靠过去（看不见时去他最后在的地方）
        this.go(h, visible ? tx : h.lkx, visible ? tz : h.lkz, d > want + 14 ? RUN : JOG);
        h.crouch = false;
      } else if (d < want * 0.4 && longGun) {
        this.go(h, h.x - ((tx - h.x) / (d || 1)) * 4, h.z - ((tz - h.z) / (d || 1)) * 4, JOG);
      } else this.stop(h);
      // 交火时横移，每 0.5–1.2 秒换一次方向；长枪偶尔蹲下打
      if (h.strafeT <= 0) {
        h.strafeT = 0.5 + this.rnd() * 0.7;
        h.strafe = this.rnd() < 0.3 ? 0 : this.rnd() < 0.5 ? -1 : 1;
        const k = h.spec.kind;
        h.crouch = h.speed === 0 && ((k === 'sniper' && this.rnd() < 0.65) || ((k === 'rifle' || k === 'lmg') && this.rnd() < 0.35) || (k === 'pistol' && this.rnd() < 0.15));
        if (h.crouch && k === 'sniper') h.strafe = 0;
      }
      return;
    }

    // ---- 没有目标
    h.strafe = 0;
    const since = now - h.lkT;
    if (h.mode === 'cover') {
      const there = Math.hypot(h.goalX - h.x, h.goalZ - h.z) < 0.7;
      if (there) {
        h.crouch = true;
        if (h.wantHeal) {
          this.startHeal(h);
          return;
        }
      }
      if (h.modeT > 0 && !(there && h.reloadT <= 0)) return;
      h.crouch = false;
    }
    if (h.wantHeal && h.hp < 35 && h.heals < 2 && h.sinceHurt > 1.5) {
      this.startHeal(h);
      return;
    }
    if (since < LOSE || (since < LOSE_MAX && (h.mode === 'search' || h.mode === 'look') && !h.scout)) {
      // 刚丢了目标：去最后看见的地方找
      if (h.mode === 'look') {
        h.idleT -= el;
        if (h.idleT <= 0) {
          // 张望完了：同伙有更新的消息就再去，没有就放松下来
          if (since < LOSE && Math.hypot(h.lkx - h.x, h.lkz - h.z) > 6) this.setMode(h, 'search');
          else h.lkT = now - LOSE_MAX;
        }
        return;
      }
      if (h.mode !== 'search') {
        this.setMode(h, 'search');
        h.crouch = false;
      }
      // 每个人去的点错开不到一米：不会全挤到同一个点上
      const jx = h.lkx + ((h.seed % 7) - 3) * 0.3;
      const jz = h.lkz + (((h.seed >> 3) % 7) - 3) * 0.3;
      const dd = Math.hypot(jx - h.x, jz - h.z);
      this.go(h, jx, jz, dd > 14 ? RUN : JOG);
      if (dd < 1.5 || h.speed === 0) {
        this.setMode(h, 'look');
        h.idleT = 3 + this.rnd() * 2.5;
        this.stop(h);
      }
      return;
    }
    if (h.alertT > 0) {
      // 听见动静：派去看的过去看，别的原地戒备（蹲下、枪口对着那边）
      if (h.scout) {
        if (h.mode !== 'search' && h.mode !== 'look') this.setMode(h, 'search');
        if (h.mode === 'search') {
          h.crouch = false;
          this.go(h, h.heardX, h.heardZ, JOG);
          if (Math.hypot(h.heardX - h.x, h.heardZ - h.z) < 4 || h.t > 30) {
            this.setMode(h, 'look');
            h.idleT = 4 + this.rnd() * 3;
            this.stop(h);
          }
        } else {
          h.idleT -= el;
          if (h.idleT <= 0) {
            h.scout = false;
            h.alertT = Math.min(h.alertT, 4);
          }
        }
        return;
      }
      if (h.mode !== 'alert') {
        this.setMode(h, 'alert');
        this.stop(h);
        h.crouch = !h.watch && (h.seed & 1) === 0;
      }
      return;
    }
    if (h.scout) h.scout = false;
    this.routine(h, el);
  }

  private startHeal(h: Human): void {
    this.setMode(h, 'heal');
    h.modeT = 4;
    h.crouch = true;
    h.reloadT = 0;
    this.stop(h);
    this.env.on('heal', h);
  }

  /** 平时：在房子之间走、进屋翻东西、站一会、四处看 */
  private routine(h: Human, el: number): void {
    if (h.mode === 'walk') {
      if (Math.hypot(h.goalX - h.x, h.goalZ - h.z) < 0.8 || h.t > 45) {
        if (h.hasGoto) {
          // 到了要去的地方：以后就在这一带
          h.hasGoto = false;
          h.hx = h.x;
          h.hz = h.z;
        }
        this.setMode(h, 'idle');
        this.stop(h);
        h.idleT = h.watch ? 6 + this.rnd() * 10 : 3 + this.rnd() * 7;
        // 进屋翻东西的：蹲下翻一会
        h.crouch = !h.watch && !!h.pois && this.rnd() < 0.4;
      }
      return;
    }
    if (h.mode !== 'idle') {
      this.setMode(h, 'idle');
      this.stop(h);
      h.crouch = false;
      h.idleT = 1 + this.rnd() * 2;
      return;
    }
    h.idleT -= el;
    if (h.idleT > 0) return;
    h.crouch = false;
    if (h.hasGoto) {
      this.setMode(h, 'walk');
      this.go(h, h.gotoX, h.gotoZ, JOG);
      return;
    }
    const pois = h.pois;
    let x: number;
    let z: number;
    if (pois && pois.length) {
      const sq = h.sq;
      if (this.time > sq.focusT) {
        sq.focus = (sq.focus + 1) % pois.length;
        sq.focusT = this.time + 35 + this.rnd() * 45;
      }
      const poi = pois[sq.focus % pois.length] as Poi;
      const cells = poi.cells.length / 2;
      if (!h.watch && cells > 0 && this.rnd() < 0.75) {
        const i = Math.floor(this.rnd() * cells) * 2;
        x = poi.cells[i] as number;
        z = poi.cells[i + 1] as number;
      } else {
        x = poi.x + (this.rnd() - 0.5) * 3;
        z = poi.z + (this.rnd() - 0.5) * 3;
      }
    } else {
      const a = this.rnd() * TAU;
      const r = 1.5 + this.rnd() * (h.watch ? 2 : 7);
      x = h.hx + Math.sin(a) * r;
      z = h.hz + Math.cos(a) * r;
    }
    const g = this.nav.at(x, z);
    if (g && g.blockedAt(x, z)) {
      if (!g.freeNear(x, z, P, 4)) {
        h.idleT = 1;
        return;
      }
      x = P.x;
      z = P.z;
    }
    if (this.env.world.waterDepth(x, z) > 0.3) {
      h.idleT = 1;
      return;
    }
    this.setMode(h, 'walk');
    this.go(h, x, z, WALK);
  }

  /** 附近对方看不见的地方（蹲下以后）。找到了放在 P 里 */
  private findCover(h: Human, ex: number, ey: number, ez: number): boolean {
    const w = this.env.world;
    const g = h.grid;
    let best = Infinity;
    let fx = 0;
    let fz = 0;
    for (let i = 0; i < 8 && this.rays > 0; i++) {
      const a = this.rnd() * TAU;
      const r = 2 + this.rnd() * 8;
      const x = h.x + Math.sin(a) * r;
      const z = h.z + Math.cos(a) * r;
      if (h.leash && Math.hypot(x - h.leash.x, z - h.leash.z) > h.leash.r - 0.6) continue;
      if (g ? g.blockedAt(x, z) : w.waterDepth(x, z) > 0.3) continue;
      const dx = x - ex;
      const dy = h.y + 0.95 - ey;
      const dz = z - ez;
      const L = Math.hypot(dx, dy, dz);
      if (L < 1) continue;
      this.rays--;
      if (w.raycast(ex, ey, ez, dx / L, dy / L, dz / L, L - 0.25, false) === Infinity) continue;
      // 要绕一大圈才到的掩体跑到一半就被打死了；离对方近的也不要
      const s = r + (g && !g.lineClear(h.x, h.z, x, z) ? 5 : 0) - Math.hypot(x - ex, z - ez) * 0.1;
      if (s < best) {
        best = s;
        fx = x;
        fz = z;
      }
    }
    if (best === Infinity) return false;
    P.x = fx;
    P.z = fz;
    return true;
  }

  /** 定一个绕侧面的点并开始往那走。没有合适的返回 false */
  private flankPoint(h: Human, tx: number, tz: number, d: number, want: number): boolean {
    const base = Math.atan2(h.x - tx, h.z - tz);
    const r = clamp(Math.min(d, want), 7, 30);
    for (let i = 0; i < 4; i++) {
      const a = base + h.bias * (0.85 + this.rnd() * 0.6) * (i < 2 ? 1 : -1);
      const x = tx + Math.sin(a) * r;
      const z = tz + Math.cos(a) * r;
      if (h.leash && Math.hypot(x - h.leash.x, z - h.leash.z) > h.leash.r - 0.6) continue;
      const g = this.nav.at(x, z);
      if (g ? g.blockedAt(x, z) : this.env.world.waterDepth(x, z) > 0.3) continue;
      this.go(h, x, z, RUN);
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- 瞄、开枪

  private aim(h: Human, dt: number): void {
    const now = this.time;
    if (h.tk && this.target(h)) {
      // 枪口跟着的点追目标现在的位置：慢 LAG 秒
      const k = 1 - Math.exp(-dt / (LAG[h.level] as number));
      h.tax += (T.x - h.tax) * k;
      h.taz += (T.z - h.taz) * k;
      h.track += dt;
      const dx0 = T.x - h.x;
      const dz0 = T.z - h.z;
      const d = Math.hypot(dx0, dz0);
      const ax = h.tax - h.x;
      const az = h.taz - h.z;
      const eye = h.y + eyeOf(h);
      const trueYaw = Math.atan2(dx0, dz0);
      const wantYaw0 = Math.atan2(ax, az);
      const truePitch = Math.atan2(T.y + T.ah - eye, Math.max(0.5, d));
      // 盯着才收拢；远处收得慢
      const conv = Math.exp((-dt * 3 * h.skill) / (1 + d / 25));
      h.errYaw *= conv;
      h.errPitch *= conv;
      // 手在晃：刚举枪时晃得厉害，盯久了稳下来；走着更晃，蹲着稳一点，刚挨了一下最晃
      const amp = (WOBBLE[h.level] as number) * (h.spec.kind === 'sniper' ? 0.55 : 1) * (1 + 1.2 * Math.exp(-h.track / 1.5)) * (1 + 0.8 * Math.min(1, h.sp / JOG)) * (1 - 0.2 * h.ck) * (h.sinceHurt < 0.5 ? 1.7 : 1);
      const ph = (h.seed % 628) / 100;
      const wy = (amp * (Math.sin(now * 1.9 + ph) + 0.55 * Math.sin(now * 4.3 + ph * 2.7))) / 1.55;
      const wp = (0.6 * amp * (Math.sin(now * 2.3 + ph * 1.3) + 0.55 * Math.sin(now * 3.7 + ph * 0.7))) / 1.55;
      // 压枪：连射时后坐力把枪口往上顶，前几发顶得多
      const kick = h.spec.recoilV * Math.min(4, h.burst) * 0.35 * (1.3 - Math.min(1.2, h.skill) * 0.5);
      const turn = (4.5 + 0.9 * h.level) * dt;
      h.aimYaw += clamp(angDiff(wantYaw0 + h.errYaw + wy, h.aimYaw), -turn, turn);
      h.aimPitch += (truePitch + h.errPitch + wp + kick - h.aimPitch) * Math.min(1, dt * 12);
      h.off = Math.abs(angDiff(trueYaw, h.aimYaw));
      return;
    }
    h.off = 9;
    // 没目标：刚丢了人就盯着他最后出现的地方；听见动静看那边；平时四处看
    let look = h.yaw;
    const since = now - h.lkT;
    if (since < LOSE && h.mode !== 'heal') look = Math.atan2(h.lkx - h.x, h.lkz - h.z);
    else if (h.alertT > 0 && h.mode !== 'walk') look = Math.atan2(h.heardX - h.x, h.heardZ - h.z);
    else if (h.speed > 0 && h.sp > 0.3) look = Math.atan2(h.vx, h.vz);
    else {
      h.lookT -= dt;
      if (h.lookT <= 0) {
        h.lookT = h.watch ? 2.5 + this.rnd() * 3 : 2 + this.rnd() * 5;
        h.lookYaw = h.yaw + (this.rnd() - 0.5) * (h.watch ? 3.6 : 2);
      }
      look = h.lookYaw;
    }
    if (h.mode === 'look') look += Math.sin(h.t * 1.3 + (h.seed % 7)) * 1.1;
    h.aimYaw += clamp(angDiff(look, h.aimYaw), -3.5 * dt, 3.5 * dt);
    h.aimPitch += (0 - h.aimPitch) * Math.min(1, dt * 5);
  }

  private reload(h: Human): void {
    if (h.reloadT > 0) return;
    if (h.ammo <= 0 && !h.freeAmmo) return;
    h.reloadT = h.spec.st.reload * (1.05 + this.rnd() * 0.25);
    h.burst = 0;
    this.env.on('reload', h);
  }

  private shoot(h: Human, dt: number): void {
    const st = h.spec.st;
    h.fireT -= dt;
    if (h.reloadT > 0) {
      h.reloadT -= dt;
      if (h.reloadT <= 0) {
        const n = h.freeAmmo ? st.mag - h.mag : Math.min(st.mag - h.mag, h.ammo);
        h.mag += n;
        if (!h.freeAmmo) h.ammo -= n;
      }
      return;
    }
    if (h.mode === 'heal' || h.mode === 'flee') return;
    if (h.mag <= 0) {
      this.reload(h);
      return;
    }
    if (!h.tk) {
      const since = this.time - h.lkT;
      // 人躲起来了：朝他躲的地方压制一两个点射（打在墙上、掩体上）
      if (h.supp > 0 && since > 0.9 && since < 4 && h.fireT <= 0 && h.mode !== 'cover' && h.sq.lkKind !== 3) {
        const dx = h.lkx - h.x;
        const dz = h.lkz - h.z;
        const d = Math.hypot(dx, dz);
        if (d > 8 && d < 60 && Math.abs(angDiff(Math.atan2(dx, dz), h.aimYaw)) < 0.12) {
          if (h.burst >= h.burstN) {
            h.burst = 0;
            h.burstN = 3 + Math.floor(this.rnd() * 3);
            h.fireT = 0.6 + this.rnd() * 0.6;
            h.supp--;
          } else {
            h.aimPitch = Math.atan2(1.0 - eyeOf(h), d) + (this.rnd() - 0.5) * 0.03;
            this.fire(h, d);
            h.fireT = 1 / st.rate;
            h.burst++;
            h.mag--;
          }
        }
        return;
      }
      // 没事的时候把打了一半的弹匣换掉
      if (h.mag < st.mag * 0.5 && since > 2.5 && h.sinceShot > 2.5) this.reload(h);
      return;
    }
    h.react -= dt;
    if (h.react > 0 || h.fireT > 0) return;
    if (!this.target(h)) return;
    const d = Math.hypot(T.x - h.x, T.z - h.z);
    // 枪口还没对准就不开（人会等准星到了再打），远处要更准
    if (h.off > 0.05 + 2.5 / Math.max(4, d)) return;
    // 够不着就不放空枪（近战枪要贴近了再打）
    const k = h.spec.kind;
    const far = k === 'shotgun' ? 20 : k === 'smg' ? 38 : k === 'pistol' ? 45 : k === 'sniper' ? 170 : 95;
    if (d > far) return;
    // 记着目标但这一刻看不见（在掩体后面）：瞄着那个方向等它出来
    if (h.seen > 0.2) return;
    // 点射：打几发停一下
    if (h.burst >= h.burstN) {
      h.burst = 0;
      const auto = h.spec.auto;
      h.burstN = auto ? 2 + Math.floor(this.rnd() * 5) : k === 'pistol' ? 2 + Math.floor(this.rnd() * 3) : 1 + Math.floor(this.rnd() * 2);
      if (k === 'lmg') h.burstN += 2;
      h.fireT = (0.35 + this.rnd() * 0.55) * (1.4 - 0.14 * h.level);
      return;
    }
    this.fire(h, d);
    // 半自动 / 栓动：人扣扳机没那么齐
    h.fireT = (1 / st.rate) * (h.spec.auto ? 1 : 1.12 + this.rnd() * 0.4);
    h.burst++;
    h.mag--;
    if (h.mag <= 0) this.reload(h);
  }

  /** 两个均匀随机数相加：偏向中心 */
  private tri(): number {
    return this.rnd() + this.rnd() - 1;
  }

  /** 开一枪：真的射线。打到墙、地、车就停；路上碰到的第一个敌人（玩家、对面的人、丧尸）挨这一下 */
  private fire(h: Human, far: number): void {
    const env = this.env;
    const w = env.world;
    const s = h.spec;
    const st = s.st;
    const p = env.player;
    h.sinceShot = 0;
    h.shots++;
    this.info.shots++;
    const oy = h.y + eyeOf(h) - 0.1;
    // 散布：站稳了算举着枪瞄，走着打就是腰射；蹲下更稳
    const moving = Math.min(1, h.sp / JOG);
    const steady = clamp(1 - moving * 1.5, 0, 1) * (0.8 + 0.15 * h.ck);
    const spread = st.spread * DEG * (1 + (s.adsSpread - 1) * steady) * (0.8 + 0.5 * moving) + (0.002 + far * 0.00012) / h.skill;
    const pellets = st.pellets;
    const playerOk = h.side === 'raider' && !env.playerDead();
    const car = env.driving();
    let toPlayer = 0;
    // 霰弹只画三道曳光
    const every = pellets > 1 ? Math.ceil(pellets / 3) : 1;
    // 打偏了的子弹飞过目标几十米以后就不管了（一条 500 米的射线要查上百次地面高度）
    const reach = Math.min(s.maxDist, far * 1.6 + 40);
    let wall = Infinity;
    let wkind: HitKind = 'none';
    for (let i = 0; i < pellets; i++) {
      const yaw = h.aimYaw + this.tri() * spread;
      const pit = h.aimPitch + this.tri() * spread;
      const c = Math.cos(pit);
      const dx = Math.sin(yaw) * c;
      const dy = Math.sin(pit);
      const dz = Math.cos(yaw) * c;
      // 霰弹：只有每三颗里的一颗真的去查墙（别的用上一颗的结果）
      if (i % every === 0) {
        wall = w.raycast(h.x, oy, h.z, dx, dy, dz, reach);
        wkind = w.hitKind;
      }
      let best = wall;
      let who = 0;
      let victim: Human | null = null;
      let head = false;
      if (playerOk) {
        let t: number;
        if (car) {
          t = raySphere(h.x, oy, h.z, dx, dy, dz, p.x, p.feet + 1.0, p.z, 0.55);
          // 人在车里：子弹先碰到的是他自己那辆车的车壳，算打得到（伤害减半）
          if (t >= 0 && t >= best && wkind === 'car' && t - best < 3.5) best = t + 0.01;
        } else t = rayCapsule(h.x, oy, h.z, dx, dy, dz, p.x, p.feet + 0.3, p.z, p.x, p.feet + p.eye - 0.12, p.z, 0.3);
        if (t >= 0 && t < best) {
          best = t;
          who = 1;
        }
      }
      for (const o of this.humans) {
        if (o === h || !this.hostile(h, o)) continue;
        const t = rayHuman(o, h.x, oy, h.z, dx, dy, dz, best);
        if (t >= 0 && t < best) {
          best = t;
          who = 2;
          victim = o;
          head = rayHead;
        }
      }
      const zh = env.zombieRay(h.x, oy, h.z, dx, dy, dz, Math.min(best, reach));
      if (zh && zh.dist < best) {
        best = zh.dist;
        who = 3;
      }
      const hl = Math.hypot(dx, dz) || 1;
      const end = best === Infinity ? reach : best;
      const ex = h.x + dx * end;
      const ey = oy + dy * end;
      const ez = h.z + dz * end;
      const base = st.damage * (end < 3 ? s.close : 1);
      if (who === 1) toPlayer += Math.min(CAP, base * (VS_PLAYER[s.kind] ?? 1) * Math.max(FALLOFF_MIN, falloff(s, end)));
      else if (who === 2 && victim) {
        env.blood(ex, ey, ez, dx, dy, dz);
        this.damage(victim, base * falloff(s, end), head, dx / hl, dz / hl, false, h);
      } else if (who === 3 && zh) {
        env.blood(zh.x, zh.y, zh.z, dx, dy, dz);
        env.hitZombie(zh.id, base * falloff(s, end), zh.head, dx / hl, dz / hl);
      } else if (best !== Infinity && i % every === 0) env.impact(wkind, ex, ey, ez, dx, dy, dz, pellets > 1 ? 0.5 : 1);
      if (i % every === 0) env.tracer(h.x + dx * 0.9, oy + dy * 0.9 - 0.04, h.z + dz * 0.9, ex, ey, ez, pellets > 1 ? 0.4 : 1);
    }
    if (toPlayer > 0) env.hurtPlayer(Math.min(pellets > 1 ? CAP_SHELL : CAP, toPlayer) * (car ? 0.5 : 1), h.x, h.z);
    env.shot(h);
    // 别的伙听得见
    this.noise(h.x, h.z, s.noise, h);
  }

  // ---------------------------------------------------------------- 挨打

  /**
   * 受伤。amount 是基础伤害：爆头在这里乘倍率（戴头盔的少乘一些）。(dx, dz) = 子弹 / 挥击的水平方向。
   * byPlayer = 玩家打的（会知道玩家大概在哪、告诉同伙）；from = 别的人打的。返回是不是打死了
   */
  damage(h: Human, amount: number, head: boolean, dx: number, dz: number, byPlayer: boolean, from: Human | null = null, push = 1.3): boolean {
    if (!h.alive || amount <= 0) return false;
    const now = this.time;
    h.hp -= amount * (head ? (h.helmet ? HELMET_MULT : HEAD_MULT) : 1);
    h.flinch = 1;
    h.sinceHurt = 0;
    const L = Math.hypot(dx, dz) || 1;
    if (h.hp <= 0) {
      h.alive = false;
      h.mode = 'dead';
      h.head = head;
      h.byPlayer = byPlayer;
      h.killDx = dx / L;
      h.killDz = dz / L;
      h.killPush = push;
      // 同伙倒下了：60 米内没在交火的都知道出事了，过去看（不是知道凶手在哪：去的是他倒下的地方）
      for (const m of h.sq.members) {
        if (m === h || !m.alive || m.tk === 1 || m.tk === 2 || Math.hypot(m.x - h.x, m.z - h.z) > 60) continue;
        m.alertT = Math.max(m.alertT, 25);
        if (m.lkT < now - 3) {
          m.lkx = h.x;
          m.lkz = h.z;
          m.lkT = now;
        }
      }
      this.env.on('die', h);
      return true;
    }
    this.env.on('hurt', h);
    // 挨了打：知道子弹从哪边来的（不是知道人在哪：往来的方向猜一个位置），转过去
    if (h.mode === 'heal') {
      this.setMode(h, 'look');
      h.idleT = 1;
      h.crouch = false;
    }
    let sx = h.x - (dx / L) * 18;
    let sz = h.z - (dz / L) * 18;
    let known = false;
    if (byPlayer && h.side === 'raider') {
      const p = this.env.player;
      const j = Math.min(6, Math.hypot(p.x - h.x, p.z - h.z) * 0.12);
      sx = p.x + (this.rnd() - 0.5) * j;
      sz = p.z + (this.rnd() - 0.5) * j;
      known = true;
    } else if (from && from.side !== h.side) {
      sx = from.x + (this.rnd() - 0.5) * 3;
      sz = from.z + (this.rnd() - 0.5) * 3;
      known = true;
    }
    if (h.seen > 0.5 && (known || now - h.lkT > 2)) {
      h.lkx = sx;
      h.lkz = sz;
      h.lkT = now;
      h.alertT = Math.max(h.alertT, 20);
      if (known) {
        const sq = h.sq;
        if (sq.lkT < now - 1) {
          sq.lkx = sx;
          sq.lkz = sz;
          sq.lkT = now;
          sq.lkKind = byPlayer ? 1 : 2;
        }
        for (const m of sq.members) if (m !== h) m.alertT = Math.max(m.alertT, 20);
      }
    }
    return false;
  }

  /** 射线打到的最近的人（返回的对象是复用的） */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): { id: number; dist: number; head: boolean; x: number; y: number; z: number } | null {
    let best = max;
    let who: Human | null = null;
    let head = false;
    for (const h of this.humans) {
      if (!h.alive) continue;
      const t = rayHuman(h, ox, oy, oz, dx, dy, dz, best);
      if (t >= 0 && t < best) {
        best = t;
        who = h;
        head = rayHead;
      }
    }
    if (!who) return null;
    const out = this.hit;
    out.id = who.id;
    out.dist = best;
    out.head = head;
    out.x = ox + dx * best;
    out.y = oy + dy * best;
    out.z = oz + dz * best;
    return out;
  }

  // ---------------------------------------------------------------- 移动

  /** 脚底该在多高：地形和脚下能站的碰撞体顶面（地板、台子）里高的那个 */
  private floor(h: Human): number {
    if (!h.grid) return h.gnd;
    if (Math.abs(h.x - h.topX) + Math.abs(h.z - h.topZ) > 0.25) {
      h.topX = h.x;
      h.topZ = h.z;
      h.top = this.env.world.topAt(h.x, h.z, RADIUS, Math.max(h.gnd, h.y), 0.45);
    }
    return Math.max(h.gnd, h.top);
  }

  /** 定下这一步朝哪个点走（结果放在 ax / az，arrived = 路走到头了但没到终点） */
  private steer(h: Human, gx: number, gz: number, dt: number): void {
    h.navT -= dt;
    if (h.nmode === 0) this.plan(h, gx, gz);
    else if (h.nmode === 1) {
      if (h.navT <= 0) this.plan(h, gx, gz);
    } else if (!h.full) {
      if (h.navT <= 0) this.plan(h, gx, gz);
    } else if (Math.hypot(gx - h.gx, gz - h.gz) > 1) {
      // 跟着路点走、终点挪了：最后一个拐点还直接看得到新终点，就只改最后一段；不然重新找
      const q = h.path;
      const n = q.length;
      const g = h.grid ?? this.nav.at(gx, gz);
      const fx = n >= 4 ? (q[n - 4] as number) : h.x;
      const fz = n >= 4 ? (q[n - 3] as number) : h.z;
      if (g && !g.blockedAt(gx, gz) && g.lineClear(fx, fz, gx, gz)) {
        q[n - 2] = gx;
        q[n - 1] = gz;
        h.gx = gx;
        h.gz = gz;
      } else if (h.navT <= 0) this.plan(h, gx, gz);
    }
    this.arrived = false;
    if (h.nmode !== 2) {
      this.ax = gx;
      this.az = gz;
      return;
    }
    const p = h.path;
    const last = p.length - 2;
    while (h.wp < last && Math.hypot((p[h.wp] as number) - h.x, (p[h.wp + 1] as number) - h.z) < 0.4) h.wp += 2;
    if (h.wp >= last && h.full) {
      this.ax = gx;
      this.az = gz;
      return;
    }
    this.ax = p[h.wp] as number;
    this.az = p[h.wp + 1] as number;
    if (h.wp >= last && Math.hypot(this.ax - h.x, this.az - h.z) < 0.4) this.arrived = true;
  }

  private plan(h: Human, gx: number, gz: number): void {
    const g = h.grid ?? this.nav.at(gx, gz);
    h.gx = gx;
    h.gz = gz;
    if (!g) {
      h.nmode = 1;
      h.navT = 1;
      return;
    }
    if (g.lineClear(h.x, h.z, gx, gz)) {
      h.nmode = 1;
      h.navT = 0.3 + this.rnd() * 0.2;
      return;
    }
    const r = this.route(g, h, gx, gz);
    // 这一帧找路的名额不够了：下一帧再来，先照旧走
    if (r === 3) {
      if (h.nmode === 0) h.nmode = 1;
      h.navT = 0.03;
      return;
    }
    if (r === 0 || h.path.length < 2) {
      h.nmode = 1;
      h.navT = 1.5;
      return;
    }
    h.nmode = 2;
    h.wp = 0;
    h.full = r === 1;
    h.navT = r === 1 ? 0.4 + this.rnd() * 0.3 : 2 + this.rnd();
  }

  /** 在位图上找一条到 (gx, gz) 的路，写进 h.path；进出房子时先走到门口（做法和丧尸的一样，见 zombie-brain.ts 的 route） */
  private route(g: SiteNav, h: Human, gx: number, gz: number): number {
    const nav = this.nav;
    const from = g.houseAt(h.x, h.z);
    const to = g.houseAt(gx, gz);
    if (from !== to && h.noDoor <= 0) {
      const via = VIA;
      via.length = 0;
      let sx = h.x;
      let sz = h.z;
      const d1 = from ? pickDoor(from, sx, sz, gx, gz, false) : null;
      if (d1) {
        via.push(d1.x, d1.z, d1.ox, d1.oz);
        sx = d1.ox;
        sz = d1.oz;
      }
      const d2 = to ? pickDoor(to, sx, sz, gx, gz, true) : null;
      if (d2) via.push(d2.ox, d2.oz, d2.x, d2.z);
      if (via.length) {
        via.push(gx, gz);
        const out = TMP;
        out.length = 0;
        sx = h.x;
        sz = h.z;
        let ok = true;
        for (let i = 0; i < via.length; i += 4) {
          const cap = nav.grant(2500);
          if (!cap) return 3;
          const r = g.path(sx, sz, via[i] as number, via[i + 1] as number, LEG, cap);
          nav.charge(g);
          if (r === 3 && cap < 2500) return 3;
          if (r !== 1) {
            ok = false;
            break;
          }
          for (let k = 0; k < LEG.length; k++) out.push(LEG[k] as number);
          if (i + 3 < via.length) {
            sx = via[i + 2] as number;
            sz = via[i + 3] as number;
            out.push(sx, sz);
          }
        }
        if (ok) {
          h.path.length = 0;
          for (let k = 0; k < out.length; k++) h.path.push(out[k] as number);
          return 1;
        }
        h.noDoor = 6;
      }
    }
    // 人只在地点里走几十米，用不着丧尸那么大的上限（一次展开 6000 格要两三毫秒）
    const lim = h.mode === 'walk' ? 2500 : 4000;
    const cap = nav.grant(lim);
    if (!cap) return 3;
    const r = g.path(h.x, h.z, gx, gz, h.path, cap, lim);
    nav.charge(g);
    return r;
  }

  private move(h: Human, dt: number, gx: number, gz: number, speed: number, face: number): void {
    const env = this.env;
    const w = env.world;
    let wx = 0;
    let wz = 0;
    let moving = speed > 0;
    if (moving) {
      this.steer(h, gx, gz, dt);
      let ux = this.ax - h.x;
      let uz = this.az - h.z;
      const L = Math.hypot(ux, uz);
      if (this.arrived || L < 0.05) moving = false;
      else {
        ux /= L;
        uz /= L;
        if (h.biasT > 0) {
          // 被什么东西顶住了：斜着绕一下
          h.biasT -= dt;
          const px = -uz * h.bias;
          const pz = ux * h.bias;
          ux = ux * 0.4 + px;
          uz = uz * 0.4 + pz;
          const n = Math.hypot(ux, uz);
          ux /= n;
          uz /= n;
        }
        if (Number.isNaN(face)) {
          face = Math.atan2(ux, uz);
          // 先转身再迈步
          speed *= 0.3 + 0.7 * Math.max(0, Math.cos(face - h.yaw));
        }
        speed = Math.min(speed, L / Math.max(dt, 1e-3));
        wx = ux * speed;
        wz = uz * speed;
      }
    }
    // 交火时横移（站着打的时候才晃；正在往哪走的时候只带一点）
    if (h.mode === 'fight' && h.strafe !== 0 && (h.tk === 1 || h.tk === 2)) {
      const k = (moving ? 0.5 : 1) * (h.crouch ? 0.5 : 1) * 1.7 * h.strafe;
      wx += Math.cos(h.aimYaw) * k;
      wz -= Math.sin(h.aimYaw) * k;
    }
    const k = Math.min(1, dt * 8);
    h.vx += (wx - h.vx) * k;
    h.vz += (wz - h.vz) * k;
    if (!Number.isNaN(face)) h.yaw += clamp(angDiff(face, h.yaw), -7 * dt, 7 * dt);
    const mx = h.vx;
    const mz = h.vz;
    let moved = 0;
    const nearPlayer = h.dist < RADIUS + PLAYER_R + 0.35 && !env.driving();
    if (mx * mx + mz * mz > 0.0009 || nearPlayer) {
      const ox = h.x;
      const oz = h.z;
      // 一步不超过 0.25 米：墙再薄也穿不过去
      const n = Math.max(1, Math.ceil((Math.hypot(mx, mz) * dt) / 0.25));
      const g = h.grid;
      const car = env.carNear ? env.carNear(ox, oz) : false;
      P.x = ox;
      P.z = oz;
      const tall = 1.75 - 0.5 * h.ck;
      for (let q = 0; q < n; q++) {
        P.x += (mx * dt) / n;
        P.z += (mz * dt) / n;
        // 身边 0.4 米内没有墙和家具、5 米内没有树和石头、附近没有车：这一步不用做碰撞
        if (!car && (!g || g.openAround(P.x, P.z))) {
          plants.length = 0;
          if (!w.plantsNear(P.x, P.z, 5, plants).length) continue;
        }
        w.collide(P, h.y, tall, RADIUS, 0.45);
      }
      // 深水不下去
      let gnd = w.groundAt(P.x, P.z);
      if (WATER - gnd > 0.9 && gnd < h.gnd) {
        P.x = ox;
        P.z = oz;
        gnd = h.gnd;
      }
      // 不走出自己的圈
      const Lh = h.leash;
      if (Lh) {
        const dx = P.x - Lh.x;
        const dz = P.z - Lh.z;
        const d = Math.hypot(dx, dz);
        if (d > Lh.r) {
          P.x = Lh.x + (dx / d) * Lh.r;
          P.z = Lh.z + (dz / d) * Lh.r;
        }
      }
      // 不挤进玩家身体里
      if (nearPlayer) {
        const pl = env.player;
        const dx = P.x - pl.x;
        const dz = P.z - pl.z;
        const min = RADIUS + PLAYER_R + 0.3;
        const d = Math.hypot(dx, dz);
        if (d < min && d > 1e-4 && Math.abs(pl.feet - h.y) < 1.6) {
          P.x = pl.x + (dx / d) * min;
          P.z = pl.z + (dz / d) * min;
          w.collide(P, h.y, tall, RADIUS, 0.45);
        }
      }
      h.x = P.x;
      h.z = P.z;
      moved = Math.hypot(P.x - ox, P.z - oz);
      h.gnd = gnd;
      const gy = this.floor(h);
      h.y += (gy - h.y) * Math.min(1, dt * 14);
      if (Math.abs(gy - h.y) > 1.2) h.y = gy;
    }
    const v = moved / Math.max(dt, 1e-3);
    h.sp += (v - h.sp) * Math.min(1, dt * 10);
    h.walkPhase += v * dt * 2.4;
    if (moving && speed > 0.2) {
      // 卡住：想走却没走出去 → 换一边斜着绕，并且马上重新找路
      if (moved < speed * dt * 0.3) h.stuck += dt;
      else h.stuck = Math.max(0, h.stuck - dt * 2);
      if (h.stuck > 0.4) {
        h.stuck = 0;
        h.bias = -h.bias;
        h.biasT = 0.45 + this.rnd() * 0.5;
        h.nmode = 0;
      }
      // 好几秒都在原地半米里打转：这个地方去不了，算到了
      if (Math.hypot(h.x - h.jx, h.z - h.jz) > 0.6) {
        h.jx = h.x;
        h.jz = h.z;
        h.jam = 0;
      } else {
        h.jam += dt;
        if (h.jam > 4) {
          h.jam = 0;
          h.goalX = h.x;
          h.goalZ = h.z;
          h.speed = 0;
          if (h.mode === 'search') h.lkT = Math.min(h.lkT, this.time - LOSE);
          if (h.mode === 'cover') h.modeT = Math.min(h.modeT, 0.5);
          if (h.flank === 1) h.flank = 2;
        }
      }
    }
  }
}
