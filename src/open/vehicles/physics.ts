import { Quaternion, Vector3 } from 'three';
import type { VehicleDef, VehiclePhys } from './types';

/**
 * 车辆物理：刚体（6 自由度，惯量用车包里的 ix / iy / iz）+ 每个轮子一根竖直射线的悬挂（弹簧 + 阻尼 + 防倾杆）
 * + 轮胎（侧偏角曲线、摩擦圆、手刹锁后轮）+ 传动（原车扭矩曲线、齿比、自动挡）+ 风阻 / 下压力。
 * 固定步长 1/120 秒。车身坐标：+X 右、+Y 上、车头 -Z；状态里的位置是质心。
 *
 * 摩托：物理上当成轮距很窄的四个接地点（不会倒），侧向力加在质心高度（不产生侧倾力矩），压弯只是视觉。
 * 轿车：侧向力的作用点抬高到质心高度的 45%，翻车要比真车难一些（游戏里好开）。
 */

export const STEP = 1 / 120;
const G = 9.81;

export interface DriveInput {
  /** W：0..1 */
  fwd: number;
  /** S：0..1 */
  back: number;
  /** 方向：-1 左 .. 1 右（已经平滑过） */
  steer: number;
  handbrake: boolean;
  /**
   * 驻车（没人开的车、按 E 下车时自动停车）：四个轮子都锁死，按静摩擦算。
   * 手刹只锁后轮、抓地还打了折，20° 的坡上停不住；坡上的车也不会一点一点往下溜
   */
  park?: boolean;
}

export interface Ground {
  height(x: number, z: number): number;
  water(x: number, z: number): number;
}

export interface PhysWheel {
  /** 车身坐标里的安装位置（x, z） */
  x: number;
  z: number;
  front: boolean;
  steer: boolean;
  drive: boolean;
  k: number;
  c: number;
  /** 静载（牛） */
  w0: number;
  /** 压缩量（米，0 = 完全伸长） */
  comp: number;
  contact: boolean;
  load: number;
  /** 轮心高度（车身坐标），给画面用 */
  y: number;
  /** 车轮滚过的角度 */
  spin: number;
  /** 打滑程度（0 = 抓地，1 = 完全滑） */
  slip: number;
  /** 驱动轮空转 */
  spinout: number;
}

const _u = new Vector3();
const _f = new Vector3();
const _r = new Vector3();
const _l = new Vector3();
const _p = new Vector3();
const _pc = new Vector3();
const _v = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _n = new Vector3();
const _F = new Vector3();
const _T = new Vector3();
const _qi = new Quaternion();
const _wq = new Quaternion();
const _tq = new Vector3();
const _m1 = new Vector3();
const _m2 = new Vector3();
const _iv = new Vector3();

function interp(xs: number[], ys: number[], x: number): number {
  if (x <= (xs[0] as number)) return ys[0] as number;
  for (let i = 1; i < xs.length; i++) {
    if (x <= (xs[i] as number)) {
      const t = (x - (xs[i - 1] as number)) / ((xs[i] as number) - (xs[i - 1] as number));
      return (ys[i - 1] as number) + ((ys[i] as number) - (ys[i - 1] as number)) * t;
    }
  }
  return ys[ys.length - 1] as number;
}

export class VehicleBody {
  readonly p: VehiclePhys;
  readonly bike: boolean;
  /** 质心（世界） */
  readonly pos = new Vector3();
  readonly q = new Quaternion();
  readonly vel = new Vector3();
  readonly ang = new Vector3();
  readonly wheels: PhysWheel[] = [];
  readonly mass: number;
  readonly invMass: number;
  private readonly invI: Vector3;
  /** 质心在车身坐标里的位置 */
  readonly com: Vector3;
  /** 车身外壳（车身坐标）：底面 / 车顶的角点，和地面碰撞 */
  private readonly hullPts: Vector3[] = [];
  readonly wheelbase: number;
  private readonly peakTorque: number;
  /** 高于这个的外壳点算车顶（翻车时摩擦大），以下算底盘（托底时滑过去） */
  private readonly hullRoof: number;
  /** 侧倾阻尼（牛·米·秒/弧度）；摩托另有「骑手平衡」的回正刚度 */
  private readonly rollDamp: number;
  private readonly rollStiff: number;

  // 传动
  engineOn = false;
  rpm = 0;
  /** -1 倒挡，0 空挡，1.. 前进挡 */
  gear = 1;
  private shiftT = 0;
  throttle = 0;
  braking = false;
  /** 当前前轮转角（弧度，右正） */
  steerAngle = 0;
  /** 本步最大的打滑 / 撞击冲量（给声音用） */
  skid = 0;
  /** 车身速度（米/秒，沿车头为正） */
  speed = 0;
  /** 视觉压弯角（摩托，弧度，右倾为正） */
  lean = 0;
  sleeping = false;
  private still = 0;
  /** 在水里熄火 */
  drowned = false;
  /** 脚下的路面（车库每帧设）：抓地倍率（铺装路 1，野地小一些）、额外的滚动阻力（草地、泥地拖车） */
  gripScale = 1;
  rollAdd = 0;
  /** 最大功率时的 扭矩 × 转速（算油耗用） */
  private readonly peakPower: number;

  constructor(readonly def: VehicleDef) {
    const p = def.phys;
    this.p = p;
    this.bike = def.kind === 'bike';
    // 摩托加一个骑手的重量
    this.mass = p.mass + (this.bike ? 80 : 0);
    this.invMass = 1 / this.mass;
    const k = this.mass / p.mass;
    this.invI = new Vector3(1 / (p.ix * k), 1 / (p.iy * k), 1 / (p.iz * k));
    this.com = new Vector3(0, p.comY, p.comZ);
    this.wheelbase = Math.abs(p.rearZ - p.frontZ);
    this.peakTorque = Math.max(...p.torqueNm);
    this.peakPower = Math.max(1, ...p.torqueNm.map((t, i) => t * (p.torqueRpm[i] as number)));
    const frontShare = (p.rearZ - p.comZ) / (p.rearZ - p.frontZ);
    const track = this.bike ? 0.2 : p.halfTrack;
    for (const front of [true, false]) {
      for (const side of [-1, 1]) {
        const axle = (front ? frontShare : 1 - frontShare) * this.mass * G;
        const w0 = axle / 2;
        this.wheels.push({
          x: side * track,
          z: front ? p.frontZ : p.rearZ,
          front,
          steer: front,
          drive: !front || !!p.allWheel,
          k: (front ? p.springFront : p.springRear) * (this.bike ? 0.5 : 1),
          c: (front ? p.dampFront : p.dampRear) * (this.bike ? 0.5 : 1),
          w0,
          comp: p.droop,
          contact: false,
          load: 0,
          y: p.radius,
          spin: 0,
          slip: 0,
          spinout: 0,
        });
      }
    }
    // 侧倾：车的悬挂侧倾刚度 K = (kf + kr)·t²，阻尼按临界阻尼的一半补（车包的减震器偏软，坑洼路会共振翻车）
    if (this.bike) {
      this.rollStiff = this.mass * G * p.comY * 14;
      this.rollDamp = 1.6 * Math.sqrt(this.rollStiff * p.iz * k);
    } else {
      this.rollStiff = 0;
      this.rollDamp = Math.sqrt((p.springFront + p.springRear) * p.halfTrack * p.halfTrack * p.iz * k);
    }
    const h = def.hull;
    const x0 = h.min[0] * 0.92;
    const x1 = h.max[0] * 0.92;
    const z0 = h.min[2] * 0.95;
    const z1 = h.max[2] * 0.95;
    const yb = Math.max(h.min[1], 0.18);
    const yt = h.max[1];
    for (const x of [x0, x1]) {
      for (const z of [z0, z1, (z0 + z1) / 2]) {
        this.hullPts.push(new Vector3(x, yb, z), new Vector3(x * 0.85, yt, z * 0.85));
      }
    }
    this.hullRoof = yb + (yt - yb) * 0.5;
  }

  /** 把车放到 (x, z)、朝向 heading（车头指向世界 (-sin h, -cos h)），轮子贴地 */
  place(x: number, z: number, heading: number, ground: Ground): void {
    // 车身贴着地面的坡度放
    const L = Math.max(1, this.wheelbase / 2);
    _n.set(ground.height(x - L, z) - ground.height(x + L, z), 2 * L, ground.height(x, z - L) - ground.height(x, z + L)).normalize();
    _qi.setFromUnitVectors(_a.set(0, 1, 0), _n);
    this.q.setFromAxisAngle(_a.set(0, 1, 0), heading).premultiply(_qi);
    const gy = ground.height(x, z);
    this.pos.set(x, gy, z).add(_p.copy(this.com).applyQuaternion(this.q));
    this.vel.set(0, 0, 0);
    this.ang.set(0, 0, 0);
    for (const w of this.wheels) w.comp = this.p.droop;
    this.sleeping = false;
    this.still = 0;
  }

  /** 模型原点（地面、两轴中间）的世界坐标 */
  origin(out: Vector3): Vector3 {
    return out.copy(this.com).applyQuaternion(this.q).negate().add(this.pos);
  }

  /** 车身坐标的点 → 世界 */
  toWorld(local: Vector3, out: Vector3): Vector3 {
    return out.copy(local).sub(this.com).applyQuaternion(this.q).add(this.pos);
  }

  pointVel(world: Vector3, out: Vector3): Vector3 {
    _b.copy(world).sub(this.pos);
    return out.copy(this.ang).cross(_b).add(this.vel);
  }

  /** 世界惯量的逆乘向量 */
  private invIw(v: Vector3, out: Vector3): Vector3 {
    _qi.copy(this.q).invert();
    _iv.copy(v).applyQuaternion(_qi);
    return out.set(_iv.x * this.invI.x, _iv.y * this.invI.y, _iv.z * this.invI.z).applyQuaternion(this.q);
  }

  applyImpulse(j: Vector3, at: Vector3): void {
    this.vel.addScaledVector(j, this.invMass);
    _m1.copy(at).sub(this.pos).cross(j);
    this.ang.add(this.invIw(_m1, _m2));
  }

  /** 沿 n 方向（单位向量）在 at 点的有效质量的倒数 */
  invMassAt(at: Vector3, n: Vector3): number {
    _m1.copy(at).sub(this.pos).cross(n);
    this.invIw(_m1, _m2).cross(_m1.copy(at).sub(this.pos));
    return this.invMass + _m2.dot(n);
  }

  wake(): void {
    this.sleeping = false;
    this.still = 0;
  }

  /** 发动机现在出多少力（0..1，相对最大功率）：油耗按它算 */
  power01(): number {
    if (!this.engineOn || this.throttle <= 0.02) return 0;
    return Math.min(1, (this.throttle * interp(this.p.torqueRpm, this.p.torqueNm, this.rpm) * this.rpm) / this.peakPower);
  }

  /** 当前速度下最大的前轮转角：低速打满，高速按抓地极限 + 一点侧偏 */
  steerLimit(v: number): number {
    const max = (this.p.maxSteer * Math.PI) / 180;
    const mu = this.p.tyreGrip ?? 1;
    const a = Math.atan((this.wheelbase * mu * G) / Math.max(1, v * v)) + ((this.p.slipPeak ?? 8) * Math.PI) / 180;
    return Math.min(max, a);
  }

  step(inp: DriveInput, ground: Ground): void {
    if (this.sleeping) return;
    const h = STEP;
    const p = this.p;
    _u.set(0, 1, 0).applyQuaternion(this.q);
    _f.set(0, 0, -1).applyQuaternion(this.q);
    _r.set(1, 0, 0).applyQuaternion(this.q);
    const vLong = this.vel.dot(_f);
    this.speed = vLong;
    _F.set(0, -G * this.mass, 0);
    _T.set(0, 0, 0);
    const force = (f: Vector3, at: Vector3) => {
      _F.add(f);
      _tq.copy(at).sub(this.pos).cross(f);
      _T.add(_tq);
    };

    // ---------------- 传动
    const driveForce = this.drivetrain(inp, vLong, h);
    let throttleBrake = 0;
    if (this.gear >= 1) throttleBrake = inp.back;
    else if (this.gear === -1) throttleBrake = inp.fwd;
    const park = !!inp.park;
    this.braking = throttleBrake > 0.05 || ((inp.handbrake || park) && Math.abs(vLong) > 0.5);

    // ---------------- 转向
    const lim = this.steerLimit(Math.abs(vLong));
    this.steerAngle = inp.steer * lim;

    // ---------------- 悬挂
    const travel = p.bump + p.droop;
    const top = p.radius + p.bump;
    let nDrive = 0;
    for (const w of this.wheels) {
      _p.set(w.x, top, w.z);
      this.toWorld(_p, _pc);
      // 轮心沿车身 -Y 往下找地面（地面按竖直高度，迭代两次）
      const uy = Math.max(0.3, _u.y);
      let g = ground.height(_pc.x, _pc.z);
      let s = (_pc.y - p.radius - g) / uy;
      g = ground.height(_pc.x - _u.x * s, _pc.z - _u.z * s);
      s = (_pc.y - p.radius - g) / uy;
      const prev = w.comp;
      if (s > travel) {
        w.contact = false;
        w.comp = 0;
        w.load = 0;
        w.y = top - travel;
        continue;
      }
      w.contact = true;
      const comp = travel - s;
      w.comp = Math.min(comp, travel);
      w.y = top - Math.max(0, s);
      const dc = (comp - prev) / h;
      let fs = w.k * (comp - p.droop) + w.w0 + w.c * dc;
      if (s < 0) fs += w.k * 6 * -s + w.c * 2 * Math.max(0, dc);
      w.load = Math.max(0, fs);
      if (w.drive) nDrive++;
    }
    // 防倾杆
    for (let i = 0; i < 4; i += 2) {
      const a = this.wheels[i] as PhysWheel;
      const b = this.wheels[i + 1] as PhysWheel;
      const k = (a.front ? p.antiRollFront : p.antiRollRear) ?? 0;
      const kk = this.bike ? 40000 : k;
      if (!kk || !(a.contact || b.contact)) continue;
      const d = kk * (a.comp - b.comp);
      if (a.contact) a.load = Math.max(0, a.load + d);
      if (b.contact) b.load = Math.max(0, b.load - d);
    }

    // ---------------- 轮胎
    const mu0 = (p.tyreGrip ?? 1) * this.gripScale;
    const rolling = p.rolling + this.rollAdd;
    const peak = ((p.slipPeak ?? 8) * Math.PI) / 180;
    const slide = p.slideGrip ?? 0.75;
    const brakeTotal = (p.brakeForce ?? this.mass * 8.5) * throttleBrake;
    const bf = p.brakeFront ?? 0.62;
    const rollK = this.bike ? 1 : 0.55;
    let skid = 0;
    for (const w of this.wheels) {
      if (!w.contact || w.load <= 0) {
        w.slip = 0;
        continue;
      }
      _p.set(w.x, w.y - p.radius, w.z);
      this.toWorld(_p, _pc);
      // 弹簧力沿车身 +Y
      force(_a.copy(_u).multiplyScalar(w.load), _pc);
      // 地面法线
      const gx = ground.height(_pc.x + 0.3, _pc.z) - ground.height(_pc.x - 0.3, _pc.z);
      const gz = ground.height(_pc.x, _pc.z + 0.3) - ground.height(_pc.x, _pc.z - 0.3);
      _n.set(-gx / 0.6, 1, -gz / 0.6).normalize();
      const d = w.steer ? this.steerAngle : 0;
      _a.set(Math.sin(d), 0, -Math.cos(d)).applyQuaternion(this.q);
      _a.addScaledVector(_n, -_a.dot(_n)).normalize();
      _l.copy(_a).cross(_n).normalize();
      this.pointVel(_pc, _v);
      const vl = _v.dot(_a);
      const vt = _v.dot(_l);
      const N = w.load;
      const share = N / G;
      if (park) {
        // 驻车：把接地点的速度连同这一步重力要加上的那一点一起抵掉（最多 μN）——静摩擦。
        // 速度那一项只抵七成：四个轮子各抵各的，全抵会抵过头（车身会转）；重力那一项全抵，坡上才不会慢慢往下溜
        const m = N / (G * Math.max(0.5, _n.y));
        let fl = -m * ((0.7 * vl) / h - G * _a.y);
        let ft = -m * ((0.7 * vt) / h - G * _l.y);
        const mag = Math.hypot(fl, ft);
        const fmax = mu0 * N;
        w.slip = 0;
        w.spinout = 0;
        if (mag > fmax) {
          fl *= fmax / mag;
          ft *= fmax / mag;
          w.slip = Math.min(0.6, Math.hypot(vl, vt) / 4);
        }
        skid = Math.max(skid, w.slip * Math.min(1, Math.hypot(vl, vt) / 6));
        force(_b.copy(_a).multiplyScalar(fl), _pc);
        _p.copy(_pc).addScaledVector(_u, p.comY * rollK);
        force(_b.copy(_l).multiplyScalar(ft), _p);
        continue;
      }
      // 前轮抓地略小于后轮（不足转向，高速不会自己打转）
      let mu = mu0 * (w.front ? Math.min(0.95, p.steerGrip ?? 1) : 1);
      const hb = inp.handbrake && !w.front;
      if (hb) mu *= 0.55;
      // 侧向：侧偏角曲线（峰值后掉到滑动抓地）
      const alpha = Math.atan2(vt, Math.max(Math.abs(vl), 2));
      const ratio = alpha / (w.front ? peak : peak * 0.8);
      const curve = Math.abs(ratio) <= 1 ? ratio : Math.sign(ratio) * Math.max(slide, 1 - (Math.abs(ratio) - 1) * 0.25);
      let fLat = -mu * N * curve;
      // 纵向：驱动 + 刹车 + 滚阻 + 手刹
      let fLong = w.drive && nDrive ? driveForce / nDrive : 0;
      const resist = (w.front ? bf : 1 - bf) * brakeTotal * 0.5 + rolling * N + (hb ? mu0 * N * 0.9 : 0);
      // 阻力不能把车往反方向推：最多刚好停住
      const stopF = (Math.abs(vl) * share) / h;
      fLong -= Math.sign(vl) * Math.min(resist, stopF);
      // 摩擦圆
      const fmax = mu * N * (hb ? 1 : 1.05);
      const mag = Math.hypot(fLong, fLat);
      w.slip = 0;
      w.spinout = 0;
      if (mag > fmax) {
        const sc = fmax / mag;
        if (w.drive && Math.abs(driveForce) > fmax * 0.8) w.spinout = Math.min(1, (mag - fmax) / fmax);
        fLong *= sc;
        fLat *= sc;
        w.slip = Math.min(1, (mag - fmax) / fmax + 0.3);
      }
      if (Math.abs(ratio) > 1.2) w.slip = Math.max(w.slip, Math.min(1, (Math.abs(ratio) - 1.2) * 0.5));
      if (hb && Math.abs(vl) > 2) w.slip = Math.max(w.slip, 0.7);
      skid = Math.max(skid, w.slip * Math.min(1, Math.hypot(vl, vt) / 6));
      force(_b.copy(_a).multiplyScalar(fLong), _pc);
      // 侧向力的作用点往质心抬（少翻车）
      _p.copy(_pc).addScaledVector(_u, p.comY * rollK);
      force(_b.copy(_l).multiplyScalar(fLat), _p);
      // 车轮转角：滚动 + 空转
      w.spin += ((vl + w.spinout * 8 * Math.sign(driveForce || 1)) / p.radius) * h;
    }
    this.skid = skid;

    // ---------------- 侧倾阻尼 / 摩托的骑手平衡（绕车头方向的力矩）
    {
      const rr = this.ang.dot(_f);
      _a.copy(_f).multiplyScalar(-this.rollDamp * rr);
      if (this.rollStiff > 0) {
        // 车身「上」转向世界「上」，只取绕车头轴的分量
        _b.copy(_u).cross(_l.set(0, 1, 0));
        _a.addScaledVector(_f, this.rollStiff * _b.dot(_f));
      }
      _T.add(_a);
    }
    // ---------------- 空气
    const sp = this.vel.length();
    if (sp > 0.1) _F.addScaledVector(this.vel, -p.drag * sp);
    if (p.downforce) {
      const df = p.downforce * vLong * vLong;
      const ff = p.downforceFront ?? 0.45;
      _p.set(0, p.comY, p.frontZ);
      force(_a.copy(_u).multiplyScalar(-df * ff), this.toWorld(_p, _pc));
      _p.set(0, p.comY, p.rearZ);
      force(_a.copy(_u).multiplyScalar(-df * (1 - ff)), this.toWorld(_p, _pc));
    }
    // ---------------- 水：阻力 + 浮力，太深熄火
    const depth = ground.water(this.pos.x, this.pos.z);
    if (depth > 0.15) {
      const k = Math.min(1, depth / 1.2);
      _F.addScaledVector(this.vel, -this.mass * 1.6 * k);
      _F.y += this.mass * G * 0.35 * k;
      if (depth > 1.0 && this.engineOn) {
        this.engineOn = false;
        this.drowned = true;
      }
    }

    // ---------------- 积分
    this.vel.addScaledVector(_F, this.invMass * h);
    this.ang.add(this.invIw(_T, _a).multiplyScalar(h));
    this.ang.multiplyScalar(1 - 0.15 * h);
    this.pos.addScaledVector(this.vel, h);
    _wq.set(this.ang.x * 0.5 * h, this.ang.y * 0.5 * h, this.ang.z * 0.5 * h, 0).multiply(this.q);
    this.q.set(this.q.x + _wq.x, this.q.y + _wq.y, this.q.z + _wq.z, this.q.w + _wq.w).normalize();

    // ---------------- 车身和地面（翻车、托底）
    this.hullGround(ground);

    // ---------------- 摩托压弯（视觉）
    if (this.bike) {
      const yawRate = this.ang.dot(_u);
      const maxLean = ((p.maxLean ?? 45) * Math.PI) / 180;
      const want = Math.max(-maxLean, Math.min(maxLean, Math.atan((vLong * -yawRate) / G)));
      const stand = !this.engineOn && Math.abs(vLong) < 0.3 ? -0.17 : 0;
      this.lean += ((Math.abs(vLong) > 1 ? want : stand) - this.lean) * Math.min(1, h * 6);
    }

    // ---------------- 睡眠：没人开、停稳了就不算了
    if (!this.engineOn && this.vel.lengthSq() < 0.0025 && this.ang.lengthSq() < 0.0025) {
      this.still += h;
      if (this.still > 1.5) {
        this.sleeping = true;
        this.vel.set(0, 0, 0);
        this.ang.set(0, 0, 0);
      }
    } else this.still = 0;
  }

  private hullGround(ground: Ground): void {
    let worst = 0;
    for (const lp of this.hullPts) {
      const fr = lp.y > this.hullRoof ? 0.6 : 0.25;
      this.toWorld(lp, _p);
      const g = ground.height(_p.x, _p.z);
      const pen = g - _p.y;
      if (pen <= 0) continue;
      worst = Math.max(worst, pen);
      this.pointVel(_p, _v);
      _n.set(0, 1, 0);
      const vn = _v.dot(_n);
      if (vn < 0) {
        const j = -vn / this.invMassAt(_p, _n);
        // 摩擦：沿地面的速度
        _a.copy(_v).addScaledVector(_n, -vn);
        const vt = _a.length();
        const jt = vt > 1e-3 ? Math.min(j * fr, vt / this.invMassAt(_p, _a.normalize())) : 0;
        _b.copy(_n).multiplyScalar(j);
        if (jt > 0) _b.addScaledVector(_a, -jt);
        this.applyImpulse(_b, _p);
      }
    }
    if (worst > 0) this.pos.y += worst * 0.6;
  }

  /** 发动机转速 / 换挡 / 驱动力（牛，沿车头方向，所有驱动轮合计） */
  private drivetrain(inp: DriveInput, vLong: number, h: number): number {
    const p = this.p;
    const n = p.gears.length;
    // 前进 / 倒车切换：停住以后按 S 挂倒挡，按 W 挂前进挡
    if (this.gear >= 1 && inp.back > 0.1 && inp.fwd < 0.1 && vLong < 0.6) this.gear = -1;
    else if (this.gear === -1 && inp.fwd > 0.1 && inp.back < 0.1 && vLong > -0.6) this.gear = 1;
    if (this.gear === 0) this.gear = 1;
    let throttle = this.gear === -1 ? inp.back : inp.fwd;
    if (!this.engineOn) throttle = 0;
    if (Math.abs(vLong) * 3.6 > p.topSpeed && Math.sign(vLong) === (this.gear === -1 ? -1 : 1)) throttle = 0;
    // 倒车最快 25 km/h
    if (this.gear === -1 && vLong < -7) throttle = 0;
    this.throttle += (throttle - this.throttle) * Math.min(1, h * 10);
    const ratio = this.gear > 0 ? (p.gears[this.gear - 1] as number) * p.finalDrive : -Math.max(p.reverseGear, p.gears[0] as number) * p.finalDrive;
    const wheelRpm = Math.abs((vLong / p.radius) * ratio) * (60 / (2 * Math.PI));
    const idle = p.idleRpm;
    const cut = p.cutRpm;
    if (!this.engineOn) {
      this.rpm = Math.max(0, this.rpm - h * 3000);
      return 0;
    }
    // 没有倒挡的（摩托）：脚蹬着慢慢往后退
    if (this.gear === -1 && p.reverseGear <= 0) {
      this.rpm += (idle - this.rpm) * Math.min(1, h * 8);
      return vLong > -1.4 ? -this.mass * 1.6 * this.throttle : 0;
    }
    // 自动挡
    this.shiftT -= h;
    if (this.gear >= 1 && this.shiftT <= 0) {
      const up = cut * (0.62 + 0.3 * this.throttle);
      const down = Math.max(idle * 1.35, cut * (0.3 + 0.18 * this.throttle));
      if (this.gear < n && wheelRpm > up) {
        this.gear++;
        this.shiftT = (p.shiftTime ?? 0.25) + 0.2;
      } else if (this.gear > 1) {
        const lower = (p.gears[this.gear - 2] as number) * p.finalDrive;
        const rpmLower = Math.abs((vLong / p.radius) * lower) * (60 / (2 * Math.PI));
        if (wheelRpm < down && rpmLower < cut * 0.85) {
          this.gear--;
          this.shiftT = (p.shiftTime ?? 0.25) + 0.2;
        }
      }
    }
    // 换挡后先断 shiftTime 秒的动力，再冷却 0.2 秒才能再换
    const shifting = this.shiftT > 0.2;
    // 离合：低速时打滑，转速被油门拉起来
    const launch = idle + (cut * (this.bike ? 0.45 : 0.4) - idle) * this.throttle;
    let target = Math.max(idle, wheelRpm);
    if (wheelRpm < launch) target = Math.max(target, launch);
    if (shifting) target = Math.max(idle, wheelRpm * 0.85);
    target = Math.min(target, cut * 1.02);
    this.rpm += (target - this.rpm) * Math.min(1, h * 14);
    let torque = 0;
    if (shifting) torque = 0;
    else if (this.throttle > 0.02 && this.rpm < cut) torque = interp(p.torqueRpm, p.torqueNm, this.rpm) * this.throttle;
    else if (wheelRpm > idle * 1.1) torque = -this.peakTorque * 0.12 * Math.min(1, (this.rpm - idle) / (cut - idle));
    return (torque * ratio * (p.efficiency ?? 0.9)) / p.radius;
  }

  /** 世界朝向（车头的水平方向角，和 place() 的 heading 一样） */
  heading(): number {
    _f.set(0, 0, -1).applyQuaternion(this.q);
    return Math.atan2(-_f.x, -_f.z);
  }
}
