import { BoxGeometry, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, Vector3 } from 'three';

export interface ParticleOpts {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  life: number;
  /** 颜色分量可以大于 1：配合 Bloom 就是发光 */
  r: number;
  g: number;
  b: number;
  gravity?: number;
  drag?: number;
  /** 随寿命缩小（默认 true） */
  shrink?: boolean;
  /** 落地反弹系数，0 = 落地即停 */
  bounce?: number;
}

/** 一个 InstancedMesh 画所有小方块粒子：血、火花、酸液、火焰、弹壳 */
export class Particles {
  readonly mesh: InstancedMesh;
  private n = 0;
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly size: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly cr: Float32Array;
  private readonly cg: Float32Array;
  private readonly cb: Float32Array;
  private readonly grav: Float32Array;
  private readonly drag: Float32Array;
  private readonly shrink: Uint8Array;
  private readonly bounce: Float32Array;
  private readonly _m = new Matrix4();
  private readonly _q = new Quaternion();
  private readonly _p = new Vector3();
  private readonly _s = new Vector3();

  constructor(readonly max = 1200) {
    this.mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ toneMapped: false }), max);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.instanceColor.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    const f = () => new Float32Array(max);
    this.px = f();
    this.py = f();
    this.pz = f();
    this.vx = f();
    this.vy = f();
    this.vz = f();
    this.size = f();
    this.life = f();
    this.maxLife = f();
    this.cr = f();
    this.cg = f();
    this.cb = f();
    this.grav = f();
    this.drag = f();
    this.bounce = f();
    this.shrink = new Uint8Array(max);
  }

  get count(): number {
    return this.n;
  }

  spawn(o: ParticleOpts): void {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.px[i] = o.x;
    this.py[i] = o.y;
    this.pz[i] = o.z;
    this.vx[i] = o.vx;
    this.vy[i] = o.vy;
    this.vz[i] = o.vz;
    this.size[i] = o.size;
    this.life[i] = this.maxLife[i] = o.life;
    this.cr[i] = o.r;
    this.cg[i] = o.g;
    this.cb[i] = o.b;
    this.grav[i] = o.gravity ?? 14;
    this.drag[i] = o.drag ?? 1.2;
    this.shrink[i] = o.shrink === false ? 0 : 1;
    this.bounce[i] = o.bounce ?? 0;
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.n) {
      this.life[i] = (this.life[i] as number) - dt;
      if ((this.life[i] as number) <= 0) {
        this.removeAt(i);
        continue;
      }
      const d = Math.exp(-(this.drag[i] as number) * dt);
      this.vy[i] = ((this.vy[i] as number) - (this.grav[i] as number) * dt) * d;
      this.vx[i] = (this.vx[i] as number) * d;
      this.vz[i] = (this.vz[i] as number) * d;
      this.px[i] = (this.px[i] as number) + (this.vx[i] as number) * dt;
      this.py[i] = (this.py[i] as number) + (this.vy[i] as number) * dt;
      this.pz[i] = (this.pz[i] as number) + (this.vz[i] as number) * dt;
      if ((this.py[i] as number) < 0.03) {
        this.py[i] = 0.03;
        const b = this.bounce[i] as number;
        if (b > 0 && Math.abs(this.vy[i] as number) > 0.6) {
          this.vy[i] = -(this.vy[i] as number) * b;
          this.vx[i] = (this.vx[i] as number) * 0.6;
          this.vz[i] = (this.vz[i] as number) * 0.6;
        } else {
          this.vy[i] = 0;
          this.vx[i] = (this.vx[i] as number) * 0.5;
          this.vz[i] = (this.vz[i] as number) * 0.5;
        }
      }
      const k = (this.life[i] as number) / (this.maxLife[i] as number);
      const s = (this.size[i] as number) * (this.shrink[i] ? 0.25 + 0.75 * k : 1);
      this._p.set(this.px[i] as number, this.py[i] as number, this.pz[i] as number);
      this._s.set(s, s, s);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
      const ci = i * 3;
      const arr = (this.mesh.instanceColor as InstancedBufferAttribute).array as Float32Array;
      arr[ci] = this.cr[i] as number;
      arr[ci + 1] = this.cg[i] as number;
      arr[ci + 2] = this.cb[i] as number;
      i++;
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    (this.mesh.instanceColor as InstancedBufferAttribute).needsUpdate = true;
  }

  private removeAt(i: number): void {
    const l = --this.n;
    if (i === l) return;
    for (const a of [this.px, this.py, this.pz, this.vx, this.vy, this.vz, this.size, this.life, this.maxLife, this.cr, this.cg, this.cb, this.grav, this.drag, this.bounce, this.shrink] as Array<Float32Array | Uint8Array>) {
      a[i] = a[l] as number;
    }
  }
}
