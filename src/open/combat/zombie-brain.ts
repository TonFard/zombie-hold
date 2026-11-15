import { Rng } from '../../game/core/rng';
import type { Prey } from '../game/api';
import type { Vehicle } from '../vehicles/vehicle';
import type { Plant } from '../world/chunkgen';
import type { Door, Interior } from '../world/sites';
import { WATER } from '../world/terrain';
import type { World } from '../world/world';
import { FIELD_STEP, FRAME_EXPAND, MAX_EXPAND, Nav, type Field, type SiteNav } from './zombie-nav';
import { PUNCH_DUR, PUNCH_HIT, SPECS, headFactor, type KindSpec, type ZKind } from './zombie-types';

/**
 * 丧尸的行为和移动（纯逻辑，不碰 three：.logs/open/zedtest.ts 不开浏览器直接跑它）。
 *
 * 状态：idle 站着 → roam 在家附近晃 → 看见 / 听见 → chase 追（看不见了先去最后看见的地方）→ attack 出手（有前摇，到点还够得着才算打中）
 *       → 跟丢了 seek 去最后的位置 → look 张望一会 → 回家。挨打重了 stagger 硬直。
 * 移动：朝目标走，world.collide 负责贴着墙滑；直线走不通（隔着墙、家具）就在地点的位图上找一条路（zombie-nav.ts），所以进屋会走门。
 * 每只丧尸每秒只「想」5–8 次（看、听、换目标），错开；移动每帧都算（一步不超过墙的厚度）。
 */

export type ZState = 'idle' | 'roam' | 'seek' | 'look' | 'chase' | 'attack' | 'stagger' | 'dead';

export interface Zed {
  id: number;
  kind: ZKind;
  spec: KindSpec;
  seed: number;
  alive: boolean;
  x: number;
  /** 脚底的高度 */
  y: number;
  z: number;
  yaw: number;
  vx: number;
  vz: number;
  /** 被打退的速度（很快衰减） */
  kx: number;
  kz: number;
  /** 实际走出来的速度（平滑过，动画用） */
  sp: number;
  /** 脚下地形的高度；脚下能站的碰撞体顶面（地板、台子）和上次查它时的位置 */
  gnd: number;
  top: number;
  topX: number;
  topZ: number;
  /** 远处的隔帧才算一次：攒着的时间 */
  acc: number;
  /** 这一帧被别的丧尸挤了一下（不走路也要做一次碰撞，免得被挤进墙里） */
  pushed: boolean;
  hp: number;
  /** 钢板还能吃多少伤害（只有重装有） */
  plate: number;
  state: ZState;
  /** 进入现在这个状态多久了 */
  t: number;
  // ---- 家：闲逛、跟丢以后回这里
  hx: number;
  hz: number;
  house: Interior | null;
  /** 占的是哪个坑位（0 = 不占：夜里游荡的、调试刷的） */
  slot: number;
  /** 只在夜里出现的：天亮以后离远了就撤掉 */
  nightOnly: boolean;
  /** 夜里成群游荡的：家会跟着玩家挪 */
  roamer: boolean;
  rehome: number;
  // ---- 感知
  think: number;
  /** 多久没察觉到玩家了（秒） */
  seen: number;
  /** 最后一次察觉到玩家时玩家在哪 */
  lkx: number;
  lkz: number;
  /** 刚发现玩家：愣一下再追 */
  react: number;
  /** 听见动静赶过去：离得近的跑着去 */
  fast: boolean;
  /** 离玩家（或者玩家的车）多远 */
  dist: number;
  // ---- 找路
  grid: SiteNav | null;
  /** 0 = 还没定，1 = 直着走，2 = 跟着路点走 */
  mode: number;
  path: number[];
  wp: number;
  /** 路是不是通到终点（false = 只到离终点最近的地方） */
  full: boolean;
  navT: number;
  /** 现在这条路是朝哪个终点规划的 */
  gx: number;
  gz: number;
  /** 走门没走通（门被堵了）：这么久以内找路不看门 */
  noDoor: number;
  /** 现在这条路是从远路（Field）读出来的：终点挪了不用马上重找，照着走，只剩最后一两段了再按平常的办法跟 */
  long: boolean;
  /** 在等远路铺好（等的是 fgrid 这张图上、终点在 gx / gz 附近的那张） */
  far: boolean;
  fgrid: SiteNav | null;
  /** 这么久以内不再要远路（刚要过）。要了以后一直没等到（小于 -6）就不等了 */
  farT: number;
  /** 远路也到不了（真的围死了）：这么久以内不再要 */
  noWay: number;
  /** 闲逛 / 去看动静的目的地 */
  tx: number;
  tz: number;
  // ---- 卡住
  stuck: number;
  side: number;
  sideT: number;
  /** 卡死检测：上次记下的位置，在它周围半米里转了多久 */
  jx: number;
  jz: number;
  jam: number;
  // ---- 出手
  /** 出手动作的进度 0–1（PUNCH_HIT 那一刻判定），<0 = 没在出手 */
  atk: number;
  struck: boolean;
  cool: number;
  // ---- 受击
  stun: number;
  /** 这么久以内不会再被打出硬直（不然一根棒球棍能把它一直敲到死） */
  poise: number;
  /** 受击的抖动 1 → 0（动画用） */
  flinch: number;
  carT: number;
  idle: number;
  // ---- 目标
  /** 给这一批起的编号（0 = 平时的）。带编号的不按距离撤、不占平时的上限（horde.ts） */
  tag: number;
  /** 追人的速度乘多少 */
  haste: number;
  /** 0 = 自己看、自己听；1 = 盯死玩家；2 = 盯死 prey 这一个（它没了改成 3）；3 = 追最近的活人。不是 0 的不用看见也知道目标在哪，不会跟丢 */
  hunt: number;
  /** 现在追的是谁：null = 玩家 */
  prey: Tgt | null;
  /** 多久以后再看看有没有更近的（只有 hunt = 3 用） */
  pick: number;
  /** 离现在的目标多远（dist 是离玩家多远） */
  td: number;
  /** 最后挨的那一下是不是玩家打的（打死了算不算玩家的） */
  byPlayer: boolean;
  // ---- 死
  head: boolean;
  fallFwd: boolean;
  /** 渲染层挂在这里的东西 */
  view: unknown;
}

export type ZEvent = 'aggro' | 'swing' | 'hit' | 'hurt' | 'die';

/** 登记进来的一个 Prey（玩家以外会被追的东西：带枪的人、发电机），和丧尸对它出手的节奏 */
export interface Tgt {
  prey: Prey;
  /** 撤掉了（removePrey）：还指着它的丧尸下一次轮到时换目标 */
  gone: boolean;
  /** 现在有几只正在对它出手；还要隔多久下一只才能出手 */
  attacking: number;
  gap: number;
}

export interface BrainEnv {
  world: World;
  player: { x: number; z: number; feet: number; eye: number; yaw: number; speed: number; sprinting: boolean; crouch: number };
  /** 玩家正在开的车（没在开 = null） */
  driving(): Vehicle | null;
  vehicles(): readonly Vehicle[];
  /** 0 白天 … 1 深夜 */
  night(): number;
  playerDead(): boolean;
  hurt(amount: number, fromX: number, fromZ: number): void;
  on(ev: ZEvent, z: Zed): void;
  /**
   * 车的改装（game/api.ts 的 CAR）：armor = 人在车里时丧尸的伤害乘多少，ram = 撞丧尸的伤害倍率，
   * onRam = 撞到一只时通知车辆模块让车减速（撞上时的车速 米/秒、丧尸多重 千克）
   */
  car: { armor: number; ram: number; onRam(speed: number, kg: number): void };
}

const PLAYER_R = 0.34;
/**
 * 贴身时身体停在离玩家身体边缘这么远的地方（行尸：中心到中心 0.3 + 0.34 + 0.55 = 1.19 米）。
 * 再近的话出手时探过来的头会糊在镜头上；出手的动作本身能探进来 0.6 米多，够得着
 */
const HOLD = 0.55;
/** 被后面的挤、或者玩家自己走过来：身体边缘最近也隔这么远（中心到中心 1.06 米），会被顶开 */
const HOLD_MIN = 0.42;
/** 出手那一刻离玩家身体边缘不超过 reach + 这么多才算打中（前摇的 0.6 秒里退开半步就打空） */
const STRIKE_SLACK = 0.12;
/**
 * 两只丧尸先后出手至少隔这么久（秒），白天 / 夜里（围着车时按夜里算）：一群围上来时是一下一下挨，不是同一帧挨好几下。
 * 单独一只不受影响（它自己一轮要两秒）。三只以上的行尸：白天 10 点 / 1.35 秒 ≈ 7.4 点/秒（满血站着不动 12 秒多死），
 * 夜里 10 点 / 0.85 秒 ≈ 11.8 点/秒（8 秒左右）；行尸追人 2.2 米/秒，走着就能甩开
 */
const ATK_GAP_DAY = 1.35;
const ATK_GAP_NIGHT = 0.85;
/**
 * 半径超过 BIG_R 的目标算大件（守城的发电机）：周围站得下十几只，同时出手的最多 3 只、两次出手隔 0.6 秒。
 * 行尸一下 10 点：一只 5 点/秒，两只 10，三只以上封顶 16 点/秒左右 —— 围上来的越多掉得越快，但不会一瞬间打光
 */
const BIG_R = 0.6;
const ATK_GAP_BIG = 0.6;
/** 挑目标时，已经有一只正在对它出手的目标算远这么多米：围着一个人干等的会去咬旁边的人 */
const CROWD = 3;
/** 白天、玩家站着时能看多远（米）；夜里、玩家蹲着时更短 */
const SIGHT = 36;
/** 视野：正面 ±80° */
const CONE = Math.cos((80 * Math.PI) / 180);
const TAU = Math.PI * 2;
const P = { x: 0, z: 0 };
const plants: Plant[] = [];
const VIA: number[] = [];
const LEG: number[] = [];
const TMP: number[] = [];
/** 走门的那几段每段最多展开多少格（门口一般几百格就到；到不了说明门被堵了，换成不看门直接找） */
const LEG_EXPAND = 2500;

/** 这栋房子的哪扇门最顺路：enter = 从外面 (sx, sz) 进去到 (gx, gz)，否则是从里面 (sx, sz) 出来去 (gx, gz) */
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

function turnTo(yaw: number, want: number, step: number): number {
  let d = (want - yaw) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return yaw + Math.max(-step, Math.min(step, d));
}

export class Brain {
  readonly zeds: Zed[] = [];
  readonly nav: Nav;
  private readonly rng = new Rng(20261114);
  private nextId = 1;
  private stepT = 0;
  private frame = 0;
  /** 玩家以外会被追的东西 */
  readonly preys: Tgt[] = [];
  /** 丧尸不理玩家：看见了不追、不打、不挤（Prey 照追） */
  passive = false;
  /** 对玩家出手的节奏：现在有几只正在出手、还要隔多久下一只才能出手（每个 Prey 各有一份，见 Tgt） */
  private readonly self = { attacking: 0, gap: 0 };
  /** 正在算的这只丧尸的目标：位置、身体的半径、脚底的高度；car = 目标是坐在这辆车里的玩家（见 focus） */
  private tx = 0;
  private tz = 0;
  private tr = PLAYER_R;
  private tf = 0;
  private car: Vehicle | null = null;
  /** 玩家正在开的车 */
  private driven: Vehicle | null = null;
  /** aware() 量出来的视线终点：位置、在目标前面多远停下、目标是不是坐在车里 */
  private vx = 0;
  private vy = 0;
  private vz = 0;
  private vpad = 0;
  private vcar: Vehicle | null = null;
  private ax = 0;
  private az = 0;
  private arrived = false;

  constructor(private readonly env: BrainEnv) {
    this.nav = new Nav(env.world);
  }

  private rnd(): number {
    return this.rng.next();
  }

  /** 放一只丧尸（位置要调用方保证能站） */
  spawn(
    kind: ZKind,
    x: number,
    z: number,
    o: { house?: Interior | null; slot?: number; yaw?: number; nightOnly?: boolean; roamer?: boolean; hx?: number; hz?: number; tag?: number; hunt?: number | 'near'; hp?: number; speedMul?: number } = {},
  ): Zed {
    const spec = SPECS[kind];
    const id = this.nextId++;
    const hp = o.hp !== undefined && o.hp > 0 ? o.hp : spec.hp;
    const zed: Zed = {
      id,
      kind,
      spec,
      seed: (Math.imul(id, 2654435761) ^ Math.floor(this.rnd() * 0xffff)) >>> 0,
      alive: true,
      x,
      y: 0,
      z,
      yaw: o.yaw ?? this.rnd() * TAU,
      vx: 0,
      vz: 0,
      kx: 0,
      kz: 0,
      sp: 0,
      gnd: 0,
      top: -Infinity,
      topX: Infinity,
      topZ: Infinity,
      acc: 0,
      pushed: false,
      hp,
      plate: spec.armor ? spec.armor.plate * hp : 0,
      state: 'idle',
      t: 0,
      hx: o.hx ?? x,
      hz: o.hz ?? z,
      house: o.house ?? null,
      slot: o.slot ?? 0,
      nightOnly: o.nightOnly ?? false,
      roamer: o.roamer ?? false,
      rehome: 20 + this.rnd() * 20,
      think: this.rnd() * 0.3,
      seen: 99,
      lkx: x,
      lkz: z,
      react: 0,
      fast: false,
      dist: 999,
      grid: null,
      mode: 0,
      path: [],
      wp: 0,
      full: true,
      navT: 0,
      gx: x,
      gz: z,
      noDoor: 0,
      long: false,
      far: false,
      fgrid: null,
      farT: 0,
      noWay: 0,
      tx: x,
      tz: z,
      stuck: 0,
      side: id & 1 ? 1 : -1,
      sideT: 0,
      jx: x,
      jz: z,
      jam: 0,
      atk: -1,
      struck: false,
      cool: 0,
      stun: 0,
      poise: 0,
      flinch: 0,
      carT: 0,
      idle: 1 + this.rnd() * 6,
      tag: o.tag ?? 0,
      haste: o.speedMul !== undefined && o.speedMul > 0 ? o.speedMul : 1,
      hunt: 0,
      prey: null,
      pick: 0,
      td: 999,
      byPlayer: true,
      head: false,
      fallFwd: false,
      view: null,
    };
    zed.grid = this.nav.at(x, z);
    zed.gnd = this.env.world.groundAt(x, z);
    zed.y = zed.gnd;
    zed.y = this.floor(zed);
    // 夜里游荡的：一出来就往家（玩家附近）走
    if (zed.roamer) this.go(zed, 'roam', zed.hx, zed.hz);
    const h = o.hunt;
    if (h === 'near') zed.hunt = 3;
    else if (h === 0) zed.hunt = 1;
    else if (h !== undefined && h > 0) {
      // 要追的那个 Prey 没登记（已经死了）：改成追最近的
      zed.prey = this.tgtOf(h);
      zed.hunt = zed.prey ? 2 : 3;
    }
    // 盯死目标的：第一帧就想，一出来就追
    if (zed.hunt) zed.think = 0;
    this.zeds.push(zed);
    return zed;
  }

  /** 登记一个会被追的东西（同一个 id 再登记一次 = 换成新的） */
  addPrey(p: Prey): void {
    const a = this.preys;
    for (let i = a.length - 1; i >= 0; i--) {
      const t = a[i] as Tgt;
      if (t.prey === p) return;
      if (t.prey.id === p.id) {
        t.gone = true;
        a.splice(i, 1);
      }
    }
    a.push({ prey: p, gone: false, attacking: 0, gap: 0 });
  }

  removePrey(p: Prey): void {
    const a = this.preys;
    for (let i = a.length - 1; i >= 0; i--) {
      const t = a[i] as Tgt;
      if (t.prey !== p && t.prey.id !== p.id) continue;
      t.gone = true;
      a.splice(i, 1);
    }
  }

  private tgtOf(id: number): Tgt | null {
    const a = this.preys;
    for (let i = 0; i < a.length; i++) if ((a[i] as Tgt).prey.id === id) return a[i] as Tgt;
    return null;
  }

  /** 从名单里拿掉（走远了撤掉、死了转成尸体） */
  remove(z: Zed): void {
    const i = this.zeds.indexOf(z);
    if (i >= 0) {
      this.zeds[i] = this.zeds[this.zeds.length - 1] as Zed;
      this.zeds.pop();
    }
  }

  // ---------------------------------------------------------------- 每帧

  update(dt: number): void {
    const env = this.env;
    const p = env.player;
    this.nav.budget = FRAME_EXPAND;
    this.nav.first = true;
    this.driven = env.driving();
    this.car = this.driven;
    this.tx = p.x;
    this.tz = p.z;
    // 脚步声 / 发动机：每 0.4 秒往外「响」一下（丧尸不理玩家的时候不算）
    this.stepT -= dt;
    if (this.stepT <= 0 && !env.playerDead() && !this.passive) {
      this.stepT = 0.4;
      const car = this.driven;
      if (car) {
        if (car.body.engineOn) this.noise(p.x, p.z, 16 + Math.min(50, Math.abs(car.body.speed) * 2.4), true);
      } else if (p.crouch < 0.5) {
        if (p.sprinting && p.speed > 5) this.noise(p.x, p.z, 11, true);
        else if (p.speed > 2.5) this.noise(p.x, p.z, 4.5, true);
      }
    }
    const zeds = this.zeds;
    // 互相挤开一点（只管离玩家 60 米以内的：远处的叠在一起也看不出来）
    for (let i = 0; i < zeds.length; i++) {
      const a = zeds[i] as Zed;
      if (a.dist > 60) continue;
      for (let j = i + 1; j < zeds.length; j++) {
        const b = zeds[j] as Zed;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const min = a.spec.radius + b.spec.radius + 0.12;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min || d2 < 1e-6 || Math.abs(a.y - b.y) > 1.5) continue;
        const d = Math.sqrt(d2);
        // 一帧只推开重叠的一部分：软的，不会在门口互相弹来弹去
        const push = ((min - d) / d) * Math.min(0.5, dt * 6);
        const wa = b.spec.mass / (a.spec.mass + b.spec.mass);
        a.x -= dx * push * wa;
        a.z -= dz * push * wa;
        b.x += dx * push * (1 - wa);
        b.z += dz * push * (1 - wa);
        a.pushed = b.pushed = true;
      }
    }
    // 35 米以外的隔一帧算一次、70 米以外隔两帧（时间攒着一起走）：远处看不出差别
    const f = ++this.frame;
    // 出手的节奏是按目标记的：玩家和他旁边的同伴各挨各的，不抢同一个名额
    const self = this.self;
    self.gap -= dt;
    self.attacking = 0;
    const preys = this.preys;
    for (let i = 0; i < preys.length; i++) {
      const t = preys[i] as Tgt;
      t.gap -= dt;
      t.attacking = 0;
    }
    for (let i = 0; i < zeds.length; i++) {
      const z = zeds[i] as Zed;
      if (z.state === 'attack') (z.prey ?? self).attacking++;
    }
    for (let i = zeds.length - 1; i >= 0; i--) {
      const z = zeds[i] as Zed;
      z.acc += dt;
      const stride = z.dist < 35 ? 1 : z.dist < 70 ? 2 : 3;
      if (stride > 1 && (f + z.id) % stride) continue;
      const t = z.acc;
      z.acc = 0;
      this.step(z, t);
    }
    this.farStep();
    this.runOver();
  }

  /**
   * 远路（zombie-nav.ts 的 Field）：一帧铺一截；铺好以后把路发给等着的丧尸（一帧最多发 3 只：拉直一条上百米的路要零点一毫秒多）。
   * 等着的丧尸这期间照旧走原来那条（到围栏边上离人最近那一点的）路
   */
  private farStep(): void {
    const f = this.nav.field;
    const zeds = this.zeds;
    if (f.state === 1) {
      // 这一帧找路剩下的名额给它，至少 400 格
      let done = f.run(Math.max(400, Math.min(FIELD_STEP, this.nav.budget)));
      if (!done) {
        // 等这张图的丧尸都已经铺到了：后面的不用铺
        let any = false;
        done = true;
        for (let i = 0; i < zeds.length; i++) {
          const z = zeds[i] as Zed;
          if (!z.far || !this.fits(z, f)) continue;
          any = true;
          if (!f.reached(z.x, z.z)) {
            done = false;
            break;
          }
        }
        // 没人等了（死了、不追了、终点挪远了）：不铺了
        if (!any) {
          f.state = 0;
          return;
        }
        if (!done) return;
      }
      f.state = 2;
    }
    if (f.state === 2) {
      let n = 0;
      for (let i = 0; i < zeds.length; i++) {
        const z = zeds[i] as Zed;
        if (!z.far || !this.fits(z, f)) continue;
        if (n++ >= 3) return;
        z.far = false;
        if (f.trace(z.x, z.z, z.path) && z.path.length >= 2) {
          z.mode = 2;
          z.wp = 0;
          z.full = true;
          z.long = true;
          z.navT = 0.5;
        } else if (f.whole) {
          // 能到的地方都铺过了还是没有它（围死了，或者要绕到很远的大门）：顶着围栏站着，过一阵再问
          z.noWay = 20 + this.rnd() * 10;
        }
      }
      f.state = 0;
      return;
    }
    for (let i = 0; i < zeds.length; i++) {
      const z = zeds[i] as Zed;
      if (!z.far) continue;
      if (z.fgrid && f.begin(z.fgrid, z.gx, z.gz)) return;
      z.far = false;
      z.noWay = 20;
    }
  }

  /** 这只丧尸等的是不是这张远路 */
  private fits(z: Zed, f: Field): boolean {
    return z.fgrid === f.grid && Math.abs(z.gx - f.gx) + Math.abs(z.gz - f.gz) < 10;
  }

  /** 要一张到 (gx, gz) 的远路 */
  private askFar(z: Zed, gx: number, gz: number): void {
    const g = z.grid ?? this.nav.at(gx, gz);
    if (!g) return;
    z.far = true;
    z.fgrid = g;
    z.farT = 1.5 + this.rnd();
    z.gx = gx;
    z.gz = gz;
  }

  private step(z: Zed, dt: number): void {
    if (!z.alive) return;
    const s = z.spec;
    z.t += dt;
    z.cool -= dt;
    z.carT -= dt;
    z.noDoor -= dt;
    z.farT -= dt;
    z.noWay -= dt;
    // 不追了、或者等了很久没等到：不等远路了
    if (z.far && (z.farT < -6 || z.state === 'idle' || z.state === 'roam' || z.state === 'look')) z.far = false;
    z.poise -= dt;
    if (z.flinch > 0) z.flinch = Math.max(0, z.flinch - dt * 3.5);
    // 追着的东西没了（死了、撤了），或者现在不理玩家了：换目标 / 不追了
    const t0 = z.prey;
    if (t0) {
      if (t0.gone || !t0.prey.alive) this.lost(z);
    } else if (this.passive && (z.state === 'chase' || z.state === 'attack')) {
      this.giveUp(z);
      // 追最近的活人的：马上再挑一个（Prey）
      z.pick = 0;
      z.think = Math.min(z.think, 0.05);
    }
    let d = this.focus(z);
    z.think -= dt;
    if (z.think <= 0) {
      // 离玩家近的、离自己的目标近的想得勤
      const near = Math.min(d, z.dist);
      z.think = (near < 30 ? 0.13 : near < 60 ? 0.28 : 0.7) * (0.8 + 0.4 * this.rnd());
      this.perceive(z, d);
      // 想的时候可能换了目标
      d = this.focus(z);
    }
    const dx = this.tx - z.x;
    const dz = this.tz - z.z;
    let speed = 0;
    let gx = z.x;
    let gz = z.z;
    let face = NaN;
    switch (z.state) {
      case 'idle':
        z.idle -= dt;
        if (z.roamer && !this.passive) {
          // 游荡的一群：隔一阵把「家」挪到玩家附近，慢慢围过来
          z.rehome -= dt;
          if (z.rehome <= 0) {
            z.rehome = 25 + this.rnd() * 25;
            const a = this.rnd() * TAU;
            const r = 6 + this.rnd() * 22;
            const me = this.env.player;
            z.hx = me.x + Math.sin(a) * r;
            z.hz = me.z + Math.cos(a) * r;
            this.go(z, 'roam', z.hx, z.hz);
            break;
          }
        }
        if (z.idle <= 0) this.pickRoam(z);
        break;
      case 'roam':
        gx = z.tx;
        gz = z.tz;
        speed = s.roam * (z.roamer ? 1.35 : 1);
        if (Math.hypot(gx - z.x, gz - z.z) < 0.6 || z.t > 40) this.rest(z);
        break;
      case 'seek':
        if (z.react > 0) {
          z.react -= dt;
          face = Math.atan2(z.lkx - z.x, z.lkz - z.z);
          break;
        }
        gx = z.lkx;
        gz = z.lkz;
        speed = s.chase * (z.fast ? 0.9 : 0.6);
        // 一般 30 秒走不到就算了；在绕远路的（围栏外绕到大门，上百米）给够时间
        if (Math.hypot(gx - z.x, gz - z.z) < 1.3 || z.t > (z.long || z.far ? 110 : 30)) {
          z.state = 'look';
          z.t = 0;
          z.idle = 3 + this.rnd() * 3;
        }
        break;
      case 'look':
        // 原地张望：慢慢转身，没发现什么就回家
        z.yaw += dt * 0.9 * z.side;
        z.idle -= dt;
        if (z.idle <= 0) this.go(z, 'roam', z.hx, z.hz);
        break;
      case 'chase': {
        if (z.react > 0) {
          z.react -= dt;
          face = Math.atan2(dx, dz);
          break;
        }
        // 盯死目标的（hunt）不用看见也知道它在哪
        const track = z.seen < 1.5 || z.hunt > 0;
        gx = track ? this.tx : z.lkx;
        gz = track ? this.tz : z.lkz;
        speed = s.chase * z.haste;
        const edge = this.edge(z, d);
        // 大件的东西（发电机）：中心在它自己的碰撞体里，走不到；看得见它以后朝它靠自己这一侧的边上走。
        // 还没看见的时候（隔着墙）照旧朝中心找路：路会通到它周围离中心最近的空地上，多半就是敞着的那一面
        const big = this.tr > BIG_R;
        if (track && big && z.seen < 1.5 && d > 1e-3) {
          const k = Math.min(1, (this.tr + s.radius + 0.3) / d);
          gx = this.tx - dx * k;
          gz = this.tz - dz * k;
        }
        if (track && edge < s.reach) {
          face = Math.atan2(dx, dz);
          let da = (face - z.yaw) % TAU;
          if (da > Math.PI) da -= TAU;
          else if (da < -Math.PI) da += TAU;
          // 同时对一个目标出手的只数有上限（白天一只、夜里两只，围着车时两只；发电机这种大件三只）：被一群围住也来得及跑，夜里更凶
          const fierce = !!this.car || this.env.night() > 0.5;
          const most = big ? 3 : fierce ? 2 : 1;
          const m = z.prey ?? this.self;
          if (z.cool <= 0 && z.seen < 0.6 && Math.abs(da) < 1.0 && m.attacking < most && m.gap <= 0) {
            m.attacking++;
            m.gap = big ? ATK_GAP_BIG : fierce ? ATK_GAP_NIGHT : ATK_GAP_DAY;
            z.state = 'attack';
            z.t = 0;
            z.atk = 0;
            z.struck = false;
            this.env.on('swing', z);
          }
        } else if (!track && Math.hypot(gx - z.x, gz - z.z) < 1.2) speed = 0;
        // 到了该停的距离就站住，不再往里挤。速度是慢慢降下来的（move 里 1/7 秒的惯性），所以按现在的速度提前收脚：
        // 行尸在 0.86 米、奔跑者在 1.25 米开始减速，正好停在 HOLD 上
        // 盯死目标的隔着围栏、隔着墙（一直看不见）时不站住：接着绕过去
        if (track && z.seen < 1.5 && edge < HOLD + z.sp * 0.14) speed = 0;
        break;
      }
      case 'attack':
        z.atk += (dt * s.swing) / PUNCH_DUR;
        face = Math.atan2(dx, dz);
        // 前摇时还往前蹭：玩家后退得不够快照样挨打（和追的时候一样按现在的速度提前收脚，停在 HOLD 上）
        if (z.atk < PUNCH_HIT && this.edge(z, d) > HOLD + z.sp * 0.14) {
          gx = this.tx;
          gz = this.tz;
          speed = s.chase * z.haste * 0.4;
        }
        if (!z.struck && z.atk >= PUNCH_HIT) {
          z.struck = true;
          this.strike(z, d);
        }
        if (z.atk >= 1) {
          z.atk = -1;
          z.state = 'chase';
          z.t = 0;
          z.cool = s.rest * (0.8 + 0.4 * this.rnd());
        }
        break;
      case 'stagger':
        z.stun -= dt;
        if (z.stun <= 0) {
          z.state = z.hunt || z.seen < s.lose ? 'chase' : 'seek';
          z.t = 0;
          z.mode = 0;
        }
        break;
      default:
        break;
    }
    this.move(z, dt, gx, gz, speed, face);
  }

  /**
   * 把这只丧尸现在的目标放进 tx / tz / tr / tf（car = 目标是坐在车里的玩家），顺手记下离玩家、离目标多远。返回离目标多远。
   * step 里的每一步（看、追、出手、被顶开）都按这几个数算，所以换了目标以后要再调一次
   */
  private focus(z: Zed): number {
    const p = this.env.player;
    const t = z.prey;
    if (t) {
      const q = t.prey;
      this.tx = q.x;
      this.tz = q.z;
      this.tr = q.radius;
      this.tf = q.feet;
      this.car = null;
      z.dist = Math.hypot(p.x - z.x, p.z - z.z);
    } else {
      this.tx = p.x;
      this.tz = p.z;
      this.tr = PLAYER_R;
      this.tf = p.feet;
      this.car = this.driven;
    }
    const d = Math.hypot(this.tx - z.x, this.tz - z.z);
    z.td = d;
    if (!t) z.dist = d;
    return d;
  }

  /** 离目标身体边缘（目标是开着车的玩家时是车壳）多远 */
  private edge(z: Zed, d: number): number {
    const car = this.car;
    if (car) return car.distance(z.x, z.z) - z.spec.radius;
    return d - z.spec.radius - this.tr;
  }

  // ---------------------------------------------------------------- 感知

  private perceive(z: Zed, d: number): void {
    const env = this.env;
    const s = z.spec;
    z.grid = this.nav.at(z.x, z.z);
    const hunting = z.state === 'chase' || z.state === 'attack' || z.state === 'stagger';
    if (z.hunt) {
      this.stalk(z, hunting);
      return;
    }
    let saw = false;
    if (!hunting) {
      // 没在追：看见谁追谁（玩家、Prey 里最划算的那个）
      const t = this.choose(z, true);
      if (t !== undefined) {
        z.prey = t;
        saw = true;
      }
    } else {
      z.pick -= z.think;
      if (z.pick <= 0 && z.state === 'chase' && this.preys.length) {
        // 正追着：隔一秒左右看看旁边有没有更划算的（近得多的、没被围着的）
        z.pick = 0.8 + 0.5 * this.rnd();
        const t = this.choose(z, true);
        if (t !== undefined) {
          if (t !== z.prey) {
            z.prey = t;
            z.mode = 0;
          }
          saw = true;
        }
      } else saw = this.spots(z, z.prey, true);
    }
    if (saw) {
      d = this.focus(z);
      z.seen = 0;
      z.lkx = this.tx;
      z.lkz = this.tz;
      if (!hunting) this.aggro(z, d);
      return;
    }
    z.seen += z.think;
    if (z.state === 'chase') {
      // 刚拐过墙角：还知道人往哪去了
      if (z.seen < 1.5) {
        z.lkx = this.tx;
        z.lkz = this.tz;
      } else if (!z.prey && env.playerDead()) {
        z.state = 'look';
        z.t = 0;
        z.idle = 3 + this.rnd() * 4;
      } else if (z.seen > s.lose) {
        // 跟丢了：不是原地放弃，先走到最后看见人的地方（隔着窗户看见的，绕到门口进屋要十几秒），到了再张望
        z.fast = true;
        z.react = 0;
        this.go(z, 'seek', z.lkx, z.lkz);
      }
    }
  }

  /**
   * 盯死目标的（spawnAt 的 hunt：守城的一波、生化模式的）：不用看见也知道目标在哪，不会跟丢。
   * 看不看得见照样记着（seen）：隔着墙不能出手
   */
  private stalk(z: Zed, hunting: boolean): void {
    if (z.hunt === 3) {
      z.pick -= z.think;
      if (z.pick <= 0) {
        z.pick = 0.7 + 0.5 * this.rnd();
        this.repick(z);
      }
    }
    this.focus(z);
    // 没有能追的（玩家死了、不理玩家、活人都没了）：原地张望，等有了再追
    if (!z.prey && (this.passive || this.env.playerDead())) {
      if (z.state === 'chase' || z.state === 'attack') this.giveUp(z);
      z.seen = 99;
      return;
    }
    z.seen = this.spots(z, z.prey, true) ? 0 : z.seen + z.think;
    z.lkx = this.tx;
    z.lkz = this.tz;
    if (!hunting) {
      z.state = 'chase';
      z.t = 0;
      z.mode = 0;
      z.atk = -1;
      z.react = 0.15 + 0.2 * this.rnd();
      this.env.on('aggro', z);
    }
  }

  /** 追最近的活人的（hunt = 3）：重新挑一次目标 */
  private repick(z: Zed): void {
    // 出手到一半不换
    if (z.state === 'attack') return;
    const t = this.choose(z, false) ?? null;
    if (t === z.prey) return;
    z.prey = t;
    z.mode = 0;
  }

  /**
   * 挑目标：活着的人（玩家、Prey）里最划算的那个。离得近的优先；已经有丧尸正在对它出手的往后排（每只算远 CROWD 米），
   * 所以围着一个人干等的会去咬他旁边的人；正追着的那个打七折，不然两个差不多远的会来回换。
   * sense = 要看得见才算（平时的丧尸；最多查两条视线）。null = 玩家，undefined = 一个也没有
   */
  private choose(z: Zed, sense: boolean): Tgt | null | undefined {
    const p = this.env.player;
    const a = this.preys;
    const busy = z.state === 'chase' || z.state === 'attack' || z.state === 'stagger';
    const cur = z.prey;
    const noPlayer = this.passive || this.env.playerDead();
    // 第一轮挑出来的要是看不见，第二轮跳过它再挑
    let skip: Tgt | null | undefined;
    for (let round = 0; round < 2; round++) {
      let best: Tgt | null | undefined;
      let bs = Infinity;
      if (skip !== null && !noPlayer) {
        const mine = busy && !cur;
        const d = sense ? this.aware(z, null, mine) : Math.hypot(p.x - z.x, p.z - z.z);
        if (d >= 0) {
          bs = d * (mine ? 0.7 : 1) + this.self.attacking * CROWD;
          best = null;
        }
      }
      for (let i = 0; i < a.length; i++) {
        const t = a[i] as Tgt;
        if (t === skip || !t.prey.alive) continue;
        const mine = busy && t === cur;
        const d = sense ? this.aware(z, t, mine) : Math.hypot(t.prey.x - z.x, t.prey.z - z.z);
        if (d < 0) continue;
        const sc = d * (mine ? 0.7 : 1) + t.attacking * CROWD;
        if (sc < bs) {
          bs = sc;
          best = t;
        }
      }
      if (best === undefined || !sense) return best;
      if (this.spots(z, best, busy && best === cur)) return best;
      skip = best;
    }
    return undefined;
  }

  /** 追着的那个 Prey 没了（死了、撤了） */
  private lost(z: Zed): void {
    z.prey = null;
    z.mode = 0;
    const busy = z.state === 'chase' || z.state === 'attack';
    if (!z.hunt) {
      // 平时的：愣一下，马上再看看周围还有谁
      if (busy) this.giveUp(z);
      z.think = Math.min(z.think, 0.05);
      return;
    }
    // 盯着它的：改成追最近的活人，现在就挑（不然中间这一下会去追玩家）
    z.hunt = 3;
    if (z.state === 'attack') {
      z.state = 'chase';
      z.t = 0;
      z.atk = -1;
    }
    z.pick = 0.7 + 0.5 * this.rnd();
    this.repick(z);
  }

  /** 不追了：原地张望一会，然后回家 */
  private giveUp(z: Zed): void {
    z.state = 'look';
    z.t = 0;
    z.atk = -1;
    z.seen = 99;
    z.idle = 2 + this.rnd() * 3;
  }

  /**
   * 这个目标（t = null 是玩家）够不够近、在不在视野里（不管中间挡没挡）。行就返回离它多远，并把视线的终点记在 vx / vy / vz / vpad / vcar 里；
   * 不行返回 -1。hunting = 已经盯上它了（看得更远、不管视野）
   */
  private aware(z: Zed, t: Tgt | null, hunting: boolean): number {
    const env = this.env;
    let range = SIGHT * (1 - 0.45 * env.night());
    // 贴身：背对着也察觉得到
    let close = 3.2;
    if (t) {
      const q = t.prey;
      if (t.gone || !q.alive) return -1;
      this.vx = q.x;
      this.vz = q.z;
      this.vy = q.feet + Math.min(q.height * 0.9, 1.6);
      // 视线停在它身体前面：发电机这种自己就是个碰撞体
      this.vpad = q.radius + 0.3;
      this.vcar = null;
    } else {
      if (this.passive || env.playerDead()) return -1;
      const p = env.player;
      const car = this.driven;
      if (car) range *= 1.3;
      else if (p.crouch > 0.5) range *= 0.5;
      else if (p.sprinting) range *= 1.15;
      this.vx = p.x;
      this.vz = p.z;
      this.vy = car ? p.feet + 1.0 : p.feet + p.eye;
      this.vpad = 0.35;
      this.vcar = car;
      // 蹲着摸过去要更近才会被发现
      close = car ? 6 : p.crouch > 0.5 ? 1.5 : 3.2;
    }
    // 盯上了就不容易跟丢
    if (hunting) range *= 1.4;
    const dx = this.vx - z.x;
    const dz = this.vz - z.z;
    const d = Math.hypot(dx, dz);
    if (d >= range) return -1;
    if (!hunting && d >= close && Math.sin(z.yaw) * dx + Math.cos(z.yaw) * dz <= CONE * d) return -1;
    return d;
  }

  /** 看不看得见这个目标（t = null 是玩家）：够近、在视野里、中间没有东西挡着 */
  private spots(z: Zed, t: Tgt | null, hunting: boolean): boolean {
    const d = this.aware(z, t, hunting);
    return d >= 0 && this.sees(z, this.vx, this.vy, this.vz, d, this.vpad, this.vcar);
  }

  /** 丧尸的眼睛到 (x, ty, zz) 之间有没有东西挡着。d = 水平距离，pad = 视线在目标前面多远停下，car = 目标坐在这辆车里 */
  private sees(z: Zed, x: number, ty: number, zz: number, d: number, pad: number, car: Vehicle | null): boolean {
    const w = this.env.world;
    const oy = z.y + z.spec.eye;
    if (d < 0.6) return true;
    const dx = x - z.x;
    const dz = zz - z.z;
    const dy = ty - oy;
    const L = Math.hypot(d, dy);
    if (L <= pad + 0.05) return true;
    // 地形挡不挡：world.raycast 不算地面时才便宜，这里沿线看三个点
    if (d > 10) {
      for (let k = 1; k <= 3; k++) {
        const t = k / 4;
        if (w.groundAt(z.x + dx * t, z.z + dz * t) > oy + dy * t + 0.2) return false;
      }
    }
    const hit = w.raycast(z.x, oy, z.z, dx / L, dy / L, dz / L, L - pad, false);
    if (hit === Infinity) return true;
    // 玩家坐在车里：打到的是他自己那辆车的车壳，算看见
    return !!car && w.hitKind === 'car' && hit > L - 5;
  }

  private aggro(z: Zed, d: number): void {
    z.state = 'chase';
    z.t = 0;
    z.mode = 0;
    z.atk = -1;
    // 离得远反应慢一点
    z.react = 0.25 + Math.min(0.6, d * 0.02) + this.rnd() * 0.25;
    this.env.on('aggro', z);
    // 这一嗓子把旁边的也招过来
    for (const o of this.zeds) {
      if (o === z || (o.state !== 'idle' && o.state !== 'roam' && o.state !== 'look')) continue;
      if (Math.hypot(o.x - z.x, o.z - z.z) > 10) continue;
      o.lkx = this.tx;
      o.lkz = this.tz;
      o.fast = true;
      o.react = 0.5 + this.rnd() * 0.8;
      this.go(o, 'seek', o.lkx, o.lkz);
    }
  }

  /** 动静：半径以内没在追人的都过去看看。soft = 脚步声这类持续的小动静（不打断已经在路上的） */
  noise(x: number, z: number, radius: number, soft = false): void {
    let g: SiteNav | null | undefined;
    for (const o of this.zeds) {
      if (o.state === 'chase' || o.state === 'attack' || o.state === 'stagger') continue;
      const d = Math.hypot(o.x - x, o.z - z);
      if (d > radius) continue;
      // 听得不那么准：离得越远偏得越多。但不能偏到墙的另一边去（那样会绕到屋子外面对着墙发呆）
      const j = Math.min(5, d * 0.2);
      let nx = x + (this.rnd() - 0.5) * j;
      let nz = z + (this.rnd() - 0.5) * j;
      if (g === undefined) g = this.nav.at(x, z);
      if (g && (g.blockedAt(nx, nz) || !g.lineClear(x, z, nx, nz))) {
        nx = x;
        nz = z;
      }
      if (o.state === 'seek') {
        // 已经在往动静那边走：声源挪了才改目的地
        if (Math.hypot(nx - o.lkx, nz - o.lkz) > 3) {
          o.lkx = nx;
          o.lkz = nz;
          o.t = 0;
        }
        o.fast = o.fast || d < radius * 0.5;
        continue;
      }
      o.lkx = nx;
      o.lkz = nz;
      o.fast = !soft && d < radius * 0.5;
      o.react = 0.2 + this.rnd() * 0.7;
      this.go(o, 'seek', nx, nz);
    }
  }

  // ---------------------------------------------------------------- 闲逛

  private rest(z: Zed): void {
    z.state = 'idle';
    z.t = 0;
    z.idle = 3 + this.rnd() * 9;
  }

  /** 换状态并定一个目的地 */
  private go(z: Zed, state: ZState, x: number, zz: number): void {
    z.state = state;
    z.t = 0;
    z.tx = x;
    z.tz = zz;
    z.mode = 0;
    z.jx = z.x;
    z.jz = z.z;
    z.jam = 0;
  }

  private pickRoam(z: Zed): void {
    const h = z.house;
    // 住在屋里的：在自己那栋房子的空格之间走
    if (h && h.free.length >= 2) {
      for (let k = 0; k < 4; k++) {
        const i = Math.floor(this.rnd() * (h.free.length / 2)) * 2;
        const x = h.free[i] as number;
        const zz = h.free[i + 1] as number;
        if (Math.hypot(x - z.hx, zz - z.hz) > 9) continue;
        this.go(z, 'roam', x, zz);
        return;
      }
      z.idle = 2;
      return;
    }
    const a = this.rnd() * TAU;
    const r = 2 + this.rnd() * 6;
    const x = z.hx + Math.sin(a) * r;
    const zz = z.hz + Math.cos(a) * r;
    const g = this.nav.at(x, zz);
    // 站不了的地方、水里不去；和家之间隔着墙 / 围栏的也不去（不然每次都要找一条绕过去的路，多半还走不到）
    if ((g && (g.blockedAt(x, zz) || !g.lineClear(z.hx, z.hz, x, zz))) || this.env.world.waterDepth(x, zz) > 0.3) {
      z.idle = 1 + this.rnd() * 2;
      return;
    }
    this.go(z, 'roam', x, zz);
  }

  // ---------------------------------------------------------------- 移动

  /** 脚底该在多高：地形（z.gnd，调用前已经更新）和脚下能站的碰撞体顶面（地板、台子）里高的那个 */
  private floor(z: Zed): number {
    // 野地里没有地板、台子：不用查碰撞体的顶面
    if (!z.grid) return z.gnd;
    // 顶面走出 0.25 米才重新查一次（查一次两三微秒，每帧每只都查就成了大头）
    if (Math.abs(z.x - z.topX) + Math.abs(z.z - z.topZ) > 0.25) {
      z.topX = z.x;
      z.topZ = z.z;
      z.top = this.env.world.topAt(z.x, z.z, z.spec.radius, Math.max(z.gnd, z.y), 0.45);
    }
    return Math.max(z.gnd, z.top);
  }

  /** 附近有没有车（车是会动的碰撞体，不在位图里） */
  private carNear(x: number, z: number): boolean {
    for (const v of this.env.vehicles()) {
      const p = v.rig.root.position;
      if (Math.abs(p.x - x) < 8 && Math.abs(p.z - z) < 8) return true;
    }
    return false;
  }

  /** 定下这一步朝哪个点走（结果放在 ax / az，arrived = 路走到头了但没到终点） */
  private aim(z: Zed, gx: number, gz: number, dt: number): void {
    z.navT -= dt;
    if (z.mode === 0) this.plan(z, gx, gz);
    else if (z.mode === 1) {
      // 直着走：隔一会看看中间是不是还通
      if (z.navT <= 0) this.plan(z, gx, gz);
    } else if (z.long) {
      // 远路（可能上百米）：终点挪了不用马上重找（重找也只是 A* 再搜不到一次，还会把这条路换成到围栏边上的那条），照着走；
      // 只剩最后一两段了再按平常的办法跟。终点挪远了就再要一张，新的来之前先走旧的
      const q = z.path;
      const n = q.length;
      if (z.wp >= n - 4) {
        z.long = false;
        // 去看动静的 30 秒时限：绕远路花掉的不算，不然刚绕进院子就「算了」
        if (z.state === 'seek') z.t = Math.min(z.t, 10);
      } else if (z.navT <= 0) {
        z.navT = 0.5;
        if (!z.far && z.farT <= 0 && z.noWay <= 0 && Math.hypot(gx - (q[n - 2] as number), gz - (q[n - 1] as number)) > 6) this.askFar(z, gx, gz);
      }
    } else if (!z.full) {
      // 这条路没通到终点（太绕，一次没搜完）：隔一会从走到的地方接着找。在等远路的不用找（找也是白找）
      if (z.navT <= 0 && !z.far) this.plan(z, gx, gz);
    } else if (Math.hypot(gx - z.gx, gz - z.gz) > 1) {
      // 跟着路点走、终点挪了：最后一个拐点还直接看得到新终点，就只改最后一段；不然重新找
      const q = z.path;
      const n = q.length;
      const g = z.grid ?? this.nav.at(gx, gz);
      const fx = n >= 4 ? (q[n - 4] as number) : z.x;
      const fz = n >= 4 ? (q[n - 3] as number) : z.z;
      if (g && !g.blockedAt(gx, gz) && g.lineClear(fx, fz, gx, gz)) {
        q[n - 2] = gx;
        q[n - 1] = gz;
        z.gx = gx;
        z.gz = gz;
      } else if (z.navT <= 0) this.plan(z, gx, gz);
    }
    this.arrived = false;
    if (z.mode !== 2) {
      this.ax = gx;
      this.az = gz;
      return;
    }
    const p = z.path;
    const last = p.length - 2;
    while (z.wp < last && Math.hypot((p[z.wp] as number) - z.x, (p[z.wp + 1] as number) - z.z) < 0.4) z.wp += 2;
    if (z.wp >= last && z.full) {
      // 最后一段：直接朝终点（终点可能又挪了一点）
      this.ax = gx;
      this.az = gz;
      return;
    }
    this.ax = p[z.wp] as number;
    this.az = p[z.wp + 1] as number;
    if (z.wp >= last && Math.hypot(this.ax - z.x, this.az - z.z) < 0.4) this.arrived = true;
  }

  private plan(z: Zed, gx: number, gz: number): void {
    const g = z.grid ?? this.nav.at(gx, gz);
    z.gx = gx;
    z.gz = gz;
    z.long = false;
    if (!g) {
      z.mode = 1;
      z.navT = 1;
      return;
    }
    if (g.lineClear(z.x, z.z, gx, gz)) {
      z.mode = 1;
      z.navT = 0.3 + this.rnd() * 0.2;
      return;
    }
    // 这一帧找路的名额不够了：下一帧再来，先照旧走
    const r = this.route(g, z, gx, gz);
    if (r === 3) {
      if (z.mode === 0) z.mode = 1;
      z.navT = 0.03;
      return;
    }
    if (r === 0 || z.path.length < 2) {
      z.mode = 1;
      z.navT = 1.5;
      return;
    }
    if (r === 2 && z.state === 'roam') {
      const n = z.path.length;
      if (Math.hypot((z.path[n - 2] as number) - z.x, (z.path[n - 1] as number) - z.z) < 0.6) {
        // 回家的路走不通（追人追到围栏另一边去了），而且已经站在能走到的最近处：就在这里安家，
        // 不然它会一直顶着围栏，隔两秒找一次回去的路
        z.hx = z.x;
        z.hz = z.z;
        z.house = null;
        z.mode = 1;
        z.navT = 1;
        this.rest(z);
        return;
      }
    }
    z.mode = 2;
    z.wp = 0;
    z.full = r === 1;
    z.navT = r === 1 ? 0.35 + this.rnd() * 0.3 : 1.8 + this.rnd();
    // 没搜到是因为太绕（到上限了还有地方没搜），不是真的走不到：追人、去看动静的要一张远路，来之前先照这条走
    if (r === 2 && g.cut && !z.far && z.farT <= 0 && z.noWay <= 0 && (z.state === 'chase' || z.state === 'seek')) this.askFar(z, gx, gz);
  }

  /**
   * 在位图上找一条到 (gx, gz) 的路，写进 z.path；返回值同 SiteNav.path（3 = 这一帧名额不够，z.path 没动）。
   * 进出房子时先走到门口（门在哪是地点给的）：绕着房子找门是 A* 最费劲的情况（要把整栋房子周围都铺一遍），
   * 拆成「到门外 → 穿过门洞 → 屋里到终点」几段以后每段都差不多是直的
   */
  private route(g: SiteNav, z: Zed, gx: number, gz: number): number {
    const nav = this.nav;
    const from = g.houseAt(z.x, z.z);
    const to = g.houseAt(gx, gz);
    if (from !== to && z.noDoor <= 0) {
      // 每四个数一段：A* 找到 (a, b)，再直着走到 (c, d)（穿门洞）；最后两个数是终点
      const via = VIA;
      via.length = 0;
      let sx = z.x;
      let sz = z.z;
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
        sx = z.x;
        sz = z.z;
        let ok = true;
        for (let i = 0; i < via.length; i += 4) {
          const cap = nav.grant(LEG_EXPAND);
          if (!cap) return 3;
          const r = g.path(sx, sz, via[i] as number, via[i + 1] as number, LEG, cap);
          nav.charge(g);
          // 没搜完：是这一帧的名额不够（下一帧再来），还是这一段本身就走不通
          if (r === 3 && cap < LEG_EXPAND) return 3;
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
          z.path.length = 0;
          for (let k = 0; k < out.length; k++) z.path.push(out[k] as number);
          return 1;
        }
        z.noDoor = 6;
      }
    }
    // 明知走不到的（远路铺过了也没有它）只要「离终点最近的那一点」，一千多格就够；闲逛的目的地就在家附近，也用不着搜那么远
    const lim = z.noWay > 0 ? 1500 : z.state === 'roam' ? 2500 : MAX_EXPAND;
    const cap = nav.grant(lim);
    if (!cap) return 3;
    const r = g.path(z.x, z.z, gx, gz, z.path, cap, lim);
    nav.charge(g);
    return r;
  }

  private move(z: Zed, dt: number, gx: number, gz: number, speed: number, face: number): void {
    const s = z.spec;
    const w = this.env.world;
    let wx = 0;
    let wz = 0;
    if (speed > 0) {
      this.aim(z, gx, gz, dt);
      let ux = this.ax - z.x;
      let uz = this.az - z.z;
      const L = Math.hypot(ux, uz);
      if (this.arrived || L < 0.05) speed = 0;
      else {
        ux /= L;
        uz /= L;
        if (z.sideT > 0) {
          // 被什么东西顶住了：斜着绕一下
          z.sideT -= dt;
          const px = -uz * z.side;
          const pz = ux * z.side;
          ux = ux * 0.4 + px;
          uz = uz * 0.4 + pz;
          const n = Math.hypot(ux, uz);
          ux /= n;
          uz /= n;
        }
        const want = Math.atan2(ux, uz);
        if (Number.isNaN(face)) face = want;
        // 先转身再迈步：背对着目标时走得慢
        const align = Math.cos(want - z.yaw);
        speed *= 0.25 + 0.75 * Math.max(0, align);
        // 快到了：别冲过头
        speed = Math.min(speed, L / Math.max(dt, 1e-3));
        wx = ux * speed;
        wz = uz * speed;
      }
    }
    const k = Math.min(1, dt * 7);
    z.vx += (wx - z.vx) * k;
    z.vz += (wz - z.vz) * k;
    if (!Number.isNaN(face)) z.yaw = turnTo(z.yaw, face, s.turn * dt);
    const mx = z.vx + z.kx;
    const mz = z.vz + z.kz;
    let moved = 0;
    // 玩家的身体会把丧尸顶开（开着车、丧尸不理玩家的时候不会）；自己追着的那个 Prey 也一样
    const hug = !this.driven && !this.passive;
    const prey = z.prey !== null;
    // 站着不动的也要算：人自己走过来贴上了，要被顶开
    if (mx * mx + mz * mz > 0.0009 || z.pushed || (hug && z.dist < s.radius + PLAYER_R + HOLD_MIN) || (prey && z.td < s.radius + this.tr + HOLD_MIN)) {
      z.pushed = false;
      const ox = z.x;
      const oz = z.z;
      // 一步不超过 0.25 米：墙厚 0.92，穿不过去
      const n = Math.max(1, Math.ceil((Math.hypot(mx, mz) * dt) / 0.25));
      const g = z.grid;
      const car = this.carNear(ox, oz);
      P.x = ox;
      P.z = oz;
      for (let q = 0; q < n; q++) {
        P.x += (mx * dt) / n;
        P.z += (mz * dt) / n;
        // 身边 0.4 米内没有墙和家具（位图上周围九格都空）、5 米内没有树和石头、附近没有车：这一步不用做碰撞
        if (!car && (!g || g.openAround(P.x, P.z))) {
          plants.length = 0;
          if (!w.plantsNear(P.x, P.z, 5, plants).length) continue;
        }
        w.collide(P, z.y, z.kind === 'crawler' ? 0.6 : 1.7, s.radius, 0.45);
      }
      // 深水不下去
      let gnd = w.groundAt(P.x, P.z);
      if (WATER - gnd > 0.9 && gnd < z.gnd) {
        P.x = ox;
        P.z = oz;
        gnd = z.gnd;
      }
      // 不挤进玩家身体里，也不挤进自己追着的那个 Prey 身体里
      if (hug) {
        const me = this.env.player;
        this.keepOff(z, me.x, me.z, PLAYER_R, me.feet);
      }
      if (prey) this.keepOff(z, this.tx, this.tz, this.tr, this.tf);
      z.x = P.x;
      z.z = P.z;
      moved = Math.hypot(P.x - ox, P.z - oz);
      z.gnd = gnd;
      const gy = this.floor(z);
      // 上下台阶不要一帧跳过去
      z.y += (gy - z.y) * Math.min(1, dt * 14);
      if (Math.abs(gy - z.y) > 1.2) z.y = gy;
    }
    z.sp += (moved / Math.max(dt, 1e-3) - z.sp) * Math.min(1, dt * 10);
    const fade = Math.exp(-dt * 5);
    z.kx *= fade;
    z.kz *= fade;
    if (speed > 0.2) {
      // 卡住：想走却没走出去 → 换一边斜着绕，并且马上重新找路
      if (moved < speed * dt * 0.3) z.stuck += dt;
      else z.stuck = Math.max(0, z.stuck - dt * 2);
      if (z.stuck > 0.4) {
        z.stuck = 0;
        z.side = -z.side;
        z.sideT = 0.45 + this.rnd() * 0.5;
        z.mode = 0;
      }
      // 闲逛 / 去看动静：好几秒都在原地半米里打转，就算了（目的地可能根本走不到）。
      // 不能看「离目的地近了没有」：绕着房子去找门的时候直线距离是先变远的
      if (z.state === 'roam' || z.state === 'seek') {
        if (Math.hypot(z.x - z.jx, z.z - z.jz) > 0.6) {
          z.jx = z.x;
          z.jz = z.z;
          z.jam = 0;
        } else {
          z.jam += dt;
          if (z.jam > 5) {
            if (z.state === 'seek') {
              z.state = 'look';
              z.t = 0;
              z.idle = 2 + this.rnd() * 3;
            } else this.rest(z);
          }
        }
      }
    }
  }

  /**
   * P（丧尸这一步要去的位置）不能进到 (cx, cz) 这个半径 r 的身体里：身体边缘离得比 HOLD_MIN 还近就顶出去。
   * 被后面的挤、人自己走过来贴上，都是这里把它顶开
   */
  private keepOff(z: Zed, cx: number, cz: number, r: number, feet: number): void {
    const dx = P.x - cx;
    const dz = P.z - cz;
    const min = z.spec.radius + r + HOLD_MIN;
    const d = Math.hypot(dx, dz);
    if (d >= min || d < 1e-4 || Math.abs(feet - z.y) > 1.6) return;
    P.x = cx + (dx / d) * min;
    P.z = cz + (dz / d) * min;
    // 被顶开以后不能进墙：墙说了算（背后是墙时会比 min 近）
    this.env.world.collide(P, z.y, z.kind === 'crawler' ? 0.6 : 1.7, z.spec.radius, 0.45);
  }

  // ---------------------------------------------------------------- 打人、挨打

  /** 出手动作到了命中的那一刻：还够得着才算。打的是 Prey 就调它的 bitten */
  private strike(z: Zed, d: number): void {
    const env = this.env;
    const s = z.spec;
    // 母体只浮动一成（30.6–37.4）：生化模式里一口 30 以上才算「一口就感染」
    const dmg = s.damage * (z.kind === 'mother' ? 0.9 + 0.2 * this.rnd() : 0.8 + 0.4 * this.rnd());
    const t = z.prey;
    if (!t) {
      if (this.passive || env.playerDead()) return;
      const car = this.car;
      if (car) {
        // 车在动的时候打不着里面的人；停着的车隔着铁皮，伤害打四折
        if (Math.abs(car.body.speed) < 1.5 && this.edge(z, d) < s.reach + STRIKE_SLACK + 0.1) {
          env.hurt(dmg * 0.4 * env.car.armor, z.x, z.z);
          env.on('hit', z);
        }
        return;
      }
    }
    if (this.edge(z, d) > s.reach + STRIKE_SLACK || Math.abs(this.tf - z.y) > 1.6) return;
    // 出手以后目标躲到墙后面去了（一秒没看见）：隔着墙够不着
    if (z.seen > 1) return;
    const dx = this.tx - z.x;
    const dz = this.tz - z.z;
    // 得大致在正面
    if (Math.sin(z.yaw) * dx + Math.cos(z.yaw) * dz < 0.25 * d) return;
    if (t) t.prey.bitten(dmg, z.x, z.z);
    else env.hurt(dmg, z.x, z.z);
    env.on('hit', z);
  }

  /**
   * 受伤。amount 是基础伤害：爆头在这里乘倍率；重装正面的钢板在这里减伤。(dx, dz) = 子弹 / 挥击的水平方向。
   * 返回这一下是不是打死了（打死的不会从名单里拿掉，调用方处理尸体）。byPlayer = 是不是玩家打的
   */
  damage(z: Zed, amount: number, head: boolean, dx: number, dz: number, byPlayer = true): boolean {
    if (!z.alive || amount <= 0) return false;
    z.byPlayer = byPlayer;
    const s = z.spec;
    let dmg = amount;
    const L = Math.hypot(dx, dz) || 1;
    const fx = Math.sin(z.yaw);
    const fz = Math.cos(z.yaw);
    // 子弹的方向和丧尸的朝向：同向 = 从背后打的
    const along = (dx * fx + dz * fz) / L;
    if (head) dmg *= headFactor(s);
    else if (s.armor && z.plate > 0 && -along > Math.cos(s.armor.arc)) {
      z.plate -= dmg;
      dmg *= s.armor.front;
    }
    z.hp -= dmg;
    z.flinch = 1;
    const kb = Math.min(3.2, dmg / (14 * s.mass));
    z.kx += (dx / L) * kb;
    z.kz += (dz / L) * kb;
    if (z.hp <= 0) {
      z.alive = false;
      z.state = 'dead';
      z.t = 0;
      z.atk = -1;
      z.head = head;
      z.fallFwd = along > 0;
      this.env.on('die', z);
      return true;
    }
    this.env.on('hurt', z);
    // 一下打掉两成血以上：硬直，正在出的手也打断
    const frac = dmg / (s.hp * s.mass);
    if (frac > 0.2 && z.poise <= 0) {
      z.state = 'stagger';
      z.t = 0;
      z.atk = -1;
      z.stun = Math.min(0.9, 0.25 + frac * 0.8);
      z.poise = z.stun + 0.9;
      z.cool = Math.max(z.cool, 0.3);
    }
    // 挨了打：知道有人，转过来。盯死目标的（hunt）不管是谁打的，照追它的
    if (z.hunt) return false;
    const calm = z.state === 'idle' || z.state === 'roam' || z.state === 'look' || z.state === 'seek';
    if (byPlayer && !this.passive) {
      const p = this.env.player;
      if (calm) {
        z.prey = null;
        z.lkx = p.x;
        z.lkz = p.z;
        z.seen = 0;
        z.state = 'chase';
        z.t = 0;
        z.mode = 0;
        z.react = 0.2;
        this.env.on('aggro', z);
      } else if (!z.prey && z.seen > 1) {
        z.seen = 1;
        z.lkx = p.x;
        z.lkz = p.z;
      }
    } else if (calm || (z.state === 'stagger' && z.seen > s.lose)) {
      // 不是玩家打的（带枪的人）：不知道是谁，朝子弹来的方向找过去，路上看见了再追
      z.lkx = z.x - (dx / L) * 14;
      z.lkz = z.z - (dz / L) * 14;
      z.fast = true;
      if (calm) {
        z.react = 0.2;
        this.go(z, 'seek', z.lkx, z.lkz);
      }
    }
    return false;
  }

  /** 车撞丧尸：车壳碰到、车速超过 4 米/秒，按车速掉血并撞飞（只读车的状态，不改车） */
  private runOver(): void {
    for (const v of this.env.vehicles()) {
      const sp = Math.abs(v.body.speed);
      if (sp < 4) continue;
      const pos = v.rig.root.position;
      const reach = v.hull.hz + v.hull.hx + 1;
      let vx = v.body.vel.x;
      let vz = v.body.vel.z;
      const vl = Math.hypot(vx, vz) || 1;
      vx /= vl;
      vz /= vl;
      for (let i = this.zeds.length - 1; i >= 0; i--) {
        const z = this.zeds[i] as Zed;
        if (z.carT > 0 || !z.alive) continue;
        if (Math.abs(z.x - pos.x) > reach || Math.abs(z.z - pos.z) > reach || Math.abs(z.y - pos.y) > 2.5) continue;
        const [lx, lz] = v.toHull(z.x, z.z);
        const r = z.spec.radius + 0.12;
        if (Math.abs(lx) > v.hull.hx + r || Math.abs(lz) > v.hull.hz + r) continue;
        z.carT = 0.45;
        // 往车开的方向撞出去，再往旁边偏一点
        const sx = lx >= 0 ? 1 : -1;
        const kx = vx + -vz * sx * 0.35;
        const kz = vz + vx * sx * 0.35;
        const died = this.damage(z, (sp - 2) * 13 * this.env.car.ram, false, kx, kz);
        this.env.car.onRam(sp, z.spec.mass * 70);
        if (!died) {
          z.kx += kx * sp * 0.5;
          z.kz += kz * sp * 0.5;
          z.state = 'stagger';
          z.stun = Math.max(z.stun, 0.8);
          z.atk = -1;
        } else {
          // 撞死的：尸体甩到车身外侧、再往前带半米。不然倒地的那一秒它还立在原地，车从它身上穿过去，看着像站在车斗里
          const out = v.hull.hx + r + 0.25 - Math.abs(lx);
          if (out > 0) {
            // 世界里 (-vz, vx) 这个方向是不是车身坐标的 +x
            const l2 = v.toHull(z.x - vz, z.z + vx)[0];
            const sg = (l2 > lx ? 1 : -1) * sx;
            P.x = z.x - vz * sg * out + vx * 0.5;
            P.z = z.z + vx * sg * out + vz * 0.5;
            // 别甩进墙里
            this.env.world.collide(P, z.y, 1.7, z.spec.radius, 0.45);
            z.x = P.x;
            z.z = P.z;
          }
        }
      }
    }
  }
}
