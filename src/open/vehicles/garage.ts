import { BufferGeometry, Euler, Group, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, Quaternion, SpotLight, Vector3, type Texture, type WebGLRenderer } from 'three';
import { CAR, CAR_PARTS, type BagApi, type CarPartId, type Interaction } from '../game/api';
import { hash2 } from '../world/noise';
import type { Site } from '../world/sites';
import type { World } from '../world/world';
import { VehicleAudio, type WorkSound } from './audio';
import { Dash, type DashState } from './dash';
import { exitYaw, findExit, type ExitSpot } from './exit';
import { BASE, loadVehicle, type VehicleAsset } from './model';
import { CarParts } from './parts';
import { STEP, type DriveInput, type Ground } from './physics';
import type { VehicleIndex } from './types';
import { Vehicle } from './vehicle';

/**
 * 开放世界里的车。世界里只有一辆皮卡（garage.car）：停在出生点附近，油箱里只有 8 升。
 *
 * 操作：E 上 / 下车 · WASD 开 · 空格 手刹 · V 车外 / 车内视角 · H 喇叭 · L 车灯（天黑自动开）
 *      站在车旁边 F：加油机够得着就按住加油；背包里有汽油桶就倒一桶（按住 2.5 秒）；有改装件就装上（按住 3 秒）
 * 相机：车外 = 跟车（鼠标可以绕着看，松开 1.5 秒后转回车后）；车内 = 驾驶员视角（鼠标转头）；上下车时 0.4 秒过渡，不跳。
 *
 * 下车：车速 12 km/h 以下按 E 会自己停稳再下（更快只提示）；车留在驻车状态（四轮锁死、熄火），坡上不会溜；
 *      人站在驾驶员门外，被挡住就换副驾那边、车尾、车头，再不行绕着车往外找（见 exit.ts）；下车后 0.7 秒内不会又被 E 弄上车。
 * 油：见 vehicle.ts 的 burn()；烧干了发动机熄火，加了油才能再打着。加油站的存油按种子定（有的是空的），抽一点少一点。
 * 改装件、车斗：见 parts.ts；装了什么记在 game/api.ts 的 CAR 里（这里负责更新它）。
 */

/** 离车这么近（米，到外壳）能上车、加油、装东西 */
const REACH = 1.6;
/** 车速不超过这个（米/秒，= 12 km/h）按 E：自己停稳再下车 */
const EXIT_MAX = 12 / 3.6;
/** 慢到这个就算停住了 */
const EXIT_STILL = 0.3;
/** 开车时没踩油门刹车、慢到这个（米/秒）：自动驻车 */
const HOLD_SPEED = 0.6;
/** 下车以后这么久之内不提示上车（免得连按两下 E 又坐回去） */
const ENTER_COOLDOWN = 0.7;
/** 上下车时相机过渡：先等门开一条缝，再用这么久挪过去 */
const BLEND_DELAY = 0.08;
const BLEND = 0.36;
const CAN_ITEM = 'fuel_can';
const CAN_LITRES = 10;
const CAN_HOLD = 2.5;
/** 加油机的油管够得着多远（米，到车的外壳）、每秒加多少升 */
const PUMP_RANGE = 5;
const PUMP_RATE = 3.5;
const INSTALL_HOLD = 3;
/** 开局油箱里有多少（升） */
const START_FUEL = 8;
const PART_ITEMS = CAR_PARTS.map((p) => ({ id: p.id, name: p.name, desc: p.desc, item: `part_${p.id}` }));

const _v = new Vector3();
const _w = new Vector3();
const _n = new Vector3();
const _t = new Vector3();
const _o = new Vector3();
const _lq = new Quaternion();
const _q = new Quaternion();
const _e = new Euler(0, 0, 0, 'YXZ');

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const ease = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export interface DriveKeys {
  has(code: string): boolean;
}

/** 走路的玩家（player.ts 的 Player 就是）：只用到这些 */
export interface Walker {
  x: number;
  z: number;
  feet: number;
  yaw: number;
  pitch: number;
  readonly eye?: number;
  readonly bob?: number;
  readonly speed?: number;
  readonly onGround?: boolean;
  teleport(x: number, z: number): void;
}

/** 车库用到的那部分世界（无头测试里用一个假的） */
export type GarageWorld = Pick<World, 'seed' | 'dynamic' | 'groundAt' | 'waterDepth' | 'collide' | 'raycast' | 'topAt' | 'ctxAt'> & {
  sites: Pick<World['sites'], 'near' | 'peek' | 'content'>;
  terrain: Pick<World['terrain'], 'road' | 'flatAt'>;
};

export class Garage {
  readonly group = new Group();
  readonly vehicles: Vehicle[] = [];
  readonly audio = new VehicleAudio();
  /** 那辆车。没有车包（public/vehicles）或者 ?cars=0 时是 null */
  car: Vehicle | null = null;
  driving: Vehicle | null = null;
  view: 'chase' | 'cockpit' = 'chase';
  /** 车弄出了动静（喇叭、引擎、撞车）：半径 radius 米以内的丧尸会被引过来。main.ts 接到丧尸模块上 */
  onNoise: (x: number, z: number, radius: number) => void = () => {};
  /** 灯：null = 自动（天黑开） */
  lightsManual: boolean | null = null;
  /** 最近一次下车落在哪（测试、调试用） */
  lastExit: ExitSpot | null = null;
  private acc = 0;
  private readonly ground: Ground;
  private readonly headlight: SpotLight;
  private readonly lightTarget = new Object3D();
  private parts: CarParts | null = null;
  private partsLabel = '';
  // 输入（复用，不每帧新建）
  private readonly inp: DriveInput = { fwd: 0, back: 0, steer: 0, handbrake: false, park: false };
  private readonly parkInp: DriveInput = { fwd: 0, back: 0, steer: 0, handbrake: true, park: true };
  // 下车
  private leaving = false;
  private leaveT = 0;
  private cooldown = 0;
  private walker: Walker | null = null;
  private cam: PerspectiveCamera | null = null;
  private readonly later: Array<{ t: number; fn: () => void }> = [];
  // 相机
  private camYaw = 0;
  private camPitch = 0.12;
  private camIdle = 0;
  private camHeading = 0;
  private readonly camPos = new Vector3();
  private lookYaw = 0;
  private lookPitch = 0;
  private camReady = false;
  private shake = 0;
  /** 上下车的过渡：blendT < 0 = 没在过渡；blendOut = 下车（转到第一人称） */
  private blendT = -1;
  private blendOut = false;
  private blendGrab = false;
  private blendFirst = false;
  private readonly blendPos = new Vector3();
  private blendYaw = 0;
  private blendPitch = 0;
  private blendRoll = 0;
  private outYaw = 0;
  private lastYaw = 0;
  // 油、加油
  private readonly stations = new Map<number, number>();
  private readonly siteTmp: Site[] = [];
  private readonly pump: { site: Site | null; d: number } = { site: null, d: Infinity };
  private pumpT = 0;
  private pumping: Vehicle | null = null;
  private pumpSite: Site | null = null;
  private pumped = 0;
  private fuelWarn = 0;
  /** interactions() 这一帧给 F 的是什么（update 里按它放声音） */
  private offered: WorkSound | null = null;
  private fullHint = '';
  private fWas = false;
  private eWas = false;
  /** 这一帧之前按过一下 E（按下的事件里记的：敲得很快的一下，等到 update 来看键盘时已经松开了） */
  private eTap = false;
  private partId: CarPartId | null = null;
  private bag: BagApi | null = null;
  // 声音引丧尸
  private noiseT = 0;
  private crashT = 0;
  private hornOn = false;
  private surfT = 0;
  // 界面
  private readonly dash = new Dash();
  private readonly ds: DashState = { name: '', kmh: 0, gear: '1', rpm: 0, red: false, fuel: 0, fuelText: '', fuelState: 'ok', parts: '', hint: '' };
  private hudT = 0;
  private hint = '';
  private toast = '';
  private toastT = 0;
  private near: Vehicle | null = null;
  // 交互（复用同一批对象，每帧只改文字）
  private readonly iExit: Interaction = { key: 'KeyE', label: '下车', prio: 5, act: () => this.requestExit() };
  private readonly iEnter: Interaction = { key: 'KeyE', label: '上车', prio: 5, act: () => this.near && this.walker && this.enter(this.near, this.walker) };
  private readonly iPump: Interaction = { key: 'KeyF', label: '按住加油', prio: 6, act: () => this.startPump() };
  private readonly iCan: Interaction = { key: 'KeyF', label: '倒一桶汽油', hold: CAN_HOLD, prio: 5, act: () => this.pourCan() };
  private readonly iPart: Interaction = { key: 'KeyF', label: '安装', hold: INSTALL_HOLD, prio: 3, act: () => this.partId && this.install(this.partId, this.bag) };

  private constructor(private readonly world: GarageWorld) {
    this.ground = { height: (x, z) => world.groundAt(x, z), water: (x, z) => world.waterDepth(x, z) };
    // 大灯：整个场景只有一盏（开着的那台车），一开始就在场景里（中途加灯会让所有材质重编译）
    this.headlight = new SpotLight(0xfff1dc, 0, 70, 0.55, 0.55, 1.2);
    this.headlight.castShadow = false;
    this.group.add(this.headlight, this.lightTarget);
    this.headlight.target = this.lightTarget;
    // 丧尸模块撞到丧尸时调：车减速
    CAR.onRam = (speed, kg) => this.onRam(speed, kg);
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', (e) => {
        if (e.code === 'KeyE' && !e.repeat) this.eTap = true;
      });
    }
  }

  /** 加载车包（public/vehicles/index.json）并把车停在出生点附近；没有车包就返回一个空车库 */
  static async load(world: GarageWorld, aniso: number, spawn: { x: number; z: number; yaw: number }, enabled = true): Promise<Garage> {
    if (!enabled) return new Garage(world);
    let index: VehicleIndex | null = null;
    try {
      const r = await fetch(`${BASE}index.json`);
      if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) index = (await r.json()) as VehicleIndex;
    } catch {
      index = null;
    }
    if (!index) {
      console.info('[vehicles] 没有 public/vehicles（python -I scripts/tools/vehicles-import.py 生成），开放世界里不放车');
      return new Garage(world);
    }
    // 世界里只有一辆车：车包里的第一台能加载的
    let asset: VehicleAsset | null = null;
    for (const v of index.vehicles) {
      asset = await loadVehicle(v.id, aniso).catch((e) => {
        console.warn('[vehicles]', v.id, e);
        return null;
      });
      if (asset) break;
    }
    return Garage.create(world, asset, spawn);
  }

  /** 用已经加载好的车包建车库（无头测试直接调这个）。asset = null：没有车 */
  static create(world: GarageWorld, asset: VehicleAsset | null, spawn: { x: number; z: number; yaw: number }): Garage {
    const g = new Garage(world);
    if (!asset) return g;
    const v = g.add(asset);
    g.car = v;
    g.parts = new CarParts(v.rig, v.driverDoor, v.side);
    v.rig.lean.add(g.parts.group);
    g.applyParts();
    v.fuel = Math.min(v.tank, START_FUEL);
    g.startPlace(v, spawn);
    v.sync(0);
    g.warmTextures(v);
    return g;
  }

  private add(asset: VehicleAsset): Vehicle {
    const v = new Vehicle(asset);
    this.vehicles.push(v);
    this.group.add(v.rig.root);
    this.world.dynamic.push(v);
    return v;
  }

  /**
   * 车的贴图开局就传进显卡：车内、底盘那两套贴图本来要等第一次走到车跟前才传，会卡一下。
   * 车库拿不到 renderer，借一个永远会被画到的空网格的 onBeforeRender 拿（只在第一帧做一次）。
   */
  private warmTextures(v: Vehicle): void {
    if (typeof document === 'undefined') return;
    const list: Texture[] = [];
    for (const t of Object.values(v.rig.asset.tex)) {
      list.push(t.base);
      if (t.normal) list.push(t.normal);
      if (t.orm) list.push(t.orm);
    }
    const probe = new Mesh(new BufferGeometry(), new MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false }));
    probe.frustumCulled = false;
    probe.name = 'veh-warm';
    probe.onBeforeRender = (renderer: WebGLRenderer) => {
      probe.onBeforeRender = () => {};
      for (const t of list) renderer.initTexture(t);
      this.after(0, () => this.group.remove(probe));
    };
    this.group.add(probe);
  }

  // ---------------------------------------------------------------- 开局停在哪
  /** (x, z)、车头朝 heading 停得下吗：不碰东西、不在水里、地不太斜、不压着出生点 */
  private fits(v: Vehicle, x: number, z: number, heading: number, spawn: { x: number; z: number }): boolean {
    const fx = -Math.sin(heading);
    const fz = -Math.cos(heading);
    let lo = Infinity;
    let hi = -Infinity;
    const p = { x: 0, z: 0 };
    for (const c of v.circles) {
      // 车身坐标 z 往后为正，车头方向是 (fx, fz)
      const px = x - fx * c.z;
      const pz = z - fz * c.z;
      if (this.world.waterDepth(px, pz) > 0.25) return false;
      const gy = this.world.groundAt(px, pz);
      lo = Math.min(lo, gy);
      hi = Math.max(hi, gy);
      if (Math.hypot(px - spawn.x, pz - spawn.z) < c.r + 1.6) return false;
      p.x = px;
      p.z = pz;
      if (this.world.collide(p, gy + v.hull.y0, v.hull.y1 - v.hull.y0, c.r + 0.3, 0.35, false)) return false;
      for (const o of this.vehicles) if (o !== v && o.distance(px, pz) < c.r + 0.5) return false;
    }
    if (hi - lo > 0.8) return false;
    // 四个轮子底下差不多是一个平面（不骑在坎上、路肩上），横着纵着都不超过 10° 左右，肚子底下没有鼓包
    const ws = v.def.wheels;
    let front = 0;
    let rear = 0;
    let left = 0;
    let right = 0;
    let twist = 0;
    let sum = 0;
    let zf = 0;
    let zr = 0;
    let xl = 0;
    let xr = 0;
    for (const w of ws) {
      // 车的右边是 (-fz, fx)
      const gy = this.world.groundAt(x - fz * w.x - fx * w.z, z + fx * w.x - fz * w.z);
      sum += gy;
      if (w.z < 0) {
        front += gy;
        zf += 1;
      } else {
        rear += gy;
        zr += 1;
      }
      if (w.x < 0) {
        left += gy;
        xl += 1;
      } else {
        right += gy;
        xr += 1;
      }
      twist += gy * Math.sign(w.x || 1) * Math.sign(w.z || 1);
    }
    if (!zf || !zr) return true;
    const base = Math.abs(v.def.phys.frontZ - v.def.phys.rearZ);
    if (Math.abs(front / zf - rear / zr) > base * 0.17) return false;
    if (xl && xr && (Math.abs(left / xl - right / xr) > 0.28 || Math.abs(twist) > 0.3)) return false;
    return this.world.groundAt(x, z) - sum / ws.length < 0.12;
  }

  /** 把车放到那儿让它落稳（最多 5 秒）：睡着了、没歪、没挪远才算停住了 */
  private settles(v: Vehicle, at: { x: number; z: number; heading: number }): boolean {
    const b = v.body;
    b.place(at.x, at.z, at.heading, this.ground);
    b.engineOn = false;
    for (let i = 0; i < 600 && !b.sleeping; i++) b.step(this.parkInp, this.ground);
    b.origin(_v);
    const moved = Math.hypot(_v.x - at.x, _v.z - at.z);
    return b.sleeping && moved < 0.5 && _w.set(0, 1, 0).applyQuaternion(b.q).y > 0.97;
  }

  /**
   * 开局把车停在哪。出生点和它周围的布局会改，所以不写死坐标，按顺序找第一个停得下的：
   *   出生点附近的停车位（地点内容里的 parking，营地大门外留了一个）→ 出生点正前方 15 米左右的一片 → 绕着出生点一圈一圈往外
   */
  private startPlace(v: Vehicle, spawn: { x: number; z: number; yaw: number }): void {
    const list: Array<{ x: number; z: number; heading: number; d?: number }> = [];
    this.siteTmp.length = 0;
    for (const s of this.world.sites.near(spawn.x, spawn.z, 60, this.siteTmp)) {
      for (const p of this.world.sites.content(s).parking) {
        const d = Math.hypot(p.x - spawn.x, p.z - spawn.z);
        // 车头朝 yaw（世界方向 (sin, cos)）= heading yaw + π
        if (d < 70) list.push({ x: p.x, z: p.z, heading: p.yaw + Math.PI, d });
      }
    }
    list.sort((a, b) => (a.d ?? 0) - (b.d ?? 0));
    const fx = Math.sin(spawn.yaw);
    const fz = Math.cos(spawn.yaw);
    for (const d of [15, 19, 12, 23, 27, 9, 31]) {
      for (const k of [0, 3.5, -3.5, 7, -7, 10.5, -10.5]) list.push({ x: spawn.x + fx * d - fz * k, z: spawn.z + fz * d + fx * k, heading: spawn.yaw + Math.PI });
    }
    for (let r = 8; r <= 80; r += 4) {
      for (let i = 0; i < 16; i++) {
        const a = spawn.yaw + (i / 16) * Math.PI * 2;
        list.push({ x: spawn.x + Math.sin(a) * r, z: spawn.z + Math.cos(a) * r, heading: a + Math.PI });
      }
    }
    // 看着停得下的，真的放上去试：落稳了就是它。试了 30 个都不行（整片都是陡坡）就用第一个看着行的
    let first: { x: number; z: number; heading: number } | null = null;
    let tried = 0;
    for (const c of list) {
      if (!this.fits(v, c.x, c.z, c.heading, spawn)) continue;
      first ??= c;
      if (this.settles(v, c)) return;
      if (++tried >= 30) break;
    }
    this.settles(v, first ?? { x: spawn.x + fx * 15, z: spawn.z + fz * 15, heading: spawn.yaw + Math.PI });
  }

  // ---------------------------------------------------------------- 上下车
  /** E：开着车就下车，否则上最近的车（老接口；现在提示和按键由 interactions 统一给玩法层） */
  toggle(player: Walker, camera: PerspectiveCamera): void {
    this.walker = player;
    this.cam = camera;
    if (this.driving) this.requestExit();
    else if (this.near && this.cooldown <= 0) this.enter(this.near, player);
  }

  /**
   * 现在能对车做什么（玩法层每帧来问，提示和按键都由它统一处理，见 game/game.ts）。
   * 开着车：E 下车。站在车旁边：E 上车；F 加油机 / 倒汽油桶 / 装改装件（同一时间只给一个，看 prio）
   */
  interactions(player: Walker, camera: PerspectiveCamera, bag: BagApi, out: Interaction[]): void {
    this.walker = player;
    this.cam = camera;
    this.bag = bag;
    this.offered = null;
    this.fullHint = '';
    if (this.driving) {
      // 慢到能下车了才给提示（开着车屏幕中间一直挂着「E 下车」碍眼）；车速快的时候按 E 由 update 说一声「太快」
      if (this.leaving || this.driving.body.vel.lengthSq() <= EXIT_MAX * EXIT_MAX) {
        this.iExit.label = this.leaving ? '下车（正在停车……）' : '下车';
        out.push(this.iExit);
      }
      return;
    }
    const v = this.near;
    if (!v) return;
    if (this.cooldown <= 0) {
      this.iEnter.label = `上车 · ${v.def.name}${v.fuel <= 0 ? '（没油）' : ''}`;
      out.push(this.iEnter);
    }
    // F：加油机 > 汽油桶（油少的时候）> 装改装件 > 汽油桶（油还多的时候）
    const free = v.tank - v.fuel;
    let top = -1;
    const site = this.pump.d <= PUMP_RANGE ? this.pump.site : null;
    if (site) {
      const left = this.reserve(site);
      if (left <= 0.05) this.fullHint = `${site.name}的油罐是空的`;
      else if (free <= 0.05) this.fullHint = '油箱满了';
      else {
        this.iPump.label = this.pumping ? `加油中……松开 F 停（油罐还有 ${Math.ceil(left)} 升）` : `按住加油 · ${site.name}（油罐还有 ${Math.ceil(left)} 升）`;
        out.push(this.iPump);
        this.offered = 'pump';
        top = 6;
      }
    }
    const cans = bag.count(CAN_ITEM);
    if (cans > 0) {
      if (free >= CAN_LITRES - 0.5) {
        const prio = v.fuel < v.tank * 0.25 ? 5 : 2;
        this.iCan.prio = prio;
        this.iCan.label = `倒一桶汽油 +${CAN_LITRES} 升（背包里有 ${cans} 桶）`;
        out.push(this.iCan);
        if (prio > top) {
          top = prio;
          this.offered = 'can';
        }
      } else if (!this.fullHint) this.fullHint = free < 1 ? '油箱满了' : `油箱装不下一整桶（还能装 ${free.toFixed(0)} 升）`;
    }
    if (v === this.car) {
      for (const p of PART_ITEMS) {
        if (CAR.parts.has(p.id) || bag.count(p.item) <= 0) continue;
        this.partId = p.id;
        this.iPart.label = `安装 ${p.name}`;
        out.push(this.iPart);
        if (3 > top) this.offered = 'wrench';
        break;
      }
    }
  }

  private enter(v: Vehicle, player: Walker): void {
    if (this.driving) return;
    this.audio.ensure();
    void this.audio.preload(v.def);
    this.stopPump();
    this.driving = v;
    this.leaving = false;
    // 上车的那一下 E 还按着：不算「想下车」
    this.eWas = true;
    this.eTap = false;
    const b = v.body;
    b.wake();
    b.drowned = false;
    b.gear = 1;
    v.capWant = 0;
    v.openDoor(0.55);
    this.audio.door(true);
    this.after(0.8, () => this.audio.door(false));
    if (v.fuel > 0) {
      b.engineOn = true;
      b.rpm = v.def.phys.idleRpm;
      void this.audio.start(v.def);
      this.say(v.def.name);
    } else {
      b.engineOn = false;
      this.audio.crankFail(v.def);
      this.say('没油了，发动机打不着：下车用汽油桶加油', 3.5);
    }
    this.fuelWarn = v.fuel < this.lowFuel(v) ? 1 : 0;
    this.camReady = false;
    this.camYaw = 0;
    this.camIdle = 0;
    this.lookYaw = 0;
    this.lookPitch = -0.05;
    // 从玩家的视线方向开始转到车后
    this.camHeading = player.yaw + Math.PI;
    this.blendT = 0;
    this.blendOut = false;
    this.blendGrab = true;
    this.surfT = 0;
    this.hudT = 0;
  }

  /** 按了 E 想下车：太快只提示；还在滚就先自己停稳（update 里接着办）；停着就直接下 */
  private requestExit(): void {
    const v = this.driving;
    if (!v || this.leaving) return;
    const sp = v.body.vel.length();
    if (sp > EXIT_MAX) {
      this.say(`车速太快（${Math.round(sp * 3.6)} km/h）：降到 12 km/h 以下才能下车`, 2.5);
      return;
    }
    if (sp > EXIT_STILL) {
      this.leaving = true;
      this.leaveT = 0;
      return;
    }
    this.exit(false);
  }

  /** 立刻下车，不看车速、不做相机过渡（玩家死在驾驶座上、重生传送之前）。没在开车时什么都不做 */
  forceExit(player: Walker): void {
    if (!this.driving) return;
    this.walker = player;
    this.exit(true);
  }

  private exit(instant: boolean): void {
    const v = this.driving;
    const player = this.walker;
    if (!v) return;
    this.leaving = false;
    // 车：熄火、驻车、灯灭。之后它用 parkInp（四轮锁死），坡上不会溜
    const b = v.body;
    b.engineOn = false;
    b.throttle = 0;
    b.gear = 1;
    v.lights = false;
    this.hornOn = false;
    this.audio.stop();
    this.audio.outside();
    this.audio.handbrake();
    v.openDoor(0.6);
    this.audio.door(true);
    this.after(0.85, () => this.audio.door(false));
    this.headlight.intensity = 0;
    this.driving = null;
    this.cooldown = ENTER_COOLDOWN;
    this.blendT = -1;
    if (!player) return;
    const spot = findExit(this.world, v);
    this.lastExit = spot;
    // 接着相机原来看的方向；那边是墙就换一个（见 exitYaw）
    let want = player.yaw;
    let pitch = 0;
    if (this.cam && !instant) {
      this.cam.getWorldDirection(_v);
      want = Math.atan2(_v.x, _v.z);
      pitch = Math.asin(Math.max(-1, Math.min(1, _v.y)));
    }
    player.teleport(spot.x, spot.z);
    player.yaw = exitYaw(this.world, v, spot, want, player.eye ?? 1.62);
    player.pitch = Math.max(-0.35, Math.min(0.35, pitch * 0.6));
    if (!instant && this.cam) {
      this.blendT = 0;
      this.blendOut = true;
      this.blendGrab = true;
      this.blendFirst = true;
    }
  }

  /** 调试 / 截图：直接上第 i 台车 */
  debugEnter(i: number, player: Walker): void {
    const v = this.vehicles[i];
    this.walker = player;
    if (v && !this.driving) this.enter(v, player);
  }

  toggleView(): void {
    if (!this.driving) return;
    this.view = this.view === 'chase' ? 'cockpit' : 'chase';
    this.lookYaw = 0;
    this.lookPitch = -0.05;
  }

  toggleLights(night: number): void {
    const now = this.lightsManual ?? night > 0.35;
    this.lightsManual = !now;
  }

  horn(on: boolean): void {
    this.hornOn = on && !!this.driving;
    if (this.driving) this.audio.setHorn(on);
  }

  /** 开车时的鼠标 */
  look(dx: number, dy: number): void {
    if (this.view === 'chase') {
      this.camYaw -= dx * 0.0035;
      this.camPitch = Math.max(-0.2, Math.min(1.1, this.camPitch + dy * 0.0025));
      this.camIdle = 0;
    } else {
      this.lookYaw = Math.max(-2.3, Math.min(2.3, this.lookYaw - dx * 0.0022));
      this.lookPitch = Math.max(-1.0, Math.min(0.9, this.lookPitch - dy * 0.0022));
    }
  }

  private say(s: string, seconds = 2): void {
    this.toast = s;
    this.toastT = seconds;
  }

  /** 现在屏幕上车的那一行提示（没有 = 空串；测试用） */
  get message(): string {
    return this.toastT > 0 ? this.toast : '';
  }

  /** seconds 秒以后做一件事（开关门的声音）。跟着游戏时间走，不用 setTimeout */
  private after(seconds: number, fn: () => void): void {
    this.later.push({ t: seconds, fn });
  }

  // ---------------------------------------------------------------- 油
  private lowFuel(v: Vehicle): number {
    return Math.max(5, v.tank * 0.15);
  }

  /** 这座加油站还剩多少油（升）：第一次问的时候按种子定——三成是空的（出生点附近的不会），其余 25–160 升 */
  private reserve(s: Site): number {
    let r = this.stations.get(s.key);
    if (r === undefined) {
      const seed = this.world.seed;
      const dry = s.danger > 0.9 && hash2(s.i * 3 + 1, s.j * 5 + 2, seed + 911) < 0.3;
      r = dry ? 0 : Math.round(25 + hash2(s.i, s.j, seed + 912) * 135);
      this.stations.set(s.key, r);
    }
    return r;
  }

  /** 离这台车最近的加油机（12 米以内）记到 this.pump 里 */
  private scanPumps(v: Vehicle): void {
    const pos = v.rig.root.position;
    let best = 12;
    let site: Site | null = null;
    this.siteTmp.length = 0;
    for (const s of this.world.sites.near(pos.x, pos.z, 16, this.siteTmp)) {
      const c = this.world.sites.peek(s);
      if (!c) continue;
      for (const p of c.pumps) {
        const d = v.distance(p.x, p.z);
        if (d < best) {
          best = d;
          site = s;
        }
      }
    }
    this.pump.site = site;
    this.pump.d = site ? best : Infinity;
  }

  private startPump(): void {
    const v = this.near;
    const site = this.pump.site;
    if (!v || !site || this.driving) return;
    this.audio.ensure();
    this.audio.clank(0.4, 1500);
    this.pumping = v;
    this.pumpSite = site;
    this.pumped = 0;
  }

  private stopPump(why = ''): void {
    if (!this.pumping) return;
    const v = this.pumping;
    this.pumping = null;
    this.audio.clank(0.35, 1300);
    if (this.pumped > 0.05) this.say(`${why}加了 ${this.pumped.toFixed(1)} 升 · 油箱 ${v.fuel.toFixed(0)} / ${v.tank} 升`, 3);
    else if (why) this.say(why.replace(/[：，]$/, ''));
  }

  private pourCan(): void {
    const v = this.near;
    const bag = this.bag;
    if (!v || !bag || this.driving || v.tank - v.fuel < CAN_LITRES - 0.5) return;
    if (bag.take(CAN_ITEM, 1) < 1) return;
    const add = v.refuel(CAN_LITRES);
    this.audio.clank(0.35, 1100);
    this.say(`倒进去 ${add.toFixed(0)} 升 · 油箱 ${v.fuel.toFixed(0)} / ${v.tank} 升`, 3);
  }

  // ---------------------------------------------------------------- 改装件、车斗
  /** 装上一个改装件（bag 给了就从背包里拿走一个 part_<id>）。返回装上了没有 */
  private install(id: CarPartId, bag: BagApi | null): boolean {
    const p = PART_ITEMS.find((q) => q.id === id);
    if (!p || !this.car || CAR.parts.has(id)) return false;
    if (bag && bag.take(p.item, 1) < 1) return false;
    CAR.parts.add(id);
    this.applyParts();
    this.audio.clank(0.5, 2100);
    this.after(0.18, () => this.audio.clank(0.4, 1500));
    this.say(`装上了${p.name}：${p.desc}`, 4);
    return true;
  }

  /** 调试 / 存档恢复：直接装上 */
  debugInstall(id: CarPartId): boolean {
    return this.install(id, null);
  }

  /** CAR.parts 变了：更新效果（油箱、载重、护甲、撞击）和车上的模型 */
  private applyParts(): void {
    const has = CAR.parts;
    CAR.cargoCapacity = 60 + (has.has('roofrack') ? 40 : 0);
    CAR.armor = has.has('armor') ? 0.3 : 1;
    CAR.ram = has.has('bullbar') ? 1.6 : 1;
    this.car?.setExtraTank(has.has('auxtank') ? 30 : 0);
    this.parts?.set(has);
    this.partsLabel = PART_ITEMS.filter((p) => has.has(p.id))
      .map((p) => p.name)
      .join(' · ');
    this.surfT = 0;
    this.hudT = 0;
  }

  /** 丧尸模块报告：车以 speed 米/秒撞上了一只 kg 千克的丧尸。没有防撞杠掉一成多的速度，有的话几乎不减 */
  private onRam(speed: number, kg: number): void {
    const v = this.driving ?? this.car;
    if (!v) return;
    const bar = CAR.parts.has('bullbar');
    const b = v.body;
    const k = Math.min(0.35, (kg / b.mass) * (bar ? 0.6 : 3));
    b.vel.x *= 1 - k;
    b.vel.z *= 1 - k;
    b.wake();
    const s = Math.min(1, Math.abs(speed) / 14);
    if (v === this.driving) {
      this.audio.crash((0.2 + s * 0.4) * (bar ? 0.7 : 1));
      this.shake = Math.max(this.shake, s * (bar ? 0.2 : 0.55));
    }
    this.crashNoise(v, 30 + s * 20);
  }

  /** 车斗 / 尾门那里的一个点（世界坐标）：玩法层在它附近给「打开车厢」。没有车返回 false */
  cargoPoint(out: Vector3): boolean {
    const v = this.car;
    if (!v) return false;
    v.local(0, 1, v.def.hull.max[2] + 0.35, out);
    return true;
  }

  /** 开 / 关尾门（有 tailgate 骨骼的车才看得出来） */
  setTailgate(open: boolean): void {
    const v = this.car;
    if (!v || v.gateWant === (open ? 1 : 0)) return;
    v.gateWant = open ? 1 : 0;
    if (this.audio.ensure()) this.audio.oneShot(`${BASE}_common/${open ? 'door_open' : 'door_close'}.ogg`, 0.6, 0.8);
  }

  /** 车斗里画多少货：0 = 空，1 = 堆满 */
  setCargoFill(k: number): void {
    this.parts?.setCargo(k);
  }

  // ---------------------------------------------------------------- 存档
  /** 车的位置、朝向、油量、装了哪些改装件，各加油站还剩多少油 */
  save(): unknown {
    const c = this.car;
    let car: { x: number; z: number; h: number; fuel: number } | null = null;
    if (c) {
      c.body.origin(_v);
      car = { x: _v.x, z: _v.z, h: c.body.heading(), fuel: c.fuel };
    }
    return { v: 1, car, parts: [...CAR.parts], stations: [...this.stations] };
  }

  /** 读档。data 不是 save() 给的东西（null、旧格式）就什么都不改 */
  load(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const d = data as { car?: { x?: unknown; z?: unknown; h?: unknown; fuel?: unknown } | null; parts?: unknown; stations?: unknown };
    if (this.driving && this.walker) this.forceExit(this.walker);
    this.stopPump();
    CAR.parts.clear();
    if (Array.isArray(d.parts)) for (const id of d.parts) if (PART_ITEMS.some((p) => p.id === id)) CAR.parts.add(id as CarPartId);
    this.applyParts();
    this.stations.clear();
    if (Array.isArray(d.stations)) {
      for (const e of d.stations as unknown[]) {
        if (Array.isArray(e) && typeof e[0] === 'number' && typeof e[1] === 'number' && Number.isFinite(e[1])) this.stations.set(e[0], Math.max(0, e[1]));
      }
    }
    const c = this.car;
    const s = d.car;
    if (c && s && typeof s.x === 'number' && typeof s.z === 'number' && Number.isFinite(s.x) && Number.isFinite(s.z)) {
      c.body.place(s.x, s.z, typeof s.h === 'number' && Number.isFinite(s.h) ? s.h : 0, this.ground);
      c.body.engineOn = false;
      if (typeof s.fuel === 'number' && Number.isFinite(s.fuel)) c.fuel = Math.max(0, Math.min(c.tank, s.fuel));
      c.touch();
      c.sync(0);
    }
  }

  // ---------------------------------------------------------------- 每帧
  update(dt: number, keys: DriveKeys, night: number, player: Walker): void {
    this.walker = player;
    for (let i = this.later.length - 1; i >= 0; i--) {
      const l = this.later[i] as { t: number; fn: () => void };
      l.t -= dt;
      if (l.t <= 0) {
        this.later.splice(i, 1);
        l.fn();
      }
    }
    if (this.cooldown > 0) this.cooldown -= dt;
    let v = this.driving;
    // 车速快的时候没有「下车」的提示，E 在这里接：只是告诉玩家太快了
    const eDown = keys.has('KeyE');
    const tap = this.eTap || (eDown && !this.eWas);
    this.eTap = false;
    this.eWas = eDown;
    if (v && tap && !this.leaving && v.body.vel.lengthSq() > EXIT_MAX * EXIT_MAX) this.requestExit();
    // 输入
    const inp = this.inp;
    if (v) {
      if (this.leaving) {
        // 按了 E：松油门、四轮刹住，停稳就下车。两秒半还没停住（很陡的坡上往下滑）：慢就照下，快就算了
        this.leaveT += dt;
        v.steer += Math.max(-4.5 * dt, Math.min(4.5 * dt, -v.steer));
        inp.fwd = 0;
        inp.back = 0;
        inp.handbrake = true;
        inp.park = true;
        const sp = v.body.vel.length();
        if (sp < EXIT_STILL || (this.leaveT > 2.5 && sp < 1.5)) {
          this.exit(false);
          v = null;
        } else if (this.leaveT > 2.5) {
          this.leaving = false;
          this.say('车停不住，下不了车');
        }
      } else {
        const want = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
        const rate = want === 0 || Math.sign(want) !== Math.sign(v.steer) ? 4.5 : 2.4;
        v.steer += Math.max(-rate * dt, Math.min(rate * dt, want - v.steer));
        inp.fwd = keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0;
        inp.back = keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0;
        inp.handbrake = keys.has('Space');
        // 松开油门和刹车、车几乎停住了：自动驻车（坡上不会自己溜下去），一踩油门就松开
        inp.park = inp.fwd === 0 && inp.back === 0 && v.body.vel.lengthSq() < HOLD_SPEED * HOLD_SPEED;
      }
      if (v) {
        inp.steer = v.steer;
        if (v.body.drowned) this.say('车进水熄火了');
        this.surfT -= dt;
        if (this.surfT <= 0) {
          this.surfT = 0.15;
          this.surface(v);
        }
      }
    }
    // 物理：固定步长；睡着的车不算（都睡着就整个跳过）
    let awake = false;
    for (const c of this.vehicles) if (!c.body.sleeping) awake = true;
    if (!awake) this.acc = 0;
    else {
      this.acc = Math.min(this.acc + dt, STEP * 12);
      while (this.acc >= STEP) {
        this.acc -= STEP;
        for (const c of this.vehicles) {
          if (c.body.sleeping) continue;
          if (c === v) c.body.step(inp, this.ground);
          else {
            // 没人开：驻车，方向盘慢慢回正
            c.steer += Math.max(-2.4 * STEP, Math.min(2.4 * STEP, -c.steer));
            this.parkInp.steer = c.steer;
            c.body.step(this.parkInp, this.ground);
          }
          this.collideWorld(c);
        }
        if (this.vehicles.length > 1) this.collidePairs();
      }
    }
    if (this.crashT > 0) this.crashT -= dt;
    // 油
    if (v && v.burn(dt)) {
      v.body.engineOn = false;
      this.audio.stop();
      this.say('没油了！发动机熄火：下车用汽油桶加油', 4);
    }
    if (v && v.body.engineOn) {
      const low = this.lowFuel(v);
      if (this.fuelWarn < 2 && v.fuel < 2.5) {
        this.fuelWarn = 2;
        this.say(`油快烧完了（约 ${v.range.toFixed(1)} 公里）`, 3);
      } else if (this.fuelWarn < 1 && v.fuel < low) {
        this.fuelWarn = 1;
        this.say(`油不多了：还能跑约 ${v.range.toFixed(1)} 公里`, 3);
      } else if (v.fuel > low + 1) this.fuelWarn = 0;
    }
    const lit = !!v && (this.lightsManual ?? night > 0.35);
    for (const c of this.vehicles) {
      c.lights = c === v && lit;
      c.sync(dt);
    }
    // 大灯（装了车顶射灯：更亮、更宽、更远）
    if (v && v.lights) {
      const bar = v === this.car && CAR.parts.has('lightbar');
      const lamp = v.def.layout.lampLow;
      const fz = lamp ? -lamp[0] : v.hull.cz - v.hull.hz;
      const fy = lamp ? lamp[2] : 0.8;
      v.local(0, bar ? fy + 0.5 : fy, fz, _v);
      this.headlight.position.copy(_v);
      v.local(0, fy - (bar ? 1.3 : 1.6), fz - (bar ? 30 : 22), _w);
      this.lightTarget.position.copy(_w);
      this.lightTarget.updateMatrixWorld();
      this.headlight.intensity = bar ? 430 : 260;
      this.headlight.distance = bar ? 115 : 70;
      this.headlight.angle = bar ? 0.82 : 0.55;
    } else this.headlight.intensity = 0;
    this.parts?.setLights(!!this.car && this.car.lights);
    // 声音
    if (v) {
      const b = v.body;
      this.audio.update(dt, b.rpm, b.throttle, b.speed, b.skid, this.view === 'cockpit');
      player.x = v.rig.root.position.x;
      player.z = v.rig.root.position.z;
      player.feet = this.world.groundAt(player.x, player.z);
    }
    // 动静：引擎（怠速 25 米，转速越高越远，到 60 米）、喇叭 120 米，半秒报一次
    this.noiseT -= dt;
    if (this.noiseT <= 0) {
      this.noiseT = 0.5;
      if (v) {
        const b = v.body;
        if (b.engineOn) this.onNoise(b.pos.x, b.pos.z, 25 + 35 * Math.max(0, Math.min(1, (b.rpm - v.def.phys.idleRpm) / (v.def.phys.cutRpm - v.def.phys.idleRpm))));
        if (this.hornOn) this.onNoise(b.pos.x, b.pos.z, 120);
      }
    }
    // 站在哪台车旁边
    this.near = null;
    if (!v) {
      let best = REACH;
      for (const c of this.vehicles) {
        const pos = c.rig.root.position;
        if (Math.abs(pos.x - player.x) > 8 || Math.abs(pos.z - player.z) > 8) continue;
        const d = c.distance(player.x, player.z);
        if (d < best && Math.abs(pos.y - player.feet) < 2) {
          best = d;
          this.near = c;
        }
      }
    }
    // 加油机在不在旁边（开着的车 / 身边的车），四分之一秒看一次
    const subject = v ?? this.near;
    this.pumpT -= dt;
    if (!subject) {
      this.pump.site = null;
      this.pump.d = Infinity;
    } else if (this.pumpT <= 0) {
      this.pumpT = 0.25;
      this.scanPumps(subject);
    }
    this.refuel(dt, keys.has('KeyF'));
    // 这两样是上一帧 interactions() 留下的；玩法层这一帧不来问（开着背包、死了）就不算数
    this.offered = null;
    this.fullHint = '';
    this.hud(dt, v);
  }

  /** 按住 F 的那几样：加油机一直加；倒油、装东西的声音；油箱盖 */
  private refuel(dt: number, fDown: boolean): void {
    const v = this.pumping;
    if (v) {
      const site = this.pumpSite;
      const left = site ? this.reserve(site) : 0;
      if (this.driving || this.near !== v || !site || this.pump.site !== site || this.pump.d > PUMP_RANGE + 0.5) this.stopPump();
      else if (!fDown) this.stopPump();
      else if (left <= 0) this.stopPump('油罐抽空了，');
      else {
        const add = v.refuel(Math.min(PUMP_RATE * dt, left));
        this.stations.set(site.key, left - add);
        this.pumped += add;
        if (v.tank - v.fuel < 0.01) this.stopPump('油箱满了，');
      }
    }
    // 没给加油的提示却按了 F：说一声为什么（油箱满了、油罐是空的）
    if (fDown && !this.fWas && !this.driving && this.near && this.fullHint && !this.pumping) this.say(this.fullHint);
    this.fWas = fDown;
    const work: WorkSound | null = this.pumping ? 'pump' : fDown && !this.driving && this.near ? (this.offered === 'pump' ? null : this.offered) : null;
    this.audio.setWork(work);
    const car = this.near ?? this.pumping;
    if (car) car.capWant = this.pumping === car || work === 'can' ? 1 : 0;
    else if (this.car && this.car.capWant) this.car.capWant = 0;
  }

  /** 轮子底下是什么路面：铺装路抓地 1；土路、碎石差一点；野地（草、泥）打滑还拖车。越野胎在野地上几乎不打折 */
  private surface(v: Vehicle): void {
    const b = v.body;
    const x = b.pos.x;
    const z = b.pos.z;
    const ctx = this.world.ctxAt(x, z);
    let kind = 2;
    const r = this.world.terrain.road(x, z, ctx, 8);
    if (r && r.d < r.w / 2 + 0.5) kind = r.kind === 'dirt' ? 1 : 0;
    else {
      const f = this.world.terrain.flatAt(x, z, ctx);
      const paint = f && f.k > 0.5 ? f.f.paint : undefined;
      if (paint === 'asphalt' || paint === 'concrete') kind = 0;
      else if (paint === 'gravel') kind = 1;
    }
    const off = v === this.car && CAR.parts.has('tires');
    b.gripScale = kind === 0 ? 1 : kind === 1 ? (off ? 1 : 0.92) : off ? 0.98 : 0.8;
    b.rollAdd = kind === 0 ? 0 : kind === 1 ? (off ? 0.004 : 0.008) : off ? 0.012 : 0.03;
  }

  private hud(dt: number, v: Vehicle | null): void {
    this.toastT -= dt;
    this.hudT -= dt;
    if (this.hudT > 0) return;
    this.hudT = 0.08;
    const pv = this.pumping;
    if (pv) this.dash.say(`加油中 ${pv.fuel.toFixed(1)} / ${pv.tank} 升`, pv.fuel / pv.tank);
    else this.dash.say(this.toastT > 0 ? this.toast : '');
    if (!v) {
      this.dash.set(null);
      return;
    }
    const b = v.body;
    const s = this.ds;
    s.name = v.def.name;
    s.kmh = Math.abs(b.speed) * 3.6;
    s.gear = !b.engineOn ? '—' : b.gear === -1 ? 'R' : String(b.gear);
    s.rpm = b.rpm / v.def.phys.cutRpm;
    s.red = b.rpm > v.def.phys.cutRpm * 0.9;
    s.fuel = v.fuel / v.tank;
    s.fuelState = v.fuel <= 0 ? 'empty' : v.fuel < 2.5 ? 'crit' : v.fuel < this.lowFuel(v) ? 'low' : 'ok';
    s.fuelText = v.fuel <= 0 ? '没油了' : `${v.fuel.toFixed(1)} 升 · 约 ${v.range.toFixed(1)} 公里`;
    s.parts = v === this.car ? this.partsLabel : '';
    // 仪表上面那一行：没油 > 加油机 > 油量低
    let hint = '';
    const site = this.pump.site;
    if (v.fuel <= 0) hint = '没油了：下车，站在车旁用汽油桶加油（按住 F）';
    else if (site && v.tank - v.fuel > 1) {
      if (this.reserve(site) <= 0.05) hint = `${site.name}的油罐是空的`;
      else if (this.pump.d <= PUMP_RANGE) hint = '加油机够得着：下车，站在车旁按住 F 加油';
      else hint = `旁边有加油机：再靠近 ${Math.ceil(this.pump.d - PUMP_RANGE)} 米`;
    } else if (s.fuelState !== 'ok') hint = '油量低';
    s.hint = hint;
    this.hint = hint;
    this.dash.set(s);
  }

  /** 调试 / 测试：车的数量、醒着几台、仪表上那行提示、每台车现在用哪一档模型 */
  stats(): { cars: number; awake: number; hint: string; lod: number[] } {
    return { cars: this.vehicles.length, awake: this.vehicles.filter((c) => !c.body.sleeping).length, hint: this.hint, lod: this.vehicles.map((c) => c.rig.lod) };
  }

  /** 调试：在 (x, z) 再放一台车（量绘制次数用；正式的世界里只有 garage.car 那一台） */
  debugSpawn(x: number, z: number, yaw = 0): Vehicle | null {
    const a = this.car?.rig.asset;
    if (!a) return null;
    const v = this.add(a);
    v.fuel = 5;
    v.body.place(x, z, yaw + Math.PI, this.ground);
    return v;
  }

  /** 开车时的相机；返回 false = 没在开车（主循环用玩家相机）。上下车过渡的那零点几秒也归这里管 */
  camera(cam: PerspectiveCamera, dt: number): boolean {
    this.cam = cam;
    for (const c of this.vehicles) {
      const d = cam.position.distanceTo(c.rig.root.position);
      c.rig.setDistance(d, c === this.driving && this.view === 'cockpit', c.live);
      if (c === this.car) this.parts?.setLod(d > 160 ? 2 : c.rig.lod < 2 ? 0 : 1);
    }
    if (this.blendGrab) {
      // 过渡的起点 = 相机上一帧在哪
      this.blendGrab = false;
      this.blendPos.copy(cam.position);
      _e.setFromQuaternion(cam.quaternion, 'YXZ');
      this.blendYaw = _e.y;
      this.blendPitch = _e.x;
      this.blendRoll = _e.z;
    }
    const v = this.driving;
    if (!v) return this.blendT >= 0 && this.blendOut && !!this.walker && this.walkBlend(cam, dt, this.walker);
    const b = v.body;
    if (this.view === 'cockpit') {
      v.eyeLocal(_v);
      v.rig.lean.localToWorld(_v);
      cam.position.copy(_v);
      v.rig.lean.getWorldQuaternion(_q);
      _e.set(this.lookPitch, this.lookYaw, 0, 'YXZ');
      cam.quaternion.copy(_q).multiply(_lq.setFromEuler(_e));
    } else {
      // 跟车：转向车头方向（倒车时不翻过来），鼠标绕着看
      const heading = b.heading();
      const len = v.hull.hz * 2;
      const dist = Math.max(4.2, len * 1.2 + 1.6);
      this.camIdle += dt;
      if (this.camIdle > 1.5 && Math.abs(b.speed) > 2) this.camYaw *= Math.exp(-dt * 2.5);
      if (this.camIdle > 1.5 && Math.abs(b.speed) > 2) this.camPitch += (0.12 - this.camPitch) * Math.min(1, dt * 2);
      let dh = heading - this.camHeading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      this.camHeading += dh * (this.camReady ? Math.min(1, dt * 3.5) : 1);
      const yaw = this.camHeading + this.camYaw;
      const pitch = this.camPitch;
      v.local(0, v.hull.y1 * 0.8, v.hull.cz, _t);
      _n.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      _w.copy(_t).addScaledVector(_n, dist);
      _w.y += 0.6;
      const g = this.world.groundAt(_w.x, _w.z) + 0.5;
      if (_w.y < g) _w.y = g;
      if (!this.camReady) {
        this.camPos.copy(_w);
        this.camReady = true;
      } else this.camPos.lerp(_w, 1 - Math.exp(-dt * 10));
      cam.position.copy(this.camPos);
      // 撞击的震动
      if (this.shake > 0) {
        cam.position.x += (Math.random() - 0.5) * this.shake * 0.25;
        cam.position.y += (Math.random() - 0.5) * this.shake * 0.25;
        this.shake = Math.max(0, this.shake - dt * 3);
      }
      cam.lookAt(_t.x, _t.y + 0.3, _t.z);
    }
    if (this.blendT >= 0 && !this.blendOut) {
      // 上车：从走路时的相机挪到车的相机
      this.blendT += dt;
      const e = ease((this.blendT - BLEND_DELAY) / BLEND);
      if (e >= 1) this.blendT = -1;
      else {
        _w.copy(cam.position);
        cam.position.copy(this.blendPos).lerp(_w, e);
        _e.setFromQuaternion(cam.quaternion, 'YXZ');
        this.aim(cam, _e.y, _e.x, _e.z, e);
      }
    }
    cam.updateMatrixWorld();
    return true;
  }

  /** 过渡中相机的朝向：偏航、俯仰、侧倾分开插（两个四元数直接插，走到一半地平线是歪的） */
  private aim(cam: PerspectiveCamera, yaw: number, pitch: number, roll: number, e: number): void {
    _e.set(this.blendPitch + (pitch - this.blendPitch) * e, this.blendYaw + wrap(yaw - this.blendYaw) * e, this.blendRoll + (roll - this.blendRoll) * e, 'YXZ');
    cam.quaternion.setFromEuler(_e);
  }

  /**
   * 下车：相机从车的相机挪到玩家眼睛的位置。返回 true 的这几帧里 main.ts 会把 player.yaw 改成相机的朝向，
   * 所以目标朝向自己记着（outYaw），每帧把「player.yaw 比上一帧相机朝向多转的那一点」（= 鼠标）加进去
   */
  private walkBlend(cam: PerspectiveCamera, dt: number, p: Walker): boolean {
    if (this.blendFirst) {
      this.blendFirst = false;
      this.outYaw = p.yaw;
    } else this.outYaw += wrap(p.yaw - this.lastYaw);
    this.blendT += dt;
    const e = ease((this.blendT - BLEND_DELAY) / BLEND);
    if (e >= 1) {
      p.yaw = this.outYaw;
      this.blendT = -1;
      return false;
    }
    // 第一人称的相机（和 main.ts 摆的一样，连走路的晃动）
    const bobK = (p.onGround ?? true) ? Math.min(1, (p.speed ?? 0) / 4) : 0;
    const ph = (p.bob ?? 0) * Math.PI;
    const bx = Math.sin(ph) * 0.03 * bobK;
    _t.set(p.x - Math.cos(this.outYaw) * bx, p.feet + (p.eye ?? 1.62) + Math.abs(Math.sin(ph)) * 0.045 * bobK, p.z + Math.sin(this.outYaw) * bx);
    cam.position.copy(this.blendPos).lerp(_t, e);
    this.aim(cam, this.outYaw + Math.PI, p.pitch, 0, e);
    cam.updateMatrixWorld();
    cam.getWorldDirection(_v);
    this.lastYaw = Math.atan2(_v.x, _v.z);
    return true;
  }

  // ---------------------------------------------------------------- 碰撞
  /** 撞了一下：附近的丧尸听得见（0.3 秒内只报一次） */
  private crashNoise(c: Vehicle, radius: number): void {
    if (this.crashT > 0) return;
    this.crashT = 0.3;
    this.onNoise(c.body.pos.x, c.body.pos.z, radius);
  }

  /** 车身中线一串圆 → 地图碰撞体（墙、树、石头、营地的东西）：推出来 + 冲量 */
  private collideWorld(c: Vehicle): void {
    const b = c.body;
    const fy = b.pos.y - c.def.phys.comY;
    const midY = c.hull.y0 + (c.hull.y1 - c.hull.y0) * 0.4;
    let hard = 0;
    for (const ci of c.circles) {
      _v.set(0, midY, ci.z).sub(b.com).applyQuaternion(b.q).add(b.pos);
      _o.set(_v.x, 0, _v.z);
      if (!this.world.collide(_o, fy + c.hull.y0, c.hull.y1 - c.hull.y0, ci.r, 0.35, false)) continue;
      const dx = _o.x - _v.x;
      const dz = _o.z - _v.z;
      const d = Math.hypot(dx, dz);
      if (d < 1e-5) continue;
      _n.set(dx / d, 0, dz / d);
      b.pos.x += dx;
      b.pos.z += dz;
      _w.set(_v.x - _n.x * ci.r, _v.y, _v.z - _n.z * ci.r);
      b.pointVel(_w, _t);
      const vn = _t.dot(_n);
      if (vn < 0) {
        const j = (-vn * 1.25) / b.invMassAt(_w, _n);
        // 擦墙：切向速度也掉一点
        _t.addScaledVector(_n, -vn);
        const vt = _t.length();
        _t.normalize();
        const jt = vt > 0.01 ? Math.min(j * 0.3, vt / b.invMassAt(_w, _t)) : 0;
        _t.multiplyScalar(-jt).addScaledVector(_n, j);
        b.applyImpulse(_t, _w);
        hard = Math.max(hard, -vn);
      }
    }
    if (hard > 1.5) {
      if (c === this.driving) {
        this.audio.crash(Math.min(1, hard / 12));
        this.shake = Math.max(this.shake, Math.min(1, hard / 10));
      }
      this.crashNoise(c, 40 + 50 * Math.min(1, hard / 12));
    }
  }

  /** 车和车：A 的圆 vs B 的外壳盒子（正式的世界里只有一台车，调试放了第二台才会走到这里） */
  private collidePairs(): void {
    const list = this.vehicles;
    for (let i = 0; i < list.length; i++) {
      for (let j = 0; j < list.length; j++) {
        if (i === j) continue;
        const a = list[i]!;
        const o = list[j]!;
        if (a.body.sleeping && o.body.sleeping) continue;
        const reach = a.hull.hz + o.hull.hz + 1;
        if (Math.abs(a.body.pos.x - o.body.pos.x) > reach || Math.abs(a.body.pos.z - o.body.pos.z) > reach) continue;
        if (Math.abs(a.body.pos.y - o.body.pos.y) > 2.5) continue;
        o.updateHull();
        const midY = a.hull.y0 + (a.hull.y1 - a.hull.y0) * 0.4;
        for (const ci of a.circles) {
          _v.set(0, midY, ci.z).sub(a.body.com).applyQuaternion(a.body.q).add(a.body.pos);
          const [lx, lz] = o.toHull(_v.x, _v.z);
          const hx = o.hull.hx;
          const hz = o.hull.hz;
          const qx = Math.max(-hx, Math.min(hx, lx));
          const qz = Math.max(-hz, Math.min(hz, lz));
          let px = lx - qx;
          let pz = lz - qz;
          const d = Math.hypot(px, pz);
          if (d >= ci.r) continue;
          let pen: number;
          if (d > 1e-5) {
            px /= d;
            pz /= d;
            pen = ci.r - d;
          } else {
            const ox = hx - Math.abs(lx);
            const oz = hz - Math.abs(lz);
            if (ox < oz) {
              px = Math.sign(lx || 1);
              pz = 0;
              pen = ox + ci.r;
            } else {
              px = 0;
              pz = Math.sign(lz || 1);
              pen = oz + ci.r;
            }
          }
          const [wx, wz] = o.fromHull(lx + px, lz + pz);
          const [ox0, oz0] = o.fromHull(lx, lz);
          _n.set(wx - ox0, 0, wz - oz0).normalize();
          const ma = a.body.invMass;
          const mb = o.body.invMass;
          a.body.pos.addScaledVector(_n, (pen * ma) / (ma + mb));
          o.body.pos.addScaledVector(_n, (-pen * mb) / (ma + mb));
          const [cx, cz] = o.fromHull(qx, qz);
          _w.set(cx, _v.y, cz);
          a.body.pointVel(_w, _t);
          const rel = _t.sub(o.body.pointVel(_w, _o)).dot(_n);
          if (rel < 0) {
            const jn = (-rel * 1.2) / (a.body.invMassAt(_w, _n) + o.body.invMassAt(_w, _n));
            _t.copy(_n).multiplyScalar(jn);
            a.body.applyImpulse(_t, _w);
            _t.multiplyScalar(-1);
            o.body.applyImpulse(_t, _w);
            a.body.wake();
            o.body.wake();
            if (a === this.driving || o === this.driving) {
              this.audio.crash(Math.min(1, -rel / 10));
              this.shake = Math.max(this.shake, Math.min(1, -rel / 10));
            }
            if (-rel > 1.5) this.crashNoise(a, 40 + 50 * Math.min(1, -rel / 12));
          }
        }
      }
    }
  }
}
