import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  Vector2,
  Uint16BufferAttribute,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/**
 * 模型工具集：用基础形体拼模型，所有部件合并成少数几个网格。
 * - 约定：盒子、圆柱、圆锥的原点在"底面中心"，球在球心。
 * - 顶点色烘焙：越靠近地面越暗（环境光遮蔽），再叠加按位置哈希的脏污变化，免去贴图。
 * - 三类材质：matte（哑光）、metal（金属）、glow（自发光，配合 Bloom）。
 */

export type MatKind = 'matte' | 'metal' | 'glow';

export interface Xf {
  x?: number;
  y?: number;
  z?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
}

export interface Style {
  color: number;
  /** 脏污亮度抖动幅度，默认 0.12 */
  jitter?: number;
  /** 底部变暗强度 0–1，默认 0.45 */
  ao?: number;
  /** 变暗作用的高度，默认 0.9 */
  aoH?: number;
  mat?: MatKind;
  /** 自发光强度倍数（glow 材质用），默认 1 */
  glow?: number;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();

export function xfMatrix(xf: Xf): Matrix4 {
  _e.set(xf.rx ?? 0, xf.ry ?? 0, xf.rz ?? 0, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(xf.x ?? 0, xf.y ?? 0, xf.z ?? 0);
  _s.set(xf.sx ?? 1, xf.sy ?? 1, xf.sz ?? 1);
  return _m.compose(_p, _q, _s);
}

function hash3(x: number, y: number, z: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

const _c = new Color();

function paint(g: BufferGeometry, st: Style): void {
  const pos = g.getAttribute('position');
  const n = pos.count;
  const col = new Float32Array(n * 3);
  _c.set(st.color);
  const jitter = st.jitter ?? 0.12;
  const ao = st.ao ?? 0.45;
  const aoH = st.aoH ?? 0.9;
  const glow = st.mat === 'glow' ? (st.glow ?? 1) : 1;
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    let k = 1;
    if (st.mat !== 'glow') {
      const t = Math.min(1, Math.max(0, y / aoH));
      const occl = 1 - ao * (1 - t) * (1 - t);
      k = occl * (1 + jitter * hash3(Math.round(x * 20) / 20, Math.round(y * 20) / 20, Math.round(z * 20) / 20));
    }
    col[i * 3] = _c.r * k * glow;
    col[i * 3 + 1] = _c.g * k * glow;
    col[i * 3 + 2] = _c.b * k * glow;
  }
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
}

export interface Built {
  matte: BufferGeometry | null;
  metal: BufferGeometry | null;
  glow: BufferGeometry | null;
}

export class Builder {
  private lists: Record<MatKind, BufferGeometry[]> = { matte: [], metal: [], glow: [] };
  private stack: Matrix4[] = [new Matrix4()];
  private skinBone = 0;

  /** skinned = true 时，每个部件都写入骨骼索引，之后用 bone(i) 指定当前部件属于哪根骨头 */
  constructor(private readonly skinned = false) {}

  /** 之后添加的部件绑定到第 i 根骨头（仅 skinned 构建器有效） */
  bone(i: number): this {
    this.skinBone = i;
    return this;
  }

  private get top(): Matrix4 {
    return this.stack[this.stack.length - 1] as Matrix4;
  }

  /** 进入一个局部坐标系，之后的部件都相对它放置 */
  push(xf: Xf): this {
    this.stack.push(this.top.clone().multiply(xfMatrix(xf)));
    return this;
  }

  pop(): this {
    if (this.stack.length > 1) this.stack.pop();
    return this;
  }

  add(geo: BufferGeometry, xf: Xf, st: Style): this {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.deleteAttribute('uv');
    g.applyMatrix4(this.top.clone().multiply(xfMatrix(xf)));
    paint(g, st);
    if (this.skinned) {
      const n = g.getAttribute('position').count;
      const si = new Uint16Array(n * 4);
      const sw = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        si[i * 4] = this.skinBone;
        sw[i * 4] = 1;
      }
      g.setAttribute('skinIndex', new Uint16BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new Float32BufferAttribute(sw, 4));
    }
    this.lists[st.mat ?? 'matte'].push(g);
    geo.dispose();
    return this;
  }

  /** 盒子，原点在底面中心 */
  box(w: number, h: number, d: number, xf: Xf, st: Style): this {
    const g = new BoxGeometry(w, h, d);
    g.translate(0, h / 2, 0);
    return this.add(g, xf, st);
  }

  /** 圆角盒，原点在底面中心 */
  rbox(w: number, h: number, d: number, r: number, xf: Xf, st: Style): this {
    const rr = Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
    const g = new RoundedBoxGeometry(w, h, d, 2, Math.max(0.005, rr));
    g.translate(0, h / 2, 0);
    return this.add(g, xf, st);
  }

  cyl(rTop: number, rBottom: number, h: number, seg: number, xf: Xf, st: Style): this {
    const g = new CylinderGeometry(rTop, rBottom, h, seg);
    g.translate(0, h / 2, 0);
    return this.add(g, xf, st);
  }

  cone(r: number, h: number, seg: number, xf: Xf, st: Style): this {
    const g = new ConeGeometry(r, h, seg);
    g.translate(0, h / 2, 0);
    return this.add(g, xf, st);
  }

  sphere(r: number, ws: number, hs: number, xf: Xf, st: Style): this {
    return this.add(new SphereGeometry(r, ws, hs), xf, st);
  }

  /** 圆环；arc < 2π 时是一段圆弧（扳机护圈、提把） */
  torus(r: number, tube: number, rs: number, ts: number, xf: Xf, st: Style, arc = Math.PI * 2): this {
    return this.add(new TorusGeometry(r, tube, rs, ts, arc), xf, st);
  }

  /**
   * 旋转体：profile 是 [半径, 沿轴位置] 的折线，绕 +Z 轴旋转（枪管、消音器、制退器、弹头）。
   * 原点在轴上 0 处。
   */
  lathe(profile: Array<[number, number]>, seg: number, xf: Xf, st: Style): this {
    const g = new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), seg);
    // Lathe 绕 Y 旋转：转到 +Z
    g.rotateX(Math.PI / 2);
    return this.add(g, xf, st);
  }

  /** 沿 +Z 的圆管，从 z0 开始，长 len（枪械零件最常用） */
  tubeZ(r: number, len: number, seg: number, xf: Xf, st: Style, r2 = r): this {
    const g = new CylinderGeometry(r2, r, len, seg);
    g.translate(0, len / 2, 0);
    g.rotateX(Math.PI / 2);
    return this.add(g, xf, st);
  }

  /** 沿 Z 方向挤出一个 XY 轮廓，原点在底面中心，挤出长度居中。bevel > 0 时边缘倒角（轮廓大小不变） */
  extrude(shape: Shape, depth: number, xf: Xf, st: Style, bevel = 0): this {
    if (bevel > 0) {
      const core = Math.max(0.0001, depth - bevel * 2);
      const g = new ExtrudeGeometry(shape, { depth: core, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 2, curveSegments: 8 });
      g.translate(0, 0, -core / 2);
      return this.add(g, xf, st);
    }
    const g = new ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    g.translate(0, 0, -depth / 2);
    return this.add(g, xf, st);
  }

  /** 两点之间的细杆（电线、钢筋、横梁） */
  rod(a: [number, number, number], b: [number, number, number], r: number, st: Style, seg = 5): this {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-5) return this;
    const g = new CylinderGeometry(r, r, len, seg);
    g.translate(0, len / 2, 0);
    // 把 +Y 转向 (dx,dy,dz)
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(dx, dy, dz).normalize());
    const m = new Matrix4().compose(new Vector3(a[0], a[1], a[2]), q, new Vector3(1, 1, 1));
    g.applyMatrix4(m);
    return this.add(g, {}, st);
  }

  isEmpty(): boolean {
    return !this.lists.matte.length && !this.lists.metal.length && !this.lists.glow.length;
  }

  build(): Built {
    const merge = (arr: BufferGeometry[]) => (arr.length ? mergeGeometries(arr, false) : null);
    const out: Built = { matte: merge(this.lists.matte), metal: merge(this.lists.metal), glow: merge(this.lists.glow) };
    for (const k of ['matte', 'metal', 'glow'] as const) {
      for (const g of this.lists[k]) g.dispose();
      this.lists[k] = [];
    }
    return out;
  }
}

export const Mats = {
  matte: new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92, metalness: 0.03 }),
  metal: new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.48, metalness: 0.7 }),
  glow: new MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
  /** 平滑着色版本：枪械、手臂这种近距离看的模型，圆柱不出现棱面 */
  matteSmooth: new MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.03 }),
  metalSmooth: new MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.78 }),
  /** 受击闪白：替换 matte / metal 材质 0.09 秒 */
  flash: new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.6, metalness: 0, emissive: 0xff9070, emissiveIntensity: 1.6 }),
};

export interface MeshOpts {
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** 用平滑着色材质 */
  smooth?: boolean;
}

/** 把 Built 变成一组网格 */
export function toGroup(built: Built, opts: MeshOpts = {}): Group {
  const g = new Group();
  const cast = opts.castShadow ?? true;
  const recv = opts.receiveShadow ?? true;
  for (const k of ['matte', 'metal', 'glow'] as const) {
    const geo = built[k];
    if (!geo) continue;
    const mat = opts.smooth && k !== 'glow' ? (k === 'matte' ? Mats.matteSmooth : Mats.metalSmooth) : Mats[k];
    const m = new Mesh(geo, mat);
    m.castShadow = cast && k !== 'glow';
    m.receiveShadow = recv && k !== 'glow';
    g.add(m);
  }
  return g;
}

/** 常用调色板：黄昏废土，低饱和 + 少量暖色点缀 */
export const Pal = {
  concrete: 0x8f8d86,
  concreteDark: 0x55544f,
  concreteLight: 0xa9a79f,
  brick: 0x8a5a48,
  brickDark: 0x6d4538,
  plaster: 0xcbbd9f,
  plasterDark: 0x8a7f6a,
  sheet: 0x6f7e84,
  rust: 0x8a4a2a,
  steel: 0x3d4650,
  steelLight: 0x7c8890,
  tire: 0x1c1c1e,
  glass: 0x1a252c,
  wood: 0x8a6a45,
  woodDark: 0x5a4128,
  sandbag: 0xa89a72,
  hazard: 0xd6a824,
  olive: 0x4d5a3a,
  bark: 0x4a3c30,
  barkGray: 0x6b6258,
  leaf: 0x5b6b3a,
  white: 0xd9d6cc,
  red: 0xa8362a,
};
