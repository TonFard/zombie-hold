import { DynamicDrawUsage, Group, IcosahedronGeometry, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3, type BufferGeometry, type Material, type Mesh } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { World } from '../world/world';

/**
 * 飞着的手雷：最多同时 6 颗，一个 InstancedMesh（没有手雷在飞的时候不画）。
 * 只管飞、弹、滚、数引信；炸的时候叫 onBlast，伤害、火光、声音由武器模块接着做。
 * 模型：消耗品包里的 RGD-5（public/stims/rgd_5/world.glb，只在本机有）；没有就用程序做的一个橄榄色的蛋。
 */

const MAX = 6;
/** 碰撞用的半径（米） */
const R = 0.05;
const GRAVITY = 10.8;
/** 弹起来剩多少速度（垂直于表面的那一份）：地上、墙上（墙上弹得狠的话，平着往几米外的墙上扔会一路弹回自己脚边）；贴着表面的那一份剩多少 */
const BOUNCE = 0.42;
const BOUNCE_WALL = 0.28;
const SLIDE = 0.72;
/** 画出来比真的大一点：十几米外也看得见 */
const LOOK = 1.3;

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3(LOOK, LOOK, LOOK);
const _axis = new Vector3();
const _n = new Vector3();
const _u = new Vector3();
const _w = new Vector3();

export class Grenades {
  readonly group = new Group();
  /** 引信到了。byPlayer = 是不是玩家扔的 */
  onBlast: ((x: number, y: number, z: number, byPlayer: boolean) => void) | null = null;
  /** 磕在地上 / 墙上了（speed = 撞上去时的速度） */
  onBounce: ((x: number, y: number, z: number, speed: number) => void) | null = null;
  /** 飞的时候身后留一点烟 */
  onTrail: ((x: number, y: number, z: number) => void) | null = null;

  private readonly mesh: InstancedMesh;
  private readonly alive = new Uint8Array(MAX);
  private readonly mine = new Uint8Array(MAX);
  private readonly rest = new Uint8Array(MAX);
  private readonly px = new Float32Array(MAX);
  private readonly py = new Float32Array(MAX);
  private readonly pz = new Float32Array(MAX);
  private readonly vx = new Float32Array(MAX);
  private readonly vy = new Float32Array(MAX);
  private readonly vz = new Float32Array(MAX);
  private readonly fuse = new Float32Array(MAX);
  private readonly spin = new Float32Array(MAX);
  private readonly ang = new Float32Array(MAX);
  private readonly trail = new Float32Array(MAX);
  /** 连着几步都卡在东西里（出不来就当它停住了） */
  private readonly stuck = new Uint8Array(MAX);
  private n = 0;
  /** 开局头几帧在地底下画一颗：网格、贴图、着色器在真正的场景里用过一次，第一次扔不卡 */
  private warm = 4;

  constructor(private readonly world: World) {
    // 先用程序做的：一个拉长的二十面体。包里的模型加载好以后换上去（见 load）
    const geo = new IcosahedronGeometry(0.036, 2);
    geo.scale(1, 1.35, 1);
    const mat = new MeshStandardMaterial({ color: 0x4a5638, roughness: 0.55, metalness: 0.35 });
    this.mesh = new InstancedMesh(geo, mat, MAX);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.name = 'grenades';
    this.mesh.count = 1;
    this.mesh.setMatrixAt(0, _m.makeTranslation(0, -2000, 0));
    this.group.add(this.mesh);
    this.group.name = 'arsenal-grenades';
  }

  /** 换成消耗品包里的模型（url = null / 加载失败就保持程序做的）。要在预编译着色器之前调完 */
  async load(url: string | null): Promise<void> {
    if (!url) return;
    try {
      const gltf = await new GLTFLoader().loadAsync(url);
      let src: Mesh | null = null;
      gltf.scene.traverse((o) => {
        if (!src && (o as Mesh).isMesh) src = o as Mesh;
      });
      const found = src as Mesh | null;
      if (!found) return;
      const geo: BufferGeometry = found.geometry;
      // 地上的模型原点在底面中心：挪到中间，飞的时候绕着中心转
      geo.computeBoundingBox();
      const b = geo.boundingBox;
      if (b) geo.translate(-(b.min.x + b.max.x) / 2, -(b.min.y + b.max.y) / 2, -(b.min.z + b.max.z) / 2);
      const old = this.mesh.geometry;
      const oldMat = this.mesh.material as Material;
      this.mesh.geometry = geo;
      this.mesh.material = found.material as Material;
      old.dispose();
      oldMat.dispose();
      this.warm = 4;
    } catch (e) {
      console.warn('手雷的模型加载失败，用程序做的', e);
    }
  }

  /** 现在画着几颗 */
  get count(): number {
    return this.n;
  }

  /** 六颗都在飞：再扔也扔不出去 */
  get full(): boolean {
    for (let i = 0; i < MAX; i++) if (!this.alive[i]) return false;
    return true;
  }

  /** 扔一颗：从 (x, y, z) 以 (vx, vy, vz) 米/秒出去，fuse 秒后炸。满了（6 颗都在飞）返回 false */
  launch(x: number, y: number, z: number, vx: number, vy: number, vz: number, fuse: number, byPlayer: boolean): boolean {
    let i = 0;
    while (i < MAX && this.alive[i]) i++;
    if (i >= MAX) return false;
    this.alive[i] = 1;
    this.mine[i] = byPlayer ? 1 : 0;
    this.rest[i] = 0;
    this.stuck[i] = 0;
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.fuse[i] = Math.max(0.05, fuse);
    this.spin[i] = 9 + Math.random() * 6;
    this.ang[i] = Math.random() * 6.28;
    this.trail[i] = 0;
    return true;
  }

  /** 全部清掉（不炸） */
  clear(): void {
    this.alive.fill(0);
  }

  /**
   * 射线打到的那个面朝哪边：旁边再打两条平行的射线，三个落点定一个平面。
   * 打在棱上 / 旁边那条没打到就当它正对着来的方向（原路弹回去）
   */
  private normalAt(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, t: number): void {
    const w = this.world;
    // 两个和方向垂直的偏移
    if (Math.abs(dy) < 0.9) _u.set(0, 1, 0);
    else _u.set(1, 0, 0);
    _w.set(dx, dy, dz);
    _u.cross(_w).normalize();
    _w.cross(_u).normalize();
    const e = 0.04;
    const t1 = w.raycast(ox + _u.x * e, oy + _u.y * e, oz + _u.z * e, dx, dy, dz, t + 0.3, false);
    const t2 = w.raycast(ox + _w.x * e, oy + _w.y * e, oz + _w.z * e, dx, dy, dz, t + 0.3, false);
    if (t1 === Infinity || t2 === Infinity || Math.abs(t1 - t) > 0.25 || Math.abs(t2 - t) > 0.25) {
      _n.set(-dx, -dy, -dz);
      return;
    }
    // (P1 − P0) × (P2 − P0)
    const ax = _u.x * e + dx * (t1 - t);
    const ay = _u.y * e + dy * (t1 - t);
    const az = _u.z * e + dz * (t1 - t);
    const bx = _w.x * e + dx * (t2 - t);
    const by = _w.y * e + dy * (t2 - t);
    const bz = _w.z * e + dz * (t2 - t);
    _n.set(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
    if (_n.lengthSq() < 1e-12) {
      _n.set(-dx, -dy, -dz);
      return;
    }
    _n.normalize();
    if (_n.x * dx + _n.y * dy + _n.z * dz > 0) _n.negate();
  }

  /** 撞在法线是 _n 的面上：弹起来。返回撞上去时垂直于表面的速度 */
  private bounce(i: number): number {
    const vn = (this.vx[i] as number) * _n.x + (this.vy[i] as number) * _n.y + (this.vz[i] as number) * _n.z;
    if (vn >= 0) return 0;
    // 垂直的那一份反过来、打折；贴着表面的那一份也蹭掉一些
    const tx = (this.vx[i] as number) - vn * _n.x;
    const ty = (this.vy[i] as number) - vn * _n.y;
    const tz = (this.vz[i] as number) - vn * _n.z;
    const b = _n.y > 0.7 ? BOUNCE : BOUNCE_WALL;
    this.vx[i] = tx * SLIDE - vn * b * _n.x;
    this.vy[i] = ty * SLIDE - vn * b * _n.y;
    this.vz[i] = tz * SLIDE - vn * b * _n.z;
    this.spin[i] = (this.spin[i] as number) * 0.6;
    return -vn;
  }

  update(dt: number): void {
    const w = this.world;
    let n = 0;
    for (let i = 0; i < MAX; i++) {
      if (!this.alive[i]) continue;
      this.fuse[i] = (this.fuse[i] as number) - dt;
      if ((this.fuse[i] as number) <= 0) {
        this.alive[i] = 0;
        this.onBlast?.(this.px[i] as number, this.py[i] as number, this.pz[i] as number, this.mine[i] === 1);
        continue;
      }
      if (!this.rest[i]) {
        // 一步最多走半米：不会穿过薄墙
        const sp0 = Math.hypot(this.vx[i] as number, this.vy[i] as number, this.vz[i] as number);
        const steps = Math.min(5, Math.max(1, Math.ceil((sp0 * dt) / 0.5)));
        const h = dt / steps;
        for (let s = 0; s < steps && !this.rest[i]; s++) {
          this.vy[i] = (this.vy[i] as number) - GRAVITY * h;
          const mx = (this.vx[i] as number) * h;
          const my = (this.vy[i] as number) * h;
          const mz = (this.vz[i] as number) * h;
          const len = Math.hypot(mx, my, mz);
          let hit = 0;
          let floor = false;
          if (len > 1e-6) {
            const dx = mx / len;
            const dy = my / len;
            const dz = mz / len;
            const x = this.px[i] as number;
            const y = this.py[i] as number;
            const z = this.pz[i] as number;
            const t = w.raycast(x, y, z, dx, dy, dz, len + R, false);
            if (t === Infinity) {
              this.px[i] = x + mx;
              this.py[i] = y + my;
              this.pz[i] = z + mz;
              this.stuck[i] = 0;
            } else {
              // 墙、地板、家具、车、树：停在表面前面，弹开
              this.normalAt(x, y, z, dx, dy, dz, t);
              const back = Math.max(0, t - R);
              this.px[i] = x + dx * back;
              this.py[i] = y + dy * back;
              this.pz[i] = z + dz * back;
              hit = this.bounce(i);
              floor = _n.y > 0.7;
              this.stuck[i] = t < 0.002 ? (this.stuck[i] as number) + 1 : 0;
            }
          }
          // 地面
          const gx = this.px[i] as number;
          const gz = this.pz[i] as number;
          const gy = w.groundAt(gx, gz) + R;
          if ((this.py[i] as number) < gy) {
            this.py[i] = gy;
            const e = 0.3;
            _n.set(w.groundAt(gx - e, gz) - w.groundAt(gx + e, gz), 2 * e, w.groundAt(gx, gz - e) - w.groundAt(gx, gz + e)).normalize();
            hit = Math.max(hit, this.bounce(i));
            floor = true;
          }
          if (hit > 1.2) this.onBounce?.(this.px[i] as number, this.py[i] as number, this.pz[i] as number, hit);
          // 在地上滚不动了 / 卡在东西里：停住
          const sp = Math.hypot(this.vx[i] as number, this.vy[i] as number, this.vz[i] as number);
          if ((floor && sp < 0.7) || (this.stuck[i] as number) >= 3) {
            this.rest[i] = 1;
            this.vx[i] = this.vy[i] = this.vz[i] = 0;
          } else if (floor) {
            // 贴着地滚：越滚越慢
            const k = Math.exp(-2.2 * h);
            this.vx[i] = (this.vx[i] as number) * k;
            this.vz[i] = (this.vz[i] as number) * k;
          }
        }
        this.ang[i] = (this.ang[i] as number) + (this.spin[i] as number) * dt;
        this.trail[i] = (this.trail[i] as number) - dt;
        if ((this.trail[i] as number) <= 0 && !this.rest[i]) {
          this.trail[i] = 0.06;
          this.onTrail?.(this.px[i] as number, this.py[i] as number, this.pz[i] as number);
        }
      }
      // 翻着跟头飞：转轴跟着飞的方向（水平方向的垂线）
      _axis.set(this.vz[i] as number, 0.3, -(this.vx[i] as number));
      if (_axis.lengthSq() < 1e-6) _axis.set(1, 0, 0);
      _q.setFromAxisAngle(_axis.normalize(), this.ang[i] as number);
      this.mesh.setMatrixAt(n++, _m.compose(_p.set(this.px[i] as number, this.py[i] as number, this.pz[i] as number), _q, _s));
    }
    this.n = n;
    if (n > 0) {
      this.mesh.count = n;
      this.mesh.visible = true;
      this.mesh.instanceMatrix.needsUpdate = true;
      this.warm = 0;
    } else if (this.warm > 0) {
      this.warm--;
      this.mesh.count = 1;
      this.mesh.setMatrixAt(0, _m.makeTranslation(0, -2000, 0));
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.visible = true;
    } else this.mesh.visible = false;
  }
}
