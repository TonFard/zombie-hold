import type { World } from './world/world';

/**
 * 第一人称移动：地形高度 + 碰撞体（墙、车、树、石头……）+ 湖水。地图没有边界。
 * 能迈上 0.45 米以内的台阶（地板、路肩），更高的挡住；太陡的坡（> 50°）往上走不动；深水走不进去。
 */

export interface MoveInput {
  fwd: number;
  side: number;
  sprint: boolean;
  jump: boolean;
  crouch: boolean;
}

const RADIUS = 0.34;
const HEIGHT = 1.75;
const STEP = 0.45;
const WALK = 4.3;
const RUN = 7.0;
const CROUCH = 2.1;
const GRAVITY = 22;
const JUMP_V = 6.4;
const EYE = 1.62;
const EYE_CROUCH = 1.08;
/** 水深超过这个就走不进去（米） */
const DEEP = 1.15;

export class Player {
  x: number;
  z: number;
  feet: number;
  vx = 0;
  vz = 0;
  vy = 0;
  yaw: number;
  pitch = 0;
  onGround = true;
  crouch = 0;
  sprinting = false;
  /** 走路晃动的相位 */
  bob = 0;
  /** 涉水深度（米，0 = 岸上） */
  wade = 0;
  /** 速度倍率（饿、渴、冷、背得太重的时候走不快） */
  speedMul = 1;

  constructor(
    private readonly w: World,
    spawn: { x: number; z: number; yaw: number },
  ) {
    this.x = spawn.x;
    this.z = spawn.z;
    this.yaw = spawn.yaw;
    this.feet = this.ground(this.x, this.z, Infinity);
  }

  get eye(): number {
    return EYE + (EYE_CROUCH - EYE) * this.crouch;
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  /** 脚下的高度：地形和能站的碰撞体顶面（地板）里高的那个 */
  ground(x: number, z: number, feet: number): number {
    const t = this.w.groundAt(x, z);
    const top = this.w.topAt(x, z, RADIUS, feet === Infinity ? 1e4 : feet, STEP);
    return Math.max(t, top);
  }

  private depth(x: number, z: number): number {
    return this.w.waterDepth(x, z);
  }

  teleport(x: number, z: number): void {
    this.x = x;
    this.z = z;
    this.feet = this.ground(x, z, this.w.groundAt(x, z));
    this.vx = this.vz = this.vy = 0;
  }

  update(dt: number, inp: MoveInput): void {
    dt = Math.min(dt, 0.05);
    // 蹲下 / 站起
    this.crouch += ((inp.crouch ? 1 : 0) - this.crouch) * Math.min(1, dt * 10);
    // 想要的水平速度（相机前方 = (sin yaw, cos yaw)，右方 = (-cos yaw, sin yaw)）
    let f = inp.fwd;
    let s = inp.side;
    const L = Math.hypot(f, s);
    if (L > 1) {
      f /= L;
      s /= L;
    }
    this.sprinting = inp.sprint && f > 0.3 && this.crouch < 0.5 && this.wade < 0.5;
    let speed = this.crouch > 0.5 ? CROUCH : this.sprinting ? RUN : WALK;
    if (this.wade > 0) speed *= Math.max(0.45, 1 - this.wade * 0.5);
    speed *= this.speedMul;
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    const wx = (f * sy - s * cy) * speed;
    const wz = (f * cy + s * sy) * speed;
    // 地上加速快、空中只能微调
    const k = this.onGround ? 1 - Math.exp(-dt * 12) : 1 - Math.exp(-dt * 1.5);
    this.vx += (wx - this.vx) * k;
    this.vz += (wz - this.vz) * k;

    const ox = this.x;
    const oz = this.z;
    let nx = ox + this.vx * dt;
    let nz = oz + this.vz * dt;
    // 陡坡：往上走时坡度超过 1.2（约 50°）就走不动
    const g0 = this.w.groundAt(ox, oz);
    const g1 = this.w.groundAt(nx, nz);
    const run = Math.hypot(nx - ox, nz - oz);
    if (run > 1e-4 && (g1 - g0) / run > 1.2 && this.onGround) {
      nx = ox;
      nz = oz;
      this.vx *= 0.3;
      this.vz *= 0.3;
    }
    // 碰撞体
    const p = { x: nx, z: nz };
    this.w.collide(p, this.feet, HEIGHT - this.crouch * 0.6, RADIUS, STEP);
    // 深水：退回去（沿岸滑：分别试只动 x、只动 z）
    if (this.depth(p.x, p.z) > DEEP) {
      if (this.depth(p.x, oz) <= DEEP) p.z = oz;
      else if (this.depth(ox, p.z) <= DEEP) p.x = ox;
      else {
        p.x = ox;
        p.z = oz;
      }
    }
    this.x = p.x;
    this.z = p.z;
    this.wade = this.depth(this.x, this.z);

    // 竖直：重力 + 跳 + 贴地
    const gnd = this.ground(this.x, this.z, this.feet);
    if (this.onGround && inp.jump && this.crouch < 0.5 && this.wade < 0.6) {
      this.vy = JUMP_V;
      this.onGround = false;
    }
    if (this.onGround) {
      // 下坡 / 下台阶：落差不大就直接贴地（不会一走下坡就"飞"起来）
      if (this.feet - gnd < 0.6) {
        this.feet = gnd;
        this.vy = 0;
      } else this.onGround = false;
    }
    if (!this.onGround) {
      this.vy -= GRAVITY * dt;
      this.feet += this.vy * dt;
      if (this.feet <= gnd) {
        this.feet = gnd;
        this.vy = 0;
        this.onGround = true;
      }
    }
    // 走路晃动
    const sp = this.speed;
    if (this.onGround && sp > 0.3) this.bob += dt * sp * (this.sprinting ? 1.45 : 1.75);
  }
}
