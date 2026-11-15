import { BufferGeometry, Color, Float32BufferAttribute, Matrix4, Uint16BufferAttribute, Vector3 } from 'three';

/**
 * 放样工具：一圈圈截面连成连续的曲面，每个顶点带颜色和最多 4 根骨头的权重。
 * 角色的身体用它做成整张蒙皮网格（关节两侧的顶点同时跟两根骨头走，弯起来是圆的），不再用「圆柱 + 球遮缝」。
 */

export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** a → b 之间从 0 平滑升到 1（a > b 时反过来） */
export const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** 中心 c、半宽 w 的钟形（1 → 0） */
export const bell = (x: number, c: number, w: number): number => {
  const d = (x - c) / w;
  return Math.exp(-d * d);
};

/**
 * 表格插值（平滑的三次曲线）：rows 按第 0 列升序，返回第 col 列在 x 处的值。
 * 截面表只写关键位置（腰、胸、肩……），中间的截面靠它补出来，轮廓是圆顺的
 */
export function table(rows: ReadonlyArray<ReadonlyArray<number>>, col: number, x: number): number {
  const n = rows.length;
  const g = (i: number, c: number): number => (rows[Math.min(n - 1, Math.max(0, i))] as ReadonlyArray<number>)[c] as number;
  if (x <= g(0, 0)) return g(0, col);
  if (x >= g(n - 1, 0)) return g(n - 1, col);
  let i = 0;
  while (i < n - 2 && x > g(i + 1, 0)) i++;
  const x1 = g(i, 0);
  const x2 = g(i + 1, 0);
  const h = x2 - x1 || 1;
  const t = (x - x1) / h;
  const p1 = g(i, col);
  const p2 = g(i + 1, col);
  const m1 = i > 0 ? (p2 - g(i - 1, col)) / (x2 - g(i - 1, 0)) : (p2 - p1) / h;
  const m2 = i < n - 2 ? (g(i + 2, col) - p1) / (g(i + 2, 0) - x1) : (p2 - p1) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * p1 + (t3 - 2 * t2 + t) * h * m1 + (-2 * t3 + 3 * t2) * p2 + (t3 - t2) * h * m2;
}

function hash(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/** 平滑的三维噪声，0–1 */
export function noise(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const l = (a: number, b: number, t: number): number => a + (b - a) * t;
  return l(
    l(l(hash(xi, yi, zi), hash(xi + 1, yi, zi), u), l(hash(xi, yi + 1, zi), hash(xi + 1, yi + 1, zi), u), v),
    l(l(hash(xi, yi, zi + 1), hash(xi + 1, yi, zi + 1), u), l(hash(xi, yi + 1, zi + 1), hash(xi + 1, yi + 1, zi + 1), u), v),
    w,
  );
}

/** 两层叠加的噪声，-1–1 */
export const fbm = (x: number, y: number, z: number): number => noise(x, y, z) * 1.3 + noise(x * 2.3 + 5.1, y * 2.3 + 1.7, z * 2.3 + 9.2) * 0.7 - 1;

/** 超椭圆上的一点：角度 t 处的 [cos, sin]，n = 2 是椭圆，越大越方 */
export function superCos(t: number, n: number): number {
  const c = Math.cos(t);
  return Math.sign(c) * Math.abs(c) ** (2 / n);
}
export function superSin(t: number, n: number): number {
  const s = Math.sin(t);
  return Math.sign(s) * Math.abs(s) ** (2 / n);
}

/** 放样时写一个顶点用的草稿：位置、颜色、骨头权重 */
export class Vert {
  readonly p = new Vector3();
  readonly c = new Color();
  readonly b: [number, number, number, number] = [0, 0, 0, 0];
  readonly w: [number, number, number, number] = [1, 0, 0, 0];

  /** 整个绑在一根骨头上 */
  bone(i: number): this {
    this.b[0] = i;
    this.b[1] = this.b[2] = this.b[3] = 0;
    this.w[0] = 1;
    this.w[1] = this.w[2] = this.w[3] = 0;
    return this;
  }

  /** 两根骨头之间过渡：t = 0 全跟甲，1 全跟乙 */
  blend(a: number, b: number, t: number): this {
    const k = clamp01(t);
    this.b[0] = a;
    this.b[1] = b;
    this.b[2] = this.b[3] = 0;
    this.w[0] = 1 - k;
    this.w[1] = k;
    this.w[2] = this.w[3] = 0;
    return this;
  }
}

export interface TubeOpts {
  /** 在第一圈 / 最后一圈处封口（加一个圆心顶点，和这一圈共用顶点，所以封口是圆润的） */
  capA?: boolean;
  capB?: boolean;
}

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _n = new Vector3();

export class Loft {
  private readonly pos: number[] = [];
  private readonly col: number[] = [];
  private readonly si: number[] = [];
  private readonly sw: number[] = [];
  private readonly idx: number[] = [];
  private readonly v = new Vert();
  /** 之后放的顶点都先乘这个矩阵（手、脚这类在自己坐标里建好再摆到位的部件） */
  xf: Matrix4 | null = null;

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  get triangleCount(): number {
    return this.idx.length / 3;
  }

  private emit(v: Vert): number {
    const i = this.pos.length / 3;
    if (this.xf) v.p.applyMatrix4(this.xf);
    this.pos.push(v.p.x, v.p.y, v.p.z);
    this.col.push(v.c.r, v.c.g, v.c.b);
    this.si.push(v.b[0], v.b[1], v.b[2], v.b[3]);
    this.sw.push(v.w[0], v.w[1], v.w[2], v.w[3]);
    return i;
  }

  private pt(i: number, out: Vector3): Vector3 {
    return out.set(this.pos[i * 3] as number, this.pos[i * 3 + 1] as number, this.pos[i * 3 + 2] as number);
  }

  /**
   * n 圈截面、每圈 segs 个顶点的封闭管子。at(i, k, v) 把第 i 圈第 k 个顶点写进 v。
   * 同一圈连着写两遍（位置一样）= 这里是一道硬棱（下摆、袖口的台阶）。
   * 朝向自动判断（面朝离截面中心远的那边），不用管截面是顺着绕还是逆着绕
   */
  tube(n: number, segs: number, at: (i: number, k: number, v: Vert) => void, o: TubeOpts = {}): void {
    const base = this.pos.length / 3;
    const v = this.v;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < segs; k++) {
        v.bone(0);
        at(i, k, v);
        this.emit(v);
      }
    }
    // 朝向：每一圈取圆心，看几个面的法线朝里还是朝外
    let outward = 0;
    for (let i = 0; i < n - 1; i++) {
      const cen = _c.set(0, 0, 0);
      for (let k = 0; k < segs; k++) cen.add(this.pt(base + i * segs + k, _a));
      cen.multiplyScalar(1 / segs);
      for (let k = 0; k < segs; k += Math.max(1, Math.floor(segs / 6))) {
        const p0 = this.pt(base + i * segs + k, _a).clone();
        const p1 = this.pt(base + i * segs + ((k + 1) % segs), _b);
        const p2 = this.pt(base + (i + 1) * segs + ((k + 1) % segs), _n);
        const nn = p1.sub(p0).cross(p2.sub(p0));
        outward += Math.sign(nn.dot(p0.sub(cen)));
      }
    }
    const flip = outward < 0;
    const tri = (a: number, b: number, c: number): void => {
      if (flip) this.idx.push(a, c, b);
      else this.idx.push(a, b, c);
    };
    for (let i = 0; i < n - 1; i++) {
      for (let k = 0; k < segs; k++) {
        const a = base + i * segs + k;
        const a1 = base + i * segs + ((k + 1) % segs);
        const d = a + segs;
        const d1 = a1 + segs;
        tri(a, a1, d1);
        tri(a, d1, d);
      }
    }
    for (const end of [0, 1] as const) {
      if (!(end === 0 ? o.capA : o.capB)) continue;
      const ring = base + (end === 0 ? 0 : n - 1) * segs;
      // 圆心顶点：位置、颜色取这一圈的平均，权重照抄第 0 个顶点
      const cen = _c.set(0, 0, 0);
      let r = 0;
      let g = 0;
      let bl = 0;
      for (let k = 0; k < segs; k++) {
        cen.add(this.pt(ring + k, _a));
        r += this.col[(ring + k) * 3] as number;
        g += this.col[(ring + k) * 3 + 1] as number;
        bl += this.col[(ring + k) * 3 + 2] as number;
      }
      cen.multiplyScalar(1 / segs);
      // 封口往外鼓一点：按这一圈相对上一圈的走向推出去半径的三成
      if (n > 1) {
        const prev = base + (end === 0 ? 1 : n - 2) * segs;
        const pc = _b.set(0, 0, 0);
        for (let k = 0; k < segs; k++) pc.add(this.pt(prev + k, _a));
        pc.multiplyScalar(1 / segs);
        const dir = _n.copy(cen).sub(pc);
        const rad = this.pt(ring, _a).distanceTo(cen);
        if (dir.lengthSq() > 1e-12) cen.addScaledVector(dir.normalize(), rad * 0.3);
      }
      const ci = this.pos.length / 3;
      this.pos.push(cen.x, cen.y, cen.z);
      this.col.push(r / segs, g / segs, bl / segs);
      for (let j = 0; j < 4; j++) {
        this.si.push(this.si[ring * 4 + j] as number);
        this.sw.push(this.sw[ring * 4 + j] as number);
      }
      for (let k = 0; k < segs; k++) {
        const a = ring + k;
        const a1 = ring + ((k + 1) % segs);
        if (end === 0) tri(ci, a1, a);
        else tri(ci, a, a1);
      }
    }
  }

  /**
   * 沿折线走的圆管（手指、发绺、筋）：pts 是中轴上的点，rad(i) 是那里的半径（可以给 [宽, 厚] 做成扁的），
   * up 是「宽」那个方向的参考。paint(i, k, v) 只管颜色和权重
   */
  pipe(pts: ReadonlyArray<Vector3>, rad: (i: number) => number | readonly [number, number], segs: number, up: Vector3, paint: (i: number, k: number, v: Vert) => void, o: TubeOpts = { capA: true, capB: true }): void {
    const n = pts.length;
    const dirs: Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)] as Vector3;
      const b = pts[Math.min(n - 1, i + 1)] as Vector3;
      dirs.push(new Vector3().subVectors(b, a).normalize());
    }
    const X = new Vector3();
    const Y = new Vector3();
    this.tube(
      n,
      segs,
      (i, k, v) => {
        const d = dirs[i] as Vector3;
        X.copy(up).addScaledVector(d, -up.dot(d));
        if (X.lengthSq() < 1e-10) X.set(1, 0, 0).addScaledVector(d, -d.x);
        X.normalize();
        Y.crossVectors(d, X);
        const r = rad(i);
        const rx = typeof r === 'number' ? r : r[0];
        const ry = typeof r === 'number' ? r : r[1];
        const t = (k / segs) * Math.PI * 2;
        v.p.copy(pts[i] as Vector3).addScaledVector(X, Math.cos(t) * rx).addScaledVector(Y, Math.sin(t) * ry);
        paint(i, k, v);
      },
      o,
    );
  }

  /** 椭球：中心 c，三个半轴（带方向和长度）。paint 只管颜色和权重 */
  blob(c: Vector3, ax: Vector3, ay: Vector3, az: Vector3, paint: (v: Vert) => void, lat = 6, segs = 8): void {
    this.tube(
      lat + 1,
      segs,
      (i, k, v) => {
        const phi = (i / lat) * Math.PI;
        const rr = Math.max(0.03, Math.sin(phi));
        const t = (k / segs) * Math.PI * 2;
        v.p.copy(c).addScaledVector(az, -Math.cos(phi)).addScaledVector(ax, Math.cos(t) * rr).addScaledVector(ay, Math.sin(t) * rr);
        paint(v);
      },
      {},
    );
  }

  /** 生成带法线、顶点色、蒙皮权重的索引几何体 */
  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}
