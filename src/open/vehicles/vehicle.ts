import { Vector3 } from 'three';
import type { DynCollider } from '../world/world';
import { VehicleRig, type VehicleAsset } from './model';
import { VehicleBody } from './physics';
import type { Seat, VehicleDef } from './types';

/**
 * 一台车：物理（VehicleBody）+ 模型（VehicleRig）+ 给玩家用的碰撞体（车身外壳 = 一个带朝向的竖直盒子，能站上车顶）
 * + 油箱。sync() 每帧把物理姿态写到模型上：轮子（悬挂、转向、滚动）、方向盘、车门 / 尾门 / 油箱盖、车灯；
 * 停稳睡着、门都关好以后 sync() 什么都不做。
 */

const _v = new Vector3();
const _w = new Vector3();
const AX_Y = new Vector3(0, 1, 0);
const AX_X = new Vector3(1, 0, 0);

/**
 * 车包没写油箱和油耗时的默认值（见 types.ts 的 VehicleFuel）。
 * 量出来（.logs/veh/exit.ts）：公路上 70–85 km/h 约 3 升 / 公里（一桶 10 升跑 3 公里多），油门踩到底翻倍；怠速一小时 5 升
 */
export const DEFAULT_TANK = 45;
const DEFAULT_FULL = 0.25;
const DEFAULT_IDLE = 0.0015;
/** 估续航用的油耗（升 / 公里）：刚上车、还没跑起来时按这个算 */
export const NOMINAL_PER_KM = 3;

const approach = (v: number, to: number, step: number): number => v + Math.sign(to - v) * Math.min(Math.abs(to - v), step);
const ease = (t: number): number => t * t * (3 - 2 * t);

export interface Hull {
  /** 车身坐标的外壳盒子 */
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  y0: number;
  y1: number;
}

export class Vehicle implements DynCollider {
  readonly def: VehicleDef;
  readonly body: VehicleBody;
  readonly rig: VehicleRig;
  readonly hull: Hull;
  /** 外壳沿车身中线的一串圆（和地图碰撞用）：车身坐标 z 和半径 */
  readonly circles: Array<{ z: number; r: number }> = [];
  readonly seat: Seat;
  /** 驾驶侧（-1 左舵、1 右舵、0 摩托） */
  readonly side: number;
  readonly driverDoor: string | null;
  /** 车门开合 0..1 和目标（openDoor 开一会儿自己关） */
  door = 0;
  doorWant = 0;
  private doorT = 0;
  /** 尾门、油箱盖 0..1 和目标 */
  gate = 0;
  gateWant = 0;
  cap = 0;
  capWant = 0;
  lights = false;
  /** 平滑过的方向盘输入 -1..1（没人开的时候慢慢回正） */
  steer = 0;
  /** 油箱容量（升；副油箱会加大）、现在的油量（升） */
  tank: number;
  fuel: number;
  /** 最近的油耗（升 / 公里，平滑过），估续航用 */
  perKm = NOMINAL_PER_KM;
  private readonly baseTank: number;
  private readonly fullFlow: number;
  private readonly idleFlow: number;
  /** 外壳在世界里：中心、朝向（每帧算一次） */
  private wx = 0;
  private wz = 0;
  private c = 1;
  private s = 0;
  private wy0 = 0;
  private wy1 = 0;
  private readonly steerAxis: Vector3;
  private readonly swing: { pivot: [number, number, number]; rest: number; len: number } | null = null;
  /** 上一次 sync 以后车没再动过（睡着、门都停住了）：下一次可以跳过 */
  private frozen = false;
  private lit = false;

  constructor(asset: VehicleAsset) {
    this.def = asset.def;
    this.body = new VehicleBody(asset.def);
    this.rig = new VehicleRig(asset);
    const h = asset.def.hull;
    this.hull = {
      cx: (h.min[0] + h.max[0]) / 2,
      cz: (h.min[2] + h.max[2]) / 2,
      hx: (h.max[0] - h.min[0]) / 2,
      hz: (h.max[2] - h.min[2]) / 2,
      y0: Math.max(0.15, h.min[1]),
      y1: h.max[1],
    };
    const r = this.hull.hx * 0.96;
    const z0 = h.min[2] + r;
    const z1 = h.max[2] - r;
    const n = Math.max(2, Math.ceil((z1 - z0) / (r * 0.9)) + 1);
    for (let i = 0; i < n; i++) this.circles.push({ z: z0 + ((z1 - z0) * i) / (n - 1), r });
    this.seat = asset.def.layout.seats[0] ?? { forward: 0, right: 0 };
    this.side = Math.sign(this.seat.right);
    const doorName = this.side < 0 ? 'door_l' : this.side > 0 ? 'door_r' : null;
    this.driverDoor = doorName && this.rig.bones.has(doorName) ? doorName : null;
    const st = asset.def.layout.steer;
    this.steerAxis = new Vector3(0, st.ay, st.az).normalize();
    const sw = asset.def.bones.swingarm;
    if (sw) {
      const dz = asset.def.phys.rearZ - sw[2];
      this.swing = { pivot: sw, rest: Math.atan2(asset.def.phys.radius - sw[1], dz), len: dz };
    }
    const f = asset.def.fuel;
    this.baseTank = f?.tank ?? DEFAULT_TANK;
    this.tank = this.baseTank;
    this.fuel = this.tank;
    this.fullFlow = f?.full ?? DEFAULT_FULL;
    this.idleFlow = f?.idle ?? DEFAULT_IDLE;
  }

  /** 车身坐标 → 世界（含摩托压弯） */
  local(x: number, y: number, z: number, out: Vector3): Vector3 {
    return this.rig.lean.localToWorld(out.set(x, y, z));
  }

  /** 驾驶员眼睛（车身坐标） */
  eyeLocal(out: Vector3): Vector3 {
    const s = this.seat;
    const cushion = s.cushion ?? this.def.layout.cabCushion;
    // 坐姿眼高 ≈ 坐垫上 0.62 米（车包的 scale 是给矮车缩小的驾驶员，按开方缩）；眼睛在胯点后面一点（靠背是斜的）
    return out.set(s.right, cushion + 0.62 * Math.sqrt(s.scale ?? 1) + (s.eyeLift ?? 0), -(s.forward + (s.eyeForward ?? 0)) + 0.15);
  }

  // ---------------------------------------------------------------- 油
  /** 副油箱：油箱加大 extra 升 */
  setExtraTank(extra: number): void {
    this.tank = this.baseTank + extra;
    this.fuel = Math.min(this.fuel, this.tank);
  }

  /** 现在每秒烧多少升（发动机没开 = 0）：怠速一点点，转速高一些多一点，主要看出了多少力 */
  flow(): number {
    const b = this.body;
    if (!b.engineOn) return 0;
    const rev = Math.min(3, Math.max(1, b.rpm / Math.max(1, this.def.phys.idleRpm)));
    return this.idleFlow * (0.6 + 0.4 * rev) + this.fullFlow * b.power01();
  }

  /** 烧 dt 秒的油。返回 true = 这一下烧干了（调用方熄火、提示） */
  burn(dt: number): boolean {
    if (this.fuel <= 0) return false;
    const f = this.flow();
    if (f <= 0) return false;
    this.fuel -= f * dt;
    // 跑起来以后才更新油耗（怠速、起步时「每公里多少升」没有意义）
    const sp = Math.abs(this.body.speed);
    if (sp > 6) this.perKm += (Math.max(1.2, Math.min(9, (f / sp) * 1000)) - this.perKm) * Math.min(1, dt * 0.06);
    if (this.fuel > 0) return false;
    this.fuel = 0;
    return true;
  }

  /** 加 litres 升，返回实际加进去多少 */
  refuel(litres: number): number {
    const add = Math.max(0, Math.min(litres, this.tank - this.fuel));
    this.fuel += add;
    return add;
  }

  /** 剩下的油还能跑多远（公里，估的） */
  get range(): number {
    return this.fuel / this.perKm;
  }

  // ---------------------------------------------------------------- 模型
  /** 驾驶员的门打开 seconds 秒以后自己关上 */
  openDoor(seconds: number): void {
    this.doorWant = 1;
    this.doorT = seconds;
  }

  /** 这台车现在会动（在开、还没停稳、门 / 尾门 / 油箱盖没关好、灯亮着）：模型要用会动的那一档 */
  get live(): boolean {
    return !this.body.sleeping || this.door > 0 || this.doorWant > 0 || this.gate > 0 || this.gateWant > 0 || this.cap > 0 || this.capWant > 0 || this.lights;
  }

  /** 车被直接挪了位置（读档、调试）：下一次 sync 不能跳过 */
  touch(): void {
    this.frozen = false;
  }

  /** 物理姿态 → 模型；dt 给车门动画用 */
  sync(dt: number): void {
    const b = this.body;
    const anim = this.door !== this.doorWant || this.doorT > 0 || this.gate !== this.gateWant || this.cap !== this.capWant;
    const still = b.sleeping && !anim;
    if (still && this.frozen && this.lights === this.lit) return;
    this.frozen = still;
    this.lit = this.lights;
    const root = this.rig.root;
    b.origin(root.position);
    root.quaternion.copy(b.q);
    this.rig.lean.rotation.z = -b.lean;
    root.updateMatrixWorld(true);
    // 轮子
    const bike = this.def.kind === 'bike';
    for (let i = 0; i < this.rig.wheels.length; i++) {
      const node = this.rig.wheels[i]!;
      const w = this.def.wheels[i]!;
      const pw = bike ? [b.wheels[i * 2]!, b.wheels[i * 2 + 1]!] : [b.wheels[i]!];
      const y = pw.reduce((s, q) => s + q.y, 0) / pw.length;
      const spin = pw.reduce((s, q) => s + q.spin, 0) / pw.length;
      if (bike && w.steer) {
        // 前轮挂在前叉节点下：位置相对转向支点
        const st = this.def.layout.steer;
        node.holder.position.set(w.x - st.x, y - st.y, w.z - st.z);
      } else {
        node.holder.position.y = y;
        if (w.steer) node.steer.rotation.y = -b.steerAngle;
      }
      node.spin.rotation.x = w.side < 0 ? spin : -spin;
      if (bike && !w.steer && this.swing) {
        const a = Math.atan2(y - this.swing.pivot[1], this.swing.len) - this.swing.rest;
        this.rig.rotateBone('swingarm', AX_X, -a);
      }
    }
    // 方向盘 / 车把
    const st = this.def.layout.steer;
    if (bike) {
      this.rig.rotateBone('steering', this.steerAxis, b.steerAngle);
      this.rig.rotateBone('fork', this.steerAxis, b.steerAngle);
      this.rig.fork?.quaternion.setFromAxisAngle(this.steerAxis, b.steerAngle);
    } else this.rig.rotateBone('steering', this.steerAxis, b.steerAngle * st.ratio);
    // 车门
    if (this.doorT > 0) {
      this.doorT -= dt;
      if (this.doorT <= 0) this.doorWant = 0;
    }
    if (this.driverDoor) {
      this.door = approach(this.door, this.doorWant, dt * 3.2);
      const e = ease(this.door);
      const ax = this.def.layout.doorAxis;
      if (ax) {
        // 蝴蝶门：车包给的是一边的轴，另一边镜像
        _v.set(ax[0] * this.side, ax[1], ax[2]).normalize();
        this.rig.rotateBone(this.driverDoor, _v, (((this.def.layout.doorAngle ?? 100) * Math.PI) / 180) * e * this.side);
      } else this.rig.rotateBone(this.driverDoor, AX_Y, ((70 * Math.PI) / 180) * e * DOOR_SIGN * this.side);
    } else this.door = this.doorWant;
    // 尾门（铰链在下边，往后放平）、油箱盖（铰链在前边，往外翻）
    this.gate = approach(this.gate, this.gateWant, dt * 2.4);
    this.rig.rotateBone('tailgate', AX_X, GATE_ANGLE * ease(this.gate));
    this.cap = approach(this.cap, this.capWant, dt * 5);
    this.rig.rotateBone('fuel_door', AX_Y, CAP_ANGLE * ease(this.cap));
    // 灯
    const rev = b.gear === -1 && b.engineOn;
    this.rig.setLamp('head', this.lights ? 6 : 0);
    this.rig.setLamp('park', this.lights ? 2.2 : 0);
    this.rig.setLamp('tail', b.braking && b.engineOn ? 5 : this.lights ? 1.6 : 0);
    this.rig.setLamp('reverse', rev ? 4 : 0);
    this.updateHull();
  }

  /** 外壳在世界里的位置 / 朝向 / 高度（碰撞用） */
  updateHull(): void {
    const b = this.body;
    b.origin(_w);
    const oy = _w.y;
    _v.set(this.hull.cx, 0, this.hull.cz).applyQuaternion(b.q).add(_w);
    this.wx = _v.x;
    this.wz = _v.z;
    _w.set(0, 0, -1).applyQuaternion(b.q);
    const hd = Math.atan2(-_w.x, -_w.z);
    this.c = Math.cos(hd);
    this.s = Math.sin(hd);
    this.wy0 = oy + this.hull.y0;
    this.wy1 = oy + this.hull.y1;
  }

  /** 世界点 → 外壳局部（x 右，z 后），不看俯仰 */
  toHull(x: number, z: number): [number, number] {
    const dx = x - this.wx;
    const dz = z - this.wz;
    return [dx * this.c - dz * this.s, dx * this.s + dz * this.c];
  }

  fromHull(lx: number, lz: number): [number, number] {
    return [this.wx + lx * this.c + lz * this.s, this.wz - lx * this.s + lz * this.c];
  }

  /** 玩家到外壳的水平距离（在里面 = 0） */
  distance(x: number, z: number): number {
    const [lx, lz] = this.toHull(x, z);
    return Math.hypot(Math.max(0, Math.abs(lx) - this.hull.hx), Math.max(0, Math.abs(lz) - this.hull.hz));
  }

  /** 外壳的世界高度范围（底、顶） */
  get bottom(): number {
    return this.wy0;
  }

  get top(): number {
    return this.wy1;
  }

  // ---------------------------------------------------------------- DynCollider（玩家）
  resolve(p: { x: number; z: number }, feet: number, height: number, r: number, step: number): boolean {
    if (this.wy1 <= feet + step || this.wy0 >= feet + height) return false;
    const [lx, lz] = this.toHull(p.x, p.z);
    const hx = this.hull.hx;
    const hz = this.hull.hz;
    if (Math.abs(lx) > hx + r || Math.abs(lz) > hz + r) return false;
    const qx = Math.max(-hx, Math.min(hx, lx));
    const qz = Math.max(-hz, Math.min(hz, lz));
    let px = lx - qx;
    let pz = lz - qz;
    const d = Math.hypot(px, pz);
    if (d >= r) return false;
    if (d > 1e-6) {
      px = (px / d) * (r - d);
      pz = (pz / d) * (r - d);
    } else {
      const ox = hx - Math.abs(lx);
      const oz = hz - Math.abs(lz);
      if (ox < oz) {
        px = (ox + r) * Math.sign(lx || 1);
        pz = 0;
      } else {
        px = 0;
        pz = (oz + r) * Math.sign(lz || 1);
      }
    }
    const [nx, nz] = this.fromHull(lx + px, lz + pz);
    p.x = nx;
    p.z = nz;
    return true;
  }

  /** 射线打到外壳（带朝向的盒子）的距离；没打到返回 Infinity */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): number {
    const [lx, lz] = this.toHull(ox, oz);
    const ldx = dx * this.c - dz * this.s;
    const ldz = dx * this.s + dz * this.c;
    let t0 = 0;
    let t1 = max;
    const slab = (o: number, d: number, lo: number, hi: number): boolean => {
      if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
      const a = (lo - o) / d;
      const b = (hi - o) / d;
      t0 = Math.max(t0, Math.min(a, b));
      t1 = Math.min(t1, Math.max(a, b));
      return t0 <= t1;
    };
    if (!slab(lx, ldx, -this.hull.hx, this.hull.hx) || !slab(lz, ldz, -this.hull.hz, this.hull.hz) || !slab(oy, dy, this.wy0, this.wy1)) return Infinity;
    return t0 < max ? t0 : Infinity;
  }

  topAt(x: number, z: number, r: number, feet: number, step: number): number {
    if (this.wy1 > feet + step + 0.01) return -Infinity;
    const [lx, lz] = this.toHull(x, z);
    const m = r * 0.6;
    return Math.abs(lx) <= this.hull.hx * 0.8 + m && Math.abs(lz) <= this.hull.hz * 0.85 + m ? this.wy1 : -Infinity;
  }
}

/**
 * 骨骼转动的方向（three 绕 +Y 转正角：+Z 转向 +X）。车头朝 -Z：
 *   门的铰链在前边、门板往后（+Z）伸：左门（side = -1）要往 -X 开 → 角度 = 70° × DOOR_SIGN × side，DOOR_SIGN = 1 时左门是 -70°
 *   尾门铰链在下边、门板往上伸：绕 +X 转正角是往后（+Z）放倒
 *   油箱盖在左后翼子板上，铰链在前边：往 -X 翻出来是负角
 */
const DOOR_SIGN = 1;
const GATE_ANGLE = Math.PI / 2;
const CAP_ANGLE = -1.75;
