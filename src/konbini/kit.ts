import {
  Box3,
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
  type Material,
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * 雨夜街角专用的拼模型工具（和主游戏的 kit 无关）。
 * - 约定：box / cyl 的原点在底面中心，sphere 在球心，plane 在中心、朝 +Z。
 * - 所有部件按材质合并成少数几个网格；可选 solid 把部件的包围盒登记成碰撞体。
 * - 贴图统一走一张图集（Atlas），没贴图的面指向图集里的纯白像素，所以同一材质里可以混用。
 */

export type MatKey = 'toon' | 'tex' | 'glow' | 'glowTex';
export interface Tile {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}
export interface At {
  x?: number;
  y?: number;
  z?: number;
  rx?: number;
  ry?: number;
  rz?: number;
}
export type Face = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';
const FACES: Face[] = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

export interface PartOpts {
  /** 图集贴图 */
  tex?: Tile;
  /** 哪些面贴图（盒子默认只贴 +Z 面） */
  faces?: Face[];
  /** 贴图面的顶点色（默认白色，贴图原色） */
  texColor?: number;
  /** 自发光强度：>0 时用发光材质，颜色乘以这个系数（配合 Bloom） */
  glow?: number;
  /** 登记成碰撞体 */
  solid?: boolean;
}

/** 碰撞体：轴对齐包围盒，on=false 时暂时失效（例如门打开了） */
export interface Solid {
  minx: number;
  miny: number;
  minz: number;
  maxx: number;
  maxy: number;
  maxz: number;
  on: boolean;
}

export class Solids {
  readonly list: Solid[] = [];
  add(minx: number, miny: number, minz: number, maxx: number, maxy: number, maxz: number): Solid {
    const s = { minx, miny, minz, maxx, maxy, maxz, on: true };
    this.list.push(s);
    return s;
  }
  fromBox(b: Box3): Solid {
    return this.add(b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z);
  }
}

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _one = new Vector3(1, 1, 1);
const _c = new Color();
const _box = new Box3();

function local(at: At): Matrix4 {
  _e.set(at.rx ?? 0, at.ry ?? 0, at.rz ?? 0, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(at.x ?? 0, at.y ?? 0, at.z ?? 0);
  return new Matrix4().compose(_p, _q, _one);
}

/** 一段被标记的部件（之后可以单独隐藏 / 显示，比如货架上被拿走的商品） */
export interface Mark {
  ranges: Array<{ key: MatKey; start: number; end: number }>;
  hidden: boolean;
  /** 这一段部件的世界包围盒（拾取用） */
  box: Box3;
  /** Blender replacement visual, attached after the product GLB finishes loading. */
  replacement?: Object3D;
}

export class Kit {
  private parts: Record<MatKey, BufferGeometry[]> = { toon: [], tex: [], glow: [], glowTex: [] };
  private counts: Record<MatKey, number> = { toon: 0, tex: 0, glow: 0, glowTex: 0 };
  private stack: Matrix4[] = [new Matrix4()];
  private open: Mark | null = null;
  private openStart: Record<MatKey, number> | null = null;
  private openParts: Record<MatKey, number> | null = null;
  private marks: Mark[] = [];
  private meshes: Partial<Record<MatKey, Mesh>> = {};
  private base: Partial<Record<MatKey, Float32Array>> = {};
  /** 合并后的网格投不投影（店里的小商品不需要） */
  shadows = true;

  constructor(
    private readonly mats: Record<MatKey, Material>,
    private readonly white: Tile,
    private readonly solids?: Solids,
  ) {}

  push(at: At): this {
    this.stack.push((this.stack[this.stack.length - 1] as Matrix4).clone().multiply(local(at)));
    return this;
  }
  pop(): this {
    if (this.stack.length > 1) this.stack.pop();
    return this;
  }

  /** 开始一段标记：之后添加的部件都属于这一段，直到 end() */
  mark(): this {
    this.openStart = { ...this.counts };
    this.openParts = { toon: this.parts.toon.length, tex: this.parts.tex.length, glow: this.parts.glow.length, glowTex: this.parts.glowTex.length };
    this.open = { ranges: [], hidden: false, box: new Box3() };
    return this;
  }
  end(): Mark {
    const m = this.open as Mark;
    const s = this.openStart as Record<MatKey, number>;
    const ps = this.openParts as Record<MatKey, number>;
    for (const k of Object.keys(this.counts) as MatKey[]) {
      if (this.counts[k] > s[k]) m.ranges.push({ key: k, start: s[k], end: this.counts[k] });
      for (let i = ps[k]; i < this.parts[k].length; i++) {
        const g = this.parts[k][i] as BufferGeometry;
        g.computeBoundingBox();
        m.box.union(g.boundingBox as Box3);
      }
    }
    this.marks.push(m);
    this.open = null;
    this.openStart = null;
    return m;
  }

  /** 隐藏 / 显示一段标记的部件（顶点塌缩到一点） */
  setHidden(m: Mark, hidden: boolean): void {
    if (m.hidden === hidden) return;
    m.hidden = hidden;
    for (const r of m.ranges) {
      const mesh = this.meshes[r.key];
      const base = this.base[r.key];
      if (!mesh || !base) continue;
      const attr = mesh.geometry.getAttribute('position');
      const arr = attr.array as Float32Array;
      for (let i = r.start; i < r.end; i++) {
        if (hidden) {
          arr[i * 3] = base[r.start * 3] as number;
          arr[i * 3 + 1] = base[r.start * 3 + 1] as number;
          arr[i * 3 + 2] = base[r.start * 3 + 2] as number;
        } else {
          arr[i * 3] = base[i * 3] as number;
          arr[i * 3 + 1] = base[i * 3 + 1] as number;
          arr[i * 3 + 2] = base[i * 3 + 2] as number;
        }
      }
      attr.needsUpdate = true;
    }
  }

  private add(g: BufferGeometry, color: number, o: PartOpts, texVerts: (i: number) => boolean, uvMap: (i: number, u: number, v: number) => [number, number]): void {
    const key: MatKey = o.glow ? (o.tex ? 'glowTex' : 'glow') : o.tex ? 'tex' : 'toon';
    const n = g.getAttribute('position').count;
    const uv = g.getAttribute('uv');
    const uvs = new Float32Array(n * 2);
    const col = new Float32Array(n * 3);
    const k = o.glow ?? 1;
    const wu = (this.white.u0 + this.white.u1) / 2;
    const wv = (this.white.v0 + this.white.v1) / 2;
    for (let i = 0; i < n; i++) {
      const t = !!o.tex && texVerts(i);
      if (t) {
        const [u, v] = uvMap(i, uv.getX(i), uv.getY(i));
        const T = o.tex as Tile;
        uvs[i * 2] = T.u0 + (T.u1 - T.u0) * u;
        uvs[i * 2 + 1] = T.v0 + (T.v1 - T.v0) * v;
        _c.set(o.texColor ?? 0xffffff);
      } else {
        uvs[i * 2] = wu;
        uvs[i * 2 + 1] = wv;
        _c.set(color);
      }
      col[i * 3] = _c.r * k;
      col[i * 3 + 1] = _c.g * k;
      col[i * 3 + 2] = _c.b * k;
    }
    g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    if (o.solid && this.solids) {
      g.computeBoundingBox();
      _box.copy(g.boundingBox as Box3);
      this.solids.fromBox(_box);
    }
    this.parts[key].push(g);
    this.counts[key] += n;
  }

  private place(g: BufferGeometry, at: At): BufferGeometry {
    _m.copy(this.stack[this.stack.length - 1] as Matrix4).multiply(local(at));
    g.applyMatrix4(_m);
    return g;
  }

  box(w: number, h: number, d: number, at: At, color: number, o: PartOpts = {}): this {
    const g = new BoxGeometry(w, h, d);
    g.translate(0, h / 2, 0);
    const faces = o.faces ?? ['pz'];
    const on = FACES.map((f) => faces.includes(f));
    this.place(g, at);
    this.add(
      g,
      color,
      o,
      (i) => !!on[Math.floor(i / 4)],
      (_i, u, v) => [u, v],
    );
    return this;
  }

  /** 圆柱：贴图包在侧面一圈；open = 不要上下盖 */
  cyl(rt: number, rb: number, h: number, seg: number, at: At, color: number, o: PartOpts & { open?: boolean } = {}): this {
    const g = new CylinderGeometry(rt, rb, h, seg, 1, !!o.open);
    g.translate(0, h / 2, 0);
    const side = (seg + 1) * 2;
    this.place(g, at);
    this.add(
      g,
      color,
      o,
      (i) => i < side,
      (_i, u, v) => [u, v],
    );
    return this;
  }

  sphere(r: number, at: At, color: number, o: PartOpts & { sy?: number; seg?: number } = {}): this {
    const g = new SphereGeometry(r, o.seg ?? 12, Math.max(6, Math.round((o.seg ?? 12) * 0.66)));
    if (o.sy) g.scale(1, o.sy, 1);
    this.place(g, at);
    this.add(g, color, o, () => true, (_i, u, v) => [u, v]);
    return this;
  }

  /** 竖直平面（朝 +Z，原点在中心）。rx = -PI/2 就是朝上的地贴 */
  plane(w: number, h: number, at: At, color: number, o: PartOpts = {}): this {
    const g = new PlaneGeometry(w, h);
    this.place(g, at);
    this.add(g, color, o, () => true, (_i, u, v) => [u, v]);
    return this;
  }

  /** 圆环（车轮、方向盘）：默认躺在 XY 平面里，朝 +Z */
  torus(r: number, tube: number, at: At, color: number, o: PartOpts & { seg?: number; arc?: number } = {}): this {
    const g = new TorusGeometry(r, tube, 6, o.seg ?? 20, o.arc ?? Math.PI * 2);
    this.place(g, at);
    this.add(g, color, o, () => false, (_i, u, v) => [u, v]);
    return this;
  }

  /** 管子（电线、扶手） */
  tube(points: Vector3[], r: number, color: number, o: PartOpts & { seg?: number } = {}): this {
    const curve = new CatmullRomCurve3(points);
    const g = new TubeGeometry(curve, o.seg ?? Math.max(4, points.length * 4), r, 5, false);
    this.place(g, {});
    this.add(g, color, o, () => false, (_i, u, v) => [u, v]);
    return this;
  }

  build(name = 'kit'): Group {
    const grp = new Group();
    grp.name = name;
    for (const k of Object.keys(this.parts) as MatKey[]) {
      const list = this.parts[k];
      if (list.length === 0) continue;
      const g = mergeGeometries(list, false);
      for (const p of list) p.dispose();
      if (!g) continue;
      g.computeBoundingSphere();
      const mesh = new Mesh(g, this.mats[k]);
      mesh.name = `${name}:${k}`;
      mesh.castShadow = this.shadows && (k === 'toon' || k === 'tex');
      // 小件（商品、价签、门板）也不接收阴影：斜着照进来的投影在密集的小面上会出阴影痤疮，走动时整片闪
      mesh.receiveShadow = this.shadows && (k === 'toon' || k === 'tex');
      this.meshes[k] = mesh;
      if (this.marks.length) this.base[k] = (g.getAttribute('position').array as Float32Array).slice();
      grp.add(mesh);
    }
    this.parts = { toon: [], tex: [], glow: [], glowTex: [] };
    return grp;
  }
}
